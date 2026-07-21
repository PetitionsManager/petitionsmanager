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
from pathlib import Path

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
]


def write_all_html() -> None:
    for p in PLATFORMS:
        if p.is_live:
            core.write_list_html(p)
    core.write_dashboard(PLATFORMS)
    core.write_placeholder_pages(PLATFORMS)


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
    p.add_argument("--serve", action="store_true",
                   help="Monitor lokal ausliefern, inkl. 'Jetzt scrapen'-Buttons")
    p.add_argument("--port", type=int, default=8000,
                   help="Port für --serve (Default 8000)")
    return p.parse_args()


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
    failed = []
    for p in targets:
        if not p.check:
            print(f"  ??   {p.name:24} (kein Check definiert)")
            continue
        try:
            ok, detail = p.check(fetcher)
        except Exception as exc:
            ok, detail = False, f"Ausnahme: {exc!r}"
        print(f"  {'OK  ' if ok else 'FAIL'} {p.name:24} {detail}")
        if not ok:
            failed.append(p.key)
    if failed:
        core.log(f"FEHLGESCHLAGEN ({len(failed)}): {', '.join(failed)}")
        raise SystemExit(1)
    core.log("Alle Entdeckungsquellen erreichbar. ✓")


def main() -> None:
    args = parse_args()
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
        for p in targets:
            core.log(f"=== Scrape: {p.name} ===")
            try:
                p.run(args)
            except Exception as exc:   # eine Plattform darf den Lauf nicht kippen
                core.log(f"!! {p.name} fehlgeschlagen: {exc!r} – übersprungen, "
                         "die übrigen Plattformen laufen weiter.")
        core.write_dashboard(PLATFORMS)
        core.write_placeholder_pages(PLATFORMS)
    except KeyboardInterrupt:
        print("\nAbgebrochen.")


if __name__ == "__main__":
    main()
