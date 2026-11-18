import { execFileSync } from "node:child_process";
import { once } from "node:events";
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
import { label } from "../packages/entities/src/index.ts";
import { openUserStore } from "../packages/store/src/index.ts";
import { type Server, startServer } from "./server.ts";

/**
 * F14d's criterion the way it will be tried (docs/automatizaciones.md §8): the real desktop app over the real server,
 * a profile and a store of its own, with data shaped like the user's (seed.test-util.ts) and its volume. The server
 * starts as automations-code.spec.ts starts it, on the real clock: a scheduled hour is the next minute, and its
 * scheduler (one round a minute) runs it as it would at eight in the morning. Nothing here calls a model, and typing
 * goes at a person's pace. Pending: the phase's first PR brings them, and its builders make each real, the rule's id
 * kept in its name (`make check` reads them).
 */

test.describe("the criterion of F14d in the desktop app", () => {
  const ZONE = "Europe/Madrid";
  const ROWS = 40;
  const NAME = "Repaso de cada mañana";
  let dir = "";
  let server: Server | null = null;
  let app: ElectronApplication | null = null;

  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "boni-desktop-programada-"));
    const env = {
      ...process.env,
      BONI_DB: join(dir, "boni-calendar.db"),
      BONI_PASSWORD: PASSWORD,
      BONI_TZ: ZONE,
    };
    tasks(dir, env, ROWS);
    server = await startServer({ ...env, BONI_WRITE: "1", ANTHROPIC_API_KEY: "" });
    app = await launch(dir, server.url, PASSWORD);
  });

  test.afterAll(async () => {
    await app?.close();
    server?.process.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  test("AU-95 AU-114 AU-99 AU-18 · the criterion of F14d in the desktop app over the real server: a «Programada» that creates a row is published, its hour arrives, the row is in its collection, the run is in «Ejecuciones» saying what it did, and «Deshacer lo que hizo» takes the row away", async () => {
    test.setTimeout(300_000);
    const w = await (app as ElectronApplication).firstWindow();
    // Its hour: the next minute of the server's zone, or the one after when publishing could reach it first.
    const minute = 60_000;
    const now = Date.now();
    const due = (Math.floor(now / minute) + (minute - (now % minute) < 35_000 ? 2 : 1)) * minute;
    const at = new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(due);
    const steps = [
      {
        id: "s_01kx5cadadia0",
        name: "Cada mañana",
        type: "schedule",
        params: { rules: [{ key: "r_01kx5cadadia0", every: "day", at }] },
      },
      {
        id: "s_01kx5crear000",
        name: "Crear una fila en Tareas",
        type: "collection",
        params: {
          collection: "tarea",
          action: "create",
          fields: [{ field: "nota", value: "Repaso de la mañana" }],
          permission: "yes",
        },
      },
    ];
    await ask(w, "POST", "api/agent/automations", {
      automation: {
        format: FORMAT,
        id: "",
        version: 0,
        name: NAME,
        steps,
        arrows: [
          {
            from: { step: "s_01kx5cadadia0", output: "main" },
            to: { step: "s_01kx5crear000", input: "main" },
          },
        ],
        settings: {},
      },
    });
    await openAutomation(w, NAME, 2);
    // Its card says its hour as a person does (AU-114).
    await expect(
      w.locator('.auto-card[data-step="s_01kx5cadadia0"] .auto-card-summary'),
    ).toHaveText(`Cada día a las ${at}`);
    await publish(w);
    // The list says when it starts, from what was published (AU-61).
    await w
      .locator(".sidebar")
      .getByRole("button", { name: "Automatizaciones", exact: true })
      .click();
    await expect(w.locator(".db-table tbody tr").filter({ hasText: NAME })).toContainText(
      `Cada día a las ${at}`,
    );
    await openAutomation(w, NAME, 2);
    await head(w).getByRole("tab", { name: "Ejecuciones" }).click();
    // Its hour comes with the screen open: the run arrives by the desktop's events, no one asking.
    await expect(runItems(w)).toHaveCount(1, { timeout: due - Date.now() + 150_000 });
    await runItems(w).first().click();
    await expect(runBar(w)).toContainText("Completada", { timeout: 30_000 });
    await expect(runBar(w)).toContainText("Programada");
    await expect(runBar(w)).toContainText("Creó 1 fila en Tareas");
    // It saved alone: its line says so, «Deshacer lo que hizo» beside it (S4; decision 17: no window pops up).
    await expect(runBar(w).locator(".auto-run-notice")).toBeVisible();
    expect(await tareas(w)).toBe(ROWS + 1);
    await runBar(w).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(w)).toContainText("Deshecha", { timeout: 30_000 });
    expect(await tareas(w)).toBe(ROWS);
  });
});

test.fixme("AU-97 AU-17 · in the desktop app over the real server, «Ejecutar» on a published automation that modifies 3,000 rows stops at the default limit saying which; with the limit raised and published it saves them, the window answers meanwhile, and the run is undone from «Ejecuciones»", async () => {});

const ROOT = join(import.meta.dirname, "..");
const PASSWORD = "una contraseña larga de ejemplo";
/** The server's answer through the app's own door (its device's token), asked again while it is not configured. */
async function ask(w: Page, method: string, path: string, body?: unknown) {
  const through = () =>
    w.evaluate(
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
  let r = await through();
  for (let i = 0; i < 60 && r.notConfigured; i++) {
    await w.waitForTimeout(500);
    r = await through();
  }
  expect(r.status, `${method} ${path}: ${JSON.stringify(r).slice(0, 300)}`).toBe(200);
  return JSON.parse(r.body ?? "null");
}
const tareas = async (w: Page) =>
  ((await ask(w, "GET", "api/data/types")).types as { key?: string; count: number }[]).find(
    (t) => t.key === "tarea",
  )?.count;
const head = (w: Page) => w.locator(".auto-head");
const runItems = (w: Page) => w.locator(".auto-runs-item");
const runBar = (w: Page) => w.locator(".auto-run-bar");
const runCard = (w: Page, id: string) =>
  w.locator(`.auto-run-canvas .auto-card[data-step="${id}"]`);
const salida = (w: Page) => w.locator(".auto-view").getByRole("region", { name: "Salida" });
/** The desktop app over `url`, a profile of its own under `dir`, signed in as «ejemplo». */
async function launch(dir: string, url: string, password: string) {
  mkdirSync(join(dir, "tmp"));
  const app = await electron.launch({
    cwd: join(ROOT, "apps", "boni-desktop"),
    ...(process.env.BONI_DESKTOP_BIN ? { executablePath: process.env.BONI_DESKTOP_BIN } : {}),
    args: [
      ...(process.env.BONI_DESKTOP_BIN ? [] : ["."]),
      `--user-data-dir=${join(dir, "electron")}`,
    ],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_DATA_HOME: join(dir, "data"),
      TMPDIR: join(dir, "tmp"),
    },
  });
  const w = await app.firstWindow();
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.getByRole("button", { name: "Configurar servidor" }).click();
  await w.getByPlaceholder("https://boni.example.ts.net").fill(url);
  const form = w.locator(".server-form");
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator('input[type="password"]').fill(password);
  await form.locator("input").nth(3).fill("portatil-ejemplo");
  await w.getByRole("button", { name: "Entrar" }).click();
  await w.keyboard.press("Escape");
  return app;
}
/** A store with «Tareas» (seed.test-util.ts) and `n` rows in it, under `dir`, its account «ejemplo». */
function tasks(dir: string, env: NodeJS.ProcessEnv, n: number) {
  execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo"], { cwd: ROOT, env });
  mkdirSync(join(dir, "users"), { recursive: true });
  const store = openUserStore(join(dir, "users", "1.db"));
  seed(store, [{ key: "tarea", name: "Tareas", folder: "tareas/", fields: { Nota: "text" } }], {});
  const type = store.schema().types.t_tarea;
  if (!type) throw new Error("no t_tarea");
  const id = (name: string) => type.fields.find((f) => f.name === name)?.id as string;
  store.batch(() => {
    for (let i = 0; i < n; i++)
      store.create(
        "t_tarea",
        {
          [id("Título")]: { value: `Tarea ${i + 1}`, label: type.label as never },
          [id("Nota")]: { value: `Nota de ejemplo ${i % 40}`, label: type.label as never },
        },
        { actor: "import", device: "seed" },
      );
  });
  store.close();
}
/** Opens the automation named `name` from the list of the sidebar. */
async function openAutomation(w: Page, name: string, cards: number) {
  await w
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await w.locator(".db-table tbody tr").getByText(name, { exact: true }).click();
  await expect(w.locator(".auto-card")).toHaveCount(cards);
}
/** «Publicar» from its header, saying what stops it if something does: a disabled button alone says nothing. */
async function publish(w: Page) {
  await head(w).getByRole("button", { name: "Publicar", exact: true }).click();
  const modal = w.locator(".auto-modal");
  const button = modal.getByRole("button", { name: "Publicar versión 1" });
  await expect(button)
    .toBeEnabled({ timeout: 10_000 })
    .catch(async () => {
      throw new Error(`«Publicar» is stopped: ${await modal.innerText()}`);
    });
  await button.click();
  await expect(head(w).locator(".auto-published")).toContainText("versión 1");
}

/**
 * F14d P2's criterion (Juan sees a run, opens a step, undoes it) in the desktop app over the real server, at his
 * volume (A-15): a collection of 3,000 rows that the run reads whole, and then a year of hourly runs behind it. The
 * times it takes are printed for the PR and bounded here (`@boni/pace`).
 */
test.describe("«Ejecuciones» in the desktop app (F14d P2)", () => {
  const ROWS = 3000;
  const NAME = "Repasar las tareas";
  const HOURLY = 8_760;
  let dir = "";
  let env: NodeJS.ProcessEnv = {};
  let server: Server | null = null;
  let app: ElectronApplication | null = null;

  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "boni-desktop-runs-"));
    env = { ...process.env, BONI_DB: join(dir, "boni-calendar.db"), BONI_PASSWORD: PASSWORD };
    tasks(dir, env, ROWS);
    server = await startServer({ ...env, BONI_WRITE: "1", ANTHROPIC_API_KEY: "" });
    app = await launch(dir, server.url, PASSWORD);
  });

  test.afterAll(async () => {
    await app?.close();
    server?.process.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  /** How long `act` takes until `done` holds, in ms, read from `@boni/pace`'s clock. */
  async function timed(act: () => Promise<unknown>, done: () => Promise<unknown>) {
    const t = clock();
    await act();
    await done();
    return Math.round(clock() - t);
  }

  test("AU-97 AU-99 AU-101 AU-18 · in the desktop app over the real server, «Ejecutar» on a published automation is seen in «Ejecuciones» saying what it did; a step opened shows its 3,000 rows; «Deshacer lo que hizo» takes back the row it made; with a year of hourly runs behind it the list and that run open within the time written here", async () => {
    const w = await (app as ElectronApplication).firstWindow();
    const steps = [
      {
        id: "s_01kx4inicio00",
        name: "Disparado por el usuario",
        type: "manual",
        params: { fields: [] },
      },
      {
        id: "s_01kx4buscar00",
        name: "Buscar filas en Tareas",
        type: "collection",
        params: { collection: "tarea", action: "find", where: [], sort: [], limit: 5000 },
      },
      {
        id: "s_01kx4crear000",
        name: "Crear una fila en Tareas",
        type: "collection",
        params: {
          collection: "tarea",
          action: "create",
          fields: [{ field: "nota", value: "Repaso de ejemplo" }],
          permission: "yes",
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
        arrows: ["s_01kx4buscar00", "s_01kx4crear000"].map((to) => ({
          from: { step: "s_01kx4inicio00", output: "main" },
          to: { step: to, input: "main" },
        })),
        settings: {},
      },
    });
    const id = made.id as string;
    await openAutomation(w, NAME, 3);
    // Published from its screen, then run from «⋯»: with no fields it starts at once.
    await publish(w);
    await head(w).getByRole("button", { name: "Más" }).click();
    await w.getByRole("menuitemradio", { name: "Ejecutar", exact: true }).click();
    await expect(head(w).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runBar(w)).toContainText("Completada", { timeout: 60_000 });
    await expect(runBar(w)).toContainText("Creó 1 fila en Tareas");
    await expect(runItems(w)).toHaveCount(1);
    expect(await tareas(w)).toBe(ROWS + 1);
    // A step opened: what came out of it, asked then.
    const read = await timed(
      () => runCard(w, "s_01kx4buscar00").dblclick(),
      () => expect(salida(w)).toContainText("3000 filas", { timeout: 15_000 }),
    );
    await w.keyboard.press("Escape");
    // Undone: the row it made goes, and the run says so.
    await runBar(w).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(w)).toContainText("Deshecha", { timeout: 30_000 });
    expect(await tareas(w)).toBe(ROWS);

    // A year of hourly runs behind it, each with the steps this one kept and one row on each output (A-15).
    const [run] = (await ask(w, "GET", `api/agent/automations/${id}/runs`)).runs as {
      id: string;
      at: number;
    }[];
    if (!run) throw new Error("no run");
    const port = (server as Server).port;
    (server as Server).process.kill();
    await once((server as Server).process, "exit");
    const store = openUserStore(join(dir, "users", "1.db"));
    const kept = store.journal.automationRunSteps(run.id);
    const hour = 3_600_000;
    store.batch(() => {
      for (let i = 0; i < HOURLY; i++) {
        const rid = `r_01kx4ano${String(i).padStart(5, "0")}`;
        const at = run.at - (HOURLY - i) * hour;
        store.journal.createAutomationRun({
          id: rid,
          automation: id,
          version: 1,
          test: false,
          state: "running",
          trigger: "s_01kx4inicio00",
          fields: "{}",
          startedBy: "user",
          device: null,
          retryOf: null,
          at,
          started: at,
          doc: null,
        });
        for (const s of kept)
          store.journal.keepAutomationRunStep(rid, {
            step: s.step,
            n: s.n,
            record: s.record,
            rows: { main: ['{"json":{},"label":null}'] },
          });
        store.journal.endAutomationRun(rid, {
          state: i % 50 === 0 ? "failed" : "done",
          ended: at + 900,
          ms: 900,
          step: null,
          error: null,
          line: JSON.stringify({ writes: [], asked: [], outside: false }),
        });
      }
    });
    store.close();
    server = await startServer({ ...env, BONI_WRITE: "1", ANTHROPIC_API_KEY: "" }, port);
    await ask(w, "GET", `api/agent/automations/${id}/runs`);
    // The list: its first fifty, then fifty more; then the run of 3,000 rows and its step.
    await head(w).getByRole("tab", { name: "Editor" }).click();
    const list = await timed(
      () => head(w).getByRole("tab", { name: "Ejecuciones" }).click(),
      () => expect(runItems(w)).toHaveCount(50, { timeout: 15_000 }),
    );
    const more = await timed(
      () => w.getByRole("button", { name: "Ver más" }).click(),
      () => expect(runItems(w)).toHaveCount(100, { timeout: 15_000 }),
    );
    await runItems(w).nth(1).click();
    await expect(runBar(w)).toContainText("Completada");
    const open = await timed(
      () => runItems(w).nth(0).click(),
      () => expect(runBar(w)).toContainText("Deshecha", { timeout: 15_000 }),
    );
    await expect(runCard(w, "s_01kx4buscar00")).toBeVisible();
    const step = await timed(
      () => runCard(w, "s_01kx4buscar00").dblclick(),
      () => expect(salida(w)).toContainText("3000 filas", { timeout: 15_000 }),
    );
    console.log(
      `F14d P2 at volume (ms): step of 3,000 rows ${read}; with ${HOURLY} runs: list ${list}, «Ver más» ${more}, a run ${open}, its step ${step}`,
    );
    under(list, 1_500, "clock");
    under(more, 1_500, "clock");
    under(open, 1_500, "clock");
    under(step, 1_500, "clock");
    under(read, 1_500, "clock");
  });
});

/**
 * F14d P3's criterion (what a run tells and asks) in the desktop app over the real server: five published automations
 * over «Tareas», four of them at the same hour, the next minute of the real clock, and the fifth by hand. Some rows
 * came in a mail (their «Nota» is from outside); the rest are his. What each run saved, proposed or sent to the trash
 * is seen in «Ejecuciones» and in the Bandeja, accepted there, and undone from its run.
 */
test.describe("what a run tells and asks in the desktop app (F14d P3)", () => {
  const KEY = "clave-inventada-0128";
  test.describe.configure({ mode: "serial" });
  const ZONE = "Europe/Madrid";
  const OWN = 40;
  const OUTSIDE = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);
  /** The rows beside his own: which note, how many, and whether it came from outside. */
  const MORE = [
    { nota: "de un correo", n: 3, outside: true },
    { nota: "de otro correo", n: 3, outside: true },
    { nota: "para tirar", n: 5, outside: false },
    { nota: "para preguntar", n: 4, outside: false },
  ];
  const ROWS = OWN + MORE.reduce((n, m) => n + m.n, 0);
  let dir = "";
  let env: NodeJS.ProcessEnv = {};
  let server: Server | null = null;
  let app: ElectronApplication | null = null;
  let due = 0;
  let at = "";
  const ids: Record<string, string> = {};

  const SCHEDULE = (key: string) => ({
    id: `s_01kx6cada${key}`,
    name: "Cada día",
    type: "schedule",
    params: { rules: [{ key: `r_01kx6cada${key}`, every: "day", at }] },
  });
  const MANUAL = (key: string) => ({
    id: `s_01kx6mano${key}`,
    name: "Disparado por el usuario",
    type: "manual",
    params: { fields: [] },
  });
  const FIND = (key: string, field: string, value: string) => ({
    id: `s_01kx6buscar${key}`,
    name: "Buscar filas en Tareas",
    type: "collection",
    params: { collection: "tarea", action: "find", where: [{ field, op: "is", value }] },
  });
  const CREATE = (key: string, fields: unknown[], permission: "yes" | "ask") => ({
    id: `s_01kx6crear${key}`,
    name: "Crear una fila en Tareas",
    type: "collection",
    params: { collection: "tarea", action: "create", fields, permission },
  });
  const TRASH = (key: string, nota: string, permission: "yes" | "ask") => ({
    id: `s_01kx6tirar${key}`,
    name: "Eliminar filas en Tareas",
    type: "collection",
    params: {
      collection: "tarea",
      action: "trash",
      target: "matching",
      where: [{ field: "nota", op: "is", value: nota }],
      permission,
    },
  });
  const arrow = (from: { id: string }, to: { id: string }) => ({
    from: { step: from.id, output: "main" },
    to: { step: to.id, input: "main" },
  });
  /** Made and published through the server's door, as «Publicar» does: its first version, and on. */
  async function published(w: Page, name: string, steps: { id: string }[], arrows: unknown[]) {
    const made = await ask(w, "POST", "api/agent/automations", {
      automation: { format: FORMAT, id: "", version: 0, name, steps, arrows, settings: {} },
    });
    const id = made.id as string;
    const { rev } = await ask(w, "GET", `api/agent/automations/${id}/publish`);
    // A refusal is answered with 200 too: what stops it is said here.
    const done = await ask(w, "POST", `api/agent/automations/${id}/publish`, { rev });
    expect(done, `«${name}» published`).toMatchObject({ version: 1, enabled: true });
    ids[name] = id;
    return id;
  }
  /** «Ejecuciones» of the automation named `name`, its newest run open. */
  async function runsOf(w: Page, name: string, cards: number, runs: number) {
    await openAutomation(w, name, cards);
    await head(w).getByRole("tab", { name: "Ejecuciones" }).click();
    await expect(runItems(w)).toHaveCount(runs, { timeout: 30_000 });
    if (runs) await runItems(w).first().click();
  }
  /** The card of a run's proposal, opened from its run: the page's, not the same card in the Bandeja's panel. */
  const cardOf = (w: Page, name: string) =>
    w.locator(".run-proposal:not(.inbox-panel .run-proposal)").filter({ hasText: name });

  test.beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "boni-desktop-avisa-"));
    env = {
      ...process.env,
      BONI_DB: join(dir, "boni-calendar.db"),
      BONI_PASSWORD: PASSWORD,
      BONI_TZ: ZONE,
    };
    tasks(dir, env, OWN);
    // The rows of a mail, and his own to be sent to the trash.
    const store = openUserStore(join(dir, "users", "1.db"));
    const type = store.schema().types.t_tarea;
    if (!type) throw new Error("no t_tarea");
    const field = (name: string) => type.fields.find((f) => f.name === name)?.id as string;
    store.batch(() => {
      for (const m of MORE)
        for (let i = 0; i < m.n; i++)
          store.create(
            "t_tarea",
            {
              [field("Título")]: { value: `Tarea ${m.nota} ${i + 1}`, label: type.label as never },
              [field("Nota")]: {
                value: m.nota,
                label: (m.outside ? OUTSIDE : type.label) as never,
              },
            },
            { actor: "import", device: "seed" },
          );
    });
    store.close();
    // The agent on with an invented key, as on Juan's server: the inbox is the agent's (with it off, the server
    // lists no proposal). Nothing here calls a model.
    server = await startServer({ ...env, BONI_WRITE: "1", ANTHROPIC_API_KEY: KEY });
    app = await launch(dir, server.url, PASSWORD);
    const w = await app.firstWindow();
    // Their hour: the next minute of the server's zone, or the one after when publishing could reach it first.
    const minute = 60_000;
    const now = Date.now();
    due = (Math.floor(now / minute) + (minute - (now % minute) < 40_000 ? 2 : 1)) * minute;
    at = new Intl.DateTimeFormat("en-GB", {
      timeZone: ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(due);
    // «Preguntar» with a value from outside: what it copies waits in the Bandeja.
    {
      const t = SCHEDULE("a1"),
        f = FIND("a1", "nota", "de un correo");
      const c = CREATE(
        "a1",
        [
          { field: "title", value: "Copia del correo" },
          { field: "nota", value: { expr: "{{ $json.nota }}" } },
        ],
        "ask",
      );
      await published(w, "Copiar lo del correo", [t, f, c], [arrow(t, f), arrow(f, c)]);
    }
    // «Sí» with a value from outside, by hand and at its hour (AU-195): it saves alone.
    {
      const m = MANUAL("a2"),
        t = SCHEDULE("a2"),
        f = FIND("a2", "nota", "de otro correo");
      const c = CREATE(
        "a2",
        [
          { field: "title", value: { expr: "{{ $json.nota }}" } },
          { field: "nota", value: "Guardada del correo" },
        ],
        "yes",
      );
      await published(
        w,
        "Guardar lo del correo",
        [m, t, f, c],
        [arrow(m, f), arrow(t, f), arrow(f, c)],
      );
    }
    // «Eliminar filas» with «Sí» and with «Preguntar» (AU-186, AU-187).
    {
      const t = SCHEDULE("a3"),
        d = TRASH("a3", "para tirar", "yes");
      await published(w, "Tirar lo viejo", [t, d], [arrow(t, d)]);
    }
    {
      const t = SCHEDULE("a4"),
        d = TRASH("a4", "para preguntar", "ask");
      await published(w, "Tirar preguntando", [t, d], [arrow(t, d)]);
    }
    // By hand: it reads what the first one's proposal saved (AU-170).
    {
      const m = MANUAL("a5"),
        f = FIND("a5", "title", "Copia del correo");
      const c = CREATE(
        "a5",
        [
          { field: "title", value: "Releída" },
          { field: "nota", value: { expr: "{{ $json.nota }}" } },
        ],
        "yes",
      );
      await published(w, "Releer las copias", [m, f, c], [arrow(m, f), arrow(f, c)]);
    }
    expect(Date.now(), "published before their hour").toBeLessThan(due);
  });

  test.afterAll(async () => {
    await app?.close();
    server?.process.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  test("AU-167 AU-193 AU-170 · in the desktop app over the real server, a scheduled run with a value from outside and «Preguntar» writes nothing and leaves one proposal in the inbox; accepted, its rows are saved, read as from outside, and undone with the run", async () => {
    test.setTimeout(300_000);
    const w = await (app as ElectronApplication).firstWindow();
    await openAutomation(w, "Copiar lo del correo", 3);
    await head(w).getByRole("tab", { name: "Ejecuciones" }).click();
    // Its hour comes with the screen open: the run arrives by the desktop's events.
    await expect(runItems(w)).toHaveCount(1, { timeout: due - Date.now() + 150_000 });
    await runItems(w).first().click();
    await expect(runBar(w)).toContainText("Completada", { timeout: 30_000 });
    await expect(runBar(w)).toContainText("Programada");
    await expect(runBar(w)).toContainText("Propuso crear 3 filas en Tareas");
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveText(
      "Pendiente en la Bandeja · Ver en la Bandeja",
    );
    // Nothing saved yet (the other runs of that hour are done by now: the one with «Sí» made 3, the trash took 5).
    await expect.poll(() => tareas(w), { timeout: 30_000 }).toBe(ROWS + 3 - 5);
    const before = await tareas(w);
    // One proposal in the Bandeja, painted by code: its three rows, each value of the mail marked.
    await runBar(w).getByRole("button", { name: "Ver en la Bandeja" }).click();
    const card = cardOf(w, "Copiar lo del correo");
    await expect(card).toHaveCount(1);
    await expect(card.locator("h3")).toHaveText(
      "Copiar lo del correo quiere crear 3 filas en Tareas",
    );
    await expect(card.locator(".run-proposal-line")).toHaveText(
      "versión 1 · Programada · Pendiente en la Bandeja",
    );
    await expect(card.locator(".run-asked-row")).toHaveCount(3);
    await expect(card.locator(".run-asked-outside")).toHaveCount(3);
    await card.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    const toast = w.locator(".toast");
    await expect(toast).toContainText("Guardado lo que propuso Copiar lo del correo");
    await expect(toast.getByRole("button", { name: "Deshacer" })).toHaveCount(0);
    expect(await tareas(w)).toBe((before as number) + 3);
    // Its run says so.
    await toast.getByRole("button", { name: "Ver la ejecución" }).click();
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveText("Propuesta aceptada");
    // Read again by another run, what was accepted is still from outside (AU-170).
    await runsOf(w, "Releer las copias", 3, 0);
    await head(w).getByRole("button", { name: "Más" }).click();
    await w.getByRole("menuitemradio", { name: "Ejecutar", exact: true }).click();
    await expect(runBar(w)).toContainText("Completada", { timeout: 60_000 });
    await expect(runBar(w)).toContainText("Creó 3 filas en Tareas · con datos de fuera");
    expect(await tareas(w)).toBe((before as number) + 6);
    await runBar(w).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(w)).toContainText("Deshecha", { timeout: 30_000 });
    // What he accepted is undone with the run that asked it (AU-18).
    await runsOf(w, "Copiar lo del correo", 3, 1);
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveText("Propuesta aceptada");
    await runBar(w).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(w)).toContainText("Deshecha", { timeout: 30_000 });
    expect(await tareas(w)).toBe(before);
  });

  test("AU-195 AU-167 · in the desktop app over the real server, the same published version with «Sí» and a value from outside saves it without asking by «Ejecutar» and at its hour, its run's line says «con datos de fuera», and each run is undone from «Ejecuciones»", async () => {
    test.setTimeout(180_000);
    const w = await (app as ElectronApplication).firstWindow();
    await runsOf(w, "Guardar lo del correo", 4, 1);
    // Scheduled: saved alone, said in its line with «Deshacer», nothing in the Bandeja (decision 17).
    await expect(runBar(w)).toContainText("Completada", { timeout: 30_000 });
    await expect(runBar(w)).toContainText("Programada");
    await expect(runBar(w)).toContainText("Creó 3 filas en Tareas · con datos de fuera");
    await expect(runBar(w).locator(".auto-run-notice")).toBeVisible();
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveCount(0);
    const before = (await tareas(w)) as number;
    // By hand: the same version and the same rows get the same decision.
    await head(w).getByRole("button", { name: "Más" }).click();
    await w.getByRole("menuitemradio", { name: "Ejecutar", exact: true }).click();
    // Two starts: the dialog asks which, «Disparado por el usuario» first.
    const start = w.getByRole("dialog", { name: "Ejecutar" });
    await expect(start.getByRole("radio", { name: "Disparado por el usuario" })).toBeChecked();
    await start.getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(runItems(w)).toHaveCount(2, { timeout: 30_000 });
    await expect(runBar(w)).toContainText("Completada", { timeout: 60_000 });
    await expect(runBar(w)).not.toContainText("Programada");
    await expect(runBar(w)).toContainText("Creó 3 filas en Tareas · con datos de fuera");
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveCount(0);
    expect(await tareas(w)).toBe(before + 3);
    // Each one is undone from its line.
    await runBar(w).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(w)).toContainText("Deshecha", { timeout: 30_000 });
    await runItems(w).nth(1).click();
    await expect(runBar(w)).toContainText("Programada");
    await runBar(w).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(w)).toContainText("Deshecha", { timeout: 30_000 });
    expect(await tareas(w)).toBe(before - 3);
  });

  test("AU-186 AU-187 · in the desktop app over the real server, a published «Eliminar filas» with «Sí» sends its rows to the trash at its hour with no proposal, and undoing the run brings them back; with «Preguntar» the same run leaves a proposal", async () => {
    test.setTimeout(180_000);
    const w = await (app as ElectronApplication).firstWindow();
    await runsOf(w, "Tirar lo viejo", 2, 1);
    await expect(runBar(w)).toContainText("Completada", { timeout: 30_000 });
    await expect(runBar(w)).toContainText("Mandó a la papelera 5 filas de Tareas");
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveCount(0);
    const before = (await tareas(w)) as number;
    await runBar(w).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(w)).toContainText("Deshecha", { timeout: 30_000 });
    expect(await tareas(w)).toBe(before + 5);
    // With «Preguntar»: nothing went to the trash, and its removals wait in the Bandeja.
    await runsOf(w, "Tirar preguntando", 2, 1);
    await expect(runBar(w)).toContainText("Propuso mandar a la papelera 4 filas de Tareas");
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveText(
      "Pendiente en la Bandeja · Ver en la Bandeja",
    );
    await runBar(w).getByRole("button", { name: "Ver en la Bandeja" }).click();
    const card = cardOf(w, "Tirar preguntando");
    await expect(card.locator("h3")).toHaveText(
      "Tirar preguntando quiere mandar a la papelera 4 filas de Tareas",
    );
    await expect(card.locator(".run-asked-row")).toHaveCount(4);
    // Rejected, nothing goes, and its run says so.
    await card.getByRole("button", { name: "Rechazar", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    expect(await tareas(w)).toBe(before + 5);
    await runsOf(w, "Tirar preguntando", 2, 1);
    await expect(runBar(w).locator(".auto-run-proposal")).toHaveText("Propuesta rechazada");
  });

  test("AU-190 · in the desktop app over the real server, a server stopped in the middle of a run and started again shows that run as «Interrumpida» and does not run it again", async () => {
    test.setTimeout(180_000);
    const w = await (app as ElectronApplication).firstWindow();
    const id = ids["Releer las copias"] as string;
    // A run of it by hand, done: the record of its first step is the one a run in the middle of it had kept.
    const [done] = (await ask(w, "GET", `api/agent/automations/${id}/runs`)).runs as {
      id: string;
    }[];
    if (!done) throw new Error("no run");
    // The server stops while a run is in «Buscar filas en Tareas»: no step of «Código» lasts long enough to stop it
    // there by hand, so the store is left as a stop leaves it (runs.test.ts stops the box itself).
    const rows = (await tareas(w)) as number;
    const port = (server as Server).port;
    (server as Server).process.kill();
    await once((server as Server).process, "exit");
    const store = openUserStore(join(dir, "users", "1.db"));
    const first = store.journal.automationRunSteps(done.id)[0];
    if (!first) throw new Error("no step");
    const run = "r_01kx6amedias0";
    const started = Date.now();
    store.journal.createAutomationRun({
      id: run,
      automation: id,
      version: 1,
      test: false,
      state: "running",
      trigger: "s_01kx6manoa5",
      fields: "{}",
      startedBy: "user",
      device: null,
      retryOf: null,
      at: started,
      started,
      doc: null,
    });
    store.journal.keepAutomationRunStep(run, {
      step: first.step,
      n: first.n,
      record: first.record,
      rows: { main: ['{"json":{},"label":null}'] },
    });
    store.journal.setAutomationRunStep(run, "s_01kx6buscara5");
    store.close();
    server = await startServer({ ...env, BONI_WRITE: "1", ANTHROPIC_API_KEY: KEY }, port);
    await ask(w, "GET", `api/agent/automations/${id}/runs`);
    await runsOf(w, "Releer las copias", 3, 2);
    await expect(runBar(w)).toContainText("Interrumpida en «Buscar filas en Tareas»");
    await expect(runBar(w).getByRole("button", { name: "Reintentar" })).toBeVisible();
    // Not run again: no other run, nothing more saved.
    await w.waitForTimeout(3_000);
    await expect(runItems(w)).toHaveCount(2);
    expect(await tareas(w)).toBe(rows);
  });
});
