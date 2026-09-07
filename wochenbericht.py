#!/usr/bin/env python3
"""Wöchentlicher Zustandsbericht des PetitionsManagers per E-Mail.

Läuft als GitHub-Actions-Cron (wochenbericht.yml). Liest AUSSCHLIESSLICH die
eigene veröffentlichte Seite (Dashboard + Manifest auf GitHub Pages) — keine
Abrufe zu Fremd-Hosts, damit der Bericht auch aus einem Rechenzentrum immer
dieselbe Wahrheit sieht. Die Quell-Plattformen selbst misst er bewusst NICHT
(WAF-Sperren machten jede Messung von hier wertlos).

Inhalt: Warnungen je Kachel, ℹ-Hinweise (z. B. „Neues Feld auf der
Quellseite"), Rückstände, Gesamtzahlen — plus regelbasierte Empfehlungen,
welcher Pflege-Agent (dashboard-pfleger / quellen-wart) sich lohnt.

Versand per SMTP aus den GitHub-Secrets SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASS, BERICHT_AN. Fehlen sie, wird der Bericht nur ausgegeben und eine
::warning gesetzt (so lässt sich alles ohne Postfach erproben). Scheitert
der VERSAND trotz vorhandener Secrets, fällt der Lauf ROT aus — ein
Berichtsdienst, der still nicht liefert, ist schlimmer als keiner.
"""
from __future__ import annotations

import html
import os
import re
import smtplib
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage

BASIS = "https://petitionsmanager.github.io/petitionsmanager"


def hole(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def _text(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split("<")[0]


def _bloecke(src: str):
    for b in re.split(r'(?=data-platform=")', src):
        m = re.match(r'data-platform="([^"]+)"', b)
        if m:
            yield m.group(1), b


def _meldungen(block: str, klasse: str) -> list[str]:
    out = []
    for m in re.finditer(rf'<div class="{klasse}">(.*?)</div>', block, re.S):
        # Nur die deutsche Fassung (erste _zs-Hälfte) und nur den Titel-Teil.
        roh = re.sub(r"<[^>]+>", "|", m.group(1))
        teile = [t.strip() for t in html.unescape(roh).split("|") if t.strip()]
        if teile:
            out.append(teile[0] + (f" — {teile[1][:140]}" if len(teile) > 1 else ""))
    return out


def bericht_bauen() -> tuple[str, str]:
    """(Betreff, Text). Wirft bei Netz-/Parsefehlern — der Lauf soll dann
    rot sein, nicht einen leeren Bericht verschicken."""
    dash = hole(f"{BASIS}/dashboard.html")
    import json
    manifest = json.loads(hole(f"{BASIS}/data/manifest.json"))
    gesamt = sum(p.get("count") or 0 for p in manifest.get("platforms", []))
    stand = manifest.get("generated_at", "?")

    warn, info, rueckstand = [], [], []
    for key, block in _bloecke(dash):
        for w in _meldungen(block, "healthwarn"):
            warn.append(f"- {key}: {w}")
        for i in _meldungen(block, "healthinfo"):
            info.append(f"- {key}: {i}")
        m = re.search(r"(\d+) von ~(\d+)", block)
        if m and int(m.group(2)) > 0:
            anteil = int(m.group(1)) / int(m.group(2))
            if anteil < 0.5:
                rueckstand.append(f"- {key}: {m.group(1)} von ~{m.group(2)} "
                                  f"({round(anteil * 100)} %)")

    empfehlungen = []
    if any("Lokale Pflege überfällig" in w for w in warn):
        empfehlungen.append("Der PC-Timer liefert nicht — auf dem Rechner "
                            "pflege-lauf.log und Markerdatei ansehen.")
    if any("Neues Feld" in i for i in info):
        empfehlungen.append("Feld-Meldungen offen — eine Sitzung mit dem "
                            "quellen-wart lohnt sich.")
    if warn and not empfehlungen:
        empfehlungen.append("Warnungen offen — eine Sitzung mit dem "
                            "dashboard-pfleger lohnt sich.")
    if not warn and not info:
        empfehlungen.append("Nichts zu tun — alles im grünen Bereich.")

    heute = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    betreff = (f"PetitionsManager-Wochenbericht {heute}: "
               f"{len(warn)} Warnung(en), {len(info)} Hinweis(e)")
    zeilen = [
        f"PetitionsManager – Wochenbericht vom {heute}",
        f"Datenstand der Veröffentlichung: {stand}",
        f"Petitionen gesamt: {gesamt} auf "
        f"{len(manifest.get('platforms', []))} Plattform-Einträgen",
        "",
        f"⚠ Warnungen ({len(warn)}):",
        *(warn or ["- keine"]),
        "",
        f"ℹ Hinweise ({len(info)}):",
        *(info or ["- keine"]),
        "",
        f"Rückstände unter 50 % ({len(rueckstand)}):",
        *(rueckstand or ["- keine"]),
        "",
        "Empfehlung:",
        *[f"- {e}" for e in empfehlungen],
        "",
        f"Dashboard: {BASIS}/dashboard.html",
    ]
    return betreff, "\n".join(zeilen)


def versenden(betreff: str, text: str) -> bool:
    host = os.environ.get("SMTP_HOST", "")
    an = os.environ.get("BERICHT_AN", "")
    if not host or not an:
        print("::warning title=Wochenbericht::SMTP-Secrets fehlen – "
              "Bericht nur im Protokoll, kein Versand.")
        return False
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    pw = os.environ["SMTP_PASS"]
    msg = EmailMessage()
    msg["Subject"] = betreff
    msg["From"] = user
    msg["To"] = an
    msg.set_content(text)
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=30,
                              context=ssl.create_default_context()) as s:
            s.login(user, pw)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(user, pw)
            s.send_message(msg)
    print(f"Bericht versendet an {an}.")
    return True


def main() -> int:
    betreff, text = bericht_bauen()
    print(betreff)
    print()
    print(text)
    print()
    versenden(betreff, text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
