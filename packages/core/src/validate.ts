import type { CalendarView, Collection, ColumnType } from "./collections.ts";

export interface ModelIssue {
  severity: "error" | "warning";
  /** Where, e.g. `view "teaching" / mapping.when.date`. */
  where: string;
  message: string;
}

/**
 * Checks hand-written collection and view definitions: duplicate ids, mappings that point to
 * missing columns or columns of the wrong type, unusable task columns. Errors mean the calendar
 * cannot work; warnings mean data may be lost on edit.
 */
export function validateModel(
  collections: readonly Collection[],
  views: readonly CalendarView[],
): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const err = (where: string, message: string) =>
    issues.push({ severity: "error", where, message });
  const warn = (where: string, message: string) =>
    issues.push({ severity: "warning", where, message });

  const byId = new Map<string, Collection>();
  for (const c of collections) {
    if (byId.has(c.id)) err(`collection "${c.id}"`, "duplicate collection id");
    byId.set(c.id, c);
    const cols = new Set<string>();
    for (const col of c.columns) {
      const w = `collection "${c.id}" / column "${col.id}"`;
      if (cols.has(col.id)) err(w, "duplicate column id");
      cols.add(col.id);
      if (col.type === "relation") {
        if (!col.target) err(w, "relation column without a target");
        else if (!collections.some((x) => x.id === col.target)) {
          err(w, `relation target "${col.target}" does not exist`);
        }
      }
    }
  }

  const seenViews = new Set<string>();
  const seenColl = new Set<string>();
  for (const v of views) {
    const where = `view "${v.id}"`;
    if (seenViews.has(v.id)) err(where, "duplicate view id");
    seenViews.add(v.id);
    const coll = byId.get(v.collectionId);
    if (!coll) {
      err(where, `collection "${v.collectionId}" does not exist`);
      continue;
    }
    if (seenColl.has(v.collectionId)) {
      err(where, `collection "${v.collectionId}" already has a calendar view (one per collection)`);
    }
    seenColl.add(v.collectionId);

    const m = v.mapping;
    const need = (path: string, id: string | undefined, types: ColumnType[], optional = true) => {
      if (id === undefined) {
        if (!optional) err(`${where} / ${path}`, "required column is not mapped");
        return;
      }
      if (id === "$body") return;
      const col = coll.columns.find((c) => c.id === id);
      if (!col) err(`${where} / ${path}`, `column "${id}" does not exist`);
      else if (!types.includes(col.type)) {
        err(`${where} / ${path}`, `column "${id}" is ${col.type}, expected ${types.join(" or ")}`);
      }
    };
    need("title", m.title, ["text"], false);
    need("location", m.location, ["text"]);
    need("description", m.description, ["text"]);
    need("recurrence", m.recurrence, ["text"]);
    need("exdates", m.exdates, ["dates"]);
    const w = m.when;
    if (w.kind === "split") {
      need("when.date", w.date, ["date"], false);
      need("when.startTime", w.startTime, ["time"]);
      need("when.endTime", w.endTime, ["time"]);
      need("when.endDate", w.endDate, ["date"]);
      need("when.allDay", w.allDay, ["checkbox"]);
      need("when.timezone", w.timezone, ["text"]);
      if (!w.endDate) {
        warn(`${where} / when.endDate`, "no end-date column: events that span days lose their end");
      }
    } else {
      need("when.start", w.start, ["date", "datetime"], false);
      need("when.end", w.end, ["date", "datetime"]);
      need("when.timezone", w.timezone, ["text"]);
    }
    if (m.task) {
      need("task.column", m.task.column, ["checkbox", "select"], false);
      const col = coll.columns.find((c) => c.id === m.task?.column);
      if (col?.type === "select") {
        const ids = new Set((col.options ?? []).map((o) => o.id));
        if (!m.task.doneValues?.length)
          err(`${where} / task.doneValues`, "a select task column needs doneValues");
        for (const d of m.task.doneValues ?? []) {
          if (!ids.has(d))
            err(`${where} / task.doneValues`, `"${d}" is not an option of the column`);
        }
        const open = m.task.openValue ?? [...ids].find((o) => !m.task?.doneValues?.includes(o));
        if (!open)
          err(`${where} / task.openValue`, "no open state: add an option that is not a done value");
        else if (!ids.has(open))
          err(`${where} / task.openValue`, `"${open}" is not an option of the column`);
      }
    }
  }
  return issues;
}
