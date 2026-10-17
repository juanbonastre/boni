package io.github.juanbonastre.boni.desktop

import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Start at login. Linux: an XDG autostart entry (Cinnamon, GNOME, KDE...). macOS/Windows: not yet. */
object Autostart {
    private val entry = File(Paths.autostartDir, "boni.desktop")

    /** The installed launcher (set by jpackage); null when running from Gradle. */
    val launcher: String? get() = System.getProperty("jpackage.app-path")?.takeIf { File(it).canExecute() }

    val supported: Boolean get() = Paths.isLinux && launcher != null

    val enabled: Boolean get() = entry.isFile

    fun set(on: Boolean) {
        if (!on) {
            entry.delete()
            return
        }
        val exe = launcher ?: return
        entry.parentFile.mkdirs()
        entry.writeText(
            """
            [Desktop Entry]
            Type=Application
            Name=Boni
            Comment=Graficas de Boni en el escritorio
            Exec="$exe" --background
            X-GNOME-Autostart-enabled=true
            X-GNOME-Autostart-Delay=5
            Terminal=false
            """.trimIndent() + "\n",
        )
    }
}

/**
 * Keep widget windows on the desktop layer (below normal windows, on every workspace, out of the taskbar).
 * Linux/X11 only, through `wmctrl` (sudo apt install wmctrl). Elsewhere widgets are normal frameless windows.
 */
object DesktopLayer {
    private val wmctrl: String? by lazy {
        if (!Paths.isLinux || System.getenv("WAYLAND_DISPLAY") != null && System.getenv("DISPLAY") == null) null
        else listOf("/usr/bin/wmctrl", "/usr/local/bin/wmctrl").firstOrNull { File(it).canExecute() }
    }

    val available: Boolean get() = wmctrl != null

    fun pin(windowTitle: String) {
        val cmd = wmctrl ?: return Log.info("wmctrl not available: widget $windowTitle stays a normal window")
        thread(isDaemon = true, name = "wmctrl") {
            // The window manager needs a moment to map the window; retry a few times.
            repeat(5) {
                Thread.sleep(400)
                val ok = runCatching {
                    val p = ProcessBuilder(cmd, "-r", windowTitle, "-b", "add,below,sticky,skip_taskbar,skip_pager")
                        .redirectErrorStream(true).start()
                    p.waitFor(3, TimeUnit.SECONDS) && p.exitValue() == 0
                }.getOrDefault(false)
                if (ok) {
                    Log.info("pinned $windowTitle to the desktop layer")
                    return@thread
                }
            }
            Log.warn("wmctrl could not pin $windowTitle")
        }
    }
}

/**
 * One Boni per user session: the first instance listens on a local port; a second launch (menu icon while the
 * widgets run from autostart) asks it to open the main window and exits.
 */
class SingleInstance(private val portFile: File = File(Paths.data, "instance.port")) {
    fun signalExisting(): Boolean {
        val port = portFile.takeIf { it.isFile }?.readText()?.trim()?.toIntOrNull() ?: return false
        return runCatching {
            Socket(InetAddress.getLoopbackAddress(), port).use { it.getOutputStream().write("open\n".toByteArray()) }
            true
        }.getOrDefault(false)
    }

    fun listen(onOpen: () -> Unit) {
        val server = ServerSocket(0, 5, InetAddress.getLoopbackAddress())
        portFile.parentFile.mkdirs()
        portFile.writeText(server.localPort.toString())
        portFile.deleteOnExit()
        thread(isDaemon = true, name = "single-instance") {
            while (true) {
                val s = runCatching { server.accept() }.getOrNull() ?: break
                s.use { if (it.getInputStream().bufferedReader().readLine() == "open") onOpen() }
            }
        }
    }
}
