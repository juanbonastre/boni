import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  MODELS,
  MODELS_CATALOGUE,
  MODELS_EVALUATED,
  MODELS_EVALUATING,
  MODELS_USED,
} from "./agent-scenarios.ts";
import { openApp, recorded, TEMPLATE } from "./fixtures.ts";

/**
 * Boni's models (design audit, Juan 2026-10-25): what configures them is Ajustes → Modelos (each use with its model in
 * large type, a click opens it; the month's spending and the budget; the keys). What they did is the template page
 * «Uso de la IA», ordinary blocks over Boni's own read-only collections; a click on a number lists what it counts.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const requests = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

/** Ajustes → Modelos. */
async function openModels(page: Page) {
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await page.locator(".modal").getByRole("tab", { name: "Modelos" }).click();
  await page.locator(".use-card").first().waitFor();
}

test("Ajustes → Modelos: each use with its model, the month's spending and budget, the keys", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: { "GET api/agent/models": [MODELS] } });
  // Not in the sidebar any more: in Ajustes.
  await expect(page.locator(".sidebar").getByRole("button", { name: "Modelos" })).toHaveCount(0);
  await openModels(page);
  const spend = page.locator(".modal .kpi").first();
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
  await expect(page.locator(".modal")).toBeVisible();

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
  // Escape closed the use only, not Ajustes.
  await expect(page.locator(".modal")).toBeVisible();
  await page.getByRole("button", { name: /^Decisor/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  await expect(panel.locator(".models-option .models-name")).toHaveText([
    "typesafe/jev-1.14",
    "jev-1.14.0",
  ]);
  await expect(panel.getByRole("textbox", { name: "Buscar un modelo" })).toHaveCount(0);
});

test("the budget and a key: changed in Ajustes, the key never shown", async ({ page }) => {
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
  await expect(page.locator(".modal .kpi").first()).toContainText("de 15,00 €");
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
  await page.locator(".sidebar").getByRole("button", { name: "Uso de la IA", exact: true }).click();
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
  // The link goes to Ajustes → Modelos.
  await page.getByRole("button", { name: /^Modelos y presupuesto/ }).click();
  await expect(page.locator(".modal").getByRole("tab", { name: "Modelos" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("a template page is modified like any page, its changes listed, restored as Boni's with Undo", async ({
  page,
}) => {
  await openApp(page, "/?still", { pages: [TEMPLATE("uso-ia")] });
  await page.locator(".sidebar").getByRole("button", { name: "Uso de la IA", exact: true }).click();
  const pill = page.locator(".template-head .system-pill");
  await expect(pill).toHaveText("De Boni");
  const link = page.locator(".blk-link");
  await link.click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(link).toHaveCount(0);
  await expect(pill).toHaveText("Modificada");
  await expect.poll(async () => (await requests(page, "PUT api/pages/uso-ia")).length).toBe(1);
  await pill.click();
  await expect(page.locator(".system-changes li")).toHaveText([
    "−Quitado: Enlace «Modelos y presupuesto»",
  ]);
  await page.screenshot({ path: `${SHOTS}/uso-ia-modified.png` });
  await page.getByRole("button", { name: "Restaurar la de Boni" }).click();
  await expect(pill).toHaveText("De Boni");
  await expect(link).toHaveCount(1);
  // Undo in the notice: the user's version again.
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(link).toHaveCount(0);
  await expect(pill).toHaveText("Modificada");
});
