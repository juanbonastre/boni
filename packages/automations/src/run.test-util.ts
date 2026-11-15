// Fakes of what the engine is given (effects.ts) for the tests: a policy that records every call, a clock that only
// moves when the engine waits, and date arithmetic over civil days and instants in UTC. Labels are invented: one for
// what Juan wrote and one for what came from outside, so a test can see which one a value carries.
import { type IdKind, type Label, label } from "@boni/entities";
import { matchesFilters } from "@boni/views";
import type {
  Change,
  Clock,
  CollectionShape,
  Collections,
  Dates,
  DateUnit,
  Decision,
  Policy,
  PolicyCall,
  StoredRow,
} from "./effects.ts";
import { type Execution, type RunDeps, run } from "./engine.ts";
import { type Automation, MAIN } from "./format.ts";
import type { Cell, Row } from "./rows.ts";
import { compare, measure } from "./steps.ts";

/** What Juan wrote: the automation's fixed values, and what he typed to start it. */
export const OWN: Label = label("user", "personal", [{ kind: "flow", id: "e_ejemplo" }]);
/** Something from outside: a mail's text, say. */
export const OUTSIDE: Label = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);

export interface FakeClock extends Clock {
  /** Every wait the engine asked for, in order. */
  slept: number[];
}

/** A clock that stands still but for the waits it is asked for. */
export function clock(start = Date.UTC(2026, 10, 2, 9, 30)): FakeClock {
  let t = start;
  const slept: number[] = [];
  return {
    zone: "Europe/Madrid",
    now: () => t,
    async sleep(ms) {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

const DAY = 86_400_000;
const UNIT_MS: Partial<Record<DateUnit, number>> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: DAY,
  weeks: 7 * DAY,
};
const civil = (v: Cell): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ms = (v: Cell): number => {
  if (civil(v)) return Date.parse(`${v}T00:00:00Z`);
  if (typeof v === "number") return v;
  throw new Error("not a date");
};
const back = (like: Cell, t: number): Cell =>
  civil(like) ? new Date(t).toISOString().slice(0, 10) : t;

/** Date arithmetic in UTC, enough for the tests (the server's is `packages/calendar/src/time.ts`). */
export const dates: Dates = {
  day: (instant, zone) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant),
  add(date, amount, unit) {
    const d = new Date(ms(date));
    if (unit === "months") d.setUTCMonth(d.getUTCMonth() + amount);
    else if (unit === "years") d.setUTCFullYear(d.getUTCFullYear() + amount);
    else return back(date, ms(date) + amount * (UNIT_MS[unit] as number));
    return back(date, d.getTime());
  },
  diff: (date, until, unit) => Math.trunc((ms(until) - ms(date)) / (UNIT_MS[unit] ?? 30 * DAY)),
  startOf(date, unit) {
    const d = new Date(ms(date));
    if (unit === "month") d.setUTCDate(1);
    if (unit === "year") d.setUTCMonth(0, 1);
    return back(date, d.setUTCHours(0, 0, 0, 0));
  },
  part(date, part) {
    const d = new Date(ms(date));
    return part === "year"
      ? d.getUTCFullYear()
      : part === "month"
        ? d.getUTCMonth() + 1
        : part === "day"
          ? d.getUTCDate()
          : part === "weekday"
            ? d.getUTCDay()
            : part === "hour"
              ? d.getUTCHours()
              : d.getUTCMinutes();
  },
  format: (date, format) => `${format}:${new Date(ms(date)).toISOString().slice(0, 10)}`,
};

export interface FakePolicy extends Policy {
  calls: PolicyCall[];
}

/** A policy that answers `decide` (by default, allow) and keeps every call it was asked. */
export function policy(
  decide: (call: PolicyCall) => Decision = () => ({ kind: "allow", rule: "test.allow" }),
): FakePolicy {
  const calls: PolicyCall[] = [];
  return {
    calls,
    decide(call) {
      calls.push(call);
      return decide(call);
    },
  };
}

/** Collections that hold nothing: for automations that never read or write. */
export const nothing: Collections = {
  shape: () => undefined,
  find: async () => [],
  get: async () => undefined,
  aggregate: async () => [],
  apply: async () => {
    throw new Error("nothing to write to");
  },
};

export interface FakeStore extends Collections {
  /** Every call the engine made, in order: the method and its collection. */
  calls: { method: "find" | "get" | "aggregate" | "apply"; collection: string }[];
  /** Every change applied, in order. */
  applied: Change[];
  /** The rows of a collection as they are now, in id order. */
  rows(collection: string): StoredRow[];
  /** What went to the trash. */
  trashed: StoredRow[];
}

/**
 * Collections in memory over these shapes and rows, with ids generated like the app's: what the server's store
 * does, as far as a run can tell (the views' filter, a fixed order, versions, a trash and no deletion). Every row of
 * a collection shares one label object, as the store's do.
 */
export function store(
  shapes: readonly CollectionShape[],
  initial: Record<string, Row["json"][]>,
  next: (kind: IdKind) => string,
  of: Label = OWN,
): FakeStore {
  const live = new Map<string, StoredRow[]>();
  const trashed: StoredRow[] = [];
  const calls: FakeStore["calls"] = [];
  const applied: Change[] = [];
  const shape = (key: string) => shapes.find((s) => s.key === key);
  const make = (collection: string, json: Row["json"]): StoredRow => ({
    json,
    label: of,
    origin: { collection, id: next("o"), version: 1 },
  });
  for (const s of shapes)
    live.set(
      s.key,
      (initial[s.key] ?? []).map((j) => make(s.key, j)),
    );
  const typeOf = (collection: string) => (field: string) =>
    shape(collection)?.fields.find((f) => f.key === field)?.type;
  const matching = (collection: string, where: Parameters<Collections["find"]>[0]["where"]) =>
    (live.get(collection) ?? []).filter((r) =>
      matchesFilters(r.json, typeOf(collection), where, "2026-11-02"),
    );
  const find = (collection: string, id: string) => {
    const rows = live.get(collection) ?? [];
    const i = rows.findIndex((r) => r.origin.id === id);
    return { rows, i };
  };
  return {
    calls,
    applied,
    trashed,
    rows: (collection) => live.get(collection) ?? [],
    shape,
    async find(q) {
      calls.push({ method: "find", collection: q.collection });
      const rows = matching(q.collection, q.where);
      const sorted = [...rows].sort((a, b) => {
        for (const s of q.sort) {
          const c = compare(a.json[s.field], b.json[s.field]);
          if (c) return s.direction === "desc" ? -c : c;
        }
        return a.origin.id < b.origin.id ? -1 : a.origin.id > b.origin.id ? 1 : 0;
      });
      return sorted.slice(0, q.limit).map((r) => {
        if (!q.related) return r;
        // One level: each relation holds the related row's fields.
        const json: Row["json"] = { ...r.json };
        for (const f of shape(q.collection)?.fields ?? [])
          if (f.type === "relation" && f.target && typeof json[f.key] === "string") {
            const { rows: target, i } = find(f.target, json[f.key] as string);
            if (i >= 0) json[f.key] = target[i]?.json ?? null;
          }
        return { ...r, json };
      });
    },
    async get(collection, id) {
      calls.push({ method: "get", collection });
      const { rows, i } = find(collection, id);
      return rows[i];
    },
    async aggregate(q) {
      calls.push({ method: "aggregate", collection: q.collection });
      const rows = matching(q.collection, q.where);
      const groups = new Map<string, StoredRow[]>();
      for (const r of rows) {
        const g = q.groupBy === undefined ? "" : JSON.stringify(r.json[q.groupBy] ?? null);
        groups.set(g, [...(groups.get(g) ?? []), r]);
      }
      if (q.groupBy === undefined && !groups.size) groups.set("", []);
      return [...groups.entries()].map(([g, members]) => {
        const v =
          q.measure === "count"
            ? members.length
            : measure(
                q.measure,
                members.map((r) => (q.field === undefined ? null : (r.json[q.field] ?? null))),
              );
        return {
          ...(q.groupBy === undefined ? {} : { group: JSON.parse(g) as Cell }),
          value: typeof v === "number" ? v : null,
          label: of,
        };
      });
    },
    async apply(change) {
      const collection = change.kind === "create" ? change.collection : change.row.collection;
      calls.push({ method: "apply", collection });
      if (change.kind === "create") {
        const r = make(collection, { ...change.fields });
        live.get(collection)?.push(r);
        applied.push(change);
        return r;
      }
      const { rows, i } = find(collection, change.row.id);
      const saved = rows[i];
      if (!saved || saved.origin.version !== change.row.version)
        throw new Error(`the row ${change.row.id} changed since it was read`);
      applied.push(change);
      if (change.kind === "trash") {
        rows.splice(i, 1);
        trashed.push(saved);
        return saved;
      }
      const r: StoredRow = {
        ...saved,
        json: { ...saved.json, ...change.fields },
        origin: { ...saved.origin, version: saved.origin.version + 1 },
      };
      rows[i] = r;
      return r;
    },
  };
}

/** Everything the engine needs, with these fakes; any of it may be replaced. */
export const deps = (over: Partial<RunDeps> = {}): RunDeps => ({
  policy: policy(),
  collections: nothing,
  clock: clock(),
  dates,
  own: OWN,
  locale: "es",
  ...over,
});

/** Runs an automation from one trigger with these fields, given by Juan. */
export const start = (
  automation: Automation,
  trigger: string,
  json: Row["json"] = {},
  over: Partial<RunDeps> = {},
  fields?: Row["fields"],
): Promise<Execution> =>
  run(
    {
      automation,
      trigger,
      fields: { json, label: OWN, ...(fields ? { fields } : {}) },
      test: false,
    },
    deps(over),
  );

/** The fields of what a step gave by one output. */
export const outOf = (e: Execution, step: string, output: string = MAIN) =>
  e.steps[step]?.out[output]?.map((r) => r.json);
