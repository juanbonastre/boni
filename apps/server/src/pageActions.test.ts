import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { label, newId, type TypeDef } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { viewOf } from "./pageActions.ts";
import { getPage, listPages } from "./pages.ts";

/**
 * The actions of «Páginas y vistas» and of the Bandeja (docs/sistema.md §4.1, F10) as Juan asks for them in the
 * conversation, over HTTP with a scripted planner (no model, no network), on collections shaped like his: generated
 * ids, fields named in Spanish with accents.
 */
const PASSWORD = "una contraseña larga de ejemplo";
const lit = (v: unknown) => ({ lit: v });
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
const servers: Server[] = [];
let base: string;
const plans: unknown[] = [];
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
// As Juan's are: ids the app generated, never the collection's key.
const MOV = newId("t");
const F = { concepto: newId("f"), importe: newId("f"), categoria: newId("f"), fecha: newId("f") };
const TAREA = newId("t");
const TITULO = newId("f");

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
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
  pending: {
    kind: string;
    id: string;
    view: {
      title: string;
      rows: { arg: string; value: unknown; name?: string; detail?: string }[];
    };
  } | null;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-actions-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  const planner = fakePlanner([]);
  planner.complete = async () => ({
    json: plans.shift(),
    usage: { input: 1, output: 1 },
    model: "fake",
  });
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  base = await listen(serve(app, "tailnet"));
  const store = host.store(1);
  const opt = (name: string) => ({ id: newId("o"), name, label: own });
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: MOV,
        key: "movimientos",
        name: "Movimientos",
        fields: [
          { id: F.concepto, key: "concepto", name: "Concepto", type: "text", label: own },
          { id: F.importe, key: "importe", name: "Importe", type: "number", label: own },
          {
            id: F.categoria,
            key: "categoria",
            name: "Categoría",
            type: "select",
            options: [opt("Comida"), opt("Transporte"), opt("Casa")],
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
        id: TAREA,
        key: "tareas",
        name: "Tareas",
        fields: [{ id: TITULO, key: "titulo", name: "Título", type: "text", label: own }],
        titleField: TITULO,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
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

describe("the list of actions in the conversation (docs/sistema.md §4.1, F10)", () => {
  it("«hazme una página Gastos con el gasto por categoría» makes the page with its chart, and Undo takes it back", async () => {
    const token = await login();
    plans.push({
      version: 1,
      steps: [
        { id: "p", op: "call", tool: "pages.create", args: { title: { quote: "Gastos" } } },
        {
          id: "b",
          op: "call",
          tool: "pages.add_block",
          args: {
            page: { ref: "$p.id" },
            block: lit({
              type: "graph",
              collection: "movimientos",
              measure: "sum",
              field: "Importe",
              groupBy: "Categoría",
              shape: "donut",
              period: "month",
              title: "Gasto por categoría",
            }),
          },
        },
      ],
    });
    const turn = (await post(token, "/api/agent/turn", {
      text: "hazme una página Gastos con el gasto por categoría",
    })) as unknown as Turn;
    expect(turn.error).toBeNull();
    expect(turn.status).toBe("done");
    const store = host.store(1);
    const made = listPages(store).find((p) => p.title === "Gastos");
    if (!made) throw new Error("no page");
    // As the editor keeps it: the collection and its fields by id, whatever the model called them.
    expect(getPage(store, made.id)?.spec.blocks).toEqual([
      expect.objectContaining({
        type: "graph",
        collection: MOV,
        measure: "sum",
        field: F.importe,
        groupBy: F.categoria,
        shape: "donut",
        title: "Gasto por categoría",
      }),
    ]);
    // The page's numbers, computed as the app asks for them.
    const block = getPage(store, made.id)?.spec.blocks[0];
    const numbers = await post(token, "/api/data/blocks", { blocks: [block] });
    expect(JSON.stringify(numbers)).not.toContain("error");
    // A whole request, undone at once: the page goes with its block.
    expect(await post(token, `/api/agent/runs/${turn.run}/undo`)).toEqual({ undone: 2 });
    expect(listPages(store).some((p) => p.id === made.id)).toBe(false);

    // What the model names wrong is refused, nothing half made.
    plans.push({
      version: 1,
      steps: [
        { id: "p", op: "call", tool: "pages.create", args: { title: lit("Otra") } },
        {
          id: "b",
          op: "call",
          tool: "pages.add_block",
          args: {
            page: { ref: "$p.id" },
            block: lit({
              type: "number",
              collection: "movimientos",
              measure: "sum",
              field: "Precio",
            }),
          },
        },
      ],
    });
    const bad = (await post(token, "/api/agent/turn", { text: "y otra" })) as unknown as Turn;
    expect(JSON.stringify(bad)).toContain("unknown-field");
  });

  it("a table of a page: added, its view changed, the page renamed and moved, and deleted only on Juan's touch", async () => {
    const token = await login();
    plans.push({
      version: 1,
      steps: [
        { id: "m", op: "call", tool: "pages.create", args: { title: lit("Casa") } },
        { id: "p", op: "call", tool: "pages.create", args: { title: lit("Pendientes") } },
        {
          id: "b",
          op: "call",
          tool: "pages.add_block",
          args: {
            page: { ref: "$p.id" },
            block: lit({ type: "database", collection: "tareas", view: { layout: "table" } }),
          },
        },
        {
          id: "v",
          op: "call",
          tool: "pages.set_view",
          args: {
            page: { ref: "$p.id" },
            block: { ref: "$b.block" },
            view: lit({ layout: "list", sort: { field: "Título", desc: true } }),
          },
        },
        {
          id: "u",
          op: "call",
          tool: "pages.update",
          args: {
            page: { ref: "$p.id" },
            title: lit("Pendientes de casa"),
            icon: lit("🏠"),
            parent: { ref: "$m.id" },
          },
        },
      ],
    });
    const turn = (await post(token, "/api/agent/turn", {
      text: "ponme las tareas en una página dentro de Casa, en lista",
    })) as unknown as Turn;
    expect(turn.error).toBeNull();
    const store = host.store(1);
    const casa = listPages(store).find((p) => p.title === "Casa");
    const page = listPages(store).find((p) => p.title === "Pendientes de casa");
    if (!casa || !page) throw new Error("no pages");
    expect(page).toMatchObject({ icon: "🏠", parent: casa.id });
    expect(getPage(store, page.id)?.spec.blocks[0]).toMatchObject({
      type: "database",
      source: TAREA,
      view: { layout: "list", sort: { field: TITULO, desc: true } },
    });

    // Deleting is his touch: the card names the page by its title, and nothing goes until he confirms.
    plans.push({
      version: 1,
      steps: [{ id: "d", op: "call", tool: "pages.delete", args: { page: lit(page.id) } }],
    });
    const del = (await post(token, "/api/agent/turn", {
      text: "borra esa página",
    })) as unknown as Turn;
    expect(del.pending?.kind).toBe("confirm");
    expect(del.pending?.view.rows[0]).toMatchObject({
      value: page.id,
      detail: "Pendientes de casa",
    });
    expect(listPages(store).some((p) => p.id === page.id)).toBe(true);
    const done = (await post(token, "/api/agent/confirm", {
      run: del.run,
      confirmation: del.pending?.id,
    })) as unknown as Turn;
    expect(done.status).toBe("done");
    expect(listPages(store).some((p) => p.id === page.id)).toBe(false);
    // In the trash, as the app's own deleting leaves it.
    expect(await post(token, `/api/pages/${page.id}/restore`)).toMatchObject({
      page: { id: page.id },
    });
  });

  it("«acepta estas dos»: the Bandeja's cards on the screen, accepted on a card that names them, and one rejected", async () => {
    const token = await login();
    const make = (title: string) => ({
      version: 1,
      steps: [
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: { type: lit("tareas"), values: { fn: "obj", args: [lit("titulo"), lit(title)] } },
        },
      ],
    });
    const a = host.agent(1);
    const ids = [
      ...(await a.background(make("Pedir cita en el taller"))).proposals,
      ...(await a.background(make("Pagar la comunidad"))).proposals,
      ...(await a.background(make("Comprar sellos"))).proposals,
    ];
    expect(ids).toHaveLength(3);
    const screen = {
      open: { kind: "inbox", id: null },
      inbox: ids.map((id) => ({ kind: "proposal", id })),
      chosen: [],
    };
    plans.push({
      version: 1,
      steps: [
        {
          id: "a",
          op: "call",
          tool: "inbox.accept",
          args: {
            proposals: {
              fn: "list",
              args: [{ ref: "$screen.inbox[0].id" }, { ref: "$screen.inbox[1].id" }],
            },
          },
        },
      ],
    });
    const turn = (await post(token, "/api/agent/turn", {
      text: "acepta estas dos",
      screen,
    })) as unknown as Turn;
    // Nothing is accepted before his touch; the card says which, by their titles, and where they go.
    expect(turn.pending?.kind).toBe("confirm");
    expect(turn.pending?.view.rows).toEqual([
      expect.objectContaining({ value: "Pedir cita en el taller", name: "Tareas" }),
      expect.objectContaining({ value: "Pagar la comunidad", name: "Tareas" }),
    ]);
    const store = host.store(1);
    expect(store.list(TAREA)).toHaveLength(0);
    const done = (await post(token, "/api/agent/confirm", {
      run: turn.run,
      confirmation: turn.pending?.id,
    })) as unknown as Turn;
    expect(done.status).toBe("done");
    expect(
      store
        .list(TAREA)
        .map((e) => e.entity.values[TITULO])
        .sort(),
    ).toEqual(["Pagar la comunidad", "Pedir cita en el taller"]);
    expect(ids.map((id) => store.journal.proposal(id)?.status)).toEqual([
      "accepted",
      "accepted",
      "pending",
    ]);

    // The third, rejected the same way.
    plans.push({
      version: 1,
      steps: [
        {
          id: "r",
          op: "call",
          tool: "inbox.reject",
          args: { proposals: { fn: "list", args: [{ ref: "$screen.inbox[0].id" }] } },
        },
      ],
    });
    const no = (await post(token, "/api/agent/turn", {
      text: "esta no",
      screen: { ...screen, inbox: [{ kind: "proposal", id: ids[2] }] },
    })) as unknown as Turn;
    expect(no.pending?.view.rows[0]).toMatchObject({ value: "Comprar sellos" });
    await post(token, "/api/agent/confirm", { run: no.run, confirmation: no.pending?.id });
    expect(store.journal.proposal(ids[2] as string)?.status).toBe("rejected");

    // Never from background work: what Boni does on its own cannot decide for him (P21).
    const bg = await a.background({
      version: 1,
      steps: [
        {
          id: "a",
          op: "call",
          tool: "inbox.accept",
          args: { proposals: { fn: "list", args: [lit(ids[2])] } },
        },
      ],
    });
    expect(JSON.stringify(bg)).toContain("P21");
    expect(store.journal.proposal(ids[2] as string)?.status).toBe("rejected");
  });
});

describe("a table's view as a model writes it (task 76)", () => {
  // Generated ids, as Juan's collections have them; the model names the fields.
  const def = {
    id: "t_01m6p4abcd",
    key: "tarea",
    name: "Tarea",
    titleField: "f_01m6p4titu",
    sensitivity: "personal",
    label: own,
    fields: [
      { id: "f_01m6p4titu", key: "titulo", name: "Título", type: "text", label: own },
      { id: "f_01m6p4hora", key: "horas", name: "Horas", type: "number", label: own },
      { id: "f_01m6p4dia0", key: "dia", name: "Día", type: "date", label: own },
    ],
  } as unknown as TypeDef;
  it("names its calculations, pinned column and wrapped columns by field, kept by id, from the closed list", () => {
    expect(
      viewOf(def, {
        layout: "table",
        calc: { Horas: "sum", Día: "latest" },
        pin: "Título",
        wrap: ["Título"],
        group: "Día",
      }),
    ).toEqual({
      layout: "table",
      group: "f_01m6p4dia0",
      calc: { f_01m6p4hora: "sum", f_01m6p4dia0: "latest" },
      pin: "f_01m6p4titu",
      wrap: ["f_01m6p4titu"],
    });
    expect(() => viewOf(def, { layout: "table", calc: { Horas: "eval" } })).toThrow();
    expect(() => viewOf(def, { layout: "table", pin: "Nada" })).toThrow();
  });
  it("names an advanced filter's rules by field, kept by id; one level only (task 75, D-58)", () => {
    expect(
      viewOf(def, {
        layout: "table",
        filter: [
          { field: "Horas", op: "gt", value: 2 },
          {
            join: "or",
            rules: [
              { field: "Título", op: "contains", value: "informe" },
              { field: "Día", op: "empty" },
            ],
          },
        ],
      }),
    ).toEqual({
      layout: "table",
      filter: [
        { field: "f_01m6p4hora", op: "gt", value: 2 },
        {
          join: "or",
          rules: [
            { field: "f_01m6p4titu", op: "contains", value: "informe" },
            { field: "f_01m6p4dia0", op: "empty" },
          ],
        },
      ],
    });
    expect(() =>
      viewOf(def, {
        layout: "table",
        filter: [{ join: "or", rules: [{ field: "Nada", op: "empty" }] }],
      }),
    ).toThrow();
    expect(() =>
      viewOf(def, {
        layout: "table",
        filter: [{ join: "or", rules: [{ join: "and", rules: [{ field: "Día", op: "empty" }] }] }],
      }),
    ).toThrow();
  });
});
