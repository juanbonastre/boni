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
import { calendarDefs, storedCalendarDefs } from "./calendarStore.ts";
import { notesInTree, rowUiOf } from "./data.ts";
import { type Db, openDb } from "./db.ts";
import { installed } from "./extensions.ts";
import { Feeds } from "./feeds.ts";
import { flowCatalog } from "./flows.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";

/**
 * The actions of «Calendarios», of a collection's tabs and its notes in the tree, and of «Extensiones»
 * (docs/sistema.md §4.1, F10) as Juan asks for them in the conversation and as an assistant runs them by the MCP, over
 * HTTP with a scripted planner (no model, no network), on a collection shaped like his: generated ids, fields named in
 * Spanish with accents, a date role.
 */
const SIGN_IN = "una contraseña larga de ejemplo";
const lit = (v: unknown) => ({ lit: v });
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
let server: Server;
let base: string;
const plans: unknown[] = [];
const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
const VIAJE = newId("t");
const F = { titulo: newId("f"), salida: newId("f"), tipo: newId("f") };

type Turn = {
  run: string;
  status: string;
  error: string | null;
  pending: { kind: string; id: string } | null;
};
async function login() {
  const r = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: SIGN_IN, device: "portatil-ejemplo" }),
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
const turnOf = async (token: string, text: string, tool: string, args: Record<string, unknown>) => {
  plans.push({
    version: 1,
    steps: [
      {
        id: "a",
        op: "call",
        tool,
        args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, lit(v)])),
      },
    ],
  });
  return (await post(token, "/api/agent/turn", { text })) as unknown as Turn;
};
const confirm = async (token: string, turn: Turn) =>
  (await post(token, "/api/agent/confirm", {
    run: turn.run,
    confirmation: turn.pending?.id,
  })) as unknown as Turn;
const undo = async (token: string, run: string) => {
  const r = await post(token, `/api/agent/runs/${run}/undo`);
  return r.undone ?? r.error;
};
const mcpOf = (token: string) => async (name: string, args: Record<string, unknown>) => {
  const r = (
    (await post(token, "/api/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    })) as { result: { content: { text: string }[]; isError: boolean } }
  ).result;
  let out: unknown = null;
  try {
    out = JSON.parse(r.content[0]?.text ?? "null");
  } catch {
    out = r.content[0]?.text;
  }
  return { error: r.isError, out };
};
const mine = () => calendarDefs(host.store(1)).filter((p) => p.type === VIAJE);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-calendar-actions-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", SIGN_IN);
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
  server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = host.store(1);
  const opt = (name: string) => ({ id: newId("o"), name, label: own });
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: VIAJE,
        key: "viajes",
        name: "Viajes",
        fields: [
          { id: F.titulo, key: "titulo", name: "Título", type: "text", label: own },
          { id: F.salida, key: "salida", name: "Salida", type: "date", label: own },
          {
            id: F.tipo,
            key: "tipo",
            name: "Tipo",
            type: "select",
            options: [opt("Trabajo"), opt("Familia")],
            label: own,
          },
        ],
        titleField: F.titulo,
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.applySchema(
    { op: "set_roles", type: VIAJE, roles: { date: F.salida } },
    { actor: "import" },
  );
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  app.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the list of actions: «Calendarios», a collection's tabs and tree, «Extensiones» (docs/sistema.md §4.1, F10)", () => {
  it("«pon Viajes como calendario, sepáralo por Tipo, en verde y con aviso un día antes»: done in his turn, taking it away is his card, and Undo of the run takes each back", async () => {
    const token = await login();
    const seen = await turnOf(token, "¿qué calendarios tengo?", "calendars.list", {});
    expect(seen.status).toBe("done");

    const added = await turnOf(token, "pon Viajes como calendario", "calendars.add", {
      type: "viajes",
    });
    expect(added.status).toBe("done");
    expect(mine()).toHaveLength(1);
    const id = mine()[0]?.def.id as string;

    const split = await turnOf(token, "sepáralo por Tipo", "calendars.split", {
      calendar: id,
      field: "Tipo",
    });
    expect(split.status).toBe("done");
    expect(storedCalendarDefs(host.store(1)).find((s) => s.raw.id === id)?.split?.field).toBe(
      F.tipo,
    );
    // A field it cannot be split by is refused.
    const bad = await turnOf(token, "sepáralo por Título", "calendars.split", {
      calendar: id,
      field: "Título",
    });
    expect(bad.status).not.toBe("done");
    const whole = await turnOf(token, "júntalo otra vez", "calendars.split", {
      calendar: id,
      field: null,
    });
    expect(whole.status).toBe("done");
    expect(storedCalendarDefs(host.store(1)).find((s) => s.raw.id === id)?.split).toBeFalsy();

    const green = await turnOf(token, "ponlo en verde", "calendars.color", {
      calendar: id,
      color: "#22c55e",
    });
    expect(green.status).toBe("done");
    expect(mine()[0]?.def.color).toBe("#22c55e");
    const red = await turnOf(token, "en rojo", "calendars.color", { calendar: id, color: "rojo" });
    expect(red.status).not.toBe("done");

    const warn = await turnOf(token, "avísame un día antes", "calendars.reminders", {
      calendar: id,
      all_day: "1d@18:00",
    });
    expect(warn.status).toBe("done");
    expect(JSON.stringify(mine()[0]?.raw.reminders)).toContain("1d@18:00");

    // Undo of a run takes back what it did, newest first: an older one, while a later change stands on the same
    // calendars, waits (a change since then wins).
    expect(await undo(token, green.run)).toBe("cannot-undo");
    expect(await undo(token, warn.run)).toBe(1);
    expect(JSON.stringify(mine()[0]?.raw.reminders ?? null)).not.toContain("1d@18:00");
    expect(await undo(token, green.run)).toBe(1);
    expect(mine()[0]?.def.color).not.toBe("#22c55e");

    // Taking it away: his card first (P5); its records stay; Undo brings it back.
    const away = await turnOf(token, "quita el calendario de Viajes", "calendars.remove", {
      calendar: id,
    });
    expect(away.pending?.kind).toBe("confirm");
    expect(mine()).toHaveLength(1);
    expect((await confirm(token, away)).status).toBe("done");
    expect(mine()).toHaveLength(0);
    expect(host.store(1).schema().types[VIAJE]).toBeTruthy();
    expect(await undo(token, away.run)).toBe(1);
    expect(mine()).toHaveLength(1);
    // With every later change taken back, the run that added it takes it away.
    expect(await undo(token, added.run)).toBe(1);
    expect(mine()).toHaveLength(0);
  });

  it("a collection's tab and its notes in the tree, in his turn, with Undo", async () => {
    const token = await login();
    const store = host.store(1);
    const tab = await turnOf(token, "haz una pestaña Por salida, en tablero", "schema.set_view", {
      type: "viajes",
      name: "Por salida",
      view: { layout: "board", group: "Tipo" },
    });
    expect(tab.error).toBeNull();
    expect(tab.status).toBe("done");
    expect(rowUiOf(store, VIAJE).views.map((v) => [v.name, v.layout])).toEqual([
      ["Por salida", "board"],
    ]);
    const gone = await turnOf(token, "quita esa pestaña", "schema.set_view", {
      type: "viajes",
      name: "Por salida",
      remove: true,
    });
    expect(gone.status).toBe("done");
    expect(rowUiOf(store, VIAJE).views).toEqual([]);
    expect(await undo(token, gone.run)).toBe(1);
    expect(rowUiOf(store, VIAJE).views).toHaveLength(1);

    const was = notesInTree(store, store.schema().types[VIAJE] as never);
    const tree = await turnOf(token, "enseña sus notas en el árbol", "schema.set_tree", {
      type: "viajes",
      on: !was,
    });
    expect(tree.status).toBe("done");
    expect(notesInTree(store, store.schema().types[VIAJE] as never)).toBe(!was);
    expect(await undo(token, tree.run)).toBe(1);
    expect(notesInTree(store, store.schema().types[VIAJE] as never)).toBe(was);
  });

  it("an assistant by the MCP: the calendars, a tab and the tree, and its `undo` takes them back", async () => {
    const token = await login();
    const mcp = mcpOf(token);
    const list = await mcp("calendars", {});
    expect(list.error).toBe(false);
    expect((list.out as { could: string[] }).could).toContain("viajes");
    const made = await mcp("calendars_add", { type: "viajes" });
    expect(made.error).toBe(false);
    const cal = (made.out as { id: string }).id;
    const runs = [(made.out as { run: string }).run];
    const write = async (name: string, args: Record<string, unknown>) => {
      const r = await mcp(name, args);
      expect(r.error).toBe(false);
      runs.push((r.out as { run: string }).run);
    };
    await write("calendars_color", { calendar: cal, color: "#0ea5e9" });
    expect(mine()[0]?.def.color).toBe("#0ea5e9");
    await write("calendars_split", { calendar: cal, field: "Tipo" });
    await write("calendars_split", { calendar: cal, field: null });
    await write("calendars_reminders", { calendar: cal, timed: "10m" });
    await write("collection_view", { type: "viajes", name: "Lista", view: { layout: "list" } });
    expect(rowUiOf(host.store(1), VIAJE).views.some((v) => v.name === "Lista")).toBe(true);
    await write("collection_view", { type: "viajes", name: "Lista", view: null });
    expect(rowUiOf(host.store(1), VIAJE).views.some((v) => v.name === "Lista")).toBe(false);
    await write("notes_in_tree", { type: "viajes", on: "true" });
    // Its collection closed to the models: its calendar is not theirs to change.
    host.store(1).setAiAccess(VIAJE, "opaque", "portatil-ejemplo");
    const closed = await mcp("calendars_color", { calendar: cal, color: "#f97316" });
    expect(closed.error).toBe(true);
    expect(mine()[0]?.def.color).not.toBe("#f97316");
    host.store(1).setAiAccess(VIAJE, "visible", "portatil-ejemplo");
    // Its `undo`, each write newest first: everything it did is taken back.
    const undone: number[] = [];
    for (const run of [...runs].reverse()) {
      const back = await mcp("undo", { run });
      expect(back.error).toBe(false);
      undone.push((back.out as { undone: number }).undone);
    }
    expect(undone).toEqual(runs.map(() => 1));
    expect(mine()).toHaveLength(0);
    expect(rowUiOf(host.store(1), VIAJE).views.some((v) => v.name === "Lista")).toBe(false);
    // A calendar that is not there is refused.
    expect((await mcp("calendars_color", { calendar: "nada", color: "#0ea5e9" })).error).toBe(true);
  });

  it("«desactiva la extensión del correo»: his touch on the card, never alone or in a flow, and Undo switches it back", async () => {
    const token = await login();
    const store = host.store(1);
    const ext = installed(store)[0];
    expect(ext?.enabled).toBe(true);
    const off = await turnOf(token, "desactiva la extensión del correo", "extensions.enable", {
      extension: ext?.manifest.name,
      on: false,
    });
    expect(off.pending?.kind).toBe("confirm");
    expect(installed(store)[0]?.enabled).toBe(true);
    expect((await confirm(token, off)).status).toBe("done");
    expect(installed(store)[0]?.enabled).toBe(false);
    expect(await undo(token, off.run)).toBeGreaterThan(0);
    expect(installed(store)[0]?.enabled).toBe(true);
    // Not a step of «Añadir paso», nor the mail's: his touch, and what only a turn asks (P21, flows.ts TURN_ONLY).
    const steps = JSON.stringify(flowCatalog(host.tools, store, []));
    for (const n of [
      "extensions.enable",
      "connectors.mail",
      "connectors.mail_check",
      "connectors.mail_reread",
      "connectors.mail_guide",
    ])
      expect(steps).not.toContain(`"${n}"`);
    expect(steps).toContain('"calendars.add"');
  });
});
