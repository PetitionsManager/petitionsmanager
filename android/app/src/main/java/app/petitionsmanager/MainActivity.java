package app.petitionsmanager;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import androidx.core.content.FileProvider;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Container-Activity: zeigt die gebündelte Web-App in einem WebView.
 *
 * Die Assets (webapp/ inkl. data/*.json) werden über den WebViewAssetLoader
 * unter einer virtuellen https-Herkunft ausgeliefert – so funktioniert das
 * fetch() der App offline. Zusätzlich:
 *   - onShowFileChooser: für den Import (&lt;input type=file&gt; im Profil),
 *   - JS-Brücke "AndroidBackup": für den Export (Sicherung in Downloads).
 */
public class MainActivity extends Activity {

    private static final String APP_HOST = "appassets.androidplatform.net";

    /* ⚠️ Woher die App eine APK annehmen darf.
       UpdateBridge.hole() ist die einzige Stelle, an der die App eine
       AUSFÜHRBARE Datei entgegennimmt und dem Systeminstallierer vorlegt – und
       die Adresse kommt aus JavaScript. Geprüft wird deshalb der ganze
       Pfadanfang, nicht bloß der Host: auf github.com darf JEDER ein Release
       anlegen, ein reiner Host-Vergleich ließe also jede fremde APK durch. */
    private static final String APK_QUELLE =
            "https://github.com/PetitionsManager/petitionsmanager/releases/download/";

    /* Zwei Prüfungen, von denen keine allein genügt:
       1. Der Pfadanfang muss unser Release-Ordner sein (siehe oben).
       2. Der Rest darf nur „tag/dateiname.apk" sein. Ohne das käme man mit
          …/releases/download/../../fremd/repo/böse.apk am ersten Riegel vorbei:
          der Anfang stimmt, und den Rückschritt löst erst GitHubs Server auf –
          java.net.URL normalisiert ihn NICHT weg.
       Groß-/Kleinschreibung ist beim Vergleich egal, weil GitHub Eigentümer und
       Repo ohnehin unabhängig davon auflöst; ein anderes Repo lässt sich damit
       nicht treffen. Erwartet wird, was build-apk.yml erzeugt, z. B.
       …/download/v1.0.42/PetitionsManager-v1.0.42.apk */
    private static boolean apkAdresseOk(String adresse) {
        if (adresse == null || !adresse.regionMatches(
                true, 0, APK_QUELLE, 0, APK_QUELLE.length())) {
            return false;
        }
        String rest = adresse.substring(APK_QUELLE.length());
        return !rest.contains("..")
                && rest.matches("[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\\.apk");
    }

    /* Erlaubtes Ziel NACH den Umleitungen: GitHub schickt den Download auf
       seinen Dateispeicher weiter. Wohin genau, bestimmt dann GitHub – nicht
       der Aufrufer, denn der Einstieg ist oben auf unseren Release-Ordner
       festgenagelt. Klein geschrieben wird mit Locale.ROOT, weil "GITHUB" ein
       I enthält und in türkischer Gebietsschema-Einstellung sonst zu "gıthub"
       würde – der Vergleich schlüge dann fehl. */
    private static boolean gitHubZiel(URL u) {
        if (u == null || !"https".equalsIgnoreCase(u.getProtocol())) return false;
        String h = u.getHost();
        if (h == null) return false;
        h = h.toLowerCase(java.util.Locale.ROOT);
        return h.equals("github.com") || h.endsWith(".githubusercontent.com");
    }

    private static final int FILE_CHOOSER_REQ = 1;
    private static final int NOTIFY_PERM_REQ = 2;
    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    /* Android kennt kein "noch nicht gefragt" für Rechte. Ohne diese Merkung
       wäre ein abgelehntes Recht nicht von einem ungefragten zu unterscheiden,
       und die App würde „bitte erlaube es in den Einstellungen" anzeigen,
       bevor sie überhaupt gefragt hat. Dauerhaft gespeichert, weil die
       Unterscheidung sonst bei jedem App-Start wieder verloren wäre. */
    private static final String KEY_GEFRAGT = "permissionAsked";

    private boolean gefragtGemerkt() {
        return getSharedPreferences(NotifyReceiver.PREFS, MODE_PRIVATE)
                .getBoolean(KEY_GEFRAGT, false);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);           // localStorage (Einstellungen etc.)
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);

        /* Dunkelmodus an die Web-App durchreichen.
         *
         * Ohne das meldet WebView `prefers-color-scheme` dauerhaft als "hell",
         * ganz unabhängig davon, wie das Gerät eingestellt ist — das
         * Farbdesign "Automatisch" der App blieb deshalb in der APK wirkungslos,
         * obwohl es im Browser nachweislich funktioniert.
         *
         * Zwei Teile, die nur gemeinsam wirken:
         *   1. hier das Zulassen (ab androidx.webkit; targetSdk 34 verlangt
         *      diesen Aufruf, setForceDark ist dort schon außer Betrieb),
         *   2. res/values-night/themes.xml, damit die App im Dunkelmodus
         *      überhaupt ein dunkles Thema hat — daran liest WebView ab.
         *
         * ⚠️ Hier stand: "Algorithmisches Abdunkeln fasst unsere Seiten nicht
         * an, die Web-App bringt ja eigene Dunkelregeln mit." Das ist FALSCH
         * und hat einen Fehler gedeckt. WebView sieht unsere Dunkelregeln
         * nicht — es liest ausschließlich die CSS-Eigenschaft `color-scheme`
         * bzw. das gleichnamige Meta-Tag. Die hatte die Web-App nirgends
         * (nur `prefers-color-scheme`-Medienabfragen und `theme-color`, beides
         * etwas anderes). Folge bei dunkel gestelltem Gerät: WebView färbte
         * die Seite nach, auch wenn in der App ausdrücklich "hell" gewählt war
         * — data-theme="light" ist ein App-Attribut, das WebView nicht kennt.
         * Vom Nutzer am 4.8.26 gemeldet ("sieht fast aus wie der Dunkelmodus").
         *
         * Seitdem deklariert die Web-App `color-scheme` an drei Stellen:
         * style.css :root sowie theme.css Block A und Block C.
         *
         * ⚠️ ZWEITER ANLAUF (7.8.2026). Der erste Versuch stand auf
         * `color-scheme:light` und HALF NICHT — der Nutzer meldete, dass
         * "hell" weiterhin dunkel ankommt. `light` allein heißt nämlich
         * "diese Seite kann ausschließlich hell", woraufhin WebView
         * hilfsbereit nachdunkelt; es ist wirkungsgleich mit gar keiner
         * Angabe. Jetzt steht dort `only light` ("fass mich nicht an"),
         * und in theme.css `dark` ("ich kann das selbst"). Beides in Chrome
         * mit --enable-features=WebContentsForceDark an echten Pixeln
         * nachgemessen; Einzelheiten im Kopf von webapp/sw.js.
         *
         * Damit bleibt `true` hier richtig: es hält `prefers-color-scheme`
         * am Leben (siehe oben), und das Nachdunkeln unterbleibt, weil die
         * Seite ihre Unterstützung jetzt korrekt ausweist. `false` wäre der
         * falsche Hebel — dann meldete WebView wieder dauerhaft "hell" und
         * das Farbdesign "Automatisch" wäre erneut wirkungslos. */
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }

        // Export: JS ruft window.AndroidBackup.saveBackup(name, json).
        web.addJavascriptInterface(new BackupBridge(), "AndroidBackup");
        // Benachrichtigungen: JS ruft window.AndroidNotify.* (siehe NotifyBridge).
        web.addJavascriptInterface(new NotifyBridge(), "AndroidNotify");
        /* Eigene Aktualisierung: NUR in der Fassung fuer die Direktverteilung.
           Steht der Bauschalter mitUpdater auf false (F-Droid, spaeter Play),
           wird die Bruecke gar nicht erst angemeldet - window.AndroidUpdate
           existiert dann nicht, und die Oberflaeche blendet den Menuepunkt
           aus, weil sie genau darauf prueft. Kein toter Knopf, der beim
           Antippen nichts tut. */
        if (BuildConfig.MIT_UPDATER) {
            web.addJavascriptInterface(new UpdateBridge(), "AndroidUpdate");
        }
        NotifyReceiver.kanalAnlegen(this);

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQ);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view,
                                                              WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            /* ⚠️ Entscheidend ist hier, was NICHT durchgelassen wird.
               Die Adressen stammen aus fremden Petitionstexten – auf allen elf
               Plattformen kann jeder eine Petition mit beliebigem Link anlegen.
               Vorher reichte diese Methode JEDES Schema ungeprüft an das System
               weiter, und unter Android ist `intent://…#Intent;…;end` kein Link,
               sondern ein Bauplan für den Aufruf einer BELIEBIGEN anderen App
               samt Extras; `file://` und `content://` greifen auf lokale Dateien
               zu. Erlaubt sind deshalb nur die drei Schemata, die ein Link in
               einer Petition überhaupt braucht.
               Die Web-App filtert dieselben Adressen schon beim Zeichnen
               (sichereUrl in webapp/app.js) – hier steht der zweite Riegel, weil
               ein einziger übersehener href sonst genügte. */
            @Override
            public boolean shouldOverrideUrlLoading(WebView view,
                                                    WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_HOST.equals(uri.getHost())) return false;   // interne Seite
                String schema = uri.getScheme();
                boolean erlaubt = "http".equalsIgnoreCase(schema)
                        || "https".equalsIgnoreCase(schema)
                        || "mailto".equalsIgnoreCase(schema);
                if (!erlaubt) return true;          // stumm verwerfen, nicht öffnen
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { }
                return true;                                        // extern öffnen
            }
        });

        setContentView(web);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("https://" + APP_HOST + "/assets/index.html");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{ data.getData() };
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
        }
    }

    /* Android liefert das Ergebnis der Rechte-Abfrage nicht an den Aufrufer
       zurück, sondern hier. Die Web-App erfährt es über ein Ereignis – sie
       liest danach selbst AndroidNotify.permission() und zeichnet neu. */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFY_PERM_REQ || web == null) return;
        web.evaluateJavascript(
                "window.dispatchEvent(new Event('androidNotifyPermission'))", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /* Der Dateiname der Sicherung kommt aus JavaScript. Auf API 28 und älter
       schreibt die Brücke unten mit `new File(dir, name)` – ein "../" darin
       löste sich dort zum übergeordneten Ordner auf. Alles außer Buchstaben,
       Ziffern, Punkt, Strich und Unterstrich wird deshalb ersetzt, und führende
       Punkte fallen weg (sonst bliebe ".." als Name stehen und bezeichnete den
       Elternordner). */
    private static String sichererDateiname(String roh) {
        String n = (roh == null ? "" : roh).replaceAll("[^A-Za-z0-9._-]", "_")
                                           .replace("..", "_");
        while (n.startsWith(".")) n = n.substring(1);
        /* Bleibt nichts Kennzeichnendes übrig, ist ein sprechender Name besser
           als eine Datei namens „_" in den Downloads. */
        return n.matches(".*[A-Za-z0-9].*") ? n : "sicherung.json";
    }

    /** Speichert die Backup-JSON in „Downloads" (API 29+) bzw. app-spezifisch. */
    private class BackupBridge {
        @JavascriptInterface
        public void saveBackup(final String rohname, final String json) {
            String where;
            final String filename = sichererDateiname(rohname);
            try {
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    os.write(bytes);
                    os.close();
                    where = "Downloads/" + filename;
                } else {
                    // Ohne Laufzeit-Berechtigung: app-spezifischer Ordner.
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File f = new File(dir, filename);
                    FileOutputStream fos = new FileOutputStream(f);
                    fos.write(bytes);
                    fos.close();
                    where = f.getAbsolutePath();
                }
                toast("Sicherung gespeichert: " + where);
            } catch (Exception e) {
                toast("Speichern fehlgeschlagen: " + e.getMessage());
            }
        }
    }

    /**
     * JS-Brücke für die tägliche Erinnerung. Die Web-App bevorzugt sie, wenn
     * window.AndroidNotify vorhanden ist – im WebView fehlt die
     * Web-Notification-API ersatzlos, dort ginge es sonst überhaupt nicht.
     *
     * Alle Methoden laufen auf einem WebView-Thread, nicht auf dem UI-Thread;
     * SharedPreferences und AlarmManager sind damit einverstanden.
     */
    private class NotifyBridge {
        /** "granted" | "denied" | "default" – gleiche Wörter wie im Web, damit
         *  die App keine zweite Begriffswelt braucht. */
        @JavascriptInterface
        public String permission() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted";
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                    == android.content.pm.PackageManager.PERMISSION_GRANTED)
                return "granted";
            /* Android unterscheidet "abgelehnt" nicht von "noch nie gefragt".
               Die Merkung liegt deshalb dauerhaft in den Einstellungen: sonst
               fragte die App nach jedem Neustart wieder, Android zeigte den
               Dialog bei dauerhafter Ablehnung gar nicht mehr, und der Nutzer
               sähe nur eine Meldung, die auf ein Ergebnis wartet. */
            return gefragtGemerkt() ? "denied" : "default";
        }

        /** Fragt das Recht zur Laufzeit. Ab Android 13 nötig. */
        @JavascriptInterface
        public void requestPermission() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
            getSharedPreferences(NotifyReceiver.PREFS, MODE_PRIVATE).edit()
                    .putBoolean(KEY_GEFRAGT, true).apply();
            runOnUiThread(new Runnable() {
                public void run() {
                    requestPermissions(
                            new String[]{ android.Manifest.permission.POST_NOTIFICATIONS },
                            NOTIFY_PERM_REQ);
                }
            });
        }

        /** Sofort eine Meldung zeigen – für die Testschaltfläche. */
        @JavascriptInterface
        public boolean show(String title, String body) {
            if (!"granted".equals(permission())) return false;
            NotifyReceiver.zeigen(MainActivity.this, title, body);
            return true;
        }

        /** Tageserinnerung einschalten bzw. Uhrzeit ändern. */
        @JavascriptInterface
        public void schedule(int hour, int minute) {
            getSharedPreferences(NotifyReceiver.PREFS, MODE_PRIVATE).edit()
                    .putBoolean(NotifyReceiver.KEY_ON, true)
                    .putInt(NotifyReceiver.KEY_HOUR, hour)
                    .putInt(NotifyReceiver.KEY_MINUTE, minute)
                    .apply();
            NotifyReceiver.planen(MainActivity.this, hour, minute);
        }

        @JavascriptInterface
        public void cancel() {
            getSharedPreferences(NotifyReceiver.PREFS, MODE_PRIVATE).edit()
                    .putBoolean(NotifyReceiver.KEY_ON, false).apply();
            NotifyReceiver.abbrechen(MainActivity.this);
        }
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    /* ---- Eigene Aktualisierung ------------------------------------------
       Warum es sie gibt: Die App wird als APK von GitHub verteilt. Ohne
       eigenen Weg muesste jeder von Hand nachsehen, ob es etwas Neues gibt -
       und die meisten taeten es nie.

       Die App installiert NICHTS selbst. Sie laedt die Datei und uebergibt
       sie dem Paketinstallierer des Systems; installiert wird erst nach
       ausdruecklicher Zustimmung im Systemdialog. REQUEST_INSTALL_PACKAGES
       erlaubt genau das - den Dialog zu oeffnen, nicht mehr.

       ⚠️ Nur in der Direktverteilungs-Fassung vorhanden (BuildConfig.MIT_UPDATER,
       siehe app/build.gradle). F-Droid bringt einen eigenen Updater mit,
       Google Play untersagt Selbstaktualisierung ausserhalb des Stores. */
    private class UpdateBridge {

        /* Neueste veroeffentlichte Fassung abfragen. Antwortet mit JSON:
           {"version":"1.0.24","apk":"https://…","hinweis":"…"} oder
           {"fehler":"…"}. Die Auswertung macht JS - hier wird bewusst nichts
           entschieden, damit die Texte in app.js/texts.js liegen und
           uebersetzbar sind.

           Laeuft in einem eigenen Thread: Netzwerkzugriff auf dem
           Hauptthread wirft NetworkOnMainThreadException, und die JS-Bruecke
           wird auf einem Binder-Thread aufgerufen, nicht zwingend im
           Hintergrund. Das Ergebnis geht per JavaScript-Rueckruf zurueck. */
        @JavascriptInterface
        public void pruefe(final String rueckruf) {
            new Thread(new Runnable() {
                @Override public void run() {
                    String ergebnis;
                    HttpURLConnection v = null;
                    try {
                        URL u = new URL("https://api.github.com/repos/"
                                + "PetitionsManager/petitionsmanager/releases/latest");
                        v = (HttpURLConnection) u.openConnection();
                        v.setConnectTimeout(15000);
                        v.setReadTimeout(15000);
                        v.setRequestProperty("Accept", "application/vnd.github+json");
                        /* GitHub weist Anfragen ohne User-Agent ab (403). */
                        v.setRequestProperty("User-Agent", "PetitionsManager-App");
                        int code = v.getResponseCode();
                        if (code != 200) {
                            ergebnis = "{\"fehler\":\"HTTP " + code + "\"}";
                        } else {
                            StringBuilder sb = new StringBuilder();
                            InputStream in = v.getInputStream();
                            byte[] puffer = new byte[8192];
                            int n;
                            while ((n = in.read(puffer)) > 0) {
                                sb.append(new String(puffer, 0, n, "UTF-8"));
                            }
                            in.close();
                            ergebnis = sb.toString();
                        }
                    } catch (Exception e) {
                        /* Kein Netz, DNS weg, Zeitueberschreitung: als Fehler
                           melden statt still nichts zu tun - sonst haengt die
                           Oberflaeche ewig bei "wird geprueft". */
                        ergebnis = "{\"fehler\":\"offline\"}";
                    } finally {
                        if (v != null) v.disconnect();
                    }
                    final String antwort = ergebnis;
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            web.evaluateJavascript(
                                rueckruf + "(" + jsText(antwort) + ")", null);
                        }
                    });
                }
            }).start();
        }

        /* APK laden und dem Systeminstallierer uebergeben.
           Fortschritt geht waehrenddessen an JS - ohne Rueckmeldung sieht ein
           20-MB-Download aus wie eine eingefrorene App. */
        @JavascriptInterface
        public void hole(final String adresse, final String fortschritt) {
            new Thread(new Runnable() {
                @Override public void run() {
                    HttpURLConnection v = null;
                    try {
                        /* ⚠️ Vor allem anderen: stammt die Adresse aus UNSEREM
                           Release-Ordner? Ohne diese Zeile genügte eine einzige
                           eingeschleuste Zeile JavaScript, um der App eine
                           beliebige APK unterzuschieben – der Nutzer sähe nur
                           den gewohnten Installationsdialog. */
                        if (!apkAdresseOk(adresse)) {
                            meldeFortschritt(fortschritt, -1);
                            return;
                        }

                        /* In den app-eigenen Cache, nicht in Downloads: kein
                           Speicherrecht noetig, und das System raeumt selbst
                           auf. Der Ordner ist in res/xml/file_paths.xml als
                           einziger freigegeben. */
                        File ordner = new File(getCacheDir(), "updates");
                        if (!ordner.exists()) ordner.mkdirs();
                        File ziel = new File(ordner, "update.apk");
                        if (ziel.exists()) ziel.delete();

                        URL u = new URL(adresse);
                        v = (HttpURLConnection) u.openConnection();
                        v.setConnectTimeout(20000);
                        v.setReadTimeout(30000);
                        v.setInstanceFollowRedirects(true);
                        v.setRequestProperty("User-Agent", "PetitionsManager-App");
                        /* Zwei Prüfungen, bevor auch nur ein Byte geschrieben wird:
                           Führte die Umleitungskette noch zu GitHub? Und ist die
                           Antwort überhaupt eine Datei? Ohne das Zweite landete
                           eine Fehlerseite als "update.apk" auf der Platte und
                           von dort im Installationsdialog. */
                        int code = v.getResponseCode();
                        if (code != 200 || !gitHubZiel(v.getURL())) {
                            meldeFortschritt(fortschritt, -1);
                            return;
                        }
                        int gesamt = v.getContentLength();
                        InputStream in = v.getInputStream();
                        FileOutputStream aus = new FileOutputStream(ziel);
                        byte[] puffer = new byte[16384];
                        int n, summe = 0, zuletzt = -1;
                        while ((n = in.read(puffer)) > 0) {
                            aus.write(puffer, 0, n);
                            summe += n;
                            if (gesamt > 0) {
                                final int p = (int) (100L * summe / gesamt);
                                /* Nur bei Aenderung melden: sonst tausende
                                   JS-Aufrufe fuer dieselbe Zahl. */
                                if (p != zuletzt) {
                                    zuletzt = p;
                                    meldeFortschritt(fortschritt, p);
                                }
                            }
                        }
                        aus.close();
                        in.close();

                        /* Ab Android 7 darf keine file://-Adresse nach aussen;
                           der Installierer bekommt eine content://-Adresse und
                           ein befristetes Leserecht. */
                        Uri uri = FileProvider.getUriForFile(MainActivity.this,
                                getPackageName() + ".fileprovider", ziel);
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(uri, "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        meldeFortschritt(fortschritt, 100);
                    } catch (Exception e) {
                        meldeFortschritt(fortschritt, -1);   // -1 = Fehler
                    } finally {
                        if (v != null) v.disconnect();
                    }
                }
            }).start();
        }

        /* Fassung, die gerade laeuft - damit JS vergleichen kann, ohne dass
           die Versionsnummer doppelt gepflegt werden muss. */
        @JavascriptInterface
        public String fassung() {
            try {
                return getPackageManager()
                        .getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }

    private void meldeFortschritt(final String rueckruf, final int prozent) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                web.evaluateJavascript(rueckruf + "(" + prozent + ")", null);
            }
        });
    }

    /* Beliebigen Text als JavaScript-Zeichenkette einbetten. Ohne das Maskieren
       wuerde ein Anfuehrungszeichen im Text den Aufruf zerreissen - und der
       Text kommt hier von einem fremden Server. */
    private static String jsText(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
