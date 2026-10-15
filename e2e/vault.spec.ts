import { expect, type Page, test } from "@playwright/test";

const NOW = "2025-09-17T14:29";

const definition = (id: string, name: string, folder: string, color: string) => `---
type: wiki
summary: Definition of ${name}.
collection:
  id: ${id}
  name: ${name}
  folder: ${folder}
  account: Agenda
  color: "${color}"
  tz: Europe/Madrid
  columns:
    - { id: title, name: Título, type: text }
    - { id: date, name: Fecha, type: date }
    - { id: startTime, name: Hora de inicio, type: time }
    - { id: endTime, name: Hora de fin, type: time }
    - { id: endDate, name: Fecha de fin, type: date }
    - { id: allDay, name: Todo el día, type: checkbox }
    - { id: timezone, name: Zona horaria, type: text }
    - { id: completed, name: Hecha, type: checkbox }
    - { id: location, name: Lugar, type: text }
    - { id: estimate_h, name: Estimación (h), type: number }
  mapping:
    title: title
    location: location
    when: { kind: split, date: date, startTime: startTime, endTime: endTime, endDate: endDate, allDay: allDay, timezone: timezone }
    task: { column: completed }
---
`;

const note = (title: string, date: string, extra: string) =>
  `---\ntitle: "${title}"\ndate: "${date}"\n${extra}---\nArea: [[x]]\n`;

const FILES: Record<string, string> = {
  "_system/colecciones/docencia.md": definition(
    "docencia",
    "Docencia",
    "agenda/docencia",
    "#60a5fa",
  ),
  "_system/colecciones/planes.md": definition("planes", "Planes", "agenda/planes", "#4ade80"),
  "agenda/docencia/2025-09-17 Clase de ejemplo.md": note(
    "Clase de ejemplo",
    "2025-09-17",
    'startTime: "10:00"\nendTime: "12:00"\ntimezone: "Europe/Madrid"\nnotion_id: "x"\ncompleted:\n',
  ),
  "agenda/docencia/2025-09-18 Entregar actas.md": note(
    "Entregar actas",
    "2025-09-18",
    "completed: false\nallDay: true\n",
  ),
  "agenda/docencia/sin-fecha.md": '---\ntitle: "Sin fecha"\n---\n',
  "agenda/planes/2025-09-19 Cena de ejemplo.md": note(
    "Cena de ejemplo",
    "2025-09-19",
    'startTime: "21:00"\nendTime: "23:00"\n',
  ),
};

/** A desktop bridge backed by memory, installed before the app starts. */
async function openWithVault(page: Page, files: Record<string, string> = FILES) {
  await page.addInitScript(
    ({ files, settings }) => {
      localStorage.setItem("boni-calendar:settings", JSON.stringify(settings));
      const ok = (value: unknown) => ({ ok: true, value });
      // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge
      (window as any).boniVault = {
        getRoot: async () => ok("/vault/ejemplo"),
        chooseRoot: async () => ok("/vault/ejemplo"),
        scan: async (dir: string) =>
          ok(
            Object.keys(files)
              .filter((p) => p.startsWith(`${dir}/`))
              .map((path) => ({ path, mtimeMs: 1, size: 1 })),
          ),
        read: async (path: string) =>
          path in files
            ? ok({ text: files[path], mtimeMs: 1 })
            : { ok: false, code: "not-found", message: path },
        write: async () => ({ ok: false, code: "no", message: "read only" }),
        create: async () => ({ ok: false, code: "no", message: "read only" }),
      };
    },
    { files, settings: { dataSource: "vault" } },
  );
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

test("with the vault as the source, the calendars are the definitions and the events are the notes", async ({
  page,
}) => {
  await openWithVault(page);
  await expect(page.locator(".cal-row", { hasText: "Docencia" })).toBeVisible();
  await expect(page.locator(".cal-row", { hasText: "Planes" })).toBeVisible();
  await expect(page.locator(".ev", { hasText: "Clase de ejemplo" })).toHaveCount(1);
  await expect(page.locator(".ev", { hasText: "Cena de ejemplo" })).toHaveCount(1);
  // an all-day task shows in the all-day row
  await expect(page.getByText("Entregar actas").first()).toBeVisible();
  // none of the sample data is there
  await expect(page.locator(".ev", { hasText: "Clase FUP" })).toHaveCount(0);
  await page.screenshot({ path: "e2e/screenshots/vault.png" });
});

test("the vault is read-only for now: events cannot be dragged or turned into tasks", async ({
  page,
}) => {
  await openWithVault(page);
  const before = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const s = (window as any).__app.getState();
    return JSON.stringify(s.rows.map((r: { values: unknown }) => r.values));
  });
  const card = page.locator(".ev", { hasText: "Clase de ejemplo" });
  const b = await card.boundingBox();
  if (!b) throw new Error("no box");
  await page.mouse.move(b.x + b.width / 2, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 150, b.y + 120, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook exposed by main.tsx
    const s = (window as any).__app.getState();
    return JSON.stringify(s.rows.map((r: { values: unknown }) => r.values));
  });
  expect(after).toBe(before);
});

test("settings show how many notes were loaded and which were ignored, and why", async ({
  page,
}) => {
  await openWithVault(page);
  await page.keyboard.press("Control+,");
  const dialog = page.locator(".modal");
  await expect(dialog.getByText("/vault/ejemplo")).toBeVisible();
  await expect(dialog.getByText("Notas cargadas: 4 · ignoradas: 1")).toBeVisible();
  await dialog.getByText("Notas ignoradas (1)").click();
  await expect(dialog.getByText("agenda/docencia/sin-fecha.md")).toBeVisible();
  await expect(dialog.getByText("sin fecha válida")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/vault-settings.png" });
});

test("a vault without definitions says so instead of showing an empty grid", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("boni-calendar:settings", JSON.stringify({ dataSource: "vault" }));
    // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge
    (window as any).boniVault = {
      getRoot: async () => ({ ok: true, value: "/vault/vacio" }),
      chooseRoot: async () => ({ ok: true, value: "/vault/vacio" }),
      scan: async () => ({ ok: true, value: [] }),
      read: async () => ({ ok: false, code: "not-found", message: "x" }),
    };
  });
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await expect(page.getByText("no tiene colecciones definidas")).toBeVisible();
  await page.getByRole("button", { name: "Abrir ajustes" }).click();
  await expect(page.locator(".modal")).toBeVisible();
});

test("without the desktop bridge the app keeps using the sample data", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boni-calendar:settings", JSON.stringify({ dataSource: "vault" })),
  );
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await expect(page.locator(".ev", { hasText: "Clase FUP" }).first()).toBeVisible();
});
