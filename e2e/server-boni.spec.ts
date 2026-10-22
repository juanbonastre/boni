import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { definitionNote } from "../apps/calendar-web/src/vault/testing.ts";

/**
 * The migration to Boni (Juan, 2026-10-22: one truth): an invented vault imported into an account's Boni, its
 * calendar's collection switched to core mode and the calendar moved (`cli.ts mirror ... --calendar`), the
 * same commands as on the NAS. Then Boni Calendar against that server: its events come from Boni, its edits
 * go to Boni (and the mirror writes them into the vault), Boni's own edits reach it live, and a note edited by
 * hand in the vault no longer changes the calendar.
 */
const NOW = "2025-09-17T14:29";
const PASSWORD = "una contraseña larga de ejemplo";
test.describe.configure({ mode: "serial" });

const note = (title: string, date: string, start: string) =>
  `---\ntitle: "${title}"\ndate: "${date}"\nstartTime: "${start}"\nendTime: "${start.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0"))}"\ntimezone: "Europe/Madrid"\ncompleted:\n---\nArea: [[docencia]]\n`;
const CLASS = "agenda/docencia/2025-09-17 Clase del servidor.md";

let dir: string;
let proc: ChildProcess | null = null;
let url: string;
const read = (rel: string) =>
  existsSync(join(dir, "vault", rel)) ? readFileSync(join(dir, "vault", rel), "utf8") : null;
function write(rel: string, text: string) {
  mkdirSync(dirname(join(dir, "vault", rel)), { recursive: true });
  writeFileSync(join(dir, "vault", rel), text);
}
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
  dir = mkdtempSync(join(tmpdir(), "boni-e2e-migration-"));
  write(
    "_system/colecciones/docencia.md",
    definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"),
  );
  write(CLASS, note("Clase del servidor", "2025-09-17", "09:00"));
  write("agenda/docencia/2025-09-18 Tutoría.md", note("Tutoría", "2025-09-18", "12:00"));
  // Money, as the vault keeps it: a movement, a person, the categories.
  write(
    "registros/finanzas/categorias.md",
    "---\ntype: wiki\ncategories:\n  - comida/restaurante\n  - bebida/cafe\n---\n",
  );
  write("registros/personas/lucia-ferri.md", "---\ntype: person\nsummary: Amiga inventada\n---\n");
  write(
    "registros/finanzas/movimientos/2026/10/2026-10-02-cafe.md",
    '---\ntype: movement\ndate: 2026-10-02\namount: -1.6\ncurrency: EUR\naccount: ing\ncategory: bebida/cafe\nmerchant: "Bar Ejemplo"\npeople: ["[[lucia-ferri]]"]\nstatus: pendiente\nsource: banco\n---\n',
  );
  node(["apps/server/src/cli.ts", "add-user", "juan", join(dir, "vault")]);
  mkdirSync(join(dir, "users"));
  // As on the NAS: the import, the collection switched to Boni, then the calendar.
  node([
    "packages/vault-import/src/cli.ts",
    "--vault",
    join(dir, "vault"),
    "--store",
    join(dir, "users", "1.db"),
    "--apply",
  ]);
  const dry = node(["apps/server/src/cli.ts", "mirror", "juan", "--calendar"]);
  expect(dry).toContain("docencia: vault");
  for (const t of ["t_docencia", "t_movimiento", "t_persona"])
    node(["apps/server/src/cli.ts", "mirror", "juan", t, "--apply"]);
  expect(node(["apps/server/src/cli.ts", "mirror", "juan", "--calendar", "--apply"])).toContain(
    "The calendar comes from Boni now (1 calendars).",
  );
  expect(read(CLASS)).toContain("boni_id:");
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
        // The mirror works with the agent on (its inbox); no model is called here.
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
async function token() {
  const r = await fetch(`${url}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: PASSWORD, device: "portatil-boni" }),
  });
  return ((await r.json()) as { token: string }).token;
}

test("the calendar comes from Boni: its edits go to Boni and the mirror writes them into the vault", async ({
  page,
}) => {
  await connect(page);
  await expect(page.locator(".ev", { hasText: "Clase del servidor" })).toHaveCount(1);
  await expect(page.locator(".ev", { hasText: "Tutoría" })).toHaveCount(1);
  await page.locator(".ev", { hasText: "Clase del servidor" }).click();
  await page.locator(".popover .title-input").fill("Clase renombrada en el calendario");
  await page.locator(".popover .title-input").press("Enter");
  await page.keyboard.press("Escape");
  // In Boni (its rows, as Boni's own pages see them)...
  const t = await token();
  const h = { authorization: `Bearer ${t}` };
  await expect
    .poll(async () => {
      const r = await fetch(`${url}/api/data/types/t_docencia/rows`, { headers: h });
      return JSON.stringify(await r.json());
    })
    .toContain("Clase renombrada en el calendario");
  // ...and in the vault, written by the mirror.
  await expect
    .poll(() => read(CLASS), { timeout: 15_000 })
    .toContain('title: "Clase renombrada en el calendario"');
});

test("Boni's own edits reach the calendar live; a hand edit in the vault no longer does", async ({
  page,
}) => {
  await connect(page);
  const t = await token();
  const h = { authorization: `Bearer ${t}` };
  const rows = (
    (await (await fetch(`${url}/api/data/types/t_docencia/rows`, { headers: h })).json()) as {
      rows: { id: string; values: Record<string, unknown> }[];
    }
  ).rows;
  const tut = rows.find((r) => JSON.stringify(r.values).includes("Tutoría"));
  const titleField = Object.keys(tut?.values ?? {}).find((k) => tut?.values[k] === "Tutoría");
  await fetch(`${url}/api/data/rows/${tut?.id}`, {
    method: "PUT",
    headers: h,
    body: JSON.stringify({ values: { [titleField as string]: "Tutoría cambiada en Boni" } }),
  });
  await expect(page.locator(".ev", { hasText: "Tutoría cambiada en Boni" })).toHaveCount(1, {
    timeout: 5000,
  });
  // Obsidian (or anything) changes a note by hand: the calendar keeps Boni's truth.
  write(
    CLASS,
    (read(CLASS) as string).replace("Clase renombrada en el calendario", "Cambio a mano"),
  );
  await page.waitForTimeout(2500);
  await expect(page.locator(".ev", { hasText: "Cambio a mano" })).toHaveCount(0);
  await expect(page.locator(".ev", { hasText: "Clase renombrada en el calendario" })).toHaveCount(
    1,
  );
  // The hand edit waits in Boni's inbox for Juan to accept or reject it.
  await expect
    .poll(
      async () =>
        JSON.stringify(await (await fetch(`${url}/api/agent/proposals`, { headers: h })).json()),
      { timeout: 40_000 },
    )
    .toContain("Cambio a mano");
});

test('"Apuntar gasto" with the movements in Boni: the movement goes into Boni, the mirror writes its note', async () => {
  const t = await token();
  const h = { authorization: `Bearer ${t}` };
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
  const rows = JSON.stringify(
    await (await fetch(`${url}/api/data/types/t_movimiento/rows`, { headers: h })).json(),
  );
  expect(rows).toContain("Bar Pepe");
  const path = "registros/finanzas/movimientos/2026/10/2026-10-12-1830-menu-con-lucia.md";
  await expect.poll(() => read(path), { timeout: 15_000 }).toContain("Bar Pepe");
  expect(read(path)).toContain("[[lucia-ferri]]");
  expect(read(path)).toContain("boni_id:");
  // Juan's own capture is never a proposal in his inbox.
  await new Promise((r) => setTimeout(r, 1500));
  const inbox = (await (await fetch(`${url}/api/agent/proposals`, { headers: h })).json()) as {
    proposals: unknown[];
  };
  // The only proposal is the earlier hand edit of the class; nothing of the capture.
  expect(JSON.stringify(inbox.proposals)).not.toContain("menu-con-lucia");
  expect(JSON.stringify(inbox.proposals)).not.toContain("Nota nueva");
});
