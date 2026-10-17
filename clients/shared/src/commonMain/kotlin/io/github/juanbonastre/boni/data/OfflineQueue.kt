package io.github.juanbonastre.boni.data

import io.github.juanbonastre.boni.api.ActionRequest
import io.github.juanbonastre.boni.api.ActionResult
import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.BoniJson
import io.github.juanbonastre.boni.api.OfflineException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/** A capture the user saved that the server has not accepted yet, or that it rejected later (kept to show it). */
@Serializable
data class QueuedAction(val request: ActionRequest, val error: String? = null)

/**
 * Captures that could not reach the server. Every request keeps its `client_id`, so sending it twice never duplicates
 * an expense (the server is idempotent). Order is kept.
 */
class OfflineQueue(private val store: TextStore, private val fileName: String = "queue.json") {
    private val mutex = Mutex()
    private val serializer = ListSerializer(QueuedAction.serializer())

    fun items(): List<QueuedAction> =
        store.read(fileName)?.let { runCatching { BoniJson.decodeFromString(serializer, it) }.getOrNull() } ?: emptyList()

    val pending: Int get() = items().count { it.error == null }

    private fun save(items: List<QueuedAction>) {
        if (items.isEmpty()) store.delete(fileName) else store.write(fileName, BoniJson.encodeToString(serializer, items))
    }

    suspend fun add(request: ActionRequest) = mutex.withLock { save(items() + QueuedAction(request)) }

    suspend fun dismiss(clientId: String) = mutex.withLock { save(items().filterNot { it.request.clientId == clientId }) }

    /**
     * Send pending items in order through [send]. Stops at the first one that can't reach the server.
     * Accepted (`ok`, or `queued` = the server has it in its own outbox) -> removed. Rejected (`invalid`, `error`) ->
     * kept with its message so the user can see what failed. Returns how many were delivered.
     */
    suspend fun flush(send: suspend (ActionRequest) -> ActionResult): Int = mutex.withLock {
        var delivered = 0
        val remaining = mutableListOf<QueuedAction>()
        var offline = false
        for (item in items()) {
            if (offline || item.error != null) {
                remaining += item
                continue
            }
            try {
                val r = send(item.request)
                if (r.status == "ok" || r.status == "queued") {
                    delivered++
                } else {
                    val detail = (listOfNotNull(r.message) + r.fieldErrors.map { "${it.key}: ${it.value}" }).joinToString("; ")
                    remaining += item.copy(error = detail.ifBlank { r.status })
                }
            } catch (e: OfflineException) {
                offline = true
                remaining += item
            } catch (e: ApiException) {
                if (e.status == 401 || e.status >= 500) {
                    offline = true // try again later
                    remaining += item
                } else {
                    remaining += item.copy(error = e.message)
                }
            }
        }
        save(remaining)
        delivered
    }
}
