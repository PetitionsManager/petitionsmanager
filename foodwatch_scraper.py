#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  foodwatch_scraper.py  —  Plattform-Modul für foodwatch-Mitmach-Aktionen
# =============================================================================
#
#  Scrapt die Mitmach-Aktionen (E-Mail-Aktionen/Petitionen) von
#  foodwatch.org/de. Nutzt petitions_core.py; Einstieg monitor.py.
#
#  QUELLEN (robots.txt erlaubt alles außer Suche/Privatem; Sitemap vorhanden):
#    - https://www.foodwatch.org/de/mitmachen              Übersicht
#    - https://www.foodwatch.org/de/mitmachen/<slug>       Detailseite
#
#  BESONDERHEITEN:
#  - TYPO3, komplett server-gerendert. Unterschriftenzähler steht direkt im
#    Formular: <p id="form-counter" class="count">401358</p>.
#  - Aktionsseiten OHNE Zähler (z. B. reine Info-/Newsletter-Seiten) werden
#    übersprungen ("skip") bzw. aus dem Bestand entfernt.
#  - Kein Sammelziel und kein Startdatum öffentlich → goal/start_date leer.
#  - Initiator ist immer foodwatch selbst.
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
BASE_URL  = "https://www.foodwatch.org"
LIST_URL  = f"{BASE_URL}/de/mitmachen"
DATA_FILE = Path("foodwatch_petitions.json")
HTML_FILE = Path("foodwatch_petitions.html")

ACTION_HREF_RE = re.compile(r'href="(/de/mitmachen/[a-z0-9\-]+)"')
# Eine Aktionsseite hat unterhalb von /de/mitmachen noch ein Wegstück; die
# Übersicht selbst hat keins. Maßstab für core.eigene_adresse.
DETAILADRESSE_RE = re.compile(r"/de/mitmachen/[^/?#]+", re.I)

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


# ----------------------------------------------------------------------------
# Entdeckung
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: {}} von der Mitmachen-Übersicht."""
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=1, message="Lade Übersicht …")
    resp = fetcher.get(LIST_URL)
    if resp is not None and resp.ok:
        for m in ACTION_HREF_RE.finditer(resp.text):
            slug = m.group(1).rsplit("/", 1)[-1]
            found.setdefault(slug, {})
    log(f"Übersicht: {len(found)} Aktionen gefunden.")
    prog(current=1, total=1,
         message=f"Übersicht geprüft · {len(found)} Aktionen")
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


def parse_detail(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    h1 = soup.find("h1")
    rec["title"] = (h1.get_text(" ", strip=True) if h1
                    else _meta(soup, "og:title"))
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    # Nur eine echte Aktionsseite darf die angefragte Adresse ersetzen — siehe
    # core.eigene_adresse. Dieselbe ungeprüfte Übernahme hat bei WeAct und bei
    # Avaaz je einen Schwung Phantomsätze mit gemeinsamer Adresse erzeugt.
    # foodwatch antwortet heute sauber mit 404 (8.8.2026 gemessen: HTTP 404,
    # canonical auf …/de/sorry-die-seite…), der Riegel ist hier Vorsorge.
    canon = soup.find("link", rel="canonical")
    rec["url"] = core.eigene_adresse(
        (canon.get("href") if canon else None) or _meta(soup, "og:url"), url,
        DETAILADRESSE_RE)

    counter = soup.select_one("#form-counter")
    if counter:
        digits = re.sub(r"\D", "", counter.get_text())
        if digits:
            rec["signatures"] = int(digits)

    content = soup.select_one("section.document-content__content")
    if content:
        for bad in content.select("form, script, style"):
            bad.decompose()
        # Hover-Dubletten weg. foodwatch legt zu jeder Kachelbeschriftung eine
        # zweite mit der Endung "--hover" ins HTML und tauscht sie per CSS aus.
        # Im bereinigten Text steht davon nichts mehr im Weg – dort stand
        # jeder Name schlicht zweimal ("Deutschland Deutschland" im Block
        # "Eine gemeinsame Aktion von").
        for dub in content.select('[class*="--hover"]'):
            dub.decompose()
        rec["description_full"] = sanitize_fragment(content, BASE_URL) or None

    rec["started_by"] = "foodwatch"
    rec["kind"] = "petition"
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error | skip.
    skip = Seite ohne Unterschriften-Formular (keine Mitzeichnungs-Aktion)."""
    url = f"{LIST_URL}/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    rec = parse_detail(resp.text, url)
    if rec.get("signatures") is None:
        return "skip", None
    return "online", rec


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
        log(f"Prüfe {len(known_slugs)} bekannte Aktion(en) …")
        prog(phase="check-known", current=0, total=len(known_slugs),
             message="Prüfe bekannte Aktionen …")
        for k, slug in enumerate(known_slugs, 1):
            prog(current=k, total=len(known_slugs), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            if status == "skip":
                del store[slug]
                log(f"  ENTFERNT (kein Unterschriften-Formular mehr): {slug}")
                save()
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{LIST_URL}/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")

    log("Sammle Aktionen von der Mitmachen-Übersicht …")
    discovered = discover_slugs(fetcher)
    known_set = set(known_slugs)
    new_slugs = [s for s in discovered if s not in known_set]
    if args.limit:
        new_slugs = new_slugs[:args.limit]
    log(f"{len(new_slugs)} neue Aktionen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_slugs),
         message="Beginne Scrape …")

    for i, slug in enumerate(new_slugs, 1):
        log(f"({i}/{len(new_slugs)}) {slug}")
        prog(current=i, total=len(new_slugs), message=slug)
        status, rec = scrape_petition(fetcher, slug)
        if status == "error":
            continue
        if status == "skip":
            log("  übersprungen (keine Mitzeichnungs-Aktion).")
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts, f"{LIST_URL}/{slug}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Aktion(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(PLATFORM)
    log("Fertig (foodwatch).")


def check(fetcher):
    return core.check_source(fetcher, LIST_URL, ACTION_HREF_RE, 3, "Aktionen")

PLATFORM = Platform(
    key="foodwatch",
    openness=5,
    openness_note="Sehr offen: komplette Aktionsliste, Zähler und Volltexte direkt "
                  "im server-gerenderten HTML, robots.txt erlaubt praktisch alles.",
    name="foodwatch",
    eyebrow="foodwatch · Mitmach-Aktionen (deutsch)",
    source_url="https://www.foodwatch.org/de/mitmachen",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
