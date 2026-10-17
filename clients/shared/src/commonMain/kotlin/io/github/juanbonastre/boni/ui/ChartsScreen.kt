@file:OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)

package io.github.juanbonastre.boni.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.juanbonastre.boni.BoniController
import io.github.juanbonastre.boni.api.ApiException
import io.github.juanbonastre.boni.api.CatalogItem
import io.github.juanbonastre.boni.api.ChartCatalog
import io.github.juanbonastre.boni.api.ChartFilterRule
import io.github.juanbonastre.boni.api.ChartSpec
import io.github.juanbonastre.boni.api.Dimension
import io.github.juanbonastre.boni.api.FieldInfo
import io.github.juanbonastre.boni.api.OfflineException
import io.github.juanbonastre.boni.api.Option
import io.github.juanbonastre.boni.api.Period
import io.github.juanbonastre.boni.data.ChartState
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

private val SIZES = listOf("small" to "Pequeno", "medium" to "Mediano", "large" to "Grande")

private fun errorText(e: Exception): String = when (e) {
    is OfflineException -> "Sin conexion con el servidor"
    is ApiException -> e.message
    else -> e.message ?: "Error"
}

// =====================================================================================================================
// The list: every chart (edit, duplicate, order, show on the home screen) and the widgets of this device.
// =====================================================================================================================
@Composable
fun ChartsScreen(controller: BoniController, onEdit: (ChartSpec) -> Unit, onMessage: (String) -> Unit) {
    val c = LocalBoniColors.current
    val scope = rememberCoroutineScope()
    var catalog by remember { mutableStateOf<ChartCatalog?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(controller.refreshTick, controller.config) {
        error = null
        try {
            controller.loadCharts()
            controller.loadWidgets()
            catalog = controller.catalog()
        } catch (e: Exception) {
            error = errorText(e)
        }
    }
    fun act(block: suspend () -> Unit) {
        scope.launch {
            try { block() } catch (e: Exception) { onMessage(errorText(e)) }
        }
    }
    val specs = controller.chartSpecs
    Column(Modifier.widthIn(max = 900.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Tus graficas", color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Button(onClick = { onEdit(ChartBuilder.newSpec()) }) { Text("+  Nueva grafica") }
        }
        error?.let { Text(it, color = c.critical, fontSize = 12.sp) }
        specs.forEachIndexed { i, spec ->
            Surface(shape = RoundedCornerShape(12.dp), color = c.surface, modifier = Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(12.dp))) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(spec.title, color = c.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                        Text(ChartBuilder.describe(spec, catalog), color = c.muted, fontSize = 12.sp)
                    }
                    Text("Inicio", color = c.inkSecondary, fontSize = 12.sp, modifier = Modifier.padding(end = 6.dp))
                    Switch(checked = spec.home, onCheckedChange = { on -> act { controller.saveChart(spec.copy(home = on)) } })
                    TextButton(enabled = i > 0, onClick = {
                        val ids = specs.map { it.id }.toMutableList().apply { add(i - 1, removeAt(i)) }
                        act { controller.orderCharts(ids) }
                    }) { Text("Subir") }
                    TextButton(enabled = i < specs.lastIndex, onClick = {
                        val ids = specs.map { it.id }.toMutableList().apply { add(i + 1, removeAt(i)) }
                        act { controller.orderCharts(ids) }
                    }) { Text("Bajar") }
                    TextButton(onClick = { onEdit(ChartBuilder.duplicate(spec)) }) { Text("Duplicar") }
                    Button(onClick = { onEdit(spec) }) { Text("Editar") }
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        WidgetsSection(controller, specs, ::act)
    }
}

@Composable
private fun WidgetsSection(controller: BoniController, specs: List<ChartSpec>, act: (suspend () -> Unit) -> Unit) {
    val c = LocalBoniColors.current
    Text("Widgets de este equipo", color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    Text("Las graficas que este equipo muestra en el escritorio. Se pueden mover arrastrando y cambiar de tamano desde el borde.",
        color = c.muted, fontSize = 12.sp)
    controller.widgets.forEach { w ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Picker(
                label = controller.chartTitle(w.chartId) ?: w.chartId,
                options = specs.map { it.id to it.title },
                onPick = { id -> act { controller.updateWidget(w.id, id, w.size) } },
            )
            SIZES.forEach { (id, label) ->
                FilterChip(selected = w.size == id, onClick = { act { controller.updateWidget(w.id, w.chartId, id) } }, label = { Text(label) })
            }
            TextButton(onClick = { act { controller.removeWidget(w.id) } }) { Text("Quitar") }
        }
    }
    if (specs.isNotEmpty()) {
        Picker(label = "+  Anadir widget", options = specs.map { it.id to it.title }, onPick = { id -> act { controller.addWidget(id, "medium") } })
    }
}

/** A button that opens a menu of options. */
@Composable
private fun Picker(label: String, options: List<Pair<String, String>>, onPick: (String) -> Unit, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, enabled = enabled) { Text(label, maxLines = 1) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (id, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(id) })
            }
        }
    }
}

// =====================================================================================================================
// The editor: options on one side, live preview (computed by the server, not saved) on the other.
// =====================================================================================================================
@Composable
fun ChartEditor(controller: BoniController, initial: ChartSpec, onClose: () -> Unit, onMessage: (String) -> Unit) {
    val c = LocalBoniColors.current
    val scope = rememberCoroutineScope()
    var spec by remember(initial) { mutableStateOf(ChartBuilder.normalize(initial)) }
    var catalog by remember { mutableStateOf<ChartCatalog?>(null) }
    var preview by remember { mutableStateOf(ChartState(loading = true)) }
    var previewDrill by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        catalog = runCatching { controller.catalog() }.getOrNull()
    }
    // Recompute the preview when the definition settles (typing a title or a number should not send a request per key).
    LaunchedEffect(spec, previewDrill) {
        delay(350)
        preview = preview.copy(loading = true)
        preview = try {
            ChartState(data = controller.preview(spec, previewDrill))
        } catch (e: Exception) {
            ChartState(data = null, error = errorText(e), offline = e is OfflineException)
        }
    }
    fun edit(change: (ChartSpec) -> ChartSpec) {
        spec = ChartBuilder.normalize(change(spec))
        previewDrill = null
    }

    val cat = catalog
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth > 900.dp
        val previewPane = @Composable { mod: Modifier ->
            Column(mod) {
                ChartCardContent(
                    title = spec.title, state = preview, modifier = Modifier.fillMaxWidth(), chartHeight = if (wide) 320.dp else 220.dp,
                    onDrill = { previewDrill = it }, onBack = if (previewDrill != null) ({ previewDrill = null }) else null,
                )
                if (preview.error != null && preview.data == null) Text(preview.error ?: "", color = c.critical, fontSize = 12.sp,
                    modifier = Modifier.padding(top = 8.dp))
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(enabled = !saving && spec.title.isNotBlank(), onClick = {
                        saving = true
                        scope.launch {
                            try {
                                controller.saveChart(spec)
                                onMessage("Grafica guardada")
                                onClose()
                            } catch (e: Exception) {
                                onMessage(errorText(e))
                            } finally {
                                saving = false
                            }
                        }
                    }) { Text(if (spec.id.isEmpty()) "Crear grafica" else "Guardar") }
                    TextButton(onClick = onClose) { Text("Cancelar") }
                    Spacer(Modifier.weight(1f))
                    if (spec.id.isNotEmpty()) {
                        TextButton(onClick = {
                            if (!confirmDelete) confirmDelete = true
                            else scope.launch {
                                try {
                                    controller.deleteChart(spec.id)
                                    onMessage("Grafica borrada")
                                    onClose()
                                } catch (e: Exception) {
                                    onMessage(errorText(e))
                                }
                            }
                        }) { Text(if (confirmDelete) "Seguro? Pulsa otra vez para borrar" else "Borrar", color = c.critical) }
                    }
                }
            }
        }
        val form = @Composable { mod: Modifier ->
            Column(mod.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (cat == null) {
                    Text("Cargando opciones...", color = c.muted)
                } else {
                    EditorForm(spec, cat, controller, ::edit)
                }
                Spacer(Modifier.height(24.dp))
            }
        }
        if (wide) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                form(Modifier.weight(1f).fillMaxSize())
                previewPane(Modifier.weight(1.1f))
            }
        } else {
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                previewPane(Modifier.fillMaxWidth())
                form(Modifier.weight(1f).fillMaxWidth())
            }
        }
    }
}

@Composable
private fun Section(title: String, help: String? = null, content: @Composable () -> Unit) {
    val c = LocalBoniColors.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = c.ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        if (help != null) Text(help, color = c.muted, fontSize = 11.sp)
        content()
    }
}

@Composable
private fun Chips(items: List<CatalogItem>, selected: String?, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        items.forEach { item -> FilterChip(selected = item.id == selected, onClick = { onSelect(item.id) }, label = { Text(item.label) }) }
    }
}

/** A dimension: a field, and for dates its granularity. [none] adds a "nothing" choice (for the series). */
@Composable
private fun DimensionPicker(value: Dimension?, cat: ChartCatalog, none: String?, onChange: (Dimension?) -> Unit) {
    val fields = cat.fields.filter { it.canGroup }
    val items = (if (none != null) listOf(CatalogItem("", none)) else emptyList()) + fields.map { CatalogItem(it.id, it.label) }
    Chips(items, value?.field ?: "") { id -> onChange(if (id.isEmpty()) null else Dimension(id, if (id == "date") "month" else null)) }
    if (value != null && value.field == "date") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Por", color = LocalBoniColors.current.muted, fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
            Chips(cat.granularities, value.granularity ?: "month") { g -> onChange(value.copy(granularity = g)) }
        }
    }
}

/** A small whole number. Empty is passed on only when [allowEmpty] (otherwise the last number stays until a new one is typed). */
@Composable
private fun NumberField(label: String, value: Int?, allowEmpty: Boolean = false, modifier: Modifier = Modifier, onChange: (Int?) -> Unit) {
    var text by remember(value) { mutableStateOf(value?.toString() ?: "") }
    OutlinedTextField(
        value = text,
        onValueChange = { t ->
            text = t.filter { it.isDigit() }.take(3)
            val n = text.toIntOrNull()?.takeIf { it > 0 }
            if (n != null || allowEmpty) onChange(n)
        },
        label = { Text(label) }, singleLine = true, modifier = modifier.width(200.dp),
    )
}

@Composable
private fun DateInput(label: String, value: String?, onChange: (String?) -> Unit) {
    var text by remember(value) { mutableStateOf(value ?: "") }
    OutlinedTextField(
        value = text,
        onValueChange = { t ->
            text = t.take(10)
            // only complete dates (or nothing) reach the definition: half-typed ones would reset the field
            if (ChartBuilder.isIsoDate(text)) onChange(text.trim()) else if (text.isEmpty()) onChange(null)
        },
        label = { Text(label) }, placeholder = { Text("AAAA-MM-DD") }, singleLine = true,
        isError = text.isNotEmpty() && !ChartBuilder.isIsoDate(text), modifier = Modifier.width(200.dp),
    )
}

@Composable
private fun EditorForm(spec: ChartSpec, cat: ChartCatalog, controller: BoniController, edit: ((ChartSpec) -> ChartSpec) -> Unit) {
    val c = LocalBoniColors.current
    OutlinedTextField(spec.title, { t -> edit { it.copy(title = t.take(80)) } }, label = { Text("Titulo") }, singleLine = true,
        modifier = Modifier.fillMaxWidth())

    Section("Tipo", cat.kinds.firstOrNull { it.id == spec.kind }?.help) {
        Chips(cat.kinds, spec.kind) { k -> edit { it.copy(kind = k) } }
    }
    Section("Que se mide", cat.measures.firstOrNull { it.id == spec.measure }?.help) {
        Chips(cat.measures, spec.measure) { m -> edit { it.copy(measure = m) } }
    }
    if (spec.kind != "number") {
        Section(if (spec.kind == "hbar" || spec.kind == "donut" || spec.kind == "table") "Agrupar por" else "Eje horizontal") {
            DimensionPicker(spec.x, cat, none = null) { d -> edit { it.copy(x = d) } }
        }
    }
    if (spec.kind in ChartBuilder.SPLIT_KINDS) {
        Section("Separar en series", "Una linea o barra por cada valor de otro campo (las 5 mayores y Otros)") {
            DimensionPicker(spec.split, cat, none = if (spec.kind == "stacked_bar") null else "Sin series") { d -> edit { it.copy(split = d) } }
        }
    }
    Section("Periodo") {
        Chips(cat.periods, spec.period.kind) { k -> edit { it.copy(period = Period(k)) } }
        when (spec.period.kind) {
            "last_months" -> NumberField("Cuantos meses (con el actual)", spec.period.months) { n ->
                edit { it.copy(period = it.period.copy(months = n ?: 12)) }
            }
            "last_days" -> NumberField("Cuantos dias (con hoy)", spec.period.days) { n -> edit { it.copy(period = it.period.copy(days = n ?: 30)) } }
            "range" -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DateInput("Desde", spec.period.start) { d -> edit { it.copy(period = it.period.copy(start = d)) } }
                DateInput("Hasta", spec.period.end) { d -> edit { it.copy(period = it.period.copy(end = d)) } }
            }
            else -> Unit
        }
    }
    if (spec.split == null && spec.kind != "donut") {
        Section("Comparar", "Si el periodo no ha terminado se compara el mismo tramo (p. ej. del 1 al 12)") {
            Chips(cat.compares, spec.compare) { v -> edit { it.copy(compare = v) } }
        }
    }
    FiltersEditor(spec, cat, controller, edit)
    if (spec.kind != "number") {
        Section("Orden y detalle") {
            if (spec.x?.field != "date") {
                NumberField("Mostrar solo los N mayores (vacio: todos)", spec.top, allowEmpty = true) { n ->
                    edit { it.copy(top = n?.coerceIn(1, 50)) }
                }
            }
            Chips(listOf(CatalogItem("auto", "Automatico"), CatalogItem("value_desc", "De mayor a menor"),
                CatalogItem("value_asc", "De menor a mayor"), CatalogItem("label", "Alfabetico")), spec.sort) { v -> edit { it.copy(sort = v) } }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = spec.drilldown, onCheckedChange = { on -> edit { it.copy(drilldown = on) } })
                Text("Al tocar un punto, ver su detalle", color = c.inkSecondary, modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Switch(checked = spec.home, onCheckedChange = { on -> edit { it.copy(home = on) } })
        Text("Mostrar en la pantalla de inicio", color = c.inkSecondary, modifier = Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun FiltersEditor(spec: ChartSpec, cat: ChartCatalog, controller: BoniController, edit: ((ChartSpec) -> ChartSpec) -> Unit) {
    val c = LocalBoniColors.current
    fun setRule(i: Int, rule: ChartFilterRule?) = edit { s ->
        s.copy(filters = s.filters.toMutableList().apply { if (rule == null) removeAt(i) else set(i, rule) })
    }
    Section("Filtros", "Solo cuentan los movimientos que cumplen todos") {
        spec.filters.forEachIndexed { i, rule ->
            val field = cat.fields.firstOrNull { it.id == rule.field }
            Surface(shape = RoundedCornerShape(10.dp), color = c.page, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Picker(field?.label ?: rule.field, cat.fields.map { it.id to it.label }, onPick = { f -> setRule(i, ChartBuilder.newRule(f, cat)) })
                        Picker(ChartBuilder.opLabel(rule.field, rule.op), (field?.ops ?: listOf(rule.op)).map { it to ChartBuilder.opLabel(rule.field, it) },
                            onPick = { op ->
                                // values of "es" (a list) do not carry over to "contiene" (a text), and vice versa
                                val keep = (op in setOf("in", "not_in", "prefix", "not_prefix")) == (rule.op in setOf("in", "not_in", "prefix", "not_prefix"))
                                setRule(i, rule.copy(op = op, values = if (keep && ChartBuilder.needsValues(op)) rule.values else emptyList()))
                            })
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { setRule(i, null) }) { Text("Quitar") }
                    }
                    if (field != null && ChartBuilder.needsValues(rule.op)) RuleValues(rule, field, controller) { v -> setRule(i, rule.copy(values = v)) }
                }
            }
        }
        Picker("+  Anadir filtro", cat.fields.map { it.id to it.label }, onPick = { f -> edit { it.copy(filters = it.filters + ChartBuilder.newRule(f, cat)) } })
    }
}

@Composable
private fun RuleValues(rule: ChartFilterRule, field: FieldInfo, controller: BoniController, onChange: (List<JsonPrimitive>) -> Unit) {
    val current = rule.values.map { it.content }
    when {
        field.kind == "time" -> DateInput(if (rule.op == "gte") "Desde" else "Hasta", current.firstOrNull()) { d ->
            onChange(listOfNotNull(d?.let { JsonPrimitive(it) }))
        }
        field.kind == "number" -> {
            var text by remember(rule.field, rule.op) { mutableStateOf(current.firstOrNull() ?: "") }
            OutlinedTextField(text, { t ->
                text = t.filter { it.isDigit() || it == ',' || it == '.' }.take(10)
                onChange(listOfNotNull(FormLogic.parseAmount(text)?.let { JsonPrimitive(it) }))
            }, label = { Text("Importe (EUR)") }, singleLine = true, modifier = Modifier.width(200.dp))
        }
        rule.op == "contains" || rule.op == "not_contains" || field.source == null -> {
            var text by remember(rule.field, rule.op) { mutableStateOf(current.firstOrNull() ?: "") }
            OutlinedTextField(text, { t -> text = t.take(60); onChange(if (text.isBlank()) emptyList() else listOf(JsonPrimitive(text.trim()))) },
                label = { Text("Texto (sin importar acentos ni mayusculas)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        }
        else -> {
            // "es del grupo o es" on categories offers whole groups ("comida") and single categories ("comida/restaurante").
            val prefix = field.id == "category" && (rule.op == "prefix" || rule.op == "not_prefix")
            SearchList(
                source = if (prefix) "groups+categories" else field.source,
                inline = null,
                multi = true,
                selected = current,
                loadOptions = { source, _ ->
                    if (source == "groups+categories") {
                        controller.optionList("groups").map { Option(it.value, it.label + " (todo el grupo)") } + controller.optionList("categories")
                    } else controller.optionList(source)
                },
                onChange = { vs -> onChange(vs.map { JsonPrimitive(it) }) },
            )
        }
    }
}
