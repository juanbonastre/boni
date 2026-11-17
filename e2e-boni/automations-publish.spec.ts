import { expect, type Page, test } from "@playwright/test";
import { FLOW_CATALOG, FLOW_CHECK, FLOW_DETAIL, FLOWS, MAP, MODELS } from "./agent-scenarios.ts";
import { ALL_DONE, TESTED, testOf } from "./automation-data.ts";
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
    await expect(toast(page)).toContainText("Ejecutando «Revisar pendientes»");
    expect(await sent(page, `POST api/agent/automations/${PUBLISHED.id}/run `)).toHaveLength(1);
  });
});

test.describe("«Ejecutar»", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  test.fixme("AU-97 · «Ejecutar» is in the automation's row of the list (P2, with `automations.run` registered)", async () => {});
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
    await expect(toast(page)).toContainText("Ejecutando «Revisar pendientes»");
    const runs = await sent(page, `POST api/agent/automations/${PUBLISHED.id}/run `);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger).toBe("s_inicio");
    expect(Number((runs[0]?.fields as Record<string, unknown> | undefined)?.minimo)).toBe(250);
  });
  test.fixme("AU-97 · run, the app goes to «Ejecuciones» and the run is seen advancing step by step (P2)", async () => {});
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
  test.fixme("AU-99 · the tab «Ejecuciones»: on the left the list with «Todas | Fallos | Pruebas» (when, how it ended, how long, what started it, which version; tests marked); on the right that run's canvas, read-only, with its rows on each arrow and above it what it did in one line", async () => {});
  test.fixme("AU-99 · opening a step of a run shows what went in and what came out, asked when it is opened; a run that proposed says so with a link to the inbox; on a phone the list comes first and a run opens over it", async () => {});
  test.fixme("AU-18 · «Deshacer lo que hizo» is there only when the run wrote; pressed, the run says it was undone and when; when a row changed afterwards it says which and undoes nothing", async () => {});
  test.fixme("AU-100 · a run has «Reintentar», which says the version it will run when it is not that of then and offers «Deshacer y reintentar» when that run wrote, and «Abrir en el editor con estos datos», which opens the editor with the trigger's output pinned", async () => {});
  test.fixme("AU-101 · the «Registro» of the editor, unfolded, shows the last test as a tree, one line per step with its state, its rows and its time, and inside a «Código» its reads, its «Consola» and what it would save; the tree of a run in «Ejecuciones» is the same component", async () => {});
  test.fixme("AU-103 · a run of which only the summary is left shows its line and says its steps are no longer kept, and still has «Deshacer lo que hizo»", async () => {});
  test.fixme("AU-190 · an interrupted run reads «Interrumpida» with the step it was in, and has «Reintentar»", async () => {});
});

test.describe("«Versiones» and the deleted ones", () => {
  test.fixme("AU-98 · «⋯ → Versiones» lists each version with its number, when, whose and which one runs; one opens as a read-only canvas; two are compared side by side with what was added, removed and changed marked", async () => {});
  test.fixme("AU-98 · «Volver a esta» opens «Publicar» with that version's document, and publishing there leaves the draft saying «cambios sin publicar»", async () => {});
  test.fixme("AU-191 · the list's «⋯» has «Eliminadas»: each deleted automation with «Recuperar», which brings it back to the list as «Apagada»", async () => {});
  test.fixme("AU-192 · in the editor, a code that cites a collection by a name it no longer has is underlined with the name of today, and its button rewrites it", async () => {});
});

test.describe("«Fijar» and «Programada»", () => {
  test.fixme("AU-93 · «Fijar» in the header of SALIDA pins the step's tested output: its card says «Salida fijada», «Probar» does not run it, and the same button releases it; without a tested output it cannot be pressed", async () => {});
  test.fixme("AU-114 · «Programada» is in «Añadir paso» among the triggers; its panel lists its rules in words («Cada día a las 08:00», «Cada lunes a las 09:00», «Cada hora»), adds and removes one, and with none the step is marked", async () => {});
  test.fixme("AU-47 · the «Mapa» shows a published automation with the collections it reads and writes and its trigger, and one never published is not in it", async () => {});
});

test.describe("what a run tells and asks", () => {
  test.fixme("AU-193 · the proposal of a run in the inbox says the automation, how many rows it creates, modifies and sends to the trash in each collection and each row's before and after, marks what came from outside, and reads a value with HTML, Markdown or a link letter by letter", async () => {});
  test.fixme("AU-193 · accepting it shows the run as having saved; when a row changed since, the card says «Ya no vale · Ejecutar otra vez»", async () => {});
  test.fixme("AU-102 · the notice of a run that failed alone says the automation, the step and the reason in the app's words, and pressing it opens that run in «Ejecuciones»", async () => {});
  test.fixme("AU-167 · the notice of a run that wrote alone says what it wrote in counts («… creó 1 fila en … · Deshacer»), and its «Deshacer» undoes that run", async () => {});
});
