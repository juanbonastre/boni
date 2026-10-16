import { expect, type Locator, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

const ev = (page: Page, text: string): Locator => page.locator(".ev", { hasText: text }).first();
const clickWith = async (page: Page, target: Locator, keys: ("Control" | "Shift")[]) => {
  for (const k of keys) await page.keyboard.down(k);
  await target.click({ modifiers: keys });
  for (const k of keys) await page.keyboard.up(k);
};
const selected = (page: Page) => page.locator(".ev.selected");
const startMinute = async (l: Locator) => {
  const t = (await l.locator(".ev-time").textContent()) ?? "";
  const [h = 0, m = 0] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

test("Ctrl+Shift+click adds and removes events from the selection", async ({ page }) => {
  await open(page);
  await ev(page, "Clase IPM").click();
  await expect(page.locator(".popover")).toBeVisible();
  await clickWith(page, ev(page, "Dentista"), ["Control", "Shift"]);
  await expect(selected(page)).toHaveCount(2);
  await expect(page.locator(".popover")).toHaveCount(0);
  await expect(page.locator(".selbar-count")).toHaveText("2 seleccionados");
  await clickWith(page, ev(page, "Dentista"), ["Control", "Shift"]);
  await expect(selected(page)).toHaveCount(1);
  await expect(page.locator(".selbar")).toHaveCount(0);
});

test("Shift+click adds every event between the anchor and the clicked one", async ({ page }) => {
  await open(page);
  await ev(page, "Clase FUP").click();
  await clickWith(page, ev(page, "Clase IPM"), ["Shift"]);
  for (const title of [
    "Clase FUP",
    "Dentista",
    "Gimnasio",
    "Clase de yoga",
    "Llamar al banco",
    "Clase IPM",
  ]) {
    await expect(ev(page, title)).toHaveClass(/selected/);
  }
  await expect(ev(page, "Estudio")).not.toHaveClass(/selected/); // after Clase IPM
  await expect(ev(page, "Tren a la universidad")).not.toHaveClass(/selected/);
  await page.screenshot({ path: "e2e/screenshots/multi-range.png" });
});

test("Ctrl+click on an event without a note just selects it (with a note it opens the note)", async ({
  page,
}) => {
  await open(page);
  await ev(page, "Clase FUP").click();
  await clickWith(page, ev(page, "Dentista"), ["Control"]);
  await expect(selected(page)).toHaveCount(1);
  await expect(ev(page, "Dentista")).toHaveClass(/selected/);
  await expect(page.locator(".popover")).toBeVisible();
});

test("holding Shift fades the detail so events under it can be clicked, but not while typing", async ({
  page,
}) => {
  await open(page);
  await ev(page, "Dentista").click();
  const root = page.locator("#root");
  await page.locator(".popover .title-input").focus();
  await page.keyboard.down("Shift");
  await expect(root).not.toHaveClass(/mod-select/);
  await page.keyboard.up("Shift");
  await page.locator(".popover .title-input").blur();
  await page.keyboard.down("Shift");
  await expect(root).toHaveClass(/mod-select/);
  await page.keyboard.up("Shift");
  await expect(root).not.toHaveClass(/mod-select/);
});

test("dragging one selected event moves the whole selection", async ({ page }) => {
  await open(page);
  const dentist = ev(page, "Dentista");
  const gym = ev(page, "Gimnasio");
  const before = [await startMinute(dentist), await startMinute(gym)];
  await dentist.click();
  await gym.click({ modifiers: ["Control", "Shift"] });
  const box = await gym.boundingBox();
  if (!box) throw new Error("no box");
  await page.mouse.move(box.x + box.width / 2, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 14 - 90, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Todos los eventos" }).click(); // Gimnasio is a weekly series
  const after = [await startMinute(ev(page, "Dentista")), await startMinute(ev(page, "Gimnasio"))];
  const d0 = (after[0] ?? 0) - (before[0] ?? 0);
  const d1 = (after[1] ?? 0) - (before[1] ?? 0);
  expect(d1).toBeLessThan(0);
  expect(d0).toBe(d1); // both moved by the same amount
  await expect(selected(page)).toHaveCount(2); // selection survives the drag
  await page.keyboard.press("Control+z");
  expect(await startMinute(ev(page, "Gimnasio"))).toBe(before[1]); // a single undo step reverts both
  expect(await startMinute(ev(page, "Dentista"))).toBe(before[0]);
});

test("Delete removes the selection, undo brings it back, Esc and empty clicks clear it", async ({
  page,
}) => {
  await open(page);
  const count = await page.locator(".ev").count();
  await ev(page, "Dentista").click();
  await clickWith(page, ev(page, "Gimnasio"), ["Control", "Shift"]);
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Solo este evento" }).click(); // Gimnasio is a weekly series
  await expect(page.locator(".ev")).toHaveCount(count - 2);
  await expect(page.locator(".toast")).toContainText("2 eventos eliminados");
  await page.locator(".toast button").click();
  await expect(page.locator(".ev")).toHaveCount(count);

  await ev(page, "Dentista").click();
  await clickWith(page, ev(page, "Gimnasio"), ["Control", "Shift"]);
  await page.keyboard.press("Escape");
  await expect(selected(page)).toHaveCount(0);

  await ev(page, "Dentista").click();
  await clickWith(page, ev(page, "Gimnasio"), ["Control", "Shift"]);
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (!cols) throw new Error("no grid");
  await page.mouse.click(cols.x + (cols.width / 7) * 5.5, cols.y + 300); // empty space
  await expect(selected(page)).toHaveCount(0);
});

test("Ctrl+A selects everything visible; right click acts on all of it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+a");
  const n = await page.locator(".selbar-count").textContent();
  expect(Number.parseInt(n ?? "0", 10)).toBeGreaterThan(20);
  await ev(page, "Dentista").click({ button: "right" });
  await expect(
    page.locator(".ctx").getByRole("menuitem", { name: /Eliminar \(\d+\)/ }),
  ).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/multi-context.png" });
});

test("multi-selection works in the month view too", async ({ page }) => {
  await open(page);
  await page.keyboard.press("m");
  await page.waitForSelector(".mchip");
  await page.waitForTimeout(600);
  await page.locator(".mchip", { hasText: "Dentista" }).click();
  await clickWith(page, page.locator(".mchip", { hasText: "Clase de yoga" }), ["Control", "Shift"]);
  await expect(page.locator(".mchip.selected")).toHaveCount(2);
  await expect(page.locator(".selbar-count")).toHaveText("2 seleccionados");
});

test("focusing or scrolling to off-screen items never shifts the grid", async ({ page }) => {
  await open(page);
  const before = await page.evaluate(
    () => document.querySelector(".cols-viewport")?.scrollLeft ?? -1,
  );
  await page.evaluate(() => {
    const far = [...document.querySelectorAll<HTMLElement>(".day-head")].pop();
    far?.focus();
    far?.scrollIntoView();
  });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({
    cols: document.querySelector(".cols-viewport")?.scrollLeft ?? -1,
    head: document.querySelector(".head-viewport")?.scrollLeft ?? -1,
    grid: document.querySelector(".grid")?.scrollTop ?? -1,
  }));
  expect(before).toBe(0);
  expect(after).toEqual({ cols: 0, head: 0, grid: 0 });
});
