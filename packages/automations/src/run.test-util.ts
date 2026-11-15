// Fakes of what the engine is given (effects.ts) for the tests: a policy that records every call, a clock that only
// moves when the engine waits, and date arithmetic over civil days and instants in UTC. Labels are invented: one for
// what Juan wrote and one for what came from outside, so a test can see which one a value carries.
import { type Label, label } from "@boni/entities";
import type {
  Clock,
  Collections,
  Dates,
  DateUnit,
  Decision,
  Policy,
  PolicyCall,
} from "./effects.ts";
import { type Execution, type RunDeps, run } from "./engine.ts";
import { type Automation, MAIN } from "./format.ts";
import type { Cell, Row } from "./rows.ts";

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
