import { mkdirSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { PROPOSALS } from "./agent-scenarios.ts";
import { EXAMPLES, emit, openApp, recorded } from "./fixtures.ts";

/**
 * The phone (narrower than 640 px; the Android app), made for the phone (docs/design-guide.md, «El móvil»): four
 * places below, a + button for capturing and creating, large titles, lists for a thumb, sheets from below. A
 * phone-sized touch screen; taps and swipes are real touches (Chromium turns them into pointer events with
 * pointerType "touch", as the Android WebView does).
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

const body = (request: string) => JSON.parse(request.split(" ").slice(2).join(" "));
const sent = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));
/** The sheet a form or an editor opens in. */
const sheet = (page: Page) => page.locator(".m-sheet");
/** A sheet from below: «Crear», a row's menu, a note's properties. */
const below = (page: Page) => page.locator(".m-bottom-sheet");
const title = (page: Page) => page.locator(".m-large h1");
const tab = (page: Page, name: string) =>
  page
    .locator(".m-tabs")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .tap();
const create = async (page: Page) => {
  await page.locator(".m-fab").tap();
  await expect(below(page).locator(".m-sheet-head h2")).toHaveText("Crear");
};
const height = async (el: Locator) => (await el.boundingBox())!.height;
const PERSON = JSON.parse(EXAMPLES["options-people.json"]!).options[0];

/** A finger on the screen (the DevTools protocol's touches): it slides `dx` px, or stays `holdMs` and lifts. */
async function touch(page: Page, el: Locator, o: { dx?: number; holdMs?: number }) {
  const b = (await el.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const x = b.x + b.width - 40;
  const y = b.y + b.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  if (o.holdMs) await page.waitForTimeout(o.holdMs);
  for (let i = 1; o.dx && i <= 10; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + ((o.dx ?? 0) * i) / 10, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const TODAY = [
  {
    id: "r2",
    type: "t_libro",
    collection: "Libros",
    title: "Ficciones",
    start: null,
    task: false,
    done: false,
    doneField: null,
  },
  {
    id: "r1",
    type: "t_libro",
    collection: "Libros",
    title: "Rayuela",
    start: "10:00",
    task: true,
    done: false,
    doneField: "f_fav",
  },
];

test("the phone opens on Inicio: the day, what waits, today and the charts; four places and a + button", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    today: TODAY,
    agent: { "GET api/agent/proposals": [PROPOSALS] },
  });
  await expect(page.locator(".m-app")).toBeVisible();
  await expect(page.locator(".sidebar, .dashboard")).toHaveCount(0);
  await expect(title(page)).toHaveText("Inicio");
  await expect(page.locator(".m-large-sub")).not.toBeEmpty();
  await expect(page.locator(".m-tab-label")).toHaveText(["Inicio", "Páginas", "Boni", "Bandeja"]);
  // What waits: on Inicio, and counted on its tab.
  await expect(page.locator(".m-banner")).toHaveText("2 esperan en la Bandeja");
  await expect(page.locator(".m-tabs").getByRole("button", { name: "Bandeja (2)" })).toBeVisible();
  // Today in the calendars: all day first, then by the hour, a task with its box.
  const today = page.locator("section", { hasText: "Hoy" }).locator(".m-item");
  await expect(today).toHaveCount(2);
  await expect(today.nth(0)).toContainText("Todo el día · Libros");
  await expect(today.nth(1)).toContainText("10:00 · Libros");
  await expect(today.nth(0).locator(".m-tick")).toHaveCount(0);
  await expect(page.locator(".m-chart-row")).toHaveCount(3);
  await expect(page.locator(".m-chart-row").first()).toContainText("€");
  // Thumb-sized: the tabs, the + button and each row are at least 48 px high.
  for (const el of [page.locator(".m-tab").first(), page.locator(".m-fab"), today.first()])
    expect(await height(el)).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: `${SHOTS}/phone-home.png` });
  // A task of today ticked: at once, on the server, and Undo takes it back.
  await today.nth(1).getByRole("button", { name: "Hecha" }).tap();
  await expect(today.nth(1).locator(".m-tick")).toHaveAttribute("aria-pressed", "true");
  expect(body((await sent(page, "PUT api/data/rows/r1"))[0]!)).toMatchObject({
    values: { f_fav: true },
  });
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).tap();
  await expect(today.nth(1).locator(".m-tick")).toHaveAttribute("aria-pressed", "false");
});

test("a server older than «Hoy»: Inicio without it", async ({ page }) => {
  await openApp(page, "/?still", { today: null });
  await expect(title(page)).toHaveText("Inicio");
  await expect(page.locator(".m-chart-row")).toHaveCount(3);
  await expect(page.locator("section", { hasText: "Hoy" })).toHaveCount(0);
});

test("«Páginas» on the phone: the search, the pages and the collections; a collection as a list; Back a step at a time", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await tab(page, "Páginas");
  await expect(title(page)).toHaveText("Páginas");
  await expect(page.locator(".m-searchbar")).toHaveText("Buscar");
  const libros = page.locator(".m-item-main", { hasText: "Libros" });
  await expect(libros).toContainText("3");
  await page.screenshot({ path: `${SHOTS}/phone-pages.png` });
  // A collection: its records one under another, two lines each (its title; its date and its state).
  await libros.tap();
  await expect(title(page)).toHaveText("Libros");
  const rows = page.locator(".m-swipe-row");
  await expect(rows).toHaveCount(3);
  expect(await height(rows.first())).toBeGreaterThanOrEqual(48);
  await expect(rows.filter({ hasText: "Ficciones" }).locator(".m-item-sub")).toContainText("Leído");
  // A collection that keeps no tasks has no boxes to tick nor what to see.
  await expect(page.locator(".m-tick, .m-chips")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/phone-collection.png` });
  // A record to read; Back to the list, Back to «Páginas».
  await rows.filter({ hasText: "Rayuela" }).locator(".m-item-main").tap();
  await expect(page.locator(".row-doc")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(title(page)).toHaveText("Libros");
  await page.keyboard.press("Escape");
  await expect(title(page)).toHaveText("Páginas");
  // The search opens the same finder as Ctrl+K.
  await page.locator(".m-searchbar").tap();
  await expect(page.locator(".find-box")).toBeVisible();
});

test("a list for a thumb: a swipe shows delete (with Undo), a long press its menu", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await tab(page, "Páginas");
  await page.locator(".m-item-main", { hasText: "Libros" }).tap();
  const row = page.locator(".m-swipe", { hasText: "Pedro Páramo" });
  await touch(page, row.locator(".m-swipe-row"), { dx: -160 });
  await expect(row.getByRole("button", { name: "Eliminar" })).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/phone-swipe.png` });
  // A person's finger reaches the button a moment later (Chrome takes no tap while a swipe's fling settles).
  await page.waitForTimeout(500);
  await row.getByRole("button", { name: "Eliminar" }).tap();
  await expect(page.locator(".m-swipe-row")).toHaveCount(2);
  expect(await sent(page, "DELETE api/data/rows/r3")).toHaveLength(1);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).tap();
  await expect(page.locator(".m-swipe-row")).toHaveCount(3);
  // Held down: its menu from below, and the touch opens nothing else.
  await touch(page, page.locator(".m-swipe-row", { hasText: "Rayuela" }), { holdMs: 700 });
  await expect(below(page).locator(".m-sheet-head h2")).toHaveText("Rayuela");
  await expect(below(page).locator(".m-item-title")).toHaveText(["Abrir", "Eliminar"]);
  await expect(page.locator(".row-doc")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(below(page)).toHaveCount(0);
});

test("a note on the phone: its properties as chips, all in a sheet; «…»; a bar over the keyboard", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await tab(page, "Páginas");
  await page.locator(".m-item-main", { hasText: "Libros" }).tap();
  await page.locator(".m-swipe-row", { hasText: "Rayuela" }).locator(".m-item-main").tap();
  await expect(page.locator(".row-doc")).toBeVisible();
  // What it holds, as chips under its title; «Propiedades» opens them all, the empty ones too.
  const chips = page.locator(".m-row-chips .m-chip");
  await expect(chips).toHaveText(["Leyendo", "600", "Propiedades"]);
  await chips.last().tap();
  await expect(below(page).locator(".row-prop-name")).toHaveText([
    "Estado",
    "Páginas",
    "Terminado",
    "Favorito",
  ]);
  await page.screenshot({ path: `${SHOTS}/phone-note-props.png` });
  await page.keyboard.press("Escape");
  await expect(below(page)).toHaveCount(0);
  // «…»: what the desktop has around it.
  await page.locator(".m-top").getByRole("button", { name: "Más" }).tap();
  await expect(page.getByRole("menuitem")).toHaveText(["Historial", "Mover a la papelera"]);
  await page.keyboard.press("Escape");
  // Writing: a bar over the keyboard, and the tab bar and the + button step aside.
  const first = page.locator(".row-doc textarea.blk-input").first();
  await first.tap();
  await expect(page.locator(".m-keybar")).toBeVisible();
  await expect(page.locator(".m-tabs")).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/phone-note-writing.png` });
  await page.locator(".m-keybar").getByRole("button", { name: "Lista" }).tap();
  await expect(first).toHaveAttribute("aria-label", "Lista");
  await page.locator(".m-keybar").getByRole("button", { name: "Listo" }).tap();
  await expect(page.locator(".m-keybar")).toHaveCount(0);
  await expect(page.locator(".m-tabs")).toBeVisible();
});

test("the + button: «Crear» with capturing first (the server's buttons, the shortcuts), then something new", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await create(page);
  const s = below(page);
  await expect(s.locator(".m-capture")).toHaveText("Apuntar gasto");
  const shortcuts = s.locator(".m-shortcut");
  await expect(shortcuts).toHaveCount(2);
  await expect(shortcuts.first()).toContainText("Café");
  await expect(shortcuts.first().locator(".m-shortcut-sub")).toHaveText(
    "1,60 € · Cafe · bebida/cafe",
  );
  await expect(s.locator(".m-group .m-item-title")).toHaveText([
    "Página",
    "En una colección…",
    "Subir un archivo",
  ]);
  for (const el of [s.locator(".m-capture"), shortcuts.first()])
    expect(await height(el)).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: `${SHOTS}/phone-create.png` });
  await page.keyboard.press("Escape");
  await expect(s).toHaveCount(0);
  // Inside a collection the + makes a record there and opens it.
  await tab(page, "Páginas");
  await page.locator(".m-item-main", { hasText: "Libros" }).tap();
  await page.getByRole("button", { name: "Nuevo aquí" }).tap();
  await expect(page.locator(".row-doc")).toBeVisible();
  expect(await sent(page, "POST api/data/types/t_libro/rows")).toHaveLength(1);
});

test("a capture in a sheet: required fields first, the rest folded; sent once; its toast makes it a shortcut", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await create(page);
  await below(page).locator(".m-capture").tap();
  const s = sheet(page);
  await expect(s.locator(".m-title")).toHaveText("Apuntar gasto");
  await expect(s.getByLabel("Concepto")).toHaveCount(0); // folded
  await s.getByRole("button", { name: "Más detalles (4)" }).tap();
  await expect(s.getByLabel("Concepto")).toBeVisible();
  await s.getByLabel("Importe").tap();
  await page.keyboard.type("12,5", { delay: 60 });
  const category = s.locator(".field", { hasText: "Categor" }).locator("input");
  await category.tap();
  await page.keyboard.type(PERSON.label.slice(0, 3), { delay: 60 });
  await s.getByRole("option").first().tap();
  await s.getByLabel("Concepto").tap();
  await page.keyboard.type("Menú del día", { delay: 30 });
  // the buttons stay at the bottom of the screen
  const foot = (await s.locator(".form-foot").boundingBox())!;
  expect(foot.y + foot.height).toBeGreaterThan(860 - 4);
  await page.screenshot({ path: `${SHOTS}/phone-form.png` });
  await s.getByRole("button", { name: "Guardar", exact: true }).tap();
  await expect(s).toHaveCount(0);
  const actions = await sent(page, "POST api/v1/actions");
  expect(actions).toHaveLength(1);
  expect(body(actions[0]!).values).toMatchObject({ amount: 12.5, concept: "Menú del día" });

  // "Save as shortcut" from the toast: the editor starts from what was captured, without the date
  await page.locator(".toast").getByRole("button", { name: "Guardar como atajo" }).tap();
  await expect(s.locator(".m-title")).toHaveText("Nuevo atajo");
  await expect(s.getByLabel("Nombre")).toHaveValue("Menú del día");
  await expect(s.getByLabel("Importe")).toHaveValue("12,5");
  await s.getByRole("button", { name: "Guardar directamente" }).tap();
  await s.getByRole("button", { name: "Crear atajo" }).tap();
  await expect(s).toHaveCount(0);
  const created = body((await sent(page, "POST api/v1/shortcuts"))[0]!);
  expect(created).toMatchObject({
    label: "Menú del día",
    screen: "capture-expense",
    mode: "save",
    values: { amount: 12.5, concept: "Menú del día", category: PERSON.value },
  });
  expect(created.values).not.toHaveProperty("date");
  await expect(page.locator(".toast")).toHaveText("Atajo creado");
});

test("a shortcut that saves at once is counted at once and its Undo takes it out", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await create(page);
  await page.locator(".m-shortcut-main", { hasText: "Café" }).tap();
  await expect(page.locator(".toast")).toContainText("«Café» apuntado");
  const posted = await sent(page, "POST api/v1/actions");
  expect(posted).toHaveLength(1);
  const id = body(posted[0]!).client_id as string;
  const values = body(posted[0]!).values;
  expect(values).toMatchObject({
    kind: "gasto",
    amount: 1.6,
    account: "efectivo",
    category: "bebida/cafe",
  });
  expect(values.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).tap();
  await expect(page.locator(".toast")).toContainText("Deshecho: ya no cuenta");
  expect(await sent(page, `DELETE api/v1/actions/${id}`)).toHaveLength(1);
});

test("without a connection a shortcut that saves at once waits for its Undo; one that opens fills the form", async ({
  page,
}) => {
  await openApp(page, "/?still", { action: "offline" });
  await create(page);
  await page.locator(".m-shortcut-main", { hasText: "Café" }).tap();
  await expect(page.locator(".toast")).toContainText("Apuntando «Café»…");
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).tap();
  await page.waitForTimeout(6500);
  // Only the first attempt reached the network; undone, nothing waits to be sent.
  expect(await sent(page, "POST api/v1/actions")).toHaveLength(1);
  await expect(page.locator(".m-status")).toHaveCount(0);

  // "open": the form with the shortcut's values; what it fills in is not folded
  await create(page);
  await page.locator(".m-shortcut-main", { hasText: "Comida con Pablo" }).tap();
  const s = sheet(page);
  await expect(s.locator(".m-title")).toHaveText("Comida con Pablo");
  await expect(s.locator(".picked-chip")).toHaveText("Pablo Soler Gil");
  await expect(s.getByRole("checkbox")).toBeChecked();
  await expect(s.getByLabel("Concepto")).toHaveCount(0);
});

test("a shortcut that cannot be saved as it is opens the form instead", async ({ page }) => {
  await openApp(page, "/?still", {
    files: {
      "shortcuts.json": JSON.stringify({
        shortcuts: [
          { id: "x", label: "Taxi", screen: "capture-expense", mode: "save", values: {} },
        ],
      }),
      "screens.json": JSON.stringify({
        "capture-expense": JSON.parse(EXAMPLES["screen-capture-expense.json"]!),
      }),
    },
    offline: true,
  });
  await create(page);
  await page.locator(".m-shortcut-main", { hasText: "Taxi" }).tap();
  await expect(sheet(page).locator(".m-title")).toHaveText("Taxi");
  await expect(page.locator(".toast")).toContainText("faltan datos");
});

test("shortcuts: edit from their menu (or a long press); deleting waits for Undo", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await create(page);
  const coffee = page.locator(".m-shortcut", { hasText: "Café" });
  await coffee.getByRole("button", { name: "Opciones de Café" }).tap();
  await expect(page.locator(".m-action-sheet")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-shortcut-menu.png` });
  await page.getByRole("menuitem", { name: "Editar" }).tap();
  const s = sheet(page);
  await expect(s.getByLabel("Nombre")).toHaveValue("Café");
  await expect(s.getByRole("button", { name: "Guardar directamente" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await s.getByLabel("Nombre").fill("Café con leche");
  await s.getByRole("button", { name: "Azul" }).tap();
  await page.screenshot({ path: `${SHOTS}/phone-shortcut-editor.png` });
  await s.getByRole("button", { name: "Guardar atajo" }).tap();
  await expect(s).toHaveCount(0);
  const put = body((await sent(page, "PUT api/v1/shortcuts/cafe"))[0]!);
  expect(put).toMatchObject({ label: "Café con leche", color: "#60a5fa", mode: "save" });
  expect(put.values).toMatchObject({ amount: 1.6, category: "bebida/cafe" });

  // a long press opens the same menu; Delete hides it at once and Undo brings it back
  await create(page);
  await page
    .locator(".m-shortcut-main", { hasText: "Comida con Pablo" })
    .dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Borrar" }).tap();
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).tap();
  await create(page);
  await expect(page.locator(".m-shortcut")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(6500);
  expect(await sent(page, "DELETE api/v1/shortcuts")).toHaveLength(0);
});

test("charts on Inicio with their totals; one on its own with periods; taps show values and open details", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".m-chart-row")).toHaveCount(3);
  await page.locator(".m-chart-row", { hasText: "Gasto por mes" }).tap();
  await expect(page.locator(".m-title")).toHaveText("Gasto por mes");
  await expect(page.locator(".m-tabs")).toHaveCount(0);
  const chosen = page.locator(".m-chip.on");
  await expect(chosen).toHaveText("Últimos 12 meses");
  await expect(chosen).toBeInViewport();
  const chart = (await page.locator(".m-chart-body .chart").boundingBox())!;
  await page.touchscreen.tap(chart.x + chart.width - 40, chart.y + chart.height / 2);
  await expect(page.locator(".chart-tip-value")).toContainText("€");
  await page.screenshot({ path: `${SHOTS}/phone-chart.png` });
  await page.getByRole("radio", { name: "Últimos 6 meses" }).tap();
  expect(body((await sent(page, "PUT api/v1/charts/monthly-spending"))[0]!).period).toEqual({
    kind: "last_months",
    months: 6,
  });

  // a ranking already shows its values: a tap on a bar opens its detail at once
  await page.keyboard.press("Escape");
  await page.locator(".m-chart-row", { hasText: "Gasto del mes" }).tap();
  await page.locator(".m-chart-body .chart svg").waitFor();
  await page.waitForTimeout(300);
  const ranking = (await page.locator(".m-chart-body .chart").boundingBox())!;
  await page.touchscreen.tap(ranking.x + ranking.width / 2, ranking.y + 20);
  await expect(page.locator(".m-chart-body").getByRole("button", { name: "Volver" })).toBeVisible();
  expect((await recorded(page)).requests.some((q) => q.includes("drill="))).toBe(true);
  await page.locator(".m-chart-body").getByRole("button", { name: "Volver" }).tap();

  // Back closes one thing at a time: the chart, and Inicio is there
  await page.keyboard.press("Escape");
  await expect(title(page)).toHaveText("Inicio");
});

test("the chart editor in a sheet, with its preview; a chart's menu takes it off Inicio", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await page.getByRole("button", { name: "Nueva gráfica" }).tap();
  const s = sheet(page);
  await expect(s.locator(".m-title")).toHaveText("Nueva gráfica");
  await expect(s.locator(".m-preview .chart svg")).toBeVisible();
  await expect(s.getByRole("button", { name: "Crear" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-editor.png` });
  await page.keyboard.press("Escape");
  await expect(s).toHaveCount(0);

  await page.locator(".m-chart-row", { hasText: "Comida fuera" }).tap();
  await page.getByRole("button", { name: "Opciones de la gráfica" }).tap();
  await page.getByRole("menuitem", { name: "Editar" }).tap();
  await expect(s.locator(".m-title")).toHaveText("Editar gráfica");
  await expect(s.getByLabel("Título")).toHaveValue("Comida fuera");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Opciones de la gráfica" }).tap();
  await page.getByRole("menuitem", { name: "Quitar de Inicio" }).tap();
  expect(body((await sent(page, "PUT api/v1/charts/eating-out"))[0]!).home).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-chart-row")).toHaveCount(2);
});

test("Boni on the phone: a greeting with things to try; its conversations in a drawer, Back closes it", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await tab(page, "Boni");
  await expect(page.locator(".chat-hello-title")).toHaveText("¿En qué te ayudo?");
  await expect(page.locator(".chat-hello .m-chip")).toHaveText([
    "¿Qué tengo hoy?",
    "Apunta algo para mañana",
    "¿Cuántos hay en Libros?",
  ]);
  // The conversation is the screen: no buttons over it, no + button.
  await expect(page.locator(".chat-tools")).toHaveCount(0);
  await expect(page.locator(".m-fab")).toHaveCount(0);
  await page.locator(".m-top").getByRole("button", { name: "Conversaciones" }).tap();
  const drawer = page.getByRole("dialog", { name: "Conversaciones" });
  await expect(drawer.getByRole("button", { name: "Nueva conversación" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Registro" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Auditoría" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-chats.png` });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});

test("the Bandeja is a place: its proposals under its large title", async ({ page }) => {
  await openApp(page, "/?still", { agent: { "GET api/agent/proposals": [PROPOSALS] } });
  await tab(page, "Bandeja");
  await expect(title(page)).toHaveText("Bandeja");
  await expect(page.getByRole("button", { name: "Aceptar" }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-inbox.png` });
});

test("offline on the phone: the capture waits on the device and says so", async ({ page }) => {
  await openApp(page, "/?still", { action: "offline" });
  await create(page);
  await below(page).locator(".m-capture").tap();
  const s = sheet(page);
  await s.getByLabel("Importe").tap();
  await page.keyboard.type("3", { delay: 60 });
  const category = s.locator(".field", { hasText: "Categor" }).locator("input");
  await category.tap();
  await page.keyboard.type("a");
  await s.getByRole("option").first().tap();
  await s.getByRole("button", { name: "Guardar", exact: true }).tap();
  await expect(page.locator(".toast")).toContainText("Sin conexión");
  await expect(page.locator(".m-status").first()).toHaveText("1 sin enviar");
  await emit(page, { type: "tick", minute: 1 });
  await expect.poll(async () => (await sent(page, "POST api/v1/actions")).length).toBe(2);
});
