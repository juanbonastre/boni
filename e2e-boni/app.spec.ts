import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { EXAMPLES, emit, openApp, recorded } from "./fixtures.ts";

const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const body = (request: string) => JSON.parse(request.split(" ").slice(2).join(" "));
const puts = async (page: Page, id: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(`PUT api/v1/charts/${id} `));
const card = (page: Page, title: string) => page.locator(".chart-card", { hasText: title }).first();

test("the window is laid out as Boni Calendar: sidebar, the start page's charts filling the window", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".doc-charts .chart-card")).toHaveCount(3);
  // The sidebar holds only what the user made: the conversation and the pages.
  await expect(page.locator(".sidebar .page-row")).toHaveCount(1);
  await expect(page.locator(".sidebar .page-row.active")).toContainText("Gastos");
  await expect(page.locator(".sidebar")).not.toContainText("Tus gráficas");
  // As a Notion page: its name as its first line, the path in the top bar.
  await expect(page.locator(".doc-title")).toHaveValue("Gastos");
  await expect(page.locator(".topbar .crumbs")).toHaveText("Gastos");
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

  await page
    .getByRole("region", { name: "Comida fuera" })
    .getByRole("button", { name: "Comida fuera" })
    .click();
  await expect(page.locator(".chart-card.focus")).toBeVisible();
  await expect(page.locator(".title-name")).toHaveText("Comida fuera");
  await page.screenshot({ path: `${SHOTS}/chart.png` });
  await page.keyboard.press("Escape");
  await expect(page.locator(".doc-charts")).toBeVisible();
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
  await monthly.hover();
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

  // A narrow card (half the page) shows only the period and "…": its title stays in view.
  await monthly.hover();
  await expect(monthly.getByRole("button", { name: "Color" })).toBeHidden();
  await expect(monthly.getByRole("button", { name: "Más" })).toBeVisible();
  const wide = card(page, "Gasto del mes");
  await wide.hover();
  await wide.getByRole("button", { name: "Color" }).click();
  await page.getByRole("radio", { name: "Verde" }).click();
  await expect.poll(async () => (await puts(page, "spending-by-category")).length).toBe(1);
  expect(body((await puts(page, "spending-by-category"))[0]!).color).toBe("#4ade80");
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

test("capture in the side panel, from the page's button: the charts stay in view; sent once, numbers as numbers", async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".doc-charts .chart-card")).toHaveCount(3);
  await page.locator(".doc-actions").getByRole("button", { name: "Apuntar gasto" }).click();
  const panel = page.locator(".side-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator(".doc-charts")).toBeVisible();
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
  await page.locator(".doc-actions").getByRole("button", { name: "Apuntar gasto" }).click();
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
  const monthly = card(page, "Gasto por mes");
  await monthly.hover();
  await monthly.getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitemradio", { name: "Editar" }).click();
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
  // Notion's style options: a larger chart without data labels, the running total.
  await panel.getByRole("button", { name: "Más opciones de estilo" }).click();
  await panel.getByRole("button", { name: "Altura: Mediana" }).click();
  await panel.getByRole("menuitem", { name: "Grande", exact: true }).click();
  await panel.locator(".opt-row", { hasText: "Etiquetas de datos" }).locator("input").uncheck();
  await panel.locator(".opt-row", { hasText: "Acumulado" }).locator("input").check();
  await page.screenshot({ path: `${SHOTS}/editor-style.png` });
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast")).toHaveText("Gráfica guardada");
  const saved = body((await puts(page, "monthly-spending"))[0]!);
  expect(saved.kind).toBe("line");
  expect(saved.style).toEqual({ height: "l", labels: false, cumulative: true });

  // A new chart from "/" on the page: saved, it takes that line's place.
  await page.locator(".doc-tail").click();
  await page.keyboard.type("/nueva", { delay: 20 });
  await expect(page.locator(".slash-menu")).toBeVisible();
  await page.keyboard.press("Enter");
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
  await expect
    .poll(async () =>
      (await recorded(page)).requests.some(
        (r) => r.startsWith("PUT api/pages/gastos ") && r.includes('"chart":"nueva"'),
      ),
    )
    .toBe(true);
});

test("deleting a chart waits for Undo before it reaches the server", async ({ page }) => {
  await openApp(page, "/?still");
  const eating = card(page, "Comida fuera");
  await eating.hover();
  await eating.getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(page.locator(".doc-charts .chart-card")).toHaveCount(2);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(page.locator(".doc-charts .chart-card")).toHaveCount(3);
  await page.waitForTimeout(6500);
  expect((await recorded(page)).requests.some((r) => r.startsWith("DELETE api/v1/charts/"))).toBe(
    false,
  );
});

test('pages as Notion\'s: made from the sidebar, written in place, blocks by "/", moved and deleted', async ({
  page,
}) => {
  await openApp(page, "/?still");
  await expect(page.locator(".doc-charts .chart-card")).toHaveCount(3);
  // A new page opens at once, untitled, with the caret in its name.
  await page.getByRole("button", { name: "Nueva página" }).click();
  await expect(page.locator(".sidebar .page-row")).toHaveCount(2);
  await expect(page.locator(".doc-title")).toBeFocused();
  await page.keyboard.type("Docencia", { delay: 20 });
  await expect(page.locator(".sidebar .page-row.active")).toContainText("Docencia");
  // An icon, from "Add icon" over the name: it shows there and in the sidebar.
  await page.locator(".doc-title").hover();
  await page.getByRole("button", { name: "Añadir icono" }).click();
  await page.getByRole("button", { name: "📚" }).click();
  await expect(page.locator(".doc-icon")).toHaveText("📚");
  await expect(page.locator(".sidebar .page-row.active .page-icon")).toHaveText("📚");
  await page.locator(".doc-title").click();
  await page.keyboard.press("End");
  // Enter goes to the first line; "# " makes it a heading, Enter the next line, "/" the block menu.
  await page.keyboard.press("Enter");
  await page.keyboard.type("# Este curso", { delay: 20 });
  await expect(page.locator(".blk-h1 textarea")).toHaveValue("Este curso");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Exámenes", { delay: 20 });
  await expect(page.locator(".blk-bullet .blk-mark")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // an empty list item ends the list
  await page.keyboard.type("/comida", { delay: 20 });
  await expect(page.locator(".slash-menu")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/page-slash.png` });
  await page.keyboard.press("Enter");
  await expect(page.locator(".doc-charts .chart-card")).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/page-doc.png` });
  // The chart's handle: moved to the top. The heading's: deleted (Undo in the toast).
  const chart = page.locator(".blk-chart").first();
  await chart.hover();
  await chart.getByRole("button", { name: "Mover o cambiar: Gráfica" }).click();
  await page.screenshot({ path: `${SHOTS}/page-handle.png` });
  await page.getByRole("menuitemradio", { name: "Subir" }).click();
  await chart.hover();
  await chart.getByRole("button", { name: "Mover o cambiar: Gráfica" }).click();
  await page.getByRole("menuitemradio", { name: "Subir" }).click();
  const heading = page.locator(".blk-h1");
  await heading.hover();
  await heading.getByRole("button", { name: "Mover o cambiar: Título 1" }).click();
  await page.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(page.locator(".blk-h1")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Bloque borrado");
  // Sent together a moment later.
  await expect
    .poll(async () => {
      const saved = (await recorded(page)).requests.filter((r) =>
        r.startsWith("PUT api/pages/p1 "),
      );
      const last = saved[saved.length - 1];
      return last ? body(last).spec?.blocks?.map((b: { type: string }) => b.type) : null;
    })
    .toEqual(["chart", "bullet", "text"]);
  // Deleted from its menu in the sidebar: to the start page, and Undo brings it back.
  const row = page.locator(".sidebar .page-row", { hasText: "Docencia" });
  await row.hover();
  await row.getByRole("button", { name: /^Más opciones/ }).click();
  await page.getByRole("menuitemradio", { name: "Borrar página" }).click();
  await expect(page.locator(".sidebar .page-row")).toHaveCount(1);
  await expect(page.locator(".doc-title")).toHaveValue("Gastos");
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(page.locator(".sidebar .page-row")).toHaveCount(2);
  await expect(page.locator(".doc-title")).toHaveValue("Docencia");
});

test("Notion's blocks: lists, toggles, code; Tab nests, a closed toggle folds, Ctrl+Z undoes", async ({
  page,
}) => {
  await openApp(page, "/?still", { pages: [] });
  await page.locator(".welcome").getByRole("button", { name: "Nueva página" }).click();
  await page.keyboard.type("Apuntes", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("1. Uno", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Dos", { delay: 15 });
  await expect(page.locator(".blk-mark.num")).toHaveText(["1.", "2."]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // an empty item ends the list
  await page.keyboard.type("> Más", { delay: 15 });
  await expect(page.locator(".blk-fold")).toHaveCount(1);
  await page.keyboard.press("Enter"); // the next line goes inside the toggle
  await page.keyboard.type("Dentro", { delay: 15 });
  await expect(page.locator('.blk[style*="margin-left"] textarea')).toHaveValue("Dentro");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("```", { delay: 15 });
  await page.keyboard.type("a = 1", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("b = 2", { delay: 15 });
  await expect(page.locator(".blk-code textarea")).toHaveValue("a = 1\nb = 2");
  // Ctrl+Z takes back the last change (the code typed in one go), Ctrl+Shift+Z brings it again.
  await page.keyboard.press("Control+z");
  await expect(page.locator(".blk-code textarea")).toHaveValue("");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".blk-code textarea")).toHaveValue("a = 1\nb = 2");
  await page.screenshot({ path: `${SHOTS}/page-blocks.png` });
  // A closed toggle hides what is inside it.
  const lines = page.locator(".doc-blocks textarea");
  const before = await lines.count();
  await page.locator(".blk-fold").click();
  await expect(lines).toHaveCount(before - 1);
  await page.locator(".blk-fold").click();
  await expect(lines).toHaveCount(before);
});

test('Ctrl+K finds a page; duplicate, subpage from "/", the trash restores', async ({ page }) => {
  await openApp(page, "/?still", {
    pages: [
      { id: "gastos", title: "Gastos", spec: { version: 1, blocks: [] } },
      { id: "docencia", title: "Docencia", spec: { version: 1, blocks: [] } },
    ],
  });
  await expect(page.locator(".sidebar .page-row")).toHaveCount(2);
  await page.keyboard.press("Control+k");
  await expect(page.locator(".find-box")).toBeVisible();
  await page.keyboard.type("doc", { delay: 15 });
  await expect(page.locator(".find-row")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator(".doc-title")).toHaveValue("Docencia");
  // "/página" makes a subpage, linked from here, and opens it with the caret in its name.
  await page.locator(".doc-tail").click();
  await page.keyboard.type("/pági", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".doc-title")).toBeFocused();
  await page.keyboard.type("Exámenes", { delay: 15 });
  await expect(page.locator(".topbar .crumbs")).toContainText("Docencia");
  await page.locator(".topbar .crumb", { hasText: "Docencia" }).click();
  await expect(page.locator(".doc-page-link")).toContainText("Exámenes");
  // Duplicate from the top bar's menu.
  await page.locator(".topbar").getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("menuitemradio", { name: "Duplicar" }).click();
  await expect(page.locator(".doc-title")).toHaveValue("Docencia (1)");
  // Delete it, then bring it back from the trash.
  await page.locator(".topbar").getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("menuitemradio", { name: "Borrar página" }).click();
  await page.getByRole("button", { name: "Papelera" }).click();
  await expect(page.locator(".find-box")).toContainText("Docencia (1)");
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.locator(".toast")).toContainText("Página restaurada");
  await expect(page.locator(".sidebar .page-row", { hasText: "Docencia (1)" })).toHaveCount(1);
});

test("no pages: a welcome, nothing fixed; the first page from there", async ({ page }) => {
  await openApp(page, "/?still", { pages: [] });
  await expect(page.locator(".welcome")).toContainText("Te damos la bienvenida a Boni");
  await expect(page.locator(".chart-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apuntar gasto" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/welcome.png` });
  await page.locator(".welcome").getByRole("button", { name: "Nueva página" }).click();
  await expect(page.locator(".sidebar .page-row")).toHaveCount(1);
  await expect(page.locator(".doc-title")).toBeFocused();
});

test("this computer's widgets, in Settings → Desktop: hidden here, added", async ({ page }) => {
  await openApp(page, "/?still");
  await page.getByRole("button", { name: "Ajustes" }).click();
  await page.getByRole("tab", { name: "Escritorio" }).click();
  const widget = page.locator(".widget-list .chart-row").first();
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
  await modal.getByRole("tab", { name: "Apariencia" }).click();
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
  await expect(page.locator(".doc-charts .chart-card")).toHaveCount(3);
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
