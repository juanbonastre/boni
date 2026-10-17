package io.github.juanbonastre.boni.desktop

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.window.WindowPosition
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogWindow
import androidx.compose.ui.window.Tray
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberDialogState
import androidx.compose.ui.window.rememberWindowState
import io.github.juanbonastre.boni.BoniController
import io.github.juanbonastre.boni.ui.CHARTS_SCREEN
import io.github.juanbonastre.boni.data.FileTextStore
import io.github.juanbonastre.boni.ui.BoniApp
import io.github.juanbonastre.boni.ui.BoniTheme
import io.github.juanbonastre.boni.ui.LocalBoniColors
import io.github.juanbonastre.boni.ui.LightColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import kotlin.system.exitProcess

/** Simple drawn icon (no image files): a rising bar chart on a blue tile. */
object BoniIcon : Painter() {
    override val intrinsicSize = Size(64f, 64f)
    override fun DrawScope.onDraw() {
        val s = size.minDimension
        drawRoundRect(LightColors.series1, size = Size(s, s), cornerRadius = androidx.compose.ui.geometry.CornerRadius(s * 0.22f))
        val w = s * 0.14f
        listOf(0.35f, 0.55f, 0.8f).forEachIndexed { i, h ->
            val x = s * (0.22f + i * 0.21f)
            drawRoundRect(Color.White, topLeft = Offset(x, s * (0.85f - h * 0.7f)), size = Size(w, s * h * 0.7f),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(w / 2))
        }
    }
}

fun main(args: Array<String>) {
    val background = "--background" in args
    val instance = SingleInstance()
    if (instance.signalExisting()) exitProcess(0) // Boni is already running: it opens its window instead.

    val settingsStore = SettingsStore()
    val initial = settingsStore.load()
    val controller = BoniController(initial.server.takeIf { it.isComplete }, FileTextStore(File(Paths.data, "store")))

    application {
        var settings by remember { mutableStateOf(initial) }
        var mainOpen by remember { mutableStateOf(!background || !settings.server.isComplete) }
        var settingsOpen by remember { mutableStateOf(!settings.server.isComplete) }
        var autostart by remember { mutableStateOf(Autostart.enabled) }
        var openCharts by remember { mutableIntStateOf(0) }
        val dark = when (settings.theme) {
            "dark" -> true
            "light" -> false
            else -> null
        }
        val scope = rememberCoroutineScope()
        val widgetMode = settings.effectiveWidgetMode(Desklet.cinnamon)

        fun update(change: (DesktopSettings) -> DesktopSettings) {
            settings = change(settings)
            settingsStore.save(settings)
        }

        DisposableEffect(Unit) {
            Log.info("start ${if (background) "in background" else "with window"}; desktop=${System.getenv("XDG_CURRENT_DESKTOP")} " +
                "session=${System.getenv("XDG_SESSION_TYPE")} wmctrl=${DesktopLayer.available} widgets=${settings.showWidgets}/$widgetMode " +
                "configured=${settings.server.isComplete}")
            instance.listen { mainOpen = true }
            if (Autostart.supported && !settings.autostartOffered) {
                // Widgets are meant to be there at login: switch it on once (Ajustes or the tray menu switch it off).
                Autostart.set(true)
                autostart = Autostart.enabled
                update { it.copy(autostartOffered = true) }
                Log.info("autostart enabled on first run: $autostart")
            }
            val job = controller.start(scope)
            onDispose { job.cancel() }
        }
        // Which widgets this device shows comes from the server (the last list is kept on the device for offline starts).
        // At login the network (Tailscale) may take a while: retry until it answers.
        LaunchedEffect(controller.config, controller.refreshTick) {
            while (true) {
                val ok = runCatching { controller.loadWidgets() }
                    .onFailure { Log.info("widgets list not loaded yet: ${it.message}") }.isSuccess
                if (ok) break
                delay(30_000)
            }
            if (controller.chartSpecs.isEmpty()) runCatching { controller.loadCharts() }
            Log.info("widgets: ${controller.widgets.joinToString { it.id }}")
        }
        // Cinnamon desklets: install the desklet and keep its pictures up to date.
        LaunchedEffect(widgetMode, settings.showWidgets, controller.widgets, controller.refreshTick, settings.theme) {
            if (widgetMode != "desklets" || !settings.showWidgets) return@LaunchedEffect
            if (Desklet.install()) Log.info("desklet ready in ${Desklet.folder}")
            Desklet.export(controller, controller.widgets, dark)
        }

        Tray(
            icon = BoniIcon,
            tooltip = "Boni",
            onAction = { mainOpen = true },
            menu = {
                Item("Abrir Boni", onClick = { mainOpen = true })
                Item("Graficas y widgets", onClick = { openCharts++; mainOpen = true })
                CheckboxItem("Mostrar widgets", checked = settings.showWidgets, onCheckedChange = { on -> update { it.copy(showWidgets = on) } })
                if (Autostart.supported) {
                    CheckboxItem("Arrancar al iniciar sesion", checked = autostart, onCheckedChange = { on ->
                        Autostart.set(on)
                        autostart = Autostart.enabled
                    })
                }
                Item("Actualizar", onClick = { controller.refresh() })
                Item("Ajustes", onClick = { settingsOpen = true })
                Separator()
                Item("Salir", onClick = { exitApplication() })
            },
        )

        if (settings.showWidgets && widgetMode == "windows") {
            controller.widgets.filter { it.id !in settings.hiddenWidgets }.forEachIndexed { i, w ->
                key(w.id) {
                    val saved = settings.widgets[w.id]
                    WidgetWindow(
                        widget = w,
                        // a new size chosen in Boni resets the size the window was dragged to
                        placement = if (saved != null && (saved.size == null || saved.size == w.size)) saved
                        else defaultPlacement(i, w.size).let { d -> if (saved != null) d.copy(x = saved.x, y = saved.y) else d },
                        controller = controller,
                        dark = dark,
                        onMoved = { p -> update { it.copy(widgets = it.widgets + (w.id to p)) } },
                        onOpenApp = { mainOpen = true },
                        onOpenCharts = { openCharts++; mainOpen = true },
                        onRemove = { scope.launch { runCatching { controller.removeWidget(w.id) } } },
                        onHide = { update { it.copy(hiddenWidgets = it.hiddenWidgets + w.id) } },
                    )
                }
            }
        }

        if (mainOpen) {
            Window(
                onCloseRequest = { mainOpen = false }, // closing the window keeps the widgets and the tray icon
                title = "Boni",
                icon = BoniIcon,
                state = rememberWindowState(position = WindowPosition(Alignment.Center), size = mainWindowSize()),
            ) {
                ThemeFor(dark) {
                    BoniApp(controller, onOpenSettings = { settingsOpen = true },
                        startScreen = if (openCharts > 0) CHARTS_SCREEN else "home", startKey = openCharts)
                }
            }
        }

        if (settingsOpen) {
            DialogWindow(
                onCloseRequest = { settingsOpen = false },
                title = "Ajustes de Boni",
                icon = BoniIcon,
                state = rememberDialogState(position = WindowPosition(Alignment.Center), size = settingsWindowSize()),
            ) {
                ThemeFor(dark) {
                    SettingsView(
                        settings = settings,
                        autostart = autostart,
                        onSave = { s ->
                            update { s.copy(widgets = it.widgets) }
                            controller.configure(s.server)
                            settingsOpen = false
                        },
                        onAutostart = { on -> Autostart.set(on); autostart = Autostart.enabled },
                        onResetWidgets = { update { it.copy(widgets = emptyMap(), hiddenWidgets = emptySet(), showWidgets = true) } },
                    )
                }
            }
        }
    }
}

@Composable
fun ThemeFor(dark: Boolean?, content: @Composable () -> Unit) {
    if (dark == null) BoniTheme(content = content) else BoniTheme(dark = dark, content = content)
}

/**
 * Usable desktop area (screen minus panels) in the same units as window sizes (Compose dp = AWT user space, so
 * display scaling is already applied).
 */
fun usableArea(): java.awt.Rectangle =
    runCatching { java.awt.GraphicsEnvironment.getLocalGraphicsEnvironment().maximumWindowBounds }.getOrNull()
        ?: java.awt.Rectangle(0, 0, 1920, 1040)

/** Main window: as large as the content (about 1180 x 900) but never taller or wider than the free area. */
fun mainWindowSize(): DpSize {
    val a = usableArea()
    return DpSize(minOf(1180, a.width - 60).dp, minOf(940, a.height - 30).dp)
}

fun settingsWindowSize(): DpSize {
    val a = usableArea()
    return DpSize(minOf(560, a.width - 40).dp, minOf(700, a.height - 40).dp)
}

/** Widgets start stacked at the top right of the usable area (wrapping to a new column when the screen is full). */
fun defaultPlacement(index: Int, size: String = "medium"): WidgetPlacement {
    val a = usableArea()
    val (width, height) = widgetSize(size)
    val perColumn = ((a.height - 24) / (height + 16)).coerceAtLeast(1)
    val column = index / perColumn
    val row = index % perColumn
    return WidgetPlacement(
        x = (a.x + a.width - (width + 24) * (column + 1)).coerceAtLeast(a.x), y = a.y + 24 + row * (height + 16),
        width = width, height = height, size = size,
    )
}

@Composable
private fun SettingsView(
    settings: DesktopSettings,
    autostart: Boolean,
    onSave: (DesktopSettings) -> Unit,
    onAutostart: (Boolean) -> Unit,
    onResetWidgets: () -> Unit,
) {
    val c = LocalBoniColors.current
    var url by remember { mutableStateOf(settings.serverUrl.ifBlank { "https://boni.example.ts.net" }) }
    var token by remember { mutableStateOf(settings.token) }
    var theme by remember { mutableStateOf(settings.theme) }
    var widgetMode by remember { mutableStateOf(settings.widgetMode) }
    var showWidgets by remember { mutableStateOf(settings.showWidgets) }
    Surface(color = c.page, modifier = Modifier.fillMaxSize()) {
      Column(Modifier.fillMaxSize()) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Servidor", color = c.ink, fontSize = 18.sp)
            OutlinedTextField(url, { url = it.trim() }, label = { Text("URL del servidor") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                token, { token = it.trim() }, label = { Text("Token de este equipo") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
            )
            Text("El token lo crea el servidor (boni device add <nombre>) y se guarda solo en este equipo.", color = c.muted, fontSize = 12.sp)
            Text("Tema", color = c.ink, fontSize = 16.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("system" to "Sistema", "light" to "Claro", "dark" to "Oscuro").forEach { (v, l) ->
                    FilterChip(selected = theme == v, onClick = { theme = v }, label = { Text(l) })
                }
            }
            Text("Escritorio", color = c.ink, fontSize = 16.sp)
            if (Autostart.supported) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(selected = autostart, onClick = { onAutostart(!autostart) }, label = { Text("Arrancar al iniciar sesion") })
                }
            } else {
                Text("Arranque automatico: disponible al instalar Boni (paquete .deb) en Linux.", color = c.muted, fontSize = 12.sp)
            }
            Text("Widgets en el escritorio", color = c.ink, fontSize = 14.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = showWidgets, onClick = { showWidgets = !showWidgets }, label = { Text("Mostrar widgets") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("" to "Automatico", "windows" to "Ventanas de Boni", "desklets" to "Desklets de Cinnamon").forEach { (v, l) ->
                    FilterChip(selected = widgetMode == v, onClick = { widgetMode = v }, label = { Text(l) })
                }
            }
            val mode = settings.copy(widgetMode = widgetMode).effectiveWidgetMode(Desklet.cinnamon)
            if (mode == "desklets") {
                Text(
                    "Boni dibuja cada widget y Cinnamon lo muestra. Para ponerlos: clic derecho en el escritorio > Anadir desklets > " +
                        "Boni > anadir (uno por widget; en su configuracion eliges cual: 1, 2, 3...). Boni tiene que estar abierto " +
                        "(basta el icono de la bandeja) para que se actualicen.",
                    color = c.muted, fontSize = 12.sp,
                )
                if (!Desklet.cinnamon) Text("Este escritorio no parece Cinnamon: los desklets no se veran.", color = c.critical, fontSize = 12.sp)
            } else {
                if (!DesktopLayer.available && Paths.isLinux) {
                    Text("Para que los widgets queden bajo las ventanas: sudo apt install wmctrl", color = c.muted, fontSize = 12.sp)
                }
                TextButton(onClick = onResetWidgets) { Text("Recolocar y mostrar todos los widgets") }
            }
            Text("Que graficas salen en cada widget: Boni > Graficas > Widgets de este equipo.", color = c.muted, fontSize = 12.sp)
        }
        Button(
            onClick = { onSave(settings.copy(serverUrl = url, token = token, theme = theme, widgetMode = widgetMode, showWidgets = showWidgets)) },
            enabled = url.isNotBlank() && token.isNotBlank(),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp).height(46.dp),
        ) { Text("Guardar") }
      }
    }
}
