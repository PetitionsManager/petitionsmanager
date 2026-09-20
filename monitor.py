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
#      python3 monitor.py --vorlauf-liste         # fast fertige Zweige nennen
# =============================================================================

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
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
    # ---- WeMove: fünf weitere Sprachen (4.9.2026) ---------------------------
    # ⚠️⚠️ GANZ am Ende, und das ist wichtig: sie teilen sich mit dem englischen
    # Zweig dasselbe DETAIL_BUDGET und denselben Checkpoint. Der englische stand
    # nach drei Wochen bei 8 von 692 Sätzen; diese fünf werden noch länger
    # brauchen. Sie dürfen unter keinen Umständen vor den deutschen Beständen
    # laufen. (Der Rundlauf dreht die Liste zwar, erhält aber die RELATIVE
    # Reihenfolge — siehe oben.)
    # Nutzerentscheidung 4.9.2026: ausdrücklich in Kauf genommen, damit der Code
    # bereitsteht, falls der Engpass fällt.
    *[wemove_scraper.PLATFORM_JE_SPRACHE[lang]
      for lang in ("es", "fr", "it", "nl", "pl")],
    # ---- foodwatch: eigene Landesorganisationen (4.9.2026) ------------------
    # Anders als bei WeMove ist hier jeder Zweig ein LAND mit eigener Sprache:
    # /fr/ ist foodwatch France, /nl/ foodwatch Nederland. Klein und offen
    # (Zähler und Volltext server-gerendert), also kein Budgetproblem.
    foodwatch_scraper.PLATFORM_JE_ZWEIG["fr"],
    foodwatch_scraper.PLATFORM_JE_ZWEIG["nl"],
    # ---- Avaaz in 17 weiteren Sprachen (4.9.2026) ---------------------------
    # ⚠️ Arabisch und Hebräisch fehlen bewusst: sie laufen von rechts nach
    # links, und die App hat keine RTL-Unterstützung. Siehe AVAAZ_SPRACHEN.
    # Klein und ohne Abrufbremse (der deutsche Zweig steht bei 100 %), aber
    # 17 Einträge — deshalb hinter allem anderen.
    *[avaaz_scraper.PLATFORM_JE_SPRACHE[s]
      for s in avaaz_scraper.AVAAZ_SPRACHEN],
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


# Ab dieser Spanne zwischen letztem Abschluss und letzter Speicherung gilt eine
# Plattform als chronisch offen. ⚠️ Der Wert muss ÜBER dem normalen Abstand
# zweier Läufe liegen (2 CI-Läufe/Tag, lokal seit 17.9. alle ~2,4 h), sonst
# verliert eine einmal abgeschnittene Plattform den Vorrang sofort — und genau
# dafür ist er da. Zwei Tage lassen mehrere Anläufe zu, bevor umgestuft wird.
CHRONISCH_OFFEN_TAGE = 2


def _chronisch_offen(meta: dict) -> bool:
    """Kommt diese Plattform seit Tagen nicht mehr zum Abschluss?

    Unterscheidet „einmal abgeschnitten" von „strukturell kaputt", und zwar an
    vorhandenen Feldern statt an neuem Zustand: ``generated_at`` setzt JEDE
    Speicherung, ``lauf_verlauf`` nur der Abschluss-Save. Liegen die beiden weit
    auseinander, ist die Plattform mehrfach gelaufen, ohne je fertig zu werden.

    ⚠️ Ohne ``lauf_verlauf`` ist die Frage NICHT beantwortbar — eine Plattform,
    die noch nie abgeschlossen hat, kann frisch angelegt sein. Die gibt hier
    False zurück und behält ihren Vorrang; ihr Fall gehört melde_eingefrorene().
    """
    verlauf = meta.get("lauf_verlauf") or []
    if not verlauf:
        return False
    letzter_abschluss = _zeitpunkt(verlauf[-1].get("zeit"))
    letzte_speicherung = _zeitpunkt(meta.get("generated_at"))
    if letzter_abschluss == datetime.min.replace(tzinfo=timezone.utc):
        return False
    return (letzte_speicherung - letzter_abschluss
            > timedelta(days=CHRONISCH_OFFEN_TAGE))


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
    if not abgeschlossen and _chronisch_offen(meta):
        # ⚠️⚠️ Der Vorrang gilt nur für KURZ Unterbrochene. Wer seit Tagen nie
        # zum Abschluss kommt, ist nicht unterbrochen, sondern kaputt — und
        # belegte mit dem Vorrang dauerhaft Platz 1. Gemessen am 17.9.2026:
        # Läufe #78 und #79 begannen beide bei Change.org, identische
        # Reihenfolge; damit traf der Fristabbruch IMMER dieselben drei am Ende
        # (weact, avaaz, openpetition — openpetition brach nach 64 min mitten
        # in der Entdeckung ab). Genau das sollte der Rundlauf verhindern.
        # Solche Fälle verlieren den Vorrang und werden gemeldet; sie kommen
        # über den Zeitstempel weiterhin dran, nur nicht mehr immer zuerst.
        abgeschlossen = 1
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
    if core.in_github_actions():
        # Als Anmerkung, nicht nur ins Protokoll: das Lauf-Protokoll braucht
        # einen Token, Anmerkungen nicht (siehe die Lehre vom 10.8.2026).
        offen = [p.name for p, m in zip(targets, marken) if not m[0]]
        print(f"::notice title=Rundlauf::Beginn bei {gedreht[0].name} "
              f"(Position {start + 1}/{len(targets)}). Reihenfolge: "
              + ", ".join(p.key for p in gedreht)
              + (f". Ohne Abschluss im letzten Lauf: {', '.join(offen)}."
                 if offen else "."))
    # ⚠️ Ein chronischer Fall darf nicht STILL seinen Vorrang verlieren. Sonst
    # verschwindet er aus dem Blick, statt aufzufallen — und dass Change.org
    # seit Wochen keinen Abschluss schreibt, ist der eigentliche Befund, nicht
    # die Sortierung. Als warning, damit es neben den Zustandsmeldungen steht.
    chronisch = [p.name for p in targets
                 if _chronisch_offen(core.load_meta(p.data_file))]
    if chronisch:
        hinweis = (f"Seit über {CHRONISCH_OFFEN_TAGE} Tagen ohne Abschluss, "
                   f"daher ohne Rundlauf-Vorrang: {', '.join(chronisch)}. "
                   f"Der Vorrang ist für kurz Unterbrochene gedacht; wer ihn "
                   f"dauerhaft hält, verdrängt alle anderen vom Anfang.")
        core.log(f"Rundlauf: {hinweis}")
        if core.in_github_actions():
            print(f"::warning title=Rundlauf::{hinweis}")
    return gedreht


EINGEFROREN_TAGE = 6
# ⚠️ Schwelle bewusst ÜBER der Zykluslänge des Rundlaufs: 17 Einträge bei ~4
# durchlaufenen je Nacht ≈ 4–5 Tage, bis jeder wieder dran war. Wer den Wert
# senkt, meldet den Normalbetrieb als Ausfall.


def melde_eingefrorene() -> None:
    """Warnt, wenn eine Plattform seit EINGEFROREN_TAGE keinen ABGESCHLOSSENEN
    Lauf hatte (letzter Eintrag in lauf_verlauf) oder ihre Entdeckung zuletzt
    NICHTS fand (available == 0: Host gesperrt oder ausgelassen).

    Genau daran ist Europarl wochenlang unbemerkt eingefroren: der Bestand
    blieb unverändert stehen und sah dadurch gesund aus (24.8.2026). Als
    ::warning, weil Anmerkungen ohne Token lesbar sind — die Lauf-Protokolle
    nicht (Lehre vom 10.8.2026). Bestände ohne _meta werden übergangen: noch
    nie gelaufen ist der Anfangszustand, kein Ausfall."""
    jetzt = datetime.now(timezone.utc)
    for p in PLATFORMS:
        if not p.is_live:
            continue
        meta = core.load_meta(p.data_file)
        if not meta:
            continue
        gruende = []
        verlauf = meta.get("lauf_verlauf") or []
        if verlauf:
            alter = (jetzt - _zeitpunkt(verlauf[-1].get("zeit"))).days
            if alter >= EINGEFROREN_TAGE:
                gruende.append(f"letzter abgeschlossener Lauf {alter} Tage her")
        if meta.get("available") == 0:
            gruende.append("die Entdeckung fand zuletzt NICHTS "
                           "(Host gesperrt oder ausgelassen?)")
        if gruende:
            text = f"{p.name}: " + " · ".join(gruende)
            core.log(f"⚠️ {text}")
            if core.in_github_actions():
                print(f"::warning title=Plattform liefert nichts::{text}")


# ----------------------------------------------------------------------------
# Melder: veraltete Unterschriftenzahlen
# ----------------------------------------------------------------------------
# Anlass: die Nachprüfung steht seit 8815975 auf 72 statt 24 Stunden. Das war
# nötig (das Budget war mit 136 % überzeichnet), hat aber einen Preis: Zahlen
# altern bis zu drei Tage, und das trifft fast alle Sätze — gemessen sind nur
# 0,5 % offline. Bis hierher gab es nichts, was das Altern bemerkt hätte; der
# Bestand sieht auch dann gesund aus, wenn seine Zahlen Wochen alt sind. Genau
# so ist europarl 2026 wochenlang unbemerkt eingefroren.
#
# ⚠️⚠️ DIE SCHWELLE IST HERGELEITET, NICHT GEMESSEN. Am Sitzungsbaum lässt sie
# sich nicht bestimmen: dort liegen die Repo-Stände (Median 51 Tage alt), die
# lebenden Bestände stehen im Actions-Cache, und `last_checked` wird von
# publish.py vor dem Veröffentlichen entfernt — von außen ist das Feld also
# nicht sichtbar. Hergeleitet aus: 72 h Mindestabstand plus eine volle
# Plattform-Runde. Die Runde dauerte vor dem Freiwerden des Budgets 4–5 Tage,
# sollte jetzt kürzer sein. 7 Tage lassen damit einen ganzen verpassten Zyklus
# zu, bevor gemeldet wird.
# ➡️ SOBALD ECHTE ZAHLEN VORLIEGEN (erster CI-Lauf mit dieser Fassung, die
#    Verteilung steht in der Anmerkung), gehört der Wert überprüft. Er ist
#    bewusst großzügig: ein Melder, der im Normalbetrieb schreit, wird ignoriert.
UNTERSCHRIFTEN_VERALTET_TAGE = 7
# Erst ab diesem Anteil wird gemeldet. Einzelne Nachzügler sind normal — eine
# Plattform, die gerade erst wieder an der Reihe war, hat naturgemäß alte Sätze.
UNTERSCHRIFTEN_VERALTET_ANTEIL = 0.25
# ⚠️⚠️ GitHub deckelt die Anmerkungen je Schritt. Am 17.9.2026 ist dadurch die
# Meldung „Zeitrahmen beim Scrapen erreicht" verschwunden — der Schritt hatte
# vorher schon 21 Warnungen abgesetzt. Ein Melder, der im Ernstfall 41 Zeilen
# schreibt, verdrängt genau die Meldungen, für die er gebaut wurde. Deshalb ein
# Deckel, und die Zahl der verschwiegenen Fälle kommt in die Sammelmeldung:
# eine still gekappte Liste liest sich wie „mehr war nicht".
UNTERSCHRIFTEN_MAX_WARNUNGEN = 5


def melde_veraltete_unterschriften() -> None:
    """Warnt, wenn die Unterschriftenzahlen einer Plattform veralten.

    ⚠️⚠️ Der wichtigste Fall ist NICHT „zu viele alt", sondern „nicht
    messbar": trägt kein einziger Satz ein ``last_checked``, sieht das in einer
    naiven Zählung aus wie „null veraltet" — also wie Gesundheit. Dieser Fall
    wird deshalb ausdrücklich getrennt gemeldet. Wer das zusammenfallen lässt,
    baut einen Melder, der bei kaputtem Mechanismus schweigt.
    """
    jetzt = datetime.now(timezone.utc)
    grenze = timedelta(days=UNTERSCHRIFTEN_VERALTET_TAGE)
    gesamt_alt = gesamt = 0
    gemeldet = verschwiegen = 0
    for p in PLATFORMS:
        if not p.is_live:
            continue
        try:
            store = core.load_store(p.data_file)
        except (OSError, ValueError):
            continue
        saetze = [r for k, r in (store or {}).items()
                  if not k.startswith("_") and isinstance(r, dict)]
        if not saetze:
            continue
        alt = ohne = 0
        aeltestes = None
        for r in saetze:
            zp = _zeitpunkt(r.get("last_checked"))
            if zp == datetime.min.replace(tzinfo=timezone.utc):
                ohne += 1
                continue
            if jetzt - zp > grenze:
                alt += 1
                if aeltestes is None or zp < aeltestes:
                    aeltestes = zp
        messbar = len(saetze) - ohne
        gesamt += len(saetze)
        gesamt_alt += alt
        # Fall A: gar nichts messbar. Das ist ein Defekt, keine Gesundheit.
        if messbar == 0:
            text = (f"{p.name}: kein einziger von {len(saetze)} Sätzen trägt "
                    f"last_checked — das Alter der Unterschriftenzahlen ist "
                    f"hier NICHT prüfbar (nicht: alles frisch).")
            core.log(f"⚠️ {text}")
            if core.in_github_actions():
                if gemeldet < UNTERSCHRIFTEN_MAX_WARNUNGEN:
                    print(f"::warning title=Unterschriften nicht pruefbar::{text}")
                    gemeldet += 1
                else:
                    verschwiegen += 1
            continue
        # Fall B: messbar, aber zu vieles zu alt.
        anteil = alt / messbar
        if anteil >= UNTERSCHRIFTEN_VERALTET_ANTEIL:
            tage = (jetzt - aeltestes).days if aeltestes else 0
            text = (f"{p.name}: {alt} von {messbar} Unterschriftenzahlen sind "
                    f"älter als {UNTERSCHRIFTEN_VERALTET_TAGE} Tage "
                    f"({anteil:.0%}), ältester Stand {tage} Tage. Der "
                    f"Mindestabstand liegt bei "
                    f"{core.DEFAULT_MIN_INTERVAL_HOURS} h — wenn so viel "
                    f"darüber liegt, kommt die Nachprüfung nicht durch.")
            core.log(f"⚠️ {text}")
            if core.in_github_actions():
                if gemeldet < UNTERSCHRIFTEN_MAX_WARNUNGEN:
                    print(f"::warning title=Unterschriftenzahlen veralten::{text}")
                    gemeldet += 1
                else:
                    verschwiegen += 1
    # Eine Gesamtzahl auch ohne Ausreißer — sie ist die Grundlage, an der die
    # oben hergeleitete Schwelle später überprüft werden kann. ⚠️ Und sie nennt
    # ausdrücklich, wie viele Warnungen der Deckel geschluckt hat: eine still
    # gekappte Liste liest sich wie „mehr war nicht".
    if gesamt and core.in_github_actions():
        rest = (f" {verschwiegen} weitere Plattform(en) betroffen, wegen des "
                f"Anmerkungs-Deckels nicht einzeln gemeldet."
                if verschwiegen else "")
        print(f"::notice title=Unterschriften-Alter::{gesamt_alt} von {gesamt} "
              f"Sätzen älter als {UNTERSCHRIFTEN_VERALTET_TAGE} Tage "
              f"({gesamt_alt / gesamt:.1%}). Schwelle je Plattform: "
              f"{UNTERSCHRIFTEN_VERALTET_ANTEIL:.0%}.{rest}")


# ----------------------------------------------------------------------------
# Vorlauf: zuerst die Zweige, denen nur noch wenig zur Vollständigkeit fehlt
# ----------------------------------------------------------------------------
# Anlass (17.9.2026, am Live-Dashboard gemessen, 41 von 41 Kacheln gelesen):
# 22 der 41 Zweige stehen bei 100 %. Der gesamte Rückstand OHNE Change.org sind
# 235 Kandidaten in zehn Zweigen — bei REQUEST_DELAY 1,5 s rund 5,9 Minuten:
#   avaaz_it/ko/uk/zh/ja je 1 · avaaz_en 4 · foodwatch_fr 13 ·
#   foodwatch_en 14 · wemove 34 · wemove_es 165.
# Change.org allein steht bei 13.513 offenen Kandidaten (5,63 h) und ist genau
# deshalb NICHT gemeint: für diesen Dauerrückstand gibt es die eigene
# Aufholschleife in scrape.yml.
#
# Die zehn kommen heute trotzdem nie dran — sie stehen hinten im Rundlauf, und
# die 300-min-Frist schlägt vorher zu. Sechs Minuten brächten 22 → 32 fertige
# Zweige, und ein fertiger Zweig kostet den nächsten Vorlauf gar nichts mehr:
# sein Rest ist dann 0 und er fällt aus der Auswahl heraus.
#
# ⚠️ Diese Funktionen SUCHEN nur aus und drucken Schlüssel — es wird nichts
# gescrapt und nichts geschrieben. Den Zeitdeckel setzt der Aufrufer
# (scrape.yml: `timeout --signal=INT`), wie bei jedem anderen Schritt auch;
# hier steht ausschließlich die MENGE.
#
# ⚠️ Der Aufrufer soll die genannten Zweige mit --no-recheck starten: der
# Vorlauf soll ENTDECKEN, nicht nachzählen. Am 17.9.2026 an allen 41 Zweigen
# NACHGESEHEN statt angenommen: 37 werten das Flag aus. VIER nicht —
# foodwatch_en (run_en), foodwatch_fr/foodwatch_nl (run_zweig) und eko_en
# (run_en) holen ihre Liste bauartbedingt Seite für Seite; dort kostet ein
# Lauf so viele Abrufe, wie die Entdeckung findet („available"), nicht so
# viele, wie offen sind. Es sind die kleinsten Zweige überhaupt (available
# 21–50 ≈ 30–75 s), und die harte Grenze zieht ohnehin der `timeout` des
# Aufrufers — aber wer hier rechnet, darf für diese vier nicht mit dem Rest
# rechnen.
VORLAUF_MAX_OFFEN = 200
# Obergrenze des offenen Restes JE ZWEIG — nicht geraten, sondern in die Lücke
# der echten Werte gelegt. Gemessene Reste am 17.9.2026: 22 × 0, dann
# 1,1,1,1,1,4,13,14,34,165 — und danach erst 13.513 (Change.org), Faktor 82.
# Die 200 liegen mit Luft über den 165 von wemove_es (dort kommen täglich
# Kandidaten dazu) und weit unter allem, was dem Sammellauf gefährlich würde:
# 200 × 1,5 s ≈ 5 min für den teuersten einzelnen Zweig.

VORLAUF_BUDGET = 400
# ⚠️⚠️ Der wirksamste der drei Deckel: Summe der offenen Reste über ALLE
# gewählten Zweige. Die Einzelschwelle allein genügt nicht — zwölf Zweige mit
# je 190 offenen wären 2.280 Kandidaten = 57 min, und damit wäre der „Vorlauf"
# ein zweiter Sammellauf und die Frist gesprengt. Gemessen sind es heute 235;
# 400 ≈ 10 min lässt Zuwachs zu und bleibt bei rund 3 % der 300-min-Frist.

VORLAUF_MAX_ZWEIGE = 12
# Dritter Deckel, gegen die Entdeckungskosten: jeder Zweig kostet zusätzlich zu
# seinen offenen Kandidaten seine eigene Entdeckung (je nach Plattform eine
# Handvoll Listenabrufe). Heute kämen zehn Zweige in Frage — 12 ist die Kante
# knapp darüber.


def _bestand_und_meta(datei: Path | None) -> tuple[int | None, dict]:
    """(Zahl der Sätze, _meta) eines Bestandes – EINMAL gelesen und ohne jede
    Nebenwirkung.

    ⚠️ Bewusst nicht core.load_store(): das benennt eine unlesbare Datei in
    „.corrupt.json" um. Für einen Scrape-Lauf ist das richtig, für eine reine
    Auswahlabfrage wäre es eine stille Änderung am Datenbestand. Hier gilt
    unlesbar = unbekannt (None), und unbekannt fliegt weiter unten raus.
    """
    if not datei or not datei.exists():
        return None, {}
    try:
        daten = json.loads(datei.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None, {}
    if not isinstance(daten, dict):
        return None, {}
    meta = daten.pop("_meta", None)
    return len(daten), (meta if isinstance(meta, dict) else {})


def offener_rest(p: Platform) -> tuple[int | None, str]:
    """Wie viele entdeckte Kandidaten hat dieser Zweig noch NICHT abgearbeitet?

    Rückgabe (Rest, Begründung). Rest ist None, wenn es keine belastbare Zahl
    gibt — dann gehört der Zweig NICHT in den Vorlauf.

    Die Rechnung ist absichtlich dieselbe wie auf der Dashboard-Kachel
    (petitions_core._live_card): available − (Sätze + verworfene Kandidaten).

    ⚠️⚠️ Ein FEHLENDER Wert ist kein kleiner Wert. „available" setzt jeder
    Scraper selbst direkt nach seiner Entdeckung (core.lauf_meta_setzen, z. B.
    openpetition_scraper.py); fehlt das Feld, ist der Lauf vorher abgebrochen
    (heute: openpetition), und ist es 0, hat die Entdeckung nichts gefunden
    (Host ausgelassen oder Zweig tot — heute europarl, wemove_en/fr/it/nl/pl,
    avaaz_ms). Beides würde ohne diese Prüfung als „Rest 0" oder als winziger
    Rest durchgehen und einen Zweig in den Vorlauf holen, über den wir nichts
    wissen. Dieselbe Falle hat das Dashboard bis zum 24.8.2026 als „100 %
    abgearbeitet" angezeigt; der Rückfall „available or len(store)" hat zwei
    Wochen Stillstand verdeckt. Deshalb hier: unbekannt heißt raus.

    ⚠️ „Host ausgelassen" wird EIGENS geprüft und nicht über available == 0
    abgekürzt: von vier gesperrten Zweigen hatte am 30.8.2026 nur einer die 0,
    die anderen trugen 39/30/698 — der robots-Riegel greift oft erst nach der
    Entdeckung (siehe core.host_gesperrt). Ein gesperrter Host liefert auch im
    Vorlauf nichts; seine Zahlen stammen aus früheren Läufen.

    ⚠️ Ein NEGATIVER Rest ist 0, nicht eine riesige Zahl mit Vorzeichenfehler.
    available nennt nur, was DIESER Lauf gesehen hat, und das ist bei mehreren
    Plattformen bauartbedingt weniger als unser Bestand (bundestag entdeckt nur
    die laufende Mitzeichnungsfrist, weact/openpetition verlieren offline
    gegangene Sätze aus der Liste). Die Kachel sagt dazu wörtlich „alle 1896 in
    diesem Lauf gefundenen Kandidaten sind im Bestand · der Bestand (1924) ist
    größer". Das ist Vollständigkeit, kein Rückstand.
    """
    anzahl, meta = _bestand_und_meta(p.data_file)
    if anzahl is None:
        return None, "kein lesbarer Bestand (noch nie gelaufen?)"
    if not meta:
        return None, "kein _meta im Bestand"
    if any(b.get("stufe") == "warnung"
           and b.get("thema") == core.THEMA_HOST_AUSGELASSEN
           for b in (meta.get("befunde") or [])):
        return None, "Host im letzten Lauf gesperrt"
    # ---- Regelfall: die Bilanz des letzten Laufs ---------------------------
    # ⚠️⚠️ Der Planer MUSS dieselbe Rechnung benutzen wie die Kachel. Bis zum
    # 19.9.2026 rechnete er `anzahl + verworfen` gegen `available` und kannte
    # das Register `unbrauchbare` nicht: alle fünf lokal gepflegten
    # WeMove-Zweige meldeten damit zusammen 315 „offene Kandidaten", die es
    # nicht gab (en 102, fr 66, nl 54, it 47, pl 46). Bei einer Schwelle von
    # 200 je Zweig und einem Budget von 400 kamen sie deshalb Tag für Tag in
    # den Vorlauf — für Seiten, die der Scraper unmittelbar danach überspringt,
    # auf Kosten des WeMove-WAF-Fensters. Ein falscher Rückstand ist hier nicht
    # nur Kosmetik, er verbrennt genau das knappste Gut.
    bilanz = meta.get("bilanz")
    if isinstance(bilanz, dict) and not bilanz.get("fehler"):
        gefunden = bilanz.get("gefunden")
        offen = bilanz.get("offen")
        if isinstance(gefunden, int) and isinstance(offen, int) and gefunden > 0:
            return offen, (f"{gefunden - offen} von {gefunden} erledigt "
                           f"(Bilanz vom {str(bilanz.get('stand'))[:16]})")
    # ---- Rückfall für Bestände ohne Bilanz ---------------------------------
    available = meta.get("available")
    if not isinstance(available, int) or isinstance(available, bool):
        return None, "kein available (Lauf abgebrochen)"
    if available <= 0:
        return None, "available = 0 (Entdeckung fand nichts)"
    # Verworfene Kandidaten sind ABGEARBEITET (geholt, geprüft, aussortiert) und
    # dürfen nicht als Rückstand zählen — sonst stünde Change.org für immer im
    # Vorlauf, obwohl sein Vorrat durch ist, und der Zweig käme jeden Tag wieder
    # mit demselben Rest. Für alle anderen Plattformen ist das Register leer.
    # ⚠️ Diese Rechnung sieht `unbrauchbare` NICHT. Sie gilt nur, bis der Zweig
    # einmal gelaufen ist; der Grund sagt es, damit ein zu großer Rest nicht
    # als Tatsache durchgeht.
    erfasst = anzahl + len(core.als_register(meta.get("verworfen")))
    rest = max(0, available - erfasst)
    return rest, (f"{erfasst} von ~{available} abgearbeitet "
                  f"(ohne Bilanz – Rückstand womöglich zu hoch)")


def vorlauf_kandidaten(platforms: list[Platform],
                       max_offen: int = VORLAUF_MAX_OFFEN,
                       budget: int = VORLAUF_BUDGET,
                       max_zweige: int = VORLAUF_MAX_ZWEIGE,
                       ) -> list[tuple[Platform, int]]:
    """Die Zweige, die mit wenigen Abrufen fertig würden – klein sortiert,
    dreifach gedeckelt.

    ⚠️⚠️ Diese Funktion ist bewusst so gebaut, dass sie im Zweifel NICHTS
    liefert. Der teure Fehler wäre der umgekehrte: eine Auswahl, die bei
    unklarer Lage alle 41 Zweige zurückgibt, machte aus dem Vorlauf einen
    zweiten Sammellauf und risse die Frist — und das fiele erst Stunden später
    auf. Jede der drei Bedingungen kann nur AUSSCHLIESSEN:
      · Rest unbekannt (siehe offener_rest)      → raus
      · Rest 0 (fertig) oder > max_offen (groß)  → raus
      · Summe über budget / mehr als max_zweige  → raus
    Es gibt keinen Rückfall, der bei fehlenden Daten etwas hinzufügt.
    """
    mit_rest: list[tuple[Platform, int]] = []
    for p in platforms:
        if not p.is_live or not p.run:
            continue
        rest, _ = offener_rest(p)
        # Rest 0 heißt fertig: ein Lauf brächte nur die Entdeckung, keinen
        # einzigen neuen Satz. Das ist der Zustand, den der Vorlauf HERSTELLEN
        # soll, nicht der, den er bearbeitet.
        if rest is None or rest <= 0 or rest > max_offen:
            continue
        mit_rest.append((p, rest))
    # Klein zuerst: die billigsten Zweige werden im selben Lauf fertig und
    # fallen aus der Liste. sorted() ist stabil – bei gleichem Rest bleibt die
    # Reihenfolge der Registry (deutsche Zweige vor den Sprachzwillingen).
    mit_rest.sort(key=lambda t: t[1])
    gewaehlt: list[tuple[Platform, int]] = []
    summe = 0
    for p, rest in mit_rest:
        if len(gewaehlt) >= max_zweige:
            break
        if summe + rest > budget:
            # Aufsteigend sortiert: was hier nicht mehr passt, passt danach
            # erst recht nicht. Abbrechen statt überspringen.
            break
        gewaehlt.append((p, rest))
        summe += rest
    return gewaehlt


def melde_vorlauf(platforms: list[Platform],
                  max_offen: int = VORLAUF_MAX_OFFEN,
                  budget: int = VORLAUF_BUDGET) -> list[str]:
    """Druckt die gewählten Schlüssel – EINEN JE ZEILE auf die Standardausgabe,
    sonst nichts. Alles Erklärende geht auf die Standardfehlerausgabe.

    Damit ist der Aufruf aus der Shell heraus brauchbar, ohne etwas filtern zu
    müssen:

        for k in $(python3 monitor.py --vorlauf-liste); do … ; done

    ⚠️ Der Exit-Code ist auch bei LEERER Liste 0. Leer ist das erwartete
    Ergebnis, sobald kein Zweig mehr knapp vor der Vollständigkeit steht — kein
    Fehler. Und ein Abbruch dieses Aufrufs (Exit ≠ 0, leere Ausgabe) lässt die
    Schleife oben einfach nichts tun: die Fehlerrichtung ist „zu wenig", nie
    „alles".
    """
    gewaehlt = vorlauf_kandidaten(platforms, max_offen=max_offen, budget=budget)
    schluessel = [p.key for p, _ in gewaehlt]
    for k in schluessel:
        print(k)

    # ---- Begründung, vollständig und auf stderr --------------------------
    # Auch das Verworfene wird genannt: eine Auswahl, die still schweigt,
    # ist von einer kaputten nicht zu unterscheiden.
    dabei = {p.key for p, _ in gewaehlt}
    zeilen, offen_gesamt = [], 0
    for p in platforms:
        if not p.is_live or not p.run:
            continue
        rest, grund = offener_rest(p)
        if rest is None:
            lage = f"—        unbekannt: {grund}"
        elif p.key in dabei:
            offen_gesamt += rest
            lage = f"{rest:<9}VORLAUF · {grund}"
        elif rest == 0:
            lage = f"0        fertig · {grund}"
        elif rest > max_offen:
            lage = f"{rest:<9}zu groß (> {max_offen}) · {grund}"
        else:
            lage = f"{rest:<9}Deckel erreicht · {grund}"
        # Leerzeichen als TRENNER, nicht als Füllung: ein ungewöhnlich langer
        # Schlüssel soll die Spalte verschieben, nicht mit ihr verschmelzen.
        zeilen.append(f"  {p.key:<16} {lage}")
    print(f"Vorlauf: {len(schluessel)} Zweig(e), {offen_gesamt} offene "
          f"Kandidaten (Schwelle je Zweig {max_offen}, Budget {budget}, "
          f"höchstens {VORLAUF_MAX_ZWEIGE} Zweige) ≈ "
          f"{offen_gesamt * core.REQUEST_DELAY / 60:.1f} min reine Abrufzeit.",
          file=sys.stderr)
    print("\n".join(zeilen), file=sys.stderr)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # Auf stderr, damit die Schlüsselliste auf stdout sauber bleibt; der
        # Runner liest Arbeitsablauf-Befehle aus beiden Strömen. Falls die
        # Anmerkung doch einmal fehlt, steht dasselbe im Schritt-Protokoll.
        print(f"::notice title=Vorlauf::{len(schluessel)} Zweig(e) mit "
              f"{offen_gesamt} offenen Kandidaten: "
              + (", ".join(f"{p.key} ({r})" for p, r in gewaehlt) or "keiner"),
              file=sys.stderr)
    return schluessel


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
    # ⚠️ Bewusst nur eine AUSGABE, kein eigener Lauf: was gescrapt wird,
    # entscheidet weiterhin --platform, und den Zeitdeckel setzt die Shell
    # (scrape.yml arbeitet überall mit `timeout --signal=INT`). Ein
    # eingebauter „--vorlauf"-Lauf müsste die Frist selbst kennen und wäre die
    # zweite Stelle, an der sie steht.
    p.add_argument("--vorlauf-liste", dest="vorlauf_liste",
                   action="store_true",
                   help="kein Scrape; nennt die Plattform-Schlüssel, denen nur "
                        "noch wenig zur Vollständigkeit fehlt – einen je Zeile "
                        "auf der Standardausgabe, die Begründung auf stderr. "
                        "Für einen gedeckelten Vorlauf vor dem Sammellauf. "
                        "Leere Ausgabe ist ein gültiges Ergebnis (Exit 0)")
    p.add_argument("--vorlauf-max-offen", dest="vorlauf_max_offen", type=int,
                   default=VORLAUF_MAX_OFFEN,
                   help="offener Rest je Zweig, bis zu dem er in den Vorlauf "
                        f"kommt (Default {VORLAUF_MAX_OFFEN})")
    p.add_argument("--vorlauf-budget", dest="vorlauf_budget", type=int,
                   default=VORLAUF_BUDGET,
                   help="Summe der offenen Reste über alle gewählten Zweige "
                        f"(Default {VORLAUF_BUDGET}; bei ~{core.REQUEST_DELAY} s "
                        "je Abruf sind das die Minuten, die der Vorlauf höchstens "
                        "kostet)")
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
    if core.in_github_actions():
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
        if args.vorlauf_liste:
            # Vor --check und --serve: reine Abfrage, kein Abruf, kein Schreiben.
            melde_vorlauf(PLATFORMS, max_offen=args.vorlauf_max_offen,
                          budget=args.vorlauf_budget)
            return
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
            # Ebenfalls auch bei Abbruch: der Melder liest nur die _meta und
            # kostet nichts — und ein abgeschnittener Lauf ist genau der
            # Moment, in dem eingefrorene Plattformen auffallen müssen.
            melde_eingefrorene()
            # Dasselbe Argument, ein anderer Blickwinkel: eingefroren heißt
            # „die Plattform läuft nicht mehr", veraltet heißt „sie läuft, kommt
            # aber nicht mehr durch". Der zweite Fall entstand erst durch die
            # Umstellung auf 72 h und fiele sonst niemandem auf. ⚠️ Liest den
            # ganzen Bestand, nicht nur _meta — deshalb NACH dem Schreiben.
            melde_veraltete_unterschriften()
    except KeyboardInterrupt:
        print("\nAbgebrochen.")


if __name__ == "__main__":
    main()
