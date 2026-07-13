"use strict";
/* Petitionen — Mobile-App (entkoppelt vom Server; lädt statische JSON-Daten).
   Datenquelle konfigurierbar über localStorage "dataBase" (Default ./data). */

(function () {
  var LS = window.localStorage;
  var DEFAULT_BASE = "./data";
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
    mainQuery: "",        // letzte Volltextsuche auf der Hauptseite
    cross: null,          // plattformübergreifende Suche {type,value,fromPlatform}
    openPetitionUrl: null,// nach Navigation diese Petition automatisch aufklappen
    archiveOpen: false,   // Archiv-Akkordion (Plattform-Detail) offen?
    offlineOpen: false    // Offline-Akkordion offen?
  };

  var content = document.getElementById("content");
  var titleEl = document.getElementById("topbar-title");

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

    // Volltextsuche über alle aktivierten Plattformen (Feld + Button).
    var searchRow = el('<form class="mainsearch" role="search">' +
      '<input class="mainsearch__in" type="search" ' +
      'placeholder="Alle Petitionen durchsuchen …" value="' +
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

    // Gruppen aufbauen: (1) Favoriten zuerst, (2) danach nach Sprache.
    var groupDefs = [];
    var favs = live.filter(function (p) { return isFav(p.key); });
    if (favs.length) groupDefs.push({ key: "__fav", label: "Favoriten", plats: favs });

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
  var SUPPORT_MAIL = "kontakt@petitionsmanager.app";   // Platzhalter-Adresse
  var SUPPORT_DONATE = "https://www.paypal.com/donate"; // Platzhalter-Spendenlink
  function supportSection() {
    var sec = el('<section class="support">' +
      '<div class="support__title"><i class="fa-solid fa-hand-holding-heart">' +
      "</i> Unterstütze PetitionsManager.</div>" +
      '<div class="support__acc"></div></section>');
    var acc = sec.querySelector(".support__acc");

    var items = [
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
       "Ideen, Übersetzungen oder einer Spende.",
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
        '<div class="support__body"><p>' + esc(it[2]) + "</p></div></div>");
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
          '<i class="fa-solid fa-heart"></i> Spenden</a>'));
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
    var body = el('<div class="acc-body"></div>');
    plats.forEach(function (p) { body.appendChild(platCard(p)); });
    acc.appendChild(head); acc.appendChild(body);
    groupEls.push({ key: openKey, el: acc });
    return acc;
  }

  function platCard(p) {
    var info = langInfo(p.language || "de");
    var newN = p["new"] || 0;
    var newLabel = newN > 0
      ? '<span class="plat__new">+' + nf.format(newN) + " neu</span>" : "";
    var card = el(
      '<button class="plat">' +
        '<span class="plat__body">' +
          '<span class="plat__name">' + esc(p.name) +
            '<span class="flag">' + info.flag + '</span></span>' +
          '<span class="plat__meta">' + nf.format(p.online) +
            " Petitionen" + newLabel + '</span>' +
        '</span>' +
        '<span class="plat__chev"><i class="fa-solid fa-chevron-right"></i></span>' +
      '</button>');
    card.addEventListener("click", function () {
      state.platform = p.key; state.search = "";
      state.catFilter = null; state.tagFilter = null; render();
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
    state.catFilter = null; state.tagFilter = null;
    state.openPetitionUrl = url;
    render();
  }

  // Ausklappbare Petitions-Karte (Akkordion) im Swipe-Wrapper.
  // Wischen rechts = als unterschrieben markieren, links = archivieren
  // (im Archiv: rechts = wiederherstellen). ctx.redraw() zeichnet die Liste neu.
  function petCard(r, ctx, platKey) {
    var wrap = el('<div class="pet-wrap"></div>');
    // Label des Rechts-Wischens: schon unterschrieben → Zurücksetzen.
    var leftLabel = isArchived(r.url) ? "Wiederherstellen"
      : (isSigned(r.url) ? "Zurücksetzen" : "Unterschrieben");
    var bg = el('<div class="pet-bg">' +
      '<span class="pet-bg__l"><i class="fa-solid fa-circle-check"></i> ' +
        leftLabel + "</span>" +
      '<span class="pet-bg__r">Archivieren <i class="fa-solid fa-box-archive"></i>' +
      "</span></div>");
    var pet = el('<div class="pet"></div>');
    pet.dataset.url = r.url || "";

    var sig = (typeof r.signatures === "number")
      ? '<span class="sig"><b>' + nf.format(r.signatures) + "</b> " +
        '<i class="fa-solid fa-pen"></i></span>' : "";
    var signedBadge = isSigned(r.url)
      ? '<span class="pet-signed"><i class="fa-solid fa-circle-check"></i>' +
        " unterschrieben</span>" : "";
    var thumb = r.image_url
      ? '<img class="pet__thumb" src="' + esc(r.image_url) + '" alt="" ' +
        "loading=\"lazy\" onerror=\"this.style.display='none'\">" : "";
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
        '<div class="pet__row">' + signedBadge + sig + "</div>" +
      "</div>" +
      '<span class="pet__toggle"><i class="fa-solid fa-chevron-down"></i></span>' +
      ext +
    "</div>");
    var body = el('<div class="pet__body"></div>');
    head.addEventListener("click", function (e) {
      if (e.target.closest(".pet__ext")) return;   // Extern-Link klappt nicht
      var open = pet.classList.toggle("open");
      if (open && !body.dataset.built) {
        buildPetBody(body, r, ctx); body.dataset.built = "1";
      }
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
        if (dx > 0) {                                 // Wisch rechts
          if (isArchived(r.url)) { setArchived(r.url, false); slideAndRedraw(1); }
          else {
            toggleSigned(r.url, { title: r.title, platform: platKey });
            reset(); ctx.redraw();
          }
        } else {                                      // Wisch links
          if (!isArchived(r.url)) { setArchived(r.url, true); slideAndRedraw(-1); }
          else reset();
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
        if (c.url === r.url || isArchived(c.url) ||
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

  function buildPetBody(body, r, ctx) {
    var h = "";
    if (r.image_url)
      h += '<img class="pet__img" src="' + esc(r.image_url) + '" alt="" ' +
        "loading=\"lazy\" onerror=\"this.style.display='none'\">";
    if (r.summary) h += "<h4>Kurzbeschreibung</h4><p>" + esc(r.summary) + "</p>";
    if (r.recipient) h += "<h4>Adressat</h4><p>" + esc(r.recipient) + "</p>";
    if (r.started_by) h += "<h4>Gestartet von</h4><p>" + esc(r.started_by) + "</p>";
    if (r.description_full)
      h += '<details class="descacc"><summary>' +
        '<span class="descacc__lbl"><i class="fa-solid fa-align-left"></i> ' +
        "Beschreibung</span>" +
        '<i class="fa-solid fa-chevron-down descacc__chev"></i></summary>' +
        '<div class="pet__desc">' + r.description_full + "</div></details>";
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

    // Ähnliche Petitionen plattformübergreifend suchen (asynchron nachladen).
    var simBox = hasTags ? body.querySelector(".pet__similar") : null;
    if (simBox) {
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

  function renderPlatformDetail(key) {
    content.innerHTML = "";
    var head = el('<div class="subhead">' +
      '<button class="backbtn"><i class="fa-solid fa-chevron-left"></i> ' +
        "Alle Plattformen</button>" +
      '<a class="archlink" href="#"><i class="fa-solid fa-box-archive"></i> ' +
        "Zum Archiv</a></div>");
    head.querySelector(".backbtn").addEventListener("click", function () {
      state.platform = null;
      state.catFilter = null; state.tagFilter = null; render();
    });
    head.querySelector(".archlink").addEventListener("click", function (e) {
      e.preventDefault();
      var a = document.getElementById("pet-archiv");
      if (a) a.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    content.appendChild(head);

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
    // Filter (Kategorie/Schlagwort) liegen im State, damit sie eine plattform-
    // übergreifende Suche + Zurück-Navigation überstehen.
    var filterBar = el('<div class="filterbar" style="display:none"></div>');
    content.appendChild(filterBar);
    var note = el('<div class="count-note">Lade …</div>');
    content.appendChild(note);
    var listWrap = el('<div id="petlist"></div>');
    content.appendChild(listWrap);

    function draw(arr) {
      var term = state.search.trim().toLowerCase();
      var rows = arr.filter(function (r) {
        if (state.catFilter && r.category !== state.catFilter) return false;
        if (state.tagFilter && (r.tags || []).indexOf(state.tagFilter) < 0) return false;
        if (!term) return true;
        return ((r.title || "") + " " + (r.category || "") + " " +
                (r.started_by || "")).toLowerCase().indexOf(term) > -1;
      });
      var notArch = rows.filter(function (r) { return !isArchived(r.url); });
      var active = notArch.filter(function (r) { return (r.status || "online") !== "offline"; });
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
      // sicher innerhalb der ersten 300 gerendert wird.
      if (state.openPetitionUrl) {
        var ti = active.findIndex(function (r) { return r.url === state.openPetitionUrl; });
        if (ti > 0) active.unshift(active.splice(ti, 1)[0]);
      }
      active.slice(0, 300).forEach(function (r) { listWrap.appendChild(petCard(r, ctx, key)); });
      if (active.length > 300)
        listWrap.appendChild(el('<div class="count-note">Es werden die ersten ' +
          '300 angezeigt – Suche eingrenzen für mehr.</div>'));

      // Bottom-Akkordion (Archiv, danach Offline) – jeweils klappbar.
      function bottomSection(id, icon, label, items, stateKey, empty) {
        var open = state[stateKey];
        var sec = el('<section class="accordion langgroup bottomacc' +
          (open ? " open" : "") + '" id="' + id + '"></section>');
        var hd = el('<button class="acc-head"><span class="acc-title">' +
          '<i class="fa-solid ' + icon + '"></i> ' + label +
          '<span class="acc-count">' + items.length + "</span></span>" +
          '<i class="fa-solid fa-chevron-down acc-chev"></i></button>');
        hd.addEventListener("click", function () {
          var o = !sec.classList.contains("open");
          sec.classList.toggle("open", o); state[stateKey] = o;
        });
        var bd = el('<div class="acc-body"></div>');
        if (items.length)
          items.forEach(function (r) { bd.appendChild(petCard(r, ctx, key)); });
        else
          bd.appendChild(el('<div class="count-note" style="margin:6px 2px">' +
            empty + "</div>"));
        sec.appendChild(hd); sec.appendChild(bd);
        listWrap.appendChild(sec);
      }
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
          return !isArchived(r.url) && (r.status || "online") !== "offline" &&
                 crossMatch(r, v);
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

  function renderEinstellungen() {
    titleEl.textContent = "Einstellungen";
    var live = livePlatforms()
      .sort(function (a, b) { return a.name.localeCompare(b.name, "de"); });
    var activeCount = live.filter(function (p) { return isEnabled(p.key); }).length;
    var allOn = activeCount === live.length;

    content.innerHTML = '<div class="settings-note">Wähle, welche ' +
      'Petitionsplattformen in der Liste erscheinen sollen.</div>';

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
      var opt = el('<div class="opt' + (p.live ? "" : " disabled") + '">' +
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
  }

  // ---- Rendering: Profil (Platzhalter) --------------------------------------
  // ---- Import / Export der persönlichen Daten -------------------------------
  // Alle vom Nutzer angepassten Einstellungen liegen im localStorage. Diese
  // Schlüssel werden gesichert/wiederhergestellt.
  var BACKUP_KEYS = ["enabledPlatforms", "favorites", "signedPetitions",
                     "archivedPetitions", "swipeHintDismissed", "dataBase"];

  function tsStamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "-" + p(d.getHours()) + "-" + p(d.getMinutes());
  }

  // "DD.MM.YYYY, HH:MM Uhr" aus einem ISO-Zeitstempel.
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
      app: "PetitionsManager", type: "backup", version: 1,
      exportedAt: new Date().toISOString(), data: data
    };
  }

  function exportData() {
    var json = JSON.stringify(collectBackup(), null, 2);
    var name = "petitionsmanager-backup-" + tsStamp() + ".json";
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
    document.getElementById("drawer-foot").textContent = "Datenquelle: " + state.base;
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

  function renderProfil() {
    titleEl.textContent = "Profil";
    content.innerHTML =
      '<div class="profile-head">' +
        '<div class="avatar">G</div>' +
        '<div class="profile-name">Gast</div>' +
        '<div class="profile-sub">Nicht angemeldet</div>' +
      '</div>';
    var rows = [
      ["fa-right-to-bracket", "Anmelden / Registrieren", "Platzhalter"],
      ["fa-bell", "Benachrichtigungen", "Bald verfügbar"],
      ["fa-circle-info", "Über die App", ""]
    ];
    rows.forEach(function (r) {
      content.appendChild(el('<div class="prow">' +
        '<span class="prow__ic"><i class="fa-solid ' + r[0] + '"></i></span>' +
        '<div class="prow__body"><div>' + esc(r[1]) + '</div>' +
          (r[2] && r[2] !== "Platzhalter" && r[2] !== "Bald verfügbar"
            ? '<div class="prow__val">' + esc(r[2]) + '</div>' : '') +
        '</div>' +
        (r[2] === "Platzhalter" || r[2] === "Bald verfügbar"
          ? '<span class="badge-ph">' + esc(r[2]) + '</span>' : '') +
        '</div>'));
    });

    // Meine unterzeichneten Petitionen: Anzahl + ausklappbare Liste, nach
    // Markierungs-Zeitstempel absteigend sortiert (neueste zuerst).
    var signedSorted = Array.from(state.signed.entries()).sort(function (a, b) {
      return String(b[1].ts || "").localeCompare(String(a[1].ts || ""));
    });
    var sAcc = el('<div class="signed-acc"></div>');
    var sHead = el('<button class="prow prow--btn signed-head" type="button">' +
      '<span class="prow__ic"><i class="fa-solid fa-bookmark"></i></span>' +
      '<div class="prow__body"><div>Meine unterzeichneten Petitionen</div>' +
        '<div class="prow__val">' + signedSorted.length + " markiert</div></div>" +
      '<i class="fa-solid fa-chevron-down prow__go signed-chev"></i></button>');
    var sList = el('<div class="signed-list"></div>');
    if (!signedSorted.length) {
      sList.appendChild(el('<div class="signed-empty">Noch nichts als ' +
        '„unterschrieben" markiert. Wische eine Petition nach rechts.</div>'));
    } else {
      signedSorted.forEach(function (e) {
        var url = e[0], v = e[1];
        var platName = v.platform ? platformName(v.platform) : "";
        var meta = (platName ? esc(platName) + " · " : "") +
          '<span class="signed-item__when">' + esc(fmtDateTime(v.ts)) + "</span>";
        var row = el('<button class="signed-item" type="button">' +
          '<div class="signed-item__t">' + esc(v.title || url) + "</div>" +
          '<div class="signed-item__meta">' + meta + "</div></button>");
        if (v.platform) {
          row.addEventListener("click", function () {
            openPetitionInApp(v.platform, url);
          });
        } else { row.disabled = true; row.classList.add("signed-item--nolink"); }
        sList.appendChild(row);
      });
    }
    sHead.addEventListener("click", function () { sAcc.classList.toggle("open"); });
    sAcc.appendChild(sHead); sAcc.appendChild(sList);
    content.appendChild(sAcc);

    // Hilfe-Hinweise (z. B. den Wisch-Hinweis) wieder anzeigen.
    var helpBtn = el('<button class="prow prow--btn" type="button">' +
      '<span class="prow__ic"><i class="fa-solid fa-circle-question"></i></span>' +
      '<div class="prow__body"><div>Hilfe-Hinweise zurücksetzen</div>' +
        '<div class="prow__val">Ausgeblendete Hinweise wieder anzeigen</div></div>' +
      '<i class="fa-solid fa-arrow-rotate-left prow__go"></i></button>');
    helpBtn.addEventListener("click", function () {
      LS.removeItem("swipeHintDismissed");
      helpBtn.classList.add("prow--done");
      helpBtn.querySelector(".prow__body").innerHTML =
        '<div>Zurückgesetzt</div>' +
        '<div class="prow__val">Hinweise werden wieder angezeigt</div>';
      helpBtn.querySelector(".prow__go").className =
        "fa-solid fa-check prow__go";
    });
    content.appendChild(helpBtn);

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
    window.scrollTo(0, 0);
  }

  // ---- Drawer ----------------------------------------------------------------
  var drawer = document.getElementById("drawer");
  var scrim = document.getElementById("drawer-scrim");
  function openDrawer(o) {
    drawer.classList.toggle("show", o); scrim.classList.toggle("show", o);
  }
  document.getElementById("hamburger").addEventListener("click", function () {
    openDrawer(true);
  });
  scrim.addEventListener("click", function () { openDrawer(false); });
  document.getElementById("drawer-foot").textContent = "Datenquelle: " + state.base;

  document.querySelectorAll(".drawer__item").forEach(function (b) {
    b.addEventListener("click", function () {
      var a = b.dataset.action;
      openDrawer(false);
      if (a === "refresh") {
        state.dataCache = {};
        loadManifest().then(render).catch(function () {});
      } else if (a === "source") {
        var v = prompt("URL der Datenquelle (Basis-Ordner mit manifest.json):",
          state.base);
        if (v != null) {
          state.base = v.trim() || DEFAULT_BASE;
          LS.setItem("dataBase", state.base);
          state.dataCache = {}; state.manifest = null;
          document.getElementById("drawer-foot").textContent =
            "Datenquelle: " + state.base;
          boot();
        }
      } else if (a === "about") {
        alert("Petitionen-App\n\nZeigt laufende Petitionen mehrerer Plattformen." +
          "\nDaten werden extern gescrapt und hier nur angezeigt.");
      }
    });
  });

  // ---- Tab-Navigation --------------------------------------------------------
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () {
      // Footer-Tab "Liste" führt immer zur Plattform-Übersicht (frischer Start).
      if (t.dataset.tab === "liste") {
        state.platform = null; state.cross = null;
        state.catFilter = null; state.tagFilter = null;
      }
      state.tab = t.dataset.tab; render();
    });
  });

  // ---- Start -----------------------------------------------------------------
  function boot() {
    state.enabled = loadEnabled();
    state.favorites = loadFavorites();
    state.signed = loadSigned();
    state.archived = loadSet("archivedPetitions");

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
    loadManifest().then(render).catch(function () {
      content.innerHTML = '<div class="empty">Daten konnten nicht geladen ' +
        'werden.<br>Prüfe die Datenquelle im Menü (☰).</div>';
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
