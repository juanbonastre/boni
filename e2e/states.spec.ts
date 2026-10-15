import { type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page, extra = "") {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid${extra}`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png` });

test("day, 3-day and light theme", async ({ page }) => {
  await open(page);
  await page.keyboard.press("d");
  await page.waitForTimeout(700);
  await shot(page, "state-day");
  await page.keyboard.press("3");
  await page.waitForTimeout(700);
  await shot(page, "state-3days");
  await page.evaluate(() => {
    (window as unknown as { __app: { getState: () => { setSettings: (p: object) => void } } }).__app
      .getState()
      .setSettings({ theme: "light" });
  });
  await page.keyboard.press("w");
  await page.waitForTimeout(700);
  await shot(page, "state-light-week");
  await page.keyboard.press("m");
  await page.waitForTimeout(700);
  await shot(page, "state-light-month");
});

test("detail panel, settings, palette, schema editor", async ({ page }) => {
  await open(page);
  await page.locator(".ev", { hasText: "Clase IPM" }).first().click();
  await page.locator(".popover button[title='Abrir como panel']").click();
  await page.waitForTimeout(400);
  await shot(page, "state-panel");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(300);
  await shot(page, "state-settings");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("clase FUP mañana 10-12 #docencia");
  await page.waitForTimeout(300);
  await shot(page, "state-palette");
  await page.keyboard.press("Escape");
  await page.locator(".cal-row", { hasText: "Docencia" }).hover();
  await page.locator(".cal-row", { hasText: "Docencia" }).locator(".gear").click();
  await page.waitForTimeout(300);
  await shot(page, "state-schema");
});

test("12 hour clock, second timezone, hidden sidebar, narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await open(page);
  await page.evaluate(() => {
    (window as unknown as { __app: { getState: () => { setSettings: (p: object) => void } } }).__app
      .getState()
      .setSettings({ h24: false, secondTz: "America/New_York", weekNumbers: true });
  });
  await page.keyboard.press("[");
  await page.waitForTimeout(700);
  await shot(page, "state-narrow");
});
