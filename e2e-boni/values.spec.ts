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
  // A control of this page of the same kind, or a value of its own («Valor», task 102).
  await expect(carried.locator("option")).toHaveText(["—", "Categoría", "Valor"]);
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

/** A page like his «Gastos» with the four pieces of task 102: a category, a period, a table over both, a link. */
const followed = () => {
  const cat = control("b_cat");
  const per = { id: "b_per", type: "control", name: "Periodo", kind: "period" };
  const total = {
    id: "b_total",
    type: "number",
    title: "Gastado",
    collection: MOV,
    measure: "sum",
    field: F.amount,
    period: "$b_per",
    filterField: F.category,
    filterValue: "$b_cat",
  };
  const tabla = {
    id: "b_tabla",
    type: "database",
    source: MOV,
    view: {
      layout: "table",
      filter: [
        { field: F.category, op: "is", from: "b_cat" },
        { field: F.date, op: "is", from: "b_per" },
      ],
    },
  };
  const link = { id: "b_link", type: "link", title: "Ver el detalle", to: "p_detalle" };
  const p: FakePage = {
    id: "p_gastos",
    title: "Gastos",
    spec: { version: 1, blocks: [cat, per, total, tabla, link] },
  };
  return { cat, per, total, tabla, p };
};
const daysBefore = (today: string, n: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

test("a page's table follows a relation control and a period, picked by the server; a link's own value is typed in its panel (task 102)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const today = new Date().toISOString().slice(0, 10);
  const { cat, per, total, tabla, p } = followed();
  await openApp(page, "/?still", { money: true, pages: [p, detalle] });
  const table = page.locator('[data-block="b_tabla"]');
  const rowsOf = () => table.locator("tbody tr[data-row]");
  await expect(table.getByText("Metro Ejemplo").first()).toBeVisible();
  const asks = async () =>
    (await recorded(page)).requests
      .filter((r) => r.startsWith("POST api/data/blocks/rows "))
      .map((r) => JSON.parse(r.split(" ").slice(2).join(" ")));
  // The server picks its rows: the app asks for the table's block, never for the whole collection.
  await expect.poll(async () => (await asks()).at(-1)?.block?.type).toBe("database");
  expect(
    (await recorded(page)).requests.some((r) => r.startsWith(`GET api/data/types/${MOV}/rows`)),
  ).toBe(false);

  // «Categoría» is a record of «Categorías»; the table's rule on the relation takes it.
  const [cafe] = CATS.map(([id]) => id) as [string];
  await page.locator('[data-block="b_cat"] select').selectOption({ label: "bebida/cafe" });
  await expect(table.getByText("Metro Ejemplo")).toHaveCount(0);
  await expect(table.getByText("Cafetería Ejemplo").first()).toBeVisible();
  await expect
    .poll(async () =>
      (await asks()).at(-1)?.controls?.find((c: { id: string }) => c.id === "b_cat"),
    )
    .toEqual({ ...cat, value: cafe });
  // Its rule's «Valor de» offers only the controls that fit a relation to «Categorías».
  await table.locator(".db-chip.on").first().click();
  await expect(page.getByRole("combobox", { name: "Valor de", exact: true })).toHaveValue("b_cat");
  await expect(
    page.getByRole("combobox", { name: "Valor de", exact: true }).locator("option"),
  ).toHaveText(["Fijo", "Categoría"]);
  await page.keyboard.press("Escape");

  // A period: its first and last day; the number and the table read its days.
  const from = daysBefore(today, 9);
  const value = `${from}/${today}`;
  const box = page.locator('[data-block="b_per"]');
  await box.getByLabel("Desde", { exact: true }).fill(from);
  // One day alone sets nothing yet.
  expect((await saved(page, "p_gastos")).find((b) => b.id === "b_per")?.value).toBeUndefined();
  await box.getByLabel("Hasta", { exact: true }).fill(today);
  await expect
    .poll(async () => (await saved(page, "p_gastos")).find((b) => b.id === "b_per")?.value)
    .toBe(value);
  const controls = [
    { ...cat, value: cafe },
    { ...per, value },
  ];
  const sum = moneyEngine("blocks", { blocks: [total], controls }, today) as {
    results: Record<string, { data: { total: number } }>;
  };
  await expect(kpi(page, "b_total")).toHaveText(nf.format(sum.results.b_total?.data.total ?? 0));
  const picked = moneyEngine("rows", { block: tabla, controls }, today) as { rows: unknown[] };
  // Ten days of coffee, one every third day.
  expect(picked.rows.length).toBeGreaterThan(2);
  expect(picked.rows.length).toBeLessThan(5);
  await expect(rowsOf()).toHaveCount(picked.rows.length);
  // Days turned round are put in their order.
  await box.getByLabel("Desde", { exact: true }).fill(today);
  await box.getByLabel("Hasta", { exact: true }).fill(from);
  await expect(box.getByLabel("Desde", { exact: true })).toHaveValue(from);

  // The link's panel: «Valor», and the other page's control's own input, typed here.
  const blk = page.locator('[data-block="b_link"]');
  await blk.hover();
  await blk.getByRole("button", { name: "Mover o modificar: Enlace" }).click();
  await page.getByRole("menuitemradio", { name: "Modificar…" }).click();
  const panel = page.getByRole("complementary", { name: "Enlace" });
  const carried = panel.getByRole("combobox", { name: "Categoría", exact: true });
  await expect(carried.locator("option")).toHaveText(["—", "Categoría", "Valor"]);
  await carried.selectOption({ label: "Valor" });
  await panel
    .getByRole("combobox", { name: "Valor", exact: true })
    .selectOption({ label: "comida/super" });
  const sup = CATS[1][0];
  await expect
    .poll(async () => (await saved(page, "p_gastos")).find((b) => b.id === "b_link")?.pass)
    .toEqual({ b_c2: sup });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ver el detalle" }).click();
  await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(sup);
  await expect(kpi(page, "b_n2")).toHaveText(nf.format(TOTAL.super));
});

test("on a phone, a period's two days fit the screen and its table is the server's (task 102)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const today = new Date().toISOString().slice(0, 10);
  const { p } = followed();
  await openApp(page, "/?still", { money: true, pages: [p, detalle] });
  // The phone opens on «Inicio»; the page from «Seguir con».
  await page.getByRole("button", { name: "Gastos", exact: true }).click();
  const box = page.locator('[data-block="b_per"]');
  await box.scrollIntoViewIfNeeded();
  for (const name of ["Desde", "Hasta"]) {
    const r = await box.getByLabel(name, { exact: true }).boundingBox();
    expect(r).not.toBeNull();
    expect((r?.x ?? 0) + (r?.width ?? 0)).toBeLessThanOrEqual(390);
  }
  await box.getByLabel("Desde", { exact: true }).fill(daysBefore(today, 1));
  await box.getByLabel("Hasta", { exact: true }).fill(today);
  const table = page.locator('[data-block="b_tabla"]');
  // Two days: one or two coffees, a metro, maybe the market; no movement of a week ago.
  await expect(table.getByText("Metro Ejemplo").first()).toBeVisible();
  await expect
    .poll(async () => {
      const asks = (await recorded(page)).requests.filter((r) =>
        r.startsWith("POST api/data/blocks/rows "),
      );
      return JSON.parse((asks.at(-1) ?? "  {}").split(" ").slice(2).join(" ")).controls?.find(
        (c: { id: string }) => c.id === "b_per",
      )?.value;
    })
    .toBe(`${daysBefore(today, 1)}/${today}`);
  await expect(table.locator("tbody tr[data-row]")).toHaveCount(
    (
      moneyEngine(
        "rows",
        {
          block: followed().tabla,
          controls: [
            {
              id: "b_per",
              type: "control",
              name: "Periodo",
              kind: "period",
              value: `${daysBefore(today, 1)}/${today}`,
            },
          ],
        },
        today,
      ) as { rows: unknown[] }
    ).rows.length,
  );
});
