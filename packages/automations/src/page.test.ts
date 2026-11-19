// «Esta página» of a page's chat, in the engine (docs/automatizaciones.md AU-137, phase F16): what the «Agente» of a
// chat may do on its own page (its figures, a value of a control, a block), offered as its code tools are, each call
// through the policy with the port's page, never a model's or a message's. The server's half (the port over the
// store, P26 for another page, the narrower reading, accepting and undoing) is apps/server's automations/chat.test.ts.
//
// The model is scripted (`agent.test-util.ts`: the real rounds of packages/agent, no model called, A-02).
import { label, labeled } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { answer, call, lit, obj, plan, ref, scripted } from "./agent.test-util.ts";
import { AGENT_TOOLS, AgentTools, codeToolsOf } from "./agent.ts";
import { sketch } from "./automation.test-util.ts";
import { BONI_TRIGGERS } from "./boni.ts";
import { CHAT_ROW, chatStart } from "./chat.ts";
import type { Decision, PolicyCall } from "./effects.ts";
import { run } from "./engine.ts";
import type { Automation } from "./format.ts";
import { PAGE_TOOLS, type PageChange, type PagePort } from "./page.ts";
import { deps, OUTSIDE, policy } from "./run.test-util.ts";
import { validate } from "./validate.ts";

const PAGE = "p_ejemplo_01";
const TYPED = label("user", "personal", [{ kind: "user-edit", id: `chat:${PAGE}` }]);
const BONI = { run: async () => ({ rows: [] }) as never };

/** «Mensaje de chat» (and «Inicio» by hand) → «Agente» with «Esta página» (its «Responder» is the server's test's). */
function chat(
  abilities: unknown = ["figures", "value", "block"],
  trigger: string = BONI_TRIGGERS.chat,
) {
  const s = sketch(631)
    .step(
      "Mensaje",
      trigger,
      trigger === BONI_TRIGGERS.chat ? { page: PAGE, welcome: "", buttons: [] } : {},
    )
    .step("Inicio", "manual")
    .step(
      "Agente",
      "agent",
      abilities === undefined
        ? { instructions: "Contesta sobre la página" }
        : { instructions: "Contesta sobre la página", page: abilities as never },
    )
    .arrow("Mensaje", "Agente")
    .arrow("Inicio", "Agente");
  return { automation: s.build(), id: s.id };
}

/** A page port that keeps what it was asked; its figures are one number of the code's. */
function port(page = PAGE) {
  const applied: { change: PageChange; label: unknown }[] = [];
  const figures: string[] = [];
  const p: PagePort = {
    page,
    async figures(block) {
      figures.push(block);
      return block === "b_total" ? { value: { total: 42, count: 3 }, label: OWN_CODE } : null;
    },
    async check(change) {
      return change.kind === "value" && change.control === "Nada" ? "no-such-block" : null;
    },
    async apply(change, l) {
      if (change.kind === "value" && change.control === "Nada") return "no-such-block";
      applied.push({ change, label: l });
      return null;
    },
  };
  return { port: p, applied, figures };
}
const OWN_CODE = label("own", "personal", []);

/** What the policy answers: reads allowed; a page's change asked (the narrower reading), unless `alone`. */
const judge =
  (alone = false) =>
  (c: PolicyCall): Decision =>
    c.effect === "read" || alone
      ? { kind: "allow", rule: "test.allow" }
      : { kind: "propose", rule: "P28" };

/** The message «¿cuánto llevo?», typed, or `text` with that label, through `chatStart`. */
const message = (a: Automation, text = labeled("¿cuánto llevo?", TYPED), page = PAGE) =>
  chatStart(a, { text, page, values: { Mes: labeled("2026-10", OUTSIDE) } });

describe("«Esta página» of a page's chat (AU-137)", () => {
  it("AU-137 · «Esta página» exists only under «Mensaje de chat»: elsewhere `agent.page.notChat`; its tools' names are no code tool's", () => {
    const under = chat();
    const problems = (a: Automation) =>
      (validate(a, { ai: true, boni: {} } as never) as { code: string; step?: string }[]).filter(
        (p) => p.code === "agent.page.notChat",
      );
    expect(problems(under.automation)).toEqual([]);
    const outside = chat(["value"], "manual");
    outside.automation.steps = outside.automation.steps.filter(
      (s) => s.type !== "manual" || s.name === "Inicio",
    );
    expect(problems(outside.automation)).toEqual([
      expect.objectContaining({ code: "agent.page.notChat", step: outside.id("Agente") }),
    ]);
    // An empty list is none.
    expect(problems(chat([], "manual").automation)).toEqual([]);
    for (const t of Object.values(PAGE_TOOLS)) {
      expect(AGENT_TOOLS.taken).toContain(t.name);
      expect(codeToolsOf([{ name: t.name, inputs: [], code: "return 1" }])).toBeNull();
    }
  });

  it("AU-137 · a message's «Agente» is offered its page's tools, reads its figures, and each change it asks waits for Juan with the port's page and the labels it carries", async () => {
    const { automation, id } = chat();
    const p = port();
    const pol = policy(judge());
    const ai = scripted((_, n) =>
      n === 1
        ? plan(
            call("s1", PAGE_TOOLS.figures.name, { block: lit("b_total") }),
            call("s2", PAGE_TOOLS.value.name, {
              control: lit("Mes"),
              value: lit("2026-10"),
            }),
            call("s3", PAGE_TOOLS.block.name, {
              block: obj(lit("type"), lit("text"), lit("text"), lit("Nota")),
            }),
            // A control the page does not have: told to the model, never asked of Juan.
            call("s4", PAGE_TOOLS.value.name, { control: lit("Nada"), value: lit("x") }),
          )
        : plan(answer("s1", lit("Llevas 42"))),
    );
    const start = message(automation);
    if (!start) throw new Error("no start");
    const e = await run(start, deps({ policy: pol, ai: ai.port, boni: BONI, page: p.port }));
    expect(e.state).toBe("done");
    expect(ai.asked[0]?.codeTools).toEqual([
      PAGE_TOOLS.figures,
      PAGE_TOOLS.value,
      PAGE_TOOLS.block,
    ]);
    expect(ai.asked[0]?.tools).toEqual(
      expect.arrayContaining(["pageFigures", "pageSetValue", "pageAddBlock"]),
    );
    expect(ai.asked[1]?.rounds[0]).toMatchObject({
      s1: { total: 42, count: 3 },
      s2: { planned: expect.stringContaining("ask Juan") },
      s3: { planned: expect.stringContaining("ask Juan") },
      s4: { refused: "no-such-block" },
    });
    // Nothing saved: both changes wait in the run's proposal, with the port's page.
    expect(p.applied).toEqual([]);
    expect(p.figures).toEqual(["b_total"]);
    expect(e.asked).toEqual([]);
    expect(e.pageAsked).toEqual([
      expect.objectContaining({
        step: id("Agente"),
        kind: "propose",
        rule: "P28",
        page: PAGE,
        edit: { kind: "value", control: "Mes", value: "2026-10" },
      }),
      expect.objectContaining({
        page: PAGE,
        edit: { kind: "block", block: { type: "text", text: "Nota" } },
      }),
    ]);
    expect(e.steps[id("Agente")]?.asked).toBe(2);
    // The policy judged each with the port's page, its action and its effect.
    const pageCalls = pol.calls.filter((c) => c.page !== undefined);
    expect(pageCalls.map((c) => [c.action, c.effect, c.page, c.collection])).toEqual([
      ["page.figures", "read", PAGE, ""],
      ["page.value", "write", PAGE, ""],
      ["page.block", "write", PAGE, ""],
      ["page.value", "write", PAGE, ""],
    ]);
    // What the policy read is what the proposal keeps, label and all: here the model's literals, written by it and
    // not from outside (a value from outside is the next test's).
    expect(e.pageAsked?.[0]?.values).toEqual(pageCalls[1]?.values);
    expect(pageCalls[1]?.values.value?.label.integrity).not.toBe("external");
    expect(pageCalls[1]?.values.value?.derived).toBe(true);
  });

  it("AU-137 · the message's label reaches what the policy reads: typed it is the person's own; pasted from outside it is from outside", async () => {
    for (const [text, outside] of [
      [labeled("pon el mes 2026-09", TYPED), false],
      [labeled("pon el mes 2026-09", OUTSIDE), true],
    ] as const) {
      const { automation } = chat(["value"]);
      const pol = policy(judge());
      const ai = scripted((_, n) =>
        n === 1
          ? plan(
              call("s1", PAGE_TOOLS.value.name, {
                control: lit("Mes"),
                value: ref(`$rows[0].${CHAT_ROW.message}`),
              }),
            )
          : plan(answer("s1", lit("Hecho"))),
      );
      const start = message(automation, text);
      if (!start) throw new Error("no start");
      // The row's own label is the message's.
      expect(start.fields.label).toBe(text.label);
      const e = await run(start, deps({ policy: pol, ai: ai.port, boni: BONI, page: port().port }));
      expect(e.state).toBe("done");
      const call0 = pol.calls.find((c) => c.action === "page.value");
      expect(call0?.values.value?.label.integrity === "external").toBe(outside);
      expect(e.pageAsked?.[0]?.values.value?.label.integrity === "external").toBe(outside);
    }
  });

  it("AU-137 · the page is never the model's nor the message's: a `page` argument is refused, a message of another page starts nothing, a port of another page or a run by hand fails the step", async () => {
    const { automation, id } = chat();
    const p = port();
    const pol = policy(judge(true));
    const ai = scripted((_, n) =>
      n === 1
        ? plan(
            call("s1", PAGE_TOOLS.value.name, {
              control: lit("Mes"),
              value: lit("2026-09"),
              page: lit("p_otra_pagina"),
            }),
          )
        : plan(answer("s1", lit("Hecho"))),
    );
    const start = message(automation);
    if (!start) throw new Error("no start");
    const e = await run(start, deps({ policy: pol, ai: ai.port, boni: BONI, page: p.port }));
    expect(e.state).toBe("done");
    // The rounds refuse the argument before any tool runs (the plan is asked again)…
    expect(ai.asked[1]?.rounds).toEqual([]);
    expect((ai.asked[1] as { again?: unknown }).again).toEqual({
      fault: "plan",
      errors: ["step 1.args: unknown-argument"],
    });
    // …and the engine's own tool refuses it too, without calling the page.
    const calls: unknown[] = [];
    const unit = { rounds: 0, lines: [], more: 0, seen: [] };
    const tools = new AgentTools({
      written: OWN_CODE,
      unit,
      tools: [],
      page: {
        tools: new Map([[PAGE_TOOLS.value.name, "value" as const]]),
        call: async (...args: unknown[]) => {
          calls.push(args);
          return { planned: "x" };
        },
      },
    } as never);
    const v = (json: unknown) => ({ json: json as never, label: OWN_CODE });
    expect(
      await tools.call(PAGE_TOOLS.value.name, {
        control: v("Mes"),
        value: v("2026-09"),
        page: v("p_otra_pagina"),
      }),
    ).toEqual({ refused: "bad-request" });
    expect(await tools.call(PAGE_TOOLS.value.name, { control: v(""), value: v(1) })).toEqual({
      refused: "bad-request",
    });
    expect(calls).toEqual([]);
    expect(await tools.call(PAGE_TOOLS.value.name, { control: v("Mes"), value: v(null) })).toEqual({
      planned: "x",
    });
    expect(calls).toEqual([["value", { control: "Mes", value: null }, expect.anything()]]);
    expect(p.applied).toEqual([]);
    expect(pol.calls.some((c) => c.page !== undefined)).toBe(false);

    // A message of another page's chat starts nothing here.
    expect(message(automation, undefined, "p_otra_pagina")).toBeNull();

    // A port bound to another page, a row that names another, or a run by hand: the step fails, nothing is asked.
    const fails = async (start: Parameters<typeof run>[0], page: PagePort) => {
      const ai2 = scripted(() => plan(answer("s1", lit("Hecho"))));
      const r = await run(
        start,
        deps({ policy: policy(judge(true)), ai: ai2.port, boni: BONI, page }),
      );
      expect(r.state).toBe("failed");
      expect(r.error?.step).toBe(id("Agente"));
      expect(ai2.asked).toEqual([]);
    };
    await fails(start, port("p_otra_pagina").port);
    await fails(
      {
        ...start,
        fields: {
          ...start.fields,
          json: { ...start.fields.json, [CHAT_ROW.page]: "p_otra_pagina" },
        },
      },
      p.port,
    );
    await fails(
      {
        ...start,
        trigger: automation.steps.find((s) => s.name === "Inicio")?.id as string,
        fields: { ...start.fields, json: {} },
      },
      p.port,
    );
  });

  it("AU-137 · when the policy allows a change (Juan's «yes» to a value alone, not given) it is saved through the port with its label, in a test nothing is; a no of the policy fails the step", async () => {
    const { automation, id } = chat(["value"]);
    const script = () =>
      scripted((_, n) =>
        n === 1
          ? plan(call("s1", PAGE_TOOLS.value.name, { control: lit("Mes"), value: lit("2026-09") }))
          : plan(answer("s1", lit("Hecho"))),
      );
    const start = message(automation);
    if (!start) throw new Error("no start");
    const p = port();
    const e = await run(
      start,
      deps({ policy: policy(judge(true)), ai: script().port, boni: BONI, page: p.port }),
    );
    expect(e.state).toBe("done");
    expect(e.pageAsked).toBeUndefined();
    expect(p.applied).toEqual([
      { change: { kind: "value", control: "Mes", value: "2026-09" }, label: expect.anything() },
    ]);

    const t = port();
    const tested = await run(
      { ...start, test: true },
      deps({ policy: policy(judge(true)), ai: script().port, boni: BONI, page: t.port }),
    );
    expect(tested.state).toBe("done");
    expect(t.applied).toEqual([]);

    const d = port();
    const denied = await run(
      start,
      deps({
        policy: policy((c) =>
          c.page
            ? { kind: "deny", rule: "P26", reason: "not-the-chats-page" }
            : { kind: "allow", rule: "test.allow" },
        ),
        ai: script().port,
        boni: BONI,
        page: d.port,
      }),
    );
    expect(denied.state).toBe("failed");
    expect(denied.error?.step).toBe(id("Agente"));
    expect(d.applied).toEqual([]);
  });
});
