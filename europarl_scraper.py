#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  europarl_scraper.py  —  Plattform-Modul für EU-Parlament-Petitionen (PETI)
# =============================================================================
#
#  Scrapt die Petitionen des Petitionsportals des Europäischen Parlaments,
#  gefiltert auf Petitionen aus DEUTSCHLAND mit Status "AVAILABLE" (für
#  Unterstützer*innen offen). Nutzt petitions_core.py; Einstieg monitor.py.
#
#  QUELLEN (öffentliches Portal, server-gerendert, keine robots-Sperre):
#    - /petitions/en/show-petitions?countries=DE&statuses=AVAILABLE&page=N
#      (20 pro Seite, page 0-basiert; "results <N>" im HTML)
#    - /petitions/en/petition/content/html?petitionNumber=NNNN%252FYYYY
#      (Achtung: der Schrägstrich der Petitionsnummer ist DOPPELT kodiert)
#
#  BESONDERHEITEN:
#  - signatures bleibt leer. ⚠️ Die frühere Begründung „es gibt KEINE
#    öffentliche Unterstützerzahl" stimmt seit dem 30.8.2026 nicht mehr: das
#    öffentliche PDF (siehe _pdf_url) führt „Number of supporters". Genutzt
#    wird es trotzdem nicht — Nutzerentscheidung, die PDF-Inhalte gelten als
#    nicht verlässlich. Wer das ändert, prüft die Zahl erst gegen die Seite.
#  - Titel-Muster: "Petition No 0232/2026 by T. A. (German) on <Thema>"
#    → daraus werden Petent*in ("T. A. (German)") und Thema extrahiert.
#  - "Topics" der Detailseite wird als Kategorie übernommen.
#  - Startdatum = NUR das Jahr aus der Petitionsnummer ("2026"). Bis zum
#    30.8.2026 stand dort ein erfundener 1. Januar; siehe parse_detail.
#  - Die amtliche PDF-Fassung wird in der Beschreibung VERLINKT (nicht
#    ausgelesen), siehe _pdf_url.
#  - Slug = "NNNN-YYYY" (aus der Petitionsnummer).
# =============================================================================

from __future__ import annotations

import re
from html import unescape as html_unescape
from pathlib import Path

from bs4 import BeautifulSoup

import i18n_helfer as i18nh
import petitions_core as core
from petitions_core import Platform, log, now_iso, prog

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://www.europarl.europa.eu"
DATA_FILE = Path("europarl_petitions.json")
HTML_FILE = Path("europarl_petitions.html")

# Paginierung läuft über ein WACHSENDES pageSize ("Load more"-Button), nicht
# über page=N (das wird ignoriert). Daher direkt mit großem pageSize anfragen
# und bei Bedarf weiter erhöhen.
LIST_URL = (f"{BASE_URL}/petitions/de/show-petitions?keyWords=&_years=1"
            "&_searchThemes=1&_statuses=1&statuses=AVAILABLE&_countries=1"
            "&countries={land}&searchRequest=true&resSize=20&pageSize={size}")
PAGE_SIZE_START = 200
PAGE_SIZE_MAX   = 1000

# ----------------------------------------------------------------------------
# Alle Mitgliedstaaten (Nutzerauftrag 4.9.2026 „alles holen was da ist")
# ----------------------------------------------------------------------------
# Bis dahin stand `countries=DE` fest in der Adresse und die App kannte genau
# ein Land. Jetzt wird JE LAND gesucht.
#
# ⚠️ Warum je Land und nicht einfach ohne Filter: ohne `countries` liefert die
# Suche ≥ 999 Treffer, und `pageSize` ist bei 1000 gedeckelt (PAGE_SIZE_MAX).
# Man erführe also nie, ob noch mehr da ist — die Zahl wäre eine Obergrenze,
# kein Ergebnis. Je Land bleibt jede Antwort weit unter dem Deckel.
#
# Am 4.9.2026 gemessen, mit Kontrolle gegen die dokumentierten Zahlen:
#   DE 91 (deckt sich mit dem 8.8. und 30.8.) · AT 19 (deckt sich mit dem 30.8.)
#   · NL 20 · ES 467 (gemessen am 30.8.)
#
# ⚠️⚠️ ZWEI ÜBERRASCHUNGEN, beide am 4.9.2026 gemessen und beide wichtig:
#
# 1. Die Ergebnismengen ÜBERSCHNEIDEN sich. DE∩AT = 5, DE∩NL = 5, AT∩NL = 3;
#    91+19+20 = 130 Treffer ergeben nur 120 verschiedene Petitionen. Wer die
#    Länderzahlen addiert, zählt doppelt.
#
# 2. `countries=X` ist NICHT das Land der Petition, sondern eine Zuordnung.
#    Beleg: Petition 0020-2022 erscheint unter DE UND AT, ihr Landfeld sagt
#    „Denmark". Gegenprobe an zwei Petitionen, die NUR unter DE erscheinen:
#    beide sagen „Germany". Der bisherige Kommentar bei rec["country"], es
#    stehe „bei JEDER Petition dasselbe, weil die Liste auf countries=DE
#    filtert", war also eine unbelegte Annahme — und die 91 „deutschen"
#    Petitionen waren nie durchweg deutsche.
#
# Folge für den Bau: die Länderschleife ist reine ENTDECKUNG (sie findet mehr
# Petitionen), das LAND kommt weiterhin aus dem Feld der Detailseite. Diese
# Trennung ist der ganze Grund, warum hier nichts geraten werden muss.
#
# ⚠️⚠️ europarl ist aus der CI NICHT scrapebar (AWS-WAF antwortet dort mit
# HTTP 202 auf alles), vom Rechner des Nutzers dagegen mit 200. Diese
# Erweiterung braucht deshalb einen LOKALEN Lauf und den Workflow-Schalter
# `store_aus_repo`. Siehe pm_europarl_waf_gesperrt.
EU_LAENDER = ("DE", "AT", "BE", "BG", "CY", "CZ", "DK", "EE", "ES", "FI",
              "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
              "NL", "PL", "PT", "RO", "SE", "SI", "SK")

NUMBER_HREF_RE = re.compile(r"petitionNumber=(\d{4})%25?2F(\d{4})")

# Erntet JEDE Beschriftung der Feldtabelle ("…|Label|:|Wert|…" im get_text mit
# |-Trenner). Bewusst NICHT an SPRACHE gebunden: gesucht wird das Unbekannte.
FELD_LABEL_RE = re.compile(r"(?:^|\|)([^|]{2,40})\|:\|")

# Alle Beschriftungen, die wir GESEHEN und ENTSCHIEDEN haben — genutzte wie
# verworfene. Was hier fehlt, meldet core.felder_melden() am Laufende als
# „Neues Feld auf der Quellseite".
#
# ⚠️ Abgelesen, nicht ausgedacht: am 30.8.2026 an vier echten Seiten in beiden
# Sprachen geerntet (0474/2026, 1428/2016, 2716/2013). Dabei kam prompt ein
# sechstes Feld zum Vorschein, das vorher niemand kannte — „Name of association"
# / „Name der Vereinigung" steht nur bei Petitionen von Verbänden. Genau dieser
# Fall ist der Grund für den Melder.
#
# ⚠️ Die Liste führt BEIDE Sprachen, weil parse_detail für de und en läuft.
# Verworfen (bewusst, nicht vergessen):
#   · Nummer der Petition — steckt schon im Slug
#   · Kurztitel / Summary title — daraus entsteht bereits der Titel
# ⚠️ 30.8.2026 GEÄNDERT: „Land / Country" stand hier als verworfen, weil es
# konstant „Germany" ist. Es wird jetzt als rec["country"] MITGESCHRIEBEN —
# nicht als Schlagwort (dort verdrängte es nur ein echtes Stichwort), sondern
# als eigenes Feld. Solange countries=DE in LIST_URL steht, ändert das nichts;
# es macht nur die spätere Lockerung des Filters umsonst statt teuer.
#   · Nummer der Petition — steckt schon im Slug
#   · Kurztitel / Summary title — daraus entsteht bereits der Titel
BEKANNTE_FELDER = {
    # deutsch
    "Kurztitel", "Land", "Name", "Name der Vereinigung",
    "Nummer der Petition", "Themenbereiche",
    # englisch
    "Country", "Name of association", "Petition number",
    "Summary title", "Topics",
}

# ---------------------------------------------------------------------------
# SPRACHFASSUNGEN
#
# Das EU-Parlament veröffentlicht jede Petition in allen 24 Amtssprachen; die
# Adresse unterscheidet sich nur im Sprachsegment. Bis zum 8.8.2026 holte
# dieser Scraper ausschließlich /en/ – deshalb standen ALLE Petitionen auch
# deutschen Nutzern englisch in der App. Das war kein Merkmal der Quelle,
# sondern unsere eigene Festlegung an zwei Stellen.
#
# Jetzt ist Deutsch die Hauptsprache (flache Felder) und Englisch wandert nach
# rec["i18n"]["en"]. Am 8.8.2026 an ALLEN 91 gelisteten Petitionen gemessen,
# nicht an einer Stichprobe:
#   · /petitions/de/show-petitions und /petitions/en/… liefern dieselbe MENGE
#     Petitionsnummern (91 = 91, Mengenvergleich) – die Sprache der Liste ist
#     also belanglos, sie steht hier nur der Einheitlichkeit halber auf de
#   · die Feldtabelle trägt "Themenbereiche" und "Name" bei 91 von 91
#   · das Titelmuster unten erkennt 85 von 85 vorhandenen Titeln
#   · 6 Seiten tragen GAR KEINEN Titelabschnitt – auf Deutsch wie auf Englisch
#     gleichermaßen. Das ist keine Übersetzungslücke, sondern ein anderer
#     Seitentyp; für sie greift der Rückfall in parse_detail wie bisher.
#
# ⚠️ Der deutsche Titel ist ANDERS gebaut als der englische, und zwar
# unregelmäßiger. Englisch: "Petition No N/J by X (German) on Y" – die
# Staatsangehörigkeit steht in Klammern, das Bindewort ist immer "on".
# Deutsch: "Petition Nr. N/J, eingereicht von X, deutscher
# Staatsangehörigkeit[, im Namen der Z], zu Y". Aus sechs Stichproben hätte man
# ein Muster abgeleitet, das an zwölf Petitionen scheitert. Erst der Lauf über
# alle 91 zeigte vier weitere Formen:
#   · "0174/2014 ," – Leerzeichen VOR dem Komma
#   · "1386/2024 eingereicht" – gar kein Komma
#   · "über das Fischsterben", "betreffend Botulismus" – das Bindewort ist
#     nicht immer "zu/zur/zum"
#   · "im Namen des Bundesverbandes … e. V. zur Umsetzung" – vor dem Bindewort
#     steht kein Komma
# Deshalb: Komma überall optional, fünf Bindewörter. Und weil die nächste
# Petition eine sechste Form mitbringen kann, FÄLLT parse_detail bei einem
# Fehlschlag auf den vollen Titelsatz zurück statt ihn wegzuwerfen.
# ⚠️ 11.8.2026 zurück auf "en" (Nutzerentscheidung). Am 8.8. war auf "de"
# umgestellt worden, weil das EU-Parlament in allen 24 Amtssprachen
# veröffentlicht und der deutsche Abruf echtes Deutsch liefert. Fachlich
# stimmte das; für die App war es die falsche Einordnung: Europarl ist dort
# die einzige nicht-deutschsprachige Plattform, und mit "de" gab es im
# Einrichtungs-Assistenten überhaupt keine englische Auswahl mehr — der
# Schritt „In welchen Sprachen suchst du?" zeigte einen einzigen Chip.
# Deutsch geht dabei NICHT verloren: es wandert nach rec["i18n"]["de"],
# denselben Weg, den vorher Englisch genommen hat. Die Schleife unten
# überspringt nur die Hauptsprache, sie ist richtungsblind.
# ⚠️ LIST_URL bleibt auf /de/ — die Entdeckung liefert in beiden Sprachen
# dieselbe MENGE (oben belegt), und der Filter ist ein LÄNDER-Filter
# (countries=DE), kein Sprachfilter.
HAUPTSPRACHE = "en"
SPRACHEN = ("de", "en")

SPRACHE = {
    "de": {
        "titel_marker": "Petition Nr",
        "titel_re": re.compile(
            r"Petition Nr\.\s*(\d{4}/\d{4})\s*,?\s*eingereicht von\s+(.+?)"
            r"(?:,\s*|\s+)((?:zur?m?|über|betreffend)\s+.+)", re.S),
        "themen": "Themenbereiche",
        "land": "Land",
        "summary_h": "Zusammenfassung der Petition",
        "empfaenger": "Petitionsausschuss des Europäischen Parlaments (PETI)",
    },
    "en": {
        "titel_marker": "Petition No",
        # ⚠️ Das "(?!behalf\b)" behebt einen Fehler, den es seit dem ersten Lauf
        # gibt und der erst beim Sprachvergleich am 8.8.2026 auffiel: reicht
        # jemand "on behalf of <Verein>" ein, trennte das Muster am ERSTEN
        # " on " – also mitten in der Einreicherangabe. In der App stand dann
        # als Titel "Petition 0855/2016: behalf of the Interessensgemeinschaft
        # Botulismus …" statt des eigentlichen Gegenstands. An allen 91
        # gelisteten Petitionen nachgezählt: 10 von 78 englischen Titeln
        # betroffen, alle 10 durch diesen Ausschluss geheilt.
        # Das optionale Komma und "calling for" fangen zwei weitere Formen, die
        # das alte Muster gar nicht erkannte ("Petition No 1969/2014, by …",
        # "… (German) calling for a legal regulation …"). Sie fielen bisher auf
        # den nackten "Petition 1969/2014" zurück und verloren den Titel ganz.
        "titel_re": re.compile(
            r"Petition No\s+(\d{4}/\d{4})\s*,?\s*by\s+(.+?)\s+"
            r"(?:on(?!\s+behalf\b)|calling for)\s+(.+)", re.S),
        "themen": "Topics",
        "land": "Country",
        "summary_h": "Petition Summary",
        "empfaenger": "Committee on Petitions of the European Parliament (PETI)",
    },
}

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
}


def _detail_url(slug: str, lang: str = HAUPTSPRACHE) -> str:
    num, year = slug.split("-")
    return (f"{BASE_URL}/petitions/{lang}/petition/content/html?"
            f"petitionNumber={num}%252F{year}")


def _pdf_url(slug: str, lang: str = HAUPTSPRACHE) -> str:
    """Adresse der amtlichen PDF-Fassung — dieselbe Nummer, anderer Endpunkt.

    Das PDF ist OHNE Login abrufbar (30.8.2026 an sechs Jahrgängen geprüft,
    6 von 6 mit HTTP 200) und trägt die Petition als einseitiges Dokument.

    ⚠️ Es wird bewusst NUR VERLINKT, nicht ausgelesen. Sein Feld „Creation
    date" sähe wie ein besseres Startdatum aus — der Nutzer hat am 30.8.2026
    entschieden, dass die PDF-Inhalte nicht stimmen. Die Zuordnung stimmt
    dagegen nachweislich (6 von 6 PDFs meldeten die angeforderte Nummer), der
    Link führt also nicht in die Irre.

    ⚠️ Die doppelte Kodierung `%252F` ist kein Versehen: die Quelle erwartet
    den Schrägstrich der Petitionsnummer zweifach kodiert, genau wie in
    _detail_url."""
    num, year = slug.split("-")
    return (f"{BASE_URL}/petitions/{lang}/petition/content/pdf?"
            f"petitionNumber={num}%252F{year}")


# ----------------------------------------------------------------------------
# Entdeckung
# ----------------------------------------------------------------------------
def _suche_land(fetcher: core.Fetcher, land: str,
                found: dict[str, dict]) -> int:
    """Eine Länder-Suche; ergänzt `found` und gibt die Zahl der Treffer zurück.
    pageSize wird erhöht, bis keine neuen Treffer mehr kommen."""
    vorher = len(found)
    size = PAGE_SIZE_START
    while size <= PAGE_SIZE_MAX:
        resp = fetcher.get(LIST_URL.format(land=land, size=size))
        if resp is None or not resp.ok:
            break
        added = treffer = 0
        for m in NUMBER_HREF_RE.finditer(resp.text):
            treffer += 1
            slug = f"{m.group(1)}-{m.group(2)}"
            if slug not in found:
                found[slug] = {}
                added += 1
        # ⚠️ Abbruch am TREFFER dieser Seite, nicht an len(found): letzteres
        # zählt über alle Länder mit und stünde nach ein paar Ländern immer
        # über `size` — die Schleife liefe dann für jedes Land bis zum Deckel.
        if added == 0 or treffer < size:
            break                        # alle Ergebnisse dieses Landes erfasst
        size *= 2
    return len(found) - vorher


def discover_slugs(fetcher: core.Fetcher) -> dict[str, dict]:
    """{slug: {}} über ALLE Mitgliedstaaten (Status AVAILABLE).

    ⚠️ Je Land eine eigene Suche — Begründung bei EU_LAENDER: ohne Länderfilter
    deckelt pageSize bei 1000 und man erführe nie, ob mehr da ist."""
    found: dict[str, dict] = {}
    prog(phase="discover", current=0, total=len(EU_LAENDER),
         message="Sammle Petitionen …")
    je_land: dict[str, int] = {}
    for i, land in enumerate(EU_LAENDER, 1):
        je_land[land] = _suche_land(fetcher, land, found)
        prog(current=i, total=len(EU_LAENDER),
             message=f"{land} · {len(found)} Petitionen bisher")
    # Die Aufschlüsselung gehört ins Protokoll: ein Land, das plötzlich 0
    # liefert, ist in einer Gesamtzahl nicht zu sehen.
    log("Suche je Land: " + " ".join(f"{k}·{v}" for k, v in je_land.items() if v))
    leer = [k for k, v in je_land.items() if not v]
    if leer:
        log(f"  ohne Treffer: {', '.join(leer)}")
    log(f"Suche: {len(found)} Petitionen aus {len(EU_LAENDER)} Ländern "
        f"(AVAILABLE).")
    # Diese Suche ist die einzige Entdeckung – es gibt keinen zweiten Zweig,
    # der ihren Ausfall auffangen und damit verdecken würde. Heikel ist dabei
    # die Abbruchbedingung oben: greift NUMBER_HREF_RE nach einem Umbau der
    # Trefferliste nicht mehr, ist added == 0, die Schleife endet ORDENTLICH,
    # und der Lauf meldet keinen Fehler – er findet nur nichts.
    # Schwelle: bis 4.9.2026 stand hier 10, gemessen an den 91 deutschen
    # Petitionen. Mit 27 Ländern ist der Sockel deutlich höher — allein DE 91,
    # AT 19, NL 20, ES 467 (gemessen). 50 liegt weit unter jeder plausiblen
    # Summe und meldet trotzdem, wenn die Suche reihenweise ausfällt.
    # ⚠️ Eine Gesamtzahl verdeckt den Ausfall EINZELNER Länder; die stehen
    # deshalb oben im Protokoll, Land für Land.
    core.entdeckung("Länder-Suche (Status AVAILABLE)", len(found),
                    erwartet_min=50,
                    name_en="per-country search (status AVAILABLE)")
    return found


# ----------------------------------------------------------------------------
# Detailseite parsen
# ----------------------------------------------------------------------------
def parse_detail(html: str, url: str, slug: str,
                 lang: str = HAUPTSPRACHE) -> dict:
    """Die Detailseite hat kaum nutzbare CSS-Klassen; geparst wird über die
    Text-Segmente (get_text mit |-Trenner). Der Titel ist das erste Segment
    "Petition Nr. …" bzw. "Petition No …"; die Zusammenfassung folgt auf das
    ZWEITE Vorkommen der Überschrift "Zusammenfassung der Petition" /
    "Petition Summary" (das erste gehört zur Kopf-Wiederholung).

    `lang` wählt die Beschriftungen aus SPRACHE – die Seitenstruktur ist in
    allen Amtssprachen dieselbe, nur die Wörter wechseln."""
    L = SPRACHE[lang]
    soup = BeautifulSoup(html, "html.parser")
    rec: dict = {}
    text = soup.get_text("|", strip=True)
    segs = [s.strip() for s in text.split("|") if s.strip()]

    title_seg = next((s for s in segs
                      if s.startswith(L["titel_marker"])), None)
    m = L["titel_re"].match(title_seg) if title_seg else None
    if m:
        rec["title"] = f"Petition {m.group(1)}: {m.group(3).strip()[:250]}"
        rec["started_by"] = m.group(2).strip()[:200]
    elif title_seg:
        # Muster griff nicht, aber ein Titelsatz IST da: lieber den ganzen,
        # etwas behördlichen Satz zeigen als ihn gegen "Petition 0855/2016"
        # einzutauschen. Eine neue Formulierung der Quelle kostet dann Schönheit,
        # nicht Inhalt.
        rec["title"] = title_seg.strip()[:280]
    else:
        rec["title"] = f"Petition {slug.replace('-', '/')}"

    # Feld-Paare ("Themenbereiche|:|Wert") aus dem Fließtext ziehen.
    # Diese Tabelle ist der VERLÄSSLICHE Teil der Seite: am 8.8.2026 trugen
    # 91 von 91 Petitionen sowohl "Themenbereiche" als auch "Name" – anders
    # als der Titelsatz, dessen Formulierung schwankt.
    def field(label: str) -> str | None:
        m2 = re.search(rf"{re.escape(label)}\|:\|+([^|]+)", text)
        return m2.group(1).strip() if m2 else None

    # Dieselbe Tabelle einmal VOLLSTÄNDIG ernten, nicht nur die zwei Felder, die
    # wir lesen. Kostet keinen Zusatzabruf und ist die Grundlage für den Melder
    # „Neues Feld auf der Quellseite" (core.felder_melden am Laufende).
    # ⚠️ Die Ernte darf NICHT von SPRACHE abhängen: sonst fände sie nur, wonach
    # ohnehin schon gesucht wird — und ein neues Feld ist per Definition eines,
    # nach dem niemand sucht.
    core.felder_gesehen(m3.group(1).strip()
                        for m3 in FELD_LABEL_RE.finditer(text))

    rec["category"] = field(L["themen"])
    # ✅ 4.9.2026: Der Filter IST gelockert (Suche je Land, siehe EU_LAENDER) —
    # hier steht jetzt wirklich das Land der Petition, nicht mehr bei jeder
    # dasselbe. Genau dafür wurde der Wert am 30.8. vorsorglich mitgeschrieben,
    # als die Trefferliste noch auf countries=DE stand.
    # ⚠️ Bewusst der WORTLAUT der Seite, kein ISO-Kürzel: die Quelle nennt
    # „Deutschland"/„Germany", je nach Sprachfassung. Daraus ein „DE“ zu machen
    # wäre eine Zuordnung, die niemand geprüft hat.
    rec["country"] = field(L["land"])
    status_seg = next((s for s in segs if s.startswith("Status:")), "")
    status_txt = status_seg.removeprefix("Status:").strip()

    # Zusammenfassung. Die Überschrift "Petition Summary" steht MEHRFACH auf der
    # Seite: einmal im Sprungmenü am Kopf, einmal über dem eigentlichen Text.
    # Auf das erste Vorkommen folgt der Titel der Petition ("Petition No …"),
    # und der ist mit über 120 Zeichen lang genug, um die frühere Suche schon
    # dort zu beenden — gespeichert wurde dann der Titel statt der
    # Zusammenfassung. Nachgewiesen am 3.8.26 an 0474/2026: in der App stand
    # als Kurzbeschreibung wörtlich die Überschrift.
    # Jetzt werden ALLE Vorkommen eingesammelt, Titelwiederholungen verworfen
    # und der längste Rest genommen; die eigentliche Zusammenfassung ist auf
    # dieser Seite immer der längste Textblock.
    kandidaten: list[str] = []
    for i, s in enumerate(segs):
        if s != L["summary_h"]:
            continue
        for t in segs[i + 1:i + 5]:
            if len(t) > 120 and not t.startswith(L["titel_marker"]):
                kandidaten.append(t)
    summary = max(kandidaten, key=len) if kandidaten else None
    # Der Text ist auf der Seite DOPPELT maskiert ("&amp;#39;" im Quelltext).
    # get_text() löst eine Stufe auf, übrig bleibt sichtbares "&#39;" mitten im
    # Satz. Die zweite Stufe deshalb hier.
    if summary and "&" in summary:
        summary = html_unescape(summary)
    if summary:
        rec["description_full"] = f"<p>{core._esc(summary)}</p>"
        rec["summary"] = (summary[:200] + "…") if len(summary) > 200 else summary

    # Amtliche PDF-Fassung verlinken (Nutzerwunsch 30.8.2026). Sie enthält den
    # Wortlaut als Dokument und ist ohne Login abrufbar.
    #
    # ⚠️ Der Link hängt AUSSERHALB des `if summary`-Zweigs: er steht auch dann
    # zu, wenn die Zusammenfassung fehlt — gerade dann ist er am nützlichsten,
    # weil die Beschreibung sonst leer bliebe.
    # ⚠️ Adresse selbst gebaut, nicht von der Seite übernommen: dann kann keine
    # fremde Adresse aus fremdem Inhalt hier landen (dieselbe Vorsorge wie
    # core.eigene_adresse). `_esc` bleibt trotzdem drum herum — die Adresse
    # geht in ein Attribut, und `&` darin muss maskiert sein, sonst zerfällt
    # das HTML still.
    # ⚠️ rel="noopener" gehört dazu, target="_blank" öffnet sonst ein Fenster
    # mit Zugriff auf window.opener. sanitize_fragment setzt für fremde Texte
    # dasselbe Paar; hier bauen wir den Link selbst, also auch die Absicherung.
    # ⚠️⚠️ Die Beschriftung ist ABSICHTLICH so knapp — „PDF" plus Nummer.
    # core.make_tags() leitet die Schlagwörter aus title + summary +
    # description_full ab, dieser Linktext landet also mit darin. Eine schöne
    # Beschriftung erzeugt prompt Müll-Schlagwörter: am echten Bestand gemessen
    # hätte „Official version of this petition as PDF" bei 17 von 98 Sätzen
    # „Official" und „Version" als Schlagwort erzeugt, „Amtliche Fassung …"
    # entsprechend „Amtliche", „Original-PDF" sogar sich selbst.
    # Mit „PDF 0474/2026" sind es 0: „PDF" bleibt unter der Mindestlänge von
    # vier Zeichen, die Zahlen fallen als Ziffernfolgen heraus.
    # ➡️ Wer das hier hübscher formulieren will, misst vorher make_tags() gegen
    # den echten Bestand — sonst stehen die neuen Wörter danach in der
    # Schlagwortwolke und sind über die Filter anklickbar.
    num, jahr = slug.split("-")
    pdf = core._esc(_pdf_url(slug, lang))
    rec["description_full"] = (rec.get("description_full") or "") + (
        f'<p><a href="{pdf}" target="_blank" rel="noopener">'
        f'PDF {core._esc(num)}/{core._esc(jahr)}</a></p>')

    rec["recipient"] = L["empfaenger"]
    # Gemeinsame Kennung aller Sprachfassungen: die Petitionsnummer. Sie ist
    # in jeder der 24 Amtssprachen dieselbe. Gebraucht wird sie nur, falls je
    # zwei Sprachfassungen als GETRENNTE Sätze in den Bestand geraten — der
    # Regelfall ist, dass scrape_petition beide in einen Satz legt.
    rec["campaign_id"] = f"europarl:{slug}"
    # Startdatum: NUR das Jahr. Mehr gibt die Quelle an dieser Stelle nicht her —
    # die Zahl stammt aus der Petitionsnummer (0474/2026), nicht von der Seite.
    #
    # ⚠️⚠️ Bis zum 30.8.2026 stand hier f"{year}-01-01" und behauptete damit den
    # 1. Januar. Das ist kein Rundungsfehler, sondern eine Tatsachenbehauptung:
    # die App zeigt den Wert tagesgenau an, und gemessen an sechs Jahrgängen lag
    # er um +1 bis +345 Tage daneben. Ein fehlender Monat ist sichtbar, ein
    # erfundener nicht — dieselbe Entscheidung wie bei der Jahresform von
    # openPetition (siehe openpetition_scraper._startdatum).
    #
    # ⚠️ Folgen, vor der Umstellung gemessen und bewusst so gewollt:
    #   · `date.fromisoformat("2026")` wirft ValueError → Prüfung (e) in
    #     petitions_core setzt alter=None und überspringt europarl still. Das
    #     ist hier richtig: ein Jahreswert kann per Bauart nie „frisch" sein und
    #     hätte den Melder sonst neun von zwölf Monaten blinken lassen.
    #   · Der Stringvergleich trägt weiter ("2026" > "2025-12-31"), Sortierung
    #     und der Frische-Vergleich der App bleiben also heil.
    #   · fmtDate() in der App musste mitwachsen, sonst zeigte sie GAR NICHTS
    #     statt "2026" (der Regex verlangte YYYY-MM-DD).
    if re.fullmatch(r"\d{4}", year := slug.split("-")[1]):
        rec["start_date"] = year
    rec["url"] = url
    rec["kind"] = "petition"
    if status_txt:
        rec["updates"] = [{"timestamp": now_iso()[:19],
                           "text": f"Status: {status_txt}"}]
    return rec


# Welche Felder eine Fremdsprache mitbringt.
#
# ⚠️⚠️ "category" gehört NICHT dazu, und der Versuch ist am 8.8.2026 GEMESSEN
# gescheitert — nicht vermutet. Er sah zunächst gut aus: die Quelle liefert das
# Feld in beiden Sprachen, wir holen die englische Seite ohnehin, und in
# app.js sind Anzeige und Filter getrennt (der Klick übergibt den Rohwert).
# Nur stimmt die Zuordnung nicht:
#
#   Das Feld ist MEHRWERTIG. Petition 2517/2025 trägt fünf Themenbereiche, und
#   parse_detail nimmt je Sprache den ERSTEN. Die Reihenfolge ist aber je
#   Sprache eine andere — an fünf Petitionen nachgezählt, alle mit gleich
#   langen Listen und durchweg abweichender Ordnung:
#
#     DE 0: Grundrechte                    EN 0: Equal Opportunities and Gender
#     DE 1: Persönliche Angelegenheiten    EN 1: Personal Matter
#     DE 2: Justiz                         EN 2: Fundamental Rights
#
#   Gepaart würde also "Grundrechte" mit "Equal Opportunities and Gender" —
#   eine falsche Übersetzung, und die ist schlechter als gar keine. Ein
#   gemeinsamer Schlüssel (Themen-ID) steht auf der Seite nicht; über die
#   Position lässt sich nichts retten.
#
# ⬜ NEBENBEFUND, ÄLTER ALS DIESE SITZUNG: dass nur der erste von bis zu fünf
# Themenbereichen gespeichert wird, ist auch einsprachig eine willkürliche
# Auswahl. Wer das angeht, muss `category` zu einer Liste machen — das berührt
# Filter, Zählung und Verwandtschaftsrechnung und ist eine eigene Aufgabe.
I18N_FELDER = ("title", "summary", "description_full", "url")


def _hole_sprache(fetcher: core.Fetcher, slug: str, lang: str):
    """Eine Sprachfassung abrufen. Gibt (zustand, rec) zurück, wobei zustand
    aus "vorhanden" | "fehlt" | "ungeklärt" | "offline" | "error" stammt.

    ⚠️ Die Unterscheidung zwischen "fehlt" und "ungeklärt" ist nicht Kosmetik:
    die App zeigt zu einer fehlenden deutschen Fassung ein Abzeichen mit dem
    Satz, die Petition liege dort nicht vor. Steht dahinter in Wahrheit ein
    gescheiterter Abruf, behauptet die Oberfläche etwas Falsches. Ein leeres
    Feld ist KEIN Beleg für ein fehlendes Original – bei WeMove stammen die
    leeren Titel nachweislich vom Bot-Checkpoint, während die deutsche Seite
    einen guten Titel trägt."""
    url = _detail_url(slug, lang)
    resp = fetcher.get(url)
    if resp is None:
        return "ungeklärt", None
    if resp.status_code in (404, 410):
        return "fehlt", None
    if not resp.ok:
        return "ungeklärt", None
    # Ein 200 OHNE Petitionsinhalt ist kein Beleg für "verschwunden": das
    # Portal liefert bei Störungen/Sperren ebenfalls 200 mit Fehlerseite.
    # Solche Antworten daher als ungeklärt behandeln (Datensatz unverändert),
    # NICHT als offline – sonst kippt ein Ausfall den ganzen Bestand.
    if SPRACHE[lang]["titel_marker"] not in resp.text:
        return "ungeklärt", None
    return "vorhanden", parse_detail(resp.text, url, slug, lang)


def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    """Hauptsprache holen, danach die übrigen Sprachen nach rec["i18n"].

    Die Hauptsprache entscheidet über den Datensatz: fehlt sie, gibt es nichts
    auszuliefern. Eine fehlgeschlagene Fremdsprache kostet dagegen nur die
    Übersetzung, nie den Satz."""
    zustand, rec = _hole_sprache(fetcher, slug, HAUPTSPRACHE)
    if zustand == "fehlt":
        return "offline", None
    if zustand != "vorhanden":
        log(f"  unerwartete Antwort für {slug} (kein Petitionstext) – "
            "als Fehler gewertet, Datensatz bleibt unverändert.")
        return "error", None

    rec["lang"] = HAUPTSPRACHE
    # ⚠️ Der Schalter betrifft NUR die Fremdsprachen. Die Hauptsprache ist oben
    # schon geholt – ohne sie gäbe es gar keinen Datensatz.
    if not i18nh.aktiv():
        return "online", rec
    i18n: dict[str, dict] = {}
    i18n_state: dict[str, str] = {}
    for lang in SPRACHEN:
        if lang == HAUPTSPRACHE:
            continue
        st, fremd = _hole_sprache(fetcher, slug, lang)
        i18n_state[lang] = st
        if fremd:
            block = {k: fremd[k] for k in I18N_FELDER if fremd.get(k)}
            if block:
                i18n[lang] = block
    if i18n:
        rec["i18n"] = i18n
    if i18n_state:
        rec["i18n_state"] = i18n_state
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

    known = list(store.keys())
    if known and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(known)} bekannte Petition(en) …")
        prog(phase="check-known", current=0, total=len(known),
             message="Prüfe bekannte Petitionen …")
        for k, slug in enumerate(known, 1):
            prog(current=k, total=len(known), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            core.upsert(store, slug, rec or {}, {}, status, ts,
                        _detail_url(slug))
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")

    log("Sammle deutsche Petitionen (Status AVAILABLE) …")
    discovered = discover_slugs(fetcher)
    # Überlebt jeden Abbruch: save_store schreibt _TLS.lauf_meta bei jeder
    # Zwischenspeicherung mit (24.8.2026); der Abschluss-Save gewinnt.
    core.lauf_meta_setzen(available=len(discovered))
    new_slugs = [s for s in discovered if s not in store]
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
            continue
        core.upsert(store, slug, rec or {}, {}, status, ts, _detail_url(slug))
        save()

    # Einmal je Lauf, nicht je Petition: sonst stünde derselbe Fund 91-mal am
    # Lauf. Steht VOR dem Abschluss-Save, damit der Befund noch ins _meta und
    # damit ins Dashboard wandert.
    core.felder_melden(BEKANNTE_FELDER)

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(PLATFORM)
    log("Fertig (Europäisches Parlament).")


def check(fetcher):
    # ⚠️ Die Erreichbarkeitsprüfung bleibt bewusst auf DEUTSCHLAND: sie soll
    # billig sein (eine Anfrage) und eine bekannte Sollzahl haben. Seit dem
    # 8.8.2026 sind das 91 Petitionen, die Schwelle 10 liegt weit darunter.
    # Über alle 27 Länder zu prüfen kostete 27 Anfragen für dieselbe Aussage.
    return core.check_source(fetcher, LIST_URL.format(land="DE", size=20),
                             NUMBER_HREF_RE, 10, "DE-Petitionen")

PLATFORM = Platform(
    key="europarl",
    # Land steht je Petition in rec["country"], als WORTLAUT der Seite
    # („Deutschland"/„Germany"); core.land_code() vereinheitlicht das beim
    # Veröffentlichen. Heute liefert die Trefferliste nur DE (countries=DE im
    # LIST_URL) — dahinter liegen 27 Mitgliedstaaten, gemessen AT 19, ES 467.
    country_scope="mehrere",
    # 8.8.2026 auf "de", 11.8.2026 zurück auf "en" — Begründung bei
    # HAUPTSPRACHE oben. Kurz: fachlich waren beide Werte vertretbar (das
    # EU-Parlament veröffentlicht in allen 24 Amtssprachen), für die App ist
    # "en" der richtige, weil die Sprache dort eine Auswahldimension ist und
    # Europarl die einzige nicht-deutschsprachige Plattform stellt.
    # ⚠️ Dieser Wert MUSS zu HAUPTSPRACHE passen: er landet als "language" im
    # Manifest, und die App richtet Kachelgruppen, Flagge und die Sprachwahl
    # im Einrichtungs-Assistenten danach aus. Ein Auseinanderlaufen führt zu
    # einer Plattform, die als deutsch beschriftet ist und Englisch anzeigt —
    # genau der Zustand, der live vom 8. bis 11.8.2026 sichtbar war.
    language=HAUPTSPRACHE,
    openness=4,
    openness_wunsch="Die Suche ist server-gerendert und frei zugänglich. Aus "
                    "Rechenzentren heraus antwortet der Host allerdings mit HTTP 202 "
                    "(AWS-WAF) statt mit Inhalt, von gewöhnlichen Anschlüssen aus "
                    "nicht — eine Ausnahme für Lesezugriffe würde reichen. Dazu fehlt "
                    "eine öffentliche Unterstützerzahl, und das Startdatum liegt nur "
                    "jahresgenau vor.",
    openness_note="Offen: offizielle Suche mit Länder-/Statusfilter, server-"
                  "gerendert; Eigenheiten (Load-more-Paginierung, doppelt kodierte "
                  "URLs) und keine öffentliche Unterstützerzahl.",
    name="Europäisches Parlament",
    eyebrow="EU-Parlament (PETI) · Petitionen aus Deutschland, offen zur Unterstützung",
    source_url=f"https://www.europarl.europa.eu/petitions/{HAUPTSPRACHE}/home",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
