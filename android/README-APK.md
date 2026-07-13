# PetitionsManager – Android-APK

Dieses Verzeichnis (`android/`) ist ein **build-fertiges** Android-Projekt. Es
verpackt die Web-App aus `../webapp/` – **inklusive der aktuellen JSON-Daten in
`../webapp/data/`** – in eine native APK. Die App funktioniert damit **komplett
offline**.

## Wie die Daten integriert sind

`app/build.gradle` bindet den gesamten Web-App-Ordner als Assets ein:

```gradle
sourceSets { main { assets.srcDirs += ['../../webapp'] } }
```

Es gibt also **keine Kopie** – die einzige Quelle ist `webapp/`. Vor jedem Build
die Daten aktualisieren:

```bash
python3 publish.py     # schreibt webapp/data/*.json neu
```

Die nächste APK enthält dann automatisch den frischen Stand. Ein
`WebViewAssetLoader` liefert die Assets unter einer virtuellen https-Herkunft
aus, damit das `fetch()` der App die gebündelten JSONs offline laden kann.

> Aktuelle Datenmenge: ~23 MB JSON → die APK wird entsprechend groß
> (im APK werden die Dateien komprimiert, real also deutlich kleiner).

---

## Variante A – Bauen in der Cloud (ohne lokale Installation, empfohlen)

Es ist **keine** lokale Android-Toolchain nötig.

1. Dieses Projekt in ein **GitHub-Repository** pushen (die Datei
   `.github/workflows/build-apk.yml` liegt bereits im Projekt-Stamm).
2. Auf GitHub: **Actions → „Build APK" → „Run workflow"**.
3. Nach ~3–5 Min unter dem Lauf das Artefakt
   **`PetitionsManager-debug-apk`** herunterladen → enthält `app-debug.apk`.
4. APK auf dem Handy installieren (Installation aus „unbekannten Quellen"
   erlauben).

> Der Workflow liegt bei GitHub Actions im Repository-Stamm. Falls der
> Repo-Stamm **oberhalb** von „PetitionsManager" liegt, den Ordner
> `.github/` dorthin verschieben und im Workflow die `working-directory`- und
> `path`-Pfade um das Unterverzeichnis ergänzen.

---

## Variante B – Lokal bauen (Android Studio / Kommandozeile)

Voraussetzungen: **JDK 17** und das **Android-SDK** (z. B. via Android Studio).

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

`assembleDebug` erzeugt eine **debug-signierte** APK (ideal zum Testen/Sideloaden).
Für eine Veröffentlichung einen eigenen Keystore anlegen, eine
`signingConfig` in `app/build.gradle` ergänzen und `assembleRelease` bzw.
`bundleRelease` (AAB für den Play Store) bauen.

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
| AGP / Gradle / JDK | 8.5.2 / ≥ 8.7 / 17 |
| Kern | `WebView` + `androidx.webkit:WebViewAssetLoader` |
