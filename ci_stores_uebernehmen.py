#!/usr/bin/env python3
"""Jüngere Repo-Stores automatisch übernehmen (Schritt in scrape.yml).

ZWECK: europarl und die WeMove-Zweige werden auf dem Rechner des Nutzers
gescrapt (die WAFs sperren Rechenzentren, siehe Dashboard-Vermerk
LOKALE_PFLEGE) und als *_petitions.json ins Repo gepusht. Der Actions-Cache
überschreibt beim Restore aber genau diese Dateien. Dieser Schritt holt die
Repo-Fassung zurück — und zwar NUR für die lokal gepflegten Bestände und
NUR, wenn sie nachweislich jünger ist.

GELTUNGSBEREICH (seit 17.9.2026): core.LOKALE_PFLEGE + BEFRISTET_LOKAL.
Vorher lief die Schleife über `git ls-files "*_petitions.json"`, also über
alle 21 versionierten Bestände — auch über die 15, die die CI selbst
pflegt. Deren Repo-Stand ist ein Standbild vom letzten Push und liegt weit
hinter dem Cache-Stand (changeorg: 457 Sätze im Repo gegen 2.555 live).
⚠️ Das war eine GESTELLTE FALLE, kein laufender Datenverlust: keiner dieser
Repo-Stände konnte gewinnen, weil „Repo ohne lauf_verlauf → Cache" gilt und
changeorg im Repo keinen einzigen lauf_verlauf-Eintrag hat (gemessen
17.9.2026 über alle 21 Bestände). Scharf würde die Falle in dem Moment, in
dem so ein Bestand einmal LOKAL läuft und mit lauf_verlauf gepusht wird —
genau das ist für Change.org geplant (einmaliges Abtragen des
Kandidatenrückstands). Die Eingrenzung kommt deshalb VOR dem ersten lokalen
Lauf, nicht nach dem ersten Verlust.
⚠️ Sie kostet nichts: die Repo-Fassung liegt nach dem Checkout ohnehin auf
der Platte, dieser Schritt macht nur den Cache-Restore rückgängig. Fällt
der Cache ganz aus, bleibt der Repo-Stand also von allein stehen — der
Rückfall „Fallback: Stand im Repo" aus dem Cache-Schritt bleibt erhalten.
Was übersprungen wird, wird GENANNT (Sammelzeile) — ein stiller Ausschluss
wäre so schlecht wie die stille Übernahme. Und wo der alte Code den
Repo-Stand genommen HÄTTE, gibt es eine ::warning: das ist die Reißleine,
falls die Falle doch einmal scharf wird.

MASSSTAB ist der Zeitstempel des LETZTEN Eintrags in _meta.lauf_verlauf,
also der letzte ABGESCHLOSSENE Lauf:
- ⚠️ NICHT generated_at: das frischt bei jedem Befund-Save auf — ein
  gesperrter Host bekäme im CI täglich einen neuen Stempel, und der lokal
  gepflegte Repo-Stand verlöre den Vergleich für immer.
- ⚠️ Verglichen wird über datetime.fromisoformat, NIE als Zeichenkette:
  die Bestände mischen +00:00 (CI) und -06:00 (lokal), als Text stünde
  „04:00-06:00" vor „05:00+00:00", obwohl es später ist.

Damit gewinnt ein später doch erfolgreicher CI-Scrape automatisch wieder
(sein Abschluss-Save ist dann der jüngste) — der alte Einwand gegen ein
pauschales „Repo schlägt Cache" ist genau dadurch ausgeräumt.

Der Schritt darf den Lauf NIE kippen: jede Störung wird als ::warning
gemeldet, Exit-Code ist immer 0, der Lauf geht mit dem Cache-Stand weiter.
Die Schlusszeile kommt IMMER — fehlt sie, ist das Skript nicht gelaufen.
Das manuelle store_aus_repo (Zwangs-Override) läuft NACH diesem Schritt
und behält das letzte Wort.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Geltungsbereich: welche Bestände dieser Schritt überhaupt anfassen darf
# ---------------------------------------------------------------------------
# WARUM core.LOKALE_PFLEGE der richtige Schalter ist — und warum er allein
# nicht reicht:
# LOKALE_PFLEGE sagt in petitions_core.py DREI Dinge auf einmal:
#   (1) die Quelle sperrt automatische Abrufe aus der CI dauerhaft (WAF),
#   (2) die Dashboard-Kachel trägt den Vermerk „wird manuell per lokalem
#       Lauf aufgefüllt",
#   (3) bleibt der letzte abgeschlossene Lauf länger als
#       LOKALE_PFLEGE_MAX_TAGE (4) aus, wird die Kachel ROT.
# Für die dauerhaft gesperrten Zweige (europarl, wemove_en/fr/it/nl/pl) ist
# genau das gemeint: der lokale Lauf ist dort der EINZIGE Weg, sein
# Ausbleiben ist ein Fehler, und dieselbe Menge muss deshalb auch hier die
# Übernahme steuern. Ein zweiter Schalter für dieselbe Menge wäre eine
# Dublette, die auseinanderliefe.
#
# Ein Bestand, der nur AUF ZEIT lokal gepflegt wird — Change.org soll
# einmalig lokal den Kandidatenrückstand abtragen —, gehört dort aber NICHT
# hinein:
#   - (1) wäre unwahr: die CI erreicht Change.org täglich,
#   - (3) würde vier Tage nach dem Ende der Aktion dauerhaft rot warnen,
#     obwohl nichts kaputt ist (ein Melder, der immer schreit, ist keiner),
#   - und (2) trägt nichts bei: welche Zweige der PC-Timer scrapt, steht
#     ohnehin als eigene, fest verdrahtete Liste in lokaler_pflege_lauf.sh —
#     ein Eintrag in LOKALE_PFLEGE startet dort gar nichts.
# Deshalb hier ein ZWEITER, ausdrücklicher Schalter. Er steht bewusst in
# DIESER Datei: er betrifft nur die Übernahme, nicht die Anzeige.
#
# ⚠️ Jeder Eintrag ist ein Versprechen: „für diesen Bestand ist der
# Repo-Stand gepflegt und darf den Cache-Stand ersetzen, sobald sein
# lauf_verlauf jünger ist." Nach dem Ende der Aktion gehört er wieder RAUS —
# sonst schlägt ein alter lokaler Stand irgendwann einen frischen CI-Stand.
BEFRISTET_LOKAL: frozenset[str] = frozenset()

# Der Import darf den Schritt nicht kippen (Exit 0 ist zugesagt). Scheitert
# er, läuft der Schritt OHNE Geltungsbereich weiter — und das heißt hier
# „nichts übernehmen", nicht „über alles laufen": ohne LOKALE_PFLEGE ist
# nicht entscheidbar, welcher Bestand lokal gepflegt wird, und der
# Cache-Stand ist die sichere Vorgabe.
try:
    from petitions_core import LOKALE_PFLEGE as _LOKALE_PFLEGE
    _IMPORT_FEHLER: Exception | None = None
except Exception as _e:  # ImportError, fehlende Abhängigkeit, Syntaxfehler …
    _LOKALE_PFLEGE = frozenset()
    _IMPORT_FEHLER = _e

SUFFIX = "_petitions.json"


def uebernahme_menge() -> frozenset[str]:
    """Plattform-Schlüssel, deren Repo-Stand übernommen werden darf."""
    return frozenset(_LOKALE_PFLEGE) | BEFRISTET_LOKAL


def schluessel(name: str) -> str:
    """Plattform-Schlüssel zum Dateinamen: changeorg_petitions.json → changeorg.

    Geprüft am 17.9.2026 gegen die Registry (monitor.PLATFORMS): alle 41
    Einträge heißen genau <key>_petitions.json, und `git ls-files` liefert
    nur Treffer auf dieses Muster.
    """
    return Path(name).name.removesuffix(SUFFIX)


def letzter_lauf(store: dict) -> datetime | None:
    """Zeitpunkt des letzten abgeschlossenen Laufs oder None."""
    try:
        verlauf = (store.get("_meta") or {}).get("lauf_verlauf") or []
        return datetime.fromisoformat(verlauf[-1]["zeit"])
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def satzzahl(store: dict) -> int:
    return sum(1 for k in store if not k.startswith("_"))


def entscheide(repo: dict | None, cache: dict | None) -> str:
    """'repo' | 'cache' — wer den Zuschlag bekommt.

    cache=None  -> Datei fehlt auf der Platte (neue Plattform) -> repo.
    repo ohne lauf_verlauf -> nie bevorzugen (kein Beleg für Frische).
    cache ohne lauf_verlauf, repo mit -> repo (der einzige Beleg zählt).
    beide mit -> der jüngere Abschluss gewinnt, bei Gleichstand der Cache
    (kein Grund, eine identisch alte Datei zu ersetzen).
    """
    if repo is None:
        return "cache"
    if cache is None:
        return "repo"
    r, c = letzter_lauf(repo), letzter_lauf(cache)
    if r is None:
        return "cache"
    if c is None:
        return "repo"
    return "repo" if r > c else "cache"


def main() -> int:
    try:
        namen = subprocess.run(
            ["git", "ls-files", "*_petitions.json"],
            capture_output=True, text=True, check=True,
        ).stdout.split()
    except (subprocess.SubprocessError, OSError) as e:
        print(f"::warning title=Store-Übernahme::git ls-files scheiterte: {e}")
        print("Store-Übernahme geprüft: 0 Repo-Stores, 0 übernommen (Abbruch).")
        return 0

    menge = uebernahme_menge()
    if _IMPORT_FEHLER is not None:
        print(f"::warning title=Store-Übernahme::petitions_core nicht "
              f"importierbar ({_IMPORT_FEHLER}) – ohne LOKALE_PFLEGE wird "
              f"nichts übernommen, der Cache-Stand gilt.")
    fehlend = sorted(menge - {schluessel(n) for n in namen})
    if fehlend:
        # Nicht still: ein lokal gepflegter Bestand ohne versionierte Datei
        # wird hier nie ankommen, egal wie fleißig der PC-Timer läuft.
        print(f"::warning title=Store-Übernahme::Kein versionierter Store für "
              f"{', '.join(fehlend)} – Übernahme unmöglich.")

    uebernommen = 0
    uebersprungen: list[str] = []
    for name in namen:
        key = schluessel(name)
        gepflegt = key in menge
        try:
            zeig = subprocess.run(["git", "show", f"HEAD:{name}"],
                                  capture_output=True, text=True, check=True)
            repo = json.loads(zeig.stdout)
        except (subprocess.SubprocessError, OSError, ValueError) as e:
            if gepflegt:
                print(f"::warning title=Store-Übernahme::{name}: Repo-Fassung "
                      f"nicht lesbar ({e}) – Cache-Stand bleibt.")
            else:
                uebersprungen.append(key)
            continue
        pfad = Path(name)
        cache = None
        if pfad.exists():
            try:
                cache = json.loads(pfad.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                if gepflegt:
                    print(f"::warning title=Store-Übernahme::{name}: "
                          f"Cache-Fassung nicht lesbar ({e}) – Repo-Fassung "
                          f"wird genommen.")
        urteil = entscheide(repo, cache)
        if not gepflegt:
            # Übersprungen — aber nicht blind: wir rechnen die alte Regel
            # trotzdem durch (kostet 1,9 s über alle 21 Bestände, gemessen
            # 17.9.2026). Sagt sie „repo", stünde hier ein Rückfall auf ein
            # Standbild bevor; das ist die einzige Lage, in der die frühere
            # Fassung dieses Skripts Daten verloren hätte.
            uebersprungen.append(key)
            if urteil == "repo":
                print(f"::warning title=Store-Übernahme::{key}: von der CI "
                      f"gepflegt, deshalb NICHT übernommen – der Repo-Stand "
                      f"({satzzahl(repo)} Sätze) gälte nach der alten Regel "
                      f"aber als der jüngere. Gehört der Bestand inzwischen "
                      f"in BEFRISTET_LOKAL, oder hat ein abgebrochener Lauf "
                      f"dem Cache-Stand den lauf_verlauf gekostet?")
            continue
        if urteil != "repo":
            continue
        try:
            pfad.write_text(zeig.stdout, encoding="utf-8")
        except OSError as e:
            print(f"::warning title=Store-Übernahme::{name}: Schreiben "
                  f"scheiterte ({e}).")
            continue
        uebernommen += 1
        r_zeit = letzter_lauf(repo)
        n_cache = satzzahl(cache) if cache is not None else 0
        print(f"::notice title=Store-Übernahme::{name}: Repo-Stand "
              f"(letzter Lauf {r_zeit:%Y-%m-%d %H:%M}) ersetzt den "
              f"Cache-Stand – {n_cache} → {satzzahl(repo)} Sätze.")

    if uebersprungen:
        print("Store-Übernahme übersprungen (von der CI gepflegt, Cache-Stand "
              "bleibt): " + ", ".join(sorted(uebersprungen)))
    print(f"Store-Übernahme geprüft: {len(namen) - len(uebersprungen)} von "
          f"{len(namen)} Repo-Stores (lokal gepflegt: "
          f"{', '.join(sorted(menge)) or '—'}), {uebernommen} übernommen, "
          f"{len(uebersprungen)} übersprungen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
