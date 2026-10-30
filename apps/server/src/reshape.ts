/**
 * A reshape of an account's tree (docs/clases.md §7, step 5): new collections, records moved into them keeping their
 * ids and every value, collections put inside others, Boni Calendar's calendars pointed at a branch split by a
 * field, and what is left empty or no longer needed archived or sent to the trash. It also clears away what the
 * vault left (step 7): links by a note's file name made relations, titles from a note's heading or file name, its
 * embeds (or only its views) out of the text, fields archived, and last the hidden path each note had. The plan is data, in the
 * account's own words (nothing of them in code, D-14); a dry run says what it would do, with counts only (never a
 * record's content), and the real one is one run in one transaction, undone whole (`undoReshape`).
 */
import { randomUUID } from "node:crypto";
import { branch, type FieldDef, type Label, label, ownFields, type TypeDef } from "@boni/entities";
import {
  type AiLevel,
  BODY,
  levelRank,
  type OpMeta,
  type UserStore,
  type Writes,
} from "@boni/store";
import { leadingTitle } from "@boni/views";
import {
  CALENDAR_DEFS,
  calendarDefs,
  type Make,
  saveCalendarDefs,
  type Where,
} from "./calendarStore.ts";
import { keyFrom } from "./data.ts";
import { listPages } from "./pages.ts";
import { FOLDER_FIELD, HASH_FIELD, PATH_FIELD } from "./paths.ts";

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
    /** Only the records whose field (by id or name; a text: the path a note had, say) starts with `prefix`. */
    where?: { field: string; prefix: string };
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
  /**
   * Fields whose values name records the vault's way (`[[name]]`, the file name a note had, a title) made relations
   * to `to` (her whole branch, D-18); the text they were stays, archived.
   */
  links?: { collection: string; field: string; to: string }[];
  /** Records without a title take their text's first heading (out of the text), else the file name their note had. */
  titles?: boolean;
  /**
   * Fields of collections there are: new ones (`add`), and ones archived (kept, out of sight; "all": every one in
   * sight but the title).
   */
  fields?: {
    collection: string;
    add?: { name: string; type: "text" | "longtext" | "number" | "checkbox" | "date" }[];
    archive?: string[] | "all";
  }[];
  /** Records named by their title: values set (a field by its name or id) and, with `text: ""`, their text emptied. */
  records?: {
    title: string;
    in: string;
    set?: Record<string, string | number | boolean>;
    text?: "";
  }[];
  /**
   * Obsidian's embeds (`![[…]]`) in every record's text: all of them out, or only its views (`![[….base]]`, live lists
   * Boni does not run) with the heading each leaves with nothing under it, or each file that finds its row made the
   * page's file block (`![name|width](boni:<id>)`, an image shown in place).
   */
  embeds?: "remove" | "views" | "files";
  /** The hidden fields where the vault's import kept each note's path and hash, archived in every collection. */
  vaultPaths?: "archive";
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
/** "wiki/temas/rutina-de-ejercicios.md" → "rutina-de-ejercicios": the name a note's file had. */
const fileName = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "").trim();
/** A file's name as words: "rutina-de-ejercicios" → "Rutina de ejercicios". */
const readable = (name: string) => {
  const w = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return (w[0]?.toUpperCase() ?? "") + w.slice(1);
};

/** An Obsidian view embedded in a text (`![[person.base]]`, `![[x.base#Tabla|200]]`), alone on its line or not. */
const VIEW = /!\[\[[^\]\n]*\.base(?:[#|][^\]\n]*)?\]\]/i;
const VIEWS = new RegExp(VIEW.source, "gi");
const VIEW_LINE = new RegExp(`^[ \\t]*${VIEW.source}[ \\t]*$`, "i");
const HEADING = /^(#{1,6})[ \t]/;

/**
 * A text without its Obsidian views: a view alone on its line goes with its line, and so does the heading just above
 * it when nothing is left under that heading (the next line with text is a heading as high, or the end).
 */
export function withoutViews(body: string): { text: string; views: number; headings: number } {
  const lines = body.split("\n");
  const out: string[] = [];
  let views = 0;
  let headings = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (!VIEW_LINE.test(line)) {
      const inline = line.match(VIEWS)?.length ?? 0;
      views += inline;
      out.push(
        inline
          ? line
              .replace(VIEWS, "")
              .replace(/[ \t]{2,}/g, " ")
              .trimEnd()
          : line,
      );
      continue;
    }
    views++;
    let k = out.length - 1;
    while (k >= 0 && !(out[k] as string).trim()) k--;
    const h = k >= 0 ? HEADING.exec(out[k] as string) : null;
    if (!h) continue;
    let j = i + 1;
    while (j < lines.length && !(lines[j] as string).trim()) j++;
    const next = j < lines.length ? HEADING.exec(lines[j] as string) : null;
    if (j >= lines.length || (next && (next[1] as string).length <= (h[1] as string).length)) {
      out.splice(k);
      headings++;
    }
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return { text: text.replace(/^\n+/, "").trimEnd(), views, headings };
}

/**
 * An embed alone on its line, or on a quote's line (`> ![[…]]`, Obsidian's callouts), its indentation kept:
 * [1] the indentation, [2] what it points to (without its section), [3] its alias (a width, or a name).
 */
const FILE_EMBED_LINE =
  /^([ \t]*)(?:>[ \t]?)?!\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\][ \t]*$/;
/** An embed inside a sentence: [1] what it points to, [2] its alias (a width, or a name). */
const FILE_EMBEDS_FULL = /!\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;
/** A file's name (an extension that is not a note's or a view's), not a note. */
const isFileTarget = (target: string) => {
  const ext = /\.([a-z][a-z0-9]{0,4})$/i.exec(target.trim())?.[1]?.toLowerCase();
  return !!ext && ext !== "md" && ext !== "base";
};

/** What is wrong with a plan's shape (closed: an unknown key is a mistake, not ignored). */
export function planErrors(plan: unknown): string[] {
  const errors: string[] = [];
  const keys = (o: Record<string, unknown>, allowed: string[], where: string) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${where}: «${k}» sobra`);
  };
  if (!isObj(plan)) return ["el plan no es un objeto JSON"];
  keys(
    plan,
    [
      "collections",
      "mothers",
      "moves",
      "calendars",
      "trash",
      "links",
      "titles",
      "fields",
      "records",
      "embeds",
      "vaultPaths",
    ],
    "plan",
  );
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
    keys(m, ["from", "to", "where", "ifSet", "set", "drop"], w);
    if (!isStr(m.from) || !isStr(m.to)) errors.push(`${w}: faltan «from» y «to»`);
    if (m.where !== undefined && !(isObj(m.where) && isStr(m.where.field) && isStr(m.where.prefix)))
      errors.push(`${w}: «where» es { field, prefix }`);
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
  for (const [i, k] of list("links").entries()) {
    keys(k, ["collection", "field", "to"], `links[${i}]`);
    if (!isStr(k.collection) || !isStr(k.field) || !isStr(k.to))
      errors.push(`links[${i}]: es { collection, field, to }`);
  }
  if (plan.titles !== undefined && plan.titles !== true) errors.push("«titles» es true");
  const KINDS = ["text", "longtext", "number", "checkbox", "date"];
  for (const [i, f] of list("fields").entries()) {
    const w = `fields[${i}]`;
    keys(f, ["collection", "add", "archive"], w);
    if (!isStr(f.collection)) errors.push(`${w}: falta «collection»`);
    if (
      f.add !== undefined &&
      !(
        Array.isArray(f.add) &&
        f.add.every((a) => isObj(a) && isStr(a.name, 80) && KINDS.includes(String(a.type)))
      )
    )
      errors.push(`${w}: «add» es una lista de { name, type: ${KINDS.join(" | ")} }`);
    if (f.archive !== undefined && f.archive !== "all" && !strings(f.archive))
      errors.push(`${w}: «archive» es una lista o "all"`);
  }
  for (const [i, r] of list("records").entries()) {
    const w = `records[${i}]`;
    keys(r, ["title", "in", "set", "text"], w);
    if (!isStr(r.title, 300) || !isStr(r.in)) errors.push(`${w}: faltan «title» e «in»`);
    if (
      r.set !== undefined &&
      !(
        isObj(r.set) &&
        Object.values(r.set).every((v) => ["string", "number", "boolean"].includes(typeof v))
      )
    )
      errors.push(`${w}: «set» es un objeto de valores`);
    if (r.text !== undefined && r.text !== "") errors.push(`${w}: «text» solo puede ser ""`);
  }
  if (plan.embeds !== undefined && !["remove", "views", "files"].includes(plan.embeds as string))
    errors.push('«embeds» es "remove", "views" o "files"');
  if (plan.vaultPaths !== undefined && plan.vaultPaths !== "archive")
    errors.push('«vaultPaths» es "archive"');
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
      ["enlaces", () => this.links(plan.links ?? [])],
      [
        "títulos",
        () => {
          if (plan.titles) this.titles();
        },
      ],
      ["registros", () => this.moves(plan.moves ?? [])],
      ["campos", () => this.fields(plan.fields ?? [])],
      ["registros nombrados", () => this.records(plan.records ?? [])],
      [
        "incrustaciones",
        () => {
          if (plan.embeds === "remove") this.embeds();
          if (plan.embeds === "views") this.views();
          if (plan.embeds === "files") this.files();
        },
      ],
      ["calendarios", () => this.calendars(plan.calendars ?? [])],
      ["papelera", () => this.trash(plan.trash ?? {})],
      [
        "rutas",
        () => {
          if (plan.vaultPaths) this.vaultPaths();
        },
      ],
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
      // A field by its id, or by its exact name.
      const fields: FieldDef[] = (c.fields?.ids ?? []).map((id) => {
        const f = source?.fields.find((x) => (x.id === id || x.name === id) && !x.archived);
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
      const whereField = mv.where ? this.fieldOf(from, mv.where.field).id : null;
      const records = this.store
        .entities(from)
        .filter(
          (e) =>
            !mv.where || String(e.values[whereField as string] ?? "").startsWith(mv.where.prefix),
        );
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
      // A record keeps its title where its new collection keeps titles (they may name it in another field).
      const fromTitle = (this.types[from] as TypeDef).titleField;
      for (const e of records) {
        const t = target(e.values);
        const toTitle = (this.types[t] as TypeDef).titleField;
        const title = e.values[fromTitle];
        const writes =
          toTitle !== fromTitle && !empty(title)
            ? { ...writesFor.get(t), [toTitle]: { value: title, label: this.l } }
            : writesFor.get(t);
        this.store.retype(e.id, t, this.meta, writes);
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
      const which = mv.where ? ` (los de «${mv.where.prefix}»)` : "";
      this.lines.push(
        `«${this.name(from)}»${which}: ${records.length} registros${parts.length ? ` → ${parts.join(", ")}` : ""}${setText}.`,
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

  // ------------------------------------------------------------ what the vault left

  /** The user's collections there are (not Boni's own, not archived). */
  private userTypes(): TypeDef[] {
    return Object.values(this.types).filter((t) => !t.system && !t.archived);
  }

  /** A field of a collection by its id or exact name (not archived). */
  private fieldOf(type: string, ref: string): FieldDef {
    const def = this.types[type] as TypeDef;
    const f = def.fields.find((x) => !x.archived && (x.id === ref || x.name === ref));
    if (!f) throw new Problem(`«${def.name}» no tiene el campo ${ref}`);
    return f;
  }

  /** A field id no collection uses yet. */
  private freeField(base: string): string {
    const taken = new Set(Object.values(this.types).flatMap((t) => t.fields.map((f) => f.id)));
    const root = base.slice(0, 60);
    let id = root;
    for (let n = 2; taken.has(id); n++) id = `${root}_${n}`;
    return id;
  }

  private links(list: NonNullable<ReshapePlan["links"]>): void {
    for (const k of list) {
      const type = this.typeRef(k.collection);
      const old = this.fieldOf(type, k.field);
      if (old.from)
        throw new Problem(`«${old.name}» es de «${this.name(old.from)}»: nombra esa colección`);
      if (!["text", "longtext", "select", "multiselect"].includes(old.type))
        throw new Problem(
          `«${old.name}» de «${this.name(type)}» es ${old.type}: no guarda enlaces`,
        );
      const target = this.typeRef(k.to);
      const schema = this.store.schema();
      // A record of the target's branch by the file name its note had, by its title or by its id (any case).
      const names = new Map<string, string>();
      const ids = new Set<string>();
      const kinds = branch(schema, target);
      for (const t of kinds)
        for (const e of this.store.entities(t)) {
          ids.add(e.id);
          const path = e.values[PATH_FIELD];
          if (typeof path === "string") names.set(fileName(path).toLowerCase(), e.id);
        }
      for (const t of kinds) {
        const tf = this.types[t]?.titleField;
        for (const e of this.store.entities(t)) {
          const title = tf
            ? String(e.values[tf] ?? "")
                .trim()
                .toLowerCase()
            : "";
          if (title && !names.has(title)) names.set(title, e.id);
        }
      }
      const find = (v: string): string | null => {
        const s = v.trim();
        if (ids.has(s)) return s;
        const m = /^\[\[([^\]|#]+)/.exec(s)?.[1]?.trim() ?? s;
        return names.get((m.split("/").pop() ?? m).toLowerCase()) ?? null;
      };
      // A value as the names it holds: an option by its name; a text, each `[[link]]` in it (or the whole text).
      const named = (v: unknown): string[] =>
        (Array.isArray(v) ? v : empty(v) ? [] : [v]).flatMap((x) => {
          if (old.type === "select" || old.type === "multiselect")
            return [old.options?.find((o) => o.id === x)?.name ?? String(x)];
          const s = String(x);
          const links = [...s.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`);
          return links.length ? links : s.trim() ? [s] : [];
        });
      const found = new Map<string, string[]>();
      let withValues = 0;
      let missing = 0;
      let many = old.type === "multiselect";
      for (const t of branch(schema, type))
        for (const e of this.store.entities(t)) {
          const list = named(e.values[old.id]);
          if (!list.length) continue;
          withValues++;
          if (list.length > 1) many = true;
          const got = list.map(find);
          missing += got.filter((x) => !x).length;
          const linked = [...new Set(got.filter((x): x is string => !!x))];
          if (linked.length) found.set(e.id, linked);
        }
      // The text it was, kept and archived; the relation takes its name and its place.
      const at = (this.types[type] as TypeDef).fields.indexOf(old);
      this.store.applySchema(
        {
          op: "rename_field",
          type,
          field: old.id,
          key: `${old.key}_texto`.slice(0, 64),
          name: `${old.name} (texto)`.slice(0, 80),
          label: this.l,
        },
        this.meta,
      );
      this.store.applySchema(
        { op: "archive_field", type, field: old.id, archived: true },
        this.meta,
      );
      const id = this.freeField(`${old.id}_rel`);
      this.store.applySchema(
        {
          op: "add_field",
          type,
          field: {
            id,
            key: old.key,
            name: old.name,
            type: "relation",
            relation: { target, many },
            label: this.l,
          },
          at,
        },
        this.meta,
      );
      let links = 0;
      for (const [rid, got] of found) {
        this.store.update(rid, { [id]: { value: many ? got : got[0], label: this.l } }, this.meta);
        links += many ? got.length : 1;
      }
      this.lines.push(
        `«${this.name(type)}»: «${old.name}» pasa a ser una relación con «${this.name(target)}» (${withValues} registros, ${links} enlaces${
          missing ? `; ${missing} no encuentran registro y quedan solo en el texto archivado` : ""
        }).`,
      );
    }
  }

  private titles(): void {
    let fromHead = 0;
    let fromFile = 0;
    let still = 0;
    for (const t of this.userTypes()) {
      const tf = t.fields.find((f) => f.id === t.titleField);
      if (tf && tf.type !== "text") continue;
      for (const e of this.store.entities(t.id)) {
        if (String(e.values[t.titleField] ?? "").trim()) continue;
        const head = leadingTitle(e.body ?? "");
        const path = e.values[PATH_FIELD];
        const writes: Writes = {};
        if (head?.title) {
          writes[t.titleField] = { value: head.title, label: this.l };
          writes[BODY] = { value: head.rest.trim() ? head.rest : null, label: this.l };
          fromHead++;
        } else if (typeof path === "string" && fileName(path)) {
          writes[t.titleField] = { value: readable(fileName(path)), label: this.l };
          fromFile++;
        } else {
          still++;
          continue;
        }
        this.store.update(e.id, writes, this.meta);
      }
    }
    const parts = [
      fromHead ? `${fromHead} del encabezado de su texto` : "",
      fromFile ? `${fromFile} del nombre de su fichero` : "",
    ].filter(Boolean);
    this.lines.push(
      `Títulos: ${fromHead + fromFile} registros sin título lo toman${parts.length ? `: ${parts.join(", ")}` : ""}${
        still ? `; ${still} siguen sin título` : ""
      }.`,
    );
  }

  private fields(list: NonNullable<ReshapePlan["fields"]>): void {
    for (const c of list) {
      const type = this.typeRef(c.collection);
      const def = () => this.types[type] as TypeDef;
      const added: string[] = [];
      for (const a of c.add ?? []) {
        if (def().fields.some((f) => !f.archived && f.name.toLowerCase() === a.name.toLowerCase()))
          throw new Problem(`«${def().name}» ya tiene un campo «${a.name}»`);
        const key = keyFrom(a.name);
        this.store.applySchema(
          {
            op: "add_field",
            type,
            field: {
              id: this.freeField(`f_${key}`),
              key,
              name: a.name,
              type: a.type,
              label: this.l,
            },
          },
          this.meta,
        );
        added.push(`«${a.name}»`);
      }
      const gone: string[] = [];
      const archive =
        c.archive === "all"
          ? ownFields(def())
              .filter((f) => !f.archived && !f.hidden && f.id !== def().titleField)
              .map((f) => f.id)
          : (c.archive ?? []);
      for (const ref of archive) {
        const f = this.fieldOf(type, ref);
        if (f.id === def().titleField)
          throw new Problem(`«${f.name}» es el título de «${def().name}»`);
        if (f.from) throw new Problem(`«${f.name}» es de «${this.name(f.from)}»: archívalo allí`);
        this.store.applySchema(
          { op: "archive_field", type, field: f.id, archived: true },
          this.meta,
        );
        gone.push(`«${f.name}»`);
      }
      const parts = [
        added.length ? `campos nuevos ${added.join(", ")}` : "",
        gone.length ? `${gone.length} campos archivados (${gone.join(", ")})` : "",
      ].filter(Boolean);
      if (parts.length) this.lines.push(`«${def().name}»: ${parts.join("; ")}.`);
    }
  }

  private records(list: NonNullable<ReshapePlan["records"]>): void {
    let emptied = 0;
    for (const r of list) {
      const id = this.value({ title: r.title, in: r.in }) as string;
      const e = this.store.get(id)?.entity;
      if (!e) continue;
      const writes: Writes = {};
      for (const [ref, v] of Object.entries(r.set ?? {}))
        writes[this.fieldOf(e.type, ref).id] = { value: v, label: this.l };
      if (r.text === "" && e.body) {
        writes[BODY] = { value: null, label: this.l };
        emptied++;
      }
      if (Object.keys(writes).length) this.store.update(id, writes, this.meta);
    }
    if (list.length)
      this.lines.push(
        `Registros nombrados: ${list.length} con sus valores${
          emptied ? `; ${emptied} se quedan sin texto (dejan de salir como notas en el árbol)` : ""
        }.`,
      );
  }

  private embeds(): void {
    const EMBED = /!\[\[[^\]\n]*\]\]/g;
    let notes = 0;
    let count = 0;
    for (const t of this.userTypes())
      for (const e of this.store.entities(t.id)) {
        const body = e.body ?? "";
        const hits = body.match(EMBED);
        if (!hits) continue;
        const next = body
          .replace(/^[ \t]*!\[\[[^\]\n]*\]\][ \t]*(\r?\n|$)/gm, "")
          .replace(EMBED, "")
          .replace(/\n{3,}/g, "\n\n")
          .trimEnd();
        this.store.update(
          e.id,
          { [BODY]: { value: next ? `${next}\n` : null, label: this.l } },
          this.meta,
        );
        notes++;
        count += hits.length;
      }
    this.lines.push(
      `Incrustaciones de Obsidian (![[…]]): ${count} fuera del texto de ${notes} registros.`,
    );
  }

  /**
   * Each embed of a file made the page's file block when it finds its row: by its folder and name, by a name only
   * one file has, or, when several files have that name, by the one nearest the folder its note had in the vault
   * (read once here, for this; Juan 2026-10-30). Alone on its line (or on a quote's line, Obsidian's callouts) the
   * block takes the line; in the middle of a sentence it goes on its own line just below it. A name still shared by
   * files as near, a file Boni does not have, and one inside a quote's sentence stay as they were.
   */
  private files(): void {
    const exact = new Map<string, string>();
    const named = new Map<string, string[]>();
    const folderOf = new Map<string, string>();
    for (const t of this.userTypes()) {
      const file = t.fields.find((f) => f.type === "file" && !f.archived);
      if (!file) continue;
      for (const e of this.store.entities(t.id)) {
        const name = String(e.values[t.titleField] ?? "").trim();
        if (e.values[file.id] === undefined || !name) continue;
        const folder = String(e.values[FOLDER_FIELD] ?? "").replace(/\/+$/, "");
        exact.set(`${folder}/${name}`.toLowerCase(), e.id);
        named.set(name.toLowerCase(), [...(named.get(name.toLowerCase()) ?? []), e.id]);
        folderOf.set(e.id, folder.toLowerCase());
      }
    }
    const n = {
      notes: 0,
      exact: 0,
      unique: 0,
      near: 0,
      moved: 0,
      shared: 0,
      missing: 0,
      quoted: 0,
    };
    /** How many folders, from the top, two paths share. */
    const shared = (a: string, b: string) => {
      const x = a.split("/").filter(Boolean);
      const y = b.split("/").filter(Boolean);
      let k = 0;
      while (k < x.length && k < y.length && x[k] === y[k]) k++;
      return k;
    };
    const find = (
      target: string,
      home: string,
    ): { id: string; how: "exact" | "unique" | "near" } | "shared" | "missing" => {
      const name = (target.split("/").pop() ?? target).trim().toLowerCase();
      const byPath = exact.get(target.toLowerCase());
      if (byPath) return { id: byPath, how: "exact" };
      const same = named.get(name) ?? [];
      if (same.length === 1) return { id: same[0] as string, how: "unique" };
      if (!same.length) return "missing";
      if (!home) return "shared";
      const scored = same.map((id) => ({ id, k: shared(home, folderOf.get(id) ?? "") }));
      const best = Math.max(...scored.map((x) => x.k));
      const top = scored.filter((x) => x.k === best);
      return best > 0 && top.length === 1
        ? { id: (top[0] as { id: string }).id, how: "near" }
        : "shared";
    };
    const block = (target: string, alias: string | undefined, id: string) => {
      const name = (target.split("/").pop() ?? target).trim();
      const width = /^(\d{2,4})(?:x\d+)?$/.exec((alias ?? "").trim())?.[1];
      const w = width && Number(width) >= 16 && Number(width) <= 4000 ? `|${width}` : "";
      return `![${name.replace(/[\]|]/g, " ")}${w}](boni:${id})`;
    };
    const count = (r: ReturnType<typeof find>) => {
      if (r === "shared") n.shared++;
      else if (r === "missing") n.missing++;
      else n[r.how]++;
    };
    for (const t of this.userTypes())
      for (const e of this.store.entities(t.id)) {
        const body = e.body ?? "";
        if (!body.includes("![[")) continue;
        const path = e.values[PATH_FIELD];
        const home =
          typeof path === "string"
            ? path.slice(0, Math.max(0, path.lastIndexOf("/"))).toLowerCase()
            : "";
        let changed = false;
        const lines = body.split("\n").flatMap((line) => {
          const m = FILE_EMBED_LINE.exec(line);
          if (m) {
            const target = (m[2] as string).trim();
            if (!isFileTarget(target)) return [line];
            const r = find(target, home);
            count(r);
            if (typeof r === "string") return [line];
            changed = true;
            return [`${m[1]}${block(target, m[3], r.id)}`];
          }
          const inside = [...line.matchAll(FILE_EMBEDS_FULL)].filter((x) =>
            isFileTarget(x[1] as string),
          );
          if (!inside.length) return [line];
          // In a quote's sentence (a callout's text) it stays: the quote would be split.
          if (/^\s*>/.test(line)) {
            n.quoted += inside.length;
            return [line];
          }
          const below: string[] = [];
          let rest = line;
          for (const x of inside) {
            const target = (x[1] as string).trim();
            const r = find(target, home);
            if (typeof r === "string") {
              count(r);
              continue;
            }
            n.moved++;
            below.push(block(target, x[2], r.id));
            rest = rest.replace(x[0], "");
          }
          if (!below.length) return [line];
          changed = true;
          const text = rest.replace(/[ \t]{2,}/g, " ").trimEnd();
          return text.trim() ? [text, ...below] : below;
        });
        if (!changed) continue;
        this.store.update(e.id, { [BODY]: { value: lines.join("\n"), label: this.l } }, this.meta);
        n.notes++;
      }
    const made = n.exact + n.unique + n.near + n.moved;
    this.lines.push(
      `Ficheros incrustados (![[…]]): ${made} pasan a ser bloques de fichero en ${n.notes} registros (${n.exact} por carpeta y nombre, ${n.unique} por un nombre que solo tiene un fichero, ${n.near} por la carpeta que tenía su nota, ${n.moved} sacados de una frase a su propia línea). Se quedan como estaban: ${n.shared} con un nombre que llevan varios ficheros igual de cerca, ${n.missing} sin fichero en Boni y ${n.quoted} dentro de una cita.`,
    );
  }

  /** Only Obsidian's views out of the texts, with the heading a view leaves empty («## Agenda» over `![[….base]]`). */
  private views(): void {
    let notes = 0;
    let views = 0;
    let headings = 0;
    for (const t of this.userTypes())
      for (const e of this.store.entities(t.id)) {
        const body = e.body ?? "";
        if (!VIEW.test(body)) continue;
        const r = withoutViews(body);
        this.store.update(
          e.id,
          { [BODY]: { value: r.text ? `${r.text}\n` : null, label: this.l } },
          this.meta,
        );
        notes++;
        views += r.views;
        headings += r.headings;
      }
    this.lines.push(
      `Vistas de Obsidian (![[….base]]): ${views} fuera del texto de ${notes} registros, y ${headings} encabezados que se quedaban vacíos.`,
    );
  }

  private vaultPaths(): void {
    let n = 0;
    for (const t of this.userTypes()) {
      const own = t.fields.filter(
        (f) => (f.id === PATH_FIELD || f.id === HASH_FIELD) && !f.archived && !f.from,
      );
      for (const f of own)
        this.store.applySchema(
          { op: "archive_field", type: t.id, field: f.id, archived: true },
          this.meta,
        );
      if (own.length) n++;
    }
    this.lines.push(
      n
        ? `La ruta y la huella que dejó el vault se archivan en ${n} colecciones: nada las lee ya.`
        : "Ninguna colección guarda ya la ruta del vault.",
    );
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
