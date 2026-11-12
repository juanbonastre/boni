/**
 * (test) A page's values on the server (docs/sistema.md §4.6, F11, D-59): the app sends a page's controls with its
 * data blocks and the server computes the numbers from the store with them, never the app; the assistant reads on
 * the screen what a control holds and what the blocks it names count. Collections shaped like Juan's (the seed's:
 * movements whose category is a record of «Categorías»), and his volume (A-15: thousands of movements).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner, plain, type Val } from "@boni/agent";
import { label, type TypeDef } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { BlocksError, blockRowsOf, computeBlocks } from "./blocks.ts";
import { createPage } from "./pages.ts";
import { screenOf } from "./screen.ts";
import { seed } from "./seed.test-util.ts";

let dir = "";
let host: AgentHost | null = null;
afterEach(() => {
  host?.close();
  host = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);

function setUp() {
  dir = mkdtempSync(join(tmpdir(), "boni-valores-"));
  host = new AgentHost({
    dataDir: dir,
    providers: { planner: fakePlanner([]), reader: fakePlanner([]) },
  });
  const store = host.store(1);
  const ids = seed(
    store,
    [
      { key: "categoria", name: "Categorías", folder: "registros/finanzas/categorias/" },
      {
        key: "movimiento",
        name: "Movimiento",
        folder: "registros/finanzas/movimientos/",
        sensitivity: "sensitive",
        fields: { date: "date", category: { type: "relation", to: "categoria" } },
      },
    ],
    {
      "registros/finanzas/categorias/bebida-cafe.md":
        "---\nnombre: bebida/cafe\n---\n\n# bebida/cafe\n",
      "registros/finanzas/categorias/comida-super.md":
        "---\nnombre: comida/super\n---\n\n# comida/super\n",
      "registros/finanzas/movimientos/2026/10/2026-10-02-cafe.md":
        '---\ndate: 2026-10-02\namount: -1.6\ncategory: "[[bebida-cafe]]"\nmerchant: "Bar Ejemplo"\n---\n',
      "registros/finanzas/movimientos/2026/11/2026-11-03-cafe.md":
        '---\ndate: 2026-11-03\namount: -2.4\ncategory: "[[bebida-cafe]]"\nmerchant: "Cafetería Ejemplo"\n---\n',
      "registros/finanzas/movimientos/2026/11/2026-11-05-super.md":
        '---\ndate: 2026-11-05\namount: -60\ncategory: "[[comida-super]]"\nmerchant: "Mercado Ejemplo"\n---\n',
    },
  );
  const type = (key: string) =>
    Object.values(store.schema().types).find((t) => t.key === key) as TypeDef;
  const mov = type("movimiento");
  const field = (key: string) => mov.fields.find((f) => f.key === key)?.id as string;
  const cafe = ids.get("registros/finanzas/categorias/bebida-cafe.md") as string;
  const superId = ids.get("registros/finanzas/categorias/comida-super.md") as string;
  return { store, mov, field, cafe, superId };
}

const o = { today: "2026-11-12", device: "portatil-ejemplo", now: Date.UTC(2026, 10, 12) };
type Results = Record<string, { data?: { total: number }; problems?: unknown[] }>;

function page(mov: TypeDef, field: (k: string) => string) {
  const control = {
    id: "b_cat",
    type: "control",
    name: "Categoría",
    kind: "option",
    collection: mov.id,
    field: field("category"),
  };
  const month = { id: "b_mes", type: "control", name: "Mes", kind: "month" };
  const total = {
    id: "b_total",
    type: "number",
    collection: mov.id,
    measure: "sum",
    field: field("amount"),
    period: "$b_mes",
    filterField: field("category"),
    filterValue: "$b_cat",
  };
  const chart = {
    id: "b_chart",
    type: "graph",
    shape: "bar",
    collection: mov.id,
    measure: "sum",
    field: field("amount"),
    groupBy: "@month",
    period: "all",
    filterField: field("category"),
    filterValue: "$b_cat",
  };
  return { control, month, total, chart };
}

describe("a page's values on the server (F11, D-59)", () => {
  it("the numbers and the charts are the store's with what the page's controls hold", () => {
    const { store, mov, field, cafe, superId } = setUp();
    const { control, month, total, chart } = page(mov, field);
    const run = (controls: unknown[]) =>
      computeBlocks(store, { blocks: [total, chart], controls }, o).results as Results;
    expect(run([control, month]).b_total?.data?.total).toBeCloseTo(-64);
    expect(run([{ ...control, value: cafe }, month]).b_total?.data?.total).toBeCloseTo(-4);
    expect(
      run([
        { ...control, value: cafe },
        { ...month, value: "2026-11" },
      ]).b_total?.data?.total,
    ).toBeCloseTo(-2.4);
    expect(run([{ ...control, value: superId }, month]).b_chart?.data?.total).toBeCloseTo(-60);
    // The rows behind a number are the same selection.
    const rows = blockRowsOf(
      store,
      {
        block: total,
        controls: [
          { ...control, value: cafe },
          { ...month, value: "2026-10" },
        ],
      },
      o,
    );
    expect("rows" in rows && rows.rows?.map((r) => r.values[field("merchant")])).toEqual([
      "Bar Ejemplo",
    ]);
    // A block naming a control the request does not bring says so; a control of another shape is refused.
    expect(run([month]).b_total?.problems?.length).toBeGreaterThan(0);
    expect(() => computeBlocks(store, { blocks: [total], controls: [{ id: "x" }] }, o)).toThrow(
      BlocksError,
    );
    expect(() =>
      computeBlocks(store, { blocks: [total], controls: [{ ...month, value: "noviembre" }] }, o),
    ).toThrow(BlocksError);
  });

  it("the assistant reads on the screen what a control holds and what the blocks naming it count", () => {
    const { store, mov, field, cafe } = setUp();
    const { control, month, total } = page(mov, field);
    const p = createPage(store, {
      title: "Gastos del mes",
      spec: {
        version: 1,
        blocks: [{ ...control, value: cafe }, { ...month, value: "2026-11" }, total],
      } as never,
    });
    const refs = {
      open: null,
      inbox: [],
      chosen: [],
      pointed: [
        { kind: "block" as const, page: p.id, block: "b_cat" },
        { kind: "block" as const, page: p.id, block: "b_total" },
      ],
    };
    const seen = plain(screenOf(store, refs) as Val) as { pointed: Record<string, unknown>[] };
    expect(seen.pointed[0]).toMatchObject({
      kind: "control",
      name: "Categoría",
      type: "option",
      value: "bebida/cafe",
    });
    expect(seen.pointed[1]).toMatchObject({
      kind: "number",
      period: "2026-11",
      filter: { equals: "bebida/cafe" },
      total: -2.4,
    });
  });

  it("a page's table is filtered by the server: a relation is the record a control holds, a date in a period's days (task 102)", () => {
    const { store, mov, field, cafe, superId } = setUp();
    const { control } = page(mov, field);
    const period = { id: "b_per", type: "control", name: "Periodo", kind: "period" };
    const table = (filter: unknown[]) => ({
      id: "b_tabla",
      type: "database",
      source: mov.id,
      view: { layout: "table", filter },
    });
    const merchants = (filter: unknown[], controls: unknown[]) => {
      const r = blockRowsOf(store, { block: table(filter), controls }, o) as {
        rows: { values: Record<string, unknown> }[];
        total: number;
      };
      expect(r.total).toBe(r.rows.length);
      return r.rows.map((x) => x.values[field("merchant")]).sort();
    };
    const byCat = [{ field: field("category"), op: "is", from: "b_cat" }];
    // An empty control filters nothing; one holding «bebida/cafe» leaves its two movements; «no es», the other.
    expect(merchants(byCat, [control])).toHaveLength(3);
    expect(merchants(byCat, [{ ...control, value: cafe }])).toEqual([
      "Bar Ejemplo",
      "Cafetería Ejemplo",
    ]);
    expect(
      merchants(
        [{ field: field("category"), op: "is_not", from: "b_cat" }],
        [{ ...control, value: cafe }],
      ),
    ).toEqual(["Mercado Ejemplo"]);
    // A record fixed in the rule, with no control.
    expect(merchants([{ field: field("category"), op: "is", value: superId }], [])).toEqual([
      "Mercado Ejemplo",
    ]);
    // A period: its two days included, with the category's rule too.
    const inPeriod = [{ field: field("date"), op: "is", from: "b_per" }, ...byCat];
    expect(
      merchants(inPeriod, [
        { ...period, value: "2026-11-01/2026-11-03" },
        { ...control, value: cafe },
      ]),
    ).toEqual(["Cafetería Ejemplo"]);
    expect(merchants(inPeriod, [{ ...period, value: "2026-11-03/2026-11-05" }, control])).toEqual([
      "Cafetería Ejemplo",
      "Mercado Ejemplo",
    ]);
    // The same period as a number's: what the table lists is what the number sums.
    const total = { ...page(mov, field).total, period: "$b_per" };
    const sum = computeBlocks(
      store,
      { blocks: [total], controls: [{ ...period, value: "2026-11-01/2026-11-05" }, control] },
      o,
    ).results as Results;
    expect(sum.b_total?.data?.total).toBeCloseTo(-62.4);
    // A period whose first day is after its last, or a day that does not exist, is refused like any bad value.
    for (const value of ["2026-11-05/2026-11-01", "2026-02-30/2026-03-01", "2026-11"])
      expect(() =>
        blockRowsOf(store, { block: table(inPeriod), controls: [{ ...period, value }] }, o),
      ).toThrow(BlocksError);
    // Boni's own collections and a rule of another shape are not tables the server filters here.
    expect(() =>
      blockRowsOf(store, { block: { ...table([]), source: "t_sys_flujos" } }, o),
    ).toThrow(BlocksError);
    expect(() => blockRowsOf(store, { block: table([{ field: "x", op: "nope" }]) }, o)).toThrow(
      BlocksError,
    );
  });

  it("A-15: a page's blocks with its values over a year of thousands of movements answer in time", () => {
    const { store, mov, field, cafe } = setUp();
    const cats = Array.from(
      { length: 12 },
      (_, i) =>
        store.create(
          Object.values(store.schema().types).find((t) => t.key === "categoria")?.id as string,
          { [titleOf(store, "categoria")]: { value: `categoria/${i}`, label: own } },
          { actor: "user", device: "seed" },
        ).entity.id,
    );
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const day = new Date(Date.UTC(2025, 10, 1) + (i % 365) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      store.create(
        mov.id,
        {
          [field("date")]: { value: day, label: own },
          [field("amount")]: { value: -((i % 97) + 0.5), label: own },
          [field("category")]: {
            value: i % 5 === 0 ? cafe : (cats[i % cats.length] as string),
            label: own,
          },
          [field("merchant")]: { value: `Comercio ${i % 300}`, label: own },
        },
        { actor: "user", device: "seed" },
      );
    }
    const { control, month, total, chart } = page(mov, field);
    const bars = { ...chart, id: "b_bars", type: "bars", groupBy: field("category") };
    delete (bars as { shape?: string }).shape;
    const { field: _f, ...counted } = total;
    const body = {
      blocks: [total, chart, bars, { ...counted, id: "b_count", measure: "count" }],
      controls: [
        { ...control, value: cafe },
        { ...month, value: "2026-03" },
      ],
    };
    computeBlocks(store, body, o);
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      const r = computeBlocks(store, body, o).results as Results;
      times.push(performance.now() - t0);
      expect(r.b_count?.data?.total).toBeGreaterThan(0);
    }
    times.sort((a, b) => a - b);
    const median = times[2] as number;
    // Measured on the laptop at 39 ms (2026-11-12); the bound leaves room for CI's slower machines.
    console.log(
      `A-15 page values: 4 blocks over ${N + 3} movements, median ${median.toFixed(1)} ms`,
    );
    expect(median).toBeLessThan(1500);

    // The page's table, filtered by the server with the category's control (task 102): what the app asks each time
    // a control changes, over every movement, never the app's copy.
    const tabla = {
      block: {
        id: "b_tabla",
        type: "database",
        source: mov.id,
        view: { filter: [{ field: field("category"), op: "is", from: "b_cat" }] },
      },
      controls: [{ ...control, value: cafe }],
    };
    const rowTimes: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      const r = blockRowsOf(store, tabla, o) as { rows: unknown[]; total: number };
      rowTimes.push(performance.now() - t0);
      expect(r.total).toBe(N / 5 + 2);
      expect(r.rows).toHaveLength(N / 5 + 2);
    }
    rowTimes.sort((a, b) => a - b);
    const rowMedian = rowTimes[2] as number;
    console.log(
      `A-15 page table: ${N / 5 + 2} of ${N + 3} movements, median ${rowMedian.toFixed(1)} ms`,
    );
    expect(rowMedian).toBeLessThan(1500);
  }, 60_000);
});

function titleOf(store: UserStore, key: string): string {
  const t = Object.values(store.schema().types).find((x) => x.key === key) as TypeDef;
  return t.titleField;
}
