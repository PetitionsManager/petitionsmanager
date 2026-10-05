#!/bin/bash
# Täglicher lokaler Pflege-Lauf: scrapt die Plattformen, die nur ein
# gewöhnlicher Anschluss erreicht (WAF sperrt Rechenzentren — siehe
# LOKALE_PFLEGE in petitions_core.py), und pusht die Stores. Die CI
# übernimmt sie automatisch, wenn sie jünger sind (ci_stores_uebernehmen.py).
#
# Gestartet vom systemd-User-Timer petitionsmanager-pflege.timer
# (werkzeuge/systemd/). Läuft im DEDIZIERTEN Klon PetitionsManager-cron,
# nie im geteilten Arbeitsbaum der Claude-Sitzungen.
#
# Fehlerphilosophie: jeder Fehler beendet nur den HEUTIGEN Durchlauf;
# morgen beginnt alles frisch. Nie erzwingen. Bei einem echten Konflikt
# bleibt eine Markerdatei liegen und der Timer setzt aus, bis jemand
# nachgesehen hat — die Dashboard-Kachel warnt nach 4 Tagen von allein.
#
# PFLEGE_NUR_PRUEFEN=1  → Leitungs-Test: alles außer dem Scrapen.
set -u
KLON="$(cd "$(dirname "$0")" && pwd)"
LOG="$KLON/pflege-lauf.log"
MARKER="$KLON/PFLEGE-LAUF-KLEMMT.txt"
# Nur die LOKALE_PFLEGE-Zweige — wemove_es und alles andere erledigt die CI
# selbst; jeder zusätzliche Zweig hier kostet WeMove-WAF-Fensterbudget.
#
# ⚠️⚠️ openpetition dazu am 4.10.2026, und zwar nicht wegen eines WAF: die CI
# kommt dort netzwerkseitig GAR NICHT hin. Anmerkung aus Lauf #117: „Host
# ausgelassen (robots.txt nicht lesbar): www.openpetition.de … Failed to
# establish a new connection". Folge im ausgelieferten Manifest: bilanz
# gefunden 0 / offen 0 bei 2.380 Sätzen im Bestand — es konnte dort keine neue
# Petition mehr entdeckt werden, und der Bestand sah dabei gesund aus.
# Von diesem Anschluss antwortet dieselbe Liste mit HTTP 200 und 18 Slugs auf
# Seite 1 (4.10.2026 gemessen). Kosten hier: ~93 Listenseiten × 1,5 s ≈ 2,5 min
# plus die Nachprüfung (2.380 Sätze / 72 h ≈ 800 Abrufe am Tag, verteilt auf
# ~6 Läufe). ⚠️ REIHENFOLGE bei der Einführung: erst muss der CI-Stand per
# „Run workflow" mit stores_ins_repo=openpetition ins Repo kommen, sonst
# schreibt dieser Lauf den älteren lokalen Stand darüber (die Schrumpf-Sperre
# in ci_stores_uebernehmen.entscheide() fängt es ab, aber dann steht der
# Bestand still, statt zu wachsen).
PLATTFORMEN=(europarl openpetition wemove_en wemove_fr wemove_it wemove_nl wemove_pl)

sag() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

# --- Laufzeiten ------------------------------------------------------------
# Wanduhr und AKTIVE Zeit getrennt festhalten, weil der Rechner mitten im Lauf
# schläft: am 15./16.9.2026 lagen 12,53 h zwischen "Starting" und "Finished"
# im Journal, davon 12,46 h ohne eine einzige Logzeile. systemd rechnet
# TimeoutStartSec in CLOCK_MONOTONIC, und die steht im Suspend still — deshalb
# hat die 5-h-Grenze bei 14,7 h nicht gegriffen, und deshalb ist
# Ende-minus-Start aus dem Journal KEINE Laufzeit. CLOCK_BOOTTIME zählt den
# Schlaf mit, CLOCK_MONOTONIC nicht; die Differenz ist die Schlafzeit
# (nachgemessen 17.9.2026: 7,76 h seit Boot, davon 4,77 h wach).
ZEITEN="$KLON/laufzeiten.tsv"
uhren() { python3 -c 'import time; print(f"{time.time():.0f} {time.monotonic():.1f}")'; }

# zeitzeile <was> <start-wanduhr> <start-monoton> <exitcode>
zeitzeile() {
    [ -s "$ZEITEN" ] || printf 'was\tstart\tende\twanduhr_s\taktiv_s\tschlaf_s\tcode\n' >>"$ZEITEN"
    python3 - "$@" >>"$ZEITEN" 2>/dev/null <<'PY'
import sys, time, datetime
was, w0, m0, code = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
w1, m1 = time.time(), time.monotonic()
wand, aktiv = w1 - w0, m1 - m0
iso = lambda t: datetime.datetime.fromtimestamp(t).strftime('%F %T')
print(f"{was}\t{iso(w0)}\t{iso(w1)}\t{wand:.0f}\t{aktiv:.0f}\t{max(0.0, wand - aktiv):.0f}\t{code}")
PY
}

read -r T0_WALL T0_MONO < <(uhren)
# EXIT deckt auch die frühen Abbrüche ab (exit 1 bei git-Fehlern).
# Die drei Signal-Traps sind NICHT dafür da, dass überhaupt eine Zeile entsteht
# — bash führt den EXIT-Trap bei SIGTERM ohnehin aus (am 17.9.2026 auf dem
# Prüfstand gegengemessen). Sie sorgen für den RICHTIGEN Exitcode: ohne sie
# wird ein getöteter Lauf als code 0 verbucht und sähe im Log aus wie ein
# geglückter. Genau so endete der Lauf vom 16.9. ("Failed with result 'signal'",
# der Rechner bootete eine Sekunde später neu).
# Nebenwirkung, bewusst in Kauf genommen: mit TERM-Trap wartet bash das laufende
# Vordergrundkind ab, die letzte Zeitzeile kann dadurch etwas zu lang ausfallen.
# Beim systemd-Stopp trifft das Signal die ganze cgroup, monitor.py endet also
# gleichzeitig.
trap 'ENDE=$?; zeitzeile lauf "$T0_WALL" "$T0_MONO" "$ENDE"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# --- Rumpf ----------------------------------------------------------------
# ⚠️⚠️ Der ganze Ablauf liegt bewusst in EINER Funktion, weil dieses Skript
# sich beim `git pull` unten SELBST austauschen kann. Bash liest ein Skript
# häppchenweise und merkt sich einen BYTE-VERSATZ; wird die Datei während des
# Laufs länger, zeigt der alte Versatz mitten in eine Zeile der neuen Fassung.
# Am Prüfstand (17.9.2026) reproduziert: ein Kommentarfragment wurde als Befehl
# ausgeführt („------ command not found"), danach lief die NEUE Fassung komplett
# durch — Traps übersprungen, Scrape-Schleife samt Commit und Push ein zweites
# Mal. Einen Funktionsrumpf liest Bash dagegen VOLLSTÄNDIG ein, bevor er ihn
# ausführt; ab hier ist jede Skriptänderung per Pull unkritisch.
# ⚠️ Am Ende der Datei steht `main "$@"; exit $?` — das `exit` MUSS auf DERSELBEN
# Zeile stehen. Steht es auf einer eigenen, kehrt Bash nach main() zum alten
# Byte-Versatz zurück und der Fehler ist zurück (ebenfalls nachgemessen).
main() {
    cd "$KLON" || exit 1
    if [ -e "$MARKER" ]; then
        sag "Markerdatei vorhanden ($MARKER) – Lauf ausgesetzt, bitte den dort beschriebenen Konflikt ansehen."
        exit 1
    fi
    # Log deckeln (2 MB), eine Vorgänger-Fassung behalten.
    if [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 2000000 ]; then
        mv -f "$LOG" "$LOG.alt"
    fi

    sag "=== Pflege-Lauf beginnt (${PFLEGE_NUR_PRUEFEN:+LEITUNGS-TEST}) ==="
    # ⚠️ Mehrere Anläufe statt sofortigem Abbruch: die Persistent=true-Nachhol-
    # läufe starten 1–2 s nach dem AUFWACHEN aus dem Suspend (NICHT beim Booten),
    # und da verbindet sich das WLAN gerade erst neu. Gemessen an allen vier
    # Fehlläufen (10./12./14./15.9.2026): Abbruch mit „ssh: Could not resolve
    # hostname github.com: Temporary failure in name resolution", das Netz stand
    # jeweils 5–6 s später. 6 Anläufe × 30 s decken das mit Reserve ab.
    # ⚠️⚠️ network-online.target hilft dagegen NICHT: im User-Manager gibt es die
    # Unit gar nicht, und im System-Manager wird sie nur EINMAL beim Booten
    # erreicht und bleibt über jeden Suspend hinweg aktiv.
    PULL_ANLAUF=1
    until git pull --ff-only >>"$LOG" 2>&1; do
        if [ "$PULL_ANLAUF" -ge 6 ]; then
            sag "git pull --ff-only scheiterte auch im 6. Anlauf – Abbruch, morgen neuer Versuch."
            exit 1
        fi
        sag "git pull --ff-only scheiterte (Anlauf $PULL_ANLAUF) – 30 s warten, dann neuer Anlauf."
        PULL_ANLAUF=$((PULL_ANLAUF + 1))
        sleep 30
    done

    if [ "${PFLEGE_NUR_PRUEFEN:-0}" != "1" ]; then
        for k in "${PLATTFORMEN[@]}"; do
            sag "Scrape $k …"
            read -r ZW_WALL ZW_MONO < <(uhren)
            # Ein Fehlschlag (z. B. WAF-Fenster zu) beendet nur diesen Zweig;
            # „5 Fehlschläge in Folge" im Scraper speichert vorher Erreichtes.
            if python3 monitor.py --platform "$k" >>"$LOG" 2>&1; then
                ZCODE=0
            else
                ZCODE=$?
                sag "$k: Lauf endete mit Fehler – weiter mit dem nächsten Zweig."
            fi
            # Je Zweig eine eigene Zeile: europarl trägt den Löwenanteil, und nur
            # so ist später zu sehen, WELCHER Zweig den Lauf lang macht.
            zeitzeile "zweig:$k" "$ZW_WALL" "$ZW_MONO" "$ZCODE"
        done
    else
        sag "PFLEGE_NUR_PRUEFEN=1 – Scrapen übersprungen."
    fi

    # ---- Change.org aufholen: EIN Durchgang je Lauf ----------------------
    # Nutzerauftrag 20.9.2026 („automatisch immer laufen lassen"). Change.org
    # ist NICHT WAF-gesperrt wie die Zweige oben — es steht hier, weil die CI
    # zu wenig Zeit hat: sie bricht ihre Aufholschleife bei FRIST+15 min ab,
    # übrig blieben ~18 Sätze am Tag bei 12.200 offenen Kandidaten. Dieser
    # Rechner hat keine Frist.
    #
    # ⚠️ Genau EIN Durchgang (~22 min), nicht „bis fertig": der Pflege-Lauf
    # würde sonst länger als sein eigener Takt. Der Vorrat wird über viele
    # Läufe abgearbeitet, nicht in einem.
    # ⚠️ Ein Fehlschlag darf den Lauf NICHT beenden — die Stores der Zweige
    # oben sind dann schon geschrieben und müssen noch committet werden.
    # changeorg_aufholen.py hört von sich aus auf: bei HTTP 403/429, bei zu
    # hoher Fehlerquote, bei fehlendem Fortschritt und wenn der lokale Stand
    # hinter dem veröffentlichten zurückliegt.
    # ⚠️ Seit 5.10.2026 ist der Schritt meist ein NULLSCHRITT (Sekunden statt
    # 22 min): `offen` steht auf 1, und unter AUFHOL_SCHWELLE verzichtet das
    # Skript. Der Rückstand von ~13.500, für den es am 19.9. gebaut wurde, ist
    # abgearbeitet. Stehen lassen — es greift wieder, wenn die Entdeckung
    # einmal einen großen Schwung findet.
    # ⚠️ Abschalten ohne Codeänderung: PFLEGE_OHNE_CHANGEORG=1.
    if [ "${PFLEGE_NUR_PRUEFEN:-0}" != "1" ] \
       && [ "${PFLEGE_OHNE_CHANGEORG:-0}" != "1" ]; then
        sag "Change.org aufholen (ein Durchgang) …"
        read -r ZW_WALL ZW_MONO < <(uhren)
        if python3 changeorg_aufholen.py --durchgaenge 1 >>"$LOG" 2>&1; then
            ZCODE=0
        else
            ZCODE=$?
            sag "Change.org-Aufholen endete mit Code $ZCODE – weiter, die Stores werden trotzdem gesichert."
        fi
        zeitzeile "aufholen:changeorg" "$ZW_WALL" "$ZW_MONO" "$ZCODE"
    fi

    # ---- Sprach-Sweep: der blinde Fleck der Sitemaps ----------------------
    # Nutzerentscheidung 4.10.2026 („alles aufnehmen"). Die deutsche Entdeckung
    # sieht nur, was GERMAN_SLUG_RE passiert; alles andere wurde nie angesehen.
    #
    # ⚠️⚠️ ZAHL BERICHTIGT 5.10.2026. Hier stand „~56.000 Petitionen", aus EINER
    # Sitemap hochgerechnet. Der erste echte Lauf zählte **453.168 Slugs in 51
    # Sitemaps** — Faktor 8. Der Fehler lag in der Stichprobe: gemessen war die
    # Datei des LAUFENDEN Monats, und die ist erst angefangen. Bei datierten
    # Dateien ist die jüngste nie typisch.
    #
    # ⚠️⚠️ Das gehört HIERHER und nicht in die CI: 453.000 Abrufe sind rund
    # 190 h reine Abrufzeit. Dieser Rechner hat keine Frist, die CI hat 300 min.
    # Bei 1.500 je Lauf (~58 min gemessen) und sechs Läufen am Tag sind das
    # ~9.000/Tag — eine volle Umdrehung dauert damit rund **50 Tage**, nicht
    # sechs. Gemessene Ausbeute je Fenster: ~0,8 % deutsch, ~61 % englisch.
    # ⚠️ Abschalten ohne Codeänderung: PFLEGE_OHNE_SWEEP=1.
    if [ "${PFLEGE_NUR_PRUEFEN:-0}" != "1" ] \
       && [ "${PFLEGE_OHNE_SWEEP:-0}" != "1" ]; then
        sag "Sprach-Sweep über die Sitemap-Kandidaten (ein Fenster) …"
        read -r ZW_WALL ZW_MONO < <(uhren)
        if python3 monitor.py --platform changeorg --sprachsweep 1500 >>"$LOG" 2>&1; then
            ZCODE=0
        else
            ZCODE=$?
            sag "Sprach-Sweep endete mit Code $ZCODE – weiter, die Stores werden trotzdem gesichert."
        fi
        zeitzeile "sweep:changeorg" "$ZW_WALL" "$ZW_MONO" "$ZCODE"
    fi

    # ---- Archiv auffrischen ----------------------------------------------
    # Spiegelt JEDE Plattform schlank nach archiv/<key>_<jahr>-<monat>.json
    # (402 B statt 4.644 B je Satz). Kein Netzzugriff, läuft in Sekunden —
    # und hält die Monatsdateien auf dem Stand der Bestände, während der
    # Sweep seine Funde unabhängig davon direkt dorthin schreibt.
    if [ "${PFLEGE_NUR_PRUEFEN:-0}" != "1" ]; then
        if ! python3 monitor.py --archiv-spiegeln >>"$LOG" 2>&1; then
            sag "Archiv-Spiegelung endete mit Fehler – weiter."
        fi
    fi

    # ⚠️ `archiv/` gehört MIT in den Commit: es ist die Dauerablage, aus der
    # später entschieden wird, was in die App kommt. Ohne diese Zeile bliebe
    # sie auf diesem Rechner liegen und wäre beim nächsten frischen Klon weg.
    GEAENDERT="$(git status --porcelain -- '*_petitions.json' texts_index.json archiv)"

    # ---- Den großen Store höchstens EINMAL AM TAG committen ---------------
    # Gemessen 4.10.2026: 145 Commits auf changeorg_petitions.json (55 MB)
    # seit dem 20.9., rund 2,3 MB Zuwachs je Commit — das Repo liegt auf
    # GitHub bei 341 MB. Gebraucht wird davon EIN Stand pro Tag: mehr holt
    # sich ci_stores_uebernehmen.py nicht ab, es übernimmt je CI-Lauf immer
    # nur den aktuellen HEAD-Stand. Jeder weitere Commit am selben Tag kostet
    # also nur Repo-Größe.
    #
    # ⚠️ Entschieden wird das aus git selbst, nicht über eine Merkdatei: eine
    # zusätzliche Datei im Klon wäre ein zweiter Zustand, der mit dem Repo
    # auseinanderlaufen kann (und ein .gitignore-Eintrag dazu). `git log
    # --since=<heute 00:00>` liest die Wahrheit direkt aus der Historie —
    # leere Ausgabe heißt „heute noch nicht committet". Nach einem `git pull`
    # zählt auch ein Commit aus der CI mit; das ist gewollt, denn dann liegt
    # für heute schon ein Stand vor.
    # ⚠️ Die KLEINEN Stores bleiben bei „je Lauf": sie wachsen um Kilobytes,
    # und ihr Zweck ist die zeitnahe Übernahme (europarl, wemove_*).
    CHANGEORG_ZURUECK=""
    if printf '%s\n' "$GEAENDERT" | grep -q 'changeorg_petitions\.json' \
       && [ -n "$(git log --since="$(date '+%F') 00:00" --oneline -- changeorg_petitions.json)" ]; then
        CHANGEORG_ZURUECK="ja"
        GEAENDERT="$(printf '%s\n' "$GEAENDERT" | grep -v 'changeorg_petitions\.json' || true)"
        sag "changeorg_petitions.json wurde heute schon committet – diesen Lauf nicht erneut stagen (die Änderungen bleiben im Arbeitsbaum und gehen morgen mit)."
    fi

    if [ -z "$GEAENDERT" ]; then
        # ⚠️ Beide Wege müssen hier landen, sonst würde unten ein leeres
        # `git add` auf einen leeren Commit laufen: entweder hat sich nichts
        # geändert, oder die EINZIGE Änderung war der zurückgehaltene große
        # Store. Die Meldungen bleiben getrennt — „keine Änderungen" und
        # „absichtlich nichts gestaget" sind im Log zwei verschiedene Befunde.
        if [ -n "$CHANGEORG_ZURUECK" ]; then
            sag "Nur changeorg_petitions.json geändert und heute schon committet – nichts zu pushen, fertig."
        else
            sag "Keine Store-Änderungen – fertig."
        fi
        exit 0
    fi
    # Nur genau die Store-Dateien stagen — nie pauschal (geteilte Repo-Disziplin).
    echo "$GEAENDERT" | awk '{print $NF}' | xargs -r git add --
    if ! git commit -m "Stores: lokaler Pflege-Lauf $(date '+%F')" >>"$LOG" 2>&1; then
        sag "Commit scheiterte – Abbruch."
        exit 1
    fi
    if ! git push >>"$LOG" 2>&1; then
        sag "Push abgewiesen – ein Rebase-Versuch."
        if git pull --rebase --autostash >>"$LOG" 2>&1 && git push >>"$LOG" 2>&1; then
            sag "Push nach Rebase gelungen."
        else
            git rebase --abort >>"$LOG" 2>&1 || true
            {
                echo "Der Pflege-Lauf vom $(date '+%F %T') konnte nicht pushen"
                echo "(Konflikt oder Zugriffsproblem). Nichts wurde erzwungen."
                echo "Bitte in $KLON nachsehen: git status / git log origin/main..HEAD"
                echo "Danach diese Datei löschen – der Timer läuft dann wieder."
            } > "$MARKER"
            sag "KONFLIKT – Markerdatei geschrieben, Timer setzt bis zur Klärung aus."
            exit 1
        fi
    fi
    sag "=== Pflege-Lauf fertig: Stores gepusht; die CI übernimmt sie beim nächsten Lauf. ==="
}

# ⚠️ `exit` MUSS hier hinter main() auf derselben Zeile stehen — siehe oben.
main "$@"; exit $?
