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

## Wenn etwas klemmt

Liegt `/home/timeras/Claude/PetitionsManager-cron/PFLEGE-LAUF-KLEMMT.txt`,
hat ein Push-Konflikt den Lauf gestoppt (nichts wurde erzwungen). Inhalt
lesen, Konflikt im Klon klären, Datei löschen — der Timer läuft dann wieder.
Unabhängig davon warnt die Dashboard-Kachel automatisch, wenn länger als
4 Tage kein abgeschlossener Lauf gepusht wurde.
