// What a collection can do, by the roles its fields play (docs/clases.md §6): the interfaces Calendario, Tareas and Dinero.
import { ancestors, type FieldId, type FieldType, type Schema, type TypeId } from "./schema.ts";

/**
 * A role a field plays for the apps (docs/clases.md §6, Juan 2026-11-01): the apps use a collection by what it can do,
 * never by its name. An interface is a set of roles:
 * - «Calendario» (`dated`): `date` (a day) or `start` (an instant); with `date`, maybe `time`, `endTime` and `endDate`;
 *   with `start`, maybe `end`.
 * - «Tareas» (`doable`): `done`, the box that marks a record done.
 * - «Dinero» (`money`): `amount` and a `date` or `start`; maybe `category`.
 */
export type Role =
  | "date"
  | "start"
  | "time"
  | "endTime"
  | "endDate"
  | "end"
  | "done"
  | "amount"
  | "category";

/** The field types each role takes. */
export const ROLE_TYPES: Readonly<Record<Role, readonly FieldType[]>> = {
  date: ["date"],
  start: ["datetime"],
  time: ["time"],
  endTime: ["time"],
  endDate: ["date"],
  end: ["datetime"],
  done: ["checkbox"],
  amount: ["number", "money"],
  category: ["select", "relation"],
};
export const ROLES = Object.keys(ROLE_TYPES) as Role[];

/** The fields that play roles in a collection, by role. */
export type Roles = Partial<Record<Role, FieldId>>;

export type Interface = "dated" | "doable" | "money";

/** What a set of roles makes: a collection with a day is a calendar, with a box it keeps tasks, with an amount money. */
export function interfacesOf(roles: Roles): Interface[] {
  const dated = !!(roles.date || roles.start);
  return [
    ...(dated ? (["dated"] as const) : []),
    ...(roles.done ? (["doable"] as const) : []),
    ...(roles.amount && dated ? (["money"] as const) : []),
  ];
}

/**
 * Why these roles cannot go together (null when they can): a day or an instant, not both; the time and the end day
 * only with a day, the end instant only with an instant; and each field plays one role.
 */
export function rolesProblem(roles: Roles): string | null {
  if (roles.date && roles.start)
    return 'a collection has a day ("date") or an instant ("start"), not both';
  for (const r of ["time", "endTime", "endDate"] as const)
    if (roles[r] && !roles.date) return `"${r}" goes with a day ("date")`;
  if (roles.end && !roles.start) return '"end" goes with an instant ("start")';
  const fields = Object.values(roles);
  if (new Set(fields).size !== fields.length) return "a field plays one role";
  return null;
}

/**
 * The roles a collection plays: its own and, for each role it does not name, its mother's (her fields are its fields,
 * with the same ids), up to the root. Only roles whose field it has, not archived, and of a type the role takes: a role
 * whose field was removed plays nothing.
 */
export function rolesOf(schema: Schema, type: TypeId): Roles {
  const def = schema.types[type];
  if (!def) return {};
  const merged: Roles = {};
  for (const t of [...ancestors(schema, type)].reverse().concat(type))
    Object.assign(merged, schema.types[t]?.roles ?? {});
  const out: Roles = {};
  for (const r of ROLES) {
    const id = merged[r];
    const f = id ? def.fields.find((x) => x.id === id && !x.archived) : undefined;
    if (f && ROLE_TYPES[r].includes(f.type)) out[r] = f.id;
  }
  return out;
}
