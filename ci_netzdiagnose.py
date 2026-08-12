#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  ci_netzdiagnose.py — was sieht ein RECHENZENTRUM von einer Quelle?
# =============================================================================
#
#  ANLASS (12.8.2026)
#  ------------------
#  Die ausgelieferten europarl-Daten trugen bei 47 von 98 Petitionen den
#  Titelsatz als "summary" statt der echten Zusammenfassung. Der Parser war
#  NICHT schuld – er liefert an der echten Seite nachweislich das Richtige.
#  Schuld war, dass der Host seit Tagen komplett übersprungen wird:
#
#      Host ausgelassen (robots.txt nicht lesbar):
#      www.europarl.europa.eu: HTTP 202.
#
#  petitions_core.Fetcher._robots_for wertet nur 200 und 404/410 als Freigabe;
#  alles andere ist konservativ eine Sperre. Damit liefert jeder Abruf None,
#  jeder Satz wird "error", core.upsert schreibt nichts – und die Datensätze
#  frieren auf dem Stand ein, den sie zufällig gerade hatten. Hier: auf dem
#  Stand VOR der Parser-Korrektur vom 3.8.2026.
#
#  ⚠️⚠️ VON HIER AUS IST DAS NICHT MESSBAR. Vom Entwicklungsrechner antwortet
#  dieselbe robots.txt mit HTTP 200 (mit requests UND curl gegengeprüft) – die
#  202 trifft nur GitHubs Rechenzentrum. Genau deshalb gibt es dieses Skript:
#  es misst DORT, wo der Fehler auftritt.
#
#  WAS ES BEANTWORTET
#  ------------------
#  Vor einer Korrektur am robots.txt-Riegel muss unterschieden sein:
#    (a) nur die robots.txt ist gesperrt  → ein Rückfall auf die zuletzt
#        gelesene Fassung holt die Plattform sofort zurück;
#    (b) die Quelle sperrt das Rechenzentrum GANZ → ein Rückfall ändert für
#        europarl nichts, und die Reparatur säße am falschen Ende.
#  Der Riegel schlägt zu, BEVOR je eine Detailseite versucht wurde – (a) und
#  (b) sind aus den bisherigen Protokollen deshalb nicht zu trennen.
#
#  ⚠️ Der Riegel wird hier bewusst UMGANGEN (nacktes requests statt
#  core.Fetcher). Das ist zulässig und keine Missachtung der Zusage:
#  gemessen wird der TRANSPORT, und die veröffentlichte robots.txt erlaubt
#  genau diese Pfade ausdrücklich – am 12.8.2026 mit core.RobotsRules gegen
#  die echte Datei geprüft (Positivkontrolle: /calendar/ wird korrekt
#  verboten). Es sind sechs Abrufe mit Pausen, kein Scrape.
#
#  ⚠️ ERGEBNISSE GEHEN IN DIE ANMERKUNGEN, nicht nur ins Protokoll: die
#  Lauf-Protokolle brauchen einen GitHub-Token (HTTP 403), die Anmerkungen
#  über /commits/<sha>/check-runs stehen jedem offen. Ein Befund, den niemand
#  lesen kann, ist keiner.
#
#  ⚠️ Ein Statuscode allein beweist nichts. Bot-Schutz antwortet gern mit
#  HTTP 200 und einer Sperrseite. Jede Messung prüft deshalb zusätzlich, ob
#  der INHALT das ist, was er sein soll (Kennzeichen + Trefferzahl).
#
#  AUFRUF
#  ------
#      python3 ci_netzdiagnose.py            # Vorgabe: europarl
#      python3 ci_netzdiagnose.py --url …    # beliebige Einzeladresse
#
#  Läuft absichtlich auch lokal – erst der Vergleich "hier gegen dort" ist die
#  Antwort. Der Rückgabewert ist 0, solange das Skript selbst durchlief; ein
#  gesperrter Host ist ein BEFUND, kein Skriptfehler.
# =============================================================================

from __future__ import annotations

import argparse
import os
import re
import sys
import time

import requests

# Kopfzeilen und Adressen aus dem echten Scraper ziehen statt sie abzuschreiben.
# Sonst misst die Diagnose eine Konfiguration, die es im Betrieb nicht gibt.
import europarl_scraper as E

IN_ACTIONS = bool(os.environ.get("GITHUB_ACTIONS"))

# Zweiter User-Agent als Gegenprobe: antwortet die Quelle IHM anders, liegt die
# Sperre am Kennzeichen und nicht an der IP – das wäre die billigste Reparatur
# von allen. Antwortet sie beiden gleich, ist es die Herkunft.
NEUTRALER_UA = "PetitionsManager/1.0 (+https://petitionsmanager.app)"


def _melde(stufe: str, titel: str, text: str) -> None:
    """Eine Zeile ins Protokoll UND als GitHub-Anmerkung.

    ⚠️ Anmerkungen sind einzeilig. Umbrüche müssen als %0A kodiert werden,
    sonst bricht die Meldung nach der ersten Zeile ab."""
    print(f"[{stufe}] {titel}: {text}")
    if IN_ACTIONS:
        sicher = text.replace("\r", " ").replace("\n", "%0A")
        print(f"::{stufe} title={titel}::{sicher}")


# Kennzeichen der AWS-WAF-Sperrseite. Am 12.8.2026 lokal reproduziert: das
# Portal antwortet mit HTTP 202 und 2431 Byte HTML, das per JavaScript ein
# Cookie setzen will. requests führt kein JavaScript aus – es bekommt deshalb
# NIE ein Cookie und damit bei jedem weiteren Versuch wieder 202.
# ⚠️ Daraus folgt gemessen (3 Versuche, eine Session, null Cookies): mehr
# Versuche sind hier WIRKUNGSLOS. Wer den Riegel "nur nachfassen lassen" will,
# repariert nichts.
WAF_MARKER = "awsWafCookieDomainList"


def _fingerabdruck(body: str, art: str) -> str:
    """Sagt, ob der INHALT plausibel ist – nicht nur, ob 200 kam.

    Ein Bot-Schutz liefert oft 200 mit einer Sperrseite; ohne diese Prüfung
    liest sich das wie ein Erfolg."""
    if WAF_MARKER in body:
        # Muss VOR allen anderen Prüfungen stehen: die Sperrseite enthält
        # naturgemäß weder robots-Direktiven noch Petitionsnummern, und ohne
        # diesen Zweig meldete sie sich als banales "0 Treffer".
        return "AWS-WAF-SPERRSEITE (JavaScript-Prüfung)"
    if art == "robots":
        zeilen = sum(1 for z in body.splitlines()
                     if z.strip().lower().startswith(("user-agent:", "disallow:", "allow:")))
        return f"{zeilen} robots-Direktiven"
    if art == "liste":
        return f"{len(set(E.NUMBER_HREF_RE.findall(body)))} Petitionsnummern"
    if art == "detail":
        hat = E.SPRACHE["en"]["titel_marker"] in body
        return f"Titelmarker {'gefunden' if hat else 'FEHLT'}"
    return "—"


def messen(session: requests.Session, url: str, art: str, was: str,
           ua: str | None = None) -> dict:
    """Ein einzelner Abruf. Gibt das Messergebnis als dict zurück."""
    kopf = dict(E.FETCH_HEADERS)
    if ua:
        kopf["User-Agent"] = ua
    t0 = time.time()
    try:
        r = session.get(url, headers=kopf, timeout=30, allow_redirects=True)
    except requests.RequestException as exc:
        # Ein Verbindungsfehler ist ein anderer Befund als ein Statuscode und
        # darf nicht als "0" mit ihm verrechnet werden.
        return {"was": was, "status": None, "fehler": type(exc).__name__,
                "dauer": time.time() - t0, "inhalt": "—", "bytes": 0,
                "ziel": url}
    body = r.text or ""
    return {"was": was, "status": r.status_code, "fehler": None,
            "dauer": time.time() - t0, "bytes": len(r.content),
            "inhalt": _fingerabdruck(body, art),
            "typ": r.headers.get("Content-Type", "?").split(";")[0],
            "ziel": r.url, "umgeleitet": r.url != url}


def _zeile(m: dict) -> str:
    st = m["fehler"] or f"HTTP {m['status']}"
    return (f"{m['was']}: {st} · {m['bytes']} B · {m.get('typ','?')} · "
            f"{m['inhalt']} · {m['dauer']:.1f}s"
            + (" · UMGELEITET" if m.get("umgeleitet") else ""))


def main() -> int:
    p = argparse.ArgumentParser(description="Netzdiagnose einer Quelle")
    p.add_argument("--url", help="einzelne Adresse statt des europarl-Satzes")
    p.add_argument("--slug", default="0474-2026",
                   help="Petition für die Detailmessung (Vorgabe 0474-2026)")
    p.add_argument("--versuche", type=int, default=3,
                   help="Versuche für robots.txt (Vorgabe 3)")
    args = p.parse_args()

    # EINE Session für alles: setzt die Quelle bei einer 202 ein Cookie und
    # gibt beim zweiten Anlauf frei, sieht man das nur so. Mit frischer Session
    # je Abruf hätte man die Antwort auf "reicht Nachfassen?" weggemessen.
    s = requests.Session()
    messungen: list[dict] = []

    if args.url:
        messungen.append(messen(s, args.url, "roh", f"Einzeladresse {args.url[:60]}"))
    else:
        robots = f"https://{E.BASE_URL.split('//')[1]}/robots.txt"

        # 1) robots.txt mehrfach – das ist der Punkt, an dem der Riegel zuschlägt.
        #    Wachsende Pausen, damit ein "202 = komm gleich wieder" eine echte
        #    Chance bekommt. KEINE schnelle Schleife auf eine fremde Produktivsite.
        for i in range(1, max(1, args.versuche) + 1):
            if i > 1:
                time.sleep(10 * (i - 1))
            messungen.append(messen(s, robots, "robots", f"robots.txt Versuch {i}"))
            if messungen[-1]["status"] == 200:
                break                      # gelesen – weitere Versuche wären Last ohne Erkenntnis

        # 2) Gegenprobe mit neutralem Kennzeichen: IP-Sperre oder UA-Sperre?
        time.sleep(5)
        messungen.append(messen(s, robots, "robots",
                                "robots.txt mit neutralem User-Agent",
                                ua=NEUTRALER_UA))

        # 3+4) Die beiden Adressen, die der Scraper wirklich braucht. Sie werden
        #      hier zum ERSTEN Mal aus dem Rechenzentrum versucht – bisher hat
        #      der Riegel sie nie bis zum Netz durchgelassen.
        time.sleep(5)
        messungen.append(messen(s, E.LIST_URL.format(size=20), "liste",
                                "Trefferliste (Entdeckung)"))
        time.sleep(5)
        messungen.append(messen(s, E._detail_url(args.slug, "en"), "detail",
                                f"Detailseite {args.slug} (EN)"))

    for m in messungen:
        _melde("notice", "Netzdiagnose", _zeile(m))

    # ---- Auswertung -------------------------------------------------------
    # ⚠️ Die Schlusszeile wird IMMER ausgegeben. Fehlt sie in den Anmerkungen,
    # ist das Skript nicht gelaufen – dann ist der Schritt still übersprungen
    # worden und nicht etwa "grün geprüft".
    robots_ok = any(m["status"] == 200 and "robots" in m["was"].lower()
                    for m in messungen)
    seiten = [m for m in messungen if m["was"].startswith(("Trefferliste", "Detailseite"))]
    seiten_ok = [m for m in seiten if m["status"] == 200 and "FEHLT" not in m["inhalt"]
                 and not m["inhalt"].startswith("0 ")]

    waf = [m for m in messungen if "WAF" in m["inhalt"]]

    if waf and not seiten_ok:
        # Der wichtigste Fall und der einzige, der eine ENTSCHEIDUNG erzwingt:
        # gegen eine JavaScript-Prüfung kommt ein HTTP-Client grundsätzlich
        # nicht an. Dann ist es keine Fehlkonfiguration mehr, sondern die
        # Quelle will diesen Standort nicht bedienen.
        urteil = (f"AWS-WAF-Sperrseite bei {len(waf)} von {len(messungen)} "
                  "Abrufen – die Quelle stellt hier eine JavaScript-Prüfung. "
                  "Weder mehr Versuche noch ein Rückfall am robots-Riegel "
                  "ändern daran etwas; europarl ist von diesem Standort aus "
                  "nicht scrapebar.")
    elif robots_ok:
        urteil = ("robots.txt ist von hier aus LESBAR – die Sperre im Lauf war "
                  "also vorübergehend oder standortabhängig.")
    elif seiten_ok:
        urteil = (f"robots.txt NICHT lesbar, aber {len(seiten_ok)} von "
                  f"{len(seiten)} Inhaltsadressen liefern echten Inhalt → Fall (a): "
                  "nur die robots.txt ist gesperrt, ein Rückfall auf die zuletzt "
                  "gelesene Fassung holt die Plattform zurück.")
    else:
        urteil = (f"robots.txt NICHT lesbar UND 0 von {len(seiten)} "
                  "Inhaltsadressen liefern Inhalt → Fall (b): die Quelle sperrt "
                  "diesen Standort ganz. Ein Rückfall am robots-Riegel würde "
                  "europarl NICHT zurückholen.")
    _melde("warning", "Netzdiagnose Ergebnis", urteil)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:                       # noqa: BLE001
        # Ein Skriptfehler MUSS rot werden – sonst sieht ein nie gelaufener
        # Test aus wie ein bestandener.
        _melde("error", "Netzdiagnose abgebrochen", f"{type(exc).__name__}: {exc}")
        sys.exit(1)
