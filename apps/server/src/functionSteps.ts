/**
 * The steps «Función» and «Aplicar cambios» (task 93; Juan, 2026-11-06: «A: a la Bandeja»; docs/sistema.md §4.5): an
 * active extension's function run in the box as a step of a flow, and what it would change applied with the policy.
 *
 * «Función» never writes (A-09): it gives the function what it declared it reads and what the step passes it
 * (`datos`), runs it in the box and says what it would change (how many new and changed rows, its questions, its
 * summary), every value labelled with what it read (its integrity at most `model`). It keeps what it needs to be run
 * again the same way (its data, its day and seed) and the fingerprint of its set; never the set itself.
 *
 * «Aplicar cambios» is a write like any other. It trusts nothing a plan gives it: it runs the function again (A-09:
 * «se repite»), on what the store holds now, and makes that set only when it is the one proposed (the same
 * fingerprint and numbers), with what it read from the store; otherwise what it would change has changed since
 * («stale»: the proposal says so in the Bandeja). In the background the whole set waits there as one proposal;
 * accepted, it is made in that run, all of it or nothing, and Deshacer takes it back whole; by hand the policy decides,
 * counting each row (P11). What no model may read never lands where a model could read it.
 */
import { createHash } from "node:crypto";
import { deepLabel, leaf, plain, rec, ToolError, type ToolRegistry, type Val } from "@boni/agent";
import { join, label } from "@boni/entities";
import type { ChangeSet, ExtensionManifest, FunctionSpec } from "@boni/extensions";
import { levelRank, type UserStore } from "@boni/store";
import { installed } from "./extensions.ts";
import { callFunction, dryRun, type Runner } from "./functions.ts";

/** What the server gives these steps for one account (AgentHost): its store, and the box (a stand-in in tests). */
export interface FunctionsHost {
  store(): UserStore;
  run?: Runner;
}

const NOTHING = label("own", "public", [{ kind: "code", id: "functions" }]);

const hostOf = (f: unknown): FunctionsHost => {
  if (!f) throw new ToolError("no-functions");
  return f as FunctionsHost;
};
const text = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  return typeof x === "string" ? x : "";
};
const fieldOf = (v: Val | undefined, k: string): Val | undefined =>
  v?.t === "rec" ? v.fields[k] : undefined;

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

/** A value with its keys in order, as text: what the fingerprint is taken of. */
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
};
/** What a set would do, in numbers: rows it makes, rows it changes, and its questions. */
function countsOf(cs: ChangeSet) {
  let nuevas = 0;
  let cambiadas = 0;
  const preguntas: string[] = [];
  for (const c of cs.changes) {
    if (c.op === "create") nuevas++;
    else if (c.op === "update") cambiadas++;
    else preguntas.push(c.question);
  }
  return { nuevas, cambiadas, preguntas };
}
/** How to run it again the same way (its day and seed) and the fingerprint of what it gave: «día|semilla|huella». */
const fingerprint = (day: string, seed: number, cs: ChangeSet) =>
  `${day}|${seed}|${createHash("sha256").update(canonical(cs)).digest("hex")}`;

/** Runs a function in the box (on what the store holds now), the day and seed given or new. */
async function runIt(
  h: FunctionsHost,
  found: { manifest: ExtensionManifest; fn: FunctionSpec },
  datos: Val | undefined,
  again?: { day: string; seed: number },
) {
  const day = again?.day ?? new Date().toISOString().slice(0, 10);
  const seed = again?.seed ?? Math.floor(Math.random() * 2 ** 31);
  const r = await callFunction(h.store(), found.manifest, found.fn.name, {
    ...(datos ? { data: { value: plain(datos), label: deepLabel(datos) } } : {}),
    ...(h.run ? { run: h.run } : {}),
    day,
    seed,
  });
  if (!r.ok) throw new ToolError(`function-${r.error}`);
  return { ...r, day, seed };
}

/** The two steps, added to a registry (the server's; the MCP's that describes what a flow may be made of). */
export function withFunctionSteps(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "function.run",
    effect: "read",
    area: "extensions",
    functions: true,
    title: "Función",
    describe:
      "runs an active extension's function in the box on what it declared it reads and on `datos`; says what it would make, change and ask (it never writes: «Aplicar cambios» does)",
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
      const id = text(a.funcion);
      const found = activeFunction(h.store(), id);
      if (!found) throw new ToolError("no-such-function");
      const got = await runIt(h, found, a.datos);
      // Everything it says is made of what it read: a count can carry what no model may see, as a summary can.
      const made = got.label;
      const n = countsOf(got.changeSet);
      return rec(
        {
          funcion: leaf(id, made),
          nombre: leaf(`${found.manifest.name} · ${found.fn.name}`, made),
          resumen: leaf(got.changeSet.summary ?? null, made),
          nuevas: leaf(n.nuevas, made),
          cambiadas: leaf(n.cambiadas, made),
          // Its questions as one text, to read on the card (they are asked, never applied).
          preguntas: leaf(n.preguntas.length ? n.preguntas.join(" · ") : null, made),
          // To run it again the same way when it is applied, and to know it gives the same set.
          datos: a.datos ?? leaf(null, NOTHING),
          huella: leaf(fingerprint(got.day, got.seed, got.changeSet), made),
        },
        made,
      );
    },
  });
  r.register({
    name: "function.apply",
    effect: "write",
    area: "extensions",
    functions: true,
    title: "Aplicar cambios",
    describe:
      "applies what a «Función» step said it would change (its result whole): the function is run again, and its set is made only when it is still the same",
    args: {
      cambios: { role: "content", required: true, describe: "a «Función» step's result, whole" },
    },
    // Kept only to run it again: the card says what it does, by the function's name, numbers and summary.
    hide: ["cambios.funcion", "cambios.datos", "cambios.huella"],
    // Each row it makes or changes counts for P11 (by hand, many are confirmed first, as `decideApply` does).
    rows: (a) => {
      const num = (k: string) => {
        const x = plain(fieldOf(a.cambios, k) ?? leaf(0, NOTHING));
        return typeof x === "number" && x > 0 ? Math.floor(x) : 0;
      };
      return num("nuevas") + num("cambiadas");
    },
    async run(c, a, extra) {
      const h = hostOf(c.functions);
      const store = h.store();
      const given = a.cambios;
      const id = text(fieldOf(given, "funcion"));
      const [day, seed, sha] = text(fieldOf(given, "huella")).split("|");
      if (!given || !day || !sha || !Number.isInteger(Number(seed)))
        throw new ToolError("no-such-function");
      // Turned off since it was proposed: what it would change no longer stands.
      const found = activeFunction(store, id);
      if (!found) throw new ToolError("stale");
      // Run again the same way, on what the store holds now: only a set that is still the one proposed is made.
      const got = await runIt(h, found, fieldOf(given, "datos"), { day, seed: Number(seed) });
      const cs = got.changeSet;
      const n = countsOf(cs);
      // What Juan read (the card, the confirmation) is what runs: the function by its name, its summary, its numbers
      // and its questions, all the re-run's; anything else a plan put there is never made.
      const said = (k: string) => plain(fieldOf(given, k) ?? leaf(null, NOTHING));
      if (
        fingerprint(day, Number(seed), cs) !== `${day}|${seed}|${sha}` ||
        said("nombre") !== `${found.manifest.name} · ${found.fn.name}` ||
        said("resumen") !== (cs.summary ?? null) ||
        said("nuevas") !== n.nuevas ||
        said("cambiadas") !== n.cambiadas ||
        said("preguntas") !== (n.preguntas.length ? n.preguntas.join(" · ") : null)
      )
        throw new ToolError("stale");
      const made = join(got.label, deepLabel(given));
      const levels = store.aiAccess();
      const types = Object.values(store.schema().types);
      // All of it or nothing (one transaction): a value a collection refuses stops the whole set.
      store.batch(() => {
        // Nothing it read has changed while it ran (the box answers in its own time).
        if (dryRun(store, cs, got.read).stale.length) throw new ToolError("stale");
        for (const ch of cs.changes) {
          if (ch.op === "ask") continue;
          // A row it changes is one it read: its collection is the store's, never what a plan says.
          const key = ch.op === "create" ? ch.collection : (got.read.get(ch.id)?.collection ?? "");
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
          if (ch.op === "create") c.writer.create(key, values, extra);
          else c.writer.update(ch.id, values, extra);
        }
      });
      return rec({ nuevas: leaf(n.nuevas, made), cambiadas: leaf(n.cambiadas, made) }, made);
    },
  });
  return r;
}
