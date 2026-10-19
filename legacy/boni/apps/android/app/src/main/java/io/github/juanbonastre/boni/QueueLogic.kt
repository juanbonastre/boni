package io.github.juanbonastre.boni

import org.json.JSONArray
import org.json.JSONObject

/**
 * The offline queue's rules, the same as the page's (`apps/web/src/core/queue.ts`), over the same file
 * (`queue.json`: `[{ request, error?, hold_until? }]`). Pure, so it is unit-tested; the worker does the I/O.
 */
object QueueLogic {
    /** What sending one request gave. */
    sealed class Outcome {
        /** The server took it (`ok`, or `queued` in its own outbox). */
        data object Delivered : Outcome()

        /** The server refused it (`invalid`, `error`, a 4xx): kept with its message so the user sees it. */
        data class Rejected(val message: String) : Outcome()

        /** No server (offline, a bad session, a 5xx): stop and try again later. */
        data object Retry : Outcome()
    }

    /** Waiting to be sent: not rejected, not held back for its Undo. */
    fun isPending(item: JSONObject, now: Long): Boolean =
        !hasError(item) && item.optLong("hold_until", 0L) <= now

    private fun hasError(item: JSONObject) = !item.isNull("error") && item.optString("error").isNotEmpty()

    /**
     * Sends pending items in order, stopping at the first that cannot reach the server. Delivered items go;
     * rejected ones stay with their message; held or already rejected ones stay as they are.
     * Returns the items left and how many were delivered.
     */
    fun flush(items: JSONArray, now: Long, send: (JSONObject) -> Outcome): Pair<JSONArray, Int> {
        val remaining = JSONArray()
        var delivered = 0
        var offline = false
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            if (offline || !isPending(item, now)) {
                remaining.put(item)
                continue
            }
            when (val r = send(item.getJSONObject("request"))) {
                Outcome.Delivered -> delivered++
                is Outcome.Rejected -> remaining.put(JSONObject(item.toString()).put("error", r.message))
                Outcome.Retry -> {
                    offline = true
                    remaining.put(item)
                }
            }
        }
        return remaining to delivered
    }

    fun pendingCount(items: JSONArray, now: Long): Int =
        (0 until items.length()).count { items.optJSONObject(it)?.let { o -> isPending(o, now) } == true }

    /** When the first held item may go (epoch ms), or null. */
    fun nextHold(items: JSONArray, now: Long): Long? =
        (0 until items.length())
            .mapNotNull { items.optJSONObject(it) }
            .filter { !hasError(it) && it.optLong("hold_until", 0L) > now }
            .minOfOrNull { it.getLong("hold_until") }

    /** The page's reading of an answer of POST /api/v1/actions (queue.ts `flush`). */
    fun outcome(status: Int, body: String): Outcome {
        if (status == 401 || status >= 500) return Outcome.Retry
        val json = try {
            JSONObject(body)
        } catch (e: Exception) {
            null
        }
        if (status >= 400) {
            val message = json?.optJSONObject("error")?.optString("message").orEmpty()
            return Outcome.Rejected(message.ifEmpty { body.take(200).ifEmpty { "HTTP $status" } })
        }
        val result = json?.optString("status").orEmpty()
        if (result == "ok" || result == "queued") return Outcome.Delivered
        val parts = mutableListOf<String>()
        json?.optString("message")?.takeIf { it.isNotEmpty() && !json.isNull("message") }?.let { parts.add(it) }
        json?.optJSONObject("field_errors")?.let { errors ->
            for (k in errors.keys()) parts.add("$k: ${errors.optString(k)}")
        }
        return Outcome.Rejected(parts.joinToString("; ").ifEmpty { result.ifEmpty { "error" } })
    }
}
