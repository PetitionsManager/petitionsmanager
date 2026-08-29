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
from datetime import date, timedelta

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


def datums_lauf(mit: int, ohne: int, datum: str, neue: int) -> bool:
    core._TLS.platform = "selbsttest"
    core._TLS.lauf_meta = {"new_petitions_last_run": [f"n{i}"
                                                      for i in range(neue)]}
    core.BEFUNDE.pop("selbsttest", None)
    befunde, _ = core._bestandspruefung(datums_bestand(mit, ohne, datum), {})
    return any(b["thema"] == "Startdatum rückt nicht nach" for b in befunde)


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
print()
if fehler:
    print(f"::error::selbsttest.py: {len(fehler)} Fall/Fälle fehlgeschlagen "
          f"({', '.join(fehler[:5])}{', …' if len(fehler) > 5 else ''})")
    sys.exit(1)
print("selbsttest.py: alle Fälle bestanden.")
