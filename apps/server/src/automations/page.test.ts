// «Esta página» of a page's chat on the real server (docs/automatizaciones.md AU-137, phase F16 S2c part B2): what
// the policy answers each page call of an «Agente» under the origin `automation` (P26 with the stored page, the
// narrower reading of a value, `PAGE_ALONE`), and a message's run over a real store: its figures read from the page,
// its changes kept in the run's one proposal, accepted from a personal device with exactly what was proposed, and
// undone with the run. The chat itself stays on the old engine (`convert.ts` `leftOut`) until the switch.
//
// The real server's pieces, as ai.test.ts wires them: an account with «Modelos» and a scripted provider (no model is
// ever called), a store seeded with collections shaped like his, an invented page, and the real policy.
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { decide, fakePlanner, type ModelProvider, readStore } from "@boni/agent";
import {
  type Automation,
  BONI_TRIGGERS,
  CHAT_ROW,
  type Labelled,
  PAGE_ACTIONS,
  PAGE_TOOLS,
  type PageAbility,
  type PolicyCall,
} from "@boni/automations";
import { label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTIONS } from "../actions.ts";
import { AgentHost, serveAgent } from "../agent.ts";
import { addUser } from "../auth.ts";
import { openDb } from "../db.ts";
import { AccountModels } from "../models.ts";
import { blockFrom, withBlock } from "../pageActions.ts";
import { createPage, getPage, type Page, updatePage } from "../pages.ts";
import { wireAutomationModels } from "./ai.ts";
import { wireBoni } from "./boni.ts";
import {
  AUTOMATION,
  automationPolicy,
  PAGE_ACTS,
  PAGE_ALONE,
  type PageScope,
  pageRequest,
} from "./policy.ts";
import type { RunProposalView } from "./proposal.ts";
import {
  docOf,
  folder,
  JUAN,
  made,
  NOW,
  notes,
  OUTSIDE,
  ok,
  PEDIDO,
  type StepSpec,
  seeded,
} from "./run.test-util.ts";
import { runView, settled, startRun, undoAutomationRun } from "./runs.ts";
import { automationLabel } from "./service.ts";

const files = folder("pagina");
const closing: (() => void)[] = [];
afterAll(() => {
  for (const c of closing) c();
  files.done();
});

const PAGE = "p_ejemplo";
/** «Mensaje de chat» of `page`, and an «Agente» with «Esta página» giving these abilities. */
const CHAT = (page = PAGE): StepSpec => [
  "Mensaje",
  BONI_TRIGGERS.chat,
  { page, welcome: "Hola", buttons: [] },
];
const AGENTE = (abilities: readonly PageAbility[]): StepSpec => [
  "Agente",
  "agent",
  { instructions: "Contesta sobre la página", page: [...abilities] },
];

// ---------------------------------------------------------------- the policy

/** A version of an automation with a chat on `PAGE` and an «Agente» giving `abilities`, as the server keeps it. */
function kept(abilities: readonly PageAbility[] = ["figures", "value", "block"], page = PAGE) {
  const ids = new Map<string, string>();
  const doc: Automation = {
    ...docOf([CHAT(page), AGENTE(abilities)], ids),
    id: "a_ejemplo",
    version: 1,
  };
  return { doc, step: ids.get("Agente") as string };
}

/** The page's scope as the server reads it from the store: it shows orders, and a key names its collection. */
const SCOPE: PageScope = {
  page: PAGE,
  types: [PEDIDO],
  typeIdOf: (key) => (key === "pedido" ? PEDIDO : key === "cliente" ? "t_cliente" : null),
};

const own = automationLabel("a_ejemplo");
const TYPED = label("user", "personal", [{ kind: "user-edit", id: `chat:${PAGE}` }]);
const MODEL = label("model", "personal", [{ kind: "model", id: "planner" }]);

/** A page call of the engine for `ability`, with these values (each the model's, derived), on `page`. */
function pageCall(
  step: string,
  ability: PageAbility,
  values: Record<string, unknown>,
  o: { page?: string; version?: number; labelled?: Label } = {},
): PolicyCall {
  const l = o.labelled ?? MODEL;
  return {
    automation: { id: "a_ejemplo", version: o.version ?? 1 },
    step,
    type: "agent",
    action: PAGE_ACTIONS[ability],
    effect: ability === "figures" ? "read" : "write",
    destroys: false,
    collection: "",
    values: Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, { value: v, label: l, derived: true }]),
    ) as Labelled,
    control: null,
    test: false,
    page: o.page ?? PAGE,
  };
}
type Label = ReturnType<typeof label>;

describe("«Esta página» under the policy (F16 S2c B2, AU-137)", () => {
  it("AU-137 · each page call is told to `decide` as the list's page action it mirrors: the same effect, area, undo and argument roles", () => {
    for (const [ability, tool] of Object.entries(PAGE_ACTS)) {
      const listed = ACTIONS.get(tool.name);
      if (!listed) throw new Error(`no action ${tool.name}`);
      expect(tool.effect, ability).toBe(listed.effect);
      expect(tool.area, ability).toBe(listed.area);
      expect(tool.undo ?? [], ability).toEqual(listed.undo ?? []);
      expect(tool.alwaysConfirm ?? false, ability).toBe(listed.alwaysConfirm ?? false);
      expect(Object.keys(tool.args).sort(), ability).toEqual(Object.keys(listed.args).sort());
      for (const [arg, spec] of Object.entries(tool.args))
        expect(listed.args[arg]?.role, `${ability}.${arg}`).toBe(spec.role);
    }
    // The engine's tools take no page: it is the server's argument, from the port bound to the stored page.
    for (const t of Object.values(PAGE_TOOLS))
      expect(t.inputs.map((i) => i.name)).not.toContain("page");
  });

  it("AU-137 · before → after, by a table written in the test: a figure is read, a value and a block are proposed (the narrower reading), and any other page, an ability the stored step does not give, a collection the page does not show, another version or no chat are refused (P26)", () => {
    const { doc, step } = kept();
    const only = kept(["figures"]);
    const noChat: Automation = {
      ...doc,
      steps: doc.steps.filter((s) => s.type !== BONI_TRIGGERS.chat),
    };
    const MONTH = { control: "Mes", value: "2026-10" };
    const TEXT = { block: { type: "text", text: "Nota de ejemplo" } };
    const rows: [string, Automation | undefined, PageScope | undefined, PolicyCall, string][] = [
      [
        "a figure of its page",
        doc,
        SCOPE,
        pageCall(step, "figures", { block: "b_total" }),
        "allow P1",
      ],
      ["a value of its page", doc, SCOPE, pageCall(step, "value", MONTH), "propose P28"],
      [
        "a value typed by Juan",
        doc,
        SCOPE,
        pageCall(step, "value", MONTH, { labelled: TYPED }),
        "propose P28",
      ],
      [
        "a value from outside",
        doc,
        SCOPE,
        pageCall(step, "value", MONTH, { labelled: OUTSIDE }),
        "propose P28",
      ],
      ["a text block", doc, SCOPE, pageCall(step, "block", TEXT), "propose P28"],
      [
        "a block over a collection it shows",
        doc,
        SCOPE,
        pageCall(step, "block", {
          block: { type: "number", collection: "pedido", measure: "count" },
        }),
        "propose P28",
      ],
      [
        "a block over a collection it does not show",
        doc,
        SCOPE,
        pageCall(step, "block", {
          block: { type: "number", collection: "cliente", measure: "count" },
        }),
        "deny P26 not-the-pages-collection",
      ],
      [
        "a block over a collection no model sees",
        doc,
        SCOPE,
        pageCall(step, "block", {
          block: { type: "number", collection: "diario", measure: "count" },
        }),
        "deny P26 not-the-pages-collection",
      ],
      [
        "a value of another page",
        doc,
        SCOPE,
        pageCall(step, "value", MONTH, { page: "p_otra" }),
        "deny P26 not-the-chats-page",
      ],
      [
        "a figure of another page",
        doc,
        SCOPE,
        pageCall(step, "figures", { block: "b_total" }, { page: "p_otra" }),
        "deny P26 not-the-chats-page",
      ],
      [
        "an ability the stored step does not give",
        only.doc,
        SCOPE,
        pageCall(only.step, "value", MONTH),
        "deny P26 not-the-chats-action",
      ],
      [
        "a call of another version",
        doc,
        SCOPE,
        pageCall(step, "value", MONTH, { version: 2 }),
        "deny P26 not-the-chats-page",
      ],
      [
        "a version with no chat",
        noChat,
        SCOPE,
        pageCall(step, "value", MONTH),
        "deny P26 not-the-chats-page",
      ],
      [
        "a scope the server read of another page",
        doc,
        { ...SCOPE, page: "p_otra" },
        pageCall(step, "value", MONTH, { page: "p_otra" }),
        "deny P26 not-the-chats-page",
      ],
      [
        "no page read by the server",
        doc,
        undefined,
        pageCall(step, "value", MONTH),
        "deny P26 not-the-chats-page",
      ],
    ];
    const said = (d: ReturnType<ReturnType<typeof automationPolicy>["decide"]>) =>
      d.kind === "deny" ? `deny ${d.rule} ${d.reason}` : `${d.kind} ${d.rule}`;
    expect(
      rows.map(([what, d, scope, call]) => [
        what,
        said(automationPolicy(d, own, undefined, scope).decide(call)),
      ]),
    ).toEqual(rows.map(([what, , , , want]) => [what, want]));
    // A test judges the same, and an allowed change counts against the run's writes; a read and a proposal do not.
    const p = automationPolicy(doc, own, undefined, SCOPE);
    expect(said(p.decide({ ...pageCall(step, "value", MONTH), test: true }))).toBe("propose P28");
    p.decide(pageCall(step, "figures", { block: "b_total" }));
    expect(p.count.writes).toBe(0);
  });

  it("AU-137 · PAGE_ALONE is the one place of Juan's «yes» to a value made alone: today none, so a value is proposed; with «value» there it is allowed (P28) and a block is still proposed", () => {
    // The narrower reading (2026-11-19): AU-137's «sin preguntar» is Juan's to decide.
    expect(PAGE_ALONE).toEqual([]);
    const { doc, step } = kept();
    const value = pageCall(step, "value", { control: "Mes", value: "2026-10" });
    const block = pageCall(step, "block", { block: { type: "text", text: "Nota" } });
    const judged = (call: PolicyCall, alone: readonly PageAbility[]) => {
      const r = pageRequest(doc, SCOPE, call, own, alone);
      if (!r) throw new Error("no request");
      return decide({ ...r, control: null, flow: true }, AUTOMATION, {
        writes: 0,
        sensitiveReads: 0,
      });
    };
    // What the server's policy answers flips with the constant, and with nothing else.
    expect(automationPolicy(doc, own, undefined, SCOPE).decide(value)).toEqual(
      PAGE_ALONE.includes("value")
        ? { kind: "allow", rule: "P28" }
        : { kind: "propose", rule: "P28" },
    );
    expect(judged(value, [])).toEqual({ kind: "propose", rule: "P28" });
    expect(judged(value, ["value"])).toEqual({ kind: "allow", rule: "P28" });
    expect(judged(block, ["value"])).toEqual({ kind: "propose", rule: "P28" });
    // Still within the chat's page: another page is refused whatever the constant says.
    expect(judged({ ...value, page: "p_otra" }, ["value"])).toMatchObject({
      kind: "deny",
      rule: "P26",
    });
  });
});

// ---------------------------------------------------------------- a message's run on the real store

/** A server with one account whose «Agente» answers with `plan` (ai.test.ts `server`, trimmed). */
function server() {
  const home = mkdtempSync(join(files.dir, "host-"));
  const sys = openDb(join(home, "system.db"));
  addUser(sys, "juan", "una contraseña larga de ejemplo");
  const fake = fakePlanner([]);
  const host = new AgentHost({
    dataDir: home,
    providers: { planner: fake, reader: fake },
    now: () => NOW,
  });
  const answers: { plan?: (n: number) => unknown; seen: string[] } = { seen: [] };
  let n = 0;
  const models = new AccountModels({
    db: sys,
    key: randomBytes(32),
    host,
    defaults: {
      planner: { connection: "anthropic", model: "claude-opus-5-5" },
      reader: { connection: "anthropic", model: "claude-haiku-4-5" },
    },
    serverKeys: { anthropic: "clave-del-servidor-inventada-0001" },
    now: () => NOW,
    makeProvider: (v): ModelProvider => ({
      id: v.connection,
      privacy: "external-api",
      async complete(req) {
        if (req.role !== "planner" || !answers.plan) throw new Error(`no answer for a ${req.role}`);
        n++;
        answers.seen.push(JSON.stringify(req));
        return {
          json: answers.plan(n),
          usage: { input: 100, output: 10, cost: 0.001 },
          model: v.model,
        };
      },
    }),
  });
  host.models = models;
  host.providersFor = (a) => models.providers(a);
  host.overBudget = (a, asking) => models.overBudget(a, asking);
  wireAutomationModels({ models, accountOf: (st) => host.accountOf(st) });
  const s = host.store(1);
  seeded(s);
  closing.push(() => {
    host.close();
    sys.close();
  });
  return { host, s, answers };
}

/** One call of the agent's routes on account 1, from Juan's device with this trust (ai.test.ts `serve`). */
async function serve(
  host: AgentHost,
  route: string,
  o: { id?: string; trust?: "personal" | "shared" } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const got = { status: 0, body: "" };
  const res = {
    writeHead: (st: number) => {
      got.status = st;
      return res;
    },
    end: (b?: string) => {
      got.body = b ?? "";
      return res;
    },
    setHeader: () => res,
  } as unknown as ServerResponse;
  const req = Object.assign(Readable.from([Buffer.from("{}")]), {
    url: "/",
  }) as unknown as IncomingMessage;
  await serveAgent(host, req, res, route, o.id ? { id: o.id } : {}, {
    account: 1,
    device: JUAN.device,
    trust: o.trust ?? "personal",
  });
  return { status: got.status, json: JSON.parse(got.body || "null") as Record<string, unknown> };
}

/** An invented page: a «Mes» control and the count of the orders. */
function page(s: UserStore): { page: Page; total: string } {
  const p = createPage(s, { title: "Resumen de ejemplo" });
  const ro = readStore(s);
  const control = blockFrom(ro, { type: "control", name: "Mes", kind: "month" });
  const withControl = updatePage(s, p.id, { spec: withBlock(p, control) });
  const total = blockFrom(ro, {
    type: "number",
    collection: "pedido",
    measure: "count",
    period: "all",
    title: "Pedidos",
  });
  return { page: updatePage(s, p.id, { spec: withBlock(withControl, total) }), total: total.id };
}

const call = (id: string, tool: string, args: Record<string, unknown>) => ({
  id,
  op: "call",
  tool,
  args,
});
const lit = (v: unknown) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const obj = (...kv: unknown[]) => ({ fn: "obj", args: kv });
const plan = (...steps: unknown[]) => ({ version: 1, steps });

describe("a message's «Agente» on its page, on the real server (F16 S2c B2, AU-137)", () => {
  beforeEach(() =>
    wireBoni({
      reaches: () => true,
      agentOf: () => {
        throw new Error("no agent is asked here");
      },
    }),
  );
  afterEach(() => {
    wireBoni(null);
    wireAutomationModels(null);
  });

  it("AU-137 · a message's run reads the page's figures and asks for its value and its block in the run's one proposal, origin automation and that run; a shared device cannot accept it; a personal one saves exactly what was proposed, with the labels it carried; undoing the run takes it back", async () => {
    const t = server();
    const { page: p, total } = page(t.s);
    const before = notes(t.s);
    const a = made(t.s, [CHAT(p.id), AGENTE(["figures", "value", "block"])]);
    ok(a.publish());
    t.answers.plan = (n) =>
      n === 1
        ? plan(
            call("s1", PAGE_TOOLS.figures.name, { block: lit(total) }),
            call("s2", PAGE_TOOLS.value.name, {
              control: lit("Mes"),
              value: ref(`$rows[0].${CHAT_ROW.message}`),
            }),
            call("s3", PAGE_TOOLS.block.name, {
              block: obj(lit("type"), lit("text"), lit("text"), lit("Nota de ejemplo")),
            }),
          )
        : plan(call("s1", "answer", { texto: lit("Hecho") }));
    const { run } = ok(
      await startRun(
        t.s,
        a.id,
        {
          trigger: a.step("Mensaje"),
          fields: { [CHAT_ROW.message]: "2026-10", [CHAT_ROW.page]: p.id, [CHAT_ROW.values]: {} },
        },
        JUAN,
      ),
    );
    await settled(t.s);
    const r = ok(runView(t.s, a.id, run.id)).run;
    expect(r.state, JSON.stringify(r)).toBe("done");
    // The figure the model read is the page's, computed by code: the count of the seeded orders.
    const orders = t.s.list(PEDIDO).length;
    expect(orders).toBeGreaterThan(0);
    const round = (
      JSON.parse(t.answers.seen[1] as string) as { input: { rounds: Record<string, unknown>[] } }
    ).input.rounds[0];
    expect(round?.s1).toMatchObject({ page: p.id, block: total, title: "Pedidos", count: orders });
    // Nothing saved yet: the page is as it was, no row was written, and the run's log holds nothing.
    expect(getPage(t.s, p.id)?.spec).toEqual(p.spec);
    expect(notes(t.s)).toEqual(before);
    expect(t.s.runOps(run.id)).toEqual([]);
    // One proposal, origin automation, naming this run, with both changes of this page.
    const proposal = r.proposal as string;
    const kept = t.s.journal.proposal(proposal);
    expect(kept?.status).toBe("pending");
    const view = kept?.view as RunProposalView;
    expect(view.run).toMatchObject({ automation: a.id, run: run.id, count: 2 });
    expect(view.run.first.map((x) => [x.step, x.byAgent, x.action, x.collection, x.page])).toEqual([
      [
        a.step("Agente"),
        true,
        "update",
        "",
        { id: p.id, title: "Resumen de ejemplo", change: "value", control: "Mes" },
      ],
      [
        a.step("Agente"),
        true,
        "update",
        "",
        { id: p.id, title: "Resumen de ejemplo", change: "block" },
      ],
    ]);
    expect(view.run.first[0]?.values.value).toMatchObject({ value: "2026-10", outside: false });
    // Accepting is Juan's, on a personal device (A-45): from a shared one nothing is saved.
    expect(
      (
        await serve(t.host, "POST /api/agent/proposals/:id/accept", {
          id: proposal,
          trust: "shared",
        })
      ).json.error,
    ).toBe("accept-on-a-personal-device");
    expect(getPage(t.s, p.id)?.spec).toEqual(p.spec);
    expect(
      (await serve(t.host, "POST /api/agent/proposals/:id/accept", { id: proposal })).status,
    ).toBe(200);
    expect(t.s.journal.proposal(proposal)?.status).toBe("accepted");
    // Exactly what was proposed: the control holds the month, one text block at the end, nothing else; no row.
    const after = getPage(t.s, p.id) as Page;
    expect(after.spec.blocks.slice(0, 2).map((b) => ({ ...b, value: undefined }))).toEqual(
      p.spec.blocks.map((b) => ({ ...b, value: undefined })),
    );
    expect(after.spec.blocks[0]).toMatchObject({ name: "Mes", value: "2026-10" });
    expect(after.spec.blocks.slice(2)).toEqual([
      expect.objectContaining({ type: "text", text: "Nota de ejemplo" }),
    ]);
    expect(after.spec.blocks).toHaveLength(3);
    expect(notes(t.s)).toEqual(before);
    // Saved with the run's id, so the run's Undo takes them back; with the labels the changes carried.
    const ops = t.s.runOps(run.id);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.target === p.id)).toBe(true);
    expect(JSON.stringify(t.s.get(p.id)?.labels)).toContain('"model"');
    ok(undoAutomationRun(t.s, a.id, run.id, JUAN));
    expect(getPage(t.s, p.id)?.spec).toEqual(p.spec);
  });

  it("AU-137 · a block over a collection the page does not show fails the step and asks nothing (P26); a test run saves and proposes nothing", async () => {
    const t = server();
    const { page: p } = page(t.s);
    const a = made(t.s, [CHAT(p.id), AGENTE(["block"])]);
    ok(a.publish());
    t.answers.plan = (n) =>
      n === 1
        ? plan(
            call("s1", PAGE_TOOLS.block.name, {
              block: obj(
                lit("type"),
                lit("number"),
                lit("collection"),
                lit("cliente"),
                lit("measure"),
                lit("count"),
              ),
            }),
          )
        : plan(call("s1", "answer", { texto: lit("Hecho") }));
    const { run } = ok(
      await startRun(
        t.s,
        a.id,
        {
          trigger: a.step("Mensaje"),
          fields: {
            [CHAT_ROW.message]: "cuántos clientes",
            [CHAT_ROW.page]: p.id,
            [CHAT_ROW.values]: {},
          },
        },
        JUAN,
      ),
    );
    await settled(t.s);
    const r = ok(runView(t.s, a.id, run.id)).run;
    expect(r.state).toBe("failed");
    expect(r.proposal).toBeNull();
    expect(getPage(t.s, p.id)?.spec).toEqual(p.spec);
  });
});
