package io.github.juanbonastre.boni

import java.net.URI

/**
 * Links into Boni from other apps on the phone: Boni Calendar's «Abrir en Boni» sends `boni://note?id=<id>` (a
 * record by its id, the same link Boni's desktop app takes). Only that shape becomes something the page opens.
 */
object Links {
    private val ID = Regex("^[A-Za-z0-9_-]{1,100}$")

    /** The screen a link opens (`note:<id>`), or null for anything else. */
    fun target(link: String?): String? {
        if (link == null || link.length > 300) return null
        val uri = try {
            URI(link)
        } catch (e: Exception) {
            return null
        }
        if (uri.scheme != "boni" || uri.host != "note") return null
        val id = (uri.rawQuery ?: "")
            .split("&")
            .firstOrNull { it.startsWith("id=") }
            ?.removePrefix("id=")
            ?: return null
        return if (ID.matches(id)) "note:$id" else null
    }
}
