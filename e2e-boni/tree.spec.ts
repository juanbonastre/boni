import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AUDIT_SUMMARY, ROW_HISTORY, STORAGE } from "./agent-scenarios.ts";
import { openApp, PAGE_FROM_HOME, TEMPLATE } from "./fixtures.ts";

/**
 * One tree (docs/clases.md §2.7; Juan, 2026-10-28): the sidebar has «Todas las páginas» beside Buscar and
 * Conversación, then «Recientes» and «Páginas» (to open, add and delete, with the eye); «Todas las páginas» manages
 * it all (search, what the AI sees, the eye, «Mover a…»), with what the AIs read and each note's history.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });
const AGENT = {
  "GET api/data/audit/rows/:id": [ROW_HISTORY],
  "GET api/data/audit/storage": [STORAGE],
  "GET api/data/audit/summary": [AUDIT_SUMMARY],
};

test("the sidebar: «Todas las páginas» by Buscar and Conversación, then «Recientes» and «Páginas», folded by their names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { pages: [PAGE_FROM_HOME, TEMPLATE("uso-ia")] });
  const side = page.locator(".sidebar");
  await expect(side.locator(".sidebar-scroll > .nav-row")).toHaveText([
    /^Buscar/,
    "Conversación",
    "Todas las páginas",
  ]);
  const pages = side.getByRole("list", { name: "Páginas" });
  // The user's pages, then the collections (folded), then Boni's own things.
  await expect(pages.locator(":scope > li > .chart-row .nav-name")).toHaveText([
    "Gastos",
    "Documentos",
    "Libros",
    "Boni",
  ]);
  // «Recientes»: the page opened at the start; a collection opened goes first.
  const recent = side.getByRole("list", { name: "Recientes" });
  await expect(recent.locator(".nav-name")).toHaveText(["Gastos"]);
  await pages.getByRole("button", { name: "Libros", exact: true }).click();
  await expect(page.locator(".cols-title")).toHaveText("📚Libros");
  await expect(recent.locator(".nav-name")).toHaveText(["Libros", "Gastos"]);
  await expect(recent.locator(".tree-row.active")).toHaveText("📚Libros");
  // Boni's branch: its template pages and its own collections, read only.
  await pages.getByRole("button", { name: "Mostrar subpáginas: Boni" }).click();
  await expect(pages.getByRole("button", { name: "Uso de la IA", exact: true })).toBeVisible();
  await expect(
    pages.getByRole("button", { name: "Llamadas a modelos", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/sidebar.png` });
  // Each section folds by its name, and unfolds the same way.
  await side.getByRole("button", { name: "Recientes" }).click();
  await expect(recent).toHaveCount(0);
  await expect(side.getByRole("button", { name: "Recientes" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await side.getByRole("button", { name: "Páginas", exact: true }).click();
  await expect(pages).toHaveCount(0);
  await side.getByRole("button", { name: "Páginas", exact: true }).click();
  await expect(pages.getByRole("button", { name: "Uso de la IA", exact: true })).toBeVisible();
});

test("the tree: a folder shows its notes, the eye another's; a collection made inside; only an empty one is deleted", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still");
  const pages = page.locator(".sidebar").getByRole("list", { name: "Páginas" });
  // Documentos is a folder of notes (no fields of its own): its notes show under it.
  await pages.getByRole("button", { name: "Mostrar subpáginas: Documentos" }).click();
  await expect(
    pages.getByRole("button", { name: "Contrato de ejemplo", exact: true }),
  ).toBeVisible();
  // Libros has fields of its own: its notes show only with its eye.
  await expect(pages.getByRole("button", { name: "Mostrar subpáginas: Libros" })).toHaveCount(0);
  await pages.locator(".tree-row", { hasText: "Libros" }).hover();
  await pages.getByRole("button", { name: "Mostrar sus notas en la barra: Libros" }).click();
  await pages.getByRole("button", { name: "Mostrar subpáginas: Libros" }).click();
  await expect(pages.getByRole("button", { name: "Rayuela", exact: true })).toBeVisible();
  // A collection made inside Libros, named in place: it opens on its own page, under Libros.
  await pages.getByRole("button", { name: "Más opciones: Libros" }).click();
  await page.getByRole("menuitemradio", { name: "Nueva colección dentro" }).click();
  await page
    .getByRole("textbox", { name: "Nombre de la colección" })
    .pressSequentially("Clásicos", { delay: 20 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".cols-title")).toHaveText("Clásicos");
  await expect(page.locator(".topbar .crumbs")).toHaveText(/Libros\s*\/\s*Clásicos/);
  await expect(pages.getByRole("button", { name: "Clásicos", exact: true })).toBeVisible();
  // A name already taken is said, and the box stays to change it.
  await pages.getByRole("button", { name: "Más opciones: Libros" }).click();
  await page.getByRole("menuitemradio", { name: "Nueva colección dentro" }).click();
  await page
    .getByRole("textbox", { name: "Nombre de la colección" })
    .pressSequentially("Documentos", { delay: 20 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast")).toContainText("Ya hay una colección con ese nombre");
  await expect(page.getByRole("textbox", { name: "Nombre de la colección" })).toHaveValue(
    "Documentos",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Nombre de la colección" })).toHaveCount(0);
  // Only an empty collection is deleted: Libros has its books, Clásicos nothing.
  await pages.getByRole("button", { name: "Más opciones: Libros" }).click();
  await page.getByRole("menuitemradio", { name: "Eliminar colección" }).click();
  await expect(page.locator(".toast")).toContainText("Solo se elimina una colección vacía");
  await pages.getByRole("button", { name: "Más opciones: Clásicos" }).click();
  await page.getByRole("menuitemradio", { name: "Eliminar colección" }).click();
  await expect(pages.getByRole("button", { name: "Clásicos", exact: true })).toHaveCount(0);
  // A new note: a record of the collection, open as its page.
  await pages.locator(".tree-row", { hasText: "Documentos" }).first().hover();
  await pages.getByRole("button", { name: "Nueva nota: Documentos" }).click();
  await expect(page.locator(".topbar .crumbs")).toHaveText(/Documentos\s*\/\s*Sin título/);
});

test("«Todas las páginas»: everything to manage; a search or a level lists it flat; «Mover a…»; a note's history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Todas las páginas" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Todas las páginas");
  const table = page.locator(".all-table");
  const names = table.locator("tbody .cols-name");
  // The user's pages, then the collections, then Boni's own things.
  await expect(names).toHaveText(["Gastos", "Documentos", "Libros", "Boni"]);
  // Libros open: all its notes, whatever its eye says, each with the AIs that read it.
  await table.getByRole("button", { name: "Mostrar subpáginas: Libros" }).click();
  await expect(
    table.locator(".all-row", { hasText: "Rayuela" }).locator(".notes-ai"),
  ).toHaveAttribute("title", /La ha leído MCP · claude-ejemplo, Agente · claude-opus-5-5/);
  await expect(
    table.getByRole("button", { name: "Mostrar sus notas en la barra: Libros" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: `${SHOTS}/all-pages.png` });
  // A search lists what matches flat, each with where it is.
  const search = page.getByRole("textbox", { name: "Buscar por nombre o título" });
  await search.pressSequentially("contrato", { delay: 20 });
  await expect(names).toHaveText(["Contrato de ejemplo"]);
  await expect(table.locator(".all-where")).toHaveText("Documentos");
  await search.fill("");
  // A level lists the collections at it.
  await page.getByRole("radio", { name: /Privada/ }).click();
  await expect(names).toHaveText(["Documentos"]);
  await page.getByRole("radio", { name: "Todas" }).click();
  // «Mover a…»: a note of Documentos into Libros (never where it already is).
  await table.getByRole("button", { name: "Mostrar subpáginas: Documentos" }).click();
  await table.getByRole("button", { name: "Más opciones: Póliza de ejemplo" }).click();
  await page.getByRole("menuitemradio", { name: "Mover a…" }).click();
  await expect(page.locator(".all-move .menu-item")).toHaveText(["Libros"]);
  await page.getByRole("menuitemradio", { name: "Libros" }).click();
  await expect(names).toHaveText([
    "Gastos",
    "Documentos",
    "Contrato de ejemplo",
    "Libros",
    "Rayuela",
    "Póliza de ejemplo",
    "Boni",
  ]);
  // A collection into another, and back to the top level.
  await table.getByRole("button", { name: "Más opciones: Documentos" }).click();
  await page.getByRole("menuitemradio", { name: "Mover a…" }).click();
  await expect(page.locator(".all-move .menu-item")).toHaveText(["Libros"]);
  await page.getByRole("menuitemradio", { name: "Libros" }).click();
  await expect(names).toHaveText([
    "Gastos",
    "Libros",
    "Documentos",
    "Contrato de ejemplo",
    "Rayuela",
    "Póliza de ejemplo",
    "Boni",
  ]);
  await table.getByRole("button", { name: "Más opciones: Documentos" }).click();
  await page.getByRole("menuitemradio", { name: "Mover a…" }).click();
  await expect(page.locator(".all-move .menu-item")).toHaveText(["Al primer nivel"]);
  await page.getByRole("menuitemradio", { name: "Al primer nivel" }).click();
  await expect(names.nth(1)).toHaveText("Documentos");
  // A note opens as its page, after its collection; its history beside it; Escape comes back here.
  await table.getByRole("button", { name: "Rayuela", exact: true }).click();
  await expect(page.locator(".topbar .crumbs")).toHaveText(
    /Todas las páginas\s*\/\s*Libros\s*\/\s*Rayuela/,
  );
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
  await expect(page.locator(".topbar h1")).toHaveText("Todas las páginas");
  // A page of the list opens as itself.
  await table.getByRole("button", { name: "Gastos", exact: true }).click();
  await expect(page.locator(".page-doc .doc-title")).toHaveValue("Gastos");
});

test("a note is a page: the full editor, and what Markdown cannot say saved as a marked block", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT, pages: [] });
  // Libros' notes are not in the sidebar: «Todas las páginas» lists them with Libros open.
  const open = async () => {
    await page
      .locator(".all-table")
      .getByRole("button", { name: "Mostrar subpáginas: Libros" })
      .click();
    await page.locator(".all-table").getByRole("button", { name: "Rayuela", exact: true }).click();
  };
  await page.locator(".sidebar").getByRole("button", { name: "Todas las páginas" }).click();
  await open();
  const doc = page.locator(".doc-editor");
  // The page's own «/»: a Cifra over the collection the note belongs to, computed like any page's.
  await doc.locator(".doc-tail").click();
  await page.keyboard.type("/Cifra", { delay: 20 });
  await page.locator(".slash-menu").getByRole("menuitem", { name: "Cifra", exact: true }).click();
  await expect(doc.locator(".blk-number .kpi-value")).toBeVisible();
  // Leaving by its crumb (the new block's title keeps the focus, as when Juan types) saves the note's text;
  // the block travels as a fenced «boni» block and comes back the same.
  await page.locator(".topbar .crumbs").getByRole("button", { name: "Todas las páginas" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Todas las páginas");
  await open();
  await expect(page.locator(".doc-editor .blk-number .kpi-value")).toBeVisible();
  const body = await page.evaluate(async () => {
    const r = await (
      window as unknown as {
        boniDesktop: { request: (m: string, p: string) => Promise<{ body: string }> };
      }
    ).boniDesktop.request("GET", "api/data/rows/r1");
    return (JSON.parse(r.body) as { row: { body: string } }).row.body;
  });
  expect(body).toContain("```boni");
  expect(body).toContain('"type":"number"');
});

test("system columns in a table: none by default, chosen from the view's options, never editable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Todas las páginas" }).click();
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

test("«Todas las páginas» says what the collections take: records, storage and its parts, size and use, advice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Todas las páginas" }).click();
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
