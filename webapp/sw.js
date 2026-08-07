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
   geänderten app.js/style.css reisen mit (app.js/style.css)
   v27 (2026-08-03): Sammelrunde aus 16 Oberflächenwünschen des Nutzers.
   Layout „klassisch" ENTFERNT — alte gespeicherte Werte schreibt loadPrefs()
   auf „relief" um, sonst hinge man in einer Ansicht fest, die es nicht mehr
   zur Auswahl gibt. Außerdem: Überschriften über den Tipp-Kästen, erweiterter
   Hinweis zum Datenverbrauch der Bilder, Plattform-Logos in voller Markenfarbe
   (mit Schutzzone für den Text statt opacity:.22), Logo hinter der Beschriftung
   auch in Plattformliste und Cross-Suche, größeres Logo im Seitenkopf,
   „Über diese Plattform" ohne eigenes Logo und über die Knöpfe gerückt,
   Archiv-Knopf mit Relief, „Petition öffnen" in Akzentfarbe (7,69 hell /
   7,91 dunkel), Sortier-Chips ohne Vor-Icons mit 45°-Pfeilen, Lupenknopf an
   beiden Suchen, höherer Bildstreifen mit Kategorie-Fahne, gedeckelte
   Bildhöhe in Beschreibungen, mehr Abstände.
   Dazu die Seite „Meine unterzeichneten Petitionen": Logospalte fester Breite,
   damit die Titel bündig beginnen (die Marken sind flächen-, nicht
   breitengleich), und ein Hinweis, worüber die Suche dort läuft — sie erfasst
   Titel, Plattformname UND Adresse, nicht nur den Titel.
   Nachtrag aus drei Nutzerbefunden am Bildschirm (v27 war noch nicht
   ausgeliefert, deshalb kein eigener Versionssprung):
   1. Die Lupenknöpfe waren Ovale (48 × 54,5 bzw. 48 × 49 px) — ohne feste Höhe
      streckt der Flexcontainer sie auf die Feldhöhe. Feldhöhe und Durchmesser
      kommen jetzt aus einer Variablen --ctl je Suchzeile. Dabei fiel auf, dass
      .search als einziges Suchfeld kein font:inherit hatte und in Arial
      schrieb; daher auch die zwei verschiedenen Höhen.
   2. In der Plattformliste lagen Logo und Pfeil 2 px übereinander: right:3.5rem
      rechnete mit einem 2.25rem breiten Pfeil und ohne den Innenabstand der
      Zeile. Jetzt 4.5rem, Schutzzone um dieselbe 1rem mit.
   3. Ohne Vorschaubild entfällt in „relief" der ganze Bildstreifen. Er war ein
      leerer 112-px-Balken mit kleinem Logo — bei Bundestag und Europäischem
      Parlament (8.001 Petitionen) der Normalfall. „Magazin" behält ihn, dort
      ist das Bild die halbe Kachel.
   Zweiter Nachtrag, neun weitere Punkte vom Bildschirm:
   4. „Petition öffnen" (rund) verliert seine Buchse — das Gegenlicht von
      --nu-in-s sah auf 36 px aus wie ein heller Schein um den Knopf. Für die
      große Schwester gibt es dafür --nu-drop: Schatten ohne Gegenlicht.
   5. Plattform-Kopf neu geordnet: Zurück-Zeile oben, darunter Logo links und
      Name rechts. Der Name steht damit auch im Inhalt; syncPageTitle() blendet
      den doppelten Seitentitel aus (Selektor um .phead__name erweitert).
   6. Kategorie-Fahne beginnt jetzt bei --radius statt 1.125rem — vorher fing
      sie noch innerhalb des Eckbogens an.
   7. Sortier-Chips: „Datum ↑/↓" und „Unterschriften ↑/↓" mit geraden Pfeilen,
      Bedeutung im aria-label.
   8. Startdatum hinter der Unterschriftenzahl in der Kachel.
   9. Unterzeichnete Petitionen tragen Unterschriftenzahl und Startdatum;
      „Unterschrieben am" steht abgesetzt darunter. Beides wird beim Markieren
      mitgespeichert (toggleSigned), weil der Profiltab keine Listen nachlädt;
      liegt die Liste doch im Speicher, gilt die frischere Zahl.
   10. Autocomplete an allen drei Suchfeldern (attachAutocomplete). Die
      Hauptsuche lädt die Listen beim ersten Antippen nach.
   11. NICHT bestellt, beim Messen gefunden: im Dunkelmodus lag hinter jeder
      eingebetteten Marke ein vollflächiger Farbblock. theme.css setzt den
      Grund für .plogo--v-marke (0,3,0) und überstimmt damit das
      background-color:transparent von .plogo--svg (0,1,0) aus style.css.
      Gegenzeile in BEIDEN Theme-Zweigen ergänzt.
   Dritter Nachtrag, zehn weitere Punkte:
   12. „Petition öffnen" jetzt flach gefüllt wie der kleine runde Bruder
      .pet__ext — beide aus den Relief-Sammelselektoren genommen.
   13. Aufklapp- und Fremdlink-Knopf 16 statt 8 px auseinander.
   14. Symbole in den runden Knöpfen: line-height:1 macht den Kasten ein Em
      hoch. Danach lag nur noch der Chevron daneben (gemessen 6 % zu tief und
      zu weit links), der bekommt einen eigenen Korrekturwert.
   15. Kalender-Icon steht hinter dem Datum, wie die Feder hinter der Zahl.
   16. Kicker „SUCHE: …" und der ganze Begrüßungsblock der Hauptseite sind weg
      (Nutzerwunsch). .pagekick:empty blendet die leere Zeile aus.
   17. LOGONORMIERUNG: --logo-k rechnet mit der VIERTEN statt der zweiten
      Wurzel des Seitenverhältnisses. Breite Schriftzüge wachsen dadurch um
      rund die Hälfte (Bundestag von 40 auf 63 % der Bezugshöhe). Alle
      Schutzzonen dahinter neu gemessen und nachgezogen: .plat__body 7.75 →
      11.5rem, .opt__body 8 → 11.25rem, .signed-item__logo 3.75 → 5rem bei
      kleinerem Bezugsmaß.
   18. Assistenten-Zeile: Logo hinter den Text, wie in allen anderen Listen.
   19. Flaggen überall als Kreis — dasselbe Rezept wie bei .grp-ic: Zeichen
      größer als die Blende, overflow:hidden schneidet zu.
   20. europarl_scraper.py: die Kurzbeschreibung war die Überschrift. „Petition
      Summary" steht zweimal auf der Seite, die alte Suche brach schon beim
      ersten Vorkommen ab. Wirkt erst nach dem nächsten Scrape-Lauf.
   Vierter Nachtrag (andere Sitzung, 3.8.26 abends), nur Magazin:
   21. Auf den Bento-Kacheln standen weiße Rechtecke statt der Marken: die
      Magazin-Regel füllte .plogo weiter mit background-color:#ffffff — bei
      der CSS-Maske WAR das die Logoform, vor der eingebetteten Marke ist es
      ein Kasten davor (dasselbe Muster wie Punkt 11). Die weiße Fläche gilt
      jetzt nur noch der Masken-Rückfallebene (:not(.plogo--svg)).
   22. Kachelraster 12rem → 13.5rem plus Meta-Zeile auf line-height 1.2:
      „N Petitionen" bricht auf der 116-px-Innenfläche immer um, und der
      vollste Textblock (OpenPetition, Name zweizeilig + „+neu") lief 25 px
      ins Logo. Messkriterium steht am Rasterkommentar in layouts.css;
      Relief-Zeilen nachgemessen unverändert (146/149 px).
   23. Bento-Feinschliff (vier Nutzerwünsche): Zahl und Einheit im
      Kachel-Markup getrennt (plat__num/plat__unit — in den anderen
      Layouts ungestylte Inline-Spans, Relief-Zeilen weiter 146/149 px
      bei wortgleichem Text); im Magazin Zahl 1.75rem als Kennzahl, auf
      der 2×2-Kachel 3.25rem (füllt die 189-px-Leere — ein größeres Logo
      könnte das nicht, die Bundestagsmarke steht am max-width-Anschlag);
      „+neu" auf xl/wide als Ecke oben rechts mit padding-Schutz am Namen
      (auf der 116-px-Kachel gibt es KEINEN kollisionsfreien Eckplatz —
      dort eigene Zeile unter der Einheit); Antipp-Feedback scale(.98)
      hinter prefers-reduced-motion. Vollste Kachel danach +7 px Luft.
   24. Abstands-/Tipp-Inventur über alle Magazin-Ansichten (gemessen, nicht
      geschaut): Abschnittsgrenze Unterstützung→Rechtliches von 12 auf die
      28 px der übrigen Grenzen; Sortier-Chips, Schlagwort-Knöpfe und
      Zurück-Knopf per min-height auf die 40-px-Systemhöhe der
      Segment-Knöpfe (waren 30/30/35 — zu kleine Tippflächen). Einstellungen
      und Profil sind layoutneutral konsistent (32er-Abschnitte) und bleiben
      unangetastet; Relief gegen­gemessen unverändert (28/35/12).
   25. Gleiche/Ähnliche Petitionen bekommen einen Zuschlag, wenn beide dasselbe
      SELTENE Schlagwort tragen (publish.py → _score; dieselbe Rechnung steht
      in app.js → similarityScore als Notlösung, beide müssen zusammen
      geändert werden). Ausgangsbefund: von sieben offenen Nestlé-Petitionen
      verwies keine einzige auf eine andere, obwohl fünf „Nestlé" als
      Schlagwort tragen — ein gemeinsames Schlagwort unter elf ergab nur 0,04
      Punkte. Jetzt finden fünf von sieben einander. Der Weg über die
      Seltenheit JEDES Wortes ist an den Daten gescheitert (98 % aller Wörter
      kommen in ≤ 25 Petitionen vor, „stillen" ist seltener als „nestle") —
      die Messung steht als Warnung im Kopf von publish.py.
      Wirkt erst nach dem nächsten publish-Lauf; die ausgelieferten
      related-Listen wachsen dabei von 1,8 auf 6,9 MB (Schwelle 0.18→0.24,
      höchstens 4 statt 6 Einträge je Petition).
   26. (andere Sitzung) Magazin-Aufklapper als Kasten: .pet__toggle war dort
      noch das nackte 23×15-px-Zeichen der Basis, 4 px neben dem gefüllten
      36-px-Fremdlink-Kasten (Nutzerbefund per Bildschirmfoto; das Relief
      hat seit Punkt 14 seine Buchsen-Regel, das Magazin ging leer aus).
      Jetzt 36×36 auf var(--line) mit dem 10-px-Radius des Nachbarn,
      16 px Kastenabstand, Zeichen bleibt beim Drehen zentriert
      (padding-left-Ausgleich der Basis im Kasten aufgehoben); ohne
      Fremdlink entfällt der Trennabstand. Relief gegengemessen 34×34
      rund unverändert. (layouts.css)
   (app.js/style.css/layouts.css/texts.js/theme.css
    + europarl_scraper.py/publish.py)

   --- v28 -------------------------------------------------------------------
   27. Mehr Verwandte je Petition (Nutzerwunsch „vollständige Abdeckung, Limit
      darf steigen"). publish.SIM_MAX_PER_PETITION 4 → 8, und wer über der
      Schwelle NICHTS findet, bekommt seinen besten Treffer trotzdem
      (SIM_FILL_WEAKEST) — das betraf 42 Listen, die sonst leer geblieben
      wären. Hier in app.js dazu SIM_SHOW_MAX = 8: der Abschnitt zeigte fest
      6 an, die Einträge 7 und 8 wären ausgeliefert, aber unsichtbar gewesen.
      Gemessen an den 16.914 Live-Sätzen: Abdeckung 97,2 → 97,6 %, Nestlé-Probe
      5/7 → 6/7, related-Nutzlast 6,9 → 12,9 MB, Rechenzeit 32 s.
      ⚠️ 97,6 % ist die BAUARTBEDINGTE OBERGRENZE, nicht eine Frage der
      Schwelle: von 0,24 auf 0,00 gesenkt bringt sie nur dieselben 97,6 % und
      kostet mehr. Die fehlenden 212 Petitionen haben zu 191 GAR KEINEN TITEL
      (184 davon WeMove, dessen Bot-Schutz eine leere Vorlage ausliefert) —
      ohne Text keine Schlagwörter, ohne Schlagwörter kein Vergleich. Sie
      stehen in der App ohnehin als „(ohne Titel)". (app.js/publish.py)
   28. dashboard.html fehlte auf GitHub Pages (HTTP 404, am 4.8.26 gemessen).
      monitor.py schrieb es erst NACH der Plattformschleife; der CI-Lauf
      schickt aber SIGINT, sobald die gemeinsame Frist erreicht ist, und dann
      wurde die Zeile übersprungen. publish.py fand nichts zu kopieren und
      schwieg dazu. Jetzt steht das Schreiben in einem finally, und publish.py
      meldet das Fehlen. (monitor.py/publish.py, nicht in der App sichtbar)

   --- v29 -------------------------------------------------------------------
   29. „Hell" war auf Android nicht hell (Nutzermeldung 4.8.26: „sieht fast aus
      wie der Dunkelmodus"). Die Ursache liegt NICHT im Farbdesign — das ist in
      Ordnung und im Browser mit emuliertem System-Dunkelmodus nachgemessen:
      data-theme="light" liefert #f7f4ec, "dark" und "auto" liefern #191714.
      ⚠️ Android-WebView erkennt an KEINER Stelle an vorhandenen Dunkelregeln,
      ob eine Seite ihr Farbdesign selbst beherrscht — es liest allein die
      CSS-Eigenschaft `color-scheme` bzw. das gleichnamige Meta-Tag. Die hatte
      die App nirgends: die Treffer für „color-scheme" waren durchweg
      `prefers-color-scheme` (Medienabfrage) und `theme-color`
      (Statusleistenfarbe), beides etwas anderes. Bei dunkel gestelltem Gerät
      färbte WebView deshalb nach — auch bei ausdrücklich gewähltem „hell",
      denn data-theme ist ein App-Attribut, von dem WebView nichts weiß.
      Jetzt an den drei zusammengehörigen Stellen deklariert: style.css :root
      (light), theme.css Block A und Block C (dark).
      ⚠️ Der Kommentar in MainActivity.java behauptete das Gegenteil („fasst
      unsere Seiten nicht an, die Web-App bringt ja eigene Dunkelregeln mit")
      und hat den Fehler gedeckt; er ist richtiggestellt.
      setAlgorithmicDarkeningAllowed bleibt auf true — false wäre der falsche
      Hebel, dann meldete WebView wieder dauerhaft „hell" und das Farbdesign
      „Automatisch" wäre erneut wirkungslos.
      ⚠️ Auf dem Gerät NICHT gegengeprüft: die APK lädt ihre Dateien aus dem
      Paket (appassets.androidplatform.net/assets/), nicht von Pages — dort
      wirkt die Reparatur erst nach einem neuen APK-Bau.
      (style.css/theme.css + android/MainActivity.java)

   --- v30 -------------------------------------------------------------------
   30. (andere Sitzung) Magazin-Abstände systematisiert (Nutzerauftrag
      „Best-Practice-Beispiele ansehen", nachjustiert mit „lieber größer als
      zu klein"): im selben Seitenfluss standen 12/14/18/20/28 px
      nebeneinander. Den Seitenfluss trägt seitdem der layoutneutrale
      „Grundrhythmus"-Block in style.css (parallel in der Schwester-Sitzung
      entstanden, 24 px zwischen Blöcken); magazin-only obendrauf: Zählzeile→Liste 16
      (Bildunterschrift-Logik), Kartenfuge 24 statt 20, Bento-Fuge 16 statt
      12 (Zeilenhöhe fest, ≥6-px-Kachelkriterium unberührt: knappste
      gerenderte Kachel 24 px), Karten-Innenpolster 20 → 24,
      Unterstützung/Rechtliches beide 32 (deckungsgleich mit den
      Einstellungs-Sektionen). Eine erste Fassung mit eigenen Magazin-16ern
      im Fluss ist BEWUSST wieder raus — sie kollabierte unter den
      Basis-24ern zu totem Gewicht und hätte Profil (32) und Einstellungen
      (bewusst eng) unterboten.
      Dazu zwei Sichtbefunde, gefunden im ERSTEN gelungenen Screenshot
      (preview_screenshot kam nach Wochen Timeout einmal durch):
      a) „+7 neu"-Abzeichen und Pfeilkreis lagen auf der 2×2-Kachel 40 px
      überlappend BEIDE oben rechts — eine späte XL-Regel hob den Pfeil von
      unten nach oben; Regel gestrichen, Pfeil sitzt wie auf --wide unten
      rechts (dort konstruktionsbedingt frei: .plogo trägt
      max-width:calc(100% - 96px), Rand 24 + Pfeil 40 = 64).
      b) Unter dem XL-Untertitel klafften ~190 px Leere bis zum Logo;
      bento-üblich wird jetzt verteilt: .plat__body als flex-Spalte über die
      Kachelhöhe, der Untertitel rutscht per margin-top:auto nach unten
      (margin-bottom 3.5rem hält ihn 15 px überm absolut sitzenden Logo).
      Relief gegengemessen ohne Leck: count-note 18, Karteninnen 18/16,
      Chip 28, Aufklapper 34×34, Kartenfuge 16 aus EIGENER Relief-Regel.
      (nur layouts.css)

   31. (andere Sitzung) „Magazin 2.0": Einstellungen, Profil und
      Einzelansicht bekommen erstmals eine EIGENE Magazin-Gestalt.
      Messbarer Kern der Nutzerkritik „das design sieht aus wie vorher":
      beide Seiten waren layoutneutral — der Layoutschalter änderte dort
      exakt nichts. Richtung nach Trend-Recherche (Muzli-2026-Patterns,
      Toptal Settings-UX, Karten-Best-Practices): editoriale Typographie
      (Seitentitel 2.25rem/850/eng, Abschnitts-Etiketten werden echte
      1.375rem-Zwischentitel mit Haarlinie davor), Karten in der
      Magazin-Sprache (randlos, weicher Schatten, var(--radius) — statt
      der 1-px-Rahmenkästen der Basis; Gefahrenzone behält ihren roten
      Rahmen, nur der Radius zieht mit), Profil als Hero (Avatar 6.5rem,
      Wirkungs-Kennzahl 3.25rem wie die 2×2-Bento-Kachel), Zurück-Knopf
      als schwebende Pille, Favoriten-Tipp als Akzentfläche. Dunkelmodus
      nach 2026-Regel „Tiefe über Hairline + Flächenstufe, nicht über
      Schatten": zwei Zweige (data-theme=dark fest + auto per
      Medienabfrage), Karten dort mit var(--line)-Hairline und ohne
      Schatten. Per Screenshot hell+dunkel abgenommen. Relief-Leckprobe:
      dort gelten inzwischen die NEUEN Neumorphismus-Regeln der
      Schwester-Sitzung (harte Offset-Schatten, Flächen im
      Hintergrundton) — keiner meiner Magazin-Werte (weiße Fläche,
      Blur-Schatten, 22-px-sect) taucht dort auf. (nur layouts.css)

   32. Acht Nutzerwünsche vom 6.8.2026, alle im Browser nachgemessen:
      a) ZURÜCKTASTE (Android). Die SPA legte nie einen History-Eintrag an,
      MainActivity.canGoBack() war deshalb immer false und die Taste schloss
      die App. Jeder Ansichtswechsel schreibt jetzt einen Eintrag
      (app.js → navTrack am Ende von render(); Abzug aus tab/platform/cross,
      Filter bewusst NICHT, weil draw() den Router umgeht). Gemessen:
      Übersicht → Plattform → Einstellungen → 2× zurück landet wieder auf
      der Plattform bzw. der Übersicht; vier Neuzeichnungen (Farbdesign,
      Favorit) legen KEINEN Eintrag an. Der Ersteinrichtungs-Assistent
      bekommt einen eigenen Eintrag, „zurück" wirkt dort wie
      „Überspringen". Am Java-Teil war nichts zu ändern.
      ⚠️ Nur im Browser belegt — in der APK erst mit einem neuen Bau.
      b) SPRUNGMARKE aus den unterzeichneten Petitionen landete mitten im
      Text: die aufgeklappte Karte ist über 1.400 px hoch, block:"center"
      setzt deren MITTE in die Bildmitte. Jetzt Oberkante über
      scroll-margin-top aus der gemessenen Leistenhöhe (app.js →
      scrollToTop). Karte landet bei 71,7 px statt −741, Titel sichtbar.
      Werkzeug bewusst scrollIntoView geblieben — das rollt auf dem Gerät
      nachweislich, getauscht wurde allein die Zielposition.
      c) AUFKLAPPEN im Relief: Textbreite sprang 227 → 243 px und der
      Chevron saß 4,8 px aus der Mitte. Ursache beide Male dieselbe —
      style.css setzt für .pet.open gap:0 und padding-left:.5rem, das
      Magazin nahm beides am 3.8. zurück, das Relief blieb übersehen.
      Nachgezogen (layouts.css); jetzt in beiden Zuständen 227 px.
      d) PROFIL bekommt die große Überschrift der Einstellungen. Untertitel
      ist profile.intro — lag seit jeher ungenutzt in texts.js. Das kleine
      Versalien-Etikett blendet syncPageTitle() von selbst aus.
      e) ABSTÄNDE: Übersicht 16 → 24, Plattformseite 12/16 → 24, Profil
      24 → 32, Support→Rechtliches 12 → 28 (der am 3.8. nur fürs Magazin
      behobene Rest). ⚠️ NICHT als pauschales .content > * + * — der erste
      Versuch riss auf der Einstellungsseite Schalter und Erklärtext auf
      24 px auseinander; die Blöcke werden jetzt einzeln benannt, und die
      Einstellungen sind nachgewiesen unberührt (kein Selektor trifft dort).
      f) LOGO in der Unterschriftenliste: gleiche Höhe statt gleicher
      Fläche. --logo-k dort auf 1 zu setzen wirkt NICHT (platLogo schreibt
      den Wert inline ans Element), deshalb Höhe und Breite unmittelbar.
      Bundestag 78×13 → 111×18, alle elf Marken auf 18 px; Kasten 7rem,
      weil die breiteste Marke 6,171 × 18 = 111,1 px braucht — aus den
      SVG-Dateien geprüft, nicht aus dem Rückfallwert in platforms.js.
      g) „FEHLER MELDEN" rechts in der Kopfleiste (index.html + app.js):
      mailto an SUPPORT_MAIL mit Textgerüst und den technischen Angaben
      der GERADE offenen Ansicht. 126×44 px bei 375, nur das Zeichen unter
      360 px (die Wortmarke hat Vorrang, sie ist auch der Weg zurück).
      h) KONTAKT bei „Über diese Plattform": alle elf Plattformen haben
      jetzt einen Kontaktweg (platforms.js). Jede Adresse gegen eine
      ERFUNDENE Schwester-Adresse geprüft, sonst hätte man Soft-404s
      übernommen: innn.it/kontakt und eko.org/en/contact liefern beide 200,
      sind aber von /gibtsnicht123 nicht zu unterscheiden — dort steht
      jetzt Impressum bzw. „Über uns". Der Bundestag-Kontakt liegt beim
      Ausschuss, nicht im Petitionsportal.
      ⚠️ Eigener Fehlalarm: die VORHANDENEN Bundestag-Links schienen auf
      „Cookies nicht aktiviert" zu laufen — mit Keksglas antworten sie
      einwandfrei. Nicht anfassen.
      i) BILDER IM AUFRUFTEXT reservieren jetzt Platz, bis sie da sind
      (.pet__desc img:not(.img-da) + bilderBeobachten() in app.js). Es geht um
      den SPRUNG: ein ungeladenes Bild ist 0×0 und schiebt beim Ankommen den
      ganzen Text um 178 px nach unten. ⚠️ NICHT zu verwechseln mit dem alten
      Befund „Bilder erscheinen nie" — der ist jetzt zweimal widerlegt (3.8.
      abends und 6.8. an einer Petition mit ungecachten Bildern: im Sichtfeld
      lädt sofort, weiter unten beim Hinscrollen). Der Platzhalter verschwindet
      nach dem Laden wieder, sonst bekämen kleine Partnerlogos (105×59) einen
      zu hohen Kasten. */
var CACHE = "pm-cache-v31";
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
