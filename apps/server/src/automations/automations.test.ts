// «Automatizaciones» on the server in F14b (docs/automatizaciones.md §5.7, §5.8, §6, §7): the store, the routes, the
// real `Collections` and `Policy`, and the test run. Pending: the first PR of the phase brings one test per rule,
// and the builder turns each into a real one, keeping the rule's id in its name (`make check` reads them). Real
// tests open a store with the repo's invented seeds (seed.test-util.ts: generated ids, keys and names like Juan's)
// and, where a rule is about volume, thousands of rows. Bounds on time are in this thread's CPU time, at the machine's pace (@boni/pace, T-11).
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decide,
  ensureSystemTypes,
  fakePlanner,
  leaf,
  type Origin,
  ToolRegistry,
} from "@boni/agent";
import {
  type Automation,
  bornParams,
  type ChangeWith,
  cellOf,
  FORMAT,
  type PolicyCall,
  renameStep,
  runTest,
  StepFault,
  stepPrints,
} from "@boni/automations";
import { type Label, label, newId } from "@boni/entities";
import { cpu, under } from "@boni/pace";
import { openUserStore, type UserStore } from "@boni/store";
import { automationRowTarget, flowRowTarget, SYS } from "@boni/views";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_MCP, ACTIONS, ROUTE_ACTIONS, ROUTE_RUNS, runAction } from "../actions.ts";
import { AgentHost } from "../agent.ts";
import { addUser } from "../auth.ts";
import { DataError, listRows } from "../data.ts";
import { openDb } from "../db.ts";
import { Feeds } from "../feeds.ts";
import { flowMap } from "../flowMap.ts";
import {
  deleteAutomationRow,
  flowsCollection,
  SYS_FLOWS,
  updateFlowRow,
  withFlows,
} from "../flowsCollection.ts";
import { makeApp, serve } from "../http.ts";
import { LoginGuard } from "../limits.ts";
import { mcpAnswer, mcpToolNames } from "../mcp.ts";
import { createPage } from "../pages.ts";
import { ROUTES } from "../routes.ts";
import { seed } from "../seed.test-util.ts";
import { systemCollections } from "../systemCollections.ts";
import { storeCollections } from "./collections.ts";
import { serverDates } from "./dates.ts";
import { ACTS, actOf, argsOf, automationPolicy, consentIn, runPolicy } from "./policy.ts";
import { AUTOMATION_ACTIONS, AUTOMATION_ROUTES, NO_MCP_YET } from "./routes.ts";
import * as service from "./service.ts";
import {
  automationLabel,
  automationView,
  createAutomation,
  DRAFT_MAX,
  duplicateAutomation,
  keepDraft,
  placeSteps,
  ROWS_PAGE,
  type ServiceError,
  setDeleted,
  type TestAnswer,
  testAutomation,
  testRows,
  testSample,
} from "./service.ts";

describe("the contract of the routes (it holds today)", () => {
  it("every route is under the path the apps already allow, runs an action there is, and names a function of the service", () => {
    for (const [route, { action, runs }] of Object.entries(AUTOMATION_ROUTES)) {
      // What paths.cjs and Net.kt allow under api/agent: letters, digits and - _ . / % after the prefix.
      expect(route, route).toMatch(
        /^(GET|POST|PUT|DELETE) \/api\/agent\/automations(\/[a-z:/]*)?$/,
      );
      expect(Object.keys(AUTOMATION_ACTIONS), route).toContain(action);
      expect(typeof (service as Record<string, unknown>)[runs], route).toBe("function");
      // A GET never runs an action that changes something.
      if (route.startsWith("GET ")) expect(AUTOMATION_ACTIONS[action]?.effect, route).toBe("read");
    }
    const used = new Set(Object.values(AUTOMATION_ROUTES).map((r) => r.action));
    expect(Object.keys(AUTOMATION_ACTIONS).filter((a) => !used.has(a))).toEqual([]);
  });
});

// ---------------------------------------------------------------- the store and the drafts, as Juan's

const NOW = Date.UTC(2026, 10, 15, 9, 0);
const HAND = { device: "d_portatil", now: NOW };
const JUAN = { ...HAND, trust: "personal" as const, zone: "Europe/Madrid" };
const SEED = label("imported", "public", [{ kind: "vault", id: "seed" }]);
const OUTSIDE = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);
const GASTO = "t_gasto";

const dir = mkdtempSync(join(tmpdir(), "boni-automatizaciones-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let store: UserStore;
let n = 0;
beforeEach(() => {
  store = openUserStore(join(dir, `u${++n}.db`), { now: () => NOW });
  seed(
    store,
    [
      {
        key: "gasto",
        name: "Gasto",
        folder: "gastos/",
        fields: { fecha: "date", importe: "number", concepto: "text" },
      },
      { key: "proyecto", name: "Proyecto", folder: "proyectos/" },
    ],
    {
      "gastos/cafe.md": '---\nfecha: "2026-11-02"\nimporte: 3\nconcepto: "café"\n---\n# Café\n',
      "gastos/pan.md": '---\nfecha: "2026-11-03"\nimporte: 2\nconcepto: "pan"\n---\n# Pan\n',
      "gastos/libro.md": '---\nfecha: "2026-11-04"\nimporte: 18\nconcepto: "libro"\n---\n# Libro\n',
      "proyectos/casa.md": "# Casa\n",
    },
  );
});

const fieldId = (key: string) => {
  const f = store.schema().types[GASTO]?.fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f.id;
};

/** `count` more records of «Gasto», made in one batch as an import would. */
function bulk(count: number) {
  const [fecha, importe, concepto] = ["fecha", "importe", "concepto"].map(fieldId) as string[];
  store.batch(() => {
    for (let i = 0; i < count; i++)
      store.create(
        GASTO,
        {
          [fecha as string]: {
            value: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
            label: SEED,
          },
          [importe as string]: { value: (i * 7) % 100, label: SEED },
          [concepto as string]: { value: `gasto ${i}`, label: SEED },
        },
        { actor: "import", device: "seed" },
      );
  });
}

const stepId = () => newId("o").replace(/^o_/, "s_");

interface Draft {
  doc: Automation;
  id(name: string): string;
}

/** A step's params as the editor writes them: the «Permiso» a «Colección» write step is born with comes first (AU-187). */
function born(type: string, params: Record<string, unknown> | undefined) {
  const p = params ?? {};
  return { ...bornParams(type, typeof p.action === "string" ? p.action : undefined), ...p };
}

/** A draft from steps by name and arrows between names, the way the canvas would send it. */
function draft(
  steps: readonly [string, string, Record<string, unknown>?, Record<string, unknown>?][],
  arrows: readonly [string, string, string?, string?][],
  name = "Revisar gastos",
): Draft {
  const ids = new Map(steps.map(([n]) => [n, stepId()]));
  const id = (n: string) => {
    const s = ids.get(n);
    if (!s) throw new Error(`no step ${n}`);
    return s;
  };
  return {
    id,
    doc: {
      format: FORMAT,
      id: "",
      version: 0,
      name,
      steps: steps.map(([n, type, params, settings]) => ({
        id: id(n),
        name: n,
        type,
        params: born(type, params) as Automation["steps"][number]["params"],
        ...(settings ? { settings } : {}),
      })),
      arrows: arrows.map(([from, to, output, input]) => ({
        from: { step: id(from), output: output ?? "main" },
        to: { step: id(to), input: input ?? "main" },
      })),
      settings: {},
    },
  };
}

/** «Inicio» (asks for «Mínimo») → «Buscar» (gastos over 10) → «Marcar» (writes «revisado» in each). */
const reviewing = () =>
  draft(
    [
      ["Inicio", "manual", { fields: [{ key: "minimo", name: "Mínimo", type: "number" }] }],
      [
        "Buscar",
        "collection",
        {
          collection: "gasto",
          action: "find",
          where: [{ field: "importe", op: "gt", value: 10 }],
          sort: [{ field: "importe", direction: "desc" }],
          limit: 5000,
        },
      ],
      [
        "Marcar",
        "collection",
        {
          collection: "gasto",
          action: "update",
          target: "incoming",
          fields: [{ field: "concepto", value: "revisado" }],
        },
      ],
    ],
    [
      ["Inicio", "Buscar"],
      ["Buscar", "Marcar"],
    ],
  );

function ok<T>(x: T | ServiceError): T {
  if (x && typeof x === "object" && "error" in x && Object.keys(x).length === 1)
    throw new Error(`service error: ${(x as ServiceError).error}`);
  return x as T;
}

/** A new automation with this draft: its view, and its steps by name. */
function made(d: Draft = reviewing()) {
  const view = ok(createAutomation(store, d.doc, HAND));
  return { view, id: view.id, step: d.id, doc: { ...d.doc, id: view.id } };
}

const opLog = () => store.logPage(0, 1_000_000).length;

/** Timings for the PR (A-15), when BONI_TIMINGS names a file. */
const timing = (what: string, ms: number) => {
  if (process.env.BONI_TIMINGS)
    appendFileSync(process.env.BONI_TIMINGS, `${what}: ${ms.toFixed(1)} ms\n`);
};

const SIGN_IN = "una contraseña larga de ejemplo";
/** The server over HTTP on the tailnet entry, with its own accounts and Juan's store in its host. */
async function served(actions?: ToolRegistry) {
  const home = mkdtempSync(join(dir, "http-"));
  const db = openDb(join(home, "system.db"));
  addUser(db, "juan", SIGN_IN);
  const planner = fakePlanner([]);
  const host = new AgentHost({ dataDir: home, providers: { planner, reader: planner } });
  const app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
    write: true,
    ...(actions ? { actions } : {}),
  });
  const server: Server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  server.on("close", () => db.close());
  return { server, host, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function signedIn(base: string) {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: SIGN_IN, device: "portatil-ejemplo" }),
  });
  const token = ((await r.json()) as { token: string }).token;
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}

describe("the routes and the list of actions", () => {
  it("AU-168 · every route of AUTOMATION_ROUTES is in ROUTES as tailnet and in ROUTE_RUNS with its action; with a list of actions that lacks it the route is refused (403, P0) before anything runs, the reads too", async () => {
    const http = readFileSync(join(import.meta.dirname, "..", "http.ts"), "utf8");
    for (const [route, { action }] of Object.entries(AUTOMATION_ROUTES)) {
      expect(ROUTES[route], route).toBe("tailnet");
      expect(ACTIONS.get(action)?.name, route).toBe(action);
      // A route that changes something is its action in both tables; a read (no ROUTE_RUNS: only changes are there)
      // runs its action by name all the same, through the same `runAction`.
      if (!route.startsWith("GET ")) {
        expect(ROUTE_RUNS[route], route).toBe(action);
        expect(ROUTE_ACTIONS[route], route).toEqual([action]);
      } else expect(Object.hasOwn(ROUTE_RUNS, route), route).toBe(false);
      const at = http.indexOf(`case "${route}"`);
      expect(at, route).toBeGreaterThan(-1);
      expect(http.slice(at, at + 700), route).toContain(`"${action}"`);
    }

    // Over HTTP with a list of actions that has none of them: each is refused by the policy before anything runs.
    const { server, base, host } = await served(new ToolRegistry());
    try {
      const call = await signedIn(base);
      const own = host.store(1);
      const made = ok(createAutomation(own, reviewing().doc, HAND));
      const trigger = made.automation.steps[0]?.id as string;
      const step = made.automation.steps[1]?.id as string;
      const log = own.logPage(0, 1_000_000).length;
      const refused = { status: 403, body: { error: "policy", rule: "P0" } };
      const path = `/api/agent/automations/${made.id}`;
      expect(await call("POST", `${path}/test`, { trigger, fields: { minimo: 1 } })).toEqual(
        refused,
      );
      expect(await call("GET", `${path}/test/rows?step=${step}&side=out&name=main`)).toEqual(
        refused,
      );
      expect(await call("GET", `${path}/test/sample?step=${step}`)).toEqual(refused);
      expect(await call("GET", path)).toEqual(refused);
      // Nothing ran: no test kept, nothing in the log.
      expect(own.journal.automationTests(made.id)).toEqual([]);
      expect(own.logPage(0, 1_000_000).length).toBe(log);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
  it("AU-168 · an action that changes an automation is Juan's touch: his hand runs it, and an assistant, a flow and work in the background are refused by the policy", async () => {
    const { id, step } = made();
    const touching = Object.entries(AUTOMATION_ACTIONS)
      .filter(([, a]) => a.effect === "touch")
      .map(([name]) => name);
    expect(touching.sort()).toEqual(
      [
        "automations.arrange",
        "automations.create",
        "automations.delete",
        "automations.duplicate",
        "automations.edit",
        "automations.restore",
      ].sort(),
    );
    // The two that read are reads in the registry too: a test writes in no collection (AU-90).
    expect(ACTIONS.get("automations.read")?.effect).toBe("read");
    expect(ACTIONS.get("automations.test")?.effect).toBe("read");
    const at = (name: string, origin: Origin, flow = false) =>
      decide({ tool: ACTIONS.get(name), args: {}, control: null, flow }, origin, {
        writes: 0,
        sensitiveReads: 0,
      }).kind;
    for (const name of touching) {
      expect(ACTIONS.get(name)?.effect, name).toBe("touch");
      expect(at(name, { kind: "hand", trust: "personal", device: "d_portatil" }), name).toBe(
        "allow",
      );
      expect(at(name, { kind: "assistant", trust: "personal", device: "d_asistente" }), name).toBe(
        "deny",
      );
      expect(at(name, { kind: "background", trust: "personal" }), name).toBe("deny");
      // A flow is work in the background: refused too.
      expect(at(name, { kind: "background", trust: "personal" }, true), name).toBe("deny");
    }
    // And his hand does run them, through `runAction` as the routes call it.
    const hand = { store, trust: "personal" as const, device: "d_portatil" };
    const r = await runAction(
      "automations.arrange",
      { id, places: [{ step: step("Buscar"), x: 10, y: 20 }] },
      hand,
    );
    expect(r).toEqual({ out: { ok: true } });
    expect(ok(automationView(store, id)).places).toEqual([{ step: step("Buscar"), x: 10, y: 20 }]);
  });
  it("AU-168 · asked by an origin that is not Juan's hand, automations.read and automations.test answer the states and the counts and never a row or a field's value", async () => {
    const { id, step } = made();
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: { minimo: 1 } }, JUAN));
    const reads = {
      "automations.read": [
        { id },
        { id, part: "rows", step: step("Buscar"), side: "out", name: "main" },
        { id, part: "sample", step: step("Marcar") },
      ],
      "automations.test": [{ id, trigger: step("Inicio"), fields: { minimo: 1 } }],
    };
    // By his hand they give the rows and their values.
    const hand = { store, trust: "personal" as const, device: "d_portatil" };
    const page = await runAction("automations.read", reads["automations.read"][1] as never, hand);
    expect("out" in page && JSON.stringify(page.out)).toContain("libro");
    // Any other origin reaches an action through the agent's runner, which gives each tool the service its host
    // names: the server's host names none «automations» in F14b (agent.ts), so the action gets null. A run of an
    // assistant, a flow or work in the background with a service shaped like another area's (actor «agent») is no
    // hand either. Both answer `not-available`: no row, no value, and no count either (the gap: F16).
    const planner = fakePlanner([]);
    const host = new AgentHost({
      dataDir: mkdtempSync(join(dir, "host-")),
      providers: { planner, reader: planner },
    });
    const services = host as unknown as {
      service(account: number, name: string, run: { run: string; inFlow?: boolean }): unknown;
    };
    const fromHost = services.service(1, "automations", { run: "r_ejemplo" });
    expect(fromHost).toBeNull();
    expect(services.service(1, "automations", { run: "r_ejemplo", inFlow: true })).toBeNull();
    const asAgent = { store, meta: { actor: "agent", run: "r_ejemplo" } };
    const testsBefore = JSON.stringify(store.journal.automationTests(id));
    for (const [name, list] of Object.entries(reads))
      for (const args of list)
        for (const service of [fromHost, asAgent, undefined]) {
          const tool = ACTIONS.get(name);
          if (!tool?.run) throw new Error(`no action ${name}`);
          const vals = Object.fromEntries(
            Object.entries(args).map(([k, v]) => [k, leaf(v as never, OUTSIDE)]),
          );
          let out: unknown = null;
          let code = "";
          try {
            out = await tool.run({ store: null, service } as never, vals, OUTSIDE);
          } catch (e) {
            code = (e as { code?: string }).code ?? String(e);
          }
          expect(code, `${name} ${JSON.stringify(args)}`).toBe("not-available");
          expect(out).toBeNull();
        }
    // A test asked so ran nothing either: what is kept is as it was.
    expect(JSON.stringify(store.journal.automationTests(id))).toBe(testsBefore);
    // Nor has the MCP a tool for them in F14b: each says why (NO_MCP_YET).
    for (const name of Object.keys(reads))
      expect(ACTION_MCP[name], name).toEqual({ why: NO_MCP_YET });
    expect(mcpToolNames().filter((t) => /automation/.test(t))).toEqual([]);
  });
  it("AU-87 · no action of the list adds, removes or changes a step of a draft but automations.create and automations.edit, and neither runs for an origin that is not Juan's hand or his card", async () => {
    const { id, step } = made();
    const before = ok(automationView(store, id)).automation;
    const hand = { store, trust: "personal" as const, device: "d_portatil" };
    // Every action of the list there is today, as his hand runs it: «Probar» and «Probar paso» too.
    const args: Record<string, Record<string, unknown>> = {
      "automations.arrange": { id, places: [{ step: step("Buscar"), x: 300, y: 40 }] },
      "automations.duplicate": { id, name: "Revisar gastos (copia)" },
      "automations.test": { id, trigger: step("Inicio"), fields: { minimo: 1 } },
    };
    const others = Object.keys(AUTOMATION_ACTIONS).filter(
      (a) => a !== "automations.create" && a !== "automations.edit" && ACTIONS.get(a),
    );
    expect(others).toEqual(
      expect.arrayContaining([
        "automations.read",
        "automations.test",
        "automations.arrange",
        "automations.duplicate",
        "automations.delete",
        "automations.restore",
      ]),
    );
    // «Eliminar» before «restore», so each runs on the automation as it is.
    const order = [...others].sort(
      (a, b) => Number(a === "automations.restore") - Number(b === "automations.restore"),
    );
    for (const name of order) {
      const r = await runAction(name, args[name] ?? { id }, hand);
      expect("refused" in r, name).toBe(false);
      // The draft as the store has it, deleted or not.
      const row = store.journal.automationDraft(id);
      const now = row ? (JSON.parse(row.doc) as Automation) : null;
      expect(now?.steps, name).toEqual(before.steps);
      expect(now?.arrows, name).toEqual(before.arrows);
    }
    // The two that change steps: his hand runs them; his own turn only as a card he confirms; nothing else at all.
    for (const name of ["automations.create", "automations.edit"]) {
      const tool = ACTIONS.get(name);
      const at = (origin: Origin) =>
        decide({ tool, args: {}, control: null }, origin, { writes: 0, sensitiveReads: 0 }).kind;
      expect(at({ kind: "hand", trust: "personal", device: "d_portatil" }), name).toBe("allow");
      expect(at({ kind: "turn", trust: "personal" }), name).toBe("confirm");
      for (const kind of ["background", "miniapp", "accepted", "assistant"] as const)
        expect(at({ kind, trust: "personal" }), `${name} ${kind}`).toBe("deny");
      expect(at({ kind: "turn", trust: "ambient" }), name).toBe("deny");
    }
  });
});

describe("where an automation lives", () => {
  it("AU-62 · the draft saves itself: the first step creates the automation with its draft, each later save keeps the whole document over the last and answers its new rev, and another device reads what the last one saved", () => {
    const first = draft([["Inicio", "manual"]], [], "Nueva automatización");
    const { view, id, doc } = made(first);
    expect(view.rev).toBe(1);
    expect(view.id).toMatch(/^a_[0-9a-z]{26}$/);
    expect(view.automation.steps.map((s) => s.name)).toEqual(["Inicio"]);
    expect(view.device).toBe(HAND.device);

    // Each change is the whole document; the answer is the next rev.
    const named = { ...doc, name: "Revisar gastos" };
    expect(ok(keepDraft(store, id, named, HAND))).toEqual({ rev: 2, stale: [] });
    const more = {
      ...named,
      steps: [...named.steps, { id: stepId(), name: "Buscar", type: "collection", params: {} }],
    };
    expect(ok(keepDraft(store, id, more, { device: "d_telefono", now: NOW + 1000 })).rev).toBe(3);

    // The other device reads what the last save kept, all of it.
    const read = ok(automationView(store, id));
    expect(read.rev).toBe(3);
    expect(read.automation).toEqual(more);
    expect(read.device).toBe("d_telefono");
    expect(read.updated).toBe(NOW + 1000);
    expect(store.journal.automations().map((a) => [a.id, a.name, a.rev])).toEqual([
      [id, "Revisar gastos", 3],
    ]);
  });

  it("AU-62 · a draft that is not the format, has another's id or is over 200,000 characters is refused, and one with problems of validate is kept all the same", () => {
    const { id, doc } = made();
    expect(keepDraft(store, id, { ...doc, format: "uno" }, HAND)).toEqual({ error: "bad-request" });
    expect(keepDraft(store, id, { ...doc, steps: "no" }, HAND)).toEqual({ error: "bad-request" });
    expect(keepDraft(store, id, null, HAND)).toEqual({ error: "bad-request" });
    const other = made();
    expect(keepDraft(store, id, other.doc, HAND)).toEqual({ error: "bad-request" });
    const huge = { ...doc, name: "x".repeat(DRAFT_MAX) };
    expect(keepDraft(store, id, huge, HAND)).toEqual({ error: "too-large" });
    expect(createAutomation(store, huge, HAND)).toEqual({ error: "too-large" });
    expect(keepDraft(store, "a_nadie", doc, HAND)).toEqual({ error: "not-found" });
    // Nothing refused was kept.
    expect(ok(automationView(store, id)).rev).toBe(1);

    // Half made: a «Colección» with no collection and an arrow to nowhere useful is kept.
    const half = {
      ...doc,
      steps: [...doc.steps, { id: stepId(), name: "Sin hacer", type: "collection", params: {} }],
    };
    expect(ok(keepDraft(store, id, half, HAND)).rev).toBe(2);
    expect(ok(automationView(store, id)).automation.steps.map((s) => s.name)).toContain(
      "Sin hacer",
    );
  });

  it("AU-62 · «Duplicar» makes a new automation named as told with the same steps, arrows and places and no tests; «Eliminar» takes it off the list and restore brings it back with its draft, places and tests", async () => {
    const { id, step } = made();
    ok(placeSteps(store, id, [{ step: step("Buscar"), x: 300, y: 40 }]));
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: {} }, JUAN));
    const original = ok(automationView(store, id));
    expect(Object.keys(original.tests)).toHaveLength(3);

    const copy = ok(duplicateAutomation(store, id, "Revisar gastos (copia)", HAND));
    expect(copy.id).not.toBe(id);
    expect(copy.rev).toBe(1);
    expect(copy.automation.name).toBe("Revisar gastos (copia)");
    expect(copy.automation.steps).toEqual(original.automation.steps);
    expect(copy.automation.arrows).toEqual(original.automation.arrows);
    expect(copy.places).toEqual(original.places);
    expect(copy.tests).toEqual({});
    expect(copy.tested).toEqual({});

    ok(setDeleted(store, id, true));
    expect(store.journal.automations().map((a) => a.id)).toEqual([copy.id]);
    expect(automationView(store, id)).toEqual({ error: "not-found" });
    expect(keepDraft(store, id, original.automation, HAND)).toEqual({ error: "not-found" });

    ok(setDeleted(store, id, false));
    expect(
      store.journal
        .automations()
        .map((a) => a.id)
        .sort(),
    ).toEqual([id, copy.id].sort());
    expect(ok(automationView(store, id))).toEqual(original);
    expect(setDeleted(store, "a_nadie", true)).toEqual({ error: "not-found" });
  });

  it("AU-05 · the places of the boxes are kept apart from the draft: placing steps changes no rev and makes no test stale, a step with no place has no entry, and a step the draft no longer has loses its place", async () => {
    const { id, step, doc } = made();
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: {} }, JUAN));
    ok(
      placeSteps(store, id, [
        { step: step("Inicio"), x: 0, y: 0 },
        { step: step("Marcar"), x: 600, y: 0 },
      ]),
    );
    ok(placeSteps(store, id, [{ step: step("Marcar"), x: 640, y: 80 }]));
    const view = ok(automationView(store, id));
    expect(view.rev).toBe(1);
    expect(Object.values(view.tests).some((t) => t.stale)).toBe(false);
    expect(view.places).toEqual(
      [
        { step: step("Inicio"), x: 0, y: 0 },
        { step: step("Marcar"), x: 640, y: 80 },
      ].sort((a, b) => (a.step < b.step ? -1 : 1)),
    );
    // A step the draft lacks is refused, and nothing is placed.
    expect(placeSteps(store, id, [{ step: "s_nadie", x: 1, y: 1 }])).toEqual({
      error: "bad-request",
    });
    expect(placeSteps(store, id, [{ step: step("Buscar"), x: Number.NaN, y: 1 }])).toEqual({
      error: "bad-request",
    });

    // «Marcar» taken away: its place and its test go with it.
    const without = {
      ...doc,
      steps: doc.steps.filter((s) => s.name !== "Marcar"),
      arrows: doc.arrows.filter((a) => a.to.step !== step("Marcar")),
    };
    ok(keepDraft(store, id, without, HAND));
    const after = ok(automationView(store, id));
    expect(after.places.map((p) => p.step)).toEqual([step("Inicio")]);
    expect(Object.keys(after.tests).sort()).toEqual([step("Inicio"), step("Buscar")].sort());
  });

  // The list is Boni's collection of flows extended with a row per automation (flowsCollection.ts); its page is
  // `FlowsView.tsx`. A flow of before is saved as its own routes save it (store.journal.saveFlow).
  const flowOfBefore = (
    id: string,
    name: string,
    more: Partial<Parameters<UserStore["journal"]["saveFlow"]>[0]> = {},
  ) =>
    store.journal.saveFlow({
      id,
      name,
      trigger: { manual: true, inputs: [] },
      inputs: [],
      plan: { version: 1, steps: [] },
      layout: null,
      by: "user",
      enabled: false,
      created: NOW - 5_000,
      ...more,
    });
  const listed = () => flowsCollection(store);
  const F = SYS.flows;
  const optionName = (field: string, id: unknown) =>
    listed()
      .type.fields.find((f) => f.id === field)
      ?.options?.find((o) => o.id === id)?.name;

  it("AU-61 · the collection «Automatizaciones» has six columns (name, what starts it, state, last run, runs, whose); an automation of the new format says «Sin publicar» with no runs, and one with no trigger says none", () => {
    const { id } = made();
    const empty = ok(createAutomation(store, draft([], [], "Sin empezar").doc, HAND));
    const { type, rows } = listed();
    expect(type.fields.map((f) => f.name)).toEqual([
      "Nombre",
      "Se inicia",
      "Estado",
      "Última ejecución",
      "Ejecuciones",
      "De",
    ]);
    expect(type.fields.find((f) => f.id === F.state)?.options?.map((o) => o.name)).toEqual([
      "Encendida",
      "Apagada",
      "Sin publicar",
    ]);
    const row = (a: string) => rows.find((r) => r.id === `${F.automation}${a}`);
    expect(row(id)?.values[F.title]).toBe("Revisar gastos");
    expect(optionName(F.trigger, row(id)?.values[F.trigger])).toBe("Disparado por el usuario");
    expect(row(id)?.values[F.state]).toBe(F.unpublished);
    expect(row(id)?.values[F.runs]).toBe(0);
    expect(row(id)?.values[F.last]).toBeUndefined();
    expect(row(id)?.values[F.by]).toBe(F.user);
    expect(optionName(F.trigger, row(empty.id)?.values[F.trigger])).toBe("—");
    // The name and the trigger are kept at each save: a rename and a trigger taken away show at once.
    const d = { ...ok(automationView(store, id)).automation };
    ok(
      keepDraft(
        store,
        id,
        { ...d, name: "Gastos grandes", steps: d.steps.filter((s) => s.type !== "manual") },
        HAND,
      ),
    );
    expect(listed().rows.find((r) => r.id === `${F.automation}${id}`)?.values[F.title]).toBe(
      "Gastos grandes",
    );
    expect(
      optionName(
        F.trigger,
        listed().rows.find((r) => r.id === `${F.automation}${id}`)?.values[F.trigger],
      ),
    ).toBe("—");
    // Deleted: out of the list; restored: back.
    setDeleted(store, id, true);
    expect(listed().rows.map((r) => r.id)).toEqual([`${F.automation}${empty.id}`]);
    setDeleted(store, id, false);
    expect(listed().rows).toHaveLength(2);
  });

  it("AU-61 · with a thousand automations and flows the list answers within its time (A-15): no draft is parsed to list it", () => {
    const one = reviewing().doc;
    store.journal.automations();
    for (let i = 0; i < 1000; i++)
      ok(createAutomation(store, { ...one, name: `Automatización ${i}` }, HAND));
    for (let i = 0; i < 40; i++) flowOfBefore(`f_${i}`, `Flujo ${i}`, { enabled: i % 2 === 0 });
    const read = vi.spyOn(store.journal, "automationDraft");
    const sys = () =>
      withFlows(store, systemCollections(store, { now: NOW, tz: JUAN.zone, usdToEur: 0.9 }));
    // Once to warm, then as the app asks for it: the rows of the collection's page.
    listRows(store, SYS_FLOWS, sys());
    const start = cpu();
    const page = listRows(store, SYS_FLOWS, sys());
    const ms = cpu() - start;
    timing("the list with 1000 automations and 40 flows (listRows, CPU)", ms);
    expect(page.rows).toHaveLength(1040);
    expect(read).not.toHaveBeenCalled();
    under(ms, 250, "cpu", "the list with 1000 automations and 40 flows");
    read.mockRestore();
  });

  it("AU-60 · Boni's collection of automations says «Automatizaciones» in its name and in what it tells an assistant; the internal names (flows.*, flows_*) stay until F16", () => {
    const { type } = listed();
    expect(type.name).toBe("Automatizaciones");
    // Its key and its fields' ids stay: a saved view or filter keeps working.
    expect(type.key).toBe("flujos");
    expect(type.id).toBe(F.id);
    // The actions keep their names and say automation in their titles (what «Buscar» and a card show).
    const flows = ACTIONS.all().filter((t) => t.name.startsWith("flows."));
    expect(flows.length).toBeGreaterThan(3);
    for (const t of flows) expect(t.title, t.name).not.toMatch(/flujo/i);
    for (const t of ACTIONS.all().filter((x) => x.name.startsWith("automations.")))
      expect(t.title, t.name).toMatch(/automatización/);
    expect(mcpToolNames().filter((n) => n.startsWith("flows_"))).toEqual([
      "flows_describe",
      "flows_propose",
      "flows_test",
      "flows_runs",
    ]);
  });

  it("AU-60 · the MCP's texts (the guide and the descriptions of the flows_* tools) say automation where they said flow; the tools keep their names until F16", async () => {
    const answer = (await mcpAnswer(store, "d_asistente", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    })) as { result: { tools: { name: string; description: string; inputSchema: unknown }[] } };
    const tools = answer.result.tools;
    // Prose only: the tools' names, the argument «flow» and the code «by: flow» are names, not words.
    const prose = (t: { description: string; inputSchema: unknown }) =>
      `${t.description} ${JSON.stringify(t.inputSchema)}`
        .replace(/flows_[a-z]+/g, "")
        .replace(/"flow"|\bflow:|by: flow/g, "");
    for (const t of tools.filter((x) => x.name.startsWith("flows_"))) {
      expect(t.description, t.name).toMatch(/automation/);
      expect(prose(t), t.name).not.toMatch(/\bflows?\b/i);
    }
    for (const t of tools) expect(prose(t), t.name).not.toMatch(/\bflows?\b/i);
  });

  it("AU-61 · a flow of before says «Encendida» or «Apagada» and only it does; «De» says whose each is (the user's, Boni's or a page's, with the page's name); with no automation and no flow the collection has no rows", () => {
    expect(listed().rows).toEqual([]);
    ensureSystemTypes(store);
    const page = createPage(store, { title: "Gastos" });
    flowOfBefore("mio", "Apuntar tarea");
    flowOfBefore("de-boni", "Leer correo", { by: "preset", enabled: true });
    flowOfBefore("chat", "Conversación", { trigger: { chat: { page: page.id } }, enabled: true });
    const { id } = made();
    const { rows } = listed();
    const by = (row: string) => optionName(F.by, rows.find((r) => r.id === row)?.values[F.by]);
    const state = (row: string) =>
      optionName(F.state, rows.find((r) => r.id === row)?.values[F.state]);
    expect(state(`${F.row}de-boni`)).toBe("Encendida");
    expect(state(`${F.row}mio`)).toBe("Apagada");
    expect(state(`${F.automation}${id}`)).toBe("Sin publicar");
    expect(by(`${F.row}mio`)).toBe("Tú");
    expect(by(`${F.row}de-boni`)).toBe("Boni");
    expect(by(`${F.row}chat`)).toBe("Página «Gastos»");
    expect(by(`${F.automation}${id}`)).toBe("Tú");
    // Only the flows of before are on or off.
    expect(
      rows.filter((r) => r.values[F.state] !== F.unpublished).every((r) => r.id.startsWith(F.row)),
    ).toBe(true);
  });

  it("AU-61 · the map lists the flows of before and no automation of the new format, which does not run until it is published (F14d)", () => {
    flowOfBefore("mio", "Apuntar tarea");
    const { id } = made(draft([["Inicio", "manual"]], [], "Nueva automatización"));
    const map = JSON.stringify(
      flowMap(store, { now: NOW, days: 7, tz: JUAN.zone, mailType: null, mailAccount: null }),
    );
    expect(map).toContain("Apuntar tarea");
    expect(map).not.toContain(id);
    expect(map).not.toContain("Nueva automatización");
  });

  it("AU-151 · the list has the flows of before and the automations side by side, each saying its format; a flow of before still saves, turns on and off and runs through its own routes, untouched by this phase", () => {
    flowOfBefore("mio", "Apuntar tarea");
    const { id } = made();
    const { rows } = listed();
    // Side by side: the automations first, then the flows of before; each row says which it is by its id.
    expect(rows.map((r) => [automationRowTarget(r.id), flowRowTarget(r.id)])).toEqual([
      [id, null],
      [null, "mio"],
    ]);
    // A flow of before changes as it always did, by its own functions; the automation is not touched.
    updateFlowRow(store, `${F.row}mio`, { [F.title]: "Apuntar una tarea" }, () => [], NOW);
    updateFlowRow(store, `${F.row}mio`, { [F.state]: F.on }, () => [], NOW);
    expect(store.journal.flow("mio")).toMatchObject({
      name: "Apuntar una tarea",
      enabled: true,
      version: 2,
    });
    expect(ok(automationView(store, id)).rev).toBe(1);
    // A row of an automation is changed in its editor, never by the table: its name and state are fixed there.
    const table = listRows(
      store,
      SYS_FLOWS,
      withFlows(store, systemCollections(store, { now: NOW, tz: JUAN.zone, usdToEur: 0.9 })),
    );
    expect(table.rows.find((r) => r.id === `${F.automation}${id}`)?.fixed).toEqual([
      F.title,
      F.state,
    ]);
    // «Eliminar» from the table is the automation's own, and its Undo.
    deleteAutomationRow(store, `${F.automation}${id}`, true);
    expect(store.journal.automation(id)?.deleted).toBe(true);
    deleteAutomationRow(store, `${F.automation}${id}`, false);
    expect(store.journal.automation(id)?.deleted).toBe(false);
    expect(() => deleteAutomationRow(store, `${F.automation}a_nadie`, true)).toThrow(DataError);
  });
});

// ---------------------------------------------------------------- the real Collections and the real Policy

const collections = () =>
  storeCollections(store, { actor: "user", device: HAND.device, zone: JUAN.zone, own: SEED });

describe("the real Collections and the real Policy", () => {
  it("AU-04 · a row read from the store knows its record and the version it was read at, and a change to a row that changed since is refused whole", async () => {
    const c = collections();
    const [libro] = await c.find({
      collection: "gasto",
      where: [{ field: "importe", op: "gt", value: 10 }],
      sort: [],
      limit: 10,
      related: false,
    });
    if (!libro?.origin) throw new Error("no row");
    const saved = store.get(libro.origin.id);
    expect(libro.origin).toEqual({
      collection: "gasto",
      id: saved?.entity.id,
      version: saved?.entity.version,
    });
    expect(libro.json.concepto).toBe("libro");

    // Juan changes it elsewhere; the automation's change, made from what it read, is refused and writes nothing.
    store.update(
      libro.origin.id,
      { [fieldId("importe")]: { value: 20, label: SEED } },
      { actor: "user", device: "d_telefono" },
    );
    const before = opLog();
    const change = {
      kind: "update" as const,
      row: libro.origin,
      fields: { concepto: "revisado", importe: 1 },
    };
    const refused = await c.apply(change, {}).catch((e) => e);
    expect(refused).toBeInstanceOf(StepFault);
    expect((refused as StepFault).failure.code).toBe("row.changed");
    expect(opLog()).toBe(before);
    expect(store.get(libro.origin.id)?.entity.values[fieldId("concepto")]).toBe("libro");

    // Read again, at its version, the same change is done.
    const again = await c.get("gasto", libro.origin.id);
    if (!again?.origin) throw new Error("no row");
    const written = await c.apply({ ...change, row: again.origin }, {});
    expect(written.json).toMatchObject({ concepto: "revisado", importe: 1 });
    expect(written.origin.version).toBe(again.origin.version + 1);
  });

  it("AU-174 · a step's changes are written in one transaction: two on one row apply in order, and when the last is refused none of them was saved", async () => {
    const c = collections();
    const [one, two] = await c.find({
      collection: "gasto",
      where: [],
      sort: [],
      limit: 10,
      related: false,
    });
    if (!one?.origin || !two?.origin) throw new Error("no rows");
    const count = store.list(GASTO).length;
    store.update(
      two.origin.id,
      { [fieldId("importe")]: { value: 30, label: SEED } },
      { actor: "user", device: "d_telefono" },
    );
    const before = opLog();
    const changes = (last: NonNullable<typeof two.origin>): ChangeWith[] => [
      {
        change: {
          kind: "create" as const,
          collection: "gasto",
          fields: { concepto: "nuevo", importe: 3 },
        },
        values: {},
      },
      {
        change: { kind: "update" as const, row: one.origin, fields: { concepto: "uno" } },
        values: {},
      },
      { change: { kind: "update" as const, row: one.origin, fields: { importe: 2 } }, values: {} },
      { change: { kind: "update" as const, row: last, fields: { concepto: "dos" } }, values: {} },
    ];
    const refused = await c.applyAll(changes(two.origin)).catch((e) => e);
    expect(refused).toBeInstanceOf(StepFault);
    expect((refused as StepFault).failure.code).toBe("row.changed");
    expect(opLog()).toBe(before);
    expect(store.list(GASTO)).toHaveLength(count);
    expect(store.get(one.origin.id)?.entity.version).toBe(one.origin.version);

    // Read again, all of them are saved, the two on one row in the order asked.
    const again = await c.get("gasto", two.origin.id);
    if (!again?.origin) throw new Error("no row");
    const written = await c.applyAll(changes(again.origin));
    expect(written.map((r) => r.json.concepto)).toEqual(["nuevo", "uno", "uno", "dos"]);
    expect(written[2]?.json).toMatchObject({ concepto: "uno", importe: 2 });
    expect(written[2]?.origin.version).toBe(one.origin.version + 2);
    expect(store.list(GASTO)).toHaveLength(count + 1);
  });

  it("AU-162 · a row read from the store has its record's label and each field that differs its own: a value that came from outside is still from outside in the row, field by field", async () => {
    const [cafe] = store.list(GASTO).filter((e) => e.entity.values[fieldId("concepto")] === "café");
    if (!cafe) throw new Error("no café");
    store.update(
      cafe.entity.id,
      { [fieldId("concepto")]: { value: "café del correo", label: OUTSIDE } },
      { actor: "agent" },
    );
    const rows = await collections().find({
      collection: "gasto",
      where: [],
      sort: [],
      limit: 10,
      related: false,
    });
    const row = rows.find((r) => r.origin.id === cafe.entity.id);
    if (!row) throw new Error("no row");
    const asRow = { ...row, path: null, parent: null };
    expect(cellOf(asRow, ["concepto"])?.label.integrity).toBe("external");
    expect(cellOf(asRow, ["concepto"])?.label.sources).toEqual(OUTSIDE.sources);
    expect(cellOf(asRow, ["importe"])?.label.integrity).toBe("imported");
    expect(cellOf(asRow, ["fecha"])?.label.integrity).toBe("imported");
    // The rows that have the same label share one object (3,000 rows do not make 3,000 labels).
    bulk(5);
    const more = await collections().find({
      collection: "gasto",
      where: [],
      sort: [],
      limit: 50,
      related: false,
    });
    const byLabel = new Map<string, unknown[]>();
    for (const r of more)
      byLabel.set(JSON.stringify(r.label), [
        ...(byLabel.get(JSON.stringify(r.label)) ?? []),
        r.label,
      ]);
    const shared = [...byLabel.values()].filter((ls) => ls.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const ls of shared) expect(ls.every((l) => l === ls[0])).toBe(true);
  });

  it("AU-164 · rows read from the store come in the same order twice (the sort, then the id), and a search with conditions over thousands of rows is one query, timed (A-15)", async () => {
    bulk(3000);
    let lists = 0;
    const counted = new Proxy(store, {
      get(target, key, receiver) {
        if (key === "list") lists++;
        if (key === "get") throw new Error("a search reads no record one by one");
        return Reflect.get(target, key, receiver);
      },
    });
    const c = storeCollections(counted, {
      actor: "user",
      device: HAND.device,
      zone: JUAN.zone,
      own: SEED,
    });
    const query = {
      collection: "gasto",
      where: [
        { field: "importe", op: "gt" as const, value: 50 },
        { field: "fecha", op: "after" as const, value: "2026-10-09" },
      ],
      sort: [{ field: "importe", direction: "desc" as const }],
      limit: 5000,
      related: false,
    };
    const start = cpu();
    const first = await c.find(query);
    const ms = cpu() - start;
    timing("a search with two conditions over 3,000 rows", ms);
    expect(lists).toBe(1);
    expect(first.length).toBeGreaterThan(500);
    expect(
      first.every((r) => Number(r.json.importe) > 50 && String(r.json.fecha) >= "2026-10-10"),
    ).toBe(true);
    // By the sort, then by id.
    for (let i = 1; i < first.length; i++) {
      const [a, b] = [first[i - 1], first[i]];
      const d = Number(a?.json.importe) - Number(b?.json.importe);
      expect(d > 0 || (d === 0 && String(a?.origin.id) < String(b?.origin.id))).toBe(true);
    }
    const second = await c.find(query);
    expect(second.map((r) => r.origin.id)).toEqual(first.map((r) => r.origin.id));
    under(ms, 1500, "cpu", "a search with two conditions over 3,000 rows");
  }, 120_000);

  it("AU-19 · for each action of «Colección» the real policy answers what decide answers for the list's action that does the same to a record, with the same labelled arguments and origin: the trash is asked about (P5)", () => {
    // Each act is told to the policy as the list's action it mirrors: the same effect, roles, undo and confirmation.
    for (const [act, tool] of Object.entries(ACTS)) {
      const listed = ACTIONS.get(tool.name);
      if (!listed) throw new Error(`no action ${tool.name}`);
      expect(tool.effect, act).toBe(listed.effect);
      expect(tool.area, act).toBe(listed.area);
      expect(tool.alwaysConfirm ?? false, act).toBe(listed.alwaysConfirm ?? false);
      expect(tool.undo ?? [], act).toEqual(listed.undo ?? []);
      for (const [arg, spec] of Object.entries(tool.args))
        expect(listed.args[arg]?.role, `${act}.${arg}`).toBe(spec.role);
    }
    const own = automationLabel("a_ejemplo");
    const call = (over: Partial<PolicyCall>): PolicyCall => ({
      automation: { id: "a_ejemplo", version: 0 },
      step: "s_ejemplo",
      type: "collection",
      action: "find",
      effect: "read",
      destroys: false,
      collection: "gasto",
      values: {},
      control: null,
      test: true,
      ...over,
    });
    const juan = label("user", "personal", [{ kind: "user-edit", id: "device:d_portatil" }]);
    const calls: Record<string, PolicyCall> = {
      find: call({ values: { "where.0": { value: 10, label: juan, derived: false } } }),
      get: call({
        action: "get",
        values: { id: { value: "e_ejemplo", label: own, derived: false } },
      }),
      create: call({
        action: "create",
        effect: "write",
        values: { concepto: { value: "café", label: juan, derived: false } },
      }),
      createFromOutside: call({
        action: "create",
        effect: "write",
        values: { concepto: { value: "café", label: OUTSIDE, derived: false } },
      }),
      update: call({
        action: "update",
        effect: "write",
        rows: 1,
        values: { concepto: { value: "revisado", label: own, derived: false } },
      }),
      updateUnderOutside: call({
        action: "update",
        effect: "write",
        rows: 1,
        control: OUTSIDE,
        values: { concepto: { value: "revisado", label: own, derived: false } },
      }),
      trash: call({ action: "trash", effect: "write", destroys: true, rows: 1 }),
    };
    const origins: Origin[] = [
      { kind: "hand", trust: "personal", device: "d_portatil" },
      { kind: "turn", trust: "personal" },
      { kind: "turn", trust: "shared" },
      { kind: "background", trust: "ambient" },
      { kind: "assistant", trust: "personal" },
      { kind: "miniapp", trust: "personal" },
    ];
    const seen = new Set<string>();
    for (const origin of origins)
      for (const [what, c] of Object.entries(calls)) {
        const real = runPolicy(origin, own).decide(c);
        const listed = ACTIONS.get(ACTS[actOf(c)].name);
        if (!listed) throw new Error("no action");
        const same = decide(
          {
            tool: listed,
            args: argsOf(c, own),
            control: c.control,
            flow: true,
            dry: c.test,
            ...(c.rows !== undefined ? { rows: c.rows } : {}),
          },
          origin,
          { writes: 0, sensitiveReads: 0 } as Parameters<typeof decide>[2],
        );
        expect(real, `${origin.kind}/${origin.trust} ${what}`).toEqual(same);
        seen.add(`${what}:${real.kind}`);
      }
    // Not one answer for everything: the trash is asked about where it is not Juan's own tap.
    expect(
      runPolicy({ kind: "turn", trust: "personal" }, own).decide(calls.trash as PolicyCall).kind,
    ).toBe("confirm");
    expect(seen.size).toBeGreaterThan(Object.keys(calls).length);
  });

  it("AU-195 · the same published version with the same input gets the same decision for every write (allow, propose, confirm, deny) started by hand and started by its trigger: for each act of `ACTS`, each label of value and of path and each cell, by a table written in the test", () => {
    // Who starts a run is no input of the policy: the service builds it with `automationPolicy` from the stored
    // version alone (runDeps), and so will the scheduler (S2). One answer per row, by hand or alone.
    const own = automationLabel("a_ejemplo");
    const juan = label("user", "personal", [{ kind: "user-edit", id: "device:d_portatil" }]);
    const model = label("model", "public", [{ kind: "model", id: "r_ejemplo" }]);
    const doc = (action: string, permission: "yes" | "ask"): Automation =>
      ({
        format: FORMAT,
        id: "a_ejemplo",
        version: 3,
        name: "Ejemplo",
        steps: [
          {
            id: "s_ejemplo",
            name: "Guardar",
            type: "collection",
            params: { collection: "gasto", action, permission },
          },
        ],
        arrows: [],
        settings: {},
      }) as unknown as Automation;
    const call = (
      act: string,
      value: Label | null,
      path: Label | null,
      test: boolean,
    ): PolicyCall => ({
      automation: { id: "a_ejemplo", version: 3 },
      step: "s_ejemplo",
      type: "collection",
      action: act,
      effect: "write",
      destroys: act === "trash",
      collection: "gasto",
      values: value ? { concepto: { value: "café", label: value, derived: true } } : {},
      control: path,
      ...(act === "create" ? {} : { rows: 1 }),
      test,
    });
    const L = { juan, OUTSIDE, model } as const;
    // [act, value, path, cell, answer]
    const table: [string, keyof typeof L | null, keyof typeof L | null, "yes" | "ask", string][] = [
      ["create", "juan", null, "yes", "allow P28"],
      ["create", "juan", null, "ask", "propose P28"],
      ["create", "OUTSIDE", null, "yes", "allow P28"],
      ["create", "OUTSIDE", null, "ask", "propose P28"],
      ["create", "model", null, "yes", "propose P28"],
      ["create", "model", null, "ask", "propose P28"],
      ["create", "juan", "OUTSIDE", "yes", "allow P28"],
      ["create", "juan", "OUTSIDE", "ask", "propose P28"],
      ["create", "juan", "model", "yes", "propose P28"],
      ["update", "juan", null, "yes", "allow P28"],
      ["update", "juan", null, "ask", "propose P28"],
      ["update", "OUTSIDE", null, "yes", "allow P28"],
      ["update", "OUTSIDE", null, "ask", "propose P28"],
      ["update", "model", null, "yes", "propose P28"],
      ["update", "juan", "OUTSIDE", "yes", "allow P28"],
      ["update", "OUTSIDE", "OUTSIDE", "ask", "propose P28"],
      ["update", "juan", "model", "yes", "propose P28"],
      ["trash", null, null, "yes", "allow P28"],
      ["trash", null, null, "ask", "confirm P5"],
      ["trash", null, "OUTSIDE", "yes", "allow P28"],
      ["trash", null, "OUTSIDE", "ask", "confirm P5"],
      ["trash", null, "model", "yes", "propose P28"],
      ["trash", null, "model", "ask", "propose P28"],
    ];
    for (const [act, value, path, cell, answer] of table) {
      const c = call(act, value ? L[value] : null, path ? L[path] : null, false);
      const byHand = automationPolicy(doc(act, cell), own).decide(c);
      const alone = automationPolicy(doc(act, cell), own).decide(c);
      const row = `${act} ${value} ${path} ${cell}`;
      expect(`${byHand.kind} ${byHand.rule}`, row).toBe(answer);
      expect(alone, row).toEqual(byHand);
      // The «Sí» is read from the version kept, never from the call: another version is no «Sí» (AU-188).
      const other = automationPolicy({ ...doc(act, cell), version: 4 }, own).decide(c);
      if (cell === "yes" && answer === "allow P28") expect(other.kind, row).not.toBe("allow");
    }
  });

  it("AU-186 · `consentOf` gives the published version's cell for a collection and action, and the server reads it from the version as saved: a «Sí» claimed by the box's answer or a browser is not one", () => {
    const step = {
      id: "s_ejemplo",
      name: "Código",
      type: "code",
      params: { source: "$col('Gastos').remove('x')\nreturn []", mode: "all" },
      connections: [
        {
          collection: "gasto",
          read: {},
          create: false,
          update: { mode: "ask" },
          remove: { mode: "yes" },
        },
      ],
    };
    const doc = {
      format: FORMAT,
      id: "a_ejemplo",
      version: 2,
      name: "Ejemplo",
      steps: [step],
      arrows: [],
      settings: {},
    } as unknown as Automation;
    const call = (over: Partial<PolicyCall>): PolicyCall => ({
      automation: { id: "a_ejemplo", version: 2 },
      step: "s_ejemplo",
      type: "code",
      action: "trash",
      effect: "write",
      destroys: true,
      collection: "gasto",
      values: {},
      control: null,
      rows: 1,
      test: false,
      ...over,
    });
    const yes = consentIn(doc);
    expect(yes(call({}))).toBe(true);
    // Another action, collection, step, version or automation; a read; no document: no «Sí».
    expect(yes(call({ action: "update", destroys: false }))).toBe(false);
    expect(yes(call({ action: "create", destroys: false, rows: undefined }))).toBe(false);
    expect(yes(call({ collection: "nota" }))).toBe(false);
    expect(yes(call({ step: "s_otro" }))).toBe(false);
    expect(yes(call({ automation: { id: "a_ejemplo", version: 3 } }))).toBe(false);
    expect(yes(call({ automation: { id: "a_otra", version: 2 } }))).toBe(false);
    expect(yes(call({ effect: "read", destroys: false }))).toBe(false);
    expect(consentIn(undefined)(call({}))).toBe(false);
    // What the box or a browser says cannot reach it: a call carries no «Sí» of its own, whatever extra it holds.
    const claimed = { ...call({ action: "update", destroys: false }), yes: true } as PolicyCall;
    expect(yes(claimed)).toBe(false);
    expect(automationPolicy(doc, automationLabel("a_ejemplo")).decide(claimed).kind).toBe(
      "propose",
    );
  });

  it("AU-195 · each act of an automation (`ACTS`) is answered for `automation`, dry and not, and for `accepted`, by a table written in the test: no origin is left to a default", () => {
    const own = automationLabel("a_ejemplo");
    const juan = label("user", "personal", [{ kind: "user-edit", id: "device:d_portatil" }]);
    const base = {
      automation: { id: "a_ejemplo", version: 0 },
      step: "s_ejemplo",
      type: "collection",
      collection: "gasto",
      control: null,
    };
    const calls: Record<keyof typeof ACTS, Omit<PolicyCall, "test">> = {
      query: { ...base, action: "find", effect: "read", destroys: false, values: {} },
      get: {
        ...base,
        action: "get",
        effect: "read",
        destroys: false,
        values: { id: { value: "e_ejemplo", label: own, derived: false } },
      },
      create: {
        ...base,
        action: "create",
        effect: "write",
        destroys: false,
        values: { concepto: { value: "café", label: juan, derived: false } },
      },
      update: {
        ...base,
        action: "update",
        effect: "write",
        destroys: false,
        rows: 1,
        values: { concepto: { value: "revisado", label: juan, derived: false } },
      },
      trash: { ...base, action: "trash", effect: "write", destroys: true, rows: 1, values: {} },
    };
    // With no «Sí»: [act, automation in a test, automation for real, accepted on a personal device]
    const table: [keyof typeof ACTS, string, string, string][] = [
      ["query", "allow P1", "allow P1", "allow P1"],
      ["get", "allow P1", "allow P1", "allow P1"],
      ["create", "propose P28", "propose P28", "allow P1"],
      ["update", "propose P28", "propose P28", "allow P1"],
      ["trash", "confirm P5", "confirm P5", "confirm P5"],
    ];
    expect(table.map(([act]) => act).sort()).toEqual(Object.keys(ACTS).sort());
    const accepted: Origin = { kind: "accepted", trust: "personal" };
    for (const [act, dry, real, acc] of table) {
      const say = (d: { kind: string; rule: string }) => `${d.kind} ${d.rule}`;
      expect(say(automationPolicy(undefined, own).decide({ ...calls[act], test: true })), act).toBe(
        dry,
      );
      expect(
        say(automationPolicy(undefined, own).decide({ ...calls[act], test: false })),
        act,
      ).toBe(real);
      expect(say(runPolicy(accepted, own).decide({ ...calls[act], test: false })), act).toBe(acc);
    }
  });

  it("AU-168 · one policy per run counts over the whole run: the policy's own limit of writes stops a test that would write past it", async () => {
    // By Juan's hand the policy answers P25 and counts nothing (his tap is the confirmation): a run that is not his
    // hand is where the limit is, so the test is run as a turn of his would be.
    bulk(30);
    const own = automationLabel("a_ejemplo");
    const d = draft(
      [
        ["Inicio", "manual"],
        [
          "Buscar",
          "collection",
          { collection: "gasto", action: "find", where: [], sort: [], limit: 100 },
        ],
        [
          "Marcar",
          "collection",
          {
            collection: "gasto",
            action: "update",
            target: "incoming",
            fields: [{ field: "concepto", value: "x" }],
          },
          { onError: "continue" },
        ],
      ],
      [
        ["Inicio", "Buscar"],
        ["Buscar", "Marcar"],
      ],
    );
    const a = { ...d.doc, id: "a_ejemplo" };
    const policy = runPolicy({ kind: "turn", trust: "personal" }, own);
    const before = opLog();
    const e = await runTest(
      {
        automation: a,
        trigger: d.id("Inicio"),
        fields: { json: {}, label: own },
        prints: stepPrints(a, {}, (t) => t),
      },
      {
        policy,
        collections: collections(),
        clock: { now: () => NOW, zone: JUAN.zone, sleep: async () => {} },
        dates: serverDates,
        own,
        locale: "es",
      },
    );
    const marcar = e.steps[d.id("Marcar")];
    // 33 rows; the run's limit lets 20 through, and the rest wait for Juan: none is written.
    expect(marcar?.in.main).toBe(33);
    expect(marcar?.out.main).toHaveLength(20);
    expect(marcar?.asked).toBe(13);
    expect(e.asked).toHaveLength(13);
    expect(policy.count.writes).toBe(20);
    expect(opLog()).toBe(before);
  });
});

// ---------------------------------------------------------------- «Probar» and «Probar paso»

const tested = async (id: string, request: Parameters<typeof testAutomation>[2]) =>
  ok(await testAutomation(store, id, request, JUAN)) as TestAnswer;

describe("«Probar» and «Probar paso»", () => {
  it("AU-90 · «Probar» reads and computes for real on the store and writes nothing: the operation log is as long after it as before, nothing is proposed or notified and no run is left in the journal", async () => {
    bulk(3000);
    const { id, step } = made();
    const log = opLog();
    const values = store.list(GASTO).map((e) => JSON.stringify(e.entity.values));
    const start = cpu();
    const answer = await tested(id, { trigger: step("Inicio"), fields: { minimo: 10 } });
    timing(
      "«Probar» of «Buscar» → «Marcar» over 3,000 rows (reads, would-writes, kept)",
      cpu() - start,
    );
    expect(answer.state).toBe("done");
    // It read for real: every «Gasto» over 10, sorted.
    const over = store
      .list(GASTO)
      .filter((e) => Number(e.entity.values[fieldId("importe")]) > 10).length;
    expect(answer.tests[step("Buscar")]?.out.main).toBe(over);
    expect(answer.tests[step("Marcar")]?.wouldWrite).toBe(over);
    // And wrote nothing, proposed nothing and left no run.
    expect(opLog()).toBe(log);
    expect(store.list(GASTO).map((e) => JSON.stringify(e.entity.values))).toEqual(values);
    expect(store.journal.proposals()).toEqual([]);
    expect(store.journal.runs()).toEqual([]);
  }, 120_000);

  it("AU-90 · a step that would write gives the row it would make, with the saved row as it is now for «Haría esto», and what follows goes on with it", async () => {
    const d = draft(
      [
        ["Inicio", "manual"],
        [
          "Buscar",
          "collection",
          {
            collection: "gasto",
            action: "find",
            where: [{ field: "importe", op: "gt", value: 10 }],
            sort: [],
            limit: 10,
          },
        ],
        [
          "Marcar",
          "collection",
          {
            collection: "gasto",
            action: "update",
            target: "incoming",
            fields: [{ field: "concepto", value: "revisado" }],
          },
        ],
        [
          "Nuevo",
          "collection",
          {
            collection: "gasto",
            action: "create",
            fields: [
              { field: "concepto", value: "nuevo" },
              { field: "importe", value: 1 },
            ],
          },
        ],
        ["Después", "edit", { fields: [{ field: "visto", value: "sí" }] }],
      ],
      [
        ["Inicio", "Buscar"],
        ["Buscar", "Marcar"],
        ["Marcar", "Después"],
        ["Inicio", "Nuevo"],
      ],
    );
    const { id, step } = made(d);
    const answer = await tested(id, { trigger: step("Inicio"), fields: {} });
    expect(answer.state).toBe("done");
    const out = ok(
      testRows(store, id, {
        step: step("Marcar"),
        side: "out",
        name: "main",
        offset: 0,
        limit: 50,
      }),
    );
    expect(out.total).toBe(1);
    expect(out.rows[0]).toMatchObject({
      json: { concepto: "revisado", importe: 18 },
      would: "update",
      before: { concepto: "libro", importe: 18, fecha: "2026-11-04" },
    });
    const created = ok(
      testRows(store, id, { step: step("Nuevo"), side: "out", name: "main", offset: 0, limit: 50 }),
    );
    expect(created.rows[0]).toMatchObject({
      json: { concepto: "nuevo", importe: 1 },
      would: "create",
      before: null,
    });
    // What follows goes on with the row as it would be.
    const after = ok(
      testRows(store, id, {
        step: step("Después"),
        side: "out",
        name: "main",
        offset: 0,
        limit: 50,
      }),
    );
    expect(after.rows[0]?.json).toMatchObject({ concepto: "revisado", visto: "sí" });
    expect(after.rows[0]?.would).toBeUndefined();
    // The saved one is as it was.
    const libro = store.list(GASTO).find((e) => e.entity.values[fieldId("importe")] === 18);
    expect(libro?.entity.values[fieldId("concepto")]).toBe("libro");
  });

  it("AU-91 · «Probar paso» runs that step and what it lacks, takes the rest from the kept tests, and answers which ran and which were reused; the kept test of a step that did not run is untouched", async () => {
    const { id, step, doc } = made();
    const first = await tested(id, { trigger: step("Inicio"), fields: { minimo: 5 } });
    expect(first.ran).toEqual([step("Inicio"), step("Buscar"), step("Marcar")]);
    const keptBuscar = store.journal.automationTests(id).find((t) => t.step === step("Buscar"));

    // «Marcar» changes, and is tested alone, later: «Inicio» and «Buscar» are taken as they were.
    const changed = structuredClone(doc);
    const marcar = changed.steps.find((s) => s.name === "Marcar");
    if (!marcar) throw new Error("no step");
    marcar.params.fields = [{ field: "concepto", value: "visto" }];
    ok(keepDraft(store, id, changed, HAND));
    let reads = 0;
    const realList = store.list.bind(store);
    store.list = ((...args: Parameters<UserStore["list"]>) => {
      reads++;
      return realList(...args);
    }) as UserStore["list"];
    const second = ok(
      await testAutomation(
        store,
        id,
        { trigger: step("Inicio"), fields: { minimo: 5 }, step: step("Marcar") },
        { ...JUAN, now: NOW + 60_000 },
      ),
    ) as TestAnswer;
    expect(second.ran).toEqual([step("Marcar")]);
    expect(second.reused).toEqual([step("Inicio"), step("Buscar")]);
    expect(reads).toBe(0);
    expect(store.journal.automationTests(id).find((t) => t.step === step("Buscar"))).toEqual(
      keptBuscar,
    );
    const rows = ok(
      testRows(store, id, { step: step("Marcar"), side: "out", name: "main", offset: 0, limit: 1 }),
    );
    expect(rows.rows[0]?.json.concepto).toBe("visto");
    expect(second.tests[step("Marcar")]?.at).toBe(NOW + 60_000);
    expect(second.tests[step("Buscar")]?.at).toBe(NOW);

    // Other fields for the trigger: its print changes, so everything runs again.
    const third = await tested(id, {
      trigger: step("Inicio"),
      fields: { minimo: 7 },
      step: step("Marcar"),
    });
    expect(third.ran).toEqual([step("Inicio"), step("Buscar"), step("Marcar")]);
    expect(third.reused).toEqual([]);
  });

  it("AU-91 · «Probar paso» of the last step over 3,000 rows of 40 fields takes the steps before it from their kept tests within its time, timed (A-15)", async () => {
    bulk(3000);
    // «Ampliar» gives each row (a title and three fields) 36 fields more: «Marcar» reads 3,003 rows of 40 fields.
    const extra = Array.from({ length: 36 }, (_, i) => ({
      field: `campo_${i}`,
      value: `un valor de ejemplo ${i}`,
    }));
    const d = draft(
      [
        ["Inicio", "manual"],
        [
          "Buscar",
          "collection",
          { collection: "gasto", action: "find", where: [], sort: [], limit: 5000 },
        ],
        ["Ampliar", "edit", { fields: extra }],
        ["Marcar", "edit", { fields: [{ field: "visto", value: true }] }],
      ],
      [
        ["Inicio", "Buscar"],
        ["Buscar", "Ampliar"],
        ["Ampliar", "Marcar"],
      ],
    );
    const { id, step } = made(d);
    let start = cpu();
    const whole = await tested(id, { trigger: step("Inicio"), fields: {} });
    const all = cpu() - start;
    timing("«Probar» of four steps over 3,003 rows of 40 fields (CPU)", all);
    expect(whole.state).toBe("done");
    // About 0.9 s of CPU on the laptop (2026-11-16); the bound has room for CI's slower machines.
    under(all, 4000, "cpu", "«Probar» of four steps over 3,003 rows");
    expect(whole.tests[step("Ampliar")]?.out.main).toBe(3003);
    start = cpu();
    const last = await tested(id, { trigger: step("Inicio"), fields: {}, step: step("Marcar") });
    const ms = cpu() - start;
    timing(
      "«Probar paso» of the last step, reusing three kept tests of 3,003 rows of up to 40 fields (CPU)",
      ms,
    );
    expect(last.ran).toEqual([step("Marcar")]);
    expect(last.reused).toEqual([step("Inicio"), step("Buscar"), step("Ampliar")]);
    const [row] = ok(
      testRows(store, id, { step: step("Marcar"), side: "out", name: "main", offset: 0, limit: 1 }),
    ).rows;
    expect(Object.keys(row?.json ?? {})).toHaveLength(41);
    // About 0.7 s of CPU on the laptop (2026-11-16), near half of it reading the 6,007 kept rows back (`recordOf`);
    // the bound has room for CI's slower machines.
    under(ms, 3000, "cpu", "«Probar paso» of the last step over kept tests");
  }, 120_000);

  it("AU-92 · a save of the draft answers the steps whose kept test is stale, and the view marks them; moving a box or renaming a step marks none", async () => {
    // 300 steps: «Inicio», «Buscar» and a chain of 298 «Editar campos».
    bulk(3000);
    const chain: [string, string, Record<string, unknown>][] = Array.from(
      { length: 298 },
      (_, i) => [`Paso ${i + 1}`, "edit", { fields: [{ field: `campo${i + 1}`, value: i + 1 }] }],
    );
    const d = draft(
      [
        ["Inicio", "manual"],
        [
          "Buscar",
          "collection",
          { collection: "gasto", action: "find", where: [], sort: [], limit: 50 },
        ],
        ...chain,
      ],
      [
        ["Inicio", "Buscar"],
        ["Buscar", "Paso 1"],
        ...chain.slice(1).map((c, i) => [`Paso ${i + 1}`, c[0]] as [string, string]),
      ],
    );
    const { id, step, doc } = made(d);
    expect(doc.steps).toHaveLength(300);
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: {} }, JUAN));

    // Moving a box and renaming a step (its citations rewritten) make nothing stale.
    ok(placeSteps(store, id, [{ step: step("Paso 5"), x: 10, y: 10 }]));
    const renamed = renameStep(doc, step("Paso 5"), "Quinto");
    expect(ok(keepDraft(store, id, renamed, HAND)).stale).toEqual([]);

    // A parameter of «Paso 150» changes: it and every step after it are stale, the ones before are not.
    const changed = structuredClone(renamed);
    const p150 = changed.steps.find((s) => s.name === "Paso 150");
    if (!p150) throw new Error("no step");
    p150.params.fields = [{ field: "campo150", value: "otro" }];
    const start = cpu();
    const saved = ok(keepDraft(store, id, changed, HAND));
    const ms = cpu() - start;
    timing("a save of a draft of 300 steps, with the stale steps it answers", ms);
    const expected = Array.from({ length: 149 }, (_, i) => step(`Paso ${i + 150}`)).sort();
    expect(saved.stale).toEqual(expected);
    const view = ok(automationView(store, id));
    expect(
      Object.entries(view.tests)
        .filter(([, t]) => t.stale)
        .map(([s]) => s)
        .sort(),
    ).toEqual(expected);
    under(ms, 1000, "cpu", "a save of a draft of 300 steps");
  }, 120_000);

  it("AU-94 · a test of «Disparado por el usuario» takes the fields it declares, labelled as Juan's from his device: one it lacks is null, one it does not declare is refused, and the view offers the last ones again, read from the row the trigger gave in its kept test", async () => {
    const d = draft(
      [
        [
          "Inicio",
          "manual",
          {
            fields: [
              { key: "minimo", name: "Mínimo", type: "number" },
              { key: "nota", name: "Nota", type: "text" },
            ],
          },
        ],
      ],
      [],
    );
    const { id, step } = made(d);
    const answer = await tested(id, { trigger: step("Inicio"), fields: { minimo: 12 } });
    expect(answer.state).toBe("done");
    const [row] = ok(
      testRows(store, id, { step: step("Inicio"), side: "out", name: "main", offset: 0, limit: 1 }),
    ).rows;
    expect(row?.json).toEqual({ minimo: 12, nota: null });
    expect(row?.label).toEqual(
      label("user", "personal", [{ kind: "user-edit", id: "device:d_portatil" }]),
    );
    expect(ok(automationView(store, id)).tested).toEqual({
      [step("Inicio")]: { minimo: 12, nota: null },
    });

    // A field it does not declare: nothing runs and nothing kept changes.
    const refused = await tested(id, { trigger: step("Inicio"), fields: { otro: 1 } });
    expect(refused.state).toBe("invalid");
    expect(refused.ran).toEqual([]);
    expect(ok(automationView(store, id)).tested).toEqual({
      [step("Inicio")]: { minimo: 12, nota: null },
    });
  });

  it("AU-115 · an automation is tested by hand whatever its trigger: the test starts in the trigger named, with the fields that trigger declares", async () => {
    const d = draft(
      [
        ["Desde el móvil", "manual", { fields: [{ key: "a", name: "A", type: "text" }] }],
        ["Desde el portátil", "manual", { fields: [{ key: "b", name: "B", type: "number" }] }],
        ["Juntar", "edit", { fields: [{ field: "visto", value: true }] }],
      ],
      [
        ["Desde el móvil", "Juntar"],
        ["Desde el portátil", "Juntar"],
      ],
    );
    const { id, step } = made(d);
    const answer = await tested(id, { trigger: step("Desde el portátil"), fields: { b: 2 } });
    expect(answer.state).toBe("done");
    expect(answer.ran).toEqual([step("Desde el portátil"), step("Juntar")]);
    expect(answer.tests[step("Desde el móvil")]).toBeUndefined();
    const [row] = ok(
      testRows(store, id, { step: step("Juntar"), side: "out", name: "main", offset: 0, limit: 1 }),
    ).rows;
    expect(row?.json).toEqual({ b: 2, visto: true });
    // The other trigger's field is not this one's.
    expect(
      (await tested(id, { trigger: step("Desde el portátil"), fields: { a: "x" } })).state,
    ).toBe("invalid");
    expect(
      await testAutomation(store, id, { trigger: step("Juntar"), fields: {} }, JUAN),
    ).toMatchObject({ state: "invalid" });
  });

  it("AU-64 · an automation with problems is not tested: the answer is invalid with each problem's step and parameter, and nothing kept changes", async () => {
    const { id, step, doc } = made();
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: {} }, JUAN));
    const kept = store.journal.automationTests(id);
    const broken = structuredClone(doc);
    const buscar = broken.steps.find((s) => s.name === "Buscar");
    if (!buscar) throw new Error("no step");
    delete buscar.params.collection;
    ok(keepDraft(store, id, broken, HAND));
    const keptAfterSave = store.journal.automationTests(id);
    const answer = await tested(id, { trigger: step("Inicio"), fields: {} });
    expect(answer.state).toBe("invalid");
    expect(answer.ran).toEqual([]);
    expect(
      answer.problems.some(
        (p) => p.step === step("Buscar") && p.param === "collection" && p.severity === "error",
      ),
    ).toBe(true);
    expect(store.journal.automationTests(id)).toEqual(keptAfterSave);
    expect(keptAfterSave).toEqual(kept);
  });

  it("AU-67 · after a test every step the trigger reaches has its state and its rows in and out by output, an unconnected output too; a step that failed says why and the ones that hung from it are skipped", async () => {
    const d = draft(
      [
        ["Inicio", "manual"],
        [
          "Buscar",
          "collection",
          { collection: "gasto", action: "find", where: [], sort: [], limit: 10 },
        ],
        ["Si", "if", { where: [{ field: "importe", op: "gt", value: 10 }] }],
        ["Caros", "edit", { fields: [{ field: "caro", value: true }] }],
        [
          "Leer",
          "collection",
          { collection: "gasto", action: "get", row: "e_00000000000000000000000000" },
        ],
        ["Tras leer", "edit", { fields: [{ field: "x", value: 1 }] }],
      ],
      [
        ["Inicio", "Buscar"],
        ["Buscar", "Si"],
        ["Si", "Caros", "yes"],
        ["Caros", "Leer"],
        ["Leer", "Tras leer"],
      ],
    );
    const { id, step } = made(d);
    const answer = await tested(id, { trigger: step("Inicio"), fields: {} });
    const t = answer.tests;
    expect(t[step("Buscar")]).toMatchObject({ state: "done", in: { main: 1 }, out: { main: 3 } });
    // «no» goes nowhere: its count is still there.
    expect(t[step("Si")]).toMatchObject({ state: "done", in: { main: 3 }, out: { yes: 1, no: 2 } });
    expect(t[step("Caros")]).toMatchObject({ state: "done", in: { main: 1 }, out: { main: 1 } });
    expect(answer.state).toBe("failed");
    expect(answer.failedAt).toBe(step("Leer"));
    expect(t[step("Leer")]?.state).toBe("failed");
    expect(t[step("Leer")]?.error?.failure?.code).toBe("row.missing");
    // The run stops at the failure: the step that hung from it was not decided, «stopped» («parado», AU-67).
    expect(t[step("Tras leer")]?.state).toBe("stopped");
    expect(t[step("Tras leer")]?.out).toEqual({});
  });

  it("AU-71 · the rows that came into a step are served 50 at a time with their total, each with its label and the fields that came from outside", async () => {
    bulk(120);
    const [cafe] = store.list(GASTO).filter((e) => e.entity.values[fieldId("concepto")] === "café");
    if (!cafe) throw new Error("no café");
    store.update(
      cafe.entity.id,
      { [fieldId("concepto")]: { value: "café del correo", label: OUTSIDE } },
      { actor: "agent" },
    );
    const { id, step } = made();
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: {} }, JUAN));
    const into = (offset: number, limit = 50) =>
      ok(testRows(store, id, { step: step("Marcar"), side: "in", name: "main", offset, limit }));
    const total = ok(automationView(store, id)).tests[step("Marcar")]?.in.main ?? 0;
    expect(total).toBeGreaterThan(ROWS_PAGE * 2);
    const pages = [into(0), into(50), into(100)];
    expect(pages.map((p) => p.total)).toEqual([total, total, total]);
    expect(pages.map((p) => p.rows.length)).toEqual([50, 50, total - 100]);
    // Never more than a page, whatever is asked.
    expect(into(0, 500).rows).toHaveLength(ROWS_PAGE);
    // The same rows «Buscar» gave, in its order.
    const out = ok(
      testRows(store, id, {
        step: step("Buscar"),
        side: "out",
        name: "main",
        offset: 50,
        limit: 50,
      }),
    );
    expect(pages[1]?.rows).toEqual(out.rows);
    const all = pages.flatMap((p) => p.rows);
    expect(all.every((r) => r.label.integrity === "imported")).toBe(true);
    // «Café» is under 10 and not here; «Libro» is, all its own. A field from outside is marked as such.
    const ownMarked = all.filter((r) => r.fields);
    expect(ownMarked).toEqual([]);
    bulk(0);
    store.update(
      (
        store.list(GASTO).find((e) => e.entity.values[fieldId("concepto")] === "libro") as {
          entity: { id: string };
        }
      ).entity.id,
      { [fieldId("concepto")]: { value: "libro del correo", label: OUTSIDE } },
      { actor: "agent" },
    );
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: {} }, JUAN));
    const marked = [into(0), into(50), into(100)]
      .flatMap((p) => p.rows)
      .filter((r) => r.fields?.concepto);
    expect(marked.map((r) => [r.json.concepto, r.fields?.concepto?.integrity])).toEqual([
      ["libro del correo", "external"],
    ]);
  });

  it("AU-72 · the rows of each output of a step are served 50 at a time from the kept chunks: a page of a test of 3,000 rows does not read the other rows, timed (A-15)", async () => {
    bulk(3000);
    const d = draft(
      [
        ["Inicio", "manual"],
        [
          "Buscar",
          "collection",
          { collection: "gasto", action: "find", where: [], sort: [], limit: 5000 },
        ],
      ],
      [["Inicio", "Buscar"]],
    );
    const { id, step } = made(d);
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: {} }, JUAN));
    const total = 3003;
    // Each output's rows are kept in chunks of 50.
    expect(store.journal.automationTestRows(id, step("Buscar"), "main", 0, 10_000)).toHaveLength(
      total,
    );
    // Timed over 100 pages, as one is under the clock's grain.
    const start = cpu();
    for (let i = 0; i < 100; i++)
      testRows(store, id, {
        step: step("Buscar"),
        side: "out",
        name: "main",
        offset: (i * 29) % 2950,
        limit: 50,
      });
    const ms = (cpu() - start) / 100;
    timing("a page of 50 rows of a kept test of 3,003 rows (mean of 100)", ms);
    const page = ok(
      testRows(store, id, {
        step: step("Buscar"),
        side: "out",
        name: "main",
        offset: 2950,
        limit: 50,
      }),
    );
    expect(page.total).toBe(total);
    expect(page.rows).toHaveLength(50);
    // The last page: what is left.
    expect(
      ok(
        testRows(store, id, {
          step: step("Buscar"),
          side: "out",
          name: "main",
          offset: 3000,
          limit: 50,
        }),
      ).rows,
    ).toHaveLength(3);
    // One chunk read for a page that falls in one: the store's read is by chunk.
    let parsed = 0;
    const realParse = JSON.parse;
    JSON.parse = ((text: string, ...rest: []) => {
      parsed += text.length;
      return realParse(text, ...rest);
    }) as typeof JSON.parse;
    try {
      testRows(store, id, {
        step: step("Buscar"),
        side: "out",
        name: "main",
        offset: 1500,
        limit: 50,
      });
    } finally {
      JSON.parse = realParse;
    }
    const keptRecords = store.journal.automationTests(id).reduce((n, t) => n + t.record.length, 0);
    const oneChunk = JSON.stringify(
      store.journal.automationTestRows(id, step("Buscar"), "main", 1500, 50),
    ).length;
    expect(parsed).toBeLessThan((oneChunk + keptRecords) * 3);
    under(ms, 20, "cpu", "a page of 50 rows of a kept test of 3,003 rows (mean of 100)");
  }, 120_000);

  it("AU-84 · a step that fails because of a parameter names it: the error carries the parameter's path as validation writes one", async () => {
    const [libro] = store
      .list(GASTO)
      .filter((e) => e.entity.values[fieldId("concepto")] === "libro");
    if (!libro) throw new Error("no libro");
    store.remove(libro.entity.id, { actor: "user" });
    const d = draft(
      [
        ["Inicio", "manual"],
        ["Leer", "collection", { collection: "gasto", action: "get", row: libro.entity.id }],
      ],
      [["Inicio", "Leer"]],
    );
    const { id, step } = made(d);
    const answer = await tested(id, { trigger: step("Inicio"), fields: {} });
    expect(answer.state).toBe("failed");
    expect(answer.tests[step("Leer")]?.error?.failure).toMatchObject({
      code: "row.missing",
      param: "row",
    });
    // Kept: the editor reads it again from the view.
    expect(ok(automationView(store, id)).tests[step("Leer")]?.error?.failure?.param).toBe("row");
  });

  it("the sample of a step («Probar paso»'s expressions) is its first row in and, for each step before it, the row it comes from and the first and last", async () => {
    const { id, step } = made();
    ok(await testAutomation(store, id, { trigger: step("Inicio"), fields: { minimo: 1 } }, JUAN));
    const sample = ok(testSample(store, id, step("Marcar")));
    const buscar = ok(
      testRows(store, id, {
        step: step("Buscar"),
        side: "out",
        name: "main",
        offset: 0,
        limit: 50,
      }),
    );
    expect(sample.total).toBe(buscar.total);
    expect(sample.current).toEqual(buscar.rows[0]);
    expect(sample.steps.Buscar?.item).toEqual(buscar.rows[0]);
    expect(sample.steps.Buscar?.first).toEqual(buscar.rows[0]);
    expect(sample.steps.Buscar?.last).toEqual(buscar.rows[buscar.total - 1]);
    // Each row «Buscar» gives comes from «Inicio»'s one row.
    expect(sample.steps.Inicio?.item?.json).toEqual({ minimo: 1 });
    expect(sample.steps.Inicio?.first?.json).toEqual({ minimo: 1 });
    expect(sample.steps.Marcar).toBeUndefined();
    expect(testSample(store, id, "s_nadie")).toEqual({ error: "bad-request" });
  });
});
