import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectronApplication, _electron as electron, expect, test } from "@playwright/test";
import { openUserStore } from "../packages/store/src/index.ts";

/**
 * Boni's notices on the desktop (task 62, A-17): with its window closed Boni goes on in the tray, and a notice of the
 * account (a flow's «Avisar», run on the server) shows as a system notification with its text as text; a click opens
 * the window. A server of its own with the agent on (an invented key: a flow by hand calls no model) and a profile of
 * its own, never Juan's.
 */
const ROOT = join(import.meta.dirname, "..");
const PASSWORD = "una contraseña larga de ejemplo";
const PORT = 19000 + Math.floor(Math.random() * 1000);
const SERVER = `http://127.0.0.1:${PORT}`;

let dir = "";
let server: ChildProcess | null = null;
let app: ElectronApplication | null = null;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-desktop-notices-"));
  const env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo"], { cwd: ROOT, env });
  mkdirSync(join(dir, "users"), { recursive: true });
  const store = openUserStore(join(dir, "users", "1.db"));
  // A flow of the account's that only notifies, as one drawn in «Flujos» with «Avisar».
  store.journal.saveFlow({
    id: "aviso",
    name: "Aviso de prueba",
    trigger: { manual: true },
    inputs: [],
    plan: {
      version: 1,
      steps: [
        {
          id: "a",
          op: "call",
          tool: "notify",
          args: { text: { lit: "Resumen de hoy: <b>3</b> tareas" } },
        },
      ],
    },
    layout: null,
    by: "user",
    enabled: true,
    created: Date.now() - 60_000,
  });
  store.close();
  server = spawn("node", ["apps/server/src/main.ts"], {
    cwd: ROOT,
    env: { ...env, BONI_PORT: String(PORT), ANTHROPIC_API_KEY: "clave-inventada-0005" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 20_000);
    server?.stdout?.on("data", (b: Buffer) => {
      if (b.toString().includes(`127.0.0.1:${PORT}`)) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  const bin = process.env.BONI_DESKTOP_BIN;
  mkdirSync(join(dir, "tmp"));
  app = await electron.launch({
    cwd: join(ROOT, "apps", "boni-desktop"),
    ...(bin ? { executablePath: bin } : {}),
    args: [...(bin ? [] : ["."]), `--user-data-dir=${join(dir, "electron")}`],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_DATA_HOME: join(dir, "data"),
      TMPDIR: join(dir, "tmp"),
    },
  });
});

test.afterAll(async () => {
  await app?.close();
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

/** The desktop app's own log (Settings shows where): what its notices' stream did. */
const desktopLog = () => {
  const f = join(dir, "data", "boni", "boni.log");
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

type Shown = { title: string; body: string };
/** What the test keeps of the notifications the app makes (in its main process). */
type Kept = { shown: Shown[]; last: { emit(event: string): boolean } | null };

test("a notice with the window closed: a system notification from the tray, its text as text; a click opens Boni", async () => {
  const a = app as ElectronApplication;
  const w = await a.firstWindow();
  await w.setViewportSize({ width: 1280, height: 860 });
  await w.getByRole("button", { name: "Configurar servidor" }).click();
  await w.getByPlaceholder("https://boni.example.ts.net").fill(SERVER);
  const form = w.locator(".server-form");
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator('input[type="password"]').fill(PASSWORD);
  await form.locator("input").nth(3).fill("portatil-ejemplo");
  await w.getByRole("button", { name: "Entrar" }).click();
  await expect.poll(desktopLog).toContain("notices: connected");

  // What the system is asked to show (CI's virtual screen has no notification server; Juan's shows it).
  await a.evaluate(({ Notification }) => {
    const g = globalThis as unknown as Kept;
    g.shown = [];
    g.last = null;
    Notification.isSupported = () => true;
    Notification.prototype.show = function (this: Shown & { emit(event: string): boolean }) {
      g.shown.push({ title: this.title, body: this.body });
      g.last = this;
    };
  });
  // The main window closed: Boni goes on in the tray.
  const mainWindows = () =>
    a.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((b) => b.getMinimumSize()[0] === 640 && b.isVisible())
          .length,
    );
  await a.evaluate(({ BrowserWindow }) => {
    for (const b of BrowserWindow.getAllWindows()) if (b.getMinimumSize()[0] === 640) b.close();
  });
  await expect.poll(mainWindows).toBe(0);

  // The flow runs on the server (as «Ejecutar» or its time would run it): its «Avisar» reaches this computer.
  const login = await fetch(`${SERVER}/api/v1/login`, {
    method: "POST",
    body: JSON.stringify({ user: "ejemplo", password: PASSWORD, device: "movil-ejemplo" }),
  });
  const { token } = (await login.json()) as { token: string };
  const run = await fetch(`${SERVER}/api/agent/flows/aviso/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
  });
  expect(run.status).toBe(200);
  const shown = () => a.evaluate(() => (globalThis as unknown as Kept).shown);
  // Markup in a notice shows as it is: never bold, never a link.
  await expect
    .poll(shown)
    .toEqual([{ title: "Boni", body: "Resumen de hoy: &lt;b&gt;3&lt;/b&gt; tareas" }]);
  expect(desktopLog()).toContain("notice shown");

  // A click on it opens Boni.
  await a.evaluate(() => (globalThis as unknown as Kept).last?.emit("click"));
  await expect.poll(mainWindows).toBe(1);
});
