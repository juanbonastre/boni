package io.github.juanbonastre.boni

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LinksTest {
    @Test
    fun aNoteLinkOpensTheRecordByItsId() {
        assertEquals("note:e_01m5m5fkq7w3mhh4ywc6aa22zz", Links.target("boni://note?id=e_01m5m5fkq7w3mhh4ywc6aa22zz"))
        assertEquals("note:e_1", Links.target("boni://note?peek=1&id=e_1"))
    }

    @Test
    fun nothingElseBecomesAScreen() {
        for (bad in listOf(
            null,
            "boni://note",
            "boni://note?id=",
            "boni://note?id=a%2Fb",
            "boni://note?id=../x",
            "boni://note?path=agenda%2Fclase.md",
            "boni://settings?id=e_1",
            "https://example.com/?id=e_1",
            "boni://note?id=" + "a".repeat(101),
            "no es un enlace",
        )) assertNull(bad, Links.target(bad))
    }
}
