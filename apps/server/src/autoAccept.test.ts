import { leaf, rec } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type ProposalRow, type UserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { MIN, measure, WINDOW, wouldAccept } from "./autoAccept.ts";

/** Proposals from invented mail and Juan's decisions on them, as the journal keeps them. */
const l = label("external", "personal", [{ kind: "mail", id: "x" }]);
function env(): UserStore {
  const store = openUserStore(":memory:");
  const u = label("user", "personal", []);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_tarea",
        key: "tarea",
        name: "Tareas",
        fields: [{ id: "f_title", key: "title", name: "Título", type: "text", label: u }],
        titleField: "f_title",
        sensitivity: "personal",
        schemaVersion: 1,
        label: u,
      },
    },
    { actor: "agent" },
  );
  return store;
}
let n = 0;
function proposal(
  store: UserStore,
  sender: string,
  decided?: { accept: boolean; corrected?: boolean },
): ProposalRow {
  const id = `p${++n}`;
  store.journal.startRun({
    id: `r${n}`,
    turn: null,
    origin: "background",
    device: null,
    started: n,
  });
  store.journal.addProposal({
    id,
    run: `r${n}`,
    tool: "entities.create",
    args: {
      values: { type: leaf("tarea", l), values: rec({ title: leaf("Tarea inventada", l) }, l) },
      origins: [],
    },
    view: {
      tool: "entities.create",
      title: "Crear",
      rows: [
        { arg: "type", role: "type", value: "tarea", detail: "Tareas" },
        { arg: "values.title", value: "Tarea inventada" },
      ],
    },
    sources: [`mail:${sender}`],
    created: n,
  });
  if (decided)
    store.journal.setProposal(
      id,
      decided.accept ? "accepted" : "rejected",
      n,
      decided.corrected ? { values: { title: { from: "Tarea inventada", to: "Otra" } } } : null,
    );
  return store.journal.proposal(id) as ProposalRow;
}

describe("when Boni would accept a proposal alone (measured, not done)", () => {
  it("the rule: at least MIN decided like it, the last WINDOW all accepted as proposed", () => {
    expect(MIN).toBe(3);
    expect(WINDOW).toBe(5);
    expect(wouldAccept([true, true])).toBe(false);
    expect(wouldAccept([true, true, true])).toBe(true);
    expect(wouldAccept([false, true, true, true, true, true])).toBe(true); // an old "no" left the window
    expect(wouldAccept([true, true, true, false])).toBe(false);
  });

  it("replays the rule over past decisions: a corrected one is a miss", () => {
    const store = env();
    for (let i = 0; i < 3; i++) proposal(store, "boletin@example.edu", { accept: true });
    proposal(store, "boletin@example.edu", { accept: true }); // would: right
    proposal(store, "boletin@example.edu", { accept: true, corrected: true }); // would: wrong
    proposal(store, "boletin@example.edu", { accept: true }); // the window has a miss: would not
    proposal(store, "boletin@example.edu", { accept: false });
    expect(measure(store)).toEqual({ decided: 7, would: 2, right: 1 });
  });
});
