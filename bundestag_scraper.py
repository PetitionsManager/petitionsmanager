#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  bundestag_scraper.py  —  Plattform-Modul für Bundestag ePetitionen
# =============================================================================
#
#  Scrapt die öffentlichen Petitionen in der MITZEICHNUNGSFRIST vom
#  ePetitions-Portal des Deutschen Bundestages. Nutzt petitions_core.py;
#  Einstieg monitor.py.
#
#  ZUGANGSWEG (das Portal ist eine JS-Anwendung; der Schlüssel ist das
#  AJAX-Listen-Fragment, das die Seite selbst nachlädt):
#    1. GET /epet/petuebersicht/mz.nc.html            → setzt Session-Cookie
#    2. GET /epet/petuebersicht/mz.nc.content.teaser-petitionen-table.$$$
#           .status.2.page.<N>.batchsize.12.html      → Tabellen-Fragment
#       WICHTIG: "$$$" bleibt LITERAL in der URL; der Parameter-String MUSS
#       mit "status.2" beginnen (sonst leeres Fragment); batchsize ist
#       serverseitig auf ~12 gedeckelt; page ist 0-basiert.
#    3. Detailseiten: /petitionen/_YYYY/_MM/_DD/Petition_<ID>.nc.html
#
#  FELDER:
#  - Listen-Fragment: Link+Titel, Kategorie (Sachgebiet), ID, Anzahl
#    Mitzeichnungen, Fristende (ms-Timestamp + Datum).
#  - Detailseite: "Text der Petition" + "Begründung" (im
#    .titel-begruedung-container), "Anzahl Online-Mitzeichnungen <N>".
#  - Startdatum = Veröffentlichungsdatum aus dem URL-Pfad (_YYYY/_MM/_DD).
#  - goal = 30.000 (Quorum für die Behandlung im Petitionsausschuss mit
#    öffentlicher Anhörung).
#  - Die Session-Cookies verwaltet requests.Session im Fetcher automatisch.
# =============================================================================

from __future__ import annotations

import datetime as _dt
import re
from pathlib import Path

from bs4 import BeautifulSoup

import petitions_core as core
from petitions_core import Platform, log, now_iso, prog, sanitize_fragment

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://epetitionen.bundestag.de"
LIST_PAGE = f"{BASE_URL}/epet/petuebersicht/mz.nc.html"
FRAGMENT  = (f"{BASE_URL}/epet/petuebersicht/mz.nc.content."
             "teaser-petitionen-table.$$$.status.2.page.{page}."
             "batchsize.12.html")
DATA_FILE = Path("bundestag_petitions.json")
HTML_FILE = Path("bundestag_petitions.html")

MAX_LIST_PAGES = 100
QUORUM = 30000                    # Mitzeichnungs-Quorum des Petitionsausschusses

DETAIL_HREF_RE = re.compile(
    r'href="(/petitionen/_(\d{4})/_(\d{2})/_(\d{2})/Petition_(\d+)\.nc\.html)"')
MZ_COUNT_RE = re.compile(r"Anzahl Online-Mitzeichnungen\s*([\d.]+)")
DEADLINE_RE = re.compile(r"(\d{13})")   # ms-Timestamps in der Frist-Zelle

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


def _ms_to_date(ms: str) -> str | None:
    try:
        return (_dt.datetime.fromtimestamp(int(ms) / 1000)
                .astimezone().date().isoformat())
    except (ValueError, OSError, OverflowError):
        return None


# ----------------------------------------------------------------------------
# Entdeckung über das Tabellen-Fragment
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{petition_id: hint} aller Petitionen in der Mitzeichnungsfrist.

    hint enthält bereits url, title, category, signatures und deadline aus
    der Listentabelle (die Detailseite hat keinen eigenen Titel!)."""
    found: dict[str, dict] = {}

    # Schritt 1: Hauptseite lädt Session-Cookie in die requests-Session.
    fetcher.get(LIST_PAGE)

    prog(phase="discover", current=0, total=0, message="Sammle Petitionen …")
    page = 0
    while page < MAX_LIST_PAGES:
        resp = fetcher.get(FRAGMENT.format(page=page))
        if resp is None or not resp.ok:
            break
        soup = BeautifulSoup(resp.text, "html.parser")
        added = 0
        for tr in soup.find_all("tr"):
            a = tr.find("a", href=re.compile(r"/petitionen/_"))
            if a is None:
                continue
            m = DETAIL_HREF_RE.search(str(a))
            if not m:
                continue
            path, year, month, day, pid = m.groups()
            if pid in found:
                continue
            tds = tr.find_all("td")
            hint = {
                "url": f"{BASE_URL}{path}",
                "title": a.get_text(" ", strip=True)[:250] or None,
                "start_date": f"{year}-{month}-{day}",
            }
            if len(tds) >= 5:
                # Frist-Zelle: zweiter ms-Timestamp = Fristende.
                stamps = DEADLINE_RE.findall(tds[0].get_text())
                if len(stamps) >= 2:
                    hint["deadline"] = _ms_to_date(stamps[1])
                cat = tds[1].get_text(" ", strip=True)
                title = hint["title"] or ""
                if cat.endswith(title):
                    cat = cat[: len(cat) - len(title)].strip()
                hint["category"] = cat[:120] or None
                digits = re.sub(r"\D", "", tds[3].get_text())
                if digits:
                    hint["signatures"] = int(digits)
            found[pid] = hint
            added += 1
        if added == 0:
            break
        prog(current=page + 1, total=0,
             message=f"Listenseite {page + 1} · {len(found)} Petitionen bisher")
        page += 1

    log(f"Liste: {len(found)} Petitionen in der Mitzeichnungsfrist.")
    return found


# ----------------------------------------------------------------------------
# Detailseite parsen
# ----------------------------------------------------------------------------
def parse_detail(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    box = soup.select_one(".titel-begruedung-container")
    if box:
        rec["description_full"] = sanitize_fragment(box, BASE_URL) or None
        text = box.get_text(" ", strip=True)
        text = re.sub(r"^Text der Petition\s*", "", text)
        rec["summary"] = (text[:200] + "…") if len(text) > 200 else text or None

    m = MZ_COUNT_RE.search(soup.get_text(" ", strip=True))
    if m:
        rec["signatures"] = int(re.sub(r"\D", "", m.group(1)))
        rec["goal"] = QUORUM

    rec["recipient"] = "Deutscher Bundestag · Petitionsausschuss"
    rec["url"] = url
    rec["kind"] = "petition"
    return rec


def scrape_petition(fetcher: core.Fetcher, pid: str,
                    url: str) -> tuple[str, dict | None]:
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

    # Liste zuerst: liefert Titel/Kategorie/Zähler UND die Detail-URLs.
    log("Sammle Petitionen in der Mitzeichnungsfrist …")
    discovered = discover_slugs(fetcher)

    # Bekannte Einträge auffrischen (Zähler aus Liste; Detail-Re-Scrape nur
    # für Einträge, die nicht mehr gelistet sind → Fristende/offline).
    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        missing = [p for p in known if p not in discovered]
        for pid, hint in discovered.items():
            if pid in store:
                # Listen-Daten (Titel/Kategorie/Zähler) direkt als Datensatz-
                # Update übergeben – core.upsert wertet aus list_hint nur
                # started_by/signatures aus.
                hint_rec = {k: v for k, v in hint.items() if k != "deadline"}
                core.upsert(store, pid, hint_rec, {}, "online", ts, hint["url"])
        if missing:
            log(f"Prüfe {len(missing)} nicht mehr gelistete Petition(en) …")
            prog(phase="check-known", current=0, total=len(missing),
                 message="Prüfe abgelaufene Petitionen …")
        for k, pid in enumerate(missing, 1):
            prog(current=k, total=len(missing), message=f"Petition {pid}")
            if core.skip_recent(store.get(pid), args):
                continue
            url = store[pid].get("url") or f"{BASE_URL}/petitionen/Petition_{pid}.nc.html"
            status, rec = scrape_petition(fetcher, pid, url)
            if status == "error":
                continue
            if rec is not None:
                # Frist vorbei, Seite noch online → Status-Update vermerken.
                rec.setdefault("updates", []).append(
                    {"timestamp": ts[:19],
                     "text": "Nicht mehr in der Mitzeichnungsliste "
                             "(Frist abgelaufen oder abgeschlossen)"})
            core.upsert(store, pid, rec or {}, {}, status, ts, url)
            save()
            if status == "offline":
                log(f"  OFFLINE: {pid}")

    new_pids = [p for p in discovered if p not in store]
    if args.limit:
        new_pids = new_pids[:args.limit]
    log(f"{len(new_pids)} neue Petitionen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_pids),
         message="Beginne Scrape …")

    for i, pid in enumerate(new_pids, 1):
        hint = discovered[pid]
        log(f"({i}/{len(new_pids)}) {pid} – {str(hint.get('title'))[:50]}")
        prog(current=i, total=len(new_pids), message=f"Petition {pid}")
        status, rec = scrape_petition(fetcher, pid, hint["url"])
        if status == "error":
            continue
        rec = rec or {}
        deadline = hint.pop("deadline", None)
        if deadline:
            rec.setdefault("updates", []).append(
                {"timestamp": ts[:19],
                 "text": f"Mitzeichnungsfrist bis {deadline}"})
        # Listen-Daten (Titel/Kategorie/Startdatum) mit den Detail-Daten
        # zusammenführen; Detail-Werte haben Vorrang.
        rec = {**hint, **{k: v for k, v in rec.items()
                          if v not in (None, "", [], {})}}
        core.upsert(store, pid, rec, {}, status, ts, hint["url"])
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions)
    core.write_list_html(PLATFORM)
    log("Fertig (Bundestag).")


PLATFORM = Platform(
    key="bundestag",
    name="Bundestag ePetitionen",
    eyebrow="Deutscher Bundestag · Petitionen in der Mitzeichnungsfrist",
    source_url="https://epetitionen.bundestag.de/epet/petuebersicht/mz.nc.html",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    openness=2,
    openness_note="Eingeschränkt: offizielle Daten, aber JS-Portal mit "
                  "Session-Cookies und verstecktem AJAX-Fragment (status.2-"
                  "Parameter nötig, Batchgröße gedeckelt) — ohne Reverse-"
                  "Engineering nicht zugänglich.",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
