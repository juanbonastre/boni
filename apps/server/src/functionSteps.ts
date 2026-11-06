/**
 * The steps «Función» and «Aplicar cambios» (task 93; Juan, 2026-11-06: «A: a la Bandeja»; docs/sistema.md §4.5): an
 * active extension's function run in the box as a step of a flow, and what it would change applied with the policy.
 *
 * «Función» never writes (A-09): it gives the function what it declared it reads and what the step passes it
 * (`datos`), runs it in the box and gives back what it would change, in numbers and whole, labelled with what it read
 * (its integrity at most `model`). «Aplicar cambios» is a write like any other: in a flow in the background the whole
 * set waits in the Bandeja as one proposal; accepted, it is checked again (only what the function declared, nothing it
 * read changed since) and made in that run, which Deshacer takes back whole; by hand, the policy decides as for any
 * write (P4: what a function makes is never Juan's own word).
 */
import { deepLabel, leaf, plain, rec, ToolError, type ToolRegistry, type Val } from "@boni/agent";
import { label } from "@boni/entities";
import {
  type ChangeSet,
  changeSetErrors,
  type ExtensionManifest,
  type FunctionSpec,
} from "@boni/extensions";
import { levelRank, type UserStore } from "@boni/store";
import { installed } from "./extensions.ts";
import { callFunction, dryRun, type Runner } from "./functions.ts";

/** What the server gives these steps for one account (AgentHost): its store, and the box (a stand-in in tests). */
export interface FunctionsHost {
  store(): UserStore;
  run?: Runner;
}

const CODE = label("own", "personal", [{ kind: "code", id: "functions" }]);

const hostOf = (f: unknown): FunctionsHost => {
  if (!f) throw new ToolError("no-functions");
  return f as FunctionsHost;
};
const text = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  return typeof x === "string" ? x : "";
};
/** What «Aplicar cambios» is given: a «Función» step's result, as it reads it (checked again before anything). */
type GivenSet = {
  funcion?: unknown;
  conjunto?: {
    changes?: ChangeSet;
    read?: Record<string, { collection: string; version: number }>;
  };
};
const setOf = (v: Val | undefined): GivenSet | null => {
  const x = v ? plain(v) : null;
  return x && typeof x === "object" && !Array.isArray(x) ? (x as GivenSet) : null;
};

/** An active extension's function, by «extension/función» (what the step names, literally). */
export function activeFunction(
  store: UserStore,
  id: string,
): { manifest: ExtensionManifest; fn: FunctionSpec } | null {
  const [ext, name] = id.split("/");
  const i = installed(store).find((x) => x.manifest.id === ext && x.enabled);
  const fn = i?.manifest.functions?.find((f) => f.name === name);
  return i && fn ? { manifest: i.manifest, fn } : null;
}

/** Every active extension's functions, as a step names them, with their code and their tests' names (the editor's
 * catalogue: its panel shows both, to read). */
export function activeFunctions(
  store: UserStore,
): { id: string; name: string; code: string; tests: string[] }[] {
  return installed(store)
    .filter((i) => i.enabled)
    .flatMap((i) =>
      (i.manifest.functions ?? []).map((f) => ({
        id: `${i.manifest.id}/${f.name}`,
        name: `${i.manifest.name} · ${f.name}`,
        code: f.code,
        tests: (i.manifest.tests ?? []).filter((x) => x.function === f.name).map((x) => x.name),
      })),
    );
}

/** The two steps, added to a registry (the server's; the MCP's that describes what a flow may be made of). */
export function withFunctionSteps(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "function.run",
    effect: "read",
    functions: true,
    title: "Función",
    describe:
      "runs an active extension's function in the box on what it declared it reads and on `datos`; gives back what it would make, change and ask (it never writes: «Aplicar cambios» does)",
    args: {
      funcion: {
        role: "option",
        required: true,
        describe: "the function, as «extension/name» (an active extension's)",
      },
      datos: { role: "content", describe: "what the step gives the function (its `data`)" },
    },
    async run(c, a) {
      const h = hostOf(c.functions);
      const store = h.store();
      const id = text(a.funcion);
      const found = activeFunction(store, id);
      if (!found) throw new ToolError("no-such-function");
      const r = await callFunction(store, found.manifest, found.fn.name, {
        ...(a.datos ? { data: { value: plain(a.datos), label: deepLabel(a.datos) } } : {}),
        ...(h.run ? { run: h.run } : {}),
      });
      if (!r.ok) throw new ToolError(`function-${r.error}`);
      const d = dryRun(store, r.changeSet, r.read);
      const made = r.label;
      const whole = { changes: r.changeSet, read: Object.fromEntries(r.read) };
      return rec(
        {
          funcion: leaf(id, CODE),
          resumen: leaf(r.changeSet.summary ?? "", made),
          nuevas: leaf(
            Object.values(d.creates).reduce((n, x) => n + x, 0),
            CODE,
          ),
          cambiadas: leaf(d.updates, CODE),
          preguntas: leaf(d.asks.length, CODE),
          // The set whole, for «Aplicar cambios» (checked again there: what a plan passes is never trusted).
          conjunto: leaf(whole as unknown as Parameters<typeof leaf>[0], made),
        },
        made,
      );
    },
  });
  r.register({
    name: "function.apply",
    effect: "write",
    functions: true,
    title: "Aplicar cambios",
    describe:
      "applies what a «Función» step gave back (its result whole): only what the function declared, refused when anything it read has changed since",
    args: {
      cambios: { role: "content", required: true, describe: "a «Función» step's result, whole" },
    },
    // Each row it would make or change counts for P11 (by hand, many are confirmed first, as `decideApply` does).
    rows: (a) =>
      (setOf(a.cambios)?.conjunto?.changes?.changes ?? []).filter(
        (ch) => (ch as { op?: unknown }).op !== "ask",
      ).length,
    run(c, a, extra) {
      const h = hostOf(c.functions);
      const store = h.store();
      const given = a.cambios;
      const v = setOf(given);
      if (!given || !v) throw new ToolError("no-such-function");
      const found = typeof v.funcion === "string" ? activeFunction(store, v.funcion) : null;
      const cs = v.conjunto?.changes;
      if (!found || !cs || !Array.isArray(cs.changes)) throw new ToolError("no-such-function");
      const read = new Map(Object.entries(v.conjunto?.read ?? {}));
      // Only what the function declared, and nothing it read changed since (it is run again then).
      if (changeSetErrors(cs, found.fn, read).length) throw new ToolError("function-scope");
      if (dryRun(store, cs, read).stale.length) throw new ToolError("function-stale");
      const made = deepLabel(given);
      const types = Object.values(store.schema().types);
      const levels = store.aiAccess();
      let created = 0;
      let updated = 0;
      // All of it or nothing (one transaction): a value a collection refuses stops the whole set.
      store.batch(() => {
        for (const ch of cs.changes) {
          if (ch.op === "ask") continue;
          const key = ch.op === "create" ? ch.collection : (read.get(ch.id)?.collection ?? "");
          const def = types.find((t) => t.key === key && !t.system && !t.archived);
          if (!def) throw new ToolError("no-such-collection");
          // What no model may read never lands where a model could read it (A-09: nothing more open to the AI).
          if (made.noModel && levelRank(levels[def.id]) < levelRank("opaque"))
            throw new ToolError("function-more-open");
          // A row's title and its text by the names a function uses for them.
          const titleKey = def.fields.find((f) => f.id === def.titleField)?.key ?? "";
          const fields: Record<string, Val> = {};
          for (const [k, x] of Object.entries(ch.values)) {
            const name = k === "$title" ? titleKey : k === "$text" ? "body" : k;
            fields[name] = leaf(x as Parameters<typeof leaf>[0], made);
          }
          const values = rec(fields, made);
          if (ch.op === "create") {
            c.writer.create(key, values, extra);
            created++;
          } else {
            c.writer.update(ch.id, values, extra);
            updated++;
          }
        }
      });
      return rec({ nuevas: leaf(created, CODE), cambiadas: leaf(updated, CODE) }, CODE);
    },
  });
  return r;
}
