#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  monitor.py  —  Zentraler Einstiegspunkt des Petitions-Monitors
# =============================================================================
#
#  Bindet das Kernmodul (petitions_core.py) und alle Plattform-Module
#  zusammen. Neue Plattform anschließen = neues Modul mit PLATFORM-Objekt
#  schreiben und hier in PLATFORMS eintragen (bzw. aus PLACEHOLDERS entfernen).
#
#  AUFRUF
#  ------
#      python3 monitor.py --serve                 # Dashboard + Server (Port 8000)
#      python3 monitor.py                         # alle Live-Plattformen scrapen
#      python3 monitor.py --platform avaaz        # nur Avaaz scrapen
#      python3 monitor.py --platform weact --limit 20
#      python3 monitor.py --html-only             # nur HTML aus JSON neu bauen
# =============================================================================

from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import i18n_helfer as i18n
import petitions_core as core
from petitions_core import Platform

import weact_scraper
import avaaz_scraper
import openpetition_scraper
import innnit_scraper
import foodwatch_scraper
import wemove_scraper
import eko_scraper
import europarl_scraper
import changeorg_scraper
import bundestag_scraper
import threefifty_scraper

# ----------------------------------------------------------------------------
# Plattform-Registry: Live-Scraper zuerst, dann die geplanten Platzhalter.
# ----------------------------------------------------------------------------
PLATFORMS: list[Platform] = [
    weact_scraper.PLATFORM,
    avaaz_scraper.PLATFORM,
    openpetition_scraper.PLATFORM,
    changeorg_scraper.PLATFORM,
    bundestag_scraper.PLATFORM,
    eko_scraper.PLATFORM,
    innnit_scraper.PLATFORM,
    wemove_scraper.PLATFORM,
    europarl_scraper.PLATFORM,
    foodwatch_scraper.PLATFORM,
    threefifty_scraper.PLATFORM,
    # Englische Zwillinge: eigener Eintrag je Sprache, damit die App nach
    # Sprache filtern kann. Sie stehen bewusst am ENDE — der Tageslauf
    # arbeitet die Liste der Reihe nach ab und ist heute schon am
    # Zeitanschlag; die deutschen Bestände dürfen dadurch nicht wegfallen.
    #
    # ⚠️ SEIT DEM RUNDLAUF (rotiere_auf_aeltestes, 24.8.2026) trägt „am Ende
    # stehen" nicht mehr allein. Die Liste wird zyklisch gedreht, damit kein
    # Eintrag verhungert — ein englischer Zwilling kann also durchaus als
    # ERSTER drankommen, wenn er am längsten nicht durchgelaufen ist. Erhalten
    # bleibt nur die RELATIVE Reihenfolge. Wer die deutschen Bestände hart
    # bevorzugen will, muss das in _abschlussmarke() ausdrücken (z. B. Sprache
    # als erstes Feld des Sortierschlüssels) — nicht über die Listenposition.
    foodwatch_scraper.PLATFORM_EN,
    eko_scraper.PLATFORM_EN,
    wemove_scraper.PLATFORM_EN,
    threefifty_scraper.PLATFORM_EN,
    avaaz_scraper.PLATFORM_EN,
    changeorg_scraper.PLATFORM_EN,
]


def write_all_html() -> None:
    for p in PLATFORMS:
        if p.is_live:
            core.write_list_html(p)
    core.write_dashboard(PLATFORMS)
    core.write_placeholder_pages(PLATFORMS)


# ----------------------------------------------------------------------------
# Reihenfolge: Rundlauf statt immer wieder von vorn
# ----------------------------------------------------------------------------
# ⚠️ Der Anlass (24.8.2026 gemessen): der CI-Lauf schöpft seine Frist von 300 min
# aus und kam an zwei Tagen hintereinander nur durch die ERSTEN VIER der elf
# Plattformen. Die Schleife in main() lief bis dahin immer in derselben festen
# Reihenfolge los — der Rest der Liste wurde also nie erreicht. Im Manifest vom
# 24.8. standen weact/avaaz/openpetition/changeorg auf dem 24.8., die übrigen
# sieben unverändert auf dem 22.8. Die Meldung „Rest folgt beim nächsten Lauf"
# aus scrape.yml stimmte für die PLATTFORMLISTE nicht: der nächste Lauf fing
# wieder bei Position 1 an.
#
# Hier wird die Liste deshalb zyklisch so gedreht, dass sie bei der Plattform
# beginnt, die am längsten nicht mehr durchgelaufen ist. Die relative
# Reihenfolge bleibt erhalten (die englischen Zwillinge stehen weiter hinten),
# nur der Einstiegspunkt wandert.
#
# ⚠️ Bewusst OHNE neue Zustandsdatei: der Actions-Cache trägt nur
# „*_petitions.json" und „texts_index.json" (scrape.yml). Eine zusätzliche Datei
# ginge zwischen den Läufen verloren und der Rundlauf stünde still, ohne dass
# es auffiele. Alles Nötige steht schon im _meta der Bestände.
def _zeitpunkt(wert) -> datetime:
    """ISO-Zeitstempel als echter Zeitpunkt – NICHT als Zeichenkette vergleichen.

    ⚠️ Die Bestände tragen je nach Herkunft verschiedene Zonen: die im CI
    erzeugten enden auf „+00:00", die vom Rechner des Nutzers auf „-06:00".
    Als Text verglichen stünde „2026-08-09T07:43:14-06:00" (= 13:43 UTC) vor
    „2026-08-09T08:00:00+00:00", obwohl es später ist. Genau diese Mischung
    entsteht, wenn scrape.yml ohne Cache auf den Stand im Repo zurückfällt.
    """
    if not wert:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        zp = datetime.fromisoformat(wert)
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)
    # Zonenlose Altbestände als UTC lesen – sonst wirft der Vergleich
    # „can't compare offset-naive and offset-aware datetimes".
    return zp if zp.tzinfo else zp.replace(tzinfo=timezone.utc)


def _abschlussmarke(p) -> tuple[int, datetime]:
    """Sortierschlüssel: (abgeschlossen?, zuletzt gespeichert).

    ⚠️ „generated_at" allein genügt NICHT. Es wird bei JEDER Speicherung neu
    gesetzt, auch bei den Zwischenspeicherungen mitten im Lauf — eine Plattform,
    die nach 29 von 52 nötigen Minuten abgeschnitten wurde, trüge also einen
    taufrischen Zeitstempel und käme beim nächsten Mal wieder ganz nach hinten.
    Genau das ist Change.org am 24.8.2026 passiert.

    „kennzahlen" schreibt dagegen nur der Abschluss-Save (save_store mit
    quiet=False), und weil save_store das _meta bei jedem Schreiben neu aufbaut,
    fehlt das Feld nach einem Abbruch. Sein Fehlen ist damit der genaue Beleg
    „dieser Lauf ist nicht zu Ende gekommen" — solche Plattformen kommen zuerst.
    """
    meta = core.load_meta(p.data_file)
    abgeschlossen = 0 if not meta.get("kennzahlen") else 1
    # Fehlender Zeitstempel = noch nie gelaufen = höchste Dringlichkeit.
    return (abgeschlossen, _zeitpunkt(meta.get("generated_at")))


def rotiere_auf_aeltestes(targets: list[Platform]) -> list[Platform]:
    if len(targets) < 2:
        return targets
    marken = [_abschlussmarke(p) for p in targets]
    # min() liefert bei Gleichstand den ERSTEN Treffer – damit bleibt die
    # ursprüngliche Reihenfolge erhalten, solange nichts hinterherhinkt
    # (frischer Klon: alle Marken gleich → start = 0 → keine Drehung).
    start = min(range(len(targets)), key=lambda i: marken[i])
    if start == 0:
        return targets
    gedreht = targets[start:] + targets[:start]
    core.log(f"Rundlauf: Beginn bei {gedreht[0].name} "
             f"(Position {start + 1} von {len(targets)}) – dort hat der letzte "
             f"Lauf aufgehört.")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # Als Anmerkung, nicht nur ins Protokoll: das Lauf-Protokoll braucht
        # einen Token, Anmerkungen nicht (siehe die Lehre vom 10.8.2026).
        offen = [p.name for p, m in zip(targets, marken) if not m[0]]
        print(f"::notice title=Rundlauf::Beginn bei {gedreht[0].name} "
              f"(Position {start + 1}/{len(targets)}). Reihenfolge: "
              + ", ".join(p.key for p in gedreht)
              + (f". Ohne Abschluss im letzten Lauf: {', '.join(offen)}."
                 if offen else "."))
    return gedreht


def parse_args():
    p = argparse.ArgumentParser(
        description="Petitions-Monitor: mehrere Plattformen scrapen (Upsert + HTML).")
    p.add_argument("--platform", choices=[x.key for x in PLATFORMS if x.is_live],
                   help="nur diese Plattform scrapen (Default: alle Live-Plattformen)")
    p.add_argument("--limit", type=int, default=0,
                   help="nur die ersten N neuen Petitionen scrapen (Test); "
                        "deaktiviert die Prüfung bekannter Petitionen")
    p.add_argument("--no-recheck", action="store_true",
                   help="Prüfung bereits bekannter Petitionen überspringen "
                        "(nur neue scrapen)")
    p.add_argument("--min-interval-hours", type=float,
                   default=core.DEFAULT_MIN_INTERVAL_HOURS,
                   help="Petitionen, die vor weniger als N Stunden geprüft "
                        f"wurden, überspringen (Default {core.DEFAULT_MIN_INTERVAL_HOURS}; "
                        "0 = immer prüfen)")
    p.add_argument("--force", action="store_true",
                   help="Mindestabstand ignorieren und alle bekannten "
                        "Petitionen erneut prüfen")
    p.add_argument("--check", action="store_true",
                   help="Nur die Entdeckungsquellen prüfen (schnell, kein "
                        "Scrape); Exit-Code 1, wenn eine Quelle fehlschlägt")
    p.add_argument("--html-only", action="store_true",
                   help="kein Scrape; nur HTML aus vorhandenen JSONs neu bauen")
    p.add_argument("--delay", type=float, default=core.REQUEST_DELAY,
                   help=f"Pause zwischen Anfragen in s (Default {core.REQUEST_DELAY})")
    p.add_argument("--archive", action="store_true",
                   help="Kandidatenliste im Internet Archive auffrischen. Für "
                        "Plattformen ohne öffentliche Gesamtliste (avaaz): "
                        "findet Petitionen, die heute nirgends mehr verlinkt "
                        "sind. Der Rückstand wird danach über mehrere Läufe "
                        "abgearbeitet, nicht auf einen Schlag")
    p.add_argument("--archive-batch", type=int, default=core.ARCHIVE_BATCH,
                   help="wie viele Archiv-Kandidaten pro Lauf geprüft werden "
                        f"(Default {core.ARCHIVE_BATCH}; 0 = keine)")
    p.add_argument("--backfill", action="store_true",
                   help="Listen der beendeten und archivierten Petitionen "
                        "einmal komplett einlesen (bundestag: status.3 + "
                        "status.4, ~655 Anfragen). Die Datensätze entstehen "
                        "sofort aus der Listentabelle; die fehlenden Volltexte "
                        "arbeiten die folgenden Läufe portionsweise ab")
    p.add_argument("--backfill-batch", type=int, default=core.BACKFILL_BATCH,
                   help="wie viele fehlende Volltexte pro Lauf nachgeladen "
                        f"werden (Default {core.BACKFILL_BATCH}; 0 = keine)")
    # ⚠️ Die Fremdsprachen VERDOPPELN die Detailabrufe (rund 1.800 zusätzliche
    # über alle Plattformen, Avaaz allein ~1.186). Der Tageslauf teilt sich ein
    # Budget von 350 Minuten und schöpft es heute schon nicht immer aus — die
    # Frische der Plattformen ist deshalb gestaffelt. Käme die Verdopplung
    # ungefragt dazu, fielen hinten Plattformen heraus, ohne dass jemand einen
    # Fehler sähe. Deshalb ruft der Tageslauf mit --keine-sprachen, und ein
    # eigener, seltener Lauf holt die Übersetzungen nach; dasselbe Muster wie
    # --backfill beim Bundestag.
    p.add_argument("--keine-sprachen", dest="keine_sprachen",
                   action="store_true",
                   help="fremdsprachige Fassungen NICHT mitholen (halbiert die "
                        "Detailabrufe; die Hauptsprache kommt weiterhin)")
    p.add_argument("--serve", action="store_true",
                   help="Monitor lokal ausliefern, inkl. 'Jetzt scrapen'-Buttons")
    p.add_argument("--port", type=int, default=8000,
                   help="Port für --serve (Default 8000)")
    return p.parse_args()


CHECK_RETRY_PAUSE = 5.0   # Sekunden bis zum zweiten Versuch einer roten Quelle


def run_checks(args) -> None:
    """Health-Check aller Live-Plattformen: prüft je Plattform die
    Entdeckungsquelle (wenige Requests). Erkennt kaputte Quellen (Umbau,
    404, Format-Änderung) FRÜH – ideal für einen CI-Schritt vor dem Scrape."""
    # Browser-User-Agent wie die Scraper – sonst blockt Cloudflare (avaaz u. a.).
    fetcher = core.Fetcher(delay=0.4, headers={
        "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                       "Gecko/20100101 Firefox/128.0"),
        "Accept-Language": "de-DE,de;q=0.9"})
    targets = [p for p in PLATFORMS if p.is_live
               and (not args.platform or p.key == args.platform)]
    core.log(f"Health-Check: {len(targets)} Plattform(en) …")

    def einmal(p) -> tuple[bool, str]:
        try:
            return p.check(fetcher)
        except Exception as exc:
            return False, f"Ausnahme: {exc!r}"

    failed: list[tuple[str, str, str]] = []   # (key, Name, Grund)
    for p in targets:
        if not p.check:
            print(f"  ??   {p.name:24} (kein Check definiert)")
            continue
        ok, detail = einmal(p)
        if not ok:
            # Zweiter Versuch nach kurzer Pause. Mehrere Quellen liegen hinter
            # Cloudflare und antworten aus einem Rechenzentrum heraus sprunghaft
            # mit 403/503; ein einzelner Aussetzer ist noch kein kaputte Quelle.
            # Genau das erklärt, warum der Check am 1. und 3.8.26 rot war, am
            # 4.8. aber grün — und hier lokal ebenfalls grün.
            time.sleep(CHECK_RETRY_PAUSE)
            ok2, detail2 = einmal(p)
            if ok2:
                print(f"  OK   {p.name:24} {detail2}  (erst im 2. Versuch)")
                continue
            detail = f"{detail} | 2. Versuch: {detail2}"
        print(f"  {'OK  ' if ok else 'FAIL'} {p.name:24} {detail}")
        if not ok:
            failed.append((p.key, p.name, detail))

    if not failed:
        core.log("Alle Entdeckungsquellen erreichbar. ✓")
        return

    core.log(f"FEHLGESCHLAGEN ({len(failed)}): "
             f"{', '.join(k for k, _, _ in failed)}")
    # In der CI läuft dieser Schritt bewusst mit continue-on-error: eine
    # blockierte Quelle darf den Tageslauf nicht aufhalten. Ohne die Zeilen
    # hier blieb davon aber nur ein nacktes „Process completed with exit
    # code 1" übrig — der Schritt galt als grün und ein DAUERHAFT roter Check
    # wäre nie aufgefallen. Deshalb schreibt er sein Ergebnis jetzt so, dass
    # GitHub es als benannte Warnung auf die Lauf-Übersicht hebt.
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for key, name, grund in failed:
            einzeilig = " ".join(grund.split())[:400]
            print(f"::warning title=Entdeckungsquelle {name}::{key}: {einzeilig}")
        pfad = os.environ.get("GITHUB_STEP_SUMMARY")
        if pfad:
            with open(pfad, "a", encoding="utf-8") as fh:
                fh.write(f"### Health-Check: {len(failed)} Quelle(n) rot\n\n")
                fh.write("| Plattform | Grund |\n|---|---|\n")
                for _, name, grund in failed:
                    # Senkrechte Striche kommen im Grund vor („… | 2. Versuch:")
                    # und würden sonst eine zusätzliche Tabellenspalte öffnen.
                    zelle = " ".join(grund.split())[:200].replace("|", "\\|")
                    fh.write(f"| {name} | {zelle} |\n")
    raise SystemExit(1)


def main() -> None:
    args = parse_args()
    # Muss VOR dem ersten Scraper-Aufruf stehen: die Plattform-Module lesen den
    # Schalter zur Laufzeit über i18n_helfer.aktiv().
    i18n.setze_aktiv(not args.keine_sprachen)
    if args.keine_sprachen:
        core.log("Fremdsprachige Fassungen werden übersprungen "
                 "(--keine-sprachen).")
    try:
        if args.check:
            run_checks(args)
            return
        if args.serve:
            core.serve(PLATFORMS, args)
            return
        if args.html_only:
            write_all_html()
            return
        targets = [p for p in PLATFORMS if p.is_live
                   and (not args.platform or p.key == args.platform)]
        # Nur beim Sammellauf drehen. Bei --platform gibt es nichts zu drehen,
        # und die Aufholschritte in scrape.yml (Change.org, Übersetzungen)
        # rufen bewusst EINE Plattform auf – die soll auch die sein.
        if not args.platform:
            targets = rotiere_auf_aeltestes(targets)
        try:
            for p in targets:
                core.log(f"=== Scrape: {p.name} ===")
                # Befunde an DIESE Plattform binden. Ohne das laufen sie unter
                # dem Sammelschlüssel "_cli" (befund() und save_store() lesen
                # beide _TLS.platform). Sequenziell ginge das meist gut — bis
                # eine Plattform abbricht, BEVOR ihr save_store(quiet=False)
                # sie einsammelt: dann bleiben ihre Befunde liegen und die
                # NÄCHSTE Plattform holt sie sich und schreibt sie in ihr
                # _meta. Der CI-Lauf schickt bei Zeitüberschreitung SIGINT
                # (scrape.yml), ein Abbruch mitten im Lauf ist hier also der
                # Normalfall, nicht der Ausnahmefall.
                core.set_progress_platform(p.key)
                try:
                    p.run(args)
                except Exception as exc:   # eine Plattform darf den Lauf nicht kippen
                    core.log(f"!! {p.name} fehlgeschlagen: {exc!r} – übersprungen, "
                             "die übrigen Plattformen laufen weiter.")
        finally:
            # AUCH BEI ABBRUCH schreiben. Der CI-Lauf schickt SIGINT, sobald die
            # gemeinsame Frist erreicht ist (scrape.yml, "Zeitrahmen beim
            # Scrapen erreicht") – vorher standen diese beiden Zeilen hinter der
            # Schleife und wurden dann übersprungen. Folge: dashboard.html
            # entstand gar nicht erst, publish.py fand nichts zu kopieren und
            # ließ die Status-Ansicht still weg. Auf GitHub Pages war sie
            # dadurch nach jedem Lauf mit ausgeschöpfter Frist verschwunden
            # (am 2026-08-04 als HTTP 404 nachgemessen).
            core.write_dashboard(PLATFORMS)
            core.write_placeholder_pages(PLATFORMS)
    except KeyboardInterrupt:
        print("\nAbgebrochen.")


if __name__ == "__main__":
    main()
