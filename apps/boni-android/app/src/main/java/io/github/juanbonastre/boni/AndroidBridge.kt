package io.github.juanbonastre.boni

import android.content.Context
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
    private val answers = ConcurrentHashMap<String, String>()

    @JavascriptInterface
    fun call(id: String, method: String, args: String) {
        pool.execute {
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
        "login" -> shell.login(JSONObject(a.getString(0)))
        "logout" -> shell.logout()
        "suggestedDevice" -> shell.suggestedDevice()
        "pin" -> Launcher.pin(context, JSONObject(a.getString(0)))
        "setTargets" -> Launcher.setTargets(context, JSONArray(a.getString(0)), a.getInt(1)).let { null }
        "takeLaunch" -> activity?.takeLaunch()
        "pictureReady" -> onPicture?.let { ui.post(it) }.let { null }
        else -> throw IllegalArgumentException("Unknown call: $method")
    }
}
