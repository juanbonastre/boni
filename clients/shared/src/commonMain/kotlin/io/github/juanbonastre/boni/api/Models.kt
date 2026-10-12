package io.github.juanbonastre.boni.api

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Client side of the API v1 contract. Source of truth: `server/boni/contract.py` (JSON schema in `api/schema/`).
 * Unknown fields are ignored; unknown component and field types decode to [UnknownComponent] / [UnknownField] so an
 * older client keeps working (it shows "actualiza la app" in their place).
 */
val BoniJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    isLenient = true
}

@Serializable
data class Option(val value: String, val label: String, val hint: String? = null)

@Serializable
data class Condition(val field: String, val equals: JsonElement)

// ---------- form fields ----------
@Serializable(with = FormFieldSerializer::class)
sealed interface FormField {
    val id: String
    val label: String
    val required: Boolean
    val help: String?
    @SerialName("visible_when") val visibleWhen: Condition?
}

@Serializable
data class AmountField(
    override val id: String,
    override val label: String,
    override val required: Boolean = false,
    override val help: String? = null,
    @SerialName("visible_when") override val visibleWhen: Condition? = null,
    val type: String = "amount",
    val currency: String = "EUR",
    val default: Double? = null,
    val min: Double? = 0.01,
    val max: Double? = null,
) : FormField

@Serializable
data class TextField(
    override val id: String,
    override val label: String,
    override val required: Boolean = false,
    override val help: String? = null,
    @SerialName("visible_when") override val visibleWhen: Condition? = null,
    val type: String = "text",
    val default: String? = null,
    @SerialName("max_length") val maxLength: Int? = null,
    val multiline: Boolean = false,
    val placeholder: String? = null,
) : FormField

@Serializable
data class DateField(
    override val id: String,
    override val label: String,
    override val required: Boolean = false,
    override val help: String? = null,
    @SerialName("visible_when") override val visibleWhen: Condition? = null,
    val type: String = "date",
    val default: String? = null,
) : FormField

@Serializable
data class ChoiceField(
    override val id: String,
    override val label: String,
    override val required: Boolean = false,
    override val help: String? = null,
    @SerialName("visible_when") override val visibleWhen: Condition? = null,
    val type: String = "choice",
    val options: List<Option>? = null,
    val source: String? = null,
    val searchable: Boolean = false,
    val style: String = "chips",
    val default: String? = null,
) : FormField

@Serializable
data class MultiChoiceField(
    override val id: String,
    override val label: String,
    override val required: Boolean = false,
    override val help: String? = null,
    @SerialName("visible_when") override val visibleWhen: Condition? = null,
    val type: String = "multi_choice",
    val options: List<Option>? = null,
    val source: String? = null,
    val searchable: Boolean = false,
    val default: List<String> = emptyList(),
) : FormField

@Serializable
data class ToggleField(
    override val id: String,
    override val label: String,
    override val required: Boolean = false,
    override val help: String? = null,
    @SerialName("visible_when") override val visibleWhen: Condition? = null,
    val type: String = "toggle",
    val default: Boolean = false,
) : FormField

@Serializable
data class UnknownField(
    override val id: String = "",
    override val label: String = "",
    override val required: Boolean = false,
    override val help: String? = null,
    @SerialName("visible_when") override val visibleWhen: Condition? = null,
    val type: String = "",
) : FormField

object FormFieldSerializer : JsonContentPolymorphicSerializer<FormField>(FormField::class) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<FormField> =
        when (typeOf(element)) {
            "amount" -> AmountField.serializer()
            "text" -> TextField.serializer()
            "date" -> DateField.serializer()
            "choice" -> ChoiceField.serializer()
            "multi_choice" -> MultiChoiceField.serializer()
            "toggle" -> ToggleField.serializer()
            else -> UnknownField.serializer()
        }
}

// ---------- components ----------
@Serializable(with = ComponentSerializer::class)
sealed interface Component

@Serializable
data class TextComponent(val text: String, val style: String = "body", val type: String = "text") : Component

@Serializable
data class ButtonComponent(
    val label: String,
    val screen: String,
    val icon: String? = null,
    val style: String = "primary",
    val type: String = "button",
) : Component

@Serializable
data class SubmitAction(val action: String, val label: String)

@Serializable
data class FormComponent(
    val id: String,
    val fields: List<FormField>,
    val submit: SubmitAction,
    val type: String = "form",
) : Component

@Serializable
data class ChartCardComponent(
    @SerialName("chart_id") val chartId: String,
    val title: String,
    val size: String = "medium",
    val type: String = "chart_card",
) : Component

@Serializable
data class UnknownComponent(val type: String = "") : Component

object ComponentSerializer : JsonContentPolymorphicSerializer<Component>(Component::class) {
    override fun selectDeserializer(element: JsonElement): DeserializationStrategy<Component> =
        when (typeOf(element)) {
            "text" -> TextComponent.serializer()
            "button" -> ButtonComponent.serializer()
            "form" -> FormComponent.serializer()
            "chart_card" -> ChartCardComponent.serializer()
            else -> UnknownComponent.serializer()
        }
}

private fun typeOf(element: JsonElement): String? =
    (element as? JsonObject)?.get("type")?.jsonPrimitive?.content

@Serializable
data class Screen(
    val id: String,
    val title: String,
    val components: List<Component>,
    @SerialName("api_version") val apiVersion: String = "1",
)

// ---------- charts ----------
@Serializable
data class ChartPoint(
    val key: String,
    val label: String,
    val value: Double,
    val partial: Boolean = false,
    @SerialName("no_data") val noData: Boolean = false,
)

@Serializable
data class ChartSeries(val name: String, val points: List<ChartPoint>)

@Serializable
data class ChartData(
    @SerialName("chart_id") val chartId: String,
    val title: String,
    val subtitle: String? = null,
    val kind: String,
    val unit: String = "EUR",
    val series: List<ChartSeries>,
    val total: Double? = null,
    val average: Double? = null,
    val drilldown: Boolean = false,
    val drill: String? = null,
    @SerialName("computed_at") val computedAt: String,
    val stale: Boolean = false,
)

@Serializable
data class Period(val kind: String, val months: Int? = null)

@Serializable
data class ChartSpec(
    val id: String,
    val title: String,
    val kind: String,
    @SerialName("group_by") val groupBy: String,
    val period: Period,
    val drilldown: Boolean = false,
)

@Serializable
data class ChartsResponse(val charts: List<ChartSpec>)

// ---------- widgets, options ----------
@Serializable
data class Widget(val id: String, @SerialName("chart_id") val chartId: String, val size: String = "medium")

@Serializable
data class WidgetsResponse(val widgets: List<Widget>)

@Serializable
data class OptionsResponse(val source: String, val options: List<Option>)

// ---------- actions ----------
@Serializable
data class ActionRequest(
    val action: String,
    @SerialName("client_id") val clientId: String,
    val values: Map<String, JsonElement>,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class ActionResult(
    val status: String,
    val message: String? = null,
    @SerialName("field_errors") val fieldErrors: Map<String, String> = emptyMap(),
    val navigate: String? = null,
)

@Serializable
data class ErrorBody(val code: String, val message: String)

@Serializable
data class ErrorResponse(val error: ErrorBody)
