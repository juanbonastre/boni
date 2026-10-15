import { expect, type Locator, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

type When =
  | { kind: "allday"; startDay: number; endDay: number }
  | { kind: "timed"; start: number; end: number };
const whenOf = (page: Page, title: string) =>
  page.evaluate((t) => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const s = (window as any).__app.getState();
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    const e = s.data.events.find((x: any) => x.title === t);
    return e ? (e.when as When) : null;
  }, title);

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return b;
};
const colWidth = async (page: Page) => (await box(page.locator(".cols-viewport"))).width / 7;

async function drag(page: Page, x: number, y: number, dx: number, dy = 0) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe("all-day events in the week grid", () => {
  test("drag moves an all-day event by whole days", async ({ page }) => {
    await open(page);
    const before = (await whenOf(page, "Cumpleaños de Eva")) as Extract<When, { kind: "allday" }>;
    const bar = page.locator(".allday-viewport .bar", { hasText: "Cumpleaños de Eva" });
    const b = await box(bar);
    const cw = await colWidth(page);
    await drag(page, b.x + b.width / 2, b.y + b.height / 2, -cw * 2);
    const after = (await whenOf(page, "Cumpleaños de Eva")) as Extract<When, { kind: "allday" }>;
    expect(after.startDay - before.startDay).toBe(-2);
    expect(after.endDay - before.endDay).toBe(-2);
    await page.keyboard.press("Control+z");
    expect(await whenOf(page, "Cumpleaños de Eva")).toEqual(before);
  });

  test("the handles stretch either end", async ({ page }) => {
    await open(page);
    const before = (await whenOf(page, "Jornada de acogida (no asistir)")) as Extract<
      When,
      { kind: "allday" }
    >;
    const bar = page.locator(".allday-viewport .bar", { hasText: "Jornada de acogida" });
    const b = await box(bar);
    const cw = await colWidth(page);
    await drag(page, b.x + b.width - 3, b.y + b.height / 2, cw); // end handle, one day later
    let now = (await whenOf(page, "Jornada de acogida (no asistir)")) as Extract<
      When,
      { kind: "allday" }
    >;
    expect(now.endDay - before.endDay).toBe(1);
    expect(now.startDay).toBe(before.startDay);
    const b2 = await box(page.locator(".allday-viewport .bar", { hasText: "Jornada de acogida" }));
    await drag(page, b2.x + 3, b2.y + b2.height / 2, -cw); // start handle, one day earlier
    now = (await whenOf(page, "Jornada de acogida (no asistir)")) as Extract<
      When,
      { kind: "allday" }
    >;
    expect(before.startDay - now.startDay).toBe(1);
  });

  test("dragging on the empty all-day row creates a multi-day event", async ({ page }) => {
    await open(page);
    const row = await box(page.locator(".allday-viewport"));
    const cw = await colWidth(page);
    const count = await page.evaluate(
      () =>
        (
          window as unknown as { __app: { getState: () => { data: { events: unknown[] } } } }
        ).__app.getState().data.events.length,
    );
    await drag(page, row.x + cw * 0.5, row.y + 12, cw * 1.2);
    await expect(page.locator(".popover .title-input")).toBeFocused();
    const events = await page.evaluate(
      () =>
        (
          window as unknown as { __app: { getState: () => { data: { events: unknown[] } } } }
        ).__app.getState().data.events.length,
    );
    expect(events).toBe(count + 1);
    await page.keyboard.type("Viaje");
    await page.keyboard.press("Enter");
    const w = (await whenOf(page, "Viaje")) as Extract<When, { kind: "allday" }>;
    expect(w.endDay - w.startDay).toBe(1); // Monday and Tuesday
  });

  test("events of read-only calendars cannot be dragged", async ({ page }) => {
    await open(page);
    await page.locator(".cal-row", { hasText: "Festivos" }).locator(".eye").click();
    const bar = page.locator(".allday-viewport .bar", { hasText: "Día festivo local" });
    await expect(bar).toBeVisible();
    const before = await whenOf(page, "Día festivo local");
    const b = await box(bar);
    await drag(page, b.x + b.width / 2, b.y + b.height / 2, await colWidth(page));
    expect(await whenOf(page, "Día festivo local")).toEqual(before);
  });
});

test.describe("month view drags", () => {
  async function openMonth(page: Page) {
    await open(page);
    await page.keyboard.press("m");
    await page.waitForSelector(".mchip");
    await page.waitForTimeout(700);
  }
  const cell = (page: Page, day: number) => page.locator(`.mcell[data-day="${day}"]`);
  const SEP15 = 20346; // 2025-09-15

  test("a chip moves to another day keeping its time", async ({ page }) => {
    await openMonth(page);
    const before = (await whenOf(page, "Dentista")) as Extract<When, { kind: "timed" }>;
    const chip = page.locator(".mchip", { hasText: "Dentista" });
    const b = await box(chip);
    const target = await box(cell(page, SEP15 + 2)); // Wednesday
    await drag(
      page,
      b.x + 30,
      b.y + b.height / 2,
      target.x + 40 - (b.x + 30),
      target.y + 70 - (b.y + b.height / 2),
    );
    const after = (await whenOf(page, "Dentista")) as Extract<When, { kind: "timed" }>;
    expect(after.start - before.start).toBe(2 * 86_400_000);
    expect(after.end - after.start).toBe(before.end - before.start);
  });

  test("an all-day bar moves and stretches", async ({ page }) => {
    await openMonth(page);
    const before = (await whenOf(page, "Cumpleaños de Eva")) as Extract<When, { kind: "allday" }>;
    const bar = page.locator(".week-row .bar", { hasText: "Cumpleaños de Eva" }).first();
    const b = await box(bar);
    const cw = (await box(cell(page, SEP15))).width;
    await drag(page, b.x + b.width / 2, b.y + b.height / 2, -cw);
    const moved = (await whenOf(page, "Cumpleaños de Eva")) as Extract<When, { kind: "allday" }>;
    expect(moved.startDay - before.startDay).toBe(-1);
    const b2 = await box(page.locator(".week-row .bar", { hasText: "Cumpleaños de Eva" }).first());
    await drag(page, b2.x + b2.width - 3, b2.y + b2.height / 2, cw * 2);
    const stretched = (await whenOf(page, "Cumpleaños de Eva")) as Extract<
      When,
      { kind: "allday" }
    >;
    expect(stretched.endDay - moved.endDay).toBe(2);
  });

  test("dragging across empty cells creates a multi-day event", async ({ page }) => {
    await openMonth(page);
    const a = await box(cell(page, SEP15 + 8)); // Tue 23
    const c = await box(cell(page, SEP15 + 10)); // Thu 25
    await drag(page, a.x + 30, a.y + a.height - 20, c.x - a.x, 0);
    await expect(page.locator(".popover .title-input")).toBeFocused();
    await page.keyboard.type("Congreso");
    await page.keyboard.press("Enter");
    const w = (await whenOf(page, "Congreso")) as Extract<When, { kind: "allday" }>;
    expect(w.endDay - w.startDay).toBe(2);
  });

  test("Esc cancels a month drag", async ({ page }) => {
    await openMonth(page);
    const before = await whenOf(page, "Dentista");
    const b = await box(page.locator(".mchip", { hasText: "Dentista" }));
    const t = await box(cell(page, SEP15 + 3));
    await page.mouse.move(b.x + 30, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + 40, t.y + 70, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await whenOf(page, "Dentista")).toEqual(before);
  });
});
