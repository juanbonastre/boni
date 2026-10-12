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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
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
import io.github.juanbonastre.boni.ui.charts.LocalAnimateCharts
import org.jetbrains.skia.EncodedImageFormat
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
}

private fun render(file: File, width: Int, height: Int, content: @Composable () -> Unit) {
    val scene = ImageComposeScene(width, height, density = Density(2f)) {
        CompositionLocalProvider(LocalAnimateCharts provides false) { content() }
    }
    try {
        scene.render(0)
        val image = scene.render(1_000_000_000L)
        file.writeBytes(requireNotNull(image.encodeToData(EncodedImageFormat.PNG)).bytes)
        println("wrote $file")
    } finally {
        scene.close()
    }
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
                ChartCardContent(d.title, ChartState(d, offline = offline), Modifier.width(380.dp).height(260.dp),
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

fun main(args: Array<String>) {
    val out = File(args.firstOrNull() ?: "build/screenshots").apply { mkdirs() }
    val examples = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "api/examples") }.firstOrNull { it.isDirectory }
    for (dark in listOf(false, true)) {
        val mode = if (dark) "dark" else "light"
        render(File(out, "home-$mode.png"), 1200, 1060) { BoniTheme(dark = dark) { HomePreview() } }
        render(File(out, "widgets-$mode.png"), 1250, 310) { BoniTheme(dark = dark) { WidgetsPreview(offline = false) } }
    }
    render(File(out, "widgets-offline-dark.png"), 1250, 310) { BoniTheme(dark = true) { WidgetsPreview(offline = true) } }
    if (examples != null) {
        // The real server answer for the form, from the contract examples.
        val screen = BoniJson.decodeFromString(Screen.serializer(), File(examples, "screen-capture-expense.json").readText())
        val form = screen.components.filterIsInstance<FormComponent>().first()
        render(File(out, "form-light.png"), 640, 1180) { BoniTheme(dark = false) { FormPreview(form) } }
    }
}
