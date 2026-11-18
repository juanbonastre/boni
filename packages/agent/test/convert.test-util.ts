// What the translator's tests run a converted automation with (F16, AU-223, AU-224, AU-230): a box that evaluates
// the expressions the translator writes (only in tests: the server's box is the sandbox of F14b), a scripted way to
// Boni's code that keeps every call, and collections shaped like a user's (generated keys and ids, D-14). The engine's
// fakes are imported by path, as packages/automations' tests import this package's.
import type {
  Automation,
  BoniCall,
  BoniPort,
  Box,
  BoxJob,
  CollectionShape,
  Evaluated,
} from "@boni/automations";
import { ids } from "../../automations/src/automation.test-util.ts";
import { OUTSIDE } from "../../automations/src/run.test-util.ts";

/** A collection of tasks and one of notes, with keys and fields generated as the app does. */
export const next = ids(7);
export const TASKS: CollectionShape = {
  key: next("t"),
  fields: [
    { key: next("f"), type: "text" },
    { key: next("f"), type: "select" },
    { key: next("f"), type: "number" },
  ],
};
export const NOTES: CollectionShape = {
  key: next("t"),
  fields: [
    { key: next("f"), type: "text" },
    { key: next("f"), type: "text" },
  ],
};
const f = (c: CollectionShape, i: number) => (c.fields[i] as { key: string }).key;
export const TASK_TITLE = f(TASKS, 0);
export const TASK_STATE = f(TASKS, 1);
export const TASK_HOURS = f(TASKS, 2);
export const NOTE_TITLE = f(NOTES, 0);
export const NOTE_TEXT = f(NOTES, 1);

/** The JavaScript of one source, as a function of the globals the translator's expressions use. */
const compiled = new Map<string, (...g: unknown[]) => unknown>();
const GLOBALS = ["$json", "$", "$today", "$date"] as const;
function compile(source: string) {
  let fn = compiled.get(source);
  if (!fn) {
    fn = new Function(...GLOBALS, `"use strict"; return (${source});`) as (
      ...g: unknown[]
    ) => unknown;
    compiled.set(source, fn);
  }
  return fn;
}

/** A civil day plus days, in UTC: enough for these tests. */
const plusDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dateOf = (day: string) => ({
  toDay: () => day,
  plus: ({ days = 0 }: { days?: number }) => dateOf(plusDays(day, days)),
});

/**
 * A box that runs every expression it is sent, the way the real one does for what the translator writes: `$json`,
 * `$('n').first()`, `.last()`, `.all()`, `$today.toDay()` and `$date(v).plus({ days }).toDay()`. Every job is kept.
 */
export function jsBox(): Box & { jobs: BoxJob[] } {
  const jobs: BoxJob[] = [];
  return {
    jobs,
    async run(job) {
      jobs.push(structuredClone(job));
      const today = new Date(job.now).toISOString().slice(0, 10);
      const evaluations: Evaluated[] = job.input.map((row, i) => {
        const $ = (name: string) => {
          const s = job.steps[name];
          if (!s) throw new Error(`no rows of ${name} were sent`);
          const at = s.item?.[i];
          return {
            first: () => s.rows[0],
            last: () => s.rows[s.rows.length - 1],
            all: () => s.rows,
            item: at === null || at === undefined ? undefined : s.rows[at],
          };
        };
        try {
          const values = job.sources.map((src) => {
            const v = compile(src)(row, $, dateOf(today), (d: string) => dateOf(String(d)));
            return (v === undefined ? null : JSON.parse(JSON.stringify(v))) as never;
          });
          return { state: "done", values, clock: false, random: false };
        } catch (e) {
          return {
            state: "failed",
            source: 0,
            failure: { code: "code.threw", message: String((e as Error).message) } as never,
          };
        }
      });
      return { evaluations, console: [], dropped: 0, ms: 1 };
    },
  };
}

/** A scripted way to Boni's code: `answer` gives each call's value, labelled as from outside; every call is kept. */
export function boniPort(
  automation: BoniPort["automation"],
  answer: (call: BoniCall) => unknown = () => null,
): BoniPort & { calls: BoniCall[] } {
  const calls: BoniCall[] = [];
  return {
    automation,
    calls,
    async run(call) {
      calls.push(call);
      return { value: answer(call) as never, label: OUTSIDE };
    },
  };
}

/** Every value of a document, deep: what a test looks for a «Sí» in. */
export function values(a: Automation): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown) => {
    out.push(v);
    if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(a);
  return out;
}
