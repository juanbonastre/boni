package io.github.juanbonastre.boni

import io.github.juanbonastre.boni.api.ActionRequest
import io.github.juanbonastre.boni.api.ActionResult
import io.github.juanbonastre.boni.api.BoniApi
import io.github.juanbonastre.boni.api.BoniJson
import io.github.juanbonastre.boni.api.ButtonComponent
import io.github.juanbonastre.boni.api.ChartCardComponent
import io.github.juanbonastre.boni.api.ChartCatalog
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.api.ChartPreviewRequest
import io.github.juanbonastre.boni.api.ChartsResponse
import io.github.juanbonastre.boni.api.Dimension
import io.github.juanbonastre.boni.api.ChoiceField
import io.github.juanbonastre.boni.api.ErrorResponse
import io.github.juanbonastre.boni.api.FormComponent
import io.github.juanbonastre.boni.api.OfflineException
import io.github.juanbonastre.boni.api.OptionsResponse
import io.github.juanbonastre.boni.api.Screen
import io.github.juanbonastre.boni.api.ServerConfig
import io.github.juanbonastre.boni.api.UnknownComponent
import io.github.juanbonastre.boni.api.UnknownField
import io.github.juanbonastre.boni.api.WidgetsResponse
import io.github.juanbonastre.boni.data.MemoryTextStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** The client must understand exactly what the server sends: `api/examples/` are real server answers. */
class ContractTest {
    private val examples: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "api/examples") }.first { it.isDirectory }

    private fun ex(name: String) = File(examples, name).readText()

    @Test
    fun parsesEveryExample() {
        val home = BoniJson.decodeFromString(Screen.serializer(), ex("home.json"))
        assertIs<ButtonComponent>(home.components[0])
        assertEquals(3, home.components.filterIsInstance<ChartCardComponent>().size)

        val form = BoniJson.decodeFromString(Screen.serializer(), ex("screen-capture-expense.json")).components.single()
        assertIs<FormComponent>(form)
        assertEquals("expenses.capture", form.submit.action)
        assertTrue(form.fields.none { it is UnknownField })
        assertEquals("categories", (form.fields.first { it.id == "category" } as ChoiceField).source)
        assertEquals("shared", form.fields.first { it.id == "invited" }.visibleWhen?.field)

        for (name in listOf("chart-spending-by-category.json", "chart-spending-by-category-drill.json",
            "chart-monthly-spending.json", "chart-eating-out.json")) {
            val d = BoniJson.decodeFromString(ChartData.serializer(), ex(name))
            assertTrue(d.series.first().points.isNotEmpty(), name)
        }
        val monthly = BoniJson.decodeFromString(ChartData.serializer(), ex("chart-monthly-spending.json"))
        assertTrue(monthly.series[0].points.last().partial && monthly.series[0].points.first().noData)

        val split = BoniJson.decodeFromString(ChartData.serializer(), ex("chart-preview-split.json"))
        assertEquals("stacked_bar", split.kind)
        assertTrue(split.series.size > 1 && split.series.all { it.role == "split" })
        val cmp = BoniJson.decodeFromString(ChartData.serializer(), ex("chart-preview-compare.json"))
        assertEquals("compare", cmp.series.last().role)
        assertTrue(cmp.deltaPct != null && cmp.previousTotal != null)
        val donut = BoniJson.decodeFromString(ChartData.serializer(), ex("chart-preview-donut.json"))
        assertEquals("_rest", donut.series.single().points.last().key)

        val charts = BoniJson.decodeFromString(ChartsResponse.serializer(), ex("charts.json")).charts
        assertEquals(listOf("spending-by-category", "monthly-spending", "eating-out"), charts.map { it.id })
        assertEquals("group", charts[0].x?.field)
        assertEquals(2, charts[2].filters.size)
        val catalog = BoniJson.decodeFromString(ChartCatalog.serializer(), ex("chart-catalog.json"))
        assertTrue(catalog.fields.any { it.id == "merchant" && it.source == "merchants" })
        assertTrue(catalog.kinds.map { it.id }.containsAll(listOf("bar", "stacked_bar", "hbar", "line", "area", "donut", "number", "table")))
        // what the editor sends is what the server documents as a preview request
        val req = BoniJson.decodeFromString(ChartPreviewRequest.serializer(), ex("chart-preview-split-request.json"))
        assertEquals(Dimension("group"), req.spec.split)

        BoniJson.decodeFromString(OptionsResponse.serializer(), ex("options-people.json"))
        BoniJson.decodeFromString(WidgetsResponse.serializer(), ex("widgets.json"))
        BoniJson.decodeFromString(ActionRequest.serializer(), ex("action-request.json"))
        assertEquals("ok", BoniJson.decodeFromString(ActionResult.serializer(), ex("action-result-ok.json")).status)
        val invalid = BoniJson.decodeFromString(ActionResult.serializer(), ex("action-result-invalid.json"))
        assertTrue("amount" in invalid.fieldErrors)
        assertEquals("unauthorized", BoniJson.decodeFromString(ErrorResponse.serializer(), ex("error.json")).error.code)
    }

    @Test
    fun unknownTypesFromANewerServerDoNotBreak() {
        val s = BoniJson.decodeFromString(Screen.serializer(), """
            {"id":"x","title":"X","new_top_field":1,"components":[
              {"type":"voice_button","label":"Habla"},
              {"type":"form","id":"f","submit":{"action":"a","label":"Ok"},"fields":[{"type":"slider","id":"s","label":"S"}]}]}
        """.trimIndent())
        assertIs<UnknownComponent>(s.components[0])
        assertIs<UnknownField>((s.components[1] as FormComponent).fields.single())
    }

    @Test
    fun apiSendsTokenAndMapsErrors() = runTest {
        var auth: String? = null
        val engine = MockEngine { request ->
            auth = request.headers[HttpHeaders.Authorization]
            when (request.url.encodedPath) {
                "/api/v1/home" -> respond(ex("home.json"), HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
                else -> respond(ex("error.json"), HttpStatusCode.Unauthorized, headersOf(HttpHeaders.ContentType, "application/json"))
            }
        }
        val api = BoniApi(ServerConfig("https://boni.example", "tkn"), HttpClient(engine))
        assertEquals("home", api.home().id)
        assertEquals("Bearer tkn", auth)
        val e = assertFailsWith<io.github.juanbonastre.boni.api.ApiException> { api.widgets() }
        assertEquals(401, e.status)
        assertEquals("unauthorized", e.code)
    }

    @Test
    fun controllerQueuesWhenOffline() = runTest {
        val engine = MockEngine { throw java.net.ConnectException("refused") }
        val store = MemoryTextStore()
        val controller = BoniController(ServerConfig("https://boni.example", "tkn"), store,
            apiFactory = { BoniApi(it, HttpClient(engine)) })
        val r = controller.submit("expenses.capture", mapOf("amount" to JsonPrimitive(3.2)))
        assertIs<SubmitOutcome.Queued>(r)
        assertEquals(1, controller.pending)
        assertFailsWith<OfflineException> { controller.home() }
    }

    @Test
    fun cardsAndWidgetsShareOneRequestPerRefresh() = runTest {
        var calls = 0
        val engine = MockEngine { request ->
            calls++
            respond(ex("chart-eating-out.json"), HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val api = BoniApi(ServerConfig("https://boni.example", "tkn"), HttpClient(engine))
        val repo = io.github.juanbonastre.boni.data.ChartRepository({ api }, MemoryTextStore())
        // main window card + widget, same refresh tick: one request
        repo.load("eating-out", generation = 0)
        repo.load("eating-out", generation = 0)
        assertEquals(1, calls)
        // next refresh tick: one more request for everyone
        repo.load("eating-out", generation = 1)
        repo.load("eating-out", generation = 1)
        assertEquals(2, calls)
        repo.invalidate()
        repo.load("eating-out", generation = 1)
        assertEquals(3, calls)
    }

    @Test
    fun prefetchLoadsTheFormAndItsOptionListsOnce() = runTest {
        val paths = mutableListOf<String>()
        val engine = MockEngine { request ->
            val path = request.url.encodedPath
            paths += path
            val body = when {
                path.endsWith("/home") -> ex("home.json")
                path.endsWith("/screens/capture-expense") -> ex("screen-capture-expense.json")
                path.contains("/options/") -> """{"source":"x","options":[{"value":"tomas","label":"Tomas"}]}"""
                else -> ex("error.json")
            }
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val controller = BoniController(ServerConfig("https://boni.example", "tkn"), MemoryTextStore(),
            apiFactory = { BoniApi(it, HttpClient(engine)) })
        controller.prefetch()
        assertTrue(controller.cachedScreen("capture-expense") != null && controller.cachedScreen("home") != null)
        assertTrue(paths.any { it.endsWith("/options/categories") } && paths.any { it.endsWith("/options/people") })
        val before = paths.size
        assertEquals("tomas", controller.optionList("people").single().value)
        assertEquals(before, paths.size)  // served from memory
    }
}

class ChartApiTest {
    private val examples: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "api/examples") }.first { it.isDirectory }

    @Test
    fun builderCallsUseTheDocumentedRoutes() = runTest {
        val seen = mutableListOf<String>()
        val engine = MockEngine { request ->
            seen += "${request.method.value} ${request.url.encodedPath}"
            val json = headersOf(HttpHeaders.ContentType, "application/json")
            when {
                request.method.value == "DELETE" -> respond("", HttpStatusCode.NoContent)
                request.url.encodedPath.endsWith("/preview") -> respond(File(examples, "chart-preview-split.json").readText(), HttpStatusCode.OK, json)
                request.url.encodedPath.endsWith("/catalog") -> respond(File(examples, "chart-catalog.json").readText(), HttpStatusCode.OK, json)
                request.url.encodedPath.endsWith("/widgets") && request.method.value == "GET" ->
                    respond(File(examples, "widgets.json").readText(), HttpStatusCode.OK, json)
                request.url.encodedPath.contains("/widgets") ->
                    respond("""{"id":"w-x","chart_id":"x","size":"large"}""", HttpStatusCode.OK, json)
                request.url.encodedPath.endsWith("/charts") && request.method.value == "GET" || request.url.encodedPath.endsWith("/order") ->
                    respond(File(examples, "charts.json").readText(), HttpStatusCode.OK, json)
                else -> respond("""{"id":"nueva","title":"Nueva","kind":"bar","period":{"kind":"this_month"}}""", HttpStatusCode.OK, json)
            }
        }
        val store = MemoryTextStore()
        val c = BoniController(ServerConfig("https://boni.example", "tkn"), store, apiFactory = { BoniApi(it, HttpClient(engine)) })
        val spec = io.github.juanbonastre.boni.ui.ChartBuilder.newSpec()
        assertEquals("stacked_bar", c.preview(spec).kind)
        assertEquals("nueva", c.saveChart(spec).id)
        c.saveChart(spec.copy(id = "nueva"))
        c.orderCharts(listOf("eating-out"))
        c.deleteChart("nueva")
        c.addWidget("x", "large")
        c.removeWidget("w-x")
        assertTrue(c.catalog().fields.isNotEmpty())
        assertTrue(listOf("POST /api/v1/charts/preview", "POST /api/v1/charts", "PUT /api/v1/charts/nueva", "PUT /api/v1/charts/order",
            "DELETE /api/v1/charts/nueva", "POST /api/v1/widgets", "DELETE /api/v1/widgets/w-x", "GET /api/v1/charts/catalog").all { it in seen },
            seen.toString())
        // the widget list is kept on the device for starts without network
        val again = BoniController(ServerConfig("https://boni.example", "tkn"), store, apiFactory = { BoniApi(it, HttpClient(engine)) })
        assertEquals(3, again.widgets.size)
    }
}
