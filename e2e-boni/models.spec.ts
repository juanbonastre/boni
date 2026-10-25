import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  AUDIT_SUMMARY,
  MODELS,
  MODELS_CATALOGUE,
  MODELS_EVALUATED,
  MODELS_EVALUATING,
  MODELS_USED,
} from "./agent-scenarios.ts";
import { openApp, recorded } from "./fixtures.ts";

/**
 * «Modelos» (Juan, 2026-10-24): a page of Boni's blocks. The month's numbers, the four uses with the model in large
 * type, the charts beside them; a use opens its panel, the spending number its breakdown and budget (from its menu).
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const requests = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

test("the month's numbers, each use with its model, and the charts; a click shows more", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: { "GET api/agent/models": [MODELS], "GET api/data/audit/summary": [AUDIT_SUMMARY] },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Modelos" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Modelos");
  const kpis = page.locator(".kpi");
  await expect(kpis).toHaveCount(4);
  const spend = page.locator(".kpi").first();
  await expect(spend).toContainText("3,42 €");
  await expect(spend).toContainText("de 10,00 €");
  await expect(kpis.nth(1)).toContainText("554");
  // What the models (and the MCP) read and changed this month, from the audit.
  await expect(kpis.nth(2)).not.toContainText("—");
  const reader = page.getByRole("button", { name: /^Lector/ });
  await expect(reader.locator(".use-model")).toHaveText("deepseek-v4.1-flash");
  await expect(reader.locator(".models-badge")).toHaveText("No guarda tus datos");
  await expect(reader).toContainText("0,74 € · 512 llamadas");
  await expect(page.getByRole("button", { name: /^Agente/ })).toContainText(
    "Borra lo que recibe en 30 días",
  );
  await expect(page.locator(".dash-legend").first()).toContainText("claude-opus-5-5");
  await expect(page.locator(".barlist-row")).toHaveText([
    /deepseek-v4\.1-flash\s*513/,
    /claude-opus-5-5\s*41/,
  ]);
  await page.screenshot({ path: `${SHOTS}/models.png` });

  // A click on the number opens its menu (as every block's); the spending and budget open from it.
  await spend.click();
  await page.getByRole("menuitemradio", { name: "Gasto y presupuesto…" }).click();
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
  await page.keyboard.press("Escape");

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
  await page.screenshot({ path: `${SHOTS}/models-open.png`, fullPage: true });
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
  await page.locator(".sidebar").getByRole("button", { name: "Modelos" }).click();
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
  await page.locator(".sidebar").getByRole("button", { name: "Modelos" }).click();
  await page.getByRole("button", { name: /^Lector/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  const panel = page.locator(".models-panel");
  await expect(panel.locator(".models-option")).toHaveCount(3);
  await expect(panel).not.toContainText("sin esquema");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Escape closed the panel only, not the page.
  await expect(page.locator(".topbar h1")).toHaveText("Modelos");
  await page.getByRole("button", { name: /^Decisor/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  await expect(panel.locator(".models-option .models-name")).toHaveText([
    "typesafe/jev-1.14",
    "jev-1.14.0",
  ]);
  await expect(panel.getByRole("textbox", { name: "Buscar un modelo" })).toHaveCount(0);
});

test("the budget and a key: changed from the page, the key never shown", async ({ page }) => {
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
  await page.locator(".sidebar").getByRole("button", { name: "Modelos" }).click();
  await page.locator(".kpi").first().click();
  await page.getByRole("menuitemradio", { name: "Gasto y presupuesto…" }).click();
  await page.getByRole("button", { name: "Cambiar el presupuesto" }).click();
  await page.getByRole("textbox", { name: "Al mes (€)" }).fill("15");
  await page.getByRole("textbox", { name: "Avisar al (%)" }).fill("90");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.locator(".kpi").first()).toContainText("de 15,00 €");
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

test("«Modelos» is a page of blocks: modified, its changes listed, restored as Boni's with Undo", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: { "GET api/agent/models": [MODELS], "GET api/data/audit/summary": [AUDIT_SUMMARY] },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Modelos" }).click();
  const pill = page.locator(".system-head .system-pill");
  await expect(pill).toHaveText("De Boni");
  // The keys block is all one button: its menu opens with a right click (or its handle); deleting it makes the
  // page the user's.
  const keys = page.locator(".blk-model-keys");
  await keys.click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(keys).toHaveCount(0);
  await expect(pill).toHaveText("Modificada");
  await expect
    .poll(async () => (await requests(page, "PUT api/pages/system/models")).length)
    .toBe(1);
  await pill.click();
  await expect(page.locator(".system-changes li")).toHaveText(["−Quitado: Claves"]);
  await page.screenshot({ path: `${SHOTS}/models-modified.png` });
  await page.getByRole("button", { name: "Restaurar la de Boni" }).click();
  await expect(pill).toHaveText("De Boni");
  await expect(keys).toHaveCount(1);
  expect(await requests(page, "DELETE api/pages/system/models")).toHaveLength(1);
  // Undo in the notice: the user's version again.
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(keys).toHaveCount(0);
  await expect(pill).toHaveText("Modificada");
});
