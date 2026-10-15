import { expect, type Locator, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return b;
};
const timeOf = async (page: Page, title: string) =>
  (await page.locator(".ev", { hasText: title }).first().locator(".ev-time").textContent()) ?? "";
const nextWeek = async (page: Page) => {
  await page.locator(".topbar").getByRole("button", { name: "Siguiente" }).click();
  await page.waitForTimeout(900);
};
const prevWeek = async (page: Page) => {
  await page.locator(".topbar").getByRole("button", { name: "Anterior" }).click();
  await page.waitForTimeout(900);
};
const evs = (page: Page, title: string) => page.locator(".ev", { hasText: title });
/** Events rendered in the day columns that are really on screen (the render window keeps a spare day on each side). */
const onScreen = (page: Page, title: string) =>
  page.evaluate((t) => {
    const vp = document.querySelector(".cols-viewport")?.getBoundingClientRect();
    if (!vp) return 0;
    return [...document.querySelectorAll<HTMLElement>(".ev")].filter((el) => {
      if (!el.textContent?.includes(t)) return false;
      const r = el.getBoundingClientRect();
      return r.left >= vp.left - 2 && r.right <= vp.right + 2;
    }).length;
  }, title);
const expectOnScreen = (page: Page, title: string, n: number) =>
  expect.poll(() => onScreen(page, title)).toBe(n);

test("recurring events show a repeat icon, single ones do not", async ({ page }) => {
  await open(page);
  await expect(evs(page, "Clase IPM").first().locator(".rep")).toBeVisible();
  await expect(evs(page, "Dentista").first().locator(".rep")).toHaveCount(0);
});

test("moving one occurrence 'only this' leaves the rest of the series alone", async ({ page }) => {
  await open(page);
  const before = await timeOf(page, "Clase IPM");
  const b = await box(evs(page, "Clase IPM").first());
  await page.mouse.move(b.x + b.width / 2, b.y + 14);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 14 + 70, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Editar evento recurrente" })).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/scope-prompt.png" });
  await page.getByRole("button", { name: "Solo este evento" }).click();
  expect(await timeOf(page, "Clase IPM")).not.toBe(before);
  await nextWeek(page);
  expect(await timeOf(page, "Clase IPM")).toBe(before);
  await prevWeek(page);
  await page.keyboard.press("Control+z");
  expect(await timeOf(page, "Clase IPM")).toBe(before);
});

test("moving with 'all events' changes every week", async ({ page }) => {
  await open(page);
  const before = await timeOf(page, "Clase IPM");
  const b = await box(evs(page, "Clase IPM").first());
  await page.mouse.move(b.x + b.width / 2, b.y + 14);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 14 + 70, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Todos los eventos" }).click();
  const after = await timeOf(page, "Clase IPM");
  expect(after).not.toBe(before);
  await nextWeek(page);
  expect(await timeOf(page, "Clase IPM")).toBe(after);
});

test("cancelling the prompt leaves the event where it was", async ({ page }) => {
  await open(page);
  const before = await timeOf(page, "Clase IPM");
  const b = await box(evs(page, "Clase IPM").first());
  await page.mouse.move(b.x + b.width / 2, b.y + 14);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 14 + 70, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Cancelar" }).click();
  expect(await timeOf(page, "Clase IPM")).toBe(before);
  await page.mouse.move(b.x + b.width / 2, b.y + 14);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 14 + 70, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Editar evento recurrente" })).toHaveCount(0);
  expect(await timeOf(page, "Clase IPM")).toBe(before);
});

test("deleting 'this and following' ends the series there", async ({ page }) => {
  await open(page);
  await nextWeek(page);
  await evs(page, "Clase IPM").first().click({ button: "right" });
  await page.locator(".ctx").getByRole("menuitem", { name: "Eliminar" }).click();
  await expect(page.getByRole("dialog", { name: "Eliminar evento recurrente" })).toBeVisible();
  await page.getByRole("button", { name: "Este y los siguientes" }).click();
  await expect(evs(page, "Clase IPM")).toHaveCount(0);
  await nextWeek(page);
  await expect(evs(page, "Clase IPM")).toHaveCount(0);
  await prevWeek(page);
  await prevWeek(page);
  await expect(evs(page, "Clase IPM")).toHaveCount(1); // the week before is untouched
});

test("renaming from the detail applies to the chosen scope", async ({ page }) => {
  await open(page);
  await evs(page, "Clase IPM").first().click();
  const input = page.locator(".popover .title-input");
  await input.fill("IPM laboratorio");
  await input.press("Enter");
  await page.getByRole("button", { name: "Todos los eventos" }).click();
  await expectOnScreen(page, "IPM laboratorio", 1);
  await nextWeek(page);
  await expectOnScreen(page, "IPM laboratorio", 1);
});

test("a single event can become a series and back", async ({ page }) => {
  await open(page);
  await evs(page, "Dentista").first().click();
  const row = page.locator(".popover .prop-row", { hasText: "Repetir" });
  await expect(row).toContainText("No se repite");
  await row.locator(".choice-btn").click();
  await page.locator(".choice-menu").getByRole("button", { name: "Cada semana" }).click();
  await expect(page.locator(".popover .prop-row", { hasText: "Repetir" })).toContainText(
    "Cada semana",
  );
  await expect(evs(page, "Dentista").first().locator(".rep")).toBeVisible();
  await nextWeek(page);
  await expectOnScreen(page, "Dentista", 1);
  await prevWeek(page);

  await evs(page, "Dentista").first().click();
  await page.locator(".popover .prop-row", { hasText: "Repetir" }).locator(".choice-btn").click();
  await page.locator(".choice-menu").getByRole("button", { name: "No se repite" }).click();
  await nextWeek(page);
  await expectOnScreen(page, "Dentista", 0);
});

test("custom repetition: every 2 weeks", async ({ page }) => {
  await open(page);
  await evs(page, "Dentista").first().click();
  await page.locator(".popover .prop-row", { hasText: "Repetir" }).locator(".choice-btn").click();
  await page.locator(".choice-menu").getByRole("button", { name: "Personalizado…" }).click();
  const dialog = page.getByRole("dialog", { name: "Repetición personalizada" });
  await dialog.locator("input[type=number]").first().fill("2");
  await page.screenshot({ path: "e2e/screenshots/recurrence-custom.png" });
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".popover .prop-row", { hasText: "Repetir" })).toContainText(
    "Cada 2 semanas",
  );
  await nextWeek(page);
  await expectOnScreen(page, "Dentista", 0);
  await nextWeek(page);
  await expectOnScreen(page, "Dentista", 1);
});

test("duplicating an occurrence creates a single, non-recurring copy", async ({ page }) => {
  await open(page);
  await evs(page, "Clase IPM").first().click({ button: "right" });
  await page.locator(".ctx").getByRole("menuitem", { name: "Duplicar" }).click();
  await expect(evs(page, "Clase IPM (2)")).toHaveCount(1);
  await expect(evs(page, "Clase IPM (2)").locator(".rep")).toHaveCount(0);
  await nextWeek(page);
  await expect(evs(page, "Clase IPM (2)")).toHaveCount(0);
});
