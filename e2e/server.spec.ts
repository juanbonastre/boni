import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { definitionNote } from "../apps/calendar-web/src/vault/testing.ts";

/**
 * The app with Boni Calendar Server: a real server (apps/server) on an invented vault and account,
 * the app connecting to it from its own origin (like the desktop and Android apps do).
 */
const NOW = "2025-09-17T14:29";
const PASSWORD = "una contraseña larga de ejemplo";
test.describe.configure({ mode: "serial" });

const note = (title: string, date: string, start: string) =>
  `---\ntitle: "${title}"\ndate: "${date}"\nstartTime: "${start}"\nendTime: "${start.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0"))}"\ntimezone: "Europe/Madrid"\ncompleted:\n---\nArea: [[docencia]]\n`;

let dir: string;
let proc: ChildProcess | null = null;
let url: string;

const read = (rel: string) =>
  existsSync(join(dir, "vault", rel)) ? readFileSync(join(dir, "vault", rel), "utf8") : null;

function write(rel: string, text: string) {
  mkdirSync(dirname(join(dir, "vault", rel)), { recursive: true });
  writeFileSync(join(dir, "vault", rel), text);
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

let port = 0;
/** Starts the server (on the same port as before, if it ran: the app keeps the address). */
async function startServer() {
  port = port || (await freePort());
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
        BONI_FEEDS_ALLOW_PRIVATE: "1", // the invented calendar is served from this machine
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    proc?.stdout?.on("data", (d) => String(d).includes("boni-calendar-server on") && resolve());
    proc?.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}
function stopServer() {
  proc?.kill();
  proc = null;
}

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-e2e-server-"));
  write(
    "_system/colecciones/docencia.md",
    definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"),
  );
  write(
    "agenda/docencia/2025-09-17 Clase del servidor.md",
    note("Clase del servidor", "2025-09-17", "09:00"),
  );
  execFileSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "apps/server/src/cli.ts",
      "add-user",
      "juan",
      join(dir, "vault"),
    ],
    { env: { ...process.env, BONI_DB: join(dir, "db.sqlite"), BONI_PASSWORD: PASSWORD } },
  );
  await startServer();
});

test.afterAll(() => {
  stopServer();
  rmSync(dir, { recursive: true, force: true });
});

async function connect(page: Page, password = PASSWORD) {
  await page.waitForSelector(".ev");
  await page.keyboard.press("Control+,");
  const form = page.locator(".modal .server-form");
  await form.locator("input").nth(0).fill(url);
  await form.locator("input").nth(1).fill("juan");
  await form.locator("input").nth(2).fill(password);
  await form.getByRole("button", { name: "Conectar" }).click();
}

test("a browser logs in to the server and shows its calendar, live", async ({ page }) => {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await connect(page, "mal");
  await expect(page.locator(".modal")).toContainText("Usuario o contraseña incorrectos");

  await page.locator(".modal .server-form input").nth(2).fill(PASSWORD);
  await page.locator(".modal .server-form").getByRole("button", { name: "Conectar" }).click();
  await expect(page.locator(".modal")).toContainText("Conectado como juan");
  await expect(page.locator(".modal")).toContainText("En directo · 1 nota");
  await page.screenshot({ path: "e2e/screenshots/server-settings.png" });
  await page.keyboard.press("Escape");
  // The vault's note, not the sample data.
  await expect(page.locator(".ev", { hasText: "Clase del servidor" })).toHaveCount(1);
  await expect(page.locator(".ev", { hasText: "Clase FUP" })).toHaveCount(0);

  // Changed on the server's side (Obsidian, Syncthing): it shows up without reloading.
  write(
    "agenda/docencia/2025-09-18 Llegada en vivo.md",
    note("Llegada en vivo", "2025-09-18", "11:00"),
  );
  await expect(page.locator(".ev", { hasText: "Llegada en vivo" })).toHaveCount(1, {
    timeout: 5000,
  });
});

test("the last copy shows without a connection, and logging out goes back", async ({ page }) => {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await connect(page);
  await expect(page.locator(".modal")).toContainText("En directo");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ev", { hasText: "Clase del servidor" })).toHaveCount(1);
  await page.waitForTimeout(2500); // the copy is saved a moment after the last change

  stopServer();
  await page.reload();
  await expect(page.locator(".ev", { hasText: "Clase del servidor" })).toHaveCount(1);
  await page.keyboard.press("Control+,");
  await expect(page.locator(".modal")).toContainText("Sin conexión: se ve la última copia");

  // Back online: it reconnects on its own.
  await startServer();
  await expect(page.locator(".modal")).toContainText("En directo", { timeout: 15_000 });
  await page.locator(".modal").getByRole("button", { name: "Cerrar sesión" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ev", { hasText: "Clase FUP" }).first()).toBeVisible();
  await expect(page.locator(".ev", { hasText: "Clase del servidor" })).toHaveCount(0);
});

test("with a vault folder, the device chooses between the folder and a server", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const ok = (value: unknown) => ({ ok: true, value });
    // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge
    (window as any).boniVault = {
      getRoot: async () => ok("/vault/ejemplo"),
      chooseRoot: async () => ok("/vault/ejemplo"),
      scan: async () => ok([]),
      read: async () => ({ ok: false, code: "not-found", message: "x" }),
    };
  });
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.locator(".vault-notice").waitFor();
  await page.keyboard.press("Control+,");
  const origin = page.locator(".modal .setting", { hasText: "Origen" });
  await expect(origin).toBeVisible();
  await expect(page.locator(".modal")).toContainText("Carpeta del vault");
  await origin.getByRole("radio", { name: "Servidor" }).click();
  await expect(page.locator(".modal .server-form")).toBeVisible();
});

test("with a server, an event still opens its note in Obsidian on a device that can", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const ok = (value: unknown) => ({ ok: true, value });
    const opened: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: what the test double below recorded
    (window as any).__opened = opened;
    // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge (an empty folder)
    (window as any).boniVault = {
      getRoot: async () => ok("/vault/ejemplo"),
      chooseRoot: async () => ok("/vault/ejemplo"),
      scan: async () => ok([]),
      read: async () => ({ ok: false, code: "not-found", message: "x" }),
      openNote: async (path: string) => {
        opened.push(path);
        return ok(null);
      },
    };
  });
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.locator(".vault-notice").waitFor();
  await page.keyboard.press("Control+,");
  await page
    .locator(".modal .setting", { hasText: "Origen" })
    .getByRole("radio", { name: "Servidor" })
    .click();
  const form = page.locator(".modal .server-form");
  await form.locator("input").nth(0).fill(url);
  await form.locator("input").nth(1).fill("juan");
  await form.locator("input").nth(2).fill(PASSWORD);
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(page.locator(".modal")).toContainText("En directo");
  await page.keyboard.press("Escape");
  await page.locator(".ev", { hasText: "Clase del servidor" }).click();
  await page.locator(".popover").getByRole("button", { name: "Abrir nota en Obsidian" }).click();
  // biome-ignore lint/suspicious/noExplicitAny: reads what the test double recorded
  expect(await page.evaluate(() => (window as any).__opened)).toEqual([
    "agenda/docencia/2025-09-17 Clase del servidor.md",
  ]);
});

test("with Boni's desktop app: a double click peeks at the note, Ctrl+click and the button open it in Boni", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const ok = (value: unknown) => ({ ok: true, value });
    const opened: [string, boolean][] = [];
    // biome-ignore lint/suspicious/noExplicitAny: what the test double below recorded
    (window as any).__opened = opened;
    // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge (an empty folder)
    (window as any).boniVault = {
      noteApp: "boni",
      getRoot: async () => ok("/vault/ejemplo"),
      chooseRoot: async () => ok("/vault/ejemplo"),
      scan: async () => ok([]),
      read: async () => ({ ok: false, code: "not-found", message: "x" }),
      openNote: async (path: string, opts?: { peek?: boolean }) => {
        opened.push([path, opts?.peek === true]);
        return ok(null);
      },
    };
  });
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.locator(".vault-notice").waitFor();
  await page.keyboard.press("Control+,");
  await page
    .locator(".modal .setting", { hasText: "Origen" })
    .getByRole("radio", { name: "Servidor" })
    .click();
  const form = page.locator(".modal .server-form");
  await form.locator("input").nth(0).fill(url);
  await form.locator("input").nth(1).fill("juan");
  await form.locator("input").nth(2).fill(PASSWORD);
  await form.getByRole("button", { name: "Conectar" }).click();
  await expect(page.locator(".modal")).toContainText("En directo");
  await page.keyboard.press("Escape");
  const path = "agenda/docencia/2025-09-17 Clase del servidor.md";
  // biome-ignore lint/suspicious/noExplicitAny: reads what the test double recorded
  const opened = () => page.evaluate(() => (window as any).__opened as [string, boolean][]);
  const ev = page.locator(".ev", { hasText: "Clase del servidor" });
  // The detail never shows during a double click (it waits a moment where a double click opens the peek).
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: a flag the test reads back
    const w = window as any;
    w.__popoverSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(".popover")) w.__popoverSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await ev.dblclick();
  await expect.poll(opened).toEqual([[path, true]]);
  await page.waitForTimeout(500);
  // biome-ignore lint/suspicious/noExplicitAny: reads the flag
  expect(await page.evaluate(() => (window as any).__popoverSeen)).toBe(false);
  await expect(page.locator(".popover")).toHaveCount(0); // the peek shows it, not the detail
  await ev.click({ modifiers: ["Control"] });
  await expect.poll(opened).toEqual([
    [path, true],
    [path, false],
  ]);
  await ev.click();
  await page.locator(".popover").getByRole("button", { name: "Abrir en Boni" }).click();
  await expect.poll(async () => (await opened()).length).toBe(3);
  expect((await opened())[2]).toEqual([path, false]);
  await page.keyboard.press("Escape");
  // The month too.
  await page.keyboard.press("m");
  await page.locator(".mchip", { hasText: "Clase del servidor" }).dblclick();
  await expect.poll(async () => (await opened()).at(-1)).toEqual([path, true]);
});

test("edits go to the notes through the server: only the edited line, new events, deletions", async ({
  page,
}) => {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await connect(page);
  await expect(page.locator(".modal")).toContainText("En directo");
  await page.keyboard.press("Escape");
  const path = "agenda/docencia/2025-09-17 Clase del servidor.md";
  const before = read(path) as string;
  await page.locator(".ev", { hasText: "Clase del servidor" }).click();
  await page.locator(".popover .title-input").fill("Clase renombrada");
  await page.locator(".popover .title-input").press("Enter");
  await expect.poll(() => read(path)).toContain('title: "Clase renombrada"');
  const changed = (read(path) as string).split("\n").filter((l, i) => l !== before.split("\n")[i]);
  expect(changed).toEqual(['title: "Clase renombrada"']);
  await page.keyboard.press("Escape");

  // A new event becomes a note once it has a title; the server's copy replaces the device's one.
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (!cols) throw new Error("no grid");
  const x = cols.x + (cols.width / 7) * 3.5; // Thursday 18
  await page.mouse.move(x, cols.y + 500);
  await page.mouse.down();
  await page.mouse.move(x, cols.y + 560, { steps: 6 });
  await page.mouse.up();
  // Still without a title it is no note yet: it stays on this device (not lost when the server answers).
  await expect(page.locator(".popover .title-input")).toBeFocused();
  await page.waitForTimeout(1500);
  await expect(page.locator(".popover .title-input")).toBeFocused();
  await page.locator(".popover .title-input").pressSequentially("Tutoría", { delay: 80 });
  await page.waitForTimeout(800);
  await page.locator(".popover .title-input").fill("Tutoría inventada");
  await page.locator(".popover .title-input").press("Enter");
  const made = "agenda/docencia/2025-09-18 Tutoría inventada.md";
  await expect.poll(() => read(made)).toContain('title: "Tutoría inventada"');
  expect(read(made)).toContain("Area: [[docencia]]");
  await page.waitForTimeout(1000);
  await expect(page.locator(".ev", { hasText: "Tutoría inventada" })).toHaveCount(1);
  await expect(page.locator(".popover .title-input")).toHaveValue("Tutoría inventada");

  await page.keyboard.press("Escape");
  await page.locator(".ev", { hasText: "Tutoría inventada" }).click();
  await page.keyboard.press("Escape");
  await page.locator(".ev", { hasText: "Tutoría inventada" }).click();
  await page.keyboard.press("Delete");
  await expect.poll(() => read(made)).toBeNull();
  expect(readdirSync(join(dir, "vault", ".trash"))).toContain("2025-09-18 Tutoría inventada.md");
  await expect(page.locator(".ev", { hasText: "Tutoría inventada" })).toHaveCount(0);
});

test("without a connection, edits wait on the device (also over a restart) and go when it is back", async ({
  page,
}) => {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await connect(page);
  await expect(page.locator(".modal")).toContainText("En directo");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(2500); // the copy is saved a moment after the last change

  stopServer();
  const path = "agenda/docencia/2025-09-18 Llegada en vivo.md";
  await page.locator(".ev", { hasText: "Llegada en vivo" }).click();
  await page.locator(".popover .title-input").fill("Cambiada sin conexión");
  await page.locator(".popover .title-input").press("Enter");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  expect(read(path)).toContain('title: "Llegada en vivo"');

  // Closed and opened again without a connection: the change is still there.
  await page.reload();
  await expect(page.locator(".ev", { hasText: "Cambiada sin conexión" })).toHaveCount(1);

  await startServer();
  await expect
    .poll(() => read(path), { timeout: 15_000 })
    .toContain('title: "Cambiada sin conexión"');
  await expect(page.locator(".ev", { hasText: "Cambiada sin conexión" })).toHaveCount(1);
});

/** An invented external calendar, served from this machine (the server downloads it). */
const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:taller@example.com",
  "DTSTART;TZID=Europe/Madrid:20250916T190000",
  "DTEND;TZID=Europe/Madrid:20250916T200000",
  "SUMMARY:Taller de la cuenta",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("external calendars and preferences belong to the account: every device sees them, the server downloads them", async ({
  browser,
}) => {
  let served = 0;
  const feed = createHttp((_, res) => {
    served++;
    res.end(FEED);
  });
  await new Promise<void>((r) => feed.listen(0, "127.0.0.1", () => r()));
  const feedUrl = `http://127.0.0.1:${(feed.address() as { port: number }).port}/ejemplo.ics`;

  // The laptop had the calendar on its own, from before (kept on the device).
  const laptop = await (await browser.newContext()).newPage();
  await laptop.addInitScript((url) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem(
      "boni-calendar:settings",
      JSON.stringify({
        externals: [{ id: "ext-portatil", name: "Talleres", url, color: "#3b82f6" }],
      }),
    );
  }, feedUrl);
  // Before it connects, the device downloads its calendar itself (a plain browser: blocked by CORS here).
  const direct = laptop.waitForRequest((r) => r.url().includes("ejemplo.ics"));
  await laptop.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await laptop.waitForSelector(".ev");
  await direct;
  const asked: string[] = [];
  laptop.on("request", (r) => r.url().includes("ejemplo.ics") && asked.push(r.url()));
  await connect(laptop);
  await expect(laptop.locator(".modal")).toContainText("En directo");
  await expect(laptop.getByText("añadidos a tu cuenta: 1")).toBeVisible();
  await laptop.keyboard.press("Escape");
  await expect(laptop.locator(".ev", { hasText: "Taller de la cuenta" })).toHaveCount(1);
  expect(asked).toEqual([]); // downloaded by the server, not by the device
  expect(served).toBeGreaterThan(0);

  // The phone, a new device: nothing to add, the account's calendar is there.
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await connect(phone);
  await expect(phone.locator(".modal")).toContainText("En directo");
  await expect(phone.locator(".ext-hint")).toContainText("cifrados en tu cuenta");
  await expect(phone.locator(".ext-settings")).toContainText("Talleres");
  await phone.keyboard.press("Escape");
  await expect(phone.locator(".ev", { hasText: "Taller de la cuenta" })).toHaveCount(1);

  // A preference changed on the phone reaches the laptop live; the theme stays per device.
  const settingsOf = (p: typeof phone) =>
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    p.evaluate(() => (window as any).__app.getState().settings);
  await phone.evaluate(() =>
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    (window as any).__app.getState().setSettings({ h24: false, theme: "light" }),
  );
  await expect.poll(async () => (await settingsOf(laptop)).h24).toBe(false);
  expect((await settingsOf(laptop)).theme).toBe("dark");

  // Removed on the laptop: gone from the phone too.
  await laptop.keyboard.press("Control+,");
  await laptop
    .locator(".ext-settings .setting", { hasText: "Talleres" })
    .getByTitle("Quitar")
    .click();
  await laptop.keyboard.press("Escape");
  await expect(phone.locator(".ev", { hasText: "Taller de la cuenta" })).toHaveCount(0, {
    timeout: 5000,
  });
  feed.close();
});

test("after too many failed logins the server makes new ones wait, and the app says so", async ({
  page,
}) => {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.keyboard.press("Control+,");
  const form = page.locator(".modal .server-form");
  await form.locator("input").nth(0).fill(url);
  await form.locator("input").nth(1).fill("nadie");
  for (let i = 0; i < 6; i++) {
    await form.locator("input").nth(2).fill(`mal-${i}`);
    await form.getByRole("button", { name: "Conectar" }).click();
    await expect(page.locator(".modal .server-error")).toBeVisible();
  }
  await expect(page.locator(".modal .server-error")).toContainText("Demasiados intentos fallidos");
});
