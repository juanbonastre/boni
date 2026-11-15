/**
 * The executors of the steps that only change, sort out or cross the rows they receive: «Transformar» and «Lógica»
 * (docs/automatizaciones.md §5.9, §5.10). Each is the catalogue's action in the catalogue's mode, and works only with
 * what the engine gives it (`StepContext`): none reads or writes a collection. The engine sets every row's `parent`
 * and `path`; an executor only says which input row each row out comes from, when its action pairs.
 */
import { join, type Label, type Labeled } from "@boni/entities";
import { type DatabaseFilter, type FilterItem, matchesFilters } from "@boni/views";
import { IN, paramsOf, paramValue } from "./catalogue.ts";
import type { DateUnit } from "./effects.ts";
import type { Executor, RowOut, StepContext, StepOutput } from "./engine.ts";
import { isExpr, MAIN, OUT, type ParamValue } from "./format.ts";
import type { Cell, FieldLabel, Row } from "./rows.ts";

/** «Parar con error»: the run ends there, failed, with this message; no retry and no «Si falla» apply (AU-16). */
export class StopRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StopRun";
  }
}

// ---------------------------------------------------------------- helpers

/** A parameter of the step, as saved or its default, before resolving. */
export function raw(ctx: StepContext, key: string): ParamValue | undefined {
  const spec = paramsOf(ctx.step).find((p) => p.key === key);
  return spec ? paramValue(ctx.step, spec) : ctx.step.params[key];
}

/** A parameter resolved for the row in hand: null when it has no value. */
export function param(ctx: StepContext, key: string): Labeled<Cell> {
  const v = raw(ctx, key);
  return v === undefined ? { value: null, label: ctx.scope.literal, derived: false } : ctx.value(v);
}

/** A row out that is the row in, copied: new objects, the same values and labels. */
export function copy(row: Row, from?: number): RowOut & { from?: number } {
  return {
    json: { ...row.json },
    label: row.label,
    ...(row.fields ? { fields: { ...row.fields } } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    ...(from === undefined ? {} : { from }),
  };
}

/** Sets a field of a row out with its label: an entry in `fields` only when it differs from the row's. */
export function setField(out: RowOut, key: string, v: Labeled<Cell>): void {
  out.json[key] = v.value;
  const fields: Record<string, FieldLabel> = { ...(out.fields ?? {}) };
  if (v.label === out.label && !v.derived) delete fields[key];
  else fields[key] = { label: v.label, derived: v.derived };
  if (Object.keys(fields).length) out.fields = fields;
  else delete out.fields;
}

/** The label of one field of a row: its own, or the row's. */
export const fieldLabel = (row: Row, key: string): Label => row.fields?.[key]?.label ?? row.label;

/** The join of some labels, or the step's own label when there are none. */
export function joinAll(labels: readonly Label[], none: Label): Label {
  // Rows of one collection share one label object: join each object once.
  const [first, ...rest] = [...new Set(labels)];
  return first ? join(first, ...rest) : none;
}

/** The type a condition reads a value as: from the value itself, since rows of a step have no schema. */
export function typeOfValue(v: unknown): string {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "checkbox";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
  if (typeof v === "object" && v !== null && !Array.isArray(v) && "amount" in v) return "money";
  return "text";
}

/** A condition's value as the views' filter takes it. */
function filterValue(v: Cell): string | number | undefined {
  if (v === null) return undefined;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/**
 * Conditions with their values resolved for the row in hand: the views' filter (validation checked their shape).
 * `values`, when given, receives each resolved value with its label by its place («where.0», «where.1.rules.0»):
 * what a read tells the policy (`PolicyCall.values`).
 */
export function filterOf(
  ctx: StepContext,
  where: ParamValue | undefined,
  values?: Record<string, Labeled<Cell>>,
  at = "where",
): FilterItem[] {
  if (!Array.isArray(where)) return [];
  const rule = (r: ParamValue, place: string): DatabaseFilter => {
    const o = r as Record<string, ParamValue>;
    const resolved = o.value === undefined ? undefined : ctx.value(o.value);
    if (resolved && values) values[place] = resolved;
    const value = resolved === undefined ? undefined : filterValue(resolved.value);
    return {
      field: String(o.field),
      op: String(o.op) as DatabaseFilter["op"],
      ...(value === undefined ? {} : { value }),
    };
  };
  return where.map((item, i): FilterItem => {
    const o = item as Record<string, ParamValue>;
    if (typeof o === "object" && o !== null && !isExpr(o) && "join" in o) {
      const rules = Array.isArray(o.rules) ? o.rules : [];
      return {
        join: o.join === "or" ? "or" : "and",
        rules: rules.map((r, j) => rule(r, `${at}.${i}.rules.${j}`)),
      };
    }
    return rule(item, `${at}.${i}`);
  });
}

/** Whether a row passes conditions over its own fields. */
export function passes(ctx: StepContext, row: Row, where: ParamValue | undefined): boolean {
  const items = filterOf(ctx, where);
  const today = ctx.dates.day(ctx.now, ctx.zone);
  return matchesFilters(row.json, (f) => typeOfValue(row.json[f]), items, today);
}

/** A key for a value, the same for equal values whatever the order of their keys. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null)
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

const rank = (v: Cell | undefined): number =>
  v === null || v === undefined
    ? 5
    : typeof v === "boolean"
      ? 0
      : typeof v === "number" || (typeof v === "object" && !Array.isArray(v) && "amount" in v)
        ? 1
        : typeof v === "string"
          ? 2
          : 3;
const amountOf = (v: Cell | undefined): number =>
  typeof v === "number" ? v : ((v as { amount?: number } | null)?.amount ?? 0);

/** A fixed order of values, never the locale's: booleans, numbers, texts by code unit, the rest; empty ones last. */
export function compare(a: Cell | undefined, b: Cell | undefined): number {
  const [ra, rb] = [rank(a), rank(b)];
  if (ra !== rb) return ra - rb;
  if (ra === 0) return Number(a) - Number(b);
  if (ra === 1) return amountOf(a) - amountOf(b);
  if (ra === 2) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  if (ra === 3) {
    const [x, y] = [canonical(a), canonical(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return 0;
}

/** The fields a list parameter names, from its `field` column. */
const fieldsOf = (v: ParamValue | undefined): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => {
        const f = (x as Record<string, ParamValue> | null)?.field;
        return typeof f === "string" ? [f] : [];
      })
    : [];

const one = (rows: StepOutput[string]): StepOutput => ({ [MAIN]: rows });

// ---------------------------------------------------------------- measures

type Measure = "count" | "sum" | "average" | "min" | "max" | "list";

/** A measure over some values: numbers or money (all of one currency), or any value for `count`, `list`, `min` and `max`. */
export function measure(m: Measure, values: readonly Cell[]): Cell {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (m === "count") return present.length;
  if (m === "list") return [...values];
  if (m === "min" || m === "max") {
    if (!present.length) return null;
    const sorted = [...present].sort(compare);
    return (m === "min" ? sorted[0] : sorted[sorted.length - 1]) as Cell;
  }
  const currencies = new Set(
    present.flatMap((v) =>
      typeof v === "object" && v !== null && !Array.isArray(v) && "amount" in v
        ? [String((v as { currency?: Cell }).currency ?? "")]
        : [],
    ),
  );
  if (currencies.size > 1) throw new Error(`cannot ${m} amounts in different currencies`);
  for (const v of present)
    if (typeof v !== "number" && !currencies.size)
      throw new Error(`cannot ${m} a value that is not a number`);
  const total = present.reduce<number>((s, v) => s + amountOf(v), 0);
  const result = m === "sum" ? total : present.length ? total / present.length : null;
  const [currency] = [...currencies];
  return currency === undefined || result === null ? result : { amount: result, currency };
}

// ---------------------------------------------------------------- Transformar

const edit: Executor = {
  mode: "perRow",
  async run(ctx, row) {
    if (!row) return one([]);
    const keep = raw(ctx, "keep") === "all";
    const out: RowOut = keep
      ? copy(row)
      : { json: {}, label: row.label, ...(row.origin ? { origin: row.origin } : {}) };
    const fields = raw(ctx, "fields");
    for (const f of Array.isArray(fields) ? fields : []) {
      const o = f as Record<string, ParamValue>;
      const v =
        o.value === undefined
          ? { value: null, label: ctx.scope.literal, derived: false }
          : ctx.value(o.value);
      setField(out, String(o.field), v);
    }
    return one([out]);
  },
};

const filter: Executor = {
  mode: "perRow",
  async run(ctx, row) {
    return one(row && passes(ctx, row, raw(ctx, "where")) ? [copy(row)] : []);
  },
};

const sort: Executor = {
  mode: "all",
  async run(ctx, input) {
    const rows = input[MAIN] ?? [];
    const by = Array.isArray(raw(ctx, "by")) ? (raw(ctx, "by") as ParamValue[]) : [];
    const keys = by.map((b) => {
      const o = b as Record<string, ParamValue>;
      return { field: String(o.field), sign: o.direction === "desc" ? -1 : 1 };
    });
    const order = rows.map((_, i) => i);
    order.sort((i, j) => {
      const [a, b] = [rows[i] as Row, rows[j] as Row];
      for (const k of keys) {
        const c = compare(a.json[k.field], b.json[k.field]);
        // Empty values go last in either direction.
        const empty = rank(a.json[k.field]) === 5 || rank(b.json[k.field]) === 5;
        if (c) return empty ? c : c * k.sign;
      }
      return i - j;
    });
    return one(order.map((i) => copy(rows[i] as Row, i)));
  },
};

const limit: Executor = {
  mode: "all",
  async run(ctx, input) {
    const rows = input[MAIN] ?? [];
    const count = param(ctx, "count").value;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0)
      throw new Error("the count is not a whole number of rows");
    const start = raw(ctx, "from") === "last" ? Math.max(0, rows.length - count) : 0;
    return one(rows.slice(start, start + count).map((r, k) => copy(r, start + k)));
  },
};

const dedupe: Executor = {
  mode: "all",
  async run(ctx, input) {
    const rows = input[MAIN] ?? [];
    const fields = raw(ctx, "by") === "fields" ? fieldsOf(raw(ctx, "fields")) : null;
    const seen = new Set<string>();
    const out: StepOutput[string][number][] = [];
    rows.forEach((r, i) => {
      const key = canonical(fields ? fields.map((f) => r.json[f] ?? null) : r.json);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(copy(r, i));
    });
    return one(out);
  },
};

const group: Executor = {
  mode: "all",
  async run(ctx, input) {
    const rows = input[MAIN] ?? [];
    const by = fieldsOf(raw(ctx, "by"));
    const measures = (
      Array.isArray(raw(ctx, "measures")) ? (raw(ctx, "measures") as ParamValue[]) : []
    ).map((m) => m as Record<string, ParamValue>);
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = canonical(by.map((f) => r.json[f] ?? null));
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    // With nothing to group by, one row even when no row came: «0» is an answer.
    if (!by.length && !groups.size) groups.set("[]", []);
    const out: RowOut[] = [];
    for (const members of groups.values()) {
      const label = joinAll(
        members.map((r) => r.label),
        ctx.scope.literal,
      );
      const row: RowOut = { json: {}, label };
      const first = members[0];
      for (const f of by)
        setField(row, f, {
          value: first?.json[f] ?? null,
          label: joinAll(
            members.map((r) => fieldLabel(r, f)),
            label,
          ),
          derived: false,
        });
      for (const m of measures) {
        const kind = String(m.measure ?? "count") as Measure;
        const field = typeof m.field === "string" ? m.field : undefined;
        const values = members.map((r) => (field === undefined ? null : (r.json[field] ?? null)));
        const labels =
          field === undefined
            ? members.map((r) => r.label)
            : members.map((r) => fieldLabel(r, field));
        setField(row, String(m.to), {
          // «Contar» with no field counts the rows; with one, the rows that have a value in it.
          value: kind === "count" && field === undefined ? members.length : measure(kind, values),
          label: joinAll(labels, label),
          derived: true,
        });
      }
      out.push(row);
    }
    return one(out);
  },
};

const split: Executor = {
  mode: "perRow",
  async run(ctx, row) {
    if (!row) return one([]);
    const field = String(raw(ctx, "field"));
    const list = row.json[field];
    if (list === undefined || list === null) return one([]);
    if (!Array.isArray(list)) throw new Error(`the field ${field} does not hold a list`);
    const keep = raw(ctx, "keep") === "all";
    const label = fieldLabel(row, field);
    return one(
      list.map((item) => {
        const base = copy(row);
        delete base.origin;
        const out: RowOut = keep ? base : { json: {}, label: row.label };
        setField(out, field, {
          value: item,
          label,
          derived: row.fields?.[field]?.derived ?? false,
        });
        return out;
      }),
    );
  },
};

const joinRows: Executor = {
  mode: "all",
  async run(ctx, input) {
    const rows = input[MAIN] ?? [];
    const label = joinAll(
      rows.map((r) => r.label),
      ctx.scope.literal,
    );
    const out: RowOut = { json: {}, label };
    if (raw(ctx, "into") === "rows") {
      const fields = rows.flatMap((r) => Object.values(r.fields ?? {}).map((f) => f.label));
      setField(out, String(raw(ctx, "to")), {
        value: rows.map((r) => ({ ...r.json })),
        label: joinAll([label, ...fields], label),
        derived: false,
      });
      return one([out]);
    }
    const keys: string[] = [];
    for (const r of rows) for (const k of Object.keys(r.json)) if (!keys.includes(k)) keys.push(k);
    for (const k of keys) {
      const having = rows.filter((r) => Object.hasOwn(r.json, k));
      setField(out, k, {
        value: having.map((r) => r.json[k] as Cell),
        label: joinAll(
          having.map((r) => fieldLabel(r, k)),
          label,
        ),
        derived: false,
      });
    }
    return one([out]);
  },
};

/** «Fecha»: the result in the field `to`, the rest of the row as it was. */
function dateAction(compute: (ctx: StepContext, date: Labeled<Cell>) => Labeled<Cell>): Executor {
  return {
    mode: "perRow",
    async run(ctx, row) {
      if (!row) return one([]);
      const out = copy(row);
      setField(out, String(raw(ctx, "to")), compute(ctx, param(ctx, "date")));
      return one([out]);
    },
  };
}
const derivedOf = (value: Cell, ...from: Labeled<Cell>[]): Labeled<Cell> => ({
  value,
  label: joinAll(
    from.map((f) => f.label),
    (from[0] as Labeled<Cell>).label,
  ),
  derived: true,
});
const unit = (ctx: StepContext) => String(raw(ctx, "unit")) as DateUnit;

const DATE_ACTIONS: Record<string, Executor> = {
  add: dateAction((ctx, d) => {
    const amount = param(ctx, "amount");
    if (typeof amount.value !== "number") throw new Error("the amount is not a number");
    return derivedOf(ctx.dates.add(d.value, amount.value, unit(ctx), ctx.zone), d, amount);
  }),
  diff: dateAction((ctx, d) => {
    const until = param(ctx, "until");
    return derivedOf(ctx.dates.diff(d.value, until.value, unit(ctx), ctx.zone), d, until);
  }),
  startOf: dateAction((ctx, d) =>
    derivedOf(ctx.dates.startOf(d.value, String(raw(ctx, "unit")) as "day", ctx.zone), d),
  ),
  part: dateAction((ctx, d) =>
    derivedOf(ctx.dates.part(d.value, String(raw(ctx, "part")) as "year", ctx.zone), d),
  ),
  format: dateAction((ctx, d) =>
    derivedOf(ctx.dates.format(d.value, String(raw(ctx, "format")), ctx.zone, ctx.locale), d),
  ),
};

/** «Combinar»: two lists into one. A row out has the fields of both, those of «a» winning, and each its label. */
const combine: Executor = {
  mode: "all",
  async run(ctx, input) {
    const a = input[IN.a] ?? [];
    const b = input[IN.b] ?? [];
    const by = raw(ctx, "by");
    const keep = raw(ctx, "keep");
    const merged = (x: Row | undefined, y: Row | undefined): RowOut => {
      const label = joinAll(
        [x?.label, y?.label].filter((l): l is Label => !!l),
        ctx.scope.literal,
      );
      const out: RowOut = { json: {}, label };
      for (const r of [y, x])
        if (r)
          for (const [k, v] of Object.entries(r.json))
            setField(out, k, {
              value: v,
              label: fieldLabel(r, k),
              derived: r.fields?.[k]?.derived ?? false,
            });
      return out;
    };
    const out: RowOut[] = [];
    if (by === "all") {
      for (const x of a) for (const y of b) out.push(merged(x, y));
      return one(out);
    }
    if (by === "position") {
      const n =
        keep === "matches"
          ? Math.min(a.length, b.length)
          : keep === "a"
            ? a.length
            : Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) out.push(merged(a[i], b[i]));
      return one(out);
    }
    const [fa, fb] = [String(raw(ctx, "fieldA")), String(raw(ctx, "fieldB"))];
    const byKey = new Map<string, Row[]>();
    for (const y of b) {
      const v = y.json[fb];
      if (v === undefined || v === null) continue;
      const k = canonical(v);
      byKey.set(k, [...(byKey.get(k) ?? []), y]);
    }
    const used = new Set<Row>();
    for (const x of a) {
      const v = x.json[fa];
      const matches = v === undefined || v === null ? [] : (byKey.get(canonical(v)) ?? []);
      for (const y of matches) {
        used.add(y);
        out.push(merged(x, y));
      }
      if (!matches.length && keep !== "matches") out.push(merged(x, undefined));
    }
    if (keep === "both") for (const y of b) if (!used.has(y)) out.push(merged(undefined, y));
    return one(out);
  },
};

// ---------------------------------------------------------------- Lógica

const ifStep: Executor = {
  mode: "perRow",
  async run(ctx, row) {
    if (!row) return { [OUT.yes]: [], [OUT.no]: [] };
    const yes = passes(ctx, row, raw(ctx, "where"));
    return { [OUT.yes]: yes ? [copy(row)] : [], [OUT.no]: yes ? [] : [copy(row)] };
  },
};

const switchStep: Executor = {
  mode: "perRow",
  async run(ctx, row) {
    const rules = (Array.isArray(raw(ctx, "rules")) ? (raw(ctx, "rules") as ParamValue[]) : []).map(
      (r) => r as Record<string, ParamValue>,
    );
    const out: Record<string, RowOut[]> = Object.fromEntries(rules.map((r) => [String(r.id), []]));
    const fallback = raw(ctx, "fallback") === "other";
    if (fallback) out[OUT.other] = [];
    if (!row) return out;
    const all = raw(ctx, "match") === "all";
    let matched = false;
    for (const r of rules) {
      if (!passes(ctx, row, r.where)) continue;
      matched = true;
      out[String(r.id)]?.push(copy(row));
      if (!all) break;
    }
    if (!matched && fallback) out[OUT.other]?.push(copy(row));
    return out;
  },
};

const stop: Executor = {
  mode: "all",
  async run(ctx) {
    const message = param(ctx, "message").value;
    throw new StopRun(typeof message === "string" ? message : JSON.stringify(message));
  },
};

/** The executors of this file, by `executorKey`. */
export const TRANSFORM_AND_LOGIC: Readonly<Record<string, Executor>> = {
  "edit.run": edit,
  "filter.run": filter,
  "sort.run": sort,
  "limit.run": limit,
  "dedupe.run": dedupe,
  "group.run": group,
  "split.run": split,
  "join.run": joinRows,
  ...Object.fromEntries(Object.entries(DATE_ACTIONS).map(([k, v]) => [`date.${k}`, v])),
  "combine.run": combine,
  "if.run": ifStep,
  "switch.run": switchStep,
  "stop.run": stop,
};
