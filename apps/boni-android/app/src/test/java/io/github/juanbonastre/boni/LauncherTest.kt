package io.github.juanbonastre.boni

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LauncherTest {
    @Test
    fun onlyShortcutsAndChartsCanBeTargets() {
        assertTrue(Launcher.valid("shortcut:cafe-2"))
        assertTrue(Launcher.valid("chart:monthly-spending"))
        assertFalse(Launcher.valid("settings"))
        assertFalse(Launcher.valid("chart:../x"))
        assertFalse(Launcher.valid("shortcut:"))
    }

    @Test
    fun idsRoundTrip() {
        assertEquals("boni:chart:eating-out", Launcher.idOf("chart:eating-out"))
        assertEquals("chart:eating-out", Launcher.targetOf("boni:chart:eating-out"))
        assertNull(Launcher.targetOf("other:chart:eating-out"))
    }

    @Test
    fun theIconsLetter() {
        assertEquals("C", Launcher.initial("café"))
        assertEquals("1", Launcher.initial("  1,60 € café"))
        assertEquals("B", Launcher.initial("·"))
    }
}
