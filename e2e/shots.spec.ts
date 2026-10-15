import { test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

test("screenshots", async ({ page }) => {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(600);
  await page.screenshot({ path: "e2e/screenshots/week.png" });
});
