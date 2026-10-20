import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser } from "../auth.ts";
import { type Db, openDb } from "../db.ts";
import { Feeds } from "../feeds.ts";
import { type App, makeApp, serve } from "../http.ts";
import { LoginGuard } from "../limits.ts";
import { Vaults } from "../vaults.ts";

/** The Boni API v1 over HTTP, as the Boni apps call it, on an invented vault. */
const PASSWORD = "una contraseña larga de ejemplo";
const example = (name: string) =>
  JSON.parse(readFileSync(new URL(`./golden/examples/${name}.json`, import.meta.url), "utf8"));
let dir: string;
let db: Db;
let vaults: Vaults;
let app: App;
const servers: Server[] = [];
let base: string;
let pub: string;
let token: string;

const vault = (rel: string) => join(dir, "vault", rel);
function write(rel: string, text: string) {
  mkdirSync(dirname(vault(rel)), { recursive: true });
  writeFileSync(vault(rel), text);
}
async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}
const call = (method: string, path: string, body?: unknown, auth = token) =>
  fetch(`${base}${path}`, {
    method,
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const json = async (method: string, path: string, body?: unknown) => {
  const r = await call(method, path, body);
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const movement = (date: string, amount: number, category: string, merchant: string) =>
  `---\ntype: movement\ndate: ${date}\namount: ${amount}\ncurrency: EUR\naccount: ing\ncategory: ${category}\nmerchant: "${merchant}"\nstatus: pendiente\nsource: banco\n---\n`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-v1-http-"));
  mkdirSync(vault("_system/colecciones"), { recursive: true });
  write(
    "registros/finanzas/categorias.md",
    "---\ntype: wiki\ncategories:\n  - comida/restaurante\n  - bebida/cafe\n  - ingreso/nomina\n---\n",
  );
  write("registros/personas/lucia-ferri.md", "---\ntype: person\nsummary: Amiga inventada\n---\n");
  write(
    "registros/finanzas/movimientos/2026/10/2026-10-02-cafe.md",
    movement("2026-10-02", -1.6, "bebida/cafe", "Bar Ejemplo"),
  );
  write(
    "registros/finanzas/movimientos/2026/10/2026-10-05-cena.md",
    movement("2026-10-05", -30, "comida/restaurante", "Casa Inventada"),
  );
  write(
    "registros/finanzas/movimientos/2026/09/2026-09-10-cena.md",
    movement("2026-09-10", -20, "comida/restaurante", "Casa Inventada"),
  );
  write(
    "private/finanzas.md",
    "---\ntype: movement\ndate: 2026-10-01\namount: -999\ncategory: bebida/cafe\n---\n",
  );
  db = openDb(":memory:");
  addUser(db, "juan", PASSWORD, join(dir, "vault"));
  addUser(db, "sinvault", PASSWORD, "");
  vaults = new Vaults({ write: true });
  app = makeApp({
    db,
    vaults,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 3, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    tz: "Europe/Madrid",
    now: () => Date.UTC(2026, 9, 19, 10, 0),
  });
  base = await listen(serve(app, "tailnet"));
  pub = await listen(serve(app, "public"));
  const r = await call(
    "POST",
    "/api/v1/login",
    { user: "juan", password: PASSWORD, device: " Móvil de prueba " },
    "",
  );
  expect(r.status).toBe(200);
  const b = (await r.json()) as { token: string; user: string; device: string };
  expect(b).toMatchObject({ user: "juan", device: "Móvil de prueba" });
  token = b.token;
});

afterAll(async () => {
  app.close();
  for (const s of servers) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  vaults.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the Boni API v1", () => {
  it("answers health, who you are and the errors with the first server's messages", async () => {
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({
      status: "ok",
      version: "0.5.0",
      api_version: "1",
      sources: { vault: "ok" },
    });
    expect(await json("GET", "/api/v1/me")).toEqual({
      status: 200,
      body: { user: "juan", device: "Móvil de prueba" },
    });
    const none = await call("GET", "/api/v1/me", undefined, "");
    expect([none.status, await none.json()]).toEqual([
      401,
      { error: { code: "unauthorized", message: "Falta la sesión: entra con tu usuario" } },
    ]);
    const old = await call("GET", "/api/v1/me", undefined, "token-inventado");
    expect([old.status, await old.json()]).toEqual([401, example("error")]);
    const bad = await call(
      "POST",
      "/api/v1/login",
      { user: "juan", password: "mala", device: "x" },
      "",
    );
    expect([bad.status, await bad.json()]).toEqual([
      401,
      { error: { code: "bad_login", message: "Usuario o contraseña incorrectos" } },
    ]);
    expect((await json("GET", "/api/v1/screens/no-existe")).body).toEqual({
      error: { code: "not_found", message: "No existe: no-existe" },
    });
  });

  it("is only on the tailnet: the public entry does not have it", async () => {
    expect((await fetch(`${pub}/healthz`)).status).toBe(404);
    const r = await fetch(`${pub}/api/v1/home`, { headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(404);
  });

  it("serves the home, the capture form and the option lists", async () => {
    expect((await json("GET", "/api/v1/home")).body).toEqual(example("home"));
    const screen = (await json("GET", "/api/v1/screens/capture-expense")).body;
    expect(screen.components[0].fields.map((f: { id: string }) => f.id)).toContain("amount");
    expect((await json("GET", "/api/v1/options/people?q=luc")).body).toEqual({
      source: "people",
      options: [{ value: "lucia-ferri", label: "Lucia Ferri", hint: "Amiga inventada" }],
    });
    expect(
      (await json("GET", "/api/v1/options/merchants")).body.options.map(
        (o: { value: string }) => o.value,
      ),
    ).toEqual(["Casa Inventada", "Bar Ejemplo"]);
    expect((await json("GET", "/api/v1/options/inventada")).status).toBe(404);
    expect((await json("GET", "/api/v1/options/people?limit=0")).status).toBe(422);
  });

  it("computes the charts from the vault's money notes (never private/)", async () => {
    const { status, body } = await json("GET", "/api/v1/charts/spending-by-category/data");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      chart_id: "spending-by-category",
      kind: "hbar",
      total: 31.6,
      stale: false,
      computed_at: "2026-10-19T12:00:00.000+02:00",
    });
    const drill = (await json("GET", "/api/v1/charts/spending-by-category/data?drill=comida")).body;
    expect(drill.drill).toBe("comida");
    expect(drill.total).toBe(30);
    const preview = await json("POST", "/api/v1/charts/preview", {
      spec: { title: "x", kind: "number", period: { kind: "last_months", months: 2 } },
    });
    expect(preview.body.total).toBe(51.6);
    const wrong = await json("POST", "/api/v1/charts/preview", {
      spec: { title: "x", kind: "pastel", period: { kind: "all" } },
    });
    expect([wrong.status, wrong.body.error.code]).toEqual([422, "bad_request"]);
  });

  it("creates, orders and deletes charts; widgets follow their chart", async () => {
    const made = await json("POST", "/api/v1/charts", {
      title: "  Gasto del mes ",
      kind: "number",
      period: { kind: "this_month" },
      color: "#4ade80",
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ id: "gasto-del-mes", title: "Gasto del mes", home: true });
    const w = await json("POST", "/api/v1/widgets", { chart_id: "gasto-del-mes", size: "small" });
    expect([w.status, w.body]).toEqual([
      201,
      { id: "w-gasto-del-mes", chart_id: "gasto-del-mes", size: "small" },
    ]);
    expect((await json("POST", "/api/v1/widgets", { chart_id: "no-existe" })).body.error).toEqual({
      code: "invalid",
      message: "No existe la grafica no-existe",
    });
    const order = await json("PUT", "/api/v1/charts/order", { ids: ["gasto-del-mes", "nada"] });
    expect(order.body.charts.map((c: { id: string }) => c.id)).toEqual([
      "gasto-del-mes",
      "spending-by-category",
      "monthly-spending",
      "eating-out",
    ]);
    const home = (await json("GET", "/api/v1/home")).body.components;
    expect(home[1]).toEqual({
      type: "chart_card",
      chart_id: "gasto-del-mes",
      title: "Gasto del mes",
      size: "small",
    });
    expect((await json("DELETE", "/api/v1/charts/gasto-del-mes")).status).toBe(204);
    expect((await json("GET", "/api/v1/widgets")).body).toEqual({ widgets: [] });
    expect((await json("GET", "/api/v1/charts/gasto-del-mes")).status).toBe(404);
  });

  it("keeps shortcuts that fill only the form's fields", async () => {
    for (const sc of example("shortcuts").shortcuts) {
      const r = await json("POST", "/api/v1/shortcuts", { ...sc, id: "ignorado" });
      expect([r.status, r.body]).toEqual([201, sc]);
    }
    expect(
      (
        await json("POST", "/api/v1/shortcuts", {
          label: "x",
          screen: "capture-expense",
          values: { foo: 1 },
        })
      ).body.error.message,
    ).toBe("Campos que el formulario no tiene: foo");
    expect(
      (await json("POST", "/api/v1/shortcuts", { label: "x", screen: "home" })).body.error.message,
    ).toBe("La pantalla home no tiene formulario");
    expect(
      (
        await json("POST", "/api/v1/shortcuts", {
          label: "x",
          screen: "capture-expense",
          color: "#000000",
        })
      ).body.error.message,
    ).toBe("Color desconocido: #000000");
    const order = await json("PUT", "/api/v1/shortcuts/order", { ids: ["comida-con-pablo"] });
    expect(order.body.shortcuts.map((s: { id: string }) => s.id)).toEqual([
      "comida-con-pablo",
      "cafe",
    ]);
    expect((await json("DELETE", "/api/v1/shortcuts/cafe")).status).toBe(204);
  });

  it("writes a capture once, as the first server wrote it, and tells the live stream", async () => {
    const events = await fetch(`${base}/api/v1/events`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toBe(": connected\n\n");

    const req = example("action-request");
    const ok = await json("POST", "/api/v1/actions", req);
    expect(ok.body).toEqual(example("action-result-ok"));
    const path = vault("registros/finanzas/movimientos/2026/10/2026-10-12-1830-menu-con-lucia.md");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("amount: -12.50\n");
    expect(text).toContain('people: ["[[lucia-ferri]]"]\n');
    expect(text).toContain("created: 2026-10-12\n");
    const event = new TextDecoder().decode((await reader.read()).value);
    expect(event).toMatch(/^event: changed\ndata: \{"what":"data","at":"[^"]+"\}\n\n$/);
    await reader.cancel();

    // Sent again (an offline queue): the same answer, no second note.
    expect(
      (await json("POST", "/api/v1/actions", { ...req, client_id: req.client_id.toUpperCase() }))
        .body,
    ).toEqual(example("action-result-ok"));
    expect(existsSync(path.replace(".md", "-2.md"))).toBe(false);
    // The account it was paid with is this device's default from now on.
    const account = (
      await json("GET", "/api/v1/screens/capture-expense")
    ).body.components[0].fields.find((f: { id: string }) => f.id === "account");
    expect(account.default).toBe("revolut");
    // The same capture again with another id: a new note next to it, never over it.
    const again = await json("POST", "/api/v1/actions", {
      ...req,
      client_id: "1f8a4c9e-3b5d-4e1a-9c2f-7d6b5a4e3c21",
    });
    expect(again.body.message).toBe("Guardado: 2026-10-12-1830-menu-con-lucia-2");
  });

  it("refuses an invalid capture without keeping it, so it can be sent again", async () => {
    const id = "2f8a4c9e-3b5d-4e1a-9c2f-7d6b5a4e3c21";
    const bad = await json("POST", "/api/v1/actions", {
      action: "expenses.capture",
      client_id: id,
      values: { amount: 0 },
    });
    expect(bad.body).toEqual(example("action-result-invalid"));
    const good = await json("POST", "/api/v1/actions", {
      action: "expenses.capture",
      client_id: id,
      values: { amount: "3,2", account: "efectivo", category: "bebida/cafe", concept: "Café" },
    });
    expect(good.body).toMatchObject({ status: "ok", message: "Guardado: 2026-10-19-cafe" });
    expect(
      (await json("POST", "/api/v1/actions", { action: "otra.cosa", client_id: id, values: {} }))
        .body,
    ).toEqual({
      status: "error",
      message: "Accion desconocida: otra.cosa",
      field_errors: {},
      navigate: null,
    });
    expect(
      (
        await json("POST", "/api/v1/actions", {
          action: "expenses.capture",
          client_id: "no-uuid",
          values: {},
        })
      ).status,
    ).toBe(422);
  });

  it("an account without a vault logs in but has no data here", async () => {
    const r = await call(
      "POST",
      "/api/v1/login",
      { user: "sinvault", password: PASSWORD, device: "" },
      "",
    );
    const b = (await r.json()) as { token: string; device: string };
    expect(b.device).toBe("equipo");
    const data = await fetch(`${base}/api/v1/charts/monthly-spending/data`, {
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect([data.status, await data.json()]).toEqual([
      503,
      {
        error: {
          code: "source_unavailable",
          message: "No se puede llegar a los datos ahora mismo",
        },
      },
    ]);
    const logout = await fetch(`${base}/api/v1/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(logout.status).toBe(204);
  });
});
