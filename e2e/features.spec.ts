import { expect, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page, extra = "") {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid${extra}`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

async function visibleDays(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vp = document.querySelector(".head-viewport")?.getBoundingClientRect();
    if (!vp) return [];
    return [...document.querySelectorAll<HTMLElement>(".day-head")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= vp.left - 2 && r.right <= vp.right + 2;
      })
      .map((el) => el.querySelector(".dh-num")?.textContent ?? "");
  });
}

test("week starts on Monday by default and on Sunday from settings", async ({ page }) => {
  await open(page);
  expect(await visibleDays(page)).toEqual(["15", "16", "17", "18", "19", "20", "21"]);
  await page.keyboard.press("Control+,");
  await page.getByRole("radio", { name: "Domingo" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  expect(await visibleDays(page)).toEqual(["14", "15", "16", "17", "18", "19", "20"]);
  await expect(page.locator(".mini-dow").first()).toHaveText("Do");
});

test("number keys set N-day views and the mini month highlights exactly those days", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("3");
  await page.waitForTimeout(900);
  const days = await visibleDays(page);
  expect(days).toHaveLength(3);
  const highlighted = await page.locator(".mini-day.in:not(.other)").allTextContents();
  expect(highlighted).toEqual(days);
  await page.keyboard.press("1");
  await page.waitForTimeout(700);
  expect(await visibleDays(page)).toEqual(["17"]);
});

test("next/previous and Today navigate by the visible span", async ({ page }) => {
  await open(page);
  await page.locator(".topbar").getByRole("button", { name: "Siguiente" }).click();
  await page.waitForTimeout(800);
  expect((await visibleDays(page))[0]).toBe("22");
  await page.locator(".topbar").getByRole("button", { name: "Hoy" }).click();
  await page.waitForTimeout(900);
  expect((await visibleDays(page))[0]).toBe("15");
});

test("quick create from the palette", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("revisión dental mañana 17:30-18:15 #medico");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const ev = page.locator(".ev", { hasText: "revisión dental" });
  await expect(ev).toHaveCount(1);
  await expect(ev.locator(".ev-time")).toHaveText("17:30–18:15");
  await expect(page.locator(".popover .title-input")).toHaveValue("revisión dental");
});

test("double click creates an event and resize changes the end", async ({ page }) => {
  await open(page);
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (!cols) throw new Error("no grid");
  const x = cols.x + (cols.width / 7) * 5.5;
  await page.mouse.dblclick(x, cols.y + 200);
  await expect(page.locator(".popover .title-input")).toBeFocused();
  await page.keyboard.type("Prueba");
  await page.keyboard.press("Enter");
  const ev = page.locator(".ev", { hasText: "Prueba" });
  await expect(ev).toHaveCount(1);
  const before = await ev.boundingBox();
  if (!before) throw new Error("no event");
  const handle = ev.locator(".ev-resize");
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("no handle");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const after = await page.locator(".ev", { hasText: "Prueba" }).boundingBox();
  expect(after && after.height).toBeGreaterThan(before.height + 40);
});

test("popover closes when clicking elsewhere and delete offers undo", async ({ page }) => {
  await open(page);
  await page.locator(".ev", { hasText: "Dentista" }).first().click();
  await expect(page.locator(".popover")).toBeVisible();
  await page.locator(".sidebar-top").click();
  await expect(page.locator(".popover")).toHaveCount(0);
  await page.locator(".ev", { hasText: "Dentista" }).first().click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".ev", { hasText: "Dentista" })).toHaveCount(0);
  await page.locator(".toast button").click();
  await expect(page.locator(".ev", { hasText: "Dentista" })).toHaveCount(1);
});

test("changing the property of an event persists in the popover", async ({ page }) => {
  await open(page);
  await page.locator(".ev", { hasText: "Clase IPM" }).first().click();
  const row = page.locator(".popover .prop-row", { hasText: "Aula" });
  const input = row.locator("input");
  await input.fill("Z-999");
  await input.press("Enter");
  await page.keyboard.press("Escape");
  await page.locator(".ev", { hasText: "Clase IPM" }).first().click();
  await expect(
    page.locator(".popover .prop-row", { hasText: "Aula" }).locator("input"),
  ).toHaveValue("Z-999");
});

test("palette searches events and jumps to them", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("natación");
  await expect(page.locator(".palette-item").nth(1)).toContainText("Natación");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".popover .title-input")).toHaveValue("Natación");
});

test("palette goes to a date", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("3/11");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  await expect(page.locator(".title")).toContainText("Noviembre");
});
