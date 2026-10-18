package io.github.juanbonastre.boni

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The same cases as the page's queue tests (apps/web/src/core/logic.test.ts, "offline queue"). */
class QueueLogicTest {
    private fun item(id: String, holdUntil: Long? = null, error: String? = null) = JSONObject()
        .put("request", JSONObject().put("action", "expenses.capture").put("client_id", id)
            .put("values", JSONObject().put("amount", 5)))
        .also { o -> holdUntil?.let { o.put("hold_until", it) }; error?.let { o.put("error", it) } }

    private fun ids(a: JSONArray) = (0 until a.length()).map { a.getJSONObject(it).getJSONObject("request").getString("client_id") }

    @Test
    fun keepsOrderStopsWhenOfflineAndKeepsTheRejected() {
        val items = JSONArray().put(item("a")).put(item("b")).put(item("c")).put(item("d"))
        val sent = mutableListOf<String>()
        val (left, delivered) = QueueLogic.flush(items, 0) { r ->
            val id = r.getString("client_id")
            sent.add(id)
            when (id) {
                "b" -> QueueLogic.outcome(200, """{"status":"invalid","message":"Revisa","field_errors":{"category":"Elige una categoría"}}""")
                "c" -> QueueLogic.Outcome.Retry
                else -> QueueLogic.outcome(200, """{"status":"ok"}""")
            }
        }
        assertEquals(1, delivered)
        assertEquals(listOf("a", "b", "c"), sent) // d not tried once offline
        assertEquals(listOf("b", "c", "d"), ids(left))
        assertEquals("Revisa; category: Elige una categoría", left.getJSONObject(0).getString("error"))
        assertEquals(2, QueueLogic.pendingCount(left, 0))
        // back online: c and d go; the rejected one stays
        val (after, n) = QueueLogic.flush(left, 0) { QueueLogic.outcome(200, """{"status":"queued"}""") }
        assertEquals(2, n)
        assertEquals(listOf("b"), ids(after))
    }

    @Test
    fun serverErrorsAndABadSessionAreRetriedA404IsARejection() {
        assertEquals(QueueLogic.Outcome.Retry, QueueLogic.outcome(503, """{"error":{"code":"source_unavailable","message":"down"}}"""))
        assertEquals(QueueLogic.Outcome.Retry, QueueLogic.outcome(401, """{"error":{"code":"unauthorized","message":"x"}}"""))
        assertEquals(QueueLogic.Outcome.Rejected("no"), QueueLogic.outcome(404, """{"error":{"code":"not_found","message":"no"}}"""))
        assertEquals(QueueLogic.Outcome.Rejected("Accion desconocida"), QueueLogic.outcome(200, """{"status":"error","message":"Accion desconocida"}"""))
    }

    @Test
    fun aHeldCaptureWaitsForItsTime() {
        val items = JSONArray().put(item("held", holdUntil = 10_000)).put(item("now"))
        val sent = mutableListOf<String>()
        val (left, n) = QueueLogic.flush(items, 5_000) { sent.add(it.getString("client_id")); QueueLogic.Outcome.Delivered }
        assertEquals(1, n)
        assertEquals(listOf("now"), sent)
        assertEquals(0, QueueLogic.pendingCount(left, 5_000))
        assertEquals(10_000L, QueueLogic.nextHold(left, 5_000))
        val (empty, m) = QueueLogic.flush(left, 10_001) { QueueLogic.Outcome.Delivered }
        assertEquals(1, m)
        assertEquals(0, empty.length())
        assertNull(QueueLogic.nextHold(empty, 10_001))
    }

    @Test
    fun readsThePagesFileAsItIs() {
        // what queue.ts writes, including a rejected item with a null-free error
        val file = """[{"request":{"action":"expenses.capture","client_id":"k1","values":{"amount":3.2},"created_at":"2026-10-12T10:00:00+02:00"}},{"request":{"action":"a","client_id":"k2","values":{}},"error":"no"}]"""
        val items = JSONArray(file)
        assertEquals(1, QueueLogic.pendingCount(items, System.currentTimeMillis()))
    }
}
