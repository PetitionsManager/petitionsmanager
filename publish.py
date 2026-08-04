#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  publish.py  —  Erzeugt die schlanken Daten für die Mobile-App (webapp/)
# =============================================================================
#
#  Die App (webapp/) ist vom Python-Server ENTKOPPELT: sie lädt statische
#  JSON-Dateien von einer konfigurierbaren URL. Dieses Skript bereitet diese
#  Dateien vor:
#
#    webapp/data/manifest.json      Plattform-Metadaten + Zähler
#    webapp/data/<key>.json         pro Plattform: Array der Petitionen OHNE
#                                   Volltext (title, url, signatures, goal,
#                                   category, status, started_by, start_date,
#                                   image_url, summary, tags, related, tc)
#    webapp/data/<key>.t<N>.json    Volltexte in Häppchen: {url: HTML}
#
#  WARUM DIE TRENNUNG: description_full macht rund drei Viertel der Datenmenge
#  aus (bei OpenPetition 4,9 von 6,5 MB), wird aber nur gebraucht, wenn jemand
#  eine einzelne Kachel aufklappt. Früher lud die App beim Öffnen EINER
#  Petition alle Plattformen komplett (~23 MB) – jetzt die schlanke Liste plus
#  genau ein Textpaket von ~0,4 MB. Die Volltexte bleiben vollständig
#  verfügbar, sie kommen nur später.
#
#  Zusätzlich wird die Verwandtschaft der Petitionen HIER vorab berechnet und
#  als "related" mitgeliefert. Dadurch muss die App für „Gleiche / Ähnliche
#  Petitionen" gar keine fremden Plattformdaten mehr nachladen.
#
#  Diesen Ordner (webapp/) auf einen statischen Host (GitHub Pages, eigener
#  Webspace …) hochladen → die App zeigt Live-Daten. Nach jedem Scrape neu
#  ausführen:  python3 publish.py
# =============================================================================

from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import monitor
import petitions_core as core

OUT_DIR = Path("webapp/data")

# Wie viele Petitionen teilen sich ein Volltext-Paket. 150 ergibt Pakete von
# grob 0,3–0,5 MB – klein genug fürs Mobilfunknetz, groß genug, dass nicht
# hunderte Einzeldateien entstehen.
TEXT_CHUNK = 150

# Merkzettel, welche Petition in welchem Volltext-Paket liegt. Muss versioniert
# werden und mitwandern, sonst wird die Zuordnung beim nächsten Lauf neu
# gewürfelt – siehe write_texts().
INDEX_FILE = Path("texts_index.json")

# Felder, die die App für die Listenansicht braucht. description_full fehlt
# hier bewusst – es wandert in die Volltext-Pakete (siehe oben).
SLIM_FIELDS = ("title", "url", "signatures", "goal", "category", "status",
               "started_by", "recipient", "start_date", "image_url", "kind",
               "summary", "tags", "closed", "deadline")

# Verwandtschaft. Die App trägt dieselbe Rechnung als Notlösung
# (app.js → similarityScore); beide müssen zusammen geändert werden.
# 0.18 → 0.24 und 6 → 4 zusammen mit dem Zuschlag unten (3.8.26). Der Zuschlag
# hebt viele Paare über die alte Schwelle; gemessen am Gesamtbestand stieg die
# Zahl der Petitionen mit Verwandtschaft von 2.891 (32 %) auf 8.716 (97 %) und
# die ausgelieferten related-Listen von 1,8 auf 10,1 MB. Vier statt sechs
# Einträge kosten nichts an Qualität — die Nestlé-Probe fällt mit vier genauso
# aus wie mit sechs — und drücken die Daten auf 6,9 MB.
SIM_MIN_SCORE = 0.24      # darunter ist es kein sinnvoller Treffer mehr
SIM_MAX_PER_PETITION = 12
SIM_TAG_MAX_MEMBERS = 900  # Allerwelts-Schlagwörter beim Vergleichen auslassen
# Hat eine Petition NICHTS über der Schwelle, bekommt sie trotzdem ihren besten
# Treffer — lieber ein schwacher Vorschlag als ein leerer Abschnitt.
SIM_FILL_WEAKEST = True

# ---- Wie weit die Abdeckung überhaupt reichen kann (4.8.26 durchgemessen)
# Die Schwelle ist NICHT der Engpass. Von 0,24 auf 0,00 gesenkt bringt sie bei
# gleichem Deckel nur 97,2 → 97,6 % und kostet 0,6 MB; fast jede Petition hat
# ohnehin genug Treffer über der Schwelle. Dieselben 97,6 % erreicht das
# Auffüllen oben für 0,01 MB und ohne die Güte der übrigen Listen zu verwässern
# (Ø 0,37 statt 0,36) — deshalb Auffüllen statt Schwelle senken.
#
# 97,7 % ist zugleich die BAUARTBEDINGTE OBERGRENZE: verglichen wird nur, wer
# mindestens ein Schlagwort teilt, und Schlagwörter entstehen aus dem Text.
# Die fehlenden 202 Petitionen haben GAR KEINEN TITEL — 183 davon von WeMove,
# dessen Bot-Schutz statt der Kampagne eine leere Vorlage ausliefert
# („[% inititator_name %]"). Das ist kein Ähnlichkeitsproblem: diese Sätze
# stehen in der App ohnehin als „(ohne Titel)". Wer über 97,7 % hinaus will,
# muss WeMove reparieren, nicht an diesen Zahlen drehen.
#
# Von allem, was überhaupt vergleichbar ist (8.766), bekommt seit dem
# Titelwort-Rückfall unten JEDE Petition Verwandte — 100,0 %.
#
# Der Deckel ist der teure Regler. Entscheidend ist aber nicht die rohe Größe,
# sondern was über die Leitung geht; GitHub Pages liefert gzip-komprimiert, und
# JSON schrumpft dabei um das Vierfache (4.8.26 nachgemessen):
#     Deckel   roh MB   gzip MB   Einträge
#        8      12,9      3,17      63.275
#       12      17,2      4,18      84.343
#       16      19,9      4,79      97.457
# Zwölf kostet gegenüber acht rund 1 MB übertragen und hebt den Schnitt von
# 7,2 auf 9,7 Verwandte; von zwölf auf sechzehn wird es spürbar unwirtschaft-
# licher (0,6 MB für 1,5 Einträge mehr). Zum Vergleich der Ausgangspunkt:
# der live ausgelieferte Bestand hatte 8.976 Einträge in 0,27 MB gzip.

# ---- Zuschlag für ein seltenes gemeinsames SCHLAGWORT (Nutzerwunsch 3.8.26)
# Ausgangsbefund: von den sieben offenen Nestlé-Petitionen verwies keine
# einzige auf eine andere, obwohl fünf „Nestlé" als Schlagwort tragen. Die
# Rechnung erklärt es — ein gemeinsames Schlagwort unter elf ergibt 0,09, mal
# 0,45 sind das 0,04 Punkte, weit unter der Schwelle von 0,18. Das
# aussagekräftige Wort ging im Durchschnitt aller anderen unter.
#
# Der erste Versuch, JEDES Wort nach Seltenheit zu gewichten, ist an den Daten
# gescheitert und die Messung steht hier, damit niemand sie wiederholt:
# 98,3 % aller 34.775 Wörter kommen in höchstens 25 Petitionen vor, die Hälfte
# in genau einer. „stillen" (4 Petitionen) ist SELTENER als „nestle" (8).
# Seltenheit allein trennt eine Marke also nicht von einem beliebigen Wort —
# sie hob nur alle Paare gleichmäßig an: 96 % der Petitionen bekamen
# Verwandte und die ausgelieferten Daten wuchsen von 1,8 auf 10 MB.
#
# Was trennt, ist das SCHLAGWORT. Es ist die verdichtete Aussage der Petition
# (core.make_tags), nicht jedes Wort ihres Titels. „nestle" als Schlagwort
# führt acht Petitionen zusammen — darunter „Finger weg von unserem Wasser!",
# die Nestlé nicht einmal im Titel nennt. Deshalb: klassische Bewertung wie
# bisher, plus ein Zuschlag, wenn beide dasselbe SELTENE Schlagwort tragen.
SIM_W_NAME  = 0.36   # Höhe des Zuschlags bei einem sehr seltenen Schlagwort
SIM_NAME_EXP = 3.0   # Steilheit: hoch potenziert zählt nur das wirklich Seltene

_SIM_STOP = set((
    "und oder für mit von den der die das ein eine einen eines dem des im in "
    "auf aus zum zur ist sind wird werden nicht auch mehr gegen ohne über "
    "bei bis dass wir sie ihr uns unsere unser euch euer alle allen soll "
    "sollen muss müssen kann können the and for with from this that are our "
    "you your not petition petitionen deutschland").split())
_SIM_SPLIT = re.compile(r"[^a-zäöüßà-ÿ]+")
# Akzente einebnen, damit „Nestlé" und „Nestle" dasselbe Wort sind — beide
# Schreibweisen stehen im Bestand (WeAct schreibt „Nestle", Avaaz „Nestlé").
# ä, ö, ü und ß bleiben BEWUSST stehen: im Deutschen tragen sie Bedeutung,
# „schön" und „schon" wären sonst dasselbe Wort.
_SIM_DIA = str.maketrans({
    "á": "a", "à": "a", "â": "a", "ã": "a", "å": "a",
    "é": "e", "è": "e", "ê": "e", "ë": "e",
    "í": "i", "ì": "i", "î": "i", "ï": "i",
    "ó": "o", "ò": "o", "ô": "o", "õ": "o",
    "ú": "u", "ù": "u", "û": "u",
    "ý": "y", "ÿ": "y", "ñ": "n", "ç": "c", "č": "c",
})


def slim(rec: dict) -> dict:
    out = {k: rec.get(k) for k in SLIM_FIELDS if rec.get(k) is not None}
    # Fallback: Ältere Datensätze ohne gespeicherte Tags bekommen sie hier beim
    # Export nachträglich (identische Logik wie beim Scrapen).
    if not out.get("tags"):
        tags = core.make_tags(rec)
        if tags:
            out["tags"] = tags
    return out


# ----------------------------------------------------------------------------
# Verwandtschaft vorab berechnen
# ----------------------------------------------------------------------------
def _tokens(text: str) -> set[str]:
    return {w.translate(_SIM_DIA)
            for w in _SIM_SPLIT.split((text or "").lower())
            if len(w) >= 4 and w not in _SIM_STOP}


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def _score(a: dict, b: dict, w: dict, w_max: float) -> float:
    """0..1 – identischer Titel zählt als dieselbe Petition.

    Die vier klassischen Anteile sind unverändert; NEU ist allein der Zuschlag
    für ein seltenes gemeinsames Schlagwort (Begründung bei den Konstanten)."""
    ta = (a["title_norm"], b["title_norm"])
    if ta[0] and ta[0] == ta[1]:
        return 1.0
    tag_j = _jaccard(a["tagset"], b["tagset"])
    title_j = _jaccard(a["title_tok"], b["title_tok"])
    content_j = _jaccard(a["content_tok"], b["content_tok"])
    same_cat = 1.0 if (a["cat"] and a["cat"] == b["cat"]) else 0.0
    klassisch = (tag_j * 0.45 + title_j * 0.30 +
                 content_j * 0.15 + same_cat * 0.10)
    # Zuschlag: das SELTENSTE Schlagwort, das beide tragen. Maximum und nicht
    # Durchschnitt — ein einziger starker Beleg („nestle") darf nicht von
    # schwachen Treffern („kinder") verwässert werden. Hoch potenziert, damit
    # nur wirklich seltene Schlagwörter zählen: bei 8 von 8.968 Petitionen
    # kommt gut die Hälfte des Zuschlags an, bei 500 von 8.968 fast nichts.
    gemeinsam = a["tagset"] & b["tagset"]
    if not gemeinsam:
        return klassisch
    selten = max(w.get(t, 0.0) for t in gemeinsam) / w_max
    if selten > 1.0:
        selten = 1.0
    return klassisch + (selten ** SIM_NAME_EXP) * SIM_W_NAME


def compute_related(by_platform: dict[str, list[dict]]) -> int:
    """Schreibt "related" in die Datensätze (an Ort und Stelle).

    Verglichen wird nur, was mindestens ein Schlagwort teilt – ein voller
    Alle-gegen-alle-Vergleich wären bei ~9.000 Petitionen 40 Mio. Paare."""
    items = []
    for key, recs in by_platform.items():
        for rec in recs:
            if (rec.get("status") or "online") == "offline":
                continue
            # Beendete Petitionen bleiben außen vor – weder als Vorschlag
            # (man kann sie nicht mehr unterschreiben) noch als Ausgangspunkt.
            # Beim Bundestag sind das ~7.850 Datensätze; ihre "related"-Listen
            # machten allein 4,8 MB der App-Daten aus.
            if rec.get("closed"):
                continue
            # Schlagwörter wie Titelwörter behandeln: kleingeschrieben,
            # akzentfrei. Sonst wäre das Schlagwort „Nestlé" ein anderes Wort
            # als „nestle" aus dem Titel der Nachbarpetition und die beiden
            # Felder könnten einander nie bestätigen.
            tags = {str(t).lower().translate(_SIM_DIA)
                    for t in (rec.get("tags") or []) if str(t).strip()}
            title_tok = _tokens(rec.get("title"))
            if not tags and not title_tok:
                continue
            items.append({
                "rec": rec, "platform": key,
                "tagset": tags,
                "title_norm": (rec.get("title") or "").strip().lower(),
                "title_tok": title_tok,
                "content_tok": _tokens((rec.get("title") or "") + " " +
                                       (rec.get("summary") or "")),
                "cat": (rec.get("category") or "").lower() or None,
            })

    # Häufigkeit jedes SCHLAGWORTS im Gesamtbestand → Gewicht für den Zuschlag.
    # Ein Schlagwort auf 8 von 8.968 Petitionen wiegt 7,0, eines auf 900 nur
    # 2,3; die Bezugsgröße w_max ist das seltenste überhaupt teilbare (2).
    n = max(1, len(items))
    df: Counter = Counter()
    for it in items:
        for t in it["tagset"]:
            df[t] += 1
    gewicht = {t: math.log(n / c) for t, c in df.items() if c}
    w_max = math.log(n / 2) if n > 2 else 1.0

    index = defaultdict(list)
    for i, it in enumerate(items):
        for t in it["tagset"]:
            index[t].append(i)
    # Schlagwörter, die fast überall kleben, bringen keine Verwandtschaft.
    common = {t for t, lst in index.items() if len(lst) > SIM_TAG_MAX_MEMBERS}

    # Zweiter Index über die TITELWÖRTER, nur als Rückfall. Wessen Schlagwörter
    # im ganzen Bestand einmalig sind, wird über den Schlagwort-Index mit
    # NIEMANDEM verglichen und bleibt als einziger ohne Verwandtschaft — am
    # 4.8.26 traf das genau 10 Petitionen. Der Index kostet einmalig ~70.000
    # Einträge; abgefragt wird er nur, wenn oben nichts herauskam.
    wort_index = defaultdict(list)
    for i, it in enumerate(items):
        for t in it["title_tok"]:
            wort_index[t].append(i)

    written = 0
    for i, it in enumerate(items):
        cand: set[int] = set()
        for t in it["tagset"]:
            if t in common:
                continue
            cand.update(index[t])
        cand.discard(i)
        if not cand:
            for t in it["title_tok"]:
                lst = wort_index[t]
                if len(lst) <= SIM_TAG_MAX_MEMBERS:
                    cand.update(lst)
            cand.discard(i)
        scored = []
        schwaechster = None    # bester Treffer UNTERHALB der Schwelle
        for j in cand:
            other = items[j]
            s = _score(it, other, gewicht, w_max)
            if s >= SIM_MIN_SCORE:
                scored.append((s, other))
            elif SIM_FILL_WEAKEST and (schwaechster is None
                                       or s > schwaechster[0]):
                schwaechster = (s, other)
        # Auffüllen greift nur bei einer sonst LEEREN Liste. Wer schon Treffer
        # über der Schwelle hat, bekommt keine schwachen dazugemischt.
        if not scored and schwaechster is not None:
            scored = [schwaechster]
        if not scored:
            continue
        scored.sort(key=lambda x: (-x[0], -(x[1]["rec"].get("signatures") or 0)))
        it["rec"]["related"] = [
            {"url": o["rec"].get("url"), "title": o["rec"].get("title"),
             "platform": o["platform"], "score": round(s, 3)}
            for s, o in scored[:SIM_MAX_PER_PETITION]
        ]
        written += 1
    return written


# ----------------------------------------------------------------------------
# Volltexte in Häppchen auslagern
# ----------------------------------------------------------------------------
def load_text_index() -> dict[str, dict[str, int]]:
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text(encoding="utf-8"))
        except ValueError:
            print(f"  ! {INDEX_FILE} unlesbar – Zuordnung wird neu aufgebaut.")
    return {}


def write_texts(key: str, items: list[dict], texts: list[str | None],
                index: dict[str, dict[str, int]]) -> dict[str, str]:
    """Schreibt <key>.t<N>.json und vermerkt die Paketnummer als "tc" am
    Datensatz. Rückgabe: {"<N>": "<Kennung>"} für das Manifest.

    Die Paketnummer hängt bewusst NICHT an der Position in `items`: die Liste
    ist nach Unterschriften sortiert, und die ändern sich täglich. Über die
    Position gerechnet wanderten die Petitionen jeden Tag zwischen den Paketen
    hin und her – jedes Gerät hätte alle 16 MB neu geladen, obwohl sich fast
    nichts geändert hat. Stattdessen bekommt jede URL beim ersten Mal eine
    Nummer und behält sie für immer (INDEX_FILE). Neue Petitionen füllen das
    letzte angefangene Paket auf, danach kommt ein neues dazu. So bleiben alte
    Pakete Byte für Byte gleich und wachsen auf dem Gerät zur Bibliothek.

    Die Nummer bleibt, der INHALT nicht: wird ein Text nachgetragen oder
    reparariert, ändert sich ein Paket unter gleicher Nummer. Weil die App
    Volltexte cache-first ausliefert, behielt ein Gerät dann für immer die alte
    Fassung – bisher blieb nur, die ganze Bibliothek zu verwerfen (sw.js,
    TEXTS hochzählen; zweimal passiert, WeAct und 350.org). Deshalb bekommt
    jedes Paket hier eine kurze Kennung über seinen Inhalt. Die App hängt sie
    beim Laden als "?v=" an, und da der Cache auf der vollständigen Adresse
    liegt, holt sich ein GEÄNDERTES Paket von selbst neu, während alle
    unveränderten liegen bleiben."""
    zuordnung = index.setdefault(key, {})
    belegung = Counter(zuordnung.values())   # auch gelöschte zählen mit, damit
    chunks: dict[int, dict[str, str]] = defaultdict(dict)   # Nummern nie rücken
    for rec, html in zip(items, texts):
        if not html:
            continue
        url = rec["url"]
        n = zuordnung.get(url)
        if n is None:
            n = next((i for i in range(len(belegung) + 1)
                      if belegung[i] < TEXT_CHUNK), 0)
            zuordnung[url] = n
            belegung[n] += 1
        chunks[n][url] = html
        rec["tc"] = n
    kennungen: dict[str, str] = {}
    for n, mapping in chunks.items():
        # sort_keys, damit ein inhaltlich unverändertes Paket auch byteweise
        # unverändert bleibt (sonst wechselt allein die Reihenfolge im JSON)
        # – und damit die Kennung darunter reproduzierbar ist.
        payload = json.dumps(mapping, ensure_ascii=False, sort_keys=True)
        (OUT_DIR / f"{key}.t{n}.json").write_text(payload, encoding="utf-8")
        kennungen[str(n)] = hashlib.sha1(
            payload.encode("utf-8")).hexdigest()[:8]
    return kennungen


def _stamp(iso: str | None) -> float:
    """ISO-Zeitstempel als Sekunden, unlesbares/fehlendes als 0.

    Muss geparst werden, Textvergleich reicht nicht: die Stempel tragen
    verschiedene Zonen — "…T11:47:11+00:00" aus der CI, "…T10:26:42-06:00" vom
    lokalen Lauf. Als Zeichenketten verglichen gilt 10:26 als früher, in
    Wahrheit liegt es vier Stunden SPÄTER. Dieselbe Falle steht in app.js
    (manifestStamp) beschrieben.
    """
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(iso).timestamp()
    except ValueError:
        return 0.0


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"platforms": [], "generated_at": None, "format": 2}
    by_platform: dict[str, list[dict]] = {}
    texts_by_platform: dict[str, list[str | None]] = {}

    # Alte Volltext-Pakete wegräumen, sonst bleiben Reste liegen, wenn eine
    # Plattform schrumpft.
    for old in OUT_DIR.glob("*.t[0-9]*.json"):
        old.unlink()

    for p in monitor.PLATFORMS:
        entry = {
            "key": p.key,
            "name": p.name,
            "source_url": p.source_url,
            "openness": p.openness,
            "openness_note": p.openness_note,
            "eyebrow": p.eyebrow,
            "language": p.language,
            "live": p.is_live,
            "count": 0,
            "online": 0,
            "new": 0,
            "generated_at": None,
        }
        if p.is_live and p.data_file and p.data_file.exists():
            data = json.loads(p.data_file.read_text(encoding="utf-8"))
            meta = data.pop("_meta", {})
            entry["generated_at"] = meta.get("generated_at")
            entry["new"] = len(meta.get("new_petitions_last_run") or [])
            # Nach Unterschriften absteigend; Volltext getrennt mitführen,
            # damit Reihenfolge und Paketnummern zusammenpassen.
            pairs = sorted(
                ((slim(r), r.get("description_full")) for r in data.values()),
                key=lambda t: t[0].get("signatures") or -1, reverse=True)
            items = [a for a, _ in pairs]
            by_platform[p.key] = items
            texts_by_platform[p.key] = [b for _, b in pairs]
            entry["count"] = len(items)
            entry["online"] = sum(1 for r in items
                                  if r.get("status", "online") == "online")
            # Jüngster Plattform-Stempel, nicht der erste, der vorbeikommt:
            # vorher stand hier der Stempel der ERSTEN Live-Plattform in
            # monitor.PLATFORMS. Nach einem publish-Lauf am 29.7.26 um 18:59
            # meldete das Manifest deshalb weiter den 28.7. — der Wert sagte
            # nichts über den Stand des Pakets, sondern nur über eine einzelne
            # Plattform. Die App rechnet sich ihr Maß selbst aus (app.js,
            # manifestStamp: Maximum über manifest.platforms) und hing nie an
            # diesem Feld; es steht für Menschen und andere Leser da und soll
            # deshalb auch stimmen.
            if _stamp(entry["generated_at"]) > _stamp(manifest["generated_at"]):
                manifest["generated_at"] = entry["generated_at"]
        manifest["platforms"].append(entry)

    # Verwandtschaft über ALLE Plattformen hinweg – muss vor dem Schreiben
    # laufen, weil "related" in den Datensätzen landet.
    related_n = compute_related(by_platform)

    text_index = load_text_index()
    chunks_total = 0
    # Kennungen je Paket ins Manifest, damit die App "?v=" anhängen kann. Muss
    # nach write_texts passieren (die Kennung entsteht erst beim Schreiben) und
    # vor dem Schreiben des Manifests.
    eintrag_je_key = {e["key"]: e for e in manifest["platforms"]}
    for key, items in by_platform.items():
        kennungen = write_texts(key, items, texts_by_platform[key], text_index)
        chunks_total += len(kennungen)
        if key in eintrag_je_key:
            eintrag_je_key[key]["tv"] = kennungen
        (OUT_DIR / f"{key}.json").write_text(
            json.dumps(items, ensure_ascii=False), encoding="utf-8")
    INDEX_FILE.write_text(
        json.dumps(text_index, ensure_ascii=False, sort_keys=True),
        encoding="utf-8")

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # Scraper-Dashboard als Status-Snapshot mit auf GitHub Pages ausliefern
    # (read-only: die "Jetzt scrapen"-Buttons brauchen den lokalen Server).
    # Die Datei ist gitignoriert und entsteht ausschließlich zur Laufzeit.
    # Fehlte sie, lieferte der Pages-Deploy die Status-Ansicht nicht mit und
    # die URL antwortete 404 — das blieb tagelang unbemerkt, weil publish.py
    # sie stillschweigend übersprang. Nur zu MELDEN reicht aber auch nicht:
    # geschrieben wird sie von monitor.py, und wenn dessen Lauf in der Frist
    # abgebrochen wird oder publish.py allein läuft, hat sie niemand erzeugt.
    # Deshalb erzeugt publish.py sie hier notfalls selbst — die Zahlen stehen
    # ohnehin in denselben Stores, aus denen dieses Skript gerade gelesen hat.
    dash = Path("dashboard.html")
    if not dash.exists():
        print("dashboard.html fehlt – wird jetzt aus den Stores erzeugt.")
        core.write_dashboard(monitor.PLATFORMS)
    shutil.copy(dash, OUT_DIR.parent / "dashboard.html")
    print("dashboard.html → webapp/ (Status-Ansicht via Pages-URL)")

    live = [p for p in manifest["platforms"] if p["live"]]
    total = sum(p["count"] for p in live)
    list_mb = sum(f.stat().st_size for f in OUT_DIR.glob("*.json")
                  if ".t" not in f.stem) / 1048576
    text_mb = sum(f.stat().st_size
                  for f in OUT_DIR.glob("*.t[0-9]*.json")) / 1048576
    print(f"publish: {len(live)} Live-Plattformen, {total} Petitionen → {OUT_DIR}/")
    print(f"  Listen: {list_mb:.1f} MB · Volltexte: {text_mb:.1f} MB "
          f"in {chunks_total} Paketen")
    print(f"  Verwandtschaft vorberechnet für {related_n} Petitionen")


if __name__ == "__main__":
    main()
