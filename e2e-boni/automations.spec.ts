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

/** Steps and arrows as the app writes them, for the automations of the canvas's tests. */
const step = (id: string, name: string, type: string, params: Record<string, unknown> = {}) => ({
  id,
  name,
  type,
  params,
});
const arrow = (from: string, to: string, output = "main") => ({
  from: { step: from, output },
  to: { step: to, input: "main" },
});
/** «Libros por leer»: a trigger and three steps in a row, each box where the server keeps it. */
const CHAIN = {
  id: "a_01jx8q4m6p8r0t2v4x6z8b0d2f",
  name: "Libros por leer",
  updated: 1761950000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual"),
    step("s_01jbuscar", "Buscar filas en Libros", "collection", {
      action: "find",
      collection: "libros",
      limit: 10,
    }),
    step("s_01jfiltrar", "Filtrar", "filter"),
    step("s_01jordenar", "Ordenar", "sort"),
  ],
  arrows: [
    arrow("s_inicio", "s_01jbuscar"),
    arrow("s_01jbuscar", "s_01jfiltrar"),
    arrow("s_01jfiltrar", "s_01jordenar"),
  ],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jbuscar", x: 300, y: 0 },
    { step: "s_01jfiltrar", x: 600, y: 0 },
    { step: "s_01jordenar", x: 900, y: 0 },
  ],
};
const CHAIN_IDS = CHAIN.steps.map((s) => s.id);
/** «Separar por estado»: a «Si» with both its outputs in use, and no box kept (Boni places them). */
const BRANCH = {
  id: "a_01jx8r5n7q9s1u3w5y7a9c1e3g",
  name: "Separar por estado",
  updated: 1761940000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual"),
    step("s_01jsi", "Si", "if"),
    step("s_01jfiltrar", "Filtrar", "filter"),
    step("s_01jordenar", "Ordenar", "sort"),
  ],
  arrows: [
    arrow("s_inicio", "s_01jsi"),
    arrow("s_01jsi", "s_01jfiltrar", "yes"),
    arrow("s_01jsi", "s_01jordenar", "no"),
  ],
};
const CANVAS = [...AUTOMATIONS, CHAIN, BRANCH];
const node = (page: Page, id: string) => page.locator(`[data-testid="rf__node-${id}"]`);
const card = (page: Page, id: string) => page.locator(`.auto-card[data-step="${id}"]`);
const cards = (page: Page) => page.locator(".auto-card");
const panel = (page: Page) => page.locator(".auto-panel");
const bar = (page: Page) => page.locator(".auto-bar");
/** Where a box is on the canvas, in the canvas's units (what the server keeps). */
const at = (page: Page, id: string) =>
  node(page, id).evaluate((el) => {
    const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
      (el as HTMLElement).style.transform,
    );
    return { x: Math.round(Number(m?.[1])), y: Math.round(Number(m?.[2])) };
  });
const placesOf = async (page: Page, ids: string[]) =>
  Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await at(page, id)] as const)));
/** Opens `name` from the list and waits for its canvas. */
async function openCanvas(page: Page, name: string, steps: number) {
  const rows = await list(page);
  await rows.getByText(name, { exact: true }).click();
  await expect(nameBox(page)).toHaveValue(name);
  await expect(cards(page)).toHaveCount(steps);
  return rows;
}
/** A person's drag: pressed, moved in small steps over about half a second, let go. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 25, from.y + ((to.y - from.y) * i) / 25);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}
const xy = (p: { x: number; y: number }) => [p.x, p.y] as const;
async function middle(l: ReturnType<Page["locator"]>) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not on the screen");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** The middle of the arrow from step `from` to step `to` on the screen, where a click selects it. */
const arrowMiddle = (page: Page, from: string, to: string) =>
  page
    .locator(
      `[data-testid^="rf__edge-${from}:"][data-testid*=">${to}:"] .react-flow__edge-interaction`,
    )
    .evaluate((el) => {
      const path = el as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM();
      const s = m ? p.matrixTransform(m) : p;
      return { x: s.x, y: s.y };
    });
/** The arrows of the canvas as "from>to" by step id, sorted. */
const arrowsSeen = (page: Page) =>
  page.locator(".react-flow__edge").evaluateAll((els) =>
    els
      .map((e) => {
        const id = (e.getAttribute("data-testid") ?? "").replace("rf__edge-", "");
        const [from, to] = id.split(">");
        return `${from?.split(":")[0]}>${to?.split(":")[0]}`;
      })
      .sort(),
  );
const cardNames = (page: Page) => page.locator(".auto-card-name").allTextContents();
type Sent = {
  steps: { id: string; name: string; type: string; params: Record<string, unknown> }[];
  arrows: ReturnType<typeof arrow>[];
};
/** The last draft sent of automation `id`. */
const lastDraft = async (page: Page, id: string) =>
  (await sent(page, `PUT api/agent/automations/${id}/draft `)).at(-1)?.automation as
    | Sent
    | undefined;
/** The boxes sent of automation `id`, one list per request. */
const layouts = async (page: Page, id: string) =>
  (await sent(page, `PUT api/agent/automations/${id}/layout `)).map(
    (b) => b.places as { step: string; x: number; y: number }[],
  );
/** Once the canvas has stopped moving (a fit is animated). */
const settled = async (page: Page) => {
  let last: string | null = null;
  await expect
    .poll(
      async () => {
        const now = await page.locator(".auto-flow .react-flow__viewport").getAttribute("style");
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [120] },
    )
    .toBe(true);
};
/** Chooses `name` in «Añadir un paso». */
const choose = (page: Page, name: string) =>
  panel(page).getByRole("button", { name, exact: true }).click();
const press = (page: Page, keys: string) => page.keyboard.press(keys);

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
    // The automation, then the box of its first step (AU-05): the server had none to keep before.
    await expect
      .poll(() => asked(page))
      .toEqual(["POST", expect.stringMatching(/^PUT a_\w+\/layout$/)]);
    const [made] = await sent(page, "POST api/agent/automations ");
    const first = made?.automation as { name: string; steps: { id: string; type: string }[] };
    expect(first.name).toBe("Nueva automatización");
    expect(first.steps.map((x) => x.type)).toEqual(["manual"]);
    const id = (await asked(page))[1]?.split(" ")[1]?.split("/")[0] as string;
    const [box] = await layouts(page, id);
    expect(box?.map((p) => p.step)).toEqual([first.steps[0]?.id]);
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

  test("AU-62 · on the canvas, the copy of «Duplicar» has each step of the original in the same place", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await expect
      .poll(() => placesOf(page, CHAIN_IDS))
      .toEqual(Object.fromEntries(CHAIN.places.map((p) => [p.step, { x: p.x, y: p.y }])));
    const was = await placesOf(page, CHAIN_IDS);
    await head(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Duplicar" }).click();
    await expect(nameBox(page)).toHaveValue("Libros por leer (copia)");
    await expect(cards(page)).toHaveCount(4);
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(was);
    await expect
      .poll(() => arrowsSeen(page))
      .toEqual(CHAIN.arrows.map((a) => `${a.from.step}>${a.to.step}`).sort());
  });
  test("AU-63 · the canvas reads left to right: each step a card of one width with its icon, its name and one line of summary, both cut with an ellipsis and whole on hover; the outputs on the right with their names; a canvas with only its trigger says nothing more", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // Left to right, in the order of the arrows.
    const xs = await Promise.all(CHAIN_IDS.map(async (id) => (await middle(card(page, id))).x));
    expect([...xs].sort((a, z) => a - z)).toEqual(xs);
    for (const id of CHAIN_IDS) {
      const c = card(page, id);
      expect(await c.evaluate((el) => getComputedStyle(el).width)).toBe("220px");
      await expect(c.locator(".auto-card-icon svg")).toHaveCount(1);
    }
    // The summary: the parameters in sight that have a value, in their order, « · » between them.
    const summary = card(page, "s_01jbuscar").locator(".auto-card-summary");
    await expect(summary).toHaveText("Libros · Límite 10");
    await expect(summary).toHaveAttribute("title", "Libros · Límite 10");
    // One line each, cut with an ellipsis; the whole text on hover (its title).
    const name = card(page, "s_01jbuscar").locator(".auto-card-name");
    await expect(name).toHaveAttribute("title", "Buscar filas en Libros");
    for (const line of [name, summary])
      expect(
        await line.evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.whiteSpace, s.textOverflow, s.overflow];
        }),
      ).toEqual(["nowrap", "ellipsis", "hidden"]);
    // A step not given a value says only its name.
    await expect(card(page, "s_01jfiltrar").locator(".auto-card-summary")).toHaveCount(0);
    // The only output says no name; a «Si» says «sí» and «no», on its right.
    await expect(card(page, "s_01jbuscar").locator(".auto-out-label")).toHaveCount(0);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Separar por estado", 4);
    const si = card(page, "s_01jsi");
    await expect(si.locator(".auto-out-label")).toHaveText(["sí", "no"]);
    const centre = (await middle(si)).x;
    for (const out of await si.locator(".auto-out").all())
      expect((await middle(out)).x).toBeGreaterThan(centre);
    await page.screenshot({ path: `${SHOTS}/automation-canvas.png` });
    // A canvas with only its trigger: its card, the «+» of its output and nothing else.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Revisar gastos", 1);
    await expect(page.locator(".auto-card-summary, .auto-out-label, .auto-start")).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await expect(
      card(page, "s_inicio").getByRole("button", { name: "Añadir un paso" }),
    ).toBeVisible();
  });
  test.fixme("AU-63 · the whole name and summary in the step's view, and the mark on the card of a step that lacks something required once the parameter is marked (D: the step's view, AU-83)", async () => {});
  test.fixme("AU-64 · bottom left: zoom in, zoom out, fit and «Ordenar»; bottom centre: «Probar»; top right: «+»; at the bottom «Registro», folded, with one line: «Sin probar», then the last test", async () => {});
  test.fixme("AU-64 · «Probar» with several triggers opens a menu to choose one, asks a trigger's fields in a small box with the last ones filled in, says «Probando…» and cannot be pressed meanwhile; with problems it tests nothing, marks each step and «Registro» says how many and leads to the first", async () => {});
  test("AU-65 · a step is added from the «+» of the top, the «+» of an output with no arrow (or dragging from it), the «+» of a selected arrow and a right click on the canvas: the four open the same panel, and the step chosen ends connected and selected", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    const selected = page.locator(".auto-card.selected");
    // The «+» of the top: connected to nothing.
    await page.locator(".auto-add-top").click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator("h3").first()).toHaveText("Leer o escribir en una colección");
    await choose(page, "Filtrar");
    await expect(panel(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(5);
    await expect(selected).toHaveCount(1);
    await expect(selected.locator(".auto-card-name")).toHaveText("Filtrar 2");
    await expect.poll(() => arrowsSeen(page)).toHaveLength(3);
    // The «+» of an output with no arrow: the new step hangs from it.
    await card(page, "s_01jordenar").getByRole("button", { name: "Añadir un paso" }).click();
    await expect(panel(page)).toBeVisible();
    await choose(page, "Ordenar");
    await expect(selected.locator(".auto-card-name")).toHaveText("Ordenar 2");
    const second = (await selected.getAttribute("data-step")) as string;
    await expect.poll(() => arrowsSeen(page)).toContain(`s_01jordenar>${second}`);
    // Dragging from that output and letting go on the canvas: the same panel, and the step hangs from it.
    const out = node(page, second).locator(".react-flow__handle.source");
    const from = await middle(out);
    await drag(page, from, { x: from.x + 160, y: from.y + 140 });
    await expect(panel(page)).toBeVisible();
    await choose(page, "Limitar");
    await expect(selected.locator(".auto-card-name")).toHaveText("Limitar");
    const third = (await selected.getAttribute("data-step")) as string;
    await expect.poll(() => arrowsSeen(page)).toContain(`${second}>${third}`);
    // The «+» of a selected arrow: the new step goes between its two ends.
    // (The step added was brought into sight: fitted again first, as Juan would.)
    await page.locator(".auto-zoom").getByRole("button", { name: "Encajar" }).click();
    await settled(page);
    await page.mouse.click(...xy(await arrowMiddle(page, "s_01jbuscar", "s_01jfiltrar")));
    const arrowBar = page.locator(".auto-arrow-bar");
    await expect(arrowBar).toBeVisible();
    await arrowBar.getByRole("button", { name: "Añadir un paso" }).click();
    await expect(panel(page)).toBeVisible();
    await choose(page, "Quitar duplicados");
    const between = (await selected.getAttribute("data-step")) as string;
    await expect.poll(() => arrowsSeen(page)).toContain(`s_01jbuscar>${between}`);
    const seen = await arrowsSeen(page);
    expect(seen).toContain(`${between}>s_01jfiltrar`);
    expect(seen).not.toContain("s_01jbuscar>s_01jfiltrar");
    // A right click on the canvas: connected to nothing, its box where the click was.
    const flow = await page.locator(".auto-flow").boundingBox();
    if (!flow) throw new Error("no canvas");
    const click = { x: flow.x + 120, y: flow.y + flow.height - 90 };
    await page.mouse.click(click.x, click.y, { button: "right" });
    await expect(panel(page)).toBeVisible();
    await choose(page, "Agrupar");
    const placed = await selected.boundingBox();
    expect(Math.abs((placed?.x ?? 0) - click.x)).toBeLessThan(4);
    expect(Math.abs((placed?.y ?? 0) - click.y)).toBeLessThan(4);
    const lone = (await selected.getAttribute("data-step")) as string;
    expect((await arrowsSeen(page)).some((a) => a.includes(lone))).toBe(false);
    // Each of them one change, saved as the draft.
    await expect(saved(page)).toHaveText("Guardado");
    expect((await lastDraft(page, CHAIN.id))?.steps).toHaveLength(9);
  });
  test.fixme("AU-65 · the step chosen ends open: its view opens as it is added (D: the step's view, AU-70)", async () => {});
  test("AU-66 · a selected step shows a short bar, Probar paso · Apagar · Eliminar · ⋯ (Cambiar nombre · Duplicar · Copiar); a selected arrow, «+» and delete; the right click on a step has seven things; nothing appears on hover; an off step says «Encender»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // Nothing on hover.
    await card(page, "s_01jfiltrar").hover();
    await page.waitForTimeout(300);
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator(".auto-arrow-bar")).toHaveCount(0);
    // Selected: the bar.
    await card(page, "s_01jfiltrar").click();
    await expect(bar(page).getByRole("button")).toHaveText([
      "Probar paso",
      "Apagar",
      "Eliminar",
      "",
    ]);
    await expect(bar(page).getByRole("button", { name: "Probar paso" })).toBeDisabled();
    await bar(page).getByRole("button", { name: "Más" }).click();
    await expect(page.locator(".pop-box .menu-item")).toHaveText([
      "Cambiar nombre",
      "Duplicar",
      "Copiar",
    ]);
    await page.screenshot({ path: `${SHOTS}/automation-step-bar.png` });
    await press(page, "Escape");
    // Off: dimmed, and the bar says «Encender».
    await bar(page).getByRole("button", { name: "Apagar" }).click();
    await expect(card(page, "s_01jfiltrar")).toHaveClass(/\boff\b/);
    await expect(bar(page).getByRole("button", { name: "Encender" })).toBeVisible();
    await expect(saved(page)).toHaveText("Guardado");
    const off = (await lastDraft(page, CHAIN.id))?.steps.find((s) => s.id === "s_01jfiltrar");
    expect((off as { settings?: { off?: boolean } } | undefined)?.settings?.off).toBe(true);
    // Two selected: no bar.
    await card(page, "s_01jordenar").click({ modifiers: ["Shift"] });
    await expect(page.locator(".auto-card.selected")).toHaveCount(2);
    await expect(bar(page)).toHaveCount(0);
    // The right click on a step: seven things, «Encender» on an off step.
    await card(page, "s_01jfiltrar").click({ button: "right" });
    await expect(page.locator(".pop-box .menu-item")).toHaveText([
      "Abrir",
      "Probar paso",
      "Encender",
      "Cambiar nombre",
      "Duplicar",
      "Copiar",
      "Eliminar",
    ]);
    await press(page, "Escape");
    await expect(page.locator(".pop-box")).toHaveCount(0);
    // A selected arrow: «+» and the cross.
    await page.mouse.click(...xy(await arrowMiddle(page, "s_inicio", "s_01jbuscar")));
    const arrowBar = page.locator(".auto-arrow-bar");
    await expect(arrowBar.getByRole("button")).toHaveCount(2);
    await expect(arrowBar.getByRole("button", { name: "Añadir un paso" })).toBeVisible();
    await arrowBar.getByRole("button", { name: "Quitar la flecha" }).click();
    await expect.poll(() => arrowsSeen(page)).not.toContain("s_inicio>s_01jbuscar");
  });
  test("AU-66 · deleting a step between two others joins them with one arrow; deleting one with two outputs in use takes its arrows", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await card(page, "s_01jbuscar").click();
    await bar(page).getByRole("button", { name: "Eliminar" }).click();
    await expect(cards(page)).toHaveCount(3);
    await expect
      .poll(() => arrowsSeen(page))
      .toEqual(["s_01jfiltrar>s_01jordenar", "s_inicio>s_01jfiltrar"]);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Separar por estado", 4);
    await card(page, "s_01jsi").click({ button: "right" });
    await page.getByRole("menuitemradio", { name: "Eliminar" }).click();
    await expect(cards(page)).toHaveCount(3);
    await expect.poll(() => arrowsSeen(page)).toEqual([]);
  });
  test("AU-68 · Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes a step added, removed, connected, moved and renamed; Ctrl+C, X and V copy, cut and paste the selected steps with the arrows between them; Supr deletes, Esc closes; what was undone is saved; a key typed in a field is the field's; after a reload there is nothing to undo", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    const chain = CHAIN.arrows.map((a) => `${a.from.step}>${a.to.step}`).sort();
    // Removed with Supr, joined; undone and redone both ways.
    await card(page, "s_01jfiltrar").click();
    await press(page, "Delete");
    await expect(cards(page)).toHaveCount(3);
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(4);
    await expect.poll(() => arrowsSeen(page)).toEqual(chain);
    await press(page, "Control+Shift+z");
    await expect(cards(page)).toHaveCount(3);
    await press(page, "Control+z");
    await press(page, "Control+y");
    await expect(cards(page)).toHaveCount(3);
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(4);
    // Added.
    await page.locator(".auto-add-top").click();
    await choose(page, "Filtrar");
    await expect(cards(page)).toHaveCount(5);
    await page.locator(".auto-flow .react-flow__pane").click({ position: { x: 20, y: 20 } });
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(4);
    // Moved (the step added was brought into sight: fitted again first, as Juan would).
    await page.locator(".auto-zoom").getByRole("button", { name: "Encajar" }).click();
    await settled(page);
    const was = await at(page, "s_01jbuscar");
    const c = await middle(card(page, "s_01jbuscar"));
    await drag(page, c, { x: c.x + 40, y: c.y + 120 });
    await expect.poll(() => at(page, "s_01jbuscar")).not.toEqual(was);
    await press(page, "Control+z");
    await expect.poll(() => at(page, "s_01jbuscar")).toEqual(was);
    // Renamed.
    await card(page, "s_01jordenar").click({ button: "right" });
    await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
    const box = page.getByRole("textbox", { name: "Cambiar nombre" });
    await box.fill("Ordenar por título");
    await box.press("Enter");
    await expect(card(page, "s_01jordenar").locator(".auto-card-name")).toHaveText(
      "Ordenar por título",
    );
    await press(page, "Control+z");
    await expect(card(page, "s_01jordenar").locator(".auto-card-name")).toHaveText("Ordenar");
    // Disconnected and connected again by dragging from an output to an input.
    await page.mouse.click(...xy(await arrowMiddle(page, "s_01jfiltrar", "s_01jordenar")));
    await page.locator(".auto-arrow-bar").getByRole("button", { name: "Quitar la flecha" }).click();
    await expect.poll(() => arrowsSeen(page)).toHaveLength(2);
    await drag(
      page,
      await middle(node(page, "s_01jfiltrar").locator(".react-flow__handle.source")),
      await middle(node(page, "s_01jordenar").locator(".react-flow__handle.target")),
    );
    await expect.poll(() => arrowsSeen(page)).toEqual(chain);
    await press(page, "Control+z");
    await expect.poll(() => arrowsSeen(page)).toHaveLength(2);
    await press(page, "Control+z");
    await expect.poll(() => arrowsSeen(page)).toEqual(chain);
    // What was undone is saved: the draft as it was opened.
    await expect(saved(page)).toHaveText("Guardado");
    const back = await lastDraft(page, CHAIN.id);
    expect(back?.steps).toEqual(CHAIN.steps);
    expect(back?.arrows).toEqual(CHAIN.arrows);
    // Copied and pasted, with the arrow between them, under the pointer; names that are taken get a number.
    await card(page, "s_01jbuscar").click();
    await card(page, "s_01jfiltrar").click({ modifiers: ["Shift"] });
    await press(page, "Control+c");
    const flow = await page.locator(".auto-flow").boundingBox();
    if (!flow) throw new Error("no canvas");
    await page.mouse.move(flow.x + flow.width / 2, flow.y + flow.height - 120);
    await press(page, "Control+v");
    await expect(cards(page)).toHaveCount(6);
    await expect
      .poll(() => cardNames(page))
      .toEqual(expect.arrayContaining(["Buscar filas en Libros 2", "Filtrar 2"]));
    const pasted = await page
      .locator(".auto-card.selected")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-step") as string));
    expect(pasted).toHaveLength(2);
    await expect.poll(() => arrowsSeen(page)).toContain(`${pasted[0]}>${pasted[1]}`);
    // Cut: gone, and pasted again.
    await press(page, "Control+x");
    await expect(cards(page)).toHaveCount(4);
    await press(page, "Control+v");
    await expect(cards(page)).toHaveCount(6);
    // Esc closes: the menu, the panel, then what is selected.
    await page.locator(".auto-add-top").click();
    await expect(panel(page)).toBeVisible();
    await press(page, "Escape");
    await expect(panel(page)).toHaveCount(0);
    await press(page, "Escape");
    await expect(page.locator(".auto-card.selected")).toHaveCount(0);
    // A key typed in a field is the field's.
    await nameBox(page).click();
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(6);
    // After a reload there is nothing to undo.
    await expect(saved(page)).toHaveText("Guardado");
    await page.reload();
    await openCanvas(page, "Libros por leer", 4);
    const before = (await asked(page)).length;
    await page.locator(".auto-flow .react-flow__pane").click({ position: { x: 20, y: 20 } });
    await press(page, "Control+z");
    await page.waitForTimeout(1500);
    await expect(cards(page)).toHaveCount(4);
    expect((await asked(page)).slice(before)).toEqual([]);
  });
  test("AU-68 · steps copied in one automation are pasted in another, with new ids and the arrows between them", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await card(page, "s_01jbuscar").click();
    await card(page, "s_01jfiltrar").click({ modifiers: ["Shift"] });
    await press(page, "Control+c");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Revisar gastos", 1);
    await page.locator(".auto-flow .react-flow__pane").click({ position: { x: 40, y: 40 } });
    await press(page, "Control+v");
    await expect(cards(page)).toHaveCount(3);
    const pasted = await page
      .locator(".auto-card.selected")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-step") as string));
    expect(pasted).toHaveLength(2);
    expect(pasted).not.toContain("s_01jbuscar");
    expect(pasted).not.toContain("s_01jfiltrar");
    await expect.poll(() => arrowsSeen(page)).toEqual([`${pasted[0]}>${pasted[1]}`]);
    await expect
      .poll(() => cardNames(page))
      .toEqual(expect.arrayContaining(["Buscar filas en Libros", "Filtrar"]));
  });
  test.fixme("AU-68 · Ctrl+Z undoes a parameter or a setting changed in the step's view, and Intro opens the selected step (D: the step's view, AU-70)", async () => {});
  test("AU-05 · a box stays where it is dropped, opened again too, and moving it does not say «Guardando…» nor send the draft; a new step goes to the right of the one it hangs from and no other box moves; «Ordenar» moves them all and Ctrl+Z puts them back", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    const rows = await openCanvas(page, "Libros por leer", 4);
    await expect(saved(page)).toHaveText("Guardado");
    const c = await middle(card(page, "s_01jfiltrar"));
    await drag(page, c, { x: c.x + 30, y: c.y + 150 });
    await expect.poll(async () => (await at(page, "s_01jfiltrar")).y).toBeGreaterThan(100);
    const dropped = await at(page, "s_01jfiltrar");
    // Never «Guardando…»: the draft did not change. One request when it is dropped, with that box alone.
    await expect(saved(page)).toHaveText("Guardado");
    await expect
      .poll(() => layouts(page, CHAIN.id))
      .toEqual([[{ step: "s_01jfiltrar", ...dropped }]]);
    await page.waitForTimeout(1500);
    expect(await sent(page, `PUT api/agent/automations/${CHAIN.id}/draft `)).toEqual([]);
    expect(await layouts(page, CHAIN.id)).toHaveLength(1);
    // Opened again: where it was dropped.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await rows.getByText("Libros por leer", { exact: true }).click();
    await expect(cards(page)).toHaveCount(4);
    await expect.poll(() => at(page, "s_01jfiltrar")).toEqual(dropped);
    // A new step: to the right of the one it hangs from, at its height; no other box moves.
    const before = await placesOf(page, CHAIN_IDS);
    await card(page, "s_01jordenar").getByRole("button", { name: "Añadir un paso" }).click();
    await choose(page, "Limitar");
    const made = (await page.locator(".auto-card.selected").getAttribute("data-step")) as string;
    await expect
      .poll(() => at(page, made))
      .toEqual({
        x: before.s_01jordenar.x + 300,
        y: before.s_01jordenar.y,
      });
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(before);
    // Its box is kept like one dropped, once the server has the step.
    await expect
      .poll(async () => (await layouts(page, CHAIN.id)).at(-1))
      .toEqual([{ step: made, x: before.s_01jordenar.x + 300, y: before.s_01jordenar.y }]);
    // «Ordenar» places them all again; Ctrl+Z puts them back.
    const all = [...CHAIN_IDS, made];
    const untidy = await placesOf(page, all);
    await page.locator(".auto-zoom").getByRole("button", { name: "Ordenar" }).click();
    await expect.poll(() => at(page, "s_01jfiltrar")).not.toEqual(dropped);
    const tidy = await placesOf(page, all);
    expect(new Set(Object.values(tidy).map((p) => p.y)).size).toBe(1);
    await press(page, "Control+z");
    await expect.poll(() => placesOf(page, all)).toEqual(untidy);
    await expect(saved(page)).toHaveText("Guardado");
  });
  test.fixme("AU-05 · over the real server, a box dropped is there after a reload and in another window, (G: the desktop app); moving it ages no test (E: AU-92)", async () => {});
  test("AU-87 · adding a step puts that step and nothing else: no other step, arrow or option appears, and nothing changes on the canvas that Juan did not do", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // Opened and left alone: nothing is sent, nothing moves.
    const opened = await placesOf(page, CHAIN_IDS);
    await page.waitForTimeout(1500);
    expect(await asked(page)).toEqual([`GET ${CHAIN.id}`]);
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(opened);
    // One step added: that step, its one arrow, and nothing else.
    await card(page, "s_01jordenar").getByRole("button", { name: "Añadir un paso" }).click();
    await choose(page, "Filtrar");
    await expect(saved(page)).toHaveText("Guardado");
    const after = await lastDraft(page, CHAIN.id);
    expect(after?.steps.slice(0, 4)).toEqual(CHAIN.steps);
    expect(after?.steps).toHaveLength(5);
    const made = after?.steps[4];
    expect(made).toEqual({ id: made?.id, name: "Filtrar 2", type: "filter", params: {} });
    expect(after?.arrows).toEqual([...CHAIN.arrows, arrow("s_01jordenar", made?.id as string)]);
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(opened);
    // A step of «Colección» carries its action and nothing more.
    await page.locator(".auto-add-top").click();
    await choose(page, "Buscar filas");
    await expect(saved(page)).toHaveText("Guardado");
    expect((await lastDraft(page, CHAIN.id))?.steps.at(-1)?.params).toEqual({ action: "find" });
  });
  test.fixme("AU-67 · after a test each arrow says how many rows passed («128 filas»; «0 filas» dimmed), an output with no arrow its count too, and each step how it ended (bien, falló, saltado, parado); a step that failed says why on its card in two lines at most, whole in its SALIDA with «Ir al parámetro», and in «Registro»; the ones that hung from it are «saltados»", async () => {});
});

test.describe("adding a step", () => {
  test("AU-69 · the panel is on the right with its search on top: on an empty canvas it asks «¿Cómo empieza?» and lists the triggers; then the three categories of F14b by what one wants to do, and «Añadir otro disparador» last; «Colección» shows its actions as phrases", async ({
    page,
  }) => {
    await openApp(page, "/?still", { agent: BEFORE() });
    await list(page);
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    // On an empty canvas: «¿Cómo empieza?» and the triggers, at the right, the search on top.
    const p = panel(page);
    await expect(p.locator("h2")).toHaveText("¿Cómo empieza?");
    await expect(p.locator(".auto-start-row")).toHaveText(["Disparado por el usuario"]);
    await expect(
      p.locator("> *").first().getByRole("textbox", { name: "Buscar un paso" }),
    ).toBeVisible();
    const canvas = await page.locator(".auto-canvas").boundingBox();
    const side = await p.boundingBox();
    expect(
      Math.abs((side?.x ?? 0) + (side?.width ?? 0) - ((canvas?.x ?? 0) + (canvas?.width ?? 0))),
    ).toBeLessThan(2);
    await p.getByRole("button", { name: "Disparado por el usuario" }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(panel(page)).toHaveCount(0);
    // Then: the three categories, said by what one wants to do, each step in one; «Añadir otro disparador» last.
    await page.locator(".auto-add-top").click();
    await expect(p.locator("h3")).toHaveText([
      "Leer o escribir en una colección",
      "Transformar filas",
      "Decidir el camino",
    ]);
    const all = await p.locator(".auto-start-row").allTextContents();
    expect(new Set(all).size).toBe(all.length);
    await expect(p.locator(".auto-panel-section").first().locator(".auto-start-row")).toHaveText([
      "Buscar filas",
      "Leer una fila",
      "Crear una fila",
      "Modificar filas",
      "Crear o modificar",
      "Eliminar filas",
      "Contar o sumar",
    ]);
    await expect(p.locator("> *").last()).toHaveText("Añadir otro disparador");
    await page.screenshot({ path: `${SHOTS}/automation-add.png` });
    await p.getByRole("button", { name: "Añadir otro disparador" }).click();
    await expect(p.locator(".auto-start-row")).toHaveText(["Disparado por el usuario"]);
  });
  test("AU-69 · the search looks in every category at once by a step's name and its actions', and with nothing found says «Nada con «…»»; under 1100 px the panel goes over the canvas", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await page.locator(".auto-add-top").click();
    const find = panel(page).getByRole("textbox", { name: "Buscar un paso" });
    await expect(find).toBeFocused();
    // By a step's name, in every category at once.
    await find.pressSequentially("una", { delay: 60 });
    const rows = panel(page).locator(".auto-start-row");
    await expect(rows).toContainText(["Leer una fila", "Crear una fila", "Separar una lista"]);
    await expect(panel(page).locator("h3")).toHaveCount(0);
    // By an action's name: «Diferencia» is an action of «Fecha».
    await find.fill("");
    await find.pressSequentially("diferencia", { delay: 60 });
    await expect(rows).toHaveText(["Fecha"]);
    // Nothing found.
    await find.fill("");
    await find.pressSequentially("zzz", { delay: 60 });
    await expect(rows).toHaveCount(0);
    await expect(panel(page)).toContainText("Nada con «zzz»");
    // Under 1100 px: over the canvas, which keeps its width.
    await page.setViewportSize({ width: 1000, height: 800 });
    const flow = await page.locator(".auto-flow").boundingBox();
    const canvas = await page.locator(".auto-canvas").boundingBox();
    const over = await panel(page).boundingBox();
    expect(Math.abs((flow?.width ?? 0) - (canvas?.width ?? 0))).toBeLessThan(3);
    expect(over?.x ?? 0).toBeLessThan((flow?.x ?? 0) + (flow?.width ?? 0));
    // Nothing goes sideways, down to a phone's width.
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 });
      // Once the layout has followed the new width.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
    }
  });
  test("AU-86 · a new step is named by what it does («Buscar filas», «Buscar filas en Libros» with its collection); a second «Filtrar» is «Filtrar 2»; a step renamed keeps its name", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // A collection's step named with it, as the server keeps it.
    await expect(card(page, "s_01jbuscar").locator(".auto-card-name")).toHaveText(
      "Buscar filas en Libros",
    );
    // New: by its action, with no collection yet; a name taken gets a number.
    await page.locator(".auto-add-top").click();
    await choose(page, "Buscar filas");
    await expect(page.locator(".auto-card.selected .auto-card-name")).toHaveText("Buscar filas");
    await page.locator(".auto-add-top").click();
    await choose(page, "Filtrar");
    const second = page.locator(".auto-card.selected");
    await expect(second.locator(".auto-card-name")).toHaveText("Filtrar 2");
    // Renamed on its card from «⋯»: the new name, saved; Esc leaves it as it was.
    await bar(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
    const box = page.getByRole("textbox", { name: "Cambiar nombre" });
    await expect(box).toBeFocused();
    await box.fill("Solo los pendientes");
    await box.press("Escape");
    await expect(second.locator(".auto-card-name")).toHaveText("Filtrar 2");
    await bar(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
    await box.pressSequentially("Solo los pendientes", { delay: 40 });
    await box.press("Enter");
    await expect(second.locator(".auto-card-name")).toHaveText("Solo los pendientes");
    await expect(saved(page)).toHaveText("Guardado");
    expect((await lastDraft(page, CHAIN.id))?.steps.map((s) => s.name)).toEqual([
      "Disparado por el usuario",
      "Buscar filas en Libros",
      "Filtrar",
      "Ordenar",
      "Buscar filas",
      "Solo los pendientes",
    ]);
  });
  test.fixme("AU-86 · the name follows the step's collection, chosen in its view, until Juan renames it (D: the step's view); renaming a step changes the chips that cite it (F: AU-21)", async () => {});
  test("A-15 · with 200 steps, dragging a box, adding a step and «Ordenar» keep the canvas moving", async ({
    page,
  }, info) => {
    // A long automation: a trigger and 199 steps in a row, as Boni would place them.
    const many = Array.from({ length: 200 }, (_, i) =>
      i === 0
        ? step("s_inicio", "Disparado por el usuario", "manual")
        : step(`s_01jpaso${String(i).padStart(4, "0")}`, `Filtrar ${i + 1}`, "filter"),
    );
    const long = {
      id: "a_01jx8s6p8r0t2v4x6z8b0d2f4h",
      name: "Doscientos pasos",
      updated: 1761990000000,
      steps: many,
      arrows: many.slice(1).map((s, i) => arrow(many[i]?.id as string, s.id)),
    };
    await openApp(page, "/?still", { automations: [long], agent: BEFORE() });
    const rows = await list(page);
    await rows.getByText("Doscientos pasos", { exact: true }).click();
    await expect(cards(page)).toHaveCount(200);
    // The frames while a box is dragged at a person's pace.
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __run: boolean };
      w.__frames = [];
      w.__run = true;
      const tick = (t: number) => {
        w.__frames.push(t);
        if (w.__run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const c = await middle(card(page, "s_inicio"));
    await drag(page, c, { x: c.x + 60, y: c.y + 200 });
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __run: boolean };
      w.__run = false;
      return w.__frames.slice(1).map((t, i) => t - (w.__frames[i] as number));
    });
    const worst = Math.max(...frames);
    const mean = frames.reduce((a, z) => a + z, 0) / frames.length;
    // A click and its change drawn: adding a step and «Ordenar».
    const timed = async (act: () => Promise<void>, done: () => Promise<void>) => {
      const t0 = Date.now();
      await act();
      await done();
      return Date.now() - t0;
    };
    const adding = await timed(
      async () => {
        await page.locator(".auto-add-top").click();
        await choose(page, "Limitar");
      },
      () => expect(cards(page)).toHaveCount(201),
    );
    const tidying = await timed(
      () => page.locator(".auto-zoom").getByRole("button", { name: "Ordenar" }).click(),
      () => expect.poll(() => at(page, "s_inicio")).toEqual({ x: 0, y: 0 }),
    );
    info.annotations.push({
      type: "A-15",
      description: `200 steps: drag ${frames.length} frames, mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms; adding a step ${adding} ms; «Ordenar» ${tidying} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    expect(mean).toBeLessThan(50);
    expect(adding).toBeLessThan(2000);
    expect(tidying).toBeLessThan(2000);
  });
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
