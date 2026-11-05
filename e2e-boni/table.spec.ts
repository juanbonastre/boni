import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { type FakePage, grown, openApp, recorded, setLayout } from "./fixtures.ts";

/**
 * A collection's table (Juan, 2026-10-30): each column as wide as its kind of value, widened by its edge and kept;
 * a title opens its row with a click and is renamed with a double click; rows chosen by their box, by the margin
 * left of it, with Ctrl and Shift, deleted together with one Undo; the right button's menu. And what is open shows
 * lit in the sidebar's «Páginas», unfolded down to it.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function libros(page: Page, pages?: FakePage[]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", pages ? { pages } : {});
  await page
    .locator(".sidebar")
    .getByRole("list", { name: "Páginas" })
    .getByRole("button", { name: "Libros", exact: true })
    .click();
  await expect(page.locator(".db-table tbody tr")).toHaveCount(3);
}
const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} is not on screen`);
  return b;
};
const sent = async (page: Page, start: string, part: string) =>
  (await recorded(page)).requests.some((r) => r.startsWith(start) && r.includes(part));

test("columns as wide as their values, widened by their edge and kept; a title opens its row, a double click renames it", async ({
  page,
}) => {
  await libros(page);
  const table = page.locator(".db-table");
  // Not stretched to the page: the title 280 px, a number 110, a relation 190, the table as wide as its columns and
  // centred, the head's options ending where it ends.
  const wide = await box(page, ".db-table");
  expect(Math.round(wide.width)).toBe(1022);
  const doc = await box(page, ".doc");
  const content = await box(page, ".content");
  expect(
    Math.abs(doc.x - content.x - (content.x + content.width - doc.x - doc.width)),
  ).toBeLessThan(2);
  const add = await box(page, ".db-head .btn.primary");
  expect(Math.abs(add.x + add.width - (wide.x + wide.width))).toBeLessThan(2);
  const title = table.locator("th.is-title");
  expect(Math.round((await title.boundingBox())?.width ?? 0)).toBe(280);
  expect(
    Math.round((await table.locator("th", { hasText: "Páginas" }).boundingBox())?.width ?? 0),
  ).toBe(110);
  // The first column under the collection's title; the boxes in the page's margin.
  expect(
    Math.abs((await title.boundingBox())!.x - (await box(page, ".cols-title")).x),
  ).toBeLessThan(2);
  // Its edge dragged 120 px: wider, kept for the account; a double click on it brings the usual width back.
  const edge = await box(page, ".db-table th.is-title .col-resize");
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 120, edge.y + edge.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await title.boundingBox())?.width ?? 0)).toBe(400);
  await expect
    .poll(() => sent(page, "PUT api/data/types/t_libro/row-ui", '"widths":{"f_titulo":400}'))
    .toBe(true);
  await page.screenshot({ path: `${SHOTS}/table-widths.png` });
  await page.locator(".db-table th.is-title .col-resize").dblclick();
  await expect.poll(async () => Math.round((await title.boundingBox())?.width ?? 0)).toBe(280);
  // A double click renames: the whole name chosen, typing replaces it; the row is not opened.
  await table.getByRole("button", { name: "Pedro Páramo", exact: true }).dblclick();
  const input = table.getByRole("textbox", { name: "Título" });
  await expect(input).toBeFocused();
  await page.keyboard.type("El llano en llamas", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect.poll(() => sent(page, "PUT api/data/rows/r3 ", "El llano en llamas")).toBe(true);
  await page.waitForTimeout(400);
  await expect(page.locator(".cols-title")).toHaveText("📚Libros");
  // A click opens it.
  await table.getByRole("button", { name: "Rayuela", exact: true }).click();
  await expect(page.locator(".row-doc .doc-title")).toHaveValue("Rayuela");
});

test("a collection's page in every layout: centred, as wide as what it shows, the head's options ending with it", async ({
  page,
}) => {
  await libros(page);
  const centred = async () => {
    const doc = await box(page, ".doc");
    const content = await box(page, ".content");
    expect(
      Math.abs(doc.x - content.x - (content.x + content.width - doc.x - doc.width)),
    ).toBeLessThan(2);
    return doc;
  };
  const endsWith = async (selector: string) => {
    const add = await box(page, ".db-head .btn.primary");
    const b = await box(page, selector);
    expect(Math.abs(add.x + add.width - (b.x + b.width))).toBeLessThan(2);
    return b;
  };
  // Three books: a gallery three cards wide, a board of its columns, a list as wide as the minimum.
  await setLayout(page, page.locator(".db"), "Galería");
  await centred();
  expect(Math.round((await endsWith(".db-gallery")).width)).toBe(3 * 232 - 12);
  await setLayout(page, page.locator(".db"), "Tablero");
  await centred();
  await endsWith(".db-board");
  await page.screenshot({ path: `${SHOTS}/collection-board.png` });
  await setLayout(page, page.locator(".db"), "Lista");
  expect(Math.round((await centred()).width)).toBe(560);
  await endsWith(".db-list");
  // The calendar fills the width.
  await setLayout(page, page.locator(".db"), "Calendario");
  const doc = await centred();
  expect(doc.width).toBeGreaterThan((await box(page, ".content")).width - 2 * 48 - 2);
});

test("rows chosen by their box, the margin, Ctrl and Shift; deleted together with one Undo; the right button's menu", async ({
  page,
}) => {
  await libros(page);
  const table = page.locator(".db-table");
  const rows = table.locator("tbody tr");
  const check = (i: number) => rows.nth(i).getByRole("checkbox", { name: /^Seleccionar: / });
  const chosen = table.locator("tbody tr.selected");
  // The boxes show under the pointer (or once one is chosen).
  await expect(check(0)).toHaveCSS("opacity", "0");
  await rows.nth(0).hover();
  await expect(check(0)).toHaveCSS("opacity", "1");
  await check(0).click();
  await expect(chosen).toHaveCount(1);
  const bar = page.getByRole("toolbar", { name: "Filas seleccionadas" });
  await expect(bar).toContainText("1 seleccionada");
  // Shift: the run to the third; Ctrl in the margin left of the second takes it out.
  await check(2).click({ modifiers: ["Shift"] });
  await expect(chosen).toHaveCount(3);
  const left = (await box(page, ".db-table")).x;
  const second = await rows.nth(1).boundingBox();
  if (!second) throw new Error("no second row");
  await page.keyboard.down("Control");
  await page.mouse.click(left - 12, second.y + second.height / 2);
  await page.keyboard.up("Control");
  await expect(chosen).toHaveCount(2);
  await expect(bar).toContainText("2 seleccionadas");
  // The head keeps its options; a click on one lets go of the rows.
  await expect(page.locator(".db-head").getByRole("button", { name: "Nuevo" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/table-selection.png` });
  await page.locator(".db-head").getByRole("button", { name: "Ajustes de la vista" }).click();
  await expect(chosen).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Anywhere in the margin up to the sidebar lights the row beside the pointer and chooses it alone.
  const margin = (await box(page, ".content")).x + 6;
  await page.mouse.move(margin, second.y + second.height / 2);
  await expect(table.locator("tbody tr.lit")).toHaveText(/Ficciones/);
  await page.mouse.click(margin, second.y + second.height / 2);
  await expect(chosen).toHaveText(/Ficciones/);
  // Esc lets go; so does a click outside the table.
  await page.keyboard.press("Escape");
  await expect(chosen).toHaveCount(0);
  await page.mouse.click(left - 12, second.y + second.height / 2);
  await expect(chosen).toHaveCount(1);
  await page.locator(".cols-title").click();
  await expect(chosen).toHaveCount(0);
  await page.mouse.click(left - 12, second.y + second.height / 2);
  await expect(chosen).toHaveText(/Ficciones/);
  // Ctrl+click on a title adds its row instead of opening it; Supr sends both to the trash, one Undo brings them back.
  await table
    .getByRole("button", { name: "Rayuela", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(chosen).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(rows).toHaveCount(1);
  await expect(page.locator(".toast")).toContainText("2 elementos borrados");
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(rows).toHaveCount(3);
  // The right button on a row not chosen chooses it alone and opens its menu; «Cambiar nombre» writes in place.
  const pedro = rows.filter({ hasText: "Pedro Páramo" });
  await pedro.click({ button: "right", position: { x: 120, y: 10 } });
  const menu = page.getByRole("dialog", { name: "Opciones de la fila" });
  await grown(menu);
  // It opens where the pointer is (Juan, 2026-11-03: the menus opened elsewhere; task 39).
  const at = (await pedro.boundingBox()) as { x: number; y: number };
  const opened = (await menu.boundingBox()) as { x: number; y: number };
  expect(Math.abs(opened.x - (at.x + 120))).toBeLessThan(6);
  expect(Math.abs(opened.y - (at.y + 10))).toBeLessThan(6);
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Abrir",
    "Cambiar nombre",
    "Copiar enlace",
    "Borrar",
  ]);
  await expect(chosen).toHaveText(/Pedro Páramo/);
  await page.screenshot({ path: `${SHOTS}/table-menu.png` });
  await menu.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
  await expect(table.getByRole("textbox", { name: "Título" })).toBeFocused();
  await page.keyboard.type("Los de abajo", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect.poll(() => sent(page, "PUT api/data/rows/r3 ", "Los de abajo")).toBe(true);
  // With several chosen, the menu deletes them all.
  await check(0).click();
  await rows.nth(0).click({ button: "right", position: { x: 120, y: 10 } });
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Borrar 2"]);
});

test("the right button on a card (task 42): the board's, the gallery's and the list's open the row's menu where the pointer is", async ({
  page,
}) => {
  await libros(page);
  const menu = page.getByRole("dialog", { name: "Opciones de la fila" });
  const head = page.locator(".db-head");
  const opens = async (card: ReturnType<Page["locator"]>) => {
    await card.click({ button: "right", position: { x: 40, y: 10 } });
    await grown(menu);
    const at = (await card.boundingBox()) as { x: number; y: number };
    const opened = (await menu.boundingBox()) as { x: number; y: number };
    expect(Math.abs(opened.x - (at.x + 40))).toBeLessThan(6);
    expect(Math.abs(opened.y - (at.y + 10))).toBeLessThan(6);
    await expect(menu.getByRole("menuitemradio")).toHaveText([
      "Abrir",
      "Cambiar nombre",
      "Copiar enlace",
      "Borrar",
    ]);
    await expect(card).toHaveClass(/menu-open/);
  };
  // The board: «Cambiar nombre» writes the card's title in place.
  await setLayout(page, page.locator(".db"), "Tablero");
  await opens(page.locator(".db-board .db-card", { hasText: "Pedro Páramo" }));
  await page.screenshot({ path: `${SHOTS}/board-menu.png` });
  await menu.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
  await expect(page.locator(".db-board").getByRole("textbox", { name: "Título" })).toBeFocused();
  await page.keyboard.type("Los de abajo", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".db-board .db-card", { hasText: "Los de abajo" })).toHaveCount(1);
  await expect.poll(() => sent(page, "PUT api/data/rows/r3 ", "Los de abajo")).toBe(true);
  // The gallery: «Borrar» sends the card to the trash, its toast's Undo brings it back.
  await setLayout(page, page.locator(".db"), "Galería");
  const cards = page.locator(".db-gallery .db-card");
  await opens(cards.filter({ hasText: /^Ficciones/ }));
  await menu.getByRole("menuitemradio", { name: "Borrar" }).click();
  await expect(cards).toHaveCount(2);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(cards).toHaveCount(3);
  // The list: «Abrir» opens the row as a page; Escape closes the menu without doing anything.
  await setLayout(page, page.locator(".db"), "Lista");
  const rayuela = page.locator(".db-list .db-list-row", { hasText: "Rayuela" });
  await opens(rayuela);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await opens(rayuela);
  await menu.getByRole("menuitemradio", { name: "Abrir" }).click();
  await expect(page.locator(".topbar .crumbs")).toHaveText(/Libros\s*\/\s*Rayuela/);
});

test("a view's settings as Notion's (tasks 41 and 69): its name, a short list saying what each is now, each with its panel", async ({
  page,
}) => {
  await libros(page);
  const head = page.locator(".db-head");
  const options = head.getByRole("button", { name: "Ajustes de la vista" });
  const box = page.getByRole("dialog", { name: "Ajustes de la vista" });
  const list = box.getByRole("menuitem");
  await options.click();
  await expect(box.getByRole("textbox", { name: "Nombre de la vista" })).toHaveValue("Tabla");
  await expect(list).toHaveText([
    /^Diseño\s*Tabla/,
    /^Propiedades\s*5 visibles/,
    /^Filtrar$/,
    /^Ordenar$/,
    /^Columnas de sistema$/,
  ]);
  await page.screenshot({ path: `${SHOTS}/view-options.png` });
  // «Ordenar»: by a column, up and then down; back on the list, it says so.
  await list.filter({ hasText: "Ordenar" }).click();
  const titles = page.locator(".db-table tbody td.is-title");
  await box.getByRole("menuitemradio", { name: "Título" }).click();
  await expect(titles).toHaveText([/^Ficciones/, /^Pedro Páramo/, /^Rayuela/]);
  await box.getByRole("menuitemradio", { name: /^Título/ }).click();
  await expect(titles).toHaveText([/^Rayuela/, /^Pedro Páramo/, /^Ficciones/]);
  await page.screenshot({ path: `${SHOTS}/view-options-sort.png` });
  await box.getByRole("button", { name: "Volver: Ordenar" }).click();
  await expect(list.filter({ hasText: "Ordenar" })).toHaveText(/Título ↓/);
  // «Propiedades»: one hidden from the view.
  await list.filter({ hasText: "Propiedades" }).click();
  await box.getByRole("menuitemradio", { name: "Páginas" }).click();
  await expect(page.locator(".db-table thead")).not.toContainText("Páginas");
  await box.getByRole("button", { name: "Volver: Propiedades" }).click();
  await expect(list.filter({ hasText: "Propiedades" })).toHaveText(/4 visibles/);
  // «Filtrar»: the view's rules, as the head's «Filtro».
  await list.filter({ hasText: "Filtrar" }).click();
  await expect(box.getByRole("button", { name: "Añadir filtro" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/view-options-filter.png` });
  // Closed and opened again, it is the list again; the collection's notes in the sidebar, from here too.
  await page.keyboard.press("Escape");
  await options.click();
  await expect(list.first()).toHaveText(/^Diseño/);
  await box.getByRole("menuitemradio", { name: "Mostrar sus notas en la barra" }).click();
  await expect.poll(() => sent(page, "PUT api/data/types/t_libro/tree ", "true")).toBe(true);
  await expect(
    box.getByRole("menuitemradio", { name: "Ocultar sus notas de la barra" }),
  ).toBeVisible();
  // «Diseño»: the board groups by a list (the view, named after its layout, takes the new one's name); the calendar
  // shows by a date, and other collections with dates.
  await list.filter({ hasText: "Diseño" }).click();
  await box.getByRole("radio", { name: "Tablero" }).click();
  await box.getByRole("button", { name: "Volver: Diseño" }).click();
  await expect(list).toHaveText([
    /^Diseño\s*Tablero/,
    /^Propiedades/,
    /^Filtrar/,
    /^Ordenar/,
    /^Agrupar\s*Estado/,
  ]);
  await expect(head.getByRole("tab")).toHaveText(["Tablero"]);
  await list.filter({ hasText: "Diseño" }).click();
  await box.getByRole("radio", { name: "Calendario" }).click();
  await box.getByRole("button", { name: "Volver: Diseño" }).click();
  await expect(list.filter({ hasText: "Fecha" })).toHaveText(/^Fecha\s*Terminado/);
  await expect(list.filter({ hasText: "Columnas de sistema" })).toHaveCount(0);
});

test("a collection's views as Notion's tabs (task 69): «+» by layout, renamed, duplicated, deleted; the bar of order and filters from their icons; kept in the account", async ({
  page,
}) => {
  await libros(page);
  const head = page.locator(".db-head");
  const tabs = head.getByRole("tab");
  const titles = page.locator(".db-table tbody td.is-title");
  await expect(tabs).toHaveText(["Tabla"]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  // No bar until its icons ask for it.
  const bar = page.locator(".db-bar");
  await expect(bar).toHaveCount(0);
  // «Ordenar»: the bar, its order's chip open at once; by title, then the other way.
  await head.getByRole("button", { name: "Ordenar" }).click();
  const sortBox = page.getByRole("dialog", { name: "Ordenar" });
  await sortBox.getByRole("menuitemradio", { name: "Título" }).click();
  await expect(titles).toHaveText([/^Ficciones/, /^Pedro Páramo/, /^Rayuela/]);
  await sortBox.getByRole("menuitemradio", { name: "Descendente" }).click();
  await expect(titles).toHaveText([/^Rayuela/, /^Pedro Páramo/, /^Ficciones/]);
  await page.keyboard.press("Escape");
  await expect(bar.locator(".db-bar-sorts")).toHaveText("Título");
  // «Filtro»: the same bar, «+ Filtro» open; a property, and its chip opens for the value. Until it has one, it hides
  // nothing.
  await head.getByRole("button", { name: "Filtro" }).click();
  await page
    .getByRole("dialog", { name: "Añadir filtro" })
    .getByRole("menuitemradio", { name: "Estado" })
    .click();
  await expect(titles).toHaveCount(3);
  await page.getByRole("combobox", { name: "Valor" }).selectOption({ label: "Leído" });
  await expect(titles).toHaveText([/^Ficciones/]);
  await page.screenshot({ path: `${SHOTS}/view-bar.png` });
  await page.keyboard.press("Escape");
  await expect(bar.locator(".db-bar-filters .db-chip.on")).toHaveText("Estado es Leído");
  await expect(bar.locator(".db-bar-sep")).toHaveCount(1);
  // Its chip changes it or takes it away; the order's too, and the bar goes with them.
  await bar.getByRole("button", { name: "Estado es Leído" }).click();
  await page.getByRole("button", { name: "Quitar filtro" }).click();
  await expect(titles).toHaveCount(3);
  await bar.getByRole("button", { name: "Ordenar" }).click();
  await sortBox.getByRole("menuitemradio", { name: "Quitar orden" }).click();
  await expect(bar).toHaveCount(0);
  // The search: rows whose title has the words, nothing kept.
  await head.getByRole("button", { name: "Buscar" }).click();
  await head.getByRole("textbox", { name: "Buscar" }).fill("ray");
  await expect(titles).toHaveText([/^Rayuela/]);
  await page.keyboard.press("Escape");
  await expect(titles).toHaveCount(3);
  // «+»: a new view by its layout, named after it and open; kept in the account.
  await head.getByRole("button", { name: "Añadir vista" }).click();
  await page
    .getByRole("dialog", { name: "Añadir vista" })
    .getByRole("button", { name: "Tablero" })
    .click();
  await expect(tabs).toHaveText(["Tabla", "Tablero"]);
  await expect(head.getByRole("tab", { name: "Tablero" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".db-board")).toBeVisible();
  await expect.poll(() => sent(page, "PUT api/data/types/t_libro/row-ui ", "Tablero")).toBe(true);
  await page.screenshot({ path: `${SHOTS}/view-tabs.png` });
  // A double click renames it in place; the right button duplicates it or deletes it (never the last one).
  await head.getByRole("tab", { name: "Tablero" }).dblclick();
  const rename = head.getByRole("textbox", { name: "Nombre de la vista" });
  await expect(rename).toBeFocused();
  await rename.fill("Por estado");
  await rename.press("Enter");
  await expect(tabs).toHaveText(["Tabla", "Por estado"]);
  // Escape keeps the name it had; the menu's «Cambiar nombre» renames it in place too.
  await head.getByRole("tab", { name: "Por estado" }).dblclick();
  await expect(rename).toBeFocused();
  await page.keyboard.type("Otro nombre");
  await page.keyboard.press("Escape");
  await expect(tabs).toHaveText(["Tabla", "Por estado"]);
  await head.getByRole("tab", { name: "Tabla" }).click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
  await expect(rename).toBeFocused();
  await page.keyboard.type("Todos");
  await page.keyboard.press("Enter");
  await expect(tabs).toHaveText(["Todos", "Por estado"]);
  // The view's settings: its name too.
  await head.getByRole("tab", { name: "Por estado" }).click();
  await head.getByRole("button", { name: "Ajustes de la vista" }).click();
  const named = page
    .getByRole("dialog", { name: "Ajustes de la vista" })
    .getByRole("textbox", { name: "Nombre de la vista" });
  await named.fill("Por lectura");
  await named.press("Enter");
  await page.keyboard.press("Escape");
  await expect(tabs).toHaveText(["Todos", "Por lectura"]);
  await head.getByRole("tab", { name: "Por lectura" }).click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Duplicar vista" }).click();
  await expect(tabs).toHaveText(["Todos", "Por lectura", "Por lectura (copia)"]);
  await head.getByRole("tab", { name: "Por lectura (copia)" }).click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Eliminar vista" }).click();
  await expect(tabs).toHaveText(["Todos", "Por lectura"]);
  await expect(head.getByRole("tab", { name: "Por lectura" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Back on «Todos», all its rows; the account has the views as they are now (one request for a burst).
  await head.getByRole("tab", { name: "Todos" }).click();
  await expect(titles).toHaveCount(3);
  await expect
    .poll(async () => {
      const puts = (await recorded(page)).requests.filter((r) =>
        r.startsWith("PUT api/data/types/t_libro/row-ui "),
      );
      const last = puts.at(-1) ?? "";
      const body = JSON.parse(last.slice(last.indexOf("{")) || "{}") as {
        views?: { name: string; layout: string }[];
      };
      return (body.views ?? []).map((v) => `${v.name}:${v.layout}`);
    })
    .toEqual(["Todos:table", "Por lectura:board"]);
});

test("what is open shows lit in «Páginas», unfolded down to it: a record, its collection, a page inside another", async ({
  page,
}) => {
  const blank = { version: 1 as const, blocks: [] };
  await libros(page, [
    { id: "viajes", title: "Viajes", spec: blank },
    { id: "sierra", title: "Preparar el viaje a la sierra", parent: "viajes", spec: blank },
  ]);
  const side = page.locator(".sidebar");
  const tree = side.getByRole("list", { name: "Páginas" });
  const recent = side.getByRole("list", { name: "Recientes" });
  const book = page.locator(".row-doc .doc-title");
  // Libros does not show its notes in the tree: an open book lights Libros.
  await page.locator(".db-table").getByRole("button", { name: "Rayuela", exact: true }).click();
  await expect(book).toHaveValue("Rayuela");
  await expect(tree.locator(".tree-row.active")).toHaveText(/Libros/);
  // With its eye, Libros unfolds to the book when the book is opened again.
  await tree.locator(".tree-row", { hasText: "Libros" }).hover();
  await tree.getByRole("button", { name: "Mostrar sus notas en la barra: Libros" }).click();
  await expect(tree.getByRole("button", { name: "Mostrar subpáginas: Libros" })).toBeVisible();
  await recent.getByRole("button", { name: "Libros" }).click();
  await expect(page.locator(".cols-title")).toHaveText("📚Libros");
  await page.locator(".db-table").getByRole("button", { name: "Rayuela", exact: true }).click();
  await expect(book).toHaveValue("Rayuela");
  await expect(tree.locator(".tree-row.active")).toHaveText("Rayuela");
  // A page inside a folded one: opened from «Recientes», the one above unfolds.
  const sierra = "Preparar el viaje a la sierra";
  await tree.getByRole("button", { name: sierra, exact: true }).click();
  await expect(page.locator(".doc-title")).toHaveValue(sierra);
  await tree.getByRole("button", { name: "Ocultar subpáginas: Viajes" }).click();
  await expect(tree.getByRole("button", { name: sierra, exact: true })).toHaveCount(0);
  await recent.getByRole("button", { name: "Libros" }).click();
  await expect(page.locator(".cols-title")).toHaveText("📚Libros");
  await recent.getByRole("button", { name: sierra }).click();
  await expect(tree.locator(".page-row.active")).toHaveText(sierra);
  // «Páginas» folded by hand: it opens again to show what was opened.
  await side.getByRole("button", { name: "Páginas", exact: true }).click();
  await expect(tree).toHaveCount(0);
  await recent.getByRole("button", { name: "Rayuela" }).click();
  await expect(book).toHaveValue("Rayuela");
  await expect(tree.locator(".tree-row.active")).toHaveText("Rayuela");
  await page.screenshot({ path: `${SHOTS}/tree-reveal.png` });
});

test("a column's menu, as Notion's: renamed in place, its kind, a list's values, hidden, deleted with Undo; «+» adds one (task 40)", async ({
  page,
}) => {
  await libros(page);
  const table = page.locator(".db-table");
  const header = table.locator("thead");
  // A click on a column's name opens its menu under it; the name is written in place.
  await header.getByRole("button", { name: "Páginas", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Columna «Páginas»" });
  await expect(menu.getByRole("textbox", { name: "Nombre" })).toBeFocused();
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    "Tipo: Número",
    "Ocultar",
    "Borrar columna",
  ]);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Hojas", { delay: 15 });
  await page.keyboard.press("Enter");
  await expect(header.getByRole("button", { name: "Hojas", exact: true })).toBeVisible();
  expect(await sent(page, "PUT api/data/types/t_libro/fields/f_paginas", '"name":"Hojas"')).toBe(
    true,
  );
  // A list's values: one added, its name and id kept for the rest.
  await header.getByRole("button", { name: "Estado", exact: true }).click({ button: "right" });
  const estado = page.getByRole("dialog", { name: "Columna «Estado»" });
  await estado.getByRole("menuitemradio", { name: "Valores" }).click();
  await estado.getByRole("textbox", { name: "Añadir un valor" }).fill("Abandonado");
  await page.keyboard.press("Enter");
  await expect(estado.getByRole("textbox", { name: "Valor «Abandonado»" })).toBeVisible();
  expect(
    await sent(
      page,
      "PUT api/data/types/t_libro/fields/f_estado",
      '{"id":"o_leido","name":"Leído"}',
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  // Its kind cannot change while it holds values: said, and nothing changes.
  await header.getByRole("button", { name: "Hojas", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Tipo: Número" }).click();
  await page.getByRole("menuitemradio", { name: "Texto", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("No se puede: está en uso");
  // «+»: a new column, named, of a kind.
  await header.getByRole("button", { name: "Nueva columna" }).click();
  const add = page.getByRole("dialog", { name: "Nueva columna" });
  await add.getByRole("textbox", { name: "Nombre" }).fill("Editorial");
  await add.getByRole("menuitemradio", { name: "Texto", exact: true }).click();
  await expect(header.getByRole("button", { name: "Editorial", exact: true })).toBeVisible();
  // Out with Undo, its values kept.
  await header.getByRole("button", { name: "Editorial", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Borrar columna" }).click();
  await expect(header.getByRole("button", { name: "Editorial", exact: true })).toHaveCount(0);
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(header.getByRole("button", { name: "Editorial", exact: true })).toBeVisible();
  // «Ocultar»: this view stops showing it.
  await header.getByRole("button", { name: "Editorial", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Ocultar" }).click();
  await expect(header.getByRole("button", { name: "Editorial", exact: true })).toHaveCount(0);
  // The title column only changes its name.
  await header.getByRole("button", { name: "Título", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Columna «Título»" }).getByRole("menuitemradio"),
  ).toHaveCount(0);
});
