import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { EXAMPLES, emit, openApp, recorded } from "./fixtures.ts";

/**
 * The phone (narrower than 640 px; the Android app): made for capturing. A phone-sized touch screen; taps are real
 * touches (Chromium turns them into pointer events with pointerType "touch", as the Android WebView does).
 */
const SHOTS = "e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

const body = (request: string) => JSON.parse(request.split(" ").slice(2).join(" "));
const sent = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));
const sheet = (page: Page) => page.locator(".m-sheet");
const PERSON = JSON.parse(EXAMPLES["options-people.json"]!).options[0];

test("the phone opens on capturing: the capture button, the shortcuts, two tabs", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".m-app")).toBeVisible();
  await expect(page.locator(".sidebar, .dashboard")).toHaveCount(0);
  await expect(page.locator(".m-title")).toHaveText("Apuntar");
  await expect(page.locator(".m-capture")).toHaveText("Apuntar gasto");
  const shortcuts = page.locator(".m-shortcut");
  await expect(shortcuts).toHaveCount(2);
  await expect(shortcuts.first()).toContainText("Café");
  await expect(shortcuts.first().locator(".m-shortcut-sub")).toHaveText(
    "1,60 € · Cafe · bebida/cafe",
  );
  await expect(page.locator(".m-tab")).toHaveText(["Apuntar", "Gráficas"]);
  // Thumb-sized: tabs, the capture button and each shortcut are at least 48 px high
  for (const el of [
    page.locator(".m-tab").first(),
    page.locator(".m-capture"),
    shortcuts.first(),
  ]) {
    expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  await page.screenshot({ path: `${SHOTS}/phone-capture.png` });
});

test("a capture in a sheet: required fields first, the rest folded; sent once; its toast makes it a shortcut", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await page.locator(".m-capture").tap();
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

test("a shortcut that saves at once waits for its Undo; one that opens fills the form", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await page.locator(".m-shortcut-main", { hasText: "Café" }).tap();
  await expect(page.locator(".toast")).toContainText("Apuntando «Café»…");
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).tap();
  await page.waitForTimeout(6500);
  expect(await sent(page, "POST api/v1/actions")).toHaveLength(0);

  await page.locator(".m-shortcut-main", { hasText: "Café" }).tap();
  await expect(page.locator(".m-status")).toHaveCount(0); // held back: not "1 not sent"
  await expect
    .poll(async () => (await sent(page, "POST api/v1/actions")).length, { timeout: 9000 })
    .toBe(1);
  const values = body((await sent(page, "POST api/v1/actions"))[0]!).values;
  expect(values).toMatchObject({
    kind: "gasto",
    amount: 1.6,
    account: "efectivo",
    category: "bebida/cafe",
  });
  expect(values.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // "open": the form with the shortcut's values; what it fills in is not folded
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
  await page.locator(".m-shortcut-main", { hasText: "Taxi" }).tap();
  await expect(sheet(page).locator(".m-title")).toHaveText("Taxi");
  await expect(page.locator(".toast")).toContainText("faltan datos");
});

test("shortcuts: edit from their menu (or a long press); deleting waits for Undo", async ({
  page,
}) => {
  await openApp(page, "/?still");
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
  await page
    .locator(".m-shortcut-main", { hasText: "Comida con Pablo" })
    .dispatchEvent("contextmenu");
  await page.getByRole("menuitem", { name: "Borrar" }).tap();
  await expect(page.locator(".m-shortcut")).toHaveCount(1);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).tap();
  await expect(page.locator(".m-shortcut")).toHaveCount(2);
  await page.waitForTimeout(6500);
  expect(await sent(page, "DELETE api/v1/shortcuts")).toHaveLength(0);
});

test("charts: a list with their totals; one on its own with periods; taps show values and open details", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await page.getByRole("button", { name: "Gráficas" }).tap();
  await expect(page.locator(".m-title")).toHaveText("Gráficas");
  await expect(page.locator(".m-chart-row")).toHaveCount(3);
  await expect(page.locator(".m-chart-row").first()).toContainText("€");
  await page.screenshot({ path: `${SHOTS}/phone-charts.png` });

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

  // Back closes one thing at a time: the chart, then the charts tab
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-title")).toHaveText("Gráficas");
  await page.keyboard.press("Escape");
  await expect(page.locator(".m-title")).toHaveText("Apuntar");
});

test("the chart editor in a sheet, with its preview; a chart's menu", async ({ page }) => {
  await openApp(page, "/?still");
  await page.getByRole("button", { name: "Gráficas" }).tap();
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
});

test("offline on the phone: the capture waits on the device and says so", async ({ page }) => {
  await openApp(page, "/?still", { action: "offline" });
  await page.locator(".m-capture").tap();
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
