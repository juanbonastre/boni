/**
 * «Esta página» on the server (docs/automatizaciones.md AU-137, phase F16 S2c): the page a run's chat lives in, as
 * the engine's `PagePort`, and what the policy reads of it (`PageScope`). Both are bound to the page the stored
 * version's «Mensaje de chat» names (`chatPageOf`), read from the version the server keeps, never from a request, a
 * message or a model. A change is made with the code the page's own actions run (pageActions.ts `withValue`,
 * `withBlock`), saved by `updatePage` with the run's id, so «Deshacer lo que hizo» takes it back with the run's rows.
 */
import { deepLabel, plain, readStore, ToolError, typeByKey } from "@boni/agent";
import {
  type Automation,
  type Cell,
  chatPageOf,
  type PageChange,
  type PagePort,
} from "@boni/automations";
import { join, type Label } from "@boni/entities";
import type { OpMeta, UserStore } from "@boni/store";
import { blockFrom, namedRefs, withBlock, withValue } from "../pageActions.ts";
import { pageTypes } from "../pageChat.ts";
import { getPage, type Page, PageError, updatePage } from "../pages.ts";
import { blockFigures } from "../screen.ts";
import type { PageScope } from "./policy.ts";

/** The page a change goes to, as it is now; null: gone, or one of Boni's templates (a model never changes those). */
const pageNow = (store: UserStore, id: string): Page | null => {
  const p = getPage(store, id);
  return p && !p.template ? p : null;
};

/** The page's spec with `change` made, or why it cannot be (a ToolError's code). Nothing is saved. */
function changed(store: UserStore, p: Page, change: PageChange) {
  const ro = readStore(store);
  return change.kind === "value"
    ? withValue(p, ro, change.control, change.value)
    : withBlock(p, blockFrom(ro, namedRefs(change.block, p)));
}

const refusal = (e: unknown): string => {
  if (e instanceof ToolError) return e.code;
  if (e instanceof PageError) return e.code === "not-found" ? "no-such-page" : e.code;
  throw e;
};

/**
 * Makes one change of the page `id` with `label`, as `meta` (the run's id among them): null, or why not. A run's
 * change and an accepted one are made by this, each in its own transaction or in the caller's (`store.batch`).
 */
export function savePageChange(
  store: UserStore,
  id: string,
  change: PageChange,
  label: Label,
  meta: OpMeta,
): string | null {
  const p = pageNow(store, id);
  if (!p) return "no-such-page";
  try {
    updatePage(store, p.id, { spec: changed(store, p, change) }, { meta, label });
    return null;
  } catch (e) {
    return refusal(e);
  }
}

/** Whether a change can be made on the page `id` as it is now: null, or why not. Nothing is saved. */
export function checkPageChange(store: UserStore, id: string, change: PageChange): string | null {
  const p = pageNow(store, id);
  if (!p) return "no-such-page";
  try {
    changed(store, p, change);
    return null;
  } catch (e) {
    return refusal(e);
  }
}

/**
 * The page of a run of `doc` (AU-137): its port and its scope, bound to the page the stored «Mensaje de chat» names;
 * null when `doc` has no chat or that page is gone. `meta`: who makes its changes, with the run's id when it is one
 * for real. A change through it is made only when the policy allowed it (the engine asks first).
 */
export function pageOfRun(
  store: UserStore,
  doc: Automation | undefined,
  meta: OpMeta,
): { port: PagePort; scope: PageScope } | null {
  const page = doc ? chatPageOf(doc) : null;
  const p = page ? pageNow(store, page) : null;
  if (!page || !p) return null;
  const idOf = (key: string) => {
    try {
      return typeByKey(readStore(store), key).id;
    } catch {
      return null;
    }
  };
  const scope: PageScope = {
    page,
    types: pageTypes(store, p.spec.blocks),
    typeIdOf: (key) => idOf(key),
    relationOf(key, field) {
      const id = idOf(key);
      const f = id
        ? store.schema().types[id]?.fields.find((x) => x.key === field || x.id === field)
        : null;
      return f?.relation?.target ?? null;
    },
  };
  const port: PagePort = {
    page,
    async figures(block) {
      const v = blockFigures(store, page, block);
      return v ? { value: plain(v) as Cell, label: deepLabel(v) } : null;
    },
    async check(change) {
      return checkPageChange(store, page, change);
    },
    async apply(change, label) {
      return savePageChange(store, page, change, label, meta);
    },
  };
  return { port, scope };
}

/** The label a kept page change is saved with when it is accepted: every value it carried, as it was asked (AU-170). */
export const askedLabel = (values: Record<string, { label: Label }>, own: Label): Label => {
  const labels = Object.values(values).map((v) => v.label);
  return labels.length ? join(labels[0] as Label, ...labels.slice(1)) : own;
};
