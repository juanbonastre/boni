/** (test) The numbers of the «Modelos» canvas from an invented journal (task 59b). */
import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { pipelineStats, pipelineView } from "./pipeline.ts";
import { seed } from "./seed.test-util.ts";

/** A store with one invented mail (a background run's plan names it: that is what makes the run a mail's reading). */
function withMail(): { store: ReturnType<typeof openUserStore>; mail: string } {
  const store = openUserStore(":memory:");
  seed(store, [{ key: "correo", name: "Correos", folder: "correos/" }], {
    "correos/2026-11-04 Quedar.md":
      '---\nasunto: "Quedar para café"\nde: "ejemplo@example.com"\n---\n',
  });
  const mail = store.list("t_correo")[0]?.entity.id;
  if (!mail) throw new Error("no mail");
  return { store, mail };
}
const mailPlanOf = (mail: string) => ({
  version: 1,
  steps: [
    { id: "m", op: "call", tool: "entities.get", args: { id: { lit: mail } } },
    { id: "r", op: "read", reader: "read_message", args: {} },
    { id: "c", op: "call", tool: "entities.create", args: {} },
  ],
});

const NOW = Date.UTC(2026, 10, 5, 12);
const H = 60 * 60_000;

describe("the flow's numbers (task 59b)", () => {
  it("counts each call at its reader, runs where they start, proposals along the arrows, and the chat's steps", () => {
    const { store, mail } = withMail();
    const j = store.journal;
    const call = (run: string, role: string, kind: string | null, at: number, cost = 0.001) =>
      j.modelCall({
        run,
        role,
        provider: "fake",
        model: "modelo-ejemplo",
        promptHash: "h",
        request: {
          role,
          ...(kind ? { kind } : {}),
          system: "",
          input: {},
          schema: {},
          maxTokens: 1,
        },
        response: {},
        usage: { input: 10, output: 5, cost },
        at,
      });
    // A mail read in the background: the reading, the collection, the fields, a proposal Juan accepted.
    j.startRun({
      id: "run-mail",
      turn: null,
      origin: "background",
      device: null,
      started: NOW - 2 * H,
    });
    j.finishRun("run-mail", "done", mailPlanOf(mail), NOW - 2 * H + 1000);
    call("run-mail", "reader", "read_message", NOW - 2 * H, 0.002);
    call("run-mail", "decider", null, NOW - 2 * H + 100, 0.0001);
    call("run-mail", "reader", "fill", NOW - 2 * H + 200, 0.001);
    j.addProposal({
      id: "p1",
      run: "run-mail",
      tool: "entities.create",
      args: {},
      view: {},
      sources: [],
      created: NOW - 2 * H + 300,
    });
    j.setProposal("p1", "accepted", NOW - H, null);
    // A request in the conversation: the planner, a reader, two tool calls (one allowed, one proposed).
    j.startRun({
      id: "run-turn",
      turn: "t1",
      origin: "turn",
      device: "portatil",
      started: NOW - 3 * H,
    });
    j.finishRun("run-turn", "done", { version: 1, steps: [] }, NOW - 3 * H + 500);
    call("run-turn", "planner", null, NOW - 3 * H, 0.01);
    call("run-turn", "reader", "summarize_each", NOW - 3 * H + 10, 0.001);
    j.step({
      run: "run-turn",
      step: "s",
      kind: "read",
      decision: "allow",
      rule: "P1",
      detail: null,
      at: NOW - 3 * H + 10,
    });
    j.step({
      run: "run-turn",
      step: "q",
      kind: "call",
      decision: "allow",
      rule: "P1",
      detail: null,
      at: NOW - 3 * H + 20,
    });
    j.step({
      run: "run-turn",
      step: "w",
      kind: "call",
      decision: "propose",
      rule: "P4",
      detail: null,
      at: NOW - 3 * H + 30,
    });
    // A call of an older server, naming no reader: at the role's node; one from before the period: not at all.
    call("run-mail", "reader", null, NOW - H, 0.001);
    call("run-old", "reader", "fill", NOW - 10 * 24 * H, 0.5);
    const s = pipelineStats(store, NOW, 7, null);
    expect(s.nodes.read_message).toMatchObject({ calls: 2, cost: 0.003, last: NOW - H });
    expect(s.nodes.classify).toMatchObject({ calls: 1, cost: 0.0001 });
    expect(s.nodes.fill).toMatchObject({ calls: 1, cost: 0.001 });
    expect(s.nodes.planner).toMatchObject({ calls: 1, cost: 0.01, runs: 0 });
    expect(s.nodes.readers).toMatchObject({ calls: 1 });
    expect(s.nodes.mail?.runs).toBe(1);
    expect(s.nodes.conversation?.runs).toBe(1);
    expect(s.nodes.inbox?.runs).toBe(0);
    expect(s.edges).toMatchObject({
      "mail>read_message": 1,
      "read_message>classify": 1,
      "classify>fill": 1,
      "relations>inbox": 1,
      "inbox>user": 1,
      "user>store": 1,
      "conversation>planner": 1,
      "planner>readers": 1,
      "planner>tools": 2,
      "policy>store": 1,
      "policy>inbox": 1,
      "learners>inbox": 0,
    });
    expect(s.nodes.classify?.accuracy).toBeNull();
    // What the canvas gets: the declared nodes and arrows with these numbers on them.
    const v = pipelineView(store, NOW, 7, null);
    expect(v.nodes.find((n) => n.id === "read_message")).toMatchObject({
      kind: "model",
      role: "reader",
      calls: 2,
    });
    expect(v.edges.find((e) => e.from === "relations" && e.to === "inbox")).toMatchObject({
      what: "proposals",
      n: 1,
    });
    expect(v.edges.find((e) => e.from === "external")?.n).toBeNull();
    store.close();
  });

  it("answers in well under a second with a week of runs like Juan's (A-15)", () => {
    const { store, mail } = withMail();
    const j = store.journal;
    for (let i = 0; i < 400; i++) {
      const id = `run-${i}`;
      const at = NOW - 1 - (i % 6) * 24 * H - (i % 24) * H;
      j.startRun({
        id,
        turn: i % 5 === 0 ? `t${i}` : null,
        origin: i % 5 === 0 ? "turn" : "background",
        device: null,
        started: at,
      });
      j.finishRun(id, "done", mailPlanOf(mail), at + 100);
      for (const [role, kind] of [
        ["reader", "read_message"],
        ["decider", null],
        ["reader", "fill"],
      ] as const)
        j.modelCall({
          run: id,
          role,
          provider: "fake",
          model: "m",
          promptHash: "h",
          request: { role, ...(kind ? { kind } : {}) },
          response: {},
          usage: { input: 1, output: 1, cost: 0.001 },
          at,
        });
      j.addProposal({
        id: `p-${i}`,
        run: id,
        tool: "entities.create",
        args: {},
        view: {},
        sources: [],
        created: at + 50,
      });
      if (i % 2) j.setProposal(`p-${i}`, "accepted", at + 60, null);
      for (let k = 0; k < 3; k++)
        j.step({
          run: id,
          step: `s${k}`,
          kind: "call",
          decision: "allow",
          rule: "P1",
          detail: null,
          at: at + k,
        });
    }
    const t0 = performance.now();
    const s = pipelineStats(store, NOW, 7, null);
    const ms = performance.now() - t0;
    expect(s.nodes.read_message?.calls).toBe(400);
    expect(s.nodes.mail?.runs).toBe(320);
    expect(s.edges["mail>read_message"]).toBe(320);
    expect(ms).toBeLessThan(1000);
    store.close();
  });
});
