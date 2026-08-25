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
#  BOT-SCHUTZ: ZWEI HOSTS, und der ID-Weg ist BEWUSST VERWORFEN
#  ---------------------------------------------------------------------------
#  Ekō zieht von Champaign auf eine Vercel-Anwendung um. Dabei sind zwei Hosts
#  im Spiel, die sich nur durch ein "s" unterscheiden:
#    - actions.eko.org  (PLURAL)   altes Champaign, nginx, robots.txt lesbar
#    - action.eko.org   (SINGULAR) neu, Vercel, "Security Checkpoint" (HTTP 429)
#
#  Gemessen am 8.8.2026, dieselbe Aktion im selben Moment:
#    /a/osceola-gegen-nestle  → 301 auf action.eko.org//a/…  → 429 Checkpoint
#    /a/3204                  → 200 auf actions.eko.org, echter Inhalt
#    action.eko.org/a/3204    → 429  ← ENTSCHEIDEND
#
#  Die letzte Zeile ist der Grund, warum die numerische ID hier NICHT benutzt
#  wird. Auf dem neuen Host ist auch sie gesperrt: Ekō schützt den INHALT, nicht
#  die Schreibweise der URL. Dass die Zahlform auf dem Altsystem noch antwortet,
#  ist ein Rest der unfertigen Migration (die Weiterleitung baut sogar einen
#  doppelten Schrägstrich "//a/"). Sie zu benutzen wäre eine Umgehung des
#  Bot-Schutzes – der Kodex im README ("Fairness beim Scrapen") sagt dessen
#  Einhaltung ausdrücklich zu. Nutzerentscheidung vom 8.8.2026: verwerfen.
#
#  Stattdessen: bei 429 bleibt der Bestand stehen und neue Aktionen werden aus
#  der Kampagnenkarte der deutschen Übersicht übernommen (record_from_card) –
#  mit Titel, Kurztext und Bild, ohne Unterschriftenstand und Volltext.
#
#  ⚠️ BEOBACHTEN: Ist die Migration abgeschlossen, fällt der ID-Weg ohnehin weg.
#  Antwortet actions.eko.org/a/<slug> wieder direkt mit 200, kann der normale
#  Detailabruf zurück – dann diesen Block hier mit aufräumen.
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

import i18n_helfer as i18n
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

# Kampagnenkarten der Übersicht: <div data-block="campaign-card"> mit Bild
# (alt = Titel), Kurztext, und CTA-Link auf /a/<slug>. Aus ihnen wird ein
# Datensatz gebaut, wenn die Detailseite nicht erreichbar ist (siehe unten).
CARD_SEL = 'div[data-block="campaign-card"]'

# Sprach-Heuristik für Karten: die deutsche Übersicht listet auch globale
# (englische) Kampagnen. Ohne Detailseite (die <html lang> liefert) entscheiden
# Funktionswörter – die sind sprachtypisch und robust gegen kaputte Umlaute.
_DE_WORDS = re.compile(
    r"\b(und|oder|der|die|das|den|dem|des|ein|eine|einen|f[uü]r|gegen|nicht|"
    r"kein|keine|wir|sie|ist|sind|werden|wird|jetzt|auf|von|vom|mit|zum|zur|"
    r"dass|muss|soll|sollen|schon|mehr|unsere|unser|ihre|beim|durch)\b", re.I)
_EN_WORDS = re.compile(
    r"\b(the|and|for|with|our|your|this|that|are|from|now|stop|tell|they|"
    r"their|has|have|will|must|need|before|about|into|over|been|being)\b", re.I)

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
def _looks_german(text: str) -> bool:
    de = len(_DE_WORDS.findall(text))
    en = len(_EN_WORDS.findall(text))
    return de >= 2 and de > en


def classify(cta: str, title: str) -> str:
    """Format der Aktion (Eko mischt Petitionen, Spendenaufrufe und sonstige
    Aktionen). Petition zuerst prüfen – „unterschreiben“ enthält „schreib“."""
    t = f"{cta} {title}".lower()
    if any(w in t for w in ("unterschreib", "unterzeichn", "petition")):
        return "Petition"
    if "spend" in t:
        return "Spenden-Aktion"
    if "brief" in t:
        return "Brief-Aktion"
    if any(w in t for w in ("mail", "nachricht", "schreib")):
        return "E-Mail-Aktion"
    return "Aktion"


def _parse_card(card) -> tuple[str, dict] | None:
    """(slug, karten-daten) aus einer Kampagnenkarte der Übersicht."""
    link = card.find("a", href=ACTION_HREF_RE)
    if link is None:
        return None
    m = ACTION_HREF_RE.search(link["href"])
    if not m or m.group(1) in NON_ACTION_SLUGS:
        return None
    img = card.find("img")
    title = (img.get("alt") or "").strip() if img else ""
    texts = sorted((d.get_text(" ", strip=True)
                    for d in card.find_all("div")), key=len, reverse=True)
    summary = next((t for t in texts if 40 < len(t) < 1200 and t != title), None)
    # Die Karte hat drei <div>: Überschrift, Fließtext und eine Umhüllung um
    # beide. Die Umhüllung ist die längste und gewinnt deshalb die Sortierung –
    # ohne das Abschneiden stünde der Titel doppelt in jedem Kurztext.
    if summary and title and summary.startswith(title):
        summary = summary[len(title):].lstrip(" –—:·") or None
    data = {
        "title": title or None,
        "summary": summary,
        "image_url": (img.get("src") or "").strip() if img else None,
        "cta": link.get_text(" ", strip=True),
    }
    data["german"] = _looks_german(f"{title} {summary or ''}")
    return m.group(1), data


def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """Kandidaten aus der Kampagnen-Startseite PLUS der Union vieler deutscher
    Suchbegriffe (die Suche cappt bei 27/Begriff, liefert aber je nach Begriff
    andere Kampagnen).

    Rückgabe: {slug: karten-daten}. Die Karten sind wichtig geworden, weil Eko
    die Detailseiten nach action.eko.org (Vercel) umzieht, wo ein
    Bot-Schutz-Checkpoint sitzt – dann ist die Karte die einzige Quelle."""
    found: dict[str, dict] = {}
    sources = ["", *[f"?query={t}" for t in SEARCH_TERMS]]
    total = len(sources)
    prog(phase="discover", current=0, total=total, message="Suche Kampagnen …")
    for i, qs in enumerate(sources, 1):
        resp = fetcher.get(f"{WWW_URL}/de/campaigns{qs}")
        if resp is not None and resp.ok:
            soup = BeautifulSoup(resp.text, "html.parser")
            for card in soup.select(CARD_SEL):
                parsed = _parse_card(card)
                if parsed and parsed[0] not in found:
                    found[parsed[0]] = parsed[1]
            # Sicherheitsnetz, falls das Karten-Markup wieder wechselt.
            for m in ACTION_HREF_RE.finditer(resp.text):
                if m.group(1) not in NON_ACTION_SLUGS:
                    found.setdefault(m.group(1), {})
        label = "Startseite" if qs == "" else qs[7:]
        prog(current=i, total=total,
             message=f"„{label}“ · {len(found)} Kandidaten bisher")
    german = sum(1 for d in found.values() if d.get("german"))
    log(f"Kampagnen-Suche: {len(found)} eindeutige Aktionen gefunden "
        f"({german} davon deutschsprachig).")
    # Der Zweig bündelt 26 Abrufe (Startseite + 25 Suchbegriffe) und hat mit
    # _parse_card und ACTION_HREF_RE zwei Ebenen — fällt die Karte aus, fängt
    # das Muster noch etwas auf. Genau das macht einen Teilausfall hier LEISE:
    # es kommt weiter etwas, nur viel weniger.
    # Schwelle gemessen am 8.8.2026: 42 eindeutige Aktionen. 5 ist bewusst weit
    # darunter — die Zahl schwankt mit dem Kampagnenbestand, aber dass 26
    # Abfragen zusammen unter 5 Treffer ergeben, ist kein Kampagnenstand mehr,
    # sondern ein Defekt.
    core.entdeckung("Kampagnen-Suche", len(found), erwartet_min=5,
                    name_en="campaign search")
    return found


def record_from_card(slug: str, card: dict) -> dict:
    """Notdatensatz allein aus der Kampagnenkarte – ohne Unterschriftenstand,
    aber mit Titel, Kurztext und Bild. Besser als gar kein Eintrag."""
    return {
        "title": card.get("title"),
        "summary": card.get("summary"),
        "description_full": (f"<p>{core._esc(card['summary'])}</p>"
                             if card.get("summary") else None),
        "image_url": card.get("image_url"),
        "url": f"{BASE_URL}/a/{slug}",
        "started_by": "Ekō",
        "kind": "petition",
        "category": classify(card.get("cta") or "", card.get("title") or ""),
    }


# ----------------------------------------------------------------------------
# Detailseite parsen
# ----------------------------------------------------------------------------
def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    tag = (soup.find("meta", property=prop)
           or soup.find("meta", attrs={"name": prop}))
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


# ---------------------------------------------------------------------------
# SPRACHFASSUNGEN — bei Ekō gibt es KEINEN Weg zur Übersetzung, nur eine Klammer
#
# Am 8.8.2026 durchgemessen: Ekō führt dieselbe Kampagne in mehreren Sprachen,
# aber sie ist von der deutschen Seite aus NICHT erreichbar.
#   · kein Sprachsegment, kein Sprachsuffix — der englische Slug ist frei
#     formuliert (nestle-osceola-wasser ↔ nestle-drop-your-plans-in-osceola-township)
#   · kein Sprachumschalter auf der Aktionsseite: 0 hreflang, 0 og:locale,
#     kein „English"-Link. hreflang gibt es nur auf eko.org/de/campaigns, und
#     zwar für die LISTE, nicht je Petition
#   · Accept-Language ändert nichts (dreimal 57.889 Byte, I18n.locale bleibt de)
#   · kein Index und kein API: /api/campaigns/<id> leitet auf die Startseite um,
#     /api/pages/<id> antwortet mit HTTP 500
#
# Verbindend ist allein die `campaign_id` im eingebetteten Seiten-JSON: die
# deutsche und die englische Fassung von Kampagne 91 tragen beide 91. Sie wird
# deshalb hier mitgeschrieben — dann verknüpft publish._uebersetzungen_verknuepfen
# die beiden Sätze, FALLS je beide in den Bestand geraten. Aktiv suchen kann
# der Scraper die Übersetzung nicht.
#
# ⚠️ Die Kennung fehlt bei rund 44 % der Seiten (59 gescannt, 30 mit Wert, 24
# mit null). Ohne sie bleibt der Satz einsprachig — das ist kein Fehler.
#
# ⚠️ Und der Bot-Schutz steht ohnehin davor: actions.eko.org (Plural) leitet
# per 301 auf action.eko.org (Singular, Vercel), und dort antwortet der
# Checkpoint mit HTTP 429. Der Weg über die numerische Seiten-ID sah zunächst
# wie eine Umgehung aus, ist es aber nicht — auf dem neuen Host ist die ID
# ebenfalls 429. Der Checkpoint wird NICHT umgangen.
CAMPAIGN_ID_RE = re.compile(r'"campaign_id"\s*:\s*(\d+)')


def _kampagne_aus_html(html: str, props: dict | None = None) -> str | None:
    """Gemeinsame Kennung der Sprachfassungen, wenn die Seite eine nennt."""
    if props:
        wert = props.get("campaign_id")
        if wert:
            return f"eko:{wert}"
    m = CAMPAIGN_ID_RE.search(html)
    return f"eko:{m.group(1)}" if m else None


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
    count = core.zahl(props.get("action_count"))
    if count is None:
        return None
    rec: dict = {}
    rec["title"] = props.get("title")
    rec["signatures"] = count
    rec["goal"] = _goal_for(count)
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
    rec["started_by"] = "Ekō"
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

    rec["started_by"] = "Ekō"
    rec["kind"] = "petition"
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str,
                    sprache: str = "de") -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error | skip.

    `sprache` ist die Hauptsprache des Datensatzes: "de" für den deutschen
    Eintrag, "en" für den englischen Zwilling (PLATFORM_EN). Die Detailseite
    selbst ist dieselbe — Ekō adressiert Aktionen sprachneutral unter
    /a/<slug>; welche Sprache herauskommt, entscheidet der Slug."""
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
    i18n.setze_hauptsprache(rec, sprache)
    # Sprachneutral: die Zahl steht in window.champaign.page und ist bei allen
    # Fassungen derselben Kampagne dieselbe. Genau daran hängt die Verknüpfung
    # „gleiche Kampagne, andere Sprache" zwischen den beiden Plattform-Einträgen
    # (nachgerechnet: nestle-osceola-wasser und
    # nestle-drop-your-plans-in-osceola-township ergeben beide eko:91).
    kennung = _kampagne_aus_html(resp.text)
    if kennung:
        rec["campaign_id"] = kennung
    if sprache == "de":
        # „ungeklärt" und nicht „fehlt": dass wir die englische Fassung nicht
        # finden KÖNNEN, ist eine Aussage über uns, nicht über Ekō. Seit es den
        # eigenen englischen Eintrag gibt, übernimmt die Verknüpfung über
        # campaign_id diese Aufgabe — der i18n-Block bleibt leer.
        i18n.setze_sprachfassung(rec, "en", "ungeklärt")
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

    # Erst entdecken, dann nachprüfen: die Kampagnenkarten sind auch beim
    # Nachprüfen bekannter Aktionen die einzige Rückfallebene, solange die
    # Detailseiten hinter dem Bot-Schutz liegen.
    log("Sammle Aktionen von der deutschen Kampagnenliste …")
    discovered = discover_slugs(fetcher)
    # Vorläufiger Wert, überlebt jeden Abbruch; der Abschluss-Save ersetzt ihn
    # durch die endgültige Zählung (s. save_store: _TLS.lauf_meta, 24.8.2026).
    core.lauf_meta_setzen(available=len(discovered))

    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte Aktion(en) …")
        prog(phase="check-known", current=0, total=len(known),
             message="Prüfe bekannte Aktionen …")
        skip_slugs, geprueft = [], 0
        for k, slug in enumerate(known, 1):
            prog(current=k, total=len(known), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                # Detailseite gesperrt – wenigstens die Karte nachziehen. Die
                # Sprachprüfung entfällt hier: der Eintrag steht schon im
                # Bestand, war also bei der Aufnahme deutsch. upsert überschreibt
                # nur mit gefüllten Werten, der Unterschriftenstand bleibt.
                card = discovered.get(slug) or {}
                if card.get("title"):
                    core.upsert(store, slug, record_from_card(slug, card), {},
                                "online", ts, f"{BASE_URL}/a/{slug}")
                    save()
                continue
            geprueft += 1
            if status == "skip":
                # Nicht sofort löschen: Ekō wechselt gerade sein Template – ein
                # Umbau ließe die Sprach-/Aktionsprüfung überall fehlschlagen.
                skip_slugs.append(slug)
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/a/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
        core.entferne_skip(store, skip_slugs, geprueft, "Ekō",
                           grund_de="keine deutsche Unterschriften-Aktion",
                           grund_en="not a German signature action", save=save)

    new_slugs = [s for s in discovered if s not in store]
    if args.limit:
        new_slugs = new_slugs[:args.limit]
    log(f"{len(new_slugs)} neue Aktionen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_slugs),
         message="Beginne Scrape …")

    from_cards = 0
    for i, slug in enumerate(new_slugs, 1):
        card = discovered.get(slug) or {}
        log(f"({i}/{len(new_slugs)}) {slug}")
        prog(current=i, total=len(new_slugs), message=slug)
        status, rec = scrape_petition(fetcher, slug)
        if status == "error":
            # Typischer Fall seit dem Umzug auf action.eko.org: Bot-Schutz
            # antwortet mit 429. Dann die Kampagnenkarte übernehmen – ohne
            # Unterschriftenstand, aber mit Titel, Text und Bild.
            if card.get("german") and card.get("title"):
                core.upsert(store, slug, record_from_card(slug, card), {},
                            "online", ts, f"{BASE_URL}/a/{slug}")
                save()
                from_cards += 1
                log("  Detailseite gesperrt – aus Kampagnenkarte übernommen.")
            continue
        if status == "skip":
            log("  übersprungen (keine deutsche Unterschriften-Aktion).")
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts, f"{BASE_URL}/a/{slug}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Aktion(en) in diesem Lauf "
            f"({from_cards} davon nur aus der Kampagnenkarte).")

    # Vollständigkeit ehrlich rechnen: die deutsche Übersicht listet auch
    # globale (englische) Kampagnen mit – die gehören nicht in den Bestand und
    # dürfen die Quote nicht drücken.
    german = {s for s, d in discovered.items() if d.get("german")}
    available = len(german | set(store)) if german else len(discovered)

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=available)
    core.write_list_html(PLATFORM)
    log("Fertig (Eko).")


def check(fetcher):
    return core.check_source(fetcher, f"{WWW_URL}/de/campaigns", ACTION_HREF_RE, 3,
                             "Aktionen")

PLATFORM = Platform(
    key="eko",
    # Ampel von 3 auf 2 gesenkt (8.8.2026): Die kuratierte deutsche Liste ist
    # weiter offen, aber die Detailseiten liegen seit dem Umzug auf
    # action.eko.org hinter einem Bot-Schutz. Das ist dieselbe Lage wie bei
    # Avaaz, das dafür seit jeher eine 2 trägt — die Skala nennt „Bot-Schutz“
    # ausdrücklich als Merkmal des unteren Endes.
    openness=2,
    openness_note="Eingeschränkt: die deutsche Kampagnenliste ist offen, aber "
                  "die Detailseiten liegen seit 8.8.2026 hinter einem "
                  "Bot-Schutz (Umzug auf action.eko.org, HTTP 429). Für neue "
                  "Aktionen übernehmen wir deshalb Titel, Kurztext und Bild "
                  "aus der Kampagnenkarte; Unterschriftenstand und Volltext "
                  "fehlen dann. Ein technisch möglicher Umweg über die "
                  "numerische Seiten-ID wäre eine Umgehung des Bot-Schutzes "
                  "und wird bewusst nicht genutzt.",
    # Eigenschreibweise der Plattform ist „Ekō" (mit Makron, seit der
    # Umbenennung von SumOfUs 2023) — der Name steht hier zentral und läuft
    # über publish.py ins Manifest; wirkt also erst mit dem nächsten
    # publish-/CI-Lauf, nicht sofort in webapp/data.
    name="Ekō",
    eyebrow="Ekō · Kampagnen (deutsch)",
    source_url="https://eko.org/de/campaigns",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


# ----------------------------------------------------------------------------
# Der englische Eintrag
# ----------------------------------------------------------------------------
# ⚠️ Die englische Liste ist PAGINIERT und braucht darum keine Suchbegriffe:
# 4 Abrufe decken sie vollständig ab, gegen 26 im deutschen Zweig (Startseite
# plus 25 Suchbegriffe). Am 12.8.2026 gemessen: 9 + 9 + 9 + 3 = 30 Kampagnen.
#
# ⚠️⚠️ ABBRUCH AN DER KARTENZAHL, NICHT AM STATUSCODE. Seite 5 antwortet mit
# HTTP **200** und 153.740 Byte, enthält aber NULL Kampagnenkarten. Wer auf
# einen 404 wartet, läuft bis zum Sicherheitsnetz durch und hält das für
# normal.
EN_DATA_FILE = Path("eko_en_petitions.json")
EN_HTML_FILE = Path("eko_en_petitions.html")
EN_LIST_URL = f"{WWW_URL}/en/campaigns"
EN_MAX_SEITEN = 12          # Sicherheitsnetz, falls der Abbruch nie greift
FETCH_HEADERS_EN = dict(FETCH_HEADERS, **{"Accept-Language": "en-US,en;q=0.9"})


def discover_en_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: karten-daten} des englischen Kampagnenbaums."""
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=EN_MAX_SEITEN,
         message="Englische Kampagnen …")
    seite = 0
    while seite < EN_MAX_SEITEN:
        seite += 1
        url = EN_LIST_URL if seite == 1 else f"{EN_LIST_URL}/page/{seite}"
        resp = fetcher.get(url)
        if resp is None or not resp.ok:
            break
        karten = BeautifulSoup(resp.text, "html.parser").select(CARD_SEL)
        if not karten:
            break
        for card in karten:
            parsed = _parse_card(card)
            if parsed and parsed[0] not in found:
                found[parsed[0]] = parsed[1]
        prog(current=seite, total=EN_MAX_SEITEN,
             message=f"Seite {seite} · {len(found)} Kampagnen bisher")
    log(f"Englische Kampagnen-Liste: {len(found)} Aktionen auf {seite} Seite(n).")
    # Gemessen am 12.8.2026: 30. Die Schwelle liegt bewusst weit darunter — der
    # Bestand schwankt, aber unter 5 ist kein Kampagnenstand mehr, sondern ein
    # Defekt (dieselbe Logik wie im deutschen Zweig).
    core.entdeckung("Englische Kampagnen-Liste", len(found), erwartet_min=5,
                    name_en="English campaign list")
    return found


def run_en(args) -> None:
    store = core.load_store(EN_DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS_EN)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, EN_DATA_FILE, extra_meta=extra, quiet=quiet)

    karten = discover_en_slugs(fetcher)
    core.lauf_meta_setzen(available=len(karten))   # überlebt Abbruch
    log(f"{len(karten)} englische Kampagne(n) (Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(karten), message="Beginne …")

    aus_karte = 0
    for i, (slug, card) in enumerate(sorted(karten.items()), 1):
        prog(current=i, total=len(karten), message=slug)
        if core.skip_recent(store.get(slug), args):
            continue
        status, rec = scrape_petition(fetcher, slug, sprache="en")
        if status == "skip":
            continue
        if status == "error":
            # Detailseite blockiert (der Checkpoint auf action.eko.org). Für
            # BEKANNTE Sätze nichts anfassen — sonst überschriebe ein
            # Notdatensatz einen vollständigen. Nur Neuzugänge bekommen die
            # Karte, und die trägt keine campaign_id: die steht ausschließlich
            # auf der Detailseite. Ohne sie gibt es keine Sprachverknüpfung,
            # und das ist richtig so — geraten wird hier nichts.
            if slug in store:
                continue
            rec = record_from_card(slug, card)
            i18n.setze_hauptsprache(rec, "en")
            status, aus_karte = "online", aus_karte + 1
        core.upsert(store, slug, rec or {}, {}, status, ts,
                    f"{BASE_URL}/a/{slug}")
        save()

    neu = [s for s, r in store.items() if r.get("first_seen") == ts]
    if neu:
        log(f"NEU: {len(neu)} neue englische Kampagne(n) in diesem Lauf.")
    if aus_karte:
        log(f"  {aus_karte} Satz/Sätze nur aus der Kampagnenkarte "
            f"(Detailseite blockiert, ohne campaign_id).")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=neu, available=len(karten))
    core.write_list_html(PLATFORM_EN)
    log("Fertig (Ekō English).")


def check_en(fetcher):
    return core.check_source(fetcher, EN_LIST_URL, ACTION_HREF_RE, 3,
                             "Aktionen")


PLATFORM_EN = Platform(
    key="eko_en",
    openness=2,
    openness_note="Eingeschränkt: die englische Kampagnenliste ist offen und "
                  "sogar paginiert (4 Abrufe decken sie ab), aber die "
                  "Detailseiten liegen hinter demselben Bot-Schutz wie im "
                  "deutschen Zweig (action.eko.org, HTTP 429). Fehlt die "
                  "Detailseite, übernehmen wir Titel, Kurztext und Bild aus "
                  "der Kampagnenkarte.",
    name="Ekō (English)",
    eyebrow="Ekō · Kampagnen (englisch)",
    source_url="https://eko.org/en/campaigns",
    data_file=EN_DATA_FILE,
    html_file=EN_HTML_FILE,
    run=run_en,
    check=check_en,
    language="en",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
