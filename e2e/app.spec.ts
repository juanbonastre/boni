import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { EXAMPLES, emit, openApp, recorded } from "./fixtures.ts";

const SHOTS = "e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test("home: the server's buttons and its chart cards, with values on hover and a detail on click", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.getByRole("button", { name: "Apuntar gasto" })).toBeVisible();
  await expect(page.locator(".chart-card")).toHaveCount(3);
  await expect(page.locator(".card-title").first()).toHaveText("Gasto del mes");
  await expect(page.locator(".chart svg").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/home.png` });

  // the monthly bars: a tooltip with the value under the pointer
  const monthly = page.locator(".chart-card", { hasText: "Gasto por mes" }).locator(".chart");
  const box = (await monthly.boundingBox())!;
  await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
  await expect(page.locator(".chart-tip")).toBeVisible();
  await expect(page.locator(".chart-tip-value")).toContainText("€");

  // drill down: a click on a bar of "Gasto del mes" shows that group, and Back returns
  const ranking = page.locator(".chart-card").first();
  const r = (await ranking.locator(".chart").boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + 20);
  await expect(ranking.getByRole("button", { name: "Volver" })).toBeVisible();
  const { requests } = await recorded(page);
  expect(requests.some((q) => q.includes("spending-by-category/data?drill="))).toBe(true);
  await ranking.getByRole("button", { name: "Volver" }).click();
  await expect(ranking.getByRole("button", { name: "Volver" })).toHaveCount(0);
});

test("capture: the server's form, checked here, sent once with its id and numbers as numbers", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await page.getByRole("button", { name: "Apuntar gasto" }).click();
  await expect(page.locator(".form")).toBeVisible();
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".field-error").first()).toHaveText("Obligatorio");
  await page.getByLabel("Importe").fill("12,50");
  // a searchable list: type, arrows, Enter
  const category = page.locator(".field", { hasText: "Categoria" }).locator("input");
  await category.fill(JSON.parse(EXAMPLES["options-people.json"]!).options[0].label.slice(0, 3));
  await category.press("ArrowDown");
  await category.press("ArrowUp");
  await category.press("Enter");
  await expect(
    page.locator(".field", { hasText: "Categoria" }).locator(".picked-chip"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Ayer", exact: true }).click();
  await page.screenshot({ path: `${SHOTS}/capture.png` });
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apuntar gasto" })).toBeVisible();
  const sent = (await recorded(page)).requests.filter((r) => r.startsWith("POST api/v1/actions"));
  expect(sent).toHaveLength(1);
  const body = JSON.parse(sent[0]!.slice("POST api/v1/actions ".length));
  expect(body.action).toBe("expenses.capture");
  expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(body.values.amount).toBe(12.5);
  expect(body.created_at).toMatch(/T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  expect(body.values).not.toHaveProperty("invited"); // hidden field: not sent
});

test("offline: the capture stays on the device and goes with the next tick", async ({ page }) => {
  await openApp(page, "/?still", { action: "offline" });
  await page.getByRole("button", { name: "Apuntar gasto" }).click();
  await page.getByLabel("Importe").fill("3");
  const category = page.locator(".field", { hasText: "Categoria" }).locator("input");
  await category.fill("a");
  await category.press("Enter");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast")).toContainText("Sin conexión");
  await expect(page.locator(".pending")).toHaveText("1 sin enviar");
  // the coordinator's minute: the queue is sent again (still offline here: it stays)
  await emit(page, { type: "tick", minute: 1 });
  await expect(page.locator(".pending")).toHaveText("1 sin enviar");
  const tries = (await recorded(page)).requests.filter((r) => r.startsWith("POST api/v1/actions"));
  expect(tries).toHaveLength(2);
  expect(JSON.parse(tries[0]!.split(" ").slice(2).join(" ")).client_id).toBe(
    JSON.parse(tries[1]!.split(" ").slice(2).join(" ")).client_id,
  );
});

test("charts: the list, the widgets of this computer, and the editor with its live preview", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await page.getByRole("button", { name: "Gráficas" }).click();
  await expect(page.locator(".list-title")).toHaveCount(3);
  await expect(page.getByText("Widgets de este equipo")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/charts.png` });
  await page.getByRole("button", { name: "Editar" }).first().click();
  await expect(page.locator(".editor-preview .chart svg")).toBeVisible();
  await page.getByRole("radio", { name: "Linea" }).click();
  await page.locator(".title-input").fill("Gasto mensual (prueba)");
  await expect(page.locator(".editor-preview .card-title")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/editor.png` });
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast")).toHaveText("Gráfica guardada");
  const { requests, calls } = await recorded(page);
  const put = requests.find((r) => r.startsWith("PUT api/v1/charts/spending-by-category"));
  expect(JSON.parse(put!.split(" ").slice(2).join(" ")).kind).toBe("line");
  expect(calls).toContain("broadcastRefresh");
  // Esc goes back to the home screen
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Apuntar gasto" })).toBeVisible();
});

test("settings: the token is sent once and never shown; theme and language apply at once", async ({
  page,
}) => {
  await openApp(page, "/?still", { configured: false });
  await expect(page.getByText("Configura el servidor de Boni para empezar.")).toBeVisible();
  await page.getByRole("button", { name: "Configurar servidor" }).click();
  await page.getByLabel("Dirección del servidor").fill("https://boni.example.ts.net");
  await page.getByLabel("Token de este equipo").fill("tok-ejemplo");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByLabel("Token de este equipo")).toHaveValue("");
  await expect(page.getByLabel("Token de este equipo")).toHaveAttribute("placeholder", /Guardado/);
  await page.getByRole("button", { name: "Claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: `${SHOTS}/settings.png` });
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.locator(".chart-card")).toHaveCount(3);
});

test("a desktop widget: interactive chart, dragged anywhere, resized from the corner, its own menu", async ({
  page,
}) => {
  await page.setViewportSize({ width: 380, height: 260 });
  await openApp(page, "/?widget=w-monthly-spending&chart=monthly-spending&still");
  await expect(page.locator(".widget .card-title")).toHaveText("Gasto por mes");
  await page.screenshot({ path: `${SHOTS}/widget.png`, omitBackground: true });
  // hover: the value
  const chart = (await page.locator(".chart").boundingBox())!;
  await page.mouse.move(chart.x + chart.width - 20, chart.y + chart.height / 2);
  await expect(page.locator(".chart-tip")).toBeVisible();
  // drag from the title: the window moves (the shell does it) and the click does not open anything
  const title = (await page.locator(".card-title").boundingBox())!;
  await page.mouse.move(title.x + 10, title.y + 5);
  await page.mouse.down();
  await page.mouse.move(title.x + 40, title.y + 25, { steps: 4 });
  await page.mouse.up();
  let calls = (await recorded(page)).calls;
  expect(calls).toContain("dragStart move");
  expect(calls).toContain("dragMove");
  expect(calls).toContain("dragEnd");
  // resize from the corner
  await page.mouse.move(366, 246);
  await page.mouse.down();
  await page.mouse.move(340, 230, { steps: 3 }); // the pointer cannot leave the page here: shrink it
  await page.mouse.up();
  calls = (await recorded(page)).calls;
  expect(calls).toContain("dragStart resize");
  // right click: the menu, inside the small window
  await page.mouse.click(190, 150, { button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  const m = (await menu.boundingBox())!;
  expect(m.x + m.width).toBeLessThanOrEqual(380);
  expect(m.y + m.height).toBeLessThanOrEqual(260);
  await page.screenshot({ path: `${SHOTS}/widget-menu.png`, omitBackground: true });
  await menu.getByRole("menuitem", { name: "Cambiar gráficas y widgets" }).click();
  expect((await recorded(page)).calls).toContain("openMain charts");
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
