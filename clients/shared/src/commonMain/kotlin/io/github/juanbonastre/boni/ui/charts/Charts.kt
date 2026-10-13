package io.github.juanbonastre.boni.ui.charts

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.api.ChartPoint
import io.github.juanbonastre.boni.api.ChartSeries
import io.github.juanbonastre.boni.ui.BoniColors
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** False when rendering screenshots: charts are drawn in their final state, without the entry animation. */
val LocalAnimateCharts = staticCompositionLocalOf { true }

private const val REST = "_rest"
private const val OTHER = "_other"

/** Colors of each series, in order: main = the chart's accent, split = categorical slots ("Otros" grey), compare = neutral. */
fun seriesColors(data: ChartData, c: BoniColors, accent: Color): List<Color> {
    var slot = 0
    return data.series.map { s ->
        when {
            s.role == "compare" -> c.compare
            s.role == "split" && s.key == OTHER -> c.muted
            s.role == "split" -> c.categorical[slot++ % c.categorical.size]
            else -> accent
        }
    }
}

/** Donut slices: categorical slots by position, the folded rest in grey. */
fun sliceColors(points: List<ChartPoint>, c: BoniColors): List<Color> {
    var slot = 0
    return points.map { if (it.key == REST) c.muted else c.categorical[slot++ % c.categorical.size] }
}

/** Slices actually drawn by a donut (positive values only). */
internal fun donutPoints(data: ChartData): List<ChartPoint> = data.series.firstOrNull()?.points.orEmpty().filter { it.value > 0 }

/**
 * Charts drawn by hand on a Canvas: thin marks, 4dp rounded data-ends anchored to the baseline, hairline grid, selective
 * labels (value at the tip / end, the rest in the hover tooltip), entry animation. Kinds: bar, stacked_bar, hbar, line,
 * area, donut (canvas); number and table (plain layout).
 */
@Composable
fun Chart(
    data: ChartData,
    colors: BoniColors,
    accent: Color,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onSelect: ((ChartPoint) -> Unit)? = null,
) {
    val palette = seriesColors(data, colors, accent)
    when (data.kind) {
        "number" -> NumberTile(data, colors, modifier, compact)
        "table" -> ChartTable(data, colors, palette, modifier, compact, onSelect)
        else -> CanvasChart(data, colors, palette, modifier, compact, onSelect)
    }
}

@Composable
private fun CanvasChart(
    data: ChartData,
    colors: BoniColors,
    palette: List<Color>,
    modifier: Modifier,
    compact: Boolean,
    onSelect: ((ChartPoint) -> Unit)?,
) {
    val animate = LocalAnimateCharts.current
    // Animate on first appearance and when the NUMBERS change. A refresh that brings the same values (every answer has a
    // new computed_at) draws nothing new; changed values glide from the old ones instead of growing again from zero.
    val anim = remember(data.chartId, data.drill, data.kind) { ChartAnim(animate) }
    val keys = data.series.flatMap { s -> s.points.map { s.key + "|" + it.key } }
    val values = data.series.flatMap { s -> s.points.map { it.value } }
    LaunchedEffect(keys, values) { anim.update(keys, values) }
    var hover by remember { mutableStateOf<Offset?>(null) }
    val measurer = rememberTextMeasurer()
    val currentData by rememberUpdatedState(data)
    val currentOnSelect by rememberUpdatedState(onSelect)
    val canvasModifier = modifier
        .pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    val ev = awaitPointerEvent()
                    val pos = if (ev.type == PointerEventType.Exit) null else ev.changes.firstOrNull()?.position
                    if (pos != hover) hover = pos
                }
            }
        }
        .pointerInput(Unit) {
            detectTapGestures { pos ->
                val select = currentOnSelect ?: return@detectTapGestures
                val sz = Size(size.width.toFloat(), size.height.toFloat())
                hitTest(currentData, sz, density, compact, pos)?.takeIf { !it.key.startsWith("_") }?.let(select)
            }
        }
    Canvas(canvasModifier) {
        val ink = Ink(colors, measurer, compact, data.unit)
        val series = anim.apply(data.series)
        val progress = anim.entry
        when (data.kind) {
            "hbar" -> drawHBars(series, palette, ink, progress, hover)
            "line" -> drawLines(series, palette, data.average, ink, progress, hover, filled = false)
            "area" -> drawLines(series, palette, data.average, ink, progress, hover, filled = true)
            "donut" -> drawDonut(series.firstOrNull()?.points.orEmpty().filter { it.value > 0 }, ink, progress, hover)
            "stacked_bar" -> drawColumns(series, palette, null, ink, progress, hover, stacked = true)
            else -> drawColumns(series, palette, data.average, ink, progress, hover, stacked = false)
        }
    }
}

private fun hitTest(data: ChartData, size: Size, density: Float, compact: Boolean, pos: Offset): ChartPoint? {
    val main = data.series.firstOrNull { it.role != "compare" }?.points ?: return null
    return when (data.kind) {
        "hbar" -> {
            val cmp = data.series.firstOrNull { it.role == "compare" }?.points
            val rows = hbarRows(main, cmp, size, density, compact)
            Geometry.of("hbar", size, rows.size, density, compact).indexAt(pos)?.let { rows[it].first }
        }
        "donut" -> {
            val pts = donutPoints(data)
            Donut.of(size, density).indexAt(pts, pos)?.let { pts[it] }
        }
        else -> Geometry.of(data.kind, size, main.size, density, compact).indexAt(pos)?.let { main.getOrNull(it) }
    }
}

/**
 * Animation state of one chart (all its series flattened). `entry` (0..1) drives the first reveal (bars grow, lines are
 * drawn, labels appear at the end); later value changes interpolate each point from what was on screen to the new value.
 */
internal class ChartAnim(private val enabled: Boolean) {
    private val t = Animatable(if (enabled) 0f else 1f)
    private var entered by mutableStateOf(!enabled)
    private var keys by mutableStateOf<List<String>?>(null)
    private var start by mutableStateOf<List<Double>>(emptyList())
    private var target by mutableStateOf<List<Double>>(emptyList())

    val entry: Float get() = if (entered) 1f else t.value

    private fun valueAt(i: Int, fallback: Double): Double {
        if (i >= target.size) return fallback
        val from = start.getOrElse(i) { 0.0 }
        return if (entered) from + (target[i] - from) * t.value else target[i]  // entry: scaling is done by `entry`
    }

    fun apply(series: List<ChartSeries>): List<ChartSeries> {
        val flat = series.flatMap { s -> s.points.map { s.key + "|" + it.key } }
        if (keys != flat) return series
        var i = 0
        return series.map { s -> s.copy(points = s.points.map { p -> p.copy(value = valueAt(i++, p.value)) }) }
    }

    suspend fun update(newKeys: List<String>, newValues: List<Double>) {
        if (newKeys == keys && newValues == target) return
        val sameRows = newKeys == keys && entered
        if (!enabled) {
            keys = newKeys; start = newValues; target = newValues
            return
        }
        if (sameRows) {
            start = newValues.indices.map { valueAt(it, newValues[it]) }
            target = newValues
            t.snapTo(0f)
            t.animateTo(1f, tween(durationMillis = 450, easing = FastOutSlowInEasing))
        } else {
            keys = newKeys; start = newValues; target = newValues
            entered = false
            t.snapTo(0f)
            t.animateTo(1f, tween(durationMillis = 750, easing = FastOutSlowInEasing))
            entered = true
            start = newValues  // later changes start from here
        }
    }
}

/** Text styles, colors and number format used while drawing. */
private class Ink(val c: BoniColors, val m: TextMeasurer, val compact: Boolean, val unit: String) {
    val axis = TextStyle(color = c.muted, fontSize = if (compact) 10.sp else 11.sp)
    val label = TextStyle(color = c.inkSecondary, fontSize = if (compact) 11.sp else 12.sp)
    val value = TextStyle(color = c.ink, fontSize = if (compact) 11.sp else 12.sp, fontWeight = FontWeight.SemiBold)
    val tipTitle = TextStyle(color = c.inkSecondary, fontSize = 11.sp)
    val tipValue = TextStyle(color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    val tipLine = TextStyle(color = c.ink, fontSize = 12.sp)
    fun fmt(v: Double, decimals: Boolean = true) = ChartMath.format(v, unit, decimals)
    fun auto(v: Double) = ChartMath.formatAuto(v, unit)
}

/** Plot area and hit-testing shared by drawing and tapping. */
private class Geometry(val plot: Rect, val n: Int, val horizontal: Boolean) {
    val band: Float get() = if (n == 0) 0f else (if (horizontal) plot.height else plot.width) / n

    fun indexAt(p: Offset): Int? {
        if (n == 0) return null
        val i = if (horizontal) ((p.y - plot.top) / band).toInt() else ((p.x - plot.left) / band).toInt()
        val inside = if (horizontal) p.y in plot.top..plot.bottom else p.x in plot.left..plot.right
        return if (inside) i.coerceIn(0, n - 1) else null
    }

    companion object {
        fun of(kind: String, size: Size, n: Int, density: Float, compact: Boolean): Geometry {
            val dp = { v: Float -> v * density }
            return if (kind == "hbar") {
                val left = dp(if (compact) 92f else 120f)
                Geometry(Rect(left, dp(4f), size.width - dp(if (compact) 64f else 76f), size.height - dp(4f)), n, true)
            } else {
                Geometry(Rect(dp(if (compact) 30f else 38f), dp(14f), size.width - dp(if (compact) 8f else 12f),
                    size.height - dp(22f)), n, false)
            }
        }
    }
}

private fun DrawScope.text(ink: Ink, s: String, style: TextStyle, x: Float, y: Float, alignX: Float = 0f, alignY: Float = 0f) {
    val r = ink.m.measure(s, style)
    drawText(r, topLeft = Offset(x - r.size.width * alignX, y - r.size.height * alignY))
}

private fun DrawScope.empty(ink: Ink) {
    text(ink, "Sin datos en este periodo", ink.label, size.width / 2, size.height / 2, 0.5f, 0.5f)
}

/** Rounded at the data end, square at the baseline. */
private fun barPath(r: Rect, radius: Float, horizontal: Boolean): Path {
    val cr = CornerRadius(min(radius, min(r.width, r.height) / 2f))
    val rr = if (horizontal) {
        RoundRect(r, topLeft = CornerRadius.Zero, topRight = cr, bottomRight = cr, bottomLeft = CornerRadius.Zero)
    } else {
        RoundRect(r, topLeft = cr, topRight = cr, bottomRight = CornerRadius.Zero, bottomLeft = CornerRadius.Zero)
    }
    return Path().apply { addRoundRect(rr) }
}

/** Small label on a surface-colored pill (readable when it crosses bars or the line). */
private fun DrawScope.pill(ink: Ink, s: String, x: Float, y: Float, alignX: Float) {
    val r = ink.m.measure(s, ink.axis)
    val padX = 4.dp.toPx()
    val left = x - r.size.width * alignX
    val top = y - r.size.height
    drawRoundRect(ink.c.surface.copy(alpha = 0.92f), Offset(left - padX, top - 1.dp.toPx()),
        Size(r.size.width + padX * 2, r.size.height + 2.dp.toPx()), CornerRadius(4.dp.toPx()))
    drawText(r, topLeft = Offset(left, top))
}

/** Hover card: a title and one line per series (with its color dot when there are several). */
private fun DrawScope.tooltip(ink: Ink, anchor: Offset, title: String, lines: List<Pair<String, Color?>>) {
    val t = ink.m.measure(title, ink.tipTitle)
    val single = lines.size == 1 && lines[0].second == null
    val measured = lines.map { (s, color) -> ink.m.measure(s, if (single) ink.tipValue else ink.tipLine) to color }
    val pad = 8.dp.toPx()
    val dot = if (single) 0f else 12.dp.toPx()
    val w = max(t.size.width.toFloat(), (measured.maxOfOrNull { it.first.size.width } ?: 0) + dot) + pad * 2
    val h = t.size.height + measured.sumOf { it.first.size.height } + pad * 2
    val x = (anchor.x - w / 2).coerceIn(0f, max(0f, size.width - w))
    var y = anchor.y - h - 8.dp.toPx()
    if (y < 0f) y = min(anchor.y + 12.dp.toPx(), max(0f, size.height - h))
    drawRoundRect(ink.c.surface, Offset(x, y), Size(w, h), CornerRadius(8.dp.toPx()))
    drawRoundRect(ink.c.baseline, Offset(x, y), Size(w, h), CornerRadius(8.dp.toPx()), style = Stroke(1f))
    drawText(t, topLeft = Offset(x + pad, y + pad))
    var ly = y + pad + t.size.height
    measured.forEach { (r, color) ->
        if (color != null) drawCircle(color, 4.dp.toPx(), Offset(x + pad + 4.dp.toPx(), ly + r.size.height / 2f))
        drawText(r, topLeft = Offset(x + pad + dot, ly))
        ly += r.size.height
    }
}

private fun pointTitle(p: ChartPoint): String = when {
    p.noData -> "${p.label}: sin datos"
    p.partial -> "${p.label} (en curso)"
    else -> p.label
}

/** Tooltip lines for x position [i]: the value, or one line per series (and the total of a stack). */
private fun tipLines(series: List<ChartSeries>, palette: List<Color>, i: Int, ink: Ink, stacked: Boolean): List<Pair<String, Color?>> {
    val main = series.firstOrNull()?.points?.getOrNull(i) ?: return emptyList()
    if (main.noData) return listOf("-" to null)
    if (series.size == 1) return listOf(ink.fmt(main.value) to null)
    val lines: MutableList<Pair<String, Color?>> = series.mapIndexedNotNull { si, s ->
        s.points.getOrNull(i)?.let { p -> "${s.name}: ${ink.fmt(p.value)}" to palette[si] }
    }.toMutableList()
    if (stacked) lines += "Total: ${ink.fmt(series.sumOf { it.points.getOrNull(i)?.value ?: 0.0 })}" to null
    return lines
}

private fun DrawScope.yAxis(ink: Ink, g: Geometry, ticks: List<Double>, y: (Double) -> Float) {
    ticks.forEach { t ->
        drawLine(if (t == 0.0) ink.c.baseline else ink.c.grid, Offset(g.plot.left, y(t)), Offset(g.plot.right, y(t)), 1f)
        text(ink, ChartMath.compact(t), ink.axis, g.plot.left - 6.dp.toPx(), y(t), alignX = 1f, alignY = 0.5f)
    }
}

/** X labels that fit: every k-th one, always including the last. */
private fun DrawScope.xLabels(ink: Ink, g: Geometry, points: List<ChartPoint>) {
    val maxLabels = max(2, (g.plot.width / (if (ink.compact) 36.dp.toPx() else 44.dp.toPx())).toInt())
    val step = ChartMath.labelStep(points.size, maxLabels)
    points.forEachIndexed { i, p ->
        if ((points.size - 1 - i) % step == 0) {
            text(ink, p.label, ink.axis, g.plot.left + g.band * (i + 0.5f), g.plot.bottom + 5.dp.toPx(), alignX = 0.5f)
        }
    }
}

private fun DrawScope.averageLine(ink: Ink, g: Geometry, average: Double?, y: (Double) -> Float, labelRight: Boolean) {
    if (average == null || average <= 0) return
    val ay = y(average)
    drawLine(ink.c.inkSecondary.copy(alpha = 0.7f), Offset(g.plot.left, ay), Offset(g.plot.right, ay), 1.dp.toPx())
    if (!ink.compact) {
        if (labelRight) pill(ink, "media ${ink.auto(average)}", g.plot.right - 4.dp.toPx(), ay - 3.dp.toPx(), 1f)
        else pill(ink, "media ${ink.auto(average)}", g.plot.left + 8.dp.toPx(), ay - 3.dp.toPx(), 0f)
    }
}

// ---------- vertical columns: one series, grouped series (split or compare) or stacked ----------
private fun DrawScope.drawColumns(
    series: List<ChartSeries>, palette: List<Color>, average: Double?, ink: Ink, progress: Float, hover: Offset?, stacked: Boolean,
) {
    val main = series.firstOrNull()?.points.orEmpty()
    val n = main.size
    if (n == 0) return empty(ink)
    val g = Geometry.of("bar", size, n, density, ink.compact)
    val maxV = if (stacked) {
        (0 until n).maxOf { i -> series.sumOf { s -> max(s.points.getOrNull(i)?.value ?: 0.0, 0.0) } }
    } else {
        series.maxOf { s -> s.points.maxOfOrNull { it.value } ?: 0.0 }
    }
    val ticks = ChartMath.ticks(max(maxV, average ?: 0.0), if (ink.compact) 3 else 4)
    val top = ticks.last()
    val y = { v: Double -> g.plot.bottom - (v / top).toFloat() * g.plot.height }
    yAxis(ink, g, ticks, y)
    xLabels(ink, g, main)
    val hi = hover?.let { g.indexAt(it) }
    val groups = if (stacked) 1 else series.size
    val groupW = min(if (groups == 1) 24.dp.toPx() else 12.dp.toPx() * groups, g.band * 0.72f)
    val gap = if (groups > 1) min(2.dp.toPx(), groupW / groups / 4f) else 0f
    val barW = (groupW - gap * (groups - 1)) / groups
    for (i in 0 until n) {
        val p0 = main[i]
        val cx = g.plot.left + g.band * (i + 0.5f)
        if (p0.noData) {
            drawLine(ink.c.baseline, Offset(cx - groupW / 4, g.plot.bottom - 4.dp.toPx()), Offset(cx + groupW / 4, g.plot.bottom - 4.dp.toPx()),
                2.dp.toPx(), cap = StrokeCap.Round)
            continue
        }
        val alpha = when {
            hi != null && hi != i -> 0.45f
            p0.partial -> 0.55f
            else -> 1f
        }
        if (stacked) {
            var base = 0.0
            val visible = series.indices.filter { (series[it].points.getOrNull(i)?.value ?: 0.0) > 0.0 }
            visible.forEachIndexed { k, si ->
                val v = series[si].points[i].value
                val r = Rect(cx - barW / 2, y((base + v) * progress), cx + barW / 2, y(base * progress) - (if (k == 0) 1f else 0f))
                if (r.height > 0.5f) {
                    val color = palette[si].copy(alpha = alpha)
                    if (k == visible.lastIndex) drawPath(barPath(r, 4.dp.toPx(), false), color) else drawRect(color, r.topLeft, r.size)
                    // a hairline of the surface between segments keeps neighbours apart
                    if (k > 0) drawLine(ink.c.surface, Offset(r.left, r.bottom), Offset(r.right, r.bottom), 1.dp.toPx())
                }
                base += v
            }
        } else {
            series.forEachIndexed { si, s ->
                val p = s.points.getOrNull(i) ?: return@forEachIndexed
                val left = cx - groupW / 2 + si * (barW + gap)
                val r = Rect(left, y(max(p.value, 0.0) * progress), left + barW, g.plot.bottom - 1f)
                if (r.height > 0.5f) drawPath(barPath(r, min(4.dp.toPx(), barW / 2), false), palette[si].copy(alpha = alpha))
            }
        }
    }
    if (series.size == 1) averageLine(ink, g, average, y, labelRight = true)
    // Direct label: the latest value with data, when there is a single series.
    if (series.size == 1 && hi == null && progress > 0.95f) {
        main.indices.lastOrNull { !main[it].noData }?.let { i ->
            val cx = g.plot.left + g.band * (i + 0.5f)
            text(ink, ink.auto(main[i].value), ink.value, cx, y(max(main[i].value, 0.0)) - 3.dp.toPx(), 0.5f, 1f)
        }
    }
    if (hi != null) {
        val cx = g.plot.left + g.band * (hi + 0.5f)
        val stackTop = if (stacked) series.sumOf { max(it.points.getOrNull(hi)?.value ?: 0.0, 0.0) }
        else series.maxOf { max(it.points.getOrNull(hi)?.value ?: 0.0, 0.0) }
        tooltip(ink, Offset(cx, y(stackTop)), pointTitle(main[hi]), tipLines(series, palette, hi, ink, stacked))
    }
}

// ---------- horizontal bars (rankings), with a tick for the compared period ----------
/** Rows that fit: if there are too many for the height, the smallest are folded into one "Resto" row (not tappable). */
private fun hbarRows(
    main: List<ChartPoint>, compare: List<ChartPoint>?, size: Size, density: Float, compact: Boolean,
): List<Pair<ChartPoint, ChartPoint?>> {
    val plot = Geometry.of("hbar", size, main.size, density, compact).plot
    val minBand = (if (compact) 20f else 28f) * density
    val maxRows = max(2, (plot.height / minBand).toInt())
    val pairs = main.mapIndexed { i, p -> p to compare?.getOrNull(i) }
    if (pairs.size <= maxRows) return pairs
    val rest = pairs.drop(maxRows - 1)
    val label = "Resto (${rest.size})"
    val restCmp = if (compare != null) ChartPoint(REST, label, rest.sumOf { it.second?.value ?: 0.0 }) else null
    return pairs.take(maxRows - 1) + (ChartPoint(REST, label, rest.sumOf { it.first.value }) to restCmp)
}

private fun DrawScope.drawHBars(series: List<ChartSeries>, palette: List<Color>, ink: Ink, progress: Float, hover: Offset?) {
    val mainIdx = series.indexOfFirst { it.role != "compare" }.coerceAtLeast(0)
    val main = series.getOrNull(mainIdx)?.points.orEmpty()
    val cmpSeries = series.firstOrNull { it.role == "compare" }
    if (main.isEmpty()) return empty(ink)
    val rows = hbarRows(main, cmpSeries?.points, size, density, ink.compact)
    val g = Geometry.of("hbar", size, rows.size, density, ink.compact)
    val top = max(rows.maxOf { max(it.first.value, it.second?.value ?: 0.0) }, 1.0)
    val decimals = top < 100
    val barH = min(if (ink.compact) 14.dp.toPx() else 18.dp.toPx(), g.band * 0.7f)
    val hi = hover?.let { g.indexAt(it) }
    val accent = palette.getOrElse(mainIdx) { ink.c.series1 }
    drawLine(ink.c.baseline, Offset(g.plot.left, g.plot.top), Offset(g.plot.left, g.plot.bottom), 1f)
    rows.forEachIndexed { i, (p, prev) ->
        val cy = g.plot.top + g.band * (i + 0.5f)
        val labelMax = (g.plot.left - 12.dp.toPx()).toInt().coerceAtLeast(1)
        val label = ink.m.measure(p.label, ink.label, overflow = TextOverflow.Ellipsis, maxLines = 1,
            constraints = Constraints(maxWidth = labelMax))
        drawText(label, topLeft = Offset(g.plot.left - 8.dp.toPx() - label.size.width, cy - label.size.height / 2))
        val w = (max(p.value, 0.0) / top).toFloat() * g.plot.width * progress
        val r = Rect(g.plot.left + 1f, cy - barH / 2, g.plot.left + 1f + w, cy + barH / 2)
        val alpha = if (hi != null && hi != i) 0.45f else 1f
        val color = if (p.key == REST) ink.c.muted else accent
        if (r.width > 0.5f) drawPath(barPath(r, 4.dp.toPx(), true), color.copy(alpha = alpha))
        if (prev != null && progress > 0.6f) {
            val px = g.plot.left + 1f + (max(prev.value, 0.0) / top).toFloat() * g.plot.width
            drawLine(ink.c.ink.copy(alpha = 0.6f * alpha), Offset(px, cy - barH / 2 - 3.dp.toPx()), Offset(px, cy + barH / 2 + 3.dp.toPx()),
                2.dp.toPx(), cap = StrokeCap.Round)
        }
        if (progress > 0.6f) {
            val end = max(r.right, if (prev != null) g.plot.left + (max(prev.value, 0.0) / top).toFloat() * g.plot.width else 0f)
            text(ink, ink.fmt(p.value, decimals), ink.value.copy(color = ink.c.ink.copy(alpha = alpha)), end + 6.dp.toPx(), cy, alignY = 0.5f)
        }
    }
    if (hi != null && cmpSeries != null) {
        val (p, prev) = rows[hi]
        val cy = g.plot.top + g.band * (hi + 0.5f)
        tooltip(ink, Offset(g.plot.left + g.plot.width / 2, cy - barH / 2), p.label,
            listOf(ink.fmt(p.value) to accent, "${cmpSeries.name}: ${ink.fmt(prev?.value ?: 0.0)}" to ink.c.compare))
    }
}

// ---------- lines and areas: one or several series, the compared period dashed ----------
private fun DrawScope.drawLines(
    series: List<ChartSeries>, palette: List<Color>, average: Double?, ink: Ink, progress: Float, hover: Offset?, filled: Boolean,
) {
    val main = series.firstOrNull()?.points.orEmpty()
    val n = main.size
    if (n == 0) return empty(ink)
    val g = Geometry.of("line", size, n, density, ink.compact)
    val maxV = series.maxOf { s -> s.points.maxOfOrNull { it.value } ?: 0.0 }
    val ticks = ChartMath.ticks(max(maxV, average ?: 0.0), if (ink.compact) 3 else 4)
    val top = ticks.last()
    val y = { v: Double -> g.plot.bottom - (max(v, 0.0) / top).toFloat() * g.plot.height }
    val x = { i: Int -> g.plot.left + g.band * (i + 0.5f) }
    yAxis(ink, g, ticks, y)
    xLabels(ink, g, main)
    val drawn = series.count { it.role != "compare" }
    // The compared period first (behind); then the series from last to first, so the largest one is on top.
    val order = series.indices.sortedBy { if (series[it].role == "compare") -1 else series.size - it }
    val reveal = g.plot.left + (g.plot.width + g.band) * progress
    clipRect(left = 0f, top = 0f, right = reveal, bottom = size.height) {
        order.forEach { si ->
            val s = series[si]
            val pts = s.points
            val color = palette[si]
            val dashed = s.role == "compare"
            val fill = when {
                dashed -> 0f
                filled -> if (drawn == 1) 0.16f else 0.10f
                drawn == 1 -> 0.10f
                else -> 0f
            }
            // Runs of consecutive points with data: gaps (no_data) break the line instead of pretending it was zero.
            val runs = mutableListOf<MutableList<Int>>()
            pts.forEachIndexed { i, p ->
                if (p.noData) return@forEachIndexed
                if (runs.isEmpty() || runs.last().last() != i - 1) runs += mutableListOf(i) else runs.last() += i
            }
            runs.forEach { run ->
                val line = Path()
                val area = Path()
                run.forEachIndexed { k, i ->
                    val pt = Offset(x(i), y(pts[i].value))
                    if (k == 0) { line.moveTo(pt.x, pt.y); area.moveTo(pt.x, g.plot.bottom); area.lineTo(pt.x, pt.y) }
                    else { line.lineTo(pt.x, pt.y); area.lineTo(pt.x, pt.y) }
                }
                area.lineTo(x(run.last()), g.plot.bottom)
                area.close()
                if (fill > 0f) drawPath(area, color.copy(alpha = fill))
                drawPath(line, color, style = Stroke(
                    width = if (dashed) 1.5.dp.toPx() else 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round,
                    pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())) else null,
                ))
                // The period in progress is not comparable yet: its segment is faded.
                if (!dashed && run.size >= 2 && pts[run.last()].partial) {
                    val a = run[run.size - 2]
                    val b = run.last()
                    drawLine(ink.c.surface, Offset(x(a), y(pts[a].value)), Offset(x(b), y(pts[b].value)), 3.dp.toPx(), cap = StrokeCap.Round)
                    drawLine(color.copy(alpha = 0.4f), Offset(x(a), y(pts[a].value)), Offset(x(b), y(pts[b].value)),
                        2.dp.toPx(), cap = StrokeCap.Round)
                }
                if (run.size == 1) drawCircle(color, 3.dp.toPx(), Offset(x(run[0]), y(pts[run[0]].value)))
            }
        }
    }
    if (drawn == 1) averageLine(ink, g, average, y, labelRight = false)
    val hi = hover?.let { g.indexAt(it) }
    val last = main.indices.lastOrNull { !main[it].noData }
    if (drawn == 1 && last != null && progress > 0.95f) {
        val c = Offset(x(last), y(main[last].value))
        drawCircle(ink.c.surface, 6.dp.toPx(), c)
        drawCircle(palette[0], 4.dp.toPx(), c)
        if (main[last].partial) drawCircle(ink.c.surface, 2.dp.toPx(), c) // hollow: period in progress
        if (hi == null) text(ink, ink.auto(main[last].value), ink.value, c.x, c.y - 8.dp.toPx(), 0.5f, 1f)
    }
    if (hi != null) {
        val p = main[hi]
        drawLine(ink.c.baseline, Offset(x(hi), g.plot.top), Offset(x(hi), g.plot.bottom), 1f)
        series.forEachIndexed { si, s ->
            val q = s.points.getOrNull(hi) ?: return@forEachIndexed
            if (q.noData) return@forEachIndexed
            drawCircle(ink.c.surface, 5.dp.toPx(), Offset(x(hi), y(q.value)))
            drawCircle(palette[si], 3.5.dp.toPx(), Offset(x(hi), y(q.value)))
        }
        val anchorV = series.maxOf { it.points.getOrNull(hi)?.takeIf { q -> !q.noData }?.value ?: 0.0 }
        tooltip(ink, Offset(x(hi), if (p.noData) g.plot.bottom else y(anchorV)), pointTitle(p), tipLines(series, palette, hi, ink, false))
    }
}

// ---------- donut: share of a total, legend at the side when there is room ----------
private class Donut(val center: Offset, val radius: Float, val thickness: Float, val legendLeft: Float?) {
    /** Index of the slice under [p] (on the ring, with some margin), or null. */
    fun indexAt(points: List<ChartPoint>, p: Offset): Int? {
        val total = points.sumOf { it.value }
        if (total <= 0) return null
        val dx = p.x - center.x
        val dy = p.y - center.y
        val dist = sqrt(dx * dx + dy * dy)
        if (dist < radius - thickness / 2 - 8f || dist > radius + thickness / 2 + 8f) return null
        val deg = ((atan2(dy, dx) * 180.0 / PI) + 90.0 + 360.0) % 360.0
        var acc = 0.0
        points.forEachIndexed { i, pt ->
            acc += pt.value / total * 360.0
            if (deg <= acc) return i
        }
        return points.lastIndex
    }

    companion object {
        fun of(size: Size, density: Float): Donut {
            val withLegend = size.width > size.height * 1.5f
            val d = if (withLegend) min(size.height, size.width * 0.45f) else min(size.width, size.height)
            val thickness = d * 0.16f
            val radius = d / 2 - thickness / 2 - 2 * density
            val center = if (withLegend) Offset(d / 2, size.height / 2) else Offset(size.width / 2, size.height / 2)
            return Donut(center, radius, thickness, if (withLegend) d + 16 * density else null)
        }
    }
}

private fun DrawScope.drawDonut(points: List<ChartPoint>, ink: Ink, progress: Float, hover: Offset?) {
    val total = points.sumOf { it.value }
    if (points.isEmpty() || total <= 0) return empty(ink)
    val colors = sliceColors(points, ink.c)
    val d = Donut.of(size, density)
    val hi = hover?.let { d.indexAt(points, it) }
    var start = -90f
    val gapDeg = if (points.size > 1) 1.2f else 0f
    points.forEachIndexed { i, p ->
        val sweep = (p.value / total * 360.0).toFloat() * progress
        val alpha = if (hi != null && hi != i) 0.4f else 1f
        drawArc(colors[i].copy(alpha = alpha), start + gapDeg / 2, max(sweep - gapDeg, 0.1f), useCenter = false,
            topLeft = Offset(d.center.x - d.radius, d.center.y - d.radius), size = Size(d.radius * 2, d.radius * 2),
            style = Stroke(d.thickness, cap = StrokeCap.Butt))
        start += sweep
    }
    // Center: the hovered slice, or the total.
    val (title, value) = if (hi != null) {
        val p = points[hi]
        "${p.label} - ${ChartMath.number(p.value / total * 100)} %" to ink.auto(p.value)
    } else "Total" to ink.auto(total)
    if (progress > 0.6f) {
        val inner = ((d.radius - d.thickness / 2) * 1.7f).toInt().coerceAtLeast(1)
        val t = ink.m.measure(title, ink.tipTitle, overflow = TextOverflow.Ellipsis, maxLines = 1, constraints = Constraints(maxWidth = inner))
        val v = ink.m.measure(value, ink.tipValue, maxLines = 1)
        drawText(t, topLeft = Offset(d.center.x - t.size.width / 2f, d.center.y - t.size.height))
        drawText(v, topLeft = Offset(d.center.x - v.size.width / 2f, d.center.y))
    }
    val left = d.legendLeft ?: return
    val rowH = (if (ink.compact) 18 else 22).dp.toPx()
    val rows = min(points.size, (size.height / rowH).toInt())
    var y = size.height / 2 - rows * rowH / 2
    for (i in 0 until rows) {
        val p = points[i]
        val alpha = if (hi != null && hi != i) 0.5f else 1f
        drawCircle(colors[i].copy(alpha = alpha), 4.dp.toPx(), Offset(left + 4.dp.toPx(), y + rowH / 2))
        val pct = ink.m.measure("${ChartMath.number(p.value / total * 100)} %", ink.axis)
        val v = ink.m.measure(ink.auto(p.value), ink.value.copy(color = ink.c.ink.copy(alpha = alpha)))
        val labelW = (size.width - left - 14.dp.toPx() - v.size.width - pct.size.width - 16.dp.toPx()).toInt().coerceAtLeast(1)
        val l = ink.m.measure(p.label, ink.label.copy(color = ink.c.inkSecondary.copy(alpha = alpha)), overflow = TextOverflow.Ellipsis,
            maxLines = 1, constraints = Constraints(maxWidth = labelW))
        drawText(l, topLeft = Offset(left + 14.dp.toPx(), y + (rowH - l.size.height) / 2))
        drawText(pct, topLeft = Offset(size.width - pct.size.width, y + (rowH - pct.size.height) / 2))
        drawText(v, topLeft = Offset(size.width - pct.size.width - 8.dp.toPx() - v.size.width, y + (rowH - v.size.height) / 2))
        y += rowH
    }
}

// ---------- number: one big figure and its change ----------
@Composable
private fun NumberTile(data: ChartData, c: BoniColors, modifier: Modifier, compact: Boolean) {
    val compare = data.series.firstOrNull { it.role == "compare" }
    Column(modifier, verticalArrangement = Arrangement.Center) {
        Text(ChartMath.formatAuto(data.total ?: 0.0, data.unit), color = c.ink, fontWeight = FontWeight.Bold,
            fontSize = if (compact) 30.sp else 40.sp)
        val delta = data.deltaPct
        if (delta != null) {
            // Spending going up is bad news, income going up is good; counts are neutral.
            val good = when (data.measure) {
                "income" -> delta > 0
                "count" -> null
                else -> delta < 0
            }
            val color = when (good) {
                true -> c.good
                false -> c.critical
                null -> c.inkSecondary
            }
            Text("${ChartMath.percent(delta)} frente a ${compare?.name ?: "el periodo anterior"}", color = color,
                fontSize = if (compact) 12.sp else 14.sp, fontWeight = FontWeight.SemiBold)
        }
        if (data.previousTotal != null) {
            Text("${compare?.name?.replaceFirstChar { it.uppercase() } ?: "Antes"}: ${ChartMath.formatAuto(data.previousTotal, data.unit)}",
                color = c.muted, fontSize = 12.sp)
        }
    }
}

// ---------- table: the exact values ----------
@Composable
private fun ChartTable(
    data: ChartData, c: BoniColors, palette: List<Color>, modifier: Modifier, compact: Boolean, onSelect: ((ChartPoint) -> Unit)?,
) {
    val series = data.series
    val main = series.firstOrNull()?.points.orEmpty()
    val size = if (compact) 11.sp else 12.sp
    val fmt = { v: Double -> ChartMath.format(v, data.unit) }
    Column(modifier.verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(data.xLabel ?: "", color = c.muted, fontSize = size, modifier = Modifier.weight(1.4f))
            series.forEachIndexed { si, s ->
                val name = if (series.size == 1) (if (data.unit == "EUR") "Importe" else "Numero") else s.name
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    if (series.size > 1) Box(Modifier.padding(end = 4.dp).height(8.dp).background(palette[si]).padding(horizontal = 4.dp))
                    Text(name, color = c.muted, fontSize = size, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.End)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.baseline))
        main.forEachIndexed { i, p ->
            val clickable = onSelect != null && !p.key.startsWith("_")
            Row(
                (if (clickable) Modifier.clickable { onSelect?.invoke(p) } else Modifier).fillMaxWidth().padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(pointTitle(p), color = c.inkSecondary, fontSize = size, modifier = Modifier.weight(1.4f), maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
                series.forEach { s ->
                    val q = s.points.getOrNull(i)
                    Text(if (q == null || q.noData) "-" else fmt(q.value), color = c.ink, fontSize = size, textAlign = TextAlign.End,
                        modifier = Modifier.weight(1f), maxLines = 1)
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(c.grid))
        }
    }
}
