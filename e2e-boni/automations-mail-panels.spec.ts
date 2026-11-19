import { clock, under } from "@boni/pace";
import { expect, type Page, test } from "@playwright/test";
import { openApp } from "./fixtures.ts";

/**
 * The panels of «Leer correo»'s steps in the editor (docs/automatizaciones.md §5.17, F16 E2): the cap said in «Llega un
 * correo», «Regla del remitente»'s table, the «Lectora»'s «Indicaciones» and «Ejemplos» as text from outside, and
 * «Crear en la elegida»'s «Crear» cells with their count and «Solo conocidos» (AU-249, AU-250, AU-253, AU-197).
 *
 * Over the mocked server of fixtures.ts: the automation as Boni draws it (apps/server's `drawReadMail`), its pieces in
 * order, over the fixture's «Tareas», «Eventos» and «Libros». No model is called and nothing runs.
 */

const READER = "boni.mailReader";
/** A value that looks like HTML, Markdown and a link: read letter by letter wherever it is painted (A-01). */
const LOOKS_LIKE_MARKUP =
  '<img src=x onerror="window.__pwned=1"> **negrita** [enlace](https://ejemplo.example.com/x)';

/** «Leer correo» as Boni draws it: the trigger, the rules, the reader, the decider over three, and its creation. */
function readMail(id: string, rules: unknown[] = [], cells = ["tareas", "eventos"]) {
  const perRow = { mode: "perRow" };
  const ids = ["trigger", "p-rule", "p-reader", "p-decider", "p-create"];
  return {
    id,
    name: "Leer correo",
    updated: 1761990000000,
    steps: [
      { id: "trigger", name: "Llega un correo", type: "boni.mail", params: {} },
      {
        id: "p-rule",
        name: "Regla del remitente",
        type: "boni.mailRule",
        params: { ...perRow, rules },
      },
      {
        id: "p-reader",
        name: "Lectora",
        type: READER,
        params: {
          ...perRow,
          modules: ["tasks", "events"],
          instructions: "",
          model: "",
          examples: [
            {
              mail: "De: ejemplo.ana@example.com\nAsunto: Cena del viernes\n\n¿Quedamos a las 21:00?",
              want: "Un evento el viernes a las 21:00",
            },
          ],
        },
      },
      {
        id: "p-decider",
        name: "Decisora",
        type: "boni.mailDecider",
        params: {
          ...perRow,
          collections: [
            { collection: "tareas" },
            { collection: "eventos" },
            { collection: "libros" },
          ],
          model: "",
        },
      },
      {
        id: "p-create",
        name: "Crear en la elegida",
        type: "boni.createChosen",
        params: { ...perRow, onlyKnown: true },
        connections: cells.map((collection) => ({
          collection,
          read: false,
          create: { mode: "ask" },
          update: false,
          remove: false,
        })),
      },
    ],
    arrows: ids.slice(1).map((to, i) => ({
      from: { step: ids[i], output: "main" },
      to: { step: to, input: "main" },
    })),
    places: ids.map((step, i) => ({ step, x: i * 300, y: 0 })),
    learning: [
      {
        step: "p-create",
        collection: "tareas",
        action: "create",
        mode: "ask",
        decided: 20,
        right: 18,
      },
    ],
  };
}

const card = (page: Page, id: string) => page.locator(`.auto-card[data-step="${id}"]`);
const view = (page: Page) => page.locator(".auto-view");
const param = (page: Page, key: string) => view(page).locator(`.auto-param[data-param="${key}"]`);
const rowOf = (page: Page, key: string) =>
  param(page, "connections").locator(`tr[data-collection="${key}"]`);
const cellOf = (page: Page, key: string) => rowOf(page, key).locator(".auto-conn-cell");
const ruleOf = (page: Page, at: number) => param(page, "rules").locator(`tr[data-rule="${at}"]`);

async function openCanvas(page: Page, steps: number) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await page.locator(".db-table tbody tr").getByText("Leer correo", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la automatización" })).toHaveValue(
    "Leer correo",
  );
  await expect(page.locator(".auto-card")).toHaveCount(steps);
}
async function openStep(page: Page, id: string) {
  await card(page, id).dblclick();
  await expect(view(page)).toHaveAttribute("data-step", id);
}
async function openMail(page: Page, automation: unknown, step: string) {
  await openApp(page, "/?still", { automations: [automation as never], agenda: true });
  await openCanvas(page, 5);
  await openStep(page, step);
}
type Saved = {
  steps: { id: string; params: Record<string, unknown>; connections?: Record<string, unknown>[] }[];
};
/** The drafts the app saved of `id`, as the mock received them. */
const drafts = (page: Page, id: string) =>
  page.evaluate(
    (st) =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? [])
        .filter((b) => b.startsWith(st))
        .map((b) => JSON.parse(b.slice(st.length)).automation as Saved),
    `PUT api/agent/automations/${id}/draft `,
  );
const lastStep = async (page: Page, id: string, step: string) =>
  (await drafts(page, id)).at(-1)?.steps.find((s) => s.id === step) ?? null;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe("«Leer correo»'s panels (F16 E2)", () => {
  test("AU-253 · «Llega un correo» says its cap in its panel, with nothing to change", async ({
    page,
  }) => {
    await openMail(page, readMail("a_01jx8x0t2v4x6z8b0d2f4m0a01"), "trigger");
    await expect(param(page, "cap")).toContainText(
      "150 llamadas al día · 20 por remitente · 500 en cola",
    );
    await expect(param(page, "cap").locator("input, select, textarea")).toHaveCount(0);
  });

  test("AU-249 · «Regla del remitente» is a table: a rule added is born «No leer», «Colección» only names the «Decisora»'s and only for «A una colección», and the draft keeps what his hand typed", async ({
    page,
  }) => {
    const id = "a_01jx8x0t2v4x6z8b0d2f4m0a02";
    await openMail(
      page,
      readMail(id, [{ sender: "ejemplo.boletin@example.com", do: "skip" }]),
      "p-rule",
    );
    await expect(ruleOf(page, 0).getByRole("textbox")).toHaveValue("ejemplo.boletin@example.com");
    await param(page, "rules").getByRole("button", { name: "Añadir", exact: true }).click();
    await expect(param(page, "rules").locator("tbody tr")).toHaveCount(2);
    const doSelect = page.getByRole("combobox", { name: "Qué hacer · Regla 2" });
    const collection = page.getByRole("combobox", { name: "Colección · Regla 2" });
    await expect(doSelect).toHaveValue("skip");
    await expect(collection).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Remitente · Regla 2" })
      .pressSequentially("ejemplo.banco@example.org", { delay: 25 });
    await doSelect.selectOption("collection");
    await expect(collection).toBeEnabled();
    await expect(collection.locator("option")).toHaveText(["—", "Tareas", "Eventos", "Libros"]);
    await collection.selectOption("libros");
    await expect
      .poll(async () => (await lastStep(page, id, "p-rule"))?.params.rules)
      .toEqual([
        { sender: "ejemplo.boletin@example.com", do: "skip" },
        { sender: "ejemplo.banco@example.org", do: "collection", collection: "libros" },
      ]);
    // Back to «No leer»: the collection goes with it.
    await doSelect.selectOption("skip");
    await expect
      .poll(async () => (await lastStep(page, id, "p-rule"))?.params.rules)
      .toEqual([
        { sender: "ejemplo.boletin@example.com", do: "skip" },
        { sender: "ejemplo.banco@example.org", do: "skip" },
      ]);
    await page.getByRole("button", { name: "Borrar: Regla 1" }).click();
    await expect(param(page, "rules").locator("tbody tr")).toHaveCount(1);
  });

  test("AU-249 · AU-197 · the «Lectora»'s «Indicaciones» are his text, and each of «Ejemplos» is a mail marked «de fuera», painted as plain text", async ({
    page,
  }) => {
    const id = "a_01jx8x0t2v4x6z8b0d2f4m0a03";
    await openMail(page, readMail(id), "p-reader");
    await expect(view(page).locator(".auto-view-look > .auto-param > .auto-param-name")).toHaveText(
      ["Busca", "Indicaciones", "Modelo", "Ejemplos"],
    );
    await param(page, "instructions")
      .getByRole("textbox", { name: "Indicaciones" })
      .pressSequentially("Las cenas son eventos", { delay: 25 });
    await expect
      .poll(async () => (await lastStep(page, id, "p-reader"))?.params.instructions)
      .toBe("Las cenas son eventos");
    const example = param(page, "examples").locator('.auto-example[data-example="0"]');
    await expect(example.locator(".auto-outside")).toHaveText("de fuera");
    const mail = page.getByRole("textbox", { name: "Correo · Ejemplo 1" });
    await expect(mail).toHaveValue(/^De: ejemplo\.ana@example\.com/);
    await mail.fill(LOOKS_LIKE_MARKUP);
    await expect(mail).toHaveValue(LOOKS_LIKE_MARKUP);
    await expect(param(page, "examples").locator("img, a, strong")).toHaveCount(0);
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect
      .poll(async () => (await lastStep(page, id, "p-reader"))?.params.examples)
      .toEqual([{ mail: LOOKS_LIKE_MARKUP, want: "Un evento el viernes a las 21:00" }]);
    await param(page, "examples").getByRole("button", { name: "Añadir", exact: true }).click();
    await expect(param(page, "examples").locator(".auto-example")).toHaveCount(2);
    await expect(
      param(page, "examples").locator('.auto-example[data-example="1"] .auto-outside'),
    ).toHaveText("de fuera");
  });

  test("AU-250 · «Crear en la elegida» has a «Crear» cell per collection of the «Decisora», with the count of his answers; «Sí» comes only from his hand, with «Solo conocidos» under it", async ({
    page,
  }) => {
    const id = "a_01jx8x0t2v4x6z8b0d2f4m0a04";
    await openMail(page, readMail(id), "p-create");
    await expect(param(page, "connections").locator("tbody tr")).toHaveCount(3);
    await expect(cellOf(page, "tareas")).toHaveAttribute("data-cell", "ask");
    await expect(cellOf(page, "eventos")).toHaveAttribute("data-cell", "ask");
    // A collection of the «Decisora» with no cell drawn: «No», never «Sí».
    await expect(cellOf(page, "libros")).toHaveAttribute("data-cell", "no");
    await expect(cellOf(page, "tareas").locator(".auto-conn-use")).toHaveText("18 de 20 aceptadas");
    await expect(param(page, "connections").getByText("Solo conocidos")).toHaveCount(0);
    // No read column, no «Conectar» nor «Desconectar»: the rows are the «Decisora»'s.
    await expect(param(page, "connections").locator("th")).toHaveText([
      "Colección",
      "Crear",
      "Tareas",
      "Eventos",
      "Libros",
    ]);
    await expect(view(page).getByRole("button", { name: "Desconectar" })).toHaveCount(0);
    expect(await drafts(page, id)).toEqual([]);

    await page.getByRole("combobox", { name: "Crear · Eventos" }).selectOption("yes");
    await expect(cellOf(page, "eventos")).toHaveAttribute("data-cell", "yes");
    await expect(cellOf(page, "eventos").locator(".auto-conn-use")).toHaveText("Solo conocidos");
    await expect
      .poll(async () => (await lastStep(page, id, "p-create"))?.connections)
      .toEqual([
        {
          collection: "tareas",
          read: false,
          create: { mode: "ask" },
          update: false,
          remove: false,
        },
        {
          collection: "eventos",
          read: false,
          create: { mode: "yes" },
          update: false,
          remove: false,
        },
      ]);
    await page.getByRole("combobox", { name: "Crear · Libros" }).selectOption("ask");
    await page.getByRole("combobox", { name: "Crear · Tareas" }).selectOption("no");
    const last = await (async () => {
      await expect
        .poll(async () =>
          ((await lastStep(page, id, "p-create"))?.connections ?? []).map((c) => c.collection),
        )
        .toEqual(["eventos", "libros"]);
      return (await lastStep(page, id, "p-create"))?.connections ?? [];
    })();
    expect(last.find((c) => c.collection === "libros")?.create).toMatchObject({ mode: "ask" });
    // Every draft saved: «Sí» only where his hand set it.
    for (const d of await drafts(page, id))
      for (const c of d.steps.find((s) => s.id === "p-create")?.connections ?? [])
        if ((c.create as { mode?: string } | false)?.mode === "yes")
          expect(c.collection).toBe("eventos");
  });
});

test.describe("«Leer correo»'s panels on the phone (F16 E2)", () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const [step, what] of [
    ["p-rule", "«Reglas»"],
    ["p-reader", "«Indicaciones» and «Ejemplos»"],
    ["p-create", "«Crear» cells"],
  ] as const)
    test(`AU-74 · AU-249 · AU-250 · on the phone ${what} are there to read: nothing changes and no draft is saved`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      const id = "a_01jx8x0t2v4x6z8b0d2f4m0a05";
      const a = readMail(id, [
        { sender: "ejemplo.banco@example.org", do: "collection", collection: "libros" },
      ]);
      // In a column, so the phone's canvas shows every card.
      a.places = a.places.map((p, i) => ({ ...p, x: 0, y: i * 140 }));
      await openApp(page, "/?still", { automations: [a as never], agenda: true });
      await page
        .locator(".m-tabs")
        .getByRole("button", { name: /^Páginas/ })
        .tap();
      await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
      await page.getByText("Leer correo", { exact: true }).first().tap();
      await expect(page.locator(".auto-card")).toHaveCount(5);
      await card(page, step).tap();
      await expect(view(page)).toHaveAttribute("data-step", step);
      await expect(view(page)).toHaveClass(/\bphone\b/);
      const controls = view(page).locator(
        ".auto-param select, .auto-param input, .auto-param textarea",
      );
      expect(await controls.count()).toBeGreaterThan(0);
      for (const c of await controls.all()) await expect(c).toBeDisabled();
      await expect(view(page).getByRole("button", { name: /^(Añadir|Borrar)/ })).toHaveCount(0);
      expect(await drafts(page, id)).toEqual([]);
    });
});

test.describe("«Leer correo»'s panels at volume (F16 E2)", () => {
  test("AU-249 · A-15 · with 500 rules, «Regla del remitente» opens at once and a letter typed in one is drawn at once", async ({
    page,
  }, info) => {
    const id = "a_01jx8x0t2v4x6z8b0d2f4m0a06";
    const rules = Array.from({ length: 500 }, (_, i) =>
      i % 3 === 0
        ? { sender: `ejemplo.${i}@example.org`, do: "collection", collection: "tareas" }
        : { sender: `ejemplo.${i}@example.com`, do: "skip" },
    );
    await openApp(page, "/?still", { automations: [readMail(id, rules) as never], agenda: true });
    await openCanvas(page, 5);
    await card(page, "p-rule").click();
    const pressed = clock();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector(".auto-view")?.getAttribute("data-step") === "p-rule" &&
        document.querySelectorAll(".auto-rules-table tbody tr").length === 500,
      null,
      { polling: "raf" },
    );
    const opening = clock() - pressed;
    // No «Añadir» at the cap.
    await expect(
      param(page, "rules").getByRole("button", { name: "Añadir", exact: true }),
    ).toHaveCount(0);
    const box = page.getByRole("textbox", { name: "Remitente · Regla 250" });
    await box.click();
    await page.keyboard.press("End");
    const typed = clock();
    await page.keyboard.type("x");
    await page.waitForFunction(
      () =>
        (document.querySelector('tr[data-rule="249"] input') as HTMLInputElement | null)?.value ===
        "ejemplo.249@example.orgx",
      null,
      { polling: "raf" },
    );
    const drawn = clock() - typed;
    info.annotations.push({
      type: "A-15",
      description: `500 rules: «Regla del remitente» opened in ${opening.toFixed(0)} ms; a letter drawn in ${drawn.toFixed(0)} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    // Measured here (2026-11-19, headless Chrome, on the clock): opened in 496 ms from the key, a letter drawn in 66 ms.
    // Each rule is a memoised row, so a letter repaints its own row; the margins are for CI.
    under(opening, 1_500, "clock", "opening «Regla del remitente» with 500 rules");
    under(drawn, 300, "clock", "drawing a letter typed in one of 500 rules");
  });
});
