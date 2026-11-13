package io.github.juanbonastre.boni

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * What the page asks of the phone, as `window.boniAndroid` (the web side is `apps/boni-web/src/android.ts`), with Boni
 * Calendar's protocol: `call(id, method, args)` runs on a small pool of threads, then the page is told
 * (`__boniReply(id)`) and fetches the answer with `take(id)`. Every answer is `{ ok: true, value }` or
 * `{ ok: false, code, message }`.
 */
class AndroidBridge(
    private val context: Context,
    private val web: WebView,
    private val shell: Shell,
    /** The app's window (launcher entries that started it); null for a widget's picture page. */
    private val activity: MainActivity?,
    /** A widget's picture page has drawn its chart. */
    private val onPicture: (() -> Unit)? = null,
) {
    private val ui = Handler(Looper.getMainLooper())
    private val pool = Executors.newFixedThreadPool(4)
    // A file attached from the phone goes on its own thread, one after another (task 114): a long one never holds
    // the page's requests; and the picker waits for Juan on another.
    private val sending = Executors.newSingleThreadExecutor()
    private val picking = Executors.newSingleThreadExecutor()
    private val answers = ConcurrentHashMap<String, String>()

    @JavascriptInterface
    fun call(id: String, method: String, args: String) {
        val runner = when (method) {
            "uploadFile" -> sending
            "chooseFiles" -> picking
            else -> pool
        }
        runner.execute {
            val out = try {
                ok(dispatch(method, JSONArray(args)))
            } catch (e: Exception) {
                fail("failed", e.message ?: e.toString())
            }
            answers[id] = out
            ui.post {
                web.evaluateJavascript("window.__boniReply && window.__boniReply(${JSONObject.quote(id)})", null)
            }
        }
    }

    @JavascriptInterface
    fun take(id: String): String = answers.remove(id) ?: fail("lost", "No answer for $id")

    /**
     * Keeps the page's list of what was typed and has no answer yet (`unsent.json`, D-65) before it returns, on the
     * bridge's own thread: the page calls it as it hides or goes, and the system may end the app a moment later
     * (task 106). `call("storeWrite")` would return first and write it afterwards, on the pool.
     */
    @JavascriptInterface
    fun keepUnsent(text: String) = shell.keepUnsent(text)

    private fun ok(value: Any?): String =
        JSONObject().put("ok", true).put("value", value ?: JSONObject.NULL).toString()

    private fun fail(code: String, message: String): String =
        JSONObject().put("ok", false).put("code", code).put("message", message).toString()

    private fun text(a: JSONArray, i: Int): String? = if (a.isNull(i)) null else a.getString(i)

    private fun dispatch(method: String, a: JSONArray): Any? = when (method) {
        "request" -> shell.request(a.getString(0), a.getString(1), text(a, 2))
        "storeRead" -> shell.storeRead(a.getString(0))
        "storeWrite" -> shell.storeWrite(a.getString(0), a.getString(1)).let { null }
        "storeRemove" -> shell.storeRemove(a.getString(0)).let { null }
        "getSettings" -> shell.clientSettings()
        "setSettings" -> shell.setSettings(JSONObject(a.getString(0)))
        // After a login the phone gets its address for Boni's notices; after a logout it lets it go (task 62).
        "login" -> shell.login(JSONObject(a.getString(0))).also { answer ->
            val act = activity
            // Not in the test copy (the debug build): it never asks for the permission nor registers.
            if (answer.optBoolean("ok") && act != null && !context.resources.getBoolean(R.bool.test_copy)) {
                ui.post { Notices.start(act) }
            }
        }
        "logout" -> shell.logout().also { Notices.stop(context) }
        "suggestedDevice" -> shell.suggestedDevice()
        "pin" -> Launcher.pin(context, JSONObject(a.getString(0)))
        "setTargets" -> Launcher.setTargets(context, JSONArray(a.getString(0)), a.getInt(1)).let { null }
        "takeLaunch" -> activity?.takeLaunch()
        // «Adjuntar» in the conversation (task 114): the phone's picker, then each file chosen sent by its key.
        "chooseFiles" -> activity?.chooseFiles() ?: JSONArray()
        "uploadFile" -> uploadFile(a.getString(0))
        "pictureReady" -> onPicture?.let { ui.post(it) }.let { null }
        // An outside address (a mail in its webmail, task 55): the phone's browser; http(s) only.
        "openUrl" -> {
            val url = a.getString(0)
            if (!LINK.matches(url)) throw IllegalArgumentException("Bad link")
            val open = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(open)
            } catch (e: ActivityNotFoundException) {
                throw IllegalArgumentException("Nothing opens links")
            }
            null
        }
        else -> throw IllegalArgumentException("Unknown call: $method")
    }

    /** Sends the chosen file `key`, telling the page how much has gone a few times a second (`upload` events). */
    private fun uploadFile(key: String): JSONObject {
        val (name, size, open) = activity?.chosen?.take(key) ?: return JSONObject().put("error", "unreadable")
        var shown = 0L
        return shell.upload(name, size, open) { sent ->
            val now = System.currentTimeMillis()
            if (now - shown >= 150) {
                shown = now
                shell.emit?.invoke(JSONObject().put("type", "upload").put("key", key).put("sent", sent))
            }
        }
    }

    private companion object {
        val LINK = Regex("^https?://\\S{1,2000}$")
    }
}
