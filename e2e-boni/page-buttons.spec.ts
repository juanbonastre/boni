import { expect, type Page, test } from "@playwright/test";
import { confirmTurn } from "./agent-scenarios.ts";
import { type FakePage, openApp, recorded } from "./fixtures.ts";
import { CATS, F, MOV } from "./money-records.ts";

/**
 * A page's buttons (docs/sistema.md §4.6 points 4 and 5, F11; D-60), as Juan uses them: a page of his spending with a
 * «Control» of the category and three buttons. One starts a flow with the page's values, one runs an action of the
 * one list (a record made, its Undo; a record deleted, confirmed first), one opens another page carrying the value.
 * The server reads what a button runs and passes from the saved page (apps/server/src/buttons.test.ts): the app only
 * saves the page and says which button was pressed. Data shaped like his (money-records.ts).
 */

const v = (value: unknown, integrity: string) => ({
  t: "v",
  value,
  integrity,
  sensitivity: "personal",
});
const turn = (run: string, o: Record<string, unknown> = {}) => ({
  run,
  status: "done",
  replies: [],
  pending: null,
  proposals: [],
  notices: [],
  error: null,
  ...o,
});
const control = (id: string) => ({
  id,
  type: "control",
  name: "Categoría",
  kind: "option",
  collection: MOV,
  field: F.category,
});
const FLOW = "resumen-del-mes-3fa9c1";
const gastos: FakePage = {
  id: "p_gastos",
  title: "Gastos del mes",
  spec: {
    version: 1,
    blocks: [
      control("b_cat"),
      {
        id: "b_resumen",
        type: "action",
        label: "Resumir",
        does: "flow",
        flow: FLOW,
        inputs: { categoria: "$b_cat", nota: "desde la página" },
      },
      {
        id: "b_cafe",
        type: "action",
        label: "Café",
        does: "action",
        action: "entities.create",
        collection: MOV,
        set: { [F.amount]: -1.6, [F.category]: "$b_cat" },
      },
      {
        id: "b_quitar",
        type: "action",
        label: "Quitar categoría",
        does: "action",
        action: "entities.delete",
        collection: MOV,
        record: "$b_cat",
      },
      {
        id: "b_ir",
        type: "action",
        label: "Ver el detalle",
        does: "page",
        to: "p_detalle",
        pass: { b_c2: "$b_cat" },
      },
    ],
  },
};
const detalle: FakePage = {
  id: "p_detalle",
  title: "Detalle",
  spec: { version: 1, blocks: [control("b_c2")] },
};
const flows = {
  flows: [
    {
      id: FLOW,
      name: "Resumen del mes",
      version: 1,
      trigger: { manual: true, inputs: [{ name: "categoria" }, { name: "nota" }] },
      by: "user",
      enabled: true,
      steps: 1,
      runs: 0,
      last: null,
    },
  ],
};

const sent = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));
const bodyOf = (r: string) => JSON.parse(r.split(" ").slice(2).join(" "));

test("a page's buttons start a flow with its values, run an action with Undo or a confirmation, and open a page with a value", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await openApp(page, "/?still", {
    money: true,
    pages: [gastos, detalle],
    slow: { path: "api/agent/press", ms: 800 },
    agent: {
      "POST api/agent/press": [
        turn("run-b1", {
          replies: [
            {
              component: "text",
              data: {
                template: v("Resumen de {a}: {b}", "model"),
                a: v("bebida/cafe", "user"),
                b: v("desde la página", "user"),
              },
            },
          ],
        }),
        turn("run-b2", { changed: true }),
        confirmTurn("c-b3"),
      ],
      "POST api/agent/runs/:id/undo": [{ undone: 1 }],
      "GET api/agent/flows": [flows],
    },
  });
  const [cafe] = CATS.map(([id]) => id) as [string];
  await page.getByLabel("Categoría", { exact: true }).selectOption({ label: "bebida/cafe" });

  // The flow's button: the page is saved with the value first, then the press names only the page and the button.
  const resumir = page.getByRole("button", { name: "Resumir" });
  await resumir.click();
  // Waiting is shown on the button itself (I-15). A busy button is out of the roles' tree, so it is found by its class.
  const busy = page.locator(".blk-action .decide-btn.busy");
  await expect(busy).toHaveText("Resumir");
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("dialog", { name: "Boni" })).toContainText(
    "Resumen de bebida/cafe: desde la página",
  );
  await expect(busy).toHaveCount(0);
  const all = (await recorded(page)).requests;
  const pressed = all.findIndex((r) => r.startsWith("POST api/agent/press "));
  const savedBefore = all
    .slice(0, pressed)
    .filter((r) => r.startsWith("PUT api/pages/p_gastos "))
    .at(-1);
  expect(savedBefore && bodyOf(savedBefore).spec.blocks[0].value).toBe(cafe);
  expect(bodyOf(all[pressed] ?? "")).toMatchObject({ page: "p_gastos", block: "b_resumen" });
  expect(Object.keys(bodyOf(all[pressed] ?? ""))).not.toContain("inputs");
  await page.getByRole("dialog", { name: "Boni" }).getByRole("button", { name: "Cerrar" }).click();

  // The action's button: done at once, said where Juan is, with «Deshacer».
  await page.getByRole("button", { name: "Café", exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toContainText("«Café» hecho");
  await toast.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(() => sent(page, "POST api/agent/runs/run-b2/undo")).toHaveLength(1);

  // Deleting waits for Juan's yes, in Boni's window, as the action always does.
  await page.getByRole("button", { name: "Quitar categoría" }).click();
  await expect(page.getByRole("dialog", { name: "Boni" }).locator(".confirm-card")).toBeVisible();
  const presses = (await sent(page, "POST api/agent/press ")).map(bodyOf);
  expect(presses.map((b) => b.block)).toEqual(["b_resumen", "b_cafe", "b_quitar"]);
  await page.getByRole("dialog", { name: "Boni" }).getByRole("button", { name: "Cerrar" }).click();

  // The page's button opens the other page with the value, as a link does; nothing goes to the agent.
  await page.getByRole("button", { name: "Ver el detalle" }).click();
  await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(cafe);
  expect(await sent(page, "POST api/agent/press ")).toHaveLength(3);
});

test("a button's panel: what it does, the flow it starts and where each input comes from", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    money: true,
    pages: [gastos, detalle],
    agent: { "GET api/agent/flows": [flows] },
  });
  const button = page.locator(".blk").filter({ hasText: "Resumir" });
  await button.hover();
  await button.getByRole("button", { name: /^Mover o modificar/ }).click();
  await page.getByRole("menuitemradio", { name: "Modificar…" }).click();
  const panel = page.locator(".side-panel");
  await expect(panel.locator("h2")).toHaveText("Botón");
  await expect(panel.getByRole("combobox", { name: "Hace" })).toHaveValue("flow");
  await expect(panel.getByRole("combobox", { name: "Flujo" })).toHaveValue(FLOW);
  // One row per input of the flow: a control of the page, or a value saved with the page.
  await expect(panel.getByRole("combobox", { name: "categoria" })).toHaveValue("$b_cat");
  await expect(panel.getByRole("combobox", { name: "nota" })).toHaveValue("=");
  await expect(panel.getByRole("textbox", { name: "Valor" })).toHaveValue("desde la página");
  await panel.getByRole("combobox", { name: "nota" }).selectOption({ label: "Categoría" });
  await expect
    .poll(async () => {
      const last = (await sent(page, "PUT api/pages/p_gastos ")).at(-1);
      return last && bodyOf(last).spec.blocks.find((b: { id: string }) => b.id === "b_resumen");
    })
    .toMatchObject({ inputs: { categoria: "$b_cat", nota: "$b_cat" } });
  // Made an action instead: its collection and values; the form's settings are not there.
  await panel.getByRole("combobox", { name: "Hace" }).selectOption({ label: "Acción" });
  await expect(panel.getByRole("combobox", { name: "Acción" })).toHaveValue("entities.create");
  await expect(panel.getByRole("combobox", { name: "Al pulsarlo" })).toHaveCount(0);
});
