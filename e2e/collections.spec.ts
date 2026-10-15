import { expect, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

async function open(page: Page) {
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

// biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
const state = (page: Page) => page.evaluate(() => (window as any).__app.getState());

type RowLike = { id: string; collectionId: string; values: Record<string, unknown> };
const rowOf = (page: Page, title: string) =>
  page.evaluate((t) => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const rows = (window as any).__app.getState().rows as RowLike[];
    const r = rows.find((x) => x.values.title === t);
    return r ? { id: r.id, collectionId: r.collectionId, values: r.values } : null;
  }, title);

test("rows are the truth: editing an event rewrites the row's columns, undo restores them", async ({
  page,
}) => {
  await open(page);
  // "Dentista" lives in a collection whose date and time are separate columns.
  const before = await rowOf(page, "Dentista");
  expect(before?.collectionId).toBe("health");
  expect(before?.values).toMatchObject({
    date: "2025-09-15",
    startTime: "13:00",
    endTime: "14:15",
  });
  expect(before?.values.completed ?? null).toBeNull();

  await page.locator(".ev", { hasText: "Dentista" }).first().click();
  await page.locator(".popover").getByRole("radio", { name: "Tarea" }).click();
  await page.locator(".popover .prop-row", { hasText: "Hecha" }).locator("input").check();
  const done = await rowOf(page, "Dentista");
  expect(done?.values.completed).toBe(true);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  const undone = await rowOf(page, "Dentista");
  expect(undone?.values.completed ?? null).toBeNull();
});

test("a calendar that keeps ISO start and end columns stores them as instants", async ({
  page,
}) => {
  await open(page);
  const gym = await rowOf(page, "Gimnasio");
  expect(gym?.collectionId).toBe("sport");
  expect(gym?.values.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(gym?.values.date).toBeUndefined();
});

test("hiding a calendar keeps the events array, changing a property list updates the columns", async ({
  page,
}) => {
  await open(page);
  const eventsBefore = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const w = window as any;
    w.__eventsRef = w.__app.getState().data.events;
    return w.__eventsRef.length;
  });
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    (window as any).__app.getState().toggleCalendar("sport");
  });
  const same = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const w = window as any;
    return w.__app.getState().data.events === w.__eventsRef;
  });
  expect(same).toBe(true);
  expect(eventsBefore).toBeGreaterThan(100);

  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    (window as any).__app
      .getState()
      .setSchema("sport", [{ id: "intensity", name: "Intensidad", type: "text" }]);
  });
  const s = await state(page);
  const cols = s.collections
    .find((c: { id: string }) => c.id === "sport")
    .columns.map((c: { id: string }) => c.id);
  expect(cols).toContain("start");
  expect(cols).toContain("intensity");
  expect(cols).not.toContain("kind");
});
