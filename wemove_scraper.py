#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  wemove_scraper.py  —  Plattform-Modul für WeMove Europe (deutsch)
# =============================================================================
#
#  Scrapt die deutschen Kampagnen/Appelle von WeMove Europe. Nutzt
#  petitions_core.py; Einstieg monitor.py.
#
#  QUELLEN (robots.txt von action.wemove.eu erlaubt alles außer /act/, /login/,
#  /share/, /cms/unsubscribe – die Sign-Seiten und /progress/ sind frei):
#    - https://wemove.eu/de + /de/campaigns          Übersicht (WordPress) mit
#      Links auf https://action.wemove.eu/sign/<page>
#    - https://action.wemove.eu/sign/<page>          Detailseite (ActionKit)
#    - https://action.wemove.eu/progress/<page>      Live-Zähler (JSONP)
#
#  BESONDERHEITEN:
#  - Die Detailseite ist ActionKit-Template-HTML: Zähler/Ziel werden client-
#    seitig gerendert; der Live-Stand kommt aus /progress/<page>
#    ({"total": {"actions": N}, "goal": 1, …}; goal=1 heißt "dynamisch").
#    Das angezeigte Ziel berechnet WeMove clientseitig als nächsten
#    Meilenstein – hier über die TARGETS-Staffel nachgebildet.
#  - Startdatum steckt im Seitennamen-Präfix: "2026-05-…-petition-DE".
#  - Text: <article> = Appelltext, .why-is-important--text = Begründung.
#  - Deutsche Seiten enden auf "-DE" (Discovery filtert darauf).
# =============================================================================

from __future__ import annotations

import datetime as _dt
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

import i18n_helfer as i18n
import petitions_core as core
from petitions_core import Platform, log, now_iso, prog, sanitize_fragment

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
WWW_URL   = "https://wemove.eu"
BASE_URL  = "https://action.wemove.eu"
DATA_FILE = Path("wemove_petitions.json")
HTML_FILE = Path("wemove_petitions.html")

SIGN_HREF_RE = re.compile(r'https://action\.wemove\.eu/sign/([A-Za-z0-9_-]+)/?')
# Neue Slugs: "2026-05-…", alte: "202203-…" (ohne Bindestrich).
PAGE_DATE_RE = re.compile(r"^(\d{4})-?(\d{2})-")
PROGRESS_RE  = re.compile(r"onProgressLoaded\((.*)\)\s*;?\s*$", re.S)
# Titel unfertiger ActionKit-Seiten: „Enter a Title for 2023-08-michal-test12…"
PLATZHALTER_TITEL_RE = re.compile(r"^\s*enter a title\b", re.I)

# Ziel-Staffel (nächster Meilenstein über dem Stand), analog zu Avaaz/WeMove-JS.
TARGETS = [1000, 2000, 5000, 10000, 20000, 50000, 75000, 100000,
           150000, 200000, 300000, 500000, 750000, 1000000]
TARGET_INCREMENT = 100000

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}

# Grenzen fuer einen Lauf. action.wemove.eu schaltet nach einigen Dutzend
# Abrufen einen Checkpoint davor, der mit leeren 200/202-Antworten reagiert.
# Am 29.7.26 lieferte ein Lauf ueber alle 262 Kampagnen deshalb nach den ersten
# rund 40 nur noch Leerseiten. Statt das zu umgehen, fragt der Scraper weniger:
# er hoert auf, sobald mehrere Abrufe hintereinander leer bleiben, und holt den
# Rest beim naechsten Tageslauf. Der Rueckstand baut sich so ueber einige Tage
# ab - langsamer, aber ohne dem Betreiber zur Last zu fallen.
DETAIL_BUDGET = 120        # erfolgreiche Detailabrufe pro Lauf
# So lange gilt eine als unbrauchbar erkannte Seite als erledigt, bevor sie
# erneut geprüft wird (siehe Merkzettel in run()).
UNBRAUCHBAR_ERNEUT_NACH_TAGEN = 30


def _merk_abgelaufen(zeitstempel: str) -> bool:
    """Ist der Merkzettel-Eintrag alt genug für eine erneute Prüfung?
    Ein unlesbarer Stempel gilt als abgelaufen — im Zweifel lieber einmal zu
    viel prüfen als eine Seite für immer abschreiben."""
    try:
        alt = _dt.datetime.fromisoformat(str(zeitstempel))
    except (TypeError, ValueError):
        return True
    jetzt = _dt.datetime.now(alt.tzinfo)
    return (jetzt - alt).days >= UNBRAUCHBAR_ERNEUT_NACH_TAGEN
ABBRUCH_NACH_FEHLERN = 5   # Leerantworten in Folge = Checkpoint erreicht


def _goal_for(count: int) -> int:
    for t in TARGETS:
        if count < t:
            return t
    return ((count // TARGET_INCREMENT) + 1) * TARGET_INCREMENT


# ----------------------------------------------------------------------------
# Entdeckung
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{page_name: {}} aus Startseite + Kampagnen-Übersicht (nur *-DE)."""
    found: dict[str, dict] = {}
    sources = [("Startseite", f"{WWW_URL}/de"),
               ("Kampagnen", f"{WWW_URL}/de/campaigns")]
    prog(phase="discover", current=0, total=len(sources),
         message="Sammle Kampagnen …")
    for i, (label, url) in enumerate(sources, 1):
        resp = fetcher.get(url)
        added = 0
        if resp is not None and resp.ok:
            for m in SIGN_HREF_RE.finditer(resp.text):
                page = m.group(1).rstrip("/")
                if page.endswith("-DE") and page not in found:
                    found[page] = {}
                    added += 1
        log(f"{label}: +{added} (gesamt {len(found)}).")
        prog(current=i, total=len(sources),
             message=f"{label} geprüft · {len(found)} Kampagnen bisher")
    return found


# ----------------------------------------------------------------------------
# Detailseite + Live-Zähler
# ----------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# SPRACHFASSUNGEN
#
# Jeder WeMove-Slug endet auf ein Sprachkürzel; im Bestand vom 8.8.2026 tragen
# ALLE 261 die Endung „-DE". Tauscht man sie gegen „-EN", antwortet dieselbe
# Kampagne auf Englisch — an zehn zufälligen Sätzen geprüft, neun lieferten
# eine echte Übersetzung („Stoppen Sie Volkswagens gefährlichen neuen Deal" →
# „Stop Volkswagen's dangerous new deal", html lang de → en). Der zehnte war
# ein kaputter Slug (2024-5--DE), der in BEIDEN Sprachen 404 liefert.
#
# ⚠️ KOSTEN: das VERDOPPELT die Detailabrufe, und action.wemove.eu schaltet
# nach einigen Dutzend Abrufen einen Checkpoint davor (siehe scrape_petition).
# Deshalb der Schalter unten: er lässt sich abstellen, ohne den Code
# anzufassen, und DETAIL_BUDGET in run() begrenzt weiterhin den ganzen Lauf.
SPRACHSUFFIX = "-DE"
FREMDSPRACHEN = ("en",)
SUFFIX_JE_SPRACHE = {"en": "-EN"}
WARUM_UEBERSCHRIFT = {
    "de": "Warum ist das wichtig?",
    "en": "Why is this important?",
}


def _fremd_slug(page: str, lang: str) -> str | None:
    """Slug der Fremdsprache, oder None wenn der Slug nicht dem Muster folgt."""
    suffix = SUFFIX_JE_SPRACHE.get(lang)
    if not suffix or not page.upper().endswith(SPRACHSUFFIX):
        return None
    return page[:-len(SPRACHSUFFIX)] + suffix


def _kampagne(page: str) -> str:
    """Gemeinsame Kennung aller Sprachfassungen: der Slug OHNE Sprachkürzel."""
    rumpf = page[:-len(SPRACHSUFFIX)] if page.upper().endswith(SPRACHSUFFIX) \
        else page
    return f"wemove:{rumpf}"


def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    tag = (soup.find("meta", property=prop)
           or soup.find("meta", attrs={"name": prop}))
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def parse_detail(html: str, url: str, page: str, lang: str = "de") -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    # Das erste h1 der Seite steckt in <noscript> ("JavaScript is disabled")
    # – noscript-Inhalte komplett ignorieren.
    for ns in soup.find_all("noscript"):
        ns.decompose()
    h1 = soup.find("h1")
    rec["title"] = (h1.get_text(" ", strip=True) if h1
                    else _meta(soup, "og:title"))
    # Merker für scrape_petition, wird dort wieder entfernt: Eine echte
    # ActionKit-Seite bringt immer ein <h1> mit, auch wenn es leer ist. Die
    # Checkpoint-Antwort bringt gar keins. Daran hängt die Unterscheidung
    # „Seite ist unbrauchbar" gegen „wir werden gerade geblockt".
    rec["_hat_h1"] = h1 is not None
    rec["image_url"] = _meta(soup, "og:image")
    rec["url"] = url

    parts = []
    art = soup.find("article")
    if art:
        parts.append(sanitize_fragment(art, BASE_URL))
    why = soup.select_one(".why-is-important--text")
    if why:
        # ⚠️ Diese Zwischenüberschrift steht NICHT auf der Seite, wir setzen sie
        # selbst. Sie muss deshalb der Sprache des Textes folgen, den sie
        # überschreibt — sonst steht ein deutscher Satz über einem englischen
        # Absatz. WeMove selbst nennt den Abschnitt auf der englischen Seite
        # „Why is this important?".
        parts.append("<h3>" + WARUM_UEBERSCHRIFT.get(lang,
                     WARUM_UEBERSCHRIFT["de"]) + "</h3>")
        parts.append(sanitize_fragment(why, BASE_URL))
    rec["description_full"] = "\n".join(p for p in parts if p) or None
    if art:
        text = art.get_text(" ", strip=True)
        rec["summary"] = (text[:200] + "…") if len(text) > 200 else text or None

    m = PAGE_DATE_RE.match(page)
    if m:
        rec["start_date"] = f"{m.group(1)}-{m.group(2)}-01"

    rec["started_by"] = "WeMove Europe"
    rec["kind"] = "petition"
    return rec


def fetch_progress(fetcher: core.Fetcher, page: str) -> int | None:
    resp = fetcher.get(f"{BASE_URL}/progress/{page}")
    if resp is None or not resp.ok:
        return None
    m = PROGRESS_RE.search(resp.text.strip())
    try:
        data = json.loads(m.group(1) if m else resp.text)
    except ValueError:
        return None
    actions = (data.get("total") or {}).get("actions")
    return int(actions) if actions is not None else None


def scrape_petition(fetcher: core.Fetcher, page: str) -> tuple[str, dict | None]:
    url = f"{BASE_URL}/sign/{page}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    rec = parse_detail(resp.text, url, page)
    hat_h1 = rec.pop("_hat_h1", False)

    # Bot-Schutz erkennen und als FEHLER behandeln, nicht als Erfolg.
    #
    # action.wemove.eu schaltet nach einigen Dutzend Abrufen einen Checkpoint
    # davor. Der antwortet nicht mit 403, sondern mit 200 bzw. 202 und einer
    # Seite ohne Inhalt - selbst robots.txt kommt dann als leeres 202. Ohne
    # diese Pruefung lief das als "online" durch: upsert schreibt zwar keine
    # leeren Werte, setzt aber last_checked, und skip_recent sperrt den
    # Datensatz danach 24 h. Am 29.7.26 hat genau das 241 von 262 Petitionen
    # blockiert, ohne dass ein einziger Text dazukam. Als "error" bleibt
    # last_checked stehen und der naechste Lauf versucht es erneut.
    #
    # Der Checkpoint wird NICHT umgangen - das waere gegen den erklaerten
    # Willen des Betreibers. Die Antwort ist, weniger und langsamer zu fragen
    # (siehe DETAIL_BUDGET in run()).
    titel = (rec.get("title") or "").strip()
    if not titel and not rec.get("description_full") and not hat_h1:
        return "error", None

    # "unbrauchbar": die Seite ANTWORTET vollständig, taugt aber nicht als
    # Petition — leerer Titel (z. B. /sign/2023-10--DE) oder der Platzhalter
    # unfertiger ActionKit-Seiten („Enter a Title for <seitenname>", am 4.8.26
    # zwanzigmal in der App: …michal-test12…, …postactiontest3…, …JOLANTA-
    # TESTING…). Das ist ausdrücklich KEIN Fehler:
    #
    #   Genau hier lag der eigentliche Schaden. Solche Seiten galten als
    #   "error", `known` sortiert Datensaetze ohne Volltext nach VORN, und
    #   ABBRUCH_NACH_FEHLERN bricht nach fünf Fehlschlägen in Folge ab. Die
    #   toten Seiten standen also am Anfang der Warteschlange und beendeten
    #   jeden Lauf, bevor eine einzige lebende Kampagne an die Reihe kam.
    #   Ergebnis (4.8.26 gemessen): 188 von 208 Datensaetzen hatten seit ihrer
    #   Anlage am 6.7.26 nie ein `last_checked` — sie wurden nie erreicht.
    #   Als Checkpoint gewertet wurde dabei ein Zustand, der keiner war.
    #
    # Der Aufrufer stempelt solche Seiten nur mit `last_checked` ab, damit sie
    # 24 h lang aus der Warteschlange sind, und zählt sie NICHT als Fehler.
    if not titel or PLATZHALTER_TITEL_RE.match(titel):
        return "unbrauchbar", None
    sig = fetch_progress(fetcher, page)
    if sig is not None:
        rec["signatures"] = sig
        rec["goal"] = _goal_for(sig)

    i18n.setze_hauptsprache(rec, "de")
    rec["campaign_id"] = _kampagne(page)
    _fremdsprachen_holen(fetcher, rec, page)
    return "online", rec


def _fremdsprachen_holen(fetcher: core.Fetcher, rec: dict, page: str) -> None:
    """Die übrigen Sprachfassungen an `rec` hängen.

    Fehlschläge kosten hier nur die Übersetzung, nie den Datensatz — die
    deutsche Fassung steht zu diesem Zeitpunkt schon fest. Der Zustand wird
    trotzdem festgehalten, weil „abgerufen und nicht vorhanden" etwas anderes
    ist als „nicht abgerufen"; nur das Erste rechtfertigt das Abzeichen in der
    App (siehe i18n_helfer)."""
    for lang in FREMDSPRACHEN:
        fremd_page = _fremd_slug(page, lang)
        if not fremd_page:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
            continue
        url = f"{BASE_URL}/sign/{fremd_page}"
        resp = fetcher.get(url)
        if resp is None or not resp.ok:
            i18n.setze_sprachfassung(
                rec, lang,
                "fehlt" if resp is not None
                and resp.status_code in (404, 410) else "ungeklärt")
            continue
        fremd = parse_detail(resp.text, url, fremd_page, lang)
        hat_h1 = fremd.pop("_hat_h1", False)
        f_titel = (fremd.get("title") or "").strip()
        # Dieselbe Messlatte wie oben für die deutsche Seite: ohne <h1> ist es
        # der Checkpoint (ungeklärt), mit <h1> aber ohne brauchbaren Titel ist
        # es eine unfertige ActionKit-Seite — die gibt es dann wirklich nicht
        # als lesbare Kampagne.
        if not hat_h1:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
        elif not f_titel or PLATZHALTER_TITEL_RE.match(f_titel):
            i18n.setze_sprachfassung(rec, lang, "fehlt")
        else:
            i18n.setze_sprachfassung(rec, lang, "vorhanden", fremd)


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()

    # Merkzettel unbrauchbarer Seiten. Ohne ihn kostete die Reparatur vom
    # 4.8.2026 die Hälfte des Laufs: „unbrauchbar" zählte als Erfolg, also
    # gegen DETAIL_BUDGET, und `known.sort()` schiebt Sätze ohne Volltext nach
    # VORN — Test- und Entwurfsseiten bekommen nie einen Volltext und standen
    # damit jeden Lauf wieder ganz oben. Am 8.8.2026 gemessen: 54 der 263
    # Seiten sind unbrauchbar, das sind 54 von 120 Abrufen (45 %) für Seiten,
    # die nie eine Petition werden. Dieselbe Verstopfung wie beim Ausfall
    # davor, nur ohne den Abbruch.
    #
    # Der Merkzettel läuft ab: nach UNBRAUCHBAR_ERNEUT_NACH_TAGEN wird eine
    # Seite wieder geprüft. Eine unfertige Kampagne, die jemand später
    # ausfüllt, kommt so von selbst zurück — ohne Ablauf wäre der Merkzettel
    # ein endgültiges Urteil über eine Seite, die sich ändern darf.
    unbrauchbare = dict(core.load_meta(DATA_FILE).get("unbrauchbare") or {})
    unbrauchbare = {p: z for p, z in unbrauchbare.items()
                    if not _merk_abgelaufen(z)}

    def save(quiet=True, **extra):
        # unbrauchbare MUSS bei jedem Speichern mitgehen: save_store baut
        # _meta neu auf, alles nicht Übergebene fiele weg.
        core.save_store(store, DATA_FILE,
                        extra_meta={"unbrauchbare": unbrauchbare, **extra},
                        quiet=quiet)

    known = list(store.keys())
    # Datensaetze ohne Volltext nach vorne. Der Checkpoint deckelt die Menge pro
    # Lauf ohnehin (siehe unten), also soll das Wenige dort landen, wo es etwas
    # aendert. Solange der Rueckstand besteht, werden die vollstaendigen
    # Datensaetze seltener nachgezaehlt - das ist der Preis und geht vorbei.
    known.sort(key=lambda p: bool((store.get(p) or {}).get("description_full")))
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte Kampagne(n) …")
        prog(phase="check-known", current=0, total=len(known),
             message="Prüfe bekannte Kampagnen …")
        erfolge = 0
        fehler_in_folge = 0
        unbrauchbar = 0
        for k, page in enumerate(known, 1):
            if erfolge >= DETAIL_BUDGET:
                log(f"  Budget von {DETAIL_BUDGET} Abrufen erreicht – "
                    f"Rest folgt beim nächsten Lauf.")
                break
            prog(current=k, total=len(known), message=page)
            if core.skip_recent(store.get(page), args):
                continue
            status, rec = scrape_petition(fetcher, page)
            if status == "error":
                fehler_in_folge += 1
                if fehler_in_folge >= ABBRUCH_NACH_FEHLERN:
                    log(f"  {fehler_in_folge} Fehlschläge in Folge – vermutlich "
                        f"der Checkpoint von WeMove. Lauf hier beendet; der "
                        f"Rest folgt beim nächsten Mal.")
                    break
                continue
            if status == "unbrauchbar":
                # Die Seite hat geantwortet, wir sind also NICHT geblockt –
                # der Zähler geht zurück auf null.
                #
                # Der Satz wird ENTFERNT, nicht abgestempelt (8.8.2026). Vorher
                # blieb er als „online" liegen, obwohl derselbe Code ihn beim
                # Entdecken gar nicht erst angelegt hätte — der Bestand trug
                # also 54 Sätze, die er nach eigenen Regeln nicht tragen darf,
                # meldete 263 statt 209 und schleppte sie täglich mit. Der
                # Merkzettel verhindert, dass die Entdeckung sie sofort wieder
                # als „neu" vorlegt.
                unbrauchbar += 1
                fehler_in_folge = 0
                erfolge += 1
                unbrauchbare[page] = ts
                store.pop(page, None)
                save()
                continue
            fehler_in_folge = 0
            erfolge += 1
            core.upsert(store, page, rec or {}, {}, status, ts,
                        f"{BASE_URL}/sign/{page}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {page}")
        if unbrauchbar:
            log(f"  {unbrauchbar} Seite(n) ohne brauchbaren Titel "
                f"(Test-/Entwurfsseiten) – abgestempelt, nicht als Fehler "
                f"gewertet.")

    log("Sammle Kampagnen (Startseite + Übersicht) …")
    discovered = discover_slugs(fetcher)
    # WeMove verlinkt seine Test- und Entwurfsseiten auf der Startseite mit,
    # die Entdeckung findet sie also jeden Tag wieder. Ohne den Merkzettel
    # würden sie hier als „neu" gelten und das Abrufbudget genauso auffressen
    # wie vorher im bekannten Bestand — verschoben, nicht behoben.
    uebersprungen = [p for p in discovered if p not in store and p in unbrauchbare]
    new_pages = [p for p in discovered
                 if p not in store and p not in unbrauchbare]
    if uebersprungen:
        log(f"{len(uebersprungen)} bekannte Test-/Entwurfsseite(n) übersprungen "
            f"(Merkzettel, erneute Prüfung nach "
            f"{UNBRAUCHBAR_ERNEUT_NACH_TAGEN} Tagen).")
    if args.limit:
        new_pages = new_pages[:args.limit]
    log(f"{len(new_pages)} neue Kampagnen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_pages),
         message="Beginne Scrape …")

    for i, page in enumerate(new_pages, 1):
        log(f"({i}/{len(new_pages)}) {page}")
        prog(current=i, total=len(new_pages), message=page)
        status, rec = scrape_petition(fetcher, page)
        # "unbrauchbar" hier ebenfalls überspringen: eine Test- oder
        # Entwurfsseite soll gar nicht erst als Datensatz entstehen. Sie kommt
        # zusätzlich auf den Merkzettel, damit der nächste Lauf sie nicht
        # erneut abruft.
        if status == "unbrauchbar":
            unbrauchbare[page] = ts
            continue
        if status == "error":
            continue
        core.upsert(store, page, rec or {}, {}, status, ts,
                    f"{BASE_URL}/sign/{page}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Kampagne(n) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    # „available" ist der Maßstab des Vollständigkeitsbalkens. Gezählt wird,
    # was überhaupt eine Petition werden kann — die bekannten Test- und
    # Entwurfsseiten gehören nicht dazu. Sonst stünde WeMove dauerhaft bei
    # 209 von 263 = 79 % und meldete Rückstand für einen korrekten Zustand.
    erreichbar = [p for p in discovered if p not in unbrauchbare]
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(erreichbar))
    core.write_list_html(PLATFORM)
    log("Fertig (WeMove Europe).")


def check(fetcher):
    return core.check_source(fetcher, f"{WWW_URL}/de/campaigns", SIGN_HREF_RE, 20,
                             "Kampagnen-Links")

PLATFORM = Platform(
    key="wemove",
    openness=3,
    openness_note="Mittel: Kampagnen inkl. Archiv verlinkt, aber Zähler nur über "
                  "separaten Progress-Endpoint und gedrosselte Antworten bei "
                  "Serien-Abrufen.",
    name="WeMove Europe",
    eyebrow="WeMove Europe · Kampagnen (deutsch)",
    source_url="https://wemove.eu/de/campaigns",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
