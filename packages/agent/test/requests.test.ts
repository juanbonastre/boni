import { afterEach, describe, expect, it } from "vitest";
import { REQUEST_DAYS } from "../src/agent.ts";
import { fakePlanner } from "../src/providers.ts";
import { type Env, makeEnv } from "./fixture.ts";

/**
 * The panel of requests (Juan, 2026-10-24): background work may ask Juan; the run waits in the journal (days, a
 * restart) and goes on when he answers, still as background work (P7: it proposes); unanswered it expires.
 */
let env: Env;
afterEach(() => env?.close());

const lit = (v: string | number | boolean | null) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const DAY = 24 * 60 * 60_000;

/** A plan made by code: ask, then create a task with the answer. */
const plan = (control: "choice" | "text") => ({
  version: 1,
  steps: [
    control === "choice"
      ? {
          id: "q",
          op: "ask",
          control: "choice",
          prompt: lit("¿Qué título le pongo?"),
          options: { fn: "list", args: [lit("Llamar a la gestoría"), lit("Pagar el IBI")] },
        }
      : { id: "q", op: "ask", control: "text", prompt: lit("¿Qué título le pongo?") },
    {
      id: "c",
      op: "call",
      tool: "entities.create",
      args: { type: lit("tarea"), values: { fn: "obj", args: [lit("titulo"), ref("$q")] } },
    },
  ],
});

describe("questions from background work (the panel of requests)", () => {
  it("waits in the journal, survives a restart and goes on as background work", async () => {
    env = makeEnv();
    let now = Date.UTC(2026, 9, 24, 9);
    const clock = { now: () => now };
    const r = await env.agent(fakePlanner([]), undefined, clock).background(plan("choice"));
    expect(r.status).toBe("waiting");
    if (r.pending?.kind !== "ask") throw new Error("expected a question");
    const [req] = env.store.journal.requests("pending");
    expect(req).toMatchObject({ id: r.pending.id, run: r.run, expires: now + REQUEST_DAYS * DAY });
    expect(env.store.journal.runState(r.run)).not.toBeNull();

    // Another Agent over the same store: the server restarted.
    now += 2 * DAY;
    const again = env.agent(fakePlanner([]), undefined, clock);
    expect(again.requests().map((x) => x.id)).toEqual([r.pending.id]);
    const done = await again.answer(r.run, r.pending.id, { choice: 1 }, { trust: "personal" });
    expect(done.status).toBe("done");
    // Still background work: the task is a proposal, not made.
    expect(done.proposals).toHaveLength(1);
    expect(env.store.list("t_tarea").some((s) => s.entity.values.f_titulo === "Pagar el IBI")).toBe(
      false,
    );
    expect(env.store.journal.request(r.pending.id)).toMatchObject({
      status: "answered",
      answer: { choice: 1 },
    });
    expect(env.store.journal.runState(r.run)).toBeNull();
    expect(again.requests()).toEqual([]);
    // Answered once: a second answer finds nothing.
    expect((await again.answer(r.run, r.pending.id, { choice: 0 })).error).toBe("nothing-pending");
  });

  it("what Juan types is his only from a personal device", async () => {
    env = makeEnv();
    const typed = async (trust: "personal" | "shared") => {
      const a = env.agent(fakePlanner([]));
      const r = await a.background(plan("text"));
      if (r.pending?.kind !== "ask") throw new Error("expected a question");
      const done = await a.answer(r.run, r.pending.id, { text: `Tarea ${trust}` }, { trust });
      const p = env.store.journal.proposal(done.proposals[0] as string);
      return JSON.stringify(p?.args);
    };
    expect(await typed("personal")).toContain('"integrity":"user"');
    expect(await typed("shared")).toContain('"integrity":"ambient"');
  });

  it("expires after its days, and Juan can put it away: either way its run ends doing nothing more", async () => {
    env = makeEnv();
    let now = Date.UTC(2026, 9, 24, 9);
    const a = env.agent(fakePlanner([]), undefined, { now: () => now });
    const late = await a.background(plan("choice"));
    const away = await a.background(plan("choice"));
    if (late.pending?.kind !== "ask" || away.pending?.kind !== "ask") throw new Error("questions");

    expect(a.dismissRequest(away.pending.id)).toBe(true);
    expect(a.dismissRequest(away.pending.id)).toBe(false);
    expect(env.store.journal.run(away.run)?.status).toBe("stopped:dismissed");
    expect((await a.answer(away.run, away.pending.id, { choice: 0 })).error).toBe(
      "nothing-pending",
    );

    now += REQUEST_DAYS * DAY + 1;
    expect(a.requests()).toEqual([]);
    expect(env.store.journal.request(late.pending.id)?.status).toBe("expired");
    expect(env.store.journal.run(late.run)?.status).toBe("stopped:expired");
    expect((await a.answer(late.run, late.pending.id, { choice: 0 })).error).toBe(
      "nothing-pending",
    );
    expect(env.store.journal.proposals()).toEqual([]);
  });
});
