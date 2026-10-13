package io.github.juanbonastre.boni.desktop

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.juanbonastre.boni.BoniController
import io.github.juanbonastre.boni.api.Widget
import io.github.juanbonastre.boni.ui.BoniTheme
import io.github.juanbonastre.boni.ui.ChartCardContent
import io.github.juanbonastre.boni.data.ChartState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Widget sizes in dp (the server says small, medium or large; the user can resize window widgets afterwards). */
fun widgetSize(size: String): Pair<Int, Int> = when (size) {
    "small" -> 300 to 200
    "large" -> 520 to 340
    else -> 380 to 260
}

/**
 * Cinnamon desklets: the native way to put something on the Cinnamon desktop (they stay on the desktop layer, survive
 * "show desktop" and are managed from Cinnamon's own Desklets settings). Boni installs a small desklet
 * (resources/desklet) and renders each widget of this device to `~/.cache/boni/desklet/slot-N.png`; every desklet
 * instance shows one slot and reloads it when the picture changes.
 */
object Desklet {
    const val UUID = "boni@juanbonastre"
    private val FILES = listOf("metadata.json", "settings-schema.json", "desklet.js")

    val cinnamon: Boolean
        get() = Paths.isLinux && (System.getenv("XDG_CURRENT_DESKTOP") ?: "").contains("cinnamon", ignoreCase = true)

    val folder: File get() = File(Paths.home, ".local/share/cinnamon/desklets/$UUID")
    val pictures: File get() = File(Paths.cache, "desklet")

    val installed: Boolean get() = File(folder, "desklet.js").isFile

    /** Copies (or updates) the desklet into the user's Cinnamon folder. Returns false if it could not. */
    fun install(): Boolean = runCatching {
        folder.mkdirs()
        for (name in FILES) {
            val text = requireNotNull(Desklet::class.java.getResourceAsStream("/desklet/$UUID/$name")) { name }
                .bufferedReader().use { it.readText() }
            val target = File(folder, name)
            if (!target.isFile || target.readText() != text) target.writeText(text)
        }
        true
    }.onFailure { Log.warn("desklet install failed: $it") }.getOrDefault(false)

    /** Renders every widget of this device to its slot picture; removes pictures of slots that no longer exist. */
    suspend fun export(controller: BoniController, widgets: List<Widget>, dark: Boolean?) {
        pictures.mkdirs()
        widgets.forEachIndexed { i, w ->
            val state = controller.charts.load(w.chartId, generation = controller.refreshTick)
            val title = controller.chartTitle(w.chartId) ?: state.data?.title ?: w.chartId
            val (width, height) = widgetSize(w.size)
            runCatching {
                withContext(Dispatchers.Default) { renderSlot(i, width, height, title, state, dark) }
            }.onFailure { Log.warn("desklet picture ${i + 1} failed: $it") }
        }
        pictures.listFiles { f -> f.name.matches(Regex("""slot-\d+\.png""")) }?.forEach { f ->
            val n = f.name.removePrefix("slot-").removeSuffix(".png").toIntOrNull() ?: return@forEach
            if (n > widgets.size) f.delete()
        }
    }

    private fun renderSlot(i: Int, width: Int, height: Int, title: String, state: ChartState, dark: Boolean?) {
        Png.render(File(pictures, "slot-${i + 1}.png"), width, height) {
            val content = @Composable {
                ChartCardContent(title, state, Modifier.fillMaxSize().padding(4.dp), chartHeight = (height - 96).coerceAtLeast(110).dp,
                    compact = true, elevated = false)
            }
            if (dark == null) BoniTheme(content = content) else BoniTheme(dark = dark, content = content)
        }
    }
}
