import {
  addDays,
  type Day,
  dayOf,
  diffDays,
  isoWeek,
  isoWeekday,
  lastDay,
  make,
  month,
  monthsBetween,
  shiftMonths,
  year,
} from "./dates.ts";
import { pyRound, pySum } from "./pyround.ts";

/**
 * The chart engine (docs/nucleo.md, 8), ported function by function from the first Boni's
 * `server/boni/stats/engine.py` (the archived repo boni-pruebas) so that a chart gives exactly the same numbers; the
 * golden test runs the original Python on invented data and compares. What was specific to money
 * movements (which fields there are, how a value is labelled, what "spending" means) is a `Profile`,
 * so the same engine draws charts of any entity type.
 * A chart is a definition, never data: computed here, drawn by the client.
 */

export type Granularity = "day" | "week" | "month" | "quarter" | "year" | "weekday";
export type ChartKind =
  | "bar"
  | "stacked_bar"
  | "hbar"
  | "line"
  | "area"
  | "donut"
  | "number"
  | "table";

export interface Dimension {
  field: string;
  granularity?: Granularity | null;
}

export interface FilterRule {
  field: string;
  op:
    | "in"
    | "not_in"
    | "prefix"
    | "not_prefix"
    | "contains"
    | "not_contains"
    | "gte"
    | "lte"
    | "empty"
    | "not_empty";
  values?: (string | number)[];
}

export interface Period {
  kind:
    | "this_month"
    | "last_month"
    | "last_months"
    | "this_year"
    | "last_year"
    | "last_days"
    | "range"
    | "all";
  months?: number | null;
  days?: number | null;
  start?: string | null;
  end?: string | null;
}

export interface ChartSpec {
  id?: string;
  title: string;
  kind: ChartKind;
  measure?: string;
  x?: Dimension | null;
  split?: Dimension | null;
  period: Period;
  filters?: FilterRule[];
  compare?: "none" | "previous_period" | "previous_year";
  top?: number | null;
  sort?: "auto" | "value_desc" | "value_asc" | "label";
  drilldown?: boolean;
}

export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  partial: boolean;
  no_data: boolean;
}
export interface ChartSeries {
  key: string;
  name: string;
  points: ChartPoint[];
  role: "main" | "split" | "compare";
}
export interface ChartData {
  chart_id: string;
  title: string;
  subtitle: string | null;
  kind: ChartKind;
  measure: string;
  unit: string;
  series: ChartSeries[];
  total: number | null;
  previous_total: number | null;
  delta_pct: number | null;
  average: number | null;
  x_label: string | null;
  drilldown: boolean;
  drill: string | null;
  stale: boolean;
}

/** What the engine needs to know about one kind of record. */
export interface Profile<R> {
  /** The record's day ("YYYY-MM-DD"): periods and time axes use it. */
  day(r: R): Day;
  /** The record's values of a field, as text ([""] when empty). */
  values(r: R, field: string): string[];
  /** Fields compared folded (accent- and case-insensitive) when grouping. */
  folded: ReadonlySet<string>;
  /** Fields whose prefix filter matches whole path segments ("comida" matches "comida/cafe"). */
  pathLike: ReadonlySet<string>;
  /** Numeric fields: filtered by gte/lte on `number`, never grouped. */
  number(r: R, field: string): number | null;
  isNumber(field: string): boolean;
  /** The labeller of a field for a set of keys (folded keys for folded fields). */
  labeler(field: string, keys: string[]): (key: string) => string;
  /** The value of a measure over records (rounded by the engine). */
  measure(measure: string, recs: R[]): number;
  /** Whether a record takes part in a measure at all. */
  relevant(r: R, measure: string): boolean;
  unit(measure: string): string;
  /** Where the period "all" starts. */
  allStart: Day;
  /** Whether `measure` is an average (no reference line). */
  isAverage(measure: string): boolean;
}

export class SpecError extends Error {}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const MONTHS_SHORT = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];
export const WEEKDAYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
const MAX_SPLIT = 6;
export const REST = "_rest";
export const OTHER = "_other";
const SPLIT_KINDS = new Set<ChartKind>(["bar", "stacked_bar", "line", "area", "table"]);

/** accent-free, lower case, trimmed (Python's fold: ascii_text(str(v)).lower().strip()). */
export const fold = (v: unknown) =>
  String(v)
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .trim();
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Missing granularities become "month", as the Python model did when reading a spec. */
export function normalized(spec: ChartSpec): ChartSpec {
  const s: ChartSpec = structuredClone(spec);
  if (s.x && s.x.field === "date" && !s.x.granularity) s.x.granularity = "month";
  if (s.split && s.split.field === "date" && !s.split.granularity) s.split.granularity = "month";
  return s;
}

// ---------------------------------------------------------------- dates

const monthAligned = (start: Day, end: Day) =>
  dayOf(start) === 1 && end === lastDay(year(end), month(end));

export function periodRange(spec: ChartSpec, today: Day, allStart: Day): [Day, Day] {
  const p = spec.period;
  const first = make(year(today), month(today), 1);
  switch (p.kind) {
    case "this_month":
      return [first, lastDay(year(today), month(today))];
    case "last_month": {
      const s = shiftMonths(first, -1);
      return [s, lastDay(year(s), month(s))];
    }
    case "last_months":
      return [shiftMonths(first, -((p.months || 12) - 1)), lastDay(year(today), month(today))];
    case "this_year":
      return [make(year(today), 1, 1), make(year(today), 12, 31)];
    case "last_year":
      return [make(year(today) - 1, 1, 1), make(year(today) - 1, 12, 31)];
    case "last_days":
      return [addDays(today, -((p.days || 30) - 1)), today];
    case "range":
      return [String(p.start), String(p.end)];
    default:
      return [allStart, lastDay(year(today), month(today))];
  }
}

export function compareRange(spec: ChartSpec, start: Day, end: Day, today: Day): [Day, Day] | null {
  const c = spec.compare ?? "none";
  if (c === "none") return null;
  let ps: Day;
  let pe: Day;
  let cut: Day;
  if (c === "previous_year") {
    ps = shiftMonths(start, -12);
    pe = shiftMonths(end, -12);
    cut = shiftMonths(today, -12);
  } else if (monthAligned(start, end)) {
    const n = (year(end) - year(start)) * 12 + month(end) - month(start) + 1;
    ps = shiftMonths(start, -n);
    const m = shiftMonths(make(year(end), month(end), 1), -n);
    pe = lastDay(year(m), month(m));
    cut = shiftMonths(today, -n);
  } else {
    const days = diffDays(end, start) + 1;
    ps = addDays(start, -days);
    pe = addDays(end, -days);
    cut = addDays(today, -days);
  }
  if (start <= today && today <= end) pe = pe < cut ? pe : cut; // not over yet: the same stretch "so far"
  return [ps, pe];
}

export function describeRange(start: Day, end: Day, today: Day): string {
  let text: string;
  if (monthAligned(start, end)) {
    if (year(start) === year(end) && month(start) === month(end))
      text = `${MONTHS[month(start) - 1]} ${year(start)}`;
    else if (month(start) === 1 && month(end) === 12 && year(start) === year(end))
      text = String(year(start));
    else
      text = `${MONTHS_SHORT[month(start) - 1]} ${year(start)} - ${MONTHS_SHORT[month(end) - 1]} ${year(end)}`;
  } else
    text = `${dayOf(start)}/${month(start)}/${year(start)} - ${dayOf(end)}/${month(end)}/${year(end)}`;
  if (start <= today && today <= end && today < end) text += " - hasta hoy";
  return text;
}

// ---------------------------------------------------------------- time buckets

export interface Bucket {
  key: string;
  label: string;
  start: Day;
  end: Day;
}

export function timeKey(d: Day, gran: Granularity): string {
  switch (gran) {
    case "day":
      return d;
    case "week": {
      const [y, w] = isoWeek(d);
      return `${y}-W${String(w).padStart(2, "0")}`;
    }
    case "quarter":
      return `${year(d)}-Q${Math.floor((month(d) - 1) / 3) + 1}`;
    case "year":
      return String(year(d));
    case "weekday":
      return String(isoWeekday(d));
    default:
      return `${String(year(d)).padStart(4, "0")}-${String(month(d)).padStart(2, "0")}`;
  }
}

export function timeBuckets(start: Day, end: Day, gran: Granularity): Bucket[] {
  if (gran === "weekday")
    return WEEKDAYS.map((label, i) => ({ key: String(i + 1), label, start, end }));
  const manyYears = year(start) !== year(end);
  const out: Bucket[] = [];
  let d = start;
  while (d <= end) {
    let bEnd: Day;
    let label: string;
    switch (gran) {
      case "day":
        bEnd = d;
        label = `${dayOf(d)}/${month(d)}`;
        break;
      case "week": {
        const monday = addDays(d, -(isoWeekday(d) - 1));
        bEnd = addDays(monday, 6);
        label = `${dayOf(monday)} ${MONTHS_SHORT[month(monday) - 1]}`;
        break;
      }
      case "quarter": {
        const q = Math.floor((month(d) - 1) / 3);
        bEnd = lastDay(year(d), q * 3 + 3);
        label = `T${q + 1} ${String(year(d) % 100).padStart(2, "0")}`;
        break;
      }
      case "year":
        bEnd = make(year(d), 12, 31);
        label = String(year(d));
        break;
      default:
        bEnd = lastDay(year(d), month(d));
        label =
          (MONTHS_SHORT[month(d) - 1] as string) +
          (manyYears ? ` ${String(year(d) % 100).padStart(2, "0")}` : "");
    }
    out.push({ key: timeKey(d, gran), label, start: d, end: bEnd < end ? bEnd : end });
    d = addDays(bEnd, 1);
  }
  return out;
}

// ---------------------------------------------------------------- filters

function num(v: unknown): number | null {
  const s = String(v).replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const prefixMatch = (value: string, prefix: string, pathLike: boolean) => {
  if (!pathLike) return value.startsWith(prefix);
  const p = prefix.replace(/\/+$/, "");
  return value === p || value.startsWith(`${p}/`);
};

export function matches<R>(p: Profile<R>, r: R, rule: FilterRule): boolean {
  const values = rule.values ?? [];
  if (rule.field === "date") {
    const bound = values.length ? String(values[0]) : "";
    const iso = p.day(r);
    return rule.op === "gte" ? iso >= bound : rule.op === "lte" ? iso <= bound : true;
  }
  if (p.isNumber(rule.field)) {
    const n = values.length ? num(values[0]) : null;
    if (n === null) return true;
    const v = p.number(r, rule.field) ?? 0;
    return rule.op === "gte" ? v >= n : rule.op === "lte" ? v <= n : true;
  }
  const vals = p.values(r, rule.field).map(fold);
  const wanted = values.map(fold);
  const path = p.pathLike.has(rule.field);
  switch (rule.op) {
    case "in":
      return vals.some((v) => wanted.includes(v));
    case "not_in":
      return !vals.some((v) => wanted.includes(v));
    case "prefix":
      return vals.some((v) => wanted.some((w) => prefixMatch(v, w, path)));
    case "not_prefix":
      return !vals.some((v) => wanted.some((w) => prefixMatch(v, w, path)));
    case "contains":
      return vals.some((v) => wanted.some((w) => w !== "" && v.includes(w)));
    case "not_contains":
      return !vals.some((v) => wanted.some((w) => w !== "" && v.includes(w)));
    case "empty":
      return vals.every((v) => v === "");
    case "not_empty":
      return vals.some((v) => v !== "");
  }
  return true;
}

// ---------------------------------------------------------------- validation

export function validate<R>(p: Profile<R>, spec: ChartSpec): void {
  const errors: string[] = [];
  const compare = spec.compare ?? "none";
  if (!spec.title.trim()) errors.push("Ponle un titulo");
  if (spec.kind !== "number") {
    if (!spec.x) errors.push("Elige que va en el eje (agrupar por)");
    else if (p.isNumber(spec.x.field)) errors.push("No se puede agrupar por importe");
  }
  if (spec.split) {
    if (!SPLIT_KINDS.has(spec.kind))
      errors.push("Este tipo de grafica no admite separar en series");
    if (p.isNumber(spec.split.field)) errors.push("No se puede separar por importe");
    if (
      spec.x &&
      spec.split.field === spec.x.field &&
      (spec.split.granularity ?? null) === (spec.x.granularity ?? null)
    )
      errors.push("Las series y el eje no pueden ser el mismo campo");
    if (compare !== "none")
      errors.push("Comparar con otro periodo no se puede combinar con separar en series");
  }
  if (spec.kind === "stacked_bar" && !spec.split)
    errors.push("Las barras apiladas necesitan un campo para separar en series");
  if (spec.kind === "donut" && compare !== "none") errors.push("El anillo no admite comparar");
  if (spec.top != null && !(spec.top >= 1 && spec.top <= 50))
    errors.push("Mostrar los N primeros: entre 1 y 50");
  const per = spec.period;
  if (per.kind === "last_months" && !((per.months || 0) >= 1 && (per.months || 0) <= 60))
    errors.push("Ultimos meses: entre 1 y 60");
  if (per.kind === "last_days" && !((per.days || 0) >= 1 && (per.days || 0) <= 731))
    errors.push("Ultimos dias: entre 1 y 731");
  if (per.kind === "range") {
    const ok = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!ok(per.start) || !ok(per.end)) errors.push("Fechas del periodo no validas");
    else if (String(per.start) > String(per.end))
      errors.push("La fecha de inicio es posterior a la de fin");
  }
  for (const f of spec.filters ?? []) {
    const bounded = f.field === "date" || p.isNumber(f.field);
    if (bounded && f.op !== "gte" && f.op !== "lte")
      errors.push(`Filtro de ${f.field}: solo mayor o igual / menor o igual`);
    if (!bounded && (f.op === "gte" || f.op === "lte"))
      errors.push(`Filtro de ${f.field}: operacion no valida`);
    if (f.op !== "empty" && f.op !== "not_empty" && !(f.values ?? []).length)
      errors.push(`Filtro de ${f.field}: falta el valor`);
  }
  if (errors.length) throw new SpecError(errors.join("; "));
}

// ---------------------------------------------------------------- compute

function drillSpec(spec: ChartSpec, key: string, start: Day, end: Day): [ChartSpec, Day, Day] {
  const x = spec.x as Dimension;
  const s: ChartSpec = structuredClone(spec);
  s.split = null;
  s.compare = "none";
  s.top = null;
  s.filters = [...(s.filters ?? [])];
  if (x.field === "group") {
    s.filters.push({ field: "category", op: "prefix", values: [key] });
    s.x = { field: "category" };
  } else if (x.field === "date") {
    for (const b of timeBuckets(start, end, x.granularity ?? "month"))
      if (b.key === key) {
        start = b.start;
        end = b.end;
      }
    s.x = { field: "group" };
    if (!["hbar", "donut", "table"].includes(s.kind)) s.kind = "hbar";
  } else {
    s.filters.push({ field: x.field, op: "in", values: [key] });
    s.x = { field: "group" };
  }
  if (["line", "area", "stacked_bar"].includes(s.kind)) s.kind = "hbar";
  return [s, start, end];
}

export interface ComputeOptions {
  today: Day;
  /** Months ("YYYY-MM") with any record at all: a time bucket without any is a gap, not a zero. */
  monthsWithData: ReadonlySet<string>;
  drill?: string | null;
  stale?: boolean;
}

/** A spec ready to compute: normalized, checked, its period, and narrowed to the drilled key if any. */
function prepared<R>(p: Profile<R>, input: ChartSpec, recs: R[], o: ComputeOptions) {
  let spec = normalized(input);
  validate(p, spec);
  const today = o.today;
  const drill = o.drill ?? null;
  let [start, end] = periodRange(spec, today, p.allStart);
  let subPrefix = "";
  if (drill !== null && spec.x && drill !== REST && drill !== OTHER) {
    if (spec.x.field === "date" && spec.x.granularity === "weekday") {
      const weekday = Number(drill);
      recs = recs.filter((r) => isoWeekday(p.day(r)) === weekday);
      const w = WEEKDAYS[weekday - 1] as string;
      subPrefix = `${w[0]?.toUpperCase()}${w.slice(1)} - `;
      spec = {
        ...structuredClone(spec),
        x: { field: "group" },
        kind: "hbar",
        split: null,
        compare: "none",
        top: null,
      };
    } else {
      const label = spec.x.field !== "date" ? p.labeler(spec.x.field, [drill])(drill) : "";
      [spec, start, end] = drillSpec(spec, drill, start, end);
      subPrefix = label ? `${label} - ` : "";
    }
  }
  const measure = spec.measure ?? "spending";
  const rules = spec.filters ?? [];
  const select = (a: Day, b: Day) =>
    recs.filter((r) => {
      const d = p.day(r);
      return a <= d && d <= b && p.relevant(r, measure) && rules.every((f) => matches(p, r, f));
    });
  return { spec, start, end, subPrefix, drill, measure, select };
}

/**
 * The records a chart counts in its period (narrowed to `o.drill`, a point's key, if given): what a click on a
 * number or a bar lists. The same selection as `computeChart`'s total, so the list and the number always agree.
 * The rest of a top-N ("_rest") is not a key: it lists the whole period.
 */
export function chartRecords<R>(
  p: Profile<R>,
  input: ChartSpec,
  recs: R[],
  o: ComputeOptions,
): R[] {
  const { start, end, select } = prepared(p, input, recs, o);
  return select(start, end);
}

export function computeChart<R>(
  p: Profile<R>,
  input: ChartSpec,
  recs: R[],
  o: ComputeOptions,
): ChartData {
  const today = o.today;
  const { spec, start, end, subPrefix, drill, measure, select } = prepared(p, input, recs, o);
  const mv = (rs: R[]) => pyRound(p.measure(measure, rs) + 0, 2);

  const current = select(start, end);
  const cmp = compareRange(spec, start, end, today);
  const previous = cmp ? select(cmp[0], cmp[1]) : [];
  const total = mv(current);
  const previousTotal = cmp ? mv(previous) : null;
  let delta: number | null = null;
  if (previousTotal) delta = pyRound(((total - previousTotal) / Math.abs(previousTotal)) * 100, 1);

  let subtitle = subPrefix + describeRange(start, end, today);
  let cmpName = "";
  if (cmp) {
    const cmpEnd = monthAligned(start, end) ? lastDay(year(cmp[1]), month(cmp[1])) : cmp[1];
    cmpName = describeRange(cmp[0], cmpEnd, today).replace(" - hasta hoy", "");
    subtitle += ` - frente a ${cmpName}`;
  }
  const base = {
    chart_id: spec.id ?? "",
    title: spec.title,
    subtitle,
    kind: spec.kind,
    measure,
    unit: p.unit(measure),
    total,
    previous_total: previousTotal,
    delta_pct: delta,
    stale: !!o.stale,
    drill,
  };

  if (spec.kind === "number") {
    const series: ChartSeries[] = [
      {
        key: "total",
        name: spec.title,
        role: "main",
        points: [{ key: "total", label: "Total", value: total, partial: false, no_data: false }],
      },
    ];
    if (cmp)
      series.push({
        key: "previous",
        name: cmpName,
        role: "compare",
        points: [
          {
            key: "total",
            label: "Total",
            value: previousTotal || 0,
            partial: false,
            no_data: false,
          },
        ],
      });
    return { ...base, series, average: null, x_label: null, drilldown: false };
  }

  const x = spec.x as Dimension;
  const isTime = x.field === "date";
  const gran: Granularity = x.granularity ?? "month";
  const keysOf = (r: R, dim: Dimension): string[] =>
    dim.field === "date"
      ? [timeKey(p.day(r), dim.granularity ?? "month")]
      : p.values(r, dim.field).map((v) => (p.folded.has(dim.field) ? fold(v) : v));
  const grouped = (rs: R[], dim: Dimension): Map<string, R[]> => {
    const g = new Map<string, R[]>();
    for (const r of rs)
      for (const k of new Set(keysOf(r, dim))) {
        const list = g.get(k);
        if (list) list.push(r);
        else g.set(k, [r]);
      }
    return g;
  };

  const byX = grouped(current, x);
  let xKeys: string[];
  let labels: Map<string, string>;
  let flags = new Map<string, [boolean, boolean]>();
  if (isTime) {
    let buckets = timeBuckets(start, end, gran);
    if (spec.period.kind === "all") {
      const i = buckets.findIndex((b) => byX.has(b.key));
      buckets = buckets.slice(Math.max(i === -1 ? buckets.length - 1 : i, 0));
    }
    xKeys = buckets.map((b) => b.key);
    labels = new Map(buckets.map((b) => [b.key, b.label]));
    const noData = (b: Bucket) =>
      gran !== "weekday" &&
      !monthsBetween(b.start, b.end).some(([y, m]) =>
        o.monthsWithData.has(`${y}-${String(m).padStart(2, "0")}`),
      );
    flags = new Map(
      buckets.map((b) => [
        b.key,
        [b.start <= today && today <= b.end && today < b.end && gran !== "weekday", noData(b)],
      ]),
    );
    if (spec.sort === "value_desc" || spec.sort === "value_asc") {
      const desc = spec.sort === "value_desc";
      xKeys.sort((a, b) =>
        desc
          ? mv(byX.get(b) ?? []) - mv(byX.get(a) ?? [])
          : mv(byX.get(a) ?? []) - mv(byX.get(b) ?? []),
      );
    }
  } else {
    // A category whose purchases were refunded adds up to 0: not worth a bar.
    xKeys = [...byX.keys()].filter((k) => Math.abs(mv(byX.get(k) as R[])) >= 0.005);
    const lab = p.labeler(x.field, xKeys);
    labels = new Map(xKeys.map((k) => [k, lab(k)]));
    if (spec.sort === "label")
      xKeys.sort((a, b) => byText(fold(labels.get(a)), fold(labels.get(b))));
    else {
      const asc = spec.sort === "value_asc";
      xKeys.sort((a, b) =>
        asc
          ? mv(byX.get(a) as R[]) - mv(byX.get(b) as R[])
          : mv(byX.get(b) as R[]) - mv(byX.get(a) as R[]),
      );
    }
    const top = spec.top || (spec.kind === "donut" ? 6 : null);
    if (top && xKeys.length > top) {
      const rest = spec.kind === "donut" ? xKeys.slice(top - 1) : xKeys.slice(top);
      const keep = xKeys.slice(0, xKeys.length - rest.length);
      byX.set(
        REST,
        rest.flatMap((k) => byX.get(k) ?? []),
      );
      labels.set(REST, `Resto (${rest.length})`);
      xKeys = [...keep, REST];
    }
  }

  const points = (group: Map<string, R[]>): ChartPoint[] =>
    xKeys.map((k) => {
      const [partial, nd] = flags.get(k) ?? [false, false];
      return {
        key: k,
        label: labels.get(k) ?? k,
        value: mv(group.get(k) ?? []),
        partial,
        no_data: nd,
      };
    });

  const series: ChartSeries[] = [];
  if (spec.split) {
    const split = spec.split;
    const bySplit = grouped(current, split);
    let splitKeys = [...bySplit.keys()].filter((k) => Math.abs(mv(bySplit.get(k) as R[])) >= 0.005);
    splitKeys.sort((a, b) => mv(bySplit.get(b) as R[]) - mv(bySplit.get(a) as R[]));
    if (split.field === "date") {
      const set = new Set(splitKeys);
      splitKeys = timeBuckets(start, end, split.granularity ?? "month")
        .map((b) => b.key)
        .filter((k) => set.has(k));
    }
    if (splitKeys.length > MAX_SPLIT) {
      const others = splitKeys.slice(MAX_SPLIT - 1);
      bySplit.set(
        OTHER,
        others.flatMap((k) => bySplit.get(k) ?? []),
      );
      splitKeys = [...splitKeys.slice(0, MAX_SPLIT - 1), OTHER];
    }
    let slab: (k: string) => string;
    if (split.field === "date") {
      const sb = new Map(
        timeBuckets(start, end, split.granularity ?? "month").map((b) => [b.key, b.label]),
      );
      slab = (k) => sb.get(k) ?? k;
    } else slab = p.labeler(split.field, splitKeys);
    for (const sk of splitKeys)
      series.push({
        key: sk,
        name: sk === OTHER ? "Otros" : slab(sk),
        role: "split",
        points: points(grouped(bySplit.get(sk) ?? [], x)),
      });
  } else series.push({ key: "main", name: spec.title, role: "main", points: points(byX) });

  if (cmp) {
    const prevByX = grouped(previous, x);
    const aligned = new Map<string, R[]>();
    if (isTime) {
      timeBuckets(cmp[0], cmp[1], gran).forEach((b, i) => {
        if (i < xKeys.length) aligned.set(xKeys[i] as string, prevByX.get(b.key) ?? []);
      });
    } else {
      for (const k of xKeys) if (k !== REST) aligned.set(k, prevByX.get(k) ?? []);
      if (xKeys.includes(REST)) {
        const kept = new Set(xKeys);
        aligned.set(
          REST,
          [...prevByX.entries()].filter(([k]) => !kept.has(k)).flatMap(([, rs]) => rs),
        );
      }
    }
    const pts = points(new Map()).map((pt) => ({
      ...pt,
      value: mv(aligned.get(pt.key) ?? []),
      partial: false,
      no_data: false,
    }));
    series.push({ key: "previous", name: cmpName, role: "compare", points: pts });
  }

  let average: number | null = null;
  if (
    isTime &&
    gran !== "weekday" &&
    !spec.split &&
    ["bar", "line", "area"].includes(spec.kind) &&
    !p.isAverage(measure)
  ) {
    const complete = (series[0] as ChartSeries).points
      .filter((pt) => !pt.partial && !pt.no_data)
      .map((pt) => pt.value);
    average = complete.length ? pyRound(pySum(complete) / complete.length, 2) : null;
  }
  const drillable =
    !!spec.drilldown &&
    drill === null &&
    ["bar", "hbar", "donut", "table", "line", "area", "stacked_bar"].includes(spec.kind);
  const X_LABEL: Record<Granularity, string> = {
    day: "Dia",
    week: "Semana",
    month: "Mes",
    quarter: "Trimestre",
    year: "Ano",
    weekday: "Dia de la semana",
  };
  const xLabel = x.field === "date" ? (X_LABEL[gran] ?? "Fecha") : null;
  return { ...base, series, average, drilldown: drillable, x_label: xLabel };
}
