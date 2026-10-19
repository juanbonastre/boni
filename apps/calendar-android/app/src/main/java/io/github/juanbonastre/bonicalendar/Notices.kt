package io.github.juanbonastre.bonicalendar

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import java.io.File

/**
 * Reminders as system alarms (phase 5). The page (local vault) or the server (ServerSync) hands over the
 * notices of the coming hours, already worded; each becomes an exact alarm that shows a notification,
 * also with the app closed. The list is kept in the app's files so it survives a restart of the phone.
 * A new list replaces the previous one; a notice is never shown twice.
 */
object Notices {
    private const val MAX = 200
    const val ACTION_SHOW = "io.github.juanbonastre.bonicalendar.SHOW_NOTICE"
    const val CHANNEL = "reminders"

    private fun file(ctx: Context) = File(ctx.filesDir, "notices.json")
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("notices", Context.MODE_PRIVATE)

    /** Replaces the scheduled notices with `json` (the page's `Notice[]`). */
    @Synchronized
    fun schedule(ctx: Context, json: String) {
        val list = JSONArray(json)
        file(ctx).writeText(list.toString())
        arm(ctx, list)
    }

    /** After the phone restarts or the app is updated, the alarms are set again from the saved list. */
    @Synchronized
    fun rearm(ctx: Context) {
        val f = file(ctx)
        if (f.exists()) arm(ctx, JSONArray(f.readText()))
    }

    private fun arm(ctx: Context, list: JSONArray) {
        val alarms = ctx.getSystemService(AlarmManager::class.java)
        val p = prefs(ctx)
        // Cancel what the previous list set.
        for (code in (p.getString("armed", "") ?: "").split(",").filter { it.isNotEmpty() }) {
            alarms.cancel(pending(ctx, code.toInt(), null))
        }
        val shown = shownIds(ctx)
        val now = System.currentTimeMillis()
        val armed = mutableListOf<Int>()
        for (i in 0 until minOf(list.length(), MAX)) {
            val n = list.getJSONObject(i)
            val id = n.optString("id")
            val at = n.optLong("at")
            if (id.isEmpty() || id in shown || at < now - 60_000) continue
            val code = id.hashCode()
            val intent = Intent(ctx, NoticeReceiver::class.java).setAction(ACTION_SHOW)
                .putExtra("id", id)
                .putExtra("eventId", n.optString("eventId"))
                .putExtra("title", n.optString("title"))
                .putExtra("body", n.optString("body"))
            val pi = pending(ctx, code, intent)
            val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
            if (canExact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            armed.add(code)
        }
        p.edit().putString("armed", armed.joinToString(",")).apply()
    }

    private fun pending(ctx: Context, code: Int, intent: Intent?): PendingIntent =
        PendingIntent.getBroadcast(
            ctx,
            code,
            intent ?: Intent(ctx, NoticeReceiver::class.java).setAction(ACTION_SHOW),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun shownIds(ctx: Context): List<String> =
        (prefs(ctx).getString("shown", "") ?: "").split("\n").filter { it.isNotEmpty() }

    @Synchronized
    private fun markShown(ctx: Context, id: String) {
        val kept = (shownIds(ctx) + id).takeLast(500)
        prefs(ctx).edit().putString("shown", kept.joinToString("\n")).apply()
    }

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, ctx.getString(R.string.reminders_channel), NotificationManager.IMPORTANCE_HIGH),
            )
        }
    }

    /** Shows one notice; tapping it opens the calendar on that event. */
    fun show(ctx: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        if (id in shownIds(ctx)) return
        markShown(ctx, id)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannel(ctx)
        val open = PendingIntent.getActivity(
            ctx,
            id.hashCode(),
            Intent(ctx, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_EVENT, intent.getStringExtra("eventId"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = android.app.Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notice)
            .setContentTitle(intent.getStringExtra("title"))
            .setContentText(intent.getStringExtra("body"))
            .setCategory(android.app.Notification.CATEGORY_EVENT)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(id.hashCode(), n)
    }
}

/** The alarms of the notices, and the phone's restart (alarms do not survive it). */
class NoticeReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Notices.ACTION_SHOW -> Notices.show(ctx, intent)
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Notices.rearm(ctx)
                ServerSync.start(ctx)
            }
            ServerSync.ACTION_SYNC -> ServerSync.runAsync(ctx, goAsync())
        }
    }
}
