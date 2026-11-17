import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clock, under } from "@boni/pace";
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
/**
 * «Gasto»'s 3,000 rows: each `importe` from 0 to 99, thirty times, as an import leaves them, and each of one of the
 * twelve «Categorías» in turn.
 */
const ROWS = 3000;
const CATEGORIES = 12;
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
        key: "categorias",
        name: "Categorías",
        folder: "finanzas/categorias/",
        fields: { Nombre: "text", Presupuesto: "number" },
      },
      {
        key: "gasto",
        name: "Gasto",
        folder: "finanzas/gastos/",
        fields: {
          Fecha: "date",
          Importe: "number",
          Categoría: { type: "relation", to: "categorias" },
        },
      },
    ],
    {},
  );
  const fieldsOf = (t: string) => {
    const type = store.schema().types[t];
    if (!type) throw new Error(`no ${t}`);
    return {
      id: (name: string) => type.fields.find((f) => f.name === name)?.id as string,
      label: type.label as never,
    };
  };
  const cat = fieldsOf("t_categorias");
  const gasto = fieldsOf("t_gasto");
  store.batch(() => {
    const cats: string[] = [];
    for (let i = 0; i < CATEGORIES; i++)
      cats.push(
        store.create(
          "t_categorias",
          {
            [cat.id("Título")]: { value: `Categoría ${i + 1}`, label: cat.label },
            [cat.id("Nombre")]: { value: `Categoría ${i + 1}`, label: cat.label },
            [cat.id("Presupuesto")]: { value: 4000 + i * 100, label: cat.label },
          },
          { actor: "import", device: "seed" },
        ).entity.id,
      );
    for (let i = 0; i < ROWS; i++)
      store.create(
        "t_gasto",
        {
          [gasto.id("Título")]: { value: `Gasto ${i + 1}`, label: gasto.label },
          [gasto.id("Fecha")]: {
            value: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
            label: gasto.label,
          },
          [gasto.id("Importe")]: { value: (i * 7) % 100, label: gasto.label },
          [gasto.id("Categoría")]: { value: cats[i % CATEGORIES] as string, label: gasto.label },
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

/**
 * A draft made through the app's own door, each step after the one before it; its id. `settings` holds the run's limits
 * where a test writes more than their defaults (AU-17).
 */
async function make(
  w: Page,
  name: string,
  steps: { id: string }[],
  settings: Record<string, unknown> = {},
): Promise<string> {
  const made = await ask(w, "POST", "api/agent/automations", {
    automation: {
      format: FORMAT,
      id: "",
      version: 0,
      name,
      steps,
      arrows: steps.slice(1).map((s, i) => ({
        from: { step: steps[i]?.id, output: "main" },
        to: { step: s.id, input: "main" },
      })),
      settings,
    },
  });
  return made.id as string;
}
/** «Automatizaciones» from the sidebar, and `name` opened with its `steps` boxes. */
async function openAutomation(w: Page, name: string, steps: number) {
  await w
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await w.locator(".db-table tbody tr").getByText(name, { exact: true }).click();
  await expect(w.getByRole("textbox", { name: "Nombre de la automatización" })).toHaveValue(name);
  await expect(w.locator(".auto-card")).toHaveCount(steps);
}
/** How many rows each collection has, as the server says it. */
async function counts(w: Page): Promise<Record<string, number>> {
  const b = await ask(w, "GET", "api/data/types");
  return Object.fromEntries(
    (b.types as { key?: string; count: number }[]).map((t) => [t.key ?? "", t.count]),
  );
}
const START = {
  id: "s_01kx3inicio00",
  name: "Disparado por el usuario",
  type: "manual",
  params: { fields: [] },
};
const FIND = {
  id: "s_01kx3buscar00",
  name: "Buscar filas en Gasto",
  type: "collection",
  params: { collection: "gasto", action: "find", where: [], sort: [], limit: 5000 },
};
/** The code of the design's §5.4, as it is there: this store's collections have its names. */
const BY_CATEGORY = `// Lo gastado por categoría, con el presupuesto de cada una
const categorias = $col('Categorías').find();
const gastado = {};
for (const gasto of $input.all()) {
  gastado[gasto.categoria] = (gastado[gasto.categoria] ?? 0) + gasto.importe;
}
console.log('categorías con gasto:', Object.keys(gastado).length);
return categorias.map((c) => ({
  categoria: c.nombre,
  gastado: gastado[c.id] ?? 0,
  presupuesto: c.presupuesto,
  pasada: (gastado[c.id] ?? 0) > c.presupuesto,
}));`;

test("AU-30 AU-31 AU-33 · the criterion of F14c in the desktop app over the real server and the real box: a «Código» with the code of the design's §5.4 written in its editor, its collection connected from «Conecta … a este paso», «Probar paso» run over 3,000 rows, its rows seen in the output and its `console.log` in «Consola», and nothing written in any collection", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  const name = "Gastado por categoría";
  const code = { id: "s_01kx3codigo00", name: "Código", type: "code", params: { source: "" } };
  const id = await make(w, name, [START, FIND, code]);
  const before = await counts(w);
  expect(before).toMatchObject({ gasto: ROWS, categorias: CATEGORIES });
  await openAutomation(w, name, 3);
  await w.locator(`.auto-card[data-step="${code.id}"]`).dblclick();
  await expect(view(w)).toHaveAttribute("data-step", code.id);
  // Written in its editor line by line, at a person's pace (as a whole line, so the editor's closing of brackets
  // does not add its own).
  const content = param(w, "source").locator(".cm-content");
  await content.click();
  for (const line of BY_CATEGORY.split("\n")) {
    await w.keyboard.insertText(`${line}\n`);
    await w.waitForTimeout(60);
  }
  const testStep = view(w).locator(".auto-view-test").getByRole("button", { name: "Probar paso" });
  // «Categorías» is not connected: said with its button, and it cannot be tested.
  const notice = param(w, "source").locator(".auto-code-connect");
  await expect(notice).toContainText("Conecta «Categorías» a este paso");
  await expect(testStep).toBeDisabled();
  await notice.getByRole("button", { name: "Conectar" }).click();
  await expect(notice).toHaveCount(0);
  await expect(testStep).toBeEnabled();
  await testStep.click();
  // «Consola»: its line, from the line of the code that wrote it.
  const line = view(w).locator(".auto-console .auto-console-line").first();
  await expect(line).toContainText(`categorías con gasto: ${CATEGORIES}`, { timeout: 60_000 });
  await expect(line.locator(".auto-console-where")).toHaveText("línea 7");
  // Its rows, one per category, with what the 3,000 expenses add up to in each.
  await expect(view(w).getByRole("region", { name: "Salida" })).toContainText("Categoría 1");
  const kept = await ask(
    w,
    "GET",
    `api/agent/automations/${id}/test/rows?${new URLSearchParams({ step: code.id, side: "out", name: "main", offset: "0" })}`,
  );
  const want = new Map<string, number>();
  for (let i = 0; i < ROWS; i++) {
    const c = `Categoría ${(i % CATEGORIES) + 1}`;
    want.set(c, (want.get(c) ?? 0) + ((i * 7) % 100));
  }
  const rows = (kept.rows as { json: { categoria: string; gastado: number } }[]).map((r) => r.json);
  expect(rows).toHaveLength(CATEGORIES);
  for (const r of rows) expect(r.gastado, r.categoria).toBe(want.get(r.categoria));
  // Saved with the draft: the connection reads «Categorías» and nothing more; and nothing was written.
  const draft = await ask(w, "GET", `api/agent/automations/${id}`);
  const saved = draft.automation.steps.find((s: { id: string }) => s.id === code.id);
  expect(saved.connections).toEqual([
    { collection: "categorias", read: {}, create: false, update: false, remove: false },
  ]);
  expect(await counts(w)).toEqual(before);
});

test("AU-38 · in the desktop app over the real server and the real box, expressions with JavaScript and a «Código» «Una vez por fila» over 3,000 rows are tested within the time written in the test, and the canvas answers while it runs", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  const name = "Doblar con tiempo";
  const steps = [
    START,
    FIND,
    {
      id: "s_01kx3doblar00",
      name: "Doblar",
      type: "edit",
      params: {
        keep: "all",
        fields: [
          { field: "doble", value: { expr: "{{ $json.importe * 2 }}" } },
          { field: "nivel", value: { expr: "{{ $json.importe > 50 ? 'alto' : 'bajo' }}" } },
        ],
      },
    },
    {
      id: "s_01kx3triple00",
      name: "Triplicar",
      type: "code",
      params: { mode: "perRow", source: "return { ...$json, triple: $json.importe * 3 };" },
    },
  ];
  await make(w, name, steps);
  await openAutomation(w, name, 4);
  const from = clock();
  await testBar(w).locator(".auto-test-go").click();
  // While it runs, a click on a box selects it at once.
  const card = w.locator('.auto-card[data-step="s_01kx3buscar00"]');
  const asked = clock();
  await card.click();
  await expect(card).toHaveClass(/selected/, { timeout: 5_000 });
  const answered = clock() - asked;
  const log = testBar(w).locator(".auto-log-line");
  expect(await log.textContent()).not.toContain("bien");
  under(answered, 1_000, "clock", "selecting a box while the test runs");
  await expect(log).toContainText("bien", { timeout: 60_000 });
  await expect(log).toContainText("4 pasos");
  // The server's test fixes 10 s for five steps of JavaScript (AU-38, S1 and task 138); with the app's own share: 15 s.
  under(clock() - from, 15_000, "clock", "the test of 3,000 rows in the desktop app");
});

/** A «Código» that doubles every expense it reads: it asks to modify 3,000 rows of «Gasto» (AU-172). */
const DOUBLES = `const gastos = $col('Gasto').find({ limit: 5000 });
for (const g of gastos) $col('Gasto').update(g.id, { importe: g.importe * 2 });
return [];`;

test("AU-176 AU-180 AU-181 · the criterion of F14c for a code that saves, in the desktop app over the real server and the real box: its card says what it changes and its connection what it can save; without permission the table says how to fix it and «Permitir» sets «Preguntar»; «Probar paso» shows «Haría esto» over 3,000 rows and saves none", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  const name = "Doblar cada gasto";
  const code = {
    id: "s_01kx3dobla00",
    name: "Código",
    type: "code",
    params: { source: DOUBLES },
    connections: [{ collection: "gasto", read: {}, create: false, update: false, remove: false }],
  };
  // «Probar paso» counts its 3,000 rows against «rows written» like a run (AU-17): raised to its ceiling here.
  const id = await make(w, name, [START, code], { limits: { rowsWritten: 20_000 } });
  const before = await counts(w);
  await openAutomation(w, name, 2);
  const card = w.locator(`.auto-card[data-step="${code.id}"]`);
  // On the canvas, before opening it: what it changes, and what its connection lets it do.
  await expect(card.locator(".auto-label.change")).toHaveText("Modifica Gasto");
  await expect(card.locator(".auto-conn-chip")).toHaveText("GastoSolo lee");
  await card.dblclick();
  await expect(view(w)).toHaveAttribute("data-step", code.id);
  const table = param(w, "connections");
  const cell = table.locator('tr[data-collection="gasto"] .auto-conn-cell[data-action="update"]');
  await expect(cell).toHaveClass(/\bmissing\b/);
  const notice = table.locator(".auto-conn-allow");
  await expect(notice).toContainText("Permite modificar en «Gasto»");
  const testStep = view(w).locator(".auto-view-test").getByRole("button", { name: "Probar paso" });
  await expect(testStep).toBeDisabled();
  await notice.getByRole("button", { name: "Permitir" }).click();
  await expect(cell).toHaveAttribute("data-cell", "ask");
  await expect(table.locator(".auto-conn-sentence")).toHaveText(
    "Puede leer y modificar Gasto. No puede crear ni eliminar nada.",
  );
  await expect(card.locator(".auto-conn-chip")).toHaveText("GastoLee y modifica · pregunta antes");
  await expect(testStep).toBeEnabled();
  await testStep.click();
  const would = view(w).getByRole("region", { name: "Salida" }).locator(".auto-would-code");
  await expect(would.locator(".auto-would-line")).toHaveText(["Modificaría 3000 filas en Gasto"], {
    timeout: 60_000,
  });
  await would.locator("summary").click();
  await expect(would).toContainText("Al ejecutarse, preguntaría antes de guardar");
  await expect(would.locator("tbody tr")).toHaveCount(100);
  // Only `importe` changes, before and after; the rows whose `importe` is 0 stay the same (0 × 2), so not every one.
  await expect(would.locator("tbody tr td.changed").first()).toBeVisible();
  for (const row of await would.locator("tbody tr").all())
    expect(await row.locator("td.changed").count()).toBeLessThanOrEqual(1);
  await expect(would.locator(".auto-console-more")).toHaveText("y 2900 filas más");
  // Saved with the draft: «Modificar» at «Preguntar», never «Sí»; and nothing was written.
  const draft = await ask(w, "GET", `api/agent/automations/${id}`);
  const saved = draft.automation.steps.find((s: { id: string }) => s.id === code.id);
  expect(saved.connections).toEqual([
    { collection: "gasto", read: {}, create: false, update: { mode: "ask" }, remove: false },
  ]);
  expect(await counts(w)).toEqual(before);
});
