/**
 * An extension's functions (docs/extensiones.md §11, E2): JavaScript that runs only in the box (`apps/sandbox`), with
 * what it reads declared down to fields (as Shopify's input query) and what it may write declared too. A function
 * never writes: it gives back a closed change set (create, change a row it read at the version it read, ask Juan),
 * which Boni checks against what it declared and applies with the policy. Its tests are part of the manifest.
 */
import type { Schema } from "@boni/sandbox";

/** A collection it reads, by its key, and the fields of it it gets (by key). */
export interface ReadSpec {
  collection: string;
  fields: string[];
}

/** A collection it may write: the fields it may set, and whether it may make rows and change the ones it read. */
export interface WriteSpec {
  collection: string;
  fields: string[];
  create?: boolean;
  update?: boolean;
}

export interface FunctionSpec {
  /** The function the code defines and Boni calls: `name(input, ctx)`. */
  name: string;
  /** JavaScript: a script whose top level defines it (and its helpers). No imports. */
  code: string;
  /** The code's sha256 (hex): the box runs no other code under this name. */
  hash: string;
  reads: ReadSpec[];
  writes: WriteSpec[];
  /** Whether its change sets may ask Juan something. */
  asks?: boolean;
  /** Its own limits, within the box's (docs: `@boni/sandbox` MAX_LIMITS). */
  limits?: { steps?: number; ms?: number };
}

/** A test of a function: an invented input and the change set it must give back. */
export interface TestSpec {
  function: string;
  name: string;
  input: unknown;
  expect: unknown;
}

/**
 * What a function gets: the rows it reads (each with only its declared fields, by key) and what the flow gives it. An
 * option is given by its name (its id is the account's own), a relation by the ids it points to; `$title` and `$text`
 * are a row's title and its text, whatever their fields are called. What it writes is said the same way.
 */
export interface FunctionInput {
  rows: Record<string, { id: string; version: number; values: Record<string, unknown> }[]>;
  data?: unknown;
}

export type Change =
  /** A new row; `ref` names it for the change set's own asks. */
  | { op: "create"; collection: string; values: Record<string, unknown>; ref?: string }
  /** A row it read, at the version it read (a row changed since makes the whole set be made again). */
  | { op: "update"; id: string; version: number; values: Record<string, unknown> }
  /** A question for Juan (plain text), with its answers to choose from when it has them. */
  | { op: "ask"; question: string; options?: string[] };

export interface ChangeSet {
  changes: Change[];
  /** One line for Juan on what it is (plain text). */
  summary?: string;
  /** What else it wants Juan to read about it, line by line (plain text): what it left out, and why. */
  report?: string[];
}

export const FUNCTION_LIMITS = {
  functions: 8,
  codeBytes: 200_000,
  reads: 10,
  writes: 10,
  fields: 40,
  tests: 50,
  testBytes: 200_000,
  changes: 2_000,
  text: 300,
  report: 200,
  options: 6,
} as const;

const FN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const HASH = /^[0-9a-f]{64}$/;
/** A row's title and its text (its page), in what a function reads and writes, whatever their fields are called. */
export const ROW_FIELDS = ["$title", "$text"] as const;
const isFieldKey = (f: unknown) =>
  typeof f === "string" && (KEY.test(f) || (ROW_FIELDS as readonly string[]).includes(f));
const LINK_OR_HTML = /(https?:\/\/|www\.|<\s*\/?\s*[a-z!]|\]\(|javascript:|data:)/i;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).filter((k) => !keys.includes(k));
const isText = (v: unknown, max: number) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max && !LINK_OR_HTML.test(v);

/** A JSON value (no functions, no undefined, finite numbers), at most `depth` deep. */
export const isJson = (v: unknown, depth = 0): boolean =>
  depth <= 32 &&
  (v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v)) ||
    (Array.isArray(v) && v.every((x) => isJson(x, depth + 1))) ||
    (isObj(v) && Object.values(v).every((x) => isJson(x, depth + 1))));

function fieldsErrors(w: string, fields: unknown, out: string[]) {
  if (
    !Array.isArray(fields) ||
    !fields.length ||
    fields.length > FUNCTION_LIMITS.fields ||
    !fields.every(isFieldKey) ||
    new Set(fields).size !== fields.length
  )
    out.push(`${w}.fields: a list of field keys, each once`);
}

/** What is wrong with a manifest's functions and tests (empty when nothing). */
export function functionsErrors(functions: unknown, tests: unknown): string[] {
  const out: string[] = [];
  const names = new Set<string>();
  if (functions !== undefined) {
    if (!Array.isArray(functions)) return ["functions: a list"];
    if (functions.length > FUNCTION_LIMITS.functions)
      out.push(`functions: at most ${FUNCTION_LIMITS.functions}`);
    for (const [i, f] of functions.entries()) {
      const w = `functions[${i}]`;
      if (!isObj(f)) {
        out.push(`${w}: not an object`);
        continue;
      }
      if (only(f, ["name", "code", "hash", "reads", "writes", "asks", "limits"]).length)
        out.push(`${w}: unknown keys`);
      if (typeof f.name !== "string" || !FN.test(f.name)) out.push(`${w}.name: a JavaScript name`);
      else if (names.has(f.name)) out.push(`${w}.name: used twice`);
      else names.add(f.name);
      if (
        typeof f.code !== "string" ||
        !f.code.trim() ||
        new TextEncoder().encode(f.code).length > FUNCTION_LIMITS.codeBytes
      )
        out.push(`${w}.code: JavaScript, at most ${FUNCTION_LIMITS.codeBytes} bytes`);
      if (typeof f.hash !== "string" || !HASH.test(f.hash)) out.push(`${w}.hash: its sha256`);
      for (const [k, max] of [
        ["reads", FUNCTION_LIMITS.reads],
        ["writes", FUNCTION_LIMITS.writes],
      ] as const) {
        const list = f[k];
        if (!Array.isArray(list) || list.length > max) {
          out.push(`${w}.${k}: a list of at most ${max}`);
          continue;
        }
        const seen = new Set<string>();
        for (const [j, r] of list.entries()) {
          const wr = `${w}.${k}[${j}]`;
          if (!isObj(r)) {
            out.push(`${wr}: not an object`);
            continue;
          }
          const keys =
            k === "reads" ? ["collection", "fields"] : ["collection", "fields", "create", "update"];
          if (only(r, keys).length) out.push(`${wr}: unknown keys`);
          if (typeof r.collection !== "string" || !KEY.test(r.collection))
            out.push(`${wr}.collection: a collection's key`);
          else if (seen.has(r.collection)) out.push(`${wr}.collection: named twice`);
          else seen.add(r.collection);
          fieldsErrors(wr, r.fields, out);
          for (const b of ["create", "update"] as const)
            if (r[b] !== undefined && typeof r[b] !== "boolean")
              out.push(`${wr}.${b}: true or false`);
          if (k === "writes" && r.create !== true && r.update !== true)
            out.push(`${wr}: create, update or both`);
        }
      }
      if (f.asks !== undefined && typeof f.asks !== "boolean") out.push(`${w}.asks: true or false`);
      if (f.limits !== undefined) {
        const l = f.limits;
        if (
          !isObj(l) ||
          only(l, ["steps", "ms"]).length ||
          Object.values(l).some((x) => !Number.isInteger(x) || (x as number) < 1)
        )
          out.push(`${w}.limits: { steps, ms } as whole numbers`);
      }
    }
  }
  if (tests !== undefined) {
    if (!Array.isArray(tests)) return [...out, "tests: a list"];
    if (tests.length > FUNCTION_LIMITS.tests) out.push(`tests: at most ${FUNCTION_LIMITS.tests}`);
    const testNames = new Set<string>();
    for (const [i, t] of tests.entries()) {
      const w = `tests[${i}]`;
      if (!isObj(t)) {
        out.push(`${w}: not an object`);
        continue;
      }
      if (only(t, ["function", "name", "input", "expect"]).length) out.push(`${w}: unknown keys`);
      if (typeof t.function !== "string" || !names.has(t.function))
        out.push(`${w}.function: one of its functions`);
      if (!isText(t.name, 80)) out.push(`${w}.name: 1 to 80 characters, no links or HTML`);
      else if (testNames.has(t.name as string)) out.push(`${w}.name: used twice`);
      else testNames.add(t.name as string);
      if (!isJson(t.input) || !isJson(t.expect)) out.push(`${w}: input and expect as JSON`);
      else if (
        new TextEncoder().encode(JSON.stringify([t.input, t.expect])).length >
        FUNCTION_LIMITS.testBytes
      )
        out.push(`${w}: at most ${FUNCTION_LIMITS.testBytes} bytes`);
    }
    // Every function has a test: none is activated untried.
    for (const n of names)
      if (!tests.some((t) => isObj(t) && t.function === n)) out.push(`tests: none for ${n}`);
  } else if (names.size) out.push("tests: every function needs at least one");
  return out;
}

/** The change set's shape, for the box to check what a function gives back before Boni looks at it. */
export const CHANGE_SET_SCHEMA: Schema = {
  type: "object",
  required: ["changes"],
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: FUNCTION_LIMITS.text },
    report: {
      type: "array",
      maxItems: FUNCTION_LIMITS.report,
      items: { type: "string", maxLength: FUNCTION_LIMITS.text },
    },
    changes: {
      type: "array",
      maxItems: FUNCTION_LIMITS.changes,
      items: {
        anyOf: [
          {
            type: "object",
            required: ["op", "collection", "values"],
            additionalProperties: false,
            properties: {
              op: { enum: ["create"] },
              collection: { type: "string", maxLength: 40 },
              values: { type: "object" },
              ref: { type: "string", maxLength: 40 },
            },
          },
          {
            type: "object",
            required: ["op", "id", "version", "values"],
            additionalProperties: false,
            properties: {
              op: { enum: ["update"] },
              id: { type: "string", maxLength: 64 },
              version: { type: "integer", minimum: 1 },
              values: { type: "object" },
            },
          },
          {
            type: "object",
            required: ["op", "question"],
            additionalProperties: false,
            properties: {
              op: { enum: ["ask"] },
              question: { type: "string", maxLength: FUNCTION_LIMITS.text },
              options: {
                type: "array",
                maxItems: FUNCTION_LIMITS.options,
                items: { type: "string", maxLength: 80 },
              },
            },
          },
        ],
      },
    },
  },
};

/**
 * What is wrong with a change set against what its function declared: only collections and fields it may write,
 * rows made only where it may make them, rows changed only among those it was given (at the version it was given),
 * questions only if it asks, and plain text. `read` is each row it got (id → its collection and version).
 */
export function changeSetErrors(
  cs: unknown,
  fn: FunctionSpec,
  read: ReadonlyMap<string, { collection: string; version: number }>,
): string[] {
  if (!isObj(cs) || !Array.isArray(cs.changes)) return ["not a change set"];
  const out: string[] = [];
  if (only(cs, ["changes", "summary", "report"]).length) out.push("unknown keys");
  if (cs.summary !== undefined && !isText(cs.summary, FUNCTION_LIMITS.text))
    out.push("summary: plain text");
  if (
    cs.report !== undefined &&
    (!Array.isArray(cs.report) ||
      cs.report.length > FUNCTION_LIMITS.report ||
      !cs.report.every((l) => isText(l, FUNCTION_LIMITS.text)))
  )
    out.push(`report: up to ${FUNCTION_LIMITS.report} lines of plain text`);
  if (cs.changes.length > FUNCTION_LIMITS.changes) out.push("too many changes");
  const writable = new Map(fn.writes.map((w) => [w.collection, w]));
  const touched = new Set<string>();
  for (const [i, c] of cs.changes.entries()) {
    const w = `changes[${i}]`;
    if (out.length > 20) break;
    if (!isObj(c)) {
      out.push(`${w}: not an object`);
      continue;
    }
    const values = (spec: WriteSpec | undefined) => {
      if (!isObj(c.values) || !Object.keys(c.values).length) {
        out.push(`${w}.values: at least one`);
        return;
      }
      for (const [k, v] of Object.entries(c.values)) {
        if (!spec?.fields.includes(k)) out.push(`${w}.values.${k}: not one it may write`);
        else if (!isJson(v)) out.push(`${w}.values.${k}: not JSON`);
      }
    };
    if (c.op === "create") {
      if (only(c, ["op", "collection", "values", "ref"]).length) out.push(`${w}: unknown keys`);
      const spec = typeof c.collection === "string" ? writable.get(c.collection) : undefined;
      if (!spec?.create) out.push(`${w}.collection: not one it may make rows in`);
      values(spec);
      if (c.ref !== undefined && (typeof c.ref !== "string" || !KEY.test(c.ref)))
        out.push(`${w}.ref: a key`);
    } else if (c.op === "update") {
      if (only(c, ["op", "id", "version", "values"]).length) out.push(`${w}: unknown keys`);
      const got = typeof c.id === "string" ? read.get(c.id) : undefined;
      if (!got) {
        out.push(`${w}.id: not a row it was given`);
        continue;
      }
      if (touched.has(c.id as string)) out.push(`${w}.id: changed twice`);
      touched.add(c.id as string);
      const spec = writable.get(got.collection);
      if (!spec?.update) out.push(`${w}: it may not change rows of ${got.collection}`);
      if (c.version !== got.version) out.push(`${w}.version: not the one it was given`);
      values(spec);
    } else if (c.op === "ask") {
      if (only(c, ["op", "question", "options"]).length) out.push(`${w}: unknown keys`);
      if (!fn.asks) out.push(`${w}: it does not ask`);
      if (!isText(c.question, FUNCTION_LIMITS.text)) out.push(`${w}.question: plain text`);
      if (
        c.options !== undefined &&
        (!Array.isArray(c.options) ||
          c.options.length > FUNCTION_LIMITS.options ||
          !c.options.every((o) => isText(o, 80)))
      )
        out.push(`${w}.options: up to ${FUNCTION_LIMITS.options} plain texts`);
    } else out.push(`${w}.op: create, update or ask`);
  }
  return out;
}

/**
 * What a new version's functions ask for that the old one's did not: a function new or with other code, a
 * collection or a field more to read or to write, making rows, changing rows, asking.
 */
export function functionNeeds(
  old: readonly FunctionSpec[],
  next: readonly FunctionSpec[],
): string[] {
  const out: string[] = [];
  const before = new Map(old.map((f) => [f.name, f]));
  for (const f of next) {
    const was = before.get(f.name);
    if (!was) out.push(`function:${f.name}`);
    else if (was.hash !== f.hash) out.push(`code:${f.name}`);
    for (const r of f.reads) {
      const prev = was?.reads.find((x) => x.collection === r.collection);
      for (const k of r.fields)
        if (!prev?.fields.includes(k)) out.push(`reads:${r.collection}.${k}`);
    }
    for (const w of f.writes) {
      const prev = was?.writes.find((x) => x.collection === w.collection);
      for (const k of w.fields)
        if (!prev?.fields.includes(k)) out.push(`writes:${w.collection}.${k}`);
      if (w.create && !prev?.create) out.push(`creates:${w.collection}`);
      if (w.update && !prev?.update) out.push(`updates:${w.collection}`);
    }
    if (f.asks && !was?.asks) out.push(`asks:${f.name}`);
  }
  return [...new Set(out)];
}
