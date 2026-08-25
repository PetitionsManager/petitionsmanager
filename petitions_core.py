#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  petitions_core.py  —  Gemeinsames Kernmodul des Petitions-Monitors
# =============================================================================
#
#  Enthält alles Plattform-UNabhängige:
#    - Platform-Beschreibung (Registry-Eintrag pro Plattform)
#    - Fetcher (HTTP mit Drosselung, Retries, robots.txt je Host)
#    - Datenhaltung (JSON-Store mit Upsert, atomares Speichern)
#    - Fortschritts-Status (für /status-Endpoint + Dashboard-Anzeige)
#    - HTML-Erzeugung (Listen-Seite, Dashboard, Platzhalter-Seiten)
#    - Lokaler Monitor-Server (Dashboard + "Jetzt scrapen" je Plattform)
#
#  Plattform-Module (weact_scraper.py, avaaz_scraper.py, …) liefern nur noch:
#    - Discovery (welche Petitionen gibt es?)
#    - Detail-Parsing (Felder aus der Petitionsseite)
#    - eine run(args)-Funktion mit dem Ablauf des Scrape-Laufs
#  und registrieren sich als Platform-Objekt. monitor.py bindet alles zusammen.
#
#  DATENMODELL pro Petition (Key = slug) — identisch für alle Plattformen;
#  Felder, die eine Plattform nicht liefert, bleiben None/leer:
#    slug, url, petition_id, title, started_by, recipient, category,
#    category_url, summary, description_full, image_url, signatures,
#    signatures_history [{checked_at,count}], milestones [{threshold,timestamp}],
#    updates [{timestamp,text}], goal, start_date, status (online|offline),
#    first_seen, last_seen, last_checked, offline_since
# =============================================================================

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import threading
import time
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import (urljoin, urlparse, parse_qs, quote, unquote,
                          urlencode as _urlencode)

import requests
from bs4 import BeautifulSoup, Comment

# ----------------------------------------------------------------------------
# Gemeinsame Konfiguration
# ----------------------------------------------------------------------------
REQUEST_DELAY   = 1.5          # Sekunden Pause zwischen Anfragen (höflich!)
REQUEST_TIMEOUT = 30
MAX_RETRIES     = 3
RESPECT_ROBOTS  = True
ROBOTS_RETRIES  = 2            # Versuche für robots.txt selbst. Ein einzelner
                               # 5xx darf keine ganze Plattform aussetzen lassen
                               # – danach gilt aber konservativ „gesperrt".
# ⚠️ Ein VERBINDUNGSFEHLER ist etwas anderes als ein Statuscode, und bis zum
# 24.8.2026 wurden beide gleich behandelt: zwei Versuche, ~3 s Pause, dann ist
# der Host für den ganzen Lauf weg. Am 24.8. an den echten Antworten gemessen:
#   · action.eko.org         HTTP 429, 31 KB HTML, KEIN Retry-After — die
#     Prüfseite des Vercel-„Security Checkpoint", auch vom Rechner des Nutzers
#     aus. Konstant. Mehr Versuche brächten nichts als Last.
#   · www.europarl.europa.eu HTTP 202, AWS-WAF-JS-Prüfung. Ebenfalls konstant
#     (siehe pm_europarl_waf_gesperrt: 3 Versuche, eine Session, null Cookies).
#   · www.openpetition.de    „Network is unreachable" — von hier aus HTTP 200,
#     in der CI aber in 3 von 12 Nachtläufen tot. Also SPRUNGHAFT.
# Ein Statuscode ist eine Antwort und wiederholt sich; ein Verbindungsabbruch
# ist keine und kann beim nächsten Versuch weg sein. Deshalb bekommt nur der
# zweite mehr Anläufe. Die Ursache des openPetition-Ausfalls ist damit NICHT
# geklärt — die naheliegende IPv6-Vermutung trägt nicht: weact, avaaz und
# 350.org haben ebenfalls AAAA-Einträge und fallen nie aus.
ROBOTS_NETZ_RETRIES = 4        # Versuche, wenn gar keine Antwort ankommt
ROBOTS_NETZ_PAUSE   = 5.0      # Sekunden Grundpause, wächst je Versuch

# Wie viele Archiv-Kandidaten ein Lauf höchstens prüft (siehe wayback_slugs).
# Bei Avaaz stehen rund 1.700 Kandidaten an – die alle in einem Lauf zu prüfen
# dauerte bei 1,5 s Pause über eine Stunde. Der Rückstand wird deshalb über
# mehrere Läufe abgearbeitet; die Warteschlange steht im _meta der Datendatei.
ARCHIVE_BATCH   = 120

# Wie viele Volltexte ein Lauf höchstens nachträgt (siehe bundestag_scraper).
# Der Bundestag listet neben den ~57 laufenden Petitionen rund 7.850 beendete
# und archivierte. Deren Stammdaten (Titel, Sachgebiet, Mitzeichnungen, Frist)
# stehen schon in der Listentabelle; nur "Text der Petition"/"Begründung"
# brauchen je eine Detailseite. Diese Nacharbeit läuft portionsweise über
# mehrere Läufe; die Warteschlange steht im _meta der Datendatei.
BACKFILL_BATCH  = 300
USER_AGENT      = ("Mozilla/5.0 (X11; Linux x86_64) PetitionsMonitor/2.0 "
                   "(privater/gemeinnütziger Zweck)")

DASHBOARD_FILE  = Path("dashboard.html")

# Tags, die in bereinigten Beschreibungen erhalten bleiben (Gliederung!).
# img/figure/figcaption seit dem 29.7.26: die Aufrufe enthalten Pressefotos mit
# Bildunterschrift (foodwatch: <figure> mit dem Foto des kranken Lachses), und
# ohne diese drei Tags blieb davon nichts übrig – der Text sprach von einem
# Bild, das nicht da war. Die App begrenzt die Größe (style.css, .pet__desc img).
ALLOWED_DESC_TAGS = {"h2", "h3", "h4", "p", "ul", "ol", "li",
                     "strong", "em", "b", "i", "br", "a", "blockquote",
                     "img", "figure", "figcaption"}
# Davon die Block-Elemente: steht eines an der Wurzel eines Fragments, darf
# sanitize_fragment kein <p> mehr darumlegen (siehe dort).
BLOCK_DESC_TAGS = {"h2", "h3", "h4", "p", "ul", "ol", "blockquote", "figure"}
# Nur zum Erzeugen neuer <p>-Tags in sanitize_fragment. new_tag gibt es allein
# auf einem BeautifulSoup-Objekt, und eines reicht für alle Aufrufe.
_P_SOUP = BeautifulSoup("", "html.parser")


# ----------------------------------------------------------------------------
# Plattform-Beschreibung
# ----------------------------------------------------------------------------
@dataclass
class Platform:
    key: str                       # Kurzname, auch Server-Route /<key>
    name: str                      # Anzeigename (Dashboard-Kachel, Titel)
    source_url: str                # Quelle (Startseite der Plattform)
    html_file: Path                # Listen- bzw. Platzhalter-Seite
    eyebrow: str = ""              # Kopfzeile der Listen-Seite
    data_file: Path | None = None  # None → reiner Platzhalter
    run: Callable | None = None    # run(args); None → reiner Platzhalter
    check: Callable | None = None  # check(fetcher)->(ok:bool, detail:str):
                                   # leichte Erreichbarkeits-/Format-Prüfung der
                                   # Entdeckungsquelle (wenige Requests). Für
                                   # `monitor.py --check` (erkennt kaputte Quellen).
    openness: int = 0              # Ampel 1(rot)–5(grün): Wie kooperativ gibt
                                   # die Plattform ihre Petitionen frei? 0=unbewertet
    openness_note: str = ""        # Kurzbegründung (Tooltip auf der Kachel)
    language: str = "de"           # Sprache der angezeigten Petitionen (ISO 639-1;
                                   # für Gruppierung/Flagge in der App)

    @property
    def is_live(self) -> bool:
        return self.run is not None and self.data_file is not None


# Ampel-Stufen: Label je Offenheits-Level (Farben in CSS .amp-<n>).
OPENNESS_LABELS = {
    5: "sehr offen",
    4: "offen",
    3: "mittel",
    2: "eingeschränkt",
    1: "verschlossen",
}
OPENNESS_LABELS_EN = {
    5: "very open",
    4: "open",
    3: "moderate",
    2: "restricted",
    1: "closed",
}


# ----------------------------------------------------------------------------
# Zweisprachigkeit des Dashboards (de/en)
# ----------------------------------------------------------------------------
# EIN Mechanismus für alles: jeder übersetzbare Knoten trägt seinen Text in
# beiden Sprachen als data-de/data-en und zeigt zunächst Deutsch. Der Umschalter
# tauscht nur noch textContent aus.
#
# Warum nicht Schlüssel + Wörterbuch wie in webapp/texts.js: dort erzeugt
# JavaScript den Text zur Laufzeit, hier erzeugt ihn Python beim Bauen — die
# Sätze mit Zahlen („54 von 263 erreichen die App nicht") sind fertig, sobald
# die Seite entsteht. Ein Schlüsselregister bräuchte zusätzlich eine
# Platzhalter-Mechanik und könnte auseinanderlaufen; hier ist es unmöglich,
# dass ein Schlüssel ohne Text existiert oder umgekehrt.
#
# Der dreistufige Rückfall aus T() gilt sinngemäß weiter: fehlt data-en, bleibt
# der deutsche Inhalt stehen — sichtbar unübersetzt statt leer.
def _zs(de: str, en: str, tag: str = "span", klasse: str = "",
        attrs: str = "") -> str:
    """Ein zweisprachiger Textknoten."""
    k = f' class="{klasse}"' if klasse else ""
    return (f'<{tag}{k}{attrs} data-de="{_esc(de)}" data-en="{_esc(en)}">'
            f'{_esc(de)}</{tag}>')


def _zt(de: str, en: str) -> str:
    """Nur die Attribute — für Elemente, die schon existieren (z. B. ein
    ``title``-Tooltip oder ein Knopf mit eigener Klasse)."""
    return f' data-de="{_esc(de)}" data-en="{_esc(en)}"'


def _openness_badge(platform: Platform) -> str:
    """Ampel-Badge für die Dashboard-Kachel: 5 Punkte, gefüllt bis zum Level,
    eingefärbt über .amp-<level>; Kurzbegründung als Tooltip.

    Der Tooltip (``openness_note``) und der Plattformname bleiben vorerst
    deutsch: beide gehören zum laufenden Auftrag „mehrsprachige Scraper" und
    werden dort in den elf Scraper-Dateien übersetzt. Sobald die Felder
    ``openness_note_en``/``name_en`` existieren, nimmt das Dashboard sie von
    selbst — deshalb hier getattr statt einer festen Zuordnung."""
    lvl = platform.openness
    if not 1 <= lvl <= 5:
        return ""
    dots = "".join(f'<i class="{"on" if i <= lvl else ""}"></i>'
                   for i in range(1, 6))
    notiz = platform.openness_note
    notiz_en = getattr(platform, "openness_note_en", "") or notiz
    return (f'<div class="amp amp-{lvl}" title="{_esc(notiz)}"'
            f'{_zt(notiz, notiz_en)} data-titel="1">'
            f'<span class="amp-dots">{dots}</span>'
            f'{_zs(OPENNESS_LABELS[lvl], OPENNESS_LABELS_EN[lvl], klasse="amp-label")}'
            f'</div>')


# ----------------------------------------------------------------------------
# Helfer
# ----------------------------------------------------------------------------
def now_iso() -> str:
    return _dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


# Standard-Mindestabstand zwischen zwei Prüfungen derselben Petition (Stunden).
DEFAULT_MIN_INTERVAL_HOURS = 24

# So oft muss eine bekannte Petition in aufeinanderfolgenden Läufen fehlen,
# bevor sie wirklich als offline gilt (siehe upsert). Schützt davor, dass eine
# vorübergehend blockierende Quelle einen kompletten Bestand abschaltet.
OFFLINE_CONFIRMATIONS = 2


def skip_recent(rec: dict | None, args=None,
                hours: float | None = None) -> bool:
    """True, wenn dieser Datensatz innerhalb des Mindestabstands bereits geprüft
    wurde und daher übersprungen werden soll. So werden Petitionen bei mehreren
    Läufen pro Tag nur ~alle 24 h erneut gescrapt (spart Anfragen).

    Steuerung über die CLI: --min-interval-hours N (0 = immer prüfen),
    --force setzt die Sperre außer Kraft."""
    if args is not None and getattr(args, "force", False):
        return False
    if hours is None:
        hours = getattr(args, "min_interval_hours", DEFAULT_MIN_INTERVAL_HOURS) \
            if args is not None else DEFAULT_MIN_INTERVAL_HOURS
    if not hours or hours <= 0:
        return False
    lc = (rec or {}).get("last_checked")
    if not lc:
        return False
    try:
        dt = _dt.datetime.fromisoformat(str(lc))
    except ValueError:
        return False
    now = _dt.datetime.now(dt.tzinfo) if dt.tzinfo else _dt.datetime.now()
    return (now - dt) < _dt.timedelta(hours=hours)


def check_source(fetcher, url: str, pattern, min_count: int = 1,
                 label: str = "Treffer") -> tuple[bool, str]:
    """Baustein für die Plattform-Health-Checks (monitor.py --check): holt EINE
    URL und zählt eindeutige Regex-Treffer. (ok, Detailtext). `pattern` ist ein
    kompiliertes re-Objekt; ok = genug Treffer (Quelle liefert noch Daten)."""
    resp = fetcher.get(url)
    if resp is None:
        return False, f"nicht erreichbar ({url[:55]})"
    if not resp.ok:
        return False, f"HTTP {resp.status_code} ({url[:45]})"
    hits = len({m if isinstance(m, str) else m[0]
                for m in pattern.findall(resp.text)})
    ok = hits >= min_count
    return ok, f"{hits} {label}" + ("" if ok else f" – erwartet ≥{min_count}!")


# ----------------------------------------------------------------------------
# Archiv-Entdeckung über das Internet Archive
# ----------------------------------------------------------------------------
# Manche Plattformen veröffentlichen KEINE vollständige Liste (Avaaz zeigt nur
# ~12 kuratierte Petitionen). Die CDX-API des Internet Archive kennt dagegen
# alle jemals archivierten URLs einer Domain – daraus lassen sich die Slugs
# rekonstruieren und anschließend LIVE gegen die Plattform verifizieren.
# Nur was heute noch erreichbar ist, landet im Bestand.
WAYBACK_CDX = "https://web.archive.org/cdx/search/cdx"


def wayback_slugs(fetcher, url_prefix: str, pattern, limit: int = 200000,
                  label: str = "Slugs") -> list[str]:
    """Eindeutige Slugs aus allen archivierten URLs unterhalb `url_prefix`.

    `pattern` ist ein kompiliertes Regex mit genau einer Gruppe, das den Slug
    aus dem Pfad zieht. Query-Strings/Fragmente werden vorher abgeschnitten,
    Groß-/Kleinschreibung beim Dedupe ignoriert. Fehler sind nicht fatal –
    dann kommt einfach eine leere Liste zurück (die Live-Quellen greifen
    weiterhin)."""
    query = _urlencode({"url": url_prefix, "matchType": "prefix",
                        "output": "json", "fl": "original",
                        "collapse": "urlkey", "limit": str(limit)})
    resp = fetcher.get(f"{WAYBACK_CDX}?{query}", timeout=300)
    if resp is None or not resp.ok:
        log("Archiv-Abfrage (Internet Archive) fehlgeschlagen – übersprungen.")
        return []
    try:
        rows = json.loads(resp.text)[1:]
    except (ValueError, IndexError):
        log("Archiv-Antwort unlesbar – übersprungen.")
        return []
    seen: dict[str, str] = {}
    for row in rows:
        path = str(row[0]).split("?")[0].split("#")[0]
        m = pattern.search(path)
        if m:
            slug = m.group(1).strip("/")
            if slug:
                seen.setdefault(slug.lower(), slug)
    log(f"Internet Archive: {len(rows)} archivierte URLs → "
        f"{len(seen)} eindeutige {label}.")
    return sorted(seen.values())


def archive_queue(data_file: Path) -> tuple[list[str], list[str]]:
    """(todo, dead) – die Archiv-Warteschlange aus dem _meta der Datendatei.

    todo = noch zu prüfende Kandidaten, dead = geprüft und nachweislich weg
    (404/410). Die Dead-Liste verhindert, dass eine spätere Auffrischung der
    Archivliste dieselben verschwundenen Seiten immer wieder einreiht.
    Beide Listen müssen bei JEDEM save_store mitgegeben werden, sonst fallen
    sie beim nächsten Schreiben aus dem _meta heraus."""
    meta = load_meta(data_file)
    return (list(meta.get("archive_todo") or []),
            list(meta.get("archive_dead") or []))


def log(msg: str) -> None:
    print(f"[{_dt.datetime.now():%H:%M:%S}] {msg}", flush=True)


def _fmt_int(n) -> str:
    try:
        return f"{int(n):,}".replace(",", ".")
    except (TypeError, ValueError):
        return "—"


def _fmt_date(iso: str | None) -> str:
    if not iso:
        return "—"
    return str(iso)[:10]


def _fmt_dt(iso: str | None) -> str:
    if not iso:
        return "—"
    return str(iso)[:16].replace("T", " ")


def zahl(wert, default=None):
    """Robuste Ganzzahl aus einem fremden Wert – Zahl, String mit Tausender-
    Trennern („1.234", „1,234") oder None. Gibt `default` zurück, wenn nichts
    Zählbares übrig bleibt, und wirft NIE.

    Warum: Zähl- und Zielwerte (Unterschriften, Ziele) kommen aus fremdem
    JSON/HTML und sind nicht vertrauenswürdig. Ein nacktes int() darauf wirft
    bei „1.234", bei einem Objekt oder bei einem leeren Regex-Rest („."/"") –
    und riss so den betroffenen Plattformlauf täglich an derselben Stelle ab.
    monitor.py fängt die Ausnahme zwar ab, aber der Rest der Schleife entfällt:
    ein stiller Teilausfall, getarnt als eine Logzeile."""
    if wert is None or isinstance(wert, bool):
        return default
    if isinstance(wert, int):
        return wert
    if isinstance(wert, float):
        return int(wert)
    if not isinstance(wert, str):
        # dict/list/bytes NICHT über str() zur Zahl verstümmeln: str({"x":1})
        # enthielte die „1" und ergäbe stillschweigend 1.
        return default
    ziffern = re.sub(r"\D", "", wert)
    return int(ziffern) if ziffern else default


def _esc(s) -> str:
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#39;"))


_ERLAUBTE_LINK_SCHEMATA = frozenset(("http", "https", "mailto"))
_ERLAUBTE_BILD_SCHEMATA = frozenset(("http", "https"))


def _sichere_url(href, base_url: str, schemata=_ERLAUBTE_LINK_SCHEMATA):
    """Macht eine Adresse aus Fremdinhalt absolut und lässt nur harmlose
    Schemata durch. Gibt None zurück, wenn die Adresse verworfen werden soll –
    also bei javascript:, data:, vbscript: und allem sonst Unbekannten.

    Warum überhaupt: die Petitionstexte gehören beliebigen Dritten. urljoin()
    reicht ein 'javascript:alert(1)' unverändert durch; landet der Link per
    innerHTML in der App, führt ein Klick fremden Code im App-Origin aus.
    Kontrollzeichen (Tab/Zeilenumbruch) werden vorher entfernt, weil ein
    Browser 'java\\tscript:' trotzdem als javascript: liest – das Schema-Raten
    darf sich davon nicht täuschen lassen."""
    if not href:
        return None
    roh = "".join(c for c in str(href) if c not in "\t\r\n").strip()
    if not roh:
        return None
    absolut = urljoin(base_url, roh)
    if urlparse(absolut).scheme.lower() in schemata:
        return absolut
    return None


def sanitize_fragment(node, base_url: str) -> str:
    """Reduziert einen Container mit gemischtem Inhalt auf erlaubte Tags;
    Links werden absolut gemacht.

    Loser Text wird in '<p>…</p>' gefasst, fertige Absätze NICHT noch einmal:
    vorher lief jeder Inhalt durch die Umhüllung, und weil die Container fast
    immer schon Absätze enthalten, entstand '<p><p>Text</p>…</p>' – am
    2026-07-29 in 756 von 776 veröffentlichten Volltexten. Der Parser schließt
    das äußere <p> beim inneren automatisch und hinterlässt beim Einsetzen per
    innerHTML einen leeren Absatz, also einen zusätzlichen Leerraum über jeder
    Beschreibung in der App.

    Gefasst wird stückweise, nicht alles am Stück: manche Quellen mischen lose
    Textknoten und Absätze im selben Container (WeAct in .trix-content). Die
    alte Doppelhülle hat diesen Fall aus Versehen richtig behandelt, weil der
    Parser das äußere <p> am ersten inneren schloss. Wer nur die Hülle
    weglässt, verliert den Absatz um den losen Text – deshalb bekommt jede
    zusammenhängende Folge loser Stücke ihren eigenen Absatz."""
    for t in list(node.find_all(True)):
        if t.name not in ALLOWED_DESC_TAGS:
            t.unwrap()
            continue
        if t.name == "a":
            # Nur Adresse behalten und auf ein harmloses Schema einschränken.
            # javascript:/data:/vbscript: werden verworfen; der Text bleibt als
            # gewöhnlicher Absatz erhalten (unwrap), nur eben ohne Link.
            ziel = _sichere_url(t.get("href"), base_url)
            t.attrs = {}
            if ziel:
                t["href"] = ziel
                t["target"] = "_blank"
                t["rel"] = "noopener"
            else:
                t.unwrap()
                continue
        elif t.name == "img":
            # Nur Quelle und Beschriftung behalten. Die Adresse muss absolut
            # sein, sonst zeigte sie später auf die App selbst. Nur http/https
            # zulassen: Bilder ohne brauchbare Quelle (Platzhalter, 1x1-Pixel)
            # sowie data:- und javascript:-Quellen fliegen ganz raus.
            src = (t.get("src") or t.get("data-src") or "").strip()
            alt = (t.get("alt") or "").strip()
            ziel = _sichere_url(src, base_url, _ERLAUBTE_BILD_SCHEMATA)
            t.attrs = {}
            if not ziel:
                t.decompose()
                continue
            t["src"] = ziel
            if alt:
                t["alt"] = alt
            t["loading"] = "lazy"
        else:
            t.attrs = {}
    # Lose Stücke (Text, <strong>, <br> …) in eigene Absätze fassen; Blöcke
    # bleiben, wo sie sind. Das Umbauen läuft über den Baum und nicht über
    # Zeichenketten, damit BeautifulSoup das Maskieren übernimmt.
    puffer: list = []

    def traegt_inhalt(x) -> bool:
        """Ist dieser Knoten es wert, einen Absatz zu bekommen?

        Kommentare nicht: openpetition liefert ein <!--marker--> mitten im Text,
        und daraus wurde ein <p><!--marker--></p> – ein leerer Absatz, also
        genau der Fehler, der hier beseitigt werden soll. Ein einzelnes <br>
        ebenso wenig."""
        if isinstance(x, Comment):
            return False
        name = getattr(x, "name", None)
        if name:
            return name != "br"
        return bool(str(x).strip())

    def fassen() -> None:
        if not puffer:
            return
        if any(traegt_inhalt(x) for x in puffer):
            absatz = _P_SOUP.new_tag("p")
            puffer[0].insert_before(absatz)
            for x in puffer:
                absatz.append(x.extract())
        puffer.clear()

    for kind in list(node.contents):
        if getattr(kind, "name", None) in BLOCK_DESC_TAGS:
            fassen()
        else:
            puffer.append(kind)
    fassen()
    return node.decode_contents().strip()


# ----------------------------------------------------------------------------
# Schlagwort-Extraktion (Tags) — beim Scrapen aus Titel/Text abgeleitet und im
# Datensatz gespeichert (Feld "tags"). Gleiche Tags verschiedener Petitionen
# sind identische Strings → die App kann darüber verlinken/filtern.
# ----------------------------------------------------------------------------
_TAG_WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüßÀ-ÿ][A-Za-zÄÖÜäöüßÀ-ÿ\-]{3,}")

# Häufige, nicht themenrelevante Wörter (DE + etwas EN für EU-Plattformen).
_TAG_STOP = frozenset("""
aber alle allein allem allen aller alles also andere anderem anderen anderer
auch auf aus bald beim bereits besonders bestehen bevor bietet bringen dabei
dadurch dafür daher damit danach dann daran darauf darf daris dass davon dazu
dein deine deinem deinen deiner dem den denen denn der deren derzeit des dessen
deshalb dessen deswegen dich diese diesem diesen dieser dieses doch dort durch
eben eigene eigenen eigentlich ein eine einem einen einer eines einfach einige
einmal endlich ente etwa etwas euch euer eure fast folgen folgt fordern
fordert für gab ganz gar geben gegen gehen geht gemacht genau gerade gern
gestartet gestern gewesen gibt gleich groß große großen habe haben hallo hat
hatte hätte heute hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer
ihres immer indem infolge innerhalb ins ist jede jedem jeden jeder jedes jene
jetzt kann kannst kein keine keinen kommen kommt können könnte lassen leben
liebe machen macht man mehr mein meine meinen meist mich mir mit muss müssen
nach nachdem nämlich neben neue neuen nicht nichts noch nötig nun nur oben oder
ohne per rund schon sehr sein seine seinem seinen seit selbst sich sie sind
soll sollen sollte somit sondern sonst sowie statt stets tatsächlich trotz über
überhaupt uns unser unsere unter unterschreiben unterstützen unterstützt viel
viele vielen vom von vor wann war waren warum was weg wegen weil weit weiter
welche welchem welchen welcher welches wenn wer werde werden wichtig wie wieder
will wir wird wirklich wo wollen wollte worden würde würden zeit zeigen zeigt
zudem zum zur zusammen zwar zwischen bitte danke petition petitionen menschen
online offline dafür deutschland europa gefordert forderung insbesondere text
thema folgendes folgende betrifft inhalt sowohl bzw etc mögen möge beschließen
deutsche deutschen deutscher deutsches bundestag begründung
the and for you our are with this that have will from has was not können muss
sowie should would could where which there their these those about being been
into over more most some such than then they them your but all any can may per
via who whom what when why how out its his her she him too now also just only
very much many other another
https http www mailto email newsletter cookie cookies javascript browser embed
widget iframe script share sharesheet campaign medium native options customer
gofundme facebook twitter instagram whatsapp telegram button click link""".split())

# URLs / Domains vorab entfernen, damit keine Slugs als Schlagwörter auftauchen.
_URL_RE = re.compile(r"https?://\S+|www\.\S+|\S+\.(?:de|com|org|net|eu|info)\b\S*",
                     re.I)


def _strip_html(html: str | None) -> str:
    if not html:
        return ""
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)


def make_tags(rec: dict, max_tags: int = 10) -> list[str]:
    """Bis zu ``max_tags`` Schlagwörter aus Titel + Kurzbeschreibung +
    (gekürztem) Beschreibungstext. Ranking nach Häufigkeit, dann Wortlänge –
    seltene, aber lange (spezifische) Wörter kommen so nach oben. Nomen
    (großgeschrieben in der Quelle) werden bei der Anzeigeschreibweise
    bevorzugt, damit dieselben Wörter platzübergreifend identisch aussehen."""
    parts = [rec.get("title") or "", rec.get("summary") or "",
             _strip_html((rec.get("description_full") or "")[:6000])]
    text = _URL_RE.sub(" ", " ".join(parts))
    freq: dict[str, int] = {}
    disp: dict[str, str] = {}
    for m in _TAG_WORD_RE.finditer(text):
        w = m.group(0).strip("-")
        key = w.lower()
        # zu kurz / Stoppwort / Zahl / Slug-artig (mehrere Bindestriche bzw.
        # sehr lang) überspringen.
        if (len(key) < 4 or len(key) > 24 or key in _TAG_STOP
                or key.isdigit() or key.count("-") > 1):
            continue
        freq[key] = freq.get(key, 0) + 1
        if key not in disp or (w[:1].isupper() and not disp[key][:1].isupper()):
            disp[key] = w
    if not freq:
        return []
    ranked = sorted(freq, key=lambda k: (-freq[k], -len(k), k))
    out: list[str] = []
    for k in ranked[:max_tags]:
        d = disp[k]
        out.append(d[:1].upper() + d[1:])
    return out


# ----------------------------------------------------------------------------
# robots.txt nach RFC 9309 — eigener Matcher statt urllib.robotparser
# ----------------------------------------------------------------------------
#  urllib.robotparser sah lange nach der bequemen Wahl aus, wertet robots.txt
#  aber in DREI Punkten falsch aus. Am 8.8.2026 gegen die echten robots.txt der
#  elf Plattformen gemessen:
#
#   1. `*` mitten im Pfad wird ignoriert. RuleLine.applies_to ist
#      `self.path == "*" or filename.startswith(self.path)` – reines
#      Präfix-Matching. `Disallow: /a/*/follow-up` trifft damit nur eine URL,
#      die ein echtes Sternchen enthält. Betroffen: ~98 Regeln, allein 84 bei
#      Change.org.
#   2. `$` am Regelende wird ignoriert, `Disallow: /*.pdf$` greift nie.
#   3. ⚠️ Die ERSTE passende Regel gewinnt statt der LÄNGSTEN. Ein `Allow: /`
#      am Anfang überschattet damit jede spätere Disallow-Regel. Genau das
#      passiert bei act.350.org: `Disallow: /act/` ist gar keine
#      Wildcard-Regel und wurde trotzdem nicht durchgesetzt.
#
#  Punkt 3 ist der folgenreichste und war am wenigsten offensichtlich.
#
#  ⚠️ Gemessene Folgen des Wechsels: An den 9.451 prüfbaren Petitions-URLs des
#  Bestands und 17 Listen-URLs ändert sich NICHTS – die Sperrregeln der
#  Plattformen zielen auf Admin-, Such- und API-Pfade. Der strengere Matcher
#  kostet also keine Daten; er hält nur das ein, was der Kodex im README ohnehin
#  zusagt.
# ----------------------------------------------------------------------------
class RobotsRules:
    """Eine ausgewertete robots.txt. `None` als Regelsatz heißt „keine
    Einschränkungen", `RobotsRules.BLOCK_ALL` heißt „im Zweifel nichts"."""

    __slots__ = ("groups", "block_all")

    def __init__(self, block_all: bool = False):
        self.groups: dict[str, list[tuple[bool, str, re.Pattern, int]]] = {}
        self.block_all = block_all

    # -- Muster → Regulärausdruck -----------------------------------------
    @staticmethod
    def _to_regex(pattern: str) -> re.Pattern:
        anchored = pattern.endswith("$")
        if anchored:
            pattern = pattern[:-1]
        parts = [".*" if ch == "*" else re.escape(ch) for ch in pattern]
        return re.compile("^" + "".join(parts) + ("$" if anchored else ""))

    @staticmethod
    def _norm(path: str) -> str:
        """Einmal dekodieren, dann einheitlich kodieren – sonst verfehlen
        Regel und URL einander bei %2D & Co."""
        try:
            return quote(unquote(path), safe="/*$~:@&=+,;?-._!()'")
        except Exception:
            return path

    # -- Parsen ------------------------------------------------------------
    @classmethod
    def parse(cls, text: str) -> "RobotsRules":
        self = cls()
        current: list[str] = []
        saw_rule = False          # danach beginnt ein User-agent eine NEUE Gruppe
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or ":" not in line:
                continue
            field, _, value = line.partition(":")
            field, value = field.strip().lower(), value.strip()
            if field in ("user-agent", "useragent"):
                if saw_rule:
                    current, saw_rule = [], False
                current.append(value.lower())
                self.groups.setdefault(value.lower(), [])
            elif field in ("allow", "disallow"):
                if not current:
                    continue
                saw_rule = True
                if not value:     # "Disallow:" ohne Wert = ausdrücklich alles frei
                    continue
                allow = field == "allow"
                rx = cls._to_regex(cls._norm(value))
                for agent in current:
                    self.groups[agent].append((allow, value, rx, len(value)))
        return self

    # -- Gruppenwahl: spezifischster Treffer, sonst "*" ---------------------
    def _group_for(self, user_agent: str):
        ua = user_agent.lower()
        best, best_len = None, -1
        for name in self.groups:
            if name and name != "*" and name in ua and len(name) > best_len:
                best, best_len = name, len(name)
        return self.groups[best] if best is not None else self.groups.get("*", [])

    # -- Abfrage: längste Regel gewinnt, bei Gleichstand Allow -------------
    def can_fetch(self, user_agent: str, url: str) -> bool:
        if self.block_all:
            return False
        parsed = urlparse(url)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        path = self._norm(path)
        winner = None
        for rule in self._group_for(user_agent):
            allow, _pattern, rx, length = rule
            if not rx.match(path):
                continue
            if (winner is None or length > winner[3]
                    or (length == winner[3] and allow and not winner[0])):
                winner = rule
        return True if winner is None else winner[0]


RobotsRules.BLOCK_ALL = RobotsRules(block_all=True)


# ----------------------------------------------------------------------------
# HTTP-Schicht (robots.txt wird je Host gecacht → mehrere Hosts pro Plattform)
# ----------------------------------------------------------------------------
class Fetcher:
    def __init__(self, delay: float = REQUEST_DELAY,
                 headers: dict | None = None):
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT,
                                     "Accept-Language": "de-DE,de;q=0.9"})
        if headers:
            self.session.headers.update(headers)
        self.user_agent = self.session.headers["User-Agent"]
        self._robots: dict[str, RobotsRules | None] = {}

    def _robots_for(self, url: str):
        """Regelsatz für den Host. None = keine Einschränkungen.

        ⚠️ Die Fallunterscheidung ist die eigentliche Zusage des Kodex:
        NUR 200 (Regeln gelten) und 404/410 (es gibt keine robots.txt, alles
        frei) sind Freigaben. Alles andere – 401, 403, 429, 5xx, Zeitüberschreitung
        – heißt „wir wissen es nicht" und wird konservativ als Sperre gewertet.
        Früher fiel alles außer 401/403 in einen else-Zweig, der „keine
        Einschränkungen" protokollierte; ein 429 auf robots.txt hat den Host
        damit faktisch freigegeben – das Gegenteil der Zusage im README.
        """
        netloc = urlparse(url).netloc
        if netloc in self._robots:
            return self._robots[netloc]

        # robots.txt über die eigene Session laden (richtiger User-Agent):
        # ein nacktes urllib meldet sich als "Python-urllib/x.y", was z. B.
        # Cloudflare mit 403 beantwortet – dann hielten wir eine erreichbare
        # robots.txt fälschlich für gesperrt.
        letzter = "?"
        # Die Grenze hängt davon ab, WORAN es scheitert (siehe die Begründung
        # bei ROBOTS_NETZ_RETRIES): eine Antwort — auch eine abweisende — ist
        # eine Auskunft und wiederholt sich; ein Verbindungsabbruch ist keine
        # und kann beim nächsten Anlauf weg sein. Sie wird deshalb in jedem
        # Durchgang neu gesetzt, nicht einmal vorab.
        grenze, versuch = ROBOTS_RETRIES, 0
        while versuch < grenze:
            versuch += 1
            try:
                resp = self.session.get(f"https://{netloc}/robots.txt",
                                        timeout=REQUEST_TIMEOUT)
                letzter = f"HTTP {resp.status_code}"
                if resp.status_code == 200:
                    if "charset" not in resp.headers.get("Content-Type", "").lower():
                        resp.encoding = "utf-8"
                    self._robots[netloc] = RobotsRules.parse(resp.text)
                    log(f"robots.txt von {netloc} geladen und wird beachtet.")
                    return self._robots[netloc]
                if resp.status_code in (404, 410):
                    self._robots[netloc] = None
                    log(f"robots.txt von {netloc}: HTTP {resp.status_code} – "
                        f"es gibt keine, alles erlaubt.")
                    return None
                # 401/403/429/5xx: einmal nachfassen, dann konservativ. Der
                # Server hat geantwortet — mehr Anläufe holen dieselbe Antwort.
                grenze = ROBOTS_RETRIES
                if versuch < grenze:
                    time.sleep(self.delay * versuch * 2)
            except requests.RequestException as exc:
                # Gar keine Antwort: zäher nachfassen und länger warten.
                letzter = str(exc)
                grenze = ROBOTS_NETZ_RETRIES
                if versuch < grenze:
                    log(f"robots.txt von {netloc}: Verbindung fehlgeschlagen "
                        f"(Versuch {versuch}/{grenze}) – neuer Anlauf in "
                        f"{ROBOTS_NETZ_PAUSE * versuch:.0f}s.")
                    time.sleep(ROBOTS_NETZ_PAUSE * versuch)

        # ⚠️ Als BEFUND melden, nicht nur ins Protokoll schreiben. Am 8.8.2026
        # nachgemessen: Ein komplett ausgelassener Host erzeugt in
        # _bestandspruefung() NULL Befunde – jeder Scraper wertet ein
        # ausbleibendes Ergebnis als "error", upsert schreibt dann nichts, und
        # der Bestand ist am Ende byte-gleich. Damit sind alle fünf Melder
        # blind: gesamt, online, ohne_titel, torsi und dubletten stehen
        # unverändert da. Der Lauf sähe aus wie „nichts Neues" – der
        # gefährlichste aller Zustände, weil er nach Erfolg aussieht.
        befund("warnung", "Host ausgelassen (robots.txt nicht lesbar)",
               f"{netloc}: {letzter}. Der Host wurde für diesen Lauf komplett "
               f"ausgelassen; von dort stammen KEINE frischen Daten. Der "
               f"Bestand bleibt unverändert stehen.",
               thema_en="Host skipped (robots.txt unreadable)",
               text_en=f"{netloc}: {letzter}. The host was skipped entirely for "
                       f"this run; no fresh data came from it. The existing "
                       f"records stay as they are.")
        self._robots[netloc] = RobotsRules.BLOCK_ALL
        return self._robots[netloc]

    def allowed(self, url: str) -> bool:
        if not RESPECT_ROBOTS:
            return True
        rules = self._robots_for(url)
        if rules is None:
            return True
        try:
            return rules.can_fetch(self.user_agent, url)
        except Exception:
            # Ein Fehler im Auswerten darf nicht zur Freigabe führen.
            return False

    def get(self, url: str, timeout: int | None = None):
        """requests.Response oder None bei endgültigem Fehler.
        404/410 werden bewusst zurückgegeben (Offline-Erkennung).
        `timeout` überschreibt REQUEST_TIMEOUT (z. B. für große Archiv-Listen)."""
        if not self.allowed(url):
            log(f"robots.txt verbietet: {url}")
            return None
        start_host = urlparse(url).netloc
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self.session.get(url,
                                        timeout=timeout or REQUEST_TIMEOUT)
                time.sleep(self.delay)
                # Fehlt im Content-Type das Charset, rät requests ISO-8859-1
                # (→ "fÃ¼r" statt "für"). Alle Zielplattformen liefern UTF-8.
                if "charset" not in resp.headers.get("Content-Type", "").lower():
                    resp.encoding = "utf-8"
                if resp.status_code in (404, 410):
                    return resp
                if resp.status_code >= 500:
                    raise requests.HTTPError(f"{resp.status_code}")
                # Weiterleitung auf einen ANDEREN Host: dessen robots.txt hat
                # bisher nie jemand gefragt, weil requests dem 301 selbst folgt
                # und allowed() nur die Startadresse sieht. Aufgefallen bei Ekō:
                # actions.eko.org/a/<slug> leitet auf action.eko.org um, wo ein
                # Bot-Schutz sitzt und die robots.txt nicht lesbar ist.
                if resp.history and urlparse(resp.url).netloc != start_host:
                    if not self.allowed(resp.url):
                        log(f"robots.txt des Weiterleitungsziels verbietet: "
                            f"{resp.url}")
                        return None
                return resp
            except requests.RequestException as exc:
                wait = self.delay * attempt * 2
                log(f"  Fehler bei {url} (Versuch {attempt}/{MAX_RETRIES}): "
                    f"{exc} – warte {wait:.1f}s")
                time.sleep(wait)
        return None


# ----------------------------------------------------------------------------
# Datenhaltung: laden, UPSERT, speichern (atomar)
# ----------------------------------------------------------------------------
FIELD_META = {
    "_README": "Petitions-Monitor. Datensaetze werden aktualisiert, nie ueberschrieben.",
    "fields": {
        "slug": "ID/Schluessel aus der URL",
        "merged_slugs": "frühere Schluessel, die auf diesen umgeleitet wurden",
        "url": "kanonische Petitions-URL",
        "petition_id": "interne numerische ID der Plattform oder null",
        "title": "Titel",
        "started_by": "Gestartet von",
        "recipient": "Adressat",
        "category": "Thema/Kategorie (falls die Plattform Kategorien hat)",
        "category_url": "Link zur Kategorieseite",
        "tags": "bis zu 10 aus dem Text abgeleitete Schlagwörter (zum Verlinken)",
        "summary": "Kurzbeschreibung (og:description)",
        "description_full": "komplette, gegliederte Beschreibung als bereinigtes HTML",
        "image_url": "Petitionsbild",
        "signatures": "aktueller Unterschriftenstand",
        "signatures_history": "Zeitreihe [{checked_at,count}]",
        "milestones": "Meilenstein-Marken [{threshold,timestamp}]",
        "updates": "Neuigkeiten [{timestamp,text}]",
        "goal": "aktuelles Unterschriften-Ziel (falls die Plattform eines zeigt)",
        "start_date": "Startdatum (plattformabhängig ermittelt)",
        "deadline": "Ende der Mitzeichnungs-/Unterschriftenfrist oder null",
        "closed": "true = nicht mehr mitzeichenbar (Frist abgelaufen/archiviert)",
        "phase": "Verfahrensstand der Plattform (z. B. mitzeichnung|beendet|archiv)",
        "status": "online | offline (erreichbar die Seite noch?)",
        "first_seen": "erstmals gescrapt (unveraenderlich)",
        "last_seen": "zuletzt online",
        "last_checked": "zuletzt geprueft",
        "offline_since": "seit wann offline oder null",
    },
}


def load_store(data_file: Path) -> dict:
    if data_file.exists():
        try:
            data = json.loads(data_file.read_text(encoding="utf-8"))
            data.pop("_meta", None)
            return data
        except (ValueError, OSError) as exc:
            log(f"WARNUNG: {data_file} unlesbar ({exc}). Backup wird angelegt.")
            data_file.rename(data_file.with_suffix(".corrupt.json"))
    return {}


def load_meta(data_file: Path) -> dict:
    if data_file and data_file.exists():
        try:
            return json.loads(data_file.read_text(encoding="utf-8")).get("_meta", {})
        except (ValueError, OSError):
            pass
    return {}


def save_store(store: dict, data_file: Path, extra_meta: dict | None = None,
               quiet: bool = False) -> None:
    """Atomar (Temp-Datei + Rename): ein Abbruch mitten im Schreiben hinterlässt
    nie eine kaputte Datei. Wird bei jedem Scrape-Fortschritt aufgerufen, damit
    bei Absturz/Timeout nichts verloren geht.

    Beim Abschluss-Speichern (quiet=False) läuft zusätzlich die Selbstmeldung
    (siehe Abschnitt „Selbstmeldung der Scraper"): der fertige Bestand wird auf
    die Spuren bekannter Ausfälle geprüft, die Kennzahlen des Laufs wandern in
    eine Zeitreihe, und was sich VERSCHLECHTERT hat, geht ins CI. Dieser eine
    Punkt erreicht alle elf Scraper — jeder von ihnen endet hier."""
    online_now = sum(1 for r in store.values()
                     if isinstance(r, dict) and r.get("status") == "online")
    meta_extra = dict(extra_meta or {})
    if not quiet:
        prev = load_meta(data_file)
        vor_kennzahlen = prev.get("kennzahlen") or {}
        # Rückfall für Bestände, die noch vor der Selbstmeldung entstanden
        # sind: dort gibt es nur online_count. Ohne das wäre der erste Lauf
        # nach der Umstellung blind für den Online-Einbruch.
        if "online" not in vor_kennzahlen and isinstance(prev.get("online_count"), int):
            vor_kennzahlen = {**vor_kennzahlen, "online": prev["online_count"]}

        # Erst aufräumen, dann prüfen — die entfernten Bruchstücke werden der
        # Prüfung ausdrücklich mitgegeben, damit ein frischer Rückfall trotz
        # Aufräumen gemeldet wird (siehe _entferne_bruchstuecke).
        entfernt = _entferne_bruchstuecke(store)
        if entfernt:
            log(f"{len(entfernt)} abgeschnittene Adresse(n) aus dem Bestand "
                f"entfernt, z. B. {', '.join(entfernt[:3])}.")
        neue_befunde, kennzahlen = _bestandspruefung(store, vor_kennzahlen,
                                                     entfernt)
        key = getattr(_TLS, "platform", None) or "_cli"
        with BEFUND_LOCK:
            gemeldet = list(BEFUNDE.pop(key, []))
        befunde = gemeldet + neue_befunde

        verlauf = list(prev.get("lauf_verlauf") or [])
        verlauf.append(kennzahlen)
        meta_extra["lauf_verlauf"] = verlauf[-VERLAUF_MAX:]
        meta_extra["kennzahlen"] = kennzahlen
        meta_extra["befunde"] = befunde
        # health_warning bleibt als Feld erhalten: die Dashboard-Kachel und
        # ältere Bestände lesen es. Es trägt jetzt den ersten Befund.
        erste = next((b for b in befunde if b.get("stufe") == "warnung"), None)
        meta_extra["health_warning"] = (
            f"{erste['thema']}: {erste['text']}" if erste else None)
        meta_extra["online_count"] = online_now
        _melde_an_ci(data_file.stem.replace("_petitions", ""), befunde)

    out = {"_meta": {**FIELD_META, "generated_at": now_iso(),
                     "petition_count": len(store), **meta_extra}}
    out.update(store)
    tmp = data_file.with_name(data_file.name + ".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(data_file)
    if not quiet:
        log(f"{data_file} gespeichert ({len(store)} Petitionen).")


def upsert(store: dict, slug: str, new: dict, list_hint: dict,
           status: str, ts: str, default_url: str) -> None:
    """Fügt ein/aktualisiert einen Datensatz, ohne Bestehendes zu verlieren."""
    rec = store.get(slug, {})
    rec.setdefault("slug", slug)
    rec.setdefault("first_seen", ts)
    rec.setdefault("signatures_history", [])

    if status == "online":
        for key, val in (new or {}).items():
            if val not in (None, "", [], {}):
                rec[key] = val
        if list_hint.get("started_by") and not rec.get("started_by"):
            rec["started_by"] = list_hint["started_by"]
        sig = list_hint.get("signatures")
        if sig is None:
            sig = rec.get("signatures")
        if sig is not None:
            rec["signatures"] = sig
            last = rec["signatures_history"][-1] if rec["signatures_history"] else None
            if not last or last.get("count") != sig:
                rec["signatures_history"].append({"checked_at": ts, "count": sig})
        rec["status"] = "online"
        rec["last_seen"] = ts
        rec["offline_since"] = None
        rec.pop("offline_misses", None)
        tags = make_tags(rec)
        if tags:
            rec["tags"] = tags
    elif status == "offline":
        # Nicht beim ersten Fehlschlag abschalten: eine kurzzeitig blockende
        # Quelle (WAF-/Fehlerseite, Rate-Limit) darf keine ganze Plattform auf
        # "offline" kippen. Erst nach OFFLINE_CONFIRMATIONS Läufen in Folge.
        misses = int(rec.get("offline_misses") or 0) + 1
        rec["offline_misses"] = misses
        if rec.get("status") == "offline" or misses >= OFFLINE_CONFIRMATIONS:
            rec["status"] = "offline"
            if not rec.get("offline_since"):
                rec["offline_since"] = ts
        else:
            rec["status"] = "online"      # noch unbestätigt → vorerst behalten

    # Auch im Offline-Zweig darf ein Scraper die URL richtigstellen: wurde sie
    # früher durch eine Weiterleitung auf eine fremde Seite verfälscht (z. B.
    # die Startseite der Plattform), bekommt der Datensatz hier seine eigene
    # zurück. Sonst trügen mehrere entfernte Petitionen dieselbe URL.
    if status == "offline" and (new or {}).get("url"):
        rec["url"] = new["url"]

    rec["last_checked"] = ts
    rec.setdefault("url", default_url)
    store[slug] = rec


def merge_records(store: dict, old_key: str, new_key: str) -> bool:
    """Führt einen umbenannten Datensatz mit seinem Nachfolger zusammen.

    Anlass: Plattformen benennen Slugs um und leiten den alten Pfad auf den
    neuen um (WeAct: /petitions/giftexporte-stoppen → …-4). Wer den Store
    weiter unter dem alten Schlüssel führt, bekommt dieselbe Petition zweimal
    in die App – und weil die Detailseite die kanonische URL liefert, tragen
    beide Datensätze am Ende sogar dieselbe URL. Im Export teilen sie sich
    dann einen Volltext-Eintrag (publish.write_texts speichert je URL), einer
    der beiden Texte geht also verloren.

    Erhalten bleiben das ältere first_seen und die Historie des aufgelösten
    Datensatzes: übernommen werden alle Messpunkte, die AUSSERHALB des
    Zeitraums der Zielhistorie liegen (typischerweise die Zeit vor der
    Umbenennung). Die überlappenden werden bewusst verworfen – beide Slugs
    wurden eine Weile parallel gezählt und die beiden Seiten zeigen nicht
    zwangsläufig dieselbe Zahl (WeAct: 175.128 vs. 157.258 für dieselbe
    Petition). Ineinander sortiert ergäbe das eine Sägezahn-Kurve.

    Rückgabe: True, wenn zusammengeführt oder umbenannt wurde."""
    if old_key == new_key or old_key not in store:
        return False
    old = store.pop(old_key)
    new = store.get(new_key)

    if new is None:
        # Reine Umbenennung: der Datensatz wandert samt Historie mit. Die URL
        # wird verworfen, damit der folgende upsert() die aktuelle setzt –
        # sonst bliebe bei Plattformen ohne canonical-Link die alte stehen.
        old["slug"] = new_key
        old.pop("url", None)
        old["merged_slugs"] = sorted({*(old.get("merged_slugs") or []), old_key})
        store[new_key] = old
        return True

    for field, value in old.items():      # nur Lücken im Zieldatensatz füllen
        if field in ("slug", "url", "first_seen", "signatures_history",
                     "merged_slugs"):
            continue
        if new.get(field) in (None, "", [], {}):
            new[field] = value

    first_old, first_new = old.get("first_seen"), new.get("first_seen")
    if first_old and (not first_new or first_old < first_new):
        new["first_seen"] = first_old

    hist = new.get("signatures_history") or []
    extra = [e for e in (old.get("signatures_history") or []) if e.get("checked_at")]
    if hist and extra:
        von, bis = hist[0]["checked_at"], hist[-1]["checked_at"]
        extra = [e for e in extra if not von <= e["checked_at"] <= bis]
    if extra:
        new["signatures_history"] = sorted(hist + extra,
                                           key=lambda e: e.get("checked_at") or "")

    new["merged_slugs"] = sorted({*(new.get("merged_slugs") or []),
                                  *(old.get("merged_slugs") or []), old_key})
    store[new_key] = new
    return True


# ----------------------------------------------------------------------------
# Fortschritts-Status — PRO PLATTFORM, damit Scraper parallel laufen können.
# Jeder Lauf-Thread meldet über prog(); welcher Plattform ein Aufruf gehört,
# steht thread-lokal (_TLS.platform, gesetzt vom Server-Thread bzw. der CLI).
# ----------------------------------------------------------------------------
def _fresh_progress(key: str | None = None) -> dict:
    return {"running": False, "platform": key, "phase": "idle", "current": 0,
            "total": 0, "message": "", "finished_at": None, "error": None}


PROGRESS_MAP: dict[str, dict] = {}
PROGRESS_LOCK = threading.Lock()
_TLS = threading.local()


def set_progress_platform(key: str) -> None:
    """Bindet nachfolgende prog()-Aufrufe dieses Threads an eine Plattform."""
    _TLS.platform = key


def prog(**kw) -> None:
    key = getattr(_TLS, "platform", None) or "_cli"
    with PROGRESS_LOCK:
        PROGRESS_MAP.setdefault(key, _fresh_progress(key)).update(**kw)


def progress_snapshot() -> dict:
    """Gesamtbild für /status: aggregiertes running + Map aller Plattformen."""
    with PROGRESS_LOCK:
        platforms = {k: dict(v) for k, v in PROGRESS_MAP.items()}
    running = [k for k, v in platforms.items() if v.get("running")]
    return {"running": bool(running), "count_running": len(running),
            "running_platforms": running, "platforms": platforms}


# ----------------------------------------------------------------------------
# Selbstmeldung der Scraper
# ----------------------------------------------------------------------------
# WARUM ES DAS GIBT (Auftrag des Nutzers vom 4.8.2026). An einem einzigen Tag
# kamen drei Ausfälle ans Licht, die alle unbemerkt WEITERLIEFEN, weil niemand
# sie meldete:
#   1. Change.orgs Themen-Entdeckung lieferte seit unbekannter Zeit null Themen
#      — der Lauf war trotzdem grün, weil die Sitemaps die Lücke füllten.
#   2. Ein abschneidender regulärer Ausdruck erzeugte 81 Datensätze, die als
#      „gelöscht" galten; darunter eine Petition mit 72.111 Unterschriften.
#   3. WeMoves Warteschlange brach seit dem 6.7. bei Position 30 von 261 ab.
#      Die Abbruchmeldung stand im Protokoll — aber niemand liest 300 Minuten
#      Lauf-Log.
#
# Zwei Wege, absichtlich getrennt:
#   befund()/entdeckung()  der Scraper meldet selbst, was ihm auffällt
#   _bestandspruefung()    läuft OHNE Zutun der Scraper über den fertigen
#                          Bestand und sucht die Spuren, die genau diese Fälle
#                          hinterlassen. Deshalb greift sie für ALLE elf
#                          Plattformen, auch für die, die nie etwas melden.
#
# WOHIN ES GEHT: ins _meta der Datendatei (überdauert den Lauf und liegt im
# Actions-Cache), auf die Dashboard-Kachel und — im CI — als ::warning:: plus
# Tabelle in die Zusammenfassung des Laufs. Der letzte Weg ist derselbe wie in
# monitor.run_checks(); dort ist er erprobt.
#
# ⚠️ ALARM NUR BEI VERÄNDERUNG. „Nur zu melden reicht nicht, wenn niemand
# hinsieht" gilt auch andersherum: ein Warnhinweis, der bei jedem Lauf steht,
# wird nach drei Tagen überlesen. Ins CI geht deshalb ausschließlich, was sich
# gegenüber dem Vorlauf VERSCHLECHTERT hat; der Dauerzustand (WeMove trägt
# systembedingt 208 titellose Sätze) steht still auf dem Dashboard.

BEFUNDE: dict[str, list[dict]] = {}
BEFUND_LOCK = threading.Lock()
VERLAUF_MAX = 30       # so viele Läufe hält die Zeitreihe je Plattform


def eigene_adresse(kandidat: str | None, url: str,
                   muster: "re.Pattern[str]") -> str:
    """Die Adresse eines Datensatzes — aber nur, wenn sie zu IHM gehört.

    ``canonical`` und ``og:url`` sind Angaben der Gegenseite. Sie sind bequem
    (sie liefern die kanonische Schreibweise), aber sie sind FREMDE Angaben,
    und eine Quelle, die eine entfernte Petition auf eine Sammelseite
    umleitet, schreibt genau diese Sammelseite in unseren Datensatz. Danach
    tragen mehrere Petitionen dieselbe Adresse.

    Das ist in diesem Projekt inzwischen DREIMAL passiert und deshalb kein
    Einzelfall mehr, sondern eine Fehlerklasse:
      · WeAct — entfernte Petitionen wurden auf die Startseite umgeleitet; in
        der App standen Phantomsätze „WeAct – Die Petitionsplattform von
        Campact", mehrere mit derselben Adresse. Repariert mit einer eigenen
        Prüfung (``weact_scraper.ist_petitionsseite``, die zusätzlich einen
        Fremdhost kennt und deshalb dort bleibt).
      · Avaaz — die „This page is not valid"-Hülle nennt als ``og:url`` die
        Übersichtsseite. Repariert am 8.8.2026, zugleich Anlass für diese
        gemeinsame Fassung.
      · foodwatch und openpetition trugen denselben ungeprüften Zugriff. Ihre
        Quellen antworten heute mit sauberem 404 — der Fehler war dort also
        nur nicht scharf. Auf das Wohlverhalten einer fremden Seite zu bauen,
        ist aber keine Absicherung, sondern Glück.

    ``muster`` beschreibt, wie eine Detailadresse dieser Plattform aussieht.
    Passt der Kandidat nicht, gilt die angefragte Adresse — die ist per
    Konstruktion die richtige."""
    k = (kandidat or "").strip()
    return k if k and muster.search(k) else url


def eigener_link(href, base_url: str, muster: "re.Pattern[str]") -> str | None:
    """Einen auf der Seite gefundenen Link übernehmen — aber nur, wenn er auf
    der eigenen Plattform bleibt. Sonst None.

    Dieselbe Fehlerklasse wie bei ``eigene_adresse`` oben, nur eine Ebene
    tiefer: dort geht es um die Adresse des Datensatzes, hier um einen Link
    DARIN (bisher: die Kategorie).

    Die Falle steckt in ``urljoin``: der Name sagt „mit dem Basiswert
    zusammensetzen", aber das geschieht nur bei einem RELATIVEN Verweis. Ist
    der href absolut, gibt urljoin ihn unverändert zurück und der Basiswert
    bleibt ungenutzt. Ein Kategorie-Link, der im Petitionstext steht — und den
    Text schreibt ein beliebiger Dritter —, landete so als unsere
    Kategorieadresse in der App.

    ``muster`` beschreibt eine FERTIGE Adresse dieser Plattform und muss
    deshalb am Host verankert sein (``^https://…``). Das Suchmuster, mit dem
    der Link auf der Seite überhaupt gefunden wird, darf und soll lockerer
    bleiben: es muss auch relative Formen wie ``/categories/klima`` treffen.

    Das Schema prüft ``_sichere_url`` mit, damit kein ``javascript:`` durchkommt."""
    ziel = _sichere_url(href, base_url)
    return ziel if ziel and muster.match(ziel) else None


def befund(stufe: str, thema: str, text: str,
           thema_en: str = "", text_en: str = "") -> None:
    """Eine Auffälligkeit melden; `stufe` ist "warnung" oder "hinweis".
    Die Zuordnung zur Plattform läuft über denselben Thread-Kontext wie prog()
    — monitor.py --all scrapt mehrere Plattformen nebenläufig, ein einfaches
    Modul-Global würde ihre Meldungen vermischen.

    Die englische Fassung wird MITGESCHRIEBEN, nicht später übersetzt: der
    Befund entsteht beim Scrapen und liegt danach als fertiger Satz im _meta.
    Wer ihn erst im Dashboard übersetzen wollte, bräuchte dort eine Tabelle
    aller je erzeugten Sätze samt Zahlen darin. Fehlt die englische Fassung
    (Bestände von vor dem 8.8.2026), zeigt das Dashboard den deutschen Satz —
    sichtbar unübersetzt statt leer, und nach einem Lauf von selbst behoben."""
    key = getattr(_TLS, "platform", None) or "_cli"
    def kurz(t):
        return " ".join(str(t).split())[:300]
    eintrag = {"stufe": stufe, "thema": thema,
               "text": kurz(text), "zeit": now_iso()}
    if thema_en:
        eintrag["thema_en"] = thema_en
    if text_en:
        eintrag["text_en"] = kurz(text_en)
    with BEFUND_LOCK:
        BEFUNDE.setdefault(key, []).append(eintrag)
    log(f"BEFUND [{stufe}] {thema}: {eintrag['text']}")


def entdeckung(name: str, treffer: int, erwartet_min: int = 1,
               aufgegeben: bool = False, name_en: str = "") -> int:
    """Einen Entdeckungszweig zählen und melden, wenn er (fast) leer bleibt.

    Genau hier fiel Change.org durch (Fall 1 oben): ein Zweig, der NICHTS mehr
    findet, ist selten eine Randnotiz — meist ist er die erste Stufe eines
    Ausfalls, den ein zweiter Zweig noch verdeckt. Gibt `treffer` unverändert
    zurück, damit sich der Aufruf um einen bestehenden Ausdruck legen lässt:
        topics = core.entdeckung("Themenseiten", len(discover_topics(f)))

    ``aufgegeben=True`` ist für den Fall, dass die QUELLE den Zweig abgeschafft
    hat — nicht wir. Dann ist die Null keine Störung, sondern der Normalfall,
    und eine tägliche Warnung darüber ist bloß Lärm, der die echten Warnungen
    entwertet. Umgekehrt wird die Rückkehr des Zweigs gemeldet: sie ist selten,
    sie ist gute Nachricht, und sie verlangt eine Handlung (Erwartung wieder
    scharf stellen)."""
    zweig_en = name_en or name
    if aufgegeben:
        if treffer:
            befund("hinweis", f"Entdeckung „{name}“",
                   f"{treffer} Treffer – dieser Zweig galt als von der Quelle "
                   f"aufgegeben und liefert wieder. Erwartung wieder scharf "
                   f"stellen (aufgegeben=False).",
                   thema_en=f"Discovery “{zweig_en}”",
                   text_en=f"{treffer} hits – this branch was considered "
                           f"abandoned by the source and is delivering again. "
                           f"Re-arm the expectation (aufgegeben=False).")
        return treffer
    if treffer < erwartet_min:
        befund("warnung", f"Entdeckung „{name}“",
               f"{treffer} Treffer – erwartet mindestens {erwartet_min}. "
               f"Zweig vermutlich ausgefallen (Seitenumbau?).",
               thema_en=f"Discovery “{zweig_en}”",
               text_en=f"{treffer} hits – expected at least {erwartet_min}. "
                       f"The branch has probably failed (page redesign?).")
    return treffer


# Notbremse gegen Massen-Löschung durch "skip". Ein "skip" heißt "gehört nicht
# mehr in den Bestand" (nicht DE, kein Unterschriften-Formular mehr, keine
# Aktions-Kampagne …). Dieses Urteil stammt aus einer Heuristik auf FREMDEM
# HTML; ändert die Plattform ihren Seitenaufbau, fällt es für ALLE geprüften
# Sätze gleich aus. Früher löschte jeder Scraper solche Sätze sofort einzeln —
# ein einziger Lauf hätte so den ganzen Plattformbestand samt
# Unterschriften-Historie ausgelöscht (der Live-Bestand liegt nur im
# Actions-Cache, nicht im Repo). Deshalb wird ab einem auffälligen Anteil gar
# nicht gelöscht, sondern gewarnt.
SKIP_LOESCH_ANTEIL_MAX = 0.30   # >30 % skip unter den geprüften = Verdacht
SKIP_LOESCH_MIN_ABS = 10        # darunter greift die Bremse nicht (kleine Bestände)


def entferne_skip(store: dict, slugs, geprueft: int, plattform: str,
                  grund_de: str, grund_en: str = "", save=None) -> int:
    """Entfernt die als "skip" gesammelten Datensätze – aber nur, wenn ihr
    Anteil an den TATSÄCHLICH geprüften Sätzen unauffällig bleibt. `geprueft`
    ist die Zahl der Sätze mit echtem Ergebnis (online/offline/skip), NICHT die
    Gesamtzahl der bekannten: durch skip_recent läuft pro Tag nur ein Teil, und
    ein an der Gesamtzahl gemessener Anteil verschleierte den Markup-Bruch.

    Rückgabe: Zahl der wirklich gelöschten Sätze (0, wenn die Bremse griff)."""
    if not slugs:
        return 0
    anteil = len(slugs) / max(geprueft, 1)
    if len(slugs) >= SKIP_LOESCH_MIN_ABS and anteil > SKIP_LOESCH_ANTEIL_MAX:
        befund("warnung", f"{plattform}: Massen-Löschung verhindert",
               f"{len(slugs)} von {geprueft} geprüften Einträgen als "
               f"„{grund_de}“ eingestuft ({anteil:.0%}). Das deutet auf einen "
               f"geänderten Seitenaufbau hin, nicht auf so viele entfernte "
               f"Petitionen – es wurde nichts gelöscht, die Sätze bleiben.",
               thema_en=f"{plattform}: mass deletion prevented",
               text_en=f"{len(slugs)} of {geprueft} checked entries flagged as "
                       f"“{grund_en or grund_de}” ({anteil:.0%}). This points to "
                       f"a changed page layout rather than that many removed "
                       f"petitions – nothing was deleted, the records stay.")
        return 0
    for s in slugs:
        store.pop(s, None)
    log(f"  {len(slugs)} Eintrag/Einträge entfernt ({grund_de}).")
    if save:
        save()
    return len(slugs)


# ActionKit (WeMove, 350.org) beantwortet auch unfertige und Testseiten mit
# HTTP 200 — der Titel lautet dann „Enter a Title for <seitenname>". Solche
# Seiten sind keine Petitionen.
#
# Die Regel steht hier und nicht mehr in publish.py, weil BEIDE sie brauchen
# und sie auseinandergelaufen sind: publish verwarf die Platzhalter, das
# Dashboard kannte nur den LEEREN Titel. Am 8.8.2026 stand WeMove deshalb mit
# „13 ohne Titel" und „Vollständigkeit 100 %" da, während tatsächlich 54 von
# 263 Sätzen die App nie erreichten — die 41 Platzhalter zählte niemand. Eine
# Meldung, die den halben Ausfall verschweigt, ist schlimmer als keine.
PLATZHALTER_TITEL = re.compile(r"^\s*enter a title\b", re.I)


def brauchbarer_titel(rec: dict) -> bool:
    """Hat der Datensatz einen Titel, mit dem sich jemand etwas anfangen kann?

    Maßstab dafür, was publish.py ausliefert. Ohne Titel ist eine Petition in
    der App nicht lesbar, nicht suchbar und nicht sortierbar."""
    titel = (rec.get("title") or "").strip()
    return bool(titel) and not PLATZHALTER_TITEL.match(titel)


def _torsi(store: dict, ohne_titel: set) -> list[str]:
    """Slugs, die ANFANG eines anderen Slugs sind UND keinen Titel haben —
    die Signatur einer abgeschnittenen Adresse (Fall 2 oben).

    Beide Bedingungen sind nötig, das ist gemessen und nicht geschätzt
    (6.8.2026, elf Bestände): „Präfix" ALLEIN meldet bei innn.it 50 völlig
    gesunde Slugs, die zufällig Anfang eines längeren sind. Zusammen mit
    „ohne Titel" bleiben dort 0 übrig, während bei Change.org 21 der 23
    Präfix-Slugs übrig bleiben — genau die kaputten.

    Die sortierte Liste macht das billig: steht ein Slug am Anfang eines
    anderen, dann auch am Anfang seines unmittelbaren Nachfolgers."""
    slugs = sorted(k for k, v in store.items() if isinstance(v, dict))
    treffer = []
    for i in range(len(slugs) - 1):
        s, t = slugs[i], slugs[i + 1]
        if t != s and t.startswith(s) and s in ohne_titel:
            treffer.append(s)
    return treffer


def _entferne_bruchstuecke(store: dict) -> list[str]:
    """Abgeschnittene Adressen aus dem Bestand nehmen und zurückmelden.

    Das sind Slugs, die eine frühere Fassung von ``PETITION_SLUG_RE`` an der
    Prozent-Kodierung abgeschnitten hat (change.org, bis 4.8.2026): aus
    „…register-f%C3%BCr-waffen" wurde „…register-f%". Sie liefern 404, bleiben
    deshalb für immer titellos, werden nie ausgeliefert — und meldeten sich
    trotzdem jeden Tag als Dauerzustand, obwohl die Ursache längst behoben ist.
    Stand 8.8.2026 noch 23 Stück bei Change.org, von 81 am 4.8.

    Warum das gefahrlos ist: der Erkenner ist derselbe wie in der Meldung, und
    er ist gemessen — über elf Bestände am 6.8.2026 blieb bei „Präfix UND
    titellos" kein einziger gesunder Satz hängen. Entfernt wird ohnehin nur,
    was die App nie zu sehen bekommt; taucht der Slug doch wieder auf, holt ihn
    der nächste Lauf über die Sitemap zurück.

    ⚠️ Der Aufrufer muss ZUERST melden und DANN aufräumen (siehe save_store).
    Andersherum verdeckt das Aufräumen genau den Rückfall, für den die Meldung
    da ist: ein neu kaputter Ausdruck erzeugt Bruchstücke, die stillschweigend
    verschwinden, und niemand erfährt davon."""
    ohne_titel = {str(r.get("slug") or "") for r in store.values()
                  if isinstance(r, dict)
                  and not str(r.get("title") or "").strip()}
    weg = _torsi(store, ohne_titel)
    for slug in weg:
        store.pop(slug, None)
    return weg


def _bestandspruefung(store: dict, vorher: dict,
                      entfernte_torsi: list[str] | None = None
                      ) -> tuple[list[dict], dict]:
    """Prüft den FERTIGEN Bestand auf die Spuren bekannter Ausfälle.
    Liefert (neue Befunde, Kennzahlen). Die Kennzahlen wandern ins _meta und
    sind beim nächsten Lauf der Vergleichswert — ohne sie gäbe es keinen
    Vorher-Nachher, und ohne den keine Unterscheidung zwischen Dauerzustand
    und frischem Ausfall."""
    saetze = [v for v in store.values() if isinstance(v, dict)]
    gesamt = len(saetze)
    online = sum(1 for r in saetze if r.get("status", "online") == "online")
    ohne_titel = {str(r.get("slug") or "") for r in saetze
                  if not str(r.get("title") or "").strip()}
    # Platzhaltertitel getrennt zählen: sie sind KEIN „ohne Titel" (der Satz
    # hat einen), werden von publish.py aber genauso verworfen. Erst beide
    # zusammen ergeben die Zahl, die den Nutzer interessiert — wie viele Sätze
    # es nicht in die App schaffen.
    platzhalter = {str(r.get("slug") or "") for r in saetze
                   if PLATZHALTER_TITEL.match(str(r.get("title") or ""))}
    nicht_ausgeliefert = sum(1 for r in saetze if not brauchbarer_titel(r))
    # Hat der Aufrufer schon aufgeräumt, sind die Bruchstücke nicht mehr im
    # Bestand — gemeldet werden trotzdem die, die er entfernt hat.
    torsi = (_torsi(store, ohne_titel) if entfernte_torsi is None
             else entfernte_torsi)
    # Mehrere Datensätze auf DERSELBEN Adresse. Am 6.8.2026 über alle elf
    # Bestände gezählt: 0 von 14.354 — die Fehlalarmquote dieser Schwelle ist
    # also gemessen null, jede Dublette ist ein echter Befund. Bekannt ist der
    # Fall von Avaaz, wo sieben titellose Sätze auf der Übersichtsseite der
    # Plattform stehen statt auf je einer Petition; die Ursache ist offen (die
    # naheliegende Vermutung „gelöschte Petition leitet auf die Übersicht um"
    # ist widerlegt: Avaaz antwortet dort sauber mit 404).
    nach_url: dict[str, list[str]] = {}
    for r in saetze:
        u = str(r.get("url") or "")
        if u:
            nach_url.setdefault(u, []).append(str(r.get("slug") or ""))
    dubletten = {u: s for u, s in nach_url.items() if len(s) > 1}
    kennzahlen = {"zeit": now_iso(), "gesamt": gesamt, "online": online,
                  "offline": gesamt - online, "ohne_titel": len(ohne_titel),
                  "platzhalter": len(platzhalter),
                  "nicht_ausgeliefert": nicht_ausgeliefert,
                  "torsi": len(torsi), "dubletten": len(dubletten)}

    neu: list[dict] = []
    def merke(stufe, thema, text, thema_en="", text_en=""):
        eintrag = {"stufe": stufe, "thema": thema,
                   "text": " ".join(text.split())[:300],
                   "zeit": kennzahlen["zeit"]}
        if thema_en:
            eintrag["thema_en"] = thema_en
        if text_en:
            eintrag["text_en"] = " ".join(text_en.split())[:300]
        neu.append(eintrag)
        log(f"BEFUND [{stufe}] {thema}: {text}")

    v_ohne = vorher.get("ohne_titel")
    v_torsi = vorher.get("torsi")
    v_online = vorher.get("online")

    # (a) Titellose Sätze. Gemeldet wird der ZUWACHS, nicht der Stand: WeMove
    #     trägt bauartbedingt 208 titellose Sätze (Testvorlagen der Plattform),
    #     das ist bekannt und darf nicht täglich blinken. Doppelte Schwelle,
    #     damit weder ein großer Bestand (10 von 7.903 = Rauschen) noch ein
    #     kleiner (10 von 15 = Totalausfall) falsch bewertet wird.
    if isinstance(v_ohne, int) and gesamt:
        zuwachs = len(ohne_titel) - v_ohne
        anteil = zuwachs / gesamt
        if zuwachs >= 10 and anteil >= 0.02:
            merke("warnung", "Datensätze ohne Titel",
                  f"{v_ohne} → {len(ohne_titel)} von {gesamt} (+{zuwachs}). "
                  f"Titel werden vermutlich nicht mehr gelesen.",
                  thema_en="Records without a title",
                  text_en=f"{v_ohne} → {len(ohne_titel)} of {gesamt} "
                          f"(+{zuwachs}). Titles are probably no longer being "
                          f"read.")

    # (a2) Platzhaltertitel („Enter a Title for …"). Gleiche Schwellen wie (a),
    #      gleiche Begründung: WeMove trägt bauartbedingt Dutzende Testvorlagen,
    #      der Stand darf nicht blinken, der Zuwachs schon. Beim ersten Lauf mit
    #      dieser Kennzahl ist ``v_platz`` None — der Umstieg löst also keinen
    #      Fehlalarm aus, obwohl die Zahl neu im _meta auftaucht.
    v_platz = vorher.get("platzhalter")
    if isinstance(v_platz, int) and gesamt:
        zuwachs = len(platzhalter) - v_platz
        if zuwachs >= 10 and zuwachs / gesamt >= 0.02:
            merke("warnung", "Platzhaltertitel statt Petitionen",
                  f"{v_platz} → {len(platzhalter)} von {gesamt} (+{zuwachs}). "
                  f"Die Quelle liefert unfertige Seiten mit HTTP 200; sie "
                  f"werden nicht ausgeliefert.",
                  thema_en="Placeholder titles instead of petitions",
                  text_en=f"{v_platz} → {len(platzhalter)} of {gesamt} "
                          f"(+{zuwachs}). The source returns unfinished pages "
                          f"with HTTP 200; they are not published.")

    # (b) Abgeschnittene Adressen. Seit dem 8.8.2026 räumt der Lauf sie weg
    #     (_entferne_bruchstuecke), der Bestand trägt sie also nicht mehr vor
    #     sich her. Damit ändert sich, was die Zahl bedeutet: nicht mehr ein
    #     Dauerzustand, sondern was DIESER Lauf gefunden hat. Ab 3 ist es ein
    #     Ausdrucksfehler (Bundestag hat dauerhaft 1, gemessener Grundpegel);
    #     nach dem Aufräumen steht sie im Normalfall auf 0, jeder Wert darüber
    #     ist frisch entstanden und deshalb einen Hinweis wert.
    if len(torsi) >= 3 and (v_torsi is None or len(torsi) > v_torsi):
        merke("warnung", "Abgeschnittene Adressen",
              f"{len(torsi)} Slugs sind Anfang eines anderen und haben keinen "
              f"Titel, z. B. {', '.join(torsi[:3])}. Sie wurden entfernt — "
              f"prüfe den Ausdruck, der die Adresse aus der Seite zieht, sonst "
              f"entstehen sie beim nächsten Lauf neu.",
              thema_en="Truncated addresses",
              text_en=f"{len(torsi)} slugs are the beginning of another one and "
                      f"have no title, e.g. {', '.join(torsi[:3])}. They were "
                      f"removed — check the expression that extracts the "
                      f"address from the page, otherwise they come back on the "
                      f"next run.")

    # (c) Doppelt vergebene Adressen. Grundpegel gemessen 0 — deshalb genügt
    #     hier eine einzige, es braucht keinen Puffer. merge_records() liegt
    #     bereit, um zwei Sätze zusammenzuführen.
    v_dub = vorher.get("dubletten")
    if dubletten and (v_dub is None or len(dubletten) > v_dub):
        beispiel = next(iter(dubletten.items()))
        merke("warnung", "Mehrere Sätze auf derselben Adresse",
              f"{len(dubletten)} Adresse(n) doppelt vergeben, z. B. "
              f"{beispiel[0][:70]} für {', '.join(beispiel[1][:3])}. "
              f"Entweder wurde umbenannt (merge_records) oder eine Seite ohne "
              f"Petition ist in den Bestand geraten.",
              thema_en="Several records on the same address",
              text_en=f"{len(dubletten)} address(es) used more than once, e.g. "
                      f"{beispiel[0][:70]} for {', '.join(beispiel[1][:3])}. "
                      f"Either something was renamed (merge_records) or a page "
                      f"without a petition ended up in the store.")

    # (d) Einbruch des Online-Bestands (Fall 3: die Quelle blockt oder wurde
    #     umgebaut, die Petitionen sind gar nicht weg).
    if isinstance(v_online, int) and v_online >= 20 and online < v_online * 0.5:
        merke("warnung", "Online-Bestand eingebrochen",
              f"{v_online} → {online}. Quelle vermutlich blockiert oder "
              f"umgebaut – fast nie ein echtes Verschwinden.",
              thema_en="Online count collapsed",
              text_en=f"{v_online} → {online}. The source is probably blocking "
                      f"or was rebuilt – hardly ever a real disappearance.")

    return neu, kennzahlen


def _melde_an_ci(name: str, befunde: list[dict]) -> None:
    """Befunde dorthin schreiben, wo man sie OHNE ABSICHT sieht: als Annotation
    am Lauf und als Tabelle in seiner Zusammenfassung. Außerhalb von GitHub
    Actions passiert nichts — dort steht schon alles im Protokoll.
    Der senkrechte Strich muss maskiert werden, sonst zerreißt er die
    Markdown-Tabelle (in monitor.run_checks am 4.8.2026 genau so passiert)."""
    warnungen = [b for b in befunde if b.get("stufe") == "warnung"]
    if not warnungen or os.environ.get("GITHUB_ACTIONS") != "true":
        return
    for b in warnungen:
        einzeilig = " ".join(f"{b['thema']}: {b['text']}".split())[:400]
        print(f"::warning title=Scraper {name}::{einzeilig}")
    pfad = os.environ.get("GITHUB_STEP_SUMMARY")
    if not pfad:
        return
    try:
        with open(pfad, "a", encoding="utf-8") as fh:
            fh.write(f"### {name}: {len(warnungen)} Auffälligkeit(en)\n\n")
            fh.write("| Thema | Befund |\n|---|---|\n")
            for b in warnungen:
                zelle = " ".join(b["text"].split())[:200].replace("|", "\\|")
                thema = b["thema"].replace("|", "\\|")
                fh.write(f"| {thema} | {zelle} |\n")
            fh.write("\n")
    except OSError as exc:
        log(f"WARNUNG: Zusammenfassung nicht schreibbar ({exc}).")


# ----------------------------------------------------------------------------
# HTML: Listen-Seite (sortier-/filterbare Tabelle) — für jede Live-Plattform
# ----------------------------------------------------------------------------
def _img_tag(url, cls: str) -> str:
    if not url:
        return f'<span class="{cls} ph" aria-hidden="true"></span>'
    return (f'<img class="{cls}" src="{_esc(url)}" alt="" loading="lazy" '
            f'onerror="this.classList.add(\'broken\')">')


def _desc_html(text) -> str:
    if not text:
        return '<p class="muted">—</p>'
    s = str(text)
    if "<" in s and ">" in s:
        return s
    parts = [p.strip() for p in s.split("\n\n") if p.strip()]
    return "".join(f"<p>{_esc(p)}</p>" for p in parts) or '<p class="muted">—</p>'


def _veroeffentlichte_daten(platform: Platform) -> dict[str, dict]:
    """Was publish.py zuletzt für die App ausgeliefert hat, nach Adresse.

    Nur für zwei Dinge, die es NUR dort gibt: die vorberechnete Verwandtschaft
    („Gleiche / Ähnliche Petitionen" in der App) und die nachgerechneten
    Schlagwörter. Beides entsteht plattformübergreifend beim Export, nicht beim
    Scrapen — die Listenseite kann es also nicht selbst berechnen, ohne alle elf
    Bestände zu laden.

    ⚠️ Der Stand ist der des LETZTEN publish-Laufs: im CI schreibt monitor.py
    die Listen, bevor publish.py läuft. Für frisch entdeckte Petitionen fehlt
    die Verwandtschaft also einen Lauf lang. Fehlt die Datei ganz (frischer
    Klon, publish nie gelaufen), bleiben die Abschnitte einfach weg."""
    datei = Path("webapp/data") / f"{platform.key}.json"
    if not datei.exists():
        return {}
    try:
        daten = json.loads(datei.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        log(f"{datei} nicht lesbar – Verwandtschaft bleibt auf der Liste leer.")
        return {}
    return {str(e.get("url")): e for e in daten if isinstance(e, dict) and e.get("url")}


def _kategorie_zelle(kategorie: str | None) -> str:
    """Die Kategorie als Knopf statt als totem Etikett.

    In der App filtert ein Klick auf die Kategorie plattformweit; in der Liste
    war dieselbe Angabe eine reine Beschriftung, obwohl die Auswahlliste
    darüber genau diesen Filter schon kann. Gleiche Angabe, gleiche Geste."""
    if not kategorie:
        return "—"
    return (f'<button type="button" class="pill catchip" '
            f'data-cat="{_esc(kategorie)}">{_esc(kategorie)}</button>')


def _detail_panel(slug: str, r: dict, ausgeliefert: dict | None = None) -> str:
    img = _img_tag(r.get("image_url"), "detail-pic")
    summary = _esc(r.get("summary") or "—")
    recipient = _esc(r.get("recipient") or "—")
    full = _desc_html(r.get("description_full"))

    ms = r.get("milestones") or []
    ms_html = "".join(
        f'<li><b>{_fmt_int(m.get("threshold"))}</b> · '
        f'<span class="mono">{_fmt_dt(m.get("timestamp"))}</span></li>' for m in ms
    ) or '<li class="muted">—</li>'

    up = r.get("updates") or []
    up_html = "".join(
        f'<li><span class="mono">{_fmt_dt(u.get("timestamp"))}</span> '
        f'{_esc(u.get("text"))}</li>' for u in up
    ) or '<li class="muted">—</li>'

    hist = r.get("signatures_history") or []
    hist_html = "".join(
        f'<li><span class="mono">{_fmt_dt(h.get("checked_at"))}</span> · '
        f'{_fmt_int(h.get("count"))}</li>' for h in hist
    ) or '<li class="muted">—</li>'

    # Schlagwörter. Im Store stehen sie nur, wenn der Scraper sie beim Anlegen
    # erzeugt hat (bei WeMove 53 von 261, bei innn.it gar keine) — publish.py
    # rechnet sie beim Export nach. Dieselbe Rückfallebene hier, sonst zeigte
    # die Liste weniger als die App aus denselben Daten macht.
    tags = r.get("tags") or make_tags(r)
    tag_html = "".join(
        f'<button type="button" class="tagchip" data-tag="{_esc(t)}">'
        f'{_esc(t)}</button>' for t in tags[:10])
    tag_block = (f'<div class="field">'
                 f'{_zs("Schlagwörter", "Tags", tag="h4")}'
                 f'<div class="tagrow">{tag_html}</div></div>') if tags else ""

    # „Gleiche / Ähnliche Petitionen" — in der App der Fuß jeder Petition.
    # Die Liste zeigt dasselbe, sofern publish.py schon einmal gelaufen ist.
    verwandt = ((ausgeliefert or {}).get(r.get("url") or "") or {}).get("related") or []
    verw_html = "".join(
        f'<li><a href="{_esc(v.get("url"))}" target="_blank" rel="noopener">'
        f'{_esc(v.get("title") or v.get("url"))}</a></li>'
        for v in verwandt[:8] if v.get("url"))
    verw_block = (f'<div class="field">'
                  f'{_zs("Gleiche / Ähnliche Petitionen", "Same / similar petitions", tag="h4")}'
                  f'<ul class="verwandt">{verw_html}</ul></div>') if verw_html else ""

    pid = r.get("petition_id")
    url = r.get("url") or ""
    caturl = r.get("category_url") or ""
    meta = [
        ("slug", _esc(slug)),
        ("ID", _esc(pid) if pid is not None else "—"),
        ("URL", f'<a href="{_esc(url)}" target="_blank" rel="noopener">{_esc(url)}</a>'
                if url else "—"),
        (_zs("Kategorie", "Category"), f'<a href="{_esc(caturl)}" target="_blank" rel="noopener">'
                      f'{_esc(r.get("category") or caturl)}</a>' if caturl
                      else _esc(r.get("category") or "—")),
    ]
    if r.get("goal"):
        meta.append((_zs("Ziel", "Goal"), _fmt_int(r.get("goal"))))
    # Frist und Art zeigt die App, die Liste bisher nicht. „Beendet" stand hier
    # nur als Abzeichen, ohne das Datum dazu.
    if r.get("deadline"):
        meta.append((_zs("Frist", "Deadline"), _fmt_date(r.get("deadline"))))
    if r.get("kind"):
        meta.append((_zs("Art", "Kind"), _esc(r.get("kind"))))
    meta += [
        (_zs("Erstmals erfasst", "First seen"), _fmt_dt(r.get("first_seen"))),
        (_zs("Zuletzt online", "Last online"), _fmt_dt(r.get("last_seen"))),
        (_zs("Zuletzt geprüft", "Last checked"), _fmt_dt(r.get("last_checked"))),
        (_zs("Offline seit", "Offline since"), _fmt_dt(r.get("offline_since"))
                          if r.get("offline_since") else "—"),
    ]
    meta_html = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in meta)

    return (
        '<div class="detail-panel">'
        f'<div class="detail-img">{img}</div>'
        '<div class="detail-body">'
        f'<div class="field">{_zs("Kurzbeschreibung", "Summary", tag="h4")}'
        f'<p>{summary}</p></div>'
        f'<div class="field">{_zs("Adressat", "Addressed to", tag="h4")}'
        f'<p>{recipient}</p></div>'
        f'{tag_block}'
        f'<details class="fulltext">'
        f'{_zs("Komplette Beschreibung", "Full description", tag="summary")}'
        f'<div class="ft-body">{full}</div></details>'
        '<div class="lists">'
        f'<div>{_zs("Meilensteine", "Milestones", tag="h4")}<ul>{ms_html}</ul></div>'
        f'<div>{_zs("Neuigkeiten", "Updates", tag="h4")}<ul>{up_html}</ul></div>'
        f'<div>{_zs("Unterschriften-Verlauf", "Signature history", tag="h4")}'
        f'<ul>{hist_html}</ul></div>'
        '</div>'
        f'{verw_block}'
        f'<dl class="kv">{meta_html}</dl>'
        '</div>'
        '</div>'
    )


def build_list_html(store: dict, platform: Platform) -> str:
    ausgeliefert = _veroeffentlichte_daten(platform)
    rows = []
    online = offline = 0
    cols = 9

    meta = load_meta(platform.data_file)
    new_petitions = meta.get("new_petitions_last_run", [])
    new_categories = meta.get("new_categories_last_run", [])
    notes = []
    if new_petitions:
        notes.append(_zs(f"+{len(new_petitions)} neue Petition(en) im letzten Lauf",
                         f"+{len(new_petitions)} new petition(s) in the last run"))
    if new_categories:
        katliste = ", ".join(new_categories)
        notes.append(_zs(f"+{len(new_categories)} neue Kategorie(n): {katliste}",
                         f"+{len(new_categories)} new categor"
                         f"{'y' if len(new_categories) == 1 else 'ies'}: {katliste}"))
    new_note = (f'<p class="sub new-note">{" · ".join(notes)}</p>'
               if notes else "")

    cat_names = sorted({r["category"] for r in store.values() if r.get("category")})
    cat_options = "\n".join(
        f'      <option value="{_esc(c.lower())}">{_esc(c)}</option>' for c in cat_names)

    for slug, r in sorted(store.items(),
                          key=lambda kv: kv[1].get("signatures") or -1,
                          reverse=True):
        status = r.get("status", "online")
        if status == "online":
            online += 1
        else:
            offline += 1
        sig = r.get("signatures")
        # "closed" = nicht mehr unterschreibbar (Frist abgelaufen/archiviert).
        # Das ist etwas anderes als "offline" (Seite nicht mehr erreichbar),
        # deshalb eine eigene Kennzeichnung statt eines dritten status-Wertes.
        closed = bool(r.get("closed")) and status == "online"
        rows.append(
            f'<tr class="main" data-slug="{_esc(slug)}" data-status="{status}" '
            f'data-closed="{"1" if closed else ""}" '
            f'data-title="{_esc((r.get("title") or "").lower())}" '
            f'data-starter="{_esc((r.get("started_by") or "").lower())}" '
            f'data-category="{_esc((r.get("category") or "").lower())}" '
            f'data-tags="{_esc(" ".join(r.get("tags") or make_tags(r)).lower())}" '
            f'data-signatures="{sig if isinstance(sig, int) else -1}" '
            f'data-start="{_esc(r.get("start_date") or "")}" '
            f'data-checked="{_esc(r.get("last_checked") or "")}">'
            f'<td class="c-toggle"><button class="toggle" type="button" '
            f'aria-expanded="false" aria-label="Details">'
            f'<span class="chev">›</span></button></td>'
            f'<td class="c-thumb">{_img_tag(r.get("image_url"), "thumb")}</td>'
            f'<td class="c-status"><span class="badge '
            f'{"closed" if closed else status}">'
            f'<span class="dot"></span>'
            + (_zs("Beendet", "Ended") if closed
               else _zs("Online", "Online") if status == "online"
               else _zs("Offline", "Offline")) +
            f'</span></td>'
            f'<td class="c-title"><a href="{_esc(r.get("url"))}" target="_blank" '
            f'rel="noopener">{_esc(r.get("title") or slug)}</a>'
            f'<div class="recipient">{_esc(r.get("recipient") or "")}</div></td>'
            f'<td>{_esc(r.get("started_by") or "—")}</td>'
            f'<td>{_kategorie_zelle(r.get("category"))}</td>'
            f'<td class="num">{_fmt_int(sig)}</td>'
            f'<td class="mono">{_fmt_date(r.get("start_date"))}</td>'
            f'<td class="mono">{_fmt_dt(r.get("last_checked"))}</td>'
            f'</tr>'
            f'<tr class="detail"><td colspan="{cols}">'
            f'{_detail_panel(slug, r, ausgeliefert)}</td></tr>'
        )

    tmpl = _LIST_TEMPLATE
    tmpl = tmpl.replace("{{KEY}}", _esc(platform.key))
    tmpl = tmpl.replace("{{NAME}}", _esc(platform.name))
    # Die Rubrikzeile beschreibt die Plattform („Avaaz · Bürgerpetitionen &
    # Kampagnen (deutsch)") und ist damit deutscher Text, kein Eigenname.
    # Sie liegt in der Plattformdefinition; sobald dort ein Feld `eyebrow_en`
    # auftaucht, nimmt die Liste es von selbst — wie bei name_en und
    # openness_note_en. Bis dahin steht in beiden Sprachen dasselbe.
    eb = platform.eyebrow or platform.name
    tmpl = tmpl.replace("{{EYEBROW}}",
                        _zs(eb, getattr(platform, "eyebrow_en", "") or eb))
    tmpl = tmpl.replace("{{GENERATED}}", _esc(now_iso()))
    # Die Filter "Laufend"/"Beendet" nur zeigen, wo es überhaupt beendete
    # Einträge gibt (bisher nur Bundestag) – sonst bliebe die Leiste leer.
    n_closed = sum(1 for r in store.values()
                   if isinstance(r, dict) and r.get("closed"))
    tmpl = tmpl.replace("{{CLOSEDFILTERS}}",
                        ('<button data-f="running" aria-pressed="false">'
                         + _zs("Laufend", "Running") + '</button>'
                         '<button data-f="closed" aria-pressed="false">'
                         + _zs("Beendet", "Ended") + '</button>')
                        if n_closed else "")
    tmpl = tmpl.replace("{{TOTAL}}", str(len(store)))
    tmpl = tmpl.replace("{{ONLINE}}", str(online))
    tmpl = tmpl.replace("{{OFFLINE}}", str(offline))
    tmpl = tmpl.replace("{{NEW}}", str(len(new_petitions)))
    tmpl = tmpl.replace("{{NEW_NOTE}}", new_note)
    tmpl = tmpl.replace("{{CAT_OPTIONS}}", cat_options)
    tmpl = tmpl.replace("{{ROWS}}", "\n".join(rows) or
                        f'<tr><td colspan="{cols}" class="empty">'
                        + _zs("Noch keine Daten – erst scrapen.",
                              "No data yet – scrape first.") + '</td></tr>')
    tmpl = tmpl.replace("{{TOTOP}}", _TOTOP)
    tmpl = _i18n_einsetzen(tmpl)
    for platzhalter, inhalt in _LIST_I18N_BLOECKE.items():
        tmpl = tmpl.replace(platzhalter, inhalt)
    return tmpl


def write_list_html(platform: Platform) -> None:
    store = load_store(platform.data_file)
    platform.html_file.write_text(build_list_html(store, platform), encoding="utf-8")
    log(f"{platform.html_file} geschrieben.")


# Gemeinsamer "Nach oben"-Button (links unten), erscheint erst nach Scrollen.
# Wird über {{TOTOP}} in Dashboard- und Listen-Template eingesetzt.
_TOTOP = """
<button id="to-top" type="button" aria-label="Nach oben scrollen" title="Nach oben">
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="currentColor" d="M12 5l7 7-1.4 1.4L13 8.8V20h-2V8.8L6.4 13.4 5 12z"/>
  </svg>
</button>
<style>
  #to-top{position:fixed;right:20px;bottom:20px;z-index:999;width:46px;height:46px;
    border:0;border-radius:50%;background:#2f3f86;color:#fff;cursor:pointer;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 14px rgba(22,26,34,.28);opacity:0;visibility:hidden;
    transform:translateY(10px);transition:opacity .2s,transform .2s,visibility .2s}
  #to-top.show{opacity:1;visibility:visible;transform:translateY(0)}
  #to-top:hover{background:#26326b}
  #to-top:focus-visible{outline:2px solid #161a22;outline-offset:2px}
  @media (prefers-reduced-motion:reduce){#to-top{transition:none}}
</style>
<script>
(function(){
  var b=document.getElementById("to-top");
  if(!b)return;
  function upd(){ (window.scrollY>300?b.classList.add:b.classList.remove).call(b.classList,"show"); }
  window.addEventListener("scroll",upd,{passive:true});
  b.addEventListener("click",function(){
    window.scrollTo({top:0,behavior:"smooth"});
  });
  upd();
})();
</script>
"""


_LIST_TEMPLATE = """<!DOCTYPE html>
<html lang="de"
      data-title-de="{{NAME}} · Petitions-Monitor"
      data-title-en="{{NAME}} · Petition Monitor">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{NAME}} · Petitions-Monitor</title>
<style>
{{FARBEN}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
       font-size:14px;line-height:1.45}
  header{background:var(--surface);border-bottom:2px solid var(--ink);
         padding:22px clamp(16px,4vw,40px)}
  a.back{color:var(--indigo);text-decoration:none;font-weight:650;font-size:13px}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.18em;
           text-transform:uppercase;color:var(--indigo);margin:12px 0 6px}
  h1{margin:0;font-size:clamp(20px,3vw,28px);font-weight:800;letter-spacing:-.01em}
  .sub{color:var(--muted);margin-top:4px}
  .board{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
  .stat{background:var(--bg);border:1px solid var(--line);border-radius:10px;
        padding:10px 16px;min-width:120px}
  .stat .n{font-family:var(--mono);font-size:24px;font-weight:700}
  .stat .l{font-size:11px;letter-spacing:.08em;text-transform:uppercase;
           color:var(--muted)}
  .stat.online .n{color:var(--online)} .stat.offline .n{color:var(--offline)}
  .stat.new .n{color:var(--indigo)}
  .new-note{color:var(--indigo);font-weight:600}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;
       margin-right:6px;vertical-align:middle}
  .online .dot{background:var(--online)} .offline .dot{background:var(--offline)}
  main{padding:clamp(16px,4vw,40px)}
  .toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
  #q{flex:1;min-width:220px;padding:10px 14px;border:1px solid var(--line);
     border-radius:10px;font-size:14px;background:var(--surface)}
  #q:focus{outline:2px solid var(--indigo);outline-offset:1px}
  .seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;
       overflow:hidden;background:var(--surface)}
  .seg button{border:0;background:transparent;padding:9px 14px;cursor:pointer;
              font:inherit;color:var(--muted)}
  .seg button[aria-pressed=true]{background:var(--indigo);color:var(--on-accent)}
  #catFilter{padding:9px 12px;border:1px solid var(--line);border-radius:10px;
             font-size:14px;background:var(--surface);color:var(--ink)}
  #catFilter:focus{outline:2px solid var(--indigo);outline-offset:1px}
  .count{font-family:var(--mono);font-size:12px;color:var(--muted)}
  .run-btn{display:inline-flex;align-items:center;gap:8px;border:0;
           background:var(--indigo);color:var(--on-accent);font:inherit;font-weight:650;
           padding:10px 16px;border-radius:10px;cursor:pointer}
  .run-btn:hover{background:var(--indigo-hover)}
  .run-btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .run-btn:disabled{opacity:.6;cursor:default}
  .run-btn .sp{width:14px;height:14px;border-radius:50%;display:none;
       border:2px solid color-mix(in srgb,var(--on-accent) 45%,transparent);
       border-top-color:var(--on-accent)}
  .run-btn.busy .sp{display:inline-block;animation:spin .8s linear infinite}
  .run-status{font-family:var(--mono);font-size:12px;color:var(--muted)}
  @keyframes spin{to{transform:rotate(360deg)}}
  .wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;
        background:var(--surface)}
  table{border-collapse:collapse;width:100%;min-width:1040px}
  th,td{padding:11px 14px;text-align:left;vertical-align:top}
  thead th{position:sticky;top:0;background:var(--surface);border-bottom:2px solid var(--ink);
           font-size:12px;letter-spacing:.04em;text-transform:uppercase;
           color:var(--muted);cursor:pointer;user-select:none;white-space:nowrap}
  thead th[aria-sort=ascending]::after{content:" \\2191";color:var(--indigo)}
  thead th[aria-sort=descending]::after{content:" \\2193";color:var(--indigo)}
  tbody tr{border-top:1px solid var(--line)}
  tbody tr:hover{background:var(--indigo-soft)}
  tr.offline{opacity:.62}
  tr.main{cursor:pointer}
  .c-title a{color:var(--indigo);font-weight:650;text-decoration:none}
  .c-title a:hover{text-decoration:underline}
  .recipient{color:var(--muted);font-size:12px;margin-top:3px;max-width:42ch;
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .num{font-family:var(--mono);text-align:right;white-space:nowrap}
  .mono{font-family:var(--mono);color:var(--muted);white-space:nowrap}
  .pill{display:inline-block;background:var(--indigo-soft);color:var(--indigo);
        border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}
  .badge{display:inline-flex;align-items:center;font-weight:700;font-size:12px;
         padding:3px 10px;border-radius:999px}
  .badge.online{background:var(--online-bg);color:var(--online)}
  .badge.offline{background:var(--offline-bg);color:var(--offline)}
  .badge.closed{background:var(--closed-bg);color:var(--closed)}
  .c-toggle{width:42px} .c-thumb{width:78px}
  .toggle{width:28px;height:28px;border:1px solid var(--line);background:var(--surface);
          border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;
          justify-content:center;color:var(--indigo);font-size:18px;line-height:1}
  .toggle:hover{background:var(--indigo-soft)}
  .toggle:focus-visible{outline:2px solid var(--indigo);outline-offset:1px}
  .chev{display:inline-block;transition:transform .15s}
  tr.main.open .chev{transform:rotate(90deg)}
  .thumb{width:64px;height:42px;object-fit:cover;border-radius:7px;
         border:1px solid var(--line);display:block;background:var(--thumb-bg)}
  .thumb.ph{background:repeating-linear-gradient(45deg,var(--raster-a),
      var(--raster-a) 6px,var(--raster-b) 6px,var(--raster-b) 12px)}
  .thumb.broken,.detail-pic.broken{display:none}
  tr.detail{display:none}
  tr.detail>td{background:var(--detail-bg);border-top:0;padding:0}
  .detail-panel{padding:18px clamp(14px,3vw,26px);display:grid;gap:18px;
                grid-template-columns:minmax(0,1fr)}
  .detail-body{display:grid;gap:14px;min-width:0}
  .detail-pic{width:100%;border-radius:10px;border:1px solid var(--line);display:block}
  .detail-img .ph{display:block;width:100%;aspect-ratio:725/300;border-radius:10px;
       background:repeating-linear-gradient(45deg,var(--raster-a),
      var(--raster-a) 8px,var(--raster-b) 8px,var(--raster-b) 16px)}
  .detail-body h4{margin:0 0 4px;font-size:12px;letter-spacing:.05em;
                  text-transform:uppercase;color:var(--muted)}
  .detail-body .field p{margin:0;max-width:74ch}
  .muted{color:var(--muted)}
  details.fulltext{border:1px solid var(--line);border-radius:10px;background:var(--surface)}
  details.fulltext>summary{cursor:pointer;padding:10px 14px;font-weight:650;
       list-style:none;display:flex;align-items:center;gap:8px}
  details.fulltext>summary::-webkit-details-marker{display:none}
  details.fulltext>summary::before{content:"\\25B8";color:var(--indigo)}
  details.fulltext[open]>summary::before{content:"\\25BE"}
  .ft-body{padding:0 14px 12px;max-width:74ch}
  .ft-body p{margin:0 0 10px}
  .ft-body h2,.ft-body h3,.ft-body h4{margin:14px 0 6px;font-size:14px;
       font-weight:700;color:var(--ink)}
  .ft-body ul,.ft-body ol{margin:0 0 10px;padding-left:20px}
  .ft-body li{margin:3px 0}
  .ft-body a{color:var(--indigo)}
  .ft-body strong,.ft-body b{font-weight:700}
  .lists{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
  .lists ul{margin:0;padding-left:16px;font-size:13px;max-height:220px;overflow:auto}
  .lists li{margin:2px 0}
  .kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;font-size:13px;
      margin:0;align-items:baseline}
  .kv dt{color:var(--muted);font-family:var(--mono);font-size:12px}
  .kv dd{margin:0;word-break:break-word}
  @media(min-width:760px){.detail-panel{grid-template-columns:240px minmax(0,1fr)}}
  .empty{text-align:center;color:var(--muted);padding:40px}
  footer{padding:18px clamp(16px,4vw,40px);color:var(--muted);font-size:12px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  /* Schlagwörter und Verwandtschaft — beides zeigt die App, die Liste bisher
     nicht. Die Chips sind Knöpfe, weil sie etwas TUN (filtern); ein <span>
     wäre für die Tastatur unerreichbar. */
  .catchip{font:inherit;cursor:pointer;border:1px solid transparent}
  .catchip:hover{border-color:var(--indigo);color:var(--indigo)}
  .tagrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .tagchip{appearance:none;border:1px solid var(--line);background:var(--bg);
      color:var(--ink);font:inherit;font-size:11px;line-height:1;cursor:pointer;
      padding:5px 9px;border-radius:999px}
  .tagchip:hover{background:var(--indigo-soft);border-color:var(--indigo);
      color:var(--indigo)}
  .verwandt{margin:4px 0 0;padding-left:18px;font-size:12.5px;line-height:1.6}
  .verwandt a{color:var(--indigo)}
{{LANGCSS}}
</style>
</head>
<body>
<header>
  <div class="head-top">
    <a class="back" href="dashboard.html">{{BACK}}</a>
    {{LANGSEL}}
  </div>
  <p class="eyebrow">{{EYEBROW}} — {{STANDLABEL}} {{GENERATED}}</p>
  {{H1}}
  <p class="sub">{{LISTSUB}}</p>
  <div class="board">
    <div class="stat"><div class="n">{{TOTAL}}</div>{{L_PETITIONS}}</div>
    <div class="stat online"><div class="n">{{ONLINE}}</div>{{L_ONLINE}}</div>
    <div class="stat offline"><div class="n">{{OFFLINE}}</div>{{L_OFFLINE}}</div>
    <div class="stat new"><div class="n">{{NEW}}</div>{{L_NEW}}</div>
  </div>
  {{NEW_NOTE}}
</header>
<main>
  <div class="toolbar">
    <button id="run" class="run-btn" type="button"><span class="sp"></span>{{RUNNOW}}</button>
    <span class="run-status" id="run-status"></span>
    <input id="q" type="search" aria-label="Filter"
           data-ph-de="Filtern nach Titel, Starter*in, Kategorie …"
           data-ph-en="Filter by title, starter, category …"
           placeholder="Filtern nach Titel, Starter*in, Kategorie …">
    <div class="seg" role="group" aria-label="Status">
      <button data-f="all" aria-pressed="true">{{F_ALL}}</button>
      <button data-f="online" aria-pressed="false">{{F_ONLINE}}</button>
      <button data-f="offline" aria-pressed="false">{{F_OFFLINE}}</button>{{CLOSEDFILTERS}}
    </div>
    <select id="catFilter" aria-label="Kategorie / Category">
      <option value="">{{F_ALLCATS}}</option>
{{CAT_OPTIONS}}
    </select>
    <span class="count" id="count"></span>
  </div>
  <div class="wrap">
    <table id="t">
      <thead><tr>
        <th class="c-toggle" aria-hidden="true"></th>
        <th class="c-thumb">{{TH_IMG}}</th>
        <th data-k="status">{{TH_STATUS}}</th>
        <th data-k="title">{{TH_TITLE}}</th>
        <th data-k="starter">{{TH_STARTER}}</th>
        <th data-k="category">{{TH_CATEGORY}}</th>
        <th data-k="signatures" class="num">{{TH_SIGS}}</th>
        <th data-k="start">{{TH_START}}</th>
        <th data-k="checked">{{TH_CHECKED}}</th>
      </tr></thead>
      <tbody>
{{ROWS}}
      </tbody>
    </table>
  </div>
</main>
<footer>{{FOOTER}}</footer>
{{I18N}}
<script>
(function(){
  var tbody=document.querySelector("#t tbody");
  var rows=[].slice.call(tbody.querySelectorAll("tr.main"));
  rows.forEach(function(r){
    var d=r.nextElementSibling;
    r._detail=(d&&d.classList.contains("detail"))?d:null;
  });
  var q=document.getElementById("q"), count=document.getElementById("count");
  var catFilter=document.getElementById("catFilter");
  var statusFilter="all";

  function toggle(r){
    if(!r._detail)return;
    var open=r.classList.toggle("open");
    var btn=r.querySelector(".toggle");
    if(btn)btn.setAttribute("aria-expanded",open?"true":"false");
    r._detail.style.display=(open&&r.style.display!=="none")?"table-row":"none";
  }
  rows.forEach(function(r){
    var btn=r.querySelector(".toggle");
    if(btn)btn.addEventListener("click",function(e){e.stopPropagation();toggle(r);});
    r.addEventListener("click",function(e){
      if(e.target.closest("a")||e.target.closest(".toggle"))return;
      toggle(r);
    });
  });

  function apply(){
    var term=q.value.trim().toLowerCase(), cat=catFilter.value, shown=0;
    rows.forEach(function(r){
      var okText=!term || (r.dataset.title+" "+r.dataset.starter+" "+
                           r.dataset.category+" "+
                           (r.dataset.tags||"")).indexOf(term)>-1;
      var okStatus = statusFilter==="all" ? true
        : statusFilter==="closed"  ? r.dataset.closed==="1"
        : statusFilter==="running" ? (r.dataset.status==="online" &&
                                      r.dataset.closed!=="1")
        : r.dataset.status===statusFilter;
      var okCat=!cat||r.dataset.category===cat;
      var ok=okText&&okStatus&&okCat;
      r.style.display=ok?"":"none";
      if(r._detail)r._detail.style.display=(ok&&r.classList.contains("open"))?"table-row":"none";
      if(ok)shown++;
    });
    count.textContent=PM_T(shown+" von "+rows.length+" sichtbar",
                           shown+" of "+rows.length+" shown");
  }
  // Klick auf die Kategorie stellt die Auswahlliste darüber — die App filtert
  // bei derselben Geste plattformweit, hier eben innerhalb der Plattform.
  document.addEventListener("click",function(e){
    var chip=e.target.closest?e.target.closest(".catchip"):null;
    if(!chip)return;
    e.stopPropagation();
    catFilter.value=chip.getAttribute("data-cat").toLowerCase();
    apply();
    window.scrollTo({top:0,behavior:"smooth"});
  });
  // Klick auf ein Schlagwort filtert danach — dieselbe Geste wie in der App.
  // Der Klick darf die Zeile nicht zuklappen, daher stopPropagation.
  document.addEventListener("click",function(e){
    var chip=e.target.closest?e.target.closest(".tagchip"):null;
    if(!chip)return;
    e.stopPropagation();
    q.value=chip.getAttribute("data-tag");
    apply();
    window.scrollTo({top:0,behavior:"smooth"});
  });
  // Nach einem Sprachwechsel den Zähler neu schreiben — er entsteht in JS und
  // wird vom data-de/data-en-Tausch nicht erfasst.
  document.addEventListener("click",function(e){
    if(e.target.closest && e.target.closest(".langsel__b[data-lang]"))
      setTimeout(apply,0);
  });
  q.addEventListener("input",apply);
  catFilter.addEventListener("change",apply);
  document.querySelectorAll(".seg button").forEach(function(b){
    b.addEventListener("click",function(){
      statusFilter=b.dataset.f;
      document.querySelectorAll(".seg button").forEach(function(x){
        x.setAttribute("aria-pressed", x===b);});
      apply();
    });
  });

  var sortState={};
  document.querySelectorAll("thead th[data-k]").forEach(function(th){
    th.addEventListener("click",function(){
      var k=th.dataset.k, dir=sortState[k]==="asc"?"desc":"asc";
      sortState={}; sortState[k]=dir;
      document.querySelectorAll("thead th").forEach(function(x){
        x.removeAttribute("aria-sort");});
      th.setAttribute("aria-sort",dir==="asc"?"ascending":"descending");
      var num=(k==="signatures");
      rows.sort(function(a,b){
        var x=a.dataset[k]||"", y=b.dataset[k]||"";
        if(num){x=+x;y=+y;return dir==="asc"?x-y:y-x;}
        return dir==="asc"?x.localeCompare(y):y.localeCompare(x);
      });
      rows.forEach(function(r){
        tbody.appendChild(r);
        if(r._detail)tbody.appendChild(r._detail);
      });
    });
  });
  // --- Button "Jetzt scrapen" (funktioniert nur im --serve-Modus) ---
  var runBtn=document.getElementById("run");
  var runStatus=document.getElementById("run-status");
  var fileMode=(location.protocol==="file:");
  var platformKey="{{KEY}}";
  function poll(){
    fetch("/status?platform="+platformKey).then(function(r){return r.json();}).then(function(s){
      if(s.running){
        var p=s.total?" ("+s.current+"/"+s.total+" · "+
              Math.round(s.current/s.total*100)+"%)":"";
        runStatus.textContent=(s.message||PM_T("läuft …","running …"))+p;
        setTimeout(poll,1500);
      }else if(s.error){
        runStatus.textContent=PM_T("Fehler: ","Error: ")+s.error;
        runBtn.disabled=false; runBtn.classList.remove("busy");
      }else{
        runStatus.textContent=PM_T("Fertig – Seite wird aktualisiert …",
                                 "Done – reloading the page …");
        setTimeout(function(){location.reload();},600);
      }
    }).catch(function(){
      runStatus.textContent=PM_T("Verbindung zum Server verloren.",
                                 "Lost the connection to the server.");
      runBtn.disabled=false; runBtn.classList.remove("busy");
    });
  }
  if(runBtn){
    if(fileMode){
      runBtn.title=PM_T("Funktioniert nur über den lokalen Server: ",
                        "Only works via the local server: ")+
                   "python3 monitor.py --serve";
    }
    runBtn.addEventListener("click",function(){
      if(fileMode){
        runStatus.textContent=PM_T("Nur über den Server: ","Only via the server: ")+
                              "python3 monitor.py --serve";
        return;
      }
      runBtn.disabled=true; runBtn.classList.add("busy");
      runStatus.textContent=PM_T("Starte …","Starting …");
      fetch("/run?platform="+platformKey).then(function(r){return r.json();})
        .then(function(){poll();})
        .catch(function(){
          runStatus.textContent="Kein Server. Starte: python3 monitor.py --serve";
          runBtn.disabled=false; runBtn.classList.remove("busy");
        });
    });
    if(!fileMode){
      fetch("/status?platform="+platformKey).then(function(r){return r.json();}).then(function(s){
        if(s.running){runBtn.disabled=true;runBtn.classList.add("busy");poll();}
      }).catch(function(){});
    }
  }

  apply();
})();
</script>
{{TOTOP}}
</body>
</html>
"""


# ----------------------------------------------------------------------------
# HTML: Dashboard (Übersicht aller Plattformen) + Platzhalter-Seiten
# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
# Farben: EIN Satz für Dashboard, Listen und Platzhalterseiten
# ----------------------------------------------------------------------------
# Vorher hatte jede der drei Vorlagen ihren eigenen :root-Block — 15, 7 und 30
# Variablen, teils mit denselben Werten, und der Dunkelmodus existierte nur im
# Dashboard. Die Listen blieben deshalb hell, auch wenn das System dunkel steht.
#
# Beide Fassungen entstehen aus DIESEN ZWEI Wörterbüchern. Der dunkle Satz muss
# an zwei Stellen im CSS stehen (einmal für die Systemeinstellung, einmal für
# die ausdrückliche Wahl) — von Hand wären das zwei Gelegenheiten, sie
# auseinanderlaufen zu lassen; erzeugt sind sie zwangsläufig gleich.
_FARBEN_HELL = {
    "bg": "#eef0f4", "surface": "#ffffff", "ink": "#161a22", "muted": "#5d6675",
    "line": "#e2e5ec",
    "indigo": "#2f3f86", "indigo-soft": "#eaeefb", "indigo-hover": "#26326b",
    "on-accent": "#ffffff",
    "online": "#1f7a4d", "online-bg": "#e6f3ec",
    "offline": "#b23b3b", "offline-bg": "#f7e8e8",
    "closed": "#6b5a2e", "closed-bg": "#f4eeda",
    "grow": "#c98a20",
    # Aufgeklapptes Detailfeld und Vorschaubilder. Standen fest im
    # Listen-Regelwerk — im Dunkelmodus blieb das aufgeklappte Feld
    # deshalb fast weiß, mit heller Schrift darauf.
    "detail-bg": "#f6f7fb", "thumb-bg": "#dfe3ec",
    "raster-a": "#e9ecf3", "raster-b": "#eef1f7",
    "warn-bg": "#fdeceb", "warn-ink": "#8d2f28", "warn-line": "#f3c3bf",
    "info-bg": "#eaf1fb", "info-ink": "#254a7d", "info-line": "#c3d6f0",
    # Ampel: Punktfarbe und Schriftfarbe getrennt — Gelb und Hellgrün taugen als
    # Fläche, aber nicht als Schrift. Die drei -ink-Werte sind nachgedunkelt,
    # weil .amp-label mit 11px fett als Kleintext zählt (4,5:1 statt 3:1).
    "amp5": "#1f7a4d", "amp5-ink": "#1f7a4d",
    "amp4": "#7cb342", "amp4-ink": "#5b812d",
    "amp3": "#e0a80f", "amp3-ink": "#96710a",
    "amp2": "#e07b39", "amp2-ink": "#bb5c1e",
    "amp1": "#b23b3b", "amp1-ink": "#b23b3b",
}
_FARBEN_DUNKEL = {
    "bg": "#12151b", "surface": "#1a1e26", "ink": "#e7eaf0", "muted": "#9aa4b4",
    "line": "#2b313c",
    # --indigo ist hier BEIDES: Schrift auf der Fläche und Fläche unter der
    # Schrift. Deshalb wird es hell und --on-accent kippt auf dunkel.
    "indigo": "#93a8f0", "indigo-soft": "#222a3f", "indigo-hover": "#aab9f5",
    "on-accent": "#12151b",
    "online": "#4cc38a", "online-bg": "#15291f",
    "offline": "#f2867d", "offline-bg": "#2f1a18",
    "closed": "#e0c98a", "closed-bg": "#2a2416",
    "grow": "#e2a93c",
    "detail-bg": "#151922", "thumb-bg": "#232833",
    "raster-a": "#1e232d", "raster-b": "#242a36",
    "warn-bg": "#2f1a18", "warn-ink": "#ffb3ab", "warn-line": "#5b302b",
    "info-bg": "#17222f", "info-ink": "#a9c9f2", "info-line": "#2d4056",
    "amp5": "#3aa972", "amp5-ink": "#5cc48e",
    "amp4": "#8cc457", "amp4-ink": "#9ed36a",
    "amp3": "#e0a80f", "amp3-ink": "#e8bb44",
    "amp2": "#e07b39", "amp2-ink": "#ef9a63",
    "amp1": "#d05a56", "amp1-ink": "#f2867d",
}
_SCHRIFTEN = ('--mono:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;'
              '--sans:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,'
              'Arial,sans-serif;')


def _farben_css() -> str:
    """Der Farbsatz als CSS — hell, systemdunkel und ausdrücklich dunkel.

    Die Reihenfolge ist wesentlich: die Systemregel greift nur, solange NICHT
    ausdrücklich hell gewählt wurde (`:not([data-theme="light"])`), und die
    ausdrückliche Wahl steht danach und gewinnt in jedem Fall. Ohne das
    `:not(…)` könnte man auf einem dunkel eingestellten System nicht auf Hell
    schalten — die Systemregel überschriebe die Wahl."""
    def satz(d):
        return "".join(f"--{k}:{v};" for k, v in d.items())
    return (f"  :root{{{satz(_FARBEN_HELL)}{_SCHRIFTEN}}}\n"
            f"  @media (prefers-color-scheme:dark){{\n"
            f"    :root:not([data-theme=\"light\"]){{{satz(_FARBEN_DUNKEL)}}}\n"
            f"  }}\n"
            f"  :root[data-theme=\"dark\"]{{{satz(_FARBEN_DUNKEL)}}}")


# Nur diese Adressform liefert der Monitor-Server als Datei aus.
LOGO_PFAD_RE = re.compile(r"/webapp/logos/[a-z0-9_]+\.svg")

_STECKBRIEF_FELDER = ("tagline", "color", "operator", "seat", "founded",
                      "financing")


def _js_block(text: str, key: str) -> str | None:
    """Den Objektblock eines Schlüssels aus JS-Quelltext schneiden."""
    m = re.search(rf"^  {re.escape(key)}:\s*\{{", text, re.M)
    if not m:
        return None
    tiefe, j = 0, m.end() - 1
    while j < len(text):
        if text[j] == "{":
            tiefe += 1
        elif text[j] == "}":
            tiefe -= 1
            if tiefe == 0:
                return text[m.start():j + 1]
        j += 1
    return None


def _app_steckbriefe() -> dict[str, dict]:
    """Hausfarbe, Kurzbeschreibung und Steckbrief je Plattform — GELESEN aus
    ``webapp/platforms.js``, derselben Datei, aus der auch die App sie nimmt.

    Bewusst gelesen und nicht nach Python kopiert: zwei Fassungen derselben
    Angaben laufen auseinander, und man merkt es erst, wenn jemand die falsche
    liest. Der Preis ist eine Kopplung an das Dateiformat — deshalb ist jeder
    Zugriff einzeln abgesichert, und ein Fehlschlag kostet nur die Anzeige.

    ⚠️ ZWEI FALLEN, beide beim Bauen erlebt:
    1. **Der eigene Kommentar erschlägt das Suchmuster.** „PM_PLATFORMS_EN"
       steht schon im Kopfkommentar der Datei (Zeile 3). Wer am ersten
       Vorkommen schneidet, trifft den Kommentar und hält anschließend die
       DEUTSCHEN Daten für die englischen. Deshalb `^window\\.…` am
       ZEILENANFANG verankert.
    2. **Der englische Block ist eine TEIL-Überschreibung**, kein Vollsatz: er
       trägt nur das Übersetzbare (tagline, seat, financing), weder Farbe noch
       Gründungsjahr. Der Rückfall gilt deshalb je FELD, nicht je Plattform.

    Findet sich gar nichts, wird das gemeldet statt verschwiegen — eine leere
    Rückgabe sähe sonst aus, als hätten die Plattformen keinen Steckbrief."""
    datei = Path("webapp/platforms.js")
    if not datei.exists():
        return {}
    try:
        s = datei.read_text(encoding="utf-8")
    except OSError:
        return {}
    m_de = re.search(r"^window\.PM_PLATFORMS\s*=", s, re.M)
    m_en = re.search(r"^window\.PM_PLATFORMS_EN\s*=", s, re.M)
    if not m_de:
        log(f"{datei}: window.PM_PLATFORMS nicht gefunden – die Kacheln "
            f"bleiben ohne Steckbrief.")
        return {}
    teil_de = s[m_de.start():m_en.start() if m_en else len(s)]
    teil_en = s[m_en.start():] if m_en else ""

    def feld(block: str | None, name: str) -> str:
        if not block:
            return ""
        m = (re.search(rf'\b{name}:\s*"([^"]*)"', block)
             or re.search(rf"\b{name}:\s*(\d+)", block))
        return m.group(1).strip() if m else ""

    aus: dict[str, dict] = {}
    for key in re.findall(r"^  ([a-z0-9_]+):\s*\{", teil_de, re.M):
        b_de, b_en = _js_block(teil_de, key), _js_block(teil_en, key)
        eintrag = {f: (feld(b_de, f), feld(b_en, f) or feld(b_de, f))
                   for f in _STECKBRIEF_FELDER}
        if any(w for w, _ in eintrag.values()):
            aus[key] = eintrag
    if not aus:
        log(f"{datei}: kein einziger Steckbrief lesbar – Format geändert? "
            f"Die Kacheln bleiben ohne.")
    return aus


def _logo_chip(platform: Platform, schnappschuss: bool, farbe: str) -> str:
    """Das Plattform-Logo auf der Kachel — das auffälligste Element, das die
    App hat und die Kachel bisher nicht.

    Als ``<img>`` eingebunden, NICHT eingebettet: die elf Bögen wiegen zusammen
    165 KB, WeMove allein 87 KB. Eingebettet vervierfachte das den Pages-
    Schnappschuss, den der Nutzer auf dem Handy öffnet; als Verweis lädt der
    Browser sie einzeln und behält sie im Cache.

    ⚠️ Der Pfad hängt davon ab, WO die Datei liegt: der Schnappschuss landet in
    ``webapp/`` (also neben ``logos/``), die Server-Fassung im Projektwurzel-
    verzeichnis (also eine Ebene darüber). Derselbe Fehler wie bei den
    Listen-Links, nur andersherum.

    ⚠️ Die Bögen tragen teils ``currentColor``. In einem ``<img>`` erbt das
    nichts von der Seite und wird schwarz — auf einer dunklen Kachel also
    unsichtbar. Deshalb sitzt das Logo auf einer FESTEN hellen Fläche, in
    beiden Designs gleich; die Hausfarbe rahmt sie."""
    datei = Path("webapp/logos") / f"{platform.key}.svg"
    if not datei.exists():
        return ""
    pfad = f"logos/{platform.key}.svg" if schnappschuss \
        else f"webapp/logos/{platform.key}.svg"
    rahmen = f'border-color:{_esc(farbe)}' if farbe else ""
    return (f'<span class="plogo" style="{rahmen}">'
            f'<img src="{_esc(pfad)}" alt="" loading="lazy"></span>')


def _steckbrief_teile(key: str, steckbriefe: dict) -> tuple[str, str, str]:
    """(Punktfarbe, Kurzbeschreibung, Steckbriefzeile) für eine Kachel.

    Alles drei zeigt die App längst — die Kachel bisher nicht. Die Punktfarbe
    steht als Inline-Stil im Markup, obwohl Inline-Farben sonst in diesem
    Regelwerk verpönt sind: hier ist die Farbe ein DATENWERT je Plattform, den
    keine Klasse abbilden kann, und sie ist eine Hausfarbe — sie soll sich mit
    dem Dunkelmodus ausdrücklich NICHT ändern."""
    e = steckbriefe.get(key)
    if not e:
        return "", "", ""
    farbe = e["color"][0]
    tl_de, tl_en = e["tagline"]
    tagline = (f'<p class="tagline" data-de="{_esc(tl_de)}" '
               f'data-en="{_esc(tl_en)}">{_esc(tl_de)}</p>') if tl_de else ""

    paare = (("Träger", "Operator", "operator"),
             ("Sitz", "Based in", "seat"),
             ("Gegründet", "Founded", "founded"),
             ("Finanzierung", "Funding", "financing"))
    stuecke_de, stuecke_en = [], []
    for lab_de, lab_en, feld in paare:
        w_de, w_en = e[feld]
        if not w_de:
            continue
        stuecke_de.append(f"{lab_de} {w_de}")
        stuecke_en.append(f"{lab_en} {w_en}")
    zeile = (f'<p class="steckbrief">'
             + _zs(" · ".join(stuecke_de), " · ".join(stuecke_en))
             + "</p>") if stuecke_de else ""
    return farbe, tagline, zeile


def _plattformname(platform: Platform) -> str:
    """Die Überschrift der Kachel.

    Zehn der elf Namen sind Eigennamen und bleiben in jeder Sprache gleich
    (WeAct, Avaaz, foodwatch …). Der Ausreißer ist „Europäisches Parlament" —
    der gehört zum laufenden Auftrag „mehrsprachige Scraper" und wird dort in
    der Plattformdefinition übersetzt, nicht hier. Sobald das Feld ``name_en``
    auftaucht, nimmt die Kachel es von selbst; bis dahin steht in beiden
    Sprachen derselbe Name."""
    name = platform.name
    return _zs(name, getattr(platform, "name_en", "") or name, tag="h2")


def _kachel_rahmen(platform: Platform, schnappschuss: bool,
                   extra_klasse: str = "") -> tuple[str, str, str, str, str]:
    """Hülle und Bedienteile einer Kachel — (auf, zu, Laufpille, Laufbalken,
    Listenknopf).

    Der Unterschied zwischen Server-Ansicht und Pages-Schnappschuss steckt
    ausschließlich hier. Anlass war ein am 8.8.2026 im Browser nachgeklickter
    Fehler: der Schnappschuss verlinkte auf ``<key>_petitions.html``, diese
    Listenseiten liegen aber gar nicht auf Pages — alle elf Kacheln führten auf
    GitHubs 404-Seite, von der aus nur die Zurück-Taste zurückführt. Sie
    mitzukopieren ist keine Lösung: die elf Dateien wiegen zusammen rund 45 MB
    (bundestag allein 22) und lägen als Assets in JEDER APK, weil
    ``build.gradle`` den ganzen ``webapp``-Ordner einbindet.

    Ohne Server sind Laufpille und Fortschrittsbalken ebenfalls sinnlos: sie
    werden nur von ``/status`` befüllt, das es dort nicht gibt."""
    if schnappschuss:
        return (f'<div class="card{extra_klasse}" '
                f'data-platform="{_esc(platform.key)}">',
                "</div>", "", "", "")
    return (f'<a class="card{extra_klasse}" href="{platform.html_file.name}" '
            f'data-platform="{_esc(platform.key)}">',
            "</a>",
            _zs("läuft …", "running …", klasse="run-pill"),
            '<div class="mini-progress">'
            '<div class="mini-progress__bar">'
            '<div class="mini-progress__fill"></div></div>'
            '<span class="mini-progress__text"></span></div>',
            _zs("Zur Liste →", "View list →", klasse="card-btn"))


def _live_card(platform: Platform, schnappschuss: bool = False,
               steckbriefe: dict | None = None) -> str:
    store = load_store(platform.data_file)
    online = sum(1 for r in store.values() if r.get("status", "online") == "online")
    offline = len(store) - online
    meta = load_meta(platform.data_file)
    new_count = len(meta.get("new_petitions_last_run", []))
    cat_count = len(meta.get("categories", {}))
    generated = meta.get("generated_at")
    cats = str(cat_count) if cat_count else "—"

    # Wie viele der bei der Entdeckung gefundenen Kandidaten (Feld "available")
    # stecken schon im Store? Zeigt z. B. den großen Change.org-Rückstand.
    # Ohne "available" (Altbestand vor diesem Feature) Rückfall auf 100 %.
    #
    # ⚠️ Das hieß bis zum 8.8.2026 „Vollständigkeit", und das war eine falsche
    # Auskunft: verglichen wird mit dem, was DIESER LAUF gefunden hat, nicht
    # mit dem Bestand der Quelle. Bei zehn von elf Plattformen setzt „available"
    # der Lauf selbst — der Balken stand also zwangsläufig auf 100 %, egal wie
    # viel die Quelle wirklich führt. Sichtbar wurde der Unsinn an WeAct:
    # „1899 von ~1879 entdeckten · vollständig", also mehr als alles. Nur
    # innn.it nennt eine echte Quell-Gesamtzahl (API-totalCount); zwei
    # Gegenproben am 3.8.2026: innn.it 2.040 Quelle / 2.045 bei uns, Europarl
    # 100 / 98. Wer echte Vollständigkeit wissen will, muss die Quellzahl je
    # Plattform holen — bis dahin sagt der Balken, was er kann: abgearbeitet.
    # ⚠️⚠️ 24.8.2026: der Rückfall „available or len(store)" war eine
    # FALSCHAUSKUNFT, und zwar in den beiden Fällen, in denen die Kachel
    # gebraucht wird:
    #   · available FEHLT      → der Lauf ist vor seinem Abschluss-Save
    #     abgebrochen (save_store baut das _meta bei jedem Schreiben neu auf).
    #     Change.org zeigte so „2067 von ~2067 · alle gefundenen abgearbeitet",
    #     obwohl es die Entdeckung nie erreicht hatte.
    #   · available ist 0      → die Entdeckung hat nichts gefunden, weil der
    #     Host ausgelassen wurde (robots.txt nicht lesbar) oder der Zweig tot
    #     ist. openPetition zeigte so „2031 von ~2031", ohne dass von dort ein
    #     einziger frischer Satz kam. 0 ist falsy und lief in denselben
    #     Rückfall.
    # Beides sah wie Vollständigkeit aus. Es ist aber „wir wissen es nicht" —
    # und das muss dranstehen, sonst versteckt die Kachel genau den Ausfall,
    # den sie melden soll. Zwei Wochen Stillstand sind so unbemerkt geblieben.
    available = meta.get("available")
    if not available:
        pct = 0
        comp_cls = "unbekannt"
        comp_wert, comp_wert_en = "—", "—"
        if "available" in meta:
            # 0 gefunden: die Quelle wurde erreicht, hat aber nichts geliefert.
            comp_sub = (f"{len(store)} im Bestand · die Entdeckung fand in "
                        f"diesem Lauf NICHTS – Quelle ausgelassen oder Zweig "
                        f"ausgefallen; die Zahlen stammen aus früheren Läufen")
            comp_sub_en = (f"{len(store)} on record · discovery found NOTHING "
                           f"in this run – source skipped or branch broken; "
                           f"the numbers are from earlier runs")
        else:
            comp_sub = (f"{len(store)} im Bestand · der Lauf ist vor seinem "
                        f"Abschluss abgebrochen, wie viele Kandidaten es gibt "
                        f"ist unbekannt")
            comp_sub_en = (f"{len(store)} on record · the run was cut off "
                           f"before finishing, the number of candidates is "
                           f"unknown")
    elif available < len(store):
        # ⚠️ „1906 von ~1871 gefundenen Kandidaten" ist arithmetisch unmöglich
        # und las sich, als nenne die Zahl hinter dem ~ den Gesamtbestand der
        # QUELLE. Sie nennt aber nur, was DIESER Lauf gesehen hat — und das ist
        # bei mehreren Plattformen von Haus aus weniger als unser Bestand:
        #   · bundestag: der Tageslauf entdeckt nur die laufende Mitzeichnungs-
        #     frist (57), die 7.903 beendeten stammen aus --backfill.
        #   · avaaz: nur die ~10 verlinkten, der Rest kam aus dem Archiv.
        #   · weact/openpetition: offline gegangene Sätze fallen aus der Liste,
        #     bleiben aber im Bestand stehen.
        # Ein Anteil lässt sich daraus nicht bilden. Was man sagen kann, ist:
        # es liegt nichts in der Warteschlange — deshalb bleibt es grün.
        pct = 100
        comp_cls = "full"
        comp_wert = comp_wert_en = "100%"
        comp_sub = (f"alle {available} in diesem Lauf gefundenen Kandidaten "
                    f"sind im Bestand · der Bestand ({len(store)}) ist größer "
                    f"als das, was dieser Lauf gesehen hat")
        comp_sub_en = (f"all {available} candidates found in this run are on "
                       f"record · the record ({len(store)}) is larger than "
                       f"what this run saw")
    else:
        pct = min(100, round(len(store) / available * 100))
        comp_wert, comp_wert_en = f"{pct}%", f"{pct}%"
        comp_cls, comp_lbl, comp_lbl_en = (
            ("full", "alle gefundenen abgearbeitet", "all found items processed")
            if pct >= 95 else
            ("grow", "Rückstand", "backlog") if pct >= 50 else
            ("low", "großer Rückstand", "large backlog"))
        comp_sub = (f"{len(store)} von ~{available} gefundenen Kandidaten "
                    f"· {comp_lbl}")
        comp_sub_en = (f"{len(store)} of ~{available} discovered candidates "
                       f"· {comp_lbl_en}")

    # Einbruch des Online-Bestands = fast immer ein Quellenproblem, kein echtes
    # Verschwinden der Petitionen (siehe save_store).
    # Selbstmeldung des letzten Laufs. Warnungen zuerst und rot; darunter der
    # stille Dauerzustand, damit man ihn beim Suchen findet, ohne dass er die
    # frische Warnung überstrahlt (siehe Abschnitt „Selbstmeldung der Scraper").
    # Warnungen rot, Hinweise leise — aber BEIDE sichtbar. Bis zum 8.8.2026
    # zeigte die Kachel nur „warnung"; die Stufe „hinweis" war zwar in befund()
    # dokumentiert, wurde aber nirgends gerendert und tauchte auch im CI nicht
    # auf. Ein Meldeweg, der nichts meldet, ist schlimmer als keiner: er lädt
    # dazu ein, etwas hineinzuschreiben, das nie jemand liest.
    def _befund_html(b: dict, klasse: str, zeichen: str) -> str:
        # thema_en/text_en tragen Befunde erst seit dem 8.8.2026. Ältere
        # Bestände fallen auf Deutsch zurück — sichtbar unübersetzt statt leer,
        # und nach einem Lauf ist es von selbst behoben.
        thema = b.get("thema") or ""
        text = b.get("text") or ""
        thema_en = b.get("thema_en") or thema
        text_en = b.get("text_en") or text
        kopf = _zs(f"{zeichen} {thema}", f"{zeichen} {thema_en}", tag="b")
        return f'<div class="{klasse}">{kopf}{_zs(text, text_en)}</div>'

    befunde = meta.get("befunde")
    if befunde:
        warn_html = "".join(_befund_html(b, "healthwarn", "⚠")
                            for b in befunde if b.get("stufe") == "warnung")
        warn_html += "".join(_befund_html(b, "healthinfo", "ℹ")
                             for b in befunde if b.get("stufe") == "hinweis")
    else:
        # Bestände von vor der Selbstmeldung tragen nur das alte Einzelfeld.
        warning = meta.get("health_warning")
        warn_html = (f'<div class="healthwarn">⚠ {_esc(warning)}</div>'
                     if warning else "")

    kz = meta.get("kennzahlen") or {}
    dauer = []
    # Gemeldet wird die AUSWIRKUNG, nicht das Symptom: „13 ohne Titel" ließ
    # niemanden ahnen, dass in Wahrheit 54 Sätze in der App fehlen. Die Arten
    # stehen dahinter in Klammern, aber die erste Zahl ist die, die zählt.
    # Bestände von vor dieser Kennzahl tragen nur ohne_titel — dann gilt die.
    dauer_en = []
    fehlt = kz.get("nicht_ausgeliefert")
    if fehlt is None:
        fehlt = kz.get("ohne_titel") or 0
    if fehlt:
        gesamt_kz = kz.get("gesamt") or "?"
        anteil = round(fehlt / max(1, kz.get("gesamt") or 1) * 100)
        arten = []
        if kz.get("ohne_titel"):
            arten.append(("ohne Titel", "without a title", kz["ohne_titel"]))
        if kz.get("platzhalter"):
            arten.append(("Platzhaltertitel", "placeholder titles",
                          kz["platzhalter"]))
        if len(arten) > 1:
            auf = " (" + ", ".join(f"{n} {w}" for w, _e, n in arten) + ")"
            auf_en = " (" + ", ".join(f"{n} {e}" for _w, e, n in arten) + ")"
        elif arten:
            auf, auf_en = f" ({arten[0][0]})", f" ({arten[0][1]})"
        else:
            auf = auf_en = ""
        pz = f" – {anteil} %" if anteil >= 1 else ""
        dauer.append(f"{fehlt} von {gesamt_kz} erreichen die App nicht{pz}{auf}")
        dauer_en.append(f"{fehlt} of {gesamt_kz} never reach the app{pz}{auf_en}")
    if kz.get("torsi"):
        dauer.append(f"{kz['torsi']} abgeschnittene Adresse(n) entfernt")
        dauer_en.append(f"{kz['torsi']} truncated address(es) removed")
    if dauer:
        warn_html += '<div class="healthnote">' + _zs(
            "Dauerzustand: " + " · ".join(dauer),
            "Steady state: " + " · ".join(dauer_en)) + "</div>"

    auf, zu, pille, balken, knopf = _kachel_rahmen(platform, schnappschuss)
    stand = _fmt_dt(generated) if generated else "—"
    farbe, tagline, steckbrief = _steckbrief_teile(platform.key,
                                                   steckbriefe or {})
    punkt = _logo_chip(platform, schnappschuss, farbe) or (
        f'<span class="card-dot" style="background:{_esc(farbe)}"></span>'
        if farbe else '<span class="card-dot weact"></span>')

    return f"""
    {auf}
      <div class="card-head">{punkt}{_plattformname(platform)}
        {pille}</div>
      {tagline}
      {_openness_badge(platform)}
      <div class="card-stats">
        <div class="cs"><div class="n">{len(store)}</div>{_zs("Petitionen", "Petitions", klasse="l", tag="div")}</div>
        <div class="cs"><div class="n">{online}</div>{_zs("Online", "Online", klasse="l", tag="div")}</div>
        <div class="cs"><div class="n">{offline}</div>{_zs("Offline", "Offline", klasse="l", tag="div")}</div>
        <div class="cs"><div class="n">{cats}</div>{_zs("Kategorien", "Categories", klasse="l", tag="div")}</div>
      </div>
      <div class="completeness {comp_cls}">
        <div class="completeness__head">{_zs("Abgearbeitet", "Processed")}
          {_zs(comp_wert, comp_wert_en, tag="b")}</div>
        <div class="completeness__bar"><div class="completeness__fill" style="width:{pct}%"></div></div>
        {_zs(comp_sub, comp_sub_en, klasse="completeness__sub")}
      </div>
      {warn_html}
      {steckbrief}
      {balken}
      <p class="card-sub">{_zs(
          f"{new_count} neue Petition(en) im letzten Lauf · Datenstand {stand}",
          f"{new_count} new petition(s) in the last run · data as of {stand}")}</p>
      {knopf}
    {zu}"""


def _placeholder_card(platform: Platform, schnappschuss: bool = False) -> str:
    auf, zu, _pille, _balken, knopf = _kachel_rahmen(platform, schnappschuss,
                                                     extra_klasse=" placeholder")
    return f"""
    {auf}
      <div class="card-head"><span class="card-dot other"></span>{_plattformname(platform)}</div>
      {_openness_badge(platform)}
      <div class="card-stats">
        <div class="cs"><div class="n">—</div>{_zs("Petitionen", "Petitions", klasse="l", tag="div")}</div>
        <div class="cs"><div class="n">—</div>{_zs("Online", "Online", klasse="l", tag="div")}</div>
        <div class="cs"><div class="n">—</div>{_zs("Offline", "Offline", klasse="l", tag="div")}</div>
        <div class="cs"><div class="n">—</div>{_zs("Kategorien", "Categories", klasse="l", tag="div")}</div>
      </div>
      <p class="card-sub">{_zs("Noch keine Daten – Scraper in Vorbereitung.",
                               "No data yet – scraper in preparation.")}</p>
      {knopf}
    {zu}"""


def _i18n_einsetzen(tmpl: str) -> str:
    """Die drei gemeinsamen Bausteine der Zweisprachigkeit in eine Vorlage
    setzen: Wähler, Stil, Skript. Jede Seite, die {{LANGSEL}}, {{LANGCSS}} und
    {{I18N}} enthält, ist damit umschaltbar."""
    return (tmpl.replace("{{LANGSEL}}", _THEMESEL + "\n    " + _LANGSEL)
                .replace("{{LANGCSS}}", _LANGSEL_CSS)
                .replace("{{FARBEN}}", _farben_css())
                .replace("{{I18N}}", _I18N_SCRIPT))


def build_dashboard(platforms: list[Platform], schnappschuss: bool = False) -> str:
    """Das Dashboard in zwei Ausprägungen aus EINER Vorlage.

    Vorgabe ist die Server-Ansicht (``monitor.py --serve``). Mit
    ``schnappschuss=True`` entsteht die Fassung für GitHub Pages: dort gibt es
    keinen Server, also auch nichts zu bedienen — siehe ``_kachel_rahmen``.

    ZWEISPRACHIG: jeder übersetzbare Knoten trägt data-de/data-en, der
    Umschalter oben rechts tauscht nur textContent. Siehe ``_zs``.

    GEMESSENE KONTRASTE (8.8.2026, WCAG-Verhältnis hell / dunkel). Ziel ist
    4,5:1, denn die kleinste Schrift der Seite (.amp-label, 11px fett) zählt
    als Kleintext — die 3:1-Ausnahme gilt erst ab 18,66px fett:

        Fließtext auf Kachel     17,43 / 13,86   Warnschrift im Kasten  7,15 / 9,59
        Fließtext auf Grund      15,27 / 15,17   Hinweisschrift         7,85 / 9,43
        Gedämpft auf Kachel       5,80 /  6,63   Online-Zahl            5,32 / 7,54
        Gedämpft auf Grund        5,08 /  7,26   Offline-Zahl           5,86 / 6,74
        Akzentschrift             9,65 /  7,24   Ampel 5                5,32 / 7,75
        Knopfschrift auf Akzent   9,65 /  7,92   Ampel 4                4,54 / 9,53
                                                 Ampel 3                4,50 / 9,24
                                                 Ampel 2                4,50 / 7,53
                                                 Ampel 1                5,86 / 6,74

    Warn- und Hinweiskasten sind zusätzlich am gerenderten Pixel nachgemessen
    (getComputedStyle im Headless, beide Modi): 7,15/9,59 und 7,85/9,43 —
    Rechnung und Browser kommen auf dieselben Werte."""
    steckbriefe = _app_steckbriefe()
    cards = "\n".join(
        _live_card(p, schnappschuss, steckbriefe) if p.is_live
        else _placeholder_card(p, schnappschuss) for p in platforms)
    tmpl = _DASHBOARD_TEMPLATE
    tmpl = tmpl.replace("{{MODUS}}", ' data-modus="schnappschuss"'
                        if schnappschuss else "")
    tmpl = tmpl.replace("{{SUBNOTE}}", _SUB_SCHNAPPSCHUSS if schnappschuss
                        else _SUB_SERVER)
    tmpl = tmpl.replace("{{RUNALL}}", "" if schnappschuss else _RUNALL_ROW)
    tmpl = _i18n_einsetzen(tmpl)
    for platzhalter, inhalt in _I18N_BLOECKE.items():
        tmpl = tmpl.replace(platzhalter, inhalt)
    tmpl = tmpl.replace("{{GENERATED}}", _esc(now_iso()))
    tmpl = tmpl.replace("{{CARDS}}", cards)
    tmpl = tmpl.replace("{{TOTOP}}", _TOTOP)
    return tmpl


def write_dashboard(platforms: list[Platform], ziel: Path | None = None,
                    schnappschuss: bool = False) -> None:
    datei = ziel or DASHBOARD_FILE
    datei.write_text(build_dashboard(platforms, schnappschuss),
                     encoding="utf-8")
    log(f"{datei} geschrieben{' (Schnappschuss)' if schnappschuss else ''}.")


def build_placeholder_page(platform: Platform) -> str:
    tmpl = _PLACEHOLDER_TEMPLATE
    tmpl = tmpl.replace("{{PH_TEXT}}", _zs(
        f"Für {platform.name} gibt es noch keinen Scraper und keine Daten. "
        f"Dieser Bereich ist als Platzhalter für die geplante Anbindung angelegt.",
        f"There is no scraper and no data for {platform.name} yet. This page is "
        f"a placeholder for the planned connection."))
    tmpl = tmpl.replace("{{PH_SOURCE}}", _zs("Quelle:", "Source:"))
    tmpl = tmpl.replace("{{PH_STAND}}", _zs("Datenstand dieser Seite:",
                                            "This page is current as of:"))
    tmpl = tmpl.replace("{{BACK}}", _LIST_I18N_BLOECKE["{{BACK}}"])
    tmpl = _i18n_einsetzen(tmpl)
    tmpl = tmpl.replace("{{NAME}}", _esc(platform.name))
    tmpl = tmpl.replace("{{SOURCE_URL}}", _esc(platform.source_url))
    tmpl = tmpl.replace("{{GENERATED}}", _esc(now_iso()))
    return tmpl


def write_placeholder_pages(platforms: list[Platform]) -> None:
    names = []
    for p in platforms:
        if not p.is_live:
            p.html_file.write_text(build_placeholder_page(p), encoding="utf-8")
            names.append(p.name)
    if names:
        log(f"Platzhalter-Seiten geschrieben ({', '.join(names)}).")


# Kopfzeile und Bedienleiste unterscheiden sich zwischen den beiden Fassungen
# (siehe build_dashboard). Der Schnappschuss sagt ausdrücklich, dass er nur
# liest — vorher versprach er „Wähle eine Plattform für die Detailliste" und
# löste das Versprechen mit elf 404-Seiten ein. Der Weg weiter führt dort in
# die App, die im selben Ordner liegt (relativ, damit es lokal wie auf Pages
# stimmt).
_SUB_SERVER = _zs("Wähle eine Plattform für die Detailliste.",
                  "Pick a platform to see its detailed list.")
_SUB_SCHNAPPSCHUSS = (
    _zs("Nur-Lesen-Schnappschuss des letzten Laufs — die Detaillisten und die "
        "Scraper-Steuerung gibt es nur im lokalen Monitor.",
        "Read-only snapshot of the last run — detailed lists and scraper "
        "controls exist only in the local monitor.")
    + ' ' + _zs("Zur App →", "Open the app →", tag="a", klasse="sub-link",
                attrs=' href="./"'))
# Der Sprachwähler sitzt oben rechts, weil ihn dort jeder sucht. Als
# `role="group"` mit `aria-pressed` statt als <select>: zwei Sprachen sind mit
# einem Griff erreichbar, ein Auswahlfeld bräuchte zwei. Die Beschriftungen
# stehen bewusst in der JEWEILIGEN Sprache („Deutsch"/„English") und werden
# NICHT mitübersetzt — wer die aktuelle Sprache nicht versteht, muss seine
# eigene trotzdem finden.
# Oben rechts stehen zwei Umschalter nebeneinander: Design und Sprache. Beide
# als Zweiergruppe mit `aria-pressed`, damit sie sich gleich anfühlen und die
# Tastatur beide gleich bedient. Die Designknöpfe tragen Symbole statt Wörtern —
# ☀/☾ braucht keine Übersetzung und keine Breite.
_THEMESEL = """<div class="langsel themesel" role="group"
         aria-label="Design / Appearance">
      <button type="button" class="langsel__b" data-theme-set="light"
              aria-pressed="true" data-de="Hell" data-en="Light"
              data-titel="1" title="Hell"><span aria-hidden="true">☀</span></button>
      <button type="button" class="langsel__b" data-theme-set="dark"
              aria-pressed="false" data-de="Dunkel" data-en="Dark"
              data-titel="1" title="Dunkel"><span aria-hidden="true">☾</span></button>
    </div>"""

_LANGSEL = """<div class="langsel" role="group" aria-label="Sprache · Language">
      <button type="button" class="langsel__b" data-lang="de" lang="de"
              aria-pressed="true">Deutsch</button>
      <button type="button" class="langsel__b" data-lang="en" lang="en"
              aria-pressed="false">English</button>
    </div>"""

# Das Umschalt-Skript. Steht als Konstante hier, weil es Dashboard UND
# Listenseiten bedient — zweimal derselbe Code wäre zweimal Gelegenheit,
# ihn auseinanderlaufen zu lassen. Der Seitentitel kommt aus
# data-title-de/-en am <html>, damit jede Seite ihren eigenen mitbringt.
# Stil des Sprachwählers samt Fokusring. Wie das Skript geteilt, damit
# Dashboard und Listenseiten gleich aussehen und gleich bedienbar sind.
_LANGSEL_CSS = """  /* Kopfzeile: Rubrik links, Sprachwähler rechts. */
  .head-top{display:flex;align-items:flex-start;justify-content:space-between;
      gap:16px;flex-wrap:wrap}
  .langsel{display:inline-flex;border:1px solid var(--line);border-radius:8px;
      overflow:hidden;background:var(--surface);flex:none}
  .langsel__b{appearance:none;border:0;background:transparent;cursor:pointer;
      font:inherit;font-size:12px;font-weight:650;color:var(--muted);
      padding:6px 12px;min-height:32px;line-height:1}
  .langsel__b + .langsel__b{border-left:1px solid var(--line)}
  .langsel__b[aria-pressed="true"]{background:var(--indigo);color:var(--on-accent)}
  .langsel__b:hover:not([aria-pressed="true"]){background:var(--indigo-soft);
      color:var(--indigo)}
  /* Die beiden Leisten sitzen nebeneinander und dürfen auf schmalen Schirmen
     umbrechen, ohne die Rubrikzeile mitzureißen. */
  .head-top{gap:10px}
  .themesel .langsel__b{font-size:14px;padding:6px 10px;line-height:1}
  /* Tastaturbedienung sichtbar machen. :focus-visible statt :focus, damit der
     Ring nur bei Tastatur erscheint und nicht nach jedem Mausklick. */
  a:focus-visible,button:focus-visible{outline:2px solid var(--indigo);
      outline-offset:2px;border-radius:6px}"""


_I18N_SCRIPT = """<script>
// Sprachumschaltung. Steht bewusst HIER — direkt hinter dem Inhalt und nicht
// am Dateiende: an dieser Stelle existieren alle [data-de]-Knoten schon, das
// Skript läuft während des Parsens und tauscht die Texte in aller Regel vor
// dem ersten Bild. Am Dateiende (nach dem Status-Skript) sähe man erst Deutsch
// und dann den Sprung.
// Laufzeit-Meldungen („läuft …", „Kein Server erreichbar.") entstehen erst beim
// Anzeigen und können deshalb nicht als data-de/data-en im Markup stehen. Dafür
// dieser Zwerg: er liest die Sprache dort ab, wo der Umschalter sie hinschreibt.
window.PM_T = function(de, en){
  return document.documentElement.getAttribute("lang") === "en" ? en : de;
};

// Hell/Dunkel. Ohne gespeicherte Wahl steht KEIN data-theme am <html> — dann
// gilt die Systemeinstellung über die Medienabfrage im Farbsatz. Erst ein
// Klick schreibt die Wahl fest; sie überstimmt das System dann in beide
// Richtungen (deshalb im CSS das :not([data-theme="light"]) an der Systemregel).
(function(){
  var SPEICHER = "pmDashTheme";

  function aktiv(){
    var gesetzt = document.documentElement.getAttribute("data-theme");
    if (gesetzt) return gesetzt;
    return (window.matchMedia
            && window.matchMedia("(prefers-color-scheme: dark)").matches)
           ? "dark" : "light";
  }

  function knoepfeStellen(){
    var jetzt = aktiv();
    var b = document.querySelectorAll("[data-theme-set]");
    for (var i = 0; i < b.length; i++){
      b[i].setAttribute("aria-pressed",
        b[i].getAttribute("data-theme-set") === jetzt ? "true" : "false");
    }
  }

  try {
    var w = localStorage.getItem(SPEICHER);
    if (w === "light" || w === "dark")
      document.documentElement.setAttribute("data-theme", w);
  } catch (e) {}
  knoepfeStellen();

  document.addEventListener("click", function(ev){
    var b = ev.target.closest ? ev.target.closest("[data-theme-set]") : null;
    if (!b) return;
    var wahl = b.getAttribute("data-theme-set");
    document.documentElement.setAttribute("data-theme", wahl);
    try { localStorage.setItem(SPEICHER, wahl); } catch (e) {}
    knoepfeStellen();
  });

  // Ohne eigene Wahl folgt die Seite dem System auch WÄHREND sie offen ist.
  if (window.matchMedia){
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var reagieren = function(){
      if (!document.documentElement.getAttribute("data-theme")) knoepfeStellen();
    };
    if (mq.addEventListener) mq.addEventListener("change", reagieren);
    else if (mq.addListener) mq.addListener(reagieren);
  }
})();

(function(){
  var SPRACHEN = ["de", "en"];
  var SPEICHER = "pmDashLang";

  function systemSprache(){
    var liste = (navigator.languages && navigator.languages.length)
                ? navigator.languages : [navigator.language || "de"];
    for (var i = 0; i < liste.length; i++){
      var kurz = String(liste[i] || "").toLowerCase().split("-")[0];
      if (SPRACHEN.indexOf(kurz) !== -1) return kurz;
    }
    return "de";
  }

  function gewaehlt(){
    try {
      var eigen = localStorage.getItem(SPEICHER);
      if (SPRACHEN.indexOf(eigen) !== -1) return eigen;
      // Auf GitHub Pages liegt die App unter derselben Herkunft. Wer dort
      // Englisch gewählt hat, soll das Dashboard nicht auf Deutsch bekommen.
      // Geschrieben wird prefs NICHT — eine Statusseite verstellt nichts.
      var p = JSON.parse(localStorage.getItem("prefs") || "{}");
      if (p && SPRACHEN.indexOf(p.lang) !== -1) return p.lang;
    } catch (e) {}
    return systemSprache();
  }

  function setze(lang){
    var knoten = document.querySelectorAll("[data-de]");
    for (var i = 0; i < knoten.length; i++){
      var el = knoten[i];
      var txt = el.getAttribute("data-" + lang) || el.getAttribute("data-de");
      // Knoten mit data-titel tragen ihren Text im Tooltip, nicht im Inhalt.
      if (el.getAttribute("data-titel")) el.setAttribute("title", txt);
      else el.textContent = txt;
    }
    // Eingabefelder tragen ihren Text im placeholder — der ist kein Inhalt und
    // fiele bei textContent unter den Tisch.
    var felder = document.querySelectorAll("[data-ph-de]");
    for (var f = 0; f < felder.length; f++){
      felder[f].setAttribute("placeholder",
        felder[f].getAttribute("data-ph-" + lang)
        || felder[f].getAttribute("data-ph-de"));
    }
    document.documentElement.setAttribute("lang", lang);
    var wurzel = document.documentElement;
    var t = wurzel.getAttribute("data-title-" + lang)
            || wurzel.getAttribute("data-title-de");
    if (t) document.title = t;
    // ⚠️ NUR die Sprachknöpfe. Vorher stand hier ".langsel__b", und weil die
    // Designknöpfe dieselbe Klasse tragen (damit sie gleich aussehen), aber
    // kein data-lang, verglich der Ausdruck `null === lang` — beide wurden bei
    // JEDEM Sprachwechsel auf „nicht gedrückt" gesetzt. Da dieses Skript nach
    // dem Design-Skript läuft, war der Design-Umschalter schon beim Laden ohne
    // aktiven Zustand.
    var knoepfe = document.querySelectorAll(".langsel__b[data-lang]");
    for (var j = 0; j < knoepfe.length; j++){
      knoepfe[j].setAttribute("aria-pressed",
        knoepfe[j].getAttribute("data-lang") === lang ? "true" : "false");
    }
  }

  var aktuell = gewaehlt();
  setze(aktuell);

  document.addEventListener("click", function(ev){
    // ⚠️ Auch hier NUR die Sprachknöpfe. Ohne [data-lang] fing dieser Fänger
    // die Klicks auf die Designknöpfe mit (gleiche Klasse), las deren
    // data-lang als null und rief setze(null) — das schrieb lang="null" ans
    // <html> und löschte den aktiven Zustand der Sprachwahl. Erst beim
    // Nachmessen aufgefallen: „Dunkel" anklicken machte die Sprache leer.
    var b = ev.target.closest ? ev.target.closest(".langsel__b[data-lang]") : null;
    if (!b) return;
    aktuell = b.getAttribute("data-lang");
    try { localStorage.setItem(SPEICHER, aktuell); } catch (e) {}
    setze(aktuell);
  });
})();
</script>
"""


# Textbausteine der Listenseite. Gleicher Mechanismus wie beim Dashboard: der
# Knoten trägt beide Sprachen, der gemeinsame Umschalter tauscht den Inhalt.
# „Online", „Offline", „Status" und „Start" stehen mit drin, obwohl sie gleich
# lauten — sonst müsste man beim Lesen jedes Mal prüfen, ob eine Beschriftung
# vergessen wurde oder nur zufällig in beiden Sprachen gleich heißt.
_LIST_I18N_BLOECKE = {
    "{{BACK}}": _zs("← Dashboard", "← Dashboard"),
    "{{H1}}": _zs("Petitions-Monitor", "Petition Monitor", tag="h1"),
    "{{STANDLABEL}}": _zs("Datenstand", "Data as of"),
    "{{LISTSUB}}": _zs(
        "Lokal gescrapte Übersicht. Status zeigt, ob eine Petition beim letzten "
        "Lauf noch erreichbar war.",
        "Locally scraped overview. Status shows whether a petition was still "
        "reachable during the last run."),
    "{{L_PETITIONS}}": _zs("Petitionen", "Petitions", tag="div", klasse="l"),
    "{{L_ONLINE}}": _zs("Online", "Online", tag="div", klasse="l"),
    "{{L_OFFLINE}}": _zs("Offline", "Offline", tag="div", klasse="l"),
    "{{L_NEW}}": _zs("Neu (letzter Lauf)", "New (last run)", tag="div",
                     klasse="l"),
    "{{RUNNOW}}": _zs("Jetzt scrapen", "Scrape now"),
    "{{F_ALL}}": _zs("Alle", "All"),
    "{{F_ONLINE}}": _zs("Online", "Online"),
    "{{F_OFFLINE}}": _zs("Offline", "Offline"),
    "{{F_ALLCATS}}": _zs("Alle Kategorien", "All categories"),
    "{{TH_IMG}}": _zs("Bild", "Image"),
    "{{TH_STATUS}}": _zs("Status", "Status"),
    "{{TH_TITLE}}": _zs("Titel", "Title"),
    "{{TH_STARTER}}": _zs("Gestartet von", "Started by"),
    "{{TH_CATEGORY}}": _zs("Kategorie", "Category"),
    "{{TH_SIGS}}": _zs("Unterschriften", "Signatures"),
    "{{TH_START}}": _zs("Start", "Start"),
    "{{TH_CHECKED}}": _zs("Zuletzt geprüft", "Last checked"),
    "{{FOOTER}}": _zs(
        "Erzeugt vom Petitions-Monitor · Daten werden bei jedem Lauf "
        "aktualisiert, nicht überschrieben.",
        "Generated by the Petition Monitor · data is updated on every run, "
        "not overwritten."),
}

_I18N_BLOECKE = {
    "{{EYEBROW}}": _zs("Petitions-Monitor — Dashboard",
                       "Petition Monitor — Dashboard", tag="p",
                       klasse="eyebrow"),
    "{{H1}}": _zs("Übersicht", "Overview", tag="h1"),
    "{{STANDLABEL}}": _zs("Datenstand", "Data as of"),
    "{{LEGENDTITLE}}": _zs("Ampel — Datenfreigabe:", "Traffic light — data access:",
                           tag="b"),
    "{{LG5}}": _zs("sehr offen (volle Liste, alles im HTML)",
                   "very open (full list, everything in the HTML)"),
    "{{LG4}}": _zs("offen (volle Liste, kleine Hürden)",
                   "open (full list, minor hurdles)"),
    "{{LG3}}": _zs("mittel (begrenzte Listen/Extra-Endpoints)",
                   "moderate (limited lists / extra endpoints)"),
    "{{LG2}}": _zs("eingeschränkt (nur kuratierte Auswahl/Heuristik)",
                   "restricted (curated selection / heuristics only)"),
    "{{LG1}}": _zs("verschlossen (keine öffentliche Liste/Blockade)",
                   "closed (no public list / blocked)"),
    "{{LEGENDNOTE}}": (
        _zs("„Abgearbeitet“", "“Processed”", tag="b") + " " +
        _zs("vergleicht den Bestand mit dem, was derselbe Lauf gefunden hat — "
            "nicht mit dem Gesamtbestand der Quelle. Eine echte Quell-Gesamtzahl "
            "nennt bislang nur innn.it. 100 % heißt also: nichts liegt in der "
            "Warteschlange, nicht: wir haben alles.",
            "compares what we hold against what the same run discovered — not "
            "against everything the source carries. So far only innn.it reports "
            "a real source total. So 100% means nothing is queued, not that we "
            "have it all.")),
}

_RUNALL_ROW = f"""<div class="runall-row">
    <button id="run-all" class="runall-btn" type="button">
      <span class="sp"></span>{_zs("Alle Scraper starten", "Run all scrapers")}</button>
    <span class="runall-status" id="run-all-status"></span>
  </div>"""

_DASHBOARD_TEMPLATE = """<!DOCTYPE html>
<html lang="de"{{MODUS}}
      data-title-de="Petitions-Monitor · Dashboard"
      data-title-en="Petition Monitor · Dashboard">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Petitions-Monitor · Dashboard</title>
<style>
{{FARBEN}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
       font-size:14px;line-height:1.45}
  header{background:var(--surface);border-bottom:2px solid var(--ink);
         padding:22px clamp(16px,4vw,40px)}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.18em;
           text-transform:uppercase;color:var(--indigo);margin:0 0 6px}
  h1{margin:0;font-size:clamp(20px,3vw,28px);font-weight:800;letter-spacing:-.01em}
  .sub{color:var(--muted);margin-top:4px}
  main{padding:clamp(16px,4vw,40px)}
  /* Volle Breite (8.8.2026). Vorher deckelte max-width:1320px das Raster: auf
     einem 2560er Schirm standen drei Kacheln und rechts daneben nichts. Der
     Deckel ist weg, dafür wächst die Mindestbreite der Spalte von 280 auf
     320px — sonst entstehen bei voller Breite sehr viele sehr schmale
     Kacheln, in denen „26 Petitionen" umbricht (dieselbe Enge, die im
     Magazin-Layout die 13.5rem-Zeilenhöhe nötig machte). Gemessen: 1280px
     ergibt 3 Spalten, 1920px 5, 2560px 7. */
  .grid{display:grid;gap:20px;
        grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  .card{display:block;background:var(--surface);border:1px solid var(--line);
        border-radius:14px;padding:20px;text-decoration:none;color:inherit;
        transition:box-shadow .15s,transform .15s}
  /* Nur die verlinkte Kachel darf sich beim Überfahren heben. Im
     Schnappschuss ist die Kachel ein div ohne Ziel — dort wäre die Bewegung
     ein Versprechen, das kein Klick einlöst. */
  a.card:hover{box-shadow:0 6px 20px rgba(22,26,34,.1);transform:translateY(-2px)}
  .sub-link{color:var(--indigo);font-weight:650}
  .card-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .card-dot{width:12px;height:12px;border-radius:50%;display:inline-block}
  .card-dot.weact{background:var(--indigo)}
  .card-dot.other{background:var(--muted)}
  .card-head h2{margin:0;font-size:18px}
  /* Kurzbeschreibung und Steckbrief — beides steht in der App unter „Über
     diese Plattform" und fehlte auf der Kachel. Der Steckbrief sitzt unten
     und abgesetzt: er ändert sich fast nie, die Zahlen darüber täglich. */
  /* Feste helle Fläche unter dem Logo: die Bögen tragen teils currentColor,
     das in einem <img> zu Schwarz wird — auf dunkler Kachel unsichtbar. */
  /* Feste helle Fläche unter dem Logo: die Bögen tragen teils currentColor,
     das in einem <img> zu Schwarz wird — auf dunkler Kachel unsichtbar.
     ⚠️ Die Maße sind ABSICHTLICH ganzzahlig und am Bild wie am Rahmen fest
     gesetzt. Mit `max-width:100%` ergab sich die Bildgröße aus dem Innenraum
     und war bei einem Seitenverhältnis von 1,423 gebrochen; während der
     Schwebe-Bewegung der Kachel (`translateY(-2px)`) landete der Bogen dann
     jeden Frame auf anderen Gerätepunkten und wurde neu gerastert — das sah
     aus, als wackle das Logo. `translateZ(0)` gibt ihm zusätzlich eine eigene
     Ebene, sodass die Bewegung ihn nur verschiebt statt ihn neu zu zeichnen.
     Größe von 38×26 auf 60×38 — vorher blieben dem Bogen netto 30×18. */
  .plogo{display:inline-flex;align-items:center;justify-content:center;
      width:60px;height:38px;flex:none;background:#ffffff;border-radius:7px;
      border:1px solid var(--line);padding:5px;
      transform:translateZ(0);backface-visibility:hidden}
  .plogo img{width:48px;height:26px;object-fit:contain;display:block}
  .tagline{margin:-8px 0 10px;font-size:12.5px;color:var(--muted)}
  .steckbrief{margin:0 0 12px;padding-top:10px;border-top:1px solid var(--line);
      font-size:11px;line-height:1.5;color:var(--muted)}
  .card-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
  .cs .n{font-family:var(--mono);font-size:20px;font-weight:700}
  .cs .l{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .card-sub{color:var(--muted);font-size:12px;margin:0 0 14px;min-height:2.6em}
  .completeness{margin:0 0 12px}
  .completeness__head{display:flex;justify-content:space-between;align-items:baseline;
    font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
  .completeness__head b{font-family:var(--mono);font-size:15px;color:var(--ink)}
  .completeness__bar{height:7px;background:var(--bg);border-radius:999px;
    overflow:hidden;margin:4px 0 4px}
  .completeness__fill{height:100%;border-radius:999px;transition:width .3s}
  .completeness__sub{font-size:11px;color:var(--muted)}
  .completeness.full  .completeness__fill{background:var(--online)}
  .completeness.grow  .completeness__fill{background:var(--grow)}
  .completeness.low   .completeness__fill{background:var(--offline)}
  /* „unbekannt" = available fehlt (Lauf abgebrochen) oder ist 0 (Quelle
     ausgelassen). Bewusst KEIN leerer Balken: 0 % läse sich wie eine Messung,
     und genau diese Verwechslung hat den Ausfall vom 24.8.2026 zwei Wochen
     lang versteckt. Die Schraffur sagt „hier wurde nichts gemessen", der
     Wert steht als „—" in der Warnfarbe. */
  .completeness.unbekannt .completeness__bar{
      background:repeating-linear-gradient(135deg,
        var(--line) 0 6px, var(--bg) 6px 12px)}
  .completeness.unbekannt .completeness__head b{color:var(--warn-ink)}
  .healthwarn{margin:0 0 12px;padding:8px 10px;border-radius:8px;font-size:12px;
              line-height:1.4;background:var(--warn-bg);color:var(--warn-ink);
              border:1px solid var(--warn-line)}
  .healthwarn b{display:block;font-weight:700}
  .healthwarn + .healthwarn{margin-top:-6px}
  /* Hinweis: etwas ist anders als erwartet, aber nichts ist kaputt — z. B.
     ein aufgegebener Entdeckungszweig, der wieder liefert. Blau statt rot,
     damit er die echten Warnungen nicht verwässert. */
  .healthinfo{margin:0 0 12px;padding:8px 10px;border-radius:8px;font-size:12px;
              line-height:1.4;background:var(--info-bg);color:var(--info-ink);
              border:1px solid var(--info-line)}
  .healthinfo b{display:block;font-weight:700}
  .healthinfo + .healthinfo{margin-top:-6px}
  /* Dauerzustand statt frischer Ausfall: sichtbar, aber ohne Alarmfarbe —
     sonst blinkt WeMoves bauartbedingter Titelmangel jeden Tag rot und man
     sieht die echte Warnung daneben nicht mehr. */
  .healthnote{margin:0 0 12px;padding:6px 10px;border-radius:8px;font-size:11.5px;
              line-height:1.4;background:var(--bg);color:var(--muted);
              border:1px solid var(--line)}
  .completeness.full  .completeness__head b{color:var(--online)}
  .completeness.low   .completeness__head b{color:var(--offline)}
  .card-btn{display:inline-block;font-weight:650;color:var(--indigo)}
  .card.placeholder .cs .n{color:var(--muted)}
  .run-pill{display:none;align-items:center;font-size:10px;font-weight:700;
      color:var(--on-accent);background:var(--indigo);border-radius:999px;padding:3px 9px;
      letter-spacing:.04em;text-transform:uppercase;margin-left:auto}
  .mini-progress{display:none;align-items:center;gap:8px;margin:-2px 0 12px}
  .mini-progress__bar{flex:1;height:5px;background:var(--bg);border-radius:999px;
      overflow:hidden}
  .mini-progress__fill{height:100%;background:var(--indigo);width:0%;
      transition:width .4s}
  .mini-progress__text{font-family:var(--mono);font-size:11px;color:var(--muted);
      white-space:nowrap}
  /* Ampel: Wie kooperativ gibt die Plattform ihre Petitionen frei? */
  .amp{display:flex;align-items:center;gap:8px;margin:-6px 0 10px;cursor:help}
  .amp-dots{display:inline-flex;gap:3px}
  .amp-dots i{width:9px;height:9px;border-radius:50%;background:var(--line);
      display:inline-block}
  .amp-label{font-size:11px;font-weight:700;letter-spacing:.04em;
      text-transform:uppercase}
  .amp-5 .amp-dots i.on,.amp-5 .amp-label{background:var(--amp5);color:var(--amp5-ink)}
  .amp-4 .amp-dots i.on,.amp-4 .amp-label{background:var(--amp4);color:var(--amp4-ink)}
  .amp-3 .amp-dots i.on,.amp-3 .amp-label{background:var(--amp3);color:var(--amp3-ink)}
  .amp-2 .amp-dots i.on,.amp-2 .amp-label{background:var(--amp2);color:var(--amp2-ink)}
  .amp-1 .amp-dots i.on,.amp-1 .amp-label{background:var(--amp1);color:var(--amp1-ink)}
  .amp .amp-label{background:transparent!important}
  .runall-row{display:flex;align-items:center;gap:12px;margin-top:14px}
  .runall-btn{display:inline-flex;align-items:center;gap:8px;border:0;
      background:var(--indigo);color:var(--on-accent);font:inherit;font-weight:650;
      padding:10px 16px;border-radius:10px;cursor:pointer}
  .runall-btn:hover{background:var(--indigo-hover)}
  .runall-btn:disabled{opacity:.6;cursor:default}
  .runall-btn .sp{width:14px;height:14px;border-radius:50%;display:none;
      border:2px solid color-mix(in srgb,var(--on-accent) 45%,transparent);
      border-top-color:var(--on-accent)}
  .runall-btn.busy .sp{display:inline-block;animation:spin .8s linear infinite}
  .runall-status{font-family:var(--mono);font-size:12px;color:var(--muted)}
  @keyframes spin{to{transform:rotate(360deg)}}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;
      margin-top:14px;font-size:11px;color:var(--muted)}
  .legend b{font-weight:700;letter-spacing:.03em}
  .legend .lg{display:inline-flex;align-items:center;gap:5px}
  .legend .lg i{width:9px;height:9px;border-radius:50%;display:inline-block}
  /* Die fünf Punkte standen als style="background:#…" im Markup und waren
     damit dem Dunkelmodus entzogen — Inline-Stil schlägt jede Regel. */
  .lg-5{background:var(--amp5)} .lg-4{background:var(--amp4)}
  .lg-3{background:var(--amp3)} .lg-2{background:var(--amp2)}
  .lg-1{background:var(--amp1)}
  .legend-note{margin:10px 0 0;max-width:70ch;font-size:11px;line-height:1.5;
      color:var(--muted)}
  .legend-note b{color:var(--ink);font-weight:700}
{{LANGCSS}}
  /* Zahlen untereinander bündig — ohne tabellarische Ziffern tanzen die
     Spalten „Petitionen/Online/Offline" von Kachel zu Kachel. */
  .cs .n,.completeness__head b{font-variant-numeric:tabular-nums}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<header>
  <div class="head-top">
    {{EYEBROW}}
    {{LANGSEL}}
  </div>
  {{H1}}
  <p class="sub">{{STANDLABEL}} {{GENERATED}} · {{SUBNOTE}}</p>
  {{RUNALL}}
  <div class="legend">{{LEGENDTITLE}}
    <span class="lg"><i class="lg-5"></i>{{LG5}}</span>
    <span class="lg"><i class="lg-4"></i>{{LG4}}</span>
    <span class="lg"><i class="lg-3"></i>{{LG3}}</span>
    <span class="lg"><i class="lg-2"></i>{{LG2}}</span>
    <span class="lg"><i class="lg-1"></i>{{LG1}}</span>
  </div>
  <p class="legend-note">{{LEGENDNOTE}}</p>
</header>
<main>
  <div class="grid">
{{CARDS}}
  </div>
</main>
{{I18N}}
<script>
(function(){
  // Ohne Server gibt es nichts abzufragen. Der Schnappschuss auf GitHub Pages
  // fragte trotzdem alle 2 s /status ab; die Antwort war GitHubs 404-Seite mit
  // 5.442 Bytes, die der catch-Zweig still verschluckte — am 8.8.2026 an der
  // echten Seite gemessen: 5 Abrufe in 10 s, rund 9,8 MB je Stunde geöffneter
  // Seite, auf dem Handy dauerhaft und ohne jede Aussicht auf Erfolg. Der
  // catch-Kommentar rechnete nur mit file://, nicht mit Pages.
  if (document.documentElement.getAttribute("data-modus") === "schnappschuss") return;
  var allBtn = document.getElementById("run-all");
  var allStatus = document.getElementById("run-all-status");
  var wasRunning = false;
  function poll(){
    fetch("/status").then(function(r){ return r.json(); }).then(function(s){
      var map = s.platforms || {};
      document.querySelectorAll(".card").forEach(function(card){
        var pill = card.querySelector(".run-pill");
        var wrap = card.querySelector(".mini-progress");
        if (!pill || !wrap) return;
        var e = map[card.dataset.platform];
        var mine = !!(e && e.running);
        pill.style.display = mine ? "inline-flex" : "none";
        wrap.style.display = mine ? "flex" : "none";
        if (mine){
          var fill = card.querySelector(".mini-progress__fill");
          var text = card.querySelector(".mini-progress__text");
          var pct = e.total ? Math.round(e.current / e.total * 100) : 0;
          fill.style.width = pct + "%";
          text.textContent = e.total
            ? (e.current + "/" + e.total + " · " + pct + "%")
            : (e.message || PM_T("läuft …", "running …"));
        }
      });
      if (allBtn){
        if (s.running){
          allBtn.disabled = true; allBtn.classList.add("busy");
          allStatus.textContent = s.count_running +
            PM_T(" Scraper laufen: ", " scrapers running: ") +
            (s.running_platforms || []).join(", ");
          wasRunning = true;
        } else {
          allBtn.disabled = false; allBtn.classList.remove("busy");
          if (wasRunning){
            allStatus.textContent = PM_T("Alle fertig – Seite wird aktualisiert …",
                                         "All done – reloading the page …");
            setTimeout(function(){ location.reload(); }, 800);
          }
        }
      }
    }).catch(function(){ /* kein Server (file://) – Anzeige bleibt aus */ });
  }
  if (allBtn){
    allBtn.addEventListener("click", function(){
      if (location.protocol === "file:"){
        allStatus.textContent = PM_T("Nur über den Server: ", "Only via the server: ")
                              + "python3 monitor.py --serve";
        return;
      }
      allBtn.disabled = true; allBtn.classList.add("busy");
      allStatus.textContent = PM_T("Starte alle Scraper …", "Starting all scrapers …");
      fetch("/run?platform=all").then(function(r){ return r.json(); })
        .then(function(res){
          if (!res.started && res.running){
            allStatus.textContent = PM_T("Es läuft bereits ein Scrape.",
                                         "A scrape is already running.");
          }
        })
        .catch(function(){
          allStatus.textContent = PM_T("Kein Server erreichbar.",
                                       "No server reachable.");
          allBtn.disabled = false; allBtn.classList.remove("busy");
        });
    });
  }
  poll();
  setInterval(poll, 2000);
})();
</script>
{{TOTOP}}
</body>
</html>
"""

_PLACEHOLDER_TEMPLATE = """<!DOCTYPE html>
<html lang="de"
      data-title-de="{{NAME}} · Petitions-Monitor"
      data-title-en="{{NAME}} · Petition Monitor">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{NAME}} · Petitions-Monitor</title>
<style>
{{FARBEN}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
       font-size:14px;line-height:1.5}
  header{background:var(--surface);border-bottom:2px solid var(--ink);
         padding:22px clamp(16px,4vw,40px)}
  a.back{color:var(--indigo);text-decoration:none;font-weight:650;font-size:13px}
  h1{margin:10px 0 0;font-size:clamp(20px,3vw,28px);font-weight:800}
  main{padding:clamp(24px,6vw,60px);max-width:640px}
  .box{background:var(--surface);border:1px solid var(--line);border-radius:14px;
       padding:28px;color:var(--muted)}
  .box a{color:var(--indigo)}
{{LANGCSS}}
</style>
</head>
<body>
<header>
  <div class="head-top">
    <a class="back" href="dashboard.html">{{BACK}}</a>
    {{LANGSEL}}
  </div>
  <h1>{{NAME}}</h1>
</header>
<main>
  <div class="box">
    <p>{{PH_TEXT}}</p>
    <p>{{PH_SOURCE}} <a href="{{SOURCE_URL}}" target="_blank" rel="noopener">{{SOURCE_URL}}</a></p>
    <p>{{PH_STAND}} {{GENERATED}}</p>
  </div>
</main>
{{I18N}}
</body>
</html>
"""


# ----------------------------------------------------------------------------
# Lokaler Monitor-Server
# ----------------------------------------------------------------------------
_SERVER_PLATFORMS: list[Platform] = []
_SERVER_ARGS = None


_HTML_WRITE_LOCK = threading.Lock()    # Dashboard-Schreiben bei Parallel-Läufen


def _background_scrape(platform: Platform) -> None:
    set_progress_platform(platform.key)
    prog(running=True, phase="start", current=0, total=0,
         message="Starte …", error=None, finished_at=None)
    try:
        platform.run(_SERVER_ARGS)
    except Exception as exc:                       # noqa: BLE001
        prog(error=str(exc))
        log(f"Scrape-Fehler ({platform.key}): {exc}")
    finally:
        prog(running=False, phase="done", finished_at=now_iso())
        # Dashboard nach jedem Lauf aktualisieren (statische Datei)
        try:
            with _HTML_WRITE_LOCK:
                write_dashboard(_SERVER_PLATFORMS)
        except Exception:
            pass


class MonitorHandler(BaseHTTPRequestHandler):
    def _send(self, code: int, body, ctype: str = "application/json") -> None:
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    @staticmethod
    def _launch(platform: Platform) -> bool:
        """Startet den Lauf einer Plattform, falls sie nicht schon läuft."""
        with PROGRESS_LOCK:
            entry = PROGRESS_MAP.get(platform.key)
            if entry and entry.get("running"):
                return False
            PROGRESS_MAP.setdefault(platform.key,
                                    _fresh_progress(platform.key))["running"] = True
        threading.Thread(target=_background_scrape, args=(platform,),
                         daemon=True).start()
        return True

    def _start_run(self, platform: Platform) -> None:
        started = self._launch(platform)
        self._send(200, json.dumps({"started": started,
                                    "running": not started,
                                    "platform": platform.key}))

    def _start_run_all(self) -> None:
        """Startet ALLE Live-Plattformen parallel (jede drosselt nur ihren
        eigenen Ziel-Host, daher unbedenklich)."""
        live = [p for p in _SERVER_PLATFORMS if p.is_live]
        started = [p.key for p in live if self._launch(p)]
        self._send(200, json.dumps({"started": bool(started),
                                    "platforms": started}))

    def _platform_for_run(self):
        qs = parse_qs(urlparse(self.path).query)
        key = (qs.get("platform") or [""])[0]
        live = [p for p in _SERVER_PLATFORMS if p.is_live]
        if not key:
            return live[0] if live else None
        return next((p for p in live if p.key == key), None)

    def do_GET(self):
        path = urlparse(self.path).path
        platform = next(
            (p for p in _SERVER_PLATFORMS
             if path in (f"/{p.key}", f"/{p.html_file.name}")), None)
        data_platform = next(
            (p for p in _SERVER_PLATFORMS
             if p.data_file and path == f"/{p.data_file.name}"), None)

        if path in ("/", "/index.html", "/dashboard", "/dashboard.html"):
            self._send(200, build_dashboard(_SERVER_PLATFORMS), "text/html")
        elif platform is not None and platform.is_live:
            store = load_store(platform.data_file)
            self._send(200, build_list_html(store, platform), "text/html")
        elif platform is not None:
            self._send(200, build_placeholder_page(platform), "text/html")
        elif path == "/status":
            qs = parse_qs(urlparse(self.path).query)
            key = (qs.get("platform") or [""])[0]
            if key:
                # Einzel-Status im alten Format (für die Listen-Seiten).
                with PROGRESS_LOCK:
                    entry = dict(PROGRESS_MAP.get(key) or _fresh_progress(key))
                self._send(200, json.dumps(entry))
            else:
                self._send(200, json.dumps(progress_snapshot()))
        elif path == "/run":
            qs = parse_qs(urlparse(self.path).query)
            if (qs.get("platform") or [""])[0] == "all":
                self._start_run_all()
                return
            target = self._platform_for_run()
            if target is None:
                self._send(404, json.dumps({"error": "unbekannte Plattform"}))
            else:
                self._start_run(target)
        elif LOGO_PFAD_RE.fullmatch(path):
            # Die Plattform-Logos auf der Kachel. Der Server ist sonst eine
            # reine Positivliste ohne Dateiauslieferung — genau deshalb kam
            # das <img> zunächst als 404 zurück, obwohl die Datei existierte.
            #
            # Eng gefasst: nur Kleinbuchstaben, Ziffern und Unterstrich vor
            # „.svg", und ausgeliefert wird ausschließlich, was WIRKLICH in
            # webapp/logos liegt. Damit gibt es keinen Weg aus dem Ordner
            # heraus, auch nicht über kodierte Punkte.
            datei = Path("webapp/logos") / Path(path).name
            if datei.is_file() and datei.parent.resolve() == \
                    Path("webapp/logos").resolve():
                self._send(200, datei.read_text(encoding="utf-8"),
                           "image/svg+xml")
            else:
                self._send(404, json.dumps({"error": "not found"}))
        elif data_platform is not None:
            txt = (data_platform.data_file.read_text(encoding="utf-8")
                   if data_platform.data_file.exists() else "{}")
            self._send(200, txt)
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if urlparse(self.path).path == "/run":
            target = self._platform_for_run()
            if target is None:
                self._send(404, json.dumps({"error": "unbekannte Plattform"}))
            else:
                self._start_run(target)
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def log_message(self, *args):                  # Konsole ruhig halten
        return


def serve(platforms: list[Platform], args) -> None:
    global _SERVER_PLATFORMS, _SERVER_ARGS
    _SERVER_PLATFORMS = platforms
    _SERVER_ARGS = args
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), MonitorHandler)
    url = f"http://127.0.0.1:{args.port}/"
    log(f"Monitor läuft auf {url}  (Strg+C beendet den Server)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("Server wird beendet.")
        httpd.shutdown()
