/**
 * An extension's functions in the server (docs/extensiones.md §11, E2). What a function gets: the rows of the
 * collections it declared, with only the fields it declared, as the models may see them (nothing restricted or
 * private until E5; an opaque collection's values marked for no model). The call goes to the box; what comes back is
 * a change set, checked against what it declared. A dry run says what it would do and whether a row it read has
 * changed since (then it is run again); applying it goes through the policy (P4 when it is made of something from
 * outside, P11 when it is many, P7 in the background) and is one run that Undo takes back whole. What it writes
 * carries the label of what it read with its integrity at most `model`, so it is never a destination (P2), and
 * nothing it read ends up more open to the models than it was.
 */
import { randomUUID } from "node:crypto";
import { type Decision, decide, leaf, type Origin, readStore, type ToolDef } from "@boni/agent";
import {
  type FieldDef,
  integrityRank,
  join,
  type Label,
  label,
  type TypeDef,
} from "@boni/entities";
import {
  CHANGE_SET_SCHEMA,
  type ChangeSet,
  changeSetErrors,
  type ExtensionManifest,
  type FunctionInput,
  type FunctionSpec,
} from "@boni/extensions";
import type { RunRequest, RunResponse } from "@boni/sandbox";
import { BODY, levelRank, type UserStore, type Writes } from "@boni/store";
import { codeHash, runInSandbox } from "./sandbox.ts";

/** Calls the box: the server's client, or a stand-in in a test. */
export type Runner = (req: RunRequest) => Promise<RunResponse>;

/** The rows a function read: id → its collection (key) and the version it was given. */
export type Read = Map<string, { collection: string; version: number }>;

type Failure = { ok: false; error: string; message: string };

const typeByKey = (store: UserStore, key: string): TypeDef | undefined =>
  Object.values(store.schema().types).find((t) => t.key === key && !t.archived && !t.system);
const fieldByKey = (t: TypeDef, key: string): FieldDef | undefined =>
  t.fields.find((f) => f.key === key && !f.archived && !f.hidden);
/** Where a declared field is kept: a field by its key, or the row's title or its text (`$title`, `$text`). */
type Slot = { id: string; field: FieldDef | null };
const slotByKey = (t: TypeDef, key: string): Slot | undefined => {
  if (key === "$text") return { id: BODY, field: null };
  const f = key === "$title" ? t.fields.find((x) => x.id === t.titleField) : fieldByKey(t, key);
  return f ? { id: f.id, field: f } : undefined;
};
const choices = (f: FieldDef | null) => f?.type === "select" || f?.type === "multiselect";
/** A value as a function gets it: an option by its name (its id is the account's own). */
function shown(f: FieldDef | null, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (!f || !choices(f)) return v;
  const name = (x: unknown) => f.options?.find((o) => o.id === x)?.name ?? x;
  return f.type === "select" ? name(v) : (Array.isArray(v) ? v : [v]).map(name);
}
/** A value a function gave, as Boni keeps it: an option by its name to its id; one the field does not have is refused. */
function kept(f: FieldDef | null, v: unknown): { ok: true; value: unknown } | { ok: false } {
  if (!f || !choices(f) || v === null) return { ok: true, value: v };
  const id = (x: unknown) =>
    f.options?.find((o) => o.name === x)?.id ?? f.options?.find((o) => o.id === x)?.id;
  const list = f.type === "select" ? [v] : Array.isArray(v) ? v : [v];
  const out = list.map(id);
  if (out.some((x) => x === undefined)) return { ok: false };
  return { ok: true, value: f.type === "select" ? out[0] : out };
}
/** Nothing comes in when a function reads nothing: Boni's own code is its source. */
const NOTHING = label("own", "public", [{ kind: "code", id: "extensions" }]);

/**
 * What a function gets: its declared fields of its declared collections, as the models may see them, each row with
 * its id and version; and the label of all it got (with the flow's data, when there is some).
 */
export function inputFor(
  store: UserStore,
  fn: FunctionSpec,
  data?: { value: unknown; label: Label },
): { ok: true; input: FunctionInput; label: Label; read: Read } | Failure {
  const view = readStore(store);
  const visible = view.schema().types;
  const rows: FunctionInput["rows"] = {};
  const labels: Label[] = data ? [data.label] : [];
  const read: Read = new Map();
  for (const r of fn.reads) {
    const t = typeByKey(store, r.collection);
    if (!t)
      return { ok: false, error: "missing", message: `no hay ninguna colección «${r.collection}»` };
    // Restricted and private collections are not given to a function (only with Juan's permission, E5).
    if (!visible[t.id])
      return { ok: false, error: "closed", message: `«${t.name}» está cerrada a las extensiones` };
    const fields: [string, Slot][] = [];
    for (const k of r.fields) {
      const f = slotByKey(t, k);
      if (!f)
        return { ok: false, error: "missing", message: `«${t.name}» no tiene el campo «${k}»` };
      fields.push([k, f]);
    }
    rows[r.collection] = view.list(t.id).map((s) => {
      read.set(s.entity.id, { collection: r.collection, version: s.entity.version });
      const values: Record<string, unknown> = {};
      for (const [k, f] of fields) {
        values[k] = f.id === BODY ? (s.entity.body ?? null) : shown(f.field, s.entity.values[f.id]);
        const l = s.labels[f.id];
        if (l) labels.push(l);
      }
      return { id: s.entity.id, version: s.entity.version, values };
    });
  }
  const input: FunctionInput = { rows, ...(data ? { data: data.value } : {}) };
  return {
    ok: true,
    input,
    label: labels.length ? join(labels[0] as Label, ...labels.slice(1)) : NOTHING,
    read,
  };
}

/** The label of what a function makes: what it read, its integrity at most `model`, and the function among its sources. */
export function derivedLabel(from: Label, ext: string, fn: string): Label {
  const capped =
    integrityRank(from.integrity) > integrityRank("model")
      ? { ...from, integrity: "model" as const }
      : from;
  return join(capped, { ...capped, sources: [{ kind: "extension", id: `${ext}/${fn}` }] });
}

/**
 * Runs one of an extension's functions in the box and gives back its change set, checked against what the
 * function declared, with the label of what it is made of and the rows it read.
 */
export async function callFunction(
  store: UserStore,
  ext: ExtensionManifest,
  name: string,
  opts: {
    data?: { value: unknown; label: Label };
    day?: string;
    seed?: number;
    run?: Runner;
  } = {},
): Promise<{ ok: true; changeSet: ChangeSet; label: Label; read: Read } | Failure> {
  const fn = ext.functions?.find((f) => f.name === name);
  if (!fn)
    return { ok: false, error: "missing", message: `«${ext.name}» no tiene la función ${name}` };
  if (codeHash(fn.code) !== fn.hash)
    return { ok: false, error: "invalid", message: "el código no es el de su huella" };
  const got = inputFor(store, fn, opts.data);
  if (!got.ok) return got;
  const res = await (opts.run ?? runInSandbox)({
    id: `${ext.id}.${fn.name}.${randomUUID().slice(0, 8)}`,
    code: fn.code,
    hash: fn.hash,
    fn: fn.name,
    input: got.input,
    day: opts.day ?? new Date().toISOString().slice(0, 10),
    seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
    ...(fn.limits ? { limits: fn.limits } : {}),
    output: CHANGE_SET_SCHEMA,
  });
  if (!res.ok) return { ok: false, error: res.error, message: res.message };
  const errs = changeSetErrors(res.output, fn, got.read);
  if (errs.length)
    return {
      ok: false,
      error: "scope",
      message: `ha devuelto lo que no declaró: ${errs.slice(0, 5).join("; ")}`,
    };
  return {
    ok: true,
    changeSet: res.output as ChangeSet,
    label: derivedLabel(got.label, ext.id, fn.name),
    read: got.read,
  };
}

export interface DryRun {
  /** Rows it would make, by collection key. */
  creates: Record<string, number>;
  updates: number;
  asks: string[];
  /** Rows it read that changed since: the function is run again before anything is applied. */
  stale: string[];
}

/** What applying it would do, nothing written. */
export function dryRun(store: UserStore, cs: ChangeSet, read: Read): DryRun {
  const out: DryRun = { creates: {}, updates: 0, asks: [], stale: [] };
  for (const c of cs.changes) {
    if (c.op === "create") out.creates[c.collection] = (out.creates[c.collection] ?? 0) + 1;
    else if (c.op === "update") out.updates++;
    else out.asks.push(c.question);
  }
  for (const [id, r] of read) {
    const now = store.get(id);
    if (!now || now.entity.deleted || now.entity.version !== r.version) out.stale.push(id);
  }
  return out;
}

/** The policy's tool for applying a change set: a write like any other (docs/nucleo.md 7.5). */
const APPLY: ToolDef<"write"> = {
  name: "extension.apply",
  effect: "write",
  describe: "Applies the change set an extension's function gave back.",
  title: "Aplicar los cambios de una extensión",
  args: { changes: { role: "content", required: true, describe: "The change set." } },
  run: () => {
    throw new Error("applied by applyChangeSet");
  },
};

/** What the policy says of applying it: allow, confirm (P11: many), propose (P4: from outside; P7: background). */
export function decideApply(cs: ChangeSet, made: Label, origin: Origin): Decision {
  const writes = cs.changes.filter((c) => c.op !== "ask").length;
  return decide({ tool: APPLY, args: { changes: leaf(null, made, true) }, control: null }, origin, {
    writes: Math.max(0, writes - 1),
    sensitiveReads: 0,
  });
}

/**
 * Applies a change set in one run (one transaction; Undo takes it back whole). Refused when a row it read changed
 * since (it is run again), or when it would leave something more open to the models than where it was read.
 */
export function applyChangeSet(
  store: UserStore,
  ext: ExtensionManifest,
  name: string,
  cs: ChangeSet,
  made: Label,
  read: Read,
  meta: { device?: string } = {},
): { ok: true; run: string; created: string[]; updated: string[]; asks: string[] } | Failure {
  const fn = ext.functions?.find((f) => f.name === name);
  if (!fn)
    return { ok: false, error: "missing", message: `«${ext.name}» no tiene la función ${name}` };
  const errs = changeSetErrors(cs, fn, read);
  if (errs.length) return { ok: false, error: "scope", message: errs.slice(0, 5).join("; ") };
  if (dryRun(store, cs, read).stale.length)
    return {
      ok: false,
      error: "stale",
      message: "algo de lo que leyó ha cambiado: hay que volver a ejecutarla",
    };
  const levels = store.aiAccess();
  const run = `ext-${ext.id}-${randomUUID()}`;
  const op = { actor: "agent" as const, by: `extension:${ext.id}/${fn.name}`, run, ...meta };
  // Every write made and checked before anything is written: an option the field does not have stops it all.
  const plan: { t: TypeDef; id: string | null; version: number; writes: Writes }[] = [];
  for (const c of cs.changes) {
    if (c.op === "ask") continue;
    const key = c.op === "create" ? c.collection : (read.get(c.id)?.collection ?? "");
    const t = typeByKey(store, key);
    if (!t) return { ok: false, error: "missing", message: `no hay ninguna colección «${key}»` };
    // What no model may read (an opaque collection's) never lands where a model could read it.
    if (made.noModel && levelRank(levels[t.id]) < levelRank("opaque"))
      return {
        ok: false,
        error: "more-open",
        message: `«${t.name}» está más abierta a la IA que lo que leyó`,
      };
    const writes: Writes = {};
    for (const [k, v] of Object.entries(c.values)) {
      const slot = slotByKey(t, k);
      if (!slot) continue;
      const value = kept(slot.field, v);
      if (!value.ok)
        return {
          ok: false,
          error: "scope",
          message: `«${slot.field?.name ?? k}» de «${t.name}» no tiene la opción «${String(v)}»`,
        };
      writes[slot.id] = { value: value.value, label: made };
    }
    plan.push(
      c.op === "create"
        ? { t, id: null, version: 0, writes }
        : { t, id: c.id, version: c.version, writes },
    );
  }
  const created: string[] = [];
  const updated: string[] = [];
  try {
    store.batch(() => {
      for (const p of plan) {
        if (p.id === null) created.push(store.create(p.t.id, p.writes, op).entity.id);
        else {
          store.update(p.id, p.writes, op, p.version);
          updated.push(p.id);
        }
      }
    });
  } catch (e) {
    return { ok: false, error: "rejected", message: (e as Error).message };
  }
  return {
    ok: true,
    run,
    created,
    updated,
    asks: cs.changes.flatMap((c) => (c.op === "ask" ? [c.question] : [])),
  };
}

/** Runs an extension's tests in the box: each must give back exactly what it expects. */
export async function runTests(
  ext: ExtensionManifest,
  run: Runner = runInSandbox,
): Promise<{ function: string; name: string; ok: boolean; message?: string }[]> {
  const canon = (v: unknown): string =>
    JSON.stringify(v, (_k, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        : x,
    );
  const out: { function: string; name: string; ok: boolean; message?: string }[] = [];
  for (const t of ext.tests ?? []) {
    const fn = ext.functions?.find((f) => f.name === t.function);
    if (!fn) {
      out.push({ function: t.function, name: t.name, ok: false, message: "no existe" });
      continue;
    }
    const res = await run({
      id: `${ext.id}.prueba.${randomUUID().slice(0, 8)}`,
      code: fn.code,
      hash: fn.hash,
      fn: fn.name,
      input: t.input,
      day: "2026-01-01",
      seed: 1,
      ...(fn.limits ? { limits: fn.limits } : {}),
      output: CHANGE_SET_SCHEMA,
    });
    if (!res.ok) out.push({ function: t.function, name: t.name, ok: false, message: res.message });
    else if (canon(res.output) !== canon(t.expect))
      out.push({ function: t.function, name: t.name, ok: false, message: "no da lo esperado" });
    else out.push({ function: t.function, name: t.name, ok: true });
  }
  return out;
}
