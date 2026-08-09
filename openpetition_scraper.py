#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  openpetition_scraper.py  —  Plattform-Modul für OpenPetition (deutsch)
# =============================================================================
#
#  Scrapt die laufenden Petitionen von openpetition.de. Nutzt
#  petitions_core.py; Einstiegspunkt ist monitor.py.
#
#  QUELLEN (robots.txt ist großzügig: nur Verwaltungs-/Untertabs wie
#  /petition/unterzeichner/, /petition/kommentare/ sind gesperrt – die werden
#  hier nicht angefasst; Crawl-delay 1 s wird über REQUEST_DELAY eingehalten):
#    - https://www.openpetition.de/petitionen?seite=N   Liste (18 pro Seite,
#      ~90+ Seiten), Stopp sobald eine Seite keine neuen Slugs liefert
#    - https://www.openpetition.de/petition/online/<slug>   Detailseite
#
#  BESONDERHEITEN:
#  - Detailseiten sind vollständig server-gerendert – Stand, Ziel, Status,
#    Text stehen direkt im HTML (kein XHR nötig).
#  - .progress-box: "470.240 Unterschriften 94 % 500.000 für Sammelziel"
#    → Unterschriften + Sammelziel.
#  - Statusleiste: "Gestartet Januar 2025 …" → Startdatum (Monatsgenau).
#  - .petition-description: Petitionstext; erste Zeile "Petition richtet
#    sich an: <Empfänger>" wird als Adressat extrahiert. Die "Begründung"
#    steht in einem weiteren .unfold-container-text direkt darunter.
#  - Starter*in: "Vielen Dank für Ihre Unterstützung, <Name>".
#  - Kategorie: Link /petitionen?category=<id> auf der Detailseite.
#  - VOLLBESTAND ist groß (~1.600 laufende Petitionen). Der Erst-Backfill
#    dauert entsprechend (Crawl-delay!); Folge-Läufe prüfen erst den Bestand
#    und scrapen dann nur Neues.
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
BASE_URL  = "https://www.openpetition.de"
LIST_URL  = f"{BASE_URL}/petitionen"
DATA_FILE = Path("openpetition_petitions.json")
HTML_FILE = Path("openpetition_petitions.html")

MAX_LIST_PAGES = 200            # Sicherheitslimit für die Paginierung

PETITION_HREF_RE = re.compile(r"/petition/online/([a-z0-9\-]+)")
# Eine Detailadresse hat unterhalb von /petition/online/ noch ein Wegstück.
# Maßstab für core.eigene_adresse.
DETAILADRESSE_RE = re.compile(r"/petition/online/[^/?#]+", re.I)
CATEGORY_RE = re.compile(r"/petitionen\?category=(\d+)")
# "470.240 Unterschriften" bzw. "500.000 für Sammelziel"
SIG_RE  = re.compile(r"([\d.]+)\s*Unterschrift", re.I)
GOAL_RE = re.compile(r"([\d.]+)\s*für Sammelziel", re.I)
STARTED_RE = re.compile(r"Gestartet\s+([A-Za-zäöü]+)\s+(\d{4})")
STARTER_RE = re.compile(r"Vielen Dank für Ihre Unterstützung,\s*(.+?)\s*$")
RECIPIENT_RE = re.compile(r"Petition richtet sich an:\s*(.+)", re.S)

GERMAN_MONTHS = {"januar": 1, "februar": 2, "märz": 3, "april": 4, "mai": 5,
                 "juni": 6, "juli": 7, "august": 8, "september": 9,
                 "oktober": 10, "november": 11, "dezember": 12}

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


# ----------------------------------------------------------------------------
# Entdeckung der Petitionen
# ----------------------------------------------------------------------------
def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: {}} aus der paginierten Gesamtliste. Stoppt, sobald eine Seite
    keine NEUEN Slugs mehr liefert (Seiten dahinter wiederholen Seite 1)."""
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=0, message="Sammle Petitionen …")

    page = 1
    while page <= MAX_LIST_PAGES:
        url = LIST_URL if page == 1 else f"{LIST_URL}?seite={page}"
        resp = fetcher.get(url)
        if resp is None or not resp.ok:
            break
        added = 0
        for m in PETITION_HREF_RE.finditer(resp.text):
            slug = m.group(1)
            if slug not in found:
                found[slug] = {}
                added += 1
        if added == 0:
            break
        prog(current=page, total=0,
             message=f"Listenseite {page} · {len(found)} Petitionen bisher")
        page += 1

    log(f"Liste: {len(found)} Petitionen auf {page - 1} Seiten.")
    # Die Abbruchbedingung oben (added == 0) ist bequem und zugleich die
    # Schwachstelle: liefert die Paginierung nach wenigen Seiten nur noch
    # Wiederholungen, endet der Lauf ORDENTLICH – mit einem Bruchteil des
    # Bestands und ohne Fehler. Das sieht von außen aus wie ein gesunder Lauf.
    # Schwelle gemessen am 8.8.2026: 1.658 Petitionen auf 93 Seiten, also rund
    # 18 je Seite. 100 liegt bei etwa fünf Seiten — ein früher Abbruch fällt
    # damit auf, während der echte Bestand (die größte deutsche Plattform)
    # dieser Schwelle nie auch nur nahe kommt.
    core.entdeckung("Paginierte Gesamtliste", len(found), erwartet_min=100,
                    name_en="paginated full list")
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


def _num(s: str) -> int:
    return int(re.sub(r"\D", "", s) or 0)


# Die Zwischenüberschrift über .petition-reason steht NICHT im Fragment, wir
# setzen sie selbst — sie muss deshalb der Sprache des Textes folgen. Der
# Wortlaut ist nicht erfunden, sondern von der Seite abgelesen: die englische
# Fassung überschreibt den Abschnitt mit „Reason" (8.8.2026 geprüft an
# /petition/online/strengthening-democracy-citizen-veto-right-…).
BEGRUENDUNG_UEBERSCHRIFT = {"de": "Begründung", "en": "Reason"}


def parse_detail(html: str, url: str, lang: str = "de") -> dict:
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}

    h1 = soup.find("h1")
    rec["title"] = (h1.get_text(" ", strip=True) if h1
                    else (_meta(soup, "og:title") or "").removesuffix(
                        " - Online-Petition") or None)
    rec["summary"] = _meta(soup, "og:description")
    rec["image_url"] = _meta(soup, "og:image")
    # Nur eine echte Petitionsseite darf die angefragte Adresse ersetzen —
    # siehe core.eigene_adresse. Dieselbe ungeprüfte Übernahme hat bei WeAct
    # und bei Avaaz je einen Schwung Phantomsätze mit gemeinsamer Adresse
    # erzeugt. OpenPetition antwortet heute sauber mit 404 (8.8.2026
    # gemessen), der Riegel ist hier Vorsorge.
    canon = soup.find("link", rel="canonical")
    rec["url"] = core.eigene_adresse(
        (canon.get("href") if canon else None) or _meta(soup, "og:url"), url,
        DETAILADRESSE_RE)

    # Adressat aus der "richtet sich an:"-Zeile.
    node = soup.find(string=re.compile(r"Petition richtet sich an:"))
    if node:
        host = node.find_parent(["p", "div", "span"])
        m = RECIPIENT_RE.search(host.get_text(" ", strip=True)) if host else None
        if m:
            rec["recipient"] = m.group(1).strip()[:300] or None

    # Petitionstext + Begründung: .petition-description und .petition-reason
    # (mit <h4>Begründung</h4> dazwischen); Adressat-Zeile entfernen.
    parts = []
    desc = soup.select_one(".petition-description")
    if desc:
        for p in desc.find_all("p"):
            if "richtet sich an" in p.get_text():
                p.decompose()
                break
        parts.append(sanitize_fragment(desc, BASE_URL))
    reason = soup.select_one(".petition-reason")
    if reason:
        parts.append("<h3>" + BEGRUENDUNG_UEBERSCHRIFT.get(
            lang, BEGRUENDUNG_UEBERSCHRIFT["de"]) + "</h3>")
        parts.append(sanitize_fragment(reason, BASE_URL))
    rec["description_full"] = "\n".join(p for p in parts if p) or None

    # Starter*in aus der Initiator-Box unter der Überschrift.
    ib = soup.select_one(".initiator-information-box")
    if ib:
        rec["started_by"] = ib.get_text(" ", strip=True)[:200] or None

    # Kategorie über den category-Link der Detailseite.
    cat_link = soup.find("a", href=CATEGORY_RE)
    if cat_link:
        name = cat_link.get_text(" ", strip=True)
        if name:
            rec["category"] = name
            rec["category_url"] = core.urljoin(BASE_URL, cat_link["href"])

    # Unterschriften + Sammelziel aus der Fortschrittsbox.
    box = soup.select_one(".progress-box")
    if box:
        text = box.get_text(" ", strip=True)
        m = SIG_RE.search(text)
        if m:
            rec["signatures"] = _num(m.group(1))
        m = GOAL_RE.search(text)
        if m:
            rec["goal"] = _num(m.group(1))

    # Startdatum (monatsgenau) aus der Statusleiste.
    bar = soup.select_one(".module-petition-status-bar")
    if bar:
        m = STARTED_RE.search(bar.get_text(" ", strip=True))
        if m and m.group(1).lower() in GERMAN_MONTHS:
            rec["start_date"] = (f"{int(m.group(2)):04d}-"
                                 f"{GERMAN_MONTHS[m.group(1).lower()]:02d}-01")
    return rec


# ---------------------------------------------------------------------------
# SPRACHFASSUNGEN
#
# OpenPetition ist von allen elf Plattformen der sauberste Fall: die Seite
# nennt ihre Übersetzungen SELBST, in einem Block „module-petition-translations":
#
#   <h4>Diese Petition wurde in folgende Sprachen übersetzt</h4>
#   <a href="/petition/online/strengthening-democracy-citizen-veto-right-…"
#      title="Petition auf Englisch anzeigen">Englisch</a>
#
# Der Block steht in dem HTML, das dieser Scraper OHNEHIN holt — die Erkennung
# kostet also keinen einzigen Zusatzabruf, nur das Nachladen der Übersetzung
# selbst. Am 8.8.2026 an einer Stichprobe von 40 laufenden Petitionen gemessen:
# 5 mit Übersetzung (~12,5 %), darunter auch Russisch, Türkisch, Arabisch,
# Ukrainisch und Spanisch — nicht nur Englisch.
#
# ⚠️ Die übersetzte Fassung hat einen EIGENEN Slug und ist damit eine eigene
# Adresse. Sie kann deshalb auch eigenständig entdeckt werden und als zweiter
# Satz im Bestand landen; genau dafür trägt der Datensatz `campaign_id` (den
# deutschen Slug), damit publish._uebersetzungen_verknuepfen() die beiden
# hinterher als Übersetzung ausweist statt als „ähnlich".
#
# ⚠️ Ein `?language=en_GB.utf8` bewirkt NICHTS (Antwort byte-identisch); der
# Accept-Language-Kopf schaltet nur die OBERFLÄCHE um, nicht den Petitionstext.
# Der Link im Block ist der einzige Weg.
TRANSLATIONS_BLOCK_RE = re.compile(
    r'module-petition-translations(.{0,1200}?)</(?:div|section)>', re.S | re.I)
TRANSLATION_LINK_RE = re.compile(
    r'<a[^>]+href="(/petition/online/[^"]+)"[^>]*title="[^"]*auf\s+'
    r'([^"]+?)\s+anzeigen"', re.I)
# Sprachname im title-Attribut → Sprachcode. Bewusst nur die, die wir in der
# App auch anzeigen können; alles andere wird erkannt, aber nicht geladen.
SPRACHNAME_ZU_CODE = {"englisch": "en"}


def _uebersetzungen_finden(html: str) -> dict[str, str]:
    """{sprachcode: slug} aus dem Übersetzungsblock der Seite."""
    block = TRANSLATIONS_BLOCK_RE.search(html)
    if not block:
        return {}
    gefunden: dict[str, str] = {}
    for pfad, sprachname in TRANSLATION_LINK_RE.findall(block.group(1)):
        code = SPRACHNAME_ZU_CODE.get(sprachname.strip().lower())
        if not code or code in gefunden:
            continue
        gefunden[code] = pfad.rsplit("/", 1)[-1]
    return gefunden


def _kampagne(slug: str, verlinkt: dict[str, str]) -> str:
    """Kennung, die von JEDER Sprachfassung aus gleich ausfällt.

    ⚠️ Der eigene Slug allein taugt NICHT. Die übersetzte Fassung liegt unter
    einer eigenen Adresse und kann über die Listenseite eigenständig entdeckt
    werden — dann stünden zwei Sätze im Bestand, der deutsche mit
    „openpetition:demokratie-staerken-…", der englische mit
    „openpetition:strengthening-democracy-…". Verschiedene Kennungen, keine
    Verknüpfung: genau die Lücke, die diese Funktion schließt.

    Weil der Block BEIDSEITIG verlinkt (am 8.8.2026 nachgeprüft: die englische
    Seite verweist zurück auf den deutschen Slug), kennt jede Seite dieselbe
    Menge {eigener Slug} ∪ {verlinkte Slugs}. Der alphabetisch kleinste daraus
    ist von beiden Seiten aus derselbe — ohne dass eine Seite wissen müsste,
    welche das Original ist."""
    alle = {slug} | set(verlinkt.values())
    return f"openpetition:{min(alle)}"


def _fremdsprachen_holen(fetcher: core.Fetcher, rec: dict, slug: str,
                         html: str) -> None:
    """Übersetzungen laut Seitenblock nachladen und an `rec` hängen."""
    # Fremdsprachen sind abschaltbar (siehe i18n_helfer) — der
    # Tageslauf verzichtet darauf, ein eigener Lauf holt sie nach.
    if not i18n.aktiv():
        return
    i18n.setze_hauptsprache(rec, "de")
    verlinkt = _uebersetzungen_finden(html)
    rec["campaign_id"] = _kampagne(slug, verlinkt)
    for lang in ("en",):
        fremd_slug = verlinkt.get(lang)
        if not fremd_slug:
            # Der Block ist da oder nicht — fehlt der Sprachlink, hat
            # OpenPetition für diese Petition keine solche Übersetzung. Das ist
            # eine Aussage der Quelle, kein gescheiterter Abruf.
            i18n.setze_sprachfassung(rec, lang, "fehlt")
            continue
        url = f"{BASE_URL}/petition/online/{fremd_slug}"
        resp = fetcher.get(url)
        if resp is None or not resp.ok:
            i18n.setze_sprachfassung(
                rec, lang,
                "fehlt" if resp is not None
                and resp.status_code in (404, 410) else "ungeklärt")
            continue
        fremd = parse_detail(resp.text, url, lang)
        if (fremd.get("title") or "").strip():
            i18n.setze_sprachfassung(rec, lang, "vorhanden", fremd)
        else:
            i18n.setze_sprachfassung(rec, lang, "ungeklärt")


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """(status, record) – status: online | offline | error."""
    url = f"{BASE_URL}/petition/online/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    rec = parse_detail(resp.text, url)
    _fremdsprachen_holen(fetcher, rec, slug, resp.text)
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

    known_slugs = list(store.keys())
    if known_slugs and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known_slugs)} bekannte Petition(en) …")
        prog(phase="check-known", current=0, total=len(known_slugs),
             message="Prüfe bekannte Petitionen …")
        for k, slug in enumerate(known_slugs, 1):
            prog(current=k, total=len(known_slugs), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        f"{BASE_URL}/petition/online/{slug}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")
    elif args.no_recheck:
        log("Prüfung bekannter Petitionen übersprungen (--no-recheck).")

    log("Sammle Petitions-Slugs aus der Gesamtliste …")
    discovered = discover_slugs(fetcher)
    known_set = set(known_slugs)
    new_slugs = [s for s in discovered if s not in known_set]
    if args.limit:
        new_slugs = new_slugs[:args.limit]
    log(f"{len(new_slugs)} neue Petitionen zum Scrapen "
        f"(Gesamt im Store: {len(store)}).")
    prog(phase="scrape", current=0, total=len(new_slugs),
         message="Beginne Scrape …")

    for i, slug in enumerate(new_slugs, 1):
        log(f"({i}/{len(new_slugs)}) {slug}")
        prog(current=i, total=len(new_slugs), message=slug)
        status, rec = scrape_petition(fetcher, slug)
        if status == "error":
            log("  übersprungen (Fehler) – Datensatz bleibt unverändert.")
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts,
                    f"{BASE_URL}/petition/online/{slug}")
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")
    else:
        log("Keine neuen Petitionen seit dem letzten Lauf gefunden.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(PLATFORM)
    log("Fertig (OpenPetition).")


def check(fetcher):
    return core.check_source(fetcher, LIST_URL + "?seite=1", PETITION_HREF_RE, 5,
                             "Petitionen")

PLATFORM = Platform(
    key="openpetition",
    openness=5,
    openness_note="Vorbildlich: vollständige öffentliche Liste (~1.600, paginiert), "
                  "alles server-gerendert (Stand, Ziel, Status, Volltext), "
                  "großzügige robots.txt mit Sitemap.",
    name="OpenPetition",
    eyebrow="OpenPetition · laufende Petitionen (deutsch)",
    source_url="https://www.openpetition.de/petitionen",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
