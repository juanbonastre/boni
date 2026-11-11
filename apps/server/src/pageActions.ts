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
  DATA_BLOCKS,
  databaseViewOk,
  type PageBlock,
  type PageSpec,
  pageErrors,
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
 * A block as a model writes it, as the page keeps it: a fresh id, its collection and fields by id. Only texts and
 * what reads a collection (a number, a bar list, a chart, a table); a link to a screen, a file or a button is the
 * app's.
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
    return { id, type, source: d.id, view: viewFrom(d, raw.view ?? { layout: "table" }, field) };
  }
  throw new ToolError("bad-block");
}

/** A table's view as a model writes it (its fields by name), as the page keeps it (by id). */
function viewFrom(
  d: TypeDef,
  raw: unknown,
  field: (d: TypeDef, name: unknown) => string | undefined,
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
  if (Array.isArray(raw.filter))
    out.filter = raw.filter.map((r) => (isObj(r) ? { ...r, field: field(d, r.field) } : r));
  if (!databaseViewOk(out)) throw new ToolError("bad-view");
  return out as Extract<PageBlock, { type: "database" }>["view"];
}

/** The page with one more block, at the end; checked whole as the app's editor would save it. */
export function withBlock(p: Page, block: PageBlock): PageSpec {
  const spec: PageSpec = { ...p.spec, blocks: [...p.spec.blocks, block] };
  if (pageErrors(spec).length) throw new ToolError("bad-block");
  return spec;
}

/** A table's block with its view changed. */
export function withView(p: Page, ro: ReadStore, blockId: string, raw: unknown): PageSpec {
  const b = p.spec.blocks.find((x) => x.id === blockId);
  if (!b || b.type !== "database") throw new ToolError("no-such-block");
  const def = Object.values(ro.schema().types).find((t) => t.id === b.source);
  if (!def) throw new ToolError("unknown-type");
  const field = (d: TypeDef, name: unknown) => {
    if (name === undefined || name === null || name === "") return undefined;
    if (typeof name !== "string") throw new ToolError("bad-view");
    const f = fieldByName(d, name);
    if (!f) throw new ToolError("unknown-field");
    return f.id;
  };
  const spec: PageSpec = {
    ...p.spec,
    blocks: p.spec.blocks.map((x) =>
      x.id === blockId ? { ...b, view: viewFrom(def, raw, field) } : x,
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
    effect: "write",
    area: "pages",
    service: "pages",
    title: "Añadir bloque",
    describe:
      'Add a block at the end of one of Juan\'s pages, as he would with «/»: block {"lit": {...}} is a text ({"type": "heading" | "text" | "bullet" | "todo" | "quote" | "callout", "text": "..."}, or {"type": "divider"}), or reads a collection by its key and fields by theirs: a number {"type": "number", "collection", "measure": "count" | "sum" | "avg", "field"}, a bar list {"type": "bars", ..., "groupBy": field}, a chart {"type": "graph", ..., "groupBy": field or "@month" | "@week" | "@day", "shape": "bar" | "hbar" | "line" | "area" | "donut"} (each with "period": "month" | "30d" | "12m" | "year" | "all", "title", "filterField" and "filterValue"), or a table {"type": "database", "collection", "view": {"layout": "table" | "board" | "list" | "gallery" | "calendar", "sort": {"field", "desc"}, "group", "hide": [fields], "filter": [{"field", "op", "value"}]}}',
    args: {
      page,
      block: { role: "definition", required: true, describe: "the block" },
    },
    run(c, a, extra) {
      const s = serviceOf(c.service);
      const p = pageOf(s.store, a.page);
      const block = blockFrom(c.store, a.block ? plain(a.block) : null);
      const next = wrap(() =>
        updatePage(s.store, p.id, { spec: withBlock(p, block) }, writer(s, [a.block], extra)),
      );
      return rec({ page: pageVal(next), block: leaf(block.id, code) }, code);
    },
  });
  r.register({
    name: "pages.set_view",
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
    name: "pages.update",
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
