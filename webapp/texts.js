/* texts.js — saemtliche Bildschirmtexte der App, nach Sprachen getrennt.
   Wird vor app.js geladen und stellt window.PM_TEXTS bereit.

   AUFBAU (seit 8.8.2026): ein Textbaum je Sprache, alle mit denselben
   Schluesseln. app.js waehlt daraus aus (siehe SPRACHEN und setzeSprache()
   dort); fehlt ein Schluessel in einer Uebersetzung, faellt T() auf Deutsch
   zurueck statt eine leere Flaeche zu zeigen.

   EINE WEITERE SPRACHE HINZUFUEGEN:
     1. hier einen Block anlegen, z. B.  fr: { … },  mit denselben Schluesseln
     2. in app.js die Liste SPRACHEN um { code:"fr", name:"Francais",
        flagge:"🇫🇷" } ergaenzen
   Mehr ist nicht noetig — Sprachwahl in den Einstellungen, der Schritt im
   Einrichtungs-Assistenten und die Erkennung der Systemsprache lesen alle
   aus SPRACHEN.

   ⚠️ EINE Ausnahme von "alle mit denselben Schluesseln": legal.impressumHtml
   gibt es nur auf Deutsch. Begruendung steht bei dem Eintrag; checks.yml
   kennt genau diesen einen Schluessel als erlaubte Luecke.

   NICHT HIER stehen die Stammdaten der Plattformen (Kurzzeile, Steckbrief-
   Text, Sitz, Traeger, Finanzierung, Linkbeschriftungen). Sie gehoeren zu
   platforms.js und haben dort seit dem 8.8.2026 ihre eigene Sprachebene:
   window.PM_PLATFORMS (deutsch) + window.PM_PLATFORMS_EN. */
window.PM_TEXTS = {
  de: {

    /* ⚠️ RECHTSTEXT. Im Code stand darueber: "ENTWURF - juristisch NICHT
       geprueft ... vor der Veroeffentlichung pruefen lassen"; das gilt
       weiter. Seit dem 8.8.2026 abends ist er trotzdem uebersetzt
       (Nutzerentscheidung: alles ausser impressumHtml) — woertlich und ohne
       Abschwaechung, weil Fehler in Ausschlussgruenden schwerer wiegen als in
       Knopfbeschriftungen. Wer den deutschen Wortlaut aendert, aendert die
       englische Fassung im selben Zug mit; sonst zeigt die App zwei
       verschiedene Regelwerke.
       Bleibt EIN zusammenhaengender Text, wie es der Kommentar in app.js
       verlangt hat ("wird als Ganzes redigiert") - nur eben je Sprache. */
    legal: {
      kodexHtml: "<div class=\"kodex\"><div class=\"kodex__grp\"><div class=\"kodex__h\"><i class=\"fa-solid fa-circle-check\"></i> Was eine Plattform mitbringen muss</div><ul class=\"kodex__list\"><li>Sie macht öffentlich, wer sie betreibt – Impressum oder eine gleichwertige Angabe.</li><li>Ihre Petitionen sind ohne Konto lesbar.</li><li>Sie erlaubt automatisiertes Auslesen. Sperren in der robots.txt und Botschutz halten wir ein; wir umgehen sie nicht.</li><li>Sie steht grundsätzlich allen offen und ist nicht die Bühne einer einzelnen Kampagne.</li><li>Sie legt nachvollziehbar dar, wie Unterschriften gezählt werden.</li></ul></div><div class=\"kodex__grp kodex__grp--stop\"><div class=\"kodex__h\"><i class=\"fa-solid fa-ban\"></i> Was zum Ausschluss führt</div><p>Ohne Abwägung ausgeschlossen sind Plattformen, die Inhalte verbreiten oder dulden, die</p><ul class=\"kodex__list\"><li>Menschen wegen Herkunft, Hautfarbe, Staatsangehörigkeit, Religion, Geschlecht, sexueller Orientierung, Behinderung, Alter oder sozialer Stellung herabwürdigen;</li><li>zu Hass, Gewalt oder Ausgrenzung gegen Personen oder Gruppen aufrufen;</li><li>den Holocaust oder andere Völkermorde leugnen oder verharmlosen;</li><li>verfassungswidrige oder verbotene Kennzeichen verwenden;</li><li>Menschen gezielt einschüchtern, bloßstellen oder zur Zielscheibe machen.</li></ul><p>Das gilt unabhängig davon, ob die Plattform solche Inhalte selbst veröffentlicht oder sie nur stehen lässt.</p></div><div class=\"kodex__grp\"><div class=\"kodex__h\"><i class=\"fa-solid fa-gavel\"></i> Wie wir entscheiden</div><ul class=\"kodex__list\"><li>Jeden Vorschlag prüfen wir von Hand, bevor eine Plattform aufgenommen wird.</li><li>Bei einem begründeten Hinweis prüfen wir erneut – und nehmen eine Plattform auch wieder heraus.</li><li>Einzelne Petitionen, die gegen diesen Kodex verstoßen, entfernen wir aus der App, auch wenn die Plattform bleibt.</li></ul></div><p class=\"kodex__note\"><i class=\"fa-solid fa-circle-info\"></i> <span><strong>Was die Aufnahme nicht bedeutet:</strong> PetitionsManager zeigt, was auf den Plattformen öffentlich steht. Die Aufnahme einer Plattform ist keine Empfehlung und keine Zustimmung zu einzelnen Petitionen. Für den Inhalt einer Petition stehen ihre Urheberinnen und Urheber sowie die jeweilige Plattform ein. Wir prüfen nicht jede einzelne Petition im Voraus – sag uns Bescheid, was dir auffällt.</span></p></div>",
      /* ⚠️ DER EINZIGE Text, der bewusst NUR auf Deutsch steht: Pflichtangabe
         mit echter Anschrift. Eine zweite Sprachfassung waere eine zweite
         Pflichtangabe, die auseinanderlaufen kann - und der Anbieter sitzt in
         Deutschland. Der Rueckfall in T() zeigt ihn auch in der englischen
         Oberflaeche auf Deutsch; checks.yml nimmt genau diesen Schluessel von
         der Vollstaendigkeitspflicht aus.
         {mail} und {github} werden zur Laufzeit aus SUPPORT_MAIL bzw.
         GITHUB_URL in app.js gefuellt (fill()) - die Adressen stehen dort
         genau einmal und sollen nicht in jeder Sprachfassung doppelt
         gepflegt werden muessen. */
      impressumHtml: "<dl class=\"legal__dl\"><dt>Anbieter</dt><dd>Matthias Drees</dd><dt>Anschrift</dt><dd>Tempelhof 3<br>74594 Kreßberg<br>Deutschland</dd><dt>Kontakt</dt><dd><a href=\"mailto:{mail}\">{mail}</a></dd><dt>Verantwortlich für den Inhalt</dt><dd>Matthias Drees</dd></dl><p class=\"legal__note\">PetitionsManager ist ein privates, nicht-kommerzielles Projekt. Der Quellcode ist offen: <a href=\"{github}\" target=\"_blank\" rel=\"noopener\">GitHub</a>.</p>",

      /* Wegweiser DRUMHERUM — Ueberschriften, Anreisser, Knopf. Sie standen
         als erste im en-Block, weil sie Navigation sind und keine
         Rechtsaussage; inzwischen ist der Rest nachgezogen. */
      title: "Rechtliches",
      impressumTitle: "Impressum",
      impressumTeaser: "Wer diese App anbietet und wie er erreichbar ist.",
      rechteTitle: "Rechte an den Inhalten",
      rechteTeaser: "Wem die Petitionstexte und Bilder gehören und was mit den Plattformen abgestimmt ist.",
      kontaktBtn: "Kontakt aufnehmen",

      /* ⚠️ AB HIER WIEDER RECHTSTEXT — seit 8.8.2026 abends ebenfalls
         uebersetzt (siehe oben). rechteLead und rechteNote umschliessen die
         Plattform-Tabelle, die app.js dazwischen setzt — deshalb zwei Texte
         statt einem. Die Zeilen plat… und stand… gehoeren zu derselben
         Tabelle; „Nutzungsrecht ungeklaert" ist eine Auskunft ueber die
         Rechtslage und muss in beiden Sprachen dasselbe sagen. */
      rechteLead: "<p class=\"legal__lead\">Die Petitionen in dieser App stammen von fremden Plattformen. Das Urheberrecht an ihren Inhalten – Titel, Aufruf-Texte, Bilder – liegt bei den jeweiligen Urheberinnen und Urhebern beziehungsweise bei der Plattform. PetitionsManager erwirbt daran keine Rechte und räumt keine ein.</p><p class=\"legal__lead\">Was davon kopiert wird und was nicht: Titel, Kurzfassung, Aufruf-Text, Unterschriftenzahl und Datum werden abgerufen und in der App gespeichert. Die <strong>Bilder werden nicht kopiert</strong>, sondern von den Servern der Plattformen eingebunden – sie bleiben dort liegen und werden beim Anzeigen von dort geholt.</p><p class=\"legal__lead\"><strong>Das Nutzungsrecht ist ungeklärt.</strong> Die Inhalte sind öffentlich zugänglich, und diese App ist nicht-kommerziell und ihr Quellcode offen – eine Erlaubnis der Plattformen ist damit aber nicht gegeben. Im Zuge der Veröffentlichung werden alle Betreiber angefragt; die Tabelle zeigt je Plattform, wie weit das ist.</p>",
      rechteNote: "<p class=\"legal__note\">Wenn Sie für eine der genannten Plattformen sprechen und mit der Darstellung Ihrer Inhalte nicht einverstanden sind, schreiben Sie uns.</p>",
      platBetreiber: "Betreiber",
      platSitz: "Sitz",
      platNutzungsrecht: "Nutzungsrecht",
      platUnbekannt: "nicht bekannt",
      keinImpressum: "Kein Impressum – Betreiber außerhalb des deutschen Rechtsraums",
      standUngeklaert: "ungeklärt – noch nicht angefragt",
      standAngefragt: "angefragt am {datum} – noch keine Antwort",
      standErlaubt: "Nutzung zugesagt",
      standEingeschraenkt: "eingeschränkt zugesagt",
      standAbgelehnt: "abgelehnt",
      standAntwort: "Antwort erhalten",
      standAm: "{wort} am {datum}"
    },

    app: {
      name: "PetitionsManager",
      claim: "Alle Petitionen. Eine App.",
      welcomeTitle: "Deine Petitionen auf einen Blick",
      welcomeText: "Hier siehst du die aktuellen Petitionen von allen Plattformen, die du aktiviert hast. Nutze die Suche, um ein bestimmtes Thema zu finden.",
      tagline: "Petitionen von 11 Plattformen an einem Ort — kostenlos, werbefrei, lokal auf deinem Gerät."
    },

    wizard: {
      skip: "Überspringen",
      back: "Zurück",
      next: "Weiter",
      finish: "Los geht's",
      stepOf: "Schritt {n} von {total}",
      intro: {
        title: "Willkommen im PetitionsManager",
        text: "Diese App bündelt Petitionen von 11 Plattformen an einem Ort. Du entscheidest, welche du siehst — und kannst jederzeit filtern, suchen und deine Unterschriften festhalten.",
        cta: "Einrichten"
      },
      /* ⚠️ Dieser Schritt fragt nach den Sprachen der PETITIONEN, nicht nach der
         Bediensprache — die steht auf dem Begrüßungsbildschirm. Beides
         hintereinander „Sprache" zu nennen hat den Nutzer am 4.9.2026 dazu
         gebracht, den Schritt für eine Wiederholung zu halten und den ganzen
         Ablauf für unlogisch. Titel und Text sagen den Unterschied jetzt
         ausdrücklich; die Vorbelegung aus der Oberflächensprache bleibt
         (Entscheidung 12.8.2026, am 4.9. bestätigt). */
      lang: {
        title: "In welchen Sprachen sollen die Petitionen sein?",
        text: "Nicht zu verwechseln mit der Bediensprache der App — die hast du eben gewählt und sie bleibt, was sie ist. Hier geht es um die Sprache der Petitionen selbst.",
        hint: "Mindestens eine Sprache wählen."
      },
      /* Schritt 2: Länder (4.9.2026). Bewusst ein eigener Schritt neben der
         Sprache: „deutsch / Deutschland" und „deutsch / Österreich" sind
         verschiedene Antworten. Der Text muss erklären, warum hier NOCH eine
         Frage kommt, die der vorigen ähnelt — sonst liest sie sich wie eine
         Wiederholung. Deshalb nennt er den Grund („über Ländergrenzen hinweg")
         statt bloß zur Auswahl aufzufordern. */
      land: {
        title: "Aus welchen Ländern?",
        text: "Viele Plattformen sammeln über Ländergrenzen hinweg — eine deutschsprachige Petition kann aus Österreich oder der Schweiz kommen. Wähle, welche Länder dich interessieren.",
        hint: "„Weltweit“ steht für Plattformen, die länderübergreifend sammeln – sie zeigen trotzdem Petitionen in deiner Sprache.",
        /* Steht anstelle von `hint`, solange das Manifest die Landachse gar
           nicht führt. Ohne diesen Satz zeigt der Schritt einen einzigen Chip,
           der nichts bewirkt, und sieht aus wie ein kaputter Filter — genau so
           ist er am 4.9.2026 gemeldet worden. */
        nodata: "Die Landangaben kommen mit dem nächsten Datenlauf – bis dahin steht hier nur „Weltweit“."
      },
      /* Schritt 3: Farbdesign und Layout zusammen. Die Beschriftungen der
         beiden Schalterleisten kommen aus settings.* — es sind dieselben
         Bedienelemente wie in den Einstellungen, und zwei getrennte
         Übersetzungen desselben Wortes wären eine Fehlerquelle. */
      look: {
        title: "Wie soll die App aussehen?",
        text: "Wähle, was dir besser gefällt – beides lässt sich später jederzeit umstellen."
      },
      platforms: {
        title: "Welche Plattformen möchtest du beobachten?",
        text: "Wähle aus, welche Plattformen dir in der Liste angezeigt werden. Deaktivierte Plattformen kannst du jederzeit wieder einblenden.",
        hint: "Du kannst die Auswahl jederzeit in den Einstellungen ändern."
      },
      /* Schritt 4: Benachrichtigungen und Bilder. */
      extras: {
        title: "Zwei Kleinigkeiten noch",
        text: "Beides ist freiwillig und jederzeit umstellbar."
      },
      /* Hinter dem ⓘ an „Benachrichtigungen". Ausführlicher als
         notify.intro auf der Einstellungsseite: hier wird zum ersten Mal
         danach gefragt, und der Satz muss die Systemabfrage ankündigen, die
         gleich darauf erscheint. */
      notifyInfo: "Einmal am Tag eine kurze Info über neue Petitionen deiner Plattformen. Dein Gerät fragt dafür einmalig um Erlaubnis. Es werden dabei keine Daten verschickt – die App zählt nur, was sie ohnehin schon geladen hat.",
      /* Abschnittskopf über der Bilder-Zeile. Bewusst KURZ: die Zeile darunter
         heißt schon „Bilder in Beschreibungen laden", derselbe Satz zweimal
         untereinander liest sich wie ein Fehler. */
      imagesLabel: "Bilder",
      /* Zustandszeile im Assistenten – KURZ. Die Begründung steht dort hinter
         dem ⓘ (imagesInfo); der lange Text von settings.descImagesOn/Off lief
         daneben über zehn Zeilen und sagte dasselbe ein zweites Mal. */
      imagesOn: "Bilder werden mitgeladen.",
      imagesOff: "Nur Text – spart Datenvolumen.",
      /* Hinter dem ⓘ an „Bilder". Sagt bewusst etwas anderes als die Zeile
         darunter: die sagt, was gerade passiert, dieser Text sagt, warum es
         die Option gibt. */
      imagesInfo: "Die Plattformen betten unverkleinerte Pressebilder in ihre Aufruftexte ein – einzelne sind über 17 MB groß. Die App kann sie nicht verkleinern, weil sie mitten im Text stecken; abschalten ist der einzige Weg, Datenvolumen zu sparen.",
      /* Import auf dem Begrüßungsbildschirm: übernimmt eine Sicherung und
         überspringt damit die ganze Einrichtung. */
      /* „importieren", nicht „einspielen" (Nutzerentscheidung 12.8.2026) —
         dasselbe Wort wie der Knopf im Profil (io.importBtn). Zwei Wörter für
         denselben Vorgang lassen ihn wie zwei verschiedene aussehen. */
      importBtn: "Sicherung importieren",
      importHint: "Du hast schon eine Sicherung? Dann übernehmen wir alles daraus und du bist sofort fertig.",
      done: {
        title: "Alles bereit.",
        text: "Deine Auswahl ist gespeichert. Tippe auf eine Plattform, um ihre aktuellen Petitionen zu sehen — und wische eine Petition nach rechts, wenn du unterschrieben hast."
      },
      /* Zahl unter dem Plattformnamen im Auswahl-Schritt. */
      platCount: "{n} Petitionen"
    },

    liste: {
      intro: "Wähle eine Plattform, um ihre Petitionen zu sehen.",
      searchPlaceholder: "Alle Petitionen durchsuchen …",
      searchHint: "Sucht gleichzeitig über alle aktivierten Plattformen.",
      heroTitle: "Im Trend",
      emptyAll: "Keine Plattform aktiviert. Wähle in den Einstellungen aus, welche du sehen möchtest.",
      emptyFiltered: "Keine Petitionen gefunden. Ändere den Suchbegriff oder überprüfe deine Filter.",
      loading: "Lade Petitionen …",
      /* „Petitionen" steht in der Kachel in einem EIGENEN Span unter der
         Zahl (Magazin setzt die Zahl gross) — deshalb nur die Einheit. */
      petitionsUnit: "Petitionen",
      /* Flaggen-Hinweis auf der Plattform-Kachel. Zeigt die WEITEREN
         Sprachen, in denen diese Plattform ihre Petitionen fuehrt —
         die Gruppenueberschrift nennt nur die Hauptsprache. */
      alsoIn: "Liegt auch auf {sprachen} vor",
      newBadge: "+{n} neu",
      countOf: "{n} von {total} Petitionen",
      reasonClosed: "beendet",
      reasonArchived: "im Archiv",
      reasonOffline: "offline",
      restNote: "Es werden die ersten {n} angezeigt – Suche eingrenzen für mehr."
    },

    favorites: {
      title: "Favoriten",
      howTitle: "Favoriten anlegen",
      how: "Tippe auf den Stern neben einer Plattform, um sie zu einem Favoriten zu machen. Favoriten erscheinen immer ganz oben in der Liste.",
      empty: "Noch keine Favoriten. Tippe auf den Stern neben einer Plattform, um sie hier abzulegen.",
      hintDismiss: "Verstanden, nicht mehr anzeigen"
    },

    petition: {
      favHint: "Tippe auf das Lesezeichen-Symbol in der Petition, um sie zu merken.",
      swipeHintTitle: "Petitionen wischen",
      heroListTitle: "Alle Petitionen",
      swipeHint: "Wische nach rechts, um eine Petition als unterschrieben zu markieren. Nochmal wischen setzt das zurück. Wische nach links, um sie zu archivieren.",
      signedBadge: "Unterschrieben",
      similarTitle: "Gleiche / Ähnliche Petitionen",
      openExtern: "Petition öffnen",
      swipeSign: "Unterschrieben",
      swipeUndo: "Zurücksetzen",
      swipeArchive: "Archivieren",
      swipeRestore: "Wiederherstellen",
      signedInline: "unterschrieben",
      closed: "beendet",
      closedOn: "beendet {datum}",
      noTitle: "(ohne Titel)",
      /* Abzeichen ueber dem Petitionstext, wenn die gewaehlte Sprache bei der
         Plattform NICHT vorliegt. Bewusst "Fassung auf X" und nicht
         "uebersetzt aus X": wir uebersetzen nichts — WeMove, Avaaz und das
         EU-Parlament veroeffentlichen beide Fassungen selbst. Erscheint nur,
         wenn der Scraper nachgesehen HAT (i18n_state == "fehlt"); ein bloss
         leeres Feld ist kein Beleg fuer eine fehlende Fassung. */
      langFallback: "Fassung auf {sprache}",
      langFallbackHint: "In der gewählten Sprache liegt diese Petition bei " +
        "{plattform} nicht vor. Angezeigt wird der Text der Plattform auf " +
        "{sprache}.",
      startTitle: "Start der Petition",
      openExternAria: "Petition extern öffnen",
      summary: "Kurzbeschreibung",
      recipient: "Adressat",
      startedBy: "Gestartet von",
      description: "Beschreibung",
      textLoading: "Text wird geladen …",
      tags: "Schlagwörter",
      metaStart: "Start: {datum}",
      noText: "Für diese Petition liegt kein ausführlicher Text vor.",
      textError: "Der Text konnte nicht geladen werden. Prüfe deine Verbindung.",
      similarNone: "Keine ähnlichen Petitionen gefunden.",
      similarSearching: "Suche über alle Plattformen …",
      similarSame: "gleich",
      /* ⚠️ NICHT dasselbe wie "gleich": "gleich" leitet sich aus einem
         Ähnlichkeitswert ab und kann irren, dieser Hinweis stammt aus einer
         ausdrücklichen Kennung der Quelle (gleiche Kampagnennummer, gleicher
         Slug, verlinkter Sprachwechsel).
         ⚠️ Wortlaut 12.8.2026 geändert, vorher "Übersetzung ({sprache})".
         Seit jede Quelle je Sprache einen EIGENEN Plattform-Eintrag hat
         ("Avaaz" und "Avaaz (English)"), verbindet der Hinweis zwei Einträge
         DERSELBEN Plattform. "Übersetzung" behauptete dabei zu viel — wir
         übersetzen nichts, die Plattform veröffentlicht beide Fassungen
         selbst; und die Zeile daneben nennt bereits die Plattform. */
      similarTranslation: "Dieselbe Petition auf {sprache}",
      similarMore: "Mehr anzeigen ({n})",
      notInData: "Diese Petition steht nicht mehr in den Daten dieser Plattform. Vermutlich hat sich ihre Adresse geändert.",
      /* Der ausfuehrliche Wisch-Hinweis ueber der Liste. Bleibt EIN Text
         samt Auszeichnung: die Warnung in der Mitte („wird NICHT automatisch
         unterschrieben") ist der Kern des Satzes und darf nicht in einem
         eigenen Schluessel landen, wo sie ohne den Rest steht. */
      swipeHintHtml: "Wische eine Petition nach <b>rechts</b>, um sie als „unterschrieben\" zu markieren. <span class=\"hint-note\"><b>Wichtig:</b> Sie wird dadurch <u>nicht</u> automatisch unterschrieben – das musst du selbst auf der jeweiligen Plattform tun.</span> Nach <b>links</b> wischen archiviert die Petition.",
      hintDismiss: "Verstanden, zukünftig nicht mehr anzeigen"
    },

    signed: {
      title: "Meine unterzeichneten Petitionen",
      intro: "Hier sind alle Petitionen, bei denen du deine Unterschrift gesetzt hast.",
      empty: "Noch nichts hier. Wenn du eine Petition unterzeichnest, wische sie in der Liste nach rechts — sie landet dann hier.",
      searchPlaceholder: "Unterzeichnete Petitionen durchsuchen …",
      searchHint: "Durchsucht Titel, Plattform und Adresse (URL) der Petition — nicht den Aufruftext.",
      countOne: "1 Petition",
      countMany: "{n} Petitionen",
      milestones: {
        "1": "Deine erste Unterschrift. Jede Bewegung beginnt mit einer Stimme.",
        "5": "5 Petitionen — du zeigst konsequent Haltung.",
        "10": "10 Unterschriften. Du weißt, was dir wichtig ist.",
        "25": "25 Petitionen. Deine Stimme hat Gewicht — immer wieder.",
        "50": "50 Mal aktiv gewesen. Das ist kein Zufall, das ist Überzeugung.",
        "100": "100 Unterschriften. Danke, dass du dran bleibst."
      },
      hitsOf: "{n} von {total} Treffern",
      noHits: "Keine Treffer für „{q}“.",
      signedOn: "Unterschrieben am"
    },

    impact: [
      "Eine Petition braucht viele Stimmen — deine zählt.",
      "Öffentlicher Druck entsteht, wenn genug Menschen dasselbe sagen.",
      "Jede Unterschrift zeigt: Dieses Thema ist vielen wichtig.",
      "Wer unterschreibt, gibt einem Anliegen mehr Sichtbarkeit.",
      "Petitionen machen Probleme sichtbar, bevor sie gelöst werden können.",
      "Wenige Stimmen reichen nicht — genau deshalb kommt es auf jede an.",
      "Beharrlichkeit lohnt sich: Viele Petitionen brauchen Zeit, keine Ungeduld.",
      "Eine Stimme allein bewegt wenig. Tausende davon bewegen viel."
    ],

    platform: {
      /* Überschrift über dem Slider der Plattformseite (8.8.2026,
         Nutzerwunsch). Der Slider dort ist nach Startdatum absteigend
         sortiert — „Neuste" beschreibt ihn also wörtlich. Auf der
         Startseite heißt der Slider weiterhin liste.heroTitle
         („Im Trend"), weil der nach Unterschriften je Tag sortiert. */
      heroTitle: "Neuste",
      aboutBtn: "Über diese Plattform",
      aboutIntro: "Hier findest du Informationen zu Träger, Sitz und Finanzierung dieser Plattform.",
      linksTitle: "Links",
      operatorLabel: "Träger",
      seatLabel: "Sitz",
      foundedLabel: "Gegründet",
      financingLabel: "Finanzierung",
      unknown: "nicht bekannt",
      impressumLabel: "Impressum",
      termsLabel: "Nutzungsbedingungen",
      sourceFor: "Quelle für diese Angabe",
      sourceForAria: "Quelle für {label}",
      website: "Website",
      dataSource: "Quelle der Daten",
      opennessGood: "Was vorbildlich ist",
      opennessWish: "Was helfen würde",
      appSource: "Quellcode dieser App",
      nerds: "Für Nerds",
      favAria: "Plattform als Favorit merken",
      signatures: "{n} Unterschriften",
      perDay: "~{n}/Tag"
    },

    settings: {
      intro: "Passe die App an deine Bedürfnisse an. Alle Einstellungen bleiben lokal auf deinem Gerät.",
      sections: {
        data: "Daten",
        notify: "Benachrichtigungen",
        appearance: "Darstellung",
        about: "Über",
        reset: "Zurücksetzen"
      },
      /* Sprachwahl (8.8.2026). langLabel dient zugleich als Ueberschrift und
         als aria-label des Schalters; die Knopfbeschriftungen selbst stehen
         NICHT hier, sondern in SPRACHEN in app.js — sie sollen in ihrer
         eigenen Sprache erscheinen, nicht uebersetzt. */
      langLabel: "Sprache",
      langHint: "Beim ersten Start folgt die App der Sprache deines Geräts.",
      themeLabel: "Farbdesign",
      darkMode: "Dunkles Design",
      darkModeHint: "Wähle helles oder dunkles Design. „Auto“ folgt der Einstellung deines Geräts.",
      themeLight: "Hell",
      themeDark: "Dunkel",
      themeAuto: "Auto",
      layoutLabel: "Layout",
      layoutRelief: "Relief",
      layoutMag: "Magazin",
      infoShow: "Erklärung anzeigen",
      layoutHint: "Ändert nur das Aussehen, nicht die Inhalte. „Relief“ ist im Stil des Neumorphismus gebaut („Soft UI“): Karten, Knöpfe und Felder haben dieselbe Farbe wie der Hintergrund und werden nur durch Licht und Schatten geformt – angetippt oder eingeschaltet sinken sie ein. „Magazin“ ist im Stil moderner Nachrichten-Apps gehalten: abgesetzte Karten mit weichem Schatten, die Logos der Plattformen in ihren echten Markenfarben, eine frei wählbare Akzentfarbe für alles Aktive und das Bild der Petition groß nach oben.",
      accentLabel: "Akzentfarbe",
      accentKoralle: "Koralle",
      /* Sichtbare Ueberschrift ueber der Schriftfarben-Auswahl (8.8.2026,
         Nutzerwunsch „hier auch eine Überschrift wie Akzentfarbe"). Der Text
         war vorher „Schrift" und wurde von segControl NUR als aria-label
         gesetzt, also nie angezeigt — die Auswahl stand ueberschriftenlos
         unter den Farbknoepfen. */
      accentInkLabel: "Akzent-Schriftfarbe",
      accentInkAuto: "Auto",
      accentInkLight: "Hell",
      accentInkDark: "Dunkel",
      autoDark: "Systemeinstellung folgen",
      descImagesLabel: "Bilder in Beschreibungen laden",
      descImagesOn: "Fotos und Logos werden beim Öffnen einer Petition aus dem Internet nachgeladen. Das setzt eine Internetverbindung voraus und verbraucht Datenvolumen – einzelne Bilder sind mehrere Megabyte groß. Unterwegs am besten nur im WLAN einschalten.",
      descImagesOff: "Nur Text. Es werden keine Bilddateien aus dem Internet abgerufen, es entsteht also kein Datenverbrauch für Bilder.",
      refresh: "Daten aktualisieren",
      refreshHint: "Lädt die aktuellen Petitionsdaten neu von der Quelle.",
      source: "Datenquelle",
      sourceHint: "Gibt an, von wo die Petition-Daten geladen werden.",
      about: "Über die App",
      /* Datenquelle. Der ganze Block ruht derzeit (ZEIGE.datenquelle in
         app.js), die Texte stehen aber schon hier — sonst faellt beim
         Wiederanschalten alles zurueck auf Deutsch. */
      srcAuto: "Automatisch",
      srcBundled: "Mitgeliefert",
      srcLive: "Live",
      srcLiveShort: "live",
      srcBundledShort: "mitgeliefert",
      sourceCustom: "Eigene Quelle",
      sourceCustomHint: "Für Tests: eigener Basis-Ordner",
      sourcePrompt: "URL der Datenquelle (Basis-Ordner mit manifest.json):",
      sourceNoteAuto: "Aktiv: {aktiv}{grund}. „Automatisch“ nimmt die tagesaktuellen Daten, wenn sie erreichbar und neuer sind als die mitgelieferten.",
      sourceNoteBundled: "Nur die Daten aus dem App-Paket. Sie veralten, bis eine neue Fassung der App kommt.",
      sourceNoteLive: "Immer aus dem Netz. Ohne Verbindung greift die App auf die mitgelieferten Daten zurück.",
      whyLiveUnreachable: "Live-Daten nicht erreichbar",
      whyNoConnection: "Keine Verbindung",
      whyBundledNewer: "Mitgelieferte Daten sind neuer",
      whyLive: "Tagesaktuell von GitHub Pages",
      refreshedAt: "Aktualisiert am {zeit} · Quelle: {quelle}",
      refreshChecking: "Verbindung prüfen …",
      refreshNoPlatforms: "Keine Plattform aktiviert.",
      refreshProgress: "Lade {n} von {total} …",
      refreshDone: "{n} Petitionen geladen",
      refreshBroken: "{n} Quelle(n) nicht erreichbar",
      refreshFailed: "Nicht erreichbar.",
      platformsTitle: "Plattformen",
      activeCount: "{n}/{total} aktiv",
      allOff: "Alle deaktivieren",
      allOn: "Alle aktivieren",
      /* Ohne die Sprache: seit 11.8.2026 stehen die Plattformen in den
         Einstellungen unter einer Sprachüberschrift, die sie einmal nennt.
         {lang} wird weiter übergeben und bleibt hier verfügbar — wer die
         Sprache je Zeile zurückhaben will, ergänzt nur diesen Text. */
      platMeta: "{n} Petitionen",
      platSoon: "in Vorbereitung",
      favMark: "Als Favorit markieren"
    },

    notify: {
      intro: "Du kannst dir einmal täglich eine Zusammenfassung schicken lassen. Die Uhrzeit wählst du selbst.",
      enable: "Tägliche Benachrichtigung",
      timeLabel: "Uhrzeit",
      quietLabel: "Auch melden, wenn es nichts Neues gibt",
      quietHintOn: "Du erhältst täglich eine Meldung — auch wenn sich nichts geändert hat.",
      quietHintOff: "Du erhältst nur dann eine Meldung, wenn es neue Petitionen gibt.",
      permissionAsk: "Dein Gerät fragt gleich nach der Erlaubnis für Benachrichtigungen.",
      permissionDenied: "Benachrichtigungen sind in deinen Systemeinstellungen gesperrt. Bitte erlaube sie dort für diese App.",
      testBtn: "Testbenachrichtigung",
      sampleTitle: "PetitionsManager — Tagesübersicht",
      sampleBodyNew: "{n} neue Petitionen warten auf dich.",
      sampleBodyNone: "Heute nichts Neues — aber gestern hast du vielleicht noch eine übersehen.",
      notSupported: "Dieses Gerät unterstützt keine Benachrichtigungen.",
      dailyAt: "Täglich um {zeit} Uhr",
      off: "Aus",
      testUnsupported: "Diese Umgebung kennt keine Benachrichtigungen — weder über den Browser noch über die Android-Brücke.",
      testSent: "Gesendet. Erscheint sie nicht, sind Benachrichtigungen für den Browser in den Systemeinstellungen abgeschaltet.",
      testFailed: "Konnte nicht gesendet werden.",
      deniedAndroid: "Benachrichtigungen sind für diese App gesperrt. Das lässt sich nur in den Android-Einstellungen der App zurücknehmen.",
      deniedBrowser: "Du hast Benachrichtigungen für diese Seite abgelehnt. Das lässt sich nur in den Einstellungen des Browsers zurücknehmen.",
      waiting: "Warte auf deine Erlaubnis …",
      noPermission: "Ohne Erlaubnis keine Benachrichtigung.",
      hintAndroid: "Die Erinnerung kommt zur gewählten Uhrzeit, auch wenn die App geschlossen ist. Android darf sie um einige Minuten verschieben, um Akku zu sparen. Wie viele Petitionen neu sind, steht in der App – die Meldung selbst kennt die Daten nicht.",
      hintBrowser: "Hinweis: Die Meldung erscheint, sobald du die App nach der gewählten Uhrzeit das nächste Mal öffnest oder sie im Hintergrund noch läuft. Eine Erinnerung bei komplett geschlossener App bräuchte einen eigenen Server – den hat diese App im Browser bewusst nicht. In der Android-App übernimmt das ein Weckruf des Systems."
    },

    /* Nachfrage der Zurücktaste am Ende des Verlaufs (11.8.2026). Steht in
       texts.js und nicht in Java, damit sie der Sprachwahl folgt. */
    beenden: {
      title: "App beenden?",
      text: "Du bist am Anfang. Noch einmal zurück schließt den PetitionsManager.",
      ok: "Beenden",
      abbrechen: "Bleiben"
    },

    reset: {
      intro: "Hier kannst du einzelne Teile der App zurücksetzen oder alles auf den Ausgangszustand bringen.",
      wizard: "Einrichtungs-Assistent erneut zeigen",
      wizardHint: "Öffnet den Begrüßungsassistenten beim nächsten App-Start erneut.",
      hints: "Hinweise zurücksetzen",
      hintsHint: "Zeigt alle ausgeblendeten Tipps und Hinweise wieder an.",
      all: "Alles zurücksetzen",
      allHint: "Löscht alle gespeicherten Daten dieser App — nicht rückgängig zu machen.",
      allWarnTitle: "Wirklich alles löschen?",
      allWarnText: "Dabei werden unwiderruflich gelöscht: deine Favoriten, alle als unterzeichnet markierten Petitionen, das Archiv, deine Plattform-Auswahl sowie Name und Profilbild. Die App startet anschließend neu wie beim ersten Mal.",
      allConfirmLabel: "Ja, alles löschen",
      allConfirmBtn: "Endgültig löschen",
      cancel: "Abbrechen",
      doneToast: "Alles zurückgesetzt. Die App startet neu.",
      hintsDone: "Zurückgesetzt – die Hinweise erscheinen wieder."
    },

    profile: {
      intro: "Du kannst einen Namen und ein Bild hinterlegen — zum Beispiel damit du deine exportierten Daten leichter wiederfindest.",
      nameLabel: "Dein Name",
      namePlaceholder: "Wie soll die App dich nennen?",
      photoLabel: "Profilbild",
      photoHint: "Das Bild wird nur lokal gespeichert und erscheint in der App.",
      photoRemove: "Bild entfernen",
      exportTitle: "Daten exportieren",
      exportHint: "Dein Name erscheint in der Exportdatei, damit du sie später zuordnen kannst.",
      importTitle: "Daten importieren",
      importHint: "Importiere eine zuvor exportierte Datei, um deine Einstellungen und Markierungen wiederherzustellen.",
      privacy: "Alle deine Eingaben bleiben ausschließlich auf diesem Gerät — es gibt kein Konto und keinen Server.",
      title: "Profil",
      signedSuffix: "unterzeichnet",
      impactFallback: "Jede Unterschrift macht ein Anliegen ein Stück sichtbarer."
    },

    support: {
      title: "Unterstütze PetitionsManager",
      intro: "PetitionsManager ist ein freies Projekt. Dein Feedback und deine Ideen helfen, die App besser zu machen.",
      missingPlatform: {
        q: "Fehlt eine Plattform?",
        a: "Kennst du eine Petitionsplattform, die hier noch fehlt? Sag uns Bescheid — wir prüfen die Aufnahme.",
        btn: "Plattform vorschlagen"
      },
      missingPetition: {
        q: "Fehlt eine Petition?",
        a: "Eine wichtige Petition wird nicht angezeigt? Melde sie uns am besten mit Link.",
        btn: "Petition melden"
      },
      help: {
        q: "Möchtest du helfen?",
        a: "Hilf mit — mit Feedback, Ideen, Übersetzungen oder finanzieller Unterstützung über Liberapay.",
        btn: "Mithelfen"
      },
      share: {
        q: "Möchtest du die App teilen?",
        a: "Teile PetitionsManager mit anderen, die Petitionen mehrerer Plattformen im Blick behalten wollen.",
        btn: "App teilen"
      },
      /* Der Kodex-Eintrag steht bewusst ganz oben im Ausklapper. Nur
         Ueberschrift, Anreisser und Knopf — der Kodex selbst ist
         legal.kodexHtml und bleibt deutsch. */
      /* Hinweis auf die Android-Fassung. Erscheint NUR im Browser - in der
         App selbst waere er sinnlos (app.js prueft auf window.AndroidBackup).
         Genannt werden die drei Dinge, die im Browser wirklich fehlen, nicht
         allgemeines Lob: vollstaendig offline, Erinnerung im Hintergrund,
         Sicherung als Datei. */
      appTitle: "Die App zum Installieren",
      appText: "Im Browser lädt die App die Petitionen erst beim Ansehen nach. Die Android-Fassung bringt alle Petitionen schon mit: sie funktioniert vollständig ohne Verbindung, kann dich täglich erinnern und deine Daten als Datei sichern.",
      appBtn: "Zur Android-App",
      kodexTitle: "Wen wir aufnehmen – unser Kodex",
      kodexText: "Nach diesen Regeln entscheiden wir, welche Petitionsplattform in die App kommt und welche nicht.",
      kodexBtn: "Verstoß melden",
      donate: "Finanziell unterstützen",
      shareText: "Behalte Petitionen mehrerer Plattformen im Blick.",
      linkCopied: "Link kopiert",
      copyPrompt: "Link kopieren:"
    },

    about: {
      title: "Über die App",
      text: "PetitionsManager bündelt Petitionen von 11 unabhängigen Plattformen an einem Ort. Du kannst filtern, suchen, Petitionen als unterzeichnet markieren und archivieren. Die App ist kostenlos, enthält keine Werbung und speichert alle deine Daten ausschließlich lokal auf deinem Gerät — es gibt kein Konto und keinen Server.",
      dataNote: "Die Petitionsdaten werden einmal täglich automatisch von den jeweiligen Plattformen abgeglichen und stehen danach offline zur Verfügung.",
      disclaimer: "Der PetitionsManager ist ein unabhängiges Werkzeug und gehört zu keiner der gelisteten Plattformen. Petitionen werden ausschließlich auf der jeweiligen Plattform selbst unterzeichnet — die App übermittelt keine Unterschriften und handelt nicht in deinem Namen.",
      /* Fakten-Liste (12.8.2026). „Bau" ist der versionCode: er zaehlt mit
         jedem Bau-Lauf hoch und unterscheidet zwei APKs, die dieselbe Fassung
         tragen. */
      factVersion: "Fassung",
      versionMitBau: "{v} (Bau {b})",
      versionWeb: "Web-Fassung",
      factData: "Datenstand",
      factScope: "Umfang",
      scopeWert: "{n} Petitionen auf {m} Plattformen",
      factSource: "Datenquelle",
      quelleLive: "Tagesaktuell von GitHub Pages",
      quellePaket: "Aus dem App-Paket",
      quelleFest: "Fest eingestellt",
      linkCode: "Quellcode",
      linkLizenz: "Lizenz: GPL-3.0",
      linkStatus: "Zustand der Quellen",
      linkKontakt: "Kontakt"
    },

    /* ---- Am 8.8.2026 aus app.js herausgezogen -------------------------------
       Alles ab hier stand vorher hartkodiert im Code und erschien deshalb in
       JEDER Sprache auf Deutsch. */

    /* Sprachen der PETITIONEN — nicht die der Oberflaeche. Die stehen in
       SPRACHEN in app.js und werden bewusst NICHT uebersetzt (jede Sprache
       nennt sich selbst). Hier ist es umgekehrt: „Englischsprachige
       Plattformen" ist eine Angabe UEBER die Plattform und gehoert in die
       Sprache des Lesers. Die Flaggen bleiben in app.js, sie sind gleich.
       groupLabel wird an langInfo().name angehaengt — im Deutschen ohne
       Bindestrich („Deutsch" + „sprachige Plattformen"). */
    lang: {
      de: "Deutsch",
      en: "Englisch",
      fr: "Französisch",
      es: "Spanisch",
      it: "Italienisch",
      other: "Andere",
      groupLabel: "{lang}sprachige Plattformen"
    },

    /* Ländernamen (4.9.2026). Zwilling zu lang.* — die Flagge kommt NICHT von
       hier, die rechnet app.js/landFlagge() aus dem ISO-Kürzel aus.
       Geführt sind die 27 EU-Mitgliedstaaten (weil europarl genau sie liefern
       kann), die deutschsprachigen Nachbarn und die fünf Länder, die am
       30.8.2026 bei Change.org auffielen (AT, CL, IT, UA, IN).
       ⚠️ Fehlt ein Kürzel hier, zeigt die App das Kürzel selbst an — sichtbar
       unfertig, aber nie leer und nie erfunden. */
    land: {
      /* ⚠️ Hieß bis 4.9.2026 „International" und wurde prompt als
         „fremdsprachig" gelesen. Gemeint ist: die Quelle nennt kein Land. */
      /* ⚠️ 4.9.2026 umbenannt. Vorher hießen die beiden „Ohne Landangabe" und
         „Land nicht erhoben" — Nutzer: „klingt wie das gleiche". Sachlich sind
         es zwei Dinge, aber die Wörter gaben das nicht her. Jetzt beschreibt
         das erste die PLATTFORM (sie sammelt länderübergreifend), das zweite
         unseren KENNTNISSTAND. */
      intl: "Weltweit",
      intlTitle: "Diese Plattform sammelt länderübergreifend und nennt kein einzelnes Land",
      offen: "Noch nicht zugeordnet",
      unknownTitle: "Diese Plattform kennt Länder – wir haben sie noch nicht erhoben",
      AT: "Österreich", BE: "Belgien", BG: "Bulgarien", CH: "Schweiz",
      CL: "Chile", CY: "Zypern", CZ: "Tschechien", DE: "Deutschland",
      DK: "Dänemark", EE: "Estland", ES: "Spanien", FI: "Finnland",
      FR: "Frankreich", GB: "Vereinigtes Königreich", GR: "Griechenland",
      HR: "Kroatien", HU: "Ungarn", IE: "Irland", IN: "Indien",
      IT: "Italien", LT: "Litauen", LU: "Luxemburg", LV: "Lettland",
      MT: "Malta", NL: "Niederlande", PL: "Polen", PT: "Portugal",
      RO: "Rumänien", SE: "Schweden", SI: "Slowenien", SK: "Slowakei",
      UA: "Ukraine", US: "Vereinigte Staaten",
      /* Nachgetragen 4.9.2026, als openPetition seine Länder hergab und im
         Selektor ein nacktes „AU" stand. Belegt in den Daten: AU. Dazu LI als
         deutschsprachiger Nachbar und TR, weil bei Change.org 34 von 60
         geprüften Kandidaten türkisch waren. */
      AU: "Australien", LI: "Liechtenstein", TR: "Türkei"
    },

    nav: {
      petitions: "Petitionen",
      settings: "Einstellungen",
      profile: "Profil",
      overview: "Übersicht",
      allPlatforms: "Alle Plattformen",
      toArchive: "Zum Archiv",
      backOverview: "Zurück zur Übersicht",
      backTo: "Zurück zu {name}"
    },

    /* ---- Bedienrahmen aus index.html (8.8.2026) --------------------------
       Kopfleiste, Fussleiste, Offline-Band und Nach-oben-Knopf stehen als
       festes Markup in index.html — die Datei wird geladen, bevor es texts.js
       oder app.js gibt, und kann T() deshalb nicht aufrufen. Die deutschen
       Worte bleiben dort als Rueckfall stehen (faellt app.js aus, ist die
       Bedienung trotzdem beschriftet); app.js ueberschreibt sie beim Start
       und bei jedem Sprachwechsel (setzeRahmenTexte(), aufgerufen aus
       applyLayout()).
       Die Reiter „Einstellungen" und „Profil" fehlen hier mit Absicht: sie
       tragen dieselben Worte wie nav.settings/nav.profile und lesen von dort,
       damit die Beschriftung nicht an zwei Stellen gepflegt werden muss. */
    shell: {
      tabList: "Liste",
      brandHome: "Zur Übersicht",
      reportBtn: "Fehler melden",
      reportTitle: "Fehler gefunden? Bitte melden!",
      reportAria: "Fehler gefunden? Bitte melden",
      offline: "Kein Internet. Du siehst gespeicherte Daten – " +
               "Bilder und Aktualisierungen fehlen.",
      offlineClose: "Hinweis schließen",
      toTop: "Nach oben"
    },

    msg: {
      loading: "Lade Daten …",
      loadingShort: "Lade …",
      loadError: "Daten konnten nicht geladen werden.<br>Prüfe die <b>Datenquelle</b> in den Einstellungen.",
      loadErrorShort: "Daten konnten nicht geladen werden.",
      noPlatforms: "Keine Plattform aktiviert.<br>Wähle in den <b>Einstellungen</b> aus, welche du sehen möchtest.",
      search: "Suchen",
      timeUnknown: "Zeitpunkt unbekannt"
    },

    /* Bedienfeld „Sortieren und filtern" ueber der Petitionsliste.
       catOne/catMany und die gap*-Paare sind Substantiv-Wendungen OHNE Zahl:
       app.js setzt die formatierte Zahl davor (zahl()). Deshalb im Deutschen
       gross, im Englischen klein. */
    tools: {
      title: "Sortieren und filtern",
      searchPlatform: "In dieser Plattform suchen …",
      sortHeading: "Sortierung",
      sortDefault: "Standard",
      date: "Datum",
      signatures: "Unterschriften",
      newestFirst: "Neueste zuerst",
      newSortOne: "1 neue Petition · neueste zuerst",
      newSortMany: "{n} neue Petitionen · neueste zuerst",
      newSortAria: "Nach Startdatum sortieren, neueste zuerst",
      oldestFirst: "Älteste zuerst",
      mostFirst: "Meiste Unterschriften zuerst",
      fewestFirst: "Wenigste Unterschriften zuerst",
      mostShort: "Meiste Unterschriften",
      fewestShort: "Wenigste Unterschriften",
      withoutCount: "ohne Unterschriftenzahl",
      withoutDate: "ohne Startdatum",
      gapOne: "Bei {n} Petition fehlt {was} – beim Sortieren steht sie am Ende.",
      gapMany: "Bei {n} Petitionen fehlt {was} – beim Sortieren stehen sie am Ende.",
      gapStartDate: "das Startdatum",
      gapSignatures: "die Unterschriftenzahl",
      noStartDates: "Diese Plattform liefert keine Startdaten.",
      noCounts: "Diese Plattform liefert keine Unterschriftenzahlen.",
      showAll: "Alle zeigen",
      showOnlyThese: "Nur diese zeigen",
      notesOff: "Infos deaktivieren",
      categories: "Kategorien ({n})",
      catAll: "Alle",
      catLabel: "Kategorie",
      tagLabel: "Schlagwort",
      crossSearch: "Plattformübergreifend suchen",
      resetFilter: "Filter zurücksetzen",
      jumpMiss: "Nicht in der angezeigten Liste",
      catOne: "Petition in dieser Kategorie",
      catMany: "Petitionen in dieser Kategorie",
      tagOne: "Petition mit diesem Schlagwort",
      tagMany: "Petitionen mit diesem Schlagwort",
      gapCountOne: "Petition ohne Unterschriftenzahl",
      gapCountMany: "Petitionen ohne Unterschriftenzahl",
      gapDateOne: "Petition ohne Startdatum",
      gapDateMany: "Petitionen ohne Startdatum"
    },

    /* Die drei Ausklapper unter der Liste (Beendet / Archiv / Offline). */
    bottom: {
      closed: "Beendet",
      closedEmpty: "Keine beendeten Petitionen.",
      archive: "Archiv",
      archiveEmpty: "Noch nichts archiviert. Wische eine Petition nach links.",
      offline: "Offline",
      offlineEmpty: "Keine Offline-Petitionen."
    },

    cross: {
      searching: "Suche über alle Plattformen …",
      typeCat: "Kategorie",
      typeTag: "Schlagwort",
      typeText: "Volltextsuche",
      hits: "{n} Treffer auf {p} Plattform(en)",
      noHits: "Keine Treffer.",
      empty: "Zu „{q}“ wurde auf den aktivierten Plattformen nichts gefunden."
    },

    io: {
      title: "Deine Daten sichern",
      note: "Favoriten, unterschrieben/archiviert, Plattform-Auswahl und Einstellungen als Datei sichern oder wiederherstellen.",
      exportBtn: "Exportieren",
      importBtn: "Importieren",
      exported: "✓ Sicherung exportiert ({fav} Favoriten, {sig} unterschrieben, {arch} archiviert).",
      imported: "✓ Importiert: {fav} Favoriten, {sig} unterschrieben, {arch} archiviert.",
      importFailed: "Import fehlgeschlagen: {fehler}",
      invalidBackup: "Keine gültige PetitionsManager-Sicherung.",
      unreadable: "Datei nicht lesbar."
    },

    offline: {
      imageMissing: "Bild – ohne Internet nicht verfügbar"
    },

    /* Betreffzeilen und Textvorlage der E-Mails. Sie erscheinen im
       Mailprogramm des Nutzers, sind also Bildschirmtext. Das Praefix
       „[PetitionsManager] " setzt app.js davor und bleibt unuebersetzt. */
    mail: {
      kodexViolation: "Verstoß gegen den Kodex",
      platformSuggestion: "Plattform-Vorschlag",
      missingPetition: "Fehlende Petition",
      wantToSupport: "Ich möchte unterstützen",
      rights: "Rechte an den Inhalten",
      bugSubject: "Fehlerbericht",
      viewCrossSearch: "Suche über alle Plattformen",
      viewPlatform: "Plattform {name}",
      bugBody: "Was hast du getan?\n\n\nWas ist passiert?\n\n\nWas hättest du erwartet?\n\n\n--- Technische Angaben (helfen beim Suchen, gerne kürzen) ---\nAnsicht: {ansicht}\nDaten: {daten}, Stand {stand}\nDarstellung: {darstellung}\nGerät: {geraet}\n",
      unknown: "unbekannt"
    }
  },

  en: {

    /* ⚠️ EIN Schluessel fehlt hier mit Absicht: impressumHtml. Es ist eine
       Pflichtangabe mit echter Anschrift; eine uebersetzte Fassung waere eine
       zweite Pflichtangabe, die auseinanderlaufen kann. T() faellt dafuer auf
       Deutsch zurueck — genau so gewollt (Nutzerentscheidung 8.8.2026), und
       checks.yml nimmt genau diesen einen Schluessel von der
       Vollstaendigkeitspflicht aus.
       Alles UEBRIGE ist seit 8.8.2026 uebersetzt (vorher stand hier nur der
       Wegweiser). kodexHtml ist woertlich uebertragen, ohne Abschwaechung:
       die Ausschlussgruende sind der Kern des Textes, ein weicherer
       englischer Satz waere eine andere Aussage. */
    legal: {
      kodexHtml: "<div class=\"kodex\"><div class=\"kodex__grp\"><div class=\"kodex__h\"><i class=\"fa-solid fa-circle-check\"></i> What we require of a platform</div><ul class=\"kodex__list\"><li>It makes public who operates it – a legal notice or an equivalent statement.</li><li>Its petitions can be read without an account.</li><li>It permits automated reading. We respect blocks in robots.txt and bot protection; we do not circumvent them.</li><li>It is open to everyone in principle and is not the stage for a single campaign.</li><li>It sets out in a comprehensible way how signatures are counted.</li></ul></div><div class=\"kodex__grp kodex__grp--stop\"><div class=\"kodex__h\"><i class=\"fa-solid fa-ban\"></i> What leads to exclusion</div><p>Excluded without any weighing up are platforms that spread or tolerate content that</p><ul class=\"kodex__list\"><li>demeans people because of their origin, skin color, nationality, religion, gender, sexual orientation, disability, age or social standing;</li><li>calls for hatred, violence or exclusion against individuals or groups;</li><li>denies or plays down the Holocaust or other genocides;</li><li>uses unconstitutional or banned symbols;</li><li>deliberately intimidates people, exposes them or makes them a target.</li></ul><p>This applies regardless of whether the platform publishes such content itself or merely lets it stand.</p></div><div class=\"kodex__grp\"><div class=\"kodex__h\"><i class=\"fa-solid fa-gavel\"></i> How we decide</div><ul class=\"kodex__list\"><li>We check every suggestion by hand before a platform is added.</li><li>If there is a substantiated report, we check again – and we do take a platform out again.</li><li>Individual petitions that breach this code we remove from the app, even if the platform stays.</li></ul></div><p class=\"kodex__note\"><i class=\"fa-solid fa-circle-info\"></i> <span><strong>What inclusion does not mean:</strong> PetitionsManager shows what is publicly available on the platforms. Including a platform is not a recommendation and not an endorsement of individual petitions. The authors of a petition and the platform in question are answerable for its content. We do not check every single petition in advance – tell us what you notice.</span></p></div>",

      title: "Legal",
      impressumTitle: "Legal notice",
      impressumTeaser: "Who provides this app and how to reach them.",
      rechteTitle: "Rights to the content",
      rechteTeaser: "Who owns the petition texts and images, and what has been agreed with the platforms.",
      kontaktBtn: "Get in touch",

      rechteLead: "<p class=\"legal__lead\">The petitions in this app come from third-party platforms. The copyright in their content – titles, appeal texts, images – lies with the respective authors or with the platform. PetitionsManager acquires no rights in it and grants none.</p><p class=\"legal__lead\">What is copied and what is not: title, summary, appeal text, signature count and date are fetched and stored in the app. The <strong>images are not copied</strong> but embedded from the platforms' servers – they stay there and are fetched from there when they are displayed.</p><p class=\"legal__lead\"><strong>The right of use is unresolved.</strong> The content is publicly accessible, and this app is non-commercial and its source code is open – but that does not amount to permission from the platforms. In the course of publication all operators are being asked; the table shows for each platform how far that has come.</p>",
      rechteNote: "<p class=\"legal__note\">If you speak for one of the platforms named here and you do not agree with the way your content is presented, write to us.</p>",
      platBetreiber: "Operator",
      platSitz: "Based in",
      platNutzungsrecht: "Right of use",
      platUnbekannt: "not known",
      keinImpressum: "No legal notice – operator outside German jurisdiction",
      standUngeklaert: "unresolved – not yet asked",
      standAngefragt: "asked on {datum} – no reply yet",
      standErlaubt: "use granted",
      standEingeschraenkt: "granted with restrictions",
      standAbgelehnt: "declined",
      standAntwort: "reply received",
      standAm: "{wort} on {datum}"
    },

    app: {
      name: "PetitionsManager",
      claim: "All petitions. One app.",
      welcomeTitle: "Your petitions at a glance",
      welcomeText: "Here you see the current petitions from every platform you have switched on. Use the search to find a particular topic.",
      tagline: "Petitions from 11 platforms in one place — free, ad-free, stored locally on your device."
    },

    wizard: {
      skip: "Skip",
      back: "Back",
      next: "Next",
      finish: "Let's go",
      stepOf: "Step {n} of {total}",
      intro: {
        title: "Welcome to PetitionsManager",
        text: "This app brings together petitions from 11 platforms in one place. You decide which ones you see — and you can filter, search and keep track of your signatures at any time.",
        cta: "Set up"
      },
      lang: {
        title: "Which languages should the petitions be in?",
        text: "Not to be confused with the app's interface language — you just picked that one and it stays as it is. This is about the language of the petitions themselves.",
        hint: "Choose at least one language."
      },
      land: {
        title: "Which countries?",
        text: "Many platforms collect signatures across borders — a German-language petition can come from Austria or Switzerland. Choose the countries you are interested in.",
        hint: "“Worldwide” covers platforms that collect across borders — they still show petitions in your language.",
        nodata: "Country data arrives with the next data run — until then only “Worldwide” appears here."
      },
      look: {
        title: "How should the app look?",
        text: "Pick whichever you prefer – you can change both at any time later."
      },
      platforms: {
        title: "Which platforms would you like to follow?",
        text: "Choose which platforms are shown to you in the list. Platforms you switch off can be brought back at any time.",
        hint: "You can change your selection at any time in the settings."
      },
      extras: {
        title: "Two last things",
        text: "Both are optional and can be changed at any time."
      },
      notifyInfo: "A short daily note about new petitions on your platforms. Your device will ask for permission once. No data is sent – the app only counts what it has already downloaded.",
      imagesLabel: "Images",
      imagesOn: "Images are loaded too.",
      imagesOff: "Text only – saves data.",
      imagesInfo: "The platforms embed full-size press photos in their appeal texts – some are over 17 MB. The app cannot shrink them because they sit inside the text; switching them off is the only way to save data.",
      importBtn: "Import a backup",
      importHint: "Already have a backup? Then we take everything from it and you are done right away.",
      done: {
        title: "All set.",
        text: "Your selection is saved. Tap a platform to see its current petitions — and swipe a petition to the right once you have signed it."
      },
      platCount: "{n} petitions"
    },

    liste: {
      intro: "Choose a platform to see its petitions.",
      searchPlaceholder: "Search all petitions…",
      searchHint: "Searches all switched-on platforms at once.",
      heroTitle: "Trending",
      emptyAll: "No platform switched on. In the settings, choose which ones you want to see.",
      emptyFiltered: "No petitions found. Change your search term or check your filters.",
      loading: "Loading petitions…",
      petitionsUnit: "petitions",
      alsoIn: "Also available in {sprachen}",
      newBadge: "+{n} new",
      countOf: "{n} of {total} petitions",
      reasonClosed: "closed",
      reasonArchived: "in the archive",
      reasonOffline: "offline",
      restNote: "The first {n} are shown — narrow your search to see more."
    },

    favorites: {
      title: "Favorites",
      howTitle: "Adding favorites",
      how: "Tap the star next to a platform to make it a favorite. Favorites always appear right at the top of the list.",
      empty: "No favorites yet. Tap the star next to a platform to keep it here.",
      hintDismiss: "Got it, don't show again"
    },

    petition: {
      favHint: "Tap the bookmark icon inside a petition to save it for later.",
      swipeHintTitle: "Swiping petitions",
      heroListTitle: "All petitions",
      swipeHint: "Swipe right to mark a petition as signed. Swiping again undoes it. Swipe left to archive it.",
      signedBadge: "Signed",
      similarTitle: "Same / similar petitions",
      openExtern: "Open petition",
      swipeSign: "Signed",
      swipeUndo: "Undo",
      swipeArchive: "Archive",
      swipeRestore: "Restore",
      signedInline: "signed",
      closed: "closed",
      closedOn: "closed {datum}",
      noTitle: "(untitled)",
      langFallback: "{sprache} version",
      langFallbackHint: "This petition is not available from {plattform} in " +
        "the language you selected. Shown is the platform's own text in " +
        "{sprache}.",
      startTitle: "Start of the petition",
      openExternAria: "Open petition externally",
      summary: "Summary",
      recipient: "Addressed to",
      startedBy: "Started by",
      description: "Description",
      textLoading: "Loading text…",
      tags: "Tags",
      metaStart: "Start: {datum}",
      noText: "There is no full text for this petition.",
      textError: "The text could not be loaded. Check your connection.",
      similarNone: "No similar petitions found.",
      similarSearching: "Searching all platforms…",
      similarSame: "same",
      similarTranslation: "Same petition in {sprache}",
      similarMore: "Show more ({n})",
      notInData: "This petition is no longer in this platform's data. Its address has probably changed.",
      swipeHintHtml: "Swipe a petition to the <b>right</b> to mark it as “signed”. <span class=\"hint-note\"><b>Important:</b> that does <u>not</u> sign it automatically – you have to do that yourself on the platform in question.</span> Swiping to the <b>left</b> archives the petition.",
      hintDismiss: "Got it, don't show this again"
    },

    signed: {
      title: "My signed petitions",
      intro: "These are all the petitions you have added your signature to.",
      empty: "Nothing here yet. When you sign a petition, swipe it to the right in the list — it will then end up here.",
      searchPlaceholder: "Search signed petitions…",
      searchHint: "Searches the title, platform and address (URL) of the petition — not the petition text itself.",
      countOne: "1 petition",
      countMany: "{n} petitions",
      milestones: {
        "1": "Your first signature. Every movement starts with one voice.",
        "5": "5 petitions — you keep taking a stand.",
        "10": "10 signatures. You know what matters to you.",
        "25": "25 petitions. Your voice carries weight — again and again.",
        "50": "Active 50 times. That is no coincidence, that is conviction.",
        "100": "100 signatures. Thank you for sticking with it."
      },
      hitsOf: "{n} of {total} hits",
      noHits: "No hits for “{q}”.",
      signedOn: "Signed on"
    },

    impact: [
      "A petition needs many voices — yours counts.",
      "Public pressure builds when enough people say the same thing.",
      "Every signature shows: this issue matters to a lot of people.",
      "Signing gives a cause more visibility.",
      "Petitions make problems visible before they can be solved.",
      "A few voices are not enough — which is exactly why every one matters.",
      "Persistence pays off: many petitions need time, not impatience.",
      "One voice alone moves little. Thousands of them move a lot."
    ],

    platform: {
      /* Heading above the slider on the platform page (8 Aug 2026, at the
         user's request). That slider is sorted by start date, newest
         first — so “Newest” describes it literally. On the home page the
         slider is still called liste.heroTitle (“Trending”), because that
         one is sorted by signatures per day. */
      heroTitle: "Newest",
      aboutBtn: "About this platform",
      aboutIntro: "Here you will find information on the operator, registered office and funding of this platform.",
      linksTitle: "Links",
      operatorLabel: "Operator",
      seatLabel: "Based in",
      foundedLabel: "Founded",
      financingLabel: "Funding",
      unknown: "not known",
      impressumLabel: "Legal notice",
      termsLabel: "Terms of use",
      sourceFor: "Source for this information",
      sourceForAria: "Source for {label}",
      website: "Website",
      dataSource: "Source of the data",
      opennessGood: "What is exemplary",
      opennessWish: "What would help",
      appSource: "Source code of this app",
      nerds: "For nerds",
      favAria: "Save platform as a favorite",
      signatures: "{n} signatures",
      perDay: "~{n}/day"
    },

    settings: {
      intro: "Adjust the app to suit your needs. All settings stay locally on your device.",
      sections: {
        data: "Data",
        notify: "Notifications",
        appearance: "Appearance",
        about: "About",
        reset: "Reset"
      },
      /* Language picker (8 Aug 2026). langLabel doubles as heading and as the
         control's aria-label; the button captions themselves are NOT here but
         in SPRACHEN in app.js — each language names itself, untranslated. */
      langLabel: "Language",
      langHint: "On first launch the app follows your device language.",
      themeLabel: "Color scheme",
      darkMode: "Dark theme",
      darkModeHint: "Choose a light or dark theme. “Auto” follows your device setting.",
      themeLight: "Light",
      themeDark: "Dark",
      themeAuto: "Auto",
      layoutLabel: "Layout",
      layoutRelief: "Relief",
      layoutMag: "Magazine",
      infoShow: "Show explanation",
      layoutHint: "Changes only the look, not the content. “Relief” is built in the neumorphism style (“soft UI”): cards, buttons and fields have the same color as the background and are shaped by light and shadow alone – tapped or switched on, they sink in. “Magazine” follows the style of modern news apps: cards set off with a soft shadow, the platform logos in their real brand colors, an accent color of your choice for everything active, and the petition image large at the top.",
      accentLabel: "Accent color",
      accentKoralle: "Coral",
      /* Visible heading above the text-color choice (8 Aug 2026, the user
         asked for “a heading here too, like Accent color”). The text used
         to be “Text” and was set by segControl ONLY as an aria-label, so
         it was never displayed — the choice sat below the color buttons
         with no heading at all. */
      accentInkLabel: "Accent text color",
      accentInkAuto: "Auto",
      accentInkLight: "Light",
      accentInkDark: "Dark",
      autoDark: "Follow system setting",
      descImagesLabel: "Load images in descriptions",
      descImagesOn: "Photos and logos are fetched from the internet when you open a petition. This requires an internet connection and uses up data – single images can be several megabytes in size. When you are out and about, it is best to switch this on only on Wi-Fi.",
      descImagesOff: "Text only. No image files are fetched from the internet, so images use no data at all.",
      refresh: "Refresh data",
      refreshHint: "Reloads the current petition data from the source.",
      source: "Data source",
      sourceHint: "Shows where the petition data is loaded from.",
      about: "About the app",
      srcAuto: "Automatic",
      srcBundled: "Bundled",
      srcLive: "Live",
      srcLiveShort: "live",
      srcBundledShort: "bundled",
      sourceCustom: "Your own source",
      sourceCustomHint: "For testing: your own base folder",
      sourcePrompt: "URL of the data source (base folder containing manifest.json):",
      sourceNoteAuto: "Active: {aktiv}{grund}. “Automatic” takes the daily data if it is reachable and newer than the bundled data.",
      sourceNoteBundled: "Only the data from the app package. It ages until a new version of the app arrives.",
      sourceNoteLive: "Always from the network. Without a connection the app falls back to the bundled data.",
      whyLiveUnreachable: "Live data not reachable",
      whyNoConnection: "No connection",
      whyBundledNewer: "The bundled data is newer",
      whyLive: "Updated daily from GitHub Pages",
      refreshedAt: "Refreshed on {zeit} · source: {quelle}",
      refreshChecking: "Checking the connection…",
      refreshNoPlatforms: "No platform switched on.",
      refreshProgress: "Loading {n} of {total}…",
      refreshDone: "{n} petitions loaded",
      refreshBroken: "{n} source(s) not reachable",
      refreshFailed: "Not reachable.",
      platformsTitle: "Platforms",
      activeCount: "{n}/{total} active",
      allOff: "Switch all off",
      allOn: "Switch all on",
      platMeta: "{n} petitions",
      platSoon: "in preparation",
      favMark: "Mark as a favorite"
    },

    notify: {
      intro: "You can have a summary sent to you once a day. You choose the time yourself.",
      enable: "Daily notification",
      timeLabel: "Time",
      quietLabel: "Notify me even when there is nothing new",
      quietHintOn: "You get a notification every day — even if nothing has changed.",
      quietHintOff: "You only get a notification when there are new petitions.",
      permissionAsk: "Your device is about to ask you for permission to send notifications.",
      permissionDenied: "Notifications are blocked in your system settings. Please allow them there for this app.",
      testBtn: "Test notification",
      sampleTitle: "PetitionsManager — daily overview",
      sampleBodyNew: "{n} new petitions are waiting for you.",
      sampleBodyNone: "Nothing new today — but maybe you overlooked one yesterday.",
      notSupported: "This device does not support notifications.",
      dailyAt: "Daily at {zeit}",
      off: "Off",
      testUnsupported: "This environment has no notifications — neither through the browser nor through the Android bridge.",
      testSent: "Sent. If it does not appear, notifications for the browser are switched off in your system settings.",
      testFailed: "Could not be sent.",
      deniedAndroid: "Notifications are blocked for this app. You can only undo that in the app's Android settings.",
      deniedBrowser: "You have declined notifications for this page. You can only undo that in your browser settings.",
      waiting: "Waiting for your permission…",
      noPermission: "No permission, no notification.",
      hintAndroid: "The reminder arrives at the time you chose, even when the app is closed. Android may delay it by a few minutes to save battery. How many petitions are new is shown in the app – the notification itself does not know the data.",
      hintBrowser: "Please note: the message appears the next time you open the app after the time you chose, or while it is still running in the background. A reminder with the app completely closed would need a server of its own – which this app deliberately does not have in the browser. In the Android app a system alarm takes care of it."
    },

    beenden: {
      title: "Close the app?",
      text: "You are back at the start. Pressing back again closes PetitionsManager.",
      ok: "Close",
      abbrechen: "Stay"
    },

    reset: {
      intro: "Here you can reset individual parts of the app or put everything back to its original state.",
      wizard: "Show setup assistant again",
      wizardHint: "Opens the welcome assistant again the next time the app starts.",
      hints: "Reset hints",
      hintsHint: "Shows all hidden tips and hints again.",
      all: "Reset everything",
      allHint: "Deletes all data this app has stored — this cannot be undone.",
      allWarnTitle: "Really delete everything?",
      allWarnText: "This irrevocably deletes: your favorites, all petitions marked as signed, the archive, your platform selection as well as your name and profile picture. The app then starts over as if for the first time.",
      allConfirmLabel: "Yes, delete everything",
      allConfirmBtn: "Delete permanently",
      cancel: "Cancel",
      doneToast: "Everything reset. The app is restarting.",
      hintsDone: "Reset – the hints will appear again."
    },

    profile: {
      intro: "You can add a name and a picture — so that you can find your exported data again more easily, for example.",
      nameLabel: "Your name",
      namePlaceholder: "What should the app call you?",
      photoLabel: "Profile picture",
      photoHint: "The picture is stored locally only and appears in the app.",
      photoRemove: "Remove picture",
      exportTitle: "Export data",
      exportHint: "Your name appears in the export file so you can tell later which one it is.",
      importTitle: "Import data",
      importHint: "Import a file you exported earlier to restore your settings and markings.",
      privacy: "Everything you enter stays on this device only — there is no account and no server.",
      title: "Profile",
      signedSuffix: "signed",
      impactFallback: "Every signature makes a cause a little more visible."
    },

    support: {
      title: "Support PetitionsManager",
      intro: "PetitionsManager is a free project. Your feedback and your ideas help make the app better.",
      missingPlatform: {
        q: "Is a platform missing?",
        a: "Do you know a petition platform that is still missing here? Let us know — we will look into adding it.",
        btn: "Suggest platform"
      },
      missingPetition: {
        q: "Is a petition missing?",
        a: "An important petition is not showing up? Best report it to us with a link.",
        btn: "Report petition"
      },
      help: {
        q: "Would you like to help?",
        a: "Pitch in — with feedback, ideas, translations or financial support via Liberapay.",
        btn: "Contribute"
      },
      share: {
        q: "Would you like to share the app?",
        a: "Share PetitionsManager with others who want to keep an eye on petitions from several platforms.",
        btn: "Share app"
      },
      /* Pointer to the Android build. Shown in the browser ONLY - inside the
         app it would be pointless (app.js checks window.AndroidBackup).
         Names the three things genuinely missing in the browser rather than
         generic praise: fully offline, background reminder, backup to file. */
      appTitle: "Get the installable app",
      appText: "In the browser the app loads petitions as you view them. The Android build already includes all of them: it works completely without a connection, can remind you daily and save your data to a file.",
      appBtn: "Get the Android app",
      kodexTitle: "Who we include — our code",
      kodexText: "These are the rules by which we decide which petition platform goes into the app and which does not.",
      kodexBtn: "Report a violation",
      donate: "Support financially",
      shareText: "Keep an eye on petitions from several platforms.",
      linkCopied: "Link copied",
      copyPrompt: "Copy link:"
    },

    about: {
      title: "About the app",
      text: "PetitionsManager brings together petitions from 11 independent platforms in one place. You can filter, search, mark petitions as signed and archive them. The app is free, contains no advertising and stores all your data locally on your device only — there is no account and no server.",
      dataNote: "The petition data is synchronized automatically once a day with the respective platforms and is available offline afterwards.",
      disclaimer: "PetitionsManager is an independent tool and does not belong to any of the platforms listed. Petitions are signed exclusively on the respective platform itself — the app does not transmit any signatures and does not act on your behalf.",
      factVersion: "Version",
      versionMitBau: "{v} (build {b})",
      versionWeb: "Web version",
      factData: "Data as of",
      factScope: "Scope",
      scopeWert: "{n} petitions across {m} platforms",
      factSource: "Data source",
      quelleLive: "Updated daily from GitHub Pages",
      quellePaket: "From the app package",
      quelleFest: "Fixed setting",
      linkCode: "Source code",
      linkLizenz: "License: GPL-3.0",
      linkStatus: "Source health",
      linkKontakt: "Contact"
    },

    /* ---- Pulled out of app.js on 8 Aug 2026 ---------------------------------
       Everything from here on used to be hard-coded and therefore appeared in
       German in every language. */

    /* Languages of the PETITIONS — not of the interface. Those live in
       SPRACHEN in app.js and are deliberately NOT translated (each language
       names itself). Here it is the other way round: “English-language
       platforms” is a statement ABOUT the platform and belongs in the
       reader's language. */
    lang: {
      de: "German",
      en: "English",
      fr: "French",
      es: "Spanish",
      it: "Italian",
      other: "Other",
      groupLabel: "{lang}-language platforms"
    },

    /* Country names — twin of lang.*; the flag is computed from the ISO code
       in app.js/landFlagge(), not stored here. US spelling throughout. */
    land: {
      intl: "Worldwide",
      intlTitle: "This platform collects across borders and states no single country",
      offen: "Not yet assigned",
      unknownTitle: "This platform does have countries — we have not collected them yet",
      AT: "Austria", BE: "Belgium", BG: "Bulgaria", CH: "Switzerland",
      CL: "Chile", CY: "Cyprus", CZ: "Czechia", DE: "Germany",
      DK: "Denmark", EE: "Estonia", ES: "Spain", FI: "Finland",
      FR: "France", GB: "United Kingdom", GR: "Greece",
      HR: "Croatia", HU: "Hungary", IE: "Ireland", IN: "India",
      IT: "Italy", LT: "Lithuania", LU: "Luxembourg", LV: "Latvia",
      MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal",
      RO: "Romania", SE: "Sweden", SI: "Slovenia", SK: "Slovakia",
      UA: "Ukraine", US: "United States",
      AU: "Australia", LI: "Liechtenstein", TR: "Türkiye"
    },

    nav: {
      petitions: "Petitions",
      settings: "Settings",
      profile: "Profile",
      overview: "Overview",
      allPlatforms: "All platforms",
      toArchive: "To the archive",
      backOverview: "Back to the overview",
      backTo: "Back to {name}"
    },

    shell: {
      tabList: "List",
      brandHome: "To the overview",
      reportBtn: "Report a bug",
      reportTitle: "Found a bug? Please report it!",
      reportAria: "Found a bug? Please report it",
      offline: "No internet. You are seeing saved data – " +
               "images and updates are missing.",
      offlineClose: "Close notice",
      toTop: "Back to top"
    },

    msg: {
      loading: "Loading data…",
      loadingShort: "Loading…",
      loadError: "The data could not be loaded.<br>Check the <b>data source</b> in the settings.",
      loadErrorShort: "The data could not be loaded.",
      noPlatforms: "No platform switched on.<br>In the <b>settings</b>, choose which ones you want to see.",
      search: "Search",
      timeUnknown: "Time unknown"
    },

    tools: {
      title: "Sort and filter",
      searchPlatform: "Search within this platform…",
      sortHeading: "Sorting",
      sortDefault: "Default",
      date: "Date",
      signatures: "Signatures",
      newestFirst: "Newest first",
      newSortOne: "1 new petition · newest first",
      newSortMany: "{n} new petitions · newest first",
      newSortAria: "Sort by start date, newest first",
      oldestFirst: "Oldest first",
      mostFirst: "Most signatures first",
      fewestFirst: "Fewest signatures first",
      mostShort: "Most signatures",
      fewestShort: "Fewest signatures",
      withoutCount: "without a signature count",
      withoutDate: "without a start date",
      gapOne: "{n} petition has no {was} – when sorting it goes to the end.",
      gapMany: "{n} petitions have no {was} – when sorting they go to the end.",
      gapStartDate: "start date",
      gapSignatures: "signature count",
      noStartDates: "This platform does not provide start dates.",
      noCounts: "This platform does not provide signature counts.",
      showAll: "Show all",
      showOnlyThese: "Show only these",
      notesOff: "Turn these notes off",
      categories: "Categories ({n})",
      catAll: "All",
      catLabel: "Category",
      tagLabel: "Tag",
      crossSearch: "Search across platforms",
      resetFilter: "Reset filters",
      jumpMiss: "Not in the list shown",
      catOne: "petition in this category",
      catMany: "petitions in this category",
      tagOne: "petition with this tag",
      tagMany: "petitions with this tag",
      gapCountOne: "petition without a signature count",
      gapCountMany: "petitions without a signature count",
      gapDateOne: "petition without a start date",
      gapDateMany: "petitions without a start date"
    },

    bottom: {
      closed: "Closed",
      closedEmpty: "No closed petitions.",
      archive: "Archive",
      archiveEmpty: "Nothing archived yet. Swipe a petition to the left.",
      offline: "Offline",
      offlineEmpty: "No offline petitions."
    },

    cross: {
      searching: "Searching all platforms…",
      typeCat: "Category",
      typeTag: "Tag",
      typeText: "Full-text search",
      hits: "{n} hits on {p} platform(s)",
      noHits: "No hits.",
      empty: "Nothing was found for “{q}” on the platforms you have switched on."
    },

    io: {
      title: "Back up your data",
      note: "Save or restore your favorites, signed/archived petitions, platform selection and settings as a file.",
      exportBtn: "Export",
      importBtn: "Import",
      exported: "✓ Backup exported ({fav} favorites, {sig} signed, {arch} archived).",
      imported: "✓ Imported: {fav} favorites, {sig} signed, {arch} archived.",
      importFailed: "Import failed: {fehler}",
      invalidBackup: "Not a valid PetitionsManager backup.",
      unreadable: "The file cannot be read."
    },

    offline: {
      imageMissing: "Image – not available without internet"
    },

    mail: {
      kodexViolation: "Violation of the code",
      platformSuggestion: "Platform suggestion",
      missingPetition: "Missing petition",
      wantToSupport: "I would like to support you",
      rights: "Rights to the content",
      bugSubject: "Bug report",
      viewCrossSearch: "Search across all platforms",
      viewPlatform: "Platform {name}",
      bugBody: "What did you do?\n\n\nWhat happened?\n\n\nWhat did you expect?\n\n\n--- Technical details (they help with the search, feel free to shorten) ---\nView: {ansicht}\nData: {daten}, as of {stand}\nAppearance: {darstellung}\nDevice: {geraet}\n",
      unknown: "unknown"
    }
  }
};
