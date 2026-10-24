import { plannerMaySee } from "@boni/entities";
import { BODY, type Seen } from "@boni/store";
import type { From, Val } from "./values.ts";

/**
 * What of Juan's entities reached a model through some values (the audit, store's audit.ts): per entity, the
 * fields in clear, the fields seen only as their shape and the note's text. `clear` is what a reader gets (every
 * value as it is); `planner` is what `toPlannerView` lets through (a value it may not see is a handle: its shape).
 * Values carry where they came from (`from`, `refs`), so this needs no store reads but the types of bare ids.
 */
export function exposure(
  vals: readonly Val[],
  mode: "clear" | "planner",
  typeOf: (entity: string) => string | undefined,
): Seen[] {
  const by = new Map<string, Seen>();
  const at = (f: From): Seen => {
    let s = by.get(f.e);
    if (!s) {
      s = {
        entity: f.e,
        type: f.t ?? typeOf(f.e) ?? "",
        version: f.v,
        fields: [],
        shapes: [],
        body: null,
        files: [],
      };
      by.set(f.e, s);
    }
    return s;
  };
  const note = (f: From, clear: boolean) => {
    const s = at(f);
    if (f.f === BODY) {
      if (clear) s.body = "text";
      else if (s.body !== "text") s.body = "shape";
    } else if (f.f) {
      if (clear) {
        if (!s.fields.includes(f.f)) s.fields.push(f.f);
        s.shapes = s.shapes.filter((x) => x !== f.f);
      } else if (!s.fields.includes(f.f) && !s.shapes.includes(f.f)) s.shapes.push(f.f);
    }
  };
  const walk = (v: Val, clear: boolean) => {
    // The planner sees a value it may not see as a handle, all of it (view.ts).
    const c = clear && (mode === "clear" || plannerMaySee(v.label));
    if (v.t === "v") {
      if (v.from) note(v.from, c);
      for (const r of v.refs ?? []) note(r, c);
    } else for (const x of v.t === "list" ? v.items : Object.values(v.fields)) walk(x, c);
  };
  for (const v of vals) walk(v, true);
  return [...by.values()].filter((s) => s.type !== "");
}
