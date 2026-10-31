import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { mcpAnswer } from "./mcp.ts";
import { seed } from "./seed.test-util.ts";
import { SYS_RUNS } from "./systemCollections.ts";

const PASSWORD = "una contraseña larga de ejemplo";
let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let http: HttpServer;
let base = "";

const L = label("user", "personal", [{ kind: "user-edit", id: "test" }]);
/** A calendar of tasks as Boni Calendar defines one (invented): a title, a day, its box «Hecha». */
const AGENDA = {
  id: "agenda",
  name: "Agenda",
  folder: "agenda/",
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "completed", name: "Hecha", type: "checkbox" },
  ],
  mapping: { title: "title", when: { kind: "split", date: "date" }, task: { column: "completed" } },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-data-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "ana", PASSWORD);
  host = new AgentHost({ dataDir: dir, providers: null });
  app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
  });
  http = serve(app, "tailnet");
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  // A collection of the user's: books with a status.
  const store = host.store(1);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_libro",
        key: "libro",
        name: "Libros",
        titleField: "f_titulo",
        sensitivity: "personal",
        schemaVersion: 1,
        label: L,
        fields: [
          { id: "f_titulo", key: "titulo", name: "Título", type: "text", label: L },
          {
            id: "f_estado",
            key: "estado",
            name: "Estado",
            type: "select",
            label: L,
            options: [
              { id: "o_leyendo", name: "Leyendo", label: L },
              { id: "o_leido", name: "Leído", label: L },
            ],
          },
          { id: "f_paginas", key: "paginas", name: "Páginas", type: "number", label: L },
        ],
      },
    },
    { actor: "user" },
  );
});

afterAll(async () => {
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function token(device = "portatil-ejemplo") {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "ana", password: PASSWORD, device }),
  });
  return ((await r.json()) as { token: string }).token;
}
const call = async (t: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${t}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe("collections as databases (plan PR 19)", () => {
  it("lists the user's types and rows; a view adds, edits, deletes and restores rows", async () => {
    const t = await token();
    const types = (await call(t, "GET", "/api/data/types")).body.types as {
      id: string;
      fields: { id: string; type: string }[];
    }[];
    const libros = types.find((x) => x.id === "t_libro");
    expect(libros?.fields.map((f) => f.type)).toEqual(["text", "select", "number"]);
    // Boni's own types are not data to edit.
    expect(types.some((x) => x.id === "page" || x.id === "extension")).toBe(false);

    const made = (
      await call(t, "POST", "/api/data/types/t_libro/rows", {
        values: { f_titulo: "Rayuela", f_estado: "o_leyendo" },
      })
    ).body.row as { id: string };
    const edited = await call(t, "PUT", `/api/data/rows/${made.id}`, {
      values: { f_estado: "o_leido", f_paginas: 600 },
    });
    expect(edited.body.row).toMatchObject({
      values: { f_titulo: "Rayuela", f_estado: "o_leido", f_paginas: 600 },
    });
    // A value the field does not take, or a field the type does not have, changes nothing.
    expect(
      (await call(t, "PUT", `/api/data/rows/${made.id}`, { values: { f_paginas: "mil" } })).status,
    ).toBe(400);
    expect((await call(t, "PUT", `/api/data/rows/${made.id}`, { values: { f_x: 1 } })).status).toBe(
      400,
    );
    // Opened as a page: its body is read and written as text.
    await call(t, "PUT", `/api/data/rows/${made.id}`, { body: "Notas de **lectura**." });
    expect(
      ((await call(t, "GET", `/api/data/rows/${made.id}`)).body.row as { body: string }).body,
    ).toBe("Notas de **lectura**.");
    const rows = (await call(t, "GET", "/api/data/types/t_libro/rows")).body.rows as {
      id: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual([made.id]);
    expect((await call(t, "DELETE", `/api/data/rows/${made.id}`)).status).toBe(200);
    expect(
      ((await call(t, "GET", "/api/data/types/t_libro/rows")).body.rows as unknown[]).length,
    ).toBe(0);
    expect((await call(t, "POST", `/api/data/rows/${made.id}/restore`)).status).toBe(200);
    expect(
      ((await call(t, "GET", "/api/data/types/t_libro/rows")).body.rows as unknown[]).length,
    ).toBe(1);
    // A record without a title is listed and found by its id all the same (nothing is found by a path, D-17).
    const noTitle = host.store(1).create("t_libro", {}, { actor: "import" });
    const listed = (await call(t, "GET", "/api/data/types/t_libro/rows")).body.rows as {
      id: string;
      values: Record<string, unknown>;
    }[];
    expect(listed.find((r) => r.id === noTitle.entity.id)?.values.f_titulo).toBeUndefined();
    // Opened by its id, it says its collection (Boni Calendar's "Abrir en Boni"; notes have no paths).
    const at = await call(t, "GET", `/api/data/rows/${noTitle.entity.id}`);
    expect(at.body.row).toMatchObject({ id: noTitle.entity.id, type: "t_libro" });
    // Only a personal device sees or changes the data.
    db.prepare("UPDATE devices SET trust = 'shared' WHERE name = 'tele-ejemplo'").run();
    const tv = await token("tele-ejemplo");
    db.prepare("UPDATE devices SET trust = 'shared' WHERE name = 'tele-ejemplo'").run();
    expect((await call(tv, "GET", "/api/data/types")).status).toBe(403);
  });

  it("how a collection's rows open: properties folded or not, some hidden one by one, for the account", async () => {
    const t = await token();
    const ui = async () =>
      (
        (await call(t, "GET", "/api/data/types")).body.types as {
          id: string;
          rowUi: { open: boolean; hidden: string[] };
        }[]
      ).find((x) => x.id === "t_libro")?.rowUi;
    expect(await ui()).toEqual({
      open: false,
      hidden: [],
      related: false,
      folded: [],
      widths: {},
    });
    const r = await call(t, "PUT", "/api/data/types/t_libro/row-ui", {
      open: true,
      hidden: ["f_paginas"],
    });
    expect(r.body).toEqual({
      open: true,
      hidden: ["f_paginas"],
      related: false,
      folded: [],
      widths: {},
    });
    // Another device of the account sees the same.
    const other = await token("otro-equipo");
    const theirs = (await call(other, "GET", "/api/data/types")).body.types as {
      id: string;
      rowUi: unknown;
    }[];
    expect(theirs.find((x) => x.id === "t_libro")?.rowUi).toEqual({
      open: true,
      hidden: ["f_paginas"],
      related: false,
      folded: [],
      widths: {},
    });
    expect(
      (await call(t, "PUT", "/api/data/types/t_libro/row-ui", { hidden: ["f_nada"] })).status,
    ).toBe(400);
    expect((await call(t, "PUT", "/api/data/types/t_nada/row-ui", { open: true })).status).toBe(
      404,
    );
    // Its table's columns as wide as the user left them (Juan, 2026-10-30); a width out of reason is refused.
    expect(
      (
        await call(t, "PUT", "/api/data/types/t_libro/row-ui", {
          widths: { f_paginas: 96, "_sys.created": 180 },
        })
      ).body.widths,
    ).toEqual({ f_paginas: 96, "_sys.created": 180 });
    for (const widths of [{ f_paginas: 12 }, { f_paginas: 4000 }, { "<b>": 100 }, [100], "ancho"])
      expect((await call(t, "PUT", "/api/data/types/t_libro/row-ui", { widths })).status).toBe(400);
    // Boni's own tables keep their widths too, and nothing else (their rows neither open nor fold).
    const own = await call(t, "PUT", `/api/data/types/${SYS_RUNS}/row-ui`, {
      widths: { f_status: 120 },
    });
    expect(own.body.widths).toEqual({ f_status: 120 });
    expect(
      (await call(t, "PUT", `/api/data/types/${SYS_RUNS}/row-ui`, { open: true })).status,
    ).toBe(400);
    expect(
      (
        (await call(t, "GET", "/api/data/types")).body.types as {
          id: string;
          rowUi: { widths: Record<string, number> };
        }[]
      ).find((x) => x.id === SYS_RUNS)?.rowUi.widths,
    ).toEqual({ f_status: 120 });
    await call(t, "PUT", "/api/data/types/t_libro/row-ui", { open: false, widths: {} });
    expect(await ui()).toEqual({
      open: false,
      hidden: ["f_paginas"],
      related: false,
      folded: [],
      widths: {},
    });
  });

  it("gives a zone's attachments only as a download, and keeps the zone's AI level locked", async () => {
    const t = await token();
    const store = host.store(1);
    const sha = store.putFile(new TextEncoder().encode("<svg onload=alert(1)/>"), "image/svg+xml");
    store.setZone("t_libro", "private", "import");
    const r = await fetch(`${base}/api/data/files/${sha}`, {
      headers: { authorization: `Bearer ${t}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe("attachment");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(await r.text()).toBe("<svg onload=alert(1)/>");
    expect((await call(t, "GET", `/api/data/files/${"0".repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${base}/api/data/files/${sha}`)).status).toBe(401);
    const types = (await call(t, "GET", "/api/data/types")).body.types as {
      zone?: string;
      level?: string;
    }[];
    expect(types[0]).toMatchObject({ zone: "private", level: "private" });
    // Its protection, from the collection: locked until unlocked.
    const protect = (body: unknown) => call(t, "PUT", "/api/data/types/t_libro/protection", body);
    expect((await protect({ level: "visible" })).status).toBe(409);
    expect((await protect({ level: "nada" })).status).toBe(400);
    expect((await protect({ level: "opaque", unlock: true })).body).toEqual({
      id: "t_libro",
      level: "opaque",
    });
    expect(
      (await call(t, "PUT", "/api/data/types/t_nada/protection", { level: "opaque" })).status,
    ).toBe(404);
  });

  it("a part of a collection with its own level: rules added, changed, listed and removed", async () => {
    const t = await token();
    const store = host.store(1);
    store.setAiAccess("t_libro", "opaque", "portatil", { unlock: true });
    const rule = {
      filter: [{ field: "f_estado", op: "is", value: "o_leido" }],
      level: "restricted",
    };
    const made = await call(t, "POST", "/api/data/types/t_libro/rules", rule);
    expect(made.status).toBe(200);
    const id = made.body.id as string;
    const listed = (await call(t, "GET", "/api/data/types")).body.types as {
      id: string;
      rules: { id: string; level: string }[];
    }[];
    expect(listed.find((x) => x.id === "t_libro")?.rules).toEqual([
      { id, filter: rule.filter, level: "restricted" },
    ]);
    // Only the collection's own fields, Notion's operators.
    const bad = (body: unknown) => call(t, "POST", "/api/data/types/t_libro/rules", body);
    expect((await bad({ ...rule, filter: [{ field: "f_nada", op: "is" }] })).status).toBe(400);
    expect((await bad({ ...rule, filter: [{ field: "f_estado", op: "drop" }] })).status).toBe(400);
    expect((await bad({ ...rule, filter: [] })).status).toBe(400);
    expect((await bad({ ...rule, level: "nada" })).status).toBe(400);
    // Private: locked like a collection.
    expect(
      (await call(t, "PUT", `/api/data/rules/${id}`, { ...rule, level: "private" })).status,
    ).toBe(200);
    expect((await call(t, "DELETE", `/api/data/rules/${id}`)).status).toBe(409);
    expect((await call(t, "DELETE", `/api/data/rules/${id}`, { unlock: true })).status).toBe(200);
    expect(store.aiRules()).toEqual([]);
    expect((await call(t, "PUT", "/api/data/rules/r_nada", rule)).status).toBe(404);
  });

  it("computes a page's numbers and charts from a collection, and says what is wrong with a block", async () => {
    const t = await token();
    for (const [titulo, estado, paginas] of [
      ["Niebla", "o_leido", 200],
      ["Ficciones", "o_leido", 180],
      ["Pedro Páramo", "o_leyendo", 120],
    ] as const)
      await call(t, "POST", "/api/data/types/t_libro/rows", {
        values: { f_titulo: titulo, f_estado: estado, f_paginas: paginas },
      });
    const base = { collection: "t_libro", period: "all", title: "Libros" };
    const r = await call(t, "POST", "/api/data/blocks", {
      blocks: [
        {
          ...base,
          id: "n",
          type: "number",
          measure: "count",
          filterField: "f_estado",
          filterValue: "o_leido",
        },
        { ...base, id: "b", type: "bars", measure: "sum", field: "f_paginas", groupBy: "f_estado" },
        // Books have no date: no time axis, no "this month"; a field that is not there; Boni's own pages.
        { ...base, id: "x", type: "graph", shape: "bar", measure: "count", groupBy: "@month" },
        { ...base, id: "y", type: "bars", measure: "count", groupBy: "f_nada" },
        { ...base, id: "z", type: "number", measure: "count", collection: "page" },
      ],
    });
    expect(r.status).toBe(200);
    const res = r.body.results as Record<
      string,
      { data?: Record<string, unknown>; problems?: unknown[] }
    >;
    // The book made by the first test (Rayuela, «Leído», deleted and restored) counts as well.
    expect(res.n?.data?.total).toBe(3);
    const series = (res.b?.data?.series ?? []) as { points: { label: string; value: number }[] }[];
    const bars = series[0]?.points;
    expect(bars?.map((p) => [p.label, p.value])).toEqual([
      ["Leído", 980],
      ["Leyendo", 120],
    ]);
    expect(res.x?.problems).toEqual([
      { block: "x", key: "groupBy", code: "not-in-data", value: "@month" },
    ]);
    expect(res.y?.problems).toEqual([
      { block: "y", key: "groupBy", code: "not-in-data", value: "f_nada" },
    ]);
    expect(res.z?.problems?.[0]).toMatchObject({ key: "collection", code: "not-in-data" });
    expect(
      (await call(t, "POST", "/api/data/blocks", { blocks: [{ id: "h", type: "heading" }] }))
        .status,
    ).toBe(400);
    expect((await call(t, "POST", "/api/data/blocks", { blocks: "todo" })).status).toBe(400);
  });
});

describe("what a block counts, and Boni's own records as collections (design audit, 2026-10-25)", () => {
  it("lists the rows a number counts, and those of one bar (D-08)", async () => {
    const t = await token();
    const base = { collection: "t_libro", period: "all", title: "Libros" };
    const n = {
      ...base,
      id: "n",
      type: "number",
      measure: "count",
      filterField: "f_estado",
      filterValue: "o_leido",
    };
    const total = (
      (await call(t, "POST", "/api/data/blocks", { blocks: [n] })).body.results as Record<
        string,
        { data: { total: number } }
      >
    ).n?.data.total;
    const r = await call(t, "POST", "/api/data/blocks/rows", { block: n });
    expect(r.status).toBe(200);
    const rows = r.body.rows as { values: Record<string, unknown> }[];
    expect(rows.length).toBe(total);
    expect(r.body.total).toBe(total);
    expect(rows.every((x) => x.values.f_estado === "o_leido")).toBe(true);
    // One bar of a bar list: only its rows.
    const b = { ...base, id: "b", type: "bars", measure: "count", groupBy: "f_estado" };
    const one = await call(t, "POST", "/api/data/blocks/rows", { block: b, drill: "o_leyendo" });
    const leyendo = one.body.rows as { values: Record<string, unknown> }[];
    expect(leyendo.length).toBeGreaterThan(0);
    expect(leyendo.every((x) => x.values.f_estado === "o_leyendo")).toBe(true);
    // A block that is not valid says what is wrong; one that is not a data block is refused.
    const bad = await call(t, "POST", "/api/data/blocks/rows", {
      block: { ...n, filterField: "f_nada" },
    });
    expect(bad.body.problems).toBeTruthy();
    expect(
      (await call(t, "POST", "/api/data/blocks/rows", { block: { id: "h", type: "heading" } }))
        .status,
    ).toBe(400);
  });

  it("shows calls to models and Boni's activity as read-only collections no model sees (D-04)", async () => {
    const t = await token();
    const store = host.store(1);
    const at = Date.now();
    store.journal.startRun({
      id: "r_ejemplo",
      turn: null,
      origin: "other",
      device: "portatil-ejemplo",
      started: at - 5000,
    });
    store.journal.finishRun("r_ejemplo", "done", null, at);
    for (const [role, cost] of [
      ["reader", 0.2],
      ["planner", 1],
      ["eval-reader", null],
    ] as const)
      store.journal.modelCall({
        run: "r_ejemplo",
        role,
        provider: "openrouter",
        model: "ejemplo/modelo-de-prueba",
        promptHash: "h",
        request: {},
        response: {},
        usage: { input: 100, output: 20, ...(cost === null ? {} : { cost }) },
        at,
      });
    const types = (await call(t, "GET", "/api/data/types")).body.types as {
      id: string;
      system?: boolean;
      level: string;
      count: number;
      fields: { id: string; options?: { id: string; name: string }[] }[];
    }[];
    const calls = types.find((x) => x.id === "t_sys_llamadas");
    const activity = types.find((x) => x.id === "t_sys_actividad");
    const runs = types.find((x) => x.id === "t_sys_runs");
    expect(calls).toMatchObject({ system: true, level: "private", count: 3 });
    expect(runs).toMatchObject({ system: true, level: "private", count: 1 });
    expect(calls?.fields.find((f) => f.id === "f_uso")?.options?.map((o) => o.name)).toEqual([
      "Agente",
      "Evaluación",
      "Lector",
    ]);
    // The books written in the tests above are Boni's activity: «Tú · <device>» changed «Libros».
    expect(activity?.system).toBe(true);
    const acts = (await call(t, "GET", "/api/data/types/t_sys_actividad/rows")).body.rows as {
      values: Record<string, unknown>;
    }[];
    expect(acts.some((a) => a.values.f_titulo === "Tú · portatil-ejemplo · cambió Libros")).toBe(
      true,
    );
    const executions = (await call(t, "GET", "/api/data/types/t_sys_runs/rows")).body.rows as {
      values: Record<string, unknown>;
    }[];
    expect(executions).toHaveLength(1);
    expect(executions[0]?.values).toMatchObject({
      f_segundos: 5,
      f_cambios: 0,
      f_coste: { amount: 1.08, currency: "EUR" },
    });
    expect(runs?.fields.find((f) => f.id === "f_estado")?.options?.map((o) => o.name)).toEqual([
      "Hecha",
    ]);
    // Counted with the same blocks as any collection, in euros at the account's rate.
    const spent = await call(t, "POST", "/api/data/blocks", {
      blocks: [
        {
          id: "g",
          type: "number",
          title: "Gasto",
          collection: "t_sys_llamadas",
          measure: "sum",
          field: "f_coste",
          period: "month",
        },
      ],
    });
    const g = (spent.body.results as Record<string, { data: { total: number } }>).g;
    expect(g?.data.total).toBeCloseTo(1.2 * 0.9, 2);
    // Read only: no row added, edited or deleted.
    expect(
      (await call(t, "POST", "/api/data/types/t_sys_llamadas/rows", { values: {} })).status,
    ).toBe(404);
    const row = (
      (await call(t, "GET", "/api/data/types/t_sys_llamadas/rows")).body.rows as { id: string }[]
    )[0];
    expect(
      (await call(t, "PUT", `/api/data/rows/${row?.id}`, { values: { f_tokens: 1 } })).status,
    ).toBe(404);
    expect((await call(t, "DELETE", `/api/data/rows/${row?.id}`)).status).toBe(404);
    expect(
      (await call(t, "PUT", "/api/data/types/t_sys_llamadas/protection", { level: "visible" }))
        .status,
    ).toBe(404);
    // Not in the store: the agent's view and the MCP never see them.
    expect(store.schema().types.t_sys_llamadas).toBeUndefined();
    const mcp = (await mcpAnswer(
      store,
      "portatil-ejemplo",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "collections", arguments: {} },
      },
      Date.now,
    )) as { result: { content: { text: string }[] } };
    expect(mcp.result.content[0]?.text).not.toContain("t_sys_");
    expect(mcp.result.content[0]?.text).not.toContain("Llamadas a modelos");
  });
});

describe("collections as classes (docs/clases.md; D-11)", () => {
  it("a mother's table has her daughters' rows, each with its own collection; the types say their mother", async () => {
    const store = host.store(1);
    const meta = { actor: "user" as const };
    store.applySchema(
      {
        op: "create_type",
        type: {
          id: "t_lectura",
          key: "lectura",
          name: "Lecturas",
          parent: "t_libro",
          titleField: "f_titulo",
          sensitivity: "personal",
          schemaVersion: 1,
          label: L,
          fields: [{ id: "f_pagina", key: "pagina", name: "Página", type: "number", label: L }],
        },
      },
      meta,
    );
    const daughter = store.create(
      "t_lectura",
      { f_titulo: { value: "Un ensayo inventado", label: L }, f_pagina: { value: 12, label: L } },
      meta,
    ).entity.id;
    const t = await token();
    const types = (await call(t, "GET", "/api/data/types")).body as {
      types: { id: string; parent?: string; count: number }[];
    };
    const libro = types.types.find((x) => x.id === "t_libro");
    expect(types.types.find((x) => x.id === "t_lectura")).toMatchObject({ parent: "t_libro" });
    const rows = (await call(t, "GET", "/api/data/types/t_libro/rows")).body as {
      rows: { id: string; type?: string; values: Record<string, unknown> }[];
    };
    expect(rows.rows.find((r) => r.id === daughter)).toMatchObject({
      type: "t_lectura",
      values: { f_titulo: "Un ensayo inventado", f_pagina: 12 },
    });
    expect(libro?.count).toBe(rows.rows.length);
    expect(rows.rows.filter((r) => r.type === undefined).length).toBe(rows.rows.length - 1);
  });
});

describe("the tree (docs/clases.md §2.7; D-13)", () => {
  it("collections are made, moved and taken out of the tree; a record moves keeping its id; notes show by the eye", async () => {
    const t = await token();
    const made = await call(t, "POST", "/api/data/types", { name: "Ideas" });
    expect(made.status).toBe(200);
    const ideas = made.body.id as string;
    expect((await call(t, "POST", "/api/data/types", { name: "ideas" })).status).toBe(409);
    const inside = await call(t, "POST", "/api/data/types", { name: "Sueltas", parent: ideas });
    const sueltas = inside.body.id as string;
    const store = host.store(1);
    expect(store.schema().types[sueltas]?.parent).toBe(ideas);
    // A folder of notes (no properties of its own) shows its notes; a note that is only headings does not count.
    const meta = { actor: "user" as const };
    const note = store.create(
      sueltas,
      { f_titulo: { value: "Una idea", label: L }, $body: { value: "Algo que pensar.", label: L } },
      meta,
    ).entity.id;
    store.create(
      sueltas,
      {
        f_titulo: { value: "Plantilla", label: L },
        $body: { value: "# Notas\n\n## Más\n", label: L },
      },
      meta,
    );
    const tree = (await call(t, "GET", "/api/data/tree")).body as {
      collections: { id: string; parent?: string; notes: boolean; count: number }[];
      notes: { id: string }[];
    };
    expect(tree.collections.find((c) => c.id === sueltas)).toMatchObject({
      parent: ideas,
      notes: true,
    });
    expect(tree.collections.find((c) => c.id === ideas)?.count).toBe(2);
    expect(tree.notes.map((n) => n.id)).toEqual([note]);
    expect((await call(t, "PUT", `/api/data/types/${sueltas}/tree`, { notes: false })).status).toBe(
      200,
    );
    expect(((await call(t, "GET", "/api/data/tree")).body.notes as unknown[]).length).toBe(0);
    // «Todas las páginas» lists a collection's notes whatever its eye says.
    const all = (await call(t, "GET", `/api/data/tree?type=${sueltas}`)).body.notes as {
      id: string;
    }[];
    expect(all.map((n) => n.id)).toEqual([note]);
    // A record moved to another collection keeps its id; a collection moved to the root.
    expect((await call(t, "PUT", `/api/data/rows/${note}/type`, { type: ideas })).status).toBe(200);
    expect(store.get(note)?.entity.type).toBe(ideas);
    expect(
      (await call(t, "PUT", `/api/data/types/${sueltas}/parent`, { parent: null })).status,
    ).toBe(200);
    expect(store.schema().types[sueltas]?.parent).toBeUndefined();
    // Out of the tree only when nothing is left in it.
    expect((await call(t, "DELETE", `/api/data/types/${ideas}`)).status).toBe(409);
    expect((await call(t, "DELETE", `/api/data/types/${sueltas}`)).status).toBe(409);
    const empty = (await call(t, "POST", "/api/data/types", { name: "Vacía" })).body.id as string;
    expect((await call(t, "DELETE", `/api/data/types/${empty}`)).status).toBe(200);
    const types = (await call(t, "GET", "/api/data/types")).body.types as { id: string }[];
    expect(types.some((x) => x.id === empty)).toBe(false);
  });

  it("Inicio's «Hoy» on the phone: today in the calendars, by the device's timezone; a task's box by its calendar", async () => {
    const t = await token();
    // Invented notes: one thing today (a task, not done) and one tomorrow, in a calendar of tasks.
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    seed(host.store(1), [{ key: "agenda", name: "Agenda", folder: "agenda/", calendar: AGENDA }], {
      "agenda/a.md": `---\ntitle: "Llamar al fontanero"\ndate: "${day(0)}"\ncompleted: false\n---\n`,
      "agenda/b.md": `---\ntitle: "Tutoría"\ndate: "${day(1)}"\ncompleted: false\n---\n`,
    });
    const types = (await call(t, "GET", "/api/data/types")).body.types as {
      id: string;
      done?: string;
      fields: { id: string; name: string }[];
    }[];
    const agenda = types.find((x) => x.id === "t_agenda");
    // The box the calendar marks tasks done with; a collection that keeps no tasks has none.
    expect(agenda?.fields.find((f) => f.id === agenda.done)?.name).toBe("Hecha");
    expect(types.find((x) => x.id === "t_libro")?.done).toBeUndefined();
    const r = await call(t, "GET", "/api/data/today?tz=UTC");
    expect(r.body.day).toBe(day(0));
    expect(r.body.items).toMatchObject([
      {
        title: "Llamar al fontanero",
        type: "t_agenda",
        task: true,
        done: false,
        doneField: agenda?.done,
      },
    ]);
    expect((await call(t, "GET", "/api/data/today?tz=Marte%2FOlimpo")).status).toBe(400);
  });
});
