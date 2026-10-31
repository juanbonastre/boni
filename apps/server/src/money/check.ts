/**
 * The reconciliation's functions against today's code, on a copy of an account (docs/extensiones.md, E4: the equality
 * test before the functions replace `finanzas_*`). The import is made both ways, each undone after, and their
 * movements compared; then today's import stays and the close is made both ways too. Its lines are counts and field
 * names, nothing of the movements themselves (they can be pasted in a chat); `detail` adds the titles of what differs,
 * for Juan's eyes. The CLI runs it on a copy, never on the account (cli.ts conciliacion-check).
 */
import { type Label, label } from "@boni/entities";
import type { ChangeSet, FunctionInput } from "@boni/extensions";
import type { RunResponse } from "@boni/sandbox";
import type { UserStore } from "@boni/store";
import { applyChangeSet, callFunction, type Runner } from "../functions.ts";
import { codeHash, runInSandbox } from "../sandbox.ts";
import { storeNotes } from "./book.ts";
import { CONCILIACION } from "./conciliacion.ts";
import { cerrar_mes, importar, reportOf } from "./preset.ts";
import { type MoneyFiles, reconcileClose, reconcileImport, STATEMENTS } from "./service.ts";

type Movement = { title: string; fm: Record<string, unknown>; text: string | null };

/** The movements as the reconciliation reads them, with their texts: by bank reference, or by id without one. */
export function movementsOf(store: UserStore): Map<string, Movement> {
  const out = new Map<string, Movement>();
  for (const m of storeNotes(store)("t_movimiento")) {
    const ref = typeof m.fm.bank_ref === "string" && m.fm.bank_ref ? m.fm.bank_ref : m.id;
    let key = ref;
    for (let n = 2; out.has(key); n++) key = `${ref}#${n}`;
    out.set(key, { title: m.title, fm: m.fm, text: store.get(m.id)?.entity.body ?? null });
  }
  return out;
}

/** What differs between two sets of movements: how many, each field with how many times, and their titles. */
export function differences(a: Map<string, Movement>, b: Map<string, Movement>) {
  const fields = new Map<string, number>();
  const titles: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key);
    const y = b.get(key);
    const differ: string[] = [];
    if (!x || !y) differ.push(x ? "(solo con el código de hoy)" : "(solo con la función)");
    else {
      if (x.title !== y.title) differ.push("título");
      if (x.text !== y.text) differ.push("texto");
      for (const f of new Set([...Object.keys(x.fm), ...Object.keys(y.fm)]))
        if (JSON.stringify(x.fm[f] ?? null) !== JSON.stringify(y.fm[f] ?? null)) differ.push(f);
    }
    if (!differ.length) continue;
    for (const f of differ) fields.set(f, (fields.get(f) ?? 0) + 1);
    titles.push(`${(x ?? y)?.title ?? key}: ${differ.join(", ")}`);
  }
  return { count: titles.length, fields, titles };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const inNode: Runner = async (req) => {
  const f = req.fn === "importar" ? importar : cerrar_mes;
  const output = JSON.parse(JSON.stringify(f(req.input as FunctionInput, { day: req.day })));
  return { id: req.id, ok: true, output, steps: 0, ms: 0 };
};

/** Whether the box answers: the functions run there if it does, here otherwise. */
async function boxAnswers(): Promise<boolean> {
  const code = "function prueba() { return 1 }";
  const r = await runInSandbox({
    id: "conciliacion.comprobacion",
    code,
    hash: codeHash(code),
    fn: "prueba",
    input: null,
    day: "2026-01-01",
    seed: 1,
  }).catch(() => null);
  return !!r?.ok;
}

export async function checkConciliacion(
  store: UserStore,
  files: MoneyFiles,
  o: { today: string; month: string | null; detail?: boolean; box?: boolean },
): Promise<{ same: boolean; lines: string[] }> {
  const lines: string[] = [];
  let same = true;
  const meta = { actor: "user" as const, device: "cli" };
  const box = o.box ?? (await boxAnswers());
  if (o.box === undefined && !box)
    lines.push("La caja no contesta: las funciones se ejecutan aquí, en Node (el mismo código).");
  let last: RunResponse | null = null;
  const run: Runner = async (req) => {
    last = await (box ? runInSandbox(req) : inNode(req));
    return last;
  };
  const where = () => {
    const r = last as RunResponse | null;
    return !box ? "en Node" : r?.ok ? `en la caja: ${r.steps} pasos, ${r.ms} ms` : "en la caja";
  };
  const names = files
    .files(STATEMENTS, [".csv", ".xlsx", ".xls"])
    .filter((n) => !n.includes(".sync-conflict-"));
  const statements = names.map((name) => ({
    name,
    base64: Buffer.from(files.readBytes(`${STATEMENTS}/${name}`)).toString("base64"),
  }));
  const before = movementsOf(store);
  lines.unshift(`Extractos: ${statements.length} · movimientos: ${before.size}`);
  const fromFiles: Label = label("imported", "sensitive", [{ kind: "file", id: STATEMENTS }]);
  const fromJuan: Label = label("user", "personal", [{ kind: "user-edit", id: "cli" }]);

  /** One function both ways: today's code applied and undone, then the function's change set applied and undone. */
  const compare = async (
    what: string,
    today: (runId: string) => { report: string[]; tail: number; counts: string },
    fn: "importar" | "cerrar_mes",
    data: { value: unknown; label: Label },
  ) => {
    const t = today(`comprobacion-hoy-${fn}`);
    const want = movementsOf(store);
    store.undoRun(`comprobacion-hoy-${fn}`, meta);
    const r = await callFunction(store, CONCILIACION, fn, { run, day: o.today, data });
    if (!r.ok) {
      same = false;
      lines.push(`${what}: no se ha podido ejecutar — ${r.message}`);
      return;
    }
    const done = applyChangeSet(store, CONCILIACION, fn, r.changeSet, r.label, r.read, {
      device: "cli",
    });
    if (!done.ok) {
      same = false;
      lines.push(`${what}: Boni no ha aplicado sus cambios — ${done.message}`);
      return;
    }
    const got = movementsOf(store);
    store.undoRun(done.run, meta);
    const d = differences(want, got);
    const report = reportOf(t.report.slice(0, t.report.length - t.tail));
    const sameReport =
      JSON.stringify(report) === JSON.stringify((r.changeSet as ChangeSet).report ?? []);
    if (!d.count && sameReport) {
      lines.push(`${what} (${where()}): igual — ${t.counts}; el informe, igual`);
      return;
    }
    same = false;
    const byField = [...d.fields.entries()].map(([f, n]) => `${f} ×${n}`).join(", ");
    lines.push(
      `${what} (${where()}): DISTINTO — ${plural(d.count, "movimiento", "movimientos")}${byField ? ` (${byField})` : ""}; el informe, ${sameReport ? "igual" : "distinto"}`,
    );
    if (o.detail) for (const x of d.titles) lines.push(`  ${x}`);
  };

  await compare(
    "importar",
    (id) => {
      const t = reconcileImport(store, files, { apply: true, today: o.today, run: id });
      return {
        report: t.report,
        // Today's report ends saying what it wrote; the function's leaves it to Boni.
        tail: statements.length ? 1 : 0,
        counts: `${plural(t.created.length, "nuevo", "nuevos")}, ${plural(t.joined.length, "unido", "unidos")}, ${plural(t.unclear.length, "dudoso", "dudosos")}`,
      };
    },
    "importar",
    { value: { files: statements }, label: fromFiles },
  );
  // The close, as it is made: after the import (today's, on this copy).
  reconcileImport(store, files, { apply: true, today: o.today });
  await compare(
    `cerrar_mes ${o.month ?? "(todos los meses)"}`,
    (id) => {
      const t = reconcileClose(store, { month: o.month, apply: true, run: id });
      return {
        report: t.report,
        // Today's report ends with two lines on what it wrote.
        tail: 2,
        counts: `${t.ready.length} para conciliar, ${plural(t.blocked.length, "sigue pendiente", "siguen pendientes")}`,
      };
    },
    "cerrar_mes",
    { value: { month: o.month }, label: fromJuan },
  );
  return { same, lines };
}
