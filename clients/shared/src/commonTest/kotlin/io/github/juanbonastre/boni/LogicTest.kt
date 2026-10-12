package io.github.juanbonastre.boni

import io.github.juanbonastre.boni.api.ActionRequest
import io.github.juanbonastre.boni.api.ActionResult
import io.github.juanbonastre.boni.api.AmountField
import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.Condition
import io.github.juanbonastre.boni.api.DateField
import io.github.juanbonastre.boni.api.FormComponent
import io.github.juanbonastre.boni.api.MultiChoiceField
import io.github.juanbonastre.boni.api.OfflineException
import io.github.juanbonastre.boni.api.SubmitAction
import io.github.juanbonastre.boni.api.ToggleField
import io.github.juanbonastre.boni.data.MemoryTextStore
import io.github.juanbonastre.boni.data.OfflineQueue
import io.github.juanbonastre.boni.ui.FormLogic
import io.github.juanbonastre.boni.ui.charts.ChartMath
import io.github.juanbonastre.boni.ui.shiftIso
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ChartMathTest {
    @Test
    fun ticksAreRound() {
        assertEquals(listOf(0.0, 50.0, 100.0, 150.0, 200.0), ChartMath.ticks(182.0))
        assertEquals(listOf(0.0, 500.0, 1000.0, 1500.0, 2000.0), ChartMath.ticks(1610.0))
        assertEquals(listOf(0.0, 1.0), ChartMath.ticks(0.0))
        assertEquals(0.0, ChartMath.ticks(37.0, 3).first())
        assertTrue(ChartMath.ticks(37.0, 3).last() >= 37.0)
    }

    @Test
    fun spanishMoney() {
        assertEquals("1.234,56 €", ChartMath.euros(1234.56))
        assertEquals("82,14 €", ChartMath.euros(82.14))
        assertEquals("1.261 €", ChartMath.eurosAuto(1260.56))
        assertEquals("-60,00 €", ChartMath.euros(-60.0))
        assertEquals("2,5K", ChartMath.compact(2500.0))
        assertEquals("1K", ChartMath.compact(1000.0))
        assertEquals("150", ChartMath.compact(150.0))
    }

    @Test
    fun dateShift() {
        assertEquals("2026-09-30", shiftIso("2026-10-01", -1))
        assertEquals("2025-12-31", shiftIso("2026-01-01", -1))
        assertEquals("2024-02-29", shiftIso("2024-03-01", -1))
        assertEquals("2026-10-10", shiftIso("2026-10-12", -2))
    }
}

class FormLogicTest {
    private val form = FormComponent(
        id = "expense",
        fields = listOf(
            AmountField(id = "amount", label = "Importe", required = true, max = 100000.0),
            ToggleField(id = "shared", label = "Pague yo por otros"),
            MultiChoiceField(id = "invited", label = "Invitados", source = "people",
                visibleWhen = Condition("shared", JsonPrimitive(true))),
            DateField(id = "date", label = "Fecha", default = "today", required = true),
        ),
        submit = SubmitAction("expenses.capture", "Guardar"),
    )

    @Test
    fun initialValuesResolveToday() {
        val v = FormLogic.initialValues(form, "2026-10-12")
        assertEquals(JsonPrimitive("2026-10-12"), v["date"])
        assertEquals(JsonPrimitive(false), v["shared"])
    }

    @Test
    fun visibilityFollowsCondition() {
        val v = FormLogic.initialValues(form, "2026-10-12").toMutableMap()
        assertFalse(FormLogic.isVisible(form.fields[2], v))
        v["shared"] = JsonPrimitive(true)
        assertTrue(FormLogic.isVisible(form.fields[2], v))
    }

    @Test
    fun clientChecksAndPayload() {
        val v = FormLogic.initialValues(form, "2026-10-12").toMutableMap()
        assertEquals(setOf("amount"), FormLogic.clientErrors(form, v).keys)
        v["amount"] = JsonPrimitive("abc")
        assertEquals("No es un numero", FormLogic.clientErrors(form, v)["amount"])
        v["amount"] = JsonPrimitive("12,50")
        v["invited"] = JsonArray(listOf(JsonPrimitive("lucia-ferri")))
        assertTrue(FormLogic.clientErrors(form, v).isEmpty())
        val p = FormLogic.payload(form, v)
        assertEquals(JsonPrimitive(12.5), p["amount"])
        assertFalse("invited" in p) // hidden: not sent
    }
}

class OfflineQueueTest {
    private fun req(id: String) = ActionRequest("expenses.capture", id, mapOf("amount" to JsonPrimitive(5)))

    @Test
    fun flushKeepsOrderStopsWhenOfflineAndKeepsRejected() = runTest {
        val q = OfflineQueue(MemoryTextStore())
        listOf("a", "b", "c", "d").forEach { q.add(req(it)) }
        val sent = mutableListOf<String>()
        val n = q.flush { r ->
            sent += r.clientId
            when (r.clientId) {
                "a" -> ActionResult("ok")
                "b" -> ActionResult("invalid", "Revisa", mapOf("category" to "Elige una categoria"))
                "c" -> throw OfflineException(RuntimeException("down"))
                else -> ActionResult("ok")
            }
        }
        assertEquals(1, n)
        assertEquals(listOf("a", "b", "c"), sent) // d not tried after going offline
        assertEquals(listOf("b", "c", "d"), q.items().map { it.request.clientId })
        assertEquals("Revisa; category: Elige una categoria", q.items().first().error)
        assertEquals(2, q.pending)
        // Back online: c and d go; the rejected one stays until dismissed.
        assertEquals(2, q.flush { ActionResult("queued") })
        assertEquals(listOf("b"), q.items().map { it.request.clientId })
        q.dismiss("b")
        assertTrue(q.items().isEmpty())
    }

    @Test
    fun serverErrorsAreRetriedLater() = runTest {
        val q = OfflineQueue(MemoryTextStore())
        q.add(req("x"))
        assertEquals(0, q.flush { throw ApiException(503, "source_unavailable", "down") })
        assertEquals(1, q.pending)
        assertEquals(0, q.flush { throw ApiException(404, "not_found", "no") })
        assertEquals(0, q.pending)
        assertEquals("no", q.items().single().error)
    }
}
