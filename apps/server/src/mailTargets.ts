/**
 * The collections a mail may propose into («targets»), as the mail plan needs them: the field a due day goes to,
 * the examples each option shows and the fields to fill, kept per store while nothing each reads changes (task 43:
 * each check of the mailbox read every record of each, 0.66 s on the NAS; and on 2026-11-04 one record changed
 * in any of them made every target read again, his Agenda's 2,805 among them, 0.55–0.9 s each time a mail was
 * read). A target has two parts, each remembered on its own: its own (due field, examples) follows its own
 * records; its fields to fill follow the collections those fields point to. The schema, the levels or the rules
 * changing starts all over.
 */
import { FILL_LIMITS, type FillField, type From, readStore } from "@boni/agent";
import { type FieldDef, rolesOf, type TypeDef } from "@boni/entities";
import type { UserStore } from "@boni/store";
import type { Prefill } from "./prefill.ts";

/** A collection tasks may go to, as the plan names it. */
export interface Target {
  /** The type's id (a guide rule names it). */
  id?: string;
  key: string;
  name: string;
  /** The option the reader sees: the name and a few of Juan's own titles in it, so it knows what goes there. */
  option: string;
  /** The date field a task's due day goes to (`dueField`; none: the day is left out). */
  date: string | null;
  /** The fields playing `time` and `endTime` (docs/clases.md §6), where the mail's times go; none: left out. */
  time?: string | null;
  endTime?: string | null;
  /** Its fields with a closed set of values, filled per item by the reader `fill` (docs/extensiones.md 9). */
  fill?: FillField[];
  /** The name the code binds `fill` to in the plan (`$fields_<n>`). */
  fillRef?: string;
  /** The entries whose titles `option` names, and those `fill` offers: the audit says a model saw them. */
  optionRefs?: From[];
  fillRefs?: From[];
  /** Relations the mail plainly names, set by code for this mail (prefill.ts; task 51): the reader's choice first. */
  prefill?: Prefill[];
  /** The name the code binds them to in the plan (`$prefill_<n>`: each key, the record's id, labelled the code's). */
  prefillRef?: string;
}

export const RELATION_CHOICES = 40;

/**
 * What the reader `fill` may set in a collection (Juan, 2026-10-23: proposals with their columns filled): a
 * select's options, the entries a relation may point to (of a collection the models may see, the latest
 * changed, titled by Juan or his import, nothing sensitive) and checkboxes. Never the title or the date (the
 * reading gives them), hidden, archived, sensitive or Boni's own fields.
 */
export function fillFields(
  ro: ReturnType<typeof readStore>,
  t: TypeDef,
  date: string | null,
  refs: From[] = [],
): FillField[] {
  const types = ro.schema().types;
  const out: FillField[] = [];
  for (const f of t.fields) {
    if (out.length >= FILL_LIMITS.fields) break;
    if (f.id === t.titleField || f.key === date || f.hidden || f.archived) continue;
    if (
      f.sensitivity === "sensitive" ||
      f.key.startsWith("boni") ||
      !/^[a-z0-9_-]{1,64}$/i.test(f.key)
    )
      continue;
    const name = f.name.slice(0, FILL_LIMITS.label);
    if (f.type === "checkbox") out.push({ key: f.key, name, kind: "check", options: [] });
    else if (f.type === "select" && f.options?.length)
      out.push({
        key: f.key,
        name,
        kind: "choice",
        options: f.options
          .filter((o) => o.name.trim())
          .slice(0, FILL_LIMITS.options)
          .map((o) => ({ value: o.id, label: o.name.slice(0, FILL_LIMITS.label) })),
      });
    else if (f.type === "relation" && f.relation && !f.relation.many) {
      const target = types[f.relation.target];
      if (!target || target.system || target.archived) continue;
      const seen = new Set<string>();
      const options = ro
        .list(target.id)
        .filter((e) => {
          const l = e.labels[target.titleField];
          const title = e.entity.values[target.titleField];
          return (
            typeof title === "string" &&
            title.trim() !== "" &&
            l !== undefined &&
            !l.noModel &&
            (l.integrity === "user" || l.integrity === "own" || l.integrity === "imported") &&
            l.sensitivity !== "sensitive"
          );
        })
        .sort((a, b) => b.entity.updated - a.entity.updated)
        .flatMap((e) => {
          const label = String(e.entity.values[target.titleField])
            .replace(/\s+/g, " ")
            .slice(0, FILL_LIMITS.label);
          if (seen.has(label)) return [];
          seen.add(label);
          return [{ value: e.entity.id, label, at: e.entity.version }];
        })
        .slice(0, Math.min(RELATION_CHOICES, FILL_LIMITS.options));
      for (const o of options)
        refs.push({ e: o.value, v: o.at, f: target.titleField, t: target.id });
      if (options.length)
        out.push({
          key: f.key,
          name,
          kind: "choice",
          options: options.map(({ value, label }) => ({ value, label })),
        });
    }
  }
  return out.filter((f) => f.kind === "check" || f.options.length > 0);
}

/** Fewer values than this say nothing about what a date field holds. */
const EVIDENCE = 3;
const DAY_MS = 86_400_000;

/**
 * The date field of a collection a due day goes to, judged by its data, never by its name (no field is
 * special to Boni): a field some of whose days fall after the day its item was recorded holds days ahead
 * (a due day, a meeting, a project's end), the one with most such days wins; a field with enough values and
 * none after that day only records what already happened (when a note was made, last reviewed, a birthday
 * written down) and never gets a due day. With no field of the first kind, the first one without enough
 * values to tell (a new collection); otherwise none. "After" means more than a day after the instant it was
 * stored, so a day written in another time zone is not taken for one ahead.
 */
export function dueField(
  type: TypeDef,
  entities: readonly { values: Record<string, unknown>; created: number }[],
): FieldDef | null {
  const dates = type.fields.filter((f) => f.type === "date" && !f.archived && !f.hidden);
  let best: FieldDef | null = null;
  let most = 0;
  let unknown: FieldDef | null = null;
  for (const f of dates) {
    let n = 0;
    let ahead = 0;
    for (const e of entities) {
      const v = e.values[f.id];
      if (typeof v !== "string") continue;
      const at = Date.parse(`${v}T00:00:00Z`);
      if (Number.isNaN(at)) continue;
      n++;
      if (at - e.created > DAY_MS) ahead++;
    }
    if (ahead > most) [best, most] = [f, ahead];
    else if (!ahead && n < EVIDENCE && !unknown) unknown = f;
  }
  return best ?? unknown;
}

/** The latest records looked at for a collection's three examples: enough, without reading every label. */
const EXAMPLE_CANDIDATES = 40;

interface OwnPart {
  date: FieldDef | null;
  examples: { id: string; version: number; title: string }[];
}
interface FillPart {
  dateKey: string | null;
  fields: FillField[];
  refs: From[];
  /** The collections its relation fields point to: a change in one of them makes this part again. */
  watch: string[];
}
interface Memo {
  key: string;
  version: number;
  own: Map<string, OwnPart>;
  fill: Map<string, FillPart>;
}

type View = ReturnType<typeof readStore>;

export class TargetMemo {
  private memos = new WeakMap<UserStore, Memo>();

  /** The targets for `ids`, each from its remembered parts, made again only where something they read changed. */
  targetsFor(store: UserStore, ids: readonly string[]): Target[] {
    const memo = this.current(store);
    const schema = store.schema();
    const levels = store.aiAccess();
    let ro: View | null = null;
    const view = () => {
      if (!ro) ro = readStore(store);
      return ro;
    };
    // A collection closed to the models is no target at all (the view's schema leaves it out, R3).
    const shown = view().schema().types;
    return ids.flatMap((id) => {
      const t = shown[id];
      if (!t || t.archived || t.system) return [];
      const opaque = levels[id] === "opaque";
      let own = memo.own.get(id);
      if (!own) {
        own = ownPart(store, view, t, opaque);
        memo.own.set(id, own);
      }
      const dateKey = own.date?.key ?? null;
      let fill = memo.fill.get(id);
      if (!fill || fill.dateKey !== dateKey) {
        fill = opaque ? { dateKey, fields: [], refs: [], watch: [] } : fillPart(view(), t, dateKey);
        memo.fill.set(id, fill);
      }
      const titles = own.examples.map((e) => e.title);
      const option = titles.length ? `${t.name} (p. ej.: ${titles.join("; ")})` : t.name;
      const roles = rolesOf(schema, id);
      const keyOf = (fid: string | undefined) =>
        fid ? (t.fields.find((f) => f.id === fid)?.key ?? null) : null;
      return [
        {
          id: t.id,
          key: t.key,
          name: t.name,
          option: option.slice(0, 200),
          date: dateKey,
          time: keyOf(roles.time),
          endTime: keyOf(roles.endTime),
          optionRefs: own.examples.map((e) => ({
            e: e.id,
            v: e.version,
            f: t.titleField,
            t: t.id,
          })),
          ...(fill.fields.length ? { fill: fill.fields, fillRefs: fill.refs } : {}),
        },
      ];
    });
  }

  /** The store's memo, its parts that read something changed since last time dropped. */
  private current(store: UserStore): Memo {
    const key = JSON.stringify([store.aiAccess(), store.aiRules()]);
    const version = store.version();
    let m = this.memos.get(store);
    if (!m || m.key !== key) {
      m = { key, version, own: new Map(), fill: new Map() };
      this.memos.set(store, m);
      return m;
    }
    if (m.version === version) return m;
    const ch = store.changesSince(m.version);
    if (ch.schemaChanged) {
      m.own.clear();
      m.fill.clear();
    } else {
      const changed = new Set(ch.entities.map((e) => e.entity.type));
      for (const id of [...m.own.keys()]) if (changed.has(id)) m.own.delete(id);
      for (const [id, f] of [...m.fill]) if (f.watch.some((x) => changed.has(x))) m.fill.delete(id);
    }
    m.version = version;
    return m;
  }
}

/**
 * A collection's own part: the field its due days go to (from every record's values, no labels read) and up to
 * three of its latest titles the models may see (only those are read with their labels, through the view).
 */
function ownPart(store: UserStore, view: () => View, t: TypeDef, opaque: boolean): OwnPart {
  const all = store.entities(t.id);
  const date = dueField(t, all);
  const examples: OwnPart["examples"] = [];
  if (!opaque) {
    const latest = [...all]
      .sort((a, b) => b.updated - a.updated || b.created - a.created)
      .slice(0, EXAMPLE_CANDIDATES);
    for (const e of latest) {
      if (examples.length >= 3) break;
      const s = view().get(e.id);
      const l = s?.labels[t.titleField];
      const title = s?.entity.values[t.titleField];
      if (
        !s ||
        typeof title !== "string" ||
        l === undefined ||
        l.noModel ||
        !(l.integrity === "user" || l.integrity === "own" || l.integrity === "imported") ||
        l.sensitivity === "sensitive"
      )
        continue;
      examples.push({
        id: e.id,
        version: e.version,
        title: title.replace(/\s+/g, " ").slice(0, 40),
      });
    }
  }
  return { date, examples };
}

/** A collection's fields to fill, and which collections they read (its relations' targets). */
function fillPart(ro: View, t: TypeDef, dateKey: string | null): FillPart {
  const refs: From[] = [];
  const fields = fillFields(ro, t, dateKey, refs);
  const watch = [
    ...new Set(
      t.fields.flatMap((f) =>
        f.type === "relation" && f.relation?.target ? [f.relation.target] : [],
      ),
    ),
  ];
  return { dateKey, fields, refs, watch };
}
