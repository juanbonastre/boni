import { expect, type Page, test } from "@playwright/test";

/**
 * External calendars (iCal, read-only). The network is a test double (`window.boniNet`, like the
 * desktop shell's) serving an invented feed; `__net.fail` makes every download fail.
 */
const NOW = "2025-09-17T14:29";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Calendario inventado",
  "X-WR-TIMEZONE:Europe/Madrid",
  "BEGIN:VEVENT",
  "UID:fiesta@example.com",
  "DTSTART;VALUE=DATE:20250918",
  "DTEND;VALUE=DATE:20250919",
  "SUMMARY:Fiesta inventada",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:taller@example.com",
  "DTSTART;TZID=Europe/Madrid:20250915T190000",
  "DTEND;TZID=Europe/Madrid:20250915T200000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TH",
  "SUMMARY:Taller externo",
  "LOCATION:Sala de ejemplo",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

async function open(page: Page) {
  await page.addInitScript((feed) => {
    const net = { fail: false, asked: [] as string[] };
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    (window as any).__net = net;
    // biome-ignore lint/suspicious/noExplicitAny: test double of the desktop shell's downloader
    (window as any).boniNet = {
      fetchText: async (url: string) => {
        net.asked.push(url);
        if (net.fail || !url.includes("ejemplo"))
          return { ok: false, code: "fetch", message: "HTTP 404" };
        return { ok: true, value: feed };
      },
    };
  }, FEED);
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(300);
}

/** Occurrences of the weekly external event rendered (the grid renders a few days around the week). */
const taller = (page: Page) => page.locator(".ev", { hasText: "Taller externo" });

/** From the sidebar, or from Settings when it is already open. */
async function addCalendar(page: Page, name: string, url: string) {
  const inSettings = await page.locator(".modal").isVisible();
  await (inSettings
    ? page.locator(".ext-settings").getByRole("button", { name: "Añadir calendario externo" })
    : page.locator(".add-account")
  ).click();
  const form = page.locator(".ext-form");
  await expect(form).toBeVisible();
  await form.locator("input").first().fill(name);
  await form.locator("input").nth(1).fill(url);
  await form.getByRole("button", { name: "Añadir", exact: true }).click();
}

test("an iCal calendar is added in Settings and shows read-only next to the others", async ({
  page,
}) => {
  await open(page);
  await addCalendar(page, "Calendario de ejemplo", "webcal://example.com/ejemplo.ics");
  // webcal:// is downloaded as https://
  await expect
    .poll(() =>
      page.evaluate(() => (window as never as { __net: { asked: string[] } }).__net.asked),
    )
    .toEqual(["https://example.com/ejemplo.ics"]);
  await expect(
    page.locator(".ext-settings .setting", { hasText: "Calendario de ejemplo" }),
  ).toContainText(/\d+ eventos/);
  await page.screenshot({ path: "e2e/screenshots/external-settings.png" });
  await page.keyboard.press("Escape");

  await expect(page.locator(".account", { hasText: "Calendarios externos" })).toContainText(
    "Calendario de ejemplo",
  );
  await expect(page.locator(".bar", { hasText: "Fiesta inventada" })).toHaveCount(1);
  await expect(taller(page).first()).toBeVisible();
  const n = await taller(page).count();
  expect(n).toBeGreaterThanOrEqual(2); // Monday and Thursday at least
  await page.screenshot({ path: "e2e/screenshots/external.png" });

  // Read-only: it can be looked at, not deleted or moved.
  const ev = page.locator(".ev", { hasText: "Taller externo" }).first();
  await ev.click();
  // The detail shows everything and lets nothing change.
  await expect(page.locator(".popover .title-input")).toHaveValue("Taller externo");
  await expect(page.locator(".popover .title-input")).toBeDisabled();
  await expect(page.locator(".popover")).toContainText("Calendario de ejemplo");
  await page.keyboard.press("Escape");
  await ev.click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".toast")).toContainText("solo lectura");
  await expect(page.locator(".scrim")).toHaveCount(0);
  await expect(taller(page)).toHaveCount(n);
  await ev.click({ button: "right" });
  await expect(page.locator(".ctx")).toContainText(/solo lectura/i);
  await page.keyboard.press("Escape");

  // The eye hides it.
  await page.locator(".cal-row", { hasText: "Calendario de ejemplo" }).locator(".eye").click();
  await expect(taller(page)).toHaveCount(0);
  await page.locator(".cal-row", { hasText: "Calendario de ejemplo" }).locator(".eye").click();
  await expect(taller(page)).toHaveCount(n);
});

test("the last copy shows without a connection, and a failed download says so", async ({
  page,
}) => {
  await open(page);
  await addCalendar(page, "Calendario de ejemplo", "https://example.com/ejemplo.ics");
  await expect(page.locator(".ext-settings")).toContainText(/\d+ eventos/);
  await page.keyboard.press("Escape");
  await expect(taller(page).first()).toBeVisible();
  // The copy is saved a moment after the download: wait for it before starting again.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const dbs = await indexedDB.databases();
        if (!dbs.some((d) => d.name === "boni-calendar-external")) return 0;
        return new Promise<number>((resolve) => {
          const req = indexedDB.open("boni-calendar-external");
          req.onerror = () => resolve(0);
          req.onsuccess = () => {
            const db = req.result;
            try {
              const n = db.transaction("feeds").objectStore("feeds").count();
              n.onsuccess = () => {
                db.close();
                resolve(n.result);
              };
              n.onerror = () => resolve(0);
            } catch {
              db.close();
              resolve(0);
            }
          };
        });
      }),
    )
    .toBeGreaterThan(0);

  // Offline on the next start: the saved copy is shown and Settings tells why it is not fresh.
  await page.addInitScript(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const w = window as any;
    const wait = setInterval(() => {
      if (w.__net) {
        w.__net.fail = true;
        clearInterval(wait);
      }
    }, 0);
  });
  await page.reload();
  await page.waitForSelector(".ev");
  await expect(taller(page).first()).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(page.locator(".ext-settings")).toContainText("No se pudo descargar");

  // A wrong address: an error, nothing shown, and it can be removed.
  await addCalendar(page, "Mal", "https://example.com/otra.ics");
  await expect(page.locator(".ext-settings .setting", { hasText: "Mal" })).toContainText(
    "No se pudo descargar",
  );
  await page.locator(".ext-settings .setting", { hasText: "Mal" }).getByTitle("Quitar").click();
  await expect(page.locator(".ext-settings .setting", { hasText: "Mal" })).toHaveCount(0);
});

test("external events never become notes of the vault", async ({ page }) => {
  await page.addInitScript((feed) => {
    const ok = (value: unknown) => ({ ok: true, value });
    const writes: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    (window as any).__writes = writes;
    // biome-ignore lint/suspicious/noExplicitAny: test double of the desktop shell
    (window as any).boniNet = { fetchText: async () => ok(feed) };
    // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge
    (window as any).boniVault = {
      getRoot: async () => ok("/vault/vacio"),
      chooseRoot: async () => ok("/vault/vacio"),
      scan: async () => ok([]),
      read: async () => ({ ok: false, code: "not-found", message: "x" }),
      write: async (p: string) => {
        writes.push(`write ${p}`);
        return ok({ conflict: false, mtimeMs: 1, size: 1 });
      },
      create: async (p: string) => {
        writes.push(`create ${p}`);
        return ok({ exists: false, mtimeMs: 1, size: 1 });
      },
      trash: async (p: string) => {
        writes.push(`trash ${p}`);
        return ok(null);
      },
    };
    localStorage.setItem("boni-calendar:settings", JSON.stringify({ vaultWrite: true }));
  }, FEED);
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.locator(".vault-notice").waitFor();
  await addCalendar(page, "Calendario de ejemplo", "https://example.com/ejemplo.ics");
  await page.keyboard.press("Escape");
  await expect(taller(page).first()).toBeAttached();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
  await expect(taller(page).first()).toBeAttached();
  expect(await page.evaluate(() => (window as never as { __writes: string[] }).__writes)).toEqual(
    [],
  );
});
