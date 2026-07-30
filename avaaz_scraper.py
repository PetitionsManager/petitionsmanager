#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  avaaz_scraper.py  —  Plattform-Modul für Avaaz (deutsch):
#                       Bürgerpetitionen + Avaaz-eigene Kampagnen
# =============================================================================
#
#  Scrapt die deutschsprachigen Community-Petitionen ("Bürgerpetitionen") UND
#  die von Avaaz selbst betriebenen Kampagnen. Beide landen im selben Store,
#  getrennt gekennzeichnet über das Feld "kind" ("petition" | "campaign") und
#  sichtbar über das Kategorie-Feld ("Bürgerpetition" bzw. "Avaaz-Kampagne
#  (Unterschriften|Spenden)") – damit funktioniert der Kategorie-Filter der
#  Listenansicht direkt als Umschalter. Nutzt petitions_core.py; Einstiegs-
#  punkt ist monitor.py.
#
#  QUELLEN (alle laut robots.txt von avaaz.org/secure.avaaz.org erlaubt –
#  gesperrt sind /api/, /campaigns/ (PLURAL) und der Legacy-Pfad
#  /community-petitions/ mit BINDESTRICH; erlaubt sind /community_petitions/
#  mit UNTERSTRICH sowie /campaign/ im SINGULAR bis auf zwei
#  Spenden-Testseiten unter /campaign/en/):
#    - https://avaaz.org/de/                       Startseite (featured;
#                                                  verlinkt Petitionen UND Kampagnen)
#    - https://secure.avaaz.org/community_petitions/de/        Übersicht
#    - …/community_petitions/de/popular_petitions.json         Beliebt (5)
#    - …/community_petitions/de/recent_petitions.json          Neu (5)
#    - …/community_petitions/de/<slug>/                        Petitions-Detail
#    - …/campaign/de/<slug>/                                   Kampagnen-Detail
#    - …/stats/petition/<id>_stats.json                        Unterschriften (Petition)
#    - …/stats/campaign/<id>_stats.json                        Stand+Ziel (Kampagne)
#
#  BESONDERHEITEN:
#  - Es gibt KEINE öffentliche "alle Petitionen"-Liste: Avaaz zeigt nur
#    kuratierte/beliebte/neue Petitionen (5–10 Stück). Jeder Lauf sammelt die
#    gerade sichtbaren; der Bestand wächst über die Zeit per Upsert.
#  - Der Unterschriftenstand steht NICHT im HTML (dort Platzhalter "1"),
#    sondern kommt live aus den Stats-Endpoints. Bei Petitionen liefert der
#    Endpoint kein Ziel → nächster Meilenstein über dem Stand (TARGETS unten
#    = 1:1 aus deren counter.js). Bei Kampagnen liefert er das Ziel direkt.
#  - Kampagnen sind entweder Unterschriften- oder Spenden-Kampagnen; der
#    Typ steht im MCounter-Text der Detailseite ("haben unterzeichnet" /
#    "haben gespendet"). Bei Spenden-Kampagnen zählt die "Unterschriften"-
#    Spalte also Spender*innen (per Kategorie kenntlich gemacht).
#  - Startdatum/Aktualisierung stehen als ms-Timestamps im Inline-JS
#    (createdAtTimestamp / updatedAtTimestamp).
#  - Die Petitions-Detailseite listet Starter*in + Adressat in einem Satz:
#    "<Name> hat diese Petition erstellt, an folgende Zielperson/Zielgruppe: <Adressat>"
#  - check-known unterscheidet Bestandsdatensätze über rec["kind"]
#    (fehlend = Petition, Altbestand) und baut daraus die richtige URL.
# =============================================================================

from __future__ import annotations

import datetime as _dt
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

import petitions_core as core
from petitions_core import Platform, log, now_iso, prog, sanitize_fragment

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL     = "https://secure.avaaz.org"
HOME_URL     = "https://avaaz.org/de/"
LIST_URL     = f"{BASE_URL}/community_petitions/de/"
DATA_FILE    = Path("avaaz_petitions.json")
HTML_FILE    = Path("avaaz_petitions.html")

PETITION_HREF_RE = re.compile(r"/community_petitions/de/([a-z0-9_]+)", re.I)
CAMPAIGN_HREF_RE = re.compile(r"/campaign/de/([a-z0-9_]+)", re.I)

# Seiten unterhalb von /community_petitions/de/, die keine Petitionen sind.
# (popular_/recent_petitions tauchen nur bei der Archiv-Suche auf – dort steht
# der Dateiname ohne Endung als vermeintlicher Slug im Pfad.)
NON_PETITION_SLUGS = {"about", "how_to_create_petition", "my_account",
                      "start_a_petition", "popular_petitions",
                      "recent_petitions", "search", "sitemap"}
# Seiten unter /campaign/de/, die keine Kampagnen sind.
NON_CAMPAIGN_SLUGS = {"donate"}

KIND_LABELS = {"petition": "Bürgerpetition",
               "campaign_sign": "Avaaz-Kampagne (Unterschriften)",
               "campaign_donate": "Avaaz-Kampagne (Spenden)"}

# Unterschriften-Ziel: nächster Meilenstein über dem Stand – exakt die
# TARGETS-Staffel aus Avaaz' eigenem counter.js.
TARGETS = [50, 100, 200, 300, 500, 750, 1000, 2000, 3000, 5000,
           7500, 10000, 20000, 30000, 50000, 75000, 100000,
           200000, 300000, 500000, 1000000]
TARGET_INCREMENT = 100000      # oberhalb von 1 Mio: nächstes 100k-Vielfaches

# Cloudflare vor avaaz.org blockt Nicht-Browser-User-Agents (403, sogar für
# robots.txt). Daher ein regulärer Browser-UA; die robots.txt-Regeln gelten
# per "User-agent: *" identisch und werden weiterhin beachtet.
FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

CREATED_RE = re.compile(r"createdAtTimestamp\s*=\s*(\d+)")
UPDATED_RE = re.compile(r"updatedAtTimestamp\s*=\s*(\d+)")
PETITION_ID_RE = re.compile(r"petitionId\s*=\s*(\d+)")
CAMPAIGN_ID_RE = re.compile(r"campaign_id:\s*(\d+)")
# MCounter-Text verrät den Kampagnen-Typ ("haben unterzeichnet"/"haben gespendet").
MCOUNTER_TEXT_RE = re.compile(r'MCounter\(\{[^}]*text:\s*"([^"]*)"', re.S)
STARTER_RE = re.compile(
    r"^(.*?)\s+hat diese Petition erstellt, an folgende "
    r"Zielperson/Zielgruppe:\s*(.*)$", re.S)


def _goal_for(count: int) -> int:
    for t in TARGETS:
        if count < t:
            return t
    # jenseits der Staffel: nächstes Vielfaches von TARGET_INCREMENT
    return ((count // TARGET_INCREMENT) + 1) * TARGET_INCREMENT


def _ms_to_iso(ms: str | int) -> str | None:
    try:
        return (_dt.datetime.fromtimestamp(int(ms) / 1000)
                .astimezone().replace(microsecond=0).isoformat())
    except (ValueError, OSError, OverflowError):
        return None


# ----------------------------------------------------------------------------
# Entdeckung der Petitionen
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> tuple[dict[str, dict], set[str]]:
    """(petitionen, kampagnen) aus Startseite, Übersicht und den
    popular/recent-JSON-Endpoints. petitionen = {slug: hint};
    kampagnen = {slug, …} (Avaaz-eigene Kampagnen, nur auf der Startseite
    verlinkt). Avaaz zeigt öffentlich nur kuratierte Inhalte – der Bestand
    wächst über die Zeit per Upsert."""
    found: dict[str, dict] = {}
    campaigns: set[str] = set()
    sources = [
        ("Startseite", HOME_URL, "html"),
        ("Übersicht", LIST_URL, "html"),
        ("Beliebt-Feed", f"{LIST_URL}popular_petitions.json", "json"),
        ("Neu-Feed", f"{LIST_URL}recent_petitions.json", "json"),
    ]
    prog(phase="discover", current=0, total=len(sources),
         message="Sammle Petitionen …")

    for i, (label, url, kind) in enumerate(sources, 1):
        resp = fetcher.get(url)
        added = 0
        if resp is not None and resp.ok:
            if kind == "json":
                try:
                    data = json.loads(resp.text)
                except ValueError:
                    data = {}
                for pet in data.get("petitions", []):
                    m = PETITION_HREF_RE.search(pet.get("petition_url", ""))
                    if not m:
                        continue
                    slug = m.group(1)
                    if slug in NON_PETITION_SLUGS:
                        continue
                    hint = found.setdefault(slug, {})
                    if pet.get("number_of_signatures") is not None:
                        hint["signatures"] = pet["number_of_signatures"]
                    if pet.get("id") is not None:
                        hint["petition_id"] = pet["id"]
                    added += 1
            else:
                for m in PETITION_HREF_RE.finditer(resp.text):
                    slug = m.group(1)
                    if slug in NON_PETITION_SLUGS or slug in found:
                        continue
                    found[slug] = {}
                    added += 1
                for m in CAMPAIGN_HREF_RE.finditer(resp.text):
                    slug = m.group(1)
                    if slug not in NON_CAMPAIGN_SLUGS:
                        campaigns.add(slug)
        log(f"{label}: +{added} (gesamt {len(found)} Petitionen, "
            f"{len(campaigns)} Kampagnen).")
        prog(current=i, total=len(sources),
             message=f"{label} geprüft · {len(found)} Petitionen, "
                     f"{len(campaigns)} Kampagnen bisher")

    return found, campaigns


# ----------------------------------------------------------------------------
# Archiv-Discovery: was Avaaz heute nicht mehr verlinkt
# ----------------------------------------------------------------------------
#  Avaaz zeigt öffentlich nur 5–10 kuratierte Petitionen. Alles andere ist zwar
#  weiterhin online, aber von keiner Seite mehr aus erreichbar – über die
#  normale Entdeckung also unauffindbar. Das Internet Archive hat die
#  Übersichtsseiten über Jahre mitgeschnitten und kennt dadurch rund 1.700
#  Slugs, von denen die meisten noch abrufbar sind.
#
#  Ablauf: `--archive` füllt die Warteschlange (steht im _meta der Datendatei),
#  jeder Lauf arbeitet danach ARCHIVE_BATCH Einträge ab. Kandidaten mit 404/410
#  wandern in die Dead-Liste und werden nie wieder eingereiht; sie kommen auch
#  NICHT als Offline-Datensatz in den Bestand – eine Petition, die wir nie
#  gesehen haben, „verschwindet" nicht, sie hat nur nie existiert.
# ----------------------------------------------------------------------------
def _q(kind: str, slug: str) -> str:
    """Warteschlangen-Eintrag: 'petition:slug' bzw. 'campaign:slug'."""
    return f"{kind}:{slug}"


def _unq(entry: str) -> tuple[str, str]:
    kind, _, slug = str(entry).partition(":")
    return slug, (kind or "petition")


# Pfade, die im Archiv als vermeintliche Slugs auftauchen, aber Technik sind.
ARCHIVE_JUNK = {"admin", "api", "contact", "create", "css", "event", "front",
                "gtm", "images", "index", "js", "privacy", "static", "v3"}


def _drop_truncations(slugs: list[str]) -> list[str]:
    """Abgeschnittene URL-Varianten aussortieren.

    Das Archiv hat viele Links aus HTML-Seiten mitgeschnitten, in denen die URL
    umbrochen oder gekürzt war. Dadurch stehen Ketten wie
    ``AKW_Cattenom_abschalten_Kein_`` / ``…_Fukushima_2_im`` / ``…_im_Herzen_Europas``
    nebeneinander – nur die längste ist echt, der Rest liefert 404.

    Regel: Ist ein Slug echtes Präfix eines anderen, fliegt der kürzere raus.
    In sortierter Reihenfolge genügt der Blick auf den direkten Nachfolger:
    liegt zwischen ``s`` und einer Verlängerung von ``s`` ein weiterer Eintrag,
    beginnt auch der zwangsläufig mit ``s``.

    Der seltene Fehlerfall – zwei echte Petitionen, deren Titel exakt
    ineinander stecken – kostet höchstens einen Eintrag, und der kommt über die
    normale Entdeckung wieder rein, sobald Avaaz ihn verlinkt."""
    slugs = sorted(slugs)
    return [s for i, s in enumerate(slugs)
            if not (i + 1 < len(slugs) and slugs[i + 1].startswith(s))]


def archive_candidates(fetcher: core.Fetcher) -> list[str]:
    """Warteschlangen-Einträge aus dem Internet Archive (Petitionen + Kampagnen)."""
    out: list[str] = []
    for prefix, pattern, kind, skip, label in (
        (f"{BASE_URL}/community_petitions/de/", PETITION_HREF_RE, "petition",
         NON_PETITION_SLUGS, "Petitions-Slugs"),
        (f"{BASE_URL}/campaign/de/", CAMPAIGN_HREF_RE, "campaign",
         NON_CAMPAIGN_SLUGS, "Kampagnen-Slugs"),
    ):
        roh = core.wayback_slugs(fetcher, prefix, pattern, label=label)
        sauber = [s for s in _drop_truncations(roh)
                  if s not in skip and s.lower() not in ARCHIVE_JUNK]
        log(f"  {label}: {len(roh)} → {len(sauber)} nach Abzug von "
            f"Kappungen und Technikpfaden.")
        out.extend(_q(kind, s) for s in sauber)
    return out


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

    h1 = soup.select_one("h1.petition-page-title")
    title = ((h1.get_text(strip=True) if h1 else None)
             or _meta(soup, "og:title"))
    if title:
        # Zeilenumbrüche und Rest-Entities (&excl; u. ä.) normalisieren.
        import html as _html
        title = re.sub(r"\s+", " ", _html.unescape(title)).strip()
    rec["title"] = title
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    canon = soup.find("link", rel="canonical")
    rec["url"] = (canon["href"].strip() if canon and canon.get("href")
                  else _meta(soup, "og:url") or url)

    # Interne Petitions-ID (für stats.json) aus dem Inline-JS.
    m_id = PETITION_ID_RE.search(html)
    rec["petition_id"] = int(m_id.group(1)) if m_id else None

    # Starter*in + Adressat aus dem Ersteller-Satz.
    upd = soup.select_one(".user-petition-data")
    if upd:
        m = STARTER_RE.match(upd.get_text(" ", strip=True))
        if m:
            rec["started_by"] = m.group(1).strip()[:200] or None
            rec["recipient"] = m.group(2).strip() or None

    # Beschreibung: kompletter Text mit erhaltener Gliederung.
    desc = soup.select_one(".petition-page-description")
    if desc:
        rec["description_full"] = sanitize_fragment(desc, BASE_URL) or None

    # Start-/Aktualisierungsdatum aus den ms-Timestamps im Inline-JS.
    m_created = CREATED_RE.search(html)
    if m_created:
        rec["start_date"] = _ms_to_iso(m_created.group(1))
    m_updated = UPDATED_RE.search(html)
    if m_updated:
        iso = _ms_to_iso(m_updated.group(1))
        if iso and iso != rec.get("start_date"):
            rec["updates"] = [{"timestamp": iso,
                               "text": "Petitionstext aktualisiert"}]

    # Avaaz hat keine Themen-Kategorien; das Kategorie-Feld kennzeichnet
    # stattdessen die Art des Eintrags (Bürgerpetition vs. Avaaz-Kampagne).
    rec["kind"] = "petition"
    rec["category"] = KIND_LABELS["petition"]
    rec["category_url"] = None
    return rec


def fetch_signatures(fetcher: core.Fetcher, petition_id: int) -> int | None:
    """Live-Unterschriftenstand aus dem Stats-Endpoint (im HTML steht nur
    ein Platzhalter)."""
    resp = fetcher.get(f"{BASE_URL}/stats/petition/{petition_id}_stats.json")
    if resp is None or not resp.ok:
        return None
    try:
        data = json.loads(resp.text)
    except ValueError:
        return None
    val = data.get("signatures", data.get("count"))
    return int(val) if val is not None else None


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error."""
    url = f"{BASE_URL}/community_petitions/de/{slug}/"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None

    rec = parse_detail(resp.text, url)
    if rec.get("petition_id"):
        sig = fetch_signatures(fetcher, rec["petition_id"])
        if sig is not None:
            rec["signatures"] = sig
            rec["goal"] = _goal_for(sig)
    return "online", rec


# ----------------------------------------------------------------------------
# Avaaz-eigene Kampagnen (/campaign/de/<slug>/)
# ----------------------------------------------------------------------------
# h1-Texte, die KEIN Kampagnentitel sind: Im "Offener Brief"-Layout mancher
# Kampagnen ist das einzige h1 die Überschrift der Teilen-Sektion.
_GENERIC_H1 = {"weitersagen", "teilen", "share", "jetzt unterschreiben"}


# Bausteine der Seitenform „Offener Brief". Avaaz benutzt sie für einen Teil
# der Kampagnen (2026-07-29: 3 von 7); dort fehlt .margin_left_campaign, und
# genau diese drei standen in der App ohne einen Satz Text da. Reihenfolge hier
# = Leserichtung, nicht DOM-Reihenfolge: im HTML steht der Unterschriftenblock
# vor dem Brief.
BRIEF_TEILE = (
    ".open-letter-intro",                          # Anschrift
    "article.open-letter-intro-quote",             # der Brief selbst
    ".open-letter-content > article:not([class])",  # Hintergrund/„Weitere Infos"
)


def _offener_brief(soup) -> str | None:
    """Beschreibung aus der Seitenform „Offener Brief" zusammensetzen.

    Die drei Bausteine werden EINZELN bereinigt und dann verbunden. Nimmt man
    stattdessen den ganzen Container, löst sanitize_fragment die div/article-
    Hüllen auf und der komplette Brief landet in einem einzigen Absatz.

    Gearbeitet wird auf Kopien: der Container trägt auch den
    Unterschriftenblock, aus dem an anderer Stelle der Zähler gelesen wird –
    der darf im Original nicht verschwinden.
    """
    teile = []
    for sel in BRIEF_TEILE:
        node = soup.select_one(sel)
        if not node:
            continue
        kopie = BeautifulSoup(str(node), "html.parser").find(node.name)
        teile.append(sanitize_fragment(kopie, BASE_URL))
    return "\n".join(t for t in teile if t) or None


def parse_campaign(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    # Volle Überschrift steht meist im (klassenlosen) h1; og:title ist oft
    # gekürzt. Generische h1 (Teilen-Sektion) aber überspringen.
    h1 = soup.find("h1")
    h1_text = h1.get_text(strip=True) if h1 else None
    if h1_text and h1_text.lower().strip() in _GENERIC_H1:
        h1_text = None
    title = h1_text or _meta(soup, "og:title")
    if title:
        import html as _html
        title = re.sub(r"\s+", " ", _html.unescape(title)).strip()
    rec["title"] = title
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    canon = soup.find("link", rel="canonical")
    rec["url"] = (canon["href"].strip() if canon and canon.get("href")
                  else _meta(soup, "og:url") or url)

    # Interne Kampagnen-ID (für stats.json) aus dem MCounter-Inline-JS.
    m_id = CAMPAIGN_ID_RE.search(html)
    rec["petition_id"] = int(m_id.group(1)) if m_id else None

    # Typ (Unterschriften vs. Spenden) aus dem MCounter-Text.
    m_txt = MCOUNTER_TEXT_RE.search(html)
    donate = bool(m_txt and "gespendet" in m_txt.group(1))
    rec["kind"] = "campaign"
    rec["category"] = KIND_LABELS["campaign_donate" if donate else "campaign_sign"]
    rec["category_url"] = None
    rec["started_by"] = "Avaaz-Team"

    # Beschreibung: Artikel-Block der klassischen Kampagnenseite, sonst die
    # Form „Offener Brief".
    desc = soup.select_one(".margin_left_campaign article")
    if desc:
        rec["description_full"] = sanitize_fragment(desc, BASE_URL) or None
    else:
        rec["description_full"] = _offener_brief(soup)

    m_created = CREATED_RE.search(html)
    if m_created:
        rec["start_date"] = _ms_to_iso(m_created.group(1))
    return rec


def fetch_campaign_stats(fetcher: core.Fetcher,
                         campaign_id: int) -> tuple[int | None, int | None]:
    """(stand, ziel) aus dem Kampagnen-Stats-Endpoint. Anders als bei den
    Petitionen liefert er das Ziel direkt mit ("target")."""
    resp = fetcher.get(f"{BASE_URL}/stats/campaign/{campaign_id}_stats.json")
    if resp is None or not resp.ok:
        return None, None
    try:
        data = json.loads(resp.text)
    except ValueError:
        return None, None
    sig = data.get("signatures")
    target = data.get("target")
    return (int(sig) if sig is not None else None,
            int(target) if target is not None else None)


def scrape_campaign(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) für eine Avaaz-eigene Kampagne.

    status "skip" = Seite existiert, ist aber keine Aktions-Kampagne (kein
    MCounter/keine campaign_id, z. B. CEO-Brief oder Berichte-Hub) – nicht
    aufnehmen bzw. aus dem Bestand entfernen."""
    url = f"{BASE_URL}/campaign/de/{slug}/"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None

    rec = parse_campaign(resp.text, url)
    if not rec.get("petition_id"):
        return "skip", None
    sig, target = fetch_campaign_stats(fetcher, rec["petition_id"])
    if sig is not None:
        rec["signatures"] = sig
        rec["goal"] = target if target else _goal_for(sig)
    return "online", rec


def _scrape_any(fetcher: core.Fetcher, slug: str,
                kind: str) -> tuple[str, dict | None, str]:
    """Dispatcher für check-known: wählt Scraper + URL anhand von kind."""
    if kind == "campaign":
        status, rec = scrape_campaign(fetcher, slug)
        return status, rec, f"{BASE_URL}/campaign/de/{slug}/"
    status, rec = scrape_petition(fetcher, slug)
    return status, rec, f"{BASE_URL}/community_petitions/de/{slug}/"


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()
    arch_todo, arch_dead = core.archive_queue(DATA_FILE)

    def save(quiet=True, **extra):
        # Die Archiv-Warteschlange muss bei jedem Speichern mit, sonst ist sie
        # nach dem nächsten Schreibvorgang weg (save_store ersetzt _meta).
        core.save_store(store, DATA_FILE,
                        extra_meta={"archive_todo": arch_todo,
                                    "archive_dead": arch_dead, **extra},
                        quiet=quiet)

    # Bekannte Einträge zuerst prüfen (Status/Unterschriften auffrischen).
    # rec["kind"] steuert Scraper + URL; Altbestand ohne kind = Petition.
    known_slugs = list(store.keys())
    if known_slugs and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known_slugs)} bekannte Einträge …")
        prog(phase="check-known", current=0, total=len(known_slugs),
             message="Prüfe bekannte Einträge …")
        for k, slug in enumerate(known_slugs, 1):
            prog(current=k, total=len(known_slugs), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            kind = store[slug].get("kind", "petition")
            status, rec, url = _scrape_any(fetcher, slug, kind)
            if status == "error":
                continue
            if status == "skip":
                del store[slug]        # Info-Seite, keine Aktions-Kampagne
                log(f"  ENTFERNT (keine Aktions-Kampagne): {slug}")
                save()
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts, url)
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
    elif args.no_recheck:
        log("Prüfung bekannter Einträge übersprungen (--no-recheck).")

    log("Sammle Petitionen & Kampagnen (Startseite, Übersicht, Feeds) …")
    discovered, campaigns = discover_slugs(fetcher)
    known_set = set(known_slugs)
    # Neue Arbeit: (slug, kind)-Paare; Kampagnen-Slug kollidiert praktisch nie
    # mit Petitions-Slugs (andere Namenskonvention), Petition hätte Vorrang.
    new_work = ([(s, "petition") for s in discovered if s not in known_set]
                + [(s, "campaign") for s in campaigns
                   if s not in known_set and s not in discovered])
    for slug, hint in discovered.items():
        if slug in known_set:
            core.upsert(store, slug, {}, hint, "online", ts,
                        f"{BASE_URL}/community_petitions/de/{slug}/")
    if args.limit:
        new_work = new_work[:args.limit]
    log(f"{len(new_work)} neue Einträge zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_work), message="Beginne Scrape …")

    for i, (slug, kind) in enumerate(new_work, 1):
        log(f"({i}/{len(new_work)}) [{kind}] {slug}")
        prog(current=i, total=len(new_work), message=slug)
        status, rec, url = _scrape_any(fetcher, slug, kind)
        if status == "error":
            log("  übersprungen (Fehler) – Datensatz bleibt unverändert.")
            continue
        if status == "skip":
            log("  übersprungen (keine Aktions-Kampagne).")
            continue
        core.upsert(store, slug, rec or {}, discovered.get(slug, {}), status,
                    ts, url)
        save()

    # --- Archiv-Kandidaten -------------------------------------------------
    if getattr(args, "archive", False):
        kandidaten = archive_candidates(fetcher)
        if kandidaten:
            # Neu aufbauen statt anhängen: so verschwinden Altlasten aus
            # früheren, noch ungefilterten Läufen von selbst wieder.
            erledigt = set(arch_dead) | {
                _q(r.get("kind", "petition"), s) for s, r in store.items()}
            vorher = len(arch_todo)
            arch_todo[:] = [e for e in kandidaten if e not in erledigt]
            log(f"Archiv: Warteschlange neu aufgebaut – {len(arch_todo)} offen "
                f"(vorher {vorher}; {len(arch_dead)} bereits als weg bekannt).")
            save()
        else:
            log("Archiv: keine Kandidaten erhalten (Abfrage fehlgeschlagen?) – "
                "Warteschlange unverändert.")

    batch = int(getattr(args, "archive_batch", core.ARCHIVE_BATCH) or 0)
    if args.limit:
        batch = 0        # Testläufe nicht mit dem Rückstand volllaufen lassen
    if batch and arch_todo:
        todo = arch_todo[:batch]
        log(f"Archiv-Rückstand: {len(arch_todo)} offen, prüfe {len(todo)} "
            f"in diesem Lauf …")
        prog(phase="archive", current=0, total=len(todo),
             message="Prüfe Archiv-Kandidaten …")
        gefunden = weg = 0
        for i, entry in enumerate(todo, 1):
            slug, kind = _unq(entry)
            prog(current=i, total=len(todo), message=slug)
            status, rec, url = _scrape_any(fetcher, slug, kind)
            arch_todo.remove(entry)
            if status == "error":
                arch_todo.append(entry)   # ans Ende: nächster Lauf, nicht nie
                continue
            if status in ("offline", "skip"):
                # Nie gesehen und heute weg → gar nicht erst aufnehmen.
                arch_dead.append(entry)
                weg += 1
                continue
            core.upsert(store, slug, rec or {}, {}, "online", ts, url)
            gefunden += 1
            save()
        log(f"Archiv: {gefunden} wiedergefunden, {weg} endgültig weg, "
            f"{len(arch_todo)} bleiben offen.")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Einträge in diesem Lauf: "
            f"{', '.join(new_petitions[:10])}"
            f"{' …' if len(new_petitions) > 10 else ''}")
    else:
        log("Keine neuen Einträge seit dem letzten Lauf gefunden.")

    prog(message="Speichere & baue HTML …")
    # Vollständigkeit ehrlich halten: solange Archiv-Kandidaten offen sind,
    # kennen wir nachweislich mehr Petitionen, als im Bestand stehen.
    available = max(len(discovered) + len(campaigns),
                    len(store) + len(arch_todo))
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=available)
    core.write_list_html(PLATFORM)
    log("Fertig (Avaaz).")


def check(fetcher):
    # Entdeckung läuft über die Startseite (avaaz.org/de/), nicht über
    # secure.avaaz.org (dessen robots per Cloudflare zeitweise alles sperrt).
    resp = fetcher.get(HOME_URL)
    if resp is None or not resp.ok:
        return False, "Startseite nicht erreichbar"
    n = len(set(PETITION_HREF_RE.findall(resp.text)) |
            set(CAMPAIGN_HREF_RE.findall(resp.text)))
    return (n >= 1), f"{n} Aktionen (Startseite)"

PLATFORM = Platform(
    key="avaaz",
    openness=2,
    openness_note="Eingeschränkt: keine öffentliche Gesamtliste (nur ~5-10 "
                  "kuratierte/beliebte/neue), Zähler nur via Stats-JSON, "
                  "Cloudflare blockt Nicht-Browser-Clients. Der Altbestand "
                  "kommt über das Internet Archive herein (--archive), "
                  "portionsweise über mehrere Läufe.",
    name="Avaaz",
    eyebrow="Avaaz · Bürgerpetitionen & Kampagnen (deutsch)",
    source_url="https://secure.avaaz.org/community_petitions/de/",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
