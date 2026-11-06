/**
 * What Juan has on screen as he writes (docs/sistema.md §4.7, F9; task 85). The app sends references only: what is
 * open, the Bandeja's cards in the order he sees them (the first at the top), the rows he chose. From them the server
 * builds what the planner gets, through the models' view (`readStore`): each value with its label, so what came from
 * outside reaches a model as a handle and nothing of a collection closed to the models is there. Never what the app
 * says a thing is: only what the store holds.
 */
import { codeLabel, entityVal, leaf, list, plain, readStore, rec, type Val } from "@boni/agent";
import type { UserStore } from "@boni/store";

/** The most cards and rows a screen gives: what a person sees at once, not a list to read. */
const MAX_CARDS = 20;
const MAX_ROWS = 50;
/** What may be open (the app's views). */
const KINDS = new Set([
  "home",
  "chat",
  "inbox",
  "log",
  "audit",
  "page",
  "row",
  "allPages",
  "flows",
  "collection",
  "proposal",
  "chart",
]);

/** The app's references to what is on its screen. */
export interface ScreenRefs {
  open: { kind: string; id: string | null } | null;
  /** The Bandeja's cards in the order it shows them: a proposal or a question, by id. */
  inbox: { kind: "proposal" | "question"; id: string }[];
  /** Rows Juan chose (a table's selection), by id. */
  chosen: string[];
}

const id80 = (x: unknown): string | null =>
  typeof x === "string" && x.length > 0 && x.length <= 80 ? x : null;
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** The references as the app sent them, bounded; null when they are not references. */
export function screenRefs(b: unknown): ScreenRefs | null {
  if (!isObj(b)) return null;
  const o = b.open;
  const open =
    isObj(o) && typeof o.kind === "string" && KINDS.has(o.kind)
      ? { kind: o.kind, id: id80(o.id) }
      : null;
  if (o !== undefined && o !== null && !open) return null;
  const inbox: ScreenRefs["inbox"] = [];
  for (const c of Array.isArray(b.inbox) ? b.inbox.slice(0, MAX_CARDS) : []) {
    const id = isObj(c) ? id80(c.id) : null;
    if (!id || (c.kind !== "proposal" && c.kind !== "question")) return null;
    inbox.push({ kind: c.kind, id });
  }
  const chosen: string[] = [];
  for (const x of Array.isArray(b.chosen) ? b.chosen.slice(0, MAX_ROWS) : []) {
    const id = id80(x);
    if (!id) return null;
    chosen.push(id);
  }
  return { open, inbox, chosen };
}

/** The screen as the planner gets it: null when nothing on it is worth saying. */
export function screenOf(store: UserStore, refs: ScreenRefs): Val | null {
  const view = readStore(store);
  const code = codeLabel("screen");
  const visible = view.schema().types;
  // A record as the models may see it; one they may not see is not on the screen.
  const record = (id: string): Val | null => {
    const s = view.get(id);
    if (!s || s.entity.deleted !== undefined) return null;
    return entityVal(s, visible[s.entity.type] ?? store.schema().types[s.entity.type]);
  };
  // A proposal waiting in the Bandeja: what it would do, with what it would write as its labels let it through;
  // nothing of a collection the models may no longer see.
  const card = (id: string): Val | null => {
    const p = store.journal.proposal(id);
    if (!p || p.status !== "pending") return null;
    const values = ((p.args as { values?: Record<string, unknown> } | null)?.values ??
      {}) as Record<string, Val>;
    const type = values.type ? plain(values.type) : null;
    const closed =
      typeof type === "string" &&
      !Object.values(visible).some((t) => t.key === type || t.id === type);
    return rec(
      {
        kind: leaf("proposal", code),
        id: leaf(p.id, code),
        tool: leaf(p.tool, code),
        ...(closed ? {} : { args: rec(values, code) }),
      },
      code,
    );
  };
  const fields: Record<string, Val> = {};
  const o = refs.open;
  if (o) {
    const open: Record<string, Val> = { kind: leaf(o.kind, code) };
    const def = o.kind === "collection" && o.id ? visible[o.id] : undefined;
    if (def && !def.system) {
      open.collection = leaf(def.key, code);
      open.name = leaf(def.name, def.label);
    }
    const r = (o.kind === "row" || o.kind === "page") && o.id ? record(o.id) : null;
    if (r) open.record = r;
    const c = o.kind === "proposal" && o.id ? card(o.id) : null;
    if (c) open.proposal = c;
    // What is open and closed to the models says only that something is open.
    fields.open = rec(open, code);
  }
  const cards = refs.inbox.flatMap((c) => {
    if (c.kind === "question") {
      const q = store.journal.request(c.id);
      return q?.status === "pending"
        ? [rec({ kind: leaf("question", code), id: leaf(q.id, code) }, code)]
        : [];
    }
    const v = card(c.id);
    return v ? [v] : [];
  });
  if (cards.length) fields.inbox = list(cards, code);
  const chosen = refs.chosen.flatMap((id) => {
    const r = record(id);
    return r ? [r] : [];
  });
  if (chosen.length) fields.chosen = list(chosen, code);
  return Object.keys(fields).length ? rec(fields, code) : null;
}
