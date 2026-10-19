import {
  type CalendarMapping,
  type Collection,
  type Column,
  type ColumnType,
  mappedColumns,
} from "./collections.ts";

/** The calendar roles a user can assign to a column from the UI (title, place and notes stay fixed). */
export type MappingRole = "date" | "startTime" | "endTime" | "endDate" | "start" | "end" | "task";

/** Roles that exist for this mapping, in display order; the first one is always required. */
export function rolesOf(m: CalendarMapping): MappingRole[] {
  return m.when.kind === "split"
    ? ["date", "startTime", "endTime", "endDate", "task"]
    : ["start", "end", "task"];
}

export const isRequired = (role: MappingRole): boolean => role === "date" || role === "start";

const ACCEPTS: Record<MappingRole, ColumnType[]> = {
  date: ["date"],
  startTime: ["time"],
  endTime: ["time"],
  endDate: ["date"],
  start: ["date", "datetime"],
  end: ["date", "datetime"],
  task: ["checkbox", "select"],
};

/** The column currently playing `role`, if any. */
export function columnOfRole(m: CalendarMapping, role: MappingRole): string | undefined {
  if (role === "task") return m.task?.column;
  const w = m.when;
  if (w.kind === "split") {
    return role === "date"
      ? w.date
      : role === "startTime"
        ? w.startTime
        : role === "endTime"
          ? w.endTime
          : role === "endDate"
            ? w.endDate
            : undefined;
  }
  return role === "start" ? w.start : role === "end" ? w.end : undefined;
}

/** Columns that can take `role`: right type, and not used by another part of the mapping. */
export function candidateColumns(
  coll: Collection,
  m: CalendarMapping,
  role: MappingRole,
): Column[] {
  const current = columnOfRole(m, role);
  const used = mappedColumns(m);
  return coll.columns.filter((c) => {
    if (!ACCEPTS[role].includes(c.type)) return false;
    if (c.id !== current && used.has(c.id)) return false;
    // A status column needs at least a done and an open option to be a task column.
    return role !== "task" || c.type !== "select" || (c.options?.length ?? 0) >= 2;
  });
}

/**
 * The mapping with `role` given to `columnId` (undefined clears an optional role). A status column
 * starts with its last option as the "done" value.
 */
export function assignRole(
  m: CalendarMapping,
  coll: Collection,
  role: MappingRole,
  columnId: string | undefined,
): CalendarMapping {
  if (columnId === undefined && isRequired(role)) return m;
  if (role === "task") {
    if (columnId === undefined) {
      const { task: _t, ...rest } = m;
      return rest;
    }
    const col = coll.columns.find((c) => c.id === columnId);
    if (col?.type === "select") {
      const last = col.options?.[col.options.length - 1]?.id;
      return { ...m, task: { column: columnId, doneValues: last ? [last] : [] } };
    }
    return { ...m, task: { column: columnId } };
  }
  const when: Record<string, unknown> = { ...m.when };
  if (columnId === undefined) delete when[role];
  else when[role] = columnId;
  return { ...m, when: when as CalendarMapping["when"] };
}

/** Which options of a status task column count as done. */
export function setDoneValues(m: CalendarMapping, doneValues: string[]): CalendarMapping {
  if (!m.task) return m;
  const { openValue: _o, ...task } = m.task;
  return { ...m, task: { ...task, doneValues } };
}
