/* platforms.js — Marken-Farben, Logos und Hintergrundinfos je Plattform.
   Wird vor app.js geladen und stellt window.PM_PLATFORMS bereit.
   Letzte Aktualisierung: 2026-07-29

   ---- Corporate Design: was hier steht und was in der Logodatei ----------
   Am 29.7.26 sind alle elf Marken gegen den Kopf ihrer eigenen Website
   abgeglichen worden, Wert für Wert. Dabei sind zwei Dinge auseinander-
   gefallen, die vorher als eines behandelt wurden:

     color      die HAUSFARBE der Plattform. Sie färbt die Bento-Kachel im
                Magazin-Layout, Chips und Akzente. Sie ist NICHT
                zwangsläufig die Farbe des Logos: Avaaz führt sein Zeichen
                schwarz und nutzt #e40a68 nur für Schaltflächen, 350.org und
                der Bundestag haben gar keine Logofarbe.
     Logodatei  trägt ihre Farben SELBST, in vier Rollen:
                  currentColor          adaptiv, folgt der Schriftfarbe
                  fill:var(--pl-b1, …)  Hausfarbe
                  fill:var(--pl-b2, …)  zweite Hausfarbe
                  fill="#ffffff"        feste Aussparung
                Welche Rolle wo gilt, steht ausführlich im Kopf jeder Datei;
                die kurze Fassung als Kommentar hinter logoFile.

   Warum die Rollen nicht einfach als festes Hex in der Datei stehen: sechs
   von acht Hausfarben fallen in EINEM der beiden Themen unter 3:1 (foodwatch
   1,84 hell, openPetition 2,34 hell, innn.it 2,78 hell, Ekō 2,54 dunkel,
   WeMove 1,12 dunkel). Deshalb gibt app.js/platLogo die themenrichtige Farbe
   aus dieser Tabelle in die Datei hinein — im dunklen Thema colorDark.

   logoAR ist nur noch der RÜCKFALL: app.js liest das Seitenverhältnis aus
   der viewBox der geladenen Datei. Die doppelte Buchführung war am 29.7.26
   die Fehlerquelle — hier stand für innn.it 2,64, die Datei zeichnete 3,65.

   Entfernt wurde das Feld logo: ein selbstgebautes Monogramm je Plattform
   („W", „i!", „WM" … als 24x24-SVG, zusammen 2,8 kB). Seit alle elf
   Plattformen ihre echte Marke haben, liest es niemand mehr — kein Treffer
   in app.js, texts.js oder index.html. */

window.PM_PLATFORMS = {

  /* ------------------------------------------------------------------ */
  weact: {
    color:     "#e9005f",          /* Vorgabefarbe des eigenen Logo-Bausteins cmpr-logo-weact (vorher geschaetzt #e03c1c) */
    colorSoft: "#fdebf2",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#f373a7",          /* aufgehellt fuer dunklen Hintergrund */
    logoFile: "logos/weact.svg",  /* Wortmarke, eine Hausfarbe (Rolle pl-b1) */
    logoAR:   1.423,
    logoNote: "https://www.campact.de/presse/",
    wikipedia: "https://de.wikipedia.org/wiki/Campact",
    tagline: "Petitionsplattform von Campact",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://www.campact.de/ueber-campact/impressum/",
      impressum: "https://www.campact.de/ueber-campact/impressum/",
      text: "WeAct ist die Petitionsplattform des gemeinnützigen Vereins Campact e. V. und richtet sich an alle, die eine gesellschaftspolitische Petition starten oder unterstützen möchten. Die Plattform bietet professionelle Kampagnenunterstützung durch das Campact-Team. Besonders geeignet für Anliegen mit gesellschaftspolitischer Dimension, die eine breite Unterstützung anstreben.",
      operator: "Campact e. V.",
      seat: "Verden (Aller), Deutschland",
      founded: 2004,
      financing: "Spenden",
      links: [
        { label: "Website",     url: "https://weact.campact.de" },
        { label: "Über uns",    url: "https://weact.campact.de/s/warum-weact-die-beste-plattform-fuer-deine-petition-ist" },
        { label: "Kontakt",     url: "https://www.campact.de/ueber-campact/kontakt/" },
        { label: "Datenschutz", url: "https://www.campact.de/campact/ueber-campact/datenschutz/" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  openpetition: {
    color:     "#29b0cc",          /* theme-color der eigenen Seite (vorher #2d8a4e, geschätzt) */
    colorSoft: "#eef9fb",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#89d4e3",          /* aufgehellt für dunklen Hintergrund */
    logoFile: "logos/openpetition.svg",  /* MEHRfarbig: Vogel pl-b1, Wortmarke adaptiv, weisse Aussparung */
    logoAR:   3.395,
    logoNote: "https://www.openpetition.de/content/legal_details",
    wikipedia: "https://de.wikipedia.org/wiki/OpenPetition",
    tagline: "Bürgerplattform für Petitionen",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://www.openpetition.de/content/legal_details",
      impressum: "https://www.openpetition.de/content/legal_details",
      text: "OpenPetition ist eine gemeinnützige Online-Plattform, auf der Bürgerinnen und Bürger Petitionen zu politischen, gesellschaftlichen und lokalen Themen starten und unterzeichnen können. Die Plattform wird von der openPetition gGmbH betrieben und versteht sich als unabhängige, werbefreie Infrastruktur für demokratische Beteiligung. Sie gehört zu den meistgenutzten Petitionsplattformen im deutschsprachigen Raum.",
      operator: "openPetition gGmbH",
      seat: "Berlin, Deutschland",
      founded: 2010,
      financing: "Spenden",
      links: [
        { label: "Website",     url: "https://www.openpetition.de" },
        { label: "Impressum & Kontakt", url: "https://www.openpetition.de/content/legal_details" },
        { label: "Datenschutz", url: "https://www.openpetition.de/content/data_privacy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  changeorg: {
    color:     "#f34e49",          /* eigenes Token --color-fill-brand-strong (faerbt das Kopf-Logo) (vorher #ec2c22) */
    colorSoft: "#fef1f0",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#f89e9b",          /* aufgehellt fuer dunklen Hintergrund */
    logoFile: "logos/changeorg.svg",  /* Wortmarke, alle 19 Pfade pl-b1 */
    logoAR:   5.104,
    logoNote: "https://www.change.org/l/en/press",
    wikipedia: "https://de.wikipedia.org/wiki/Change.org",
    tagline: "Globale Petitionsplattform",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://www.change.org/about",
      impressum: "https://www.change.org/policies",
      text: "Change.org ist eine der weltweit größten Petitionsplattformen und ermöglicht es Einzelpersonen, Petitionen zu jedem Thema zu starten und zu unterzeichnen. Die Plattform ist weltweit aktiv und in zahlreichen Sprachen verfügbar. Betrieben wird sie von Change.org PBC, einer amerikanischen Public Benefit Corporation mit Sitz in San Francisco.",
      operator: "Change.org, PBC",
      seat: "San Francisco, USA",
      founded: 2007,
      financing: null,
      links: [
        { label: "Website",     url: "https://www.change.org" },
        { label: "Hilfe & Kontakt", url: "https://help.change.org/contact-us" },
        { label: "Datenschutz", url: "https://www.change.org/policies/privacy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  innnit: {
    /* Belegt am 2026-07-29 im Inline-SVG des Seitenkopfs von https://innn.it
       (in Chrome nachgesehen). Vorher stand hier #fc691f aus dem App-Icon,
       davor das geschätzte #e8174a — beide waren daneben. */
    color:     "#F7661E",          /* Orange aller Buchstaben */
    colorSoft: "#fff3ed",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#fdac84",          /* aufgehellt für dunklen Hintergrund */
    /* ZWEITE Markenfarbe. innn.it färbt genau eine Form violett: den Punkt in
       „innn.it". Trägt in beiden Themen (gegen den Grund 3,51 hell / 4,64
       dunkel), deshalb braucht sie keinen eigenen Dunkelwert. */
    color2:    "#9466F2",          /* Violett, nur der Punkt */
    logoNote: "https://innn.it",
    logoFile: "logos/innnit.svg",  /* vollstaendige Wortmarke: Buchstaben pl-b1, Punkt pl-b2 */
    /* 1000 : 274 — die viewBox ist eng um die Tinte gelegt. Vorher 2,64: da
       lag in der Datei nur die „nnn"-Welle, es fehlten das führende „i", das
       „it" und der Punkt (vom Nutzer gemeldet, am Original bestätigt). */
    logoAR:   3.650,
    tagline: "Petitionen für Deutschland",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://innn.it/impressum",
      impressum: "https://innn.it/impressum",
      text: "innn.it ist eine gemeinnützige Petitionsplattform mit Schwerpunkt auf deutschen politischen und gesellschaftlichen Themen. Der Trägerverein innn.it e. V. wurde 2022 als eigenständige Organisation gegründet, nachdem die Plattform zunächst im Netzwerk von Change.org betrieben worden war. Die Finanzierung erfolgt vollständig durch Spenden.",
      operator: "innn.it e. V.",
      seat: "Berlin, Deutschland",
      founded: 2022,
      financing: "Spenden",
      links: [
        { label: "Website",     url: "https://innn.it" },
        { label: "Transparenz", url: "https://innn.it/transparenz" },
        { label: "Impressum & Kontakt", url: "https://innn.it/impressum" },
        { label: "Datenschutz", url: "https://innn.it/datenschutz" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  avaaz: {
    color:     "#e40a68",          /* eigenes Stylesheet, 7 Fundstellen (Magenta der Aktionsschaltflaeche) (vorher #005b99) */
    colorSoft: "#fdebf3",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#f078ac",          /* aufgehellt fuer dunklen Hintergrund */
    logoFile: "logos/avaaz.svg",  /* Wortmarke ohne Hausfarbe, ganz adaptiv */
    logoAR:   3.958,
    logoNote: "https://secure.avaaz.org/en/about.php",
    wikipedia: "https://de.wikipedia.org/wiki/Avaaz",
    tagline: "Globale Bürgerbewegung",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://secure.avaaz.org/en/about.php",
      impressum: null,
      text: "Avaaz ist eine globale Online-Bürgerbewegung, die sich für Demokratie, Menschenrechte, Tierschutz, Korruptionsbekämpfung und Klimaschutz einsetzt. Die Organisation wurde 2007 gegründet, ist vollständig mitgliederfinanziert und lehnt Unternehmens- und Regierungsgelder ab. Sie gehört zu den großen internationalen Kampagnen-Netzwerken.",
      operator: "Avaaz Foundation",
      seat: "London, Vereinigtes Königreich",
      founded: 2007,
      financing: "Mitgliederbeiträge und Spenden",
      links: [
        { label: "Website",     url: "https://avaaz.org" },
        { label: "Über uns",    url: "https://secure.avaaz.org/en/about.php" },
        { label: "Hilfe & Kontakt", url: "https://avaazhelp.zendesk.com/hc/de" },
        { label: "Datenschutz", url: "https://secure.avaaz.org/en/privacy/" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  bundestag: {
    color:     "#191919",          /* eigenes Stylesheet, 123 Fundstellen (Akzent waere #ff7100) (vorher #1e3a5f) */
    colorSoft: "#ededed",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#808080",          /* aufgehellt fuer dunklen Hintergrund */
    logoFile: "logos/bundestag.svg",  /* Wortmarke ohne Hausfarbe, ganz adaptiv */
    logoAR:   6.171,
    logoNote: "https://www.bundestag.de/services/presse",
    wikipedia: "https://de.wikipedia.org/wiki/Petitionsausschuss_(Deutscher_Bundestag)",
    tagline: "Offizielle Petitionen an den Bundestag",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://epetitionen.bundestag.de/epet/service.nc.$$$.rubrik.impressum.html",
      impressum: "https://epetitionen.bundestag.de/epet/service.nc.$$$.rubrik.impressum.html",
      text: "Das ePetitions-Portal des Deutschen Bundestages ermöglicht Bürgerinnen und Bürgern, offizielle Petitionen an den Petitionsausschuss zu richten. Öffentliche Petitionen können online mitgezeichnet werden und führen ab 50.000 Mitzeichnungen innerhalb von vier Wochen zu einer öffentlichen Sitzung des Ausschusses. Das Portal wird vom Deutschen Bundestag als staatliche Institution betrieben.",
      operator: "Deutscher Bundestag",
      seat: "Berlin, Deutschland",
      founded: null,
      financing: "Öffentlich (staatlich)",
      links: [
        { label: "Website",     url: "https://epetitionen.bundestag.de" },
        { label: "Impressum",   url: "https://epetitionen.bundestag.de/epet/service.nc.$$$.rubrik.impressum.html" },
        /* Der Kontakt steht NICHT auf dem Petitionsportal, sondern beim
           Ausschuss selbst (post.pet@bundestag.de, Anschrift, Telefon). */
        { label: "Petitionsausschuss (Kontakt)", url: "https://www.bundestag.de/ausschuesse/a02_Petitionsausschuss" },
        { label: "Datenschutz", url: "https://epetitionen.bundestag.de/epet/service.$$$.rubrik.datenschutz.html" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  europarl: {
    color:     "#003399",          /* Offizielles EU-Blau */
    colorSoft: "#e5e8f4",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#4d7acc",          /* aufgehellt für dunklen Hintergrund */
    logoFile: "logos/europarl.svg",  /* Emblem ohne Hausfarbe, ganz adaptiv */
    logoAR:   1.818,
    logoNote: "https://www.europarl.europa.eu/about-parliament/de/resources-and-links/resources/visual-identity",
    wikipedia: "https://de.wikipedia.org/wiki/Petitionsausschuss_des_Europäischen_Parlaments",
    tagline: "Petitionen ans EU-Parlament",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://www.europarl.europa.eu/legal-notice/de/",
      impressum: "https://www.europarl.europa.eu/legal-notice/de/",
      text: "Das Petitionsportal des Europäischen Parlaments (Ausschuss PETI) ermöglicht allen EU-Bürgerinnen und -Bürgern sowie in der EU ansässigen Personen, Petitionen zu Themen einzureichen, die in den Zuständigkeitsbereich der EU fallen. Eingereichte Petitionen werden vom Petitionsausschuss geprüft, der über Zulässigkeit und weitere Behandlung entscheidet. Das Portal ist mehrsprachig und wird vom Europäischen Parlament betrieben.",
      operator: "Europäisches Parlament",
      seat: "Straßburg / Brüssel, EU",
      founded: null,
      financing: "Öffentlich (EU)",
      links: [
        { label: "Website",     url: "https://www.europarl.europa.eu/petitions/" },
        { label: "Über das Verfahren", url: "https://www.europarl.europa.eu/petitions/de/artcl/Welcome+to+the+Petitions+Web+Portal/det/20220906CDT10122" },
        { label: "Kontakt",     url: "https://www.europarl.europa.eu/portal/de/contact" },
        { label: "Datenschutz", url: "https://www.europarl.europa.eu/petitions/de/artcl/Privacy+Policy+Statements/det/20240115CDT12863" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  wemove: {
    color:     "#21194f",          /* theme-color der eigenen Seite, am 2026-07-29 bestätigt (vorher #6b3fa0, geschätzt) */
    colorSoft: "#ededf1",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#85809e",          /* aufgehellt für dunklen Hintergrund */
    /* ZWEITE Markenfarbe, belegt in der eigenen Logodatei der Plattform
       (logo_3_8acffc909d.svg über strapiapp.com, 2026-07-29). Sie trägt dort
       72 der 80 Formen — das gepunktete Muster —, während das Dunkelblau nur
       die Wortmarke füllt. Hält in beiden Themen (3,38 hell / 4,81 dunkel). */
    color2:    "#C552DF",          /* Magenta des Musters */
    logoFile: "logos/wemove.svg",  /* MEHRfarbig: Muster pl-b2, Wortmarke adaptiv */
    logoAR:   2.072,
    logoNote: "https://wemove.eu/en/about-us",
    tagline: "Europäische Bürgerbewegung",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://wemove.eu/de/impressum",
      impressum: "https://wemove.eu/de/impressum",
      text: "WeMove Europe ist eine europäische Bürgerbewegung, die sich für Demokratie, Klimagerechtigkeit und soziale Rechte in der EU einsetzt. Die Organisation wurde 2015 gegründet und ist als Europäische Genossenschaft (SCE) mit Sitz in Berlin registriert. Die Finanzierung erfolgt über Spenden von Mitgliedern; Gelder von Konzernen oder staatlichen Stellen werden abgelehnt.",
      operator: "WeMove Europe SCE mbH",
      seat: "Berlin, Deutschland",
      founded: 2015,
      financing: "Mitgliederspenden und Stiftungen",
      links: [
        { label: "Website",           url: "https://www.wemove.eu" },
        { label: "Finanzierung",      url: "https://www.wemove.eu/en/how-we-are-funded" },
        { label: "Impressum & Kontakt", url: "https://wemove.eu/de/impressum" },
        { label: "Datenschutz",       url: "https://www.wemove.eu/en/privacy-policy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  eko: {
    color:     "#6400ff",          /* Farbe im offiziellen Logo (vorher #7b2d8b, geschätzt) */
    colorSoft: "#f3ebff",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#aa73ff",          /* aufgehellt für dunklen Hintergrund */
    logoFile: "logos/eko.svg",  /* Wortmarke, eine Hausfarbe (Rolle pl-b1) */
    logoAR:   1.811,
    logoNote: "https://eko.org/eko/",
    wikipedia: "https://de.wikipedia.org/wiki/SumOfUs",
    tagline: "Konzernkritische Kampagnenplattform",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://eko.org/about",
      impressum: null,
      text: "Ekō (bis 2023 bekannt als SumOfUs) ist eine internationale Kampagnenorganisation, die sich für Bürgerinnen- und Verbraucherrechte gegenüber Konzernen einsetzt. Die Organisation wurde 2011 gegründet, 2023 umbenannt und betreibt Petitionen sowie Aktionen zu Themen wie Klimaschutz, Lebensmittelsicherheit und Unternehmensverantwortung. Ekō ist als gemeinnützige 501(c)4-Organisation in den USA registriert.",
      operator: "Ekō (ehemals SumOfUs), 501(c)4",
      seat: "San Francisco, USA",
      founded: 2011,
      financing: null,
      links: [
        { label: "Website",     url: "https://eko.org" },
        /* Ekō hat keine eigene Kontaktseite — /en/contact, /en/contact-us und
           /en/imprint liefern alle die Fehlerseite. Die Adressen (info@,
           press@, corporate@eko.org) stehen auf „Über uns". */
        { label: "Über uns & Kontakt", url: "https://eko.org/about" },
        { label: "Datenschutz", url: "https://eko.org/en/privacy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  foodwatch: {
    color:     "#f7a600",          /* Farbe im offiziellen Logo (vorher #e8600a, geschätzt) */
    colorSoft: "#fef8eb",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#fbce73",          /* aufgehellt für dunklen Hintergrund */
    logoFile: "logos/foodwatch.svg",  /* MEHRfarbig: „food" pl-b1, „watch" adaptiv, weisse Scheibe */
    logoAR:   5.232,
    logoNote: "https://www.foodwatch.org/de/presse/",
    wikipedia: "https://de.wikipedia.org/wiki/Foodwatch",
    tagline: "Verbraucherrechte im Lebensmittelbereich",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://www.foodwatch.org/de/impressum",
      impressum: "https://www.foodwatch.org/de/impressum",
      text: "foodwatch e. V. ist eine gemeinnützige Verbraucherrechtsorganisation, die sich für gesunde, sichere und ehrlich gekennzeichnete Lebensmittel einsetzt. Der Verein wurde 2002 von Thilo Bode in Berlin gegründet und finanziert sich ausschließlich durch Mitgliedsbeiträge und Spenden — staatliche Gelder und Wirtschaftsspenden werden abgelehnt. Petitionen und Kampagnen richten sich an Lebensmittelhersteller und politische Entscheidungsträger.",
      operator: "foodwatch e. V.",
      seat: "Berlin, Deutschland",
      founded: 2002,
      financing: "Mitgliedsbeiträge und Spenden",
      links: [
        { label: "Website",     url: "https://www.foodwatch.org/de/" },
        { label: "Über uns",    url: "https://www.foodwatch.org/de/ueber-uns/" },
        { label: "Impressum & Kontakt", url: "https://www.foodwatch.org/de/impressum" },
        { label: "Datenschutz", url: "https://www.foodwatch.org/de/datenschutz" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  threefifty: {
    color:     "#0f81e8",          /* Markenblau, offiziell aus 350.org Brand Toolkit */
    colorSoft: "#e6f0fc",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#5ab0ff",          /* aufgehellt für dunklen Hintergrund */
    logoFile: "logos/threefifty.svg",  /* Wortmarke ohne Hausfarbe, ganz adaptiv */
    logoAR:   2.666,
    logoNote: "https://350.org/brand-toolkit/",
    wikipedia: "https://de.wikipedia.org/wiki/350.org",
    tagline: "Klimabewegung gegen fossile Brennstoffe",
    about: {
      /* Quelle des Steckbriefs: hier sind Traeger, Sitz, Gruendung und
         Finanzierung nachpruefbar. Am 6.8.2026 abgerufen und gegen eine
         ERFUNDENE Schwester-Adresse gegengeprueft (Soft-404-Falle). */
      quelle: "https://350.org/about/",
      impressum: null,
      text: "350.org ist eine internationale Klimaschutzorganisation, die sich für das Ende der Nutzung fossiler Brennstoffe und eine gerechte Energiewende einsetzt. Die Organisation wurde 2007–2008 gegründet und betreibt ein globales Netzwerk lokaler Gruppen. Sie ist als gemeinnützige 501(c)3-Organisation in den USA registriert und finanziert sich durch Spenden.",
      operator: "350.org, 501(c)3",
      seat: "Boston, USA (mit globalem Netzwerk)",
      founded: 2008,
      financing: "Spenden",
      links: [
        { label: "Website",       url: "https://350.org" },
        { label: "Über uns",      url: "https://350.org/about/" },
        { label: "Kontakt",       url: "https://350.org/contact/" },
        { label: "Datenschutz",   url: "https://350.org/privacy/" },
        { label: "Brand-Toolkit", url: "https://350.org/brand-toolkit/" }
      ]
    }
  }

};
