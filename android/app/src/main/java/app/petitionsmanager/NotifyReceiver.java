package app.petitionsmanager;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;

/**
 * Tägliche Erinnerung, auch bei geschlossener App.
 *
 * Warum überhaupt native: im WebView gibt es die Web-Notification-API nicht,
 * window.Notification fehlt dort ersatzlos. Und selbst mit ihr käme die Meldung
 * nur, solange die Seite läuft – eine Tageserinnerung, die man nur sieht, wenn
 * man die App sowieso offen hat, verfehlt ihren Zweck.
 *
 * Bewusst UNGENAUE Alarme (set statt setExact): genaue Alarme brauchen seit
 * Android 12 das Recht SCHEDULE_EXACT_ALARM, das der Nutzer eigens freigeben
 * muss – für eine Erinnerung, bei der die Minute nicht zählt, wäre das ein
 * unangemessener Preis. Android darf sie also zusammenlegen und etwas
 * verschieben.
 *
 * Der Alarm wird nach jedem Auslösen NEU gesetzt, statt setRepeating zu
 * benutzen: so überlebt die Uhrzeit eine Änderung in den Einstellungen, ohne
 * dass zwei Serien parallel laufen.
 */
public class NotifyReceiver extends BroadcastReceiver {

    static final String PREFS = "notify";
    static final String KEY_ON = "on";
    static final String KEY_HOUR = "hour";
    static final String KEY_MINUTE = "minute";
    static final String CHANNEL = "daily";
    private static final int ALARM_REQ = 4711;
    private static final int NOTIFY_ID = 1;

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean(KEY_ON, false)) return;      // zwischenzeitlich abgeschaltet

        boolean nachNeustart = intent != null
                && Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction());
        if (!nachNeustart) zeigen(context);
        // In beiden Fällen den nächsten Termin setzen: nach dem Neustart sind
        // alle Alarme des Geräts weg, nach dem Auslösen ist dieser verbraucht.
        planen(context, p.getInt(KEY_HOUR, 9), p.getInt(KEY_MINUTE, 0));
    }

    /** Legt den Kanal an. Ab Android 8 Pflicht, sonst erscheint nichts. */
    static void kanalAnlegen(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL,
                "Tägliche Erinnerung", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Einmal am Tag ein Hinweis auf neue Petitionen.");
        nm.createNotificationChannel(ch);
    }

    /**
     * Setzt den nächsten Weckruf auf die angegebene Uhrzeit. Liegt sie heute
     * schon in der Vergangenheit, wird morgen daraus.
     */
    static void planen(Context context, int stunde, int minute) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar ziel = Calendar.getInstance();
        ziel.set(Calendar.HOUR_OF_DAY, stunde);
        ziel.set(Calendar.MINUTE, minute);
        ziel.set(Calendar.SECOND, 0);
        ziel.set(Calendar.MILLISECOND, 0);
        if (ziel.getTimeInMillis() <= System.currentTimeMillis())
            ziel.add(Calendar.DAY_OF_YEAR, 1);
        am.set(AlarmManager.RTC_WAKEUP, ziel.getTimeInMillis(), alarmZeiger(context));
    }

    static void abbrechen(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmZeiger(context));
    }

    private static PendingIntent alarmZeiger(Context context) {
        Intent i = new Intent(context, NotifyReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, ALARM_REQ, i, flags);
    }

    /**
     * Tagesmeldung mit allgemeinem Text. Der Alarm läuft ohne die Web-App,
     * kennt die Petitionsdaten also nicht und könnte keine Anzahl nennen, ohne
     * selbst zu laden und zu zerlegen. Eine erfundene oder veraltete Zahl wäre
     * schlechter als keine – die genaue Zahl steht in der App, sobald man sie
     * öffnet.
     */
    static void zeigen(Context context) {
        zeigen(context, "PetitionsManager",
               "Schau nach, was sich bei deinen Plattformen bewegt hat.");
    }

    /** Wie oben, aber mit eigenem Text – die Web-App nutzt das für den Test,
     *  damit dort dieselbe Meldung erscheint wie im Browser. */
    static void zeigen(Context context, String titel, String text) {
        kanalAnlegen(context);
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        Intent auf = new Intent(context, MainActivity.class);
        auf.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent tippen = PendingIntent.getActivity(context, 0, auf, flags);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL)
                : new Notification.Builder(context);
        b.setSmallIcon(android.R.drawable.ic_dialog_info)
         .setContentTitle(titel == null || titel.isEmpty() ? "PetitionsManager" : titel)
         .setContentText(text == null ? "" : text)
         .setAutoCancel(true)
         .setContentIntent(tippen);
        nm.notify(NOTIFY_ID, b.build());
    }
}
