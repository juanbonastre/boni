/**
 * What a step's connections say on the screen (docs/automatizaciones.md AU-40, AU-41, AU-44, AU-176, AU-178 to AU-181,
 * AU-189): the rows of its table with their cells, whether the code uses each and what it uses without permission;
 * the chip under the step; the sentence under the table; the card's mark; and «Haría esto» of a «Código». All of it
 * from the core's `permissions`, `connectionUses` and `stepChanges`, the same functions the engine and «Publicar» read:
 * nothing here decides what a step may do, only how it is said.
 */
import {
  AGENT_TYPE,
  type AgentLine,
  type AgentRecord,
  type AiRecord,
  type CodeContext,
  type Connection,
  connectionUses,
  readWrites,
  type Step,
  stepChanges,
  WRITE_ACTIONS,
  type WriteAction,
  type WriteMode,
} from "@boni/automations";
import type { T } from "../i18n.ts";
import type { CodeWould, StepTest } from "./client.ts";
import { isCode, sourceOf } from "./code.ts";
import { DO } from "./words.ts";

/** A cell of the table: «No», «Preguntar» or «Sí» (AU-41). Reading is always «Sí» in a «Código». */
export type WriteCell = false | WriteMode;

/** One row of the table (AU-41): a collection, its read limits said short, and its three write cells with their use. */
export interface ConnectionRow {
  collection: string;
  name: string;
  /** What limits its reading (AU-43), said short: «con filtro», «3 campos», «hasta 100 filas». Empty: none. */
  limits: string[];
  /** «Leer»: always in a «Código»; an «Agente»'s may be «No» (AU-41). */
  reads: boolean;
  cells: {
    action: WriteAction;
    cell: WriteCell;
    /** The action's own limits said short (AU-48, AU-196): «con filtro», «2 campos», «hasta 20». */
    limits: string[];
    /** The code asks for it (AU-179): «lo usa»; or does not: «sin usar». Undefined for «No» not used. */
    used: boolean;
    /** Used and not allowed: the problem of AU-176, painted red with the fix. */
    missing: boolean;
  }[];
}

/** The rows of a «Código»'s table, in the order of its connections. */
export function connectionRows(
  t: T,
  step: Step,
  context: Pick<CodeContext, "collectionNamed" | "collectionName">,
  locale: string,
): ConnectionRow[] {
  const connections = step.connections ?? [];
  const uses = isCode(step)
    ? connectionUses(connections, readWrites(sourceOf(step), "code"), context.collectionNamed)
    : [];
  return connections.map((c) => ({
    collection: c.collection,
    name: context.collectionName?.(c.collection) ?? c.collection,
    limits: limitsOf(t, c, locale),
    reads: c.read !== false,
    cells: WRITE_ACTIONS.map((action) => {
      const cell: WriteCell = c[action] === false ? false : (c[action] as { mode: WriteMode }).mode;
      const use = uses.find((u) => u.collection === c.collection && u.action === action);
      const used = use?.used ?? false;
      return {
        action,
        cell,
        limits: writeLimitsOf(t, c, action, locale),
        used,
        missing: used && cell === false,
      };
    }),
  }));
}

/** A connection's read limits said short (AU-41: «Sí · con filtro»). */
export function limitsOf(t: T, c: Connection, locale: string): string[] {
  if (c.read === false) return [];
  const out: string[] = [];
  if (c.read.where && c.read.where.length > 0) out.push(t("auto.conn.filtered"));
  if (c.read.fields)
    out.push(
      t(c.read.fields.length === 1 ? "auto.conn.someFields.one" : "auto.conn.someFields", {
        n: c.read.fields.length,
      }),
    );
  if (c.read.limit !== undefined)
    out.push(t("auto.conn.upTo", { n: c.read.limit.toLocaleString(locale) }));
  return out;
}

/**
 * A write action's own limits said short, as its cell says them (AU-48, AU-196): «con filtro» (`where`), «2 campos»
 * (`fields`), «hasta 20» («Como mucho»). Empty for «No» or no limits.
 */
export function writeLimitsOf(t: T, c: Connection, action: WriteAction, locale: string): string[] {
  const cell = c[action];
  if (cell === false) return [];
  const out: string[] = [];
  if ("where" in cell && cell.where && cell.where.length > 0) out.push(t("auto.conn.filtered"));
  if ("fields" in cell && cell.fields)
    out.push(
      t(cell.fields.length === 1 ? "auto.conn.someFields.one" : "auto.conn.someFields", {
        n: cell.fields.length,
      }),
    );
  if (cell.limit !== undefined)
    out.push(t("auto.conn.atMost", { n: cell.limit.toLocaleString(locale) }));
  return out;
}

/** «a», «a y b», «a, b y c»; with `nor`, «a ni b», «a, b ni c». */
export function listed(t: T, items: readonly string[], nor = false): string {
  if (items.length <= 1) return items[0] ?? "";
  const last = items[items.length - 1] as string;
  return `${items.slice(0, -1).join(", ")} ${t(nor ? "auto.list.nor" : "auto.list.and")} ${last}`;
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/**
 * An action as a verb inside a sentence («leer», «modificar»). Removing is said by the editor's own word for it,
 * lowered, so that «Eliminar» has one key (AU-85).
 */
export function actionWord(t: T, a: WriteAction | "read"): string {
  return a === "remove" ? t(DO.remove).toLocaleLowerCase() : t(`auto.conn.to.${a}`);
}

/** An action as the head of its column in the table: «Eliminar» is the editor's own word (AU-85). */
export function columnWord(t: T, a: WriteAction | "read" | "collection"): string {
  return a === "remove" ? t(DO.remove) : t(`auto.conn.col.${a}`);
}

/**
 * The chip of a connection under its step (AU-40, AU-178, AU-189): «Solo lee», «Lee · con filtro», «Lee y modifica
 * · pregunta antes», «Lee y elimina · sin preguntar». A removal with «Sí» is said apart from what asks. An «Agente»'s
 * that writes says so too (AU-200): «Lee y crea · pregunta antes · decide la IA».
 */
export function chipWords(t: T, c: Connection, locale: string, type?: string): string {
  const writes = WRITE_ACTIONS.filter((a) => c[a] !== false);
  const limits = limitsOf(t, c, locale);
  const reads = c.read !== false;
  if (reads && writes.length === 0 && limits.length === 0) return t("auto.conn.onlyReads");
  if (!reads && writes.length === 0) return t("auto.conn.mode.no");
  const verbs = [
    ...(reads ? [t("auto.conn.does.read")] : []),
    ...writes.map((a) => t(`auto.conn.does.${a}`)),
  ];
  const parts = [cap(listed(t, verbs)), ...limits];
  const modeOf = (a: WriteAction) => (c[a] as { mode: WriteMode }).mode;
  const asks = writes.filter((a) => modeOf(a) === "ask");
  if (asks.length === writes.length && asks.length > 0) parts.push(t("auto.conn.asks"));
  else if (asks.length > 0)
    parts.push(
      t("auto.conn.asksTo", {
        actions: listed(
          t,
          asks.map((a) => actionWord(t, a)),
        ),
      }),
    );
  if (writes.includes("remove") && modeOf("remove") === "yes")
    parts.push(t(writes.length === 1 ? "auto.conn.noAsk" : "auto.conn.removesNoAsk"));
  if (type === AGENT_TYPE && writes.length > 0) parts.push(t("auto.conn.byAgent"));
  return parts.join(" · ");
}

/**
 * The sentence under the table (AU-44, AU-178): «Puede leer Categorías, y leer y modificar Gastos (con filtro). No
 * puede crear ni eliminar nada.» Connections that may do the same are said together. Empty with no connections. An
 * «Agente»'s says each write's «Como mucho» and who chooses (AU-200): «Puede leer Gastos, y leer y crear Notas (como
 * mucho 20), lo que decida la IA. No puede modificar ni eliminar nada.»
 */
export function connectionsSentence(
  t: T,
  connections: readonly Connection[],
  nameOf: (key: string) => string,
  type?: string,
  locale = "es",
): string {
  if (connections.length === 0) return "";
  const agent = type === AGENT_TYPE;
  const groups: { actions: string; names: string[] }[] = [];
  for (const c of connections) {
    const writes = WRITE_ACTIONS.filter((a) => c[a] !== false);
    const verbs = [
      ...(c.read !== false ? [actionWord(t, "read")] : []),
      ...writes.map((a) => actionWord(t, a)),
    ];
    if (verbs.length === 0) continue;
    const actions = listed(t, verbs);
    const limited =
      c.read !== false &&
      ((c.read.where?.length ?? 0) > 0 ||
        c.read.fields !== undefined ||
        c.read.limit !== undefined);
    const most = agent
      ? [
          ...new Set(
            writes.flatMap((a) => {
              const n = (c[a] as { limit?: number }).limit;
              return n === undefined ? [] : [n];
            }),
          ),
        ].sort((x, y) => x - y)
      : [];
    const name =
      nameOf(c.collection) +
      (limited ? ` (${t("auto.conn.filtered")})` : "") +
      (most.length > 0
        ? ` (${t("auto.conn.mostN", {
            n: listed(
              t,
              most.map((n) => n.toLocaleString(locale)),
            ),
          })})`
        : "");
    const group = groups.find((g) => g.actions === actions);
    if (group) group.names.push(name);
    else groups.push({ actions, names: [name] });
  }
  const can = groups.map((g) => `${g.actions} ${listed(t, g.names)}`);
  const last = can.length > 1 ? `, ${t("auto.list.and")} ${can[can.length - 1]}` : "";
  if (can.length === 0) return "";
  const writesAny = connections.some((c) => WRITE_ACTIONS.some((a) => c[a] !== false));
  const first = t(agent && writesAny ? "auto.conn.canAgent" : "auto.conn.can", {
    what: `${can.slice(0, can.length > 1 ? -1 : 1).join(", ")}${last}`,
  });
  const never = WRITE_ACTIONS.filter((a) => connections.every((c) => c[a] === false));
  if (never.length === 0) return first;
  return `${first} ${t("auto.conn.cannot", {
    what: listed(
      t,
      never.map((a) => actionWord(t, a)),
      true,
    ),
  })}`;
}

/**
 * The card's mark (AU-180, AU-189): what the step can change, from `stepChanges`, the one place «Publicar» and the
 * map read too: «Modifica Gastos», «Crea y modifica Gastos», «Elimina en Gastos · sin preguntar», «Cambia Gastos y
 * Notas». Empty for a step that only reads or calculates.
 */
export function changeMark(
  t: T,
  step: Step,
  context: Pick<CodeContext, "collectionNamed">,
  nameOf: (key: string) => string,
): string {
  const changes = stepChanges(step, context);
  if (changes.length === 0) return "";
  const noAsk = changes.some((c) =>
    c.actions.some((a) => a.action === "remove" && a.mode === "yes"),
  );
  let mark: string;
  if (changes.length > 1)
    mark = t("auto.mark.changes", {
      names: listed(
        t,
        changes.map((c) => nameOf(c.collection)),
      ),
    });
  else {
    const [one] = changes as [(typeof changes)[number]];
    const actions = one.actions.map((a) => a.action);
    const verbs = cap(
      listed(
        t,
        actions.map((a) => t(`auto.conn.does.${a}`)),
      ),
    );
    mark = t(actions.includes("remove") ? "auto.mark.in" : "auto.mark.of", {
      verbs,
      name: nameOf(one.collection),
    });
  }
  return noAsk ? `${mark} · ${t("auto.conn.noAsk")}` : mark;
}

/**
 * «Haría esto» of a «Código» (AU-181, AU-189): one line per collection and action, «Modificaría 12 filas en Gastos»,
 * with «sin preguntar» for a removal a run would not ask, in the order asked.
 */
export function wouldLines(
  t: T,
  would: CodeWould,
  locale: string,
  nameOf: (key: string) => string,
): string[] {
  return would.counts.map((c) => {
    const line = t(`auto.would.code.${c.action}${c.n === 1 ? ".one" : ""}`, {
      n: c.n.toLocaleString(locale),
      name: nameOf(c.collection),
    });
    return c.action === "remove" && !would.asks ? `${line} · ${t("auto.conn.noAsk")}` : line;
  });
}

/**
 * The collections «Conectar» of an «Agente» offers (AU-166): never one no model may read, which is any level but
 * «visible», nor Boni's own records, nor one already connected; one with no key cannot be cited and is left out. The
 * server refuses the publish of one connected all the same (`connection.notAllowed`, `why: "private"`).
 */
export function agentConnectable(
  collections: readonly { key?: string; name: string; level: string; system?: boolean }[],
  connected: ReadonlySet<string>,
): { key: string; name: string }[] {
  return collections.flatMap((c) =>
    c.key && c.level === "visible" && !c.system && !connected.has(c.key)
      ? [{ key: c.key, name: c.name }]
      : [],
  );
}

/** «Lo que hizo» of an «Agente» (AU-54): a head with its cost, and each unit of work with its lines. */
export interface AgentDid {
  /** «2 rondas · 3 llamadas al modelo · el modelo · 3,6 s». */
  head: string;
  units: { title: string | null; lines: string[] }[];
  /** Units past `DID_UNITS`, with «Una vez por fila» over many rows: «y 4.980 filas más». */
  more: number;
}

/** The units «Lo que hizo» paints (A-15): a test over 5.000 rows one by one has 5.000, and the rest are counted. */
export const DID_UNITS = 20;

const READ_OPS: readonly string[] = ["find", "get", "count", "sum"];
/** The keys of a refusal (AU-198) the screen has words for; any other is «no se pudo». */
const DID_WHY: readonly string[] = [
  "read-off",
  "not-connected",
  "action-off",
  "outside-rows",
  "outside-fields",
  "over-limit",
  "bad-option",
  "not-read",
  "bad-query",
  "bad-request",
  "too-many",
  "code-failed",
];

/** A count's key: `.one` for one (AU-54's lines say «1 fila»). */
const counted = (key: string, n: number) => (n === 1 ? `${key}.one` : key);

/**
 * «Lo que hizo» of an «Agente»'s test or run (AU-54), every line from the engine's record (`StepRecord.agent`), never
 * from the model: the screen paints them as plain text (A-01). Writes in a row to one collection with one state are
 * said together («Creó 3 filas en Notas»). In a test, what it would write says «Propondría…» when its cell asks and
 * «Crearía…» when it saves (`step`'s connection, as the draft holds it). Null when the test has no record.
 */
export function didLines(
  t: T,
  test: Pick<StepTest, "agent" | "ai" | "ms">,
  step: Step,
  locale: string,
  nameOf: (key: string) => string,
): AgentDid | null {
  const record: AgentRecord | undefined = test.agent;
  if (!record) return null;
  const ai: AiRecord | undefined = test.ai;
  const number = new Intl.NumberFormat(locale);
  const num = (n: number) => number.format(n);
  const rounds = record.units.reduce((n, u) => n + u.rounds, 0);
  const head = [t(counted("auto.did.rounds", rounds), { n: num(rounds) })];
  if (ai) {
    head.push(t(counted("auto.did.calls", ai.calls), { n: num(ai.calls) }));
    if (ai.models.length > 0) head.push(ai.models.join(", "));
  }
  const ms = ai?.ms ?? test.ms;
  head.push(
    `${(ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`,
  );
  const modeOf = (collection: string, action: WriteAction) => {
    const c = (step.connections ?? []).find((x) => x.collection === collection);
    const cell = c?.[action];
    return cell ? cell.mode : "ask";
  };
  const verbOf = (tool: string): string | null => {
    if (READ_OPS.includes(tool)) return t(`auto.did.verb.${tool}`);
    if (tool === "create" || tool === "update") return actionWord(t, tool);
    if (tool === "trash" || tool === "remove") return actionWord(t, "remove");
    return null;
  };
  const lineOf = (l: AgentLine, n: number): string => {
    switch (l.op) {
      case "find":
      case "get":
      case "count":
      case "sum": {
        const parts = [
          t(counted(`auto.did.${l.op}`, l.rows), {
            n: num(l.rows),
            name: nameOf(l.collection),
          }),
        ];
        if (l.where !== undefined && l.where !== null) parts.push(t("auto.conn.filtered"));
        if (l.limit !== undefined) parts.push(t("auto.conn.atMost", { n: num(l.limit) }));
        return parts.join(" · ");
      }
      case "create":
      case "update":
      case "remove": {
        const vars = {
          n: num(n),
          name: nameOf(l.collection),
          verb: actionWord(t, l.op),
        };
        if (l.state === "applied") return t(counted(`auto.did.applied.${l.op}`, n), vars);
        if (l.state === "asked") return t(counted(`auto.did.asked.${l.op}`, n), vars);
        if (l.state === "tested")
          return modeOf(l.collection, l.op) === "yes"
            ? t(counted(`auto.would.code.${l.op}`, n), vars)
            : t(counted(`auto.did.would.${l.op}`, n), vars);
        if (l.state === "failed") return t(counted("auto.did.failed", n), vars);
        return t(counted("auto.did.planned", n), vars);
      }
      case "refused": {
        const why = t(`auto.did.why.${DID_WHY.includes(l.why) ? l.why : "other"}`);
        const verb = verbOf(l.tool);
        if (verb === null) return t("auto.did.refused.tool", { tool: l.tool, why });
        return l.collection
          ? t("auto.did.refused", { verb, name: nameOf(l.collection), why })
          : t("auto.did.refused.nowhere", { verb, why });
      }
      case "code":
        return t(counted("auto.did.code", l.rows), { n: num(l.rows) });
      case "tool":
        return t(counted("auto.did.tool", l.rows), {
          name: l.name,
          n: num(l.rows),
        });
      case "hidden": {
        const own = l.integrity === "private";
        if (l.field === "")
          return t(own ? "auto.did.hidden.wholePrivate" : "auto.did.hidden.whole");
        return t(own ? "auto.did.hidden.private" : "auto.did.hidden", { field: l.field });
      }
    }
  };
  const sameWrite = (a: AgentLine, b: AgentLine) =>
    "state" in a &&
    "state" in b &&
    a.op === b.op &&
    a.collection === b.collection &&
    a.state === b.state;
  const many = record.units.length > 1;
  const units = record.units.slice(0, DID_UNITS).map((u, i) => {
    const lines: string[] = [];
    for (let k = 0; k < u.lines.length; ) {
      const l = u.lines[k] as AgentLine;
      let n = 1;
      while (k + n < u.lines.length && sameWrite(l, u.lines[k + n] as AgentLine)) n++;
      lines.push(lineOf(l, n));
      k += n;
    }
    for (const seen of u.seen)
      lines.push(
        t("auto.did.seen", {
          saw: num(seen.saw),
          of: num(seen.of),
        }),
      );
    if (u.more > 0) lines.push(t("auto.did.more", { n: num(u.more) }));
    const row = u.row ?? (many ? i : undefined);
    return {
      title: row === undefined ? null : t("auto.did.unit", { n: num(row + 1) }),
      lines,
    };
  });
  return { head: head.join(" · "), units, more: Math.max(0, record.units.length - DID_UNITS) };
}
