package io.github.juanbonastre.boni.desktop.screenshots

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.juanbonastre.boni.api.BoniJson
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.api.ChartPoint
import io.github.juanbonastre.boni.api.ChartSeries
import io.github.juanbonastre.boni.api.FormComponent
import io.github.juanbonastre.boni.api.Option
import io.github.juanbonastre.boni.api.Screen
import io.github.juanbonastre.boni.data.ChartState
import io.github.juanbonastre.boni.ui.BoniTheme
import io.github.juanbonastre.boni.ui.ChartCardContent
import io.github.juanbonastre.boni.ui.FormView
import io.github.juanbonastre.boni.ui.LocalBoniColors
import io.github.juanbonastre.boni.desktop.Png
import java.io.File

/** Sample data with realistic shapes (not Juan's real numbers). */
object Demo {
    private const val NOW = "2026-10-12T18:30:00+02:00"
    private val months = listOf("2025-11" to "nov", "2025-12" to "dic", "2026-01" to "ene", "2026-02" to "feb", "2026-03" to "mar",
        "2026-04" to "abr", "2026-05" to "may", "2026-06" to "jun", "2026-07" to "jul", "2026-08" to "ago", "2026-09" to "sep",
        "2026-10" to "oct")

    private fun monthly(values: List<Double?>) = months.mapIndexed { i, (k, l) ->
        ChartPoint(k, l, values[i] ?: 0.0, partial = i == months.lastIndex, noData = values[i] == null)
    }

    val byCategory = ChartData(
        chartId = "spending-by-category", title = "Gasto del mes", subtitle = "octubre 2026 - hasta hoy", kind = "hbar",
        series = listOf(ChartSeries("Gasto del mes", listOf(
            ChartPoint("comida", "Comida", 312.40), ChartPoint("ocio", "Ocio", 96.00),
            ChartPoint("suscripciones", "Suscripciones", 54.97), ChartPoint("transporte", "Transporte", 48.30),
            ChartPoint("bebida", "Bebida", 31.20), ChartPoint("compras", "Compras", 25.99), ChartPoint("otros", "Otros", 18.00),
        ))),
        total = 586.86, drilldown = true, computedAt = NOW,
    )

    val monthly = ChartData(
        chartId = "monthly-spending", title = "Gasto por mes", subtitle = "nov 2025 - oct 2026", kind = "bar",
        series = listOf(ChartSeries("Gasto por mes", monthly(listOf(null, null, 980.0, 1050.0, 1210.0, 1180.0, 1420.0, 1290.0,
            1610.0, 1380.0, 1265.0, 586.86)))),
        total = 11971.86, average = 1260.56, computedAt = NOW,
    )

    val eatingOut = ChartData(
        chartId = "eating-out", title = "Comida fuera", subtitle = "nov 2025 - oct 2026", kind = "line",
        series = listOf(ChartSeries("Comida fuera", monthly(listOf(null, null, 180.0, 195.0, 240.0, 230.0, 310.0, 280.0, 330.0,
            290.0, 270.0, 145.0)))),
        total = 2470.0, average = 258.33, computedAt = NOW,
    )

    val all = listOf(byCategory, monthly, eatingOut)

    private val quarters = months.takeLast(6)
    private fun pts(values: List<Double>) = quarters.mapIndexed { i, (k, l) -> ChartPoint(k, l, values[i], partial = i == quarters.lastIndex) }

    val stacked = ChartData(
        chartId = "", title = "Gasto por grupo", subtitle = "may 2026 - oct 2026 - hasta hoy", kind = "stacked_bar",
        series = listOf(
            ChartSeries("Comida", pts(listOf(420.0, 380.0, 510.0, 450.0, 470.0, 312.0)), key = "comida", role = "split"),
            ChartSeries("Ocio", pts(listOf(160.0, 210.0, 330.0, 190.0, 150.0, 96.0)), key = "ocio", role = "split"),
            ChartSeries("Transporte", pts(listOf(90.0, 85.0, 140.0, 95.0, 88.0, 48.0)), key = "transporte", role = "split"),
            ChartSeries("Suscripciones", pts(listOf(55.0, 55.0, 55.0, 55.0, 55.0, 55.0)), key = "suscripciones", role = "split"),
            ChartSeries("Otros", pts(listOf(60.0, 40.0, 75.0, 30.0, 52.0, 18.0)), key = "_other", role = "split"),
        ),
        total = 5418.0, computedAt = NOW,
    )

    val compareBars = ChartData(
        chartId = "", title = "Este ano frente al pasado", subtitle = "may 2026 - oct 2026 - frente a may 2025 - oct 2025", kind = "bar",
        series = listOf(
            ChartSeries("Gasto", pts(listOf(1420.0, 1290.0, 1610.0, 1380.0, 1265.0, 586.0)), key = "main"),
            ChartSeries("may 2025 - oct 2025", pts(listOf(1310.0, 1350.0, 1490.0, 1420.0, 1180.0, 610.0)), key = "previous", role = "compare"),
        ),
        total = 7551.0, previousTotal = 7360.0, deltaPct = 2.6, computedAt = NOW,
    )

    val lines = ChartData(
        chartId = "", title = "Comida fuera por persona", subtitle = "may 2026 - oct 2026 - hasta hoy", kind = "line",
        series = listOf(
            ChartSeries("Lucia Ferri", pts(listOf(80.0, 95.0, 140.0, 70.0, 88.0, 40.0)), key = "lucia-ferri", role = "split"),
            ChartSeries("Tomas", pts(listOf(45.0, 60.0, 30.0, 85.0, 64.0, 22.0)), key = "tomas", role = "split"),
            ChartSeries("(nadie)", pts(listOf(120.0, 110.0, 135.0, 128.0, 118.0, 61.0)), key = "", role = "split"),
        ),
        total = 1491.0, computedAt = NOW,
    )

    val area = ChartData(
        chartId = "", title = "Comida fuera", subtitle = "may 2026 - oct 2026 - frente al ano anterior", kind = "area",
        series = listOf(
            ChartSeries("Comida fuera", pts(listOf(310.0, 280.0, 330.0, 290.0, 270.0, 145.0)), key = "main"),
            ChartSeries("may 2025 - oct 2025", pts(listOf(260.0, 300.0, 280.0, 310.0, 250.0, 120.0)), key = "previous", role = "compare"),
        ),
        total = 1625.0, previousTotal = 1520.0, deltaPct = 6.9, computedAt = NOW,
    )

    val donut = ChartData(
        chartId = "", title = "Reparto del ano", subtitle = "2026 - hasta hoy", kind = "donut",
        series = listOf(ChartSeries("Reparto del ano", listOf(
            ChartPoint("comida/supermercado", "Supermercado (comida)", 2310.0), ChartPoint("comida/restaurante", "Restaurante (comida)", 1890.0),
            ChartPoint("ocio", "Ocio", 1240.0), ChartPoint("transporte/gasolina", "Gasolina (transporte)", 760.0),
            ChartPoint("suscripciones", "Suscripciones", 540.0), ChartPoint("_rest", "Resto (9)", 1380.0),
        ))),
        total = 8120.0, computedAt = NOW,
    )

    val number = ChartData(
        chartId = "", title = "Gasto este mes", subtitle = "octubre 2026 - hasta hoy - frente a septiembre 2026", kind = "number",
        series = listOf(
            ChartSeries("Gasto este mes", listOf(ChartPoint("total", "Total", 586.86)), key = "total"),
            ChartSeries("septiembre 2026", listOf(ChartPoint("total", "Total", 642.10)), key = "previous", role = "compare"),
        ),
        total = 586.86, previousTotal = 642.10, deltaPct = -8.6, computedAt = NOW,
    )

    val table = ChartData(
        chartId = "", title = "Comercios del mes", subtitle = "octubre 2026 - hasta hoy", kind = "table", xLabel = null,
        series = listOf(ChartSeries("Comercios del mes", listOf(
            ChartPoint("Mercadona", "Mercadona", 182.40), ChartPoint("Ramen Kagura", "Ramen Kagura", 64.50),
            ChartPoint("Renfe", "Renfe", 48.30), ChartPoint("Spotify", "Spotify", 10.99), ChartPoint("Cafe Central", "Cafe Central", 9.80),
        ))),
        total = 315.99, drilldown = true, computedAt = NOW,
    )

    val kinds = listOf(stacked, compareBars, lines, area, donut, number, table)
}

/** [width] and [height] in dp; rendered at 2x. */
private fun render(file: File, width: Int, height: Int, content: @Composable () -> Unit) {
    Png.render(file, width, height, content)
    println("wrote $file")
}

@Composable
private fun HomePreview() {
    val c = LocalBoniColors.current
    Column(Modifier.fillMaxSize().background(c.page).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Boni", color = c.ink, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Button(onClick = {}, modifier = Modifier.height(44.dp)) { Text("+  Apuntar gasto", fontWeight = FontWeight.SemiBold) }
        ChartCardContent("Gasto del mes", ChartState(Demo.byCategory), Modifier.fillMaxWidth(), chartHeight = 240.dp)
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ChartCardContent("Gasto por mes", ChartState(Demo.monthly), Modifier.weight(1f))
            ChartCardContent("Comida fuera", ChartState(Demo.eatingOut), Modifier.weight(1f))
        }
    }
}

@Composable
private fun WidgetsPreview(offline: Boolean) {
    // A wallpaper-like background, to judge how the widgets sit on a desktop.
    Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF2E3B4E), Color(0xFF6B4F5C), Color(0xFFB07B5E))))) {
        Row(Modifier.padding(24.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Demo.all.forEach { d ->
                ChartCardContent(d.title, ChartState(d, offline = offline), Modifier.width(390.dp).height(260.dp),
                    chartHeight = 164.dp, compact = true)
            }
        }
    }
}

@Composable
private fun FormPreview(form: FormComponent) {
    val c = LocalBoniColors.current
    Box(Modifier.fillMaxSize().background(c.page).padding(24.dp)) {
        Surface(color = c.surface, shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)) {
            Column(Modifier.padding(20.dp)) {
                Text("Apuntar gasto", color = c.ink, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                FormView(form, today = "2026-10-12", loadOptions = { _, _ -> listOf(Option("comida/restaurante", "comida/restaurante")) },
                    onSubmit = { emptyMap() })
            }
        }
    }
}

@Composable
private fun KindsPreview() {
    val c = LocalBoniColors.current
    Column(Modifier.fillMaxSize().background(c.page).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Demo.kinds.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                row.forEach { d -> ChartCardContent(d.title, ChartState(d), Modifier.weight(1f), chartHeight = 200.dp) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

fun main(args: Array<String>) {
    val out = File(args.firstOrNull() ?: "build/screenshots").apply { mkdirs() }
    val examples = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "api/examples") }.firstOrNull { it.isDirectory }
    for (dark in listOf(false, true)) {
        val mode = if (dark) "dark" else "light"
        render(File(out, "home-$mode.png"), 1100, 1000) { BoniTheme(dark = dark) { HomePreview() } }
        render(File(out, "widgets-$mode.png"), 1300, 310) { BoniTheme(dark = dark) { WidgetsPreview(offline = false) } }
        render(File(out, "kinds-$mode.png"), 1100, 1400) { BoniTheme(dark = dark) { KindsPreview() } }
    }
    render(File(out, "widgets-offline-dark.png"), 1300, 310) { BoniTheme(dark = true) { WidgetsPreview(offline = true) } }
    if (examples != null) {
        // The real server answer for the form, from the contract examples.
        val screen = BoniJson.decodeFromString(Screen.serializer(), File(examples, "screen-capture-expense.json").readText())
        val form = screen.components.filterIsInstance<FormComponent>().first()
        render(File(out, "form-light.png"), 600, 1250) { BoniTheme(dark = false) { FormPreview(form) } }
    }
}
