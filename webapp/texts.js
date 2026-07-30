/* texts.js — saemtliche Bildschirmtexte der App an einem Ort.
   Wird vor app.js geladen und stellt window.PM_TEXTS bereit. */
window.PM_TEXTS = {
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
    emptyAll: "Keine Plattform aktiviert. Wähle in den Einstellungen aus, welche du sehen möchtest.",
    emptyFiltered: "Keine Petitionen gefunden. Ändere den Suchbegriff oder überprüfe deine Filter.",
    loading: "Lade Petitionen …"
  },

  favorites: {
    title: "Favoriten",
    how: "Tippe auf den Stern neben einer Plattform, um sie zu einem Favoriten zu machen. Favoriten erscheinen immer ganz oben in der Liste.",
    empty: "Noch keine Favoriten. Tippe auf den Stern neben einer Plattform, um sie hier abzulegen."
  },

  petition: {
    favHint: "Tippe auf das Lesezeichen-Symbol in der Petition, um sie zu merken.",
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
    darkMode: "Dunkles Design",
    darkModeHint: "Wähle helles oder dunkles Design. „Automatisch“ folgt der Einstellung deines Geräts.",
    themeLight: "Hell",
    themeDark: "Dunkel",
    themeAuto: "Automatisch",
    layoutLabel: "Layout",
    layoutClassic: "Klassisch",
    layoutRelief: "Relief",
    layoutMag: "Magazin",
    layoutHint: "Ändert nur das Aussehen, nicht die Inhalte. „Klassisch“ ist die bisherige Ansicht. „Relief“ ist im Stil des Neumorphismus gebaut („Soft UI“): Karten, Knöpfe und Felder haben dieselbe Farbe wie der Hintergrund und werden nur durch Licht und Schatten geformt – angetippt oder eingeschaltet sinken sie ein. „Magazin“ ordnet die Plattformen als Kachelraster in ihren echten Markenfarben an und stellt das Bild der Petition groß nach oben.",
    autoDark: "Systemeinstellung folgen",
    descImagesLabel: "Bilder in Beschreibungen laden",
    descImagesOn: "Fotos und Logos aus dem Aufruf werden geladen – einzelne sind mehrere Megabyte groß.",
    descImagesOff: "Nur Text. Es werden keine Bilddateien abgerufen.",
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
};
