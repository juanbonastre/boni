import { clock, under } from "@boni/pace";
import { expect, type Page, test } from "@playwright/test";
import {
  DONE,
  FLOW_CATALOG,
  FLOW_CHECK,
  FLOW_DETAIL,
  FLOWS,
  MAP,
  MODELS,
} from "./agent-scenarios.ts";
import { ALL_DONE, TESTED, testOf, withRuns } from "./automation-data.ts";
import { emit, openApp } from "./fixtures.ts";

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

const SHOTS = "e2e-boni/screenshots";
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

/** «Revisar pendientes» published twice, with five runs (automation-data.ts). */
const WITH_RUNS = withRuns(Date.now());
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

/** A value that looks like HTML, Markdown and a link: read letter by letter wherever it is painted (A-01). */
const LOOKS_LIKE_MARKUP =
  '<img src=x onerror="window.__pwned=1"> **negrita** [enlace](https://ejemplo.example.com/x)';
/** What «Revisar pendientes»'s run r_01jbien asked, as the server's `AskedView`: 3 books changed, 125 to the trash. */
const ASKED_ROWS = [
  {
    step: "s_01jmodificar",
    kind: "collection",
    action: "update",
    collection: "libros",
    name: "Libros",
    row: { id: "e_01jlibro0001", title: "<b>Rayuela</b>" },
    values: {
      titulo: {
        value: LOOKS_LIKE_MARKUP,
        before: "<b>Rayuela</b>",
        integrity: "own",
        outside: false,
      },
    },
  },
  ...[2, 3].map((i) => ({
    step: "s_01jmodificar",
    kind: "collection",
    action: "update",
    collection: "libros",
    name: "Libros",
    row: { id: `e_01jlibro000${i}`, title: `Libro ${i}` },
    values: {
      paginas: {
        value: 400,
        before: 200 + i,
        integrity: i === 2 ? "external" : "own",
        outside: i === 2,
      },
    },
  })),
  ...Array.from({ length: 125 }, (_, k) => ({
    step: "s_01jeliminar",
    kind: "collection",
    action: "trash",
    collection: "libros",
    name: "Libros",
    row: { id: `e_01jlibro${String(k + 4).padStart(4, "0")}`, title: `Libro ${k + 4}` },
    values: {},
  })),
];
const RUN_PROPOSAL_ID = "p_01jrunbien";
/** The proposal r_01jbien left in the inbox, as the server lists it (`automations.accept_run`). */
const RUN_PROPOSAL = {
  id: RUN_PROPOSAL_ID,
  tool: "automations.accept_run",
  view: {
    tool: "automations.accept_run",
    title: "Guardar lo que propuso una automatización",
    rows: [],
    run: {
      automation: TESTED.id,
      name: PUBLISHED.name,
      version: 2,
      run: "r_01jbien",
      startedBy: "schedule",
      count: ASKED_ROWS.length,
      counts: [
        { collection: "libros", name: "Libros", action: "update", n: 3 },
        { collection: "libros", name: "Libros", action: "trash", n: 125 },
      ],
      first: ASKED_ROWS.slice(0, 20),
    },
  },
  sources: [],
  created: Date.now() - 2 * 60 * 60_000,
  run: null,
  card: null,
};
/** «Revisar pendientes» whose run r_01jbien waits on its proposal. */
const ASKING = {
  ...WITH_RUNS,
  runs: WITH_RUNS.runs.map((r) =>
    r.id === "r_01jbien"
      ? {
          ...r,
          proposal: { id: RUN_PROPOSAL_ID, status: "pending" as const },
          asked: ASKED_ROWS,
        }
      : r,
  ),
};
const runCardOf = (page: Page) => page.locator(".run-proposal");
/** The app with that proposal in the Bandeja, opened; `accept`: what accepting it answers. */
async function openAsking(
  page: Page,
  more: { accept?: unknown[]; sharedDevice?: boolean; phone?: boolean } = {},
) {
  await openApp(page, "/?still", {
    automations: [ASKING],
    agent: {
      ...BEFORE(),
      "GET api/agent/proposals": [{ proposals: [RUN_PROPOSAL] }],
      ...(more.accept ? { "POST api/agent/proposals/:id/accept": more.accept } : {}),
    },
    ...(more.sharedDevice ? { sharedDevice: true } : {}),
  });
  if (more.phone)
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Bandeja/ })
      .tap();
  else
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Bandeja/ })
      .click();
  await expect(runCardOf(page)).toBeVisible();
}
/** An automation on the map as the server's `flowMap.ts` gives it (AU-47). */
const autoNode = (
  id: string,
  name: string,
  more: { runs?: number; on?: boolean; version?: number } = {},
) => ({
  id: `auto:${id}`,
  kind: "automation",
  name,
  code: null,
  icon: "",
  runs: more.runs ?? 0,
  last: null,
  calls: 0,
  cost: 0,
  models: [],
  roles: [],
  proposals: 0,
  accepted: 0,
  on: more.on ?? true,
  version: more.version ?? 2,
  trigger: [
    { step: "s_inicio", type: "manual" },
    { step: "s_01jcadadia", type: "schedule" },
  ],
});
const AUTO_NODE = autoNode(TESTED.id, PUBLISHED.name, { runs: 4 });
const OFF_NODE = autoNode("a_01jx8x0t2v4x6z8b0d2f4h6k9r", "Resumen de la semana", {
  on: false,
  version: 1,
});
/** The map of before with these automations on it, each reading and writing Libros. */
const mapWith = (autos: ReturnType<typeof autoNode>[]) => ({
  ...MAP,
  nodes: [...MAP.nodes, ...autos],
  edges: [
    ...MAP.edges,
    ...autos.flatMap((a) => [
      {
        from: "col:t_libro",
        to: a.id,
        kind: "reads",
        n: null,
        outside: false,
        steps: ["s_01jbuscar"],
      },
      {
        from: a.id,
        to: "col:t_libro",
        kind: "writes",
        n: null,
        outside: true,
        steps: ["s_01jmodificar"],
      },
    ]),
  ],
});

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
  test("AU-95 AU-74 AU-97 AU-194 · on the phone the header has no «Publicar» and has the switch (decision 15): it is looked at, tested, turned off or on and, published, run there", async ({
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
    await expect(head(page).getByRole("button", { name: "Más" })).toHaveCount(0);
    // The switch, whole and in sight: off and on again, by the action the desktop's uses.
    await expect(head(page).locator(".auto-switch")).toContainText("Encendida");
    await expect(toggle(page)).toHaveAttribute("data-boni-action", "automations.enable");
    await toggle(page).tap();
    await expect(head(page).locator(".auto-switch")).toContainText("Apagada");
    await toggle(page).tap();
    await expect(head(page).locator(".auto-switch")).toContainText("Encendida");
    expect(await sent(page, `PUT api/agent/automations/${PUBLISHED.id}/enabled `)).toEqual([
      { enabled: false },
      { enabled: true },
    ]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const out = await head(page).evaluate((h) => {
      const box = h.getBoundingClientRect();
      // What sticks out of the header, by its class: a hidden one (the spacer) has no box.
      return [...h.children]
        .filter((c) => c.getBoundingClientRect().width > 0)
        .filter((c) => {
          const r = c.getBoundingClientRect();
          return r.left < box.left - 1 || r.right > box.right + 1;
        })
        .map((c) => c.className);
    });
    await page.screenshot({ path: `${SHOTS}/phone-automation-switch.png` });
    expect(out).toEqual([]);
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
    expect(await menuItems(page)).toEqual([
      "Ejecutar",
      "Ajustes",
      "Versiones",
      "Duplicar",
      "Eliminar",
    ]);
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
    await expect(runItems(page).nth(2)).toContainText("A su hora · versión 1");
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
    // A setting saved meanwhile (here the theme; the desktop broadcasts its settings on its own, each time its live
    // connection to the server changes state) is no other list: the hundred stay. It put the list back to its first
    // fifty in the desktop's test at volume, whose server restarts just before the list opens.
    await page.getByRole("button", { name: "Ajustes" }).click();
    const settings = page.locator(".modal");
    await settings.getByRole("tab", { name: "Apariencia" }).click();
    await settings.getByRole("button", { name: "Claro" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.keyboard.press("Escape");
    await expect(runItems(page)).toHaveCount(100);
    expect(await recorded(page, "__autoRunPages")).toHaveLength(2);
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
    // A test has only «Abrir en el editor con estos datos» (AU-100): it is not retried.
    await expect(runBar(page).getByRole("button", { name: "Reintentar" })).toHaveCount(0);
    await expect(
      runBar(page).getByRole("button", { name: "Abrir en el editor con estos datos" }),
    ).toBeVisible();
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
    // What it told, as the server wrote it, painted as text (S4).
    await expect(runBar(page).locator(".auto-run-notice")).toHaveText(
      "Avisó: «Revisar pendientes» falló <b>a su hora</b>",
    );
    await expect(runBar(page).locator(".auto-run-notice b")).toHaveCount(0);
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
  test("AU-101 · the «Registro» of the editor, unfolded, shows the last test as a tree, one line per step with its state, its rows and its time, and what each step would save; a line opens its step; the tree of a run in «Ejecuciones» is the same component", async ({
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
    await expect(view(page)).toHaveAttribute("data-step", "s_01jsi");
  });
  test("AU-101 · the tree of a run says what each step read and saved, in the order they ran, and a line opens its step", async ({
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
    await lines.nth(1).locator(".auto-tree-step").click();
    await expect(
      runCanvas(page).locator(".auto-card.selected[data-step='s_01jbuscar']"),
    ).toHaveCount(1);
    await expect(view(page)).toHaveAttribute("data-step", "s_01jbuscar");
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

/**
 * «Revisar pendientes» published three times: version 1 searched a hundred and ended in a «Limitar» where today it
 * creates a row; version 2 is Boni's; version 3, the draft, runs.
 */
const V1_STEPS = [
  ...TESTED.steps
    .slice(0, 6)
    .map((s) =>
      s.id === "s_01jbuscar" ? { ...s, params: { ...s.params, limit: 100 } } : (s as unknown),
    ),
  { id: "s_01jlimitar", name: "Limitar", type: "limit", params: { count: 10 } },
] as Record<string, unknown>[];
const V1_ARROWS = [
  ...TESTED.arrows.slice(0, 6),
  { from: { step: "s_01jcombinar", output: "main" }, to: { step: "s_01jlimitar", input: "main" } },
];
const VERSIONED = {
  ...TESTED,
  published: {
    versions: 3,
    docs: { 1: { steps: V1_STEPS, arrows: V1_ARROWS } },
    by: { 2: "preset" as const },
  },
};
const versionsList = (page: Page) =>
  page.getByRole("complementary", { name: "Versiones publicadas" });
const versionItems = (page: Page) => page.locator(".auto-vers-item");
const versionCanvas = (page: Page, n: number) =>
  page.locator(`.auto-vers-canvas[data-version="${n}"]`);
/** The list's «⋯» (FlowsView.tsx), by the page's title. */
const listMore = (page: Page) => page.locator(".flows-head").getByRole("button", { name: "Más" });
const deletedScreen = (page: Page) =>
  page.getByRole("dialog", { name: "Automatizaciones eliminadas" });

test.describe("«Versiones» and the deleted ones", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("AU-98 · «⋯ → Versiones» lists each version with its number, when, whose and which one runs; one opens as a read-only canvas; two are compared side by side with what was added, removed and changed marked", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VERSIONED], agent: BEFORE() });
    await openCanvas(page, TESTED.name);
    await more(page, "Versiones");
    await expect(versionsList(page)).toBeVisible();
    // The newest first, each with its number and when, whose, and the one that runs said.
    await expect(versionItems(page).locator("strong")).toHaveText([
      "Versión 3",
      "Versión 2",
      "Versión 1",
    ]);
    for (const item of await versionItems(page).locator(".auto-runs-when").all())
      await expect(item).toHaveText(/^Versión \d · \S/);
    await expect(versionItems(page).locator(".auto-runs-who")).toHaveText([
      "TúLa que corre",
      "De Boni",
      "Tú",
    ]);
    // The one that runs is open on its canvas, looked at: no step to add, no test, and nothing to go back to.
    await expect(versionItems(page).first()).toHaveAttribute("aria-current", "true");
    await expect(versionCanvas(page, 3).locator(".auto-card")).toHaveCount(TESTED.steps.length);
    await expect(
      versionCanvas(page, 3).getByRole("button", { name: "Añadir un paso" }),
    ).toHaveCount(0);
    await expect(versionCanvas(page, 3).getByRole("button", { name: "Probar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Volver a esta" })).toHaveCount(0);
    // The editor's canvas is not there meanwhile.
    await expect(page.locator(".auto-canvas:not(.auto-vers-canvas)")).toHaveCount(0);
    // Version 1 against it: the older on the left, what changed in lines above and on the cards.
    await versionItems(page).nth(2).click();
    await expect(versionCanvas(page, 1).locator(".auto-card")).toHaveCount(TESTED.steps.length);
    await page.getByLabel("Comparar con").selectOption({ label: "Versión 3" });
    const changes = page.getByRole("region", { name: "Qué cambia de la versión 1 a la 3" });
    await expect(changes.locator("li")).toHaveText([
      "Añade «Crear una fila en Libros»",
      "Quita «Limitar»",
      "Cambia «Buscar filas en Libros»: parámetros",
      "Flechas: 1 nuevas, 1 quitadas",
    ]);
    const sides = page.locator(".auto-vers-compare .auto-vers-canvas");
    await expect(sides).toHaveCount(2);
    await expect(sides.nth(0)).toHaveAttribute("data-version", "1");
    await expect(sides.nth(1)).toHaveAttribute("data-version", "3");
    const marked = (n: number) =>
      versionCanvas(page, n)
        .locator(".auto-card[data-diff]")
        .evaluateAll((cards) =>
          Object.fromEntries(
            cards.map((c) => [c.getAttribute("data-step"), c.getAttribute("data-diff")]),
          ),
        );
    await expect.poll(() => marked(1)).toEqual({ s_01jbuscar: "changed", s_01jlimitar: "removed" });
    await expect.poll(() => marked(3)).toEqual({ s_01jbuscar: "changed", s_01jcrear: "added" });
    await expect(versionCanvas(page, 1).locator(".auto-card-diff")).toHaveText([
      "Cambiado",
      "Quitado",
    ]);
    // Back to the editor, its canvas as it was.
    await page.getByRole("button", { name: "Volver al editor" }).click();
    await expect(versionsList(page)).toHaveCount(0);
    await expect(page.locator(".auto-card")).toHaveCount(TESTED.steps.length);
  });

  test("AU-98 · «Volver a esta» opens «Publicar» with that version's document, and publishing there leaves the draft saying «cambios sin publicar»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VERSIONED], agent: BEFORE() });
    await openCanvas(page, TESTED.name);
    await expect(published(page)).toHaveText("· publicada la versión 3");
    await more(page, "Versiones");
    await versionItems(page).nth(2).click();
    await expect(versionCanvas(page, 1).locator(".auto-card")).toHaveCount(TESTED.steps.length);
    await page.getByRole("button", { name: "Volver a esta" }).click();
    await expect(screen(page)).toBeVisible();
    // The screen is about version 1's document: asked with it, said as the next version.
    expect(await recorded(page, "__autoPublishView")).toEqual(["version=1"]);
    await screen(page).getByRole("button", { name: "Publicar versión 4" }).click();
    await expect(screen(page)).toHaveCount(0);
    expect(await sent(page, `POST api/agent/automations/${TESTED.id}/publish `)).toEqual([
      { version: 1 },
    ]);
    await expect(toast(page)).toContainText("Publicada la versión 4");
    // A new version with the old document; the draft untouched, so not what runs.
    await expect(versionItems(page).locator("strong")).toHaveText([
      "Versión 4",
      "Versión 3",
      "Versión 2",
      "Versión 1",
    ]);
    await expect(versionItems(page).first().locator(".auto-vers-running")).toHaveText(
      "La que corre",
    );
    expect(await sent(page, `PUT api/agent/automations/${TESTED.id}/draft `)).toEqual([]);
    await page.getByRole("button", { name: "Volver al editor" }).click();
    await expect(published(page)).toHaveText("· cambios sin publicar");
    await expect(page.locator(".auto-card")).toHaveCount(TESTED.steps.length);
  });

  test("AU-98 · A-15 · 200 versions are listed at once and only the one shown is read whole", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [{ ...TESTED, published: { versions: 200 } }],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name);
    await head(page).getByRole("button", { name: "Más" }).click();
    const pressed = clock();
    await page.getByRole("menuitemradio", { name: "Versiones", exact: true }).click();
    await expect(versionItems(page)).toHaveCount(200);
    await expect(versionCanvas(page, 200).locator(".auto-card")).toHaveCount(TESTED.steps.length);
    const opening = clock() - pressed;
    await expect(versionItems(page).first().locator("strong")).toHaveText("Versión 200");
    const read = (await recorded(page, "__automations")).filter((r) => /\/versions\/\d+$/.test(r));
    // Once by the editor for the names it kept, and once for its canvas: no other version is read.
    expect(new Set(read)).toEqual(new Set([`GET ${TESTED.id}/versions/200`]));
    under(opening, 2000, "clock", "«Versiones» with 200, from the menu to the canvas of the last");
  });

  test("AU-191 · the list's «⋯» has «Eliminadas»: each deleted automation with «Recuperar», which brings it back to the list as «Apagada»", async ({
    page,
  }) => {
    const gone = {
      ...TESTED,
      id: "a_01jx8x0t2v4x6z8b0d2f4h6d01",
      name: "Resumen <b>semanal</b>",
      published: { versions: 2, enabled: true },
      deleted: true,
    };
    const draftOnly = { ...NEVER, deleted: true };
    await openApp(page, "/?still", {
      automations: [PUBLISHED, gone, draftOnly],
      agent: BEFORE(),
    });
    await openList(page);
    await expect(listState(page, PUBLISHED.name)).toHaveCount(1);
    await expect(listState(page, "Resumen <b>semanal</b>")).toHaveCount(0);
    await listMore(page).click();
    await page.getByRole("menuitemradio", { name: "Eliminadas", exact: true }).click();
    const items = deletedScreen(page).locator(".auto-deleted-item");
    await expect(items.locator(".auto-deleted-name")).toHaveText([
      "Resumen <b>semanal</b>",
      NEVER.name,
    ]);
    // A name that looks like HTML is painted as text (A-01).
    await expect(deletedScreen(page).locator(".auto-deleted-name b")).toHaveCount(0);
    const recover = items.first().getByRole("button", { name: "Recuperar" });
    await expect(recover).toHaveAttribute("data-boni-action", "automations.restore");
    await recover.click();
    await expect(toast(page)).toContainText("«Resumen <b>semanal</b>» recuperada y apagada");
    await expect(items.locator(".auto-deleted-name")).toHaveText([NEVER.name]);
    expect(await recorded(page, "__automations")).toContain(`POST ${gone.id}/restore`);
    await page.keyboard.press("Escape");
    await expect(deletedScreen(page)).toHaveCount(0);
    // Back in the list, off though it was on when it was deleted.
    await expect(listState(page, "Resumen <b>semanal</b>")).toContainText("Apagada");
    await expect(listState(page, NEVER.name)).toHaveCount(0);
  });

  test("AU-191 · a shared device sees «Eliminadas» and its «Recuperar» is refused there", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [PUBLISHED, { ...NEVER, deleted: true }],
      agent: BEFORE(),
      sharedDevice: true,
    });
    await openList(page);
    await listMore(page).click();
    await page.getByRole("menuitemradio", { name: "Eliminadas", exact: true }).click();
    const items = deletedScreen(page).locator(".auto-deleted-item");
    await expect(items.locator(".auto-deleted-name")).toHaveText([NEVER.name]);
    await items.first().getByRole("button", { name: "Recuperar" }).click();
    await expect(toast(page)).toContainText("Solo desde un dispositivo personal.");
    await expect(items).toHaveCount(1);
  });

  test("AU-191 · A-15 · 200 deleted ones are listed at once", async ({ page }) => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...TESTED,
      id: `a_01jx8x0t2v4x6z8b0d2f4h${String(i).padStart(4, "0")}`,
      name: `Eliminada ${i + 1}`,
      updated: 1761990000000 - i * 60_000,
      published: { versions: 1 },
      deleted: true,
    }));
    await openApp(page, "/?still", { automations: [PUBLISHED, ...many], agent: BEFORE() });
    await openList(page);
    await expect(listState(page, PUBLISHED.name)).toHaveCount(1);
    await listMore(page).click();
    const pressed = clock();
    await page.getByRole("menuitemradio", { name: "Eliminadas", exact: true }).click();
    await expect(deletedScreen(page).locator(".auto-deleted-item")).toHaveCount(200);
    const opening = clock() - pressed;
    await expect(deletedScreen(page).locator(".auto-deleted-name").first()).toHaveText(
      "Eliminada 1",
    );
    under(opening, 2000, "clock", "«Eliminadas» with 200, from the menu to the list");
  });

  test("AU-192 · in the editor, a code that cites a collection by a name it no longer has is underlined with the name of today, and its button rewrites it", async ({
    page,
  }) => {
    const id = "a_01jx8x0t2v4x6z8b0d2f4h6d02";
    const source = "return [{ n: $col('Lecturas').count() }];";
    const coded = {
      id,
      name: "Contar lecturas",
      updated: 1761990000000,
      steps: [
        TESTED.steps[0],
        {
          id: "s_01jcodigo",
          name: "Código",
          type: "code",
          params: { source },
          connections: [
            { collection: "libros", read: {}, create: false, update: false, remove: false },
          ],
        },
      ],
      arrows: [
        { from: { step: "s_inicio", output: "main" }, to: { step: "s_01jcodigo", input: "main" } },
      ],
      places: [
        { step: "s_inicio", x: 0, y: 0 },
        { step: "s_01jcodigo", x: 300, y: 0 },
      ],
      // The version that runs cited «Libros» when it was called «Lecturas».
      published: { versions: 1, names: { s_01jcodigo: { Lecturas: "libros" } } },
    };
    await openApp(page, "/?still", { automations: [coded as never], agent: BEFORE() });
    await openList(page);
    await page.locator(".db-table tbody tr").getByText(coded.name, { exact: true }).click();
    await expect(page.locator(".auto-card")).toHaveCount(2);
    await openStep(page, "s_01jcodigo");
    const editor = param(page, "source").locator(".cm-editor");
    const marks = editor.locator(".cm-lintRange-error, .cm-lintRange-warning");
    const notice = param(page, "source").locator(".auto-code-renamed");
    await expect(notice).toContainText(
      "«Lecturas» es el nombre de antes: la colección ahora se llama «Libros»",
    );
    await expect(marks).toHaveCount(1);
    await notice.getByRole("button", { name: "Cambiar a «Libros»" }).click();
    await expect(notice).toHaveCount(0);
    await expect(marks).toHaveCount(0);
    await expect
      .poll(async () => {
        const last = (await sent(page, `PUT api/agent/automations/${id}/draft `)).at(-1)
          ?.automation as { steps: { id: string; params: { source?: string } }[] } | undefined;
        return last?.steps.find((s) => s.id === "s_01jcodigo")?.params.source ?? null;
      })
      .toBe("return [{ n: $col('Libros').count() }];");
  });
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
  test("AU-114 · «Programada» is in «Añadir paso» among the triggers; its panel lists its rules in words («Cada día a las 08:00», «Cada lunes a las 09:00», «Cada hora»), adds and removes one, and with none the step is marked", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, "/?still", {
      automations: [{ ...testOf(ALL_DONE), id: NEVER.id, name: NEVER.name }],
      agent: BEFORE(),
    });
    await openCanvas(page, NEVER.name);
    await page.locator(".auto-add-top").click();
    const add = page.locator(".auto-panel");
    await add.getByRole("button", { name: "Añadir otro disparador" }).click();
    await add.getByRole("button", { name: "Programada", exact: true }).click();
    await expect(view(page)).toBeVisible();
    const rules = view(page).getByRole("group", { name: "Cuándo" });
    const lines = rules.locator(".auto-entry-line");
    // With none it is missing: «Probar paso» says so, as the server's check refuses it.
    const why = view(page).locator(".auto-view-why");
    await expect(lines).toHaveCount(0);
    await expect(why).toHaveText("Falta: Cuándo");
    // One added: «Cada día a las 08:00», the catalogue's default, said in words; its day is asked only «Cada semana».
    await rules.getByRole("button", { name: "Añadir" }).click();
    await expect(lines).toHaveText(["Cada día a las 08:00"]);
    await expect(rules.locator(".auto-entry-body").getByText("Día", { exact: true })).toHaveCount(
      0,
    );
    await rules.getByRole("button", { name: "Añadir" }).click();
    const second = rules.locator(".auto-entry").nth(1);
    await second.getByRole("combobox", { name: "Repetir" }).selectOption({ label: "Cada semana" });
    await second.getByRole("combobox", { name: "Día" }).selectOption({ label: "Lunes" });
    await second.getByLabel("A las").fill("09:00");
    await rules.getByRole("button", { name: "Añadir" }).click();
    await rules
      .locator(".auto-entry")
      .nth(2)
      .getByRole("combobox", { name: "Repetir" })
      .selectOption({ label: "Cada hora" });
    await rules.locator(".auto-entry").nth(2).getByLabel("A las").fill("00:00");
    await expect(lines).toHaveText(["Cada día a las 08:00", "Cada lunes a las 09:00", "Cada hora"]);
    await expect(why).toHaveCount(0);
    // One removed; the card says the first and how many more.
    await rules.locator(".auto-entry").nth(1).getByRole("button", { name: "Borrar" }).click();
    await expect(lines).toHaveText(["Cada día a las 08:00", "Cada hora"]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".auto-card.selected .auto-card-summary")).toContainText(
      "Cada día a las 08:00 y 1 más",
    );
  });
  test("AU-47 · the «Mapa» shows a published automation with the collections it reads and writes and its trigger, and one never published is not in it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, "/?still", {
      automations: [WITH_RUNS, NEVER],
      agent: { ...BEFORE(), "GET api/agent/map": [mapWith([AUTO_NODE, OFF_NODE])] },
    });
    await openList(page);
    await page.getByRole("tab", { name: "Mapa" }).click();
    const map = page.locator(".mp-stage");
    const node = map.locator(".mp-card.automation", { hasText: PUBLISHED.name });
    // Its name, what starts it and the version that runs, its runs of the period; on, with no «Apagada».
    await expect(node.locator(".mp-line")).toHaveText([
      "Disparado por el usuario · Programada · versión 2",
      "4 ejecuciones",
    ]);
    await expect(node).not.toHaveClass(/\boff\b/);
    // One that is off says so.
    const off = map.locator(".mp-card.automation", { hasText: "Resumen de la semana" });
    await expect(off).toHaveClass(/\boff\b/);
    await expect(off.locator(".mp-tag")).toHaveText("Apagada");
    // Its arrows: Libros «lee» into it and it «escribe» Libros, with something from outside marked.
    await expect(map.locator(".mp-edge-label.reads", { hasText: "lee" }).first()).toBeVisible();
    await expect(
      map.locator(".mp-edge-label.writes", { hasText: "escribe" }).first(),
    ).toBeVisible();
    // Never published, it is not on the map (the server leaves it out: flowMap.ts, publish.test.ts), nor its draft.
    await expect(map.locator(".mp-card", { hasText: NEVER.name })).toHaveCount(0);
    // Chosen, its panel opens it.
    await node.click();
    await page.locator(".mp-panel").getByRole("button", { name: "Abrir", exact: true }).click();
    await expect(nameBox(page)).toHaveValue(PUBLISHED.name);
  });
  test("AU-47 · A-15 · the «Mapa» with 200 automations, one with a year of hourly runs, is drawn within its time", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const many = Array.from({ length: 199 }, (_, i) =>
      autoNode(`a_01jmuchas${String(i).padStart(4, "0")}`, `Automatización ${i + 1}`, {
        runs: 30,
        on: i % 3 !== 0,
      }),
    );
    const year = autoNode(TESTED.id, PUBLISHED.name, { runs: 24 * 365 });
    await openApp(page, "/?still", {
      automations: [WITH_RUNS],
      agent: { ...BEFORE(), "GET api/agent/map": [mapWith([year, ...many])] },
    });
    await openList(page);
    const pressed = clock();
    await page.getByRole("tab", { name: "Mapa" }).click();
    const node = page.locator(".mp-card.automation", { hasText: PUBLISHED.name });
    await expect(node.locator(".mp-line").nth(1)).toHaveText(/^8\.?760 ejecuciones$/);
    const drawn = Math.round(clock() - pressed);
    console.log(`AU-47 at volume: the map of 200 automations drawn in ${drawn} ms`);
    // Measured here (2026-11-17, headless Chrome, load 1 to 2 per core on 8 cores): 1,7 s. The margin is for CI.
    under(drawn, 4000, "clock", "drawing the map with 200 automations");
  });
});

test.describe("what a run tells and asks", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test("AU-193 · the proposal of a run in the inbox says the automation, how many rows it creates, modifies and sends to the trash in each collection and each row's before and after, marks what came from outside, and reads a value with HTML, Markdown or a link letter by letter", async ({
    page,
  }) => {
    await openAsking(page);
    const c = runCardOf(page);
    await expect(c.locator(".inbox-kind")).toHaveText("Lo que pregunta una automatización");
    await expect(c.locator("h3")).toHaveText(
      "Revisar pendientes quiere modificar 3 filas en Libros y mandar a la papelera 125 filas de Libros",
    );
    await expect(c.locator(".run-proposal-line")).toHaveText(
      "versión 2 · A su hora · Esperando en la Bandeja",
    );
    // The first twenty of what it asked, each row with its before and its after, by the collection's field names.
    const rows = c.locator(".run-asked-row");
    await expect(rows).toHaveCount(20);
    await expect(rows.nth(0).locator(".run-asked-what")).toHaveText("«<b>Rayuela</b>» en Libros");
    const first = rows.nth(0).locator(".run-asked-value");
    await expect(first.locator(".run-asked-field")).toHaveText("Título");
    await expect(first.locator(".run-asked-before")).toHaveText("<b>Rayuela</b>");
    // A value with HTML, Markdown and a link is read letter by letter (A-01): nothing of it is markup.
    await expect(first.locator(".run-asked-after")).toHaveText(LOOKS_LIKE_MARKUP);
    await expect(c.locator("b, img, a, strong, em")).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    // What came from outside carries its mark, and only that.
    await expect(c.locator(".run-asked-outside")).toHaveCount(1);
    await expect(rows.nth(1).locator(".run-asked-outside")).toHaveText("de fuera");
    await expect(rows.nth(1).locator(".run-asked-value")).toHaveText("Páginas202 → 400de fuera");
    await expect(rows.nth(3).locator(".run-asked-what")).toHaveText(
      "A la papelera: «Libro 4» de Libros",
    );
    // «Ver todo» reads the rest, fifty at a time.
    await c.getByRole("button", { name: "Ver todo (128)" }).click();
    await expect(rows).toHaveCount(128);
    await expect(c.getByRole("button", { name: /^Ver todo/ })).toHaveCount(0);
    expect(await recorded(page, "__autoAsked")).toEqual([
      "r_01jbien 0",
      "r_01jbien 50",
      "r_01jbien 100",
    ]);
    // Its run says where its proposal is, and leads to it.
    await c.getByRole("button", { name: "Ver la ejecución" }).click();
    await expect(head(page).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runBar(page).locator(".auto-run-proposal")).toHaveText(
      "Esperando en la Bandeja · Ver en la Bandeja",
    );
    // It opens on its own, beside the Bandeja that stayed open.
    await runBar(page).getByRole("button", { name: "Ver en la Bandeja" }).click();
    await expect(page.locator(".run-proposal:not(.inbox-panel .run-proposal)")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/automation-run-proposal.png` });
  });
  test("AU-193 · accepting it shows the run as having saved, with no «Deshacer» in the Bandeja: it is undone with its run", async ({
    page,
  }) => {
    await openAsking(page, { accept: [DONE] });
    await runCardOf(page).getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(runCardOf(page)).toHaveCount(0);
    await expect(toast(page)).toContainText("Guardado lo que propuso Revisar pendientes");
    await expect(toast(page).getByRole("button", { name: "Deshacer" })).toHaveCount(0);
    await toast(page).getByRole("button", { name: "Ver la ejecución" }).click();
    await expect(runItems(page).first()).toHaveAttribute("aria-current", "true");
    await expect(runBar(page).locator(".auto-run-proposal")).toHaveText("Propuesta aceptada");
    await expect(runBar(page)).toContainText("Propuso modificar 3 filas en Libros");
    // What he accepted is undone with what it saved alone, from the run (AU-18).
    await runBar(page).getByRole("button", { name: "Deshacer lo que hizo" }).click();
    await expect(runBar(page)).toContainText("Deshecha hoy");
    expect(await recorded(page, "__autoUndo")).toEqual(["r_01jbien"]);
  });
  test("AU-193 · when a row changed since, accepting saves nothing and the card says «Ya no vale · Ejecutar otra vez», which runs it again; its run says the same", async ({
    page,
  }) => {
    await openAsking(page, { accept: [{ __status: 400, error: "stale" }] });
    const c = runCardOf(page);
    await c.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(c.locator(".run-proposal-line")).toHaveText(
      "versión 2 · A su hora · Ya no vale: una fila cambió desde que lo propuso",
    );
    await expect(c.getByRole("button", { name: "Aceptar", exact: true })).toHaveCount(0);
    await c.getByRole("button", { name: "Ejecutar otra vez" }).click();
    // A run with the same data, by what the rows hold now; the card goes and the new run is shown.
    await expect(runCardOf(page)).toHaveCount(0);
    expect(await recorded(page, "__autoRetry")).toEqual(['{"run":"r_01jbien"}']);
    await expect(runBar(page)).toContainText("reintento", { timeout: 10_000 });
    // The run that asked says its proposal is no longer valid, with the same way out.
    await runItems(page).nth(1).click();
    await expect(runBar(page).locator(".auto-run-proposal")).toHaveText(
      "Ya no vale · Ejecutar otra vez",
    );
  });
  test("AU-193 · from a shared device the card is read and not accepted (decision 15): it says to do it from his own device, and the proposal keeps waiting", async ({
    page,
  }) => {
    await openAsking(page, {
      sharedDevice: true,
      accept: [{ __status: 400, error: "accept-on-a-personal-device" }],
    });
    const c = runCardOf(page);
    await expect(c.locator(".run-asked-row")).toHaveCount(20);
    await c.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(c.locator(".decide-error")).toHaveText("Solo desde un dispositivo personal.");
    await expect(c.locator(".run-proposal-line")).toContainText("Esperando en la Bandeja");
    await c.getByRole("button", { name: "Ver la ejecución" }).click();
    await expect(runBar(page).locator(".auto-run-proposal")).toHaveText(
      "Esperando en la Bandeja · Ver en la Bandeja",
    );
  });
  test("AU-102 · the notice of a run that failed alone says the automation, the step and the reason in the app's words, and pressing it opens that run in «Ejecuciones»", async ({
    page,
  }) => {
    const text =
      "«Revisar pendientes» falló en «Modificar filas en Libros»: llegó a un límite de la ejecución.";
    await openApp(page, "/?still", {
      automations: [
        {
          ...WITH_RUNS,
          runs: WITH_RUNS.runs.map((r) =>
            r.id === "r_01jfallo" ? { ...r, notice: { kind: "failed" as const, text } } : r,
          ),
        },
      ],
      agent: BEFORE(),
    });
    // The desktop's notification of it, pressed, asks the window for that run (notices.cjs `aboutOf`, main.cjs).
    await emit(page, { type: "navigate", screen: `run:${TESTED.id}:r_01jfallo` });
    await expect(nameBox(page)).toHaveValue(PUBLISHED.name);
    await expect(head(page).getByRole("tab", { name: "Ejecuciones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(runItems(page).nth(2)).toHaveAttribute("aria-current", "true");
    await expect(runBar(page).locator(".auto-run-notice")).toHaveText(`Avisó: ${text}`);
    await expect(runBar(page)).toContainText("Falló en «Modificar filas en Libros»");
    // A screen that is not two ids opens nothing of it.
    await emit(page, { type: "navigate", screen: "run:<b>x</b>:r_1" });
    await expect(runBar(page)).toHaveCount(0);
  });
  test("AU-167 · decision 17: what a run that started alone saved pops up nothing; its line in «Ejecuciones» says it in counts («… creó 1 fila en Libros») with «Deshacer lo que hizo», which undoes that run", async ({
    page,
  }) => {
    const text = "«Revisar pendientes» creó 1 fila en Libros.";
    const alone = {
      id: "r_01jsola",
      at: Date.now() - 20 * 60_000,
      version: 2,
      startedBy: "schedule",
      steps: WITH_RUNS.runs[0]?.steps,
      line: {
        writes: [{ collection: "libros", name: "Libros", action: "create", n: 1 }],
        asked: [],
        outside: false,
      },
      notice: { kind: "wrote" as const, text },
    };
    await openApp(page, "/?still", {
      automations: [{ ...WITH_RUNS, runs: [...WITH_RUNS.runs, alone] }],
      agent: BEFORE(),
    });
    // Its last event carries what it told: the app pops up nothing for it (no toast, no window).
    await emit(page, {
      type: "run",
      automation: TESTED.id,
      run: "r_01jsola",
      state: "done",
      notice: { kind: "wrote", text, automation: TESTED.id, run: "r_01jsola" },
    });
    await page.waitForTimeout(300);
    await expect(toast(page)).toHaveCount(0);
    await openCanvas(page, PUBLISHED.name);
    await head(page).getByRole("tab", { name: "Ejecuciones" }).click();
    await runItems(page).first().click();
    await expect(runBar(page)).toContainText("A su hora");
    await expect(runBar(page)).toContainText("Creó 1 fila en Libros");
    await expect(runBar(page).locator(".auto-run-notice")).toHaveText(`Avisó: ${text}`);
    const undo = runBar(page).getByRole("button", { name: "Deshacer lo que hizo" });
    await undo.click();
    await expect(toast(page)).toContainText("Deshecho lo que hizo");
    await expect(runBar(page)).toContainText("Deshecha hoy");
    expect(await recorded(page, "__autoUndo")).toEqual(["r_01jsola"]);
  });
});

test.describe("what a run asks, on the phone", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("AU-193 AU-74 · on the phone the card of a run's proposal is in the Bandeja, whole within the screen's width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openAsking(page, { phone: true });
    const c = runCardOf(page);
    await expect(c.locator("h3")).toContainText("Revisar pendientes quiere modificar 3 filas");
    await expect(c.getByRole("button", { name: "Aceptar", exact: true })).toBeVisible();
    await expect(c.locator(".run-asked-after").first()).toHaveText(LOOKS_LIKE_MARKUP);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
