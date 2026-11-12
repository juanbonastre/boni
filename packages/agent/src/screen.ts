// Boni over the screen (docs/sistema.md §4.7, F9): opening, scrolling to, highlighting and filtering on the user's screen, as actions of the one list.
import type { FieldDef } from "@boni/entities";
import { type DatabaseFilter, FILTER_OPS } from "@boni/views";
import { OPEN_PLACES } from "./plan.ts";
import {
  fieldByName,
  optionFor,
  type ReadStore,
  ToolError,
  type ToolRegistry,
  typeByKey,
  typeName,
} from "./tools.ts";
import { asKey, codeLabel, leaf, list, plain, rec, type Val } from "./values.ts";

/**
 * What Boni does on the screen is said, not clicked: each action gives the app what to do (what to open, where to
 * scroll, what to light, how to filter the view) and the app does it once, when the turn comes (`apps/boni-web`
 * `screenActs`). Nothing is written: the store does not change, and a filter lasts while it is on screen. Only from
 * Juan's own turn, and nothing from outside chooses it (P22). What a call names on the screen is what a tool or the
 * screen gave (its `at`, the code's own key), never a model's own id.
 */

/** Things lit at once, at most (as many as can be pointed at in one message). */
export const MAX_LIT = 20;
/** Rules one filter may have. */
const MAX_RULES = 10;

const code = codeLabel("screen");
const own = (v: Val | undefined): string | null =>
  v?.t === "v" && v.label.integrity === "own" && typeof v.value === "string" && v.value
    ? v.value
    : null;

/**
 * Where something is on the screen, by the key the app finds it by (`data-boni-ref`): the screen's own `at`, or a
 * record a tool gave by its id. Null for anything else (a model's own text, something from outside).
 */
export function screenKey(v: Val): string | null {
  if (v.t !== "rec") return null;
  const at = own(v.fields.at);
  if (at) return at;
  const id = own(v.fields.id);
  return id ? `row:${id}` : null;
}
/** What a lit thing is called, for the conversation's line: its title or its name, as the value it is. */
const nameOf = (v: Val): Val => {
  if (v.t !== "rec") return leaf(null, code);
  return v.fields.title ?? v.fields.name ?? v.fields.titulo ?? leaf(null, code);
};
const targets = (v: Val | undefined): Val[] => {
  if (!v) throw new ToolError("bad-argument");
  const all = v.t === "list" ? v.items : [v];
  if (!all.length || all.length > MAX_LIT) throw new ToolError("bad-argument");
  return all;
};
const lit = (vs: Val[]) => {
  const keys = vs.map((x) => {
    const k = screenKey(x);
    if (!k) throw new ToolError("target-not-from-the-screen");
    return k;
  });
  return {
    at: list(
      [...new Set(keys)].map((k) => leaf(k, code)),
      code,
    ),
    names: list(vs.map(nameOf), code),
  };
};

/** A value of a rule as the view keeps it: an option by its id, a related record by its id. */
function ruleValue(store: ReadStore, f: FieldDef, v: unknown): string | number {
  if (typeof v !== "string" && typeof v !== "number") throw new ToolError("unknown-value");
  if (f.type === "select" || f.type === "multiselect") {
    const id = optionFor(f, v);
    if (!f.options?.some((o) => o.id === id)) throw new ToolError("unknown-value");
    return id as string;
  }
  if (f.type === "relation" && f.relation) {
    const target = f.relation.target;
    const s = typeof v === "string" ? store.get(v) : null;
    if (s && s.entity.type === target) return s.entity.id;
    const def = store.schema().types[target];
    const want = asKey(String(v));
    const found = store
      .search(String(v), { type: target, limit: 10 })
      .map((id) => store.get(id))
      .find((x) => x && def && asKey(String(x.entity.values[def.titleField] ?? "")) === want);
    if (!found) throw new ToolError("unknown-value");
    return found.entity.id;
  }
  if (typeof v === "string" && v.length > 200) throw new ToolError("bad-argument");
  return v;
}
const TEXT = new Set(["text", "longtext", "url", "email", "phone"]);
const LISTS = new Set(["multiselect", "relation", "dates"]);
const NO_VALUE = new Set(["empty", "not_empty", "checked", "unchecked"]);
const DAYS = new Set(["date", "datetime", "dates"]);
const NUMBERS = new Set(["number", "money", "duration"]);
/** Whether an operation fits a field's type and its value's form: a day for «before», a number for «gt»… */
function fits(f: FieldDef, op: string, value: unknown): boolean {
  if (op === "checked" || op === "unchecked") return f.type === "checkbox";
  if (op === "before" || op === "after")
    return DAYS.has(f.type) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
  if (op === "gt" || op === "lt")
    return (
      NUMBERS.has(f.type) && (typeof value === "number" || /^-?\d+(\.\d+)?$/.test(String(value)))
    );
  return true;
}

/**
 * A filter as the model writes it, by field names: `{"categoria": "Restaurantes", "fecha": {"after": "2026-09-30",
 * "before": "2026-11-01"}}` (a value alone is «is», «contains» for text and lists), into the view's rules, by ids.
 */
export function filterRules(
  store: ReadStore,
  collection: string,
  where: unknown,
): DatabaseFilter[] {
  const def = typeByKey(store, collection);
  if (!where || typeof where !== "object" || Array.isArray(where))
    throw new ToolError("bad-argument");
  const rules: DatabaseFilter[] = [];
  for (const [name, spec] of Object.entries(where as Record<string, unknown>)) {
    const f = fieldByName(def, name);
    if (!f) throw new ToolError("unknown-field");
    const ops: [string, unknown][] =
      spec && typeof spec === "object" && !Array.isArray(spec)
        ? Object.entries(spec as Record<string, unknown>)
        : [[TEXT.has(f.type) || LISTS.has(f.type) ? "contains" : "is", spec]];
    for (const [op, value] of ops) {
      if (!(FILTER_OPS as readonly string[]).includes(op)) throw new ToolError("unknown-op");
      // «octubre» as a day, «before» on a text: refused, never a filter that quietly shows nothing.
      if (!fits(f, op, value)) throw new ToolError("bad-value");
      rules.push(
        NO_VALUE.has(op)
          ? { field: f.id, op: op as DatabaseFilter["op"] }
          : { field: f.id, op: op as DatabaseFilter["op"], value: ruleValue(store, f, value) },
      );
    }
  }
  if (!rules.length || rules.length > MAX_RULES) throw new ToolError("bad-argument");
  return rules;
}

/** The screen's actions, added to a registry (the core's, `coreTools`). */
export function withScreenActions(r: ToolRegistry): ToolRegistry {
  const caption = { role: "content" as const, describe: "a few words for the conversation" };
  r.register({
    name: "screen.open",
    effect: "screen",
    area: "screen",
    title: "Abrir",
    describe:
      'Open ONE thing on the user\'s screen, lit: a collection (its key from "schema"), a record (a record a tool or "screen" gave, whole), a place ("inbox", "flows", "log" or "data"), a run (a run\'s id as a tool gave it) or a flow (its id); map: true opens it on the map of «Flujos» («Ver en el mapa»: a run drawn on it with the step that stopped it lit). When he asks to open, show or go to something',
    args: {
      collection: { role: "type", describe: "a collection's key" },
      record: { role: "entity", describe: "a record a tool or the screen gave, whole" },
      place: { role: "option", describe: '"inbox", "flows", "log" or "data"' },
      run: { role: "target", describe: "a run's id, as a tool gave it" },
      flow: { role: "option", describe: 'a flow\'s id (input "flows", a tool or the screen)' },
      map: { role: "value", describe: "true: on the map («Ver en el mapa»)" },
      caption,
    },
    run(c, a) {
      const named = ["collection", "record", "place", "run", "flow"].filter((k) => a[k]);
      if (named.length !== 1) throw new ToolError("open-one-thing");
      const out: Record<string, Val> = {};
      if (a.collection) {
        const key = plain(a.collection);
        if (typeof key !== "string") throw new ToolError("bad-argument");
        // By the name the models and the app know it by.
        out.collection = leaf(typeName(typeByKey(c.store, key)), a.collection.label);
      }
      if (a.record) {
        if (a.record.t !== "rec" || !own(a.record.fields.id))
          throw new ToolError("record-not-from-a-tool");
        out.record = a.record;
      }
      if (a.place) {
        const place = plain(a.place);
        if (!(OPEN_PLACES as readonly unknown[]).includes(place))
          throw new ToolError("unknown-place");
        out.place = a.place;
      }
      if (a.run) {
        if (!own(a.run)) throw new ToolError("run-not-from-a-tool");
        out.run = a.run;
      }
      if (a.flow) {
        const id = plain(a.flow);
        if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id))
          throw new ToolError("bad-argument");
        out.flow = a.flow;
      }
      if (a.map) {
        const m = plain(a.map);
        if (m === true || m === "true") out.map = leaf(true, a.map.label);
        if (a.place) throw new ToolError("bad-argument");
      }
      if (a.caption) out.caption = a.caption;
      return rec(out, code);
    },
  });
  r.register({
    name: "screen.scroll",
    effect: "screen",
    area: "screen",
    title: "Desplazar",
    describe:
      'Scroll the user\'s screen to something on it (a value of "screen" whole: a row, a block, a paragraph, a step) or a record a tool gave, and light it for a moment',
    args: {
      target: { role: "target", required: true, describe: 'what "screen" or a tool gave, whole' },
    },
    run(_c, a) {
      const [first] = targets(a.target);
      return rec(lit([first as Val]), code);
    },
  });
  r.register({
    name: "screen.highlight",
    effect: "screen",
    area: "screen",
    title: "Resaltar",
    describe: `Light on the user's screen what he should look at: a value of "screen" or a record a tool gave, or a list of them (up to ${MAX_LIT}); it goes away on its own`,
    args: {
      target: {
        role: "target",
        required: true,
        describe: 'what "screen" or a tool gave, whole, or a list of them',
      },
    },
    run(_c, a) {
      return rec(lit(targets(a.target)), code);
    },
  });
  r.register({
    name: "screen.filter",
    effect: "screen",
    area: "screen",
    title: "Filtrar",
    describe:
      'Open a collection on the user\'s screen filtered, for as long as he looks at it (nothing is saved; he keeps it with «Guardar»). where: {"lit": {field: value, field: {"op": value}}}, by field names and option names; ops: is, is_not, contains, not_contains, before, after (dates "YYYY-MM-DD"), gt, lt, empty, not_empty, checked, unchecked',
    args: {
      collection: { role: "type", required: true, describe: "a collection's key" },
      where: {
        role: "definition",
        required: true,
        describe: "the rules, by field names: a value, or an object of op to value",
      },
      caption,
    },
    run(c, a) {
      const key = a.collection ? plain(a.collection) : null;
      if (typeof key !== "string" || !a.where) throw new ToolError("bad-argument");
      const def = typeByKey(c.store, key);
      const rules = filterRules(c.store, key, plain(a.where));
      return rec(
        {
          collection: leaf(typeName(def), a.collection?.label ?? code),
          rules: leaf(rules as never, a.where.label),
          ...(a.caption ? { caption: a.caption } : {}),
        },
        code,
      );
    },
  });
  return r;
}
