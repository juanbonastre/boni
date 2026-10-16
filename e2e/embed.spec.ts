import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The app mounted inside another app (`apps/web/embed.html`), the way the Obsidian plugin mounts it:
 * in a pane that is smaller than the window, next to the other app's own controls, by default inside
 * a shadow root. The other app's page has global rules and class names that clash with ours.
 */
const NOW = "2025-09-17T14:29";

async function open(page: Page, shadow = true) {
  await page.goto(`/embed.html?now=${NOW}&tz=Europe/Madrid${shadow ? "" : "&shadow=0"}`);
  await page.locator(".ev").first().waitFor();
  await page.waitForTimeout(400);
}

const view = (page: Page) =>
  // biome-ignore lint/suspicious/noExplicitAny: test hook
  page.evaluate(() => (window as any).__app.getState().view as string);

type Box = { x: number; y: number; width: number; height: number };
async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}
function expectInside(inner: Box, outer: Box) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
}

test("inside another app the shortcuts work only while the calendar has the focus", async ({
  page,
}) => {
  await open(page);
  expect(await view(page)).toBe("week");

  // Typing in the other app, or pressing keys after clicking it, never reaches the calendar.
  await page.locator("#host-input").click();
  await page.keyboard.press("m");
  await expect(page.locator("#host-input")).toHaveValue("m");
  await page.locator("#host-side").click();
  await page.keyboard.press("m");
  expect(await view(page)).toBe("week");

  // A press anywhere in the calendar gives it the focus.
  await page.locator(".title").click();
  await page.keyboard.press("m");
  expect(await view(page)).toBe("month");
  await page.keyboard.press("w");
  expect(await view(page)).toBe("week");

  // Esc clears a selection and the focus stays in the calendar.
  await page.locator(".ev", { hasText: "Clase FUP" }).first().click();
  await expect(page.locator(".popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".popover")).toHaveCount(0);
  await page.keyboard.press("d");
  expect(await view(page)).toBe("day");

  // Leaving it for the other app stops them again.
  await page.locator("#host-side").click();
  await page.keyboard.press("w");
  expect(await view(page)).toBe("day");
});

for (const shadow of [true, false]) {
  test(`popovers, menus and dialogs stay inside the calendar's pane (${shadow ? "shadow root" : "plain page"})`, async ({
    page,
  }) => {
    await open(page, shadow);
    const pane = await box(page.locator("#pane"));

    // The event detail sits next to its event, inside the pane.
    await page.locator(".ev", { hasText: "Clase FUP" }).first().click();
    await expect(page.locator(".popover")).toBeVisible();
    expectInside(await box(page.locator(".popover")), pane);
    await page.keyboard.press("Escape");

    // A right click near the pane's bottom right corner opens the menu inside the pane.
    await page.mouse.click(pane.x + pane.width - 30, pane.y + pane.height - 30, {
      button: "right",
    });
    await expect(page.locator(".ctx")).toBeVisible();
    expectInside(await box(page.locator(".ctx")), pane);
    await page.keyboard.press("Escape");
    await expect(page.locator(".ctx")).toHaveCount(0);

    // Right clicks outside the calendar are left to the other app.
    await page.locator("#host-side").click({ button: "right" });
    await expect(page.locator(".ctx")).toHaveCount(0);

    // Dialogs cover the pane, not the window.
    await page.locator(".title").click();
    await page.keyboard.press("Control+,");
    await expect(page.locator(".scrim")).toBeVisible();
    expect(await box(page.locator(".scrim"))).toEqual(pane);
    expectInside(await box(page.locator(".modal")), pane);
    await page.keyboard.press("Escape");
    await expect(page.locator(".scrim")).toHaveCount(0);
  });
}

test("the calendar's styles and the other app's stay apart", async ({ page }) => {
  await open(page);
  const style = (l: Locator, prop: string) =>
    l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

  // Ours never reach the other app: its button keeps its look, its page keeps its theme and language.
  const hostButton = page.locator("#host-button");
  expect(await style(hostButton, "background-color")).toBe("rgb(255, 0, 0)");
  expect(await style(hostButton, "padding-left")).toBe("12px");
  expect(await style(page.locator("body"), "font-family")).toContain("Georgia");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");

  // The other app's rules (button, .btn, .menu, .popover, *) never reach ours.
  const today = page.getByRole("button", { name: "Hoy", exact: true });
  expect(await style(today, "background-color")).not.toBe("rgb(0, 255, 0)");
  expect(await style(today, "box-sizing")).toBe("border-box");
  await page.locator(".view-picker .pill").click();
  const menu = page.locator(".view-menu");
  await expect(menu).toBeVisible();
  expect(await style(menu, "background-color")).not.toBe("rgb(0, 255, 0)");
  expect(await style(menu, "font-size")).not.toBe("30px");
  await page.keyboard.press("Escape");

  // The theme follows the calendar's own setting, on its own root.
  await page.evaluate(() =>
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    (window as any).__app.getState().setSettings({ theme: "light" }),
  );
  await expect(page.locator(".boni")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  await page.screenshot({ path: "e2e/screenshots/embedded.png" });
});
