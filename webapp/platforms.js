/* platforms.js — Marken-Farben, Logos und Hintergrundinfos je Plattform.
   Wird vor app.js geladen und stellt window.PM_PLATFORMS (deutsch) sowie
   window.PM_PLATFORMS_EN (englisch, ganz unten) bereit.
   Letzte Aktualisierung: 2026-08-08 (Sprachebene)

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
      agb: "https://weact.campact.de/s/nutzungsbedingungen",
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
      agb: "https://www.openpetition.de/content/terms_of_use",
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
      agb: "https://www.change.org/policies/terms-of-service",
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
      agb: "https://innn.it/nutzungsbedingungen",
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
      /* ⚠️ KORREKTUR 7.8.2026 (vom Nutzer gefunden): hier stand faelschlich
         null. Avaaz FUEHRT ein Impressum, nur unter einem Pfadmuster, das
         meine Suche nicht abgedeckt hatte — /campaign/en/ statt /page/en/
         oder /en/. Gegengeprueft: 200 und Titel "Avaaz - Imprint", waehrend
         /campaign/en/gibtsnicht123/ sauber mit 404 antwortet.
         Der INHALT der Seite erscheint erst nach Cookie-Zustimmung; deshalb
         bleibt about.php die Steckbrief-Quelle, denn dort sind Traeger und
         Sitz auch ohne Zustimmung nachlesbar. */
      impressum: "https://secure.avaaz.org/campaign/en/imprint/",
      agb: "https://secure.avaaz.org/de/terms-of-use/",
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
      agb: "https://epetitionen.bundestag.de/epet/service.nc.$$$.rubrik.nutzungsbedingungen.html",
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
      /* Keine eigenen Nutzungsbedingungen — der Rechtliche Hinweis ist hier das Aequivalent, er steht schon als impressum
         (7.8.2026 geprueft). null heisst hier "gibt es nicht", nicht
         "noch nicht nachgesehen". */
      agb: null,
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
      /* Keine eigenen Nutzungsbedingungen — verlinkt von seinen eigenen Rechtsseiten nur Impressum und Datenschutz
         (7.8.2026 geprueft). null heisst hier "gibt es nicht", nicht
         "noch nicht nachgesehen". */
      agb: null,
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
      /* Keine eigenen Nutzungsbedingungen — 93 Seiten in der Sitemap, keine einzige mit Bedingungen
         (7.8.2026 geprueft). null heisst hier "gibt es nicht", nicht
         "noch nicht nachgesehen". */
      agb: null,
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
      /* Keine eigenen Nutzungsbedingungen — verlinkt von seinen eigenen Rechtsseiten nur Impressum und Datenschutz
         (7.8.2026 geprueft). null heisst hier "gibt es nicht", nicht
         "noch nicht nachgesehen". */
      agb: null,
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
      agb: "https://350.org/de/nutzungsbedingungen/",
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

/* ============================================================================
   SPRACHEBENE (8.8.2026)
   ============================================================================
   Oben stehen die Stammdaten auf DEUTSCH — unveraendert, Wert fuer Wert an
   derselben Stelle wie vorher. Hier folgt die englische Fassung als eigener,
   PARALLELER Block mit denselben Schluesseln.

   WARUM SO und nicht `text_en` neben jedem `text`:
     • Der deutsche Block bleibt unangetastet. Er traegt die aufwaendig
       belegten Farb- und Logo-Kommentare (Rollen der SVG-Fuellungen,
       Kontrastwerte, die Korrektur an innn.it); jedes Feld dort anzufassen
       hiesse, diese Begruendungen zu zerschneiden.
     • Es ist derselbe Bauplan wie in texts.js: EIN Baum je Sprache, gleiche
       Schluessel. Wer das eine verstanden hat, versteht das andere — statt
       zweier Muster fuer dasselbe Problem.
     • Eine dritte Sprache ist ein dritter Block plus eine Zeile in app.js
       (PLATS_LANG). Mit `text_en`/`text_fr`/`text_es` waeren es 11 Stellen
       mit je drei Feldern, zwischen denen die Farbkommentare stehen.

   RUECKFALL AUF DEUTSCH: Dieser Block ist mit Absicht LUECKENHAFT. Es steht
   nur drin, was auf Englisch WIRKLICH anders lautet. Was fehlt — Eigennamen
   wie "Campact e. V." oder "Change.org, PBC", "San Francisco, USA", ein
   fehlendes financing —, holt app.js aus dem deutschen Block; platAbout()
   legt die Uebersetzung ueber die deutschen Werte statt sie zu ersetzen.
   Fehlt der ganze Block (alte Datei im Cache), laeuft die App auf Deutsch
   weiter, so wie sie es vor dem 8.8.2026 getan hat.

   NICHT uebersetzt, weil es keine Sprache hat: color/colorSoft/colorDark,
   logoFile, logoAR, wikipedia, founded und saemtliche URLs (quelle,
   impressum, agb, links[].url). Sie stehen weiterhin nur oben.

   ⚠️ _linkLabels ist KEINE Plattform. Der Unterstrich sagt das; Code, der
   ueber diesen Block laeuft, darf ihn nicht als zwoelfte Plattform lesen.
   Die Beschriftungen wiederholen sich quer ueber die Plattformen
   ("Datenschutz" elfmal, "Website" elfmal) — als Woerterbuch sind es 12
   Zeilen statt 45, und die Reihenfolge der Links darf sich aendern, ohne
   dass eine Uebersetzung verrutscht. Nachgeschlagen wird ueber die DEUTSCHE
   Beschriftung; was nicht drinsteht, bleibt deutsch stehen.
   "Website" fehlt bewusst: gleiches Wort, der Rueckfall liefert dasselbe. */

window.PM_PLATFORMS_EN = {

  _linkLabels: {
    "Über uns":                    "About us",
    "Über uns & Kontakt":          "About us & contact",
    "Über das Verfahren":          "About the procedure",
    "Kontakt":                     "Contact",
    "Hilfe & Kontakt":             "Help & contact",
    "Impressum":                   "Legal notice",
    "Impressum & Kontakt":         "Legal notice & contact",
    "Datenschutz":                 "Privacy",
    "Transparenz":                 "Transparency",
    "Finanzierung":                "Funding",
    "Brand-Toolkit":               "Brand toolkit",
    "Petitionsausschuss (Kontakt)": "Petitions Committee (contact)"
  },

  /* ---- name / opennessNote (8.8.2026) -------------------------------------
     Diese beiden Felder stammen sonst aus dem MANIFEST, das der Scraper
     erzeugt — also serverseitig und einsprachig deutsch. In der englischen
     Oberflaeche stand deshalb "Europaeisches Parlament" mitten im englischen
     Satz, und die elf "Fuer Nerds"-Saetze blieben komplett deutsch.

     `name` steht nur da, wo der deutsche Name ein GATTUNGSBEGRIFF ist
     (Europaeisches Parlament, Bundestag ePetitionen). Marken bleiben, wie sie
     sind: WeAct, Avaaz, Change.org, Eko, Innn.it, WeMove Europe, foodwatch,
     350.org und OpenPetition heissen auf Englisch genauso. Was hier fehlt,
     faellt wie ueberall in diesem Block auf das Deutsche zurueck. */
  weact: {
    opennessWunsch: "The records carry no start date: two of 1,907 have one, so sorting by "
                      + "recency is impossible. A date in the markup — or a sitemap with "
                      + "lastmod — would be enough.",
    opennessNote: "Open: complete listings via categories + pagination, but " +
      "technical hurdles (custom elements instead of links, a hidden cpage " +
      "parameter, two different page templates).",
    wikipedia: "https://en.wikipedia.org/wiki/Campact",
    tagline: "Petition platform run by Campact",
    about: {
      text: "WeAct is the petition platform of the non-profit association Campact e. V. and is aimed at everyone who wants to start or support a socio-political petition. The platform offers professional campaign support from the Campact team. It is particularly suited to causes with a socio-political dimension that seek broad backing.",
      seat: "Verden (Aller), Germany",
      financing: "Donations"
    }
  },

  openpetition: {
    opennessWunsch: "Listing without login and without JavaScript, with pagination; "
                      + "signature count, goal, status and full text are in the delivered "
                      + "HTML. The robots.txt is generous and names a sitemap. The start date "
                      + "appears day-, month- or year-precise depending on age — whoever reads "
                      + "it must know all three forms.",
    opennessNote: "Exemplary: complete public listing (~1,600, paginated), everything server-rendered (count, target, status, full text), generous robots.txt with sitemap.",
    tagline: "Citizens' platform for petitions",
    about: {
      text: "OpenPetition is a non-profit online platform where citizens can start and sign petitions on political, social and local issues. The platform is run by openPetition gGmbH and sees itself as independent, ad-free infrastructure for democratic participation. It is one of the most widely used petition platforms in the German-speaking world.",
      seat: "Berlin, Germany",
      financing: "Donations"
    }
  },

  changeorg: {
    opennessWunsch: "Topic pages show about 21 petitions each; “Show more” goes through "
                      + "/api-proxy/, which robots.txt blocks. Sitemaps do expose some 16,000 "
                      + "addresses, but the path to their content stays narrow. A paginated "
                      + "listing without the blocked detour would solve it.",
    opennessNote: "Moderate: German topic pages /t/<slug> return curated petitions (~21 each; \u201eShow more\u201c goes through the robots-blocked /api-proxy/ and stays out of reach), supplemented by sitemap heuristics. The petition pages themselves are freely accessible.",
    wikipedia: "https://en.wikipedia.org/wiki/Change.org",
    tagline: "Global petition platform",
    about: {
      /* seat und financing fehlen mit Absicht: "San Francisco, USA" lautet
         auf Englisch gleich, financing ist auch im deutschen Block null. */
      text: "Change.org is one of the largest petition platforms in the world and lets individuals start and sign petitions on any topic. The platform operates worldwide and is available in numerous languages. It is run by Change.org PBC, an American public benefit corporation based in San Francisco."
    }
  },

  innnit: {
    opennessWunsch: "The complete listing exists only through an internal API that was "
                      + "found by rebuilding the page; there is no sitemap and the search is a "
                      + "redirect to Google. In return the API delivers complete records "
                      + "including the full text — documenting it publicly would be the whole "
                      + "step.",
    opennessNote: "Moderate: a complete listing exists, but only through a hidden internal API (found by reverse engineering); no sitemap, search is merely a redirect to Google. In return the API delivers complete records including the full text.",
    tagline: "Petitions for Germany",
    about: {
      text: "innn.it is a non-profit petition platform focusing on German political and social issues. The supporting association innn.it e. V. was founded in 2022 as an independent organization, after the platform had at first been run within the Change.org network. It is funded entirely by donations.",
      seat: "Berlin, Germany",
      financing: "Donations"
    }
  },

  avaaz: {
    opennessWunsch: "There is no public complete listing; only some 5 to 10 curated "
                      + "campaigns are visible, older ones only through the Internet Archive. "
                      + "Cloudflare turns away clients that are not a browser. A paginated "
                      + "listing or a sitemap would remove both obstacles.",
    opennessNote: "Limited: no public overall listing (only ~5-10 curated/popular/new ones), counts only via a stats JSON, Cloudflare blocks non-browser clients. Older campaigns come in through the Internet Archive (--archive), in portions across several runs.",
    wikipedia: "https://en.wikipedia.org/wiki/Avaaz",
    tagline: "Global citizens' movement",
    about: {
      text: "Avaaz is a global online citizens' movement campaigning for democracy, human rights, animal welfare, the fight against corruption and climate protection. The organization was founded in 2007, is funded entirely by its members and turns down corporate and government money. It is one of the large international campaign networks.",
      seat: "London, United Kingdom",
      financing: "Membership fees and donations"
    }
  },

  bundestag: {
    name: "Bundestag e-Petitions",
    opennessWunsch: "Official data behind a JS portal with session cookies and a hidden "
                      + "AJAX fragment; the status.2 parameter is mandatory and the batch size "
                      + "is capped. An open, paginated endpoint without a session would make "
                      + "the reverse-engineering steps unnecessary.",
    opennessNote: "Limited: official data, but a JS portal with session cookies and a hidden AJAX fragment (the status.2 parameter is required, batch size is capped) \u2014 not accessible without reverse engineering.",
    tagline: "Official petitions to the Bundestag",
    about: {
      text: "The ePetitions portal of the German Bundestag lets citizens address official petitions to the Petitions Committee. Public petitions can be co-signed online and, from 50,000 co-signatures within four weeks, lead to a public session of the committee. The portal is run by the German Bundestag as a state institution.",
      /* Eigenname mit amtlicher englischer Fassung — anders als
         "Campact e. V.", das auch auf Englisch so heisst. */
      operator: "German Bundestag",
      seat: "Berlin, Germany",
      financing: "Public (state)"
    }
  },

  europarl: {
    name: "European Parliament",
    opennessWunsch: "The search is server-rendered and freely accessible. From data "
                      + "centres, however, the host answers with HTTP 202 (AWS-WAF) instead of "
                      + "content, from ordinary connections it does not — an exception for "
                      + "read access would suffice. There is also no public supporter count, "
                      + "and the start date is only year-precise.",
    opennessNote: "Open: official search with country and status filters, server-rendered; quirks (load-more pagination, doubly encoded URLs) and no public supporter count.",
    wikipedia: "https://en.wikipedia.org/wiki/European_Parliament_Committee_on_Petitions",
    tagline: "Petitions to the EU Parliament",
    about: {
      text: "The petitions portal of the European Parliament (PETI committee) lets all EU citizens and people resident in the EU submit petitions on matters that fall within the EU's remit. Submitted petitions are examined by the Committee on Petitions, which decides on admissibility and on how they are handled further. The portal is multilingual and is run by the European Parliament.",
      operator: "European Parliament",
      seat: "Strasbourg / Brussels, EU",
      financing: "Public (EU)"
    }
  },

  wemove: {
    opennessWunsch: "Campaigns including the archive are linked, but the signature count "
                      + "sits on a separate progress endpoint. From data centres "
                      + "action.wemove.eu answers with HTTP 202 instead of content, from "
                      + "ordinary connections it does not. The counter in the campaign page's "
                      + "HTML would save the second request.",
    opennessNote: "Moderate: campaigns including the archive are linked, but counts only come from a separate progress endpoint, and responses are throttled on series of requests.",
    tagline: "European citizens' movement",
    about: {
      text: "WeMove Europe is a European citizens' movement campaigning for democracy, climate justice and social rights in the EU. The organization was founded in 2015 and is registered as a European Cooperative Society (SCE) based in Berlin. It is funded by donations from its members; money from corporations or state bodies is turned down.",
      seat: "Berlin, Germany",
      financing: "Member donations and foundations"
    }
  },

  eko: {
    opennessWunsch: "The German campaign listing on eko.org is open. The campaign pages "
                      + "themselves redirect from actions.eko.org via HTTP 301 to "
                      + "action.eko.org, where a bot checkpoint answers with HTTP 429 — for "
                      + "ordinary browsers outside data centres as well. That is why all 39 "
                      + "records lack the full text. An exception for read access or a "
                      + "machine-readable index would be enough.",
    opennessNote: "Moderate: German campaigns are covered via the home page + search (capped at 27 per term \u2192 union of many terms); two page templates, an overall sitemap without a language marker \u2014 completeness is not guaranteed.",
    wikipedia: "https://en.wikipedia.org/wiki/Ek%C5%8D_%28organization%29",
    tagline: "Campaign platform critical of corporations",
    about: {
      text: "Ekō (known as SumOfUs until 2023) is an international campaigning organization that stands up for citizens' and consumers' rights in the face of corporations. It was founded in 2011, renamed in 2023 and runs petitions and actions on issues such as climate protection, food safety and corporate accountability. Ekō is registered in the USA as a non-profit 501(c)4 organization.",
      operator: "Ekō (formerly SumOfUs), 501(c)4"
    }
  },

  foodwatch: {
    opennessWunsch: "Complete action listing, signature count and full text directly in "
                      + "the server-rendered HTML: no key, no session, no JavaScript needed. "
                      + "One request per page is enough and everything necessary is in it.",
    opennessNote: "Very open: the complete list of actions, counts and full texts are directly in the server-rendered HTML, and robots.txt permits practically everything.",
    wikipedia: "https://en.wikipedia.org/wiki/Foodwatch",
    tagline: "Consumer rights in the food sector",
    about: {
      text: "foodwatch e. V. is a non-profit consumer rights organization campaigning for healthy, safe and honestly labeled food. The association was founded in Berlin in 2002 by Thilo Bode and is funded exclusively by membership fees and donations — state money and corporate donations are turned down. Petitions and campaigns are addressed to food producers and political decision-makers.",
      seat: "Berlin, Germany",
      financing: "Membership fees and donations"
    }
  },

  threefifty: {
    opennessWunsch: "There is no open listing; the actions come through an external JSON "
                      + "API that had to be found in the page's JavaScript. A linked index or "
                      + "a sitemap would serve the same purpose without the search.",
    opennessNote: "Moderate: no open listing; actions come from an external JSON API (found in the page's JS), counts from /progress/, texts from the /sign/ page. The /act/ action pages are blocked by robots and are not loaded \u2014 for those only the API teaser remains, and the format is derived from the button text.",
    wikipedia: "https://en.wikipedia.org/wiki/350.org",
    tagline: "Climate movement against fossil fuels",
    about: {
      text: "350.org is an international climate protection organization campaigning for an end to the use of fossil fuels and a just energy transition. It was founded in 2007–2008 and runs a global network of local groups. It is registered in the USA as a non-profit 501(c)3 organization and is funded by donations.",
      seat: "Boston, USA (with a global network)",
      financing: "Donations"
    }
  },

  /* ---- Sprachzwillinge (30.8.2026) ------------------------------------
     Bis hierher fuehrte diese Ebene nur die elf Grundschluessel, und
     uebersetzung() loest den Grundschluessel NICHT auf — englische Nutzer
     sahen bei den sechs _en-Plattformen deshalb den deutschen Satz.
     ⚠️ basisKey() waere hier der FALSCHE Weg: fuenf der sechs beschreiben
     einen anderen Zugangsweg als ihre Basis (changeorg_en Ortsseiten statt
     Themenseiten, eko_en eine paginierte Liste), sie bekaemen also den Text
     einer anderen Lage. Deshalb eigene Eintraege.
     ⚠️ Bewusst NUR die beiden Offenheitsfelder: ein `name` hier wuerde
     "foodwatch (English)" aus dem Manifest ueberschreiben. */
  avaaz_en: {
    opennessWunsch: "There is no public complete listing; only some 5 to 10 curated "
                      + "campaigns are visible, older ones only through the Internet Archive. "
                      + "Cloudflare turns away clients that are not a browser. A paginated "
                      + "listing or a sitemap would remove both obstacles.",
    opennessNote: "Limited: no public overall listing (only ~5-10 curated/popular/new "
                    + "ones), counts only via a stats JSON, Cloudflare blocks non-browser "
                    + "clients."
  },
  changeorg_en: {
    opennessWunsch: "The local pages are server-rendered and permitted by robots.txt — that "
                      + "is the open part. Paging further leads back through /api-proxy/, which "
                      + "is blocked. Pagination on the same open path would make the whole "
                      + "catalogue reachable.",
    opennessNote: "Moderate: the local pages /local/<city>--<state>--us are "
                    + "server-rendered, permitted by robots.txt and linguistically clean — "
                    + "unlike the German branch, no word heuristics are needed here. Paging "
                    + "further would only work through /api-proxy/, and that is blocked."
  },
  eko_en: {
    opennessWunsch: "The English campaign listing is open and paginated — four requests "
                      + "cover it. The detail pages, however, sit behind the same bot checkpoint "
                      + "as the German branch (action.eko.org, HTTP 429); without them only "
                      + "title, summary and image from the campaign card remain. An exception "
                      + "for read access would be enough.",
    opennessNote: "Limited: the English campaign listing is open and even paginated (four "
                    + "requests cover it), but the detail pages sit behind the same bot "
                    + "protection as the German branch (action.eko.org, HTTP 429). Where the "
                    + "detail page is missing, title, summary and image are taken from the "
                    + "campaign card."
  },
  foodwatch_en: {
    opennessWunsch: "Complete action listing, signature count and full text directly in the "
                      + "server-rendered HTML: no key, no session, no JavaScript needed. One "
                      + "request per page is enough and everything necessary is in it.",
    opennessNote: "Very open: the complete list of actions, counts and full texts are "
                    + "directly in the server-rendered HTML, and robots.txt permits "
                    + "practically everything."
  },
  threefifty_en: {
    opennessWunsch: "The actions run through the same external JSON API as the German "
                      + "branch, only with a language filter. It is linked nowhere and had to be "
                      + "found in the page's JavaScript — a documented entry point or a sitemap "
                      + "would spare the search.",
    opennessNote: "Moderate: no open listing; actions come through the same external JSON "
                    + "API as the German branch, only with the language filter “Language: "
                    + "English”. Counts via /progress/, texts from the action page (/sign/, "
                    + "/letter/, /signup/). /act/ is blocked by robots and is not loaded."
  },
  wemove_en: {
    opennessWunsch: "The English overview is open and lists the entire multilingual "
                      + "catalogue. The detail pages, however, run into a checkpoint after a few "
                      + "dozen requests; the record therefore holds only 8 of some 698 entries. "
                      + "A higher request limit for read access, or the counter directly in the "
                      + "overview HTML, would be enough.",
    opennessNote: "Moderate: the English campaign overview is open and even lists the "
                    + "entire multilingual catalogue, but the detail pages sit behind a "
                    + "checkpoint that kicks in after a few dozen requests. The record "
                    + "therefore fills up across several runs."
  },
};

/* ---- WeMove: die fuenf weiteren Sprachen (4.9.2026) ----------------------
   Sie teilen sich Uebersicht, Checkpoint und Abrufbudget mit dem englischen
   Zweig — der Offenheitstext ist deshalb fuer alle derselbe, und ihn fuenfmal
   abzutippen waere fuenfmal die Gelegenheit, ihn auseinanderlaufen zu lassen.

   ⚠️ Ohne diese Eintraege loest uebersetzung() den Schluessel nicht auf und
   faellt auf das Manifest zurueck — englische Nutzer saehen dort den DEUTSCHEN
   Satz, und zwar nur sie. Genau dafuer gibt es die Pruefung in checks.yml;
   die erfasst allerdings nur die elf Grundschluessel, diese hier also nicht. */
(function (block) {
  var note = "Moderate: the campaign overview is open and even lists the "
    + "entire multilingual catalogue, but the detail pages sit behind a "
    + "checkpoint that kicks in after a few dozen requests. The record "
    + "therefore fills up across several runs.";
  var wunsch = "The overview is open and lists the entire multilingual "
    + "catalogue. The detail pages, however, run into a checkpoint after a "
    + "few dozen requests; after three weeks the English record held only 8 "
    + "of some 692 entries. A higher request limit for read access, or the "
    + "counter directly in the overview HTML, would be enough.";
  ["es", "fr", "it", "nl", "pl"].forEach(function (lang) {
    block["wemove_" + lang] = { opennessNote: note, opennessWunsch: wunsch };
  });
  /* foodwatch France und Nederland (4.9.2026). Eigene Landesorganisationen,
     genauso offen wie der deutsche Zweig — Zaehler und Volltext stehen
     server-gerendert im Markup. */
  /* Avaaz in 17 weiteren Sprachen (4.9.2026). Alle teilen Quelle und
     Offenheit mit dem englischen Zweig: dieselbe kuratierte Uebersicht,
     dieselbe fehlende Gesamtliste. */
  ["el", "es", "fr", "id", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro",
   "ru", "sw", "tr", "uk", "zh"].forEach(function (lang) {
    block["avaaz_" + lang] = {
      opennessNote: "Restricted: there is no public complete list, only some "
        + "5 to 10 curated petitions and campaigns are visible. The record "
        + "grows over time.",
      opennessWunsch: "A public complete list is missing; only some 5 to 10 "
        + "curated campaigns are visible, older ones only via the Internet "
        + "Archive. A paginated index or a sitemap would be enough."
    };
  });
  ["fr", "nl"].forEach(function (lang) {
    block["foodwatch_" + lang] = {
      opennessNote: "Very open: complete action list, counter and full text "
        + "rendered server-side.",
      opennessWunsch: "Complete action list, signature count and full text "
        + "straight from the markup, without a login and without JavaScript."
    };
  });
})(window.PM_PLATFORMS_EN);
