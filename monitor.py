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
    # Platzhalter (noch kein Scraper). 350.org läuft auf ActionKit (wie
    # WeMove): act.350.org/sign/<slug>, robots erlaubt /sign/. Für einen
    # späteren Scraper: deutsche Aktionen über get-involved/ mit Region
    # Deutschland (Sign-URLs tragen ?r=<region>&c=<kontinent>), Live-Zähler
    # analog WeMove über act.350.org/progress/<slug>.
    Platform(key="threefifty", name="350.org",
             source_url="https://350.org/de/",
             html_file=Path("threefifty_petitions.html"),
             openness=3,
             openness_note="Voraussichtlich mittel (ActionKit wie WeMove; "
                           "/sign/ erlaubt). Noch kein Scraper – Platzhalter."),
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
    p.add_argument("--html-only", action="store_true",
                   help="kein Scrape; nur HTML aus vorhandenen JSONs neu bauen")
    p.add_argument("--delay", type=float, default=core.REQUEST_DELAY,
                   help=f"Pause zwischen Anfragen in s (Default {core.REQUEST_DELAY})")
    p.add_argument("--serve", action="store_true",
                   help="Monitor lokal ausliefern, inkl. 'Jetzt scrapen'-Buttons")
    p.add_argument("--port", type=int, default=8000,
                   help="Port für --serve (Default 8000)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    try:
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
            p.run(args)
        core.write_dashboard(PLATFORMS)
        core.write_placeholder_pages(PLATFORMS)
    except KeyboardInterrupt:
        print("\nAbgebrochen.")


if __name__ == "__main__":
    main()
