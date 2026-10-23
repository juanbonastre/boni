package io.github.juanbonastre.boni

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** Pure rules about addresses and paths (unit-tested): the same as the desktop shell's (paths.cjs, settings.cjs). */
object Paths {
    // v1 (charts, capture), the agent's conversation and inbox, the pages, the collections as databases and the
    // mailbox: what the page uses (apps/boni-desktop/paths.cjs). Nothing else on the server.
    private val API_PATH =
        Regex("^api/(v1|agent|pages|pages-trash|data|mail)(/[A-Za-z0-9_\\-./%]*)?(\\?[A-Za-z0-9_\\-.=&%+]*)?$")
    private val STORE_NAME = Regex("^[A-Za-z0-9._-]+\\.json$")
    val METHODS = setOf("GET", "POST", "PUT", "DELETE")

    /** A server address the app may talk to: http(s), a host, no credentials, no trailing slash. Null otherwise. */
    fun serverUrl(raw: String?): String? {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty()) return null
        return try {
            val u = URI(text)
            val scheme = u.scheme?.lowercase()
            if ((scheme != "https" && scheme != "http") || u.host.isNullOrEmpty() || u.userInfo != null) null
            else text.trimEnd('/')
        } catch (e: Exception) {
            null
        }
    }

    /** A request the page may make: one of the API's methods on one of those paths, never outside them. */
    fun apiRequest(method: String, path: String): Boolean =
        method in METHODS && API_PATH.matches(path) && !path.contains("..")

    /** A file name of the page's small store (queue.json, charts.json...). */
    fun storeName(name: String): Boolean = STORE_NAME.matches(name) && !name.startsWith(".")
}

class HttpAnswer(val status: Int, val body: String)

/** Plain HTTP for the server. An exception means the server could not be reached (offline). */
object Http {
    private const val MAX_BODY = 10 * 1024 * 1024

    @Throws(IOException::class)
    fun send(
        method: String,
        url: String,
        token: String?,
        body: String?,
        timeoutMs: Int = 30_000,
        accept: String = "application/json",
    ): HttpAnswer {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = timeoutMs
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept", accept)
            conn.setRequestProperty("X-Boni-Client", "boni-android")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val out = ByteArrayOutputStream()
            stream?.use { input ->
                val buf = ByteArray(32 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (out.size() + n > MAX_BODY) return HttpAnswer(status, "")
                    out.write(buf, 0, n)
                }
            }
            return HttpAnswer(status, out.toString("UTF-8"))
        } finally {
            conn.disconnect()
        }
    }
}
