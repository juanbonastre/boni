/**
 * A reshape of an account's tree (docs/clases.md §7, step 5): new collections, records moved into them keeping their
 * ids and every value, collections put inside others, Boni Calendar's calendars pointed at a branch split by a
 * field, and what is left empty or no longer needed archived or sent to the trash. The plan is data, in the account's
 * own words (nothing of them in code, D-14); a dry run says what it would do, with counts only (never a record's
 * content), and the real one is one run in one transaction, undone whole (`undoReshape`).
 */
import { randomUUID } from "node:crypto";
import { branch, type FieldDef, type Label, label, type TypeDef } from "@boni/entities";
import { type AiLevel, levelRank, type OpMeta, type UserStore, type Writes } from "@boni/store";
import {
  CALENDAR_DEFS,
  calendarDefs,
  type Make,
  saveCalendarDefs,
  type Where,
} from "./calendarStore.ts";
import { keyFrom } from "./data.ts";
import { listPages } from "./pages.ts";

/** A record named by its title in a collection (an area for a calendar, say). */
export interface RecordRef {
  title: string;
  in: string;
}

export interface ReshapePlan {
  /** New collections, made in order (a mother before her daughters). */
  collections?: {
    name: string;
    /** Her mother: a collection of this plan or one there is (by id or exact name). */
    inside?: string;
    /** Fields copied with their ids from a collection there is, so records keep their values when they move. */
    fields?: { from: string; ids: string[]; hidden?: string[] };
    /** What the AI sees of her (at least what it sees of her mother). */
    ai?: AiLevel;
    description?: string;
  }[];
  /** Collections there are, put inside another (`null`: at the top). */
  mothers?: { collection: string; inside: string | null }[];
  /**
   * Every record of `from` to `to`; those with a value in `ifSet.field` (a task's «done») to `ifSet.to`. `set`
   * gives every record moved a value (a field id: a plain value, or a record by its title); `drop` names fields
   * whose values may be lost on purpose (another kind of value in the target). Anything else the target lacks comes
   * along as an archived field of hers: nothing is lost.
   */
  moves?: {
    from: string;
    to: string;
    ifSet?: { field: string; to: string };
    set?: Record<string, RecordRef | string | number | boolean>;
    drop?: string[];
  }[];
  /** Boni Calendar's calendars (by id or name) shown from a branch, its records whose field holds a value. */
  calendars?: {
    calendar: string;
    branch: string;
    where: { field: string; is: RecordRef | string; orEmpty?: boolean };
    make: { event: string; task?: string };
  }[];
  /** Collections archived (only empty ones) and the user's pages sent to the trash (by their title). */
  trash?: { collections?: string[]; pages?: string[] };
}

export interface ReshapeReport {
  applied: boolean;
  run: string | null;
  /** What it does (or would do), in Juan's words: counts and names of collections, never a record's content. */
  lines: string[];
  /** Why nothing was done; empty when it went (or would go) through. */
  problems: string[];
}

/** What a run keeps to be undone that the operation log does not (settings and rules). */
interface Saved {
  calendarDefs: string | null;
  rules: string[];
}

const SAVED = (run: string) => `reshape/${run}`;
const LEVEL_NAME: Record<AiLevel, string> = {
  visible: "visible",
  opaque: "opaca",
  restricted: "restringida",
  private: "privada",
};
/** Thrown to roll the dry run (or a plan with problems) back: everything happened inside one transaction. */
const DRY = new Error("dry run");
class Problem extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isRef = (v: unknown): v is RecordRef => isObj(v) && isStr(v.title) && isStr(v.in);
const strings = (v: unknown) => Array.isArray(v) && v.every((x) => isStr(x));
const empty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** What is wrong with a plan's shape (closed: an unknown key is a mistake, not ignored). */
export function planErrors(plan: unknown): string[] {
  const errors: string[] = [];
  const keys = (o: Record<string, unknown>, allowed: string[], where: string) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${where}: «${k}» sobra`);
  };
  if (!isObj(plan)) return ["el plan no es un objeto JSON"];
  keys(plan, ["collections", "mothers", "moves", "calendars", "trash"], "plan");
  const list = (k: string) => {
    const v = plan[k];
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every(isObj)) {
      errors.push(`«${k}» es una lista de objetos`);
      return [];
    }
    return v as Record<string, unknown>[];
  };
  for (const [i, c] of list("collections").entries()) {
    const w = `collections[${i}]`;
    keys(c, ["name", "inside", "fields", "ai", "description"], w);
    if (!isStr(c.name, 80)) errors.push(`${w}: falta «name»`);
    if (c.inside !== undefined && !isStr(c.inside)) errors.push(`${w}: «inside»`);
    if (c.fields !== undefined) {
      const f = c.fields;
      if (
        !isObj(f) ||
        !isStr(f.from) ||
        !strings(f.ids) ||
        (f.hidden !== undefined && !strings(f.hidden))
      )
        errors.push(`${w}: «fields» es { from, ids, hidden? }`);
    }
    if (c.ai !== undefined && !Object.keys(LEVEL_NAME).includes(String(c.ai)))
      errors.push(`${w}: «ai» es visible, opaque, restricted o private`);
    if (c.description !== undefined && !isStr(c.description, 2000))
      errors.push(`${w}: «description»`);
  }
  for (const [i, m] of list("mothers").entries()) {
    keys(m, ["collection", "inside"], `mothers[${i}]`);
    if (!isStr(m.collection) || !(m.inside === null || isStr(m.inside)))
      errors.push(`mothers[${i}]: es { collection, inside }`);
  }
  for (const [i, m] of list("moves").entries()) {
    const w = `moves[${i}]`;
    keys(m, ["from", "to", "ifSet", "set", "drop"], w);
    if (!isStr(m.from) || !isStr(m.to)) errors.push(`${w}: faltan «from» y «to»`);
    if (m.ifSet !== undefined && !(isObj(m.ifSet) && isStr(m.ifSet.field) && isStr(m.ifSet.to)))
      errors.push(`${w}: «ifSet» es { field, to }`);
    if (m.set !== undefined) {
      if (!isObj(m.set)) errors.push(`${w}: «set» es un objeto`);
      else
        for (const [k, v] of Object.entries(m.set))
          if (!(isRef(v) || ["string", "number", "boolean"].includes(typeof v)))
            errors.push(`${w}: «set.${k}»`);
    }
    if (m.drop !== undefined && !strings(m.drop)) errors.push(`${w}: «drop» es una lista`);
  }
  for (const [i, c] of list("calendars").entries()) {
    const w = `calendars[${i}]`;
    keys(c, ["calendar", "branch", "where", "make"], w);
    if (!isStr(c.calendar) || !isStr(c.branch)) errors.push(`${w}: faltan «calendar» y «branch»`);
    const wh = c.where;
    if (!isObj(wh) || !isStr(wh.field) || !(isRef(wh.is) || isStr(wh.is)))
      errors.push(`${w}: «where» es { field, is, orEmpty? }`);
    if (
      !isObj(c.make) ||
      !isStr(c.make.event) ||
      (c.make.task !== undefined && !isStr(c.make.task))
    )
      errors.push(`${w}: «make» es { event, task? }`);
  }
  const t = plan.trash;
  if (t !== undefined) {
    if (!isObj(t)) errors.push("«trash» es { collections?, pages? }");
    else {
      keys(t, ["collections", "pages"], "trash");
      if (t.collections !== undefined && !strings(t.collections)) errors.push("trash.collections");
      if (t.pages !== undefined && !strings(t.pages)) errors.push("trash.pages");
    }
  }
  return errors;
}

/** The plan written in a note: its first ```json block (Juan sees and keeps it in Boni). */
export function planFromNote(store: UserStore, id: string): unknown {
  const e = store.get(id)?.entity;
  if (!e || e.deleted !== undefined) throw new Error(`no note ${id}`);
  const m = /```json\s*\n([\s\S]*?)```/.exec(e.body ?? "");
  if (!m) throw new Error("the note has no ```json block");
  return JSON.parse(m[1] as string);
}

/** Runs a plan: a dry run (everything done, then rolled back) unless `apply`. */
export function reshape(
  store: UserStore,
  plan: unknown,
  o: { apply: boolean; device?: string },
): ReshapeReport {
  const problems = planErrors(plan);
  if (problems.length) return { applied: false, run: null, lines: [], problems };
  const run = `reshape-${randomUUID()}`;
  const r = new Reshape(store, { actor: "user", device: o.device ?? "reshape", run });
  try {
    store.batch(() => {
      r.go(plan as ReshapePlan);
      if (r.problems.length || !o.apply) throw DRY;
      const saved: Saved = { calendarDefs: r.calendarsBefore, rules: r.rulesMade };
      store.setSetting(SAVED(run), JSON.stringify(saved));
    });
  } catch (e) {
    if (e !== DRY) r.problems.push(e instanceof Error ? e.message : String(e));
    return { applied: false, run: null, lines: r.lines, problems: r.problems };
  }
  return { applied: true, run, lines: r.lines, problems: [] };
}

/** Takes a reshape back: its operations (newest first, all or nothing), the calendars and rules as they were. */
export function undoReshape(store: UserStore, run: string, device = "reshape"): number {
  const text = store.setting(SAVED(run));
  if (!text) throw new Error(`no reshape ${run} to undo`);
  const saved = JSON.parse(text) as Saved;
  return store.batch(() => {
    const undone = store.undoRun(run, { actor: "user", device });
    store.setSetting(CALENDAR_DEFS, saved.calendarDefs);
    for (const id of saved.rules) store.removeAiRule(id, device, { unlock: true });
    store.setSetting(SAVED(run), null);
    return undone.length;
  });
}

class Reshape {
  readonly lines: string[] = [];
  readonly problems: string[] = [];
  calendarsBefore: string | null = null;
  readonly rulesMade: string[] = [];
  private made = new Map<string, string>();
  private l: Label;
  private store: UserStore;
  private meta: OpMeta;

  constructor(store: UserStore, meta: OpMeta) {
    this.store = store;
    this.meta = meta;
    this.l = label("user", "personal", [{ kind: "user-edit", id: meta.device ?? "reshape" }]);
  }

  go(plan: ReshapePlan): void {
    const steps: [string, () => void][] = [
      ["propuestas", () => this.pending(plan)],
      ["colecciones", () => this.collections(plan.collections ?? [])],
      ["madres", () => this.mothers(plan.mothers ?? [])],
      ["registros", () => this.moves(plan.moves ?? [])],
      ["calendarios", () => this.calendars(plan.calendars ?? [])],
      ["papelera", () => this.trash(plan.trash ?? {})],
    ];
    for (const [, step] of steps) {
      try {
        step();
      } catch (e) {
        this.problems.push(e instanceof Error ? e.message : String(e));
      }
      // After a problem the rest would build on something wrong: stop there (nothing is kept anyway).
      if (this.problems.length) return;
    }
  }

  // ------------------------------------------------------------ names

  private get types() {
    return this.store.schema().types;
  }

  /** A collection of the plan (by name) or one there is (by id, or by its exact name when only one has it). */
  private typeRef(ref: string): string {
    const made = this.made.get(ref);
    if (made) return made;
    const t = this.types[ref];
    if (t && !t.system && !t.archived) return t.id;
    const named = Object.values(this.types).filter(
      (x) => !x.system && !x.archived && x.name === ref,
    );
    if (named.length === 1) return (named[0] as TypeDef).id;
    throw new Problem(
      named.length
        ? `hay ${named.length} colecciones «${ref}»: nómbrala por su id (${named.map((x) => x.id).join(", ")})`
        : `no hay ninguna colección «${ref}»`,
    );
  }

  private name(id: string) {
    return this.types[id]?.name ?? id;
  }

  /** The record a reference names (by its title, in one collection), or a plain value as it is. */
  private value(v: RecordRef | string | number | boolean): unknown {
    if (typeof v !== "object") return v;
    const type = this.typeRef(v.in);
    const tf = this.types[type]?.titleField;
    const hits = this.store
      .entities(type)
      .filter((e) => tf && String(e.values[tf] ?? "").trim() === v.title);
    if (hits.length !== 1)
      throw new Problem(
        hits.length
          ? `hay ${hits.length} registros «${v.title}» en «${this.name(type)}»`
          : `no hay ningún «${v.title}» en «${this.name(type)}»`,
      );
    return hits[0]?.id;
  }

  private level(type: string): AiLevel {
    return this.store.aiAccess()[type] ?? "visible";
  }

  // ------------------------------------------------------------ steps

  /** A proposal waiting to make a record in a collection that moves would land nowhere: decide them first. */
  private pending(plan: ReshapePlan): void {
    const moving = new Set((plan.moves ?? []).map((m) => this.typeRef(m.from)));
    const types = this.types;
    const n = this.store.journal.proposals("pending").filter((p) => {
      if (p.tool !== "entities.create") return false;
      const rows = (p.view as { rows?: { arg: string; value?: unknown }[] } | null)?.rows ?? [];
      const key = String(rows.find((r) => r.arg === "type")?.value ?? "");
      const type = types[key] ?? Object.values(types).find((t) => t.key === key);
      return !!type && moving.has(type.id);
    }).length;
    if (n)
      throw new Problem(
        `hay ${n} propuestas pendientes hacia colecciones que se vacían: decídelas antes en la Bandeja`,
      );
  }

  private collections(list: NonNullable<ReshapePlan["collections"]>): void {
    for (const c of list) {
      const taken = Object.values(this.types).some(
        (t) => !t.system && !t.archived && t.name.toLowerCase() === c.name.toLowerCase(),
      );
      if (taken || this.made.has(c.name)) throw new Problem(`ya hay una colección «${c.name}»`);
      const mother = c.inside ? this.typeRef(c.inside) : undefined;
      const motherDef = mother ? this.types[mother] : undefined;
      const source = c.fields ? this.types[this.typeRef(c.fields.from)] : undefined;
      const fields: FieldDef[] = (c.fields?.ids ?? []).map((id) => {
        const f = source?.fields.find((x) => x.id === id && !x.archived);
        if (!f) throw new Problem(`«${source?.name}» no tiene el campo ${id}`);
        const { from: _from, ...own } = f;
        return c.fields?.hidden?.includes(id) ? { ...own, hidden: true } : own;
      });
      // The title: the source's (copied), else the mother's, else a «Título» of her own.
      let titleField =
        source && fields.some((f) => f.id === source.titleField) ? source.titleField : undefined;
      if (!titleField && motherDef) titleField = motherDef.titleField;
      if (!titleField) {
        titleField = fields.some((f) => f.id === "f_titulo") ? "f_titulo_2" : "f_titulo";
        fields.unshift({
          id: titleField,
          key: "titulo",
          name: "Título",
          type: "text",
          label: this.l,
        });
      }
      let key = keyFrom(c.name);
      for (let n = 2; this.types[`t_${key}`]; n++) key = `${keyFrom(c.name).slice(0, 26)}_${n}`;
      const def: TypeDef = {
        id: `t_${key}`,
        key: key.replace(/_/g, "-"),
        name: c.name,
        ...(mother ? { parent: mother } : {}),
        fields,
        titleField,
        sensitivity: motherDef?.sensitivity ?? source?.sensitivity ?? "personal",
        schemaVersion: 1,
        label: this.l,
      };
      this.store.applySchema({ op: "create_type", type: def }, this.meta);
      if (c.description)
        this.store.applySchema(
          {
            op: "describe_type",
            type: def.id,
            description: { text: c.description, label: this.l },
          },
          this.meta,
        );
      if (c.ai && levelRank(c.ai) > levelRank(this.level(def.id)))
        this.store.setAiAccess(def.id, c.ai, this.meta.device ?? "reshape");
      this.made.set(c.name, def.id);
      const where = mother ? ` dentro de «${this.name(mother)}»` : "";
      const n = fields.filter((f) => !f.hidden).length;
      const hidden = fields.length - n;
      const lvl = this.level(def.id);
      this.lines.push(
        `Colección nueva «${c.name}»${where}: ${n} campos propios${hidden ? ` y ${hidden} ocultos` : ""}${
          lvl !== "visible" ? `; ${LEVEL_NAME[lvl]} para la IA` : ""
        }.`,
      );
    }
  }

  private mothers(list: NonNullable<ReshapePlan["mothers"]>): void {
    for (const m of list) {
      const type = this.typeRef(m.collection);
      const parent = m.inside === null ? null : this.typeRef(m.inside);
      try {
        this.store.applySchema({ op: "set_parent", type, parent }, this.meta);
      } catch (e) {
        throw new Problem(`«${this.name(type)}»: ${e instanceof Error ? e.message : String(e)}`);
      }
      this.lines.push(
        `«${this.name(type)}» pasa ${parent ? `dentro de «${this.name(parent)}»` : "al primer nivel"}.`,
      );
    }
  }

  private moves(list: NonNullable<ReshapePlan["moves"]>): void {
    for (const mv of list) {
      const from = this.typeRef(mv.from);
      const to = this.typeRef(mv.to);
      const alt = mv.ifSet ? this.typeRef(mv.ifSet.to) : undefined;
      const records = this.store.entities(from);
      const target = (values: Record<string, unknown>) =>
        alt && mv.ifSet && !empty(values[mv.ifSet.field]) ? alt : to;
      // Nothing more open than it was: a closed collection's records never land where the AI sees more.
      for (const t of alt ? [to, alt] : [to])
        if (levelRank(this.level(t)) < levelRank(this.level(from)))
          throw new Problem(
            `«${this.name(from)}» es ${LEVEL_NAME[this.level(from)]} para la IA y «${this.name(t)}» ${
              LEVEL_NAME[this.level(t)]
            }: sus registros quedarían más abiertos`,
          );
      const sets = Object.entries(mv.set ?? {}).map(
        ([field, v]) => [field, this.value(v)] as const,
      );
      for (const t of alt ? [to, alt] : [to])
        this.prepare(
          from,
          t,
          records.filter((e) => target(e.values) === t).map((e) => e.values),
          new Set([...(mv.drop ?? []), ...sets.map(([f]) => f)]),
        );
      // Its rules about what the AI sees go with its records (the same fields, by id).
      for (const rule of this.store.aiRules().filter((r) => r.type === from))
        for (const t of alt ? [to, alt] : [to]) {
          const id = this.store.setAiRule(
            { type: t, filter: rule.filter, level: rule.level },
            this.meta.device ?? "reshape",
          );
          this.rulesMade.push(id);
        }
      const count = new Map<string, number>();
      // What every record moved gets, as each target keeps it (one operation per record).
      const writesFor = new Map<string, Writes>();
      for (const t of alt ? [to, alt] : [to]) {
        const def = this.types[t] as TypeDef;
        const writes: Writes = {};
        for (const [field, value] of sets) {
          const f = def.fields.find((x) => x.id === field);
          if (!f) throw new Problem(`«${def.name}» no tiene el campo ${field}`);
          writes[field] = {
            value: f.type === "relation" && f.relation?.many ? [value] : value,
            label: this.l,
          };
        }
        writesFor.set(t, writes);
      }
      for (const e of records) {
        const t = target(e.values);
        this.store.retype(e.id, t, this.meta, writesFor.get(t));
        count.set(t, (count.get(t) ?? 0) + 1);
      }
      const parts = (alt ? [to, alt] : [to])
        .filter((t) => count.get(t))
        .map((t) => `${count.get(t)} a «${this.name(t)}»`);
      const setText = sets.length
        ? `; ${sets
            .map(([f, v]) => {
              const field = this.types[to]?.fields.find((x) => x.id === f);
              const shown =
                typeof mv.set?.[f] === "object" ? (mv.set[f] as RecordRef).title : String(v);
              return `«${field?.name ?? f}» = «${shown}»`;
            })
            .join(", ")}`
        : "";
      this.lines.push(
        `«${this.name(from)}»: ${records.length} registros${parts.length ? ` → ${parts.join(", ")}` : ""}${setText}.`,
      );
    }
  }

  /**
   * Gets `to` ready for records of `from`: the options of its choices they use, and every field of theirs it lacks
   * (archived: kept, out of sight). A value of another kind there would be lost: a problem unless dropped on purpose.
   */
  private prepare(
    from: string,
    to: string,
    values: Record<string, unknown>[],
    dropped: Set<string>,
  ): void {
    if (!values.length) return;
    const source = this.types[from] as TypeDef;
    const used = new Map<string, number>();
    for (const v of values)
      for (const [k, x] of Object.entries(v)) if (!empty(x)) used.set(k, (used.get(k) ?? 0) + 1);
    let archived = 0;
    for (const [id, n] of used) {
      const sf = source.fields.find((x) => x.id === id);
      if (!sf) continue;
      const target = this.types[to] as TypeDef;
      const tf = target.fields.find((x) => x.id === id);
      if (!tf) {
        const { from: _f, ...own } = sf;
        const clash = target.fields.some(
          (x) => x.name.trim().toLowerCase() === sf.name.trim().toLowerCase(),
        );
        const field: FieldDef = {
          ...own,
          ...(clash ? { name: `${sf.name} (${source.name})`.slice(0, 80) } : {}),
          archived: true,
        };
        this.store.applySchema({ op: "add_field", type: to, field }, this.meta);
        archived++;
        continue;
      }
      if (tf.type !== sf.type) {
        if (!dropped.has(id))
          throw new Problem(
            `«${sf.name}» guarda ${sf.type} en «${source.name}» y ${tf.type} en «${target.name}»: ${n} valores se perderían (ponlo en «set» o en «drop»)`,
          );
        continue;
      }
      if ((tf.type === "select" || tf.type === "multiselect") && sf.options?.length) {
        const missing = sf.options.filter((o) => !tf.options?.some((x) => x.id === o.id));
        if (missing.length)
          this.store.applySchema(
            {
              op: "set_options",
              type: tf.from ?? to,
              field: id,
              options: [...(tf.options ?? []), ...missing],
            },
            this.meta,
          );
      }
    }
    if (archived)
      this.lines.push(
        `«${this.name(to)}» guarda, archivados, ${archived} campos de «${source.name}» que no tiene.`,
      );
  }

  private calendars(list: NonNullable<ReshapePlan["calendars"]>): void {
    this.calendarsBefore = this.store.setting(CALENDAR_DEFS);
    const next: { type: string; raw: Record<string, unknown>; where?: Where; make?: Make }[] =
      calendarDefs(this.store).map((p) => ({
        type: p.type,
        raw: p.raw,
        where: p.where,
        make: p.make,
      }));
    for (const c of list) {
      const i = next.findIndex((x) => x.raw.id === c.calendar || x.raw.name === c.calendar);
      if (i < 0) throw new Problem(`no hay ningún calendario «${c.calendar}»`);
      const type = this.typeRef(c.branch);
      const field = this.types[type]?.fields.find((f) => f.id === c.where.field);
      if (!field) throw new Problem(`«${this.name(type)}» no tiene el campo ${c.where.field}`);
      const value = this.value(c.where.is);
      if (typeof value !== "string")
        throw new Problem(`calendario «${c.calendar}»: «is» nombra un registro o un texto`);
      const inBranch = (ref: string) => {
        const t = this.typeRef(ref);
        if (!branch(this.store.schema(), type).includes(t))
          throw new Problem(`«${this.name(t)}» no está dentro de «${this.name(type)}»`);
        return t;
      };
      const make: Make = {
        event: inBranch(c.make.event),
        ...(c.make.task ? { task: inBranch(c.make.task) } : {}),
      };
      // What its new rows got from the collection they went to (the area) now comes from `where`.
      const raw = { ...(next[i]?.raw ?? {}) };
      const newNote = isObj(raw.newNote) ? { ...raw.newNote } : undefined;
      if (newNote && isObj(newNote.properties)) {
        const names = [field.key, field.name].map((x) => x.toLowerCase());
        newNote.properties = Object.fromEntries(
          Object.entries(newNote.properties).filter(([k]) => !names.includes(k.toLowerCase())),
        );
        raw.newNote = newNote;
      }
      next[i] = {
        type,
        raw,
        where: { field: field.id, value, ...(c.where.orEmpty ? { orEmpty: true } : {}) },
        make,
      };
      const shown = typeof c.where.is === "object" ? c.where.is.title : c.where.is;
      this.lines.push(
        `Calendario «${String(raw.name ?? c.calendar)}»: «${this.name(type)}» donde «${field.name}» es «${shown}»${
          c.where.orEmpty ? " o está vacío" : ""
        }; lo nuevo va a «${this.name(make.event)}»${make.task ? ` (las tareas, a «${this.name(make.task)}»)` : ""}.`,
      );
    }
    if (list.length) saveCalendarDefs(this.store, next);
  }

  private trash(t: NonNullable<ReshapePlan["trash"]>): void {
    const done: string[] = [];
    for (const ref of t.collections ?? []) {
      const type = this.typeRef(ref);
      const schema = this.store.schema();
      const live = branch(schema, type).filter((id) => !schema.types[id]?.archived);
      const n = live.reduce((k, id) => k + this.store.count(id), 0);
      if (live.length > 1 || n > 0)
        throw new Problem(
          `«${this.name(type)}» no se queda vacía (${n} registros${live.length > 1 ? " y colecciones dentro" : ""})`,
        );
      // A calendar still over it would show nothing.
      const cal = calendarDefs(this.store).find((p) => p.type === type);
      if (cal) throw new Problem(`el calendario «${cal.def.name}» se quedaría sin registros`);
      this.store.applySchema({ op: "archive_type", type, archived: true }, this.meta);
      done.push(`«${this.name(type)}»`);
    }
    if (done.length) this.lines.push(`Se archivan, vacías: ${done.join(", ")}.`);
    const pages = listPages(this.store).filter((p) => !p.template);
    const gone: string[] = [];
    for (const title of t.pages ?? []) {
      const hits = pages.filter((p) => p.title === title);
      if (hits.length !== 1)
        throw new Problem(
          hits.length
            ? `hay ${hits.length} páginas «${title}»`
            : `no hay ninguna página «${title}»`,
        );
      const page = hits[0] as (typeof pages)[number];
      // Pages are Boni's own type: written as its code writes them (in the same run).
      const meta: OpMeta = { ...this.meta, actor: "system" };
      for (const c of listPages(this.store).filter((x) => x.parent === page.id))
        this.store.update(c.id, { f_parent: { value: page.parent ?? "", label: this.l } }, meta);
      this.store.remove(page.id, meta);
      gone.push(`«${title}»`);
    }
    if (gone.length) this.lines.push(`A la papelera: las páginas ${gone.join(", ")}.`);
  }
}
