"use strict";
/* Petitionen — Mobile-App (entkoppelt vom Server; lädt statische JSON-Daten).
   Datenquelle über localStorage "dataBase": "auto" (Vorgabe), "./data" für die
   mitgelieferten Daten oder eine eigene URL. Was "auto" wählt, entscheidet
   resolveBase() beim Start. */

(function () {
  var LS = window.localStorage;
  var BUNDLED_BASE = "./data";        // im App-Paket bzw. neben index.html
  /* Tagesaktueller Stand aus dem GitHub-Actions-Lauf. Muss absolut sein: in
     der APK läuft die Seite unter appassets.androidplatform.net, ein relativer
     Pfad zeigt dort ins App-Paket und käme nie über den Bauzeitpunkt hinaus.
     GitHub Pages schickt "access-control-allow-origin: *", der Abruf von
     fremder Herkunft ist also erlaubt (am 29.7.26 nachgemessen). */
  var LIVE_BASE = "https://petitionsmanager.github.io/petitionsmanager/data";
  var AUTO = "auto";
  var DEFAULT_BASE = AUTO;
  /* Wartezeit für die Erreichbarkeitsprüfung. Bewusst knapp: sie sitzt vor dem
     ersten Bild, und wer im Funkloch startet, soll nicht warten müssen —
     die mitgelieferten Daten liegen ja bereit. */
  var LIVE_PROBE_MS = 6000;
  // Wie viele Karten eine Liste höchstens auf einmal rendert. Der Bundestag
  // bringt allein 7.845 beendete Petitionen mit; ungedeckelt wächst die Seite
  // auf über 180.000 DOM-Knoten und braucht schon am PC ~2 s zum Aufbau.
  var LIST_MAX = 300;
  /* Alle Schlüssel weggeklickter Hinweise an EINER Stelle — hier eintragen,
     sobald ein neuer Hinweis dazukommt. Vorher stand "swipeHintDismissed"
     dreimal einzeln im Code (Zurücksetzen, BACKUP_KEYS, wipeEverything). Als
     "favTipDismissed" für den Favoriten-Hinweis dazukam, wurde es an keiner
     dieser Stellen nachgetragen: der Hinweis ließ sich nicht zurückholen,
     fehlte in der Sicherung und überlebte sogar „alles löschen". */
  var HINT_KEYS = ["swipeHintDismissed", "favTipDismissed",
                   "toolNoteDismissed"];
  var nf = new Intl.NumberFormat("de-DE");

  /* ---- Vorerst ausgeblendete Teile (Nutzerwunsch 6.8.2026) -----------------
     „Kann erstmal ausgeblendet werden (NICHT gelöscht), brauchen wir aktuell
     nicht." Der Code bleibt deshalb vollständig stehen — nur diese Schalter
     entscheiden, ob er gezeigt wird. Zum Zurückholen genügt ein `true`, es
     muss nichts wiederhergestellt werden.
     An EINER Stelle gesammelt, aus demselben Grund wie HINT_KEYS darüber: ein
     verstreutes `if (false)` findet später niemand wieder. */
  var ZEIGE = {
    // Avatar, Bild-Knopf und Namensfeld auf der Profilseite. Der Name wird
    // weiterhin gespeichert und im Export verwendet, nur die Eingabe ruht.
    profilKopf: false,
    // Umschalter Automatisch/Mitgeliefert/Live samt „Eigene Quelle".
    // Ist er aus, steht die Quelle FEST (siehe QUELLE_FEST unten) — der
    // gespeicherte Wert aus localStorage wird dann bewusst übergangen.
    datenquelle: false
  };
  /* Die feste Quelle, solange der Umschalter ruht: „Automatisch" nimmt die
     tagesaktuellen Daten, wenn sie erreichbar und neuer sind als die
     mitgelieferten — und fällt ohne Verbindung von selbst auf das App-Paket
     zurück. Genau das Verhalten, das der Nutzer beschrieben hat („wenn es kein
     Internet gibt, können halt keine Updates geladen werden"). */
  var QUELLE_FEST = DEFAULT_BASE;

  var state = {
    baseSetting: ZEIGE.datenquelle
      ? (LS.getItem("dataBase") || DEFAULT_BASE)   // "auto" | "./data" | URL
      : QUELLE_FEST,
    base: BUNDLED_BASE,   // tatsächlich benutzte Quelle; resolveBase() setzt sie
    baseAuto: null,       // bei "auto": "live" | "bundled"
    baseWhy: null,        // Kurzbegründung für die Zeile in den Einstellungen
    lastRefresh: null,    // ISO-Zeit des letzten „Daten aktualisieren"
    manifest: null,
    dataCache: {},        // key -> array of petitions
    tab: "liste",
    platform: null,       // aktuell geöffnete Plattform (Detailansicht)
    search: "",
    enabled: null,        // Set der aktivierten Plattform-Keys
    favorites: null,      // Set der favorisierten Plattform-Keys
    signed: null,         // Set unterschriebener Petitionen (per URL)
    archived: null,       // Set archivierter Petitionen (per URL)
    settingsOpen: true,   // Akkordion "Plattformen" auf-/zugeklappt
    openGroup: null,      // aktuell offene Listen-Gruppe (exklusiv); Key/"__fav"
    catFilter: null,      // aktiver Kategorie-Filter (Plattform-Detail)
    tagFilter: null,      // aktiver Schlagwort-Filter (Plattform-Detail)
    sort: null,           // Sortierung der Liste: null|"neu"|"alt"|"viel"|"wenig"
    /* Zeigt NUR die Petitionen, denen ein Wert fehlt: null|"start_date"|
       "signatures". Erklaerung in buildTools bei der Luecken-Meldung. */
    gapFilter: null,
    mainQuery: "",        // letzte Volltextsuche auf der Hauptseite
    cross: null,          // plattformübergreifende Suche {type,value,fromPlatform}
    openPetitionUrl: null,// nach Navigation diese Petition automatisch aufklappen
    archiveOpen: false,   // Archiv-Akkordion (Plattform-Detail) offen?
    offlineOpen: false,   // Offline-Akkordion offen?
    closedOpen: false,    // Akkordion "Beendet" offen? (Frist abgelaufen)
    // Verbindungszustand. navigator.onLine ist die einzige Angabe, die ohne
    // eigenen Netzabruf zu haben ist; sie ist grob (WLAN ohne Internet gilt
    // als online), aber für „Bilder gar nicht erst anfordern" genau richtig.
    online: (typeof navigator === "undefined" || navigator.onLine !== false),
    prefs: null,          // persönliche Einstellungen (siehe loadPrefs)
    signedQuery: "",      // Suchwort in "Meine unterzeichneten Petitionen"
    aboutPlatform: false, // Info-Panel "Über diese Plattform" offen?
    wizardStep: 0         // aktueller Schritt der Ersteinrichtung
  };

  var content = document.getElementById("content");
  // Seitentitel. Sitzt seit dem Logo-Umbau nicht mehr in der Kopfleiste,
  // sondern als Zeile über dem Inhalt (index.html → .pagekick). NICHT mit der
  // Klasse .page-title verwechseln — das sind die kleinen Etiketten innerhalb
  // einer Seite („DARSTELLUNG"), deshalb heißt das hier bewusst anders.
  var titleEl = document.getElementById("pagekick");

  // Sprache → Anzeigename + Flagge (für Tag & Gruppierung in der Liste).
  var LANG = {
    de: { name: "Deutsch", flag: "🇩🇪" },
    en: { name: "Englisch", flag: "🇬🇧" },
    fr: { name: "Französisch", flag: "🇫🇷" },
    es: { name: "Spanisch", flag: "🇪🇸" },
    it: { name: "Italienisch", flag: "🇮🇹" }
  };
  var LANG_ORDER = ["de", "en", "fr", "es", "it"];
  function langInfo(code) {
    return LANG[code] || { name: (code || "Andere"), flag: "🏳️" };
  }
  function langRank(code) {
    var i = LANG_ORDER.indexOf(code); return i < 0 ? 99 : i;
  }

  // ---- Texte & Plattform-Stammdaten ------------------------------------------
  // Sämtliche Bildschirmtexte stehen in texts.js, die Marken-Daten der
  // Plattformen in platforms.js. Beide werden vor app.js geladen. Fehlt eine
  // der Dateien, läuft die App weiter – dann greifen die Rückfalltexte.
  var TX = window.PM_TEXTS || {};
  var PLATS = window.PM_PLATFORMS || {};

  // T("wizard.lang.title", "Rückfalltext") – holt einen Text über seinen Pfad.
  function T(path, fallback) {
    var cur = TX, parts = String(path).split("."), i;
    for (i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return fallback || "";
      cur = cur[parts[i]];
    }
    return (cur == null || cur === "") ? (fallback || "") : cur;
  }
  // Platzhalter der Form {n} ersetzen: fill("Schritt {n}", {n: 2}).
  function fill(str, vals) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : m;
    });
  }
  function platInfo(key) { return PLATS[key] || {}; }
  // Marken-Monogramm; ohne platforms.js ein schlichtes Buchstaben-Badge.
  /* ---- Logo-Register ------------------------------------------------------
     EINE Stelle, die ein Plattform-Logo ausgibt. Vorher lieferte platLogo ein
     selbstgebautes Monogramm („350", „Av", „BT" …) aus platforms.js; seit alle
     elf Plattformen ihre echte Marke haben, sind die Insignien überflüssig.

     Technik: CSS-Maske vor einer Farbfläche, kein <img>. Dadurch lässt sich
     dieselbe Datei in JEDER Farbe ausgeben — das ist der ganze Trick hinter
     den Varianten:
        "marke"  Markenfarbe (Listen auf hellem/dunklem Grund)
        "weiss"  Weiß        (auf Vollton-Markenflächen, Bento)
        "schwarz" Textton    (Druck/Kontrastfälle)
        "auto"   currentColor – erbt vom Elternteil
     Ein <img> könnte das nicht: es brächte seine eigenen Farben mit und
     verschwände auf gleichfarbigem Grund.

     GRÖSSENNORMIERUNG: Die Marken sind verschieden proportioniert — Bundestag
     6,17:1, foodwatch 5,23:1 gegen WeAct 1,42:1. Bei gleicher HÖHE nimmt die
     breiteste viermal so viel Fläche ein wie die schmalste und erschlägt sie
     optisch. Deshalb skaliert die Höhe mit 1/Wurzel(Seitenverhältnis): dann
     ist die FLÄCHE aller Marken gleich. Die Wurzel kann CSS nicht, der Faktor
     kommt deshalb hier als --logo-k heraus. */
  /* ---- Marken-Bogen -------------------------------------------------------
     Die Maske kann nur EINE Farbe. Sie kennt vom Bild nur „bemalt oder
     nicht" (den Alphakanal) und wirft damit zwei Dinge weg: die echten
     Markenfarben UND jede Aussparung. Bei openPetition war der Vogel
     deshalb eine Silhouette, bei foodwatch fehlte die weiße Apfelscheibe.

     Deshalb liegen die Marken jetzt EINGEBETTET im Dokument. Nicht je
     Fundstelle — das wären bei wemove.svg (80 Formen, 85 kB) in einer Liste
     mit zwanzig Zeilen 1,7 MB —, sondern einmal als <symbol> in einem
     verborgenen Bogen. Jede Fundstelle kostet dann nur noch ein <use>.

     Die Farben kommen als eigene Variablen, nicht über Klassen: ein
     CSS-Selektor erreicht den Schattenbaum eines <use> NICHT, geerbte
     Eigenschaften und eigene Variablen aber schon. In den Dateien steht
     darum style="fill:var(--pl-b1, <hausfarbe>)" statt einer Klassenregel.

     Bis der Bogen geladen ist (und falls er es nie wird) liefert platLogo()
     weiter die Maske. Die App kann daran also nicht scheitern. */
  var LOGO_READY = {};   // key -> true, sobald die Marke im Bogen steht
  var LOGO_AR = {};      // key -> Seitenverhältnis AUS DER DATEI
  function logoSymbolId(key) {
    return "pl-" + String(key).replace(/[^A-Za-z0-9_-]/g, "");
  }
  function loadLogoSprite() {
    var keys = [], k;
    for (k in PLATS) if (PLATS[k] && PLATS[k].logoFile) keys.push(k);
    if (!keys.length || !window.DOMParser) return Promise.resolve();
    var sprite = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sprite.setAttribute("class", "plogo-sprite");
    sprite.setAttribute("aria-hidden", "true");
    return Promise.all(keys.map(function (key) {
      return fetch(PLATS[key].logoFile, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status);
                             return r.text(); })
        .then(function (txt) { addLogoSymbol(sprite, key, txt); })
        .catch(function () { /* diese Marke bleibt bei der Maske */ });
    })).then(function () {
      if (sprite.childNodes.length) document.body.appendChild(sprite);
    });
  }
  function addLogoSymbol(sprite, key, txt) {
    var doc = new DOMParser().parseFromString(txt, "image/svg+xml");
    var root = doc.documentElement;
    // Bei einem Parserfehler heißt das Wurzelelement <parsererror>.
    if (!root || root.nodeName.toLowerCase() !== "svg") return;
    var vb = root.getAttribute("viewBox");
    if (!vb) return;
    var sym = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
    sym.setAttribute("id", logoSymbolId(key));
    sym.setAttribute("viewBox", vb);
    /* Wie die Maske vorher: links ausgerichtet, senkrecht mittig. Wichtig
       für die Stellen mit festem quadratischem Kasten (Magazin-Layout). */
    sym.setAttribute("preserveAspectRatio", "xMinYMid meet");
    var kids = root.childNodes, i, n;
    for (i = 0; i < kids.length; i++) {
      n = kids[i];
      /* <style> NICHT übernehmen. Zwei Dateien bringen Kurznamen wie .st0
         mit; elf Dateien in EINEM Dokument würden sich damit gegenseitig
         umfärben. Beide Dateien tragen ihre Füllung deshalb am Element. */
      if (n.nodeType === 1 && n.nodeName.toLowerCase() === "style") continue;
      sym.appendChild(document.importNode(n, true));
    }
    sprite.appendChild(sym);
    LOGO_READY[key] = true;
    var p = String(vb).trim().split(/[\s,]+/);
    var w = parseFloat(p[2]), h = parseFloat(p[3]);
    if (w > 0 && h > 0) LOGO_AR[key] = w / h;
  }
  function logoVars(key) {
    var info = platInfo(key);
    if (!info.logoFile) return null;
    /* Das Seitenverhältnis kommt aus der DATEI, sobald sie geladen ist —
       logoAR in platforms.js ist nur der Rückfall. Genau diese doppelte
       Buchführung war am 29.7.26 die Fehlerquelle: der Wert dort stand für
       innn.it auf 2,64, die Datei zeichnete 3,65. */
    var ar = LOGO_AR[key] || info.logoAR || 4;
    /* Normierung, seit 3.8.26 mit der VIERTEN Wurzel statt der zweiten
       (Nutzerwunsch: „Bundestag-Logo größer, openPetition auch, WeMove auch").
       Die zweite Wurzel macht die FLÄCHE aller Marken gleich — mathematisch
       sauber, in der Zeile aber zu streng: die breiten Schriftzüge wurden so
       flach, dass sie nicht mehr lesbar waren. Der Bundestag (6,17:1) stand
       auf 40 % der Bezugshöhe, WeMove (4,55:1) auf 47 %, openPetition auf 48 %.
       Mit der vierten Wurzel liegt die Höhe zwischen gleicher Fläche und
       gleicher Höhe: Bundestag 63 %, WeMove 68 %, openPetition 69 %, die
       schmale WeAct-Marke (1,42:1) bleibt bei 92 % statt 84 %. Breiter werden
       sie dabei um rund die Hälfte — die Schutzzonen in layouts.css sind
       darauf nachgerechnet. */
    return "--logo:url(" + esc(info.logoFile) +
           ");--logo-ar:" + (Math.round(ar * 1000) / 1000) +
           ";--logo-k:" + Math.pow(ar, -0.25).toFixed(3);
  }
  /* variante: "marke" | "weiss" | "schwarz" | "auto" (Vorgabe "marke") */
  function platLogo(key, name, variante) {
    var vars = logoVars(key);
    if (!vars) {
      // Kein Logo hinterlegt: Anfangsbuchstabe auf der Markenfarbe.
      var initial = String(name || key || "?").trim().charAt(0).toUpperCase();
      return '<span class="plogo plogo--fallback">' + esc(initial) + "</span>";
    }
    /* Beide Markentöne mitgeben: die Variante „marke" nimmt im Dunkel-Design
       den aufgehellten Wert. Ohne das verschwindet Ekōs #6400ff auf dunklem
       Grund (2,5:1). Dazu die zweite Hausfarbe, wo es eine gibt — innn.it
       hat einen violetten Punkt, WeMove ein magentafarbenes Muster. */
    var info = platInfo(key), farbe = platColor(key);
    var toene = (farbe ? ";--brand:" + esc(farbe) : "") +
      (info.colorDark ? ";--brand-dark:" + esc(info.colorDark) : "") +
      (info.color2 ? ";--brand2:" + esc(info.color2) : "") +
      (info.color2Dark ? ";--brand2-dark:" + esc(info.color2Dark) : "");
    /* href UND xlink:href: das kurze href kann erst SVG2 (Chrome 51). Diese
       Datei ist bewusst in altem JavaScript geschrieben — var, keine
       Pfeilfunktionen —, weil die APK auch auf betagte Android-WebViews
       kommt. Dort wäre das Logo sonst lautlos unsichtbar. Der HTML-Parser
       hängt xlink:href von selbst in den richtigen Namensraum, eine eigene
       Namensraum-Angabe braucht es dafür nicht. */
    var ziel = "#" + logoSymbolId(key);
    var marke = LOGO_READY[key]
      ? '<svg class="plogo__i" aria-hidden="true" focusable="false"><use href="' +
        ziel + '" xlink:href="' + ziel + '"/></svg>'
      : "";
    return '<span class="plogo' + (marke ? " plogo--svg" : "") +
      " plogo--v-" + (variante || "marke") +
      '" role="img" aria-label="Logo ' + esc(name || key) + '" style="' +
      vars + toene + '">' + marke + "</span>";
  }
  function platColor(key) { return platInfo(key).color || null; }

  /* Hier stand platInk(): die Schriftfarbe der Bento-Kachel wurde je
     Markenfarbe gerechnet (relative Leuchtdichte nach WCAG 2.1) und auf die
     kontraststärkere Seite gesetzt. Seit der Nutzerentscheidung „alle
     Schriften/Logos weiß" ist die Farbe fest und die Rechnung hinfällig —
     der Wert kommt jetzt aus layouts.css. Zum Zurückholen siehe Commit
     ae4ab06 (samt der Messreihe über alle elf Marken). */

  // ---- Persönliche Einstellungen ---------------------------------------------
  // Ein einziger localStorage-Schlüssel für alles, was die Person selbst
  // einstellt (Darstellung, Benachrichtigungen, Name/Bild, Wizard-Status).
  var PREFS_KEY = "prefs";
  function defaultPrefs() {
    return {
      theme: "auto",              // "light" | "dark" | "auto"
      layout: "relief",           // "relief" | "magazin" (layouts.css)
      /* Akzentfarbe des Magazin-Layouts (7.8.26, Nutzerwunsch „muss nicht
         koralle sein … aus einer palette"). Werte = ACCENTS unten; die
         Farben selbst stehen in layouts.css unter [data-accent="…"] und
         wirken nur im Magazin — Relief ignoriert das Attribut. */
      accent: "koralle",
      /* Schriftfarbe auf gefüllten Akzentflächen: "auto" folgt der
         gerechneten Empfehlung je Farbe, "light"/"dark" überschreiben
         sie (Nutzerwunsch 7.8.26). */
      accentInk: "auto",
      /* Bilder in den Aufruf-Texten. Vorgabe an: sie gehören zum Aufruf.
         Wer über Mobilfunk spart, schaltet sie aus — dann werden die <img>
         beim Aufbau der Beschreibung ENTFERNT statt versteckt (siehe
         stripImages): ein display:none-Bild lädt der Browser trotzdem.
         Am 29.7.26 gemessen: 21 verlinkte Bilder, zusammen 24,5 MB, im
         Schnitt 1,2 MB je Bild, das größte 4,9 MB. */
      descImages: true,
      wizardDone: false,
      name: "",
      photo: null,                // Data-URL des Profilbilds
      notify: { on: false, time: "09:00", quiet: true, lastDate: null }
      // notify.quiet = true  → auch melden, wenn es nichts Neues gibt
    };
  }
  function loadPrefs() {
    var p = defaultPrefs(), raw = LS.getItem(PREFS_KEY);
    if (raw) {
      try {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") {
          if (o.theme) p.theme = o.theme;
          /* „band" (Farbband) ist am 2026-07-29 durch „relief"
             (Neumorphismus) ersetzt worden. Wer das alte Layout gewählt
             hatte, hat den Wert im localStorage stehen; ohne Umschreiben
             fiele die App stillschweigend auf „klassisch" zurück, weil
             layouts.css zu "band" keine Regel mehr kennt. Beides sind
             Nachfolger des SELBEN Wunsches („nicht die Standardansicht"),
             deshalb wird umgestellt und nicht zurückgesetzt. */
          if (o.layout === "band") o.layout = "relief";
          /* „klassisch" ist am 2026-08-03 auf Nutzerwunsch aus der Auswahl
             genommen worden. Der Wert steht bei allen im localStorage, die nie
             umgestellt haben — das war die bisherige Vorgabe. Ohne Umschreiben
             bliebe data-layout="klassisch" stehen, und weil layouts.css dazu
             (wie schon immer) keine Regel kennt, sähen genau diese Nutzer
             weiterhin die alte Ansicht, ohne sie in den Einstellungen noch
             auswählen oder verlassen zu können. */
          if (o.layout === "klassisch") o.layout = "relief";
          if (o.layout) p.layout = o.layout;
          /* Nur bekannte Palettenwerte übernehmen: ein Tippfehler im
             Speicher hieße sonst data-accent="…" ohne CSS-Regel, und das
             Magazin fiele still auf die :root-Vorgabe (Koralle) zurück —
             gleiches Muster wie die layout-Umschreibungen oben. */
          /* Gültig sind „koralle" und jeder Plattform-Schlüssel — die
             Farbwerte stehen in platforms.js, die Paletten dazu in
             layouts.css. Unbekanntes fällt auf Koralle zurück, sonst
             stünde data-accent ohne passende Regel da. */
          if (o.accent && (o.accent === "koralle" ||
              (window.PM_PLATFORMS && window.PM_PLATFORMS[o.accent])))
            p.accent = o.accent;
          if (["auto", "light", "dark"].indexOf(o.accentInk) !== -1)
            p.accentInk = o.accentInk;
          if (typeof o.descImages === "boolean") p.descImages = o.descImages;
          if (o.wizardDone) p.wizardDone = true;
          if (typeof o.name === "string") p.name = o.name;
          if (typeof o.photo === "string") p.photo = o.photo;
          if (o.notify && typeof o.notify === "object") {
            if (typeof o.notify.on === "boolean") p.notify.on = o.notify.on;
            if (o.notify.time) p.notify.time = o.notify.time;
            if (typeof o.notify.quiet === "boolean") p.notify.quiet = o.notify.quiet;
            if (o.notify.lastDate) p.notify.lastDate = o.notify.lastDate;
          }
        }
      } catch (e) {}
    }
    return p;
  }
  function savePrefs() { LS.setItem(PREFS_KEY, JSON.stringify(state.prefs)); }

  // Darstellung anwenden: das CSS in theme.css hängt an <html data-theme="…">.
  function applyTheme() {
    var t = (state.prefs && state.prefs.theme) || "auto";
    document.documentElement.setAttribute("data-theme", t);
    var dark = t === "dark" || (t === "auto" && window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    // Statusleiste des Geräts an den Seitengrund angleichen (siehe style.css
    // bzw. theme.css: --bg). Sonst bleibt oben ein andersfarbiger Streifen.
    // index.html liefert zwei Tags mit media-Abfrage für den ersten Aufbau;
    // sobald wir selbst entscheiden, bleibt genau eines ohne media übrig.
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = metas.length - 1; i > 0; i--) metas[i].parentNode.removeChild(metas[i]);
    if (metas[0]) {
      metas[0].removeAttribute("media");
      metas[0].setAttribute("content", dark ? "#191714" : "#f7f4ec");
    }
  }

  // Layout anwenden. Zweite Ebene neben dem Hell/Dunkel-Design und nach
  // demselben Muster gebaut: das CSS in layouts.css hängt an
  // <html data-layout="…">, die Farben bleiben in beiden Fällen dieselben
  // Variablen. Seit dem 3.8.26 gibt es nur noch „relief" und „magazin";
  // „klassisch" (= gar keine Regel, es griff allein style.css) ist entfallen,
  // alte gespeicherte Werte schreibt loadPrefs() auf „relief" um.
  function applyLayout() {
    var l = (state.prefs && state.prefs.layout) || "relief";
    document.documentElement.setAttribute("data-layout", l);
    /* Akzentfarbe hängt am selben Schalter: layouts.css kennt die Paletten
       nur unter [data-layout="magazin"], in Relief ist das Attribut
       wirkungslos — deshalb kein eigenes applyAccent. */
    document.documentElement.setAttribute("data-accent",
      (state.prefs && state.prefs.accent) || "koralle");
    document.documentElement.setAttribute("data-accent-ink",
      (state.prefs && state.prefs.accentInk) || "auto");
  }

  // ---- Hilfen ----------------------------------------------------------------
  function el(html) { var t = document.createElement("template");
    t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return (s == null ? "" : String(s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;"); }
  function ampClass(o) { return "amp" + (o >= 1 && o <= 5 ? o : 0); }

  function loadEnabled() {
    var raw = LS.getItem("enabledPlatforms");
    if (raw) { try { return new Set(JSON.parse(raw)); } catch (e) {} }
    return null;   // null = "alle Live-Plattformen" (Default)
  }
  function saveEnabled() {
    LS.setItem("enabledPlatforms", JSON.stringify(Array.from(state.enabled)));
  }
  function isEnabled(key) {
    if (state.enabled === null) return true;
    return state.enabled.has(key);
  }

  function loadFavorites() {
    var raw = LS.getItem("favorites");
    if (raw) { try { return new Set(JSON.parse(raw)); } catch (e) {} }
    return new Set();
  }
  function saveFavorites() {
    LS.setItem("favorites", JSON.stringify(Array.from(state.favorites)));
  }
  function isFav(key) { return state.favorites.has(key); }

  // Generische URL-Mengen (unterschrieben / archiviert), in localStorage.
  function loadSet(k) {
    var raw = LS.getItem(k);
    if (raw) { try { return new Set(JSON.parse(raw)); } catch (e) {} }
    return new Set();
  }
  function saveSet(k, s) { LS.setItem(k, JSON.stringify(Array.from(s))); }

  // Unterschrieben: Map url -> {ts, title, platform, signatures, date}. Der
  // Zeitstempel (ts) hält fest, WANN als "unterschrieben" markiert wurde (für
  // die Liste im Profil). signatures/date sind ein Abzug des Datensatzes aus
  // demselben Moment und seit 3.8.26 dabei: der Profiltab lädt keine
  // Plattformlisten nach, ohne den Abzug stünde die Zeile dort sonst ohne Zahl
  // und ohne Datum da. Ältere Einträge haben beides nicht — dann bleiben die
  // Felder null und die Anzeige lässt sie weg (siehe drawSigned).
  function loadSigned() {
    var raw = LS.getItem("signedPetitions"), m = new Map();
    if (raw) {
      try {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach(function (x) {
          if (typeof x === "string") m.set(x, { ts: null });      // altes Format
          else if (x && x.url) m.set(x.url, {
            ts: x.ts || null, title: x.title || null, platform: x.platform || null,
            signatures: (typeof x.signatures === "number") ? x.signatures : null,
            date: x.date || null });
        });
      } catch (e) {}
    }
    return m;
  }
  function saveSigned() {
    var arr = [];
    state.signed.forEach(function (v, k) {
      arr.push({ url: k, ts: v.ts || null, title: v.title || null,
                 platform: v.platform || null,
                 signatures: (typeof v.signatures === "number") ? v.signatures : null,
                 date: v.date || null });
    });
    LS.setItem("signedPetitions", JSON.stringify(arr));
  }
  function isSigned(u) { return state.signed.has(u); }
  function isArchived(u) { return state.archived.has(u); }
  // Von der Quelle beendet (Frist abgelaufen/archiviert) – nicht mehr
  // unterschreibbar. Das ist etwas anderes als "offline" (Seite weg) und als
  // "archiviert" (das ist das persönliche Archiv des Nutzers).
  function isClosed(r) { return !!(r && r.closed); }
  function toggleSigned(u, meta) {
    if (state.signed.has(u)) state.signed.delete(u);
    else state.signed.set(u, {
      ts: new Date().toISOString(),
      title: (meta && meta.title) || null,
      platform: (meta && meta.platform) || null,
      signatures: (meta && typeof meta.signatures === "number")
        ? meta.signatures : null,
      date: (meta && meta.date) || null
    });
    saveSigned();
  }
  /* Zu einer gespeicherten Unterschrift den AKTUELLEN Datensatz suchen. Der
     Abzug in der Unterschrift ist vom Tag des Markierens; liegt die Liste der
     Plattform schon im Speicher, ist ihre Unterschriftenzahl die frischere.
     state.dataCache füllt sich nur, wenn die Liste in dieser Sitzung geöffnet
     wurde — sonst gibt es hier nichts und der Abzug bleibt stehen. */
  function signedRecord(url, v) {
    var arr = (v && v.platform) ? state.dataCache[v.platform] : null;
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) if (arr[i].url === url) return arr[i];
    return null;
  }
  function setArchived(u, on) {
    if (on) state.archived.add(u); else state.archived.delete(u);
    saveSet("archivedPetitions", state.archived);
  }
  /* Alle Live-Plattformen, IMMER alphabetisch (Nutzerwunsch 6.8.2026).
     Die Sortierung sitzt hier und nicht bei den Aufrufern: sie stand vorher an
     drei Stellen einzeln (Liste, Einstellungen) und fehlte an mehreren anderen
     — Rechte-Tabelle, Ersteinrichtung und Cross-Suche liefen in der Reihenfolge
     des Manifests, also nach Aufnahmedatum. Eine Kopie mit slice(), damit die
     Reihenfolge im Manifest unangetastet bleibt.
     localeCompare mit „de": sonst stünde „Ekō" hinter „Innn.it" und „Über…"
     hinter „Zeit". Ziffern kommen davor, 350.org steht also zuerst. */
  function livePlatforms() {
    return state.manifest.platforms
      .filter(function (p) { return p.live; })
      .slice()
      .sort(function (a, b) {
        return String(a.name || a.key).localeCompare(
               String(b.name || b.key), "de", { numeric: true });
      });
  }

  // ---- Daten laden -----------------------------------------------------------
  function fetchJSON(url, cacheMode) {
    return fetch(url, { cache: cacheMode || "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    });
  }
  function isRemote(base) { return /^https?:/i.test(base); }
  /* Eigene Dateien mit "no-store", sonst hält der HTTP-Cache alte Stände fest
     (das hat am 28.7.26 dreimal eine veraltete app.js vorgetäuscht). Für die
     Live-Quelle dagegen ausdrücklich der normale Cache: die Listen sind
     zusammen ~14 MB, die dürfen nicht bei jedem Start neu über die
     Mobilfunkverbindung kommen. Pages schickt max-age=600 und einen ETag, die
     Daten wechseln ohnehin nur einmal täglich. */
  function fetchFrom(base, path) {
    return fetchJSON(base + "/" + path,
                     isRemote(base) ? "default" : "no-store");
  }
  /* Holt eine Datendatei und fällt auf die mitgelieferten Daten zurück, wenn
     die Live-Quelle unterwegs wegbricht — Verbindung verloren, Pages-Ausfall.
     Der Service Worker kann das nicht abfangen: sein fetch-Handler lässt
     fremde Herkunft absichtlich unangetastet durch, cached davon also nichts.

     Grenze des Rückfalls, bewusst so gelassen: die Paketnummer eines Volltexts
     (r.tc) stammt aus der Liste, die geladen wurde. Live- und Paketstand
     vergeben Nummern unabhängig voneinander — CI und lokaler Lauf kennen nicht
     dieselben Petitionen (am 29.7.26: 1.895 gegen 1.865 bei WeAct). Für eine
     erst kürzlich hinzugekommene Petition kann die Nummer daher auseinander
     laufen. Schlimmster Fall ist kein falscher Text, sondern keiner: die Pakete
     sind nach URL geschlüsselt, ein Fehlgriff findet den Eintrag einfach nicht
     und die Karte zeigt „kein ausführlicher Text". Das ist der Preis dafür,
     dass die App bei Verbindungsverlust überhaupt weiterläuft. */
  function fetchData(path) {
    return fetchFrom(state.base, path).catch(function (err) {
      if (state.base === BUNDLED_BASE) throw err;
      return fetchFrom(BUNDLED_BASE, path);
    });
  }
  function loadManifest() {
    return fetchData("manifest.json").then(function (m) {
      state.manifest = m;
      pruneTextLibrary();   // erst jetzt möglich: braucht die Kennungen
      return m;
    });
  }
  function loadPlatformData(key) {
    if (state.dataCache[key]) return Promise.resolve(state.dataCache[key]);
    return fetchData(key + ".json").then(function (arr) {
      state.dataCache[key] = arr; return arr;
    });
  }

  /* Jüngster Scrape-Zeitpunkt eines Manifests, in Millisekunden.
     Date.parse statt Textvergleich ist Pflicht: die Zeitstempel tragen
     unterschiedliche Zonen ("…+00:00" aus der CI, "…-06:00" vom lokalen Lauf),
     als Zeichenketten verglichen käme die falsche Reihenfolge heraus. */
  function manifestStamp(m) {
    var best = 0;
    ((m && m.platforms) || []).forEach(function (p) {
      var t = Date.parse(p.generated_at || "");
      if (t && t > best) best = t;
    });
    return best;
  }
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var fertig = false;
      var t = setTimeout(function () {
        if (!fertig) { fertig = true; reject(new Error("Zeitüberschreitung")); }
      }, ms);
      p.then(function (v) {
        if (!fertig) { fertig = true; clearTimeout(t); resolve(v); }
      }, function (e) {
        if (!fertig) { fertig = true; clearTimeout(t); reject(e); }
      });
    });
  }
  /* Bei "auto": Live-Daten nehmen, wenn sie erreichbar UND nicht älter sind als
     die mitgelieferten. Der Vergleich ist nötig, weil beide Stände auseinander
     laufen können — die APK bringt einen Stand vom Bauzeitpunkt mit, der
     CI-Lauf veröffentlicht täglich neu, kann aber auch mal ausfallen (am
     29.7.26 lief er ins Job-Limit und veröffentlichte nichts). Scheitert die
     Prüfung, bleibt es beim App-Paket; die App startet also auch im Flugmodus. */
  function resolveBase() {
    if (state.baseSetting !== AUTO) {
      state.base = state.baseSetting;
      state.baseAuto = null; state.baseWhy = null;
      return Promise.resolve();
    }
    state.base = BUNDLED_BASE;      // Rückfall, bis die Prüfung etwas Besseres weiß
    var eigen = fetchFrom(BUNDLED_BASE, "manifest.json")
                  .catch(function () { return null; });
    var live = withTimeout(fetchFrom(LIVE_BASE, "manifest.json"), LIVE_PROBE_MS)
                  .catch(function () { return null; });
    return Promise.all([live, eigen]).then(function (r) {
      var mLive = r[0], mEigen = r[1];
      if (!mLive) {
        state.baseAuto = "bundled";
        state.baseWhy = mEigen ? "Live-Daten nicht erreichbar" : "Keine Verbindung";
        return;
      }
      if (mEigen && manifestStamp(mEigen) > manifestStamp(mLive)) {
        state.baseAuto = "bundled";
        state.baseWhy = "Mitgelieferte Daten sind neuer";
        return;
      }
      state.base = LIVE_BASE;
      state.baseAuto = "live";
      state.baseWhy = "Tagesaktuell von GitHub Pages";
    });
  }
  /* Quelle gewechselt: alles Geladene verwerfen und neu auflösen. textChunks
     MUSS mit weg, sonst behält die App die Volltexte der alten Quelle — das
     war in der Prompt-Variante vorher ein stiller Fehler. Bewusst nicht boot():
     das hängt bei jedem Aufruf erneut Scroll- und matchMedia-Horcher an. */
  function reloadData() {
    state.dataCache = {}; state.manifest = null; textChunks = {};
    content.innerHTML = '<div class="empty">Lade Daten …</div>';
    return resolveBase().then(loadManifest).then(function () { render(); })
      .catch(function () {
        content.innerHTML = '<div class="empty">Daten konnten nicht geladen ' +
          'werden.<br>Prüfe die <b>Datenquelle</b> in den Einstellungen.</div>';
      });
  }

  // ---- Rendering: Liste ------------------------------------------------------
  function renderListe() {
    titleEl.textContent = state.platform ? platformName(state.platform)
                                         : "Petitionen";
    if (state.platform) return renderPlatformDetail(state.platform);

    var live = livePlatforms().filter(function (p) { return isEnabled(p.key); })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
    if (!live.length) {
      content.innerHTML = "";
      content.appendChild(el(
        '<div class="empty">Keine Plattform aktiviert.<br>' +
        'Wähle in den <b>Einstellungen</b> aus, welche du sehen möchtest.</div>'));
      return;
    }
    content.innerHTML = "";

    /* Der Begrüßungsblock ist am 3.8.26 auf Nutzerwunsch ganz entfallen —
       Kicker, Überschrift und Fließtext. Die Seite beginnt jetzt unmittelbar
       mit der Suche: wer die App öffnet, will suchen, nicht begrüßt werden.
       Der Kicker wird dafür hier geleert; .pagekick:empty blendet sich in
       style.css selbst aus, sonst bliebe eine leere Zeile stehen.
       Die Texte app.welcomeTitle/app.welcomeText bleiben in texts.js: der
       Einrichtungsassistent benutzt sie weiter. */
    titleEl.textContent = "";

    // Volltextsuche über alle aktivierten Plattformen (Feld + Button).
    var searchRow = el('<form class="mainsearch" role="search">' +
      '<input class="mainsearch__in" type="search" ' +
      'placeholder="' + esc(T("liste.searchPlaceholder",
        "Alle Petitionen durchsuchen …")) + '" value="' +
      esc(state.mainQuery) + '">' +
      /* Nur die Lupe, kein Wort (Nutzerwunsch 3.8.26) — das aria-label trägt
         die Bedeutung für Screenreader, das Symbol ist deshalb aria-hidden. */
      '<button class="mainsearch__btn" type="submit" aria-label="Suchen">' +
      '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>' +
      "</button></form>");
    var searchIn = searchRow.querySelector(".mainsearch__in");
    /* Vorschläge über alle aktivierten Plattformen. Beim Start liegt dafür
       nichts bereit: state.dataCache füllt sich erst, wenn eine Plattform
       geöffnet wird — auf der Hauptseite ist er also leer. Das erste Antippen
       des Feldes stößt deshalb das Laden an und zeichnet nach jeder
       eintreffenden Liste nach. Dieselben Dateien holt die Volltextsuche beim
       Absenden ohnehin; danach liegen sie im Cache des Service Workers. */
    var acMain = attachAutocomplete(searchIn, function (q) {
      return sucheVorschlaege(q, live.filter(function (p) {
        return isEnabled(p.key);
      }).map(function (p) { return p.key; }));
    });
    var acGeladen = false;
    searchIn.addEventListener("focus", function () {
      if (acGeladen) return;
      acGeladen = true;
      live.forEach(function (p) {
        if (!isEnabled(p.key)) return;
        loadPlatformData(p.key).then(acMain.refresh, function () {});
      });
    });
    searchRow.addEventListener("submit", function (e) {
      e.preventDefault();
      acMain.close();
      var q = searchIn.value.trim();
      if (!q) return;
      state.mainQuery = q;
      state.cross = { type: "text", value: q, fromPlatform: null };
      render();
    });
    content.appendChild(searchRow);
    if (T("liste.searchHint", "")) {
      content.appendChild(el('<p class="mainsearch__hint">' +
        esc(T("liste.searchHint", "")) + "</p>"));
    }

    /* NUR MAGAZIN: Aufmacher-Slider über den Gruppen (siehe mzHero).
       Die Daten liegen beim Start bewusst NICHT vor (Lazy-Prinzip der
       Hauptseite) — der Kasten reserviert deshalb sofort seine Höhe
       (CLS-Lehre: nichts nachträglich einschieben) und füllt sich, wenn
       die Listen eintreffen. Bundestag/Europarl liefern nie Bilder,
       darum werden so viele Plattformen angefragt, bis genug Folien da
       sind — sortiert nach Bestandsgröße.

       ⚠️ ANZAHL-LOGIK vom Nutzer vorgegeben (8.8.2026): bei HÖCHSTENS
       fünf aktivierten Plattformen je ZWEI Petitionen, bei mehr als
       fünf je EINE. Gedanke dahinter: wer wenige Plattformen gewählt
       hat, soll trotzdem einen gefüllten Slider sehen; wer viele
       gewählt hat, bekommt Vielfalt statt Wiederholung. `live` ist
       bereits auf die aktivierten gefiltert (siehe oben), seine Länge
       ist also genau die Zahl, die der Nutzer in den Einstellungen
       sieht.
       Der frühere feste Deckel („nur die vier größten Plattformen,
       höchstens sechs Folien") ist damit HINFÄLLIG — er würde die neue
       Regel sofort wieder aushebeln: bei fünf Plattformen à zwei
       Folien hätte er von zehn Folien vier weggeschnitten und aus
       „je zwei pro Plattform" wieder eine willkürliche Auswahl
       gemacht. */
    if (state.prefs.layout === "magazin" && state.online) {
      var mzBox = el('<div class="mz-herobox mz-herobox--ph"></div>');
      content.appendChild(mzBox);
      var mzProPlat = (live.length <= 5) ? 2 : 1;
      var mzQuellen = live.slice().sort(function (a, b) {
        return (b.online || 0) - (a.online || 0); });
      Promise.all(mzQuellen.map(function (p) {
        return loadPlatformData(p.key).then(function (arr) {
          /* Je Plattform die stärksten nach Trend (Unterschriften je
             Tag, siehe mzTrend) — wie viele, entscheidet mzProPlat
             oben: zwei bei bis zu fünf Plattformen, sonst eine. So
             dominiert keine Plattform den Slider. */
          return arr.filter(mzSliderKandidat)
            .map(function (r) { return { r: r, plat: p.key,
              score: mzTrend(r) }; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, mzProPlat);
        }, function () { return []; });
      })).then(function (teile) {
        var rows = [].concat.apply([], teile);
        /* Reihenfolge im Slider nach Trend über alle Plattformen
           hinweg; WIE VIELE je Plattform hineinkommen, hat mzProPlat
           schon oben entschieden. Hier wird bewusst NICHT mehr
           gedeckelt (früher: sechs) — der Deckel würde die vom Nutzer
           gewünschte Verteilung wieder zerschneiden. */
        rows.sort(function (a, b) { return b.score - a.score; });
        if (!rows.length) { mzBox.remove(); return; }
        var hero = mzHero(rows.map(function (e) {
          return {
            image_url: e.r.image_url, title: e.r.title,
            chip: platformName(e.plat),
            /* Der Trend darf sich zeigen: „~N/Tag" nur, wenn er aus
               echten Werten gerechnet ist (Unterschriften UND Datum). */
            meta: (typeof e.r.signatures === "number")
              ? nf.format(e.r.signatures) + " Unterschriften" +
                (e.r.start_date && e.score >= 1
                  ? " · ~" + nf.format(Math.round(e.score)) + "/Tag"
                  : "")
              : "",
            /* Öffnet die ANGEKLICKTE PETITION, nicht bloß ihre
               Plattform (Nutzerbefund 7.8.26: „ich komme auf den
               falschen Bereich, es erscheint nicht die angeklickte
               Petition"). openPetitionInApp setzt state.openPetitionUrl;
               der Zeichner zieht die Petition damit an den Listenanfang
               — sonst läge sie womöglich hinter dem LIST_MAX-Deckel —,
               klappt sie auf und rollt hin, notfalls sogar in einem
               Bottom-Akkordion. */
            onTap: function () { openPetitionInApp(e.plat, e.r.url); }
          };
        }));
        if (!hero) { mzBox.remove(); return; }
        mzBox.classList.remove("mz-herobox--ph");
        mzBox.appendChild(el('<div class="mz-sechead">' +
          esc(T("liste.heroTitle", "Aktuelle Petitionen")) + "</div>"));
        mzBox.appendChild(hero);
      });
    }

    /* NUR MAGAZIN (7.8.26, Nutzerwunsch): EIN durchgehendes Bento-Raster
       statt der Akkordeon-Gruppen — keine Trennung Favoriten/Deutsch/
       Englisch/künftige. Favoriten stehen vorn, laufen über beide Spalten
       und tragen Stern + eigenen Pfeil; alle übrigen Kacheln tragen nur
       die Kreisflagge ihrer Sprache (die Information der früheren
       Gruppenköpfe wandert damit an die Kachel). Nur horizontal gespannt:
       vertikales Spannen bräuchte wieder feste Zeilenhöhen, die Magazin
       3.0 bewusst abgeschafft hat (Text lief hinein). Danach return —
       der Akkordeon-Pfad darunter bleibt für Relief wörtlich
       unverändert. */
    if (state.prefs.layout === "magazin") {
      var grid = el('<div class="mz-platgrid acc-body--plats"></div>');
      live.filter(function (p) { return isFav(p.key); })
        .forEach(function (p) {
          var favCard = platCard(p, "plat--wide plat--fav");
          favCard.appendChild(el('<span class="plat__favstar">' +
            '<i class="fa-solid fa-star"></i></span>'));
          grid.appendChild(favCard);
        });
      live.filter(function (p) { return !isFav(p.key); })
        .forEach(function (p) {
          var normCard = platCard(p, "");
          normCard.appendChild(el('<span class="plat__flag">' +
            langInfo(p.language || "de").flag + "</span>"));
          grid.appendChild(normCard);
        });
      content.appendChild(grid);
      content.appendChild(supportSection());
      content.appendChild(legalSection());
      return;
    }

    // Gruppen aufbauen: (1) Favoriten zuerst, (2) danach nach Sprache.
    var groupDefs = [];
    var favs = live.filter(function (p) { return isFav(p.key); });
    if (favs.length) groupDefs.push({ key: "__fav", label: "Favoriten", plats: favs });
    /* Die Erklärung, wie man einen Favoriten setzt, stand früher hier auf der
       Hauptliste. Sie steht jetzt in den Einstellungen direkt über der
       Plattform-Liste – also dort, wo die Sterne tatsächlich sind – und ist
       wegklickbar (siehe renderEinstellungen). */

    var rest = live.filter(function (p) { return !isFav(p.key); });
    var groups = {};
    rest.forEach(function (p) {
      var c = p.language || "de";
      (groups[c] = groups[c] || []).push(p);
    });
    Object.keys(groups).sort(function (a, b) {
      return langRank(a) - langRank(b) || a.localeCompare(b);
    }).forEach(function (code) {
      groupDefs.push({ key: code, label: langInfo(code).name + "sprachige Plattformen",
                       plats: groups[code] });
    });

    // Exklusiv: immer genau eine Gruppe offen. Ist die gemerkte Gruppe weg,
    // die erste öffnen.
    var keys = groupDefs.map(function (g) { return g.key; });
    if (keys.indexOf(state.openGroup) < 0) state.openGroup = keys[0] || null;

    var groupEls = [];   // {key, el} – zum gegenseitigen Auf-/Zuklappen
    groupDefs.forEach(function (g) {
      content.appendChild(groupAccordion(g.key, g.label, g.plats, groupEls));
    });

    // Farblich abgetrennter Unterstützungs-Bereich ganz unten.
    content.appendChild(supportSection());
    // Rechtliches darunter: Impressum muss auffindbar sein, nicht versteckt.
    content.appendChild(legalSection());
  }

  // Unterstützungs-Bereich (Hauptseite unten): Intro + vier Akkordions.
  /* Vom Nutzer am 2026-07-28 bestätigt: Schreibweise mit „t" wie der App-Name.
     Die Domain war zu dem Zeitpunkt noch nicht registriert (RDAP/DNS geprüft) –
     vor der Veröffentlichung muss das Postfach also wirklich existieren. */
  var SUPPORT_MAIL = "mail@petitionsmanager.app";
  var GITHUB_URL = "https://github.com/PetitionsManager/petitionsmanager";
  var SUPPORT_DONATE = "https://liberapay.com/Timeras/donate";
  /* Aufnahmekodex für Petitionsplattformen.
     ENTWURF – vom Nutzer am 2026-07-28 beauftragt, aber juristisch NICHT
     geprüft. Der Text ist eine Selbstverpflichtung, kein Rechtstext: er
     beschreibt, wonach entschieden wird, und macht die Ausschlussgründe
     benennbar. Ob er im konkreten Fall haftungsrechtlich trägt, kann nur eine
     Anwältin oder ein Anwalt beurteilen – vor der Veröffentlichung prüfen
     lassen. Bewusst KEINE Paragrafen zitiert: eine erfundene oder falsch
     wiedergegebene Fundstelle wäre schlimmer als keine.
     Steht hier im Code statt in texts.js, weil texts.js kurze Beschriftungen
     hält; dieser Block ist ein zusammenhängender Text, der als Ganzes
     redigiert wird. */
  var KODEX_HTML =
    '<div class="kodex">' +
      '<div class="kodex__grp">' +
        '<div class="kodex__h"><i class="fa-solid fa-circle-check"></i>' +
        " Was eine Plattform mitbringen muss</div><ul class=\"kodex__list\">" +
          "<li>Sie macht öffentlich, wer sie betreibt – Impressum oder eine " +
            "gleichwertige Angabe.</li>" +
          "<li>Ihre Petitionen sind ohne Konto lesbar.</li>" +
          "<li>Sie erlaubt automatisiertes Auslesen. Sperren in der " +
            "robots.txt und Botschutz halten wir ein; wir umgehen sie " +
            "nicht.</li>" +
          "<li>Sie steht grundsätzlich allen offen und ist nicht die Bühne " +
            "einer einzelnen Kampagne.</li>" +
          "<li>Sie legt nachvollziehbar dar, wie Unterschriften gezählt " +
            "werden.</li>" +
        "</ul></div>" +
      '<div class="kodex__grp kodex__grp--stop">' +
        '<div class="kodex__h"><i class="fa-solid fa-ban"></i>' +
        " Was zum Ausschluss führt</div>" +
        "<p>Ohne Abwägung ausgeschlossen sind Plattformen, die Inhalte " +
          "verbreiten oder dulden, die</p><ul class=\"kodex__list\">" +
          "<li>Menschen wegen Herkunft, Hautfarbe, Staatsangehörigkeit, " +
            "Religion, Geschlecht, sexueller Orientierung, Behinderung, " +
            "Alter oder sozialer Stellung herabwürdigen;</li>" +
          "<li>zu Hass, Gewalt oder Ausgrenzung gegen Personen oder Gruppen " +
            "aufrufen;</li>" +
          "<li>den Holocaust oder andere Völkermorde leugnen oder " +
            "verharmlosen;</li>" +
          "<li>verfassungswidrige oder verbotene Kennzeichen verwenden;</li>" +
          "<li>Menschen gezielt einschüchtern, bloßstellen oder zur " +
            "Zielscheibe machen.</li>" +
        "</ul>" +
        "<p>Das gilt unabhängig davon, ob die Plattform solche Inhalte selbst " +
          "veröffentlicht oder sie nur stehen lässt.</p></div>" +
      '<div class="kodex__grp">' +
        '<div class="kodex__h"><i class="fa-solid fa-gavel"></i>' +
        " Wie wir entscheiden</div><ul class=\"kodex__list\">" +
          "<li>Jeden Vorschlag prüfen wir von Hand, bevor eine Plattform " +
            "aufgenommen wird.</li>" +
          "<li>Bei einem begründeten Hinweis prüfen wir erneut – und nehmen " +
            "eine Plattform auch wieder heraus.</li>" +
          "<li>Einzelne Petitionen, die gegen diesen Kodex verstoßen, " +
            "entfernen wir aus der App, auch wenn die Plattform bleibt.</li>" +
        "</ul></div>" +
      '<p class="kodex__note"><i class="fa-solid fa-circle-info"></i> ' +
        "<span><strong>Was die Aufnahme nicht bedeutet:</strong> " +
        "PetitionsManager zeigt, was auf den Plattformen öffentlich steht. " +
        "Die Aufnahme einer Plattform ist keine Empfehlung und keine " +
        "Zustimmung zu einzelnen Petitionen. Für den Inhalt einer Petition " +
        "stehen ihre Urheberinnen und Urheber sowie die jeweilige Plattform " +
        "ein. Wir prüfen nicht jede einzelne Petition im Voraus – sag uns " +
        "Bescheid, was dir auffällt.</span></p>" +
    "</div>";

  /* ---- Rechtliches -------------------------------------------------------
     ENTWURF – am 2026-07-29 vom Nutzer beauftragt, juristisch NICHT geprüft.
     Wie beim Kodex bewusst OHNE Paragrafenzitate: eine falsch wiedergegebene
     Fundstelle wäre schlimmer als keine. Die üblichen Angaben stehen
     vollständig da, nur die Vorschrift ist nicht benannt.

     WARUM EIN EIGENER ABSCHNITT und kein weiteres Akkordion in
     supportSection(): ein Impressum muss auffindbar beschriftet sein. Unter
     der Überschrift „Unterstütze PetitionsManager" würde es niemand suchen.
     Die CSS-Klassen der Support-Familie werden mitbenutzt (gleiche Optik),
     nur mit eigenem Wurzel-Modifikator .support--legal.

     NOCH OFFEN: eine Datenschutzerklärung. Sie fehlt hier absichtlich, statt
     etwas Erfundenes hinzuschreiben. Zwei Tatsachen müssen darin stehen und
     sind belegt: die App holt ihre Daten von GitHub Pages (dort wird die
     IP-Adresse sichtbar), und die Bilder sind bei den Plattformen EINGEBETTET
     – beim Anzeigen einer Liste sieht also jeder der bis zu 20 Bild-Hosts die
     IP des Geräts. */
  var RECHTE_STAND = {
    /* Stand der Erlaubnis-Anfrage je Plattform. Der Nutzer kontaktiert die
       Betreiber im Zuge der Veröffentlichung und trägt die Antworten hier
       ein — EINE Stelle, eine Zeile je Antwort.
         asked / answer : ISO-Datum oder null
         result         : "erlaubt" | "eingeschraenkt" | "abgelehnt" | null
       null heißt „nicht angefragt". Hier wird nichts vermutet: solange keine
       Antwort vorliegt, sagt die App genau das. */
    weact:        { asked: null, answer: null, result: null },
    openpetition: { asked: null, answer: null, result: null },
    changeorg:    { asked: null, answer: null, result: null },
    innnit:       { asked: null, answer: null, result: null },
    avaaz:        { asked: null, answer: null, result: null },
    bundestag:    { asked: null, answer: null, result: null },
    europarl:     { asked: null, answer: null, result: null },
    wemove:       { asked: null, answer: null, result: null },
    eko:          { asked: null, answer: null, result: null },
    foodwatch:    { asked: null, answer: null, result: null },
    threefifty:   { asked: null, answer: null, result: null }
  };

  function dmy(iso) {
    if (!iso) return "";
    var t = String(iso).slice(0, 10).split("-");
    return t.length === 3 ? t[2] + "." + t[1] + "." + t[0] : String(iso);
  }

  function rechteStandText(r) {
    if (!r || !r.asked) return "ungeklärt – noch nicht angefragt";
    if (!r.answer) return "angefragt am " + dmy(r.asked) + " – noch keine Antwort";
    var wort = { erlaubt: "Nutzung zugesagt",
                 eingeschraenkt: "eingeschränkt zugesagt",
                 abgelehnt: "abgelehnt" };
    return (wort[r.result] || "Antwort erhalten") + " am " + dmy(r.answer);
  }

  /* Tabelle je Plattform. Bewusst gestapelt und nicht als <table>: bei rund
     380 px Breite läuft eine fünfspaltige Tabelle über den Rand, und ein
     querscrollender Rechtstext wird nicht gelesen. */
  /* ---- Steckbrief einer Plattform ------------------------------------------
     EINE Liste für ALLE Plattformen (Nutzerwunsch 6.8.2026: „schreibe bei
     allen Plattformen den gleichen Steckbrief … so kann man später den
     Steckbrief erweitern und das gilt dann für alle Plattformen"). Wer hier
     eine Zeile ergänzt, ergänzt sie damit überall — genau das war der Wunsch.

     ⚠️ Fehlt ein Wert, steht „–", statt dass die Zeile verschwindet. Vorher
     filterte der Code leere Werte heraus; dadurch hatte jede Plattform einen
     anders langen Steckbrief, und beim Blättern verrutschten die Zeilen
     gegeneinander. Eine leere Angabe ist außerdem selbst eine Information
     („nicht bekannt"), eine fehlende Zeile ist nur eine Lücke, die man für ein
     Versehen hält. */
  var STECKBRIEF = [
    { feld: "operator",  label: "Träger" },
    { feld: "seat",      label: "Sitz" },
    { feld: "founded",   label: "Gegründet" },
    { feld: "financing", label: "Finanzierung" },
    { feld: "impressum", label: "Impressum", alsLink: true },
    /* Nutzungsbedingungen/AGB — nur der LINK, keine Auswertung: was darin
       steht, liest der Nutzer selbst. Eine aus AGB-Fragmenten abgeleitete
       Rechtslage wäre schlechter als der Verweis auf die Quelle.
       Sieben der elf haben welche, vier nachweislich NICHT (7.8.2026 geprüft):
       Ekō führt 93 Seiten in seiner Sitemap und keine davon ist eine;
       WeMove und foodwatch verlinken von ihren eigenen Rechtsseiten nur
       Impressum und Datenschutz; beim Europäischen Parlament ist der
       „Rechtliche Hinweis" das Äquivalent und steht schon in der Zeile
       darüber. Dort erscheint „–" — das heißt „gibt es nicht", nicht „noch
       nicht nachgesehen". */
    { feld: "agb", label: "Nutzungsbedingungen", alsLink: true }
  ];

  // Aus einer Adresse den Gastgebernamen — als Linktext lesbarer als die
  // vollständige URL, die in der schmalen Spalte ohnehin umbräche.
  function kurzUrl(u) {
    var m = String(u).match(/^https?:\/\/([^/]+)/i);
    return m ? m[1].replace(/^www\./, "") : String(u);
  }

  /* Baut die Steckbrief-Liste. Das kleine Symbol hinter jeder Angabe führt auf
     die Seite, auf der sie sich nachprüfen lässt (platforms.js →
     about.quelle). Einzelne Zeilen dürfen später eine eigene Quelle bekommen
     (about.quellen[feld]) — ohne dass sich hier etwas ändern muss.
     Zeilen, die selbst schon ein Link sind (Impressum), bekommen KEIN
     zusätzliches Quellsymbol: der Wert ist dort die Quelle. */
  function steckbriefHtml(about) {
    var quellen = about.quellen || {};
    return '<dl class="pabout__facts">' + STECKBRIEF.map(function (z) {
      var wert = about[z.feld];
      var leer = wert === null || wert === undefined || wert === "";
      var inhalt, src = "";
      if (leer) {
        inhalt = '<span class="fact-leer" title="nicht bekannt">–</span>';
      } else if (z.alsLink) {
        inhalt = '<a href="' + esc(String(wert)) + '" target="_blank" ' +
          'rel="noopener">' + esc(kurzUrl(wert)) +
          ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>';
      } else {
        inhalt = esc(String(wert));
        var q = quellen[z.feld] || about.quelle;
        if (q) src = ' <a class="fact-src" href="' + esc(q) +
          '" target="_blank" rel="noopener" title="Quelle für diese Angabe" ' +
          'aria-label="Quelle für ' + esc(z.label) + '">' +
          '<i class="fa-solid fa-arrow-up-right-from-square"></i></a>';
      }
      return "<dt>" + esc(z.label) + "</dt><dd>" + inhalt + src + "</dd>";
    }).join("") + "</dl>";
  }

  function rechtePlattformen() {
    var plats = (state.manifest && state.manifest.platforms)
      ? livePlatforms() : [];
    if (!plats.length) return "";
    return plats.map(function (p) {
      var about = platInfo(p.key).about || {};
      var zeilen = [
        ["Betreiber", about.operator || "nicht bekannt"],
        ["Sitz", about.seat || "nicht bekannt"],
        ["Nutzungsrecht", rechteStandText(RECHTE_STAND[p.key])]
      ].map(function (z) {
        return "<dt>" + esc(z[0]) + "</dt><dd>" + esc(z[1]) + "</dd>";
      }).join("");
      /* Impressum aus dem eigenen Feld about.impressum statt wie früher über
         eine Regex auf Beschriftung und Adresse. Die Regex traf mal zu viel,
         mal zu wenig — „Impressum & Kontakt" ja, „Richtlinien" nein, obwohl
         beides die Rechtsangaben sind —, und was sie nicht traf, fehlte
         wortlos. Der Nutzer hat genau das am 6.8.2026 bemerkt.
         null heißt: es GIBT keine — Change.org, Avaaz, Ekō und 350.org sitzen
         in den USA und kennen kein Impressum nach deutschem Vorbild. Das steht
         jetzt ausdrücklich da, statt eine Lücke zu lassen. */
      var links = about.impressum
        ? '<a href="' + esc(about.impressum) + '" target="_blank" ' +
          'rel="noopener">Impressum</a>'
        : '<span class="legal__none">Kein Impressum – Betreiber außerhalb ' +
          "des deutschen Rechtsraums</span>";
      links += (about.links || []).filter(function (l) {
        return /datenschutz|privacy/i.test(l.label + l.url);
      }).map(function (l) {
        return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
               esc(l.label) + "</a>";
      }).join("");
      return '<div class="legal__plat"><div class="legal__pname">' +
        esc(p.name || p.key) + "</div>" +
        '<dl class="legal__dl">' + zeilen + "</dl>" +
        (links ? '<div class="legal__links">' + links + "</div>" : "") +
        "</div>";
    }).join("");
  }

  function rechteHtml() {
    return "" +
      '<p class="legal__lead">Die Petitionen in dieser App stammen von ' +
      "fremden Plattformen. Das Urheberrecht an ihren Inhalten – Titel, " +
      "Aufruf-Texte, Bilder – liegt bei den jeweiligen Urheberinnen und " +
      "Urhebern beziehungsweise bei der Plattform. PetitionsManager " +
      "erwirbt daran keine Rechte und räumt keine ein.</p>" +
      '<p class="legal__lead">Was davon kopiert wird und was nicht: Titel, ' +
      "Kurzfassung, Aufruf-Text, Unterschriftenzahl und Datum werden " +
      "abgerufen und in der App gespeichert. Die <strong>Bilder werden " +
      "nicht kopiert</strong>, sondern von den Servern der Plattformen " +
      "eingebunden – sie bleiben dort liegen und werden beim Anzeigen von " +
      "dort geholt.</p>" +
      '<p class="legal__lead"><strong>Das Nutzungsrecht ist ungeklärt.</strong> ' +
      "Die Inhalte sind öffentlich zugänglich, und diese App ist " +
      "nicht-kommerziell und ihr Quellcode offen – eine Erlaubnis der " +
      "Plattformen ist damit aber nicht gegeben. Im Zuge der " +
      "Veröffentlichung werden alle Betreiber angefragt; die Tabelle zeigt " +
      "je Plattform, wie weit das ist.</p>" +
      '<div class="legal__tbl">' + rechtePlattformen() + "</div>" +
      /* „– wir nehmen sie heraus." ist auf Wunsch des Nutzers (6.8.2026)
         gestrichen: der Satz gab eine Zusage ab, bevor überhaupt jemand
         geprüft hat, worum es geht. Stattdessen der Weg dorthin — ein Knopf,
         der schreibt, statt eines Versprechens. */
      '<p class="legal__note">Wenn Sie für eine der genannten Plattformen ' +
      "sprechen und mit der Darstellung Ihrer Inhalte nicht einverstanden " +
      "sind, schreiben Sie uns.</p>" +
      '<div class="legal__btns"><a class="support__btn" href="mailto:' +
      SUPPORT_MAIL + "?subject=" +
      encodeURIComponent("[PetitionsManager] Rechte an den Inhalten") +
      '"><i class="fa-solid fa-envelope"></i> Kontakt aufnehmen</a></div>';
  }

  var IMPRESSUM_HTML =
    '<dl class="legal__dl">' +
      "<dt>Anbieter</dt><dd>Matthias Drees</dd>" +
      "<dt>Anschrift</dt><dd>Tempelhof 3<br>74594 Kreßberg<br>Deutschland</dd>" +
      '<dt>Kontakt</dt><dd><a href="mailto:' + SUPPORT_MAIL + '">' +
        SUPPORT_MAIL + "</a></dd>" +
      "<dt>Verantwortlich für den Inhalt</dt><dd>Matthias Drees</dd>" +
    "</dl>" +
    '<p class="legal__note">PetitionsManager ist ein privates, ' +
    'nicht-kommerzielles Projekt. Der Quellcode ist offen: ' +
    '<a href="' + GITHUB_URL + '" target="_blank" rel="noopener">' +
    "GitHub</a>.</p>";

  // Rechtlicher Bereich: Impressum und Rechte an den Inhalten.
  function legalSection() {
    var sec = el('<section class="support support--legal">' +
      '<div class="support__title"><i class="fa-solid fa-scale-balanced">' +
      "</i> Rechtliches</div>" +
      '<div class="support__acc"></div></section>');
    var acc = sec.querySelector(".support__acc");
    [["fa-address-card", "Impressum",
      "Wer diese App anbietet und wie er erreichbar ist.", IMPRESSUM_HTML],
     ["fa-copyright", "Rechte an den Inhalten",
      "Wem die Petitionstexte und Bilder gehören und was mit den Plattformen " +
      "abgestimmt ist.", rechteHtml()]
    ].forEach(function (it) {
      var item = el('<div class="support__item">' +
        '<button class="support__head" type="button"><span>' +
        '<i class="fa-solid ' + it[0] + '"></i> ' + esc(it[1]) + "</span>" +
        '<i class="fa-solid fa-chevron-down"></i></button>' +
        '<div class="support__body"><p>' + esc(it[2]) + "</p>" +
        it[3] + "</div></div>");
      item.querySelector(".support__head").addEventListener("click", function () {
        item.classList.toggle("open");
      });
      acc.appendChild(item);
    });
    return sec;
  }

  function supportSection() {
    var sec = el('<section class="support">' +
      '<div class="support__title"><i class="fa-solid fa-hand-holding-heart">' +
      "</i> Unterstütze PetitionsManager.</div>" +
      '<div class="support__acc"></div></section>');
    var acc = sec.querySelector(".support__acc");

    /* Der Kodex steht bewusst ganz oben: er beantwortet die Frage, nach
       welchen Regeln überhaupt entschieden wird — wer eine Plattform
       vorschlägt, soll sie vorher gelesen haben, nicht hinterher. */
    var items = [
      ["fa-scale-balanced", "Wen wir aufnehmen – unser Kodex",
       "Nach diesen Regeln entscheiden wir, welche Petitionsplattform in die " +
       "App kommt und welche nicht.",
       "Verstoß melden",
       { mailto: "Verstoß gegen den Kodex", html: KODEX_HTML }],
      ["fa-layer-group", "Fehlt eine Plattform?",
       "Kennst du eine Petitionsplattform, die hier noch fehlt? Sag uns " +
       "Bescheid – wir prüfen die Aufnahme.",
       "Plattform vorschlagen",
       { mailto: "Plattform-Vorschlag" }],
      ["fa-file-circle-plus", "Fehlt eine Petition?",
       "Eine wichtige Petition wird nicht angezeigt? Melde sie uns am besten " +
       "mit Link.",
       "Petition melden",
       { mailto: "Fehlende Petition" }],
      ["fa-hands-helping", "Möchtest du helfen?",
       "PetitionsManager ist ein freies Projekt. Hilf mit – mit Feedback, " +
       "Ideen, Übersetzungen oder finanzieller Unterstützung über Liberapay.",
       "Mithelfen",
       { mailto: "Ich möchte unterstützen", donate: true }],
      ["fa-share-nodes", "Möchtest du die App teilen?",
       "Teile PetitionsManager mit anderen, die Petitionen mehrerer " +
       "Plattformen im Blick behalten wollen.",
       "App teilen",
       { share: true }]
    ];

    items.forEach(function (it) {
      var item = el('<div class="support__item">' +
        '<button class="support__head" type="button"><span>' +
        '<i class="fa-solid ' + it[0] + '"></i> ' + esc(it[1]) + "</span>" +
        '<i class="fa-solid fa-chevron-down"></i></button>' +
        '<div class="support__body"><p>' + esc(it[2]) + "</p>" +
        (it[4].html || "") + "</div></div>");
      item.querySelector(".support__head").addEventListener("click", function () {
        item.classList.toggle("open");
      });
      var body = item.querySelector(".support__body");
      var btns = el('<div class="support__btns"></div>');
      var opt = it[4];
      // Spenden-Button (hervorgehoben) zuerst, falls vorgesehen.
      if (opt.donate) {
        btns.appendChild(el('<a class="support__btn support__btn--donate" href="' +
          esc(SUPPORT_DONATE) + '" target="_blank" rel="noopener">' +
          '<i class="fa-solid fa-heart"></i> Finanziell unterstützen</a>'));
      }
      if (opt.share) {
        var sBtn = el('<button class="support__btn" type="button">' +
          '<i class="fa-solid fa-share-nodes"></i> ' + esc(it[3]) + "</button>");
        sBtn.addEventListener("click", function () { shareApp(sBtn); });
        btns.appendChild(sBtn);
      } else {
        var href = "mailto:" + SUPPORT_MAIL + "?subject=" +
          encodeURIComponent("[PetitionsManager] " + opt.mailto);
        var ghost = opt.donate ? " support__btn--ghost" : "";
        btns.appendChild(el('<a class="support__btn' + ghost + '" href="' +
          href + '"><i class="fa-solid fa-envelope"></i> ' + esc(it[3]) + "</a>"));
      }
      body.appendChild(btns);
      acc.appendChild(item);
    });
    return sec;
  }

  // App teilen: native Share-Sheet, sonst Link in die Zwischenablage.
  function shareApp(btn) {
    var data = {
      title: "PetitionsManager",
      text: "Behalte Petitionen mehrerer Plattformen im Blick.",
      url: location.href
    };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    var done = function () {
      var old = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Link kopiert';
      setTimeout(function () { btn.innerHTML = old; }, 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(location.href).then(done, function () {
        window.prompt("Link kopieren:", location.href);
      });
    else window.prompt("Link kopieren:", location.href);
  }

  // Aufklappbares Gruppen-Akkordion (Favoriten oder Sprache) mit Karten.
  // Exklusiv: Öffnen einer Gruppe schließt die anderen (siehe groupEls).
  function groupAccordion(openKey, label, plats, groupEls) {
    var open = state.openGroup === openKey;
    var acc = el('<section class="accordion langgroup' +
      (open ? " open" : "") + '"></section>');
    // Vorne ein Icon fester Breite: Stern (Favoriten) bzw. Länder-Flagge.
    var ic = openKey === "__fav"
      ? '<span class="grp-ic"><i class="fa-solid fa-star"></i></span>'
      : '<span class="grp-ic">' + langInfo(openKey).flag + "</span>";
    var head = el('<button class="acc-head"><span class="acc-title">' + ic +
      esc(label) + '<span class="acc-count">' + plats.length + '</span></span>' +
      '<i class="fa-solid fa-chevron-down acc-chev"></i></button>');
    head.addEventListener("click", function () {
      var nowOpen = !acc.classList.contains("open");
      groupEls.forEach(function (g) {          // andere Gruppen schließen
        if (g.el !== acc) g.el.classList.remove("open");
      });
      acc.classList.toggle("open", nowOpen);
      state.openGroup = nowOpen ? openKey : null;
    });
    // Zusatzklasse, damit layouts.css genau diese Liste als Kachelraster
    // setzen kann. Ohne sie träfe eine Regel auf .acc-body auch die
    // Schalterlisten in den Einstellungen.
    var body = el('<div class="acc-body acc-body--plats"></div>');
    // Größenrang für das Bento-Raster im Layout „Magazin": alle Kacheln sind
    // gleich groß, nur die größte Plattform der Gruppe belegt zwei Spalten
    // und zwei Zeilen, die zweitgrößte zwei Spalten. Der Rang steckt in einer
    // Klasse, NICHT in der Reihenfolge – die Liste bleibt alphabetisch. In
    // den anderen beiden Layouts hängt an den Klassen keine Regel.
    var rank = plats.slice().sort(function (a, b) {
      return (b.online || 0) - (a.online || 0);
    });
    // Ein oder zwei Plattformen ergeben kein Raster: dann laufen alle über die
    // volle Breite, sonst stünde eine halbe Kachel im Leeren (Favoriten!).
    var xlKey   = plats.length > 2 ? rank[0].key : null;
    var wideKey = plats.length > 3 ? rank[1].key : null;
    plats.forEach(function (p) {
      body.appendChild(platCard(p,
        plats.length <= 2      ? "plat--wide"
        : p.key === xlKey      ? "plat--xl"
        : p.key === wideKey    ? "plat--wide" : ""));
    });
    acc.appendChild(head); acc.appendChild(body);
    groupEls.push({ key: openKey, el: acc });
    return acc;
  }

  function platCard(p, size) {
    var info = langInfo(p.language || "de");
    var newN = p["new"] || 0;
    var newLabel = newN > 0
      ? '<span class="plat__new">+' + nf.format(newN) + " neu</span>" : "";
    var brand = platColor(p.key);
    /* Die Kachel gibt KEINE eigene Schriftfarbe mehr vor: --on-brand kommt
       einheitlich aus layouts.css und ist überall Weiß (Nutzerentscheidung
       2026-07-28, „alle Schriften/Logos weiß").
       Vorher rechnete platInk() je Markenfarbe die kontraststärkere Seite aus.
       Das ist damit hinfällig — und es kostet etwas: auf drei hellen Marken
       hält Weiß nicht einmal die 3:1 für Großtext (foodwatch #f7a600 → 2,02,
       openPetition #29b0cc → 2,57, innn.it #fc691f → 2,92). Wer das zurück
       will, holt platInk aus der Versionsgeschichte (Commit ae4ab06). */
    var tagline = platInfo(p.key).tagline;
    // Echtes Plattform-Logo (platforms.js → logoFile). Liegt als CSS-Maske vor
    // der Textfarbe der Kachel, ist also immer einfarbig im richtigen Ton –
    // ein <img> brächte seine eigene Farbe mit. Standardmäßig ausgeblendet;
    // nur das Bento-Raster zeigt es (layouts.css). Für elf Plattformen gibt es
    // acht Dateien; wo eine fehlt, bleibt es beim Monogramm.
    /* Nur EIN Logo-Element. Früher standen hier zwei: das Monogramm und
       daneben ein zweites Element für die echte Marke im Bento. Seit
       platLogo() selbst die Maske ausgibt, positioniert layouts.css einfach
       dieses eine Element. */
    var card = el(
      '<button class="plat' + (size ? " " + size : "") + '"' +
        (brand ? ' style="--brand:' + esc(brand) + '"' : "") + ">" +
        platLogo(p.key, p.name) +
        '<span class="plat__body">' +
          /* Keine Flagge an der einzelnen Kachel: die Liste ist ohnehin nach
             Sprache gruppiert, und die Gruppenüberschrift trägt sie einmal
             für alle. An jeder Kachel wiederholt, war sie nur Rauschen. */
          '<span class="plat__name">' + esc(p.name) + "</span>" +
          /* Zahl und Einheit getrennt ausgezeichnet: das Magazin setzt die
             Zahl als Bento-Kennzahl gross und die Einheit darunter. In den
             anderen Layouts sind beide Spans ungestylte Inline-Elemente,
             der Textfluss bleibt woertlich derselbe. */
          '<span class="plat__meta"><span class="plat__num">' +
            nf.format(p.online) + '</span><span class="plat__unit"> ' +
            "Petitionen</span>" + newLabel + '</span>' +
          (tagline ? '<span class="plat__tag">' + esc(tagline) + "</span>" : "") +
        '</span>' +
        '<span class="plat__chev">' +
          '<i class="fa-solid fa-arrow-right"></i></span>' +
      '</button>');
    card.addEventListener("click", function () {
      state.platform = p.key; state.search = "";
      state.catFilter = null; state.tagFilter = null;
      state.sort = null; state.gapFilter = null; render();
    });
    return card;
  }

  function platformName(key) {
    var p = state.manifest.platforms.find(function (x) { return x.key === key; });
    return p ? p.name : key;
  }

  // Öffnet eine bestimmte Petition IN DER APP: wechselt in die Ziel-Plattform
  // und klappt die Petition (per URL) nach dem Zeichnen automatisch auf.
  function openPetitionInApp(platKey, url) {
    state.tab = "liste";
    state.cross = null;
    state.platform = platKey;
    state.search = "";
    state.catFilter = null; state.tagFilter = null; state.sort = null;
    state.gapFilter = null;
    state.openPetitionUrl = url;
    render();
  }

  /* Freier Streifen oben: die Kopfleiste steht sticky über dem Inhalt. Wer auf
     die nackte Oberkante eines Elements rollt, schiebt genau diesen Streifen
     darunter. Die Höhe wird GELESEN, nicht angenommen – sie unterscheidet sich
     zwischen den Layouts, und „position" ebenso (nur sticky/fixed verdecken). */
  function stickyOben() {
    var tb = document.querySelector(".topbar");
    if (!tb) return 0;
    var pos = window.getComputedStyle(tb).position;
    if (pos !== "sticky" && pos !== "fixed") return 0;
    return tb.getBoundingClientRect().height;
  }

  /* Rollt ein Element so, dass seine OBERKANTE unter der Kopfleiste steht.
     Ersatz für scrollIntoView({block:"center"}) bei hohen Zielen: eine
     aufgeklappte Petitionskarte misst schnell über 1.400 px (gemessen am
     6.8.2026: 1.419 px bei 812 px Bildhöhe). „center" setzt dann die Mitte der
     KARTE in die Bildmitte – man landet mitten im Beschreibungstext bei den
     Schlagworten, der Titel steht weit über dem Bildrand. Genau das hat der
     Nutzer als „springt zu tief" gemeldet.
     Die Oberkante ist außerdem der stabilere Anker: die Karte wächst nach dem
     Aufklappen weiter (Volltext wird nachgeladen, sizeThumb zieht die Bildhöhe
     über 0,3 s auf das echte Seitenverhältnis). Alles davon passiert UNTERHALB
     der Oberkante und verschiebt sie deshalb nicht – bei „center" wandert das
     Ziel dagegen mit jeder Nachladung weiter.

     ⚠️ Bewusst weiter scrollIntoView und NICHT window.scrollTo({top,behavior}):
     scrollIntoView ist das Mittel, das hier vorher stand und auf dem Gerät des
     Nutzers nachweislich rollt – nur eben an die falsche Stelle. Getauscht wird
     deshalb allein die Zielposition, nicht das Werkzeug. Den von der Kopfleiste
     verdeckten Streifen hält scroll-margin-top frei; der Wert wird aus der
     gemessenen Leistenhöhe gesetzt, weil sie je Layout abweicht. Als Inline-
     Angabe statt CSS-Regel: die Karten werden bei jedem Zeichnen neu gebaut,
     der Wert überlebt also nicht und muss nirgends zurückgenommen werden. */
  function scrollToTop(elm, luft) {
    elm.style.scrollMarginTop =
      (stickyOben() + (luft == null ? 12 : luft)) + "px";
    elm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ⚠️ DERZEIT UNBENUTZT (Stand 7.8.2026). Die einzige Einsatzstelle war die
     Lücken-Meldung im Bedienfeld; sie hat den Sprung gegen einen Filter
     getauscht, weil er dort PRINZIPBEDINGT nicht greifen konnte — gesucht wird
     in der gezeichneten Liste, und die ist auf LIST_MAX (300) gedeckelt,
     während die gesuchten Sätze ans Ende sortiert werden. Bei openPetition
     (1.908) oder Change.org (2.019) lagen sie damit immer dahinter.
     Bewusst STEHENGELASSEN statt gelöscht: die Mechanik ist für andere Ziele
     brauchbar, die sicher in den ersten 300 liegen. Wer sie wiederverwendet,
     prüft zuerst genau das. Dazugehörige CSS-Regeln: .jump, .jump--miss,
     .jump-hit in style.css sowie der Relief-Zweig in layouts.css.

     Sprungmarke: kleiner Knopf, der zu einer Stelle in der Liste rollt und sie
     kurz hervorhebt. `ziel` ist eine FUNKTION, kein Element – die Liste wird
     bei jedem Filter neu gezeichnet, ein beim Bauen gemerktes Element wäre
     danach nicht mehr im Dokument.
     Findet sich nichts, sagt der Knopf das, statt stumm nichts zu tun – ein
     Klick ohne Wirkung wäre als Fehler nicht erkennbar. */
  function jumpBtn(label, ziel) {
    var b = el('<button class="jump" type="button">' +
      '<i class="fa-solid fa-arrow-turn-down"></i>' +
      '<span class="jump__l">' + esc(label) + "</span></button>");
    var lbl = b.querySelector(".jump__l");
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var treffer = ziel();
      if (!treffer) {
        b.classList.add("jump--miss");
        lbl.textContent = "Nicht in der angezeigten Liste";
        setTimeout(function () {
          b.classList.remove("jump--miss"); lbl.textContent = label;
        }, 2400);
        return;
      }
      /* Steht der Knopf in einem Ausklapper, diesen erst schließen: er nimmt
         sonst den halben Bildschirm ein und das Ziel landet trotz „center"
         am Rand. Synchron, also VOR dem Rollen wirksam. */
      var auf = b.closest("details[open]");
      if (auf) auf.open = false;
      treffer.scrollIntoView({ behavior: "smooth", block: "center" });
      treffer.classList.add("jump-hit");
      setTimeout(function () { treffer.classList.remove("jump-hit"); }, 1800);
    });
    return b;
  }

  /* ---- Vorschlagsliste beim Tippen (Autocomplete) ---------------------------
     Eine Mechanik für alle drei Suchfelder der App (Nutzerwunsch 3.8.26):
     Hauptseite, Plattformseite und unterzeichnete Petitionen. Was
     vorgeschlagen wird, steckt allein in `quelle` – einer Funktion, die das
     kleingeschriebene Suchwort bekommt und [{t, sub, pick}] liefert.

     KEIN <datalist>: das wäre die eingebaute Lösung, lässt sich aber nicht
     gestalten, zeigt auf Android nur den nackten Text und trägt keine zweite
     Zeile. Die Plattform gehört aber dazu – bei gleichlautenden Titeln wüsste
     man sonst nicht, welche Petition gemeint ist.

     Zurück kommt {refresh, close}: refresh() für Quellen, die erst nachladen
     (Hauptseite), close() fürs Aufräumen von außen. */
  var AC_MIN = 2;      // ab so vielen Zeichen wird vorgeschlagen
  var AC_MAX = 8;      // so viele Vorschläge stehen höchstens da
  var AC_POOL = 400;   // so viele Treffer werden zum Sortieren gesammelt
  var acLfd = 0;       // laufende Nummer für eindeutige Element-Kennungen
  function attachAutocomplete(input, quelle) {
    var wrap = input.parentNode;
    var leer = { refresh: function () {}, close: function () {} };
    if (!wrap) return leer;
    var kennung = "ac" + (++acLfd);
    var box = el('<div class="ac" role="listbox" id="' + kennung + '"></div>');
    box.hidden = true;
    wrap.appendChild(box);
    var eintraege = [], aktiv = -1;

    /* role="combobox" ohne die Zustandsangaben wäre eine Falschauskunft: ein
       Screenreader kündigte damit eine Liste an, die es die meiste Zeit gar
       nicht gibt. Deshalb vollständig – und aria-expanded wird bei jedem
       Öffnen und Schließen mitgeführt. */
    input.setAttribute("autocomplete", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", kennung);

    function zu() {
      box.hidden = true; box.innerHTML = ""; eintraege = []; aktiv = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    function aktivZeigen() {
      var kinder = box.querySelectorAll(".ac__i");
      for (var i = 0; i < kinder.length; i++) {
        var an = (i === aktiv);
        kinder[i].classList.toggle("is-on", an);
        kinder[i].setAttribute("aria-selected", an ? "true" : "false");
      }
      if (aktiv > -1) {
        input.setAttribute("aria-activedescendant", kennung + "-" + aktiv);
        kinder[aktiv].scrollIntoView({ block: "nearest" });
      } else input.removeAttribute("aria-activedescendant");
    }
    function waehlen(i) {
      var e = eintraege[i];
      zu();
      if (e && e.pick) e.pick();
    }
    function zeichnen() {
      var q = input.value.trim().toLowerCase();
      if (q.length < AC_MIN) { zu(); return; }
      eintraege = quelle(q).slice(0, AC_MAX);
      aktiv = -1;
      if (!eintraege.length) { zu(); return; }
      box.innerHTML = eintraege.map(function (e, i) {
        return '<div class="ac__i" role="option" aria-selected="false" id="' +
          kennung + "-" + i + '" data-i="' + i + '">' +
          '<span class="ac__t">' + highlight(e.t, q) + "</span>" +
          (e.sub ? '<span class="ac__s">' + esc(e.sub) + "</span>" : "") +
          "</div>";
      }).join("");
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    input.addEventListener("input", zeichnen);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { zu(); return; }
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        /* preventDefault ist hier Pflicht und nicht Kosmetik: ohne ihn springt
           der Schreibzeiger im Feld an Anfang oder Ende, während die Auswahl
           wandert. -1 ist ein gültiger Zustand (nichts ausgewählt) – so kommt
           man aus der Liste auch wieder heraus, ohne sie zu schließen. */
        e.preventDefault();
        aktiv += (e.key === "ArrowDown" ? 1 : -1);
        if (aktiv < -1) aktiv = eintraege.length - 1;
        if (aktiv >= eintraege.length) aktiv = -1;
        aktivZeigen();
      } else if (e.key === "Enter" && aktiv > -1) {
        e.preventDefault(); waehlen(aktiv);
      }
    });
    /* pointerdown abfangen, damit das Feld den Fokus NICHT verliert: sonst
       schlösse blur die Liste, bevor der Klick beim Eintrag ankommt – der
       klassische Fehler bei selbstgebauten Vorschlagslisten. */
    box.addEventListener("pointerdown", function (e) { e.preventDefault(); });
    box.addEventListener("click", function (e) {
      var t = e.target.closest(".ac__i");
      if (t) waehlen(parseInt(t.getAttribute("data-i"), 10));
    });
    input.addEventListener("blur", function () { setTimeout(zu, 150); });

    return {
      refresh: function () { if (document.activeElement === input) zeichnen(); },
      close: zu
    };
  }

  /* Titel-Treffer für die Vorschlagsliste, quer über die übergebenen
     Plattformen. Titel, die MIT dem Suchwort beginnen, stehen vorn: wer
     „Nestlé" tippt, will nicht zuerst einen Titel sehen, in dem das Wort
     hinten steht. Bei gleicher Fundstelle entscheidet das Alphabet, damit die
     Reihenfolge zwischen zwei Tastendrücken stabil bleibt.
     Die Sammlung bricht bei AC_POOL ab. Bei zwei Zeichen passt fast jeder
     Titel, und für acht Vorschläge lohnt es nicht, 17.000 Treffer zu
     sortieren — die Grenze liegt bewusst weit über AC_MAX, damit die Auswahl
     trotzdem aus einem breiten Feld kommt. */
  function sucheVorschlaege(q, keys) {
    var pool = [];
    for (var k = 0; k < keys.length && pool.length < AC_POOL; k++) {
      var arr = state.dataCache[keys[k]];
      if (!arr) continue;
      for (var i = 0; i < arr.length && pool.length < AC_POOL; i++) {
        var t = arr[i].title || "";
        var p = t.toLowerCase().indexOf(q);
        if (p > -1) pool.push({ t: t, pos: p, key: keys[k], url: arr[i].url });
      }
    }
    pool.sort(function (a, b) {
      return (a.pos - b.pos) || a.t.localeCompare(b.t);
    });
    return pool.map(function (e) {
      return { t: e.t, sub: platformName(e.key),
               pick: function () { openPetitionInApp(e.key, e.url); } };
    });
  }

  /* Höhe des aufgeklappten Vorschaubildes auf sein echtes Seitenverhältnis
     setzen. Vorher stand dort feste 11rem und object-fit:cover – bei einem
     breiten Aufmacher wie dem von 350.org schnitt das unten sichtbar ab.
     Mit passender Höhe ist der Ausschnitt deckungsgleich mit dem Bild, es
     fehlt nichts, und weil es ein Pixelwert ist, kann die Höhe weich
     wachsen (height:auto ließe sich nicht animieren).
     Beim Zuklappen wieder freigeben, sonst bliebe die Karte hoch. */
  function sizeThumb(pet) {
    var img = pet.querySelector("img.pet__thumb");
    if (!img) return;                       // Platzhalter: feste Höhe aus dem CSS
    if (!pet.classList.contains("open")) { img.style.height = ""; return; }
    var breite = img.parentNode.clientWidth;
    if (!img.naturalWidth || !img.naturalHeight || !breite) return;
    img.style.height =
      Math.round(breite * img.naturalHeight / img.naturalWidth) + "px";
  }
  /* Dreht der Nutzer das Gerät, stimmt der Pixelwert nicht mehr. EIN Zuhörer
     für die ganze Liste statt einer pro Karte – offen sind immer nur wenige. */
  window.addEventListener("resize", function () {
    var offene = document.querySelectorAll(".pet.open");
    for (var i = 0; i < offene.length; i++) sizeThumb(offene[i]);
  });

  /* Ausklappbare Petitions-Karte (Akkordion) im Swipe-Wrapper.
     Wischrichtungen sind ÜBERALL gleich belegt, auch im Archiv:
       rechts = unterschreiben bzw. Markierung zurücknehmen,
       links  = archivieren – im Archiv stattdessen wiederherstellen.
     Vorher lag das Wiederherstellen rechts und links bot im Archiv noch
     einmal „Archivieren" an, was dort nichts bewirken konnte.
     ctx.redraw() zeichnet die Liste neu. */
  /* NUR MAGAZIN (7.8.26, Nutzerauftrag „orientiere dich stärker an den
     Beispielbildern … das sliding verhalten, die bilder groß oben"):
     Aufmacher-Slider nach dem Muster der News-App-Vorlage — Bild groß,
     weiße Karte unten aufgelegt (Kategorie-Chip, Titel, Meta), seitlich
     wischbar mit Scroll-Snap, Punkte darunter. KEIN Markup in Relief:
     alle Aufrufer stehen hinter state.prefs.layout === "magazin".
     items: [{image_url,title,chip,meta,onTap}] — nur Sätze MIT Bild.
     Scheitert ein Bild, fliegt die Folie raus (gleiche Logik wie der
     onerror-Ersatz in petCard, nur dass der Slider keinen Platzhalter
     braucht — er zeigt dann eben eine Folie weniger). */
  /* Folien-Auswahl der Slider (7.8.26, Nutzerwunsch): NIE archivierte,
     unterschriebene oder beendete Sätze — der Slider wirbt, und was ich
     unterschrieben oder weggelegt habe, braucht keine Werbung mehr. */
  function mzSliderKandidat(r) {
    return r.image_url && !isClosed(r) && !isArchived(r.url) &&
      !isSigned(r.url);
  }
  /* Trend-Maß „meiste Unterschriften in kurzer Zeit": Unterschriften je
     Tag seit Start. Ohne Unterschriftenzahl (Europarl) oder ohne
     Startdatum (WeAct teilweise) zählt ersatzweise die Neuheit als
     schwaches Signal — so bleibt jede Plattform vertreten, ohne dass
     ein fehlender Wert eine Ordnung vortäuscht (gleiche Vorsicht wie
     bei den Sortier-Chips). */
  function mzTrend(r) {
    var tage = 1;
    if (r.start_date) {
      var t = (Date.now() - new Date(r.start_date).getTime()) / 864e5;
      if (t > 1) tage = t;
    }
    if (typeof r.signatures === "number") return r.signatures / tage;
    return r.start_date ? 1 / tage : 0;
  }

  function mzHero(items) {
    if (!items.length) return null;
    var hero = el('<div class="mz-hero"></div>');
    var sc = el('<div class="mz-hero__scroll"></div>');
    var dots = el('<div class="mz-hero__dots"></div>');
    /* Schrittweite MESSEN statt rechnen (8.8.2026): seit die Folien in
       layouts.css ein `gap` zwischen sich haben, ist eine Folie weiter
       nicht mehr `clientWidth`, sondern `clientWidth + gap`. Wer weiter
       durch die Containerbreite teilt, bekommt einen Index, der mit
       jeder Folie ein Stück weiter danebenliegt — bei sechs Folien
       zeigte der aktive Punkt am Ende auf die falsche.
       Der Abstand zweier benachbarter Folien ist die ehrliche Antwort:
       er enthält den gap automatisch und überlebt jede spätere Änderung
       an Breite oder Abstand, ohne dass hier etwas nachgezogen werden
       muss. Nur eine einzige Folie → Rückfall auf die Containerbreite. */
    function schritt() {
      var a = sc.children[0], b = sc.children[1];
      if (a && b) {
        var d = b.offsetLeft - a.offsetLeft;
        if (d > 0) return d;
      }
      return sc.clientWidth || 1;
    }
    function zuFolie(idx) {
      sc.scrollTo({ left: idx * schritt(), behavior: "smooth" });
    }
    /* Punkte sind BEDIENELEMENTE, nicht nur Anzeige (7.8.26): am
       Desktop gibt es keine Wischgeste, dort sind sie der zweite Weg
       neben dem Maus-Ziehen unten. */
    function malDots(aktiv) {
      dots.innerHTML = "";
      var n = sc.children.length;
      dots.style.display = (n < 2) ? "none" : "";
      for (var i = 0; i < n; i++) (function (i2) {
        var d = el('<button class="mz-hero__dot' +
          (i2 === (aktiv || 0) ? " on" : "") + '" type="button" ' +
          'aria-label="Folie ' + (i2 + 1) + '"></button>');
        d.addEventListener("click", function () { zuFolie(i2); });
        dots.appendChild(d);
      })(i);
    }
    /* Maus-Ziehen (7.8.26, Nutzerbefund „funktionieren die slider?"):
       eine native Scrollfläche folgt am Desktop KEINEM Mausziehen —
       am Telefon wischt der Daumen nativ, mit der Maus passierte
       schlicht nichts. Nur pointerType "mouse": Touch scrollt selbst,
       ein eigener Zieh-Pfad daneben ergäbe doppelte Bewegung.
       Während des Ziehens ist das Einrasten (scroll-snap) abgeschaltet,
       sonst kämpft es gegen jede scrollLeft-Zuweisung; beim Loslassen
       wird von Hand auf die nächste Folie gerastet. Ein Zug ist KEIN
       Klick: bewegt sich die Maus >6 px, schluckt der Folien-Klick
       das anschließende click-Ereignis. */
    var zieh = { an: false, bewegt: false, x0: 0, s0: 0 };
    sc.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType !== "mouse") return;
      zieh.an = true; zieh.bewegt = false;
      zieh.x0 = ev.clientX; zieh.s0 = sc.scrollLeft;
    });
    sc.addEventListener("pointermove", function (ev) {
      if (!zieh.an) return;
      var dx = ev.clientX - zieh.x0;
      if (!zieh.bewegt) {
        if (Math.abs(dx) <= 6) return;
        /* Zeiger ERST JETZT einfangen und das Einrasten abschalten.
           Beides schon beim pointerdown zu tun war der Fehler: ein
           gefangener Zeiger lenkt auch das folgende click-Ereignis auf
           die Scrollfläche um — die Folien waren dadurch überhaupt
           nicht mehr anklickbar (Nutzerbefund 7.8.26). Ohne Bewegung
           bleibt der Zeiger frei und der Klick erreicht seine Folie. */
        zieh.bewegt = true;
        sc.style.scrollSnapType = "none";
        try { sc.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      sc.scrollLeft = zieh.s0 - dx;
    });
    function ziehEnde() {
      if (!zieh.an) return;
      zieh.an = false;
      if (!zieh.bewegt) return;          // reiner Klick: nichts rasten
      sc.style.scrollSnapType = "";
      zuFolie(Math.round(sc.scrollLeft / schritt()));
    }
    sc.addEventListener("pointerup", ziehEnde);
    sc.addEventListener("pointercancel", ziehEnde);
    items.forEach(function (it) {
      var s = el('<button class="mz-hero__slide" type="button">' +
        '<img class="mz-hero__img" src="' + esc(it.image_url) + '" alt="" ' +
          'loading="lazy" draggable="false">' +
        '<span class="mz-hero__card">' +
          (it.chip ? '<span class="mz-hero__chip">' + esc(it.chip) +
            "</span>" : "") +
          '<span class="mz-hero__t">' + esc(it.title || "") + "</span>" +
          (it.meta ? '<span class="mz-hero__m">' + esc(it.meta) +
            "</span>" : "") +
        "</span></button>");
      s.addEventListener("click", function () {
        if (zieh.bewegt) { zieh.bewegt = false; return; }
        it.onTap();
      });
      s.querySelector("img").addEventListener("error", function () {
        s.remove(); malDots(0);
        if (!sc.children.length) hero.remove();
      });
      sc.appendChild(s);
    });
    malDots(0);
    /* Aktiven Punkt direkt nachführen — der frühere Umweg über
       requestAnimationFrame verschluckte Aktualisierungen. */
    sc.addEventListener("scroll", function () {
      var idx = Math.round(sc.scrollLeft / schritt());
      for (var i = 0; i < dots.children.length; i++)
        dots.children[i].classList.toggle("on", i === idx);
    });
    hero.appendChild(sc);
    hero.appendChild(dots);
    return hero;
  }

  function petCard(r, ctx, platKey) {
    var wrap = el('<div class="pet-wrap"></div>');
    var imArchiv = isArchived(r.url);
    var rechtsLabel = isSigned(r.url) ? "Zurücksetzen" : "Unterschrieben";
    var linksLabel = imArchiv ? "Wiederherstellen" : "Archivieren";
    var linksIcon = imArchiv ? "fa-rotate-left" : "fa-box-archive";
    var bg = el('<div class="pet-bg">' +
      '<span class="pet-bg__l"><i class="fa-solid fa-circle-check"></i> ' +
        rechtsLabel + "</span>" +
      '<span class="pet-bg__r">' + linksLabel +
        ' <i class="fa-solid ' + linksIcon + '"></i>' +
      "</span></div>");
    var pet = el('<div class="pet"></div>');
    pet.dataset.url = r.url || "";

    var sig = (typeof r.signatures === "number")
      ? '<span class="sig"><b>' + nf.format(r.signatures) + "</b> " +
        '<i class="fa-solid fa-pen"></i></span>' : "";
    /* Datum HINTER der Unterschriftenzahl (Nutzerwunsch 3.8.26). Es ist das
       Startdatum — dasselbe, nach dem die Chips „Datum ↑/↓" sortieren. Der
       title sagt das, weil eine nackte Datumsangabe neben einer
       Unterschriftenzahl sonst auch das Ende meinen könnte; das Ende steht,
       wenn es eins gibt, im Abzeichen „beendet". Nicht jede Plattform liefert
       ein Startdatum (siehe Lückenhinweis in buildTools), deshalb bedingt. */
    var datum = r.start_date
      ? '<span class="sig pet__date" title="Start der Petition">' +
        esc(fmtDate(r.start_date)) +
        ' <i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span>' : "";
    var signedBadge = isSigned(r.url)
      ? '<span class="pet-signed"><i class="fa-solid fa-circle-check"></i>' +
        " unterschrieben</span>" : "";
    var closedBadge = isClosed(r)
      ? '<span class="pet-closed"><i class="fa-solid fa-flag-checkered"></i> ' +
        (r.deadline ? "beendet " + fmtDate(r.deadline) : "beendet") + "</span>"
      : "";
    // Vorschaubild. Über die Hälfte des Bestands hat gar keins – Bundestag
    // (7.903 Sätze) und Europarl liefern grundsätzlich keine Bilder. Ohne
    // Ersatz stünde dort nichts, der Titel rutschte nach links, und in einer
    // gemischten Liste sähe jede zweite Kachel anders aus. Ersatz ist deshalb
    // das Plattform-Logo auf neutraler Fläche, im exakten Maß des Bildes –
    // die Markenfarbe steckt schon im Logo selbst (siehe style.css). Dasselbe
    // greift, wenn ein Bild nicht kommt: alle Bilder liegen auf fremden
    // Servern, offline oder bei einer Störung lädt keines davon.
    var thumbPh = '<span class="pet__thumb pet__thumb--ph">' +
      platLogo(platKey, platInfo(platKey).name) + "</span>";
    /* draggable="false" ist hier KEIN Beiwerk: auf einem <img> startet der
       Browser sein eigenes Bild-Ziehen, sobald man mit gedrückter Taste zieht,
       und bricht dabei die Zeigerereignisse ab. In „klassisch" fiel das kaum
       auf (54×40 großes Bildchen), im Magazin füllt das Bild die halbe Karte –
       dort ging das Wischen deshalb fast immer ins Leere. */
    /* Ohne Internet direkt den Platzhalter: alle Vorschaubilder liegen auf
       fremden Servern, ein <img> darauf zeigte offline nur ein kaputtes
       Symbol — und der onerror-Ersatz weiter unten greift bei Bildern
       ausserhalb des Sichtfensters gar nicht erst, weil loading="lazy" sie
       nie anfordert und deshalb auch kein error feuert. */
    var thumb = (r.image_url && state.online)
      ? '<img class="pet__thumb" src="' + esc(r.image_url) + '" alt="" ' +
        'loading="lazy" draggable="false">'
      : thumbPh;
    var ext = r.url
      ? '<a class="pet__ext" href="' + esc(r.url) + '" target="_blank" ' +
        'rel="noopener" aria-label="Petition extern öffnen">' +
        '<i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : "";
    // Kategorie als Balken oben an der Kachel (klickbar → filtert).
    var catBar = r.category
      ? '<button class="pet__catbar" type="button">' +
        '<i class="fa-solid fa-tag"></i> ' + esc(r.category) + "</button>" : "";
    var head = el('<div class="pet__head">' + thumb +
      '<div class="pet__main">' +
        '<div class="pet__title">' + esc(r.title || "(ohne Titel)") + "</div>" +
        '<div class="pet__row">' + signedBadge + closedBadge + sig + datum +
        "</div>" +
      "</div>" +
      '<span class="pet__toggle"><i class="fa-solid fa-chevron-down"></i></span>' +
      ext +
    "</div>");
    // Scheitert das Fremdbild, tritt der Platzhalter an seine Stelle. Vorher
    // wurde es per onerror einfach ausgeblendet – dann fehlte der Kasten und
    // die Kachel sprang um.
    var thumbImg = head.querySelector("img.pet__thumb");
    if (thumbImg) thumbImg.addEventListener("error", function () {
      thumbImg.outerHTML = thumbPh;
    });
    var body = el('<div class="pet__body"></div>');
    head.addEventListener("click", function (e) {
      if (e.target.closest(".pet__ext")) return;   // Extern-Link klappt nicht
      var open = pet.classList.toggle("open");
      sizeThumb(pet);
      if (open && !body.dataset.built) {
        // platKey mitgeben: daraus wird das Volltext-Paket geladen.
        buildPetBody(body, r, ctx, platKey); body.dataset.built = "1";
      }
    });
    // Kommt das Bild erst nach dem Aufklappen an (loading="lazy"), sind seine
    // Maße beim Klick noch 0 – dann greift die Höhe aus dem CSS und wird hier
    // nachgezogen.
    if (thumbImg) thumbImg.addEventListener("load", function () {
      sizeThumb(pet);
    });
    if (catBar) {
      var catEl = el(catBar);
      if (ctx && ctx.setCat) catEl.addEventListener("click", function (e) {
        e.stopPropagation(); ctx.setCat(r.category);
      });
      pet.appendChild(catEl);
    }
    pet.appendChild(head); pet.appendChild(body);
    wrap.appendChild(bg); wrap.appendChild(pet);
    attachSwipe(wrap, pet, r, ctx, platKey);
    return wrap;
  }

  // Horizontale Wisch-Gesten (Pointer-Events; vertikales Scrollen bleibt frei
  // über touch-action:pan-y). Schwelle THRESHOLD löst die Aktion aus.
  function attachSwipe(wrap, pet, r, ctx, platKey) {
    var THRESHOLD = 80, startX = 0, startY = 0, dx = 0,
        dragging = false, decided = false, horiz = false;

    pet.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; dx = 0;
      dragging = true; decided = false; horiz = false;
      pet.style.transition = "none";
    });
    pet.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var mx = e.clientX - startX, my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true; horiz = Math.abs(mx) > Math.abs(my);
        if (!horiz) { dragging = false; return; }  // vertikal → Scrollen
      }
      e.preventDefault();
      dx = mx;
      pet.style.transform = "translateX(" + dx + "px)";
      wrap.classList.toggle("swipe-right", dx > 0);
      wrap.classList.toggle("swipe-left", dx < 0);
    });
    function reset() {
      pet.style.transition = "transform .2s";
      pet.style.transform = "";
      wrap.classList.remove("swipe-right", "swipe-left");
    }
    function finish(e) {
      if (!dragging) { return; }
      dragging = false;
      if (horiz && Math.abs(dx) >= THRESHOLD) {
        if (dx > 0) {
          // Rechts: unterschreiben – im Archiv genauso wie in der Liste.
          toggleSigned(r.url, { title: r.title, platform: platKey,
                                signatures: r.signatures, date: r.start_date });
          reset(); ctx.redraw();
        } else {
          // Links: archivieren, im Archiv zurückholen. Beide Male verlässt
          // die Karte ihre Liste, also gleitet sie in beiden Fällen hinaus.
          setArchived(r.url, !isArchived(r.url));
          slideAndRedraw(-1);
        }
      } else reset();
    }
    function slideAndRedraw(dir) {
      pet.style.transition = "transform .18s";
      pet.style.transform = "translateX(" + (dir > 0 ? "110%" : "-110%") + ")";
      setTimeout(ctx.redraw, 170);
    }
    pet.addEventListener("pointerup", finish);
    pet.addEventListener("pointercancel", finish);
  }

  // Lädt (und cacht) die Daten ALLER aktivierten Plattformen; für die Suche
  // nach gleichen/ähnlichen Petitionen im Kachel-Footer. Beim ersten Aufruf
  // werden die JSONs geholt, danach kommt alles aus dem Cache.
  // Vorberechnete Verwandtschaft (publish.py) in die Form bringen, die
  // renderSimilar erwartet – ganz ohne Nachladen fremder Plattformdaten.
  function relatedFromData(r) {
    if (!Array.isArray(r.related) || !r.related.length) return null;
    var out = [];
    r.related.forEach(function (rel) {
      if (!rel || !rel.url || isArchived(rel.url)) return;
      var plat = state.manifest.platforms.find(function (x) {
        return x.key === rel.platform; });
      if (!plat || !isEnabled(plat.key)) return;
      var sc = typeof rel.score === "number" ? rel.score : 0;
      out.push({ c: { url: rel.url, title: rel.title }, plat: plat,
                 score: sc, same: sc >= 0.8 });
    });
    return out.length ? out : null;
  }

  // Volltext-Pakete: <key>.t<N>.json, einmal geladen und dann gemerkt.
  var textChunks = {};        // "key.N" -> Promise auf {url: html}

  /* Inhaltskennung eines Pakets aus dem Manifest ("tv": {"0": "ab12cd"}).
     Eine Paketnummer bleibt für immer, ihr INHALT nicht: wird ein Text
     nachgetragen oder repariert, ändert sich das Paket unter gleicher Nummer.
     Weil der Service Worker Volltexte cache-first ausliefert, behielt ein
     Gerät dann für immer die alte Fassung – bis hierhin blieb nur, die ganze
     Bibliothek zu verwerfen (sw.js, TEXTS hochzählen). Die Kennung wandert
     deshalb als "?v=" in die Adresse: der Cache liegt auf der vollständigen
     Adresse, ein geändertes Paket wird also von selbst neu geholt und alle
     unveränderten bleiben liegen. Fehlt "tv" (älteres Manifest), läuft alles
     wie vorher – ohne Kennung, ohne Fehler. */
  function chunkRev(key, n) {
    var plats = (state.manifest && state.manifest.platforms) || [];
    var p = plats.find(function (x) { return x.key === key; });
    return (p && p.tv && p.tv[String(n)]) || null;
  }
  function loadTextChunk(key, n) {
    var id = key + "." + n;
    if (!textChunks[id]) {
      var rev = chunkRev(key, n);
      textChunks[id] = fetchData(key + ".t" + n + ".json" +
        (rev ? "?v=" + encodeURIComponent(rev) : ""));
    }
    return textChunks[id];
  }

  /* Veraltete Fassungen aus der Bibliothek werfen. Ohne das lägen nach einer
     Textänderung zwei Einträge für dasselbe Paket im Cache: der alte (ohne
     oder mit falschem "?v=") würde nie mehr gelesen und belegte dauerhaft
     Platz. Angefasst werden ausschließlich Pakete, die im Manifest stehen –
     unbekannte Einträge bleiben unberührt, damit ein unvollständiges Manifest
     nicht die halbe Bibliothek kostet. */
  function pruneTextLibrary() {
    if (!("caches" in window) || !state.manifest) return;
    var soll = {};      // "threefifty.t0.json" -> "ab12cd"
    (state.manifest.platforms || []).forEach(function (p) {
      var tv = p.tv || {};
      Object.keys(tv).forEach(function (n) {
        soll[p.key + ".t" + n + ".json"] = tv[n];
      });
    });
    if (!Object.keys(soll).length) return;
    caches.keys().then(function (namen) {
      namen.filter(function (n) { return n.indexOf("pm-texts-") === 0; })
        .forEach(function (name) {
          caches.open(name).then(function (c) {
            c.keys().then(function (reqs) {
              reqs.forEach(function (req) {
                var u = new URL(req.url);
                var datei = u.pathname.split("/").pop();
                if (!(datei in soll)) return;
                if (u.searchParams.get("v") !== soll[datei]) c.delete(req);
              });
            });
          });
        });
    }).catch(function () { /* Bibliothek aufzuräumen ist nie dringend */ });
  }

  function ensureAllData() {
    var plats = livePlatforms().filter(function (p) { return isEnabled(p.key); });
    return Promise.all(plats.map(function (p) {
      return loadPlatformData(p.key)
        .then(function (arr) { return { p: p, arr: arr }; })
        .catch(function () { return { p: p, arr: [] }; });
    }));
  }

  // --- Ähnlichkeits-Score (0..1) ---------------------------------------------
  // Lokale Heuristik aus Schlagwörtern + Titel + Kurzbeschreibung/Kategorie.
  // Bewusst als eigene Funktion gekapselt: Perspektivisch kann der Scraper die
  // Verwandtschaft per Claude (z. B. Embeddings/semantische Analyse der
  // Beschreibungstexte) VORAB berechnen und als r.related=[{url,score}] in den
  // Daten hinterlegen – findSimilar bevorzugt solche Werte dann automatisch.
  var SIM_STOP = (function () {
    var s = {};
    ("und oder für mit von den der die das ein eine einen eines dem des im in " +
     "auf aus zum zur ist sind wird werden nicht auch mehr gegen ohne über " +
     "bei bis dass wir sie ihr uns unsere unser euch euer alle allen soll " +
     "sollen muss müssen kann können the and for with from this that are our " +
     "you your not petition petitionen deutschland").split(" ")
      .forEach(function (w) { s[w] = 1; });
    return s;
  })();
  /* Akzente einebnen — „Nestlé" und „Nestle" müssen dasselbe Wort sein, beide
     Schreibweisen stehen im Bestand. ä/ö/ü/ß bleiben stehen: im Deutschen
     tragen sie Bedeutung. Gleiche Tabelle wie publish.py → _SIM_DIA. */
  var SIM_DIA = { "á":"a","à":"a","â":"a","ã":"a","å":"a",
                  "é":"e","è":"e","ê":"e","ë":"e",
                  "í":"i","ì":"i","î":"i","ï":"i",
                  "ó":"o","ò":"o","ô":"o","õ":"o",
                  "ú":"u","ù":"u","û":"u",
                  "ý":"y","ÿ":"y","ñ":"n","ç":"c","č":"c" };
  function simFold(w) {
    return w.replace(/[áàâãåéèêëíìîïóòôõúùûýÿñçč]/g, function (c) {
      return SIM_DIA[c] || c;
    });
  }
  function simTokens(str) {
    var out = {};
    (str || "").toLowerCase().split(/[^a-zäöüßà-ÿ]+/).forEach(function (w) {
      if (w.length >= 4 && !SIM_STOP[w]) out[simFold(w)] = 1;
    });
    return out;
  }
  function simTagSet(r) {
    var out = {};
    (r.tags || []).forEach(function (t) {
      if (t) out[simFold(String(t).toLowerCase())] = 1;
    });
    return out;
  }
  function jaccard(a, b) {
    var inter = 0, seen = {}, k;
    for (k in a) { seen[k] = 1; if (b[k]) inter++; }
    for (k in b) seen[k] = 1;
    var uni = 0; for (k in seen) uni++;
    return uni ? inter / uni : 0;
  }
  /* Zuschlag für ein seltenes gemeinsames SCHLAGWORT. Die vier klassischen
     Anteile bleiben, wie sie waren; neu ist allein dieser Zuschlag. Warum das
     Schlagwort und nicht jedes seltene Wort: siehe publish.py, dort steht die
     Messung, an der die allgemeine Seltenheits-Gewichtung gescheitert ist
     (98 % aller Wörter kommen in höchstens 25 Petitionen vor). */
  var SIM_W_NAME = 0.36, SIM_NAME_EXP = 3;
  /* Wie viele Verwandte der Abschnitt höchstens zeigt. Muss zu
     publish.SIM_MAX_PER_PETITION passen: publish.py legt so viele Einträge in
     die Daten, hier stand vorher fest 6 — die Einträge 7 und 8 wären mit
     ausgeliefert, aber nie sichtbar gewesen. */
  var SIM_SHOW_MAX = 8;
  function similarityScore(a, b, w) {
    var sameTitle = (a.title && (a.title || "").trim().toLowerCase() ===
      (b.title || "").trim().toLowerCase()) ? 1 : 0;
    if (sameTitle) return 1;                    // exakt gleiche Petition
    var at = simTagSet(a), bt = simTagSet(b);
    var tagJac = jaccard(at, bt);
    var titleJac = jaccard(simTokens(a.title), simTokens(b.title));
    var contentJac = jaccard(
      simTokens((a.title || "") + " " + (a.summary || "")),
      simTokens((b.title || "") + " " + (b.summary || "")));
    var sameCat = (a.category && b.category &&
      a.category.toLowerCase() === b.category.toLowerCase()) ? 1 : 0;
    var klassisch = tagJac * 0.45 + titleJac * 0.30 +
                    contentJac * 0.15 + sameCat * 0.10;
    if (!w || !w.max) return klassisch;
    // Das seltenste Schlagwort, das beide tragen. Maximum, nicht
    // Durchschnitt: ein starker Beleg („nestle") darf nicht von schwachen
    // („kinder") verwässert werden.
    var best = 0, k;
    for (k in at) if (bt[k] && w.gew[k] > best) best = w.gew[k];
    if (!best) return klassisch;
    return klassisch + Math.pow(Math.min(1, best / w.max), SIM_NAME_EXP) *
                       SIM_W_NAME;
  }
  /* Häufigkeit der Schlagwörter über die gerade geladene Liste. Einmal je
     Aufruf gerechnet — die Notlösung greift ohnehin nur, wenn die vorab
     gerechnete Verwandtschaft aus publish.py fehlt. */
  function simWeights(all) {
    var df = {}, n = 0, k;
    all.forEach(function (grp) {
      grp.arr.forEach(function (c) {
        n++;
        var t = simTagSet(c);
        for (k in t) df[k] = (df[k] || 0) + 1;
      });
    });
    if (!n) return { gew: {}, max: 0 };
    var gewichte = {};
    for (k in df) gewichte[k] = Math.log(n / df[k]);
    return { gew: gewichte, max: n > 2 ? Math.log(n / 2) : 0 };
  }

  // Findet gleiche/ähnliche Petitionen und sortiert nach (unsichtbarem) Score.
  function findSimilar(r, all, max) {
    max = max || SIM_SHOW_MAX;

    // Zukunfts-Hook: vorab berechnete Verwandtschaft (z. B. via Claude) nutzen.
    if (Array.isArray(r.related) && r.related.length) {
      var idx = {};
      all.forEach(function (grp) {
        grp.arr.forEach(function (c) { idx[c.url] = grp; });
      });
      var pre = [];
      r.related.forEach(function (rel) {
        var grp = idx[rel && rel.url];
        if (!grp) return;
        var c = grp.arr.find(function (x) { return x.url === rel.url; });
        if (!c || isArchived(c.url)) return;
        var sc = typeof rel.score === "number" ? rel.score : 0;
        pre.push({ c: c, plat: grp.p, score: sc, same: sc >= 0.8 });
      });
      if (pre.length) {
        pre.sort(function (a, b) { return b.score - a.score; });
        return pre.slice(0, max);
      }
    }

    /* Kandidaten: teilen mindestens ein Schlagwort ODER ein Titelwort, sind
       online und nicht archiviert. Das Titelwort ist seit 3.8.26 dabei — ohne
       es kämen zwei Petitionen zur selben Marke nie in Berührung, wenn ihre
       Schlagwortlisten sich nicht überschneiden. Genau daran scheiterten die
       sieben Nestlé-Petitionen. */
    var mine = simTagSet(r), mineTitle = simTokens(r.title), k;
    var haveKey = false;
    for (k in mine) { haveKey = true; break; }
    if (!haveKey) for (k in mineTitle) { haveKey = true; break; }
    if (!haveKey) return [];
    var w = simWeights(all);
    var cands = [];
    all.forEach(function (grp) {
      grp.arr.forEach(function (c) {
        if (c.url === r.url || isArchived(c.url) || isClosed(c) ||
            (c.status || "online") === "offline") return;
        var ct = simTagSet(c), ctitle = simTokens(c.title), t, shares = false;
        for (t in ct) if (mine[t] || mineTitle[t]) { shares = true; break; }
        if (!shares) for (t in ctitle)
          if (mine[t] || mineTitle[t]) { shares = true; break; }
        if (!shares) return;
        var score = similarityScore(r, c, w);
        cands.push({ c: c, plat: grp.p, score: score, same: score >= 0.8 });
      });
    });
    cands.sort(function (a, b) {
      return (b.score - a.score) ||
             ((b.c.signatures || 0) - (a.c.signatures || 0));
    });
    return cands.slice(0, max);
  }

  function renderSimilar(box, sim) {
    var lbl = '<div class="pet__similar-lbl"><i class="fa-solid fa-link"></i> ' +
      "Gleiche / Ähnliche Petitionen</div>";
    if (!sim.length) {
      box.innerHTML = lbl + '<div class="count-note" style="margin:0">' +
        "Keine ähnlichen Petitionen gefunden.</div>";
      return;
    }
    // Volle Breite (gestapelt); Flagge hinter dem Plattformnamen.
    // Klick öffnet die Petition IN DER APP.
    /* Nur die ersten fünf zeigen, der Rest hinter „Mehr anzeigen"
       (Nutzerwunsch 7.8.26): bis zu acht Zeilen schoben die restliche
       Karte weit nach unten, und die schwächsten Treffer stehen ohnehin
       hinten. Die Zeilen werden alle GEBAUT und nur verborgen — so
       braucht der Knopf keinen zweiten Zeichenweg und die Zuhörer
       hängen schon dran. */
    var SIM_VORAB = 5;
    box.innerHTML = lbl + sim.map(function (s, i) {
      var info = langInfo(s.plat.language || "de");
      var same = s.same ? '<span class="sim-same">gleich</span>' : "";
      return '<button class="simrow' + (i >= SIM_VORAB ? " simrow--rest" : "") +
        '" type="button" data-key="' + esc(s.plat.key) +
        '" data-url="' + esc(s.c.url) + '"><span class="simrow__t">' +
        esc(s.c.title || "(ohne Titel)") + same + "</span>" +
        '<span class="simrow__p">' + esc(s.plat.name) +
        '<span class="flag">' + info.flag + "</span></span></button>";
    }).join("");
    if (sim.length > SIM_VORAB) {
      var mehr = el('<button class="simmore" type="button">' +
        "Mehr anzeigen (" + (sim.length - SIM_VORAB) + ")</button>");
      mehr.addEventListener("click", function (e) {
        e.stopPropagation();
        box.querySelectorAll(".simrow--rest").forEach(function (r) {
          r.classList.remove("simrow--rest");
        });
        mehr.remove();
      });
      box.appendChild(mehr);
    }
    box.querySelectorAll(".simrow").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openPetitionInApp(btn.dataset.key, btn.dataset.url);
      });
    });
  }

  /* Beschreibung fürs Einsetzen vorbereiten: bei ausgeschalteter Option ohne
     Bilder. Eine einzige Stelle, durch die JEDER Beschreibungstext läuft —
     sowohl der schon im Datensatz stehende als auch der nachgeladene. */
  function descHtml(html) {
    if (!html) return html;
    if (state.prefs && state.prefs.descImages === false)
      return stripImages(html);
    // Ohne Internet gar nicht erst versuchen: die Bilder liegen ausnahmslos
    // auf fremden Servern. Statt kaputter Symbole ein beschrifteter Kasten.
    if (!state.online) return bilderAlsPlatzhalter(html);
    return html;
  }

  /* Reserviert Platz für Bilder im Aufruftext, bis sie da sind, und räumt den
     Platzhalter wieder weg. Grund ist der SPRUNG, nicht das Laden:

     Ein Bild aus dem Aufruf-Text hat vor dem Laden keine Maße — die Scraper
     schreiben nur loading="lazy" ins <img>, Breite und Höhe kennt niemand.
     Mit width:auto ist so ein Element 0×0; kommt das Bild an, wächst es auf
     317×178, und der ganze Text darunter rutscht um diesen Betrag nach unten.

     ⚠️ NICHT verwechseln mit dem Befund „Bilder erscheinen nie" vom Vormittag
     des 3.8.2026. Der ist ZWEIMAL widerlegt — am Abend desselben Tages und
     erneut am 6.8.2026 an einer Petition, deren Bilder in der Sitzung noch nie
     geholt worden waren: ein 0×0-Bild im Sichtfeld lädt (y=711 bei 948 px
     Fensterhöhe), eines weit darunter lädt beim Hinscrollen. Wer hier etwas
     ändert, misst vorher selbst — und prüft dabei zwei Fallen, die beide schon
     zugeschlagen haben: Bilder aus dem HTTP-Cache melden „geladen", bevor
     irgendetwas geprüft wurde, und auf einer Seite mit visibilityState
     "hidden" feuert loading="lazy" ÜBERHAUPT nicht, auch nicht mit Maßen.

     ⚠️ loading="lazy" bleibt: foodwatch liefert ein einzelnes PNG mit
     17,25 MB, das darf nicht ungefragt über die Mobilverbindung gehen.
     Der Platzhalter verschwindet mit .img-da wieder — bliebe die Mindesthöhe
     stehen, bekämen kleine Partnerlogos (gemessen 105×59 und 105×51) einen zu
     hohen Kasten oder würden verzerrt. */
  function bilderBeobachten(box) {
    if (!box) return;
    var bilder = box.querySelectorAll("img");
    for (var i = 0; i < bilder.length; i++) {
      (function (img) {
        if (img.complete && img.naturalWidth > 0) {
          img.classList.add("img-da");
          return;
        }
        img.addEventListener("load", function () { img.classList.add("img-da"); });
        /* Auch der Fehlerfall muss den Platzhalter räumen: ein Bild von einem
           fremden Server, das nicht kommt, hinterließe sonst dauerhaft einen
           leeren Kasten mitten im Text. */
        img.addEventListener("error", function () { img.classList.add("img-da"); });
      })(bilder[i]);
    }
  }

  /* Bilder herausnehmen, OHNE sie zu laden.
     Der Umweg über DOMParser ist der Kern der Sache: das entstehende Dokument
     ist „inert", es holt keine Dateien. Schreibt man den Text stattdessen per
     innerHTML in ein losgelöstes <div>, beginnt der Browser den Abruf
     trotzdem — ein gesetztes img.src genügt, das Element muss nicht im
     Dokument hängen (genau darauf beruht das übliche Bild-Vorladen). Und
     display:none hilft erst recht nicht. */
  function stripImages(html) {
    if (html.indexOf("<img") < 0) return html;
    if (window.DOMParser) {
      try {
        var doc = new DOMParser().parseFromString(
          "<!DOCTYPE html><body>" + html, "text/html");
        var weg = doc.body.querySelectorAll("img");
        for (var i = 0; i < weg.length; i++)
          weg[i].parentNode.removeChild(weg[i]);
        // Bildunterschrift ohne Bild erklärt nichts mehr; ein Link, der nur
        // das Bild umschloss, wäre unsichtbar und unklickbar.
        var figs = doc.body.querySelectorAll("figure");
        for (var j = 0; j < figs.length; j++)
          if (!figs[j].querySelector("img"))
            figs[j].parentNode.removeChild(figs[j]);
        var links = doc.body.querySelectorAll("a");
        for (var k = 0; k < links.length; k++)
          if (!links[k].textContent.replace(/\s+/g, ""))
            links[k].parentNode.removeChild(links[k]);
        return doc.body.innerHTML;
      } catch (e) { /* unten weiter mit dem einfachen Weg */ }
    }
    return html.replace(/<img\b[^>]*>/gi, "");
  }

  function buildPetBody(body, r, ctx, platKey) {
    // Kein Bild mehr an dieser Stelle: hier stand früher ein ZWEITES <img> mit
    // derselben Adresse wie das Vorschaubild der Kachel – dasselbe Motiv zweimal
    // untereinander, und zweimal über das Netz geholt. Stattdessen wächst beim
    // Aufklappen das vorhandene Vorschaubild zum Aufmacher (style.css, .pet.open).
    var h = "";
    if (r.summary) h += "<h4>Kurzbeschreibung</h4><p>" + esc(r.summary) + "</p>";
    if (r.recipient) h += "<h4>Adressat</h4><p>" + esc(r.recipient) + "</p>";
    if (r.started_by) h += "<h4>Gestartet von</h4><p>" + esc(r.started_by) + "</p>";
    // Beschreibung: entweder schon im Datensatz (alte Datenstände) oder als
    // Paketnummer "tc" hinterlegt – dann wird sie unten nachgeladen.
    var textPending = !r.description_full && typeof r.tc === "number";
    if (r.description_full || textPending)
      h += '<details class="descacc"><summary>' +
        '<span class="descacc__lbl"><i class="fa-solid fa-align-left"></i> ' +
        "Beschreibung</span>" +
        '<i class="fa-solid fa-chevron-down descacc__chev"></i></summary>' +
        '<div class="pet__desc">' + (descHtml(r.description_full) ||
          '<div class="count-note">Text wird geladen …</div>') +
        "</div></details>";
    // Schlagwörter (Tags) – aus dem Text abgeleitet; Klick verlinkt/filtert.
    if (Array.isArray(r.tags) && r.tags.length) {
      h += '<div class="pet__tags"><span class="pet__tags-lbl">' +
        '<i class="fa-solid fa-hashtag"></i> Schlagwörter</span>' +
        '<div class="taglist">' +
        r.tags.slice(0, 10).map(function (t) {
          return '<button class="tag" type="button" data-tag="' + esc(t) +
            '">' + esc(t) + "</button>";
        }).join("") + "</div></div>";
    }
    var meta = [];
    if (r.start_date) meta.push("Start: " + esc(String(r.start_date).slice(0, 10)));
    if (typeof r.signatures === "number")
      meta.push(nf.format(r.signatures) +
        ' <i class="fa-solid fa-pen"></i>');
    if (meta.length) h += '<div class="pet__meta">' + meta.join(" · ") + "</div>";
    if (r.url)
      h += '<a class="pet__extlink" href="' + esc(r.url) + '" target="_blank" ' +
        'rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> ' +
        "Petition öffnen</a>";
    // Footer: gleiche/ähnliche Petitionen (nur wenn Tags vorhanden sind).
    var hasTags = Array.isArray(r.tags) && r.tags.length;
    if (hasTags) h += '<div class="pet__similar"></div>';
    body.innerHTML = h;
    bilderBeobachten(body.querySelector(".pet__desc"));

    if (ctx && ctx.setTag)
      body.querySelectorAll(".tag").forEach(function (tEl) {
        tEl.addEventListener("click", function (e) {
          e.stopPropagation(); ctx.setTag(tEl.dataset.tag);
        });
      });

    // Beschreibung nachladen, sobald sie gebraucht wird.
    if (textPending && platKey) {
      var descBox = body.querySelector(".pet__desc");
      loadTextChunk(platKey, r.tc).then(function (map) {
        var html = map[r.url];
        if (html) {
          r.description_full = html;            // im Speicher merken: MIT Bildern,
          descBox.innerHTML = descHtml(html);   // gefiltert wird erst beim Anzeigen
          bilderBeobachten(descBox);            // Platzhalter räumen, sobald da
        } else {
          // Eigene Klasse: .count-note ist im Petitionstext der pulsierende
          // Ladehinweis – eine Meldung darf nicht blinken.
          descBox.innerHTML = '<div class="pet__desc-note">Für diese Petition ' +
            "liegt kein ausführlicher Text vor.</div>";
        }
      }).catch(function () {
        descBox.innerHTML = '<div class="pet__desc-note">Der Text konnte ' +
          "nicht geladen werden. Prüfe deine Verbindung.</div>";
      });
    }

    // Gleiche/ähnliche Petitionen. Sind sie vorberechnet (publish.py), stehen
    // sie sofort da – sonst der alte Weg über alle Plattformdaten.
    var simBox = hasTags ? body.querySelector(".pet__similar") : null;
    if (simBox) {
      var pre = relatedFromData(r);
      if (pre) { renderSimilar(simBox, pre); return; }
      // Ab Datenformat 2 hat publish.py die Verwandtschaft vollständig
      // berechnet. Kein "related" heißt dann: es gibt keine – und NICHT,
      // dass die App alle Plattformen durchsuchen soll.
      if ((state.manifest.format || 1) >= 2) {
        renderSimilar(simBox, []);
        return;
      }
      simBox.innerHTML = '<div class="pet__similar-lbl"><i class="fa-solid ' +
        'fa-link"></i> Gleiche / Ähnliche Petitionen</div>' +
        '<div class="count-note" style="margin:0">Suche über alle ' +
        "Plattformen …</div>";
      ensureAllData().then(function (all) {
        renderSimilar(simBox, findSimilar(r, all, SIM_SHOW_MAX));
      }).catch(function () {
        simBox.innerHTML = "";
      });
    }
  }

  // Aufklappbarer Info-Bereich über der Petitionsliste: wer steckt hinter
  // dieser Plattform, wie finanziert sie sich, wo steht das Original?
  function platformAbout(key) {
    var info = platInfo(key);
    var about = info.about || {};
    var manifestEntry = state.manifest.platforms.find(function (x) {
      return x.key === key; }) || {};
    var brand = info.color;
    var box = el('<div class="pabout"' +
      (brand ? ' style="--brand:' + esc(brand) + '"' : "") + ">" +
      '<button class="pabout__head" type="button">' +
      '<span class="pabout__lbl">' +
        esc(T("platform.aboutBtn", "Über diese Plattform")) + "</span>" +
      '<i class="fa-solid fa-chevron-down pabout__chev"></i></button>' +
      '<div class="pabout__body"></div></div>');
    var body = box.querySelector(".pabout__body");
    /* Gar kein Logo mehr an diesem Baustein (Nutzerwunsch 3.8.26). Erst fiel das
       zweite Logo im Aufklapp-Bereich weg, seit dem 3.8. auch das in der
       Kopfzeile des Knopfes: der Baustein sitzt jetzt direkt unter dem großen
       Logo der Plattformseite, dieselbe Marke stand also zweimal untereinander.
       manifestEntry wird hier weiterhin für nichts anderes gebraucht - falls
       das Logo je zurückkehrt, ist es die Quelle für den Namen. */
    box.querySelector(".pabout__head").addEventListener("click", function () {
      state.aboutPlatform = !box.classList.contains("open");
      box.classList.toggle("open", state.aboutPlatform);
    });

    if (about.text) body.appendChild(el("<p>" + esc(about.text) + "</p>"));

    // Steckbrief: für jede Plattform dieselben Zeilen, „–" wo nichts vorliegt,
    // Quellsymbol hinter jeder Angabe (siehe STECKBRIEF/steckbriefHtml oben).
    body.appendChild(el(steckbriefHtml(about)));

    var links = (about.links || []).slice();
    if (!links.length && manifestEntry.source_url)
      links.push({ label: "Website", url: manifestEntry.source_url });
    // Wikipedia. Der Artikelname steht mit im Etikett, weil er nicht überall
    // gleich der Plattform heißt – Eko führt zu „SumOfUs" (Umbenennung), WeAct
    // zum Träger „Campact". Für innn.it und WeMove Europe gibt es keinen
    // deutschen Artikel; dort fehlt das Feld und damit der Link.
    if (info.wikipedia) {
      var artikel = decodeURIComponent(info.wikipedia.split("/wiki/")[1] || "")
        .replace(/_/g, " ");
      links.push({ label: "Wikipedia: " + artikel, url: info.wikipedia });
    }
    if (links.length) {
      var ul = el('<div class="pabout__links"></div>');
      links.forEach(function (l) {
        if (!l || !l.url) return;
        ul.appendChild(el('<a class="pabout__link" href="' + esc(l.url) +
          '" target="_blank" rel="noopener">' + esc(l.label || l.url) +
          ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>'));
      });
      body.appendChild(ul);
    }

    // „Für Nerds": Herkunft und Offenheit der Daten plus der Quellcode der App.
    // Hieß früher „Datenlage" und stand offen da – das ist eine Randnotiz für
    // wenige, deshalb jetzt eingeklappt. <details> statt eigener Schalterlogik,
    // dasselbe Muster wie die Beschreibung in der Petitionskarte (.descacc).
    var nerdInhalt = "";
    if (manifestEntry.openness_note)
      nerdInhalt += '<div class="pabout__open ' +
        ampClass(manifestEntry.openness) + '">' +
        esc(manifestEntry.openness_note) + "</div>";
    if (manifestEntry.source_url)
      nerdInhalt += '<div class="nerd__row"><b>Quelle der Daten</b> ' +
        '<a href="' + esc(manifestEntry.source_url) + '" target="_blank" ' +
        'rel="noopener">' + esc(manifestEntry.source_url) + "</a></div>";
    nerdInhalt += '<div class="nerd__row"><b>Quellcode dieser App</b> ' +
      '<a href="' + esc(GITHUB_URL) + '" target="_blank" rel="noopener">' +
      esc(GITHUB_URL.replace(/^https:\/\//, "")) +
      ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a></div>';
    // Der Hinweis „nicht bekannt" muss VOR dem Nerd-Bereich entschieden werden:
    // den gibt es immer (Quellcode-Link), sonst käme er nie zum Zug.
    if (!body.childNodes.length) {
      body.appendChild(el("<p>" + esc(T("platform.unknown", "nicht bekannt")) +
        "</p>"));
    }
    body.appendChild(el('<details class="nerd"><summary class="nerd__sum">' +
      '<span><i class="fa-solid fa-flask"></i> Für Nerds</span>' +
      '<i class="fa-solid fa-chevron-down nerd__chev"></i></summary>' +
      '<div class="nerd__body">' + nerdInhalt + "</div></details>"));
    return box;
  }

  function renderPlatformDetail(key) {
    content.innerHTML = "";
    /* Favoriten-Stern auch hier, nicht nur in den Einstellungen: wer eine
       Plattform gerade durchsieht, entscheidet genau dann, ob sie oben in der
       Übersicht stehen soll. Gleiche Mechanik wie dort (state.favorites +
       saveFavorites), nur an einer zweiten Stelle bedienbar. */
    /* Marke oben auf der Seite: das Logo steht in der eigenen Farbe der
       Plattform, damit auf einen Blick klar ist, wo man gelandet ist. Der Name
       steht seit 3.8.26 daneben (Nutzerwunsch) — Logo linksbündig, Name
       rechtsbündig. Das ist die einzige Marke der App, die ihren Namen
       AUSGESCHRIEBEN daneben trägt; in den Listen steht er stattdessen im
       Text und das Logo dahinter.
       Damit steht der Name zweimal auf der Seite, denn der Seitentitel über dem
       Inhalt nennt ihn auch. syncPageTitle() blendet den Seitentitel aus, wenn
       er wörtlich mit einer Überschrift im Inhalt übereinstimmt — .phead__name
       ist dort mit aufgenommen. */
    var phead = el('<div class="phead">' + platLogo(key, platformName(key)) +
      '<h2 class="phead__name">' + esc(platformName(key)) + "</h2></div>");
    /* Reihenfolge seit 3.8.26 (Nutzerwunsch): Zurück-Zeile mit Favoritenstern
       und Archiv-Knopf · Marke · „Über diese Plattform". Die Bausteine werden
       deshalb HIER gebaut, aber erst weiter unten eingehängt — die Zurück-Zeile
       braucht ihre Ereignis-Zuhörer vorher. */
    var aboutBox = platformAbout(key);
    var head = el('<div class="subhead">' +
      '<button class="backbtn"><i class="fa-solid fa-chevron-left"></i> ' +
        "Alle Plattformen</button>" +
      '<span class="subhead__r">' +
        '<button class="favbtn favbtn--head' + (isFav(key) ? " on" : "") +
          '" type="button"><i class="' + (isFav(key) ? "fa-solid" : "fa-regular") +
          ' fa-star"></i></button>' +
        '<a class="archlink" href="#"><i class="fa-solid fa-box-archive"></i> ' +
          "Zum Archiv</a></span></div>");
    head.querySelector(".backbtn").addEventListener("click", function () {
      state.platform = null;
      state.catFilter = null; state.tagFilter = null;
      state.sort = null; state.gapFilter = null; render();
    });
    var favBtn = head.querySelector(".favbtn");
    favBtn.setAttribute("aria-pressed", isFav(key) ? "true" : "false");
    favBtn.setAttribute("aria-label", "Plattform als Favorit merken");
    favBtn.addEventListener("click", function () {
      if (isFav(key)) state.favorites["delete"](key);
      else state.favorites.add(key);
      saveFavorites();
      var jetzt = isFav(key);
      favBtn.classList.toggle("on", jetzt);
      favBtn.setAttribute("aria-pressed", jetzt ? "true" : "false");
      favBtn.querySelector("i").className =
        (jetzt ? "fa-solid" : "fa-regular") + " fa-star";
    });
    head.querySelector(".archlink").addEventListener("click", function (e) {
      e.preventDefault();
      var a = document.getElementById("pet-archiv");
      if (a) a.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    content.appendChild(head);
    content.appendChild(phead);
    content.appendChild(aboutBox);

    /* NUR MAGAZIN: Aufmacher-Slider der Plattform (siehe mzHero) —
       die fünf neuesten laufenden Petitionen MIT Bild, groß über der
       Liste; Antippen springt zur Karte und klappt sie auf. Kasten
       reserviert die Höhe sofort (CLS); Plattformen ohne Bilder
       (Bundestag, Europarl) bekommen schlicht keinen Slider. listWrap
       ist als var gehoben und beim Eintreffen der Daten längst gesetzt. */
    var mzDetailBox = null;
    if (state.prefs.layout === "magazin" && state.online) {
      mzDetailBox = el('<div class="mz-herobox mz-herobox--ph"></div>');
      content.appendChild(mzDetailBox);
      loadPlatformData(key).then(function (arr) {
        var mitBild = arr.filter(mzSliderKandidat);
        mitBild.sort(function (a, b) {
          return String(b.start_date || "")
            .localeCompare(String(a.start_date || ""));
        });
        mitBild = mitBild.slice(0, 5);
        if (!mitBild.length) { mzDetailBox.remove(); return; }
        var hero = mzHero(mitBild.map(function (r) {
          return {
            image_url: r.image_url, title: r.title,
            chip: r.category || platformName(key),
            meta: (typeof r.signatures === "number")
              ? nf.format(r.signatures) + " Unterschriften" : "",
            /* Auch hier über openPetitionInApp statt über eine eigene
               DOM-Suche (Nutzerbefund 7.8.26): die Suche in listWrap
               fand nichts, sobald die Petition hinter dem
               LIST_MAX-Deckel oder in einem zugeklappten Abschnitt lag —
               dann geschah entweder nichts oder man landete an falscher
               Stelle. state.openPetitionUrl kann all das. */
            onTap: function () { openPetitionInApp(key, r.url); }
          };
        }));
        if (!hero) { mzDetailBox.remove(); return; }
        mzDetailBox.classList.remove("mz-herobox--ph");
        /* Überschrift „Neuste" ÜBER dem Slider (8.8.2026, Nutzerwunsch
           „der slider soll auch eine überschrift bekommen") — dieselbe
           Bauform wie auf der Startseite, wo mz-sechead über dem Slider
           „Im Trend" steht. Der Text sitzt in texts.js unter
           platform.heroTitle und passt zur Sortierung dieses Sliders:
           oben mitBild.sort() ordnet nach start_date absteigend.
           Reihenfolge beachten: erst die Überschrift anhängen, dann den
           Slider, sonst steht sie darunter. */
        mzDetailBox.appendChild(el('<div class="mz-sechead">' +
          esc(T("platform.heroTitle", "Neuste")) + "</div>"));
        mzDetailBox.appendChild(hero);
        /* Ohne Zwischentitel „Alle Petitionen" (Nutzerwunsch 7.8.26):
           die Zählzeile darunter sagt dasselbe genauer. */
      }, function () { if (mzDetailBox) mzDetailBox.remove(); });
    }

    if (!LS.getItem("swipeHintDismissed")) {
      var hint = el('<div class="swipe-hint">' +
        '<h3 class="hint-title">' +
        esc(T("petition.swipeHintTitle", "Petitionen wischen")) + "</h3>" +
        '<p>Wische eine Petition nach <b>rechts</b>, um sie als ' +
        '„unterschrieben" zu markieren. <span class="hint-note"><b>Wichtig:</b> ' +
        'Sie wird dadurch <u>nicht</u> automatisch unterschrieben – das musst ' +
        'du selbst auf der jeweiligen Plattform tun.</span> Nach <b>links</b> ' +
        'wischen archiviert die Petition.</p>' +
        '<button class="hint-dismiss" type="button">' +
        '<i class="fa-solid fa-check"></i> Verstanden, zukünftig nicht mehr ' +
        'anzeigen</button></div>');
      hint.querySelector(".hint-dismiss").addEventListener("click", function () {
        LS.setItem("swipeHintDismissed", "1"); hint.remove();
      });
      content.appendChild(hint);
    }

    /* Lupenknopf wie bei der Hauptsuche (Nutzerwunsch 3.8.26). Die Liste
       filtert weiterhin bei jedem Tastendruck — der Knopf ist für alle, die
       eine Suche abschließen wollen; er schließt auf dem Telefon die Tastatur.
       Ohne preventDefault würde das Formular die Seite neu laden und die App
       von vorn starten. */
    var searchForm = el('<form class="searchrow" role="search"></form>');
    var searchBox = el('<input class="search" type="search" ' +
      'placeholder="In dieser Plattform suchen …" value="' + esc(state.search) + '">');
    searchForm.appendChild(searchBox);
    searchForm.appendChild(el('<button class="searchrow__btn" type="submit" ' +
      'aria-label="Suchen"><i class="fa-solid fa-magnifying-glass" ' +
      'aria-hidden="true"></i></button>'));
    /* Vorschläge aus DIESER Plattform. Anders als auf der Hauptseite muss
       nichts nachgeladen werden — die Liste steht schon im Speicher, sonst
       gäbe es diese Seite nicht. */
    var acPlat = attachAutocomplete(searchBox, function (q) {
      return sucheVorschlaege(q, [key]);
    });
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault(); acPlat.close(); searchBox.blur();
    });
    content.appendChild(searchForm);

    // Ausklapper direkt unter der Suche: Sortierung und die Kategorien DIESER
    // Plattform. Zugeklappt, weil er sonst die Liste nach unten drückt.
    var tools = el('<details class="ptools">' +
      '<summary class="ptools__sum">' +
        '<span class="ptools__lbl"><i class="fa-solid fa-sliders"></i> ' +
        'Sortieren und filtern</span>' +
        '<span class="ptools__state"></span>' +
        '<i class="fa-solid fa-chevron-down ptools__chev"></i></summary>' +
      '<div class="ptools__body"></div></details>');
    content.appendChild(tools);
    var toolsBuilt = false;
    // Filter (Kategorie/Schlagwort) liegen im State, damit sie eine plattform-
    // übergreifende Suche + Zurück-Navigation überstehen.
    var filterBar = el('<div class="filterbar" style="display:none"></div>');
    content.appendChild(filterBar);
    var note = el('<div class="count-note">Lade …</div>');
    content.appendChild(note);
    var listWrap = el('<div id="petlist"></div>');
    content.appendChild(listWrap);

    // Sortierung. Sätze OHNE den jeweiligen Wert wandern immer ans Ende – bei
    // WeAct fehlt das Startdatum durchgehend, bei Europarl die Unterschriften-
    // zahl, bei openPetition liegt das Datum nur für gut die Hälfte vor. Sie
    // vorne einzusortieren würde eine Ordnung vortäuschen, die es nicht gibt.
    // Startdaten sind ISO-Zeichenketten, deshalb genügt der Textvergleich.
    function sortRows(list) {
      var s = state.sort;
      if (!s) return list;
      var out = list.slice();
      if (s === "neu" || s === "alt") {
        out.sort(function (a, b) {
          var da = a.start_date || "", db = b.start_date || "";
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          if (da === db) return 0;
          return (s === "neu") === (da > db) ? -1 : 1;
        });
      } else {
        out.sort(function (a, b) {
          var sa = typeof a.signatures === "number" ? a.signatures : null;
          var sb = typeof b.signatures === "number" ? b.signatures : null;
          if (sa === null && sb === null) return 0;
          if (sa === null) return 1;
          if (sb === null) return -1;
          return s === "viel" ? sb - sa : sa - sb;
        });
      }
      return out;
    }

    // Inhalt des Ausklappers. Wird einmal gebaut, sobald die Daten da sind:
    // welche Sortierungen überhaupt Sinn ergeben und welche Kategorien es gibt,
    // steht erst dann fest.
    function buildTools(arr) {
      var tbody = tools.querySelector(".ptools__body");
      var mitDatum = arr.filter(function (r) { return !!r.start_date; }).length;
      var mitZahl = arr.filter(function (r) {
        return typeof r.signatures === "number"; }).length;
      /* [Wert, Beschriftung, Icon HINTER der Beschriftung, Vorlesetext].
         Seit 3.8.26 (Nutzerwunsch) tragen beide Paare dieselbe Beschriftung und
         unterscheiden sich allein durch den Pfeil: „Datum ↑/↓" und
         „Unterschriften ↑/↓". Der Pfeil zeigt in beiden Paaren dasselbe an —
         nach OBEN heißt „das Größte zuerst": das neueste Datum, die meisten
         Unterschriften. Weil jede Beschriftung damit doppelt vorkommt, braucht
         jeder Chip ein aria-label; ein Screenreader läse sonst zweimal
         dasselbe Wort, der Pfeil ist für ihn nicht da.
         Gerade Pfeile statt der 45°-Trendpfeile von vorhin (Nutzerwunsch
         3.8.26); fa-arrow-up/-down liegen im lokalen FontAwesome-Bündel
         (nachgesehen). */
      var opts = [["", "Standard", "", ""]];
      if (mitDatum) opts.push(
        ["neu", "Datum", "fa-arrow-up", "Neueste zuerst"],
        ["alt", "Datum", "fa-arrow-down", "Älteste zuerst"]);
      if (mitZahl) opts.push(
        ["viel", "Unterschriften", "fa-arrow-up", "Meiste Unterschriften zuerst"],
        ["wenig", "Unterschriften", "fa-arrow-down", "Wenigste Unterschriften zuerst"]);
      var h = '<div class="ptools__grp"><span class="ptools__h">Sortierung</span>' +
        '<div class="chiprow">' + opts.map(function (o) {
          return '<button class="chip" type="button" data-sort="' + o[0] + '"' +
            (o[3] ? ' aria-label="' + esc(o[3]) + '"' : "") + ">" + esc(o[1]) +
            (o[2] ? ' <i class="fa-solid ' + o[2] + '" aria-hidden="true"></i>'
                  : "") + "</button>";
        }).join("") + "</div>";
      // Ehrlich benennen, wenn die Sortierung nur einen Teil erfassen kann.
      var luecken = [];
      /* „stehen am Ende" gilt NUR bei aktiver Sortierung – sortRows() schiebt
         leere Werte ans Ende, die Standardreihenfolge lässt sie, wo sie sind.
         Vorher stand der Satz unbedingt da und behauptete damit eine Ordnung,
         die ohne Sortierung gar nicht besteht. */
      function fehlt(n, was, feld) {
        return { text: "Bei " + nf.format(n) +
                   (n === 1 ? " Petition fehlt " : " Petitionen fehlt ") + was +
                   " – beim Sortieren " + (n === 1 ? "steht sie" : "stehen sie") +
                   " am Ende.",
                 feld: feld, anzahl: n };
      }
      if (mitDatum && mitDatum < arr.length)
        luecken.push(fehlt(arr.length - mitDatum, "das Startdatum", "start_date"));
      if (mitZahl && mitZahl < arr.length)
        luecken.push(fehlt(arr.length - mitZahl, "die Unterschriftenzahl", "signatures"));
      if (!mitDatum)
        luecken.push({ text: "Diese Plattform liefert keine Startdaten." });
      if (!mitZahl)
        luecken.push({ text: "Diese Plattform liefert keine Unterschriftenzahlen." });
      /* Die Meldung lässt sich ausblenden („Infos deaktivieren", Nutzerwunsch
         7.8.2026) und kommt über „Hilfe-Hinweise zurücksetzen" wieder — der
         Schlüssel steht dafür in HINT_KEYS, das deckt Zurücksetzen, Sicherung
         und „alles löschen" in einem ab. */
      if (luecken.length && !LS.getItem("toolNoteDismissed")) {
        /* Je Lücke eine eigene ZEILE mit der Aktion rechts daneben. Vorher
           waren es Inline-Spans in einem gemeinsamen Textblock: die Sätze
           liefen ineinander, und der Knopf rutschte auf eine eigene Zeile,
           sobald der Text umbrach (Nutzerbefund 7.8.2026). */
        h += '<div class="ptools__note">' +
             '<i class="fa-solid fa-circle-info ptools__noteicon"></i>' +
             '<div class="ptools__notebody">' +
             luecken.map(function (l) {
               var aktiv = l.feld && state.gapFilter === l.feld;
               return '<div class="ptools__notezeile">' +
                 '<span class="ptools__notetext">' + esc(l.text) + "</span>" +
                 (l.feld
                   ? '<button class="gapbtn' + (aktiv ? " on" : "") +
                     '" type="button" data-luecke="' + esc(l.feld) + '">' +
                     '<i class="fa-solid ' +
                     (aktiv ? "fa-arrow-rotate-left" : "fa-filter") + '"></i> ' +
                     (aktiv ? "Alle zeigen" : "Nur diese zeigen") + "</button>"
                   : "") +
                 "</div>";
             }).join("") +
             '<button class="ptools__noteoff" type="button">' +
             "Infos deaktivieren</button>" +
             "</div></div>";
      }
      h += "</div>";

      // Kategorien dieser Plattform, häufigste zuerst.
      var zaehler = {};
      arr.forEach(function (r) {
        if (r.category) zaehler[r.category] = (zaehler[r.category] || 0) + 1; });
      var kats = Object.keys(zaehler).sort(function (a, b) {
        return zaehler[b] - zaehler[a] || a.localeCompare(b, "de"); });
      if (kats.length) {
        h += '<div class="ptools__grp"><span class="ptools__h">' +
          '<i class="fa-solid fa-tag"></i> Kategorien (' + kats.length +
          ')</span><div class="chiprow">' +
          '<button class="chip" type="button" data-cat="">Alle</button>' +
          kats.map(function (c) {
            return '<button class="chip" type="button" data-cat="' + esc(c) +
              '">' + esc(c) + '<span class="chip__n">' +
              nf.format(zaehler[c]) + "</span></button>";
          }).join("") + "</div></div>";
      }
      tbody.innerHTML = h;
      tbody.querySelectorAll("[data-sort]").forEach(function (b) {
        b.addEventListener("click", function () {
          state.sort = b.dataset.sort || null;
          draw(arr); window.scrollTo(0, 0);
        });
      });
      tbody.querySelectorAll("[data-cat]").forEach(function (b) {
        b.addEventListener("click", function () {
          state.catFilter = b.dataset.cat || null;
          if (state.catFilter) state.tagFilter = null;
          draw(arr); window.scrollTo(0, 0);
        });
      });
      /* Je Lücke ein Filter statt der früheren Sprungmarke. Er schaltet um:
         nochmal darauf tippen zeigt wieder alles. buildTools läuft nur EINMAL
         (toolsBuilt), deshalb baut der Klick den Ausklapper neu — sonst
         behielte der Knopf seine alte Beschriftung. */
      tbody.querySelectorAll(".gapbtn").forEach(function (b) {
        b.addEventListener("click", function () {
          var feld = b.dataset.luecke;
          state.gapFilter = state.gapFilter === feld ? null : feld;
          toolsBuilt = false;                    // Beschriftung neu setzen
          draw(arr);
          window.scrollTo(0, 0);
        });
      });
      var aus = tbody.querySelector(".ptools__noteoff");
      if (aus) aus.addEventListener("click", function () {
        LS.setItem("toolNoteDismissed", "1");
        /* Einen aktiven Lücken-Filter mit auflösen: sonst bliebe die Liste
           gefiltert, und der Hinweis, der das erklärt, wäre gerade weg. */
        state.gapFilter = null;
        toolsBuilt = false;
        draw(arr);
      });
    }

    // Zeigt am zugeklappten Ausklapper, ob gerade etwas eingestellt ist.
    function markTools() {
      var namen = { neu: "Neueste zuerst", alt: "Älteste zuerst",
                    viel: "Meiste Unterschriften", wenig: "Wenigste Unterschriften" };
      var aktiv = [];
      if (state.sort) aktiv.push(namen[state.sort]);
      if (state.catFilter) aktiv.push(state.catFilter);
      // Auch der Lücken-Filter muss am ZUGEKLAPPTEN Bedienfeld ablesbar sein —
      // sonst sitzt man vor einer stark verkürzten Liste ohne sichtbaren Grund.
      if (state.gapFilter) aktiv.push(state.gapFilter === "signatures"
        ? "ohne Unterschriftenzahl" : "ohne Startdatum");
      var st = tools.querySelector(".ptools__state");
      st.textContent = aktiv.join(" · ");
      tools.classList.toggle("is-active", aktiv.length > 0);
      tools.querySelectorAll("[data-sort]").forEach(function (b) {
        b.classList.toggle("on", (b.dataset.sort || null) === state.sort); });
      tools.querySelectorAll("[data-cat]").forEach(function (b) {
        b.classList.toggle("on", (b.dataset.cat || null) === state.catFilter); });
    }

    function draw(arr) {
      if (!toolsBuilt) { buildTools(arr); toolsBuilt = true; }
      markTools();
      /* Aufmacher-Slider tritt zurück, solange gefiltert oder gesucht
         wird (Nutzerwunsch 7.8.26): wer filtert, will die Treffer sehen,
         nicht die Trend-Werbung. Er kommt zurück, sobald der Filter
         gelöst ist — deshalb nur ausblenden, nicht abbauen. */
      if (mzDetailBox) {
        var filtert = !!(state.catFilter || state.tagFilter ||
          state.gapFilter || state.search.trim());
        mzDetailBox.classList.toggle("mz-herobox--aus", filtert);
      }
      var term = state.search.trim().toLowerCase();
      var rows = sortRows(arr.filter(function (r) {
        if (state.catFilter && r.category !== state.catFilter) return false;
        if (state.tagFilter && (r.tags || []).indexOf(state.tagFilter) < 0) return false;
        /* Lücken-Filter: zeigt genau die Sätze, denen der Wert fehlt.
           Er hat den Sprungknopf „Zur ersten" abgelöst, der PRINZIPBEDINGT
           nicht greifen konnte: gesucht wurde in der gezeichneten Liste, und
           die ist auf LIST_MAX (300) gedeckelt — während die fehlenden Sätze
           per Definition ans Ende sortiert werden. Bei openPetition (1.908)
           oder Change.org (2.019) lagen sie damit immer dahinter, der Knopf
           meldete „Nicht in der angezeigten Liste" (Nutzerbefund 7.8.2026).
           Ein Filter kennt diese Grenze nicht: er verkleinert die Liste, statt
           in ihr zu suchen. */
        if (state.gapFilter === "start_date" && r.start_date) return false;
        if (state.gapFilter === "signatures" &&
            typeof r.signatures === "number") return false;
        if (!term) return true;
        return ((r.title || "") + " " + (r.category || "") + " " +
                (r.started_by || "")).toLowerCase().indexOf(term) > -1;
      }));
      var notArch = rows.filter(function (r) { return !isArchived(r.url); });
      var online = notArch.filter(function (r) { return (r.status || "online") !== "offline"; });
      // Beendete Petitionen aus der aktiven Liste heraushalten: beim Bundestag
      // stehen ~7.800 abgelaufene gegen ~57 laufende – sonst wäre die Liste
      // praktisch nur noch Archiv.
      var active = online.filter(function (r) { return !isClosed(r); });
      var closedRows = online.filter(isClosed);
      var offline = notArch.filter(function (r) { return (r.status || "online") === "offline"; });
      var archived = rows.filter(function (r) { return isArchived(r.url); });
      /* „25 von 26" ließ offen, wo die eine geblieben ist. Die Differenz wird
         deshalb aufgeschlüsselt – jeder Grund entspricht genau einem der
         Abschnitte weiter unten, sodass man sie auch findet. */
      function zahl(n, ein, mehr) {
        return nf.format(n) + " " + (n === 1 ? ein : mehr);
      }
      var gruende = [];
      if (closedRows.length) gruende.push(zahl(closedRows.length, "beendet", "beendet"));
      if (archived.length) gruende.push(zahl(archived.length, "im Archiv", "im Archiv"));
      if (offline.length) gruende.push(zahl(offline.length, "offline", "offline"));
      note.textContent = state.gapFilter
        ? zahl(active.length,
               state.gapFilter === "signatures"
                 ? "Petition ohne Unterschriftenzahl"
                 : "Petition ohne Startdatum",
               state.gapFilter === "signatures"
                 ? "Petitionen ohne Unterschriftenzahl"
                 : "Petitionen ohne Startdatum")
        : state.catFilter
        ? zahl(active.length, "Petition in dieser Kategorie",
               "Petitionen in dieser Kategorie")
        : state.tagFilter
        ? zahl(active.length, "Petition mit diesem Schlagwort",
               "Petitionen mit diesem Schlagwort")
        : nf.format(active.length) + " von " + nf.format(arr.length) + " Petitionen" +
          (gruende.length ? " (" + gruende.join(", ") + ")" : "");

      // Filter-Leiste über der Liste, wenn Kategorie ODER Schlagwort aktiv ist.
      if (state.catFilter || state.tagFilter) {
        filterBar.style.display = "";
        var flabel = state.catFilter
          ? '<i class="fa-solid fa-tag"></i> Kategorie: <b>' + esc(state.catFilter) + "</b>"
          : '<i class="fa-solid fa-hashtag"></i> Schlagwort: <b>' + esc(state.tagFilter) + "</b>";
        filterBar.innerHTML = '<span class="filterbar__cat">' + flabel + "</span>" +
          '<div class="filterbar__actions">' +
          '<button class="filterbar__cross" type="button">' +
          '<i class="fa-solid fa-layer-group"></i> Plattformübergreifend suchen</button>' +
          '<button class="filterbar__reset" type="button">' +
          '<i class="fa-solid fa-xmark"></i> Filter zurücksetzen</button></div>';
        filterBar.querySelector(".filterbar__reset").addEventListener("click",
          function () { state.catFilter = null; state.tagFilter = null;
                        var y = window.scrollY; draw(arr); window.scrollTo(0, y); });
        filterBar.querySelector(".filterbar__cross").addEventListener("click",
          function () {
            state.cross = {
              type: state.catFilter ? "cat" : "tag",
              value: state.catFilter || state.tagFilter,
              fromPlatform: key
            };
            render();
          });
      } else { filterBar.style.display = "none"; filterBar.innerHTML = ""; }

      var ctx = {
        redraw: function () {
          var y = window.scrollY; draw(arr); window.scrollTo(0, y);
        },
        setCat: function (cat) {
          if (!cat) return; state.catFilter = cat; state.tagFilter = null;
          draw(arr); window.scrollTo(0, 0);
        },
        setTag: function (tag) {
          if (!tag) return; state.tagFilter = tag; state.catFilter = null;
          draw(arr); window.scrollTo(0, 0);
        }
      };

      listWrap.innerHTML = "";
      // Ziel-Petition (nach In-App-Navigation) nach vorne holen, damit sie
      // sicher innerhalb der ersten LIST_MAX gerendert wird.
      if (state.openPetitionUrl) {
        var ti = active.findIndex(function (r) { return r.url === state.openPetitionUrl; });
        if (ti > 0) active.unshift(active.splice(ti, 1)[0]);
      }
      var restNote = 'Es werden die ersten ' + LIST_MAX +
        ' angezeigt – Suche eingrenzen für mehr.';
      active.slice(0, LIST_MAX).forEach(function (r) { listWrap.appendChild(petCard(r, ctx, key)); });
      if (active.length > LIST_MAX)
        listWrap.appendChild(el('<div class="count-note">' + restNote + "</div>"));

      // Bottom-Akkordion (Beendet, Archiv, Offline) – jeweils klappbar.
      // Der Inhalt entsteht ERST beim Aufklappen und ist wie die Hauptliste
      // gedeckelt: eifrig gerendert stünden allein beim Bundestag 7.845
      // beendete Karten dauerhaft im DOM, obwohl das Akkordion zu ist.
      function bottomSection(id, icon, label, items, stateKey, empty) {
        /* Liegt die Ziel-Petition in DIESEM Abschnitt, muss er aufgeklappt und
           gefüllt werden. Sonst sucht der Sprung weiter unten in einem leeren
           Akkordion, löscht die Absicht und die Navigation endet stumm auf der
           Plattformübersicht. Genau das passierte bei unterschriebenen
           Petitionen: die sind häufig längst beendet, liegen also unter
           „Beendet" und nie in der aktiven Liste. */
        var zielHier = false;
        if (state.openPetitionUrl) {
          var zi = items.findIndex(function (r) {
            return r.url === state.openPetitionUrl; });
          if (zi >= 0) {
            zielHier = true;
            // Nach vorne holen, damit sie innerhalb der ersten LIST_MAX landet.
            if (zi > 0) items.unshift(items.splice(zi, 1)[0]);
          }
        }
        if (zielHier) state[stateKey] = true;   // bleibt bei Filterwechsel offen
        var open = state[stateKey] || zielHier;
        var sec = el('<section class="accordion langgroup bottomacc' +
          (open ? " open" : "") + '" id="' + id + '"></section>');
        var hd = el('<button class="acc-head"><span class="acc-title">' +
          '<i class="fa-solid ' + icon + '"></i> ' + label +
          '<span class="acc-count">' + items.length + "</span></span>" +
          '<i class="fa-solid fa-chevron-down acc-chev"></i></button>');
        var bd = el('<div class="acc-body"></div>');
        var gefuellt = false;
        function fuellen() {
          if (gefuellt) return;
          gefuellt = true;
          if (!items.length) {
            bd.appendChild(el('<div class="count-note" style="margin:6px 2px">' +
              empty + "</div>"));
            return;
          }
          items.slice(0, LIST_MAX).forEach(function (r) { bd.appendChild(petCard(r, ctx, key)); });
          if (items.length > LIST_MAX)
            bd.appendChild(el('<div class="count-note">' + restNote + "</div>"));
        }
        hd.addEventListener("click", function () {
          var o = !sec.classList.contains("open");
          sec.classList.toggle("open", o); state[stateKey] = o;
          if (o) fuellen();
        });
        if (open) fuellen();
        sec.appendChild(hd); sec.appendChild(bd);
        listWrap.appendChild(sec);
      }
      // Nur zeigen, wo die Quelle beendete Petitionen kennt (bisher Bundestag).
      if (closedRows.length)
        bottomSection("pet-beendet", "fa-flag-checkered", "Beendet", closedRows,
          "closedOpen", "Keine beendeten Petitionen.");
      bottomSection("pet-archiv", "fa-box-archive", "Archiv", archived,
        "archiveOpen", "Noch nichts archiviert. Wische eine Petition nach links.");
      bottomSection("pet-offline", "fa-circle-xmark", "Offline", offline,
        "offlineOpen", "Keine Offline-Petitionen.");

      /* Nach Navigation aus „Ähnliche Petitionen" oder aus den unterschriebenen
         Petitionen: Ziel aufklappen + hinscrollen. Die Abfrage umfasst auch die
         unteren Akkordeons, weil deren Abschnitte in listWrap hängen — sie
         greift dort aber nur, wenn der Abschnitt vorher gefüllt wurde (siehe
         zielHier in bottomSection). */
      if (state.openPetitionUrl) {
        var target = state.openPetitionUrl; state.openPetitionUrl = null;
        var pets = listWrap.querySelectorAll(".pet");
        var gefunden = false;
        for (var pi = 0; pi < pets.length; pi++) {
          if (pets[pi].dataset.url === target) {
            gefunden = true;
            var petEl = pets[pi];
            if (!petEl.classList.contains("open"))
              petEl.querySelector(".pet__head").click();
            (function (elm) {
              /* Oberkante statt Mitte – siehe scrollToTop(): die Karte ist
                 gerade eben aufgeklappt und damit um ein Vielfaches höher als
                 das Bild. */
              setTimeout(function () { scrollToTop(elm); }, 80);
            })(petEl);
            break;
          }
        }
        /* Nichts gefunden heißt: die Petition steht nicht mehr in den Daten
           dieser Plattform — etwa weil ihr Slug gewechselt hat. Das muss man
           sehen; ein Klick ohne jede Wirkung ist als Fehler nicht erkennbar
           (gleiche Überlegung wie bei jumpBtn). */
        if (!gefunden)
          listWrap.insertBefore(el('<div class="count-note">Diese Petition ' +
            "steht nicht mehr in den Daten dieser Plattform. Vermutlich hat " +
            "sich ihre Adresse geändert.</div>"), listWrap.firstChild);
      }
    }

    searchBox.addEventListener("input", function () {
      state.search = searchBox.value;
      if (state.dataCache[key]) draw(state.dataCache[key]);
    });

    loadPlatformData(key).then(draw).catch(function () {
      note.textContent = "Daten konnten nicht geladen werden.";
    });
  }

  // ---- Rendering: Plattformübergreifende Suche ------------------------------
  // Zeigt zum aktiven Filter (Kategorie ODER Schlagwort) passende Petitionen aus
  // ALLEN aktivierten Plattformen, je Plattform gruppiert. "Zurück" kehrt zum
  // Plattform-Detail zurück – der Filter dort bleibt erhalten.
  function crossMatch(r, v) {
    if ((r.tags || []).some(function (t) { return t.toLowerCase() === v; })) return true;
    if ((r.category || "").toLowerCase() === v) return true;
    var hay = ((r.title || "") + " " + (r.summary || "") + " " +
               (r.category || "") + " " + (r.started_by || "") + " " +
               (r.tags || []).join(" ")).toLowerCase();
    return hay.indexOf(v) > -1;
  }

  function renderCrossSearch() {
    var f = state.cross;
    /* Kein Seitentitel mehr (Nutzerwunsch 3.8.26): „SUCHE: WASSER" stand
       unmittelbar über einer Zeile, die dasselbe noch einmal sagt — die
       Brotkrume darunter nennt Art und Wort der Suche vollständig
       („Volltextsuche: Wasser"). .pagekick:empty blendet sich selbst aus. */
    titleEl.textContent = "";
    content.innerHTML = "";

    var backLabel = f.fromPlatform
      ? "Zurück zu " + platformName(f.fromPlatform) : "Zurück zur Übersicht";
    var head = el('<div class="subhead">' +
      '<button class="backbtn"><i class="fa-solid fa-chevron-left"></i> ' +
      esc(backLabel) + "</button></div>");
    head.querySelector(".backbtn").addEventListener("click", function () {
      state.cross = null; render();
    });
    content.appendChild(head);

    var crumb = el('<div class="crosshead"></div>');
    content.appendChild(crumb);
    var note = el('<div class="count-note">Suche über alle Plattformen …</div>');
    content.appendChild(note);
    var listWrap = el('<div id="crosslist"></div>');
    content.appendChild(listWrap);

    var plats = livePlatforms().filter(function (p) { return isEnabled(p.key); });

    function drawCross() {
      var v = String(state.cross.value).toLowerCase();
      crumb.innerHTML = (state.cross.type === "cat"
        ? '<i class="fa-solid fa-tag"></i> Kategorie'
        : state.cross.type === "tag"
        ? '<i class="fa-solid fa-hashtag"></i> Schlagwort'
        : '<i class="fa-solid fa-magnifying-glass"></i> Volltextsuche') +
        ': <b>' + esc(state.cross.value) + "</b>";

      var ctx = {
        redraw: function () {
          var y = window.scrollY; drawCross(); window.scrollTo(0, y);
        },
        setCat: function (cat) {
          if (!cat) return; state.cross.type = "cat"; state.cross.value = cat;
          drawCross(); window.scrollTo(0, 0);
        },
        setTag: function (tag) {
          if (!tag) return; state.cross.type = "tag"; state.cross.value = tag;
          drawCross(); window.scrollTo(0, 0);
        }
      };

      listWrap.innerHTML = "";
      var total = 0, nPlat = 0;
      plats.forEach(function (p) {
        var arr = state.dataCache[p.key];
        if (!arr) return;
        var hits = arr.filter(function (r) {
          return !isArchived(r.url) && !isClosed(r) &&
                 (r.status || "online") !== "offline" && crossMatch(r, v);
        });
        if (!hits.length) return;
        nPlat++; total += hits.length;
        var info = langInfo(p.language || "de");
        var sec = el('<section class="accordion langgroup crossgroup open"></section>');
        /* Logo hinter dem Namen wie auf den anderen Übersichtsseiten
           (Nutzerwunsch 3.8.26). --brand muss am Kopf selbst stehen: die
           Farbrollen des Logos lesen die Variable, und anders als bei .plat
           gibt es hier kein umgebendes Element, das sie schon setzt. */
        var pcol = (platInfo(p.key) || {}).color;
        var hd = el('<button class="acc-head"' +
          (pcol ? ' style="--brand:' + esc(pcol) + '"' : "") +
          '><span class="acc-title">' +
          esc(p.name) + '<span class="flag">' + info.flag + "</span>" +
          '<span class="acc-count">' + hits.length + "</span></span>" +
          platLogo(p.key, p.name) +
          '<i class="fa-solid fa-chevron-down acc-chev"></i></button>');
        hd.addEventListener("click", function () {
          sec.classList.toggle("open", !sec.classList.contains("open"));
        });
        var bd = el('<div class="acc-body"></div>');
        hits.slice(0, 100).forEach(function (r) { bd.appendChild(petCard(r, ctx, p.key)); });
        sec.appendChild(hd); sec.appendChild(bd);
        listWrap.appendChild(sec);
      });

      note.textContent = total
        ? nf.format(total) + " Treffer auf " + nPlat + " Plattform(en)"
        : "Keine Treffer.";
      if (!total)
        listWrap.appendChild(el('<div class="empty">Zu „' +
          esc(state.cross.value) + '" wurde auf den aktivierten Plattformen ' +
          "nichts gefunden.</div>"));
    }

    Promise.all(plats.map(function (p) {
      return loadPlatformData(p.key).catch(function () { return []; });
    })).then(function () { drawCross(); }).catch(function () {
      note.textContent = "Daten konnten nicht geladen werden.";
    });
  }

  // ---- Rendering: Einstellungen ---------------------------------------------
  function ensureSet() {   // Default (null = alle) in echte Menge wandeln
    if (state.enabled === null)
      state.enabled = new Set(livePlatforms().map(function (x) { return x.key; }));
    return state.enabled;
  }

  // Abschnitts-Überschrift für die Einstellungs-Liste.
  function setSection(label) {
    return el('<div class="sect">' + esc(label) + "</div>");
  }
  // Eine Zeile im Listen-Layout: Icon, Titel, Untertitel, rechts ein Element.
  function setRow(icon, title, sub, opts) {
    opts = opts || {};
    var tag = opts.button === false ? "div" : "button";
    var cls = "srow" + (opts.cls ? " " + opts.cls : "");
    var row = el("<" + tag + ' class="' + cls + '"' +
      (tag === "button" ? ' type="button"' : "") + ">" +
      '<span class="srow__ic"><i class="fa-solid ' + icon + '"></i></span>' +
      '<span class="srow__body"><span class="srow__t">' + esc(title) + "</span>" +
      (sub ? '<span class="srow__s">' + esc(sub) + "</span>" : "") +
      "</span>" +
      '<span class="srow__end"></span></' + tag + ">");
    if (opts.end) row.querySelector(".srow__end").innerHTML = opts.end;
    if (opts.onClick) row.addEventListener("click", opts.onClick);
    return row;
  }

  function renderEinstellungen() {
    titleEl.textContent = "Einstellungen";
    var live = livePlatforms()
      .sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
    var activeCount = live.filter(function (p) { return isEnabled(p.key); }).length;
    var allOn = activeCount === live.length;

    // Seitenüberschrift wie auf der Liste: die Seite soll über die Überschrift
    // tragen, nicht über die schmale Kopfleiste.
    content.innerHTML =
      '<div class="welcome"><h1 class="welcome__t">Einstellungen</h1>' +
      '<p class="welcome__s">' +
      esc(T("settings.intro", "Wähle, welche Petitionsplattformen in der " +
                              "Liste erscheinen sollen.")) + "</p></div>";

    // ---- Darstellung ---------------------------------------------------------
    // Bewusst GANZ OBEN: das Plattform-Akkordion darunter ist offen rund 1.300 px
    // hoch, alles dahinter lag damit zwei Bildschirmhöhen tief und war praktisch
    // unauffindbar.
    content.appendChild(setSection(T("settings.sections.appearance", "Darstellung")));

    // Zwei Schalterleisten nach demselben Muster: Farbdesign und Layout.
    // Beide setzen nur ein Attribut auf <html> und speichern die Wahl – kein
    // Neuzeichnen nötig, weil ausschließlich CSS daran hängt.
    function segControl(label, items, current, pick) {
      var seg = el('<div class="seg" role="group" aria-label="' +
        esc(label) + '"></div>');
      items.forEach(function (it) {
        var b = el('<button class="seg__b' +
          (current === it[0] ? " on" : "") + '" type="button">' +
          '<i class="fa-solid ' + it[2] + '"></i> ' + esc(it[1]) + "</button>");
        b.addEventListener("click", function () {
          pick(it[0]);
          seg.querySelectorAll(".seg__b").forEach(function (x) {
            x.classList.remove("on"); });
          b.classList.add("on");
        });
        seg.appendChild(b);
      });
      return seg;
    }

    content.appendChild(segControl("Farbdesign",
      [["light", T("settings.themeLight", "Hell"), "fa-sun"],
       ["dark", T("settings.themeDark", "Dunkel"), "fa-moon"],
       ["auto", T("settings.themeAuto", "Automatisch"), "fa-circle-half-stroke"]],
      state.prefs.theme,
      function (v) { state.prefs.theme = v; savePrefs(); applyTheme(); }));
    content.appendChild(el('<div class="srow__note">' +
      esc(T("settings.darkModeHint",
            "„Automatisch“ folgt der Einstellung deines Geräts.")) + "</div>"));

    content.appendChild(el('<div class="srow__lbl">' +
      esc(T("settings.layoutLabel", "Layout")) + "</div>"));
    content.appendChild(segControl("Layout",
      [["relief", T("settings.layoutRelief", "Relief"), "fa-cube"],
       ["magazin", T("settings.layoutMag", "Magazin"), "fa-image"]],
      state.prefs.layout,
      function (v) { state.prefs.layout = v; savePrefs(); applyLayout(); }));
    content.appendChild(el('<div class="srow__note">' +
      esc(T("settings.layoutHint",
            "Ändert nur das Aussehen der Listen, nicht die Inhalte.")) +
      "</div>"));

    /* Akzentfarbe des Magazins (7.8.26). Immer sichtbar, auch in Relief:
       die Seite wird beim Layout-Umschalten NICHT neu gezeichnet (pick()
       wendet nur an), eine erst-im-Magazin-Fassung erschiene also nie.
       Der Hinweis darunter benennt den Geltungsbereich. Die Punkte zeigen
       die HELLE Stufe (--mz-accent) — die ist wiedererkennbar; gefüllte
       Bedienflächen nutzen intern die dunklere (Kontrast, layouts.css). */
    /* Zur Auswahl stehen die ECHTEN Markenfarben der Plattformen
       (Nutzerwunsch 7.8.26). Die Liste kommt deshalb aus PM_PLATFORMS
       und wächst mit jeder neuen Plattform von selbst mit — nachzutragen
       ist dann nur die Palette in layouts.css.
       Die Gruppen „kräftig" und „hell" sind keine Geschmacksfrage: auf
       kräftigen Marken steht die Schrift weiß, auf hellen dunkel
       (--mz-on-accent). Eingeteilt wird nach relativer Helligkeit
       (WCAG-Formel), damit ein künftiger Eintrag ohne Handarbeit im
       richtigen Block landet.
       Die Schwelle ist NICHT geschätzt, sondern der ausgerechnete
       Umschlagpunkt: dort ist der Kontrast zu Weiß genauso groß wie der
       zu --ink (#1e1c18, Leuchtdichte 0,0117), also
       √(1,05 × 0,0617) − 0,05 = 0,2046. Ein erster Versuch mit 0,16
       sortierte WeAct (0,181) und Avaaz (0,177) falsch nach „hell",
       obwohl auf beiden Weiß besser liest (4,5 gegen 3,7) — die
       Gruppierung widersprach damit den Paletten in layouts.css. */
    function relLum(hex) {
      var f = function (paar) {
        var v = parseInt(paar, 16) / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(hex.substr(1, 2)) + 0.7152 * f(hex.substr(3, 2)) +
             0.0722 * f(hex.substr(5, 2));
    }
    var ACCENTS = [["koralle", "#e15b52",
      T("settings.accentKoralle", "Koralle"), false]];
    Object.keys(window.PM_PLATFORMS || {}).forEach(function (k) {
      var p = window.PM_PLATFORMS[k];
      if (!p || !p.color) return;
      ACCENTS.push([k, p.color, platformName(k) || k,
                    relLum(p.color) > 0.2046]);
    });
    content.appendChild(el('<div class="srow__lbl">' +
      esc(T("settings.accentLabel", "Akzentfarbe")) + "</div>"));
    /* EINE Reihe mit allen Farben, darunter die Schriftfarbe zur freien
       Wahl (Nutzerwunsch 7.8.26 — vorher zwei benannte Gruppen mit
       Erklärtexten drumherum). Die gerechnete Empfehlung steckt jetzt
       in „Automatisch": sie nimmt je Farbe die besser lesbare Seite
       (siehe Schwelle oben). Wer will, überschreibt sie. */
    var acbar = el('<div class="acbar" role="group" aria-label="' +
      esc(T("settings.accentLabel", "Akzentfarbe")) + '"></div>');
    ACCENTS.forEach(function (a) {
      var b = el('<button class="acbtn' +
        (state.prefs.accent === a[0] ? " on" : "") +
        '" type="button" style="--sw:' + a[1] + '" aria-label="' +
        esc(a[2]) + '" title="' + esc(a[2]) + '"></button>');
      b.addEventListener("click", function () {
        state.prefs.accent = a[0]; savePrefs(); applyLayout();
        acbar.querySelectorAll(".acbtn").forEach(function (x) {
          x.classList.remove("on"); });
        b.classList.add("on");
      });
      acbar.appendChild(b);
    });
    content.appendChild(acbar);
    content.appendChild(segControl(T("settings.accentInkLabel", "Schrift"),
      [["auto", T("settings.accentInkAuto", "Automatisch"), "fa-wand-magic-sparkles"],
       ["light", T("settings.accentInkLight", "Hell"), "fa-sun"],
       ["dark", T("settings.accentInkDark", "Dunkel"), "fa-moon"]],
      state.prefs.accentInk || "auto",
      function (v) { state.prefs.accentInk = v; savePrefs(); applyLayout(); }));

    /* WARUM ES DIESE OPTION BRAUCHT (am 29.7.26 nachgemessen): die Plattformen
       setzen unverkleinerte Pressebilder in den Aufruf-Text. 35 abrufbare
       Bilder, zusammen 27,5 MB, im Mittel 804 KB — das größte ein einzelnes
       foodwatch-PNG mit 17,25 MB, mehr als ein Achtel aller 14.036 Volltexte
       zusammen. Da die Bilder EINGEBETTET sind, kann die App sie nicht
       verkleinern; abschalten ist der einzige Schutz. Deshalb ist die Option
       kein Beiwerk, sondern die Gegenmaßnahme.
       EIN EIGENES BILD-PAKET (Kopien selbst ausliefern, umkodiert auf 800 px)
       wurde gebaut und wieder verworfen: es nützte nur foodwatch — 24,5 MB
       wären auf 0,92 MB geschrumpft —, aber images.avaaz.org beantwortet
       robots.txt mit HTTP 403, seine 16 Bilder dürfen wir nicht kopieren. Für
       eine Plattform lohnte die Mechanik nicht, und eigene Kopien fremder
       Bilder zu verbreiten ist rechtlich etwas anderes als einbetten. Die
       6.037 Vorschaubilder der Listenansicht bleiben aus demselben Grund
       eingebettet; selbst ausgeliefert wären sie auch umkodiert rund 83 MB.

       Anders als Farbdesign und Layout hängt das
       nicht nur an CSS: ausgeschaltet werden die <img> beim Aufbau der
       Beschreibung entfernt (stripImages), deshalb muss die Ansicht danach neu
       gezeichnet werden. Aufgeklappte Petitionen bleiben dabei offen, weil der
       Zustand in state und nicht im DOM steht. */
    var imgRow = el('<div class="srow srow--static">' +
      '<span class="srow__ic"><i class="fa-solid fa-image"></i></span>' +
      '<span class="srow__body"><span class="srow__t">' +
      esc(T("settings.descImagesLabel", "Bilder in Beschreibungen laden")) +
      "</span>" +
      '<span class="srow__s srow__imgnote"></span></span>' +
      '<span class="srow__end"><label class="switch"><input type="checkbox"' +
      (state.prefs.descImages ? " checked" : "") +
      '><span class="slider"></span></label></span></div>');
    var imgNote = imgRow.querySelector(".srow__imgnote");
    function refreshImgNote() {
      imgNote.textContent = state.prefs.descImages
        ? T("settings.descImagesOn",
            "Fotos und Logos werden beim Öffnen einer Petition aus dem Internet "
            + "nachgeladen. Das setzt eine Internetverbindung voraus und "
            + "verbraucht Datenvolumen – einzelne Bilder sind mehrere Megabyte "
            + "groß. Unterwegs am besten nur im WLAN einschalten.")
        : T("settings.descImagesOff",
            "Nur Text. Es werden keine Bilddateien aus dem Internet abgerufen, "
            + "es entsteht also kein Datenverbrauch für Bilder.");
    }
    refreshImgNote();
    imgRow.querySelector("input").addEventListener("change", function () {
      state.prefs.descImages = this.checked;
      savePrefs(); refreshImgNote();
      // render() endet mit scrollTo(0,0) — ohne das Merken stünde man nach dem
      // Umschalten wieder oben in den Einstellungen statt am Schalter.
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      render();
      window.scrollTo(0, y);
    });
    content.appendChild(imgRow);

    /* Favoriten-Erklärung: steht direkt über der Plattform-Liste, also dort,
       wo die Sterne sind. Wegklickbar wie der Wisch-Hinweis, mit demselben
       Muster (eigener localStorage-Schlüssel, Element entfernen). */
    if (!LS.getItem("favTipDismissed")) {
      var favTip = el('<div class="favtip">' +
        '<i class="fa-solid fa-star"></i>' +
        '<div><h3 class="hint-title">' +
        esc(T("favorites.howTitle", "Favoriten anlegen")) + "</h3>" +
        "<p>" + esc(T("favorites.how",
          "Tippe auf den Stern neben einer Plattform, um sie zu einem " +
          "Favoriten zu machen. Favoriten erscheinen immer ganz oben in " +
          "der Liste.")) + "</p>" +
        '<button class="hint-dismiss" type="button">' +
        '<i class="fa-solid fa-check"></i> Verstanden, nicht mehr anzeigen' +
        "</button></div></div>");
      favTip.querySelector(".hint-dismiss").addEventListener("click", function () {
        LS.setItem("favTipDismissed", "1"); favTip.remove();
      });
      content.appendChild(favTip);
    }

    // Akkordion "Plattformen"
    var acc = el('<section class="accordion' +
      (state.settingsOpen ? " open" : "") + '"></section>');
    var head = el('<button class="acc-head"><span class="acc-title">Plattformen' +
      '<span class="acc-count">' + activeCount + "/" + live.length +
      ' aktiv</span></span>' +
      '<i class="fa-solid fa-chevron-down acc-chev"></i></button>');
    head.addEventListener("click", function () {
      state.settingsOpen = !state.settingsOpen;
      acc.classList.toggle("open", state.settingsOpen);
    });
    acc.appendChild(head);

    var body = el('<div class="acc-body"></div>');

    // "Alle deaktivieren / Alle aktivieren"-Button (wird UNTER die Liste gesetzt)
    var toggleAll = el('<button class="btn-secondary">' +
      (allOn ? "Alle deaktivieren" : "Alle aktivieren") + "</button>");
    toggleAll.addEventListener("click", function () {
      if (allOn) state.enabled = new Set();          // alle aus
      else state.enabled = new Set(live.map(function (x) { return x.key; }));
      saveEnabled();
      renderEinstellungen();                         // neu zeichnen
    });

    live.concat(state.manifest.platforms.filter(function (p) { return !p.live; }))
        .forEach(function (p) {
      var on = p.live && isEnabled(p.key);
      var finfo = langInfo(p.language || "de");
      var fav = p.live && isFav(p.key);
      var brand = platColor(p.key);
      var opt = el('<div class="opt' + (p.live ? "" : " disabled") + '"' +
        (brand ? ' style="--brand:' + esc(brand) + '"' : "") + ">" +
        /* Logo NACH der Beschriftung. Das ist zugleich die bessere Lesefolge
           für Screenreader: erst der Name, dann „Logo <Name>". */
        '<div class="opt__body"><div class="opt__name">' + esc(p.name) +
          '<span class="flag">' + finfo.flag + '</span></div>' +
        '<div class="opt__meta">' + (p.live
          ? finfo.name + " · " + nf.format(p.online) + " Petitionen"
          : finfo.name + " · in Vorbereitung") + '</div></div>' +
        platLogo(p.key, p.name) +
        '<button class="favbtn' + (fav ? " on" : "") + '"' +
          (p.live ? "" : " disabled") + ' aria-label="Als Favorit markieren">' +
          '<i class="' + (fav ? "fa-solid" : "fa-regular") + ' fa-star"></i></button>' +
        '<label class="switch"><input type="checkbox"' +
          (on ? " checked" : "") + (p.live ? "" : " disabled") +
          '><span class="slider"></span></label></div>');

      // Stern-Button: Favorit umschalten
      var favBtn = opt.querySelector(".favbtn");
      if (p.live) favBtn.addEventListener("click", function () {
        if (isFav(p.key)) state.favorites.delete(p.key);
        else state.favorites.add(p.key);
        saveFavorites();
        var nowFav = isFav(p.key);
        favBtn.classList.toggle("on", nowFav);
        favBtn.querySelector("i").className =
          (nowFav ? "fa-solid" : "fa-regular") + " fa-star";
      });

      var input = opt.querySelector("input");
      input.addEventListener("change", function () {
        ensureSet();
        if (input.checked) state.enabled.add(p.key);
        else state.enabled.delete(p.key);
        saveEnabled();
        // Kopf-Zähler live aktualisieren, ohne komplettes Neuzeichnen
        var n = live.filter(function (x) { return isEnabled(x.key); }).length;
        head.querySelector(".acc-count").textContent = n + "/" + live.length + " aktiv";
        toggleAll.textContent = (n === live.length) ? "Alle deaktivieren"
                                                    : "Alle aktivieren";
        allOn = (n === live.length);
      });
      body.appendChild(opt);
    });

    body.appendChild(toggleAll);          // Button unter der Plattform-Liste
    acc.appendChild(body);
    content.appendChild(acc);

    // ---- Benachrichtigungen --------------------------------------------------
    content.appendChild(setSection(
      T("settings.sections.notify", "Benachrichtigungen")));
    content.appendChild(renderNotifyBox());

    // ---- Daten ---------------------------------------------------------------
    content.appendChild(setSection(T("settings.sections.data", "Daten")));
    var refreshRow = setRow("fa-arrows-rotate",
      T("settings.refresh", "Daten aktualisieren"),
      state.lastRefresh
        ? "Aktualisiert am " + fmtDateTime(state.lastRefresh) + " · Quelle: " +
          (state.baseAuto === "live" ? "live" : "mitgeliefert")
        : T("settings.refreshHint", "Petitionen neu von der Quelle laden"),
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>' });
    refreshRow.addEventListener("click", function () {
      var sub = refreshRow.querySelector(".srow__s");
      sub.textContent = "Wird geladen …";
      // Auch die Quelle neu bestimmen: wer vorher im Funkloch startete, sitzt
      // sonst bis zum nächsten App-Start auf den mitgelieferten Daten fest.
      state.dataCache = {}; textChunks = {};
      resolveBase().then(loadManifest).then(function () {
        /* Die Listen hängen an state.dataCache, nicht am Manifest. Das Leeren
           allein macht nichts sichtbar — die Petitionen kommen erst beim
           nächsten Zeichnen neu. Ohne das hier behauptete die Zeile
           „aktualisiert", während die Ansicht unverändert alt blieb.
           Das Ergebnis geht in den Zustand, nicht in dieses DOM-Element:
           render() ersetzt den Inhalt, danach ist `sub` nicht mehr im
           Dokument und ein Schreiben darauf wäre unsichtbar. */
        state.lastRefresh = new Date().toISOString();
        render();
      }).catch(function () { sub.textContent = "Nicht erreichbar."; });
    });
    content.appendChild(refreshRow);

    /* ⚠️ Ausgesetzt, nicht entfernt (Nutzerwunsch 6.8.2026: „das versteht man
       schlecht … die Quelle soll immer festgeschrieben sein"). Der ganze Block
       bleibt stehen; ZEIGE.datenquelle auf `true` bringt ihn unverändert
       zurück. Solange er ruht, steht die Quelle auf QUELLE_FEST — und der in
       localStorage gespeicherte Wert wird bewusst übergangen, sonst hinge ein
       früher gewählter Wert unsichtbar nach.
       Was ohne Verbindung passiert, erklärt jetzt der Offline-Hinweis am
       unteren Rand statt dieses Umschalters. */
    if (ZEIGE.datenquelle) {
    content.appendChild(el('<div class="srow__lbl">' +
      esc(T("settings.source", "Datenquelle")) + "</div>"));
    content.appendChild(segControl("Datenquelle",
      [[AUTO, T("settings.srcAuto", "Automatisch"), "fa-wand-magic-sparkles"],
       [BUNDLED_BASE, T("settings.srcBundled", "Mitgeliefert"), "fa-box-archive"],
       [LIVE_BASE, T("settings.srcLive", "Live"), "fa-cloud-arrow-down"]],
      state.baseSetting,
      function (v) {
        state.baseSetting = v;
        LS.setItem("dataBase", v);
        reloadData();     // zeichnet die Einstellungen samt Hinweis neu
      }));
    content.appendChild(el('<div class="srow__note">' + esc(
      state.baseSetting === AUTO
        ? "Aktiv: " + (state.baseAuto === "live" ? "Live" : "Mitgeliefert") +
          (state.baseWhy ? " – " + state.baseWhy : "") +
          ". „Automatisch“ nimmt die tagesaktuellen Daten, wenn sie erreichbar " +
          "und neuer sind als die mitgelieferten."
        : state.baseSetting === BUNDLED_BASE
          ? "Nur die Daten aus dem App-Paket. Sie veralten, bis eine neue " +
            "Fassung der App kommt."
          : "Immer aus dem Netz. Ohne Verbindung greift die App auf die " +
            "mitgelieferten Daten zurück."
      ) + "</div>"));
    content.appendChild(setRow("fa-database",
      T("settings.sourceCustom", "Eigene Quelle"),
      isRemote(state.baseSetting) && state.baseSetting !== LIVE_BASE
        ? state.baseSetting
        : T("settings.sourceCustomHint", "Für Tests: eigener Basis-Ordner"),
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>',
        onClick: function () {
          var v = prompt("URL der Datenquelle (Basis-Ordner mit manifest.json):",
                         state.base);
          if (v == null) return;
          state.baseSetting = v.trim() || DEFAULT_BASE;
          LS.setItem("dataBase", state.baseSetting);
          reloadData();
        } }));
    }   // Ende ZEIGE.datenquelle

    content.appendChild(setRow("fa-circle-info",
      T("settings.about", "Über die App"), null,
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>',
        onClick: showAbout }));

    // ---- Zurücksetzen --------------------------------------------------------
    content.appendChild(setSection(T("settings.sections.reset", "Zurücksetzen")));
    content.appendChild(el('<div class="srow__note">' +
      esc(T("reset.intro", "")) + "</div>"));

    var wizRow = setRow("fa-wand-magic-sparkles",
      T("reset.wizard", "Ersteinrichtung neu starten"),
      T("reset.wizardHint", "Sprachen und Plattformen erneut auswählen"),
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>',
        onClick: function () { startWizard(); } });
    content.appendChild(wizRow);

    var hintRow = setRow("fa-circle-question",
      T("reset.hints", "Hilfe-Hinweise zurücksetzen"),
      T("reset.hintsHint", "Ausgeblendete Hinweise wieder anzeigen"),
      { end: '<i class="fa-solid fa-arrow-rotate-left srow__go"></i>' });
    hintRow.addEventListener("click", function () {
      HINT_KEYS.forEach(function (k) { LS.removeItem(k); });
      hintRow.classList.add("srow--done");
      hintRow.querySelector(".srow__s").textContent =
        "Zurückgesetzt – die Hinweise erscheinen wieder.";
      hintRow.querySelector(".srow__go").className = "fa-solid fa-check srow__go";
      /* Neu zeichnen, damit der Favoriten-Hinweis sofort wieder auftaucht: er
         steht auf DIESER Seite, ohne Neuzeichnen bliebe die Rückmeldung
         behauptet statt sichtbar. Verzögert, damit der Haken kurz zu sehen ist. */
      setTimeout(render, 900);
    });
    content.appendChild(hintRow);

    content.appendChild(renderDangerZone());
  }

  // Doppelt abgesicherter Bereich: erst aufklappen, dann bewusst bestätigen.
  function renderDangerZone() {
    var box = el('<div class="danger">' +
      '<button class="danger__head" type="button">' +
      '<span class="srow__ic"><i class="fa-solid fa-triangle-exclamation"></i></span>' +
      '<span class="srow__body"><span class="srow__t">' +
      esc(T("reset.all", "Alle Daten zurücksetzen")) + "</span>" +
      '<span class="srow__s">' +
      esc(T("reset.allHint", "Löscht alles, was du in der App gesammelt hast")) +
      "</span></span>" +
      '<i class="fa-solid fa-chevron-down srow__go"></i></button>' +
      '<div class="danger__body"></div></div>');
    var body = box.querySelector(".danger__body");
    box.querySelector(".danger__head").addEventListener("click", function () {
      box.classList.toggle("open");
    });

    body.appendChild(el('<div class="danger__warn"><b>' +
      esc(T("reset.allWarnTitle", "Das lässt sich nicht rückgängig machen.")) +
      "</b><p>" +
      esc(T("reset.allWarnText",
            "Gelöscht werden: Favoriten, unterzeichnete Petitionen, Archiv, " +
            "deine Plattform-Auswahl sowie Name und Profilbild.")) +
      "</p></div>"));

    // Zusatzabfrage: erst das Häkchen macht den Knopf scharf.
    var confirmLabel = T("reset.allConfirmLabel",
      "Ja, ich möchte alle meine Daten löschen.");
    var chk = el('<label class="danger__check"><input type="checkbox">' +
      "<span>" + esc(confirmLabel) + "</span></label>");
    var go = el('<button class="danger__btn" type="button" disabled>' +
      '<i class="fa-solid fa-trash-can"></i> ' +
      esc(T("reset.allConfirmBtn", "Endgültig löschen")) + "</button>");
    chk.querySelector("input").addEventListener("change", function () {
      go.disabled = !this.checked;
    });
    go.addEventListener("click", function () {
      if (!window.confirm(T("reset.allWarnTitle",
            "Das lässt sich nicht rückgängig machen.") + "\n\n" +
            T("reset.allWarnText", "") + "\n\nWirklich alles löschen?")) return;
      wipeEverything();
      box.classList.add("danger--done");
      body.innerHTML = '<div class="danger__done"><i class="fa-solid fa-check"></i> ' +
        esc(T("reset.doneToast", "Alle Daten wurden gelöscht.")) + "</div>";
      setTimeout(function () { startWizard(); }, 900);
    });
    body.appendChild(chk);
    body.appendChild(go);
    return box;
  }

  // Löscht restlos alles, was die App lokal abgelegt hat.
  function wipeEverything() {
    BACKUP_KEYS.concat([PREFS_KEY]).forEach(function (k) { LS.removeItem(k); });
    state.enabled = null;
    state.favorites = new Set();
    state.signed = new Map();
    state.archived = new Set();
    state.prefs = defaultPrefs();
    state.baseSetting = DEFAULT_BASE;   // zurück auf "auto"
    savePrefs();
    applyTheme();
    applyLayout();
  }

  // ---- Benachrichtigungen ----------------------------------------------------
  // Ehrliche Umsetzung ohne Server: die App prüft, während sie läuft, ob die
  // gewählte Uhrzeit heute schon erreicht war, und meldet sich dann EINMAL.
  // Ein echter Push zu einer festen Uhrzeit bräuchte einen Server – das steht
  // so auch im Hinweistext, damit niemand etwas anderes erwartet.
  var notifyTimer = null;

  /* Android-Brücke (MainActivity.NotifyBridge). Sie hat Vorrang, wo sie
     existiert: im WebView fehlt die Web-Notification-API ersatzlos, dort ginge
     es ohne sie überhaupt nicht. Zusätzlich weckt sie über den AlarmManager,
     also auch bei geschlossener App — das kann die Web-Variante grundsätzlich
     nicht, die braucht eine laufende Seite. */
  var AN = window.AndroidNotify || null;
  function notifySupported() { return !!AN || ("Notification" in window); }
  function notifyPermission() {
    if (AN) return AN.permission();
    return ("Notification" in window) ? Notification.permission : "denied";
  }
  function notifyRequest() {
    if (!AN) return Notification.requestPermission();
    /* Android antwortet nicht auf dem Rückweg des Aufrufs, sondern später über
       onRequestPermissionsResult. Bis das Ereignis kommt, wissen wir nichts. */
    AN.requestPermission();
    return new Promise(function (resolve) {
      var fertig = function () {
        window.removeEventListener("androidNotifyPermission", fertig);
        resolve(AN.permission());
      };
      window.addEventListener("androidNotifyPermission", fertig);
      // Notausgang, falls der Dialog weggewischt wird und nie ein Ergebnis kommt.
      setTimeout(fertig, 30000);
    });
  }
  /* Weckruf im Android-Teil setzen bzw. abbestellen. Ohne Brücke ein Nichts —
     im Browser bleibt es beim Minutentakt in scheduleNotify(). */
  function notifySyncAlarm() {
    if (!AN) return;
    var n = state.prefs.notify;
    if (n.on && notifyPermission() === "granted") {
      var t = String(n.time || "09:00").split(":");
      AN.schedule(parseInt(t[0], 10) || 0, parseInt(t[1], 10) || 0);
    } else {
      AN.cancel();
    }
  }

  function renderNotifyBox() {
    var n = state.prefs.notify;
    var box = el('<div class="nbox"></div>');

    box.appendChild(el('<div class="srow__note">' +
      esc(T("notify.intro",
            "Einmal am Tag eine kurze Info über neue Petitionen.")) +
      "</div>"));

    var main = el('<div class="srow srow--static">' +
      '<span class="srow__ic"><i class="fa-solid fa-bell"></i></span>' +
      '<span class="srow__body"><span class="srow__t">' +
      esc(T("notify.enable", "Tägliche Info")) + "</span>" +
      '<span class="srow__s nbox__state"></span></span>' +
      '<span class="srow__end"><label class="switch">' +
      '<input type="checkbox"' + (n.on ? " checked" : "") +
      '><span class="slider"></span></label></span></div>');
    var stateLbl = main.querySelector(".nbox__state");
    var detail = el('<div class="nbox__detail"' +
      (n.on ? "" : ' style="display:none"') + "></div>");

    function refreshState() {
      if (!notifySupported()) {
        stateLbl.textContent = "Dieses Gerät unterstützt keine Benachrichtigungen.";
      } else if (notifyPermission() === "denied") {
        stateLbl.textContent = T("notify.permissionDenied",
          "In den Geräte-Einstellungen gesperrt.");
      } else if (n.on) {
        stateLbl.textContent = "Täglich um " + n.time + " Uhr";
      } else {
        stateLbl.textContent = "Aus";
      }
    }

    main.querySelector("input").addEventListener("change", function () {
      var on = this.checked;
      var self = this;
      if (on && notifySupported() && notifyPermission() === "default") {
        notifyRequest().then(function (perm) {
          if (perm !== "granted") { self.checked = false; on = false; }
          n.on = on; savePrefs(); refreshState();
          detail.style.display = on ? "" : "none";
          scheduleNotify(); notifySyncAlarm();
        });
        return;
      }
      n.on = on; savePrefs(); refreshState(); notifySyncAlarm();
      detail.style.display = on ? "" : "none";
      scheduleNotify();
    });
    box.appendChild(main);

    // Uhrzeit
    var timeRow = el('<div class="srow srow--static">' +
      '<span class="srow__ic"><i class="fa-solid fa-clock"></i></span>' +
      '<span class="srow__body"><span class="srow__t">' +
      esc(T("notify.timeLabel", "Uhrzeit")) + "</span></span>" +
      '<span class="srow__end"><input class="timein" type="time" value="' +
      esc(n.time) + '"></span></div>');
    timeRow.querySelector("input").addEventListener("change", function () {
      n.time = this.value || "09:00";
      n.lastDate = null;              // neue Uhrzeit → heute erneut zulassen
      savePrefs(); refreshState(); scheduleNotify();
      notifySyncAlarm();              // Weckruf im Android-Teil nachziehen
    });
    detail.appendChild(timeRow);

    // Auch melden, wenn es nichts Neues gibt?
    var quietRow = el('<div class="srow srow--static">' +
      '<span class="srow__ic"><i class="fa-solid fa-comment-dots"></i></span>' +
      '<span class="srow__body"><span class="srow__t">' +
      esc(T("notify.quietLabel",
            "Auch melden, wenn es nichts Neues gibt")) + "</span>" +
      '<span class="srow__s nbox__quiet"></span></span>' +
      '<span class="srow__end"><label class="switch"><input type="checkbox"' +
      (n.quiet ? " checked" : "") + '><span class="slider"></span></label>' +
      "</span></div>");
    var quietLbl = quietRow.querySelector(".nbox__quiet");
    function refreshQuiet() {
      quietLbl.textContent = n.quiet
        ? T("notify.quietHintOn", "Du hörst täglich von uns.")
        : T("notify.quietHintOff", "Nur wenn es wirklich Neues gibt.");
    }
    refreshQuiet();
    quietRow.querySelector("input").addEventListener("change", function () {
      n.quiet = this.checked; savePrefs(); refreshQuiet();
    });
    detail.appendChild(quietRow);

    var testBtn = el('<button class="btn-secondary" type="button">' +
      '<i class="fa-regular fa-bell"></i> ' +
      esc(T("notify.testBtn", "Testbenachrichtigung")) + "</button>");
    /* Rückmeldung neben der Schaltfläche. Vorher gab es keine: schlug die
       Meldung fehl — kein Recht erteilt, WebView ohne Meldungs-Schnittstelle,
       Android-Konstruktorfehler —, passierte sichtbar gar nichts und man
       konnte nicht unterscheiden, ob die App kaputt ist oder das Gerät. */
    var testMsg = el('<div class="srow__note"></div>');
    function sagen(text) { testMsg.textContent = text; }
    testBtn.addEventListener("click", function () {
      if (!notifySupported()) {
        sagen("Diese Umgebung kennt keine Benachrichtigungen — weder über den " +
              "Browser noch über die Android-Brücke.");
        return;
      }
      var senden = function () {
        showNotification(T("notify.sampleTitle", "PetitionsManager"),
          fill(T("notify.sampleBodyNew", "{n} neue Petitionen warten auf dich."),
               { n: countNew() })).then(function (ok) {
          sagen(ok ? "Gesendet. Erscheint sie nicht, sind Benachrichtigungen " +
                     "für den Browser in den Systemeinstellungen abgeschaltet."
                   : "Konnte nicht gesendet werden.");
        });
      };
      var recht = notifyPermission();
      if (recht === "granted") { senden(); return; }
      if (recht === "denied") {
        sagen(AN
          ? "Benachrichtigungen sind für diese App gesperrt. Das lässt sich " +
            "nur in den Android-Einstellungen der App zurücknehmen."
          : "Du hast Benachrichtigungen für diese Seite abgelehnt. Das lässt " +
            "sich nur in den Einstellungen des Browsers zurücknehmen.");
        return;
      }
      // "default" – vorher scheiterte der Test hier stumm, weil das Recht nur
      // beim Einschalten des Schalters erfragt wurde.
      sagen("Warte auf deine Erlaubnis …");
      notifyRequest().then(function (perm) {
        if (perm === "granted") { notifySyncAlarm(); senden(); }
        else sagen("Ohne Erlaubnis keine Benachrichtigung.");
      });
    });
    detail.appendChild(testBtn);
    detail.appendChild(testMsg);

    /* Der Hinweis muss die Wahrheit für die jeweilige Umgebung sagen: mit der
       Android-Brücke weckt ein AlarmManager auch bei geschlossener App, im
       Browser gibt es nur den Minutentakt einer laufenden Seite. */
    detail.appendChild(el('<div class="srow__note">' + (AN
      ? "Die Erinnerung kommt zur gewählten Uhrzeit, auch wenn die App " +
        "geschlossen ist. Android darf sie um einige Minuten verschieben, um " +
        "Akku zu sparen. Wie viele Petitionen neu sind, steht in der App – die " +
        "Meldung selbst kennt die Daten nicht."
      : "Hinweis: Die Meldung erscheint, sobald du die App nach der gewählten " +
        "Uhrzeit das nächste Mal öffnest oder sie im Hintergrund noch läuft. " +
        "Eine Erinnerung bei komplett geschlossener App bräuchte einen eigenen " +
        "Server – den hat diese App im Browser bewusst nicht. In der " +
        "Android-App übernimmt das ein Weckruf des Systems.") + "</div>"));

    box.appendChild(detail);
    refreshState();
    return box;
  }

  // Summe der „neu"-Zähler aller aktivierten Plattformen.
  function countNew() {
    if (!state.manifest) return 0;
    return livePlatforms().filter(function (p) { return isEnabled(p.key); })
      .reduce(function (s, p) { return s + (p["new"] || 0); }, 0);
  }

  /* Meldung anzeigen. Liefert ein Promise auf true/false.

     Der Weg über den Service Worker ist NICHT bloß eine Absicherung, sondern
     auf Android der einzige, der funktioniert: dort wirft `new Notification()`
     einen TypeError ("Illegal constructor"), Meldungen müssen zwingend über
     registration.showNotification() laufen. Vorher fing das try/catch den
     Fehler ab und gab stillschweigend false zurück — die Schaltfläche tat
     also am Telefon sichtbar nichts, ohne einen Grund zu nennen. */
  function showNotification(title, body) {
    if (!notifySupported() || notifyPermission() !== "granted")
      return Promise.resolve(false);
    if (AN) return Promise.resolve(!!AN.show(title, body));
    var opt = { body: body, icon: "icons/icon-192.png",
                badge: "icons/icon-192.png", tag: "petitionsmanager-daily" };
    var viaSW = navigator.serviceWorker && navigator.serviceWorker.ready
      ? navigator.serviceWorker.ready.then(function (reg) {
          return reg.showNotification(title, opt).then(function () { return true; });
        }).catch(function () { return null; })
      : Promise.resolve(null);
    return viaSW.then(function (ok) {
      if (ok) return true;
      try {                       // Rückfall für Desktop-Browser ohne SW
        new Notification(title, opt);
        return true;
      } catch (e) { return false; }
    });
  }

  // Prüft im Minutentakt, ob die gewählte Uhrzeit heute erreicht wurde.
  function scheduleNotify() {
    if (notifyTimer) { clearInterval(notifyTimer); notifyTimer = null; }
    var n = state.prefs.notify;
    if (!n.on || !notifySupported()) return;
    var tick = function () {
      var now = new Date();
      var today = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate();
      if (n.lastDate === today) return;
      var parts = String(n.time || "09:00").split(":");
      var due = new Date(now);
      due.setHours(parseInt(parts[0], 10) || 0,
                   parseInt(parts[1], 10) || 0, 0, 0);
      if (now < due) return;
      var fresh = countNew();
      if (!fresh && !n.quiet) { n.lastDate = today; savePrefs(); return; }
      var body = fresh
        ? fill(T("notify.sampleBodyNew", "{n} neue Petitionen warten auf dich."),
               { n: fresh })
        : T("notify.sampleBodyNone", "Heute nichts Neues – schau gern trotzdem rein.");
      // showNotification liefert jetzt ein Promise. Ein blankes `if` darauf wäre
      // immer wahr und hätte den Tag als gemeldet abgehakt, auch wenn nichts kam.
      showNotification(T("notify.sampleTitle", "PetitionsManager"), body)
        .then(function (ok) {
          if (ok) { n.lastDate = today; savePrefs(); }
        });
    };
    notifyTimer = setInterval(tick, 60000);
    tick();
  }

  function showAbout() {
    alert(T("about.title", "Über die App") + "\n\n" +
      T("about.text", "PetitionsManager bündelt Petitionen mehrerer Plattformen.") +
      "\n\n" + T("about.dataNote", "") +
      "\n\n" + T("about.disclaimer", ""));
  }

  // ---- Rendering: Profil (Platzhalter) --------------------------------------
  // ---- Import / Export der persönlichen Daten -------------------------------
  // Alle vom Nutzer angepassten Einstellungen liegen im localStorage. Diese
  // Schlüssel werden gesichert/wiederhergestellt.
  var BACKUP_KEYS = ["enabledPlatforms", "favorites", "signedPetitions",
                     "archivedPetitions", "dataBase",
                     "prefs"].concat(HINT_KEYS);

  // Profilbild verkleinern, bevor es im localStorage landet (dort ist bei
  // ~5 MB Schluss – ein Kamerafoto würde den Speicher allein sprengen).
  function readImageScaled(file, maxSide, done) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h));
        var c = document.createElement("canvas");
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        try { done(c.toDataURL("image/jpeg", 0.82)); }
        catch (e) { done(reader.result); }
      };
      img.onerror = function () { done(reader.result); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function tsStamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "-" + p(d.getHours()) + "-" + p(d.getMinutes());
  }

  // "DD.MM.YYYY, HH:MM Uhr" aus einem ISO-Zeitstempel.
  // "2026-07-20" → "20.07.2026" (leer, wenn unbrauchbar)
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? m[3] + "." + m[2] + "." + m[1] : "";
  }

  function fmtDateTime(iso) {
    if (!iso) return "Zeitpunkt unbekannt";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "Zeitpunkt unbekannt";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear() +
      ", " + p(d.getHours()) + ":" + p(d.getMinutes()) + " Uhr";
  }

  function collectBackup() {
    var data = {};
    BACKUP_KEYS.forEach(function (k) {
      var v = LS.getItem(k);
      if (v !== null) data[k] = v;      // Roh-Strings → verlustfreier Roundtrip
    });
    return {
      app: "PetitionsManager", type: "backup", version: 2,
      // Der Name steht bewusst auch oben in der Datei – so ist auf einen
      // Blick erkennbar, wessen Sicherung man vor sich hat.
      owner: (state.prefs && state.prefs.name) || null,
      exportedAt: new Date().toISOString(), data: data
    };
  }

  // Dateiname mit Datum vorn und – falls gesetzt – dem Namen der Person.
  function backupFilename() {
    var n = (state.prefs && state.prefs.name || "").trim()
      .replace(/[^\wÄÖÜäöüß -]/g, "").replace(/\s+/g, "-");
    return tsStamp() + "-petitionsmanager-backup" + (n ? "-" + n : "") + ".json";
  }

  function exportData() {
    var json = JSON.stringify(collectBackup(), null, 2);
    var name = backupFilename();
    // In der Android-APK übernimmt eine native Brücke das Speichern.
    if (window.AndroidBackup && window.AndroidBackup.saveBackup) {
      try { window.AndroidBackup.saveBackup(name, json); return true; }
      catch (e) { /* Fallback unten */ }
    }
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    return true;
  }

  // Wendet eine importierte Sicherung an und lädt den In-Memory-Zustand neu.
  function applyBackup(obj) {
    var data = obj && obj.data;
    if (!data || typeof data !== "object")
      throw new Error("Keine gültige PetitionsManager-Sicherung.");
    var oldBase = state.baseSetting;
    BACKUP_KEYS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        if (data[k] === null || data[k] === "") LS.removeItem(k);
        else LS.setItem(k, String(data[k]));
      }
    });
    // Zustand aus dem localStorage neu aufbauen.
    state.enabled = loadEnabled();
    state.favorites = loadFavorites();
    state.signed = loadSigned();
    state.archived = loadSet("archivedPetitions");
    state.baseSetting = LS.getItem("dataBase") || DEFAULT_BASE;
    state.prefs = loadPrefs();
    applyTheme();
    applyLayout();
    scheduleNotify();
    // Zahlen für die Rückmeldung.
    return {
      favoriten: state.favorites.size,
      unterschrieben: state.signed.size,
      archiviert: state.archived.size,
      baseChanged: state.baseSetting !== oldBase
    };
  }

  function importData(file, onDone) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var stats = applyBackup(JSON.parse(reader.result));
        if (stats.baseChanged) {           // Datenquelle geändert → neu auflösen
          state.dataCache = {}; state.manifest = null; textChunks = {};
          resolveBase().then(loadManifest)
            .then(function () { onDone(true, stats); })
            .catch(function () { onDone(true, stats); });
        } else onDone(true, stats);
      } catch (e) { onDone(false, e.message); }
    };
    reader.onerror = function () { onDone(false, "Datei nicht lesbar."); };
    reader.readAsText(file);
  }

  // Treffer im Text farbig hervorheben (Eingabe wird escaped, dann markiert).
  function highlight(text, query) {
    var safe = esc(text || "");
    var q = String(query || "").trim();
    if (!q) return safe;
    var rx = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    return safe.replace(rx, "<mark>$1</mark>");
  }

  // Meilenstein-Zeile – nur bei GENAU erreichter Schwelle, sonst wäre bei drei
  // Unterschriften dauerhaft „Deine erste Unterschrift" zu lesen.
  function milestoneFor(count) {
    return T("signed.milestones." + count, "");
  }

  function renderProfil() {
    titleEl.textContent = "Profil";
    /* Seitenüberschrift wie in den Einstellungen (Nutzerwunsch 6.8.2026):
       dort trägt die Seite über eine große Überschrift, hier stand bisher nur
       das kleine Versalien-Etikett der schmalen Titelzeile.
       Das Etikett oben verschwindet von selbst: syncPageTitle() blendet die
       Titelzeile aus, sobald der Inhalt eine gleichlautende Überschrift trägt
       (dieselbe Mechanik wie auf der Einstellungsseite).
       OHNE Untertitel: hier stand `profile.intro` („Du kannst einen Namen und
       ein Bild hinterlegen …"). Der Satz beschrieb genau den Profil-Kopf, der
       seit ZEIGE.profilKopf ruht — er kündigte also etwas an, das auf der Seite
       gar nicht zu finden ist. Der Eintrag bleibt in texts.js stehen; wer den
       Profil-Kopf zurückholt, holt diese Zeile mit zurück. */
    content.innerHTML =
      '<div class="welcome"><h1 class="welcome__t">Profil</h1></div>';
    var p = state.prefs;

    // ---- Kopf: Bild, Name, Datenschutz-Hinweis ------------------------------
    var initial = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
    var head = el('<div class="profile-head">' +
      '<button class="avatar' + (p.photo ? " avatar--img" : "") +
        '" type="button" aria-label="' + esc(T("profile.photoLabel", "Profilbild")) +
        '">' + (p.photo ? '<img src="' + esc(p.photo) + '" alt="">'
                        : esc(initial)) +
        '<span class="avatar__edit"><i class="fa-solid fa-camera"></i></span>' +
      "</button>" +
      '<input class="profile-namein" type="text" maxlength="40" value="' +
        esc(p.name) + '" placeholder="' +
        esc(T("profile.namePlaceholder", "Dein Name")) + '">' +
      '<div class="profile-sub">' + esc(T("profile.privacy",
        "Alles bleibt auf deinem Gerät – kein Konto, kein Server.")) +
      "</div></div>");
    var photoIn = el('<input type="file" accept="image/*" style="display:none">');
    var avatar = head.querySelector(".avatar");
    avatar.addEventListener("click", function () { photoIn.click(); });
    photoIn.addEventListener("change", function () {
      var f = photoIn.files && photoIn.files[0];
      if (!f) return;
      readImageScaled(f, 256, function (dataUrl) {
        p.photo = dataUrl; savePrefs(); renderProfil();
      });
      photoIn.value = "";
    });
    var nameIn = head.querySelector(".profile-namein");
    nameIn.addEventListener("change", function () {
      p.name = nameIn.value.trim(); savePrefs();
      if (!p.photo) avatar.firstChild.textContent =
        (p.name || "?").trim().charAt(0).toUpperCase() || "?";
    });
    nameIn.addEventListener("blur", function () { nameIn.dispatchEvent(
      new Event("change")); });
    head.appendChild(photoIn);
    if (p.photo) {
      var rm = el('<button class="profile-rmphoto" type="button">' +
        esc(T("profile.photoRemove", "Bild entfernen")) + "</button>");
      rm.addEventListener("click", function () {
        p.photo = null; savePrefs(); renderProfil();
      });
      head.appendChild(rm);
    }
    /* ⚠️ Ausgesetzt, nicht entfernt (Nutzerwunsch 6.8.2026: „brauchen wir
       aktuell nicht"). Ausgesetzt ist NUR der Einbau — der Block darüber wird
       weiter vollständig gebaut und bleibt funktionsfähig; ein `true` bei
       ZEIGE.profilKopf holt ihn unverändert zurück. Der gespeicherte Name
       bleibt erhalten und wandert weiterhin in den Export-Dateinamen und in
       die Sicherung, er lässt sich nur gerade nicht ändern. */
    if (ZEIGE.profilKopf) content.appendChild(head);

    // ---- Wirkungs-Karte ------------------------------------------------------
    var total = state.signed.size;
    var impacts = TX.impact && TX.impact.length ? TX.impact
      : ["Jede Unterschrift macht ein Anliegen ein Stück sichtbarer."];
    var impact = impacts[Math.floor(Date.now() / 86400000) % impacts.length];
    content.appendChild(el('<div class="impact">' +
      '<div class="impact__n">' + nf.format(total) + "</div>" +
      '<div class="impact__l">' +
        esc(total === 1 ? T("signed.countOne", "1 Petition")
                        : fill(T("signed.countMany", "{n} Petitionen"),
                               { n: nf.format(total) })) +
        " unterzeichnet</div>" +
      (milestoneFor(total)
        ? '<div class="impact__m">' + esc(milestoneFor(total)) + "</div>" : "") +
      '<div class="impact__q">' + esc(impact) + "</div></div>"));

    // ---- Meine unterzeichneten Petitionen ------------------------------------
    var signedSorted = Array.from(state.signed.entries()).sort(function (a, b) {
      return String(b[1].ts || "").localeCompare(String(a[1].ts || ""));
    });
    var sec = el('<section class="signed">' +
      '<div class="signed__head"><h2>' +
        esc(T("signed.title", "Meine unterzeichneten Petitionen")) + "</h2>" +
      '<p>' + esc(T("signed.intro", "")) + "</p></div>" +
      '<div class="signed__searchwrap"><i class="fa-solid fa-magnifying-glass">' +
      '</i><input class="signed__search" type="search" placeholder="' +
        esc(T("signed.searchPlaceholder", "In deinen Unterschriften suchen …")) +
        '" value="' + esc(state.signedQuery) + '"></div>' +
      /* Sagt, worüber die Suche läuft. Der Filter unten verkettet Titel,
         Plattformnamen und URL — der Aufruftext ist bewusst NICHT dabei, er
         liegt nur in den Volltext-Paketen und nicht in state.signed. */
      '<div class="signed__hint">' +
        esc(T("signed.searchHint",
              "Durchsucht Titel, Plattform und Adresse der Petition — " +
              "nicht den Aufruftext.")) + "</div>" +
      '<div class="signed__count"></div>' +
      '<div class="signed-list"></div></section>');
    var sList = sec.querySelector(".signed-list");
    var sCount = sec.querySelector(".signed__count");
    var sSearch = sec.querySelector(".signed__search");

    function drawSigned() {
      var q = state.signedQuery.trim().toLowerCase();
      sList.innerHTML = "";
      if (!signedSorted.length) {
        sList.appendChild(el('<div class="signed-empty">' +
          '<i class="fa-regular fa-hand-pointer"></i><p>' +
          esc(T("signed.empty",
                "Noch nichts markiert. Wische eine Petition nach rechts, " +
                "sobald du sie unterschrieben hast.")) + "</p></div>"));
        sCount.textContent = "";
        return;
      }
      var rows = signedSorted.filter(function (e) {
        if (!q) return true;
        var pn = e[1].platform ? platformName(e[1].platform) : "";
        return ((e[1].title || "") + " " + pn + " " + e[0])
          .toLowerCase().indexOf(q) > -1;
      });
      sCount.textContent = q
        ? rows.length + " von " + signedSorted.length + " Treffern"
        : (signedSorted.length === 1
            ? T("signed.countOne", "1 Petition")
            : fill(T("signed.countMany", "{n} Petitionen"),
                   { n: nf.format(signedSorted.length) }));
      if (!rows.length) {
        sList.appendChild(el('<div class="signed-empty"><p>Keine Treffer für ' +
          "„" + esc(state.signedQuery) + "“.</p></div>"));
        return;
      }
      rows.forEach(function (e) {
        var url = e[0], v = e[1];
        var pn = v.platform ? platformName(v.platform) : "";
        var brand = v.platform ? platColor(v.platform) : null;
        /* Zahl und Datum wie in der Kachel (Nutzerwunsch 3.8.26). Vorrang hat
           der aktuelle Datensatz: der Abzug in der Unterschrift ist vom Tag des
           Markierens, die Unterschriftenzahl von damals wäre heute zu niedrig.
           Ohne geladene Liste und ohne Abzug (Einträge vor 3.8.26) bleibt die
           Angabe einfach weg — lieber nichts als eine erfundene Zahl. */
        var rec = signedRecord(url, v);
        var zahl = (rec && typeof rec.signatures === "number") ? rec.signatures
                 : ((typeof v.signatures === "number") ? v.signatures : null);
        var dat = (rec && rec.start_date) || v.date || null;
        var fakten = "";
        if (zahl !== null)
          fakten += '<span class="sig"><b>' + nf.format(zahl) + "</b> " +
            '<i class="fa-solid fa-pen" aria-hidden="true"></i></span>';
        if (dat)
          fakten += '<span class="sig" title="Start der Petition">' +
            esc(fmtDate(dat)) +
            ' <i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span>';
        var row = el('<button class="signed-item" type="button"' +
          (brand ? ' style="--brand:' + esc(brand) + '"' : "") + ">" +
          /* Logo in einem Kasten FESTER Breite (Nutzerwunsch 3.8.26), damit
             alle Titel an derselben Stelle beginnen. Die Marken sind bewusst
             flächen- und nicht breitengleich (--logo-k), der Bundestag-Schriftzug
             ist dadurch doppelt so breit wie die WeAct-Marke — ohne Kasten
             begänne jede Zeile woanders. Der Kasten steht auch ohne Plattform,
             sonst rutschte genau diese eine Zeile aus der Spalte. */
          '<span class="signed-item__logo">' +
          (v.platform ? platLogo(v.platform, pn) : "") + "</span>" +
          '<span class="signed-item__body">' +
          '<span class="signed-item__t">' +
            highlight(v.title || url, state.signedQuery) + "</span>" +
          '<span class="signed-item__meta">' +
            (pn ? '<span class="signed-item__plat">' +
                  highlight(pn, state.signedQuery) + "</span>" : "") +
            fakten + "</span>" +
          /* „Unterschrieben am" steht seit 3.8.26 abgesetzt in einer eigenen
             Zeile (Nutzerwunsch): es ist die einzige Angabe der Zeile, die vom
             NUTZER stammt und nicht von der Plattform. Vorher hing der
             Zeitpunkt hinter dem Plattformnamen in derselben grauen Zeile und
             war von den Daten der Petition nicht zu unterscheiden. */
          '<span class="signed-item__signed">Unterschrieben am ' +
            '<span class="signed-item__when">' + esc(fmtDateTime(v.ts)) +
          "</span></span>" +
          "</span></button>");
        if (v.platform) {
          row.addEventListener("click", function () {
            openPetitionInApp(v.platform, url);
          });
        } else { row.disabled = true; row.classList.add("signed-item--nolink"); }
        sList.appendChild(row);
      });
    }
    /* Vorschläge aus den eigenen Unterschriften. Die Liste darunter filtert
       ohnehin schon beim Tippen — der Nutzen liegt hier im Sprung: ein Antippen
       öffnet die Petition direkt in ihrer Plattform, statt sie nur zu zeigen.
       Einträge ohne Plattform (Altbestand) sind wie die Zeilen unten kein
       Sprungziel und bekommen deshalb kein pick. */
    attachAutocomplete(sSearch, function (q) {
      var out = [];
      signedSorted.forEach(function (e) {
        var v = e[1], t = v.title || e[0];
        if (t.toLowerCase().indexOf(q) === -1) return;
        out.push({
          t: t, sub: v.platform ? platformName(v.platform) : "",
          pick: v.platform
            ? function () { openPetitionInApp(v.platform, e[0]); } : null
        });
      });
      return out;
    });
    sSearch.addEventListener("input", function () {
      state.signedQuery = sSearch.value; drawSigned();
    });
    drawSigned();
    content.appendChild(sec);

    // Daten sichern: Export / Import (Favoriten, unterschrieben/archiviert,
    // Plattform-Auswahl & Einstellungen).
    var io = el('<div class="io">' +
      '<div class="io__lbl"><i class="fa-solid fa-database"></i> Deine Daten sichern</div>' +
      '<div class="io__note">Favoriten, unterschrieben/archiviert, Plattform-' +
      'Auswahl und Einstellungen als Datei sichern oder wiederherstellen.</div>' +
      '<div class="io__btns"></div></div>');
    var ioBtns = io.querySelector(".io__btns");
    var ioNote = io.querySelector(".io__note");
    var exBtn = el('<button class="io__btn" type="button">' +
      '<i class="fa-solid fa-file-export"></i> Exportieren</button>');
    var imBtn = el('<button class="io__btn io__btn--ghost" type="button">' +
      '<i class="fa-solid fa-file-import"></i> Importieren</button>');
    var fileIn = el('<input type="file" accept="application/json,.json" ' +
      'style="display:none">');
    exBtn.addEventListener("click", function () {
      exportData();
      ioNote.textContent = "✓ Sicherung exportiert (" +
        (state.favorites.size) + " Favoriten, " + state.signed.size +
        " unterschrieben, " + state.archived.size + " archiviert).";
    });
    imBtn.addEventListener("click", function () { fileIn.click(); });
    fileIn.addEventListener("change", function () {
      if (!fileIn.files || !fileIn.files[0]) return;
      importData(fileIn.files[0], function (ok, res) {
        if (ok) {
          ioNote.textContent = "✓ Importiert: " + res.favoriten + " Favoriten, " +
            res.unterschrieben + " unterschrieben, " + res.archiviert +
            " archiviert.";
          io.classList.add("io--done");
        } else {
          ioNote.textContent = "Import fehlgeschlagen: " + res;
        }
      });
      fileIn.value = "";
    });
    ioBtns.appendChild(exBtn); ioBtns.appendChild(imBtn); ioBtns.appendChild(fileIn);
    content.appendChild(io);
  }

  // ---- Ersteinrichtung (Wizard) ----------------------------------------------
  // Drei Schritte beim ersten Start: Begrüßung → Sprachen → Plattformen.
  // Liegt als Overlay über der App, damit auch die Fußleiste verdeckt ist.
  var wizardSel = { langs: null, plats: null };   // Auswahl während des Wizards

  function wizardLanguages() {
    var seen = {};
    livePlatforms().forEach(function (p) { seen[p.language || "de"] = true; });
    return Object.keys(seen).sort(function (a, b) {
      return langRank(a) - langRank(b) || a.localeCompare(b);
    });
  }

  function startWizard() {
    state.wizardStep = 0;
    // Vorbelegung: bereits aktive Plattformen bzw. alles Deutschsprachige.
    var langs = wizardLanguages();
    wizardSel.langs = new Set(langs.indexOf("de") >= 0 ? ["de"] : langs.slice(0, 1));
    wizardSel.plats = new Set(state.enabled === null
      ? livePlatforms().map(function (p) { return p.key; })
      : Array.from(state.enabled));
    renderWizard();
    /* Ein eigener History-Eintrag für den Assistenten. Ohne ihn gäbe es beim
       allerersten Start nur den Starteintrag, die Zurücktaste fände nichts zum
       Zurückgehen und schlösse die App mitten in der Einrichtung. Der Eintrag
       wird in popstate wieder verbraucht (siehe dort). */
    try { history.pushState({ pmWizard: true }, ""); } catch (e) {}
  }

  function closeWizard(save) {
    if (save) {
      state.enabled = new Set(wizardSel.plats);
      saveEnabled();
    }
    state.prefs.wizardDone = true;
    savePrefs();
    var ov = document.getElementById("wizard");
    if (ov) ov.remove();
    document.body.classList.remove("wizard-open");
    render();
  }

  function renderWizard() {
    var old = document.getElementById("wizard");
    if (old) old.remove();
    document.body.classList.add("wizard-open");

    var TOTAL = 3;                       // gezählte Schritte (ohne Begrüßung)
    var step = state.wizardStep;
    var ov = el('<div class="wiz" id="wizard"><div class="wiz__inner">' +
      '<div class="wiz__top"></div>' +
      '<div class="wiz__main"></div>' +
      '<div class="wiz__foot"></div></div></div>');
    var top = ov.querySelector(".wiz__top");
    var main = ov.querySelector(".wiz__main");
    var foot = ov.querySelector(".wiz__foot");

    // Kopf: Fortschrittspunkte + Überspringen
    if (step > 0) {
      var dots = '<div class="wiz__dots">';
      for (var i = 1; i <= TOTAL; i++)
        dots += '<span class="wiz__dot' + (i <= step ? " on" : "") + '"></span>';
      dots += "</div>";
      top.innerHTML = dots +
        '<span class="wiz__step">' +
        esc(fill(T("wizard.stepOf", "Schritt {n} von {total}"),
                 { n: step, total: TOTAL })) + "</span>";
    }
    var skip = el('<button class="wiz__skip" type="button">' +
      esc(T("wizard.skip", "Überspringen")) + "</button>");
    skip.addEventListener("click", function () { closeWizard(false); });
    top.appendChild(skip);

    if (step === 0) {
      main.appendChild(el('<div class="wiz__hero">' +
        '<div class="wiz__mark"><i class="fa-solid fa-hand-holding-heart"></i></div>' +
        '<h1 class="wiz__title">' +
        esc(T("wizard.intro.title", "Willkommen im PetitionsManager")) + "</h1>" +
        '<p class="wiz__text">' +
        esc(T("wizard.intro.text",
              "Petitionen vieler Plattformen an einem Ort – such dir aus, " +
              "was du sehen möchtest.")) + "</p></div>"));

    } else if (step === 1) {
      main.appendChild(el('<h1 class="wiz__title">' +
        esc(T("wizard.lang.title", "In welchen Sprachen suchst du?")) + "</h1>" ));
      main.appendChild(el('<p class="wiz__text">' +
        esc(T("wizard.lang.text",
              "Wir zeigen dir nur Plattformen in den Sprachen, die du " +
              "verstehst.")) + "</p>"));
      var lgrid = el('<div class="wiz__chips"></div>');
      wizardLanguages().forEach(function (code) {
        var info = langInfo(code);
        var n = livePlatforms().filter(function (p) {
          return (p.language || "de") === code; }).length;
        var chip = el('<button class="chip' +
          (wizardSel.langs.has(code) ? " on" : "") + '" type="button">' +
          /* flag mit dazu: die runde Blende steckt in .flag (style.css),
             chip__flag trägt nur noch den Abstand im Chip. */
          '<span class="chip__flag flag">' + info.flag + "</span>" +
          '<span class="chip__l">' + esc(info.name) + "</span>" +
          '<span class="chip__n">' + n + "</span></button>");
        chip.addEventListener("click", function () {
          if (wizardSel.langs.has(code)) wizardSel.langs["delete"](code);
          else wizardSel.langs.add(code);
          chip.classList.toggle("on", wizardSel.langs.has(code));
          foot.querySelector(".wiz__next").disabled = !wizardSel.langs.size;
        });
        lgrid.appendChild(chip);
      });
      main.appendChild(lgrid);
      main.appendChild(el('<p class="wiz__hint">' +
        esc(T("wizard.lang.hint", "Das lässt sich jederzeit ändern.")) + "</p>"));

    } else if (step === 2) {
      main.appendChild(el('<h1 class="wiz__title">' +
        esc(T("wizard.platforms.title", "Welche Plattformen möchtest du sehen?"))
        + "</h1>"));
      main.appendChild(el('<p class="wiz__text">' +
        esc(T("wizard.platforms.text",
              "Tippe an, was dich interessiert – alle sind vorausgewählt."))
        + "</p>"));
      var pl = livePlatforms().filter(function (p) {
        return wizardSel.langs.has(p.language || "de");
      }).sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
      // Plattformen aus abgewählten Sprachen fliegen aus der Auswahl.
      Array.from(wizardSel.plats).forEach(function (k) {
        if (!pl.some(function (p) { return p.key === k; }))
          wizardSel.plats["delete"](k);
      });
      var pgrid = el('<div class="wiz__plats"></div>');
      pl.forEach(function (p) {
        var on = wizardSel.plats.has(p.key);
        var color = platColor(p.key);
        var row = el('<button class="wplat' + (on ? " on" : "") + '" type="button"' +
          (color ? ' style="--brand:' + esc(color) + '"' : "") + ">" +
          platLogo(p.key, p.name) +
          '<span class="wplat__body"><span class="wplat__n">' + esc(p.name) +
          "</span><span class=\"wplat__m\">" + nf.format(p.online) +
          " Petitionen</span></span>" +
          '<span class="wplat__check"><i class="fa-solid fa-check"></i></span>' +
          "</button>");
        row.addEventListener("click", function () {
          if (wizardSel.plats.has(p.key)) wizardSel.plats["delete"](p.key);
          else wizardSel.plats.add(p.key);
          row.classList.toggle("on", wizardSel.plats.has(p.key));
          foot.querySelector(".wiz__next").disabled = !wizardSel.plats.size;
        });
        pgrid.appendChild(row);
      });
      main.appendChild(pgrid);
      main.appendChild(el('<p class="wiz__hint">' +
        esc(T("wizard.platforms.hint",
              "Später jederzeit in den Einstellungen änderbar.")) + "</p>"));

    } else {
      main.appendChild(el('<div class="wiz__hero">' +
        '<div class="wiz__mark wiz__mark--done">' +
        '<i class="fa-solid fa-check"></i></div>' +
        '<h1 class="wiz__title">' +
        esc(T("wizard.done.title", "Fertig!")) + "</h1>" +
        '<p class="wiz__text">' +
        esc(T("wizard.done.text",
              "Tippe eine Plattform an, um ihre Petitionen zu sehen. " +
              "Mit dem Stern merkst du dir, was dir wichtig ist.")) +
        "</p></div>"));
    }

    // Fußzeile: Zurück / Weiter
    if (step > 0 && step < 3) {
      var back = el('<button class="wiz__back" type="button">' +
        '<i class="fa-solid fa-chevron-left"></i> ' +
        esc(T("wizard.back", "Zurück")) + "</button>");
      back.addEventListener("click", function () {
        state.wizardStep--; renderWizard();
      });
      foot.appendChild(back);
    }
    var isLast = step === 3;
    var nextLabel = step === 0 ? T("wizard.intro.cta", "Los geht's")
                  : isLast     ? T("wizard.finish", "Los geht's")
                               : T("wizard.next", "Weiter");
    var next = el('<button class="wiz__next" type="button">' + esc(nextLabel) +
      ' <i class="fa-solid fa-arrow-right"></i></button>');
    if ((step === 1 && !wizardSel.langs.size) ||
        (step === 2 && !wizardSel.plats.size)) next.disabled = true;
    next.addEventListener("click", function () {
      if (isLast) { closeWizard(true); return; }
      state.wizardStep++; renderWizard();
    });
    foot.appendChild(next);

    document.body.appendChild(ov);
  }

  /* ---- Ohne Internet --------------------------------------------------------
     Die Datenquelle steht fest (siehe ZEIGE.datenquelle). Damit ist „kein
     Netz" kein Einstellungsproblem mehr, sondern ein Zustand, den die App
     erklären muss: es kommen keine Aktualisierungen, und die Bilder fehlen —
     die liegen ALLE auf fremden Servern (19 verschiedene), kein einziges im
     App-Paket.

     Zwei sichtbare Folgen, beide gewollt:
       1. ein Hinweisband am unteren Rand (index.html → #offbar), wegklickbar,
          das beim nächsten Wechsel des Zustands von selbst wiederkommt;
       2. statt kaputter Bildsymbole überall Platzhalter — in der Liste das
          Plattform-Logo, im Aufruftext ein beschrifteter Kasten.
     Das Attribut an <html> ist der Schalter für alles Weitere im CSS. */
  function setzeOnline(jetztOnline) {
    var vorher = state.online;
    state.online = !!jetztOnline;
    if (vorher === state.online) return;      // nichts hat sich geändert
    document.documentElement.setAttribute("data-offline",
      state.online ? "" : "1");
    if (!state.online) offbarZeigen(true);    // Zustandswechsel → wieder zeigen
    else offbarZeigen(false);
    /* Neu zeichnen, weil die Bild-Entscheidung im Markup steckt und nicht im
       CSS: ein <img> mit fremder Adresse würde offline ein kaputtes Symbol
       zeigen, noch bevor eine Regel greifen könnte. */
    if (state.manifest) render();
  }

  function offbarZeigen(zeigen) {
    var bar = document.getElementById("offbar");
    if (bar) bar.hidden = !zeigen;
    document.body.classList.toggle("hat-offbar", !!zeigen);
  }

  /* Bilder im Aufruftext durch beschriftete Platzhalter ersetzen — OHNE sie zu
     laden. Derselbe DOMParser-Weg wie stripImages(): das entstehende Dokument
     ist „inert" und holt keine Dateien. Ein losgelöstes <div> mit innerHTML
     täte es NICHT, dort startet ein gesetztes img.src den Abruf trotzdem. */
  function bilderAlsPlatzhalter(html) {
    if (!html || html.indexOf("<img") < 0 || !window.DOMParser) return html;
    try {
      var doc = new DOMParser().parseFromString(
        "<!DOCTYPE html><body>" + html, "text/html");
      var bilder = doc.body.querySelectorAll("img");
      for (var i = 0; i < bilder.length; i++) {
        var ph = doc.createElement("div");
        ph.className = "img-off";
        ph.textContent = "Bild – ohne Internet nicht verfügbar";
        bilder[i].parentNode.replaceChild(ph, bilder[i]);
      }
      return doc.body.innerHTML;
    } catch (e) { return html; }
  }

  /* ---- Zurück-Navigation ----------------------------------------------------
     Die App ist eine einzige Seite. Ohne Zutun kennt der Browser deshalb genau
     EINEN History-Eintrag – und auf Android hieß das: die Zurücktaste des
     Telefons schließt die App, statt eine Ebene zurückzugehen. MainActivity
     fragt web.canGoBack(), und das war immer false, weil hier nie jemand einen
     Eintrag angelegt hat (Nutzerbefund 6.8.2026).

     Gegenmittel: jeder Ansichtswechsel bekommt einen eigenen Eintrag. Damit
     wird canGoBack() wahr, goBack() löst popstate aus, und der Java-Teil bleibt
     unverändert – Browser und installierte PWA gewinnen dasselbe mit.

     Aufgehängt am Router, dem einzigen Punkt, durch den jede Ansicht geht.
     Verglichen wird der Abzug mit dem zuletzt geschriebenen: nur eine ECHTE
     Änderung legt einen Eintrag an. Ohne diesen Vergleich zählte jedes
     Neuzeichnen mit – Schalter umlegen, Petition unterschreiben, Daten
     aktualisieren – und man müsste zehnmal zurück, um eine Ebene zu verlassen.

     Im Abzug stehen bewusst NUR tab/platform/cross, nicht die Filter
     (catFilter, tagFilter, sort): die werden von draw() geändert, das den
     Router gar nicht durchläuft. Sie wären damit nur zufällig richtig, und
     ein Rückschritt würde einen gesetzten Filter still wegräumen. So bleiben
     sie unangetastet; beim Betreten einer Plattform setzt die App sie ohnehin
     selbst zurück (platCard und der Zurück-Knopf im Plattformkopf). */
  var navLetzte = null;     // zuletzt geschriebener Abzug, als Zeichenkette
  var navZurueck = false;   // true, während popstate die Ansicht zurückstellt

  function navSnap() {
    return { tab: state.tab, platform: state.platform, cross: state.cross };
  }

  function navAnwenden(s) {
    state.tab = s.tab;
    state.platform = s.platform;
    state.cross = s.cross;
  }

  function navTrack() {
    var snap = navSnap();
    var jetzt = JSON.stringify(snap);
    if (jetzt === navLetzte) return;
    var erster = navLetzte === null;
    navLetzte = jetzt;
    if (navZurueck) return;   // popstate hat die Ansicht schon selbst gestellt
    /* Der allererste Abzug ERSETZT den Starteintrag, statt einen zweiten
       anzulegen. Sonst bräuchte es auf der Übersicht – dem Ausgangspunkt –
       erst einen Rückschritt ins Leere, bevor die App sich schließen darf. */
    try {
      history[erster ? "replaceState" : "pushState"]({ pmNav: snap }, "");
    } catch (e) { /* ohne History-API läuft die App wie bisher weiter */ }
  }

  window.addEventListener("popstate", function (e) {
    /* Liegt die Ersteinrichtung über der App, gilt der Rückweg zuerst ihr:
       sonst navigierte die App unter einem Fenster, das sichtbar stehen
       bleibt. Zurück wirkt dort wie „Überspringen" – bewusst nicht als
       Schritt-für-Schritt-Rückweg, dafür hat der Assistent eigene Knöpfe.
       Den nötigen Eintrag legt startWizard() an. */
    if (document.getElementById("wizard")) { closeWizard(false); return; }
    var s = e.state && e.state.pmNav;
    if (!s) return;           // fremder oder leerer Eintrag – nicht anfassen
    navZurueck = true;
    navAnwenden(s);
    render();
    navZurueck = false;
  });

  // ---- Router ----------------------------------------------------------------
  function render() {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === state.tab);
    });
    if (!state.manifest) { content.innerHTML =
      '<div class="empty">Lade Daten …</div>'; return; }
    if (state.tab === "liste") {
      if (state.cross) renderCrossSearch();
      else renderListe();
    }
    else if (state.tab === "einstellungen") renderEinstellungen();
    else if (state.tab === "profil") renderProfil();
    syncPageTitle();
    // Erst nachdem die Ansicht steht: sonst schriebe der frühe Ausstieg
    // oben („Lade Daten …") schon einen Eintrag, den es nie gab.
    navTrack();
    window.scrollTo(0, 0);
  }

  // Seitentitel und Inhaltsüberschrift können denselben Text tragen – in den
  // Einstellungen steht zweimal „Einstellungen" untereinander. Dann wird die
  // Titelzeile ausgeblendet statt sie doppelt zu zeigen. Bewusst als Vergleich
  // der Texte und nicht als Liste von Ausnahmen: so greift es von allein auch
  // für Ansichten, die später dazukommen.
  function syncPageTitle() {
    function norm(s) { return String(s || "").trim().toLowerCase(); }
    var h1 = content.querySelector(".welcome__t, .phead__name");
    titleEl.classList.toggle("is-dup",
      !!h1 && norm(h1.textContent) === norm(titleEl.textContent));
  }

  // ---- Menü ------------------------------------------------------------------
  // Das Hamburger-Menü ist abgeschafft: „Daten aktualisieren", „Datenquelle"
  // und „Über die App" stehen jetzt in den Einstellungen. Das Markup ist aus
  // index.html entfernt; dieser Rest räumt nur noch auf, falls eine ältere
  // Version im Browser-Cache liegt.
  ["drawer", "drawer-scrim", "hamburger"].forEach(function (id) {
    var node = document.getElementById(id);
    if (node) node.remove();
  });

  /* Zurück zur Plattform-Übersicht: verlässt Plattform-Detail und
     plattformübergreifende Suche und räumt deren Filter weg.
     Die Volltextsuche der Hauptseite (state.mainQuery) bleibt bewusst stehen –
     sie wird in localStorage gehalten, ist also eine bewusste Einstellung des
     Nutzers und keine Navigationsspur. */
  function goHome() {
    state.platform = null; state.cross = null;
    state.catFilter = null; state.tagFilter = null; state.sort = null;
    state.gapFilter = null;
    state.openPetitionUrl = null;
    state.tab = "liste";
    render();
    window.scrollTo(0, 0);
  }

  // ---- Tab-Navigation --------------------------------------------------------
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () {
      // Footer-Tab "Liste" führt immer zur Plattform-Übersicht (frischer Start).
      if (t.dataset.tab === "liste") { goHome(); return; }
      state.tab = t.dataset.tab; render();
    });
  });

  // Wortmarke in der Kopfleiste = Weg zurück zur Übersicht (wie das Logo auf
  // einer Website). Erreicht man aus jeder Ansicht, auch aus Einstellungen.
  var brandHome = document.getElementById("brandhome");
  if (brandHome) brandHome.addEventListener("click", goHome);

  /* „Fehler gefunden? Bitte melden!" (Nutzerwunsch 6.8.2026, Knopf rechts in
     der Kopfleiste). Führt auf dieselbe Adresse wie die Melde-Knöpfe im
     Abschnitt „Unterstützen"; neu ist allein, dass er aus JEDER Ansicht
     erreichbar ist statt nur unten auf der Übersicht.
     Die technischen Angaben werden erst beim Klick zusammengestellt – sie
     sollen die Ansicht beschreiben, in der der Fehler aufgetreten ist, nicht
     die beim Start. Sie stehen im Text und nicht in einem stillen Anhang:
     was mitgeschickt wird, soll vor dem Absenden lesbar und kürzbar sein.
     Geöffnet über einen kurzlebigen Anker statt location.href – dasselbe
     Muster wie beim Datenexport weiter oben, und es funktioniert auch dort,
     wo eine Zuweisung an location von einer Sperre abgefangen würde. */
  var reportBtn = document.getElementById("reportbug");
  if (reportBtn) reportBtn.addEventListener("click", function () {
    var ansicht = state.cross ? "Suche über alle Plattformen"
                : state.platform ? "Plattform " + platformName(state.platform)
                : state.tab === "einstellungen" ? "Einstellungen"
                : state.tab === "profil" ? "Profil"
                : "Übersicht";
    var stand = state.manifest && state.manifest.generated_at
      ? String(state.manifest.generated_at).slice(0, 10) : "unbekannt";
    var prefs = state.prefs || {};
    var text =
      "Was hast du getan?\n\n\n" +
      "Was ist passiert?\n\n\n" +
      "Was hättest du erwartet?\n\n\n" +
      "--- Technische Angaben (helfen beim Suchen, gerne kürzen) ---\n" +
      "Ansicht: " + ansicht + "\n" +
      "Daten: " + (state.baseAuto || state.baseSetting) +
        ", Stand " + stand + "\n" +
      "Darstellung: " + (prefs.theme || "?") + " / " + (prefs.layout || "?") +
        "\n" +
      "Gerät: " + navigator.userAgent + "\n";
    var a = document.createElement("a");
    a.href = "mailto:" + SUPPORT_MAIL +
      "?subject=" + encodeURIComponent("[PetitionsManager] Fehlerbericht") +
      "&body=" + encodeURIComponent(text);
    document.body.appendChild(a); a.click(); a.remove();
  });

  // ---- Start -----------------------------------------------------------------
  function boot() {
    state.enabled = loadEnabled();
    state.favorites = loadFavorites();
    state.signed = loadSigned();
    state.archived = loadSet("archivedPetitions");
    state.prefs = loadPrefs();
    applyTheme();
    applyLayout();
    // Bei „automatisch" auf Systemwechsel reagieren (Nachtmodus des Geräts).
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", applyTheme);
      else if (mq.addListener) mq.addListener(applyTheme);
    }

    /* Verbindungszustand mitführen. Der Startwert steht schon im state; hier
       wird nur das Attribut an <html> gesetzt und das Band gezeigt, falls es
       beim Start schon kein Netz gibt. */
    document.documentElement.setAttribute("data-offline",
      state.online ? "" : "1");
    if (!state.online) offbarZeigen(true);
    window.addEventListener("online", function () { setzeOnline(true); });
    window.addEventListener("offline", function () { setzeOnline(false); });
    var offx = document.getElementById("offbarx");
    if (offx) offx.addEventListener("click", function () {
      /* Nur wegklicken, den Zustand NICHT ändern: die App bleibt offline, das
         Band kommt beim nächsten Wechsel von selbst wieder. */
      offbarZeigen(false);
    });

    // Nach-oben-Button: erscheint nach dem Scrollen, scrollt sanft hoch.
    var toTop = document.getElementById("to-top");
    if (toTop) {
      var updateTop = function () {
        toTop.classList.toggle("show", window.scrollY > 300);
      };
      window.addEventListener("scroll", updateTop, { passive: true });
      toTop.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      updateTop();
    }
    render();   // zeigt "Lade Daten …"
    /* Marken-Bogen parallel zu den Daten holen: die elf Dateien liegen im
       Cache des Service Workers, kosten also normalerweise keine Wartezeit.
       Der erste render() oben zeigt nur „Lade Daten …" und braucht kein
       Logo. Bewusst mit eigenem catch: eine fehlende Logodatei darf die
       Liste nicht verhindern — platLogo() nimmt dann wieder die Maske. */
    var marken = loadLogoSprite().catch(function () {});
    // resolveBase() vor loadManifest(): erst danach steht fest, woher geladen wird.
    resolveBase().then(loadManifest).then(function () {
      return marken;
    }).then(function () {
      render();
      // Beim allerersten Start durch die Ersteinrichtung führen.
      if (!state.prefs.wizardDone) startWizard();
      scheduleNotify();
    }).catch(function () {
      content.innerHTML = '<div class="empty">Daten konnten nicht geladen ' +
        'werden.<br>Prüfe die <b>Datenquelle</b> in den Einstellungen.</div>';
    });
  }

  // Service Worker registrieren (PWA: installierbar + offline auf Android/iOS).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  boot();
})();
