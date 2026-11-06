/**
 * «Flujos» as a collection (docs/sistema.md §4.4, F8; Juan's «Las recomendadas», decision 3): Boni makes a row per
 * flow of the account, Boni's and the user's, and the section is that collection's page, with the views, filters and
 * «Nuevo» of any other; its «Mapa» is the collection's diagram (`flowMap.ts`). Like «Mis datos», a change to a row
 * is done to what the row is, by the same functions as the flow's editor and with their rules: a name and an on or
 * off, a flow turned on only with an empty checklist, Boni's own flows turned off and never deleted. Made on each
 * read (a dozen rows), never stored, outside the store's schema: no model and no assistant sees it.
 */
import { createHash } from "node:crypto";
import {
  type Entity,
  type FieldDef,
  type FieldType,
  label,
  type SelectOption,
  type TypeDef,
} from "@boni/entities";
import type { FlowRow, UserStore } from "@boni/store";
import { flowRowTarget, SYS } from "@boni/views";
import { DataError } from "./data.ts";
import { createFlow, type Problem, saveUserFlow, stepsOf } from "./flows.ts";
import type { SystemCollections } from "./systemCollections.ts";

const F = SYS.flows;
export const SYS_FLOWS = F.id;
const L = label("own", "personal", []);
const opt = (id: string, name: string): SelectOption => ({ id, name, label: L });
const field = (id: string, name: string, type: FieldType, more: Partial<FieldDef> = {}) =>
  ({ id, key: id.slice(2), name, type, label: L, ...more }) as FieldDef;
const NEW_NAME = "Nuevo flujo";
const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** What starts a flow, as its «Disparador» says it: the collection a record arrives at, its schedule, or by hand. */
export function triggerWords(trigger: unknown, typeName: (key: string) => string | null): string {
  const on = (trigger ?? {}) as Record<string, unknown>;
  if (typeof on.created === "string") return `Llega a ${typeName(on.created) ?? on.created}`;
  // Boni's «Traer correo» (as the editor says it, `flows.on.connector.mail`).
  if (on.connector === "mail") return "Llega correo al buzón";
  if (on.schedule && typeof on.schedule === "object") {
    const s = on.schedule as { every?: unknown; at?: unknown; day?: unknown };
    const at = typeof s.at === "string" ? s.at : "08:00";
    // As the app's editor says them (i18n `flows.on.*`).
    if (s.every === "hour")
      return at.slice(3) === "00" ? "Cada hora" : `Cada hora a y ${at.slice(3)}`;
    if (s.every === "week") return `Cada ${DAYS[Number(s.day ?? 1)] ?? "lunes"} a las ${at}`;
    return `Cada día a las ${at}`;
  }
  // As the editor says it (I-24; Juan, 2026-11-05: instead of «A mano»).
  return "Disparado por el usuario";
}

/** An option's id for what starts a flow: the same for the same words on every read, so a filter keeps working. */
const triggerId = (words: string) =>
  `o_disp_${createHash("sha256").update(words).digest("hex").slice(0, 10)}`;

/** Boni's own flows: one Boni saved a version of (the user's may run instead; Boni's stays to go back to). */
const isBoni = (store: UserStore, id: string) =>
  store.journal.flowVersions(id).some((v) => v.by === "preset");

function typeOf(triggers: SelectOption[]): TypeDef {
  return {
    id: SYS_FLOWS,
    key: "flujos",
    name: "Flujos",
    icon: "⚡",
    fields: [
      field(F.title, "Nombre", "text"),
      field(F.trigger, "Disparador", "select", { options: triggers }),
      field(F.state, "Estado", "select", {
        options: [opt(F.on, "Encendido"), opt(F.off, "Apagado")],
      }),
      field(F.by, "Versión de", "select", { options: [opt(F.boni, "Boni"), opt(F.user, "Ti")] }),
      field(F.steps, "Pasos", "number"),
      field(F.runs, "Ejecuciones", "number"),
      field(F.last, "Última", "datetime"),
      field(F.version, "Versión", "number"),
    ],
    titleField: F.title,
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  };
}

/** The collection and its rows: the flows on first, then by name. */
export function flowsCollection(store: UserStore): { type: TypeDef; rows: Entity[] } {
  const types = Object.values(store.schema().types);
  const typeName = (key: string) => types.find((t) => t.key === key)?.name ?? null;
  const triggers = new Map<string, SelectOption>();
  const flows = store.journal
    .flows()
    .slice()
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, "es"));
  const rows: Entity[] = flows.map((f, i) => {
    const words = triggerWords(f.trigger, typeName);
    const tid = triggerId(words);
    if (!triggers.has(tid)) triggers.set(tid, opt(tid, words));
    const runs = store.journal.flowRuns(f.id);
    return {
      id: F.row + f.id,
      type: SYS_FLOWS,
      values: {
        [F.title]: f.name,
        [F.trigger]: tid,
        [F.state]: f.enabled ? F.on : F.off,
        [F.by]: f.by === "preset" ? F.boni : F.user,
        [F.steps]: stepsOf(f.plan).length,
        [F.runs]: runs.runs,
        ...(runs.last !== null ? { [F.last]: new Date(runs.last).toISOString() } : {}),
        [F.version]: f.version,
      },
      // The order they are listed in, kept by «created» (a view sorts them otherwise if asked).
      created: i,
      updated: runs.last ?? f.created,
      version: f.version,
    };
  });
  return { type: typeOf([...triggers.values()]), rows };
}

/** Boni's collections with «Flujos» among them: made only when asked for, then kept for the request. */
export function withFlows(store: UserStore, base: SystemCollections): SystemCollections {
  let made: { type: TypeDef; rows: Entity[] } | null = null;
  const mine = () => {
    made ??= flowsCollection(store);
    return made;
  };
  return {
    get types() {
      return { ...base.types, [SYS_FLOWS]: mine().type };
    },
    rows: (t) => (t === SYS_FLOWS ? mine().rows : base.rows(t)),
    count: (t) => (t === SYS_FLOWS ? store.journal.flows().length : base.count(t)),
  };
}

/** The flow a row of «Flujos» is, or not-found. */
function flowOf(store: UserStore, row: string): FlowRow {
  const id = flowRowTarget(row);
  const f = id ? store.journal.flow(id) : null;
  if (!f) throw new DataError("not-found");
  return f;
}

/**
 * A change to a row, done to its flow: its name (a new version of the user's with the same steps; Boni's keep the
 * name Boni gives them) or its state (on only with an empty checklist: `problems` says the flow's). Anything else
 * in a row is computed and says «read-only».
 */
export function updateFlowRow(
  store: UserStore,
  row: string,
  values: unknown,
  problems: (f: FlowRow) => readonly Problem[],
  now: number,
): void {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new DataError("bad-body");
  const f = flowOf(store, row);
  const changes = Object.entries(values as Record<string, unknown>);
  if (changes.some(([k]) => !(F.editable as readonly string[]).includes(k)))
    throw new DataError("read-only");
  for (const [k, v] of changes) {
    if (k === F.title) {
      if (typeof v !== "string" || !v.trim()) throw new DataError("bad-body");
      if (isBoni(store, f.id) && f.by === "preset") throw new DataError("flow-boni-name");
      const latest = store.journal.flow(f.id) as FlowRow;
      const r = saveUserFlow(
        store,
        f.id,
        { base: latest.version, name: v.trim().slice(0, 80), plan: latest.plan },
        [],
        now,
      );
      if ("error" in r) throw new DataError("bad-body");
    } else if (k === F.state) {
      if (v !== F.on && v !== F.off) throw new DataError("bad-body");
      if (v === F.on && problems(f).length) throw new DataError("flow-problems");
      store.journal.setFlowEnabled(f.id, v === F.on);
    }
  }
}

/** A row deleted: the user's flow to the trash; Boni's are turned off, never deleted. */
export function deleteFlowRow(store: UserStore, row: string): void {
  const f = flowOf(store, row);
  if (isBoni(store, f.id)) throw new DataError("flow-boni-delete");
  store.journal.setFlowDeleted(f.id, true);
}

/** The Undo of deleting a row: the flow back as it was. */
export function restoreFlowRow(store: UserStore, row: string): void {
  const id = flowRowTarget(row);
  if (!id) throw new DataError("not-found");
  store.journal.setFlowDeleted(id, false);
  if (!store.journal.flow(id)) throw new DataError("not-found");
}

/** «Nuevo»: a flow by hand, off, with the name given or «Nuevo flujo»; its row's id. */
export function createFlowRow(store: UserStore, values: unknown, now: number): string {
  const v = (values && typeof values === "object" ? values : {}) as Record<string, unknown>;
  const given = typeof v[F.title] === "string" ? (v[F.title] as string).trim().slice(0, 80) : "";
  const made = createFlow(store, { name: given || NEW_NAME }, now);
  if (!made) throw new DataError("bad-body");
  return F.row + made.id;
}
