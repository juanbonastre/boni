package io.github.juanbonastre.boni.desktop

import java.io.File
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * A small log file (`~/.local/share/boni/boni.log`, last ~200 KB) to understand what happened on this computer:
 * which widgets were opened, whether the desktop layer worked, errors. Never logs the token.
 */
object Log {
    private val file: File get() = File(Paths.data, "boni.log")
    private val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

    @Synchronized
    private fun write(level: String, msg: String) {
        runCatching {
            file.parentFile.mkdirs()
            if (file.length() > 200_000) file.writeText(file.readLines().takeLast(500).joinToString("\n") + "\n")
            file.appendText("${LocalDateTime.now().format(fmt)} $level $msg\n")
        }
        if (level != "INFO") System.err.println("boni: $msg")
    }

    fun info(msg: String) = write("INFO", msg)
    fun warn(msg: String) = write("WARN", msg)
}
