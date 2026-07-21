#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  innnit_scraper.py  —  Plattform-Modul für Innn.it (ehem. Change.org DE)
# =============================================================================
#
#  Scrapt ALLE Petitionen von innn.it über das interne Listen-API der
#  Next.js-App. Nutzt petitions_core.py; Einstieg monitor.py.
#
#  DATENQUELLE (per Reverse-Engineering der App-Chunks gefunden; Basis ist
#  NEXT_PUBLIC_INNNIT_URL + "/api", Routen in _app.js):
#    GET /api/v2/posts/initiatives?limit=100&offset=N&type=petition
#        &sort=createdAt
#    → {"data": [signable, …], "meta": {"totalCount": ~1900}}
#  Jedes signable ist VOLLSTÄNDIG (title, name=slug, content-HTML,
#  signatureCount, initiators, targets, tag=Kategorie, createdAt,
#  featuredImage, success/initiativeStatus) – Einzelseiten-Abrufe sind für
#  die Massenerfassung nicht nötig.
#
#  WEITERE ERKENNTNISSE:
#  - Detailseiten (https://innn.it/<slug>) sind SSR mit identischem
#    signable-JSON in __NEXT_DATA__ → dient als Fallback/Offline-Prüfung
#    für Petitionen, die aus dem API-Bestand verschwinden.
#  - robots.txt liefert die SPA-Shell (kein echtes robots.txt) → keine
#    maschinenlesbaren Sperren deklariert; /api/ ist damit ebenfalls nicht
#    gesperrt (anders als z. B. bei Avaaz).
#  - Suchfunktion der Seite (/external-search) ist nur eine Google-CSE-
#    Weiterleitung, kein eigenes API.
# =============================================================================

from __future__ import annotations

import json
import re
from pathlib import Path

import petitions_core as core
from petitions_core import Platform, log, now_iso, prog

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://innn.it"
API_URL   = (f"{BASE_URL}/api/v2/posts/initiatives"
             "?limit={limit}&offset={offset}&type=petition&sort=createdAt")
API_LIMIT = 100
MAX_API_PAGES = 60                 # Sicherheitslimit (~6.000 Petitionen)

DATA_FILE = Path("innnit_petitions.json")
HTML_FILE = Path("innnit_petitions.html")

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


# ----------------------------------------------------------------------------
# signable-JSON → Datensatz (gilt für API-Items UND Detailseiten-JSON)
# ----------------------------------------------------------------------------
def record_from_signable(sig: dict) -> dict:
    rec: dict = {}
    rec["title"] = sig.get("title")
    rec["petition_id"] = sig.get("id") or sig.get("_id")
    slug = sig.get("name")
    rec["url"] = f"{BASE_URL}/{slug}" if slug else None

    content = sig.get("content")
    if content:
        from bs4 import BeautifulSoup
        frag = BeautifulSoup(content, "html.parser")
        rec["description_full"] = core.sanitize_fragment(frag, BASE_URL) or None
        text = frag.get_text(" ", strip=True)
        rec["summary"] = (text[:200] + "…") if len(text) > 200 else text or None

    inits = [i.get("displayName") for i in sig.get("initiators") or []
             if isinstance(i, dict) and i.get("displayName")]
    rec["started_by"] = ", ".join(inits)[:200] or None
    targets = [t.get("name") for t in sig.get("targets") or []
               if isinstance(t, dict) and t.get("name")]
    rec["recipient"] = ", ".join(targets)[:300] or None

    tag = sig.get("tag") or {}
    rec["category"] = tag.get("title")

    count = sig.get("signatureCount")
    if count is not None:
        rec["signatures"] = int(count)
    target = sig.get("signatureTarget")
    if target:
        rec["goal"] = int(target)

    created = sig.get("createdAt")
    if created:
        rec["start_date"] = str(created)[:19]

    img = (sig.get("featuredImage") or {}).get("urls") or {}
    rec["image_url"] = img.get("original") or img.get("lg") or None

    rec["kind"] = "petition"
    if sig.get("success"):
        rec["category"] = (rec["category"] + " · Erfolg" if rec["category"]
                           else "Erfolg")
    return rec


# ----------------------------------------------------------------------------
# Detailseite (Fallback: Offline-Prüfung nicht mehr gelisteter Petitionen)
# ----------------------------------------------------------------------------
def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    url = f"{BASE_URL}/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    m = NEXT_DATA_RE.search(resp.text)
    if not m:
        return "offline", None
    try:
        props = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
    except ValueError:
        return "error", None
    sig = props.get("signable")
    if not sig or props.get("hasError"):
        return "offline", None
    return "online", record_from_signable(sig)


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, DATA_FILE, extra_meta=extra, quiet=quiet)

    # Gesamtbestand über das Listen-API einsammeln (voll paginiert).
    log("Lade Gesamtbestand über /api/v2/posts/initiatives …")
    prog(phase="discover", current=0, total=0, message="Lade API-Seiten …")
    seen: set[str] = set()
    offset, total_count, page = 0, None, 0
    while page < MAX_API_PAGES:
        resp = fetcher.get(API_URL.format(limit=API_LIMIT, offset=offset))
        if resp is None or not resp.ok:
            break
        try:
            data = json.loads(resp.text)
        except ValueError:
            break
        items = data.get("data") or []
        total_count = (data.get("meta") or {}).get("totalCount", total_count)
        if not items:
            break
        for sig in items:
            slug = sig.get("name")
            if not slug or slug in seen:
                continue
            seen.add(slug)
            core.upsert(store, slug, record_from_signable(sig), {},
                        "online", ts, f"{BASE_URL}/{slug}")
        save()
        page += 1
        offset += API_LIMIT
        prog(current=len(seen), total=total_count or 0,
             message=f"API-Seite {page} · {len(seen)} Petitionen")
        if args.limit and len(seen) >= args.limit:
            break
        if total_count is not None and offset >= total_count:
            break
    log(f"API: {len(seen)} Petitionen übernommen "
        f"(gemeldeter Gesamtbestand: {total_count}).")

    # Bekannte Einträge, die nicht mehr im API auftauchen → direkt prüfen.
    missing = [s for s in store if s not in seen]
    if missing and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(missing)} nicht mehr gelistete Petition(en) …")
        prog(phase="check-known", current=0, total=len(missing),
             message="Prüfe fehlende Petitionen …")
        for k, slug in enumerate(missing, 1):
            prog(current=k, total=len(missing), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions)
    core.write_list_html(PLATFORM)
    log("Fertig (Innn.it).")


PLATFORM = Platform(
    key="innnit",
    name="Innn.it",
    eyebrow="Innn.it · alle Petitionen (via internem Listen-API)",
    source_url="https://innn.it/",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    openness=3,
    openness_note="Mittel: vollständige Liste existiert, aber nur über ein "
                  "verstecktes internes API (per Reverse-Engineering gefunden); "
                  "keine Sitemap, Suche nur als Google-Weiterleitung. Dafür "
                  "liefert das API komplette Datensätze inkl. Volltext.",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
