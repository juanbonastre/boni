/** (test) The message being written to each conversation (F9, task 85): kept apart, never lost, never another's. */
import { describe, expect, it } from "vitest";
import { type Drafts, draftIn, madeDraft, withDraft, withoutDraft } from "./drafts.ts";
import type { Pointed } from "./pointing.ts";

const chart: Pointed = {
  ref: { kind: "block", page: "gastos", block: "b3" },
  title: "Gráfica: Gasto del mes",
};
const typed = (drafts: Drafts, conversation: string | null, text: string) =>
  withDraft(drafts, conversation, (d) => ({ ...d, text }));

describe("drafts (F9, task 85)", () => {
  it("each conversation keeps what is being written to it, the one not made yet too", () => {
    let drafts: Drafts = {};
    drafts = typed(drafts, null, "una nueva");
    drafts = typed(drafts, "c1", "sigue esta");
    drafts = withDraft(drafts, "c1", (d) => ({ ...d, pointed: [chart] }));
    expect(draftIn(drafts, null)).toEqual({ text: "una nueva", pointed: [] });
    expect(draftIn(drafts, "c1")).toEqual({ text: "sigue esta", pointed: [chart] });
    expect(draftIn(drafts, "c2")).toEqual({ text: "", pointed: [] });
    // One with nothing has the same empty draft every time (a component reading it is not painted again).
    expect(draftIn(drafts, "c2")).toBe(draftIn(drafts, "c3"));
  });

  it("an empty draft is not kept, and a deleted conversation's goes with it", () => {
    let drafts = typed({}, "c1", "algo");
    drafts = typed(drafts, "c1", "");
    expect(drafts).toEqual({});
    // Its text sent, what was pointed at for the next message is still a draft.
    drafts = withDraft({}, "c1", () => ({ text: "", pointed: [chart] }));
    expect(Object.keys(drafts)).toEqual(["c1"]);
    expect(withoutDraft(typed(drafts, "c2", "otra"), "c1")).toEqual({
      c2: { text: "otra", pointed: [] },
    });
  });

  it("what is typed while the server makes the conversation is that conversation's, not the next new one's", () => {
    // Enter on a new conversation: the bar is emptied, and the conversation is being made.
    let drafts = typed({}, null, "primer mensaje");
    drafts = typed(drafts, null, "");
    // Before the server answers, Juan writes on and points at a chart.
    drafts = typed(drafts, null, "y otra cosa");
    drafts = withDraft(drafts, null, (d) => ({ ...d, pointed: [chart] }));
    drafts = madeDraft(drafts, "c9");
    expect(draftIn(drafts, "c9")).toEqual({ text: "y otra cosa", pointed: [chart] });
    expect(draftIn(drafts, null)).toEqual({ text: "", pointed: [] });
    // Nothing was being written: nothing to carry.
    expect(madeDraft({}, "c9")).toEqual({});
  });
});
