import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { EXAMPLES, emit, openApp, recorded } from "./fixtures.ts";

const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const body = (request: string) => JSON.parse(request.split(" ").slice(2).join(" "));
const puts = async (page: Page, id: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(`PUT api/v1/charts/${id} `));
const card = (page: Page, title: string) => page.locator(".chart-card", { hasText: title }).first();

test("the window is laid out as Boni Calendar: sidebar, charts filling the window", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".dashboard .chart-card")).toHaveCount(3);
  await expect(page.locator(".chart-row")).toHaveCount(3 + 3); // charts + this computer's widgets
  // no empty band under the charts: the last row reaches the bottom of the content
  const content = (await page.locator(".content").boundingBox())!;
  const last = (await page.locator(".dashboard .chart-card").last().boundingBox())!;
  expect(content.y + content.height - (last.y + last.height)).toBeLessThan(30);
  await page.screenshot({ path: `${SHOTS}/home.png` });

  // [ hides the sidebar, and the charts take its room
  await page.keyboard.press("[");
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.keyboard.press("[");
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("a chart: values on hover, a detail on click, and on its own from its title", async ({
  page,
}) => {
  await openApp(page, "/?still");
  const monthly = card(page, "Gasto por mes").locator(".chart");
  const box = (await monthly.boundingBox())!;
  await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
  await expect(page.locator(".chart-tip")).toBeVisible();
  await expect(page.locator(".chart-tip-value")).toContainText("€");

  const ranking = card(page, "Gasto del mes");
  const r = (await ranking.locator(".chart").boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + 20);
  await expect(ranking.getByRole("button", { name: "Volver" })).toBeVisible();
  expect(
    (await recorded(page)).requests.some((q) => q.includes("spending-by-category/data?drill=")),
  ).toBe(true);
  await ranking.getByRole("button", { name: "Volver" }).click();

  await card(page, "Comida fuera").getByRole("button", { name: "Comida fuera" }).click();
  await expect(page.locator(".chart-card.focus")).toBeVisible();
  await expect(page.locator(".title-name")).toHaveText("Comida fuera");
  await page.screenshot({ path: `${SHOTS}/chart.png` });
  await page.keyboard.press("Escape");
  await expect(page.locator(".dashboard")).toBeVisible();
});

test("a chart's own controls on hover (like Notion): period, order, colour; saved, with Undo", async ({
  page,
}) => {
  await openApp(page, "/?still");
  const monthly = card(page, "Gasto por mes");
  await expect(monthly.locator(".card-controls")).toBeHidden();
  await monthly.hover();
  await expect(monthly.locator(".card-controls")).toBeVisible();
  await monthly.getByRole("button", { name: "Periodo" }).click();
  await page.screenshot({ path: `${SHOTS}/controls-period.png` });
  await page.getByRole("menuitemradio", { name: "Últimos 6 meses" }).click();
  await expect(monthly.getByRole("button", { name: "Periodo" })).toContainText("Últimos 6 meses");
  expect(body((await puts(page, "monthly-spending"))[0]!).period).toEqual({
    kind: "last_months",
    months: 6,
  });
  await expect(page.locator(".toast")).toContainText("Gráfica cambiada");
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(async () => (await puts(page, "monthly-spending")).length).toBe(2);
  expect(body((await puts(page, "monthly-spending"))[1]!).period).toEqual({
    kind: "last_months",
    months: 12,
  });

  await monthly.hover();
  await monthly.getByRole("button", { name: "Color" }).click();
  await page.getByRole("radio", { name: "Verde" }).click();
  await expect.poll(async () => (await puts(page, "monthly-spending")).length).toBe(3);
  expect(body((await puts(page, "monthly-spending"))[2]!).color).toBe("#4ade80");
  await expect(
    page
      .locator(".nav-list")
      .first()
      .locator(".chart-row", { hasText: "Gasto por mes" })
      .locator(".swatch"),
  ).toHaveCSS("background-color", "rgb(74, 222, 128)");
});

test("filters from a chart's controls: edited in their box, saved once when it closes", async ({
  page,
}) => {
  await openApp(page, "/?still");
  const ranking = card(page, "Gasto del mes");
  await ranking.hover();
  await ranking.getByRole("button", { name: "Filtros" }).click();
  await page.locator(".pop-box").getByRole("button", { name: "Añadir filtro" }).click();
  await page.getByRole("menuitem", { name: "Cuenta" }).click();
  await expect(page.locator(".pop-box .filter")).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/controls-filters.png` });
  expect(await puts(page, "spending-by-category")).toHaveLength(0); // not yet
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await puts(page, "spending-by-category")).length).toBe(1);
  expect(body((await puts(page, "spending-by-category"))[0]!).filters[0].field).toBe("account");
  await expect(ranking.locator(".ctl-badge")).toHaveText("1");
});

test("capture in the side panel (N): the charts stay in view; sent once, numbers as numbers", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".dashboard .chart-card")).toHaveCount(3);
  await page.keyboard.press("n");
  const panel = page.locator(".side-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator(".dashboard")).toBeVisible();
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(panel.locator(".field-error").first()).toHaveText("Obligatorio");
  await panel.getByLabel("Importe").fill("12,50");
  const category = panel.locator(".field", { hasText: "Categor" }).locator("input");
  await category.fill(JSON.parse(EXAMPLES["options-people.json"]!).options[0].label.slice(0, 3));
  await category.press("ArrowDown");
  await category.press("ArrowUp");
  await category.press("Enter");
  await panel.getByRole("button", { name: "Ayer", exact: true }).click();
  await page.screenshot({ path: `${SHOTS}/capture.png` });
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast")).toBeVisible();
  await expect(panel).toHaveCount(0);
  const sent = (await recorded(page)).requests.filter((r) => r.startsWith("POST api/v1/actions"));
  expect(sent).toHaveLength(1);
  const b = body(sent[0]!);
  expect(b.client_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(b.values.amount).toBe(12.5);
  expect(b.values).not.toHaveProperty("invited");
});

test("offline: the capture stays on the device and goes with the next tick", async ({ page }) => {
  await openApp(page, "/?still", { action: "offline" });
  await page
    .locator(".topbar")
    .getByRole("button", { name: /Apuntar gasto/ })
    .click();
  const panel = page.locator(".side-panel");
  await panel.getByLabel("Importe").fill("3");
  const category = panel.locator(".field", { hasText: "Categor" }).locator("input");
  await category.fill("a");
  await category.press("Enter");
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast")).toContainText("Sin conexión");
  await expect(page.locator(".topbar .status").first()).toHaveText("1 sin enviar");
  await emit(page, { type: "tick", minute: 1 });
  await expect
    .poll(
      async () =>
        (await recorded(page)).requests.filter((r) => r.startsWith("POST api/v1/actions")).length,
    )
    .toBe(2);
});

test("the editor in the side panel: the card shows the preview; a new chart gets its own card", async ({
  page,
}) => {
  await openApp(page, "/?still");
  const row = page.locator(".chart-row", { hasText: "Gasto por mes" }).first();
  await row.hover();
  await row.getByRole("button", { name: /^Editar…/ }).click();
  const panel = page.locator(".side-panel");
  await expect(panel.getByRole("heading", { name: "Editar gráfica" })).toBeVisible();
  await expect(card(page, "Gasto por mes")).toHaveClass(/editing/);
  await panel.getByRole("radio", { name: /^L[ií]nea$/ }).click();
  await expect
    .poll(async () =>
      (await recorded(page)).requests.some((r) => r.startsWith("POST api/v1/charts/preview")),
    )
    .toBe(true);
  await page.screenshot({ path: `${SHOTS}/editor.png` });
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast")).toHaveText("Gráfica guardada");
  expect(body((await puts(page, "monthly-spending"))[0]!).kind).toBe("line");

  await page.getByRole("button", { name: "Nueva gráfica" }).click();
  await expect(page.locator(".chart-card.new")).toBeVisible();
  await panel.locator(".title-input").fill("Gasto en ocio (prueba)");
  await expect(page.locator(".chart-card.new .card-title")).toHaveText("Gasto en ocio (prueba)");
  await panel.getByRole("button", { name: "Crear gráfica" }).click();
  await expect
    .poll(async () =>
      (await recorded(page)).requests.some((r) => r.startsWith("POST api/v1/charts {")),
    )
    .toBe(true);
  await expect(page.locator(".chart-card.new")).toHaveCount(0);
});

test("deleting a chart waits for Undo before it reaches the server", async ({ page }) => {
  await openApp(page, "/?still");
  const eating = card(page, "Comida fuera");
  await eating.hover();
  await eating.getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(page.locator(".dashboard .chart-card")).toHaveCount(2);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(page.locator(".dashboard .chart-card")).toHaveCount(3);
  await page.waitForTimeout(6500);
  expect((await recorded(page)).requests.some((r) => r.startsWith("DELETE api/v1/charts/"))).toBe(
    false,
  );
});

test("the sidebar: eye = on the home screen, drag to reorder, this computer's widgets", async ({
  page,
}) => {
  await openApp(page, "/?still");
  const row = page.locator(".nav-list").first().locator(".chart-row", { hasText: "Comida fuera" });
  await row.hover();
  await row.getByRole("button", { name: /^Quitar de inicio/ }).click();
  await expect(page.locator(".dashboard .chart-card")).toHaveCount(2);
  expect(body((await puts(page, "eating-out"))[0]!).home).toBe(false);

  const rows = page.locator(".nav-list").first().locator(".chart-row");
  await rows.nth(2).dragTo(rows.nth(0));
  await expect
    .poll(async () =>
      (await recorded(page)).requests.find((r) => r.startsWith("PUT api/v1/charts/order")),
    )
    .toBeTruthy();
  const order = body(
    (await recorded(page)).requests.find((r) => r.startsWith("PUT api/v1/charts/order"))!,
  );
  expect(order.ids[0]).toBe("eating-out");

  const widget = page.locator(".nav-list").nth(1).locator(".chart-row").first();
  await widget.hover();
  await widget.getByRole("button", { name: /^Ocultar en este equipo/ }).click();
  expect(
    (await recorded(page)).calls.some((c) =>
      c.includes('"widgetHidden":{"id":"w-spending-by-category","hidden":true}'),
    ),
  ).toBe(true);
  await expect(widget).toHaveClass(/off/);
  await page.getByRole("button", { name: "Añadir widget" }).click();
  await page.getByRole("menuitemradio", { name: "Comida fuera" }).click();
  await expect
    .poll(async () =>
      (await recorded(page)).requests.some((r) => r.startsWith("POST api/v1/widgets")),
    )
    .toBe(true);
});

test("account as Boni Calendar's: log in with user and device; an old token asks to", async ({
  page,
}) => {
  await openApp(page, "/?still", { legacy: true });
  await expect(page.getByRole("button", { name: "Entra con tu usuario" })).toBeVisible();
  await page.getByRole("button", { name: "Entra con tu usuario" }).click();
  const modal = page.locator(".modal");
  await expect(modal.locator(".notice")).toContainText("token de los primeros clientes");
  await expect(modal.getByLabel("Nombre de este equipo")).toHaveValue("portatil");
  await modal.getByLabel("Usuario").fill("ejemplo");
  await modal.getByLabel("Contraseña").fill("no-es-la-buena");
  await modal.getByRole("button", { name: "Entrar" }).click();
  await expect(modal.locator(".form-error")).toHaveText("Usuario o contraseña incorrectos");
  await modal.getByLabel("Contraseña").fill("una-contrasena-larga");
  await modal.getByRole("button", { name: "Entrar" }).click();
  await expect(modal).toContainText("Conectado como ejemplo · portatil");
  await page.screenshot({ path: `${SHOTS}/settings.png` });
  expect((await recorded(page)).calls).toContain(
    "login https://boni.example.ts.net ejemplo portatil",
  );
  await modal.getByRole("button", { name: "Claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Entra con tu usuario" })).toHaveCount(0);
});

test("first start: the app asks for the server", async ({ page }) => {
  await openApp(page, "/?still", { configured: false });
  await expect(page.getByText("Configura el servidor de Boni para empezar.")).toBeVisible();
  await page.getByRole("button", { name: "Configurar servidor" }).click();
  await expect(page.locator(".modal").getByLabel("Dirección del servidor")).toBeVisible();
});

test("a desktop widget: interactive, its controls on hover, dragged and resized, its own menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 380, height: 260 });
  await openApp(page, "/?widget=w-monthly-spending&chart=monthly-spending&still");
  await expect(page.locator(".widget .card-title")).toHaveText("Gasto por mes");
  await page.screenshot({ path: `${SHOTS}/widget.png`, omitBackground: true });
  const chart = (await page.locator(".chart").boundingBox())!;
  await page.mouse.move(chart.x + chart.width - 20, chart.y + chart.height / 2);
  await expect(page.locator(".chart-tip")).toBeVisible();
  // compact controls: the period and the menu only
  await expect(page.locator(".card-controls .ctl")).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/widget-hover.png`, omitBackground: true });
  // drag from the title (outside the controls)
  const title = (await page.locator(".card-sub").boundingBox())!;
  await page.mouse.move(title.x + 10, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x + 40, title.y + 25, { steps: 4 });
  await page.mouse.up();
  let calls = (await recorded(page)).calls;
  expect(calls).toContain("dragStart move");
  expect(calls).toContain("dragEnd");
  await page.mouse.move(366, 246);
  await page.mouse.down();
  await page.mouse.move(340, 230, { steps: 3 });
  await page.mouse.up();
  calls = (await recorded(page)).calls;
  expect(calls).toContain("dragStart resize");
  // right click: the widget's menu, inside the small window
  await page.mouse.click(190, 150, { button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  const m = (await menu.boundingBox())!;
  expect(m.x + m.width).toBeLessThanOrEqual(380);
  expect(m.y + m.height).toBeLessThanOrEqual(260);
  await menu.getByRole("menuitem", { name: "Editar en Boni" }).click();
  expect((await recorded(page)).calls).toContain("openMain edit:monthly-spending");
});

test("a widget without network shows the last saved data", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 260 });
  await openApp(page, "/?widget=w-eating-out&chart=eating-out&still", {
    offline: true,
    files: { "chart-eating-out.json": EXAMPLES["chart-eating-out.json"]! },
  });
  await expect(page.locator(".card-title")).toHaveText("Comida fuera");
  await expect(page.locator(".card-note")).toContainText("Sin conexión");
});

test("live changes: the server says the charts changed, the page loads them again", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".dashboard .chart-card")).toHaveCount(3);
  const before = (await recorded(page)).requests.filter((r) => r === "GET api/v1/charts").length;
  await emit(page, { type: "changed", what: "charts" });
  await expect
    .poll(
      async () => (await recorded(page)).requests.filter((r) => r === "GET api/v1/charts").length,
    )
    .toBe(before + 1);
  // with the live connection, the minute ticks do not reload everything
  await emit(page, { type: "tick", minute: 15 });
  await page.waitForTimeout(300);
  expect((await recorded(page)).requests.filter((r) => r === "GET api/v1/charts").length).toBe(
    before + 1,
  );
});
