package io.github.juanbonastre.bonicalendar

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.provider.Settings
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * What the page asks of the phone, as `window.boniAndroid` (the web side is `apps/calendar-web/src/android.ts`).
 * Calls are asynchronous: `call(id, method, args)` runs on a small pool of threads, then the page is
 * told (`__boniReply(id)`) and fetches the answer with `take(id)` (so large texts are never pasted
 * into JavaScript). Every answer is `{ ok: true, value }` or `{ ok: false, code, message }`, like the
 * desktop shell's IPC.
 */
class AndroidBridge(private val activity: MainActivity, private val web: WebView) {
    private val pool = Executors.newFixedThreadPool(6)
    private val answers = ConcurrentHashMap<String, String>()

    @JavascriptInterface
    fun call(id: String, method: String, args: String) {
        pool.execute {
            val out = try {
                ok(dispatch(method, JSONArray(args)))
            } catch (e: BridgeError) {
                fail(e.code, e.message ?: e.code)
            } catch (e: Exception) {
                fail("failed", e.message ?: e.toString())
            }
            answer(id, out)
        }
    }

    @JavascriptInterface
    fun take(id: String): String = answers.remove(id) ?: fail("lost", "No answer for $id")

    private fun answer(id: String, json: String) {
        answers[id] = json
        activity.runOnUiThread { web.evaluateJavascript("window.__boniReply && window.__boniReply('$id')", null) }
    }

    private fun ok(value: Any?): String = JSONObject().put("ok", true).put("value", value ?: JSONObject.NULL).toString()
    private fun fail(code: String, message: String): String =
        JSONObject().put("ok", false).put("code", code).put("message", message).toString()

    private fun dispatch(method: String, a: JSONArray): Any? = when (method) {
        "fetchText" -> fetchText(a.getString(0))
        // GrapheneOS turns network access into a per-app permission ("Network") that apps cannot ask for
        // with a dialog: it is set at install time and changed in the app's settings. The page asks
        // whether it has it, and can open that settings page.
        "networkAllowed" -> activity.checkSelfPermission(Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED
        "openAppSettings" -> {
            activity.runOnUiThread {
                activity.startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null)),
                )
            }
            null
        }
        // Reminders (phase 5): the page's notices become alarms; with a server the app fetches them itself.
        "scheduleNotices" -> {
            Notices.schedule(activity, a.getString(0))
            activity.runOnUiThread { activity.askNotificationPermission() }
            null
        }
        "serverSync" -> {
            val cfg = if (a.isNull(0)) null else a.getString(0)
            ServerSync.configure(activity, cfg)
            if (cfg != null) {
                activity.runOnUiThread {
                    activity.askNotificationPermission()
                    // The distributor (ntfy) if there is one; without it the app still syncs every few hours.
                    UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { ok ->
                        if (ok) UnifiedPush.register(activity)
                    }
                }
            }
            null
        }
        "takeOpenEvent" -> activity.takeOpenEvent()
        // «Abrir en Boni»: the record (by its id) in Boni's own Android app, which takes boni://note links.
        "openBoniNote" -> {
            val id = a.getString(0)
            if (!RECORD_ID.matches(id)) throw BridgeError("bad-id", "Bad record id")
            val open = Intent(Intent.ACTION_VIEW, Uri.parse("boni://note?id=$id"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                activity.startActivity(open)
            } catch (e: ActivityNotFoundException) {
                throw BridgeError("no-boni", "Boni is not installed")
            }
            null
        }
        else -> throw BridgeError("unknown", "Unknown call: $method")
    }

    /** External calendars: an http(s) download with time and size limits. */
    private fun fetchText(address: String): String {
        val url = URL(address)
        if (url.protocol != "https" && url.protocol != "http") throw BridgeError("fetch", "Only http(s) addresses")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 20_000
        try {
            if (conn.responseCode >= 400) throw BridgeError("fetch", "HTTP ${conn.responseCode}")
            val out = java.io.ByteArrayOutputStream()
            conn.inputStream.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_DOWNLOAD) throw BridgeError("fetch", "Too large")
                }
            }
            return out.toByteArray().toString(Charsets.UTF_8)
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val MAX_DOWNLOAD = 20 * 1024 * 1024
        /** A record's id as Boni gives it (the calendar's rows are known by it): a plain one, nothing else in a link. */
        private val RECORD_ID = Regex("^[A-Za-z0-9_-]{1,100}$")
    }
}

/** A call the page made that could not be answered, with a code the page understands. */
class BridgeError(val code: String, message: String) : Exception(message)
