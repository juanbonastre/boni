import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { label, newId } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";

/**
 * Boni over the screen (docs/sistema.md §4.7, F9, part five): what Juan asks to see, opened, filtered, lit or scrolled
 * to by the actions of the list, over HTTP with a scripted planner (no model, no network), on collections shaped like
 * his (generated ids, fields named in Spanish with accents). Nothing is written, and only his own turn moves his
 * screen (P22).
 */
const PASSWORD = "una contraseña larga de ejemplo";
const lit = (v: unknown) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
const servers: Server[] = [];
let base: string;
const plans: unknown[] = [];
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
const MOV = newId("t");
const F = { concepto: newId("f"), categoria: newId("f"), fecha: newId("f") };
const RESTAURANTES = newId("o");
const COMIDA = newId("o");
const AGENDA = newId("t");
const A = { titulo: newId("f"), dia: newId("f") };
const NOW = Date.UTC(2026, 10, 12, 9, 0);

async function login() {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-ejemplo" }),
  });
  return ((await r.json()) as { token: string }).token;
}
const post = async (token: string, path: string, body: unknown = {}) =>
  (await (
    await fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  ).json()) as Record<string, unknown>;
type Turn = {
  run: string;
  status: string;
  error: string | null;
  changed?: boolean;
  replies: { component: string; data: Record<string, unknown> }[];
  notices?: { code: string; rule?: string }[];
  pending: { kind: string; id: string; view: { rows: unknown[] } } | null;
};
const turnOf = async (token: string, text: string, steps: unknown[], screen?: unknown) => {
  plans.push({ version: 1, steps });
  return (await post(token, "/api/agent/turn", {
    text,
    ...(screen ? { screen } : {}),
  })) as unknown as Turn;
};
/** A reply's data as the app reads it: the painted values' plain contents. */
const flat = (v: unknown): unknown => {
  if (!v || typeof v !== "object") return v;
  const x = v as {
    t?: string;
    value?: unknown;
    items?: unknown[];
    fields?: Record<string, unknown>;
  };
  if (x.t === "v") return x.value;
  if (x.t === "list") return (x.items ?? []).map(flat);
  if (x.t === "rec")
    return Object.fromEntries(Object.entries(x.fields ?? {}).map(([k, f]) => [k, flat(f)]));
  return Object.fromEntries(Object.entries(v).map(([k, f]) => [k, flat(f)]));
};
const replyOf = (t: Turn, component: string) => {
  const r = t.replies.find((x) => x.component === component);
  return r && { component, data: flat(r.data) as Record<string, unknown> };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-screen-actions-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  const planner = fakePlanner([]);
  planner.complete = async () => ({
    json: plans.shift(),
    usage: { input: 1, output: 1 },
    model: "fake",
  });
  host = new AgentHost({
    dataDir: dir,
    providers: { planner, reader: planner },
    now: () => NOW,
    tz: "Europe/Madrid",
  });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  const s = serve(app, "tailnet");
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const store = host.store(1);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: MOV,
        key: "movimientos",
        name: "Movimientos",
        fields: [
          { id: F.concepto, key: "concepto", name: "Concepto", type: "text", label: own },
          {
            id: F.categoria,
            key: "categoria",
            name: "Categoría",
            type: "select",
            options: [
              { id: COMIDA, name: "Comida", label: own },
              { id: RESTAURANTES, name: "Restaurantes", label: own },
            ],
            label: own,
          },
          { id: F.fecha, key: "fecha", name: "Fecha", type: "date", label: own },
        ],
        titleField: F.concepto,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: AGENDA,
        key: "agenda",
        name: "Agenda",
        fields: [
          { id: A.titulo, key: "titulo", name: "Título", type: "text", label: own },
          { id: A.dia, key: "dia", name: "Día", type: "date", label: own },
        ],
        titleField: A.titulo,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  for (const [titulo, dia] of [
    ["Dentista", "2026-11-12"],
    ["Llamar al banco", "2026-11-12"],
    ["Cumpleaños de ejemplo", "2026-11-20"],
  ])
    store.create(
      AGENDA,
      { [A.titulo]: { value: titulo, label: own }, [A.dia]: { value: dia, label: own } },
      { actor: "user", device: "portatil-ejemplo" },
    );
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Boni over the screen: open, filter, light, scroll (docs/sistema.md §4.7, F9)", () => {
  it("«enséñame los movimientos de restaurantes de octubre»: the collection opened filtered, by ids, and nothing written", async () => {
    const token = await login();
    const t = await turnOf(token, "enséñame los movimientos de restaurantes de octubre", [
      {
        id: "f",
        op: "call",
        tool: "screen.filter",
        args: {
          collection: lit("movimientos"),
          where: lit({
            categoria: "Restaurantes",
            fecha: { after: "2026-09-30", before: "2026-11-01" },
          }),
          caption: lit("Restaurantes de octubre"),
        },
      },
    ]);
    expect([t.status, t.error]).toEqual(["done", null]);
    expect(replyOf(t, "filter")?.data).toEqual({
      collection: "movimientos",
      rules: [
        { field: F.categoria, op: "is", value: RESTAURANTES },
        { field: F.fecha, op: "after", value: "2026-09-30" },
        { field: F.fecha, op: "before", value: "2026-11-01" },
      ],
      caption: "Restaurantes de octubre",
    });
    // A screen act writes nothing: no operation, no «Deshacer».
    expect(host.store(1).log({ run: t.run })).toEqual([]);
    expect(t.changed).toBeFalsy();
    // «o» (task 75): a group of rules, one of which holds, beside the rules that all hold.
    const or = await turnOf(token, "los de comida o restaurantes de octubre", [
      {
        id: "f",
        op: "call",
        tool: "screen.filter",
        args: {
          collection: lit("movimientos"),
          where: lit({
            or: [{ categoria: "Comida" }, { categoria: "Restaurantes" }],
            fecha: { after: "2026-09-30" },
          }),
        },
      },
    ]);
    expect(replyOf(or, "filter")?.data).toEqual({
      collection: "movimientos",
      rules: [
        {
          join: "or",
          rules: [
            { field: F.categoria, op: "is", value: COMIDA },
            { field: F.categoria, op: "is", value: RESTAURANTES },
          ],
        },
        { field: F.fecha, op: "after", value: "2026-09-30" },
      ],
    });
    // A group of one rule, or a rule of the group with two ops, is refused: one level, one rule each.
    for (const where of [
      { or: [{ categoria: "Comida" }] },
      { or: [{ categoria: "Comida" }, { fecha: { after: "2026-09-30", before: "2026-11-01" } }] },
    ]) {
      const off = await turnOf(token, "los de comida", [
        {
          id: "f",
          op: "call",
          tool: "screen.filter",
          args: { collection: lit("movimientos"), where: lit(where) },
        },
      ]);
      expect(replyOf(off, "filter")).toBeUndefined();
    }
    // A value the collection does not have is refused, never guessed.
    const bad = await turnOf(token, "los de viajes", [
      {
        id: "f",
        op: "call",
        tool: "screen.filter",
        args: { collection: lit("movimientos"), where: lit({ categoria: "Viajes" }) },
      },
    ]);
    expect(replyOf(bad, "filter")).toBeUndefined();
    expect(JSON.stringify(bad)).toContain("unknown-value");
    // An operation that does not fit the field, or a day that is not one, is refused too.
    for (const where of [{ fecha: { after: "octubre" } }, { concepto: { before: "2026-10-01" } }]) {
      const off = await turnOf(token, "los de octubre", [
        {
          id: "f",
          op: "call",
          tool: "screen.filter",
          args: { collection: lit("movimientos"), where: lit(where) },
        },
      ]);
      expect(replyOf(off, "filter")).toBeUndefined();
      expect(JSON.stringify(off)).toContain("bad-value");
    }
  });

  it("«ábreme Agenda»: opened, with today's lit by the rows a tool gave", async () => {
    const token = await login();
    const t = await turnOf(token, "ábreme Agenda", [
      {
        id: "q",
        op: "call",
        tool: "entities.query",
        args: { type: lit("agenda"), field: lit("dia"), equals: lit("2026-11-12") },
      },
      { id: "o", op: "call", tool: "screen.open", args: { collection: lit("agenda") } },
      { id: "h", op: "call", tool: "screen.highlight", args: { target: ref("$q") } },
    ]);
    expect([t.status, t.error]).toEqual(["done", null]);
    expect(replyOf(t, "open")?.data).toEqual({ collection: "agenda" });
    const lit2 = replyOf(t, "highlight")?.data as { at: string[]; names: string[] };
    expect(lit2.at).toHaveLength(2);
    for (const k of lit2.at) expect(k).toMatch(/^row:e_/);
    expect([...lit2.names].sort()).toEqual(["Dentista", "Llamar al banco"]);
  });

  it("what is lit or scrolled to is what the screen or a tool gave, never a model's own key", async () => {
    const token = await login();
    const store = host.store(1);
    const id = store.list(AGENDA).find((e) => e.entity.values[A.titulo] === "Dentista")?.entity.id;
    const screen = { open: { kind: "collection", id: AGENDA }, pointed: [{ kind: "row", id }] };
    const t = await turnOf(
      token,
      "llévame a esta",
      [{ id: "s", op: "call", tool: "screen.scroll", args: { target: ref("$screen.pointed[0]") } }],
      screen,
    );
    expect(replyOf(t, "scroll")?.data).toMatchObject({ at: [`row:${id}`], names: ["Dentista"] });
    // A key the model wrote is refused by the plan's check, before anything runs.
    const made = await turnOf(token, "resalta la del dentista", [
      { id: "h", op: "call", tool: "screen.highlight", args: { target: lit(`row:${id}`) } },
    ]);
    expect(replyOf(made, "highlight")).toBeUndefined();
  });

  it("«¿por qué paró el flujo de ayer?»: its runs read, and the one that stopped opened over the map", async () => {
    const token = await login();
    const store = host.store(1);
    const made = (await post(token, "/api/agent/flows", { name: "Resumen de ejemplo" })) as {
      id: string;
    };
    const yesterday = NOW - 86_400_000;
    store.journal.startRun({
      id: "run-ayer",
      turn: null,
      origin: "background",
      device: null,
      started: yesterday,
      flow: made.id,
      flowVersion: 1,
    });
    store.journal.step({
      run: "run-ayer",
      step: "leer",
      kind: "read",
      decision: "allow",
      rule: "P1",
      detail: null,
      at: yesterday,
    });
    store.journal.step({
      run: "run-ayer",
      step: "aviso",
      kind: "call",
      decision: "deny",
      rule: "P7",
      detail: { reason: "background-egress" },
      at: yesterday,
    });
    store.journal.finishRun("run-ayer", "stopped", null, yesterday + 1000);
    const t = await turnOf(token, "¿por qué paró el flujo de ayer?", [
      { id: "r", op: "call", tool: "flows.runs", args: { flow: lit(made.id), limit: lit(3) } },
      {
        id: "o",
        op: "call",
        tool: "screen.open",
        args: { run: ref("$r[0].run"), map: lit(true), caption: lit("Paró en «aviso»") },
      },
    ]);
    expect([t.status, t.error]).toEqual(["done", null]);
    expect(replyOf(t, "open")?.data).toEqual({
      run: "run-ayer",
      map: true,
      caption: "Paró en «aviso»",
    });
    // What the model read: when, how it ended and where, in codes.
    const runs = store.journal.steps(t.run).find((s) => s.step === "r");
    expect(runs?.decision).toBe("allow");
    const facts = (await post(token, "/api/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "flows_runs", arguments: { flow: made.id } },
    })) as { result: { content: { text: string }[] } };
    expect(JSON.parse(facts.result.content[0]?.text ?? "{}")).toEqual({
      runs: [
        {
          run: "run-ayer",
          flow: { id: made.id, name: "Resumen de ejemplo" },
          day: "2026-11-11",
          time: "10:00",
          status: "stopped",
          stopped: { step: "aviso", decision: "deny", rule: "P7", code: "background-egress" },
        },
      ],
    });
    // A run's id the model wrote is not one a tool gave.
    const bad = await turnOf(token, "abre esa", [
      { id: "o", op: "call", tool: "screen.open", args: { run: lit("run-ayer"), map: lit(true) } },
    ]);
    expect(replyOf(bad, "open")).toBeUndefined();
  });

  it("a plan acts on a flow he points at, its trigger as its steps, through the list's actions", async () => {
    const token = await login();
    const store = host.store(1);
    const made = (await post(token, "/api/agent/flows", { name: "Avisar de ejemplo" })) as {
      id: string;
    };
    const screen = { pointed: [{ kind: "step", flow: made.id, step: "trigger" }] };
    const t = await turnOf(
      token,
      "enciende este",
      [
        {
          id: "e",
          op: "call",
          tool: "flows.enable",
          args: { flow: ref("$screen.pointed[0].flow.id"), on: lit(true) },
        },
      ],
      screen,
    );
    // His touch (P21): a card naming the flow he pointed at.
    expect(t.pending?.kind).toBe("confirm");
    expect(JSON.stringify(t.pending?.view.rows)).toContain("Avisar de ejemplo");
    expect(store.journal.flow(made.id)?.enabled).toBe(false);
    // And it is lit where he pointed (the trigger's key on the map and the canvas).
    const lit2 = await turnOf(
      token,
      "señálamelo",
      [{ id: "h", op: "call", tool: "screen.highlight", args: { target: ref("$screen.pointed") } }],
      screen,
    );
    expect(replyOf(lit2, "highlight")?.data).toMatchObject({ at: [`step:${made.id}/trigger`] });
  });

  it("only his own turn moves his screen: never what Boni does on its own (P22)", async () => {
    const bg = await host.agent(1).background({
      version: 1,
      steps: [{ id: "o", op: "call", tool: "screen.open", args: { collection: lit("agenda") } }],
    });
    // Its catalog has no screen at all, and the policy would deny it (P22, units.test.ts).
    expect(bg.status).toBe("stopped");
    expect(JSON.stringify(bg.replies)).not.toContain('"open"');
  });
});
