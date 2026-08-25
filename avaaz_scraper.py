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

import i18n_helfer as i18n
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

# ⚠️ Avaaz beantwortet einen ungültigen Slug NICHT immer mit 404. Am 8.8.2026
# an drei Proben gemessen:
#   Bundesregierung_Schluss_mit_dem   → HTTP 404, 23.569 Zeichen (echte Fehlerseite)
#   Beendigung_der_Diskriminierung_…  → HTTP 200, 503 Zeichen
#   frei erfundener Slug              → HTTP 404, 23.569 Zeichen
# Die 503 Bytes sind eine Weiterleitungshülle: „This page is not valid", ein
# <meta http-equiv="Refresh"> und ein window.location auf die Übersichtsseite.
# Sie hat keinen Titel und kein <link rel=canonical> — WOHL ABER
# <meta property="og:url" content=".../community_petitions/de/">.
#
# Genau daran ist der Bestand erkrankt: parse_detail nimmt canonical, sonst
# og:url — und bekam so die ÜBERSICHTSSEITE als Petitionsadresse. Alle so
# entstandenen Sätze teilten sich eine Adresse (Dashboard-Warnung „Mehrere
# Sätze auf derselben Adresse") und blieben titellos (die 28 „ohne Titel").
# Beide offenen Avaaz-Punkte hatten damit dieselbe eine Ursache.
#
# Die frühere Notiz „Avaaz antwortet dort sauber mit 404" war nicht falsch,
# sondern hat die andere Hälfte getroffen: es gibt BEIDE Verhaltensweisen.
UNGUELTIG_TEXT_RE = re.compile(r"This page is not valid", re.I)
META_REFRESH_RE = re.compile(
    r'http-equiv=["\']?refresh["\']?[^>]*?url=\s*["\']?([^"\'>\s]+)', re.I)
# Eine Detailadresse hat unterhalb von /community_petitions/de/ bzw.
# /campaign/de/ noch ein Wegstück. Alles andere ist eine Übersichtsseite.
# Geprüft wird mit core.eigene_adresse — dort steht, warum.
DETAILADRESSE_RE = re.compile(
    r"^https://secure\.avaaz\.org/(?:community_petitions|campaign)/de/[^/?#]+", re.I)

# ---- Der englische Eintrag (12.8.2026) --------------------------------------
# Bei Avaaz ist die Sprache ein eigenes PFADSEGMENT und der Slug in allen
# Sprachen derselbe — deshalb genügt es, die Adressen und Muster je Sprache zu
# bauen. Genau das macht die Kennung _kampagne() symmetrisch.
# ⚠️ robots.txt erlaubt /community_petitions/ (UNTERSTRICH) und /campaign/
# (SINGULAR); gesperrt sind /api/, /campaigns/ (Plural) und der Legacy-Pfad
# mit Bindestrich. Zwei Spenden-Testseiten unter /campaign/en/ sind dort
# ausdrücklich gesperrt — der Fetcher beachtet die robots.txt ohnehin, es
# braucht dafür also keine eigene Ausnahmeliste.
EN_HOME_URL = "https://avaaz.org/en/"
EN_LIST_URL = f"{BASE_URL}/community_petitions/en/"
EN_DATA_FILE = Path("avaaz_en_petitions.json")
EN_HTML_FILE = Path("avaaz_en_petitions.html")
EN_PETITION_HREF_RE = re.compile(r"/community_petitions/en/([a-z0-9_]+)", re.I)
EN_CAMPAIGN_HREF_RE = re.compile(r"/campaign/en/([a-z0-9_]+)", re.I)
EN_DETAILADRESSE_RE = re.compile(
    r"^https://secure\.avaaz\.org/(?:community_petitions|campaign)/en/[^/?#]+", re.I)


def _sprachteile(sprache: str):
    """(home, list, petition_re, campaign_re, detail_re) für eine Sprache."""
    if sprache == "en":
        return (EN_HOME_URL, EN_LIST_URL, EN_PETITION_HREF_RE,
                EN_CAMPAIGN_HREF_RE, EN_DETAILADRESSE_RE)
    return (HOME_URL, LIST_URL, PETITION_HREF_RE,
            CAMPAIGN_HREF_RE, DETAILADRESSE_RE)


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
# ⚠️ Muss NACH FETCH_HEADERS stehen. Weiter oben führte dieselbe Zeile beim
# Import zu einem NameError — und py_compile findet das nicht, weil es erst
# zur Laufzeit auffällt.
FETCH_HEADERS_EN = dict(FETCH_HEADERS,
                        **{"Accept-Language": "en-US,en;q=0.9"})

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
def discover_slugs(fetcher: core.Fetcher,
                   sprache: str = "de") -> tuple[dict[str, dict], set[str]]:
    """(petitionen, kampagnen) aus Startseite, Übersicht und den
    popular/recent-JSON-Endpoints. petitionen = {slug: hint};
    kampagnen = {slug, …} (Avaaz-eigene Kampagnen, nur auf der Startseite
    verlinkt). Avaaz zeigt öffentlich nur kuratierte Inhalte – der Bestand
    wächst über die Zeit per Upsert."""
    found: dict[str, dict] = {}
    campaigns: set[str] = set()
    home, liste, PET_RE, CAMP_RE, _ = _sprachteile(sprache)
    sources = [
        ("Startseite", home, "html"),
        ("Übersicht", liste, "html"),
        ("Beliebt-Feed", f"{liste}popular_petitions.json", "json"),
        ("Neu-Feed", f"{liste}recent_petitions.json", "json"),
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
                    m = PET_RE.search(pet.get("petition_url", ""))
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
                for m in PET_RE.finditer(resp.text):
                    slug = m.group(1)
                    if slug in NON_PETITION_SLUGS or slug in found:
                        continue
                    found[slug] = {}
                    added += 1
                for m in CAMP_RE.finditer(resp.text):
                    slug = m.group(1)
                    if slug not in NON_CAMPAIGN_SLUGS:
                        campaigns.add(slug)
        log(f"{label}: +{added} (gesamt {len(found)} Petitionen, "
            f"{len(campaigns)} Kampagnen).")
        prog(current=i, total=len(sources),
             message=f"{label} geprüft · {len(found)} Petitionen, "
                     f"{len(campaigns)} Kampagnen bisher")

    # Beide Zweige bleiben bewusst auf der Standardschwelle 1, also „meldet nur
    # den Totalausfall". Gemessen am 8.8.2026: 7 Petitionen, 7 Kampagnen –
    # Avaaz zeigt öffentlich nur kuratierte Inhalte, der Bestand wächst per
    # Upsert. Bei einstelligen Zahlen ist jede höhere Schwelle geraten: aus 7
    # können morgen legitim 3 werden, und eine Warnung, die bei normaler
    # Kuratierung anschlägt, entwertet die echten Warnungen daneben. Was hier
    # zählt, ist der Sprung auf null.
    core.entdeckung("Petitions-Quellen", len(found),
                    name_en="petition sources")
    # Die Kampagnen hängen an EINER Quelle (nur die Startseite verlinkt sie) –
    # der Zweig kann still verschwinden, ohne dass die Petitionen es zeigen.
    core.entdeckung("Avaaz-eigene Kampagnen", len(campaigns),
                    name_en="Avaaz’s own campaigns")
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


def _doc_title(soup: BeautifulSoup) -> str | None:
    """<title> der Seite, ohne die Marken-Zutat.

    Avaaz schreibt dort "Avaaz - <Überschrift>" (gelegentlich mit
    Gedankenstrich oder umgekehrter Reihenfolge). Ohne das Abschneiden stünde
    in der App bei jedem so gewonnenen Titel ein führendes "Avaaz - ".
    Bleibt nach dem Abschneiden nichts oder nur noch der Markenname übrig,
    lieber None zurückgeben als eine leere Überschrift zu schreiben.
    """
    if not soup.title or not soup.title.string:
        return None
    t = re.sub(r"\s+", " ", soup.title.string).strip()
    t = re.sub(r"^\s*Avaaz\s*[-–—|:]\s*", "", t, flags=re.I)
    t = re.sub(r"\s*[-–—|]\s*Avaaz\s*$", "", t, flags=re.I)
    t = t.strip()
    return t or None


def parse_detail(html: str, url: str,
                 muster: re.Pattern = None) -> dict:
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
    rec["url"] = core.eigene_adresse(
        (canon.get("href") if canon else None) or _meta(soup, "og:url"), url,
        muster if muster is not None else DETAILADRESSE_RE)

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
    return core.zahl(val)


def ungueltige_seite(html: str, url: str) -> bool:
    """Ist das Avaaz' „This page is not valid"-Hülle statt einer Petition?

    Zwei unabhängige Merkmale, es genügt eines:
    (a) der englische Satz im Rumpf — kurz und eindeutig, aber übersetzbar;
    (b) eine Meta-Weiterleitung WEG von der angeforderten Adresse. Eine echte
        Petitionsseite leitet nirgendwohin; das Merkmal überlebt daher auch
        eine Übersetzung oder eine Textänderung.

    Absichtlich NICHT über die Länge (503 Zeichen) — eine Zahl, die die Quelle
    jederzeit ändert, wäre ein Erkenner mit Verfallsdatum."""
    if UNGUELTIG_TEXT_RE.search(html):
        return True
    m = META_REFRESH_RE.search(html)
    return bool(m and m.group(1).rstrip("/") != url.rstrip("/"))


# ---------------------------------------------------------------------------
# SPRACHFASSUNGEN
#
# Avaaz führt die Sprache als Segment im Pfad, und zwar in BEIDEN Adressformen:
# /community_petitions/de/<slug>/ und /campaign/de/<slug>/. Der Slug selbst
# bleibt in allen Sprachen gleich — er ist damit die gemeinsame Kennung.
# Am 8.8.2026 an je einer live Petition geprüft:
#   /campaign/de/land_rights_evergreen_2026/
#       „Lula da Silvas Unterschrift für unseren Planeten"
#   /campaign/en/land_rights_evergreen_2026/
#       „Lula's Signature to Protect Our Planet"
#   /community_petitions/de/Stand_with_the_Philippines/
#       „Seite an Seite mit den Philippinen"
#   /community_petitions/en/Stand_with_the_Philippines/
#       „Stand with the Philippines"
#
# ⚠️ EIN ERSTER VERSUCH SCHLUG FEHL UND WAR TROTZDEM KEIN GEGENBEWEIS: die
# Probe traf eine GELÖSCHTE Petition, die in beiden Sprachen 404 lieferte. Wer
# hier misst, muss einen Satz mit status == "online" nehmen.
#
# ⚠️ Und Avaaz beantwortet einen ungültigen Slug nicht immer mit 404, sondern
# teils mit HTTP 200 und einer 503 Byte großen Weiterleitungshülle. Deshalb
# läuft die Fremdsprache durch dieselbe ungueltige_seite()-Prüfung wie die
# Hauptsprache — sonst landete die Übersichtsseite als „englische Fassung" im
# Datensatz.
FREMDSPRACHEN = ("en",)


def _kampagne(bereich: str, slug: str) -> str:
    """Gemeinsame Kennung aller Sprachfassungen.

    Das Sprachkürzel ist bei Avaaz ein eigenes Pfadsegment, der Slug bleibt in
    allen Sprachen gleich — beide Richtungen ergeben denselben Wert:
        /community_petitions/de/<slug>/  ->  avaaz:community_petitions:<slug>
        /community_petitions/en/<slug>/  ->  avaaz:community_petitions:<slug>
    ⚠️ Groß-/Kleinschreibung NICHT anfassen: der Bestand enthält beide Formen
    (z. B. „Stand_with_the_Philippines")."""
    return f"avaaz:{bereich}:{slug}"


def _fremdsprachen_holen(fetcher: core.Fetcher, rec: dict, slug: str,
                         bereich: str, parser, sprache: str = "de") -> None:
    """Die übrigen Sprachfassungen an `rec` hängen.

    `bereich` ist „community_petitions" oder „campaign", `parser` der passende
    Parser — die beiden Seitenformen sind verschieden aufgebaut, die
    Sprachlogik ist dieselbe."""
    # ⚠️⚠️ Hauptsprache und Kennung stehen VOR dem Schalter, nicht dahinter.
    # Bis zum 12.8.2026 lagen beide darunter — und weil der Tageslauf mit
    # --keine-sprachen fährt, hätte dort JEDER neue Avaaz-Satz ohne
    # campaign_id geendet und wäre nie mit seiner Fassung in der anderen
    # Sprache verknüpft worden. Lokal fiel das nicht auf (30 von 30 Sätzen
    # haben eine, sie stammen aus Läufen MIT Sprachen). 350.org macht es
    # richtig und begründet es dort auch: die Kennung kostet nichts und
    # verbindet die Fassungen, sobald sie da sind.
    i18n.setze_hauptsprache(rec, sprache)
    rec["campaign_id"] = _kampagne(bereich, slug)
    # Die zweite Fassung IN denselben Satz zu holen, lohnt nur für den
    # deutschen Eintrag und ist zudem abschaltbar (siehe i18n_helfer): der
    # Tageslauf verzichtet darauf, ein eigener Lauf holt sie nach.
    if sprache != "de" or not i18n.aktiv():
        return
    for lang in FREMDSPRACHEN:
        url = f"{BASE_URL}/{bereich}/{lang}/{slug}/"
        resp = fetcher.get(url)
        if resp is None:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
            continue
        if resp.status_code in (404, 410):
            i18n.setze_sprachfassung(rec, lang, "fehlt")
            continue
        if not resp.ok:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
            continue
        if ungueltige_seite(resp.text, url):
            # Die Hülle „This page is not valid" — die Sprachfassung gibt es
            # nicht. Das ist ein Befund, kein Fehler.
            i18n.setze_sprachfassung(rec, lang, "fehlt")
            continue
        fremd = parser(resp.text, url)
        if (fremd.get("title") or "").strip():
            i18n.setze_sprachfassung(rec, lang, "vorhanden", fremd)
        else:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")


def scrape_petition(fetcher: core.Fetcher, slug: str,
                    sprache: str = "de") -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error | skip.

    „skip" heißt: die Adresse gibt es, sie trägt aber keine Petition. Der
    Aufrufer entfernt solche Sätze aus dem Bestand — dieselbe Behandlung wie
    bei Kampagnen ohne Aktion. Damit räumt der nächste Lauf die Altlast von
    selbst weg, ohne dass jemand am Datenbestand herumschneidet."""
    url = f"{BASE_URL}/community_petitions/{sprache}/{slug}/"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    if ungueltige_seite(resp.text, url):
        return "skip", None

    rec = parse_detail(resp.text, url, _sprachteile(sprache)[4])
    if rec.get("petition_id"):
        sig = fetch_signatures(fetcher, rec["petition_id"])
        if sig is not None:
            rec["signatures"] = sig
            rec["goal"] = _goal_for(sig)
    _fremdsprachen_holen(fetcher, rec, slug, "community_petitions",
                         parse_detail, sprache)
    return "online", rec


# ----------------------------------------------------------------------------
# Avaaz-eigene Kampagnen (/campaign/de/<slug>/)
# ----------------------------------------------------------------------------
# h1-Texte, die KEIN Kampagnentitel sind: Im "Offener Brief"-Layout mancher
# Kampagnen ist das einzige h1 die Überschrift der Teilen-Sektion.
#
# ⚠️ Diese Liste war bis zum 8.8.2026 rein DEUTSCH — und fiel genau in dem
# Moment auf, als der Scraper anfing, auch die englische Seite zu holen:
# /campaign/en/land_rights_evergreen_2026/ lieferte als Titel „Tell Your
# Friends", also die Überschrift des Teilen-Blocks, während die deutsche Seite
# („WEITERSAGEN") sauber gefiltert wurde. Wer hier eine Sprache ergänzt, muss
# ihre Entsprechungen mit aufnehmen, sonst wandert eine Bedienbeschriftung als
# Petitionstitel in die App.
_GENERIC_H1 = {
    # deutsch
    "weitersagen", "teilen", "jetzt unterschreiben",
    "freunde und bekannte informieren",
    # englisch
    "share", "tell your friends", "sign now", "sign the petition",
}
# ⚠️ „freunde und bekannte informieren" ergänzt am 24.8.2026. Es ist die
# deutsche Entsprechung von „tell your friends", das seit dem 8.8. drinsteht —
# diesmal fehlte also die DEUTSCHE Seite, während die englische sauber
# gefiltert wurde. Genau der Fall, vor dem der Absatz oben warnt, nur
# andersherum.
#
# Am ausgelieferten Bestand gemessen, bevor die Zeile eingebaut wurde:
# 95 der 2.408 Avaaz-Sätze (3,9 %) trugen diesen Text als Titel — mit
# 95 VERSCHIEDENEN URLs, also 95 verschiedene Kampagnen unter einer
# Bedienbeschriftung. In der App standen sie untereinander als „gleiche
# Petitionen", weil die Ähnlichkeit über den Titel läuft.
# An der Quelle gegengeprüft (secure.avaaz.org/campaign/de/save_the_bees_
# canada_loc/): <h1> = „FREUNDE UND BEKANNTE INFORMIEREN", <title> =
# „Avaaz - Kanada: Rettet die Bienen". Der richtige Titel war also da, nur
# eine Ebene weiter — _doc_title() holt ihn jetzt.
#
# ⚠️ Die übrigen Mehrfachtitel im Bestand sind KEINE Fehler und gehören
# NICHT hierher: „Geheimes Abkommen TISA stoppen!" (10×), „EU-Verbot für
# Privatjets" (9×) usw. sind echte Kampagnen, die Avaaz unter mehreren
# Slugs führt. Die anderen drei großen Plattformen haben keinen einzigen
# Titel, der viermal oder öfter vorkommt — der Befund ist also auf Avaaz
# und auf diesen einen Wortlaut begrenzt.


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


def parse_campaign(html: str, url: str,
                   muster: re.Pattern = None) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    # Volle Überschrift steht meist im (klassenlosen) h1; og:title ist oft
    # gekürzt. Generische h1 (Teilen-Sektion) aber überspringen.
    h1 = soup.find("h1")
    h1_text = h1.get_text(strip=True) if h1 else None
    if h1_text and h1_text.lower().strip() in _GENERIC_H1:
        h1_text = None
    # <title> VOR og:title (2026-08-03). Bei den Dauerkampagnen
    # ("..._evergreen_...") verwendet Avaaz dieselbe URL für wechselnde
    # Inhalte und pflegt dabei den og:title nicht nach -- der beschreibt dann
    # eine Kampagne, die auf der Seite gar nicht mehr vorkommt, während
    # <title> aktuell ist. Am gemeldeten Fall land_rights_evergreen_2026
    # nachgezählt: og:title "Ermordet, weil sie ihr Land verteidigen" taucht im
    # sichtbaren Text 0-mal auf, der <title>-Gegenstand "Lula" 7-mal.
    # og:title bleibt als Rückfall, weil er bei den normalen Kampagnen die
    # sauberere Überschrift liefert (kein Marken-Präfix, keine Kürzung).
    title = h1_text or _doc_title(soup) or _meta(soup, "og:title")
    if title:
        import html as _html
        title = re.sub(r"\s+", " ", _html.unescape(title)).strip()
    rec["title"] = title
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    canon = soup.find("link", rel="canonical")
    rec["url"] = core.eigene_adresse(
        (canon.get("href") if canon else None) or _meta(soup, "og:url"), url,
        muster if muster is not None else DETAILADRESSE_RE)

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
    return core.zahl(sig), core.zahl(target)


def scrape_campaign(fetcher: core.Fetcher, slug: str,
                    sprache: str = "de") -> tuple[str, dict | None]:
    """(status, record) für eine Avaaz-eigene Kampagne.

    status "skip" = Seite existiert, ist aber keine Aktions-Kampagne (kein
    MCounter/keine campaign_id, z. B. CEO-Brief oder Berichte-Hub) – nicht
    aufnehmen bzw. aus dem Bestand entfernen."""
    url = f"{BASE_URL}/campaign/{sprache}/{slug}/"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    if ungueltige_seite(resp.text, url):
        return "skip", None

    rec = parse_campaign(resp.text, url, _sprachteile(sprache)[4])
    if not rec.get("petition_id"):
        return "skip", None
    sig, target = fetch_campaign_stats(fetcher, rec["petition_id"])
    if sig is not None:
        rec["signatures"] = sig
        rec["goal"] = target if target else _goal_for(sig)
    _fremdsprachen_holen(fetcher, rec, slug, "campaign", parse_campaign,
                         sprache)
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
        skip_slugs, geprueft = [], 0
        for k, slug in enumerate(known_slugs, 1):
            prog(current=k, total=len(known_slugs), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            kind = store[slug].get("kind", "petition")
            status, rec, url = _scrape_any(fetcher, slug, kind)
            if status == "error":
                continue
            geprueft += 1
            if status == "skip":
                # Info-Seite, keine Aktions-Kampagne. Nicht sofort löschen: ein
                # Seitenumbau ließe die Erkennung überall gleich fehlschlagen.
                skip_slugs.append(slug)
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts, url)
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
        core.entferne_skip(store, skip_slugs, geprueft, "Avaaz",
                           grund_de="keine Aktions-Kampagne",
                           grund_en="not an action campaign", save=save)
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


# ----------------------------------------------------------------------------
# Der englische Eintrag
# ----------------------------------------------------------------------------
# Bewusst OHNE die Archiv-Warteschlange (--archive): die ist ein Nachhol-Werk
# für den deutschen Altbestand aus dem Internet Archive und hat mit der
# Sprachauswahl nichts zu tun. Der englische Eintrag sammelt schlicht, was
# Avaaz gerade kuratiert zeigt, und wächst wie der deutsche per Upsert.
def run_en(args) -> None:
    store = core.load_store(EN_DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS_EN)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, EN_DATA_FILE, extra_meta=extra, quiet=quiet)

    def adresse(slug: str, kind: str) -> str:
        teil = "campaign" if kind == "campaign" else "community_petitions"
        return f"{BASE_URL}/{teil}/en/{slug}/"

    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte englische Einträge …")
        prog(phase="check-known", current=0, total=len(known), message="…")
        weg = []
        for k, slug in enumerate(known, 1):
            prog(current=k, total=len(known), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            kind = (store.get(slug) or {}).get("kind") or "petition"
            if kind == "campaign":
                status, rec = scrape_campaign(fetcher, slug, "en")
            else:
                status, rec = scrape_petition(fetcher, slug, "en")
            if status == "error":
                continue
            if status == "skip":
                weg.append(slug)
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        adresse(slug, kind))
            save()
        for slug in weg:
            store.pop(slug, None)
        if weg:
            log(f"  {len(weg)} Eintrag/Einträge ohne Petition entfernt.")

    log("Sammle englische Petitionen und Kampagnen …")
    petitionen, kampagnen = discover_slugs(fetcher, "en")
    neu_pet = [s for s in petitionen if s not in store]
    neu_kamp = [s for s in kampagnen if s not in store]
    if args.limit:
        neu_pet, neu_kamp = neu_pet[:args.limit], neu_kamp[:args.limit]
    gesamt = len(neu_pet) + len(neu_kamp)
    log(f"{gesamt} neue englische Einträge zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=gesamt, message="Beginne …")

    i = 0
    for slug, kind in ([(s, "petition") for s in neu_pet]
                       + [(s, "campaign") for s in neu_kamp]):
        i += 1
        prog(current=i, total=gesamt, message=slug)
        if kind == "campaign":
            status, rec = scrape_campaign(fetcher, slug, "en")
        else:
            status, rec = scrape_petition(fetcher, slug, "en")
        if status in ("error", "skip"):
            continue
        if rec is not None and petitionen.get(slug):
            # Der Feed liefert Zähler und ID gratis mit — sie zu verwerfen
            # kostete einen zusätzlichen Stats-Abruf.
            for f, w in petitionen[slug].items():
                rec.setdefault(f, w)
        core.upsert(store, slug, rec or {}, {}, status, ts, adresse(slug, kind))
        save()

    neu = [s for s, r in store.items() if r.get("first_seen") == ts]
    if neu:
        log(f"NEU: {len(neu)} neue englische Einträge in diesem Lauf.")
    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=neu,
         available=len(petitionen) + len(kampagnen))
    core.write_list_html(PLATFORM_EN)
    log("Fertig (Avaaz English).")


def check_en(fetcher):
    resp = fetcher.get(EN_HOME_URL)
    if resp is None or not resp.ok:
        return False, "Startseite nicht erreichbar"
    n = len(set(EN_PETITION_HREF_RE.findall(resp.text)) |
            set(EN_CAMPAIGN_HREF_RE.findall(resp.text)))
    return (n >= 1), f"{n} Aktionen (englische Startseite)"


PLATFORM_EN = Platform(
    key="avaaz_en",
    openness=2,
    openness_note="Eingeschränkt: keine öffentliche Gesamtliste (nur ~5-10 "
                  "kuratierte/beliebte/neue), Zähler nur via Stats-JSON, "
                  "Cloudflare blockt Nicht-Browser-Clients.",
    name="Avaaz (English)",
    eyebrow="Avaaz · Bürgerpetitionen & Kampagnen (englisch)",
    source_url="https://secure.avaaz.org/community_petitions/en/",
    data_file=EN_DATA_FILE,
    html_file=EN_HTML_FILE,
    run=run_en,
    check=check_en,
    language="en",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
