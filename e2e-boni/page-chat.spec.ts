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
