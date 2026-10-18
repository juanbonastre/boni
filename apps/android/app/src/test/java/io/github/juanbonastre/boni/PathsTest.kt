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
    }

    @Test
    fun storeNames() {
        assertTrue(Paths.storeName("queue.json"))
        assertFalse(Paths.storeName("../queue.json"))
        assertFalse(Paths.storeName(".hidden.json"))
        assertFalse(Paths.storeName("notes.txt"))
    }
}
