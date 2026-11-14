package io.github.juanbonastre.boni

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream

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
        // A kept write's answer takes it out of `unsent.json` even if the page has gone meanwhile (D-65, D-68).
        val ticket = unsentBook.sending(method, path, UnsentLogic.bodyOf(method, path, body))
        var reached = false
        var answer = ""
        return try {
            val r = Http.send(method, "$server/$path", token, body, timeoutMs = Paths.timeoutMs(path))
            // A server failing (5xx) did not take the write: it stays kept, like no connection (as on the desktop).
            reached = r.status < 500
            answer = r.body
            if (r.status == 401 && !sessionEnded) {
                sessionEnded = true
                emitSettings()
            }
            JSONObject().put("ok", true).put("status", r.status).put("body", r.body)
        } catch (e: IOException) {
            offline(e.message ?: e.toString())
        } finally {
            if (unsentBook.answered(ticket, reached, answer)) settleUnsent()
        }
    }

    private fun offline(message: String) = JSONObject().put("ok", false).put("offline", true).put("message", message)

    /**
     * Sends a file chosen on the phone to `POST api/data/files/upload` (task 114, A-24), streamed with the token:
     * the server's answer `{status, body}` or `{error}` (`UploadAnswer` in uploads.ts), as the desktop's uploads.cjs.
     */
    fun upload(name: String, size: Long, open: () -> InputStream, progress: (Long) -> Unit): JSONObject {
        val error = { code: String -> JSONObject().put("error", code) }
        val path = Uploads.path(name)
        if (path == null || !Paths.apiRequest("POST", path)) return error("bad-name")
        if (size > Uploads.MAX_UPLOAD) return error("too-big")
        val (server, token) = target() ?: return error("offline")
        // Gone from the phone, or its grant went with the app's restart since it was chosen: not the network.
        val input = try {
            open()
        } catch (e: Exception) {
            return error("unreadable")
        }
        return try {
            val r = input.use { Uploads.send("$server/$path", token, size, it, progress) }
            if (r.status == 401 && !sessionEnded) {
                sessionEnded = true
                emitSettings()
            }
            JSONObject().put("status", r.status).put("body", r.body)
        } catch (e: Uploads.Unreadable) {
            error("unreadable")
        } catch (e: IOException) {
            error("offline")
        }
    }

    /**
     * This phone's UnifiedPush address for Boni's notices, with the keys its connector made (Notices, task 62), told to
     * the server with the session's token: PUT /api/push «for notices».
     */
    fun registerPush(body: JSONObject): Boolean {
        val (server, token) = target() ?: return false
        return try {
            val r = Http.send("PUT", "$server/api/push", token, body.toString(), 15_000)
            if (r.status != 200) Log.w(MainActivity.TAG, "push address not registered: HTTP ${r.status}")
            r.status == 200
        } catch (e: IOException) {
            Log.w(MainActivity.TAG, "push address not registered: ${e.message}")
            false
        }
    }

    // ---------- what was typed and has no answer yet (`unsent.json`, UnsentLogic) ----------
    /** Every answer this process saw to a kept write, the page's and the worker's (unsent.cjs `createUnsent`). */
    private val unsentBook = UnsentLogic.Book()

    /**
     * The page's list, kept before the call returns (`boniAndroid.keepUnsent`, task 106), but for what was answered
     * meanwhile. With the app hidden, the worker sends it (task 109).
     */
    fun keepUnsent(text: String) {
        val list = UnsentLogic.parse(text)
        val front = foreground
        val wrote = synchronized(UNSENT_LOCK) {
            val f = storeFile(UNSENT_FILE)
            val had = f.exists()
            val next = unsentBook.left(list)
            writeUnsent(next, if (UnsentLogic.same(list, next)) text else null)
            // The backstop while anything is kept (task 121), asked for under the lock: see `QueueWorker.backstop`.
            if (next.isNotEmpty() && (!had || !front)) QueueWorker.backstop(app)
            !had && next.isNotEmpty()
        }
        // Said first: the system may end the app while the job is asked for.
        Log.i(MainActivity.TAG, "unsent: kept ${list.size}, foreground $front")
        // The first kept write, or the last one as the app hides: a job that sends them, also if the app is closed.
        QueueWorker.ask(app, front, (wrote || !front) && hasUnsent()) { QueueWorker.schedule(app, 0) }
    }

    fun hasUnsent(): Boolean = synchronized(UNSENT_LOCK) { storeFile(UNSENT_FILE).exists() }

    /** `list` as the device's copy (its text, when the page's own is still it); none when it is empty. */
    private fun writeUnsent(list: List<JSONObject>, text: String? = null) {
        val f = storeFile(UNSENT_FILE)
        if (list.isEmpty()) {
            f.delete()
            return
        }
        val tmp = File(f.parentFile, "${f.name}.tmp")
        tmp.writeText(text ?: UnsentLogic.text(list))
        if (!tmp.renameTo(f)) {
            f.writeText(text ?: UnsentLogic.text(list))
            tmp.delete()
        }
    }

    /** The device's copy without what was answered. */
    private fun settleUnsent() {
        synchronized(UNSENT_LOCK) {
            val f = storeFile(UNSENT_FILE)
            if (!f.exists()) return
            val list = UnsentLogic.parse(f.readText())
            val next = unsentBook.left(list)
            if (!UnsentLogic.same(list, next)) writeUnsent(next)
        }
    }

    /**
     * The worker's resend of the kept list with the app closed (task 109): what `UnsentLogic.flush` says, with this
     * app's session; the network is used outside the lock, so the page's own keep never waits for it. True when some
     * of it is left to try again later.
     */
    fun sendUnsent(stopped: () -> Boolean): Boolean {
        val list = synchronized(UNSENT_LOCK) {
            val f = storeFile(UNSENT_FILE)
            if (!f.exists()) return false
            UnsentLogic.parse(f.readText())
        }
        if (list.isEmpty()) return false
        val (server, token) = target() ?: return true
        val out = UnsentLogic.flush(
            list,
            unsentBook,
            stop = { foreground || stopped() },
            send = { r ->
                try {
                    Http.send(r.method, "$server/${r.path}", token, r.body.toString()).also {
                        if (it.status == 401) sessionEnded = true
                    }
                } catch (e: IOException) {
                    null
                }
            },
            answered = { settleUnsent() },
        )
        Log.i(MainActivity.TAG, "unsent: the worker sent ${out.answered} of ${list.size}, again later: ${out.retry}")
        return out.retry
    }

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

    private fun lockFor(name: String) = if (name == UNSENT_FILE) UNSENT_LOCK else QUEUE_LOCK

    fun storeRead(name: String): String? = synchronized(lockFor(name)) {
        storeFile(name).takeIf { it.exists() }?.readText()
    }

    fun storeWrite(name: String, text: String) {
        synchronized(lockFor(name)) {
            val f = storeFile(name)
            val tmp = File(f.parentFile, "${f.name}.tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(f)) {
                f.writeText(text)
                tmp.delete()
            }
            if (name == QUEUE_FILE && QueueLogic.waiting(text)) QueueWorker.backstop(app)
        }
        if (name == QUEUE_FILE) QueueWorker.ask(app, foreground, true) { QueueWorker.scheduleFor(app, text) }
    }

    fun storeRemove(name: String) {
        synchronized(lockFor(name)) { storeFile(name).delete() }
    }

    companion object {
        const val QUEUE_FILE = "queue.json"
        /** What was typed and has no answer yet (the page's `core/unsent.ts`), kept at once by `keepUnsent`. */
        const val UNSENT_FILE = "unsent.json"

        /** Page writes and the worker's flush never interleave inside the process. */
        val QUEUE_LOCK = Any()

        /** The same for `unsent.json`, held only while the file is read or written, never over the network. */
        val UNSENT_LOCK = Any()

        /** The activity is in front: the page sends the queue itself (minute ticks). */
        @Volatile var foreground = false

        @Volatile private var instance: Shell? = null

        fun get(context: Context): Shell =
            instance ?: synchronized(this) { instance ?: Shell(context).also { instance = it } }
    }
}
