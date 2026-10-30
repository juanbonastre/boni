/**
 * Extensions (docs/extensiones.md, section 3): a manifest is data made only of catalogue pieces, which the
 * code interprets the way it interprets a plan. Nothing in it is code; anything the catalogue does not
 * offer is refused. The manifest is closed: an unknown key is an error, not something ignored, so a
 * manifest written for a newer Boni never half-works on an older one. Its functions (§11, `functions.ts`) are
 * code, but they only ever run in the box and only give back what Boni checks and applies.
 */
import { type FunctionSpec, functionNeeds, functionsErrors, type TestSpec } from "./functions.ts";

/** A source: a connector of the catalogue bringing items into one of the extension's types. */
export interface SourceSpec {
  connector: string;
  /** The key of the type it fills (one of `types`). */
  into: string;
}

/** A type the extension brings (the code makes it the first time; its fields by key). */
export interface TypeSpec {
  key: string;
  name: string;
  fields: string[];
}

/**
 * What a reading looks for: a module of the catalogue by its id, or one defined here with its own kind
 * and prompt part (the base reader and its checks stay code: docs/nucleo.md 7.4b).
 */
export type ReaderSpec = { module: string } | { module: string; kind: string; prompt: string };

/** When something happens: a trigger and a plan template of the catalogue. */
export interface FlowSpec {
  on: { created: string };
  plan: string;
}

/** What the code does with each item a module keeps: propose it (in the collection the reader picks among
 * the marked ones, or in a fixed one), or nothing. Everything still goes through the policy. */
export type RouteSpec =
  | { propose: "chosen" }
  | { propose: { collection: string } }
  | { none: true };

export interface NeedsSpec {
  /** Type keys it reads. */
  reads: string[];
  /** Whether it may propose new items (always through the inbox). */
  proposes: boolean;
  /** The model role each of its steps uses (docs/extensiones.md 9). */
  roles?: { reader?: string; reviewer?: string };
  /** Reader calls per day, at most. */
  budget?: { readersPerDay: number };
}

export interface ExtensionManifest {
  id: string;
  name: string;
  /** Goes up with every change of the manifest. */
  version: number;
  description?: string;
  types?: TypeSpec[];
  sources?: SourceSpec[];
  readers?: ReaderSpec[];
  flows?: FlowSpec[];
  routes?: Record<string, RouteSpec>;
  /** Juan's decisions on its proposals feed the reviewer every `every` decisions. */
  learning?: { every: number };
  /** Its functions (docs/extensiones.md §11), each tried by its tests before it may be activated. */
  functions?: FunctionSpec[];
  tests?: TestSpec[];
  needs: NeedsSpec;
}

/** The pieces a manifest may name: what this build of Boni offers (layer 1). */
export interface Catalogue {
  connectors: readonly string[];
  /** Built-in reading modules by id, with the kind each looks for. */
  modules: Readonly<Record<string, { kind: string }>>;
  plans: readonly string[];
  roles: readonly string[];
}

const ID = /^[a-z][a-z0-9-]{1,39}$/;
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const KIND = /^[a-z][a-z0-9_]{1,23}$/;
const LINK_OR_HTML = /(https?:\/\/|www\.|<\s*\/?\s*[a-z!]|\]\(|javascript:|data:)/i;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const only = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).filter((k) => !keys.includes(k));

export const LIMITS = {
  types: 5,
  fields: 30,
  sources: 3,
  readers: 6,
  prompt: 1200,
  flows: 5,
  budget: 2000,
} as const;

/**
 * Problems of a manifest against this catalogue (empty when it is fine). Checks every key, every name the
 * manifest uses and every number; `ok` narrows the type.
 */
export function manifestErrors(m: unknown, cat: Catalogue): string[] {
  const e: string[] = [];
  if (!isObj(m)) return ["manifest: not an object"];
  const extra = only(m, [
    "id",
    "name",
    "version",
    "description",
    "types",
    "sources",
    "readers",
    "flows",
    "routes",
    "learning",
    "functions",
    "tests",
    "needs",
  ]);
  if (extra.length) e.push(`manifest: unknown keys ${extra.join(", ")}`);
  if (typeof m.id !== "string" || !ID.test(m.id)) e.push("id: lowercase letters, digits and -");
  if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 60)
    e.push("name: 1 to 60 characters");
  if (!Number.isInteger(m.version) || (m.version as number) < 1)
    e.push("version: a whole number from 1");
  if (
    m.description !== undefined &&
    (typeof m.description !== "string" || m.description.length > 300)
  )
    e.push("description: at most 300 characters");

  const list = (k: string, max: number) => {
    const v = m[k];
    if (v === undefined) return [] as unknown[];
    if (!Array.isArray(v)) {
      e.push(`${k}: a list`);
      return [];
    }
    if (v.length > max) e.push(`${k}: at most ${max}`);
    return v;
  };

  const typeKeys = new Set<string>();
  for (const [i, t] of list("types", LIMITS.types).entries()) {
    const w = `types[${i}]`;
    if (!isObj(t)) {
      e.push(`${w}: not an object`);
      continue;
    }
    if (only(t, ["key", "name", "fields"]).length) e.push(`${w}: unknown keys`);
    if (typeof t.key !== "string" || !KEY.test(t.key)) e.push(`${w}.key: ASCII key`);
    else if (typeKeys.has(t.key)) e.push(`${w}.key: used twice`);
    else typeKeys.add(t.key);
    if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 80)
      e.push(`${w}.name: 1 to 80 characters`);
    if (
      !Array.isArray(t.fields) ||
      t.fields.length > LIMITS.fields ||
      !t.fields.every((f) => typeof f === "string" && KEY.test(f))
    )
      e.push(`${w}.fields: a list of ASCII keys`);
  }

  for (const [i, s] of list("sources", LIMITS.sources).entries()) {
    const w = `sources[${i}]`;
    if (!isObj(s)) {
      e.push(`${w}: not an object`);
      continue;
    }
    if (only(s, ["connector", "into"]).length) e.push(`${w}: unknown keys`);
    if (typeof s.connector !== "string" || !cat.connectors.includes(s.connector))
      e.push(`${w}.connector: not in the catalogue`);
    if (typeof s.into !== "string" || !typeKeys.has(s.into)) e.push(`${w}.into: one of its types`);
  }

  const modules = new Map<string, string>();
  for (const [i, r] of list("readers", LIMITS.readers).entries()) {
    const w = `readers[${i}]`;
    if (!isObj(r)) {
      e.push(`${w}: not an object`);
      continue;
    }
    const custom = "kind" in r || "prompt" in r;
    if (only(r, custom ? ["module", "kind", "prompt"] : ["module"]).length)
      e.push(`${w}: unknown keys`);
    if (typeof r.module !== "string" || !KIND.test(r.module)) {
      e.push(`${w}.module: ASCII id`);
      continue;
    }
    if (modules.has(r.module)) {
      e.push(`${w}.module: used twice`);
      continue;
    }
    if (!custom) {
      const built = cat.modules[r.module];
      if (!built) {
        e.push(`${w}.module: not in the catalogue`);
        continue;
      }
      modules.set(r.module, built.kind);
      continue;
    }
    if (typeof r.kind !== "string" || !KIND.test(r.kind) || r.kind === "notice")
      e.push(`${w}.kind: ASCII id, not "notice"`);
    if (
      typeof r.prompt !== "string" ||
      !r.prompt.trim() ||
      r.prompt.length > LIMITS.prompt ||
      LINK_OR_HTML.test(r.prompt)
    )
      e.push(`${w}.prompt: 1 to ${LIMITS.prompt} characters, no links or HTML`);
    modules.set(r.module, String(r.kind));
  }
  const kinds = [...modules.values()];
  if (new Set(kinds).size !== kinds.length) e.push("readers: two modules look for the same kind");

  for (const [i, f] of list("flows", LIMITS.flows).entries()) {
    const w = `flows[${i}]`;
    if (!isObj(f)) {
      e.push(`${w}: not an object`);
      continue;
    }
    if (only(f, ["on", "plan"]).length) e.push(`${w}: unknown keys`);
    if (!isObj(f.on) || only(f.on, ["created"]).length || typeof f.on.created !== "string")
      e.push(`${w}.on: { created: type key }`);
    else if (!typeKeys.has(f.on.created)) e.push(`${w}.on.created: one of its types`);
    if (typeof f.plan !== "string" || !cat.plans.includes(f.plan))
      e.push(`${w}.plan: not in the catalogue`);
  }

  if (m.routes !== undefined) {
    if (!isObj(m.routes)) e.push("routes: an object by module");
    else
      for (const [k, r] of Object.entries(m.routes)) {
        const w = `routes.${k}`;
        if (!modules.has(k)) e.push(`${w}: not one of its modules`);
        const ok =
          isObj(r) &&
          ((Object.keys(r).join() === "propose" &&
            (r.propose === "chosen" ||
              (isObj(r.propose) &&
                Object.keys(r.propose).join() === "collection" &&
                typeof r.propose.collection === "string" &&
                /^[a-z][a-z0-9_]{1,63}$/.test(r.propose.collection)))) ||
            (Object.keys(r).join() === "none" && r.none === true));
        if (!ok)
          e.push(`${w}: { propose: "chosen" }, { propose: { collection } } or { none: true }`);
      }
  }

  if (m.learning !== undefined) {
    const l = m.learning;
    if (
      !isObj(l) ||
      only(l, ["every"]).length ||
      !Number.isInteger(l.every) ||
      (l.every as number) < 5 ||
      (l.every as number) > 500
    )
      e.push("learning: { every: 5 to 500 }");
  }

  e.push(...functionsErrors(m.functions, m.tests));

  const n = m.needs;
  if (!isObj(n)) e.push("needs: required");
  else {
    if (only(n, ["reads", "proposes", "roles", "budget"]).length) e.push("needs: unknown keys");
    if (!Array.isArray(n.reads) || !n.reads.every((k) => typeof k === "string" && KEY.test(k)))
      e.push("needs.reads: a list of type keys");
    else {
      // What it reads is what it says it reads: its sources' and flows' types.
      const used = [
        ...list("sources", LIMITS.sources).map((s) => (isObj(s) ? s.into : null)),
        ...list("flows", LIMITS.flows).map((f) => (isObj(f) && isObj(f.on) ? f.on.created : null)),
        ...(Array.isArray(m.functions) ? m.functions : []).flatMap((f) =>
          isObj(f) && Array.isArray(f.reads)
            ? f.reads.map((r) => (isObj(r) ? r.collection : null))
            : [],
        ),
      ].filter((k): k is string => typeof k === "string");
      for (const k of used) if (!n.reads.includes(k)) e.push(`needs.reads: misses ${k}`);
    }
    if (typeof n.proposes !== "boolean") e.push("needs.proposes: true or false");
    const proposing =
      isObj(m.routes) && Object.values(m.routes).some((r) => isObj(r) && "propose" in r);
    if (proposing && n.proposes !== true) e.push("needs.proposes: its routes propose");
    if (n.roles !== undefined) {
      if (!isObj(n.roles) || only(n.roles, ["reader", "reviewer"]).length)
        e.push("needs.roles: reader, reviewer");
      else
        for (const [k, v] of Object.entries(n.roles))
          if (typeof v !== "string" || !cat.roles.includes(v))
            e.push(`needs.roles.${k}: not in the catalogue`);
    }
    if (n.budget !== undefined) {
      const b = n.budget;
      if (
        !isObj(b) ||
        only(b, ["readersPerDay"]).length ||
        !Number.isInteger(b.readersPerDay) ||
        (b.readersPerDay as number) < 1 ||
        (b.readersPerDay as number) > LIMITS.budget
      )
        e.push(`needs.budget: { readersPerDay: 1 to ${LIMITS.budget} }`);
    }
  }
  return e;
}

/** The manifest, if it is one. */
export function parseManifest(
  m: unknown,
  cat: Catalogue,
): { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] } {
  const errors = manifestErrors(m, cat);
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as ExtensionManifest };
}

/**
 * What a new version asks for that the old one did not: more types read, proposing, a stronger role, a
 * bigger budget, new sources, and of its functions new code, fields more to read or write, making or changing
 * rows, asking. Shown to Juan before he accepts a change (docs/extensiones.md, 3 and §11).
 */
export function moreNeeds(old: ExtensionManifest, next: ExtensionManifest): string[] {
  const out: string[] = [];
  for (const k of next.needs.reads) if (!old.needs.reads.includes(k)) out.push(`reads:${k}`);
  if (next.needs.proposes && !old.needs.proposes) out.push("proposes");
  const was = new Set((old.sources ?? []).map((s) => s.connector));
  for (const s of next.sources ?? []) if (!was.has(s.connector)) out.push(`source:${s.connector}`);
  if ((next.needs.budget?.readersPerDay ?? 0) > (old.needs.budget?.readersPerDay ?? 0))
    out.push("budget");
  for (const r of ["reader", "reviewer"] as const)
    if ((next.needs.roles?.[r] ?? "") !== (old.needs.roles?.[r] ?? "")) out.push(`role:${r}`);
  out.push(...functionNeeds(old.functions ?? [], next.functions ?? []));
  return out;
}
