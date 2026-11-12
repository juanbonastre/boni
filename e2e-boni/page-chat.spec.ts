import { expect, type Page, test } from "@playwright/test";
import { type FakePage, openApp, recorded } from "./fixtures.ts";
import { CATS, F, MOV, moneyEngine } from "./money-records.ts";

/**
 * A page's chat (docs/sistema.md §4.6 point 6, F11; D-61), as Juan uses it: his spending page with a «Control» of the
 * category, one of the month, the month's total and a chart, and a «Chat» block. What he writes in it (or a button's
 * text) opens a conversation in its mode in Boni's window; the server sets the page's values and answers with the
 * figure the code computed (apps/server/src/pageChat.test.ts), and the page shows them. «/Chat» makes the block and
 * its panel changes what it says. Data shaped like his (money-records.ts: a year of invented movements).
 */

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const FLOW = "chat-gastos-3fa9c1";
const v = (value: unknown, integrity: string) => ({
  t: "v",
  value,
  integrity,
  sensitivity: "personal",
});
const control = {
  id: "b_cat",
  type: "control",
  name: "Categoría",
  kind: "option",
  collection: MOV,
  field: F.category,
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
  filterField: F.category,
  filterValue: "$b_cat",
};
const chart = {
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
};
const view = (o: Record<string, unknown> = {}) => ({
  flow: FLOW,
  version: 1,
  name: "Chat · Gastos",
  page: "p_gastos",
  welcome: "Pregúntame por tus gastos.",
  buttons: [{ label: "El súper", text: "¿cuánto gasté en el súper el mes pasado?" }],
  instructions: "You answer in the chat of one of Juan's pages.",
  actions: ["pages.figures", "entities.query", "entities.aggregate", "pages.set_value"],
  defaults: {
    instructions: "You answer in the chat of one of Juan's pages.",
    actions: ["pages.figures", "entities.query", "entities.aggregate", "pages.set_value"],
  },
  enabled: true,
  ...o,
});
const kpi = (page: Page, id: string) => page.locator(`[data-block="${id}"] .kpi-value`);
const sent = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

test("what Juan writes in a page's chat is answered in its mode with the code's figure, and the page shows the values it set", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const today = new Date().toISOString().slice(0, 10);
  const last = new Date(Date.parse(`${today.slice(0, 7)}-01T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 7);
  const superId = CATS[1][0];
  // What the server counts, with the same engine and the page's values as the chat set them.
  const counted = (cat?: string, month?: string) =>
    (
      moneyEngine(
        "blocks",
        {
          blocks: [total],
          controls: [
            cat ? { ...control, value: cat } : control,
            month ? { ...mes, value: month } : mes,
          ],
        },
        today,
      ) as { results: Record<string, { data: { total: number } }> }
    ).results.b_total?.data.total ?? 0;
  const figure = counted(superId, last);
  const conversation = { id: "k_chat", title: "", model: "", last: 1762900000000, flow: FLOW };
  const gastos: FakePage = {
    id: "p_gastos",
    title: "Gastos",
    spec: {
      version: 1,
      blocks: [control, mes, total, chart, { id: "b_chat", type: "chat", flow: FLOW }],
    },
  };
  await openApp(page, "/?still", {
    money: true,
    pages: [gastos],
    agent: {
      "GET api/agent/chats/:id": [{ chat: view() }],
      "POST api/agent/conversations": [{ conversation }],
      "GET api/agent/conversations": [{ conversations: [conversation] }],
      "POST api/agent/turn": [
        {
          run: "run-chat-1",
          status: "done",
          replies: [
            {
              component: "number",
              // A model's words are painted as text, never as HTML.
              data: { value: v(figure, "own"), caption: v("<b>Gastado</b>", "model") },
            },
          ],
          pending: null,
          proposals: [],
          notices: [],
          error: null,
          changed: true,
          __values: { page: "p_gastos", values: { b_cat: superId, b_mes: last } },
        },
      ],
    },
  });
  const block = page.locator(".pchat");
  await expect(block.locator(".pchat-welcome")).toHaveText("Pregúntame por tus gastos.");
  await expect(kpi(page, "b_total")).toHaveText(nf.format(counted()));
  // A button writes its text as Juan's message.
  await block.getByRole("button", { name: "El súper" }).click();
  await expect
    .poll(async () => (await sent(page, "POST api/agent/conversations")).at(-1))
    .toContain(`"flow":"${FLOW}"`);
  await expect
    .poll(async () => (await sent(page, "POST api/agent/turn")).at(-1))
    .toContain('"conversation":"k_chat"');
  expect((await sent(page, "POST api/agent/turn")).at(-1)).toContain(
    "¿cuánto gasté en el súper el mes pasado?",
  );
  // Boni's window, in the chat's mode, with the figure the code computed.
  const win = page.getByRole("dialog", { name: "Boni" });
  await expect(win.locator(".reply-figure")).toContainText(nf.format(figure));
  await expect(win).toContainText("<b>Gastado</b>");
  await expect(win.locator(".chat-mode-chip")).toHaveText("Chat de «Gastos»");
  await page.screenshot({ path: "e2e-boni/screenshots/page-chat.png" });
  // The page, read again after the run, shows the values the chat set: the number and the chart follow them.
  await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(superId);
  await expect(page.getByLabel("Mes", { exact: true })).toHaveValue(last);
  await expect(kpi(page, "b_total")).toHaveText(nf.format(figure));
  const asked = (await sent(page, "POST api/data/blocks ")).at(-1) ?? "";
  const body = JSON.parse(asked.split(" ").slice(2).join(" ")) as {
    controls: Record<string, unknown>[];
  };
  expect(body.controls).toEqual([
    { ...control, value: superId },
    { ...mes, value: last },
  ]);
  // Out of its mode: the conversation goes on as an ordinary one.
  await win.getByRole("button", { name: "Salir del modo de este chat" }).click();
  await expect
    .poll(async () => (await sent(page, "PUT api/agent/conversations/k_chat")).at(-1))
    .toContain('"flow":""');
});

test("«/Chat» puts a chat on the page and its panel changes what it says", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const p: FakePage = {
    id: "p_gastos",
    title: "Gastos",
    spec: { version: 1, blocks: [{ id: "b_t", type: "text", text: "Mis gastos" }] },
  };
  await openApp(page, "/?still", {
    money: true,
    pages: [p],
    agent: {
      "POST api/agent/chats": [{ chat: view({ welcome: "", buttons: [] }) }],
      "GET api/agent/chats/:id": [{ chat: view({ welcome: "", buttons: [] }) }],
      "PUT api/agent/chats/:id": [
        { chat: view({ version: 2, welcome: "¿Qué quieres saber?", buttons: [] }) },
      ],
    },
  });
  await page.locator(".doc-tail").click();
  await page.keyboard.type("/Chat", { delay: 20 });
  await page.locator(".slash-menu").getByRole("menuitem", { name: "Chat de la página" }).click();
  await expect
    .poll(async () => (await sent(page, "POST api/agent/chats")).at(-1))
    .toContain('"page":"p_gastos"');
  // Saved with the page: only the flow it names.
  await expect
    .poll(async () => {
      const puts = await sent(page, "PUT api/pages/p_gastos ");
      const last = puts.at(-1);
      return last ? JSON.parse(last.split(" ").slice(2).join(" ")).spec.blocks : [];
    })
    .toContainEqual(expect.objectContaining({ type: "chat", flow: FLOW }));
  // Its panel: what it says, its agent's instructions and what it may do.
  const panel = page.locator(".side-panel");
  await expect(panel.locator(".pchat-settings")).toBeVisible();
  await expect(
    panel.getByRole("checkbox", { name: "Cambiar los valores de la página" }),
  ).toBeChecked();
  await panel.getByRole("textbox", { name: "Bienvenida" }).fill("¿Qué quieres saber?");
  await panel.getByRole("button", { name: "Guardar" }).click();
  await expect(panel).toContainText("Guardado");
  const put = (await sent(page, "PUT api/agent/chats/")).at(-1) ?? "";
  expect(JSON.parse(put.split(" ").slice(2).join(" "))).toMatchObject({
    base: 1,
    welcome: "¿Qué quieres saber?",
  });
  await expect(page.locator(".pchat .pchat-welcome")).toHaveText("¿Qué quieres saber?");
});

test("a chat whose flow is gone says so, and writes nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const p: FakePage = {
    id: "p_gastos",
    title: "Gastos",
    spec: { version: 1, blocks: [{ id: "b_chat", type: "chat", flow: FLOW }] },
  };
  await openApp(page, "/?still", {
    pages: [p],
    agent: { "GET api/agent/chats/:id": [{ __status: 404, error: "not-found" }] },
  });
  await expect(page.locator(".pchat-gone")).toHaveText("Este chat ya no existe.");
  expect(await sent(page, "POST api/agent/conversations")).toEqual([]);
});

/** The month before this one and the super's category: what «¿cuánto gasté en el súper el mes pasado?» asks. */
const asked = () => {
  const today = new Date().toISOString().slice(0, 10);
  const last = new Date(Date.parse(`${today.slice(0, 7)}-01T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 7);
  return { today, last, superId: CATS[1][0] };
};
const turnOf = (o: Record<string, unknown>) => ({
  run: "run-chat-2",
  status: "done",
  replies: [],
  pending: null,
  proposals: [],
  notices: [],
  error: null,
  changed: false,
  ...o,
});
const gastosPage: FakePage = {
  id: "p_gastos",
  title: "Gastos",
  spec: { version: 1, blocks: [control, mes, total, { id: "b_chat", type: "chat", flow: FLOW }] },
};
const chatRoutes = {
  "GET api/agent/chats/:id": [{ chat: view() }],
  "POST api/agent/conversations": [
    { conversation: { id: "k_chat", title: "", model: "", last: 1762900000000, flow: FLOW } },
  ],
};

test("the chat's figure says how many movements it is, and a click lists them with the values it was read with (§4.6 point 7, D-08)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const { today, last, superId } = asked();
  const controls = [
    { ...control, value: superId },
    { ...mes, value: last },
  ];
  // The code's figure and its number of rows, as the server counts them (pages.figures: total and count).
  const figure = (
    moneyEngine("blocks", { blocks: [total], controls }, today) as {
      results: Record<string, { data: { total: number } }>;
    }
  ).results.b_total?.data.total;
  const count = (moneyEngine("rows", { block: total, controls }, today) as { total: number }).total;
  expect(count).toBeGreaterThan(0);
  const of = { page: "p_gastos", block: "b_total", values: { b_cat: superId, b_mes: last } };
  await openApp(page, "/?still", {
    money: true,
    pages: [gastosPage],
    agent: {
      ...chatRoutes,
      "POST api/agent/turn": [
        turnOf({
          replies: [
            {
              component: "text",
              data: {
                template: v("Gastaste {a} en {b} movimientos", "model"),
                a: v(figure, "own"),
                b: v(count, "own"),
              },
              rows: { a: of, b: of },
            },
          ],
        }),
      ],
    },
  });
  await page.locator(".pchat").getByRole("button", { name: "El súper" }).click();
  const win = page.getByRole("dialog", { name: "Boni" });
  // The number of movements is the code's, and both figures are a way to their rows.
  await expect(win.locator(".reply-text")).toContainText(`en ${count} movimientos`);
  const links = win.locator(".reply-figure-rows");
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute("title", "Ver las filas");
  // The page holds nothing now; the click lists the rows with the values the figure was read with.
  await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue("");
  await links.last().click();
  const panel = page.locator(".side-panel .rows-panel");
  await expect(panel.locator(".rows-panel-count")).toContainText(`${count} fila`);
  await expect(panel.locator(".rows-panel-list li")).toHaveCount(Math.min(count, 50));
  const sentRows = (await sent(page, "POST api/data/blocks/rows ")).at(-1) ?? "";
  const body = JSON.parse(sentRows.split(" ").slice(2).join(" ")) as {
    block: { id: string };
    controls: Record<string, unknown>[];
  };
  expect(body.block.id).toBe("b_total");
  expect(body.controls).toEqual(controls);
  await page.screenshot({ path: "e2e-boni/screenshots/page-chat-rows.png" });
});

test("a block the chat would add is shown on a card first, by what it counts, and added only on «Sí» (§4.6 point 7, P27)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const row = (arg: string, role: string, value: string, detail?: string) => ({
    arg,
    role,
    value,
    integrity: "user",
    sources: ["turn"],
    marks: [],
    ...(detail ? { detail } : {}),
  });
  await openApp(page, "/?still", {
    money: true,
    pages: [gastosPage],
    agent: {
      ...chatRoutes,
      "GET api/agent/chats/:id": [
        { chat: view({ buttons: [{ label: "Añade", text: "añade el total de restaurantes" }] }) },
      ],
      "POST api/agent/turn": [
        turnOf({
          status: "waiting",
          pending: {
            kind: "confirm",
            id: "c_block",
            view: {
              tool: "pages.add_block",
              title: "Añadir bloque",
              rows: [
                row("page", "page", "p_gastos", "Gastos"),
                row("block.type", "definition", "number"),
                row("block.collection", "definition", "movimiento", "Movimiento"),
                row("block.measure", "definition", "sum"),
                row("block.field", "definition", "importe", "Importe"),
                row("block.period", "definition", "all"),
              ],
            },
          },
        }),
      ],
      "POST api/agent/confirm": [
        turnOf({
          replies: [{ component: "text", data: { template: v("Añadido.", "model") } }],
          changed: true,
        }),
      ],
    },
  });
  await page.locator(".pchat").getByRole("button", { name: "Añade" }).click();
  const win = page.getByRole("dialog", { name: "Boni" });
  const card = win.locator(".confirm-card");
  await expect(card.getByRole("heading")).toHaveText("¿Añadir bloque?");
  // Its settings by their names, never a text of code.
  for (const [label, value] of [
    ["Bloque", "Cifra"],
    ["Colección", "Movimiento"],
    ["Qué cuenta", "La suma"],
    ["Periodo", "Desde siempre"],
  ])
    await expect(card.locator(".confirm-row", { hasText: label })).toContainText(value);
  await expect(card).not.toContainText("{");
  await page.screenshot({ path: "e2e-boni/screenshots/page-chat-add-block.png" });
  // Nothing was written before «Sí».
  expect(await sent(page, "PUT api/pages/p_gastos ")).toEqual([]);
  const accept = card.getByRole("button", { name: "Sí, añadir bloque" });
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(win).toContainText("Añadido.");
  await expect
    .poll(async () => (await sent(page, "POST api/agent/confirm ")).at(-1))
    .toContain('"confirmation":"c_block"');
});
