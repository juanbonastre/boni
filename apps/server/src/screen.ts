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
  leaf,
  list,
  pendingVal,
  readStore,
  rec,
  typeName,
  type Val,
} from "@boni/agent";
import { ancestors, branch, type FieldDef, join, type Label, type TypeDef } from "@boni/entities";
import type { StoredEntity, UserStore } from "@boni/store";
import {
  blockDateField,
  type ChartData,
  type ChartSpec,
  computeBlock,
  type DataBlock,
  type DatabaseView,
  type PageBlock,
} from "@boni/views";
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

/** Something pointed at, by reference: a block of a page, a row, a card of the Bandeja. */
export type PointedRef =
  | { kind: "block"; page: string; block: string }
  | { kind: "row"; id: string }
  | { kind: "proposal" | "question"; id: string };

/** The app's references to what is on its screen. */
export interface ScreenRefs {
  open: { kind: string; id: string | null } | null;
  /** The Bandeja's cards in the order it shows them: a proposal or a question, by id. */
  inbox: { kind: "proposal" | "question"; id: string }[];
  /** Rows Juan chose (a table's selection), by id. */
  chosen: string[];
  /** What he pointed at for this message (`Ctrl+Shift+E`), in the order he did. */
  pointed?: PointedRef[];
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

function pointedRef(x: unknown): PointedRef | null {
  if (!isObj(x)) return null;
  if (x.kind === "block") {
    const page = id80(x.page);
    const block = id80(x.block);
    return page && block ? { kind: "block", page, block } : null;
  }
  if (x.kind === "row" || x.kind === "proposal" || x.kind === "question") {
    const id = id80(x.id);
    return id ? { kind: x.kind, id } : null;
  }
  return null;
}

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
  const pointed: PointedRef[] = [];
  for (const x of Array.isArray(b.pointed) ? b.pointed.slice(0, MAX_POINTED) : []) {
    const ref = pointedRef(x);
    if (!ref) return null;
    pointed.push(ref);
  }
  return { open, inbox, chosen, ...(pointed.length ? { pointed } : {}) };
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
 * reader's words from outside, never what it would write. What was pointed at, in its order: a row and a card as
 * those; a block of a page as what it is (its kind, its title, the collection it shows), what it counts (its
 * measure, its field, its group, its period, its filter, by the keys the planner knows) and its numbers, computed
 * here over the rows the models may read; something closed to the models says only that it is closed.
 */
export function screenOf(
  store: UserStore,
  refs: ScreenRefs,
  o: { mailAccount: string | null; today?: string; chart?: (id: string) => SavedChart | null } = {
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
      },
      code,
    );
  };
  const wantsFacts =
    refs.inbox.some((c) => c.kind === "proposal") ||
    refs.open?.kind === "proposal" ||
    !!refs.pointed?.some((p) => p.kind === "proposal");
  const facts = wantsFacts ? new Map(pendingFacts(store, o).map((p) => [p.id, p])) : new Map();
  const card = (id: string): Val | null => {
    const fact = facts.get(id);
    const v = fact ? pendingVal(fact, view) : null;
    return v?.t === "rec" ? rec({ kind: leaf("proposal", code), ...v.fields }, code) : null;
  };
  const question = (id: string): Val | null => {
    const q = store.journal.request(id);
    return q?.status === "pending"
      ? rec({ kind: leaf("question", code), id: leaf(q.id, code) }, code)
      : null;
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
      const c = facts.get(open.id);
      const v = c ? pendingVal(c, view) : null;
      if (v) what.proposal = v;
    }
    // What is open and closed to the models says only that something is open.
    fields.open = rec(what, code);
  }
  const cards = refs.inbox.flatMap((c) => {
    const v = c.kind === "question" ? question(c.id) : card(c.id);
    return v ? [v] : [];
  });
  if (cards.length) fields.inbox = list(cards, code);
  const chosen = refs.chosen.flatMap((id) => {
    const r = record(id);
    return r ? [r] : [];
  });
  if (chosen.length) fields.chosen = list(chosen, code);
  if (refs.pointed?.length) {
    const blocks = pointedBlocks(store, view, visible, code, record, o);
    // Something closed to the models says only that it is: Boni can say so, and learns nothing of it. So does what
    // is no longer there (a card decided since it was pointed at, a row or a block deleted), which is another
    // thing to say. Only the app sends these references, never a model: telling the two apart probes nothing.
    const said = (why: Missing): Val => rec({ kind: leaf(why, code) }, code);
    const there = (id: string) => {
      const s = store.get(id);
      return !!s && s.entity.deleted === undefined;
    };
    const pointed = refs.pointed.map((p) => {
      if (p.kind === "block") {
        const b = blocks(p.page, p.block);
        return typeof b === "string" ? said(b) : b;
      }
      if (p.kind === "proposal") return card(p.id) ?? said(facts.has(p.id) ? "closed" : "gone");
      if (p.kind === "question") return question(p.id) ?? said("gone");
      const r = record(p.id);
      return r?.t === "rec"
        ? rec({ kind: leaf("row", code), ...r.fields }, code)
        : said(there(p.id) ? "closed" : "gone");
    });
    fields.pointed = list(pointed, code);
  }
  return Object.keys(fields).length ? rec(fields, code) : null;
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
 * A block of a page as the planner gets it when Juan points at it; «closed» when the models may not see it (its page
 * or its collection closed or opaque to them), «gone» when it is no longer there. A collection's rows are read once
 * for all the blocks pointed at in a message (A-15: his thousands of records, never once per block).
 */
function pointedBlocks(
  store: UserStore,
  view: ReadView,
  visible: Types,
  code: Label,
  record: (id: string) => Val | null,
  o: { today?: string; chart?: (id: string) => SavedChart | null },
): (page: string, block: string) => Val | Missing {
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const levels = store.aiAccess();
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
  const dataBlock = (b: DataBlock, by: Label): Record<string, Val> | null => {
    const def = open(b.collection);
    if (!def) return null;
    // As the engine reads it (`blockChartSpec`): a sum or an average needs its field, else it counts.
    const of = key(def, b.measure && b.measure !== "count" ? b.field : undefined);
    const out: Record<string, Val> = {
      collection: leaf(typeName(def), code),
      measure: leaf(of ? (b.measure ?? "count") : "count", code),
      period: leaf(b.period ?? "all", code),
    };
    if (of) out.field = leaf(fieldName(of), code);
    const group = b.type === "number" ? undefined : b.groupBy;
    const groupField = key(def, group);
    if (group && GROUP_TIME[group]) out.group = leaf(GROUP_TIME[group], code);
    else if (groupField) out.group = leaf(fieldName(groupField), code);
    const dateField = key(def, blockDateField(b, def, visible));
    if (dateField) out.date = leaf(fieldName(dateField), code);
    const filterField = key(def, b.filterValue ? b.filterField : undefined);
    if (filterField) {
      const option = filterField.options?.find((x) => x.id === b.filterValue);
      out.filter = rec(
        {
          field: leaf(fieldName(filterField), code),
          equals: option ? leaf(option.name, option.label) : leaf(b.filterValue ?? "", by),
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
    const result = computeBlock(b, visible, () => rows.map((s) => s.entity), { today, titleOf });
    if (!("data" in result)) return out;
    Object.assign(out, figures(result.data, joined(code, read)));
    // Rows the models may not read are not in its numbers. When that makes them other than the ones on Juan's
    // screen, it says so (`partial`), so Boni does not give a total he does not see; never how many, nor which.
    if (mayHide(def.id)) {
      const all = store.list(def.id, { deep: true });
      const whole =
        all.length === rows.length
          ? null
          : computeBlock(b, visible, () => all.map((s) => s.entity), { today });
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

  const viewOf = (def: TypeDef, v: DatabaseView, by: Label): Val => {
    const out: Record<string, Val> = { layout: leaf(v.layout, code) };
    const group = key(def, v.group);
    if (group) out.group = leaf(fieldName(group), code);
    const sort = key(def, v.sort?.field);
    if (sort)
      out.sort = rec(
        { field: leaf(fieldName(sort), code), desc: leaf(!!v.sort?.desc, code) },
        code,
      );
    const rules = (v.filter ?? []).flatMap((r) => {
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
    });
    if (rules.length) out.filter = list(rules, code);
    return rec(out, code);
  };

  return (pageId, blockId) => {
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
    if (b.type === "number" || b.type === "bars" || b.type === "graph") {
      const more = dataBlock(b, by);
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
            view: viewOf(def, b.view, by),
          })
        : "closed";
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
}
