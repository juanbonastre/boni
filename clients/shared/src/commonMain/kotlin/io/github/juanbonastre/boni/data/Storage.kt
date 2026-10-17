package io.github.juanbonastre.boni.data

/** Small named text files (JSON) on the device: queue, chart cache, window positions. Platform-specific. */
interface TextStore {
    fun read(name: String): String?
    fun write(name: String, text: String)
    fun delete(name: String)
}

class MemoryTextStore : TextStore {
    private val files = mutableMapOf<String, String>()
    override fun read(name: String): String? = files[name]
    override fun write(name: String, text: String) { files[name] = text }
    override fun delete(name: String) { files.remove(name) }
}

/** Device clock, injectable for tests. */
interface Clock {
    /** Local date, ISO (2026-10-12). */
    fun today(): String

    /** Local date-time with offset, ISO 8601 (2026-10-12T18:30:00+02:00). */
    fun nowIso(): String

    fun newId(): String
}

expect fun systemClock(): Clock
