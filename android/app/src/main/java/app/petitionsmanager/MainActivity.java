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
    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;

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

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }
}
