// Where an account's time goes (task 35; `cli.ts diagnose <name>`, run on the server by hand): how much there is of each thing, and how long the server's heavy reads take with it. Read only: it changes nothing and records no read.
import { RUN_LIMITS } from "@boni/agent";
import type { UserStore } from "@boni/store";
import { computeBlock, type DataBlock, templatePage } from "@boni/views";
import { accuracy } from "./accuracy.ts";
import { aloneRuns, measure } from "./autoAccept.ts";
import { calendarDefs, StoreCalendar } from "./calendarStore.ts";
import { MAIL_EXTENSION } from "./extensions.ts";
import { proposalsByRun, runInfo } from "./runInfo.ts";
import { SYS_ACTIVITY, SYS_CALLS, SYS_RUNS, systemCollections } from "./systemCollections.ts";

const DAY = 24 * 60 * 60 * 1000;

/** «12 ms», measured once (the first call of a process is the cold one the server pays after a change). */
function time<T>(f: () => T): [T, string] {
  const t0 = performance.now();
  const out = f();
  return [out, `${Math.round(performance.now() - t0)} ms`];
}

const counted = (items: readonly string[]): string =>
  [...items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>()).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ") || "ninguna";

/** One line per thing measured, in Spanish (Juan reads them in his terminal and pastes them). */
export async function diagnose(
  store: UserStore,
  o: { now: number; tz: string; usdToEur: number },
): Promise<string[]> {
  const out: string[] = [];
  const schema = store.schema().types;
  // ---- how much there is
  const storage = store.audit.storage();
  const biggest = [...storage.types]
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 8)
    .map((t) => `${schema[t.type]?.name ?? t.type} ${t.rows}`);
  const rows = storage.types.reduce((n, t) => n + t.rows, 0);
  out.push(
    `datos: ${rows} registros, ${Math.round(storage.total / 1e6)} MB; las colecciones con más: ${biggest.join(", ")}`,
  );
  const runs = store.journal.runsIn(0, o.now + 1);
  const day = runs.filter((r) => r.started >= o.now - DAY);
  const firstReader = (r: (typeof runs)[number]) => {
    const steps = (r.plan as { steps?: { reader?: string; op?: string }[] } | null)?.steps ?? [];
    return steps.find((s) => s.op === "read")?.reader ?? (r.origin === "turn" ? "turno" : "otra");
  };
  out.push(`ejecuciones: ${runs.length} en total; en las últimas 24 h ${day.length}`);
  out.push(`  24 h por origen: ${counted(day.map((r) => r.origin))}`);
  out.push(`  24 h por estado: ${counted(day.map((r) => r.status))}`);
  out.push(
    `  24 h en segundo plano, por lector: ${counted(day.filter((r) => r.origin === "background").map(firstReader))}`,
  );
  const calls = store.journal.modelCallsIn(o.now - DAY, o.now + 1);
  const cost = calls.reduce((s, c) => s + (c.cost ?? 0), 0);
  out.push(
    `llamadas a modelos en 24 h: ${calls.length} (${counted(calls.map((c) => c.role))}); ${(cost * o.usdToEur).toFixed(2)} €`,
  );
  out.push(
    `auditoría: ${storage.audit.actions} acciones, ${storage.audit.access} accesos; llamadas guardadas ${storage.modelCalls.rows}`,
  );
  out.push(`propuestas: ${counted(store.journal.proposals().map((p) => p.status))}`);
  // What work without a turn may spend per day (P13): when spent, new mail is not read until tomorrow.
  const civil = new Intl.DateTimeFormat("en-CA", {
    timeZone: o.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(o.now);
  out.push(
    `lecturas en segundo plano hoy (${civil}): todas ${store.journal.spent(civil, "reader")} de ${RUN_LIMITS.readersPerDay}; correo ${store.journal.spent(civil, `reader:ext:${MAIL_EXTENSION.id}`)} de ${MAIL_EXTENSION.needs.budget?.readersPerDay ?? "—"}`,
  );
  // ---- how long the heavy reads take
  const [cals, cold] = time(() => calendarDefs(store));
  const [, warm] = time(() => calendarDefs(store));
  out.push(`calendarios: ${cals.length}; leerlos ${cold} (la primera vez), ${warm} (de memoria)`);
  const cal = new StoreCalendar(store, { write: false, pollMs: 3_600_000 });
  try {
    const [snap, snapMs] = time(() => cal.snapshot());
    const s = await snap;
    const [json, jsonMs] = time(() => JSON.stringify(s));
    out.push(
      `calendario: ${s.rows.length} filas; la instantánea ${snapMs}, ${Math.round(json.length / 1024)} KB en ${jsonMs}`,
    );
  } finally {
    cal.close();
  }
  const [sys, sysMs] = time(() =>
    systemCollections(store, { now: o.now, usdToEur: o.usdToEur, tz: o.tz }),
  );
  const part = (id: string) => {
    const [r, ms] = time(() => sys.rows(id));
    return `${r.length} filas en ${ms}`;
  };
  out.push(
    `registros de Boni: ${sysMs}; actividad ${part(SYS_ACTIVITY)}; llamadas ${part(SYS_CALLS)}; ejecuciones ${part(SYS_RUNS)}`,
  );
  const types = { ...schema, ...sys.types };
  const rowsOf = (t: string) => (sys.types[t] ? sys.rows(t) : store.entities(t, { deep: true }));
  const today = new Date(o.now).toISOString().slice(0, 10);
  for (const name of ["actividad", "uso-ia"] as const) {
    const blocks = templatePage(name).spec.blocks.filter(
      (b): b is DataBlock => "collection" in b && typeof b.collection === "string",
    );
    const [, ms] = time(() => {
      for (const b of blocks) computeBlock(b, types, rowsOf, { today });
    });
    out.push(`página «${templatePage(name).title}»: ${blocks.length} bloques en ${ms}`);
  }
  const [, regMs] = time(() => {
    const proposals = proposalsByRun(store);
    measure(store);
    const alone = aloneRuns(store);
    for (const r of store.journal.runs(50)) runInfo(store, r, { proposals, alone });
  });
  out.push(`Registro (las 50 últimas ejecuciones): ${regMs}`);
  const [, decMs] = time(() => {
    accuracy(store);
    measure(store);
  });
  out.push(`Decisiones: ${decMs}`);
  return out;
}
