#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Aufhol-Abbruchkriterium für die Change.org-Schleife im GitHub-Actions-
Workflow (siehe .github/workflows/scrape.yml).

Exit 0 (= FERTIG, Schleife beenden), wenn:
  - (fast) alle entdeckten Kandidaten erfasst sind (online ≥ 97 % von available),
    ODER
  - der letzte Lauf nachweislich KEINE neuen Petitionen brachte (nichts mehr
    aufzuholen bzw. Quelle blockt gerade → zurückhalten, der nächste Tageslauf
    macht weiter).
Exit 1 (= WEITER), solange noch ungescrapte Kandidaten übrig sind.

⚠️ „Feld fehlt" ist NICHT „0 neue" (24.8.2026): new_petitions_last_run steht
erst NACH der Entdeckung im _meta (changeorg_scraper hält es seither über
lauf_meta bei jeder Zwischenspeicherung fest). Fehlt es, wurde der letzte Lauf
VOR der Entdeckung abgeschnitten – dann ist Aufholen nötig, nicht Zurückhalten.
Genau diese Verwechslung hielt die Aufholschleife am 24.8. still (0 Sekunden
Laufzeit), während 255 Kandidaten allein in der August-Sitemap fehlten.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

STORE = Path("changeorg_petitions.json")


def main() -> int:
    if not STORE.exists():
        return 0
    data = json.loads(STORE.read_text(encoding="utf-8"))
    meta = data.pop("_meta", {})
    available = meta.get("available") or 0
    online = sum(1 for v in data.values()
                 if isinstance(v, dict) and v.get("status", "online") == "online")
    neu_gemessen = "new_petitions_last_run" in meta
    new_last = len(meta.get("new_petitions_last_run") or [])
    done = bool(available and online >= available * 0.97) \
        or (neu_gemessen and new_last == 0)
    neu_text = str(new_last) if neu_gemessen else "unbekannt (Lauf abgeschnitten)"
    print(f"Change.org: online={online} / verfügbar~{available} · "
          f"neu im letzten Lauf={neu_text} → "
          + ("FERTIG" if done else "weiter aufholen"))
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main())
