import type {
  Account,
  CalEvent,
  CalendarData,
  CalendarDef,
  PropertyDef,
  SelectOption,
} from "./model.ts";
import { type CivilDay, fromLocal, MS_MIN } from "./time.ts";

/** Small deterministic PRNG (mulberry32): the sample data is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PALETTE = {
  violet: "#a78bfa",
  orange: "#fb923c",
  coral: "#f87171",
  amber: "#fbbf24",
  green: "#4ade80",
  teal: "#2dd4bf",
  sky: "#38bdf8",
  blue: "#60a5fa",
  pink: "#f472b6",
  red: "#ef4444",
  slate: "#94a3b8",
} as const;

const opt = (id: string, label: string, color: string): SelectOption => ({ id, label, color });

const text = (id: string, name: string): PropertyDef => ({ id, name, type: "text" });
const select = (id: string, name: string, options: SelectOption[]): PropertyDef => ({
  id,
  name,
  type: "select",
  options,
});

const SCHEMA_TEACHING: PropertyDef[] = [
  select("subject", "Asignatura", [
    opt("fup", "FUP", PALETTE.blue),
    opt("ipm", "IPM", PALETTE.violet),
    opt("sd", "Sistemas distribuidos", PALETTE.teal),
  ]),
  select("group", "Grupo", [
    opt("g1", "Grupo 1", PALETTE.sky),
    opt("g2", "Grupo 2", PALETTE.amber),
  ]),
  text("room", "Aula"),
  { id: "hours", name: "Horas", type: "number" },
  { id: "graded", name: "Evaluable", type: "checkbox" },
  { id: "project", name: "Proyecto", type: "project" },
];

const SCHEMA_SPORT: PropertyDef[] = [
  select("kind", "Tipo", [
    opt("run", "Correr", PALETTE.orange),
    opt("gym", "Gimnasio", PALETTE.coral),
    opt("swim", "Natación", PALETTE.sky),
  ]),
  { id: "km", name: "Distancia (km)", type: "number" },
  select("effort", "Intensidad", [
    opt("low", "Suave", PALETTE.green),
    opt("high", "Fuerte", PALETTE.red),
  ]),
];

const SCHEMA_PLANS: PropertyDef[] = [
  {
    id: "people",
    name: "Con quien",
    type: "multiselect",
    options: [
      opt("ana", "Ana", PALETTE.pink),
      opt("leo", "Leo", PALETTE.blue),
      opt("eva", "Eva", PALETTE.green),
    ],
  },
  { id: "link", name: "Enlace", type: "url" },
];

const SCHEMA_ADMIN: PropertyDef[] = [
  select("status", "Estado", [
    opt("todo", "Pendiente", PALETTE.slate),
    opt("done", "Hecho", PALETTE.green),
  ]),
  { id: "due", name: "Fecha límite", type: "date" },
];

export const SAMPLE_TZ = "Europe/Madrid";

export function sampleAccountsAndCalendars(): Pick<
  CalendarData,
  "accounts" | "calendars" | "projects"
> {
  const accounts: Account[] = [
    { id: "acc-personal", name: "Personal", email: "ejemplo.personal@example.com" },
    { id: "acc-work", name: "Trabajo", email: "ejemplo.trabajo@example.org" },
    { id: "acc-other", name: "Suscripciones", email: "suscripciones" },
  ];
  const cal = (
    id: string,
    accountId: string,
    name: string,
    color: string,
    schema: PropertyDef[] = [],
    visible = true,
    readOnly = false,
  ): CalendarDef => ({ id, accountId, name, color, visible, readOnly, schema });
  const calendars: CalendarDef[] = [
    cal("main", "acc-personal", "Principal", PALETTE.violet),
    cal("sport", "acc-personal", "Deporte", PALETTE.orange, SCHEMA_SPORT),
    cal("study", "acc-personal", "Estudio", PALETTE.amber),
    cal("health", "acc-personal", "Médico", PALETTE.coral),
    cal("music", "acc-personal", "Música", PALETTE.pink),
    cal("plans", "acc-personal", "Quedadas", PALETTE.green, SCHEMA_PLANS),
    cal("transport", "acc-personal", "Transporte", PALETTE.slate),
    cal("teaching", "acc-work", "Docencia", PALETTE.blue, SCHEMA_TEACHING),
    cal("meetings", "acc-work", "Reuniones", PALETTE.teal),
    cal("admin", "acc-work", "Gestiones", PALETTE.red, SCHEMA_ADMIN, true),
    cal("holidays", "acc-other", "Festivos", PALETTE.sky, [], false, true),
  ];
  const projects = [
    { id: "p-web", name: "App de calendario" },
    { id: "p-thesis", name: "Tutoría de TFG" },
    { id: "p-course", name: "Curso 2026-27" },
  ];
  return { accounts, calendars, projects };
}

interface Template {
  /** 1 = Monday .. 7 = Sunday */
  dow: number;
  from: string;
  to: string;
  title: string;
  calendarId: string;
  props?: Record<string, string | number | boolean | string[]>;
  location?: string;
  /** Probability the event happens on a given week. */
  p?: number;
}

const TEMPLATES: Template[] = [
  {
    dow: 1,
    from: "09:00",
    to: "11:00",
    title: "Clase FUP",
    calendarId: "teaching",
    props: { subject: "fup", group: "g1", room: "A-201", hours: 2 },
    location: "Aula A-201",
  },
  {
    dow: 1,
    from: "11:15",
    to: "13:15",
    title: "Clase FUP",
    calendarId: "teaching",
    props: { subject: "fup", group: "g2", room: "A-203", hours: 2 },
    location: "Aula A-203",
  },
  {
    dow: 1,
    from: "19:00",
    to: "20:30",
    title: "Gimnasio",
    calendarId: "sport",
    props: { kind: "gym", effort: "high" },
  },
  {
    dow: 2,
    from: "10:00",
    to: "12:00",
    title: "Clase IPM",
    calendarId: "teaching",
    props: { subject: "ipm", group: "g1", room: "B-105", hours: 2 },
    location: "Aula B-105",
  },
  {
    dow: 2,
    from: "13:00",
    to: "14:00",
    title: "Comer con Ana",
    calendarId: "plans",
    props: { people: ["ana"] },
    p: 0.4,
  },
  { dow: 2, from: "16:30", to: "18:30", title: "Estudio", calendarId: "study" },
  { dow: 3, from: "08:30", to: "09:00", title: "Tren a la universidad", calendarId: "transport" },
  {
    dow: 3,
    from: "09:00",
    to: "09:45",
    title: "Reunión de departamento",
    calendarId: "meetings",
    p: 0.6,
  },
  {
    dow: 3,
    from: "12:00",
    to: "14:00",
    title: "Tutoría de TFG",
    calendarId: "meetings",
    props: {},
    p: 0.7,
  },
  {
    dow: 3,
    from: "18:00",
    to: "19:00",
    title: "Correr",
    calendarId: "sport",
    props: { kind: "run", km: 7, effort: "low" },
  },
  {
    dow: 4,
    from: "10:00",
    to: "12:00",
    title: "Clase Sistemas distribuidos",
    calendarId: "teaching",
    props: { subject: "sd", group: "g2", room: "C-010", hours: 2 },
    location: "Aula C-010",
  },
  { dow: 4, from: "17:00", to: "18:00", title: "Clase de guitarra", calendarId: "music" },
  {
    dow: 4,
    from: "20:30",
    to: "22:00",
    title: "Cena con Leo y Eva",
    calendarId: "plans",
    props: { people: ["leo", "eva"] },
    p: 0.35,
  },
  {
    dow: 5,
    from: "09:30",
    to: "10:30",
    title: "Gestión de actas",
    calendarId: "admin",
    props: { status: "todo" },
    p: 0.5,
  },
  {
    dow: 5,
    from: "11:00",
    to: "13:00",
    title: "Clase FUP",
    calendarId: "teaching",
    props: { subject: "fup", group: "g1", room: "A-201", hours: 2 },
    location: "Aula A-201",
  },
  {
    dow: 5,
    from: "17:30",
    to: "19:00",
    title: "Natación",
    calendarId: "sport",
    props: { kind: "swim", effort: "low" },
    p: 0.6,
  },
  {
    dow: 6,
    from: "10:00",
    to: "11:30",
    title: "Correr",
    calendarId: "sport",
    props: { kind: "run", km: 10, effort: "high" },
    p: 0.7,
  },
  {
    dow: 6,
    from: "21:00",
    to: "23:30",
    title: "Cine",
    calendarId: "plans",
    props: { people: ["ana"] },
    p: 0.3,
  },
  { dow: 7, from: "12:00", to: "14:30", title: "Comida familiar", calendarId: "main", p: 0.5 },
  { dow: 7, from: "18:00", to: "19:30", title: "Preparar clases", calendarId: "study" },
];

const hhmm = (s: string): number => {
  const [h = "0", m = "0"] = s.split(":");
  return Number(h) * 60 + Number(m);
};

/**
 * Invented sample events around `anchorDay`: a weekly pattern over `weeksBefore`/`weeksAfter`
 * weeks plus hand-placed events (overlaps, all-day bars, multi-day, a task, a night event) in the
 * anchor's week so the grid always has something interesting on screen.
 */
export function generateSample(opts: {
  anchorDay: CivilDay;
  tz?: string;
  weeksBefore?: number;
  weeksAfter?: number;
  seed?: number;
  /** Day (civil) used to place the handcrafted showcase events; defaults to the anchor's Monday. */
}): CalendarData {
  const tz = opts.tz ?? SAMPLE_TZ;
  const random = rng(opts.seed ?? 7);
  const before = opts.weeksBefore ?? 26;
  const after = opts.weeksAfter ?? 26;
  const base = sampleAccountsAndCalendars();
  const events: CalEvent[] = [];
  const stamp = fromLocal(opts.anchorDay - 3, 600, tz);
  let n = 0;

  const push = (
    e: Omit<
      CalEvent,
      "id" | "created" | "updated" | "description" | "location" | "isTask" | "done" | "props"
    > &
      Partial<CalEvent>,
  ) => {
    n++;
    events.push({
      id: `ev-${String(n).padStart(5, "0")}`,
      location: "",
      description: "",
      props: {},
      isTask: false,
      done: false,
      created: stamp,
      updated: stamp,
      ...e,
    });
  };

  const monday = opts.anchorDay - ((((opts.anchorDay + 4) % 7) + 6) % 7);
  for (let w = -before; w <= after; w++) {
    const weekStart = monday + w * 7;
    for (const t of TEMPLATES) {
      if (t.p !== undefined && random() > t.p) continue;
      const day = weekStart + (t.dow - 1);
      push({
        calendarId: t.calendarId,
        title: t.title,
        when: {
          kind: "timed",
          start: fromLocal(day, hhmm(t.from), tz),
          end: fromLocal(day, hhmm(t.to), tz),
          tz,
        },
        location: t.location ?? "",
        props: t.props ?? {},
      });
    }
  }

  const at = (dayOffset: number, from: string, to: string) => ({
    kind: "timed" as const,
    start: fromLocal(monday + dayOffset, hhmm(from), tz),
    end: fromLocal(monday + dayOffset, hhmm(to), tz),
    tz,
  });

  // Showcase events in the anchor's week.
  push({
    calendarId: "teaching",
    title: "Bienvenida de curso",
    when: at(2, "11:00", "14:00"),
    location: "Salón de actos",
    props: { hours: 3, graded: false },
    description: "Presentación de la asignatura y del calendario de entregas.",
  });
  push({ calendarId: "meetings", title: "Revisión de proyecto", when: at(2, "12:30", "13:30") });
  push({
    calendarId: "health",
    title: "Dentista",
    when: at(0, "13:00", "14:15"),
    location: "Clínica Centro",
  });
  push({ calendarId: "study", title: "Formación en línea", when: at(2, "16:00", "19:00") });
  push({
    calendarId: "plans",
    title: "Película en versión original",
    when: at(4, "20:00", "23:00"),
    props: { people: ["ana", "leo"] },
  });
  push({
    calendarId: "plans",
    title: "Fiesta de cumpleaños",
    when: {
      kind: "timed",
      start: fromLocal(monday + 5, hhmm("22:00"), tz),
      end: fromLocal(monday + 6, hhmm("02:30"), tz),
      tz,
    },
    location: "Casa de Eva",
    props: { people: ["eva", "ana"] },
  });
  push({
    calendarId: "main",
    title: "Llamar al banco",
    when: at(1, "09:00", "09:15"),
    isTask: true,
  });
  push({
    calendarId: "main",
    title: "Entregar el informe",
    when: at(3, "15:00", "15:30"),
    isTask: true,
    done: true,
  });
  push({
    calendarId: "admin",
    title: "Jornada de acogida (no asistir)",
    when: { kind: "allday", startDay: monday + 2, endDay: monday + 4 },
  });
  push({
    calendarId: "main",
    title: "Vacaciones de Leo",
    when: { kind: "allday", startDay: monday + 4, endDay: monday + 8 },
  });
  push({
    calendarId: "main",
    title: "Cumpleaños de Eva",
    when: { kind: "allday", startDay: monday + 5, endDay: monday + 5 },
  });
  push({
    calendarId: "holidays",
    title: "Día festivo local",
    when: { kind: "allday", startDay: monday + 3, endDay: monday + 3 },
  });
  // Overlaps: three events at once and a chain.
  push({ calendarId: "study", title: "Biblioteca", when: at(3, "10:00", "12:30") });
  push({ calendarId: "meetings", title: "Llamada rapida", when: at(3, "10:30", "11:00") });
  push({ calendarId: "main", title: "Recado", when: at(3, "11:00", "11:45") });
  push({
    calendarId: "sport",
    title: "Clase de yoga",
    when: at(1, "07:30", "08:30"),
    props: { kind: "gym", effort: "low" },
  });

  // A few more all-day items spread over later weeks so the month view is not empty.
  for (let w = -4; w <= 8; w++) {
    if (random() < 0.5) {
      const d = monday + w * 7 + Math.floor(random() * 7);
      push({
        calendarId: random() < 0.5 ? "main" : "admin",
        title: random() < 0.5 ? "Plazo de entrega" : "Fecha límite",
        when: { kind: "allday", startDay: d, endDay: d },
      });
    }
  }
  void MS_MIN;
  return { ...base, events };
}
