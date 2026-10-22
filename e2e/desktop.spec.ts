import { expect, test } from "@playwright/test";

/**
 * The desktop app's own settings (a stand-in for `window.boniDesktop`, apps/calendar-desktop/preload.cjs):
 * keep running in the tray when the window closes, open at login; the tray menu gets the app's words.
 */
test("Settings → Desktop keeps running in the tray and can open at login", async ({ page }) => {
  await page.addInitScript(() => {
    const prefs = { background: true, autostart: false, boniUrl: "" };
    const calls: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const w = window as any;
    w.__desktop = { calls, prefs };
    w.boniDesktop = {
      getPrefs: async () => ({ ...prefs }),
      setPrefs: async (patch: Partial<typeof prefs>) => {
        calls.push(patch);
        if (patch.boniUrl !== undefined && patch.boniUrl && !patch.boniUrl.startsWith("https://"))
          return { ok: false, message: "Bad address" };
        Object.assign(prefs, patch);
        return { ok: true, value: { ...prefs } };
      },
      setLabels: (labels: unknown) => calls.push({ labels }),
    };
  });
  await page.goto("/?now=2025-09-17T14:29&tz=Europe/Madrid");
  await page.waitForSelector(".ev");
  const calls = () =>
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    page.evaluate(() => (window as any).__desktop.calls as unknown[]);
  await expect
    .poll(calls)
    .toContainEqual({ labels: { open: "Abrir Boni Calendar", quit: "Salir" } });

  await page.keyboard.press("Control+,");
  const section = page.locator(".desktop-settings");
  await expect(section).toContainText("Seguir en segundo plano");
  const autostart = section.locator(".setting", { hasText: "Abrir al iniciar sesión" });
  await expect(autostart.getByRole("radio", { name: "No" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await autostart.getByRole("radio", { name: "Sí" }).click();
  await expect(autostart.getByRole("radio", { name: "Sí" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(await calls()).toContainEqual({ autostart: true });
  // Boni's address: with it, a double click opens an event's note in the calendar's own small window.
  const boni = section.locator(".setting", { hasText: "Dirección de Boni" }).locator("input");
  await boni.fill("http://boni.example.net");
  await boni.press("Enter");
  await expect(boni).toHaveAttribute("aria-invalid", "true");
  await expect(section).toContainText("Tiene que empezar por https://");
  await boni.fill("https://boni.example.ts.net");
  await boni.press("Enter");
  await expect(boni).toHaveAttribute("aria-invalid", "false");
  expect(await calls()).toContainEqual({ boniUrl: "https://boni.example.ts.net" });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "e2e/screenshots/desktop-settings.png" });
});

test("without the desktop app there is no Desktop section", async ({ page }) => {
  await page.goto("/?now=2025-09-17T14:29&tz=Europe/Madrid");
  await page.waitForSelector(".ev");
  await page.keyboard.press("Control+,");
  await expect(page.locator(".modal")).toContainText("Avisos");
  await expect(page.locator(".desktop-settings")).toHaveCount(0);
});
