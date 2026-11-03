// What enters rises with one rule (docs/design-guide.md 4b «Motion», I-14): a page, the inbox's cards, a dialog; «reduce motion» turns it all off.
import { expect, type Page, test } from "@playwright/test";
import { ACCURACY, CARD_DETAILED } from "./agent-scenarios.ts";
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

test("the line at the top while a request is in flight, and the room kept in place (I-15); «reduce motion» keeps it still", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: { "GET api/agent/decisions": [ACCURACY] },
    slow: { path: "api/agent/decisions", ms: 1200 },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  await modal.getByRole("tab", { name: "Decisiones" }).click();
  // While the answer takes its time: the line on the top bar, the section's room kept, no «Sin decisiones».
  const line = page.locator(".topbar .wait-line");
  await expect(line).toBeVisible();
  await expect(modal.locator(".page-loading.short")).toBeVisible();
  await expect(modal.getByText("Sin decisiones")).toHaveCount(0);
  expect(await line.evaluate((e) => getComputedStyle(e, "::before").animationName)).toBe(
    "wait-slide",
  );
  // Answered: the rows, and the line goes.
  await expect(modal.locator(".settings-pane .setting")).toHaveCount(4);
  await expect(line).toHaveCount(0);
  // «Reduce motion»: the line stays, still.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await modal.getByRole("tab", { name: "Correo" }).click();
  await modal.getByRole("tab", { name: "Decisiones" }).click();
  await expect(line).toBeVisible();
  expect(await line.evaluate((e) => getComputedStyle(e, "::before").animationName)).toBe("none");
});
