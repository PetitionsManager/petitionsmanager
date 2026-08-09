"""Sprachfassungen einsammeln — der gemeinsame Teil aller Scraper.

Sieben der elf Plattformen veröffentlichen ihre Petitionen in mehr als einer
Sprache (am 8.8.2026 alle elf mit echtem Abruf durchgemessen, Ergebnis im
README). WIE man die zweite Fassung findet, ist bei jeder anders — mal ein
Suffix am Slug, mal ein Sprachsegment im Pfad, mal ein Link im Seitenquelltext.
Was danach passiert, ist überall gleich, und genau das steht hier: welche
Felder mitwandern, wie der Block aussieht, und vor allem, wie der ZUSTAND je
Sprache festgehalten wird.

⚠️⚠️ DER ZUSTAND IST DER KERN, NICHT DER TEXT. Die App zeigt zu einer
fehlenden Sprachfassung ein Abzeichen mit dem Satz, die Petition liege bei
dieser Plattform in der gewählten Sprache nicht vor. Dieser Satz darf nur
erscheinen, wenn wir NACHGESEHEN haben:

    "vorhanden"  abgerufen, Inhalt da
    "fehlt"      abgerufen, gibt es dort nachweislich nicht (404/410)
    "ungeklärt"  Abruf gescheitert, geblockt, oder gar nicht versucht

Ein leeres Feld beweist NICHTS. Bei WeMove standen am 8.8.2026 im lokalen
Bestand 208 von 261 Sätzen ohne Titel; ruft man dieselben deutschen Seiten
heute ab, tragen sie einen einwandfreien Titel („Verbietet Sonnencreme, die
Korallen tötet!"). Die Lücke kam vom Bot-Checkpoint, nicht von der Quelle.
Hätte die App daraus „liegt auf Deutsch nicht vor" gemacht, stünde eine
falsche Tatsachenbehauptung auf dem Bildschirm.

Verwandt: publish.slim() reicht i18n/i18n_state/lang/campaign_id weiter,
publish.write_texts(sprache=…) legt die Volltexte in eine eigene Paketreihe,
app.js/txt() liest sie mit demselben dreistufigen Rückfall wie T().
"""

# Was eine Fremdsprache mitbringt. Bewusst NICHT dabei:
#   signatures/goal   Zahlen, sprachunabhängig
#   category          wird per Zeichenkettenvergleich gefiltert (app.js
#                     state.catFilter); ein übersetzter Wert ließe den Filter
#                     ins Leere laufen
#   tags              werden aus dem deutschen Text abgeleitet und tragen die
#                     Verwandtschaftsrechnung — zwei Sprachen darin würden die
#                     Schlagwort-Häufigkeiten verfälschen
I18N_FELDER = ("title", "summary", "description_full", "url")

ZUSTAENDE = ("vorhanden", "fehlt", "ungeklärt")


def zustand_aus_antwort(resp, marker_da: bool = True) -> str:
    """Aus einer HTTP-Antwort den Sprachzustand ableiten.

    `marker_da` ist das Ergebnis der plattformeigenen Inhaltsprüfung (steht ein
    Titel/Petitionstext auf der Seite?). Ein HTTP 200 ohne Inhalt ist
    „ungeklärt" und NICHT „fehlt": Portale liefern bei Störungen, Bot-Schutz
    und Wartung ebenfalls 200 mit einer Hülle. Genau diese Verwechslung hat in
    diesem Projekt schon zweimal Bestand vernichtet (europarl-WAF, 350.org-202).
    """
    if resp is None:
        return "ungeklärt"
    if getattr(resp, "status_code", None) in (404, 410):
        return "fehlt"
    if not getattr(resp, "ok", False):
        return "ungeklärt"
    return "vorhanden" if marker_da else "ungeklärt"


def setze_sprachfassung(rec: dict, lang: str, zustand: str,
                        fremd: dict | None = None,
                        felder: tuple = I18N_FELDER) -> dict:
    """Eine Sprachfassung an `rec` hängen. Gibt `rec` zurück.

    Wird auch für „fehlt"/„ungeklärt" aufgerufen — dann ohne `fremd`. Der
    Zustand wird IMMER vermerkt, denn „wir haben nachgesehen und nichts
    gefunden" ist eine andere Aussage als „wir haben nie nachgesehen", und nur
    die erste rechtfertigt das Abzeichen in der App.
    """
    if zustand not in ZUSTAENDE:
        raise ValueError(f"unbekannter Sprachzustand: {zustand!r}")
    rec.setdefault("i18n_state", {})[lang] = zustand
    if zustand != "vorhanden" or not fremd:
        return rec
    block = {k: fremd[k] for k in felder if fremd.get(k)}
    if block:
        rec.setdefault("i18n", {})[lang] = block
    return rec


def setze_hauptsprache(rec: dict, lang: str = "de") -> dict:
    """Die Sprache der FLACHEN Felder festhalten.

    Ohne dieses Feld kann die App nicht sagen, in welcher Sprache der Text
    steht, den sie ersatzweise anzeigt — das Abzeichen hieße dann „Fassung auf
    (unbekannt)". Ältere Bestände ohne `lang` behandelt app.js als Deutsch.
    """
    rec["lang"] = lang
    return rec
