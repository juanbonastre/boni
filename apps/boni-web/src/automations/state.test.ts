// The editor's own state (docs/automatizaciones.md §5.7). Pending but AU-62's: see edit.test.ts.
import { FORMAT } from "@boni/automations";
import { describe, expect, it } from "vitest";
import type { Opened } from "./client.ts";
import { change, emptyEditor, openedEditor, saved, saveFailed } from "./state.ts";

const trigger = { id: "s_inicio", name: "Disparado por el usuario", type: "manual", params: {} };
const opened: Opened = {
  id: "a_01jexample",
  rev: 3,
  automation: {
    format: FORMAT,
    id: "a_01jexample",
    version: 0,
    name: "Revisar gastos",
    steps: [trigger],
    arrows: [],
    settings: {},
  },
  places: [{ step: "s_inicio", x: 0, y: 0 }],
  tests: {},
  tested: {},
  device: "d_portatil",
  updated: 1,
};

describe("the draft saves itself", () => {
  it("AU-62 · «Nueva» owes the server nothing until its first step; every change after it is owed, and «Guardado» says saving, saved or failed", () => {
    const empty = emptyEditor("Nueva automatización");
    expect(empty.id).toBeNull();
    expect(empty.draft.name).toBe("Nueva automatización");
    expect(empty.owed).toEqual({ draft: false, places: [] });
    // Renamed before its first step: still nothing to send.
    const renamed = change(empty, { draft: { ...empty.draft, name: "Resumen" } });
    expect(renamed.owed.draft).toBe(false);
    expect(renamed.save).toBe("saved");
    // Its first step makes it.
    const first = change(renamed, { draft: { ...renamed.draft, steps: [trigger] } });
    expect(first.owed.draft).toBe(true);
    expect(first.save).toBe("saving");
    // Opened, every change is owed; one that changes nothing is nothing.
    const s = openedEditor(opened);
    expect(s.save).toBe("saved");
    expect(s.places).toEqual({ s_inicio: { x: 0, y: 0 } });
    expect(change(s, { draft: { ...s.draft } })).toBe(s);
    const edited = change(s, { draft: { ...s.draft, name: "Revisar gastos del mes" } });
    expect(edited.owed.draft).toBe(true);
    expect(edited.save).toBe("saving");
    expect(edited.past).toHaveLength(1);
    const kept = saved(edited, { rev: 4, stale: [] }, edited.draft);
    expect(kept.save).toBe("saved");
    expect(kept.rev).toBe(4);
    expect(kept.owed.draft).toBe(false);
    expect(saveFailed(edited).save).toBe("failed");
  });
  it("AU-62 · a save that fails leaves what is owed owed, and a change made while a save is out is sent after it, never lost and never before it", () => {
    const s = openedEditor(opened);
    const one = change(s, { draft: { ...s.draft, name: "Uno" } });
    const failed = saveFailed(one);
    expect(failed.owed.draft).toBe(true);
    expect(failed.draft.name).toBe("Uno");
    // Sent «Uno»; «Dos» typed while it was out: the answer to «Uno» leaves «Dos» owed, and «Dos» stays.
    const sent = failed.draft;
    const two = change(failed, { draft: { ...failed.draft, name: "Dos" } });
    const answered = saved(two, { rev: 4, stale: [] }, sent);
    expect(answered.draft.name).toBe("Dos");
    expect(answered.owed.draft).toBe(true);
    expect(answered.save).toBe("saving");
    const last = saved(answered, { rev: 5, stale: [] }, answered.draft);
    expect(last.owed.draft).toBe(false);
    expect(last.rev).toBe(5);
  });
  it.todo(
    "AU-05 · moving a box is owed as its place and not as a draft: the draft's rev does not change and no test becomes stale",
  );
  it.todo(
    "AU-05 · a step added has its place from then on, owed to the server like one Juan dropped: where the right click was, or where placeFor says; a later step never moves it",
  );
});

describe("undo", () => {
  it.todo(
    "AU-68 · Deshacer walks back every change since the editor opened (a step added or removed, an arrow, a box moved, a name, a parameter, a setting) and Rehacer forward; a new change empties what could be redone",
  );
  it.todo(
    "AU-68 · what Deshacer brings back is owed to the server like any other change, and opening a step or selecting one is not a change",
  );
  it.todo(
    "AU-82 · the notice of what a change of action took away undoes it in one step, parameters and name together",
  );
});

describe("after a test", () => {
  it.todo(
    "AU-64 · «Registro» says untested, then the last test in one line (when, how it ended, how many steps, how long, that it wrote nothing) or the step it failed in; with problems it says how many and tests nothing",
  );
  it.todo(
    "AU-67 · every arrow has the rows that passed by it and every output with no arrow its count; a failed step's dependants are skipped",
  );
  it.todo(
    "AU-92 · the steps the server says are stale after a save keep their counts, marked; a test of them clears the mark",
  );
  it.todo(
    "AU-83 · the problems shown after a test was asked leave a step as soon as it changes, and none is shown before one is asked",
  );
});
