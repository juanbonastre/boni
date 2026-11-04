import { expect, type Page, test } from "@playwright/test";

/**
 * A record of the user's linked to an external calendar's event (task 50): made from it («Crear nota»), chosen among
 * the records near it («Enlazar») or the one the code suggests («¿Es «X»?»). The calendar paints one item at the
 * external event's time; «Quitar enlace» leaves two again. The network is the same test double as `external.spec.ts`.
 */
const NOW = "2025-09-17T14:29";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Calendario inventado",
  "X-WR-TIMEZONE:Europe/Madrid",
  "BEGIN:VEVENT",
  "UID:taller@example.com",
  "DTSTART;TZID=Europe/Madrid:20250915T190000",
  "DTEND;TZID=Europe/Madrid:20250915T200000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TH",
  "SUMMARY:Taller externo",
  "LOCATION:Sala de ejemplo",
  "DESCRIPTION:Enlace: https://zoom.us/j/123456789",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

async function open(page: Page) {
  await page.addInitScript((feed) => {
    // biome-ignore lint/suspicious/noExplicitAny: test double of the desktop shell's downloader
    (window as any).boniNet = { fetchText: async () => ({ ok: true, value: feed }) };
  }, FEED);
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.locator(".add-account").click();
  const form = page.locator(".ext-form");
  await form.locator("input").first().fill("Calendario de ejemplo");
  await form.locator("input").nth(1).fill("https://example.com/ejemplo.ics");
  await form.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.locator(".ext-settings")).toContainText(/\d+ eventos?/);
  await page.keyboard.press("Escape");
}

const taller = (page: Page) => page.locator(".ev", { hasText: "Taller externo" });

test("an external event becomes a record of the user's, at its time, linked and unlinked", async ({
  page,
}) => {
  await open(page);
  await expect(taller(page).first()).toBeVisible();
  const n = await taller(page).count();
  // One occurrence, followed by its id through the test (it goes while linked and comes back after).
  const extId = await taller(page).first().getAttribute("data-id");
  expect(extId).toMatch(/^ext:/);
  const external = page.locator(`.ev[data-id="${extId}"]`);
  const pop = page.locator(".popover");
  const linked = page.locator(".ev.linked");
  const menuItems = pop.locator(".choice-menu .menu-item");

  // «Crear nota»: a record in a calendar of the user's, at the external event's time; the external event goes.
  await external.click();
  await expect(pop.locator(".title-input")).toBeDisabled();
  await expect(pop.locator(".detail-link")).toContainText("Enlazar");
  await pop.locator(".detail-link .choice-btn", { hasText: "Crear nota" }).click();
  await menuItems.first().click();
  await expect(linked).toHaveCount(1);
  await expect(linked).toContainText("Taller externo");
  await expect(external).toHaveCount(0);
  await expect(taller(page)).toHaveCount(n);
  // Its detail: the user's own title, «Enlace» with the calendar it follows, and a time that is not edited here;
  // the external event's video call stays with it («Unirse», task 49).
  await expect(pop.locator(".title-input")).toBeEnabled();
  await expect(pop.locator(".detail-join")).toBeVisible();
  await expect(pop.locator(".linked-row")).toContainText("Calendario de ejemplo");
  await expect(pop.locator(".when-locked")).toHaveAttribute("disabled", "");
  await page.screenshot({ path: "e2e/screenshots/linked.png" });

  // Dragging does not move it: the external calendar rules its time.
  const box = await linked.boundingBox();
  if (!box) throw new Error("no linked event");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect((await linked.boundingBox())?.y).toBe(box.y);

  // «Quitar enlace»: two again, the record where it was shown.
  await linked.click();
  await pop.getByRole("button", { name: "Quitar enlace" }).click();
  await expect(linked).toHaveCount(0);
  await expect(external).toHaveCount(1);
  await expect(taller(page)).toHaveCount(n + 1);
  await page.keyboard.press("Escape");

  // «Enlazar» offers the records near the external event, the closest first: the one just unlinked.
  await external.click();
  await expect(pop.locator(".detail-link-ask")).toContainText("¿Es «Taller externo»?");
  await pop.locator(".detail-link .choice-btn", { hasText: "Enlazar" }).click();
  await expect(menuItems.first()).toContainText("Taller externo");
  await menuItems.first().click();
  await expect(linked).toHaveCount(1);
  await expect(pop.locator(".linked-row")).toContainText("Calendario de ejemplo");

  // Unlinked again, the external event's detail asks whether it is that record: «Sí» links it.
  await pop.getByRole("button", { name: "Quitar enlace" }).click();
  await expect(linked).toHaveCount(0);
  await page.keyboard.press("Escape");
  await external.click();
  await pop.getByRole("button", { name: "Sí" }).click();
  await expect(linked).toHaveCount(1);
  await expect(external).toHaveCount(0);
});
