// «Automatizaciones» over HTTP in C1, C2 and E of F14b (docs/automatizaciones.md §7, AU-168, AU-62, AU-05, AU-90,
// AU-91): the six routes C1 adds, C2's layout («Ordenar» and a box dropped) and E's «Probar» with the rows and the
// sample of its last test, as the app calls them, each running its action through `runAction` (actions.ts in this
// folder). Without the list of actions each is refused by the policy (P0) before anything runs, the read too. What
// an origin that is not Juan's hand reads is in automations.test.ts.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, fakePlanner, type Origin, ToolRegistry } from "@boni/agent";
import { FORMAT } from "@boni/automations";
import { startBox } from "@boni/sandbox-runner/src/server.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIONS, ROUTE_ACTIONS, ROUTE_RUNS } from "../actions.ts";
import { AgentHost } from "../agent.ts";
import { addUser } from "../auth.ts";
import { type Db, openDb } from "../db.ts";
import { Feeds } from "../feeds.ts";
import { type App, makeApp, serve } from "../http.ts";
import { LoginGuard } from "../limits.ts";
import { ROUTES } from "../routes.ts";
import { AUTOMATION_ACTIONS, AUTOMATION_ROUTES } from "./routes.ts";
import { PREVIEW_CHARS } from "./service.ts";

const SIGN_IN = "una contraseña larga de ejemplo";
/** C1's and C2's routes (E's are checked with every route of AUTOMATION_ROUTES in automations.test.ts). */
const EDITOR = [
  "POST /api/agent/automations",
  "GET /api/agent/automations/:id",
  "PUT /api/agent/automations/:id/draft",
  "PUT /api/agent/automations/:id/layout",
  "POST /api/agent/automations/:id/duplicate",
  "DELETE /api/agent/automations/:id",
  "POST /api/agent/automations/:id/restore",
];
let dir: string;
let db: Db;
let host: AgentHost;
const apps: { app: App; server: Server }[] = [];

async function start(actions?: ToolRegistry): Promise<string> {
  const app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
    write: true,
    ...(actions ? { actions } : {}),
  });
  const server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  apps.push({ app, server });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-automations-routes-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", SIGN_IN);
  const planner = fakePlanner([]);
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
});
afterAll(async () => {
  for (const a of apps) await new Promise((r) => a.server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const first = {
  format: FORMAT,
  id: "",
  version: 0,
  name: "Nueva automatización",
  steps: [{ id: "s_inicio", name: "Disparado por el usuario", type: "manual", params: {} }],
  arrows: [],
  settings: {},
};

describe("C1's and C2's routes (AU-168, AU-62, AU-05)", () => {
  it("AU-168 · C1's routes are in ROUTES as tailnet and in ROUTE_RUNS with their action; with a list of actions that lacks them each is refused (403, P0) before anything runs, the read too", async () => {
    for (const route of EDITOR) {
      expect(ROUTES[route], route).toBe("tailnet");
      const { action } = AUTOMATION_ROUTES[route] as { action: string };
      expect(ACTIONS.get(action)?.name, route).toBe(action);
      if (!route.startsWith("GET ")) {
        expect(ROUTE_RUNS[route], route).toBe(action);
        expect(ROUTE_ACTIONS[route], route).toEqual([action]);
      }
    }
    const call = await signedIn(await start(new ToolRegistry()));
    const before = host.store(1).journal.automations().length;
    expect(await call("POST", "/api/agent/automations", { automation: first })).toEqual({
      status: 403,
      body: { error: "policy", rule: "P0" },
    });
    expect((await call("GET", "/api/agent/automations/a_nadie")).status).toBe(403);
    expect(host.store(1).journal.automations()).toHaveLength(before);
  });

  it("AU-168 · an action that changes an automation is Juan's touch: his hand runs it, and an assistant, a flow and work in the background are refused by the policy", () => {
    const changing = Object.entries(AUTOMATION_ACTIONS)
      .filter(([name, a]) => a.effect === "touch" && ACTIONS.get(name))
      .map(([name]) => name);
    expect(changing.length).toBeGreaterThanOrEqual(5);
    const origins: Origin[] = [
      { kind: "assistant", trust: "personal", device: "d_asistente" },
      { kind: "background", trust: "personal" },
      { kind: "miniapp", trust: "personal" },
    ];
    for (const name of changing) {
      const tool = ACTIONS.get(name);
      expect(tool?.effect, name).toBe("touch");
      const at = (origin: Origin, flow = false) =>
        decide({ tool, args: {}, control: null, flow }, origin, { writes: 0, sensitiveReads: 0 })
          .kind;
      expect(at({ kind: "hand", trust: "personal", device: "d_portatil" }), name).toBe("allow");
      for (const o of origins) expect(at(o), `${name} ${o.kind}`).toBe("deny");
      // A flow is work in the background: refused too.
      expect(at({ kind: "background", trust: "personal" }, true), name).toBe("deny");
    }
  });

  it("AU-62 · create, read, keep the draft and its boxes, duplicate, delete and restore, as the editor calls them", async () => {
    const call = await signedIn(await start());
    const made = await call("POST", "/api/agent/automations", { automation: first });
    expect(made.status).toBe(200);
    const id = made.body.id as string;
    expect(id).toMatch(/^a_/);
    expect(made.body.rev).toBe(1);
    const read = await call("GET", `/api/agent/automations/${id}`);
    expect((read.body.automation as { name: string }).name).toBe("Nueva automatización");
    const renamed = { ...first, id, name: "Revisar gastos" };
    expect(
      await call("PUT", `/api/agent/automations/${id}/draft`, { automation: renamed }),
    ).toEqual({ status: 200, body: { rev: 2, stale: [] } });
    expect(
      (await call("PUT", `/api/agent/automations/${id}/draft`, { automation: { nada: 1 } })).status,
    ).toBe(400);
    // Where the boxes are (AU-05): kept apart from the draft, whose rev does not move; a step it lacks is refused.
    const step = first.steps[0]?.id as string;
    expect(
      await call("PUT", `/api/agent/automations/${id}/layout`, {
        places: [{ step, x: 40, y: 80 }],
      }),
    ).toEqual({ status: 200, body: { ok: true } });
    const placed = await call("GET", `/api/agent/automations/${id}`);
    expect(placed.body.places).toEqual([{ step, x: 40, y: 80 }]);
    expect(placed.body.rev).toBe(2);
    expect(
      (
        await call("PUT", `/api/agent/automations/${id}/layout`, {
          places: [{ step: "s_nadie", x: 0, y: 0 }],
        })
      ).status,
    ).toBe(400);
    const copy = await call("POST", `/api/agent/automations/${id}/duplicate`, {
      name: "Revisar gastos (copia)",
    });
    expect((copy.body.automation as { name: string }).name).toBe("Revisar gastos (copia)");
    expect(copy.body.id).not.toBe(id);
    expect(await call("DELETE", `/api/agent/automations/${id}`)).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect((await call("GET", `/api/agent/automations/${id}`)).status).toBe(404);
    expect((await call("POST", `/api/agent/automations/${id}/restore`)).status).toBe(200);
    expect((await call("GET", `/api/agent/automations/${id}`)).status).toBe(200);
    expect((await call("GET", "/api/agent/automations/a_nadie")).status).toBe(404);
  });

  it("AU-90 · «Probar», «Probar paso», the rows and the sample, as the editor calls them", async () => {
    const call = await signedIn(await start());
    const doc = {
      ...first,
      name: "Probar por HTTP",
      steps: [
        {
          id: "s_inicio",
          name: "Inicio",
          type: "manual",
          params: { fields: [{ key: "nota", name: "Nota", type: "text" }] },
        },
        {
          id: "s_marcar",
          name: "Marcar",
          type: "edit",
          params: { fields: [{ field: "visto", value: true }] },
        },
      ],
      arrows: [
        { from: { step: "s_inicio", output: "main" }, to: { step: "s_marcar", input: "main" } },
      ],
    };
    const made = await call("POST", "/api/agent/automations", { automation: doc });
    const id = made.body.id as string;
    const path = `/api/agent/automations/${id}`;
    const log = host.store(1).logPage(0, 1_000_000).length;

    const tested = await call("POST", `${path}/test`, {
      trigger: "s_inicio",
      fields: { nota: "de ejemplo" },
    });
    expect(tested.status).toBe(200);
    expect(tested.body).toMatchObject({ state: "done", ran: ["s_inicio", "s_marcar"], reused: [] });
    expect(
      (tested.body.tests as Record<string, { out: { main: number } }>).s_marcar?.out.main,
    ).toBe(1);
    // «Probar paso»: that step alone, the trigger's test reused.
    const one = await call("POST", `${path}/test`, {
      trigger: "s_inicio",
      fields: { nota: "de ejemplo" },
      step: "s_marcar",
    });
    expect(one.body).toMatchObject({ state: "done", ran: ["s_marcar"], reused: ["s_inicio"] });
    // A test writes in no collection.
    expect(host.store(1).logPage(0, 1_000_000).length).toBe(log);

    const out = await call("GET", `${path}/test/rows?step=s_marcar&side=out&name=main`);
    expect(out.status).toBe(200);
    expect(out.body.total).toBe(1);
    expect((out.body.rows as { json: unknown }[])[0]?.json).toEqual({
      nota: "de ejemplo",
      visto: true,
    });
    const into = await call("GET", `${path}/test/rows?step=s_marcar&side=in&name=main&offset=0`);
    expect((into.body.rows as { json: unknown }[])[0]?.json).toEqual({ nota: "de ejemplo" });
    expect(
      (await call("GET", `${path}/test/rows?step=s_marcar&side=out&name=main&offset=5`)).body,
    ).toEqual({ rows: [], total: 1 });
    const sample = await call("GET", `${path}/test/sample?step=s_marcar`);
    expect(sample.status).toBe(200);
    expect(sample.body).toMatchObject({ current: { json: { nota: "de ejemplo" } }, total: 1 });
    expect(Object.keys(sample.body.steps as object)).toEqual(["Inicio"]);

    // What the app may get wrong is worded as before: 400 for a request that is not one, 404 for what is not there.
    expect((await call("POST", `${path}/test`, { trigger: "s_inicio" })).status).toBe(400);
    expect(
      (await call("POST", `${path}/test`, { trigger: "s_inicio", fields: { otra: 1 } })).body,
    ).toMatchObject({ state: "invalid" });
    expect(
      (await call("GET", `${path}/test/rows?step=s_marcar&side=arriba&name=main`)).status,
    ).toBe(400);
    expect(
      (await call("GET", `${path}/test/rows?step=s_marcar&side=out&name=main&offset=-3`)).status,
    ).toBe(400);
    expect((await call("GET", `${path}/test/rows?step=s_marcar&side=out&name=otra`)).status).toBe(
      400,
    );
    expect((await call("GET", `${path}/test/rows?step=s_nadie&side=out&name=main`)).status).toBe(
      404,
    );
    expect((await call("GET", `${path}/test/sample?step=s_nadie`)).status).toBe(400);
    expect((await call("GET", `${path}/test/sample`)).status).toBe(400);
    expect(
      (
        await call("POST", "/api/agent/automations/a_nadie/test", {
          trigger: "s_inicio",
          fields: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("GET", "/api/agent/automations/a_nadie/test/sample?step=s_inicio")).status,
    ).toBe(404);
  });

  it("AU-23 AU-27 · the line under an expression as the editor asks it: `GET …/test/preview` with the text being typed, worked out by the real box with the row the test kept, and the draft's own value without it", async () => {
    const box = await startBox(join(dir, "caja.sock"), { workers: 1 });
    const was = process.env.BONI_SANDBOX_SOCKET;
    process.env.BONI_SANDBOX_SOCKET = join(dir, "caja.sock");
    try {
      const call = await signedIn(await start());
      const doc = {
        ...first,
        name: "Vista previa por HTTP",
        steps: [
          {
            id: "s_inicio",
            name: "Inicio",
            type: "manual",
            params: { fields: [{ key: "nota", name: "Nota", type: "text" }] },
          },
          {
            id: "s_marcar",
            name: "Marcar",
            type: "edit",
            params: {
              fields: [{ field: "grande", value: { expr: "{{ $json.nota.toUpperCase() }}" } }],
            },
          },
        ],
        arrows: [
          { from: { step: "s_inicio", output: "main" }, to: { step: "s_marcar", input: "main" } },
        ],
      };
      const made = await call("POST", "/api/agent/automations", { automation: doc });
      const path = `/api/agent/automations/${made.body.id as string}`;
      const ask = (q: Record<string, string>) =>
        call(
          "GET",
          `${path}/test/preview?${new URLSearchParams({ step: "s_marcar", param: "fields.0.value", row: "0", ...q })}`,
        );

      // Before a test there is nothing to work it out with: it says which step to test, and asks the box nothing.
      expect((await ask({})).body).toEqual({ state: "untested", steps: ["s_inicio"] });
      const tested = await call("POST", `${path}/test`, {
        trigger: "s_inicio",
        fields: { nota: "de ejemplo" },
      });
      expect(tested.body).toMatchObject({ state: "done" });
      const log = host.store(1).logPage(0, 1_000_000).length;

      // The draft's own value is what the test gave; the text being typed, before it is kept, is worked out in its place.
      expect((await ask({})).body).toEqual({ state: "value", value: "DE EJEMPLO", row: 0, of: 1 });
      expect((await ask({ expr: "{{ $json.nota.split(' ').length }} palabras" })).body).toEqual({
        state: "value",
        value: "2 palabras",
        row: 0,
        of: 1,
      });
      // One past the last row is the last.
      expect((await ask({ expr: "{{ $json.nota.length * 2 }}", row: "5" })).body).toEqual({
        state: "value",
        value: 20,
        row: 0,
        of: 1,
      });
      // What the code threw is said with its code, its message as it is (plain text for the screen).
      const threw = await ask({ expr: "{{ $json.nada.toUpperCase() }}" });
      expect(threw.body).toMatchObject({ state: "failed", failure: { code: "code.threw" } });
      // A preview keeps nothing: neither the draft nor any collection changed.
      expect(host.store(1).logPage(0, 1_000_000).length).toBe(log);
      expect(((await call("GET", path)).body.automation as typeof doc).steps[1]?.params).toEqual(
        doc.steps[1]?.params,
      );

      // What the app may get wrong is a bad request: a value the step has not, a row that is not one, a text too long.
      expect((await ask({ param: "fields.7.value", expr: "{{ 1 }}" })).status).toBe(400);
      expect((await ask({ row: "-1" })).status).toBe(400);
      expect((await ask({ expr: "x".repeat(PREVIEW_CHARS + 1) })).status).toBe(400);
      expect(
        (
          await call(
            "GET",
            "/api/agent/automations/a_nadie/test/preview?step=s_marcar&param=fields.0.value",
          )
        ).status,
      ).toBe(404);
    } finally {
      if (was === undefined) delete process.env.BONI_SANDBOX_SOCKET;
      else process.env.BONI_SANDBOX_SOCKET = was;
      await box.close();
    }
  });
});
