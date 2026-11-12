/**
 * What Juan has on screen as he writes (docs/sistema.md §4.7, F9; task 85). The app sends references only: what is
 * open, the Bandeja's cards in the order he sees them (the first at the top), the rows he chose, and what he pointed
 * at (`Ctrl+Shift+E`: a block of a page, a row, a card). From them the server builds what the planner gets, through
 * the models' view (`readStore`): each value with its label, so what came from outside reaches a model as a handle
 * and nothing of a collection closed to the models is there. Never what the app says a thing is: only what the store
 * holds.
 */

import {
  codeLabel,
  deepLabel,
  entityVal,
  fieldName,
  flowLabel,
  leaf,
  list,
  pendingVal,
  readStore,
  rec,
  typeName,
  type Val,
} from "@boni/agent";
import {
  ancestors,
  branch,
  type FieldDef,
  INTEGRITY_ORDER,
  type Integrity,
  join,
  type Label,
  label,
  SENSITIVITY_ORDER,
  type Sensitivity,
  type TypeDef,
} from "@boni/entities";
import { BODY, type StoredEntity, type UserStore } from "@boni/store";
import {
  blockDateField,
  blockRows,
  type ChartData,
  type ChartSpec,
  type ControlBlock,
  computeBlock,
  controlsOf,
  type DataBlock,
  type DatabaseFilter,
  type DatabaseView,
  findPart,
  heldValue,
  isFilterGroup,
  markdownToBlocks,
  type PageBlock,
  refOf,
  rulesWithValues,
} from "@boni/views";
import { rowUiOf } from "./data.ts";
import { fileFacts } from "./fileActions.ts";
import { collectionKeysOf, nodesOf, stepsOf, typeKeysOf } from "./flows.ts";
import type { MoneyReads } from "./money/book.ts";
import { pendingFacts } from "./origin.ts";
import { getPage } from "./pages.ts";
import { type MoneySource, StoreMoney } from "./v1/storeMoney.ts";

/** The most cards and rows a screen gives: what a person sees at once, not a list to read. */
const MAX_CARDS = 20;
const MAX_ROWS = 50;
/** The most things pointed at in one message, and the most points of a chart given with it. */
export const MAX_POINTED = 20;
const MAX_POINTS = 60;
/** The most of a text block given (a page's paragraph; the rest is read with the page). */
const MAX_TEXT = 2000;
/** The most things on the screen given without pointing (blocks, rows, paragraphs in view). */
export const MAX_VISIBLE = 30;
/** The most steps of a flow, and lines of a step's arguments, given with it. */
const MAX_STEPS = 40;
const MAX_ARGS = 8;
/** What may be open in the right panel (the app's `Panel`). */
const PANELS = new Set(["screen", "edit", "shortcut", "block", "rows", "row"]);
/** A node of the map that is none of the account's records: a connector, a piece of Boni, someone, the devices. */
const MAP_NODE = /^(conn|boni|actor|dev)(:[A-Za-z0-9_.-]{1,60}){0,2}$/;
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

/**
 * Something on the screen, by reference: a block of a page, a row (a record, a page), a card of the Bandeja, a
 * paragraph of a note's text (`part`: its words' key and which of them, `@boni/views` partKey), a collection, a flow,
 * a step of a flow, a chart on its own screen, or another node of the map (a connector, a piece of Boni).
 */
export type PointedRef =
  | { kind: "block"; page: string; block: string }
  | { kind: "row"; id: string }
  | { kind: "proposal" | "question"; id: string }
  | { kind: "part"; id: string; part: string; n: number }
  | { kind: "collection" | "flow" | "chart" | "node"; id: string }
  | { kind: "step"; flow: string; step: string };

/** The app's references to what is on its screen. */
export interface ScreenRefs {
  /** What is open, and of a collection, the view (its tab) it shows. */
  open: { kind: string; id: string | null; view?: string } | null;
  /** The Bandeja's cards in the order it shows them: a proposal or a question, by id. */
  inbox: { kind: "proposal" | "question"; id: string }[];
  /** Rows Juan chose (a table's selection), by id. */
  chosen: string[];
  /** What he pointed at for this message (`Ctrl+Shift+E`), in the order he did. */
  pointed?: PointedRef[];
  /** What is in view without pointing: blocks, rows and paragraphs, from the top. */
  visible?: PointedRef[];
  /** What had the focus before he wrote (a block, a row, a paragraph). */
  focus?: PointedRef;
  /** What is open in the right panel: its kind, and what it shows when it is something of his. */
  panel?: { kind: string; ref?: PointedRef };
}

/** A saved chart of the first pages (the v1 API's): its spec, and its numbers over the money a source gives. */
export interface SavedChart {
  spec: ChartSpec;
  /** The collection it counts (its id), when it is one of the account's. */
  collection?: string;
  over(money: MoneySource): ChartData;
}

const id80 = (x: unknown): string | null =>
  typeof x === "string" && x.length > 0 && x.length <= 80 ? x : null;
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** A flow's trigger on its canvas and on the map, pointed at as one of its steps. */
const TRIGGER = "trigger";

/**
 * Where a thing is on the screen, as the app finds it (`data-boni-ref`, apps/boni-web `pointKey`): what Boni's screen
 * actions name to scroll to it or light it (`screen.scroll`, `screen.highlight`), the code's own key.
 */
export const screenAt = (r: PointedRef): string =>
  r.kind === "block"
    ? `block:${r.page}/${r.block}`
    : r.kind === "step"
      ? `step:${r.flow}/${r.step}`
      : r.kind === "part"
        ? `part:${r.id}/${r.part}/${r.n}`
        : `${r.kind}:${r.id}`;

export function pointedRef(x: unknown): PointedRef | null {
  if (!isObj(x)) return null;
  if (x.kind === "block") {
    const page = id80(x.page);
    const block = id80(x.block);
    return page && block ? { kind: "block", page, block } : null;
  }
  if (x.kind === "step") {
    const flow = id80(x.flow);
    const step = id80(x.step);
    return flow && step ? { kind: "step", flow, step } : null;
  }
  if (x.kind === "part") {
    const id = id80(x.id);
    const part = typeof x.part === "string" && /^[0-9a-f]{8}$/.test(x.part) ? x.part : null;
    const n =
      typeof x.n === "number" && Number.isInteger(x.n) && x.n >= 0 && x.n < 1000 ? x.n : null;
    return id && part && n !== null ? { kind: "part", id, part, n } : null;
  }
  if (
    x.kind === "row" ||
    x.kind === "proposal" ||
    x.kind === "question" ||
    x.kind === "collection" ||
    x.kind === "flow" ||
    x.kind === "chart" ||
    x.kind === "node"
  ) {
    const id = id80(x.id);
    if (!id || (x.kind === "node" && !MAP_NODE.test(id))) return null;
    return { kind: x.kind, id };
  }
  return null;
}
/** A list of references as the app sent them, at most `max`; null when one is not a reference. */
function refsOf(x: unknown, max: number): PointedRef[] | null {
  const out: PointedRef[] = [];
  for (const r of Array.isArray(x) ? x.slice(0, max) : []) {
    const ref = pointedRef(r);
    if (!ref) return null;
    out.push(ref);
  }
  return out;
}

/** The references as the app sent them, bounded; null when they are not references. */
export function screenRefs(b: unknown): ScreenRefs | null {
  if (!isObj(b)) return null;
  const o = b.open;
  const view = isObj(o) ? id80(o.view) : null;
  const open =
    isObj(o) && typeof o.kind === "string" && KINDS.has(o.kind)
      ? { kind: o.kind, id: id80(o.id), ...(view ? { view } : {}) }
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
  const pointed = refsOf(b.pointed, MAX_POINTED);
  const visible = refsOf(b.visible, MAX_VISIBLE);
  if (!pointed || !visible) return null;
  const focus = b.focus === undefined || b.focus === null ? null : pointedRef(b.focus);
  if (b.focus !== undefined && b.focus !== null && !focus) return null;
  const p = b.panel;
  const panelRef = isObj(p) && p.ref !== undefined ? pointedRef(p.ref) : null;
  const panel =
    isObj(p) &&
    typeof p.kind === "string" &&
    PANELS.has(p.kind) &&
    (p.ref === undefined || panelRef)
      ? { kind: p.kind, ...(panelRef ? { ref: panelRef } : {}) }
      : null;
  if (p !== undefined && p !== null && !panel) return null;
  return {
    open,
    inbox,
    chosen,
    ...(pointed.length ? { pointed } : {}),
    ...(visible.length ? { visible } : {}),
    ...(focus ? { focus } : {}),
    ...(panel ? { panel } : {}),
  };
}

/** The text blocks of a page: what they say is the page's own words. */
const TEXT_BLOCKS = new Set([
  "heading",
  "text",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "quote",
  "callout",
  "code",
]);
const GROUP_TIME: Record<string, string> = { "@day": "day", "@week": "week", "@month": "month" };

/**
 * The screen as the planner gets it: null when nothing on it is worth saying. A record by reference (its id, its
 * collection, its title): the planner reads the rest with `entities.get`, as it may; one of a collection or a row
 * closed or opaque to the models is not on it. A card as `inbox.pending` gives it (`pendingVal`): its title as a
 * reader's words from outside, never what it would write; a question with what it asks, its options and where it
 * comes from, when nothing it read was kept from the models. What was pointed at, in its order: a row and a card as
 * those; a block of a page as what it is (its kind, its title, the collection it shows), what it counts (its
 * measure, its field, its group, its period, its filter, by the keys the planner knows) and its numbers, computed
 * here over the rows the models may read; a paragraph of a note as its words; a node of the map or a step of a flow
 * as what it stands for (the flow, the step, the collection, the connector); something closed to the models says
 * only that it is closed. Without pointing: the view of the open collection with its filters, what is in view,
 * what had the focus and what the right panel shows, resolved the same way, leaving out what is closed or gone.
 */
export function screenOf(
  store: UserStore,
  refs: ScreenRefs,
  o: {
    mailAccount: string | null;
    today?: string;
    chart?: (id: string) => SavedChart | null;
    /** A tool's title from the registry («Crear»), for a step. */
    toolTitle?: (tool: string) => string | null;
  } = {
    mailAccount: null,
  },
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
        // A file of his (a chip he dropped): its type, size, folder and what a reader would get (A-24).
        ...(fileFacts(store, id) ?? {}),
      },
      code,
    );
  };
  const all = [
    ...(refs.pointed ?? []),
    ...(refs.visible ?? []),
    ...(refs.focus ? [refs.focus] : []),
    ...(refs.panel?.ref ? [refs.panel.ref] : []),
  ];
  const wantsFacts =
    refs.inbox.some((c) => c.kind === "proposal") ||
    refs.open?.kind === "proposal" ||
    all.some((p) => p.kind === "proposal");
  const facts = wantsFacts ? new Map(pendingFacts(store, o).map((p) => [p.id, p])) : new Map();
  const card = (id: string): Val | null => {
    const fact = facts.get(id);
    const v = fact ? pendingVal(fact, view) : null;
    return v?.t === "rec" ? rec({ kind: leaf("proposal", code), ...v.fields }, code) : null;
  };
  const reader = screenReader(store, view, visible, code, record, o);
  const question = (id: string): Val | null => {
    const q = store.journal.request(id);
    if (q?.status !== "pending") return null;
    const out: Record<string, Val> = {
      kind: leaf("question", code),
      id: leaf(q.id, code),
      asked: leaf(new Date(q.created).toISOString(), code),
      expires: leaf(new Date(q.expires).toISOString(), code),
    };
    const run = store.journal.run(q.run);
    const flow = run?.flow ? store.journal.flow(run.flow) : null;
    if (flow)
      out.flow = rec({ id: leaf(flow.id, code), name: leaf(flow.name, flowLabel(flow.id)) }, code);
    // The record that started its run (the mail being read), by reference, as a row.
    const about = run?.input ? record(run.input) : null;
    if (about) out.about = about;
    // What it asks and its options, with the labels they were painted with (a mail's words reach the planner as a
    // handle). Its words were made from what its run read: when that was a collection the models may not read whole
    // (closed, opaque, a rule keeping rows from them), or a record they may not read, it does not say them.
    const kept =
      !run ||
      collectionKeysOf(run.plan).some((k) => {
        const def = Object.values(visible).find((t) => t.key === k);
        return !def || !reader.open(def.id) || reader.mayHide(def.id);
      }) ||
      (!!run.input && !about);
    const v = q.view as { kind?: unknown; control?: unknown; prompt?: unknown; options?: unknown };
    if (!kept && v?.kind === "ask") {
      const prompt = paintedLeaf(v.prompt);
      if (prompt) out.prompt = prompt;
      if (v.control === "choice" || v.control === "text") out.control = leaf(v.control, code);
      const options = (Array.isArray(v.options) ? v.options : []).slice(0, 20).flatMap((x) => {
        const l = paintedLeaf(x);
        return l ? [l] : [];
      });
      if (options.length) out.options = list(options, code);
    }
    return rec(out, code);
  };
  // Something closed to the models says only that it is: Boni can say so, and learns nothing of it. So does what is
  // no longer there (a card decided since it was pointed at, a row or a block deleted), which is another thing to
  // say. Only the app sends these references, never a model: telling the two apart probes nothing.
  const said = (why: Missing): Val => rec({ kind: leaf(why, code) }, code);
  const there = (id: string) => {
    const s = store.get(id);
    return !!s && s.entity.deleted === undefined;
  };
  const resolve = (p: PointedRef): Val | Missing => {
    if (p.kind === "block") return reader.block(p.page, p.block);
    if (p.kind === "proposal") return card(p.id) ?? (facts.has(p.id) ? "closed" : "gone");
    if (p.kind === "question") return question(p.id) ?? "gone";
    if (p.kind === "part") return reader.part(p.id, p.part, p.n);
    if (p.kind === "collection") return reader.collection(p.id);
    if (p.kind === "flow") return reader.flow(p.id);
    if (p.kind === "step") return reader.step(p.flow, p.step);
    if (p.kind === "chart") return reader.chart(p.id);
    if (p.kind === "node") return reader.node(p.id);
    const r = record(p.id);
    return r?.t === "rec"
      ? rec({ kind: leaf("row", code), ...r.fields }, code)
      : there(p.id)
        ? "closed"
        : "gone";
  };
  /** With where it is on the screen (`at`), for Boni's screen actions; what is closed or gone has none. */
  const placed = (p: PointedRef): Val | Missing => {
    const v = resolve(p);
    // A node's id past its code is outside text (an MCP client's name): such a node is said without its place.
    const outside = p.kind === "node" && p.id.split(":").length > 2;
    return typeof v !== "string" && v.t === "rec" && !outside
      ? rec({ ...v.fields, at: leaf(screenAt(p), code) }, v.label)
      : v;
  };
  /** What is on the screen without pointing: only what the models may see and is there. */
  const quiet = (p: PointedRef): Val | null => {
    const v = placed(p);
    return typeof v === "string" ? null : v;
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
      // The view it shows (its tab, as the account keeps it): its layout, group, order and filters.
      if (reader.open(def.id)) {
        const views = rowUiOf(store, def.id).views;
        const shown = views.find((x) => x.id === open.view) ?? views[0];
        what.view = reader.view(def, shown ?? { layout: "table" }, def.label, shown?.name);
      }
    }
    if (open.kind === "flows" && open.id) {
      const f = reader.flow(open.id);
      if (typeof f !== "string") what.flow = f;
    }
    if (open.kind === "chart" && open.id) {
      const c = reader.chart(open.id);
      if (typeof c !== "string") what.chart = c;
    }
    const r = (open.kind === "row" || open.kind === "page") && open.id ? record(open.id) : null;
    if (r) what.record = r;
    if (open.kind === "proposal" && open.id) {
      const c = facts.get(open.id);
      const v = c ? pendingVal(c, view) : null;
      if (v) what.proposal = v;
    }
    // What is open and closed to the models says only that something is open.
    fields.open = rec(what, code);
  }
  const cards = refs.inbox.flatMap((c) => {
    const v = c.kind === "question" ? question(c.id) : card(c.id);
    return v?.t === "rec"
      ? [
          rec(
            {
              ...v.fields,
              at: leaf(`${c.kind === "question" ? "question" : "proposal"}:${c.id}`, code),
            },
            v.label,
          ),
        ]
      : [];
  });
  if (cards.length) fields.inbox = list(cards, code);
  const chosen = refs.chosen.flatMap((id) => {
    const r = record(id);
    return r?.t === "rec" ? [rec({ ...r.fields, at: leaf(`row:${id}`, code) }, r.label)] : [];
  });
  if (chosen.length) fields.chosen = list(chosen, code);
  if (refs.pointed?.length)
    fields.pointed = list(
      refs.pointed.map((p) => {
        const v = placed(p);
        return typeof v === "string" ? said(v) : v;
      }),
      code,
    );
  const inView = (refs.visible ?? []).flatMap((p) => {
    const v = quiet(p);
    return v ? [v] : [];
  });
  if (inView.length) fields.visible = list(inView, code);
  const focus = refs.focus ? quiet(refs.focus) : null;
  if (focus) fields.focus = focus;
  if (refs.panel) {
    const shows = refs.panel.ref ? quiet(refs.panel.ref) : null;
    fields.panel = rec({ kind: leaf(refs.panel.kind, code), ...(shows ? { shows } : {}) }, code);
  }
  return Object.keys(fields).length ? rec(fields, code) : null;
}

/**
 * One block of a page as the screen gives it (`pages.figures`, a page's chat, D-61): what it is and its numbers,
 * computed now with the page's values as they are saved, over the rows the models may read; null when it is closed
 * to them or gone.
 */
export function blockFigures(
  store: UserStore,
  page: string,
  block: string,
  o: { today?: string } = {},
): Val | null {
  const s = screenOf(
    store,
    { open: null, inbox: [], chosen: [], pointed: [{ kind: "block", page, block }] },
    { mailAccount: null, ...(o.today ? { today: o.today } : {}) },
  );
  const pointed = s?.t === "rec" ? s.fields.pointed : undefined;
  const v = pointed?.t === "list" ? pointed.items[0] : undefined;
  if (v?.t !== "rec") return null;
  const kind = v.fields.kind;
  return kind?.t === "v" && (kind.value === "closed" || kind.value === "gone") ? null : v;
}

/**
 * What a page's chat sees (D-61): the page open, and every block of it in view, from the top (at most MAX_VISIBLE),
 * as the server reads the saved page, whatever window the message was written from.
 */
export function pageScreen(store: UserStore, page: string): ScreenRefs {
  const p = getPage(store, page);
  return {
    open: { kind: "page", id: page },
    inbox: [],
    chosen: [],
    visible: (p?.spec.blocks ?? [])
      .slice(0, MAX_VISIBLE)
      .map((b) => ({ kind: "block" as const, page, block: b.id })),
  };
}

/** A value the app was painted (a question's words) back as a value with its label; null for anything else. */
function paintedLeaf(p: unknown): Val | null {
  if (!isObj(p) || p.t !== "v") return null;
  const value = p.value;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
    return null;
  // What it says it is, never better: an unknown integrity is from outside.
  const integrity = INTEGRITY_ORDER.includes(p.integrity as Integrity)
    ? (p.integrity as Integrity)
    : "external";
  const sensitivity = SENSITIVITY_ORDER.includes(p.sensitivity as Sensitivity)
    ? (p.sensitivity as Sensitivity)
    : "sensitive";
  return leaf(
    typeof value === "string" ? value.slice(0, MAX_TEXT) : value,
    label(integrity, sensitivity, [{ kind: "code", id: "inbox" }]),
  );
}

type ReadView = ReturnType<typeof readStore>;
type Types = Readonly<Record<string, TypeDef>>;
/** Why something pointed at is not on the screen: the models may not see it, or it is no longer there. */
type Missing = "closed" | "gone";

/** What a chart's numbers are, to tell whether two of them say the same. */
const numbersOf = (d: ChartData) =>
  JSON.stringify([d.total, d.series.map((x) => x.points.map((p) => [p.key, p.value]))]);

/** The label of everything read, joined a few at a time: a collection has thousands of rows. */
function joined(first: Label, rest: readonly Label[]): Label {
  let out = first;
  for (let i = 0; i < rest.length; i += 1000) out = join(out, ...rest.slice(i, i + 1000));
  return out;
}

/**
 * What the screen's references are, as the planner gets them; «closed» when the models may not see it (its page or
 * its collection closed or opaque to them), «gone» when it is no longer there. A block of a page; a chart of the
 * first pages; a view of a collection; a paragraph of a note; a collection, a flow, a step of a flow and the other
 * nodes of the map. A collection's rows are read once for all the blocks of a message (A-15: his thousands of
 * records, never once per block).
 */
function screenReader(
  store: UserStore,
  view: ReadView,
  visible: Types,
  code: Label,
  record: (id: string) => Val | null,
  o: {
    today?: string;
    chart?: (id: string) => SavedChart | null;
    toolTitle?: (tool: string) => string | null;
  },
) {
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const levels = store.aiAccess();
  /** A record's title as the models may read it (a page's value, a filter by a relation), or none. */
  const recordTitle = (id: string): Val | undefined => {
    const r = record(id);
    return r?.t === "rec" ? r.fields.title : undefined;
  };
  /** A collection the models read whole values of: there, not Boni's own, and neither closed nor opaque. */
  const open = (id: string): TypeDef | null => {
    const def = visible[id];
    return def && !def.system && !def.archived && (levels[id] ?? "visible") === "visible"
      ? def
      : null;
  };
  /** A row a model may read (an opaque one, a collection's or a rule's, is only for code: not on the screen). */
  const readable = (s: StoredEntity) => !Object.values(s.labels).some((l) => l.noModel);
  const rowsCache = new Map<string, StoredEntity[]>();
  const rowsOf = (type: string): StoredEntity[] => {
    let rows = rowsCache.get(type);
    if (!rows) {
      // A collection's numbers count her daughters' records too (docs/clases.md §2.3), those the models may read.
      rows = view.list(type, { deep: true }).filter(readable);
      rowsCache.set(type, rows);
    }
    return rows;
  };
  const pages = new Map<string, { blocks: PageBlock[]; by: Label } | Missing>();
  const pageOf = (id: string) => {
    let page = pages.get(id);
    if (!page) {
      const whole = getPage(store, id);
      const s = whole ? view.get(id) : null;
      // Who wrote the page says who wrote its blocks' words.
      page = !whole
        ? "gone"
        : s && readable(s)
          ? { blocks: whole.spec.blocks, by: joined(code, Object.values(s.labels)) }
          : "closed";
      pages.set(id, page);
    }
    return page;
  };
  /**
   * Whether a collection may keep rows from the models: a rule on its branch, or a collection inside it with a
   * level of its own. Without either, what the models read of it is all of it, and it is not read again to check.
   */
  const rules = store.aiRules();
  const schema = store.schema();
  const mayHide = (id: string) => {
    const line = new Set([id, ...ancestors(schema, id), ...branch(schema, id)]);
    return (
      rules.some((r) => line.has(r.type)) ||
      branch(schema, id).some((x) => (levels[x] ?? "visible") !== "visible")
    );
  };
  const key = (def: TypeDef, id: string | undefined): FieldDef | undefined =>
    id ? def.fields.find((f) => f.id === id && !f.archived) : undefined;

  /** A chart's numbers as the planner may use them: its total, and its points as names and values, in their order. */
  const figures = (data: ChartData, l: Label): Record<string, Val> => {
    const out: Record<string, Val> = { unit: leaf(data.unit, code) };
    // What it says under its name: the days it counts, in words («octubre 2026 - hasta hoy»).
    if (data.subtitle) out.span = leaf(data.subtitle, l);
    if (data.total !== null) out.total = leaf(data.total, l);
    if (data.previous_total !== null) out.previous_total = leaf(data.previous_total, l);
    const series = data.kind === "number" ? [] : data.series;
    const first = series[0];
    if (!first) return out;
    out.labels = list(
      first.points.slice(0, MAX_POINTS).map((p) => leaf(p.label, l)),
      l,
    );
    const values = (s: (typeof series)[number]) =>
      list(
        s.points.slice(0, MAX_POINTS).map((p) => leaf(p.value, l)),
        l,
      );
    if (series.length === 1) out.values = values(first);
    else
      out.series = list(
        series.map((s) => rec({ name: leaf(s.name, l), values: values(s) }, l)),
        l,
      );
    if (first.points.length > MAX_POINTS) out.more = leaf(first.points.length - MAX_POINTS, code);
    return out;
  };

  /** A number, a bar list or a chart over a collection: what it counts, and its numbers. */
  const dataBlock = (
    b: DataBlock,
    by: Label,
    controls: readonly ControlBlock[] = [],
  ): Record<string, Val> | null => {
    const def = open(b.collection);
    if (!def) return null;
    // As the engine reads it (`blockChartSpec`): a sum or an average needs its field, else it counts.
    const of = key(def, b.measure && b.measure !== "count" ? b.field : undefined);
    // A page's values (D-59): what the controls it names hold now, as the server computes it.
    const held = (v: string | undefined) => {
      const ref = refOf(v);
      if (!ref) return v;
      const x = heldValue(controls.find((c) => c.id === ref));
      return x === undefined ? undefined : String(x);
    };
    const filterValue = held(b.filterValue);
    const period = refOf(b.period) ? (held(b.period) ?? "all") : (b.period ?? "all");
    const out: Record<string, Val> = {
      collection: leaf(typeName(def), code),
      measure: leaf(of ? (b.measure ?? "count") : "count", code),
      period: leaf(period, refOf(b.period) ? by : code),
    };
    if (of) out.field = leaf(fieldName(of), code);
    const group = b.type === "number" ? undefined : b.groupBy;
    const groupField = key(def, group);
    if (group && GROUP_TIME[group]) out.group = leaf(GROUP_TIME[group], code);
    else if (groupField) out.group = leaf(fieldName(groupField), code);
    const dateField = key(def, blockDateField(b, def, visible));
    if (dateField) out.date = leaf(fieldName(dateField), code);
    const filterField = key(def, filterValue ? b.filterField : undefined);
    if (filterField) {
      const option = filterField.options?.find((x) => x.id === filterValue);
      out.filter = rec(
        {
          field: leaf(fieldName(filterField), code),
          equals: option
            ? leaf(option.name, option.label)
            : filterField.type === "relation"
              ? (recordTitle(filterValue ?? "") ?? leaf("", code))
              : leaf(filterValue ?? "", by),
        },
        code,
      );
    }
    // The label of its numbers: every value they were computed from (each row's fields it reads, the names of its
    // groups), as `entities.aggregate` labels a sum.
    const used = [dateField, of, groupField, filterField].filter((f): f is FieldDef => !!f);
    const read: Label[] = [def.label, ...used.map((f) => f.label)];
    for (const f of used) for (const x of f.options ?? []) read.push(x.label);
    const rows = rowsOf(def.id);
    for (const s of rows)
      for (const f of used) {
        const l = s.labels[f.id];
        if (l) read.push(l);
      }
    const titleOf = (id: string) => {
      const s = view.get(id);
      const t = s && readable(s) ? visible[s.entity.type] : undefined;
      if (!s || !t) return "";
      const l = s.labels[t.titleField];
      if (l) read.push(l);
      return String(s.entity.values[t.titleField] ?? "");
    };
    const result = computeBlock(b, visible, () => rows.map((s) => s.entity), {
      today,
      titleOf,
      controls,
    });
    if (!("data" in result)) return out;
    Object.assign(out, figures(result.data, joined(code, read)));
    // How many rows its numbers are, as its rows' list counts them (D-08, `blockRows`): «en 14 movimientos» comes
    // from the code, like the figure (§4.6 point 7).
    const listed = blockRows(b, visible, () => rows.map((s) => s.entity), { today, controls });
    if ("rows" in listed) out.count = leaf(listed.rows.length, joined(code, read));
    // Rows the models may not read are not in its numbers. When that makes them other than the ones on Juan's
    // screen, it says so (`partial`), so Boni does not give a total he does not see; never how many, nor which.
    if (mayHide(def.id)) {
      const all = store.list(def.id, { deep: true });
      const whole =
        all.length === rows.length
          ? null
          : computeBlock(b, visible, () => all.map((s) => s.entity), { today, controls });
      if (whole && "data" in whole && numbersOf(whole.data) !== numbersOf(result.data))
        out.partial = leaf(true, code);
    }
    return out;
  };

  /**
   * The money as the models may read it, with the label of every row it gave. `shut` once it asked for a collection
   * they may not read: its numbers would be others than the ones Juan sees, so there are none.
   */
  const moneyAsSeen = () => {
    const read: Label[] = [];
    let shut = false;
    /** A row the money asked for was kept from it (a rule's, a record of a closed collection it names). */
    let held = false;
    const seen = (s: StoredEntity | null): StoredEntity | null => {
      if (!s || !readable(s)) return null;
      for (const l of Object.values(s.labels)) read.push(l);
      return s;
    };
    const listOf = (type: string) => {
      if (!open(type)) {
        shut = true;
        return [];
      }
      const rows = view.list(type).flatMap((s) => (seen(s) ? [s] : []));
      if (mayHide(type) && rows.length !== store.list(type).length) held = true;
      return rows;
    };
    const reads: MoneyReads = {
      // The whole schema: what the money needs is asked for by name, and refused here when it is closed.
      schema: () => store.schema(),
      get: (id) => {
        const s = view.get(id);
        const got = s && open(s.entity.type) ? seen(s) : null;
        if (!got && store.get(id)) held = true;
        return got;
      },
      list: (type) => listOf(type),
      entities: (type) => listOf(type).map((s) => s.entity),
    };
    return {
      money: new StoreMoney(reads),
      label: () => joined(code, read),
      shut: () => shut,
      held: () => held,
    };
  };

  /** A chart of the first pages: what its spec says it counts, and its numbers over the money the models may read. */
  const savedChart = (id: string, by: Label): Record<string, Val> | Missing => {
    const chart = o.chart?.(id);
    if (!chart) return "gone";
    const spec = chart.spec;
    const { money, label, shut, held } = moneyAsSeen();
    let data: ChartData | null = null;
    try {
      data = chart.over(money);
    } catch {
      // Its numbers cannot be made (the money is not in Boni, a spec the engine refuses): what it is, without them.
    }
    // A collection it counts is closed to the models: as any block of a closed collection, it is not on the screen.
    if (shut()) return "closed";
    const out: Record<string, Val> = {
      title: leaf(spec.title, by),
      measure: leaf(spec.measure ?? "", code),
      period: leaf(spec.period.kind, code),
    };
    // The collection it counts, to look further with the tools.
    const counted = chart.collection ? open(chart.collection) : null;
    if (counted) out.collection = leaf(typeName(counted), code);
    if (spec.period.months) out.months = leaf(spec.period.months, code);
    if (spec.period.days) out.days = leaf(spec.period.days, code);
    if (spec.x?.field)
      out.group = leaf(
        spec.x.field === "date" ? (spec.x.granularity ?? "date") : spec.x.field,
        code,
      );
    if (spec.split?.field) out.split = leaf(spec.split.field, code);
    // What its filter names (a category, a person) may be a row kept from the models: said only when none was.
    const rules = (spec.filters ?? []).map((r) =>
      rec(
        {
          field: leaf(r.field, code),
          op: leaf(r.op, code),
          ...(r.values && !held()
            ? {
                values: list(
                  r.values.map((x) => leaf(x, by)),
                  by,
                ),
              }
            : {}),
        },
        code,
      ),
    );
    if (rules.length) out.filter = list(rules, code);
    if (!data) return out;
    Object.assign(out, figures(data, label()));
    // As a data block: when the rows kept from the models make its numbers other than Juan's, it says so.
    if (held()) {
      try {
        if (numbersOf(chart.over(new StoreMoney(store))) !== numbersOf(data))
          out.partial = leaf(true, code);
      } catch {
        // Juan's own cannot be made either: nothing to compare with.
      }
    }
    return out;
  };

  const viewOf = (def: TypeDef, v: DatabaseView, by: Label, name?: string): Val => {
    const out: Record<string, Val> = { layout: leaf(v.layout, code) };
    if (name) out.name = leaf(name, by);
    const group = key(def, v.group);
    if (group) out.group = leaf(fieldName(group), code);
    const sort = key(def, v.sort?.field);
    if (sort)
      out.sort = rec(
        { field: leaf(fieldName(sort), code), desc: leaf(!!v.sort?.desc, code) },
        code,
      );
    // A rule as its field's name, its op and its value; an advanced filter (task 75) as its join and its rules.
    const ruleVal = (r: DatabaseFilter): Val[] => {
      const f = key(def, r.field);
      if (!f) return [];
      const value = (r as { value?: unknown }).value;
      const option = typeof value === "string" ? f.options?.find((x) => x.id === value) : undefined;
      return [
        rec(
          {
            field: leaf(fieldName(f), code),
            op: leaf(String(r.op), code),
            ...(option
              ? { value: leaf(option.name, option.label) }
              : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
                ? { value: leaf(value, by) }
                : {}),
          },
          code,
        ),
      ];
    };
    const rules = (v.filter ?? []).flatMap((x): Val[] => {
      if (!isFilterGroup(x)) return ruleVal(x);
      const inner = x.rules.flatMap(ruleVal);
      return inner.length
        ? [rec({ join: leaf(x.join, code), rules: list(inner, code) }, code)]
        : [];
    });
    if (rules.length) out.filter = list(rules, code);
    return rec(out, code);
  };

  const block = (pageId: string, blockId: string): Val | Missing => {
    const page = pageOf(pageId);
    if (typeof page === "string") return page;
    const b = page.blocks.find((x) => x.id === blockId);
    if (!b) return "gone";
    const by = page.by;
    const said = (kind: string, more: Record<string, Val> = {}): Val =>
      rec(
        { kind: leaf(kind, code), page: leaf(pageId, code), block: leaf(blockId, code), ...more },
        code,
      );
    const controls = controlsOf(page.blocks);
    if (b.type === "number" || b.type === "bars" || b.type === "graph") {
      const more = dataBlock(b, by, controls);
      return more
        ? said(b.type === "graph" ? "chart" : b.type, { title: leaf(b.title ?? "", by), ...more })
        : "closed";
    }
    if (b.type === "chart") {
      const more = savedChart(b.chart, by);
      return typeof more === "string" ? more : said("chart", more);
    }
    if (b.type === "database") {
      const def = open(b.source);
      return def
        ? said("view", {
            collection: leaf(typeName(def), code),
            name: leaf(def.name, def.label),
            // Its rules with the page's values in them (D-59).
            view: viewOf(
              def,
              { ...b.view, filter: rulesWithValues(b.view.filter ?? [], controls) },
              by,
            ),
          })
        : "closed";
    }
    if (b.type === "control") {
      // A page's value: its name, its kind, and what it holds now as Juan sees it (an option's or a record's name).
      const v = heldValue(b);
      const over = b.collection ? open(b.collection) : null;
      const f = over ? key(over, b.field) : undefined;
      const option = f?.options?.find((x) => x.id === v);
      const shown =
        v === undefined
          ? undefined
          : option
            ? leaf(option.name, option.label)
            : f?.type === "relation"
              ? recordTitle(String(v))
              : leaf(v, by);
      return said("control", {
        name: leaf(b.name, by),
        type: leaf(b.kind, code),
        ...(shown ? { value: shown } : {}),
      });
    }
    if (TEXT_BLOCKS.has(b.type) && "text" in b)
      return said("text", { text: leaf(b.text.slice(0, MAX_TEXT), by) });
    if (b.type === "action") return said("button", { title: leaf(b.label, by) });
    if (b.type === "link")
      return said("link", { title: leaf(b.title ?? "", by), to: leaf(b.to, by) });
    if (b.type === "page" || b.type === "file") {
      const id = b.type === "page" ? b.page : b.file;
      const r = record(id);
      if (r) return said(b.type, { record: r });
      const s = store.get(id);
      return s && s.entity.deleted === undefined ? "closed" : "gone";
    }
    // A line, or a kind of block that says nothing of its own.
    return said(b.type === "divider" ? "line" : "block");
  };

  /** A chart on its own screen: as a chart block of a page says it. */
  const charts = label("own", "personal", [{ kind: "code", id: "charts" }]);
  const chart = (id: string): Val | Missing => {
    const more = savedChart(id, charts);
    return typeof more === "string"
      ? more
      : rec({ kind: leaf("chart", code), id: leaf(id, code), ...more }, code);
  };

  /** A paragraph of a note's text, found again by its words in the text the store keeps (`@boni/views` partKey). */
  const part = (id: string, key: string, n: number): Val | Missing => {
    const r = record(id);
    const s = r ? view.get(id) : null;
    if (!r || !s) {
      const x = store.get(id);
      return x && x.entity.deleted === undefined ? "closed" : "gone";
    }
    const text = findPart(markdownToBlocks(String(s.entity.body ?? "")), key, n);
    if (text === null) return "gone";
    return rec(
      {
        kind: leaf("text", code),
        record: r,
        text: leaf(text.slice(0, MAX_TEXT), s.labels[BODY] ?? codeLabel("store")),
      },
      code,
    );
  };

  /** A collection (the sidebar's tree, a node of the map): by the key and the name the models know it by. */
  const collection = (id: string): Val | Missing => {
    const def = visible[id];
    if (!def) return store.schema().types[id] ? "closed" : "gone";
    if (def.system)
      return rec(
        { kind: leaf("collection", code), name: leaf(def.name, code), boni: leaf(true, code) },
        code,
      );
    if (!open(id)) return "closed";
    return rec(
      {
        kind: leaf("collection", code),
        collection: leaf(typeName(def), code),
        name: leaf(def.name, def.label),
      },
      code,
    );
  };

  /** The collections a flow names, by the names the models know them by: only the ones they may read. */
  const byKey = new Map(Object.values(visible).map((t) => [t.key, t]));
  const closedKeys = Object.values(schema.types).flatMap((t) => {
    const seen = byKey.get(t.key);
    return seen && open(seen.id) ? [] : [t.key];
  });
  const named = (keys: readonly string[]): Val[] =>
    keys.flatMap((k) => {
      const def = byKey.get(k);
      return def && open(def.id) ? [leaf(typeName(def), code)] : [];
    });
  /** What starts a flow, in the words of its trigger (a collection only when the models may read it). */
  const triggerOf = (t: unknown): Val => {
    const x = isObj(t) ? t : {};
    if (typeof x.created === "string") {
      const c = named([x.created]);
      return rec({ on: leaf("created", code), ...(c[0] ? { collection: c[0] } : {}) }, code);
    }
    if (isObj(x.schedule)) {
      const every = typeof x.schedule.every === "string" ? x.schedule.every : "";
      const at = typeof x.schedule.at === "string" ? x.schedule.at : "";
      return rec(
        { on: leaf("schedule", code), every: leaf(every, code), at: leaf(at, code) },
        code,
      );
    }
    if (x.manual) return rec({ on: leaf("manual", code) }, code);
    return rec({ on: leaf(Object.keys(x)[0] ?? "manual", code) }, code);
  };
  const flowRow = (id: string) => store.journal.flow(id);
  /** A step of a flow: what it does (its op, its tool or reader, its title), the collections and its arguments. */
  const stepVal = (f: NonNullable<ReturnType<typeof flowRow>>, stepId: string): Val | null => {
    const by = flowLabel(f.id);
    const steps = stepsOf(f.plan);
    const s = steps.find((x) => x.id === stepId);
    const n = nodesOf(f.plan, f.trigger, o.toolTitle ?? (() => null), () => null).find(
      (x) => x.id === stepId,
    );
    if (!s || !n) return null;
    const keys =
      n.op === "call" ? typeKeysOf((s.args as Record<string, unknown> | undefined)?.type) : [];
    // Its arguments as the editor writes them, without what names a collection the models may not read. A step over
    // a closed collection says none: its values and conditions name that collection's fields.
    const word = (k: string) => new RegExp(`(^|[^A-Za-z0-9_])${k}([^A-Za-z0-9_]|$)`);
    const shut = keys.some((k) => closedKeys.includes(k));
    const args = (shut ? [] : n.args)
      .filter((a) => !a.startsWith("type:") && !closedKeys.some((k) => word(k).test(a)))
      .slice(0, MAX_ARGS)
      .map((a) => leaf(a.slice(0, 200), by));
    const into = named(keys);
    return rec(
      {
        id: leaf(n.id, code),
        op: leaf(n.op, code),
        what: leaf(n.what, code),
        ...(n.title ? { title: leaf(n.title, code) } : {}),
        ...(into.length ? { collections: list(into, code) } : {}),
        ...(n.when ? { when: leaf(true, code) } : {}),
        ...(n.each ? { each: leaf(true, code) } : {}),
        ...(args.length ? { args: list(args, by) } : {}),
      },
      code,
    );
  };
  /** A flow: its name, whether it is on, what starts it, the collections it names and its steps. */
  const flow = (id: string): Val | Missing => {
    const f = flowRow(id);
    if (!f) return "gone";
    const steps = stepsOf(f.plan)
      .slice(0, MAX_STEPS)
      .flatMap((s) => {
        const v = stepVal(f, s.id);
        return v ? [v] : [];
      });
    const cols = named(collectionKeysOf(f.plan));
    return rec(
      {
        kind: leaf("flow", code),
        id: leaf(f.id, code),
        name: leaf(f.name, flowLabel(f.id)),
        on: leaf(f.enabled, code),
        by: leaf(f.by, code),
        trigger: triggerOf(f.trigger),
        ...(cols.length ? { collections: list(cols, code) } : {}),
        steps: list(steps, code),
      },
      code,
    );
  };
  /**
   * A step of a flow pointed at on its canvas or on the map: the step, with its flow by id and name. Its trigger
   * (`trigger`, the first node of its canvas) is what starts it.
   */
  const step = (flowId: string, stepId: string): Val | Missing => {
    const f = flowRow(flowId);
    if (f && stepId === TRIGGER)
      return rec(
        {
          kind: leaf("trigger", code),
          flow: rec({ id: leaf(f.id, code), name: leaf(f.name, flowLabel(f.id)) }, code),
          trigger: triggerOf(f.trigger),
        },
        code,
      );
    const v = f ? stepVal(f, stepId) : null;
    if (!f || !v) return "gone";
    return rec(
      {
        kind: leaf("step", code),
        flow: rec({ id: leaf(f.id, code), name: leaf(f.name, flowLabel(f.id)) }, code),
        step: v,
      },
      code,
    );
  };
  /** A node of the map that is none of the account's records: what it is (a connector, a piece of Boni, someone). */
  const KIND: Record<string, string> = {
    conn: "connector",
    boni: "boni",
    actor: "actor",
    dev: "devices",
  };
  // Only what it is, by its kind and its code («mail», «inbox», «mcp»): a third part (an MCP client's name) is
  // outside text the app copied into the id, never said as the code's.
  const node = (id: string): Val | Missing => {
    const [first, what] = id.split(":");
    const kind = KIND[first ?? ""];
    if (!kind) return "gone";
    return rec(
      {
        kind: leaf(kind, code),
        node: leaf(what ? `${first}:${what}` : (first ?? ""), code),
        ...(what ? { code: leaf(what, code) } : {}),
      },
      code,
    );
  };

  return { block, chart, part, collection, flow, step, node, view: viewOf, open, mayHide };
}
