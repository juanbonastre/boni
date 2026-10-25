import { createHash } from "node:crypto";
import type { Entity, FieldDef, FieldType, SelectOption, TypeDef } from "@boni/entities";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { SYS } from "@boni/views";

/**
 * Boni's own records as collections (Juan, 2026-10-25, design audit: everything shown comes from collections):
 * «Llamadas a modelos» (each call of the journal) and «Actividad de Boni» (per day, actor and collection, what was
 * read and what changed, from the audit). They are made here on each read, never stored: read only, outside the
 * store's schema, so the agent's view and the MCP never see them, and no write can reach them. Pages count them
 * with the same blocks as any collection (the template pages «Uso de la IA» and «Actividad»).
 *
 * Option ids are stable (a use's or a «Qué»'s by name, the rest by a hash of what they stand for), so a page's
 * filter on one keeps working as rows come and go. Days are UTC, as the audit groups them.
 */

// Ids, fields and the «Qué» options are packages/views SYS (the template pages name them).
export const SYS_CALLS = SYS.calls.id;
export const SYS_ACTIVITY = SYS.activity.id;
export const SYSTEM_COLLECTIONS = [SYS_CALLS, SYS_ACTIVITY] as const;
export const isSystemCollection = (id: string) =>
  (SYSTEM_COLLECTIONS as readonly string[]).includes(id);

/** «Qué» of an activity row: stable ids a page's filter names. */
export const READ = SYS.activity.read;
export const WROTE = SYS.activity.wrote;
/** «Uso» of a call, by the journal's role (an evaluation's role is `eval-<role>`). */
const USES: Record<string, string> = {
  planner: "Agente",
  reader: "Lector",
  decider: "Decisor",
  reviewer: "Revisor",
  eval: "Evaluación",
};
const useOf = (role: string) => (role.startsWith("eval-") ? "eval" : USES[role] ? role : "planner");

/** How far back the rows go: a year and a bit, enough for a block's longest period. */
export const SYSTEM_DAYS = 400;
const DAY = 86_400_000;

const L = label("own", "personal", []);
const hashId = (prefix: string, s: string) =>
  `o_${prefix}_${createHash("sha256").update(s).digest("hex").slice(0, 10)}`;
const field = (id: string, name: string, type: FieldType, options?: SelectOption[]): FieldDef => ({
  id,
  key: id.slice(2),
  name,
  type,
  ...(options ? { options } : {}),
  label: L,
});
const typeDef = (
  id: string,
  key: string,
  name: string,
  icon: string,
  fields: FieldDef[],
): TypeDef => ({
  id,
  key,
  name,
  icon,
  fields,
  titleField: "f_titulo",
  sensitivity: "personal",
  schemaVersion: 1,
  label: L,
});
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shortModel = (id: string) => id.split("/").pop() || id;

/** Who did something, in words, as the app's audit says it (apps/boni-web Dash.tsx `whoName`). */
export function whoName(by: string): string {
  if (by.startsWith("user:")) return `Tú · ${by.slice(5)}`;
  if (by.startsWith("mcp:")) return `MCP · ${by.slice(4)}`;
  if (by.startsWith("model:")) {
    const [, role = "", ...rest] = by.split(":");
    const name = USES[useOf(role)] ?? role;
    return rest.length ? `${name} · ${shortModel(rest.join(":"))}` : name;
  }
  if (by === "import") return "Importación";
  if (by.startsWith("connector")) return "Correo";
  if (by === "system") return "Sistema";
  return "Boni";
}

/** Options of a select from the values met, in order of their names; each keeps the id `idOf` gives it. */
function optionsFrom(
  values: Iterable<string>,
  idOf: (v: string) => string,
  nameOf: (v: string) => string,
) {
  const out = new Map<string, SelectOption>();
  for (const v of values) if (!out.has(v)) out.set(v, { id: idOf(v), name: nameOf(v), label: L });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export interface SystemCollections {
  types: Record<string, TypeDef>;
  rows: (type: string) => Entity[];
}

/**
 * Both collections for one account, over the last `SYSTEM_DAYS` days up to `now`. Their schema depends on the rows
 * (a select's options are the models, actors and collections met), so both are made together; `usdToEur` is the
 * account's rate («Modelos»), a call of unknown cost has no «Coste».
 */
export function systemCollections(
  store: UserStore,
  o: { now: number; usdToEur: number },
): SystemCollections {
  const from = o.now - SYSTEM_DAYS * DAY;
  const calls = store.journal.modelCallsIn(from, o.now + 1);
  const activity = store.audit.activityByType(from, o.now + 1);
  const schema = store.schema().types;

  const uses = optionsFrom(
    calls.map((c) => useOf(c.role)),
    (u) => `o_uso_${u}`,
    (u) => USES[u] ?? u,
  );
  const models = optionsFrom(
    calls.map((c) => c.model),
    (m) => hashId("m", m),
    shortModel,
  );
  const providers = optionsFrom(
    calls.map((c) => c.provider),
    (p) => hashId("p", p),
    (p) => p,
  );
  const who = optionsFrom(
    activity.map((a) => a.by),
    (b) => hashId("q", b),
    whoName,
  );
  const colName = (t: string) => schema[t]?.name ?? t;
  const cols = optionsFrom(
    activity.map((a) => a.type),
    (t) => hashId("c", t),
    colName,
  );
  const what: SelectOption[] = [
    { id: READ, name: "Leyó", label: L },
    { id: WROTE, name: "Cambió", label: L },
  ];

  const types: Record<string, TypeDef> = {
    [SYS_CALLS]: typeDef(SYS_CALLS, "llamadas", "Llamadas a modelos", "🤖", [
      field("f_titulo", "Llamada", "text"),
      field("f_fecha", "Fecha", "date"),
      field("f_uso", "Uso", "select", uses),
      field("f_modelo", "Modelo", "select", models),
      field("f_prov", "Proveedor", "select", providers),
      field("f_coste", "Coste", "money"),
      field("f_tokens", "Tokens", "number"),
    ]),
    [SYS_ACTIVITY]: typeDef(SYS_ACTIVITY, "actividad", "Actividad de Boni", "🧾", [
      field("f_titulo", "Acción", "text"),
      field("f_fecha", "Fecha", "date"),
      field("f_quien", "Quién", "select", who),
      field("f_que", "Qué", "select", what),
      field("f_col", "Colección", "select", cols),
      field("f_filas", "Filas", "number"),
    ]),
  };

  let callRows: Entity[] | null = null;
  let activityRows: Entity[] | null = null;
  const rows = (type: string): Entity[] => {
    if (type === SYS_CALLS) {
      callRows ??= calls.map((c) => {
        const use = useOf(c.role);
        const values: Entity["values"] = {
          f_titulo: `${USES[use] ?? use} · ${shortModel(c.model)}`,
          f_fecha: day(c.at),
          f_uso: `o_uso_${use}`,
          f_modelo: hashId("m", c.model),
          f_prov: hashId("p", c.provider),
          f_tokens: c.input + c.output,
        };
        if (c.cost !== null)
          values.f_coste = {
            amount: Math.round(c.cost * o.usdToEur * 1e6) / 1e6,
            currency: "EUR",
          };
        return { id: `sys_call_${c.n}`, type, values, created: c.at, updated: c.at, version: 1 };
      });
      return callRows;
    }
    if (type === SYS_ACTIVITY) {
      activityRows ??= activity.flatMap((a) => {
        const at = Date.parse(`${a.day}T12:00:00Z`);
        const one = (kind: string, verb: string, n: number): Entity => ({
          id: `sys_act_${createHash("sha256").update(`${a.day}|${a.by}|${a.type}|${kind}`).digest("hex").slice(0, 16)}`,
          type,
          values: {
            f_titulo: `${whoName(a.by)} · ${verb} ${colName(a.type)}`,
            f_fecha: a.day,
            f_quien: hashId("q", a.by),
            f_que: kind,
            f_col: hashId("c", a.type),
            f_filas: n,
          },
          created: at,
          updated: at,
          version: 1,
        });
        return [
          ...(a.reads ? [one(READ, "leyó", a.reads)] : []),
          ...(a.writes ? [one(WROTE, "cambió", a.writes)] : []),
        ];
      });
      return activityRows;
    }
    return [];
  };
  return { types, rows };
}
