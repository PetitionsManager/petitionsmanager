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
var CACHE = "pm-cache-v4";   /* v4: Beendet-Akkordion lädt verzögert (app.js/style.css) */
/* Versionsunabhängig – überlebt das Hochzählen von CACHE. Die Zahl dahinter
   NUR hochsetzen, wenn sich die Paketnummerierung selbst ändert (dann stimmen
   die alten Inhalte nicht mehr zur Nummer und die Bibliothek muss weg). */
var TEXTS = "pm-texts-1";
var TEXT_RE = /\.t\d+\.json$/;
var SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./texts.js",
  "./platforms.js",
  "./style.css",
  "./theme.css",
  "./manifest.webmanifest",
  "./fontawesome/css/all.min.css",
  "./fontawesome/webfonts/fa-solid-900.woff2",
  "./fontawesome/webfonts/fa-regular-400.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
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
