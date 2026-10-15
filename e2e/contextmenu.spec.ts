import { expect, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

test("right click on an event: menu, duplicate, move to calendar, delete with undo", async ({
  page,
}) => {
  await open(page);
  const ev = page.locator(".ev", { hasText: "Dentista" }).first();
  await ev.click({ button: "right" });
  const menu = page.locator(".ctx");
  await expect(menu).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/ctx-event.png" });
  await expect(menu.getByRole("menuitem", { name: "Abrir detalle" })).toBeVisible();

  // duplicate
  const before = await page.locator(".ev", { hasText: "Dentista" }).count();
  await menu.getByRole("menuitem", { name: "Duplicar" }).click();
  await expect(page.locator(".ev", { hasText: "Dentista" })).toHaveCount(before + 1);
  await page.keyboard.press("Escape");

  // move to another calendar (colour changes with the calendar)
  const target = page.locator(".ev", { hasText: "Dentista" }).first();
  const colourBefore = await target.evaluate((el) => getComputedStyle(el).borderLeftColor);
  await target.click({ button: "right" });
  await page
    .locator(".ctx")
    .getByRole("menuitem", { name: /Mover a calendario/ })
    .hover();
  await page.screenshot({ path: "e2e/screenshots/ctx-move.png" });
  await page
    .locator(".ctx-sub")
    .getByRole("menuitem", { name: /Deporte/ })
    .click();
  const colourAfter = await page
    .locator(".ev", { hasText: "Dentista" })
    .first()
    .evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(colourAfter).not.toBe(colourBefore);

  // delete, then undo from the toast
  await page.locator(".ev", { hasText: "Dentista" }).first().click({ button: "right" });
  await page.locator(".ctx").getByRole("menuitem", { name: "Eliminar" }).click();
  await expect(page.locator(".ev", { hasText: "Dentista" })).toHaveCount(before);
  await page.locator(".toast button").click();
  await expect(page.locator(".ev", { hasText: "Dentista" })).toHaveCount(before + 1);
});

test("right click on empty grid creates an event at that time; Esc closes the menu", async ({
  page,
}) => {
  await open(page);
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (!cols) throw new Error("no grid");
  const x = cols.x + (cols.width / 7) * 5.5;
  await page.mouse.click(x, cols.y + 300, { button: "right" });
  await expect(page.locator(".ctx")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ctx")).toHaveCount(0);
  const count = await page.locator(".ev").count();
  await page.mouse.click(x, cols.y + 300, { button: "right" });
  await page.locator(".ctx").getByRole("menuitem", { name: "Nuevo evento aquí" }).click();
  await expect(page.locator(".popover .title-input")).toBeFocused();
  expect(await page.locator(".ev").count()).toBe(count + 1);
});

test("right click on a calendar: only this, properties and colour", async ({ page }) => {
  await open(page);
  const row = page.locator(".cal-row", { hasText: "Docencia" });
  await row.click({ button: "right" });
  await page.screenshot({ path: "e2e/screenshots/ctx-calendar.png" });
  await page
    .locator(".ctx")
    .getByRole("menuitem", { name: "Mostrar solo este calendario" })
    .click();
  await expect(page.locator(".cal-row.off")).toHaveCount(10);
  await row.click({ button: "right" });
  await page
    .locator(".ctx")
    .getByRole("menuitem", { name: "Mostrar todos los calendarios" })
    .click();
  await expect(page.locator(".cal-row.off")).toHaveCount(0);
});

test("right click in month view on a chip and on a day", async ({ page }) => {
  await open(page);
  await page.keyboard.press("m");
  await page.waitForSelector(".mchip");
  await page.waitForTimeout(600);
  await page.locator(".mchip", { hasText: "Dentista" }).click({ button: "right" });
  await expect(page.locator(".ctx").getByRole("menuitem", { name: "Duplicar" })).toBeVisible();
  await page.keyboard.press("Escape");
  const cell = page.locator('.mcell[data-day="20349"]'); // 2025-09-18
  await cell.locator(".mnum").click({ button: "right" });
  await expect(
    page.locator(".ctx").getByRole("menuitem", { name: "Nuevo evento de todo el día" }),
  ).toBeVisible();
});
