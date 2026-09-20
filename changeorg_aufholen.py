#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Change.org-Rückstand lokal aufholen — auf dem Rechner des Nutzers, ohne die
Zeitfrist der GitHub-Actions.

Warum überhaupt lokal (19.9.2026): die CI holt Change.org bereits in einer
Schleife auf (`scrape.yml`, Schritt „Change.org aufholen"), bricht aber ab,
sobald FRIST+15 min erreicht sind — und die ist nach dem Sammellauf über alle
41 Zweige fast aufgebraucht. Übrig bleiben ~18 neue Sätze am Tag bei rund
13.500 offenen Kandidaten. Ein Rechner ohne Frist arbeitet denselben Vorrat in
Stunden statt in Monaten ab.

    python3 changeorg_aufholen.py --probe
        EIN kurzer Durchgang (Vorgabe 100 Abrufe), danach ein Messbericht:
        Fehlerquote, gesehene Statuscodes, Fortschritt. Startet nichts weiter.

    python3 changeorg_aufholen.py --durchgaenge 30
        Aufholen, bis der Vorrat durch ist oder eines der Abbruchkriterien
        greift. Jeder Durchgang ist ein vollständiger `monitor.py`-Lauf.

⚠️⚠️ Das Skript committet und pusht NICHTS. Es verändert nur
`changeorg_petitions.json`; wann dieser Stand ins Repo geht, entscheidet der
Nutzer (der 20:15-Timer nimmt `*_petitions.json` ohnehin mit).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

STORE = Path("changeorg_petitions.json")

# ⚠️⚠️ Bewusst NICHT ci_changeorg_done.py als Abbruchkriterium.
# Jenes Skript meldet FERTIG, sobald ein Durchgang KEINE NEUE PETITION brachte.
# Das war am 24.8.2026 richtig: damals hieß „0 neue" wirklich „das Fenster steht
# still". Seit das Verwerfungs-Register wirkt (`2b49f13`, 30.8.), werden rund
# 98 % der Kandidaten als nicht-deutsch verworfen — und die deutschen Treffer
# liegen in KLUMPEN (elf am Stück, dann sechzig ohne einen). Ein Stapel von 500
# ohne einen einzigen Treffer ist damit ein normaler Arbeitsdurchgang, kein
# Grund aufzuhören. Hier zählt deshalb der FORTSCHRITT, nicht die Ausbeute:
# abgearbeitet = Bestand + Verwerfungs-Register. Diese Zahl muss je Durchgang
# steigen, sonst geht wirklich nichts mehr.
FORTSCHRITT_MIN = 1

# Ein Durchgang, bei dem mehr als jeder zehnte Abruf scheitert, ist kein
# Arbeitsdurchgang mehr, sondern ein Hinweis auf die Gegenseite.
FEHLERQUOTE_MAX = 0.10
# Diese Codes sind eine Aussage ÜBER UNS, nicht über die Seite: sofort anhalten.
# 403 = ausgesperrt, 429 = zu schnell. Ein Wohnanschluss, der in einer Nacht
# 13.500 Seiten holt, ist etwas anderes als ein Rechenzentrum — genau dafür ist
# der Probelauf da.
STOPP_CODES = (403, 429)

FEHLERZEILE = re.compile(r"Fehler bei (\S+) \(Versuch (\d+)/(\d+)\): (.*)")
CODE_IM_TEXT = re.compile(r"\b(4\d\d|5\d\d)\b")


def stand() -> tuple[int, int, int | None]:
    """(Bestand, Register, available) aus dem Bestand — der Messpunkt."""
    if not STORE.exists():
        return 0, 0, None
    d = json.loads(STORE.read_text(encoding="utf-8"))
    meta = d.pop("_meta", {})
    reg = meta.get("verworfen")
    return (len(d),
            len(reg if isinstance(reg, dict) else (reg or [])),
            meta.get("available"))


def offen() -> int | None:
    """Wie viele Kandidaten sind noch nicht angefasst?

    Vorrang hat die Bilanz (seit 19.9.2026, core._bilanz): sie ordnet jeden
    entdeckten Kandidaten genau einem Topf zu und weiß deshalb wirklich, was
    offen ist. Fehlt sie — der Zweig ist seit der Umstellung nicht gelaufen —,
    wird aus available, Bestand und Register gerechnet.
    ⚠️ Kein Rückfall auf „0 neue Petitionen": siehe FORTSCHRITT_MIN oben.
    """
    if not STORE.exists():
        return None
    meta = json.loads(STORE.read_text(encoding="utf-8")).get("_meta", {})
    bil = meta.get("bilanz")
    if isinstance(bil, dict) and not bil.get("fehler") and "offen" in bil:
        return bil["offen"]
    bestand, register, available = stand()
    if not available:
        return None
    return max(0, available - bestand - register)


def durchgang(limit: int | None, protokoll: Path) -> dict:
    """Ein `monitor.py`-Lauf. Liefert die MESSWERTE, nicht nur den Exit-Code."""
    befehl = [sys.executable, "monitor.py", "--platform", "changeorg"]
    if limit:
        befehl += ["--limit", str(limit)]
    vor_b, vor_r, _ = stand()
    t0 = time.monotonic()
    with protokoll.open("w", encoding="utf-8") as f:
        p = subprocess.run(befehl, stdout=f, stderr=subprocess.STDOUT, text=True)
    dauer = time.monotonic() - t0
    text = protokoll.read_text(encoding="utf-8", errors="replace")
    nach_b, nach_r, available = stand()

    fehler = FEHLERZEILE.findall(text)
    codes: dict[str, int] = {}
    for _url, _v, _max_v, grund in fehler:
        for c in CODE_IM_TEXT.findall(grund):
            codes[c] = codes.get(c, 0) + 1
    fortschritt = (nach_b - vor_b) + (nach_r - vor_r)
    # Nenner für die Fehlerquote: was der Lauf zu holen versucht hat. Ohne
    # Fortschritt gibt es keinen sinnvollen Nenner — dann zählt die rohe Zahl.
    versuche = max(fortschritt + len(fehler), 1)
    return {"exit": p.returncode, "dauer": dauer, "protokoll": protokoll,
            "neu_im_bestand": nach_b - vor_b, "neu_im_register": nach_r - vor_r,
            "fortschritt": fortschritt, "fehler": len(fehler), "codes": codes,
            "quote": len(fehler) / versuche, "available": available}


def bericht(e: dict) -> None:
    print(f"    {e['dauer']/60:5.1f} min · Exit {e['exit']} · "
          f"+{e['neu_im_bestand']} im Bestand · +{e['neu_im_register']} "
          f"verworfen · Fortschritt {e['fortschritt']}")
    if e["fehler"]:
        codes = ", ".join(f"{c}×{n}" for c, n in sorted(e["codes"].items()))
        print(f"    {e['fehler']} Fehlversuch(e) ({e['quote']:.1%})"
              + (f" · Codes: {codes}" if codes else " · ohne HTTP-Code"))


def haltegrund(e: dict) -> str | None:
    """Warum der Lauf NICHT weitergehen darf. None = alles in Ordnung."""
    if e["exit"] != 0:
        return f"monitor.py endete mit Exit {e['exit']}"
    schlimm = [c for c in e["codes"] if int(c) in STOPP_CODES]
    if schlimm:
        return (f"HTTP {', '.join(schlimm)} gesehen — die Gegenseite wehrt ab. "
                f"Nicht weiterlaufen lassen, sonst wird aus einer Drosselung "
                f"eine Sperre.")
    if e["quote"] > FEHLERQUOTE_MAX:
        return (f"Fehlerquote {e['quote']:.1%} über der Schwelle "
                f"{FEHLERQUOTE_MAX:.0%}")
    if e["fortschritt"] < FORTSCHRITT_MIN:
        return ("kein Fortschritt — weder Bestand noch Verwerfungs-Register "
                "sind gewachsen. DAS ist das echte „nichts geht mehr“ "
                "(nicht „keine neue Petition“).")
    return None


MANIFEST = ("https://petitionsmanager.github.io/petitionsmanager/data/"
            "manifest.json")
# Unterhalb dieses Anteils am veröffentlichten Stand gilt der lokale Bestand
# als veraltet. 0,9 lässt normale Schwankung durch (offline gegangene Sätze),
# fängt aber den Fall ab, der hier zählt: 457 gegen 2.586.
FRISCHE_MIN = 0.90


def abgleich_mit_veroeffentlichtem_stand() -> str | None:
    """Ist der lokale Bestand überhaupt der aktuelle? None = ja.

    ⚠️⚠️ DER gefährliche Fall dieses Skripts, gefunden am 19.9.2026 vor dem
    ersten Start: Change.org wird von der CI gepflegt, und ihr Bestand lebt im
    GitHub-Actions-Cache — im Repo liegt eine viel ältere Fassung (457 gegen
    2.586 Sätze). Ein lokaler Aufhol-Lauf würde von der alten Fassung aus
    arbeiten, sie committen, und `ci_stores_uebernehmen.py` nähme sie als die
    JÜNGERE (es vergleicht `lauf_verlauf`, nicht die Größe). Ergebnis: über
    2.000 Sätze und das ganze Verwerfungs-Register weg — und ohne Register
    steht das 500er-Fenster wieder still, lautlos.

    Für europarl und die WeMove-Zweige gibt es dieses Problem nicht: dort ist
    der Rechner der EINZIGE Schreiber. Change.org hat zwei.
    """
    try:
        import urllib.request
        with urllib.request.urlopen(MANIFEST, timeout=20) as r:
            daten = json.loads(r.read().decode("utf-8"))
    except Exception as exc:                      # Netz weg, Pages weg, egal
        return (f"der veröffentlichte Stand ist nicht abrufbar ({exc}). "
                f"Ohne Abgleich NICHT starten — siehe --ohne-abgleich.")
    treffer = [p for p in daten.get("platforms", []) if p.get("key") == "changeorg"]
    if not treffer:
        return "im Manifest steht kein Eintrag 'changeorg'."
    draussen = treffer[0].get("count") or 0
    hier, register, _ = stand()
    if draussen and hier < draussen * FRISCHE_MIN:
        return (f"der lokale Bestand ist VERALTET: {hier} Sätze hier gegen "
                f"{draussen} veröffentlichte, Register {register}.\n"
                f"   Der aktuelle Stand liegt im GitHub-Actions-Cache und ist "
                f"nicht im Repo. Ein Lauf von hier aus wuerde ihn beim "
                f"naechsten CI-Lauf UEBERSCHREIBEN (ci_stores_uebernehmen.py "
                f"vergleicht lauf_verlauf, nicht die Groesse).\n"
                f"   Erst den CI-Stand hierher holen, dann aufholen.")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--probe", action="store_true",
                    help="ein kurzer Durchgang mit Messbericht, dann Schluss")
    ap.add_argument("--ohne-abgleich", action="store_true",
                    dest="ohne_abgleich",
                    help="den Frischeabgleich gegen den veröffentlichten Stand "
                         "überspringen — nur, wenn du weißt, warum")
    ap.add_argument("--durchgaenge", type=int, default=0,
                    help="höchstens so viele Durchgänge")
    ap.add_argument("--limit", type=int,
                    help="Abrufe je Durchgang (Vorgabe: 100 beim Probelauf, "
                         "sonst der Deckel des Scrapers = 500)")
    a = ap.parse_args()
    if not a.probe and a.durchgaenge <= 0:
        ap.error("entweder --probe oder --durchgaenge N")
    if not STORE.exists():
        print(f"FEHLER: {STORE} nicht gefunden — im Repo-Verzeichnis starten.")
        return 2

    if not a.ohne_abgleich:
        warum = abgleich_mit_veroeffentlichtem_stand()
        if warum:
            print(f"⛔ ABBRUCH: {warum}")
            return 2

    bestand, register, available = stand()
    rest = offen()
    print(f"Ausgangslage: {bestand} im Bestand · {register} im "
          f"Verwerfungs-Register · available {available} · offen "
          f"{rest if rest is not None else 'unbekannt'}")
    if rest == 0:
        print("Nichts offen — nichts zu tun.")
        return 0

    runden = 1 if a.probe else a.durchgaenge
    limit = a.limit or (100 if a.probe else None)
    ziel = Path("changeorg-aufholen.log")
    getan = 0
    for i in range(1, runden + 1):
        print(f"\n[{i}/{runden}] Durchgang"
              + (f" (höchstens {limit} Abrufe)" if limit else ""))
        e = durchgang(limit, ziel.with_suffix(f".{i}.log"))
        bericht(e)
        getan += e["fortschritt"]
        grund = haltegrund(e)
        if grund:
            print(f"\n⛔ ABBRUCH: {grund}")
            print(f"   Protokoll: {e['protokoll'].resolve()}")
            return 1
        rest = offen()
        print(f"    noch offen: {rest if rest is not None else 'unbekannt'}")
        if rest == 0:
            print("\n✅ Vorrat durch.")
            break

    print(f"\n{getan} Kandidat(en) in diesem Aufruf abgearbeitet.")
    if a.probe:
        # ⚠️ Der Probelauf sagt ausdrücklich dazu, was er NICHT belegt. Eine
        # saubere Messung über 100 Abrufe ist keine Zusage für 13.500 — die
        # Abwehr einer Seite hängt an der Menge, nicht an der Rate.
        print("\nProbelauf beendet. Was er belegt: die Verbindung steht, die\n"
              "Fehlerquote ist messbar, der Fortschritt zählt richtig.\n"
              "Was er NICHT belegt: wie Change.org auf ZEHNTAUSEND Abrufe von\n"
              "diesem Anschluss reagiert. Deshalb der nächste Schritt in\n"
              "Stufen, nicht in einem Rutsch:\n"
              "    python3 changeorg_aufholen.py --durchgaenge 3")
    return 0


if __name__ == "__main__":
    sys.exit(main())
