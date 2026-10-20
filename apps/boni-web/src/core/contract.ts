/**
 * Client side of the API v1 contract. Source of truth: `server/boni/contract.py` (JSON schema in `api/schema/`).
 * Field names are the wire names (snake_case). Unknown fields are ignored; unknown component and field types
 * become `{ type: "unknown" }` so an older client keeps working (it shows "update the app" in their place).
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface Option {
  value: string;
  label: string;
  hint?: string | null;
}

export interface Condition {
  field: string;
  equals: Json;
}

interface FieldBase {
  id: string;
  label: string;
  required?: boolean;
  help?: string | null;
  visible_when?: Condition | null;
}

export interface AmountField extends FieldBase {
  type: "amount";
  currency?: string;
  default?: number | null;
  min?: number | null;
  max?: number | null;
}

export interface TextField extends FieldBase {
  type: "text";
  default?: string | null;
  max_length?: number | null;
  multiline?: boolean;
  placeholder?: string | null;
}

export interface DateField extends FieldBase {
  type: "date";
  default?: string | null;
}

export interface ChoiceField extends FieldBase {
  type: "choice";
  options?: Option[] | null;
  source?: string | null;
  searchable?: boolean;
  style?: string;
  default?: string | null;
}

export interface MultiChoiceField extends FieldBase {
  type: "multi_choice";
  options?: Option[] | null;
  source?: string | null;
  searchable?: boolean;
  default?: string[];
}

export interface ToggleField extends FieldBase {
  type: "toggle";
  default?: boolean;
}

export interface UnknownField extends FieldBase {
  type: "unknown";
  /** The type the server sent. */
  original: string;
}

export type FormField =
  | AmountField
  | TextField
  | DateField
  | ChoiceField
  | MultiChoiceField
  | ToggleField
  | UnknownField;

export interface TextComponent {
  type: "text";
  text: string;
  style?: string;
}

export interface ButtonComponent {
  type: "button";
  label: string;
  screen: string;
  icon?: string | null;
  style?: string;
}

export interface FormComponent {
  type: "form";
  id: string;
  fields: FormField[];
  submit: { action: string; label: string };
}

export interface ChartCardComponent {
  type: "chart_card";
  chart_id: string;
  title: string;
  size?: string;
}

export interface UnknownComponent {
  type: "unknown";
  original: string;
}

export type Component =
  | TextComponent
  | ButtonComponent
  | FormComponent
  | ChartCardComponent
  | UnknownComponent;

export interface Screen {
  id: string;
  title: string;
  components: Component[];
  api_version?: string;
}

export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  partial?: boolean;
  no_data?: boolean;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
  key?: string;
  /** "main", "split" (one value of the split field) or "compare" (the compared period). */
  role?: "main" | "split" | "compare" | string;
}

export interface ChartData {
  chart_id: string;
  title: string;
  subtitle?: string | null;
  kind: string;
  measure?: string;
  /** "EUR" or "" (counts). */
  unit?: string;
  series: ChartSeries[];
  total?: number | null;
  previous_total?: number | null;
  delta_pct?: number | null;
  average?: number | null;
  x_label?: string | null;
  drilldown?: boolean;
  drill?: string | null;
  computed_at: string;
  stale?: boolean;
}

export interface Period {
  kind: string;
  months?: number | null;
  days?: number | null;
  start?: string | null;
  end?: string | null;
}

export interface Dimension {
  field: string;
  granularity?: string | null;
}

export interface ChartFilterRule {
  field: string;
  op: string;
  values: (string | number | boolean)[];
}

export interface ChartSpec {
  id: string;
  title: string;
  kind: string;
  measure: string;
  x: Dimension | null;
  split: Dimension | null;
  period: Period;
  filters: ChartFilterRule[];
  compare: string;
  top: number | null;
  sort: string;
  drilldown: boolean;
  home: boolean;
  /** The chart's colour, from Boni Calendar's palette (`#rrggbb`); null = the accent. */
  color: string | null;
}

export interface FieldInfo {
  id: string;
  label: string;
  /** "time", "set", "multi", "text" or "number". */
  kind: string;
  ops: string[];
  source?: string | null;
  can_group?: boolean;
}

export interface CatalogItem {
  id: string;
  label: string;
  help?: string | null;
}

export interface ChartCatalog {
  fields: FieldInfo[];
  kinds: CatalogItem[];
  measures: CatalogItem[];
  granularities: CatalogItem[];
  periods: CatalogItem[];
  compares: CatalogItem[];
}

export interface Widget {
  id: string;
  chart_id: string;
  size: string;
}

/**
 * Something to capture again with one tap: a server screen and the values for its form. `open` shows the form
 * filled in, `save` sends it at once. Shared by every device, like charts.
 */
export interface Shortcut {
  id: string;
  label: string;
  screen: string;
  values: Record<string, Json>;
  mode: "open" | "save";
  color: string | null;
}

export interface ActionRequest {
  action: string;
  client_id: string;
  values: Record<string, Json>;
  created_at?: string | null;
}

export interface ActionResult {
  status: "ok" | "queued" | "invalid" | "error" | string;
  message?: string | null;
  field_errors?: Record<string, string>;
  navigate?: string | null;
}

const FIELD_TYPES = new Set(["amount", "text", "date", "choice", "multi_choice", "toggle"]);
const COMPONENT_TYPES = new Set(["text", "button", "form", "chart_card"]);

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseField(raw: unknown): FormField {
  const o = isObject(raw) ? raw : {};
  const type = String(o.type ?? "");
  if (FIELD_TYPES.has(type)) return o as unknown as FormField;
  return {
    type: "unknown",
    original: type,
    id: String(o.id ?? ""),
    label: String(o.label ?? ""),
    required: Boolean(o.required),
  };
}

export function parseComponent(raw: unknown): Component {
  const o = isObject(raw) ? raw : {};
  const type = String(o.type ?? "");
  if (!COMPONENT_TYPES.has(type)) return { type: "unknown", original: type };
  if (type === "form") {
    return {
      ...(o as unknown as FormComponent),
      fields: (Array.isArray(o.fields) ? o.fields : []).map(parseField),
    };
  }
  return o as unknown as Component;
}

export function parseScreen(raw: unknown): Screen {
  const o = isObject(raw) ? raw : {};
  return {
    id: String(o.id ?? ""),
    title: String(o.title ?? ""),
    api_version: o.api_version == null ? undefined : String(o.api_version),
    components: (Array.isArray(o.components) ? o.components : []).map(parseComponent),
  };
}

/** A chart definition with every field present (the server may omit defaults). */
export function parseSpec(raw: unknown): ChartSpec {
  const o = isObject(raw) ? raw : {};
  return {
    id: String(o.id ?? ""),
    title: String(o.title ?? ""),
    kind: String(o.kind ?? "bar"),
    measure: String(o.measure ?? "spending"),
    x: isObject(o.x) ? (o.x as unknown as Dimension) : null,
    split: isObject(o.split) ? (o.split as unknown as Dimension) : null,
    period: isObject(o.period) ? (o.period as unknown as Period) : { kind: "this_month" },
    filters: Array.isArray(o.filters)
      ? (o.filters as ChartFilterRule[]).map((f) => ({ ...f, values: f.values ?? [] }))
      : [],
    compare: String(o.compare ?? "none"),
    top: typeof o.top === "number" ? o.top : null,
    sort: String(o.sort ?? "auto"),
    drilldown: Boolean(o.drilldown),
    home: o.home === undefined ? true : Boolean(o.home),
    color: typeof o.color === "string" && /^#[0-9a-f]{6}$/.test(o.color) ? o.color : null,
  };
}

/** A shortcut with every field present (the server may omit defaults; a newer one may add modes). */
export function parseShortcut(raw: unknown): Shortcut {
  const o = isObject(raw) ? raw : {};
  return {
    id: String(o.id ?? ""),
    label: String(o.label ?? ""),
    screen: String(o.screen ?? ""),
    values: isObject(o.values) ? (o.values as Record<string, Json>) : {},
    mode: o.mode === "save" ? "save" : "open",
    color: typeof o.color === "string" && /^#[0-9a-f]{6}$/.test(o.color) ? o.color : null,
  };
}
