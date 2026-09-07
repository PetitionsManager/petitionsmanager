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
        # Ein Fehlschlag (z. B. WAF-Fenster zu) beendet nur diesen Zweig;
        # „5 Fehlschläge in Folge" im Scraper speichert vorher Erreichtes.
        python3 monitor.py --platform "$k" >>"$LOG" 2>&1 \
            || sag "$k: Lauf endete mit Fehler – weiter mit dem nächsten Zweig."
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
