import { describe, expect, it } from "vitest";
import { clickSelection } from "./selection.ts";

const ordered = ["a", "b", "c", "d", "e", "f"];
const base = { ordered, ctrl: false, shift: false };

describe("clickSelection", () => {
  it("plain click selects only that event and opens it", () => {
    expect(clickSelection({ ...base, current: ["a", "b"], anchor: "a", clicked: "d" })).toEqual({
      ids: ["d"],
      anchor: "d",
      popover: true,
    });
  });
  it("Ctrl+Shift+click adds and toggles", () => {
    const mods = { ctrl: true, shift: true };
    const r1 = clickSelection({ ...base, ...mods, current: ["a"], anchor: "a", clicked: "c" });
    expect(r1).toEqual({ ids: ["a", "c"], anchor: "c", popover: false });
    const r2 = clickSelection({
      ...base,
      ...mods,
      current: r1.ids,
      anchor: r1.anchor,
      clicked: "a",
    });
    expect(r2.ids).toEqual(["c"]);
  });
  it("Shift+click adds the whole range, in either direction, keeping the anchor", () => {
    expect(
      clickSelection({ ...base, shift: true, current: ["b"], anchor: "b", clicked: "e" }),
    ).toEqual({
      ids: ["b", "c", "d", "e"],
      anchor: "b",
      popover: false,
    });
    expect(
      clickSelection({ ...base, shift: true, current: ["d"], anchor: "d", clicked: "b" }).ids,
    ).toEqual(["d", "b", "c"]);
  });
  it("Shift+click keeps what was already selected", () => {
    const r = clickSelection({
      ...base,
      shift: true,
      current: ["a", "d"],
      anchor: "d",
      clicked: "f",
    });
    expect(r.ids.sort()).toEqual(["a", "d", "e", "f"]);
  });
  it("Shift+click without an anchor just adds the event", () => {
    expect(
      clickSelection({ ...base, shift: true, current: [], anchor: null, clicked: "c" }).ids,
    ).toEqual(["c"]);
  });
  it("Ctrl+click alone (an event without a note) is a plain click", () => {
    expect(
      clickSelection({ ...base, ctrl: true, current: ["a"], anchor: "a", clicked: "c" }),
    ).toEqual({
      ids: ["c"],
      anchor: "c",
      popover: true,
    });
  });
});
