import { expect, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

const openProps = async (page: Page, calendar: string) => {
  await page.locator(".cal-row", { hasText: calendar }).hover();
  await page
    .locator(".cal-row", { hasText: calendar })
    .getByTitle("Propiedades del calendario")
    .click();
};

test("the calendar view section lists the roles and the free properties", async ({ page }) => {
  await open(page);
  await openProps(page, "Docencia");
  const dialog = page.locator(".modal");
  await expect(dialog.getByRole("heading", { name: "Vista de calendario" })).toBeVisible();
  for (const label of ["Fecha", "Hora de inicio", "Hora de fin", "Fecha de fin", "Tareas"]) {
    await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
  }
  // Mapped columns are not repeated as free properties; real properties are.
  await expect(dialog.locator(".schema-row input.field-input").first()).toHaveValue("Asignatura");
  await expect(dialog.locator(".schema-row input.field-input[value='Fecha']")).toHaveCount(0);
  await page.screenshot({ path: "e2e/screenshots/schema-view.png" });
});

test("a calendar without a task column offers no Event / Task controls", async ({ page }) => {
  await open(page);
  await openProps(page, "Gestiones");
  const dialog = page.locator(".modal");
  await dialog.getByLabel("Tareas", { exact: true }).selectOption({ label: "Sin tareas" });
  await page.keyboard.press("Escape");

  await page.locator(".ev", { hasText: "Gestión de actas" }).first().click();
  await expect(page.locator(".popover")).toBeVisible();
  await expect(page.locator(".popover").getByRole("radiogroup", { name: "Tipo" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator(".ev", { hasText: "Gestión de actas" }).first().click({ button: "right" });
  await expect(page.getByText("Convertir en tarea")).toHaveCount(0);
});

test("pointing the tasks at a status column turns its rows into tasks", async ({ page }) => {
  await open(page);
  // "Gestión de actas" has the status "Pendiente" but is a plain event while `Hecha` is the task column.
  await expect(page.locator(".ev.task", { hasText: "Gestión de actas" })).toHaveCount(0);
  await openProps(page, "Gestiones");
  const dialog = page.locator(".modal");
  await dialog.getByLabel("Tareas", { exact: true }).selectOption({ label: "Estado" });
  await expect(dialog.getByText("Hecha cuando")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ev.task", { hasText: "Gestión de actas" }).first()).toBeVisible();
  await expect(page.locator(".ev.task.done", { hasText: "Gestión de actas" })).toHaveCount(0);

  // Ticking one makes its status the "done" option (the last one by default).
  await page.locator(".ev", { hasText: "Gestión de actas" }).first().click();
  await page.locator(".popover .prop-row", { hasText: "Hecha" }).first().locator("input").check();
  const status = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const s = (window as any).__app.getState();
    const id = s.selectedId.split("~")[0];
    return s.rows.find((r: { id: string }) => r.id === id)?.values.status;
  });
  expect(status).toBe("done");
});
