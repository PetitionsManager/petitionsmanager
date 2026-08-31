#!/usr/bin/env python3
"""Selbsttest der Wächter — läuft in `Checks` bei jedem Push.

Warum es diese Datei gibt (29.8.2026): Am 29.8. wurde durchgezählt, welche der
eingebauten Melder in den letzten vier Nachtläufen überhaupt angeschlagen
haben. Sieben hatten es — `entferne_skip()` nicht, ein einziges Mal nicht.
Das ist ausgerechnet der Wächter mit dem höchsten Einsatz: er verhindert, dass
ein geänderter Seitenaufbau einen ganzen Bestand löscht. Ein Melder, der nie
gefeuert hat, ist von einem kaputten Melder aber nicht zu unterscheiden.

Geprüft wird deshalb mit KUNSTDATEN, was im Betrieb hoffentlich nie vorkommt.
Jede Prüfung hat eine Gegenprobe: zu jedem „muss greifen" gehört ein „darf
NICHT greifen" dicht an der Schwelle. Ohne das bewiese ein bestandener Test
nur, dass die Funktion immer dasselbe tut.

Bewusst ohne Testrahmen (kein pytest): das Projekt hat keinen, und für zwei
Dutzend Fälle ist eine Abhängigkeit mehr der schlechtere Tausch. Aufruf:
    python3 selbsttest.py        # Exit 0 = alles gut, 1 = mindestens ein Fall
"""
from __future__ import annotations

import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

from bs4 import BeautifulSoup

import changeorg_scraper as changeorg
import europarl_scraper as europarl
import openpetition_scraper as openpetition
import petitions_core as core

fehler: list[str] = []


def pruefe(name: str, ist, soll) -> None:
    if ist == soll:
        print(f"  ok    {name}")
    else:
        print(f"  FEHLT {name}: erwartet {soll!r}, war {ist!r}")
        fehler.append(name)


# ---------------------------------------------------------------------------
# 1. entferne_skip() — die Massen-Lösch-Bremse
# ---------------------------------------------------------------------------
def bestand(n: int) -> dict:
    return {f"s{i}": {"slug": f"s{i}", "url": f"https://x.test/s{i}",
                      "title": f"T{i}", "status": "online"} for i in range(n)}


def skip_lauf(anzahl_skip: int, geprueft: int, bestandsgroesse: int = 200):
    """Ruft die Bremse und liefert (Rückgabe, verbliebene Sätze, Warnung?)."""
    core._TLS.platform = "selbsttest"
    core.BEFUNDE.pop("selbsttest", None)
    store = bestand(bestandsgroesse)
    weg = [f"s{i}" for i in range(anzahl_skip)]
    n = core.entferne_skip(store, weg, geprueft, "Testplattform",
                           "Seite nicht gefunden", "page not found")
    warnungen = [b for b in core.BEFUNDE.get("selbsttest", [])
                 if b.get("stufe") == "warnung"]
    return n, len(store), bool(warnungen)


print("entferne_skip() — Massen-Lösch-Bremse")
# Greift: 31 von 100 sind 31 % und damit über SKIP_LOESCH_ANTEIL_MAX (30 %).
n, rest, warnt = skip_lauf(31, 100)
pruefe("31 % → nichts gelöscht", n, 0)
pruefe("31 % → Bestand unangetastet", rest, 200)
pruefe("31 % → und es wird GEMELDET", warnt, True)

# Gegenprobe dicht an der Schwelle: 29 % müssen durchgehen, sonst bewiese der
# Fall oben nur, dass die Funktion nie löscht.
n, rest, warnt = skip_lauf(29, 100)
pruefe("29 % → gelöscht", n, 29)
pruefe("29 % → Bestand geschrumpft", rest, 171)
pruefe("29 % → keine Warnung", warnt, False)

# Die Grenze ist AUSSCHLIESSEND formuliert (> 30 %), genau 30 % läuft durch.
n, _, _ = skip_lauf(30, 100)
pruefe("genau 30 % → gelöscht", n, 30)

# Unter SKIP_LOESCH_MIN_ABS greift die Bremse bewusst nicht: in einem kleinen
# Bestand ist ein hoher Anteil normal (foodwatch hat 16 Sätze).
n, _, warnt = skip_lauf(9, 10)
pruefe("9 Sätze (unter der absoluten Grenze) → gelöscht", n, 9)
pruefe("9 Sätze → keine Warnung", warnt, False)

# Ab genau SKIP_LOESCH_MIN_ABS zusammen mit hohem Anteil greift sie wieder.
n, _, warnt = skip_lauf(10, 11)
pruefe("10 Sätze bei 91 % → nichts gelöscht", n, 0)
pruefe("10 Sätze bei 91 % → gemeldet", warnt, True)

# Leere Liste ist kein Ausfall, sondern der Normalfall.
n, rest, warnt = skip_lauf(0, 100)
pruefe("nichts zu löschen → 0 zurück", n, 0)
pruefe("nichts zu löschen → keine Warnung", warnt, False)

# Der save-Rückruf darf NUR laufen, wenn wirklich gelöscht wurde — sonst
# schriebe die Bremse den unveränderten Bestand ohne Not neu.
gerufen = []
core._TLS.platform = "selbsttest"
core.BEFUNDE.pop("selbsttest", None)
st = bestand(200)
core.entferne_skip(st, [f"s{i}" for i in range(31)], 100, "T", "g", "g",
                   save=lambda: gerufen.append(1))
pruefe("Bremse greift → save() NICHT gerufen", gerufen, [])
core.entferne_skip(st, [f"s{i}" for i in range(29)], 100, "T", "g", "g",
                   save=lambda: gerufen.append(1))
pruefe("Löschung → save() gerufen", gerufen, [1])


# ---------------------------------------------------------------------------
# 2. _bestandspruefung(), Prüfung (e): „Startdatum rückt nicht nach"
# ---------------------------------------------------------------------------
HEUTE = date.today()
TAG = lambda n: (HEUTE - timedelta(days=n)).isoformat()   # noqa: E731


def datums_bestand(mit: int, ohne: int, datum: str) -> dict:
    s = {}
    for i in range(mit):
        s[f"a{i}"] = {"slug": f"a{i}", "url": f"https://x.test/a{i}",
                      "title": f"T{i}", "status": "online", "start_date": datum}
    for i in range(ohne):
        s[f"b{i}"] = {"slug": f"b{i}", "url": f"https://x.test/b{i}",
                      "title": f"Tb{i}", "status": "online"}
    return s


def datums_lauf(mit: int, ohne: int, datum: str, neue: int,
                available=2000) -> bool:
    """True, wenn Stufe 1 („Startdatum rückt nicht nach") meldet."""
    return _datums_lauf(mit, ohne, datum, neue, available)[0]


def _datums_lauf(mit, ohne, datum, neue, available):
    """(Stufe 1, Stufe 2) — beide Meldungen der Prüfung (e)."""
    core._TLS.platform = "selbsttest"
    core._TLS.lauf_meta = {"new_petitions_last_run": [f"n{i}"
                                                      for i in range(neue)]}
    if available is not None:
        core._TLS.lauf_meta["available"] = available
    core.BEFUNDE.pop("selbsttest", None)
    befunde, _ = core._bestandspruefung(datums_bestand(mit, ohne, datum), {})
    themen = [b["thema"] for b in befunde]
    return ("Startdatum rückt nicht nach" in themen,
            "Bestand altert" in themen)


def altert(mit, ohne, datum, neue=0, available=2000) -> bool:
    """True, wenn Stufe 2 („Bestand altert") meldet."""
    return _datums_lauf(mit, ohne, datum, neue, available)[1]


print()
print("_bestandspruefung() (e) — Startdatum rückt nicht nach")
grenze = core.STARTDATUM_MAX_ALTER
pruefe(f"{grenze + 1} Tage alt, neue Sätze → meldet",
       datums_lauf(100, 0, TAG(grenze + 1), 3), True)
pruefe(f"{grenze - 1} Tage alt → still",
       datums_lauf(100, 0, TAG(grenze - 1), 3), False)
pruefe("Datum von heute (Change.org-Fall) → still",
       datums_lauf(100, 0, TAG(0), 3), False)
pruefe("keine neuen Sätze → still",
       datums_lauf(100, 0, TAG(200), 0), False)
# Deckung: WeAct trägt 2 von 1907 Startdaten (0,1 %) — dort fehlt das Feld im
# Schema der Quelle, das ist kein Ausfall.
pruefe("Deckung 0,1 % (WeAct-Fall) → still",
       datums_lauf(2, 1905, TAG(200), 3), False)
pruefe("Deckung 19 % → still", datums_lauf(19, 81, TAG(200), 3), False)
pruefe("Deckung 21 % → meldet", datums_lauf(21, 79, TAG(200), 3), True)
pruefe("gar kein Datum → still", datums_lauf(0, 100, "", 3), False)
pruefe("unbekanntes Datumsformat → still",
       datums_lauf(100, 0, "01.05.2026", 3), False)

# ⚠️ Die zwei Fälle an der Grenze leiten ihr Prüfdatum AUS der Konstante ab —
# sie prüfen also das Verhalten an der Schwelle, nicht deren Höhe, und blieben
# grün, wenn jemand STARTDATUM_MAX_ALTER auf 9999 setzte (beim Mutationstest
# am 29.8.2026 genau so beobachtet). Deshalb zusätzlich eine Spanne statt
# eines festen Werts: sie lässt eine begründete Nachjustierung zu und fängt
# trotzdem das versehentliche Stilllegen.

# ---------------------------------------------------------------------------
# Prüfung (e), STUFE 2: „Bestand altert" — ohne Neuzugänge, dafür älter
# ---------------------------------------------------------------------------
# Die erste Stufe hatte eine Lücke an genau dem Fall, für den sie gebaut wurde:
# im Lauf vom 30.8.2026 meldete sie für eko und schwieg für openPetition, weil
# dort nichts Neues dazukam (Bedingung `neu > 0`). Stufe 2 schließt das —
# gemessene Grundpegel am 30.8.: 41 (bundestag), 60 (wemove), 76 (avaaz),
# 121 (openpetition), 225 (eko), 241 (europarl) Tage.
print()
print("_bestandspruefung() (e) Stufe 2 — Bestand altert")
alt = core.STARTDATUM_ALT_TAGE
pruefe(f"{alt + 1} Tage, keine Neuzugänge, Plattform läuft → meldet",
       altert(56, 44, TAG(alt + 1)), True)
pruefe(f"{alt - 1} Tage → still",
       altert(100, 0, TAG(alt - 1)), False)
# 76 Tage ist der echte Avaaz-Wert: er darf NICHT melden, sonst blinkt jede
# Plattform, die eine Weile nichts veröffentlicht hat.
pruefe("76 Tage (echter Avaaz-Wert) → still", altert(79, 21, TAG(76)), False)
pruefe("41 Tage (echter Bundestag-Wert) → still", altert(100, 0, TAG(41)), False)
# Gesperrter Host: available == 0. Der bekommt schon zwei andere Meldungen,
# eine dritte wäre Lärm.
pruefe("Host gesperrt (available 0) → still",
       altert(56, 44, TAG(200), available=0), False)
pruefe("available unbekannt → still",
       altert(56, 44, TAG(200), available=None), False)
pruefe("Deckung 0,1 % (WeAct) → still", altert(2, 1905, TAG(200)), False)
# Kommen Neuzugänge dazu, ist Stufe 1 die schärfere Aussage — dann darf NUR
# sie melden, sonst stünde zweimal dasselbe am Lauf.
s1, s2 = _datums_lauf(56, 44, TAG(200), 3, 2000)
pruefe("mit Neuzugängen → Stufe 1 meldet", s1, True)
pruefe("mit Neuzugängen → Stufe 2 schweigt", s2, False)

pruefe("zweite Schwelle liegt über der ersten",
       core.STARTDATUM_ALT_TAGE > core.STARTDATUM_MAX_ALTER, True)
pruefe("zweite Schwelle in vernünftiger Spanne (60–180 Tage)",
       60 <= core.STARTDATUM_ALT_TAGE <= 180, True)

pruefe("Schwelle liegt in vernünftiger Spanne (14–60 Tage)",
       14 <= core.STARTDATUM_MAX_ALTER <= 60, True)
pruefe("Lösch-Bremse zwischen 10 % und 50 %",
       0.10 <= core.SKIP_LOESCH_ANTEIL_MAX <= 0.50, True)
pruefe("absolute Untergrenze der Bremse zwischen 5 und 50",
       5 <= core.SKIP_LOESCH_MIN_ABS <= 50, True)


# ---------------------------------------------------------------------------
# 3. openpetition._startdatum() — die drei Genauigkeiten der Statusleiste
#
# Warum das hier steht (29.8.2026): Der Ausdruck kannte vier Monate lang NUR
# die monatsgenaue Form. Weil openPetition frische Petitionen TAGESGENAU
# auszeichnet, fiel dabei ausgerechnet das Neueste heraus — das jüngste
# start_date im Bestand stand seit dem 1.5.2026 still, während der Lauf weiter
# neue Petitionen fand. Kein Melder schlug an, denn der Abruf klappte ja.
#
# ⚠️ Die Fälle decken bewusst ALLE DREI Formen ab. Ein Test, der nur die
# monatsgenaue prüft, wäre die ganzen vier Monate über grün geblieben — er
# hätte die Lücke nicht bloß übersehen, sondern beglaubigt.
# ⚠️ Die Textbausteine sind ABGELESEN, nicht erfunden: alle drei stammen von
# echten Detailseiten (29.8.2026 abgerufen).
# ---------------------------------------------------------------------------
print()
print("openpetition._startdatum() — drei Datumsformate der Statusleiste")

for text, soll, was in [
    # muss greifen
    ("Gestartet 28.08.2026 Sammlung noch > 5 Monate Einreichung",
     "2026-08-28", "tagesgenau (frische Petition)"),
    ("Gestartet Mai 2026 Sammlung noch > 9 Wochen Einreichung",
     "2026-05-01", "monatsgenau → Tag 01"),
    ("Gestartet März 2025 Sammlung", "2025-03-01", "Monat mit Umlaut"),
    ("Gestartet 01.01.2020 Sammlung", "2020-01-01", "einstellige Tage/Monate"),
    # darf NICHT greifen — die Gegenproben
    ("Gestartet 2024 Sammlung noch > 4 Monate", None,
     "nur Jahr → bewusst kein Datum statt erfundenem Monat"),
    ("Gestartet 31.02.2026 Sammlung", None, "unmöglicher Tag → nichts"),
    ("Gestartet 28.13.2026 Sammlung", None, "Monat 13 → nichts"),
    ("Gestartet Frühling 2026", None, "kein Monatsname → nichts"),
    ("Sammlung noch > 5 Monate Einreichung", None,
     "ohne das Wort Gestartet → nichts"),
    ("", None, "leerer Text → nichts"),
]:
    pruefe(was, openpetition._startdatum(text), soll)

# Die Reihenfolge im Ausdruck ist keine Geschmacksfrage: stünde die
# monatsgenaue Form zuerst und wäre sie etwas großzügiger geschnitten, griffe
# sie in „Gestartet 28.08.2026" nach der falschen Zahl.
pruefe("tagesgenau schlägt monatsgenau (Reihenfolge)",
       openpetition._startdatum("Gestartet 28.08.2026"), "2026-08-28")


# ---------------------------------------------------------------------------
# 4. sanitize_fragment() — <style>/<script> müssen GANZ weg
#
# Warum das hier steht (30.8.2026): Nutzermeldung, die Avaaz-Petition „Welt an
# Trump" zeige mitten im Text ihr Seiten-CSS („#sign_the_letter_disclaimer {
# margin-top: 40px; … }"). Ursache war unwrap() für alles Unerlaubte — richtig
# für <div>/<span>, falsch für Elemente, deren INHALT Quelltext ist. Über alle
# 19.919 ausgelieferten Volltexte gemessen: 25 betroffen (0,13 %).
#
# ⚠️ Der dritte Fall ist die eigentliche Falle: find_all() liefert eine
# MOMENTAUFNAHME. Wird ein <svg> entfernt, hängt sein <path> noch in dieser
# Liste, aber nicht mehr im Baum — ein unwrap() darauf wirft. Ohne die
# decomposed-Sperre stirbt hier die ganze Beschreibung, nicht nur das CSS.
# ---------------------------------------------------------------------------
print()
print("sanitize_fragment() — Quelltext-Elemente")


def sanitiert(html: str) -> str:
    node = BeautifulSoup(html, "html.parser").div
    return core.sanitize_fragment(node, "https://x.test")


pruefe("<style> verschwindet samt Inhalt",
       sanitiert("<div><p>Hallo</p><style>#a { color: red; }</style></div>"),
       "<p>Hallo</p>")
pruefe("<script> verschwindet samt Inhalt",
       sanitiert("<div><p>Hi</p><script>var x = 1;</script></div>"),
       "<p>Hi</p>")
pruefe("<svg> mit Kind reisst nichts mit (decomposed-Sperre)",
       sanitiert("<div><svg><path d='M0 0'/></svg><p>X</p></div>"), "<p>X</p>")
pruefe("<iframe> verschwindet",
       sanitiert("<div><iframe src='https://y.test'></iframe><p>Y</p></div>"),
       "<p>Y</p>")
# Gegenprobe: ein GEWÖHNLICHER unerlaubter Tag wird weiterhin AUSGEPACKT, sein
# Text bleibt. Ohne diesen Fall bewiese das Obige nur, dass die Funktion
# irgendetwas wegwirft.
pruefe("<div>/<span> werden weiter ausgepackt, Text bleibt",
       sanitiert("<div><span>Text bleibt</span></div>"), "<p>Text bleibt</p>")
pruefe("erlaubte Tags bleiben unangetastet",
       sanitiert("<div><p>A</p><ul><li>B</li></ul></div>"),
       "<p>A</p><ul><li>B</li></ul>")


# ---------------------------------------------------------------------------
# 5. CODE_IM_TEXT_RE — Prüfung (f): Quelltext im Petitionstext
#
# Die Textbausteine sind ABGELESEN, nicht erfunden: alle „muss greifen"-Fälle
# stammen wörtlich aus den am 30.8.2026 gemessenen 25 echten Fundstellen.
#
# ⚠️ Die Gegenproben sind hier wichtiger als die Treffer. Das Muster läuft über
# JEDE Beschreibung im Bestand; ein Fehlalarm bedeutet eine Warnung, die täglich
# blinkt und niemandem gehört. Deshalb steht zu jedem „muss greifen" ein
# Fließtext-Fall dicht daneben, der NICHT greifen darf.
# ---------------------------------------------------------------------------
print()
print("CODE_IM_TEXT_RE — Quelltext im Petitionstext")

for text, soll, was in [
    # muss greifen — alle wörtlich aus dem echten Bestand
    ("<p>Bitte unterschreiben</p>{\nmargin-top: 40px;\nmargin-left: 20px;\n}",
     True, "CSS-Block (der Anlassfall „Welt an Trump“)"),
    ('{mso-style-name:"Table Normal"; mso-tstyle-rowband-size:0;}', True,
     "Word-Einfügerest mso-style-name"),
    ("<p>Text</p>function(){ etwas(); }", True, "function(){ …"),
    ("<p>A</p>{ display:none; }", True, "einzeilige CSS-Regel"),
    ("<p>A</p><style>#x{color:red}</style>", True,
     "übrig gebliebenes <style>-Tag"),
    ("<p>A</p>document.getElementById('x')", True, "DOM-Zugriff"),
    # darf NICHT greifen — Fließtext, der nur so AUSSIEHT
    ("<p>Wir fordern: {Platzhalter} einsetzen</p>", False,
     "geschweifte Klammer im Fließtext"),
    ("<p>Erstens: mehr Geld; zweitens: mehr Zeit</p>", False,
     "Doppelpunkt und Semikolon ohne Klammern"),
    ("<p>Die Funktion der Verwaltung ist unklar</p>", False,
     "das Wort Funktion im Fließtext"),
    ("<p>Öffnungszeiten: 9:00 bis 17:00 Uhr</p>", False, "Uhrzeiten"),
    ("<p>A</p><ul><li>B</li></ul>", False, "gewöhnliches Listen-HTML"),
    ("", False, "leerer Text"),
]:
    pruefe(was, bool(core.CODE_IM_TEXT_RE.search(text)), soll)


# Das Muster zu prüfen genügt NICHT: es beweist nicht, dass der Melder auch
# feuert. Deshalb derselbe Weg wie bei (e) — über _bestandspruefung.
def code_lauf(mit_code: int, sauber: int) -> bool:
    """True, wenn Prüfung (f) meldet."""
    core._TLS.platform = "selbsttest"
    core._TLS.lauf_meta = {"new_petitions_last_run": [], "available": 100}
    core.BEFUNDE.pop("selbsttest", None)
    store = {}
    for i in range(mit_code):
        store[f"c{i}"] = {"slug": f"c{i}", "url": f"https://x.test/c{i}",
                          "title": f"C{i}", "status": "online",
                          "description_full": "<p>Text</p>{ margin-top: 40px; }"}
    for i in range(sauber):
        store[f"s{i}"] = {"slug": f"s{i}", "url": f"https://x.test/s{i}",
                          "title": f"S{i}", "status": "online",
                          "description_full": "<p>Ganz gewöhnlicher Text</p>"}
    befunde, _ = core._bestandspruefung(store, {})
    return "Quelltext im Petitionstext" in [b["thema"] for b in befunde]


pruefe("ein einziger Satz mit Quelltext → meldet", code_lauf(1, 99), True)
pruefe("Bestand ganz ohne Quelltext → still", code_lauf(0, 100), False)
pruefe("leerer Bestand → still", code_lauf(0, 0), False)


# ---------------------------------------------------------------------------
# 5. host_gesperrt() — Folgemeldungen bei ausgelassenem Host
# ---------------------------------------------------------------------------
# Anlass (30.8.2026): Das Dashboard zählte eine Ursache mehrfach — Europarl mit
# „Host ausgelassen" UND „Entdeckung 0 Treffer", Ekō mit „Host ausgelassen" UND
# „Startdatum rückt nicht nach". Die zweiten Zeilen sind garantierte Folgen der
# ersten. ⚠️ Der Riegel-Befund selbst darf NIE stumm werden; genau das prüft
# der letzte Fall unten, sonst hätte man die Sperre statt des Lärms entfernt.
def gesperrt_lauf(mit, ohne, datum, neue, available, gesperrt):
    core._TLS.platform = "selbsttest"
    core.BEFUNDE.pop("selbsttest", None)
    if gesperrt:
        core.befund("warnung", core.THEMA_HOST_AUSGELASSEN, "x.test: HTTP 429")
    core._TLS.lauf_meta = {"new_petitions_last_run": [f"n{i}" for i in range(neue)],
                           "available": available}
    befunde, _ = core._bestandspruefung(datums_bestand(mit, ohne, datum), {})
    return {b["thema"] for b in befunde}


def entdeckung_meldet(gesperrt) -> bool:
    core._TLS.platform = "selbsttest"
    core.BEFUNDE.pop("selbsttest", None)
    if gesperrt:
        core.befund("warnung", core.THEMA_HOST_AUSGELASSEN, "x.test: HTTP 202")
    core.entdeckung("Testzweig", 0, erwartet_min=10)
    return any(b["thema"].startswith("Entdeckung")
               for b in core.BEFUNDE.get("selbsttest", []))


print()
print("host_gesperrt() — Folgemeldungen unterdrücken")
# ⚠️ Ekō hat available = 39 TROTZ Sperre (der Riegel greift erst nach der
# Entdeckung). Ein Test, der available == 0 als Kennzeichen unterstellt, ginge
# an genau diesem Fall vorbei — deshalb steht hier überall available > 0.
pruefe("gesperrt + neue Sätze (Ekō-Fall) → Stufe 1 still",
       "Startdatum rückt nicht nach" in gesperrt_lauf(100, 0, TAG(225), 1, 39, True),
       False)
pruefe("gesperrt + keine neuen Sätze → auch Stufe 2 still",
       "Bestand altert" in gesperrt_lauf(100, 0, TAG(225), 0, 39, True), False)
pruefe("NICHT gesperrt + neue Sätze (openPetition-Fall) → meldet",
       "Startdatum rückt nicht nach" in gesperrt_lauf(100, 0, TAG(121), 12, 2000, False),
       True)
pruefe("NICHT gesperrt, nichts Neues, sehr alt → Stufe 2 meldet",
       "Bestand altert" in gesperrt_lauf(100, 0, TAG(121), 0, 2000, False), True)
pruefe("gesperrt + 0 Treffer (Europarl-Fall) → Entdeckung still",
       entdeckung_meldet(True), False)
pruefe("NICHT gesperrt + 0 Treffer → Entdeckung meldet",
       entdeckung_meldet(False), True)
# Die Sperrmeldung selbst muss überleben — sonst wäre das Aufräumen ein
# Zudecken.
core._TLS.platform = "selbsttest"
core.BEFUNDE.pop("selbsttest", None)
core.befund("warnung", core.THEMA_HOST_AUSGELASSEN, "x.test: HTTP 429")
core.entdeckung("Testzweig", 0, erwartet_min=10)
pruefe("die Sperrmeldung selbst bleibt stehen",
       any(b["thema"] == core.THEMA_HOST_AUSGELASSEN
           for b in core.BEFUNDE.get("selbsttest", [])), True)


# ---------------------------------------------------------------------------
# 6. felder_gesehen()/felder_melden() — „Neues Feld auf der Quellseite"
#
# Warum es das gibt (30.8.2026): ALLE anderen Melder fragen „fehlt etwas?".
# Keiner fragte „ist etwas NEU da?" — deshalb stand bei europarl seit jeher ein
# ungenutztes Feld `Country` auf jeder Detailseite, und aufgefallen ist es erst
# auf Nachfrage des Users.
#
# ⚠️ Der wichtigste Fall ist der DRITTE: die Menge muss nach dem Melden leer
# sein. Bliebe sie stehen, meldete der nächste Lauf dieselben Felder erneut —
# und weil `monitor.py --all` mehrere Plattformen nebenläufig scrapt, stünden
# fremde Felder in der Meldung der falschen Plattform.
# ---------------------------------------------------------------------------
print()
print("felder_melden() — Neues Feld auf der Quellseite")


def feld_lauf(gesehen, bekannt):
    """(unbekannte Felder, Zahl der Befunde)."""
    core._TLS.platform = "selbsttest"
    core.felder_zuruecksetzen()
    core.BEFUNDE.pop("selbsttest", None)
    core.felder_gesehen(gesehen)
    neu = core.felder_melden(bekannt)
    return neu, len(core.BEFUNDE.get("selbsttest", []))


BEKANNT = {"Topics", "Country", "Name"}
neu, n = feld_lauf(["Topics", "Country", "Name"], BEKANNT)
pruefe("alles bekannt → keine unbekannten Felder", neu, set())
pruefe("alles bekannt → still", n, 0)

neu, n = feld_lauf(["Topics", "Country", "Name", "Date of admissibility"], BEKANNT)
pruefe("neues Feld → wird benannt", neu, {"Date of admissibility"})
pruefe("neues Feld → wird gemeldet", n, 1)

# Ein bewusst VERWORFENES Feld steht in der Liste und darf nicht mehr melden —
# sonst blinkt der Hinweis täglich für etwas, das längst entschieden ist.
neu, n = feld_lauf(["Topics", "Country"], BEKANNT)
pruefe("verworfenes Feld steht in der Liste → still", n, 0)

# Leere Ernte ist kein Ausfall, sondern der Normalfall bei Seiten ohne Tabelle.
neu, n = feld_lauf([], BEKANNT)
pruefe("nichts geerntet → still", n, 0)

# Leerraum und leere Einträge dürfen die Menge nicht aufblähen.
neu, n = feld_lauf(["  Topics  ", "", "   "], BEKANNT)
pruefe("Leerraum wird abgeschnitten, Leeres verworfen", n, 0)

# ⚠️ Der Nachhall-Fall, s. o.
core._TLS.platform = "selbsttest"
core.felder_zuruecksetzen()
core.BEFUNDE.pop("selbsttest", None)
core.felder_gesehen(["Neues Feld"])
core.felder_melden(BEKANNT)
zweiter = core.felder_melden(BEKANNT)
pruefe("zweiter Lauf ohne neue Ernte → still (Menge wurde geleert)",
       zweiter, set())

# ⚠️ Die HÄUFIGKEIT ist die Entscheidungshilfe im Bericht: an innn.it gemessen
# standen über acht Seiten 31 Schlüssel, aber nur 22 auf allen — darunter
# `gclid` und `mtm_campaign`, also Tracking-Parameter statt Inhalte. Ohne die
# Zahl im Text ist ein Ausreißer von einem echten neuen Feld nicht zu
# unterscheiden. Deshalb zählt jede geerntete Seite mit, auch eine LEERE.
core._TLS.platform = "selbsttest"
core.felder_zuruecksetzen()
core.BEFUNDE.pop("selbsttest", None)
for i in range(5):
    core.felder_gesehen(["Immer"] + (["Selten"] if i < 2 else []))
core.felder_melden({"Immer"})
text = (core.BEFUNDE.get("selbsttest") or [{}])[0].get("text", "")
pruefe("Bericht nennt die Häufigkeit (2 von 5 Seiten)", "Selten (2/5)" in text, True)

core._TLS.platform = "selbsttest"
core.felder_zuruecksetzen()
core.BEFUNDE.pop("selbsttest", None)
core.felder_gesehen(["A"])
core.felder_gesehen([])            # leere Ernte MUSS als Seite zählen
core.felder_melden(set())
text = (core.BEFUNDE.get("selbsttest") or [{}])[0].get("text", "")
pruefe("leere Ernte zählt als geprüfte Seite (1/2, nicht 1/1)",
       "A (1/2)" in text, True)


# ---------------------------------------------------------------------------
# 8. Register verworfener Kandidaten (Change.org) und seine Notbremse
# ---------------------------------------------------------------------------
# Der Einsatz ist hier ein anderer als bei entferne_skip: das Register LÖSCHT
# nichts. Bricht es, bleibt der Bestand unversehrt und es kommen nur nie wieder
# neue Petitionen dazu — ein Ausfall, den niemand sieht. Deshalb wird jeder
# Zweig einzeln nachgewiesen, samt Gegenprobe dicht an der Schwelle.
print("\nRegister verworfener Kandidaten (merke_verworfene)")


def register_lauf(bekannt, neu, belegt, max_gesamt=core.VERWORFEN_MAX):
    core._TLS.platform = "selbsttest"
    core.BEFUNDE.pop("selbsttest", None)
    ergebnis = core.merke_verworfene(bekannt, neu, belegt, "Testplattform",
                                     "nicht DE", "not DE",
                                     max_gesamt=max_gesamt)
    warnungen = [b for b in core.BEFUNDE.get("selbsttest", [])
                 if b.get("stufe") == "warnung"]
    return ergebnis, bool(warnungen)


erg, warn = register_lauf({"a": ""}, {"b": "tr/TR", "c": "de/AT"}, belegt=200)
pruefe("normaler Lauf erweitert das Register", sorted(erg), ["a", "b", "c"])
pruefe("normaler Lauf warnt nicht", warn, False)
# ⚠️ Das ist die ERHEBUNG: der Befund muss den Lauf überleben, sonst ist das
# Register nur eine Sperrliste und die Frage „was steckt da drin?" bleibt offen.
pruefe("der Befund wandert mit ins Register", erg.get("c"), "de/AT")

# Der Ernstfall: die Sprachprüfung ist gebrochen, alles gilt als „nicht DE".
erg, warn = register_lauf({"a": ""}, {"b": "", "c": ""}, belegt=0)
pruefe("Bremse greift ohne Positivkontrolle", sorted(erg), ["a"])
pruefe("Bremse meldet sich", warn, True)

# Gegenprobe DICHT AN DER SCHWELLE — ohne sie bewiese der Fall oben nur, dass
# die Funktion manchmal nichts tut.
erg, _ = register_lauf({"a": ""}, {"b": ""},
                       belegt=core.VERWORFEN_BELEG_MIN - 1)
pruefe("Bremse greift eins unter der Schwelle", sorted(erg), ["a"])
erg, warn = register_lauf({"a": ""}, {"b": ""},
                          belegt=core.VERWORFEN_BELEG_MIN)
pruefe("Bremse lässt AUF der Schwelle durch", sorted(erg), ["a", "b"])
pruefe("… und warnt dabei nicht", warn, False)

# Nichts zu vermerken ist kein Ausfall: hier darf die Bremse nicht schreien,
# sonst stünde bei jedem ereignislosen Lauf eine Warnung im Dashboard.
erg, warn = register_lauf({"a": ""}, {}, belegt=0)
pruefe("leere Verwerfungsliste warnt nicht", warn, False)
pruefe("leere Verwerfungsliste lässt das Register unberührt", sorted(erg),
       ["a"])

erg, _ = register_lauf({"a": "", "b": "x"}, {"b": "NEU", "c": ""}, belegt=200)
pruefe("keine Dubletten im Register", sorted(erg), ["a", "b", "c"])
pruefe("ein vorhandener Befund wird NICHT überschrieben", erg.get("b"), "x")

# Deckel: was herausfällt, wird wieder abgerufen — es darf nur nicht STILL
# herausfallen, und es müssen die ÄLTESTEN sein.
erg, _ = register_lauf({"a": "", "b": "", "c": ""}, {"d": ""}, belegt=200,
                       max_gesamt=2)
pruefe("Deckel wirft die ältesten heraus", sorted(erg), ["c", "d"])

# ⚠️ Rückfall auf die frühere reine LISTE (Bestände aus `2b49f13`). Ohne ihn
# verlöre ein solcher Bestand sein ganzes Register, lautlos.
erg, _ = register_lauf(["a", "b"], {"c": "de/AT"}, belegt=200)
pruefe("altes Listen-Register wird übernommen", sorted(erg),
       ["a", "b", "c"])
pruefe("… und ist danach eine Tabelle", erg.get("c"), "de/AT")

# sprachbefund(): die Erhebung selbst
pruefe("sprachbefund liest Sprache UND Land",
       changeorg.sprachbefund('"originalLocale":{"localeCode":"de-AT"}'
                              '"country":{"countryCode":"AT"}'), "de/AT")
pruefe("sprachbefund ohne Felder bleibt leer",
       changeorg.sprachbefund("nichts davon"), "")

# Das Land am Datensatz — bei beiden Plattformen. Heute ist es überall dasselbe
# (die Auswahl lässt ja nur Deutschland durch); erst wenn das Feld verschwindet,
# wird die spätere Erweiterung wieder teuer. ⚠️ Und es darf NICHT ausgeliefert
# werden: die App soll unverändert nur deutsche Petitionen zeigen.
_rec = changeorg.parse_detail(
    '"country":{"countryCode":"DE"}"ask":"Ein Titel"', "https://x.test/p/a")
pruefe("Change.org schreibt das Land mit", (_rec or {}).get("country"), "DE")
import publish as _publish                                       # noqa: E402
pruefe("… liefert es aber NICHT an die App aus",
       "country" in _publish.SLIM_FIELDS, False)
pruefe("europarl kennt die Feldbeschriftung in beiden Sprachen",
       [europarl.SPRACHE[s]["land"] for s in ("de", "en")],
       ["Land", "Country"])

print("\nUnlesbare Seiten (melde_unklare)")


def unklar_lauf(unklar, gelesen):
    core._TLS.platform = "selbsttest"
    core.BEFUNDE.pop("selbsttest", None)
    core.melde_unklare(unklar, gelesen, "Testplattform")
    return bool([b for b in core.BEFUNDE.get("selbsttest", [])
                 if b.get("stufe") == "warnung"])


pruefe("Seitenumbau wird gemeldet", unklar_lauf(90, 100), True)
pruefe("wenige Einzelfälle bleiben still", unklar_lauf(9, 10), False)
pruefe("viele absolut, aber kleiner Anteil bleibt still",
       unklar_lauf(20, 200), False)

print("\nTrennung skip/unklar (scrape_petition)")
# ⚠️ Der Kern der Sache: NUR eine belegte Fremdsprache darf einen Kandidaten
# dauerhaft aus dem Vorrat nehmen. Jede andere Art von „kein Datensatz" muss
# folgenlos bleiben, sonst schreibt ein Parser-Fehler den Vorrat unwiderruflich
# leer.
class FakeAntwort:
    def __init__(self, text, status_code=200):
        self.text, self.status_code = text, status_code
        self.ok = 200 <= status_code < 300


class FakeFetcher:
    def __init__(self, text, status_code=200):
        self._a = FakeAntwort(text, status_code)

    def get(self, url):
        return self._a


core._TLS.platform = "selbsttest"
LAND = '"country":{"countryCode":"%s"}'
TITEL = '"ask":"Ein Titel"'
faelle = [
    ("vollständige DE-Seite → online", f'{LAND % "DE"}{TITEL}', "online"),
    ("belegt anderes Land → skip", f'{LAND % "TR"}{TITEL}', "skip"),
    ("DE, aber kein Titel → unklar (NICHT skip)", LAND % "DE", "unklar"),
    ("Länderfeld fehlt ganz → unklar (NICHT skip)", TITEL, "unklar"),
]
for name, html, soll in faelle:
    status, _ = changeorg.scrape_petition(FakeFetcher(html), "x")
    pruefe(name, status, soll)

pruefe("404 bleibt offline",
       changeorg.scrape_petition(FakeFetcher("", 404), "x")[0], "offline")
pruefe("500 bleibt error",
       changeorg.scrape_petition(FakeFetcher("", 500), "x")[0], "error")

print("\nDas Fenster wandert (offene_kandidaten)")
entdeckt = ["a", "b", "c", "d", "e"]
pruefe("Bestand und Register fallen heraus",
       changeorg.offene_kandidaten(entdeckt, {"a": {}}, ["b", "c"]), ["d", "e"])
pruefe("ohne Register bleibt alles Ungespeicherte stehen",
       changeorg.offene_kandidaten(entdeckt, {"a": {}}, []),
       ["b", "c", "d", "e"])
# Die eigentliche Aussage: mit Register kommt der Lauf an ANDERE Kandidaten als
# ohne. Genau das stand vorher still.
pruefe("mit Register kommen andere Kandidaten dran",
       changeorg.offene_kandidaten(entdeckt, {}, [])[:2]
       != changeorg.offene_kandidaten(entdeckt, {}, ["a", "b"])[:2], True)

print("\nDas Register übersteht eine Speicherung")
# ⚠️ Die Falle, die den ganzen Mechanismus lautlos aushebeln würde: save_store
# baut das _meta bei JEDEM Schreiben neu auf. Wer das Register nicht bei jeder
# Speicherung durchreicht, setzt den Vorrat nach einem Lauf auf null zurück —
# ohne dass irgendetwas kaputtginge.
core._TLS.platform = "selbsttest"
core._TLS.lauf_meta = None
with tempfile.TemporaryDirectory() as ordner:
    pfad = Path(ordner) / "test_petitions.json"
    inhalt = {"a": {"slug": "a", "title": "T", "status": "online"}}
    core.save_store(inhalt, pfad, extra_meta={"verworfen": ["x", "y"]},
                    quiet=True)
    pruefe("mit extra_meta überlebt es", core.load_meta(pfad).get("verworfen"),
           ["x", "y"])
    core.save_store(inhalt, pfad, quiet=True)
    pruefe("ohne extra_meta ist es WEG (deshalb die Zeile in run())",
           core.load_meta(pfad).get("verworfen"), None)


# ---------------------------------------------------------------------------
# 9. Drei echte run()-Durchläufe mit erfundener Quelle
# ---------------------------------------------------------------------------
# ⚠️⚠️ Warum es diesen Abschnitt zusätzlich zu den Einzelfällen braucht: Die
# Einzelfälle prüfen Bausteine. Ob das Register den WEG durch einen ganzen Lauf
# übersteht, prüfen sie nicht — und genau dort liegt die stille Falle. Nimmt
# jemand die frühe Zeile `lauf_meta["verworfen"] = verworfen` heraus, bestehen
# alle Einzelfälle weiter; erst ein Lauf, der MITTENDRIN abbricht (die CI-Frist
# schickt SIGINT, so geschehen am 30.8.2026), verliert dann das Register. Ohne
# Fehlermeldung, ohne Datenverlust — es kämen nur nie wieder neue Petitionen
# dazu. Am Original nachgewiesen: ohne diesen Abschnitt bleibt das Entfernen
# der Zeile von allen anderen Fällen unbemerkt.
print("\nDrei run()-Durchläufe an einer erfundenen Quelle")

LAND, TITEL = '"country":{"countryCode":"%s"}', '"ask":"Titel %s"'
LOCALE = '"originalLocale":{"localeCode":"%s"}'


def _seite(slug: str) -> str:
    """Kunstseite; das Sprachkürzel steckt in den ersten zwei Zeichen des Slugs."""
    k = slug[:2]
    return (LOCALE % f"{k}-{k.upper()}") + (LAND % k.upper()) + (TITEL % slug)


SEITEN = {s: _seite(s)
          for s in ("de1", "de2", "tr1", "tr2", "hu1", "tr3", "tr4", "hu2")}
# 12 bekannte deutsche Sätze: sie liefern die Positivkontrolle des Registers
# (core.VERWORFEN_BELEG_MIN = 10), ohne die es nicht wachsen darf.
SEITEN.update({f"alt{i}": (LOCALE % "de-DE") + (LAND % "DE")
                          + (TITEL % f"alt{i}") for i in range(12)})
ERSTE = ["de1", "de2", "tr1", "tr2", "hu1"]
SPAETER = ERSTE + ["tr3", "tr4", "hu2"]
abgerufen: list[str] = []
grenze = [10 ** 9]


class _Antwort:
    def __init__(self, text):
        self.text, self.status_code, self.ok = text, 200, True


class _Fetcher:
    def __init__(self, *a, **k):
        pass

    def get(self, url):
        abgerufen.append(url.rsplit("/", 1)[-1])
        if len(abgerufen) > grenze[0]:
            raise KeyboardInterrupt("CI-Frist erreicht")
        return _Antwort(SEITEN.get(abgerufen[-1], ""))


_echte = (core.Fetcher, changeorg.discover_slugs, changeorg.heile_abgeschnittene,
          changeorg.DATA_FILE, core.write_list_html)
runde = [0]
core.Fetcher = _Fetcher
core.write_list_html = lambda *a, **k: None
changeorg.heile_abgeschnittene = lambda store, discovered, save: []


def _entdecke(fetcher):
    runde[0] += 1
    return {s: {} for s in (ERSTE if runde[0] == 1 else SPAETER)}


changeorg.discover_slugs = _entdecke
# ⚠️ 99 Stunden: skip_recent hält damit JEDEN bekannten Satz zurück – die Lage
# beim zweiten Lauf eines Tages. Genau dort darf die Notbremse nicht grundlos
# anschlagen, dafür ist die Mindeststichprobe in run() da.
_args = SimpleNamespace(delay=0, limit=0, no_recheck=False,
                        min_interval_hours=99)
try:
    with tempfile.TemporaryDirectory() as ordner:
        changeorg.DATA_FILE = Path(ordner) / "changeorg_petitions.json"
        core.save_store({s: {"slug": s, "title": f"Titel {s}",
                             "status": "online"}
                         for s in SEITEN if s.startswith("alt")},
                        changeorg.DATA_FILE, quiet=True)
        changeorg.run(_args)
        meta1 = core.load_meta(changeorg.DATA_FILE)

        abgerufen.clear()
        changeorg.run(_args)
        kand2 = sorted({s for s in abgerufen if s in SPAETER})
        meta2 = core.load_meta(changeorg.DATA_FILE)

        runde[0] = 0                    # Lauf 3 entdeckt wieder von vorn
        abgerufen.clear()
        grenze[0] = 4                   # Abbruch nach vier Abrufen
        try:
            changeorg.run(_args)
        except KeyboardInterrupt:
            pass
        grenze[0] = 10 ** 9
        meta3 = core.load_meta(changeorg.DATA_FILE)
finally:
    (core.Fetcher, changeorg.discover_slugs, changeorg.heile_abgeschnittene,
     changeorg.DATA_FILE, core.write_list_html) = _echte

soll1 = ["hu1", "tr1", "tr2"]
soll2 = sorted(soll1 + ["hu2", "tr3", "tr4"])
pruefe("Lauf 1 merkt sich die drei fremdsprachigen",
       sorted(meta1.get("verworfen") or []), soll1)
pruefe("Lauf 2 rührt die verworfenen nicht mehr an",
       sorted(s for s in kand2 if s in soll1), [])
pruefe("Lauf 2 arbeitet genau die NEUEN Kandidaten ab", kand2,
       ["hu2", "tr3", "tr4"])
pruefe("Lauf 2 warnt nicht, obwohl skip_recent alles sperrt",
       [b["thema"] for b in (meta2.get("befunde") or [])
        if b.get("stufe") == "warnung"], [])
pruefe("Register wächst über die Läufe",
       sorted(meta2.get("verworfen") or []), soll2)
# ⚠️ Ohne diesen Fall bliebe unbemerkt, wenn die ERHEBUNG still leer liefe: das
# Register spränge weiter richtig an, nur wüsste hinterher niemand, WAS in den
# verworfenen Kandidaten steckte. Am Mutationstest aufgefallen, nicht erdacht.
pruefe("Register hält den Befund je Kandidat fest",
       [(meta2.get("verworfen") or {}).get(s) for s in ("tr1", "hu2")],
       ["tr/TR", "hu/HU"])
pruefe("Register übersteht einen ABGEBROCHENEN Lauf",
       sorted(meta3.get("verworfen") or []), soll2)


# ---------------------------------------------------------------------------
print()
if fehler:
    print(f"::error::selbsttest.py: {len(fehler)} Fall/Fälle fehlgeschlagen "
          f"({', '.join(fehler[:5])}{', …' if len(fehler) > 5 else ''})")
    sys.exit(1)
print("selbsttest.py: alle Fälle bestanden.")
