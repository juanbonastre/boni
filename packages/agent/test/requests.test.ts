import { afterEach, describe, expect, it } from "vitest";
import { REQUEST_DAYS } from "../src/agent.ts";
import { fakePlanner, ScriptedProvider } from "../src/providers.ts";
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

/** A classify that may ask (mail's collection, Juan 2026-10-24): the answer of the decider decides when to. */
const classify = {
  version: 1,
  steps: [
    {
      id: "c",
      op: "read",
      reader: "classify",
      input: lit("Entrega de actas del segundo parcial antes del viernes"),
      params: {
        options: { fn: "list", args: [lit("Docencia"), lit("Gestiones")] },
        ask: lit("¿A qué colección va «Entrega de actas»?"),
      },
    },
    {
      id: "n",
      op: "call",
      tool: "entities.create",
      args: { type: lit("tarea"), values: { fn: "obj", args: [lit("titulo"), ref("$c.choice")] } },
    },
  ],
};
const jev = (c: [string, number], r: [string, number]) =>
  new ScriptedProvider("jev", () => ({
    c: { choice: c[0], confidence: c[1] },
    r: { choice: r[0], confidence: r[1] },
  }));
const titled = (e: Env, id: string) =>
  JSON.stringify(e.store.journal.proposal(id)?.args).match(/"value":"(Docencia|Gestiones)"/)?.[1];

describe("classify asks Juan only when the decider is unsure", () => {
  it("the decider disagrees with itself: Juan chooses, and no model is called again", async () => {
    env = makeEnv();
    const reader = new ScriptedProvider("fake", () => ({ choice: "Gestiones" }));
    const decider = jev(["Docencia", 0.9], ["Gestiones", 0.8]);
    const a = env.agent(fakePlanner([]), reader, { decider });
    const r = await a.background(classify);
    expect(r.status).toBe("waiting");
    if (r.pending?.kind !== "ask") throw new Error("expected a question");
    expect(r.pending.options.map((o) => (o.t === "v" ? o.value : null))).toEqual([
      "Docencia",
      "Gestiones",
    ]);
    expect(env.store.journal.requests("pending")).toHaveLength(1);
    expect(reader.requests).toHaveLength(0);
    const done = await a.answer(r.run, r.pending.id, { choice: 0 }, { trust: "personal" });
    expect(done.status).toBe("done");
    expect(titled(env, done.proposals[0] as string)).toBe("Docencia");
    expect(decider.requests).toHaveLength(1);
    expect(reader.requests).toHaveLength(0);
  });

  it("not confident enough is unsure too; sure, it decides alone", async () => {
    env = makeEnv();
    const reader = new ScriptedProvider("fake", () => ({ choice: "Docencia" }));
    const low = await env
      .agent(fakePlanner([]), reader, { decider: jev(["Gestiones", 0.5], ["Gestiones", 0.9]) })
      .background(classify);
    expect(low.status).toBe("waiting");
    const sure = await env
      .agent(fakePlanner([]), reader, { decider: jev(["Gestiones", 0.9], ["Gestiones", 0.7]) })
      .background(classify);
    expect(sure.status).toBe("done");
    expect(titled(env, sure.proposals[0] as string)).toBe("Gestiones");
  });

  it("with the decider down, or a plan that does not ask, the reader chooses as before", async () => {
    env = makeEnv();
    const reader = new ScriptedProvider("fake", () => ({ choice: "Gestiones" }));
    const down = new ScriptedProvider("jev", () => {
      throw Object.assign(new Error("x"), { code: "http-529" });
    });
    const r = await env.agent(fakePlanner([]), reader, { decider: down }).background(classify);
    expect(r.status).toBe("done");
    expect(titled(env, r.proposals[0] as string)).toBe("Gestiones");
    const quiet = structuredClone(classify);
    delete (quiet.steps[0] as { params: { ask?: unknown } }).params.ask;
    const q = await env
      .agent(fakePlanner([]), reader, { decider: jev(["Docencia", 0.9], ["Gestiones", 0.9]) })
      .background(quiet);
    expect(q.status).toBe("done");
    expect(env.store.journal.requests("pending")).toEqual([]);
  });
});
