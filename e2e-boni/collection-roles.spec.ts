import { expect, type Page, test } from "@playwright/test";
import { openApp, recorded } from "./fixtures.ts";

/**
 * What a collection can do, on its page (docs/clases.md §6, task 4; D-64): Calendario, Tareas and Dinero as tags, each
 * a control that gives its roles or takes them away, with what taking it away hides said before the click, and Undo.
 */
const roleCalls = async (page: Page) =>
  (await recorded(page)).requests.filter((r) => /^PUT api\/data\/types\/[^/]+\/roles /.test(r));

async function openCollection(page: Page, name: string) {
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data").getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText(name);
}

test("a collection's page shows its roles as tags; taking the day away says it hides the calendar, Undo brings it back, and the day is given again in place", async ({
  page,
}) => {
  await openApp(page, "/?still", { agenda: true });
  await openCollection(page, "Eventos");
  const tags = page.locator(".col-roles .role-pill");
  // A day and hours, no box nor amount: only Calendario, and it has it.
  await expect(tags).toHaveText(["Calendario"]);
  const calendario = tags.filter({ hasText: "Calendario" });
  await expect(calendario).toHaveClass(/\bon\b/);

  await calendario.click();
  const menu = page.getByRole("menu");
  await expect(menu.locator(".menu-next")).toHaveText([
    /Día\s*Fecha/,
    /Hora\s*Hora de inicio/,
    /Hora de fin\s*Hora de fin/,
    /Día de fin\s*Ninguno/,
  ]);
  // What taking it away hides, said in one line before the click.
  await expect(menu.locator(".role-effect")).toHaveText("Deja de salir en Boni Calendar.");
  await menu.getByRole("menuitemradio", { name: "Quitar" }).click();
  await expect(page.locator(".toast")).toContainText("Papeles cambiados");
  await expect(calendario).not.toHaveClass(/\bon\b/);
  expect(await roleCalls(page)).toEqual([
    'PUT api/data/types/t_eventos/roles {"roles":{"date":null,"time":null,"endTime":null}}',
  ]);

  // «Deshacer» puts back what it had of its own.
  await page.locator(".toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(calendario).toHaveClass(/\bon\b/);
  expect((await roleCalls(page))[1]).toBe(
    'PUT api/data/types/t_eventos/roles {"roles":{"date":"f_efecha","time":"f_ehora","endTime":"f_ehfin"}}',
  );

  // Taken away again, and the day given back in place: its row opens the fields that can be a day.
  await calendario.click();
  await page.getByRole("menu").getByRole("menuitemradio", { name: "Quitar" }).click();
  await expect(calendario).not.toHaveClass(/\bon\b/);
  await calendario.click();
  await expect(page.getByRole("menu").locator(".menu-next")).toHaveText([/Día\s*Ninguno/]);
  await expect(page.getByRole("menu").locator(".role-effect")).toHaveCount(0);
  await page.getByRole("menu").locator(".menu-next").click();
  await page.getByRole("menu").getByRole("menuitemradio", { name: "Fecha", exact: true }).click();
  await expect(calendario).toHaveClass(/\bon\b/);
  expect((await roleCalls(page)).at(-1)).toBe(
    'PUT api/data/types/t_eventos/roles {"roles":{"date":"f_efecha","start":null,"end":null}}',
  );
});

test("Tareas: its box is a field of the right kind, and taking it away says its records stop being tasks; on a phone the tags fit", async ({
  page,
}) => {
  await openApp(page, "/?still", { agenda: true });
  await openCollection(page, "Tareas");
  const tags = page.locator(".col-roles .role-pill");
  await expect(tags).toHaveText(["Calendario", "Tareas"]);
  const tareas = tags.filter({ hasText: "Tareas" });
  await tareas.click();
  const menu = page.getByRole("menu");
  await expect(menu.locator(".role-effect")).toHaveText(
    "Sus registros dejan de ser tareas en Boni Calendar.",
  );
  await menu.locator(".menu-next", { hasText: "Hecha" }).click();
  // Only checkboxes can be a box: the one it has, ticked; another one here would change its tasks, said first.
  await expect(menu.getByRole("menuitemradio")).toHaveText([/Hecha\s*✓/]);
  await expect(menu.locator(".role-effect")).toHaveText(
    "Cambia cómo salen sus registros en Boni Calendar.",
  );
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  for (const box of await tags.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().right),
  ))
    expect(box).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("a collection with nothing a role takes shows no tags", async ({ page }) => {
  await openApp(page, "/?still", { agenda: true });
  await openCollection(page, "Documentos");
  await expect(page.locator(".col-protect")).toBeVisible();
  await expect(page.locator(".col-roles")).toHaveCount(0);
});

test("Dinero: an amount and a day; its roles open in place, and taking it away hides nothing, so nothing is said", async ({
  page,
}) => {
  await openApp(page, "/?still", { travel: true });
  await openCollection(page, "Gastos de viaje");
  const dinero = page.locator(".col-roles .role-pill", { hasText: "Dinero" });
  await expect(dinero).toHaveClass(/\bon\b/);
  await dinero.click();
  const menu = page.getByRole("menu");
  await expect(menu.locator(".menu-next")).toHaveText([/^Importe/, /^Categoría/]);
  await expect(menu.locator(".role-effect")).toHaveCount(0);
  await menu.getByRole("menuitemradio", { name: "Quitar" }).click();
  await expect(dinero).not.toHaveClass(/\bon\b/);
  expect((await roleCalls(page)).at(-1)).toMatch(
    /^PUT api\/data\/types\/t_gastos_viaje\/roles \{"roles":\{"amount":null,"category":null\}\}$/,
  );
});
