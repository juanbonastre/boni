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

/**
 * A desktop bridge backed by memory, installed before the app starts. `window.__vault` lets a test
 * change a note "from outside" (like Obsidian would) and announce it as the watcher would; the saved
 * index lives in localStorage so it survives a reload like the file in userData does.
 */
async function openWithVault(page: Page, files: Record<string, string> = FILES) {
  await page.addInitScript(
    ({ files, settings }) => {
      if (!localStorage.getItem("boni-calendar:settings")) {
        localStorage.setItem("boni-calendar:settings", JSON.stringify(settings));
      }
      const ok = (value: unknown) => ({ ok: true, value });
      const versions: Record<string, number> = {};
      const listeners: (() => void)[] = [];
      const state = {
        files: { ...files } as Record<string, string>,
        reads: [] as string[],
        watched: [] as string[][],
        fire: () => {
          for (const l of listeners) l();
        },
        set(path: string, text: string | null) {
          if (text === null) delete state.files[path];
          else state.files[path] = text;
          versions[path] = (versions[path] ?? 1) + 1;
        },
      };
      // biome-ignore lint/suspicious/noExplicitAny: test hooks
      (window as any).__vault = state;
      // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge
      (window as any).boniVault = {
        getRoot: async () => ok("/vault/ejemplo"),
        chooseRoot: async () => ok("/vault/ejemplo"),
        scan: async (dir: string) =>
          ok(
            Object.keys(state.files)
              .filter((p) => p.startsWith(`${dir}/`))
              .map((path) => ({
                path,
                mtimeMs: versions[path] ?? 1,
                size: state.files[path]?.length,
              })),
          ),
        read: async (path: string) => {
          state.reads.push(path);
          return path in state.files
            ? ok({ text: state.files[path], mtimeMs: versions[path] ?? 1 })
            : { ok: false, code: "not-found", message: path };
        },
        write: async () => ({ ok: false, code: "no", message: "read only" }),
        create: async () => ({ ok: false, code: "no", message: "read only" }),
        watch: async (dirs: string[]) => {
          state.watched.push(dirs);
          return ok(null);
        },
        onChanged: (cb: () => void) => {
          listeners.push(cb);
          return () => listeners.splice(listeners.indexOf(cb), 1);
        },
        cacheRead: async () => ok(localStorage.getItem("test-vault-cache")),
        cacheWrite: async (text: string) => {
          localStorage.setItem("test-vault-cache", text);
          return ok(null);
        },
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

test("changes made outside the app show up after the watcher fires, and nothing else is rebuilt", async ({
  page,
}) => {
  await openWithVault(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as never as { __vault: { watched: string[][] } }).__vault.watched.length,
      ),
    )
    .toBe(1);
  const watched = await page.evaluate(
    () => (window as never as { __vault: { watched: string[][] } }).__vault.watched[0],
  );
  expect(watched).toEqual(["_system/colecciones", "agenda/docencia", "agenda/planes"]);

  // select the lesson and remember the events by identity
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).click();
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const w = window as any;
    w.__before = new Map(w.__app.getState().data.events.map((e: { id: string }) => [e.id, e]));
    w.__readsBefore = w.__vault.reads.length;
  });

  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const v = (window as any).__vault;
    v.set(
      "agenda/planes/2025-09-19 Cena de ejemplo.md",
      '---\ntitle: "Cena cambiada"\ndate: "2025-09-19"\nstartTime: "20:00"\nendTime: "22:00"\n---\n',
    );
    v.set(
      "agenda/planes/2025-09-16 Nueva.md",
      '---\ntitle: "Nota nueva"\ndate: "2025-09-16"\nstartTime: "09:00"\nendTime: "10:00"\n---\n',
    );
    v.set("agenda/docencia/2025-09-18 Entregar actas.md", null);
    v.fire();
  });
  await expect(page.locator(".ev", { hasText: "Nota nueva" })).toHaveCount(1);
  await expect(page.getByText("Entregar actas")).toHaveCount(0);

  const r = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const w = window as any;
    const s = w.__app.getState();
    const lesson = s.data.events.find((e: { title: string }) => e.title === "Clase de ejemplo");
    const dinner = s.data.events.find((e: { title: string }) => e.title === "Cena cambiada");
    return {
      lessonSame: lesson === w.__before.get(lesson.id),
      dinnerFound: !!dinner,
      selected: s.selectedIds,
      reads: w.__vault.reads.slice(w.__readsBefore).filter((p: string) => p.startsWith("agenda")),
    };
  });
  expect(r.lessonSame).toBe(true);
  expect(r.dinnerFound).toBe(true);
  expect(r.selected).toHaveLength(1);
  // only the changed and the new note were read again; the deleted one needs no read
  expect([...r.reads].sort()).toEqual([
    "agenda/planes/2025-09-16 Nueva.md",
    "agenda/planes/2025-09-19 Cena de ejemplo.md",
  ]);
  await expect(page.locator(".popover")).toBeVisible();
});

test("a second start reads no note at all: the saved index is enough", async ({ page }) => {
  await openWithVault(page);
  const cold = await page.evaluate(
    () =>
      (window as never as { __vault: { reads: string[] } }).__vault.reads.filter((p) =>
        p.startsWith("agenda"),
      ).length,
  );
  expect(cold).toBe(4);
  await page.reload();
  await page.waitForSelector(".ev");
  const warm = await page.evaluate(
    () =>
      (window as never as { __vault: { reads: string[] } }).__vault.reads.filter((p) =>
        p.startsWith("agenda"),
      ).length,
  );
  expect(warm).toBe(0);
  await expect(page.locator(".ev", { hasText: "Clase de ejemplo" })).toHaveCount(1);
});

test("hiding a calendar survives a refresh of the vault", async ({ page }) => {
  await openWithVault(page);
  await page.locator(".cal-row", { hasText: "Docencia" }).getByTitle("Ocultar").first().click();
  await expect(page.locator(".ev", { hasText: "Clase de ejemplo" })).toHaveCount(0);
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const v = (window as any).__vault;
    v.set(
      "agenda/planes/2025-09-16 Nueva.md",
      '---\ntitle: "Otra nota"\ndate: "2025-09-16"\nstartTime: "09:00"\nendTime: "10:00"\n---\n',
    );
    v.fire();
  });
  await expect(page.locator(".ev", { hasText: "Otra nota" })).toHaveCount(1);
  await expect(page.locator(".ev", { hasText: "Clase de ejemplo" })).toHaveCount(0);
});
