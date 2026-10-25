import { expect, type Page, test } from "@playwright/test";
import { openApp, recorded } from "./fixtures.ts";

/**
 * A page's buttons (Juan, 2026-10-24): each with its panel from the block catalogue (its name, what it opens, what
 * it does when pressed, its data with the capture's own form, its colour); one that saves at once is counted at
 * once, with Undo; «Apuntar gasto» opens with the caret in the amount.
 */
const SHOTS = "e2e-boni/screenshots";
const sent = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));
const lastSpec = async (page: Page) => {
  const puts = await sent(page, "PUT api/pages/gastos");
  const last = puts[puts.length - 1];
  if (!last) return { blocks: [] as Record<string, unknown>[] };
  return JSON.parse(last.split(" ").slice(2).join(" ")).spec as {
    blocks: Record<string, unknown>[];
  };
};

test("a button's panel: the first pages' shortcut becomes its own data, changed with the capture's form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still");
  const cafe = page.locator(".doc-actions .blk").filter({ hasText: "Café" });
  await cafe.hover();
  await cafe.getByRole("button", { name: /^Mover o modificar/ }).click();
  await page.getByRole("menuitemradio", { name: "Modificar…" }).click();
  const panel = page.locator(".side-panel");
  await expect(panel.locator("h2")).toHaveText("Botón");
  await expect(panel.getByRole("textbox", { name: "Nombre", exact: true })).toHaveValue("Café");
  await expect(panel.getByRole("combobox", { name: "Al pulsarlo" })).toHaveValue("save");
  await expect(panel.locator(".block-panel-values #f-amount")).toHaveValue("1,6");
  await page.screenshot({ path: `${SHOTS}/button-panel.png` });
  // Renamed: the page keeps the button with its own data, no longer the shortcut.
  await panel.getByRole("textbox", { name: "Nombre", exact: true }).fill("Café con leche");
  await expect(
    page.locator(".doc-actions").getByRole("button", { name: "Café", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".doc-actions")).toContainText("Café con leche");
  await expect
    .poll(async () => (await lastSpec(page)).blocks.find((b) => b.id === "b2"))
    .toMatchObject({
      label: "Café con leche",
      mode: "save",
      values: { amount: 1.6 },
      color: "orange",
    });
  expect((await lastSpec(page)).blocks.find((b) => b.id === "b2")).not.toHaveProperty("shortcut");
  // Its data, changed with the capture's form.
  await panel.locator(".block-panel-values #f-amount").fill("2,1");
  await panel.getByRole("button", { name: "Guardar los datos" }).click();
  await expect
    .poll(async () => (await lastSpec(page)).blocks.find((b) => b.id === "b2")?.values)
    .toMatchObject({ amount: 2.1 });
  await panel.getByRole("button", { name: "Cerrar" }).click();
  // Pressed: saved at once with its own data, Undo in the notice.
  await page.locator(".doc-actions").getByRole("button", { name: "Café con leche" }).click();
  await expect(page.locator(".toast")).toContainText("«Café con leche» apuntado");
  const posted = await sent(page, "POST api/v1/actions");
  expect(JSON.parse(posted[0]!.split(" ").slice(2).join(" ")).values).toMatchObject({
    amount: 2.1,
    category: "bebida/cafe",
  });
});

test("«Apuntar gasto» opens with the caret in the amount; a new button from «+» opens the form with its data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still");
  await page.locator(".doc-actions").getByRole("button", { name: "Apuntar gasto" }).click();
  await expect(page.locator(".side-panel #f-amount")).toBeFocused();
  await page.keyboard.press("Escape");
  // A button from «+», «Abrir con datos»: its own name and amount.
  const first = page.locator(".doc-actions .blk").first();
  await first.hover();
  await first.getByRole("button", { name: "Añadir un bloque" }).click();
  await page.keyboard.type("botón", { delay: 20 });
  await page.locator(".add-menu").getByRole("menuitem", { name: "Botón", exact: true }).click();
  const panel = page.locator(".side-panel");
  await expect(panel.locator("h2")).toHaveText("Botón");
  await panel.getByRole("textbox", { name: "Nombre", exact: true }).fill("Menú del día");
  await panel
    .getByRole("combobox", { name: "Al pulsarlo" })
    .selectOption({ label: "Abrir con datos" });
  await panel.locator(".block-panel-values #f-amount").fill("12,5");
  await panel.getByRole("button", { name: "Guardar los datos" }).click();
  await panel.getByRole("button", { name: "Cerrar" }).click();
  await page.locator(".doc-actions").getByRole("button", { name: "Menú del día" }).click();
  await expect(page.locator(".side-panel #f-amount")).toHaveValue("12,5");
});
