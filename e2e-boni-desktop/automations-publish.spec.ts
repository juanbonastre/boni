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
import { openUserStore } from "../packages/store/src/index.ts";
import { type Server, startServer } from "./server.ts";

/**
 * F14d's criterion the way it will be tried (docs/automatizaciones.md §8): the real desktop app over the real server,
 * a profile and a store of its own, with data shaped like the user's (seed.test-util.ts) and its volume. The server
 * starts as automations-code.spec.ts starts it, with a clock the test moves, so a scheduled hour arrives without
 * waiting for it. Nothing here calls a model, and typing goes at a person's pace. Pending: the phase's first PR
 * brings them, and its builders make each real, the rule's id kept in its name (`make check` reads them).
 */

test.fixme("AU-95 AU-114 AU-99 AU-18 · the criterion of F14d in the desktop app over the real server: a «Programada» that creates a row is published, its hour arrives, the row is in its collection, the run is in «Ejecuciones» saying what it did, and «Deshacer lo que hizo» takes the row away", async () => {});

test.fixme("AU-97 AU-17 · in the desktop app over the real server, «Ejecutar» on a published automation that modifies 3,000 rows stops at the default limit saying which; with the limit raised and published it saves them, the window answers meanwhile, and the run is undone from «Ejecuciones»", async () => {});

test.fixme("AU-167 AU-193 AU-170 · in the desktop app over the real server, a scheduled run with a value from outside and «Preguntar» writes nothing and leaves one proposal in the inbox; accepted, its rows are saved, read as from outside, and undone with the run", async () => {});

test.fixme("AU-195 AU-167 · in the desktop app over the real server, the same published version with «Sí» and a value from outside saves it without asking by «Ejecutar» and at its hour, its run's line says «con datos de fuera», and each run is undone from «Ejecuciones»", async () => {});
test.fixme("AU-186 AU-187 · in the desktop app over the real server, a published «Eliminar filas» with «Sí» sends its rows to the trash at its hour with no proposal, and undoing the run brings them back; with «Preguntar» the same run leaves a proposal", async () => {});

test.fixme("AU-190 · in the desktop app over the real server, a server stopped in the middle of a run and started again shows that run as «Interrumpida» and does not run it again", async () => {});

/**
 * F14d P2's criterion (Juan sees a run, opens a step, undoes it) in the desktop app over the real server, at his
 * volume (A-15): a collection of 3,000 rows that the run reads whole, and then a year of hourly runs behind it. The
 * times it takes are printed for the PR and bounded here (`@boni/pace`).
 */
test.describe("«Ejecuciones» in the desktop app (F14d P2)", () => {
  const ROOT = join(import.meta.dirname, "..");
  const PASSWORD = "una contraseña larga de ejemplo";
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
    execFileSync("node", ["apps/server/src/cli.ts", "add-user", "ejemplo"], { cwd: ROOT, env });
    mkdirSync(join(dir, "users"), { recursive: true });
    const store = openUserStore(join(dir, "users", "1.db"));
    seed(
      store,
      [{ key: "tarea", name: "Tareas", folder: "tareas/", fields: { Nota: "text" } }],
      {},
    );
    const type = store.schema().types.t_tarea;
    if (!type) throw new Error("no t_tarea");
    const id = (name: string) => type.fields.find((f) => f.name === name)?.id as string;
    store.batch(() => {
      for (let i = 0; i < ROWS; i++)
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
    server = await startServer({ ...env, BONI_WRITE: "1", ANTHROPIC_API_KEY: "" });
    mkdirSync(join(dir, "tmp"));
    app = await electron.launch({
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
    await w.getByPlaceholder("https://boni.example.ts.net").fill(server.url);
    const form = w.locator(".server-form");
    await form.locator("input").nth(1).fill("ejemplo");
    await form.locator('input[type="password"]').fill(PASSWORD);
    await form.locator("input").nth(3).fill("portatil-ejemplo");
    await w.getByRole("button", { name: "Entrar" }).click();
    await w.keyboard.press("Escape");
  });

  test.afterAll(async () => {
    await app?.close();
    server?.process.kill();
    rmSync(dir, { recursive: true, force: true });
  });

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
    await w
      .locator(".sidebar")
      .getByRole("button", { name: "Automatizaciones", exact: true })
      .click();
    await w.locator(".db-table tbody tr").getByText(NAME, { exact: true }).click();
    await expect(w.locator(".auto-card")).toHaveCount(3);
    // Published from its screen, then run from «⋯»: with no fields it starts at once.
    await head(w).getByRole("button", { name: "Publicar", exact: true }).click();
    const modal = w.locator(".auto-modal");
    const publish = modal.getByRole("button", { name: "Publicar versión 1" });
    // What stops it, said, if something does: a disabled button alone says nothing.
    await expect(publish)
      .toBeEnabled({ timeout: 10_000 })
      .catch(async () => {
        throw new Error(`«Publicar» is stopped: ${await modal.innerText()}`);
      });
    await publish.click();
    await expect(head(w).locator(".auto-published")).toContainText("versión 1");
    await head(w).getByRole("button", { name: "Más" }).click();
    await w.getByRole("menuitemradio", { name: "Ejecutar", exact: true }).click();
    await expect(head(w).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runBar(w)).toContainText("Bien", { timeout: 60_000 });
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
    await expect(runBar(w)).toContainText("Bien");
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
