import { type Entity, label, type TypeDef } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { blockChartSpec, blockRows, catalogueData, computeBlock } from "./blockData.ts";
import { catalogueErrors, catalogueForAI, fitAfter, newBlock, optionsOf } from "./catalogue.ts";
import { spanOf } from "./dates.ts";
import { liveRules, matchesFilters } from "./filter.ts";
import { type DataBlock, type PageBlock, type PageSpec, pageErrors } from "./page.ts";
import {
  type ControlBlock,
  controlValueOk,
  passedValues,
  refOf,
  rulesWithValues,
  valueRefErrors,
  withPassed,
} from "./pageValues.ts";
import { tableRows, tableRules } from "./tableRows.ts";

/**
 * A page's values (docs/sistema.md §4.6, D-59), with collections shaped like a user's (e2e/server-data.ts): movements
 * whose category is a relation to a collection of categories, with generated ids. Invented data.
 */

const L = label("user", "personal", []);
const CAT = "t_01kcat0000000000000000000a";
const MOV = "t_01kmov0000000000000000000b";
const types: Record<string, TypeDef> = {
  [CAT]: {
    id: CAT,
    key: "categoria",
    name: "Categorías",
    titleField: "f_cat_titulo",
    fields: [{ id: "f_cat_titulo", key: "title", name: "Nombre", type: "text", label: L }],
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  },
  [MOV]: {
    id: MOV,
    key: "movimiento",
    name: "Movimientos",
    titleField: "f_mov_concepto",
    fields: [
      { id: "f_mov_concepto", key: "title", name: "Concepto", type: "text", label: L },
      { id: "f_mov_fecha", key: "date", name: "Fecha", type: "date", label: L },
      { id: "f_mov_importe", key: "amount", name: "Importe", type: "money", label: L },
      {
        id: "f_mov_categoria",
        key: "category",
        name: "Categoría",
        type: "relation",
        relation: { target: CAT, many: false },
        label: L,
      },
      {
        id: "f_mov_estado",
        key: "status",
        name: "Estado",
        type: "select",
        options: [
          { id: "o_pendiente", name: "Pendiente", label: L },
          { id: "o_hecho", name: "Hecho", label: L },
        ],
        label: L,
      },
    ],
    roles: { date: "f_mov_fecha", amount: "f_mov_importe", category: "f_mov_categoria" },
    sensitivity: "personal",
    schemaVersion: 1,
    label: L,
  },
} as unknown as Record<string, TypeDef>;

const CAFE = "e_01kcafe00000000000000000000";
const SUPER = "e_01ksuper0000000000000000000";
const mov = (i: number, date: string, amount: number, cat: string, status = "o_hecho"): Entity => ({
  id: `e_01kmov${String(i).padStart(21, "0")}`,
  type: MOV,
  values: {
    f_mov_concepto: `Movimiento ${i}`,
    f_mov_fecha: date,
    f_mov_importe: { amount, currency: "EUR" },
    f_mov_categoria: cat,
    f_mov_estado: status,
  },
  created: 0,
  updated: 0,
  version: 1,
});
const rows = [
  mov(1, "2026-10-02", -1.6, CAFE),
  mov(2, "2026-10-15", -40, SUPER),
  mov(3, "2026-11-03", -2.4, CAFE),
  mov(4, "2026-11-05", -60, SUPER, "o_pendiente"),
];
const all = (t: string) => (t === MOV ? rows : []);
const today = "2026-11-12";

const control = (over: Partial<ControlBlock> = {}): ControlBlock => ({
  id: "b_cat",
  type: "control",
  name: "Categoría",
  kind: "option",
  collection: MOV,
  field: "f_mov_categoria",
  ...over,
});
const month = (value?: string): ControlBlock => ({
  id: "b_mes",
  type: "control",
  name: "Mes",
  kind: "month",
  ...(value ? { value } : {}),
});
const total: DataBlock = {
  id: "b_total",
  type: "number",
  collection: MOV,
  measure: "sum",
  field: "f_mov_importe",
  period: "$b_mes",
  filterField: "f_mov_categoria",
  filterValue: "$b_cat",
} as DataBlock;
const sum = (r: ReturnType<typeof computeBlock>) =>
  "data" in r ? r.data.total : `problems ${JSON.stringify(r.problems)}`;

describe("a page's values (D-59)", () => {
  it("names a control by $<id>, and a control holds only what fits its kind", () => {
    expect(refOf("$b_cat")).toBe("b_cat");
    expect(refOf("b_cat")).toBeNull();
    expect(refOf("$")).toBeNull();
    expect(controlValueOk("month", "2026-11")).toBe(true);
    expect(controlValueOk("month", "2026-13")).toBe(false);
    expect(controlValueOk("option", CAFE)).toBe(true);
    expect(controlValueOk("option", "no vale")).toBe(false);
    expect(controlValueOk("number", Number.NaN)).toBe(false);
    expect(controlValueOk("text", "x".repeat(201))).toBe(false);
  });

  it("the server's numbers follow what the controls hold, and an empty control filters nothing", () => {
    const o = (cs: ControlBlock[]) => ({ today, controls: cs });
    expect(sum(computeBlock(total, types, all, o([control(), month()])))).toBeCloseTo(-104);
    expect(
      sum(computeBlock(total, types, all, o([control({ value: CAFE }), month()]))),
    ).toBeCloseTo(-4);
    expect(
      sum(computeBlock(total, types, all, o([control({ value: CAFE }), month("2026-11")]))),
    ).toBeCloseTo(-2.4);
    expect(
      sum(computeBlock(total, types, all, o([control({ value: SUPER }), month("2026-10")]))),
    ).toBeCloseTo(-40);
    // The rows behind the number are the same selection.
    const listed = blockRows(total, types, all, o([control({ value: SUPER }), month("2026-11")]));
    expect("rows" in listed && listed.rows.map((e) => e.values.f_mov_concepto)).toEqual([
      "Movimiento 4",
    ]);
  });

  it("a bar list by category takes the control's value as its filter", () => {
    const bars = {
      id: "b_bars",
      type: "bars",
      collection: MOV,
      measure: "sum",
      field: "f_mov_importe",
      groupBy: "f_mov_estado",
      period: "all",
      filterField: "f_mov_categoria",
      filterValue: "$b_cat",
    } as DataBlock;
    const out = computeBlock(bars, types, all, { today, controls: [control({ value: SUPER })] });
    expect("data" in out && out.data.total).toBeCloseTo(-100);
    expect(blockChartSpec(bars, [control({ value: SUPER })]).filters).toEqual([
      { field: "f_mov_categoria", op: "in", values: [SUPER] },
    ]);
    expect(blockChartSpec(bars, [control()]).filters).toEqual([]);
  });

  it("a block naming a control that is not there, or of another kind, is a problem, never another number", () => {
    const out = computeBlock(total, types, all, { today, controls: [month()] });
    expect("problems" in out && out.problems.map((p) => p.key)).toEqual([
      "filterField",
      "filterValue",
    ]);
    const wrongKind = computeBlock({ ...total, period: "$b_cat" } as DataBlock, types, all, {
      today,
      controls: [control()],
    });
    expect("problems" in wrongKind && wrongKind.problems.map((p) => p.key)).toEqual(["period"]);
    // A collection with no date has no period to take from a month control.
    const undated = computeBlock(
      {
        id: "b_cats",
        type: "number",
        collection: CAT,
        measure: "count",
        period: "$b_mes",
      } as DataBlock,
      types,
      all,
      { today, controls: [month("2026-10")] },
    );
    expect("problems" in undated && undated.problems.map((p) => p.key)).toEqual(["period"]);
  });

  it("a page checks what its blocks name of its controls", () => {
    const page = (blocks: unknown[]): PageSpec => ({ version: 1, blocks }) as unknown as PageSpec;
    expect(pageErrors(page([control(), month(), total]))).toEqual([]);
    expect(pageErrors(page([month(), total]))).toEqual([
      "blocks[1]: filterValue names no option control of its field",
    ]);
    const link = { id: "b_link", type: "link", to: "p_otra", pass: { b_x: "$b_nada" } };
    expect(valueRefErrors([link] as PageBlock[])).toEqual([
      "blocks[0]: pass names no control of the page",
    ]);
    const table = {
      id: "b_tabla",
      type: "database",
      source: MOV,
      view: { layout: "table", filter: [{ field: "f_mov_categoria", op: "is", from: "b_cat" }] },
    };
    expect(pageErrors(page([control(), table]))).toEqual([]);
    expect(pageErrors(page([table]))).toEqual(["blocks[0]: a rule names no control of the page"]);
    // A control holds only what fits its kind.
    expect(pageErrors(page([{ ...control(), value: "no es un id" }]))).not.toEqual([]);
  });

  it("a table's rule from a control takes its value, and with none it is left out", () => {
    const items = [
      { field: "f_mov_categoria", op: "is" as const, from: "b_cat" },
      { join: "or" as const, rules: [{ field: "f_mov_estado", op: "is" as const, from: "b_est" }] },
    ];
    expect(rulesWithValues(items, [control({ value: CAFE })])).toEqual([
      { field: "f_mov_categoria", op: "is", value: CAFE },
    ]);
    expect(rulesWithValues(items, [])).toEqual([]);
    // Unresolved, it filters nothing.
    expect(matchesFilters({}, () => "relation", items, today)).toBe(true);
  });

  it("a link passes literals and this page's values, and the page it opens changes only when they differ", () => {
    const passed = passedValues({ b_cat: "$b_cat", b_mes: "2026-10" }, [control({ value: CAFE })]);
    expect(passed).toEqual({ b_cat: CAFE, b_mes: "2026-10" });
    const target: PageBlock[] = [control(), month("2026-11"), total];
    const out = withPassed(target, passed);
    expect(out.changed).toBe(true);
    expect((out.blocks[0] as ControlBlock).value).toBe(CAFE);
    expect((out.blocks[1] as ControlBlock).value).toBe("2026-10");
    expect(withPassed(out.blocks, passed).changed).toBe(false);
    // An empty source empties the target; a value of the wrong kind is left out.
    expect(
      withPassed(out.blocks, passedValues({ b_cat: "$b_cat" }, [control()])).blocks[0],
    ).toEqual(control());
    expect(withPassed(target, { b_mes: "no es un mes" }).changed).toBe(false);
  });

  it("the catalogue offers the controls where a block may name them, and checks a control's value", () => {
    const data = catalogueData(Object.values(types), [control(), month()]);
    const mine = { collection: MOV, filterField: "f_mov_categoria" };
    const setting = (type: string, key: string) =>
      ({
        type: "choice",
        options: key,
        label: "",
        section: "data",
        key: type,
      }) as Parameters<typeof optionsOf>[0];
    expect(optionsOf(setting("x", "filterFields"), mine, data).map((o) => o.value)).toEqual([
      "f_mov_categoria",
      "f_mov_estado",
    ]);
    expect(optionsOf(setting("x", "filterValues"), mine, data)).toEqual([
      { value: "$b_cat", label: "Categoría" },
    ]);
    expect(optionsOf(setting("x", "periods"), mine, data).at(-1)).toEqual({
      value: "$b_mes",
      label: "Mes",
    });
    // Without a control over it, a relation is not offered as a filter.
    const none = catalogueData(Object.values(types));
    expect(optionsOf(setting("x", "filterFields"), mine, none).map((o) => o.value)).toEqual([
      "f_mov_estado",
    ]);
    // A new control goes over the category (D-20); a change of field empties its value, a new name does not.
    const fresh = newBlock("control", "b_nuevo", {
      ...none,
      collections: none.collections.slice(1),
    });
    expect(fresh).toMatchObject({ kind: "option", collection: MOV, field: "f_mov_categoria" });
    const held = { ...control(), value: CAFE };
    expect(fitAfter(held, "name", data).value).toBe(CAFE);
    expect(fitAfter({ ...held, field: "f_mov_estado" }, "field", data).value).toBeUndefined();
    expect(fitAfter({ ...held, kind: "month" }, "kind", data)).toEqual({
      id: "b_cat",
      type: "control",
      name: "Categoría",
      kind: "month",
    });
    expect(catalogueErrors(held, data)).toEqual([]);
    expect(catalogueErrors({ ...held, field: "f_mov_estado", value: "o_otro" }, data)).toEqual([
      { block: "b_cat", key: "value", code: "not-in-data", value: "o_otro" },
    ]);
    expect(catalogueErrors(month("2026-11"), data)).toEqual([]);
    expect(catalogueErrors({ ...month(), value: 3 }, data)[0]?.code).toBe("bad");
    const link = { id: "b_link", type: "link", to: "p_otra", pass: { b_cat: "$b_cat", b_n: 3 } };
    expect(catalogueErrors(link)).toEqual([]);
    expect(catalogueErrors({ ...link, pass: { "no vale": 1 } })[0]?.key).toBe("pass");
    expect(catalogueForAI(data)).toContain("$b_cat=Categoría (option over");
  });
});

describe("a period, a table's rule over a relation, and a table's rows (task 102)", () => {
  const period = (value?: string): ControlBlock => ({
    id: "b_per",
    type: "control",
    name: "Periodo",
    kind: "period",
    ...(value ? { value } : {}),
  });
  const typeOf = (id: string) => types[MOV]?.fields.find((f) => f.id === id)?.type;

  it("a period is two civil days that exist, the first not after the last; spanOf reads a month too", () => {
    expect(controlValueOk("period", "2026-10-01/2026-11-15")).toBe(true);
    expect(controlValueOk("period", "2026-11-15/2026-11-15")).toBe(true);
    for (const v of ["2026-11-15/2026-10-01", "2026-02-29/2026-03-01", "2026-11", "2026-11-01", 5])
      expect(controlValueOk("period", v)).toBe(false);
    expect(controlValueOk("period", "2024-02-29/2024-03-01")).toBe(true);
    expect(spanOf("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(spanOf("2026-10-01/2026-11-15")).toEqual({ start: "2026-10-01", end: "2026-11-15" });
    expect(spanOf("2026-10-01/2026-11-15/2026-12-01")).toBeNull();
  });

  it("a number's period names a period control: its days, both included; empty, every date", () => {
    const spec = blockChartSpec({ ...total, period: "$b_per" } as DataBlock, [
      period("2026-10-02/2026-11-03"),
    ]);
    expect(spec.period).toEqual({ kind: "range", start: "2026-10-02", end: "2026-11-03" });
    expect(blockChartSpec({ ...total, period: "$b_per" } as DataBlock, [period()]).period).toEqual({
      kind: "all",
    });
    const r = computeBlock({ ...total, period: "$b_per" } as DataBlock, types, all, {
      today,
      controls: [period("2026-10-02/2026-11-03"), control()],
    });
    expect(sum(r)).toBeCloseTo(-44);
    // A period control is what a block's period may name, never an option or a text one.
    const blocks = [period(), control(), { ...total, period: "$b_per" }] as PageBlock[];
    expect(valueRefErrors(blocks)).toEqual([]);
    expect(valueRefErrors([control(), { ...total, period: "$b_cat" }] as PageBlock[])).toEqual([
      "blocks[1]: period names no month or period control",
    ]);
  });

  it("a relation's rule «is» or «is not» a record (one of many too); a date's «is» a month's or a period's days", () => {
    const is = (v: unknown, op: "is" | "is_not", value: string) =>
      matchesFilters(
        { f_mov_categoria: v },
        typeOf,
        [{ field: "f_mov_categoria", op, value }],
        today,
      );
    expect(is(CAFE, "is", CAFE)).toBe(true);
    expect(is(SUPER, "is", CAFE)).toBe(false);
    expect(is([SUPER, CAFE], "is", CAFE)).toBe(true);
    expect(is(null, "is", CAFE)).toBe(false);
    expect(is(null, "is_not", CAFE)).toBe(true);
    expect(is([SUPER, CAFE], "is_not", CAFE)).toBe(false);
    const on = (d: string, op: "is" | "before" | "after", value: string) =>
      matchesFilters({ f_mov_fecha: d }, typeOf, [{ field: "f_mov_fecha", op, value }], today);
    expect(on("2026-11-30", "is", "2026-11")).toBe(true);
    expect(on("2026-12-01", "is", "2026-11")).toBe(false);
    expect(on("2026-10-01", "is", "2026-10-01/2026-10-31")).toBe(true);
    expect(on("2026-10-31", "is", "2026-10-01/2026-10-31")).toBe(true);
    expect(on("2026-09-30", "before", "2026-10-01/2026-10-31")).toBe(true);
    expect(on("2026-10-01", "before", "2026-10-01/2026-10-31")).toBe(false);
    expect(on("2026-11-01", "after", "2026-10-01/2026-10-31")).toBe(true);
    // A plain day is still a day.
    expect(on("2026-10-05", "is", "2026-10-05")).toBe(true);
  });

  it("a table's rows: the rules with the page's values, a waiting rule left out", () => {
    const def = types[MOV] as TypeDef;
    const filter = [
      { field: "f_mov_categoria", op: "is" as const, from: "b_cat" },
      { field: "f_mov_fecha", op: "is" as const, from: "b_per" },
      // Just added from the bar, with no value yet: it filters nothing.
      { field: "f_mov_concepto", op: "contains" as const },
    ];
    const ids = (controls: ControlBlock[]) =>
      tableRows(rows, def, filter, { today, controls }).map((e) => e.values.f_mov_concepto);
    expect(ids([control(), period()])).toHaveLength(4);
    expect(ids([control({ value: CAFE }), period()])).toEqual(["Movimiento 1", "Movimiento 3"]);
    expect(ids([control({ value: CAFE }), period("2026-11-01/2026-11-30")])).toEqual([
      "Movimiento 3",
    ]);
    expect(tableRules(filter, [control({ value: SUPER })])).toEqual([
      { field: "f_mov_categoria", op: "is", value: SUPER },
    ]);
    expect(liveRules([{ join: "or", rules: [{ field: "f_mov_concepto", op: "is" }] }])).toEqual([]);
  });
});
