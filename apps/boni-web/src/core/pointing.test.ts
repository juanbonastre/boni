/** (test) Pointing (F9, task 85): references as components write them, the chips' words, and what a rectangle takes. */
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  addPointed,
  type Box,
  chipTitle,
  focusRef,
  inBox,
  MAX_POINTED,
  MAX_VISIBLE,
  mapRef,
  type Pointed,
  panelRef,
  pointAttrs,
  pointKey,
  readRef,
  type Target,
  visibleRefs,
  watchFocus,
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

describe("the map, a flow's steps, a note's paragraphs and what is in view (F9, task 85, A-22)", () => {
  it("reads the new kinds as the server takes them, and nothing else", () => {
    const ok = [
      { kind: "part", id: "e1", part: "0a1b2c3d", n: 2 },
      { kind: "collection", id: "t_x" },
      { kind: "flow", id: "apuntar-x1" },
      { kind: "chart", id: "spending-by-category" },
      { kind: "node", id: "conn:mail" },
      { kind: "step", flow: "apuntar-x1", step: "crear" },
    ];
    for (const r of ok) expect(readRef(JSON.stringify(r))).toEqual(r);
    for (const r of [
      { kind: "part", id: "e1", part: "nothex!!", n: 0 },
      { kind: "part", id: "e1", part: "0a1b2c3d", n: 1.5 },
      { kind: "node", id: "col:t_x" },
      { kind: "step", flow: "f" },
    ])
      expect(readRef(JSON.stringify(r))).toBeNull();
    expect(pointKey({ kind: "step", flow: "f", step: "s" })).toBe("step:f/s");
    expect(pointKey({ kind: "part", id: "e1", part: "0a1b2c3d", n: 1 })).toBe("part:e1/0a1b2c3d/1");
  });

  it("a node of the map is what its id stands for", () => {
    expect(mapRef("col:t_01abc")).toEqual({ kind: "collection", id: "t_01abc" });
    expect(mapRef("flow:leer-correo")).toEqual({ kind: "flow", id: "leer-correo" });
    expect(mapRef("page:e_01p")).toEqual({ kind: "row", id: "e_01p" });
    expect(mapRef("step:flow:leer-correo:clasificar")).toEqual({
      kind: "step",
      flow: "leer-correo",
      step: "clasificar",
    });
    // An unfolded flow's trigger stands for the flow.
    expect(mapRef("step:flow:leer-correo:trigger")).toEqual({ kind: "flow", id: "leer-correo" });
    expect(mapRef("conn:mail")).toEqual({ kind: "node", id: "conn:mail" });
    expect(mapRef("boni:inbox")).toEqual({ kind: "node", id: "boni:inbox" });
    expect(mapRef("dev:all")).toEqual({ kind: "node", id: "dev:all" });
    expect(mapRef("frame:boni")).toBeNull();
  });

  /** A page with things at places of the window (happy-dom lays nothing out: each says where it is). */
  function screen(
    items: { ref: unknown; top: number; own?: boolean; side?: boolean; h?: number }[],
  ) {
    const win = new Window({ width: 1000, height: 800 });
    const doc = win.document as unknown as Document;
    const own = doc.createElement("div");
    own.className = "boni-window";
    const side = doc.createElement("nav");
    side.className = "sidebar";
    doc.body.append(own, side);
    const els = items.map((x) => {
      const el = doc.createElement("div");
      el.setAttribute("data-boni-ref", JSON.stringify(x.ref));
      el.tabIndex = 0;
      const h = x.h ?? 20;
      el.getBoundingClientRect = () =>
        ({ top: x.top, bottom: x.top + h, left: 10, right: 400, width: 390, height: h }) as DOMRect;
      (x.own ? own : x.side ? side : doc.body).append(el);
      return el;
    });
    return { doc, els, own };
  }

  it("what is in view: blocks, rows and paragraphs inside the window, from the top, never Boni's own", () => {
    const { doc } = screen([
      { ref: { kind: "row", id: "e2" }, top: 300 },
      { ref: { kind: "block", page: "p1", block: "b1" }, top: 40 },
      { ref: { kind: "part", id: "e3", part: "0a1b2c3d", n: 0 }, top: 120 },
      { ref: { kind: "row", id: "e_lejos" }, top: 2000 },
      { ref: { kind: "row", id: "e_plegada" }, top: 50, h: 0 },
      { ref: { kind: "row", id: "e_ventana" }, top: 60, own: true },
      // What is not read as the screen's (a collection of the sidebar, a node) is only for pointing.
      { ref: { kind: "collection", id: "t_x" }, top: 10 },
      // Nor a page of the sidebar: it is where to go, not what is in view.
      { ref: { kind: "row", id: "e_lateral" }, top: 20, side: true },
      { ref: { kind: "row", id: "e2" }, top: 310 },
    ]);
    expect(visibleRefs(doc)).toEqual([
      { kind: "block", page: "p1", block: "b1" },
      { kind: "part", id: "e3", part: "0a1b2c3d", n: 0 },
      { kind: "row", id: "e2" },
    ]);
    const many = screen(
      Array.from({ length: 50 }, (_, i) => ({ ref: { kind: "row", id: `e${i}` }, top: i * 10 })),
    );
    expect(visibleRefs(many.doc)).toHaveLength(MAX_VISIBLE);
  });

  it("the focus is what he was on outside Boni's window: writing to Boni keeps it, a press elsewhere clears it", () => {
    const { doc, els, own } = screen([
      { ref: { kind: "row", id: "e1" }, top: 10 },
      { ref: { kind: "row", id: "e_ventana" }, top: 60, own: true },
    ]);
    const stop = watchFocus(doc);
    try {
      const row = els[0] as HTMLElement;
      row.focus();
      expect(focusRef()).toEqual({ kind: "row", id: "e1" });
      // Into Boni's window: still the row.
      (els[1] as HTMLElement).focus();
      own.dispatchEvent(new doc.defaultView!.Event("pointerdown", { bubbles: true }));
      expect(focusRef()).toEqual({ kind: "row", id: "e1" });
      // Gone from the screen: no focus.
      row.remove();
      expect(focusRef()).toBeNull();
      doc.body.append(row);
      row.dispatchEvent(new doc.defaultView!.Event("pointerdown", { bubbles: true }));
      expect(focusRef()).toEqual({ kind: "row", id: "e1" });
      doc.body.dispatchEvent(new doc.defaultView!.Event("pointerdown", { bubbles: true }));
      expect(focusRef()).toBeNull();
    } finally {
      stop();
    }
  });

  it("the right panel by reference: a record, a block of the open page; a note's page has no blocks to say", () => {
    expect(panelRef(null, "p1")).toBeNull();
    expect(panelRef({ kind: "row", id: "e1" }, "p1")).toEqual({
      kind: "row",
      ref: { kind: "row", id: "e1" },
    });
    expect(panelRef({ kind: "block", id: "b2" }, "p1")).toEqual({
      kind: "block",
      ref: { kind: "block", page: "p1", block: "b2" },
    });
    expect(panelRef({ kind: "block", id: "b2" }, "row:e1")).toEqual({ kind: "block" });
    expect(panelRef({ kind: "mail", id: "m1" }, "p1")).toEqual({ kind: "mail" });
  });
});
