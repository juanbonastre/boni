import { expect, type Page, test } from "@playwright/test";
import { FLOW_CATALOG, FLOW_CHECK, FLOW_DETAIL, FLOWS, MAP, MODELS } from "./agent-scenarios.ts";
import { ALL_DONE, books, TESTED, testOf } from "./automation-data.ts";
import { openApp } from "./fixtures.ts";

/**
 * Publishing in «Automatizaciones» on the screen, F14d (docs/automatizaciones.md §5.8, §5.9, §5.10, §6): the header
 * with its switch and «Publicar», «Ejecutar», the tab «Ejecuciones», «Versiones», «Fijar», the automation's settings
 * with its limits, «Programada», the «Permiso» of «Eliminar filas» and the proposal of a run in the inbox. Pending:
 * the first PR of the phase brings one test per rule, and the builders of its screens turn each into a real one,
 * keeping the rule's id in its name (`make check` reads them). A file of its own: automations.spec.ts is F14b's and
 * automations-code.spec.ts is F14c's.
 *
 * How they are written when they run: as automations.spec.ts, over the mocked server of fixtures.ts, with collections
 * whose keys and names are shaped like the user's and, where a rule is about many, with many (a year of runs, a run of
 * 3,000 rows). Every word read on the screen comes from `i18n.ts`; what a row, a step's name or a failure carries is
 * read as plain text. The same over the real server is e2e-boni-desktop/automations-publish.spec.ts.
 */

/** What the flows of before need to be listed and opened (agent-scenarios.ts). */
const BEFORE = () => ({
  "GET api/agent/models": [MODELS],
  "GET api/agent/map": [MAP],
  "GET api/agent/flows": [FLOWS],
  "GET api/agent/flows/:id": [{ ...FLOW_DETAIL, enabled: true }],
  "GET api/agent/flows/catalog": [FLOW_CATALOG],
  "POST api/agent/flows/check": [FLOW_CHECK],
  "PUT api/agent/flows/:id/enabled": [{ ...FLOW_DETAIL, enabled: false }],
});
const FIVE_MIN = 5 * 60_000;
/** «Revisar pendientes» published once and on: its draft is the version that runs. */
const PUBLISHED = { ...TESTED, published: { versions: 1 } };
/** «Libros nuevos», never published, beside it in the list. */
const NEVER = { ...TESTED, id: "a_01jx8x0t2v4x6z8b0d2f4h6k9q", name: "Libros nuevos" };
/** «Lo que podrá hacer» as the server says it (abilities of `@boni/automations`), for the screen to word. */
const CAN = [
  { collection: "libros", action: "read", steps: ["s_01jbuscar"] },
  { collection: "libros", action: "update", how: "asks", steps: ["s_01jmodificar"] },
  { collection: "libros", action: "remove", how: "asks", steps: ["s_01jeliminar"] },
  { collection: "libros", action: "create", how: "saves", steps: ["s_01jcrear"] },
];

const head = (page: Page) => page.locator(".auto-head");
const published = (page: Page) => head(page).locator(".auto-published");
const publishButton = (page: Page) =>
  head(page).getByRole("button", { name: "Publicar", exact: true });
const toggle = (page: Page) => head(page).locator('input[data-boni-action="automations.enable"]');
/** «Publicar», «Ajustes» or «Ejecutar» (AutomationPublish.tsx): the step's view is a dialog too. */
const screen = (page: Page) => page.locator(".auto-modal");
const part = (page: Page, name: string | RegExp) => screen(page).getByRole("region", { name });
const toast = (page: Page) => page.locator(".toast");
const card = (page: Page, id: string) => page.locator(`.auto-card[data-step="${id}"]`);
const view = (page: Page) => page.locator(".auto-view");
const param = (page: Page, key: string) => view(page).locator(`.auto-param[data-param="${key}"]`);
const salida = (page: Page) => view(page).getByRole("region", { name: "Salida" });
const nameBox = (page: Page) => page.getByRole("textbox", { name: "Nombre de la automatización" });
/** The bodies the app sent to `start` («METHOD path »), in order. */
const sent = (page: Page, start: string) =>
  page.evaluate(
    (st) =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? [])
        .filter((b) => b.startsWith(st))
        .map((b) => JSON.parse(b.slice(st.length)) as Record<string, unknown>),
    start,
  );
const lastDraft = async (page: Page, id: string) =>
  (await sent(page, `PUT api/agent/automations/${id}/draft `)).at(-1)?.automation as
    | {
        settings?: { limits?: Record<string, number> };
        steps: { id: string; params: Record<string, unknown> }[];
      }
    | undefined;
async function openList(page: Page) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
}
/** The list of «Automatizaciones», opened from the sidebar, and `name` opened from it. */
async function openCanvas(page: Page, name: string) {
  await openList(page);
  await page.locator(".db-table tbody tr").getByText(name, { exact: true }).click();
  await expect(nameBox(page)).toHaveValue(name);
  await expect(page.locator(".auto-card")).toHaveCount(TESTED.steps.length);
}
async function more(page: Page, item: string) {
  await head(page).getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitemradio", { name: item, exact: true }).click();
}
const menuItems = async (page: Page) => {
  await head(page).getByRole("button", { name: "Más" }).click();
  const items = await page.locator(".pop-box .menu-item").allTextContents();
  await page.keyboard.press("Escape");
  return items;
};
async function openStep(page: Page, id: string) {
  await card(page, id).dblclick();
  await expect(view(page)).toHaveAttribute("data-step", id);
}
const listState = (page: Page, name: string) =>
  page.locator(".db-table tbody tr", { hasText: name });

/** A step's record in a run, as S2 keeps it (`RunStep`): its counts, never its rows. */
const rec = (over: Record<string, unknown> = {}) => ({
  state: "done",
  in: { main: 1 },
  out: { main: 1 },
  ms: 40,
  retries: 0,
  failed: 0,
  asked: 0,
  ...over,
});
/** Every step of «Revisar pendientes» in a run: 128 books read, 3 and 125 proposed, the summary created. */
const RUN_STEPS = {
  s_inicio: rec({ in: {}, out: { main: 1 }, ms: 5 }),
  s_01jbuscar: rec({ out: { main: 128 }, reads: [{ collection: "libros", rows: 128 }], ms: 180 }),
  s_01jsi: rec({ in: { main: 128 }, out: { yes: 3, no: 125 } }),
  s_01jmodificar: rec({
    in: { main: 3 },
    out: { main: 3 },
    writes: { saved: 0, asked: 3, would: 0 },
  }),
  s_01jeliminar: rec({
    in: { main: 125 },
    out: { main: 125 },
    writes: { saved: 0, asked: 125, would: 0 },
  }),
  s_01jcombinar: rec({ in: { a: 3, b: 125 }, out: { main: 1 } }),
  s_01jcrear: rec({ writes: { saved: 1, asked: 0, would: 0 } }),
};
const LIMIT = { code: "run.limit", detail: { limit: "rowsWritten", max: 1000, got: 1001 } };
const H = 3_600_000;
const made = (collection: string, action: string, n: number) => ({
  collection,
  name: "Libros",
  action,
  n,
});
/**
 * «Revisar pendientes» published twice, with five runs: one that wrote and proposed with data from outside, a test,
 * one of version 1 stopped at a limit, one interrupted whose row changed since, and one of which only the summary is
 * left (AU-103).
 */
const WITH_RUNS = {
  ...PUBLISHED,
  published: { versions: 2 },
  runs: [
    {
      id: "r_01jbien",
      at: Date.now() - 2 * H,
      version: 2,
      trigger: "s_inicio",
      fields: { minimo: 300 },
      steps: RUN_STEPS,
      rows: { s_01jbuscar: { "in:main": [{ json: { minimo: 300 } }], "out:main": books(128) } },
      line: {
        writes: [made("libros", "create", 1)],
        asked: [made("libros", "update", 3), made("libros", "trash", 125)],
        outside: true,
      },
    },
    { id: "r_01jprueba", at: Date.now() - 3 * H, test: true, steps: RUN_STEPS },
    {
      id: "r_01jfallo",
      at: Date.now() - 26 * H,
      version: 1,
      startedBy: "schedule",
      state: "failed",
      step: "s_01jmodificar",
      error: { step: "s_01jmodificar", failure: LIMIT },
      steps: {
        ...RUN_STEPS,
        s_01jmodificar: rec({
          state: "failed",
          in: { main: 3 },
          out: {},
          error: { failure: LIMIT },
        }),
      },
    },
    {
      id: "r_01jcortada",
      at: Date.now() - 50 * H,
      state: "interrupted",
      step: "s_01jsi",
      steps: {
        s_inicio: RUN_STEPS.s_inicio,
        s_01jbuscar: RUN_STEPS.s_01jbuscar,
        s_01jsi: rec({ state: "running", in: { main: 128 }, out: {} }),
      },
      line: { writes: [made("libros", "update", 2)], asked: [], outside: false },
      changed: "Libro 2",
    },
    {
      id: "r_01jresumen",
      at: Date.now() - 30 * 24 * H,
      steps: null,
      line: { writes: [made("libros", "create", 1)], asked: [], outside: false },
    },
  ],
};
const runItems = (page: Page) => page.locator(".auto-runs-item");
const runBar = (page: Page) => page.locator(".auto-run-bar");
const runCanvas = (page: Page) => page.locator(".auto-run-canvas");
const runCard = (page: Page, id: string) =>
  runCanvas(page).locator(`.auto-card[data-step="${id}"]`);
/** What the fake server kept under `window[key]`, in order. */
const recorded = (page: Page, key: string) =>
  page.evaluate((k) => ((window as unknown as Record<string, string[]>)[k] ?? []).slice(), key);
/** «Revisar pendientes» with its runs, its tab «Ejecuciones» open. */
async function openRuns(page: Page, more: { manyRuns?: number; sharedDevice?: boolean } = {}) {
  await openApp(page, "/?still", {
    automations: [{ ...WITH_RUNS, ...(more.manyRuns ? { manyRuns: more.manyRuns } : {}) }],
    agent: BEFORE(),
    ...(more.sharedDevice ? { sharedDevice: true } : {}),
  });
  await openCanvas(page, PUBLISHED.name);
  await head(page).getByRole("tab", { name: "Ejecuciones" }).click();
  await expect(runItems(page).first()).toBeVisible();
}

test.describe("the header and «Publicar»", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test("AU-95 · the header of an automation never published has «Publicar» and says «Sin publicar»; published, «Guardado» says «publicada la versión 1», and after a change of the draft «cambios sin publicar»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [PUBLISHED, NEVER], agent: BEFORE() });
    await openCanvas(page, NEVER.name);
    await expect(published(page)).toHaveText("· sin publicar");
    await expect(publishButton(page)).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    await openCanvas(page, PUBLISHED.name);
    await expect(published(page)).toHaveText("· publicada la versión 1");
    await expect(toggle(page)).toBeChecked();
    // A change of the draft: what runs is no longer what is seen.
    await nameBox(page).fill("Revisar pendientes cada semana");
    await nameBox(page).press("Enter");
    await expect(published(page)).toHaveText("· cambios sin publicar");
    // Back as it was, it is the version again.
    await nameBox(page).fill(PUBLISHED.name);
    await nameBox(page).press("Enter");
    await expect(published(page)).toHaveText("· publicada la versión 1");
  });
  test("AU-96 · «Publicar» opens the screen with its three things: what changes against the version that runs, what is missing or worth a look with a link to each step, and «Lo que podrá hacer»; the first time it says that publishing turns it on", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [
        {
          ...NEVER,
          publish: {
            looks: [
              { code: "output.unconnected", step: "s_01jcrear", detail: { output: "main" } },
              { code: "step.untested", step: "s_01jcombinar" },
            ],
            abilities: CAN,
          },
        },
      ],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    await publishButton(page).click();
    await expect(screen(page)).toHaveAccessibleName("Publicar «Libros nuevos»");
    await expect(screen(page)).toContainText("Será la versión 1 y quedará encendida.");
    // Never published: nothing to compare with.
    await expect(part(page, /^Qué cambia/)).toHaveCount(0);
    const checks = part(page, "Antes de publicar").locator("li");
    await expect(checks).toHaveText([
      "Crear una fila en Libros · salida «main» sin conectar",
      "Combinar · sin probar",
    ]);
    await expect(part(page, "Lo que podrá hacer").locator("li")).toHaveText([
      "Lee Libros",
      "Modifica filas en Libros · pregunta",
      "Elimina filas en Libros · pregunta",
      "Crea filas en Libros · las guarda",
    ]);
    // Published by the draft it showed: its notice runs it, the header says the version and the switch is on.
    await screen(page).getByRole("button", { name: "Publicar versión 1" }).click();
    await expect(screen(page)).toHaveCount(0);
    expect(await sent(page, `POST api/agent/automations/${NEVER.id}/publish `)).toEqual([
      { rev: 1 },
    ]);
    await expect(toast(page)).toContainText("Publicada la versión 1");
    await expect(toast(page).getByRole("button", { name: "Ejecutar" })).toBeVisible();
    await expect(published(page)).toHaveText("· publicada la versión 1");
    await expect(toggle(page)).toBeChecked();
    // Changed: what runs is no longer what is seen.
    await nameBox(page).fill("Libros nuevos del mes");
    await nameBox(page).press("Enter");
    await expect(published(page)).toHaveText("· cambios sin publicar");
  });
  test("AU-96 · with a version running, the screen says what changes against it, each changed step a link", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [
        {
          ...PUBLISHED,
          publish: {
            same: false,
            diff: {
              name: { from: "Revisar pendientes", to: "Revisar pendientes" },
              added: [],
              removed: [],
              changed: [
                { step: "s_01jmodificar", params: ["fields"], connections: [], settings: [] },
              ],
              arrows: { added: [], removed: [] },
              triggers: [],
              limits: [{ limit: "ms", from: 60_000, to: 120_000 }],
            },
          },
        },
      ],
      agent: BEFORE(),
    });
    await openCanvas(page, PUBLISHED.name);
    await publishButton(page).click();
    await expect(screen(page)).toContainText("Será la versión 2.");
    await expect(part(page, "Qué cambia respecto a la versión 1").locator("li")).toHaveText([
      "Nombre: «Revisar pendientes» → «Revisar pendientes»",
      "Cambia «Modificar filas en Libros»: parámetros",
      "Tiempo: 60 s → 120 s",
    ]);
    await part(page, "Qué cambia respecto a la versión 1")
      .getByRole("button", { name: "Cambia «Modificar filas en Libros»: parámetros" })
      .click();
    await expect(screen(page)).toHaveCount(0);
    await expect(view(page)).toHaveAttribute("data-step", "s_01jmodificar");
  });
  test("AU-96 AU-83 · opening «Publicar» marks every empty required parameter of the steps a trigger reaches, on the parameter and on its card, and with one of them «Publicar» cannot be pressed", async ({
    page,
  }) => {
    const EMPTY = {
      ...NEVER,
      steps: NEVER.steps.map((s) =>
        s.id === "s_01jcrear" ? { ...s, params: { action: "create", permission: "yes" } } : s,
      ),
      publish: {
        blocks: [
          { code: "param.required", severity: "error", step: "s_01jcrear", param: "collection" },
        ],
      },
    };
    await openApp(page, "/?still", { automations: [EMPTY], agent: BEFORE() });
    await openCanvas(page, NEVER.name);
    await expect(card(page, "s_01jcrear").locator(".auto-card-mark")).toHaveCount(0);
    await publishButton(page).click();
    const bad = part(page, "Antes de publicar").locator("li.bad");
    await expect(bad).toHaveCount(1);
    await expect(bad).toContainText("Crear una fila en Libros");
    await expect(screen(page).getByRole("button", { name: "Publicar versión 1" })).toBeDisabled();
    await expect(card(page, "s_01jcrear").locator(".auto-card-mark")).toHaveAttribute(
      "title",
      /Falta: Colección/,
    );
    // Its link opens the step with the parameter marked.
    await bad.getByRole("button", { name: "Crear una fila en Libros" }).click();
    await expect(screen(page)).toHaveCount(0);
    await expect(param(page, "collection")).toHaveClass(/\bmarked\b/);
    expect(await sent(page, `POST api/agent/automations/${NEVER.id}/publish `)).toEqual([]);
  });
  test("AU-96 · a link of «lo que falta» closes the screen and opens that step; with the same document as the one that runs the button says there is nothing to publish", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [
        {
          ...PUBLISHED,
          publish: { looks: [{ code: "step.untested", step: "s_01jcombinar" }] },
        },
      ],
      agent: BEFORE(),
    });
    await openCanvas(page, PUBLISHED.name);
    await publishButton(page).click();
    await expect(part(page, "Qué cambia respecto a la versión 1")).toContainText(
      "Nada que publicar",
    );
    await expect(screen(page).getByRole("button", { name: "Nada que publicar" })).toBeDisabled();
    await part(page, "Antes de publicar").getByRole("button", { name: "Combinar" }).click();
    await expect(screen(page)).toHaveCount(0);
    await expect(view(page)).toHaveAttribute("data-step", "s_01jcombinar");
  });
  test("AU-182 · «Lo que podrá hacer» names each collection a «Código» can change, with its action, and a removal with «Sí» reads «sin preguntar»", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [
        {
          ...NEVER,
          publish: {
            abilities: [
              { collection: "libros", action: "update", how: "saves", steps: ["s_01jcodigo"] },
              { collection: "libros", action: "remove", how: "noAsk", steps: ["s_01jcodigo"] },
              { collection: "t_01jgastos", action: "create", how: "asks", steps: ["s_01jcodigo"] },
            ],
          },
        },
      ],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    await publishButton(page).click();
    // A collection the app does not know is said by its key, as plain text.
    await expect(part(page, "Lo que podrá hacer").locator("li")).toHaveText([
      "Modifica filas en Libros · las guarda",
      "Elimina filas en Libros · sin preguntar",
      "Crea filas en t_01jgastos · pregunta",
    ]);
  });
  test("AU-182 · «Lo que podrá hacer» is one line per collection and action, and a write with «Sí» that can receive something from outside ends in «con datos de fuera»", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [
        {
          ...NEVER,
          publish: {
            abilities: [
              { collection: "libros", action: "read", steps: ["s_01jbuscar"] },
              {
                collection: "libros",
                action: "create",
                how: "saves",
                outside: true,
                steps: ["s_01jcrear"],
              },
              {
                collection: "libros",
                action: "remove",
                how: "noAsk",
                outside: true,
                steps: ["s_01jeliminar"],
              },
              { collection: "libros", action: "update", how: "asks", steps: ["s_01jmodificar"] },
            ],
            outside: ["libros"],
          },
        },
      ],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    await publishButton(page).click();
    await expect(part(page, "Lo que podrá hacer").locator("li")).toHaveText([
      "Lee Libros",
      "Crea filas en Libros · las guarda · con datos de fuera",
      "Elimina filas en Libros · sin preguntar · con datos de fuera",
      "Modifica filas en Libros · pregunta",
    ]);
  });
  test("AU-194 · the switch of the header turns the automation on and off, the list's «Estado» says «Encendida», «Apagada» or «Sin publicar», and the first publish leaves it on", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [PUBLISHED, NEVER], agent: BEFORE() });
    await openList(page);
    await expect(listState(page, PUBLISHED.name)).toContainText("Encendida");
    await expect(listState(page, NEVER.name)).toContainText("Sin publicar");
    await page.locator(".db-table tbody tr").getByText(PUBLISHED.name, { exact: true }).click();
    await expect(toggle(page)).toBeChecked();
    await expect(head(page).locator(".auto-switch")).toContainText("Encendida");
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    await expect(head(page).locator(".auto-switch")).toContainText("Apagada");
    expect(await sent(page, `PUT api/agent/automations/${PUBLISHED.id}/enabled `)).toEqual([
      { enabled: false },
    ]);
    await openList(page);
    await expect(listState(page, PUBLISHED.name)).toContainText("Apagada");
    // The first publish of the other turns it on.
    await page.locator(".db-table tbody tr").getByText(NEVER.name, { exact: true }).click();
    await publishButton(page).click();
    await screen(page).getByRole("button", { name: "Publicar versión 1" }).click();
    await expect(toggle(page)).toBeChecked();
    await openList(page);
    await expect(listState(page, NEVER.name)).toContainText("Encendida");
  });
  test("AU-96 · a draft changed on another device while «Publicar» was open is not published: it says so and the screen is asked again, and then it publishes", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [NEVER], agent: BEFORE() });
    await openCanvas(page, NEVER.name);
    await publishButton(page).click();
    await page.evaluate((id) => {
      (window as unknown as { __autoStale: string }).__autoStale = id;
    }, NEVER.id);
    await screen(page).getByRole("button", { name: "Publicar versión 1" }).click();
    await expect(toast(page)).toContainText("El borrador cambió en otro dispositivo");
    await expect(screen(page)).toHaveAccessibleName("Publicar «Libros nuevos»");
    await screen(page).getByRole("button", { name: "Publicar versión 1" }).click();
    await expect(toast(page)).toContainText("Publicada la versión 1");
    expect(await sent(page, `POST api/agent/automations/${NEVER.id}/publish `)).toEqual([
      { rev: 1 },
      { rev: 2 },
    ]);
  });
  test("AU-96 AU-83 · what the server finds when it publishes stops it: it says so, the screen is asked again with it marked, and «Publicar» cannot be pressed", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [NEVER], agent: BEFORE() });
    await openCanvas(page, NEVER.name);
    await publishButton(page).click();
    await page.evaluate(() => {
      (window as unknown as { __autoBlocks: unknown[] }).__autoBlocks = [
        { code: "param.required", severity: "error", step: "s_01jcrear", param: "collection" },
      ];
    });
    await screen(page).getByRole("button", { name: "Publicar versión 1" }).click();
    await expect(toast(page)).toContainText("Falta algo antes de publicar");
    await expect(part(page, "Antes de publicar").locator("li.bad")).toContainText(
      "Crear una fila en Libros",
    );
    await expect(screen(page).getByRole("button", { name: "Publicar versión 1" })).toBeDisabled();
    await expect(published(page)).not.toContainText("publicada");
  });
  test("AU-194 · a second publish with the switch off publishes the new version and leaves it off", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [{ ...PUBLISHED, published: { versions: 1, enabled: false } }],
      agent: BEFORE(),
    });
    await openCanvas(page, PUBLISHED.name);
    await expect(toggle(page)).not.toBeChecked();
    await nameBox(page).fill("Revisar pendientes del mes");
    await nameBox(page).press("Enter");
    await expect(published(page)).toHaveText("· cambios sin publicar");
    await publishButton(page).click();
    await expect(screen(page)).toContainText("Será la versión 2.");
    await screen(page).getByRole("button", { name: "Publicar versión 2" }).click();
    await expect(toast(page)).toContainText("Publicada la versión 2");
    await expect(published(page)).toHaveText("· publicada la versión 2");
    await expect(toggle(page)).not.toBeChecked();
    await expect(head(page).locator(".auto-switch")).toContainText("Apagada");
  });
  test("AU-188 · from a shared device the editor lets him look and test, and «Publicar», «Ejecutar» and the switch say to do it from his own device", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [{ ...testOf(ALL_DONE, { kept: FIVE_MIN }), published: { versions: 1 } }, NEVER],
      agent: BEFORE(),
      sharedDevice: true,
    });
    await openCanvas(page, PUBLISHED.name);
    // «Probar» goes.
    await page.locator(".auto-test-bar").getByRole("button", { name: "Probar" }).click();
    await page.locator(".auto-trial-box").getByRole("button", { name: "Probar" }).click();
    await expect(page.locator(".auto-log-line")).toContainText("bien");
    // «Ejecutar» is refused as «Publicar» is: its box stays, nothing runs.
    await more(page, "Ejecutar");
    await screen(page).getByLabel("Mínimo").pressSequentially("250", { delay: 60 });
    await screen(page).getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(toast(page)).toContainText("Solo desde un dispositivo personal.");
    await screen(page).locator(".modal-actions").getByRole("button", { name: "Cancelar" }).click();
    await toggle(page).click();
    await expect(toast(page)).toContainText("Solo desde un dispositivo personal.");
    await expect(toggle(page)).toBeChecked();
    await openCanvas(page, NEVER.name);
    await publishButton(page).click();
    await screen(page).getByRole("button", { name: "Publicar versión 1" }).click();
    await expect(toast(page)).toContainText("Solo desde un dispositivo personal.");
    await expect(published(page)).toHaveText("· sin publicar");
  });
});

test.describe("the header on a phone", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("AU-95 AU-74 AU-97 · on the phone the header has neither «Publicar» nor the switch: it is looked at, tested and, published, run there", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page, "/?still", { automations: [PUBLISHED], agent: BEFORE() });
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page.getByText(PUBLISHED.name, { exact: true }).first().tap();
    await expect(head(page).locator(".auto-name")).toHaveText(PUBLISHED.name);
    await expect(publishButton(page)).toHaveCount(0);
    await expect(toggle(page)).toHaveCount(0);
    await expect(head(page).getByRole("button", { name: "Más" })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // «Ejecutar», with its trigger's «Mínimo» asked in the box of «Probar».
    await head(page).getByRole("button", { name: "Ejecutar" }).tap();
    await screen(page).getByLabel("Mínimo").pressSequentially("250", { delay: 60 });
    await screen(page).getByRole("button", { name: "Ejecutar", exact: true }).tap();
    // The run opens over the list, with the way back to it.
    await expect(head(page).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runBar(page).getByRole("button", { name: "Todas las ejecuciones" })).toBeVisible();
    expect(await sent(page, `POST api/agent/automations/${PUBLISHED.id}/run `)).toHaveLength(1);
  });
});

test.describe("«Ejecutar»", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test("AU-97 · «Ejecutar» is in the automation's row of the list, for a published one: it opens the automation and asks its fields first", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [PUBLISHED, NEVER], agent: BEFORE() });
    await openList(page);
    await expect(
      listState(page, NEVER.name).getByRole("button", { name: `Ejecutar: ${NEVER.name}` }),
    ).toHaveCount(0);
    await listState(page, PUBLISHED.name)
      .getByRole("button", { name: `Ejecutar: ${PUBLISHED.name}` })
      .click();
    await expect(nameBox(page)).toHaveValue(PUBLISHED.name);
    await expect(screen(page)).toHaveAccessibleName("Ejecutar");
    await screen(page).getByLabel("Mínimo").pressSequentially("120", { delay: 60 });
    await screen(page).getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(head(page).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await sent(page, `POST api/agent/automations/${PUBLISHED.id}/run `)).toHaveLength(1);
  });
  test("AU-97 · «Ejecutar» is in «⋯» of the editor's header and in the notice of publishing («Publicada la versión 1 · Ejecutar»); an automation never published has neither", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [PUBLISHED, NEVER], agent: BEFORE() });
    await openCanvas(page, NEVER.name);
    expect(await menuItems(page)).not.toContain("Ejecutar");
    await publishButton(page).click();
    await screen(page).getByRole("button", { name: "Publicar versión 1" }).click();
    await toast(page).getByRole("button", { name: "Ejecutar" }).click();
    // Its trigger asks «Mínimo»: the box of «Probar» asks it first.
    await expect(screen(page)).toHaveAccessibleName("Ejecutar");
    await screen(page).locator(".modal-actions").getByRole("button", { name: "Cancelar" }).click();
    expect(await menuItems(page)).toContain("Ejecutar");
    await openCanvas(page, PUBLISHED.name);
    expect(await menuItems(page)).toEqual(["Ejecutar", "Ajustes", "Duplicar", "Eliminar"]);
  });
  test("AU-97 · with «Campos que pide», «Ejecutar» shows the same box as «Probar» and runs the published version with them", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [PUBLISHED], agent: BEFORE() });
    await openCanvas(page, PUBLISHED.name);
    await more(page, "Ejecutar");
    await screen(page).getByLabel("Mínimo").pressSequentially("250", { delay: 60 });
    await screen(page).getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(screen(page)).toHaveCount(0);
    const runs = await sent(page, `POST api/agent/automations/${PUBLISHED.id}/run `);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toBe("s_inicio");
    expect(Number((runs[0]?.fields as Record<string, unknown> | undefined)?.minimo)).toBe(250);
  });
  test("AU-97 · run, the app goes to «Ejecuciones» and the run is seen advancing step by step", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [PUBLISHED], agent: BEFORE() });
    await openCanvas(page, PUBLISHED.name);
    await more(page, "Ejecutar");
    await screen(page).getByLabel("Mínimo").pressSequentially("250", { delay: 60 });
    await screen(page).getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(head(page).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Under way: the step it is in, and the steps it has run with their rows; then how it ended, in the list too.
    await expect(runBar(page)).toContainText("En marcha: «");
    await expect(runCanvas(page).locator(".auto-card")).toHaveCount(TESTED.steps.length);
    await expect(runBar(page)).toContainText("Bien", { timeout: 15_000 });
    await expect(runItems(page).nth(0)).toContainText("Bien", { timeout: 5_000 });
    await expect(runBar(page)).toContainText("No hizo nada");
    // Ended, it is asked no more.
    const asked = (await recorded(page, "__automations")).filter((x) =>
      x.startsWith("GET a_01jx8x0t2v4x6z8b0d2f4h6k8n/runs/r_"),
    ).length;
    await page.waitForTimeout(3_000);
    expect(
      (await recorded(page, "__automations")).filter((x) =>
        x.startsWith("GET a_01jx8x0t2v4x6z8b0d2f4h6k8n/runs/r_"),
      ).length,
    ).toBe(asked);
  });
  test("AU-97 · off, «Ejecutar» says «Está apagada» with «Encender»; with unpublished changes it says it runs the published version; while one runs it says so", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [
        { ...PUBLISHED, published: { versions: 1, enabled: false }, run: { refused: "running" } },
      ],
      agent: BEFORE(),
    });
    await openCanvas(page, PUBLISHED.name);
    await expect(toggle(page)).not.toBeChecked();
    await more(page, "Ejecutar");
    await expect(screen(page)).toHaveCount(0);
    await expect(toast(page)).toContainText("Está apagada");
    await toast(page).getByRole("button", { name: "Encender" }).click();
    await expect(toggle(page)).toBeChecked();
    // A change not published: the box says what runs.
    await nameBox(page).fill("Revisar pendientes cada semana");
    await nameBox(page).press("Enter");
    await more(page, "Ejecutar");
    await expect(screen(page)).toContainText("Corre la versión 1, sin los cambios sin publicar");
    await screen(page).getByLabel("Mínimo").fill("300");
    await screen(page).getByRole("button", { name: "Ejecutar", exact: true }).click();
    await expect(toast(page)).toContainText("Ya se está ejecutando");
  });
});

test.describe("the settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test("AU-17 · «⋯ → Ajustes» shows the limits a step of this automation can reach («Tiempo» always, «Filas escritas» when a step writes), each with its default and its maximum, and a number over the maximum is refused in the field", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [NEVER], agent: BEFORE() });
    await openCanvas(page, NEVER.name);
    await more(page, "Ajustes");
    await expect(screen(page)).toHaveAccessibleName("Ajustes");
    const time = screen(page).getByLabel("Tiempo");
    const rows = screen(page).getByLabel("Filas escritas");
    await expect(time).toHaveValue("60");
    await expect(rows).toHaveValue("1000");
    await expect(screen(page)).toContainText("Por defecto 60 s · máximo 600 s");
    await expect(screen(page)).toContainText("Por defecto 1000 · máximo 20.000");
    await expect(screen(page).getByLabel("Llamadas a modelos")).toHaveCount(0);
    // Over the maximum: refused, and the draft keeps what it had.
    await time.fill("700");
    await expect(screen(page).getByRole("alert")).toHaveText("Como mucho 600 s");
    await time.fill("120");
    await expect(screen(page).getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(screen(page)).toHaveCount(0);
    await expect
      .poll(async () => (await lastDraft(page, NEVER.id))?.settings?.limits)
      .toEqual({
        ms: 120_000,
      });
  });
  test("AU-17 · a run stopped by a limit says which and both numbers («Paró: …»), and «Cambiar el límite» opens the settings on that number", async ({
    page,
  }) => {
    const stopped = {
      ...ALL_DONE,
      s_01jmodificar: {
        ...ALL_DONE.s_01jmodificar,
        state: "failed",
        error: {
          failure: { code: "run.limit", detail: { limit: "rowsWritten", max: 1000, got: 1001 } },
        },
      },
    };
    await openApp(page, "/?still", {
      automations: [{ ...testOf(stopped, { kept: FIVE_MIN }), id: NEVER.id, name: NEVER.name }],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    await expect(card(page, "s_01jmodificar")).toContainText(
      "Paró: iba a escribir 1001 filas y el límite son 1000",
    );
    await page.locator(".auto-test-bar").getByRole("button", { name: "Cambiar el límite" }).click();
    await expect(screen(page)).toHaveAccessibleName("Ajustes");
    await expect(screen(page).getByLabel("Filas escritas")).toBeFocused();
  });
});

test.describe("«Permiso»", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test("AU-187 · «Crear una fila», «Modificar filas» and «Eliminar filas» show «Permiso», «Eliminar filas» with «Preguntar» chosen; with «Sí» its card says it removes «sin preguntar», and «Haría esto» the same", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [{ ...testOf(ALL_DONE, { kept: FIVE_MIN }), id: NEVER.id, name: NEVER.name }],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    for (const id of ["s_01jcrear", "s_01jmodificar"]) {
      await openStep(page, id);
      await expect(param(page, "permission")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    await openStep(page, "s_01jeliminar");
    const permission = param(page, "permission").getByRole("combobox");
    await expect(permission).toHaveValue("ask");
    await expect(card(page, "s_01jeliminar").locator(".auto-card-labels")).not.toContainText(
      "sin preguntar",
    );
    await expect(
      salida(page).locator(".auto-would tbody tr").first().locator("td").first(),
    ).toHaveText("A la papelera");
    await permission.selectOption({ label: "Sí" });
    await expect(card(page, "s_01jeliminar").locator(".auto-card-labels")).toContainText(
      "Elimina en Libros · sin preguntar",
    );
    await expect(
      salida(page).locator(".auto-would tbody tr").first().locator("td").first(),
    ).toHaveText("A la papelera · sin preguntar");
    await expect
      .poll(
        async () =>
          (await lastDraft(page, NEVER.id))?.steps.find((s) => s.id === "s_01jeliminar")?.params
            .permission,
      )
      .toBe("yes");
  });
});

test.describe("«Ejecuciones»", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test("AU-99 · the tab «Ejecuciones»: on the left the list with «Todas | Fallos | Pruebas» (when, how it ended, how long, what started it, which version; tests marked); on the right that run's canvas, read-only, with its rows on each arrow and above it what it did in one line", async ({
    page,
  }) => {
    await openRuns(page);
    await expect(head(page).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runItems(page)).toHaveCount(5);
    await expect(runItems(page).nth(0)).toContainText("Bien · 0,9 s");
    await expect(runItems(page).nth(0)).toContainText("Iniciada por ti · versión 2");
    await expect(runItems(page).nth(1)).toContainText("Prueba del borrador");
    await expect(runItems(page).nth(2)).toContainText("Falló en «Modificar filas en Libros»");
    await expect(runItems(page).nth(2)).toContainText("Programada · versión 1");
    await expect(runItems(page).nth(3)).toContainText("Interrumpida en «Si»");
    // The newest is the one shown: its line, then its canvas with each step's rows.
    await expect(runItems(page).nth(0)).toHaveAttribute("aria-current", "true");
    await expect(runBar(page)).toContainText(
      "Creó 1 fila en Libros · Propuso modificar 3 filas en Libros · Propuso mandar a la papelera 125 filas de Libros · con datos de fuera",
    );
    await expect(
      runCanvas(page).locator('.auto-arrow-count[data-arrow^="s_01jbuscar:"]').first(),
    ).toContainText("128 filas");
    await expect(runCanvas(page).locator(".auto-card")).toHaveCount(TESTED.steps.length);
    // Looked at, never changed: no draft and no box is sent from it.
    await runCard(page, "s_01jsi").dragTo(runCard(page, "s_01jcrear"));
    await page.keyboard.press("Delete");
    await expect(runCanvas(page).locator(".auto-card")).toHaveCount(TESTED.steps.length);
    // «Fallos» and «Pruebas», each the server's own page.
    await page.getByRole("radio", { name: "Fallos" }).click();
    await expect(runItems(page)).toHaveCount(2);
    await page.getByRole("radio", { name: "Pruebas" }).click();
    await expect(runItems(page)).toHaveCount(1);
    await page.getByRole("radio", { name: "Todas" }).click();
    await expect(runItems(page)).toHaveCount(5);
    expect(await recorded(page, "__autoRunPages")).toEqual(["all", "failed", "tests", "all"]);
    const touched = (await recorded(page, "__automations")).filter((x) =>
      /^(PUT|POST|DELETE) /.test(x),
    );
    expect(touched).toEqual([]);
  });
  test("AU-99 · A-15 · a year of hourly runs comes fifty at a time, «Ver más» asking the fifty before the last one shown", async ({
    page,
  }) => {
    await openRuns(page, { manyRuns: 24 * 365 });
    await expect(runItems(page)).toHaveCount(50);
    await page.getByRole("button", { name: "Ver más" }).click();
    await expect(runItems(page)).toHaveCount(100);
    const pages = await recorded(page, "__autoRunPages");
    expect(pages).toHaveLength(2);
    expect(pages[1]).toMatch(/^all r_01jhora\d{6}$/);
    // Nothing asks a run's rows but the step's view.
    expect(await recorded(page, "__autoRunRows")).toEqual([]);
  });
  test("AU-99 · opening a step of a run shows what went in and what came out, asked when it is opened; a run that proposed says so in its line", async ({
    page,
  }) => {
    await openRuns(page);
    await expect(runBar(page)).toContainText("Propuso modificar 3 filas en Libros");
    expect(await recorded(page, "__autoRunRows")).toEqual([]);
    await runCard(page, "s_01jbuscar").dblclick();
    await expect(view(page)).toHaveAttribute("data-step", "s_01jbuscar");
    await expect(salida(page)).toContainText("128 filas");
    // A title that looks like HTML is painted as text (A-01).
    await expect(salida(page)).toContainText("<b>Rayuela</b>");
    await expect(salida(page).locator("b")).toHaveCount(0);
    expect(await recorded(page, "__autoRunRows")).toContain("r_01jbien s_01jbuscar out:main 0");
  });
  test("AU-18 · «Deshacer lo que hizo» is there only when the run wrote; pressed, the run says it was undone and when; when a row changed afterwards it says which and undoes nothing", async ({
    page,
  }) => {
    await openRuns(page);
    const undo = runBar(page).getByRole("button", { name: "Deshacer lo que hizo" });
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(toast(page)).toContainText("Deshecho lo que hizo");
    await expect(runBar(page)).toContainText("Deshecha hoy");
    await expect(undo).toHaveCount(0);
    expect(await recorded(page, "__autoUndo")).toEqual(["r_01jbien"]);
    // A test wrote nothing: nothing to undo.
    await runItems(page).nth(1).click();
    await expect(runBar(page)).toContainText("Prueba del borrador");
    await expect(undo).toHaveCount(0);
    // A row it changed was changed again since: it says which, and the run stays as it was.
    await runItems(page).nth(3).click();
    await undo.click();
    await expect(toast(page)).toContainText("No se pudo deshacer: «Libro 2» cambió después");
    await expect(runBar(page)).not.toContainText("Deshecha");
  });
  test("AU-100 · a run has «Reintentar», which says the version it will run when it is not that of then and offers «Deshacer y reintentar» when that run wrote, and «Abrir en el editor con estos datos», which opens the editor with the trigger's output pinned", async ({
    page,
  }) => {
    await openRuns(page);
    // Version 1 failed and wrote nothing: the box says it runs version 2, with no undoing.
    await runItems(page).nth(2).click();
    await runBar(page).getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(screen(page)).toHaveAccessibleName("Reintentar «Revisar pendientes»");
    await expect(screen(page)).toContainText("Correrá la versión 2, no la 1.");
    await expect(screen(page).getByRole("button", { name: "Deshacer y reintentar" })).toHaveCount(
      0,
    );
    await screen(page).getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(screen(page)).toHaveCount(0);
    expect(await recorded(page, "__autoRetry")).toEqual(['{"run":"r_01jfallo"}']);
    // The new run is shown, said a retry, and the list has it first.
    await expect(runBar(page)).toContainText("reintento", { timeout: 10_000 });
    await expect(runItems(page).nth(0)).toHaveAttribute("aria-current", "true");
    // The one that wrote: «Deshacer y reintentar» first.
    await runItems(page).filter({ hasText: "Bien · 0,9 s" }).first().click();
    await expect(runBar(page)).toContainText("con datos de fuera");
    await runBar(page).getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(screen(page)).toContainText(
      "Empieza desde el principio, con los datos de aquella.",
    );
    await screen(page).getByRole("button", { name: "Cancelar", exact: true }).last().click();
    await expect(screen(page)).toHaveCount(0);
    // «Abrir en el editor con estos datos»: the editor, its trigger open with the output of that run pinned.
    await runBar(page).getByRole("button", { name: "Abrir en el editor con estos datos" }).click();
    await expect(head(page).getByRole("tab", { name: "Editor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(view(page)).toHaveAttribute("data-step", "s_inicio");
    await expect(card(page, "s_inicio").locator(".auto-card-pin")).toHaveText("Salida fijada");
    await expect(toast(page)).toContainText("Fijada la salida de «Disparado por el usuario»");
    expect(await recorded(page, "__autoPins")).toEqual(["RUN s_inicio"]);
  });
  test("AU-100 · «Deshacer y reintentar» undoes that run and runs it again", async ({ page }) => {
    await openRuns(page);
    await runBar(page).getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(screen(page)).toContainText("Creó 1 fila en Libros");
    await screen(page).getByRole("button", { name: "Deshacer y reintentar" }).click();
    await expect(screen(page)).toHaveCount(0);
    expect(await recorded(page, "__autoRetry")).toEqual(['{"run":"r_01jbien","undo":true}']);
    await expect(runBar(page)).toContainText("reintento", { timeout: 10_000 });
    await expect(runItems(page).filter({ hasText: "reintento" })).toHaveCount(1);
  });
  test("AU-17 · a run stopped at a limit has «Cambiar el límite», which opens the editor's settings on that number", async ({
    page,
  }) => {
    await openRuns(page);
    await runItems(page).nth(2).click();
    await expect(runBar(page)).toContainText(
      "Paró: iba a escribir 1001 filas y el límite son 1000",
    );
    await runBar(page).getByRole("button", { name: "Cambiar el límite" }).click();
    await expect(screen(page)).toHaveAccessibleName("Ajustes");
    await expect(screen(page).getByLabel("Filas escritas")).toBeFocused();
  });
  test("AU-101 · the «Registro» of the editor, unfolded, shows the last test as a tree, one line per step with its state, its rows and its time, and inside a «Código» its reads, its «Consola» and what it would save; the tree of a run in «Ejecuciones» is the same component", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [{ ...testOf(ALL_DONE, { kept: FIVE_MIN }), id: NEVER.id, name: NEVER.name }],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    await page.locator(".auto-test-bar").getByRole("button", { name: "Ver cada paso" }).click();
    const lines = page.locator(".auto-tree-line");
    await expect(lines).toHaveCount(TESTED.steps.length);
    await expect(lines.nth(0)).toContainText("Disparado por el usuario");
    await expect(lines.nth(1)).toContainText("Buscar filas en Libros");
    await expect(lines.nth(1)).toContainText("1 → 128");
    await expect(lines.filter({ hasText: "Modificar filas en Libros" })).toContainText(
      "Guardaría 3 cambios",
    );
    await expect(lines.filter({ hasText: "Crear una fila en Libros" })).toContainText(
      "Guardaría 1 cambio",
    );
    // A line opens its step.
    await lines.nth(2).locator(".auto-tree-step").click();
    await expect(page.locator(".auto-card.selected[data-step='s_01jsi']")).toHaveCount(1);
  });
  test("AU-101 · the tree of a run says what each step read and saved, in the order they ran", async ({
    page,
  }) => {
    await openRuns(page);
    await runBar(page).getByRole("button", { name: "Ver cada paso" }).click();
    const lines = page.locator(".auto-tree-line");
    await expect(lines).toHaveCount(TESTED.steps.length);
    await expect(lines.nth(0)).toContainText("Disparado por el usuario");
    await expect(lines.nth(1)).toContainText("Leyó 128 filas de Libros");
    await expect(lines.filter({ hasText: "Modificar filas en Libros" })).toContainText(
      "Propuso 3 cambios",
    );
    await expect(lines.filter({ hasText: "Crear una fila en Libros" })).toContainText(
      "Guardó 1 cambio",
    );
  });
  test("AU-103 · a run of which only the summary is left shows its line and says its steps are no longer kept, and still has «Deshacer lo que hizo»", async ({
    page,
  }) => {
    await openRuns(page);
    await runItems(page).nth(4).click();
    await expect(runBar(page)).toContainText("Creó 1 fila en Libros");
    await expect(page.locator(".auto-run-only")).toBeVisible();
    await expect(runCanvas(page)).toHaveCount(0);
    await expect(runBar(page).getByRole("button", { name: "Deshacer lo que hizo" })).toBeVisible();
  });
  test("AU-190 · an interrupted run reads «Interrumpida» with the step it was in, and has «Reintentar»", async ({
    page,
  }) => {
    await openRuns(page);
    await runItems(page).nth(3).click();
    await expect(runBar(page)).toContainText("Interrumpida en «Si»");
    await expect(
      runBar(page).getByRole("button", { name: "Reintentar", exact: true }),
    ).toBeVisible();
  });
  test("AU-188 · from a shared device a run is looked at, and «Deshacer lo que hizo» says to do it from his own device", async ({
    page,
  }) => {
    await openRuns(page, { sharedDevice: true });
    await runBar(page).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(toast(page)).toContainText("dispositivo");
    await expect(runBar(page)).not.toContainText("Deshecha");
  });
});

test.describe("«Ejecuciones» on a phone", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("AU-99 AU-74 · on a phone the list comes first and a run opens over it, with «Todas las ejecuciones» back; it has no «Abrir en el editor con estos datos»", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page, "/?still", { automations: [WITH_RUNS], agent: BEFORE() });
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page.getByText(PUBLISHED.name, { exact: true }).first().tap();
    await head(page).getByRole("tab", { name: "Ejecuciones" }).tap();
    await expect(runItems(page)).toHaveCount(5);
    await expect(page.locator(".auto-run-detail")).toHaveCount(0);
    await runItems(page).nth(2).tap();
    await expect(runItems(page)).toHaveCount(0);
    await expect(runBar(page)).toContainText("Falló en «Modificar filas en Libros»");
    await expect(
      runBar(page).getByRole("button", { name: "Abrir en el editor con estos datos" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await runBar(page).getByRole("button", { name: "Todas las ejecuciones" }).tap();
    await expect(runItems(page)).toHaveCount(5);
  });
});

test.describe("«Versiones» and the deleted ones", () => {
  test.fixme("AU-98 · «⋯ → Versiones» lists each version with its number, when, whose and which one runs; one opens as a read-only canvas; two are compared side by side with what was added, removed and changed marked", async () => {});
  test.fixme("AU-98 · «Volver a esta» opens «Publicar» with that version's document, and publishing there leaves the draft saying «cambios sin publicar»", async () => {});
  test.fixme("AU-191 · the list's «⋯» has «Eliminadas»: each deleted automation with «Recuperar», which brings it back to the list as «Apagada»", async () => {});
  test.fixme("AU-192 · in the editor, a code that cites a collection by a name it no longer has is underlined with the name of today, and its button rewrites it", async () => {});
});

test.describe("«Fijar» and «Programada»", () => {
  test("AU-93 · «Fijar» in the header of SALIDA pins the step's tested output: its card says «Salida fijada», «Probar» does not run it, and the same button releases it; without a tested output it cannot be pressed", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const failed = {
      ...ALL_DONE,
      s_01jmodificar: { ...ALL_DONE.s_01jmodificar, state: "failed", error: { message: "x" } },
    };
    await openApp(page, "/?still", {
      automations: [{ ...testOf(failed, { kept: FIVE_MIN }), id: NEVER.id, name: NEVER.name }],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    // A test that failed has nothing to pin: its SALIDA says why, with no «Fijar».
    await openStep(page, "s_01jmodificar");
    await expect(salida(page).getByRole("button", { name: "Fijar" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await openStep(page, "s_01jbuscar");
    const pin = salida(page).getByRole("button", { name: "Fijar" });
    await pin.click();
    await expect(salida(page).getByRole("button", { name: "Soltar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(card(page, "s_01jbuscar").locator(".auto-card-pin")).toHaveText("Salida fijada");
    await page.keyboard.press("Escape");
    // «Probar» gives its pinned output and does not run it.
    await page
      .locator(".auto-test-bar")
      .getByRole("button", { name: "Probar", exact: true })
      .click();
    const ask = page.getByRole("dialog", { name: "Probar" });
    await ask.getByLabel("Mínimo").fill("300");
    await ask.getByRole("button", { name: "Probar", exact: true }).click();
    await expect(card(page, "s_01jbuscar").locator(".auto-card-pin")).toHaveText("Salida fijada");
    // Released by the same button.
    await openStep(page, "s_01jbuscar");
    await salida(page).getByRole("button", { name: "Soltar" }).click();
    await expect(card(page, "s_01jbuscar").locator(".auto-card-pin")).toHaveCount(0);
    expect(await recorded(page, "__autoPins")).toEqual(["PUT s_01jbuscar", "DELETE s_01jbuscar"]);
  });
  test.fixme("AU-114 · «Programada» is in «Añadir paso» among the triggers; its panel lists its rules in words («Cada día a las 08:00», «Cada lunes a las 09:00», «Cada hora»), adds and removes one, and with none the step is marked", async () => {});
  test.fixme("AU-47 · the «Mapa» shows a published automation with the collections it reads and writes and its trigger, and one never published is not in it", async () => {});
});

test.describe("what a run tells and asks", () => {
  test.fixme("AU-193 · the proposal of a run in the inbox says the automation, how many rows it creates, modifies and sends to the trash in each collection and each row's before and after, marks what came from outside, and reads a value with HTML, Markdown or a link letter by letter", async () => {});
  test.fixme("AU-193 · accepting it shows the run as having saved; when a row changed since, the card says «Ya no vale · Ejecutar otra vez»", async () => {});
  test.fixme("AU-102 · the notice of a run that failed alone says the automation, the step and the reason in the app's words, and pressing it opens that run in «Ejecuciones»", async () => {});
  test.fixme("AU-167 · the notice of a run that wrote alone says what it wrote in counts («… creó 1 fila en … · Deshacer»), and its «Deshacer» undoes that run", async () => {});
});
