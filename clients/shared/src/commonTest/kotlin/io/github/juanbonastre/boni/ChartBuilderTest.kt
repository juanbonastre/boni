package io.github.juanbonastre.boni

import io.github.juanbonastre.boni.api.ChartFilterRule
import io.github.juanbonastre.boni.api.ChartSpec
import io.github.juanbonastre.boni.api.Dimension
import io.github.juanbonastre.boni.api.Period
import io.github.juanbonastre.boni.ui.ChartBuilder
import io.github.juanbonastre.boni.ui.charts.ChartMath
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChartBuilderTest {
    private val base = ChartBuilder.newSpec()

    @Test
    fun numberHasNoAxisNorSeries() {
        val s = ChartBuilder.normalize(base.copy(kind = "number", split = Dimension("group"), top = 5, drilldown = true))
        assertNull(s.x)
        assertNull(s.split)
        assertNull(s.top)
        assertFalse(s.drilldown)
    }

    @Test
    fun switchingBackFromNumberPicksADefaultAxis() {
        val n = ChartBuilder.normalize(base.copy(kind = "number"))
        assertEquals(Dimension("group"), ChartBuilder.normalize(n.copy(kind = "hbar")).x)
        assertEquals(Dimension("date", "month"), ChartBuilder.normalize(n.copy(kind = "line")).x)
    }

    @Test
    fun stackedBarsAlwaysHaveSeriesAndSeriesDropTheComparison() {
        val s = ChartBuilder.normalize(base.copy(kind = "stacked_bar", compare = "previous_year"))
        assertEquals(Dimension("group"), s.split)
        assertEquals("none", s.compare)
        // a donut cannot split nor compare
        val d = ChartBuilder.normalize(s.copy(kind = "donut", x = Dimension("category"), compare = "previous_period"))
        assertNull(d.split)
        assertEquals("none", d.compare)
    }

    @Test
    fun seriesCannotRepeatTheAxisAndDatesGetAGranularity() {
        val s = ChartBuilder.normalize(base.copy(x = Dimension("group"), split = Dimension("group")))
        assertEquals(Dimension("category"), s.split)
        val d = ChartBuilder.normalize(base.copy(x = Dimension("date"), split = Dimension("merchant", "month")))
        assertEquals(Dimension("date", "month"), d.x)
        assertEquals(Dimension("merchant"), d.split)
        // top N only for categories, not for time
        assertNull(ChartBuilder.normalize(base.copy(top = 5)).top)
        assertEquals(5, ChartBuilder.normalize(base.copy(kind = "hbar", x = Dimension("merchant"), top = 5)).top)
    }

    @Test
    fun periodKeepsOnlyItsOwnFields() {
        val p = ChartBuilder.normalize(base.copy(period = Period("last_days", months = 12))).period
        assertEquals(Period("last_days", days = 30), p)
        assertEquals(Period("this_month"), ChartBuilder.normalize(base.copy(period = Period("this_month", months = 3))).period)
    }

    @Test
    fun describeAndLabels() {
        val s = ChartSpec(title = "x", kind = "bar", x = Dimension("date", "month"), period = Period("last_months", months = 6),
            filters = listOf(ChartFilterRule("category", "prefix", listOf(JsonPrimitive("comida")))), compare = "previous_year")
        assertEquals("bar - spending - por month - Ultimos 6 meses - previous_year - 1 filtro", ChartBuilder.describe(s, null))
        assertEquals("es del grupo o es", ChartBuilder.opLabel("category", "prefix"))
        assertEquals("mayor o igual que", ChartBuilder.opLabel("amount", "gte"))
        assertTrue(ChartBuilder.isIsoDate("2026-10-12"))
        assertFalse(ChartBuilder.isIsoDate("2026-10-1"))
        assertEquals("Nueva grafica (copia)", ChartBuilder.duplicate(base.copy(id = "x")).title)
        assertEquals("", ChartBuilder.duplicate(base.copy(id = "x")).id)
    }

    @Test
    fun formats() {
        assertEquals("1.234", ChartMath.number(1234.0))
        assertEquals("2,5", ChartMath.number(2.5))
        assertEquals("+51,6 %", ChartMath.percent(51.6))
        assertEquals("-8,6 %", ChartMath.percent(-8.6))
        assertEquals("12", ChartMath.formatAuto(12.0, ""))
        assertEquals("12,50 €", ChartMath.formatAuto(12.5, "EUR"))
        assertEquals(1, ChartMath.labelStep(12, 12))
        assertEquals(3, ChartMath.labelStep(31, 12))
    }
}
