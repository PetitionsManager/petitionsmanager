#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  publish.py  —  Erzeugt die schlanken Daten für die Mobile-App (webapp/)
# =============================================================================
#
#  Die App (webapp/) ist vom Python-Server ENTKOPPELT: sie lädt statische
#  JSON-Dateien von einer konfigurierbaren URL. Dieses Skript bereitet diese
#  Dateien vor – bewusst SCHLANK (ohne description_full/Volltexte), damit die
#  App auf dem Handy schnell lädt:
#
#    webapp/data/manifest.json      Plattform-Metadaten + Zähler
#    webapp/data/<key>.json         pro Plattform: Array der Petitionen
#                                   (title, url, signatures, goal, category,
#                                    status, started_by, start_date, image_url)
#
#  Diesen Ordner (webapp/) auf einen statischen Host (GitHub Pages, eigener
#  Webspace …) hochladen → die App zeigt Live-Daten. Nach jedem Scrape neu
#  ausführen:  python3 publish.py
# =============================================================================

from __future__ import annotations

import json
import shutil
from pathlib import Path

import monitor
import petitions_core as core

OUT_DIR = Path("webapp/data")

# Felder, die die App braucht. description_full (bereinigtes HTML) ist für die
# ausklappbaren Petitionen nötig – macht die Dateien größer, aber die App lädt
# eine Plattform-JSON nur bei Bedarf und cacht sie.
SLIM_FIELDS = ("title", "url", "signatures", "goal", "category", "status",
               "started_by", "recipient", "start_date", "image_url", "kind",
               "summary", "description_full", "tags")


def slim(rec: dict) -> dict:
    out = {k: rec.get(k) for k in SLIM_FIELDS if rec.get(k) is not None}
    # Fallback: Ältere Datensätze ohne gespeicherte Tags bekommen sie hier beim
    # Export nachträglich (identische Logik wie beim Scrapen).
    if not out.get("tags"):
        tags = core.make_tags(rec)
        if tags:
            out["tags"] = tags
    return out


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"platforms": [], "generated_at": None}

    for p in monitor.PLATFORMS:
        entry = {
            "key": p.key,
            "name": p.name,
            "source_url": p.source_url,
            "openness": p.openness,
            "openness_note": p.openness_note,
            "eyebrow": p.eyebrow,
            "language": p.language,
            "live": p.is_live,
            "count": 0,
            "online": 0,
            "new": 0,
            "generated_at": None,
        }
        if p.is_live and p.data_file and p.data_file.exists():
            data = json.loads(p.data_file.read_text(encoding="utf-8"))
            meta = data.pop("_meta", {})
            entry["generated_at"] = meta.get("generated_at")
            entry["new"] = len(meta.get("new_petitions_last_run") or [])
            # Nach Unterschriften absteigend, schlanke Felder.
            items = sorted(
                (slim(r) for r in data.values()),
                key=lambda r: r.get("signatures") or -1, reverse=True)
            entry["count"] = len(items)
            entry["online"] = sum(1 for r in items
                                  if r.get("status", "online") == "online")
            (OUT_DIR / f"{p.key}.json").write_text(
                json.dumps(items, ensure_ascii=False), encoding="utf-8")
            if not manifest["generated_at"]:
                manifest["generated_at"] = entry["generated_at"]
        manifest["platforms"].append(entry)

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # Scraper-Dashboard als Status-Snapshot mit auf GitHub Pages ausliefern
    # (read-only: die "Jetzt scrapen"-Buttons brauchen den lokalen Server).
    dash = Path("dashboard.html")
    if dash.exists():
        shutil.copy(dash, OUT_DIR.parent / "dashboard.html")
        print("dashboard.html → webapp/ (Status-Ansicht via Pages-URL)")

    live = [p for p in manifest["platforms"] if p["live"]]
    total = sum(p["count"] for p in live)
    print(f"publish: {len(live)} Live-Plattformen, {total} Petitionen → {OUT_DIR}/")


if __name__ == "__main__":
    main()
