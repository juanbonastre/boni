import { randomUUID } from "node:crypto";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import {
  emptyPage,
  PAGE_LIMITS,
  PAGE_TEMPLATES,
  type PageSpec,
  type PageTemplate,
  pageErrors,
  resolveTemplateLinks,
  templatePage,
  withoutRetired,
} from "@boni/views";
import type { V1Store } from "./v1/store.ts";

/**
 * The user's pages (docs/extensiones.md 6, plan A4): entities of the system type `page` in the user's own
 * store (versioned, undoable, exported), only ever written by this code on the user's behalf. A new account has
 * only Boni's template pages («Uso de la IA», «Actividad», «Registro»; `seedTemplates`): the start screen and the sidebar are
 * what the user makes. An account that used the first Boni gets, once, a page "Gastos" with what its fixed home
 * showed (its charts there, its capture and its shortcuts), as data it can change or delete.
 */

export interface PageInfo {
  id: string;
  title: string;
  icon: string;
  parent: string | null;
  position: number;
  updated: number;
  template?: PageTemplate;
}
export interface Page extends PageInfo {
  spec: PageSpec;
}

export class PageError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const CODE = label("own", "personal", [{ kind: "code", id: "pages" }]);
const v = (value: string) => ({ value, label: CODE });
const meta = (device?: string) => ({ actor: "system" as const, ...(device ? { device } : {}) });

function toPage(e: { id: string; values: Record<string, unknown>; updated: number }): Page {
  const x = e.values;
  let spec: PageSpec = emptyPage();
  try {
    // Blocks of a kind that is no more are left out as it is read (the stored text changes on the next save).
    const s = withoutRetired(JSON.parse(String(x.f_spec ?? "")));
    if (!pageErrors(s).length) spec = s as PageSpec;
  } catch {
    // An unreadable spec shows as an empty page; the stored text is left as it was.
  }
  return {
    id: e.id,
    title: String(x.f_title ?? ""),
    icon: String(x.f_icon ?? ""),
    parent: typeof x.f_parent === "string" && x.f_parent ? x.f_parent : null,
    position: Number(x.f_position ?? 0) || 0,
    updated: e.updated,
    ...(spec.template ? { template: spec.template } : {}),
    spec,
  };
}

const info = ({ spec: _s, ...rest }: Page): PageInfo => rest;

export function listPages(store: UserStore): PageInfo[] {
  if (!store.schema().types.page) return [];
  return store
    .list("page")
    .map((e) => info(toPage(e.entity)))
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "es"));
}

export function getPage(store: UserStore, id: string): Page | null {
  const e = store.get(id);
  return e && e.entity.type === "page" && e.entity.deleted === undefined ? toPage(e.entity) : null;
}

/** A page's name; empty is fine (the app shows it as untitled, as Notion does). */
const title = (t: unknown) => {
  if (typeof t !== "string" || t.length > PAGE_LIMITS.title) throw new PageError("bad-title");
  return t.trim();
};

export function createPage(
  store: UserStore,
  input: { title?: unknown; parent?: unknown; spec?: unknown },
  device?: string,
): Page {
  const t = title(input.title ?? "");
  const parent =
    typeof input.parent === "string" && getPage(store, input.parent) ? input.parent : "";
  const spec = input.spec ?? emptyPage();
  if (pageErrors(spec).length) throw new PageError("bad-spec");
  const last = listPages(store).reduce((m, p) => Math.max(m, p.position), 0);
  const made = store.create(
    "page",
    {
      f_title: v(t),
      f_icon: v(""),
      f_parent: v(parent),
      f_position: v(String(last + 1)),
      f_spec: v(JSON.stringify(spec)),
    },
    meta(device),
  );
  return toPage(made.entity);
}

export function updatePage(
  store: UserStore,
  id: string,
  input: { title?: unknown; icon?: unknown; parent?: unknown; position?: unknown; spec?: unknown },
  device?: string,
): Page {
  if (!getPage(store, id)) throw new PageError("not-found");
  const w: Record<string, ReturnType<typeof v>> = {};
  if (input.title !== undefined) w.f_title = v(title(input.title));
  if (input.icon !== undefined) {
    // One emoji (a few code points when joined, as 👩‍🏫); shown only as text.
    if (typeof input.icon !== "string" || [...input.icon].length > 8 || /[<>&]/.test(input.icon))
      throw new PageError("bad-icon");
    w.f_icon = v(input.icon);
  }
  if (input.parent !== undefined) {
    const p = input.parent === null ? "" : input.parent;
    if (typeof p !== "string" || (p && (!getPage(store, p) || below(store, p, id))))
      throw new PageError("bad-parent");
    w.f_parent = v(p);
  }
  if (input.position !== undefined) {
    if (typeof input.position !== "number" || !Number.isFinite(input.position))
      throw new PageError("bad-position");
    w.f_position = v(String(input.position));
  }
  if (input.spec !== undefined) {
    if (pageErrors(input.spec).length) throw new PageError("bad-spec");
    w.f_spec = v(JSON.stringify(input.spec));
  }
  const e = store.update(id, w, meta(device));
  return toPage(e.entity);
}

/** Whether `page` is `root` or under it (a page never moves under itself). */
function below(store: UserStore, page: string, root: string): boolean {
  const all = listPages(store);
  const seen = new Set<string>();
  for (let at: string | null = page; at && !seen.has(at); ) {
    if (at === root) return true;
    seen.add(at);
    at = all.find((x) => x.id === at)?.parent ?? null;
  }
  return false;
}

/** To the trash (Undo brings it back); its subpages move up to its parent. */
export function removePage(store: UserStore, id: string, device?: string): void {
  const p = getPage(store, id);
  if (!p) throw new PageError("not-found");
  for (const c of listPages(store).filter((x) => x.parent === id))
    store.update(c.id, { f_parent: v(p.parent ?? "") }, meta(device));
  store.remove(id, meta(device));
}

/** The trash: pages removed, the latest first (Notion's Trash; restore brings one back). */
export function listTrash(store: UserStore): (PageInfo & { deleted: number })[] {
  if (!store.schema().types.page) return [];
  return store
    .list("page", { includeDeleted: true })
    .filter((e) => e.entity.deleted !== undefined)
    .map((e) => ({ ...info(toPage(e.entity)), deleted: Number(e.entity.deleted) || 0 }))
    .sort((a, b) => b.deleted - a.deleted)
    .slice(0, 200);
}

/** Undo of a removal: the page back from the trash (its subpages stay where they moved). */
export function restorePage(store: UserStore, id: string, device?: string): Page {
  const e = store.get(id);
  if (!e || e.entity.type !== "page" || e.entity.deleted === undefined)
    throw new PageError("not-found");
  store.restore(id, meta(device));
  return getPage(store, id) as Page;
}

/**
 * Once per account: what the first Boni's fixed home showed becomes a page "Gastos" (its charts on the
 * home, the capture and the account's shortcuts). Nothing for an account that never used it.
 */
export function seedFromV1(store: UserStore, v1: V1Store, account: number): void {
  if (!store.schema().types.page || store.setting("pages/seeded")) return;
  store.setSetting("pages/seeded", String(Date.now()));
  if (!v1.used(account)) return;
  const ok = (x: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(x);
  const charts = v1.charts(account).filter((c) => c.home && ok(c.id));
  const shortcuts = v1.shortcuts(account).filter((x) => ok(x.id) && ok(x.screen));
  if (!charts.length && !shortcuts.length) return;
  const id = () => randomUUID().slice(0, 8);
  createPage(store, {
    title: "Gastos",
    spec: {
      version: 1,
      full: true,
      blocks: [
        { id: id(), type: "action", screen: "capture-expense", label: "Apuntar gasto" },
        ...shortcuts.map((s) => ({
          id: id(),
          type: "action" as const,
          screen: s.screen,
          label: s.label.slice(0, PAGE_LIMITS.label) || "Atajo",
          shortcut: s.id,
        })),
        ...charts.map((c) => ({ id: id(), type: "chart" as const, chart: c.id })),
      ],
    },
  });
}

/**
 * Once per account and template: Boni's pages over its own records. The old single marker means the first two were
 * already offered; only «Registro» is added to those accounts. A removed template never comes back by itself.
 */
export function seedTemplates(store: UserStore): void {
  if (!store.schema().types.page) return;
  const legacy = store.setting("pages/templates") !== null;
  const now = String(Date.now());
  if (!legacy) store.setSetting("pages/templates", now);
  for (const name of PAGE_TEMPLATES) {
    if (legacy && name !== "registro") continue;
    const marker = `pages/template/${name}`;
    if (store.setting(marker)) continue;
    store.setSetting(marker, now);
    const t = templatePage(name);
    const spec = resolveTemplateLinks(t.spec, listPages(store));
    const p = createPage(store, { title: t.title, spec });
    updatePage(store, p.id, { icon: t.icon });
  }
  migrateTemplateLinks(store);
}

/** The fixed destinations retired with ActivityView become real page links (or go away) once, without touching others. */
function migrateTemplateLinks(store: UserStore): void {
  const pages = listPages(store);
  for (const info of pages) {
    const page = getPage(store, info.id);
    if (!page?.template) continue;
    const blocks = page.spec.blocks
      .filter(
        (b) =>
          !(
            b.type === "link" &&
            ((b.id === "a8" && b.to === "audit") || (b.id === "u8" && b.to === "settings-models"))
          ),
      )
      .map((b) =>
        b.type === "link" && b.id === "a7" && b.to === "activity" ? { ...b, to: "registro" } : b,
      );
    const spec = resolveTemplateLinks({ ...page.spec, blocks }, pages);
    if (JSON.stringify(spec) !== JSON.stringify(page.spec)) updatePage(store, page.id, { spec });
  }
}
