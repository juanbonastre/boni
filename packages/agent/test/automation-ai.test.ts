// The policy for the AI steps of an automation (docs/automatizaciones.md §5.5, §5.6 and §6, phase F15): what an AI
// step's write saves (the rows that replace P28's third, decisions 11 and 16 of its §10), the connection checked
// inside `decide` (P29), and the rounds of an «Agente» over the plan language (AU-45, AU-56, AU-165, AU-198, AU-204,
// AU-205). One test per row of each table, as `automation-origin.test.ts` does for P28. The rounds (AU-56, AU-198)
// are E3's, with a scripted model, never a real one.
import { type Label, label } from "@boni/entities";
import { clock, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import {
  type Call,
  decide,
  type Origin,
  outsideReach,
  P29_REASONS,
  type ReachAction,
  type ReachLimits,
  type StepReach,
} from "../src/policy.ts";
import {
  type AgentCall,
  type AgentRequest,
  type Labelled,
  type Planner,
  runRounds,
  valOf,
} from "../src/rounds.ts";
import type { ToolDef } from "../src/tools.ts";
import { leaf, rec, type Val } from "../src/values.ts";
import { testRegistry } from "./fixture.ts";

const reg = testRegistry();
const tool = (name: string): ToolDef => {
  const t = reg.get(name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const CREATE = tool("entities.create");
const UPDATE = tool("entities.update");
const TRASH = tool("entities.delete");
const QUERY = tool("entities.query");
const MEMORY = tool("memory.save");
const SEND = tool("mail.send");
const FETCH = tool("web.fetch");
const PURGE: ToolDef = { ...TRASH, name: "ejemplo.purge", effect: "write_irreversible" };

const user = label("user", "personal", [{ kind: "turn", id: "t" }]);
const own = label("own", "personal", []);
const ext = label("external", "personal", [{ kind: "mail", id: "m" }]);
const model = label("model", "public", [{ kind: "model", id: "r" }]);
const ambient = label("ambient", "public", []);

const AUTOMATION: Origin = { kind: "automation", trust: "personal" };
const OTHERS: readonly Origin[] = [
  { kind: "turn", trust: "personal" },
  { kind: "background", trust: "personal" },
  { kind: "miniapp", trust: "personal" },
  { kind: "assistant", trust: "personal" },
];
const fresh = () => ({ writes: 0, sensitiveReads: 0 });
const ACTION: ReadonlyMap<ToolDef, ReachAction> = new Map([
  [CREATE, "create"],
  [UPDATE, "update"],
  [TRASH, "remove"],
  [QUERY, "read"],
]);

/** A connection as an «Agente» step is born with it (AU-196): reading all, every write at «Como mucho 20». */
const OPEN: Record<ReachAction, false | ReachLimits> = {
  read: {},
  create: { limit: 20 },
  update: { limit: 20 },
  remove: { limit: 20 },
};
const TYPES = { titulo: "text", nota: "text", estado: "select", importe: "number" };
const ROW = { titulo: "Ejemplo", nota: "", estado: "abierta", importe: 12 };

/** What the server reads for an AI step's call: its connection, the row and the step's count so far. */
function reach(t: ToolDef, more: Partial<StepReach> = {}): StepReach {
  return {
    collection: "ejemplo_tareas",
    action: ACTION.get(t) ?? "read",
    private: false,
    cells: OPEN,
    row: t === QUERY ? undefined : ROW,
    types: TYPES,
    today: "2026-11-17",
    written: 0,
    ...more,
  };
}
/** A step's write with its fields' labels, as `automation-origin.test.ts` makes them. */
function write(t: ToolDef, fields: Label | null, more: Partial<Call> = {}): Call {
  const args: Record<string, Val> = {};
  if (t === CREATE) args.type = leaf("ejemplo_tareas", own);
  if (t === UPDATE || t === TRASH) args.id = leaf("e_01ejemplo0000000000000001", own);
  if (fields && (t === CREATE || t === UPDATE))
    args.values = rec({ titulo: leaf("x", fields, true), nota: leaf("y", own) }, fields, true);
  return { tool: t, args, control: null, flow: true, ...more };
}
/** The same write as an «Agente» makes it: its type and its connection, from the stored version. */
const agent = (t: ToolDef, fields: Label | null, more: Partial<Call> = {}): Call =>
  write(t, fields, { byAgent: true, reach: reach(t), ...more });
const query = (more: Partial<Call> = {}): Call => ({
  tool: QUERY,
  args: { type: leaf("ejemplo_tareas", own) },
  control: null,
  flow: true,
  ...more,
});
const ruled = (c: Call, origin = AUTOMATION, counters = fresh()) => {
  const d = decide(c, origin, counters);
  return `${d.kind} ${d.rule}${d.kind === "deny" && d.rule === "P29" ? ` ${d.reason}` : ""}`;
};
const WRITES = [CREATE, UPDATE, TRASH] as const;

/** One unit of an «Agente» as the engine sends it (rounds.ts), reading and writing, with «Texto» as its answer. */
function agentCall(more: Partial<AgentCall> = {}): AgentCall {
  return {
    use: "agent",
    model: null,
    instructions: [{ json: "Revisa las tareas", label: own }],
    rows: [],
    connections: [{ collection: "ejemplo_tareas", read: true }],
    answer: { kind: "text" },
    reads: true,
    maxRounds: 5,
    today: "2026-11-17",
    zone: "Europe/Madrid",
    language: "es",
    written: model,
    modelCall: () => {},
    called: () => {},
    now: () => 0,
    tool: async () => ({ rows: [] }),
    ...more,
  };
}

/** Only the arguments a tool declares, with a value for each it requires. */
function pick(t: ToolDef, args: Record<string, Val>): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [name, spec] of Object.entries(t.args))
    if (args[name]) out[name] = args[name];
    else if ((spec as { required?: boolean }).required) out[name] = leaf("x", user);
  return out;
}

describe("the policy for an automation's AI steps (F15)", () => {
  it("AU-45 · a «Sí» in a connection opens no destination taken from outside or from a model, and nothing of what Boni knows of the person", () => {
    const to = { to: leaf("ejemplo.ana@example.com", user), subject: leaf("x", user) };
    for (const by of [true, false]) {
      const more = { yes: true, byAgent: by };
      for (const [v, rule] of [
        [leaf("ejemplo.ana@example.com", ext), "P2"],
        [leaf("ejemplo.ana@example.com", model), "P2"],
        [leaf("ejemplo.ana@example.com", user, true), "P14"],
      ] as const)
        expect(
          ruled({ tool: SEND, args: pick(SEND, { ...to, to: v }), control: null, ...more }),
        ).toBe(`deny ${rule}`);
      const url = leaf("https://example.com", model);
      expect(
        decide({ tool: FETCH, args: pick(FETCH, { url }), control: null, ...more }, AUTOMATION, {
          ...fresh(),
        }).kind,
      ).toBe("deny");
      // What Boni knows of the person is not a collection a connection opens: memory is not an automation's.
      expect(
        ruled({ tool: MEMORY, args: { text: leaf("z", model) }, control: null, ...more }),
      ).toBe("deny P28");
      expect(ruled({ tool: MEMORY, args: { text: leaf("z", ext) }, control: null, ...more })).toBe(
        "deny P9",
      );
    }
    // And a collection no model may read stays closed whatever the connection says.
    expect(ruled(query({ byAgent: true, reach: reach(QUERY, { private: true }) }))).toBe(
      "deny P29 private-collection",
    );
  });

  it("AU-56 · a round is a plan validated and decided call by call with the origin `automation`; a plan that asks, remembers or goes outside is refused", async () => {
    // The engine's side, as the server's port will have it: each call of a round is the tool of the policy it is
    // (a read, a create), asked with the origin `automation`, the step's type and its connection (AU-204, AU-205).
    const decided: string[] = [];
    const rows = [
      { json: { id: "e_01ejemplo0000000000000001", titulo: "Ejemplo uno" }, label: own },
      { json: { id: "e_01ejemplo0000000000000002", titulo: "Ejemplo dos" }, label: ext },
    ];
    const tool: AgentCall["tool"] = async (name, args) => {
      const t = name === "find" ? QUERY : name === "create" ? CREATE : TRASH;
      const values = name === "create" ? valOf(args.fields as Labelled) : undefined;
      const call: Call = {
        tool: t,
        args: { type: leaf("ejemplo_tareas", own), ...(values ? { values } : {}) },
        control: null,
        flow: true,
        byAgent: true,
        reach: reach(t),
      };
      decided.push(`${name} ${ruled(call)}`);
      if (name === "find") return { rows };
      return { planned: "will create 1 row in ejemplo_tareas" };
    };
    const asked: AgentRequest[] = [];
    const plans: unknown[] = [
      {
        version: 1,
        steps: [{ id: "s1", op: "call", tool: "find", args: { collection: "ejemplo_tareas" } }],
      },
      {
        version: 1,
        steps: [
          {
            id: "s1",
            op: "call",
            tool: "create",
            args: {
              collection: "ejemplo_tareas",
              fields: { fn: "obj", args: [{ lit: "titulo" }, { ref: "$round1.s1[1].titulo" }] },
            },
          },
          { id: "s2", op: "call", tool: "answer", args: { texto: { lit: "Hecho" } } },
        ],
      },
    ];
    const reply = await runRounds(agentCall({ tool }), async (r) => {
      asked.push(r);
      return { plan: plans.shift(), model: "ejemplo-modelo" };
    });
    expect(reply).toMatchObject({ rounds: 2, answer: { texto: { json: "Hecho" } } });
    // The read is allowed; the create carries a title read from outside, so without the cell's «Sí» it is proposed.
    expect(decided).toEqual(["find allow P1", "create propose P28"]);
    // What came back to the second round: its own row seen, the one from outside as a handle only.
    expect(asked[1]?.rounds).toEqual([
      {
        s1: [
          { id: "e_01ejemplo0000000000000001", titulo: "Ejemplo uno" },
          {
            $handle: "$round1.s1[1]",
            integrity: "external",
            kind: "record",
            fields: ["id", "titulo"],
          },
        ],
      },
    ]);

    // A plan that asks, one that remembers, one that sends: none is a round's; each is asked again once, then fails.
    for (const bad of [
      { id: "s1", op: "ask", control: "text", prompt: { lit: "¿Qué?" } },
      { id: "s1", op: "call", tool: "memory.save", args: { text: { lit: "x" } } },
      { id: "s1", op: "call", tool: "mail.send", args: { to: { lit: "ejemplo.ana@example.com" } } },
      { id: "s1", op: "read", reader: "summarize", input: { ref: "$rows" } },
    ]) {
      let calls = 0;
      const got = await runRounds(agentCall({ tool, modelCall: () => void calls++ }), async () => ({
        plan: { version: 1, steps: [bad] },
        model: "ejemplo-modelo",
      }));
      expect(got).toMatchObject({ fault: "agent.plan", rounds: 1 });
      expect(calls).toBe(2);
    }
  });
  it("AU-198 · a plan that is not valid is asked again once within the round and then fails the step", async () => {
    const tool: AgentCall["tool"] = async () => ({ rows: [] });
    const answer = {
      version: 1,
      steps: [{ id: "s1", op: "call", tool: "answer", args: { texto: { lit: "Listo" } } }],
    };
    const tooMany = {
      version: 1,
      steps: Array.from({ length: 41 }, (_, i) => ({
        id: `s${i + 1}`,
        op: "call",
        tool: "count",
        args: { collection: "ejemplo_tareas" },
      })),
    };
    // Not a plan, then a plan: two calls, one round, the answer; the second call was told why.
    const asked: AgentRequest[] = [];
    let calls = 0;
    const scripted =
      (plans: unknown[]): Planner =>
      async (r) => {
        asked.push(r);
        return { plan: plans.shift(), model: "ejemplo-modelo" };
      };
    const ok = await runRounds(
      agentCall({ tool, modelCall: () => void calls++ }),
      scripted(["no", answer]),
    );
    expect(ok).toMatchObject({ rounds: 1, answer: { texto: { json: "Listo" } } });
    expect(calls).toBe(2);
    expect(asked[1]?.again).toEqual({ fault: "plan", errors: ["plan: not-a-plan"] });
    // Over the 40 steps of P12, twice: the step fails with `agent.plan`, after two calls and nothing run.
    calls = 0;
    let ran = 0;
    const bad = await runRounds(
      agentCall({
        tool: async () => {
          ran++;
          return { rows: [] };
        },
        modelCall: () => void calls++,
      }),
      scripted([tooMany, tooMany]),
    );
    expect(bad).toMatchObject({ fault: "agent.plan", errors: ["plan: too-many-steps"], rounds: 1 });
    expect([calls, ran]).toEqual([2, 0]);
    // The call that would pass «Llamadas a modelos» throws, and the rounds stop there, untouched.
    const limit = new Error("run.limit");
    await expect(
      runRounds(
        agentCall({
          tool,
          modelCall: () => {
            throw limit;
          },
        }),
        scripted([answer]),
      ),
    ).rejects.toBe(limit);
  });

  it("AU-165 · the policy changes in two places only: the rows of AU-204 and P29; every other rule answers this origin as before", () => {
    // A call inside its connection is answered as the same call without one, for every origin and every tool: P29
    // only takes away. What changed from F14d for the origin `automation` is the model's value with the «Sí».
    const calls: Call[] = [
      query(),
      write(CREATE, user),
      write(UPDATE, ext, { yes: true }),
      write(TRASH, null, { yes: true, control: ext }),
      write(TRASH, null),
      write(UPDATE, ambient, { yes: true }),
      { ...write(PURGE, null), yes: true },
      { tool: MEMORY, args: { text: leaf("z", user) }, control: null, yes: true },
      {
        tool: SEND,
        args: pick(SEND, { to: leaf("ejemplo.ana@example.com", user) }),
        control: null,
        yes: true,
      },
    ];
    for (const origin of [AUTOMATION, ...OTHERS])
      for (const c of calls) {
        // Only a collection's act has a connection: a send or a memory is denied before any.
        const act = c.tool === PURGE ? TRASH : (c.tool as ToolDef);
        if (!ACTION.has(act)) continue;
        const inside = { ...c, reach: reach(act) };
        expect(ruled(inside, origin), `${origin.kind} ${act.name}`).toBe(ruled(c, origin));
      }
    // The other origins answer a model's value as before: the AU-204 rows are the origin `automation`'s alone.
    for (const origin of OTHERS)
      for (const t of [CREATE, UPDATE])
        expect(ruled(write(t, model, { yes: true }), origin), origin.kind).not.toBe("allow P28");
  });

  it("AU-204 · a value a model wrote, written by a «Código» or a «Colección» with the version's «Sí», is allowed and keeps its label", () => {
    for (const t of [CREATE, UPDATE]) {
      const c = write(t, model, { yes: true });
      expect(ruled(c), t.name).toBe("allow P28");
      // The decision changes no value: the label the store keeps is the one the call carried (AU-170).
      expect((c.args.values as { label: Label }).label.integrity).toBe("model");
      // A path a model's value chose is the same: the «Sí» is what saves.
      expect(ruled(write(t, user, { yes: true, control: model })), `${t.name} control`).toBe(
        "allow P28",
      );
    }
    expect(ruled(write(TRASH, null, { yes: true, control: model }))).toBe("allow P28");
    // Hidden under a value from outside in the joined label, a model's value saves the same.
    const mixed = write(CREATE, null, { yes: true });
    mixed.args = {
      ...mixed.args,
      values: rec({ a: leaf("x", ext, true), b: leaf("y", model, true) }, ext, true),
    };
    expect(ruled(mixed)).toBe("allow P28");
  });

  it("AU-204 · a write an «Agente» chose, with its connection's «Sí» and nothing from outside in its unit, is allowed", () => {
    for (const t of WRITES) {
      expect(ruled(agent(t, model, { yes: true })), t.name).toBe("allow P28");
      expect(ruled(agent(t, user, { yes: true, control: model })), t.name).toBe("allow P28");
    }
  });

  it("AU-204 · with something from outside in its unit, an «Agente»'s create, its modify and its trash with the «Sí» are allowed as without it (decisions 11 and 16)", () => {
    for (const t of WRITES) {
      expect(ruled(agent(t, ext, { yes: true, control: ext })), t.name).toBe("allow P28");
      expect(ruled(agent(t, user, { yes: true, control: ext })), t.name).toBe(
        ruled(agent(t, user, { yes: true })),
      );
    }
    // Saved inside its connection only: the same write outside the action's filter is P29's no, outside or not.
    const narrowed = {
      ...OPEN,
      update: { limit: 20, where: [{ field: "estado", op: "is" as const, value: "cerrada" }] },
    };
    expect(
      ruled(agent(UPDATE, ext, { yes: true, reach: reach(UPDATE, { cells: narrowed }) })),
    ).toBe("deny P29 outside-rows");
  });

  it("AU-204 · without the «Sí» it is proposed (trash is confirmed), an ambient value is proposed, and the step type and the «Sí» never come from the call or a model", () => {
    for (const yes of [undefined, false]) {
      for (const t of [CREATE, UPDATE]) {
        expect(ruled(agent(t, model, { yes })), t.name).toBe("propose P28");
        expect(ruled(agent(t, ext, { yes, control: ext })), t.name).toBe("propose P28");
      }
      expect(ruled(agent(TRASH, null, { yes, control: model }))).toBe("confirm P5");
    }
    for (const t of WRITES) {
      expect(ruled(agent(t, ambient, { yes: true, control: ambient })), t.name).toBe("propose P28");
      expect(ruled(write(t, ambient, { yes: true, control: ambient })), t.name).toBe("propose P28");
    }
    // The «Sí», the step's type and its connection are fields of the call the server fills from the stored version;
    // named as arguments (what a model or a request could write), they are no tool's and the call is refused.
    for (const name of ["yes", "byAgent", "reach", "si"]) {
      const c = write(CREATE, user);
      c.args = { ...c.args, [name]: leaf("true", model) };
      expect(ruled(c), name).toBe("deny P0");
    }
    // An «Agente»'s call with no connection read by the server is refused, not decided as a «Código»'s.
    for (const t of [...WRITES, QUERY])
      expect(ruled(write(t, user, { yes: true, byAgent: true })), t.name).toBe("deny P29 no-reach");
  });

  it("AU-205 · a call from an AI step to a collection it has not connected, to an action set to «No», outside its rows or its fields, or over its row limit is denied (P29)", () => {
    const only = (cells: Partial<Record<ReachAction, false | ReachLimits>>) => ({
      ...OPEN,
      ...cells,
    });
    const abierta = [{ field: "estado", op: "is" as const, value: "abierta" }];
    const cerrada = [{ field: "estado", op: "is" as const, value: "cerrada" }];
    const cases: [string, Call][] = [
      ["not-connected", agent(UPDATE, user, { yes: true, reach: reach(UPDATE, { cells: null }) })],
      ["not-connected", query({ byAgent: true, reach: reach(QUERY, { cells: null }) })],
      [
        "action-off",
        agent(TRASH, null, { yes: true, reach: reach(TRASH, { cells: only({ remove: false }) }) }),
      ],
      [
        "action-off",
        query({ byAgent: true, reach: reach(QUERY, { cells: only({ read: false }) }) }),
      ],
      // A row the action's filter leaves out, the reading's filter leaves out, or that is not there: all the same.
      [
        "outside-rows",
        agent(UPDATE, user, {
          yes: true,
          reach: reach(UPDATE, { cells: only({ update: { where: cerrada } }) }),
        }),
      ],
      [
        "outside-rows",
        agent(TRASH, null, {
          yes: true,
          reach: reach(TRASH, { cells: only({ read: { where: cerrada } }) }),
        }),
      ],
      ["outside-rows", agent(TRASH, null, { yes: true, reach: reach(TRASH, { row: null }) })],
      [
        "outside-rows",
        agent(CREATE, user, {
          yes: true,
          reach: reach(CREATE, { cells: only({ read: { where: cerrada } }) }),
        }),
      ],
      // A field the action does not write, or that its reading does not see.
      [
        "outside-fields",
        agent(UPDATE, user, {
          yes: true,
          reach: reach(UPDATE, { cells: only({ update: { fields: ["nota"] } }) }),
        }),
      ],
      [
        "outside-fields",
        agent(CREATE, user, {
          yes: true,
          reach: reach(CREATE, { cells: only({ read: { fields: ["titulo"] } }) }),
        }),
      ],
      [
        "outside-fields",
        query({
          byAgent: true,
          reach: reach(QUERY, {
            cells: only({ read: { fields: ["titulo"] } }),
            fields: ["importe"],
          }),
        }),
      ],
      // «Como mucho 20»: the 21st row, or a call of 5 rows after 18.
      ["over-limit", agent(UPDATE, user, { yes: true, reach: reach(UPDATE, { written: 20 }) })],
      [
        "over-limit",
        agent(TRASH, null, { yes: true, rows: 5, reach: reach(TRASH, { written: 18 }) }),
      ],
      // The act the server read must be the tool's: a write cannot pass as a read, nor a trash as a modify.
      ["not-the-action", agent(UPDATE, user, { yes: true, reach: reach(QUERY) })],
      ["not-the-action", agent(TRASH, null, { yes: true, reach: reach(UPDATE) })],
      ["not-the-action", agent(UPDATE, user, { yes: true, reach: reach(TRASH) })],
    ];
    const seen = new Set<string>();
    for (const [reason, c] of cases) {
      const d = decide(c, AUTOMATION, fresh());
      expect(d, reason).toMatchObject({ kind: "deny", rule: "P29", reason });
      expect(outsideReach(d), reason).toBe(true);
      seen.add(reason);
      // The «Sí» does not open it, and no other origin's answer is wider with it.
      for (const origin of OTHERS) expect(decide(c, origin, fresh()).kind, reason).toBe("deny");
    }
    // Every reason has its row here (no-reach and private-collection have theirs in AU-204 and AU-45).
    for (const r of P29_REASONS)
      if (r !== "no-reach" && r !== "private-collection") expect(seen.has(r), r).toBe(true);
    // Inside them it goes on to the other rules: the same rows inside the filters and under the limit are allowed.
    const fine: Call[] = [
      agent(UPDATE, user, {
        yes: true,
        reach: reach(UPDATE, {
          cells: only({ update: { where: abierta, fields: ["titulo", "nota"], limit: 20 } }),
          written: 19,
        }),
      }),
      agent(CREATE, user, {
        yes: true,
        reach: reach(CREATE, { cells: only({ create: { fields: ["titulo"], fixed: ["nota"] } }) }),
      }),
      agent(TRASH, null, { yes: true, rows: 2, reach: reach(TRASH, { written: 18 }) }),
    ];
    for (const c of fine) expect(ruled(c), c.tool?.name).toBe("allow P28");
    expect(
      ruled(query({ byAgent: true, reach: reach(QUERY, { fields: ["titulo", "estado"] }) })),
    ).toBe("allow P1");
    // A no of another rule is not P29's: the engine fails the unit for it without saying what (AU-174).
    const p2 = decide(
      {
        tool: SEND,
        args: pick(SEND, { to: leaf("ejemplo.ana@example.com", ext) }),
        control: null,
        yes: true,
        byAgent: true,
        reach: reach(QUERY),
      },
      AUTOMATION,
      fresh(),
    );
    expect(p2.kind).toBe("deny");
    expect(outsideReach(p2)).toBe(false);
  });

  it("AU-205 · a read by an AI step of a collection no model may read is denied, and a «Código» without AI is decided as before", () => {
    const hidden = query({ byAgent: true, reach: reach(QUERY, { private: true }) });
    const d = decide(hidden, AUTOMATION, fresh());
    expect(d).toMatchObject({ kind: "deny", rule: "P29", reason: "private-collection" });
    // Said, not told to the model as a narrower ask: the unit fails saying which collection (AU-166).
    expect(outsideReach(d)).toBe(false);
    for (const t of WRITES)
      expect(ruled(agent(t, user, { yes: true, reach: reach(t, { private: true }) })), t.name).toBe(
        "deny P29 private-collection",
      );
    // A «Código» without AI carries neither the type nor a connection: P29 does not run and F14d's rows stand.
    expect(ruled(write(CREATE, user, { yes: true }))).toBe("allow P28");
    expect(ruled(write(UPDATE, ext, { yes: true }))).toBe("allow P28");
    expect(ruled(write(TRASH, null))).toBe("confirm P5");
    expect(ruled(write(UPDATE, user))).toBe("propose P28");
    expect(ruled(query())).toBe("allow P1");
  });

  it("AU-205 · P29 over 3,000 rows shaped like his, each decided alone, under 250 ms (measured 23 to 30 ms, A-15)", () => {
    const cells = {
      ...OPEN,
      read: { where: [{ field: "estado", op: "is" as const, value: "abierta" }] },
      update: {
        where: [{ field: "importe", op: "gt" as const, value: 0 }],
        fields: ["titulo", "nota"],
        limit: 5000,
      },
    };
    const t = clock();
    let allowed = 0;
    for (let i = 0; i < 3000; i++) {
      const row = { ...ROW, titulo: `Ejemplo ${i}`, estado: i % 3 ? "abierta" : "cerrada" };
      const c = agent(UPDATE, user, {
        yes: true,
        reach: reach(UPDATE, { cells, row, written: i }),
      });
      if (decide(c, AUTOMATION, fresh()).kind === "allow") allowed++;
    }
    expect(allowed).toBe(2000);
    under(clock() - t, 250, "clock", "P29 over 3,000 rows");
  });
});
