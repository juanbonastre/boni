package io.github.juanbonastre.boni

import org.json.JSONObject
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/** One server-sent event. */
data class SseEvent(val event: String, val data: String)

/** Splits SSE text into complete events and the unfinished rest (the desktop shell's `parseSse`, live.cjs). */
object Sse {
    private val BLOCK = Regex("\\r?\\n\\r?\\n")
    private val LINE = Regex("\\r?\\n")

    fun parse(buffer: String): Pair<List<SseEvent>, String> {
        val blocks = buffer.split(BLOCK)
        val rest = blocks.last()
        val events = mutableListOf<SseEvent>()
        for (block in blocks.dropLast(1)) {
            var event = "message"
            val data = mutableListOf<String>()
            for (line in block.split(LINE)) {
                if (line.isEmpty() || line.startsWith(":")) continue
                val i = line.indexOf(':')
                val field = if (i < 0) line else line.substring(0, i)
                val value = if (i < 0) "" else line.substring(i + 1).removePrefix(" ")
                if (field == "event") event = value else if (field == "data") data.add(value)
            }
            if (data.isNotEmpty()) events.add(SseEvent(event, data.joinToString("\n")))
        }
        return events to rest
    }

    /** What a `changed` event asks to load again, or null. */
    fun changed(e: SseEvent): String? {
        if (e.event != "changed") return null
        return try {
            JSONObject(e.data).optString("what").ifEmpty { null }
        } catch (x: Exception) {
            null
        }
    }

    /** Wait before reconnecting: 2 s, 4 s, 8 s ... up to a minute. */
    fun backoff(attempt: Int): Long = minOf(60_000L, 2000L * (1L shl minOf(attempt, 5)))
}

/**
 * The server's live changes (GET /api/v1/events) while the app is in front, as the desktop shell's live.cjs:
 * `onChange(what)` for each change ("all" after every (re)connection, since events may have been missed;
 * "session" when the session ended; "unsupported" for a server without them), `onState(live)` as it comes and goes.
 */
class Live(
    private val target: () -> Pair<String, String>?,
    private val onChange: (String) -> Unit,
    private val onState: (Boolean) -> Unit,
) {
    @Volatile private var thread: Thread? = null
    @Volatile private var conn: HttpURLConnection? = null
    @Volatile var live = false
        private set

    private fun setLive(v: Boolean) {
        if (v != live) {
            live = v
            onState(v)
        }
    }

    @Synchronized
    fun start() {
        stop()
        val t = Thread({ run(Thread.currentThread()) }, "boni-live")
        thread = t
        t.isDaemon = true
        t.start()
    }

    @Synchronized
    fun stop() {
        val t = thread
        thread = null
        t?.interrupt()
        Thread { conn?.disconnect() }.start()
        setLive(false)
    }

    private fun run(me: Thread) {
        var attempt = 0
        while (thread === me) {
            val (server, token) = target() ?: return
            try {
                val c = URL("$server/api/v1/events").openConnection() as HttpURLConnection
                conn = c
                c.connectTimeout = 15_000
                c.readTimeout = 60_000 // the server sends a comment every 25 s
                c.setRequestProperty("Authorization", "Bearer $token")
                c.setRequestProperty("Accept", "text/event-stream")
                c.setRequestProperty("X-Boni-Client", "boni-android")
                when (c.responseCode) {
                    401 -> {
                        setLive(false)
                        onChange("session")
                        return // until the next login
                    }
                    404 -> {
                        setLive(false)
                        onChange("unsupported")
                        Thread.sleep(10 * 60_000L)
                        continue
                    }
                }
                if (c.responseCode != 200) throw java.io.IOException("HTTP ${c.responseCode}")
                attempt = 0
                setLive(true)
                onChange("all")
                val reader = InputStreamReader(c.inputStream, Charsets.UTF_8)
                val buf = CharArray(8192)
                var text = ""
                while (thread === me) {
                    val n = reader.read(buf)
                    if (n < 0) break
                    text += String(buf, 0, n)
                    val (events, rest) = Sse.parse(text)
                    text = rest
                    for (e in events) Sse.changed(e)?.let(onChange)
                }
                throw java.io.IOException("closed")
            } catch (e: InterruptedException) {
                return
            } catch (e: Exception) {
                if (thread !== me) return
                setLive(false)
                try {
                    Thread.sleep(Sse.backoff(attempt++))
                } catch (i: InterruptedException) {
                    return
                }
            } finally {
                conn?.disconnect()
            }
        }
    }
}
