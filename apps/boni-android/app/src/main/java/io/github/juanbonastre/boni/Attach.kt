package io.github.juanbonastre.boni

import android.content.ContentResolver
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Files attached to the conversation from the phone (task 114; docs/sistema.md §4.7, A-24): the phone's own picker
 * chooses them, the page gets a key, a name and a size for each (never the file or where it is), and the app sends
 * each one from where it is on the phone to `POST api/data/files/upload` with the token, as the desktop's
 * uploads.cjs sends a dropped one. Never whole in memory: a part of 64 KB at a time, and HttpURLConnection is told
 * the length first (without it, it keeps the whole body in memory before sending it). Nothing past 1 GB is sent.
 */
object Uploads {
    /** The most a file may weigh (the server's MAX_UPLOAD_BYTES, uploads.ts MAX_DROP_BYTES, uploads.cjs). */
    const val MAX_UPLOAD = 1_000_000_000L
    const val PART = 64 * 1024

    /** How long the server may say nothing while a file goes (it answers once all of it has arrived). */
    private const val IDLE_MS = 120_000
    private const val MAX_ANSWER = 64 * 1024

    /** A file's name as the upload's query: every byte but letters, digits and `-_.` escaped (uploads.ts `queryName`). */
    fun queryName(name: String): String {
        val out = StringBuilder()
        for (b in name.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xff
            val keep = c in 'A'.code..'Z'.code || c in 'a'.code..'z'.code || c in '0'.code..'9'.code ||
                c == '-'.code || c == '_'.code || c == '.'.code
            if (keep) out.append(c.toChar()) else out.append('%').append("%02X".format(c))
        }
        return out.toString()
    }

    /** The upload's path for a name, or null when the name is not one a file may have (as the server's `dropName`). */
    fun path(name: String): String? {
        val n = name.trim()
        if (n.isEmpty() || n.length > 200 || n.contains('/') || n.contains('\\') || n.contains('\u0000') ||
            n.startsWith(".")
        ) return null
        return "api/data/files/upload?name=${queryName(n)}"
    }

    /**
     * The name a chosen file goes up with: the one the phone shows, with the extension of its type when it has none
     * (the server tells a file's type by its name: a photo shown as «IMG_0042» goes up as «IMG_0042.jpg»).
     */
    fun named(shown: String?, extension: String?): String {
        val name = shown?.trim().orEmpty().ifEmpty { "archivo" }
        val ext = extension?.trim()?.lowercase().orEmpty()
        val has = name.substringAfterLast('.', "").let { it.isNotEmpty() && it.length <= 5 && it != name }
        return if (has || ext.isEmpty() || !Regex("^[a-z0-9]{1,8}$").matches(ext)) name else "$name.$ext"
    }

    /** Reading the phone's file failed (it went, or it was shorter than it said): not the network's fault. */
    class Unreadable(message: String) : IOException(message)

    /**
     * Copies exactly `size` bytes from `input` to `output`, a part at a time, each written before the next is read;
     * `progress(sent)` after each. More than `size` is never written; fewer is [Unreadable].
     */
    fun copy(input: InputStream, output: OutputStream, size: Long, progress: (Long) -> Unit) {
        val buf = ByteArray(PART)
        var sent = 0L
        while (sent < size) {
            val want = minOf(PART.toLong(), size - sent).toInt()
            val n = try {
                input.read(buf, 0, want)
            } catch (e: IOException) {
                throw Unreadable(e.message ?: "read")
            }
            if (n < 0) throw Unreadable("The file ended at $sent of $size bytes")
            output.write(buf, 0, n)
            sent += n
            progress(sent)
        }
    }

    /**
     * Sends `size` bytes of `input` to `url` with the token, streamed. The server's answer, or an exception: an
     * [Unreadable] for the file, any other IOException for the network.
     */
    @Throws(IOException::class)
    fun send(url: String, token: String, size: Long, input: InputStream, progress: (Long) -> Unit): HttpAnswer {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = IDLE_MS
            conn.instanceFollowRedirects = false
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(size)
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("X-Boni-Client", "boni-android")
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/octet-stream")
            conn.outputStream.use { out -> copy(input, out, size, progress) }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val out = ByteArrayOutputStream()
            stream?.use { s ->
                val buf = ByteArray(8 * 1024)
                while (out.size() < MAX_ANSWER) {
                    val n = s.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
            }
            return HttpAnswer(status, out.toString("UTF-8"))
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * The files chosen with the phone's picker and not yet sent, by the key the page knows them by. A key is sent once:
 * the page can only send what Juan chose, never name a file of the phone.
 */
class Chosen(private val resolver: ContentResolver) {
    private class Picked(val uri: Uri, val name: String, val size: Long)

    private val files = ConcurrentHashMap<String, Picked>()
    private val seq = AtomicInteger()

    /** What the picker gave, as the page sees it: `[{key, name, size}]`. */
    fun add(uris: List<Uri>): JSONArray {
        val out = JSONArray()
        for (uri in uris) {
            val picked = describe(uri) ?: continue
            val key = "f${seq.incrementAndGet()}"
            files[key] = picked
            out.put(JSONObject().put("key", key).put("name", picked.name).put("size", picked.size))
        }
        return out
    }

    /** The chosen file `key`, taken off the list, opened: its name, size and bytes; null when there is none. */
    fun take(key: String): Triple<String, Long, () -> InputStream>? {
        val p = files.remove(key) ?: return null
        val open: () -> InputStream = {
            resolver.openInputStream(p.uri) ?: throw Uploads.Unreadable("Nothing to read")
        }
        return Triple(p.name, p.size, open)
    }

    private fun describe(uri: Uri): Picked? {
        var shown: String? = null
        var size = -1L
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
                ?.use { c ->
                    if (c.moveToFirst()) {
                        val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val s = c.getColumnIndex(OpenableColumns.SIZE)
                        if (n >= 0 && !c.isNull(n)) shown = c.getString(n)
                        if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
                    }
                }
        } catch (e: Exception) {
            return null
        }
        if (size < 0) size = measure(uri) ?: return null
        val ext = resolver.getType(uri)?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
        return Picked(uri, Uploads.named(shown ?: uri.lastPathSegment, ext), size)
    }

    /** A file whose size the phone does not say: its descriptor's, or counted by reading it once (never kept). */
    private fun measure(uri: Uri): Long? = try {
        val fd = resolver.openAssetFileDescriptor(uri, "r")
        val known = fd?.use { it.length } ?: AssetFileDescriptor.UNKNOWN_LENGTH
        if (known >= 0) known
        else resolver.openInputStream(uri)?.use { s ->
            val buf = ByteArray(Uploads.PART)
            var n = 0L
            while (n <= Uploads.MAX_UPLOAD) {
                val r = s.read(buf)
                if (r < 0) break
                n += r
            }
            n
        }
    } catch (e: Exception) {
        null
    }
}
