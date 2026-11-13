package io.github.juanbonastre.boni

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PathsTest {
    @Test
    fun serverAddresses() {
        assertEquals("https://boni.example.ts.net", Paths.serverUrl(" https://boni.example.ts.net/ "))
        assertEquals("http://localhost:8765", Paths.serverUrl("http://localhost:8765"))
        assertNull(Paths.serverUrl("ftp://boni.example.ts.net"))
        assertNull(Paths.serverUrl("https://user:pw@boni.example.ts.net"))
        assertNull(Paths.serverUrl("boni.example.ts.net"))
        assertNull(Paths.serverUrl(""))
    }

    @Test
    fun onlyTheApiAndOnlyItsMethods() {
        assertTrue(Paths.apiRequest("GET", "api/v1/charts/spending-by-category/data?drill=comida"))
        assertTrue(Paths.apiRequest("PUT", "api/v1/shortcuts/order"))
        assertFalse(Paths.apiRequest("PATCH", "api/v1/charts"))
        assertFalse(Paths.apiRequest("GET", "api/v1/../healthz"))
        assertFalse(Paths.apiRequest("GET", "admin"))
        // What the page uses besides v1 (as the desktop app's paths.cjs): the agent, pages, data and mail.
        assertTrue(Paths.apiRequest("GET", "api/agent/proposals"))
        assertTrue(Paths.apiRequest("POST", "api/agent/proposals/0b6f1c2e-5d4a/accept"))
        assertTrue(Paths.apiRequest("GET", "api/pages"))
        assertTrue(Paths.apiRequest("GET", "api/data/types/t_docencia/rows"))
        assertTrue(Paths.apiRequest("GET", "api/mail"))
        // A file dropped on Boni's window (A-24, desktop and browser for now), its name escaped strictly.
        assertTrue(Paths.apiRequest("POST", "api/data/files/upload?name=Factura%20FAC-2026-0142%20%28taller%29.pdf"))
        assertFalse(Paths.apiRequest("POST", "api/data/files/upload?name=Factura (taller).pdf"))
        // The records a mention `[[Título]]` names (task 110), its title escaped strictly.
        assertTrue(Paths.apiRequest("GET", "api/data/titled?title=Reuni%C3%B3n%20%28martes%29"))
        assertFalse(Paths.apiRequest("GET", "api/data/titled?title=Reunión (martes)"))
        assertFalse(Paths.apiRequest("GET", "api/agent/../../healthz"))
        assertFalse(Paths.apiRequest("GET", "api/export"))
        assertFalse(Paths.apiRequest("POST", "api/apply"))
        assertFalse(Paths.apiRequest("GET", "api/mcp"))
    }

    @Test
    fun storeNames() {
        assertTrue(Paths.storeName("queue.json"))
        assertFalse(Paths.storeName("../queue.json"))
        assertFalse(Paths.storeName(".hidden.json"))
        assertFalse(Paths.storeName("notes.txt"))
    }

    @Test
    fun aTurnOfTheConversationMayTakeMinutes() {
        for (p in listOf("api/agent/turn", "api/agent/answer", "api/agent/confirm", "api/agent/decline"))
            assertEquals(p, 180_000, Paths.timeoutMs(p))
        for (p in listOf("api/agent/proposals", "api/agent/turnx", "api/v1/charts", "api/agent/turn/x"))
            assertEquals(p, 30_000, Paths.timeoutMs(p))
    }
}
