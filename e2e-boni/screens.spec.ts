import { expect, type Page, test } from "@playwright/test";
import {
  FLOW_CATALOG,
  FLOW_CHECK,
  FLOW_DETAIL,
  FLOWS_WITH_SUMMARY,
  MAP,
  MODELS,
} from "./agent-scenarios.ts";
import { openApp, openInTree, TEMPLATE } from "./fixtures.ts";

/**
 * I-07 (docs/principios.md): the main screens do not change their look by mistake. Each is compared with its reference
 * capture, made on CI's machine (its fonts), so only CI compares (`ignoreSnapshots` locally). A change that is meant
 * brings its new captures in the same PR: run the workflow «screens» (`--update-snapshots`) and commit what it uploads.
 * The clock is fixed so no date moves between runs.
 */
const FIXED = new Date("2026-10-20T10:00:00+02:00");

async function open(page: Page, agent: Record<string, unknown[]> = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: FIXED });
  await openApp(page, "/?still", { agent });
  // The start page shown, and so in «Recientes»: every capture has the same sidebar.
  await expect(page.locator(".sidebar").getByRole("list", { name: "Recientes" })).toHaveText(
    "Gastos",
  );
}
const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    maxDiffPixelRatio: 0.002,
  });

test("the start page (Gastos)", async ({ page }) => {
  await open(page);
  await page.locator(".doc-charts .chart-card .chart svg").first().waitFor();
  await shot(page, "gastos");
});

const FLOW_AGENT = {
  "GET api/agent/models": [MODELS],
  "GET api/agent/map": [MAP],
  "GET api/agent/flows": [FLOWS_WITH_SUMMARY],
  "GET api/agent/flows/:id": [FLOW_DETAIL],
  "GET api/agent/flows/catalog": [FLOW_CATALOG],
  "POST api/agent/flows/check": [FLOW_CHECK],
};

test("Flujos", async ({ page }) => {
  await open(page, FLOW_AGENT);
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await page.locator(".db-table tbody tr").first().waitFor();
  await shot(page, "flujos");
});

test("Flujos: el mapa", async ({ page }) => {
  await open(page, FLOW_AGENT);
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await page.getByRole("tab", { name: "Mapa" }).click();
  await page.locator(".mp-card").first().waitFor();
  await page.waitForTimeout(600); // the map fits what it shows with a short motion
  await shot(page, "flujos-mapa");
});

test("Flujos: un flujo", async ({ page }) => {
  await open(page, FLOW_AGENT);
  await page.locator(".sidebar").getByRole("button", { name: "Flujos", exact: true }).click();
  await page.locator(".db-table").getByText("Leer correo", { exact: true }).click();
  await page.locator(".flow-editor .flow-canvas .fl-node").first().waitFor();
  await page.getByRole("button", { name: "Añadir paso" }).waitFor();
  await page.waitForTimeout(400); // the canvas fits the flow with a short motion
  await shot(page, "flujos-flujo");
});

test("«Uso de la IA», a template page over Boni's records", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: FIXED });
  await openApp(page, "/?still", { pages: [TEMPLATE("uso-ia")] });
  await openInTree(page, "Uso de la IA");
  await page.locator(".blk-bars .barlist-row").first().waitFor();
  await page.locator(".data-blk-chart .chart svg").first().waitFor();
  await shot(page, "uso-ia");
});

test("«Registro», a template page over Boni's runs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: new Date("2026-10-27T10:00:00+02:00") });
  await openApp(page, "/?still", { pages: [TEMPLATE("registro")] });
  await openInTree(page, "Registro");
  await expect(page.locator(".blk-number .kpi-value").first()).not.toHaveText("—");
  await page.locator(".data-blk-chart .chart svg").first().waitFor();
  await page.locator(".db-table tbody tr").first().waitFor();
  await shot(page, "registro");
});

test("Mis datos", async ({ page }) => {
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data .db-table tbody tr").first().waitFor();
  await shot(page, "mis-datos");
});

test("Mis datos: diagrama", async ({ page }) => {
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  // A view of its own (task 69): «+», «Diagrama».
  await page.locator(".my-data .db-head").getByRole("button", { name: "Añadir vista" }).click();
  await page
    .getByRole("dialog", { name: "Añadir vista" })
    .getByRole("button", { name: "Diagrama" })
    .click();
  await page.locator(".data-diagram .dg-card-node").first().waitFor();
  await page.waitForTimeout(400); // the canvas fits the diagram with a short motion
  await shot(page, "mis-datos-diagrama");
});

test("Ajustes", async ({ page }) => {
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await page.locator(".modal").waitFor();
  await shot(page, "ajustes");
});

test("a block's panel", async ({ page }) => {
  await open(page);
  await page.locator(".doc-tail").click();
  await page.keyboard.type("/Cifra", { delay: 20 });
  await page.locator(".slash-menu").getByRole("menuitem", { name: "Cifra", exact: true }).click();
  await page.locator(".blk-number .kpi-value").filter({ hasText: "3" }).waitFor();
  await shot(page, "panel-bloque");
});
