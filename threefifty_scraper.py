#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  threefifty_scraper.py  —  Plattform-Modul für 350.org (deutsch)
# =============================================================================
#
#  Scrapt die deutschen Klima-Aktionen von 350.org – standardmäßig Region
#  EUROPA + Sprache DEUTSCH. Nutzt petitions_core.py; Einstieg monitor.py.
#
#  ENTDECKUNG (im Seiten-JS von /de/mitmachen/ gefunden):
#    350.org/de/mitmachen/ hat KEINE serverseitige Aktionsliste – die Karten
#    lädt eine externe JSON-API:
#      GET https://getinvolved350.vercel.app/?region=<Region>&time_filter=<Stufe>
#          &lang_code=Language: German
#      → { "<page_id>": {url,title,description,button_cta,image}, … }
#    Zeitstufen: "Get involved page: low|medium|high bar" (alle drei = Vollset).
#
#  DETAIL/ZÄHLER:
#    Jede Aktion zeigt auf act.350.org/cms/view_by_page_id/<id>, das auf die
#    eigentliche Seite weiterleitet. Der Unterschriftenstand kommt über
#    act.350.org/progress/<slug> (JSONP onProgressLoaded → total.actions +
#    goal) – identisch zu WeMove.
#
#  ZIELFORMEN (am 2026-08-08 an ALLEN 26 Aktionen einzeln aufgelöst):
#    19 × /sign/, 5 × /letter/, 1 × /signup/, 1 × /survey/ – und KEIN EINZIGES
#    /act/ mehr. Das Muster kannte bis dahin nur (sign|act), also genau eine
#    ausgestorbene Form und eine der vier lebenden: die anderen sieben fielen
#    durch, bekamen nie einen Slug und damit nie eine Unterschriftenzahl
#    (gemessen bis 20.711) und keinen Volltext. TARGET_RE ist deshalb jetzt
#    offen – siehe dort, warum ein geschlossenes Muster hier der falsche Weg
#    ist. Der /progress/-Zähler funktioniert für alle vier Formen (nachgemessen,
#    auch /survey/ und /signup/ liefern total.actions).
#
#  TEXTE (seit 2026-07-29, Formen ergänzt 2026-08-08):
#    Das Feld "description" der API ist bei einem Teil der Aktionen LEER (am
#    2026-07-29: 6 von 20 im Feed), und wo es gefüllt ist, steht darin nur ein
#    Anreißer von ~250 Zeichen. Der eigentliche Text steht auf der Aktionsseite,
#    je nach Form woanders:
#      /sign/    #action-description-text → Einleitung ("Beschreibung"),
#                #petition-text           → ganzer Aufruf (auf der Seite hinter
#                                           „Den ganzen Text des Aufrufs lesen")
#      /letter/  #action-description      → Einleitung,
#                textarea#letter-content  → der Brief-/Mailtext selbst. ⚠️ Das
#                                           ist KLARTEXT mit echten Umbrüchen,
#                                           kein HTML (siehe _brieftext_html).
#      /signup/  #action-description      → nur die Einleitung, kein Aufruftext
#      /survey/  nichts davon – dort steht nur das Formular. Kein Fehler.
#    ⚠️ #action-description ist auf /sign/-Seiten die KLAMMER um Einleitung UND
#    Aufruf (gemessen 4.204 gegen 522 Zeichen) und taugt dort NICHT als
#    Einleitung – fetch_detail prüft das ausdrücklich.
#
#  ROBOTS (act.350.org: Disallow /act/, /login/, /share/, /cms/unsubscribe;
#  sonst "Allow: /"):
#    /sign/, /letter/, /signup/, /survey/, /progress/ und /cms/view_by_page_id
#    sind damit erlaubt, /act/ nicht. Am 2026-08-08 gegen die echte robots.txt
#    geprüft, bevor die neuen Formen überhaupt angefasst wurden.
#    Welche Form vorliegt, verrät die Weiterleitung, BEVOR etwas geladen wird:
#    resolve_target liest nur den "Location"-Header. Eine /act/-Adresse fasst
#    der Scraper nie an (ROBOTS_GESPERRT, dazu die Prüfung in fetcher.get).
#    Der Zähler läuft über den separat erlaubten /progress/-Endpunkt – deshalb
#    braucht auch eine gesperrte Form ihren Slug.
#    getinvolved350.vercel.app hat keine robots-Einschränkung.
#
#  FORMAT-KENNZEICHNUNG:
#    350.org-Aktionen sind teils Petitionen, teils Brief-/E-Mail-Aktionen,
#    Anmeldungen oder Umfragen. Das Format wird als Kategorie gesetzt → der
#    Kategorie-Filter der App wirkt als Format-Umschalter. ⚠️ 350.org ist die
#    einzige Plattform, die dieses Feld so benutzt; überall sonst stehen dort
#    Sachthemen (Umwelt, Gesundheit …).
#    Maßgeblich ist die FORM der Zielseite (FORMAT_JE_FORM), nicht mehr der
#    Knopftext: am 2026-08-08 an allen 26 Aktionen gegengerechnet lag die
#    Schätzung aus dem Knopf bei 8 daneben (31 %) – „Submit"/„Take Action"
#    machten aus fünf Petitionen bloße „Aktionen", „Absenden" aus der Umfrage
#    eine E-Mail-Aktion. classify() bleibt als Rückfallebene für den Fall, dass
#    der Bot-Schutz die Weiterleitung gerade nicht preisgibt.
# =============================================================================

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlencode, urljoin

import requests
from bs4 import BeautifulSoup

import i18n_helfer as i18n
import petitions_core as core
from petitions_core import Platform, log, now_iso, prog

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://act.350.org"
API_URL   = "https://getinvolved350.vercel.app/"
DATA_FILE = Path("threefifty_petitions.json")
HTML_FILE = Path("threefifty_petitions.html")

# Deutschsprachig; zwei Regionsvarianten, weil keine allein alles kennt:
# "Region: Europe" liefert 21 Aktionen, das Weglassen des Parameters ebenfalls
# 21 – aber nur 16 davon sind dieselben. Zusammen 26. Die zwölf einzelnen
# Regionen (Africa, Worldwide, United States …) wurden am 2026-07-28 alle
# durchgemessen und brachten NULL zusätzliche Aktionen; sie zu fragen wäre nur
# Last ohne Ertrag. None = Parameter weglassen.
REGIONS   = ["Region: Europe", None]
LANG_CODE = "Language: German"

# ---- Der englische Eintrag (12.8.2026) --------------------------------------
# Derselbe Endpunkt, nur ein anderer Filterwert. ⚠️ Der Filter wirkt wirklich —
# Negativkontrolle: ein erfundenes „Language: Klingon" liefert HTTP 200 mit
# **2 Byte** und null Einträgen, „Language: English" dagegen 20 Aktionen aus
# einer einzigen Abfrage. Ohne diese Gegenprobe wäre nicht zu unterscheiden,
# ob der Parameter ignoriert wird.
EN_LANG_CODE = "Language: English"
EN_DATA_FILE = Path("threefifty_en_petitions.json")
EN_HTML_FILE = Path("threefifty_en_petitions.html")
TIME_FILTERS = ["Get involved page: low bar",
                "Get involved page: medium bar",
                "Get involved page: high bar"]

# Textbausteine der Aktionsseiten (siehe Kopf, Abschnitt TEXTE).
INTRO_SEL  = "#action-description-text"   # /sign/
INTRO_ALT  = "#action-description"        # /letter/, /signup/ – Vorsicht, s. o.
APPEAL_SEL = "#petition-text"             # /sign/
LETTER_SEL = "#letter-content"            # /letter/ – <textarea>, Klartext!

# So viele leere Antworten hintereinander gelten als „Bot-Schutz aktiv" (siehe
# run). Fünf, weil einzelne Aussetzer vorkommen, eine Sperre aber nicht endet.
ABBRUCH_NACH_LEEREN = 5

PROGRESS_RE = re.compile(r"onProgressLoaded\((.*)\)\s*;?\s*$", re.S)
PAGE_ID_RE  = re.compile(r"view_by_page_id/(\d+)")

# Die Petitions-URL zeigt IMMER auf einen 350.org-Host (siehe Kopf: act.350.org/
# cms/view_by_page_id/<id>). obj["url"] stammt aber aus der Drittanbieter-API
# getinvolved350.vercel.app — eine FREMDE Angabe. core.eigene_adresse übernimmt
# sie nur, wenn sie auf 350.org zeigt; sonst gilt die selbst gebaute Adresse.
# Ohne diese Bindung könnte eine umgebaute/gekaperte API beliebige fremde Links
# als Petitionsziel in App und Dashboard schleusen (Fehlerklasse „fremde
# Adressangabe übernehmen", siehe core.eigene_adresse).
EIGENE_URL_RE = re.compile(r"^https://([a-z0-9-]+\.)?350\.org/", re.I)

# Form und Slug der Zielseite. BEWUSST OFFEN: welche Formen act.350.org anlegt,
# steht nirgends geschrieben, und ein geschlossenes Muster verliert jede neue
# still. Genau das ist hier passiert – r"/(sign|act)/" kannte /letter/,
# /signup/ und /survey/ nicht, also 7 von 26 Aktionen –, und vorher schon bei
# Change.org (PETITION_SLUG_RE ohne Großbuchstaben → 81 angeblich gelöschte
# Petitionen). Die Form wird deshalb auch groß/klein-tolerant gelesen.
TARGET_RE   = re.compile(r"https?://[^/]+/([A-Za-z][A-Za-z_-]*)/([^/?#]+)")

# Erste Pfadsegmente, die KEINE Aktionsseite bezeichnen. /cms/ muss hier stehen,
# sonst nähme das offene Muster schon die Einstiegsadresse selbst als Treffer
# ("cms" + "view_by_page_id") und resolve_target käme nie bis zur Weiterleitung.
KEIN_ZIEL = {"cms", "progress"}

# Formen, deren SEITE nicht abgerufen werden darf (robots.txt von act.350.org).
# Der Slug wird trotzdem ermittelt: der Zähler hängt am eigenen, ausdrücklich
# erlaubten /progress/-Zweig, nicht an der Aktionsseite.
ROBOTS_GESPERRT = {"act", "share", "login"}

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "application/json, text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}
FETCH_HEADERS_EN = dict(FETCH_HEADERS, **{"Accept-Language": "en-US,en;q=0.9"})


# ----------------------------------------------------------------------------
# Format-Kennzeichnung (Petition / Brief / E-Mail / Anmeldung / Umfrage)
# ----------------------------------------------------------------------------
# Das Format steckt in der FORM, auf die act.350.org weiterleitet – nicht im
# Knopftext. Am 2026-08-08 an allen 26 Aktionen gegengerechnet: die Schätzung
# aus dem Knopf lag bei 8 daneben (31 %). Fünf echte /sign/-Petitionen galten
# als bloße „Aktion", weil ihr Knopf englisch beschriftet ist („Submit", „Take
# Action"), und die /survey/-Umfrage galt als E-Mail-Aktion, weil „Ab-SENDE-n"
# die Mail-Regel traf. Die Form weiß es besser und kostet nichts extra: sie
# steht ohnehin im Location-Header, den resolve_target für den Zähler liest.
FORMAT_JE_FORM = {
    "sign":   "Petition",
    "letter": "Brief-Aktion",
    "signup": "Anmeldung",
    "survey": "Umfrage",
}


def kategorie_fuer(kind: str | None, obj: dict) -> str:
    """Format aus der Zielform. Nur wo die Form es offenlässt, redet der Knopf
    mit; ist die Form unbekannt, bleibt die alte Schätzung (classify).

    /letter/ heißt bei 350.org „Brief" – die Aktionsseite von 23884 schreibt
    wörtlich „Schreibe jetzt einen Brief an die Ministerin …". Auf E-Mail-Aktion
    wird deshalb nur umgestellt, wenn der Knopf das ausdrücklich sagt. „SEND",
    „SENDEN" und „Absenden" heißen bloß „abschicken" und sagen nichts über den
    Weg – genau daran ist die alte Schätzung gescheitert.
    """
    if kind not in FORMAT_JE_FORM:
        return classify(obj)
    if kind == "letter":
        t = ((obj.get("button_cta") or "") + " "
             + (obj.get("title") or "")).lower()
        if "mail" in t or "nachricht" in t:
            return "E-Mail-Aktion"
    return FORMAT_JE_FORM[kind]


def classify(obj: dict) -> str:
    """Rückfallebene: Format aus Knopfbeschriftung + Titel raten.

    Nur noch nötig, solange die Zielform unbekannt ist – also bei einer neuen
    Aktion, deren Weiterleitung der Bot-Schutz gerade nicht preisgibt. Sobald
    die Form vorliegt, entscheidet kategorie_fuer().
    """
    t = ((obj.get("button_cta") or "") + " " + (obj.get("title") or "")).lower()
    # Petition zuerst prüfen: "unterschreiben" enthält "schreib" und würde sonst
    # fälschlich als Brief-Aktion gelten.
    if any(w in t for w in ("unterschreib", "unterzeichn", "petition",
                            "namen hinzu", "name hinzu")):
        return "Petition"
    if "brief" in t or "schreib" in t:
        return "Brief-Aktion"
    if any(w in t for w in ("nachricht", "verschick", "sende", "send", "mail")):
        return "E-Mail-Aktion"
    return "Aktion"


# ----------------------------------------------------------------------------
# Entdeckung über die JSON-API (alle drei Zeitstufen zusammenführen)
# ----------------------------------------------------------------------------
def _api_url(time_filter: str, region: str | None = REGIONS[0],
             lang_code: str = LANG_CODE) -> str:
    params = {"time_filter": time_filter, "lang_code": lang_code}
    if region:
        params["region"] = region
    return API_URL + "?" + urlencode(params)


def _page_id(obj: dict) -> str | None:
    m = PAGE_ID_RE.search(obj.get("url") or "")
    return m.group(1) if m else None


def discover(fetcher: core.Fetcher, lang_code: str = LANG_CODE,
             sprachname: str = "Deutsch") -> dict[str, dict]:
    """{page_id: api_obj} über alle Zeitstufen × Regionsvarianten.

    `lang_code` ist der Filterwert der Quelle („Language: German" bzw.
    „Language: English"). ⚠️ Er wirkt wirklich — Negativkontrolle am
    12.8.2026: ein erfundenes „Language: Klingon" liefert HTTP 200 mit
    **2 Byte** und null Einträgen, Englisch dagegen 20 Aktionen."""
    found: dict[str, dict] = {}
    abfragen = [(r, tf) for r in REGIONS for tf in TIME_FILTERS]
    prog(phase="discover", current=0, total=len(abfragen),
         message=f"Lade Aktionsliste ({sprachname}) …")
    for i, (region, tf) in enumerate(abfragen, 1):
        resp = fetcher.get(_api_url(tf, region, lang_code))
        added = 0
        if resp is not None and resp.ok:
            try:
                data = json.loads(resp.text)
            except ValueError:
                data = {}
            items = data.items() if isinstance(data, dict) else []
            for key, val in items:
                if key == "langcode" and isinstance(val, list):
                    for obj in val:
                        pid = _page_id(obj)
                        if pid and pid not in found:
                            found[pid] = obj; added += 1
                elif isinstance(val, dict) and val.get("url"):
                    pid = str(key) if str(key).isdigit() else _page_id(val)
                    if pid and pid not in found:
                        found[pid] = val; added += 1
        log(f"  {region or 'ohne Region'} / {tf}: +{added} (gesamt {len(found)}).")
        prog(current=i, total=len(abfragen),
             message=f"{len(found)} Aktionen bisher")
    # Bewusst EIN Melder über alle sechs Abfragen statt einer je Unterzweig.
    # Zwei Gründe, beide am 8.8.2026 gemessen:
    #  1. Die Unterzweige liefern regulär nichts Neues – Europe/low bar brachte
    #     +20, Europe/high bar, ohne-Region/medium und ohne-Region/high je +0.
    #     Ein Melder je Unterzweig hätte also am ersten Tag dreimal Fehlalarm
    #     geschlagen, und ein Melder, der täglich meldet, wird überlesen.
    #  2. `added` oben zählt nur NEUE Seiten (pid not in found). Eine Abfrage
    #     mit +0 kann 20 Treffer geliefert haben, die eine frühere Abfrage schon
    #     kannte – aus +0 lässt sich über die Gesundheit eines Unterzweigs
    #     schlicht nichts ablesen. Messbar ist nur die Summe.
    # Schwelle: 26 Aktionen gemessen; unter 5 liefern alle sechs Abfragen
    # zusammen fast nichts, und das ist kein Aktionsstand mehr.
    core.entdeckung("Aktionslisten (Region × Zeitstufe)", len(found),
                    erwartet_min=5,
                    name_en="action lists (region × time filter)")
    return found


# ----------------------------------------------------------------------------
# Slug ermitteln (nur aus dem Redirect-Location, ohne die Zielseite zu laden)
# und Live-Zähler über /progress/
# ----------------------------------------------------------------------------
def resolve_target(fetcher: core.Fetcher, page_id: str
                   ) -> tuple[str | None, str | None, bool]:
    """(kind, slug, weg) aus der Weiterleitung von view_by_page_id. Liest nur
    den Location-Header – die (evtl. per robots gesperrte) Zielseite wird hier
    NICHT abgerufen.

    ``weg`` ist nur dann True, wenn die Antwort eindeutig sagt, dass es die
    Aktion nicht mehr gibt (404/410). Kein Ergebnis heißt sonst „heute nicht zu
    klären", nicht „verschwunden": act.350.org (Cloudflare) schaltet nach
    einigen Dutzend Abrufen einen Bot-Schutz davor und antwortet dann mit einem
    leeren 202 OHNE Location – am 2026-07-29 nachgemessen, dieselbe Seite hatte
    Minuten vorher noch sauber weitergeleitet. Wer das als „weg" verbucht,
    schiebt bei jeder Drosselung reihenweise lebende Aktionen ins Archiv."""

    def ziel(u: str):
        m = TARGET_RE.match(u)
        if m and m.group(1).lower() not in KEIN_ZIEL:
            return m.group(1).lower(), m.group(2)
        return None

    url = f"{BASE_URL}/cms/view_by_page_id/{page_id}"
    for _ in range(4):
        # ⚠️ Reihenfolge: erst die erreichte Adresse AUSWERTEN, dann die
        # robots-Frage für die NÄCHSTE Anfrage stellen. Andersherum (so stand es
        # bis 2026-08-08) verlor eine gesperrte Form ihren Slug und damit den
        # Zähler, obwohl der über den erlaubten /progress/-Zweig läuft: den
        # Location-Header zu lesen ist kein Abruf der Zielseite.
        t = ziel(url)
        if t:
            return t[0], t[1], False
        if not fetcher.allowed(url):
            return None, None, False
        try:
            resp = fetcher.session.get(url, timeout=core.REQUEST_TIMEOUT,
                                       allow_redirects=False)
        # Nur Netzprobleme abfangen (Zeitüberschreitung, DNS, Verbindung).
        # Ein pauschales `except Exception` verschluckte auch einen Tippfehler
        # in dieser Funktion und meldete ihn als „heute nicht zu klären" —
        # der Scraper liefe jahrelang scheinbar sauber weiter.
        except requests.RequestException:
            return None, None, False
        if resp.status_code in (404, 410):
            return None, None, True
        loc = resp.headers.get("Location")
        if not loc:
            return None, None, False
        url = urljoin(url, loc)
        # ⚠️ Die Weiterleitung ist eine ANGABE DER GEGENSEITE. Ohne diese
        # Bindung folgte die Schleife ihr auf einen beliebigen Host: der
        # nächste Durchgang fragte dort robots.txt ab, holte dort den nächsten
        # Location-Header — und TARGET_RE, das bewusst jeden Host zulässt,
        # machte aus dem fremden Pfad einen 350.org-Slug. Der landete danach
        # als /progress/<slug> beim echten 350.org und als Kennung im
        # Datensatz. Dieselbe Fehlerklasse wie bei EIGENE_URL_RE, nur auf dem
        # Weg dorthin statt am Ziel.
        if not EIGENE_URL_RE.match(url):
            return None, None, False
    t = ziel(url)
    return (t[0], t[1], False) if t else (None, None, False)


def fetch_progress(fetcher: core.Fetcher, slug: str) -> tuple[int, int | None] | None:
    resp = fetcher.get(f"{BASE_URL}/progress/{slug}")
    if resp is None or not resp.ok:
        return None
    m = PROGRESS_RE.search(resp.text.strip())
    try:
        data = json.loads(m.group(1) if m else resp.text)
    except (ValueError, AttributeError):
        return None
    actions = core.zahl((data.get("total") or {}).get("actions"))
    if actions is None:
        return None
    goal = core.zahl(data.get("goal"))
    if goal in (0, 1):
        goal = None
    return actions, goal


def _brieftext_html(text: str) -> str:
    """Klartext aus dem <textarea> der /letter/-Seiten in Absätze fassen.

    Der Brieftext ist KEIN HTML – im Textfeld stehen echte Zeilenumbrüche.
    Durch sanitize_fragment gejagt käme er als ein einziger Klumpen heraus,
    Anrede, Absätze und Grußformel in derselben Zeile."""
    absaetze = []
    for block in re.split(r"\n\s*\n", text.strip()):
        zeilen = [core._esc(z.strip()) for z in block.splitlines() if z.strip()]
        if zeilen:
            absaetze.append("<p>" + "<br>".join(zeilen) + "</p>")
    return "\n".join(absaetze)


# ---------------------------------------------------------------------------
# SPRACHFASSUNGEN
#
# Jede Aktionsseite trägt einen Sprachumschalter im Server-HTML:
#     <a class="lang lang-en" href="/act/<en-slug>/">English</a>
# Die aktuelle Sprache steht als class="disabled lang" ohne href. Am 8.8.2026
# an vier live Aktionen geprüft, alle vier hatten eine englische Fassung
# („Schluss mit den Rekordprofiten aus Öl und Gas…" → „Slash oil and gas
# profits, make the polluters pay!").
#
# ⚠️⚠️ DER UMSCHALTER IST NICHT EINDEUTIG. /sign/we-pay-they-profit_DE/ listet
# DREI englische Ziele: /act/we-pay-they-profit/, /act/they-profit-we-pay/ und
# /act/david-test-petition/. Wer „den englischen Link" nimmt, holt sich mit
# einem Drittel Wahrscheinlichkeit eine Testseite in die App. Deshalb wird nur
# übernommen, was zum RUMPF des deutschen Slugs passt (Slug ohne Sprachkürzel);
# passt nichts, bleibt die Sprache „ungeklärt". Lieber keine Übersetzung als
# eine falsche.
#
# ⚠️ Die Umschalter-Links zeigen auf /act/ — das ist per robots.txt für alle
# gesperrt und wird NICHT geladen. Dieselbe Seite liegt unter /sign/<slug>/,
# und /sign/ ist ausdrücklich erlaubt; genau diesen Weg nimmt der Scraper auch
# für die deutschen Seiten.
#
# ⚠️ Das Sprachkürzel im Slug ist uneinheitlich: in vier Stichproben kamen
# `_DE`, `-de`, `-DE` und `_de` vor. Deshalb wird es mit einem Ausdruck
# abgeschnitten und nicht mit einer festen Zeichenkette.
SPRACHLINK_RE = re.compile(
    r'<a[^>]+class="[^"]*\blang-([a-z]{2})\b[^"]*"[^>]*href="([^"]+)"', re.I)
SLUG_SPRACHSUFFIX_RE = re.compile(r"[-_](?:de|en|fr|nl|es|pt|tr)$", re.I)
FREMDSPRACHEN = ("en",)


def _slug_rumpf(slug: str) -> str:
    return SLUG_SPRACHSUFFIX_RE.sub("", slug or "")


def _sprachlinks(html: str, slug: str) -> dict[str, str]:
    """{sprachcode: slug} aus dem Umschalter — nur eindeutige Treffer.

    Eindeutig heißt: der Rumpf des Ziel-Slugs stimmt mit dem Rumpf des eigenen
    überein. Alles andere wird verworfen, siehe die Warnung oben."""
    rumpf = _slug_rumpf(slug).lower()
    treffer: dict[str, str] = {}
    for code, href in SPRACHLINK_RE.findall(html):
        code = code.lower()
        if code not in FREMDSPRACHEN or code in treffer:
            continue
        ziel = href.rstrip("/").rsplit("/", 1)[-1]
        if _slug_rumpf(ziel).lower() == rumpf:
            treffer[code] = ziel
    return treffer


def fetch_detail(fetcher: core.Fetcher, kind: str, slug: str) -> dict:
    """Einleitung + Aufruftext der Aktionsseite holen – je nach Form woanders.

    Gesperrte Formen kommen hier gar nicht erst an (ROBOTS_GESPERRT, geprüft
    schon beim Aufrufer); welche Form vorliegt, steht fest, bevor hier etwas
    geladen wird – resolve_target liest allein den Location-Header. fetcher.get
    prüft robots.txt zusätzlich selbst – doppelter Boden, keine Ausrede.

    Warum überhaupt: das API-Feld "description" ist bei einem Teil der Aktionen
    leer, die standen in der App dann ganz ohne Text da. Siehe Kopf, TEXTE.
    """
    if kind in ROBOTS_GESPERRT:
        return {}
    resp = fetcher.get(f"{BASE_URL}/{kind}/{slug}/")
    if resp is None or not resp.ok:
        return {}
    soup = BeautifulSoup(resp.text, "html.parser")
    intro = soup.select_one(INTRO_SEL)
    appeal = soup.select_one(APPEAL_SEL)
    if intro is None:
        kandidat = soup.select_one(INTRO_ALT)
        # ⚠️ Auf /sign/-Seiten ist #action-description die KLAMMER um Einleitung
        # UND Aufruf (gemessen 4.204 gegen 522 Zeichen) – als Einleitung taugt
        # sie nur, wenn der Aufruf nicht darin steckt, sonst stünde er zweimal
        # im Text. Auf /letter/ und /signup/ ist sie die richtige Wahl.
        if kandidat is not None and kandidat.select_one(APPEAL_SEL) is None:
            intro = kandidat
    # Klartext VOR dem Bereinigen abnehmen: sanitize_fragment baut den Knoten um.
    kurz = intro.get_text(" ", strip=True) if intro else ""
    teile = []
    if intro:
        teile.append(core.sanitize_fragment(intro, BASE_URL))
    if appeal:
        # Eigene Überschrift, weil dieser Teil auf der Seite hinter dem Link
        # „Den ganzen Text des Aufrufs lesen" in einem Dialog steckt – in der
        # App trägt ihn das Beschreibungs-Akkordion. Enthält auch die
        # Forderungszeile (.petition-target) als ersten Absatz.
        teile.append("<h3>Der ganze Text des Aufrufs</h3>")
        teile.append(core.sanitize_fragment(appeal, BASE_URL))
    else:
        # /letter/: kein #petition-text, dafür der Brief-/Mailtext im Textfeld –
        # das ist genau das, was die Aktion im Namen der Teilnehmenden abschickt.
        brief = soup.select_one(LETTER_SEL)
        brieftext = _brieftext_html(brief.get_text()) if brief else ""
        if brieftext:
            teile.append("<h3>Der Text der Nachricht</h3>")
            teile.append(brieftext)
    rec: dict = {}
    html = "\n".join(t for t in teile if t)
    if html:
        rec["description_full"] = html
    if kurz:
        rec["summary"] = (kurz[:200] + "…") if len(kurz) > 200 else kurz
    # Merker für scrape_action; wird dort wieder entfernt.
    rec["_sprachlinks"] = _sprachlinks(resp.text, slug)
    return rec


# ----------------------------------------------------------------------------
# Datensatz aus einem API-Objekt bauen
# ----------------------------------------------------------------------------
def build_rec(page_id: str, obj: dict) -> dict:
    # Die Kategorie setzt scrape_action – sie hängt an der Zielform, und die
    # steht hier noch nicht fest.
    rec: dict = {"kind": "petition", "started_by": "350.org"}
    if obj.get("title"):
        rec["title"] = obj["title"].strip()
    desc = (obj.get("description") or "").strip()
    if desc:
        rec["summary"] = (desc[:200] + "…") if len(desc) > 200 else desc
        rec["description_full"] = "<p>" + core._esc(desc) + "</p>"
    if obj.get("image"):
        rec["image_url"] = obj["image"]
    rec["url"] = core.eigene_adresse(
        obj.get("url"), f"{BASE_URL}/cms/view_by_page_id/{page_id}", EIGENE_URL_RE)
    return rec


def scrape_action(fetcher: core.Fetcher, page_id: str, obj: dict,
                  with_count: bool = True,
                  existing: dict | None = None,
                  sprache: str = "de") -> tuple[str, dict, bool]:
    """(status, rec, unklar). ``unklar`` = die Weiterleitung war nicht zu lesen
    und es war kein klares 404 – Zeichen für den Bot-Schutz (resolve_target).

    ``existing`` ist der schon gespeicherte Satz. Er wird nur für die Kategorie
    gebraucht: siehe unten, warum eine Auffrischung ohne Zähler die ermittelte
    Form nicht wieder durch eine Schätzung ersetzen darf."""
    rec = build_rec(page_id, obj)
    unklar = False
    kind = None
    if with_count:
        kind, slug, weg = resolve_target(fetcher, page_id)
        if slug:
            prog_data = fetch_progress(fetcher, slug)
            if prog_data:
                rec["signatures"] = prog_data[0]
                if prog_data[1]:
                    rec["goal"] = prog_data[1]
            # Texte im selben Fenster wie den Zähler holen (höchstens einmal
            # je 24 h, siehe skip_recent beim Aufrufer): der Aufruf-Text ändert
            # sich selten, aber er ändert sich – die Aktionen tragen
            # Aktualisierungen mitten im Text nach.
            if kind and kind not in ROBOTS_GESPERRT:
                rec.update(fetch_detail(fetcher, kind, slug))
                links = rec.pop("_sprachlinks", {})
                i18n.setze_hauptsprache(rec, sprache)
                # Sprachneutral: SLUG_SPRACHSUFFIX_RE streicht JEDES Kürzel
                # (de|en|fr|nl|es|pt|tr), beide Fassungen ergeben denselben
                # Wert. ⚠️ Anders als bei WeMove war das hier von Anfang an
                # symmetrisch — dort strich die Regel nur „-DE" und lieferte
                # deshalb null Sprachpaare (12.8.2026 gemessen).
                rec["campaign_id"] = f"threefifty:{_slug_rumpf(slug).lower()}"
                # Fremdsprachen sind abschaltbar (siehe i18n_helfer). Die
                # Kennung oben bleibt trotzdem stehen — sie kostet nichts und
                # verbindet die Fassungen, sobald sie da sind.
                # Nur der deutsche Eintrag holt die zweite Fassung IN denselben
                # Satz; seit es PLATFORM_EN gibt, entsteht sie als eigener Satz
                # und wird über campaign_id verknüpft.
                for lang in (FREMDSPRACHEN
                             if (sprache == "de" and i18n.aktiv()) else ()):
                    ziel = links.get(lang)
                    if not ziel:
                        # Kein eindeutiger Umschalter-Treffer. Das kann heißen
                        # „gibt es nicht" ODER „der Link war mehrdeutig" — wir
                        # wissen es nicht, also „ungeklärt". Nur ein belegtes
                        # Fehlen rechtfertigt das Abzeichen in der App.
                        i18n.setze_sprachfassung(rec, lang, "ungeklärt")
                        continue
                    # ⚠️ Immer über /sign/ laden: der Umschalter zeigt auf
                    # /act/, das ist per robots gesperrt.
                    fremd = fetch_detail(fetcher, "sign", ziel)
                    fremd.pop("_sprachlinks", None)
                    fremd["url"] = f"{BASE_URL}/sign/{ziel}/"
                    if fremd.get("description_full") or fremd.get("summary"):
                        i18n.setze_sprachfassung(rec, lang, "vorhanden", fremd)
                    else:
                        i18n.setze_sprachfassung(rec, lang, "ungeklärt")
        else:
            unklar = not weg
    # ⚠️ Die ermittelte Form schlägt jede Schätzung – aber ohne Form wird nur
    # dann geraten, wenn noch gar keine Kategorie gespeichert ist. Sonst
    # überschriebe jeder Auffrischungslauf ohne Zähler (skip_recent, Bot-Schutz)
    # die belastbare Angabe wieder mit dem Ratewert aus dem Knopftext.
    if kind:
        rec["category"] = kategorie_fuer(kind, obj)
    elif not (existing or {}).get("category"):
        rec["category"] = classify(obj)
    return "online", rec, unklar


def recheck_missing(fetcher: core.Fetcher, page_id: str
                    ) -> tuple[str | None, dict | None]:
    """Aus dem Feed verschwundene Aktion: noch erreichbar → online (nur Zähler
    aktualisieren), nachweislich fort → offline.

    Status None = heute nicht zu klären (leeres 202 vom Bot-Schutz o. ä.). Dann
    darf NICHTS geschrieben werden, sonst wandert eine lebende Aktion ins
    Archiv, bloß weil die Seite gerade drosselt."""
    kind, slug, weg = resolve_target(fetcher, page_id)
    if not slug:
        return ("offline" if weg else None), None
    rec: dict = {}
    prog_data = fetch_progress(fetcher, slug)
    if prog_data:
        rec["signatures"] = prog_data[0]
        if prog_data[1]:
            rec["goal"] = prog_data[1]
    return "online", rec


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def _lauf(args, data_file, plattform, lang_code: str, sprache: str,
          sprachname: str) -> None:
    """Ein Lauf für EINEN Sprach-Eintrag.

    Deutsch und Englisch teilen den ganzen Ablauf; verschieden sind nur der
    Sprachfilter der Quelle, der Zustandsspeicher und der lang-Vermerk am
    Datensatz. Bewusst EINE Funktion statt zweier ähnlicher — sonst driften
    die Notbremse und die skip_recent-Logik über die Zeit auseinander."""
    store = core.load_store(data_file)
    fetcher = core.Fetcher(delay=args.delay,
                           headers=FETCH_HEADERS if sprache == "de"
                           else FETCH_HEADERS_EN)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, data_file, extra_meta=extra, quiet=quiet)

    def rec_url(page_id: str) -> str:
        return (store.get(page_id, {}).get("url")
                or f"{BASE_URL}/cms/view_by_page_id/{page_id}")

    log(f"Sammle {sprachname.lower()}sprachige 350.org-Aktionen "
        f"(Europa + ohne Regionsfilter) …")
    discovered = discover(fetcher, lang_code, sprachname)
    # Überlebt jeden Abbruch (s. save_store: _TLS.lauf_meta, 24.8.2026).
    core.lauf_meta_setzen(available=len(discovered))

    # (1) Bekannte, die nicht mehr im Feed sind → Offline-Prüfung.
    missing = [k for k in store if k not in discovered]
    if missing and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(missing)} nicht mehr gelistete Aktion(en) …")
        prog(phase="check-known", current=0, total=len(missing),
             message="Prüfe abgelaufene Aktionen …")
        for k, page_id in enumerate(missing, 1):
            prog(current=k, total=len(missing), message=page_id)
            if core.skip_recent(store.get(page_id), args):
                continue
            status, rec = recheck_missing(fetcher, page_id)
            if status is None:
                log(f"  unklar (leere Antwort): {page_id} – bleibt unverändert.")
                continue
            core.upsert(store, page_id, rec or {}, {}, status, ts, rec_url(page_id))
            save()
            if status == "offline":
                log(f"  OFFLINE: {page_id}")

    # (2) Aktuelle Aktionen: Metadaten kommen frei aus dem einen Discovery-Call
    #     und werden immer aktualisiert; der teure Zähler (2 Requests) nur, wenn
    #     die Aktion neu oder >24 h nicht geprüft wurde (skip_recent).
    ids = list(discovered.keys())
    new_ids = [i for i in ids if i not in store]
    if args.limit:
        # Im Test nur wenige NEUE Aktionen (bekannte trotzdem billig auffrischen).
        keep_new = set(new_ids[:args.limit])
        ids = [i for i in ids if i in store or i in keep_new]
    processed_new = len([i for i in ids if i not in store])
    log(f"{len(new_ids)} neue Aktion(en) im Feed; verarbeite {len(ids)} "
        f"({processed_new} neu, Rest Auffrischung).")
    prog(phase="scrape", current=0, total=len(ids), message="Beginne …")

    # Notbremse: bei mehreren leeren Antworten hintereinander steht der
    # Bot-Schutz von act.350.org davor. Dann weiterzuklopfen brächte nichts und
    # wäre der Seite gegenüber unangemessen – der Rest des Laufs holt nur noch
    # die kostenlosen Metadaten aus dem Discovery-Call, Zähler und Texte kommen
    # beim nächsten Lauf.
    leere = 0
    gebremst = False
    for i, page_id in enumerate(ids, 1):
        obj = discovered[page_id]
        prog(current=i, total=len(ids), message=(obj.get("title") or page_id)[:60])
        existing = store.get(page_id)
        with_count = not (existing and core.skip_recent(existing, args))
        if gebremst:
            with_count = False
        status, rec, unklar = scrape_action(fetcher, page_id, obj,
                                           with_count=with_count,
                                           existing=existing,
                                           sprache=sprache)
        leere = leere + 1 if unklar else 0
        if leere >= ABBRUCH_NACH_LEEREN and not gebremst:
            gebremst = True
            log(f"  {leere} leere Antworten hintereinander – act.350.org "
                "drosselt. Hole für den Rest des Laufs nur noch Metadaten.")
        core.upsert(store, page_id, rec, {}, status, ts, rec["url"])
        save()

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Aktion(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=len(discovered))
    core.write_list_html(plattform)
    log(f"Fertig (350.org {sprachname}).")


def run(args) -> None:
    _lauf(args, DATA_FILE, PLATFORM, LANG_CODE, "de", "Deutsch")


def run_en(args) -> None:
    _lauf(args, EN_DATA_FILE, PLATFORM_EN, EN_LANG_CODE, "en", "Englisch")


def check(fetcher):
    resp = fetcher.get(_api_url(TIME_FILTERS[0]))
    if resp is None or not resp.ok:
        return False, "JSON-API nicht erreichbar"
    try:
        n = len(json.loads(resp.text))
    except ValueError:
        return False, "API liefert kein JSON"
    return (n >= 1), f"{n} Aktionen ({REGIONS[0]}/Deutsch)"

PLATFORM = Platform(
    key="threefifty",
    language="de",
    openness=3,
    openness_wunsch="Eine offene Liste fehlt; die Aktionen kommen über eine externe "
                    "JSON-API, die erst im Seiten-JavaScript zu finden war. Ein "
                    "verlinkter Index oder eine Sitemap würde denselben Zweck ohne "
                    "Suchen erfüllen.",
    openness_note="Mittel: keine offene Liste; Aktionen über eine externe "
                  "JSON-API (im Seiten-JS gefunden), Zähler über /progress/, "
                  "Texte von der Aktionsseite (/sign/, /letter/, /signup/). "
                  "/act/-Aktionsseiten sind per robots gesperrt und werden "
                  "nicht geladen – dort bleibt nur der Anreißer der API; der "
                  "Zähler kommt trotzdem, er hängt am erlaubten /progress/. "
                  "Das Format leitet sich aus dem Button-Text ab.",
    name="350.org",
    eyebrow="350.org · Klima-Aktionen (deutsch): Petitionen, E-Mail- & Brief-Aktionen",
    source_url="https://350.org/de/mitmachen/",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
)


def check_en(fetcher):
    resp = fetcher.get(_api_url(TIME_FILTERS[0], REGIONS[0], EN_LANG_CODE))
    if resp is None or not resp.ok:
        return False, "JSON-API nicht erreichbar"
    try:
        n = len(json.loads(resp.text))
    except ValueError:
        return False, "API liefert kein JSON"
    return n > 0, f"{n} Schlüssel in der englischen Antwort"


PLATFORM_EN = Platform(
    key="threefifty_en",
    language="en",
    openness=3,
    openness_wunsch="Die Aktionen laufen über dieselbe externe JSON-API wie im "
                    "deutschen Zweig, nur mit Sprachfilter. Sie ist nirgends verlinkt "
                    "und war erst im Seiten-JavaScript zu finden — ein dokumentierter "
                    "Einstieg oder eine Sitemap würde das Suchen ersparen.",
    openness_note="Mittel: keine offene Liste; Aktionen über dieselbe externe "
                  "JSON-API wie im deutschen Zweig, nur mit dem Sprachfilter "
                  "„Language: English\". Zähler über /progress/, Texte von der "
                  "Aktionsseite (/sign/, /letter/, /signup/). /act/ ist per "
                  "robots gesperrt und wird nicht geladen.",
    name="350.org (English)",
    eyebrow="350.org · Klima-Aktionen (englisch): Petitionen, E-Mail- & Brief-Aktionen",
    source_url="https://350.org/",
    data_file=EN_DATA_FILE,
    html_file=EN_HTML_FILE,
    run=run_en,
    check=check_en,
)


if __name__ == "__main__":
    import monitor
    monitor.main()
