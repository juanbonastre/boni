import { expect, test } from "@playwright/test";

/**
 * The page inside the Android app (a stand-in for `window.boniAndroid`, apps/android/AndroidBridge.kt):
 * without GrapheneOS's "Network" permission, Settings says so and opens the app's permissions.
 */
test("without network permission, Settings says so and opens the app's permissions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const answers: Record<string, unknown> = { getRoot: null, networkAllowed: false };
    const box = new Map<string, string>();
    const asked: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    (window as any).__asked = asked;
    // biome-ignore lint/suspicious/noExplicitAny: stand-in for the Android app's bridge
    (window as any).boniAndroid = {
      call(id: string, method: string) {
        asked.push(method);
        box.set(id, JSON.stringify({ ok: true, value: answers[method] ?? null }));
        // biome-ignore lint/suspicious/noExplicitAny: test hooks
        setTimeout(() => (window as any).__boniReply(id));
      },
      take(id: string) {
        return box.get(id) ?? "";
      },
    };
  });
  await page.goto("/?now=2025-09-17T14:29&tz=Europe/Madrid");
  await page.locator(".vault-notice").waitFor();
  await page.keyboard.press("Control+,");
  await page
    .locator(".modal .setting", { hasText: "Origen" })
    .getByRole("radio", { name: "Servidor" })
    .click();
  const hint = page.locator(".modal .network-hint");
  await expect(hint).toContainText("no tiene permiso de red");
  await hint.getByRole("button", { name: "Abrir permisos" }).click();
  await expect
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    .poll(() => page.evaluate(() => (window as any).__asked as string[]))
    .toContain("openAppSettings");
  await page.screenshot({ path: "e2e/screenshots/android-network.png" });
});
