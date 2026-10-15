import { PROJECTS_COLLECTION, propertyToColumn } from "./calendars.ts";
import type {
  CalendarMapping,
  CalendarView,
  Collection,
  CollectionSnapshot,
  Column,
  Row,
} from "./collections.ts";
import { makeModel } from "./collections.ts";
import type { CalendarData, PropertyDef } from "./model.ts";
import { eventToRow } from "./projection.ts";
import { generateSample, SAMPLE_TZ } from "./sample.ts";
import type { CivilDay } from "./time.ts";

/** Calendars whose rows keep date and time in separate columns (the shape of `agenda/` notes). */
const SPLIT_CALENDARS = new Set(["teaching", "health", "plans", "study"]);

const col = (id: string, name: string, type: Column["type"]): Column => ({ id, name, type });

function collectionAndMapping(
  id: string,
  name: string,
  schema: PropertyDef[],
  split: boolean,
): { collection: Collection; mapping: CalendarMapping } {
  const common = [col("title", "Título", "text")];
  const when: Column[] = split
    ? [
        col("date", "Fecha", "date"),
        col("startTime", "Hora de inicio", "time"),
        col("endTime", "Hora de fin", "time"),
        col("endDate", "Fecha de fin", "date"),
        col("allDay", "Todo el día", "checkbox"),
        col("timezone", "Zona horaria", "text"),
      ]
    : [col("start", "Inicio", "datetime"), col("end", "Fin", "datetime")];
  const columns: Column[] = [
    ...common,
    ...when,
    col("completed", "Hecha", "checkbox"),
    col("location", "Lugar", "text"),
    col("description", "Descripción", "text"),
    col("recurrence", "Repetición", "text"),
    { id: "exdates", name: "Excepciones", type: "dates" },
    ...schema.map(propertyToColumn),
  ];
  const mapping: CalendarMapping = {
    title: "title",
    location: "location",
    description: "description",
    when: split
      ? {
          kind: "split",
          date: "date",
          startTime: "startTime",
          endTime: "endTime",
          endDate: "endDate",
          allDay: "allDay",
          timezone: "timezone",
        }
      : { kind: "range", start: "start", end: "end" },
    task: { column: "completed" },
    recurrence: "recurrence",
    exdates: "exdates",
  };
  return { collection: { id, name, columns }, mapping };
}

/**
 * The invented sample as collections: one collection and one calendar view per calendar, plus a
 * "projects" collection without a date column (so it is not a calendar). Some calendars keep
 * date and time in separate columns and the rest use ISO start/end columns, so both mapping
 * forms are exercised. The rows project to exactly the events `generateSample` produces.
 */
export function generateCollectionSample(opts: {
  anchorDay: CivilDay;
  tz?: string;
  weeksBefore?: number;
  weeksAfter?: number;
  seed?: number;
}): CollectionSnapshot {
  const data: CalendarData = generateSample(opts);
  const tz = opts.tz ?? SAMPLE_TZ;
  const collections: Collection[] = [];
  const views: CalendarView[] = [];
  for (const c of data.calendars) {
    const { collection, mapping } = collectionAndMapping(
      c.id,
      c.name,
      c.schema,
      SPLIT_CALENDARS.has(c.id),
    );
    collections.push(collection);
    views.push({
      id: c.id,
      collectionId: c.id,
      accountId: c.accountId,
      color: c.color,
      visible: c.visible,
      ...(c.readOnly ? { readOnly: true } : {}),
      tz,
      mapping,
    });
  }
  collections.push({
    id: PROJECTS_COLLECTION,
    name: "Proyectos",
    columns: [col("title", "Título", "text")],
  });

  const model = makeModel(collections, views, { defaultTz: tz });
  const stamp = data.events[0]?.created ?? 0;
  const rows: Row[] = data.events.map((e) => eventToRow(model, null, e));
  for (const p of data.projects) {
    rows.push({
      id: p.id,
      collectionId: PROJECTS_COLLECTION,
      values: { title: p.name },
      created: stamp,
      updated: stamp,
    });
  }
  return { accounts: data.accounts, collections, views, rows };
}
