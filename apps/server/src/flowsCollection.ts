/**
 * «Automatizaciones» as a collection (docs/sistema.md §4.4, F8; docs/automatizaciones.md AU-60, AU-61, AU-151): Boni
 * makes a row per automation of the new format and per flow of before, Boni's and the user's, and the section is that
 * collection's page, with the views, filters and
 * «Nuevo» of any other; its «Mapa» is the collection's diagram (`flowMap.ts`). Like «Mis datos», a change to a row
 * is done to what the row is, by the same functions as the flow's editor and with their rules: a name and an on or
 * off, a flow turned on only with an empty checklist, Boni's own flows turned off and never deleted. Made on each
 * read (a dozen rows), never stored, outside the store's schema: no model and no assistant sees it.
 */
import { createHash } from "node:crypto";
import { chatTrigger } from "@boni/agent";
import {
  type Entity,
  type FieldDef,
  type FieldType,
  label,
  type SelectOption,
  type TypeDef,
} from "@boni/entities";
import type { FlowRow, UserStore } from "@boni/store";
import { automationRowTarget, flowRowTarget, SYS } from "@boni/views";
import { DataError } from "./data.ts";
import { createFlow, type Problem, renamable, renameFlow } from "./flows.ts";
import { getPage } from "./pages.ts";
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
  // Boni's «Revisar la guía» (`flows.on.learning.mail`).
  if (on.learning === "mail") return "Cuando tus decisiones lo piden";
  // Boni's «Aviso del presupuesto» (`flows.on.spending.warn`).
  if (on.spending === "warn") return "El gasto llega al aviso";
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
const isBoni = (store: UserStore, id: string) => !renamable(store, id);

/**
 * What starts an automation of the new format, as «Se inicia» says it (AU-61): by its first trigger's type, kept at
 * save (the draft is never parsed to list it). F14b's one trigger says what a flow by hand says; «—» with none.
 */
const AUTOMATION_TRIGGERS: Readonly<Record<string, string>> = {
  manual: "Disparado por el usuario",
  // F14d (AU-114): «Programada» until it is published; then its hours (`schedule`).
  schedule: "Programada",
};
export const NO_TRIGGER = "—";
/**
 * `schedule`: the published version's «Programada» hours as the store keeps them (`scheduleColumn`, the flows' own
 * `Schedule` shape), said as a flow's are («Cada día a las 08:00 · Cada lunes a las 09:00»).
 */
export function automationTriggerWords(
  type: string | null,
  schedule: string | null = null,
): string {
  if (type === null) return NO_TRIGGER;
  if (type === "schedule" && schedule) {
    const words = hoursWords(schedule);
    if (words) return words;
  }
  return AUTOMATION_TRIGGERS[type] ?? type;
}
function hoursWords(schedule: string): string {
  try {
    const entries = JSON.parse(schedule) as { rules?: unknown[] }[];
    return entries
      .flatMap((e) => (Array.isArray(e?.rules) ? e.rules : []))
      .map((rule) => triggerWords({ schedule: rule }, () => null))
      .join(" · ");
  } catch {
    return "";
  }
}

function typeOf(triggers: SelectOption[], whose: SelectOption[]): TypeDef {
  return {
    id: SYS_FLOWS,
    key: "flujos",
    // AU-60: the section's name; its key and the ids of its fields stay until F16.
    name: "Automatizaciones",
    icon: "⚡",
    // AU-61: six columns.
    fields: [
      field(F.title, "Nombre", "text"),
      field(F.trigger, "Se inicia", "select", { options: triggers }),
      field(F.state, "Estado", "select", {
        options: [
          opt(F.on, "Encendida"),
          opt(F.off, "Apagada"),
          opt(F.unpublished, "Sin publicar"),
        ],
      }),
      field(F.last, "Última ejecución", "datetime"),
      field(F.runs, "Ejecuciones", "number"),
      field(F.by, "De", "select", {
        options: [opt(F.user, "Tú"), opt(F.boni, "Boni"), ...whose],
      }),
    ],
    titleField: F.title,
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  };
}

/**
 * The collection and its rows (AU-61, AU-151): the automations of the new format, the newest first, then the flows
 * of before, those on first and then by name. An automation is read from its row of the store (its name and its
 * trigger kept at save): no draft is parsed.
 */
export function flowsCollection(store: UserStore): { type: TypeDef; rows: Entity[] } {
  const types = Object.values(store.schema().types);
  const typeName = (key: string) => types.find((t) => t.key === key)?.name ?? null;
  const triggers = new Map<string, SelectOption>();
  const whose = new Map<string, SelectOption>();
  const triggerOption = (words: string) => {
    const tid = triggerId(words);
    if (!triggers.has(tid)) triggers.set(tid, opt(tid, words));
    return tid;
  };
  // «Ejecuciones» and «Última ejecución» (AU-61, AU-103): a table the store keeps as each run is kept, never a count.
  const counted = store.journal.automationRunCounts();
  const autos: Entity[] = store.journal.automations().map((a, i) => {
    const runs = counted.get(a.id);
    return {
      id: F.automation + a.id,
      type: SYS_FLOWS,
      values: {
        [F.title]: a.name,
        [F.trigger]: triggerOption(automationTriggerWords(a.trigger, a.schedule)),
        // AU-194: «Sin publicar» until its first version; then the switch says it.
        [F.state]: a.published === null ? F.unpublished : a.enabled ? F.on : F.off,
        [F.runs]: runs?.runs ?? 0,
        ...(runs?.last != null ? { [F.last]: new Date(runs.last).toISOString() } : {}),
        [F.by]: F.user,
      },
      created: i,
      updated: a.updated,
      version: a.rev,
    };
  });
  const flows = store.journal
    .flows()
    .slice()
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, "es"));
  const rows: Entity[] = flows.map((f, i) => {
    const runs = store.journal.flowRuns(f.id);
    return {
      id: F.row + f.id,
      type: SYS_FLOWS,
      values: {
        [F.title]: f.name,
        [F.trigger]: triggerOption(triggerWords(f.trigger, typeName)),
        [F.state]: f.enabled ? F.on : F.off,
        [F.by]: whoseFlow(store, f, whose),
        [F.runs]: runs.runs,
        ...(runs.last !== null ? { [F.last]: new Date(runs.last).toISOString() } : {}),
      },
      // The order they are listed in, kept by «created» (a view sorts them otherwise if asked).
      created: autos.length + i,
      updated: runs.last ?? f.created,
      version: f.version,
    };
  });
  return { type: typeOf([...triggers.values()], [...whose.values()]), rows: [...autos, ...rows] };
}

/** «De» of a flow of before (AU-61): a page's chat is that page's («Página «Gastos»»), else Boni's or the user's. */
function whoseFlow(store: UserStore, f: FlowRow, pages: Map<string, SelectOption>): string {
  const chat = chatTrigger(f.trigger);
  if (chat) {
    const id = F.page + chat.page;
    if (!pages.has(id))
      pages.set(id, opt(id, `Página «${getPage(store, chat.page)?.title || "—"}»`));
    return id;
  }
  return f.by === "preset" ? F.boni : F.user;
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
    count: (t) =>
      t === SYS_FLOWS
        ? store.journal.flows().length + store.journal.automations().length
        : base.count(t),
  };
}

/** «Eliminar» a row of an automation of the new format (AU-62), and its Undo: out of the list and back. */
export function deleteAutomationRow(store: UserStore, row: string, deleted: boolean): void {
  const id = automationRowTarget(row);
  if (!id || !store.journal.automation(id)) throw new DataError("not-found");
  store.journal.setAutomationDeleted(id, deleted);
}

/**
 * «Eliminadas» (AU-191): the deleted automations as rows of this same collection, the last saved first, each with its
 * name and the «Estado» it comes back with (deleting turned it off: «Apagada», or «Sin publicar» if it never was).
 * The collection's `GET …/rows?deleted=1` reads them; «Recuperar» is the automation's own `restore`. Made from the
 * store's rows, never a draft parsed: 200 of them are one query (A-15).
 */
export function deletedAutomationRows(store: UserStore): Entity[] {
  return store.journal.deletedAutomations().map((a, i) => ({
    id: F.automation + a.id,
    type: SYS_FLOWS,
    values: {
      [F.title]: a.name,
      [F.state]: a.published === null ? F.unpublished : F.off,
      [F.by]: F.user,
    },
    created: i,
    updated: a.updated,
    version: 0,
  }));
}

/** The flow a row of «Flujos» is, or not-found. */
function flowOf(store: UserStore, row: string): FlowRow {
  const id = flowRowTarget(row);
  const f = id ? store.journal.flow(id) : null;
  if (!f) throw new DataError("not-found");
  return f;
}

/**
 * A change to a row, done to its flow: its name (`renameFlow`, as its editor does: a new version of the user's with
 * the same steps, its draft kept; Boni's keep the name Boni gives them) or its state (on only with an empty
 * checklist: `problems` says the flow's). Anything else in a row is computed and says «read-only».
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
      if (!renamable(store, f.id)) throw new DataError("flow-boni-name");
      const r = renameFlow(store, f.id, v.trim().slice(0, 80), now);
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
