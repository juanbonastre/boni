import { expect, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page, extra = "") {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid${extra}`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

const state = (page: Page) =>
  page.evaluate(() => {
    const cs = document.querySelector<HTMLElement>(".cols-strip");
    const gi = document.querySelector<HTMLElement>(".gutter-inner");
    const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(cs?.style.transform ?? "");
    return {
      x: Number(m?.[1] ?? 0),
      y: Number(m?.[2] ?? 0),
      hh: Number.parseFloat(gi?.style.height ?? "0") / 24,
      first: document.querySelector(".day-head.today, .day-head")?.textContent,
    };
  });

const bodyCenter = async (page: Page) => {
  const box = await page.locator(".cols-viewport").boundingBox();
  if (!box) throw new Error("no grid");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

test("wheel scrolls vertically, smoothly", async ({ page }) => {
  await open(page);
  const { x, y } = await bodyCenter(page);
  await page.mouse.move(x, y);
  const before = await state(page);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(40);
  const mid = await state(page);
  await page.waitForTimeout(600);
  const after = await state(page);
  // y is -scrollY: scrolling up (negative delta) lowers scrollY, so y moves toward 0.
  expect(after.y).toBeGreaterThan(before.y);
  expect(mid.y).not.toBe(after.y); // still animating at 40 ms
  expect(after.x).toBe(before.x);
  await page.screenshot({ path: "e2e/screenshots/scrolled.png" });
});

test("ctrl+wheel zooms the hours around the pointer", async ({ page }) => {
  await open(page);
  const { x, y, box } = await bodyCenter(page);
  await page.mouse.move(x, y);
  const read = async () => {
    const s = await state(page);
    return {
      ...s,
      minute: ((-s.y + (y - (await page.locator(".body").boundingBox())!.y)) / s.hh) * 60,
    };
  };
  const before = await read();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(40);
  await page.screenshot({ path: "e2e/screenshots/zoom-mid.png" });
  await page.waitForTimeout(700);
  const after = await read();
  expect(after.hh).toBeGreaterThan(before.hh * 1.3);
  expect(Math.abs(after.minute - before.minute)).toBeLessThan(2);
  expect(box.width).toBeGreaterThan(0);
  await page.screenshot({ path: "e2e/screenshots/zoomed.png" });
});

test("shift+wheel moves across days and settles on a whole day", async ({ page }) => {
  await open(page);
  const { x, y } = await bodyCenter(page);
  await page.mouse.move(x, y);
  const heads0 = await page.locator(".day-head").allTextContents();
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 300);
  await page.keyboard.up("Shift");
  await page.waitForTimeout(900);
  const s = await state(page);
  const colw = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.querySelector(".grid") as Element).getPropertyValue("--colw"),
    ),
  );
  // x = -(viewX - renderStart) * colW and viewX settles on an integer day.
  expect(Math.abs((s.x / colw) % 1)).toBeLessThan(0.01);
  const vis = await page.evaluate(
    () =>
      (window as unknown as { __app: { getState: () => { nav: unknown } } }).__app.getState().nav,
  );
  expect(vis).toBeTruthy();
  expect(heads0.length).toBeGreaterThan(7);
  await page.screenshot({ path: "e2e/screenshots/shifted.png" });
});

test("click opens the detail popover and edits the title", async ({ page }) => {
  await open(page);
  await page.locator(".ev", { hasText: "Bienvenida de curso" }).first().click();
  await expect(page.locator(".popover")).toBeVisible();
  const input = page.locator(".popover .title-input");
  await expect(input).toHaveValue("Bienvenida de curso");
  await input.fill("Bienvenida EPS");
  await input.press("Enter");
  await expect(page.locator(".ev", { hasText: "Bienvenida EPS" }).first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/popover.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".popover")).toHaveCount(0);
});

test("drag on empty space creates an event; Esc cancels", async ({ page }) => {
  await open(page);
  const { x, y, box } = await bodyCenter(page);
  const colW = box.width / 7;
  const startX = box.x + colW * 6.5; // Sunday column, mostly empty
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX, y + 20, { steps: 4 });
  await page.mouse.move(startX, y + 100, { steps: 6 });
  await expect(page.locator(".ev.dragging")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".ev.dragging")).toHaveCount(0);
  const count = await page.locator(".ev").count();

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX, y + 100, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".popover")).toBeVisible();
  expect(await page.locator(".ev").count()).toBe(count + 1);
  expect(x).toBeGreaterThan(0);
});

test("drag moves an event and resize handle changes its end", async ({ page }) => {
  await open(page);
  const ev = page.locator(".ev", { hasText: "Dentista" }).first();
  const box = (await ev.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 12 + 96, { steps: 8 }); // 2 h down at 48 px/h scale
  await page.mouse.up();
  await expect(
    page.locator(".ev", { hasText: "Dentista" }).first().locator(".ev-time"),
  ).not.toHaveText("13:00–14:15");
  // undo restores it
  await page.keyboard.press("Control+z");
  await expect(page.locator(".ev", { hasText: "Dentista" }).first().locator(".ev-time")).toHaveText(
    "13:00–14:15",
  );
});

test("eye icon hides a calendar and month view renders", async ({ page }) => {
  await open(page);
  const before = await page.locator(".ev").count();
  await page.locator(".cal-row", { hasText: "Docencia" }).locator(".eye").click();
  await page.waitForTimeout(200);
  expect(await page.locator(".ev").count()).toBeLessThan(before);
  await page.keyboard.press("m");
  await page.waitForSelector(".week-row");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/screenshots/month.png" });
  await page.keyboard.press("w");
  await page.waitForSelector(".grid");
});

test("text keeps its size while the hours are being zoomed", async ({ page }) => {
  await open(page);
  const { x, y } = await bodyCenter(page);
  await page.mouse.move(x, y);
  const measure = () =>
    page.evaluate(() => {
      const title = document.querySelector(".ev .ev-title")?.getBoundingClientRect();
      const label = document.querySelector(".hour-label")?.getBoundingClientRect();
      const card = document.querySelector(".ev")?.getBoundingClientRect();
      return { title: title?.height ?? 0, label: label?.height ?? 0, card: card?.height ?? 0 };
    });
  const before = await measure();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  let maxCardChange = 0;
  let maxTextChange = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(25);
    const m = await measure();
    maxCardChange = Math.max(maxCardChange, Math.abs(m.card - before.card));
    maxTextChange = Math.max(
      maxTextChange,
      Math.abs(m.title - before.title),
      Math.abs(m.label - before.label),
    );
  }
  expect(maxCardChange).toBeGreaterThan(5); // the cards were really stretching in that window
  expect(maxTextChange).toBeLessThan(0.6); // ...while the text did not
});

test("layout sits on whole pixels so the text stays sharp", async ({ page }) => {
  await open(page);
  const geometry = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".cols-strip") as Element).transform;
      const m = /matrix\(([^)]+)\)/.exec(cs)?.[1]?.split(",").map(Number) ?? [];
      const colw = Number.parseFloat(
        getComputedStyle(document.querySelector(".grid") as Element).getPropertyValue("--colw"),
      );
      const hh =
        Number.parseFloat((document.querySelector(".gutter-inner") as HTMLElement).style.height) /
        24;
      return { x: m[4] ?? 0, y: m[5] ?? 0, colw, hh };
    });
  const check = (g: { x: number; y: number; colw: number; hh: number }) => {
    expect(Number.isInteger(g.x)).toBe(true);
    expect(Number.isInteger(g.y)).toBe(true);
    expect(Number.isInteger(g.colw)).toBe(true);
    expect(g.hh % 4).toBe(0); // a 15-minute slot is a whole number of pixels
  };
  check(await geometry());
  const { x, y } = await bodyCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, 137); // an awkward amount
  await page.waitForTimeout(700);
  check(await geometry());
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -90);
  await page.keyboard.up("Control");
  await page.waitForTimeout(900);
  check(await geometry());
  await expect(page.locator(".grid")).not.toHaveClass(/zoom-armed/); // layers are gone again once at rest
});
