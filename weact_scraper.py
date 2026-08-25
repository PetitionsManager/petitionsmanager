#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  weact_scraper.py  —  Plattform-Modul für WeAct (Campact)
# =============================================================================
#
#  Enthält NUR noch das WeAct-Spezifische (Discovery, Selektoren, Parsing,
#  Ablauf eines Laufs). Alles Generische (HTTP, Store, HTML, Server) liegt in
#  petitions_core.py; Einstiegspunkt für alle Plattformen ist monitor.py:
#
#      python3 monitor.py --serve            # Dashboard + alle Plattformen
#      python3 monitor.py --platform weact   # nur WeAct scrapen (CLI)
#
#  Der Kompatibilität halber funktioniert  python3 weact_scraper.py --serve
#  weiterhin und delegiert an monitor.py.
#
#  WEACT-BESONDERHEITEN (hart erarbeitet – nicht ohne Not ändern):
#  - Petitions-/Kategorie-Links stecken in custom Elementen (<cmpr-card
#    href=…>, <cmpr-tag href=…>), NICHT in <a>-Tags → Suche ohne Tag-Namen.
#  - Kategorieseiten paginieren mit ?cpage=N ("page" liefert immer Seite 1!).
#  - /petitions/search ist die Suchseite, keine Petition (NON_PETITION_SLUGS).
#  - Petitionstexte kommen aus dem Trix-Editor: Absätze sind <div>s, keine
#    <p>s → vor der Extraktion umbenennen.
#  - Manche Petitionen leiten auf das "Aktion"-Template um
#    (aktion.campact.de/weact/<slug>/…) mit völlig anderer Struktur
#    (.content-column, echte <cmpr-accordion-item>-Akkordions).
# =============================================================================

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

import petitions_core as core
from petitions_core import (Platform, log, now_iso, prog, sanitize_fragment,
                            ALLOWED_DESC_TAGS, _esc)

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL   = "https://weact.campact.de"
# Prüfmuster für eine FERTIGE Kategorieadresse — am eigenen Host verankert.
# Das Suchmuster weiter unten bleibt bewusst lockerer, es muss auch die
# relative Form "/categories/klima" finden. Siehe core.eigener_link.
EIGENE_KATEGORIE_RE = re.compile(
    r"^https://weact\.campact\.de/categories/[a-z0-9-]+", re.I)
DATA_FILE  = Path("weact_petitions.json")
HTML_FILE  = Path("weact_petitions.html")

TRY_JSON_VARIANT = True        # zuerst /petitions/<slug>.json versuchen
MAX_LIST_PAGES   = 200         # Sicherheitslimit für die Paginierung pro Liste

# Fallback-Themen-Slugs, falls die Kategorie-Navigation der Startseite bei
# einem Lauf mal nicht lesbar ist. Im Normalfall werden die Kategorien bei
# JEDEM Lauf live gelesen (discover_categories), damit neue/umbenannte
# Kategorien automatisch erkannt werden.
CATEGORY_SLUGS = [
    "antifaschismus", "antirassismus", "bildung-kinderrechte",
    "buergerinnen-menschenrechte", "datenschutz", "demokratie",
    "energiewende", "feminismus", "flucht-asyl", "gesundheit", "handel",
    "internationales", "klimaschutz", "kohle", "landwirtschaft",
    "lobbyismus-transparenz", "medienpolitik", "soziales", "tierschutz",
    "umwelt-ressourcen", "verbraucherinnen-schutz", "verkehr",
    "wirtschaft-finanzen", "wohnen",
]
# Paginierungs-Parameter der Kategorieseiten. Verifiziert: "cpage", NICHT
# "page" (mit "page" liefert der Server immer wieder Seite 1 aus, wodurch fast
# alle Petitionen einer Kategorie unentdeckt blieben).
PAGE_PARAM = "cpage"

# Optional: exakter CSS-Selektor des Beschreibungs-Containers (leer = Auto).
DESCRIPTION_SELECTOR = ""

PETITION_HREF_RE = re.compile(r"/petitions/([a-z0-9][a-z0-9\-]+)", re.I)
CATEGORY_HREF_RE = re.compile(r"/categories/([a-z0-9][a-z0-9\-]*)", re.I)
SIG_RE  = re.compile(r"([\d.\s]+)\s*Unterschrift", re.I)
MILESTONE_RE = re.compile(r"([\d.,]+)\s*Unterschriften?\s+erreicht", re.I)
TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\s*[+\-]\d{2}:?\d{2}")

# /petitions/search ist die Suchseite, keine Petition – ohne Ausfiltern hebelt
# sie sogar die Paginierungs-Abbruchbedingung aus.
NON_PETITION_SLUGS = {"search"}

DESC_STOP_WORDS = ("neuigkeiten", "kommentare", "jetzt unterschreiben",
                   "teilen", "unterstützer")


# ----------------------------------------------------------------------------
# Entdeckung der Kategorien (bei jedem Lauf live von der Startseite)
# ----------------------------------------------------------------------------
def discover_categories(fetcher: core.Fetcher) -> dict[str, str]:
    """{slug: Anzeigename} aus der Kategorie-Navigation der Startseite.
    Die Nav-Einträge stecken in <cmpr-tag href="/categories/<slug>">."""
    resp = fetcher.get(BASE_URL + "/")
    cats: dict[str, str] = {}
    if not resp or not resp.ok:
        return cats
    soup = BeautifulSoup(resp.text, "html.parser")
    for el in soup.find_all(href=CATEGORY_HREF_RE):
        m = CATEGORY_HREF_RE.search(el.get("href", ""))
        if not m:
            continue
        slug = m.group(1)
        label = el.get_text(" ", strip=True) or slug
        cats.setdefault(slug, label)
    return cats


def load_known_categories() -> dict[str, str]:
    return core.load_meta(DATA_FILE).get("categories", {})


# ----------------------------------------------------------------------------
# Entdeckung der Petitionen
# ----------------------------------------------------------------------------
# Leerzeichen, die str.strip() NICHT kennt: geschütztes Leerzeichen, Braille-
# Blank (U+2800, von Starter*innen zum Auffüllen benutzt: "AlgorithmWatch ⠀"),
# schmales Leerzeichen und Zero-Width-Space.
BLANKS = " \t\r\n   ​⠀"


def _card_root(el):
    """Die <cmpr-card> zum gefundenen Link. Der Link IST auf WeAct meist schon
    die Karte (href steckt im Custom Element); die Elternsuche ist nur die
    Rückfallebene für abweichende Layouts."""
    if el.name == "cmpr-card":
        return el
    return (el.find_parent("cmpr-card")
            or el.find_parent(["article", "li", "div"]) or el)


def _card_started_by(card) -> str | None:
    """Name der Starter*in aus <cmpr-card-meta>.

    Vorher lief hier eine Regex über den zusammengeflossenen Kartentext, deren
    Abbruchbedingung `\\s{2,}` NIE greifen konnte: `get_text(" ")` macht jede
    Elementgrenze zu EINEM Leerzeichen. Der „Name" lief damit bis zum
    Kartenende und wurde stumpf bei 200 Zeichen gekappt — bei 1636 von 1865
    Datensätzen stand so Titel + halber Petitionstext im Feld. Die Karte
    zeichnet den Namen aber sauber aus:

        <cmpr-card-meta>Gestartet von <strong>NAME</strong></cmpr-card-meta>"""
    meta = card.find("cmpr-card-meta")
    if meta is None:
        # Rückfallebene für abweichende Layouts: das Element, das die Zeile
        # „Gestartet von" trägt (auf den Listen ist es immer cmpr-card-meta).
        knoten = card.find(string=re.compile(r"Gestartet von", re.I))
        meta = knoten.parent if knoten else None
    if meta is None:
        return None
    stark = meta.find("strong")
    if stark:
        name = stark.get_text(" ", strip=True)
    else:      # Rückfallebene: eigener Text der Meta-Zeile ohne das Präfix
        name = re.sub(r"^\s*Gestartet von\s*", "",
                      meta.get_text(" ", strip=True), flags=re.I)
    return name.strip(BLANKS)[:200] or None


def _card_signatures(card) -> int | None:
    """Unterschriftenzahl der Karte. Zuerst das ausgezeichnete
    `[data-signatures]`, dann der Footer, zuletzt die ganze Karte — die
    Startseite rendert die Karten OHNE `data-signatures`, andere Layouts
    ganz ohne Footer."""
    for quelle in (card.select_one("[data-signatures]"),
                   card.find("cmpr-card-footer"), card):
        if quelle is None:
            continue
        m = SIG_RE.search(quelle.get_text(" ", strip=True))
        if m:
            return int(re.sub(r"\D", "", m.group(1)) or 0)
    return None


def discover_slugs(fetcher: core.Fetcher, category_slugs: list[str]) -> dict[str, dict]:
    """{slug: {"started_by":…, "signatures":…}} aus allen Listen. Listen-
    Karten enthalten Starter*in und Unterschriftenzahl – Felder, die auf der
    Detailseite fehlen. Deshalb hier mitnehmen."""
    found: dict[str, dict] = {}
    total_steps = len(category_slugs) + 2      # Sitemap + Startseite + je Kategorie
    step = 0

    def bump(label: str) -> None:
        nonlocal step
        step += 1
        prog(phase="discover", current=step, total=total_steps,
             message=f"{label} · {len(found)} Petitionen bisher")

    def harvest(html: str) -> int:
        soup = BeautifulSoup(html, "html.parser")
        before = len(found)
        # Link steckt im href-Attribut des custom Elements <cmpr-card>, nicht
        # in einem <a> → ohne Tag-Namen-Filter suchen.
        for a in soup.find_all(href=PETITION_HREF_RE):
            m = PETITION_HREF_RE.search(a.get("href", ""))
            if not m:
                continue
            slug = m.group(1)
            if slug in found or slug in NON_PETITION_SLUGS:
                continue
            card = _card_root(a)
            found[slug] = {"started_by": _card_started_by(card),
                           "signatures": _card_signatures(card)}
        return len(found) - before

    # (a) Sitemap – sauberster Weg, falls vorhanden.
    for sm in ("/sitemap.xml", "/petitions/sitemap.xml"):
        resp = fetcher.get(urljoin(BASE_URL, sm))
        if resp and resp.status_code == 200 and "<loc>" in resp.text:
            locs = re.findall(r"<loc>([^<]+)</loc>", resp.text)
            new = 0
            for loc in locs:
                m = PETITION_HREF_RE.search(loc)
                if m and m.group(1) not in found and m.group(1) not in NON_PETITION_SLUGS:
                    found[m.group(1)] = {"started_by": None, "signatures": None}
                    new += 1
            if new:
                log(f"Sitemap {sm}: {new} Petitions-URLs gefunden.")
    bump("Sitemap geprüft")

    # (b) Startseite.
    resp = fetcher.get(BASE_URL + "/")
    if resp and resp.ok:
        log(f"Startseite: +{harvest(resp.text)} Petitionen.")
    bump("Startseite geprüft")

    # (c) Kategorieseiten inkl. Paginierung.
    for cat in category_slugs:
        cat_url = f"{BASE_URL}/categories/{cat}"
        page, empty_streak = 1, 0
        while page <= MAX_LIST_PAGES:
            url = cat_url if page == 1 else f"{cat_url}?{PAGE_PARAM}={page}"
            resp = fetcher.get(url)
            if not resp or not resp.ok:
                break
            added = harvest(resp.text)
            if added == 0:
                empty_streak += 1
                if empty_streak >= 1:        # keine neuen Slugs → Kategorie fertig
                    break
            else:
                empty_streak = 0
            page += 1
        log(f"Kategorie '{cat}': insgesamt {len(found)} Slugs gesammelt.")
        bump(f"Kategorie „{cat}“ geprüft")

    # Am 8.8.2026 über alle drei Wege gemessen — die Last liegt sehr ungleich:
    #   Sitemap (a)      0 URLs (beide Adressen; sie loggt nur, wenn sie etwas
    #                    findet, und blieb still — hier ist `found` noch leer,
    #                    die Null ist also echt und nicht bloß „nichts Neues")
    #   Startseite (b)   +9
    #   Kategorien (c)   +1.870  → zusammen 1.879
    # Der Zweig hängt damit praktisch vollständig an den Kategorieseiten. Genau
    # deshalb steht die Schwelle bei 200 und nicht höher am Messwert: fallen die
    # Kategorien aus, bleibt ein zweistelliger Rest übrig, und den fängt 200
    # sicher. Weiter hinauf wäre sie kein Ausfallmelder mehr, sondern eine
    # Wette auf den Bestand — einzelne leere Kategorien sind normal.
    core.entdeckung("Sitemap + Startseite + Kategorieseiten", len(found),
                    erwartet_min=200,
                    name_en="sitemap + home page + category pages")
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


def _sanitize_desc(node) -> str:
    """Reduziert einen Block auf erlaubte Tags; Links werden absolut gemacht."""
    for t in list(node.find_all(True)):
        if t.name not in ALLOWED_DESC_TAGS:
            t.unwrap()
            continue
        if t.name == "a":
            # Schema-Prüfung wie in core.sanitize_fragment: javascript:/data:
            # verwerfen, Link auflösen (Text bleibt), sonst absolut machen.
            ziel = core._sichere_url(t.get("href"), BASE_URL)
            t.attrs = {}
            if ziel:
                t["href"] = ziel
                t["target"] = "_blank"
                t["rel"] = "noopener"
            else:
                t.unwrap()
                continue
        else:
            t.attrs = {}
    if node.name not in ALLOWED_DESC_TAGS:
        node.name = "p"
    node.attrs = {}
    return str(node)


def _extract_description(main_html: str) -> str | None:
    """Komplette, GEGLIEDERTE Beschreibung als bereinigtes HTML.

    WeAct rendert die Texte über den Trix-Editor: jeder Absatz steckt in
    einem bloßen <div>, nicht in <p>. Ohne Umwandlung fiele der komplette
    Fließtext (Haupttext + "Warum ist das wichtig?") unbemerkt durch. Die
    <div>s in .trix-content werden deshalb zu <p> umbenannt."""
    frag = BeautifulSoup(main_html, "html.parser")
    for bad in frag.select("header, nav, footer, script, style, form, aside, "
                           "[data-component-name], .campaign-image-wrapper"):
        bad.decompose()

    if DESCRIPTION_SELECTOR:
        picked = frag.select_one(DESCRIPTION_SELECTOR)
        if picked:
            frag = BeautifulSoup(str(picked), "html.parser")

    for block in frag.select(".trix-content"):
        for div in block.find_all("div"):
            div.name = "p"
        # Zweiter Fall, der lange durchgerutscht ist: manche Abschnitte haben
        # GAR KEIN Kind-Element, der Fliesstext steht als blosser Textknoten
        # direkt im .trix-content, nur mit <br> getrennt. find_all() weiter
        # unten sammelt aber ausschliesslich Blockelemente ein - der Abschnitt
        # blieb dadurch leer, waehrend seine Ueberschrift stehen blieb.
        # Gemessen betraf das 424 der 1862 WeAct-Texte (23 %).
        if not block.find(["p", "ul", "ol", "blockquote"]):
            block.name = "p"

    out = []
    for b in frag.find_all(["h2", "h3", "h4", "p", "ul", "ol", "blockquote"]):
        txt = b.get_text(" ", strip=True)
        low = txt.lower()
        if not txt:
            continue
        if b.name in ("h2", "h3", "h4") and any(w in low for w in DESC_STOP_WORDS):
            break
        if TS_RE.search(txt) or MILESTONE_RE.search(txt):
            continue
        if low.startswith("an:"):
            continue
        if low in ("kategorie", "kategorien"):
            continue
        if (b.name == "p" and b.find("a") and len(txt) < 40
                and "/categories/" in str(b)):
            continue
        out.append(_sanitize_desc(b))
    html = "\n".join(out).strip()
    return html or None


def _extract_aktion_content(soup: BeautifulSoup) -> str | None:
    """Beschreibung für das neuere Campact-"Aktion"-Template
    (aktion.campact.de/weact/<slug>/…). Struktur unter .content-column:
      .description                      – Intro ohne eigene Überschrift
      cmpr-cta-appeal[header]           – Forderung (header → Überschrift,
                                           slot="recipients" = Adressat)
      #accordion cmpr-accordion-item[header] – ausgeklappte Akkordions
                                           (header → Überschrift, Inhalt
                                           darunter als Bodytext)."""
    root = soup.select_one(".content-column .content") or soup.select_one(".content-column")
    if not root:
        return None
    parts = []

    desc = root.select_one(".description")
    if desc:
        txt = desc.get_text(" ", strip=True)
        if txt:
            parts.append(f"<p>{_esc(txt)}</p>")

    for appeal in root.select("cmpr-cta-appeal"):
        heading = appeal.get("header")
        if heading:
            parts.append(f"<h3>{_esc(heading)}</h3>")
        copy = BeautifulSoup(str(appeal), "html.parser").find(appeal.name)
        for slot in copy.select("[slot=recipients]"):
            slot.decompose()      # Adressat wird separat als recipient erfasst
        frag = sanitize_fragment(copy, BASE_URL)
        if frag:
            parts.append(frag)

    for item in root.select("cmpr-accordion-item"):
        heading = item.get("header")
        if heading:
            parts.append(f"<h3>{_esc(heading)}</h3>")
        copy = BeautifulSoup(str(item), "html.parser").find(item.name)
        frag = sanitize_fragment(copy, BASE_URL)
        if frag:
            parts.append(frag)

    html = "\n".join(p for p in parts if p and p.strip())
    return html or None


def parse_detail(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    # Aktion-Template: og:title ist oft gekürzt – volle Überschrift im
    # h1.page-title.hero__title.
    long_title = soup.select_one("h1.page-title.hero__title")
    rec["title"] = (
        (long_title.get_text(strip=True) if long_title else None)
        or _meta(soup, "og:title")
        or (soup.h1.get_text(strip=True) if soup.h1 else None))
    rec["summary"] = _meta(soup, "og:description") or _meta(soup, "description")
    rec["image_url"] = _meta(soup, "og:image")
    # Nur eine echte Petitions-URL darf die angefragte ersetzen. Sonst schrieb
    # die Weiterleitung einer entfernten Petition die Startseiten-URL in den
    # Datensatz – und zwei entfernte Petitionen trugen anschließend dieselbe.
    canon = soup.find("link", rel="canonical")
    kandidat = (canon["href"].strip() if canon and canon.get("href")
                else _meta(soup, "og:url"))
    rec["url"] = kandidat if ist_petitionsseite(kandidat) else url

    # Adressat ("An: …")  # >>> SELEKTOR
    recipient = None
    an = soup.find(string=re.compile(r"^\s*An:\s*", re.I))
    if an:
        host = an.find_parent(["h2", "h3", "p", "div"]) or an
        recipient = re.sub(r"^\s*An:\s*", "", host.get_text(" ", strip=True))
    if not recipient:
        slot = soup.select_one("[slot=recipients]")      # Aktion-Template
        if slot:
            recipient = slot.get_text(" ", strip=True) or None
    rec["recipient"] = recipient or None

    # Kategorie über /categories/<slug>-Link.
    cat_link = soup.find("a", href=re.compile(r"/categories/[a-z0-9\-]+", re.I))
    if cat_link:
        rec["category"] = cat_link.get_text(strip=True) or None
        # Der Name ist bloßer Text und wird beim Anzeigen maskiert; die
        # ADRESSE wird angeklickt und muss deshalb die unsere sein.
        rec["category_url"] = core.eigener_link(
            cat_link.get("href"), BASE_URL, EIGENE_KATEGORIE_RE)
    else:
        rec["category"] = rec["category_url"] = None

    # Beschreibung: klassisches WeAct-Template vs. Aktion-Template.
    weact_col = (soup.select_one(".main-column .petition-content .campaign-text")
                or soup.select_one(".main-column .petition-content"))
    if weact_col:
        rec["description_full"] = _extract_description(str(weact_col))
    elif soup.select_one(".content-column"):
        rec["description_full"] = _extract_aktion_content(soup)
    else:
        main = (soup.find("main") or soup.find("article")
                or soup.find(id="main-content") or soup.body)
        rec["description_full"] = _extract_description(str(main)) if main else None

    # Neuigkeiten / Meilensteine aus datierten Einträgen.
    updates, milestones = [], []
    for node in soup.find_all(string=TS_RE):
        ts_raw = TS_RE.search(node).group(0)
        try:
            import datetime as _dt
            ts = _dt.datetime.fromisoformat(ts_raw.replace(" ", "T", 1)
                                            .replace(" ", "")).isoformat()
        except ValueError:
            ts = ts_raw
        container = node.find_parent(["li", "div", "article", "p"])
        text = container.get_text(" ", strip=True) if container else str(node)
        text = TS_RE.sub("", text).strip(" -– ")
        m_ms = MILESTONE_RE.search(text)
        schwelle = core.zahl(m_ms.group(1)) if m_ms else None
        if schwelle is not None:
            milestones.append({"threshold": schwelle, "timestamp": ts})
        elif text:
            updates.append({"timestamp": ts, "text": text[:500]})

    seen = set()
    uniq_u = []
    for u in updates:
        k = (u["timestamp"], u["text"])
        if k not in seen:
            seen.add(k); uniq_u.append(u)
    rec["updates"] = sorted(uniq_u, key=lambda x: x["timestamp"], reverse=True)
    rec["milestones"] = sorted({(m["threshold"], m["timestamp"]) for m in milestones})
    rec["milestones"] = [{"threshold": t, "timestamp": ts}
                         for t, ts in rec["milestones"]]
    rec["start_date"] = (rec["milestones"][0]["timestamp"]
                         if rec["milestones"] else None)
    return rec


def parse_json_variant(text: str) -> dict:
    """Optionale, saubere Quelle: /petitions/<slug>.json (falls vorhanden)."""
    out = {}
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return out
    obj = data.get("petition", data) if isinstance(data, dict) else {}
    # ⚠️ Alles hier ist FREMDES JSON. Ohne Typprüfung wanderte auch ein Objekt
    # oder eine Liste ungefiltert in den Datensatz — "signatures" wäre dann
    # keine Zahl mehr, und die App rechnet und vergleicht damit. Der Wert kam
    # bis hierher nur deshalb heil an, weil WeAct sich gut benimmt; das ist
    # keine Absicherung, sondern Glück (siehe core.eigene_adresse).
    if isinstance(obj, dict):
        if isinstance(obj.get("id"), (int, str)) and not isinstance(obj.get("id"), bool):
            out["petition_id"] = obj["id"]
        # Reihenfolge wie bisher: sind BEIDE Felder da, gewinnt das letzte.
        for src in ("signature_count", "signatures_count"):
            n = core.zahl(obj.get(src))
            if n is not None:
                out["signatures"] = n
        if isinstance(obj.get("title"), str) and obj["title"].strip():
            out["title"] = obj["title"].strip()
    return out


WEACT_HOST = urlsplit(BASE_URL).netloc
# Das "Aktion"-Template liegt auf einem eigenen Host und hat keinen
# Petitions-Slug im Pfad – trotzdem sind das echte Petitionen.
AKTION_HOST = "aktion.campact.de"
AKTION_PATH_RE = re.compile(r"^/weact/[a-z0-9][a-z0-9\-]*", re.I)


def ist_petitionsseite(url: str | None) -> bool:
    """Zeigt die URL auf eine Petition – oder ist die Petition weg?

    WeAct leitet entfernte Petitionen auf die Startseite um (weact.campact.de/
    bzw. www.campact.de/). Ohne diese Prüfung übernahm der Scraper Titel, Bild
    und URL DER STARTSEITE in den Datensatz und ließ ihn auf „online": in der
    App standen dadurch Phantom-Einträge namens „WeAct – Die Petitionsplattform
    von Campact", mehrere davon mit derselben URL."""
    if not url:
        return False
    teile = urlsplit(url)
    if teile.netloc in ("", WEACT_HOST):
        return bool(PETITION_HREF_RE.search(teile.path))
    if teile.netloc == AKTION_HOST:
        return bool(AKTION_PATH_RE.search(teile.path))
    return False


def canonical_slug(resp, rec: dict, requested: str) -> str:
    """Slug, unter dem der Datensatz gespeichert werden muss.

    WeAct benennt Slugs gelegentlich um und leitet den alten Pfad per 302 auf
    den neuen um (/petitions/giftexporte-stoppen → …-4). Ohne diese Auswertung
    landet die Petition zweimal im Store: einmal unter dem alten Slug – dort
    aber mit der kanonischen Ziel-URL im Datensatz, weil parse_detail den
    canonical-Link der ausgelieferten Seite übernimmt – und einmal unter dem
    neuen. In der App steht sie dann doppelt.

    Umgeschrieben wird nur bei weact.campact.de/petitions/<slug>. Die
    Umleitungen auf aktion.campact.de/weact/<name>/teilnehmen führen auf ein
    anderes Template ohne Petitions-Slug und bleiben unter ihrem Ursprungs-
    Slug stehen."""
    for cand in (getattr(resp, "url", None), (rec or {}).get("url")):
        if not cand:
            continue
        teile = urlsplit(cand)
        if teile.netloc and teile.netloc != WEACT_HOST:
            continue
        m = PETITION_HREF_RE.search(teile.path)
        if m and m.group(1) not in NON_PETITION_SLUGS:
            return m.group(1)
    return requested


def scrape_petition(fetcher: core.Fetcher,
                    slug: str) -> tuple[str, dict | None, str]:
    """(status, record, slug) – status: online | offline | error.
    Der zurückgegebene Slug kann vom angefragten abweichen, wenn WeAct auf
    einen umbenannten Pfad umleitet (siehe canonical_slug)."""
    url = f"{BASE_URL}/petitions/{slug}"
    rec: dict = {}

    if TRY_JSON_VARIANT:
        jresp = fetcher.get(url + ".json")
        if jresp is not None and jresp.status_code == 200:
            rec.update(parse_json_variant(jresp.text))

    resp = fetcher.get(url)
    if resp is None:
        return "error", None, slug
    if resp.status_code in (404, 410):
        return "offline", {"url": url}, slug
    if not resp.ok:
        return "error", None, slug
    if not ist_petitionsseite(getattr(resp, "url", None) or url):
        # Weiterleitung auf die Startseite = Petition entfernt. Die eigene
        # URL wird mitgegeben, damit ein früher verfälschter Datensatz sie
        # zurückbekommt (core.upsert korrigiert sie auch im Offline-Zweig).
        return "offline", {"url": url}, slug

    rec.update({k: v for k, v in parse_detail(resp.text, url).items()
                if v is not None or k not in rec})
    rec.setdefault("petition_id", None)
    return "online", rec, canonical_slug(resp, rec, slug)


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay)
    ts = now_iso()

    # Kategorien bei JEDEM Lauf live prüfen (neue Kategorien erkennen).
    log("Prüfe Kategorie-Navigation …")
    prog(phase="categories", current=0, total=0, message="Prüfe Kategorien …")
    prev_categories = load_known_categories()
    live_categories = discover_categories(fetcher)
    # Der Fallback unten fängt den Ausfall dieses Zweigs auf — und verdeckt ihn
    # damit zugleich: der Lauf geht mit der festen Liste weiter, meldet keinen
    # Fehler und sieht von außen gesund aus. Genau dieses Muster (ein zweiter
    # Weg füllt die Lücke) war bei Change.org der Anlass für entdeckung().
    # Schwelle gemessen am 8.8.2026: 24 Kategorien. 10 darf hier näher am
    # Messwert liegen als bei den Petitionslisten, weil eine Navigation eine
    # STABILE Struktur ist und nicht mit dem Kampagnenbestand schwankt — so
    # fällt auch der Teilausfall auf, bei dem das Muster nur noch einen Rest
    # der Einträge erkennt.
    core.entdeckung("Kategorie-Navigation", len(live_categories),
                    erwartet_min=10, name_en="category navigation")
    if live_categories:
        categories = live_categories
        category_slugs = sorted(categories)
    else:
        log("Kategorie-Navigation nicht lesbar – verwende feste Fallback-Liste.")
        categories = {c: c for c in CATEGORY_SLUGS}
        category_slugs = CATEGORY_SLUGS
    new_categories = sorted(set(categories) - set(prev_categories)) if prev_categories else []
    if new_categories:
        log(f"NEU: {len(new_categories)} neue Kategorie(n) seit letztem Lauf: "
            f"{', '.join(new_categories)}")

    def save(quiet=True, **extra):
        core.save_store(store, DATA_FILE,
                        extra_meta={"categories": categories, **extra},
                        quiet=quiet)

    # Umleitungen dieses Laufs: alter Slug → kanonischer Slug. Bewusst nur im
    # Arbeitsspeicher: WeAct kann einen frei gewordenen Slug später neu
    # vergeben, eine dauerhafte Tabelle würde die Petition dann falsch
    # zuordnen. Der Preis ist ein zusätzlicher Abruf je umbenannter Petition.
    alias: dict[str, str] = {}

    def store_result(requested: str, key: str, rec: dict | None,
                     hint: dict, status: str) -> None:
        """Schreibt das Ergebnis unter dem kanonischen Slug weg und führt einen
        etwaigen Altbestand unter dem angefragten Slug mit ihm zusammen."""
        if key != requested:
            alias[requested] = key
            if core.merge_records(store, requested, key):
                log(f"  UMBENANNT: {requested} → {key} (Weiterleitung) – "
                    f"Datensätze zusammengeführt.")
        core.upsert(store, key, rec or {}, hint, status, ts,
                    f"{BASE_URL}/petitions/{key}")

    # Bekannte Petitionen werden VOR jeder Neuentdeckung geprüft.
    known_slugs = list(store.keys())
    if known_slugs and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known_slugs)} bekannte Petition(en) …")
        prog(phase="check-known", current=0, total=len(known_slugs),
             message="Prüfe bekannte Petitionen …")
        for k, slug in enumerate(known_slugs, 1):
            prog(current=k, total=len(known_slugs), message=slug)
            if slug not in store:      # zuvor in diesem Lauf zusammengeführt
                continue
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec, key = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            store_result(slug, key, rec, {}, status)
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
    elif args.no_recheck:
        log("Prüfung bekannter Petitionen übersprungen (--no-recheck).")

    log("Sammle Petitions-Slugs aus Listen …")
    prog(phase="discover", current=0, total=0, message="Sammle Petitionen …")
    discovered = discover_slugs(fetcher, category_slugs)

    # Listen verlinken umbenannte Petitionen oft noch unter dem alten Slug.
    # Schon aufgelöste Umleitungen werden deshalb hier übersetzt – sonst legte
    # der Listen-Upsert den eben zusammengeführten Slug sofort wieder an.
    hints: dict[str, dict] = {}
    for slug, hint in discovered.items():
        key = alias.get(slug, slug)
        # Sind alter und neuer Slug gelistet, zählt die Karte des kanonischen:
        # die alte Karte kann eine abweichende Unterschriftenzahl zeigen.
        if key in hints and slug != key:
            continue
        hints[key] = hint
    # Überlebt jeden Abbruch (s. save_store: _TLS.lauf_meta, 24.8.2026) —
    # bewusst NACH der Alias-Auflösung, wie im Abschluss-Save.
    core.lauf_meta_setzen(available=len(hints))

    known_set = set(store)     # nach dem Recheck: die kanonischen Schlüssel
    # Bereits geprüfte Petitionen nicht nochmal laden – nur Listen-Infos
    # (Unterschriften/Starter*in) ohne Zusatz-Request übernehmen.
    new_slugs = [s for s in hints if s not in known_set]
    for slug, hint in hints.items():
        if slug in known_set:
            core.upsert(store, slug, {}, hint, "online", ts,
                        f"{BASE_URL}/petitions/{slug}")
    if args.limit:
        new_slugs = new_slugs[:args.limit]
    log(f"{len(new_slugs)} neue Petitionen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_slugs), message="Beginne Scrape …")

    for i, slug in enumerate(new_slugs, 1):
        log(f"({i}/{len(new_slugs)}) {slug}")
        prog(current=i, total=len(new_slugs), message=slug)
        status, rec, key = scrape_petition(fetcher, slug)
        if status == "error":
            log("  übersprungen (Fehler) – Datensatz bleibt unverändert.")
            continue
        # Bei einer Weiterleitung gilt die Karte des Ziel-Slugs, falls gelistet.
        store_result(slug, key, rec, hints.get(key) or hints.get(slug) or {},
                     status)
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf: "
            f"{', '.join(new_petitions[:10])}"
            f"{' …' if len(new_petitions) > 10 else ''}")
    else:
        log("Keine neuen Petitionen seit dem letzten Lauf gefunden.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         new_categories_last_run=new_categories,
         available=len(hints))      # ohne doppelt gelistete Alt-Slugs
    core.write_list_html(PLATFORM)
    log("Fertig (WeAct).")


def check(fetcher):
    return core.check_source(fetcher, BASE_URL + "/", PETITION_HREF_RE, 5,
                             "Petitionen")

PLATFORM = Platform(
    key="weact",
    openness=4,
    openness_note="Offen: vollständige Listen über Kategorien + Pagination, aber "
                  "technische Hürden (Custom-Elemente statt Links, verstecktes "
                  "cpage-Parameter, zwei verschiedene Seiten-Templates).",
    name="WeAct",
    eyebrow="WeAct · Campact",
    source_url=BASE_URL,
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    # Kompatibilität: `python3 weact_scraper.py --serve` funktioniert weiter
    # und delegiert an den neuen zentralen Einstiegspunkt.
    import monitor
    monitor.main()
