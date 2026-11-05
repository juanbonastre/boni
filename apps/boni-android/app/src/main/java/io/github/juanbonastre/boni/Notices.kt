package io.github.juanbonastre.boni

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import java.util.concurrent.Executors

/** A notice of Boni's as it arrives by UnifiedPush (the server's `Push.notice`, apps/server/src/reminders.ts). */
data class Notice(val id: String, val text: String, val at: Long)

/**
 * Pure rules about Boni's notices (unit-tested): what a push message must be to show, and how the app registers its
 * address. A notice only counts when the connector opened it with this device's keys (RFC 8291): a message in the
 * clear, or sealed for another device, shows nothing.
 */
object NoticeRules {
    /** As the server cuts a notice (packages/agent's notify). */
    const val MAX_TEXT = 500

    // Control characters other than tab and new line.
    private val CONTROL = Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]")

    /** The notice in a push message, or null. */
    fun parse(content: ByteArray, decrypted: Boolean): Notice? {
        if (!decrypted) return null
        return try {
            val o = JSONObject(String(content, Charsets.UTF_8))
            if (o.optString("kind") != "notice") return null
            val text = o.optString("text").replace(CONTROL, "").trim().take(MAX_TEXT)
            if (text.isEmpty()) return null
            Notice(o.optString("id").ifEmpty { text }, text, o.optLong("at"))
        } catch (e: Exception) {
            null
        }
    }

    /** What `PUT /api/push` gets for notices: the address with this device's keys; nothing without them. */
    fun registration(endpoint: String, pubKey: String?, auth: String?): JSONObject? {
        if (endpoint.isBlank() || pubKey.isNullOrBlank() || auth.isNullOrBlank()) return null
        return JSONObject()
            .put("endpoint", endpoint)
            .put("for", "notices")
            .put("keys", JSONObject().put("p256dh", pubKey).put("auth", auth))
    }
}

/**
 * Boni's notices on the phone (task 62): its address with the phone's UnifiedPush distributor (the ntfy app, as Boni
 * Calendar's), registered when the app opens with a session and after a login, and each notice that arrives as a
 * system notification, also with the app closed: channel «Avisos», its text as plain text, a tap opens Boni.
 */
object Notices {
    const val CHANNEL = "notices"
    private val pool = Executors.newSingleThreadExecutor()

    /** From the app's window (the first time the distributor may ask which app to use): the permission, then the address. */
    fun start(activity: MainActivity) {
        activity.askNotificationPermission()
        UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { ok ->
            if (ok) UnifiedPush.register(activity)
        }
    }

    /** The distributor gave this device an address: the server learns it with the keys the connector made. */
    fun endpoint(ctx: Context, endpoint: PushEndpoint) {
        val keys = endpoint.pubKeySet
        val body = NoticeRules.registration(endpoint.url, keys?.pubKey, keys?.auth)
        if (body == null) {
            Log.w(MainActivity.TAG, "push address without keys: not registered")
            return
        }
        val app = ctx.applicationContext
        pool.execute { Shell.get(app).registerPush(body) }
    }

    /** Logged out: no more notices on this phone (the server forgets the address with the session). */
    fun stop(ctx: Context) {
        try {
            UnifiedPush.unregister(ctx)
        } catch (e: Exception) {
            Log.w(MainActivity.TAG, "push not unregistered: ${e.message}")
        }
    }

    /** One notice as a system notification; nothing without the permission. */
    fun show(ctx: Context, n: Notice) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, ctx.getString(R.string.notices_channel), NotificationManager.IMPORTANCE_HIGH),
            )
        }
        val open = PendingIntent.getActivity(
            ctx,
            0,
            Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // Plain text: no spans, no links (text a model wrote is painted as text).
        val notification = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notice)
            .setContentText(n.text)
            .setStyle(Notification.BigTextStyle().bigText(n.text))
            .setWhen(if (n.at > 0) n.at else System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        nm.notify(n.id.hashCode(), notification)
    }
}
