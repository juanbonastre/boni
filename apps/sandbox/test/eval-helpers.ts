// The tests' way to make an evaluation's request, as Boni's server will (E3): the hash from the sources, the zone's
// table and the names of months and days from packages/calendar/src/time.ts, which the box has no `Intl` for.
import { createHash } from "node:crypto";
import { monthNames, tzOffsetMs, weekdayNames } from "@boni/calendar";
import { type DateNames, type EvalRequest, ZONE_YEARS, type ZoneTable } from "@boni/sandbox";

const tables = new Map<string, ZoneTable>();
/** Every change of `zone`'s offset over `ZONE_YEARS`: found by weeks, then to the minute. */
export function zoneTable(zone: string): ZoneTable {
  const known = tables.get(zone);
  if (known) return known;
  const start = Date.UTC(ZONE_YEARS[0], 0, 1);
  const end = Date.UTC(ZONE_YEARS[1] + 1, 0, 1);
  const off = (ms: number) => Math.round(tzOffsetMs(ms, zone) / 60_000);
  const offsets: [number, number][] = [[start, off(start)]];
  const WEEK = 7 * 86_400_000;
  for (let t = start; t < end; t += WEEK) {
    const next = Math.min(t + WEEK, end);
    if (off(next) === off(t)) continue;
    let lo = t;
    let hi = next;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (off(mid) === off(t)) lo = mid;
      else hi = mid;
    }
    offsets.push([hi, off(hi)]);
  }
  const table = { zone, offsets };
  tables.set(zone, table);
  return table;
}

/** The names of the run's language, from Monday. */
export function dateNames(locale: "es" | "en" = "es"): DateNames {
  const fromMonday = (a: string[]) => [...a.slice(1), a[0]!];
  return {
    months: monthNames(locale, "long"),
    monthsShort: monthNames(locale, "short"),
    days: fromMonday(weekdayNames(locale, "long")),
    daysShort: fromMonday(weekdayNames(locale, "short")),
  };
}

/** The run's instant in the tests: 2026-11-16 09:30 in Madrid. */
export const NOW = Date.UTC(2026, 10, 16, 8, 30);

/** A request, as Boni's server makes them. */
export function evalRequest(
  kind: EvalRequest["kind"],
  sources: string[],
  input: EvalRequest["input"],
  more: Partial<EvalRequest> = {},
): EvalRequest {
  const req: EvalRequest = {
    id: "prueba",
    v: 2,
    kind,
    mode: kind === "expressions" ? "perRow" : "all",
    sources,
    hash: createHash("sha256").update(sources.join("\n")).digest("hex"),
    input,
    from: 0,
    steps: {},
    now: NOW,
    zone: zoneTable("Europe/Madrid"),
    names: dateNames(),
    seed: 42,
    run: { test: true, startedBy: "user" },
    reads: {},
    ...more,
  };
  return more.hash ? req : { ...req, hash: hashOf(req.sources) };
}

export const hashOf = (sources: readonly string[]) =>
  createHash("sha256").update(sources.join("\n")).digest("hex");

const idOf = (i: number) => `e_01m7${i.toString(36).padStart(20, "0")}`;
/** Rows shaped like a collection of expenses: generated ids, many fields, a relation by id, empty and long values. */
export const rowsLike = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: idOf(i),
    titulo: `Compra ejemplo ${i}`,
    importe: -((i * 37) % 9000) / 100,
    fecha: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    categoria: idOf(100000 + (i % 37)),
    cuenta: i % 3 === 0 ? "efectivo" : "banco",
    my_share: null,
    conciliado: i % 2 === 0,
    notas: i % 5 === 0 ? "Pagado a medias con ejemplo.persona@example.com" : "",
  }));
/** The categories those rows point to. */
export const categoriesLike = () =>
  Array.from({ length: 37 }, (_, i) => ({
    id: idOf(100000 + i),
    nombre: `Categoría ${i}`,
    presupuesto: 100 + i,
  }));
