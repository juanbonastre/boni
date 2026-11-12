import { lastDay } from "./dates.ts";
import type { DatabaseFilter, FilterItem, PageBlock } from "./page.ts";

/**
 * A page's values (docs/sistema.md §4.6, F11; D-59), as a Grafana dashboard's variables: each «Control» block of a
 * page is one value, with its name, its kind and what it holds now, saved with the page (the same on every device,
 * like its views). A data block names one in its filter or its period by `$<the control's id>`, a table's rule by
 * `from`, a link passes them to another page by `pass`; the code reads them here, never a model. An empty value
 * filters nothing (all rows, Grafana's «All»); a name that is not a control of the page is the block's problem.
 */

/** A value's kinds: an option of a list (a select's, or a record a relation points to), a month, a number, a text. */
export const CONTROL_KINDS = ["option", "month", "number", "text"] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

/** A «Control» block: one value of the page, shown as a control. */
export interface ControlBlock {
  id: string;
  type: "control";
  name: string;
  kind: ControlKind;
  /** An option's: the collection and the field (a select, or a relation) its choices are the options (or records) of. */
  collection?: string;
  field?: string;
  /** What it holds now: an option's or a record's id, "YYYY-MM", a number or a text; none, everything. */
  value?: string | number;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The longest text a value holds. */
export const VALUE_MAX = 200;

/** The control a setting names (`$<id>`), or null when it names none. */
export function refOf(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("$") && ID.test(v.slice(1)) ? v.slice(1) : null;
}
export const refTo = (id: string) => `$${id}`;

/** Whether a value fits a kind (what a control may hold, and what a link may pass to it). */
export function controlValueOk(kind: unknown, v: unknown): boolean {
  switch (kind) {
    case "option":
      return typeof v === "string" && ID.test(v);
    case "month":
      return typeof v === "string" && MONTH.test(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "text":
      return typeof v === "string" && v.length <= VALUE_MAX;
    default:
      return false;
  }
}

/** A page's controls, in its order. */
export const controlsOf = (blocks: readonly PageBlock[]): ControlBlock[] =>
  blocks.filter((b): b is PageBlock & ControlBlock => b.type === "control");

/**
 * The controls a block reads (its ids, in the block's order, once each): a data block's filter and period, a table's
 * rules, a link's or a button's values. The map draws them as the values that control it (docs/sistema.md §4.6
 * point 7); a name that is no control of the page is the block's problem (`valueRefErrors`), not one of these.
 */
export function controlsOfBlock(b: PageBlock, blocks: readonly PageBlock[]): string[] {
  const refs: unknown[] = [];
  if (b.type === "number" || b.type === "bars" || b.type === "graph")
    refs.push(b.filterValue, b.period);
  if (b.type === "database")
    for (const x of b.view.filter ?? [])
      for (const r of "rules" in x ? x.rules : [x])
        if (r.from !== undefined) refs.push(refTo(r.from));
  if (b.type === "link") refs.push(...Object.values(b.pass ?? {}));
  if (b.type === "action")
    refs.push(
      b.record,
      ...Object.values(b.set ?? {}),
      ...Object.values(b.inputs ?? {}),
      ...Object.values(b.pass ?? {}),
    );
  const ids = new Set(controlsOf(blocks).map((c) => c.id));
  return [...new Set(refs.map(refOf).filter((r): r is string => !!r && ids.has(r)))];
}

/** What a control holds now, when it holds something (an empty text is nothing). */
export function heldValue(c: ControlBlock | undefined): string | number | undefined {
  const v = c?.value;
  if (v === undefined || v === "" || !controlValueOk(c?.kind, v)) return undefined;
  return v;
}

/** A month as the dates it spans, both included. */
export function monthRange(m: string): { start: string; end: string } {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return { start: `${m}-01`, end: lastDay(y, mo) };
}

/**
 * A table's rules with the page's values in them: a rule `from` a control takes what it holds; with nothing, the rule
 * is left out (and a group left with no rule, too), so an empty control filters nothing.
 */
export function rulesWithValues(
  items: readonly FilterItem[],
  controls: readonly ControlBlock[],
): FilterItem[] {
  const rule = (r: DatabaseFilter): DatabaseFilter | null => {
    if (r.from === undefined) return r;
    const v = heldValue(controls.find((c) => c.id === r.from));
    if (v === undefined) return null;
    const { from: _f, ...rest } = r;
    return { ...rest, value: v };
  };
  return items.flatMap((x): FilterItem[] => {
    if (!("rules" in x)) {
      const r = rule(x);
      return r ? [r] : [];
    }
    const rules = x.rules.map(rule).filter((r): r is DatabaseFilter => r !== null);
    return rules.length ? [{ ...x, rules }] : [];
  });
}

/**
 * What a link gives the page it opens, by that page's control ids: a value of its own, or what a control of this
 * page holds (`$<id>`; null when it holds nothing, so the other page's is emptied too).
 */
export function passedValues(
  pass: Readonly<Record<string, string | number>> | undefined,
  controls: readonly ControlBlock[],
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [to, v] of Object.entries(pass ?? {})) {
    const ref = refOf(v);
    out[to] = ref ? (heldValue(controls.find((c) => c.id === ref)) ?? null) : v;
  }
  return out;
}

/**
 * A page's blocks with the values a link brought: each control named takes its value when it fits its kind (null
 * empties it); anything else is left as it was. `changed` says whether the page has to be saved.
 */
export function withPassed(
  blocks: readonly PageBlock[],
  values: Readonly<Record<string, string | number | null>>,
): { blocks: PageBlock[]; changed: boolean } {
  let changed = false;
  const out = blocks.map((b) => {
    if (b.type !== "control" || !(b.id in values)) return b;
    const v = values[b.id];
    if (v === null || v === undefined) {
      if (b.value === undefined) return b;
      changed = true;
      const { value: _v, ...rest } = b;
      return rest as PageBlock;
    }
    if (!controlValueOk(b.kind, v) || b.value === v) return b;
    changed = true;
    return { ...b, value: v } as PageBlock;
  });
  return { blocks: out, changed };
}

/**
 * What a page's blocks name of its controls that is not there, or not of the kind it needs: a data block's filter
 * an option control of its field, its period a month control; a table's rule any control; a link's value one of
 * this page's. Empty when every name is a control that fits.
 */
export function valueRefErrors(blocks: readonly PageBlock[]): string[] {
  const controls = new Map(controlsOf(blocks).map((c) => [c.id, c]));
  const errors: string[] = [];
  blocks.forEach((b, i) => {
    const w = `blocks[${i}]`;
    if (b.type === "number" || b.type === "bars" || b.type === "graph") {
      const f = refOf(b.filterValue);
      const fc = f ? controls.get(f) : undefined;
      if (
        f &&
        (!fc ||
          fc.kind !== "option" ||
          fc.collection !== b.collection ||
          fc.field !== b.filterField)
      )
        errors.push(`${w}: filterValue names no option control of its field`);
      const p = refOf(b.period);
      if (p && controls.get(p)?.kind !== "month")
        errors.push(`${w}: period names no month control`);
    }
    if (b.type === "database")
      for (const x of b.view.filter ?? [])
        for (const r of "rules" in x ? x.rules : [x])
          if (r.from !== undefined && !controls.has(r.from))
            errors.push(`${w}: a rule names no control of the page`);
    if (b.type === "link")
      for (const v of Object.values(b.pass ?? {})) {
        const r = refOf(v);
        if (r && !controls.has(r)) errors.push(`${w}: pass names no control of the page`);
      }
    if (b.type === "action") {
      // A button's record is what an option control holds; its other values may name any control (buttons.ts).
      const rec = refOf(b.record);
      if (b.record !== undefined && (!rec || controls.get(rec)?.kind !== "option"))
        errors.push(`${w}: record names no option control of the page`);
      for (const [key, args] of [
        ["set", b.set],
        ["inputs", b.inputs],
        ["pass", b.pass],
      ] as const)
        for (const v of Object.values(args ?? {})) {
          const r = refOf(v);
          if (r && !controls.has(r)) errors.push(`${w}: ${key} names no control of the page`);
        }
    }
  });
  return errors;
}
