// Where the boxes go when nobody has put them anywhere (docs/automatizaciones.md AU-05), and «Ordenar» (AU-64).
import { type Automation, FORMAT, type Step } from "@boni/automations";
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { CARD, placeFor, tidy, withPlaces } from "./places.ts";

const step = (id: string, type: string): Step => ({ id, name: id, type, params: {} });
const arrow = (from: string, to: string, output = "main") => ({
  from: { step: from, output },
  to: { step: to, input: "main" },
});
const automation = (steps: Step[], arrows: Automation["arrows"] = []): Automation => ({
  format: FORMAT,
  id: "a_01jejemplo",
  version: 0,
  name: "Revisar gastos",
  steps,
  arrows,
  settings: {},
});
const STEP_X = CARD.width + CARD.gapX;
const STEP_Y = CARD.height + CARD.gapY;
const overlap = (places: Record<string, { x: number; y: number }>) => {
  const list = Object.values(places);
  return list.some((a, i) =>
    list.some(
      (b, j) => i < j && Math.abs(a.x - b.x) < CARD.width && Math.abs(a.y - b.y) < CARD.height,
    ),
  );
};

describe("the places of the boxes", () => {
  it("AU-05 · a step with no place goes to the right of the one it hangs from, and below when that place is taken; a new trigger goes below the last trigger; one that hangs from nothing goes to the right of the rightmost box of the first row; a step with a place is never moved", () => {
    const d = automation(
      [step("t", "manual"), step("a", "filter"), step("b", "sort"), step("c", "limit")],
      [arrow("t", "a"), arrow("t", "b")],
    );
    // To the right of its parent; that place taken, the next free one below.
    expect(placeFor(d, { t: { x: 0, y: 0 } }, "a")).toEqual({ x: STEP_X, y: 0 });
    expect(placeFor(d, { t: { x: 0, y: 0 }, a: { x: STEP_X, y: 0 } }, "b")).toEqual({
      x: STEP_X,
      y: STEP_Y,
    });
    // Hanging from nothing: right of the rightmost box of the top row (a box lower down does not count).
    const placed = { t: { x: 0, y: 0 }, a: { x: STEP_X, y: 0 }, b: { x: 3 * STEP_X, y: 400 } };
    expect(placeFor(d, placed, "c")).toEqual({ x: 2 * STEP_X, y: 0 });
    // An empty canvas: the first box at the origin.
    expect(placeFor(automation([step("t", "manual")]), {}, "t")).toEqual({ x: 0, y: 0 });
    // A new trigger: below the last trigger.
    const two = automation([...d.steps, step("t2", "manual")], d.arrows);
    expect(placeFor(two, placed, "t2")).toEqual({ x: 0, y: STEP_Y });
    // Every step placed: the ones with a place keep it, exactly.
    const all = withPlaces(two, placed);
    expect(all.t).toEqual(placed.t);
    expect(all.a).toEqual(placed.a);
    expect(all.b).toEqual(placed.b);
    expect(Object.keys(all).sort()).toEqual(["a", "b", "c", "t", "t2"]);
    // A step placed before the one it hangs from is drawn after it, to its right.
    const late = automation([step("x", "filter"), step("t", "manual")], [arrow("t", "x")]);
    expect(withPlaces(late, {})).toEqual({ t: { x: 0, y: 0 }, x: { x: STEP_X, y: 0 } });
  });

  it("AU-05 · the same draft and the same places give the same answer twice, and no two boxes end on each other", () => {
    // A tree of 40 steps with some places given and the rest not.
    const steps = [
      step("t", "manual"),
      ...Array.from({ length: 39 }, (_, i) => step(`s${i}`, "filter")),
    ];
    const arrows = steps
      .slice(1)
      .map((s, i) => arrow(i < 3 ? "t" : `s${Math.floor((i - 3) / 3)}`, s.id));
    const d = automation(steps, arrows);
    const given = { t: { x: 0, y: 0 }, s4: { x: STEP_X, y: STEP_Y } };
    const one = withPlaces(d, given);
    expect(withPlaces(d, given)).toEqual(one);
    expect(overlap(one)).toBe(false);
    expect(overlap(withPlaces(d, {}))).toBe(false);
  });

  it("AU-64 · «Ordenar» places every box left to right from each trigger, one column per step of distance, with no arrow going backwards; 300 steps are placed within its time (A-15)", () => {
    // «Si» with its two outputs, a join, and a second trigger.
    const d = automation(
      [
        step("t", "manual"),
        step("si", "if"),
        step("a", "filter"),
        step("b", "sort"),
        step("j", "combine"),
        step("t2", "manual"),
        step("c", "limit"),
      ],
      [
        arrow("t", "si"),
        arrow("si", "b", "no"),
        arrow("si", "a", "yes"),
        arrow("a", "j"),
        arrow("b", "j"),
        arrow("t2", "c"),
      ],
    );
    const p = tidy(d);
    expect(p.t).toEqual({ x: 0, y: 0 });
    expect(p.si).toEqual({ x: STEP_X, y: 0 });
    // «sí» above «no», whatever the arrows' order.
    expect(p.a).toEqual({ x: 2 * STEP_X, y: 0 });
    expect(p.b).toEqual({ x: 2 * STEP_X, y: STEP_Y });
    expect(p.j).toEqual({ x: 3 * STEP_X, y: 0 });
    // The second trigger's steps start below everything of the first.
    expect(p.t2?.y).toBeGreaterThanOrEqual(2 * STEP_Y);
    expect(p.c).toEqual({ x: STEP_X, y: p.t2?.y });
    for (const a of d.arrows) expect(p[a.to.step]?.x ?? 0).toBeGreaterThan(p[a.from.step]?.x ?? 0);
    expect(overlap(p)).toBe(false);
    expect(tidy(d)).toEqual(p);

    // 300 steps: one chain with branches every few steps.
    const many = [
      step("t", "manual"),
      ...Array.from({ length: 299 }, (_, i) => step(`s${i}`, i % 7 === 0 ? "if" : "filter")),
    ];
    const arrows = many
      .slice(1)
      .map((s, i) => arrow(i === 0 ? "t" : `s${Math.floor((i - 1) / 2)}`, s.id, "main"));
    const big = automation(many, arrows);
    const started = cpu();
    const placed = tidy(big);
    const ms = cpu() - started;
    expect(Object.keys(placed)).toHaveLength(300);
    expect(overlap(placed)).toBe(false);
    for (const a of big.arrows)
      expect(placed[a.to.step]?.x ?? 0).toBeGreaterThan(placed[a.from.step]?.x ?? 0);
    // One press of «Ordenar», not a frame: well under what a person notices. Measured here (2026-11-16, its CPU
    // time, load 5 to 7 on 8 cores): 1 to 2 ms.
    under(ms, 50, "cpu", "«Ordenar» over 300 steps");
  });
});
