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

private val TITLES = mapOf(
    "spending-by-category" to "Gasto del mes",
    "monthly-spending" to "Gasto por mes",
    "eating-out" to "Comida fuera",
)

/**
 * A desktop widget: a small frameless, transparent window with one chart card. Drag it anywhere (the position is
 * remembered); right click for the menu. On Linux/X11 with wmctrl it sits below the other windows on every workspace.
 */
@Composable
fun WidgetWindow(
    widget: Widget,
    placement: WidgetPlacement,
    controller: BoniController,
    dark: Boolean?,
    onMoved: (WidgetPlacement) -> Unit,
    onOpenApp: () -> Unit,
    onHide: () -> Unit,
) {
    val state = rememberWindowState(
        position = WindowPosition(placement.x.dp, placement.y.dp),
        size = DpSize(placement.width.dp, placement.height.dp),
    )
    val title = "boni-widget-${widget.id}"
    Window(
        onCloseRequest = onHide,
        state = state,
        title = title,
        icon = BoniIcon,
        undecorated = true,
        transparent = true,
        resizable = true,
        alwaysOnTop = false,
    ) {
        LaunchedEffect(Unit) { DesktopLayer.pin(title) }
        LaunchedEffect(state) {
            snapshotFlow { state.position to state.size }.drop(1).collectLatest { (pos, size) ->
                delay(600) // save once the drag/resize settles
                if (pos is WindowPosition.Absolute) {
                    onMoved(WidgetPlacement(pos.x.value.toInt(), pos.y.value.toInt(), size.width.value.toInt(), size.height.value.toInt()))
                }
            }
        }
        ThemeFor(dark) {
            ContextMenuArea(items = {
                listOf(
                    ContextMenuItem("Abrir Boni") { onOpenApp() },
                    ContextMenuItem("Actualizar") { controller.refresh() },
                    ContextMenuItem("Ocultar este widget") { onHide() },
                )
            }) {
                WindowDraggableArea(Modifier.fillMaxSize()) {
                    ChartCard(
                        chartId = widget.chartId,
                        title = TITLES[widget.chartId] ?: widget.chartId,
                        repository = controller.charts,
                        refreshTick = controller.refreshTick,
                        modifier = Modifier.fillMaxSize().padding(4.dp),
                        chartHeight = (state.size.height.value - 96f).coerceAtLeast(120f).dp,
                        compact = true,
                    )
                }
            }
        }
    }
}
