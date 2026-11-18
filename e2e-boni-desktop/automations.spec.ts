import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { seed } from "../apps/server/src/seed.test-util.ts";
import { openUserStore } from "../packages/store/src/index.ts";
import { type Server, startServer } from "./server.ts";

// The second test opens what the first made.
test.describe.configure({ mode: "serial" });

/**
 * F14b's criterion the way Juan will try it (docs/automatizaciones.md §8): the real desktop app over the real
 * server, a profile and a store of its own (never Juan's), with data shaped like his (seed.test-util.ts: generated
 * ids, his collections' keys and names) and his volume: a collection of 3,000 rows. The server starts as
 * desktop.spec.ts starts it (`startServer`, the agent on with an invented key: nothing here calls a model); dragging
 * and typing go at a person's pace. The tests run in order: the second opens what the first made.
 */

const ROOT = join(import.meta.dirname, "..");
const SHOTS = join(ROOT, "e2e-boni", "screenshots");
const PASSWORD = "una contraseña larga de ejemplo";
/** «Gasto»'s 3,000 rows: each `importe` from 0 to 99 thirty times, over a `presupuesto` of 40 and an `aviso` of 80. */
const ROWS = 3000;
const over = (limit: number) => (ROWS / 100) * (99 - limit);
/** Rows whose `importe` passes «Filtrar» (over the budget) and then «Si» (over the warning). */
const FILTERED = over(40);
const WARNED = over(80);
const NAME = "Gastos por encima del presupuesto";

let dir = "";
let server: Server | null = null;
let app: ElectronApplication | null = null;
/** Where each step was left by the first test, by its name, for the second. */
let left: Record<string, { x: number; y: number }> = {};

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "boni-desktop-auto-"));
  const env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
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
        fields: { Fecha: "date", Importe: "number", Presupuesto: "number", Aviso: "number" },
      },
    ],
    {},
  );
  // 3,000 rows, as an import leaves them.
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
          [id("Presupuesto")]: { value: 40, label },
          [id("Aviso")]: { value: 80, label },
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

/** A read of the desktop's store held in its main process until the test lets it go. */
type Held = { asked?: boolean; answered?: boolean; go?: () => void };

/**
 * The desktop app as it runs on Juan's computer, with a profile of its own (never his); `profile` names another
 * one, another computer of the account.
 */
function launch(profile = "") {
  const bin = process.env.BONI_DESKTOP_BIN;
  return electron.launch({
    cwd: join(ROOT, "apps", "boni-desktop"),
    ...(bin ? { executablePath: bin } : {}),
    args: [...(bin ? [] : ["."]), `--user-data-dir=${join(dir, `electron${profile}`)}`],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(dir, `config${profile}`),
      XDG_DATA_HOME: join(dir, `data${profile}`),
      TMPDIR: join(dir, "tmp"),
    },
  });
}

test.afterAll(async () => {
  await app?.close();
  server?.process.kill();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * «Gasto» as the server's store has it, read beside it: its rows and every operation on them (the app writes its own
 * pages and settings on its first login, never in «Gasto»).
 */
function written() {
  const db = new DatabaseSync(join(dir, "users", "1.db"), { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT count(*) AS n, sum(version) AS v, max(updated) AS u FROM entities WHERE type = 't_gasto'",
      )
      .get();
    const ops = db
      .prepare(
        "SELECT count(*) AS n FROM ops WHERE target = 't_gasto' OR target IN (SELECT id FROM entities WHERE type = 't_gasto')",
      )
      .get();
    return { rows, ops };
  } finally {
    db.close();
  }
}

const head = (w: Page) => w.locator(".auto-head");
const saved = (w: Page) => head(w).getByRole("status");
const nameBox = (w: Page) => w.getByRole("textbox", { name: "Nombre de la automatización" });
const list = (w: Page) => w.locator(".db-table tbody tr");
const cards = (w: Page) => w.locator(".auto-card");
const card = (w: Page, id: string) => w.locator(`.auto-card[data-step="${id}"]`);
const cardNamed = (w: Page, name: string) =>
  w
    .locator(".auto-card")
    .filter({ has: w.locator(".auto-card-name", { hasText: new RegExp(`^${name}$`) }) });
const node = (w: Page, id: string) => w.locator(`[data-testid="rf__node-${id}"]`);
const selected = (w: Page) => w.locator(".auto-card.selected");
const panel = (w: Page) => w.locator(".auto-panel");
const view = (w: Page) => w.locator(".auto-view");
const param = (w: Page, key: string) => view(w).locator(`.auto-param[data-param="${key}"]`);
const nameIn = (w: Page) => view(w).getByRole("textbox", { name: "Nombre del paso" });
const entrada = (w: Page) => view(w).getByRole("region", { name: "Entrada" });
const salida = (w: Page) => view(w).getByRole("region", { name: "Salida" });
const testBar = (w: Page) => w.locator(".auto-test-bar");
const countOn = (w: Page, from: string, to: string) =>
  w.locator(`.auto-arrow-count[data-arrow^="${from}:"][data-arrow*=">${to}:"]`);
const schemaField = (w: Page, name: string) =>
  entrada(w)
    .locator(".auto-schema-list:not(.nested) > .auto-schema-field")
    .filter({ has: w.locator(".auto-schema-name", { hasText: new RegExp(`^${name}$`) }) })
    .first();
/** «3000 filas» or «3.000 filas»: a count as the app writes it, alone (`whole`) or in a text. */
const count = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, "\\.?");
const rows = (n: number) => new RegExp(`^${count(n)} filas$`);
const rowsIn = (n: number) => new RegExp(`(?<![\\d.])${count(n)} filas`);
/** Where a box is on the canvas, in the canvas's units (what the server keeps). */
const at = (w: Page, id: string) =>
  node(w, id).evaluate((el) => {
    const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
      (el as HTMLElement).style.transform,
    );
    return { x: Math.round(Number(m?.[1])), y: Math.round(Number(m?.[2])) };
  });
/** Each box's place by its step's name. */
async function placesByName(w: Page) {
  const out: Record<string, { x: number; y: number }> = {};
  for (const c of await cards(w).all()) {
    const name = (await c.locator(".auto-card-name").textContent()) ?? "";
    out[name] = await at(w, (await c.getAttribute("data-step")) as string);
  }
  return out;
}
async function middle(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not on the screen");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** A person's drag: pressed, moved in small steps over about half a second, let go. */
async function drag(w: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await w.mouse.move(from.x, from.y);
  await w.mouse.down();
  for (let i = 1; i <= 25; i++) {
    await w.mouse.move(from.x + ((to.x - from.x) * i) / 25, from.y + ((to.y - from.y) * i) / 25);
    await w.waitForTimeout(16);
  }
  await w.mouse.up();
}
/** Drags `from` onto `to` with the mouse, at a person's pace (AU-21). */
async function dragOnto(w: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("nothing to drag or nowhere to drop");
  await w.mouse.move(a.x + Math.min(20, a.width / 2), a.y + a.height / 2);
  await w.mouse.down();
  await w.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await w.mouse.up();
}
/** The «+» of step `id`'s output opens «Añadir un paso»; `name` is chosen there and opens in its view (AU-65). */
async function addAfter(w: Page, id: string, name: string) {
  await card(w, id).getByRole("button", { name: "Añadir un paso" }).click();
  await expect(panel(w)).toBeVisible();
  await panel(w).getByRole("button", { name, exact: true }).click();
  await expect(view(w)).toBeVisible();
  const made = (await selected(w).getAttribute("data-step")) as string;
  await expect(view(w)).toHaveAttribute("data-step", made);
  return made;
}
/** A condition «<field> mayor que» whose value is the field `cited` of ENTRADA, dragged onto it (AU-21). */
async function overField(w: Page, field: string, cited: string) {
  const where = param(w, "where");
  await where.getByRole("button", { name: "Añadir filtro" }).click();
  const row = where.locator(".db-filter-row").last();
  await row.getByRole("combobox", { name: "Propiedad" }).selectOption({ label: field });
  await row.getByRole("combobox", { name: "Condición" }).selectOption({ label: "mayor que" });
  await dragOnto(w, schemaField(w, cited), row.locator(".auto-value").first());
  const value = row.getByRole("textbox", { name: field });
  await expect(value.locator(".auto-chip")).toHaveText(cited);
  await w.keyboard.press("Escape");
}
async function testStep(w: Page) {
  // The view's own, at its top right (SALIDA has one too while it is untested).
  await view(w).getByRole("button", { name: "Probar paso" }).first().click();
  await expect(salida(w)).not.toContainText("Sin probar", { timeout: 30_000 });
}
async function openAutomations(w: Page) {
  await w
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await expect(w.getByRole("tab", { name: "Tabla" })).toBeVisible();
}
async function openStep(w: Page, id: string) {
  await card(w, id).dblclick();
  await expect(view(w)).toHaveAttribute("data-step", id);
}

test("AU-65 AU-21 AU-70 · the criterion of F14b in the desktop app over the real server: «Buscar filas» in a collection of 3,000 rows, «Filtrar» and «Si» added and filled by dragging fields, each step opened with what comes in and what goes out, «Probar» run, and nothing written in the collection", async () => {
  const w = await (app as ElectronApplication).firstWindow();
  const before = written();
  await openAutomations(w);
  await w.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
  await expect(w.locator(".auto-start")).toContainText("¿Cómo empieza?");
  await panel(w).getByRole("button", { name: "Disparado por el usuario", exact: true }).click();
  await expect(view(w)).toBeVisible();
  const trigger = (await view(w).getAttribute("data-step")) as string;
  await w.keyboard.press("Escape");
  await expect(saved(w)).toHaveText("Guardado");
  await nameBox(w).click();
  await nameBox(w).press("Control+a");
  await nameBox(w).pressSequentially(NAME, { delay: 40 });
  await nameBox(w).press("Enter");

  // «Buscar filas» from the trigger's «+»: in «Gasto», up to 5,000; its test reads the 3,000 rows for real.
  const buscar = await addAfter(w, trigger, "Buscar filas");
  await expect(nameIn(w)).toHaveValue("Buscar filas");
  await param(w, "collection").getByRole("combobox").selectOption({ label: "Gasto" });
  await expect(nameIn(w)).toHaveValue("Buscar filas en Gasto");
  const limit = param(w, "limit").locator("input").first();
  await limit.click();
  await limit.press("Control+a");
  await limit.pressSequentially("5000", { delay: 120 });
  await testStep(w);
  await expect(salida(w)).toContainText(rowsIn(ROWS));
  await w.keyboard.press("Escape");
  await expect(view(w)).toHaveCount(0);

  // «Filtrar» from its «+»: what comes in is «Buscar filas en Gasto»'s 3,000 rows; «Importe» over «Presupuesto».
  const filtrar = await addAfter(w, buscar, "Filtrar");
  await expect(entrada(w).locator(".auto-in-from")).toHaveText(
    new RegExp(`^De «Buscar filas en Gasto» · ${count(ROWS)} filas$`),
  );
  await overField(w, "Importe", "Presupuesto");
  await testStep(w);
  await expect(salida(w)).toContainText(rowsIn(FILTERED));
  await w.screenshot({ path: join(SHOTS, "desktop-automation-step.png") });
  await w.keyboard.press("Escape");
  await expect(view(w)).toHaveCount(0);

  // «Si» from «Filtrar»'s «+»: «Importe» over «Aviso», «sí» and «no» with their counts.
  const si = await addAfter(w, filtrar, "Si");
  await expect(entrada(w).locator(".auto-in-from")).toHaveText(
    new RegExp(`^De «Filtrar» · ${count(FILTERED)} filas$`),
  );
  await overField(w, "Importe", "Aviso");
  await testStep(w);
  await expect(salida(w)).toContainText(`sí (${WARNED})`);
  await expect(salida(w)).toContainText(new RegExp(`no \\(${count(FILTERED - WARNED)}\\)`));
  await w.keyboard.press("Escape");
  await expect(view(w)).toHaveCount(0);
  await expect(saved(w)).toHaveText("Guardado");

  // Each step opened again, with what comes in and what goes out (AU-70).
  for (const [id, from] of [
    [buscar, "Disparado por el usuario"],
    [filtrar, "Buscar filas en Gasto"],
    [si, "Filtrar"],
  ] as const) {
    await openStep(w, id);
    await expect(entrada(w).locator(".auto-in-from")).toContainText(`De «${from}»`);
    await expect(salida(w)).not.toContainText("Sin probar");
    await w.keyboard.press("Escape");
    await expect(view(w)).toHaveCount(0);
  }

  // «Probar» the whole draft: each arrow says its rows, the «Registro» that nothing was written.
  await testBar(w).locator(".auto-test-go").click();
  await expect(testBar(w).locator(".auto-log-line")).toContainText("completada", {
    timeout: 30_000,
  });
  await expect(testBar(w).locator(".auto-log-line")).toContainText("no escribió nada");
  await expect(countOn(w, buscar, filtrar)).toHaveText(rows(ROWS));
  await expect(countOn(w, filtrar, si)).toHaveText(rows(FILTERED));
  await w.screenshot({ path: join(SHOTS, "desktop-automation-canvas.png") });
  // Nothing written in the collection: its rows and the operation log are as they were.
  expect(written()).toEqual(before);
  left = await placesByName(w);
  expect(Object.keys(left).sort()).toEqual(
    ["Buscar filas en Gasto", "Disparado por el usuario", "Filtrar", "Si"].sort(),
  );
});

test("AU-62 AU-05 · the draft made in the desktop app is on the server: after a reload, with the app closed and opened again, and in the app of another computer of the account, the same canvas, each box where it was left and each step with its last test; «Duplicar» with the same places, «Eliminar» and its «Deshacer»", async () => {
  let w = await (app as ElectronApplication).firstWindow();
  // The header has back, the name, «Guardado», «Publicar» (F14d) and «⋯», nothing else of its own (AU-62).
  await expect(nameBox(w)).toHaveValue(NAME);
  await expect(saved(w)).toHaveText("Guardado");
  await expect(head(w).getByRole("button")).toHaveCount(3);
  await expect(head(w).getByRole("button", { name: "Volver a Automatizaciones" })).toBeVisible();
  await expect(head(w).getByRole("button", { name: "Publicar", exact: true })).toBeVisible();
  await expect(head(w).getByRole("button", { name: "Más" })).toBeVisible();
  // «Filtrar» dropped lower: its place is saved apart, the draft does not change (AU-05).
  const filtrar = (await cardNamed(w, "Filtrar").getAttribute("data-step")) as string;
  const c = await middle(card(w, filtrar));
  await drag(w, c, { x: c.x + 30, y: c.y + 150 });
  await expect.poll(async () => (await at(w, filtrar)).y).toBeGreaterThan(left.Filtrar.y + 100);
  await expect(saved(w)).toHaveText("Guardado");
  left = await placesByName(w);
  await expect
    .poll(() => {
      const db = new DatabaseSync(join(dir, "users", "1.db"), { readOnly: true });
      try {
        return db.prepare("SELECT x, y FROM automation_layout WHERE step = ?").get(filtrar);
      } finally {
        db.close();
      }
    })
    .toEqual(expect.objectContaining({ y: left.Filtrar.y }));

  // After a reload of the window, then with the app closed and opened again: the same canvas, each box where it
  // was left, each step with its last test.
  const same = async (p: Page) => {
    await openAutomations(p);
    await list(p).filter({ hasText: NAME }).getByText(NAME, { exact: true }).click();
    await expect(nameBox(p)).toHaveValue(NAME);
    await expect(cards(p)).toHaveCount(4);
    await expect.poll(() => placesByName(p)).toEqual(left);
    const id = async (name: string) =>
      (await cardNamed(p, name).getAttribute("data-step")) as string;
    await expect(countOn(p, await id("Buscar filas en Gasto"), filtrar)).toHaveText(rows(ROWS));
    await expect(countOn(p, filtrar, await id("Si"))).toHaveText(rows(FILTERED));
    await openStep(p, await id("Si"));
    await expect(salida(p)).toContainText(`sí (${WARNED})`);
    await p.keyboard.press("Escape");
    await expect(view(p)).toHaveCount(0);
  };
  await w.reload();
  await same(w);
  await (app as ElectronApplication).close();
  app = await launch();
  w = await app.firstWindow();
  await w.setViewportSize({ width: 1440, height: 900 });
  await same(w);
  // And in another window: the app on another computer of the account, its own profile and device. A place is the
  // automation's, not the device's (AU-05).
  const other = await launch("-sobremesa");
  try {
    const o = await other.firstWindow();
    // A section opened while the app connects stays: the start page does not take the window from it. The read of
    // the last page open, the one the start page waits for after the pages came, is held until «Automatizaciones»
    // is open (CI, 2026-11-16: a click that fell in it was put under the start page, at one run in about ten).
    await o.getByRole("button", { name: "Configurar servidor" }).waitFor();
    await other.evaluate(
      ({ ipcMain }, store) => {
        const g = globalThis as unknown as Held;
        const fs = process.getBuiltinModule("node:fs");
        const path = process.getBuiltinModule("node:path");
        const go = new Promise<void>((r) => {
          g.go = r;
        });
        ipcMain.removeHandler("store:read");
        ipcMain.handle("store:read", async (_e, name: string) => {
          if (name === "last-page.json" && !g.asked) {
            g.asked = true;
            await go;
            g.answered = true;
          }
          try {
            return fs.readFileSync(path.join(store, path.basename(name)), "utf8");
          } catch {
            return null;
          }
        });
      },
      join(dir, "data-sobremesa", "boni", "store"),
    );
    const held = () =>
      other.evaluate(() => {
        const g = globalThis as unknown as Held;
        return { asked: !!g.asked, answered: !!g.answered };
      });
    await login(o, "sobremesa-ejemplo");
    await expect.poll(async () => (await held()).asked).toBe(true);
    await openAutomations(o);
    await other.evaluate(() => (globalThis as unknown as Held).go?.());
    await expect.poll(async () => (await held()).answered).toBe(true);
    await o.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    await expect(o.getByRole("tab", { name: "Tabla" })).toBeVisible();
    await same(o);
  } finally {
    await other.close();
  }

  // «Duplicar» opens «<nombre> (copia)» with the same steps in the same places (AU-62).
  await head(w).getByRole("button", { name: "Más" }).click();
  await w.getByRole("menuitemradio", { name: "Duplicar" }).click();
  await expect(nameBox(w)).toHaveValue(`${NAME} (copia)`);
  await expect(cards(w)).toHaveCount(4);
  await expect.poll(() => placesByName(w)).toEqual(left);
  // «Eliminar» takes it off the list without asking, and its notice's «Deshacer» brings it back.
  await head(w).getByRole("button", { name: "Más" }).click();
  await w.getByRole("menuitemradio", { name: "Eliminar" }).click();
  const copy = list(w).filter({ hasText: `${NAME} (copia)` });
  await expect(copy).toHaveCount(0);
  await expect(list(w).filter({ hasText: NAME })).toHaveCount(1);
  await w.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(copy).toHaveCount(1);
  await copy.getByText(`${NAME} (copia)`, { exact: true }).click();
  await expect(cards(w)).toHaveCount(4);
  await expect.poll(() => placesByName(w)).toEqual(left);
});

test.fixme("AU-75 · in the desktop app over the real server no step of the catalogue, with any of its actions, shows more than seven rows of «Parámetros» before «Añadir opción»", async () => {});

test.fixme("AU-71 AU-20 · with a test of 3,000 rows, opening a step, asking for more rows and «Probar paso» answer within their time (A-15), and typing in an expression at a person's pace asks the server for nothing", async () => {});

test.fixme("AU-151 · over the real server a flow of before is still in the list, opens the editor of before, and runs as it did; «Nueva» makes an automation of the new format beside it", async () => {});
