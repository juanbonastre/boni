import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  MODELS,
  MODELS_CATALOGUE,
  MODELS_EVALUATED,
  MODELS_EVALUATING,
  MODELS_USED,
} from "./agent-scenarios.ts";
import { openApp, recorded } from "./fixtures.ts";

/**
 * «Modelos» (Juan, 2026-10-24, option A): the month's spending, which model does each role and the connections,
 * each folded in one row that a click opens; «Cambiar» opens a panel to pick, evaluate and use another model.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const requests = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

test("spending, each role and the connections, folded; a click shows more", async ({ page }) => {
  await openApp(page, "/?still", { agent: { "GET api/agent/models": [MODELS] } });
  await page.locator(".sidebar").getByRole("button", { name: "Modelos" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Modelos");
  const spend = page.getByRole("button", { name: /^Gasto de octubre/ });
  await expect(spend).toContainText("3,42 € de 10,00 €");
  const reader = page.getByRole("button", { name: /^Leer correos/ });
  await expect(reader).toContainText("deepseek/deepseek-v4.1-flash · OpenRouter");
  await expect(reader.locator(".models-badge")).toHaveText("No guarda tus datos");
  await expect(page.getByRole("button", { name: /^Entender lo que pides/ })).toContainText(
    "Borra lo que recibe en 30 días",
  );
  await expect(page.locator(".models-more")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/models.png` });

  await spend.click();
  const more = page.locator(".models-card").first().locator(".models-more");
  await expect(more).toContainText("Evaluación: Leer correos · deepseek/deepseek-v4.1-flash");
  await expect(more).toContainText("512 llamadas · 3 sin precio conocido");
  await expect(more.locator(".models-day")).toHaveCount(24);
  await expect(more).toContainText("Presupuesto: 10,00 € al mes, aviso al 80 %");

  await reader.click();
  const card = page.locator(".models-card", { has: reader });
  await expect(card).toContainText("Lee cada correo y dice qué te piden");
  await expect(card).toContainText("OpenRouter solo lo envía a proveedores que no guardan");
  await expect(card).toContainText("Elegido por ti");
  await expect(card).toContainText("Este mes: 0,74 € en 512 llamadas");
  await expect(card).toContainText("Evaluación: 19 de 20 bien");
  await card.getByRole("button", { name: "Ver los casos" }).click();
  await expect(card.locator(".models-cases li.fail")).toHaveCount(1);
  await expect(card.locator(".models-cases li.fail")).toContainText("colección equivocada");

  await page.getByRole("button", { name: /^Conexiones/ }).click();
  const conns = page.locator(".models-card", {
    has: page.getByRole("button", { name: /^Conexiones/ }),
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
  await page.getByRole("button", { name: /^Entender lo que pides/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  const panel = page.locator(".models-panel");
  await expect(panel.locator("h2")).toHaveText("Entender lo que pides");
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
    "Pon antes tu clave de OpenRouter en Conexiones.",
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
  await expect(page.getByRole("button", { name: /^Entender lo que pides/ })).toContainText(
    "z-ai/glm-5.2 · OpenRouter",
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
  await page.getByRole("button", { name: /^Leer correos/ }).click();
  await page.getByRole("button", { name: "Cambiar" }).click();
  const panel = page.locator(".models-panel");
  await expect(panel.locator(".models-option")).toHaveCount(3);
  await expect(panel).not.toContainText("sin esquema");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Escape closed the panel only, not the page.
  await expect(page.locator(".topbar h1")).toHaveText("Modelos");
  await page.getByRole("button", { name: /^Leer correos/ }).click();
  await page.getByRole("button", { name: /^Decidir entre opciones/ }).click();
  await page
    .locator(".models-card", { hasText: "Decidir entre opciones" })
    .getByRole("button", { name: "Cambiar" })
    .click();
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
  await page.getByRole("button", { name: /^Gasto de octubre/ }).click();
  await page.getByRole("button", { name: "Cambiar el presupuesto" }).click();
  await page.getByRole("textbox", { name: "Al mes (€)" }).fill("15");
  await page.getByRole("textbox", { name: "Avisar al (%)" }).fill("90");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Gasto de octubre/ })).toContainText(
    "3,42 € de 15,00 €",
  );
  await expect(page.locator(".models-card").first()).toContainText("aviso al 90 %");

  await page.getByRole("button", { name: /^Conexiones/ }).click();
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
