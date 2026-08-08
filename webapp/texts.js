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

   ⚠️ Rund 120 weitere Texte stehen noch HARTKODIERT in app.js (Kodex,
   Impressum, Nutzungsrecht, Fehlermeldungen). Sie sind bewusst noch nicht
   hier: sie muessen erst herausgezogen werden. Bis dahin erscheinen sie in
   jeder Sprache auf Deutsch. */
window.PM_TEXTS = {
  de: {

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
      lang: {
        title: "Welche Sprachen interessieren dich?",
        text: "Wähle die Plattform-Sprachen aus, die du sehen möchtest. Du kannst das jederzeit in den Einstellungen ändern.",
        hint: "Mindestens eine Sprache wählen."
      },
      platforms: {
        title: "Welche Plattformen möchtest du beobachten?",
        text: "Wähle aus, welche Plattformen dir in der Liste angezeigt werden. Deaktivierte Plattformen kannst du jederzeit wieder einblenden.",
        hint: "Du kannst die Auswahl jederzeit in den Einstellungen ändern."
      },
      done: {
        title: "Alles bereit.",
        text: "Deine Auswahl ist gespeichert. Tippe auf eine Plattform, um ihre aktuellen Petitionen zu sehen — und wische eine Petition nach rechts, wenn du unterschrieben hast."
      }
    },

    liste: {
      intro: "Wähle eine Plattform, um ihre Petitionen zu sehen.",
      searchPlaceholder: "Alle Petitionen durchsuchen …",
      searchHint: "Sucht gleichzeitig über alle aktivierten Plattformen.",
      heroTitle: "Im Trend",
      emptyAll: "Keine Plattform aktiviert. Wähle in den Einstellungen aus, welche du sehen möchtest.",
      emptyFiltered: "Keine Petitionen gefunden. Ändere den Suchbegriff oder überprüfe deine Filter.",
      loading: "Lade Petitionen …"
    },

    favorites: {
      title: "Favoriten",
      howTitle: "Favoriten anlegen",
      how: "Tippe auf den Stern neben einer Plattform, um sie zu einem Favoriten zu machen. Favoriten erscheinen immer ganz oben in der Liste.",
      empty: "Noch keine Favoriten. Tippe auf den Stern neben einer Plattform, um sie hier abzulegen."
    },

    petition: {
      favHint: "Tippe auf das Lesezeichen-Symbol in der Petition, um sie zu merken.",
      swipeHintTitle: "Petitionen wischen",
      heroListTitle: "Alle Petitionen",
      swipeHint: "Wische nach rechts, um eine Petition als unterschrieben zu markieren. Nochmal wischen setzt das zurück. Wische nach links, um sie zu archivieren.",
      signedBadge: "Unterschrieben",
      similarTitle: "Gleiche / Ähnliche Petitionen",
      openExtern: "Petition öffnen"
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
      }
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
      unknown: "nicht bekannt"
    },

    settings: {
      intro: "Passe die App an deine Bedürfnisse an. Alle Einstellungen bleiben lokal auf deinem Gerät.",
      sections: {
        data: "Daten",
        notify: "Benachrichtigungen",
        appearance: "Darstellung",
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
      darkModeHint: "Wähle helles oder dunkles Design. „Automatisch“ folgt der Einstellung deines Geräts.",
      themeLight: "Hell",
      themeDark: "Dunkel",
      themeAuto: "Automatisch",
      layoutLabel: "Layout",
      layoutRelief: "Relief",
      layoutMag: "Magazin",
      layoutHint: "Ändert nur das Aussehen, nicht die Inhalte. „Relief“ ist im Stil des Neumorphismus gebaut („Soft UI“): Karten, Knöpfe und Felder haben dieselbe Farbe wie der Hintergrund und werden nur durch Licht und Schatten geformt – angetippt oder eingeschaltet sinken sie ein. „Magazin“ ist im Stil moderner Nachrichten-Apps gehalten: weiße Karten auf hellem Grund, die Logos der Plattformen in ihren echten Markenfarben, eine Korallfarbe für alles Aktive und das Bild der Petition groß nach oben.",
      accentLabel: "Akzentfarbe",
      accentKoralle: "Koralle",
      /* Sichtbare Ueberschrift ueber der Schriftfarben-Auswahl (8.8.2026,
         Nutzerwunsch „hier auch eine Überschrift wie Akzentfarbe"). Der Text
         war vorher „Schrift" und wurde von segControl NUR als aria-label
         gesetzt, also nie angezeigt — die Auswahl stand ueberschriftenlos
         unter den Farbknoepfen. */
      accentInkLabel: "Akzent-Schriftfarbe",
      accentInkAuto: "Automatisch",
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
      about: "Über die App"
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
      sampleBodyNone: "Heute nichts Neues — aber gestern hast du vielleicht noch eine übersehen."
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
      doneToast: "Alles zurückgesetzt. Die App startet neu."
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
      privacy: "Alle deine Eingaben bleiben ausschließlich auf diesem Gerät — es gibt kein Konto und keinen Server."
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
      }
    },

    about: {
      title: "Über die App",
      text: "PetitionsManager bündelt Petitionen von 11 unabhängigen Plattformen an einem Ort. Du kannst filtern, suchen, Petitionen als unterzeichnet markieren und archivieren. Die App ist kostenlos, enthält keine Werbung und speichert alle deine Daten ausschließlich lokal auf deinem Gerät — es gibt kein Konto und keinen Server.",
      dataNote: "Die Petitionsdaten werden einmal täglich automatisch von den jeweiligen Plattformen abgeglichen und stehen danach offline zur Verfügung.",
      disclaimer: "Der PetitionsManager ist ein unabhängiges Werkzeug und gehört zu keiner der gelisteten Plattformen. Petitionen werden ausschließlich auf der jeweiligen Plattform selbst unterzeichnet — die App übermittelt keine Unterschriften und handelt nicht in deinem Namen."
    }
  },

  en: {

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
        title: "Which languages are you interested in?",
        text: "Choose the platform languages you want to see. You can change this at any time in the settings.",
        hint: "Choose at least one language."
      },
      platforms: {
        title: "Which platforms would you like to follow?",
        text: "Choose which platforms are shown to you in the list. Platforms you switch off can be brought back at any time.",
        hint: "You can change your selection at any time in the settings."
      },
      done: {
        title: "All set.",
        text: "Your selection is saved. Tap a platform to see its current petitions — and swipe a petition to the right once you have signed it."
      }
    },

    liste: {
      intro: "Choose a platform to see its petitions.",
      searchPlaceholder: "Search all petitions…",
      searchHint: "Searches all switched-on platforms at once.",
      heroTitle: "Trending",
      emptyAll: "No platform switched on. In the settings, choose which ones you want to see.",
      emptyFiltered: "No petitions found. Change your search term or check your filters.",
      loading: "Loading petitions…"
    },

    favorites: {
      title: "Favorites",
      howTitle: "Adding favorites",
      how: "Tap the star next to a platform to make it a favorite. Favorites always appear right at the top of the list.",
      empty: "No favorites yet. Tap the star next to a platform to keep it here."
    },

    petition: {
      favHint: "Tap the bookmark icon inside a petition to save it for later.",
      swipeHintTitle: "Swiping petitions",
      heroListTitle: "All petitions",
      swipeHint: "Swipe right to mark a petition as signed. Swiping again undoes it. Swipe left to archive it.",
      signedBadge: "Signed",
      similarTitle: "Same / similar petitions",
      openExtern: "Open petition"
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
      }
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
      seatLabel: "Registered office",
      foundedLabel: "Founded",
      financingLabel: "Funding",
      unknown: "not known"
    },

    settings: {
      intro: "Adjust the app to suit your needs. All settings stay locally on your device.",
      sections: {
        data: "Data",
        notify: "Notifications",
        appearance: "Appearance",
        reset: "Reset"
      },
      /* Language picker (8 Aug 2026). langLabel doubles as heading and as the
         control's aria-label; the button captions themselves are NOT here but
         in SPRACHEN in app.js — each language names itself, untranslated. */
      langLabel: "Language",
      langHint: "On first launch the app follows your device language.",
      themeLabel: "Color scheme",
      darkMode: "Dark theme",
      darkModeHint: "Choose a light or dark theme. “Automatic” follows your device setting.",
      themeLight: "Light",
      themeDark: "Dark",
      themeAuto: "Automatic",
      layoutLabel: "Layout",
      layoutRelief: "Relief",
      layoutMag: "Magazine",
      layoutHint: "Changes only the look, not the content. “Relief” is built in the neumorphism style (“soft UI”): cards, buttons and fields have the same color as the background and are shaped by light and shadow alone – tapped or switched on, they sink in. “Magazine” follows the style of modern news apps: white cards on a light background, the platform logos in their real brand colors, a coral color for everything active, and the petition image large at the top.",
      accentLabel: "Accent color",
      accentKoralle: "Coral",
      /* Visible heading above the text-color choice (8 Aug 2026, the user
         asked for “a heading here too, like Accent color”). The text used
         to be “Text” and was set by segControl ONLY as an aria-label, so
         it was never displayed — the choice sat below the color buttons
         with no heading at all. */
      accentInkLabel: "Accent text color",
      accentInkAuto: "Automatic",
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
      about: "About the app"
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
      sampleBodyNone: "Nothing new today — but maybe you overlooked one yesterday."
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
      doneToast: "Everything reset. The app is restarting."
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
      privacy: "Everything you enter stays on this device only — there is no account and no server."
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
      }
    },

    about: {
      title: "About the app",
      text: "PetitionsManager brings together petitions from 11 independent platforms in one place. You can filter, search, mark petitions as signed and archive them. The app is free, contains no advertising and stores all your data locally on your device only — there is no account and no server.",
      dataNote: "The petition data is synchronized automatically once a day with the respective platforms and is available offline afterwards.",
      disclaimer: "PetitionsManager is an independent tool and does not belong to any of the platforms listed. Petitions are signed exclusively on the respective platform itself — the app does not transmit any signatures and does not act on your behalf."
    }
  }
};
