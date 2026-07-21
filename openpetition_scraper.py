#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  openpetition_scraper.py  —  Plattform-Modul für OpenPetition (deutsch)
# =============================================================================
#
#  Scrapt die laufenden Petitionen von openpetition.de. Nutzt
#  petitions_core.py; Einstiegspunkt ist monitor.py.
#
#  QUELLEN (robots.txt ist großzügig: nur Verwaltungs-/Untertabs wie
#  /petition/unterzeichner/, /petition/kommentare/ sind gesperrt – die werden
#  hier nicht angefasst; Crawl-delay 1 s wird über REQUEST_DELAY eingehalten):
#    - https://www.openpetition.de/petitionen?seite=N   Liste (18 pro Seite,
#      ~90+ Seiten), Stopp sobald eine Seite keine neuen Slugs liefert
#    - https://www.openpetition.de/petition/online/<slug>   Detailseite
#
#  BESONDERHEITEN:
#  - Detailseiten sind vollständig server-gerendert – Stand, Ziel, Status,
#    Text stehen direkt im HTML (kein XHR nötig).
#  - .progress-box: "470.240 Unterschriften 94 % 500.000 für Sammelziel"
#    → Unterschriften + Sammelziel.
#  - Statusleiste: "Gestartet Januar 2025 …" → Startdatum (Monatsgenau).
#  - .petition-description: Petitionstext; erste Zeile "Petition richtet
#    sich an: <Empfänger>" wird als Adressat extrahiert. Die "Begründung"
#    steht in einem weiteren .unfold-container-text direkt darunter.
#  - Starter*in: "Vielen Dank für Ihre Unterstützung, <Name>".
#  - Kategorie: Link /petitionen?category=<id> auf der Detailseite.
#  - VOLLBESTAND ist groß (~1.600 laufende Petitionen). Der Erst-Backfill
#    dauert entsprechend (Crawl-delay!); Folge-Läufe prüfen erst den Bestand
#    und scrapen dann nur Neues.
# =============================================================================

from __future__ import annotations

import re
from pathlib import Path

from bs4 import BeautifulSoup

import petitions_core as core
from petitions_core import Platform, log, now_iso, prog, sanitize_fragment

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://www.openpetition.de"
LIST_URL  = f"{BASE_URL}/petitionen"
DATA_FILE = Path("openpetition_petitions.json")
HTML_FILE = Path("openpetition_petitions.html")

MAX_LIST_PAGES = 200            # Sicherheitslimit für die Paginierung

PETITION_HREF_RE = re.compile(r"/petition/online/([a-z0-9\-]+)")
CATEGORY_RE = re.compile(r"/petitionen\?category=(\d+)")
# "470.240 Unterschriften" bzw. "500.000 für Sammelziel"
SIG_RE  = re.compile(r"([\d.]+)\s*Unterschrift", re.I)
GOAL_RE = re.compile(r"([\d.]+)\s*für Sammelziel", re.I)
STARTED_RE = re.compile(r"Gestartet\s+([A-Za-zäöü]+)\s+(\d{4})")
STARTER_RE = re.compile(r"Vielen Dank für Ihre Unterstützung,\s*(.+?)\s*$")
RECIPIENT_RE = re.compile(r"Petition richtet sich an:\s*(.+)", re.S)

GERMAN_MONTHS = {"januar": 1, "februar": 2, "märz": 3, "april": 4, "mai": 5,
                 "juni": 6, "juli": 7, "august": 8, "september": 9,
                 "oktober": 10, "november": 11, "dezember": 12}

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


# ----------------------------------------------------------------------------
# Entdeckung der Petitionen
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: {}} aus der paginierten Gesamtliste. Stoppt, sobald eine Seite
    keine NEUEN Slugs mehr liefert (Seiten dahinter wiederholen Seite 1)."""
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=0, message="Sammle Petitionen …")

    page = 1
    while page <= MAX_LIST_PAGES:
        url = LIST_URL if page == 1 else f"{LIST_URL}?seite={page}"
        resp = fetcher.get(url)
        if resp is None or not resp.ok:
            break
        added = 0
        for m in PETITION_HREF_RE.finditer(resp.text):
            slug = m.group(1)
            if slug not in found:
                found[slug] = {}
                added += 1
        if added == 0:
            break
        prog(current=page, total=0,
             message=f"Listenseite {page} · {len(found)} Petitionen bisher")
        page += 1

    log(f"Liste: {len(found)} Petitionen auf {page - 1} Seiten.")
    return found


# ----------------------------------------------------------------------------
# Detailseite parsen
# ----------------------------------------------------------------------------
def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    tag = (soup.find("meta", property=prop)
           or soup.find("meta", attrs={"name": prop}))
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def _num(s: str) -> int:
    return int(re.sub(r"\D", "", s) or 0)


def parse_detail(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    h1 = soup.find("h1")
    rec["title"] = (h1.get_text(" ", strip=True) if h1
                    else (_meta(soup, "og:title") or "").removesuffix(
                        " - Online-Petition") or None)
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    canon = soup.find("link", rel="canonical")
    rec["url"] = (canon["href"].strip() if canon and canon.get("href")
                  else _meta(soup, "og:url") or url)

    # Adressat aus der "richtet sich an:"-Zeile.
    node = soup.find(string=re.compile(r"Petition richtet sich an:"))
    if node:
        host = node.find_parent(["p", "div", "span"])
        m = RECIPIENT_RE.search(host.get_text(" ", strip=True)) if host else None
        if m:
            rec["recipient"] = m.group(1).strip()[:300] or None

    # Petitionstext + Begründung: .petition-description und .petition-reason
    # (mit <h4>Begründung</h4> dazwischen); Adressat-Zeile entfernen.
    parts = []
    desc = soup.select_one(".petition-description")
    if desc:
        for p in desc.find_all("p"):
            if "richtet sich an" in p.get_text():
                p.decompose()
                break
        parts.append(sanitize_fragment(desc, BASE_URL))
    reason = soup.select_one(".petition-reason")
    if reason:
        parts.append("<h3>Begründung</h3>")
        parts.append(sanitize_fragment(reason, BASE_URL))
    rec["description_full"] = "\n".join(p for p in parts if p) or None

    # Starter*in aus der Initiator-Box unter der Überschrift.
    ib = soup.select_one(".initiator-information-box")
    if ib:
        rec["started_by"] = ib.get_text(" ", strip=True)[:200] or None

    # Kategorie über den category-Link der Detailseite.
    cat_link = soup.find("a", href=CATEGORY_RE)
    if cat_link:
        name = cat_link.get_text(" ", strip=True)
        if name:
            rec["category"] = name
            rec["category_url"] = core.urljoin(BASE_URL, cat_link["href"])

    # Unterschriften + Sammelziel aus der Fortschrittsbox.
    box = soup.select_one(".progress-box")
    if box:
        text = box.get_text(" ", strip=True)
        m = SIG_RE.search(text)
        if m:
            rec["signatures"] = _num(m.group(1))
        m = GOAL_RE.search(text)
        if m:
            rec["goal"] = _num(m.group(1))

    # Startdatum (monatsgenau) aus der Statusleiste.
    bar = soup.select_one(".module-petition-status-bar")
    if bar:
        m = STARTED_RE.search(bar.get_text(" ", strip=True))
        if m and m.group(1).lower() in GERMAN_MONTHS:
            rec["start_date"] = (f"{int(m.group(2)):04d}-"
                                 f"{GERMAN_MONTHS[m.group(1).lower()]:02d}-01")
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error."""
    url = f"{BASE_URL}/petition/online/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    return "online", parse_detail(resp.text, url)


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, DATA_FILE, extra_meta=extra, quiet=quiet)

    known_slugs = list(store.keys())
    if known_slugs and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known_slugs)} bekannte Petition(en) …")
        prog(phase="check-known", current=0, total=len(known_slugs),
             message="Prüfe bekannte Petitionen …")
        for k, slug in enumerate(known_slugs, 1):
            prog(current=k, total=len(known_slugs), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/petition/online/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
    elif args.no_recheck:
        log("Prüfung bekannter Petitionen übersprungen (--no-recheck).")

    log("Sammle Petitions-Slugs aus der Gesamtliste …")
    discovered = discover_slugs(fetcher)
    known_set = set(known_slugs)
    new_slugs = [s for s in discovered if s not in known_set]
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
            log("  übersprungen (Fehler) – Datensatz bleibt unverändert.")
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts,
                    f"{BASE_URL}/petition/online/{slug}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")
    else:
        log("Keine neuen Petitionen seit dem letzten Lauf gefunden.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions)
    core.write_list_html(PLATFORM)
    log("Fertig (OpenPetition).")


PLATFORM = Platform(
    key="openpetition",
    openness=5,
    openness_note="Vorbildlich: vollständige öffentliche Liste (~1.600, paginiert), "
                  "alles server-gerendert (Stand, Ziel, Status, Volltext), "
                  "großzügige robots.txt mit Sitemap.",
    name="OpenPetition",
    eyebrow="OpenPetition · laufende Petitionen (deutsch)",
    source_url="https://www.openpetition.de/petitionen",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
