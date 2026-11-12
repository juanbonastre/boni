import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { dayToIso, todayIn } from "@boni/calendar";
import { label } from "@boni/entities";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentHost, acceptCorrected } from "./agent.ts";
import { addUser, sessionUser } from "./auth.ts";
import { type Db, openDb } from "./db.ts";
import { Feeds } from "./feeds.ts";
import { ensureFlow, flowCatalog } from "./flows.ts";
import { type App, makeApp, serve } from "./http.ts";
import { LoginGuard } from "./limits.ts";
import { createPage } from "./pages.ts";
import { keep } from "./runUndo.ts";

/** The conversation API over HTTP with a scripted planner (no model, no network). */
const PASSWORD = "una contraseña larga de ejemplo";
const lit = (v: unknown) => ({ lit: v });
let dir: string;
let db: Db;
let app: App;
let host: AgentHost;
let off: App;
const servers: Server[] = [];
let base: string;
let pub: string;
let offBase: string;
const plans: unknown[] = [];
/** What the planner was asked, turn by turn. */
const asked: unknown[] = [];

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
async function login(at: string, user: string) {
  const r = await fetch(`${at}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user, password: PASSWORD, device: "movil-ejemplo" }),
  });
  return ((await r.json()) as { token: string }).token;
}
const post = (at: string, token: string, path: string, body: unknown = {}) =>
  fetch(`${at}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-agent-http-"));
  db = openDb(join(dir, "system.db"));
  addUser(db, "juan", PASSWORD);
  addUser(db, "otra", PASSWORD);
  const planner = fakePlanner([]);
  planner.complete = async (req) => {
    asked.push(req);
    return {
      json: plans.shift(),
      usage: { input: 1, output: 1 },
      model: "fake",
    };
  };
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: planner } });
  const opts = {
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
  };
  app = makeApp({ ...opts, agent: host });
  base = await listen(serve(app, "tailnet"));
  pub = await listen(serve(app, "public"));
  off = makeApp({ ...opts, agent: new AgentHost({ dataDir: dir, providers: null }) });
  offBase = await listen(serve(off, "tailnet"));
  // A type in Juan's own store for the tests (account 1).
  const store = host.store(1);
  const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_tarea",
        key: "tarea",
        name: "Tareas",
        fields: [{ id: "f_titulo", key: "titulo", name: "Título", type: "text", label: own }],
        titleField: "f_titulo",
        sensitivity: "personal",
        schemaVersion: 1,
        label: own,
      },
    },
    { actor: "user" },
  );
  store.create(
    "t_tarea",
    { f_titulo: { value: "Comprar pan", label: own } },
    { actor: "user" },
    "e_pan",
  );
});

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  app.close();
  off.close();
  host.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the conversation API", () => {
  it("runs a turn, lists it and undoes it", async () => {
    const token = await login(base, "juan");
    plans.push({
      version: 1,
      steps: [
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: {
            type: lit("tarea"),
            values: { fn: "obj", args: [lit("titulo"), { quote: "llamar al dentista" }] },
          },
        },
      ],
    });
    const r = await post(base, token, "/api/agent/turn", { text: "apunta llamar al dentista" });
    const turn = (await r.json()) as { run: string; status: string };
    expect(turn.status).toBe("done");
    expect(host.store(1).list("t_tarea").length).toBe(2);
    const runs = (await (
      await fetch(`${base}/api/agent/runs`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { runs: { id: string }[] };
    expect(runs.runs[0]?.id).toBe(turn.run);
    expect(await (await post(base, token, `/api/agent/runs/${turn.run}/undo`)).json()).toEqual({
      undone: 1,
    });
    expect(host.store(1).list("t_tarea").length).toBe(1);
  });

  it("a turn goes with what is on the screen: the references posted reach the plan as what the store holds (F9)", async () => {
    const token = await login(base, "juan");
    // A page as the first Boni's home left it: a chart of the account's saved ones, and a line of text.
    const page = createPage(host.store(1), {
      title: "Gastos",
      spec: {
        version: 1,
        blocks: [
          { id: "b3", type: "chart", chart: "spending-by-category" },
          { id: "b9", type: "text", text: "Lo que se va en comida" },
        ],
      },
    });
    plans.push({
      version: 1,
      steps: [
        {
          id: "r",
          op: "reply",
          component: "text",
          data: {
            template: lit("{a} · {b} · {c} · {d}"),
            a: { ref: "$screen.pointed[0].title" },
            b: { ref: "$screen.pointed[1].title" },
            c: { ref: "$screen.pointed[2].text" },
            d: { ref: "$screen.pointed[3].kind" },
          },
        },
      ],
    });
    const r = await post(base, token, "/api/agent/turn", {
      text: "¿qué es esto?",
      screen: {
        open: { kind: "page", id: page.id },
        inbox: [],
        chosen: [],
        pointed: [
          // What the app says of a thing counts for nothing: only its reference does.
          { kind: "block", page: page.id, block: "b3", title: "Otra cosa" },
          { kind: "row", id: "e_pan" },
          { kind: "block", page: page.id, block: "b9" },
          { kind: "row", id: "e_nada" },
        ],
      },
    });
    expect(r.status).toBe(200);
    const said = JSON.stringify(await r.json());
    // The saved chart's own name (the server's, through the app's wiring), the row's title, the page's words.
    expect(said).toContain("Gasto del mes");
    expect(said).toContain("Comprar pan");
    expect(said).toContain("Lo que se va en comida");
    expect(said).toContain("gone");
    expect(said).not.toContain("Otra cosa");
    // What is not a reference is refused whole.
    for (const pointed of [
      [{ kind: "node", id: "n1" }],
      [{ page: page.id, block: "b3" }],
      ["e_pan"],
    ])
      expect(
        (await post(base, token, "/api/agent/turn", { text: "¿y esto?", screen: { pointed } }))
          .status,
      ).toBe(400);
  });

  it("confirms from the device that asked, and not from another account", async () => {
    const token = await login(base, "juan");
    plans.push({
      version: 1,
      steps: [{ id: "d", op: "call", tool: "entities.delete", args: { id: lit("e_pan") } }],
    });
    const turn = (await (
      await post(base, token, "/api/agent/turn", { text: "borra la tarea del pan" })
    ).json()) as {
      run: string;
      pending: { kind: string; id: string; view: { rows: { value: string }[] } };
    };
    expect(turn.pending.kind).toBe("confirm");
    expect(turn.pending.view.rows[0]?.value).toBe("e_pan");
    // Another account cannot see or confirm Juan's run (it has its own agent and store).
    const other = await login(base, "otra");
    const foreign = (await (
      await post(base, other, "/api/agent/confirm", {
        run: turn.run,
        confirmation: turn.pending.id,
      })
    ).json()) as { error: string };
    expect(foreign.error).toBe("nothing-pending");
    expect(host.store(1).get("e_pan")?.entity.deleted).toBeUndefined();
    const done = (await (
      await post(base, token, "/api/agent/confirm", {
        run: turn.run,
        confirmation: turn.pending.id,
      })
    ).json()) as { status: string };
    expect(done.status).toBe("done");
    expect(host.store(1).get("e_pan")?.entity.deleted).toBeDefined();
  });

  it("a question from background work waits in the panel and goes on when answered", async () => {
    const token = await login(base, "juan");
    const other = await login(base, "otra");
    const h = { authorization: `Bearer ${token}` };
    const events: string[] = [];
    const off = host.subscribe(1, (event) => events.push(event));
    const ask = (title: string) => ({
      version: 1,
      steps: [
        {
          id: "q",
          op: "ask",
          control: "choice",
          prompt: lit("¿Qué título le pongo?"),
          options: { fn: "list", args: [lit(title), lit("Otra cosa")] },
        },
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: { type: lit("tarea"), values: { fn: "obj", args: [lit("titulo"), { ref: "$q" }] } },
        },
      ],
    });
    const r = await host.agent(1).background(ask("Revisar la caldera"));
    const r2 = await host.agent(1).background(ask("Llamar al fontanero"));
    off();
    expect(r.status).toBe("waiting");
    expect(events.filter((e) => e === "requests")).toHaveLength(2);
    const list = (await (await fetch(`${base}/api/agent/requests`, { headers: h })).json()) as {
      requests: { id: string; run: string; view: { prompt: { value: string } } }[];
    };
    expect(list.requests.map((x) => x.run)).toEqual([r.run, r2.run]);
    expect(list.requests[0]?.view.prompt.value).toBe("¿Qué título le pongo?");
    const [first, second] = list.requests;
    // Another account cannot answer it (its store has no such request).
    expect(
      (await post(base, other, `/api/agent/requests/${first?.id}/answer`, { choice: 0 })).status,
    ).toBe(404);
    const done = (await (
      await post(base, token, `/api/agent/requests/${first?.id}/answer`, { choice: 0 })
    ).json()) as { status: string; proposals: string[] };
    expect(done).toMatchObject({ status: "done" });
    expect(done.proposals).toHaveLength(1);
    expect(
      await (await post(base, token, `/api/agent/requests/${second?.id}/dismiss`)).json(),
    ).toEqual({ dismissed: true });
    const after = (await (await fetch(`${base}/api/agent/requests`, { headers: h })).json()) as {
      requests: unknown[];
    };
    expect(after.requests).toEqual([]);
    expect((await fetch(`${pub}/api/agent/requests`, { headers: h })).status).toBe(404);
  });

  it("is only on the tailnet, needs a session, and says when it is off", async () => {
    const token = await login(base, "juan");
    expect((await post(pub, token, "/api/agent/turn", { text: "hola" })).status).toBe(404);
    expect((await fetch(`${pub}/api/agent/events`)).status).toBe(404);
    expect((await post(base, "token-inventado", "/api/agent/turn", { text: "hola" })).status).toBe(
      401,
    );
    expect((await post(base, token, "/api/agent/turn", {})).status).toBe(400);
    const r = await post(offBase, token, "/api/agent/turn", { text: "hola" });
    expect([r.status, await r.json()]).toEqual([503, { error: "agent-off" }]);
    // Its notices' stream stays open with the models off: the desktop app keeps it (task 62).
    const events = await fetch(`${offBase}/api/agent/events`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(events.status).toBe(200);
    await events.body?.cancel();
  });

  it("tells the account's devices what the agent notifies", async () => {
    const token = await login(base, "juan");
    const events = await fetch(`${base}/api/agent/events`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": connected\n\n");
    plans.push({
      version: 1,
      steps: [
        { id: "n", op: "call", tool: "notify", args: { text: { quote: "sacar la basura" } } },
      ],
    });
    await post(base, token, "/api/agent/turn", { text: "avísame: sacar la basura" });
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: notify\ndata: {"text":"sacar la basura","integrity":"user"}\n\n',
    );
    await reader.cancel();
  });

  it("what the models may see: listed per type, changed from a personal device only", async () => {
    const token = await login(base, "juan");
    const auth = { authorization: `Bearer ${token}` };
    const list = async () =>
      (
        (await (await fetch(`${base}/api/agent/visibility`, { headers: auth })).json()) as {
          types: { id: string; level: string; count: number }[];
        }
      ).types;
    expect((await list()).find((t) => t.id === "t_tarea")).toMatchObject({ level: "visible" });
    const put = (level: string, type = "t_tarea") =>
      fetch(`${base}/api/agent/visibility/${type}`, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ level }),
      });
    expect((await put("restricted")).status).toBe(200);
    expect((await list()).find((t) => t.id === "t_tarea")).toMatchObject({ level: "restricted" });
    expect((await put("secreto")).status).toBe(400);
    expect((await put("restricted", "memory")).status).toBe(404);
    // Not on the public entry; and a shared device cannot change it.
    expect((await fetch(`${pub}/api/agent/visibility`, { headers: auth })).status).toBe(404);
    const s = sessionUser(db, token);
    const trust = (t: string) =>
      db.prepare("UPDATE devices SET trust = ? WHERE name = ?").run(t, s?.device ?? "");
    trust("shared");
    expect((await put("visible")).status).toBe(403);
    trust("personal");
    expect((await put("visible")).status).toBe(200);
    // Private is locked: lowering it needs the unlock the collection's page sends.
    expect((await put("private")).status).toBe(200);
    expect((await put("visible")).status).toBe(409);
    const unlock = await fetch(`${base}/api/agent/visibility/t_tarea`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ level: "visible", unlock: true }),
    });
    expect(unlock.status).toBe(200);
  });
});

describe("Juan's conversations (docs/conversacion.md 3.1, 3.5)", () => {
  const get = async (token: string, path: string) =>
    fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const ask = {
    version: 1,
    steps: [{ id: "q", op: "ask", control: "text", prompt: lit("¿Qué día?") }],
  };
  const count = {
    version: 1,
    steps: [
      {
        id: "n",
        op: "call",
        tool: "entities.aggregate",
        args: { type: lit("tarea"), op: lit("count") },
      },
      {
        id: "r",
        op: "reply",
        component: "number",
        data: { value: { ref: "$n" }, caption: lit("tareas") },
      },
    ],
  };

  it("a sent message keeps its chips: the conversation shows them after a reload, and the planner never gets their words (I-33)", async () => {
    const token = await login(base, "juan");
    const made = (await (await post(base, token, "/api/agent/conversations")).json()) as {
      conversation: { id: string };
    };
    const id = made.conversation.id;
    const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
    host
      .store(1)
      .create(
        "t_tarea",
        { f_titulo: { value: "Regar las plantas", label: own } },
        { actor: "user" },
        "e_regar",
      );
    plans.length = 0;
    plans.push({
      version: 1,
      steps: [
        {
          id: "r",
          op: "reply",
          component: "text",
          data: {
            template: lit("{a} · {b}"),
            a: { ref: "$screen.pointed[0].title" },
            b: { ref: "$screen.open.view.layout" },
          },
        },
      ],
    });
    asked.length = 0;
    const chips = [
      { ref: { kind: "row", id: "e_regar" }, title: "Fila · Lo que la app pinta" },
      { ref: { kind: "node", id: "conn:mail" }, title: "Nodo · Correo" },
    ];
    const r = await post(base, token, "/api/agent/turn", {
      text: "¿qué es esto?",
      conversation: id,
      screen: {
        open: { kind: "collection", id: "t_tarea" },
        inbox: [],
        chosen: [],
        pointed: chips.map((c) => c.ref),
        visible: [{ kind: "row", id: "e_regar" }],
        focus: { kind: "row", id: "e_regar" },
        panel: { kind: "screen" },
      },
      chips,
    });
    expect(r.status).toBe(200);
    const said = JSON.stringify(await r.json());
    // The row's title and the open collection's view, as the store has them.
    expect(said).toContain('"value":"Regar las plantas"');
    expect(said).toContain('"value":"table"');
    const sent = JSON.stringify(asked);
    expect(sent).not.toContain("Lo que la app pinta");
    expect(sent).not.toContain("Nodo · Correo");
    const shown = (await (await get(token, `/api/agent/conversations/${id}`)).json()) as {
      turns: { request: string; pointed: unknown[] }[];
    };
    expect(shown.turns[0]?.pointed).toEqual(chips);
    // Chips that are not references are left out; the turn still runs.
    plans.push({
      version: 1,
      steps: [{ id: "r", op: "reply", component: "text", data: { template: lit("ok") } }],
    });
    const odd = await post(base, token, "/api/agent/turn", {
      text: "¿y esto?",
      conversation: id,
      chips: [
        { ref: { kind: "otra" }, title: "x" },
        "e_regar",
        { ref: { kind: "row", id: "e_regar" } },
      ],
    });
    expect(odd.status).toBe(200);
    const again = (await (await get(token, `/api/agent/conversations/${id}`)).json()) as {
      turns: { request: string; pointed: unknown[] }[];
    };
    expect(again.turns.find((t) => t.request === "¿y esto?")?.pointed).toEqual([
      { ref: { kind: "row", id: "e_regar" }, title: "" },
    ]);
  });

  it("are listed, kept turn by turn with a title, watched live, renamed and sent to the trash", async () => {
    const token = await login(base, "juan");
    const made = (await (await post(base, token, "/api/agent/conversations")).json()) as {
      conversation: { id: string };
    };
    const id = made.conversation.id;
    plans.push(count);
    const live = "vivo-ejemplo-0001";
    const turn = (await (
      await post(base, token, "/api/agent/turn", {
        text: "¿cuántas tareas tengo?",
        conversation: id,
        live,
      })
    ).json()) as { status: string };
    expect(turn.status).toBe("done");
    const watched = (await (await get(token, `/api/agent/live/${live}?after=0`)).json()) as {
      events: { type: string }[];
      done: boolean;
    };
    expect(watched.done).toBe(true);
    expect(watched.events.map((e) => e.type)).toEqual([
      "start",
      "planning",
      "planned",
      "step",
      "step",
      "reply",
      "end",
    ]);
    const after = (await (await get(token, `/api/agent/live/${live}?after=5`)).json()) as {
      events: unknown[];
    };
    expect(after.events).toHaveLength(2);

    const shown = (await (await get(token, `/api/agent/conversations/${id}`)).json()) as {
      conversation: { title: string };
      turns: { request: string; status: string; replies: unknown[] }[];
    };
    expect(shown.conversation.title).toBe("¿cuántas tareas tengo?");
    expect(shown.turns).toMatchObject([{ request: "¿cuántas tareas tengo?", status: "done" }]);
    expect(shown.turns[0]?.replies).toHaveLength(1);

    const put = await fetch(`${base}/api/agent/conversations/${id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: "Tareas" }),
    });
    expect(((await put.json()) as { conversation: { title: string } }).conversation.title).toBe(
      "Tareas",
    );
    const list = (await (await get(token, "/api/agent/conversations")).json()) as {
      conversations: { id: string; title: string }[];
    };
    expect(list.conversations[0]).toMatchObject({ id, title: "Tareas" });
    // A model that is not one of the planners Juan evaluated is refused.
    const bad = await fetch(`${base}/api/agent/conversations/${id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "anthropic:otro" }),
    });
    expect(bad.status).toBe(400);

    // Another account sees none of it.
    const other = await login(base, "otra");
    expect((await get(other, `/api/agent/conversations/${id}`)).status).toBe(404);
    expect((await get(other, `/api/agent/live/${live}?after=0`)).status).toBe(404);

    const gone = await fetch(`${base}/api/agent/conversations/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(gone.status).toBe(200);
    expect((await get(token, `/api/agent/conversations/${id}`)).status).toBe(404);
  });

  it("a device without the list keeps a conversation of its own; «Parar» ends a turn that waits", async () => {
    const token = await login(base, "juan");
    plans.push(ask);
    const live = "vivo-ejemplo-0002";
    const waiting = (await (
      await post(base, token, "/api/agent/turn", { text: "apunta algo", live })
    ).json()) as { status: string };
    expect(waiting.status).toBe("waiting");
    // The device's own conversation (the one its turns went to before the list), the latest now.
    const list = (await (await get(token, "/api/agent/conversations")).json()) as {
      conversations: { id: string; title: string }[];
    };
    expect(list.conversations[0]?.title).toBe("apunta llamar al dentista");
    const stop = (await (await post(base, token, `/api/agent/live/${live}/stop`)).json()) as {
      stopping: boolean;
    };
    expect(stop.stopping).toBe(true);
    const shown = (await (
      await get(token, `/api/agent/conversations/${list.conversations[0]?.id}`)
    ).json()) as { turns: { status: string; error: string | null }[] };
    expect(shown.turns.at(-1)).toMatchObject({
      request: "apunta algo",
      status: "stopped",
      error: "stopped-by-juan",
    });
    expect((await post(base, token, "/api/agent/live/no-existe-0000/stop")).status).toBe(404);
  });

  it("a pinned conversation stays on top; a message is corrected by editing it; a card takes Juan's own words (task 27)", async () => {
    const token = await login(base, "juan");
    const put = (id: string, body: unknown) =>
      fetch(`${base}/api/agent/conversations/${id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    const make = async () =>
      (
        (await (await post(base, token, "/api/agent/conversations")).json()) as {
          conversation: { id: string };
        }
      ).conversation.id;
    const pinned = await make();
    const id = await make();
    const set = (await (await put(pinned, { pinned: true })).json()) as {
      conversation: { pinned: boolean };
    };
    expect(set.conversation.pinned).toBe(true);
    expect((await put(pinned, { pinned: "sí" })).status).toBe(400);
    const create = (titulo: string) => ({
      version: 1,
      steps: [
        {
          id: "c",
          op: "call",
          tool: "entities.create",
          args: { type: lit("tarea"), values: { fn: "obj", args: [lit("titulo"), lit(titulo)] } },
        },
      ],
    });
    plans.push(create("Pan integral"));
    const first = (await (
      await post(base, token, "/api/agent/turn", { text: "apunta pan integral", conversation: id })
    ).json()) as { run: string; status: string };
    expect(first.status).toBe("done");
    const list = (await (await get(token, "/api/agent/conversations")).json()) as {
      conversations: { id: string; pinned: boolean }[];
    };
    // Pinned first, though the other one was used after it.
    expect(list.conversations.slice(0, 2).map((c) => [c.id, c.pinned])).toEqual([
      [pinned, true],
      [id, false],
    ]);
    const titles = () =>
      host
        .store(1)
        .list("t_tarea")
        .map((x) => x.entity.values.f_titulo);
    expect(titles()).toContain("Pan integral");

    // A run that is not of this conversation is not found; one in the way of a later change is refused, nothing done.
    expect(
      (
        await post(base, token, "/api/agent/turn", {
          text: "otra",
          conversation: id,
          corrects: "no-existe",
        })
      ).status,
    ).toBe(404);
    plans.push(create("Pan de centeno"));
    const fixed = (await (
      await post(base, token, "/api/agent/turn", {
        text: "apunta pan de centeno",
        conversation: id,
        corrects: first.run,
      })
    ).json()) as { status: string; run: string };
    expect(fixed.status).toBe("done");
    expect(titles()).not.toContain("Pan integral");
    expect(titles()).toContain("Pan de centeno");
    const shown = (await (await get(token, `/api/agent/conversations/${id}`)).json()) as {
      turns: { request: string; corrected: boolean; corrects: string | null }[];
    };
    expect(shown.turns.map((t) => [t.request, t.corrected, t.corrects])).toEqual([
      ["apunta pan integral", true, null],
      ["apunta pan de centeno", false, first.run],
    ]);
    const row = host
      .store(1)
      .list("t_tarea")
      .find((x) => x.entity.values.f_titulo === "Pan de centeno");
    if (!row) throw new Error("expected the row");
    host
      .store(1)
      .update(
        row.entity.id,
        { f_titulo: { value: "Pan de centeno, dos", label: label("user", "personal", []) } },
        { actor: "user" },
      );
    const refused = await post(base, token, "/api/agent/turn", {
      text: "apunta pan de molde",
      conversation: id,
      corrects: fixed.run,
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("cannot-undo");
    expect(titles()).toContain("Pan de centeno, dos");

    // Corrected already, on another device: its new words ran once, and are not run again.
    const twice = await post(base, token, "/api/agent/turn", {
      text: "apunta pan de pueblo",
      conversation: id,
      corrects: first.run,
    });
    expect(twice.status).toBe(409);
    expect(((await twice.json()) as { error: string }).error).toBe("corrected");
    expect(titles()).not.toContain("Pan de pueblo");

    // All or nothing: a setting the run rewrote, rewritten again by Juan since, keeps its row too.
    plans.push(create("Leche de avena"));
    const milk = (await (
      await post(base, token, "/api/agent/turn", {
        text: "apunta leche de avena",
        conversation: id,
      })
    ).json()) as { run: string };
    const store = host.store(1);
    keep(store, milk.run, { setting: "views/t_tarea", before: null, after: "[1]" });
    store.setSetting("views/t_tarea", "[2]");
    const kept = await post(base, token, "/api/agent/turn", {
      text: "apunta leche de soja",
      conversation: id,
      corrects: milk.run,
    });
    expect(kept.status).toBe(409);
    expect(((await kept.json()) as { error: string }).error).toBe("cannot-undo");
    expect(titles()).toContain("Leche de avena");
    expect(titles()).not.toContain("Leche de soja");
    expect(store.setting("views/t_tarea")).toBe("[2]");

    // «Otra cosa…»: the question ends, its turn says so, and an answer of the wrong kind is refused.
    plans.push({
      version: 1,
      steps: [
        { id: "l", op: "call", tool: "entities.query", args: { type: lit("tarea") } },
        {
          id: "q",
          op: "ask",
          control: "choice",
          prompt: lit("¿Cuál?"),
          options: { ref: "$l.items" },
        },
      ],
    });
    const asks = (await (
      await post(base, token, "/api/agent/turn", { text: "marca una", conversation: id })
    ).json()) as { run: string; pending: { id: string } };
    expect(
      (
        await post(base, token, "/api/agent/answer", {
          run: asks.run,
          ask: asks.pending.id,
          words: 3,
        })
      ).status,
    ).toBe(400);
    const words = (await (
      await post(base, token, "/api/agent/answer", {
        run: asks.run,
        ask: asks.pending.id,
        words: "ninguna de esas",
      })
    ).json()) as { status: string; error: string; replies: { component: string }[] };
    expect(words).toMatchObject({ status: "stopped", error: "answered-in-words" });
    expect(words.replies.at(-1)?.component).toBe("asked");
  });
});

describe("flows over the API (docs/flujos.md, F2)", () => {
  const call = (token: string, method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const tally = {
    version: 1,
    steps: [
      {
        id: "n",
        op: "call",
        tool: "entities.aggregate",
        args: { type: lit("tarea"), op: lit("count") },
      },
      {
        id: "r",
        op: "reply",
        component: "text",
        data: { template: { ref: "$titulo" }, a: { ref: "$n" } },
      },
    ],
  };

  it("are made, checked, saved over their version, turned on, run by hand, gone back and deleted", async () => {
    const token = await login(base, "juan");
    const made = (await (
      await call(token, "POST", "/api/agent/flows", { name: "Cuántas tareas" })
    ).json()) as {
      id: string;
      version: number;
      enabled: boolean;
    };
    expect(made).toMatchObject({ version: 1, enabled: false, trigger: { manual: true } });
    // The checklist of an empty flow, and of the one it will be.
    const trigger = { manual: true, inputs: [{ name: "titulo" }] };
    const empty = (await (
      await call(token, "POST", "/api/agent/flows/check", {
        trigger,
        plan: { version: 1, steps: [] },
      })
    ).json()) as { problems: unknown[] };
    expect(empty.problems).toEqual([{ step: null, at: null, code: "no-steps" }]);
    const checked = (await (
      await call(token, "POST", "/api/agent/flows/check", { trigger, plan: tally })
    ).json()) as {
      problems: unknown[];
      refs: Record<string, { ref: string }[]>;
    };
    expect(checked.problems).toEqual([]);
    expect(checked.refs.r?.map((x) => x.ref)).toEqual(["$titulo", "$n"]);
    // Saved over the version it started from; again over the same one, refused; with a problem, refused and said.
    const save = (body: unknown) => call(token, "PUT", `/api/agent/flows/${made.id}`, body);
    const saved = await save({ base: 1, trigger, plan: tally });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ version: 2, by: "user", plan: tally });
    expect((await save({ base: 1, trigger, plan: tally })).status).toBe(409);
    const broken = await save({
      base: 2,
      trigger,
      plan: { version: 1, steps: [{ id: "a", op: "call", tool: "entities.get", args: {} }] },
    });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({
      error: "invalid",
      problems: [{ step: "a", code: "missing-argument" }],
    });
    // On, then run by hand: the plan is the saved one (no planner), the form's value Juan's own.
    expect(
      (await (
        await call(token, "PUT", `/api/agent/flows/${made.id}/enabled`, { enabled: true })
      ).json()) as unknown,
    ).toMatchObject({ enabled: true });
    const before = plans.length;
    const ran = (await (
      await call(token, "POST", `/api/agent/flows/${made.id}/run`, {
        inputs: { titulo: "Tienes {a}" },
      })
    ).json()) as { status: string; replies: { data: Record<string, unknown> }[] };
    expect(plans.length).toBe(before);
    expect(ran.status).toBe("done");
    expect(ran.replies[0]?.data).toMatchObject({
      template: { value: "Tienes {a}", integrity: "user" },
      // What the tool counted (the tests before this one change Juan's tasks).
      a: { value: expect.any(Number) },
    });
    const list = (await (await call(token, "GET", "/api/agent/flows")).json()) as {
      flows: { id: string; runs: number }[];
    };
    expect(list.flows.find((f) => f.id === made.id)?.runs).toBe(1);
    // «Probar» (F3): the draft dry, with the form's value; what it gives, step by step, and nothing written.
    const tried = (await (
      await call(token, "POST", `/api/agent/flows/${made.id}/test`, {
        plan: tally,
        trigger,
        inputs: { titulo: "Hay {a}" },
      })
    ).json()) as {
      status: string;
      steps: Record<string, { decision: string; out: { t: string } }>;
    };
    expect(tried.status).toBe("done");
    expect(tried.steps.n).toMatchObject({ decision: "allow", out: { t: "number" } });
    expect(
      (
        await call(token, "POST", `/api/agent/flows/${made.id}/test`, {
          plan: { version: 1, steps: [] },
          trigger,
        })
      ).status,
    ).toBe(400);
    // Back to its first version (a new one), then deleted: out of the list.
    expect(
      await (
        await call(token, "POST", `/api/agent/flows/${made.id}/revert`, { version: 1 })
      ).json(),
    ).toMatchObject({
      version: 3,
      steps: 0,
    });
    expect((await call(token, "DELETE", `/api/agent/flows/${made.id}`)).status).toBe(200);
    const after = (await (await call(token, "GET", "/api/agent/flows")).json()) as {
      flows: { id: string }[];
    };
    expect(after.flows.map((f) => f.id)).not.toContain(made.id);
    // Boni's own flows are turned off, never deleted.
    ensureFlow(
      host.store(1),
      { id: "de-boni", name: "De Boni", trigger: { manual: true }, plan: tally, by: "preset" },
      1,
    );
    expect((await call(token, "DELETE", "/api/agent/flows/de-boni")).status).toBe(409);
    // The catalog: the registry's tools and the account's collections.
    const catalog = (await (await call(token, "GET", "/api/agent/flows/catalog")).json()) as {
      tools: { name: string }[];
      collections: { key: string }[];
    };
    expect(catalog.tools.map((t) => t.name)).toContain("entities.create");
    expect(catalog.collections.map((c) => c.key)).toContain("tarea");
  });

  it("a flow on a schedule runs by hand too, given today in the server's zone (F4)", async () => {
    const token = await login(base, "juan");
    const made = (await (
      await call(token, "POST", "/api/agent/flows", { name: "Resumen diario" })
    ).json()) as { id: string };
    const trigger = { schedule: { every: "day", at: "08:00" } };
    const plan = {
      version: 1,
      steps: [{ id: "r", op: "reply", component: "text", data: { template: { ref: "$today" } } }],
    };
    const saved = await call(token, "PUT", `/api/agent/flows/${made.id}`, {
      base: 1,
      trigger,
      plan,
    });
    expect(saved.status).toBe(200);
    await call(token, "PUT", `/api/agent/flows/${made.id}/enabled`, { enabled: true });
    const ran = (await (
      await call(token, "POST", `/api/agent/flows/${made.id}/run`, {})
    ).json()) as { status: string; replies: { data: Record<string, { value: unknown }> }[] };
    expect(ran.status).toBe("done");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(
      Date.now(),
    );
    expect(ran.replies[0]?.data.template?.value).toBe(today);
    // A flow a record starts is not run by hand.
    ensureFlow(
      host.store(1),
      { id: "al-llegar", name: "Al llegar", trigger: { created: "correo" }, plan, by: "preset" },
      1,
    );
    expect((await call(token, "POST", "/api/agent/flows/al-llegar/run", {})).status).toBe(409);
    // What brings the records that start it (docs/sistema.md §4.2: «viene del conector Correo»): the key of the
    // collection the mail's connector fills, the editor's to compare with its draft's trigger; none without a mail.
    // The catalog gives the app each collection's id (a guide's rule names one by it); the MCP's gives none.
    const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
    host.store(1).applySchema(
      {
        op: "create_type",
        type: {
          id: "t_correo_via",
          key: "correo",
          name: "Correos",
          fields: [
            { id: "t_correo_via_t", key: "asunto", name: "Asunto", type: "text", label: own },
          ],
          titleField: "t_correo_via_t",
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        },
      },
      { actor: "user" },
    );
    const mailKey = async () =>
      (
        (await (await call(token, "GET", "/api/agent/flows/al-llegar")).json()) as {
          mailKey: unknown;
        }
      ).mailKey;
    host.mailTypeOf = () => "t_correo_via";
    expect(await mailKey()).toBe("correo");
    host.mailTypeOf = () => "t_otra";
    expect(await mailKey()).toBeNull();
    host.mailTypeOf = null;
    const catalog = (await (await call(token, "GET", "/api/agent/flows/catalog")).json()) as {
      collections: { id?: string; key: string }[];
    };
    expect(catalog.collections.find((c) => c.key === "correo")?.id).toBe("t_correo_via");
    expect(
      flowCatalog(host.tools, host.store(1), ["tasks"]).collections.every((c) => !("id" in c)),
    ).toBe(true);
  });

  it("keep a flow's draft apart: it never runs, a shared device cannot write it, «Guardar» and «Descartar» end it (task 80)", async () => {
    const token = await login(base, "juan");
    const made = (await (
      await call(token, "POST", "/api/agent/flows", { name: "Borrador de prueba" })
    ).json()) as { id: string };
    const trigger = { manual: true, inputs: [{ name: "titulo" }] };
    expect(
      (await call(token, "PUT", `/api/agent/flows/${made.id}`, { base: 1, trigger, plan: tally }))
        .status,
    ).toBe(200);
    expect(
      (await call(token, "PUT", `/api/agent/flows/${made.id}/enabled`, { enabled: true })).status,
    ).toBe(200);
    // A change that is incomplete, kept as the draft of the version it started from.
    const half = { version: 1, steps: [...tally.steps, { id: "x", op: "call" }] };
    const keep = (body: unknown) => call(token, "PUT", `/api/agent/flows/${made.id}/draft`, body);
    const kept = await keep({ base: 2, trigger, plan: half });
    expect(kept.status).toBe(200);
    expect(await kept.json()).toMatchObject({ draft: { base: 2, plan: half } });
    expect((await keep({ base: 9, trigger, plan: half })).status).toBe(400);
    expect(
      (await call(token, "PUT", "/api/agent/flows/nadie/draft", { base: 1, trigger, plan: half }))
        .status,
    ).toBe(404);
    // Read back with the flow, which is still its saved version and on.
    const detail = (await (
      await call(token, "GET", `/api/agent/flows/${made.id}?days=7`)
    ).json()) as Record<string, unknown>;
    expect(detail).toMatchObject({
      version: 2,
      enabled: true,
      draft: { base: 2, plan: half },
      renamable: true,
    });
    // It runs the saved version: the draft's incomplete step would fail.
    const ran = (await (
      await call(token, "POST", `/api/agent/flows/${made.id}/run`, {
        inputs: { titulo: "Tienes {a}" },
      })
    ).json()) as { status: string };
    expect(ran.status).toBe("done");
    // A shared device cannot write or drop it.
    const s = sessionUser(db, token);
    const trust = (t: string) =>
      db.prepare("UPDATE devices SET trust = ? WHERE name = ?").run(t, s?.device ?? "");
    trust("shared");
    expect((await keep({ base: 2, trigger, plan: tally })).status).toBe(403);
    expect((await call(token, "DELETE", `/api/agent/flows/${made.id}/draft`)).status).toBe(403);
    trust("personal");
    // «Descartar»: the flow as it was saved, no draft.
    const dropped = await call(token, "DELETE", `/api/agent/flows/${made.id}/draft`);
    expect(dropped.status).toBe(200);
    expect(await dropped.json()).toMatchObject({ version: 2, draft: null, plan: tally });
    // «Guardar» makes the draft a version and ends it.
    const done = {
      version: 1,
      steps: [tally.steps[0], { ...tally.steps[1], data: { template: { lit: "Hay" } } }],
    };
    expect((await keep({ base: 2, trigger, plan: done })).status).toBe(200);
    expect(
      (await call(token, "PUT", `/api/agent/flows/${made.id}`, { base: 2, trigger, plan: done }))
        .status,
    ).toBe(200);
    expect(host.store(1).journal.flowDraft(made.id)).toBeNull();
  });
});

describe("the inbox checked again when it is seen and when it is accepted (task 73)", () => {
  it("a card whose hour passed says so, and «Aceptar» without that word is stopped, not taken", async () => {
    const token = await login(base, "juan");
    const h = { authorization: `Bearer ${token}` };
    const store = host.store(1);
    store.applySchema(
      {
        op: "add_field",
        type: "t_tarea",
        field: {
          id: "f_fecha",
          key: "fecha",
          name: "Fecha",
          type: "date",
          label: label("user", "personal", []),
        },
      },
      { actor: "user" },
    );
    // Proposed from a mail of yesterday («hoy»): yesterday, by the server's clock and zone.
    const yesterday = dayToIso(todayIn(host.tz, host.now()) - 1);
    const [id] = (
      await host.agent(1).background({
        version: 1,
        steps: [
          {
            id: "c",
            op: "call",
            tool: "entities.create",
            args: {
              type: lit("tarea"),
              values: {
                fn: "obj",
                args: [lit("titulo"), lit("Entregar el acta"), lit("fecha"), lit(yesterday)],
              },
            },
          },
        ],
      })
    ).proposals;
    if (!id) throw new Error("no proposal");
    const cards = (await (await fetch(`${base}/api/agent/proposals`, { headers: h })).json()) as {
      proposals: {
        id: string;
        card: { day: string | null; now: { fromToday: number | null; state: string | null } };
      }[];
    };
    const card = cards.proposals.find((p) => p.id === id)?.card;
    expect(card?.day).toBe(yesterday);
    expect(card?.now).toEqual({ fromToday: -1, state: "past" });
    // Pressed on a card that showed no word (seen before it passed): 409 with the word it has now, still pending.
    const stopped = await post(base, token, `/api/agent/proposals/${id}/accept`, {});
    expect(stopped.status).toBe(409);
    expect(await stopped.json()).toEqual({ error: "changed", state: "past" });
    expect(store.journal.proposal(id)?.status).toBe("pending");
    // The conversation's «acéptala» shows no word: stopped the same way.
    expect(
      await acceptCorrected(
        host,
        { account: 1, device: "movil-ejemplo", trust: "personal" },
        id,
        undefined,
      ),
    ).toEqual({ error: "changed", state: "past" });
    // Pressed on the card that says «Ya pasó»: his decision, taken.
    const taken = await post(base, token, `/api/agent/proposals/${id}/accept`, { seen: "past" });
    expect(taken.status).toBe(200);
    expect(store.journal.proposal(id)?.status).toBe("accepted");
  });
});
