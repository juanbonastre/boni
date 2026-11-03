// What enters rises with one rule (docs/design-guide.md 4b «Motion», I-14): a page, the inbox's cards, a dialog; «reduce motion» turns it all off.
import { expect, type Page, test } from "@playwright/test";
import { CARD_DETAILED } from "./agent-scenarios.ts";
import { openApp } from "./fixtures.ts";

const animationOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((e) => getComputedStyle(e).animationName);

test("what enters rises with one rule: a page (again when another takes its place), the inbox's cards, a dialog; «reduce motion» turns it off", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: { "GET api/agent/proposals": [{ proposals: [CARD_DETAILED] }] },
  });
  await expect(page.locator(".sidebar .page-row")).toHaveCount(1);
  expect(await animationOf(page, ".main > .content")).toMatch(/^rise-in/);
  // The same node starts again when another page is shown in its place (App.tsx flips `data-enter`).
  const before = await page.locator(".main").getAttribute("data-enter");
  await page.getByRole("button", { name: "Nueva página" }).click();
  await expect(page.locator(".sidebar .page-row")).toHaveCount(2);
  expect(await page.locator(".main").getAttribute("data-enter")).not.toBe(before);
  expect(await animationOf(page, ".main > .content")).toMatch(/^rise-in/);
  // The inbox's cards (50 ms apart), a dialog.
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const card = page.locator(".inbox-panel .inbox-card").first();
  await expect(card).toBeVisible();
  expect(await card.evaluate((e) => getComputedStyle(e).animationName)).toBe("rise-in");
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  expect(await animationOf(page, ".modal")).toBe("rise-in");
  expect(await animationOf(page, ".settings-pane")).toBe("rise-in");
  await page.keyboard.press("Escape");
  // «Reduce motion»: nothing moves.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  expect(await animationOf(page, ".modal")).toBe("none");
  expect(await animationOf(page, ".main > .content")).toBe("none");
  expect(await card.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});
