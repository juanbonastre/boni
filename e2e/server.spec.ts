import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { definitionNote } from "../apps/web/src/vault/testing.ts";

/**
 * The app with Boni Calendar Server: a real server (apps/server) on an invented vault and account,
 * the app connecting to it from its own origin (like the desktop and Android apps do).
 */
const NOW = "2025-09-17T14:29";
const PASSWORD = "una contraseña larga de ejemplo";
test.describe.configure({ mode: "serial" });

const note = (title: string, date: string, start: string) =>
  `---\ntitle: "${title}"\ndate: "${date}"\nstartTime: "${start}"\nendTime: "${start.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0"))}"\ncompleted:\n---\nArea: [[docencia]]\n`;

let dir: string;
let proc: ChildProcess | null = null;
let url: string;

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
      env: { ...process.env, BONI_DB: join(dir, "db.sqlite"), BONI_PORT: String(port) },
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
  await expect(page.locator(".modal")).toContainText("En directo · 1 notas");
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
