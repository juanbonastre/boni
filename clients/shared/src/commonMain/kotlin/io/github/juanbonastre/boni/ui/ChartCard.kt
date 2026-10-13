package io.github.juanbonastre.boni.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.data.ChartRepository
import io.github.juanbonastre.boni.data.ChartState
import io.github.juanbonastre.boni.ui.charts.Chart
import io.github.juanbonastre.boni.ui.charts.ChartMath
import io.github.juanbonastre.boni.ui.charts.seriesColors

/** A chart card that loads its own data; used by the home screen and by desktop widgets. */
@Composable
fun ChartCard(
    chartId: String,
    title: String,
    repository: ChartRepository,
    refreshTick: Int,
    modifier: Modifier = Modifier,
    chartHeight: Dp = 220.dp,
    compact: Boolean = false,
    elevated: Boolean = true,
) {
    var drill by remember(chartId) { mutableStateOf<String?>(null) }
    var state by remember(chartId) { mutableStateOf(ChartState(data = repository.cached(chartId), loading = true)) }
    LaunchedEffect(chartId, drill, refreshTick) {
        if (state.data == null || state.data?.drill != drill) {
            state = state.copy(loading = true, data = repository.cached(chartId, drill) ?: state.data.takeIf { drill == null })
        }
        // Shared with every other card/widget of the same chart: one request per refresh tick.
        state = repository.load(chartId, drill, generation = refreshTick)
    }
    ChartCardContent(
        title = title,
        state = state,
        modifier = modifier,
        chartHeight = chartHeight,
        compact = compact,
        elevated = elevated,
        onDrill = { key -> drill = key },
        onBack = if (drill != null) ({ drill = null }) else null,
    )
}

/** Stateless card body (also used by screenshot rendering with fixed data). */
@Composable
fun ChartCardContent(
    title: String,
    state: ChartState,
    modifier: Modifier = Modifier,
    chartHeight: Dp = 220.dp,
    compact: Boolean = false,
    elevated: Boolean = true,
    onDrill: ((String) -> Unit)? = null,
    onBack: (() -> Unit)? = null,
) {
    val c = LocalBoniColors.current
    val data: ChartData? = state.data
    Surface(
        modifier = modifier.border(1.dp, c.border, RoundedCornerShape(16.dp)),
        shape = RoundedCornerShape(16.dp),
        color = c.surface,
        tonalElevation = 0.dp,
        shadowElevation = if (elevated && !compact) 1.dp else 0.dp,
    ) {
        Column(Modifier.padding(if (compact) 12.dp else 16.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(data?.title ?: title, color = c.ink, fontWeight = FontWeight.SemiBold,
                        fontSize = if (compact) 13.sp else 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val sub = data?.subtitle ?: if (state.loading) "Cargando..." else ""
                    if (sub.isNotEmpty()) {
                        Text(sub, color = c.muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (data?.total != null && data.kind != "number") {
                    Column(horizontalAlignment = Alignment.End) {
                        Text(ChartMath.formatAuto(data.total, data.unit), color = c.ink, fontWeight = FontWeight.SemiBold,
                            fontSize = if (compact) 15.sp else 20.sp)
                        val delta = data.deltaPct
                        if (delta != null) {
                            val up = delta > 0
                            val bad = if (data.measure == "income") !up else up
                            Text(ChartMath.percent(delta), color = if (data.measure == "count") c.inkSecondary else if (bad) c.critical else c.good,
                                fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                        } else {
                            Text(if (data.kind == "hbar" || data.kind == "donut") "total" else "en el periodo", color = c.muted, fontSize = 10.sp)
                        }
                    }
                }
            }
            if (onBack != null) {
                TextButton(onClick = onBack, modifier = Modifier.height(30.dp)) { Text("< Volver", fontSize = 12.sp) }
            }
            Spacer(Modifier.height(if (compact) 6.dp else 10.dp))
            Box(Modifier.fillMaxWidth().height(chartHeight), contentAlignment = Alignment.Center) {
                when {
                    data != null -> Chart(
                        data = data, colors = c, accent = c.accentFor(data.chartId), modifier = Modifier.fillMaxWidth().height(chartHeight),
                        compact = compact,
                        onSelect = if (data.drilldown && onDrill != null) ({ p -> onDrill(p.key) }) else null,
                    )
                    state.error != null -> Text(state.error ?: "", color = c.muted, fontSize = 12.sp)
                    else -> Text("Cargando...", color = c.muted, fontSize = 12.sp)
                }
            }
            if (data != null) Legend(data, c, compact)
            val note = when {
                state.offline && data != null -> "Sin conexion - ultimos datos guardados"
                data?.stale == true -> "El servidor no llega a los datos - datos guardados"
                data?.drilldown == true && !compact -> "Toca un punto para ver el detalle"
                else -> null
            }
            if (note != null) {
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (state.offline || data?.stale == true) {
                        Box(Modifier.width(6.dp).height(6.dp).border(3.dp, c.muted, RoundedCornerShape(3.dp)))
                    }
                    Text(note, color = c.muted, fontSize = 11.sp)
                }
            }
        }
    }
}

/** Names of the series (split values, compared period) with their colors; nothing for a single series or a donut. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend(data: ChartData, c: BoniColors, compact: Boolean) {
    if (data.series.size < 2 || data.kind == "donut" || data.kind == "number" || data.kind == "table") return
    val palette = seriesColors(data, c, c.accentFor(data.chartId))
    FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        data.series.forEachIndexed { i, s ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(8.dp).height(8.dp).background(palette[i], CircleShape))
                Text(if (s.role == "main") data.title else s.name, color = c.inkSecondary, fontSize = if (compact) 10.sp else 11.sp,
                    modifier = Modifier.padding(start = 4.dp), maxLines = 1)
            }
        }
    }
}
