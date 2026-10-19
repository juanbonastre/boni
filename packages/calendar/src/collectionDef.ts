import type {
  CalendarMapping,
  CalendarView,
  Collection,
  Column,
  ColumnType,
  Model,
  Row,
} from "./collections.ts";
import type { Account, PropValue } from "./model.ts";
import type { ParsedNote } from "./notes.ts";
import { makeProjector } from "./projection.ts";
import { hasReminders, parseReminderDefaults, type ReminderDefaults } from "./reminders.ts";
import { validateModel } from "./validate.ts";

/**
 * A collection as the user writes it in the vault: where its notes are, which properties they
 * have, and how a calendar reads them. Plain data, so it can sit in the frontmatter of a note.
 */
export interface CollectionDef {
  id: string;
  name: string;
  /** Folder of the vault holding one note per row, e.g. "agenda/docencia". */
  folder: string;
  /** Calendars with the same account are listed together in the sidebar. */
  account: string;
  color: string;
  readOnly?: boolean;
  /** Timezone of rows that do not carry their own. */
  tz?: string;
  columns: Column[];
  mapping: CalendarMapping;
  /** How a note created by the app is named and what it starts with. */
  newNote?: { name: string; body: string };
  /** Default reminders of its events: `reminders: { timed: "10m", allDay: "0d@09:00" }` (none when missing). */
  reminders?: ReminderDefaults;
}

export type DefResult = { ok: true; def: CollectionDef } | { ok: false; errors: string[] };

const TYPES: ColumnType[] = [
  "text",
  "number",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "time",
  "datetime",
  "dates",
  "url",
  "relation",
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads and checks a definition (the `collection` property of a definition note). */
export function parseCollectionDef(data: unknown): DefResult {
  const errors: string[] = [];
  if (!isObj(data)) return { ok: false, errors: ["the definition must be a map"] };
  const str = (k: string, required = true): string | undefined => {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (required || v !== undefined) errors.push(`${k}: expected text`);
    return undefined;
  };
  const id = str("id");
  if (id && !/^[a-z0-9][a-z0-9-]*$/.test(id))
    errors.push("id: use lowercase letters, digits and dashes");
  const name = str("name");
  const folder = str("folder")?.replace(/^\/+|\/+$/g, "");
  if (folder?.split("/").some((p) => p === ".." || p.startsWith("."))) {
    errors.push("folder: not allowed");
  }
  const account = str("account");
  const color = str("color");
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) errors.push("color: expected #rrggbb");
  const tz = str("tz", false);
  if (data.readOnly !== undefined && typeof data.readOnly !== "boolean") {
    errors.push("readOnly: expected true or false");
  }

  const columns: Column[] = [];
  if (!Array.isArray(data.columns) || data.columns.length === 0)
    errors.push("columns: expected a list");
  else {
    for (const [i, c] of data.columns.entries()) {
      if (!isObj(c) || typeof c.id !== "string" || typeof c.name !== "string") {
        errors.push(`columns[${i}]: needs id and name`);
        continue;
      }
      if (!TYPES.includes(c.type as ColumnType)) {
        errors.push(`columns[${i}] "${c.id}": unknown type "${String(c.type)}"`);
        continue;
      }
      const col: Column = { id: c.id, name: c.name, type: c.type as ColumnType };
      if (Array.isArray(c.options)) {
        col.options = c.options.flatMap((o) =>
          isObj(o) && typeof o.id === "string" && typeof o.label === "string"
            ? [
                {
                  id: o.id,
                  label: o.label,
                  color: typeof o.color === "string" ? o.color : "#94a3b8",
                },
              ]
            : [],
        );
      }
      if (typeof c.target === "string") col.target = c.target;
      columns.push(col);
    }
  }

  const mapping = parseMapping(data.mapping, errors);
  let newNote: CollectionDef["newNote"];
  if (data.newNote !== undefined) {
    const n = data.newNote;
    if (isObj(n) && typeof n.name === "string") {
      newNote = { name: n.name, body: typeof n.body === "string" ? n.body : "" };
    } else errors.push("newNote: needs a name");
  }
  if (errors.length > 0 || !id || !name || !folder || !account || !color || !mapping) {
    return { ok: false, errors: errors.length ? errors : ["incomplete definition"] };
  }
  const def: CollectionDef = {
    id,
    name,
    folder,
    account,
    color,
    ...(tz ? { tz } : {}),
    ...(data.readOnly === true ? { readOnly: true } : {}),
    columns,
    mapping,
    ...(newNote ? { newNote } : {}),
    ...(hasReminders(parseReminderDefaults(data.reminders))
      ? { reminders: parseReminderDefaults(data.reminders) }
      : {}),
  };
  const issues = validateModel([{ id, name, columns }], [viewOf(def, false)]).filter(
    (i) => i.severity === "error",
  );
  if (issues.length > 0)
    return { ok: false, errors: issues.map((i) => `${i.where}: ${i.message}`) };
  return { ok: true, def };
}

function parseMapping(m: unknown, errors: string[]): CalendarMapping | null {
  if (!isObj(m)) {
    errors.push("mapping: expected a map");
    return null;
  }
  const opt = (k: string): string | undefined => {
    const v = m[k];
    if (v === undefined) return undefined;
    if (typeof v !== "string") errors.push(`mapping.${k}: expected a column id`);
    return typeof v === "string" ? v : undefined;
  };
  if (typeof m.title !== "string") errors.push("mapping.title: expected a column id");
  const w = m.when;
  let when: CalendarMapping["when"] | null = null;
  if (!isObj(w)) errors.push("mapping.when: expected a map");
  else {
    const col = (k: string) => (typeof w[k] === "string" ? (w[k] as string) : undefined);
    if (w.kind === "split" && col("date")) {
      when = {
        kind: "split",
        date: col("date") as string,
        ...pick({
          startTime: col("startTime"),
          endTime: col("endTime"),
          endDate: col("endDate"),
          allDay: col("allDay"),
          timezone: col("timezone"),
        }),
      };
    } else if (w.kind === "range" && col("start")) {
      when = {
        kind: "range",
        start: col("start") as string,
        ...pick({ end: col("end"), timezone: col("timezone") }),
      };
    } else errors.push('mapping.when: expected kind "split" with date, or "range" with start');
  }
  let task: CalendarMapping["task"];
  if (m.task !== undefined) {
    const t = m.task;
    if (isObj(t) && typeof t.column === "string") {
      task = {
        column: t.column,
        ...(Array.isArray(t.doneValues)
          ? { doneValues: t.doneValues.filter((x): x is string => typeof x === "string") }
          : {}),
        ...(typeof t.openValue === "string" ? { openValue: t.openValue } : {}),
      };
    } else errors.push("mapping.task: needs a column");
  }
  let series: CalendarMapping["series"];
  if (m.series !== undefined) {
    const sr = m.series;
    if (isObj(sr) && typeof sr.id === "string" && typeof sr.rule === "string") {
      series = { id: sr.id, rule: sr.rule };
    } else errors.push("mapping.series: needs id and rule columns");
  }
  if (typeof m.title !== "string" || !when) return null;
  return {
    title: m.title,
    ...pick({
      location: opt("location"),
      description: opt("description"),
      recurrence: opt("recurrence"),
      exdates: opt("exdates"),
      reminders: opt("reminders"),
    }),
    when,
    ...(task ? { task } : {}),
    ...(series ? { series } : {}),
  };
}

const pick = <T extends Record<string, string | undefined>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: string;
  };

const viewOf = (def: CollectionDef, readOnly: boolean): CalendarView => ({
  id: def.id,
  collectionId: def.id,
  accountId: `acc-${def.account.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  color: def.color,
  visible: true,
  ...(readOnly || def.readOnly ? { readOnly: true } : {}),
  ...(def.tz ? { tz: def.tz } : {}),
  mapping: def.mapping,
  ...(def.reminders ? { reminders: def.reminders } : {}),
});

/** Collections, calendar views and sidebar accounts for a set of definitions. */
export function defsToModel(
  defs: readonly CollectionDef[],
  opts: { readOnly: boolean },
): { collections: Collection[]; views: CalendarView[]; accounts: Account[] } {
  const accounts = new Map<string, Account>();
  const views = defs.map((d) => {
    const v = viewOf(d, opts.readOnly);
    if (!accounts.has(v.accountId)) {
      accounts.set(v.accountId, { id: v.accountId, name: d.account, email: d.account });
    }
    return v;
  });
  return {
    collections: defs.map((d) => ({ id: d.id, name: d.name, columns: d.columns })),
    views,
    accounts: [...accounts.values()],
  };
}

/** The row for a note. Every property of the note is kept; the columns decide which ones the calendar shows. */
export function noteToRow(
  def: CollectionDef,
  path: string,
  note: ParsedNote,
  mtimeMs: number,
): Row {
  return {
    id: path,
    collectionId: def.id,
    values: note.values,
    body: note.body,
    created: mtimeMs,
    updated: mtimeMs,
  };
}

/** Rows that cannot be placed on a calendar (no usable date), with the reason. */
export function unplaceableRows(
  model: Model,
  rows: readonly Row[],
): { id: string; reason: string }[] {
  const projector = makeProjector(model);
  const out: { id: string; reason: string }[] = [];
  for (const r of rows) {
    if (model.viewOfCollection.has(r.collectionId) && !projector.event(r)) {
      out.push({ id: r.id, reason: "no-date" });
    }
  }
  return out;
}

const FORBIDDEN = /[\\/:*?"<>|]/g;
const OBSIDIAN_UNSAFE = /[[\]#^]/g;

/**
 * The file name (without ".md") a new note gets: the definition's `newNote.name` pattern with
 * `{column}` replaced by the row's values, cleaned so every file system and Obsidian accept it.
 */
export function noteFileName(def: CollectionDef, values: Record<string, PropValue>): string {
  const pattern = def.newNote?.name ?? "{title}";
  const raw = pattern.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = values[k];
    return v === null || v === undefined ? "" : Array.isArray(v) ? v.join(" ") : String(v);
  });
  return raw
    .replace(FORBIDDEN, "-")
    .replace(OBSIDIAN_UNSAFE, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120)
    .trim();
}

/**
 * `folder/name.md`, or `folder/name 2.md`, `folder/name 3.md`... for the first one `taken` says is free.
 * The counter goes on the file name only; the note's `title` stays as typed.
 */
export function uniqueNotePath(
  folder: string,
  name: string,
  taken: (path: string) => boolean,
): string {
  const base = name || "Sin título";
  let path = `${folder}/${base}.md`;
  for (let n = 2; taken(path); n++) path = `${folder}/${base} ${n}.md`;
  return path;
}

/**
 * Moves a note to another collection: its "Area: [[x]]" line becomes the one of the new collection's
 * template (when both have one), the rest of the body is untouched.
 */
export function withAreaLine(body: string, templateBody: string): string {
  const area = /^Area: \[\[[^\]]*\]\][ \t]*$/m;
  const target = area.exec(templateBody);
  return target && area.test(body) ? body.replace(area, target[0]) : body;
}
