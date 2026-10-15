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

type Timed = { kind: "timed"; start: number; end: number; tz: string };
const whenOf = (page: Page, title: string) =>
  page.evaluate((t) => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const s = (window as any).__app.getState();
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    return s.data.events.find((x: any) => x.title === t)?.when as Timed | undefined;
  }, title);

async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

const whenById = (page: Page, id: string) =>
  page.evaluate((i) => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const s = (window as any).__app.getState();
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    return s.data.events.find((x: any) => x.id === i)?.when as Timed | undefined;
  }, id);

const colWidth = async (page: Page) => (await box(page.locator(".cols-viewport"))).width / 7;
const DAY = 86_400_000;

test("long option labels stay on one line inside their row and inside the popover", async ({
  page,
}) => {
  await open(page);
  await page.locator(".ev", { hasText: "Dentista" }).first().click();
  await page.locator(".popover .prop-row", { hasText: "Repetir" }).locator(".choice-btn").click();
  const item = page.locator(".choice-menu .menu-item", { hasText: "Entre semana" });
  await expect(item).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/repeat-menu.png" });
  const i = await box(item);
  expect(i.height).toBeLessThan(40); // one line
  const fits = await item.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  const menu = await box(page.locator(".choice-menu"));
  const pop = await box(page.locator(".popover"));
  expect(menu.x + menu.width).toBeLessThanOrEqual(pop.x + pop.width + 1);
  expect(menu.x).toBeGreaterThanOrEqual(pop.x - 1);
});

test("dragging the bottom edge into the next day's column stretches an event past midnight", async ({
  page,
}) => {
  await open(page);
  const ev = page.locator(".ev", { hasText: "Natación" }).first();
  const id = (await ev.getAttribute("data-id")) ?? "";
  const before = (await whenById(page, id)) as Timed;
  const handle = await box(ev.locator(".ev-resize:not(.top)"));
  const cw = await colWidth(page);
  await drag(page, handle.x + handle.width / 2, handle.y + handle.height / 2, cw, 0);
  const after = (await whenById(page, id)) as Timed;
  expect(after.start).toBe(before.start);
  expect(after.end - before.end).toBe(DAY); // same time, one day later
  await page.keyboard.press("Control+z");
  expect(((await whenById(page, id)) as Timed).end).toBe(before.end);
});

test("the top edge can be stretched into the previous day", async ({ page }) => {
  await open(page);
  const before = (await whenOf(page, "Clase de yoga")) as Timed;
  const ev = page.locator(".ev", { hasText: "Clase de yoga" }).first();
  const handle = await box(ev.locator(".ev-resize.top"));
  const cw = await colWidth(page);
  await drag(page, handle.x + handle.width / 2, handle.y + 3, -cw, 0);
  const after = (await whenOf(page, "Clase de yoga")) as Timed;
  expect(after.end).toBe(before.end);
  expect(before.start - after.start).toBeGreaterThanOrEqual(DAY - 30 * 60_000);
});

test("an event that spans midnight moves as a whole, from either of its two parts", async ({
  page,
}) => {
  await open(page);
  const body = await box(page.locator(".cols-viewport"));
  const parts = page.locator(".ev", { hasText: "Fiesta de cumpleaños" });
  const before = (await whenOf(page, "Fiesta de cumpleaños")) as Timed;

  // Saturday part (22:00 - 24:00): scroll down to it and drag it up
  await page.mouse.move(body.x + 50, body.y + 300);
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(700);
  const first = await box(parts.first());
  await drag(page, first.x + first.width / 2, first.y + 20, 0, -50);
  const mid = (await whenOf(page, "Fiesta de cumpleaños")) as Timed;
  expect(mid.end - mid.start).toBe(before.end - before.start);
  expect(mid.start).toBeLessThan(before.start);

  // Sunday part (00:00 - 02:30): scroll up to it and drag it down
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(700);
  const last = await box(parts.last());
  await drag(page, last.x + last.width / 2, last.y + 20, 0, 80);
  const after = (await whenOf(page, "Fiesta de cumpleaños")) as Timed;
  expect(after.end - after.start).toBe(before.end - before.start);
  expect(after.start).toBeGreaterThan(mid.start);
});

test("the detail offers Event / Task and the done checkbox, in the popover and in the side panel", async ({
  page,
}) => {
  await open(page);
  const card = page.locator(".ev", { hasText: "Dentista" }).first();
  await card.click();
  const type = page.locator(".popover").getByRole("radiogroup", { name: "Tipo" });
  await expect(type.getByRole("radio", { name: "Evento" })).toHaveAttribute("aria-checked", "true");
  await type.getByRole("radio", { name: "Tarea" }).click();
  await expect(page.locator(".ev.task", { hasText: "Dentista" })).toHaveCount(1);
  await page.locator(".popover .prop-row", { hasText: "Hecha" }).locator("input").check();
  await expect(page.locator(".ev.task.done", { hasText: "Dentista" })).toHaveCount(1);
  await page.screenshot({ path: "e2e/screenshots/detail-task.png" });

  // same controls in the side panel
  await page.locator(".popover button[title='Abrir como panel']").click();
  const panelType = page.locator(".detail-panel").getByRole("radiogroup", { name: "Tipo" });
  await expect(panelType.getByRole("radio", { name: "Tarea" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await panelType.getByRole("radio", { name: "Evento" }).click();
  await expect(page.locator(".ev.task", { hasText: "Dentista" })).toHaveCount(0);
});

test("a newly created event can be made a task right away", async ({ page }) => {
  await open(page);
  const cols = await box(page.locator(".cols-viewport"));
  const x = cols.x + (cols.width / 7) * 5.5;
  await drag(page, x, cols.y + 300, 0, 100);
  await expect(page.locator(".popover .title-input")).toBeFocused();
  await page.locator(".popover").getByRole("radio", { name: "Tarea" }).click();
  const newest = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const evs = (window as any).__app.getState().data.events;
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    return evs.reduce((a: any, b: any) => (b.created >= a.created ? b : a)).isTask;
  });
  expect(newest).toBe(true);
});

test("dragging to create can run into the next or the previous day's column", async ({ page }) => {
  await open(page);
  const cols = await box(page.locator(".cols-viewport"));
  const cw = cols.width / 7;
  const startX = cols.x + cw * 4.5; // Friday column
  const y = cols.y + 150;

  await drag(page, startX, y, cw, 110); // down-right: ends in Saturday
  await page.keyboard.type("Guardia");
  await page.keyboard.press("Enter");
  const a = (await whenOf(page, "Guardia")) as Timed;
  expect(a.end - a.start).toBeGreaterThan(DAY); // crosses midnight: more than a day apart in wall clock
  await page.keyboard.press("Escape");

  await drag(page, cols.x + cw * 6.5, cols.y + 60, -cw, 30); // Sunday, dragged left: starts in Saturday
  await page.keyboard.type("Reten");
  await page.keyboard.press("Enter");
  const b = (await whenOf(page, "Reten")) as Timed;
  expect(b.end - b.start).toBeGreaterThan(DAY - 3 * 3_600_000);
  expect(b.end - b.start).toBeLessThan(DAY + 3 * 3_600_000);
  await page.screenshot({ path: "e2e/screenshots/create-across-days.png" });
});
