package io.github.juanbonastre.boni.desktop

import io.github.juanbonastre.boni.api.BoniJson
import io.github.juanbonastre.boni.api.ServerConfig
import kotlinx.serialization.Serializable
import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions

/** Where Boni keeps its files on this computer (XDG on Linux, the usual folders on macOS and Windows). */
object Paths {
    private val os = System.getProperty("os.name").lowercase()
    val home = File(System.getProperty("user.home"))
    val isLinux = os.contains("linux")
    val isMac = os.contains("mac")
    val isWindows = os.contains("win")

    private fun xdg(env: String, fallback: String) = File(System.getenv(env)?.takeIf { it.isNotBlank() } ?: File(home, fallback).path)

    val config: File = when {
        isMac -> File(home, "Library/Application Support/Boni")
        isWindows -> File(System.getenv("APPDATA") ?: home.path, "Boni")
        else -> File(xdg("XDG_CONFIG_HOME", ".config"), "boni")
    }
    val data: File = when {
        isMac || isWindows -> File(config, "data")
        else -> File(xdg("XDG_DATA_HOME", ".local/share"), "boni")
    }
    val autostartDir: File = File(xdg("XDG_CONFIG_HOME", ".config"), "autostart")
    val cache: File = when {
        isMac || isWindows -> File(config, "cache")
        else -> File(xdg("XDG_CACHE_HOME", ".cache"), "boni")
    }

}

/** Where a window widget is and how big; [size] is the server size it was made for (a new size resets width/height). */
@Serializable
data class WidgetPlacement(val x: Int, val y: Int, val width: Int = 360, val height: Int = 250, val size: String? = null)

@Serializable
data class DesktopSettings(
    val serverUrl: String = "",
    val token: String = "",
    val showWidgets: Boolean = true,
    /** "system", "light" or "dark". */
    val theme: String = "system",
    val widgets: Map<String, WidgetPlacement> = emptyMap(),
    val hiddenWidgets: Set<String> = emptySet(),
    /** How widgets are shown: "windows" (Boni's own small windows) or "desklets" (Cinnamon desklets); "" = automatic. */
    val widgetMode: String = "",
    /** Start at login is switched on once, the first time the installed app runs (the user can switch it off). */
    val autostartOffered: Boolean = false,
) {
    /** Cinnamon has desklets, which behave better on its desktop than plain windows. */
    fun effectiveWidgetMode(cinnamon: Boolean): String = widgetMode.ifEmpty { if (cinnamon) "desklets" else "windows" }

    val server: ServerConfig get() = ServerConfig(serverUrl.trim(), token.trim())
}

/** settings.json in the config folder. Holds the device token, so the file is readable by the user only. */
class SettingsStore(private val file: File = File(Paths.config, "settings.json")) {
    fun load(): DesktopSettings =
        file.takeIf { it.isFile }?.let { runCatching { BoniJson.decodeFromString(DesktopSettings.serializer(), it.readText()) }.getOrNull() }
            ?: DesktopSettings()

    fun save(settings: DesktopSettings) {
        file.parentFile.mkdirs()
        val tmp = File(file.parentFile, ".settings.json.tmp")
        tmp.writeText(BoniJson.encodeToString(DesktopSettings.serializer(), settings))
        if (!Paths.isWindows) runCatching { Files.setPosixFilePermissions(tmp.toPath(), PosixFilePermissions.fromString("rw-------")) }
        Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    }
}
