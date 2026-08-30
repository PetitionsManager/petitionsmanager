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

import i18n_helfer as i18n
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
# ⚠️ Auf der Seite stehen MEHRERE "description"-Felder, und das ERSTE ist das
# falsche. Am 9.8.2026 an der Petition „Sexualisierte KI-Darstellungen stoppen"
# ausgezählt — sechs Stück:
#   #1   395 Zeichen, endet auf „…"  → schema.org-Block "@type":"Article",
#                                      also der SEO-Anrisstext
#   #2  5012 Zeichen                 → die Petition selbst, direkt hinter
#                                      "ask":"<Titel>"
#   #3–#5                            → die Neuigkeiten der Petition
#                                      (davor steht jeweils "title", nicht "ask")
#
# `DESC_RE.search(html)` nahm #1. Folge: 370 von 376 Change.org-Sätzen (98 %)
# trugen einen abgeschnittenen Text, im Median 396 Zeichen — bei allen zehn
# anderen Plattformen liegt der Anteil bei 0–1 %. Auch die Kurzbeschreibung
# war betroffen, sie wird aus demselben Text gebildet.
#
# Die Verankerung am "ask" ist die Struktur der Seite, keine Heuristik: das
# Petitionsobjekt trägt erst seinen Titel, dann seinen Text. An sechs Live-
# Petitionen gegengeprüft, Zuwachs zwischen dem 4- und dem 46-Fachen.
CREATED_RE  = re.compile(r'"createdAt":"(\d{4}-\d{2}-\d{2})')
STARTER_RE  = re.compile(r'"displayName":"((?:[^"\\]|\\.)*)"')
COUNTRY_RE  = re.compile(r'"country":\{"countryCode":"([A-Z]{2})"')
# Die SPRACHE der Petition (nicht ihr Land) — Grundlage des englischen Eintrags.
ORIGINAL_LOCALE_RE = re.compile(
    r'"originalLocale":\{"localeCode":"([A-Za-z\-]+)"')
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
    #
    # Am 8.8.2026 nachgemessen und als aufgegeben eingestuft: die deutsche
    # Startseite (266.305 Zeichen) enthält „trendingTopics" 0-mal und keinen
    # einzigen /t/-Link. Das ist keine Störung, die vorbeigeht, sondern eine
    # Entscheidung der Quelle — und eine Warnung, die jeden Tag dasselbe sagt,
    # wird überlesen und nimmt die echten Warnungen daneben mit. Der Abruf
    # bleibt trotzdem stehen (eine Anfrage): kehrt der Zweig zurück, meldet
    # entdeckung() das als Hinweis, und dann gehört „aufgegeben" wieder weg.
    topics = discover_topics(fetcher)
    core.entdeckung("Themenseiten (trendingTopics)", len(topics),
                    aufgegeben=True,
                    name_en="topic pages (trendingTopics)")
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
    core.entdeckung("Sitemap-Verzeichnis", len(maps),
                    name_en="sitemap index")
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
def _volltext_treffer(html: str):
    """Das "description"-Feld der PETITION, nicht das des SEO-Blocks.

    Gesucht wird ab dem "ask" (dem Titel im Petitionsobjekt) — siehe die
    Begründung bei DESC_RE. Findet sich dort keins, gilt wie früher das erste;
    lieber ein verkürzter Text als gar keiner."""
    a = ASK_RE.search(html)
    if a:
        m = DESC_RE.search(html, a.end())
        if m and m.group(1).strip():
            return m
    return DESC_RE.search(html)


def parse_detail(html: str, url: str, sprache: str = "de") -> dict | None:
    """None = Petition der falschen Sprache (skip).

    ⚠️ ZWEI VERSCHIEDENE FELDER, und der Unterschied ist wichtig:
      · "country":{"countryCode":"DE"}          — das LAND der Petition
      · "originalLocale":{"localeCode":"en-US"} — die SPRACHE, in der sie
                                                  verfasst wurde
    Der deutsche Zweig prüft historisch das Land; das trifft hier zusammen,
    weil deutschsprachige Petitionen fast alle aus Deutschland kommen. Für den
    englischen Zweig taugt es NICHT — englische Petitionen kommen aus US, GB,
    AU, CA, IN. Deshalb prüft er die Sprache, und das ist ohnehin das
    genauere Feld (am 12.8.2026 an beiden Sprachen gemessen).
    """
    if sprache == "de":
        m_c = COUNTRY_RE.search(html)
        if not m_c or m_c.group(1) != "DE":
            return None
    else:
        m_l = ORIGINAL_LOCALE_RE.search(html)
        if not m_l or not m_l.group(1).lower().startswith(sprache):
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

    m = _volltext_treffer(html)
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
    # ⚠️ Beim Quervergleich der sechs Sprach-Zwillinge am 12.8.2026 aufgefallen:
    # Change.org war die EINZIGE Plattform ohne lang-Vermerk am Datensatz —
    # 0 von 10 englischen Sätzen trugen einen, während alle anderen fünf ihn
    # setzten. Die App richtet Flagge und Sprachhinweis danach
    # (app.js: langInfo(s.relLang || s.plat.language)), und publish.py leitet
    # das languages-Feld des Manifests daraus ab. Der Wert ist hier BELEGT,
    # nicht geraten: er stammt aus "originalLocale" der Seite selbst.
    i18n.setze_hauptsprache(rec, sprache)
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str,
                    sprache: str = "de") -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error | skip."""
    url = f"{BASE_URL}/p/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    rec = parse_detail(resp.text, url, sprache)
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

    # ⚠️⚠️ Was dieser Lauf über sich selbst weiß, wandert bei JEDER Speicherung
    # mit ins _meta. Grund: save_store baut das _meta bei jedem Schreiben neu
    # auf (nur FIELD_META + generated_at + petition_count + extra_meta). Ohne
    # das würden die Zwischenspeicherungen der Nachprüfung genau die Felder
    # wieder wegwerfen, für die die Entdeckung eben gelaufen ist — und ein
    # abgebrochener Lauf hinterließe einen Bestand ohne "available", den das
    # Dashboard laut write_dashboard() als „alle gefundenen abgearbeitet"
    # ausweist (available = meta.get("available") or len(store)). Genau so kam
    # am 24.8.2026 die Falschauskunft „2067 von ~2067 · 0 neue" zustande.
    lauf_meta: dict = {}

    def save(quiet=True, **extra):
        core.save_store(store, DATA_FILE, extra_meta={**lauf_meta, **extra},
                        quiet=quiet)

    # Vor der Entdeckung festhalten: „bekannt" meint den Stand zu LAUFBEGINN.
    # Sonst zählten die gleich frisch angelegten Petitionen als nachzuprüfen
    # (sie fielen zwar über skip_recent wieder heraus, aber die Zahl im
    # Protokoll wäre falsch).
    known = list(store.keys())

    # ------------------------------------------------------------------
    # 1. ENTDECKUNG — bewusst VOR der Nachprüfung
    # ------------------------------------------------------------------
    # ⚠️⚠️ Die Reihenfolge war bis zum 24.8.2026 umgekehrt, und das hat die
    # Plattform still zum Erliegen gebracht: erst wurden alle ~2067 bekannten
    # Sätze nachgeprüft (bei 1,5 s Pause rund 52 min), erst danach kam die
    # Entdeckung. Change.org steht im Sammellauf an vierter Stelle und bekam
    # am 24.8. nur noch 29 der 300 Minuten — der Lauf wurde also mitten in der
    # Nachprüfung abgeschnitten und erreichte die Entdeckung NIE. Gemessen:
    # die jüngste ausgelieferte Petition startete am 8.8., während die
    # August-Sitemap 255 Kandidaten führte, die uns fehlten.
    #
    # Der Tausch kostet bei Zeitnot die Auffrischung der Unterschriftenzahlen
    # (die holt der nächste Lauf über skip_recent nach) und rettet dafür das,
    # was sonst gar nicht mehr ankommt: neue Petitionen. Die Sitemaps stehen im
    # Index nach Monaten absteigend, die neuesten Kandidaten liegen also vorn
    # und fallen nicht unter den Deckel MAX_NEW_PER_RUN.
    log("Scanne Sitemaps nach deutschen Kandidaten …")
    discovered = discover_slugs(fetcher)
    lauf_meta["available"] = len(discovered)
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

    # Ergebnis der Entdeckung leise festschreiben, BEVOR die lange Nachprüfung
    # beginnt. Ein Abbruch dort lässt den Bestand dann mit richtigen Zahlen
    # zurück statt mit einem leeren _meta.
    # ⚠️ Bewusst quiet=True: save_store(quiet=False) hängt einen Eintrag an
    # lauf_verlauf und stößt die Selbstmeldung an. Zweimal je Lauf aufgerufen
    # verglichen die Kennzahlen sich mit sich selbst, und der Melder für
    # Bestandseinbrüche wäre blind.
    lauf_meta["new_petitions_last_run"] = [
        s for s, r in store.items() if r.get("first_seen") == ts]
    save()

    # ------------------------------------------------------------------
    # 2. NACHPRÜFUNG der bekannten Petitionen
    # ------------------------------------------------------------------
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte Petition(en) …")
        prog(phase="check-known", current=0, total=len(known),
             message="Prüfe bekannte Petitionen …")
        skip_slugs, geprueft = [], 0
        for k, slug in enumerate(known, 1):
            prog(current=k, total=len(known), message=slug[:60])
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            geprueft += 1
            if status == "skip":
                # Nicht sofort löschen: bei einem Seitenumbau lieferten ALLE
                # bekannten Petitionen „nicht DE". Sammeln, unten mit Notbremse.
                skip_slugs.append(slug)
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/p/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug[:60]}")
        core.entferne_skip(store, skip_slugs, geprueft, "Change.org",
                           grund_de="nicht DE", grund_en="not DE", save=save)

    # Neu zählen: die Nachprüfung kann über heile_abgeschnittene/merge_records
    # weitere Sätze angelegt haben.
    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    lauf_meta["new_petitions_last_run"] = new_petitions
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False)
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
    openness_wunsch="Die Themenseiten zeigen je rund 21 Petitionen; „Mehr anzeigen“ "
                    "läuft über /api-proxy/, das die robots.txt sperrt. Über Sitemaps "
                    "sind zwar rund 16.000 Adressen auffindbar, der Weg zu ihren "
                    "Inhalten bleibt aber eng. Eine paginierte Liste ohne den "
                    "gesperrten Zwischenweg würde das lösen.",
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


# ----------------------------------------------------------------------------
# Der englische Eintrag
# ----------------------------------------------------------------------------
# ⚠️⚠️ BEI CHANGE.ORG GIBT ES KEINE SPRACHPAARE — und deshalb bewusst KEINE
# campaign_id. Am 12.8.2026 gemessen: jede Petition existiert in GENAU EINER
# Sprache ("originalLocale"), kein Feld und kein hreflang zeigt auf eine
# andere Fassung, und der Umschalter ?lang=de-DE tauscht nur die
# Bedienoberfläche — der Petitionstext bleibt Zeichen für Zeichen derselbe
# (description-md5 identisch). Der englische Eintrag bringt also eigenständige
# Petitionen, aber keine Übersetzungsverknüpfung. Wer hier eine Paarung
# einbaut, behauptet etwas, das es nicht gibt.
#
# ENTDECKUNG über die Ortsseiten statt über die Sitemap: die Monats-Sitemaps
# kennzeichnen die Sprache NICHT (nur <loc> und <lastmod>), weshalb der
# deutsche Zweig eine Wort-Heuristik braucht. Die 4.579 Ortsseiten aus
# sitemap-location_pages.xml enden ALLE auf „--us" und sind damit sprachlich
# sortenrein — ganz ohne Raten. Eine einzelne Ortsseite lieferte 24
# Petitions-Slugs.
EN_DATA_FILE = Path("changeorg_en_petitions.json")
EN_HTML_FILE = Path("changeorg_en_petitions.html")
LOCATION_SITEMAP = f"{BASE_URL}/sitemap-location_pages.xml"
LOCATION_LOC_RE = re.compile(r"<loc>(https://www\.change\.org/r/[^<]+)</loc>")
# ⚠️ Deckel. 4.579 Ortsseiten × ~24 Slugs wären ein Vielfaches des gesamten
# Tagesbudgets. Der Lauf nimmt ein WANDERNDES Fenster und merkt sich die
# Stelle im _meta — so ist jeder Lauf gleich teuer und der Bestand wächst
# über die Zeit, ohne dass irgendwo still etwas wegfällt.
EN_ORTE_JE_LAUF = 25
EN_NEUE_JE_LAUF = 300


def discover_en_slugs(fetcher: core.Fetcher,
                      offset: int = 0) -> tuple[dict[str, dict], int]:
    """({slug: {}}, neuer_offset) aus einem wandernden Fenster von Ortsseiten."""
    resp = fetcher.get(LOCATION_SITEMAP)
    orte = LOCATION_LOC_RE.findall(resp.text) if (resp and resp.ok) else []
    if not orte:
        log("  Ortsliste leer – Lauf ohne Entdeckung.")
        core.entdeckung("Ortsseiten-Sitemap", 0, erwartet_min=100,
                        name_en="location sitemap")
        return {}, offset
    core.entdeckung("Ortsseiten-Sitemap", len(orte), erwartet_min=100,
                    name_en="location sitemap")
    offset %= len(orte)
    fenster = [orte[(offset + i) % len(orte)] for i in range(EN_ORTE_JE_LAUF)]
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=len(fenster),
         message="Lade Ortsseiten …")
    for i, url in enumerate(fenster, 1):
        resp = fetcher.get(url)
        if resp is not None and resp.ok:
            for m in PETITION_SLUG_RE.finditer(resp.text):
                found.setdefault(m.group(1), {})
        prog(current=i, total=len(fenster),
             message=f"{len(found)} Slugs bisher")
    log(f"{len(fenster)} Ortsseite(n) ab Platz {offset} von {len(orte)}: "
        f"{len(found)} Petitions-Slugs.")
    return found, (offset + EN_ORTE_JE_LAUF) % len(orte)


def run_en(args) -> None:
    store = core.load_store(EN_DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()
    offset = int(core.load_meta(EN_DATA_FILE).get("orte_offset") or 0)

    def save(quiet=True, **extra):
        core.save_store(store, EN_DATA_FILE,
                        extra_meta={"orte_offset": offset, **extra},
                        quiet=quiet)

    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte englische Petition(en) …")
        prog(phase="check-known", current=0, total=len(known), message="…")
        weg = []
        for k, slug in enumerate(known, 1):
            prog(current=k, total=len(known), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug, "en")
            if status == "error":
                continue
            if status == "skip":
                weg.append(slug)
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/p/{slug}")
            save()
        for slug in weg:
            store.pop(slug, None)
        if weg:
            log(f"  {len(weg)} Satz/Sätze ohne englische Petition entfernt.")

    entdeckt, offset = discover_en_slugs(fetcher, offset)
    # Überlebt jeden Abbruch (s. save_store: _TLS.lauf_meta, 24.8.2026).
    core.lauf_meta_setzen(available=len(entdeckt))
    neu = [s for s in entdeckt if s not in store][:args.limit or EN_NEUE_JE_LAUF]
    log(f"{len(neu)} neue englische Petition(en) zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(neu), message="Beginne …")

    fremdsprachig = 0
    for i, slug in enumerate(neu, 1):
        prog(current=i, total=len(neu), message=slug)
        status, rec = scrape_petition(fetcher, slug, "en")
        if status == "error":
            continue
        if status == "skip":
            # Die Ortsseiten sind US-Seiten, aber nicht jede dort verlinkte
            # Petition ist englisch verfasst. Das ist kein Fehler, sondern
            # genau der Zweck der Sprachprüfung — nur zählen wollen wir es.
            fremdsprachig += 1
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts,
                    f"{BASE_URL}/p/{slug}")
        save()

    neue = [s for s, r in store.items() if r.get("first_seen") == ts]
    if neue:
        log(f"NEU: {len(neue)} neue englische Petition(en) in diesem Lauf.")
    if fremdsprachig:
        log(f"  {fremdsprachig} übersprungen (nicht englisch verfasst).")
    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=neue, available=len(entdeckt))
    core.write_list_html(PLATFORM_EN)
    log("Fertig (Change.org English).")


def check_en(fetcher):
    resp = fetcher.get(LOCATION_SITEMAP)
    if resp is None or not resp.ok:
        return False, "Ortsseiten-Sitemap nicht erreichbar"
    n = len(LOCATION_LOC_RE.findall(resp.text))
    return n >= 100, f"{n} Ortsseiten"


PLATFORM_EN = Platform(
    key="changeorg_en",
    openness=3,
    openness_wunsch="Die Ortsseiten sind server-gerendert und von der robots.txt "
                    "erlaubt — das ist der offene Teil. Weiterblättern führt aber "
                    "wieder über /api-proxy/, das gesperrt ist. Eine Pagination auf "
                    "demselben offenen Weg würde den Katalog vollständig erreichbar "
                    "machen.",
    openness_note="Mittel: die Ortsseiten /local/<stadt>--<state>--us sind "
                  "server-gerendert, von robots.txt erlaubt und sprachlich "
                  "sortenrein — anders als im deutschen Zweig braucht es "
                  "hier keine Wort-Heuristik. Weiterblättern ginge nur über "
                  "/api-proxy/, und das ist gesperrt.",
    name="Change.org (English)",
    eyebrow="Change.org · englische Petitionen (Ortsseiten)",
    source_url="https://www.change.org/?lang=en-US",
    data_file=EN_DATA_FILE,
    html_file=EN_HTML_FILE,
    run=run_en,
    check=check_en,
    language="en",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
