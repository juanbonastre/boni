import { leaf, rec, type TurnResult } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type ProposalRow, type UserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import {
  AUTO_AREA,
  acceptAlone,
  aloneRuns,
  autoOn,
  autoStates,
  confidence,
  decisionHistory,
  JUDGE_AFTER,
  judgeAlone,
  MIN,
  measure,
  setAutoState,
  WINDOW,
  wouldAccept,
} from "./autoAccept.ts";

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

/** An agent that accepts as the real one does: the proposal accepted, one entry created in a run of its own. */
function acceptor(store: UserStore, at: number) {
  const runs: string[] = [];
  return {
    runs,
    async acceptProposal(id: string): Promise<TurnResult> {
      const run = `acc-${id}`;
      store.journal.startRun({
        id: run,
        turn: null,
        origin: "accepted",
        device: null,
        started: at,
      });
      store.journal.setProposal(id, "accepted", at, null);
      store.create(
        "t_tarea",
        { f_title: { value: "Tarea inventada", label: l } },
        { actor: "agent", run },
      );
      runs.push(run);
      return {
        run,
        status: "done",
        replies: [],
        pending: null,
        proposals: [],
        notices: [],
        error: null,
        changed: true,
      };
    },
  };
}

describe("accepting alone, with «Solo» on (docs/fiabilidad.md §3.4, F3)", () => {
  it("the rule as a confidence: no basis below MIN, then the share of the last WINDOW kept as proposed", () => {
    expect(confidence([true, true])).toBe(0);
    expect(confidence([true, true, true])).toBe(1);
    expect(confidence([true, true, true, false])).toBe(0.75);
    expect(confidence([false, true, true, true, true, true])).toBe(1);
  });

  it("off: nothing is accepted and nothing written; on: the sure one is accepted, the other waits, both as decisions", async () => {
    const store = env();
    for (let i = 0; i < 3; i++) proposal(store, "boletin@example.edu", { accept: true });
    const sure = proposal(store, "boletin@example.edu");
    const unknown = proposal(store, "otro@example.edu");
    const agent = acceptor(store, 100);
    expect(await acceptAlone(store, agent, [sure.id, unknown.id], 100)).toBe(0);
    expect(store.journal.decisions(AUTO_AREA)).toEqual([]);
    expect(store.journal.proposal(sure.id)?.status).toBe("pending");

    setAutoState(store, AUTO_AREA, true, "juan", 50);
    expect(autoOn(store, AUTO_AREA)).toBe(true);
    expect(await acceptAlone(store, agent, [sure.id, unknown.id], 100)).toBe(1);
    expect(store.journal.proposal(sure.id)?.status).toBe("accepted");
    expect(store.journal.proposal(unknown.id)?.status).toBe("pending");
    const rows = store.journal.decisions(AUTO_AREA);
    expect(rows.map((d) => [d.area, d.cost, d.p, d.outcome, d.result, d.run])).toEqual([
      [AUTO_AREA, "B", 1, "do", null, sure.run],
      [AUTO_AREA, "B", 0, "ask", null, unknown.run],
    ]);
    expect(rows[0]?.detail).toEqual({ proposal: sure.id, run: agent.runs[0] });
    expect(aloneRuns(store)).toEqual(new Set(agent.runs));
    // Boni's own acceptance vouches for nothing: the history and the replay leave it out until Juan judges it.
    const key = [...decisionHistory(store).keys()].find((k) => k.includes("boletin@example.edu"));
    expect(decisionHistory(store).get(key ?? "")).toEqual([true, true, true]);
    expect(measure(store)).toEqual({ decided: 3, would: 0, right: 0 });
    // Accepting again changes nothing: the proposal is no longer pending.
    expect(await acceptAlone(store, agent, [sure.id], 101)).toBe(0);
  });

  it("judging: undone or deleted is wrong at once, kept a week is right (the reading's own decisions too); then the back-off", async () => {
    const store = env();
    const senders = ["a@example.edu", "b@example.edu", "c@example.edu"];
    for (const s of senders) for (let i = 0; i < 3; i++) proposal(store, s, { accept: true });
    const [a, b, c] = senders.map((s) => proposal(store, s)) as [
      ProposalRow,
      ProposalRow,
      ProposalRow,
    ];
    // The reading of c also chose its collection alone, unjudged until Juan decides.
    store.journal.addDecision({
      id: "choice-c",
      run: c.run,
      area: "choice",
      cost: "A",
      p: 0.9,
      outcome: "do",
      detail: null,
      at: 90,
    });
    setAutoState(store, AUTO_AREA, true, "juan", 50);
    const agent = acceptor(store, 100);
    expect(await acceptAlone(store, agent, [a.id, b.id, c.id], 100)).toBe(3);
    const results = () =>
      store.journal
        .decisions(AUTO_AREA)
        .filter((d) => d.outcome === "do")
        .map((d) => d.result);
    judgeAlone(store, 100 + 3_600_000);
    expect(results()).toEqual([null, null, null]);
    // a: undone; b: its entry deleted by hand.
    store.undoRun(agent.runs[0] as string, { actor: "user" });
    const made = store.runOps(agent.runs[1] as string).find((o) => o.kind === "create");
    store.remove(made?.target as string, { actor: "user" });
    judgeAlone(store, 100 + 7_200_000);
    expect(results()).toEqual(["wrong", "wrong", null]);
    expect(autoOn(store, AUTO_AREA)).toBe(true); // two judged: too few to back off
    // c: kept a week, right, and its reading's choice with it.
    judgeAlone(store, 100 + JUDGE_AFTER);
    expect(results()).toEqual(["wrong", "wrong", "right"]);
    expect(store.journal.decisionsOf(c.run).map((d) => [d.area, d.result])).toEqual([
      ["choice", "right"],
      [AUTO_AREA, "right"],
    ]);
    // Two wrong of three is over a fifth: Boni turns «Solo» off itself, and accepts nothing more.
    expect(autoOn(store, AUTO_AREA)).toBe(false);
    expect(autoStates(store)[AUTO_AREA]).toEqual({ on: false, at: 100 + JUDGE_AFTER, by: "boni" });
    const d = proposal(store, "c@example.edu");
    expect(await acceptAlone(store, agent, [d.id], 200 + JUDGE_AFTER)).toBe(0);
    expect(store.journal.proposal(d.id)?.status).toBe("pending");
    // Judged, the three count in the replay like Juan's own decisions.
    expect(measure(store)).toEqual({ decided: 12, would: 3, right: 1 });
  });
});
