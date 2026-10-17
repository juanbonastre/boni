import { expect, type Page, test } from "@playwright/test";

/**
 * Reminders (phase 5): per calendar in Settings, per event in its detail, and handed to the host as
 * notifications (a test double of the desktop shell's `boniNotify`).
 */
const NOW = "2025-09-17T14:29";

type Notice = { id: string; eventId: string; at: number; title: string; body: string };

async function open(page: Page) {
  await page.addInitScript(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test double of the desktop shell
    const w = window as any;
    w.__notices = null;
    w.boniNotify = {
      schedule: (list: unknown) => {
        w.__notices = list;
      },
      onOpen: (cb: (id: string) => void) => {
        w.__openNotice = cb;
      },
    };
  });
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
}

const notices = (page: Page) =>
  // biome-ignore lint/suspicious/noExplicitAny: test hooks
  page.evaluate(() => (window as any).__notices as Notice[] | null);

test("a calendar's reminders are chosen in Settings and its events become notifications", async ({
  page,
}) => {
  await open(page);
  await expect.poll(() => notices(page)).toEqual([]); // no calendar reminds by default

  // From the calendar's menu: Settings opens on Reminders.
  await page.locator(".cal-row", { hasText: "Docencia" }).click({ button: "right" });
  await page.locator(".ctx").getByRole("menuitem", { name: "Avisos…" }).click();
  const block = page.locator(".reminder-cal", { hasText: "Docencia" });
  await expect(block).toBeInViewport();
  await block.locator(".setting", { hasText: "Eventos con hora" }).locator(".choice-btn").click();
  await page.locator(".choice-menu .menu-item", { hasText: "10 min antes" }).click();
  await block.locator(".reminder-cal-name").click(); // closes the menu, not Settings
  await expect(block.locator(".setting", { hasText: "Eventos con hora" })).toContainText(
    "10 min antes",
  );
  await page.screenshot({ path: "e2e/screenshots/reminders-settings.png" });
  await page.keyboard.press("Escape");

  // The next 48 hours of Docencia, worded, ten minutes before each.
  await expect.poll(async () => (await notices(page))?.length ?? 0).toBeGreaterThan(0);
  const list = (await notices(page)) as Notice[];
  const fup = list.find((n) => n.title === "Clase FUP");
  expect(fup?.body).toBe("Vie 19 Sept, 11:00–13:00 · Aula A-201");
  expect(fup?.at).toBe(Date.UTC(2025, 8, 19, 8, 50)); // 10:50 in Madrid

  // Clicking the notification shows that event.
  await page.evaluate((id) => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    (window as any).__openNotice(id);
  }, fup?.eventId);
  await expect(page.locator(".popover .title-input")).toHaveValue("Clase FUP");
});

test("an event can have its own reminders, or none, instead of its calendar's", async ({
  page,
}) => {
  await open(page);
  await page.locator(".ev", { hasText: "Dentista" }).first().click();
  const row = page.locator(".popover .prop-row", { hasText: "Avisos" });
  await expect(row).toContainText("Como el calendario (Sin avisos)");
  await row.locator(".choice-btn").click();
  await page.locator(".choice-menu .menu-item", { hasText: "1 h antes" }).click();
  await page.keyboard.press("Escape");
  await expect(row).toContainText("1 h antes");
  const own = () =>
    page.evaluate(
      () =>
        // biome-ignore lint/suspicious/noExplicitAny: test hooks
        (window as any).__app
          .getState()
          .data.events.find((e: { title: string }) => e.title === "Dentista").reminders,
    );
  expect(await own()).toEqual([{ kind: "before", minutes: 60 }]);
  await page.screenshot({ path: "e2e/screenshots/reminders-event.png" });

  await row.locator(".choice-btn").click();
  await page.locator(".choice-menu .menu-item", { hasText: "Como el calendario" }).click();
  await expect(row).toContainText("Como el calendario");
  expect(await own()).toBeUndefined();
});
