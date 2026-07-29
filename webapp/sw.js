/* Service Worker für PetitionsManager (PWA / Offline).
   Strategie: network-first mit Cache-Fallback. Online → immer frische Daten
   und App-Dateien; offline → zuletzt geladene Inhalte aus dem Cache. Beim
   Install wird die App-Hülle vorab gecacht, damit sie auch beim ersten
   Offline-Start funktioniert.

   AUSNAHME Volltext-Pakete (data/<key>.t<N>.json): die sind unveränderlich –
   eine einmal vergebene Paketnummer wechselt nie mehr (siehe
   publish.write_texts). Sie laufen deshalb cache-first und liegen in einem
   EIGENEN Cache, den das Hochzählen der Version nicht wegräumt. So wächst auf
   dem Gerät eine Bibliothek: einmal gelesene Petitionstexte bleiben da und
   werden nie erneut heruntergeladen. */
/* Version hochzählen, sobald Dateien in SHELL dazukommen oder sich die
   App-Hülle grundlegend ändert – sonst behalten installierte Geräte die
   alte Fassung. */
/* v5: Liberapay-Link, „Darstellung" oben in den Einstellungen, Platzhalter für
   fehlende Vorschaubilder (app.js/texts.js/style.css)
   v6: wählbare Layouts – NEUE Datei layouts.css in SHELL (app.js/texts.js/
   style.css/index.html)
   v7: Wortmarke mit „Beta" in der Kopfleiste, Seitentitel in den Inhalt
   gewandert, Notch-Höhe der Kopfleiste korrigiert (index.html/app.js/
   style.css/layouts.css)
   v8: Bento-Kacheln im Vollton der echten Markenfarbe, Schriftfarbe je Kachel
   gerechnet, gleich große Kacheln mit zwei großen Feldern, Monogramme raus,
   NEU acht echte Plattform-Logos in logos/ (app.js/layouts.css/style.css/
   platforms.js/texts.js)
   v9: Petitionsbild nicht mehr doppelt (wächst beim Aufklappen), Bedienfeld
   „Sortieren und filtern" unter der Suche, „Datenlage" → eingeklapptes
   „Für Nerds" mit Quellcode-Link, Logo + Wikipedia in „Über diese Plattform"
   (app.js/style.css/layouts.css/platforms.js)
   v10: die beiden letzten echten Logos (WeAct, Europäisches Parlament) – damit
   haben alle elf Plattformen eines –, dazu vier belegte Markenfarben anstelle
   von Schätzungen (platforms.js)
   v11: Vorschaubild wird beim Aufklappen nicht mehr beschnitten (Höhe folgt
   dem Seitenverhältnis) und wächst weich, Bedienfeld aufgeräumt, .chip-
   Kollision zwischen Bedienfeld und Onboarding behoben, echte Kontaktadresse
   (app.js/style.css)
   v12: Wortmarke führt zurück zur Übersicht (index.html: <div> → <button>),
   Aufnahmekodex als eigener Abschnitt unter „Unterstütze PetitionsManager"
   (index.html/app.js/style.css)
   v13: Sprungmarke in der Lücken-Meldung des Bedienfelds, Wortlaut dort
   korrigiert („beim Sortieren am Ende") (app.js/style.css)
   v14: Bento-Kachel umgebaut – Beschriftung oben, Logo groß unten links,
   Flagge als Ecke oben rechts, gefüllter Pfeil auf den großen Kacheln;
   350.org mit weißer Schrift; Favoritenstern auf der Plattformseite;
   Wischen im Magazin repariert; im Archiv links = Wiederherstellen,
   rechts = Unterschreiben (app.js/style.css/layouts.css/platforms.js)
   v15: Bento durchgehend weiße Schrift und Logos, schmalerer Spaltenabstand
   (app.js/layouts.css/platforms.js)
   v16: innn.it-Logo als SVG statt PNG (als CSS-Maske wurde das einzige
   Rasterbild nicht gezeichnet), Flaggen nur noch an der Gruppenüberschrift
   und dort als runder Kreis (app.js/style.css/layouts.css/platforms.js)
   v17: Innenabstand der Kacheln enger (Außenabstand zurück auf .75rem),
   Favoriten-Erklärung von der Übersicht in die Einstellungen gewandert
   (app.js/layouts.css/style.css)
   v18: Logo-Register – Monogramme raus, alle elf Logos flächengleich statt
   höhengleich, vier Farbvarianten, Markenfarbe im dunklen Thema
   (app.js/style.css/theme.css/layouts.css/platforms.js)
   v19: Datenquelle „Automatisch" – die App prüft beim Start, ob die
   tagesaktuellen Daten auf GitHub Pages erreichbar und neuer sind als die
   mitgelieferten, und nimmt sonst das App-Paket. Neue Vorgabe für alle, die
   nichts eingestellt haben (app.js) */
var CACHE = "pm-cache-v19";
/* Versionsunabhängig – überlebt das Hochzählen von CACHE. Die Zahl dahinter
   NUR hochsetzen, wenn sich die Paketnummerierung selbst ändert (dann stimmen
   die alten Inhalte nicht mehr zur Nummer und die Bibliothek muss weg).
   pm-texts-2: die WeAct-Reparatur hat genau diesen Fall ausgelöst – 423 Pakete
   behielten ihre Nummer, bekamen aber vollständige Texte. Ohne den Sprung
   hätten Geräte mit gefüllter Bibliothek die abgeschnittenen Fassungen
   dauerhaft behalten, weil Volltexte cache-first ausgeliefert werden. */
var TEXTS = "pm-texts-2";
var TEXT_RE = /\.t\d+\.json$/;
var SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./texts.js",
  "./platforms.js",
  "./style.css",
  "./theme.css",
  "./layouts.css",
  "./manifest.webmanifest",
  "./fontawesome/css/all.min.css",
  "./fontawesome/webfonts/fa-solid-900.woff2",
  "./fontawesome/webfonts/fa-regular-400.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  /* Echte Plattform-Logos. Gehören zur Hülle, nicht zu den Daten: sie ändern
     sich nur, wenn eine Plattform ihre Marke wechselt. */
  "./logos/avaaz.svg",
  "./logos/bundestag.svg",
  "./logos/changeorg.svg",
  "./logos/eko.svg",
  "./logos/europarl.svg",
  "./logos/foodwatch.svg",
  "./logos/innnit.svg",
  "./logos/openpetition.svg",
  "./logos/threefifty.svg",
  "./logos/weact.svg",
  "./logos/wemove.svg"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // cache:"reload" erzwingt echte Netz-Abrufe. Ohne das holt sich der
      // Install die Hülle aus dem HTTP-Cache des Browsers – dann zählt man
      // die Version hoch und bekommt trotzdem die alten Dateien.
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: "reload" }))
          .catch(function () { /* einzelne fehlende Datei nicht fatal */ });
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k !== TEXTS && k.indexOf("pm-") === 0)
          return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(TEXTS).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nur eigene Herkunft
  if (TEXT_RE.test(url.pathname)) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match("./index.html");
      });
    })
  );
});
