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

test("back from the month, the week is today's when today is in that month", async ({ page }) => {
  // A Monday whose week is not the month's middle row (found by the Obsidian suite on 2026-10-19).
  await page.goto("/?now=2026-10-19T20:14&tz=Europe/Madrid");
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
  const week = ["19", "20", "21", "22", "23", "24", "25"];
  expect(await visibleDays(page)).toEqual(week);
  await page.keyboard.press("m");
  await page.waitForSelector(".week-row");
  await page.keyboard.press("w");
  await page.waitForSelector(".grid");
  await page.waitForTimeout(400);
  expect(await visibleDays(page)).toEqual(week);
  // In a month without today, the week is one of that month (the one in the middle of what the
  // month showed; which one depends on where its scrolling was), never today's.
  await page.keyboard.press("m");
  await page.waitForSelector(".week-row");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".title")).toContainText(/noviembre/i);
  await page.keyboard.press("w");
  await page.waitForSelector(".grid");
  await page.waitForTimeout(400);
  await expect(page.locator(".title")).toContainText(/noviembre/i);
  expect(await visibleDays(page)).not.toEqual(week);
});

test("the sidebar comes back as it was when a narrow window is wide again", async ({ page }) => {
  // A split pane in Obsidian or a resized window: narrow, the sidebar is a closed drawer; wide again,
  // it is as it was before.
  await page.setViewportSize({ width: 1400, height: 900 });
  await open(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toBeVisible();
  await page.setViewportSize({ width: 500, height: 900 });
  await expect(sidebar).toHaveCount(0);
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(sidebar).toBeVisible();
  // Closed by hand while wide, it stays closed after a narrow spell.
  await page.locator(".title").click();
  await page.keyboard.press("[");
  await expect(sidebar).toHaveCount(0);
  await page.setViewportSize({ width: 500, height: 900 });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(300);
  await expect(sidebar).toHaveCount(0);
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
  const handle = ev.locator(".ev-resize:not(.top)");
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("no handle");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const after = await page.locator(".ev", { hasText: "Prueba" }).boundingBox();
  expect(after && after.height).toBeGreaterThan(before.height + 40);
});

test("a new event is only a highlighted range until it has a title; closing it untitled drops it", async ({
  page,
}) => {
  await open(page);
  const count = () => page.locator(".ev").count();
  const before = await count();
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (!cols) throw new Error("no grid");
  const x = cols.x + (cols.width / 7) * 5.5;
  // Dragged out: the range shows, without title or time (already while dragging), and the detail opens
  // on its title.
  await page.mouse.move(x, cols.y + 200);
  await page.mouse.down();
  await page.mouse.move(x, cols.y + 280, { steps: 6 });
  await expect(page.locator(".ev.draft")).toHaveCount(1);
  await expect(page.locator(".ev.draft .ev-body")).toBeHidden();
  await page.mouse.up();
  await expect(page.locator(".popover .title-input")).toBeFocused();
  const draft = page.locator(".ev.draft");
  await expect(draft).toHaveCount(1);
  await expect(draft.locator(".ev-body")).toBeHidden();
  await page.screenshot({ path: "e2e/screenshots/new-event-draft.png" });

  // Moved while still untitled: it stays a draft with its detail open.
  const box = await draft.boundingBox();
  if (!box) throw new Error("no draft");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".ev.draft")).toHaveCount(1);
  await expect(page.locator(".popover")).toBeVisible();

  // Closed without a title: gone, and nothing to undo.
  await page.keyboard.press("Escape");
  await expect(page.locator(".ev.draft")).toHaveCount(0);
  expect(await count()).toBe(before);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  expect(await count()).toBe(before);

  // A title typed and then a click elsewhere (no Enter): it is kept, not dropped.
  await page.mouse.dblclick(x, cols.y + 200);
  await expect(page.locator(".popover .title-input")).toBeFocused();
  await page.keyboard.type("Sin pulsar Enter");
  await page.mouse.click(cols.x + 20, cols.y + 600);
  await expect(page.locator(".ev", { hasText: "Sin pulsar Enter" })).toHaveCount(1);
  await expect(page.locator(".ev.draft")).toHaveCount(0);

  // With a title it is an ordinary event.
  await page.mouse.dblclick(x, cols.y + 420);
  await expect(page.locator(".ev.draft")).toHaveCount(1);
  await page.keyboard.type("Con título");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ev.draft")).toHaveCount(0);
  await expect(page.locator(".ev", { hasText: "Con título" })).toHaveCount(1);
  await page.locator(".sidebar-top").click();
  await expect(page.locator(".ev", { hasText: "Con título" })).toHaveCount(1);
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
