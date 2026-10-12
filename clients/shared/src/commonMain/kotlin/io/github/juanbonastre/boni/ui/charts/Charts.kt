package io.github.juanbonastre.boni.ui.charts

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.api.ChartPoint
import io.github.juanbonastre.boni.ui.BoniColors
import kotlin.math.max
import kotlin.math.min

/** False when rendering screenshots: charts are drawn in their final state, without the entry animation. */
val LocalAnimateCharts = staticCompositionLocalOf { true }

/**
 * Charts drawn by hand on a Canvas: thin marks, 4dp rounded data-ends anchored to the baseline, hairline grid, one
 * accent per chart, selective labels (value at the tip / end, the rest in the hover tooltip), entry animation.
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
    val points = data.series.firstOrNull()?.points.orEmpty()
    val animate = LocalAnimateCharts.current
    val progress = remember(data.chartId, data.drill) { Animatable(if (animate) 0f else 1f) }
    LaunchedEffect(data) {
        if (animate) {
            progress.snapTo(min(progress.value, 0.35f))
            progress.animateTo(1f, tween(durationMillis = 750, easing = FastOutSlowInEasing))
        }
    }
    var hover by remember { mutableStateOf<Offset?>(null) }
    val measurer = rememberTextMeasurer()
    val canvasModifier = modifier
        .pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    val ev = awaitPointerEvent()
                    hover = if (ev.type == PointerEventType.Exit) null else ev.changes.firstOrNull()?.position
                }
            }
        }
        .pointerInput(points, onSelect) {
            if (onSelect != null) {
                detectTapGestures { pos ->
                    val sz = Size(size.width.toFloat(), size.height.toFloat())
                    val shown = if (data.kind == "hbar") hbarRows(points, sz, density, compact) else points
                    val g = Geometry.of(data.kind, sz, shown.size, density, compact)
                    g.indexAt(pos)?.let { i -> shown[i].takeIf { !it.key.startsWith("_") }?.let(onSelect) }
                }
            }
        }
    Canvas(canvasModifier) {
        val ink = Ink(colors, measurer, compact)
        when (data.kind) {
            "hbar" -> drawHBars(points, ink, accent, progress.value, hover, compact)
            "line" -> drawLineChart(points, data.average, ink, accent, progress.value, hover, compact)
            else -> drawColumns(points, data.average, ink, accent, progress.value, hover, compact)
        }
    }
}

/** Text styles and colors used while drawing. */
private class Ink(val c: BoniColors, val m: TextMeasurer, compact: Boolean) {
    val axis = TextStyle(color = c.muted, fontSize = if (compact) 10.sp else 11.sp)
    val label = TextStyle(color = c.inkSecondary, fontSize = if (compact) 11.sp else 12.sp)
    val value = TextStyle(color = c.ink, fontSize = if (compact) 11.sp else 12.sp, fontWeight = FontWeight.SemiBold)
    val tipTitle = TextStyle(color = c.inkSecondary, fontSize = 11.sp)
    val tipValue = TextStyle(color = c.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
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

private fun DrawScope.tooltip(ink: Ink, anchor: Offset, title: String, value: String) {
    val t = ink.m.measure(title, ink.tipTitle)
    val v = ink.m.measure(value, ink.tipValue)
    val pad = 8.dp.toPx()
    val w = max(t.size.width, v.size.width) + pad * 2
    val h = t.size.height + v.size.height + pad * 2
    var x = anchor.x - w / 2
    x = x.coerceIn(0f, size.width - w)
    var y = anchor.y - h - 8.dp.toPx()
    if (y < 0f) y = anchor.y + 12.dp.toPx()
    drawRoundRect(ink.c.surface, Offset(x, y), Size(w, h), CornerRadius(8.dp.toPx()))
    drawRoundRect(ink.c.baseline, Offset(x, y), Size(w, h), CornerRadius(8.dp.toPx()), style = Stroke(1f))
    drawText(t, topLeft = Offset(x + pad, y + pad))
    drawText(v, topLeft = Offset(x + pad, y + pad + t.size.height))
}

private fun pointTitle(p: ChartPoint): String = when {
    p.noData -> "${p.label}: sin datos"
    p.partial -> "${p.label} (en curso)"
    else -> p.label
}

// ---------- vertical columns (gasto por mes) ----------
private fun DrawScope.drawColumns(
    points: List<ChartPoint>, average: Double?, ink: Ink, accent: Color, progress: Float, hover: Offset?, compact: Boolean,
) {
    val g = Geometry.of("bar", size, points.size, density, compact)
    val ticks = ChartMath.ticks(max(points.maxOfOrNull { it.value } ?: 0.0, average ?: 0.0), if (compact) 3 else 4)
    val top = ticks.last()
    fun y(v: Double) = g.plot.bottom - (v / top).toFloat() * g.plot.height
    ticks.forEach { t ->
        drawLine(if (t == 0.0) ink.c.baseline else ink.c.grid, Offset(g.plot.left, y(t)), Offset(g.plot.right, y(t)), 1f)
        text(ink, ChartMath.compact(t), ink.axis, g.plot.left - 6.dp.toPx(), y(t), alignX = 1f, alignY = 0.5f)
    }
    val hi = hover?.let { g.indexAt(it) }
    val barW = min(24.dp.toPx(), g.band * 0.62f)
    val gap = 2.dp.toPx()
    points.forEachIndexed { i, p ->
        val cx = g.plot.left + g.band * (i + 0.5f)
        if (!compact || i % 2 == (points.size - 1) % 2) {
            text(ink, p.label, ink.axis, cx, g.plot.bottom + 5.dp.toPx(), alignX = 0.5f)
        }
        if (p.noData) {
            drawLine(ink.c.baseline, Offset(cx - barW / 4, g.plot.bottom - gap * 2), Offset(cx + barW / 4, g.plot.bottom - gap * 2),
                2.dp.toPx(), cap = StrokeCap.Round)
            return@forEachIndexed
        }
        val v = max(p.value, 0.0) * progress
        val r = Rect(cx - barW / 2, y(v), cx + barW / 2, g.plot.bottom - 1f)
        val alpha = when {
            hi != null && hi != i -> 0.45f
            p.partial -> 0.55f
            else -> 1f
        }
        if (r.height > 0.5f) drawPath(barPath(r, 4.dp.toPx(), false), accent.copy(alpha = alpha))
    }
    if (average != null && average > 0) {
        val ay = y(average)
        drawLine(ink.c.inkSecondary.copy(alpha = 0.7f), Offset(g.plot.left, ay), Offset(g.plot.right, ay), 1.dp.toPx())
        if (!compact) pill(ink, "media ${ChartMath.eurosAuto(average)}", g.plot.right - 4.dp.toPx(), ay - 3.dp.toPx(), 1f)
    }
    // Direct label: the latest month with data only.
    points.indices.lastOrNull { !points[it].noData }?.let { i ->
        val p = points[i]
        if (hi == null && progress > 0.95f) {
            val cx = g.plot.left + g.band * (i + 0.5f)
            text(ink, ChartMath.eurosAuto(p.value), ink.value, cx, y(p.value) - 3.dp.toPx(), 0.5f, 1f)
        }
    }
    if (hi != null) {
        val p = points[hi]
        val cx = g.plot.left + g.band * (hi + 0.5f)
        tooltip(ink, Offset(cx, y(max(p.value, 0.0))), pointTitle(p), if (p.noData) "-" else ChartMath.euros(p.value))
    }
}

// ---------- horizontal bars (gasto del mes por categoria) ----------
/** Rows that fit: if there are too many for the height, the smallest are folded into one "Resto" row (not tappable). */
private fun hbarRows(points: List<ChartPoint>, size: Size, density: Float, compact: Boolean): List<ChartPoint> {
    val plot = Geometry.of("hbar", size, points.size, density, compact).plot
    val minBand = (if (compact) 20f else 28f) * density
    val maxRows = max(2, (plot.height / minBand).toInt())
    if (points.size <= maxRows) return points
    val rest = points.drop(maxRows - 1)
    return points.take(maxRows - 1) + ChartPoint("_rest", "Resto (${rest.size})", rest.sumOf { it.value })
}

private fun DrawScope.drawHBars(
    points: List<ChartPoint>, ink: Ink, accent: Color, progress: Float, hover: Offset?, compact: Boolean,
) {
    if (points.isEmpty()) {
        text(ink, "Sin gastos este mes", ink.label, size.width / 2, size.height / 2, 0.5f, 0.5f)
        return
    }
    val rows = hbarRows(points, size, density, compact)
    val g = Geometry.of("hbar", size, rows.size, density, compact)
    val top = max(rows.maxOf { it.value }, 1.0)
    val decimals = top < 100
    val barH = min(if (compact) 14.dp.toPx() else 18.dp.toPx(), g.band * 0.7f)
    val hi = hover?.let { g.indexAt(it) }
    drawLine(ink.c.baseline, Offset(g.plot.left, g.plot.top), Offset(g.plot.left, g.plot.bottom), 1f)
    rows.forEachIndexed { i, p ->
        val cy = g.plot.top + g.band * (i + 0.5f)
        val label = ink.m.measure(p.label, ink.label, maxLines = 1)
        val labelX = g.plot.left - 8.dp.toPx() - min(label.size.width.toFloat(), g.plot.left - 12.dp.toPx())
        drawText(label, topLeft = Offset(max(labelX, 2.dp.toPx()), cy - label.size.height / 2))
        val w = (max(p.value, 0.0) / top).toFloat() * g.plot.width * progress
        val r = Rect(g.plot.left + 1f, cy - barH / 2, g.plot.left + 1f + w, cy + barH / 2)
        val alpha = if (hi != null && hi != i) 0.45f else 1f
        if (r.width > 0.5f) drawPath(barPath(r, 4.dp.toPx(), true), accent.copy(alpha = alpha))
        if (progress > 0.6f) {
            text(ink, ChartMath.euros(p.value, decimals), ink.value.copy(color = ink.c.ink.copy(alpha = alpha)),
                r.right + 6.dp.toPx(), cy, alignY = 0.5f)
        }
    }
}

// ---------- line (comida fuera) ----------
private fun DrawScope.drawLineChart(
    points: List<ChartPoint>, average: Double?, ink: Ink, accent: Color, progress: Float, hover: Offset?, compact: Boolean,
) {
    val g = Geometry.of("line", size, points.size, density, compact)
    val ticks = ChartMath.ticks(max(points.maxOfOrNull { it.value } ?: 0.0, average ?: 0.0), if (compact) 3 else 4)
    val top = ticks.last()
    fun y(v: Double) = g.plot.bottom - (v / top).toFloat() * g.plot.height
    fun x(i: Int) = g.plot.left + g.band * (i + 0.5f)
    ticks.forEach { t ->
        drawLine(if (t == 0.0) ink.c.baseline else ink.c.grid, Offset(g.plot.left, y(t)), Offset(g.plot.right, y(t)), 1f)
        text(ink, ChartMath.compact(t), ink.axis, g.plot.left - 6.dp.toPx(), y(t), alignX = 1f, alignY = 0.5f)
    }
    points.forEachIndexed { i, p ->
        if (!compact || i % 2 == (points.size - 1) % 2) text(ink, p.label, ink.axis, x(i), g.plot.bottom + 5.dp.toPx(), 0.5f)
    }
    // Runs of consecutive points with data: gaps (no_data) break the line instead of pretending it was zero.
    val runs = mutableListOf<MutableList<Int>>()
    points.forEachIndexed { i, p ->
        if (p.noData) return@forEachIndexed
        if (runs.isEmpty() || runs.last().last() != i - 1) runs += mutableListOf(i) else runs.last() += i
    }
    val reveal = g.plot.left + (g.plot.width + g.band) * progress
    clipReveal(reveal) {
        runs.forEach { run ->
            val line = Path()
            val area = Path()
            run.forEachIndexed { k, i ->
                val pt = Offset(x(i), y(points[i].value))
                if (k == 0) { line.moveTo(pt.x, pt.y); area.moveTo(pt.x, g.plot.bottom); area.lineTo(pt.x, pt.y) }
                else { line.lineTo(pt.x, pt.y); area.lineTo(pt.x, pt.y) }
            }
            area.lineTo(x(run.last()), g.plot.bottom)
            area.close()
            drawPath(area, accent.copy(alpha = 0.10f))
            drawPath(line, accent, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            // The month in progress is not comparable yet: its segment is faded.
            if (run.size >= 2 && points[run.last()].partial) {
                val a = run[run.size - 2]
                val b = run.last()
                drawLine(ink.c.surface, Offset(x(a), y(points[a].value)), Offset(x(b), y(points[b].value)), 3.dp.toPx(), cap = StrokeCap.Round)
                drawLine(accent.copy(alpha = 0.4f), Offset(x(a), y(points[a].value)), Offset(x(b), y(points[b].value)),
                    2.dp.toPx(), cap = StrokeCap.Round)
            }
            if (run.size == 1) drawCircle(accent, 3.dp.toPx(), Offset(x(run[0]), y(points[run[0]].value)))
        }
    }
    if (average != null && average > 0) {
        val ay = y(average)
        drawLine(ink.c.inkSecondary.copy(alpha = 0.7f), Offset(g.plot.left, ay), Offset(g.plot.right, ay), 1.dp.toPx())
        if (!compact) pill(ink, "media ${ChartMath.eurosAuto(average)}", g.plot.left + 8.dp.toPx(), ay - 3.dp.toPx(), 0f)
    }
    val last = points.indices.lastOrNull { !points[it].noData }
    val hi = hover?.let { g.indexAt(it) }
    if (last != null && progress > 0.95f) {
        val c = Offset(x(last), y(points[last].value))
        drawCircle(ink.c.surface, 6.dp.toPx(), c)
        drawCircle(accent, 4.dp.toPx(), c)
        if (points[last].partial) drawCircle(ink.c.surface, 2.dp.toPx(), c) // hollow: month in progress
        if (hi == null) text(ink, ChartMath.eurosAuto(points[last].value), ink.value, c.x, c.y - 8.dp.toPx(), 0.5f, 1f)
    }
    if (hi != null) {
        val p = points[hi]
        drawLine(ink.c.baseline, Offset(x(hi), g.plot.top), Offset(x(hi), g.plot.bottom), 1f)
        if (!p.noData) {
            drawCircle(ink.c.surface, 6.dp.toPx(), Offset(x(hi), y(p.value)))
            drawCircle(accent, 4.dp.toPx(), Offset(x(hi), y(p.value)))
        }
        tooltip(ink, Offset(x(hi), if (p.noData) g.plot.bottom else y(p.value)), pointTitle(p),
            if (p.noData) "-" else ChartMath.euros(p.value))
    }
}

private inline fun DrawScope.clipReveal(right: Float, crossinline block: DrawScope.() -> Unit) {
    clipRect(left = 0f, top = 0f, right = right, bottom = size.height) { block() }
}
