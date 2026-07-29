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
         * Algorithmisches Aufhellen/Abdunkeln fasst unsere Seiten nicht an:
         * die Web-App bringt eine eigene Dunkelregel mit, und WebView
         * überlässt Inhalten mit eigener Unterstützung die Gestaltung. */
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }

        // Export: JS ruft window.AndroidBackup.saveBackup(name, json).
        web.addJavascriptInterface(new BackupBridge(), "AndroidBackup");
        // Benachrichtigungen: JS ruft window.AndroidNotify.* (siehe NotifyBridge).
        web.addJavascriptInterface(new NotifyBridge(), "AndroidNotify");
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

            @Override
            public boolean shouldOverrideUrlLoading(WebView view,
                                                    WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_HOST.equals(uri.getHost())) return false;   // interne Seite
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

    /** Speichert die Backup-JSON in „Downloads" (API 29+) bzw. app-spezifisch. */
    private class BackupBridge {
        @JavascriptInterface
        public void saveBackup(final String filename, final String json) {
            String where;
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
}
