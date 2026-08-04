#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  europarl_scraper.py  —  Plattform-Modul für EU-Parlament-Petitionen (PETI)
# =============================================================================
#
#  Scrapt die Petitionen des Petitionsportals des Europäischen Parlaments,
#  gefiltert auf Petitionen aus DEUTSCHLAND mit Status "AVAILABLE" (für
#  Unterstützer*innen offen). Nutzt petitions_core.py; Einstieg monitor.py.
#
#  QUELLEN (öffentliches Portal, server-gerendert, keine robots-Sperre):
#    - /petitions/en/show-petitions?countries=DE&statuses=AVAILABLE&page=N
#      (20 pro Seite, page 0-basiert; "results <N>" im HTML)
#    - /petitions/en/petition/content/html?petitionNumber=NNNN%252FYYYY
#      (Achtung: der Schrägstrich der Petitionsnummer ist DOPPELT kodiert)
#
#  BESONDERHEITEN:
#  - Es gibt KEINE öffentliche Unterstützerzahl → signatures bleibt leer.
#  - Titel-Muster: "Petition No 0232/2026 by T. A. (German) on <Thema>"
#    → daraus werden Petent*in ("T. A. (German)") und Thema extrahiert.
#  - "Topics" der Detailseite wird als Kategorie übernommen.
#  - Startdatum ≈ Jahr aus der Petitionsnummer (01.01.).
#  - Slug = "NNNN-YYYY" (aus der Petitionsnummer).
# =============================================================================

from __future__ import annotations

import re
from html import unescape as html_unescape
from pathlib import Path

from bs4 import BeautifulSoup

import petitions_core as core
from petitions_core import Platform, log, now_iso, prog

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://www.europarl.europa.eu"
DATA_FILE = Path("europarl_petitions.json")
HTML_FILE = Path("europarl_petitions.html")

# Paginierung läuft über ein WACHSENDES pageSize ("Load more"-Button), nicht
# über page=N (das wird ignoriert). Daher direkt mit großem pageSize anfragen
# und bei Bedarf weiter erhöhen.
LIST_URL = (f"{BASE_URL}/petitions/en/show-petitions?keyWords=&_years=1"
            "&_searchThemes=1&_statuses=1&statuses=AVAILABLE&_countries=1"
            "&countries=DE&searchRequest=true&resSize=20&pageSize={size}")
PAGE_SIZE_START = 200
PAGE_SIZE_MAX   = 1000

NUMBER_HREF_RE = re.compile(r"petitionNumber=(\d{4})%25?2F(\d{4})")
TITLE_RE = re.compile(
    r"Petition No\s+(\d{4}/\d{4})\s+by\s+(.+?)\s+on\s+(.+)", re.S)

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
}


def _detail_url(slug: str) -> str:
    num, year = slug.split("-")
    return (f"{BASE_URL}/petitions/en/petition/content/html?"
            f"petitionNumber={num}%252F{year}")


# ----------------------------------------------------------------------------
# Entdeckung
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: {}} aus der DE-Suche (Status AVAILABLE); pageSize wird erhöht,
    bis keine neuen Treffer mehr kommen."""
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=0, message="Sammle Petitionen …")
    size = PAGE_SIZE_START
    while size <= PAGE_SIZE_MAX:
        resp = fetcher.get(LIST_URL.format(size=size))
        if resp is None or not resp.ok:
            break
        added = 0
        for m in NUMBER_HREF_RE.finditer(resp.text):
            slug = f"{m.group(1)}-{m.group(2)}"
            if slug not in found:
                found[slug] = {}
                added += 1
        prog(current=len(found), total=0,
             message=f"pageSize {size} · {len(found)} Petitionen bisher")
        if added == 0 or len(found) < size:
            break                        # alle Ergebnisse erfasst
        size *= 2
    log(f"Suche: {len(found)} deutsche Petitionen (AVAILABLE).")
    return found


# ----------------------------------------------------------------------------
# Detailseite parsen
# ----------------------------------------------------------------------------
def parse_detail(html: str, url: str, slug: str) -> dict:
    """Die Detailseite hat kaum nutzbare CSS-Klassen; geparst wird über die
    Text-Segmente (get_text mit |-Trenner). Der Titel ist das erste Segment
    "Petition No …"; die Zusammenfassung folgt auf das ZWEITE Vorkommen der
    Überschrift "Petition Summary" (das erste gehört zur Kopf-Wiederholung)."""
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}
    text = soup.get_text("|", strip=True)
    segs = [s.strip() for s in text.split("|") if s.strip()]

    title_seg = next((s for s in segs if s.startswith("Petition No ")), None)
    m = TITLE_RE.match(title_seg) if title_seg else None
    if m:
        rec["title"] = f"Petition {m.group(1)}: {m.group(3).strip()[:250]}"
        rec["started_by"] = m.group(2).strip()[:200]
    else:
        rec["title"] = f"Petition {slug.replace('-', '/')}"

    # Feld-Paare ("Topics|:|Wert") aus dem Fließtext ziehen.
    def field(label: str) -> str | None:
        m2 = re.search(rf"{label}\|:\|+([^|]+)", text)
        return m2.group(1).strip() if m2 else None

    rec["category"] = field("Topics")
    status_seg = next((s for s in segs if s.startswith("Status:")), "")
    status_txt = status_seg.removeprefix("Status:").strip()

    # Zusammenfassung. Die Überschrift "Petition Summary" steht MEHRFACH auf der
    # Seite: einmal im Sprungmenü am Kopf, einmal über dem eigentlichen Text.
    # Auf das erste Vorkommen folgt der Titel der Petition ("Petition No …"),
    # und der ist mit über 120 Zeichen lang genug, um die frühere Suche schon
    # dort zu beenden — gespeichert wurde dann der Titel statt der
    # Zusammenfassung. Nachgewiesen am 3.8.26 an 0474/2026: in der App stand
    # als Kurzbeschreibung wörtlich die Überschrift.
    # Jetzt werden ALLE Vorkommen eingesammelt, Titelwiederholungen verworfen
    # und der längste Rest genommen; die eigentliche Zusammenfassung ist auf
    # dieser Seite immer der längste Textblock.
    kandidaten: list[str] = []
    for i, s in enumerate(segs):
        if s != "Petition Summary":
            continue
        for t in segs[i + 1:i + 5]:
            if len(t) > 120 and not t.startswith("Petition No "):
                kandidaten.append(t)
    summary = max(kandidaten, key=len) if kandidaten else None
    # Der Text ist auf der Seite DOPPELT maskiert ("&amp;#39;" im Quelltext).
    # get_text() löst eine Stufe auf, übrig bleibt sichtbares "&#39;" mitten im
    # Satz. Die zweite Stufe deshalb hier.
    if summary and "&" in summary:
        summary = html_unescape(summary)
    if summary:
        rec["description_full"] = f"<p>{core._esc(summary)}</p>"
        rec["summary"] = (summary[:200] + "…") if len(summary) > 200 else summary

    rec["recipient"] = "Petitionsausschuss des Europäischen Parlaments (PETI)"
    year = slug.split("-")[1]
    rec["start_date"] = f"{year}-01-01"
    rec["url"] = url
    rec["kind"] = "petition"
    if status_txt:
        rec["updates"] = [{"timestamp": now_iso()[:19],
                           "text": f"Status: {status_txt}"}]
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    url = _detail_url(slug)
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    # Ein 200 OHNE Petitionsinhalt ist kein Beleg für "verschwunden": das
    # Portal liefert bei Störungen/Sperren ebenfalls 200 mit Fehlerseite.
    # Solche Antworten daher als Fehler behandeln (Datensatz unverändert),
    # NICHT als offline – sonst kippt ein Ausfall den ganzen Bestand.
    if "Petition No" not in resp.text:
        log(f"  unerwartete Antwort für {slug} (kein Petitionstext) – "
            "als Fehler gewertet, Datensatz bleibt unverändert.")
        return "error", None
    return "online", parse_detail(resp.text, url, slug)


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, DATA_FILE, extra_meta=extra, quiet=quiet)

    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte Petition(en) …")
        prog(phase="check-known", current=0, total=len(known),
             message="Prüfe bekannte Petitionen …")
        for k, slug in enumerate(known, 1):
            prog(current=k, total=len(known), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        _detail_url(slug))
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")

    log("Sammle deutsche Petitionen (Status AVAILABLE) …")
    discovered = discover_slugs(fetcher)
    new_slugs = [s for s in discovered if s not in store]
    if args.limit:
        new_slugs = new_slugs[:args.limit]
    log(f"{len(new_slugs)} neue Petitionen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_slugs),
         message="Beginne Scrape …")

    for i, slug in enumerate(new_slugs, 1):
        log(f"({i}/{len(new_slugs)}) {slug}")
        prog(current=i, total=len(new_slugs), message=slug)
        status, rec = scrape_petition(fetcher, slug)
        if status == "error":
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts, _detail_url(slug))
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(PLATFORM)
    log("Fertig (Europäisches Parlament).")


def check(fetcher):
    return core.check_source(fetcher, LIST_URL.format(size=20), NUMBER_HREF_RE, 10,
                             "DE-Petitionen")

PLATFORM = Platform(
    key="europarl",
    language="en",   # PETI-Petitionstexte sind auf Englisch
    openness=4,
    openness_note="Offen: offizielle Suche mit Länder-/Statusfilter, server-"
                  "gerendert; Eigenheiten (Load-more-Paginierung, doppelt kodierte "
                  "URLs) und keine öffentliche Unterstützerzahl.",
    name="Europäisches Parlament",
    eyebrow="EU-Parlament (PETI) · Petitionen aus Deutschland, offen zur Unterstützung",
    source_url="https://www.europarl.europa.eu/petitions/en/home",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
