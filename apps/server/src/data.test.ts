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
    // Only a personal device sees or changes the data.
    db.prepare("UPDATE devices SET trust = 'shared' WHERE name = 'tele-ejemplo'").run();
    const tv = await token("tele-ejemplo");
    db.prepare("UPDATE devices SET trust = 'shared' WHERE name = 'tele-ejemplo'").run();
    expect((await call(tv, "GET", "/api/data/types")).status).toBe(403);
  });
});
