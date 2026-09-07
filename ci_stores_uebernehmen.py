#!/usr/bin/env python3
"""Jüngere Repo-Stores automatisch übernehmen (Schritt in scrape.yml).

ZWECK: europarl und die WeMove-Zweige werden auf dem Rechner des Nutzers
gescrapt (die WAFs sperren Rechenzentren, siehe Dashboard-Vermerk
LOKALE_PFLEGE) und als *_petitions.json ins Repo gepusht. Der Actions-Cache
überschreibt beim Restore aber genau diese Dateien. Dieser Schritt holt die
Repo-Fassung zurück — und zwar NUR, wenn sie nachweislich jünger ist.

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

    uebernommen = 0
    for name in namen:
        try:
            zeig = subprocess.run(["git", "show", f"HEAD:{name}"],
                                  capture_output=True, text=True, check=True)
            repo = json.loads(zeig.stdout)
        except (subprocess.SubprocessError, OSError, ValueError) as e:
            print(f"::warning title=Store-Übernahme::{name}: Repo-Fassung "
                  f"nicht lesbar ({e}) – Cache-Stand bleibt.")
            continue
        pfad = Path(name)
        cache = None
        if pfad.exists():
            try:
                cache = json.loads(pfad.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                print(f"::warning title=Store-Übernahme::{name}: Cache-Fassung "
                      f"nicht lesbar ({e}) – Repo-Fassung wird genommen.")
        if entscheide(repo, cache) != "repo":
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

    print(f"Store-Übernahme geprüft: {len(namen)} Repo-Stores, "
          f"{uebernommen} übernommen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
