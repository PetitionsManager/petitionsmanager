# ⚠️ Hier stand: „JavaScript-Interfaces werden nicht genutzt." Das war FALSCH.
# Die App meldet in MainActivity vier Brücken an – AndroidBackup (Sicherung
# exportieren), AndroidNotify (Tageserinnerung), AndroidUpdate (eigene
# Aktualisierung, nur in der Direktverteilungs-Fassung) und AndroidApp
# (Beenden nach der Nachfrage der Zurücktaste, seit 11.8.2026).
#
# Die Regel unten greift über die ANNOTATION, nicht über Namen – eine neue
# Brücke ist damit von allein mitgeschützt. Die Aufzählung hier begründet die
# Regel, sie ist keine Liste, an der etwas hängt.
#
# Heute fällt das nicht auf, weil in app/build.gradle `minifyEnabled false`
# steht. Beim ersten Einschalten der Verkleinerung würde R8 die Methoden
# umbenennen oder ganz entfernen: aus dem Java-Code ruft sie niemand auf, der
# einzige Aufrufer ist JavaScript und den sieht R8 nicht. Ergebnis wäre eine
# APK, die klaglos baut und in der Export, Erinnerung und Aktualisierung
# stillschweigend nichts mehr tun. Deshalb steht die Regel schon jetzt hier.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
