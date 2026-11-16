import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { seed } from "../apps/server/src/seed.test-util.ts";
import { FORMAT } from "../packages/automations/src/format.ts";
import { openUserStore } from "../packages/store/src/index.ts";
import { type Server, startServer } from "./server.ts";

/**
 * F14c's criterion the way it will be tried (docs/automatizaciones.md §8): the real desktop app over the real server
 * and the real box, a profile and a store of its own, with data shaped like the user's (seed.test-util.ts) and its
 * volume: a collection of 3,000 rows. The box is its own process on a socket of the test (`apps/sandbox`, as the
 * server's container runs it), and the server starts as desktop.spec.ts starts it, told that socket. Nothing here
 * calls a model, and typing goes at a person's pace. Those still pending are brought by the phase's later PRs, each
 * rule's id kept in its name.
 */

const ROOT = join(import.meta.dirname, "..");
const PASSWORD = "una contraseña larga de ejemplo";
/** «Gasto»'s 3,000 rows: each `importe` from 0 to 99, thirty times, as an import leaves them. */
const ROWS = 3000;
const NAME = "Doblar los gastos";

let dir = "";
let box: ChildProcess | null = null;
let server: Server | null = null;
let app: ElectronApplication | null = null;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-desktop-code-"));
  const socket = join(dir, "caja.sock");
  box = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(ROOT, "apps", "sandbox", "src", "main.ts")],
    { env: { ...process.env, BONI_SANDBOX_SOCKET: socket }, stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve) => box?.stdout?.once("data", () => resolve()));
  const env = {
    ...process.env,
    BONI_DB: join(dir, "boni-calendar.db"),
    BONI_PASSWORD: PASSWORD,
    BONI_SANDBOX_SOCKET: socket,
  };
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo"], { cwd: ROOT, env });
  mkdirSync(join(dir, "users"), { recursive: true });
  const store = openUserStore(join(dir, "users", "1.db"));
  seed(
    store,
    [
      {
        key: "gasto",
        name: "Gasto",
        folder: "finanzas/gastos/",
        fields: { Fecha: "date", Importe: "number" },
      },
    ],
    {},
  );
  const type = store.schema().types.t_gasto;
  if (!type) throw new Error("no Gasto");
  const id = (name: string) => type.fields.find((f) => f.name === name)?.id as string;
  const label = type.label as never;
  store.batch(() => {
    for (let i = 0; i < ROWS; i++)
      store.create(
        "t_gasto",
        {
          [id("Título")]: { value: `Gasto ${i + 1}`, label },
          [id("Fecha")]: { value: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, label },
          [id("Importe")]: { value: (i * 7) % 100, label },
        },
        { actor: "import", device: "seed" },
      );
  });
  store.close();
  server = await startServer({ ...env, BONI_WRITE: "1", ANTHROPIC_API_KEY: "" });
  mkdirSync(join(dir, "tmp"));
  app = await launch();
  await login(await app.firstWindow(), "portatil-ejemplo");
});

/** Logged in as a new device of the account (Settings → Account), as desktop.spec.ts does. */
async function login(w: Page, device: string) {
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.getByRole("button", { name: "Configurar servidor" }).click();
  await w.getByPlaceholder("https://boni.example.ts.net").fill((server as Server).url);
  const form = w.locator(".server-form");
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator('input[type="password"]').fill(PASSWORD);
  await form.locator("input").nth(3).fill(device);
  await w.getByRole("button", { name: "Entrar" }).click();
  await w.keyboard.press("Escape");
}

/** The desktop app with a profile of its own (never the user's). */
function launch() {
  const bin = process.env.BONI_DESKTOP_BIN;
  return electron.launch({
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
}

test.afterAll(async () => {
  await app?.close();
  server?.process.kill();
  box?.kill();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * What the server answers the app, asked through the app's own door (its device's token, never one of the test). A
 * request before the login has kept its token is answered «not configured»: it is asked again, up to 30 s.
 */
async function ask(w: Page, method: string, path: string, body?: unknown) {
  let r = await through(w, method, path, body);
  for (let i = 0; i < 60 && r.notConfigured; i++) {
    await w.waitForTimeout(500);
    r = await through(w, method, path, body);
  }
  expect(r.status, `${method} ${path}: ${JSON.stringify(r).slice(0, 300)}`).toBe(200);
  return JSON.parse(r.body ?? "null");
}
function through(w: Page, method: string, path: string, body?: unknown) {
  return w.evaluate(
    ([m, p, b]) =>
      (
        window as unknown as {
          boniDesktop: {
            request(
              m: string,
              p: string,
              b?: unknown,
            ): Promise<{ status?: number; body?: string; notConfigured?: boolean }>;
          };
        }
      ).boniDesktop.request(m as string, p as string, b),
    [method, path, body] as const,
  );
}

const view = (w: Page) => w.locator(".auto-view");
const param = (w: Page, key: string) => view(w).locator(`.auto-param[data-param="${key}"]`);
const testBar = (w: Page) => w.locator(".auto-test-bar");

test("AU-27 AU-23 · in the desktop app over the real server and the real box, the value under an expression with JavaScript is, row by row, the value the test gave that row", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  // «Doblar» writes each expense's `importe` twice over: JavaScript, worked out by the box.
  const steps = [
    {
      id: "s_01kx3inicio00",
      name: "Disparado por el usuario",
      type: "manual",
      params: { fields: [] },
    },
    {
      id: "s_01kx3buscar00",
      name: "Buscar filas en Gasto",
      type: "collection",
      params: { collection: "gasto", action: "find", where: [], sort: [], limit: 5000 },
    },
    {
      id: "s_01kx3doblar00",
      name: "Doblar",
      type: "edit",
      params: {
        keep: "all",
        fields: [{ field: "doble", value: { expr: "{{ $json.importe * 2 }}" } }],
      },
    },
  ];
  const made = await ask(w, "POST", "api/agent/automations", {
    automation: {
      format: FORMAT,
      id: "",
      version: 0,
      name: NAME,
      steps,
      arrows: steps.slice(1).map((s, i) => ({
        from: { step: steps[i]?.id, output: "main" },
        to: { step: s.id, input: "main" },
      })),
      settings: {},
    },
  });
  await w
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await w.locator(".db-table tbody tr").getByText(NAME, { exact: true }).click();
  await expect(w.getByRole("textbox", { name: "Nombre de la automatización" })).toHaveValue(NAME);
  await expect(w.locator(".auto-card")).toHaveCount(3);
  // «Probar» the whole draft over the 3,000 rows.
  await testBar(w).locator(".auto-test-go").click();
  await expect(testBar(w).locator(".auto-log-line")).toContainText("bien", { timeout: 60_000 });
  // What the test gave «Doblar»'s first three rows, as the server keeps them.
  const kept = await ask(
    w,
    "GET",
    `api/agent/automations/${made.id}/test/rows?${new URLSearchParams({ step: "s_01kx3doblar00", side: "out", name: "main", offset: "0" })}`,
  );
  const gave = (kept.rows as { json: { doble: number } }[]).slice(0, 3).map((r) => r.json.doble);
  expect(gave).toHaveLength(3);
  // Opened, the line under the expression is the box's value for row 1; «›» goes on, row by row.
  await w.locator('.auto-card[data-step="s_01kx3doblar00"]').dblclick();
  await expect(view(w)).toHaveAttribute("data-step", "s_01kx3doblar00");
  const fields = param(w, "fields");
  const line = fields.locator(".auto-preview").first();
  const next = fields.getByRole("button", { name: "Fila siguiente" }).first();
  const of = ROWS.toLocaleString("es-ES");
  await expect(line).toHaveText(`= ${gave[0]} · con la fila 1 de ${of}`, { timeout: 15_000 });
  await next.click();
  await expect(line).toHaveText(`= ${gave[1]} · con la fila 2 de ${of}`, { timeout: 15_000 });
  await next.click();
  await expect(line).toHaveText(`= ${gave[2]} · con la fila 3 de ${of}`, { timeout: 15_000 });
  // Typed at a person's pace, the line is the box's value of the new text, with the row it was on.
  const editor = fields.getByRole("textbox", { name: "Valor" }).first();
  await editor.click();
  await editor.press("Control+End");
  await editor.press("ArrowLeft");
  await editor.press("ArrowLeft");
  await editor.pressSequentially("+ 1 ", { delay: 120 });
  await expect(line).toHaveText(`= ${(gave[2] ?? 0) + 1} · con la fila 3 de ${of}`, {
    timeout: 15_000,
  });
});

test.fixme("AU-30 AU-31 AU-33 · the criterion of F14c in the desktop app over the real server and the real box: a «Código» with the code of the design's §5.4 written in its editor, its two collections connected, «Probar paso» run over 3,000 rows, its rows seen in the output and its `console.log` in «Consola», and nothing written in any collection", async () => {});

test.fixme("AU-31 · in the desktop app over the real server, citing a collection that is not connected says «Conecta … a este paso»; the button connects it and the step can be tested", async () => {});

test.fixme("AU-38 · in the desktop app over the real server and the real box, an expression with JavaScript over 3,000 rows is tested within the time written in the test, and the canvas answers while it runs", async () => {});
