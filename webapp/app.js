"use strict";
/* Petitionen — Mobile-App (entkoppelt vom Server; lädt statische JSON-Daten).
   Datenquelle konfigurierbar über localStorage "dataBase" (Default ./data). */

(function () {
  var LS = window.localStorage;
  var DEFAULT_BASE = "./data";
  // Wie viele Karten eine Liste höchstens auf einmal rendert. Der Bundestag
  // bringt allein 7.845 beendete Petitionen mit; ungedeckelt wächst die Seite
  // auf über 180.000 DOM-Knoten und braucht schon am PC ~2 s zum Aufbau.
  var LIST_MAX = 300;
  var nf = new Intl.NumberFormat("de-DE");

  var state = {
    base: LS.getItem("dataBase") || DEFAULT_BASE,
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
    mainQuery: "",        // letzte Volltextsuche auf der Hauptseite
    cross: null,          // plattformübergreifende Suche {type,value,fromPlatform}
    openPetitionUrl: null,// nach Navigation diese Petition automatisch aufklappen
    archiveOpen: false,   // Archiv-Akkordion (Plattform-Detail) offen?
    offlineOpen: false,   // Offline-Akkordion offen?
    closedOpen: false,    // Akkordion "Beendet" offen? (Frist abgelaufen)
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
  function platLogo(key, name) {
    var info = platInfo(key);
    if (info.logo) return '<span class="plogo">' + info.logo + "</span>";
    var initial = String(name || key || "?").trim().charAt(0).toUpperCase();
    return '<span class="plogo plogo--fallback">' + esc(initial) + "</span>";
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
      layout: "klassisch",        // "klassisch" | "band" | "magazin" (layouts.css)
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
          if (o.layout) p.layout = o.layout;
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
  // Variablen. „klassisch" setzt bewusst KEINE Regeln – dann greift allein
  // style.css, und das ursprüngliche Erscheinungsbild bleibt unangetastet.
  function applyLayout() {
    var l = (state.prefs && state.prefs.layout) || "klassisch";
    document.documentElement.setAttribute("data-layout", l);
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

  // Unterschrieben: Map url -> {ts, title, platform}. Der Zeitstempel (ts) hält
  // fest, WANN als "unterschrieben" markiert wurde (für die Liste im Profil).
  function loadSigned() {
    var raw = LS.getItem("signedPetitions"), m = new Map();
    if (raw) {
      try {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach(function (x) {
          if (typeof x === "string") m.set(x, { ts: null });      // altes Format
          else if (x && x.url) m.set(x.url, {
            ts: x.ts || null, title: x.title || null, platform: x.platform || null });
        });
      } catch (e) {}
    }
    return m;
  }
  function saveSigned() {
    var arr = [];
    state.signed.forEach(function (v, k) {
      arr.push({ url: k, ts: v.ts || null, title: v.title || null,
                 platform: v.platform || null });
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
      platform: (meta && meta.platform) || null
    });
    saveSigned();
  }
  function setArchived(u, on) {
    if (on) state.archived.add(u); else state.archived.delete(u);
    saveSet("archivedPetitions", state.archived);
  }
  function livePlatforms() {
    return state.manifest.platforms.filter(function (p) { return p.live; });
  }

  // ---- Daten laden -----------------------------------------------------------
  function fetchJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
    });
  }
  function loadManifest() {
    return fetchJSON(state.base + "/manifest.json").then(function (m) {
      state.manifest = m; return m;
    });
  }
  function loadPlatformData(key) {
    if (state.dataCache[key]) return Promise.resolve(state.dataCache[key]);
    return fetchJSON(state.base + "/" + key + ".json").then(function (arr) {
      state.dataCache[key] = arr; return arr;
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

    // Begrüßung: erklärt in zwei Zeilen, worum es geht, und führt zur Suche.
    var hello = T("app.welcomeTitle", "Willkommen im PetitionsManager");
    var name = (state.prefs.name || "").trim();
    content.appendChild(el('<div class="welcome">' +
      '<h1 class="welcome__t">' +
        esc(name ? "Schön, dass du da bist, " + name + "." : hello) + "</h1>" +
      '<p class="welcome__s">' +
        esc(T("app.welcomeText",
              "Mit der Suche findest du aktuelle Petitionen – " +
              "plattformübergreifend an einem Ort.")) + "</p></div>"));

    // Volltextsuche über alle aktivierten Plattformen (Feld + Button).
    var searchRow = el('<form class="mainsearch" role="search">' +
      '<input class="mainsearch__in" type="search" ' +
      'placeholder="' + esc(T("liste.searchPlaceholder",
        "Alle Petitionen durchsuchen …")) + '" value="' +
      esc(state.mainQuery) + '">' +
      '<button class="mainsearch__btn" type="submit" aria-label="Suchen">' +
      '<i class="fa-solid fa-magnifying-glass"></i> Suchen</button></form>');
    var searchIn = searchRow.querySelector(".mainsearch__in");
    searchRow.addEventListener("submit", function (e) {
      e.preventDefault();
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

    // Gruppen aufbauen: (1) Favoriten zuerst, (2) danach nach Sprache.
    var groupDefs = [];
    var favs = live.filter(function (p) { return isFav(p.key); });
    if (favs.length) groupDefs.push({ key: "__fav", label: "Favoriten", plats: favs });
    else if (T("favorites.how", "")) {
      // Noch keine Favoriten: einmal erklären, wie das geht.
      content.appendChild(el('<div class="favtip">' +
        '<i class="fa-solid fa-star"></i><p>' +
        esc(T("favorites.how",
              "Tippe in den Einstellungen auf den Stern neben einer " +
              "Plattform – sie erscheint dann ganz oben in deiner Liste.")) +
        "</p></div>"));
    }

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
    var lf = platInfo(p.key).logoFile;
    var lar = platInfo(p.key).logoAR || 4;
    /* Hochkant-Symbole (innn.it) brauchen mehr Höhe als Wortmarken: bei
       gleicher Höhe ist eine 0,75er-Marke nur 22 px breit, eine Wortmarke
       aber 60–185 px – nebeneinander wirkt das Symbol wie gar nichts.
       Deshalb eine eigene Klasse ab Seitenverhältnis < 1,2. */
    var mark = lf
      ? '<span class="plogo--mark' +
        '" aria-hidden="true" style="--logo:url(' + esc(lf) +
        ');--logo-ar:' + lar + '"></span>'
      : "";
    var card = el(
      '<button class="plat' + (size ? " " + size : "") + '"' +
        (brand ? ' style="--brand:' + esc(brand) + '"' : "") + ">" +
        platLogo(p.key, p.name) + mark +
        '<span class="plat__body">' +
          /* Keine Flagge an der einzelnen Kachel: die Liste ist ohnehin nach
             Sprache gruppiert, und die Gruppenüberschrift trägt sie einmal
             für alle. An jeder Kachel wiederholt, war sie nur Rauschen. */
          '<span class="plat__name">' + esc(p.name) + "</span>" +
          '<span class="plat__meta">' + nf.format(p.online) +
            " Petitionen" + newLabel + '</span>' +
          (tagline ? '<span class="plat__tag">' + esc(tagline) + "</span>" : "") +
        '</span>' +
        '<span class="plat__chev">' +
          '<i class="fa-solid fa-arrow-right"></i></span>' +
      '</button>');
    card.addEventListener("click", function () {
      state.platform = p.key; state.search = "";
      state.catFilter = null; state.tagFilter = null;
      state.sort = null; render();
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
    state.openPetitionUrl = url;
    render();
  }

  /* Sprungmarke: kleiner Knopf, der zu einer Stelle in der Liste rollt und sie
     kurz hervorhebt. `ziel` ist eine FUNKTION, kein Element – die Liste wird
     bei jedem Filter neu gezeichnet, ein beim Bauen gemerktes Element wäre
     danach nicht mehr im Dokument.
     Findet sich nichts (die Liste ist auf LIST_MAX gedeckelt, das Ziel kann
     also jenseits davon liegen), sagt der Knopf das, statt stumm nichts zu
     tun – ein Klick ohne Wirkung wäre als Fehler nicht erkennbar. */
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
    var thumb = r.image_url
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
        '<div class="pet__row">' + signedBadge + closedBadge + sig + "</div>" +
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
          toggleSigned(r.url, { title: r.title, platform: platKey });
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
  function loadTextChunk(key, n) {
    var id = key + "." + n;
    if (!textChunks[id])
      textChunks[id] = fetchJSON(state.base + "/" + key + ".t" + n + ".json");
    return textChunks[id];
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
  function simTokens(str) {
    var out = {};
    (str || "").toLowerCase().split(/[^a-zäöüßà-ÿ]+/).forEach(function (w) {
      if (w.length >= 4 && !SIM_STOP[w]) out[w] = 1;
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
  function similarityScore(a, b) {
    var at = {}, bt = {};
    (a.tags || []).forEach(function (t) { at[t.toLowerCase()] = 1; });
    (b.tags || []).forEach(function (t) { bt[t.toLowerCase()] = 1; });
    var tagJac = jaccard(at, bt);
    var titleJac = jaccard(simTokens(a.title), simTokens(b.title));
    var contentJac = jaccard(
      simTokens((a.title || "") + " " + (a.summary || "")),
      simTokens((b.title || "") + " " + (b.summary || "")));
    var sameCat = (a.category && b.category &&
      a.category.toLowerCase() === b.category.toLowerCase()) ? 1 : 0;
    var sameTitle = (a.title && (a.title || "").trim().toLowerCase() ===
      (b.title || "").trim().toLowerCase()) ? 1 : 0;
    if (sameTitle) return 1;                    // exakt gleiche Petition
    return tagJac * 0.45 + titleJac * 0.30 + contentJac * 0.15 + sameCat * 0.10;
  }

  // Findet gleiche/ähnliche Petitionen und sortiert nach (unsichtbarem) Score.
  function findSimilar(r, all, max) {
    max = max || 6;

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

    // Kandidaten: teilen mind. ein Schlagwort, sind online und nicht archiviert.
    var mine = {};
    (r.tags || []).forEach(function (t) { mine[t.toLowerCase()] = 1; });
    if (!Object.keys(mine).length) return [];
    var cands = [];
    all.forEach(function (grp) {
      grp.arr.forEach(function (c) {
        if (c.url === r.url || isArchived(c.url) || isClosed(c) ||
            (c.status || "online") === "offline") return;
        var tags = c.tags || [], shares = false;
        for (var i = 0; i < tags.length; i++)
          if (mine[tags[i].toLowerCase()]) { shares = true; break; }
        if (!shares) return;
        var score = similarityScore(r, c);
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
    box.innerHTML = lbl + sim.map(function (s) {
      var info = langInfo(s.plat.language || "de");
      var same = s.same ? '<span class="sim-same">gleich</span>' : "";
      return '<button class="simrow" type="button" data-key="' + esc(s.plat.key) +
        '" data-url="' + esc(s.c.url) + '"><span class="simrow__t">' +
        esc(s.c.title || "(ohne Titel)") + same + "</span>" +
        '<span class="simrow__p">' + esc(s.plat.name) +
        '<span class="flag">' + info.flag + "</span></span></button>";
    }).join("");
    box.querySelectorAll(".simrow").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openPetitionInApp(btn.dataset.key, btn.dataset.url);
      });
    });
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
        '<div class="pet__desc">' + (r.description_full ||
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
          r.description_full = html;            // im Speicher merken
          descBox.innerHTML = html;
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
        renderSimilar(simBox, findSimilar(r, all, 6));
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
      platLogo(key, manifestEntry.name) +
      '<span class="pabout__lbl">' +
        esc(T("platform.aboutBtn", "Über diese Plattform")) + "</span>" +
      '<i class="fa-solid fa-chevron-down pabout__chev"></i></button>' +
      '<div class="pabout__body"></div></div>');
    var body = box.querySelector(".pabout__body");
    // Echtes Logo als Aufmacher. Anders als auf der Bento-Kachel steht es hier
    // auf hellem Kartengrund – deshalb in der Markenfarbe statt in der
    // Textfarbe (style.css → .pabout__logo).
    if (info.logoFile)
      body.appendChild(el('<span class="pabout__logo" role="img" ' +
        'aria-label="Logo ' + esc(manifestEntry.name || key) +
        '" style="--logo:url(' + esc(info.logoFile) + ');--logo-ar:' +
        (info.logoAR || 4) + '"></span>'));
    box.querySelector(".pabout__head").addEventListener("click", function () {
      state.aboutPlatform = !box.classList.contains("open");
      box.classList.toggle("open", state.aboutPlatform);
    });

    if (about.text) body.appendChild(el("<p>" + esc(about.text) + "</p>"));

    // Kennzahlen nur zeigen, was wirklich hinterlegt ist.
    var facts = [
      [T("platform.operatorLabel", "Träger"), about.operator],
      [T("platform.seatLabel", "Sitz"), about.seat],
      [T("platform.foundedLabel", "Gegründet"), about.founded],
      [T("platform.financingLabel", "Finanzierung"), about.financing]
    ].filter(function (f) { return f[1]; });
    if (facts.length) {
      var dl = el('<dl class="pabout__facts"></dl>');
      facts.forEach(function (f) {
        dl.appendChild(el("<dt>" + esc(f[0]) + "</dt>"));
        dl.appendChild(el("<dd>" + esc(f[1]) + "</dd>"));
      });
      body.appendChild(dl);
    }

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
      state.sort = null; render();
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

    content.appendChild(platformAbout(key));

    if (!LS.getItem("swipeHintDismissed")) {
      var hint = el('<div class="swipe-hint">' +
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

    var searchBox = el('<input class="search" type="search" ' +
      'placeholder="In dieser Plattform suchen …" value="' + esc(state.search) + '">');
    content.appendChild(searchBox);

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
      var opts = [["", "Standardreihenfolge", "fa-list"]];
      if (mitDatum) opts.push(["neu", "Neueste zuerst", "fa-arrow-down-wide-short"],
                              ["alt", "Älteste zuerst", "fa-arrow-up-wide-short"]);
      if (mitZahl) opts.push(["viel", "Meiste Unterschriften", "fa-arrow-down-9-1"],
                             ["wenig", "Wenigste Unterschriften", "fa-arrow-up-1-9"]);
      var h = '<div class="ptools__grp"><span class="ptools__h">Sortierung</span>' +
        '<div class="chiprow">' + opts.map(function (o) {
          return '<button class="chip" type="button" data-sort="' + o[0] + '">' +
            '<i class="fa-solid ' + o[2] + '"></i> ' + o[1] + "</button>";
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
      if (luecken.length)
        h += '<div class="ptools__note"><i class="fa-solid fa-circle-info"></i>' +
             '<span class="ptools__notetext">' +
             luecken.map(function (l) {
               return '<span data-luecke="' + esc(l.feld || "") + '">' +
                      esc(l.text) + "</span>";
             }).join("") + "</span></div>";
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
      /* Sprungmarke je Lücke: führt zur ersten Petition, der der Wert fehlt.
         Die Adressen werden einmal gesammelt; gesucht wird erst beim Klick in
         der gerade gezeichneten Liste, denn Filter und Sortierung ändern
         laufend, welche Karte die erste ist. */
      tbody.querySelectorAll("[data-luecke]").forEach(function (sp) {
        var feld = sp.dataset.luecke;
        if (!feld) return;                       // Satz ohne Ziel
        var fehlend = {};
        arr.forEach(function (r) {
          var leer = feld === "signatures"
            ? typeof r.signatures !== "number" : !r.start_date;
          if (leer && r.url) fehlend[r.url] = 1;
        });
        sp.appendChild(jumpBtn("Zur ersten", function () {
          var karten = listWrap.querySelectorAll(".pet");
          for (var i = 0; i < karten.length; i++)
            if (fehlend[karten[i].dataset.url]) return karten[i];
          return null;
        }));
      });
    }

    // Zeigt am zugeklappten Ausklapper, ob gerade etwas eingestellt ist.
    function markTools() {
      var namen = { neu: "Neueste zuerst", alt: "Älteste zuerst",
                    viel: "Meiste Unterschriften", wenig: "Wenigste Unterschriften" };
      var aktiv = [];
      if (state.sort) aktiv.push(namen[state.sort]);
      if (state.catFilter) aktiv.push(state.catFilter);
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
      var term = state.search.trim().toLowerCase();
      var rows = sortRows(arr.filter(function (r) {
        if (state.catFilter && r.category !== state.catFilter) return false;
        if (state.tagFilter && (r.tags || []).indexOf(state.tagFilter) < 0) return false;
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
      note.textContent = state.catFilter
        ? nf.format(active.length) + " Petition(en) in dieser Kategorie"
        : state.tagFilter
        ? nf.format(active.length) + " Petition(en) mit diesem Schlagwort"
        : nf.format(active.length) + " von " + nf.format(arr.length) + " Petitionen";

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
        var open = state[stateKey];
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

      // Nach Navigation aus „Ähnliche Petitionen": Ziel aufklappen + hinscrollen.
      if (state.openPetitionUrl) {
        var target = state.openPetitionUrl; state.openPetitionUrl = null;
        var pets = listWrap.querySelectorAll(".pet");
        for (var pi = 0; pi < pets.length; pi++) {
          if (pets[pi].dataset.url === target) {
            var petEl = pets[pi];
            if (!petEl.classList.contains("open"))
              petEl.querySelector(".pet__head").click();
            (function (elm) {
              setTimeout(function () {
                elm.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 80);
            })(petEl);
            break;
          }
        }
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
    titleEl.textContent = "Suche: " + f.value;
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
      titleEl.textContent = "Suche: " + state.cross.value;
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
        var hd = el('<button class="acc-head"><span class="acc-title">' +
          esc(p.name) + '<span class="flag">' + info.flag + "</span>" +
          '<span class="acc-count">' + hits.length + "</span></span>" +
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
      [["klassisch", T("settings.layoutClassic", "Klassisch"), "fa-list"],
       ["band", T("settings.layoutBand", "Farbband"), "fa-bars-staggered"],
       ["magazin", T("settings.layoutMag", "Magazin"), "fa-image"]],
      state.prefs.layout,
      function (v) { state.prefs.layout = v; savePrefs(); applyLayout(); }));
    content.appendChild(el('<div class="srow__note">' +
      esc(T("settings.layoutHint",
            "Ändert nur das Aussehen der Listen, nicht die Inhalte. " +
            "„Klassisch“ ist die bisherige Ansicht.")) + "</div>"));

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
        platLogo(p.key, p.name) +
        '<div class="opt__body"><div class="opt__name">' + esc(p.name) +
          '<span class="flag">' + finfo.flag + '</span></div>' +
        '<div class="opt__meta">' + (p.live
          ? finfo.name + " · " + nf.format(p.online) + " Petitionen"
          : finfo.name + " · in Vorbereitung") + '</div></div>' +
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
      T("settings.refreshHint", "Petitionen neu von der Quelle laden"),
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>' });
    refreshRow.addEventListener("click", function () {
      var sub = refreshRow.querySelector(".srow__s");
      sub.textContent = "Wird geladen …";
      state.dataCache = {};
      loadManifest().then(function () {
        sub.textContent = "Aktualisiert am " + fmtDateTime(new Date().toISOString());
      }).catch(function () { sub.textContent = "Nicht erreichbar."; });
    });
    content.appendChild(refreshRow);

    content.appendChild(setRow("fa-database",
      T("settings.source", "Datenquelle"), state.base,
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>',
        onClick: function () {
          var v = prompt("URL der Datenquelle (Basis-Ordner mit manifest.json):",
                         state.base);
          if (v == null) return;
          state.base = v.trim() || DEFAULT_BASE;
          LS.setItem("dataBase", state.base);
          state.dataCache = {}; state.manifest = null;
          boot();
        } }));

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
      LS.removeItem("swipeHintDismissed");
      hintRow.classList.add("srow--done");
      hintRow.querySelector(".srow__s").textContent =
        "Zurückgesetzt – die Hinweise erscheinen wieder.";
      hintRow.querySelector(".srow__go").className = "fa-solid fa-check srow__go";
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
    state.base = DEFAULT_BASE;
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

  function notifySupported() { return "Notification" in window; }

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
      } else if (Notification.permission === "denied") {
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
      if (on && notifySupported() && Notification.permission === "default") {
        Notification.requestPermission().then(function (perm) {
          if (perm !== "granted") { self.checked = false; on = false; }
          n.on = on; savePrefs(); refreshState();
          detail.style.display = on ? "" : "none";
          scheduleNotify();
        });
        return;
      }
      n.on = on; savePrefs(); refreshState();
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
    testBtn.addEventListener("click", function () {
      showNotification(T("notify.sampleTitle", "PetitionsManager"),
        fill(T("notify.sampleBodyNew", "{n} neue Petitionen warten auf dich."),
             { n: countNew() }));
    });
    detail.appendChild(testBtn);

    detail.appendChild(el('<div class="srow__note">Hinweis: Die Meldung ' +
      "erscheint, sobald du die App nach der gewählten Uhrzeit das nächste " +
      "Mal öffnest oder sie im Hintergrund noch läuft. Eine Erinnerung bei " +
      "komplett geschlossener App bräuchte einen eigenen Server – den hat " +
      "diese App bewusst nicht.</div>"));

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

  function showNotification(title, body) {
    if (!notifySupported() || Notification.permission !== "granted") return false;
    try {
      new Notification(title, { body: body, icon: "icons/icon-192.png",
                                tag: "petitionsmanager-daily" });
      return true;
    } catch (e) { return false; }
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
      if (showNotification(T("notify.sampleTitle", "PetitionsManager"), body)) {
        n.lastDate = today; savePrefs();
      }
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
                     "archivedPetitions", "swipeHintDismissed", "dataBase",
                     "prefs"];

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
    var oldBase = state.base;
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
    state.base = LS.getItem("dataBase") || DEFAULT_BASE;
    state.prefs = loadPrefs();
    applyTheme();
    applyLayout();
    scheduleNotify();
    // Zahlen für die Rückmeldung.
    return {
      favoriten: state.favorites.size,
      unterschrieben: state.signed.size,
      archiviert: state.archived.size,
      baseChanged: state.base !== oldBase
    };
  }

  function importData(file, onDone) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var stats = applyBackup(JSON.parse(reader.result));
        if (stats.baseChanged) {           // Datenquelle geändert → neu laden
          state.dataCache = {}; state.manifest = null;
          loadManifest().then(function () { onDone(true, stats); })
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
    content.innerHTML = "";
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
    content.appendChild(head);

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
        var row = el('<button class="signed-item" type="button"' +
          (brand ? ' style="--brand:' + esc(brand) + '"' : "") + ">" +
          (v.platform ? platLogo(v.platform, pn) : "") +
          '<span class="signed-item__body">' +
          '<span class="signed-item__t">' +
            highlight(v.title || url, state.signedQuery) + "</span>" +
          '<span class="signed-item__meta">' +
            (pn ? highlight(pn, state.signedQuery) + " · " : "") +
            '<span class="signed-item__when">' + esc(fmtDateTime(v.ts)) +
          "</span></span></span></button>");
        if (v.platform) {
          row.addEventListener("click", function () {
            openPetitionInApp(v.platform, url);
          });
        } else { row.disabled = true; row.classList.add("signed-item--nolink"); }
        sList.appendChild(row);
      });
    }
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
          '<span class="chip__flag">' + info.flag + "</span>" +
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
    window.scrollTo(0, 0);
  }

  // Seitentitel und Inhaltsüberschrift können denselben Text tragen – in den
  // Einstellungen steht zweimal „Einstellungen" untereinander. Dann wird die
  // Titelzeile ausgeblendet statt sie doppelt zu zeigen. Bewusst als Vergleich
  // der Texte und nicht als Liste von Ausnahmen: so greift es von allein auch
  // für Ansichten, die später dazukommen.
  function syncPageTitle() {
    function norm(s) { return String(s || "").trim().toLowerCase(); }
    var h1 = content.querySelector(".welcome__t");
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
    loadManifest().then(function () {
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
