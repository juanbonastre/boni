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
    - { id: series, name: Serie, type: text }
    - { id: series_rule, name: Regla de la serie, type: text }
  mapping:
    title: title
    location: location
    when: { kind: split, date: date, startTime: startTime, endTime: endTime, endDate: endDate, allDay: allDay, timezone: timezone }
    task: { column: completed }
    series: { id: series, rule: series_rule }
  newNote:
    name: "{date} {title}"
    body: "Area: [[${id}]]\\n\\n## Notas\\n"
---
`;

const vaultFiles = (page: Page) =>
  page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    () => (window as any).__vault.files as Record<string, string>,
  );

const writeOn = async (page: Page) => {
  await page.keyboard.press("Control+,");
  await page.locator(".modal").getByRole("radio", { name: "Lectura y escritura" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
};

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
async function openWithVault(
  page: Page,
  files: Record<string, string> = FILES,
  settings: Record<string, unknown> = { dataSource: "vault" },
) {
  await page.addInitScript(
    ({ files, settings }) => {
      if (!localStorage.getItem("boni-calendar:settings")) {
        localStorage.setItem("boni-calendar:settings", JSON.stringify(settings));
      }
      const ok = (value: unknown) => ({ ok: true, value });
      const versions: Record<string, number> = {};
      const listeners: (() => void)[] = [];
      const enc = (t: string) => new TextEncoder().encode(t).length;
      const state = {
        files: { ...files } as Record<string, string>,
        reads: [] as string[],
        created: [] as string[],
        trashed: [] as string[],
        opened: [] as string[],
        watched: [] as string[][],
        fire: () => {
          for (const l of listeners) l();
        },
        set(path: string, text: string | null) {
          if (text === null) delete state.files[path];
          else state.files[path] = text;
          versions[path] = (versions[path] ?? 1) + 10;
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
        write: async (path: string, text: string, expected: number | null) => {
          if (!(path in state.files)) return { ok: false, code: "not-found", message: path };
          if (expected != null && Math.abs((versions[path] ?? 1) - expected) > 0.5) {
            return ok({ conflict: true, mtimeMs: versions[path] ?? 1, size: 0 });
          }
          state.set(path, text);
          setTimeout(state.fire, 50); // the real watcher reports our own writes too
          return ok({ conflict: false, mtimeMs: versions[path], size: enc(text) });
        },
        create: async (path: string, text: string) => {
          if (path in state.files) return ok({ exists: true });
          state.set(path, text);
          state.created.push(path);
          setTimeout(state.fire, 50);
          return ok({ exists: false, mtimeMs: versions[path], size: enc(text) });
        },
        rename: async (from: string, to: string) => {
          if (!(from in state.files)) return { ok: false, code: "not-found", message: from };
          if (to in state.files) return ok({ exists: true });
          const text = state.files[from] as string;
          const v = versions[from] ?? 1;
          delete state.files[from];
          state.files[to] = text;
          versions[to] = v;
          return ok({ exists: false, mtimeMs: v, size: enc(text) });
        },
        trash: async (path: string) => {
          state.trashed.push(path);
          delete state.files[path];
          return ok(null);
        },
        openNote: async (path: string) => {
          state.opened.push(path);
          return ok(null);
        },
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
    { files, settings },
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

test("with writing on, editing an event changes only its lines in the note", async ({ page }) => {
  await openWithVault(page);
  await writeOn(page);
  const path = "agenda/docencia/2025-09-17 Clase de ejemplo.md";
  const before = (await vaultFiles(page))[path] as string;
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).click();
  await page.locator(".popover .title-input").fill("Clase renombrada");
  await page.locator(".popover .title-input").press("Enter");
  await expect
    .poll(async () => (await vaultFiles(page))[path])
    .toContain('title: "Clase renombrada"');
  const after = (await vaultFiles(page))[path] as string;
  const changed = after.split("\n").filter((l, i) => l !== before.split("\n")[i]);
  expect(changed).toEqual(['title: "Clase renombrada"']);
  expect(after).toContain('notion_id: "x"');
  // the event is still selected with its detail open, and nothing was rebuilt around it
  await expect(page.locator(".popover .title-input")).toHaveValue("Clase renombrada");
});

test("Ctrl+click on an event opens its note instead of selecting it", async ({ page }) => {
  await openWithVault(page);
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).click({ modifiers: ["Control"] });
  await expect
    .poll(() =>
      page.evaluate(() => (window as never as { __vault: { opened: string[] } }).__vault.opened),
    )
    .toEqual(["agenda/docencia/2025-09-17 Clase de ejemplo.md"]);
  await expect(page.locator(".popover")).toHaveCount(0);
  await expect(page.locator(".ev.selected")).toHaveCount(0);
});

test("marking a task done writes the checkbox; undo writes it back", async ({ page }) => {
  await openWithVault(page);
  await writeOn(page);
  const path = "agenda/docencia/2025-09-18 Entregar actas.md";
  await page.getByText("Entregar actas").first().click();
  await page.locator(".popover .prop-row", { hasText: "Hecha" }).first().locator("input").check();
  await expect.poll(async () => (await vaultFiles(page))[path]).toContain("completed: true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await vaultFiles(page))[path]).toContain("completed: false");
});

test("a new event becomes a note when it gets a title, with a counter if the name is taken", async ({
  page,
}) => {
  await openWithVault(page);
  await writeOn(page);
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (!cols) throw new Error("no grid");
  const x = cols.x + (cols.width / 7) * 2.5; // Wednesday 17
  await page.mouse.move(x, cols.y + 500);
  await page.mouse.down();
  await page.mouse.move(x, cols.y + 560, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(".popover .title-input")).toBeFocused();
  // no title yet: no note yet
  const created = () =>
    page.evaluate(() => (window as never as { __vault: { created: string[] } }).__vault.created);
  expect(await created()).toEqual([]);
  await page.locator(".popover .title-input").fill("Clase de ejemplo");
  await page.locator(".popover .title-input").press("Enter");
  await expect.poll(created).toHaveLength(1);
  const [made] = await created();
  expect(made).toMatch(/^agenda\/(docencia|planes)\/2025-09-17 Clase de ejemplo( 2)?\.md$/);
  const text = (await vaultFiles(page))[made as string] as string;
  expect(text).toContain('title: "Clase de ejemplo"');
  expect(text).toContain('date: "2025-09-17"');
  expect(text).toMatch(/Area: \[\[(docencia|planes)\]\]\n\n## Notas\n$/);
  // the detail stays open on the same event and now offers "Open note"
  await expect(page.locator(".popover .title-input")).toHaveValue("Clase de ejemplo");
  await page.locator(".popover").getByTitle("Abrir nota en Obsidian").click();
  const opened = await page.evaluate(
    () => (window as never as { __vault: { opened: string[] } }).__vault.opened,
  );
  expect(opened).toEqual([made]);
});

test("deleting sends the note to the trash and Undo brings it back", async ({ page }) => {
  await openWithVault(page);
  await writeOn(page);
  const path = "agenda/planes/2025-09-19 Cena de ejemplo.md";
  const original = (await vaultFiles(page))[path];
  await page
    .getByRole("button", { name: "Día siguiente" })
    .first()
    .isVisible()
    .catch(() => false);
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const s = (window as any).__app.getState();
    const id = s.data.events.find((e: { title: string }) => e.title === "Cena de ejemplo").id;
    s.removeEvents([id]);
  });
  await expect.poll(async () => path in (await vaultFiles(page))).toBe(false);
  expect(
    await page.evaluate(
      () => (window as never as { __vault: { trashed: string[] } }).__vault.trashed,
    ),
  ).toEqual([path]);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect.poll(async () => (await vaultFiles(page))[path]).toBe(original);
});

test("moving an event to another calendar moves its file and its Area line", async ({ page }) => {
  await openWithVault(page);
  await writeOn(page);
  const from = "agenda/docencia/2025-09-17 Clase de ejemplo.md";
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).click();
  await page
    .locator(".popover .prop-row", { hasText: "Calendario" })
    .locator(".choice-btn")
    .click();
  await page
    .getByRole("option", { name: "Planes" })
    .or(page.locator(".menu-item", { hasText: "Planes" }))
    .first()
    .click();
  const to = "agenda/planes/2025-09-17 Clase de ejemplo.md";
  await expect.poll(async () => to in (await vaultFiles(page))).toBe(true);
  const files = await vaultFiles(page);
  expect(from in files).toBe(false);
  expect(files[to]).toContain('notion_id: "x"');
});

test("a note changed outside the app is not overwritten: the app says so and reloads", async ({
  page,
}) => {
  await openWithVault(page);
  await writeOn(page);
  const path = "agenda/docencia/2025-09-17 Clase de ejemplo.md";
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).click();
  await page.evaluate((p) => {
    // biome-ignore lint/suspicious/noExplicitAny: test hooks
    const v = (window as any).__vault;
    v.set(p, v.files[p].replace('title: "Clase de ejemplo"', 'title: "Editada en Obsidian"'));
  }, path);
  await page.locator(".popover .title-input").fill("Mi cambio");
  await page.locator(".popover .title-input").press("Enter");
  await expect(page.getByText("La nota cambió fuera de la app")).toBeVisible();
  const text = (await vaultFiles(page))[path] as string;
  expect(text).toContain("Editada en Obsidian");
  expect(text).not.toContain("Mi cambio");
  await expect(page.locator(".ev", { hasText: "Editada en Obsidian" })).toHaveCount(1);
});

const seriesNotes = (files: Record<string, string>, id = "s-test") =>
  Object.entries(files).filter(([, text]) => text.includes(`series: "${id}"`));

test("repeating an event in the vault makes one note per occurrence, up to twelve months ahead", async ({
  page,
}) => {
  await openWithVault(page);
  await writeOn(page);
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).click();
  await page.locator(".popover .prop-row", { hasText: "Repetir" }).locator(".choice-btn").click();
  await page.getByText("Cada semana", { exact: true }).first().click();
  await expect
    .poll(
      async () =>
        Object.keys(await vaultFiles(page)).filter((p) => p.includes("Clase de ejemplo")).length,
    )
    .toBeGreaterThan(50);
  const files = await vaultFiles(page);
  const all = Object.entries(files).filter(([p]) => p.includes("Clase de ejemplo"));
  expect(all.length).toBeLessThanOrEqual(54);
  for (const [, text] of all) {
    expect(text).toMatch(/series: "s-[\w-]+"/);
    expect(text).toContain('series_rule: "FREQ=WEEKLY"');
  }
  const names = all.map(([p]) => p).sort();
  expect(names[0]).toBe("agenda/docencia/2025-09-17 Clase de ejemplo.md");
  expect(names).toContain("agenda/docencia/2025-09-24 Clase de ejemplo.md");
  // one id for all of them
  expect(new Set(all.map(([, t]) => /series: "([^"]+)"/.exec(t)?.[1])).size).toBe(1);
});

test("editing and deleting a series asks for a scope and touches the notes of that scope", async ({
  page,
}) => {
  await openWithVault(page);
  await writeOn(page);
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).click();
  await page.locator(".popover .prop-row", { hasText: "Repetir" }).locator(".choice-btn").click();
  await page.getByText("Cada semana", { exact: true }).first().click();
  await expect
    .poll(
      async () =>
        Object.keys(await vaultFiles(page)).filter((p) => p.includes("Clase de ejemplo")).length,
    )
    .toBeGreaterThan(50);
  await page.waitForTimeout(800);

  // go to the next week and rename "this and following"
  await page.keyboard.press("Escape");
  await page.keyboard.press("k");
  await page.waitForTimeout(500);
  await page.locator(".ev", { hasText: "Clase de ejemplo" }).first().click();
  await page.locator(".popover .title-input").fill("Clase nueva");
  await page.locator(".popover .title-input").press("Enter");
  await page.getByRole("button", { name: "Este y los siguientes" }).click();
  await expect
    .poll(
      async () =>
        Object.values(await vaultFiles(page)).filter((t) => t.includes('title: "Clase nueva"'))
          .length,
    )
    .toBeGreaterThan(50);
  const files = await vaultFiles(page);
  expect(files["agenda/docencia/2025-09-17 Clase de ejemplo.md"]).toContain(
    'title: "Clase de ejemplo"',
  );
  expect(files["agenda/docencia/2025-09-24 Clase de ejemplo.md"]).toContain('title: "Clase nueva"');

  // delete "this and following" from the same note: the series ends before it
  await page.waitForTimeout(600);
  await page.locator(".ev", { hasText: "Clase nueva" }).first().click();
  await page.keyboard.press("Delete");
  await expect(page.getByText("Los eventos pasados se conservan.")).toBeVisible();
  await page.getByRole("button", { name: "Este y los siguientes" }).click();
  await expect
    .poll(
      async () =>
        Object.keys(await vaultFiles(page)).filter((p) => p.includes("Clase de ejemplo")).length,
    )
    .toBe(1);
  const left = await vaultFiles(page);
  expect(left["agenda/docencia/2025-09-17 Clase de ejemplo.md"]).toContain("UNTIL=2025-09-23");
  const trashed = await page.evaluate(
    () => (window as never as { __vault: { trashed: string[] } }).__vault.trashed,
  );
  expect(trashed.length).toBeGreaterThan(50);
});

test("an open-ended series gets the notes it is missing when the vault is read with writing on", async ({
  page,
}) => {
  const weekly = (day: string) =>
    `---\ntitle: "Revisión semanal"\ndate: "${day}"\nstartTime: "09:00"\nendTime: "09:30"\nseries: "s-test"\nseries_rule: "FREQ=WEEKLY"\n---\nArea: [[docencia]]\n`;
  const files = {
    ...FILES,
    "agenda/docencia/2025-08-25 Revisión semanal.md": weekly("2025-08-25"),
    "agenda/docencia/2025-09-01 Revisión semanal.md": weekly("2025-09-01"),
    "agenda/docencia/2025-09-08 Revisión semanal.md": weekly("2025-09-08"),
    "agenda/docencia/2025-09-15 Revisión semanal.md": weekly("2025-09-15"),
  };
  await openWithVault(page, files, { dataSource: "vault", vaultWrite: true });
  await expect.poll(async () => seriesNotes(await vaultFiles(page)).length).toBeGreaterThan(50);
  const names = seriesNotes(await vaultFiles(page))
    .map(([p]) => p)
    .sort();
  expect(names[0]).toBe("agenda/docencia/2025-08-25 Revisión semanal.md");
  expect(names).toContain("agenda/docencia/2025-09-22 Revisión semanal.md");
  expect(names.at(-1) as string).toMatch(/2026-09-(14|21)/);
  await expect(page.getByText(/Se crearon \d+ eventos más/)).toBeVisible();
  // nothing more is created on the next refresh
  const before = names.length;
  await page.evaluate(() => (window as never as { __vault: { fire: () => void } }).__vault.fire());
  await page.waitForTimeout(600);
  expect(seriesNotes(await vaultFiles(page)).length).toBe(before);
});

test("without writing on, series are not extended and nothing is created", async ({ page }) => {
  await openWithVault(page, {
    ...FILES,
    "agenda/docencia/2025-09-15 Revisión semanal.md": `---\ntitle: "Revisión semanal"\ndate: "2025-09-15"\nstartTime: "09:00"\nendTime: "09:30"\nseries: "s-test"\nseries_rule: "FREQ=WEEKLY"\n---\n`,
  });
  await page.waitForTimeout(500);
  expect(seriesNotes(await vaultFiles(page))).toHaveLength(1);
});
