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

import json
import re
import shutil
from collections import Counter, defaultdict
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

# Verwandtschaft: dieselbe Gewichtung wie die Notlösung in der App
# (app.js → similarityScore), damit sich das Verhalten nicht ändert.
SIM_MIN_SCORE = 0.18      # darunter ist es kein sinnvoller Treffer mehr
SIM_MAX_PER_PETITION = 6
SIM_TAG_MAX_MEMBERS = 900  # Allerwelts-Schlagwörter beim Vergleichen auslassen

_SIM_STOP = set((
    "und oder für mit von den der die das ein eine einen eines dem des im in "
    "auf aus zum zur ist sind wird werden nicht auch mehr gegen ohne über "
    "bei bis dass wir sie ihr uns unsere unser euch euer alle allen soll "
    "sollen muss müssen kann können the and for with from this that are our "
    "you your not petition petitionen deutschland").split())
_SIM_SPLIT = re.compile(r"[^a-zäöüßà-ÿ]+")


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
    return {w for w in _SIM_SPLIT.split((text or "").lower())
            if len(w) >= 4 and w not in _SIM_STOP}


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    union = len(a | b)
    return len(a & b) / union if union else 0.0


def _score(a: dict, b: dict) -> float:
    """0..1 – identischer Titel zählt als dieselbe Petition."""
    ta = (a["title_norm"], b["title_norm"])
    if ta[0] and ta[0] == ta[1]:
        return 1.0
    tag_j = _jaccard(a["tagset"], b["tagset"])
    title_j = _jaccard(a["title_tok"], b["title_tok"])
    content_j = _jaccard(a["content_tok"], b["content_tok"])
    same_cat = 1.0 if (a["cat"] and a["cat"] == b["cat"]) else 0.0
    return tag_j * 0.45 + title_j * 0.30 + content_j * 0.15 + same_cat * 0.10


def compute_related(by_platform: dict[str, list[dict]]) -> int:
    """Schreibt "related" in die Datensätze (an Ort und Stelle).

    Verglichen wird nur, was mindestens ein Schlagwort teilt – ein voller
    Alle-gegen-alle-Vergleich wären bei ~6.000 Petitionen 36 Mio. Paare."""
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
            tags = [str(t).lower() for t in (rec.get("tags") or [])]
            if not tags:
                continue
            items.append({
                "rec": rec, "platform": key,
                "tagset": set(tags),
                "title_norm": (rec.get("title") or "").strip().lower(),
                "title_tok": _tokens(rec.get("title")),
                "content_tok": _tokens((rec.get("title") or "") + " " +
                                       (rec.get("summary") or "")),
                "cat": (rec.get("category") or "").lower() or None,
            })

    index = defaultdict(list)
    for i, it in enumerate(items):
        for t in it["tagset"]:
            index[t].append(i)
    # Schlagwörter, die fast überall kleben, bringen keine Verwandtschaft.
    common = {t for t, lst in index.items() if len(lst) > SIM_TAG_MAX_MEMBERS}

    written = 0
    for i, it in enumerate(items):
        cand: set[int] = set()
        for t in it["tagset"]:
            if t in common:
                continue
            cand.update(index[t])
        cand.discard(i)
        scored = []
        for j in cand:
            other = items[j]
            s = _score(it, other)
            if s >= SIM_MIN_SCORE:
                scored.append((s, other))
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
                index: dict[str, dict[str, int]]) -> int:
    """Schreibt <key>.t<N>.json und vermerkt die Paketnummer als "tc" am
    Datensatz. Rückgabe: Anzahl geschriebener Pakete.

    Die Paketnummer hängt bewusst NICHT an der Position in `items`: die Liste
    ist nach Unterschriften sortiert, und die ändern sich täglich. Über die
    Position gerechnet wanderten die Petitionen jeden Tag zwischen den Paketen
    hin und her – jedes Gerät hätte alle 16 MB neu geladen, obwohl sich fast
    nichts geändert hat. Stattdessen bekommt jede URL beim ersten Mal eine
    Nummer und behält sie für immer (INDEX_FILE). Neue Petitionen füllen das
    letzte angefangene Paket auf, danach kommt ein neues dazu. So bleiben alte
    Pakete Byte für Byte gleich und wachsen auf dem Gerät zur Bibliothek."""
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
    for n, mapping in chunks.items():
        # sort_keys, damit ein inhaltlich unverändertes Paket auch byteweise
        # unverändert bleibt (sonst wechselt allein die Reihenfolge im JSON).
        (OUT_DIR / f"{key}.t{n}.json").write_text(
            json.dumps(mapping, ensure_ascii=False, sort_keys=True),
            encoding="utf-8")
    return len(chunks)


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
            if not manifest["generated_at"]:
                manifest["generated_at"] = entry["generated_at"]
        manifest["platforms"].append(entry)

    # Verwandtschaft über ALLE Plattformen hinweg – muss vor dem Schreiben
    # laufen, weil "related" in den Datensätzen landet.
    related_n = compute_related(by_platform)

    text_index = load_text_index()
    chunks_total = 0
    for key, items in by_platform.items():
        chunks_total += write_texts(key, items, texts_by_platform[key],
                                    text_index)
        (OUT_DIR / f"{key}.json").write_text(
            json.dumps(items, ensure_ascii=False), encoding="utf-8")
    INDEX_FILE.write_text(
        json.dumps(text_index, ensure_ascii=False, sort_keys=True),
        encoding="utf-8")

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # Scraper-Dashboard als Status-Snapshot mit auf GitHub Pages ausliefern
    # (read-only: die "Jetzt scrapen"-Buttons brauchen den lokalen Server).
    dash = Path("dashboard.html")
    if dash.exists():
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
