package io.github.juanbonastre.boni.data

import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.BoniApi
import io.github.juanbonastre.boni.api.BoniJson
import io.github.juanbonastre.boni.api.ChartData
import io.github.juanbonastre.boni.api.OfflineException

/** What a chart card or widget shows: fresh data, last saved data (offline), or nothing yet. */
data class ChartState(
    val data: ChartData? = null,
    val loading: Boolean = false,
    /** Data comes from the device cache because the server could not be reached. */
    val offline: Boolean = false,
    val error: String? = null,
)

/** Loads chart data and keeps the last answer on the device so widgets show something without network. */
class ChartRepository(private val api: () -> BoniApi?, private val cache: TextStore) {
    private fun key(chartId: String, drill: String?) = "chart-$chartId${drill?.let { "--$it" } ?: ""}.json"

    fun cached(chartId: String, drill: String? = null): ChartData? =
        cache.read(key(chartId, drill))?.let { runCatching { BoniJson.decodeFromString(ChartData.serializer(), it) }.getOrNull() }

    suspend fun load(chartId: String, drill: String? = null): ChartState {
        val client = api() ?: return ChartState(data = cached(chartId, drill), error = "Configura el servidor")
        return try {
            val data = client.chartData(chartId, drill)
            cache.write(key(chartId, drill), BoniJson.encodeToString(ChartData.serializer(), data))
            ChartState(data = data)
        } catch (e: OfflineException) {
            ChartState(data = cached(chartId, drill), offline = true, error = e.message)
        } catch (e: ApiException) {
            ChartState(data = cached(chartId, drill), offline = e.status >= 500, error = e.message)
        }
    }
}
