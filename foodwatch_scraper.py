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
#    - https://www.foodwatch.org/de/mitmachen              Übersicht (DE)
#    - https://www.foodwatch.org/de/mitmachen/<slug>       Detailseite (DE)
#    - https://www.foodwatch.org/at/mitmachen/petitionen   Übersicht (AT)
#    - .../at/mitmachen/petitionen/<slug>                  Detailseite (AT)
#      ⚠️ Der österreichische Baum liegt eine Ebene TIEFER als der deutsche;
#      ein Tausch des Ländersegments ergibt 404. Details bei AT_LIST_URL.
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

# ----------------------------------------------------------------------------
# ÖSTERREICH (4.9.2026)
# ----------------------------------------------------------------------------
# foodwatch betreibt eigene Landesorganisationen. /at/ ist DEUTSCHsprachig wie
# /de/, aber ein anderes LAND — genau der Fall, für den die Landachse gebaut
# wurde („deutsch/Deutschland" gegen „deutsch/Österreich").
#
# ⚠️ Die Adressstruktur ist NICHT ableitbar, sie musste gemessen werden:
#     Deutschland   /de/mitmachen/<slug>                 (drei Ebenen)
#     Österreich    /at/mitmachen/petitionen/<slug>       (VIER Ebenen)
# Ein Tausch des Ländersegments ergibt 404. Am 4.9.2026 abgerufen; die Übersicht
# /at/mitmachen zeigt nur EINEN Teaser, die vollständige Liste steht unter
# /at/mitmachen/petitionen (dort 10 Aktionen). robots.txt sperrt nur /at/suche.
#
# ⚠️⚠️ Der Bestand ist nach Schlüssel verschlüsselt, und Deutschland und
# Österreich teilen sich EINE Datei (der englische Zwilling hat eine eigene).
# `aspartam-verbieten` gibt es in BEIDEN Ländern — bei nacktem Slug hätte ein
# Satz den anderen still überschrieben. Österreichische Sätze tragen deshalb den
# Präfix „at/". Die 15 bestehenden deutschen Schlüssel bleiben unangetastet,
# es ist also keine Wanderung des Bestands nötig.
AT_PREFIX       = "at/"
AT_LIST_URL     = f"{BASE_URL}/at/mitmachen/petitionen"
AT_ACTION_HREF_RE = re.compile(
    r'href="(/at/mitmachen/petitionen/[a-z0-9\-]+)"')
AT_DETAILADRESSE_RE = re.compile(
    r"^https://(www\.)?foodwatch\.org/at/mitmachen/petitionen/[^/?#]+", re.I)


def _ist_at(key: str) -> bool:
    return key.startswith(AT_PREFIX)


def _url_fuer(key: str) -> str:
    """Store-Schlüssel → Detailadresse. Der Schlüssel trägt das Land."""
    if _ist_at(key):
        return f"{AT_LIST_URL}/{key[len(AT_PREFIX):]}"
    return f"{LIST_URL}/{key}"


def _muster_fuer(key: str) -> re.Pattern:
    """Maßstab für core.eigene_adresse — je Länderbaum ein eigener."""
    return AT_DETAILADRESSE_RE if _ist_at(key) else DETAILADRESSE_RE


def _land_fuer(key: str) -> str:
    return "AT" if _ist_at(key) else "DE"


FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}

# ---- Der englische Zwilling als EIGENER Plattform-Eintrag (12.8.2026) -------
# ⚠️ Der englische Baum liegt flach unter /en/<slug> — KEIN /mitmachen/ wie im
# Deutschen (siehe den Block „SPRACHFASSUNGEN" weiter unten). Deshalb ein
# eigenes Adressmuster; mit dem deutschen fiele core.eigene_adresse immer auf
# die angefragte Adresse zurück und der Riegel liefe leer mit.
EN_DATA_FILE = Path("foodwatch_en_petitions.json")
EN_HTML_FILE = Path("foodwatch_en_petitions.html")
EN_ACTION_HREF_RE = re.compile(r'href="(/en/[a-z0-9\-]+)"')
EN_DETAILADRESSE_RE = re.compile(
    r"^https://(www\.)?foodwatch\.org/en/[^/?#]+", re.I)
FETCH_HEADERS_EN = dict(FETCH_HEADERS, **{"Accept-Language": "en-US,en;q=0.9"})


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

    # ---- Österreich (4.9.2026) ---------------------------------------------
    # ⚠️ EIGENE Meldung, nicht in die deutsche Zahl eingerechnet: sonst
    # verdeckte der eine Länderbaum den Totalausfall des anderen. Fiele
    # Österreich weg, stünden immer noch 15 deutsche Treffer da und keine
    # Schwelle würde anschlagen.
    at_gefunden: dict[str, dict] = {}
    resp_at = fetcher.get(AT_LIST_URL)
    if resp_at is not None and resp_at.ok:
        for m in AT_ACTION_HREF_RE.finditer(resp_at.text):
            slug = m.group(1).rsplit("/", 1)[-1]
            at_gefunden.setdefault(AT_PREFIX + slug, {})
    # Schwelle am 4.9.2026 gemessen: die Liste lieferte 10 Aktionen. 3 liegt
    # tief genug für normales Auslaufen von Kampagnen, fängt aber den
    # Markup-Umbau, nach dem das Muster nur noch einzeln greift.
    core.entdeckung("Österreich-Petitionsliste", len(at_gefunden),
                    erwartet_min=3, name_en="Austrian petition list")
    log(f"Österreich: {len(at_gefunden)} Aktionen gefunden.")
    found.update(at_gefunden)
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


# Meta-Namen, die wir GESEHEN und ENTSCHIEDEN haben. Was hier fehlt, meldet
# core.felder_melden() als „Neues Feld auf der Quellseite".
#
# ⚠️ Am 30.8.2026 über 26 echte Detailseiten abgelesen, nicht über eine.
# Genutzt wird davon nur ein Teil (og:description, og:image, og:title …); der
# Rest steht als bewusst VERWORFEN dabei — Seitentechnik, keine Inhalte. Ein
# Eintrag hier heißt „gesehen und entschieden", nicht „genutzt".
BEKANNTE_FELDER = {
    "description",
    "format-detection",
    "generator",
    "google-site-verification",
    "msapplication-TileColor",
    "msapplication-TileImage",
    "msapplication-config",
    "msapplication-tilecolor",
    "msapplication-tileimage",
    "og:description",
    "og:image",
    "og:image:alt",
    "og:image:height",
    "og:image:url",
    "og:image:width",
    "og:site_name",
    "og:title",
    "og:type",
    "og:url",
    "theme-color",
    "twitter:card",
    "twitter:description",
    "twitter:image",
    "twitter:image:alt",
    "twitter:title",
    "viewport",
}


def parse_detail(html: str, url: str, muster: re.Pattern = None) -> dict:
    """`muster` ist der Maßstab für core.eigene_adresse; ohne Angabe der
    deutsche Baum. Der englische Baum hat ein anderes Wegstück und braucht
    deshalb EN_DETAILADRESSE_RE, sonst greift der Riegel dort nie."""
    muster = muster if muster is not None else DETAILADRESSE_RE
    soup = BeautifulSoup(html, "html.parser")
    # Feldraum dieser Quelle sind die Meta-Tags (siehe BEKANNTE_FELDER).
    core.felder_aus_meta(soup)
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
        muster)

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
    skip = Seite ohne Unterschriften-Formular (keine Mitzeichnungs-Aktion).

    `slug` ist der STORE-SCHLÜSSEL, nicht der nackte Slug: bei österreichischen
    Sätzen trägt er den Präfix „at/" und bestimmt damit Adresse, Prüfmuster und
    Land (siehe oben)."""
    url = _url_fuer(slug)
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    rec = parse_detail(resp.text, url, _muster_fuer(slug))
    if rec.get("signatures") is None:
        return "skip", None
    rec["country"] = _land_fuer(slug)
    # ⚠️ Die Fremdsprachen-Heuristik NUR für den deutschen Baum. Sie ordnet über
    # den identischen Unterschriftenstand zu (siehe dort) und wurde am 8.8.2026
    # ausschließlich gegen /de/ gemessen. Auf österreichische Aktionen
    # losgelassen, würde sie denselben Zähler-Vergleich gegen den ENGLISCHEN
    # Baum fahren und Zuordnungen behaupten, die niemand geprüft hat.
    if not _ist_at(slug):
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
# ⚠️ ZWEI Einstiege, und das ist kein Übereifer: am 12.8.2026 gemessen listet
# /en NUR FÜNF der sieben englischen Aktionen. Es fehlten
# „restrict-food-speculation-feed-people-not-banks" (119.237 Unterschriften)
# und „supermarkets-stop-the-toxic-harvest" (105.356) — beide HTTP 200 mit
# gültigem Zähler, also echte Aktionen, bloß von der Startseite nicht
# verlinkt. Über /en allein fehlten 2 von 7 (29 %). Die Vereinigung beider
# Listen kostet einen Abruf und schließt die Lücke.
EN_LIST_URLS = (f"{BASE_URL}/en/take-action-1", f"{BASE_URL}/en")
MIN_ZAEHLER = 1000
FREMDSPRACHEN = ("en",)
_EN_INDEX: dict[str, dict[int, str]] = {}
_EN_SEITEN: dict[str, dict[str, dict]] = {}


def _en_seiten(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: datensatz} des ganzen englischen Baums, einmal je Prozess.

    ⚠️ Diese Abrufe fielen schon immer an: _en_index() hat jede englische Seite
    geholt, geparst und alles außer dem Zählerstand weggeworfen. Seit es einen
    eigenen englischen Plattform-Eintrag gibt (run_en), wird das Ergebnis
    behalten — der Zähler-Index und der englische Lauf teilen sich denselben
    Abruf, statt den Baum zweimal zu holen.
    """
    if "en" in _EN_SEITEN:
        return _EN_SEITEN["en"]
    seiten: dict[str, dict] = {}
    slugs: set[str] = set()
    for liste in EN_LIST_URLS:
        resp = fetcher.get(liste)
        if resp is not None and resp.ok:
            slugs |= {m.rsplit("/", 1)[-1]
                      for m in EN_ACTION_HREF_RE.findall(resp.text)}
    for slug in sorted(slugs):
        url = f"{BASE_URL}/en/{slug}"
        r2 = fetcher.get(url)
        if r2 is None or not r2.ok:
            continue
        seiten[slug] = parse_detail(r2.text, url, EN_DETAILADRESSE_RE)
    _EN_SEITEN["en"] = seiten
    return seiten


def _en_index(fetcher: core.Fetcher) -> dict[int, str]:
    """{unterschriften: slug} des englischen Baums, einmal je Lauf geholt.

    Mehrdeutige Stände (zweimal derselbe Zähler) fliegen ganz heraus — lieber
    keine Zuordnung als eine falsche."""
    if "en" in _EN_INDEX:
        return _EN_INDEX["en"]
    index: dict[int, str] = {}
    doppelt: set[int] = set()
    for slug, rec in sorted(_en_seiten(fetcher).items()):
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
        # Die Seite liegt aus _en_seiten() schon geparst vor — der frühere
        # Zweitabruf derselben Adresse entfällt.
        fremd = _en_seiten(fetcher).get(fremd_slug)
        if not fremd:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")
            continue
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
                        _url_fuer(slug))
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
        core.entferne_skip(store, skip_slugs, geprueft, "foodwatch",
                           grund_de="kein Unterschriften-Formular mehr",
                           grund_en="no signature form anymore", save=save)

    log("Sammle Aktionen von der Mitmachen-Übersicht …")
    discovered = discover_slugs(fetcher)
    # Überlebt jeden Abbruch (s. save_store: _TLS.lauf_meta, 24.8.2026).
    core.lauf_meta_setzen(available=len(discovered))
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
        core.upsert(store, slug, rec or {}, {}, status, ts, _url_fuer(slug))
        save()

    # Einmal je Lauf, VOR dem Abschluss-Save — sonst fehlte
    # der Befund im _meta und damit im Dashboard.
    core.felder_melden(BEKANNTE_FELDER)

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
    # ✅ 4.9.2026 aufgelöst: Deutschland UND Österreich werden erhoben, der
    # Bestand liefert `countries` = ["AT", "DE"]. Hier stand vorher „nicht
    # ableitbar, countries bleibt leer" — das galt nur, solange die Entdeckung
    # bei /de/mitmachen aufhörte.
    # ⏰ ⬜ Offen bleiben /fr/ und /nl/: das wären neue SPRACHEN und damit
    # eigene Plattform-Einträge, kein bloßer zweiter Länderbaum.
    country_scope="mehrere",
    openness=5,
    openness_wunsch="Komplette Aktionsliste, Unterschriftenzahl und Volltext direkt im "
                    "server-gerenderten HTML: kein Schlüssel, keine Sitzung, kein "
                    "JavaScript nötig. Ein Abruf je Seite genügt, und alles Nötige "
                    "steht darin.",
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


# ----------------------------------------------------------------------------
# Der englische Eintrag — eine eigene Plattform, keine Übersetzungsspalte
# ----------------------------------------------------------------------------
# ⚠️ Bewusst OHNE campaign_id. Die einzige Zuordnung, die foodwatch hergibt,
# ist der Unterschriftenzähler (siehe der Block „SPRACHFASSUNGEN" oben), und
# der ist am 9.8.2026 schon einmal zwischen zwei Abrufen gewandert. Eine
# geratene Zuordnung ließe die App eine falsche Tatsache behaupten — kein
# Abzeichen ist besser als ein falsches. Ob sich ein Paar INHALTLICH belegen
# lässt, wird getrennt gemessen (Etappe 4 des Plans), an den Plattformen mit
# echter Kennung als Prüfstand.
#
# Zwei englische Aktionen haben nachweislich gar kein deutsches Gegenstück
# (u. a. /en/supermarkets-stop-the-toxic-harvest) — der englische Baum ist
# also eine eigenständige Menge und keine Übersetzungsspalte des deutschen.
def run_en(args) -> None:
    store = core.load_store(EN_DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS_EN)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, EN_DATA_FILE, extra_meta=extra, quiet=quiet)

    log("Sammle englische Aktionen …")
    prog(phase="scrape", current=0, total=0, message="Hole englischen Baum …")
    seiten = _en_seiten(fetcher)
    core.lauf_meta_setzen(available=len(seiten))   # überlebt Abbruch
    log(f"{len(seiten)} englische Aktion(en) gefunden "
        f"(Gesamt im Store: {len(store)}).")

    gesehen = 0
    for i, (slug, rec) in enumerate(sorted(seiten.items()), 1):
        prog(current=i, total=len(seiten), message=slug)
        # Ohne Zähler ist es keine Mitzeichnungs-Aktion, sondern eine
        # Inhaltsseite — dieselbe Bedingung wie im deutschen Lauf.
        if rec.get("signatures") is None:
            continue
        satz = dict(rec)
        i18n.setze_hauptsprache(satz, "en")
        core.upsert(store, slug, satz, {}, "online", ts,
                    f"{BASE_URL}/en/{slug}")
        gesehen += 1
        save()

    # Was der Baum nicht mehr listet, ist damit NICHT offline — die Übersicht
    # kann sich umbauen. Einzeln nachfragen; nur eine 404/410 ist ein Beleg.
    verschwunden = [s for s in store if s not in seiten]
    for slug in verschwunden:
        url = f"{BASE_URL}/en/{slug}"
        resp = fetcher.get(url)
        if resp is None:
            continue
        if resp.status_code in (404, 410):
            core.upsert(store, slug, {}, {}, "offline", ts, url)
            log(f"  OFFLINE: {slug}")
            save()
        elif resp.ok:
            satz = parse_detail(resp.text, url, EN_DETAILADRESSE_RE)
            if satz.get("signatures") is not None:
                i18n.setze_hauptsprache(satz, "en")
                core.upsert(store, slug, satz, {}, "online", ts, url)
                gesehen += 1
                save()

    neu = [s for s, r in store.items() if r.get("first_seen") == ts]
    if neu:
        log(f"NEU: {len(neu)} neue englische Aktion(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=neu, available=len(seiten))
    core.write_list_html(PLATFORM_EN)
    log(f"Fertig (foodwatch English, {gesehen} Aktion(en) bestätigt).")


def check_en(fetcher):
    return core.check_source(fetcher, EN_LIST_URLS[0], EN_ACTION_HREF_RE, 3,
                             "Aktionen")


PLATFORM_EN = Platform(
    key="foodwatch_en",
    # ⚠️ 4.9.2026 auf "keine" korrigiert. `/en/` ist KEIN Länderbaum, sondern
    # der internationale englischsprachige — foodwatch hat keine britische
    # Organisation. Als "mehrere" mit leerer Länderliste landete der Eintrag
    # unter „Noch nicht zugeordnet", was eine Wissenslücke behauptet, die es
    # nicht gibt: hier ist nichts zu erheben. Gehört unter „Weltweit".
    country_scope="keine",
    openness=5,
    openness_wunsch="Komplette Aktionsliste, Unterschriftenzahl und Volltext direkt im "
                    "server-gerenderten HTML: kein Schlüssel, keine Sitzung, kein "
                    "JavaScript nötig. Ein Abruf je Seite genügt, und alles Nötige "
                    "steht darin.",
    openness_note="Sehr offen: komplette Aktionsliste, Zähler und Volltexte direkt "
                  "im server-gerenderten HTML, robots.txt erlaubt praktisch alles.",
    name="foodwatch (English)",
    eyebrow="foodwatch · Mitmach-Aktionen (englisch)",
    source_url="https://www.foodwatch.org/en",
    data_file=EN_DATA_FILE,
    html_file=EN_HTML_FILE,
    run=run_en,
    check=check_en,
    language="en",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
