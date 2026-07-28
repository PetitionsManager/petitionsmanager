/* platforms.js — Marken-Farben, Monogramme und Hintergrundinfos je Plattform.
   Wird vor app.js geladen und stellt window.PM_PLATFORMS bereit.
   Letzte Aktualisierung: 2026-07-27 */

window.PM_PLATFORMS = {

  /* ------------------------------------------------------------------ */
  weact: {
    color:     "#e9005f",          /* Vorgabefarbe des eigenen Logo-Bausteins cmpr-logo-weact (vorher geschaetzt #e03c1c) */
    colorSoft: "#fdebf2",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#f373a7",          /* aufgehellt fuer dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#e03c1c"/><text x="12" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#fff">W</text></svg>',
    logoFile: "logos/weact.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   1.42,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://www.campact.de/presse/",
    wikipedia: "https://de.wikipedia.org/wiki/Campact",
    tagline: "Petitionsplattform von Campact",
    about: {
      text: "WeAct ist die Petitionsplattform des gemeinnützigen Vereins Campact e. V. und richtet sich an alle, die eine gesellschaftspolitische Petition starten oder unterstützen möchten. Die Plattform bietet professionelle Kampagnenunterstützung durch das Campact-Team. Besonders geeignet für Anliegen mit gesellschaftspolitischer Dimension, die eine breite Unterstützung anstreben.",
      operator: "Campact e. V.",
      seat: "Verden (Aller), Deutschland",
      founded: 2004,
      financing: "Spenden",
      links: [
        { label: "Website",     url: "https://weact.campact.de" },
        { label: "Über uns",    url: "https://weact.campact.de/s/warum-weact-die-beste-plattform-fuer-deine-petition-ist" },
        { label: "Datenschutz", url: "https://www.campact.de/campact/ueber-campact/datenschutz/" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  openpetition: {
    color:     "#29b0cc",          /* theme-color der eigenen Seite (vorher #2d8a4e, geschätzt) */
    colorSoft: "#eef9fb",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#89d4e3",          /* aufgehellt für dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#2d8a4e"/><text x="12" y="16" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="bold" fill="#fff">oP</text></svg>',
    logoFile: "logos/openpetition.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   3.39,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://www.openpetition.de/content/legal_details",
    wikipedia: "https://de.wikipedia.org/wiki/OpenPetition",
    tagline: "Bürgerplattform für Petitionen",
    about: {
      text: "OpenPetition ist eine gemeinnützige Online-Plattform, auf der Bürgerinnen und Bürger Petitionen zu politischen, gesellschaftlichen und lokalen Themen starten und unterzeichnen können. Die Plattform wird von der openPetition gGmbH betrieben und versteht sich als unabhängige, werbefreie Infrastruktur für demokratische Beteiligung. Sie gehört zu den meistgenutzten Petitionsplattformen im deutschsprachigen Raum.",
      operator: "openPetition gGmbH",
      seat: "Berlin, Deutschland",
      founded: 2010,
      financing: "Spenden",
      links: [
        { label: "Website",     url: "https://www.openpetition.de" },
        { label: "Impressum",   url: "https://www.openpetition.de/content/legal_details" },
        { label: "Datenschutz", url: "https://www.openpetition.de/content/data_privacy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  changeorg: {
    color:     "#f34e49",          /* eigenes Token --color-fill-brand-strong (faerbt das Kopf-Logo) (vorher #ec2c22) */
    colorSoft: "#fef1f0",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#f89e9b",          /* aufgehellt fuer dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#ec2c22"/><text x="12" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#fff">C</text></svg>',
    logoFile: "logos/changeorg.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   5.1,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://www.change.org/l/en/press",
    wikipedia: "https://de.wikipedia.org/wiki/Change.org",
    tagline: "Globale Petitionsplattform",
    about: {
      text: "Change.org ist eine der weltweit größten Petitionsplattformen und ermöglicht es Einzelpersonen, Petitionen zu jedem Thema zu starten und zu unterzeichnen. Die Plattform ist weltweit aktiv und in zahlreichen Sprachen verfügbar. Betrieben wird sie von Change.org PBC, einer amerikanischen Public Benefit Corporation mit Sitz in San Francisco.",
      operator: "Change.org, PBC",
      seat: "San Francisco, USA",
      founded: 2007,
      financing: null,
      links: [
        { label: "Website",     url: "https://www.change.org" },
        { label: "Datenschutz", url: "https://www.change.org/policies/privacy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  innnit: {
    color:     "#fc691f",          /* Farbe des eigenen App-Icons favicon-192.png (vorher #e8174a, geschätzt) */
    colorSoft: "#fff3ed",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#fdac84",          /* aufgehellt für dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#e8174a"/><text x="12" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#fff">i!</text></svg>',
    logoNote: "https://innn.it",
    logoFile: "logos/innnit.png",  /* eigenes App-Icon, freigestellt und zugeschnitten */
    logoAR:   0.745,               /* 123 : 165 Bildpunkte */
    tagline: "Petitionen für Deutschland",
    about: {
      text: "innn.it ist eine gemeinnützige Petitionsplattform mit Schwerpunkt auf deutschen politischen und gesellschaftlichen Themen. Der Trägerverein innn.it e. V. wurde 2022 als eigenständige Organisation gegründet, nachdem die Plattform zunächst im Netzwerk von Change.org betrieben worden war. Die Finanzierung erfolgt vollständig durch Spenden.",
      operator: "innn.it e. V.",
      seat: "Berlin, Deutschland",
      founded: 2022,
      financing: "Spenden",
      links: [
        { label: "Website",     url: "https://innn.it" },
        { label: "Transparenz", url: "https://innn.it/transparenz" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  avaaz: {
    color:     "#e40a68",          /* eigenes Stylesheet, 7 Fundstellen (Magenta der Aktionsschaltflaeche) (vorher #005b99) */
    colorSoft: "#fdebf3",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#f078ac",          /* aufgehellt fuer dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#005b99"/><text x="12" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#fff">Av</text></svg>',
    logoFile: "logos/avaaz.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   3.96,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://secure.avaaz.org/en/about.php",
    wikipedia: "https://de.wikipedia.org/wiki/Avaaz",
    tagline: "Globale Bürgerbewegung",
    about: {
      text: "Avaaz ist eine globale Online-Bürgerbewegung, die sich für Demokratie, Menschenrechte, Tierschutz, Korruptionsbekämpfung und Klimaschutz einsetzt. Die Organisation wurde 2007 gegründet, ist vollständig mitgliederfinanziert und lehnt Unternehmens- und Regierungsgelder ab. Sie gehört zu den großen internationalen Kampagnen-Netzwerken.",
      operator: "Avaaz Foundation",
      seat: "London, Vereinigtes Königreich",
      founded: 2007,
      financing: "Mitgliederbeiträge und Spenden",
      links: [
        { label: "Website",     url: "https://avaaz.org" },
        { label: "Über uns",    url: "https://secure.avaaz.org/en/about.php" },
        { label: "Datenschutz", url: "https://secure.avaaz.org/en/privacy/" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  bundestag: {
    color:     "#191919",          /* eigenes Stylesheet, 123 Fundstellen (Akzent waere #ff7100) (vorher #1e3a5f) */
    colorSoft: "#ededed",          /* ~8 % Deckkraft ueber Weiss */
    colorDark: "#808080",          /* aufgehellt fuer dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#1e3a5f"/><text x="12" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#fff">BT</text></svg>',
    logoFile: "logos/bundestag.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   6.17,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://www.bundestag.de/services/presse",
    wikipedia: "https://de.wikipedia.org/wiki/Petitionsausschuss_(Deutscher_Bundestag)",
    tagline: "Offizielle Petitionen an den Bundestag",
    about: {
      text: "Das ePetitions-Portal des Deutschen Bundestages ermöglicht Bürgerinnen und Bürgern, offizielle Petitionen an den Petitionsausschuss zu richten. Öffentliche Petitionen können online mitgezeichnet werden und führen ab 50.000 Mitzeichnungen innerhalb von vier Wochen zu einer öffentlichen Sitzung des Ausschusses. Das Portal wird vom Deutschen Bundestag als staatliche Institution betrieben.",
      operator: "Deutscher Bundestag",
      seat: "Berlin, Deutschland",
      founded: null,
      financing: "Öffentlich (staatlich)",
      links: [
        { label: "Website",     url: "https://epetitionen.bundestag.de" },
        { label: "Impressum",   url: "https://epetitionen.bundestag.de/epet/service.nc.$$$.rubrik.impressum.html" },
        { label: "Datenschutz", url: "https://epetitionen.bundestag.de/epet/service.$$$.rubrik.datenschutz.html" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  europarl: {
    color:     "#003399",          /* Offizielles EU-Blau */
    colorSoft: "#e5e8f4",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#4d7acc",          /* aufgehellt für dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#003399"/><text x="12" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="bold" fill="#ffcc00">EP</text></svg>',
    logoFile: "logos/europarl.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   1.82,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://www.europarl.europa.eu/about-parliament/de/resources-and-links/resources/visual-identity",
    wikipedia: "https://de.wikipedia.org/wiki/Petitionsausschuss_des_Europäischen_Parlaments",
    tagline: "Petitionen ans EU-Parlament",
    about: {
      text: "Das Petitionsportal des Europäischen Parlaments (Ausschuss PETI) ermöglicht allen EU-Bürgerinnen und -Bürgern sowie in der EU ansässigen Personen, Petitionen zu Themen einzureichen, die in den Zuständigkeitsbereich der EU fallen. Eingereichte Petitionen werden vom Petitionsausschuss geprüft, der über Zulässigkeit und weitere Behandlung entscheidet. Das Portal ist mehrsprachig und wird vom Europäischen Parlament betrieben.",
      operator: "Europäisches Parlament",
      seat: "Straßburg / Brüssel, EU",
      founded: null,
      financing: "Öffentlich (EU)",
      links: [
        { label: "Website",     url: "https://www.europarl.europa.eu/petitions/" },
        { label: "Über das Verfahren", url: "https://www.europarl.europa.eu/petitions/de/artcl/Welcome+to+the+Petitions+Web+Portal/det/20220906CDT10122" },
        { label: "Datenschutz", url: "https://www.europarl.europa.eu/petitions/de/artcl/Privacy+Policy+Statements/det/20240115CDT12863" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  wemove: {
    color:     "#21194f",          /* theme-color der eigenen Seite (vorher #6b3fa0, geschätzt) */
    colorSoft: "#ededf1",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#85809e",          /* aufgehellt für dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#6b3fa0"/><text x="12" y="16" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="bold" fill="#fff">WM</text></svg>',
    logoFile: "logos/wemove.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   2.07,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://wemove.eu/en/about-us",
    tagline: "Europäische Bürgerbewegung",
    about: {
      text: "WeMove Europe ist eine europäische Bürgerbewegung, die sich für Demokratie, Klimagerechtigkeit und soziale Rechte in der EU einsetzt. Die Organisation wurde 2015 gegründet und ist als Europäische Genossenschaft (SCE) mit Sitz in Berlin registriert. Die Finanzierung erfolgt über Spenden von Mitgliedern; Gelder von Konzernen oder staatlichen Stellen werden abgelehnt.",
      operator: "WeMove Europe SCE mbH",
      seat: "Berlin, Deutschland",
      founded: 2015,
      financing: "Mitgliederspenden und Stiftungen",
      links: [
        { label: "Website",           url: "https://www.wemove.eu" },
        { label: "Finanzierung",      url: "https://www.wemove.eu/en/how-we-are-funded" },
        { label: "Datenschutz",       url: "https://www.wemove.eu/en/privacy-policy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  eko: {
    color:     "#6400ff",          /* Farbe im offiziellen Logo (vorher #7b2d8b, geschätzt) */
    colorSoft: "#f3ebff",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#aa73ff",          /* aufgehellt für dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#7b2d8b"/><text x="12" y="17" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#fff">ek</text></svg>',
    logoFile: "logos/eko.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   1.81,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://eko.org/eko/",
    wikipedia: "https://de.wikipedia.org/wiki/SumOfUs",
    tagline: "Konzernkritische Kampagnenplattform",
    about: {
      text: "Ekō (bis 2023 bekannt als SumOfUs) ist eine internationale Kampagnenorganisation, die sich für Bürgerinnen- und Verbraucherrechte gegenüber Konzernen einsetzt. Die Organisation wurde 2011 gegründet, 2023 umbenannt und betreibt Petitionen sowie Aktionen zu Themen wie Klimaschutz, Lebensmittelsicherheit und Unternehmensverantwortung. Ekō ist als gemeinnützige 501(c)4-Organisation in den USA registriert.",
      operator: "Ekō (ehemals SumOfUs), 501(c)4",
      seat: "San Francisco, USA",
      founded: 2011,
      financing: null,
      links: [
        { label: "Website",     url: "https://eko.org" },
        { label: "Über uns",    url: "https://eko.org/about" },
        { label: "Datenschutz", url: "https://eko.org/en/privacy" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  foodwatch: {
    color:     "#f7a600",          /* Farbe im offiziellen Logo (vorher #e8600a, geschätzt) */
    colorSoft: "#fef8eb",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#fbce73",          /* aufgehellt für dunklen Hintergrund */
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#e8600a"/><text x="12" y="16" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" font-weight="bold" fill="#fff">fw</text></svg>',
    logoFile: "logos/foodwatch.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   5.23,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://www.foodwatch.org/de/presse/",
    wikipedia: "https://de.wikipedia.org/wiki/Foodwatch",
    tagline: "Verbraucherrechte im Lebensmittelbereich",
    about: {
      text: "foodwatch e. V. ist eine gemeinnützige Verbraucherrechtsorganisation, die sich für gesunde, sichere und ehrlich gekennzeichnete Lebensmittel einsetzt. Der Verein wurde 2002 von Thilo Bode in Berlin gegründet und finanziert sich ausschließlich durch Mitgliedsbeiträge und Spenden — staatliche Gelder und Wirtschaftsspenden werden abgelehnt. Petitionen und Kampagnen richten sich an Lebensmittelhersteller und politische Entscheidungsträger.",
      operator: "foodwatch e. V.",
      seat: "Berlin, Deutschland",
      founded: 2002,
      financing: "Mitgliedsbeiträge und Spenden",
      links: [
        { label: "Website",     url: "https://www.foodwatch.org/de/" },
        { label: "Über uns",    url: "https://www.foodwatch.org/de/ueber-uns/" },
        { label: "Impressum",   url: "https://www.foodwatch.org/de/impressum" },
        { label: "Datenschutz", url: "https://www.foodwatch.org/de/datenschutz" }
      ]
    }
  },

  /* ------------------------------------------------------------------ */
  threefifty: {
    color:     "#0f81e8",          /* Markenblau, offiziell aus 350.org Brand Toolkit */
    colorSoft: "#e6f0fc",          /* ~8 % Deckkraft über Weiß */
    colorDark: "#5ab0ff",          /* aufgehellt für dunklen Hintergrund */
    /* Ausnahme von der gerechneten Schriftfarbe (app.js → platInk): auf diesem
       Blau liegt Dunkel mit 4,31 rechnerisch knapp vorn, Weiß kommt auf 3,94.
       Die Marke tritt aber durchgängig weiß auf blau auf, und auf der Kachel
       steht ausschließlich WCAG-Großtext – dafür genügen 3:1. Nutzerwunsch. */
    ink:       "#ffffff",
    logo: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="7" fill="#0f81e8"/><text x="12" y="16" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="bold" fill="#fff">350</text></svg>',
    logoFile: "logos/threefifty.svg",  /* echtes Logo, einfarbig als CSS-Maske */
    logoAR:   2.67,              /* Breite/Höhe aus der viewBox */
    logoNote: "https://350.org/brand-toolkit/",
    wikipedia: "https://de.wikipedia.org/wiki/350.org",
    tagline: "Klimabewegung gegen fossile Brennstoffe",
    about: {
      text: "350.org ist eine internationale Klimaschutzorganisation, die sich für das Ende der Nutzung fossiler Brennstoffe und eine gerechte Energiewende einsetzt. Die Organisation wurde 2007–2008 gegründet und betreibt ein globales Netzwerk lokaler Gruppen. Sie ist als gemeinnützige 501(c)3-Organisation in den USA registriert und finanziert sich durch Spenden.",
      operator: "350.org, 501(c)3",
      seat: "Boston, USA (mit globalem Netzwerk)",
      founded: 2008,
      financing: "Spenden",
      links: [
        { label: "Website",       url: "https://350.org" },
        { label: "Über uns",      url: "https://350.org/about/" },
        { label: "Datenschutz",   url: "https://350.org/privacy/" },
        { label: "Brand-Toolkit", url: "https://350.org/brand-toolkit/" }
      ]
    }
  }

};
