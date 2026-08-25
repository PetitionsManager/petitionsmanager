#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  bundestag_scraper.py  —  Plattform-Modul für Bundestag ePetitionen
# =============================================================================
#
#  Scrapt die öffentlichen Petitionen vom ePetitions-Portal des Deutschen
#  Bundestages. Nutzt petitions_core.py; Einstieg monitor.py.
#
#  ZUGANGSWEG (das Portal ist eine JS-Anwendung; der Schlüssel ist das
#  AJAX-Listen-Fragment, das die Seite selbst nachlädt):
#    1. GET /epet/petuebersicht/mz.nc.html            → setzt Session-Cookie
#    2. GET /epet/petuebersicht/mz.nc.content.teaser-petitionen-table.$$$
#           .status.<S>.page.<N>.batchsize.12.html    → Tabellen-Fragment
#       WICHTIG: "$$$" bleibt LITERAL in der URL; der Parameter-String MUSS
#       mit "status." beginnen (sonst leeres Fragment); batchsize ist
#       serverseitig auf ~12 gedeckelt; page ist 0-basiert.
#    3. Detailseiten: /petitionen/_YYYY/_MM/_DD/Petition_<ID>.nc.html
#
#  DIE VIER LISTEN (status.N, alle mit IDENTISCHEM Spaltenlayout; status.1
#  und status.5 liefern leer). Umfang am 2026-07-27 per Binärsuche über die
#  Seitenzahl ermittelt:
#    status.2 = laufende Mitzeichnungsfrist ...    5 Seiten /    57 Einträge
#    status.3 = Frist beendet ...................  68 Seiten /   810 Einträge
#    status.4 = Archiv .........................  587 Seiten / 7.036 Einträge
#  status.3 ist sauber absteigend nach Fristende sortiert (2026-07 … 2017-03),
#  status.4 NICHT (Seite 0 mischt 2021–2025, die letzte Seite liegt bei 2015) —
#  eine Deckelung "nur die neuesten N" wäre dort also willkürlich.
#
#  ZWEISTUFIGES NACHLADEN (3 + 4 sind ~7.850 Einträge, das geht nicht auf
#  einen Schlag):
#    - Die Listentabelle liefert bereits Titel, Sachgebiet, Mitzeichnungen,
#      Frist und Startdatum – also einen vollständig brauchbaren Datensatz.
#      `--backfill` läuft 3 + 4 einmal komplett durch (~655 Requests) und legt
#      diese Datensätze sofort an.
#    - Nur "Text der Petition"/"Begründung" brauchen je eine Detailseite.
#      Diese Nacharbeit steht als Warteschlange `backfill_todo` im _meta der
#      Datendatei und wird pro Lauf in Portionen von --backfill-batch
#      abgearbeitet. ACHTUNG: die Warteschlange muss bei JEDEM save_store
#      mitgegeben werden, sonst ist sie nach dem nächsten Schreiben weg.
#
#  FELDER:
#  - Listen-Fragment: Link+Titel, Kategorie (Sachgebiet), ID, Anzahl
#    Mitzeichnungen, Fristende (ms-Timestamp + Datum).
#  - Detailseite: "Text der Petition" + "Begründung" (im
#    .titel-begruedung-container), "Anzahl Online-Mitzeichnungen <N>".
#  - Startdatum = Veröffentlichungsdatum aus dem URL-Pfad (_YYYY/_MM/_DD).
#  - goal = 30.000 (Quorum für die Behandlung im Petitionsausschuss mit
#    öffentlicher Anhörung).
#  - `closed`/`phase`/`deadline`: Einträge aus 3/4 sind NICHT mehr
#    mitzeichenbar. `status` bleibt "online" (die Seite ist ja erreichbar) –
#    die Unterscheidung trägt `closed`.
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
             "teaser-petitionen-table.$$$.status.{status}.page.{page}."
             "batchsize.12.html")
DATA_FILE = Path("bundestag_petitions.json")
HTML_FILE = Path("bundestag_petitions.html")

# Genug Luft für status.4 (587 Seiten am 2026-07-27); die Schleife hört
# ohnehin bei der ersten leeren Seite auf.
MAX_LIST_PAGES = 1000
QUORUM = 30000                    # Mitzeichnungs-Quorum des Petitionsausschusses

# status.N → (phase, closed, Klartext fürs Log)
PHASES: dict[int, tuple[str, bool, str]] = {
    2: ("mitzeichnung", False, "in der Mitzeichnungsfrist"),
    3: ("beendet",      True,  "mit beendeter Frist"),
    4: ("archiv",       True,  "im Archiv"),
}
BACKFILL_STATUSES = (3, 4)        # was `--backfill` einliest

# Untergrenze je Liste für die Selbstmeldung (core.entdeckung unten).
# Alle drei am 8.8.2026 in einem vollen Durchlauf gemessen: status.2 = 73,
# status.3 = 824, status.4 = 7.035. Zusammen mit den 587 Seiten aus dem
# Kommentar oben ergibt das rund 12 Petitionen je Listenseite — und daran
# hängen die Schwellen: der realistische Teilausfall ist nicht „die Liste ist
# leer", sondern „die Paginierung bricht nach den ersten Seiten ab". Die
# Schleife endet dann bei added == 0 ordentlich und ohne Fehler.
# Deshalb liegt schon status.2 bei 15 und nicht bei 10: ein Abbruch nach der
# ersten Seite hinterlässt ~12 Treffer und bliebe unter 10 unbemerkt. Nach oben
# begrenzt bleibt die Schwelle dadurch, dass status.2 täglich läuft — 15 von
# gemessenen 73 lässt dem normalen Zu- und Abgang der Mitzeichnungsfristen
# reichlich Luft, und ein Melder, der täglich anschlägt, wird überlesen.
ERWARTET_MIN: dict[int, int] = {2: 15, 3: 50, 4: 500}

# Englische Fassung der PHASES-Klartexte. Bewusst ein eigenes Dict statt eines
# vierten Felds in PHASES: das wird oben als Dreiertupel entpackt.
PHASEN_EN: dict[int, str] = {
    2: "within the signing period",
    3: "with an expired deadline",
    4: "in the archive",
}

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
def discover_slugs(fetcher: core.Fetcher, status: int = 2) -> dict[str, dict]:
    """{petition_id: hint} aller Petitionen einer der Listen (siehe PHASES).

    hint enthält bereits url, title, category, signatures, deadline, phase und
    closed aus der Listentabelle (die Detailseite hat keinen eigenen Titel!)."""
    found: dict[str, dict] = {}
    phase_name, is_closed, label = PHASES[status]

    # Schritt 1: Hauptseite lädt Session-Cookie in die requests-Session.
    fetcher.get(LIST_PAGE)

    prog(phase="discover", current=0, total=0,
         message=f"Sammle Petitionen {label} …")
    page = 0
    while page < MAX_LIST_PAGES:
        resp = fetcher.get(FRAGMENT.format(status=status, page=page))
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
                "phase": phase_name,
                "closed": is_closed,
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

    if page >= MAX_LIST_PAGES:
        log(f"WARNUNG: status.{status} bei {MAX_LIST_PAGES} Seiten abgeschnitten "
            "– MAX_LIST_PAGES erhöhen.")
    log(f"Liste status.{status}: {len(found)} Petitionen {label}.")
    # Je Status ein eigener Zweig: --backfill liest status.3 und status.4, der
    # Tageslauf nur status.2. Eine gemeinsame Schwelle über alle drei wäre
    # sinnlos, ihre Größenordnungen liegen um Faktor 100 auseinander.
    core.entdeckung(f"Liste {label}", len(found),
                    erwartet_min=ERWARTET_MIN[status],
                    name_en=f"list {PHASEN_EN[status]}")
    return found


# ----------------------------------------------------------------------------
# Detailseite parsen
# ----------------------------------------------------------------------------
def parse_detail(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    # ⚠️ KORREKTUR 8.8.2026 (Nutzerbefund: "die begründung fehlt in der
    # beschreibung bei bundestagspetition. hier nimmt der scraper wohl nicht
    # alle inhalte von der seite mit"). Er hatte recht.
    #
    # Der Name ".titel-begruedung-container" verspricht Titel UND Begruendung,
    # haelt aber nur den ersten Teil. Die Seite ist so gebaut:
    #
    #   div.read-more__text-box                 <- alles zusammen
    #   ├── div.titel-begruedung-container      <- nur "Text der Petition"
    #   │   ├── p.h3  "Text der Petition"
    #   │   └── p     ~130 Zeichen
    #   ├── p.h3      "Begruendung"             <- GESCHWISTER, nicht Kind
    #   └── p         ~3000 Zeichen
    #
    # Die Begruendung liegt also NEBEN dem bisherigen Container, nicht darin -
    # und sie ist der weitaus groessere Teil. An Petition 194593 gemessen:
    # 149 Zeichen bisher gegen 3129 Zeichen jetzt, Faktor 21.
    #
    # Der aeussere Kasten ist auf der Seite eindeutig (genau ein Vorkommen)
    # und enthaelt nur p/div/br, also keine Navigation, die mitgeschleppt
    # wuerde. Der alte Selektor bleibt als Rueckfall stehen, falls der
    # Bundestag das Geruest aendert - dann fehlt wieder die Begruendung, aber
    # der Datensatz bleibt brauchbar statt leer.
    box = (soup.select_one(".read-more__text-box")
           or soup.select_one(".titel-begruedung-container"))
    if box:
        rec["description_full"] = sanitize_fragment(box, BASE_URL) or None
        text = box.get_text(" ", strip=True)
        text = re.sub(r"^Text der Petition\s*", "", text)
        rec["summary"] = (text[:200] + "…") if len(text) > 200 else text or None

    m = MZ_COUNT_RE.search(soup.get_text(" ", strip=True))
    sig = core.zahl(m.group(1)) if m else None
    if sig is not None:
        rec["signatures"] = sig
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
# Volltext-Warteschlange (beendete/archivierte Petitionen)
# ----------------------------------------------------------------------------
def _needs_text(rec: dict | None) -> bool:
    """True, solange der Petitionstext einer Detailseite noch fehlt."""
    return not (rec or {}).get("description_full")


def _base_record(hint: dict) -> dict:
    """Listen-Hint → vollwertiger Datensatz (ohne Volltext)."""
    return {**hint,
            "kind": "petition",
            "recipient": "Deutscher Bundestag · Petitionsausschuss",
            "goal": QUORUM}


def backfill_discover(fetcher: core.Fetcher, store: dict, todo: list[str],
                      ts: str, save, skip: set[str]) -> tuple[int, int]:
    """Listen status.3 + status.4 einmal komplett einlesen.

    Legt die Datensätze sofort aus den Listen-Feldern an (Titel, Sachgebiet,
    Mitzeichnungen, Frist) und reiht nur die fehlenden Volltexte in `todo` ein.
    Rückgabe: (neue Datensätze, insgesamt gelistete Einträge)."""
    queued = set(todo)
    new_records = 0
    listed = 0
    for status in BACKFILL_STATUSES:
        found = discover_slugs(fetcher, status=status)
        listed += len(found)
        for pid, hint in found.items():
            if pid in skip:          # steht noch in der Mitzeichnungsliste
                continue
            if pid not in store:
                new_records += 1
            core.upsert(store, pid, _base_record(hint), {}, "online", ts,
                        hint["url"])
            if pid not in queued and _needs_text(store.get(pid)):
                todo.append(pid)
                queued.add(pid)
        save()
    log(f"Backfill: {listed} Einträge gelistet, {new_records} neu angelegt, "
        f"{len(todo)} Volltexte offen.")
    return new_records, listed


def backfill_texts(fetcher: core.Fetcher, store: dict, todo: list[str],
                   ts: str, save, batch: int) -> None:
    """Die nächsten `batch` fehlenden Volltexte nachladen."""
    chunk = todo[:batch]
    log(f"Trage Volltexte nach: {len(chunk)} von {len(todo)} offenen …")
    prog(phase="backfill", current=0, total=len(chunk),
         message="Lade Petitionstexte …")
    for i, pid in enumerate(chunk, 1):
        prog(current=i, total=len(chunk), message=f"Petition {pid}")
        url = (store.get(pid) or {}).get("url") or \
            f"{BASE_URL}/petitionen/Petition_{pid}.nc.html"
        status, rec = scrape_petition(fetcher, pid, url)
        # Ein Versuch je Eintrag, dann raus aus der Schlange – sonst blockiert
        # eine dauerhaft kaputte Seite die Portion jedes Mal aufs Neue. Wer
        # ohne Text zurückbleibt, wird beim nächsten --backfill neu eingereiht.
        todo.remove(pid)
        if status == "error":
            continue
        core.upsert(store, pid, rec or {}, {}, status, ts, url)
        save()
        if status == "offline":
            log(f"  OFFLINE: {pid}")
    log(f"Volltexte: {len(todo)} Einträge bleiben offen.")


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    prev_meta = core.load_meta(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()
    todo = list(prev_meta.get("backfill_todo") or [])

    def save(quiet=True, **extra):
        # Die Warteschlange muss bei JEDEM Speichern mit, sonst ist sie nach
        # dem nächsten Schreibvorgang weg (save_store ersetzt das _meta).
        core.save_store(store, DATA_FILE,
                        extra_meta={"backfill_todo": todo, **extra}, quiet=quiet)

    # --- 1) Laufende Mitzeichnungsfrist (status.2) --------------------------
    # Liste zuerst: liefert Titel/Kategorie/Zähler UND die Detail-URLs.
    log("Sammle Petitionen in der Mitzeichnungsfrist …")
    discovered = discover_slugs(fetcher, status=2)
    # Vorläufiger Wert, überlebt jeden Abbruch; der Abschluss-Save ersetzt ihn
    # durch die endgültige Zählung (s. save_store: _TLS.lauf_meta, 24.8.2026).
    core.lauf_meta_setzen(available=len(discovered))

    # Bekannte Einträge auffrischen (Zähler aus Liste; Detail-Re-Scrape nur
    # für Einträge, die nicht mehr gelistet sind → Fristende/offline).
    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        # Nur die noch laufenden prüfen: beendete/archivierte Petitionen ändern
        # sich nicht mehr, ein täglicher Re-Scrape von 7.800 Seiten wäre unnütz.
        missing = [p for p in known if p not in discovered
                   and not (store[p] or {}).get("closed")]
        for pid, hint in discovered.items():
            if pid in store:
                # Listen-Daten (Titel/Kategorie/Zähler) direkt als Datensatz-
                # Update übergeben – core.upsert wertet aus list_hint nur
                # started_by/signatures aus.
                core.upsert(store, pid, dict(hint), {}, "online", ts, hint["url"])
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
                # Frist vorbei, Seite noch online → als beendet kennzeichnen.
                rec["closed"] = True
                rec["phase"] = "beendet"
                rec.setdefault("updates", []).append(
                    {"timestamp": ts[:19],
                     "text": "Nicht mehr in der Mitzeichnungsliste "
                             "(Frist abgelaufen oder abgeschlossen)"})
            core.upsert(store, pid, rec or {}, {}, status, ts, url)
            if status == "offline":       # offline-Zweig kopiert keine Felder
                store[pid]["closed"] = True
                store[pid]["phase"] = "beendet"
                log(f"  OFFLINE: {pid}")
            save()

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
        if hint.get("deadline"):
            rec.setdefault("updates", []).append(
                {"timestamp": ts[:19],
                 "text": f"Mitzeichnungsfrist bis {hint['deadline']}"})
        # Listen-Daten (Titel/Kategorie/Startdatum) mit den Detail-Daten
        # zusammenführen; Detail-Werte haben Vorrang.
        rec = {**_base_record(hint), **{k: v for k, v in rec.items()
                                        if v not in (None, "", [], {})}}
        core.upsert(store, pid, rec, {}, status, ts, hint["url"])
        save()

    # --- 2) Beendete + archivierte Listen (nur mit --backfill) --------------
    listed_closed = 0
    if getattr(args, "backfill", False):
        _, listed_closed = backfill_discover(fetcher, store, todo, ts, save,
                                             skip=set(discovered))

    # --- 3) Fehlende Volltexte portionsweise nachtragen ---------------------
    batch = int(getattr(args, "backfill_batch", core.BACKFILL_BATCH) or 0)
    if todo and batch > 0 and not args.limit:
        backfill_texts(fetcher, store, todo, ts, save, batch)
    elif todo:
        log(f"Volltext-Warteschlange: {len(todo)} offen (in diesem Lauf "
            "übersprungen).")

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    # Vollständigkeitsgrad: Gesamtbestand der Quelle = laufende + beendete +
    # archivierte. Ohne frischen --backfill den zuletzt bekannten Wert halten.
    available = (len(discovered) + listed_closed if listed_closed
                 else prev_meta.get("available") or len(discovered))

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=available)
    core.write_list_html(PLATFORM)
    log("Fertig (Bundestag).")


def check(fetcher):
    fetcher.get(LIST_PAGE)          # setzt die Session-Cookie
    return core.check_source(fetcher, FRAGMENT.format(status=2, page=0),
                             DETAIL_HREF_RE, 5, "Petitionen (AJAX-Fragment)")

PLATFORM = Platform(
    key="bundestag",
    name="Bundestag ePetitionen",
    eyebrow="Deutscher Bundestag · Petitionen in der Mitzeichnungsfrist, "
            "beendete und archivierte",
    source_url="https://epetitionen.bundestag.de/epet/petuebersicht/mz.nc.html",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
    openness=2,
    openness_note="Eingeschränkt: offizielle Daten, aber JS-Portal mit "
                  "Session-Cookies und verstecktem AJAX-Fragment (status.2-"
                  "Parameter nötig, Batchgröße gedeckelt) — ohne Reverse-"
                  "Engineering nicht zugänglich.",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
