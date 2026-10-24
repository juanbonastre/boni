import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AUDIT_SUMMARY, NOTES, ROW_HISTORY, STORAGE } from "./agent-scenarios.ts";
import { openApp } from "./fixtures.ts";

/**
 * Everything the AIs read, browsable (Juan, 2026-10-24): the notes by path with what an AI read, a row's history
 * (system columns, who wrote what, changes, who saw it), system columns in a table, and the collections' use.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });
const AGENT = {
  "GET api/data/notes": [NOTES],
  "GET api/data/audit/rows/:id": [ROW_HISTORY],
  "GET api/data/audit/storage": [STORAGE],
  "GET api/data/audit/summary": [AUDIT_SUMMARY],
};

test("the notes explorer: the vault's tree, the notes an AI read marked; a note opens as its page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Notas" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Notas");
  await expect(page.locator(".dash-head")).toContainText("8 notas · 4 leídas por una IA");
  const tree = page.locator(".notes-tree");
  // Folders first, then the notes of the root.
  await expect(tree.locator(":scope > li > .notes-row .notes-name")).toHaveText([
    "_system",
    "proyectos",
    "wiki",
    "AGENTS.md",
    "README.md",
  ]);
  await expect(
    tree.getByRole("button", { name: /^AGENTS\.md/ }).locator(".notes-ai"),
  ).toHaveAttribute("title", /La ha leído MCP · claude-ejemplo, Agente · claude-opus-5-5/);
  await expect(tree.getByRole("button", { name: /^wiki/ })).toContainText("1");
  await tree.getByRole("button", { name: /^wiki/ }).click();
  await tree.getByRole("button", { name: /^infra/ }).click();
  await tree.getByRole("button", { name: /^nas/ }).click();
  await expect(tree.getByRole("button", { name: /servidor-ejemplo\.md/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/notes.png` });
  await page.getByRole("textbox", { name: "Buscar por ruta o título" }).pressSequentially("plan");
  await expect(tree.locator(".notes-row")).toHaveCount(1);
  await tree.getByRole("button", { name: /proyectos\/plan-ejemplo\.md/ }).click();
  await expect(page.locator(".topbar .crumbs")).toContainText("Notas");
  // Its history beside it: system columns, who wrote what, changes, who saw it.
  await page.getByRole("button", { name: "Historial" }).click();
  const h = page.locator(".history-panel");
  await expect(h.locator(".history-cols")).toContainText("Creado porTú · portatil");
  await expect(h.locator(".history-cols")).toContainText("OrigenDe un modelo");
  await expect(h.locator(".blame-block")).toHaveCount(3);
  await expect(h.locator(".blame-block").nth(1)).toContainText("Lector · deepseek-v4.1-flash");
  await expect(h.locator(".blame-block").nth(2)).toContainText("MCP · claude-ejemplo");
  await expect(h.locator(".audit-seen").last().locator("li").first()).toContainText("con la nota");
  await page.screenshot({ path: `${SHOTS}/history.png` });
  await page.keyboard.press("Escape");
  await expect(h).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".topbar h1")).toHaveText("Notas");
});

test("system columns in a table: none by default, chosen from the view's options, never editable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Colecciones" }).click();
  await page.getByRole("button", { name: "Abrir Libros" }).click();
  const table = page.locator(".db-table");
  await expect(table.locator("th.sys-col")).toHaveCount(0);
  await page.getByRole("button", { name: "Opciones", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Creado por" }).click();
  await page.getByRole("menuitemradio", { name: "Visto por" }).click();
  await page.keyboard.press("Escape");
  await expect(table.locator("th.sys-col")).toHaveText(["Creado por", "Visto por"]);
  await expect(table.locator("tbody tr").first().locator("td.sys-col").first()).toHaveText(
    "Importación",
  );
  await expect(table.locator("tbody tr").nth(1).locator("td.sys-col").last()).toHaveText(
    "MCP · claude-ejemplo",
  );
  await page.screenshot({ path: `${SHOTS}/system-columns.png` });
});

test("Colecciones: records, storage and its parts, size and use per collection, and the advice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Colecciones" }).click();
  const usage = page.locator(".cols-usage");
  await expect(usage.locator(".kpi")).toHaveText([
    /Registros\s*85/,
    /Almacenamiento\s*400,5 MB/,
    /Historial\s*2,3 MB/,
    /Textos de los modelos\s*124 MB/,
  ]);
  await expect(usage.locator(".cols-advice")).toContainText("ocupa 124 MB");
  await expect(usage.locator(".barlist").first().locator(".barlist-row").first()).toContainText(
    "Proyecto",
  );
  await page.screenshot({ path: `${SHOTS}/collections-usage.png`, fullPage: true });
  await usage.locator(".barlist").last().locator(".barlist-row", { hasText: "Correos" }).click();
  await expect(page.locator(".topbar")).toContainText("Auditoría");
});
