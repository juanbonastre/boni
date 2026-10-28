import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { calendarDef } from "../apps/server/src/seed.test-util.ts";
import { proposeEntries, seedAccount } from "./server-data.ts";

/**
 * Boni Calendar against Boni (Juan, 2026-10-22: one truth): an account whose calendar and money are its own
 * collections (invented, as Juan's came into Boni). Its events come from Boni, its edits go to Boni, Boni's own
 * edits reach it live, the inbox's proposals show in it, and "Apuntar gasto" puts the movement into Boni.
 */
const NOW = "2025-09-17T14:29";
const PASSWORD = "una contraseña larga de ejemplo";
test.describe.configure({ mode: "serial" });

const note = (title: string, date: string, start: string) =>
  `---\ntitle: "${title}"\ndate: "${date}"\nstartTime: "${start}"\nendTime: "${start.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0"))}"\ntimezone: "Europe/Madrid"\ncompleted:\n---\n`;
const CLASS = "agenda/docencia/2025-09-17 Clase del servidor.md";

let dir: string;
let proc: ChildProcess | null = null;
let url: string;
const node = (args: string[]) =>
  execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", ...args], {
    env: { ...process.env, BONI_DB: join(dir, "db.sqlite"), BONI_PASSWORD: PASSWORD },
  }).toString();
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-e2e-boni-"));
  seedAccount(
    dir,
    "juan",
    PASSWORD,
    [
      {
        key: "docencia",
        name: "Docencia",
        folder: "agenda/docencia/",
        calendar: calendarDef("docencia", "Docencia", "agenda/docencia"),
      },
      { key: "persona", name: "Persona", folder: "registros/personas/", thirdParty: true },
      {
        key: "movimiento",
        name: "Movimiento",
        folder: "registros/finanzas/movimientos/",
        sensitivity: "sensitive",
        fields: { date: "date", people: { type: "relation", to: "persona", many: true } },
      },
      { key: "nota", name: "Nota", folder: "", fields: { categories: { type: "multiselect" } } },
    ],
    {
      [CLASS]: note("Clase del servidor", "2025-09-17", "09:00"),
      "agenda/docencia/2025-09-18 Tutoría.md": note("Tutoría", "2025-09-18", "12:00"),
      // Money: a movement, a person, the categories.
      "registros/finanzas/categorias.md":
        "---\ntype: wiki\ncategories:\n  - comida/restaurante\n  - bebida/cafe\n---\n",
      "registros/personas/lucia-ferri.md": "---\ntype: person\nsummary: Amiga inventada\n---\n",
      "registros/finanzas/movimientos/2026/10/2026-10-02-cafe.md":
        '---\ntype: movement\ndate: 2026-10-02\namount: -1.6\ncurrency: EUR\naccount: ing\ncategory: bebida/cafe\nmerchant: "Bar Ejemplo"\npeople: ["[[lucia-ferri]]"]\nstatus: pendiente\nsource: banco\n---\n',
    },
  );
  // Two proposals waiting in the inbox (as a mail read in the background leaves them: values by field key).
  proposeEntries(dir, 1, "docencia", [
    { title: "Revisión propuesta", date: "2025-09-19", starttime: "10:00", endtime: "11:00" },
    { title: "Entrega hecha", date: "2025-09-19", starttime: "12:00", endtime: "13:00" },
  ]);
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  proc = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"],
    {
      env: {
        ...process.env,
        BONI_DB: join(dir, "db.sqlite"),
        BONI_PORT: String(port),
        BONI_WRITE: "1",
        // The inbox is the agent's; no model is called here.
        ANTHROPIC_API_KEY: "sk-invented-for-tests",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    proc?.stdout?.on("data", (d) => String(d).includes("boni-calendar-server on") && resolve());
    proc?.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
});

test.afterAll(() => {
  proc?.kill();
  rmSync(dir, { recursive: true, force: true });
});

async function connect(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.keyboard.press("Control+,");
  const form = page.locator(".modal .server-form");
  await form.locator("input").nth(0).fill(url);
  await form.locator("input").nth(1).fill("juan");
  await form.locator("input").nth(2).fill(PASSWORD);
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(page.locator(".modal")).toContainText("En directo");
  await page.keyboard.press("Escape");
}
async function token(device = "portatil-boni") {
  const r = await fetch(`${url}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device }),
  });
  return ((await r.json()) as { token: string }).token;
}
type Rows = { rows: { id: string; title?: string; values: Record<string, unknown> }[] };
const rowsOf = async (type: string, h: Record<string, string>) =>
  (await (await fetch(`${url}/api/data/types/${type}/rows`, { headers: h })).json()) as Rows;

test("the calendar comes from Boni: its edits go to Boni", async ({ page }) => {
  await connect(page);
  await expect(page.locator(".ev", { hasText: "Clase del servidor" })).toHaveCount(1);
  await expect(page.locator(".ev", { hasText: "Tutoría" })).toHaveCount(1);
  await page.locator(".ev", { hasText: "Clase del servidor" }).click();
  await page.locator(".popover .title-input").fill("Clase renombrada en el calendario");
  await page.locator(".popover .title-input").press("Enter");
  await page.keyboard.press("Escape");
  // In Boni (its rows, as Boni's own pages see them).
  const h = { authorization: `Bearer ${await token()}` };
  await expect
    .poll(async () => JSON.stringify(await rowsOf("t_docencia", h)))
    .toContain("Clase renombrada en el calendario");
});

test("a new event typed in the calendar is an entry titled as typed, never «Sin título»", async ({
  page,
}) => {
  await connect(page);
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (!cols) throw new Error("no grid");
  const x = cols.x + (cols.width / 7) * 4.5; // Friday 19
  await page.mouse.move(x, cols.y + 300);
  await page.mouse.down();
  await page.mouse.move(x, cols.y + 360, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".popover .title-input")).toBeFocused();
  await page
    .locator(".popover .title-input")
    .pressSequentially("Resonancia inventada", { delay: 80 });
  await page.locator(".popover .title-input").press("Enter");
  await page.keyboard.press("Escape");
  const h = { authorization: `Bearer ${await token()}` };
  const titles = async () => {
    const r = await rowsOf("t_docencia", h);
    return r.rows.map((row) => String(row.values.f_title ?? ""));
  };
  await expect
    .poll(async () => (await titles()).filter((t) => t === "Resonancia inventada"), {
      timeout: 40_000,
    })
    .toHaveLength(1);
  expect((await titles()).filter((t) => t === "" || t.startsWith("Sin título"))).toEqual([]);
});

test("Boni's own edits reach the calendar live", async ({ page }) => {
  await connect(page);
  const h = { authorization: `Bearer ${await token()}` };
  const tut = (await rowsOf("t_docencia", h)).rows.find((r) => r.values.f_title === "Tutoría");
  await fetch(`${url}/api/data/rows/${tut?.id}`, {
    method: "PUT",
    headers: h,
    body: JSON.stringify({ values: { f_title: "Tutoría cambiada en Boni" } }),
  });
  await expect(page.locator(".ev", { hasText: "Tutoría cambiada en Boni" })).toHaveCount(1, {
    timeout: 5000,
  });
});

test("a proposal waiting in Boni's inbox shows dashed in the calendar, read only, and goes once decided", async ({
  page,
}) => {
  await connect(page);
  const h = { authorization: `Bearer ${await token()}` };
  const ghost = page.locator(".ev.proposal", { hasText: "Revisión propuesta" });
  await expect(ghost).toHaveCount(1, { timeout: 15_000 });
  await expect(ghost).toHaveCSS("outline-style", "dashed");
  await page
    .locator(".cols-viewport")
    .screenshot({ path: "e2e/screenshots/calendar-proposal.png" });
  // Dragging it moves nothing; its detail says where it is decided, with every field off.
  const box = await ghost.boundingBox();
  if (!box) throw new Error("no proposal");
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await ghost.boundingBox())?.y).toBe(box.y);
  await ghost.click();
  await expect(page.locator(".popover .detail-kind")).toHaveText("Propuesta");
  await expect(page.locator(".popover .detail-note")).toContainText("Bandeja de Boni");
  await expect(page.locator(".popover .title-input")).toBeDisabled();
  await page.keyboard.press("Escape");
  // Still only a proposal: nothing in Boni's rows.
  const rows = (await (
    await fetch(`${url}/api/data/types/t_docencia/rows`, { headers: h })
  ).json()) as { rows: unknown[]; ghosts: unknown[] };
  expect(JSON.stringify(rows.rows)).not.toContain('"Revisión propuesta"');
  expect(JSON.stringify(rows.ghosts)).toContain('"Revisión propuesta"');
  const list = (await (await fetch(`${url}/api/agent/proposals`, { headers: h })).json()) as {
    proposals: { id: string; card?: { canMarkDone?: boolean } }[];
  };
  const p = list.proposals.find((x) => JSON.stringify(x).includes("Revisión propuesta"));
  expect(p).toBeTruthy();
  await fetch(`${url}/api/agent/proposals/${p?.id}/reject`, { method: "POST", headers: h });
  await expect(ghost).toHaveCount(0, { timeout: 5000 });
  // «Ya lo hice» on the other one: it is made already done (the calendar's task column), struck through here.
  const done = list.proposals.find((x) => JSON.stringify(x).includes("Entrega hecha"));
  expect(done?.card?.canMarkDone).toBe(true);
  const accepted = await fetch(`${url}/api/agent/proposals/${done?.id}/accept`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ edits: { done: true } }),
  });
  expect(((await accepted.json()) as { error: unknown }).error).toBeNull();
  await expect(page.locator(".ev.done", { hasText: "Entrega hecha" })).toHaveCount(1, {
    timeout: 5000,
  });
  await expect(page.locator(".ev.proposal", { hasText: "Entrega hecha" })).toHaveCount(0);
});

test('"Apuntar gasto": the movement goes into Boni, never as a proposal; Undo takes it out', async () => {
  const h = { authorization: `Bearer ${await token()}` };
  const r = await fetch(`${url}/api/v1/actions`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      action: "expenses.capture",
      client_id: "0f8a4c9e-3b5d-4e1a-9c2f-7d6b5a4e3c21",
      values: {
        kind: "gasto",
        amount: 12.5,
        account: "revolut",
        category: "comida/restaurante",
        concept: "Menu con Lucia",
        merchant: "Bar Pepe",
        people: ["lucia-ferri"],
        shared: false,
        date: "2026-10-12",
      },
      created_at: "2026-10-12T18:30:00+02:00",
    }),
  });
  expect(((await r.json()) as { status: string }).status).toBe("ok");
  const rows = JSON.stringify(await rowsOf("t_movimiento", h));
  expect(rows).toContain("Bar Pepe");
  // Juan's own capture is never a proposal in his inbox.
  const inbox = (await (await fetch(`${url}/api/agent/proposals`, { headers: h })).json()) as {
    proposals: unknown[];
  };
  expect(JSON.stringify(inbox.proposals)).not.toContain("menu-con-lucia");
  expect(JSON.stringify(inbox.proposals)).not.toContain("Bar Pepe");
  // A shortcut that saves at once is counted at once; Undo in its notice takes the movement out (the same device).
  const cafe = "5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
  const saved = await fetch(`${url}/api/v1/actions`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      action: "expenses.capture",
      client_id: cafe,
      values: {
        kind: "gasto",
        amount: 1.6,
        account: "efectivo",
        category: "comida/restaurante",
        concept: "Cafe deshecho",
        date: "2026-10-13",
      },
      created_at: new Date().toISOString(),
    }),
  });
  expect(((await saved.json()) as { status: string }).status).toBe("ok");
  const rowsNow = async () => JSON.stringify(await rowsOf("t_movimiento", h));
  expect(await rowsNow()).toContain("Cafe deshecho");
  const other = { authorization: `Bearer ${await token("movil-ejemplo")}` };
  expect(
    (await fetch(`${url}/api/v1/actions/${cafe}`, { method: "DELETE", headers: other })).status,
  ).toBe(404);
  const undone = await fetch(`${url}/api/v1/actions/${cafe}`, { method: "DELETE", headers: h });
  expect(undone.status).toBe(200);
  expect(await rowsNow()).not.toContain("Cafe deshecho");
  expect(
    (await fetch(`${url}/api/v1/actions/${cafe}`, { method: "DELETE", headers: h })).status,
  ).toBe(422);
});

test("the money's collections: the categories move into Categorías, and a capture is filed under its row", async () => {
  // As on the NAS, with the server running.
  expect(node(["apps/server/src/cli.ts", "money", "juan"])).toContain("simulacion");
  expect(node(["apps/server/src/cli.ts", "money", "juan", "--apply"])).toContain("Categorias: 2");
  const h = { authorization: `Bearer ${await token()}` };
  // "Apuntar gasto": the categories from Categorías, the movement into Boni with its category.
  const options = (await (
    await fetch(`${url}/api/v1/options/categories`, { headers: h })
  ).json()) as { options: { value: string }[] };
  expect(options.options.map((o) => o.value)).toEqual(["bebida/cafe", "comida/restaurante"]);
  const r = await fetch(`${url}/api/v1/actions`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      action: "expenses.capture",
      client_id: "5b2e7c1a-9d4f-4e8b-a6c3-2f1d0e9b8a77",
      values: {
        kind: "gasto",
        amount: 2.4,
        account: "efectivo",
        category: "bebida/cafe",
        concept: "Cafe con categoria",
        shared: false,
        date: "2026-10-13",
      },
      created_at: "2026-10-13T09:00:00+02:00",
    }),
  });
  expect(((await r.json()) as { status: string }).status).toBe("ok");
  const cafe = (await rowsOf("t_movimiento", h)).rows.find((x) =>
    JSON.stringify(x).includes("Cafe con categoria"),
  );
  expect(cafe).toBeTruthy();
  const cats = await rowsOf("t_categoria", h);
  const cafeCat = cats.rows.find((x) => x.values.f_nombre === "bebida/cafe")?.id;
  expect(cafeCat).toBeTruthy();
  expect(Object.values(cafe?.values ?? {})).toContain(cafeCat);
});
