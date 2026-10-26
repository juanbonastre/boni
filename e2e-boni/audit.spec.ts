import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { AUDIT_ACTIONS, AUDIT_DETAIL, AUDIT_SUMMARY, RUNS_EXPLAINED } from "./agent-scenarios.ts";
import { openApp, openLog, recorded } from "./fixtures.ts";

/**
 * «Actividad» and «Auditoría» (Juan, 2026-10-24): numbers and charts of what was read and changed and by whom, the
 * runs folded below; the audit as a read-only table whose rows open what reached each actor and what it wrote.
 */
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
};

test("Registro: what was read and changed, by whom and where; the runs folded below", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AUDIT });
  await openLog(page);
  await expect(page.locator(".topbar h1")).toHaveText("Registro");
  const kpis = page.locator(".kpi");
  await expect(kpis).toHaveText([
    /Correos leídos\s*412/,
    /Propuestas\s*138\s*81 % aceptadas/,
    /Cambios\s*87\s*12 deshechos/,
    /Peticiones tuyas\s*34/,
  ]);
  await expect(page.locator(".kinds")).toContainText("61Crear");
  const types = page.locator(".dash-col").last().locator(".barlist-row");
  await expect(types.first()).toContainText("Correos");
  await expect(page.getByRole("button", { name: /^Ejecuciones/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({ path: `${SHOTS}/activity.png`, fullPage: true });
  await page.getByRole("button", { name: /^Ejecuciones/ }).click();
  await expect(page.locator(".log-list li").first()).toBeVisible();
  // The period changes the numbers asked for.
  await page.getByRole("radio", { name: "7 días" }).click();
  await expect
    .poll(async () => (await requests(page, "GET api/data/audit/summary")).length)
    .toBe(2);
  // A collection's bars open the audit of that collection.
  await page.locator(".barlist-row", { hasText: "Docencia" }).last().click();
  await expect(page.locator(".topbar")).toContainText("Registro/Auditoría");
  await expect(page.getByRole("combobox", { name: "Colección" })).toBeVisible();
  expect((await requests(page, "GET api/data/audit/actions")).at(-1)).toContain("type=t_docencia");
});

test("Auditoría: who did what on what; a row opens what reached it and what it wrote", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AUDIT });
  await openLog(page);
  await page.getByRole("button", { name: "Abrir la auditoría" }).click();
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

test("Actividad on a device that may not read the audit: the runs, as before", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/data/audit/summary": [{ __status: 403, error: "personal-device-only" }],
      "GET api/agent/runs": [RUNS_EXPLAINED],
    },
  });
  await openLog(page);
  await expect(
    page.getByText("La actividad con cifras solo se ve desde un dispositivo personal"),
  ).toBeVisible();
  await expect(page.locator(".log-list li").first()).toBeVisible();
});
