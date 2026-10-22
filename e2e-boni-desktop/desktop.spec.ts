import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

const ROOT = join(import.meta.dirname, "..");
const SHOTS = join(ROOT, "e2e-boni", "screenshots");
const PASSWORD = "una contraseña larga de ejemplo";
const PORT = 18000 + Math.floor(Math.random() * 1000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const tomorrow = new Date(Date.now() + 86_400_000);

/** An invented vault with the shapes of the real one (never real notes): the agenda, people, a note. */
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
    - { id: endTime, name: Hora de fin, type: time }
    - { id: completed, name: Hecha, type: checkbox }
  mapping:
    title: title
    when: { kind: split, date: date, startTime: startTime, endTime: endTime }
    task: { column: completed }
---
`;
const VAULT: Record<string, string> = {
  "_system/colecciones/agenda-docencia.md": DEF,
  [`agenda/docencia/${iso(today)} Clase de ejemplo.md`]: `---\ntitle: "Clase de ejemplo"\ndate: "${iso(today)}"\nstartTime: "10:00"\nendTime: "11:30"\ncompleted: false\n---\nPreparar los ejercicios del tema 3.\n`,
  [`agenda/docencia/${iso(tomorrow)} Tutoría.md`]: `---\ntitle: "Tutoría"\ndate: "${iso(tomorrow)}"\nstartTime: "16:00"\ncompleted: false\n---\n`,
  "registros/personas/ana-ejemplo.md":
    "---\ntype: person\nsummary: Invented colleague.\n---\n# Ana\n",
};

let dir = "";
let server: ChildProcess | null = null;
let app: ElectronApplication | null = null;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-desktop-"));
  const vault = join(dir, "vault");
  for (const [p, text] of Object.entries(VAULT)) {
    mkdirSync(dirname(join(vault, p)), { recursive: true });
    writeFileSync(join(vault, p), text);
  }
  const env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo", vault], {
    cwd: ROOT,
    env,
  });
  mkdirSync(join(dir, "users"), { recursive: true });
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
    env: { ...env, BONI_PORT: String(PORT), BONI_WRITE: "1", ANTHROPIC_API_KEY: "" },
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
  // The desktop app as it runs on Juan's computer, with a profile of its own (never his).
  // BONI_DESKTOP_BIN: the packaged app (release/linux-unpacked/boni) instead of the source.
  const bin = process.env.BONI_DESKTOP_BIN;
  app = await electron.launch({
    cwd: join(ROOT, "apps", "boni-desktop"),
    ...(bin ? { executablePath: bin } : {}),
    args: [...(bin ? [] : ["."]), `--user-data-dir=${join(dir, "electron")}`],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_DATA_HOME: join(dir, "data"),
    },
  });
});

test.afterAll(async () => {
  await app?.close();
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

const shot = (w: Page, name: string) => w.screenshot({ path: join(SHOTS, `desktop-${name}.png`) });

test("the desktop app: logs in, makes a page, the agenda as a calendar, a note opened with its text", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  await w.setViewportSize({ width: 1280, height: 860 });
  // Log in (Settings → Account), as a new device of the account.
  await w.getByRole("button", { name: "Configurar servidor" }).click();
  await w.getByPlaceholder("https://boni.example.ts.net").fill(`http://127.0.0.1:${PORT}`);
  const form = w.locator(".server-form");
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator('input[type="password"]').fill(PASSWORD);
  await form.locator("input").nth(3).fill("portatil-ejemplo");
  await w.getByRole("button", { name: "Entrar" }).click();
  await w.keyboard.press("Escape");
  // No pages yet: the welcome; the first page from there.
  await expect(w.locator(".welcome")).toBeVisible();
  await w.locator(".welcome").getByRole("button", { name: "Nueva página" }).click();
  await w.keyboard.type("Mi agenda", { delay: 20 });
  await w.keyboard.press("Enter");
  await w.keyboard.type("/docencia", { delay: 20 });
  await expect(w.locator(".slash-menu")).toContainText("Docencia");
  await w.keyboard.press("Enter");
  const db = w.locator(".db");
  await expect(db.locator(".db-table tbody tr")).toHaveCount(2);
  await shot(w, "table");
  // The calendar: the class today at its time.
  await db.getByRole("radio", { name: "Calendario" }).click();
  await expect(db.locator(".db-cal-day.today")).toContainText("10:00");
  await expect(db.locator(".db-cal-day.today")).toContainText("Clase de ejemplo");
  await shot(w, "calendar");
  // Opened as a page: its properties and the note's text, written and kept.
  await db.locator(".db-cal-day.today .db-cal-item").first().click();
  await expect(w.locator(".row-body")).toHaveValue(/Preparar los ejercicios del tema 3/);
  await w.locator(".row-body").click();
  await w.keyboard.press("Control+End");
  await w.keyboard.type("\nLlevar el proyector.", { delay: 15 });
  await shot(w, "row");
  await w.waitForTimeout(1200);
  await w.locator(".topbar .crumb", { hasText: "Mi agenda" }).click();
  await db.locator(".db-cal-day.today .db-cal-item").first().click();
  await expect(w.locator(".row-body")).toHaveValue(/Llevar el proyector/);
});
