import { expect, type Page, test } from "@playwright/test";
import { FLOWS, MAP_BLOCKS, MODELS } from "./agent-scenarios.ts";
import { type FakePage, openApp, openInTree, recorded } from "./fixtures.ts";
import { ACCOUNTS, CATS, F, MOV, moneyEngine } from "./money-records.ts";

/**
 * A page's values (docs/sistema.md §4.6, F11; D-59), as Juan uses them: a page of his spending with a «Control» of
 * the category, a number and a chart reading it. Changing the control changes the number and the chart (counted by
 * the fake server with the real engine and the page's controls, never by the app), the value is saved with the page
 * and is there when it is opened again, and a link carries it to another page. Data shaped like his
 * (money-records.ts: movements whose category is a record of «Categorías», a year of them).
 */

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
// What a year of the invented movements adds up to, by category (money-records.ts).
const TOTAL = { all: -183 - 2120 - 366, cafe: -183, super: -2120 };

const control = (id: string) => ({
  id,
  type: "control",
  name: "Categoría",
  kind: "option",
  collection: MOV,
  field: F.category,
});
const gastos: FakePage = {
  id: "p_gastos",
  title: "Gastos del mes",
  spec: {
    version: 1,
    blocks: [
      control("b_cat"),
      {
        id: "b_total",
        type: "number",
        title: "Gastado",
        collection: MOV,
        measure: "sum",
        field: F.amount,
        period: "all",
        filterField: F.category,
        filterValue: "$b_cat",
      },
      {
        id: "b_chart",
        type: "graph",
        shape: "bar",
        title: "Por mes",
        collection: MOV,
        measure: "sum",
        field: F.amount,
        groupBy: "@month",
        period: "all",
        filterField: F.category,
        filterValue: "$b_cat",
      },
      {
        id: "b_link",
        type: "link",
        title: "Ver el detalle",
        to: "p_detalle",
        pass: { b_c2: "$b_cat" },
      },
    ],
  },
};
const detalle: FakePage = {
  id: "p_detalle",
  title: "Detalle",
  spec: {
    version: 1,
    blocks: [
      control("b_c2"),
      {
        id: "b_n2",
        type: "number",
        title: "Total",
        collection: MOV,
        measure: "sum",
        field: F.amount,
        period: "all",
        filterField: F.category,
        filterValue: "$b_c2",
      },
    ],
  },
};

const kpi = (page: Page, id: string) => page.locator(`[data-block="${id}"] .kpi-value`);
const asked = async (page: Page) =>
  (await recorded(page)).requests.filter((r) => r.startsWith("POST api/data/blocks "));
const saved = async (page: Page, id: string) => {
  const puts = (await recorded(page)).requests.filter((r) => r.startsWith(`PUT api/pages/${id} `));
  const last = puts[puts.length - 1];
  return last
    ? (JSON.parse(last.split(" ").slice(2).join(" ")).spec.blocks as Record<string, unknown>[])
    : [];
};

test("a «Control» of the category changes the page's number and chart, is kept with the page and a link carries it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await openApp(page, "/?still", { money: true, pages: [gastos, detalle] });
  const select = page.getByLabel("Categoría", { exact: true });
  // Nothing chosen: «Todas», everything counts.
  await expect(select).toHaveValue("");
  await expect(select.locator("option").first()).toHaveText("Todas");
  await expect(kpi(page, "b_total")).toHaveText(nf.format(TOTAL.all));
  // The choices are the records of «Categorías», by title.
  await expect(select.locator("option")).toHaveText(["Todas", ...CATS.map(([, n]) => n).sort()]);

  const [cafe, sup] = CATS.map(([id]) => id) as [string, string];
  await select.selectOption({ label: "bebida/cafe" });
  await expect(kpi(page, "b_total")).toHaveText(nf.format(TOTAL.cafe));
  // The server counted it with the control: the app sent the page's controls with its blocks.
  const last = (await asked(page)).at(-1) ?? "";
  const body = JSON.parse(last.split(" ").slice(2).join(" "));
  expect(body.controls).toEqual([{ ...control("b_cat"), value: cafe }]);
  // The chart came in the same answer, counted with the same control.
  const chart = page.locator('[data-block="b_chart"]');
  await expect(chart.locator(".chart-card")).toBeVisible();
  // Saved with the page, as a change of the page (undoable, the same on every device).
  await expect
    .poll(async () => (await saved(page, "p_gastos")).find((b) => b.id === "b_cat")?.value)
    .toBe(cafe);

  await select.selectOption({ label: "comida/super" });
  await expect(kpi(page, "b_total")).toHaveText(nf.format(TOTAL.super));

  // A link carries the value to the other page's control.
  await page.getByRole("button", { name: "Ver el detalle" }).click();
  await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(sup);
  await expect(kpi(page, "b_n2")).toHaveText(nf.format(TOTAL.super));
  await expect
    .poll(async () => (await saved(page, "p_detalle")).find((b) => b.id === "b_c2")?.value)
    .toBe(sup);

  // Opened again, the page has its value; «Todas» empties it and everything counts again.
  await openInTree(page, "Gastos del mes");
  await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(sup);
  await expect(kpi(page, "b_total")).toHaveText(nf.format(TOTAL.super));
  await page.getByLabel("Categoría", { exact: true }).selectOption({ label: "Todas" });
  await expect(kpi(page, "b_total")).toHaveText(nf.format(TOTAL.all));
  await expect
    .poll(async () => (await saved(page, "p_gastos")).find((b) => b.id === "b_cat"))
    .not.toHaveProperty("value");
});

test("a month «Control» sets a number's period, and a table's rule takes its value from a control of the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const cuenta = {
    id: "b_cuenta",
    type: "control",
    name: "Cuenta",
    kind: "option",
    collection: MOV,
    field: F.account,
  };
  const mes = { id: "b_mes", type: "control", name: "Mes", kind: "month" };
  const total = {
    id: "b_total",
    type: "number",
    title: "Gastado",
    collection: MOV,
    measure: "sum",
    field: F.amount,
    period: "$b_mes",
  };
  const tabla = {
    id: "b_tabla",
    type: "database",
    source: MOV,
    view: { layout: "table", filter: [{ field: F.account, op: "is", from: "b_cuenta" }] },
  };
  const p: FakePage = {
    id: "p_mes",
    title: "Mes",
    spec: { version: 1, blocks: [mes, cuenta, total, tabla] },
  };
  await openApp(page, "/?still", { money: true, pages: [p] });
  // The month's sum as the server counts it, with the same engine and the same control.
  const expected = (value?: string) => {
    const r = moneyEngine(
      "blocks",
      { blocks: [total], controls: [value ? { ...mes, value } : mes] },
      today,
    ) as { results: Record<string, { data: { total: number } }> };
    return nf.format(r.results.b_total?.data.total ?? 0);
  };
  // An empty month counts every day, said «Desde siempre».
  await expect(kpi(page, "b_total")).toHaveText(expected());
  await expect(page.locator('[data-block="b_total"] .kpi-note')).toHaveText("Desde siempre");
  await page.getByLabel("Mes", { exact: true }).fill(month);
  await expect(kpi(page, "b_total")).toHaveText(expected(month));
  expect(expected(month)).not.toBe(expected());

  // The table: with nothing chosen its rule filters nothing; «Efectivo» leaves only what was paid in cash.
  const table = page.locator('[data-block="b_tabla"]');
  await expect(table.getByText("Metro Ejemplo").first()).toBeVisible();
  await page.locator('[data-block="b_cuenta"] select').selectOption({ label: ACCOUNTS[1].name });
  await expect(table.getByText("Metro Ejemplo")).toHaveCount(0);
  await expect(table.getByText("Cafetería Ejemplo").first()).toBeVisible();
  // Its chip says where the value comes from.
  await expect(table.locator(".db-chip.on").first()).toContainText("«Cuenta»");
});

test("a control's panel names its kind and field; a link's panel says which value it carries to each control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  // A control over another field (the account) is never offered for the category.
  const cuenta = { ...control("b_cta"), name: "Cuenta", field: F.account };
  const conCuenta = {
    ...gastos,
    spec: { ...gastos.spec, blocks: [...gastos.spec.blocks, cuenta] },
  };
  await openApp(page, "/?still", { money: true, pages: [conCuenta, detalle] });
  const open = async (id: string, name: string) => {
    const blk = page.locator(`[data-block="${id}"]`);
    await blk.hover();
    await blk.getByRole("button", { name: `Mover o modificar: ${name}` }).click();
    await page.getByRole("menuitemradio", { name: "Modificar…" }).click();
    return page.getByRole("complementary", { name });
  };
  const panel = await open("b_cat", "Control");
  await expect(panel.getByRole("combobox", { name: "Tipo", exact: true })).toHaveValue("option");
  await expect(panel.getByRole("combobox", { name: "Campo", exact: true })).toHaveValue(F.category);
  // Its value is changed on the page, not in its panel.
  await expect(panel.getByRole("combobox", { name: "Valor", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const link = await open("b_link", "Enlace");
  await expect(link.getByText("Con valores")).toBeVisible();
  const carried = link.getByRole("combobox", { name: "Categoría", exact: true });
  await expect(carried).toHaveValue("$b_cat");
  await expect(carried.locator("option")).toHaveText(["—", "Categoría"]);
  await carried.selectOption({ label: "—" });
  await expect
    .poll(async () => (await saved(page, "p_gastos")).find((b) => b.id === "b_link")?.pass)
    .toBeUndefined();
});

test("«Ver en el mapa» on a block: the map shows the values that control it, the collection it paints and who writes there (§4.6 point 7)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    money: true,
    pages: [gastos, detalle],
    agent: {
      "GET api/agent/map": [MAP_BLOCKS],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  const blk = page.locator('[data-block="b_total"]');
  await expect(kpi(page, "b_total")).toHaveText(nf.format(TOTAL.all));
  await blk.hover();
  await blk.locator(".blk-handle button").click();
  await page.getByRole("menuitemradio", { name: "Ver en el mapa" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Flujos");
  await expect(page.getByRole("tab", { name: "Mapa" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".mp-centre")).toContainText("Gastado");
  const map = page.locator(".mp-stage");
  const card = (name: string) =>
    map.locator(".mp-card", {
      has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
    });
  // Its two values, the collection it paints and who writes there: Juan, a flow of his, the Bandeja's accepted.
  for (const name of ["Categoría", "Mes", "Gastos", "Tú", "Apuntar gasto", "Bandeja"])
    await expect(card(name)).toBeVisible();
  await expect(map.locator(".mp-edge-label", { hasText: "controla" })).toHaveCount(2);
  // Another page's block over another collection is not on its map.
  await expect(card("Pendientes")).toHaveCount(0);
  await page.screenshot({ path: "e2e-boni/screenshots/page-block-map.png" });
  // «Abrir» on the block goes back to its page.
  await card("Gastado").click();
  await page.locator(".mp-panel").getByRole("button", { name: "Abrir" }).click();
  await expect(kpi(page, "b_total")).toBeVisible();
});
