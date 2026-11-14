package io.github.juanbonastre.boni

import org.json.JSONArray
import org.json.JSONObject

/**
 * What was typed and has not reached the server yet (`unsent.json`, D-65, D-68, D-70), kept by the app as the desktop's
 * main process keeps it (apps/boni-desktop/unsent.cjs: the same file, the same rules): the page writes the list as it
 * hides (`boniAndroid.keepUnsent`), every answer the app sees takes out the fields its request carried, even with the
 * page gone, and the queue worker sends what is left with the app closed (task 109): the pages made here first, then
 * what was typed, field by field. Pure, so it is unit-tested; the shell and the worker do the I/O.
 */
object UnsentLogic {
    /** The paths whose writes the page keeps until they are answered: a page and a row (PUT). */
    private val KEPT = Regex("^api/(pages|data/rows)/[^/?]+$")

    fun kept(method: String, path: String) = method == "PUT" && KEPT.matches(path)

    /** The id a create of a page made here carries (task 109), or null. */
    fun madeHere(method: String, path: String, body: JSONObject?): String? =
        if (method == "POST" && path == "api/pages") body?.opt("id") as? String else null

    /** A request's body, read only when it may be a kept write or a page made here (a note's text can be long). */
    fun bodyOf(method: String, path: String, text: String?): JSONObject? {
        if (text == null || !(kept(method, path) || (method == "POST" && path == "api/pages"))) return null
        return try {
            JSONObject(text)
        } catch (e: Exception) {
            null
        }
    }

    /** The page's id in a create's answer, or null. */
    fun pageIdOf(text: String): String? = try {
        JSONObject(text).optJSONObject("page")?.opt("id") as? String
    } catch (e: Exception) {
        null
    }

    /** The list as the page wrote it; anything else is no list. */
    fun parse(text: String?): List<JSONObject> {
        if (text.isNullOrEmpty()) return emptyList()
        val a = try {
            JSONArray(text)
        } catch (e: Exception) {
            return emptyList()
        }
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.filter { it.opt("path") is String }
    }

    fun text(list: List<JSONObject>): String = JSONArray().also { a -> list.forEach { a.put(it) } }.toString()

    /** The fields a kept write holds, by name: a page's `patch.<key>`, a row's `values.<key>` and its `body`. */
    fun fieldsOf(w: JSONObject): List<String> {
        val out = mutableListOf<String>()
        w.optJSONObject("patch")?.keys()?.forEach { out.add("patch.$it") }
        w.optJSONObject("values")?.keys()?.forEach { out.add("values.$it") }
        if (w.has("body")) out.add("body")
        return out
    }

    /** The fields a PUT to `path` with `body` carries, named as `fieldsOf` names them (none for a body it cannot read). */
    fun carriedBy(path: String, body: JSONObject?): List<String> {
        if (body == null) return emptyList()
        if (path.startsWith("api/pages/")) return body.keys().asSequence().map { "patch.$it" }.toList()
        val out = mutableListOf<String>()
        body.optJSONObject("values")?.keys()?.forEach { out.add("values.$it") }
        if (body.has("body")) out.add("body")
        return out
    }

    /** `w` without the fields `gone`; null when nothing of it is left. */
    fun without(w: JSONObject, gone: List<String>): JSONObject? {
        if (gone.isEmpty()) return w
        val out = JSONObject(w.toString())
        for (f in gone) {
            if (f == "body") {
                out.remove("body")
                continue
            }
            val dot = f.indexOf('.')
            out.optJSONObject(f.substring(0, dot))?.remove(f.substring(dot + 1))
        }
        return if (fieldsOf(out).isEmpty()) null else out
    }

    /** `later` over `earlier`, one level down: a page's patch, a row's values (its body is the later one's if it has one). */
    fun joined(earlier: JSONObject, later: JSONObject): JSONObject {
        val out = JSONObject(earlier.toString())
        for (k in later.keys()) out.put(k, later.get(k))
        for (k in listOf("patch", "values")) {
            val a = earlier.optJSONObject(k) ?: continue
            val b = later.optJSONObject(k) ?: continue
            val m = JSONObject(a.toString())
            for (x in b.keys()) m.put(x, b.get(x))
            out.put(k, m)
        }
        return out
    }

    /** The order the page sends them in (store.ts `sendUnsent`): the pages made here first, each in its turn. */
    fun order(list: List<JSONObject>): List<JSONObject> =
        list.filter { it.optString("kind") == "new-page" } + list.filter { it.optString("kind") != "new-page" }

    /** One request of the list's. */
    data class Request(val method: String, val path: String, val body: JSONObject)

    /**
     * What the page sends for a kept write (store.ts `sendNewPage` and `sendWrite`): a page made here is created with
     * its id; a page's write is its patch; a row's, its values and its text. Null for anything else.
     */
    fun requestOf(w: JSONObject): Request? {
        val id = w.opt("id") as? String ?: return null
        val path = w.optString("path")
        return when (w.optString("kind")) {
            "new-page" -> {
                val parent = w.opt("parent")
                if (parent != JSONObject.NULL && parent !is String) return null
                Request("POST", "api/pages", JSONObject().put("id", id).put("title", "").put("parent", parent))
            }
            "page" -> w.optJSONObject("patch")?.takeIf { kept("PUT", path) && path.startsWith("api/pages/") }
                ?.let { Request("PUT", path, it) }
            "row" -> w.optJSONObject("values")?.takeIf { kept("PUT", path) && path.startsWith("api/data/rows/") }
                ?.let { v -> Request("PUT", path, JSONObject().put("values", v).also { if (w.has("body")) it.put("body", w.get("body")) }) }
            else -> null
        }
    }

    /** A request leaving, to give back with its answer: a create of a page made here, or a kept write's fields. */
    class Ticket(val path: String?, val made: String?, val at: Long, val fields: List<String>)

    /**
     * The answers this process saw (unsent.cjs `createUnsent`): each path's, field by field, the moment the last
     * request carrying that field left (what was written of it before then is on the server); and the pages made here
     * whose create was answered, each one's id on the server (itself, or a server's own before task 109).
     */
    class Book(private val now: () -> Long = System::currentTimeMillis) {
        private val answers = HashMap<String, HashMap<String, Long>>()
        private val made = HashMap<String, String>()

        /** A request is leaving: a ticket, or null if it is not a kept write. */
        @Synchronized
        fun sending(method: String, path: String, body: JSONObject?): Ticket? {
            madeHere(method, path, body)?.let { return Ticket(null, it, now(), emptyList()) }
            if (!kept(method, path)) return null
            return Ticket(path, null, now(), carriedBy(path, body))
        }

        /**
         * Its answer: `reached` when the server took it, `text` what it answered. Only an answer with the page makes a
         * page made here. True when the list may have lost something.
         */
        @Synchronized
        fun answered(ticket: Ticket?, reached: Boolean, text: String): Boolean {
            if (ticket == null || !reached) return false
            ticket.made?.let { local ->
                made[local] = pageIdOf(text) ?: return false
                return true
            }
            val path = ticket.path ?: return false
            if (ticket.fields.isEmpty()) return false
            val got = answers.getOrPut(path) { HashMap() }
            for (f in ticket.fields) got[f] = maxOf(got[f] ?: 0L, ticket.at)
            return true
        }

        /** Whether the server has made page `id`, made here. */
        @Synchronized
        fun isMade(id: String) = made.containsKey(id)

        /** What of `list` the server has not answered yet; the same objects where nothing changed. */
        @Synchronized
        fun left(list: List<JSONObject>): List<JSONObject> = madeOut(list).mapNotNull { rest(it) }

        /** What of `w` the server has not answered yet: null when all of it has. */
        private fun rest(w: JSONObject): JSONObject? {
            val got = answers[w.optString("path")] ?: return w
            val at = w.optLong("at")
            return without(w, fieldsOf(w).filter { f -> got[f]?.let { it >= at } == true })
        }

        /** `list` with each answered create out and what was typed in its page under the id the server gave it. */
        private fun madeOut(list: List<JSONObject>): List<JSONObject> {
            if (made.isEmpty()) return list
            val out = mutableListOf<JSONObject>()
            for (w in list) {
                val kind = w.optString("kind")
                val id = w.optString("id")
                if (kind == "new-page" && made.containsKey(id)) continue
                val to = if (kind == "page") made[id] else null
                val moved = if (to != null && to != id) JSONObject(w.toString()).put("id", to).put("path", "api/pages/$to") else w
                val i = out.indexOfFirst { it.optString("path") == moved.optString("path") }
                if (i < 0) {
                    out.add(moved)
                } else {
                    out[i] = if (moved.optLong("at") >= out[i].optLong("at")) joined(out[i], moved) else joined(moved, out[i])
                }
            }
            return out
        }
    }

    /** Whether `next` is `list` itself, object by object (nothing was answered). */
    fun same(list: List<JSONObject>, next: List<JSONObject>) =
        list.size == next.size && list.indices.all { list[it] === next[it] }

    /** The job a write of the page's asks for: none, one in place of the job there, or one behind it. */
    enum class Ask { NONE, IN_PLACE, BEHIND }

    /**
     * The job a write the worker sends asks for (the kept list, the queue), when it is `due` (task 109). In front, in
     * place of the job there (the page sends while it is in front, so that job only waits). Hidden, always behind it,
     * never in its place: the system may end the app at any moment, and taking a job out before scheduling the new
     * one left, on a phone, nothing to send what was kept. The job `onStop` leaves, before it returns, sends it.
     */
    fun ask(foreground: Boolean, due: Boolean): Ask = when {
        !due -> Ask.NONE
        foreground -> Ask.IN_PLACE
        else -> Ask.BEHIND
    }

    /**
     * How long the job made as the app hides waits before it reads what was kept (task 121): until `notBefore`, what the
     * page keeps just after `onStop` being in it by then, and never more than `max` (a clock moved does not hold it).
     */
    fun waitFor(notBefore: Long, now: Long, max: Long): Long = (notBefore - now).coerceIn(0L, max)

    /** The waits between one run's tries when something was left (no server reached, a server failing): task 121. */
    val AGAIN_MS = listOf(3_000L, 6_000L, 12_000L)

    /**
     * The wait before try `attempt + 1` of the same run, or null to leave it to WorkManager's backoff: after the
     * last of `AGAIN_MS`, or when the run must stop (the app back in front, the system's stop, the session gone).
     */
    fun againIn(attempt: Int, stopped: Boolean): Long? = if (stopped) null else AGAIN_MS.getOrNull(attempt)

    /** What one resend of the list did: how many requests were answered, and whether to try again later. */
    data class Flushed(val answered: Int, val retry: Boolean)

    /**
     * The worker's resend of the kept list with the app closed (task 109), in the page's order: the pages made here
     * first, created with their ids; what was typed in a page goes only once the server has it. `send` gives the
     * server's answer, or null without a connection; `stop` says the page is back (it sends from then on); `answered`
     * runs after each answer, for the caller to write the list again (`book.left`).
     *
     * Only an answer takes something out, as on the desktop: a page made here only with the page in it; a write, once
     * the server answered it (a refusal too, as the page does: sent again it would be refused again). No connection
     * or a session gone (401) stops it all; a failing server (5xx), a timeout (408) or too many requests (429) keep that
     * one, and the others go on (D-68). A page the server refuses is left for the page, which says so.
     */
    fun flush(
        list: List<JSONObject>,
        book: Book,
        stop: () -> Boolean,
        send: (Request) -> HttpAnswer?,
        answered: () -> Unit = {},
    ): Flushed {
        var count = 0
        var retry = false
        /** Pages made here that the server has not made in this run: what was typed in them waits. */
        val waiting = mutableSetOf<String>()
        for (entry in order(list)) {
            if (stop()) return Flushed(count, true)
            // The page's own request may have been answered meanwhile (it was in flight as the app hid).
            val w = book.left(listOf(entry)).firstOrNull() ?: continue
            val kind = w.optString("kind")
            val id = w.optString("id")
            if (kind == "page" && id in waiting) continue
            val r = requestOf(w) ?: continue
            val ticket = book.sending(r.method, r.path, r.body)
            val answer = send(r)
            val status = answer?.status ?: 0
            if (answer == null || status == 401) {
                book.answered(ticket, false, "")
                return Flushed(count, true)
            }
            if (status >= 500 || status == 408 || status == 429) {
                book.answered(ticket, false, "")
                if (kind == "new-page") waiting.add(id)
                retry = true
                continue
            }
            val ok = if (kind == "new-page") status in 200..299 && book.answered(ticket, true, answer.body)
            else book.answered(ticket, true, answer.body)
            if (kind == "new-page" && !ok) waiting.add(id) // refused: the page sees why when it opens
            count++
            answered()
        }
        return Flushed(count, retry)
    }
}
