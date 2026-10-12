package io.github.juanbonastre.boni.ui.charts

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToLong

/** Pure helpers for axes and number formats (unit-tested; no Compose). */
object ChartMath {
    /** Clean axis ticks from 0 up to at least [max]: 0, 50, 100, 150 ... about [count] steps. */
    fun ticks(max: Double, count: Int = 4): List<Double> {
        if (max <= 0.0 || max.isNaN()) return listOf(0.0, 1.0)
        val raw = max / count
        val mag = 10.0.pow(floor(log10(raw)))
        val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.first { it >= raw }
        val n = ceil(max / step - 1e-9).toInt().coerceAtLeast(1)
        return (0..n).map { it * step }
    }

    /** Spanish money format: "1.234,56 €", or without decimals ("1.235 €") when [decimals] is false. */
    fun euros(value: Double, decimals: Boolean = true): String {
        val neg = value < 0
        val cents = (abs(value) * 100).roundToLong()
        val whole = if (decimals) cents / 100 else (cents + 50) / 100
        val grouped = whole.toString().reversed().chunked(3).joinToString(".").reversed()
        val text = if (decimals) "$grouped,${(cents % 100).toString().padStart(2, '0')}" else grouped
        return (if (neg) "-" else "") + text + " €"
    }

    /** Best format for a label: no decimals from 100 up. */
    fun eurosAuto(value: Double): String = euros(value, decimals = abs(value) < 100)

    /** Compact axis tick: 0, 50, 1K, 2,5K. */
    fun compact(value: Double): String = when {
        abs(value) >= 1000 -> {
            val k = value / 1000
            if (k == floor(k)) "${k.toLong()}K" else "${(k * 10).roundToLong() / 10.0}K".replace('.', ',')
        }
        value == floor(value) -> value.toLong().toString()
        else -> value.toString().replace('.', ',')
    }
}
