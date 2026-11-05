import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  DONE,
  FLOW,
  FLOW_CATALOG,
  FLOW_CHANGE,
  FLOW_CHECK,
  FLOW_DETAIL,
  FLOW_DETAIL_SAVED,
  FLOW_PROPOSAL,
  FLOW_SUMMARY,
  FLOW_TEST,
  FLOWS,
  FLOWS_WITH_SUMMARY,
  MODELS,
  MODELS_CATALOGUE,
  MODELS_EVALUATED,
  MODELS_EVALUATING,
  MODELS_USED,
} from "./agent-scenarios.ts";
import { openApp, openInTree, recorded, TEMPLATE } from "./fixtures.ts";

/**
 * Boni's models (design audit, Juan 2026-10-25): what configures them is Ajustes → Modelos (each use with its model in
 * large type, a click opens it; the month's spending and the budget; the keys). What they did is the template page
 * «Uso de la IA», ordinary blocks over Boni's own read-only collections; a click on a number lists what it counts.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const requests = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

/** «Flujos» → the tab «Modelos» (until 2026-11-04 Ajustes → Modelos, which is now a button to it). */
async function openModels(page: Page) {
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await page.getByRole("radio", { name: "Modelos" }).click();
  await page.locator(".use-card").first().waitFor();
}

test("«Modelos»: each use with its model, the month's spending and budget, the keys; Ajustes links to it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: { "GET api/agent/models": [MODELS] } });
  // Ajustes → Modelos is a button to the section (task 59b).
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await page.locator(".modal").getByRole("tab", { name: "Modelos" }).click();
  await page.locator(".modal").getByRole("button", { name: "Flujos" }).click();
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.locator(".topbar h1")).toHaveText("Flujos");
  await expect(page.getByRole("radio", { name: "Modelos" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.locator(".use-card").first().waitFor();
  const spend = page.locator(".models-page .kpi").first();
  await expect(spend).toContainText("3,42 €");
  await expect(spend).toContainText("de 10,00 €");
  const reader = page.getByRole("button", { name: /^Lector/ });
  await expect(reader.locator(".use-model")).toHaveText("deepseek-v4.1-flash");
  await expect(reader.locator(".models-badge")).toHaveText("No guarda tus datos");
  await expect(reader).toContainText("0,74 € · 512 llamadas");
  await expect(page.getByRole("button", { name: /^Agente/ })).toContainText(
    "Borra lo que recibe en 30 días",
  );
  await page.screenshot({ path: `${SHOTS}/models.png` });

  // The spending by model and the budget are there too.
  const more = page.locator(".models-spend");
  await expect(more).toContainText("Evaluación: Lector · deepseek-v4.1-flash");
  await expect(more).toContainText("512 llamadas · 3 sin precio conocido");
  await expect(more).toContainText("Presupuesto: 10,00 € al mes, aviso al 80 %");

  await reader.click();
  const panel = page.locator(".models-panel");
  await expect(panel.locator("h2")).toHaveText("Lector");
  await expect(panel).toContainText("Lee cada correo y dice qué te piden");
  await expect(panel).toContainText("OpenRouter solo lo envía a proveedores que no guardan");
  await expect(panel).toContainText("Elegido por ti");
  await expect(panel).toContainText("Este mes: 0,74 € en 512 llamadas");
  await expect(panel).toContainText("Evaluación: 19 de 20 bien");
  await panel.getByRole("button", { name: "Ver los casos" }).click();
  await expect(panel.locator(".models-cases li.fail")).toHaveCount(1);
  await expect(panel.locator(".models-cases li.fail")).toContainText("colección equivocada");
  await page.screenshot({ path: `${SHOTS}/models-use.png` });
  // Escape closes the use, not Ajustes.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".models-page")).toBeVisible();

  await page.getByRole("button", { name: /^Claves/ }).click();
  const conns = page.locator(".models-card", {
    has: page.getByRole("button", { name: /^Claves/ }),
  });
  await expect(conns).toContainText("Se guarda cifrada en Boni");
  await expect(conns.locator(".models-conn")).toHaveText([
    /OpenRouter · Tu clave/,
    /Anthropic \(directa\) · Clave del servidor/,
    /TypeSafe · Sin clave/,
  ]);
  await page.screenshot({ path: `${SHOTS}/models-open.png` });
});

test("change a role: pick from the catalogue, evaluate, compare, use", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/models": [MODELS, MODELS_EVALUATED],
      "GET api/agent/models/catalogue": [MODELS_CATALOGUE],
      "POST api/agent/models/evaluate": [{ __status: 409, error: "no-key" }, MODELS_EVALUATING],
      "PUT api/agent/models/roles/:role": [MODELS_USED],
    },
  });
  await openModels(page);
  await page.getByRole("button", { name: /^Agente/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  const panel = page.locator(".models-panel");
  await expect(panel.locator("h2")).toHaveText("Agente");
  // The planner takes any model; cheapest first.
  await expect(panel.locator(".models-option .models-name")).toHaveText([
    "Ejemplo: sin esquema",
    "DeepSeek: V4.1 Flash",
    "Z.ai: GLM 5.2",
    "Anthropic: Claude Opus 5.5",
  ]);
  await panel.getByRole("textbox", { name: "Buscar un modelo" }).pressSequentially("glm");
  await expect(panel.locator(".models-option")).toHaveCount(1);
  const glm = panel.getByRole("button", { name: /^Z\.ai: GLM 5\.2/ });
  await expect(glm).toContainText("0,6 $ / 2,2 $ por millón de tokens");
  await expect(glm).toContainText("3 proveedores que no guardan datos");
  await glm.click();
  await expect(glm).toHaveAttribute("aria-pressed", "true");
  const compare = panel.locator(".models-compare");
  await expect(compare).toContainText("Ahora: claude-opus-5-5 · 8 de 8 bien");
  await expect(compare).toContainText("Nuevo: z-ai/glm-5.2 · Sin evaluar todavía");
  await expect(compare.getByRole("button", { name: "Usar este modelo" })).toBeDisabled();
  // Without the key it says where to put it.
  await compare.getByRole("button", { name: "Evaluar" }).click();
  await expect(compare.locator(".decide-error")).toHaveText(
    "Pon antes tu clave de OpenRouter en Claves.",
  );
  await compare.getByRole("button", { name: "Evaluar" }).click();
  await expect(compare).toContainText("Evaluando con casos inventados");
  await expect(compare.getByRole("button", { name: "Evaluar" })).toBeDisabled();
  // The page looks again while it runs, and shows the result next to the current one's.
  await expect(compare).toContainText("7 de 8 bien · 1 equivocado · La prueba costó 0,012 $", {
    timeout: 8000,
  });
  await page.screenshot({ path: `${SHOTS}/models-change.png` });
  await compare.getByRole("button", { name: "Usar este modelo" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Agente/ }).locator(".use-model")).toHaveText(
    "glm-5.2",
  );
  expect(await requests(page, "POST api/agent/models")).toEqual([
    'POST api/agent/models/evaluate {"role":"planner","connection":"openrouter","model":"z-ai/glm-5.2","zdr":true}',
    'POST api/agent/models/evaluate {"role":"planner","connection":"openrouter","model":"z-ai/glm-5.2","zdr":true}',
  ]);
  expect(await requests(page, "PUT api/agent/models")).toEqual([
    'PUT api/agent/models/roles/planner {"connection":"openrouter","model":"z-ai/glm-5.2","zdr":true}',
  ]);
});

test("readers only see models that answer a fixed form; the decider only Jev; Escape closes the panel", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/models": [MODELS],
      "GET api/agent/models/catalogue": [MODELS_CATALOGUE],
    },
  });
  await openModels(page);
  await page.getByRole("button", { name: /^Lector/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  const panel = page.locator(".models-panel");
  await expect(panel.locator(".models-option")).toHaveCount(3);
  await expect(panel).not.toContainText("sin esquema");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Escape closed the use only, not the section.
  await expect(page.locator(".models-page")).toBeVisible();
  await page.getByRole("button", { name: /^Decisor/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  await expect(panel.locator(".models-option .models-name")).toHaveText([
    "typesafe/jev-1.14",
    "jev-1.14.0",
  ]);
  await expect(panel.getByRole("textbox", { name: "Buscar un modelo" })).toHaveCount(0);
});

test("the budget and a key: changed in «Modelos», the key never shown", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/models": [MODELS],
      "PUT api/agent/models/budget": [{ ...MODELS, budget: { monthlyEur: 15, warnAt: 0.9 } }],
      "PUT api/agent/models/keys/:connection": [
        {
          ...MODELS,
          connections: MODELS.connections.map((c) =>
            c.connection === "typesafe" ? { ...c, mine: true } : c,
          ),
        },
      ],
    },
  });
  await openModels(page);
  await page.getByRole("button", { name: "Cambiar el presupuesto" }).click();
  await page.getByRole("textbox", { name: "Al mes (€)" }).fill("15");
  await page.getByRole("textbox", { name: "Avisar al (%)" }).fill("90");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator(".models-page .kpi").first()).toContainText("de 15,00 €");
  await expect(page.locator(".models-spend")).toContainText("aviso al 90 %");

  await page.getByRole("button", { name: /^Claves/ }).click();
  const typesafe = page.locator(".models-conn", { hasText: "TypeSafe" });
  await typesafe.getByRole("button", { name: "Poner tu clave" }).click();
  const key = typesafe.getByRole("textbox", { name: "Clave de TypeSafe" });
  await expect(key).toHaveAttribute("type", "password");
  await key.pressSequentially("clave-inventada-de-ejemplo-123");
  await typesafe.getByRole("button", { name: "Guardar" }).click();
  await expect(typesafe).toContainText("TypeSafe · Tu clave");
  await expect(typesafe.getByRole("button", { name: "Quitar tu clave" })).toBeVisible();
  expect(await requests(page, "PUT api/agent/models")).toEqual([
    'PUT api/agent/models/budget {"monthlyEur":15,"warnAt":0.9,"usdToEur":0.9}',
    'PUT api/agent/models/keys/typesafe {"key":"clave-inventada-de-ejemplo-123"}',
  ]);
});

test("«Uso de la IA»: blocks over Boni's records; a click lists what a number or a bar counts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { pages: [TEMPLATE("uso-ia")] });
  await openInTree(page, "Uso de la IA");
  const calls = page.locator(".blk-number").nth(1);
  await expect(calls.locator(".kpi-value")).not.toHaveText("—");
  const n = Number((await calls.locator(".kpi-value").innerText()).replace(/\D/g, ""));
  expect(n).toBeGreaterThan(0);
  await expect(page.locator(".blk-number").first()).toContainText("€");
  // The rows a number counts: as many as it says, read only (Boni's own).
  await calls.click();
  const panel = page.locator(".side-panel");
  await expect(panel.locator("h2")).toHaveText("Lo que cuenta");
  await expect(panel.locator(".rows-panel-count")).toContainText(`Llamadas a modelos · ${n} filas`);
  await expect(panel.locator("button.rows-panel-row")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/uso-ia-rows.png` });
  // One bar: only its rows, and they add up to it.
  const bar = page.locator(".blk-bars").last().locator(".barlist-row").first();
  const value = Number((await bar.locator(".barlist-value").innerText()).replace(/\D/g, ""));
  const name = await bar.locator(".barlist-label").innerText();
  await bar.click();
  await expect(panel.locator(".rows-panel-count")).toContainText(`${name} · ${value} fila`);
  await expect(panel.locator(".rows-panel-list li")).toHaveCount(value);
  // The block's menu stays on its handle and the right click.
  await page.keyboard.press("Escape");
  await calls.click({ button: "right" });
  await expect(page.getByRole("menuitemradio", { name: "Modificar…" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a template page is modified like any page, its changes listed, restored as Boni's with Undo", async ({
  page,
}) => {
  await openApp(page, "/?still", { pages: [TEMPLATE("uso-ia")] });
  await openInTree(page, "Uso de la IA");
  const pill = page.locator(".template-head .system-pill");
  await expect(pill).toHaveText("De Boni");
  const blocks = page.locator(".blk-number");
  await blocks.first().click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(blocks).toHaveCount(3);
  await expect(pill).toHaveText("Modificada");
  await expect.poll(async () => (await requests(page, "PUT api/pages/uso-ia")).length).toBe(1);
  await pill.click();
  await expect(page.locator(".system-changes li")).toHaveText(["−Quitado: Cifra «Gasto en IA»"]);
  await page.screenshot({ path: `${SHOTS}/uso-ia-modified.png` });
  await page.getByRole("button", { name: "Restaurar la de Boni" }).click();
  await expect(pill).toHaveText("De Boni");
  await expect(blocks).toHaveCount(4);
  // Undo in the notice: the user's version again.
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(blocks).toHaveCount(3);
  await expect(pill).toHaveText("Modificada");
});

test("«Modelos»: the declared flow with its numbers; a model's node names its model and opens its use", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: { "GET api/agent/models": [MODELS], "GET api/agent/pipeline": [FLOW] },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await page.getByRole("radio", { name: "Modelos" }).click();
  const canvas = page.locator(".flow-canvas");
  const cards = canvas.locator(".fl-node");
  await expect(cards).toHaveCount(19);
  for (const name of ["Correo", "Lectora", "Decisora", "Bandeja", "Tú", "Planificadora"])
    await expect(cards.locator(".fl-name", { hasText: name })).toHaveCount(1);
  // A source says what came in; a model its model, its calls and their cost; an arrow how many went through.
  await expect(cards.filter({ hasText: "Correo" })).toContainText("42 correos");
  const reader = cards.filter({ hasText: "Lectora" });
  await expect(reader).toContainText("deepseek/deepseek-v4.1-flash");
  await expect(reader).toContainText("40 llamadas");
  await expect(reader).toContainText("$");
  await expect(canvas.locator(".react-flow__edge-text", { hasText: "42 correos" })).toHaveCount(1);
  await expect(canvas.locator(".react-flow__edge-text", { hasText: "12 propuestas" })).toHaveCount(
    1,
  );
  await expect(cards.filter({ hasText: "Decisora" })).toContainText("acierto 3 de 4");
  await page.screenshot({ path: "e2e-boni/screenshots/models-flow.png" });
  // The period: the numbers of 30 days asked again.
  await page.getByRole("radio", { name: "30 días" }).click();
  await expect.poll(async () => (await requests(page, "GET api/agent/pipeline")).length).toBe(2);
  expect((await requests(page, "GET api/agent/pipeline")).pop()).toContain("days=30");
  // A click on a model's node opens its use below, as a click on its card does.
  await reader.locator(".fl-name").click();
  await expect(page.locator(".models-page .models-settings-role")).toBeVisible();
  await expect(page.locator(".models-page .models-settings-role")).toContainText("Lector");
});

test("«Flujos»: the editor draws a flow and changes it: a step's collection, saved as his version, back to Boni's; a step added", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/models": [MODELS],
      "GET api/agent/pipeline": [FLOW],
      "GET api/agent/flows": [FLOWS],
      "GET api/agent/flows/:id": [FLOW_DETAIL],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
      "PUT api/agent/flows/:id": [FLOW_DETAIL_SAVED],
      "POST api/agent/flows/:id/revert": [{ ...FLOW_DETAIL, version: 5 }],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Flujos");
  const row = page.locator(".flows-table tbody tr");
  await expect(row).toHaveCount(1);
  for (const text of ["Leer correo", "Nuevo correo", "Encendido", "42", "v3"])
    await expect(row.first()).toContainText(text);
  // The flow drawn from its plan: the trigger with what it binds, each step named as the flows name it.
  const canvas = page.locator(".flow-editor .flow-canvas");
  await expect(canvas.locator(".fl-node")).toHaveCount(5);
  await expect(canvas.locator(".fl-node.source")).toContainText("Nuevo correo");
  await expect(canvas.locator(".fl-node.source")).toContainText("$mail");
  for (const name of ["Leer", "Lectora", "Rellenadora", "Crear"])
    await expect(
      canvas.locator(".fl-node .fl-name", { hasText: new RegExp(`^${name}$`) }),
    ).toHaveCount(1);
  const create = canvas.locator(".fl-node", {
    has: page.locator(".fl-name", { hasText: /^Crear$/ }),
  });
  for (const text of ["Docencia", "12 veces", "12 propuestas", "Para cada"])
    await expect(create).toContainText(text);
  const save = page.getByRole("button", { name: "Guardar", exact: true });
  await expect(save).toBeDisabled();
  // Its collection changed in its panel: the fields follow their roles, the collection's inputs its key.
  await create.locator(".fl-name").click();
  const panel = page.locator(".flow-step-panel");
  await expect(panel.locator("h3")).toHaveText("Crear");
  const collection = panel.locator(".flow-setting", { hasText: "Colección" }).locator("select");
  await expect(collection).toHaveValue("docencia");
  await collection.selectOption("gestiones");
  await expect(create).toContainText("Gestiones");
  await expect(panel.locator(".flow-value-row select").first()).toHaveValue("title");
  await page.screenshot({ path: `${SHOTS}/flow-editor.png` });
  await expect(save).toBeEnabled();
  await save.click();
  const body = await page.waitForFunction(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).find((b) =>
      b.startsWith("PUT api/agent/flows/leer-correo "),
    ),
  );
  const sent = JSON.parse(String(await body.jsonValue()).replace(/^PUT \S+ /, "")) as {
    base: number;
    plan: {
      steps: { id: string; args?: { type?: unknown; values?: unknown }; params?: unknown }[];
    };
  };
  expect(sent.base).toBe(3);
  const made = sent.plan.steps.find((x) => x.id === "n0_tasks");
  expect(made?.args?.type).toEqual({ lit: "gestiones" });
  expect(JSON.stringify(made?.args?.values)).toContain('"$prefill.gestiones"');
  expect(JSON.stringify(made?.args?.values)).toContain('{"lit":"dia"}');
  expect(sent.plan.steps.find((x) => x.id === "n0_tasks_f")?.params).toEqual({
    fields: { ref: "$fill.gestiones" },
  });
  // His version now: «Volver al de Boni» in the flow's menu.
  await page.locator(".flow-toolbar").getByRole("button", { name: "Más opciones" }).click();
  await page.getByRole("menuitemradio", { name: "Volver al de Boni" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
          b.startsWith("POST api/agent/flows/leer-correo/revert"),
        ),
      ),
    )
    .toEqual(['POST api/agent/flows/leer-correo/revert {"preset":true}']);
  // A step added after the one chosen: «Avisar», its panel open; what it says, a value of an earlier step.
  await canvas.locator(".fl-node .fl-name", { hasText: /^Lectora$/ }).click();
  await page.getByRole("button", { name: "Añadir paso" }).click();
  await page.getByRole("menuitemradio", { name: "Avisar" }).click();
  await expect(panel.locator("h3")).toHaveText("Avisar");
  await expect(canvas.locator(".fl-node")).toHaveCount(6);
  const text = panel.locator(".flow-setting", { hasText: "Texto" });
  await text.getByRole("combobox", { name: "Texto: Tipo de valor" }).selectOption("ref");
  await text.getByRole("combobox", { name: "Texto", exact: true }).fill("$m.asunto");
  await expect(save).toBeEnabled();
  // The period asks the flow again.
  await page.getByRole("radio", { name: "30 días" }).click();
  await expect
    .poll(async () => (await requests(page, "GET api/agent/flows/leer-correo")).length)
    .toBeGreaterThan(1);
});

test("the editor gives control (task 70): «Añadir paso» with a search and groups, a node's right button, «Entra» and «Sale», tried up to a step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS],
      "GET api/agent/flows/:id": [FLOW_DETAIL],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
      "POST api/agent/flows/:id/test": [FLOW_TEST],
    },
    // A test takes a moment: «Probar hasta aquí» waits greyed while one runs.
    slow: { path: "api/agent/flows/leer-correo/test", ms: 1500 },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  const canvas = page.locator(".flow-editor .flow-canvas");
  const nodes = canvas.locator(".fl-node");
  await expect(nodes).toHaveCount(5);
  const panel = page.locator(".flow-step-panel");
  // «Añadir paso»: the kinds in groups by what they do, and a search that takes the keys at once («avis»: Avisar).
  await page.getByRole("button", { name: "Añadir paso" }).click();
  const add = page.getByRole("dialog", { name: "Añadir paso" });
  await expect(add.locator(".menu-head")).toHaveText([
    "Leer",
    "Decidir",
    "Datos",
    "Avisar",
    "Preguntar",
    "Responder",
  ]);
  await expect(add.getByRole("textbox", { name: "Buscar paso" })).toBeFocused();
  await page.keyboard.type("avis", { delay: 15 });
  await expect(add.getByRole("menuitemradio")).toHaveText(["Avisar"]);
  await page.screenshot({ path: `${SHOTS}/flow-add-step.png` });
  await page.keyboard.press("Enter");
  await expect(panel.locator("h3")).toHaveText("Avisar");
  await expect(nodes).toHaveCount(6);
  // The right button on a node: its actions where the pointer is. «Duplicar»: a copy right after it, chosen.
  const reader = canvas.locator('.react-flow__node[data-id="r"]');
  await reader.click({ button: "right" });
  const menu = page.getByRole("dialog", { name: "Acciones del paso" });
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Abrir",
    "Duplicar",
    "Probar hasta aquí",
    "Quitar",
  ]);
  await page.screenshot({ path: `${SHOTS}/flow-node-menu.png` });
  await menu.getByRole("menuitemradio", { name: "Duplicar" }).click();
  await expect(nodes).toHaveCount(7);
  await expect(panel.locator(".flow-step-id")).toHaveText("r_2");
  await canvas.locator('.react-flow__node[data-id="r_2"]').click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Quitar" }).click();
  await expect(nodes).toHaveCount(6);
  // The right button opens nothing by itself: «Abrir» opens its panel. The trigger's menu only opens it.
  await expect(panel).toHaveCount(0);
  await canvas.locator('.react-flow__node[data-id="trigger"]').click({ button: "right" });
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Abrir"]);
  await page.keyboard.press("Escape");
  await reader.click({ button: "right" });
  await expect(panel).toHaveCount(0);
  await page.getByRole("menuitemradio", { name: "Abrir" }).click();
  // Its panel: «Entra», what it takes and what each value is; «Sale», what it gives the steps after it.
  await expect(panel.locator("h3")).toHaveText("Lectora");
  const entra = panel.getByRole("region", { name: "Entra" });
  await expect(entra.locator("li").first()).toHaveText(/^\$text\s*texto$/);
  await expect(entra.locator("li")).toHaveCount(5);
  await expect(panel.getByRole("region", { name: "Sale" }).locator("li")).toHaveText([
    /^\$r\s*registro$/,
    /^\$r\.all\s*lista$/,
    /^\$r\.tasks\s*lista$/,
    /^\$r\.events\s*lista$/,
  ]);
  // «Probar hasta aquí»: the flow as far as it, nothing after; its panel says what it gave.
  await reader.click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Probar hasta aquí" }).click();
  await reader.click({ button: "right" });
  await expect(page.getByRole("menuitemradio", { name: "Probar hasta aquí" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".flow-test-bar")).toContainText("hasta «Lectora»");
  const sent = await page.evaluate(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
      b.startsWith("POST api/agent/flows/leer-correo/test"),
    ),
  );
  const tried = JSON.parse((sent.at(-1) ?? "").replace(/^\S+ \S+ /, "")) as {
    plan: { steps: { id: string }[] };
  };
  expect(tried.plan.steps.map((x) => x.id)).toEqual(["m", "r"]);
  await expect(panel.getByRole("region", { name: "En la prueba" })).toHaveText(/2 elementos/);
  await page.screenshot({ path: `${SHOTS}/flow-step-io.png` });
});

test("steps connected by dragging as a person does (task 78): a step's dot to anywhere on another, or to the canvas for a new step; the canvas's right button adds one where it was", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS],
      "GET api/agent/flows/:id": [FLOW_DETAIL],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  const canvas = page.locator(".flow-editor .flow-canvas");
  const nodes = canvas.locator(".fl-node");
  await expect(nodes).toHaveCount(5);
  const node = (id: string) => canvas.locator(`.react-flow__node[data-id="${id}"]`);
  const center = async (l: import("@playwright/test").Locator) => {
    const b = await l.boundingBox();
    if (!b) throw new Error("not on screen");
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // The canvas's right button: «Añadir paso» where it was, its search taking the keys.
  const pane = await canvas.locator(".react-flow__pane").boundingBox();
  if (!pane) throw new Error("no canvas");
  // An empty spot of the canvas that is on screen (it may go on below the window): its upper left.
  await page.mouse.click(pane.x + 60, pane.y + 60, { button: "right" });
  const add = page.getByRole("dialog", { name: "Añadir paso" });
  await expect(add.getByRole("textbox", { name: "Buscar paso" })).toBeFocused();
  await page.keyboard.type("avis", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(nodes).toHaveCount(6);
  await expect(node("notify")).toBeVisible();
  // A step's dot shows under the pointer; dragged to anywhere on another step, it asks where that one uses its value.
  await node("m").hover();
  const dot = node("m").locator(".react-flow__handle.source");
  await expect(dot).toHaveCSS("opacity", "1");
  const from = await center(dot);
  const to = await center(node("notify"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // While drawing, every step shows where it lands.
  await expect(node("notify").locator(".react-flow__handle.target")).toHaveCSS("opacity", "1");
  await page.mouse.up();
  const link = page.getByRole("menu", { name: "Usar en" });
  await expect(link).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/flow-connect.png` });
  const edges = canvas.locator(".react-flow__edge");
  const before = await edges.count();
  // Each place named as the step's panel names it («Texto», not its key).
  await link.getByRole("menuitemradio", { name: "Texto" }).click();
  await expect(link).toHaveCount(0);
  await expect(edges).toHaveCount(before + 1);
  // Left on the canvas: a new step there, which then says where it takes the value.
  await node("r").hover();
  const start = await center(node("r").locator(".react-flow__handle.source"));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(pane.x + 60, pane.y + 160, { steps: 12 });
  await page.mouse.up();
  await expect(add.getByRole("textbox", { name: "Buscar paso" })).toBeFocused();
  await page.keyboard.type("consul", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(nodes).toHaveCount(7);
  await expect(link).toBeVisible();
  await link.getByRole("menuitemradio").first().click();
  await expect(link).toHaveCount(0);
  // The trigger shows no dot (its values are the flow's inputs, taken by their names), but its arrows start at it.
  await node("trigger").hover();
  await expect(node("trigger").locator(".react-flow__handle.source")).toHaveCSS("opacity", "0");
  const trigger = await node("trigger").boundingBox();
  const fromTrigger = await canvas
    .locator('.react-flow__edge[data-id^="trigger>"] path')
    .first()
    .boundingBox();
  if (!trigger || !fromTrigger) throw new Error("no trigger arrow");
  expect(fromTrigger.y).toBeGreaterThanOrEqual(trigger.y + trigger.height - 4);
});

test("«Probar»: the draft run dry with the latest mail; each step says what it gave or would do; nothing written", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS],
      "GET api/agent/flows/:id": [FLOW_DETAIL],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
      "POST api/agent/flows/:id/test": [FLOW_TEST],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  const canvas = page.locator(".flow-editor .flow-canvas");
  await expect(canvas.locator(".fl-node")).toHaveCount(5);
  await page.getByRole("button", { name: "Probar", exact: true }).click();
  await expect(page.locator(".flow-test-bar")).toContainText(
    "Prueba con «Informe y sala» · sin escribir nada",
  );
  const create = canvas.locator(".fl-node", {
    has: page.locator(".fl-name", { hasText: /^Crear$/ }),
  });
  await expect(create).toContainText("Propondría: Crear en Docencia «Enviar el informe»");
  await expect(
    canvas.locator(".fl-node", { has: page.locator(".fl-name", { hasText: /^Lectora$/ }) }),
  ).toContainText("→ 2 elementos");
  const sent = await page.evaluate(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).find((b) =>
      b.startsWith("POST api/agent/flows/leer-correo/test"),
    ),
  );
  expect(sent).toContain('"plan"');
  await page.screenshot({ path: `${SHOTS}/flow-test.png` });
  // Taken away: the canvas as it was.
  await page.getByRole("button", { name: "Quitar la prueba" }).click();
  await expect(page.locator(".flow-test-bar")).toHaveCount(0);
  await expect(create).not.toContainText("Propondría");
});

test("a daily summary drawn without code: the trigger «Programado», every day at 08:00, saved as such", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS_WITH_SUMMARY],
      "GET api/agent/flows/:id": [FLOW_DETAIL, FLOW_SUMMARY],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [{ problems: [], refs: {} }],
      "PUT api/agent/flows/:id": [
        {
          ...FLOW_SUMMARY,
          version: 2,
          trigger: { schedule: { every: "day", at: "07:30" } },
          inputs: [{ id: "today", what: "text" }],
        },
      ],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  const rows = page.locator(".flows-table tbody tr");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole("button", { name: "Resumen diario" }).click();
  const canvas = page.locator(".flow-editor .flow-canvas");
  // By hand is «Disparado por el usuario» (Juan, 2026-11-05: «en vez de "A mano"»; task 78).
  await expect(canvas.locator(".fl-node.source")).toContainText("Disparado por el usuario");
  // The trigger's panel: «Programado», every day; the node says when, and what it gives ($today).
  await canvas.locator(".fl-node.source .fl-name").click();
  const panel = page.locator(".flow-step-panel");
  await panel
    .locator(".flow-setting", { hasText: "Disparador" })
    .locator("select")
    .selectOption("schedule");
  await expect(canvas.locator(".fl-node.source")).toContainText("Cada día a las 08:00");
  await expect(canvas.locator(".fl-node.source")).toContainText("$today");
  await panel.getByRole("combobox", { name: "Hora" }).selectOption("07");
  await panel.getByRole("combobox", { name: "Minuto" }).selectOption("30");
  await expect(canvas.locator(".fl-node.source")).toContainText("Cada día a las 07:30");
  // Every Monday, then back to every day.
  const every = panel.locator(".flow-setting", { hasText: "Cuándo" }).locator("select");
  await every.selectOption("week");
  await expect(canvas.locator(".fl-node.source")).toContainText("Cada lunes a las 07:30");
  await every.selectOption("day");
  await page.screenshot({ path: `${SHOTS}/flow-schedule.png` });
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const body = await page.waitForFunction(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).find((b) =>
      b.startsWith("PUT api/agent/flows/resumen-diario "),
    ),
  );
  const sent = JSON.parse(String(await body.jsonValue()).replace(/^PUT \S+ /, "")) as {
    trigger: unknown;
  };
  expect(sent.trigger).toEqual({ schedule: { every: "day", at: "07:30" } });
  // A flow never runs another: «Ejecutar flujo» is not offered as a step.
  await page.getByRole("button", { name: "Añadir paso" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Avisar" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Ejecutar flujo" })).toHaveCount(0);
});

test("a flow a model proposed waits in the inbox, drawn with what it changes; «Activar» turns it on", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [{ proposals: [FLOW_PROPOSAL, FLOW_CHANGE] }],
      "POST api/agent/proposals/:id/accept": [DONE],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page
    .locator(".chat-tools")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const cards = page.locator(".proposal.flow-proposal");
  await expect(cards).toHaveCount(2);
  const made = cards.first();
  await expect(made.locator(".inbox-kind")).toHaveText("Flujo propuesto");
  await expect(made.locator("h3")).toHaveText("Resumen del lunes");
  await expect(made.locator(".inbox-what")).toHaveText("Cada lunes a las 08:00 · 2 pasos");
  await expect(made.locator(".fl-node")).toHaveCount(3);
  await expect(made.locator(".fl-node.source")).toContainText("$today");
  // A change: what it adds and what it takes away, said and drawn.
  const change = cards.nth(1);
  await expect(change.locator("h3")).toHaveText("Cambio en «Resumen diario»");
  await expect(change.locator(".inbox-what")).toContainText("1 paso nuevo · 1 quitado");
  await expect(change.locator(".fl-card.new")).toContainText("Nuevo");
  await expect(change.locator(".fl-card.removed")).toContainText("Avisar");
  await page.screenshot({ path: `${SHOTS}/flow-proposal.png` });
  await made.getByRole("button", { name: "Activar" }).click();
  await expect(cards).toHaveCount(1);
  expect(await requests(page, "POST api/agent/proposals/")).toEqual([
    "POST api/agent/proposals/pf1/accept",
  ]);
});
