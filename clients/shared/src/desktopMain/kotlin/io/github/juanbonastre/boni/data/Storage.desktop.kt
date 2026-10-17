package io.github.juanbonastre.boni.data

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID

actual fun systemClock(): Clock = object : Clock {
    override fun today(): String = LocalDate.now().toString()
    override fun nowIso(): String =
        OffsetDateTime.now().truncatedTo(ChronoUnit.SECONDS).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    override fun newId(): String = UUID.randomUUID().toString()
}

/** Files in one folder, written atomically (temp file + rename) so a crash never leaves half a queue. */
class FileTextStore(private val dir: File) : TextStore {
    init {
        dir.mkdirs()
    }

    private fun file(name: String) = File(dir, name)

    override fun read(name: String): String? = file(name).takeIf { it.isFile }?.readText()

    override fun write(name: String, text: String) {
        val tmp = File(dir, ".$name.tmp")
        tmp.writeText(text)
        Files.move(tmp.toPath(), file(name).toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    override fun delete(name: String) {
        file(name).delete()
    }
}
