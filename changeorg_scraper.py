#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  changeorg_scraper.py  —  Plattform-Modul für Change.org (Deutschland)
# =============================================================================
#
#  Scrapt deutsche Petitionen von change.org. Nutzt petitions_core.py;
#  Einstieg monitor.py.
#
#  QUELLEN (robots.txt erlaubt /p/<slug>; gesperrt sind nur /p/*/sign,
#  /api-proxy/ u. ä.; Monats-Sitemaps unter /sitemap.xml):
#    - https://www.change.org/sitemap-YYYY_MM_0.xml   neue Petitionen (alle
#      Sprachen gemischt, ohne Sprachkennung)
#    - https://www.change.org/p/<slug>                Detailseite
#
#  BESONDERHEITEN:
#  - Die Sitemap kennzeichnet die Sprache NICHT. Discovery filtert die Slugs
#    deshalb per Wort-Heuristik (deutsche Signalwörter/Umlaut-Encodings) vor
#    und verifiziert auf der Detailseite hart über das eingebettete
#    "country":{"countryCode":"DE"} – Nicht-DE → "skip".
#  - Die Detailseite bettet den kompletten GraphQL-State ins HTML:
#    "ask" = Titel, "signatureCount":{"displayed":N},
#    "signatureGoal":{"displayed":N}, "description" (HTML als JSON-String),
#    "createdAt", "displayName" (Starter*in), Tag-Slugs als Kategorie.
#  - NUR die neuesten 2 Monats-Sitemaps werden gescannt und pro Lauf max.
#    MAX_NEW_PER_RUN neue Kandidaten geprüft (Server-Schonung); der Bestand
#    wächst über die Läufe.
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
BASE_URL  = "https://www.change.org"
DATA_FILE = Path("changeorg_petitions.json")
HTML_FILE = Path("changeorg_petitions.html")

SITEMAP_INDEX = f"{BASE_URL}/sitemap.xml"
# Alle verfügbaren Monats-Sitemaps scannen (Index listet ~51 zurück bis 2022;
# alle laut robots.txt erlaubt). Discovery ist billig – teuer sind nur die
# Detailseiten, die über MAX_NEW_PER_RUN pro Lauf gedeckelt bleiben, sodass
# der Bestand über mehrere Läufe vollständig aufgefüllt wird.
SITEMAP_COUNT = 60
MAX_NEW_PER_RUN = 500             # neue Detail-Scrapes pro Lauf (2026-07-27
                                 # von 150 erhöht; die Aufhol-Schleife im
                                 # GitHub-Actions-Workflow ruft den Lauf so oft
                                 # neu auf, bis der Backlog abgearbeitet ist)

LOC_RE  = re.compile(r"<loc>https://www\.change\.org/p/([^<]+)</loc>")
# Startseite: aktuelle deutsche Themen (rotieren) im eingebetteten State.
TRENDING_RE = re.compile(r'"trendingTopics":\[(.*?)\]', re.S)
TOPIC_SLUG_RE = re.compile(r'"name":"[^"]*","slug":"([a-z0-9-]+)"')
# Themenseite /t/<slug>: server-gerenderte Petitions-Links (je ~21).
#
# ⚠️ Die Prozent-Kodierung muss als GANZES gefasst werden. Die frühere Fassung
# r'/p/([a-z0-9%-]+)' kannte keine Großbuchstaben — deutsche Slugs enthalten
# aber kodierte Umlaute, und deren Hex-Ziffern sind groß: „vermögens" steht als
# „verm%C3%B6gens" in der Seite. Der Ausdruck nahm „verm%" und brach am „C" ab.
# Folge (4.8.26 gemessen): 81 Datensätze mit abgeschnittener Adresse, die
# kürzesten nur noch ein Zeichen lang („k", „h", „r"). Sie liefern 404, und
# recheck_missing schloss daraus, die Petition sei gelöscht — dabei war unser
# eigener Link kaputt. Gegenprobe: von 1.938 Sätzen MIT Titel tragen 1.543 eine
# vollständige Prozent-Kodierung im Slug (die kommen über LOC_RE aus der
# Sitemap), von den 81 titellosen kein einziger.
PETITION_SLUG_RE = re.compile(r'/p/((?:[a-z0-9-]|%[0-9A-Fa-f]{2})+)')
# /t/<slug> paginiert die restlichen Petitionen nur über /api-proxy/, das
# robots.txt SPERRT – daher bewusst nur die ~21 der gerenderten Seite.
# Deutsche Signalwörter im Slug (inkl. URL-encodeter Umlaute %C3%A4/ö/ü/ß).
GERMAN_SLUG_RE = re.compile(
    r"(f%C3%BCr|fuer|gegen|stoppt|rettet|erhalt|keine?[-_]|deutschland|"
    r"berlin|hamburg|m%C3%BCnchen|jetzt|schule|stadt|verbot|schutz|"
    r"%C3%A4|%C3%B6|%C3%BC|%C3%9F)", re.I)

ASK_RE      = re.compile(r'"ask":"((?:[^"\\]|\\.)*)"')
SIG_RE      = re.compile(r'"signatureCount":\{"displayed":(\d+)')
GOAL_RE     = re.compile(r'"signatureGoal":\{"displayed":(\d+)')
DESC_RE     = re.compile(r'"description":"((?:[^"\\]|\\.)*)"')
CREATED_RE  = re.compile(r'"createdAt":"(\d{4}-\d{2}-\d{2})')
STARTER_RE  = re.compile(r'"displayName":"((?:[^"\\]|\\.)*)"')
COUNTRY_RE  = re.compile(r'"country":\{"countryCode":"([A-Z]{2})"')
TAG_RE      = re.compile(r'"slug":"([a-z0-9\-]+)","name":"((?:[^"\\]|\\.)*)"')

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


def _junescape(s: str) -> str:
    """JSON-String-Escapes (\\u003c, \\" …) in Klartext wandeln."""
    try:
        return json.loads(f'"{s}"')
    except ValueError:
        return s


# ----------------------------------------------------------------------------
# Entdeckung
# ----------------------------------------------------------------------------
def discover_topics(fetcher: core.Fetcher) -> list[str]:
    """Aktuelle deutsche Themen-Slugs (trendingTopics) von der Startseite."""
    resp = fetcher.get(f"{BASE_URL}/?lang=de-DE")
    if resp is None or not resp.ok:
        return []
    m = TRENDING_RE.search(resp.text)
    return TOPIC_SLUG_RE.findall(m.group(1)) if m else []


def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """Kandidaten-Slugs aus (a) den deutschen Themenseiten /t/<slug> – der
    beste, kuratierte Weg – und (b) ergänzend den neuesten Monats-Sitemaps
    (Heuristik). Endgültige Sprachprüfung erfolgt je Petition in parse_detail."""
    found: dict[str, dict] = {}

    # (a) Themenseiten: robuste, deutsche Kuratierung (je ~21 Petitionen).
    # ⚠️ Dieser Zweig ist STILL AUSGEFALLEN und lief monatelang unbemerkt: die
    # Startseite hat weder trendingTopics noch einen /t/-Link mehr, der Lauf
    # blieb trotzdem grün, weil die Sitemaps unten die Lücke füllten. Genau
    # dieser Fall war der Anlass für core.entdeckung() — sie meldet einen
    # leeren Zweig, statt ihn im Protokoll verschwinden zu lassen.
    topics = discover_topics(fetcher)
    core.entdeckung("Themenseiten (trendingTopics)", len(topics))
    prog(phase="discover", current=0, total=len(topics) + SITEMAP_COUNT,
         message="Sammle Themen …")
    for i, topic in enumerate(topics, 1):
        r = fetcher.get(f"{BASE_URL}/t/{topic}")
        added = 0
        if r is not None and r.ok:
            for slug in set(PETITION_SLUG_RE.findall(r.text)):
                if slug not in found:
                    found[slug] = {}
                    added += 1
        log(f"Thema '{topic}': +{added} (gesamt {len(found)}).")
        prog(current=i, total=len(topics) + SITEMAP_COUNT,
             message=f"Thema „{topic}“ · {len(found)} Kandidaten")

    # (b) Sitemaps als Ergänzung (fängt Petitionen ohne Themenzuordnung).
    resp = fetcher.get(SITEMAP_INDEX)
    maps = (re.findall(r"<loc>([^<]+sitemap-[^<]+)</loc>", resp.text)[:SITEMAP_COUNT]
            if resp is not None and resp.ok else [])
    # Seit der Themen-Zweig tot ist, hängt die gesamte Entdeckung an den
    # Sitemaps. Fällt auch die aus, findet der Lauf gar nichts mehr — und das
    # darf nicht erst am eingebrochenen Bestand auffallen.
    core.entdeckung("Sitemap-Verzeichnis", len(maps))
    for j, sm in enumerate(maps, 1):
        r = fetcher.get(sm)
        added = 0
        if r is not None and r.ok:
            for m in LOC_RE.finditer(r.text):
                slug = m.group(1)
                if GERMAN_SLUG_RE.search(slug) and slug not in found:
                    found[slug] = {}
                    added += 1
        log(f"Sitemap {sm.rsplit('/', 1)[-1]}: +{added} DE-Kandidaten.")
        prog(current=len(topics) + j, total=len(topics) + SITEMAP_COUNT,
             message=f"Sitemap {j}/{len(maps)} · {len(found)} Kandidaten")
    return found


# ----------------------------------------------------------------------------
# Detailseite parsen
# ----------------------------------------------------------------------------
def parse_detail(html: str, url: str) -> dict | None:
    """None = keine deutsche Petition (skip)."""
    m_c = COUNTRY_RE.search(html)
    if not m_c or m_c.group(1) != "DE":
        return None

    rec: dict = {}
    m = ASK_RE.search(html)
    rec["title"] = _junescape(m.group(1))[:250] if m else None
    if not rec["title"]:
        return None

    m = SIG_RE.search(html)
    if m:
        rec["signatures"] = int(m.group(1))
    m = GOAL_RE.search(html)
    if m:
        rec["goal"] = int(m.group(1))
    m = CREATED_RE.search(html)
    if m:
        rec["start_date"] = m.group(1)
    m = STARTER_RE.search(html)
    if m:
        rec["started_by"] = _junescape(m.group(1))[:200]

    m = DESC_RE.search(html)
    if m:
        desc_html = _junescape(m.group(1))
        frag = BeautifulSoup(desc_html, "html.parser")
        rec["description_full"] = sanitize_fragment(frag, BASE_URL) or None
        text = frag.get_text(" ", strip=True)
        rec["summary"] = (text[:200] + "…") if len(text) > 200 else text or None

    tags = TAG_RE.findall(html)
    themed = [(_junescape(n)) for s, n in tags
              if not re.match(r"^[a-z\-]+-\d+$", s)]
    rec["category"] = themed[0] if themed else None

    soup = BeautifulSoup(html, "html.parser")
    og = soup.find("meta", property="og:image")
    rec["image_url"] = og["content"].strip() if og and og.get("content") else None
    rec["url"] = url
    rec["kind"] = "petition"
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error | skip."""
    url = f"{BASE_URL}/p/{slug}"
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
def heile_abgeschnittene(store: dict, discovered: dict, save) -> list[str]:
    """Datensätze reparieren, deren Slug ein früherer Fehler abgeschnitten hat.

    Bis zum 4.8.26 brach PETITION_SLUG_RE an der Prozent-Kodierung deutscher
    Umlaute ab (siehe dort). Zurück blieben 81 Datensätze mit einer Adresse wie
    „barrierefreiheit-in-k" statt „barrierefreiheit-in-k%C3%B6ln-porz-…". Die
    liefern 404, und recheck_missing hat daraus geschlossen, die Petition sei
    gelöscht — dabei war unser Link kaputt. Der reparierte Ausdruck verhindert
    NEUE Fälle; die vorhandenen bekommt nur diese Zusammenführung zurück, und
    sie muss im Scraper stehen, weil der Live-Bestand im Actions-Cache liegt
    und nicht im Repo.

    Sicherheitsnetz: angefasst wird ausschließlich, was KEINEN Titel hat und
    echter Präfix von GENAU EINEM entdeckten Slug ist. Ein gesunder Datensatz
    kann damit nicht getroffen werden, und bei mehreren Kandidaten wird nichts
    geraten. Am 4.8.26 gemessen: von 81 kaputten Slugs 49 eindeutig auflösbar
    (29 davon Duplikate eines bereits vorhandenen Satzes, 20 echte Neuzugänge),
    24 mehrdeutig, 8 gar nicht in den Sitemaps."""
    kaputt = [s for s, r in store.items()
              if not s.startswith("_") and not (r.get("title") or "").strip()]
    if not kaputt:
        return []
    vervollstaendigt: list[str] = []
    verschmolzen = 0
    for s in kaputt:
        kandidaten = [v for v in discovered if v != s and v.startswith(s)]
        if len(kandidaten) != 1:
            continue
        voll = kandidaten[0]
        if voll in store:
            # Der richtige Datensatz existiert schon – der abgeschnittene ist
            # ein Duplikat und kann weg. Die Unterschriften-Historie des
            # Torsos ist wertlos: er wurde nie erfolgreich abgerufen.
            del store[s]
            verschmolzen += 1
        else:
            rec = store.pop(s)
            rec["slug"] = voll
            rec["url"] = f"{BASE_URL}/p/{voll}"
            # „offline" war die Fehldiagnose aus dem 404 unserer eigenen
            # kaputten Adresse – zurücknehmen, damit der Satz wieder geprüft
            # wird. last_checked entfernen, sonst sperrt skip_recent ihn 24 h.
            for feld in ("status", "offline_since", "offline_misses",
                         "last_checked"):
                rec.pop(feld, None)
            store[voll] = rec
            vervollstaendigt.append(voll)
    if verschmolzen or vervollstaendigt:
        log(f"Abgeschnittene Adressen repariert: {len(vervollstaendigt)} "
            f"Slug(s) vervollständigt, {verschmolzen} Dublette(n) entfernt "
            f"(von {len(kaputt)} kaputten).")
        save()
    return vervollstaendigt


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
            prog(current=k, total=len(known), message=slug[:60])
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            if status == "skip":
                del store[slug]
                log(f"  ENTFERNT (nicht DE): {slug[:60]}")
                save()
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/p/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug[:60]}")

    log("Scanne Sitemaps nach deutschen Kandidaten …")
    discovered = discover_slugs(fetcher)
    # Die reparierten Slugs stehen jetzt im Store und fielen deshalb aus der
    # Auswahl unten heraus ("s not in store"). Die Schleife über die bekannten
    # Petitionen ist aber längst durch – ohne sie hier voranzustellen, bliebe
    # ihr Inhalt bis zum nächsten Lauf leer.
    repariert = heile_abgeschnittene(store, discovered, save)
    new_slugs = repariert + [s for s in discovered
                             if s not in store][:MAX_NEW_PER_RUN]
    if args.limit:
        new_slugs = new_slugs[:args.limit]
    log(f"{len(new_slugs)} Kandidaten zum Prüfen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_slugs),
         message="Beginne Scrape …")

    for i, slug in enumerate(new_slugs, 1):
        log(f"({i}/{len(new_slugs)}) {slug[:70]}")
        prog(current=i, total=len(new_slugs), message=slug[:60])
        status, rec = scrape_petition(fetcher, slug)
        if status == "error":
            continue
        if status == "skip":
            log("  übersprungen (nicht DE).")
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts, f"{BASE_URL}/p/{slug}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(PLATFORM)
    log("Fertig (Change.org).")


def check(fetcher):
    resp = fetcher.get(SITEMAP_INDEX)
    if resp is None or not resp.ok:
        return False, "Sitemap-Index nicht erreichbar"
    maps = re.findall(r"<loc>([^<]+sitemap-[^<]+)</loc>", resp.text)
    if not maps:
        return False, "keine Monats-Sitemaps im Index"
    return core.check_source(fetcher, maps[0], PETITION_SLUG_RE, 10,
                             "/p/-Slugs (1 Sitemap)")

PLATFORM = Platform(
    key="changeorg",
    openness=3,
    openness_note="Mittel: deutsche Themenseiten /t/<slug> liefern kuratierte "
                  "Petitionen (je ~21; „Mehr anzeigen“ läuft über das robots-"
                  "gesperrte /api-proxy/ und bleibt außen vor), ergänzt um "
                  "Sitemap-Heuristik. Petitionsseiten selbst frei zugänglich.",
    name="Change.org",
    eyebrow="Change.org · deutsche Petitionen (Sitemap-Heuristik + DE-Verifikation)",
    source_url="https://www.change.org/?lang=de-DE",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
