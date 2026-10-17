package io.github.juanbonastre.boni.api

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException

/** The server answered with an error (bad token, not found, data source down...). */
class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

/** The server could not be reached at all (no network, laptop outside the tailnet, NAS off). */
class OfflineException(cause: Throwable) : Exception("Sin conexion con el servidor de Boni", cause)

data class ServerConfig(val baseUrl: String, val token: String) {
    val isComplete: Boolean get() = baseUrl.isNotBlank() && token.isNotBlank()
}

/** HTTP client for API v1. One instance per server configuration. */
class BoniApi(private val config: ServerConfig, engineClient: HttpClient? = null, private val clientName: String = "boni") {
    private val http: HttpClient = (engineClient ?: HttpClient()).config {
        install(ContentNegotiation) { json(BoniJson) }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 8_000
        }
        defaultRequest {
            url(config.baseUrl.trimEnd('/') + "/")
            header("Authorization", "Bearer ${config.token}")
            header("X-Boni-Client", clientName)
        }
        expectSuccess = false
    }

    suspend fun home(): Screen = get("api/v1/home")
    suspend fun screen(id: String): Screen = get("api/v1/screens/$id")
    suspend fun charts(): ChartsResponse = get("api/v1/charts")
    suspend fun widgets(): WidgetsResponse = get("api/v1/widgets")

    suspend fun chartData(id: String, drill: String? = null): ChartData =
        call { http.get("api/v1/charts/$id/data") { if (drill != null) parameter("drill", drill) } }

    suspend fun chart(id: String): ChartSpec = get("api/v1/charts/$id")
    suspend fun catalog(): ChartCatalog = get("api/v1/charts/catalog")
    suspend fun createChart(spec: ChartSpec): ChartSpec = send("api/v1/charts", spec, put = false)
    suspend fun updateChart(spec: ChartSpec): ChartSpec = send("api/v1/charts/${spec.id}", spec, put = true)
    suspend fun deleteChart(id: String) { call<Unit>(decode = false) { http.delete("api/v1/charts/$id") } }
    suspend fun orderCharts(ids: List<String>): ChartsResponse = send("api/v1/charts/order", ChartOrder(ids), put = true)
    suspend fun preview(spec: ChartSpec, drill: String? = null): ChartData =
        send("api/v1/charts/preview", ChartPreviewRequest(spec, drill), put = false)

    suspend fun addWidget(chartId: String, size: String): Widget = send("api/v1/widgets", WidgetRequest(chartId, size), put = false)
    suspend fun updateWidget(id: String, chartId: String, size: String): Widget =
        send("api/v1/widgets/$id", WidgetRequest(chartId, size), put = true)
    suspend fun deleteWidget(id: String) { call<Unit>(decode = false) { http.delete("api/v1/widgets/$id") } }

    suspend fun options(source: String, query: String = "", limit: Int = 50): OptionsResponse =
        call { http.get("api/v1/options/$source") { parameter("q", query); parameter("limit", limit) } }

    suspend fun action(request: ActionRequest): ActionResult =
        call {
            http.post("api/v1/actions") {
                contentType(ContentType.Application.Json)
                setBody(request)
            }
        }

    private suspend inline fun <reified T> get(path: String): T = call { http.get(path) }

    private suspend inline fun <reified B, reified T> send(path: String, body: B, put: Boolean): T = call {
        if (put) {
            http.put(path) { contentType(ContentType.Application.Json); setBody(body) }
        } else {
            http.post(path) { contentType(ContentType.Application.Json); setBody(body) }
        }
    }

    /** [decode] false: the answer has no body (204); T must be Unit. */
    private suspend inline fun <reified T> call(decode: Boolean = true, block: () -> HttpResponse): T {
        val response = try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw OfflineException(e)
        }
        if (!response.status.isSuccess()) {
            val text = runCatching { response.bodyAsText() }.getOrDefault("")
            val err = runCatching { BoniJson.decodeFromString(ErrorResponse.serializer(), text).error }.getOrNull()
            throw ApiException(response.status.value, err?.code ?: "http_${response.status.value}", err?.message ?: text.take(200))
        }
        @Suppress("UNCHECKED_CAST")
        return if (decode) response.body() else Unit as T
    }

    fun close() = http.close()
}
