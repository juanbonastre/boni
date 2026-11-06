import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AUDIT_SUMMARY, ROW_HISTORY, STORAGE } from "./agent-scenarios.ts";
import {
  addFilter,
  grown,
  openApp,
  PAGE_FROM_HOME,
  recorded,
  removeFilter,
  setLayout,
  TEMPLATE,
} from "./fixtures.ts";

/**
 * One tree (docs/clases.md §2.7; Juan, 2026-10-28): the sidebar has «Mis datos» beside Buscar and
 * Conversación, then «Recientes» and «Páginas» (to open, add and delete, with the eye); «Mis datos» is a
 * collection of it all (docs/flujos.md §4.7, F6b): a row per page and collection, changed in place, with the
 * views of any collection (the diagram one of them); and each note's history.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });
const AGENT = {
  "GET api/data/audit/rows/:id": [ROW_HISTORY],
  "GET api/data/audit/storage": [STORAGE],
  "GET api/data/audit/summary": [AUDIT_SUMMARY],
};

test("the sidebar: «Mis datos» by Buscar and Conversación, then «Recientes» and «Páginas», folded by their names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { pages: [PAGE_FROM_HOME, TEMPLATE("uso-ia")] });
  const side = page.locator(".sidebar");
  await expect(side.locator(".sidebar-scroll > .nav-row")).toHaveText([
    /^Buscar/,
    "Conversación",
    "Mis datos",
    "Flujos",
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

test("the right button in the sidebar (task 42): a page's, a collection's and a note's «Más opciones» where the pointer is; each renamed in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // A note opened before is in «Recientes»: renamed from the tree, it says its new name there too.
  const before = {
    kind: "row",
    id: "d1",
    type: "t_private_documentos",
    title: "Contrato de ejemplo",
  };
  await openApp(page, "/?still", {
    pages: [PAGE_FROM_HOME, TEMPLATE("uso-ia")],
    files: { "recent.json": JSON.stringify({ items: [before] }) },
  });
  const pages = page.locator(".sidebar").getByRole("list", { name: "Páginas" });
  const sent = async (start: string, part: string) =>
    (await recorded(page)).requests.some((r) => r.startsWith(start) && r.includes(part));
  const items = (name: string) =>
    page.getByRole("dialog", { name: `Más opciones: ${name}` }).getByRole("menuitemradio");
  // «Cambiar nombre» writes in place, its name chosen to be written over.
  const rename = async (name: string, to: string) => {
    await items(name).filter({ hasText: "Cambiar nombre" }).click();
    await expect(pages.getByRole("textbox", { name: `Cambiar nombre: ${name}` })).toBeFocused();
    await page.keyboard.type(to, { delay: 15 });
  };
  // A page: the same menu as its «Más opciones», opened where the pointer is (task 39), its row lit meanwhile.
  const gastos = pages.locator(".page-row", { hasText: "Gastos" });
  await gastos.click({ button: "right", position: { x: 60, y: 12 } });
  await grown(page.getByRole("dialog", { name: "Más opciones: Gastos" }));
  const at = (await gastos.boundingBox()) as { x: number; y: number };
  const menu = (await page.getByRole("dialog", { name: "Más opciones: Gastos" }).boundingBox()) as {
    x: number;
    y: number;
  };
  expect(Math.abs(menu.x - (at.x + 60))).toBeLessThan(6);
  expect(Math.abs(menu.y - (at.y + 12))).toBeLessThan(6);
  await expect(gastos).toHaveClass(/menu-open/);
  await page.screenshot({ path: `${SHOTS}/sidebar-menu.png` });
  // «Ver en el mapa» (I-25): the page in the centre of «Flujos»' map.
  const pageItems = [
    "Cambiar nombre",
    "Añadir subpágina",
    "Duplicar",
    "Ver en el mapa",
    "Borrar página",
  ];
  await expect(items("Gastos")).toHaveText(pageItems);
  await page.keyboard.press("Escape");
  await expect(items("Gastos")).toHaveCount(0);
  await gastos.hover();
  await pages.getByRole("button", { name: "Más opciones: Gastos" }).click();
  await expect(items("Gastos")).toHaveText(pageItems);
  await page.keyboard.press("Escape");
  // Escape leaves the name as it was, Enter keeps the new one.
  await gastos.click({ button: "right" });
  await rename("Gastos", "Otra cosa");
  await page.keyboard.press("Escape");
  await expect(pages.getByRole("textbox")).toHaveCount(0);
  await expect(pages.getByRole("button", { name: "Gastos", exact: true })).toBeVisible();
  await gastos.click({ button: "right" });
  await rename("Gastos", "Gastos de casa");
  await page.keyboard.press("Enter");
  await expect(pages.getByRole("button", { name: "Gastos de casa", exact: true })).toBeVisible();
  await expect.poll(() => sent("PUT api/pages/gastos ", "Gastos de casa")).toBe(true);
  expect(await sent("PUT api/pages/gastos ", "Otra cosa")).toBe(false);
  // A collection: its own menu; a name taken by another is said and the old one stays.
  const libros = pages.locator(".tree-row", { hasText: "Libros" });
  await libros.click({ button: "right" });
  await expect(items("Libros")).toHaveText([
    "Nueva nota",
    "Nueva colección dentro",
    "Cambiar nombre",
    "Ver en el mapa",
    "Eliminar colección",
  ]);
  await rename("Libros", "Lecturas");
  await page.screenshot({ path: `${SHOTS}/sidebar-rename.png` });
  await page.keyboard.press("Enter");
  await expect(pages.getByRole("button", { name: "Lecturas", exact: true })).toBeVisible();
  await expect.poll(() => sent("PUT api/data/types/t_libro/name ", '"name":"Lecturas"')).toBe(true);
  await pages.locator(".tree-row", { hasText: "Documentos" }).click({ button: "right" });
  await rename("Documentos", "lecturas");
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast")).toContainText("Ya hay una colección con ese nombre");
  await expect(pages.getByRole("button", { name: "Documentos", exact: true })).toBeVisible();
  // A note: renamed (its record's title), its link, to the trash.
  await pages.getByRole("button", { name: "Mostrar subpáginas: Documentos" }).click();
  await pages.getByRole("button", { name: "Contrato de ejemplo", exact: true }).click({
    button: "right",
  });
  await expect(items("Contrato de ejemplo")).toHaveText([
    "Cambiar nombre",
    "Copiar enlace",
    "Mover a la papelera",
  ]);
  await rename("Contrato de ejemplo", "Contrato firmado");
  await page.keyboard.press("Enter");
  await expect(pages.getByRole("button", { name: "Contrato firmado", exact: true })).toBeVisible();
  expect(await sent("PUT api/data/rows/d1 ", "Contrato firmado")).toBe(true);
  await expect(page.locator(".sidebar").getByRole("list", { name: "Recientes" })).toContainText(
    "Contrato firmado",
  );
  // Boni's own things have nothing to be done with: no menu.
  await pages.getByRole("button", { name: "Mostrar subpáginas: Boni" }).click();
  await pages
    .getByRole("button", { name: "Llamadas a modelos", exact: true })
    .click({ button: "right" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("«Mis datos» is a collection (F6b): a row per page and collection, then Boni's; name, level, mother and eye change in place; «Nuevo», delete and Undo; a row opens what it is", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  const sent = async (start: string, part: string) =>
    (await recorded(page)).requests.some((r) => r.startsWith(start) && r.includes(part));
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Mis datos");
  const table = page.locator(".my-data .db-table");
  const titles = table.locator("tbody td.is-title");
  // The user's pages, then his collections, then Boni's own (D-04).
  await expect(titles).toHaveText([
    "Gastos",
    "Documentos",
    "Libros",
    "Llamadas a modelos",
    "Actividad de Boni",
    "Ejecuciones",
  ]);
  const line = (name: string) =>
    table.locator("tbody tr", { has: page.getByRole("button", { name, exact: true }) });
  await expect(line("Gastos")).toContainText("Página");
  await expect(line("Libros")).toContainText("Colección");
  await expect(line("Documentos")).toContainText("Privada");
  await expect(line("Ejecuciones")).toContainText("De Boni");
  // What does not apply to a row is text: a page has no eye; Boni's own rows are not deleted here.
  await expect(line("Gastos").getByRole("checkbox", { name: "En la barra" })).toHaveCount(0);
  await expect(line("Ejecuciones").getByRole("button", { name: /^Borrar/ })).toHaveCount(0);
  await expect(line("Libros").getByRole("checkbox", { name: "En la barra" })).toHaveCount(1);
  // What any collection's page has: its views as tabs with «+» (the diagram one of their layouts), «Filtro»,
  // «Ordenar», «Buscar», its settings, «Nuevo».
  const head = page.locator(".db-head");
  await expect(head.getByRole("tab")).toHaveText(["Tabla"]);
  for (const name of [
    "Añadir vista",
    "Filtro",
    "Ordenar",
    "Buscar",
    "Ajustes de la vista",
    "Nuevo",
  ])
    await expect(head.getByRole("button", { name, exact: true })).toBeVisible();
  await head.getByRole("button", { name: "Añadir vista" }).click();
  await expect(page.getByRole("dialog", { name: "Añadir vista" }).getByRole("button")).toHaveText([
    "Tabla",
    "Tablero",
    "Lista",
    "Galería",
    "Calendario",
    "Diagrama",
  ]);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SHOTS}/all-pages.png` });
  // Its name, in place; the sidebar says it too.
  await line("Libros").getByRole("button", { name: "Libros", exact: true }).dblclick();
  // The name is written once its box has the focus (on a slow machine a key typed before is lost).
  const naming = table.locator("tbody td.is-title input");
  await expect(naming).toBeFocused();
  await naming.fill("Lecturas");
  await naming.press("Enter");
  await expect.poll(() => sent("PUT api/data/rows/sys_data_t_libro ", "Lecturas")).toBe(true);
  await expect(page.locator(".sidebar")).toContainText("Lecturas");
  // Its level: up from here; a private one comes down only from its own page.
  await line("Lecturas").locator("td").nth(4).locator(".db-cell").click();
  await page.getByRole("menu").getByText("Restringida", { exact: true }).click();
  await expect
    .poll(() => sent("PUT api/data/rows/sys_data_t_libro ", "o_nivel_restricted"))
    .toBe(true);
  await expect(line("Lecturas")).toContainText("Restringida");
  await line("Documentos").locator("td").nth(4).locator(".db-cell").click();
  await page.getByRole("menu").getByText("Visible", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText("solo se abre a la IA desde su página");
  await expect(line("Documentos")).toContainText("Privada");
  // Its eye: whether its notes show in the sidebar.
  await line("Documentos").getByRole("checkbox", { name: "En la barra" }).uncheck();
  await expect
    .poll(() => sent("PUT api/data/rows/sys_data_t_private_documentos ", '"f_barra":false'))
    .toBe(true);
  // «Nuevo»: a collection, «Nueva colección»; deleted, and back with «Deshacer».
  await page.locator(".db-head").getByRole("button", { name: "Nuevo" }).click();
  await expect(line("Nueva colección")).toContainText("Colección");
  await expect(page.locator(".sidebar")).toContainText("Nueva colección");
  await line("Nueva colección")
    .getByRole("button", { name: /^Borrar/ })
    .click();
  await expect(line("Nueva colección")).toHaveCount(0);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(line("Nueva colección")).toHaveCount(1);
  // One with notes is not deleted: it says why.
  await line("Lecturas")
    .getByRole("button", { name: /^Borrar/ })
    .click();
  await expect(page.locator(".toast")).toContainText("Solo se elimina una colección vacía");
  await expect(line("Lecturas")).toHaveCount(1);
  // A row opens what it is: the collection's page, the page.
  await line("Lecturas").getByRole("button", { name: "Lecturas", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Lecturas");
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await line("Gastos").getByRole("button", { name: "Gastos", exact: true }).click();
  await expect(page.locator(".page-doc .doc-title")).toHaveValue("Gastos");
});

test("a note's history: who wrote what, each in their colour, and what each AI saw", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data").getByRole("button", { name: "Libros", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Libros");
  await page.locator(".db-table").getByRole("button", { name: "Rayuela", exact: true }).click();
  await expect(page.locator(".topbar .crumbs")).toHaveText(/Libros\s*\/\s*Rayuela/);
  await page.getByRole("button", { name: "Historial" }).click();
  const h = page.locator(".history-panel");
  await expect(h.locator(".history-cols")).toContainText("Creado porTú · portatil");
  await expect(h.locator(".history-cols")).toContainText("OrigenDe un modelo");
  // Who did what, each one in their colour with how much is theirs; the page itself in those colours (Juan,
  // 2026-10-30), and a click on one lights only theirs.
  await expect(h.locator(".who-chip")).toHaveText([
    /Tú · portatil.*2 líneas · 2 propiedades/,
    /Lector · deepseek-v4\.1-flash.*1 línea/,
    /MCP · claude-ejemplo.*1 línea/,
  ]);
  const lit = page.locator(".row-doc .blk.by-who");
  await expect(lit).toHaveCount(3);
  await h.locator(".who-chip", { hasText: "MCP" }).click();
  await expect(lit).toHaveCount(1);
  await expect(lit).toContainText("24 oct");
  await h.locator(".who-chip", { hasText: "MCP" }).click();
  await expect(lit).toHaveCount(3);
  await expect(h.locator(".audit-seen").last().locator("li").first()).toContainText("con la nota");
  await page.screenshot({ path: `${SHOTS}/history.png` });
  await page.keyboard.press("Escape");
  await expect(h).toHaveCount(0);
});

test("a note is a page: the full editor, and what Markdown cannot say saved as a marked block", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT, pages: [] });
  // Libros' notes are not in the sidebar: «Mis datos» opens Libros, and Libros its notes.
  const open = async () => {
    await page.locator(".db-table").getByRole("button", { name: "Rayuela", exact: true }).click();
  };
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data").getByRole("button", { name: "Libros", exact: true }).click();
  await open();
  const doc = page.locator(".doc-editor");
  // The page's own «/»: a Cifra over the collection the note belongs to, computed like any page's.
  await doc.locator(".doc-tail").click();
  await page.keyboard.type("/Cifra", { delay: 20 });
  await page.locator(".slash-menu").getByRole("menuitem", { name: "Cifra", exact: true }).click();
  await expect(doc.locator(".blk-number .kpi-value")).toBeVisible();
  // Leaving by its crumb (the new block's title keeps the focus, as when Juan types) saves the note's text;
  // the block travels as a fenced «boni» block and comes back the same.
  await page.locator(".topbar .crumbs").getByRole("button", { name: "Libros" }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Libros");
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
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data").getByRole("button", { name: "Libros", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Libros");
  const table = page.locator(".db-table");
  await expect(table.locator("th.sys-col")).toHaveCount(0);
  await page.getByRole("button", { name: "Ajustes de la vista" }).click();
  await page.getByRole("menuitem", { name: "Columnas de sistema" }).click();
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

test("«Mis datos» says what the collections take: records, storage and its parts, size and use, advice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
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

test("«Mis datos» as a diagram, one more of its views: a card per collection with its fields, arrows for relations, its «Filtro» dims the others, a click opens its panel and «Abrir» the collection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT });
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await setLayout(page, page.locator(".db"), "Diagrama");
  const canvas = page.locator(".data-diagram");
  const cards = canvas.locator(".dg-card-node");
  await expect(cards.locator(".dg-name")).toContainText(["Libros", "Documentos"]);
  const libros = cards.filter({ hasText: "Libros" });
  await expect(libros.locator(".dg-field")).toContainText(["Título", "Estado", "Relacionado"]);
  await expect(libros.locator(".dg-field.rel .dg-type")).toHaveText("→ Libros");
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(
    await canvas.locator(".dg-field.rel").count(),
  );
  // A relation with itself is an arc over the card, named.
  await expect(canvas.locator(".dg-loop-label")).toHaveText("Relacionado · varios");
  // Its own selects are gone: the view's «Filtro» does it, as on any collection (F6b). «Nivel es Privada»: the
  // private one stays, the others fade; nothing moves.
  await expect(page.locator(".data-filter")).toHaveCount(0);
  const db = page.locator(".db");
  await addFilter(page, db, "Nivel", "Privada");
  await expect(cards.filter({ hasText: "Documentos" })).not.toHaveClass(/dim/);
  await expect(libros).toHaveClass(/dim/);
  await page.screenshot({ path: `${SHOTS}/data-diagram.png` });
  // The same filter in the table: only the private one.
  await setLayout(page, db, "Tabla");
  await expect(page.locator(".my-data .db-table tbody td.is-title")).toContainText(["Documentos"]);
  await expect(page.locator(".my-data .db-table tbody td.is-title")).not.toContainText(["Libros"]);
  await removeFilter(page, db, "Nivel es Privada");
  await setLayout(page, db, "Diagrama");
  await expect(libros).not.toHaveClass(/dim/);
  // A click opens its panel: its level, who writes and reads it, «Abrir».
  await libros.locator(".dg-name").click();
  const panel = page.locator(".data-panel");
  await expect(panel.locator("h3")).toContainText("Libros");
  await panel.getByRole("button", { name: "Abrir", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Libros");
  // Back in «Mis datos», the view it was left in.
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await expect(page.locator(".db-head").getByRole("tab", { name: "Diagrama" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(canvas).toBeVisible();
});

test("a collection's «Diagrama» (F6): Agenda with her daughters and who writes and reads them; filters; a relation drawn by dragging", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", {
    agent: AGENT,
    agenda: "mother",
    usage: {
      days: 30,
      types: {
        t_tareas: {
          writes: [
            { id: "leer-correo", name: "Leer correo", kind: "flow", n: 42, on: true },
            { id: "user", name: "Tú", kind: "user", n: 7 },
          ],
          reads: [{ id: "resumen-diario", name: "Resumen diario", kind: "flow", n: 3, on: false }],
        },
        t_eventos: { writes: [{ id: "user", name: "Tú", kind: "user", n: 2 }], reads: [] },
      },
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data").getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Agenda");
  await setLayout(page, page.locator(".db"), "Diagrama");
  const canvas = page.locator(".data-diagram");
  await expect(canvas.locator(".dg-frame")).toContainText("Agenda");
  const cards = canvas.locator(".dg-card-node");
  await expect(cards).toHaveCount(3);
  const tareas = cards.filter({ has: page.locator(".dg-name", { hasText: /^Tareas$/ }) });
  const eventos = cards.filter({ has: page.locator(".dg-name", { hasText: /^Eventos$/ }) });
  await expect(tareas.locator(".dg-who")).toContainText("Leer correo · Tú");
  await expect(tareas.locator(".dg-who")).toContainText("Resumen diario");
  await expect(eventos.locator(".dg-who")).toContainText("Tú");
  // «Escrita por» «Leer correo»: Eventos fades, Tareas stays.
  const writer = page.locator(".data-filter", { hasText: "Escrita por" }).locator("select");
  await writer.selectOption("leer-correo");
  await expect(eventos).toHaveClass(/dim/);
  await expect(tareas).not.toHaveClass(/dim/);
  await writer.selectOption("");
  await page.screenshot({ path: `${SHOTS}/data-diagram-agenda.png` });
  // A relation drawn from Tareas to Eventos: a column of Tareas pointing to Eventos, said with «Deshacer».
  await tareas.hover();
  const from = await tareas.locator(".react-flow__handle.source").boundingBox();
  const to = await eventos.locator(".react-flow__handle.target").boundingBox();
  if (!from || !to) throw new Error("no handles");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 30, to.y + 10, { steps: 12 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".toast")).toContainText("Tareas apunta ahora a Eventos");
  const sent = await page.evaluate(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
      b.startsWith("POST api/data/types/t_tareas/fields"),
    ),
  );
  expect(sent).toEqual([
    'POST api/data/types/t_tareas/fields {"name":"Eventos","type":"relation","target":"t_eventos"}',
  ]);
  await expect(tareas.locator(".dg-field.rel .dg-type")).toHaveText("→ Eventos");
  // Its panel: who writes it, a flow on; who reads it, a flow off.
  await tareas.locator(".dg-name").click();
  const panel = page.locator(".data-panel");
  await expect(panel).toContainText("Leer correo");
  await expect(panel).toContainText("flujo encendido");
  await expect(panel).toContainText("Resumen diario");
  await expect(panel).toContainText("flujo apagado");
});

test("the diagram gives control (task 77): an arrow left anywhere on a collection relates it, left on the canvas makes a related one; the right button's actions; what changes shows in the table at once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { agent: AGENT, agenda: "mother" });
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data").getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Agenda");
  await setLayout(page, page.locator(".db"), "Diagrama");
  const canvas = page.locator(".data-diagram");
  const cards = canvas.locator(".dg-card-node");
  await expect(cards).toHaveCount(3);
  const card = (name: string) =>
    cards.filter({ has: page.locator(".dg-name", { hasText: new RegExp(`^${name}$`) }) });
  const center = async (l: import("@playwright/test").Locator) => {
    const b = await l.boundingBox();
    if (!b) throw new Error("not on screen");
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const posts = (start: string) =>
    page.evaluate(
      (s) =>
        ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
          b.startsWith(s),
        ),
      start,
    );
  // An arrow from Tareas' dot left anywhere on Eventos (not on its small dot): Tareas points to Eventos.
  await card("Tareas").hover();
  const from = await center(card("Tareas").locator(".react-flow__handle.source"));
  const onEventos = await center(card("Eventos").locator(".dg-name"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(onEventos.x, onEventos.y, { steps: 14 });
  await expect(card("Eventos").locator(".react-flow__handle.target")).toHaveCSS("opacity", "1");
  await page.mouse.up();
  await expect(page.locator(".toast")).toContainText("Tareas apunta ahora a Eventos");
  await expect
    .poll(() => posts("POST api/data/types/t_tareas/fields"))
    .toEqual([
      'POST api/data/types/t_tareas/fields {"name":"Eventos","type":"relation","target":"t_eventos"}',
    ]);
  // Left on the canvas: a new collection, which Eventos then points to.
  const pane = await canvas.locator(".react-flow__pane").boundingBox();
  if (!pane) throw new Error("no canvas");
  await card("Eventos").hover();
  const start = await center(card("Eventos").locator(".react-flow__handle.source"));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // An empty corner of the canvas, on screen and outside Agenda's frame.
  await page.mouse.move(pane.x + 16, pane.y + 16, { steps: 14 });
  await page.mouse.up();
  const name = page.getByRole("textbox", { name: "Nombre de la colección" });
  await expect(name).toBeFocused();
  await name.fill("Salas");
  await name.press("Enter");
  await expect(card("Salas")).toHaveCount(1);
  await expect(page.locator(".toast")).toContainText("Eventos apunta ahora a Salas");
  // The right button on a collection: what can be done with it.
  await card("Eventos").locator(".dg-name").click({ button: "right" });
  const menu = page.getByRole("dialog", { name: "Acciones de la colección" });
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Abrir",
    "Abrir Agenda",
    "Cambiar nombre",
    "Nueva colección dentro",
    "Sacar de Agenda",
    "Borrar",
  ]);
  await page.screenshot({ path: `${SHOTS}/data-diagram-menu.png` });
  // «Sacar de Agenda»: out of its mother, with Undo.
  await menu.getByRole("menuitemradio", { name: "Sacar de Agenda" }).click();
  await expect(page.locator(".toast")).toContainText("Eventos ya no está dentro de Agenda");
  await expect.poll(() => posts("PUT api/data/types/t_eventos/parent")).not.toEqual([]);
  // «Cambiar nombre», in place over the canvas.
  await card("Salas").locator(".dg-name").click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
  const rename = page.getByRole("textbox", { name: "Nuevo nombre" });
  await expect(rename).toHaveValue("Salas");
  await rename.fill("Aulas");
  await rename.press("Enter");
  await expect(card("Aulas")).toHaveCount(1);
  // In «Mis datos», a collection made in its diagram is in its table at once, the page not opened again (Juan: «tuve
  // que abrir otra página y volver para ver el cambio reflejado»).
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await expect(page.locator(".my-data")).toBeVisible();
  const db = page.locator(".my-data .db");
  await setLayout(page, db, "Diagrama");
  // A collection with notes is not deleted from here: «Borrar» waits until it is empty.
  await card("Libros").locator(".dg-name").click({ button: "right" });
  await expect(page.getByRole("menuitemradio", { name: "Borrar" })).toBeDisabled();
  await page.getByRole("menuitemradio", { name: "Nueva colección dentro" }).click();
  const made = page.getByRole("textbox", { name: "Nombre de la colección" });
  await made.fill("Préstamos");
  await made.press("Enter");
  await expect(card("Préstamos")).toHaveCount(1);
  await setLayout(page, db, "Tabla");
  await expect(page.locator(".my-data .db-table tbody tr", { hasText: "Préstamos" })).toHaveCount(
    1,
  );
});
