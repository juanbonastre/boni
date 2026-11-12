import { randomUUID } from "node:crypto";
import {
  codeLabel,
  deepLabel,
  fieldByName,
  leaf,
  plain,
  type ReadStore,
  rec,
  ToolError,
  type ToolRegistry,
  typeByKey,
  type Val,
} from "@boni/agent";
import { join, type Label, type TypeDef } from "@boni/entities";
import type { OpMeta, UserStore } from "@boni/store";
import {
  type ControlBlock,
  controlsOf,
  controlValueOk,
  DATA_BLOCKS,
  databaseViewOk,
  heldValue,
  type PageBlock,
  type PageSpec,
  pageErrors,
  refTo,
} from "@boni/views";
import {
  createPage,
  getPage,
  type Page,
  PageError,
  type PageWriter,
  removePage,
  updatePage,
} from "./pages.ts";

/**
 * The actions of the area «Páginas y vistas» (docs/sistema.md §4.1, F10): making a page, adding a block to it (a
 * text, a number, a bar list, a chart, a table of a collection), changing a table's view, renaming, moving and
 * deleting a page. The planner, a flow and an assistant by the MCP do it with the same code the app's routes run
 * (pages.ts), each as its own writer, so Undo of the run takes it back. What a model writes names collections and
 * fields as it knows them (their keys): the code turns them into ids, and a collection the models may not see is
 * not found.
 */

/** What the server gives a page action for its run (`ToolDef.service` "pages"). */
export interface PagesService {
  store: UserStore;
  meta: OpMeta;
  /** One block of a page as the screen gives it, its numbers computed now (screen.ts `blockFigures`); null: none. */
  figures?: (page: string, block: string) => Val | null;
}
const serviceOf = (s: unknown): PagesService => {
  if (!s || typeof s !== "object" || !("store" in s)) throw new ToolError("not-available");
  return s as PagesService;
};
const code = codeLabel("pages");
const text = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  if (typeof x !== "string") throw new ToolError("bad-argument");
  return x;
};
const pageOf = (store: UserStore, v: Val | undefined): Page => {
  const p = getPage(store, text(v));
  // Boni's template pages are its own: a model reads them, never changes them.
  if (!p || p.template) throw new ToolError("no-such-page");
  return p;
};
const wrap = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    if (e instanceof PageError)
      throw new ToolError(e.code === "not-found" ? "no-such-page" : e.code);
    throw e;
  }
};
const pageVal = (p: Page) =>
  rec(
    { id: leaf(p.id, code), title: leaf(p.title, code), blocks: leaf(p.spec.blocks.length, code) },
    code,
  );

const TEXT_KINDS = ["heading", "text", "bullet", "numbered", "todo", "quote", "callout", "divider"];
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/**
 * A block as a model writes it, as the page keeps it: a fresh id, its collection and fields by id. Only texts, a
 * page's value (a «Control», D-59) and what reads a collection (a number, a bar list, a chart, a table); a link to a
 * screen, a file or a button is the app's. A data block names a control of the page as `$<its block id>`.
 */
export function blockFrom(ro: ReadStore, raw: unknown): PageBlock {
  if (!isObj(raw) || typeof raw.type !== "string") throw new ToolError("bad-block");
  const id = `b_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const { type } = raw;
  if (TEXT_KINDS.includes(type)) {
    const { at: _at, id: _id, ...rest } = raw;
    return { ...rest, id } as PageBlock;
  }
  const def = (): TypeDef => {
    if (typeof raw.collection !== "string") throw new ToolError("bad-block");
    return typeByKey(ro, raw.collection);
  };
  const field = (d: TypeDef, name: unknown): string | undefined => {
    if (name === undefined || name === null || name === "") return undefined;
    if (typeof name !== "string") throw new ToolError("bad-block");
    // A chart by month, week or day of its rows' date.
    if (name === "@month" || name === "@week" || name === "@day") return name;
    const f = fieldByName(d, name);
    if (!f) throw new ToolError("unknown-field");
    return f.id;
  };
  if ((DATA_BLOCKS as readonly string[]).includes(type)) {
    const d = def();
    const out: Record<string, unknown> = { id, type, collection: d.id };
    for (const k of ["title", "measure", "period", "shape", "filterValue"] as const)
      if (raw[k] !== undefined) out[k] = raw[k];
    for (const k of ["field", "groupBy", "date", "filterField"] as const) {
      const f = field(d, raw[k]);
      if (f) out[k] = f;
    }
    return out as PageBlock;
  }
  if (type === "database") {
    const d = def();
    return {
      id,
      type,
      source: d.id,
      view: viewFrom(d, raw.view ?? { layout: "table" }, field, true),
    };
  }
  if (type === "control") {
    const out: Record<string, unknown> = { id, type, name: raw.name, kind: raw.kind };
    if (raw.kind === "option") {
      const d = def();
      out.collection = d.id;
      const f = field(d, raw.field);
      if (!f) throw new ToolError("bad-block");
      out.field = f;
    }
    const c = out as unknown as ControlBlock;
    if (raw.value !== undefined && raw.value !== null) {
      const v = valueFor(ro, c, raw.value);
      if (v !== undefined) out.value = v;
    }
    return out as PageBlock;
  }
  throw new ToolError("bad-block");
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/**
 * A value as a model writes it, as the control keeps it: an option by its id or its name, a record a relation points
 * to by its id or its title (one the models may see), a month as YYYY-MM, a period as YYYY-MM-DD/YYYY-MM-DD, a
 * number, a text. One that is none of them is refused, never another in its place.
 */
export function valueFor(ro: ReadStore, c: ControlBlock, raw: unknown): string | number {
  if (c.kind === "number" && typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw)))
    raw = Number(raw);
  if (c.kind === "option" && typeof raw === "string") {
    const def = c.collection ? ro.schema().types[c.collection] : undefined;
    const f = def?.fields.find((x) => x.id === c.field);
    if (!f) throw new ToolError("unknown-field");
    if (f.type === "relation") {
      const target = f.relation?.target ?? "";
      const byId = ro.get(raw);
      if (byId && byId.entity.type === target) return byId.entity.id;
      const tdef = ro.schema().types[target];
      const hits = tdef
        ? ro
            .list(target, { deep: true })
            .filter((e) => fold(String(e.entity.values[tdef.titleField] ?? "")) === fold(raw))
        : [];
      if (hits.length !== 1) throw new ToolError(hits.length ? "ambiguous-value" : "no-such-value");
      return (hits[0] as (typeof hits)[number]).entity.id;
    }
    const o =
      f.options?.find((x) => x.id === raw) ?? f.options?.find((x) => fold(x.name) === fold(raw));
    if (!o) throw new ToolError("no-such-value");
    return o.id;
  }
  if (!controlValueOk(c.kind, raw)) throw new ToolError("bad-value");
  return raw as string | number;
}

/**
 * A block as a model writes it may name a control of the page by its name (`"$Categoría"`, a rule's `from`), as it
 * cannot know the id the control was given: the name becomes that id. A name that is no control is left as it is,
 * and the page's check refuses it.
 */
export function namedRefs(raw: unknown, p: Page): unknown {
  if (!isObj(raw)) return raw;
  const cs = p.spec.blocks.filter((b): b is PageBlock & ControlBlock => b.type === "control");
  const idOf = (name: string) =>
    (cs.find((c) => c.id === name) ?? cs.find((c) => fold(c.name) === fold(name)))?.id;
  const ref = (v: unknown) => {
    if (typeof v !== "string" || !v.startsWith("$")) return v;
    const id = idOf(v.slice(1));
    return id ? refTo(id) : v;
  };
  const out: Record<string, unknown> = { ...raw };
  for (const k of ["filterValue", "period"] as const) if (k in out) out[k] = ref(out[k]);
  const rule = (r: unknown) =>
    isObj(r) && typeof r.from === "string" ? { ...r, from: idOf(r.from) ?? r.from } : r;
  if (isObj(out.view) && Array.isArray(out.view.filter))
    out.view = {
      ...out.view,
      filter: out.view.filter.map((r) =>
        isObj(r) && Array.isArray(r.rules) ? { ...r, rules: r.rules.map(rule) } : rule(r),
      ),
    };
  return out;
}

/** The page with one control holding another value (none: `null`), found by its block id or its name. */
export function withValue(p: Page, ro: ReadStore, control: string, raw: unknown): PageSpec {
  const cs = p.spec.blocks.filter((b): b is PageBlock & ControlBlock => b.type === "control");
  const c = cs.find((b) => b.id === control) ?? cs.find((b) => fold(b.name) === fold(control));
  if (!c) throw new ToolError("no-such-block");
  const value = raw === null || raw === "" ? undefined : valueFor(ro, c, raw);
  const { value: _old, ...rest } = c;
  const next = (value === undefined ? rest : { ...rest, value }) as PageBlock;
  const spec: PageSpec = {
    ...p.spec,
    blocks: p.spec.blocks.map((x) => (x.id === c.id ? next : x)),
  };
  if (pageErrors(spec).length) throw new ToolError("bad-value");
  return spec;
}

/** A table's view as a model writes it (its fields by name), as the page keeps it (by id). */
function viewFrom(
  d: TypeDef,
  raw: unknown,
  field: (d: TypeDef, name: unknown) => string | undefined,
  refs = false,
): Extract<PageBlock, { type: "database" }>["view"] {
  if (!isObj(raw)) throw new ToolError("bad-view");
  const out: Record<string, unknown> = { layout: raw.layout };
  for (const k of ["group", "date"] as const) {
    const f = field(d, raw[k]);
    if (f) out[k] = f;
  }
  if (raw.span !== undefined) out.span = raw.span;
  if (isObj(raw.sort))
    out.sort = {
      field: field(d, raw.sort.field),
      ...(raw.sort.desc !== undefined ? { desc: raw.sort.desc } : {}),
    };
  if (Array.isArray(raw.hide)) out.hide = raw.hide.map((h) => field(d, h));
  // A table's calculations by column, the column it is pinned up to and the ones that wrap (task 76).
  if (isObj(raw.calc))
    out.calc = Object.fromEntries(Object.entries(raw.calc).map(([k, c]) => [field(d, k), c]));
  if (raw.pin !== undefined) out.pin = field(d, raw.pin);
  if (Array.isArray(raw.wrap)) out.wrap = raw.wrap.map((w) => field(d, w));
  // A rule, or an advanced filter: its join and its rules, each by field (D-58).
  const rule = (r: unknown) => (isObj(r) ? { ...r, field: field(d, r.field) } : r);
  if (Array.isArray(raw.filter))
    out.filter = raw.filter.map((r) =>
      isObj(r) && Array.isArray(r.rules) ? { ...r, rules: r.rules.map(rule) } : rule(r),
    );
  // A page's table may take a rule's value `from` one of the page's controls (D-59).
  if (!databaseViewOk(out, refs)) throw new ToolError("bad-view");
  return out as Extract<PageBlock, { type: "database" }>["view"];
}

/** The page with one more block, at the end; checked whole as the app's editor would save it. */
export function withBlock(p: Page, block: PageBlock): PageSpec {
  const spec: PageSpec = { ...p.spec, blocks: [...p.spec.blocks, block] };
  if (pageErrors(spec).length) throw new ToolError("bad-block");
  return spec;
}

const viewField = (d: TypeDef, name: unknown) => {
  if (name === undefined || name === null || name === "") return undefined;
  if (typeof name !== "string") throw new ToolError("bad-view");
  const f = fieldByName(d, name);
  if (!f) throw new ToolError("unknown-field");
  return f.id;
};

/** A view of a collection as a model writes it (its fields by name), as a table or a saved view keeps it (by id). */
export const viewOf = (def: TypeDef, raw: unknown, refs = false) =>
  viewFrom(def, raw, viewField, refs);

/** A table's block with its view changed. */
export function withView(p: Page, ro: ReadStore, blockId: string, raw: unknown): PageSpec {
  const b = p.spec.blocks.find((x) => x.id === blockId);
  if (!b || b.type !== "database") throw new ToolError("no-such-block");
  const def = Object.values(ro.schema().types).find((t) => t.id === b.source);
  if (!def) throw new ToolError("unknown-type");
  const spec: PageSpec = {
    ...p.spec,
    blocks: p.spec.blocks.map((x) =>
      x.id === blockId ? { ...b, view: viewOf(def, raw, true) } : x,
    ),
  };
  if (pageErrors(spec).length) throw new ToolError("bad-view");
  return spec;
}

/** Who writes, for a run: its meta, and the label of what it was given (a model's, Juan's, from outside). */
const writer = (s: PagesService, args: readonly (Val | undefined)[], extra: Label): PageWriter => ({
  meta: s.meta,
  label: join(extra, ...args.filter((a): a is Val => !!a).map(deepLabel)),
});

const page = {
  role: "page" as const,
  required: true,
  describe: "the page's id (pages.create gives it)",
};

/** The page actions, added to a registry (the server's, and the MCP's that describes what a flow may be made of). */
export function withPageActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "pages.create",
    icon: "Plus",
    undo: ["run"],
    effect: "write",
    area: "pages",
    service: "pages",
    title: "Crear página",
    describe:
      "Make one of Juan's pages (in his sidebar), empty, with its title; then add its blocks with pages.add_block. parent: a page to put it under",
    args: {
      title: {
        role: "content",
        required: true,
        describe: "the page's name, in one or a few words",
      },
      parent: { role: "page", describe: "the page it goes under (none: at the top)" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const parent = a.parent ? pageOf(s.store, a.parent).id : undefined;
      const p = wrap(() =>
        createPage(
          s.store,
          { title: text(a.title), ...(parent ? { parent } : {}) },
          writer(s, [a.title], extra),
        ),
      );
      return pageVal(p);
    },
  });
  r.register({
    name: "pages.add_block",
    icon: "SquarePlus",
    undo: ["run"],
    effect: "write",
    area: "pages",
    service: "pages",
    title: "Añadir bloque",
    describe:
      'Add a block at the end of one of Juan\'s pages, as he would with «/»: block {"lit": {...}} is a text ({"type": "heading" | "text" | "bullet" | "todo" | "quote" | "callout", "text": "..."}, or {"type": "divider"}), or reads a collection by its key and fields by theirs: a number {"type": "number", "collection", "measure": "count" | "sum" | "avg", "field"}, a bar list {"type": "bars", ..., "groupBy": field}, a chart {"type": "graph", ..., "groupBy": field or "@month" | "@week" | "@day", "shape": "bar" | "hbar" | "line" | "area" | "donut"} (each with "period": "month" | "30d" | "12m" | "year" | "all", "title", "filterField" and "filterValue"), a table {"type": "database", "collection", "view": {"layout": "table" | "board" | "list" | "gallery" | "calendar", "sort": {"field", "desc"}, "group", "hide": [fields], "filter": [{"field", "op", "value"}]}}, or a value of the page shown as a control {"type": "control", "name", "kind": "option" | "month" | "number" | "text", "collection" and "field" (an option\'s: a select or a relation), "value"}; a number, bar list or chart then names it as "filterValue": "$<its name>" (an option control over its filterField) or "period": "$<its name>" (a month control), and a table\'s rule as {"field", "op", "from": "<its name>"}',
    args: {
      page,
      block: { role: "definition", required: true, describe: "the block" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const p = pageOf(s.store, a.page);
      const block = blockFrom(c.store, namedRefs(a.block ? plain(a.block) : null, p));
      const next = wrap(() =>
        updatePage(s.store, p.id, { spec: withBlock(p, block) }, writer(s, [a.block], extra)),
      );
      return rec({ page: pageVal(next), block: leaf(block.id, code) }, code);
    },
  });
  r.register({
    name: "pages.set_view",
    icon: "Table",
    undo: ["run"],
    effect: "write",
    area: "pages",
    service: "pages",
    title: "Cambiar vista",
    describe:
      'Change how a table of a page shows its collection (its block id): view {"lit": {"layout": ..., "sort": ..., "group": ..., "hide": [...], "filter": [...]}}, as in pages.add_block',
    args: {
      page,
      block: { role: "option", required: true, describe: "the table's block id" },
      view: { role: "definition", required: true, describe: "the view" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const p = pageOf(s.store, a.page);
      const spec = withView(p, c.store, text(a.block), a.view ? plain(a.view) : null);
      return pageVal(wrap(() => updatePage(s.store, p.id, { spec }, writer(s, [a.view], extra))));
    },
  });
  r.register({
    name: "pages.set_value",
    icon: "SlidersHorizontal",
    undo: ["run"],
    effect: "write",
    area: "pages",
    service: "pages",
    title: "Cambiar valor",
    describe:
      "Change what one of a page's controls holds (its block id or its name), as Juan does on the control: the page's numbers, charts and tables follow it. value: an option's name, a record's title (for a relation), YYYY-MM, YYYY-MM-DD/YYYY-MM-DD for a period, a number or a text; null: none (every row)",
    args: {
      page,
      control: { role: "option", required: true, describe: "the control's block id or its name" },
      value: { role: "value", required: true, describe: "what it holds now; null: none" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const p = pageOf(s.store, a.page);
      const raw = a.value ? plain(a.value) : null;
      const spec = withValue(p, c.store, text(a.control), raw);
      return pageVal(wrap(() => updatePage(s.store, p.id, { spec }, writer(s, [a.value], extra))));
    },
  });
  // A page's numbers as the code computes them (D-61): what a page's chat answers with, by ref, never a number of the
  // model's own. It reads the page as it is saved, after the values the run set.
  r.register({
    name: "pages.figures",
    icon: "Calculator",
    effect: "read",
    area: "pages",
    service: "pages",
    title: "Leer cifras",
    describe:
      "Read one block of one of Juan's pages as the screen shows it, its numbers computed now with the page's values as they are (after pages.set_value): its title, unit, span, total, previous_total, labels and values, and count: how many rows its numbers are. A reply names them by ref ($s.total, $s.count)",
    args: {
      page,
      block: {
        role: "option",
        required: true,
        describe: "the block's id (as the screen lists it)",
      },
    },
    run(c, a) {
      const s = serviceOf(c.service);
      if (!s.figures) throw new ToolError("not-available");
      const p = getPage(s.store, text(a.page));
      if (!p) throw new ToolError("no-such-page");
      const v = s.figures(p.id, text(a.block));
      if (!v) throw new ToolError("no-such-block");
      if (v.t !== "rec" || !("count" in v.fields)) return v;
      // Which rows its numbers are (D-08): the page, the block and its values as they are now, so a click on the
      // figure in the chat's answer lists those rows even after the page's values change (§4.6 point 7).
      const values: Record<string, Val> = {};
      for (const c of controlsOf(p.spec.blocks)) {
        const x = heldValue(c);
        if (x !== undefined) values[c.id] = leaf(x, code);
      }
      const rowsOf = rec(
        { page: leaf(p.id, code), block: leaf(text(a.block), code), values: rec(values, code) },
        code,
      );
      return rec({ ...v.fields, rows_of: rowsOf }, v.label);
    },
  });
  r.register({
    name: "pages.update",
    icon: "PenLine",
    undo: ["run"],
    effect: "write",
    area: "pages",
    service: "pages",
    title: "Cambiar página",
    describe:
      "Rename one of Juan's pages, change its icon (one emoji) or move it under another page (parent; null: to the top)",
    args: {
      page,
      title: { role: "content", describe: "its new name" },
      icon: { role: "content", describe: "one emoji" },
      parent: { role: "page", describe: "the page it goes under; null: to the top" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const p = pageOf(s.store, a.page);
      const input: { title?: string; icon?: string; parent?: string | null } = {};
      if (a.title) input.title = text(a.title);
      if (a.icon) input.icon = text(a.icon);
      if (a.parent) {
        const to = plain(a.parent);
        input.parent = to === null ? null : pageOf(s.store, a.parent).id;
      }
      if (!Object.keys(input).length) throw new ToolError("bad-argument");
      return pageVal(
        wrap(() => updatePage(s.store, p.id, input, writer(s, [a.title, a.icon], extra))),
      );
    },
  });
  r.register({
    name: "pages.delete",
    icon: "Trash",
    undo: ["trash"],
    effect: "write",
    area: "pages",
    service: "pages",
    // Deleting is Juan's touch (docs/sistema.md §4.1): to the trash, and he confirms it (P5).
    alwaysConfirm: true,
    title: "Borrar página",
    describe: "Send one of Juan's pages to the trash (its subpages move up); he confirms it",
    args: { page },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const p = pageOf(s.store, a.page);
      wrap(() => removePage(s.store, p.id, writer(s, [], extra)));
      return leaf({ deleted: p.id }, code);
    },
  });
  return r;
}
