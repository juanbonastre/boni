// The AI steps of an automation on the real server (docs/automatizaciones.md §5.5, §5.6, §5.10 and §6, phase F15):
// which model a step may use, what its writes save on the real store, its connection read from the stored version,
// a run that waits for an answer, and what is private (AU-42, AU-166, AU-199, AU-203, AU-204, AU-205).
//
// The real server's pieces: a system database with an account, its «Modelos» (`AccountModels`) wired to the runs as
// main.ts wires them, a store per test seeded with data shaped like the user's (`seed.test-util.ts`: generated ids,
// 3,000 rows where a step reads them) and the real policy. No model is ever called: «Modelos» makes a scripted
// provider (`makeProvider`) that answers each request from the test and keeps what it was sent. The rule's id is kept
// in each test's name (`make check` reads them, T-10).
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fakePlanner, type ModelProvider, type ModelRequest } from "@boni/agent";
import {
  type Automation,
  type Box,
  type Cell,
  newConnection,
  parseAutomation,
} from "@boni/automations";
import { label } from "@boni/entities";
import { clock, under } from "@boni/pace";
import type { UserStore } from "@boni/store";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { AgentHost } from "../agent.ts";
import { addUser } from "../auth.ts";
import { openDb } from "../db.ts";
import { AccountModels } from "../models.ts";
import { seed, typeId } from "../seed.test-util.ts";
import { wireAutomationModels } from "./ai.ts";
import { reachStore } from "./collections.ts";
import { automationPolicy } from "./policy.ts";
import type { RunProposalView } from "./proposal.ts";
import {
  cite,
  folder,
  JUAN,
  made,
  NOW,
  ok,
  ran,
  START,
  type StepSpec,
  ZONE,
} from "./run.test-util.ts";
import { runView, undoAutomationRun } from "./runs.ts";
import { testAutomation } from "./service.ts";

const files = folder("ia");
const closing: (() => void)[] = [];
afterAll(() => {
  for (const c of closing) c();
  files.done();
});
afterEach(() => wireAutomationModels(null));

/** Invented keys and passwords: never real ones. */
const PASSWORD = "una contraseña larga de ejemplo";
const SERVER_KEY = "clave-del-servidor-inventada-0001";
const MY_KEY = "clave-de-openrouter-inventada-0002";
const PEDIDO = typeId("pedido");
const CLIENTE = typeId("cliente");
/** The account's reader and its «Agente», as the server's defaults give them. */
const READER = "anthropic:claude-haiku-4-5";
const PLANNER = "anthropic:claude-opus-5-5";
/** A model of his own key, evaluated for the reader a day ago. */
const OTHER = "openrouter:modelo-de-ejemplo";
const SEED = label("imported", "personal", [{ kind: "vault", id: "seed" }]);

/** Collections shaped like his: an order with a list of states, a client, and a diary no model may read. */
function seeded(s: UserStore) {
  seed(
    s,
    [
      {
        key: "pedido",
        name: "Pedido",
        folder: "pedidos/",
        fields: {
          importe: "number",
          nota: "text",
          estado: { type: "select", options: ["abierto", "cerrado"] },
        },
      },
      { key: "cliente", name: "Cliente", folder: "clientes/", fields: { nombre: "text" } },
      {
        key: "diario",
        name: "Diario",
        folder: "diario/",
        fields: { texto: "text" },
        ai: "private",
      },
    ],
    {
      "pedidos/uno.md": '---\nimporte: 12\nnota: "primero"\nestado: "abierto"\n---\n# Uno\n',
      "clientes/ana.md": '---\nnombre: "Ana Ejemplo"\n---\n# Ana\n',
      "diario/hoy.md": '---\ntexto: "algo que nadie más lee"\n---\n# Hoy\n',
    },
  );
  // What the collection is for, as Juan wrote it: the model of an «Agente» reads it with the name (AU-197).
  s.applySchema(
    {
      op: "describe_type",
      type: PEDIDO,
      description: { text: DESCRIBED, label: label("user", "personal", []) },
    },
    { actor: "user" },
  );
}

const DESCRIBED = "Lo que piden los clientes de ejemplo, con su importe";

const fieldOf = (s: UserStore, type: string, key: string) =>
  s.schema().types[type]?.fields.find((f) => f.key === key)?.id as string;

/** `n` more orders, as an import brings them: generated ids, a note each. */
function orders(s: UserStore, n: number) {
  const [importe, nota, estado] = ["importe", "nota", "estado"].map((k) => fieldOf(s, PEDIDO, k));
  const open = s.schema().types[PEDIDO]?.fields.find((f) => f.key === "estado")?.options?.[0]?.id;
  s.batch(() => {
    for (let i = 0; i < n; i++)
      s.create(
        PEDIDO,
        {
          [importe as string]: { value: (i * 37) % 900, label: SEED },
          [nota as string]: { value: `pedido de ejemplo ${i}`, label: SEED },
          ...(i % 2 === 0 ? { [estado as string]: { value: open as string, label: SEED } } : {}),
        },
        { actor: "import", device: "seed" },
      );
  });
}

type Answer = (req: ModelRequest, n: number) => unknown;

/**
 * A server with one account: «Modelos» with the server's key for Anthropic, wired to the runs as main.ts does, and a
 * provider that answers planners with `plan` and readers with `read`. `sent` keeps each request with the model it went
 * to.
 */
function server(o: { plan?: Answer; read?: Answer } = {}) {
  const home = mkdtempSync(join(files.dir, "host-"));
  const sys = openDb(join(home, "system.db"));
  addUser(sys, "juan", PASSWORD);
  const at = { now: NOW };
  const fake = fakePlanner([]);
  const host = new AgentHost({
    dataDir: home,
    providers: { planner: fake, reader: fake },
    now: () => at.now,
  });
  const sent: { model: string; req: ModelRequest }[] = [];
  const answers = { plan: o.plan, read: o.read };
  const models = new AccountModels({
    db: sys,
    key: randomBytes(32),
    host,
    defaults: {
      planner: { connection: "anthropic", model: "claude-opus-5-5" },
      reader: { connection: "anthropic", model: "claude-haiku-4-5" },
    },
    serverKeys: { anthropic: SERVER_KEY },
    now: () => at.now,
    makeProvider: (v): ModelProvider => ({
      id: v.connection,
      privacy: "external-api",
      async complete(req) {
        sent.push({ model: v.model, req: structuredClone(req) });
        const n = sent.filter((x) => x.req.role === req.role).length;
        const answer = req.role === "planner" ? answers.plan : answers.read;
        if (!answer) throw new Error(`no answer for a ${req.role}`);
        return {
          json: answer(req, n),
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
  return {
    host,
    models,
    s,
    sent,
    at,
    answers,
    /** His own key for OpenRouter, and `model` evaluated for `role` `daysAgo` days ago. */
    evaluated(role: "planner" | "reader", model: string, daysAgo = 1) {
      models.setKey(1, "openrouter", MY_KEY);
      const was = JSON.parse(s.setting("models/evals") ?? "[]") as unknown[];
      s.setSetting(
        "models/evals",
        JSON.stringify([
          {
            role,
            connection: "openrouter",
            model,
            zdr: false,
            right: 9,
            total: 10,
            tokens: 1000,
            cost: 0.01,
            at: at.now - daysAgo * 86_400_000,
          },
          ...was,
        ]),
      );
    },
    /** A model call of this month that cost so many dollars, as the agent writes them. */
    spend(usd: number) {
      s.journal.modelCall({
        run: "r",
        role: "reader",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        promptHash: "h",
        request: {},
        response: {},
        usage: { input: 1000, output: 100, cost: usd },
        at: at.now - 1000,
      });
    },
  };
}

// ---------------------------------------------------------------- the plan language and the steps

const call = (id: string, tool: string, args: Record<string, unknown>) => ({
  id,
  op: "call",
  tool,
  args,
});
const lit = (v: unknown) => ({ lit: v });
const obj = (...kv: unknown[]) => ({ fn: "obj", args: kv });
const plan = (...steps: unknown[]) => ({ version: 1, steps });
const answer = (id: string, texto: unknown = lit("Hecho")) => call(id, "answer", { texto });
const CREATE = (id: string, collection: string, field: string, value: string) =>
  call(id, "create", { collection: lit(collection), fields: obj(lit(field), lit(value)) });
const FIND = (id: string, collection = "pedido", query: unknown = { limit: 3 }) =>
  call(id, "find", { collection: lit(collection), query: lit(query) });

const YES = { mode: "yes" as const, limit: 20 };
const ASK = { mode: "ask" as const, limit: 20 };
/** A connection that reads `collection` and, with these cells, writes it. */
const conn = (collection: string, over: Record<string, unknown> = {}) => ({
  ...newConnection(collection),
  ...over,
});

/** An «Agente» with these parameters and connections. */
const AGENT = (
  connections: unknown[],
  params: Record<string, unknown> = {},
  settings?: Record<string, unknown>,
  name = "Analista",
): StepSpec => [
  name,
  "agent",
  { instructions: "Mira los pedidos y propone uno", ...params },
  { connections, ...(settings ? { settings } : {}) },
];
/** «Redactar» the row's note, with this «Modelo» (null: the account's). */
const WRITE = (model: string | null): StepSpec => [
  "Redactar",
  "write",
  { instructions: "Resume la nota", text: cite("$json.nota"), model },
];

const runOf = (s: UserStore, id: string, run: string) => ok(runView(s, id, run));

// ---------------------------------------------------------------- AU-199: the model of a step

describe("which model an AI step runs on (AU-199)", () => {
  it("AU-199 · `modelChoices` gives the account's model for the step's role and every model evaluated lately for it with its key; a step stores a choice's id or nothing", async () => {
    const t = server({ read: () => ({ text: "Un resumen inventado" }) });
    // The account's own, «El de la cuenta», for each use.
    expect(t.models.modelChoices(1, "reader").map((c) => [c.id, c.current])).toEqual([
      [READER, true],
    ]);
    expect(t.models.modelChoices(1, "planner").map((c) => c.id)).toEqual([PLANNER]);
    // A model evaluated for the reader a day ago, with its key: a choice of the reader's only.
    t.evaluated("reader", "modelo-de-ejemplo");
    // One evaluated 40 days ago is not (it must be evaluated again).
    t.evaluated("reader", "modelo-antiguo", 40);
    expect(t.models.modelChoices(1, "reader").map((c) => [c.id, c.current])).toEqual([
      [READER, true],
      [OTHER, false],
    ]);
    expect(t.models.modelChoices(1, "planner").map((c) => c.id)).toEqual([PLANNER]);
    // The conversation's planners are the same list as the «Agente»'s.
    expect(t.models.plannerChoices(1)).toEqual(t.models.modelChoices(1, "planner"));
    // Without its key, it is not a choice.
    t.models.setKey(1, "openrouter", null);
    expect(t.models.modelChoices(1, "reader").map((c) => c.id)).toEqual([READER]);
    t.evaluated("reader", "modelo-de-ejemplo");

    // A step with a choice's id runs on it; one with none on the account's.
    for (const [model, on] of [
      [OTHER, "modelo-de-ejemplo"],
      [null, "claude-haiku-4-5"],
    ] as const) {
      const a = made(t.s, [START, WRITE(model)]);
      ok(a.publish());
      t.sent.length = 0;
      const r = await ran(t.s, a.id, a.step("Inicio"), { nota: "una nota de ejemplo" });
      expect(r.state).toBe("done");
      expect(t.sent.map((x) => x.model)).toEqual([on]);
      // The reader got its prompt and the text between markers, and nothing else of the run.
      const req = t.sent[0]?.req;
      expect(req?.role).toBe("reader");
      expect(JSON.stringify(req?.input)).toContain("una nota de ejemplo");
      expect(JSON.stringify(req?.input)).not.toContain(a.id);
      const steps = runOf(t.s, a.id, r.id).steps;
      expect(JSON.stringify(steps[a.step("Redactar")])).not.toContain("Un resumen inventado");
    }
    // Each call is kept with its run, its model and what it cost: the month's spending counts it.
    const spent = t.models.spending(1);
    expect(spent.eur).toBeGreaterThan(0);
  });

  it("AU-199 · a step whose model is no longer a choice does not publish; a published one whose key is gone fails saying so; the month's budget stops the AI steps of any run", async () => {
    const t = server({
      read: () => ({ text: "Un resumen inventado" }),
      plan: () => plan(answer("s1")),
    });
    // Not a choice (never evaluated): it does not publish, and the problem names the step and its «Modelo».
    const off = made(t.s, [START, WRITE("openrouter:modelo-que-no-esta")]);
    expect(off.publish()).toMatchObject({
      refused: "blocked",
      problems: [
        expect.objectContaining({
          code: "param.value",
          step: off.step("Redactar"),
          param: "model",
        }),
      ],
    });
    // The same for an «Agente», read against the planner's list.
    const agentOff = made(t.s, [START, AGENT([conn("pedido")], { model: OTHER })]);
    t.evaluated("reader", "modelo-de-ejemplo");
    expect(agentOff.publish()).toMatchObject({
      refused: "blocked",
      problems: [expect.objectContaining({ code: "param.value", param: "model" })],
    });

    // Published with his key; the key is taken away: the step fails saying why, and nothing was called.
    const a = made(t.s, [START, WRITE(OTHER)]);
    ok(a.publish());
    t.models.setKey(1, "openrouter", null);
    t.sent.length = 0;
    const gone = await ran(t.s, a.id, a.step("Inicio"), { nota: "x" });
    expect(gone.state).toBe("failed");
    expect(gone.error).toMatchObject({
      step: a.step("Redactar"),
      ai: { code: "ai.refused", detail: { why: "no-key" } },
    });
    expect(t.sent).toEqual([]);

    // Over the month's budget: no AI step calls a model, a reader nor an «Agente», by hand or in «Probar».
    t.models.saveConfig(1, { ...t.models.config(1), budget: { monthlyEur: 1, warnAt: 0.8 } });
    t.spend(5);
    t.at.now += 31_000;
    const reader = made(t.s, [START, WRITE(null)]);
    ok(reader.publish());
    const agent = made(t.s, [START, AGENT([conn("pedido")])]);
    ok(agent.publish());
    for (const [x, step] of [
      [reader, "Redactar"],
      [agent, "Analista"],
    ] as const) {
      const r = await ran(t.s, x.id, x.step("Inicio"), { nota: "x" });
      expect(r.state).toBe("failed");
      expect(r.error).toMatchObject({
        step: x.step(step),
        ai: { code: "ai.refused", detail: { why: "budget" } },
      });
      const tried = ok(
        await testAutomation(t.s, x.id, { trigger: x.step("Inicio"), fields: { nota: "x" } }, JUAN),
      );
      expect(JSON.stringify(tried)).toContain("budget");
    }
    expect(t.sent).toEqual([]);
  });
});

// ---------------------------------------------------------------- AU-166: what no model may read

describe("a collection no model may read (AU-166)", () => {
  it("AU-166 · a collection no model may read cannot be connected to an «Agente», is a problem at publish, and its read is denied in a run", async () => {
    const t = server({ plan: (_, n) => (n === 1 ? plan(FIND("s1")) : plan(answer("s1"))) });
    // The diary is private: connecting it is a problem that blocks the publish, naming the collection, never a row.
    const diary = made(t.s, [START, AGENT([conn("diario")])]);
    const blocked = diary.publish() as { refused: string; problems: unknown[] };
    expect(blocked).toMatchObject({
      refused: "blocked",
      problems: [
        expect.objectContaining({
          code: "connection.notAllowed",
          step: diary.step("Analista"),
          detail: { collection: "diario", why: "private" },
        }),
      ],
    });
    expect(JSON.stringify(blocked)).not.toContain("algo que nadie más lee");

    // Published over the orders; he then closes them to models («Restringida»): the read is denied in the run, the
    // unit fails saying which collection (`ai.private`), and no row reached the model.
    const a = made(t.s, [START, AGENT([conn("pedido")])]);
    ok(a.publish());
    t.s.setAiAccess(PEDIDO, "restricted", JUAN.device);
    const r = await ran(t.s, a.id, a.step("Inicio"), { nota: "x" });
    expect(r.state).toBe("failed");
    expect(r.error).toMatchObject({
      step: a.step("Analista"),
      ai: { code: "ai.private", detail: { collection: "pedido" } },
    });
    expect(t.sent.map((x) => x.req.role)).toEqual(["planner"]);
    expect(JSON.stringify(t.sent)).not.toContain("primero");
    expect(JSON.stringify(runOf(t.s, a.id, r.id))).not.toContain("primero");
  });
});

// ---------------------------------------------------------------- AU-204, AU-42: what an «Agente» writes

describe("what an «Agente» writes on the real store (AU-204, AU-42)", () => {
  const NEW = "pedido propuesto por el agente";
  const BEA = "Bea Ejemplo";

  it("AU-204 · the rows of the table on the real store: what is saved keeps its label and is undone with the run, and what is proposed waits in the run's proposal", async () => {
    const t = server();
    orders(t.s, 3000);
    const nota = fieldOf(t.s, PEDIDO, "nota");
    const nombre = fieldOf(t.s, CLIENTE, "nombre");
    const notes = () => t.s.list(PEDIDO).map((e) => e.entity.values[nota]);
    const names = () => t.s.list(CLIENTE).map((e) => e.entity.values[nombre]);

    // «Sí» on creating orders: the «Agente» reads the 3,000 and creates one, which is saved with the run.
    t.answers.plan = (_, n) =>
      n === 1
        ? plan(FIND("s1", "pedido", {}), CREATE("s2", "pedido", "nota", NEW))
        : plan(answer("s1"));
    const yes = made(t.s, [
      START,
      AGENT([conn("pedido", { create: { ...YES, fields: ["nota"] } })]),
    ]);
    ok(yes.publish());
    const t0 = clock();
    const saved = await ran(t.s, yes.id, yes.step("Inicio"), { nota: "x" });
    const ms = clock() - t0;
    expect(saved).toMatchObject({ state: "done", proposal: null });
    expect(notes()).toContain(NEW);
    const ops = t.s.runOps(saved.id);
    expect(ops.map((o) => o.kind)).toEqual(["create"]);
    // What a model chose keeps the label of where it came from: never Juan's hand.
    const row = t.s.list(PEDIDO).find((e) => e.entity.values[nota] === NEW);
    const kept = t.s.get(row?.entity.id as string)?.labels[nota];
    expect(kept?.integrity).not.toBe("user");
    // The model was told the collection's name, what it is for and its options' names, from the server (AU-197).
    const schema = JSON.stringify(t.sent[0]?.req);
    expect(schema).toContain('"name":"Pedido"');
    expect(schema).toContain(DESCRIBED);
    expect(schema).toContain('"abierto"');
    // The round saw at most 200 of the 3,000 rows, and the run's record keeps no row.
    const seen = JSON.stringify(t.sent[1]?.req.input);
    expect(seen.length).toBeLessThanOrEqual(40_000);
    expect(JSON.stringify(runOf(t.s, yes.id, saved.id).steps)).not.toContain("pedido de ejemplo 7");
    // Undone with the run: the order goes.
    ok(undoAutomationRun(t.s, yes.id, saved.id, JUAN));
    expect(notes()).not.toContain(NEW);
    // A run of an «Agente» over 3,000 rows on the real store, two rounds: 98 to 232 ms on 2026-11-18 (five runs).
    under(ms, 3000, "clock", "an «Agente» reading 3,000 rows on the real store and saving one");

    // «Preguntar» on creating clients: nothing is saved, the change waits in the run's one proposal.
    t.answers.plan = () => plan(CREATE("s1", "cliente", "nombre", BEA), answer("s2"));
    const ask = made(t.s, [
      START,
      AGENT([conn("cliente", { create: { ...ASK, fields: ["nombre"] } })]),
    ]);
    ok(ask.publish());
    const asked = await ran(t.s, ask.id, ask.step("Inicio"), { nota: "x" });
    expect(asked.state).toBe("done");
    expect(asked.proposal).not.toBeNull();
    expect(names()).not.toContain(BEA);
    expect(t.s.runOps(asked.id)).toEqual([]);

    // «Probar» saves nothing and proposes nothing, «Sí» or not.
    t.answers.plan = () => plan(CREATE("s1", "pedido", "nota", "de la prueba"), answer("s2"));
    ok(
      await testAutomation(
        t.s,
        yes.id,
        { trigger: yes.step("Inicio"), fields: { nota: "x" } },
        JUAN,
      ),
    );
    expect(notes()).not.toContain("de la prueba");
  });

  it("AU-42 · what an AI step asks to write with «Preguntar» joins the run's one proposal, each change saying which step asks and that an AI decided it", async () => {
    const t = server({ plan: () => plan(CREATE("s1", "cliente", "nombre", BEA), answer("s2")) });
    // A «Colección» step that asks, then an «Agente» that asks: one proposal with both changes.
    const a = made(
      t.s,
      [
        START,
        [
          "Crear",
          "collection",
          {
            collection: "pedido",
            action: "create",
            fields: [{ field: "nota", value: cite("$json.nota") }],
            permission: "ask",
          },
        ],
        AGENT([conn("cliente", { create: { ...ASK, fields: ["nombre"] } })]),
      ],
      {
        // Both from «Inicio»: a step that asks gives no rows to the next.
        arrows: [
          ["Inicio", "Crear"],
          ["Inicio", "Analista"],
        ],
      },
    );
    ok(a.publish());
    const r = await ran(t.s, a.id, a.step("Inicio"), { nota: "a mano" });
    expect(r.state).toBe("done");
    const pending = t.s.journal.proposals("pending");
    expect(pending.map((p) => p.id)).toEqual([r.proposal]);
    const view = pending[0]?.view as RunProposalView;
    expect(view.run.count).toBe(2);
    // The two branches run side by side: which change comes first is not fixed.
    expect(
      view.run.first.map((x) => [
        x.step,
        x.byAgent,
        x.action,
        x.collection,
        x.values[Object.keys(x.values)[0] as string]?.value,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [a.step("Crear"), false, "create", "pedido", "a mano"],
        [a.step("Analista"), true, "create", "cliente", BEA],
      ]),
    );
    // Whose step it is comes from the version that ran, not from the change: the same proposal read again says so.
    expect(ok(runView(t.s, a.id, r.id)).proposal).toEqual({ id: r.proposal, status: "pending" });
  });
});

// ---------------------------------------------------------------- AU-205: the reach from the stored version

describe("an AI step's reach, from the version the server keeps (AU-205)", () => {
  /** The version as the server keeps it. */
  const stored = (s: UserStore, id: string, n = 1): Automation =>
    parseAutomation(JSON.parse(s.journal.automationVersion(id, n)?.doc as string));

  it("AU-205 · the connection `decide` checks is the stored version's: a request for a collection the step has not connected is denied whatever the model, the box or a browser sends", async () => {
    const t = server();
    const a = made(t.s, [START, AGENT([conn("pedido", { create: { ...YES, fields: ["nota"] } })])]);
    ok(a.publish());
    const doc = stored(t.s, a.id);
    const policy = automationPolicy(doc, label("user", "personal", []), reachStore(t.s, ZONE));
    const own = { value: "x", label: label("user", "personal", []) };
    const ask = (over: Record<string, unknown>) =>
      policy.decide({
        automation: { id: a.id, version: 1 },
        step: a.step("Analista"),
        type: "agent",
        action: "find",
        effect: "read",
        destroys: false,
        collection: "pedido",
        values: {},
        control: null,
        test: false,
        fields: [],
        ...over,
      } as never);
    // Its own connection: read and create the orders.
    expect(ask({})).toMatchObject({ kind: "allow" });
    expect(
      ask({
        action: "create",
        effect: "write",
        values: { nota: own },
        row: { nota: "x" },
        written: 0,
      }),
    ).toMatchObject({ kind: "allow" });
    // Not connected: denied, whatever the call says of itself (here, that it is no «Agente»'s).
    expect(ask({ collection: "cliente" })).toMatchObject({
      kind: "deny",
      rule: "P29",
      reason: "not-connected",
    });
    expect(ask({ collection: "cliente", type: "collection" })).toMatchObject({
      kind: "deny",
      rule: "P29",
      reason: "not-connected",
    });
    // A field the connection does not let it write, and an action it has «No» on.
    expect(
      ask({
        action: "create",
        effect: "write",
        values: { importe: own },
        row: { importe: 3 },
        written: 0,
      }),
    ).toMatchObject({ kind: "deny", rule: "P29" });
    expect(
      ask({
        action: "trash",
        effect: "write",
        destroys: true,
        values: {},
        rows: 1,
        row: { nota: "x" },
      }),
    ).toMatchObject({ kind: "deny", rule: "P29", reason: "action-off" });
    // A version the server does not keep, or a step it does not have: no reach to read, denied.
    expect(ask({ automation: { id: a.id, version: 7 } })).toMatchObject({
      kind: "deny",
      reason: "no-reach",
    });
    expect(ask({ step: "s_inventado" })).toMatchObject({ kind: "deny", reason: "no-reach" });
    // The private diary, even named by a call the version never made.
    expect(ask({ collection: "diario" })).toMatchObject({ kind: "deny", rule: "P29" });
  });

  it("AU-205 · the policy denies a read made by the code of «Las hace este código» on the real server, the unit follows the step's «Si falla», and nothing says what it could not read (task 144)", async () => {
    const t = server({
      plan: (req) =>
        plan(answer("s1", lit(JSON.stringify((req.input as { rows?: unknown }).rows ?? [])))),
    });
    const READS =
      "return $col('Pedido').find({ where: [{ field: 'nota', op: 'is', value: 'primero' }], limit: 3 })";
    const jobs: unknown[] = [];
    const box: Box = {
      async run(job) {
        jobs.push(job);
        const reads = (job as { reads: Record<string, Cell> }).reads;
        return {
          evaluations: [
            "pedidos" in reads
              ? { state: "done", values: [reads.pedidos as Cell], clock: false, random: false }
              : {
                  state: "needs",
                  key: "pedidos",
                  read: {
                    collection: "Pedido",
                    op: "find",
                    where: [{ field: "nota", op: "is", value: "primero" }],
                    limit: 3,
                  },
                },
          ],
          console: [],
          dropped: 0,
          ms: 1,
        } as never;
      },
    };
    const a = made(t.s, [
      START,
      AGENT([conn("pedido")], { reads: "code", code: READS }, { onError: "continue" }),
    ]);
    ok(a.publish());
    // Allowed, its rows are the model's.
    const r1 = await ran(t.s, a.id, a.step("Inicio"), { nota: "x" }, { box });
    expect(r1.state).toBe("done");
    expect(JSON.stringify(t.sent[0]?.req.input)).toContain("primero");

    // Closed to models after publishing: the code's read is denied by the policy on the server (P29, which only the
    // server can decide: the engine does not know the collection's level), the unit fails and, with «Continuar», the
    // run goes on. The model is not called, and the failure names the parameter, never what the read asked or found.
    // The same, with «Si falla» as it is born («Parar»).
    const stops = made(t.s, [START, AGENT([conn("pedido")], { reads: "code", code: READS })]);
    ok(stops.publish());
    t.s.setAiAccess(PEDIDO, "restricted", JUAN.device);
    t.sent.length = 0;
    const r2 = await ran(t.s, a.id, a.step("Inicio"), { nota: "x" }, { box });
    expect(r2.state).toBe("done");
    expect(t.sent).toEqual([]);
    const step = runOf(t.s, a.id, r2.id).steps[a.step("Analista")];
    expect(step).toMatchObject({
      failed: 1,
      error: { ai: { code: "ai.private", detail: { param: "code" } } },
    });
    expect(step?.reads).toEqual([]);
    const said = JSON.stringify(step);
    for (const what of ["primero", "nota", "Pedido"]) expect(said).not.toContain(what);
    // With «Parar», the run fails at it.
    const r3 = await ran(t.s, stops.id, stops.step("Inicio"), { nota: "x" }, { box });
    expect(r3).toMatchObject({
      state: "failed",
      error: { step: stops.step("Analista"), ai: { code: "ai.private" } },
    });
    expect(t.sent).toEqual([]);
  });
});

describe("a run that waits for an answer (AU-203, phase F15 S2)", () => {
  it.todo(
    "AU-203 · a waiting run lets the automation's next run start, survives a restart, and is answered only from a personal device",
  );
  it.todo(
    "AU-203 · the 21st waiting run of an automation fails at its question; turning the automation off cancels its waits and their cards no longer hold",
  );
});
