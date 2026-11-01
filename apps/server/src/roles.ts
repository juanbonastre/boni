// The roles of each collection worked out from what already says them: its calendar's definition and the money's movements.
import { randomUUID } from "node:crypto";
import {
  type FieldDef,
  ROLE_TYPES,
  type Role,
  type Roles,
  rolesOf,
  rolesProblem,
} from "@boni/entities";
import type { UserStore } from "@boni/store";
import { calendarDefs } from "./calendarStore.ts";

/**
 * What each collection can do, worked out from what already says it (docs/clases.md §6: the roles go from each
 * calendar's definition and the money's code to the collection). A calendar's definition names by column its day, its
 * times, its end and its task box; the money's movements have their amount, day and category. Only roles a collection
 * does not play yet, with a field of the kind the role takes. A dry run lists them; applied, they are one run that
 * `undoRoles` takes back whole.
 */
export interface RolesFound {
  type: string;
  /** The collection's name, for the lines Juan reads. */
  name: string;
  roles: Roles;
  /** Where they come from, as a line says it («de su calendario «Agenda»»). */
  from: string;
}

/** The roles in the words of the app (docs/design-guide.md §5: short). */
const SAID: Record<Role, string> = {
  date: "día",
  start: "inicio",
  time: "hora",
  endTime: "hora de fin",
  endDate: "día de fin",
  end: "fin",
  done: "hecha",
  amount: "importe",
  category: "categoría",
};

/** The money's movements (the money's code still names its collection: the transition, AGENTS.md). */
const MOVEMENTS = "t_movimiento";
const MONEY_FIELDS: [Role, string][] = [
  ["amount", "amount"],
  ["date", "date"],
  ["category", "category"],
];

export function rolesToSet(store: UserStore): { found: RolesFound[]; problems: string[] } {
  const schema = store.schema();
  const found = new Map<string, RolesFound>();
  const problems: string[] = [];
  const add = (type: string, role: Role, field: FieldDef | undefined, from: string) => {
    const def = schema.types[type];
    if (!def || !field || field.archived || !ROLE_TYPES[role].includes(field.type)) return;
    if (rolesOf(schema, type)[role]) return;
    const f = found.get(type) ?? { type, name: def.name, roles: {}, from };
    f.roles[role] = field.id;
    found.set(type, f);
  };

  // Each calendar: its mapping's columns are fields of its collection, by name (or by the column's id as key).
  for (const p of calendarDefs(store)) {
    const def = schema.types[p.type];
    if (!def) continue;
    const fieldOf = (col: string | undefined) => {
      if (!col) return undefined;
      const name = p.def.columns.find((c) => c.id === col)?.name ?? col;
      return def.fields.find((f) => (f.name === name || f.key === col) && !f.archived);
    };
    const m = p.def.mapping;
    const from = `de su calendario «${p.def.name}»`;
    if (m.when.kind === "split") {
      add(p.type, "date", fieldOf(m.when.date), from);
      add(p.type, "time", fieldOf(m.when.startTime), from);
      add(p.type, "endTime", fieldOf(m.when.endTime), from);
      add(p.type, "endDate", fieldOf(m.when.endDate), from);
    } else {
      add(p.type, "start", fieldOf(m.when.start), from);
      add(p.type, "end", fieldOf(m.when.end), from);
    }
    // A status column (a select) marks tasks too, but the role takes a box: it stays in the calendar for now.
    add(p.type, "done", fieldOf(m.task?.column), from);
  }

  // The money's movements.
  const mov = schema.types[MOVEMENTS];
  if (mov && !mov.archived)
    for (const [role, name] of MONEY_FIELDS)
      add(
        MOVEMENTS,
        role,
        mov.fields.find((f) => f.name === name && !f.archived),
        "del código del dinero",
      );

  // What a collection would play with them still has to make sense (its mother's roles count).
  for (const f of found.values()) {
    const problem = rolesProblem({ ...rolesOf(schema, f.type), ...f.roles });
    if (problem) {
      problems.push(`${f.name}: ${problem}`);
      found.delete(f.type);
    }
  }
  return { found: [...found.values()], problems };
}

/** One line per collection, as Juan reads them: «Agenda: día → Fecha, hecha → Hecha (de su calendario «Agenda»)». */
export function rolesLines(store: UserStore, found: readonly RolesFound[]): string[] {
  const types = store.schema().types;
  return found.map((f) => {
    const fields = types[f.type]?.fields ?? [];
    const parts = (Object.entries(f.roles) as [Role, string][]).map(
      ([r, id]) => `${SAID[r]} → ${fields.find((x) => x.id === id)?.name ?? id}`,
    );
    return `${f.name}: ${parts.join(", ")} (${f.from})`;
  });
}

/** The roles set, in one run; null when there was nothing to set. */
export function applyRoles(
  store: UserStore,
  found: readonly RolesFound[],
  device = "roles",
): string | null {
  if (!found.length) return null;
  const run = `roles-${randomUUID()}`;
  store.batch(() => {
    for (const f of found)
      store.applySchema(
        { op: "set_roles", type: f.type, roles: f.roles },
        { actor: "user", device, run },
      );
  });
  return run;
}

/** Takes the roles of a run back, all of them. */
export function undoRoles(store: UserStore, run: string, device = "roles"): number {
  return store.undoRun(run, { actor: "user", device }).length;
}
