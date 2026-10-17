package io.github.juanbonastre.boni.data

import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.BoniApi
import io.github.juanbonastre.boni.api.BoniJson
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.api.OfflineException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.TimeMark
import kotlin.time.TimeSource

/** What a chart card or widget shows: fresh data, last saved data (offline), or nothing yet. */
data class ChartState(
    val data: ChartData? = null,
    val loading: Boolean = false,
    /** Data comes from the device cache because the server could not be reached. */
    val offline: Boolean = false,
    val error: String? = null,
)

/**
 * Loads chart data and keeps the last answer on the device so widgets show something without network.
 *
 * Every card and widget showing the same chart shares ONE request per refresh: a load asks for a `generation`
 * (the controller's refresh tick); an answer of that generation (or newer) younger than [maxAge] is reused, and
 * concurrent loads of the same chart wait for the one in flight instead of sending their own.
 */
class ChartRepository(
    private val api: () -> BoniApi?,
    private val cache: TextStore,
    private val maxAge: Duration = 5.minutes,
    private val time: TimeSource = TimeSource.Monotonic,
) {
    private class Fresh(val generation: Int, val mark: TimeMark, val state: ChartState)

    private val fresh = mutableMapOf<String, Fresh>()
    private val locks = mutableMapOf<String, Mutex>()
    private val locksGuard = Mutex()

    /** How many requests were actually sent (for tests). */
    var requests = 0
        private set

    private fun key(chartId: String, drill: String?) = "chart-$chartId${drill?.let { "--$it" } ?: ""}.json"

    fun cached(chartId: String, drill: String? = null): ChartData? =
        cache.read(key(chartId, drill))?.let { runCatching { BoniJson.decodeFromString(ChartData.serializer(), it) }.getOrNull() }

    private suspend fun lockFor(k: String): Mutex = locksGuard.withLock { locks.getOrPut(k) { Mutex() } }

    suspend fun load(chartId: String, drill: String? = null, generation: Int = 0): ChartState {
        val k = key(chartId, drill)
        return lockFor(k).withLock {
            fresh[k]?.let { f ->
                if (f.generation >= generation && f.mark.elapsedNow() < maxAge) return@withLock f.state
            }
            val state = fetch(chartId, drill, k)
            if (state.data != null && !state.offline && state.error == null) {
                fresh[k] = Fresh(generation, time.markNow(), state)
            }
            state
        }
    }

    private suspend fun fetch(chartId: String, drill: String?, k: String): ChartState {
        val client = api() ?: return ChartState(data = cached(chartId, drill), error = "Configura el servidor")
        requests++
        return try {
            val data = client.chartData(chartId, drill)
            cache.write(k, BoniJson.encodeToString(ChartData.serializer(), data))
            ChartState(data = data)
        } catch (e: OfflineException) {
            ChartState(data = cached(chartId, drill), offline = true, error = e.message)
        } catch (e: ApiException) {
            ChartState(data = cached(chartId, drill), offline = e.status >= 500, error = e.message)
        }
    }

    /** Forget fresh answers (server changed, e.g. new configuration). */
    fun invalidate() {
        fresh.clear()
    }
}
