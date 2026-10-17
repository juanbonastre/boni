package io.github.juanbonastre.bonicalendar

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * What the page asks of the phone, as `window.boniAndroid` (the web side is `apps/web/src/android.ts`).
 * Calls are asynchronous: `call(id, method, args)` runs on a small pool of threads, then the page is
 * told (`__boniReply(id)`) and fetches the answer with `take(id)` (so large texts are never pasted
 * into JavaScript). Every answer is `{ ok: true, value }` or `{ ok: false, code, message }`, like the
 * desktop shell's IPC.
 */
class AndroidBridge(private val activity: MainActivity, private val web: WebView) {
    private val pool = Executors.newFixedThreadPool(6)
    private val answers = ConcurrentHashMap<String, String>()
    private val prefs = activity.getSharedPreferences("vault", Context.MODE_PRIVATE)

    @Volatile private var vault: VaultSaf? = prefs.getString("tree", null)?.let { VaultSaf(activity, Uri.parse(it)) }

    @JavascriptInterface
    fun call(id: String, method: String, args: String) {
        if (method == "chooseRoot") {
            activity.runOnUiThread {
                activity.pickVault { tree ->
                    if (tree != null) {
                        prefs.edit().putString("tree", tree.toString()).apply()
                        vault = VaultSaf(activity, tree)
                    }
                    answer(id, ok(if (tree != null) vault?.label else JSONObject.NULL))
                }
            }
            return
        }
        pool.execute {
            val out = try {
                ok(dispatch(method, JSONArray(args)))
            } catch (e: VaultError) {
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

    private fun v(): VaultSaf = vault ?: throw VaultError("no-vault", "No vault chosen")

    private fun stat(s: VaultSaf.Stat) = JSONObject().put("exists", false).put("mtimeMs", s.mtime).put("size", s.size)
    private val exists get() = JSONObject().put("exists", true)

    private fun dispatch(method: String, a: JSONArray): Any? = when (method) {
        "getRoot" -> vault?.label
        "scan" -> JSONArray().also { list ->
            for (e in v().scan(a.getString(0))) {
                list.put(JSONObject().put("path", e.path).put("mtimeMs", e.mtime).put("size", e.size))
            }
        }
        "read" -> v().read(a.getString(0)).let { (text, mtime) -> JSONObject().put("text", text).put("mtimeMs", mtime) }
        "write" -> v().write(a.getString(0), a.getString(1), if (a.isNull(2)) null else a.getLong(2))
            .let { (conflict, mtime, size) -> JSONObject().put("conflict", conflict).put("mtimeMs", mtime).put("size", size) }
        "create" -> v().create(a.getString(0), a.getString(1))?.let { stat(it) } ?: exists
        "rename" -> v().rename(a.getString(0), a.getString(1))?.let { stat(it) } ?: exists
        "trash" -> v().trash(a.getString(0)).let { null }
        "openNote" -> openNote(a.getString(0))
        "cacheRead" -> VaultSaf.cacheFile(activity).takeIf { it.exists() }?.readText()
        "cacheWrite" -> VaultSaf.cacheFile(activity).writeText(a.getString(0)).let { null }
        "fetchText" -> fetchText(a.getString(0))
        else -> throw VaultError("unknown", "Unknown call: $method")
    }

    /** Opens the note in Obsidian (its vault is known by the folder's name). */
    private fun openNote(path: String): Any? {
        val vault = v()
        val rel = vault.requireNote(path)
        val uri = Uri.Builder().scheme("obsidian").authority("open")
            .appendQueryParameter("vault", vault.name)
            .appendQueryParameter("file", rel.removeSuffix(".md"))
            .build()
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            } catch (e: Exception) {
                // Obsidian is not installed in this profile: nothing to open.
            }
        }
        return null
    }

    /** External calendars: an http(s) download with time and size limits. */
    private fun fetchText(address: String): String {
        val url = URL(address)
        if (url.protocol != "https" && url.protocol != "http") throw VaultError("fetch", "Only http(s) addresses")
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 20_000
        try {
            if (conn.responseCode >= 400) throw VaultError("fetch", "HTTP ${conn.responseCode}")
            val out = java.io.ByteArrayOutputStream()
            conn.inputStream.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_DOWNLOAD) throw VaultError("fetch", "Too large")
                }
            }
            return out.toByteArray().toString(Charsets.UTF_8)
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val MAX_DOWNLOAD = 20 * 1024 * 1024
    }
}
