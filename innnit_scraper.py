#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
#  innnit_scraper.py  —  Plattform-Modul für Innn.it (ehem. Change.org DE)
# =============================================================================
#
#  Scrapt ALLE Petitionen von innn.it über das interne Listen-API der
#  Next.js-App. Nutzt petitions_core.py; Einstieg monitor.py.
#
#  DATENQUELLE (per Reverse-Engineering der App-Chunks gefunden; Basis ist
#  NEXT_PUBLIC_INNNIT_URL + "/api", Routen in _app.js):
#    GET /api/v2/posts/initiatives?limit=100&offset=N&type=petition
#        &sort=createdAt
#    → {"data": [signable, …], "meta": {"totalCount": ~1900}}
#  Jedes signable ist VOLLSTÄNDIG (title, name=slug, content-HTML,
#  signatureCount, initiators, targets, tag=Kategorie, createdAt,
#  featuredImage, success/initiativeStatus) – Einzelseiten-Abrufe sind für
#  die Massenerfassung nicht nötig.
#
#  WEITERE ERKENNTNISSE:
#  - Detailseiten (https://innn.it/<slug>) sind SSR mit identischem
#    signable-JSON in __NEXT_DATA__ → dient als Fallback/Offline-Prüfung
#    für Petitionen, die aus dem API-Bestand verschwinden.
#  - robots.txt liefert die SPA-Shell (kein echtes robots.txt) → keine
#    maschinenlesbaren Sperren deklariert; /api/ ist damit ebenfalls nicht
#    gesperrt (anders als z. B. bei Avaaz).
#  - Suchfunktion der Seite (/external-search) ist nur eine Google-CSE-
#    Weiterleitung, kein eigenes API.
# =============================================================================

from __future__ import annotations

import json
import re
from pathlib import Path

import petitions_core as core
from petitions_core import Platform, log, now_iso, prog

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
BASE_URL  = "https://innn.it"
API_URL   = (f"{BASE_URL}/api/v2/posts/initiatives"
             "?limit={limit}&offset={offset}&type=petition&sort=createdAt")
API_LIMIT = 100
MAX_API_PAGES = 60                 # Sicherheitslimit (~6.000 Petitionen)

DATA_FILE = Path("innnit_petitions.json")
HTML_FILE = Path("innnit_petitions.html")

# Der Slug kommt aus dem API-Feld "name" und baut unten die Petitionsadresse
# (f"{BASE_URL}/{slug}") — er ist also eine FREMDE Angabe an einer Stelle, an
# der sie zur Adresse wird.
#
# ⚠️ Hier wird bewusst NICHT aufgezählt, was erlaubt ist. Am Bestand gemessen
# (10.8.2026, 1.977 Sätze): neben Buchstaben und Ziffern kommt als
# Sonderzeichen ausschließlich der Bindestrich vor — aber es gibt Umlaute
# ("Präventivhaft", "MehrPsychotherapieplätze") und führende Bindestriche
# ("-lebensmittel-froschmafia"). Das naheliegende Muster ^[a-z0-9-]+$ hätte
# 16 echte Petitionen still verworfen. Gesperrt wird deshalb nur das Wenige,
# das wirklich schadet: Zeichen, die die Adresse zerlegen, und der Rückschritt.
SLUG_VERBOTEN_RE = re.compile(r"[/?#\\\s]")
SLUG_MAX = 300                     # längster echter Slug am 10.8.2026: 194


def slug_ok(slug) -> bool:
    return (isinstance(slug, str) and 0 < len(slug) <= SLUG_MAX
            and not SLUG_VERBOTEN_RE.search(slug) and ".." not in slug)

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)

FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) "
                   "Gecko/20100101 Firefox/128.0"),
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9",
}


# ----------------------------------------------------------------------------
# signable-JSON → Datensatz (gilt für API-Items UND Detailseiten-JSON)
# ----------------------------------------------------------------------------
# Alle Schlüssel des signable-Objekts, die wir GESEHEN und ENTSCHIEDEN haben —
# genutzte wie verworfene. Was hier fehlt, meldet core.felder_melden() als
# „Neues Feld auf der Quellseite".
#
# ⚠️⚠️ Abgelesen über ACHT echte Petitionen, nicht über eine. Genau das war
# nötig: eine einzelne Seite trug 28 Schlüssel, die Vereinigung über acht
# dagegen 31 — und nur 22 standen auf allen. Wer die Liste aus einer Stichprobe
# von 1 baut, lässt den Melder wochenlang Nachzügler melden.
#
# ⚠️ Vier davon sind gar keine Inhalte, sondern Tracking-Parameter der Quelle
# (`gclid` kommt von Google-Anzeigen, `mtm_*` von Matomo). Sie stehen hier als
# ausdrücklich VERWORFEN — nicht, weil sie unbekannt wären, sondern damit der
# Melder sie nicht täglich wiederholt.
BEKANNTE_FELDER = {
    # auf allen acht Seiten
    "_id", "_initiators", "authorId", "canEdit", "content", "createdAt",
    "featuredImage", "hashtag", "hidden", "highlight", "id",
    "initiativeStatus", "initiators", "name", "signatureCount", "status",
    "success", "tag", "targets", "title", "type", "updatedAt",
    # nur auf manchen — echte Inhalte
    "optionalFields", "sharingImage", "sharingImageStatus", "signatureTarget",
    "cleverreachSegment", "highlightPriority",
    # verworfen: Tracking, keine Petitionsinhalte
    "gclid", "mtm_campaign", "tracked_campaign",
}


def record_from_signable(sig: dict) -> dict:
    # Die Schlüssel des Quellobjekts einsammeln, bevor wir auswählen — sonst
    # sähe der Melder nur, wonach ohnehin gesucht wird.
    core.felder_gesehen(sig)
    rec: dict = {}
    rec["title"] = sig.get("title")
    rec["petition_id"] = sig.get("id") or sig.get("_id")
    slug = sig.get("name")
    rec["url"] = f"{BASE_URL}/{slug}" if slug else None

    content = sig.get("content")
    if content:
        from bs4 import BeautifulSoup
        frag = BeautifulSoup(content, "html.parser")
        rec["description_full"] = core.sanitize_fragment(frag, BASE_URL) or None
        text = frag.get_text(" ", strip=True)
        rec["summary"] = (text[:200] + "…") if len(text) > 200 else text or None

    inits = [i.get("displayName") for i in sig.get("initiators") or []
             if isinstance(i, dict) and i.get("displayName")]
    rec["started_by"] = ", ".join(inits)[:200] or None
    targets = [t.get("name") for t in sig.get("targets") or []
               if isinstance(t, dict) and t.get("name")]
    rec["recipient"] = ", ".join(targets)[:300] or None

    tag = sig.get("tag") or {}
    rec["category"] = tag.get("title")

    count = core.zahl(sig.get("signatureCount"))
    if count is not None:
        rec["signatures"] = count
    target = core.zahl(sig.get("signatureTarget"))
    if target:
        rec["goal"] = target

    created = sig.get("createdAt")
    if created:
        rec["start_date"] = str(created)[:19]

    img = (sig.get("featuredImage") or {}).get("urls") or {}
    rec["image_url"] = img.get("original") or img.get("lg") or None

    rec["kind"] = "petition"
    if sig.get("success"):
        rec["category"] = (rec["category"] + " · Erfolg" if rec["category"]
                           else "Erfolg")
    return rec


# ----------------------------------------------------------------------------
# Detailseite (Fallback: Offline-Prüfung nicht mehr gelisteter Petitionen)
# ----------------------------------------------------------------------------
def scrape_petition(fetcher: core.Fetcher, slug: str) -> tuple[str, dict | None]:
    url = f"{BASE_URL}/{slug}"
    resp = fetcher.get(url)
    if resp is None:
        return "error", None
    if resp.status_code in (404, 410):
        return "offline", None
    if not resp.ok:
        return "error", None
    m = NEXT_DATA_RE.search(resp.text)
    if not m:
        return "offline", None
    try:
        props = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
    except ValueError:
        return "error", None
    sig = props.get("signable")
    if not sig or props.get("hasError"):
        return "offline", None
    return "online", record_from_signable(sig)


# ----------------------------------------------------------------------------
# Ablauf eines Laufs
# ----------------------------------------------------------------------------
def run(args) -> None:
    store = core.load_store(DATA_FILE)
    fetcher = core.Fetcher(delay=args.delay, headers=FETCH_HEADERS)
    ts = now_iso()

    def save(quiet=True, **extra):
        core.save_store(store, DATA_FILE, extra_meta=extra, quiet=quiet)

    # Gesamtbestand über das Listen-API einsammeln (voll paginiert).
    log("Lade Gesamtbestand über /api/v2/posts/initiatives …")
    prog(phase="discover", current=0, total=0, message="Lade API-Seiten …")
    seen: set[str] = set()
    verworfen = 0
    offset, total_count, page = 0, None, 0
    while page < MAX_API_PAGES:
        resp = fetcher.get(API_URL.format(limit=API_LIMIT, offset=offset))
        if resp is None or not resp.ok:
            break
        try:
            data = json.loads(resp.text)
        except ValueError:
            break
        items = data.get("data") or []
        total_count = (data.get("meta") or {}).get("totalCount", total_count)
        if not items:
            break
        for sig in items:
            slug = sig.get("name")
            # Zuerst prüfen, dann erst `in seen`: ein Nicht-Text (etwa ein
            # verschachteltes Objekt) ließe die Mengenabfrage abstürzen.
            if not slug_ok(slug):
                if slug:
                    verworfen += 1
                continue
            if slug in seen:
                continue
            seen.add(slug)
            core.upsert(store, slug, record_from_signable(sig), {},
                        "online", ts, f"{BASE_URL}/{slug}")
        save()
        page += 1
        offset += API_LIMIT
        prog(current=len(seen), total=total_count or 0,
             message=f"API-Seite {page} · {len(seen)} Petitionen")
        if args.limit and len(seen) >= args.limit:
            break
        if total_count is not None and offset >= total_count:
            break
    log(f"API: {len(seen)} Petitionen übernommen "
        f"(gemeldeter Gesamtbestand: {total_count}).")
    # Verworfenes wird GEMELDET, nicht stillschweigend übergangen: eine
    # geänderte Slug-Form von innn.it sähe sonst wie ein schrumpfender Bestand
    # aus, und niemand wüsste, dass unsere eigene Prüfung sie aussortiert.
    if verworfen:
        core.befund("warnung", "innn.it: Slugs verworfen",
                    f"{verworfen} Petition(en) haben einen Slug mit Zeichen, die "
                    f"eine Adresse zerlegen (/ ? # \\ Leerraum) oder mit '..' – "
                    f"sie fehlen im Bestand. Prüfen, ob innn.it die Form "
                    f"geändert hat (siehe SLUG_VERBOTEN_RE).",
                    thema_en="innn.it: slugs rejected",
                    text_en=f"{verworfen} petition(s) have a slug containing "
                            f"characters that break a URL – they are missing "
                            f"from the store.")
    # Dieses API IST die Entdeckung – innn.it hat keinen zweiten Weg, der einen
    # Ausfall auffangen (und damit verdecken) würde. Gefährlich ist weniger die
    # tote Schnittstelle als der stille Abbruch mittendrin: jedes `break` oben
    # beendet die Schleife ORDENTLICH, der Lauf meldet keinen Fehler und
    # übernimmt einfach weniger.
    #
    # ⚠️ Die Schwelle liegt bewusst NICHT auf 100 oder 200. Gemessen am
    # 8.8.2026: 2.054 Petitionen über 21 Seiten, API_LIMIT = 100 je Seite. Ein
    # Abbruch nach Seite 1 hinterlässt also exakt 100, nach Seite 2 exakt 200 –
    # und die Bedingung in entdeckung() ist `treffer < erwartet_min`. Mit 100
    # oder 200 als Schwelle wäre 100 < 100 bzw. 200 < 200 falsch, der Melder
    # bliebe bei genau dem Fall stumm, für den er da ist. 250 fängt den Abbruch
    # in den ersten beiden Seiten und liegt zugleich weit unter dem echten
    # Bestand. Gegenprobe fürs Protokoll ist der gemeldete Gesamtbestand oben.
    #
    # Bei --limit wird nicht gemeldet: dort bricht die Schleife absichtlich
    # früh ab (siehe oben), ein Befund wäre dann ein Fehlalarm aus einem
    # Testlauf.
    if not args.limit:
        core.entdeckung("Listen-API (/api/v2/posts/initiatives)", len(seen),
                        erwartet_min=250,
                        name_en="list API (/api/v2/posts/initiatives)")

    # Bekannte Einträge, die nicht mehr im API auftauchen → direkt prüfen.
    missing = [s for s in store if s not in seen]
    if missing and not args.no_recheck and not args.limit:
        log(f"Prüfe {len(missing)} nicht mehr gelistete Petition(en) …")
        prog(phase="check-known", current=0, total=len(missing),
             message="Prüfe fehlende Petitionen …")
        for k, slug in enumerate(missing, 1):
            prog(current=k, total=len(missing), message=slug)
            if core.skip_recent(store.get(slug), args):
                continue
            status, rec = scrape_petition(fetcher, slug)
            if status == "error":
                continue
            # Umbenennung erkennen (30.8.2026). innn.it vergibt beim Anlegen
            # einen aus dem TITEL gekürzten Slug (gemessen: 30 Zeichen, 529
            # von 1977 Sätzen liegen genau darauf) und stellt bei einer
            # Umbenennung eine 301 auf den neuen. An der Quelle nachgemessen:
            # /keine-rentenkurzungen-fur-pfle → 301 → /pflegende-angehoerige.
            #
            # Die Anfrage folgt der Weiterleitung still, und das Ergebnis
            # landete bisher unter dem ANGEFRAGTEN Slug — dieselbe Petition
            # also zweimal im Bestand. Sichtbar wurde es erst am Befund
            # „Mehrere Sätze auf derselben Adresse" (3 Adressen am 30.8.),
            # denn record_from_signable() trägt die KANONISCHE URL ein: beide
            # Sätze zeigen am Ende auf dieselbe Adresse und teilen sich im
            # Export einen Volltext-Eintrag — einer der Texte geht verloren.
            #
            # Der kanonische Slug steckt schon in rec["url"] (aus sig["name"]),
            # es braucht also KEINEN zweiten Abruf. Gleiches Vorgehen wie in
            # weact_scraper.store_result().
            ziel = slug
            if status == "online" and rec:
                kanon = str(rec.get("url") or "").rsplit("/", 1)[-1]
                if kanon and kanon != slug and slug_ok(kanon):
                    ziel = kanon
                    if core.merge_records(store, slug, ziel):
                        log(f"  UMBENANNT: {slug} → {ziel} (Weiterleitung) – "
                            f"Datensätze zusammengeführt.")
            core.upsert(store, ziel, rec or {}, {}, status, ts,
                        f"{BASE_URL}/{ziel}")
            save()
            if status == "offline":
                log(f"  OFFLINE: {slug}")

    # Einmal je Lauf, VOR dem Abschluss-Save — sonst fehlte der Befund im _meta
    # und damit im Dashboard.
    core.felder_melden(BEKANNTE_FELDER)

    new_petitions = [s for s, r in store.items() if r.get("first_seen") == ts]
    if new_petitions:
        log(f"NEU: {len(new_petitions)} neue Petition(en) in diesem Lauf.")

    prog(message="Speichere & baue HTML …")
    save(quiet=False, new_petitions_last_run=new_petitions,
         available=(total_count if total_count is not None else len(seen)))
    core.write_list_html(PLATFORM)
    log("Fertig (Innn.it).")


def check(fetcher):
    url = f"{BASE_URL}/api/v2/posts/initiatives?limit=1&offset=0&type=petition&sort=createdAt"
    resp = fetcher.get(url)
    if resp is None or not resp.ok:
        return False, "API nicht erreichbar"
    try:
        total = (json.loads(resp.text).get("meta") or {}).get("totalCount")
    except ValueError:
        return False, "API liefert kein JSON"
    return (bool(total) and total > 50), f"API totalCount={total}"

PLATFORM = Platform(
    key="innnit",
    name="Innn.it",
    eyebrow="Innn.it · alle Petitionen (via internem Listen-API)",
    source_url="https://innn.it/",
    data_file=DATA_FILE,
    html_file=HTML_FILE,
    run=run,
    check=check,
    openness=3,
    openness_wunsch="Die vollständige Liste gibt es nur über ein internes API, das "
                    "erst durch Nachbauen der Seite gefunden wurde; eine Sitemap "
                    "fehlt, die Suche ist eine Weiterleitung zu Google. Das API "
                    "liefert dafür vollständige Sätze samt Volltext — es öffentlich zu "
                    "dokumentieren wäre der ganze Schritt.",
    openness_note="Mittel: vollständige Liste existiert, aber nur über ein "
                  "verstecktes internes API (per Reverse-Engineering gefunden); "
                  "keine Sitemap, Suche nur als Google-Weiterleitung. Dafür "
                  "liefert das API komplette Datensätze inkl. Volltext.",
)


if __name__ == "__main__":
    import monitor
    monitor.main()
