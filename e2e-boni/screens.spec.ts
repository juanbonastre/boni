import { expect, type Page, test } from "@playwright/test";
import { MODELS } from "./agent-scenarios.ts";
import { openApp, TEMPLATE } from "./fixtures.ts";

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

test("Ajustes → Modelos", async ({ page }) => {
  await open(page, { "GET api/agent/models": [MODELS] });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await page.locator(".modal").getByRole("tab", { name: "Modelos" }).click();
  await page.locator(".use-card").first().waitFor();
  await shot(page, "modelos");
});

test("«Uso de la IA», a template page over Boni's records", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: FIXED });
  await openApp(page, "/?still", { pages: [TEMPLATE("uso-ia")] });
  await page.locator(".sidebar").getByRole("button", { name: "Uso de la IA", exact: true }).click();
  await page.locator(".blk-bars .barlist-row").first().waitFor();
  await page.locator(".data-blk-chart .chart svg").first().waitFor();
  await shot(page, "uso-ia");
});

test("«Registro», a template page over Boni's runs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: new Date("2026-10-27T10:00:00+02:00") });
  await openApp(page, "/?still", { pages: [TEMPLATE("registro")] });
  await page.locator(".sidebar").getByRole("button", { name: "Registro", exact: true }).click();
  await expect(page.locator(".blk-number .kpi-value").first()).not.toHaveText("—");
  await page.locator(".data-blk-chart .chart svg").first().waitFor();
  await page.locator(".db-table tbody tr").first().waitFor();
  await shot(page, "registro");
});

test("Colecciones", async ({ page }) => {
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Colecciones" }).click();
  await page.locator(".cols-table tbody tr").first().waitFor();
  await shot(page, "colecciones");
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
