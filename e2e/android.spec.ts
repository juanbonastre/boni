import { expect, type Page, test } from "@playwright/test";
import { EXAMPLES } from "./fixtures.ts";

/**
 * The page inside the Android app: everything goes through a stand-in for `window.boniAndroid` (AndroidBridge.kt)
 * with its asynchronous call / __boniReply / take protocol. The app owns the login, the requests, the files and
 * the live connection; the page never sees the token.
 */
test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

async function openAndroid(page: Page, opts: { configured?: boolean } = {}) {
  await page.addInitScript(
    ({ examples, configured }) => {
      const w = window as unknown as Record<string, unknown>;
      const calls: string[] = [];
      const files = new Map<string, string>();
      const answers = new Map<string, string>();
      let settings = {
        serverUrl: configured ? "https://boni.example.ts.net" : "",
        hasToken: configured,
        user: configured ? "ejemplo" : "",
        device: configured ? "pixel" : "",
        legacyToken: false,
        sessionEnded: false,
        live: false,
        theme: "dark",
        language: "es",
        showWidgets: false,
        hiddenWidgets: [],
        autostart: false,
        layerAvailable: false,
      };
      const answer = (method: string, path: string): [number, string] => {
        const p = path.split("?")[0]!;
        const ok = (n: string): [number, string] => [200, examples[n]!];
        if (p.endsWith("/home")) return ok("home.json");
        if (p.endsWith("/screens/capture-expense")) return ok("screen-capture-expense.json");
        if (p.includes("/options/")) return ok("options-people.json");
        if (p.endsWith("/charts/catalog")) return ok("chart-catalog.json");
        if (p.endsWith("/charts") && method === "GET") return ok("charts.json");
        if (p.endsWith("/shortcuts") && method === "GET") return ok("shortcuts.json");
        if (p.endsWith("/widgets")) return ok("widgets.json");
        if (p.endsWith("/actions")) return ok("action-result-ok.json");
        if (p.includes("/data")) return ok("chart-eating-out.json");
        return [404, examples["error.json"]!];
      };
      const run = (method: string, a: unknown[]): unknown => {
        switch (method) {
          case "request":
            if (!settings.hasToken) return { ok: false, offline: false, notConfigured: true };
            {
              const [status, body] = answer(a[0] as string, a[1] as string);
              return { ok: true, status, body };
            }
          case "storeRead":
            return files.get(a[0] as string) ?? null;
          case "storeWrite":
            files.set(a[0] as string, a[1] as string);
            return null;
          case "storeRemove":
            files.delete(a[0] as string);
            return null;
          case "getSettings":
            return settings;
          case "setSettings":
            settings = { ...settings, ...JSON.parse(a[0] as string) };
            return settings;
          case "login": {
            const form = JSON.parse(a[0] as string);
            if (form.password !== "una-contrasena-larga") return { ok: false, code: "bad-login" };
            settings = {
              ...settings,
              serverUrl: form.serverUrl,
              hasToken: true,
              user: form.user,
              device: form.device,
            };
            return { ok: true, settings };
          }
          case "logout":
            settings = { ...settings, hasToken: false, user: "" };
            return settings;
          case "suggestedDevice":
            return "pixel 8";
          default:
            throw new Error(`Unknown call: ${method}`);
        }
      };
      w.boniAndroid = {
        call(id: string, method: string, args: string) {
          const a = JSON.parse(args) as unknown[];
          calls.push(
            `${method} ${method === "login" ? "(form)" : JSON.stringify(a).slice(0, 120)}`,
          );
          setTimeout(() => {
            try {
              answers.set(id, JSON.stringify({ ok: true, value: run(method, a) }));
            } catch (e) {
              answers.set(id, JSON.stringify({ ok: false, code: "failed", message: String(e) }));
            }
            (w.__boniReply as (id: string) => void)(id);
          }, 15);
        },
        take(id: string) {
          const v = answers.get(id) ?? "";
          answers.delete(id);
          return v;
        },
      };
      w.__androidCalls = calls;
      w.__androidFiles = files;
      w.__setLive = (live: boolean) => {
        settings = { ...settings, live };
        (w.__boniEvent as (j: string) => void)(JSON.stringify({ type: "settings", settings }));
      };
    },
    { examples: EXAMPLES, configured: opts.configured ?? true },
  );
  await page.goto("/?still");
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __androidCalls: string[] }).__androidCalls);

test("in the Android app the page talks only to the app: requests, files, settings", async ({
  page,
}) => {
  await openAndroid(page);
  await expect(page.locator(".m-shortcut")).toHaveCount(2);
  const list = await calls(page);
  expect(list.some((c) => c.startsWith('request ["GET","api/v1/home"'))).toBe(true);
  expect(list.some((c) => c.startsWith('storeWrite ["shortcuts.json"'))).toBe(true);
  // the live connection is the app's: "Offline" until it says it is up
  await expect(page.locator(".m-status")).toHaveText("Sin conexión");
  await page.evaluate(() =>
    (window as unknown as { __setLive: (v: boolean) => void }).__setLive(true),
  );
  await expect(page.locator(".m-status")).toHaveCount(0);
  // live changes and ticks come as events
  await page.evaluate(() =>
    (window as unknown as { __boniEvent: (j: string) => void }).__boniEvent(
      JSON.stringify({ type: "changed", what: "shortcuts" }),
    ),
  );
  await expect
    .poll(
      async () =>
        (await calls(page)).filter((c) => c.startsWith('request ["GET","api/v1/shortcuts"')).length,
    )
    .toBe(2);
});

test("Back asks the page: it closes one thing at a time, then lets the app go to the background", async ({
  page,
}) => {
  await openAndroid(page);
  const back = () =>
    page.evaluate(() => (window as unknown as { __boniBack: () => boolean }).__boniBack());
  await page.locator(".m-capture").tap();
  await expect(page.locator(".m-sheet")).toBeVisible();
  expect(await back()).toBe(true);
  await expect(page.locator(".m-sheet")).toHaveCount(0);
  await page.getByRole("button", { name: "Gráficas" }).tap();
  expect(await back()).toBe(true);
  await expect(page.locator(".m-title")).toHaveText("Apuntar");
  expect(await back()).toBe(false);
});

test("the first start logs in through the app (the password never stays in the page)", async ({
  page,
}) => {
  await openAndroid(page, { configured: false });
  await page.getByRole("button", { name: "Configurar servidor" }).tap();
  const form = page.locator(".modal .server-form");
  await expect(form.locator("input").nth(3)).toHaveValue("pixel 8");
  await form.locator("input").nth(0).fill("https://boni.example.ts.net");
  await form.locator("input").nth(1).fill("ejemplo");
  await form.locator("input").nth(2).fill("una-contrasena-larga");
  await form.locator("button[type=submit]").tap();
  await expect(page.locator(".modal")).toContainText("ejemplo");
  expect((await calls(page)).filter((c) => c.startsWith("login"))).toEqual(["login (form)"]);
});
