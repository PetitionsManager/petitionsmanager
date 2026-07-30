/* Service Worker für PetitionsManager (PWA / Offline).
   Strategie: network-first mit Cache-Fallback. Online → immer frische Daten
   und App-Dateien; offline → zuletzt geladene Inhalte aus dem Cache. Beim
   Install wird die App-Hülle vorab gecacht, damit sie auch beim ersten
   Offline-Start funktioniert.

   AUSNAHME Volltext-Pakete (data/<key>.t<N>.json): eine einmal vergebene
   Paketnummer wechselt nie mehr (siehe publish.write_texts). Sie laufen
   deshalb cache-first und liegen in einem EIGENEN Cache, den das Hochzählen
   der Version nicht wegräumt. So wächst auf dem Gerät eine Bibliothek: einmal
   gelesene Petitionstexte bleiben da und werden nie erneut heruntergeladen.

   Die Nummer bleibt, der INHALT kann sich ändern (nachgetragene oder
   reparierte Texte). Damit ein Gerät dann nicht für immer die alte Fassung
   behält, hängt die App an jedes Paket die Inhaltskennung aus dem Manifest an
   ("?v=ab12cd", siehe app.js/loadTextChunk). Der Cache liegt auf der
   VOLLSTÄNDIGEN Adresse einschließlich Suchteil, ein geändertes Paket wird
   also von selbst neu geholt, während alle unveränderten liegen bleiben; das
   Aufräumen der überholten Einträge macht app.js/pruneTextLibrary. TEXT_RE
   prüft nur den Pfad und ist vom Suchteil unberührt. */
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
   nichts eingestellt haben (app.js)
   v20: unterschriebene Petition öffnet wieder die Petition statt der
   Plattformübersicht (beendete lagen im zugeklappten Akkordion); Register
   HINT_KEYS, damit „Hinweise zurücksetzen" alle Hinweise erreicht;
   Benachrichtigungen laufen über registration.showNotification() und, wo
   vorhanden, über die Android-Brücke window.AndroidNotify (app.js)
   v21: echtes innn.it-Logo (Wellenmarke aus dem Bündel der Plattform statt
   eines PNG-Ausschnitts), EIN Innenabstand von 1.5rem für alle Kachelgrößen
   (logos/innnit.svg/platforms.js/layouts.css)
   v22: Plattform-Logo in den Einstellungen liegt hinter der Beschriftung statt
   daneben (app.js/style.css)
   v23: Layout „Farbband" ersetzt durch „Relief" (Neumorphismus) – gilt für die
   ganze App einschließlich Einstellungen und Profil; alte Auswahl "band" wird
   beim Laden auf "relief" umgeschrieben. Im Relief außerdem: Petitionsbild als
   schmales Band über die volle Kartenbreite statt als Vorschaubildchen (fährt
   beim Antippen weiter auf), und das Plattform-Logo steht bis 30rem Breite
   ÜBER der Beschriftung statt daneben bzw. dahinter – dadurch volle
   Markenfarbe statt 22 % und gleich hohe Zeilen
   (layouts.css/app.js/texts.js/index.html)
   v24: tote CSS-Regeln entfernt – .plat__dot und die ganze .prow-Familie
   werden von app.js nirgends erzeugt (die lebende Schwesterfamilie heißt
   .srow). .amp0–.amp5 sind dabei ausdrücklich GEBLIEBEN: sie sehen zwar
   genauso tot aus, entstehen aber dynamisch über ampClass() und färben die
   Offenheitsstufe in „Für Nerds" – sie haben jetzt einen Kommentar, der das
   sagt (style.css/layouts.css)
   v25: Bilder in den Aufruf-Texten – sie werden angezeigt (style.css:
   .pet__desc img/figure/figcaption) und lassen sich in den Einstellungen
   abschalten. Ausgeschaltet werden die <img> über DOMParser aus dem Text
   ENTFERNT, nicht versteckt: ein gesetztes img.src lädt auch außerhalb des
   Dokuments. Jedes Volltext-Paket trägt außerdem jetzt eine Inhaltskennung
   aus dem Manifest, die als "?v=" an die Adresse wandert
   (app.js/texts.js/style.css)
   v26: die Plattform-Logos sind nicht mehr einfarbig. Sie lagen als CSS-Maske
   vor einer Farbfläche; eine Maske kennt vom Bild nur den Alphakanal und wirft
   damit die echten Markenfarben UND jede Aussparung weg – der openPetition-
   Vogel war eine Silhouette, foodwatch fehlte die weiße Apfelscheibe. Jetzt
   liegen alle elf Marken EINGEBETTET im Dokument: einmal als <symbol> in einem
   verborgenen Bogen (app.js/loadLogoSprite), je Fundstelle nur ein <use> –
   sonst stünde wemove.svg mit 80 Formen und 85 kB zwanzigmal in einer Liste.
   Die Farben kommen als Variablen --pl-b1/--pl-b2 in die Datei hinein, weil
   ein CSS-Selektor den Schattenbaum eines <use> nicht erreicht. Bleibt der
   Bogen aus, fällt platLogo() auf die Maske zurück. Alle elf Logodateien
   geändert (Farbrollen, change.org von adaptiv auf rot, innn.it vollständig,
   zwei <style>-Blöcke aufgelöst); das ungenutzte Monogramm-Feld ist raus
   (app.js/style.css/theme.css/layouts.css/platforms.js/logos/*.svg)
   Mit v26 kommt außerdem der Abschnitt „Rechtliches" auf die Hauptseite:
   Impressum und „Rechte an den Inhalten" mit einer Tabelle je Plattform. Kein
   eigener Versionssprung nötig, weil v26 noch nicht ausgeliefert war — die
   geänderten app.js/style.css reisen mit (app.js/style.css) */
var CACHE = "pm-cache-v26";
/* Versionsunabhängig – überlebt das Hochzählen von CACHE. Diese Zahl sollte ab
   jetzt NICHT mehr steigen: seit die Pakete eine Inhaltskennung tragen ("?v=",
   siehe oben) holt sich jedes geänderte Paket von selbst neu. Ein Sprung wäre
   nur noch nötig, wenn die NUMMERIERUNG selbst umgestellt würde – und würde
   dann wie bisher die ganze Bibliothek auf allen Geräten kosten.
   pm-texts-2: die WeAct-Reparatur hat genau diesen Fall ausgelöst – 423 Pakete
   behielten ihre Nummer, bekamen aber vollständige Texte. Ohne den Sprung
   hätten Geräte mit gefüllter Bibliothek die abgeschnittenen Fassungen
   dauerhaft behalten, weil Volltexte cache-first ausgeliefert werden.
   pm-texts-3: 350.org holt seine Texte jetzt von der Aktionsseite statt aus
   dem Anreißer der Discovery-API. Sechs Aktionen bekommen dadurch überhaupt
   erst einen Text und dreizehn einen längeren – alles im bestehenden Paket
   threefifty.t0.json, also wieder gleiche Nummer bei geändertem Inhalt.
   Dass dieser Sprung jedes Mal die GANZE Bibliothek kostet, ist der Preis der
   Nummern-Unveränderlichkeit; eine Kennung je Paket würde das auf das eine
   geänderte Paket begrenzen (siehe Aufgabenliste). */
var TEXTS = "pm-texts-3";
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
