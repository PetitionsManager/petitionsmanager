# PetitionsManager – Android-APK

Dieses Verzeichnis (`android/`) ist ein **build-fertiges** Android-Projekt. Es
verpackt die Web-App aus `../webapp/` – **inklusive der JSON-Daten in
`../webapp/data/`** – in eine native APK. Die App funktioniert damit **komplett
offline**.

## Wie die Daten integriert sind

`app/build.gradle` bindet den gesamten Web-App-Ordner als Assets ein:

```gradle
sourceSets { main { assets.srcDirs += ['../../webapp'] } }
```

Es gibt also **keine Kopie** – die einzige Quelle ist `webapp/`. Ein
`WebViewAssetLoader` liefert die Assets unter einer virtuellen https-Herkunft
aus, damit das `fetch()` der App die gebündelten JSONs offline laden kann.

**`webapp/data` liegt seit dem 7.8.2026 nicht mehr im Repo** (`.gitignore`) – der
Ordner ist erzeugte Ausgabe, keine Quelle. Nach einem frischen Klon ist er leer,
und ohne Daten wäre die APK leer. Es gibt genau zwei Wege, ihn zu füllen:

```bash
python3 hole_live_daten.py   # den veröffentlichten Stand von GitHub Pages holen
python3 publish.py           # oder aus einem eigenen lokalen Scrape erzeugen
```

Der Cloud-Build ruft `hole_live_daten.py` selbst auf (siehe Variante A) – lokal
muss man es einmal von Hand tun.

> Aktuelle Datenmenge: ~60 MB JSON → die APK wird entsprechend groß
> (im APK werden die Dateien komprimiert, real also deutlich kleiner).

---

## Variante A – Bauen in der Cloud (ohne lokale Installation, empfohlen)

Es ist **keine** lokale Android-Toolchain nötig.

1. Dieses Projekt in ein **GitHub-Repository** pushen (die Datei
   `.github/workflows/build-apk.yml` liegt bereits im Projekt-Stamm).
2. Auf GitHub: **Actions → „Build APK" → „Run workflow"**.
3. Nach ~3–5 Min unter dem Lauf das Artefakt
   **`PetitionsManager-debug-apk-Daten-JJJJ-MM-TT`** herunterladen → enthält
   `app-debug.apk`. Der Datenstand steht im Namen.
4. APK auf dem Handy installieren (Installation aus „unbekannten Quellen"
   erlauben).

**Die Daten holt der Bau selbst.** Vor dem Gradle-Lauf lädt `hole_live_daten.py`
den veröffentlichten Stand von GitHub Pages nach `webapp/data` und prüft ihn
(Anzahl je Plattform gegen das Manifest, jeder Volltext-Verweis auf ein
vorhandenes Paket, Stichprobe auf den Text selbst). Stimmt etwas nicht oder ist
Pages nicht erreichbar, **bricht der Bau ab** – eine APK mit altem Datenstand
sähe fertig aus und wäre es nicht.

**Signatur.** Der Workflow erwartet zwei Repository-Secrets:
`SIGNING_KEYSTORE_BASE64` (PKCS12-Keystore, base64 in einer Zeile) und
`SIGNING_KEYSTORE_PASSWORD`. Er schreibt den Schlüssel zur Bauzeit nach
`app/signing.p12` und entfernt ihn danach wieder. Fehlen die Secrets (z. B. in
einem Fork), läuft der Bau weiter, warnt aber: die APK ist dann mit Gradles
Wegwerf-Debugschlüssel signiert und lässt sich **nicht** über eine vorhandene
Installation legen. Anleitung zum Erzeugen eines eigenen Keystores mit
`openssl`: [`../README.md`](../README.md) → „Signaturschlüssel einrichten".

`versionCode` und `versionName` setzt der Workflow aus `github.run_number`
(`1.0.<Lauf>`); ohne diese Umgebungsvariablen bleibt es beim lokalen Bau bei
`1` bzw. `1.0`.

> Der Workflow liegt bei GitHub Actions im Repository-Stamm. Falls der
> Repo-Stamm **oberhalb** von „PetitionsManager" liegt, den Ordner
> `.github/` dorthin verschieben und im Workflow die `working-directory`- und
> `path`-Pfade um das Unterverzeichnis ergänzen.

---

## Variante B – Lokal bauen (Android Studio / Kommandozeile)

Voraussetzungen: **JDK 17** und das **Android-SDK** (z. B. via Android Studio).

⚠️ **Zuerst die Daten holen**, sonst entsteht eine leere App – `webapp/data`
liegt nicht im Repo:

```bash
python3 hole_live_daten.py     # im Projekt-Stamm, nicht in android/
```

**Android Studio:** Ordner `android/` öffnen → Gradle-Sync → *Build → Build
Bundle(s)/APK(s) → Build APK(s)*.

**Kommandozeile** (Gradle ≥ 8.7 installiert, `local.properties` mit
`sdk.dir=/pfad/zum/Android/Sdk`):

```bash
cd android
gradle assembleDebug          # Ergebnis: app/build/outputs/apk/debug/app-debug.apk
```

> Es ist bewusst **kein** Gradle-Wrapper (`gradlew`) enthalten, weil dessen
> Binärdatei nicht ohne installiertes Gradle erzeugt werden kann. Einmalig
> `gradle wrapper` ausführen, um den Wrapper zu ergänzen (optional).

---

## Release / Play Store

`assembleDebug` erzeugt eine APK für den Debug-Buildtyp (ideal zum
Testen/Sideloaden). **Sie ist nicht mehr mit einem Wegwerfschlüssel signiert:**
`app/build.gradle` hat eine `signingConfig` für `debug`, die `app/signing.p12`
mit dem Alias `petitionsmanager` verwendet, sobald die Datei da ist und
`SIGNING_KEYSTORE_PASSWORD` gesetzt ist. Nur so lässt sich eine neue Fassung
über eine vorhandene Installation legen. Fehlt beides (lokaler Testbau), bleibt
`signingConfig` leer und Gradle nimmt seinen eigenen Debug-Schlüssel.

Für eine Veröffentlichung fehlt noch ein **Release**-Buildtyp mit eigener
`signingConfig`; `bundleRelease` erzeugt das für Google Play nötige AAB. Die
offenen Punkte zu Play und F-Droid stehen in [`../README.md`](../README.md)
→ „Geplant: Google Play und F-Droid".

---

## Apple / iOS – einfache Konvertierung

Die Web-App ist bewusst so gebaut, dass sie auf Apple-Geräten **ohne Mac**
nutzbar ist – über drei Wege, vom einfachsten zum aufwändigsten:

### 1. PWA „Zum Home-Bildschirm" (einfachster Weg, kein Build)

Die App ist eine vollwertige **PWA** (`webapp/manifest.webmanifest`,
`webapp/sw.js`, Apple-Meta-Tags + `apple-touch-icon`). Sobald `webapp/` auf
einem **https-Host** liegt (z. B. GitHub Pages):

1. Auf dem iPhone/iPad in **Safari** die Seite öffnen.
2. **Teilen → „Zum Home-Bildschirm"**.

→ Eigenes Icon, Vollbild ohne Browserleiste, und **offline-fähig** (der Service
Worker cacht App-Hülle und bereits geöffnete Daten). Das ist die „einfache
Konvertierung für Apple-Geräte".

### 2. Native App fürs iPhone (App Store)

Braucht einen **Mac mit Xcode** (oder einen Cloud-Mac-CI-Dienst) und einen
Apple-Developer-Account. Zwei Varianten:

- **Capacitor** (empfohlen, plattformübergreifend): erzeugt aus demselben
  `webapp/` sowohl Android- als auch iOS-Projekte, inkl. gebündelter Assets.
  ```bash
  npm i -g @capacitor/cli
  npx cap init PetitionsManager app.petitionsmanager --web-dir=webapp
  npx cap add ios          # bzw. android
  npx cap copy
  npx cap open ios         # Xcode öffnet sich → Build/Archive
  ```
- **WKWebView-Wrapper** (analog zur Android-`MainActivity`): ein kleines
  Xcode-Projekt mit `WKWebView`, das `webapp/` gebündelt lädt und über einen
  `WKURLSchemeHandler` ausliefert (damit `fetch()` offline funktioniert).

> Da die Web-App komplett Standard-HTML/CSS/JS ist, laufen beide Wege ohne
> Änderungen am App-Code.

---

## Eckdaten

| | |
|---|---|
| Package / applicationId | `app.petitionsmanager` |
| minSdk / targetSdk / compileSdk | 24 / 34 / 34 |
| AGP / Gradle / JDK | 8.5.2 / ≥ 8.7 (CI: 8.9) / 17 |
| Kern | `WebView` + `androidx.webkit:WebViewAssetLoader` |
| Signatur | PKCS12 `app/signing.p12`, Alias `petitionsmanager` (aus GitHub-Secret) |
| Fassung | `versionCode` = Nummer des Bau-Laufs, `versionName` = `1.0.<Lauf>` |
