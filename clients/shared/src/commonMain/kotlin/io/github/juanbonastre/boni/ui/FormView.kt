@file:OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)

package io.github.juanbonastre.boni.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.InputChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/** Loads options of a server source (`GET /options/{source}?q=`). */
typealias OptionsLoader = suspend (source: String, query: String) -> List<Option>

/**
 * Renders a server-described form. [onSubmit] returns field errors from the server (empty map = done).
 * The form keeps its values until it is submitted successfully.
 */
@Composable
fun FormView(
    form: FormComponent,
    today: String,
    loadOptions: OptionsLoader,
    onSubmit: suspend (Map<String, JsonElement>) -> Map<String, String>,
    modifier: Modifier = Modifier,
) {
    val values = remember(form) { mutableStateMapOf<String, JsonElement>().apply { putAll(FormLogic.initialValues(form, today)) } }
    var errors by remember(form) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val c = LocalBoniColors.current

    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        for (f in form.fields) {
            if (!FormLogic.isVisible(f, values)) continue
            FieldView(f, values[f.id], errors[f.id], loadOptions) { v ->
                values[f.id] = v
                if (errors.containsKey(f.id)) errors = errors - f.id
            }
        }
        Spacer(Modifier.height(4.dp))
        Button(
            enabled = !sending,
            onClick = {
                val local = FormLogic.clientErrors(form, values)
                if (local.isNotEmpty()) {
                    errors = local
                } else {
                    sending = true
                    scope.launch {
                        errors = try {
                            onSubmit(FormLogic.payload(form, values))
                        } finally {
                            sending = false
                        }
                    }
                }
            },
            modifier = Modifier.fillMaxWidth().height(46.dp),
        ) { Text(if (sending) "Guardando..." else form.submit.label, fontWeight = FontWeight.SemiBold) }
        if (errors.isNotEmpty()) Text("Revisa los campos marcados", color = c.critical, fontSize = 12.sp)
    }
}

@Composable
private fun FieldView(f: FormField, value: JsonElement?, error: String?, loadOptions: OptionsLoader, set: (JsonElement) -> Unit) {
    val c = LocalBoniColors.current
    Column(Modifier.fillMaxWidth()) {
        when (f) {
            is AmountField -> OutlinedTextField(
                value = FormLogic.text(value),
                onValueChange = { t -> if (t.all { it.isDigit() || it == ',' || it == '.' }) set(if (t.isEmpty()) JsonNull else JsonPrimitive(t)) },
                label = { Text(f.label) },
                suffix = { Text(if (f.currency == "EUR") "€" else f.currency) },
                singleLine = true,
                isError = error != null,
                modifier = Modifier.fillMaxWidth(),
            )
            is TextField -> OutlinedTextField(
                value = FormLogic.text(value),
                onValueChange = { t -> set(JsonPrimitive(f.maxLength?.let { t.take(it) } ?: t)) },
                label = { Text(f.label) },
                placeholder = f.placeholder?.let { p -> @Composable { Text(p) } },
                singleLine = !f.multiline,
                isError = error != null,
                modifier = Modifier.fillMaxWidth(),
            )
            is DateField -> DateFieldView(f, FormLogic.text(value), error, set)
            is ToggleField -> Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = (value as? JsonPrimitive)?.content == "true", onCheckedChange = { set(JsonPrimitive(it)) })
                Text(f.label, color = c.ink, modifier = Modifier.padding(start = 10.dp))
            }
            is ChoiceField -> {
                Label(f.label, f.required)
                val inline = f.options
                if (inline != null && !f.searchable) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        inline.forEach { o ->
                            FilterChip(selected = FormLogic.text(value) == o.value, onClick = { set(JsonPrimitive(o.value)) },
                                label = { Text(o.label) })
                        }
                    }
                } else {
                    SearchList(f.source, inline, multi = false, selected = listOfNotNull(FormLogic.text(value).ifEmpty { null }),
                        loadOptions = loadOptions) { picked -> set(picked.firstOrNull()?.let { JsonPrimitive(it) } ?: JsonNull) }
                }
            }
            is MultiChoiceField -> {
                Label(f.label, f.required)
                SearchList(f.source, f.options, multi = true, selected = FormLogic.list(value), loadOptions = loadOptions) { picked ->
                    set(JsonArray(picked.map { JsonPrimitive(it) }))
                }
            }
            is UnknownField -> Text("Campo no disponible: actualiza la app", color = c.muted, fontSize = 12.sp)
        }
        val hint = error ?: f.help
        if (hint != null) {
            Text(hint, color = if (error != null) c.critical else c.muted, fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp, top = 2.dp))
        }
    }
}

@Composable
private fun Label(text: String, required: Boolean) {
    val c = LocalBoniColors.current
    Text(text + if (required) " *" else "", color = c.inkSecondary, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun DateFieldView(f: DateField, value: String, error: String?, set: (JsonElement) -> Unit) {
    val today = remember { value }
    val quick = remember(today) { listOf("Hoy" to today, "Ayer" to shiftIso(today, -1), "Anteayer" to shiftIso(today, -2)) }
    Label(f.label, f.required)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        quick.forEach { (label, iso) -> FilterChip(selected = value == iso, onClick = { set(JsonPrimitive(iso)) }, label = { Text(label) }) }
        OutlinedTextField(value = value, onValueChange = { set(JsonPrimitive(it.take(10))) }, singleLine = true, isError = error != null,
            modifier = Modifier.weight(1f), placeholder = { Text("AAAA-MM-DD") })
    }
}

/** Searchable list of options (inline or from a server source); selected ones shown as removable chips. */
@Composable
private fun SearchList(
    source: String?,
    inline: List<Option>?,
    multi: Boolean,
    selected: List<String>,
    loadOptions: OptionsLoader,
    onChange: (List<String>) -> Unit,
) {
    val c = LocalBoniColors.current
    var query by remember { mutableStateOf("") }
    var options by remember { mutableStateOf(inline.orEmpty()) }
    var open by remember { mutableStateOf(false) }
    val labels = remember { mutableStateMapOf<String, String>() }
    LaunchedEffect(query, open) {
        if (!open && query.isEmpty()) return@LaunchedEffect
        if (source != null) {
            delay(200)
            options = runCatching { loadOptions(source, query) }.getOrDefault(options)
        } else {
            val q = query.lowercase()
            options = inline.orEmpty().filter { q.isEmpty() || it.label.lowercase().contains(q) }
        }
        options.forEach { labels[it.value] = it.label }
    }
    if (selected.isNotEmpty()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 6.dp)) {
            selected.forEach { v ->
                InputChip(selected = true, onClick = { onChange(selected - v) }, label = { Text((labels[v] ?: v) + "  x") })
            }
        }
    }
    OutlinedTextField(
        value = query,
        onValueChange = { query = it; open = true },
        placeholder = { Text("Buscar...") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    if (open || query.isNotEmpty()) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 200.dp)) {
            items(options, key = { it.value }) { o ->
                val isSel = o.value in selected
                Row(
                    Modifier.fillMaxWidth().clickable {
                        labels[o.value] = o.label
                        if (multi) onChange(if (isSel) selected - o.value else selected + o.value)
                        else { onChange(listOf(o.value)); open = false; query = "" }
                    }.padding(vertical = 6.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (multi) Checkbox(checked = isSel, onCheckedChange = null)
                    Column(Modifier.padding(start = 6.dp)) {
                        Text(o.label, color = c.ink, fontSize = 14.sp)
                        o.hint?.let { Text(it, color = c.muted, fontSize = 11.sp) }
                    }
                }
            }
        }
    } else if (selected.isEmpty()) {
        Text("Escribe para buscar", color = c.muted, fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp, top = 2.dp))
    }
}

/** "2026-10-12" shifted by days (pure, for the quick date chips). */
fun shiftIso(iso: String, days: Int): String {
    val parts = iso.split("-").mapNotNull { it.toIntOrNull() }
    if (parts.size != 3) return iso
    var (y, m, d) = parts
    var left = days
    fun daysIn(year: Int, month: Int) = when (month) {
        2 -> if ((year % 4 == 0 && year % 100 != 0) || year % 400 == 0) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }
    while (left < 0) {
        d--
        if (d == 0) { m--; if (m == 0) { m = 12; y-- }; d = daysIn(y, m) }
        left++
    }
    while (left > 0) {
        d++
        if (d > daysIn(y, m)) { d = 1; m++; if (m == 13) { m = 1; y++ } }
        left--
    }
    return "${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}"
}
