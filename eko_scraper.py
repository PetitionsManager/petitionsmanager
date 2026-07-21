#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  eko_scraper.py  —  Plattform-Modul für Eko (ehem. SumOfUs), deutsch
# =============================================================================
#
#  Scrapt die deutschen Kampagnen von eko.org (Aktions-Host actions.eko.org,
#  Champaign-Plattform). Nutzt petitions_core.py; Einstieg monitor.py.
#
#  QUELLEN (robots.txt: eko.org sperrt /admin/ + /api/, actions.eko.org nur
#  /a/*/follow-up – die Aktionsseiten selbst sind frei):
#    - https://eko.org/de/campaigns              kuratierte deutsche Liste
#    - https://actions.eko.org/a/<slug>          Detailseite
#
#  BESONDERHEITEN:
#  - Es existiert eine Gesamt-Sitemap (actions.eko.org/sitemap/prosecco.txt,
#    ~8.000 URLs), aber OHNE Sprachkennung – alle Sprachen gemischt. Die
#    Discovery nutzt deshalb die kuratierte deutsche Kampagnenliste;
#    Detailseiten werden zusätzlich per <html lang="de"> verifiziert
#    (andere Sprachen → "skip").
#  - Stand/Ziel stehen als eingebettetes Plugin-JSON im HTML:
#    "type":"ActionsThermometer" … "signatures":"128.011","goal_k":"150k"
#    (Zahl deutsch formatiert, Ziel als "<N>k").
#  - Reine Spenden-Kampagnen (nur DonationsThermometer, kein Unterschriften-
#    Thermometer) werden übersprungen – die Tabelle ist unterschriften-
#    zentriert.
#  - Startdatum ≈ frühestes "created_at" im Plugin-JSON.
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
WWW_URL   = "https://eko.org"
BASE_URL  = "https://actions.eko.org"
DATA_FILE = Path("eko_petitions.json")
HTML_FILE = Path("eko_petitions.html")

ACTION_HREF_RE = re.compile(r'https://actions?\.eko\.org/a/([a-z0-9\-]+)')
NON_ACTION_SLUGS = {"donate", "spende"}

# Die Kampagnen-Suche (eko.org/de/campaigns?query=…) ist serverseitig hart auf
# 27 Treffer gedeckelt – aber verschiedene Begriffe fördern verschiedene
# Kampagnen zutage. Union über viele deutsche Themenbegriffe hebt die
# Abdeckung deutlich über die 27 der reinen Kampagnen-Startseite.
SEARCH_TERMS = [
    "gegen", "stoppt", "rettet", "schutz", "klima", "wasser", "plastik",
    "wald", "meer", "tier", "bank", "steuer", "kinder", "gesundheit",
    "lebensmittel", "eu", "deutschland", "energie", "menschenrechte",
    "konzern", "pestizid", "fleisch", "regenwald", "soziales", "digital",
]

SIG_RE     = re.compile(r'"signatures":"([\d.,]+)"')
GOAL_K_RE  = re.compile(r'"goal_k":"(\d+)k"')
CREATED_RE = re.compile(r'"created_at":"(\d{4}-\d{2}-\d{2})')
NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)

# Ziel-Staffel für Seiten ohne explizites Ziel (neues Template liefert keins).
TARGETS = [1000, 2000, 5000, 10000, 25000, 50000, 75000, 100000,
           150000, 200000, 300000, 500000, 1000000]
TARGET_INCREMENT = 100000


def _goal_for(count: int) -> int:
    for t in TARGETS:
        if count < t:
            return t
    return ((count // TARGET_INCREMENT) + 1) * TARGET_INCREMENT

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
    """Kandidaten aus der Kampagnen-Startseite PLUS der Union vieler deutscher
    Suchbegriffe (die Suche cappt bei 27/Begriff, liefert aber je nach Begriff
    andere Kampagnen). Sprach-Verifikation erfolgt danach in parse_detail."""
    found: dict[str, dict] = {}
    sources = ["", *[f"?query={t}" for t in SEARCH_TERMS]]
    total = len(sources)
    prog(phase="discover", current=0, total=total, message="Suche Kampagnen …")
    for i, qs in enumerate(sources, 1):
        resp = fetcher.get(f"{WWW_URL}/de/campaigns{qs}")
        if resp is not None and resp.ok:
            for m in ACTION_HREF_RE.finditer(resp.text):
                slug = m.group(1)
                if slug not in NON_ACTION_SLUGS:
                    found.setdefault(slug, {})
        label = "Startseite" if qs == "" else qs[7:]
        prog(current=i, total=total,
             message=f"„{label}“ · {len(found)} Kandidaten bisher")
    log(f"Kampagnen-Suche: {len(found)} eindeutige Aktionen gefunden.")
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


def parse_detail(html: str, url: str) -> dict | None:
    """None = keine deutsche Unterschriften-Aktion (skip).

    Eko hat ZWEI Templates: actions.eko.org (alt, Champaign-Server-HTML mit
    Thermometer-JSON) und action.eko.org (neu, Next.js – ältere Kampagnen
    werden dorthin umgeleitet; Daten in __NEXT_DATA__.props.pageProps)."""
    m_next = NEXT_DATA_RE.search(html)
    if m_next:
        try:
            props = (json.loads(m_next.group(1))
                     .get("props", {}).get("pageProps", {}))
        except ValueError:
            props = {}
        if props.get("title"):
            return _parse_next_template(props, html, url)

    return _parse_legacy_template(html, url)


def _parse_next_template(props: dict, html: str, url: str) -> dict | None:
    if props.get("language") != "de":
        return None
    count = props.get("action_count")
    if count is None:
        return None
    rec: dict = {}
    rec["title"] = props.get("title")
    rec["signatures"] = int(count)
    rec["goal"] = _goal_for(int(count))
    rec["summary"] = props.get("meta_description") or None
    created = props.get("created_at")
    if created:
        rec["start_date"] = str(created)[:10]
    content = props.get("content")
    if content:
        frag = BeautifulSoup(content, "html.parser")
        rec["description_full"] = sanitize_fragment(frag, BASE_URL) or None
        if not rec.get("summary"):
            text = frag.get_text(" ", strip=True)
            rec["summary"] = (text[:200] + "…") if len(text) > 200 else text
    soup = BeautifulSoup(html, "html.parser")
    rec["image_url"] = _meta(soup, "og:image")
    rec["url"] = url
    rec["started_by"] = "Eko"
    rec["kind"] = "petition"
    tags = [t.get("name") for t in props.get("tags") or []
            if isinstance(t, dict) and t.get("name")]
    rec["category"] = tags[0] if tags else None
    return rec


def _parse_legacy_template(html: str, url: str) -> dict | None:
    m_lang = re.search(r'<html[^>]*lang="([a-z]{2})"', html)
    if m_lang and m_lang.group(1) != "de":
        return None

    m_sig = SIG_RE.search(html)
    if not m_sig:
        return None                      # reine Spenden-/Info-Seite

    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}
    for ns in soup.find_all("noscript"):
        ns.decompose()

    h1 = soup.find("h1")
    rec["title"] = ((h1.get_text(" ", strip=True) if h1 else None)
                    or _meta(soup, "og:title"))
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    rec["url"] = url

    rec["signatures"] = int(re.sub(r"\D", "", m_sig.group(1)) or 0)
    m_goal = GOAL_K_RE.search(html)
    if m_goal:
        rec["goal"] = int(m_goal.group(1)) * 1000

    dates = sorted(CREATED_RE.findall(html))
    if dates:
        rec["start_date"] = dates[0]

    # Kampagnentext: Hauptspalte ohne Formular-/Sidebar-Anteile.
    content = soup.select_one(".center-content")
    if content:
        for bad in content.select(".petition-bar, form, script, style, "
                                  ".overlay-toggle, .fundraiser-bar"):
            bad.decompose()
        rec["description_full"] = sanitize_fragment(content, BASE_URL) or None

    rec["started_by"] = "Eko"
    rec["kind"] = "petition"
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error | skip."""
    url = f"{BASE_URL}/a/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    rec = parse_detail(resp.text, url)
    if rec is None:
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

    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte Aktion(en) …")
        prog(phase="check-known", current=0, total=len(known),
             message="Prüfe bekannte Aktionen …")
        for k, slug in enumerate(known, 1):
            prog(current=k, total=len(known), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            if status == "skip":
                del store[slug]
                log(f"  ENTFERNT (keine deutsche Unterschriften-Aktion): {slug}")
                save()
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/a/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")

    log("Sammle Aktionen von der deutschen Kampagnenliste …")
    discovered = discover_slugs(fetcher)
    new_slugs = [s for s in discovered if s not in store]
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
            log("  übersprungen (keine deutsche Unterschriften-Aktion).")
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts, f"{BASE_URL}/a/{slug}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Aktion(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions)
    core.write_list_html(PLATFORM)
    log("Fertig (Eko).")


PLATFORM = Platform(
    key="eko",
    openness=3,
    openness_note="Mittel: deutsche Kampagnen über Startseite + Suche "
                  "(je Begriff auf 27 gedeckelt → Union vieler Begriffe) "
                  "abgedeckt; zwei Seiten-Templates, Gesamt-Sitemap ohne "
                  "Sprachkennung — Vollständigkeit nicht garantiert.",
    name="Eko",
    eyebrow="Eko · Kampagnen (deutsch)",
    source_url="https://eko.org/de/campaigns",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
