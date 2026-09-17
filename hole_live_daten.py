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
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

BASIS = "https://petitionsmanager.github.io/petitionsmanager/data/"
ZIEL_VORGABE = Path(__file__).resolve().parent / "webapp" / "data"
PARALLEL = 8
ZEITLIMIT = 120
VERSUCHE = 3          # je Datei, siehe hol_bytes
WARTE_BASIS = 2.0     # Sekunden; verdoppelt sich je Versuch (2 s, 4 s)

# Erlaubte Dateinamen aus dem Manifest. Alles andere (Schraegstrich, "..",
# absolute Pfade) koennte beim Schreiben aus webapp/data ausbrechen: ein
# manipuliertes Pages-Manifest duerfte sonst beliebige .json-Dateien auf den
# Runner schreiben, unmittelbar bevor webapp/ in die APK gebuendelt wird.
_SICHERER_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*\.json$", re.I)


def _sicherer_dateiname(name: str) -> bool:
    return bool(_SICHERER_NAME.match(name)) and name == Path(name).name


def log(text: str) -> None:
    print(text, flush=True)


def hol_bytes(url: str, versuche: int = VERSUCHE) -> bytes:
    """Eine Datei holen, mit Wiederholung bei vorübergehenden Störungen.

    ⚠️ WARUM DAS SEIN MUSS (10.8.2026): vorher stand hier ein einzelner
    urlopen ohne jede Wiederholung. Der Bau lädt aber ÜBER HUNDERT Dateien,
    und es genügt EINE, die einmal danebengeht, um den ganzen APK-Lauf
    abzubrechen — genau das ist an dem Tag passiert (Lauf #32, „1 Datei(en)
    nicht ladbar"). Nachgemessen waren Minuten später wieder alle 102 Dateien
    mit HTTP 200 da; es war also kein fehlender Datenstand, sondern ein
    Aussetzer. Bei 102 Einzelabrufen ist selbst eine Fehlerquote von 0,5 % je
    Datei mit rund 40 % Wahrscheinlichkeit einmal dabei.

    Nicht wiederholt wird bei 404/410: was es nicht gibt, gibt es auch beim
    dritten Versuch nicht — das wäre ein echter Befund und soll sofort
    auffallen."""
    letzter: Exception | None = None
    for n in range(versuche):
        try:
            with urllib.request.urlopen(url, timeout=ZEITLIMIT) as antwort:
                return antwort.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 410):
                raise
            letzter = exc
        except (urllib.error.URLError, OSError) as exc:
            letzter = exc
        if n + 1 < versuche:
            time.sleep(WARTE_BASIS * (2 ** n))
    raise letzter if letzter else RuntimeError(f"unerreichbar: {url}")


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
    verwaisten Pakete früherer Stände.

    ⚠️ `tv` deckt aber NUR die Basissprache ab. Die fremdsprachigen Pakete
    heißen `<key>.<lg>.t<n>.json` und stehen unter `tvl` (publish.py,
    write_texts mit `sprache=`). Bis zum 17.9.2026 las diese Funktion nur
    `tv` — damit fehlten 15 Pakete mit 3,0 MB in jeder gebauten APK
    (europarl.de 13, openpetition.en 1, avaaz.en 1; zusammen 1.922
    Datensätze). Auf Pages lagen sie die ganze Zeit mit HTTP 200 bereit; wer
    eine europarl-Petition auf Deutsch aufklappte, sah trotzdem keinen Text.
    Wer hier ein Feld ergänzt, ergänzt es auch in `verweise_aus_saetzen`."""
    namen = []
    for p in manifest["platforms"]:
        namen.append(f"{p['key']}.json")
        for nummer in (p.get("tv") or {}):
            namen.append(f"{p['key']}.t{nummer}.json")
        for sprache, kennungen in (p.get("tvl") or {}).items():
            for nummer in (kennungen or {}):
                namen.append(f"{p['key']}.{sprache}.t{nummer}.json")
    unsicher = [n for n in namen if not _sicherer_dateiname(n)]
    if unsicher:
        for n in unsicher[:5]:
            log(f"  UNSICHER {n!r}")
        raise SystemExit(f"::error::Manifest nennt unsichere Dateinamen "
                         f"({len(unsicher)}) – Abbruch, nichts geladen.")
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
        for f in fehler:
            log(f"  FEHLER {f}")
        # ⚠️ Die Namen gehören IN die ::error::-Zeile, nicht nur ins Protokoll.
        # Am 10.8.2026 stand in der Anmerkung nur „1 Datei(en) nicht ladbar";
        # welche und warum, hätte im Protokoll gestanden — und das ist ohne
        # GitHub-Token nicht abrufbar (HTTP 403). Die Anmerkung dagegen liest
        # jeder über /commits/<sha>/check-runs. Eine Fehlermeldung, die den
        # Fehler nicht benennt, kostet genau die Zeit, die sie sparen soll.
        raise SystemExit(
            f"::error::{len(fehler)} von {len(namen)} Datei(en) nicht ladbar "
            f"(nach je {VERSUCHE} Versuchen) – Abbruch. "
            + " · ".join(fehler[:3])
            + (f" · … und {len(fehler) - 3} weitere" if len(fehler) > 3 else ""))
    return bytes_gesamt


def verweise_aus_saetzen(key: str, saetze: list) -> dict[str, tuple[str, dict]]:
    """Welche Volltext-Pakete verlangen DIE DATENSÄTZE selbst?

    Rückgabe: {dateiname: (paketreihe, erster verweisender Satz)}. Die
    Basissprache meldet sich über `tc`, jede Fremdsprache über
    `i18n[<lg>].tc`; die Reihe ist `<key>` bzw. `<key>.<lg>`.

    ⚠️ WARUM AUS DEN SÄTZEN UND NICHT AUS DEM MANIFEST (17.9.2026): `pruefe`
    las vorher `tv` — also genau die Quelle, aus der `dateiliste()` ihre
    Auswahl bildet. Damit prüfte sie ihre eigene Auswahl und konnte per
    Bauart nichts vermissen: sie meldete „alle Listen und Volltext-Verweise
    stimmig", während 15 fremdsprachige Pakete fehlten. Die Datensätze sind
    die unabhängige Quelle — sie nennen ihren Text, ganz gleich, was das
    Manifest aufzählt. Wer hier ein Feld ergänzt, ergänzt es auch in
    `dateiliste`."""
    gebraucht: dict[str, tuple[str, dict]] = {}
    for r in saetze:
        if not isinstance(r, dict):
            continue
        paare: list[tuple[str | None, object]] = [(None, r.get("tc"))]
        for lg, blk in (r.get("i18n") or {}).items():
            if isinstance(lg, str) and isinstance(blk, dict):
                paare.append((lg, blk.get("tc")))
        for lg, nummer in paare:
            # bool ist in Python ein int – ein "tc": true wäre sonst Paket 1.
            if not isinstance(nummer, int) or isinstance(nummer, bool):
                continue
            reihe = key if lg is None else f"{key}.{lg}"
            gebraucht.setdefault(f"{reihe}.t{nummer}.json", (reihe, r))
    return gebraucht


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

        gebraucht = verweise_aus_saetzen(key, saetze)

        # Die Namen entstehen hier aus FREMDEN Daten (Sprachkürzel und
        # Paketnummer kommen aus dem Datensatz). Ohne diese Sperre läse ein
        # manipulierter Satz über "../.." aus dem Zielordner heraus.
        unsicher = sorted(n for n in gebraucht if not _sicherer_dateiname(n))
        if unsicher:
            probleme.append(f"{key}: unsichere Paketnamen im Datensatz: "
                            f"{unsicher[:3]}")
            continue

        # (1) Liegt jedes verlangte Paket wirklich auf der Platte? Das ist die
        # Frage, an der die alte Prüfung vorbeisah – sie verglich die Sätze
        # gegen `tv` und damit gegen ihre eigene Auswahl.
        fehlend = sorted(n for n in gebraucht if not (ordner / n).exists())
        if fehlend:
            probleme.append(f"{key}: {len(fehlend)} Volltext-Paket(e) nicht "
                            f"geladen: {fehlend[:5]}"
                            + (f" … +{len(fehlend) - 5}" if len(fehlend) > 5 else ""))
            continue

        # (2) Kennt das Manifest sie auch? Eigene Fehlerklasse: hier stimmt
        # nicht der Download, sondern publish.py hat ein Paket geschrieben,
        # ohne es unter `tv`/`tvl` zu nennen. Fiele sonst erst beim nächsten
        # Lauf auf, wenn uebernimm() es als verwaist löscht.
        bekannt = {f"{key}.t{n}.json" for n in (p.get("tv") or {})}
        for lg, kennungen in (p.get("tvl") or {}).items():
            bekannt |= {f"{key}.{lg}.t{n}.json" for n in (kennungen or {})}
        ungenannt = sorted(set(gebraucht) - bekannt)
        if ungenannt:
            probleme.append(f"{key}: {len(ungenannt)} benutzte(s) Paket(e) "
                            f"stehen in keinem Manifest-Feld: {ungenannt[:5]}")
            continue

        # (3) Stichprobe je PAKETREIHE – Basissprache und jede Fremdsprache
        # einzeln. Ein vorhandenes, aber leeres Paket fiele oben nicht auf,
        # und eine je Plattform reichte nicht: sie träfe immer die deutsche
        # Reihe und ließe die fremdsprachige ungeprüft.
        proben: dict[str, tuple[str, dict]] = {}
        for name, (reihe, satz) in gebraucht.items():
            proben.setdefault(reihe, (name, satz))
        for reihe, (name, satz) in sorted(proben.items()):
            try:
                paket = json.loads((ordner / name).read_text(encoding="utf-8"))
            except (ValueError, OSError) as exc:
                probleme.append(f"{key}: Paket {name} unlesbar ({exc})")
                continue
            # Auch im fremdsprachigen Paket ist der Schlüssel die Adresse des
            # Datensatzes (publish.write_texts) – sonst fände die App ihren
            # eigenen Text nicht wieder.
            if not isinstance(paket, dict) or satz.get("url") not in paket:
                probleme.append(
                    f"{key}: Volltext von {str(satz.get('url'))[:50]} fehlt in "
                    f"{name}")

    if probleme:
        for p in probleme:
            log(f"  PROBLEM {p}")
        raise SystemExit(f"::error::{len(probleme)} Unstimmigkeit(en) im "
                         f"Datenstand – nichts übernommen.")
    return summe


def uebernimm(quelle: Path, ziel: Path, namen: list[str]) -> tuple[int, int]:
    """Dateien umhängen. Das Manifest ZULETZT (siehe Kopfkommentar).

    Jede Datei wird ATOMAR ersetzt: erst als .tmp im Zielordner ablegen, dann
    per os.replace an ihren Platz. So findet ein Abbruch nie eine halb
    geschriebene Datei vor; ein echter Verzeichnis-Tausch scheidet aus, weil der
    Zwischenordner im System-Temp auf einem anderen Dateisystem liegt."""
    ziel.mkdir(parents=True, exist_ok=True)

    def atomar(von: Path, nach: Path) -> None:
        tmp = nach.with_name(nach.name + ".tmp")
        shutil.copyfile(von, tmp)
        os.replace(tmp, nach)          # gleicher Ordner → atomarer Tausch

    for name in sorted(set(namen)):
        atomar(quelle / name, ziel / name)
    atomar(quelle / "manifest.json", ziel / "manifest.json")

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
