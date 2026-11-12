import {
  codeLabel,
  fieldByName,
  fieldName,
  leaf,
  plain,
  type ReadStore,
  ToolError,
  type ToolRegistry,
  typeByKey,
  typeName,
  type Val,
} from "@boni/agent";
import { formatReminderDefaults, parseReminderDefaults } from "@boni/calendar";
import {
  addCalendar,
  CALENDAR_DEFS,
  calendarCandidates,
  calendarDefs,
  removeCalendar,
  setCalendarColor,
  setCalendarReminders,
  setSplit,
  splitChoices,
  storedCalendarDefs,
} from "./calendarStore.ts";
import type { DataService } from "./dataActions.ts";

/**
 * The actions of the area «Calendarios» (docs/sistema.md §4.1, F10): which of Juan's collections show as calendars in
 * Boni Calendar, each one's colour, its split by a field (D-24) and its reminders. The planner, a flow and an
 * assistant run the same code as Boni Calendar's routes (calendarStore.ts), on the store's calendar definitions; the
 * run keeps what each changed (runUndo.ts), so Undo of the run takes it back. A calendar of a collection closed to the
 * models is not there for them. Taking a calendar away is Juan's card (P5); its records stay.
 */

const code = codeLabel("calendars");
const serviceOf = (s: unknown): DataService => {
  if (!s || typeof s !== "object" || !("store" in s)) throw new ToolError("not-available");
  return s as DataService;
};
const str = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  if (typeof x !== "string" || !x.trim()) throw new ToolError("bad-argument");
  return x.trim();
};
const calendar = {
  role: "option",
  required: true,
  describe: "the calendar's id (calendars.list)",
} as const;

/** The calendars the models may see: each one's collection open to them. */
function seen(s: DataService, visible: (type: string) => boolean) {
  const schema = s.store.schema();
  return calendarDefs(s.store)
    .filter((p) => visible(p.type))
    .map((p) => {
      const t = schema.types[p.type];
      const stored = storedCalendarDefs(s.store).find(
        (x) => x.raw.id === (p.path?.[0]?.id ?? p.def.id),
      );
      const splitBy =
        !p.where && stored?.split ? t?.fields.find((f) => f.id === stored.split?.field) : undefined;
      return {
        id: p.def.id,
        name: p.def.name,
        collection: t ? typeName(t) : p.type,
        color: p.def.color,
        ...(splitBy ? { split: fieldName(splitBy) } : {}),
        ...(p.group ? { under: p.group.id } : {}),
      };
    });
}

/** Every change of a calendar rewrites Boni Calendar's definitions: its run keeps them for Undo. */
const keeps = () => [CALENDAR_DEFS];

/**
 * A card names the calendar by its name, as Boni Calendar shows it (its id is its collection's key), from the calendars
 * the models may see: one they may not see keeps its id alone (docs/sistema.md §4.1).
 */
function names(
  c: { store: ReadStore; service?: unknown },
  a: Readonly<Record<string, Val>>,
): Record<string, string> {
  const id = a.calendar ? plain(a.calendar) : null;
  if (typeof id !== "string" || !c.service) return {};
  const found = seen(serviceOf(c.service), (t) => !!c.store.schema().types[t]).find(
    (x) => x.id === id,
  );
  return found?.name ? { calendar: found.name } : {};
}

export function withCalendarActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "calendars.list",
    icon: "Calendar",
    effect: "read",
    area: "calendars",
    service: "data",
    title: "Ver calendarios",
    describe:
      "Juan's calendars in Boni Calendar: each one's id, name, collection, colour, the field it is split by and the calendar a split one is under; and the collections that could be one",
    args: {},
    run(c) {
      const s = serviceOf(c.service);
      const visible = (type: string) => !!c.store.schema().types[type];
      return leaf(
        {
          calendars: seen(s, visible),
          could: calendarCandidates(s.store)
            .filter((x) => visible(x.type))
            .map((x) => typeName(c.store.schema().types[x.type] as never)),
        } as never,
        code,
      );
    },
  });
  r.register({
    name: "calendars.add",
    keeps,
    icon: "CalendarPlus",
    undo: ["run"],
    effect: "write",
    area: "calendars",
    service: "data",
    title: "Añadir calendario",
    describe:
      "Show one of Juan's collections with a date as a calendar in Boni Calendar (type: its key), with the first colour free",
    args: { type: { role: "type", required: true, describe: "the collection" } },
    run(c, a) {
      const s = serviceOf(c.service);
      const t = typeByKey(c.store, str(a.type));
      const made = addCalendar(s.store, t.id);
      if (!made) throw new ToolError("not-a-candidate");
      return leaf({ id: made.id, collection: typeName(t) }, code);
    },
  });
  r.register({
    name: "calendars.remove",
    keeps,
    names,
    icon: "CalendarX",
    undo: ["run"],
    effect: "write",
    area: "calendars",
    service: "data",
    // Taking a calendar away is Juan's card (P5): the collection and its records stay, and Undo brings it back.
    alwaysConfirm: true,
    title: "Quitar calendario",
    describe:
      "Stop showing a calendar in Boni Calendar (a split one goes whole); its collection and its records stay; he confirms it",
    args: { calendar },
    run(c, a) {
      const s = serviceOf(c.service);
      const id = str(a.calendar);
      // A split one by any calendar it makes or by the definition itself (Boni Calendar sends the definition's id).
      const visible = calendarDefs(s.store).some(
        (p) =>
          (p.def.id === id || p.path?.some((n) => n.id === id)) && !!c.store.schema().types[p.type],
      );
      if (!visible || !removeCalendar(s.store, id)) throw new ToolError("no-such-calendar");
      return leaf({ removed: id }, code);
    },
  });
  r.register({
    name: "calendars.split",
    keeps,
    names,
    icon: "Split",
    undo: ["run"],
    effect: "write",
    area: "calendars",
    service: "data",
    title: "Separar por",
    describe:
      "Split a calendar into one per value of a field of its collection (field: its key), or make it whole again (field null); a calendar a split made can be split again",
    args: {
      calendar,
      field: { role: "field", describe: "the field it is split by; null: whole again" },
    },
    run(c, a) {
      const s = serviceOf(c.service);
      const id = str(a.calendar);
      const placed = calendarDefs(s.store).find(
        (p) =>
          (p.def.id === id || p.path?.some((n) => n.id === id)) && !!c.store.schema().types[p.type],
      );
      if (!placed) throw new ToolError("no-such-calendar");
      const name = a.field ? plain(a.field) : null;
      let field: string | null = null;
      if (name !== null) {
        const t = c.store.schema().types[placed.type];
        const f = t && typeof name === "string" ? fieldByName(t, name) : undefined;
        if (!f || !splitChoices(s.store.schema(), placed.type).some((x) => x.id === f.id))
          throw new ToolError("bad-field");
        field = f.id;
      }
      const r = setSplit(s.store, id, field);
      if (r !== "ok") throw new ToolError(r);
      return leaf({ calendar: id, split: name === null ? null : String(name) }, code);
    },
  });
  r.register({
    name: "calendars.color",
    keeps,
    names,
    icon: "Palette",
    undo: ["run"],
    effect: "write",
    area: "calendars",
    service: "data",
    title: "Color del calendario",
    describe: "Change a calendar's colour (#rrggbb)",
    args: { calendar, color: { role: "value", required: true, describe: "#rrggbb" } },
    run(c, a) {
      const s = serviceOf(c.service);
      const id = str(a.calendar);
      const color = str(a.color);
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ToolError("bad-color");
      if (!seen(s, (t) => !!c.store.schema().types[t]).some((x) => x.id === id))
        throw new ToolError("no-such-calendar");
      const ok = setCalendarColor(s.store, id, color);
      if (!ok) throw new ToolError("no-such-calendar");
      return leaf({ calendar: id, color }, code);
    },
  });
  r.register({
    name: "calendars.reminders",
    keeps,
    names,
    icon: "BellRing",
    undo: ["run"],
    effect: "write",
    area: "calendars",
    service: "data",
    title: "Avisos del calendario",
    describe:
      'A calendar\'s own reminders: timed events "10m, 1h, 2d" (before they start), all-day ones "0d@09:00, 1d@18:00"; "none" for none',
    args: {
      calendar,
      timed: { role: "value", describe: 'for timed events: "10m, 1h"; "none"' },
      all_day: { role: "value", describe: 'for all-day events: "0d@09:00"; "none"' },
    },
    run(c, a) {
      const s = serviceOf(c.service);
      const id = str(a.calendar);
      if (!a.timed && !a.all_day) throw new ToolError("bad-argument");
      const placed = seen(s, (t) => !!c.store.schema().types[t]).find((x) => x.id === id);
      if (!placed) throw new ToolError("no-such-calendar");
      const kept = calendarDefs(s.store).find((p) => p.def.id === id)?.raw.reminders as
        | Record<string, unknown>
        | undefined;
      // Only what parses as reminders is written (never free text into a definition), as the route does.
      const reminders = formatReminderDefaults(
        parseReminderDefaults({
          timed: a.timed ? String(plain(a.timed)) : kept?.timed,
          allDay: a.all_day ? String(plain(a.all_day)) : kept?.allDay,
        }),
      );
      const r = setCalendarReminders(s.store, id, { reminders });
      if (r !== "ok") throw new ToolError("no-such-calendar");
      return leaf({ calendar: id, ...reminders }, code);
    },
  });
  return r;
}
