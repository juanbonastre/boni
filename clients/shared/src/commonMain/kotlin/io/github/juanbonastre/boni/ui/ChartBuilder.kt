package io.github.juanbonastre.boni.ui

import io.github.juanbonastre.boni.api.ChartCatalog
import io.github.juanbonastre.boni.api.ChartFilterRule
import io.github.juanbonastre.boni.api.ChartSpec
import io.github.juanbonastre.boni.api.Dimension
import io.github.juanbonastre.boni.api.Period

/**
 * Pure logic of the chart editor (no Compose): defaults, keeping a definition coherent while the user changes one
 * option at a time, and the Spanish texts of the list. The server validates again on save and preview.
 */
object ChartBuilder {
    /** Kinds that can split the data into several series. */
    val SPLIT_KINDS = setOf("bar", "stacked_bar", "line", "area", "table")
    /** Kinds that rank categories rather than show time. */
    private val CATEGORY_KINDS = setOf("hbar", "donut", "table")

    fun newSpec(): ChartSpec = ChartSpec(
        title = "Nueva grafica", kind = "bar", x = Dimension("date", "month"), period = Period("last_months", months = 12),
    )

    fun duplicate(spec: ChartSpec): ChartSpec = spec.copy(id = "", title = spec.title + " (copia)")

    fun defaultX(kind: String): Dimension = if (kind in CATEGORY_KINDS) Dimension("group") else Dimension("date", "month")

    private fun withGranularity(d: Dimension?): Dimension? = when {
        d == null -> null
        d.field == "date" && d.granularity == null -> d.copy(granularity = "month")
        d.field != "date" && d.granularity != null -> d.copy(granularity = null)
        else -> d
    }

    /** Keeps a definition coherent after one change (the kind, the axis, the split...). */
    fun normalize(spec: ChartSpec): ChartSpec {
        var s = spec
        s = if (s.kind == "number") {
            s.copy(x = null, split = null, top = null, drilldown = false, sort = "auto")
        } else {
            s.copy(x = withGranularity(s.x ?: defaultX(s.kind)))
        }
        if (s.kind !in SPLIT_KINDS && s.split != null) s = s.copy(split = null)
        if (s.kind == "stacked_bar" && s.split == null) {
            s = s.copy(split = Dimension(if (s.x?.field == "group") "category" else "group"))
        }
        val split = withGranularity(s.split)
        if (split != null) {
            val x = s.x
            val clash = x != null && x.field == split.field && x.granularity == split.granularity
            s = s.copy(split = if (clash) Dimension(if (split.field == "group") "category" else "group") else split, compare = "none")
        }
        if (s.kind == "donut" && s.compare != "none") s = s.copy(compare = "none")
        if (s.x?.field == "date" && s.top != null) s = s.copy(top = null)
        val p = s.period
        s = s.copy(period = when (p.kind) {
            "last_months" -> Period("last_months", months = p.months ?: 12)
            "last_days" -> Period("last_days", days = p.days ?: 30)
            "range" -> Period("range", start = p.start, end = p.end)
            else -> Period(p.kind)
        })
        return s
    }

    val OPS = mapOf(
        "in" to "es", "not_in" to "no es", "prefix" to "empieza por", "not_prefix" to "no empieza por",
        "contains" to "contiene", "not_contains" to "no contiene", "gte" to "desde", "lte" to "hasta",
        "empty" to "esta vacio", "not_empty" to "no esta vacio",
    )

    fun opLabel(field: String, op: String): String = when {
        field == "amount" && op == "gte" -> "mayor o igual que"
        field == "amount" && op == "lte" -> "menor o igual que"
        field == "category" && op == "prefix" -> "es del grupo o es"
        field == "category" && op == "not_prefix" -> "no es del grupo ni es"
        else -> OPS[op] ?: op
    }

    fun needsValues(op: String): Boolean = op != "empty" && op != "not_empty"

    /** A new filter on [field] with its first operation. */
    fun newRule(field: String, catalog: ChartCatalog): ChartFilterRule =
        ChartFilterRule(field, catalog.fields.firstOrNull { it.id == field }?.ops?.firstOrNull() ?: "in")

    fun periodLabel(p: Period): String = when (p.kind) {
        "this_month" -> "Este mes"
        "last_month" -> "Mes pasado"
        "last_months" -> "Ultimos ${p.months ?: 12} meses"
        "this_year" -> "Este ano"
        "last_year" -> "Ano pasado"
        "last_days" -> "Ultimos ${p.days ?: 30} dias"
        "range" -> "Del ${p.start ?: "?"} al ${p.end ?: "?"}"
        "all" -> "Todo"
        else -> p.kind
    }

    /** One line for the chart list: "Barras - Gasto por mes - Ultimos 12 meses - 2 filtros". */
    fun describe(spec: ChartSpec, catalog: ChartCatalog?): String {
        fun label(items: List<io.github.juanbonastre.boni.api.CatalogItem>?, id: String) = items?.firstOrNull { it.id == id }?.label ?: id
        val parts = mutableListOf(label(catalog?.kinds, spec.kind), label(catalog?.measures, spec.measure))
        spec.x?.let { x ->
            val field = catalog?.fields?.firstOrNull { it.id == x.field }?.label ?: x.field
            parts += "por " + (if (x.field == "date") label(catalog?.granularities, x.granularity ?: "month") else field).lowercase()
        }
        spec.split?.let { sp -> parts += "series: " + (catalog?.fields?.firstOrNull { it.id == sp.field }?.label ?: sp.field).lowercase() }
        parts += periodLabel(spec.period)
        if (spec.compare != "none") parts += label(catalog?.compares, spec.compare).lowercase()
        if (spec.filters.isNotEmpty()) parts += if (spec.filters.size == 1) "1 filtro" else "${spec.filters.size} filtros"
        return parts.joinToString(" - ")
    }

    /** "2026-10-12": a valid ISO date (for the period and date filters). */
    fun isIsoDate(s: String): Boolean = Regex("""\d{4}-\d{2}-\d{2}""").matches(s.trim())
}
