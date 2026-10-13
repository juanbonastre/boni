package io.github.juanbonastre.boni.ui

import io.github.juanbonastre.boni.api.AmountField
import io.github.juanbonastre.boni.api.ChoiceField
import io.github.juanbonastre.boni.api.DateField
import io.github.juanbonastre.boni.api.FormComponent
import io.github.juanbonastre.boni.api.FormField
import io.github.juanbonastre.boni.api.MultiChoiceField
import io.github.juanbonastre.boni.api.Option
import io.github.juanbonastre.boni.api.TextField
import io.github.juanbonastre.boni.api.ToggleField
import io.github.juanbonastre.boni.api.UnknownField
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** Pure form logic (no Compose): initial values, visibility, client-side checks, values sent to the server. */
object FormLogic {
    fun initialValues(form: FormComponent, today: String): Map<String, JsonElement> =
        form.fields.associate { f ->
            f.id to when (f) {
                is AmountField -> f.default?.let { JsonPrimitive(it) } ?: JsonNull
                is TextField -> JsonPrimitive(f.default ?: "")
                is DateField -> JsonPrimitive(if (f.default == null || f.default == "today") today else f.default)
                is ChoiceField -> f.default?.let { JsonPrimitive(it) } ?: JsonNull
                is MultiChoiceField -> JsonArray(f.default.map { JsonPrimitive(it) })
                is ToggleField -> JsonPrimitive(f.default)
                is UnknownField -> JsonNull
            }
        }

    fun isVisible(field: FormField, values: Map<String, JsonElement>): Boolean {
        val cond = field.visibleWhen ?: return true
        return sameValue(values[cond.field] ?: JsonNull, cond.equals)
    }

    private fun sameValue(a: JsonElement, b: JsonElement): Boolean {
        if (a is JsonPrimitive && b is JsonPrimitive) {
            a.booleanOrNull?.let { ab -> b.booleanOrNull?.let { bb -> return ab == bb } }
            return a.contentOrNull == b.contentOrNull
        }
        return a == b
    }

    fun isEmpty(v: JsonElement?): Boolean = when (v) {
        null, JsonNull -> true
        is JsonArray -> v.isEmpty()
        is JsonPrimitive -> v.isString && v.content.isBlank()
        else -> false
    }

    /** Amount typed as "12,50" -> 12.5; null if not a number. */
    fun parseAmount(text: String): Double? = text.trim().replace(" ", "").replace(',', '.').toDoubleOrNull()

    /** Required fields and amounts, checked before sending (the server checks everything again). */
    fun clientErrors(form: FormComponent, values: Map<String, JsonElement>): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        for (f in form.fields) {
            if (!isVisible(f, values)) continue
            val v = values[f.id]
            if (f.required && isEmpty(v)) errors[f.id] = "Obligatorio"
            if (f is AmountField && !isEmpty(v)) {
                val n = (v as? JsonPrimitive)?.contentOrNull?.let(::parseAmount)
                when {
                    n == null -> errors[f.id] = "No es un numero"
                    f.min != null && n < f.min -> errors[f.id] = "Tiene que ser mayor que 0"
                    f.max != null && n > f.max -> errors[f.id] = "Demasiado alto"
                }
            }
        }
        return errors
    }

    /** Values to send: hidden fields dropped, amounts as numbers. */
    fun payload(form: FormComponent, values: Map<String, JsonElement>): Map<String, JsonElement> =
        form.fields.filter { isVisible(it, values) && it !is UnknownField }.associate { f ->
            val v = values[f.id] ?: JsonNull
            f.id to if (f is AmountField && v is JsonPrimitive && !isEmpty(v)) {
                v.contentOrNull?.let(::parseAmount)?.let { JsonPrimitive(it) } ?: v
            } else v
        }

    fun text(v: JsonElement?): String = (v as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull ?: ""

    fun list(v: JsonElement?): List<String> = (v as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()

    private val FOLD = mapOf(
        '\u00e1' to 'a', '\u00e0' to 'a', '\u00e4' to 'a', '\u00e2' to 'a', '\u00e3' to 'a', '\u00e9' to 'e', '\u00e8' to 'e', '\u00eb' to 'e', '\u00ea' to 'e',
        '\u00ed' to 'i', '\u00ec' to 'i', '\u00ef' to 'i', '\u00ee' to 'i', '\u00f3' to 'o', '\u00f2' to 'o', '\u00f6' to 'o', '\u00f4' to 'o', '\u00f5' to 'o',
        '\u00fa' to 'u', '\u00f9' to 'u', '\u00fc' to 'u', '\u00fb' to 'u', '\u00f1' to 'n', '\u00e7' to 'c',
    )

    /** Lowercase without accents: "Pe\u00f1a" -> "pena" (same matching as the server's options search). */
    fun fold(s: String): String = buildString(s.length) { for (c in s.lowercase()) append(FOLD[c] ?: c) }

    /** Options whose label or value contain every word of [query] (accent and case insensitive). */
    fun filterOptions(options: List<Option>, query: String): List<Option> {
        val words = fold(query).split(' ', '/', '-').filter { it.isNotBlank() }
        if (words.isEmpty()) return options
        return options.filter { o -> val text = fold("${o.label} ${o.value} ${o.hint ?: ""}"); words.all { it in text } }
    }
}
