/**
 * An extension proposed through Boni's MCP (docs/extensiones.md §11, E3). Proposing never activates anything: the
 * manifest is checked, its code against its hashes, its tests run in the box and each function is tried on Juan's
 * data without saving; only a proposal whose tests pass is kept, as the extension's pending version. Juan activates
 * it in Boni, from a device of his (the card shows what it asks for beyond the active version, its tests, the dry
 * runs and its code); the version it replaces is kept, and going back to it is one click.
 */

import { label, type TypeDef } from "@boni/entities";
import {
  type ExtensionManifest,
  type FunctionSpec,
  manifestErrors,
  moreNeeds,
} from "@boni/extensions";
import type { UserStore } from "@boni/store";
import { CATALOGUE, installed } from "./extensions.ts";
import { callFunction, dryRun, type Runner, runTests } from "./functions.ts";
import { codeHash, runInSandbox } from "./sandbox.ts";

export interface ProposalReport {
  tests: { function: string; name: string; ok: boolean; message?: string }[];
  dryRuns: {
    function: string;
    ok: boolean;
    message?: string;
    creates?: Record<string, number>;
    updates?: number;
    asks?: string[];
  }[];
}

export interface Proposal {
  manifest: ExtensionManifest;
  /** Who proposed it (`mcp:<device>`). */
  by: string;
  at: number;
  report: ProposalReport;
}

/** A pending proposal as the card shows it: what it asks for in words a person reads, never codes. */
export interface ProposalView {
  id: string;
  name: string;
  description: string;
  version: number;
  /** The active version, or null when the extension is new. */
  active: number | null;
  by: string;
  at: number;
  more: {
    code: string[];
    reads: { collection: string; fields: string[] }[];
    writes: { collection: string; fields: string[] }[];
    creates: string[];
    updates: string[];
    asks: boolean;
    other: string[];
  };
  /** What it reads that is private: nothing until E5 (Juan's permission, collection by collection). */
  privateReads: string[];
  report: ProposalReport;
  functions: { name: string; hash: string; code: string }[];
}

const CODE = label("own", "personal", [{ kind: "code", id: "extensions" }]);
const v = (value: string) => ({ value, label: CODE });
const EMPTY = (m: ExtensionManifest): ExtensionManifest => ({
  id: m.id,
  name: m.name,
  version: 0,
  needs: { reads: [], proposes: false },
});

const entityOf = (store: UserStore, id: string) =>
  store.schema().types.extension
    ? (store.list("extension").find((e) => e.entity.values.f_key === id) ?? null)
    : null;
const json = <T>(s: unknown): T | null => {
  try {
    return s ? (JSON.parse(String(s)) as T) : null;
  } catch {
    return null;
  }
};

/** What is wrong with a proposed manifest before anything runs: its shape, its hashes, its version. */
export function proposalErrors(store: UserStore, m: unknown): string[] {
  const errors = manifestErrors(m, CATALOGUE);
  if (errors.length) return errors;
  const manifest = m as ExtensionManifest;
  for (const f of manifest.functions ?? [])
    if (codeHash(f.code) !== f.hash) errors.push(`functions.${f.name}.hash: not its code's sha256`);
  const active = installed(store).find((i) => i.manifest.id === manifest.id);
  if (active && manifest.version <= active.manifest.version)
    errors.push(`version: above the active one (${active.manifest.version})`);
  if (!manifest.functions?.length)
    errors.push("functions: a proposal through the MCP brings functions");
  return errors;
}

/**
 * Tries a proposal: its tests in the box, and each function on Juan's data without saving (with the data the
 * proposer gives for it, labelled as a model's). Kept as the extension's pending version only if every test passes;
 * nothing else changes.
 */
export async function propose(
  store: UserStore,
  m: unknown,
  by: string,
  opts: { data?: Record<string, unknown>; run?: Runner; now?: () => number } = {},
): Promise<{ ok: boolean; errors: string[]; report?: ProposalReport; kept: boolean }> {
  const errors = proposalErrors(store, m);
  if (errors.length) return { ok: false, errors, kept: false };
  const manifest = m as ExtensionManifest;
  const run = opts.run ?? runInSandbox;
  const tests = await runTests(manifest, run);
  const fromModel = label("model", "personal", [{ kind: "model", id: by }]);
  const dryRuns: ProposalReport["dryRuns"] = [];
  for (const f of manifest.functions ?? []) {
    const data = opts.data?.[f.name];
    const r = await callFunction(store, manifest, f.name, {
      run,
      ...(data !== undefined ? { data: { value: data, label: fromModel } } : {}),
    });
    if (!r.ok) {
      dryRuns.push({ function: f.name, ok: false, message: r.message });
      continue;
    }
    const d = dryRun(store, r.changeSet, r.read);
    dryRuns.push({
      function: f.name,
      ok: true,
      creates: d.creates,
      updates: d.updates,
      asks: d.asks,
    });
  }
  const report = { tests, dryRuns };
  if (!tests.every((t) => t.ok))
    return { ok: false, errors: ["tests: not all pass"], report, kept: false };
  const proposal: Proposal = { manifest, by, at: (opts.now ?? Date.now)(), report };
  const e = entityOf(store, manifest.id);
  const meta = { actor: "system" as const, by };
  if (e) store.update(e.entity.id, { f_proposal: v(JSON.stringify(proposal)) }, meta);
  else
    store.create(
      "extension",
      {
        f_key: v(manifest.id),
        f_name: v(manifest.name),
        f_state: v("proposed"),
        f_proposal: v(JSON.stringify(proposal)),
      },
      meta,
    );
  return { ok: true, errors: [], report, kept: true };
}

/** A collection's name and its fields' names, by their keys, for the card. */
function namesOf(store: UserStore) {
  const byKey = new Map<string, TypeDef>(
    Object.values(store.schema().types)
      .filter((t) => !t.system)
      .map((t) => [t.key, t]),
  );
  return {
    collection: (k: string) => byKey.get(k)?.name ?? k,
    field: (c: string, k: string) => byKey.get(c)?.fields.find((f) => f.key === k)?.name ?? k,
  };
}

/** What a proposal asks for beyond the active version, grouped for the card, in the account's names. */
export function moreOf(
  store: UserStore,
  active: ExtensionManifest | null,
  next: ExtensionManifest,
) {
  const codes = moreNeeds(active ?? EMPTY(next), next);
  const n = namesOf(store);
  const more: ProposalView["more"] = {
    code: [],
    reads: [],
    writes: [],
    creates: [],
    updates: [],
    asks: false,
    other: [],
  };
  const add = (list: { collection: string; fields: string[] }[], c: string, f: string) => {
    const name = n.collection(c);
    const at = list.find((x) => x.collection === name);
    if (at) at.fields.push(n.field(c, f));
    else list.push({ collection: name, fields: [n.field(c, f)] });
  };
  for (const code of codes) {
    const [kind, rest = ""] = code.split(":");
    const [c = "", f = ""] = rest.split(".");
    if (kind === "function" || kind === "code") more.code.push(rest);
    else if (kind === "reads" && f) add(more.reads, c, f);
    else if (kind === "writes") add(more.writes, c, f);
    else if (kind === "creates") more.creates.push(n.collection(c));
    else if (kind === "updates") more.updates.push(n.collection(c));
    else if (kind === "asks") more.asks = true;
    // What functions read is said field by field; the manifest's own `reads:` of a collection adds nothing.
    else if (!(kind === "reads" && !f)) more.other.push(code);
  }
  more.code = [...new Set(more.code)];
  return more;
}

/** The pending proposals, as the card shows them. */
export function proposals(store: UserStore): ProposalView[] {
  if (!store.schema().types.extension) return [];
  const out: ProposalView[] = [];
  const names = namesOf(store);
  for (const e of store.list("extension")) {
    const p = json<Proposal>(e.entity.values.f_proposal);
    if (!p) continue;
    const active = json<ExtensionManifest>(e.entity.values.f_manifest);
    out.push({
      id: p.manifest.id,
      name: p.manifest.name,
      description: p.manifest.description ?? "",
      version: p.manifest.version,
      active: active?.version ?? null,
      by: p.by,
      at: p.at,
      more: moreOf(store, active, p.manifest),
      privateReads: [],
      // The dry runs' collections by the account's names, as the rest of the card.
      report: {
        ...p.report,
        dryRuns: p.report.dryRuns.map((d) =>
          d.creates
            ? {
                ...d,
                creates: Object.fromEntries(
                  Object.entries(d.creates).map(([k, n]) => [names.collection(k), n]),
                ),
              }
            : d,
        ),
      },
      functions: (p.manifest.functions ?? []).map((f: FunctionSpec) => ({
        name: f.name,
        hash: f.hash,
        code: f.code,
      })),
    });
  }
  return out;
}

/** Juan activates a proposal (from a device of his: the route checks it). The version it replaces is kept. */
export function activate(store: UserStore, id: string, device: string): boolean {
  const e = entityOf(store, id);
  const p = json<Proposal>(e?.entity.values.f_proposal);
  if (!e || !p || proposalErrors(store, p.manifest).length) return false;
  store.update(
    e.entity.id,
    {
      f_manifest: v(JSON.stringify(p.manifest)),
      f_name: v(p.manifest.name),
      f_previous: v(String(e.entity.values.f_manifest ?? "")),
      f_state: v("on"),
      f_preset: v(""),
      f_proposal: v(""),
    },
    { actor: "system", device },
  );
  return true;
}

/** Juan rejects a proposal: it goes; an extension that was only proposed goes to the trash. */
export function reject(store: UserStore, id: string, device: string): boolean {
  const e = entityOf(store, id);
  if (!e?.entity.values.f_proposal) return false;
  if (!e.entity.values.f_manifest) store.remove(e.entity.id, { actor: "system", device });
  else store.update(e.entity.id, { f_proposal: v("") }, { actor: "system", device });
  return true;
}

/** Back to the version before the active one (and forward again, the same way): one click. */
export function revert(store: UserStore, id: string, device: string): boolean {
  const e = entityOf(store, id);
  const previous = e?.entity.values.f_previous;
  if (!e || !previous) return false;
  const back = json<ExtensionManifest>(previous);
  if (!back || manifestErrors(back, CATALOGUE).length) return false;
  store.update(
    e.entity.id,
    {
      f_manifest: v(String(previous)),
      f_name: v(back.name),
      f_previous: v(String(e.entity.values.f_manifest ?? "")),
    },
    { actor: "system", device },
  );
  return true;
}

/** The version Juan can go back to (the one before the active), or null. */
export function previousVersion(store: UserStore, id: string): number | null {
  return json<ExtensionManifest>(entityOf(store, id)?.entity.values.f_previous)?.version ?? null;
}
