import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

/**
 * The note peek as a window of Boni Calendar (Juan, 2026-10-22): with Boni's address in Settings → Desktop, a
 * double click on an event shows its note in the calendar's own small window (Boni's page from Boni's server,
 * logged in once), and a click in the calendar puts it away at once. Invented account and vault.
 */
const ROOT = join(import.meta.dirname, "..");
const SHOTS = join(ROOT, "e2e", "screenshots");
const PASSWORD = "una contraseña larga de ejemplo";
const PORT = 19000 + Math.floor(Math.random() * 1000);
const BONI = `http://127.0.0.1:${PORT}`;
const NOTE = "agenda/docencia/2026-10-27 Clase de ejemplo.md";
const DEF = `---
type: wiki
collection:
  id: docencia
  name: Docencia
  folder: agenda/docencia
  account: Agenda
  color: "#60a5fa"
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
    - { id: startTime, name: Hora de inicio, type: time }
  mapping:
    title: title
    when: { kind: split, date: date, startTime: startTime }
---
`;

let dir = "";
let server: ChildProcess | null = null;
let app: ElectronApplication | null = null;
let main: Page;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-calendar-peek-"));
  const vault = join(dir, "vault");
  const files: Record<string, string> = {
    "_system/colecciones/agenda-docencia.md": DEF,
    [NOTE]:
      '---\ntitle: "Clase de ejemplo"\ndate: "2026-10-27"\nstartTime: "10:00"\n---\nPreparar el tema 3.\n',
  };
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(vault, p)), { recursive: true });
    writeFileSync(join(vault, p), text);
  }
  const env = { ...process.env, BONI_DB: join(dir, "boni.db"), BONI_PASSWORD: PASSWORD };
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo", vault], {
    cwd: ROOT,
    env,
  });
  mkdirSync(join(dir, "users"));
  execFileSync(
    "node",
    [
      "packages/vault-import/src/cli.ts",
      "--vault",
      vault,
      "--store",
      join(dir, "users", "1.db"),
      "--apply",
    ],
    { cwd: ROOT, env },
  );
  server = spawn("node", ["apps/server/src/main.ts"], {
    cwd: ROOT,
    env: {
      ...env,
      BONI_PORT: String(PORT),
      BONI_WRITE: "1",
      BONI_BONI_WEB: join(ROOT, "apps", "boni-web", "dist"),
      ANTHROPIC_API_KEY: "",
    },
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
  const shell = join(ROOT, "apps", "calendar-desktop");
  // CALENDAR_DESKTOP_BIN: the packaged app (release/linux-unpacked/boni-calendar) instead of the source.
  const bin = process.env.CALENDAR_DESKTOP_BIN;
  app = await electron.launch({
    executablePath: bin ?? (createRequire(join(shell, "package.json"))("electron") as string),
    args: [...(bin ? [] : [shell]), `--user-data-dir=${join(dir, "electron")}`],
    env: { ...process.env, XDG_CONFIG_HOME: join(dir, "config") },
  });
  main = await app.firstWindow();
  await main.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

const peekPage = async () => {
  for (let i = 0; i < 100; i++) {
    const p = (app as ElectronApplication).windows().find((w) => w.url().includes("/boni/?peek=1"));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no peek window");
};
const peekVisible = () =>
  (app as ElectronApplication).evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (w) => w.webContents.getURL().includes("/boni/?peek=1") && w.isVisible(),
    ),
  );
/** The shell's preload bridges, as the calendar's page calls them (a type only: it is erased in the page). */
type Bridges = {
  boniVault: { openNote(path: string, opts?: { peek?: boolean }): Promise<unknown> };
  boniDesktop: { setPrefs(patch: Record<string, unknown>): Promise<unknown> };
};
const doubleClick = () =>
  main.evaluate(
    (path) => (window as unknown as Bridges).boniVault.openNote(path, { peek: true }),
    NOTE,
  );

test("Boni's address in Settings → Desktop; a bad one is refused", async () => {
  const bad = await main.evaluate(() =>
    (window as unknown as Bridges).boniDesktop.setPrefs({ boniUrl: "http://boni.example.net" }),
  );
  expect(bad).toMatchObject({ ok: false });
  const good = await main.evaluate(
    (url) => (window as unknown as Bridges).boniDesktop.setPrefs({ boniUrl: `${url}/boni/` }),
    BONI,
  );
  expect(good).toMatchObject({ ok: true, value: { boniUrl: BONI } });
});

test("a double click: the note in the calendar's own window, logged in once; a click in the calendar puts it away", async () => {
  await doubleClick();
  const peek = await peekPage();
  await expect.poll(peekVisible).toBe(true);
  // The first time: its own login (the address is the page's).
  await expect(peek.getByText("Inicia sesión una vez")).toBeVisible();
  await peek.screenshot({ path: join(SHOTS, "calendar-peek-login.png") });
  await peek.getByLabel("Usuario").fill("ejemplo");
  await peek.getByLabel("Contraseña").fill(PASSWORD);
  await expect(peek.getByLabel("Dirección del servidor")).toHaveCount(0); // the page's own
  await expect(peek.getByLabel("Nombre de este equipo")).toHaveValue("Boni Calendar (notas)");
  await peek.getByRole("button", { name: "Entrar" }).click();
  await expect(peek.locator(".doc-title")).toHaveValue("Clase de ejemplo");
  await expect(peek.locator(".peek-head")).toContainText("Docencia");
  await peek.screenshot({ path: join(SHOTS, "calendar-peek.png") });
  // Above the calendar only, not over other apps' windows.
  const where = await (app as ElectronApplication).evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes("/boni/?peek=1"),
    );
    return {
      onTop: p?.isAlwaysOnTop(),
      parentIsCalendar: !!p?.getParentWindow()?.webContents.getURL().startsWith("file:"),
    };
  });
  expect(where).toEqual({ onTop: false, parentIsCalendar: true });
  // Going to another window keeps it; a click in the calendar puts it away at once.
  await main.mouse.click(600, 400);
  const t0 = Date.now();
  await expect.poll(peekVisible).toBe(false);
  expect(Date.now() - t0).toBeLessThan(1000);
  // The next double click opens straight on the note, no login.
  await doubleClick();
  await expect.poll(peekVisible).toBe(true);
  await expect(peek.locator(".doc-title")).toHaveValue("Clase de ejemplo");
  // Esc puts it away too.
  await peek.keyboard.press("Escape");
  await expect.poll(peekVisible).toBe(false);
});
