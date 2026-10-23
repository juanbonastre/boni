package io.github.juanbonastre.boni

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The same cases as the desktop shell's live.test.cjs. */
class SseTest {
    @Test
    fun splitsCompleteEventsAndKeepsTheRest() {
        val (events, rest) = Sse.parse(
            ": connected\n\nevent: changed\ndata: {\"what\":\"charts\"}\n\nevent: changed\r\ndata: {\"what\":\"da",
        )
        assertEquals(listOf(SseEvent("changed", "{\"what\":\"charts\"}")), events)
        assertEquals("event: changed\r\ndata: {\"what\":\"da", rest)
        val (more, _) = Sse.parse(rest + "ta\"}\r\n\r\n")
        assertEquals("data", Sse.changed(more.single()))
    }

    @Test
    fun onlyChangedEventsCount() {
        assertNull(Sse.changed(SseEvent("message", "{\"what\":\"x\"}")))
        assertNull(Sse.changed(SseEvent("changed", "not json")))
        assertEquals("shortcuts", Sse.changed(SseEvent("changed", "{\"what\":\"shortcuts\",\"at\":\"2026-10-18T10:00:00Z\"}")))
    }

    @Test
    fun backoffGrowsToAMinute() {
        assertEquals(listOf(2000L, 4000L, 8000L, 16000L, 32000L, 60000L, 60000L), (0..6).map { Sse.backoff(it) })
    }
}
