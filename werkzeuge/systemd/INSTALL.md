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

**Ursache:** `Persistent=true` holt den verpassten Lauf nach, sobald der
Rechner wieder läuft — und das ist hier das **Aufwachen aus dem Suspend**, nicht
das Booten. Alle vier Läufe starteten 1–2 s nach
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

Nach dem nächsten verpassten Lauf (Rechner über 20:15 hinweg aus oder im
Suspend) im Log nachsehen:

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
