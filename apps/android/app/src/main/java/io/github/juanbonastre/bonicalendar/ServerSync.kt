package io.github.juanbonastre.bonicalendar

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * With Boni Calendar Server, the app keeps its reminders current by itself (phase 5): it asks the server
 * for the notices of the next days when the server tells it by UnifiedPush that something changed, after
 * the phone restarts, and every few hours in case a message was lost. The page tells it how to reach the
 * server (`serverSync`), or that there is none.
 */
object ServerSync {
    const val ACTION_SYNC = "io.github.juanbonastre.bonicalendar.SYNC"
    private const val HOURS = 7 * 24
    private val pool = Executors.newSingleThreadExecutor()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("server", Context.MODE_PRIVATE)

    private fun config(ctx: Context): JSONObject? = prefs(ctx).getString("config", null)?.let { JSONObject(it) }

    /** The page's server, or null (no server: the page itself hands over the notices). */
    fun configure(ctx: Context, json: String?) {
        val before = prefs(ctx).getString("config", null)
        prefs(ctx).edit().apply { if (json == null) remove("config") else putString("config", json) }.apply()
        if (json == null) {
            stop(ctx)
            if (before != null) {
                UnifiedPush.unregister(ctx)
                prefs(ctx).edit().remove("endpoint").apply()
            }
            return
        }
        start(ctx)
        pool.execute { syncNow(ctx) }
    }

    /** UnifiedPush gave this device an address: the server learns it. */
    fun endpoint(ctx: Context, url: String?) {
        prefs(ctx).edit().apply { if (url == null) remove("endpoint") else putString("endpoint", url) }.apply()
        if (url != null) pool.execute { register(ctx, url) }
    }

    /** Every few hours, in case a push message was lost (inexact: the phone batches it with others). */
    fun start(ctx: Context) {
        if (config(ctx) == null) return
        ctx.getSystemService(AlarmManager::class.java).setInexactRepeating(
            AlarmManager.RTC,
            System.currentTimeMillis() + AlarmManager.INTERVAL_HOUR,
            3 * AlarmManager.INTERVAL_HOUR,
            periodic(ctx),
        )
    }

    private fun stop(ctx: Context) = ctx.getSystemService(AlarmManager::class.java).cancel(periodic(ctx))

    private fun periodic(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
        ctx,
        1,
        Intent(ctx, NoticeReceiver::class.java).setAction(ACTION_SYNC),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** From a receiver: syncs off the main thread and then lets the receiver finish. */
    fun runAsync(ctx: Context, done: BroadcastReceiver.PendingResult?) {
        pool.execute {
            try {
                syncNow(ctx)
            } finally {
                done?.finish()
            }
        }
    }

    fun runAsync(ctx: Context) = runAsync(ctx, null)

    /** Asks the server for the notices of the next days and sets them as alarms. */
    private fun syncNow(ctx: Context) {
        val c = config(ctx) ?: return
        try {
            val q = listOf(
                "tz" to c.optString("tz", "UTC"),
                "hours" to HOURS.toString(),
                "locale" to c.optString("locale", "es"),
                "h24" to if (c.optBoolean("h24", true)) "1" else "0",
            ).joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
            val text = request(c, "GET", "/api/reminders?$q", null)
            Notices.schedule(ctx, JSONObject(text).getJSONArray("notices").toString())
        } catch (e: Exception) {
            Log.w(MainActivity.TAG, "reminders not updated: ${e.message}")
        }
    }

    private fun register(ctx: Context, endpoint: String) {
        val c = config(ctx) ?: return
        try {
            request(c, "PUT", "/api/push", JSONObject().put("endpoint", endpoint).toString())
        } catch (e: Exception) {
            Log.w(MainActivity.TAG, "push address not registered: ${e.message}")
        }
    }

    private fun request(c: JSONObject, method: String, path: String, body: String?): String {
        val conn = URL(c.getString("url").trimEnd('/') + path).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("authorization", "Bearer ${c.getString("token")}")
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray()) }
        }
        try {
            if (conn.responseCode >= 400) throw IllegalStateException("HTTP ${conn.responseCode}")
            return conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        } finally {
            conn.disconnect()
        }
    }
}
