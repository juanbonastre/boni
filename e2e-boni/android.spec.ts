import { expect, type Page, test } from "@playwright/test";
import { audit } from "./audit.ts";
import { EXAMPLES } from "./fixtures.ts";

/**
 * The page inside the Android app: everything goes through a stand-in for `window.boniAndroid` (AndroidBridge.kt)
 * with its asynchronous call / __boniReply / take protocol. The app owns the login, the requests, the files and
 * the live connection; the page never sees the token.
 */
test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

async function openAndroid(
  page: Page,
  opts: {
    configured?: boolean;
    launch?: string;
    url?: string;
    examples?: Record<string, string>;
    /** Routes this server does not have yet (an older version): FastAPI's own 404. */
    missing?: string[];
    /** What the device kept unsent at the start (`unsent.json`). */
    unsent?: unknown[];
    /** No connection at the start. */
    offline?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ examples, configured, launch, missing, unsent, offline }) => {
      const w = window as unknown as Record<string, unknown>;
      const calls: string[] = [];
      const files = new Map<string, string>();
      if (unsent) files.set("unsent.json", JSON.stringify(unsent));
      // No connection while it is true (`__offline`).
      w.__offline = offline;
      const answers = new Map<string, string>();
      const turns: unknown[] = [];
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
        if (missing.some((m) => p.endsWith(m))) return [404, '{"detail":"Not Found"}'];
        const ok = (n: string): [number, string] => [200, examples[n]!];
        if (p.endsWith("/home")) return ok("home.json");
        if (p.endsWith("/screens/capture-expense")) return ok("screen-capture-expense.json");
        if (p.includes("/options/")) return ok("options-people.json");
        if (p.endsWith("/charts/catalog")) return ok("chart-catalog.json");
        if (p.endsWith("/charts") && method === "GET") return ok("charts.json");
        if (p.endsWith("/shortcuts") && method === "GET") return ok("shortcuts.json");
        if (p.endsWith("/widgets")) return ok("widgets.json");
        if (p.endsWith("/actions")) return ok("action-result-ok.json");
        if (p.includes("spending-by-category") && p.includes("/data"))
          return ok(
            path.includes("drill=")
              ? "chart-spending-by-category-drill.json"
              : "chart-spending-by-category.json",
          );
        // A record Boni Calendar opens in Boni («Abrir en Boni»), invented.
        if (p === "api/data/types")
          return [
            200,
            JSON.stringify({
              types: [
                {
                  id: "t_tarea",
                  name: "Tarea",
                  icon: "",
                  titleField: "f_titulo",
                  count: 1,
                  level: "visible",
                  fields: [
                    { id: "f_titulo", name: "Título", type: "text" },
                    { id: "f_hecha", name: "Hecha", type: "checkbox" },
                  ],
                  rowUi: { open: false, hidden: [] },
                },
              ],
            }),
          ];
        if (p === "api/data/rows/e_ejemplo1")
          return [
            200,
            JSON.stringify({
              row: {
                id: "e_ejemplo1",
                type: "t_tarea",
                values: { f_titulo: "Recoger exámenes inventados", f_hecha: false },
                updated: 1,
                body: "Llevar la lista.",
              },
            }),
          ];
        if (p.includes("/data")) return ok("chart-eating-out.json");
        return [404, examples["error.json"]!];
      };
      const run = (method: string, a: unknown[]): unknown => {
        switch (method) {
          case "request":
            if (!settings.hasToken) return { ok: false, offline: false, notConfigured: true };
            if (w.__offline) return { ok: false, offline: true, message: "offline" };
            // A turn of the conversation: kept to be looked at, answered with one line of the model's.
            if (a[0] === "POST" && a[1] === "api/agent/turn") {
              turns.push(JSON.parse(a[2] as string));
              return {
                ok: true,
                status: 200,
                body: JSON.stringify({
                  run: `r${turns.length}`,
                  status: "done",
                  replies: [
                    {
                      component: "text",
                      data: {
                        template: {
                          t: "v",
                          value: "{a}",
                          integrity: "model",
                          sensitivity: "public",
                        },
                        a: {
                          t: "v",
                          value: "El total es 1.234,56 €.",
                          integrity: "model",
                          sensitivity: "personal",
                        },
                      },
                    },
                  ],
                }),
              };
            }
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
          case "pin":
            return true;
          case "setTargets":
            w.__targets = { entries: JSON.parse(a[0] as string), menu: a[1] };
            return null;
          case "pictureReady":
            w.__pictureReady = ((w.__pictureReady as number | undefined) ?? 0) + 1;
            return null;
          case "takeLaunch": {
            const l = launch;
            launch = null;
            return l;
          }
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
          // «Adjuntar» (task 114): what the phone's picker gave, as the app tells the page (a key, a name, a
          // size). It is fixed when asked, as the phone's is once chosen: a test that sets `__chosen` right
          // after a cancelled pick must not have that pick answer with its files.
          if (method === "chooseFiles") {
            const chosen = JSON.stringify({ ok: true, value: w.__chosen ?? [] });
            setTimeout(() => {
              answers.set(id, chosen);
              (w.__boniReply as (id: string) => void)(id);
            }, 15);
            return;
          }
          // A chosen file goes from the phone in steps, saying how much has gone, and the server keeps it as a row
          // of his files (apps/server/src/drops.ts answers so).
          if (method === "uploadFile") {
            const file = ((w.__chosen ?? []) as { key: string; name: string; size: number }[]).find(
              (f) => f.key === a[0],
            );
            const answer = () => {
              const value = file
                ? {
                    status: 200,
                    body: JSON.stringify({
                      id: `e_01drop${file.key}`,
                      name: file.name,
                      type: "t_01archivos",
                      size: file.size,
                      folder: "conversación/2026-11",
                      state: file.name.endsWith(".pdf") ? "text" : "image",
                    }),
                  }
                : { error: "unreadable" };
              answers.set(id, JSON.stringify({ ok: true, value }));
              (w.__boniReply as (id: string) => void)(id);
            };
            // Half of it has gone; the rest when the test lets it (`__held`), never on a timer it could miss.
            setTimeout(() => {
              if (file)
                (w.__boniEvent as (j: string) => void)(
                  JSON.stringify({
                    type: "upload",
                    key: file.key,
                    sent: Math.floor(file.size / 2),
                  }),
                );
              if (!w.__holdUploads) return void setTimeout(answer, 100);
              const held = (w.__held ?? []) as (() => void)[];
              held.push(answer);
              w.__held = held;
            }, 20);
            return;
          }
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
        // Written before it returns, as the app does (task 106).
        keepUnsent(text: string) {
          calls.push(`keepUnsent ${text.slice(0, 120)}`);
          if (text === "[]") files.delete("unsent.json");
          else files.set("unsent.json", text);
        },
      };
      w.__androidCalls = calls;
      w.__turns = turns;
      w.__androidFiles = files;
      w.__setLive = (live: boolean) => {
        settings = { ...settings, live };
        (w.__boniEvent as (j: string) => void)(JSON.stringify({ type: "settings", settings }));
      };
    },
    {
      examples: { ...EXAMPLES, ...opts.examples },
      configured: opts.configured ?? true,
      launch: opts.launch ?? null,
      missing: opts.missing ?? [],
      unsent: opts.unsent ?? null,
      offline: opts.offline ?? false,
    },
  );
  await page.goto(opts.url ?? "/?still");
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __androidCalls: string[] }).__androidCalls);

test("in the Android app the page talks only to the app: requests, files, settings", async ({
  page,
}) => {
  await openAndroid(page);
  await page.locator(".m-fab").tap();
  await expect(page.locator(".m-shortcut")).toHaveCount(2);
  await page.keyboard.press("Escape");
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
  // «Crear» from the + button: Back closes it.
  await page.locator(".m-fab").tap();
  await expect(page.locator(".m-bottom-sheet")).toBeVisible();
  expect(await back()).toBe(true);
  await expect(page.locator(".m-bottom-sheet")).toHaveCount(0);
  await page.locator(".m-fab").tap();
  await page.locator(".m-capture").tap();
  await expect(page.locator(".m-sheet")).toBeVisible();
  expect(await back()).toBe(true);
  await expect(page.locator(".m-sheet")).toHaveCount(0);

  // Something typed: Back asks first; Back again keeps editing; the close button asks too; "Descartar" closes
  await page.locator(".m-fab").tap();
  await page.locator(".m-capture").tap();
  const amount = page.locator(".m-sheet .form input").first();
  await amount.pressSequentially("12", { delay: 80 });
  expect(await back()).toBe(true);
  const question = page.getByRole("menu", { name: "¿Descartar lo que has escrito?" });
  await expect(question).toBeVisible();
  expect(await back()).toBe(true);
  await expect(question).toHaveCount(0);
  await expect(amount).toHaveValue("12");
  await page.locator(".m-sheet .m-top .m-icon").tap();
  await question.getByRole("button", { name: "Seguir editando" }).tap();
  await expect(amount).toHaveValue("12");
  await page.locator(".m-sheet .m-top .m-icon").tap();
  await question.getByRole("menuitem", { name: "Descartar" }).tap();
  await expect(page.locator(".m-sheet")).toHaveCount(0);

  // A chart's detail with its menu open: the menu, the detail, the chart, then Inicio
  await page.locator(".m-chart-row", { hasText: "Gasto del mes" }).tap();
  await page.locator(".m-chart-body .chart svg").waitFor();
  await page.waitForTimeout(300);
  const ranking = (await page.locator(".m-chart-body .chart").boundingBox())!;
  await page.touchscreen.tap(ranking.x + ranking.width / 2, ranking.y + 20);
  const detailBack = page.locator(".m-chart-body").getByRole("button", { name: "Volver" });
  await expect(detailBack).toBeVisible();
  await page.getByRole("button", { name: "Opciones de la gráfica" }).tap();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await back()).toBe(true);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(detailBack).toBeVisible();
  expect(await back()).toBe(true);
  await expect(detailBack).toHaveCount(0);
  await expect(page.locator(".m-title")).toHaveText("Gasto del mes");
  expect(await back()).toBe(true);
  await expect(page.locator(".m-large h1")).toHaveText("Inicio");

  // Another place: what it opened first (the conversations' drawer), then Inicio; there the app goes to the background.
  await page.locator(".m-tabs").getByRole("button", { name: "Boni" }).tap();
  await page.locator(".m-top").getByRole("button", { name: "Conversaciones" }).tap();
  await expect(page.locator(".chat-drawer")).toBeVisible();
  expect(await back()).toBe(true);
  await expect(page.locator(".chat-drawer")).toHaveCount(0);
  expect(await back()).toBe(true);
  await expect(page.locator(".m-large h1")).toHaveText("Inicio");
  expect(await back()).toBe(false);
});

test("«Adjuntar» in the conversation (task 114, A-24, I-36): the phone's own picker, each file sent by the app with its percent where its chip will be, then a chip of his files that goes with the message by reference; the page never has the file", async ({
  page,
}) => {
  await openAndroid(page);
  await page.locator(".m-tabs").getByRole("button", { name: "Boni" }).tap();
  const box = page.getByRole("textbox", { name: "Escribe a Boni…" });
  await expect(box).toBeVisible();
  const attach = page.getByRole("button", { name: "Adjuntar" });
  // A cancelled picker leaves the bar as it was.
  await attach.tap();
  await expect
    .poll(async () => (await calls(page)).filter((c) => c.startsWith("chooseFiles")))
    .toHaveLength(1);
  await expect(page.locator(".chat-composer .chat-chip")).toHaveCount(0);
  // A PDF and a photo of the phone, as the picker gives them.
  await page.evaluate(() => {
    const w = window as unknown as { __chosen: unknown; __holdUploads: boolean };
    w.__chosen = [
      { key: "f1", name: "Factura FAC-2026-0142.pdf", size: 182_000 },
      { key: "f2", name: "IMG_0042.jpg", size: 3_400_000 },
    ];
    w.__holdUploads = true;
  });
  await attach.tap();
  const bar = page.locator(".chat-composer .chat-pointed");
  const going = bar.locator(".chat-chip.upload.uploading");
  await expect(going).toHaveCount(2);
  await expect(going.first().locator(".chat-chip-text")).toHaveText("Factura FAC-2026-0142.pdf");
  // How much has gone, from the app's `upload` events, by each file's key.
  await expect(going.locator(".chat-chip-word")).toHaveText(["50 %", "50 %"]);
  await expect(going.first().getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(going.first().getByRole("progressbar")).toBeVisible();
  await box.fill("¿cuánto es el total?");
  await expect(page.getByRole("button", { name: "Subiendo" })).toBeDisabled();
  await page.screenshot({ path: "e2e-boni/screenshots/android-attach-uploading.png" });
  await page.evaluate(() => {
    for (const done of (window as unknown as { __held: (() => void)[] }).__held) done();
  });
  // Up: chips of his files, read for the message, and the page only ever named their keys.
  const chips = bar.locator('.chat-chip:has([data-boni-action="files.read"])');
  await expect(chips).toHaveText(["Factura FAC-2026-0142.pdf", "IMG_0042.jpg"]);
  await expect(going).toHaveCount(0);
  const sent = (await calls(page)).filter((c) => c.startsWith("uploadFile"));
  expect(sent).toEqual(['uploadFile ["f1"]', 'uploadFile ["f2"]']);
  await page.screenshot({ path: "e2e-boni/screenshots/android-attach-chips.png" });
  await page.getByRole("button", { name: "Enviar" }).tap();
  await expect(page.locator(".turn-answer").last()).toContainText("El total es 1.234,56 €.");
  const turns = await page.evaluate(
    () => (window as unknown as { __turns: { screen: { pointed: unknown[] } }[] }).__turns,
  );
  expect(turns.at(-1)?.screen.pointed).toEqual([
    { kind: "row", id: "e_01dropf1" },
    { kind: "row", id: "e_01dropf2" },
  ]);
  await expect(bar.locator(".chat-chip")).toHaveCount(0);
  expect(await audit(page, "android attach")).toEqual([]);
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

test("home-screen shortcuts: pinned from a shortcut's or a chart's menu; the launcher's list follows them", async ({
  page,
}) => {
  await openAndroid(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __targets?: { menu: number; entries: { target: string }[] } })
            .__targets,
      ),
    )
    .toMatchObject({
      menu: 2,
      entries: expect.arrayContaining([
        expect.objectContaining({ target: "shortcut:cafe", label: "Café", color: "#fb923c" }),
        expect.objectContaining({ target: "chart:eating-out" }),
      ]),
    });
  await page.locator(".m-fab").tap();
  await expect(page.locator(".m-shortcut")).toHaveCount(2);
  await page.getByRole("button", { name: "Opciones de Café" }).tap();
  await page.getByRole("menuitem", { name: "Añadir a la pantalla de inicio" }).tap();
  const pins = (await calls(page)).filter((c) => c.startsWith("pin "));
  expect(pins).toHaveLength(1);
  expect(pins[0]).toContain("shortcut:cafe");
  await page.locator(".m-chart-row", { hasText: "Comida fuera" }).tap();
  await page.getByRole("button", { name: "Opciones de la gráfica" }).tap();
  await page.getByRole("menuitem", { name: "Añadir a la pantalla de inicio" }).tap();
  expect((await calls(page)).filter((c) => c.startsWith("pin ")).at(-1)).toContain(
    "chart:eating-out",
  );
});

test("a home-screen shortcut opens what it points to: at start, and while the app runs", async ({
  page,
}) => {
  await openAndroid(page, { launch: "shortcut:comida-con-pablo" });
  await expect(page.locator(".m-sheet .m-title")).toHaveText("Comida con Pablo");
  await page.evaluate(() =>
    (window as unknown as { __boniEvent: (j: string) => void }).__boniEvent(
      JSON.stringify({ type: "navigate", screen: "chart:eating-out" }),
    ),
  );
  await expect(page.locator(".m-sheet")).toHaveCount(0);
  await expect(page.locator(".m-title")).toHaveText("Comida fuera");
  const back = () =>
    page.evaluate(() => (window as unknown as { __boniBack: () => boolean }).__boniBack());
  expect(await back()).toBe(true);
  await expect(page.locator(".m-large h1")).toHaveText("Inicio");
  await page.evaluate(() =>
    (window as unknown as { __boniEvent: (j: string) => void }).__boniEvent(
      JSON.stringify({ type: "navigate", screen: "shortcut:nope" }),
    ),
  );
  await expect(page.locator(".toast")).toHaveText("Ese atajo ya no existe");
});

test("a home-screen widget's picture: the chart card alone, and the app is told when it is drawn", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 220 });
  await openAndroid(page, { url: "/?picture=monthly-spending&still" });
  const card = page.locator(".picture .chart-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".card-title")).toHaveText("Gasto por mes");
  await expect(card.locator(".chart svg")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __pictureReady?: number }).__pictureReady),
    )
    .toBe(1);
  const box = (await card.boundingBox())!;
  expect(box.width).toBeGreaterThan(350);
  expect(box.height).toBeGreaterThan(210);
  await page.screenshot({ path: "e2e-boni/screenshots/phone-widget.png" });
});

test("a server older than a feature says so instead of showing its raw answer", async ({
  page,
}) => {
  await openAndroid(page, { missing: ["/shortcuts"] });
  await page.locator(".m-fab").tap();
  await page.locator(".m-capture").tap();
  await page.locator(".m-sheet .form input").first().pressSequentially("1", { delay: 80 });
  await page.getByRole("button", { name: "Guardar como atajo" }).tap();
  await page.getByRole("button", { name: "Crear atajo" }).tap();
  const message = page.getByText("Tu servidor de Boni es anterior a esta función: actualízalo");
  await expect(message).toBeInViewport();
  // above the sticky buttons, not hidden under them
  await page.waitForTimeout(400);
  const shown = (await message.boundingBox())!;
  const foot = (await page.locator(".m-sheet .form-foot").boundingBox())!;
  expect(shown.y + shown.height).toBeLessThanOrEqual(foot.y);
  await expect(page.getByText("Not Found")).toHaveCount(0);
});

test("a narrow widget cuts long axis labels instead of running them together", async ({ page }) => {
  const chart = JSON.parse(EXAMPLES["chart-spending-by-category.json"]!);
  const point = (label: string, value: number) => ({
    key: label.toLowerCase(),
    label,
    value,
    partial: false,
    no_data: false,
  });
  chart.kind = "bar";
  chart.series[0].points = [
    point("Otros", 690),
    point("Comida", 115),
    point("Suscripciones", 21),
    point("Transporte", 15),
  ];
  await page.setViewportSize({ width: 300, height: 220 });
  await openAndroid(page, {
    url: "/?picture=spending-by-category&still",
    examples: { "chart-spending-by-category.json": JSON.stringify(chart) },
  });
  const labels = page.locator(".picture .chart text[dominant-baseline=hanging]");
  await expect(labels).toHaveCount(4);
  const boxes = (await labels.evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })),
  )) as { left: number; right: number }[];
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right + 2);
  }
  await expect(labels.nth(2)).toHaveText(/…$/);
});

test("Boni Calendar's «Abrir en Boni»: its link opens the record as a page; Back goes back to the calendar", async ({
  page,
}) => {
  // boni://note?id=e_ejemplo1 started the app (Links.kt makes it this target).
  await openAndroid(page, { launch: "note:e_ejemplo1" });
  await expect(page.locator(".m-title")).toHaveText("Tarea");
  await expect(page.locator(".m-row").locator(".row-title, .doc-title").first()).toHaveValue(
    "Recoger exámenes inventados",
  );
  await page.screenshot({ path: "e2e-boni/screenshots/android-note.png" });
  // A surface of its own on the phone: everything fits (docs/principios.md I-03).
  expect(await audit(page, "android note")).toEqual([]);
  // Nothing of Boni's own to close: Back leaves the app, back in Boni Calendar.
  expect(
    await page.evaluate(() => (window as unknown as { __boniBack: () => boolean }).__boniBack()),
  ).toBe(false);
  await expect(page.locator(".m-row")).toHaveCount(0);
});

test("back from the background, the page does not send again what the app sent while it was hidden (task 109)", async ({
  page,
}) => {
  const write = (id: string, title: string) => ({
    path: `api/pages/${id}`,
    at: 1_000,
    id,
    kind: "page",
    patch: { title },
  });
  // Offline at the start: what the device kept stays kept.
  await openAndroid(page, {
    offline: true,
    unsent: [write("e_ejemplo_a", "Plan de ejemplo"), write("e_ejemplo_b", "Lista inventada")],
  });
  const puts = async (id: string) =>
    (await calls(page)).filter((c) => c.startsWith(`request ["PUT","api/pages/${id}"`)).length;
  const shown = (state: "hidden" | "visible") =>
    page.evaluate((s) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  const tick = () =>
    page.evaluate(() =>
      (window as unknown as { __boniEvent: (j: string) => void }).__boniEvent(
        JSON.stringify({ type: "tick", minute: 1 }),
      ),
    );
  await expect.poll(() => puts("e_ejemplo_a")).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as unknown as { __offline: boolean }).__offline = false;
  });
  // The app goes to the background: the page keeps its list; the app's worker sends one of them and takes it out.
  await shown("hidden");
  await page.evaluate(() => {
    const files = (window as unknown as { __androidFiles: Map<string, string> }).__androidFiles;
    const list = JSON.parse(files.get("unsent.json") ?? "[]") as { id: string }[];
    files.set("unsent.json", JSON.stringify(list.filter((x) => x.id !== "e_ejemplo_a")));
  });
  const [a, b] = [await puts("e_ejemplo_a"), await puts("e_ejemplo_b")];
  // Back: the next minute sends only what the app did not.
  await shown("visible");
  await expect
    .poll(async () => {
      await tick();
      return puts("e_ejemplo_b");
    })
    .toBeGreaterThan(b);
  expect(await puts("e_ejemplo_a")).toBe(a);
});
