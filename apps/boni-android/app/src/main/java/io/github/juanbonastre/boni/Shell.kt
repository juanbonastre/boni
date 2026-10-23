package io.github.juanbonastre.boni

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

/**
 * What the app owns for the page, once per process (the activity and the queue worker share it): the settings,
 * the session token, every request to the server, the page's small files and the live connection. The same jobs
 * as the desktop shell's main process (apps/desktop/main.cjs), with the same answers.
 */
class Shell private constructor(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val tokens = TokenVault(app)
    private val storeDir = File(app.filesDir, "store").apply { mkdirs() }

    @Volatile var sessionEnded = false
    @Volatile var liveUnsupported = false

    /** Events for the page (`window.__boniEvent`), set while the activity is there. */
    @Volatile var emit: ((JSONObject) -> Unit)? = null

    val live = Live(
        target = { target() },
        onChange = { what ->
            when (what) {
                "session" -> {
                    sessionEnded = true
                    emitSettings()
                }
                "unsupported" -> {
                    liveUnsupported = true
                    emitSettings()
                }
                else -> {
                    if (what == "data" || what == "charts" || what == "all") WidgetWorker.refresh(app)
                    if (liveUnsupported) {
                        liveUnsupported = false
                        emitSettings()
                    }
                    emit?.invoke(JSONObject().put("type", "changed").put("what", what))
                }
            }
        },
        onState = { emitSettings() },
    )

    private fun str(key: String, default: String = "") = prefs.getString(key, default) ?: default

    private fun target(): Pair<String, String>? {
        val server = str("serverUrl")
        val token = tokens.read()
        return if (server.isNotEmpty() && token != null) server to token else null
    }

    fun configured() = target() != null

    /** What the page may know (`ClientSettings` in host.ts): never the token. */
    fun clientSettings(): JSONObject = JSONObject()
        .put("serverUrl", str("serverUrl"))
        .put("hasToken", tokens.read() != null)
        .put("user", str("user"))
        .put("device", str("device"))
        .put("legacyToken", false)
        .put("sessionEnded", sessionEnded)
        .put("live", live.live)
        .put("liveUnsupported", liveUnsupported)
        .put("theme", str("theme", "dark"))
        .put("language", str("language", "es"))
        .put("showWidgets", false)
        .put("hiddenWidgets", JSONArray())
        .put("autostart", false)
        .put("layerAvailable", false)

    fun emitSettings() {
        emit?.invoke(JSONObject().put("type", "settings").put("settings", clientSettings()))
    }

    /** Theme and language (the rest of `SettingsPatch` is the desktop's). */
    fun setSettings(patch: JSONObject): JSONObject {
        val edit = prefs.edit()
        patch.optString("theme").takeIf { it in setOf("dark", "light", "system") }?.let { edit.putString("theme", it) }
        patch.optString("language").takeIf { it in setOf("es", "en") }?.let { edit.putString("language", it) }
        edit.apply()
        emitSettings()
        return clientSettings()
    }

    fun suggestedDevice(): String = str("device").ifEmpty { Build.MODEL.trim().lowercase().take(80).ifEmpty { "movil" } }

    // ---------- account ----------
    /** `LoginAnswer` in host.ts. The password goes straight to the server; only the session token is kept. */
    fun login(form: JSONObject): JSONObject {
        val url = Paths.serverUrl(form.optString("serverUrl")) ?: return fail("bad-url")
        val user = form.optString("user").trim()
        val password = form.optString("password")
        val device = form.optString("device").trim().take(80)
        if (user.isEmpty() || password.isEmpty() || device.isEmpty()) return fail("missing")
        val body = JSONObject().put("user", user).put("password", password).put("device", device).toString()
        val r = try {
            Http.send("POST", "$url/api/v1/login", null, body, 20_000)
        } catch (e: IOException) {
            return fail("offline")
        }
        when (r.status) {
            401 -> return fail("bad-login")
            429 -> return fail("too-many")
            404 -> return fail("old-server")
        }
        val json = try {
            JSONObject(r.body)
        } catch (e: Exception) {
            null
        }
        val token = json?.optString("token").orEmpty()
        if (r.status != 200 || token.isEmpty()) return fail("server")
        tokens.write(token)
        prefs.edit()
            .putString("serverUrl", url)
            .putString("user", json!!.optString("user", user))
            .putString("device", json.optString("device", device))
            .apply()
        sessionEnded = false
        live.start()
        emitSettings()
        emit?.invoke(JSONObject().put("type", "changed").put("what", "all"))
        return JSONObject().put("ok", true).put("settings", clientSettings())
    }

    private fun fail(code: String) = JSONObject().put("ok", false).put("code", code)

    fun logout(): JSONObject {
        target()?.let { (server, token) ->
            try {
                Http.send("POST", "$server/api/v1/logout", token, "{}", 10_000)
            } catch (e: IOException) {
                // offline: the session ends by itself after 90 idle days
            }
        }
        tokens.write(null)
        prefs.edit().putString("user", "").apply()
        live.stop()
        emitSettings()
        return clientSettings()
    }

    // ---------- requests (`TransportAnswer` in api.ts) ----------
    fun request(method: String, path: String, body: String?): JSONObject {
        if (!Paths.apiRequest(method, path)) return offline("bad request")
        val (server, token) = target()
            ?: return JSONObject().put("ok", false).put("offline", false).put("notConfigured", true)
        return try {
            val r = Http.send(method, "$server/$path", token, body, timeoutMs = Paths.timeoutMs(path))
            if (r.status == 401 && !sessionEnded) {
                sessionEnded = true
                emitSettings()
            }
            JSONObject().put("ok", true).put("status", r.status).put("body", r.body)
        } catch (e: IOException) {
            offline(e.message ?: e.toString())
        }
    }

    private fun offline(message: String) = JSONObject().put("ok", false).put("offline", true).put("message", message)

    /** One queued capture, sent by the worker with the app closed (POST /api/v1/actions). */
    fun sendAction(request: JSONObject): QueueLogic.Outcome {
        val (server, token) = target() ?: return QueueLogic.Outcome.Retry
        return try {
            val r = Http.send("POST", "$server/api/v1/actions", token, request.toString())
            if (r.status == 401) sessionEnded = true
            QueueLogic.outcome(r.status, r.body)
        } catch (e: IOException) {
            QueueLogic.Outcome.Retry
        }
    }

    // ---------- the page's small files (queue, last answers) ----------
    fun storeFile(name: String): File {
        require(Paths.storeName(name)) { "bad name" }
        return File(storeDir, name)
    }

    fun storeRead(name: String): String? = synchronized(QUEUE_LOCK) {
        storeFile(name).takeIf { it.exists() }?.readText()
    }

    fun storeWrite(name: String, text: String) {
        synchronized(QUEUE_LOCK) {
            val f = storeFile(name)
            val tmp = File(f.parentFile, "${f.name}.tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(f)) {
                f.writeText(text)
                tmp.delete()
            }
        }
        if (name == QUEUE_FILE) QueueWorker.scheduleFor(app, text)
    }

    fun storeRemove(name: String) {
        synchronized(QUEUE_LOCK) { storeFile(name).delete() }
    }

    companion object {
        const val QUEUE_FILE = "queue.json"

        /** Page writes and the worker's flush never interleave inside the process. */
        val QUEUE_LOCK = Any()

        /** The activity is in front: the page sends the queue itself (minute ticks). */
        @Volatile var foreground = false

        @Volatile private var instance: Shell? = null

        fun get(context: Context): Shell =
            instance ?: synchronized(this) { instance ?: Shell(context).also { instance = it } }
    }
}
