package io.github.juanbonastre.boni.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.juanbonastre.boni.BoniController
import io.github.juanbonastre.boni.SubmitOutcome
import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.ButtonComponent
import io.github.juanbonastre.boni.api.ChartCardComponent
import io.github.juanbonastre.boni.api.Component
import io.github.juanbonastre.boni.api.FormComponent
import io.github.juanbonastre.boni.api.OfflineException
import io.github.juanbonastre.boni.api.Screen
import io.github.juanbonastre.boni.api.TextComponent
import io.github.juanbonastre.boni.api.UnknownComponent
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Default home when the server can't be reached and nothing is cached: the three starting charts. */
private val OfflineHome = Screen(
    id = "home", title = "Boni",
    components = listOf(
        ButtonComponent(label = "Apuntar gasto", screen = "capture-expense"),
        ChartCardComponent(chartId = "spending-by-category", title = "Gasto del mes", size = "wide"),
        ChartCardComponent(chartId = "monthly-spending", title = "Gasto por mes"),
        ChartCardComponent(chartId = "eating-out", title = "Comida fuera"),
    ),
)

/** The main window content: home (buttons + chart cards) and server screens (forms). */
@Composable
fun BoniApp(controller: BoniController, onOpenSettings: () -> Unit) {
    val c = LocalBoniColors.current
    var screenId by remember { mutableStateOf("home") }
    var screen by remember { mutableStateOf<Screen?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(screenId, controller.refreshTick, controller.config) {
        loadError = null
        screen = try {
            if (screenId == "home") controller.home() else controller.screen(screenId)
        } catch (e: OfflineException) {
            loadError = "Sin conexion con el servidor"
            if (screenId == "home") OfflineHome else null
        } catch (e: ApiException) {
            loadError = e.message
            if (screenId == "home") OfflineHome else null
        }
    }
    LaunchedEffect(message) {
        if (message != null) {
            delay(5000)
            message = null
        }
    }

    Box(Modifier.fillMaxSize().background(c.page)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp)) {
            Header(controller, screen?.title ?: "Boni", showBack = screenId != "home", onBack = { screenId = "home" },
                onSync = { scope.launch { controller.sync(); controller.refresh() } }, onOpenSettings = onOpenSettings)
            loadError?.let { Text(it, color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
            Spacer(Modifier.height(16.dp))
            screen?.let { s ->
                ScreenView(s, controller, onNavigate = { screenId = it }, onMessage = { message = it })
            }
            QueueNotes(controller)
        }
        message?.let {
            Surface(
                shape = RoundedCornerShape(12.dp), color = c.ink, modifier = Modifier.align(Alignment.BottomCenter).padding(20.dp),
            ) { Text(it, color = c.surface, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) }
        }
    }
}

@Composable
private fun Header(
    controller: BoniController, title: String, showBack: Boolean, onBack: () -> Unit, onSync: () -> Unit, onOpenSettings: () -> Unit,
) {
    val c = LocalBoniColors.current
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        if (showBack) TextButton(onClick = onBack) { Text("< Inicio") }
        Text(title, color = c.ink, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (controller.pending > 0) {
            Text("${controller.pending} sin enviar", color = c.inkSecondary, fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
        }
        TextButton(onClick = onSync) { Text("Actualizar") }
        TextButton(onClick = onOpenSettings) { Text("Ajustes") }
    }
}

@Composable
private fun ScreenView(screen: Screen, controller: BoniController, onNavigate: (String) -> Unit, onMessage: (String) -> Unit) {
    val buttons = screen.components.filterIsInstance<ButtonComponent>()
    val charts = screen.components.filterIsInstance<ChartCardComponent>()
    val others = screen.components.filter { it !is ButtonComponent && it !is ChartCardComponent }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (buttons.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                buttons.forEach { b ->
                    if (b.style == "secondary") OutlinedButton(onClick = { onNavigate(b.screen) }) { Text(b.label) }
                    else Button(onClick = { onNavigate(b.screen) }, modifier = Modifier.height(44.dp)) {
                        Text((if (b.icon == "add") "+  " else "") + b.label, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        others.forEach { comp -> OtherComponent(comp, controller, onNavigate, onMessage) }
        if (charts.isNotEmpty()) ChartGrid(charts, controller)
    }
}

@Composable
private fun OtherComponent(comp: Component, controller: BoniController, onNavigate: (String) -> Unit, onMessage: (String) -> Unit) {
    val c = LocalBoniColors.current
    when (comp) {
        is TextComponent -> Text(comp.text, color = if (comp.style == "caption") c.muted else c.ink,
            fontSize = when (comp.style) { "title" -> 18.sp; "caption" -> 12.sp; else -> 14.sp })
        is FormComponent -> Surface(shape = RoundedCornerShape(16.dp), color = c.surface, modifier = Modifier.widthIn(max = 560.dp)) {
            FormView(
                form = comp,
                today = controller.today(),
                loadOptions = { source, q -> controller.options(source, q).options },
                onSubmit = { payload ->
                    when (val r = controller.submit(comp.submit.action, payload)) {
                        is SubmitOutcome.Done -> { onMessage(r.message); onNavigate("home"); emptyMap() }
                        is SubmitOutcome.Queued -> { onMessage(r.message); onNavigate("home"); emptyMap() }
                        is SubmitOutcome.Invalid -> r.fieldErrors.ifEmpty { mapOf("_" to r.message) }
                        is SubmitOutcome.Failed -> { onMessage(r.message); mapOf("_" to r.message) }
                    }
                },
                modifier = Modifier.padding(20.dp),
            )
        }
        is UnknownComponent -> Text("Este elemento necesita una version mas nueva de Boni (${comp.type})", color = c.muted, fontSize = 12.sp)
        else -> Unit
    }
}

@Composable
private fun ChartGrid(charts: List<ChartCardComponent>, controller: BoniController) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val twoColumns = maxWidth > 820.dp
        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val wide = charts.filter { it.size == "wide" || !twoColumns }
            val narrow = charts.filter { it.size != "wide" && twoColumns }
            wide.forEach { ChartCell(it, controller, Modifier.fillMaxWidth()) }
            narrow.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    row.forEach { ChartCell(it, controller, Modifier.weight(1f)) }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun ChartCell(card: ChartCardComponent, controller: BoniController, modifier: Modifier) {
    ChartCard(card.chartId, card.title, controller.charts, controller.refreshTick, modifier,
        chartHeight = if (card.size == "wide") 240.dp else 220.dp)
}

@Composable
private fun QueueNotes(controller: BoniController) {
    val c = LocalBoniColors.current
    val rejected = remember(controller.pending, controller.refreshTick) { controller.queue.items().filter { it.error != null } }
    val scope = rememberCoroutineScope()
    if (rejected.isEmpty()) return
    Spacer(Modifier.height(20.dp))
    Text("No se pudieron guardar", color = c.critical, fontWeight = FontWeight.SemiBold)
    rejected.forEach { item ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${item.request.values["concept"] ?: ""} ${item.request.values["amount"] ?: ""}: ${item.error}",
                color = c.inkSecondary, fontSize = 12.sp, modifier = Modifier.weight(1f))
            TextButton(onClick = { scope.launch { controller.queue.dismiss(item.request.clientId); controller.refresh() } }) { Text("Descartar") }
        }
    }
}
