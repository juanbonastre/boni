/** (test) Boni's window as the device keeps it (F9, task 85, sixth part; I-35): inside the app's window, read back safely. */
import { describe, expect, it } from "vitest";
import { clampPlace, EDGE, readKept, toKept } from "./boniWindow.ts";

const box = { width: 400, height: 600 };
const view = { width: 1440, height: 900 };

describe("Boni's window on this device (I-35)", () => {
  it("stays inside the app's window wherever it is dragged, 8 px from each side", () => {
    expect(clampPlace({ right: 300, bottom: 120 }, box, view)).toEqual({ right: 300, bottom: 120 });
    // Past the left and the top: at the edge, the bar within reach.
    expect(clampPlace({ right: 5000, bottom: 5000 }, box, view)).toEqual({
      right: 1440 - 400 - EDGE,
      bottom: 900 - 600 - EDGE,
    });
    // Past the right and the bottom.
    expect(clampPlace({ right: -50, bottom: -3 }, box, view)).toEqual({ right: EDGE, bottom: EDGE });
    // A view smaller than the window: its top left corner wins.
    expect(clampPlace({ right: 0, bottom: 0 }, box, { width: 300, height: 500 })).toEqual({
      right: EDGE,
      bottom: EDGE,
    });
    // Whole pixels.
    expect(clampPlace({ right: 10.6, bottom: 20.2 }, box, view)).toEqual({ right: 11, bottom: 20 });
  });

  it("reads back where it was, how, the last conversation and the drafts", () => {
    const kept = {
      mode: "float",
      place: { right: 640, bottom: 200 },
      conversation: "k_01m6pg",
      drafts: {
        k_01m6pg: {
          text: "a medio escribir",
          pointed: [{ ref: { kind: "row", id: "e_01m6" }, title: "Fila: Rayuela" }],
        },
        new: { text: "otra nueva", pointed: [] },
      },
    };
    expect(readKept(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    expect(readKept({ mode: "right" }).mode).toBe("right");
  });

  it("a broken or old file opens the window as it always did, keeping what is sound", () => {
    expect(readKept(null)).toEqual({ mode: "closed", place: null, conversation: null, drafts: {} });
    expect(readKept("nonsense")).toEqual(readKept(null));
    const odd = readKept({
      mode: "maximised",
      place: { right: "10px", bottom: 4 },
      conversation: { id: "k_1" },
      drafts: {
        k_1: {
          text: "sigue",
          pointed: [
            { ref: { kind: "script", id: "x" }, title: "Fila: mala" },
            { ref: { kind: "row", id: "e_1" } },
            { ref: { kind: "row", id: "e_2" }, title: "Fila: buena" },
          ],
        },
        k_2: { text: "", pointed: [] },
        k_3: "texto suelto",
      },
    });
    expect(odd).toEqual({
      mode: "closed",
      place: null,
      conversation: null,
      drafts: {
        k_1: { text: "sigue", pointed: [{ ref: { kind: "row", id: "e_2" }, title: "Fila: buena" }] },
      },
    });
  });

  it("keeps the drafts of the last twenty conversations, no more", () => {
    const drafts = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`k_${i}`, { text: `t${i}`, pointed: [] }]),
    );
    const out = toKept({ mode: "closed", place: null, conversation: null, drafts });
    expect(Object.keys(out.drafts)).toHaveLength(20);
    expect(out.drafts.k_24?.text).toBe("t24");
    expect(out.drafts.k_0).toBeUndefined();
  });
});
