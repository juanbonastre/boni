/**
 * What a step's connections say on the screen (docs/automatizaciones.md AU-40, AU-41, AU-44, AU-176, AU-178 to AU-181,
 * AU-189): the rows of its table with their cells, whether the code uses each and what it uses without permission;
 * the chip under the step; the sentence under the table; the card's mark; and «Haría esto» of a «Código». All of it
 * from the core's `permissions`, `connectionUses` and `stepChanges`, the same functions the engine and «Publicar» read:
 * nothing here decides what a step may do, only how it is said.
 */
import {
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
import type { CodeWould } from "./client.ts";
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
  cells: {
    action: WriteAction;
    cell: WriteCell;
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
    cells: WRITE_ACTIONS.map((action) => {
      const cell: WriteCell = c[action] === false ? false : (c[action] as { mode: WriteMode }).mode;
      const use = uses.find((u) => u.collection === c.collection && u.action === action);
      const used = use?.used ?? false;
      return { action, cell, used, missing: used && cell === false };
    }),
  }));
}

/** A connection's read limits said short (AU-41: «Sí · con filtro»). */
export function limitsOf(t: T, c: Connection, locale: string): string[] {
  if (c.read === false) return [];
  const out: string[] = [];
  if (c.read.where && c.read.where.length > 0) out.push(t("auto.conn.filtered"));
  if (c.read.fields) out.push(t("auto.conn.someFields", { n: c.read.fields.length }));
  if (c.read.limit !== undefined)
    out.push(t("auto.conn.upTo", { n: c.read.limit.toLocaleString(locale) }));
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
 * · pregunta antes», «Lee y elimina · sin preguntar». A removal with «Sí» is said apart from what asks.
 */
export function chipWords(t: T, c: Connection, locale: string): string {
  const writes = WRITE_ACTIONS.filter((a) => c[a] !== false);
  const limits = limitsOf(t, c, locale);
  if (writes.length === 0 && limits.length === 0) return t("auto.conn.onlyReads");
  const verbs = [t("auto.conn.does.read"), ...writes.map((a) => t(`auto.conn.does.${a}`))];
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
  return parts.join(" · ");
}

/**
 * The sentence under the table (AU-44, AU-178): «Puede leer Categorías, y leer y modificar Gastos (con filtro). No
 * puede crear ni eliminar nada.» Connections that may do the same are said together. Empty with no connections.
 */
export function connectionsSentence(
  t: T,
  connections: readonly Connection[],
  nameOf: (key: string) => string,
): string {
  if (connections.length === 0) return "";
  const groups: { actions: string; names: string[] }[] = [];
  for (const c of connections) {
    const writes = WRITE_ACTIONS.filter((a) => c[a] !== false);
    const actions = listed(t, [actionWord(t, "read"), ...writes.map((a) => actionWord(t, a))]);
    const limited =
      c.read !== false &&
      ((c.read.where?.length ?? 0) > 0 ||
        c.read.fields !== undefined ||
        c.read.limit !== undefined);
    const name = nameOf(c.collection) + (limited ? ` (${t("auto.conn.filtered")})` : "");
    const group = groups.find((g) => g.actions === actions);
    if (group) group.names.push(name);
    else groups.push({ actions, names: [name] });
  }
  const can = groups.map((g) => `${g.actions} ${listed(t, g.names)}`);
  const last = can.length > 1 ? `, ${t("auto.list.and")} ${can[can.length - 1]}` : "";
  const first = t("auto.conn.can", {
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
