import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueSession } from "@boni/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { addUser } from "./auth.ts";
import { findByPath, treeNotes } from "./data.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { seed } from "./seed.test-util.ts";

/** Invented notes (never real ones): the instructions, two projects, a journal entry kept from the AI. */
const NOTES: Record<string, string> = {
  "AGENTS.md": "# AGENTS.md\n\nInstrucciones inventadas: habla en español.\n",
  "proyectos/boni-plan.md":
    "---\ntype: project\nstatus: activo\nsummary: Plan inventado.\n---\n# Plan\n\n## Registro\n- 2026-10-01 - Empezado.\n",
  "proyectos/otro.md": "---\ntype: project\nstatus: pausado\n---\nOtro proyecto inventado.\n",
  "diario/2026-10-20.md": "---\ntype: journal\n---\nUn día inventado y privado.\n",
};

let dir: string;
let db: Db;
let host: AgentHost;
let app: App;
let http: HttpServer;
let base = "";
let token = "";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-mcp-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "ana", "una contraseña larga de ejemplo");
  host = new AgentHost({ dataDir: dir, providers: null });
  seed(
    host.store(1),
    [
      { key: "nota", name: "Nota", folder: "" },
      { key: "proyecto", name: "Proyecto", folder: "proyectos/" },
      {
        key: "diario",
        name: "Diario",
        folder: "diario/",
        sensitivity: "sensitive",
        ai: "restricted",
      },
    ],
    NOTES,
  );
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
  token = issueSession(db, "ana", "claude-code", { listener: "tailnet" })?.token as string;
});

afterAll(async () => {
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function rpc(method: string, params?: unknown, t = token) {
  const r = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }),
  });
  return {
    status: r.status,
    body: r.status === 202 ? null : ((await r.json()) as Record<string, unknown>),
  };
}
async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  const res = r.body?.result as { content: { text: string }[]; isError: boolean };
  const text = res.content[0]?.text ?? "";
  return { error: res.isError, text, json: res.isError ? null : JSON.parse(text) };
}

describe("Boni's MCP (what vault-mcp did, over Boni's collections)", () => {
  it("speaks MCP: initialize, the tool list, notifications, only for a session", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    expect(init.body?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "boni" },
    });
    const note = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);
    const listed = (await rpc("tools/list")).body as { result: { tools: { name: string }[] } };
    const names = listed.result.tools.map((t) => t.name);
    expect(names).toEqual([
      "guide",
      "collections",
      "search",
      "query",
      "read",
      "create",
      "upload_file",
      "edit",
      "append",
      "set_properties",
      "recent_changes",
      "trash",
      "set_description",
      "create_collection",
      "finanzas_import",
      "finanzas_close",
      "undo",
    ]);
    expect((await rpc("tools/list", undefined, "nada")).status).toBe(401);
    expect(
      (await fetch(`${base}/api/mcp`, { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(405);
  });

  it("reads as a model may: the guide, collections without what is kept from the AI, search, query, read", async () => {
    expect((await tool("guide")).json.instructions).toContain("habla en español");
    const cols = (await tool("collections")).json as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("Proyecto");
    expect(cols.map((c) => c.name)).not.toContain("Diario"); // kept from the AI by the import
    const found = (await tool("search", { query: "plan inventado" })).json as { path: string }[];
    expect(found.map((f) => f.path)).toContain("proyectos/boni-plan.md");
    expect((await tool("search", { query: "privado" })).json).toEqual([]);
    const active = (
      await tool("query", {
        collection: "Proyecto",
        filter: [{ property: "status", op: "is", value: "activo" }],
      })
    ).json as { path: string }[];
    expect(active.map((n) => n.path)).toEqual(["proyectos/boni-plan.md"]);
    const plan = (await tool("read", { path: "proyectos/boni-plan.md" })).json;
    expect(plan).toMatchObject({ collection: "Proyecto", properties: { status: "activo" } });
    expect(plan.body).toContain("## Registro");
    expect((await tool("read", { path: "diario/2026-10-20.md" })).error).toBe(true);
  });

  it("the guide is computed: the instructions, every collection with what goes in it, the tools from the code", async () => {
    const store = host.store(1);
    const proyecto = Object.values(store.schema().types).find((t) => t.name === "Proyecto");
    type Col = { name: string; description?: string; notes: number; level: string };
    const guide = (await tool("guide")).json as {
      instructions: string;
      collections: Col[];
      tools: { name: string }[];
    };
    expect(guide.instructions).toContain("habla en español");
    expect(guide.collections.map((c) => c.name)).toContain("Proyecto");
    expect(guide.collections.map((c) => c.name)).not.toContain("Diario");
    const listed = (await rpc("tools/list")).body as { result: { tools: { name: string }[] } };
    expect(guide.tools.map((t) => t.name)).toEqual(listed.result.tools.map((t) => t.name));
    // A collection's description reaches every assistant at once: there is no index to keep up to date by hand.
    const said = await tool("set_description", {
      collection: "Proyecto",
      description: "Proyectos inventados, uno por nota.",
    });
    expect(said.error).toBe(false);
    const described = ((await tool("guide")).json.collections as Col[]).find(
      (c) => c.name === "Proyecto",
    );
    expect(described).toMatchObject({ description: "Proyectos inventados, uno por nota." });
    expect(
      ((await tool("collections")).json as Col[]).find((c) => c.name === "Proyecto")?.description,
    ).toBe("Proyectos inventados, uno por nota.");
    // The text is a model's, and the change is one run undone like any other write.
    expect(store.schema().types[proyecto?.id as string]?.description?.label.integrity).toBe(
      "model",
    );
    expect((await tool("undo", { run: said.json.run })).json.undone).toBe(1);
    expect(
      ((await tool("guide")).json.collections as Col[]).find((c) => c.name === "Proyecto")
        ?.description,
    ).toBeUndefined();
    // From the first time on, the instructions are found by their id: the note may move.
    const id = store.setting("mcp/instructions");
    expect(store.get(id as string)?.entity.body).toContain("habla en español");
  });

  it("makes a collection, finds a note by its title, reads page by page, trashes several notes in one run", async () => {
    const made = await tool("create_collection", {
      name: "Cola inventada",
      description: "Lo pendiente de un proyecto inventado, una fila por paso.",
      properties: [
        { name: "Estado", type: "select", options: ["pendiente", "hecho"] },
        { name: "Orden", type: "number" },
      ],
    });
    expect(made.error).toBe(false);
    expect(made.json.properties).toEqual(["Título", "Estado", "Orden"]);
    const listed = ((await tool("guide")).json.collections as { name: string }[]).find(
      (c) => c.name === "Cola inventada",
    );
    expect(listed).toMatchObject({
      description: "Lo pendiente de un proyecto inventado, una fila por paso.",
      notes: 0,
      level: "visible",
    });
    expect(
      (await tool("create_collection", { name: "cola inventada", description: "x" })).text,
    ).toContain("already");
    expect(
      (
        await tool("create_collection", {
          name: "Otra inventada",
          description: "x",
          properties: [{ name: "Enlace", type: "relation" }],
        })
      ).error,
    ).toBe(true);
    // A collection made by mistake goes back with its run while it is empty.
    const spare = await tool("create_collection", { name: "Sobra inventada", description: "x" });
    expect((await tool("undo", { run: spare.json.run })).json.undone).toBe(1);
    expect(
      ((await tool("collections")).json as { name: string }[]).map((c) => c.name),
    ).not.toContain("Sobra inventada");

    const ids: string[] = [];
    for (let i = 1; i <= 3; i++)
      ids.push(
        (
          await tool("create", {
            collection: "Cola inventada",
            title: `Paso ${i}`,
            properties: { Estado: "pendiente", Orden: i },
          })
        ).json.id,
      );
    // Found by its collection and exact title, with no path.
    expect((await tool("read", { collection: "Cola inventada", title: "paso 2" })).json.id).toBe(
      ids[1],
    );
    const page = async (offset: number) =>
      (
        (await tool("query", { collection: "Cola inventada", limit: 2, offset })).json as {
          id: string;
        }[]
      ).map((n) => n.id);
    expect([...(await page(0)), ...(await page(2))].sort()).toEqual([...ids].sort());
    // Several notes in one call are one run, undone together.
    const gone = await tool("trash", { ids });
    expect(gone.json.trashed).toBe(3);
    expect((await tool("query", { collection: "Cola inventada" })).json).toEqual([]);
    expect((await tool("undo", { run: gone.json.run })).json.undone).toBe(3);
    expect((await tool("query", { collection: "Cola inventada" })).json).toHaveLength(3);
    // A filter names an option as notes show it (any case), never by its id.
    await tool("set_properties", { id: ids[2], properties: { Estado: "hecho" } });
    const done = await tool("query", {
      collection: "Cola inventada",
      filter: [{ property: "Estado", op: "is", value: "Hecho" }],
    });
    expect((done.json as { id: string }[]).map((n) => n.id)).toEqual([ids[2]]);
    // A call trashes everything it names or nothing: the private diary is not for a model.
    const diary = host.store(1).findByValue("f_vault_path", "diario/2026-10-20.md")[0]?.id;
    expect((await tool("trash", { ids: [ids[0], diary] })).error).toBe(true);
    expect((await tool("read", { id: ids[0] })).error).toBe(false);
  });

  it("writes as a model, each call one run that can be undone", async () => {
    const appended = await tool("append", {
      path: "proyectos/boni-plan.md",
      text: "- 2026-10-22 - Entrada escrita por el MCP.",
    });
    expect(appended.error).toBe(false);
    const plan = (await tool("read", { path: "proyectos/boni-plan.md" })).json;
    expect(plan.body).toMatch(/Empezado\.\n- 2026-10-22 - Entrada escrita por el MCP\.$/);
    const e = host.store(1).get(plan.id);
    expect(e?.labels.$body).toMatchObject({ integrity: "model" });

    expect(
      (await tool("edit", { id: plan.id, old_text: "Empezado.", new_text: "Empezado de nuevo." }))
        .error,
    ).toBe(false);
    expect((await tool("edit", { id: plan.id, old_text: "no está", new_text: "x" })).text).toBe(
      "old_text not found",
    );
    expect((await tool("edit", { id: plan.id, body: "todo nuevo", version: 1 })).text).toContain(
      "read again",
    );

    const set = await tool("set_properties", { id: plan.id, properties: { status: "terminado" } });
    expect(set.error).toBe(false);
    expect((await tool("read", { id: plan.id })).json.properties.status).toBe("terminado");
    expect((await tool("set_properties", { id: plan.id, properties: { nada: 1 } })).text).toContain(
      'no property "nada"',
    );

    const made = await tool("create", {
      collection: "Proyecto",
      title: "Nuevo inventado",
      properties: { status: "activo" },
      body: "Hecho por el MCP.",
    });
    // Known by its id: a new note has no path.
    const fresh = (await tool("read", { id: made.json.id })).json;
    expect(fresh.title).toBe("Nuevo inventado");
    expect(fresh.path).toBeUndefined();
    expect((await tool("create", { collection: "Diario", title: "x" })).error).toBe(true);

    const changes = (await tool("recent_changes", { limit: 5 })).json as {
      run: string;
      by: string;
    }[];
    expect(changes[0]).toMatchObject({ run: made.json.run, by: "claude-code" });
    expect((await tool("undo", { run: made.json.run })).json.undone).toBe(1);
    expect((await tool("read", { id: made.json.id })).error).toBe(true);
    expect((await tool("undo", { run: "import-1" })).error).toBe(true);
  });

  it("leaves every call in the audit: what went back to the model (fields, the text or not) and what it wrote", async () => {
    const store = host.store(1);
    const before = store.audit.actions({ limit: 1 })[0]?.seq ?? 0;
    const found = (await tool("search", { query: "otro proyecto" })).json as { id: string }[];
    const otro = found[0]?.id as string;
    await tool("read", { id: otro });
    await tool("read", { path: "diario/2026-10-20.md" });
    const made = await tool("create", { collection: "Proyecto", title: "Auditado inventado" });
    const actions = store.audit
      .actions()
      .filter((a) => a.seq > before)
      .reverse();
    expect(actions.map((a) => [a.by, a.tool])).toEqual([
      ["mcp:claude-code", "mcp.search"],
      ["mcp:claude-code", "mcp.read"],
      ["mcp:claude-code", "mcp.read"],
      ["mcp:claude-code", "mcp.create"],
    ]);
    const seen = store.audit.accessOf(actions.map((a) => a.seq));
    // The search gave its properties, not its text; the read gave the text too; the private diary nothing.
    expect(seen.get(actions[0]?.seq as number)?.find((x) => x.entity === otro)?.body).toBeNull();
    expect(seen.get(actions[1]?.seq as number)?.find((x) => x.entity === otro)?.body).toBe("text");
    expect(actions[2]?.result).toMatchObject({ error: expect.any(String) });
    expect(seen.get(actions[2]?.seq as number)).toEqual([]);
    // Its arguments are kept, without long texts; what it wrote is the operation log's, by the same run.
    expect(actions[0]?.target).toEqual({ query: "otro proyecto" });
    expect(actions[3]?.run).toBe(made.json.run);
    expect(store.audit.meta([made.json.id]).get(made.json.id)).toMatchObject({
      createdBy: "mcp:claude-code",
    });
    expect(store.audit.verify().ok).toBe(true);
    // «Todas las páginas» lists each note with the assistants that read it (the guide read AGENTS.md).
    const aiOf = (path: string) => {
      const at = findByPath(store, path);
      return treeNotes(store, at.type).find((n) => n.id === at.id)?.ai;
    };
    expect(aiOf("AGENTS.md")).toEqual(["mcp:claude-code"]);
    expect(aiOf("proyectos/otro.md")).toEqual(["mcp:claude-code"]);
    expect(aiOf("diario/2026-10-20.md")).toEqual([]);
  });
});

describe("collections as classes through the MCP (docs/clases.md)", () => {
  it("a collection made inside another: it has her properties, and her queries include its notes", async () => {
    const made = await tool("create_collection", {
      name: "Cursos",
      description: "Cursos inventados.",
      inside: "Proyecto",
      properties: [{ name: "Horas", type: "number" }],
    });
    expect(made.error, made.text).toBe(false);
    const cols = (await tool("collections")).json as {
      name: string;
      inside?: string;
      properties: { name: string }[];
    }[];
    const cursos = cols.find((x) => x.name === "Cursos");
    expect(cursos?.inside).toBe("Proyecto");
    expect(cursos?.properties.map((p) => p.name)).toEqual(
      expect.arrayContaining(["status", "Horas"]),
    );
    const note = await tool("create", {
      collection: "Cursos",
      title: "Curso inventado",
      properties: { status: "activo", Horas: 3 },
    });
    expect(note.error, note.text).toBe(false);
    const active = (
      await tool("query", {
        collection: "Proyecto",
        filter: [{ property: "status", op: "is", value: "activo" }],
      })
    ).json as { title: string; collection: string }[];
    expect(active.map((n) => [n.title, n.collection])).toContainEqual([
      "Curso inventado",
      "Cursos",
    ]);
  });

  it("a filter names a related note by its title, as notes show it", async () => {
    const store = host.store(1);
    const l = store.schema().types.t_proyecto?.label as never;
    const me = { actor: "user" as const, device: "prueba" };
    store.applySchema(
      {
        op: "add_field",
        type: "t_proyecto",
        field: {
          id: "f_madre",
          key: "madre",
          name: "Madre",
          type: "relation",
          relation: { target: "t_proyecto", many: false },
          label: l,
        },
      },
      me,
    );
    const at = (path: string) => store.findByValue("f_vault_path", path)[0]?.id as string;
    store.update(
      at("proyectos/otro.md"),
      { f_madre: { value: at("proyectos/boni-plan.md"), label: l } },
      me,
    );
    const titled = String(
      (await tool("read", { id: at("proyectos/boni-plan.md") })).json.title,
    ).toUpperCase();
    for (const [op, value] of [
      ["is", titled],
      ["contains", titled.slice(0, 3)],
    ])
      expect(
        (
          (
            await tool("query", {
              collection: "Proyecto",
              filter: [{ property: "Madre", op, value }],
            })
          ).json as { id: string }[]
        ).map((n) => n.id),
      ).toEqual([at("proyectos/otro.md")]);
    store.applySchema({ op: "remove_field", type: "t_proyecto", field: "f_madre" }, me);
  });
});
