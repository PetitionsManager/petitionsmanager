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
    it: { name: "Italienisch", flag: "🇮🇹" },
    /* 4.9.2026 dazu: WeMove liefert seine Kampagnen in sieben Sprachen, seither
       hat jede einen eigenen Plattform-Eintrag. Ohne diese beiden Zeilen stünde
       im Sprachschritt „nl" und „pl" statt eines Namens, mit weißer Fahne. */
    nl: { name: "Niederländisch", flag: "🇳🇱" },
    pl: { name: "Polnisch", flag: "🇵🇱" },
    /* Avaaz führt seine Bürgerpetitionen in 21 Sprachen (4.9.2026 aus dem
       Petitionsbereich selbst ausgelesen). Diese zwölf sind dazugekommen.
       ⚠️ Die Flagge ist ein BEHELF: eine Sprache ist kein Land. Wo die
       Zuordnung eindeutig genug ist, steht die übliche Flagge; bei Suaheli,
       das in mehreren Staaten Amtssprache ist, wäre jede Wahl eine Behauptung
       — dort steht die Weltkugel. */
    pt: { name: "Portugiesisch", flag: "🇵🇹" },
    ru: { name: "Russisch", flag: "🇷🇺" },
    uk: { name: "Ukrainisch", flag: "🇺🇦" },
    tr: { name: "Türkisch", flag: "🇹🇷" },
    ro: { name: "Rumänisch", flag: "🇷🇴" },
    el: { name: "Griechisch", flag: "🇬🇷" },
    ja: { name: "Japanisch", flag: "🇯🇵" },
    ko: { name: "Koreanisch", flag: "🇰🇷" },
    zh: { name: "Chinesisch", flag: "🇨🇳" },
    id: { name: "Indonesisch", flag: "🇮🇩" },
    ms: { name: "Malaiisch", flag: "🇲🇾" },
    sw: { name: "Suaheli", flag: "🌍" }
  };
  /* Reihenfolge im Sprachschritt: Deutsch und Englisch zuerst (die Oberfläche
     kennt nur diese beiden), dann die europäischen Nachbarn, dann der Rest. */
  var LANG_ORDER = ["de", "en", "fr", "es", "it", "nl", "pl", "pt", "ro",
                    "el", "uk", "ru", "tr", "id", "ms", "sw", "ja", "ko", "zh"];
  /* ⚠️ Der ANZEIGENAME wird bei jedem Aufruf frisch aus texts.js geholt
     (lang.<code>), nicht aus LANG selbst: LANG ist ein `var` und wird beim
     Laden GENAU EINMAL ausgewertet — ein Sprachwechsel käme dort nie an.
     Die Flagge bleibt in LANG, die ist in jeder Sprache dieselbe. */
  function langInfo(code) {
    var e = LANG[code];
    if (e) return { name: T("lang." + code, e.name), flag: e.flag };
    return { name: (code || T("lang.other", "Andere")), flag: "🏳️" };
  }
  function langRank(code) {
    var i = LANG_ORDER.indexOf(code); return i < 0 ? 99 : i;
  }

  /* ---- Sprachen EINER PLATTFORM (8.8.2026) --------------------------------
     ⚠️ Zwei Fragen, die man auseinanderhalten muss:

       „In welcher Sprache ist diese Plattform?"   → p.language, EINE Sprache.
           Danach wird die Kachelliste GRUPPIERT und die Flagge gewählt. Eine
           zweisprachige Plattform darf hier nicht in zwei Gruppen stehen,
           sonst erschiene dieselbe Kachel zweimal.

       „Welche Sprachen BIETET diese Plattform?"   → platLanguages(), MEHRERE.
           Trägt die zweite Flagge an der Kachel („gibt es auch auf Englisch").

     ⚠️ 11.8.2026 GEÄNDERT: der Einrichtungs-Assistent filtert NICHT mehr
     danach, sondern nach p.language (siehe platMainLanguage weiter unten).
     Hier stand vorher das Gegenteil, und es war für den 8.8.-Stand richtig:
     damals war europarl deutsch mit englischer Übersetzung, und ohne
     platLanguages() hätte man nach Englisch gar nicht filtern können.
     Seit europarl wieder englisch ist und die Sprache eine eigene
     Auswahldimension wird (künftig je Sprache ein eigener Plattform-Eintrag),
     ist die Hauptsprache das richtige Kriterium — sonst stünden unter
     „Englisch" sechs Plattformen, deren Petitionen deutsch sind.

     `languages` liefert publish.py aus den Daten (Hauptsprache zuerst); fehlt
     es (älteres Manifest), bleibt es bei der einen Sprache. */
  function platLanguages(p) {
    if (p && Array.isArray(p.languages) && p.languages.length)
      return p.languages;
    return [(p && p.language) || "de"];
  }
  // Die EINE Sprache einer Plattform — das Kriterium, nach dem der
  // Einrichtungs-Assistent und die Einstellungen gliedern.
  function platMainLanguage(p) { return (p && p.language) || "de"; }

  /* ---- LAND EINER PLATTFORM (4.9.2026) ------------------------------------
     Zwillingsachse zur Sprache, mit EINEM Unterschied, der die ganze Form
     bestimmt: jede Plattform hat eine Sprache, aber nur sechs von 17 Einträgen
     kennen überhaupt die Größe „Land". Ein bloßes Länderkürzel je Eintrag
     würde deshalb nicht reichen — „kein Land" wäre nicht von „Land noch nicht
     geholt" zu unterscheiden, und der Filter müsste raten.

     Das Manifest liefert deshalb drei Angaben (publish.py):
       country_scope  "keine" | "fest" | "mehrere"  — WARUM ein Land fehlt
       country        nur bei "fest" gesetzt
       countries      aus den DATEN abgeleitet, wie languages

     Anlass war ein gemessener Fehler: Change.org verwarf am 30.8.2026 elf von
     60 deutschSPRACHIGEN Petitionen, weil sie aus AT/CL/IT/UA/IN kamen. Sprache
     und Land sind zwei Fragen, und die App hat bis heute nur die erste gestellt. */
  /* ZWEI Pseudo-Codes, nicht einer — und das ist keine Spitzfindigkeit:
       LAND_INTL      die Quelle nennt kein Land (Avaaz, WeMove, Ekō, 350.org)
       LAND_UNERHOBEN die Quelle kennt Länder, WIR haben sie nicht erhoben
     Beides in einen Topf zu werfen hieße, eine Wissenslücke als Eigenschaft
     der Plattform auszugeben. Genau diese Verwechslung hat den Länderschritt
     am 4.9.2026 zweimal unverständlich gemacht — einmal im Chip-Namen, einmal
     an der Kachel. */
  var LAND_INTL = "intl";        // Pseudo-Code für „ohne Landbezug"
  var LAND_UNERHOBEN = "offen";  // Pseudo-Code für „Land noch nicht erhoben"
  /* Reihenfolge im Selektor. Deutschland zuerst (Hauptzielgruppe), dann die
     deutschsprachigen Nachbarn, dann die bei europarl gemessenen Größen. Alles
     Übrige sortiert sich alphabetisch dahinter, „International" ganz ans Ende:
     es ist kein Land und soll nicht zwischen den Ländern stehen. */
  var LAND_ORDER = ["DE", "AT", "CH", "ES", "FR", "IT", "NL", "PL", "GB", "US"];
  function landRank(code) {
    /* „Weltweit" steht GANZ OBEN (Nutzerwunsch 4.9.2026) — es ist die größte
       Gruppe (acht Einträge) und die einzige, die unabhängig von jeder
       Länderwahl gilt. Vorher stand es hinter allen Ländern, also je nach
       Datenlage irgendwo unter zehn Zeilen.
       Die Wissenslücke bleibt dagegen unten: sie ist ein Restposten. */
    if (code === LAND_INTL) return -1;
    if (code === LAND_UNERHOBEN) return 999;
    var i = LAND_ORDER.indexOf(code); return i < 0 ? 99 : i;
  }
  /* Die Flagge wird BERECHNET, nicht in einer Tabelle geführt: ein ISO-Kürzel
     ist genau das Paar regionaler Indikatoren (U+1F1E6 + Buchstabenabstand).
     Eine Tabelle hätte für jedes neue Land gepflegt werden müssen und wäre
     genau dann veraltet gewesen, wenn der Länderfilter gelockert wird. Ein
     unbelegtes Kürzel zeigt der Browser als zwei Buchstabenkästchen — sichtbar
     unfertig, aber nicht kaputt. */
  function landFlagge(code) {
    if (!/^[A-Z]{2}$/.test(code || "")) return "🏳️";
    return String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 65,
                                0x1F1E6 + code.charCodeAt(1) - 65);
  }
  /* ⚠️ Wie bei langInfo(): der ANZEIGENAME kommt bei jedem Aufruf frisch aus
     texts.js (land.<code>), nie aus einer var auf Modulebene — die würde beim
     Laden genau einmal ausgewertet, und ein Sprachwechsel käme dort nie an.
     Fehlt ein Name, steht das Kürzel da. Das ist Absicht: lieber „PL" als eine
     leere Fläche oder ein erfundener Name. */
  /* ⚠️ Der Pseudo-Eintrag hieß bis zum 4.9.2026 „International" und wurde
     prompt falsch verstanden: der Nutzer erwartete darunter fremdsprachige
     Plattformen und bekam deutsche. Er bedeutet aber „die QUELLE nennt kein
     Land" — Avaaz auf Deutsch ist eine internationale Plattform mit deutschen
     Petitionen und steht zu Recht darin. Der Name sagt das jetzt. */
  function landInfo(code) {
    if (code === LAND_INTL)
      return { name: T("land.intl", "Weltweit"), flag: "🌍" };
    if (code === LAND_UNERHOBEN)
      return { name: T("land.offen", "Noch nicht zugeordnet"), flag: "🏳️" };
    return { name: T("land." + code, code || "—"), flag: landFlagge(code) };
  }

  // Kennt die QUELLE dieser Plattform die Größe Land überhaupt nicht?
  // Acht Einträge: Avaaz, WeMove, Ekō, 350.org (je de/en).
  function platLandneutral(p) {
    return !p || p.country_scope === "keine" || !p.country_scope;
  }

  /* Trägt das Manifest die Landachse überhaupt? Das ist NICHT dasselbe wie
     „alle Einträge sind landneutral", und die Unterscheidung ist der ganze
     Punkt: fehlt das Feld `country_scope` durchgehend, stammt das Manifest von
     VOR der Landachse — dann ist der Länderschritt nicht etwa leer, sondern
     unwissend, und er muss das sagen statt einen einzelnen wirkungslosen Chip
     zu zeigen.

     ⚠️ Genau dieser Fall stand am 4.9.2026 in der Vorschau: das ausgelieferte
     Manifest hatte bei 17 von 17 Einträgen kein Landfeld, weil „Scrape &
     Publish" mit dem neuen publish.py noch nicht gelaufen war. Der Schritt sah
     dadurch aus wie ein Fehler im Filter. */
  function manifestKenntLaender() {
    var ps = (state.manifest && state.manifest.platforms) || [];
    return ps.some(function (p) { return !!p.country_scope; });
  }
  /* Die Länder, die dieser Eintrag WIRKLICH führt. Leer heißt je nach scope
     zweierlei — siehe platPasstZuLand(), dort wird der Unterschied ausgewertet. */
  function platCountries(p) {
    if (p && Array.isArray(p.countries) && p.countries.length)
      return p.countries;
    return (p && p.country) ? [p.country] : [];
  }
  /* Wie viele Petitionen stehen insgesamt hinter einem Land? Summiert über
     alle Einträge; publish.py liefert `country_counts` je Plattform.

     ⚠️ Gebraucht wird das NUR für die Vorauswahl, nicht für den Filter. Ein
     Land mit einer einzigen Petition bleibt anwählbar — es wird bloß nicht von
     selbst angehakt. Anlass (4.9.2026): die Ländervorwahl nahm die Region des
     Geräts, sobald sie in der Liste stand, und wählte auf einem en-US-Gerät
     „Vereinigte Staaten" mit EINER Petition vor statt Deutschland. */
  function landBestand(code) {
    return livePlatforms().reduce(function (summe, p) {
      var z = p && p.country_counts;
      return summe + ((z && z[code]) || 0);
    }, 0);
  }
  /* Ab wann trägt ein Land genug Bestand, um vorausgewählt zu werden?
     ⚠️ Nicht geraten, sondern an der Lücke abgelesen. Bei openPetition am
     4.9.2026 gemessen: DE 1.636 · AT 181 · CH 76 — dann fällt es auf IT 3,
     BE 2 und fünf Länder mit je EINER Petition. Zwischen 76 und 3 liegt ein
     Faktor 25; die Schwelle sitzt also mitten in einer breiten Lücke und nicht
     an einer Kante, wo ein einzelner neuer Satz sie kippen könnte. */
  var LAND_MINDEST = 50;

  // Das EINE Land eines Eintrags, sofern er auf eines festgelegt ist.
  function platMainCountry(p) {
    if (platLandneutral(p)) return LAND_INTL;
    var da = platCountries(p);
    return da.length === 1 ? da[0] : ((p && p.country) || null);
  }

  /* Das Landzeichen an der Plattformkachel — DREI Fälle, drei Glyphen. Ohne
     das war in Schritt 4 nicht zu sehen, warum ein Eintrag drin oder draußen
     ist; die Kachel nannte nur Logo, Name und Zahl.

     ⚠️ Der dritte Fall braucht ein EIGENES Zeichen. „mehrländrig, Land noch
     nicht erhoben" (openPetition, foodwatch) mit derselben Weltkugel zu malen
     wie „die Quelle nennt kein Land" (Avaaz) würde eine Wissenslücke als
     Eigenschaft der Plattform ausgeben — und genau diese Verwechslung hat den
     Länderschritt am 4.9.2026 unverständlich gemacht. */
  function platLandZeichen(p) {
    /* ⚠️ ZUERST fragen, ob das Manifest die Achse überhaupt führt. Ohne diese
       Zeile behauptet die Kachel bei einem alten Manifest „Diese Plattform
       nennt kein Land" — auch beim Bundestag, der fest auf DE steht. Das wäre
       nicht bloß nutzlos, sondern nachweislich falsch: platLandneutral() kann
       „kein Land" und „Feld fehlt" nicht unterscheiden, das ist gerade seine
       Aufgabe als Rückfall. Kein Zeichen ist besser als ein unwahres. */
    if (!manifestKenntLaender()) return null;
    if (platLandneutral(p))
      return { text: "🌍", titel: T("land.intlTitle",
        "Diese Plattform nennt kein Land") };
    var da = platCountries(p);
    if (da.length)
      return { text: da.map(landFlagge).join(""),
               titel: da.map(function (c) { return landInfo(c).name; }).join(", ") };
    return { text: "🏳️", titel: T("land.unknownTitle",
      "Diese Plattform kennt Länder – wir haben sie noch nicht erhoben") };
  }

  /* Passt dieser Plattform-EINTRAG zur Länderauswahl?

     ⚠️ Die dritte Zeile ist die wichtige: ein Eintrag mit scope "mehrere" und
     LEERER Länderliste darf NICHT ausgeblendet werden. Das trifft heute
     openPetition (1.903 Sätze) und foodwatch — bei beiden kennt die Quelle
     Länder, unsere Daten aber nicht, weil alle Sätze unter /petition/ bzw.
     /de/ stehen. Ein Ausblenden hieße: eine Plattform verschwindet, weil UNS
     etwas fehlt, nicht weil sie nicht passt. */
  function platPasstZuLand(p, wahl) {
    if (!wahl || !wahl.size) return true;         // ohne Auswahl keine Einschränkung
    if (platLandneutral(p)) return wahl.has(LAND_INTL);
    var da = platCountries(p);
    /* ⚠️ 4.9.2026 GEÄNDERT. Hier stand `return true` — ein Eintrag mit
       unerhobenem Land passierte JEDE Auswahl. Der Gedanke war richtig (eine
       Plattform darf nicht verschwinden, weil UNS Daten fehlen), die Umsetzung
       aber still: drei Einträge waren dauerhaft an, ohne im Schritt
       aufzutauchen, und die Chip-Zahlen ergaben 14 statt 17. Genau das ist dem
       Nutzer aufgefallen.

       Jetzt hängen sie an einem eigenen Chip, der VORAUSGEWÄHLT ist. Die
       Vorgabe verhält sich damit wie vorher, aber sie ist sichtbar und
       abwählbar — aus einem verschwiegenen Automatismus wird eine Entscheidung. */
    if (!da.length) return wahl.has(LAND_UNERHOBEN);
    return da.some(function (c) { return wahl.has(c); });
  }

  /* Passt diese einzelne PETITION zur Länderauswahl? Zweite Ebene, für die
     mehrländrigen Einträge: europarl trägt 27 Mitgliedstaaten in EINEM Eintrag
     (gemessen DE 91, AT 19, ES 467), Change.org entsprechend.

     ⚠️ Ein Satz OHNE Landangabe passt immer. Bei „fest" und „keine" trägt keine
     Petition ein Land, und bei „mehrere" ist eine Lücke eine Scrape-Lücke, kein
     Ausschluss — Change.orgs COUNTRY_RE greift nicht auf jeder Seite. Sätze
     wegen einer Lücke in unseren Daten zu verstecken wäre derselbe Fehler wie
     oben, nur eine Ebene tiefer. */
  function petitionPasstZuLand(r, p, wahl) {
    if (!wahl || !wahl.size) return true;
    if (platLandneutral(p)) return wahl.has(LAND_INTL);
    if (!r || !r.country) return true;
    return wahl.has(r.country);
  }

  /* ---- Sprachgruppe mit Flaggenkreis (11.8.2026) --------------------------
     Gemeinsames Bauteil für Schritt 2 des Einrichtungs-Assistenten UND die
     Plattformliste in den Einstellungen. Der Nutzer soll die Aufteilung dort
     wiedererkennen — deshalb EINE Funktion und nicht zwei ähnliche Blöcke,
     die beim nächsten Eingriff auseinanderlaufen.

     Bewusst flacher als .accordion aus der Hauptliste: beide Einsatzorte
     stecken schon in einem Rahmen (Overlay bzw. das Akkordion „Plattformen"),
     ein zweiter Kasten ergäbe eine Schachtel in der Schachtel.

     Die Flagge trägt die Gliederung, deshalb steht sie NUR in der Kopfzeile —
     dieselbe Regel wie bei den Sprachgruppen der Hauptliste (siehe .flag in
     style.css: „die Gruppenüberschrift zeigt sie einmal").

     `offen` ist nur der Startzustand; geklappt wird danach ohne Neuzeichnen,
     damit weder Auswahl noch Scrollstand springen. */
  function langSection(code, anzahl, offen) {
    var info = langInfo(code);
    var sec = el('<section class="langsec' + (offen ? " open" : "") + '"></section>');
    var kopf = el('<button class="langsec__h" type="button" aria-expanded="' +
      (offen ? "true" : "false") + '">' +
      '<span class="langsec__t"><span class="flag">' + info.flag + "</span>" +
      esc(fill(T("lang.groupLabel", "{lang}sprachige Plattformen"),
               { lang: info.name })) +
      '<span class="langsec__n">' + anzahl + "</span></span>" +
      '<i class="fa-solid fa-chevron-down langsec__c"></i></button>');
    kopf.addEventListener("click", function () {
      var jetzt = !sec.classList.contains("open");
      sec.classList.toggle("open", jetzt);
      kopf.setAttribute("aria-expanded", jetzt ? "true" : "false");
    });
    var body = el('<div class="langsec__b"></div>');
    sec.appendChild(kopf); sec.appendChild(body);
    return { sec: sec, body: body };
  }

  // ---- Texte & Plattform-Stammdaten ------------------------------------------
  // Sämtliche Bildschirmtexte stehen in texts.js, die Marken-Daten der
  // Plattformen in platforms.js. Beide werden vor app.js geladen. Fehlt eine
  // der Dateien, läuft die App weiter – dann greifen die Rückfalltexte.
  /* ---- Sprachen (8.8.2026) ------------------------------------------------
     texts.js liefert seit heute nicht mehr EINEN Textbaum, sondern einen je
     Sprache: window.PM_TEXTS = { de: {…}, en: {…} }. Eine weitere Sprache ist
     damit ein weiterer Block dort plus ein Eintrag in SPRACHEN hier — am Code
     muss nichts angefasst werden.

     SPRACHEN ist bewusst die einzige Liste: Auswahl in den Einstellungen,
     Schritt im Einrichtungs-Assistenten und die Erkennung der Systemsprache
     lesen alle daraus. Zwei Listen wären zwei Gelegenheiten, sie
     auseinanderlaufen zu lassen.

     DE bleibt Rückfallebene: fehlt ein Schlüssel in einer Übersetzung,
     erscheint der deutsche Text statt einer leeren Fläche. Das ist beim
     schrittweisen Übersetzen der Normalfall, nicht die Ausnahme — rund 120
     Texte stehen noch hartkodiert im Code und werden erst nach und nach
     hierher gezogen. */
  var SPRACHEN = [
    { code: "de", name: "Deutsch",  flagge: "🇩🇪" },
    { code: "en", name: "English",  flagge: "🇬🇧" }
  ];
  var STANDARDSPRACHE = "de";

  function spracheUnterstuetzt(code) {
    for (var i = 0; i < SPRACHEN.length; i++)
      if (SPRACHEN[i].code === code) return true;
    return false;
  }

  /* Systemsprache ermitteln — Vorgabe beim ersten Start (Nutzerwunsch:
     „Default ist die Systemsprache (wenn auslesbar)").
     navigator.languages steht zuerst, weil es die vollständige Rangfolge des
     Nutzers enthält; navigator.language ist nur der erste Eintrag davon und
     fehlt in alten WebViews gelegentlich ganz. Aus "de-AT" wird "de" — die
     Region interessiert hier nicht, nur die Sprache.
     Findet sich nichts Unterstütztes, bleibt es bei Deutsch. Das ist der
     ehrliche Rückfall: die App ist auf Deutsch vollständig. */
  function systemSprache() {
    var kandidaten = [];
    try {
      if (navigator.languages && navigator.languages.length)
        kandidaten = kandidaten.concat(Array.prototype.slice.call(navigator.languages));
      if (navigator.language) kandidaten.push(navigator.language);
    } catch (e) { /* alte WebViews: dann eben die Standardsprache */ }
    for (var i = 0; i < kandidaten.length; i++) {
      var kurz = String(kandidaten[i] || "").toLowerCase().split("-")[0];
      if (spracheUnterstuetzt(kurz)) return kurz;
    }
    return STANDARDSPRACHE;
  }

  var ALLE_TEXTE = window.PM_TEXTS || {};
  /* Aktueller Textbaum. Wird von setzeSprache() ausgetauscht; alle T()-Aufrufe
     lesen danach automatisch die neue Sprache, ohne dass sie es merken. */
  var TX = ALLE_TEXTE[STANDARDSPRACHE] || ALLE_TEXTE || {};
  var TX_FALLBACK = ALLE_TEXTE[STANDARDSPRACHE] || {};
  /* Die gewählte Sprache als Code. Wird gebraucht, wo nicht T() nachschlägt,
     sondern ein ganzer Datenblock ausgewählt wird — die Stammdaten der
     Plattformen (PLATS_LANG weiter unten). */
  var SPRACHE = STANDARDSPRACHE;

  function setzeSprache(code) {
    if (!spracheUnterstuetzt(code)) code = STANDARDSPRACHE;
    TX = ALLE_TEXTE[code] || TX_FALLBACK;
    SPRACHE = code;
    try { document.documentElement.setAttribute("lang", code); } catch (e) {}
    // Die Plattformnamen stehen im Manifest und nicht in texts.js; sie werden
    // deshalb hier nachgezogen. Beim ersten Aufruf gibt es noch kein Manifest
    // – dann tut die Funktion nichts und der Aufruf nach dem Laden erledigt es.
    manifestNamenSetzen();
    return code;
  }
  var PLATS = window.PM_PLATFORMS || {};
  /* ---- Stammdaten der Plattformen je Sprache (8.8.2026) -------------------
     platforms.js liefert den deutschen Baum (PM_PLATFORMS) und daneben einen
     absichtlich lückenhaften Übersetzungsbaum (PM_PLATFORMS_EN) — dort steht
     nur, was auf Englisch wirklich anders lautet. Begründung für diesen
     Aufbau steht ausführlich im Kopf des Blocks in platforms.js.
     Eine weitere Sprache ist hier EINE Zeile und dort ein Block. */
  var PLATS_LANG = { en: window.PM_PLATFORMS_EN || {} };

  // T("wizard.lang.title", "Rückfalltext") – holt einen Text über seinen Pfad.
  /* Einen Pfad wie "liste.heroTitle" in einem Textbaum nachschlagen. */
  function ausBaum(baum, path) {
    var cur = baum, parts = String(path).split("."), i;
    for (i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return null;
      cur = cur[parts[i]];
    }
    return (cur == null || cur === "") ? null : cur;
  }
  /* ⚠️ DREISTUFIGER RÜCKFALL (8.8.2026, mit den Sprachen dazugekommen):
     gewählte Sprache → Deutsch → der im Aufruf mitgegebene Ersatztext.
     Die mittlere Stufe ist die wichtige: Solange eine Übersetzung
     unvollständig ist, erscheint der deutsche Satz statt einer leeren
     Fläche. Ohne sie hätte jede noch nicht übersetzte Zeile ein Loch in die
     Oberfläche gerissen — und beim schrittweisen Übersetzen ist das der
     Normalfall, nicht der Ausnahmefall. */
  function T(path, fallback) {
    var wert = ausBaum(TX, path);
    if (wert != null) return wert;
    wert = ausBaum(TX_FALLBACK, path);
    if (wert != null) return wert;
    return fallback || "";
  }
  // Platzhalter der Form {n} ersetzen: fill("Schritt {n}", {n: 2}).
  function fill(str, vals) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : m;
    });
  }

  /* ---- Sprachfassung einer PETITION (8.8.2026) ----------------------------
     T() übersetzt die Oberfläche, txt() den Inhalt. Beide fallen gleich
     zurück: gewählte Sprache → Deutsch → nichts. Die flachen Felder eines
     Datensatzes (title, summary, …) sind immer die Hauptsprache; steht daneben
     ein Block r.i18n[code], hat der Vorrang.

     Der Aufbau ist bewusst additiv: älterer Datenbestand hat kein "i18n" und
     verhält sich unverändert, eine dritte Sprache ist ein weiterer Schlüssel.
     Und weil die flachen Felder stehen bleiben, mussten die rund 40 Stellen,
     die .title lesen, NICHT alle angefasst werden — nur die, die wirklich
     etwas anzeigen.

     ⚠️ Nicht alles ist übersetzbar: "category" bleibt einsprachig, weil danach
     per Zeichenkettenvergleich gefiltert wird (state.catFilter) und ein
     übersetzter Wert den Filter ins Leere laufen ließe. */
  function txt(r, feld) {
    if (!r) return "";
    var blk = r.i18n && r.i18n[SPRACHE];
    var wert = blk && blk[feld];
    if (wert != null && wert !== "") return wert;
    return r[feld];
  }

  /* Gibt es zu diesem Datensatz eine Fassung in der gewählten Sprache, und
     wenn nein: wissen wir überhaupt, dass es keine gibt?

     ⚠️ Der Unterschied ist der Kern des Abzeichens weiter unten. "fehlt" heißt,
     der Scraper hat die Sprachfassung abgerufen und sie gibt es nachweislich
     nicht. "ungeklärt" heißt, der Abruf ist gescheitert — geblockt, gestört,
     nie versucht. Ein leeres Feld allein beweist GAR NICHTS: bei WeMove
     stammen die leeren Titel nachweislich vom Bot-Checkpoint, während die
     deutsche Seite einen guten Titel trägt. Würde die App daraus "liegt nicht
     vor" machen, behauptete sie etwas Falsches. */
  /* Titel und Kurzbeschreibung in ALLEN vorhandenen Sprachen, für die Suche.
     Gesucht wird bewusst sprachübergreifend: wer die App auf Englisch benutzt,
     kennt eine Petition womöglich unter ihrem deutschen Namen — und umgekehrt.
     Ein Treffer, den man nur in der gerade nicht gewählten Sprache fände, wäre
     für den Suchenden schlicht nicht vorhanden. */
  function sucheText(r) {
    var s = (r.title || "") + " " + (r.summary || "");
    var i18n = r.i18n;
    if (i18n) for (var code in i18n) {
      if (!Object.prototype.hasOwnProperty.call(i18n, code)) continue;
      s += " " + (i18n[code].title || "") + " " + (i18n[code].summary || "");
    }
    return s;
  }

  function sprachStand(r) {
    if (!r || SPRACHE === STANDARDSPRACHE) return "haupt";
    if (r.i18n && r.i18n[SPRACHE]) return "vorhanden";
    var st = r.i18n_state && r.i18n_state[SPRACHE];
    return st === "fehlt" ? "fehlt" : "ungeklärt";
  }
  /* ---- Sprachzwillinge erben die Marke (29.8.2026) ------------------------
     Seit 1b7cf8c liefert der Sammellauf je Quelle einen Eintrag PRO SPRACHE:
     neben "changeorg" auch "changeorg_en". platforms.js führt aber weiterhin
     nur die elf Grundschlüssel — und das soll so bleiben, denn Logo,
     Hausfarben, Gründungsjahr und Wikipedia-Artikel gelten für beide
     Einträge: es ist dieselbe Organisation, nur die Sprachhälfte ihres
     Bestandes. Ohne diese Auflösung lief platInfo() für die sechs
     _en-Einträge ins leere Objekt; sie standen als nackter Anfangsbuchstabe
     ("3", "A", "C", "E", "F", "W") und OHNE Markenfarbe in der Liste. Nur
     "European Parliament" sah richtig aus — das ist ein Grundschlüssel.

     ⚠️ Abgeschnitten wird nur, wenn der Rest WIRKLICH eine bekannte
     Plattform ist. Sonst würde ein künftiger Schlüssel mit Unterstrich still
     auf einen fremden Eintrag zeigen und die falsche Marke tragen — ein
     unbekannter Schlüssel behält lieber seine Initiale. Damit trägt die
     Regel auch für _fr/_es, ohne dass hier etwas nachzupflegen wäre. */
  function basisKey(key) {
    var k = String(key || "");
    if (PLATS[k]) return k;
    var i = k.lastIndexOf("_");
    var basis = i > 0 ? k.slice(0, i) : "";
    return PLATS[basis] ? basis : k;
  }
  function platInfo(key) { return PLATS[basisKey(key)] || {}; }

  /* ---- Plattform-Stammdaten in der gewählten Sprache ----------------------
     platInfo() bleibt die Quelle für alles Sprachlose (Farben, Logodatei,
     Seitenverhältnis, Wikipedia-Adresse). Für die TEXTE gehen alle Aufrufer
     über platAbout()/platTagline() — sie legen die Übersetzung ÜBER die
     deutschen Werte, statt sie zu ersetzen. Deshalb ist der englische Block
     lückenhaft gepflegt: was dort fehlt (Eigennamen, "San Francisco, USA",
     ein nicht vorhandenes financing), bleibt automatisch deutsch stehen,
     und eine fehlende platforms.js-Sprachebene fällt gar nicht auf. */
  function uebersetzung(key) {
    var paket = PLATS_LANG[SPRACHE];
    return paket ? paket[key] : null;
  }
  /* Wikipedia-Adresse in der gewaehlten Sprache. Eigene Funktion, weil das
     Feld auf der OBERSTEN Ebene der Plattform liegt und nicht in `about` -
     platAbout() ueberlagert nur das about-Unterobjekt und wuerde es nie
     sehen. Fehlt eine englische Fassung (OpenPetition, Bundestag haben
     keinen englischen Artikel), bleibt die deutsche Adresse: ein deutscher
     Artikel ist besser als gar keiner. */
  function platWiki(key) {
    var paket = PLATS_LANG[SPRACHE];
    var ueb = paket && paket[key] && paket[key].wikipedia;
    return ueb || platInfo(key).wikipedia || "";
  }

  function platAbout(key) {
    var basis = platInfo(key).about || {};
    var paket = PLATS_LANG[SPRACHE];
    if (!paket) return basis;                      // Deutsch: nichts zu tun
    var ueb = (paket[key] && paket[key].about) || null;
    var woerter = paket._linkLabels || null;
    if (!ueb && !woerter) return basis;
    var out = {}, k, hat = Object.prototype.hasOwnProperty;
    for (k in basis) if (hat.call(basis, k)) out[k] = basis[k];
    /* Leere Felder überschreiben nichts: ein "" in der Übersetzung wäre
       sonst schlechter als der deutsche Satz, den es verdrängt. */
    if (ueb) for (k in ueb)
      if (hat.call(ueb, k) && ueb[k] != null && ueb[k] !== "") out[k] = ueb[k];
    /* Linkbeschriftungen kommen aus dem gemeinsamen Wörterbuch, nachgeschlagen
       über die deutsche Beschriftung. Die Adresse bleibt unangetastet — auch
       weil rechtePlattformen() die Datenschutz-Zeile daran erkennt. */
    if (woerter && basis.links) out.links = basis.links.map(function (l) {
      var t = l && woerter[l.label];
      return t ? { label: t, url: l.url } : l;
    });
    return out;
  }
  function platTagline(key) {
    var ueb = uebersetzung(key);
    return (ueb && ueb.tagline) || platInfo(key).tagline;
  }
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
  /* Über basisKey(): der Bogen wird aus PLATS gebaut, trägt also nur die elf
     Grundschlüssel. "changeorg_en" muss auf dasselbe <symbol> zeigen, sonst
     zeigt <use> ins Leere — sichtbar als leeres Kästchen statt der Marke. */
  function logoSymbolId(key) {
    return "pl-" + basisKey(key).replace(/[^A-Za-z0-9_-]/g, "");
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
    var ar = LOGO_AR[basisKey(key)] || info.logoAR || 4;
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
    var marke = LOGO_READY[basisKey(key)]
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
      /* Oberflächensprache. Vorgabe ist die SYSTEMSPRACHE, sofern sie
         auslesbar und unterstützt ist (Nutzerwunsch 8.8.2026) — siehe
         systemSprache(). Deshalb ein Funktionsaufruf und kein fester Wert:
         defaultPrefs() läuft beim ersten Start, und genau dann soll das
         Gerät entscheiden. Sobald jemand die Sprache in den Einstellungen
         oder im Assistenten wählt, steht sie hier fest und das System
         redet nicht mehr hinein. */
      lang: systemSprache(),      // "de" | "en" (siehe SPRACHEN)
      theme: "auto",              // "light" | "dark" | "auto"
      /* ⚠️ 4.9.2026 von "relief" auf "magazin" (Nutzerwunsch „Standardansicht
         soll magazin layout sein"). Betrifft NUR Neuinstallationen —
         defaultPrefs() läuft beim ersten Start; wer schon einmal gewählt hat,
         behält seine Einstellung.
         ⚠️ Die beiden Wanderungen unten (band/klassisch → relief) bleiben
         bewusst auf „relief": das sind ABGESCHAFFTE Layouts, deren Nutzer
         damals dem Relief am nächsten standen. Sie auf magazin umzubiegen
         hieße, eine getroffene Wahl nachträglich zu überschreiben. */
      layout: "magazin",          // "relief" | "magazin" (layouts.css)
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
      /* Plattformen-Ausklapper auf oder zu. Liegt in den prefs und nicht
         mehr im state: nur so überlebt der Zustand den App-Start. Ein
         Ansichtswechsel überstand er schon vorher (state bleibt im
         Speicher), ein Neustart nicht. */
      settingsOpen: true,
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
          /* Gespeicherte Sprache nur übernehmen, wenn sie noch unterstützt
             wird. Sonst bliebe ein Wert stehen, zu dem es keinen Textbaum
             gibt — dieselbe Vorsicht wie bei layout und accent weiter
             unten. Ohne Eintrag greift die Vorgabe aus defaultPrefs(), also
             die Systemsprache; wer schon einmal gewählt hat, behält seine
             Wahl auch dann, wenn das Gerät auf eine andere Sprache
             umgestellt wird. */
          if (o.lang && spracheUnterstuetzt(o.lang)) p.lang = o.lang;
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
          if (typeof o.settingsOpen === "boolean") p.settingsOpen = o.settingsOpen;
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
    /* Sprache zuerst: sie tauscht den Textbaum aus, den alle folgenden
       T()-Aufrufe lesen. applyLayout() läuft ohnehin nach jeder Änderung an
       den Einstellungen und nach loadPrefs() — damit ist genau EIN Ort dafür
       zuständig, dass Gespeichertes und Angezeigtes zusammenpassen. Der
       Funktionsname sagt „Layout", die Funktion setzt aber schon länger auch
       Akzent und Schriftfarbe; die Sprache reiht sich dort ein. */
    setzeSprache((state.prefs && state.prefs.lang) || STANDARDSPRACHE);
    var l = (state.prefs && state.prefs.layout) || "relief";
    document.documentElement.setAttribute("data-layout", l);
    /* Akzentfarbe hängt am selben Schalter: layouts.css kennt die Paletten
       nur unter [data-layout="magazin"], in Relief ist das Attribut
       wirkungslos — deshalb kein eigenes applyAccent. */
    document.documentElement.setAttribute("data-accent",
      (state.prefs && state.prefs.accent) || "koralle");
    document.documentElement.setAttribute("data-accent-ink",
      (state.prefs && state.prefs.accentInk) || "auto");
    setzeRahmenTexte();
  }

  /* ---- Texte des Bedienrahmens (8.8.2026) --------------------------------
     Kopfleiste, Fußleiste, Offline-Band und Nach-oben-Knopf stehen als festes
     Markup in index.html. Die Datei wird geladen, bevor es texts.js oder
     app.js gibt, und kann T() deshalb nicht aufrufen — die deutschen Worte
     bleiben dort als Rückfall stehen (fällt app.js aus, ist die Bedienung
     trotzdem beschriftet) und werden hier überschrieben.

     WARUM AUS applyLayout() HERAUS und nicht aus boot(): applyLayout() ist
     schon die Stelle, an der setzeSprache() den Textbaum austauscht. Von dort
     gerufen greift es beim Start UND nach jedem Sprachwechsel, ohne dass
     jemand daran denken muss. Aus render() heraus ginge es nicht — diese vier
     Elemente liegen außerhalb von #content und überleben jedes Zeichnen; sie
     würden also nie neu beschriftet.

     Die Reiter „Einstellungen" und „Profil" lesen aus nav.settings/
     nav.profile: dieselben Worte wie an den Überschriften, und so bleibt es
     auch. Nur „Liste" hat einen eigenen Schlüssel, weil nav.petitions
     „Petitionen" heißt. */
  function setzeRahmenTexte() {
    function txt(sel, wert) {
      var n = document.querySelector(sel);
      if (n) n.textContent = wert;
    }
    function attr(sel, name, wert) {
      var n = document.querySelector(sel);
      if (n) n.setAttribute(name, wert);
    }
    attr("#brandhome", "aria-label", T("shell.brandHome", "Zur Übersicht"));
    txt(".reportbtn__t", T("shell.reportBtn", "Fehler melden"));
    attr("#reportbug", "title",
         T("shell.reportTitle", "Fehler gefunden? Bitte melden!"));
    attr("#reportbug", "aria-label",
         T("shell.reportAria", "Fehler gefunden? Bitte melden"));
    txt(".offbar__t", T("shell.offline",
      "Kein Internet. Du siehst gespeicherte Daten – " +
      "Bilder und Aktualisierungen fehlen."));
    attr("#offbarx", "aria-label",
         T("shell.offlineClose", "Hinweis schließen"));
    attr("#to-top", "aria-label", T("shell.toTop", "Nach oben"));
    var reiter = { liste:         T("shell.tabList", "Liste"),
                   einstellungen: T("nav.settings", "Einstellungen"),
                   profil:        T("nav.profile", "Profil") };
    document.querySelectorAll(".tab").forEach(function (t) {
      var wort = reiter[t.dataset.tab];
      if (!wort) return;
      /* aria-label UND die sichtbare Beschriftung: sie tragen denselben Text,
         ein Screenreader läse sonst das deutsche Wort zum englischen Knopf. */
      t.setAttribute("aria-label", wort);
      var s = t.querySelector("span");
      if (s) s.textContent = wort;
    });
  }

  // ---- Hilfen ----------------------------------------------------------------
  function el(html) { var t = document.createElement("template");
    t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return (s == null ? "" : String(s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  /* Nur harmlose Schemata als Navigationsziel zulassen. Die Petitions-URL
     gehört beliebigen Dritten; esc() verhindert nur den Ausbruch aus dem
     Attribut, nicht ein href="javascript:…". Kontrollzeichen werden entfernt,
     sonst täuscht "java\tscript:" das Schema vor. Serverseitig filtert
     sanitize_fragment bereits; dies ist die zweite Verteidigungslinie. */
  function sichereUrl(u) {
    var s = (u == null ? "" : String(u)).replace(/[\t\n\r]/g, "").trim();
    return /^(https?:|mailto:)/i.test(s) ? s : "#";
  }
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
  /* Wann das Manifest zuletzt geholt wurde, in Millisekunden. 0 = noch nie.
     Steuert die Auffrischung bei Wiederaufnahme, siehe refreshIfStale(). */
  var manifestGeholt = 0;

  /* Bewusst getrennt vom Holen: refreshManifest() muss den neuen Stand erst
     VERGLEICHEN dürfen, bevor er den alten ersetzt. */
  function uebernehmeManifest(m) {
    state.manifest = m;
    manifestGeholt = Date.now();
    manifestNamenSetzen();  // Plattformnamen in die gewählte Sprache bringen
    pruneTextLibrary();   // erst jetzt möglich: braucht die Kennungen
    return m;
  }
  function loadManifest() {
    return fetchData("manifest.json").then(uebernehmeManifest);
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
        state.baseWhy = mEigen ? "settings.whyLiveUnreachable"
                               : "settings.whyNoConnection";
        return;
      }
      if (mEigen && manifestStamp(mEigen) > manifestStamp(mLive)) {
        state.baseAuto = "bundled";
        state.baseWhy = "settings.whyBundledNewer";
        return;
      }
      state.base = LIVE_BASE;
      state.baseAuto = "live";
      state.baseWhy = "settings.whyLive";
    });
  }

  /* ⚠️ state.baseWhy hält seit 12.8.2026 den SCHLÜSSEL, nicht den fertigen
     Text. Vorher stand dort das Ergebnis von T(...), und resolveBase() läuft
     genau einmal beim Start: nach einem Sprachwechsel blieb die Begründung in
     der alten Sprache stehen. Sichtbar wurde das erst, als „Über die App" sie
     anzeigte — der Datenquellen-Umschalter, der sie sonst zeigt, ist
     ausgeblendet (ZEIGE.datenquelle). Die Rückfalltexte stehen hier an einer
     Stelle, damit sie nicht an jeder Fundstelle abweichen können. */
  var BASE_WHY_FALLBACK = {
    "settings.whyLiveUnreachable": "Live-Daten nicht erreichbar",
    "settings.whyNoConnection":    "Keine Verbindung",
    "settings.whyBundledNewer":    "Mitgelieferte Daten sind neuer",
    "settings.whyLive":            "Tagesaktuell von GitHub Pages"
  };
  function baseWhyText() {
    if (!state.baseWhy) return "";
    return T(state.baseWhy, BASE_WHY_FALLBACK[state.baseWhy] || "");
  }
  /* Quelle gewechselt: alles Geladene verwerfen und neu auflösen. textChunks
     MUSS mit weg, sonst behält die App die Volltexte der alten Quelle — das
     war in der Prompt-Variante vorher ein stiller Fehler. Bewusst nicht boot():
     das hängt bei jedem Aufruf erneut Scroll- und matchMedia-Horcher an. */
  function reloadData() {
    state.dataCache = {}; state.manifest = null; textChunks = {};
    content.innerHTML = '<div class="empty">' +
      esc(T("msg.loading", "Lade Daten …")) + "</div>";
    return resolveBase().then(loadManifest).then(function () { render(); })
      .catch(function () {
        content.innerHTML = '<div class="empty">' +
          T("msg.loadError", "Daten konnten nicht geladen werden.<br>" +
            "Prüfe die <b>Datenquelle</b> in den Einstellungen.") + "</div>";
      });
  }

  /* ---- Datenstand auffrischen, wenn die App zurückkommt (29.8.2026) --------
     loadManifest() lief bis hierher NUR beim Kaltstart. Eine App, die im
     Hintergrund liegt statt neu zu starten — auf dem Telefon der Regelfall —
     behielt ihren Datenstand damit unbegrenzt: die Kacheln zeigten die Zahlen
     des letzten Kaltstarts, und countNew() meldete dessen Neuzugänge. So kam
     die Tagesmeldung auf „Heute nichts Neues", während im ausgelieferten
     Manifest 358 Neuzugänge standen. Vom Nutzer am 29.8.2026 daran bemerkt,
     dass er „manuell refreshen" musste.

     ⚠️ Ein NICHT neueres Manifest wird verworfen, samt Quelle. Ohne das wäre
     die Auffrischung ein Rückschritt: resolveBase() fällt ohne Netz auf das
     App-Paket zurück, und dessen Stand ist älter als der, der schon geladen
     war — die Zahlen sprängen beim Wiederaufnehmen auf den Bauzeitpunkt der
     App. Deshalb läuft uebernehmeManifest() erst NACH dem Vergleich: sonst
     hätte pruneTextLibrary() längst die Textpakete der Plattformen aus dem
     Cache geräumt, die im App-Paket noch fehlen.

     ⚠️ dataCache und textChunks müssen mit weg, sobald der Stand wechselt —
     sonst nennt die Kachel die neue Anzahl und die Liste darunter zeigt die
     alte. Denselben Grund nennt reloadData() für den Quellenwechsel. */
  var REFRESH_MIN_MS = 5 * 60 * 1000;   // höchstens alle fünf Minuten fragen
  var refreshLaeuft = false;

  function refreshManifest() {
    var altStamp = manifestStamp(state.manifest);
    var vorher = { base: state.base, auto: state.baseAuto, why: state.baseWhy };
    var zurueck = function () {
      state.base = vorher.base;
      state.baseAuto = vorher.auto;
      state.baseWhy = vorher.why;
      return false;
    };
    return resolveBase().then(function () {
      return fetchData("manifest.json");
    }).then(function (m) {
      // Auch ohne Änderung merken, sonst fragt jeder Tabwechsel erneut.
      manifestGeholt = Date.now();
      if (!(manifestStamp(m) > altStamp)) return zurueck();
      uebernehmeManifest(m);
      state.dataCache = {}; textChunks = {};
      return true;
    })["catch"](zurueck);
  }

  /* Drei Auslöser, weil keiner davon überall feuert: sichtbar geworden, aus
     dem bfcache zurück, Fenster wieder im Vordergrund. In der APK bekommt der
     WebView kein onPause/onResume gesetzt (MainActivity hat die Methoden gar
     nicht) — dort ist „focus" oft das einzige Signal. Mehrfaches Auslösen
     kostet nichts, refreshLaeuft und REFRESH_MIN_MS fangen es ab. */
  function refreshIfStale() {
    if (!state.manifest) return;          // der Erststart lädt noch selbst
    if (document.visibilityState === "hidden") return;
    if (refreshLaeuft) return;
    if (Date.now() - manifestGeholt < REFRESH_MIN_MS) return;
    // Den Assistenten nicht unter den Händen wegziehen.
    if (document.body.classList.contains("wizard-open")) return;
    refreshLaeuft = true;
    refreshManifest().then(function (geaendert) {
      refreshLaeuft = false;
      if (!geaendert) return;
      render();
      /* Die Tagesmeldung neu bewerten — sie hängt an genau den Zahlen, die
         sich gerade geändert haben. Zweimal meldet sie deswegen nicht: tick()
         steigt bei n.lastDate === today sofort wieder aus. */
      scheduleNotify();
    });
  }

  // ---- Rendering: Liste ------------------------------------------------------
  function renderListe() {
    titleEl.textContent = state.platform ? platformName(state.platform)
                                         : T("nav.petitions", "Petitionen");
    if (state.platform) return renderPlatformDetail(state.platform);

    var live = livePlatforms().filter(function (p) { return isEnabled(p.key); })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
    if (!live.length) {
      content.innerHTML = "";
      content.appendChild(el('<div class="empty">' +
        T("msg.noPlatforms", "Keine Plattform aktiviert.<br>" +
          "Wähle in den <b>Einstellungen</b> aus, welche du sehen möchtest.") +
        "</div>"));
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
      '<button class="mainsearch__btn" type="submit" aria-label="' +
      esc(T("msg.search", "Suchen")) + '">' +
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
            image_url: e.r.image_url, title: txt(e.r, "title"),
            chip: platformName(e.plat),
            /* Der Trend darf sich zeigen: „~N/Tag" nur, wenn er aus
               echten Werten gerechnet ist (Unterschriften UND Datum). */
            meta: (typeof e.r.signatures === "number")
              ? fill(T("platform.signatures", "{n} Unterschriften"),
                     { n: nf.format(e.r.signatures) }) +
                (e.r.start_date && e.score >= 1
                  ? " · " + fill(T("platform.perDay", "~{n}/Tag"),
                                 { n: nf.format(Math.round(e.score)) })
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
      /* ⚠️ Hier stand kurzzeitig eine Bento-Logik, die Karten mit langem Namen
         oder „+N neu"-Abzeichen über beide Spalten legte, damit neben ihnen
         keine halbleere Kachel steht. Vom Nutzer am 12.8.2026 verworfen
         („kein Bento, mache alle Kacheln gleich groß") — die Gleichheit
         besorgt jetzt grid-auto-rows:1fr in layouts.css, ganz ohne Sonderfälle
         beim Bauen. */
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
    if (favs.length) groupDefs.push({ key: "__fav",
      label: T("favorites.title", "Favoriten"), plats: favs });
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
      /* „Deutsch" + „sprachige Plattformen" — im Englischen dagegen
         „German-language platforms". Deshalb ein Platzhalter statt einer
         Verkettung: die Wortstellung ist nicht in jeder Sprache dieselbe. */
      groupDefs.push({ key: code,
                       label: fill(T("lang.groupLabel",
                                     "{lang}sprachige Plattformen"),
                                   { lang: langInfo(code).name }),
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
  /* Der Zustandsbericht der Scraper (29.8.2026). Bis dahin verlinkte die App
     ihn NIRGENDS — er lag veröffentlicht da und zeigte seine Warnungen
     („Host ausgelassen", „Entdeckung fand 0 Treffer") an niemanden. Genau
     deshalb fiel ein monatelang eingefrorener Bestand erst über „es kommen
     keine neuen Petitionen" auf.
     ⚠️ Bewusst die LIVE-Adresse und nicht das mitgelieferte dashboard.html:
     das im App-Paket stammt vom Bauzeitpunkt und zeigte einen Gesundheits-
     zustand von vor Monaten — bei einer Seite, deren ganzer Zweck „wie geht
     es den Quellen JETZT" ist, wäre das schlechter als kein Link. */
  var DASHBOARD_URL = LIVE_BASE.replace(/\/data$/, "/dashboard.html");
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
  /* Der Kodextext liegt seit 8.8.2026 in texts.js (legal.kodexHtml), damit er
     uebersetzbar ist. FUNKTION und nicht `var`: eine Variable auf Modulebene
     wird EINMAL beim Laden ausgewertet - nach einem Sprachwechsel stuende hier
     noch der alte Text, waehrend der Rest der Oberflaeche schon umgestellt
     waere. supportSection() baut seine Liste bei jedem Zeichnen neu, der
     Aufruf kostet also nichts.
     Seit dem 8.8.2026 abends gibt es ihn auch auf Englisch (woertlich
     uebertragen); wer den deutschen Wortlaut aendert, zieht die englische
     Fassung in texts.js im selben Zug nach. */
  function kodexHtml() { return T("legal.kodexHtml", ""); }

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

  /* Die Texte liegen in texts.js (legal.stand…), seit dem 8.8.2026 abends in
     beiden Sprachen. Es ist eine Auskunft über die Rechtslage: „ungeklärt"
     und "unresolved" müssen dasselbe sagen, sonst steht in einer Sprache eine
     andere Zusage als in der anderen.
     ⬜ OFFEN: {datum} kommt aus dmy() und ist damit auch auf Englisch die
     deutsche Schreibweise (08.08.2026). Fällt heute nicht auf, weil in
     RECHTE_STAND noch kein einziges Datum steht — sobald die erste Antwort
     eingetragen wird, gehört hier eine sprachabhängige Datumsform hin. */
  function rechteStandText(r) {
    if (!r || !r.asked)
      return T("legal.standUngeklaert", "ungeklärt – noch nicht angefragt");
    if (!r.answer)
      return fill(T("legal.standAngefragt",
                    "angefragt am {datum} – noch keine Antwort"),
                  { datum: dmy(r.asked) });
    var wort = { erlaubt: T("legal.standErlaubt", "Nutzung zugesagt"),
                 eingeschraenkt: T("legal.standEingeschraenkt",
                                   "eingeschränkt zugesagt"),
                 abgelehnt: T("legal.standAbgelehnt", "abgelehnt") };
    return fill(T("legal.standAm", "{wort} am {datum}"),
                { wort: wort[r.result] ||
                        T("legal.standAntwort", "Antwort erhalten"),
                  datum: dmy(r.answer) });
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
  /* `key` zeigt auf texts.js, `label` ist nur noch der Rückfall. Aufgelöst
     wird ERST in steckbriefHtml() — diese Liste ist ein `var` und würde die
     Sprache des Startzeitpunkts festhalten. */
  var STECKBRIEF = [
    { feld: "operator",  key: "platform.operatorLabel",  label: "Träger" },
    { feld: "seat",      key: "platform.seatLabel",      label: "Sitz" },
    { feld: "founded",   key: "platform.foundedLabel",   label: "Gegründet" },
    { feld: "financing", key: "platform.financingLabel", label: "Finanzierung" },
    { feld: "impressum", key: "platform.impressumLabel", label: "Impressum",
      alsLink: true },
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
    { feld: "agb", key: "platform.termsLabel", label: "Nutzungsbedingungen",
      alsLink: true }
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
      var lbl = T(z.key, z.label);
      var leer = wert === null || wert === undefined || wert === "";
      var inhalt, src = "";
      if (leer) {
        inhalt = '<span class="fact-leer" title="' +
          esc(T("platform.unknown", "nicht bekannt")) + '">–</span>';
      } else if (z.alsLink) {
        inhalt = '<a href="' + esc(String(wert)) + '" target="_blank" ' +
          'rel="noopener">' + esc(kurzUrl(wert)) +
          ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>';
      } else {
        inhalt = esc(String(wert));
        var q = quellen[z.feld] || about.quelle;
        if (q) src = ' <a class="fact-src" href="' + esc(q) +
          '" target="_blank" rel="noopener" title="' +
          esc(T("platform.sourceFor", "Quelle für diese Angabe")) +
          '" aria-label="' +
          esc(fill(T("platform.sourceForAria", "Quelle für {label}"),
                   { label: lbl })) + '">' +
          '<i class="fa-solid fa-arrow-up-right-from-square"></i></a>';
      }
      return "<dt>" + esc(lbl) + "</dt><dd>" + inhalt + src + "</dd>";
    }).join("") + "</dl>";
  }

  function rechtePlattformen() {
    var plats = (state.manifest && state.manifest.platforms)
      ? livePlatforms() : [];
    if (!plats.length) return "";
    return plats.map(function (p) {
      var about = platAbout(p.key);
      var unbekannt = T("legal.platUnbekannt", "nicht bekannt");
      var zeilen = [
        [T("legal.platBetreiber", "Betreiber"), about.operator || unbekannt],
        [T("legal.platSitz", "Sitz"), about.seat || unbekannt],
        [T("legal.platNutzungsrecht", "Nutzungsrecht"),
         rechteStandText(RECHTE_STAND[p.key])]
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
          'rel="noopener">' + esc(T("legal.impressumTitle", "Impressum")) +
          "</a>"
        : '<span class="legal__none">' +
          esc(T("legal.keinImpressum",
                "Kein Impressum – Betreiber außerhalb des deutschen " +
                "Rechtsraums")) + "</span>";
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

  /* Der Fließtext steht seit 8.8.2026 in texts.js (legal.rechteLead /
     legal.rechteNote), seit demselben Tag abends in beiden Sprachen.
     Zwei Texte statt einem, weil die Plattform-Tabelle dazwischensteht;
     jeder für sich bleibt ein zusammenhängender Absatz.
     Der Rückfall ist leer statt der ganze deutsche Text: derselbe Weg wie bei
     kodexHtml()/impressumHtml() — 1,5 KB Rechtstext ein zweites Mal im Code
     wären zwei Fassungen, die auseinanderlaufen können. */
  function rechteHtml() {
    return "" +
      T("legal.rechteLead", "") +
      '<div class="legal__tbl">' + rechtePlattformen() + "</div>" +
      /* „– wir nehmen sie heraus." ist auf Wunsch des Nutzers (6.8.2026)
         gestrichen: der Satz gab eine Zusage ab, bevor überhaupt jemand
         geprüft hat, worum es geht. Stattdessen der Weg dorthin — ein Knopf,
         der schreibt, statt eines Versprechens. */
      T("legal.rechteNote", "") +
      '<div class="legal__btns"><a class="support__btn" href="mailto:' +
      SUPPORT_MAIL + "?subject=" +
      encodeURIComponent("[PetitionsManager] " +
                         T("mail.rights", "Rechte an den Inhalten")) +
      '"><i class="fa-solid fa-envelope"></i> ' +
      esc(T("legal.kontaktBtn", "Kontakt aufnehmen")) + "</a></div>";
  }

  /* Wie kodexHtml(): Funktion statt `var`, damit ein Sprachwechsel greift.
     {mail}/{github} werden hier gefuellt - die Adressen stehen weiter oben
     genau einmal (SUPPORT_MAIL, GITHUB_URL) und bleiben damit auch bei
     weiteren Sprachen eine einzige Quelle. */
  function impressumHtml() {
    return fill(T("legal.impressumHtml", ""),
                { mail: SUPPORT_MAIL, github: GITHUB_URL });
  }

  // Rechtlicher Bereich: Impressum und Rechte an den Inhalten.
  function legalSection() {
    var sec = el('<section class="support support--legal">' +
      '<div class="support__title"><i class="fa-solid fa-scale-balanced">' +
      "</i> " + esc(T("legal.title", "Rechtliches")) + "</div>" +
      '<div class="support__acc"></div></section>');
    var acc = sec.querySelector(".support__acc");
    /* Beides steht in beiden Sprachen. Einzige Ausnahme im ganzen Abschnitt
       ist der INHALT des Impressums (legal.impressumHtml): Pflichtangabe mit
       echter Anschrift, die es nur einmal geben soll — dort greift der
       Rückfall auf Deutsch. */
    [["fa-address-card", T("legal.impressumTitle", "Impressum"),
      T("legal.impressumTeaser",
        "Wer diese App anbietet und wie er erreichbar ist."), impressumHtml()],
     ["fa-copyright", T("legal.rechteTitle", "Rechte an den Inhalten"),
      T("legal.rechteTeaser",
        "Wem die Petitionstexte und Bilder gehören und was mit den " +
        "Plattformen abgestimmt ist."), rechteHtml()]
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
      "</i> " + esc(T("support.title", "Unterstütze PetitionsManager")) +
      ".</div>" +
      /* support.intro stand seit jeher in texts.js, wurde aber NIE gezeichnet -
         beim Herausziehen der Texte am 8.8.2026 aufgefallen. Der Satz
         "PetitionsManager ist ein freies Projekt…" fehlte dadurch in der
         Oberflaeche, obwohl er gepflegt und sogar uebersetzt war. Jetzt steht
         er unter der Ueberschrift, wo er hingehoert. */
      '<p class="support__intro">' + esc(T("support.intro", "")) + "</p>" +
      '<div class="support__acc"></div></section>');
    var acc = sec.querySelector(".support__acc");

    /* Der Kodex steht bewusst ganz oben: er beantwortet die Frage, nach
       welchen Regeln überhaupt entschieden wird — wer eine Plattform
       vorschlägt, soll sie vorher gelesen haben, nicht hinterher. */
    /* Die vier unteren Einträge benutzen die support.*-Schlüssel, die in
       texts.js längst standen und bisher niemand las — nicht neue, doppelte.
       Der Kodex-Eintrag ist der einzige, der eigene Schlüssel brauchte. */
    var items = [];
    /* NUR IM BROWSER (8.8.2026, Nutzerwunsch): In der Web-Fassung erfaehrt
       sonst niemand, dass es die App auch zum Installieren gibt - und genau
       dort fehlen drei Dinge wirklich (vollstaendig offline, taegliche
       Erinnerung, Sicherung als Datei).
       Geprueft wird auf window.AndroidBackup, weil diese Bruecke in JEDER
       Android-Fassung angemeldet wird - anders als AndroidUpdate, das der
       Bauschalter mitUpdater fuer F-Droid weglaesst. Mit AndroidUpdate zu
       pruefen haette den Hinweis in der F-Droid-App wieder eingeblendet.
       Ganz oben, weil er nur den erreicht, der die App noch nicht hat. */
    if (!window.AndroidBackup) {
      items.push(["fa-mobile-screen",
        T("support.appTitle", "Die App zum Installieren"),
        T("support.appText", ""),
        T("support.appBtn", "Zur Android-App"),
        { url: GITHUB_URL + "/releases/latest" }]);
    }
    items = items.concat([
      ["fa-scale-balanced",
       T("support.kodexTitle", "Wen wir aufnehmen – unser Kodex"),
       T("support.kodexText",
         "Nach diesen Regeln entscheiden wir, welche Petitionsplattform in " +
         "die App kommt und welche nicht."),
       T("support.kodexBtn", "Verstoß melden"),
       { mailto: T("mail.kodexViolation", "Verstoß gegen den Kodex"),
         html: kodexHtml() }],
      ["fa-layer-group",
       T("support.missingPlatform.q", "Fehlt eine Plattform?"),
       T("support.missingPlatform.a",
         "Kennst du eine Petitionsplattform, die hier noch fehlt? Sag uns " +
         "Bescheid – wir prüfen die Aufnahme."),
       T("support.missingPlatform.btn", "Plattform vorschlagen"),
       { mailto: T("mail.platformSuggestion", "Plattform-Vorschlag") }],
      ["fa-file-circle-plus",
       T("support.missingPetition.q", "Fehlt eine Petition?"),
       T("support.missingPetition.a",
         "Eine wichtige Petition wird nicht angezeigt? Melde sie uns am " +
         "besten mit Link."),
       T("support.missingPetition.btn", "Petition melden"),
       { mailto: T("mail.missingPetition", "Fehlende Petition") }],
      ["fa-hands-helping",
       T("support.help.q", "Möchtest du helfen?"),
       T("support.help.a",
         "PetitionsManager ist ein freies Projekt. Hilf mit – mit Feedback, " +
         "Ideen, Übersetzungen oder finanzieller Unterstützung über " +
         "Liberapay."),
       T("support.help.btn", "Mithelfen"),
       { mailto: T("mail.wantToSupport", "Ich möchte unterstützen"),
         donate: true }],
      ["fa-share-nodes",
       T("support.share.q", "Möchtest du die App teilen?"),
       T("support.share.a",
         "Teile PetitionsManager mit anderen, die Petitionen mehrerer " +
         "Plattformen im Blick behalten wollen."),
       T("support.share.btn", "App teilen"),
       { share: true }]
    ]);

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
          '<i class="fa-solid fa-heart"></i> ' +
          esc(T("support.donate", "Finanziell unterstützen")) + "</a>"));
      }
      if (opt.share) {
        var sBtn = el('<button class="support__btn" type="button">' +
          '<i class="fa-solid fa-share-nodes"></i> ' + esc(it[3]) + "</button>");
        sBtn.addEventListener("click", function () { shareApp(sBtn); });
        btns.appendChild(sBtn);
      } else if (opt.url) {
        /* Externer Link statt mailto - bisher kannte der Bereich nur
           E-Mail-Knoepfe. Gebraucht fuer den Hinweis auf die Android-App. */
        btns.appendChild(el('<a class="support__btn" href="' + esc(opt.url) +
          '" target="_blank" rel="noopener">' +
          '<i class="fa-solid fa-android"></i> ' + esc(it[3]) + "</a>"));
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
      title: T("app.name", "PetitionsManager"),
      text: T("support.shareText",
              "Behalte Petitionen mehrerer Plattformen im Blick."),
      url: location.href
    };
    if (navigator.share) { navigator.share(data).catch(function () {}); return; }
    var done = function () {
      var old = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> ' +
        esc(T("support.linkCopied", "Link kopiert"));
      setTimeout(function () { btn.innerHTML = old; }, 2000);
    };
    var frage = T("support.copyPrompt", "Link kopieren:");
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(location.href).then(done, function () {
        window.prompt(frage, location.href);
      });
    else window.prompt(frage, location.href);
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
    /* ⚠️ Hinweis auf WEITERE Sprachen — behebt eine echte Irreführung.
       Gruppiert wird nach der HAUPTsprache, und seit alle elf Plattformen
       deutsch geführt sind, gibt es nur noch EINE Gruppe. Wer im Assistenten
       „Englisch" auswählt, bekommt sechs Plattformen unter der Überschrift
       „Deutschsprachige Plattformen" — sachlich richtig (deren Hauptsprache
       IST Deutsch), aber es erklärt nicht, warum gerade diese sechs da sind.
       Die zusätzliche Flagge auf der Kachel sagt es.
       Steht in platCard und nicht im Magazin-Zweig: platCard baut die Kachel
       für ALLE Layouts, der Zweig dort nur für eines. */
    var weitere = platLanguages(p).filter(function (c) {
      return c !== (p.language || "de"); });
    var mehrsprachig = weitere.length
      ? '<span class="plat__langs" title="' +
        esc(fill(T("liste.alsoIn", "Liegt auch auf {sprachen} vor"),
                 { sprachen: weitere.map(function (c) {
                     return langInfo(c).name; }).join(", ") })) + '">' +
        weitere.map(function (c) {
          return '<span class="flag">' + langInfo(c).flag + "</span>";
        }).join("") + "</span>"
      : "";
    var newN = p["new"] || 0;
    var newLabel = newN > 0
      ? '<span class="plat__new">' +
        esc(fill(T("liste.newBadge", "+{n} neu"), { n: nf.format(newN) })) +
        "</span>" : "";
    var brand = platColor(p.key);
    /* Die Kachel gibt KEINE eigene Schriftfarbe mehr vor: --on-brand kommt
       einheitlich aus layouts.css und ist überall Weiß (Nutzerentscheidung
       2026-07-28, „alle Schriften/Logos weiß").
       Vorher rechnete platInk() je Markenfarbe die kontraststärkere Seite aus.
       Das ist damit hinfällig — und es kostet etwas: auf drei hellen Marken
       hält Weiß nicht einmal die 3:1 für Großtext (foodwatch #f7a600 → 2,02,
       openPetition #29b0cc → 2,57, innn.it #fc691f → 2,92). Wer das zurück
       will, holt platInk aus der Versionsgeschichte (Commit ae4ab06). */
    var tagline = platTagline(p.key);
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
            esc(T("liste.petitionsUnit", "Petitionen")) + "</span>" +
            newLabel + mehrsprachig + '</span>' +
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

  /* ⚠️ Name und "Für Nerds"-Satz kommen aus dem MANIFEST, das der Scraper
     erzeugt — also serverseitig und einsprachig deutsch. In der englischen
     Oberfläche stand deshalb „Europäisches Parlament" mitten im englischen
     Satz, und die elf openness_note-Sätze blieben komplett deutsch. Sie
     gehören nicht in texts.js (das hält Beschriftungen der App), sondern zu
     den Stammdaten der Plattformen in platforms.js — dieselbe Sprachebene wie
     tagline und about, mit derselben Regel: was dort fehlt, bleibt deutsch. */
  /* Die Namen im geladenen Manifest EINMAL überlagern, statt an den rund acht
     Stellen einzeln nachzuschlagen, die `p.name` lesen (Kacheln, Steckbrief,
     Auswahllisten, Rechte-Tabelle). Der Originalwert wird in `_nameQuelle`
     festgehalten, damit ein Sprachwechsel nicht auf einer schon übersetzten
     Fassung aufsetzt und beim Zurückschalten der deutsche Name fehlte. */
  function manifestNamenSetzen() {
    var plats = (state.manifest && state.manifest.platforms) || [];
    plats.forEach(function (p) {
      if (p._nameQuelle == null) p._nameQuelle = p.name;
      var ueb = uebersetzung(p.key);
      p.name = (ueb && ueb.name) || p._nameQuelle;
    });
  }
  function platformName(key) {
    var p = state.manifest && state.manifest.platforms
      ? state.manifest.platforms.find(function (x) { return x.key === key; })
      : null;
    if (p) return p.name;
    var ueb = uebersetzung(key);
    return (ueb && ueb.name) || key;
  }
  /* Der Satz hinter dem Offenheits-Balken („Für Nerds"). */
  function platOpennessNote(key, ausManifest) {
    var ueb = uebersetzung(key);
    return (ueb && ueb.opennessNote) || ausManifest || "";
  }
  /* Der zweite Satz darunter: was die Plattform vorbildlich macht bzw. welche
     Sperre fallen müsste. Gleiche Mechanik wie oben — die Übersetzung liegt in
     platforms.js, der deutsche Satz kommt aus dem Manifest. Fehlt beides
     (ältere Datenstände, die das Feld noch nicht kennen), bleibt es leer und
     der Block entfällt ganz. */
  function platOpennessWunsch(key, ausManifest) {
    var ueb = uebersetzung(key);
    return (ueb && ueb.opennessWunsch) || ausManifest || "";
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
        lbl.textContent = T("tools.jumpMiss", "Nicht in der angezeigten Liste");
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
        var t = txt(arr[i], "title") || "";
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
    /* ⚠️ Im Magazin NICHT anfassen (Nutzerentscheidung 24.8.2026: das Bild
       soll beim Aufklappen unverändert bleiben). Dort bestimmt allein das
       aspect-ratio aus layouts.css die Höhe, geschlossen wie aufgeklappt.
       Ein Pixelwert von hier würde es überstimmen und war die halbe Ursache
       des gemeldeten Sprungs: gemessen sprang das Bild beim Aufklappen erst
       schlagartig 250 → 224 px (eine CSS-Regel, siehe layouts.css) und
       wanderte dann über 300 ms auf die 234 px, die diese Funktion aus dem
       NATÜRLICHEN Seitenverhältnis rechnete. Der Knopf darunter machte die
       Bewegung mit — erst 34 px hoch, dann zurück.
       Eine schon gesetzte Höhe wird geräumt, sonst bliebe sie beim Wechsel
       von Relief nach Magazin an einer offenen Karte hängen. */
    if (state.prefs && state.prefs.layout === "magazin") {
      if (img.style.height) img.style.height = "";
      return;
    }
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
    var rechtsLabel = isSigned(r.url)
      ? esc(T("petition.swipeUndo", "Zurücksetzen"))
      : esc(T("petition.swipeSign", "Unterschrieben"));
    var linksLabel = imArchiv
      ? esc(T("petition.swipeRestore", "Wiederherstellen"))
      : esc(T("petition.swipeArchive", "Archivieren"));
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
      ? '<span class="sig pet__date" title="' +
        esc(T("petition.startTitle", "Start der Petition")) + '">' +
        esc(fmtDate(r.start_date)) +
        ' <i class="fa-solid fa-calendar-day" aria-hidden="true"></i></span>' : "";
    var signedBadge = isSigned(r.url)
      ? '<span class="pet-signed"><i class="fa-solid fa-circle-check"></i> ' +
        esc(T("petition.signedInline", "unterschrieben")) + "</span>" : "";
    var closedBadge = isClosed(r)
      ? '<span class="pet-closed"><i class="fa-solid fa-flag-checkered"></i> ' +
        esc(r.deadline
              ? fill(T("petition.closedOn", "beendet {datum}"),
                     { datum: fmtDate(r.deadline) })
              : T("petition.closed", "beendet")) + "</span>"
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
      ? '<a class="pet__ext" href="' + esc(sichereUrl(r.url)) + '" target="_blank" ' +
        'rel="noopener" aria-label="' +
        esc(T("petition.openExternAria", "Petition extern öffnen")) + '">' +
        '<i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : "";
    /* Kategorie als Balken oben an der Kachel (klickbar → filtert).
       ⚠️ Angezeigt wird die ÜBERSETZUNG, gefiltert wird über den Rohwert
       r.category (siehe der Klick-Zuhörer weiter unten und state.catFilter).
       Beides auseinanderzuhalten ist der ganze Trick: der Rohwert bleibt die
       Kennung, die Übersetzung ist nur Beschriftung. Wo keine Übersetzung
       vorliegt — und das ist der Regelfall, etwa bei den 859 amtlichen
       Sachgebieten des Bundestags —, fällt txt() auf den deutschen Wert
       zurück. Die sind Eigennamen und sollen auch gar nicht übersetzt werden. */
    var catBar = r.category
      ? '<button class="pet__catbar" type="button">' +
        '<i class="fa-solid fa-tag"></i> ' + esc(txt(r, "category")) +
        "</button>" : "";
    var head = el('<div class="pet__head">' + thumb +
      '<div class="pet__main">' +
        '<div class="pet__title">' +
          esc(txt(r, "title") || T("petition.noTitle", "(ohne Titel)")) +
        "</div>" +
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
                 score: sc, same: sc >= 0.8,
                 uebersetzung: rel.rel === "translation", relLang: rel.lang });
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
  /* `lang` wählt die fremdsprachige Paketreihe <key>.<lang>.t<N>.json, deren
     Kennungen im Manifest unter "tvl" stehen. Ohne `lang` bleibt alles beim
     Alten — die deutschen Pakete behalten Namen UND Nummern, sonst müsste
     jedes Gerät seine ganze Bibliothek neu laden. */
  function chunkRev(key, n, lang) {
    var plats = (state.manifest && state.manifest.platforms) || [];
    var p = plats.find(function (x) { return x.key === key; });
    if (!p) return null;
    if (lang) return (p.tvl && p.tvl[lang] && p.tvl[lang][String(n)]) || null;
    return (p.tv && p.tv[String(n)]) || null;
  }
  function chunkFile(key, n, lang) {
    return key + (lang ? "." + lang : "") + ".t" + n + ".json";
  }
  function loadTextChunk(key, n, lang) {
    var id = key + "." + (lang || "") + "." + n;
    if (!textChunks[id]) {
      var rev = chunkRev(key, n, lang);
      textChunks[id] = fetchData(chunkFile(key, n, lang) +
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
      // Fremdsprachige Reihen genauso aufräumen. Ohne das läge nach jeder
      // Textänderung eine tote englische Fassung dauerhaft im Cache — der
      // Fehler, den "tv" für die deutschen Pakete längst behebt.
      var tvl = p.tvl || {};
      Object.keys(tvl).forEach(function (lg) {
        Object.keys(tvl[lg] || {}).forEach(function (n) {
          soll[p.key + "." + lg + ".t" + n + ".json"] = tvl[lg][n];
        });
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
        pre.push({ c: c, plat: grp.p, score: sc, same: sc >= 0.8,
                   uebersetzung: rel.rel === "translation",
                   relLang: rel.lang });
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
      esc(T("petition.similarTitle", "Gleiche / Ähnliche Petitionen")) +
      "</div>";
    if (!sim.length) {
      box.innerHTML = lbl + '<div class="count-note" style="margin:0">' +
        esc(T("petition.similarNone", "Keine ähnlichen Petitionen gefunden.")) +
        "</div>";
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

    /* Gleiche Petitionen bündeln (Nutzerwunsch 24.8.2026: „gleiche
       petitionen müssen gebündelt werden, ggf in einem weiteren ausklapper
       und mit anzahl badge rechts").

       Anlass: Avaaz führt dieselbe Kampagne unter mehreren Slugs. Am
       ausgelieferten Bestand gezählt: „Geheimes Abkommen TISA stoppen!"
       10×, „EU-Verbot für Privatjets" 9×, „EU: Durchgreifen für die
       Natur!" 6×. Untereinander gelistet füllten sie das sichtbare
       Kontingent von fünf Zeilen und verdrängten die echten Treffer.

       ⚠️ Gebündelt wird NUR innerhalb DERSELBEN Plattform. Dieselbe
       Petition auf einer anderen Plattform zu zeigen ist der Kernzweck
       dieser App — fielen die zusammen, verschwände genau die Auskunft,
       für die es den Abschnitt gibt.

       ⚠️ Ohne Titel wird NICHT gebündelt (Schlüssel fällt auf die Adresse
       zurück): sonst landeten alle titellosen Sätze einer Plattform in
       einem Bündel, das nichts gemeinsam hat. Der Plattformschlüssel steht
       dabei VOR der Fallunterscheidung, gilt also für beide Zweige — bis
       29.8.2026 fehlte er im Adress-Rückfall, womit zwei titellose Sätze
       verschiedener Plattformen mit gleicher Adresse entgegen der Regel oben
       zusammengefallen wären. Am echten Bestand folgenlos (78.763 Sätze
       geprüft: 0 ohne Titel, 0 Adresse unter mehreren Plattformen), weil
       relatedFromData leere Adressen schon vorher aussortiert — aber die
       Regel darf nicht davon abhängen, dass die Daten sie nicht verletzen.

       ⚠️ Die drei anderen großen Plattformen haben keinen einzigen Titel,
       der viermal oder öfter vorkommt (24.8. gemessen) — die Bündelung
       greift dort also praktisch nie und kostet dort nichts.

       ⚠️ Das Trennzeichen steht als ESCAPE-SEQUENZ im Quelltext, nie als
       echtes Byte. Bis 29.8.2026 lagen hier drei literale 0x00 in der Datei;
       app.js galt Werkzeugen damit als BINÄR, und der grep-Wrapper (ugrep -I)
       lieferte für die größte Datei des Projekts stumm null Treffer statt
       einer Fehlermeldung. 0x1F kann in keinem Plattformschlüssel vorkommen
       (alles Kleinbuchstaben-Bezeichner) — und trennzeichenfrei muss nur der
       LINKE Teil sein, damit die Zerlegung eindeutig bleibt. */
    var gruppen = [], gIndex = {};
    sim.forEach(function (s) {
      var t = (txt(s.c, "title") || "").toLowerCase().replace(/\s+/g, " ").trim();
      var key = s.plat.key + "\x1f" + (t || "url\x1f" + s.c.url);
      if (gIndex[key]) { gIndex[key].alle.push(s); return; }
      gIndex[key] = { kopf: s, alle: [s] };
      gruppen.push(gIndex[key]);
    });

    /* Eine einzelne Zeile. `kind` = steckt in einem Bündel: dort ist der
       Plattformname überflüssig (alle gleich) und die Unterschriftenzahl
       das Einzige, was die Sätze unterscheidet. */
    function simZeile(s, extra, kind) {
      var info = langInfo(s.relLang || s.plat.language || "de");
      var same = s.uebersetzung
        ? '<span class="sim-trans">' +
          esc(fill(T("petition.similarTranslation",
                     "Dieselbe Petition auf {sprache}"),
            { sprache: langInfo(s.relLang || "de").name || "" })) + "</span>"
        : (s.same && !kind ? '<span class="sim-same">' +
           esc(T("petition.similarSame", "gleich")) + "</span>" : "");
      /* In einem Bündel sind Titel UND Plattform bei allen gleich — beides
         noch einmal zu zeigen hätte das Problem nur eine Ebene tiefer
         wiederholt. Unterscheidbar sind die Sätze über die
         Unterschriftenzahl und, wenn die fehlt oder gleich ist, über den
         Slug: „offener_brief_an_merz_1_0" gegen „…_excl_germany" (am
         24.8.2026 an einem echten Bündel abgelesen). Deshalb beides. */
      var unten;
      if (kind) {
        var slug = decodeURIComponent(
          String(s.c.url || "").replace(/\/+$/, "").split("/").pop() || "");
        unten = '<span class="simrow__p">' +
          (s.c.signatures != null
            ? '<span class="sig"><b>' + nf.format(s.c.signatures) + "</b> " +
              '<i class="fa-solid fa-pen" aria-hidden="true"></i></span>' : "") +
          (slug ? '<span class="simrow__slug">' + esc(slug) + "</span>" : "") +
          "</span>";
      } else {
        unten = '<span class="simrow__p">' + esc(s.plat.name) +
          '<span class="flag">' + info.flag + "</span></span>";
      }
      return '<button class="simrow' + (extra || "") +
        '" type="button" data-key="' + esc(s.plat.key) +
        '" data-url="' + esc(s.c.url) + '"><span class="simrow__t">' +
        esc(txt(s.c, "title") || T("petition.noTitle", "(ohne Titel)")) + same +
        "</span>" + unten + "</button>";
    }

    box.innerHTML = lbl + gruppen.map(function (g, i) {
      var versteckt = i >= SIM_VORAB ? " simrow--rest" : "";
      if (g.alle.length < 2) return simZeile(g.kopf, versteckt, false);
      var s = g.kopf;
      var info = langInfo(s.relLang || s.plat.language || "de");
      /* Kopfzeile des Bündels: KEIN data-url — sie öffnet keine Petition,
         sondern klappt auf. Ein echter <button> mit aria-expanded, damit
         Tastatur und Sprachausgabe mitkommen. */
      return '<div class="simgrp' + versteckt + '">' +
        '<button class="simrow simrow--grp" type="button" aria-expanded="false">' +
          '<span class="simrow__t">' +
            esc(txt(s.c, "title") || T("petition.noTitle", "(ohne Titel)")) +
            (s.same ? '<span class="sim-same">' +
              esc(T("petition.similarSame", "gleich")) + "</span>" : "") +
          "</span>" +
          '<span class="simrow__p">' + esc(s.plat.name) +
            '<span class="flag">' + info.flag + "</span>" +
            '<span class="simcount">' + g.alle.length + "</span>" +
          "</span>" +
        "</button>" +
        '<div class="simgrp__kinder" hidden>' +
          g.alle.map(function (k) { return simZeile(k, " simrow--kind", true); }).join("") +
        "</div>" +
      "</div>";
    }).join("");

    box.querySelectorAll(".simrow--grp").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var kinder = btn.nextElementSibling;
        var auf = kinder.hasAttribute("hidden");
        /* hidden statt nur optisch verbergen: sonst blieben die Zeilen per
           Tabulator erreichbar, obwohl sie niemand sieht. */
        if (auf) { kinder.removeAttribute("hidden"); }
        else { kinder.setAttribute("hidden", ""); }
        btn.setAttribute("aria-expanded", auf ? "true" : "false");
        btn.classList.toggle("simrow--grp-auf", auf);
      });
    });

    /* ⚠️ Gezählt werden seit der Bündelung GRUPPEN, nicht Einzelsätze.
       Mit sim.length stünde hier „Mehr anzeigen (12)", während nur drei
       weitere Zeilen erscheinen — die restlichen neun stecken in Bündeln,
       die schon sichtbar sind. */
    if (gruppen.length > SIM_VORAB) {
      var mehr = el('<button class="simmore" type="button">' +
        esc(fill(T("petition.similarMore", "Mehr anzeigen ({n})"),
                 { n: gruppen.length - SIM_VORAB })) + "</button>");
      mehr.addEventListener("click", function (e) {
        e.stopPropagation();
        box.querySelectorAll(".simrow--rest").forEach(function (r) {
          r.classList.remove("simrow--rest");
        });
        mehr.remove();
      });
      box.appendChild(mehr);
    }
    /* ⚠️ Die Kopfzeile eines Bündels ausdrücklich AUSNEHMEN: sie trägt kein
       data-url und würde openPetitionInApp(undefined, undefined) aufrufen.
       Ihren eigenen Zuhörer hat sie oben schon. */
    box.querySelectorAll(".simrow:not(.simrow--grp)").forEach(function (btn) {
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

  /* Aus welcher Sprachreihe kommt der Volltext? Gibt den Sprachcode zurück,
     oder null für die deutsche Reihe. Es reicht nicht, auf SPRACHE zu sehen:
     eine Petition kann in der gewählten Sprache einen Titel haben, aber keinen
     Volltext — dann bleibt es beim deutschen Text. */
  function descSprache(r) {
    if (!r || SPRACHE === STANDARDSPRACHE) return null;
    var blk = r.i18n && r.i18n[SPRACHE];
    return blk && typeof blk.tc === "number" ? SPRACHE : null;
  }
  function descChunk(r, lang) {
    if (!r) return null;
    if (lang) return (r.i18n[lang] || {}).tc;
    return r.tc;
  }

  /* Das Abzeichen über dem aufgeklappten Text.

     📌 Wortlaut vom Nutzer entschieden (8.8.2026): "Englische Fassung", NICHT
     "Übersetzt aus dem Englischen". Wir übersetzen nichts — WeMove, Avaaz und
     das EU-Parlament veröffentlichen beide Fassungen selbst. Der Tooltip nennt
     deshalb die Plattform als Urheberin.

     ⚠️ Gezeigt wird es NUR bei sprachStand() === "fehlt", also wenn der
     Scraper nachgesehen hat und die Fassung nachweislich nicht existiert.
     Bei "ungeklärt" schweigt die App: dort wäre jeder Satz über das Fehlen
     eine Behauptung über etwas, das wir nicht gemessen haben. */
  function sprachHinweis(r, platKey) {
    if (sprachStand(r) !== "fehlt") return "";
    // Welche Sprache steht hier tatsächlich? Die des Datensatzes, nicht die
    // gewählte — und "lang" fehlt bei älteren Beständen, dann ist es Deutsch.
    var gezeigt = langInfo((r && r.lang) || STANDARDSPRACHE);
    var name = gezeigt.name || (r && r.lang) || STANDARDSPRACHE;
    var pname = platformName(platKey) || platKey;
    var hinweis = fill(T("petition.langFallbackHint",
      "In der gewählten Sprache liegt diese Petition bei {plattform} nicht " +
      "vor. Angezeigt wird der Text der Plattform auf {sprache}."),
      { plattform: pname, sprache: name });
    var label = fill(T("petition.langFallback", "Fassung auf {sprache}"),
      { sprache: name });
    return '<div class="pet__langbadge" title="' + esc(hinweis) +
      '" aria-label="' + esc(label + " – " + hinweis) + '">' +
      '<span class="flag" aria-hidden="true">' + (gezeigt.flag || "") +
      "</span> " + esc(label) +
      ' <i class="fa-solid fa-circle-info" aria-hidden="true"></i></div>';
  }

  function buildPetBody(body, r, ctx, platKey) {
    // Kein Bild mehr an dieser Stelle: hier stand früher ein ZWEITES <img> mit
    // derselben Adresse wie das Vorschaubild der Kachel – dasselbe Motiv zweimal
    // untereinander, und zweimal über das Netz geholt. Stattdessen wächst beim
    // Aufklappen das vorhandene Vorschaubild zum Aufmacher (style.css, .pet.open).
    var h = sprachHinweis(r, platKey);
    var kurz = txt(r, "summary");
    if (kurz) h += "<h4>" + esc(T("petition.summary", "Kurzbeschreibung")) +
      "</h4><p>" + esc(kurz) + "</p>";
    if (r.recipient) h += "<h4>" + esc(T("petition.recipient", "Adressat")) +
      "</h4><p>" + esc(r.recipient) + "</p>";
    if (r.started_by) h += "<h4>" +
      esc(T("petition.startedBy", "Gestartet von")) +
      "</h4><p>" + esc(r.started_by) + "</p>";
    // Beschreibung: entweder schon im Datensatz (alte Datenstände) oder als
    // Paketnummer "tc" hinterlegt – dann wird sie unten nachgeladen.
    // In einer Fremdsprache steht die Nummer im Sprachblock (i18n[…].tc);
    // fehlt dort eine, greift die deutsche Fassung.
    var descLang = descSprache(r);
    var descText = descLang ? (r.i18n[descLang] || {}).description_full
                            : r.description_full;
    var textPending = !descText && typeof descChunk(r, descLang) === "number";
    if (descText || textPending)
      h += '<details class="descacc"><summary>' +
        '<span class="descacc__lbl"><i class="fa-solid fa-align-left"></i> ' +
        esc(T("petition.description", "Beschreibung")) + "</span>" +
        '<i class="fa-solid fa-chevron-down descacc__chev"></i></summary>' +
        '<div class="pet__desc">' + (descHtml(descText) ||
          '<div class="count-note">' +
          esc(T("petition.textLoading", "Text wird geladen …")) + "</div>") +
        "</div></details>";
    // Schlagwörter (Tags) – aus dem Text abgeleitet; Klick verlinkt/filtert.
    if (Array.isArray(r.tags) && r.tags.length) {
      h += '<div class="pet__tags"><span class="pet__tags-lbl">' +
        '<i class="fa-solid fa-hashtag"></i> ' +
        esc(T("petition.tags", "Schlagwörter")) + "</span>" +
        '<div class="taglist">' +
        r.tags.slice(0, 10).map(function (t) {
          return '<button class="tag" type="button" data-tag="' + esc(t) +
            '">' + esc(t) + "</button>";
        }).join("") + "</div></div>";
    }
    var meta = [];
    if (r.start_date) meta.push(esc(fill(T("petition.metaStart", "Start: {datum}"),
      { datum: String(r.start_date).slice(0, 10) })));
    if (typeof r.signatures === "number")
      meta.push(nf.format(r.signatures) +
        ' <i class="fa-solid fa-pen"></i>');
    if (meta.length) h += '<div class="pet__meta">' + meta.join(" · ") + "</div>";
    if (r.url)
      h += '<a class="pet__extlink" href="' + esc(sichereUrl(r.url)) + '" target="_blank" ' +
        'rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> ' +
        esc(T("petition.openExtern", "Petition öffnen")) + "</a>";
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
      loadTextChunk(platKey, descChunk(r, descLang), descLang)
        .then(function (map) {
        // Auch das fremdsprachige Paket ist über die Adresse des Datensatzes
        // geschlüsselt (die deutsche) – siehe write_texts in publish.py.
        var html = map[r.url];
        if (html) {
          // Gemerkt wird je Sprache getrennt, sonst zeigte ein Sprachwechsel
          // den zuerst geladenen Text weiter an.
          if (descLang) r.i18n[descLang].description_full = html;
          else r.description_full = html;
          descBox.innerHTML = descHtml(html);   // gefiltert wird erst beim Anzeigen
          bilderBeobachten(descBox);            // Platzhalter räumen, sobald da
        } else {
          // Eigene Klasse: .count-note ist im Petitionstext der pulsierende
          // Ladehinweis – eine Meldung darf nicht blinken.
          descBox.innerHTML = '<div class="pet__desc-note">' +
            esc(T("petition.noText",
                  "Für diese Petition liegt kein ausführlicher Text vor.")) +
            "</div>";
        }
      }).catch(function () {
        descBox.innerHTML = '<div class="pet__desc-note">' +
          esc(T("petition.textError", "Der Text konnte nicht geladen werden. " +
                "Prüfe deine Verbindung.")) + "</div>";
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
        'fa-link"></i> ' +
        esc(T("petition.similarTitle", "Gleiche / Ähnliche Petitionen")) +
        "</div>" +
        '<div class="count-note" style="margin:0">' +
        esc(T("petition.similarSearching", "Suche über alle Plattformen …")) +
        "</div>";
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
    var about = platAbout(key);
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
      links.push({ label: T("platform.website", "Website"),
                   url: manifestEntry.source_url });
    // Wikipedia. Der Artikelname steht mit im Etikett, weil er nicht überall
    // gleich der Plattform heißt – Eko führt zu „SumOfUs" (Umbenennung), WeAct
    // zum Träger „Campact". Für innn.it und WeMove Europe gibt es keinen
    // deutschen Artikel; dort fehlt das Feld und damit der Link.
    /* ⚠️ Wikipedia-Adresse SPRACHABHAENGIG (8.8.2026). platInfo() liefert
       Farben und Logos sprachfrei - die Wikipedia-Adresse gehoert aber nicht
       dazu: sieben der neun Plattformen haben einen englischen Artikel, und
       wer die App auf Englisch nutzt, soll nicht auf de.wikipedia.org landen.
       Welche das sind, wurde ueber die langlinks-Schnittstelle von Wikipedia
       ermittelt, nicht geraten. Fuer OpenPetition und den Petitionsausschuss
       des Bundestages gibt es keinen englischen Artikel; dort fehlt das Feld
       im EN-Block, und `||` faellt auf die deutsche Adresse zurueck - ein
       deutscher Artikel ist besser als gar keiner.
       Der Artikelname steht mit im Etikett, weil er nicht ueberall gleich der
       Plattform heisst: Eko fuehrt im Deutschen zu "SumOfUs" (Umbenennung,
       englisch schon "Eko (organization)"), WeAct zum Traeger "Campact".
       Fuer innn.it und WeMove Europe gibt es gar keinen Artikel. */
    var wikiAdresse = platWiki(key);
    if (wikiAdresse) {
      var artikel = decodeURIComponent(wikiAdresse.split("/wiki/")[1] || "")
        .replace(/_/g, " ");
      links.push({ label: "Wikipedia: " + artikel, url: wikiAdresse });
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
    var offenheitSatz = platOpennessNote(key, manifestEntry.openness_note);
    if (offenheitSatz)
      nerdInhalt += '<div class="pabout__open ' +
        ampClass(manifestEntry.openness) + '">' +
        esc(offenheitSatz) + "</div>";
    /* Zweiter Block: bei Ampel 5 ein Lob, sonst die konkrete Sperre, die
       fallen müsste. Die Überschrift wechselt mit der Ampelstufe — „Was
       vorbildlich ist" über einer Mängelliste wäre Hohn, „Was helfen würde"
       über einer vorbildlichen Plattform eine Unterstellung. */
    var wunschSatz = platOpennessWunsch(key, manifestEntry.openness_wunsch);
    if (wunschSatz)
      nerdInhalt += '<div class="nerd__row"><b>' +
        esc(manifestEntry.openness >= 5
              ? T("platform.opennessGood", "Was vorbildlich ist")
              : T("platform.opennessWish", "Was helfen würde")) + "</b> " +
        esc(wunschSatz) + "</div>";
    if (manifestEntry.source_url)
      nerdInhalt += '<div class="nerd__row"><b>' +
        esc(T("platform.dataSource", "Quelle der Daten")) + "</b> " +
        '<a href="' + esc(sichereUrl(manifestEntry.source_url)) + '" target="_blank" ' +
        'rel="noopener">' + esc(manifestEntry.source_url) + "</a></div>";
    nerdInhalt += '<div class="nerd__row"><b>' +
      esc(T("platform.appSource", "Quellcode dieser App")) + "</b> " +
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
      '<span><i class="fa-solid fa-flask"></i> ' +
      esc(T("platform.nerds", "Für Nerds")) + "</span>" +
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
        esc(T("nav.allPlatforms", "Alle Plattformen")) + "</button>" +
      '<span class="subhead__r">' +
        '<button class="favbtn favbtn--head' + (isFav(key) ? " on" : "") +
          '" type="button"><i class="' + (isFav(key) ? "fa-solid" : "fa-regular") +
          ' fa-star"></i></button>' +
        '<a class="archlink" href="#"><i class="fa-solid fa-box-archive"></i> ' +
          esc(T("nav.toArchive", "Zum Archiv")) + "</a></span></div>");
    head.querySelector(".backbtn").addEventListener("click", function () {
      state.platform = null;
      state.catFilter = null; state.tagFilter = null;
      state.sort = null; state.gapFilter = null; render();
    });
    var favBtn = head.querySelector(".favbtn");
    favBtn.setAttribute("aria-pressed", isFav(key) ? "true" : "false");
    favBtn.setAttribute("aria-label",
      T("platform.favAria", "Plattform als Favorit merken"));
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
              ? fill(T("platform.signatures", "{n} Unterschriften"),
                     { n: nf.format(r.signatures) }) : "",
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
        "<p>" + T("petition.swipeHintHtml",
          "Wische eine Petition nach <b>rechts</b>, um sie als " +
          "„unterschrieben\" zu markieren. <span class=\"hint-note\">" +
          "<b>Wichtig:</b> Sie wird dadurch <u>nicht</u> automatisch " +
          "unterschrieben – das musst du selbst auf der jeweiligen Plattform " +
          "tun.</span> Nach <b>links</b> wischen archiviert die Petition.") +
        "</p>" +
        '<button class="hint-dismiss" type="button">' +
        '<i class="fa-solid fa-check"></i> ' +
        esc(T("petition.hintDismiss",
              "Verstanden, zukünftig nicht mehr anzeigen")) +
        "</button></div>");
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
    var searchBox = el('<input class="search" type="search" placeholder="' +
      esc(T("tools.searchPlatform", "In dieser Plattform suchen …")) +
      '" value="' + esc(state.search) + '">');
    searchForm.appendChild(searchBox);
    searchForm.appendChild(el('<button class="searchrow__btn" type="submit" ' +
      'aria-label="' + esc(T("msg.search", "Suchen")) +
      '"><i class="fa-solid fa-magnifying-glass" ' +
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
        esc(T("tools.title", "Sortieren und filtern")) + "</span>" +
        '<span class="ptools__state"></span>' +
        '<i class="fa-solid fa-chevron-down ptools__chev"></i></summary>' +
      '<div class="ptools__body"></div></details>');
    content.appendChild(tools);
    var toolsBuilt = false;

    /* ---- Abkürzung zu den Neuzugängen (Nutzerwunsch 29.8.2026) ------------
       Ein Knopf, der die Sortierung auf „Datum, neueste zuerst" stellt —
       dieselbe Wirkung wie der Chip im Ausklapper, nur ohne ihn aufklappen
       zu müssen.

       ⚠️ Bewusst NICHT als „zeigt dir die N neuen" beschriftet: `new` zählt,
       was der letzte Lauf ENTDECKT hat, sortiert wird aber nach start_date.
       Ein Nachtrag (--backfill beim Bundestag) bringt alte Petitionen neu
       herein, die danach weit unten stehen. Der Knopf nennt die Zahl deshalb
       als ANLASS und die Sortierung als WIRKUNG, getrennt durch den
       Mittelpunkt — er verspricht keine Auswahl, die er nicht trifft.

       ⚠️⚠️ Bedingung ist die FRISCHE der Startdaten, nicht ihre Menge. Am
       29.8.2026 an den ausgelieferten Daten gemessen:

         changeorg_en  298 neu  100 %   jüngstes 2026-08-27   trägt
         changeorg       8 neu  100 %   jüngstes 2026-08-29   trägt
         innnit          2 neu  100 %   jüngstes 2026-08-29   trägt
         openpetition   12 neu   57 %   jüngstes 2026-05-01   trägt NICHT
         weact           3 neu  0,1 %   jüngstes 2026-05-10   trägt NICHT

       Die naheliegende Regel „die Mehrheit muss ein Datum haben" stand hier
       zuerst und war falsch: sie fängt WeAct (0,1 %), lässt aber
       openPetition durch — dessen Startdaten enden vier Monate vor dem
       Scrape-Zeitpunkt. In beiden Fällen hängt sortRows() die undatierten
       Sätze ans ENDE. Der Knopf schöbe die Neuzugänge dort also nach unten
       statt nach oben und täte das Gegenteil seiner Beschriftung.

       Die Chips im Ausklapper dürfen die Sortierung trotzdem anbieten — sie
       stehen neben der Lückenmeldung („Bei 1905 Petitionen fehlt das
       Startdatum"). Ein herausgestellter Knopf ohne diesen Beipackzettel
       darf es nicht.

       ⚠️ Verglichen wird auf TAGESEBENE (die ersten zehn Zeichen). Die
       Zeitstempel tragen gemischte Zonen (+02:00 im Bestand, +00:00 aus der
       CI); als ganze Zeichenketten verglichen käme die falsche Reihenfolge
       heraus. Gegen ein 14-Tage-Fenster ist ein Zonenversatz von höchstens
       einem Tag ohne Belang.
       ⚠️ Bezugspunkt ist generated_at DIESER Plattform, nicht die Uhr des
       Geräts: sonst verlöre ein lange offline genutztes Gerät den Knopf,
       obwohl seine Daten in sich stimmig sind.
       Die Entscheidung fällt erst in buildTools(), wo die Daten vorliegen. */
    var pMeta = ((state.manifest && state.manifest.platforms) || [])
      .filter(function (p) { return p.key === key; })[0] || {};
    var neuN = pMeta["new"] || 0;
    var neuBtn = null;
    if (neuN > 0) {
      neuBtn = el('<button class="newsort" type="button" hidden aria-label="' +
        esc(T("tools.newSortAria",
              "Nach Startdatum sortieren, neueste zuerst")) + '">' +
        '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i> ' +
        esc(fill(T(neuN === 1 ? "tools.newSortOne" : "tools.newSortMany",
                   neuN === 1 ? "1 neue Petition · neueste zuerst"
                              : "{n} neue Petitionen · neueste zuerst"),
                 { n: nf.format(neuN) })) + "</button>");
      content.appendChild(neuBtn);
    }
    // Filter (Kategorie/Schlagwort) liegen im State, damit sie eine plattform-
    // übergreifende Suche + Zurück-Navigation überstehen.
    var filterBar = el('<div class="filterbar" style="display:none"></div>');
    content.appendChild(filterBar);
    var note = el('<div class="count-note">' +
      esc(T("msg.loadingShort", "Lade …")) + "</div>");
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
      /* Der Neuzugangs-Knopf lebt außerhalb dieses Ausklappers. Seine
         Bedingung ist strenger als die der Datums-Chips (siehe oben): die
         Startdaten müssen AKTUELL sein, sonst verspricht er eine Ordnung,
         die die Daten nicht hergeben. buildTools() läuft genau einmal. */
      var neuestesDatum = "";
      arr.forEach(function (r) {
        var d = r.start_date ? String(r.start_date).slice(0, 10) : "";
        if (d > neuestesDatum) neuestesDatum = d;
      });
      var bezug = Date.parse(pMeta.generated_at || "") || Date.now();
      var frischGrenze = new Date(bezug - 14 * 864e5).toISOString().slice(0, 10);
      if (neuBtn) {
        if (neuestesDatum && neuestesDatum >= frischGrenze) {
          neuBtn.hidden = false;
          neuBtn.addEventListener("click", function () {
            state.sort = "neu";
            draw(arr); window.scrollTo(0, 0);
          });
        } else neuBtn.remove();
      }
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
      var opts = [["", T("tools.sortDefault", "Standard"), "", ""]];
      if (mitDatum) opts.push(
        ["neu", T("tools.date", "Datum"), "fa-arrow-up",
         T("tools.newestFirst", "Neueste zuerst")],
        ["alt", T("tools.date", "Datum"), "fa-arrow-down",
         T("tools.oldestFirst", "Älteste zuerst")]);
      if (mitZahl) opts.push(
        ["viel", T("tools.signatures", "Unterschriften"), "fa-arrow-up",
         T("tools.mostFirst", "Meiste Unterschriften zuerst")],
        ["wenig", T("tools.signatures", "Unterschriften"), "fa-arrow-down",
         T("tools.fewestFirst", "Wenigste Unterschriften zuerst")]);
      var h = '<div class="ptools__grp"><span class="ptools__h">' +
        esc(T("tools.sortHeading", "Sortierung")) + "</span>" +
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
      /* Ein GANZER Satz je Sprache statt der früheren Verkettung aus fünf
         Stücken: „steht sie"/„stehen sie" mitten im Satz ist ein deutsches
         Problem, das andere Sprachen an anderer Stelle haben. */
      function fehlt(n, was, feld) {
        return { text: fill(T(n === 1 ? "tools.gapOne" : "tools.gapMany",
                              n === 1
                                ? "Bei {n} Petition fehlt {was} – beim " +
                                  "Sortieren steht sie am Ende."
                                : "Bei {n} Petitionen fehlt {was} – beim " +
                                  "Sortieren stehen sie am Ende."),
                            { n: nf.format(n), was: was }),
                 feld: feld, anzahl: n };
      }
      if (mitDatum && mitDatum < arr.length)
        luecken.push(fehlt(arr.length - mitDatum,
          T("tools.gapStartDate", "das Startdatum"), "start_date"));
      if (mitZahl && mitZahl < arr.length)
        luecken.push(fehlt(arr.length - mitZahl,
          T("tools.gapSignatures", "die Unterschriftenzahl"), "signatures"));
      if (!mitDatum)
        luecken.push({ text: T("tools.noStartDates",
          "Diese Plattform liefert keine Startdaten.") });
      if (!mitZahl)
        luecken.push({ text: T("tools.noCounts",
          "Diese Plattform liefert keine Unterschriftenzahlen.") });
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
                     esc(aktiv ? T("tools.showAll", "Alle zeigen")
                               : T("tools.showOnlyThese", "Nur diese zeigen")) +
                     "</button>"
                   : "") +
                 "</div>";
             }).join("") +
             '<button class="ptools__noteoff" type="button">' +
             esc(T("tools.notesOff", "Infos deaktivieren")) + "</button>" +
             "</div></div>";
      }
      h += "</div>";

      /* Kategorien dieser Plattform, häufigste zuerst.
         ⚠️ Gezählt und gefiltert wird über den ROHWERT (data-cat unten,
         state.catFilter), beschriftet wird übersetzt. `katLabel` sammelt die
         Beschriftung beim ersten Datensatz ein, der diese Kategorie trägt —
         eine eigene Übersetzungstabelle wäre hier falsch: es gibt 953
         verschiedene Kategorien, 859 davon amtliche Sachgebiete des
         Bundestags („Straßenverkehrs-Ordnung"), und die sind Eigennamen. */
      var zaehler = {}, katLabel = {};
      arr.forEach(function (r) {
        if (!r.category) return;
        zaehler[r.category] = (zaehler[r.category] || 0) + 1;
        if (!katLabel[r.category]) katLabel[r.category] = txt(r, "category");
      });
      // Sortiert wird nach der ANGEZEIGTEN Beschriftung, sonst stünde die
      // Liste in der englischen Oberfläche in deutscher Reihenfolge.
      var kats = Object.keys(zaehler).sort(function (a, b) {
        return zaehler[b] - zaehler[a] ||
          String(katLabel[a] || a).localeCompare(String(katLabel[b] || b)); });
      if (kats.length) {
        h += '<div class="ptools__grp"><span class="ptools__h">' +
          '<i class="fa-solid fa-tag"></i> ' +
          esc(fill(T("tools.categories", "Kategorien ({n})"),
                   { n: kats.length })) +
          '</span><div class="chiprow">' +
          '<button class="chip" type="button" data-cat="">' +
          esc(T("tools.catAll", "Alle")) + "</button>" +
          kats.map(function (c) {
            return '<button class="chip" type="button" data-cat="' + esc(c) +
              '">' + esc(katLabel[c] || c) + '<span class="chip__n">' +
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
      var namen = { neu: T("tools.newestFirst", "Neueste zuerst"),
                    alt: T("tools.oldestFirst", "Älteste zuerst"),
                    viel: T("tools.mostShort", "Meiste Unterschriften"),
                    wenig: T("tools.fewestShort", "Wenigste Unterschriften") };
      var aktiv = [];
      if (state.sort) aktiv.push(namen[state.sort]);
      if (state.catFilter) aktiv.push(state.catFilter);
      // Auch der Lücken-Filter muss am ZUGEKLAPPTEN Bedienfeld ablesbar sein —
      // sonst sitzt man vor einer stark verkürzten Liste ohne sichtbaren Grund.
      if (state.gapFilter) aktiv.push(state.gapFilter === "signatures"
        ? T("tools.withoutCount", "ohne Unterschriftenzahl")
        : T("tools.withoutDate", "ohne Startdatum"));
      var st = tools.querySelector(".ptools__state");
      st.textContent = aktiv.join(" · ");
      tools.classList.toggle("is-active", aktiv.length > 0);
      tools.querySelectorAll("[data-sort]").forEach(function (b) {
        b.classList.toggle("on", (b.dataset.sort || null) === state.sort); });
      // Der Knopf zeigt mit, ob seine Sortierung gerade steht — sonst tippt
      // man ein zweites Mal und sieht nicht, dass er schon gewirkt hat.
      if (neuBtn) {
        neuBtn.classList.toggle("on", state.sort === "neu");
        neuBtn.setAttribute("aria-pressed", state.sort === "neu" ? "true" : "false");
      }
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
        return (sucheText(r) + " " + (r.category || "") + " " +
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
      var wortBeendet = T("liste.reasonClosed", "beendet");
      var wortArchiv = T("liste.reasonArchived", "im Archiv");
      var wortOffline = T("liste.reasonOffline", "offline");
      if (closedRows.length)
        gruende.push(zahl(closedRows.length, wortBeendet, wortBeendet));
      if (archived.length)
        gruende.push(zahl(archived.length, wortArchiv, wortArchiv));
      if (offline.length)
        gruende.push(zahl(offline.length, wortOffline, wortOffline));
      note.textContent = state.gapFilter
        ? zahl(active.length,
               state.gapFilter === "signatures"
                 ? T("tools.gapCountOne", "Petition ohne Unterschriftenzahl")
                 : T("tools.gapDateOne", "Petition ohne Startdatum"),
               state.gapFilter === "signatures"
                 ? T("tools.gapCountMany", "Petitionen ohne Unterschriftenzahl")
                 : T("tools.gapDateMany", "Petitionen ohne Startdatum"))
        : state.catFilter
        ? zahl(active.length,
               T("tools.catOne", "Petition in dieser Kategorie"),
               T("tools.catMany", "Petitionen in dieser Kategorie"))
        : state.tagFilter
        ? zahl(active.length,
               T("tools.tagOne", "Petition mit diesem Schlagwort"),
               T("tools.tagMany", "Petitionen mit diesem Schlagwort"))
        : fill(T("liste.countOf", "{n} von {total} Petitionen"),
               { n: nf.format(active.length), total: nf.format(arr.length) }) +
          (gruende.length ? " (" + gruende.join(", ") + ")" : "");

      // Filter-Leiste über der Liste, wenn Kategorie ODER Schlagwort aktiv ist.
      if (state.catFilter || state.tagFilter) {
        filterBar.style.display = "";
        var flabel = state.catFilter
          ? '<i class="fa-solid fa-tag"></i> ' +
            esc(T("tools.catLabel", "Kategorie")) + ": <b>" +
            esc(state.catFilter) + "</b>"
          : '<i class="fa-solid fa-hashtag"></i> ' +
            esc(T("tools.tagLabel", "Schlagwort")) + ": <b>" +
            esc(state.tagFilter) + "</b>";
        filterBar.innerHTML = '<span class="filterbar__cat">' + flabel + "</span>" +
          '<div class="filterbar__actions">' +
          '<button class="filterbar__cross" type="button">' +
          '<i class="fa-solid fa-layer-group"></i> ' +
          esc(T("tools.crossSearch", "Plattformübergreifend suchen")) +
          "</button>" +
          '<button class="filterbar__reset" type="button">' +
          '<i class="fa-solid fa-xmark"></i> ' +
          esc(T("tools.resetFilter", "Filter zurücksetzen")) + "</button></div>";
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
      var restNote = esc(fill(T("liste.restNote",
        "Es werden die ersten {n} angezeigt – Suche eingrenzen für mehr."),
        { n: LIST_MAX }));
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
        bottomSection("pet-beendet", "fa-flag-checkered",
          esc(T("bottom.closed", "Beendet")), closedRows, "closedOpen",
          esc(T("bottom.closedEmpty", "Keine beendeten Petitionen.")));
      bottomSection("pet-archiv", "fa-box-archive",
        esc(T("bottom.archive", "Archiv")), archived, "archiveOpen",
        esc(T("bottom.archiveEmpty",
              "Noch nichts archiviert. Wische eine Petition nach links.")));
      bottomSection("pet-offline", "fa-circle-xmark",
        esc(T("bottom.offline", "Offline")), offline, "offlineOpen",
        esc(T("bottom.offlineEmpty", "Keine Offline-Petitionen.")));

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
          listWrap.insertBefore(el('<div class="count-note">' +
            esc(T("petition.notInData",
                  "Diese Petition steht nicht mehr in den Daten dieser " +
                  "Plattform. Vermutlich hat sich ihre Adresse geändert.")) +
            "</div>"), listWrap.firstChild);
      }
    }

    searchBox.addEventListener("input", function () {
      state.search = searchBox.value;
      if (state.dataCache[key]) draw(state.dataCache[key]);
    });

    loadPlatformData(key).then(draw).catch(function () {
      note.textContent = T("msg.loadErrorShort",
                           "Daten konnten nicht geladen werden.");
    });
  }

  // ---- Rendering: Plattformübergreifende Suche ------------------------------
  // Zeigt zum aktiven Filter (Kategorie ODER Schlagwort) passende Petitionen aus
  // ALLEN aktivierten Plattformen, je Plattform gruppiert. "Zurück" kehrt zum
  // Plattform-Detail zurück – der Filter dort bleibt erhalten.
  function crossMatch(r, v) {
    if ((r.tags || []).some(function (t) { return t.toLowerCase() === v; })) return true;
    if ((r.category || "").toLowerCase() === v) return true;
    var hay = (sucheText(r) + " " +
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
      ? fill(T("nav.backTo", "Zurück zu {name}"),
             { name: platformName(f.fromPlatform) })
      : T("nav.backOverview", "Zurück zur Übersicht");
    var head = el('<div class="subhead">' +
      '<button class="backbtn"><i class="fa-solid fa-chevron-left"></i> ' +
      esc(backLabel) + "</button></div>");
    head.querySelector(".backbtn").addEventListener("click", function () {
      state.cross = null; render();
    });
    content.appendChild(head);

    var crumb = el('<div class="crosshead"></div>');
    content.appendChild(crumb);
    var note = el('<div class="count-note">' +
      esc(T("cross.searching", "Suche über alle Plattformen …")) + "</div>");
    content.appendChild(note);
    var listWrap = el('<div id="crosslist"></div>');
    content.appendChild(listWrap);

    var plats = livePlatforms().filter(function (p) { return isEnabled(p.key); });

    function drawCross() {
      var v = String(state.cross.value).toLowerCase();
      crumb.innerHTML = (state.cross.type === "cat"
        ? '<i class="fa-solid fa-tag"></i> ' +
          esc(T("cross.typeCat", "Kategorie"))
        : state.cross.type === "tag"
        ? '<i class="fa-solid fa-hashtag"></i> ' +
          esc(T("cross.typeTag", "Schlagwort"))
        : '<i class="fa-solid fa-magnifying-glass"></i> ' +
          esc(T("cross.typeText", "Volltextsuche"))) +
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
        ? fill(T("cross.hits", "{n} Treffer auf {p} Plattform(en)"),
               { n: nf.format(total), p: nPlat })
        : T("cross.noHits", "Keine Treffer.");
      if (!total)
        listWrap.appendChild(el('<div class="empty">' +
          fill(T("cross.empty", "Zu „{q}“ wurde auf den aktivierten " +
                 "Plattformen nichts gefunden."),
               { q: esc(state.cross.value) }) + "</div>"));
    }

    Promise.all(plats.map(function (p) {
      return loadPlatformData(p.key).catch(function () { return []; });
    })).then(function () { drawCross(); }).catch(function () {
      note.textContent = T("msg.loadErrorShort",
                           "Daten konnten nicht geladen werden.");
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

  /* Beschriftung mit Info-Symbol, Erklärtext erst auf Antippen (12.8.2026).
     Gedacht für LANGE Erklärungen: die zum Layout nahm drei Zeilen ein und
     schob die Farbwahl aus dem Bild. Kurze Hinweise („Automatisch folgt der
     Einstellung deines Geräts") bleiben bewusst sichtbar — ein Symbol, hinter
     dem ein Halbsatz steckt, ist mehr Arbeit als Ersparnis.

     ⚠️ Antippen, nicht Überfahren: `title` bzw. :hover gibt es auf dem Telefon
     nicht, und die App ist zuerst eine Telefon-App.

     Liefert Beschriftung und Text GETRENNT zurück, weil der Text unter das
     Bedienelement gehört und nicht zwischen Beschriftung und Schalter — die
     Lesefolge Beschriftung → Schalter → Erklärung bleibt so, wie sie war. */
  function lblMitInfo(label, text) {
    var lbl = el('<div class="srow__lbl lblinfo"><span>' + esc(label) + "</span></div>");
    var knopf = el('<button class="lblinfo__b" type="button" aria-expanded="false"' +
      ' aria-label="' + esc(T("settings.infoShow", "Erklärung anzeigen")) + '">' +
      '<i class="fa-solid fa-circle-info"></i></button>');
    var note = el('<div class="srow__note lblinfo__t">' + esc(text) + "</div>");
    knopf.addEventListener("click", function () {
      var auf = !note.classList.contains("open");
      note.classList.toggle("open", auf);
      knopf.classList.toggle("on", auf);
      knopf.setAttribute("aria-expanded", auf ? "true" : "false");
    });
    lbl.appendChild(knopf);
    return { lbl: lbl, note: note };
  }

  /* Schalterleiste (Segment-Knöpfe). Stand bis zum 12.8.2026 INNERHALB von
     renderEinstellungen() und war damit für den Assistenten unerreichbar —
     seit der Assistent Farbdesign und Layout mitabfragt, brauchen beide
     dieselbe Leiste. Herausgezogen statt kopiert: zwei Fassungen liefen beim
     nächsten Eingriff auseinander, und die Knöpfe hier tragen inzwischen drei
     Sonderfälle (Icon optional, Flagge in eigenem Span, Text escaped).
     Schließt über nichts aus der Einstellungsseite — nur el() und esc(). */
  function segControl(label, items, current, pick) {
    var seg = el('<div class="seg" role="group" aria-label="' +
      esc(label) + '"></div>');
    items.forEach(function (it) {
      /* Icon ist optional (seit der Sprachwahl 8.8.2026): dort trägt die
         Beschriftung schon eine Flagge, ein FontAwesome-Zeichen daneben
         wäre doppelt. Ohne diese Abfrage entstünde `<i class="fa-solid ">`
         — ein leeres Icon-Element, das je nach Schriftstand einen
         Platzhalter oder eine Lücke zeichnet. */
      /* it[3] ist eine FLAGGE. Sie steht in einem eigenen <span class="flag">
         und nicht im Beschriftungstext, weil sie sonst als nacktes Emoji
         erschiene — quer statt rund (Nutzerwunsch 12.8.2026: „Flaggen
         überall als Kreis"). Der Text selbst bleibt escaped. */
      var b = el('<button class="seg__b' +
        (current === it[0] ? " on" : "") + '" type="button">' +
        (it[2] ? '<i class="fa-solid ' + it[2] + '"></i> ' : "") +
        (it[3] ? '<span class="flag">' + it[3] + "</span> " : "") +
        esc(it[1]) + "</button>");
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

  /* „Bilder in Beschreibungen laden" als fertige Zeile. Ebenfalls
     herausgezogen (12.8.2026), weil der Assistent sie im letzten Schritt
     zeigt: der Erklärtext wechselt mit dem Schalter (refresh), und
     genau diese Kopplung wäre in einer zweiten Fassung als Erstes
     auseinandergelaufen.

     WARUM ES DIESE OPTION BRAUCHT (am 29.7.26 nachgemessen): die Plattformen
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

     Anders als Farbdesign und Layout hängt das nicht nur an CSS:
     ausgeschaltet werden die <img> beim Aufbau der Beschreibung entfernt
     (stripImages), deshalb muss die Ansicht danach neu gezeichnet werden.
     Aufgeklappte Petitionen bleiben dabei offen, weil der Zustand in state
     und nicht im DOM steht. */
  /* kurz=true zeigt statt der ausführlichen Begründung nur den Zustand.
     Gebraucht im Assistenten: dort steht das WARUM bereits hinter dem
     Info-Symbol, und der lange Text lief darunter in der 168 px schmalen
     Textspalte über zehn Zeilen — zweimal dasselbe Argument untereinander.
     Auf der Einstellungsseite bleibt es beim langen Text: dort gibt es kein
     Info-Symbol an dieser Zeile, die Begründung hat sonst keinen Ort. */
  function bilderZeile(kurz) {
    var row = el('<div class="srow srow--static">' +
      '<span class="srow__ic"><i class="fa-solid fa-image"></i></span>' +
      '<span class="srow__body"><span class="srow__t">' +
      esc(T("settings.descImagesLabel", "Bilder in Beschreibungen laden")) +
      "</span>" +
      '<span class="srow__s srow__imgnote"></span></span>' +
      '<span class="srow__end"><label class="switch"><input type="checkbox"' +
      (state.prefs.descImages ? " checked" : "") +
      '><span class="slider"></span></label></span></div>');
    var note = row.querySelector(".srow__imgnote");
    function refresh() {
      if (kurz) {
        note.textContent = state.prefs.descImages
          ? T("wizard.imagesOn", "Bilder werden mitgeladen.")
          : T("wizard.imagesOff", "Nur Text – spart Datenvolumen.");
        return;
      }
      note.textContent = state.prefs.descImages
        ? T("settings.descImagesOn",
            "Fotos und Logos werden beim Öffnen einer Petition aus dem Internet "
            + "nachgeladen. Das setzt eine Internetverbindung voraus und "
            + "verbraucht Datenvolumen – einzelne Bilder sind mehrere Megabyte "
            + "groß. Unterwegs am besten nur im WLAN einschalten.")
        : T("settings.descImagesOff",
            "Nur Text. Es werden keine Bilddateien aus dem Internet abgerufen, "
            + "es entsteht also kein Datenverbrauch für Bilder.");
    }
    refresh();
    row.querySelector("input").addEventListener("change", function () {
      state.prefs.descImages = this.checked;
      savePrefs(); refresh();
      /* Im Assistenten NICHT neu zeichnen: render() räumt die Liste unter dem
         Overlay auf, das kostet dort nur Zeit — und mit scrollTo(0,0) am Ende
         zöge es den Hintergrund nach oben, während der Assistent darüber
         stehen bleibt. Auf der Einstellungsseite ist das Neuzeichnen dagegen
         nötig (stripImages greift beim Aufbau), und der Scrollstand muss
         gemerkt werden, sonst stünde man danach wieder ganz oben. */
      if (document.getElementById("wizard")) return;
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      render();
      window.scrollTo(0, y);
    });
    return row;
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
    titleEl.textContent = T("nav.settings", "Einstellungen");
    var live = livePlatforms()
      .sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
    var activeCount = live.filter(function (p) { return isEnabled(p.key); }).length;
    var allOn = activeCount === live.length;

    // Seitenüberschrift wie auf der Liste: die Seite soll über die Überschrift
    // tragen, nicht über die schmale Kopfleiste.
    content.innerHTML =
      '<div class="welcome"><h1 class="welcome__t">' +
      esc(T("nav.settings", "Einstellungen")) + "</h1>" +
      '<p class="welcome__s">' +
      esc(T("settings.intro", "Wähle, welche Petitionsplattformen in der " +
                              "Liste erscheinen sollen.")) + "</p></div>";

    // ---- Darstellung ---------------------------------------------------------
    // Bewusst GANZ OBEN: das Plattform-Akkordion darunter ist offen rund 1.300 px
    // hoch, alles dahinter lag damit zwei Bildschirmhöhen tief und war praktisch
    // unauffindbar.
    content.appendChild(setSection(T("settings.sections.appearance", "Darstellung")));

    /* Zwei Schalterleisten nach demselben Muster: Farbdesign und Layout.
       Beide setzen nur ein Attribut auf <html> und speichern die Wahl – kein
       Neuzeichnen nötig, weil ausschließlich CSS daran hängt.
       segControl() steht seit dem 12.8.2026 oben im Modul, weil der
       Assistent dieselben Leisten zeigt. */

    /* SPRACHE zuerst — sie ändert alles Weitere auf dem Bildschirm, deshalb
       steht sie über Farbdesign und Layout (8.8.2026, Nutzerwunsch).
       Die Knöpfe tragen bewusst KEINE übersetzte Beschriftung: „Deutsch" und
       „English" stehen in ihrer eigenen Sprache, sonst müsste man die
       gesuchte Sprache erst finden können, um sie einzustellen. Die Liste
       kommt aus SPRACHEN ganz oben — eine neue Sprache erscheint hier von
       selbst.
       Nach der Wahl ein volles render(): Die Oberfläche ist bereits gezeichnet,
       und T() wird beim Zeichnen ausgewertet, nicht laufend beobachtet — ohne
       Neuzeichnen bliebe der alte Text stehen, bis man die Ansicht wechselt. */
    content.appendChild(el('<div class="srow__lbl">' +
      esc(T("settings.langLabel", "Sprache")) + "</div>"));
    content.appendChild(segControl(T("settings.langLabel", "Sprache"),
      // Flagge als eigener Platz (it[3]), damit sie rund beschnitten wird.
      SPRACHEN.map(function (s) { return [s.code, s.name, "", s.flagge]; }),
      state.prefs.lang || STANDARDSPRACHE,
      function (v) {
        state.prefs.lang = v; savePrefs(); applyLayout(); render();
      }));
    content.appendChild(el('<div class="srow__note">' +
      esc(T("settings.langHint",
            "Beim ersten Start folgt die App der Sprache deines Geräts.")) +
      "</div>"));

    content.appendChild(el('<div class="srow__lbl">' +
      esc(T("settings.themeLabel", "Farbdesign")) + "</div>"));
    content.appendChild(segControl(T("settings.themeLabel", "Farbdesign"),
      [["light", T("settings.themeLight", "Hell"), "fa-sun"],
       ["dark", T("settings.themeDark", "Dunkel"), "fa-moon"],
       ["auto", T("settings.themeAuto", "Automatisch"), "fa-circle-half-stroke"]],
      state.prefs.theme,
      function (v) { state.prefs.theme = v; savePrefs(); applyTheme(); }));
    content.appendChild(el('<div class="srow__note">' +
      esc(T("settings.darkModeHint",
            "„Automatisch“ folgt der Einstellung deines Geräts.")) + "</div>"));

    /* Blendet die Akzent-Einstellungen ein oder aus. Steht als Deklaration
       hier oben, damit der Layout-Schalter sie aufrufen kann, obwohl der
       Block selbst erst weiter unten gebaut wird (Funktionsdeklarationen
       werden hochgezogen, die Variable ist beim KLICK längst gesetzt). */
    function akzentSichtbar() {
      akzentBox.hidden = state.prefs.layout !== "magazin";
    }

    /* Die Layout-Erklärung steckt hinter dem Info-Symbol (Nutzerwunsch
       12.8.2026). Sie ist der mit Abstand längste Hinweis der Seite und stand
       dauerhaft zwischen Layout-Schalter und Farbwahl. */
    var layoutLbl = lblMitInfo(T("settings.layoutLabel", "Layout"),
      T("settings.layoutHint",
        "Ändert nur das Aussehen der Listen, nicht die Inhalte."));
    content.appendChild(layoutLbl.lbl);
    content.appendChild(segControl(T("settings.layoutLabel", "Layout"),
      [["relief", T("settings.layoutRelief", "Relief"), "fa-cube"],
       ["magazin", T("settings.layoutMag", "Magazin"), "fa-image"]],
      state.prefs.layout,
      function (v) {
        state.prefs.layout = v; savePrefs(); applyLayout();
        // Akzentwahl gibt es nur im Magazin — sofort mitziehen, nicht erst
        // beim nächsten Betreten der Seite.
        akzentSichtbar();
      }));
    content.appendChild(layoutLbl.note);

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
    /* ⚠️ Akzentfarbe und Akzent-Schriftfarbe wirken NUR im Magazin — alle 36
       [data-accent]-Regeln in layouts.css hängen unter
       :root[data-layout="magazin"], und in Relief ändert ein anderer Akzent
       nachweislich nichts (am 12.8.2026 gemessen: --accent bleibt #4bbfa4,
       --mz-accent ist nicht einmal gesetzt). Deshalb sind sie in Relief ganz
       ausgeblendet (Nutzerwunsch 12.8.2026) statt nur mit einem Hinweis
       versehen.

       ⚠️⚠️ Hier stand vorher „Immer sichtbar, auch in Relief: die Seite wird
       beim Layout-Umschalten NICHT neu gezeichnet, eine erst-im-Magazin-Fassung
       erschiene also nie." Das Argument war richtig — deshalb blendet der
       Layout-Schalter diesen Block jetzt ausdrücklich um (akzentSichtbar()).
       Bewusst per hidden statt per Neuzeichnen: renderEinstellungen() würde
       den Scrollstand und jede offene Fläche mitreißen. */
    var akzentBox = el('<div class="akzentbox"></div>');
    akzentBox.appendChild(el('<div class="srow__lbl">' +
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
    akzentBox.appendChild(acbar);
    /* Ueberschrift ueber der Schriftfarbe (8.8.2026, Nutzerwunsch). segControl
       verwendet sein erstes Argument ausschliesslich als aria-label und
       zeichnet es NICHT — sichtbar wird es erst durch dieses srow__lbl,
       dieselbe Bauform wie „Akzentfarbe" ein paar Zeilen darueber. */
    akzentBox.appendChild(el('<div class="srow__lbl">' +
      esc(T("settings.accentInkLabel", "Akzent-Schriftfarbe")) + "</div>"));
    akzentBox.appendChild(segControl(T("settings.accentInkLabel", "Schrift"),
      [["auto", T("settings.accentInkAuto", "Automatisch"), "fa-wand-magic-sparkles"],
       ["light", T("settings.accentInkLight", "Hell"), "fa-sun"],
       ["dark", T("settings.accentInkDark", "Dunkel"), "fa-moon"]],
      state.prefs.accentInk || "auto",
      function (v) { state.prefs.accentInk = v; savePrefs(); applyLayout(); }));
    content.appendChild(akzentBox);
    akzentSichtbar();


    /* ⚠️ KEINE eigene Abschnittsüberschrift „Plattformen" (12.8.2026): die
       Kopfzeile des Akkordions sagt bereits „Plattformen 11/11 aktiv" und ist
       damit selbst die Überschrift. Ein setSection() darüber hat das Wort
       schlicht zweimal gezeigt — erst gebaut, vom Nutzer gesehen, wieder
       entfernt. Das Akkordion trägt den Abschnitt allein.

       Favoriten-Erklärung: wird hier GEBAUT, aber unten IN den Ausklapper
       gehängt (Nutzerwunsch) — sie erklärt die Sterne, die erst in der Liste
       darin auftauchen. Wegklickbar wie der Wisch-Hinweis, mit demselben
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
        '<i class="fa-solid fa-check"></i> ' +
        esc(T("favorites.hintDismiss", "Verstanden, nicht mehr anzeigen")) +
        "</button></div></div>");
      favTip.querySelector(".hint-dismiss").addEventListener("click", function () {
        LS.setItem("favTipDismissed", "1"); favTip.remove();
      });
      // Nicht hier anhängen — siehe unten, der Hinweis gehört IN den Ausklapper.
    }

    // Akkordion "Plattformen" — die Abschnittsüberschrift dazu steht weiter
    // oben, VOR der Favoriten-Erklärung.
    var acc = el('<section class="accordion' +
      (state.prefs.settingsOpen !== false ? " open" : "") + '"></section>');
    var head = el('<button class="acc-head"><span class="acc-title">' +
      esc(T("settings.platformsTitle", "Plattformen")) +
      '<span class="acc-count">' +
      esc(fill(T("settings.activeCount", "{n}/{total} aktiv"),
               { n: activeCount, total: live.length })) + "</span></span>" +
      '<i class="fa-solid fa-chevron-down acc-chev"></i></button>');
    head.addEventListener("click", function () {
      state.prefs.settingsOpen = !state.prefs.settingsOpen;
      savePrefs();          // merken, sonst ist er nach dem Neustart wieder auf
      acc.classList.toggle("open", state.prefs.settingsOpen);
    });
    acc.appendChild(head);

    var body = el('<div class="acc-body"></div>');
    /* Favoriten-Erklärung als ERSTES im Ausklapper, direkt unter
       „Plattformen 11/11 aktiv" (Nutzerwunsch 12.8.2026). Sie erklärt die
       Sterne, und die stehen an den Zeilen darunter — außerhalb des
       Ausklappers erklärte sie etwas, das man gar nicht sieht.
       `favTip` ist undefined, wenn der Hinweis schon weggeklickt wurde: `var`
       wird auf Funktionsebene hochgezogen, die Zuweisung steht im if. */
    if (favTip) body.appendChild(favTip);

    // "Alle deaktivieren / Alle aktivieren"-Button (wird UNTER die Liste gesetzt)
    var toggleAll = el('<button class="btn-secondary">' +
      esc(allOn ? T("settings.allOff", "Alle deaktivieren")
                : T("settings.allOn", "Alle aktivieren")) + "</button>");
    toggleAll.addEventListener("click", function () {
      if (allOn) state.enabled = new Set();          // alle aus
      else state.enabled = new Set(live.map(function (x) { return x.key; }));
      saveEnabled();
      renderEinstellungen();                         // neu zeichnen
    });

    /* ---- Nach Sprache gegliedert (Nutzerwunsch 11.8.2026) -----------------
       „Schritt 2 soll sich von der Aufteilung wiedererkennbar in den
       Einstellungen widerspiegeln." Also dieselbe Gliederung wie im
       Einrichtungs-Assistenten: je Sprache eine Gruppe mit Flaggenkreis,
       das Naheliegende offen, der Rest eingeklappt.

       Was im Assistenten die GEWÄHLTEN Sprachen sind, sind hier die Sprachen
       mit mindestens einer aktiven Plattform — die Entsprechung, die ohne
       einen zusätzlichen gespeicherten Zustand auskommt. Wer nur deutsche
       Plattformen aktiv hat, sieht die englische Gruppe also zugeklappt und
       kommt trotzdem mit einem Tipp daran.

       Plattformen „in Vorbereitung" (p.live === false) laufen in derselben
       Gliederung mit; sie zählen nur nicht als aktiv, ihre Gruppe kann
       dadurch zugeklappt starten. Aktuell gibt es keine. */
    var alleP = live.concat(
      state.manifest.platforms.filter(function (p) { return !p.live; }));
    var sGruppen = {};
    alleP.forEach(function (p) {
      var c = platMainLanguage(p);
      (sGruppen[c] = sGruppen[c] || []).push(p);
    });
    var sNachRang = function (a, b) {
      return langRank(a) - langRank(b) || a.localeCompare(b); };
    var hatAktive = function (c) {
      return sGruppen[c].some(function (p) { return p.live && isEnabled(p.key); }); };
    var sCodes = Object.keys(sGruppen).filter(hatAktive).sort(sNachRang)
      .concat(Object.keys(sGruppen).filter(function (c) { return !hatAktive(c); })
                .sort(sNachRang));

    sCodes.forEach(function (code) {
      var grp = langSection(code, sGruppen[code].length, hatAktive(code));
      body.appendChild(grp.sec);
      sGruppen[code].forEach(function (p) {
      var on = p.live && isEnabled(p.key);
      var finfo = langInfo(p.language || "de");
      var fav = p.live && isFav(p.key);
      var brand = platColor(p.key);
      var opt = el('<div class="opt' + (p.live ? "" : " disabled") + '"' +
        (brand ? ' style="--brand:' + esc(brand) + '"' : "") + ">" +
        /* Logo NACH der Beschriftung. Das ist zugleich die bessere Lesefolge
           für Screenreader: erst der Name, dann „Logo <Name>". */
        /* Keine Flagge mehr an der Zeile: die trägt jetzt die
           Gruppenüberschrift, einmal statt elfmal — dieselbe Regel wie bei den
           Sprachgruppen der Hauptliste (siehe .flag in style.css). */
        '<div class="opt__body"><div class="opt__name">' + esc(p.name) + '</div>' +
        '<div class="opt__meta">' + esc(p.live
          ? fill(T("settings.platMeta", "{lang} · {n} Petitionen"),
                 { lang: finfo.name, n: nf.format(p.online) })
          : fill(T("settings.platSoon", "{lang} · in Vorbereitung"),
                 { lang: finfo.name })) + "</div></div>" +
        platLogo(p.key, p.name) +
        '<button class="favbtn' + (fav ? " on" : "") + '"' +
          (p.live ? "" : " disabled") + ' aria-label="' +
          esc(T("settings.favMark", "Als Favorit markieren")) + '">' +
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
        head.querySelector(".acc-count").textContent =
          fill(T("settings.activeCount", "{n}/{total} aktiv"),
               { n: n, total: live.length });
        toggleAll.textContent = (n === live.length)
          ? T("settings.allOff", "Alle deaktivieren")
          : T("settings.allOn", "Alle aktivieren");
        allOn = (n === live.length);
      });
        grp.body.appendChild(opt);
      });
    });

    body.appendChild(toggleAll);          // Button unter der Plattform-Liste
    acc.appendChild(body);
    /* Ganz nach oben (Nutzerwunsch 12.8.2026): WELCHE Plattformen man sieht,
       ist die wichtigste Einstellung der App und stand bisher hinter Sprache,
       Farbdesign und Layout. Eingefügt statt angehängt — der Block wird
       weiterhin hier gebaut, weil er auf live/activeCount/allOn zugreift, die
       oben in dieser Funktion entstehen. Ziel ist die Stelle direkt hinter dem
       Einleitungsblock (.welcome), der als einziges per innerHTML gesetzt wird
       und deshalb sicher das erste Kind ist. */
    content.insertBefore(acc, content.firstElementChild.nextSibling);

    // ---- Benachrichtigungen --------------------------------------------------
    content.appendChild(setSection(
      T("settings.sections.notify", "Benachrichtigungen")));
    content.appendChild(renderNotifyBox());

    // ---- Daten ---------------------------------------------------------------
    content.appendChild(setSection(T("settings.sections.data", "Daten")));
    /* „Bilder in Beschreibungen laden" gehört hierher und nicht unter
       „Darstellung" (Nutzerentscheidung 12.8.2026): der eigene Erklärtext
       der Zeile argumentiert fast nur mit Verbrauch — „setzt eine
       Internetverbindung voraus und verbraucht Datenvolumen, einzelne Bilder
       sind mehrere Megabyte groß". Das ist keine Frage des Aussehens.
       Gebaut wird sie oben im Modul (bilderZeile), weil der Assistent sie im
       letzten Schritt ebenfalls zeigt. */
    content.appendChild(bilderZeile());

    /* ---- Nach Updates suchen (8.8.2026) ---------------------------------
       Erscheint NUR, wenn window.AndroidUpdate existiert - also in der
       Android-Fassung fuer die Direktverteilung. Im Browser und in der
       F-Droid-Fassung (Bauschalter mitUpdater=false, Bruecke wird gar nicht
       angemeldet) fehlt die Zeile ganz. Bewusst so herum geprueft: ein
       sichtbarer Knopf, der nichts tut, ist schlimmer als gar keiner.

       Die App installiert nichts selbst - sie laedt die Datei und uebergibt
       sie dem Paketinstallierer, der ausdruecklich nachfragt. */
    if (window.AndroidUpdate) {
      var upRow = setRow("fa-cloud-arrow-down",
        T("settings.update", "Nach Updates suchen"),
        T("settings.updateHint", "Prüft, ob eine neuere Fassung der App vorliegt."),
        { end: '<i class="fa-solid fa-chevron-right srow__go"></i>' });
      upRow.addEventListener("click", function () {
        var sub = upRow.querySelector(".srow__s");
        if (upRow.dataset.laeuft === "ja") return;
        upRow.dataset.laeuft = "ja";
        var balken = upRow.querySelector(".srow__bar");
        if (!balken) {
          balken = el('<span class="srow__bar"></span>');
          upRow.appendChild(balken);
        }
        function stand(txt, anteil) {
          sub.textContent = txt;
          balken.style.width = Math.round((anteil || 0) * 100) + "%";
        }
        stand(T("settings.updateChecking", "Wird geprüft …"), .15);

        /* Rueckrufe haengen an window, weil die Java-Seite sie per Namen
           aufruft (evaluateJavascript). Eindeutige Namen, damit sich zwei
           Aufrufe nicht in die Quere kommen. */
        window.__pmUpdateAntwort = function (roh) {
          var d = null;
          try { d = JSON.parse(roh); } catch (e) { d = null; }
          if (!d || d.fehler || !d.tag_name) {
            upRow.dataset.laeuft = "";
            stand(T("settings.updateOffline",
                    "Nicht erreichbar. Später noch einmal versuchen."), 0);
            return;
          }
          var neu = String(d.tag_name).replace(/^v/, "");
          var hier = "";
          try { hier = window.AndroidUpdate.fassung() || ""; } catch (e) {}
          /* Zahlenweiser Vergleich statt Textvergleich: "1.0.9" ist als
             Zeichenkette groesser als "1.0.24", als Fassung aber aelter. */
          function teile(v) {
            return String(v).split(".").map(function (x) {
              return parseInt(x, 10) || 0; });
          }
          function neuer(a, b) {
            var A = teile(a), B = teile(b);
            for (var i = 0; i < Math.max(A.length, B.length); i++) {
              if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0);
            }
            return false;
          }
          if (hier && !neuer(neu, hier)) {
            upRow.dataset.laeuft = "";
            stand(fill(T("settings.updateAktuell",
                         "Du hast die neueste Fassung ({v})."), { v: hier }), 1);
            return;
          }
          var apk = null;
          if (d.assets) {
            for (var i = 0; i < d.assets.length; i++) {
              if (/\.apk$/i.test(d.assets[i].name || "")) {
                apk = d.assets[i].browser_download_url; break;
              }
            }
          }
          if (!apk) {
            upRow.dataset.laeuft = "";
            stand(T("settings.updateKeineDatei",
                    "Neue Fassung gefunden, aber keine Installationsdatei."), 0);
            return;
          }
          stand(fill(T("settings.updateLaedt", "Fassung {v} wird geladen …"),
                     { v: neu }), .2);
          window.AndroidUpdate.hole(apk, "window.__pmUpdateFortschritt");
        };
        window.__pmUpdateFortschritt = function (p) {
          if (p < 0) {
            upRow.dataset.laeuft = "";
            stand(T("settings.updateFehler", "Download fehlgeschlagen."), 0);
            return;
          }
          if (p >= 100) {
            stand(T("settings.updateBereit",
                    "Geladen. Bestätige die Installation."), 1);
            return;
          }
          stand(fill(T("settings.updateLaedtProzent", "Wird geladen … {p} %"),
                     { p: p }), .2 + .8 * (p / 100));
        };
        try { window.AndroidUpdate.pruefe("window.__pmUpdateAntwort"); }
        catch (e) {
          upRow.dataset.laeuft = "";
          stand(T("settings.updateFehler", "Download fehlgeschlagen."), 0);
        }
      });
      content.appendChild(upRow);
    }
    var refreshRow = setRow("fa-arrows-rotate",
      T("settings.refresh", "Daten aktualisieren"),
      state.lastRefresh
        ? fill(T("settings.refreshedAt",
                 "Aktualisiert am {zeit} · Quelle: {quelle}"),
               { zeit: fmtDateTime(state.lastRefresh),
                 quelle: state.baseAuto === "live"
                   ? T("settings.srcLiveShort", "live")
                   : T("settings.srcBundledShort", "mitgeliefert") })
        : T("settings.refreshHint", "Petitionen neu von der Quelle laden"),
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>' });
    /* ⚠️ UMGEBAUT 8.8.2026 (Nutzerbefund: „wenn ich auf Daten aktualisieren
       klicke, springt die Seite nur nach oben, es passiert nichts, kein
       Dialog, keine Fortschrittsbalken, kein Prozess").

       Der alte Handler war nicht kaputt — er war nur unsichtbar. Er lud
       ausschliesslich das MANIFEST (Sekundenbruchteil), leerte den Cache und
       rief sofort render(). Die Petitionslisten selbst kamen gar nicht neu,
       sondern erst beim nächsten Zugriff über loadPlatformData(). Die Meldung
       „Wird geladen …" war weg, bevor man sie lesen konnte, und render()
       setzte die Ansicht neu auf — das war der Sprung nach oben. Aus
       Nutzersicht: ein Klick ohne Wirkung.

       Jetzt passiert wirklich etwas Sichtbares:
       - die aktivierten Plattformen werden TATSAECHLICH neu geholt,
       - jede fertige Plattform schiebt den Balken weiter,
       - am Ende steht die Zahl der geladenen Petitionen,
       - und die Scrollposition bleibt erhalten (Muster wie in draw()).
       Eine einzelne Plattform darf scheitern, ohne den Lauf abzubrechen:
       ihr Fehler wird gezaehlt, nicht geworfen — sonst reisst ein
       Funkloch bei einer Quelle den ganzen Abgleich mit. */
    refreshRow.addEventListener("click", function () {
      var sub = refreshRow.querySelector(".srow__s");
      if (refreshRow.dataset.laeuft === "ja") return;   // Doppelklick abwehren
      refreshRow.dataset.laeuft = "ja";
      var balken = refreshRow.querySelector(".srow__bar");
      if (!balken) {
        balken = el('<span class="srow__bar"></span>');
        refreshRow.appendChild(balken);
      }
      function stand(txt, anteil) {
        sub.textContent = txt;
        balken.style.width = Math.round((anteil || 0) * 100) + "%";
      }
      // Auch die Quelle neu bestimmen: wer vorher im Funkloch startete, sitzt
      // sonst bis zum nächsten App-Start auf den mitgelieferten Daten fest.
      state.dataCache = {}; textChunks = {};
      stand(T("settings.refreshChecking", "Verbindung prüfen …"), .05);
      resolveBase().then(loadManifest).then(function () {
        var plats = livePlatforms().filter(function (p) {
          return isEnabled(p.key);
        });
        if (!plats.length) {
          stand(T("settings.refreshNoPlatforms", "Keine Plattform aktiviert."), 1);
          return 0;
        }
        var fertig = 0, kaputt = 0;
        var fortschritt = function (n) {
          return fill(T("settings.refreshProgress", "Lade {n} von {total} …"),
                      { n: n, total: plats.length });
        };
        stand(fortschritt(0), .1);
        return Promise.all(plats.map(function (p) {
          return loadPlatformData(p.key).then(function (arr) {
            return arr.length;
          }, function () { kaputt++; return 0; }).then(function (n) {
            fertig++;
            stand(fortschritt(fertig), .1 + .9 * (fertig / plats.length));
            return n;
          });
        })).then(function (zahlen) {
          var summe = zahlen.reduce(function (a, b) { return a + b; }, 0);
          stand(fill(T("settings.refreshDone", "{n} Petitionen geladen"),
                     { n: nf.format(summe) }) +
            (kaputt ? " · " + fill(T("settings.refreshBroken",
                                     "{n} Quelle(n) nicht erreichbar"),
                                   { n: kaputt }) : ""), 1);
          return summe;
        });
      }).then(function () {
        state.lastRefresh = new Date().toISOString();
        /* Kurz stehen lassen, damit die Fertigmeldung lesbar ist — ohne die
           Pause waere der Umbau genauso unsichtbar wie vorher. Danach neu
           zeichnen UND zurueckrollen: render() setzt sonst an den Anfang,
           und genau das hat der Nutzer als „springt nach oben" gemeldet. */
        var y = window.scrollY;
        setTimeout(function () { render(); window.scrollTo(0, y); }, 1200);
      }).catch(function () {
        refreshRow.dataset.laeuft = "";
        stand(T("settings.refreshFailed", "Nicht erreichbar."), 0);
      });
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
    content.appendChild(segControl(T("settings.source", "Datenquelle"),
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
        ? fill(T("settings.sourceNoteAuto",
                 "Aktiv: {aktiv}{grund}. „Automatisch“ nimmt die " +
                 "tagesaktuellen Daten, wenn sie erreichbar und neuer sind " +
                 "als die mitgelieferten."),
               { aktiv: state.baseAuto === "live"
                          ? T("settings.srcLive", "Live")
                          : T("settings.srcBundled", "Mitgeliefert"),
                 grund: baseWhyText() ? " – " + baseWhyText() : "" })
        : state.baseSetting === BUNDLED_BASE
          ? T("settings.sourceNoteBundled",
              "Nur die Daten aus dem App-Paket. Sie veralten, bis eine neue " +
              "Fassung der App kommt.")
          : T("settings.sourceNoteLive",
              "Immer aus dem Netz. Ohne Verbindung greift die App auf die " +
              "mitgelieferten Daten zurück.")
      ) + "</div>"));
    content.appendChild(setRow("fa-database",
      T("settings.sourceCustom", "Eigene Quelle"),
      isRemote(state.baseSetting) && state.baseSetting !== LIVE_BASE
        ? state.baseSetting
        : T("settings.sourceCustomHint", "Für Tests: eigener Basis-Ordner"),
      { end: '<i class="fa-solid fa-chevron-right srow__go"></i>',
        onClick: function () {
          var v = prompt(T("settings.sourcePrompt",
            "URL der Datenquelle (Basis-Ordner mit manifest.json):"),
            state.base);
          if (v == null) return;
          state.baseSetting = v.trim() || DEFAULT_BASE;
          LS.setItem("dataBase", state.baseSetting);
          reloadData();
        } }));
    }   // Ende ZEIGE.datenquelle

    /* Eigener Abschnitt (Nutzerentscheidung 12.8.2026). „Über die App" stand
       unter „Daten", weil dort zufällig der letzte Platz frei war — mit dem
       Datenstand der App hat es aber nichts zu tun. */
    content.appendChild(setSection(T("settings.sections.about", "Über")));

    /* „Über die App" klappt an Ort und Stelle auf. Bis zum 12.8.2026 war es ein
       alert(); der WebView zeigt dafür seinen SYSTEM-Dialog, und der setzt
       immer „Auf der Seite <adresse> steht:" darüber (Nutzerfrage: warum steht
       das da?). Die Adresse ist nur der virtuelle Host des
       WebViewAssetLoader — erklären lässt sich das dem Leser trotzdem nicht,
       und für Angaben wie Fassung oder Datenstand war in einem Textkasten
       ohnehin kein Platz.
       ⚠️ Der Pfeil zeigt jetzt nach UNTEN und dreht sich beim Aufklappen: er
       verspricht damit „hier geht etwas auf" statt „hier geht es weiter". */
    var aboutBox = aboutPanel();
    var aboutRow = setRow("fa-circle-info",
      T("settings.about", "Über die App"), null,
      { end: '<i class="fa-solid fa-chevron-down srow__go"></i>',
        onClick: function () {
          var auf = !aboutBox.classList.contains("open");
          aboutBox.classList.toggle("open", auf);
          aboutRow.classList.toggle("srow--open", auf);
          aboutRow.setAttribute("aria-expanded", auf ? "true" : "false");
        } });
    aboutRow.setAttribute("aria-expanded", "false");
    content.appendChild(aboutRow);
    content.appendChild(aboutBox);

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
        T("reset.hintsDone", "Zurückgesetzt – die Hinweise erscheinen wieder.");
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
      /* Eigener Dialog statt window.confirm — dieselbe Machart wie die
         Beenden-Nachfrage (qboxFragen). window.confirm funktioniert im WebView
         durchaus, zeigt aber die Herkunfts-URL und folgt der SYSTEM-Sprache,
         nicht der in den Einstellungen gewählten.
         ⚠️ Der Umbau macht aus einer synchronen Abfrage einen Rückruf: alles
         nach der Bestätigung MUSS in onJa stehen. Ein `return` wie beim alten
         `if (!confirm(...)) return;` gäbe es hier nicht mehr — es käme zu spät
         und löschte trotzdem.
         gefahr: true färbt den Knopf in die Warnfarbe; anders als beim Beenden
         geht hier wirklich alles verloren. */
      qboxFragen({
        titel: T("reset.allWarnTitle", "Wirklich alles löschen?"),
        /* Die Frage steht in der Überschrift, hier gehört die AUFZÄHLUNG hin —
           was genau verloren geht. Der Systemdialog konnte beides nur
           aneinandergeklebt in einem Textblock zeigen. */
        text: T("reset.allWarnText",
                "Dabei werden unwiderruflich gelöscht: deine Favoriten, alle " +
                "als unterzeichnet markierten Petitionen, das Archiv, deine " +
                "Plattform-Auswahl sowie Name und Profilbild. Die App startet " +
                "anschließend neu wie beim ersten Mal."),
        nein: T("reset.cancel", "Abbrechen"),
        ja: T("reset.allConfirmBtn", "Endgültig löschen"),
        gefahr: true,
        onJa: function () {
          wipeEverything();
          box.classList.add("danger--done");
          body.innerHTML = '<div class="danger__done"><i class="fa-solid fa-check"></i> ' +
            esc(T("reset.doneToast", "Alle Daten wurden gelöscht.")) + "</div>";
          setTimeout(function () { startWizard(); }, 900);
        }
      });
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

  /* ohneIntro=true lässt die Einleitungszeile weg. Gebraucht im Assistenten:
     dort steht dieselbe Aussage ausführlicher hinter dem Info-Symbol, und
     zweimal dasselbe untereinander liest sich wie ein Fehler. Als Parameter
     statt „im Aufrufer das erste Kind entfernen" — das hinge daran, dass die
     Einleitung das erste Kind BLEIBT. */
  function renderNotifyBox(ohneIntro) {
    var n = state.prefs.notify;
    var box = el('<div class="nbox"></div>');

    if (!ohneIntro)
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
        stateLbl.textContent = T("notify.notSupported",
          "Dieses Gerät unterstützt keine Benachrichtigungen.");
      } else if (notifyPermission() === "denied") {
        stateLbl.textContent = T("notify.permissionDenied",
          "In den Geräte-Einstellungen gesperrt.");
      } else if (n.on) {
        stateLbl.textContent = fill(T("notify.dailyAt", "Täglich um {zeit} Uhr"),
                                    { zeit: n.time });
      } else {
        stateLbl.textContent = T("notify.off", "Aus");
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
        sagen(T("notify.testUnsupported",
                "Diese Umgebung kennt keine Benachrichtigungen — weder über " +
                "den Browser noch über die Android-Brücke."));
        return;
      }
      var senden = function () {
        showNotification(T("notify.sampleTitle", "PetitionsManager"),
          fill(T("notify.sampleBodyNew", "{n} neue Petitionen warten auf dich."),
               { n: countNew() })).then(function (ok) {
          sagen(ok
            ? T("notify.testSent",
                "Gesendet. Erscheint sie nicht, sind Benachrichtigungen für " +
                "den Browser in den Systemeinstellungen abgeschaltet.")
            : T("notify.testFailed", "Konnte nicht gesendet werden."));
        });
      };
      var recht = notifyPermission();
      if (recht === "granted") { senden(); return; }
      if (recht === "denied") {
        sagen(AN
          ? T("notify.deniedAndroid",
              "Benachrichtigungen sind für diese App gesperrt. Das lässt " +
              "sich nur in den Android-Einstellungen der App zurücknehmen.")
          : T("notify.deniedBrowser",
              "Du hast Benachrichtigungen für diese Seite abgelehnt. Das " +
              "lässt sich nur in den Einstellungen des Browsers " +
              "zurücknehmen."));
        return;
      }
      // "default" – vorher scheiterte der Test hier stumm, weil das Recht nur
      // beim Einschalten des Schalters erfragt wurde.
      sagen(T("notify.waiting", "Warte auf deine Erlaubnis …"));
      notifyRequest().then(function (perm) {
        if (perm === "granted") { notifySyncAlarm(); senden(); }
        else sagen(T("notify.noPermission",
                     "Ohne Erlaubnis keine Benachrichtigung."));
      });
    });
    detail.appendChild(testBtn);
    detail.appendChild(testMsg);

    /* Der Hinweis muss die Wahrheit für die jeweilige Umgebung sagen: mit der
       Android-Brücke weckt ein AlarmManager auch bei geschlossener App, im
       Browser gibt es nur den Minutentakt einer laufenden Seite. */
    detail.appendChild(el('<div class="srow__note">' + esc(AN
      ? T("notify.hintAndroid",
          "Die Erinnerung kommt zur gewählten Uhrzeit, auch wenn die App " +
          "geschlossen ist. Android darf sie um einige Minuten verschieben, " +
          "um Akku zu sparen. Wie viele Petitionen neu sind, steht in der " +
          "App – die Meldung selbst kennt die Daten nicht.")
      : T("notify.hintBrowser",
          "Hinweis: Die Meldung erscheint, sobald du die App nach der " +
          "gewählten Uhrzeit das nächste Mal öffnest oder sie im Hintergrund " +
          "noch läuft. Eine Erinnerung bei komplett geschlossener App " +
          "bräuchte einen eigenen Server – den hat diese App im Browser " +
          "bewusst nicht. In der Android-App übernimmt das ein Weckruf des " +
          "Systems.")) + "</div>"));

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

  /* ---- „Über die App": die Fläche (12.8.2026) ------------------------------
     Erklärtexte oben, darunter eine Fakten-Liste und Verweise.

     ⚠️ Jede Angabe hat eine Rückfallebene, und zwar eine SICHTBARE: fehlt ein
     Wert, steht dort die Web-Fassung bzw. „—". Die Alternative wäre eine Zeile,
     die einfach fehlt — und dann sucht man den Fehler in der Anzeige statt in
     der Quelle. Im Browser gibt es die Android-Brücke nicht, dort ist das der
     Normalfall und keine Störung. */
  function aboutFakten() {
    var zeilen = [];

    // Fassung: nur die Android-Fassung kennt eine. Der Browser sagt das auch so.
    var v = "", b = "";
    try {
      if (window.AndroidApp && window.AndroidApp.fassung) {
        v = window.AndroidApp.fassung() || "";
        b = window.AndroidApp.bau ? (window.AndroidApp.bau() || "") : "";
      }
    } catch (e) { /* Brücke da, aber unwillig — dann gilt der Rückfall unten */ }
    zeilen.push([T("about.factVersion", "Fassung"),
      v ? (b ? fill(T("about.versionMitBau", "{v} (Bau {b})"), { v: v, b: b }) : v)
        : T("about.versionWeb", "Web-Fassung")]);

    /* Datenstand aus dem Manifest, in der Zeitzone des Geräts — die rechnet
       toLocale… von selbst um, das Manifest trägt UTC.

       ⚠️ Mit MONATSNAMEN, nicht in Ziffern: „8/12/2026" heißt in den USA der
       12. August und fast überall sonst der 8. Dezember. Bei einer Angabe,
       deren ganzer Zweck „wie alt sind die Daten?" ist, wäre das die
       schlechteste Stelle zum Raten.
       Die Sprache folgt der WAHL in den Einstellungen, nicht dem Gerät: die
       Beschriftung daneben tut es auch, sonst stünde „Datenstand" neben einem
       englischen Monat.
       try/catch, weil dateStyle/timeStyle ein jüngeres Intl braucht — bei
       minSdk 24 kann ein sehr alter WebView darunterliegen. Dann eben das
       schlichte Format statt einer leeren Zeile. */
    var m = state.manifest;
    var stand = "—";
    if (m && m.generated_at) {
      var d = new Date(m.generated_at);
      if (!isNaN(d.getTime())) {
        var loc = (state.prefs.lang === "en") ? "en-GB" : "de-DE";
        try {
          stand = d.toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" });
        } catch (e) { stand = d.toLocaleString(loc); }
      }
    }
    zeilen.push([T("about.factData", "Datenstand"), stand]);

    // Umfang: zählt NUR die Live-Plattformen, so wie die Liste sie auch zeigt.
    var pl = (m && m.platforms) ? m.platforms.filter(function (p) { return p.live; }) : [];
    var summe = pl.reduce(function (s, p) { return s + (p.count || 0); }, 0);
    zeilen.push([T("about.factScope", "Umfang"),
      fill(T("about.scopeWert", "{n} Petitionen auf {m} Plattformen"),
           { n: nf.format(summe), m: pl.length })]);

    /* Datenquelle: state.baseAuto/baseWhy rechnet resolveBase() längst aus,
       gezeigt wurde es bisher nirgends — außer im ausgeblendeten
       Datenquellen-Umschalter (ZEIGE.datenquelle). */
    var q = state.baseAuto === "live" ? T("about.quelleLive", "Tagesaktuell von GitHub Pages")
          : state.baseAuto === "bundled" ? T("about.quellePaket", "Aus dem App-Paket")
          : T("about.quelleFest", "Fest eingestellt");
    /* Der Grund kommt NUR beim App-Paket dazu. Bei „live" ist er wortgleich
       mit der Beschriftung — beide stammen aus derselben Wendung —, und die
       Zeile las sich „Tagesaktuell von GitHub Pages (Tagesaktuell von GitHub
       Pages)". Am Zustand entschieden und nicht am Textvergleich: der ginge
       schief, sobald die Übersetzungen auseinanderlaufen. */
    if (state.baseAuto === "bundled" && baseWhyText())
      q += " (" + baseWhyText() + ")";
    zeilen.push([T("about.factSource", "Datenquelle"), q]);

    return '<dl class="pabout__facts">' + zeilen.map(function (z) {
      return "<dt>" + esc(z[0]) + "</dt><dd>" + esc(z[1]) + "</dd>";
    }).join("") + "</dl>";
  }

  function aboutPanel() {
    var box = el('<div class="aboutbox"></div>');
    [T("about.text", ""), T("about.dataNote", ""), T("about.disclaimer", "")]
      .forEach(function (t) {
        if (t) box.appendChild(el('<p class="aboutbox__p">' + esc(t) + "</p>"));
      });
    box.appendChild(el(aboutFakten()));
    /* Verweise. Das Impressum steht bewusst NICHT hier, sondern bleibt im
       Rechtsbereich unten auf der Liste — 1,5 KB Rechtstext ein zweites Mal
       im Code wäre genau die Dopplung, vor der dort schon gewarnt wird. */
    box.appendChild(el('<div class="aboutbox__links">' +
      '<a href="' + esc(GITHUB_URL) + '" target="_blank" rel="noopener">' +
      esc(T("about.linkCode", "Quellcode")) +
      ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>' +
      '<a href="' + esc(GITHUB_URL + "/blob/main/LICENSE") +
      '" target="_blank" rel="noopener">' +
      esc(T("about.linkLizenz", "Lizenz: GPL-3.0")) +
      ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>' +
      '<a href="' + esc(DASHBOARD_URL) + '" target="_blank" rel="noopener">' +
      esc(T("about.linkStatus", "Zustand der Quellen")) +
      ' <i class="fa-solid fa-arrow-up-right-from-square"></i></a>' +
      '<a href="mailto:' + esc(SUPPORT_MAIL) + '">' +
      esc(T("about.linkKontakt", "Kontakt")) +
      ' <i class="fa-solid fa-envelope"></i></a></div>'));
    return box;
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

  // "2026-07-20" → "20.07.2026", "2026" → "2026" (leer, wenn unbrauchbar)
  //
  // ⚠️ Der Jahres-Zweig ist kein Schönheitswunsch: seit dem 30.8.2026 liefert
  // europarl ein REINES Jahr, weil die Quelle nicht mehr hergibt (vorher stand
  // dort ein erfundener 1. Januar). Ohne diesen Zweig griffe der Regex nicht
  // und die Funktion gäbe "" zurück — die Petition zeigte dann GAR KEIN Datum
  // an, was wie ein fehlender Wert aussieht statt wie ein ungenauer.
  // Geprüft werden muss die Länge mit: /^\d{4}/ allein träfe auch "20260720".
  function fmtDate(iso) {
    var s = String(iso || "");
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[3] + "." + m[2] + "." + m[1];
    return /^\d{4}$/.test(s) ? s : "";
  }

  function fmtDateTime(iso) {
    var unbekannt = T("msg.timeUnknown", "Zeitpunkt unbekannt");
    if (!iso) return unbekannt;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return unbekannt;
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
      throw new Error(T("io.invalidBackup",
                        "Keine gültige PetitionsManager-Sicherung."));
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
    reader.onerror = function () {
      onDone(false, T("io.unreadable", "Datei nicht lesbar."));
    };
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
    titleEl.textContent = T("profile.title", "Profil");
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
      '<div class="welcome"><h1 class="welcome__t">' +
      esc(T("profile.title", "Profil")) + "</h1></div>";
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
      : [T("profile.impactFallback",
           "Jede Unterschrift macht ein Anliegen ein Stück sichtbarer.")];
    var impact = impacts[Math.floor(Date.now() / 86400000) % impacts.length];
    content.appendChild(el('<div class="impact">' +
      '<div class="impact__n">' + nf.format(total) + "</div>" +
      '<div class="impact__l">' +
        esc(total === 1 ? T("signed.countOne", "1 Petition")
                        : fill(T("signed.countMany", "{n} Petitionen"),
                               { n: nf.format(total) })) +
        " " + esc(T("profile.signedSuffix", "unterzeichnet")) + "</div>" +
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
        ? fill(T("signed.hitsOf", "{n} von {total} Treffern"),
               { n: rows.length, total: signedSorted.length })
        : (signedSorted.length === 1
            ? T("signed.countOne", "1 Petition")
            : fill(T("signed.countMany", "{n} Petitionen"),
                   { n: nf.format(signedSorted.length) }));
      if (!rows.length) {
        sList.appendChild(el('<div class="signed-empty"><p>' +
          fill(T("signed.noHits", "Keine Treffer für „{q}“."),
               { q: esc(state.signedQuery) }) + "</p></div>"));
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
          fakten += '<span class="sig" title="' +
            esc(T("petition.startTitle", "Start der Petition")) + '">' +
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
          '<span class="signed-item__signed">' +
            esc(T("signed.signedOn", "Unterschrieben am")) + " " +
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
      '<div class="io__lbl"><i class="fa-solid fa-database"></i> ' +
      esc(T("io.title", "Deine Daten sichern")) + "</div>" +
      '<div class="io__note">' + esc(T("io.note",
        "Favoriten, unterschrieben/archiviert, Plattform-Auswahl und " +
        "Einstellungen als Datei sichern oder wiederherstellen.")) + "</div>" +
      '<div class="io__btns"></div></div>');
    var ioBtns = io.querySelector(".io__btns");
    var ioNote = io.querySelector(".io__note");
    var exBtn = el('<button class="io__btn" type="button">' +
      '<i class="fa-solid fa-file-export"></i> ' +
      esc(T("io.exportBtn", "Exportieren")) + "</button>");
    var imBtn = el('<button class="io__btn io__btn--ghost" type="button">' +
      '<i class="fa-solid fa-file-import"></i> ' +
      esc(T("io.importBtn", "Importieren")) + "</button>");
    var fileIn = el('<input type="file" accept="application/json,.json" ' +
      'style="display:none">');
    exBtn.addEventListener("click", function () {
      exportData();
      ioNote.textContent = fill(T("io.exported",
        "✓ Sicherung exportiert ({fav} Favoriten, {sig} unterschrieben, " +
        "{arch} archiviert)."),
        { fav: state.favorites.size, sig: state.signed.size,
          arch: state.archived.size });
    });
    imBtn.addEventListener("click", function () { fileIn.click(); });
    fileIn.addEventListener("change", function () {
      if (!fileIn.files || !fileIn.files[0]) return;
      importData(fileIn.files[0], function (ok, res) {
        if (ok) {
          ioNote.textContent = fill(T("io.imported",
            "✓ Importiert: {fav} Favoriten, {sig} unterschrieben, " +
            "{arch} archiviert."),
            { fav: res.favoriten, sig: res.unterschrieben,
              arch: res.archiviert });
          io.classList.add("io--done");
        } else {
          ioNote.textContent = fill(T("io.importFailed",
            "Import fehlgeschlagen: {fehler}"), { fehler: res });
        }
      });
      fileIn.value = "";
    });
    ioBtns.appendChild(exBtn); ioBtns.appendChild(imBtn); ioBtns.appendChild(fileIn);
    content.appendChild(io);
  }

  // ---- Ersteinrichtung (Wizard) ----------------------------------------------
  /* Beim ersten Start: Begrüßung → Sprachen → Farbdesign+Layout → Plattformen
     → Benachrichtigungen+Bilder → Fertig. Liegt als Overlay über der App,
     damit auch die Fußleiste verdeckt ist.

     ⚠️ Am 12.8.2026 von drei auf fünf gezählte Schritte erweitert
     (Nutzerwunsch). Die Schrittzahl steckt an VIER Stellen in renderWizard():
     TOTAL, die Fortschrittspunkte, isLast und die Sperren am „Weiter"-Knopf.
     Sie hängen jetzt alle an TOTAL, damit ein sechster Schritt nicht wieder
     drei Zahlen von Hand nachzieht. */
  /* Auswahl während des Wizards.
       langs   – die in Schritt 1 gewählten Sprachen
       plats   – die angehakten Plattformen (das Ergebnis)
       gesehen – Sprachen, deren Plattformen schon einmal vorausgewählt wurden
       manuell – Plattformen, die der Nutzer SELBST an- oder abgetippt hat
     `manuell` ist der Vorrang-Vermerk: nur damit lässt sich „vom Sprachwechsel
     gesetzt" von „vom Nutzer entschieden" unterscheiden. Ohne ihn würde jeder
     Sprachwechsel die Handauswahl überfahren — und im Ausklapper wäre keine
     einzelne fremdsprachige Plattform dauerhaft mitzunehmen. */
  var wizardSel = { langs: null, plats: null, gesehen: null, manuell: null,
                   langsManuell: false,
                   /* Landachse (4.9.2026), Zwilling zu langs/langsManuell.
                      Bewusst ein EIGENES Feld und kein Anhängsel an langs:
                      Sprache und Land sind zwei Fragen, und sie zu vermengen
                      war genau der Fehler, der am 30.8.2026 elf deutsch-
                      sprachige Petitionen aus Österreich verwarf. */
                   lands: null, landsManuell: false };

  /* ⚠️ 11.8.2026 umgestellt (Nutzerentscheidung): Schritt 1 fragt nach der
     HAUPTSPRACHE einer Plattform, nicht mehr danach, welche Übersetzungen sie
     mitbringt. Vorher stand hier platLanguages(); „Englisch" umfasste damit
     sechs Plattformen, weil sechs englische Fassungen ihrer deutschen
     Petitionen anbieten.

     Der Grund für die Umstellung ist die geplante Richtung: Plattformen wie
     Avaaz oder Change.org sollen künftig je Sprache EINEN eigenen Eintrag
     bekommen (deutsch, englisch, später weitere). Sprache wird damit eine
     Auswahldimension über Plattform-EINTRÄGE — und die Frage „welche Sprache
     hat dieser Eintrag?" ist genau p.language. Übersetzungen bleiben davon
     unberührt: platLanguages() lebt weiter und trägt die zweite Flagge an der
     Kachel (siehe dort), nur die AUSWAHL hängt nicht mehr daran.

     Heute ergibt das: Deutsch = zehn Plattformen, Englisch = Europarl.
     platMainLanguage() steht oben bei platLanguages(), weil auch die
     Einstellungen danach gliedern. */
  function wizardLanguages() {
    var seen = {};
    livePlatforms().forEach(function (p) { seen[platMainLanguage(p)] = true; });
    return Object.keys(seen).sort(function (a, b) {
      return langRank(a) - langRank(b) || a.localeCompare(b);
    });
  }

  /* Vorbelegung der PLATTFORM-Sprache aus der OBERFLÄCHEN-Sprache
     (Nutzerwunsch 12.8.2026: „wer Englisch wählt, soll auch englisch
     vorausgewählte Plattformen bekommen, genauso bei Deutsch").

     Vorher stand hier fest „de", unabhängig davon, was auf dem
     Begrüßungsbildschirm gewählt wurde — wer auf Englisch umstellte, bekam
     trotzdem die deutschen Plattformen vorgeschlagen.

     ⚠️ Zwei verschiedene Sprachen, die man auseinanderhalten muss:
     state.prefs.lang ist die Sprache der OBERFLÄCHE, wizardSel.langs die der
     PLATTFORMEN. Sie fallen nur zufällig zusammen; deshalb der Abgleich gegen
     wizardLanguages(), das aus p.language kommt (platMainLanguage) und nicht
     aus den Übersetzungen.

     Rückfall, wenn es zur Oberflächensprache gar keine Plattform gibt: erst
     Deutsch, dann die erste vorhandene. Sonst stünde der Assistent mit einer
     leeren Auswahl da. */
  function wizardSprachvorwahl() {
    if (wizardSel.langsManuell) return;   // Handauswahl in Schritt 1 gewinnt
    var da = wizardLanguages();
    var ui = state.prefs.lang || STANDARDSPRACHE;
    var wahl = da.indexOf(ui) >= 0 ? ui
             : (da.indexOf("de") >= 0 ? "de" : da[0]);
    wizardSel.langs = new Set(wahl ? [wahl] : []);
    // Die Plattform-Vorauswahl muss neu greifen, sonst bliebe sie beim Alten.
    wizardSel.gesehen = new Set();
  }

  /* ---- Landachse im Assistenten (4.9.2026) --------------------------------
     Welche Länder stehen überhaupt zur Wahl? Abgeleitet aus dem, was die
     Einträge WIRKLICH führen — nie aus einer festen Liste, sonst stünde ein
     Land im Selektor, zu dem es keine einzige Petition gibt.

     ⚠️ Einträge mit scope "mehrere", deren Länderliste leer ist (heute
     openPetition und foodwatch), steuern hier NICHTS bei. Das ist richtig: sie
     lassen sich keinem Land zuordnen, also dürfen sie auch keins in die Liste
     bringen. Ausgeblendet werden sie deswegen trotzdem nicht — das entscheidet
     platPasstZuLand(). */
  /* Zählt dieser Eintrag für den Länderschritt mit?

     ⚠️⚠️ Nur, wenn seine Sprache in Schritt 1 gewählt wurde. Ohne diese
     Bedingung bot der Länderschritt am 4.9.2026 „Frankreich" an, obwohl nur
     Deutsch gewählt war — FR kommt einzig von `foodwatch_fr`, und der ist
     französischSPRACHIG. Wer Deutsch + Frankreich wählte, bekam eine LEERE
     Schnittmenge: kein einziger deutschsprachiger Eintrag führt FR.
     (Nutzerfrage: „gibt es für frankreich deutsch petitionen?" — nein.)

     Der Länderschritt kommt NACH dem Sprachschritt, die Auswahl steht hier
     also fest. Umgekehrt ginge es nicht. */
  function landRelevant(p) {
    if (!wizardSel.langs || !wizardSel.langs.size) return true;
    return wizardSel.langs.has(platMainLanguage(p));
  }

  /* Gehört dieser Eintrag unter diesen Länder-Chip?

     ⚠️ EINE Funktion für drei Verwendungen: die Chip-Liste, die Zahl am Chip
     und die Kacheln darunter. Drei Kopien derselben Bedingung wären drei
     Gelegenheiten, sie auseinanderlaufen zu lassen — und das fiele erst auf,
     wenn eine Zahl nicht zur Liste darunter passt.

     Die drei Zweige müssen sich zu ALLEN Einträgen ergänzen: ein Eintrag, der
     in keinen fällt, wäre unsichtbar und trotzdem dauerhaft angewählt. */
  function platGehoertZuLand(p, code) {
    if (!landRelevant(p)) return false;
    if (code === LAND_INTL) return platLandneutral(p);
    if (platLandneutral(p)) return false;
    var da = platCountries(p);
    if (code === LAND_UNERHOBEN) return !da.length;
    return da.indexOf(code) >= 0;
  }

  function wizardCountries() {
    var seen = {};
    livePlatforms().forEach(function (p) {
      if (!landRelevant(p)) return;
      if (platLandneutral(p)) { seen[LAND_INTL] = true; return; }
      var da = platCountries(p);
      /* Mehrländrig, aber ohne erhobenes Land: eigener Chip statt gar keiner.
         Vorher steuerten diese Einträge NICHTS bei — die Summe der Chips war
         dadurch kleiner als die Zahl der Plattformen (14 von 17), ohne dass
         irgendwo stand, wo die fehlenden geblieben sind. */
      if (!da.length) { seen[LAND_UNERHOBEN] = true; return; }
      da.forEach(function (c) { seen[c] = true; });
    });
    return Object.keys(seen).sort(function (a, b) {
      return landRank(a) - landRank(b) || a.localeCompare(b);
    });
  }

  /* Die Region des Geräts — anders als systemSprache(), die sie WEGWIRFT
     (`de-AT` → `de`). Genau dieser abgeschnittene Teil ist hier die Antwort:
     wer sein Gerät auf de-AT stehen hat, ist Österreicher und soll nicht
     Deutschland vorausgewählt bekommen. */
  function systemLand() {
    var liste = (navigator.languages && navigator.languages.length)
      ? navigator.languages : [navigator.language || ""];
    for (var i = 0; i < liste.length; i++) {
      var m = /^[a-z]{2,3}[-_]([A-Za-z]{2})$/.exec(String(liste[i] || ""));
      if (m) return m[1].toUpperCase();
    }
    return null;
  }

  /* Vorbelegung der Länderauswahl.

     ⚠️ „International" ist IMMER dabei. Ohne diese Zeile verlöre ein frisch
     eingerichteter Nutzer acht der 17 Einträge (Avaaz, WeMove, Ekō, 350.org je
     de/en) — sie führen an der Quelle kein Land und fielen aus jeder Länder-
     auswahl heraus. Sie sind abwählbar, aber nicht versehentlich. */
  function wizardLandvorwahl() {
    if (wizardSel.landsManuell) return;   // Handauswahl im Landschritt gewinnt
    var da = wizardCountries();
    var region = systemLand();
    var wahl = [];
    /* ⚠️ Die Geräteregion zählt nur, wenn sie auch Bestand hat. Ohne die
       zweite Bedingung genügte EINE australische Petition, damit ein Gerät mit
       australischer Region die ganze Einrichtung auf Australien stellt — und
       der Nutzer sähe eine fast leere App, ohne zu wissen warum. */
    if (region && da.indexOf(region) >= 0 && landBestand(region) >= LAND_MINDEST)
      wahl.push(region);
    else if (da.indexOf("DE") >= 0) wahl.push("DE");
    if (da.indexOf(LAND_INTL) >= 0) wahl.push(LAND_INTL);
    /* Ebenfalls vorausgewählt, aus demselben Grund wie „Ohne Landangabe":
       sonst verlöre ein frisch eingerichteter Nutzer openPetition mit 2.140
       Petitionen, nur weil wir deren Land nicht erhoben haben. */
    if (da.indexOf(LAND_UNERHOBEN) >= 0) wahl.push(LAND_UNERHOBEN);
    // Rückfall: gäbe es weder die Region noch DE noch International, stünde der
    // Assistent mit leerer Auswahl und totem „Weiter" da.
    if (!wahl.length && da.length) wahl.push(da[0]);
    wizardSel.lands = new Set(wahl);
    wizardSel.gesehen = new Set();
  }

  function startWizard() {
    state.wizardStep = 0;
    wizardSel.langsManuell = false;
    wizardSel.landsManuell = false;
    wizardSprachvorwahl();
    wizardLandvorwahl();
    wizardSel.plats = new Set(state.enabled === null
      ? livePlatforms().map(function (p) { return p.key; })
      : Array.from(state.enabled));
    wizardSel.gesehen = new Set();   // Sprachen, deren Plattformen schon vorausgewählt wurden
    wizardSel.manuell = new Set();   // von Hand an-/abgetippte Plattformen
    renderWizard();
    wizardEintragLegen();
  }

  /* ---- Zurücktaste im Assistenten (11.8.2026) -----------------------------
     Vorher schloss ein Rückschritt den Assistenten sofort — aus Schritt 3
     heraus war die halbe Einrichtung weg. Jetzt geht die Zurücktaste Schritt
     für Schritt zurück und schließt erst auf dem Begrüßungsbildschirm.

     ⚠️ Umgesetzt mit GENAU EINEM History-Eintrag, der bei jedem abgefangenen
     Rückschritt erneuert wird — nicht mit einem Eintrag je Schritt. Ein
     Eintrag je Schritt wäre naheliegender, hinterließe beim „Überspringen"
     aber drei tote Einträge: die Zurücktaste täte danach dreimal scheinbar
     nichts, bevor die App reagiert.

     wizardEintrag sagt, ob unser Eintrag noch auf dem Stapel liegt. Ohne
     dieses Wissen ließe sich „der Browser hat ihn gerade verbraucht" (popstate)
     nicht von „wir räumen ihn selbst ab" (Überspringen/Fertig) unterscheiden,
     und einer der beiden Fälle würde doppelt zurückgehen. */
  var wizardEintrag = false;      // liegt unser History-Eintrag noch auf dem Stapel?
  var wizardRuecknahme = false;   // true, während closeWizard() ihn selbst abräumt

  function wizardEintragLegen() {
    try { history.pushState({ pmWizard: true }, ""); wizardEintrag = true; }
    catch (e) { /* ohne History-API bleiben die Knöpfe im Assistenten */ }
  }

  /* zielListe=false lässt die Ansicht stehen, aus der der Assistent geöffnet
     wurde. Das gilt für GENAU EINEN Ausgang: die Zurücktaste auf dem
     Begrüßungsbildschirm. „Zurück" heißt zurück — dort auf die Liste zu
     springen wäre keine Rücknahme, sondern eine neue Navigation.

     Alle anderen Ausgänge sind ein ABSCHLUSS und führen auf die Liste
     (Nutzerwunsch 12.8.2026): Fertig, Überspringen und der Import. Wer den
     Assistenten aus den Einstellungen heraus geöffnet hatte, landete sonst
     wieder in den Einstellungen und bekam von seiner frischen Auswahl nichts
     zu sehen.

     goHome() statt nur state.tab: es räumt zusätzlich Plattform-, Kategorie-
     und Tag-Filter weg. Nach einer neuen Plattform-Auswahl wäre ein noch
     stehender Filter aus der Zeit davor das Erste, was man sieht — und er
     könnte auf eine Plattform zeigen, die man gerade abgewählt hat. */
  function closeWizard(save, zielListe) {
    if (save) {
      state.enabled = new Set(wizardSel.plats);
      saveEnabled();
    }
    state.prefs.wizardDone = true;
    savePrefs();
    var ov = document.getElementById("wizard");
    if (ov) ov.remove();
    document.body.classList.remove("wizard-open");
    /* Eigenen Eintrag abräumen, wenn er noch steht (Überspringen/Fertig).
       Sonst bräuchte die Zurücktaste danach einen Leerschritt, bevor sie die
       App überhaupt erreicht. Kommt der Aufruf AUS popstate, ist der Eintrag
       schon verbraucht und wizardEintrag steht auf false — dann passiert hier
       nichts, und genau darum geht es. */
    if (wizardEintrag) {
      wizardEintrag = false;
      wizardRuecknahme = true;
      try { history.back(); } catch (e) { wizardRuecknahme = false; }
    }
    // goHome() zeichnet selbst und scrollt nach oben – kein zweites render().
    if (zielListe === false) render();
    else goHome();
  }

  function renderWizard() {
    var old = document.getElementById("wizard");
    if (old) old.remove();
    document.body.classList.add("wizard-open");

    /* Gezählte Schritte OHNE die Begrüßung (die trägt keine Punkte):
       1 Sprachen · 2 Länder · 3 Farbdesign+Layout · 4 Plattformen ·
       5 Benachrichtigungen+Bilder · 6 Fertig.

       ⚠️ 4.9.2026 von 5 auf 6: der Länderschritt ist dazwischengerutscht, und
       damit haben sich die Nummern ALLER folgenden Schritte verschoben. Die
       Zweige unten hängen an `step === n` — wer hier eine Zahl ändert, muss
       jede einzelne mitziehen, auch die beiden Sperren am „Weiter"-Knopf ganz
       unten (Sprachen bei 1, Länder bei 2, Plattformen bei 4). */
    var TOTAL = 5;
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

  /* ---- Plattformauswahl (4.9.2026 aus Schritt 4 hierher gezogen) ---------
     Nutzerwunsch: "schritt 4 soll wegfallen und in schritt 2 aufgenommen
     werden (aufklapper)". Der Rumpf ist unveraendert uebernommen; die
     Parameter heissen deshalb weiter `main` und `foot`.

     Sinn der Zusammenlegung: Land und Plattformen sind DIESELBE Frage in zwei
     Schaerfegraden — "woher" und "von wem genau". Wer die Vorauswahl
     akzeptiert, klappt gar nicht erst auf. */
  function plattformAuswahl(foot) {
      /* ---- Gliederung nach Sprache (Nutzerwunsch 11.8.2026) ---------------
         Schritt 2 FILTERT die anderen Sprachen nicht mehr weg, sondern legt
         sie eine Ebene tiefer: die in Schritt 1 gewählten Sprachen stehen
         oben und offen, alle übrigen darunter als eingeklappte Ausklapper,
         nach Sprache sortiert. Erreichbar bleibt damit alles — wer eine
         einzelne fremdsprachige Plattform mitnehmen will, muss nicht erst
         zurück in Schritt 1.

         Jede Gruppe trägt ihren Flaggenkreis (.flag, dieselbe runde Blende
         wie in der Hauptliste): ohne ihn liefen die Kacheln optisch in einem
         Block durch, und die Trennung wäre nur an der Überschrift zu ahnen. */
      var gruppen = {};
      livePlatforms().forEach(function (p) {
        var c = platMainLanguage(p);
        (gruppen[c] = gruppen[c] || []).push(p);
      });
      Object.keys(gruppen).forEach(function (c) {
        gruppen[c].sort(function (a, b) {
          return a.name.localeCompare(b.name, "de"); });
      });
      var nachRang = function (a, b) {
        return langRank(a) - langRank(b) || a.localeCompare(b); };
      var codesAn  = Object.keys(gruppen).filter(function (c) {
        return wizardSel.langs.has(c); }).sort(nachRang);
      var codesAus = Object.keys(gruppen).filter(function (c) {
        return !wizardSel.langs.has(c); }).sort(nachRang);

      /* Die Auswahl an die Sprachwahl angleichen — symmetrisch, und in beide
         Richtungen mit Vorrang für die Handauswahl (wizardSel.manuell).

         Nach oben: eine NEU gewählte Sprache bringt ihre Plattformen mit.
         Ohne das stünde ihre Gruppe zwar offen, aber vollständig abgehakt —
         wer in Schritt 1 Englisch dazunimmt, bekäme das Europaparlament
         angezeigt und trotzdem nicht geliefert, obwohl der Text darüber
         „alle sind vorausgewählt" verspricht.

         Nach unten: eine NICHT gewählte Sprache nimmt ihre Plattformen aus der
         Auswahl. Das muss ohne `gesehen` auskommen, weil die Startbelegung
         gar nicht aus einem Sprachwechsel stammt: startWizard() legt beim
         ersten Start ALLE Plattformen an. Genau daran ist eine frühere Fassung
         gescheitert — Europarl blieb angehakt, obwohl nur Deutsch gewählt war. */
      wizardSel.langs.forEach(function (c) {
        if (wizardSel.gesehen.has(c)) return;
        wizardSel.gesehen.add(c);
        (gruppen[c] || []).forEach(function (p) {
          if (!wizardSel.manuell.has(p.key) &&
              platPasstZuLand(p, wizardSel.lands)) wizardSel.plats.add(p.key);
        });
      });
      Object.keys(gruppen).forEach(function (c) {
        if (wizardSel.langs.has(c)) return;
        wizardSel.gesehen["delete"](c);
        gruppen[c].forEach(function (p) {
          if (!wizardSel.manuell.has(p.key)) wizardSel.plats["delete"](p.key);
        });
      });
      /* Dasselbe für die Landachse, und zwar QUER zu den Sprachgruppen: ein
         abgewähltes Land nimmt seine Plattformen aus der Auswahl, egal in
         welcher Sprachgruppe sie stehen. Ohne diesen Block wäre der
         Länderschritt bloße Zierde — die Kacheln blieben angehakt.

         ⚠️ Die Gegenrichtung („Land dazugewählt → Plattformen dazu") steckt
         schon oben: der Klick auf einen Landchip setzt wizardSel.gesehen
         zurück, womit die Sprachschleife erneut greift und ihr `platPasstZuLand`
         diesmal wahr wird. Ein zweiter Block hier würde die Handauswahl doppelt
         überfahren. */
      livePlatforms().forEach(function (p) {
        if (wizardSel.manuell.has(p.key)) return;
        if (!platPasstZuLand(p, wizardSel.lands)) wizardSel.plats["delete"](p.key);
      });
      /* ⚠️ Sicherheitsnetz: bleibt NICHTS ausgewählt, die gewählten Sprachen
         wieder vorauswählen. Sonst stünde ein deaktiviertes „Weiter" da, ohne
         dass irgendwo steht, warum — dieselbe Sackgasse, die die Sperre an
         den Kacheln gerade beseitigt hat, nur eine Ecke weiter.
         ⚠️ Auch hier gilt die Landwahl mit: ohne sie holte das Netz genau die
         Plattformen zurück, die der Block darüber gerade entfernt hat, und die
         Länderwahl wäre bei leerer Auswahl still wirkungslos. */
      if (!wizardSel.plats.size)
        codesAn.forEach(function (c) {
          gruppen[c].forEach(function (p) {
            if (platPasstZuLand(p, wizardSel.lands)) wizardSel.plats.add(p.key);
          }); });
      /* Letzte Reihe: passt zur Landwahl NICHTS, wäre die Auswahl trotz beider
         Netze leer. Dann gilt die Sprachwahl allein — lieber zu viel zeigen als
         den Nutzer in einem toten „Weiter" sitzen zu lassen. */
      if (!wizardSel.plats.size)
        codesAn.forEach(function (c) {
          gruppen[c].forEach(function (p) { wizardSel.plats.add(p.key); }); });

      /* Eine Kachel bauen. Steckt in einer Funktion, weil sie in beiden
         Bereichen gebraucht wird (oben offen, unten im Ausklapper) — zwei
         Kopien liefen beim nächsten Eingriff auseinander. */
      function wizPlatRow(p) {
        var on = wizardSel.plats.has(p.key);
        var color = platColor(p.key);
        var row = el('<button class="wplat' + (on ? " on" : "") + '" type="button"' +
          (color ? ' style="--brand:' + esc(color) + '"' : "") + ">" +
          platLogo(p.key, p.name) +
          '<span class="wplat__body"><span class="wplat__n">' + esc(p.name) +
          "</span><span class=\"wplat__m\">" +
          esc(fill(T("wizard.platCount", "{n} Petitionen"),
                   { n: nf.format(p.online) })) +
          /* Das Landzeichen sitzt IN der Meta-Zeile, nicht als eigene Zeile:
             die Kachel trägt schon Logo, Name und Zahl, eine vierte Zeile
             hätte die Liste auf mobilen Geräten unnötig gestreckt.
             null = das Manifest führt die Landachse noch nicht (siehe dort). */
          /* ⚠️ Bei MEHRLÄNDRIGEN Einträgen KEINE Flaggenkette. platLandZeichen()
             reiht sonst alle Länder aneinander — bei openPetition zehn Stück
             („🇦🇹🇦🇺🇧🇪🇨🇭🇩🇪🇪🇸🇭🇷…"), und das an einer Kachel, die ohnehin unter
             ihrem Land steht. Die Zahl darunter sagt dasselbe lesbar. */
          (function (z) {
            if (!z || (!platLandneutral(p) && platCountries(p).length > 1))
              return "";
            return '<span class="wplat__land" title="' + esc(z.titel) +
                   '">' + z.text + "</span>";
          })(platLandZeichen(p)) +
          /* ⚠️ Hinweis bei MEHRLÄNDRIGEN Einträgen (4.9.2026). Seit die
             Kacheln unter ihrem Land stehen, erscheint openPetition unter
             ZEHN Ländern — dieselbe Kachel, derselbe Schlüssel. Ein Klick
             wählt sie deshalb überall zugleich ab, und ohne diesen Satz wäre
             das eine böse Überraschung. Steht nur an der Kachel, nicht am
             Chip: die Zahl am Chip zählt Einträge, nicht Länder. */
          /* ⚠️ Einzahl und Mehrzahl getrennt. „auch in 1 weiteren Ländern"
             stand am 4.9.2026 wirklich so da (foodwatch, zwei Länder) — eine
             Zahl in einen festen Satz zu schieben geht bei 1 schief. */
          (function (n) {
            if (n <= 1) return "";
            var rest = n - 1;
            return '<span class="wplat__mehr">' + esc(fill(
              rest === 1 ? T("wizard.land.auchIn1", "auch in einem weiteren Land")
                         : T("wizard.land.auchIn", "auch in {n} weiteren Ländern"),
              { n: rest })) + "</span>";
          })(platLandneutral(p) ? 0 : platCountries(p).length) +
          "</span></span>" +
          '<span class="wplat__check"><i class="fa-solid fa-check"></i></span>' +
          "</button>");
        row.addEventListener("click", function () {
          /* Dieselbe Sperre wie bei den Sprachen eine Ebene höher: die LETZTE
             angewählte Plattform bleibt an, sonst deaktiviert sich „Weiter"
             und die Einrichtung sitzt fest. Hier ist die Sackgasse leichter
             zu erreichen als bei den Sprachen — es sind alle vorausgewählt,
             und wer sich seine eine Plattform heraussucht, wählt der Reihe
             nach ab und trifft dabei zwangsläufig die letzte.
             ⚠️ Die Sperre zählt über ALLE Gruppen, nicht je Gruppe: die letzte
             deutsche Plattform darf abgewählt werden, solange oben oder im
             Ausklapper noch eine andere an ist. Maßgeblich ist, was am Ende
             gespeichert wird, und das ist wizardSel.plats als Ganzes.
             ⚠️ Nicht mit den Schleifen oben verwechseln: die schalten
             Plattformen bei einem SPRACHWECHSEL um und dürfen dabei bis auf
             null leeren — das Sicherheitsnetz dort fängt es ab. */
          if (wizardSel.plats.has(p.key)) {
            if (wizardSel.plats.size <= 1) {
              row.classList.remove("wplat--locked");
              void row.offsetWidth;             // Neustart der Animation erzwingen
              row.classList.add("wplat--locked");
              return;
            }
            wizardSel.plats["delete"](p.key);
          } else wizardSel.plats.add(p.key);
          /* Ab jetzt gilt für diese Plattform die Entscheidung des Nutzers,
             nicht mehr die Sprachwahl. Auch beim ABWÄHLEN vermerken: sonst
             hakte ein Sprachwechsel sie wieder an. */
          wizardSel.manuell.add(p.key);
          row.classList.toggle("on", wizardSel.plats.has(p.key));
          foot.querySelector(".wiz__next").disabled = !wizardSel.plats.size;
        });
        row.addEventListener("animationend", function () {
          row.classList.remove("wplat--locked");
        });
        return row;
      }

      /* Eine Sprachgruppe. Machart und Kopfzeile kommen aus langSection() —
         demselben Bauteil, das die Einstellungen benutzen. Hier kommt nur
         .wiz__plats dazu, das die Kacheln als Spalte mit Abstand setzt. */
      /* ⚠️ 4.9.2026: die Gliederung nach SPRACHE ist hier entfallen. Die
         Kacheln stehen jetzt unter dem jeweiligen Länder-Button (Nutzerwunsch
         „die plattformen sollen direkt unter dem Button des Landes stehen").
         Was BLEIBT, ist alles oberhalb: die Vorbelegung aus Sprache und Land
         und die drei Sicherheitsnetze. Sie müssen laufen, egal wie gezeichnet
         wird — deshalb baut diese Funktion kein DOM mehr, sondern liefert nur
         den Kachelbauer zurück. */
      return wizPlatRow;
  }

    if (step === 0) {
      main.appendChild(el('<div class="wiz__hero">' +
        '<div class="wiz__mark"><i class="fa-solid fa-hand-holding-heart"></i></div>' +
        '<h1 class="wiz__title">' +
        esc(T("wizard.intro.title", "Willkommen im PetitionsManager")) + "</h1>" +
        '<p class="wiz__text">' +
        esc(T("wizard.intro.text",
              "Petitionen vieler Plattformen an einem Ort – such dir aus, " +
              "was du sehen möchtest.")) + "</p></div>"));

      /* OBERFLÄCHENSPRACHE auf dem Begrüßungsbildschirm (8.8.2026,
         Nutzerwunsch „bei der Einrichtung soll die Sprache ausgewählt werden
         können").

         Bewusst HIER und nicht als eigener Schritt: Der Assistent zählt
         TOTAL = 3, ein vierter Schritt hätte alle Nummern und die
         Fortschrittspunkte verschoben — viel Risiko für nichts. Vor allem
         aber gehört die Sprache VOR die erste Frage: Wer den Assistenten
         nicht lesen kann, soll ihn nicht erst durchklicken müssen, um ihn
         umzustellen. Vorbelegt ist sie mit der Systemsprache, die meisten
         tippen hier also gar nichts.

         ⚠️ NICHT verwechseln mit Schritt 1 („wizard.lang"): der fragt, welche
         PLATTFORM-Sprachen jemand sehen will (deutschsprachige, englisch-
         sprachige Petitionen) — eine ganz andere Frage. Die Namensähnlichkeit
         ist eine Falle; deshalb heißt dieser Block hier uiLang.

         renderWizard() nach der Wahl neu aufrufen, sonst bliebe der
         Assistent in der alten Sprache stehen, bis man weiterblättert. */
      var uiLang = el('<div class="wiz__langbar"></div>');
      SPRACHEN.forEach(function (s) {
        var an = (state.prefs.lang || STANDARDSPRACHE) === s.code;
        // Flagge im eigenen .flag-Span, wie im Sprachumschalter der
        // Einstellungen — sonst stünde hier ein quer laufendes Emoji.
        var b = el('<button class="seg__b' + (an ? " on" : "") +
          '" type="button"><span class="flag">' + s.flagge + "</span> " +
          esc(s.name) + "</button>");
        b.addEventListener("click", function () {
          state.prefs.lang = s.code; savePrefs(); applyLayout();
          /* Die Plattform-Vorauswahl folgt der Oberflächensprache mit —
             es sei denn, in Schritt 1 wurde schon von Hand gewählt. */
          wizardSprachvorwahl();
          renderWizard();
        });
        uiLang.appendChild(b);
      });
      main.appendChild(uiLang);

      /* ---- Sicherung importieren statt einrichten (Nutzerwunsch 12.8.2026)
         „auf der ersten seite unter sprachen soll auch ein import button sein
         … der dann den Einrichtungsassistenten überspringt, weil alle
         informationen ja schon im import sind."

         Und genau so ist es: applyBackup() schreibt Plattform-Auswahl,
         Favoriten, unterschrieben/archiviert und prefs zurück — prefs trägt
         Sprache, Farbdesign, Layout und Benachrichtigungen. Jede Frage des
         Assistenten wäre danach eine Frage nach etwas, das schon
         beantwortet ist.

         ⚠️ closeWizard(FALSE), nicht true: true würde wizardSel.plats
         speichern — die Vorauswahl des Assistenten, die die eben
         eingespielte Plattform-Auswahl wieder überschriebe. Der Import hat
         state.enabled bereits gesetzt, hier ist nichts mehr zu sichern.
         Der Assistent gilt trotzdem als erledigt: das setzt closeWizard()
         unabhängig vom Argument.

         Die Rückmeldung bleibt bei einem FEHLER im Assistenten stehen, statt
         ihn zu schließen — eine fehlgeschlagene Datei darf nicht dazu
         führen, dass man ohne Einrichtung und ohne Erklärung in der App
         landet. */
      var imp = el('<div class="wiz__imp"><div class="wiz__imp-n">' +
        esc(T("wizard.importHint",
              "Du hast schon eine Sicherung? Dann übernehmen wir alles " +
              "daraus und du bist sofort fertig.")) + "</div></div>");
      var impNote = imp.querySelector(".wiz__imp-n");
      var impBtn = el('<button class="wiz__imp-b" type="button">' +
        '<i class="fa-solid fa-file-import"></i> ' +
        esc(T("wizard.importBtn", "Sicherung importieren")) + "</button>");
      var impFile = el('<input type="file" accept="application/json,.json" ' +
        'style="display:none">');
      impBtn.addEventListener("click", function () { impFile.click(); });
      impFile.addEventListener("change", function () {
        if (!impFile.files || !impFile.files[0]) return;
        var datei = impFile.files[0];
        // Vor dem Lesen leeren: sonst löst dieselbe Datei beim zweiten Anlauf
        // kein `change` mehr aus, und der Knopf wirkte kaputt.
        impFile.value = "";
        impBtn.disabled = true;
        importData(datei, function (ok, res) {
          impBtn.disabled = false;
          if (!ok) {
            imp.classList.add("wiz__imp--err");
            impNote.textContent = fill(T("io.importFailed",
              "Import fehlgeschlagen: {fehler}"), { fehler: res });
            return;
          }
          closeWizard(false);
        });
      });
      imp.appendChild(impBtn);
      imp.appendChild(impFile);
      main.appendChild(imp);

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
          return platMainLanguage(p) === code; }).length;
        var chip = el('<button class="chip' +
          (wizardSel.langs.has(code) ? " on" : "") + '" type="button">' +
          /* flag mit dazu: die runde Blende steckt in .flag (style.css),
             chip__flag trägt nur noch den Abstand im Chip. */
          '<span class="chip__flag flag">' + info.flag + "</span>" +
          '<span class="chip__l">' + esc(info.name) + "</span>" +
          '<span class="chip__n">' + n + "</span></button>");
        chip.addEventListener("click", function () {
          /* ⚠️ Mindestens EINE Sprache muss angewählt bleiben (Nutzerwunsch
             11.8.2026). Vorher ließ sich die letzte Sprache abwählen; „Weiter"
             wurde dann deaktiviert und die Einrichtung saß fest — der einzige
             Ausweg war „Zurück" oder „Überspringen", ohne dass irgendwo stand,
             warum es nicht weitergeht.

             Das ist keine Randlage: gerade liefert das Manifest bei ALLEN elf
             Plattformen nur `languages: ["de"]`, hier steht also ein einziger
             Chip. Ein Fehlklick darauf ist die Sackgasse. Die Sperre gilt
             deshalb für den letzten angewählten Chip, egal wie viele es sind.

             Statt still zu schlucken kurz rütteln (.chip--locked, CSS), sonst
             wirkt der Chip kaputt. Die Klasse wird am Ende der Animation
             wieder entfernt, damit ein zweiter Klick erneut rüttelt. */
          if (wizardSel.langs.has(code)) {
            if (wizardSel.langs.size <= 1) {
              chip.classList.remove("chip--locked");
              void chip.offsetWidth;            // Neustart der Animation erzwingen
              chip.classList.add("chip--locked");
              return;
            }
            wizardSel.langs["delete"](code);
          } else wizardSel.langs.add(code);
          // Ab jetzt gilt die Wahl des Nutzers, nicht mehr die Oberflächensprache.
          wizardSel.langsManuell = true;
          chip.classList.toggle("on", wizardSel.langs.has(code));
          foot.querySelector(".wiz__next").disabled = !wizardSel.langs.size;
        });
        chip.addEventListener("animationend", function () {
          chip.classList.remove("chip--locked");
        });
        lgrid.appendChild(chip);
      });
      main.appendChild(lgrid);
      main.appendChild(el('<p class="wiz__hint">' +
        esc(T("wizard.lang.hint", "Das lässt sich jederzeit ändern.")) + "</p>"));

    } else if (step === 2) {
      /* ---- Länder (Nutzerentscheidung 4.9.2026) ---------------------------
         Bewusst ein EIGENER Schritt neben der Sprache, nicht eine zweite Reihe
         Chips im Sprachschritt. Anlass war ein gemessener Fehler: Change.org
         verwarf elf von 60 deutschSPRACHIGEN Petitionen, weil sie aus AT, CL,
         IT, UA und IN kamen. Sprache und Land sind zwei Fragen — „deutsch /
         Deutschland" und „deutsch / Österreich" sind verschiedene Antworten,
         und ein gemeinsames Bedienelement legt nahe, dass sie es nicht sind.

         Der Chip „International" ist kein Land, sondern die ehrliche Antwort
         für die acht Einträge, deren Quelle die Größe Land gar nicht führt.
         Er steht deshalb hinten (landRank) und trägt ein eigenes Zeichen. */
      main.appendChild(el('<h1 class="wiz__title">' +
        esc(T("wizard.land.title", "Aus welchen Ländern?")) + "</h1>"));
      main.appendChild(el('<p class="wiz__text">' +
        esc(T("wizard.land.text",
              "Viele Plattformen sammeln über Ländergrenzen hinweg. Wähle, " +
              "welche Länder dich interessieren.")) + "</p>"));
      /* Einspaltig und volle Breite — das steckt seit 4.9.2026 in der
         Grundregel .wiz__chips und gilt für beide Auswahlschritte. */
      var cgrid = el('<div class="wiz__chips"></div>');
      /* ⚠️ Aufräumen, BEVOR gezeichnet wird: wer zurückgeht und die Sprache
         ändert, hat sonst Länder angewählt, die es nicht mehr gibt — die
         Auswahl wäre unsichtbar falsch, und der Plattformschritt filterte
         gegen etwas, das kein Chip mehr zeigt. Bleibt dabei nichts übrig,
         greift die Vorwahl erneut; sonst stünde ein totes „Weiter" da. */
      /* ⚠️⚠️ MUSS hier laufen, vor dem Zeichnen: plattformAuswahl() enthält
         die Vorbelegung aus Sprache und Land und drei Sicherheitsnetze gegen
         eine leere Auswahl. Sie liefert den Kachelbauer zurück; die Kacheln
         selbst hängt die Chip-Schleife unten unter ihr Land. */
      var platZeile = plattformAuswahl(foot);
      var landListe = wizardCountries();
      if (wizardSel.lands) {
        Array.from(wizardSel.lands).forEach(function (c) {
          if (landListe.indexOf(c) < 0) wizardSel.lands["delete"](c);
        });
      }
      if (!wizardSel.lands || !wizardSel.lands.size) {
        wizardSel.landsManuell = false;
        wizardLandvorwahl();
      }
      landListe.forEach(function (code) {
        var info = landInfo(code);
        // Zahl unter dem Chip: wie viele EINTRÄGE dieses Land führen. Nicht die
        // Petitionen — die stehen erst nach dem Laden der Pakete fest, und eine
        // Zahl, die sich beim Weiterklicken ändert, wäre schlimmer als keine.
        /* Die drei Zweige müssen JEDEN Eintrag erfassen — ein Eintrag, der in
           keinen fällt, wäre wieder unsichtbar und dauerhaft an.
           ⚠️ Die Summe der Chip-Zahlen ist dabei NICHT die Zahl der
           Plattformen. Ich hatte das am 4.9.2026 kurz als Kontrolle benutzt;
           sie galt nur, solange jeder Eintrag höchstens EIN Land führte. Seit
           openPetition zehn Länder mitbringt, zählt es in zehn Chips mit —
           richtig so, aber als Prüfgleichung wertlos. */
        var meine = livePlatforms().filter(function (p) {
          return platGehoertZuLand(p, code); });
        var n = meine.length;
        var chip = el('<button class="chip' +
          (wizardSel.lands.has(code) ? " on" : "") + '" type="button">' +
          '<span class="chip__flag flag">' + info.flag + "</span>" +
          '<span class="chip__l">' + esc(info.name) + "</span>" +
          '<span class="chip__n">' + n + "</span></button>");
        chip.addEventListener("click", function () {
          /* ⚠️ Dieselbe Sperre wie bei den Sprachen: der letzte angewählte Chip
             lässt sich nicht abwählen. Ohne sie säße die Einrichtung fest —
             „Weiter" wäre tot, und nirgends stünde, warum. Hier ist das keine
             Randlage, sondern der Normalfall: heute liefert das Manifest genau
             zwei Chips (Deutschland und International). */
          if (wizardSel.lands.has(code)) {
            if (wizardSel.lands.size <= 1) {
              chip.classList.remove("chip--locked");
              void chip.offsetWidth;            // Neustart der Animation erzwingen
              chip.classList.add("chip--locked");
              return;
            }
            wizardSel.lands["delete"](code);
          } else wizardSel.lands.add(code);
          // Ab jetzt gilt die Wahl des Nutzers, nicht mehr die Geräteregion.
          wizardSel.landsManuell = true;
          /* Die Plattform-Vorauswahl in Schritt 4 muss neu greifen: eine
             abgewählte Landgruppe darf ihre Plattformen nicht angehakt lassen.
             Ohne dieses Zurücksetzen bliebe die Auswahl beim Alten und der
             Länderschritt wäre folgenlos. */
          wizardSel.gesehen = new Set();
          chip.classList.toggle("on", wizardSel.lands.has(code));
          foot.querySelector(".wiz__next").disabled = !wizardSel.lands.size;
        });
        chip.addEventListener("animationend", function () {
          chip.classList.remove("chip--locked");
        });
        /* ---- Die Kacheln DIREKT unter ihrem Land (Nutzerwunsch 4.9.2026)
           „die plattformen sollen direkt unter dem Button des Landes stehen".

           ⚠️ Der Chip behält seine EINE Aufgabe: an- und abwählen. Das
           Auf- und Zuklappen liegt auf einem eigenen Knopf daneben. Beides auf
           denselben Chip zu legen hieße, dass ein Fehlgriff die Auswahl
           ändert, obwohl man nur nachsehen wollte. */
        var sek = el('<div class="wiz__landsek"></div>');
        var zeile = el('<div class="wiz__landzeile"></div>');
        var liste = el('<div class="wiz__landplats"></div>');
        meine.forEach(function (pl) { liste.appendChild(platZeile(pl)); });
        var auf = el('<button class="wiz__landauf" type="button" ' +
          'aria-expanded="false" aria-label="' +
          esc(fill(T("wizard.land.zeigen", "Plattformen für {land} zeigen"),
                   { land: info.name })) + '">' +
          '<i class="fa-solid fa-chevron-down"></i></button>');
        auf.addEventListener("click", function () {
          var jetzt = !sek.classList.contains("open");
          sek.classList.toggle("open", jetzt);
          auf.setAttribute("aria-expanded", jetzt ? "true" : "false");
        });
        zeile.appendChild(chip);
        zeile.appendChild(auf);
        sek.appendChild(zeile);
        sek.appendChild(liste);
        cgrid.appendChild(sek);
      });
      main.appendChild(cgrid);
      /* Zwei verschiedene Fußzeilen, und die Unterscheidung ist wichtiger als
         sie aussieht: „ein Chip, der nichts bewirkt" und „die Landangaben sind
         noch nicht geholt" sehen auf dem Schirm gleich aus, sind aber
         verschiedene Lagen. Schweigt der Schritt darüber, liest sich der zweite
         Fall wie ein kaputter Filter. */
      main.appendChild(el('<p class="wiz__hint">' + esc(manifestKenntLaender()
        ? T("wizard.land.hint", "Das lässt sich jederzeit ändern.")
        : T("wizard.land.nodata",
            "Die Landangaben kommen mit dem nächsten Datenlauf – bis dahin "
            + "steht hier nur „Weltweit“.")) + "</p>"));

    } else if (step === 3) {
      /* ---- Farbdesign + Layout (Nutzerwunsch 12.8.2026) -------------------
         „farbdesign und layout können zusammen abgefragt werden im
         assistenten" — beide beantworten dieselbe Frage („wie soll es
         aussehen?") und ändern beide nur ein Attribut an <html>. Der Effekt
         ist sofort sichtbar, weil der Assistent selbst aus denselben
         CSS-Variablen gezeichnet wird: man sieht die Wahl an der Seite, auf
         der man sie trifft.

         Gebaut aus DENSELBEN Bauteilen wie die Einstellungsseite
         (segControl, lblMitInfo) — deshalb wurden die beiden herausgezogen.
         Eine zweite Fassung der Schalterleiste wäre beim nächsten Eingriff
         auseinandergelaufen, und ausgerechnet hier fiele es nicht auf: den
         Assistenten sieht man genau einmal.

         Die AKZENTFARBE bleibt bewusst draußen. Sie wirkt nur im Magazin
         (alle 36 [data-accent]-Regeln hängen unter [data-layout="magazin"]),
         und eine Farbwahl, die je nach Layout eine Wirkung hat oder nicht,
         ist nichts für den ersten Start. In den Einstellungen steht sie
         weiter — dort blendet der Layout-Schalter sie passend um. */
      main.appendChild(el('<h1 class="wiz__title">' +
        esc(T("wizard.look.title", "Wie soll die App aussehen?")) + "</h1>"));
      main.appendChild(el('<p class="wiz__text">' +
        esc(T("wizard.look.text",
              "Wähle, was dir besser gefällt – beides lässt sich später " +
              "jederzeit umstellen.")) + "</p>"));

      /* Beide Erklärungen hinter dem Info-Symbol (Nutzerwunsch: „mit
         tooltips wie bei layout"). Auf der Einstellungsseite steht der
         Farbdesign-Hinweis noch offen, weil er dort ein Halbsatz zwischen
         zwei Leisten ist; hier sind es zwei Blöcke direkt untereinander,
         und offene Hinweistexte schöben den zweiten Schalter aus dem Bild. */
      var themeLbl = lblMitInfo(T("settings.themeLabel", "Farbdesign"),
        T("settings.darkModeHint",
          "„Automatisch“ folgt der Einstellung deines Geräts."));
      main.appendChild(themeLbl.lbl);
      main.appendChild(segControl(T("settings.themeLabel", "Farbdesign"),
        [["light", T("settings.themeLight", "Hell"), "fa-sun"],
         ["dark", T("settings.themeDark", "Dunkel"), "fa-moon"],
         ["auto", T("settings.themeAuto", "Auto"), "fa-circle-half-stroke"]],
        state.prefs.theme,
        function (v) { state.prefs.theme = v; savePrefs(); applyTheme(); }));
      main.appendChild(themeLbl.note);

      var layoutLbl2 = lblMitInfo(T("settings.layoutLabel", "Layout"),
        T("settings.layoutHint",
          "Ändert nur das Aussehen der Listen, nicht die Inhalte."));
      main.appendChild(layoutLbl2.lbl);
      main.appendChild(segControl(T("settings.layoutLabel", "Layout"),
        [["relief", T("settings.layoutRelief", "Relief"), "fa-cube"],
         ["magazin", T("settings.layoutMag", "Magazin"), "fa-image"]],
        state.prefs.layout,
        function (v) { state.prefs.layout = v; savePrefs(); applyLayout(); }));
      main.appendChild(layoutLbl2.note);

    } else if (step === 4) {
      /* ---- Benachrichtigungen + Bilder (Nutzerwunsch 12.8.2026) -----------
         Die letzten beiden Fragen vor dem Schlussbild. Beide kosten den
         Nutzer etwas — die eine eine Systemfreigabe, die andere
         Datenvolumen —, deshalb stehen sie hier und nicht versteckt in den
         Einstellungen: wer sie beim ersten Start bewusst beantwortet, wird
         später nicht überrascht.

         ⚠️ Der Schalter fragt die Android-Freigabe wirklich an
         (notifyRequest im Schalter von renderNotifyBox). Das ist gewollt:
         eine Zusage, die erst beim nächsten App-Start eingeholt wird, käme
         ohne jeden Zusammenhang. */
      main.appendChild(el('<h1 class="wiz__title">' +
        esc(T("wizard.extras.title", "Zwei Kleinigkeiten noch")) + "</h1>"));
      main.appendChild(el('<p class="wiz__text">' +
        esc(T("wizard.extras.text",
              "Beides ist freiwillig und jederzeit umstellbar.")) + "</p>"));

      /* Erklärungen hinter dem Info-Symbol, wie beim Layout (ausdrücklicher
         Nutzerwunsch). Bei den Bildern trägt der ⓘ-Text bewusst etwas
         ANDERES als die Zeile darunter: die Zeile sagt, was gerade
         passiert (und wechselt mit dem Schalter), der ⓘ-Text sagt, warum es
         die Option überhaupt gibt. */
      var notLbl = lblMitInfo(T("settings.sections.notify", "Benachrichtigungen"),
        T("wizard.notifyInfo",
          "Einmal am Tag eine kurze Info über neue Petitionen deiner " +
          "Plattformen. Dein Gerät fragt dafür einmalig um Erlaubnis. " +
          "Es werden dabei keine Daten verschickt – die App zählt nur, was " +
          "sie ohnehin schon geladen hat."));
      main.appendChild(notLbl.lbl);
      main.appendChild(notLbl.note);
      // ohne die eigene Einleitungszeile: die steht hier im ⓘ-Text.
      main.appendChild(renderNotifyBox(true));

      /* ⚠️ Die Überschrift heißt „Bilder", NICHT „Bilder in Beschreibungen
         laden": die Zeile darunter trägt den vollen Namen bereits, und beides
         untereinander las sich wie ein Fehler (am 12.8.2026 im Prüfstand
         gesehen — derselbe Doppelbefund wie zuvor bei „Plattformen" in den
         Einstellungen). Die beiden Überschriften dieser Seite wirken als
         Abschnittsköpfe, genau wie setSection() in den Einstellungen. */
      var imgLbl = lblMitInfo(T("wizard.imagesLabel", "Bilder"),
        T("wizard.imagesInfo",
          "Die Plattformen betten unverkleinerte Pressebilder in ihre " +
          "Aufruftexte ein – einzelne sind über 17 MB groß. Die App kann sie " +
          "nicht verkleinern, weil sie mitten im Text stecken; abschalten " +
          "ist der einzige Weg, Datenvolumen zu sparen."));
      main.appendChild(imgLbl.lbl);
      main.appendChild(imgLbl.note);
      main.appendChild(bilderZeile(true));   // kurzer Zustandstext, s. ⓘ oben

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
    // Auf dem Schlussbild kein „Zurück" — dort steht nur noch „Los geht's".
    if (step > 0 && step < TOTAL) {
      var back = el('<button class="wiz__back" type="button">' +
        '<i class="fa-solid fa-chevron-left"></i> ' +
        esc(T("wizard.back", "Zurück")) + "</button>");
      back.addEventListener("click", function () {
        /* Bewusst über history.back(): dann gehen Bildschirm-Knopf und
           Zurücktaste des Telefons durch dieselbe Stelle (popstate), und der
           History-Eintrag wird dabei richtig verbraucht und erneuert. Ein
           eigener Rückweg hier hätte den Stapel mit jedem Klick wachsen
           lassen — man müsste danach so oft zurückdrücken, wie man geklickt
           hat. Ohne History-API bleibt der direkte Weg als Rückfallebene. */
        if (wizardEintrag) { history.back(); return; }
        state.wizardStep--; renderWizard();
      });
      foot.appendChild(back);
    }
    var isLast = step === TOTAL;
    var nextLabel = step === 0 ? T("wizard.intro.cta", "Los geht's")
                  : isLast     ? T("wizard.finish", "Los geht's")
                               : T("wizard.next", "Weiter");
    var next = el('<button class="wiz__next" type="button">' + esc(nextLabel) +
      ' <i class="fa-solid fa-arrow-right"></i></button>');
    /* Die drei Auswahlschritte lassen sich nicht leer verlassen. Die
       Sperren an den Kacheln selbst verhindern das schon (mindestens eine
       Sprache, ein Land, eine Plattform) — das hier ist die zweite Reihe
       für den Fall, dass die Auswahl aus einem Sprachwechsel leer hervorgeht.
       ⚠️ Schrittnummern: 1 = Sprachen, 2 = Länder, 4 = Plattformen. Seit dem
       Länderschritt (4.9.2026) ist die Plattformzahl von 3 auf 4 gerückt —
       diese Zeile stand vorher auf 3 und hätte lautlos den falschen Schritt
       gesperrt: „Weiter" wäre im Farbdesign-Schritt tot gewesen. */
    if ((step === 1 && !wizardSel.langs.size) ||
        (step === 2 && (!wizardSel.lands.size || !wizardSel.plats.size)))
      next.disabled = true;
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
        ph.textContent = T("offline.imageMissing",
                           "Bild – ohne Internet nicht verfügbar");
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
    /* Unser eigener Rückschritt aus closeWizard() – der Eintrag ist schon
       abgeräumt, die Ansicht steht. Nichts weiter tun, sonst ginge die App
       eine Ebene zu weit zurück. */
    if (wizardRuecknahme) { wizardRuecknahme = false; return; }

    /* Liegt die Ersteinrichtung über der App, gilt der Rückweg zuerst ihr:
       sonst navigierte die App unter einem Fenster, das sichtbar stehen
       bleibt. Innerhalb des Assistenten geht es SCHRITT FÜR SCHRITT zurück
       (Nutzerwunsch 11.8.2026) und erst auf dem Begrüßungsbildschirm zu.
       Den nötigen Eintrag legt startWizard() an, erneuert wird er hier. */
    if (document.getElementById("wizard")) {
      wizardEintrag = false;          // den hat der Browser gerade verbraucht
      if (state.wizardStep > 0) {
        state.wizardStep--;
        renderWizard();
        wizardEintragLegen();         // damit die nächste Zurücktaste wieder hier landet
        return;
      }
      // Zurücktaste auf dem Begrüßungsbildschirm: zurück, wo man herkam —
      // NICHT auf die Liste. Der einzige Ausgang mit zielListe=false.
      closeWizard(false, false);
      return;
    }
    var s = e.state && e.state.pmNav;
    if (!s) return;           // fremder oder leerer Eintrag – nicht anfassen
    navZurueck = true;
    navAnwenden(s);
    render();
    navZurueck = false;
  });

  /* ---- Nachfrage vor dem Beenden (11.8.2026) --------------------------------
     Am Ende des Verlaufs fragt MainActivity.onBackPressed() hier nach, statt
     die App sofort zu schließen. Rückgabe `true` heißt „ich übernehme" — dann
     beendet Java NICHT.

     Bewusst KEIN window.confirm(): ein eigener Dialog spricht die in den
     Einstellungen gewählte Sprache, trägt beide Layouts mit und nennt keine
     Herkunfts-URL. Der Systemdialog kann das alles nicht.
     ⚠️ Nicht etwa, weil window.confirm im WebView nicht ginge — es geht (am
     Quelltext von WebViewContentsClientAdapter geprüft: liefert onJsConfirm
     false, zeigt der WebView seinen eigenen Dialog). Es ist eine Entscheidung
     für die Gestaltung, kein Ausweichen vor einem Fehler.

     ⚠️ Steht der Dialog schon, liefert die Funktion `false` — dann beendet
     Java. Das ist die übliche Android-Geste „zweimal Zurück zum Beenden", und
     der Text im Dialog kündigt sie an. Ohne diese Regel käme man mit der
     Zurücktaste allein nie aus der App: sie öffnete und schlösse den Dialog
     immer abwechselnd. */
  /* ---- Der Nachfrage-Dialog, EINMAL --------------------------------------
     Benutzt von der Beenden-Nachfrage und von der Warnung vor „Alles
     zurücksetzen". Beide brauchen dieselbe Form: Überschrift, Erklärung, zwei
     Knöpfe. Zwei Kopien liefen beim nächsten Eingriff auseinander.

     `gefahr: true` färbt den bestätigenden Knopf in die Warnfarbe — für den
     zerstörerischen Fall. Ohne diesen Unterschied sähen „App beenden" (nichts
     geht verloren) und „Alles löschen" (alles geht verloren) gleich aus.

     Es steht immer HÖCHSTENS EINER offen: `qboxOffen()` beantwortet das, und
     die Zurücktaste braucht die Antwort (siehe beendenNachfrage). */
  var QBOX_ID = "pmquest";
  function qboxOffen() { return document.getElementById(QBOX_ID); }

  function qboxZu() {
    var d = qboxOffen();
    if (d) d.remove();
    document.removeEventListener("keydown", qboxTaste);
  }
  function qboxTaste(e) { if (e.key === "Escape") qboxZu(); }

  /* o = { titel, text, ja, nein, gefahr, onJa }. Liefert true, wenn geöffnet. */
  function qboxFragen(o) {
    qboxZu();                                  // nie zwei übereinander
    var ov = el('<div class="qbox" id="' + QBOX_ID +
      '" role="dialog" aria-modal="true">' +
      '<div class="qbox__in">' +
      '<h2 class="qbox__t">' + esc(o.titel) + "</h2>" +
      '<p class="qbox__x">' + esc(o.text) + "</p>" +
      '<div class="qbox__row"></div></div></div>');
    var reihe = ov.querySelector(".qbox__row");
    var nein = el('<button class="qbox__no" type="button">' +
      esc(o.nein) + "</button>");
    var ja = el('<button class="qbox__yes' + (o.gefahr ? " qbox__yes--danger" : "") +
      '" type="button">' + esc(o.ja) + "</button>");
    nein.addEventListener("click", qboxZu);
    ja.addEventListener("click", function () { qboxZu(); o.onJa(); });
    reihe.appendChild(nein); reihe.appendChild(ja);
    /* Daneben getippt = abbrechen. Der folgenreiche Weg braucht einen Treffer.
       Der Abbrechen-Knopf bekommt den Fokus, aus demselben Grund. */
    ov.addEventListener("click", function (e) { if (e.target === ov) qboxZu(); });
    document.addEventListener("keydown", qboxTaste);
    document.body.appendChild(ov);
    nein.focus();
    return true;
  }

  function beendenNachfrage() {
    /* ⚠️ Steht schon ein Dialog, entscheidet WELCHER:
         - die Beenden-Nachfrage selbst → `false`, Java beendet. Das ist die
           übliche Android-Geste „zweimal Zurück zum Beenden", und der Text im
           Dialog kündigt sie an. Ohne diese Regel käme man mit der Zurücktaste
           allein nie aus der App: sie öffnete und schlösse ihn abwechselnd.
         - eine ANDERE Nachfrage (etwa die Löschwarnung) → schließen und `true`.
           Sie ist das Oberste auf dem Schirm, also gilt der Rückweg ihr. Ohne
           diese Unterscheidung schlösse die Zurücktaste bei offener
           Löschwarnung die ganze App. */
    var offen = qboxOffen();
    if (offen) {
      if (offen.dataset.pmBeenden === "1") return false;
      qboxZu();
      return true;
    }
    qboxFragen({
      titel: T("beenden.title", "App beenden?"),
      text: T("beenden.text", "Du bist am Anfang. Noch einmal zurück schließt " +
              "den PetitionsManager."),
      nein: T("beenden.abbrechen", "Bleiben"),
      ja: T("beenden.ok", "Beenden"),
      onJa: function () {
        /* Im Browser gibt es die Brücke nicht — window.close() wirkt dort nur
           bei Fenstern, die ein Skript geöffnet hat. Dann bleibt es beim
           Schließen des Dialogs, statt einen Knopf anzubieten, der nichts tut. */
        if (window.AndroidApp && window.AndroidApp.beenden)
          window.AndroidApp.beenden();
      }
    });
    // Kennzeichen für den nächsten Rückschritt (siehe oben).
    qboxOffen().dataset.pmBeenden = "1";
    return true;
  }
  /* Der Name ist der Vertrag mit MainActivity.onBackPressed() — wird er hier
     geändert, beendet sich die App wieder ohne Nachfrage, ohne dass irgendwo
     ein Fehler auftaucht. */
  window.pmFrageBeenden = beendenNachfrage;

  // ---- Router ----------------------------------------------------------------
  function render() {
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === state.tab);
    });
    if (!state.manifest) { content.innerHTML =
      '<div class="empty">' + esc(T("msg.loading", "Lade Daten …")) +
      "</div>"; return; }
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
    var ansicht = state.cross
                ? T("mail.viewCrossSearch", "Suche über alle Plattformen")
                : state.platform
                ? fill(T("mail.viewPlatform", "Plattform {name}"),
                       { name: platformName(state.platform) })
                : state.tab === "einstellungen"
                ? T("nav.settings", "Einstellungen")
                : state.tab === "profil"
                ? T("profile.title", "Profil")
                : T("nav.overview", "Übersicht");
    var stand = state.manifest && state.manifest.generated_at
      ? String(state.manifest.generated_at).slice(0, 10)
      : T("mail.unknown", "unbekannt");
    var prefs = state.prefs || {};
    /* EIN Text mit Platzhaltern statt zehn verketteter Zeilen: „Ansicht:"
       und „Stand" stehen mitten im Satzbau der jeweiligen Sprache. */
    var text = fill(T("mail.bugBody",
      "Was hast du getan?\n\n\n" +
      "Was ist passiert?\n\n\n" +
      "Was hättest du erwartet?\n\n\n" +
      "--- Technische Angaben (helfen beim Suchen, gerne kürzen) ---\n" +
      "Ansicht: {ansicht}\n" +
      "Daten: {daten}, Stand {stand}\n" +
      "Darstellung: {darstellung}\n" +
      "Gerät: {geraet}\n"),
      { ansicht: ansicht,
        daten: state.baseAuto || state.baseSetting,
        stand: stand,
        darstellung: (prefs.theme || "?") + " / " + (prefs.layout || "?"),
        geraet: navigator.userAgent });
    var a = document.createElement("a");
    a.href = "mailto:" + SUPPORT_MAIL +
      "?subject=" + encodeURIComponent("[PetitionsManager] " +
        T("mail.bugSubject", "Fehlerbericht")) +
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
      content.innerHTML = '<div class="empty">' +
        T("msg.loadError", "Daten konnten nicht geladen werden.<br>" +
          "Prüfe die <b>Datenquelle</b> in den Einstellungen.") + "</div>";
    });
  }

  // Service Worker registrieren (PWA: installierbar + offline auf Android/iOS).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  /* Wiederaufnahme-Horcher. Am Modulende und nicht in boot(), damit sie genau
     einmal hängen — denselben Grund nennt reloadData() dafür, dass es nicht
     boot() ruft. */
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("pageshow", refreshIfStale);
  window.addEventListener("focus", refreshIfStale);

  boot();
})();
