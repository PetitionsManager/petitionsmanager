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
PLATTFORMEN=(europarl wemove_en wemove_fr wemove_it wemove_nl wemove_pl)

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
if ! git pull --ff-only >>"$LOG" 2>&1; then
    sag "git pull --ff-only scheiterte – Abbruch, morgen neuer Versuch."
    exit 1
fi

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

GEAENDERT="$(git status --porcelain -- '*_petitions.json' texts_index.json)"
if [ -z "$GEAENDERT" ]; then
    sag "Keine Store-Änderungen – fertig."
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
