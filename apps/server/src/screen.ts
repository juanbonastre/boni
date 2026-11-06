/**
 * What Juan has on screen as he writes (docs/sistema.md §4.7, F9; task 85). The app sends references only: what is
 * open, the Bandeja's cards in the order he sees them (the first at the top), the rows he chose. From them the server
 * builds what the planner gets, through the models' view (`readStore`): each value with its label, so what came from
 * outside reaches a model as a handle and nothing of a collection closed to the models is there. Never what the app
 * says a thing is: only what the store holds.
 */
import {
  codeLabel,
  deepLabel,
  entityVal,
  leaf,
  list,
  pendingVal,
  readStore,
  rec,
  typeName,
  type Val,
} from "@boni/agent";
import type { UserStore } from "@boni/store";
import { pendingFacts } from "./origin.ts";

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

/**
 * The screen as the planner gets it: null when nothing on it is worth saying. A record by reference (its id, its
 * collection, its title): the planner reads the rest with `entities.get`, as it may; one of a collection or a row
 * closed or opaque to the models is not on it. A card as `inbox.pending` gives it (`pendingVal`): its title as a
 * reader's words from outside, never what it would write.
 */
export function screenOf(
  store: UserStore,
  refs: ScreenRefs,
  o: { mailAccount: string | null } = { mailAccount: null },
): Val | null {
  const view = readStore(store);
  const code = codeLabel("screen");
  const visible = view.schema().types;
  const record = (id: string): Val | null => {
    const s = view.get(id);
    if (!s || s.entity.deleted !== undefined) return null;
    const def = visible[s.entity.type] ?? store.schema().types[s.entity.type];
    const whole = entityVal(s, def);
    // What only code may compute with (an opaque collection's, a closing rule's) is not on the screen (§4.7).
    if (whole.t !== "rec" || deepLabel(whole).noModel) return null;
    const titleKey = def?.fields.find((f) => f.id === def.titleField)?.key;
    const title = titleKey ? whole.fields[titleKey] : undefined;
    return rec(
      {
        id: whole.fields.id as Val,
        type: whole.fields.type as Val,
        ...(title ? { title } : {}),
      },
      code,
    );
  };
  const facts = refs.inbox.some((c) => c.kind === "proposal")
    ? new Map(pendingFacts(store, o).map((p) => [p.id, p]))
    : new Map();
  const card = (id: string): Val | null => {
    const fact = facts.get(id);
    const v = fact ? pendingVal(fact, view) : null;
    return v?.t === "rec" ? rec({ kind: leaf("proposal", code), ...v.fields }, code) : null;
  };
  const fields: Record<string, Val> = {};
  const open = refs.open;
  if (open) {
    const what: Record<string, Val> = { kind: leaf(open.kind, code) };
    const def = open.kind === "collection" && open.id ? visible[open.id] : undefined;
    if (def && !def.system) {
      // By the name the models know it by (a collection named from outside, by its id).
      what.collection = leaf(typeName(def), code);
      what.name = leaf(def.name, def.label);
    }
    const r = (open.kind === "row" || open.kind === "page") && open.id ? record(open.id) : null;
    if (r) what.record = r;
    if (open.kind === "proposal" && open.id) {
      const c = (facts.size ? facts : new Map(pendingFacts(store, o).map((p) => [p.id, p]))).get(
        open.id,
      );
      const v = c ? pendingVal(c, view) : null;
      if (v) what.proposal = v;
    }
    // What is open and closed to the models says only that something is open.
    fields.open = rec(what, code);
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
