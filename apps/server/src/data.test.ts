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
import { Vaults } from "./vaults.ts";

const PASSWORD = "una contraseña larga de ejemplo";
let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let http: HttpServer;
let base = "";

const L = label("user", "personal", [{ kind: "user-edit", id: "test" }]);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-data-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "ana", PASSWORD, "");
  host = new AgentHost({ dataDir: dir, providers: null });
  app = makeApp({
    db,
    vaults: new Vaults(),
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
    // A note imported without a title property shows its file's name.
    host.store(1).applySchema(
      {
        op: "add_field",
        type: "t_libro",
        field: {
          id: "f_vault_path",
          key: "vault_path",
          name: "Ruta",
          type: "text",
          hidden: true,
          label: L,
        },
      },
      { actor: "system" },
    );
    const noTitle = host
      .store(1)
      .create(
        "t_libro",
        { f_vault_path: { value: "Boni/Libros/La tregua.md", label: L } },
        { actor: "import" },
      );
    const listed = (await call(t, "GET", "/api/data/types/t_libro/rows")).body.rows as {
      id: string;
      values: Record<string, unknown>;
    }[];
    expect(listed.find((r) => r.id === noTitle.entity.id)?.values.f_titulo).toBe("La tregua");
    // Found by its note's path (Boni Calendar's "Abrir en Boni").
    const at = await call(
      t,
      "GET",
      `/api/data/lookup?path=${encodeURIComponent("Boni/Libros/La tregua.md")}`,
    );
    expect(at.body).toEqual({ type: "t_libro", id: noTitle.entity.id });
    expect((await call(t, "GET", "/api/data/lookup?path=nada.md")).status).toBe(404);
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
    expect(await ui()).toEqual({ open: false, hidden: [] });
    const r = await call(t, "PUT", "/api/data/types/t_libro/row-ui", {
      open: true,
      hidden: ["f_paginas"],
    });
    expect(r.body).toEqual({ open: true, hidden: ["f_paginas"] });
    // Another device of the account sees the same.
    const other = await token("otro-equipo");
    const theirs = (await call(other, "GET", "/api/data/types")).body.types as {
      id: string;
      rowUi: unknown;
    }[];
    expect(theirs.find((x) => x.id === "t_libro")?.rowUi).toEqual({
      open: true,
      hidden: ["f_paginas"],
    });
    expect(
      (await call(t, "PUT", "/api/data/types/t_libro/row-ui", { hidden: ["f_nada"] })).status,
    ).toBe(400);
    expect((await call(t, "PUT", "/api/data/types/t_nada/row-ui", { open: true })).status).toBe(
      404,
    );
    await call(t, "PUT", "/api/data/types/t_libro/row-ui", { open: false });
    expect(await ui()).toEqual({ open: false, hidden: ["f_paginas"] });
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
    expect(calls).toMatchObject({ system: true, level: "private", count: 3 });
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
    const mcp = mcpAnswer(
      store,
      "portatil-ejemplo",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "collections", arguments: {} },
      },
      Date.now,
    ) as { result: { content: { text: string }[] } };
    expect(mcp.result.content[0]?.text).not.toContain("t_sys_");
    expect(mcp.result.content[0]?.text).not.toContain("Llamadas a modelos");
  });
});
