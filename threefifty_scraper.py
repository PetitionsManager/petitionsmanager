#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  threefifty_scraper.py  —  Plattform-Modul für 350.org (deutsch)
# =============================================================================
#
#  Scrapt die deutschen Klima-Aktionen von 350.org – standardmäßig Region
#  EUROPA + Sprache DEUTSCH. Nutzt petitions_core.py; Einstieg monitor.py.
#
#  ENTDECKUNG (im Seiten-JS von /de/mitmachen/ gefunden):
#    350.org/de/mitmachen/ hat KEINE serverseitige Aktionsliste – die Karten
#    lädt eine externe JSON-API:
#      GET https://getinvolved350.vercel.app/?region=<Region>&time_filter=<Stufe>
#          &lang_code=Language: German
#      → { "<page_id>": {url,title,description,button_cta,image}, … }
#    Zeitstufen: "Get involved page: low|medium|high bar" (alle drei = Vollset).
#
#  DETAIL/ZÄHLER:
#    Jede Aktion zeigt auf act.350.org/cms/view_by_page_id/<id>, das auf die
#    eigentliche Seite weiterleitet (/sign/<slug> oder /act/<slug>). Der
#    Unterschriftenstand kommt über act.350.org/progress/<slug> (JSONP
#    onProgressLoaded → total.actions + goal) – identisch zu WeMove.
#
#  ROBOTS (act.350.org: Disallow /act/, /login/, /share/, /cms/unsubscribe):
#    /sign/, /progress/ und /cms/view_by_page_id sind erlaubt. Die eigentliche
#    Aktions-Seite wird NIE geladen – der Slug wird nur aus dem Redirect-Header
#    "Location" gelesen (ohne die evtl. gesperrte /act/-Seite abzurufen); der
#    Zähler läuft über den separat erlaubten /progress/-Endpunkt.
#    getinvolved350.vercel.app hat keine robots-Einschränkung.
#
#  FORMAT-KENNZEICHNUNG:
#    350.org-Aktionen sind teils Petitionen, teils E-Mail-/Brief-Aktionen. Das
#    Format wird aus Button-Text + Titel abgeleitet und als Kategorie gesetzt
#    (Petition / E-Mail-Aktion / Brief-Aktion / Aktion) → der Kategorie-Filter
#    der App wirkt als Format-Umschalter.
# =============================================================================

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlencode, urljoin

import petitions_core as core
from petitions_core import Platform, log, now_iso, prog

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://act.350.org"
API_URL   = "https://getinvolved350.vercel.app/"
DATA_FILE = Path("threefifty_petitions.json")
HTML_FILE = Path("threefifty_petitions.html")

# Deutschsprachig; zwei Regionsvarianten, weil keine allein alles kennt:
# "Region: Europe" liefert 21 Aktionen, das Weglassen des Parameters ebenfalls
# 21 – aber nur 16 davon sind dieselben. Zusammen 26. Die zwölf einzelnen
# Regionen (Africa, Worldwide, United States …) wurden am 2026-07-28 alle
# durchgemessen und brachten NULL zusätzliche Aktionen; sie zu fragen wäre nur
# Last ohne Ertrag. None = Parameter weglassen.
REGIONS   = ["Region: Europe", None]
LANG_CODE = "Language: German"
TIME_FILTERS = ["Get involved page: low bar",
                "Get involved page: medium bar",
                "Get involved page: high bar"]

PROGRESS_RE = re.compile(r"onProgressLoaded\((.*)\)\s*;?\s*$", re.S)
PAGE_ID_RE  = re.compile(r"view_by_page_id/(\d+)")
TARGET_RE   = re.compile(r"/(sign|act)/([^/?#]+)")

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "application/json, text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


# ----------------------------------------------------------------------------
# Format-Kennzeichnung (Petition / E-Mail / Brief / Aktion) aus CTA + Titel
# ----------------------------------------------------------------------------
def classify(obj: dict) -> str:
    t = ((obj.get("button_cta") or "") + " " + (obj.get("title") or "")).lower()
    # Petition zuerst prüfen: "unterschreiben" enthält "schreib" und würde sonst
    # fälschlich als Brief-Aktion gelten.
    if any(w in t for w in ("unterschreib", "unterzeichn", "petition",
                            "namen hinzu", "name hinzu")):
        return "Petition"
    if "brief" in t or "schreib" in t:
        return "Brief-Aktion"
    if any(w in t for w in ("nachricht", "verschick", "sende", "send", "mail")):
        return "E-Mail-Aktion"
    return "Aktion"


# ----------------------------------------------------------------------------
# Entdeckung über die JSON-API (alle drei Zeitstufen zusammenführen)
# ----------------------------------------------------------------------------
def _api_url(time_filter: str, region: str | None = REGIONS[0]) -> str:
    params = {"time_filter": time_filter, "lang_code": LANG_CODE}
    if region:
        params["region"] = region
    return API_URL + "?" + urlencode(params)


def _page_id(obj: dict) -> str | None:
    m = PAGE_ID_RE.search(obj.get("url") or "")
    return m.group(1) if m else None


def discover(fetcher: core.Fetcher) -> dict[str, dict]:
    """{page_id: api_obj} über alle Zeitstufen × Regionsvarianten (Deutsch)."""
    found: dict[str, dict] = {}
    abfragen = [(r, tf) for r in REGIONS for tf in TIME_FILTERS]
    prog(phase="discover", current=0, total=len(abfragen),
         message="Lade Aktionsliste (Deutsch) …")
    for i, (region, tf) in enumerate(abfragen, 1):
        resp = fetcher.get(_api_url(tf, region))
        added = 0
        if resp is not None and resp.ok:
            try:
                data = json.loads(resp.text)
            except ValueError:
                data = {}
            items = data.items() if isinstance(data, dict) else []
            for key, val in items:
                if key == "langcode" and isinstance(val, list):
                    for obj in val:
                        pid = _page_id(obj)
                        if pid and pid not in found:
                            found[pid] = obj; added += 1
                elif isinstance(val, dict) and val.get("url"):
                    pid = str(key) if str(key).isdigit() else _page_id(val)
                    if pid and pid not in found:
                        found[pid] = val; added += 1
        log(f"  {region or 'ohne Region'} / {tf}: +{added} (gesamt {len(found)}).")
        prog(current=i, total=len(abfragen),
             message=f"{len(found)} Aktionen bisher")
    return found


# ----------------------------------------------------------------------------
# Slug ermitteln (nur aus dem Redirect-Location, ohne die Zielseite zu laden)
# und Live-Zähler über /progress/
# ----------------------------------------------------------------------------
def resolve_target(fetcher: core.Fetcher, page_id: str) -> tuple[str | None, str | None]:
    """(kind, slug) aus der Weiterleitung von view_by_page_id. Liest nur den
    Location-Header – die (evtl. per robots gesperrte) Zielseite wird NICHT
    abgerufen."""
    url = f"{BASE_URL}/cms/view_by_page_id/{page_id}"
    for _ in range(4):
        if not fetcher.allowed(url):
            return None, None
        m = TARGET_RE.search(url)
        if m:
            return m.group(1), m.group(2)
        try:
            resp = fetcher.session.get(url, timeout=core.REQUEST_TIMEOUT,
                                       allow_redirects=False)
        except Exception:
            return None, None
        loc = resp.headers.get("Location")
        if not loc:
            return None, None
        url = urljoin(url, loc)
    m = TARGET_RE.search(url)
    return (m.group(1), m.group(2)) if m else (None, None)


def fetch_progress(fetcher: core.Fetcher, slug: str) -> tuple[int, int | None] | None:
    resp = fetcher.get(f"{BASE_URL}/progress/{slug}")
    if resp is None or not resp.ok:
        return None
    m = PROGRESS_RE.search(resp.text.strip())
    try:
        data = json.loads(m.group(1) if m else resp.text)
    except (ValueError, AttributeError):
        return None
    actions = (data.get("total") or {}).get("actions")
    if actions is None:
        return None
    goal = data.get("goal")
    goal = int(goal) if goal not in (None, 0, 1) else None
    return int(actions), goal


# ----------------------------------------------------------------------------
# Datensatz aus einem API-Objekt bauen
# ----------------------------------------------------------------------------
def build_rec(page_id: str, obj: dict) -> dict:
    rec: dict = {"kind": "petition", "started_by": "350.org",
                 "category": classify(obj)}
    if obj.get("title"):
        rec["title"] = obj["title"].strip()
    desc = (obj.get("description") or "").strip()
    if desc:
        rec["summary"] = (desc[:200] + "…") if len(desc) > 200 else desc
        rec["description_full"] = "<p>" + core._esc(desc) + "</p>"
    if obj.get("image"):
        rec["image_url"] = obj["image"]
    rec["url"] = obj.get("url") or f"{BASE_URL}/cms/view_by_page_id/{page_id}"
    return rec


def scrape_action(fetcher: core.Fetcher, page_id: str, obj: dict,
                  with_count: bool = True) -> tuple[str, dict]:
    rec = build_rec(page_id, obj)
    if with_count:
        _kind, slug = resolve_target(fetcher, page_id)
        if slug:
            prog_data = fetch_progress(fetcher, slug)
            if prog_data:
                rec["signatures"] = prog_data[0]
                if prog_data[1]:
                    rec["goal"] = prog_data[1]
    return "online", rec


def recheck_missing(fetcher: core.Fetcher, page_id: str) -> tuple[str, dict | None]:
    """Aus dem Feed verschwundene Aktion: noch erreichbar → online (nur Zähler
    aktualisieren), sonst offline."""
    kind, slug = resolve_target(fetcher, page_id)
    if not slug:
        return "offline", None
    rec: dict = {}
    prog_data = fetch_progress(fetcher, slug)
    if prog_data:
        rec["signatures"] = prog_data[0]
        if prog_data[1]:
            rec["goal"] = prog_data[1]
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

    def rec_url(page_id: str) -> str:
        return (store.get(page_id, {}).get("url")
                or f"{BASE_URL}/cms/view_by_page_id/{page_id}")

    log("Sammle deutsche 350.org-Aktionen (Europa + ohne Regionsfilter) …")
    discovered = discover(fetcher)

    # (1) Bekannte, die nicht mehr im Feed sind → Offline-Prüfung.
    missing = [k for k in store if k not in discovered]
    if missing and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(missing)} nicht mehr gelistete Aktion(en) …")
        prog(phase="check-known", current=0, total=len(missing),
             message="Prüfe abgelaufene Aktionen …")
        for k, page_id in enumerate(missing, 1):
            prog(current=k, total=len(missing), message=page_id)
            if core.skip_recent(store.get(page_id), args):
                continue
            status, rec = recheck_missing(fetcher, page_id)
            core.upsert(store, page_id, rec or {}, {}, status, ts, rec_url(page_id))
            save()
            if status == "offline":
                log(f"  OFFLINE: {page_id}")

    # (2) Aktuelle Aktionen: Metadaten kommen frei aus dem einen Discovery-Call
    #     und werden immer aktualisiert; der teure Zähler (2 Requests) nur, wenn
    #     die Aktion neu oder >24 h nicht geprüft wurde (skip_recent).
    ids = list(discovered.keys())
    new_ids = [i for i in ids if i not in store]
    if args.limit:
        # Im Test nur wenige NEUE Aktionen (bekannte trotzdem billig auffrischen).
        keep_new = set(new_ids[:args.limit])
        ids = [i for i in ids if i in store or i in keep_new]
    processed_new = len([i for i in ids if i not in store])
    log(f"{len(new_ids)} neue Aktion(en) im Feed; verarbeite {len(ids)} "
        f"({processed_new} neu, Rest Auffrischung).")
    prog(phase="scrape", current=0, total=len(ids), message="Beginne …")

    for i, page_id in enumerate(ids, 1):
        obj = discovered[page_id]
        prog(current=i, total=len(ids), message=(obj.get("title") or page_id)[:60])
        existing = store.get(page_id)
        with_count = not (existing and core.skip_recent(existing, args))
        status, rec = scrape_action(fetcher, page_id, obj, with_count=with_count)
        core.upsert(store, page_id, rec, {}, status, ts, rec["url"])
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Aktion(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(PLATFORM)
    log("Fertig (350.org).")


def check(fetcher):
    resp = fetcher.get(_api_url(TIME_FILTERS[0]))
    if resp is None or not resp.ok:
        return False, "JSON-API nicht erreichbar"
    try:
        n = len(json.loads(resp.text))
    except ValueError:
        return False, "API liefert kein JSON"
    return (n >= 1), f"{n} Aktionen ({REGIONS[0]}/Deutsch)"

PLATFORM = Platform(
    key="threefifty",
    language="de",
    openness=3,
    openness_note="Mittel: keine offene Liste; Aktionen über eine externe "
                  "JSON-API (im Seiten-JS gefunden), Zähler über /progress/. "
                  "/act/-Aktionsseiten sind per robots gesperrt (werden nicht "
                  "geladen) – Format wird aus dem Button-Text abgeleitet.",
    name="350.org",
    eyebrow="350.org · Klima-Aktionen (deutsch): Petitionen, E-Mail- & Brief-Aktionen",
    source_url="https://350.org/de/mitmachen/",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
