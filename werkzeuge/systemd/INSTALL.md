# PC-Timer für den lokalen Pflege-Lauf installieren

Voraussetzung: der dedizierte Klon `/home/timeras/Claude/PetitionsManager-cron`
existiert (legt die Einrichtungs-Sitzung an) und der Sammel-Commit mit
`lokaler_pflege_lauf.sh` ist gepusht.

```
cp /home/timeras/Claude/PetitionsManager-cron/werkzeuge/systemd/petitionsmanager-pflege.service \
   /home/timeras/Claude/PetitionsManager-cron/werkzeuge/systemd/petitionsmanager-pflege.timer \
   ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now petitionsmanager-pflege.timer
```

Optional, damit der Timer auch ohne offene Anmeldesitzung läuft
(nur Rechner-an nötig):

```
loginctl enable-linger timeras
```

## Kontrolle

```
systemctl --user list-timers | grep petitionsmanager   # nächster Lauf geplant?
tail -20 /home/timeras/Claude/PetitionsManager-cron/pflege-lauf.log
```

Probelauf von Hand (ohne auf den Timer zu warten):

```
systemctl --user start petitionsmanager-pflege.service
```

## Nachholläufe nach dem Aufwachen (gelöst 17.9.2026)

Vier Nachholläufe (10.9. 05:51, 12.9. 09:02, 14.9. 06:28, 15.9. 08:04) endeten
binnen einer Sekunde mit Fehler. Im `pflege-lauf.log` stand jedes Mal:

```
ssh: Could not resolve hostname github.com: Temporary failure in name resolution
fatal: Could not read from remote repository.
```

**Ursache:** `Persistent=true` holte den verpassten Lauf nach, sobald der
Rechner wieder lief — und das ist hier das **Aufwachen aus dem Suspend**, nicht
das Booten.

> ℹ️ Seit dem 17.9.2026 gibt es `Persistent=` und `OnCalendar=` hier nicht mehr
> (siehe „Laufender Betrieb" unten). Der beschriebene Fehler kann deshalb so
> nicht mehr auftreten — die Pull-Wiederholung im Skript bleibt trotzdem, weil
> auch ein `OnBootSec`-Start vor dem Netz liegen kann. Alle vier Läufe starteten 1–2 s nach
`System returned from sleep operation 'suspend'` und lagen mitten in einem
laufenden Boot. Das WLAN verbindet sich zu dem Zeitpunkt erst neu; es stand
jeweils 5–6 s später.

**Behoben im Skript**, nicht in der Unit: `lokaler_pflege_lauf.sh` versucht den
`git pull --ff-only` bis zu **6-mal mit je 30 s Pause**, bevor es aufgibt.

⚠️⚠️ `Wants=`/`After=network-online.target` wäre hier **wirkungslos** und ist
absichtlich nicht eingebaut:

```
systemctl --user list-units --all 'network-online.target'   # 0 units — gibt es im User-Manager nicht
systemctl show network-online.target -p ActiveEnterTimestamp # nur EINMAL beim Booten erreicht
```

Das Target bleibt über jeden Suspend hinweg aktiv, würde einen Lauf nach dem
Aufwachen also nie aufhalten.

### Nachweis, dass die Reparatur greift

Nach dem nächsten Start, der vor dem Netz liegt (kurz nach dem Hochfahren), im
Log nachsehen:

```
grep -E "Anlauf|scheiterte" /home/timeras/Claude/PetitionsManager-cron/pflege-lauf.log | tail
```

- **heil:** `… scheiterte (Anlauf 1) – 30 s warten, dann neuer Anlauf.` und
  danach läuft der Lauf weiter (`Scrape europarl …`).
- **kaputt:** `… scheiterte – Abbruch, morgen neuer Versuch.` ohne jede
  Anlauf-Zeile — dann steht im Klon noch die alte Skriptfassung.

Gegenprobe ohne Warten auf den Ernstfall (trennt das Netz für einen Lauf):

```
systemctl --user list-timers | grep petitionsmanager   # Zustand vorher merken
```

Die Unterscheidung heil/kaputt hängt allein an den `Anlauf`-Zeilen: die alte
Fassung kann sie gar nicht schreiben.

## Wenn etwas klemmt

Liegt `/home/timeras/Claude/PetitionsManager-cron/PFLEGE-LAUF-KLEMMT.txt`,
hat ein Push-Konflikt den Lauf gestoppt (nichts wurde erzwungen). Inhalt
lesen, Konflikt im Klon klären, Datei löschen — der Timer läuft dann wieder.
Unabhängig davon warnt die Dashboard-Kachel automatisch, wenn länger als
4 Tage kein abgeschlossener Lauf gepusht wurde.

## Laufender Betrieb statt einmal täglich (17.9.2026)

Auf Wunsch des Nutzers läuft der Pflege-Lauf jetzt immer wieder, solange der
Rechner an ist:

```
OnBootSec=5min           # nach dem Hochfahren kurz warten
OnUnitInactiveSec=20min  # danach 20 min nach jedem ENDE wieder
RandomizedDelaySec=120
```

**`OnUnitInactiveSec`, nicht `OnUnitActiveSec`:** „active" zählt ab dem *Start*.
Bei rund 2 h Laufzeit feuerte der Timer damit mitten in den laufenden Lauf
hinein. „inactive" zählt ab dem *Ende* — der Abstand ist also wirklich eine
Pause.

**`Persistent=` ist entfallen.** Es wirkt nur zusammen mit `OnCalendar`. Ohne
feste Uhrzeit kann nichts verpasst werden: nach dem Aufwachen läuft es weiter.

**Überlappung ist ausgeschlossen**, ohne eigene Sperrdatei — systemd startet
dieselbe Unit nie zweimal gleichzeitig, und der Timer feuert ohnehin erst, wenn
sie inaktiv ist.

**Durchsatz:** Runde = ~2,1 h Lauf + 20 min Pause = 2,43 h. Also rund 3 Läufe
bei 8 h Wachzeit, 7 bei 16 h — statt bisher höchstens einem.

⚠️ **Die Repo-Historie wächst dadurch nicht entsprechend mit.** Zwei Bremsen
greifen von selbst: `skip_recent` prüft bekannte Sätze 24 h lang nicht erneut
(`DEFAULT_MIN_INTERVAL_HOURS` in `petitions_core.py`), ein zweiter Lauf am
selben Tag macht also fast nur noch Entdeckung — und findet er nichts, bricht
das Skript vor Commit und Push ab („Keine Store-Änderungen – fertig").

`IOSchedulingClass=idle` kommt dazu, damit ein Dauerscrape die Arbeit am
Rechner nicht ausbremst: `Nice` allein regelt nur die CPU, bei den großen
JSON-Beständen ist die Platte der engere Hals.

### Übernehmen

Beide Unit-Dateien aus `werkzeuge/systemd/` des Cron-Klons in den
User-Unit-Ordner kopieren (derselbe Weg wie bei der Erstinstallation ganz
oben), dann:

```
systemctl --user daemon-reload
systemctl --user restart petitionsmanager-pflege.timer
```

### Nachweis, dass die Umstellung greift

```
systemctl --user list-timers petitionsmanager-pflege.timer --all
```
- **heil:** `NEXT` liegt wenige Minuten bis 20 min in der Zukunft und wandert
  nach jedem Lauf weiter; `LEFT` ist klein.
- **nicht übernommen:** `NEXT` steht weiterhin auf der nächsten Abendzeit.

Die beiden Fälle sind eindeutig unterscheidbar — eine feste Uhrzeit kann bei
`OnUnitInactiveSec` gar nicht entstehen.
