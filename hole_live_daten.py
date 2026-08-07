#!/usr/bin/env python3
"""Holt den veröffentlichten Datenstand von GitHub Pages nach webapp/data.

WARUM ES DAS GIBT
-----------------
Die APK bündelt den Ordner `webapp/` als Assets (android/app/build.gradle:
`assets.srcDirs += ['../../webapp']`). Der Ordner kam aus dem Repo-Checkout —
und dort veraltete er, weil `scrape.yml` seine Ergebnisse über
`actions/deploy-pages` als ARTEFAKT ausliefert und nicht per Commit. Ergebnis:
Pages war tagesaktuell, die APK trug den Stand des letzten Handgriffs. Am
7.8.2026 waren das 14.354 gegen 17.383 Petitionen, also über einen Monat
Rückstand, der täglich wuchs.

WARUM NICHT EINFACH TÄGLICH COMMITTEN
-------------------------------------
Gemessen am 7.8.2026: `webapp/data` stellt mit 68,9 MB bereits 67 % des ganzen
Repos — bei gerade einmal VIER Datenständen in der Historie. Ein Stand kostet
gepackt rund 17 MB. Wöchentliche Commits wären ~880 MB im Jahr, tägliche über
6 GB; GitHub empfiehlt unter 1 GB. Der Kopf von `scrape.yml` hält dieselbe
Regel schon fest: der Scraper-Zustand lebt im Actions-Cache, damit das Repo
nicht mit jedem Lauf wächst. Diese Datei zieht die Konsequenz für die andere
Richtung: die APK holt sich die Daten dort, wo sie ohnehin frisch liegen.

WAS ES PRÜFT, BEVOR ES ETWAS ANFASST
------------------------------------
Ein halber Datensatz ist schlimmer als ein alter: die Liste einer Plattform
verweist über das Feld `tc` auf ihr Volltext-Paket, fehlt das Paket, öffnet
sich in der App eine Petition ohne Text. Deshalb wird ALLES erst in einen
Nebenordner geladen und geprüft — Listen parsen, Anzahl gegen das Manifest,
jeder tc-Verweis auf ein vorhandenes Paket, Stichprobe auf den Volltext
selbst. Erst danach wird umgehängt, und das Manifest kommt ZULETZT: bräche
der Vorgang mittendrin ab, zeigte sonst ein neues Manifest auf alte Dateien.

Aufruf:
    python3 hole_live_daten.py                # holt und prüft, bricht sonst ab
    python3 hole_live_daten.py --pruefen      # nur melden, nichts schreiben
    python3 hole_live_daten.py --ziel ORDNER  # anderes Ziel als webapp/data
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

BASIS = "https://petitionsmanager.github.io/petitionsmanager/data/"
ZIEL_VORGABE = Path(__file__).resolve().parent / "webapp" / "data"
PARALLEL = 8
ZEITLIMIT = 120


def log(text: str) -> None:
    print(text, flush=True)


def hol_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=ZEITLIMIT) as antwort:
        return antwort.read()


def lade_manifest() -> dict:
    log(f"Manifest holen: {BASIS}manifest.json")
    roh = hol_bytes(BASIS + "manifest.json")
    manifest = json.loads(roh)
    if not manifest.get("platforms"):
        raise SystemExit("::error::Manifest ohne Plattformen – Abbruch.")
    return manifest


def dateiliste(manifest: dict) -> list[str]:
    """Alle Dateien, die zu diesem Manifest gehören.

    Die Liste wird AUS dem Manifest abgeleitet und nicht geraten: `tv` nennt je
    Plattform die Nummern der Volltext-Pakete samt Inhaltskennung. Was dort
    nicht steht, gehört nicht dazu — genau daran erkennt man auch die
    verwaisten Pakete früherer Stände."""
    namen = []
    for p in manifest["platforms"]:
        namen.append(f"{p['key']}.json")
        for nummer in (p.get("tv") or {}):
            namen.append(f"{p['key']}.t{nummer}.json")
    return namen


def lade_alles(namen: list[str], ordner: Path) -> int:
    def einzeln(name: str) -> int:
        daten = hol_bytes(BASIS + name)
        (ordner / name).write_bytes(daten)
        return len(daten)

    bytes_gesamt = 0
    fehler: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(PARALLEL) as pool:
        auftraege = {pool.submit(einzeln, n): n for n in namen}
        for fertig in concurrent.futures.as_completed(auftraege):
            try:
                bytes_gesamt += fertig.result()
            except Exception as exc:                      # noqa: BLE001
                fehler.append(f"{auftraege[fertig]}: {exc}")
    if fehler:
        for f in fehler[:5]:
            log(f"  FEHLER {f}")
        raise SystemExit(f"::error::{len(fehler)} Datei(en) nicht ladbar – Abbruch.")
    return bytes_gesamt


def pruefe(manifest: dict, ordner: Path) -> int:
    """Vollständigkeit und innere Stimmigkeit. Gibt die Zahl der Sätze zurück."""
    probleme: list[str] = []
    summe = 0
    for p in manifest["platforms"]:
        key = p["key"]
        try:
            saetze = json.loads((ordner / f"{key}.json").read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            probleme.append(f"{key}: Liste unlesbar ({exc})")
            continue
        if not isinstance(saetze, list):
            probleme.append(f"{key}: Liste ist kein Array")
            continue
        summe += len(saetze)
        if p.get("count") is not None and len(saetze) != p["count"]:
            probleme.append(f"{key}: {len(saetze)} Sätze, Manifest sagt {p['count']}")

        tv = p.get("tv") or {}
        verweise = {r.get("tc") for r in saetze
                    if isinstance(r, dict) and isinstance(r.get("tc"), int)}
        ohne_paket = sorted(t for t in verweise
                            if str(t) not in tv or not (ordner / f"{key}.t{t}.json").exists())
        if ohne_paket:
            probleme.append(f"{key}: tc-Verweise ohne Paket: {ohne_paket[:5]}")
            continue

        # Stichprobe: steht der Volltext des ersten verweisenden Satzes wirklich
        # in seinem Paket? Ein vorhandenes, aber leeres Paket fiele oben nicht auf.
        probe = next((r for r in saetze
                      if isinstance(r, dict) and isinstance(r.get("tc"), int)), None)
        if probe:
            try:
                paket = json.loads(
                    (ordner / f"{key}.t{probe['tc']}.json").read_text(encoding="utf-8"))
            except (ValueError, OSError) as exc:
                probleme.append(f"{key}: Paket t{probe['tc']} unlesbar ({exc})")
                continue
            if probe.get("url") not in paket:
                probleme.append(
                    f"{key}: Volltext von {str(probe.get('url'))[:50]} fehlt in "
                    f"t{probe['tc']}")

    if probleme:
        for p in probleme:
            log(f"  PROBLEM {p}")
        raise SystemExit(f"::error::{len(probleme)} Unstimmigkeit(en) im "
                         f"Datenstand – nichts übernommen.")
    return summe


def uebernimm(quelle: Path, ziel: Path, namen: list[str]) -> tuple[int, int]:
    """Dateien umhängen. Das Manifest ZULETZT (siehe Kopfkommentar)."""
    ziel.mkdir(parents=True, exist_ok=True)
    for name in sorted(set(namen)):
        shutil.copyfile(quelle / name, ziel / name)
    shutil.copyfile(quelle / "manifest.json", ziel / "manifest.json")

    gehoert_dazu = set(namen) | {"manifest.json"}
    verwaist = sorted(n for n in os.listdir(ziel) if n not in gehoert_dazu)
    for name in verwaist:
        os.remove(ziel / name)
    return len(gehoert_dazu), len(verwaist)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pruefen", action="store_true",
                    help="nur holen und prüfen, nichts nach webapp/data schreiben")
    ap.add_argument("--ziel", default=str(ZIEL_VORGABE),
                    help="Zielordner (Vorgabe: webapp/data)")
    args = ap.parse_args()
    ziel = Path(args.ziel)

    try:
        manifest = lade_manifest()
    except (urllib.error.URLError, OSError, ValueError) as exc:
        log(f"::error::Datenstand nicht erreichbar ({exc}).")
        log("Ohne frische Daten wird NICHT gebaut – eine APK mit altem Stand "
            "sähe fertig aus und wäre es nicht. Lauf später erneut starten.")
        return 1

    stand = manifest.get("generated_at", "unbekannt")
    namen = dateiliste(manifest)
    log(f"Datenstand {stand} · {len(namen) + 1} Dateien")

    with tempfile.TemporaryDirectory(prefix="pm-daten-") as tmp:
        zwischen = Path(tmp)
        (zwischen / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        bytes_gesamt = lade_alles(namen, zwischen)
        log(f"geladen: {len(namen)} Dateien, {bytes_gesamt / 1e6:.1f} MB")

        summe = pruefe(manifest, zwischen)
        log(f"geprüft: {summe} Petitionen, alle Listen und Volltext-Verweise stimmig")

        if args.pruefen:
            log("--pruefen: nichts geschrieben.")
            return 0

        anzahl, verwaist = uebernimm(zwischen, ziel, namen)
        log(f"übernommen nach {ziel}: {anzahl} Dateien"
            + (f", {verwaist} verwaiste entfernt" if verwaist else ""))

    # Für die nachfolgenden Schritte des Workflows (Artefaktname).
    schritt_ausgabe = os.environ.get("GITHUB_OUTPUT")
    if schritt_ausgabe:
        with open(schritt_ausgabe, "a", encoding="utf-8") as fh:
            fh.write(f"stand={str(stand)[:10]}\n")
            fh.write(f"petitionen={summe}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
