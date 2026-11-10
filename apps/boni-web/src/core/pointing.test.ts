/** (test) Pointing (F9, task 85): references as components write them, the chips' words, and what a rectangle takes. */
import { describe, expect, it } from "vitest";
import {
  addPointed,
  type Box,
  chipTitle,
  inBox,
  MAX_POINTED,
  type Pointed,
  pointAttrs,
  pointKey,
  readRef,
  type Target,
} from "./pointing.ts";

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
});

describe("pointing (F9, task 85)", () => {
  it("a component's reference reads back as it was written; anything else is none", () => {
    const block = { kind: "block", page: "p1", block: "b3" } as const;
    expect(readRef(pointAttrs(block, "Gráfica")["data-boni-ref"])).toEqual(block);
    expect(readRef(JSON.stringify({ kind: "row", id: "e1", title: "x" }))).toEqual({
      kind: "row",
      id: "e1",
    });
    expect(readRef(JSON.stringify({ kind: "question", id: "q1" }))).toEqual({
      kind: "question",
      id: "q1",
    });
    expect(readRef(JSON.stringify({ kind: "node", id: "n1" }))).toBeNull();
    expect(readRef(JSON.stringify({ kind: "block", page: "p1" }))).toBeNull();
    expect(readRef(JSON.stringify({ kind: "row", id: "x".repeat(81) }))).toBeNull();
    expect(readRef("{")).toBeNull();
    expect(readRef(undefined)).toBeNull();
  });

  it("a chip says the kind of thing and its name, cut to a line", () => {
    expect(chipTitle("Gráfica", "Gasto por día")).toBe("Gráfica: Gasto por día");
    expect(chipTitle("Texto", "")).toBe("Texto");
    expect(chipTitle("Texto", "  dos\n líneas ")).toBe("Texto: dos líneas");
    expect(chipTitle("Tarea", "a".repeat(80))).toBe(`Tarea: ${"a".repeat(47)}…`);
  });

  it("each thing is pointed at once, in the order it was, at most twenty", () => {
    const p = (id: string, title = id): Pointed => ({ ref: { kind: "row", id }, title });
    const two = addPointed([p("a"), p("b")], [p("a", "A"), p("c")]);
    expect(two.map((x) => x.title)).toEqual(["A", "b", "c"]);
    expect(pointKey({ kind: "block", page: "p", block: "b" })).not.toBe(
      pointKey({ kind: "row", id: "p/b" }),
    );
    const many = addPointed(
      [],
      Array.from({ length: 30 }, (_, i) => p(`e${i}`)),
    );
    expect(many).toHaveLength(MAX_POINTED);
    expect(many.at(-1)?.title).toBe("e29");
  });

  it("a rectangle takes what is wholly inside it as one thing, and the things inside what it only crosses", () => {
    // A chart, and a table with three rows under it.
    const targets: Target[] = [
      { box: box(0, 0, 400, 200), parent: null }, // 0: the chart
      { box: box(0, 220, 400, 420), parent: null }, // 1: the table
      { box: box(0, 260, 400, 300), parent: 1 }, // 2: its first row
      { box: box(0, 300, 400, 340), parent: 1 }, // 3
      { box: box(0, 340, 400, 380), parent: 1 }, // 4
    ];
    // Across two rows: the rows, not the table they are in.
    expect(inBox(targets, box(50, 270, 120, 330))).toEqual([2, 3]);
    // Around the whole table: the table, not its rows.
    expect(inBox(targets, box(-10, 210, 410, 430))).toEqual([1]);
    // Around everything: the chart and the table.
    expect(inBox(targets, box(-10, -10, 410, 430))).toEqual([0, 1]);
    // Over the table's head only, where no row is: the table.
    expect(inBox(targets, box(50, 225, 120, 250))).toEqual([1]);
    // Across a corner of the chart: the chart.
    expect(inBox(targets, box(350, 150, 500, 210))).toEqual([0]);
    // The chart's corner and the first row: both, the table giving way to its row.
    expect(inBox(targets, box(350, 150, 500, 280))).toEqual([0, 2]);
    // Where nothing is: nothing.
    expect(inBox(targets, box(500, 500, 600, 600))).toEqual([]);
  });
});
