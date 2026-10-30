import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { type FakePage, openApp, recorded } from "./fixtures.ts";

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
  // Not stretched to the page: the title 280 px, a number 110, the table only as wide as its columns.
  expect((await box(page, ".db-table")).width).toBeLessThan(
    (await box(page, ".db-table-wrap")).width - 200,
  );
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
  await page.screenshot({ path: `${SHOTS}/table-selection.png` });
  // Esc lets go; a click in the margin chooses that row alone.
  await page.keyboard.press("Escape");
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
  await rows
    .filter({ hasText: "Pedro Páramo" })
    .click({ button: "right", position: { x: 120, y: 10 } });
  const menu = page.getByRole("dialog", { name: "Opciones de la fila" });
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
