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

import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

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
def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    tag = (soup.find("meta", property=prop)
           or soup.find("meta", attrs={"name": prop}))
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def parse_detail(html: str, url: str, page: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    # Das erste h1 der Seite steckt in <noscript> ("JavaScript is disabled")
    # – noscript-Inhalte komplett ignorieren.
    for ns in soup.find_all("noscript"):
        ns.decompose()
    h1 = soup.find("h1")
    rec["title"] = (h1.get_text(" ", strip=True) if h1
                    else _meta(soup, "og:title"))
    rec["image_url"] = _meta(soup, "og:image")
    rec["url"] = url

    parts = []
    art = soup.find("article")
    if art:
        parts.append(sanitize_fragment(art, BASE_URL))
    why = soup.select_one(".why-is-important--text")
    if why:
        parts.append("<h3>Warum ist das wichtig?</h3>")
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
    sig = fetch_progress(fetcher, page)
    if sig is not None:
        rec["signatures"] = sig
        rec["goal"] = _goal_for(sig)
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

    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte Kampagne(n) …")
        prog(phase="check-known", current=0, total=len(known),
             message="Prüfe bekannte Kampagnen …")
        for k, page in enumerate(known, 1):
            prog(current=k, total=len(known), message=page)
            if core.skip_recent(store.get(page), args):
                continue
            status, rec = scrape_petition(fetcher, page)
            if status == "error":
                continue
            core.upsert(store, page, rec or {}, {}, status, ts,
                        f"{BASE_URL}/sign/{page}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {page}")

    log("Sammle Kampagnen (Startseite + Übersicht) …")
    discovered = discover_slugs(fetcher)
    new_pages = [p for p in discovered if p not in store]
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
        if status == "error":
            continue
        core.upsert(store, page, rec or {}, {}, status, ts,
                    f"{BASE_URL}/sign/{page}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Kampagne(n) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions)
    core.write_list_html(PLATFORM)
    log("Fertig (WeMove Europe).")


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
)


if __name__ == "__main__":
    import monitor
    monitor.main()
