#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  foodwatch_scraper.py  —  Plattform-Modul für foodwatch-Mitmach-Aktionen
# =============================================================================
#
#  Scrapt die Mitmach-Aktionen (E-Mail-Aktionen/Petitionen) von
#  foodwatch.org/de. Nutzt petitions_core.py; Einstieg monitor.py.
#
#  QUELLEN (robots.txt erlaubt alles außer Suche/Privatem; Sitemap vorhanden):
#    - https://www.foodwatch.org/de/mitmachen              Übersicht
#    - https://www.foodwatch.org/de/mitmachen/<slug>       Detailseite
#
#  BESONDERHEITEN:
#  - TYPO3, komplett server-gerendert. Unterschriftenzähler steht direkt im
#    Formular: <p id="form-counter" class="count">401358</p>.
#  - Aktionsseiten OHNE Zähler (z. B. reine Info-/Newsletter-Seiten) werden
#    übersprungen ("skip") bzw. aus dem Bestand entfernt.
#  - Kein Sammelziel und kein Startdatum öffentlich → goal/start_date leer.
#  - Initiator ist immer foodwatch selbst.
# =============================================================================

from __future__ import annotations

import re
from pathlib import Path

from bs4 import BeautifulSoup

import i18n_helfer as i18n
import petitions_core as core
from petitions_core import Platform, log, now_iso, prog, sanitize_fragment

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://www.foodwatch.org"
LIST_URL  = f"{BASE_URL}/de/mitmachen"
DATA_FILE = Path("foodwatch_petitions.json")
HTML_FILE = Path("foodwatch_petitions.html")

ACTION_HREF_RE = re.compile(r'href="(/de/mitmachen/[a-z0-9\-]+)"')
# Eine Aktionsseite hat unterhalb von /de/mitmachen noch ein Wegstück; die
# Übersicht selbst hat keins. Maßstab für core.eigene_adresse.
DETAILADRESSE_RE = re.compile(
    r"^https://(www\.)?foodwatch\.org/de/mitmachen/[^/?#]+", re.I)

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


# ----------------------------------------------------------------------------
# Entdeckung
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: {}} von der Mitmachen-Übersicht."""
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=1, message="Lade Übersicht …")
    resp = fetcher.get(LIST_URL)
    if resp is not None and resp.ok:
        for m in ACTION_HREF_RE.finditer(resp.text):
            slug = m.group(1).rsplit("/", 1)[-1]
            found.setdefault(slug, {})
    log(f"Übersicht: {len(found)} Aktionen gefunden.")
    prog(current=1, total=1,
         message=f"Übersicht geprüft · {len(found)} Aktionen")
    # Diese eine Seite IST die gesamte Entdeckung — es gibt keinen zweiten
    # Zweig, der einen Ausfall auffangen (und damit verdecken) würde.
    # Schwelle gemessen am 8.8.2026: die Übersicht lieferte 15 Aktionen. 3 liegt
    # tief genug, dass ein normales Auslaufen von Kampagnen nie meldet, fängt
    # aber den realistischen Teilausfall: nach einem Markup-Umbau passt das
    # Muster nur noch auf einzelne Treffer statt auf alle.
    core.entdeckung("Mitmachen-Übersicht", len(found), erwartet_min=3,
                    name_en="campaign overview page")
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


def parse_detail(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    h1 = soup.find("h1")
    rec["title"] = (h1.get_text(" ", strip=True) if h1
                    else _meta(soup, "og:title"))
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    # Nur eine echte Aktionsseite darf die angefragte Adresse ersetzen — siehe
    # core.eigene_adresse. Dieselbe ungeprüfte Übernahme hat bei WeAct und bei
    # Avaaz je einen Schwung Phantomsätze mit gemeinsamer Adresse erzeugt.
    # foodwatch antwortet heute sauber mit 404 (8.8.2026 gemessen: HTTP 404,
    # canonical auf …/de/sorry-die-seite…), der Riegel ist hier Vorsorge.
    canon = soup.find("link", rel="canonical")
    rec["url"] = core.eigene_adresse(
        (canon.get("href") if canon else None) or _meta(soup, "og:url"), url,
        DETAILADRESSE_RE)

    counter = soup.select_one("#form-counter")
    if counter:
        digits = re.sub(r"\D", "", counter.get_text())
        if digits:
            rec["signatures"] = int(digits)

    content = soup.select_one("section.document-content__content")
    if content:
        for bad in content.select("form, script, style"):
            bad.decompose()
        # Hover-Dubletten weg. foodwatch legt zu jeder Kachelbeschriftung eine
        # zweite mit der Endung "--hover" ins HTML und tauscht sie per CSS aus.
        # Im bereinigten Text steht davon nichts mehr im Weg – dort stand
        # jeder Name schlicht zweimal ("Deutschland Deutschland" im Block
        # "Eine gemeinsame Aktion von").
        for dub in content.select('[class*="--hover"]'):
            dub.decompose()
        rec["description_full"] = sanitize_fragment(content, BASE_URL) or None

    rec["started_by"] = "foodwatch"
    rec["kind"] = "petition"
    return rec


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error | skip.
    skip = Seite ohne Unterschriften-Formular (keine Mitzeichnungs-Aktion)."""
    url = f"{LIST_URL}/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    rec = parse_detail(resp.text, url)
    if rec.get("signatures") is None:
        return "skip", None
    _fremdsprachen_holen(fetcher, rec, slug)
    return "online", rec


# ---------------------------------------------------------------------------
# SPRACHFASSUNGEN
#
# foodwatch betreibt Länderseiten (/de/ /en/ /fr/ /nl/ /at/, laut robots.txt).
# ⚠️ Die englische Fassung hat einen EIGENEN Slug UND ein anderes Wegstück:
# /de/mitmachen/aspartam-verbieten ↔ /en/no-to-aspartame-in-our-food-and-drinks
# — kein /mitmachen/, kein gemeinsamer Wortstamm. Ein simpler Tausch des
# Sprachsegments ergibt 404 (am 8.8.2026 geprüft). Es gibt also KEINEN
# ableitbaren Weg und auch keine gemeinsame Kampagnen-ID: die Formular-IDs
# unterscheiden sich (action-form-tel-de-53262 gegen action-form-en-50163).
#
# ⚠️⚠️ WAS BLEIBT, IST EINE HEURISTIK: der UNTERSCHRIFTENZÄHLER ist auf beiden
# Seiten identisch und zeitgleich (Aspartam 401.614/401.614, Mineralöl
# 157.331/157.331). Das ist ein starkes, aber kein zwingendes Merkmal — zwei
# verschiedene Aktionen KÖNNTEN denselben Stand haben. Deshalb:
#   · zugeordnet wird nur, wenn der Stand im englischen Baum GENAU EINMAL
#     vorkommt; bei zwei Kandidaten wird nichts geraten
#   · Zähler unter MIN_ZAEHLER bleiben außen vor, weil kleine Zahlen leicht
#     zufällig zusammenfallen
# Von den 15 laufenden Aktionen hatten am 8.8.2026 fünf einen englischen
# Zwilling. Eine englische Aktion (/en/supermarkets-stop-the-toxic-harvest)
# hat KEINE deutsche Entsprechung — die Zuordnung ist also nicht 1:1.
EN_LIST_URL = f"{BASE_URL}/en"
MIN_ZAEHLER = 1000
FREMDSPRACHEN = ("en",)
_EN_INDEX: dict[str, dict[int, str]] = {}


def _en_index(fetcher: core.Fetcher) -> dict[int, str]:
    """{unterschriften: slug} des englischen Baums, einmal je Lauf geholt.

    Mehrdeutige Stände (zweimal derselbe Zähler) fliegen ganz heraus — lieber
    keine Zuordnung als eine falsche."""
    if "en" in _EN_INDEX:
        return _EN_INDEX["en"]
    index: dict[int, str] = {}
    doppelt: set[int] = set()
    resp = fetcher.get(EN_LIST_URL)
    if resp is not None and resp.ok:
        slugs = {m.rsplit("/", 1)[-1]
                 for m in re.findall(r'href="(/en/[a-z0-9\-]+)"', resp.text)}
        for slug in sorted(slugs):
            r2 = fetcher.get(f"{BASE_URL}/en/{slug}")
            if r2 is None or not r2.ok:
                continue
            rec = parse_detail(r2.text, f"{BASE_URL}/en/{slug}")
            zahl = rec.get("signatures")
            if not isinstance(zahl, int) or zahl < MIN_ZAEHLER:
                continue
            if zahl in index:
                doppelt.add(zahl)
            index[zahl] = slug
    for z in doppelt:
        index.pop(z, None)
    log(f"Englischer Baum: {len(index)} eindeutige Zählerstände"
        + (f", {len(doppelt)} mehrdeutige verworfen" if doppelt else ""))
    _EN_INDEX["en"] = index
    return index


def _fremdsprachen_holen(fetcher: core.Fetcher, rec: dict, slug: str) -> None:
    # Fremdsprachen sind abschaltbar (siehe i18n_helfer) — der
    # Tageslauf verzichtet darauf, ein eigener Lauf holt sie nach.
    if not i18n.aktiv():
        return
    i18n.setze_hauptsprache(rec, "de")
    for lang in FREMDSPRACHEN:
        zahl = rec.get("signatures")
        if not isinstance(zahl, int) or zahl < MIN_ZAEHLER:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
            continue
        fremd_slug = _en_index(fetcher).get(zahl)
        if not fremd_slug:
            # Kein Zwilling mit gleichem Stand. Das heißt NICHT sicher „gibt es
            # nicht" — der Stand kann sich zwischen beiden Abrufen bewegt
            # haben. Deshalb ungeklärt und kein Abzeichen in der App.
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
            continue
        url = f"{BASE_URL}/en/{fremd_slug}"
        resp = fetcher.get(url)
        if resp is None or not resp.ok:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
            continue
        fremd = parse_detail(resp.text, url)
        if (fremd.get("title") or "").strip():
            i18n.setze_sprachfassung(rec, lang, "vorhanden", fremd)
            # Erst JETZT gibt es eine belastbare gemeinsame Kennung: das Paar
            # ist über den Zähler belegt, nicht bloß vermutet.
            rec["campaign_id"] = f"foodwatch:{slug}"
        else:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, DATA_FILE, extra_meta=extra, quiet=quiet)

    known_slugs = list(store.keys())
    if known_slugs and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known_slugs)} bekannte Aktion(en) …")
        prog(phase="check-known", current=0, total=len(known_slugs),
             message="Prüfe bekannte Aktionen …")
        skip_slugs, geprueft = [], 0
        for k, slug in enumerate(known_slugs, 1):
            prog(current=k, total=len(known_slugs), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            geprueft += 1
            if status == "skip":
                # Nicht sofort löschen: ein geänderter Seitenaufbau ließe das
                # Unterschriften-Formular überall „verschwinden". Sammeln.
                skip_slugs.append(slug)
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{LIST_URL}/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
        core.entferne_skip(store, skip_slugs, geprueft, "foodwatch",
                           grund_de="kein Unterschriften-Formular mehr",
                           grund_en="no signature form anymore", save=save)

    log("Sammle Aktionen von der Mitmachen-Übersicht …")
    discovered = discover_slugs(fetcher)
    known_set = set(known_slugs)
    new_slugs = [s for s in discovered if s not in known_set]
    if args.limit:
        new_slugs = new_slugs[:args.limit]
    log(f"{len(new_slugs)} neue Aktionen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_slugs),
         message="Beginne Scrape …")

    for i, slug in enumerate(new_slugs, 1):
        log(f"({i}/{len(new_slugs)}) {slug}")
        prog(current=i, total=len(new_slugs), message=slug)
        status, rec = scrape_petition(fetcher, slug)
        if status == "error":
            continue
        if status == "skip":
            log("  übersprungen (keine Mitzeichnungs-Aktion).")
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts, f"{LIST_URL}/{slug}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Aktion(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(PLATFORM)
    log("Fertig (foodwatch).")


def check(fetcher):
    return core.check_source(fetcher, LIST_URL, ACTION_HREF_RE, 3, "Aktionen")

PLATFORM = Platform(
    key="foodwatch",
    openness=5,
    openness_note="Sehr offen: komplette Aktionsliste, Zähler und Volltexte direkt "
                  "im server-gerenderten HTML, robots.txt erlaubt praktisch alles.",
    name="foodwatch",
    eyebrow="foodwatch · Mitmach-Aktionen (deutsch)",
    source_url="https://www.foodwatch.org/de/mitmachen",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
