package io.github.juanbonastre.bonicalendar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultPathsTest {
    private fun code(path: String, markdown: Boolean = true) =
        assertThrows(VaultError::class.java) { VaultPaths.check(path, markdown) }.code

    @Test
    fun notesAndFoldersOfTheVault() {
        assertEquals("agenda/docencia/2026-10-17 Clase.md", VaultPaths.check("agenda/docencia/2026-10-17 Clase.md"))
        assertEquals("agenda/docencia", VaultPaths.check("agenda/docencia/", markdown = false))
        assertEquals("agenda", VaultPaths.parent("agenda/x.md"))
        assertEquals("x.md", VaultPaths.name("agenda/x.md"))
        assertEquals("", VaultPaths.parent("x.md"))
    }

    @Test
    fun neverTheReservedZonesDotFoldersOrOutsideTheVault() {
        assertEquals("denied", code("private/diario.md"))
        assertEquals("denied", code("restricted/x.md"))
        assertEquals("denied", code("private", markdown = false))
        assertEquals("bad-path", code("../fuera.md"))
        assertEquals("bad-path", code("agenda/../../x.md"))
        assertEquals("bad-path", code(".obsidian/app.md"))
        assertEquals("bad-path", code("agenda/.borrador/x.md"))
        assertEquals("bad-path", code("/abs/x.md"))
        assertEquals("bad-path", code(""))
    }

    @Test
    fun onlyMarkdownNotes() {
        assertEquals("bad-path", code("agenda/foto.png"))
    }
}
