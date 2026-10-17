package io.github.juanbonastre.boni

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.juanbonastre.boni.api.ActionRequest
import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.BoniApi
import io.github.juanbonastre.boni.api.BoniJson
import io.github.juanbonastre.boni.api.ChartCatalog
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.api.ChartSpec
import io.github.juanbonastre.boni.api.ChoiceField
import io.github.juanbonastre.boni.api.FormComponent
import io.github.juanbonastre.boni.api.MultiChoiceField
import io.github.juanbonastre.boni.api.Option
import io.github.juanbonastre.boni.api.OfflineException
import io.github.juanbonastre.boni.api.OptionsResponse
import io.github.juanbonastre.boni.api.Screen
import io.github.juanbonastre.boni.api.ServerConfig
import io.github.juanbonastre.boni.api.Widget
import io.github.juanbonastre.boni.api.WidgetsResponse
import io.github.juanbonastre.boni.data.ChartRepository
import io.github.juanbonastre.boni.data.Clock
import io.github.juanbonastre.boni.data.OfflineQueue
import io.github.juanbonastre.boni.data.TextStore
import io.github.juanbonastre.boni.data.systemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement

const val CAPTURE_SCREEN = "capture-expense"
const val OPTION_LIST_LIMIT = 500
private const val WIDGETS_FILE = "widgets.json"

sealed interface SubmitOutcome {
    data class Done(val message: String) : SubmitOutcome
    data class Queued(val message: String) : SubmitOutcome
    data class Invalid(val message: String, val fieldErrors: Map<String, String>) : SubmitOutcome
    data class Failed(val message: String) : SubmitOutcome
}

/**
 * App state shared by every window (main window and widgets): server config, API, offline queue, chart cache and a
 * refresh tick that cards and widgets watch. No business logic: the server decides, this only moves data.
 */
class BoniController(
    config: ServerConfig?,
    private val store: TextStore,
    private val clock: Clock = systemClock(),
    private val apiFactory: (ServerConfig) -> BoniApi = { BoniApi(it, clientName = "boni-desktop") },
) {
    var config by mutableStateOf(config)
        private set
    private var api: BoniApi? = config?.takeIf { it.isComplete }?.let(apiFactory)

    val queue = OfflineQueue(store)
    val charts = ChartRepository({ api }, store)

    /** Incremented to make every chart card and widget reload. */
    var refreshTick by mutableIntStateOf(0)
        private set
    var pending by mutableIntStateOf(queue.pending)
        private set
    var online by mutableStateOf(true)
        private set

    fun today(): String = clock.today()

    fun configure(newConfig: ServerConfig) {
        if (newConfig == config && api != null) return  // saving the settings without changes: nothing to reload
        api?.close()
        config = newConfig
        api = newConfig.takeIf { it.isComplete }?.let(apiFactory)
        charts.invalidate()
        screens.clear()
        optionLists.clear()
        catalogCache = null
        refresh()
    }

    fun refresh() {
        refreshTick++
    }

    // Screens and option lists rarely change: kept in memory, shown at once, refreshed in the background (prefetch()).
    private val screens = mutableMapOf<String, Screen>()
    private val optionLists = mutableMapOf<String, List<Option>>()

    fun cachedScreen(id: String): Screen? = screens[id]

    suspend fun home(): Screen = requireApi().home().also { screens["home"] = it }

    suspend fun screen(id: String): Screen = requireApi().screen(id).also { screens[id] = it }

    suspend fun options(source: String, query: String): OptionsResponse = requireApi().options(source, query)

    /** The whole list of a source (categories, people: tens of items), fetched once and filtered on the device. */
    suspend fun optionList(source: String): List<Option> =
        optionLists[source] ?: requireApi().options(source, "", limit = OPTION_LIST_LIMIT).options.also { optionLists[source] = it }

    /** Load what the capture form needs before the user opens it. Errors are ignored (offline: next round). */
    suspend fun prefetch() {
        val client = api ?: return
        runCatching { screens["home"] = client.home() }
        val form = runCatching { client.screen(CAPTURE_SCREEN).also { screens[CAPTURE_SCREEN] = it } }.getOrNull()
        val sources = form?.components.orEmpty().filterIsInstance<FormComponent>().flatMap { f ->
            f.fields.mapNotNull { (it as? ChoiceField)?.source ?: (it as? MultiChoiceField)?.source }
        }.toSet()
        for (src in sources) runCatching { optionLists[src] = client.options(src, "", limit = OPTION_LIST_LIMIT).options }
        runCatching { chartSpecs = client.charts().charts }
    }

    // ----- charts (definitions) and the chart builder -----
    /** The chart definitions, as last loaded (titles for widgets, the list of the Graficas screen). */
    var chartSpecs by mutableStateOf<List<ChartSpec>>(emptyList())
        private set
    private var catalogCache: ChartCatalog? = null

    fun chartTitle(id: String): String? = chartSpecs.firstOrNull { it.id == id }?.title

    suspend fun catalog(): ChartCatalog = catalogCache ?: requireApi().catalog().also { catalogCache = it }

    suspend fun loadCharts(): List<ChartSpec> = requireApi().charts().charts.also { chartSpecs = it }

    suspend fun preview(spec: ChartSpec, drill: String? = null): ChartData = requireApi().preview(spec, drill)

    /** Creates (empty id) or updates a chart; everything showing charts reloads. */
    suspend fun saveChart(spec: ChartSpec): ChartSpec {
        val client = requireApi()
        val saved = if (spec.id.isEmpty()) client.createChart(spec) else client.updateChart(spec)
        chartsChanged()
        return saved
    }

    suspend fun deleteChart(id: String) {
        requireApi().deleteChart(id)
        chartsChanged()
        loadWidgets()  // its widgets are gone too
    }

    suspend fun orderCharts(ids: List<String>) {
        chartSpecs = requireApi().orderCharts(ids).charts
        screens.remove("home")
        refresh()
    }

    private suspend fun chartsChanged() {
        loadCharts()
        charts.invalidate()
        screens.remove("home")
        refresh()
    }

    // ----- widgets of this device (kept on the device too: they must appear at login even without network) -----
    var widgets by mutableStateOf(
        store.read(WIDGETS_FILE)?.let { runCatching { BoniJson.decodeFromString(WidgetsResponse.serializer(), it).widgets }.getOrNull() }
            ?: emptyList<Widget>()
    )
        private set

    suspend fun loadWidgets(): List<Widget> {
        val list = requireApi().widgets()
        store.write(WIDGETS_FILE, BoniJson.encodeToString(WidgetsResponse.serializer(), list))
        widgets = list.widgets
        return list.widgets
    }

    suspend fun addWidget(chartId: String, size: String) {
        requireApi().addWidget(chartId, size)
        loadWidgets()
    }

    suspend fun updateWidget(id: String, chartId: String, size: String) {
        requireApi().updateWidget(id, chartId, size)
        loadWidgets()
    }

    suspend fun removeWidget(id: String) {
        requireApi().deleteWidget(id)
        loadWidgets()
    }

    private fun requireApi(): BoniApi = api ?: throw ApiException(0, "not_configured", "Configura el servidor de Boni")

    suspend fun submit(action: String, values: Map<String, JsonElement>): SubmitOutcome {
        val request = ActionRequest(action, clock.newId(), values, clock.nowIso())
        val client = api
        if (client == null) {
            queue.add(request)
            pending = queue.pending
            return SubmitOutcome.Queued("Guardado en este equipo: se enviara cuando configures el servidor")
        }
        return try {
            val r = client.action(request)
            online = true
            when (r.status) {
                "ok" -> SubmitOutcome.Done(r.message ?: "Guardado").also { refresh() }
                "queued" -> SubmitOutcome.Queued(r.message ?: "Guardado en el servidor; se escribira luego")
                "invalid" -> SubmitOutcome.Invalid(r.message ?: "Revisa los campos", r.fieldErrors)
                else -> SubmitOutcome.Failed(r.message ?: "No se pudo guardar")
            }
        } catch (e: OfflineException) {
            online = false
            queue.add(request)
            pending = queue.pending
            SubmitOutcome.Queued("Sin conexion: guardado en este equipo, se enviara al volver la red")
        } catch (e: ApiException) {
            SubmitOutcome.Failed(e.message)
        }
    }

    /** Send the offline queue now. */
    suspend fun sync(): Int {
        val client = api ?: return 0
        val n = queue.flush { client.action(it) }
        pending = queue.pending
        if (n > 0) refresh()
        return n
    }

    /** Background loop: queue every minute; charts, screens and option lists every [chartsEveryMinutes] minutes. */
    fun start(scope: CoroutineScope, chartsEveryMinutes: Int = 15): Job = scope.launch {
        var minute = 0
        while (isActive) {
            runCatching { sync() }
            if (minute % chartsEveryMinutes == 0) prefetch()
            if (minute > 0 && minute % chartsEveryMinutes == 0) refresh()
            delay(60_000)
            minute++
        }
    }

    fun reportOnline(isOnline: Boolean) {
        online = isOnline
    }
}
