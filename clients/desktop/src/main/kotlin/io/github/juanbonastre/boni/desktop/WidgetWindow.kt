package io.github.juanbonastre.boni.desktop

import androidx.compose.foundation.ContextMenuArea
import androidx.compose.foundation.ContextMenuItem
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.window.WindowDraggableArea
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.rememberWindowState
import io.github.juanbonastre.boni.BoniController
import io.github.juanbonastre.boni.api.Widget
import io.github.juanbonastre.boni.ui.ChartCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.drop
import java.awt.geom.RoundRectangle2D

/**
 * A desktop widget as a small frameless window with one chart card. Drag it anywhere (the position is remembered);
 * right click for the menu. On Linux/X11 with wmctrl it sits below the other windows on every workspace.
 *
 * Linux: the window is opaque and cut to a rounded rectangle with the X11 shape extension. Per-pixel transparency
 * depends on the compositor and the JDK, and when it fails the window is not drawn at all.
 */
@Composable
fun WidgetWindow(
    widget: Widget,
    placement: WidgetPlacement,
    controller: BoniController,
    dark: Boolean?,
    onMoved: (WidgetPlacement) -> Unit,
    onOpenApp: () -> Unit,
    onOpenCharts: () -> Unit,
    onRemove: () -> Unit,
    onHide: () -> Unit,
) {
    val state = rememberWindowState(
        position = WindowPosition(placement.x.dp, placement.y.dp),
        size = DpSize(placement.width.dp, placement.height.dp),
    )
    val title = "boni-widget-${widget.id}"
    val transparent = !Paths.isLinux
    Window(
        onCloseRequest = onHide,
        state = state,
        title = title,
        icon = BoniIcon,
        undecorated = true,
        transparent = transparent,
        resizable = true,
        alwaysOnTop = false,
    ) {
        LaunchedEffect(Unit) {
            Log.info("widget ${widget.id} (${widget.chartId}, ${widget.size}) at ${placement.x},${placement.y} ${placement.width}x${placement.height}")
            DesktopLayer.pin(title)
        }
        if (!transparent) {
            // Rounded corners without transparency: shape the window (follows resizes).
            LaunchedEffect(state.size) {
                runCatching {
                    val w = window.width.toDouble()
                    val h = window.height.toDouble()
                    window.shape = RoundRectangle2D.Double(0.0, 0.0, w, h, 32.0, 32.0)  // AWT user space: 16dp corners
                }.onFailure { Log.warn("widget shape: $it") }
            }
        }
        LaunchedEffect(state) {
            snapshotFlow { state.position to state.size }.drop(1).collectLatest { (pos, size) ->
                delay(600) // save once the drag/resize settles
                if (pos is WindowPosition.Absolute) {
                    onMoved(WidgetPlacement(pos.x.value.toInt(), pos.y.value.toInt(), size.width.value.toInt(), size.height.value.toInt(),
                        widget.size))
                }
            }
        }
        ThemeFor(dark) {
            ContextMenuArea(items = {
                listOf(
                    ContextMenuItem("Abrir Boni") { onOpenApp() },
                    ContextMenuItem("Cambiar graficas y widgets") { onOpenCharts() },
                    ContextMenuItem("Actualizar") { controller.refresh() },
                    ContextMenuItem("Ocultar en este equipo") { onHide() },
                    ContextMenuItem("Quitar este widget") { onRemove() },
                )
            }) {
                WindowDraggableArea(Modifier.fillMaxSize()) {
                    ChartCard(
                        chartId = widget.chartId,
                        title = controller.chartTitle(widget.chartId) ?: "Boni",
                        repository = controller.charts,
                        refreshTick = controller.refreshTick,
                        modifier = Modifier.fillMaxSize().padding(if (transparent) 4.dp else 0.dp),
                        chartHeight = (state.size.height.value - 96f).coerceAtLeast(110f).dp,
                        compact = true,
                        elevated = transparent,
                    )
                }
            }
        }
    }
}
