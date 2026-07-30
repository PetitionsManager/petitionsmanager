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
import re
import threading
import time
import urllib.robotparser
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlparse, parse_qs, urlencode as _urlencode

import requests
from bs4 import BeautifulSoup, Comment

# ----------------------------------------------------------------------------
# Gemeinsame Konfiguration
# ----------------------------------------------------------------------------
REQUEST_DELAY   = 1.5          # Sekunden Pause zwischen Anfragen (höflich!)
REQUEST_TIMEOUT = 30
MAX_RETRIES     = 3
RESPECT_ROBOTS  = True

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


def _openness_badge(platform: Platform) -> str:
    """Ampel-Badge für die Dashboard-Kachel: 5 Punkte, gefüllt bis zum Level,
    eingefärbt über .amp-<level>; Kurzbegründung als Tooltip."""
    lvl = platform.openness
    if not 1 <= lvl <= 5:
        return ""
    dots = "".join(f'<i class="{"on" if i <= lvl else ""}"></i>'
                   for i in range(1, 6))
    return (f'<div class="amp amp-{lvl}" '
            f'title="{_esc(platform.openness_note)}">'
            f'<span class="amp-dots">{dots}</span>'
            f'<span class="amp-label">{OPENNESS_LABELS[lvl]}</span></div>')


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


def _esc(s) -> str:
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


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
            href = t.get("href")
            t.attrs = {}
            if href:
                t["href"] = urljoin(base_url, href)
                t["target"] = "_blank"
                t["rel"] = "noopener"
        elif t.name == "img":
            # Nur Quelle und Beschriftung behalten. Die Adresse muss absolut
            # sein, sonst zeigte sie später auf die App selbst. Bilder ohne
            # brauchbare Quelle fliegen ganz raus (Platzhalter, 1x1-Pixel);
            # data:-URLs bleiben ebenfalls draußen, die blähen die Texte auf.
            src = (t.get("src") or t.get("data-src") or "").strip()
            alt = (t.get("alt") or "").strip()
            t.attrs = {}
            if not src or src.startswith("data:"):
                t.decompose()
                continue
            t["src"] = urljoin(base_url, src)
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
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def _robots_for(self, url: str):
        netloc = urlparse(url).netloc
        if netloc not in self._robots:
            # robots.txt über die eigene Session laden (richtiger User-Agent):
            # rp.read() nutzt urllib mit "Python-urllib/x.y", das z. B.
            # Cloudflare mit 403 beantwortet – robotparser wertet 403 als
            # "alles verboten" und würde fälschlich jeden Abruf blockieren.
            rp = urllib.robotparser.RobotFileParser()
            try:
                resp = self.session.get(f"https://{netloc}/robots.txt",
                                        timeout=REQUEST_TIMEOUT)
                if resp.status_code == 200:
                    rp.parse(resp.text.splitlines())
                    self._robots[netloc] = rp
                    log(f"robots.txt von {netloc} geladen und wird beachtet.")
                elif resp.status_code in (401, 403):
                    rp.disallow_all = True
                    self._robots[netloc] = rp
                    log(f"robots.txt von {netloc}: HTTP {resp.status_code} – Zugriff gesperrt.")
                else:
                    # 404 u. ä.: keine robots.txt → alles erlaubt.
                    self._robots[netloc] = None
                    log(f"robots.txt von {netloc}: HTTP {resp.status_code} – keine Einschränkungen.")
            except Exception as exc:
                log(f"robots.txt von {netloc} nicht lesbar ({exc}) – fahre vorsichtig fort.")
                self._robots[netloc] = None
        return self._robots[netloc]

    def allowed(self, url: str) -> bool:
        if not RESPECT_ROBOTS:
            return True
        rp = self._robots_for(url)
        if not rp:
            return True
        try:
            return rp.can_fetch(self.user_agent, url)
        except Exception:
            return True

    def get(self, url: str, timeout: int | None = None):
        """requests.Response oder None bei endgültigem Fehler.
        404/410 werden bewusst zurückgegeben (Offline-Erkennung).
        `timeout` überschreibt REQUEST_TIMEOUT (z. B. für große Archiv-Listen)."""
        if not self.allowed(url):
            log(f"robots.txt verbietet: {url}")
            return None
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

    Beim Abschluss-Speichern (quiet=False) wird zusätzlich geprüft, ob die Zahl
    der Online-Petitionen gegenüber dem letzten Lauf eingebrochen ist. Das ist
    fast nie echt, sondern ein Zeichen für eine blockierende/kaputte Quelle
    (WAF-Seite, Umbau, Rate-Limit) – dann wird eine Warnung ins _meta
    geschrieben, die das Dashboard anzeigt."""
    online_now = sum(1 for r in store.values()
                     if isinstance(r, dict) and r.get("status") == "online")
    meta_extra = dict(extra_meta or {})
    if not quiet:
        prev = load_meta(data_file)
        prev_online = prev.get("online_count")
        warn = None
        if (isinstance(prev_online, int) and prev_online >= 20
                and online_now < prev_online * 0.5):
            warn = (f"Online-Bestand von {prev_online} auf {online_now} "
                    f"gefallen – Quelle vermutlich blockiert oder umgebaut.")
            log(f"WARNUNG: {warn}")
        meta_extra["health_warning"] = warn
        meta_extra["online_count"] = online_now

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


def _detail_panel(slug: str, r: dict) -> str:
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

    pid = r.get("petition_id")
    url = r.get("url") or ""
    caturl = r.get("category_url") or ""
    meta = [
        ("slug", _esc(slug)),
        ("ID", _esc(pid) if pid is not None else "—"),
        ("URL", f'<a href="{_esc(url)}" target="_blank" rel="noopener">{_esc(url)}</a>'
                if url else "—"),
        ("Kategorie", f'<a href="{_esc(caturl)}" target="_blank" rel="noopener">'
                      f'{_esc(r.get("category") or caturl)}</a>' if caturl
                      else _esc(r.get("category") or "—")),
    ]
    if r.get("goal"):
        meta.append(("Ziel", _fmt_int(r.get("goal"))))
    meta += [
        ("Erstmals erfasst", _fmt_dt(r.get("first_seen"))),
        ("Zuletzt online", _fmt_dt(r.get("last_seen"))),
        ("Zuletzt geprüft", _fmt_dt(r.get("last_checked"))),
        ("Offline seit", _fmt_dt(r.get("offline_since"))
                          if r.get("offline_since") else "—"),
    ]
    meta_html = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in meta)

    return (
        '<div class="detail-panel">'
        f'<div class="detail-img">{img}</div>'
        '<div class="detail-body">'
        f'<div class="field"><h4>Kurzbeschreibung</h4><p>{summary}</p></div>'
        f'<div class="field"><h4>Adressat</h4><p>{recipient}</p></div>'
        '<details class="fulltext"><summary>Komplette Beschreibung</summary>'
        f'<div class="ft-body">{full}</div></details>'
        '<div class="lists">'
        f'<div><h4>Meilensteine</h4><ul>{ms_html}</ul></div>'
        f'<div><h4>Neuigkeiten</h4><ul>{up_html}</ul></div>'
        f'<div><h4>Unterschriften-Verlauf</h4><ul>{hist_html}</ul></div>'
        '</div>'
        f'<dl class="kv">{meta_html}</dl>'
        '</div>'
        '</div>'
    )


def build_list_html(store: dict, platform: Platform) -> str:
    rows = []
    online = offline = 0
    cols = 9

    meta = load_meta(platform.data_file)
    new_petitions = meta.get("new_petitions_last_run", [])
    new_categories = meta.get("new_categories_last_run", [])
    notes = []
    if new_petitions:
        notes.append(f"+{len(new_petitions)} neue Petition(en) im letzten Lauf")
    if new_categories:
        notes.append(f"+{len(new_categories)} neue Kategorie(n): "
                     f"{_esc(', '.join(new_categories))}")
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
            f'data-signatures="{sig if isinstance(sig, int) else -1}" '
            f'data-start="{_esc(r.get("start_date") or "")}" '
            f'data-checked="{_esc(r.get("last_checked") or "")}">'
            f'<td class="c-toggle"><button class="toggle" type="button" '
            f'aria-expanded="false" aria-label="Details ein-/ausklappen">'
            f'<span class="chev">›</span></button></td>'
            f'<td class="c-thumb">{_img_tag(r.get("image_url"), "thumb")}</td>'
            f'<td class="c-status"><span class="badge '
            f'{"closed" if closed else status}">'
            f'<span class="dot"></span>'
            f'{"Beendet" if closed else ("Online" if status=="online" else "Offline")}'
            f'</span></td>'
            f'<td class="c-title"><a href="{_esc(r.get("url"))}" target="_blank" '
            f'rel="noopener">{_esc(r.get("title") or slug)}</a>'
            f'<div class="recipient">{_esc(r.get("recipient") or "")}</div></td>'
            f'<td>{_esc(r.get("started_by") or "—")}</td>'
            f'<td>{("<span class=pill>"+_esc(r.get("category"))+"</span>") if r.get("category") else "—"}</td>'
            f'<td class="num">{_fmt_int(sig)}</td>'
            f'<td class="mono">{_fmt_date(r.get("start_date"))}</td>'
            f'<td class="mono">{_fmt_dt(r.get("last_checked"))}</td>'
            f'</tr>'
            f'<tr class="detail"><td colspan="{cols}">{_detail_panel(slug, r)}</td></tr>'
        )

    tmpl = _LIST_TEMPLATE
    tmpl = tmpl.replace("{{KEY}}", _esc(platform.key))
    tmpl = tmpl.replace("{{NAME}}", _esc(platform.name))
    tmpl = tmpl.replace("{{EYEBROW}}", _esc(platform.eyebrow or platform.name))
    tmpl = tmpl.replace("{{GENERATED}}", _esc(now_iso()))
    # Die Filter "Laufend"/"Beendet" nur zeigen, wo es überhaupt beendete
    # Einträge gibt (bisher nur Bundestag) – sonst bliebe die Leiste leer.
    n_closed = sum(1 for r in store.values()
                   if isinstance(r, dict) and r.get("closed"))
    tmpl = tmpl.replace("{{CLOSEDFILTERS}}",
                        '<button data-f="running" aria-pressed="false">Laufend'
                        '</button><button data-f="closed" aria-pressed="false">'
                        'Beendet</button>' if n_closed else "")
    tmpl = tmpl.replace("{{TOTAL}}", str(len(store)))
    tmpl = tmpl.replace("{{ONLINE}}", str(online))
    tmpl = tmpl.replace("{{OFFLINE}}", str(offline))
    tmpl = tmpl.replace("{{NEW}}", str(len(new_petitions)))
    tmpl = tmpl.replace("{{NEW_NOTE}}", new_note)
    tmpl = tmpl.replace("{{CAT_OPTIONS}}", cat_options)
    tmpl = tmpl.replace("{{ROWS}}", "\n".join(rows) or
                        f'<tr><td colspan="{cols}" class="empty">Noch keine Daten – '
                        'erst scrapen.</td></tr>')
    tmpl = tmpl.replace("{{TOTOP}}", _TOTOP)
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
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{NAME}} · Petitions-Monitor</title>
<style>
  :root{
    --bg:#eef0f4; --surface:#ffffff; --ink:#161a22; --muted:#5d6675;
    --line:#e2e5ec; --indigo:#2f3f86; --indigo-soft:#eaeefb;
    --online:#1f7a4d; --online-bg:#e6f3ec; --offline:#b23b3b; --offline-bg:#f7e8e8;
    --closed:#6b5a2e; --closed-bg:#f4eeda;
    --mono:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
    --sans:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
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
  .seg button[aria-pressed=true]{background:var(--indigo);color:#fff}
  #catFilter{padding:9px 12px;border:1px solid var(--line);border-radius:10px;
             font-size:14px;background:var(--surface);color:var(--ink)}
  #catFilter:focus{outline:2px solid var(--indigo);outline-offset:1px}
  .count{font-family:var(--mono);font-size:12px;color:var(--muted)}
  .run-btn{display:inline-flex;align-items:center;gap:8px;border:0;
           background:var(--indigo);color:#fff;font:inherit;font-weight:650;
           padding:10px 16px;border-radius:10px;cursor:pointer}
  .run-btn:hover{background:#26326b}
  .run-btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .run-btn:disabled{opacity:.6;cursor:default}
  .run-btn .sp{width:14px;height:14px;border-radius:50%;display:none;
       border:2px solid rgba(255,255,255,.45);border-top-color:#fff}
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
         border:1px solid var(--line);display:block;background:#dfe3ec}
  .thumb.ph{background:repeating-linear-gradient(45deg,#e9ecf3,#e9ecf3 6px,#eef1f7 6px,#eef1f7 12px)}
  .thumb.broken,.detail-pic.broken{display:none}
  tr.detail{display:none}
  tr.detail>td{background:#f6f7fb;border-top:0;padding:0}
  .detail-panel{padding:18px clamp(14px,3vw,26px);display:grid;gap:18px;
                grid-template-columns:minmax(0,1fr)}
  .detail-body{display:grid;gap:14px;min-width:0}
  .detail-pic{width:100%;border-radius:10px;border:1px solid var(--line);display:block}
  .detail-img .ph{display:block;width:100%;aspect-ratio:725/300;border-radius:10px;
       background:repeating-linear-gradient(45deg,#e9ecf3,#e9ecf3 8px,#eef1f7 8px,#eef1f7 16px)}
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
</style>
</head>
<body>
<header>
  <a class="back" href="dashboard.html">← Dashboard</a>
  <p class="eyebrow">{{EYEBROW}} — Datenstand {{GENERATED}}</p>
  <h1>Petitions-Monitor</h1>
  <p class="sub">Lokal gescrapte Übersicht. Status zeigt, ob eine Petition beim
     letzten Lauf noch erreichbar war.</p>
  <div class="board">
    <div class="stat"><div class="n">{{TOTAL}}</div><div class="l">Petitionen</div></div>
    <div class="stat online"><div class="n">{{ONLINE}}</div><div class="l">Online</div></div>
    <div class="stat offline"><div class="n">{{OFFLINE}}</div><div class="l">Offline</div></div>
    <div class="stat new"><div class="n">{{NEW}}</div><div class="l">Neu (letzter Lauf)</div></div>
  </div>
  {{NEW_NOTE}}
</header>
<main>
  <div class="toolbar">
    <button id="run" class="run-btn" type="button"><span class="sp"></span>Jetzt scrapen</button>
    <span class="run-status" id="run-status"></span>
    <input id="q" type="search" placeholder="Filtern nach Titel, Starter*in, Kategorie …" aria-label="Filter">
    <div class="seg" role="group" aria-label="Status filtern">
      <button data-f="all" aria-pressed="true">Alle</button>
      <button data-f="online" aria-pressed="false">Online</button>
      <button data-f="offline" aria-pressed="false">Offline</button>{{CLOSEDFILTERS}}
    </div>
    <select id="catFilter" aria-label="Kategorie filtern">
      <option value="">Alle Kategorien</option>
{{CAT_OPTIONS}}
    </select>
    <span class="count" id="count"></span>
  </div>
  <div class="wrap">
    <table id="t">
      <thead><tr>
        <th class="c-toggle" aria-hidden="true"></th>
        <th class="c-thumb">Bild</th>
        <th data-k="status">Status</th>
        <th data-k="title">Titel</th>
        <th data-k="starter">Gestartet von</th>
        <th data-k="category">Kategorie</th>
        <th data-k="signatures" class="num">Unterschriften</th>
        <th data-k="start">Start</th>
        <th data-k="checked">Zuletzt geprüft</th>
      </tr></thead>
      <tbody>
{{ROWS}}
      </tbody>
    </table>
  </div>
</main>
<footer>Erzeugt vom Petitions-Monitor · Daten werden bei jedem Lauf aktualisiert,
  nicht überschrieben.</footer>
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
                           r.dataset.category).indexOf(term)>-1;
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
    count.textContent=shown+" von "+rows.length+" sichtbar";
  }
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
        runStatus.textContent=(s.message||"läuft …")+p;
        setTimeout(poll,1500);
      }else if(s.error){
        runStatus.textContent="Fehler: "+s.error;
        runBtn.disabled=false; runBtn.classList.remove("busy");
      }else{
        runStatus.textContent="Fertig – Seite wird aktualisiert …";
        setTimeout(function(){location.reload();},600);
      }
    }).catch(function(){
      runStatus.textContent="Verbindung zum Server verloren.";
      runBtn.disabled=false; runBtn.classList.remove("busy");
    });
  }
  if(runBtn){
    if(fileMode){
      runBtn.title="Funktioniert nur über den lokalen Server: "+
                   "python3 monitor.py --serve";
    }
    runBtn.addEventListener("click",function(){
      if(fileMode){
        runStatus.textContent="Nur über den Server: python3 monitor.py --serve";
        return;
      }
      runBtn.disabled=true; runBtn.classList.add("busy");
      runStatus.textContent="Starte …";
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
def _live_card(platform: Platform) -> str:
    store = load_store(platform.data_file)
    online = sum(1 for r in store.values() if r.get("status", "online") == "online")
    offline = len(store) - online
    meta = load_meta(platform.data_file)
    new_count = len(meta.get("new_petitions_last_run", []))
    cat_count = len(meta.get("categories", {}))
    generated = meta.get("generated_at")
    cats = str(cat_count) if cat_count else "—"

    # Vollständigkeitsgrad: wie viele der bei der Entdeckung gefundenen
    # Kandidaten (Feld "available") stecken schon im Store? Zeigt z. B. den
    # großen Change.org-Backlog. Ohne "available" (Altbestand vor diesem
    # Feature) Rückfall auf 100 % (= als vollständig angenommen).
    available = meta.get("available") or len(store) or 1
    pct = min(100, round(len(store) / available * 100)) if available else 100
    comp_cls, comp_lbl = (("full", "vollständig") if pct >= 95 else
                          ("grow", "wächst noch") if pct >= 50 else
                          ("low", "großer Backlog"))

    # Einbruch des Online-Bestands = fast immer ein Quellenproblem, kein echtes
    # Verschwinden der Petitionen (siehe save_store).
    warning = meta.get("health_warning")
    warn_html = (f'<div class="healthwarn">⚠ {_esc(warning)}</div>'
                 if warning else "")

    return f"""
    <a class="card" href="{platform.html_file.name}" data-platform="{_esc(platform.key)}">
      <div class="card-head"><span class="card-dot weact"></span><h2>{_esc(platform.name)}</h2>
        <span class="run-pill">läuft …</span></div>
      {_openness_badge(platform)}
      <div class="card-stats">
        <div class="cs"><div class="n">{len(store)}</div><div class="l">Petitionen</div></div>
        <div class="cs"><div class="n">{online}</div><div class="l">Online</div></div>
        <div class="cs"><div class="n">{offline}</div><div class="l">Offline</div></div>
        <div class="cs"><div class="n">{cats}</div><div class="l">Kategorien</div></div>
      </div>
      <div class="completeness {comp_cls}">
        <div class="completeness__head"><span>Vollständigkeit</span><b>{pct}%</b></div>
        <div class="completeness__bar"><div class="completeness__fill" style="width:{pct}%"></div></div>
        <span class="completeness__sub">{len(store)} von ~{available} entdeckten · {comp_lbl}</span>
      </div>
      {warn_html}
      <div class="mini-progress">
        <div class="mini-progress__bar"><div class="mini-progress__fill"></div></div>
        <span class="mini-progress__text"></span>
      </div>
      <p class="card-sub">{new_count} neue Petition(en) im letzten Lauf ·
        Datenstand {_fmt_dt(generated) if generated else "—"}</p>
      <span class="card-btn">Zur Liste →</span>
    </a>"""


def _placeholder_card(platform: Platform) -> str:
    return f"""
    <a class="card placeholder" href="{platform.html_file.name}" data-platform="{_esc(platform.key)}">
      <div class="card-head"><span class="card-dot other"></span><h2>{_esc(platform.name)}</h2></div>
      {_openness_badge(platform)}
      <div class="card-stats">
        <div class="cs"><div class="n">—</div><div class="l">Petitionen</div></div>
        <div class="cs"><div class="n">—</div><div class="l">Online</div></div>
        <div class="cs"><div class="n">—</div><div class="l">Offline</div></div>
        <div class="cs"><div class="n">—</div><div class="l">Kategorien</div></div>
      </div>
      <p class="card-sub">Noch keine Daten – Scraper in Vorbereitung.</p>
      <span class="card-btn">Zur Liste →</span>
    </a>"""


def build_dashboard(platforms: list[Platform]) -> str:
    cards = "\n".join(
        _live_card(p) if p.is_live else _placeholder_card(p) for p in platforms)
    tmpl = _DASHBOARD_TEMPLATE
    tmpl = tmpl.replace("{{GENERATED}}", _esc(now_iso()))
    tmpl = tmpl.replace("{{CARDS}}", cards)
    tmpl = tmpl.replace("{{TOTOP}}", _TOTOP)
    return tmpl


def write_dashboard(platforms: list[Platform]) -> None:
    DASHBOARD_FILE.write_text(build_dashboard(platforms), encoding="utf-8")
    log(f"{DASHBOARD_FILE} geschrieben.")


def build_placeholder_page(platform: Platform) -> str:
    tmpl = _PLACEHOLDER_TEMPLATE
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


_DASHBOARD_TEMPLATE = """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Petitions-Monitor · Dashboard</title>
<style>
  :root{
    --bg:#eef0f4; --surface:#ffffff; --ink:#161a22; --muted:#5d6675;
    --line:#e2e5ec; --indigo:#2f3f86; --indigo-soft:#eaeefb;
    --online:#1f7a4d; --offline:#b23b3b;
    --mono:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
    --sans:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
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
  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
        max-width:1320px}
  .card{display:block;background:var(--surface);border:1px solid var(--line);
        border-radius:14px;padding:20px;text-decoration:none;color:inherit;
        transition:box-shadow .15s,transform .15s}
  .card:hover{box-shadow:0 6px 20px rgba(22,26,34,.1);transform:translateY(-2px)}
  .card-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .card-dot{width:12px;height:12px;border-radius:50%;display:inline-block}
  .card-dot.weact{background:var(--indigo)}
  .card-dot.other{background:var(--muted)}
  .card-head h2{margin:0;font-size:18px}
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
  .completeness.grow  .completeness__fill{background:#c98a20}
  .completeness.low   .completeness__fill{background:var(--offline)}
  .healthwarn{margin:0 0 12px;padding:8px 10px;border-radius:8px;font-size:12px;
              line-height:1.4;background:#fdeceb;color:#8d2f28;
              border:1px solid #f3c3bf}
  .completeness.full  .completeness__head b{color:var(--online)}
  .completeness.low   .completeness__head b{color:var(--offline)}
  .card-btn{display:inline-block;font-weight:650;color:var(--indigo)}
  .card.placeholder .cs .n{color:var(--muted)}
  .run-pill{display:none;align-items:center;font-size:10px;font-weight:700;
      color:#fff;background:var(--indigo);border-radius:999px;padding:3px 9px;
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
  .amp-5 .amp-dots i.on,.amp-5 .amp-label{background:#1f7a4d;color:#1f7a4d}
  .amp-4 .amp-dots i.on,.amp-4 .amp-label{background:#7cb342;color:#689433}
  .amp-3 .amp-dots i.on,.amp-3 .amp-label{background:#e0a80f;color:#a97f0b}
  .amp-2 .amp-dots i.on,.amp-2 .amp-label{background:#e07b39;color:#c05f1f}
  .amp-1 .amp-dots i.on,.amp-1 .amp-label{background:#b23b3b;color:#b23b3b}
  .amp .amp-label{background:transparent!important}
  .runall-row{display:flex;align-items:center;gap:12px;margin-top:14px}
  .runall-btn{display:inline-flex;align-items:center;gap:8px;border:0;
      background:var(--indigo);color:#fff;font:inherit;font-weight:650;
      padding:10px 16px;border-radius:10px;cursor:pointer}
  .runall-btn:hover{background:#26326b}
  .runall-btn:disabled{opacity:.6;cursor:default}
  .runall-btn .sp{width:14px;height:14px;border-radius:50%;display:none;
      border:2px solid rgba(255,255,255,.45);border-top-color:#fff}
  .runall-btn.busy .sp{display:inline-block;animation:spin .8s linear infinite}
  .runall-status{font-family:var(--mono);font-size:12px;color:var(--muted)}
  @keyframes spin{to{transform:rotate(360deg)}}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;
      margin-top:14px;font-size:11px;color:var(--muted)}
  .legend b{font-weight:700;letter-spacing:.03em}
  .legend .lg{display:inline-flex;align-items:center;gap:5px}
  .legend .lg i{width:9px;height:9px;border-radius:50%;display:inline-block}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<header>
  <p class="eyebrow">Petitions-Monitor — Dashboard</p>
  <h1>Übersicht</h1>
  <p class="sub">Datenstand {{GENERATED}} · Wähle eine Plattform für die
     Detailliste.</p>
  <div class="runall-row">
    <button id="run-all" class="runall-btn" type="button">
      <span class="sp"></span>Alle Scraper starten</button>
    <span class="runall-status" id="run-all-status"></span>
  </div>
  <div class="legend"><b>Ampel — Datenfreigabe:</b>
    <span class="lg"><i style="background:#1f7a4d"></i>sehr offen (volle Liste, alles im HTML)</span>
    <span class="lg"><i style="background:#7cb342"></i>offen (volle Liste, kleine Hürden)</span>
    <span class="lg"><i style="background:#e0a80f"></i>mittel (begrenzte Listen/Extra-Endpoints)</span>
    <span class="lg"><i style="background:#e07b39"></i>eingeschränkt (nur kuratierte Auswahl/Heuristik)</span>
    <span class="lg"><i style="background:#b23b3b"></i>verschlossen (keine öffentliche Liste/Blockade)</span>
  </div>
</header>
<main>
  <div class="grid">
{{CARDS}}
  </div>
</main>
<script>
(function(){
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
            : (e.message || "läuft …");
        }
      });
      if (allBtn){
        if (s.running){
          allBtn.disabled = true; allBtn.classList.add("busy");
          allStatus.textContent = s.count_running + " Scraper laufen: " +
            (s.running_platforms || []).join(", ");
          wasRunning = true;
        } else {
          allBtn.disabled = false; allBtn.classList.remove("busy");
          if (wasRunning){
            allStatus.textContent = "Alle fertig – Seite wird aktualisiert …";
            setTimeout(function(){ location.reload(); }, 800);
          }
        }
      }
    }).catch(function(){ /* kein Server (file://) – Anzeige bleibt aus */ });
  }
  if (allBtn){
    allBtn.addEventListener("click", function(){
      if (location.protocol === "file:"){
        allStatus.textContent = "Nur über den Server: python3 monitor.py --serve";
        return;
      }
      allBtn.disabled = true; allBtn.classList.add("busy");
      allStatus.textContent = "Starte alle Scraper …";
      fetch("/run?platform=all").then(function(r){ return r.json(); })
        .then(function(res){
          if (!res.started && res.running){
            allStatus.textContent = "Es läuft bereits ein Scrape.";
          }
        })
        .catch(function(){
          allStatus.textContent = "Kein Server erreichbar.";
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
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{NAME}} · Petitions-Monitor</title>
<style>
  :root{
    --bg:#eef0f4; --surface:#ffffff; --ink:#161a22; --muted:#5d6675;
    --line:#e2e5ec; --indigo:#2f3f86;
    --sans:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
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
</style>
</head>
<body>
<header>
  <a class="back" href="dashboard.html">← Dashboard</a>
  <h1>{{NAME}}</h1>
</header>
<main>
  <div class="box">
    <p>Für {{NAME}} gibt es noch keinen Scraper und keine Daten. Dieser
       Bereich ist als Platzhalter für die geplante Anbindung angelegt.</p>
    <p>Quelle: <a href="{{SOURCE_URL}}" target="_blank" rel="noopener">{{SOURCE_URL}}</a></p>
    <p>Datenstand dieser Seite: {{GENERATED}}</p>
  </div>
</main>
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
