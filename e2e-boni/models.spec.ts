import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  ACCURACY,
  ACCURACY_ON,
  CARD_DETAILED,
  DONE,
  FLOW_BUDGET,
  FLOW_BUDGET_CHECK,
  FLOW_BUDGET_CHECK_NONE,
  FLOW_BUDGET_MINE,
  FLOW_BUDGET_TEST,
  FLOW_CATALOG,
  FLOW_CATALOG_FUNCTIONS,
  FLOW_CHANGE,
  FLOW_CHECK,
  FLOW_DETAIL,
  FLOW_DETAIL_CHOSEN,
  FLOW_DETAIL_SAVED,
  FLOW_PROPOSAL,
  FLOW_SUMMARY,
  FLOW_TEST,
  FLOWS,
  FLOWS_WITH_BUDGET,
  FLOWS_WITH_SUMMARY,
  GUIDE_RULES,
  MAP,
  MAP_BUDGET,
  MAP_CHOSEN,
  MAP_FETCH,
  MAP_TELLS,
  MODELS,
  MODELS_CATALOGUE,
  MODELS_EVALUATED,
  MODELS_EVALUATING,
  MODELS_USED,
  ORIGIN_MAIL,
  ORIGIN_TURN,
  ORIGIN_USER,
  RUN_BOOK,
  RUN_BUDGET,
  RUN_BUDGET_TEST,
  RUN_DAILY,
  RUN_DAILY_TEST,
  RUN_MAIL,
  RUN_MAIL_LANES,
  RUN_MAIL_OLD,
  RUN_TURN_TOLD,
  RUNS,
  RUNS_BUDGET,
  RUNS_DAILY,
  RUNS_DAILY_TEST,
  RUNS_TURN_TOLD,
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

/** Ajustes → Modelos: what configures the models (D-05), its place again since «Modelos» left «Flujos» (§4.4). */
async function openModels(page: Page) {
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await page.locator(".modal").getByRole("tab", { name: "Modelos" }).click();
  await page.locator(".use-card").first().waitFor();
}

/** «Flujos» → its table → a flow on a page of its own (docs/sistema.md §4.4: «Flujos» is one of Boni's collections). */
/** A canvas that has stopped moving (it brings a step just added into view with a short motion). */
async function settled(page: Page) {
  await expect
    .poll(async () => {
      const a = await page.locator(".flow-canvas .react-flow__viewport").getAttribute("style");
      await page.waitForTimeout(120);
      const b = await page.locator(".flow-canvas .react-flow__viewport").getAttribute("style");
      return a === b;
    })
    .toBe(true);
}

async function openFlow(page: Page, name = "Leer correo") {
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  const table = page.getByRole("tab", { name: "Tabla" });
  if ((await table.getAttribute("aria-selected")) !== "true") await table.click();
  await page.locator(".db-table").getByText(name, { exact: true }).click();
  await page.locator(".flow-editor .flow-canvas .fl-node").first().waitFor();
}

test("«Modelos» in Ajustes: each use with its model, the month's spending and budget, the keys", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: { "GET api/agent/models": [MODELS] } });
  await openModels(page);
  // «Flujos» has no «Modelos» any more: one section, «Tabla | Mapa» (docs/sistema.md §4.4, decision 3).
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

test("«Flujos» is one of Boni's collections: «Tabla» and «Mapa»; the map computed, with its numbers, its panel, its centre, its depth, a flow's steps, filters, groups and its period (F8)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/models": [MODELS],
      "GET api/agent/map": [MAP],
      "GET api/agent/flows": [FLOWS_WITH_SUMMARY],
      "GET api/agent/flows/:id": [FLOW_DETAIL],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Flujos");
  // Its views as tabs, as any collection's: «Tabla» first, «Mapa» second; no «Modelos».
  await expect(page.getByRole("tab")).toHaveText(["Tabla", "Mapa"]);
  await expect(page.getByRole("radio", { name: "Modelos" })).toHaveCount(0);
  const rows = page.locator(".db-table tbody tr");
  await expect(rows).toHaveCount(2);
  // The flows on first; what starts each as a person says it; whose version runs.
  for (const text of ["Leer correo", "Llega a Correos", "Encendido", "Boni", "42"])
    await expect(rows.first()).toContainText(text);
  await expect(rows.nth(1)).toContainText("Disparado por el usuario");
  await expect(rows.nth(1)).toContainText("Apagado");
  await page.screenshot({ path: `${SHOTS}/flows-table.png` });

  await page.getByRole("tab", { name: "Mapa" }).click();
  const map = page.locator(".mp-stage");
  // A card by its own name (a flow's line may name another: «Llega a Correos»).
  const card = (name: string) =>
    map.locator(".mp-card", {
      has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
    });
  // Everything joined to something, pages only when asked for: the mail coming in, the collections, the flows,
  // Boni's own work, Juan and Claude.
  for (const name of [
    "Correo",
    "Correos",
    "Tarea",
    "Evento",
    "Gastos",
    "Leer correo",
    "Apuntar gasto",
    "Conversación",
    "Revisar la guía",
    "Bandeja",
    "Tú",
    "Asistente · claude-ejemplo",
  ])
    await expect(card(name).first()).toBeVisible();
  // The Bandeja: what waits in it now.
  await expect(card("Bandeja")).toContainText("3 esperan");
  await expect(card("Agenda")).toHaveCount(0);
  // Each node with its numbers; Boni's own flow says so; a flow's models.
  const leer = card("Leer correo");
  await expect(leer).toContainText("Llega a Correos");
  await expect(leer).toContainText("42 ejecuciones");
  await expect(leer).toContainText("De Boni");
  await expect(leer).toContainText("claude-haiku-4-5");
  await expect(card("Tarea")).toContainText("128 elementos");
  // An arrow's verb and its number; what carries a mail's words is marked.
  await expect(map.locator(".mp-edge-label", { hasText: "trae · 42" })).toHaveClass(/outside/);
  // Marked by a small mail, never by a colour of its own (task 91: «líneas rosas… no sé por qué están resaltadas»).
  await expect(
    map.locator(".mp-edge-label", { hasText: "trae · 42" }).locator(".mp-outside-mark"),
  ).toHaveCount(1);
  expect(
    await map
      .locator(".mp-edge-label", { hasText: "trae · 42" })
      .evaluate((e) => getComputedStyle(e).color),
  ).toBe(
    await map
      .locator(".mp-edge-label", { hasText: "tus decisiones · 9" })
      .evaluate((e) => getComputedStyle(e).color),
  );
  // What «Leer correo» proposes waits in the Bandeja; out of it, what was accepted into each collection.
  await expect(map.locator(".mp-edge-label", { hasText: "propone · 12" })).toBeVisible();
  await expect(map.locator(".mp-edge-label", { hasText: "aceptadas · 7" })).toBeVisible();
  await expect(map.locator(".mp-edge-label", { hasText: "tus decisiones · 9" })).toBeVisible();
  // No arrow's words over a box, nor over other words (task 90: «líneas que tapan items»): those that would be say
  // them when their arrow is lit. Yours into Gastos crosses «Apuntar gasto»: said when Gastos is pointed at.
  const covered = () =>
    page.evaluate(() => {
      const box = (e: Element) => e.getBoundingClientRect();
      const meet = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const boxes = [...document.querySelectorAll(".mp-stage .react-flow__node")]
        .filter((n) => !n.classList.contains("react-flow__node-frame"))
        .map(box);
      const words = [...document.querySelectorAll(".mp-stage .mp-edge-label")].map(box);
      return words.filter(
        (w, i) => boxes.some((b) => meet(w, b)) || words.slice(i + 1).some((x) => meet(w, x)),
      ).length;
    });
  expect(await covered()).toBe(0);
  await expect(map.locator(".mp-edge-label", { hasText: "escribe · 61" })).toHaveCount(0);
  await card("Gastos").hover();
  await expect(map.locator(".mp-edge-label", { hasText: "escribe · 61" })).toBeVisible();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${SHOTS}/flows-map.png` });

  // A click shows its panel: what comes in, what goes out, its numbers; the rest of the map goes quiet.
  await leer.locator(".mp-name").click();
  const panel = page.locator(".mp-panel");
  await expect(panel.locator("h3")).toHaveText("Leer correo");
  await expect(panel).toContainText("12 propuestas · 9 aceptadas");
  await expect(panel.getByRole("region", { name: "Entra" })).toContainText(
    "Correos · pone en marcha · 42",
  );
  await expect(panel.getByRole("region", { name: "Sale" })).toContainText("Bandeja · propone · 12");
  await expect(card("Gastos")).toHaveClass(/dim/);
  await page.screenshot({ path: `${SHOTS}/flows-map-panel.png` });

  // «Poner en el centro»: one arrow before and one after it.
  await panel.getByRole("button", { name: "Poner en el centro" }).click();
  await expect(page.locator(".mp-centre")).toContainText("Leer correo");
  await expect(card("Gastos")).toHaveCount(0);
  await expect(card("Correos")).toBeVisible();
  await expect(card("Tarea")).toBeVisible();
  // One slider, «Profundidad», back and forth (task 90): at 2, the connector that brings the mails too.
  await expect(map.locator(".mp-card.connector")).toHaveCount(0);
  const depth = page.getByRole("slider", { name: "Profundidad" });
  await expect(depth).toHaveAttribute("aria-valuetext", "1");
  await depth.fill("2");
  await expect(map.locator(".mp-card.connector")).toHaveCount(1);
  await expect(page.getByRole("radiogroup", { name: "Antes" })).toHaveCount(0);
  // Its steps, in the order they run, inside its frame, from what starts it, as the editor draws them; a model's
  // step with its calls and their cost in the period; what each does in its tooltip.
  await panel.getByRole("button", { name: "Ver los pasos" }).click();
  await expect(map.locator(".mp-frame.flow")).toContainText("Leer correo");
  await expect(map.locator(".mp-trig .mp-name")).toHaveText("Llega a Correos");
  // What it brings, as the editor names it (never `$mail`).
  await expect(map.locator(".mp-trig")).toContainText("Correo · Texto");
  await expect(map.locator(".mp-trig")).not.toContainText("$");
  await expect(map.locator(".mp-step:not(.mp-trig)")).toHaveCount(4);
  const lectora = map.locator(".mp-step", { hasText: "Lectora" });
  await expect(lectora).toContainText("42 llamadas · 0,21 US$");
  await expect(lectora).toHaveAttribute("title", /Lee el correo y saca lo que te pide hacer/);
  await expect(map.locator(".mp-step", { hasText: "entities" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/flows-map-steps.png` });
  await page.getByRole("button", { name: "Quitar del centro" }).click();
  await expect(card("Gastos")).toBeVisible();
  // Its panel closed: nothing chosen, every arrow says its words.
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await expect(panel).toHaveCount(0);

  // Filters: with pages (Agenda shows Tarea); only what changes data (no «lee», and a page only shows).
  await page.getByRole("button", { name: "Filtros" }).click();
  await page.getByRole("checkbox", { name: "Con páginas" }).check();
  await expect(card("Agenda")).toBeVisible();
  await page.keyboard.press("Escape");
  // An arrow going back (the conversation reads Gastos) says its words when one of its ends is pointed at.
  await expect(map.locator(".mp-edge-label", { hasText: "lee · 30" })).toHaveCount(0);
  await card("Conversación").hover();
  await expect(map.locator(".mp-edge-label", { hasText: "lee · 30" })).toBeVisible();
  await page.mouse.move(5, 5);
  await page.getByRole("button", { name: "Filtros" }).click();
  await page.getByRole("checkbox", { name: "Solo lo que escribe" }).check();
  await expect(card("Agenda")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // No «lee» even when its end is pointed at: the arrow is gone.
  await card("Conversación").hover();
  await expect(map.locator(".mp-edge-label", { hasText: "lee · 30" })).toHaveCount(0);
  await page.mouse.move(5, 5);
  // Every flow unfolded («Por flujo»): still no words over a box or over other words.
  await page.getByRole("combobox", { name: "Agrupar" }).selectOption("flow");
  await expect(map.locator(".mp-frame.flow").first()).toBeVisible();
  await expect.poll(covered).toBe(0);
  // Grouped by collection: Tarea and Evento in a frame named after the collection they are inside.
  await page.getByRole("combobox", { name: "Agrupar" }).selectOption("collection");
  await expect(map.locator(".mp-frame.group", { hasText: "Trabajo" })).toBeVisible();
  // The period: the map asked again for 30 days.
  await page.getByRole("radio", { name: "30 días" }).click();
  await expect
    .poll(async () => (await requests(page, "GET api/agent/map")).at(-1))
    .toContain("days=30");
  // «Abrir» a flow (unfolded: its frame's name chooses it): its page, with the way back to «Flujos».
  await map.locator(".mp-frame.flow .mp-frame-label", { hasText: "Leer correo" }).click();
  await panel.getByRole("button", { name: "Abrir" }).click();
  await expect(page.locator(".flow-crumbs")).toContainText("Leer correo");
  await page.locator(".flow-crumbs").getByRole("button", { name: "Flujos" }).click();
  // The map's lenses stay on this device; its view too.
  await expect(page.getByRole("tab", { name: "Mapa" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Agrupar" })).toHaveValue("collection");
});

test("«Ver en el mapa» from a collection's menu puts it in the centre; a search does too (F8, I-25)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  // The collection's right button in the sidebar.
  await page.locator(".sidebar").getByText("Libros", { exact: true }).click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Ver en el mapa" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Flujos");
  await expect(page.getByRole("tab", { name: "Mapa" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".mp-centre")).toContainText("Libros");
  const map = page.locator(".mp-stage");
  // One arrow before it: who writes in it, with how many; through the Bandeja, the reading that proposes books
  // there, with what it proposed to Libros (1), not to every collection (12).
  await expect(map.locator(".mp-card")).toHaveCount(4);
  await expect(map.locator(".mp-card", { hasText: "Tú" })).toBeVisible();
  await expect(map.locator(".mp-edge-label", { hasText: "escribe · 3" })).toBeVisible();
  await expect(map.locator(".mp-edge-label", { hasText: "propone · 1" })).toBeVisible();
  await expect(map.locator(".mp-edge-label", { hasText: "aceptadas · 1" })).toBeVisible();
  await expect(page.locator(".mp-panel h3")).toHaveText("Libros");
  // A search puts another in the centre: «¿qué pasa cuando llega un correo?», all after the mail.
  await page.getByRole("button", { name: "Quitar del centro" }).click();
  const find = page.getByRole("combobox", { name: "Buscar en el mapa" });
  await find.click();
  await page.keyboard.type("corre", { delay: 15 });
  await expect(page.locator(".mp-find-list [role=option]").first()).toContainText("Correo");
  await page.keyboard.press("Enter");
  await expect(page.locator(".mp-centre")).toContainText("Correo");
  // As deep as the mail reaches, said by its number (task 91: «"5 (max)"», not «Todo»).
  const depth = page.getByRole("slider", { name: "Profundidad" });
  const top = Number(await depth.getAttribute("max"));
  expect(top).toBeGreaterThan(2);
  await depth.fill(String(top));
  await expect(depth).toHaveAttribute("aria-valuetext", `${top} (máx.)`);
  // The way to the Bandeja and on to the guide's reviewer, which learns from the decisions (task 84's criterion).
  for (const name of ["Correos", "Leer correo", "Bandeja", "Tarea", "Evento", "Revisar la guía"])
    await expect(map.locator(".mp-card", { hasText: name }).first()).toBeVisible();
  // What the conversation proposes into Gastos goes through the Bandeja too, but not on the mail's way.
  await expect(map.locator(".mp-card", { hasText: "Gastos" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/flows-map-mail.png` });

  // «¿Quién escribe en Evento?» (docs/sistema.md §4.4): one arrow before it, the Bandeja crossed to who proposes.
  await page.getByRole("button", { name: "Quitar del centro" }).click();
  await find.click();
  await page.keyboard.type("Evento", { delay: 15 });
  await page.keyboard.press("Enter");
  await page.getByRole("slider", { name: "Profundidad" }).fill("1");
  // A card by its own name (a flow's line names another: «Llega a Correos»).
  const card = (name: string) =>
    map.locator(".mp-card", {
      has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
    });
  for (const name of ["Evento", "Bandeja", "Leer correo", "Asistente · claude-ejemplo"])
    await expect(card(name)).toBeVisible();
  for (const name of ["Conversación", "Gastos", "Tarea", "Correos"])
    await expect(card(name)).toHaveCount(0);
  await expect(map.locator(".mp-edge-label", { hasText: "aceptadas · 2" })).toBeVisible();
  // Its own number into Evento (§4.4: «Leer correo (propone, 23)»), not the reading's total.
  await expect(map.locator(".mp-edge-label", { hasText: "propone · 3" })).toBeVisible();
  await expect(map.locator(".mp-edge-label", { hasText: "propone · 12" })).toHaveCount(0);
});

test("a run on the map (F8, task 90): the Registro's «Recorrido» is the map, its flow unfolded from what started it, its way in orange", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_MAIL],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await page.locator(".log-list li").first().locator(".log-head").click();
  // The Registro says it in words; its drawing is the map's: one «Recorrido», no canvas of its own.
  const detail = page.locator(".log-detail");
  await expect(detail.locator(".react-flow")).toHaveCount(0);
  await expect(detail.locator(".log-step").first()).toContainText("Leer — Hecho");
  await detail.getByRole("button", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-centre").first()).toContainText("Leer correo");
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
  const steps = page.locator(".mp-stage .mp-step");
  // From what started it, as the Registro and the editor say it: the trigger, then its four steps.
  await expect(page.locator(".mp-stage .mp-trig .mp-name")).toHaveText("Llega a Correos");
  await expect(steps).toHaveCount(5);
  // The way it went, in orange: what ran with what came of it, what did not run faded.
  await expect(page.locator(".mp-stage .mp-trig")).toHaveClass(/run-ran/);
  await expect(steps.filter({ hasText: "Lectora" })).toHaveClass(/run-ran/);
  await expect(steps.filter({ hasText: "Lectora" })).toContainText("Hecho");
  await expect(steps.filter({ hasText: "Rellenadora" })).toHaveClass(/run-idle/);
  await expect(steps.filter({ hasText: "Crear" })).toContainText("Propuesto");
  const orange = await steps
    .filter({ hasText: "Lectora" })
    .evaluate((e) => getComputedStyle(e).borderTopColor);
  const c2 = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--c2)";
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(orange).toBe(c2);
  // Its arrows on the way move (a light along them); still when the system asks for less motion.
  const wayEdges = page.locator(".mp-stage .mp-edge.way");
  await expect.poll(() => wayEdges.count()).toBeGreaterThan(2);
  const moving = () => wayEdges.last().evaluate((e) => getComputedStyle(e).animationName);
  expect(await moving()).toContain("mp-way-flow");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await moving()).toBe("none");
  await page.emulateMedia({ reducedMotion: null });
  // Its way across the map, told in its card: the mail it read, the run, what it proposed and what became of it.
  const way = page.locator(".mp-way");
  await expect(way.locator("h4")).toHaveText("Explicación");
  await expect(way.locator("ol").first().locator(":scope > li")).toHaveText([
    "Empezó con «Reunión con secretaría el jueves» (Correos)",
    /^Leer correo \(v3\) · 20 oct/,
    "Propuso «Preparar la reunión» · aceptada",
  ]);
  // «Detalles»: each step in the same words, what it read and its models; «Copiar» the whole.
  await way.getByRole("button", { name: "Detalles" }).click();
  await expect(way.locator(".mp-way-more li").first()).toContainText("Leer — Hecho");
  await expect(way.locator(".mp-way-more")).not.toContainText("entities.");
  await way.getByRole("button", { name: "Menos" }).click();
  await expect(way.locator(".mp-way-more")).toHaveCount(0);
  // On the map, the way lit: from Correos through the Bandeja to Tarea, where it was accepted; Evento goes quiet.
  const map = page.locator(".mp-stage");
  const card = (name: string) =>
    map.locator(".mp-card", {
      has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
    });
  // From the connector that brought the mail, whatever the depth (1 here), to where it ended.
  await expect(page.getByRole("slider", { name: "Profundidad" })).toHaveAttribute(
    "aria-valuetext",
    "1",
  );
  for (const name of ["Correo", "Correos", "Bandeja", "Tarea"])
    await expect(card(name)).toHaveClass(/way/);
  await expect(card("Evento")).toHaveClass(/dim/);
  await expect(map.locator(".mp-edge-label", { hasText: "aceptadas · 7" })).toBeVisible();
  // No words over a box, the way's included.
  expect(
    await page.evaluate(() => {
      const box = (e: Element) => e.getBoundingClientRect();
      const meet = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const boxes = [...document.querySelectorAll(".mp-stage .react-flow__node")]
        .filter((n) => !n.classList.contains("react-flow__node-frame"))
        .map(box);
      return [...document.querySelectorAll(".mp-stage .mp-edge-label")]
        .map(box)
        .filter((w) => boxes.some((b) => meet(w, b))).length;
    }),
  ).toBe(0);
  // A light that goes along the way again and again, slowly, from the connector to the collection (task 91).
  const glow = await steps
    .filter({ hasText: "Lectora" })
    .evaluate((e) => getComputedStyle(e).animationName);
  expect(glow).toBe("mp-way-glow");
  expect(await card("Correo").evaluate((e) => getComputedStyle(e).animationName)).toBe(
    "mp-way-glow",
  );
  expect(await moving()).toContain("mp-way-line");
  // This run's own calls and cost on its step, in orange; the period's numbers said as such.
  await expect(steps.filter({ hasText: "Lectora" }).locator(".mp-run-own")).toHaveText(
    /1 llamada · 0,0021\sUS\$$/,
  );
  await expect(page.locator(".mp-legend")).toContainText("Las cifras son de los últimos 7 días");
  await expect(page.locator(".mp-legend")).toContainText("En naranja, lo de esta ejecución");
  // What came out of each box, in its panel: what the reader gave the next step, the Bandeja's card, Tarea's row.
  await steps.filter({ hasText: "Lectora" }).click();
  const panel = page.locator(".mp-panel");
  await expect(panel.locator("h3")).toHaveText("Lectora");
  await expect(panel).toContainText("Paso de «Leer correo»");
  // What it does in one line (I-27), and the period's numbers said as such.
  await expect(panel).toContainText("Lee el correo y saca lo que te pide hacer");
  await expect(panel).toContainText(/42 llamadas · 0,21\sUS\$ en 7 días/);
  const here = panel.locator(".mp-here");
  await expect(here.locator("h4")).toHaveText("En esta ejecución");
  await expect(here).toContainText("Tareas");
  await expect(here).toContainText("Preparar la reunión");
  await expect(here).toContainText("23 oct 2026");
  await expect(here).not.toContainText("2026-10-23");
  await card("Bandeja").locator(".mp-name").click();
  await expect(panel.locator(".mp-here .mp-out-card")).toContainText("«Preparar la reunión»");
  await expect(panel.locator(".mp-here .mp-out-card")).toContainText("aceptada");
  await card("Tarea").locator(".mp-name").click();
  await expect(panel.locator(".mp-here .mp-out-card")).toContainText("Estado");
  await expect(panel.locator(".mp-here .mp-out-card")).toContainText("Pendiente");
  await panel.getByRole("button", { name: "Cerrar" }).click();
  // «Explicación», hidden and shown again.
  await way.getByRole("button", { name: "Ocultar la explicación" }).click();
  await expect(way).toHaveCount(0);
  await page.getByRole("button", { name: "Explicación" }).click();
  await expect(way.locator("h4")).toHaveText("Explicación");
  await page.screenshot({ path: `${SHOTS}/flows-map-run.png` });
  // Taken away: the flow stays unfolded, its steps without the run.
  await page.getByRole("button", { name: "Quitar la ejecución" }).click();
  await expect(page.locator(".mp-run-chip")).toHaveCount(0);
  await expect(page.locator(".mp-way")).toHaveCount(0);
  await expect(steps.filter({ hasText: "Lectora" })).not.toHaveClass(/run-ran/);
  await expect(card("Evento")).not.toHaveClass(/dim/);
});

test("a reading of an earlier version of its flow is drawn over its own steps, its way whole (task 90's review)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_MAIL_OLD],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await page.locator(".log-list li").first().locator(".log-head").click();
  await page.locator(".log-detail").getByRole("button", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
  // Its own steps (v2), not the latest's: what it filled and created lit, its proposal leaving from its «Crear».
  const steps = page.locator(".mp-stage .mp-step");
  await expect(steps).toHaveCount(5);
  await expect(steps.filter({ hasText: "Crear" })).toContainText("Docencia");
  await expect(steps.filter({ hasText: "Crear" })).toContainText("Propuesto");
  await expect(steps.filter({ hasText: "Crear" })).toHaveClass(/run-ran/);
  await expect(steps.filter({ hasText: "No llegó" })).toHaveCount(0);
  await expect(page.locator(".mp-way li").nth(1)).toContainText("Leer correo (v2)");
  await expect(page.locator(".mp-stage .mp-edge.way").first()).toBeAttached();
});

test("with Boni's «Traer correo», a reading's way goes from the mail's connector through «Traer correo» to Correos (D-50)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_MAIL],
      "GET api/agent/map": [MAP_FETCH],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await page.locator(".log-list li").first().locator(".log-head").click();
  await page.locator(".log-detail").getByRole("button", { name: "Recorrido" }).click();
  const stage = page.locator(".mp-stage");
  const card = (name: string) =>
    stage.locator(".mp-card", {
      has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
    });
  for (const name of ["Correo", "Traer correo", "Correos"])
    await expect(card(name), name).toHaveClass(/way/);
  const edge = (id: string) => stage.locator(`[data-id="${id}"] path.mp-edge`);
  await expect(edge("conn:mail>flow:traer-correo>brings")).toHaveClass(/way/);
  await expect(edge("flow:traer-correo>col:t_01m6correo>writes")).toHaveClass(/way/);
});

test("a reading over a lane per collection lights only the lane it took, never the others, nor the steps it skipped (task 91)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_MAIL_LANES],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await page.locator(".log-list li").first().locator(".log-head").click();
  await page.locator(".log-detail").getByRole("button", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
  const stage = page.locator(".mp-stage");
  const edge = (from: string, to: string) =>
    stage.locator(`[data-id="order:flow:leer-correo:${from}>${to}"] path.mp-edge`);
  // The Decisora chose Gestiones: the way goes down its lane, then on to «Plegar hilo».
  await expect(edge("c", "n1_tasks")).toHaveClass(/way/);
  await expect(edge("n1_tasks", "fold")).toHaveClass(/way/);
  // Docencia's lane, skipped, is not lit.
  await expect(edge("c", "n0_tasks")).not.toHaveClass(/way/);
  await expect(edge("n0_tasks", "fold")).not.toHaveClass(/way/);
  // What it only read is not where it went.
  await expect(
    stage.locator(".mp-card", { has: page.locator(".mp-name", { hasText: /^Evento$/ }) }),
  ).not.toHaveClass(/way/);
  const steps = stage.locator(".mp-step");
  await expect(steps.filter({ hasText: "Docencia" })).toHaveClass(/run-idle/);
  await expect(steps.filter({ hasText: "Gestiones" })).toHaveClass(/run-ran/);
  // The Decisora's panel says what it chose.
  await steps.filter({ hasText: "Decisora" }).click();
  await expect(page.locator(".mp-panel .mp-here")).toContainText("Eligió");
  await expect(page.locator(".mp-panel .mp-here")).toContainText("Gestiones");
  // A piece on the way (task 83's Recorrido with pieces): «Plegar hilo» ran, lit, its panel with its days.
  await expect(steps.filter({ hasText: "Plegar hilo" })).toHaveClass(/run-ran/);
  await steps.filter({ hasText: "Plegar hilo" }).click();
  await expect(page.locator(".mp-panel h3")).toHaveText("Plegar hilo");
  await expect(page.locator(".mp-panel .piece-facts")).toHaveText("Mira 60 días atrás en el hilo.");
});

test("«¿De dónde viene?» in the conversation: who by name, its way drawn in the chat, «Ampliar» to the map; the list folds and widens (task 92)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "POST api/agent/turn": [ORIGIN_TURN],
      "GET api/agent/runs/:id": [RUN_MAIL],
      "GET api/agent/runs": [RUNS],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  const box = page.getByRole("textbox", { name: /Escribe/ });
  await box.click();
  await page.keyboard.type("¿De dónde viene «Preparar la reunión»?", { delay: 5 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".reply-text").last()).toContainText("lo propuso Leer correo");
  // Its way, drawn in the chat as the map draws it: from the mail's connector to Tarea, where it was accepted.
  const way = page.getByRole("group", { name: "El recorrido de la ejecución" });
  await expect(way.locator(".run-path-box strong")).toHaveText([
    "Correo",
    "Correos",
    "Leer correo",
    "Bandeja",
    "Tarea",
  ]);
  await expect(way.locator(".run-path-box").nth(1)).toContainText(
    "«Reunión con secretaría el jueves»",
  );
  await expect(way.locator(".run-path-box").nth(3)).toContainText(
    "«Preparar la reunión» · aceptada",
  );
  expect(
    await way
      .locator(".run-path-box")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("mp-way-glow");
  await page.screenshot({ path: `${SHOTS}/chat-run-path.png` });
  // The conversations' list: folded away and shown again; widened by its grip, kept after a reload.
  const list = page.getByRole("navigation", { name: "Conversaciones" });
  await page.getByRole("button", { name: "Ocultar las conversaciones" }).click();
  await expect(list).toHaveCount(0);
  await page.getByRole("button", { name: "Mostrar las conversaciones" }).click();
  await expect(list).toBeVisible();
  const before = (await list.boundingBox())?.width ?? 0;
  const grip = page.getByRole("separator", { name: "Ancho de la lista de conversaciones" });
  const g = await grip.boundingBox();
  if (!g) throw new Error("the grip is on screen");
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 90, g.y + g.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await list.boundingBox())?.width ?? 0)
    .toBeGreaterThan(before + 60);
  await grip.focus();
  await page.keyboard.press("ArrowLeft");
  const wide = String(Math.round(before + 90 - 16));
  await expect(grip).toHaveAttribute("aria-valuenow", wide);
  // «Ampliar»: the map with the run on it.
  await way.getByRole("button", { name: "Ampliar" }).click();
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
  // Its width and its fold are kept on this device: after a reload, as they were.
  await page.reload();
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await expect(grip).toHaveAttribute("aria-valuenow", wide);
  await page.getByRole("button", { name: "Ocultar las conversaciones" }).click();
  await page.reload();
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await expect(page.getByRole("button", { name: "Mostrar las conversaciones" })).toBeVisible();
  await expect(list).toHaveCount(0);
});

test("a proposal still in the Bandeja is drawn up to the collection it would go to; a run a model wrote is not drawn (task 92, I-29)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const waiting = {
    ...RUN_MAIL,
    proposals: [{ ...RUN_MAIL.proposals[0], status: "pending", decided: null, record: null }],
  };
  const madeUp = {
    ...ORIGIN_TURN,
    run: "run-c10",
    replies: [
      ORIGIN_TURN.replies[0],
      {
        component: "run",
        data: { run: { t: "v", value: "run-3", integrity: "model", sensitivity: "public" } },
      },
    ],
  };
  await openApp(page, "/?still", {
    agent: {
      "POST api/agent/turn": [ORIGIN_TURN, madeUp],
      "GET api/agent/runs/:id": [waiting],
      "GET api/agent/runs": [RUNS],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  const box = page.getByRole("textbox", { name: /Escribe/ });
  await box.click();
  await page.keyboard.type("¿De dónde viene la tarea de la bandeja?", { delay: 5 });
  await page.keyboard.press("Enter");
  const way = page.getByRole("group", { name: "El recorrido de la ejecución" });
  await expect(way.locator(".run-path-box strong")).toHaveText([
    "Correo",
    "Correos",
    "Leer correo",
    "Bandeja",
    "Tarea",
  ]);
  // Where it waits to go: dashed and still, «espera en la Bandeja»; the mail's words marked as from outside.
  await expect(way.locator(".run-path-box.waits")).toContainText("espera en la Bandeja");
  await expect(way.locator(".run-path-ext").first()).toHaveAttribute("title", /Viene de fuera/);
  // A run id a model wrote is not drawn.
  await box.click();
  await page.keyboard.type("¿Y esta otra?", { delay: 5 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".reply-text")).toHaveCount(2);
  await expect(page.getByRole("group", { name: "El recorrido de la ejecución" })).toHaveCount(1);
});

test("an Inbox card's right button (I-17, I-25): open it, or its Recorrido, which is its run on the map", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [
        { proposals: [{ ...CARD_DETAILED, run: "run-3", madeBy: "leer-correo" }] },
      ],
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_MAIL],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const card = page.locator(".inbox-panel .inbox-card").first();
  await card.locator("h3").click({ button: "right" });
  const menu = page.getByRole("dialog", { name: "Opciones de la propuesta" });
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Abrir propuesta", "Recorrido"]);
  await menu.getByRole("menuitemradio", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-centre").first()).toContainText("Leer correo");
  await expect(page.locator(".mp-way h4")).toHaveText("Explicación");
  // Its page has it too: «Abrir propuesta», then «Recorrido» there (the Bandeja's panel is still open).
  await expect(card).toBeVisible();
  await card.locator("h3").click({ button: "right" });
  await page
    .getByRole("dialog", { name: "Opciones de la propuesta" })
    .getByRole("menuitemradio", { name: "Abrir propuesta" })
    .click();
  await page.getByRole("button", { name: "Quitar la ejecución" }).waitFor({ state: "detached" });
  await page.locator(".proposal-page").getByRole("button", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
});

test("«¿De dónde viene?» from a row: the reading that proposed it on the map, its mail and the «Aceptar» (F8)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/origin/:id": [ORIGIN_MAIL, ORIGIN_USER],
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_BOOK],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  const libros = () =>
    page
      .locator(".sidebar")
      .getByRole("list", { name: "Páginas" })
      .getByRole("button", { name: "Libros", exact: true })
      .click();
  await libros();
  const rows = page.locator(".db-table tbody tr");
  // A book a mail recommended: «Leer correo» proposed it to Libros, and Juan accepted it.
  await rows.filter({ hasText: "Pedro Páramo" }).click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "¿De dónde viene?" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Flujos");
  await expect(page.locator(".mp-centre").first()).toContainText("Leer correo");
  // Told in words over the map: the mail, the reading, its own proposal (and how many more), the «Aceptar».
  const way = page.locator(".mp-way");
  await expect(way.locator("h4")).toHaveText("¿De dónde viene «Pedro Páramo»?");
  await expect(way.locator("li")).toHaveText([
    "Empezó con «Libros para el club de lectura» (Correos)",
    /^Leer correo \(v3\) · 20 oct/,
    "Lo propuso como «Pedro Páramo»",
    "y propuso 1 más",
    /^Lo aceptaste · 20 oct.*13:30$/,
  ]);
  // Its flow unfolded with what each step did; its way lit through the Bandeja to Libros, where it is.
  const map = page.locator(".mp-stage");
  await expect(map.locator(".mp-step", { hasText: "Lectora" })).toHaveClass(/run-ran/);
  const card = (name: string) =>
    map.locator(".mp-card", {
      has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
    });
  for (const name of ["Correos", "Bandeja", "Libros"]) await expect(card(name)).toHaveClass(/way/);
  await expect(card("Tarea")).toHaveClass(/dim/);
  await page.screenshot({ path: `${SHOTS}/flows-map-origin.png` });
  // Its run in words, there: «Detalles» (the Recorrido is the map itself).
  await way.getByRole("button", { name: "Detalles" }).click();
  await expect(way.locator(".mp-way-more")).toContainText("Lectora");

  // One written by hand says who and where, in a notice; the map is not opened for it.
  await libros();
  await rows.filter({ hasText: "Pedro Páramo" }).click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "¿De dónde viene?" }).click();
  await expect(page.getByText(/Lo escribiste tú, en portatil, el 21 oct.*19:45/)).toBeVisible();
  await expect(page.locator(".db-table")).toBeVisible();
});

test("«Flujos»: the editor draws a flow and changes it: a step's collection, saved as his version, back to Boni's; a step added", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/models": [MODELS],
      "GET api/agent/map": [MAP],
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
  const row = page.locator(".db-table tbody tr");
  await expect(row).toHaveCount(1);
  for (const text of ["Leer correo", "Llega a Correos", "Encendido", "42"])
    await expect(row.first()).toContainText(text);
  // A flow opens on a page of its own, the way back to «Flujos» above it (docs/sistema.md §4.4).
  await row.first().getByText("Leer correo", { exact: true }).click();
  await expect(page.locator(".flow-crumbs")).toContainText("Leer correo");
  // The flow drawn from its plan: the trigger with what it binds, each step named as the flows name it.
  const canvas = page.locator(".flow-editor .flow-canvas");
  await expect(canvas.locator(".fl-node")).toHaveCount(5);
  await expect(canvas.locator(".fl-node.source")).toContainText("Llega a Correos");
  // What it binds, by name (F7, I-08: never `$mail`).
  await expect(canvas.locator(".fl-node.source")).toContainText("Correo");
  await expect(canvas.locator(".fl-node.source")).not.toContainText("$");
  for (const name of ["Leer", "Lectora", "Rellenadora", "Crear"])
    await expect(
      canvas.locator(".fl-node .fl-name", { hasText: new RegExp(`^${name}$`) }),
    ).toHaveCount(1);
  const create = canvas.locator(".fl-node", {
    has: page.locator(".fl-name", { hasText: /^Crear$/ }),
  });
  for (const text of ["Docencia", "12 veces", "12 propuestas", "Para cada"])
    await expect(create).toContainText(text);
  // A model's step with its calls and their cost in the period (task 90).
  await expect(
    canvas.locator(".fl-node", { has: page.locator(".fl-name", { hasText: /^Lectora$/ }) }),
  ).toContainText("42 llamadas · 0,21 US$");
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

test("«Leer correo» creating in the chosen collection: one «Rellenadora» and one «Crear» for everything it reads, said «En la elegida · cada cosa», no lanes (docs/sistema.md §4.2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS],
      "GET api/agent/flows/:id": [FLOW_DETAIL_CHOSEN],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
      "GET api/mail/guide": [GUIDE_RULES],
      "GET api/agent/decisions": [ACCURACY],
      "PUT api/agent/decisions/:area": [ACCURACY_ON],
    },
  });
  await openFlow(page);
  const canvas = page.locator(".flow-editor .flow-canvas");
  // What starts it comes from the mail's connector, and Boni's pieces say so on their card, with what they change
  // (docs/sistema.md §4.2; the review of F7's first part).
  await expect(canvas.locator(".fl-node.source")).toContainText("Viene del conector Correo");
  await expect(canvas.locator(".fl-node", { hasText: "Regla del remitente" })).toContainText(
    "De Boni · lee",
  );
  await expect(canvas.locator(".fl-node", { hasText: "Plegar hilo" })).toContainText(
    "De Boni · cambia la Bandeja",
  );
  const crear = canvas.locator(".fl-node", { hasText: "Crear" });
  await expect(crear).toContainText("En la elegida · cada cosa");
  await expect(canvas.locator(".fl-node", { hasText: "Rellenadora" })).toContainText("cada cosa");
  // No step per collection or per kind, and no lanes.
  await expect(canvas.locator(".fl-node", { hasText: "Crear" })).toHaveCount(1);
  await expect(canvas.locator(".fl-lane")).toHaveCount(0);
  // Its panel says among which, in words: chosen by the decider, not here.
  await crear.locator(".fl-name").click();
  await expect(page.locator(".flow-chosen")).toHaveText(
    "La que elija la Decisora: Docencia o Gestiones",
  );
  await page.screenshot({ path: `${SHOTS}/flow-chosen.png` });
  // The decider's panel (task 83; Juan: «dentro de los detalles del modelo veo las reglas que tiene»): what it
  // chooses among, and only the guide's rules that choose for it: not one that skips a sender, not one an earlier
  // rule takes first, not one to a collection it does not choose among.
  await canvas.locator(".fl-node", { hasText: "Decisora" }).locator(".fl-name").click();
  const facts = page.locator(".flow-step-panel .decider-facts");
  await expect(facts).toContainText("Elige entre Docencia y Gestiones.");
  // That it asks when unsure, its line above says once.
  await expect(facts).not.toContainText("Si duda");
  await expect(facts.locator(".decider-facts-title")).toHaveText("Reglas de tu guía");
  const rules = facts.locator(".decider-facts-rules li");
  await expect(rules).toHaveCount(1);
  await expect(rules.nth(0)).toContainText("secretaria.ejemplo@universidad.example");
  await expect(rules.nth(0)).toContainText("→ Gestiones");
  for (const out of ["@lista.example.com", "boletin@", "coordinacion.", "t_01tarea"])
    await expect(facts).not.toContainText(out);
  await page.screenshot({ path: `${SHOTS}/flow-decider.png` });
  // The pieces' own settings (task 83): «Plegar hilo»'s days, a setting of its step, and what the server takes…
  await canvas.locator(".fl-node", { hasText: "Plegar hilo" }).locator(".fl-name").click();
  const stepPanel = page.locator(".flow-step-panel");
  await expect(
    stepPanel.locator(".flow-setting", { hasText: "Días" }).locator("input"),
  ).toHaveValue("60");
  await expect(stepPanel.locator(".piece-facts")).toHaveText("Mira 60 días atrás en el hilo.");
  // …and «Aceptar solas»' «Solo», the very switch of Ajustes → Decisiones.
  await canvas.locator(".fl-node", { hasText: "Aceptar solas" }).locator(".fl-name").click();
  const solo = stepPanel.locator(".piece-facts").getByRole("checkbox", { name: "Solo" });
  await expect(solo).not.toBeChecked();
  await solo.check();
  await expect
    .poll(async () => requests(page, "PUT api/agent/decisions"))
    .toEqual(['PUT api/agent/decisions/mail.accept {"auto":true}']);
  await expect(solo).toBeChecked();
  // Earned: nothing said under it (no explanations in the app).
  await expect(stepPanel.locator(".piece-facts p")).toHaveCount(0);
});

test("the editor cuts a lane's name to the lane's width, the whole name in its tooltip (task 90)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const long =
    "Una opción con un nombre muy largo que no cabe en su calle (p. ej.: Corregir exámenes; Revisar actas)";
  const choose = (v: string) => ({ fn: "eq", args: [{ ref: "$c.choice" }, { lit: v }] });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS],
      "GET api/agent/flows/:id": [
        {
          ...FLOW_DETAIL,
          nodes: [],
          plan: {
            version: 1,
            steps: [
              { id: "c", op: "read", reader: "classify", input: { ref: "$text" } },
              {
                id: "a",
                op: "call",
                tool: "notify",
                when: choose(long),
                args: { text: { lit: "Uno" } },
              },
              {
                id: "b",
                op: "call",
                tool: "notify",
                when: choose("Otra"),
                args: { text: { lit: "Dos" } },
              },
            ],
          },
        },
      ],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
    },
  });
  await openFlow(page);
  const lane = page.locator(".flow-canvas .fl-lane", { hasText: "Una opción" });
  await expect(lane).toHaveAttribute("title", long);
  const fits = await lane.evaluate((e) => ({
    width: e.getBoundingClientRect().width,
    cut: e.scrollWidth > e.clientWidth,
  }));
  expect(fits.width).toBeLessThanOrEqual(200);
  expect(fits.cut).toBe(true);
  // The pill takes the pointer, so its tooltip shows (xyflow's label layer lets none through).
  expect(await lane.evaluate((e) => getComputedStyle(e).pointerEvents)).not.toBe("none");
});

test("the decider's panel on the map: what it chooses among and the guide's rules that choose for it (task 83)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/models": [MODELS],
      "GET api/agent/map": [MAP_CHOSEN],
      "GET api/agent/flows": [FLOWS_WITH_SUMMARY],
      "GET api/agent/flows/:id": [FLOW_DETAIL_CHOSEN],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
      "GET api/mail/guide": [GUIDE_RULES],
      "GET api/agent/decisions": [ACCURACY],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await page.getByRole("tab", { name: "Mapa" }).click();
  const map = page.locator(".mp-stage");
  await map
    .locator(".mp-card", { has: page.locator(".mp-name", { hasText: /^Leer correo$/ }) })
    .locator(".mp-name")
    .click();
  const panel = page.locator(".mp-panel");
  await panel.getByRole("button", { name: "Ver los pasos" }).click();
  await map.locator(".mp-step", { hasText: "Decisora" }).click();
  await expect(panel.locator("h3")).toHaveText("Decisora");
  const facts = panel.locator(".decider-facts");
  await expect(facts).toContainText("Elige entre Tarea y Evento.");
  await expect(facts).not.toContainText("Si duda");
  // Only the rule to one of its collections (Tarea); Gestiones is not among them here.
  const rules = facts.locator(".decider-facts-rules li");
  await expect(rules).toHaveCount(1);
  await expect(rules.nth(0)).toContainText("coordinacion.ejemplo@universidad.example");
  await expect(rules.nth(0)).toContainText("→ Tarea");
  await expect(facts).not.toContainText("@lista.example.com");
  await expect(facts).not.toContainText("secretaria.");
  // Another step's panel says none of it.
  await map.locator(".mp-step", { hasText: "Lectora" }).click();
  await expect(panel.locator("h3")).toHaveText("Lectora");
  await expect(panel.locator(".decider-facts")).toHaveCount(0);
  // The pieces' settings on the map too: «Plegar hilo»'s days, «Aceptar solas»' «Solo» (task 83).
  await map.locator(".mp-step", { hasText: "Plegar hilo" }).click();
  await expect(panel.locator(".piece-facts")).toHaveText("Mira 60 días atrás en el hilo.");
  await map.locator(".mp-step", { hasText: "Aceptar solas" }).click();
  await expect(panel.locator(".piece-facts").getByRole("checkbox", { name: "Solo" })).toBeVisible();
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
  await openFlow(page);
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
    "De Boni",
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
  // What the trigger binds, by its name (F7, I-08: never `$text`).
  await expect(entra.locator("li").first()).toHaveText(/^Texto\s*texto$/);
  await expect(entra.locator("li")).toHaveCount(5);
  // A step's values by the step's name, never the plan's `$r.tasks` (I-08).
  await expect(panel.getByRole("region", { name: "Sale" }).locator("li")).toHaveText([
    /^Lectora\s*registro$/,
    /^Lectora › all\s*lista$/,
    /^Lectora › tasks\s*lista$/,
    /^Lectora › events\s*lista$/,
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
  await openFlow(page);
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
  await settled(page);
  // A step's dot shows under the pointer; dragged to anywhere on another step, it asks where that one uses its value.
  await node("m").hover();
  const dot = node("m").locator(".react-flow__handle.source:not(.fl-hidden-handle)");
  await expect(dot).toHaveCSS("opacity", "1");
  const from = await center(dot);
  const to = await center(node("notify"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // While drawing, every step shows where it lands.
  await expect(
    node("notify").locator(".react-flow__handle.target:not(.fl-hidden-handle)"),
  ).toHaveCSS("opacity", "1");
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
  await settled(page);
  await node("r").hover();
  const start = await center(
    node("r").locator(".react-flow__handle.source:not(.fl-hidden-handle)"),
  );
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
  await expect(
    node("trigger").locator(".react-flow__handle.source:not(.fl-hidden-handle)"),
  ).toHaveCSS("opacity", "0");
  const trigger = await node("trigger").boundingBox();
  const fromTrigger = await canvas
    .locator('.react-flow__edge[data-id^="o:trigger>"] path')
    .first()
    .boundingBox();
  if (!trigger || !fromTrigger) throw new Error("no trigger arrow");
  expect(fromTrigger.y).toBeGreaterThanOrEqual(trigger.y + trigger.height - 4);
});

test("Boni's pieces in «Leer correo» (F7): the trigger's inputs by name, the canvas fitted, «De Boni» to add, «Probar con…» a chosen mail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    mail: true,
    agent: {
      "GET api/agent/flows": [FLOWS],
      "GET api/agent/flows/:id": [FLOW_DETAIL],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_CHECK],
      "POST api/agent/flows/:id/test": [FLOW_TEST],
    },
  });
  await openFlow(page);
  const canvas = page.locator(".flow-editor .flow-canvas");
  await expect(canvas.locator(".fl-node")).toHaveCount(5);
  // What the trigger binds, as a person says it: never the plan's own names (I-08).
  const trigger = canvas.locator(".fl-card.source");
  for (const name of ["Correo", "Texto", "Qué busca", "Destinatarios", "Ya propuesto", "Guía"])
    await expect(trigger).toContainText(name);
  await expect(trigger).not.toContainText("$");
  // Fitted once its nodes are measured: readable, and inside the canvas (it opened too far out to read).
  await expect
    .poll(async () => (await trigger.boundingBox())?.width ?? 0, { timeout: 5000 })
    .toBeGreaterThan(150);
  const area = await canvas.boundingBox();
  const box = await trigger.boundingBox();
  expect(box && area && box.y >= area.y && box.y + box.height <= area.y + area.height).toBe(true);
  // At 860 px too (where it was seen too far out): opened again, fitted, readable.
  await page.setViewportSize({ width: 860, height: 900 });
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos", exact: true }).click();
  await openFlow(page);
  await expect
    .poll(async () => (await trigger.boundingBox())?.width ?? 0, { timeout: 5000 })
    .toBeGreaterThan(120);
  await page.setViewportSize({ width: 1440, height: 900 });
  // «Añadir paso» offers Boni's pieces in a flow a mail starts.
  await page.getByRole("button", { name: "Añadir paso" }).click();
  const add = page.getByRole("dialog", { name: "Añadir paso" });
  await expect(add.locator(".menu-head").last()).toHaveText("De Boni");
  await expect(add.getByRole("menuitemradio", { name: "Regla del remitente" })).toBeVisible();
  await expect(add.getByRole("menuitemradio", { name: "Plegar hilo" })).toBeVisible();
  await page.keyboard.press("Escape");
  // «Probar con…»: a mail of Correos by its subject; the flow is tried with that one.
  await page.getByRole("button", { name: "Probar con…" }).click();
  const list = page.getByRole("dialog", { name: "Probar con…" });
  await expect(list.getByRole("textbox", { name: "Buscar correo" })).toBeFocused();
  await page.keyboard.type("actas", { delay: 15 });
  await list.getByRole("menuitemradio", { name: "Actas pendientes" }).click();
  await expect(page.locator(".flow-test-bar")).toBeVisible();
  const sent = await page.evaluate(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).find((b) =>
      b.startsWith("POST api/agent/flows/leer-correo/test"),
    ),
  );
  expect(sent).toContain('"mail":"m1"');
  await page.screenshot({ path: `${SHOTS}/flow-pieces.png` });
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
  await openFlow(page);
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
      "GET api/agent/flows/:id": [FLOW_SUMMARY],
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
  await openFlow(page, "Resumen diario");
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
  await expect(canvas.locator(".fl-node.source")).toContainText("Hoy");
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
  // With no extension's function active, nothing to name: no «Funciones» (task 93).
  await expect(page.getByRole("menuitemradio", { name: "Función", exact: true })).toHaveCount(0);
});

test("«Aviso del presupuesto» is one of Boni's flows (D-53): started by the month's spending, with its «Avisar»; its trigger is fixed and it is not run by hand; «Probar» says what it would tell; without «Avisar» it is not saved", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS_WITH_BUDGET],
      "GET api/agent/flows/:id": [FLOW_BUDGET],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_BUDGET_CHECK, FLOW_BUDGET_CHECK_NONE],
      "POST api/agent/flows/:id/test": [FLOW_BUDGET_TEST],
    },
  });
  // «Flujos»: its row says what starts it, that it is on and that it is Boni's.
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  const row = page.locator(".db-table tbody tr", { hasText: "Aviso del presupuesto" });
  for (const text of ["El gasto del mes pasa del aviso", "Encendido", "Boni"])
    await expect(row).toContainText(text);
  await openFlow(page, "Aviso del presupuesto");
  const canvas = page.locator(".flow-editor .flow-canvas");
  // What starts it and what that gives, by a person's names (I-08); then its one step.
  const trigger = canvas.locator(".fl-node.source");
  await expect(trigger.locator(".fl-name")).toHaveText("El gasto del mes pasa del aviso");
  // Cut to the card's width: whole in its tooltip.
  await expect(trigger.locator(".fl-card")).toHaveAttribute(
    "title",
    "El gasto del mes pasa del aviso",
  );
  await expect(trigger.locator(".fl-input")).toHaveText(["Gasto del mes", "Presupuesto"]);
  await expect(trigger).not.toContainText("$");
  await expect(canvas.locator(".fl-node")).toHaveCount(2);
  const tell = canvas.locator(".fl-node", {
    has: page.locator(".fl-name", { hasText: /^Avisar$/ }),
  });
  await expect(tell).toContainText("1 vez");
  await expect(page.locator(".flow-whose")).toHaveText("De Boni");
  // Its spending starts it, never a hand.
  await expect(page.getByRole("button", { name: "Ejecutar", exact: true })).toHaveCount(0);
  // The trigger's panel says it and what it gives; there is nothing to choose.
  await trigger.locator(".fl-name").click();
  const panel = page.locator(".flow-step-panel");
  await expect(panel).toContainText("El gasto del mes pasa del aviso");
  await expect(panel.locator(".flow-args li")).toHaveText([
    /^Gasto del mes\s*texto$/,
    /^Presupuesto\s*texto$/,
  ]);
  await expect(panel.locator("select")).toHaveCount(0);
  // «Avisar»: its text is the flow's, in parts he can change; what comes in is the two figures.
  await tell.locator(".fl-name").click();
  await expect(panel.locator("h3")).toHaveText("Avisar");
  const comesIn = panel.getByRole("region", { name: "Entra" });
  await expect(comesIn.locator("li")).toHaveText([
    /^Gasto del mes\s*texto$/,
    /^Presupuesto\s*texto$/,
  ]);
  await expect(panel.locator(".expr-arg input.expr-input").first()).toHaveValue(
    "Los modelos llevan ",
  );
  await page.screenshot({ path: `${SHOTS}/flow-budget.png` });
  // «Probar»: nothing reaches a device; the step says what it would tell, with the month's figures.
  await page.getByRole("button", { name: "Probar", exact: true }).click();
  await expect(page.locator(".flow-test-bar")).toContainText("sin escribir nada");
  await expect(tell).toContainText("Haría: Avisar «Los modelos llevan 8.55 € de 10 € este mes.»");
  // Without its «Avisar» the checklist says so, and it can be neither saved nor tried (the checklist was asked
  // once for the flow as it came; the change asks again).
  await expect
    .poll(async () => (await requests(page, "POST api/agent/flows/check")).length)
    .toBe(1);
  await panel.getByRole("button", { name: "Quitar" }).click();
  await expect(canvas.locator(".fl-node")).toHaveCount(1);
  await expect(page.locator(".flow-checklist")).toContainText("Falta «Avisar», sin condición");
  await expect(trigger.locator(".fl-card")).toHaveClass(/bad/);
  await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Probar", exact: true })).toBeDisabled();
});

test("the month's run of «Aviso del presupuesto» is that flow's in the Registro and on the map, from its trigger through «Avisar» to «Dispositivos»; the whole map draws what it tells («avisa»); turned off, Ajustes → Modelos says so (D-53)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS_BUDGET],
      "GET api/agent/runs/:id": [RUN_BUDGET],
      "GET api/agent/map": [MAP_BUDGET],
      "GET api/agent/models": [{ ...MODELS, notice: false }],
      "GET api/agent/flows": [FLOWS_WITH_BUDGET],
    },
  });
  // The Registro names the run by its flow, a line of its own.
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  const entry = page.locator(".log-list li").first();
  await expect(entry.locator(".log-head")).toContainText("Aviso del presupuesto");
  await entry.locator(".log-head").click();
  const detail = page.locator(".log-detail");
  await expect(detail.locator(".log-step")).toHaveCount(1);
  await expect(detail.locator(".log-step").first()).toContainText("Avisar — Hecho");
  // Its Recorrido is the map: the flow in the centre, unfolded from what started it, its one step done.
  await detail.getByRole("button", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-centre").first()).toContainText("Aviso del presupuesto");
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
  const stage = page.locator(".mp-stage");
  const card = (name: string) =>
    stage.locator(".mp-card", {
      has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
    });
  await expect(stage.locator(".mp-trig .mp-name")).toHaveText("El gasto del mes pasa del aviso");
  await expect(stage.locator(".mp-trig")).toContainText("Gasto del mes · Presupuesto");
  await expect(stage.locator(".mp-trig")).toHaveClass(/run-ran/);
  const steps = stage.locator(".mp-step:not(.mp-trig)");
  await expect(steps).toHaveCount(1);
  await expect(steps.first()).toContainText("Avisar");
  await expect(steps.first()).toContainText("Hecho");
  await expect(steps.first()).toHaveClass(/run-ran/);
  // What it told went on to the devices: the way ends there, by the arrow that leaves its «Avisar».
  await expect(card("Dispositivos")).toHaveClass(/way/);
  await expect(card("Dispositivos")).toContainText("1 aviso");
  const tells = stage.locator(
    '[data-id="step:flow:aviso-presupuesto:notify>dev:all>tells"] path.mp-edge',
  );
  await expect(tells).toHaveClass(/way/);
  await expect(stage.locator(".mp-edge-label", { hasText: "avisa · 1" })).toBeVisible();
  await expect(page.locator(".mp-way ol").first().locator(":scope > li")).toHaveText([
    /^Aviso del presupuesto \(v1\) · 21 oct/,
    "Avisó a tus dispositivos",
  ]);
  await page.screenshot({ path: `${SHOTS}/flows-map-budget.png` });
  // Without the run and without a centre, the whole map draws it: it is joined to the devices by what it tells.
  await page.getByRole("button", { name: "Quitar la ejecución" }).click();
  await page.getByRole("button", { name: "Quitar del centro" }).click();
  const frame = stage.locator(".mp-frame.flow", { hasText: "Aviso del presupuesto" });
  await expect(frame).toBeVisible();
  await expect(card("Dispositivos")).toBeVisible();
  await expect(card("Dispositivos")).not.toHaveClass(/way/);
  await expect(card("Leer correo")).toBeVisible();
  // The devices' panel: what they are, the period's notices, and who tells them.
  await card("Dispositivos").locator(".mp-name").click();
  const panel = page.locator(".mp-panel");
  await expect(panel.locator("h3")).toHaveText("Dispositivos");
  await expect(panel.locator(".mp-panel-title")).toContainText("Avisos");
  await expect(panel).toContainText("1 aviso");
  await expect(panel.getByRole("region", { name: "Entra" })).toContainText(
    "Aviso del presupuesto · avisa · 1",
  );
  await expect(panel.getByRole("region", { name: "Sale" })).toHaveCount(0);
  // In the centre, one arrow back: who tells.
  await panel.getByRole("button", { name: "Poner en el centro" }).click();
  await expect(page.locator(".mp-centre")).toContainText("Dispositivos");
  await expect(frame).toBeVisible();
  await expect(card("Leer correo")).toHaveCount(0);
  await page.getByRole("button", { name: "Quitar del centro" }).click();
  await panel.getByRole("button", { name: "Cerrar" }).click();
  // Telling changes no data: «Solo lo que escribe» takes the arrow away, and with it what it alone joined.
  await page.getByRole("button", { name: "Filtros" }).click();
  await page.getByRole("checkbox", { name: "Solo lo que escribe" }).check();
  await expect(card("Dispositivos")).toHaveCount(0);
  await expect(frame).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Solo lo que escribe" }).uncheck();
  await page.keyboard.press("Escape");
  await expect(card("Dispositivos")).toBeVisible();
  // The flow is found by its name, and its panel says whose it is, what starts it, its run and what it tells.
  const find = page.getByRole("combobox", { name: "Buscar en el mapa" });
  await find.click();
  await page.keyboard.type("Aviso del pres", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".mp-centre")).toContainText("Aviso del presupuesto");
  await expect(panel.locator("h3")).toHaveText("Aviso del presupuesto");
  for (const text of ["Flujo · De Boni", "El gasto del mes pasa del aviso", "1 ejecución"])
    await expect(panel).toContainText(text);
  await expect(panel.getByRole("region", { name: "Sale" })).toContainText(
    "Dispositivos · avisa · 1",
  );
  // «Agrupar por disparador» names what starts it; the devices are in no frame.
  await page.getByRole("combobox", { name: "Agrupar" }).selectOption("trigger");
  await expect(
    stage.locator(".mp-frame.group", { hasText: "El gasto del mes pasa del aviso" }),
  ).toBeVisible();
  // Off: Ajustes → Modelos says the notice is off, by the budget.
  await openModels(page);
  await expect(page.locator(".models-spend")).toContainText(
    "Presupuesto: 10,00 € al mes, aviso apagado",
  );
});

// What a run told is what the server says it told, never what its steps' decisions suggest: a «Probar» logs its
// «Avisar» as allowed and tells nothing.
for (const [title, run, boxes] of [
  [
    "a run that told, drawn in the conversation: its way ends in «Dispositivos», as on the map (I-29)",
    RUN_BUDGET,
    ["Aviso del presupuesto", "Dispositivos"],
  ],
  [
    "a «Probar» drawn in the conversation told nothing: its way does not go to «Dispositivos»",
    RUN_BUDGET_TEST,
    ["Aviso del presupuesto"],
  ],
] as const)
  test(title, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, "/?still", {
      agent: {
        "POST api/agent/turn": [ORIGIN_TURN],
        "GET api/agent/runs/:id": [run],
        "GET api/agent/runs": [RUNS_BUDGET],
        "GET api/agent/map": [MAP_BUDGET],
        "GET api/agent/models": [MODELS],
        "GET api/agent/flows": [FLOWS_WITH_BUDGET],
      },
    });
    await page.getByRole("button", { name: /^Conversación/ }).click();
    const box = page.getByRole("textbox", { name: /Escribe/ });
    await box.click();
    await page.keyboard.type("¿Qué fue el aviso del presupuesto?", { delay: 5 });
    await page.keyboard.press("Enter");
    const way = page.getByRole("group", { name: "El recorrido de la ejecución" });
    await expect(way.locator(".run-path-box strong")).toHaveText([...boxes]);
  });

/** The Registro's first run, its «Recorrido»: the map with that run on it. */
const openWay = async (page: Page) => {
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await page.locator(".log-list li").first().locator(".log-head").click();
  await page.locator(".log-detail").getByRole("button", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
};
const mapCard = (page: Page, name: string) =>
  page.locator(".mp-stage .mp-card", {
    has: page.locator(".mp-name", { hasText: new RegExp(`^${name}$`) }),
  });
const tellsFrom = (page: Page, from: string) =>
  page.locator(`.mp-stage [data-id="${from}>dev:all>tells"] path.mp-edge`);

test("who tells, on the whole map: Boni's flow, a flow of the user's that has told nothing yet (its arrow with no number) and the conversation; «Dispositivos» says the period's notices (A-16)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/map": [MAP_TELLS],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS_WITH_BUDGET],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await page.getByRole("tab", { name: "Mapa" }).click();
  for (const name of ["Aviso del presupuesto", "Resumen diario", "Conversación"])
    await expect(mapCard(page, name), name).toBeVisible();
  await expect(mapCard(page, "Dispositivos")).toContainText("3 avisos");
  for (const from of ["flow:aviso-presupuesto", "flow:resumen-diario-a1", "boni:chat"])
    await expect(tellsFrom(page, from), from).toBeAttached();
  // The devices chosen, every arrow into them says its words (task 90: said when lit, whatever they cover): «avisa» with its
  // notices of the period; the flow that has told nothing yet, «avisa» alone.
  await mapCard(page, "Dispositivos").locator(".mp-name").click();
  const words = page.locator(".mp-stage .mp-edge-label");
  await expect(words).toHaveCount(3);
  for (const w of [/^avisa · 1$/, /^avisa · 2$/, /^avisa$/])
    await expect(words.filter({ hasText: w }), String(w)).toHaveCount(1);
  // Their panel: who tells them, each with its number.
  const panel = page.locator(".mp-panel");
  await expect(panel).toContainText("3 avisos");
  await expect(panel.getByRole("region", { name: "Entra" }).locator("li")).toHaveText([
    "Aviso del presupuesto · avisa · 1",
    "Resumen diario · avisa",
    "Conversación · avisa · 2",
  ]);
  // Unfolded, the arrow leaves from each «Avisar» of the flow.
  await panel.getByRole("button", { name: "Resumen diario" }).click();
  await expect(panel.locator("h3")).toHaveText("Resumen diario");
  await panel.getByRole("button", { name: "Ver los pasos" }).click();
  for (const step of ["a", "b"])
    await expect(tellsFrom(page, `step:flow:resumen-diario-a1:${step}`)).toBeAttached();
  await expect(tellsFrom(page, "flow:resumen-diario-a1")).toHaveCount(0);
});

test("a run that told through one «Avisar» and skipped the other lights only the arrow of the one that told", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS_DAILY],
      "GET api/agent/runs/:id": [RUN_DAILY],
      "GET api/agent/map": [MAP_TELLS],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS_WITH_BUDGET],
    },
  });
  await openWay(page);
  await expect(mapCard(page, "Dispositivos")).toHaveClass(/way/);
  await expect(tellsFrom(page, "step:flow:resumen-diario-a1:a")).toHaveClass(/way/);
  await expect(tellsFrom(page, "step:flow:resumen-diario-a1:b")).not.toHaveClass(/way/);
  // The lit arrow says the words; the quiet one says nothing.
  await expect(page.locator(".mp-stage .mp-edge-label.tells")).toHaveText(["avisa"]);
  await expect(page.locator(".mp-way ol").first().locator(":scope > li")).toHaveText([
    /^Resumen diario \(v1\)/,
    "Avisó a tus dispositivos",
  ]);
});

test("the «Recorrido» of a «Probar» tells nothing: its «Avisar» are logged as allowed, and its way does not go to «Dispositivos»", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS_DAILY_TEST],
      "GET api/agent/runs/:id": [RUN_DAILY_TEST],
      "GET api/agent/map": [MAP_TELLS],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS_WITH_BUDGET],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await expect(page.locator(".log-list li").first().locator(".log-head")).toContainText(
    "Prueba de «Resumen diario»",
  );
  await page.locator(".log-list li").first().locator(".log-head").click();
  await page.locator(".log-detail").getByRole("button", { name: "Recorrido" }).click();
  await expect(page.locator(".mp-run-chip")).toContainText("Ejecución");
  // Both «Avisar» ran in the try (it says what each would tell).
  const steps = page.locator(".mp-stage .mp-step:not(.mp-trig)");
  await expect(steps).toHaveCount(3);
  for (const i of [1, 2]) await expect(steps.nth(i)).toHaveClass(/run-ran/);
  // Nothing was told: the devices are not on its way, no arrow to them is lit, and its story does not say it told.
  await expect(mapCard(page, "Dispositivos")).not.toHaveClass(/way/);
  for (const step of ["a", "b"])
    await expect(tellsFrom(page, `step:flow:resumen-diario-a1:${step}`)).not.toHaveClass(/way/);
  await expect(page.locator(".mp-way ol").first().locator(":scope > li")).toHaveText([
    /^Resumen diario \(v1\)/,
  ]);
  await expect(page.locator(".mp-way")).not.toContainText("Avisó");
});

test("a turn of the conversation that told before the map's period still ends in «Dispositivos»: the arrow drawn for it, with no number", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The period's map has no notice at all: neither the devices nor an arrow to them.
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS_TURN_TOLD],
      "GET api/agent/runs/:id": [RUN_TURN_TOLD],
      "GET api/agent/map": [MAP],
      "GET api/agent/models": [MODELS],
      "GET api/agent/flows": [FLOWS],
    },
  });
  await openWay(page);
  await expect(mapCard(page, "Conversación")).toHaveClass(/way/);
  await expect(mapCard(page, "Dispositivos")).toHaveClass(/way/);
  await expect(tellsFrom(page, "boni:chat")).toHaveClass(/way/);
  await expect(page.locator(".mp-stage .mp-edge-label.tells")).toHaveText(["avisa"]);
  await expect(page.locator(".mp-way")).toContainText("Avisó a tus dispositivos");
  // The devices' card opens its panel, with who told them: this run's conversation.
  await mapCard(page, "Dispositivos").locator(".mp-name").click();
  const panel = page.locator(".mp-panel");
  await expect(panel.locator("h3")).toHaveText("Dispositivos");
  await expect(panel.getByRole("region", { name: "Entra" }).locator("li")).toHaveText([
    "Conversación · avisa",
  ]);
  // Without the run, the period's map is as it was: nothing told, no devices, and nothing chosen (the arrows of the
  // rest are not left quiet for a box that is gone).
  await page.getByRole("button", { name: "Quitar la ejecución" }).click();
  await expect(mapCard(page, "Dispositivos")).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".mp-stage path.mp-edge").first()).toBeAttached();
  await expect(page.locator(".mp-stage path.mp-edge.dim")).toHaveCount(0);
});

test("his own version of «Aviso del presupuesto», whose text takes neither figure: its trigger still gives both, on its card and in its panel (D-53)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [
        {
          flows: FLOWS_WITH_BUDGET.flows.map((f) =>
            f.id === FLOW_BUDGET_MINE.id ? { ...f, version: 2, by: "user" } : f,
          ),
        },
      ],
      "GET api/agent/flows/:id": [FLOW_BUDGET_MINE],
      "GET api/agent/flows/catalog": [FLOW_CATALOG],
      "POST api/agent/flows/check": [FLOW_BUDGET_CHECK],
    },
  });
  await openFlow(page, "Aviso del presupuesto");
  await expect(page.locator(".flow-whose")).toHaveText("Tu versión");
  const trigger = page.locator(".flow-editor .flow-canvas .fl-node.source");
  await expect(trigger.locator(".fl-input")).toHaveText(["Gasto del mes", "Presupuesto"]);
  await trigger.locator(".fl-name").click();
  await expect(page.locator(".flow-step-panel .flow-args li")).toHaveText([
    /^Gasto del mes\s*texto$/,
    /^Presupuesto\s*texto$/,
  ]);
});

test("without a budget (0 €), Ajustes → Modelos says «Sin presupuesto» and the spending's bar is not in its warning colour (D-53)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: { "GET api/agent/models": [{ ...MODELS, budget: { monthlyEur: 0, warnAt: 0.8 } }] },
  });
  await openModels(page);
  const line = page.locator(".models-spend .models-line").last();
  await expect(line).toContainText("Sin presupuesto");
  await expect(line).not.toContainText("aviso");
  // The server never warns without a budget: the bar does not say it would.
  const bar = page.locator(".modal .kpi").first().locator(".kpi-meter-fill");
  await expect(bar).toHaveClass(/\bok\b/);
  await expect(bar).not.toHaveClass(/warn|over/);
});

test("«Función» as a step (task 93, D-52): «Añadir paso» offers it under «Funciones»; its panel chooses an active function and shows its code and its tests, to read", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/flows": [FLOWS_WITH_SUMMARY],
      "GET api/agent/flows/:id": [FLOW_SUMMARY],
      "GET api/agent/flows/catalog": [FLOW_CATALOG_FUNCTIONS],
      "POST api/agent/flows/check": [{ problems: [], refs: {} }],
      "PUT api/agent/flows/:id": [{ ...FLOW_SUMMARY, version: 2 }],
    },
  });
  await openFlow(page, "Resumen diario");
  await page.getByRole("button", { name: "Añadir paso" }).click();
  const add = page.getByRole("dialog", { name: "Añadir paso" });
  const group = add.locator(".flow-kind-group", {
    has: page.locator(".menu-head", { hasText: "Funciones" }),
  });
  await expect(group.getByRole("menuitemradio")).toHaveText(["Función", "Aplicar cambios"]);
  await group.getByRole("menuitemradio", { name: "Función", exact: true }).click();
  const panel = page.locator(".flow-step-panel");
  await expect(panel.locator("h3")).toHaveText("Función");
  // The active functions by their names; the chosen one's code and its tests, folded, to read (never edited here).
  const fn = panel.getByRole("combobox", { name: "Función" });
  await expect(fn.locator("option")).toHaveText(["Nada", "Banco · importar"]);
  await fn.selectOption("banco/importar");
  await panel.locator(".flow-fn-code summary", { hasText: "Código" }).click();
  await expect(panel.locator(".flow-fn-code pre")).toContainText("function importar(input)");
  await expect(panel.locator(".flow-fn-code").locator("textarea, [contenteditable]")).toHaveCount(
    0,
  );
  await panel.locator(".flow-fn-code summary", { hasText: "Pruebas (1)" }).click();
  await expect(panel.locator(".flow-fn-tests li")).toHaveText(["dos líneas dan dos movimientos"]);
  await page.screenshot({ path: `${SHOTS}/flow-function-step.png` });
  // Saved, the step names the function literally (D-48, D-52).
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  const body = await page.waitForFunction(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).find((b) =>
      b.startsWith("PUT api/agent/flows/resumen-diario "),
    ),
  );
  const sent = JSON.parse(String(await body.jsonValue()).replace(/^PUT \S+ /, "")) as {
    plan: { steps: { tool?: string; args?: Record<string, unknown> }[] };
  };
  expect(sent.plan.steps.find((s) => s.tool === "function.run")?.args?.funcion).toEqual({
    lit: "banco/importar",
  });
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
  await expect(made.locator(".fl-node.source")).toContainText("Hoy");
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
