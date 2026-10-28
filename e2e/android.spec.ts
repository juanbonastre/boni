import { expect, test } from "@playwright/test";

/**
 * The page inside the Android app (a stand-in for `window.boniAndroid`, apps/calendar-android/AndroidBridge.kt):
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
  await page.waitForSelector(".ev");
  await page.keyboard.press("Control+,");
  const hint = page.locator(".modal .network-hint");
  await expect(hint).toContainText("no tiene permiso de red");
  await hint.getByRole("button", { name: "Abrir permisos" }).click();
  await expect
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    .poll(() => page.evaluate(() => (window as any).__asked as string[]))
    .toContain("openAppSettings");
  await page.screenshot({ path: "e2e/screenshots/android-network.png" });
});

/** The Android app's stand-in, recording every call and its arguments. */
async function fakeAndroid(
  page: import("@playwright/test").Page,
  answers: Record<string, unknown>,
) {
  await page.addInitScript((answers) => {
    const box = new Map<string, string>();
    const calls: [string, unknown[]][] = [];
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    (window as any).__calls = calls;
    // biome-ignore lint/suspicious/noExplicitAny: stand-in for the Android app's bridge
    (window as any).boniAndroid = {
      call(id: string, method: string, args: string) {
        calls.push([method, JSON.parse(args)]);
        box.set(id, JSON.stringify({ ok: true, value: answers[method] ?? null }));
        // biome-ignore lint/suspicious/noExplicitAny: test hooks
        setTimeout(() => (window as any).__boniReply(id));
      },
      take: (id: string) => box.get(id) ?? "",
    };
  }, answers);
}
const calls = (page: import("@playwright/test").Page) =>
  // biome-ignore lint/suspicious/noExplicitAny: test hooks
  page.evaluate(() => (window as any).__calls as [string, unknown[]][]);

test("on Android the page hands its reminders to the app, and asks which notification opened it", async ({
  page,
}) => {
  await fakeAndroid(page, { getRoot: null, networkAllowed: true });
  await page.goto("/?now=2025-09-17T14:29&tz=Europe/Madrid");
  await expect
    .poll(async () => (await calls(page)).find(([m]) => m === "scheduleNotices")?.[1])
    .toEqual(["[]"]);
  expect((await calls(page)).map(([m]) => m)).toContain("takeOpenEvent");
});

test("on Android with a server, the app is told how to fetch its reminders itself", async ({
  page,
}) => {
  await fakeAndroid(page, { getRoot: null, networkAllowed: true });
  await page.addInitScript(() => {
    localStorage.setItem(
      "boni-calendar:settings",
      JSON.stringify({ server: { url: "http://127.0.0.1:9", user: "juan" }, h24: true }),
    );
    localStorage.setItem("boni-calendar:server-token", "token-inventado");
  });
  await page.goto("/?now=2025-09-17T14:29&tz=Europe/Madrid");
  await expect
    .poll(async () => (await calls(page)).find(([m]) => m === "serverSync")?.[1]?.[0])
    .toBe(
      JSON.stringify({
        url: "http://127.0.0.1:9",
        token: "token-inventado",
        tz: "Europe/Madrid",
        locale: "es",
        h24: true,
      }),
    );
  expect((await calls(page)).map(([m]) => m)).not.toContain("scheduleNotices");
});
