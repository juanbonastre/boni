import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  AUDIT_ACTIONS,
  AUDIT_DETAIL,
  AUDIT_SUMMARY,
  RUN_2,
  RUNS_EXPLAINED,
} from "./agent-scenarios.ts";
import { openApp, openLog, recorded, TEMPLATE } from "./fixtures.ts";

/** The run pages and the read-only audit, whose rows open what reached each actor and what it wrote. */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });
const requests = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

const AUDIT = {
  "GET api/data/audit/summary": [AUDIT_SUMMARY],
  "GET api/data/audit/actions": [AUDIT_ACTIONS],
  "GET api/data/audit/actions/:seq": [AUDIT_DETAIL],
  "GET api/data/audit/verify": [{ ok: true, ops: 10, actions: 9, broken: null }],
  "GET api/agent/runs": [RUNS_EXPLAINED],
  "GET api/agent/runs/:id": [RUN_2],
};

test("Registro is a real page; the conversation keeps the runs with Undo and the audit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: AUDIT,
    pages: [TEMPLATE("actividad"), TEMPLATE("registro")],
  });
  await page.locator(".sidebar").getByRole("button", { name: "Actividad", exact: true }).click();
  await page.getByRole("button", { name: "Cada ejecución de Boni" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Registro");
  await expect(page.locator(".blk-number")).toHaveCount(3);
  await expect(page.locator(".blk-number .kpi-value").first()).not.toHaveText("—");
  await page.locator(".data-blk-chart .chart svg").first().waitFor();
  await expect(page.locator(".db-table tbody tr").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/registro-page.png`, fullPage: true });

  await openLog(page);
  await expect(page.locator(".topbar h1")).toHaveText("Registro");
  await page.locator(".log-head").first().click();
  await expect(page.locator(".log-steps").first()).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Conversación" }).click();
  await page.locator(".chat-tools").getByRole("button", { name: "Auditoría" }).click();
  await expect(page.locator(".topbar")).toContainText("Registro/Auditoría");
  await expect(page.getByRole("combobox", { name: "Colección" })).toBeVisible();
});

test("Auditoría: who did what on what; a row opens what reached it and what it wrote", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AUDIT });
  await page.locator(".sidebar").getByRole("button", { name: "Conversación" }).click();
  await page.locator(".chat-tools").getByRole("button", { name: "Auditoría" }).click();
  const rows = page.locator(".audit-tr:not(.audit-th)");
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(1)).toContainText("MCP · claude-ejemplo");
  await expect(rows.nth(1)).toContainText("Buscó «dentista»");
  await expect(rows.nth(1)).toContainText("Salud · 2 registros");
  await expect(rows.nth(3)).toContainText("Nada de tus datos");
  await expect(rows.nth(4)).toContainText("https://example.com/agenda");
  await expect(rows.nth(6)).toHaveClass(/denied/);
  await expect(rows.nth(6)).toContainText("Intentó: Editó");
  await page.getByRole("button", { name: "Verificar la cadena" }).click();
  await expect(page.locator(".audit-chain.ok")).toHaveText("Cadena verificada");

  await rows.first().click();
  const panel = page.locator(".audit-panel");
  await expect(panel.locator("h2")).toHaveText("Lector · deepseek-v4.1-flash");
  const seen = panel.locator(".audit-seen").first().locator("li");
  await expect(seen).toHaveCount(3);
  await expect(seen.first()).toContainText("Entrega de actas");
  await expect(seen.first()).toContainText("Correos · Asunto, De");
  await expect(seen.first()).toContainText("con la nota");
  await expect(seen.nth(1)).toContainText("sin la nota");
  // What the model answered, as text.
  await expect(panel.locator(".audit-answer")).toContainText('"title": "Enviar las actas"');
  await page.screenshot({ path: `${SHOTS}/audit.png` });
  await panel.getByRole("button", { name: "Ver toda la ejecución" }).click();
  await expect(page.getByRole("button", { name: "Una ejecución" })).toBeVisible();
  expect((await requests(page, "GET api/data/audit/actions")).at(-1)).toContain("run=r1");
  // Kinds of actor.
  await page.getByRole("radio", { name: "Modelos" }).click();
  expect((await requests(page, "GET api/data/audit/actions")).at(-1)).toContain("who=model%3A");
});

test("Registro does not require audit access: the runs, as before", async ({ page }) => {
  await openApp(page, "/?still", { agent: { "GET api/agent/runs": [RUNS_EXPLAINED] } });
  await openLog(page);
  await expect(page.locator(".log-list li").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Deshacer lo que hizo" })).toBeVisible();
});
