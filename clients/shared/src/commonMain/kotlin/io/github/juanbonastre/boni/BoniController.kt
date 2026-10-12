package io.github.juanbonastre.boni

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.juanbonastre.boni.api.ActionRequest
import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.BoniApi
import io.github.juanbonastre.boni.api.OfflineException
import io.github.juanbonastre.boni.api.OptionsResponse
import io.github.juanbonastre.boni.api.Screen
import io.github.juanbonastre.boni.api.ServerConfig
import io.github.juanbonastre.boni.api.Widget
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
        api?.close()
        config = newConfig
        api = newConfig.takeIf { it.isComplete }?.let(apiFactory)
        refresh()
    }

    fun refresh() {
        refreshTick++
    }

    suspend fun home(): Screen = requireApi().home()

    suspend fun screen(id: String): Screen = requireApi().screen(id)

    suspend fun options(source: String, query: String): OptionsResponse = requireApi().options(source, query)

    suspend fun widgetsList(): List<Widget> = requireApi().widgets().widgets

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

    /** Background loop: queue every minute, charts every [chartsEveryMinutes] minutes. */
    fun start(scope: CoroutineScope, chartsEveryMinutes: Int = 15): Job = scope.launch {
        var minute = 0
        while (isActive) {
            runCatching { sync() }
            if (minute > 0 && minute % chartsEveryMinutes == 0) refresh()
            delay(60_000)
            minute++
        }
    }

    fun reportOnline(isOnline: Boolean) {
        online = isOnline
    }
}
