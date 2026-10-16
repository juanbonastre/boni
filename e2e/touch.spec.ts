import { type CDPSession, expect, type Page, test } from "@playwright/test";

/**
 * The phone layout and fingers (docs/design-guide.md, "Mobile"): a phone-sized touch screen,
 * gestures sent as real touches through the DevTools protocol (Chromium turns them into pointer
 * events with pointerType "touch", like the Android WebView does).
 */
const NOW = "2025-09-17T14:29";
test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

type Pt = { x: number; y: number };
const line = (a: Pt, b: Pt, n = 12): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
  }));

async function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/** One finger along `path`, after resting `hold` ms on its first point. */
async function finger(page: Page, path: Pt[], hold = 0, stepMs = 16) {
  const s = await cdp(page);
  const [first, ...rest] = path;
  if (!first) return;
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [first] });
  if (hold) await page.waitForTimeout(hold);
  for (const p of rest) {
    await s.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] });
    await page.waitForTimeout(stepMs);
  }
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Two fingers moving apart (or together) around `c`. */
async function pinch(page: Page, c: Pt, from: number, to: number) {
  const s = await cdp(page);
  const pts = (d: number) => [
    { x: c.x, y: c.y - d / 2, id: 0 },
    { x: c.x, y: c.y + d / 2, id: 1 },
  ];
  await s.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(from) });
  for (let i = 1; i <= 12; i++) {
    await s.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: pts(from + ((to - from) * i) / 12),
    });
    await page.waitForTimeout(16);
  }
  await s.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function open(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

const grid = (page: Page) =>
  page.evaluate(() => {
    const cs = document.querySelector<HTMLElement>(".cols-strip");
    const gi = document.querySelector<HTMLElement>(".gutter-inner");
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(cs?.style.transform ?? "");
    return {
      x: Number(m?.[1] ?? 0),
      y: Number(m?.[2] ?? 0),
      hh: Number.parseFloat(gi?.style.height ?? "0") / 24,
    };
  });
/** The number of the first day in view (the strip's own offset restarts when new days are rendered). */
const firstDay = (page: Page) =>
  page.evaluate(() => {
    const cols = document.querySelector(".cols-viewport")?.getBoundingClientRect();
    const head = document.querySelector(".head-viewport")?.getBoundingClientRect();
    if (!cols || !head) return 0;
    const el = document.elementFromPoint(cols.left + 20, head.top + head.height / 2);
    return Number(el?.closest(".day-head")?.querySelector(".dh-num")?.textContent ?? 0);
  });
const app = (page: Page) =>
  // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
  page.evaluate(() => (window as any).__app.getState());
const center = async (page: Page) => {
  const b = await page.locator(".cols-viewport").boundingBox();
  if (!b) throw new Error("no grid");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};
/** An event card fully on screen. */
async function visibleEvent(page: Page) {
  const vp = await center(page);
  for (const ev of await page.locator(".ev").all()) {
    const b = await ev.boundingBox();
    if (
      b &&
      b.height > 30 &&
      b.x >= vp.box.x &&
      b.x + b.width <= vp.box.x + vp.box.width &&
      b.y >= vp.box.y &&
      b.y + b.height <= vp.box.y + vp.box.height - 60
    )
      return { ev, b };
  }
  throw new Error("no event on screen");
}

test("a phone opens on three days, with the sidebar as a drawer and a button to create", async ({
  page,
}) => {
  await open(page);
  const s = await app(page);
  expect([s.view, s.nDays, s.compact, s.sidebarOpen]).toEqual(["days", 3, true, false]);
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await expect(page.locator(".fab")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/phone.png" });

  // The drawer opens over the calendar and closes on a tap outside it, or after choosing a day.
  await page.locator(".topbar .icon-btn").first().tap();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/phone-drawer.png" });
  await page.locator(".drawer-scrim").tap({ position: { x: 390, y: 400 } });
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.locator(".topbar .icon-btn").first().tap();
  await page.locator(".mini button", { hasText: /^24$/ }).first().tap();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("a swipe scrolls the hours, a sideways one moves whole days, and neither creates anything", async ({
  page,
}) => {
  await open(page);
  const before = await grid(page);
  const day0 = await firstDay(page);
  const count = (await app(page)).rows.length;
  const c = await center(page);
  // Finger down: earlier hours come into view (the day starts scrolled to the morning).
  await finger(page, line({ x: c.x, y: c.y - 120 }, { x: c.x, y: c.y + 60 }));
  await page.waitForTimeout(700);
  const scrolled = await grid(page);
  expect(scrolled.y).toBeGreaterThan(before.y + 150); // moved with the finger and glided on
  expect(scrolled.x).toBe(before.x);

  await finger(page, line({ x: c.x + 120, y: c.y }, { x: c.x - 60, y: c.y }));
  await page.waitForTimeout(800);
  // Settled on a later whole day: the first column starts exactly at the grid's left edge.
  expect(await firstDay(page)).toBeGreaterThan(day0);
  const edge = await page.evaluate(() => {
    const cols = document.querySelector(".cols-viewport")?.getBoundingClientRect();
    const heads = [...document.querySelectorAll(".day-head")].map(
      (h) => h.getBoundingClientRect().left,
    );
    return Math.min(...heads.map((l) => Math.abs(l - (cols?.left ?? 0))));
  });
  expect(edge).toBeLessThan(1.5);
  expect((await app(page)).rows.length).toBe(count);
  await expect(page.locator(".popover")).toHaveCount(0);
});

test("a tap opens the detail as a sheet at the bottom", async ({ page }) => {
  await open(page);
  const { ev } = await visibleEvent(page);
  await ev.tap();
  const sheet = page.locator(".popover");
  await expect(sheet).toBeVisible();
  const b = await sheet.boundingBox();
  expect(b?.x).toBe(0);
  expect(Math.round((b?.width ?? 0) - 412)).toBe(0);
  expect(Math.round((b?.y ?? 0) + (b?.height ?? 0))).toBe(860);
  await page.screenshot({ path: "e2e/screenshots/phone-sheet.png" });
});

test("a long press then a drag creates an event; on an event it moves it", async ({ page }) => {
  await open(page);
  const count = (await app(page)).rows.length;
  // Empty space: the right column near the bottom of the day.
  const c = await center(page);
  const x = c.box.x + c.box.width - 30;
  await finger(page, line({ x, y: c.box.y + 40 }, { x, y: c.box.y + 140 }, 8), 600);
  await expect(page.locator(".popover .title-input")).toBeVisible();
  expect((await app(page)).rows.length).toBe(count + 1);
  await page.keyboard.press("Escape");

  const { ev, b } = await visibleEvent(page);
  const before = await ev.locator(".ev-time").textContent();
  const id = await ev.getAttribute("data-id");
  await finger(
    page,
    line({ x: b.x + b.width / 2, y: b.y + 12 }, { x: b.x + b.width / 2, y: b.y + 120 }, 10),
    600,
  );
  const scope = page.getByRole("button", { name: "Todos los eventos" });
  if (await scope.isVisible().catch(() => false)) await scope.click();
  await expect(page.locator(`.ev[data-id="${id}"] .ev-time`).first()).not.toHaveText(before ?? "");
});

test("a long press without moving opens the menu of what is under the finger", async ({ page }) => {
  await open(page);
  const { b } = await visibleEvent(page);
  await finger(page, [{ x: b.x + b.width / 2, y: b.y + 12 }], 650);
  await expect(page.locator(".ctx")).toBeVisible();
  await expect(page.locator(".ctx")).toContainText(/Duplicar|Eliminar/);
});

test("two fingers zoom the hours", async ({ page }) => {
  await open(page);
  const before = await grid(page);
  const c = await center(page);
  await pinch(page, c, 80, 260);
  await page.waitForTimeout(600);
  expect((await grid(page)).hh).toBeGreaterThan(before.hh * 1.5);
});

test("in the month, a swipe moves whole weeks", async ({ page }) => {
  await open(page);
  await page.locator(".view-picker .pill").tap();
  await page.locator(".view-menu .menu-item", { hasText: "Mes" }).tap();
  await page.waitForSelector(".mchip");
  const strip = () =>
    page.evaluate(() => document.querySelector<HTMLElement>(".month-strip")?.style.transform ?? "");
  const before = await strip();
  const b = await page.locator(".month-body").boundingBox();
  if (!b) throw new Error("no month");
  await finger(
    page,
    line({ x: b.x + b.width / 2, y: b.y + b.height - 80 }, { x: b.x + b.width / 2, y: b.y + 80 }),
  );
  await page.waitForTimeout(800);
  expect(await strip()).not.toBe(before);
  await page.screenshot({ path: "e2e/screenshots/phone-month.png" });
});
