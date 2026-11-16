import { expect, type Page, test } from "@playwright/test";
import {
  FLOW_CATALOG,
  FLOW_CHECK,
  FLOW_DETAIL,
  FLOWS,
  FLOWS_WITH_SUMMARY,
  MAP,
  MODELS,
} from "./agent-scenarios.ts";
import { openApp } from "./fixtures.ts";

/**
 * «Automatizaciones» on the screen, F14b (docs/automatizaciones.md §5.7, §5.8; the sketch,
 * docs/maquetas/automatizaciones.html): the list, the canvas, adding a step, the step's view, dragging a field, the
 * draft that saves itself and «Probar». Pending: the first PR of the phase brings one test per rule, and the builder
 * turns each into a real one as its screen exists, keeping the rule's id in its name (`make check` reads them).
 *
 * How they are written when they run: over the mocked server of fixtures.ts (`openApp` with the answers of the
 * routes of apps/server/src/automations/routes.ts), with collections whose keys and names are like Juan's
 * (agent-scenarios.ts) and, where a rule is about many rows or many fields, with many: a test of 3,000 rows, a
 * collection of 40 fields. Typing and dragging go at a person's pace where time matters (the pause before a save,
 * the preview of an expression). The same things over the real server are e2e-boni-desktop/automations.spec.ts.
 */

const SHOTS = "e2e-boni/screenshots";
/** Two automations of the new format, with ids as the server makes them: one started by hand, one with no step. */
const AUTOMATIONS = [
  {
    id: "a_01jx8p3k5m7n9q2r4t6v8w0y1z",
    name: "Revisar gastos",
    trigger: "manual",
    updated: 1761900000000,
  },
  {
    id: "a_01jx8n2c4e6g8j0l2n4p6r8t0v",
    name: "Borrador sin pasos",
    trigger: null,
    updated: 1761800000000,
  },
];
/** What the flows of before need to be listed and opened (agent-scenarios.ts). */
const BEFORE = (flows: unknown = FLOWS) => ({
  "GET api/agent/models": [MODELS],
  "GET api/agent/map": [MAP],
  "GET api/agent/flows": [flows],
  "GET api/agent/flows/:id": [{ ...FLOW_DETAIL, enabled: true }],
  "GET api/agent/flows/catalog": [FLOW_CATALOG],
  "POST api/agent/flows/check": [FLOW_CHECK],
  "PUT api/agent/flows/:id/enabled": [{ ...FLOW_DETAIL, enabled: false }],
});
async function list(page: Page) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await expect(page.locator(".topbar h1")).toHaveText("Automatizaciones");
  return page.locator(".db-table tbody tr");
}
/** What the app asked of the automations' routes ("POST", "GET a_…", "PUT a_…/draft"), as the mock saw it. */
const asked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __automations?: string[] }).__automations ?? []);
/** The server down (each automations' route answers 503), or back. */
const serverDown = (page: Page, down: boolean) =>
  page.evaluate((d) => {
    (window as unknown as { __automationsDown?: boolean }).__automationsDown = d;
  }, down);
const sent = (page: Page, start: string) =>
  page.evaluate(
    (st) =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? [])
        .filter((b) => b.startsWith(st))
        .map((b) => JSON.parse(b.slice(st.length)) as Record<string, unknown>),
    start,
  );
/** The name in the last draft sent to `start`. */
const lastName = async (page: Page, start: string) =>
  ((await sent(page, start)).at(-1)?.automation as { name?: string } | undefined)?.name;
const head = (page: Page) => page.locator(".auto-head");
const saved = (page: Page) => head(page).getByRole("status");
const nameBox = (page: Page) => page.getByRole("textbox", { name: "Nombre de la automatización" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe("the list", () => {
  test("AU-60 · the sidebar, the collection's page and its crumbs, «Buscar», the conversation and the map say «Automatizaciones»; nothing on the screen says «Flujos», and «flujo» is read only in «Formato anterior»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const noFlujo = async () => expect(page.locator("body")).not.toContainText(/flujo/i);
    // The sidebar and the collection's page.
    await expect(page.locator(".sidebar")).toContainText("Automatizaciones");
    await list(page);
    await expect(page.locator(".db-table tbody tr")).toHaveCount(3);
    await noFlujo();
    // «Buscar»: «Nueva automatización», which opens the new canvas.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("automat", { delay: 40 });
    const found = page.locator(".find-row").first();
    await expect(found).toHaveText("Nueva automatización (Automatizaciones)");
    await expect(found).toHaveAttribute("data-boni-action", "automations.create");
    await noFlujo();
    await page.keyboard.press("Enter");
    await expect(page.locator(".auto-start h2")).toHaveText("¿Cómo empieza?");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    // The map: its groups by automation, its cards of the flows of before.
    await page.getByRole("tab", { name: "Mapa" }).click();
    await expect(page.locator(".mp-stage .mp-card").first()).toBeVisible();
    await noFlujo();
    // A flow of before: its crumbs say the section, and «Formato anterior» by its name.
    await page.getByRole("tab", { name: "Tabla" }).click();
    await page.locator(".db-table tbody tr").getByText("Leer correo", { exact: true }).click();
    await expect(page.locator(".flow-crumbs")).toContainText("Automatizaciones");
    await expect(page.locator(".flow-crumbs .former-format")).toHaveText("Formato anterior");
    await noFlujo();
  });
  test("AU-61 · the list is a collection page, «Tabla | Mapa», with six columns: Nombre, Se inicia, Estado, Última ejecución, Ejecuciones and De; an automation of the new format says «Sin publicar» and one with no trigger «—»; a flow of before says «Encendida» or «Apagada»", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: AUTOMATIONS,
      agent: BEFORE(FLOWS_WITH_SUMMARY),
    });
    const rows = await list(page);
    await expect(page.getByRole("tab")).toHaveText(["Tabla", "Mapa"]);
    await expect(page.locator(".db-table thead th .th-name")).toHaveText([
      "Nombre",
      "Se inicia",
      "Estado",
      "Última ejecución",
      "Ejecuciones",
      "De",
    ]);
    // The automations of the new format first, the newest first; then the flows of before, those on first.
    await expect(rows).toHaveCount(4);
    for (const text of ["Revisar gastos", "Disparado por el usuario", "Sin publicar", "Tú"])
      await expect(rows.nth(0)).toContainText(text);
    for (const text of ["Borrador sin pasos", "—", "Sin publicar"])
      await expect(rows.nth(1)).toContainText(text);
    for (const text of ["Leer correo", "Encendida", "Boni", "42"])
      await expect(rows.nth(2)).toContainText(text);
    await expect(rows.nth(3)).toContainText("Apagada");
    await expect(page.locator(".db-table tbody")).not.toContainText("Encendido");
    await page.screenshot({ path: `${SHOTS}/automations-list.png` });
  });
  test("AU-61 · with no automation the page says what any empty collection says, with its «Nueva»; «Mapa» shows the flows of before and no automation that is not published", async ({
    page,
  }) => {
    await openApp(page, "/?still", { agent: BEFORE({ flows: [] }) });
    const rows = await list(page);
    // What any empty collection shows: its columns, no row, and its «Nueva» above and under the table.
    await expect(page.locator(".db-table thead th .th-name")).toHaveCount(6);
    await expect(rows).toHaveCount(0);
    await expect(
      page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".db-add-row")).toHaveText("Nueva");
    await page.screenshot({ path: `${SHOTS}/automations-empty.png` });
  });

  test("AU-61 · «Mapa» shows the flows of before and no automation that is not published", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    await list(page);
    await page.getByRole("tab", { name: "Mapa" }).click();
    const map = page.locator(".mp-stage");
    await expect(map.locator(".mp-card", { hasText: "Leer correo" }).first()).toBeVisible();
    await expect(map.locator(".mp-card", { hasText: "Revisar gastos" })).toHaveCount(0);
    await expect(map.locator(".mp-card", { hasText: "Borrador sin pasos" })).toHaveCount(0);
  });
  test("AU-61 · «Nueva» opens the empty canvas and asks the server for nothing; the automation is in the list, named «Nueva automatización», once it has its first step", async ({
    page,
  }) => {
    await openApp(page, "/?still", { agent: BEFORE() });
    const rows = await list(page);
    await expect(rows).toHaveCount(1);
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    await expect(page.locator(".auto-start h2")).toHaveText("¿Cómo empieza?");
    await expect(nameBox(page)).toHaveValue("Nueva automatización");
    // Longer than the pause before a save: nothing was asked and nothing says it was saved.
    await page.waitForTimeout(1500);
    expect(await asked(page)).toEqual([]);
    await expect(saved(page)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/automation-new.png` });
    // Back with nothing done: the list as it was.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(rows).toHaveCount(1);
    expect(await asked(page)).toEqual([]);
    // Its first step makes it.
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    await page.getByRole("button", { name: "Disparado por el usuario" }).click();
    await expect(saved(page)).toHaveText("Guardado");
    expect(await asked(page)).toEqual(["POST"]);
    const [made] = await sent(page, "POST api/agent/automations ");
    const first = made?.automation as { name: string; steps: { type: string }[] };
    expect(first.name).toBe("Nueva automatización");
    expect(first.steps.map((x) => x.type)).toEqual(["manual"]);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(rows).toHaveCount(2);
    for (const text of ["Nueva automatización", "Disparado por el usuario", "Sin publicar"])
      await expect(rows.first()).toContainText(text);
  });
  test("AU-151 · «Nueva» always opens the new canvas; a flow of before opens the editor of before with «Formato anterior» by its name, and is saved, turned on and run as it was", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    // «Nueva» is the new canvas, also with flows of before in the list.
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    await expect(page.locator(".auto-page .auto-start")).toBeVisible();
    await expect(page.locator(".flow-editor")).toHaveCount(0);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    // A flow of before: the editor of before, marked by its name.
    await rows.getByText("Leer correo", { exact: true }).click();
    await expect(page.locator(".flow-editor .flow-canvas .fl-node").first()).toBeVisible();
    await expect(page.locator(".auto-page")).toHaveCount(0);
    const crumbs = page.locator(".flow-crumbs");
    await expect(crumbs).toContainText("Leer correo");
    await expect(crumbs.locator(".former-format")).toHaveText("Formato anterior");
    // As it was: saved with «Guardar», turned on and off with its switch, through the routes of the flows.
    await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
    const on = page.locator('[data-boni-action="flows.enable"]');
    await expect(on).toBeChecked();
    await on.click();
    await expect
      .poll(async () => (await sent(page, "PUT api/agent/flows/leer-correo/enabled ")).length)
      .toBe(1);
    expect(await sent(page, "PUT api/agent/flows/leer-correo/enabled ")).toEqual([
      { enabled: false },
    ]);
    await expect(on).not.toBeChecked();
    await page.screenshot({ path: `${SHOTS}/automations-former-format.png` });
  });
});

test.describe("the editor", () => {
  test("AU-62 · the header has back, the name (edited in place), «Guardado» and «⋯» with Duplicar and Eliminar, and nothing else of its own; there is no bar under it and no button to save", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    await rows.getByText("Revisar gastos", { exact: true }).click();
    await expect(nameBox(page)).toHaveValue("Revisar gastos");
    await expect(saved(page)).toHaveText("Guardado");
    // Back, the name, «Guardado» and «⋯»: two buttons and the name, nothing else.
    await expect(head(page).getByRole("button")).toHaveCount(2);
    await expect(
      head(page).getByRole("button", { name: "Volver a Automatizaciones" }),
    ).toBeVisible();
    await expect(head(page).getByRole("button", { name: "Más" })).toBeVisible();
    await expect(head(page).getByRole("textbox")).toHaveCount(1);
    // No bar under it, no button to save.
    await expect(page.locator(".auto-page .doc > *")).toHaveCount(2);
    await expect(page.locator(".auto-page .doc > *").nth(1)).toHaveClass(/auto-canvas/);
    await expect(page.getByRole("button", { name: /^Guardar/ })).toHaveCount(0);
    await head(page).getByRole("button", { name: "Más" }).click();
    await expect(page.locator(".pop-box .menu-item")).toHaveText(["Duplicar", "Eliminar"]);
    await page.screenshot({ path: `${SHOTS}/automation-header.png` });
  });
  test("AU-62 · a change is saved after a short pause and on leaving the editor: «Guardando…», then «Guardado»; with the server failing, «Sin guardar · Reintentar», and it is saved when the server is back; opened again, the draft is as it was left", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    await rows.getByText("Revisar gastos", { exact: true }).click();
    const box = nameBox(page);
    await expect(box).toHaveValue("Revisar gastos");
    const draft = "PUT api/agent/automations/a_01jx8p3k5m7n9q2r4t6v8w0y1z/draft ";
    // Typed at a person's pace: «Guardando…» while typing, one save after the pause, then «Guardado».
    await box.click();
    await box.press("End");
    await box.pressSequentially(" del mes", { delay: 120 });
    await expect(saved(page)).toHaveText("Guardando…");
    await expect(saved(page)).toHaveText("Guardado");
    const once = await sent(page, draft);
    expect(once).toHaveLength(1);
    expect(await lastName(page, draft)).toBe("Revisar gastos del mes");
    // The server failing: «Sin guardar · Reintentar»; what he typed stays; saved when the server is back.
    await serverDown(page, true);
    const before = (await asked(page)).length;
    await box.pressSequentially(" ejemplo", { delay: 120 });
    await expect(saved(page)).toContainText("Sin guardar");
    await expect(saved(page).getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(box).toHaveValue("Revisar gastos del mes ejemplo");
    await page.screenshot({ path: `${SHOTS}/automation-not-saved.png` });
    // Tried again by itself a moment later (2 s, then 4 s): still failing, still said.
    await expect.poll(async () => (await asked(page)).length - before, { timeout: 5_000 }).toBe(2);
    await expect(saved(page)).toContainText("Sin guardar");
    await serverDown(page, false);
    await saved(page).getByRole("button", { name: "Reintentar" }).click();
    await expect(saved(page)).toHaveText("Guardado");
    expect(await lastName(page, draft)).toBe("Revisar gastos del mes ejemplo");
    // On leaving, before the pause: sent on the way out; opened again, as it was left.
    await box.press("End");
    await box.pressSequentially(" 2", { delay: 60 });
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect.poll(() => lastName(page, draft)).toBe("Revisar gastos del mes ejemplo 2");
    await rows.getByText(/^Revisar gastos del mes ejemplo/).click();
    await expect(box).toHaveValue("Revisar gastos del mes ejemplo 2");
    await expect(saved(page)).toHaveText("Guardado");
  });
  test("AU-62 · «Duplicar» opens «<nombre> (copia)» with the same steps in the same places; «Eliminar» takes it off the list without asking and the «Deshacer» of its notice brings it back", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    await expect(rows).toHaveCount(3);
    let confirmed = false;
    page.on("dialog", (d) => {
      confirmed = true;
      void d.dismiss();
    });
    await rows.getByText("Revisar gastos", { exact: true }).click();
    await head(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Duplicar" }).click();
    // The copy, opened: its name, its own id, its trigger (no «¿Cómo empieza?»).
    await expect(nameBox(page)).toHaveValue("Revisar gastos (copia)");
    expect(
      await sent(page, "POST api/agent/automations/a_01jx8p3k5m7n9q2r4t6v8w0y1z/duplicate "),
    ).toEqual([{ name: "Revisar gastos (copia)" }]);
    await expect(page.locator(".auto-start")).toHaveCount(0);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(rows).toHaveCount(4);
    for (const text of ["Revisar gastos (copia)", "Disparado por el usuario"])
      await expect(rows.first()).toContainText(text);
    // «Eliminar» without asking: off the list, and the notice's «Deshacer» brings it back.
    await rows.getByText("Revisar gastos", { exact: true }).click();
    await expect(nameBox(page)).toHaveValue("Revisar gastos");
    await head(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Eliminar" }).click();
    await expect(page.locator(".topbar h1")).toHaveText("Automatizaciones");
    await expect(rows).toHaveCount(3);
    await expect(rows.getByText("Revisar gastos", { exact: true })).toHaveCount(0);
    expect(confirmed).toBe(false);
    await expect(page.locator(".modal")).toHaveCount(0);
    const undo = page.locator(".toast").getByRole("button", { name: "Deshacer" });
    await expect(page.locator(".toast")).toContainText("«Revisar gastos» eliminada");
    await expect(undo).toHaveAttribute("data-boni-action", "automations.restore");
    await undo.click();
    await expect(rows).toHaveCount(4);
    await expect(rows.getByText("Revisar gastos", { exact: true })).toHaveCount(1);
  });

  test.fixme("AU-62 · on the canvas, the copy of «Duplicar» has each step of the original in the same place (C2)", async () => {});
  test.fixme("AU-63 · the canvas reads left to right: each step a card of one width with its icon, its name and one line of summary, both cut with an ellipsis and whole on hover and in the step's view; the outputs on the right with their names; a canvas with only its trigger says nothing more", async () => {});
  test.fixme("AU-64 · bottom left: zoom in, zoom out, fit and «Ordenar»; bottom centre: «Probar»; top right: «+»; at the bottom «Registro», folded, with one line: «Sin probar», then the last test", async () => {});
  test.fixme("AU-64 · «Probar» with several triggers opens a menu to choose one, asks a trigger's fields in a small box with the last ones filled in, says «Probando…» and cannot be pressed meanwhile; with problems it tests nothing, marks each step and «Registro» says how many and leads to the first", async () => {});
  test.fixme("AU-65 · a step is added from the «+» of the top, the «+» of an output with no arrow (or dragging from it), the «+» of a selected arrow and a right click on the canvas: the four open the same panel, and the step chosen ends connected, selected and open", async () => {});
  test.fixme("AU-66 · a selected step shows a short bar, Probar paso · Apagar · Eliminar · ⋯ (Cambiar nombre · Duplicar · Copiar); a selected arrow, «+» and delete; the right click on a step has seven things; nothing appears on hover; an off step says «Encender»", async () => {});
  test.fixme("AU-66 · deleting a step between two others joins them with one arrow; deleting one with two outputs in use takes its arrows", async () => {});
  test.fixme("AU-67 · after a test each arrow says how many rows passed («128 filas»; «0 filas» dimmed), an output with no arrow its count too, and each step how it ended (bien, falló, saltado, parado); a step that failed says why on its card in two lines at most, whole in its SALIDA with «Ir al parámetro», and in «Registro»; the ones that hung from it are «saltados»", async () => {});
  test.fixme("AU-68 · Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes a step added, removed, connected, moved, renamed and a parameter changed; Ctrl+C, X and V copy, cut and paste the selected steps with the arrows between them; Supr deletes, Intro opens, Esc closes; what was undone is saved; a key typed in a field is the field's; after a reload there is nothing to undo", async () => {});
  test.fixme("AU-05 · a box stays where it is dropped: after a reload and in another window it is there, and moving it does not say «Guardando…» of the draft nor age any test; a new step goes to the right of the one it hangs from and no other box moves; «Ordenar» moves them all and Ctrl+Z puts them back", async () => {});
  test.fixme("AU-87 · adding a step puts that step and nothing else: no other step, arrow or option appears, and nothing changes on the canvas that Juan did not do", async () => {});
});

test.describe("adding a step", () => {
  test.fixme("AU-69 · the panel is on the right with its search on top: on an empty canvas it asks «¿Cómo empieza?» and lists the triggers; then the three categories of F14b by what one wants to do, and «Añadir otro disparador» last; «Colección» shows its actions as phrases", async () => {});
  test.fixme("AU-69 · the search looks in every category at once by a step's name and its actions', and with nothing found says «Nada con «…»»; under 1100 px the panel goes over the canvas", async () => {});
  test.fixme("AU-86 · a new step is named by what it does («Buscar filas en Gastos») and the name follows its collection until Juan renames it; a second «Filtrar» is «Filtrar 2»; renaming a step changes the chips that cite it", async () => {});
});

test.describe("the step's view", () => {
  test.fixme("AU-70 · a double click or Intro opens the step over the dimmed canvas in three columns, ENTRADA · «Parámetros | Ajustes» · SALIDA, with its icon, its name (edited there), «Probar paso» and close; Esc closes; there is no «Guardar»; a trigger's ENTRADA is its «Datos de prueba»", async () => {});
  test.fixme("AU-71 · ENTRADA says which step its rows come from and how many, lets any earlier step of the path be chosen, and is seen as «Esquema» (first, each field with a sample value cut to a line), «Tabla» or «JSON»; with more than ten fields it has a search; a related row unfolds one level; empty, it says «Prueba los pasos anteriores» with its button, which tests them; «Combinar» has a tab per input", async () => {});
  test.fixme("AU-71 · «Tabla» and «JSON» show the first 50 rows of a test of 3,000 and «N filas más» brings 50 more: the rows never arrive all at once; a table of 40 fields scrolls sideways with its cells cut to a line; a value that looks like HTML or a link is painted as text (A-01)", async () => {});
  test.fixme("AU-72 · SALIDA is seen as «Tabla» (first; «Esquema» with one row), «Esquema» or «JSON», with how many rows and a tab per output («sí (3)», «no (125)»); its foot says when it was tested and how long it took; untested it says «Sin probar» with «Probar paso», skipped «Saltado: no le llegaron filas», with no rows «0 filas»", async () => {});
  test.fixme("AU-72 · a step that writes shows «Haría esto» in a test: a row per row written, each field that changes with its value before and after; creating, only after; deleting, the row as it was", async () => {});
  test.fixme("AU-73 · «Probar paso» is at the top right; when it cannot be pressed it says why beside it: «Falta: Colección», by the names of the required parameters that are empty, or «Probando…»", async () => {});
  test.fixme("AU-74 · under 1100 px the step's view has two columns, «Entrada | Salida» as tabs on the left and «Parámetros | Ajustes» on the right, and nothing is cut or scrolls sideways", async () => {});
  test.fixme("AU-74 · on the phone the list is the collection's page and an automation opens its canvas only to look: it pans and zooms, a step opens in one column with three tabs, «Entrada | Parámetros | Salida», with nothing to change; there is no «+», no step bar, no dragging, no menu that changes something, no «Probar» and no «Probar paso», and an ENTRADA or a SALIDA with no data says «Sin probar» with no button", async () => {});
  test.fixme("AU-20 · a field dropped on a text goes in at the caret and one dropped on a number replaces it; after a test the expression says what it gives and with which row («= 5 · con la fila 1 de 128»); typing in it asks the server for nothing", async () => {});
  test.fixme("AU-20 · every control of a value has «{ }» inside it, always in sight: it turns a fixed value into an expression keeping what was written, and back leaves the control empty; Ctrl+Z undoes either", async () => {});
  test.fixme("AU-21 · dragging a field from ENTRADA into a parameter writes its citation, painted as a chip with its step's icon and the field's name: of the step before, of an earlier step chosen in ENTRADA's header, and of a result («Suma de Importe», never its key); with two steps of the path that have a field of the same name the chip says the step too («Buscar gastos › Importe»); a citation of a step that is gone is a red chip", async () => {});
});

test.describe("against a sea of options", () => {
  test.fixme("AU-75 · every step type of the catalogue, with each of its actions, paints seven rows at most in «Parámetros» before «Añadir opción»: the rows are counted on the screen, type by type and action by action; a list is one row, and what is inside one of its entries is seen only once it is opened", async () => {});
  test.fixme("AU-76 · «Añadir opción» lists the options of the action that are not there yet; an added one is a row that can be taken away, and is then its default again; with none left the button is not there", async () => {});
  test.fixme("AU-78 · «Ajustes» has the same six rows in every step type: Si falla, Reintentar, Seguir sin filas, Solo la primera fila, Nota and Apagado", async () => {});
  test.fixme("AU-79 · every setting or option not at its default is a short label on the step's card («Si falla: seguir», «Reintenta 2 veces», «Sigue sin filas», «Solo la primera fila», «Nota», «Apagado», an option by its name), in a line under the summary, with the ones that do not fit joined in «+2», which says them on hover; the tab «Ajustes» counts what changed; the three that change the rows are said above SALIDA too; an off step's card is dimmed", async () => {});
  test.fixme("AU-81 · the conditions of «Filtrar», «Si», «Buscar filas», «Modificar filas» and «Eliminar filas» are the same control, the views' filter: «todas» by default, groups «y» or «o» of one level, operators by the field's type, and the value fixed or an expression", async () => {});
  test.fixme("AU-82 · changing a step's action keeps what the two share and a notice says what went, «Se quitó: Ordenar por, Límite · Deshacer»; its «Deshacer» brings it all back", async () => {});
  test.fixme("AU-83 · a required parameter left empty is not marked on opening the step; it is once Juan leaves it, and all of them are after «Probar» or «Probar paso», with the mark on the step's card too", async () => {});
  test.fixme("AU-84 · each empty, stale or failed state says what to do next: a list with nothing (with «Nueva»), an empty canvas, an ENTRADA with no data, a SALIDA never tested, a stale one, a failed step (with «Ir al parámetro», which opens that parameter), a search with nothing and a draft not saved", async () => {});
});

test.describe("testing", () => {
  test.fixme("AU-90 · «Probar» runs the whole draft and «Registro» says how it went and that it wrote nothing; the step that would write shows what it would do and the collection is as it was", async () => {});
  test.fixme("AU-91 · «Probar paso» tests that step and what it lacks: the steps before it that had not changed keep the time of their test, and the steps after it are not tested", async () => {});
  test.fixme("AU-92 · after a step changes, its SALIDA says «puede estar vieja» and the counts of its arrows and of what hangs from it are dimmed; moving it or renaming it marks nothing; testing it again clears the mark", async () => {});
  test.fixme("AU-94 · the fields a trigger asks are asked in the box of «Probar» and in the trigger's ENTRADA, with those of the last test filled in; a trigger with no fields starts without asking", async () => {});
});
