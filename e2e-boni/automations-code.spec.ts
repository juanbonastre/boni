import { expect, type Page, test } from "@playwright/test";
import { FLOW_CATALOG, FLOW_CHECK, FLOW_DETAIL, FLOWS, MAP, MODELS } from "./agent-scenarios.ts";
import { ALL_DONE, books, TESTED, testOf } from "./automation-data.ts";
import { openApp } from "./fixtures.ts";

/**
 * JavaScript in «Automatizaciones» on the screen, F14c (docs/automatizaciones.md §5.3, §5.4, §5.5): expressions with
 * JavaScript and their preview, the «Código» step with its editor and its «Consola», and the connections with
 * collections. Pending: the first PR of the phase brings one test per rule, and the builders of its screens turn each
 * into a real one, keeping the rule's id in its name (`make check` reads them). A file of its own: automations.spec.ts
 * is F14b's.
 *
 * How they are written when they run: as automations.spec.ts, over the mocked server of fixtures.ts, with
 * collections whose keys and names are shaped like the user's and, where a rule is about many, with many (a test of
 * 3,000 rows, a collection of 40 fields). Typing goes at a person's pace where time matters (the preview of an
 * expression, the editor's marks). The same over the real server and the real box is
 * e2e-boni-desktop/automations-code.spec.ts.
 */

/** What the flows of before need to be listed and opened (agent-scenarios.ts). */
const BEFORE = () => ({
  "GET api/agent/models": [MODELS],
  "GET api/agent/map": [MAP],
  "GET api/agent/flows": [FLOWS],
  "GET api/agent/flows/:id": [{ ...FLOW_DETAIL, enabled: true }],
  "GET api/agent/flows/catalog": [FLOW_CATALOG],
  "POST api/agent/flows/check": [FLOW_CHECK],
  "PUT api/agent/flows/:id/enabled": [{ ...FLOW_DETAIL, enabled: false }],
});
const FIVE_MIN = 5 * 60_000;
/**
 * «Revisar con código», for the line under an expression that is JavaScript (AU-23): «Revisar pendientes» whose
 * «Modificar filas» writes the title in capitals and a «Fin» that reads a field of nothing, and throws.
 */
const CODED = {
  ...TESTED,
  id: "a_01jx8x0t2v4x6z8b0d2f4h6k9p",
  name: "Revisar con código",
  steps: TESTED.steps.map((s) =>
    s.id === "s_01jmodificar"
      ? {
          ...s,
          params: {
            ...s.params,
            fields: [
              { field: "notas", value: { expr: "{{ $json.titulo.toUpperCase() }}" } },
              { field: "fin", value: { expr: "{{ $json.nada.x.trim() }}" } },
            ],
          },
        }
      : s,
  ),
};
/** What the app asked the server's preview (`…/test/preview`, AU-23): step, param, row and expression. */
const previewsAsked = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __autoPreview?: string[] }).__autoPreview ?? []).map(
      (x) => JSON.parse(x) as { step: string; param: string; row: number; expr: string },
    ),
  );
const card = (page: Page, id: string) => page.locator(`.auto-card[data-step="${id}"]`);
const view = (page: Page) => page.locator(".auto-view");
const param = (page: Page, key: string) => view(page).locator(`.auto-param[data-param="${key}"]`);
/** The list of «Automatizaciones», opened from the sidebar, and `name` opened from it with its `steps` boxes. */
async function openCanvas(page: Page, name: string, steps: number) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await page.locator(".db-table tbody tr").getByText(name, { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la automatización" })).toHaveValue(
    name,
  );
  await expect(page.locator(".auto-card")).toHaveCount(steps);
}
/** An expression as its editor holds it: its text, and each chip as the citation it stands for (AU-21). */
const exprOf = (l: ReturnType<Page["locator"]>) =>
  l.evaluate((el) => {
    const walk = (n: Node): string =>
      n.nodeType === Node.TEXT_NODE
        ? (n as Text).data.replace(/\u00a0/g, " ").replace(/\u200b/g, "")
        : ((n as HTMLElement).dataset?.src ?? [...n.childNodes].map(walk).join(""));
    return [...el.childNodes].map(walk).join("");
  });
async function openStep(page: Page, id: string) {
  await card(page, id).dblclick();
  await expect(view(page)).toHaveAttribute("data-step", id);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe("an expression with JavaScript", () => {
  test("AU-23 · an expression that is JavaScript asks the server for its value once typing pauses, never once per key, and the latest text wins over a slower answer; «‹ ›» goes through the rows into the step; a failure says its line and message as plain text", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN }, CODED)],
      agent: BEFORE(),
    });
    await openCanvas(page, CODED.name, 7);
    await openStep(page, "s_01jmodificar");
    const fields = param(page, "fields");
    const upper = fields.locator(".auto-preview").first();
    // Opened, it asks once for the first row of the three that reach the step.
    await expect(upper).toHaveText("= LIBRO 126 · con la fila 1 de 3");
    const first = (await previewsAsked(page)).filter((x) => x.param === "fields.0.value");
    expect(first).toEqual([
      {
        step: "s_01jmodificar",
        param: "fields.0.value",
        row: 0,
        expr: "{{ $json.titulo.toUpperCase() }}",
      },
    ]);
    // Typed at a person's pace, it asks again only when the typing stops: one ask for six keys.
    const editor = fields.getByRole("textbox", { name: "Valor" }).first();
    await editor.click();
    await editor.press("Control+End");
    await editor.pressSequentially(" ya va", { delay: 80 });
    await expect(upper).toHaveText("= LIBRO 126 ya va · con la fila 1 de 3");
    const typed = (await previewsAsked(page)).filter((x) => x.param === "fields.0.value");
    expect(typed.length).toBe(2);
    expect(typed[1]?.expr).toBe("{{ $json.titulo.toUpperCase() }} ya va");
    // The next row asks for that row; at the last one «›» is off, and «‹» goes back.
    const after = fields.getByRole("button", { name: "Fila siguiente" }).first();
    const before = fields.getByRole("button", { name: "Fila anterior" }).first();
    await expect(before).toBeDisabled();
    await after.click();
    await expect(upper).toHaveText("= LIBRO 127 ya va · con la fila 2 de 3");
    await after.click();
    await expect(upper).toHaveText("= LIBRO 128 ya va · con la fila 3 de 3");
    await expect(after).toBeDisabled();
    await before.click();
    await expect(upper).toHaveText("= LIBRO 127 ya va · con la fila 2 de 3");
    // A slow answer to an older text never covers the newer one: «lento» is answered after 1.5 s, and «ya va»
    // after it is erased comes first.
    await page.evaluate(() => {
      (window as unknown as { __previewSlow: unknown }).__previewSlow = { expr: "lento", ms: 1500 };
    });
    await editor.press("Control+End");
    await editor.pressSequentially(" lento", { delay: 40 });
    await expect
      .poll(async () => (await previewsAsked(page)).some((x) => x.expr.endsWith("lento")))
      .toBe(true);
    await expect(upper).toHaveClass(/pending/);
    for (let i = 0; i < 6; i++) await editor.press("Backspace");
    await expect(upper).toHaveText("= LIBRO 127 ya va · con la fila 2 de 3");
    await expect(upper).not.toHaveClass(/pending/);
    await page.waitForTimeout(1800);
    await expect(upper).toHaveText("= LIBRO 127 ya va · con la fila 2 de 3");
    // «Fin» reads a field of nothing: the code's line and its message, markup as text.
    const fin = fields.locator(".auto-preview").nth(1);
    await expect(fin).toHaveText(
      "Con la fila 1 de 3: El código falló en la línea 1: Cannot read properties of undefined (reading '<b>x</b>')",
    );
    await expect(fin).toHaveClass(/failed/);
    await expect(fin.locator("b")).toHaveCount(0);
  });
  test("AU-23 · while a step before is not tested, the line under JavaScript names the steps to test first, with no rows to go through", async ({
    page,
  }) => {
    const { s_01jbuscar: _b, ...rest } = ALL_DONE;
    await openApp(page, "/?still", {
      automations: [testOf(rest, { kept: FIVE_MIN }, CODED)],
      agent: BEFORE(),
    });
    await openCanvas(page, CODED.name, 7);
    await openStep(page, "s_01jmodificar");
    const upper = param(page, "fields").locator(".auto-preview").first();
    await expect(upper).toHaveText("Sin probar: prueba antes «Buscar filas en Libros»");
    await expect(upper).toHaveClass(/failed/);
    await expect(param(page, "fields").getByRole("button", { name: "Fila siguiente" })).toHaveCount(
      0,
    );
  });
  test("AU-35 · every limit of `CODE_LIMITS` has its words in Spanish and in English (words.test.ts), and a `{{ }}` that is too long says so under it, with its limit, before any test and asking the server nothing", async ({
    page,
  }) => {
    const long = `{{ ${"$json.titulo + ".repeat(150)}1 }}`;
    const big = {
      ...CODED,
      steps: CODED.steps.map((s) =>
        s.id === "s_01jmodificar"
          ? { ...s, params: { ...s.params, fields: [{ field: "notas", value: { expr: long } }] } }
          : s,
      ),
    };
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN }, big)],
      agent: BEFORE(),
    });
    await openCanvas(page, CODED.name, 7);
    await openStep(page, "s_01jmodificar");
    const line = param(page, "fields").locator(".auto-preview").first();
    await expect(line).toHaveText(
      `Es demasiado largo para calcularlo aquí: ${long.length} caracteres, y caben 2000`,
    );
    await expect(line).toHaveClass(/failed/);
    await page.waitForTimeout(600);
    expect(await previewsAsked(page)).toEqual([]);
  });
  test("AU-22 · typing `{{` in a fixed value turns it into an expression with what was written kept, and the JavaScript between `{{ }}` is painted as code beside the chips of its simple citations", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN }, CODED)],
      agent: BEFORE(),
    });
    await openCanvas(page, CODED.name, 7);
    await openStep(page, "s_01jcrear");
    const fields = param(page, "fields");
    const fixed = fields.locator("input.auto-input[aria-label='Título']").last();
    await expect(fixed).toHaveValue("Resumen de pendientes");
    await fixed.click();
    await fixed.press("End");
    await fixed.pressSequentially(" {{", { delay: 120 });
    // An expression now, with what was written and the caret after `{{`: typing goes on in it.
    const editor = fields.getByRole("textbox", { name: "Título" });
    await expect(editor).toBeFocused();
    await expect(fields.getByRole("button", { name: "Usar un valor fijo" })).toBeVisible();
    await editor.pressSequentially(" $json.total + 1 }} de {{ $json.total }}", { delay: 60 });
    await expect
      .poll(() => exprOf(editor))
      .toBe("Resumen de pendientes {{ $json.total + 1 }} de {{ $json.total }}");
    await page.keyboard.press("Escape");
    await expect(editor.locator(".auto-expr-code")).toHaveText("{{ $json.total + 1 }}");
    await expect(editor.locator(".auto-chip")).toHaveCount(1);
  });
  test.fixme("AU-25 · a field dragged into JavaScript is written by its key (`$json.precio`), the entry and the completion show its name («Precio»), and nowhere outside an expression or a «Código» is a key read", async () => {});
});

/** A «Código» that reads the books it receives and writes a line per book to «Consola» (AU-30, AU-33). */
const SOURCE = [
  "const out = [];",
  "for (const fila of $input.all()) {",
  "  console.log('fila', fila.json.titulo);",
  "  out.push({ titulo: fila.json.titulo, total: fila.json.paginas * 2 });",
  "}",
  "return out;",
].join("\n");
/**
 * «Calcular con código»: the trigger, «Buscar filas en Libros», a «Código» with `source` and `connections`, and a
 * «Limitar» after it.
 */
const coded = (id: string, source: string = SOURCE, connections?: unknown[]) => ({
  id,
  name: "Calcular con código",
  updated: 1761990000000,
  steps: [
    TESTED.steps[0],
    TESTED.steps[1],
    {
      id: "s_01jcodigo",
      name: "Código",
      type: "code",
      params: { source },
      ...(connections ? { connections } : {}),
    },
    { id: "s_01jlimitar", name: "Limitar", type: "limit", params: { count: 10 } },
  ],
  arrows: [
    { from: { step: "s_inicio", output: "main" }, to: { step: "s_01jbuscar", input: "main" } },
    { from: { step: "s_01jbuscar", output: "main" }, to: { step: "s_01jcodigo", input: "main" } },
    { from: { step: "s_01jcodigo", output: "main" }, to: { step: "s_01jlimitar", input: "main" } },
  ],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jbuscar", x: 300, y: 0 },
    { step: "s_01jcodigo", x: 600, y: 0 },
    { step: "s_01jlimitar", x: 900, y: 0 },
  ],
});
const totals = books(128).map((b) => ({
  json: { titulo: b.json.titulo, total: b.json.paginas * 2 },
  label: {},
}));
/** Its test: 128 books in, 128 rows out, and what the code wrote, with HTML and a link in it (A-01). */
const CODE_DONE = (code: Record<string, unknown> = {}) => ({
  s_inicio: ALL_DONE.s_inicio,
  s_01jbuscar: ALL_DONE.s_01jbuscar,
  s_01jcodigo: {
    rows: { "in:main": books(128), "out:main": totals },
    ms: 40,
    console: {
      lines: [
        { level: "log", text: "fila <b>Rayuela</b> [aquí](https://ejemplo.example.com)", line: 3 },
        { level: "warn", text: "fila Libro 2", line: 3, row: 1 },
      ],
      dropped: 340,
    },
    ...code,
  },
  s_01jlimitar: { rows: { "in:main": totals, "out:main": totals.slice(0, 10) }, ms: 5 },
});
/** A test of the «Código» that failed with `why` (a `CodeFailure`). */
const failedWith = (why: Record<string, unknown>) =>
  CODE_DONE({
    state: "failed",
    rows: { "in:main": books(128) },
    out: { main: 0 },
    console: undefined,
    error: { message: "ignored", failure: { code: "other" }, why },
  });
const editorOf = (page: Page) => param(page, "source").locator(".cm-editor");
const contentOf = (page: Page) => editorOf(page).locator(".cm-content");
const options = (page: Page) => page.locator(".cm-tooltip-autocomplete li");
/** The text of the editor, as CodeMirror holds it. */
const sourceIn = (page: Page) =>
  contentOf(page).evaluate((el) =>
    [...el.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"),
  );
/** The step's «Probar paso», in the view's head. */
const testStep = (page: Page) =>
  view(page).locator(".auto-view-test").getByRole("button", { name: "Probar paso" });
/** «Calcular con código» opened, with its «Código» open. */
async function openCode(page: Page, automation: unknown, more: { agenda?: boolean } = {}) {
  await openApp(page, "/?still", { automations: [automation as never], agent: BEFORE(), ...more });
  await openCanvas(page, "Calcular con código", 4);
  await openStep(page, "s_01jcodigo");
  await expect(editorOf(page)).toBeVisible();
}
/** The drafts the app saved of `id`, as the mock received them. */
const drafts = (page: Page, id: string) =>
  page.evaluate(
    (st) =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? [])
        .filter((b) => b.startsWith(st))
        .map(
          (b) =>
            JSON.parse(b.slice(st.length)).automation as {
              steps: { id: string; connections?: unknown[] }[];
            },
        ),
    `PUT api/agent/automations/${id}/draft `,
  );
/** Types at a person's pace and waits until no completion is open, so the Enter after it is a new line. */
async function typeLine(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 60 });
  await expect(options(page)).toHaveCount(0);
  await page.keyboard.press("Enter");
}

test.describe("«Código»", () => {
  test("AU-30 · «Código» is in «Añadir paso» under «Transformar»; opened, it shows «Se ejecuta» with «Una vez con todas las filas» chosen and «Una vez por fila», and the editor: no more than seven rows of «Parámetros»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [testOf(ALL_DONE)], agent: BEFORE() });
    await openCanvas(page, "Revisar pendientes", 7);
    // The editor is not loaded until a «Código» is opened (AU-36).
    const loaded = () =>
      page.evaluate(() =>
        performance.getEntriesByType("resource").some((r) => /CodeEditor/.test(r.name)),
      );
    expect(await loaded()).toBe(false);
    await page.locator(".auto-add-top").click();
    const transform = page
      .locator(".auto-panel .auto-panel-section")
      .filter({ has: page.getByRole("heading", { name: "Transformar filas" }) });
    await expect(transform.locator(".auto-start-row").last()).toHaveText("Código");
    await transform.locator(".auto-start-row").last().click();
    await expect(view(page).getByRole("textbox", { name: "Nombre del paso" })).toHaveValue(
      "Código",
    );
    const mode = param(page, "mode");
    await expect(mode.getByRole("radio")).toHaveCount(2);
    await expect(mode.getByRole("radio", { name: "Una vez con todas las filas" })).toBeChecked();
    await mode.getByText("Una vez por fila").click();
    await expect(mode.getByRole("radio", { name: "Una vez por fila" })).toBeChecked();
    await expect(editorOf(page)).toBeVisible();
    expect(await loaded()).toBe(true);
    const rows = await view(page).locator(".auto-view-rows .auto-param").count();
    expect(rows).toBeGreaterThanOrEqual(2);
    expect(rows).toBeLessThanOrEqual(7);
    // Empty, it cannot be tested yet, and says why.
    await expect(testStep(page)).toBeDisabled();
    await expect(view(page).locator(".auto-view-why")).toHaveText(
      "Escribe el código para probarlo",
    );
  });

  test("AU-25 · in the view of a «Código» step each field of its input shows its key beside its name, and a field that the code made is seen in the steps after it by the name the code gave it (`total`)", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c01");
    await openCode(page, testOf(CODE_DONE(), { kept: FIVE_MIN }, a));
    const input = view(page).getByRole("region", { name: "Entrada" });
    await expect(input).toContainText("Título · titulo");
    await expect(input).toContainText("Páginas · paginas");
    // The step after it: the field the code made, by the name it gave it, and no key beside a name.
    await view(page).getByRole("button", { name: "Cerrar" }).click();
    await openStep(page, "s_01jlimitar");
    const after = view(page).getByRole("region", { name: "Entrada" });
    await expect(after).toContainText("total");
    await expect(after).not.toContainText("· titulo");
  });

  test("AU-33 · after «Probar paso», «Consola» is a strip under the step's output, folded when it is empty, with each line and the line of the code that wrote it; with lines left out it says how many", async ({
    page,
  }) => {
    await openCode(page, testOf(CODE_DONE(), {}, coded("a_01jx8x0t2v4x6z8b0d2f4h6c02")));
    const strip = view(page).getByRole("region", { name: "Salida" }).locator(".auto-console");
    // Not tested yet: folded, nothing written.
    await expect(strip).not.toHaveAttribute("open");
    await expect(strip.locator("summary")).toContainText("Consola");
    await expect(strip.locator("summary")).toContainText("nada escrito");
    await testStep(page).click();
    await expect(strip).toHaveAttribute("open");
    const lines = strip.locator(".auto-console-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.first().locator(".auto-console-where")).toHaveText("línea 3");
    await expect(lines.nth(1)).toHaveClass(/warn/);
    // A line written for a row says which, counted from 1.
    await expect(lines.nth(1).locator(".auto-console-where")).toHaveText("línea 3 · fila 2");
    await expect(strip.locator(".auto-console-more")).toHaveText("y 340 líneas más");
  });

  test("AU-33 · code that throws marks its line in the editor and says the message as it is, as plain text: a message with HTML or a link is read letter by letter", async ({
    page,
  }) => {
    const message = "<i>sin</i> <a href='https://ejemplo.example.com'>título</a>";
    const failed = failedWith({
      code: "code.threw",
      param: "source",
      detail: { line: 4, message },
    });
    await openCode(page, testOf(failed, { kept: FIVE_MIN }, coded("a_01jx8x0t2v4x6z8b0d2f4h6c04")));
    const output = view(page).getByRole("region", { name: "Salida" });
    await expect(output).toContainText(`El código falló en la línea 4: ${message}`);
    await expect(output.locator("i, a[href]")).toHaveCount(0);
    // Its line, the fourth, is marked; the one before it is not.
    const lines = contentOf(page).locator(".cm-line");
    await expect(lines.nth(3).locator(".cm-lintRange-error")).toHaveCount(1);
    await expect(lines.nth(2).locator(".cm-lintRange-error")).toHaveCount(0);
  });

  test("AU-33 · what the code wrote to «Consola» is painted as plain text: a line with HTML, Markdown or a link is read letter by letter, and nothing in it can be clicked", async ({
    page,
  }) => {
    await openCode(
      page,
      testOf(CODE_DONE(), { kept: FIVE_MIN }, coded("a_01jx8x0t2v4x6z8b0d2f4h6c05")),
    );
    const strip = view(page).locator(".auto-console");
    await expect(strip.locator(".auto-console-text").first()).toHaveText(
      "fila <b>Rayuela</b> [aquí](https://ejemplo.example.com)",
    );
    await expect(strip.locator("ol b, ol a, ol button")).toHaveCount(0);
  });

  test("AU-35 · a «Código» that passes a limit says which and the limit in the step, in the app's words", async ({
    page,
  }) => {
    const failed = failedWith({
      code: "code.limit",
      param: "source",
      detail: { limit: "ms", max: 5000 },
    });
    await openCode(page, testOf(failed, { kept: FIVE_MIN }, coded("a_01jx8x0t2v4x6z8b0d2f4h6c06")));
    await expect(view(page).getByRole("region", { name: "Salida" })).toContainText(
      "Se pasó del tope de tiempo de una llamada: 5 s",
    );
  });

  test("AU-35 · a «Código» that is too long says so with its limit before any test", async ({
    page,
  }) => {
    const long = `return [];\n${"// una nota que no hace nada\n".repeat(720)}`;
    await openCode(page, testOf(CODE_DONE(), {}, coded("a_01jx8x0t2v4x6z8b0d2f4h6c07", long)));
    await expect(param(page, "source").locator(".auto-code-problem")).toHaveText(
      `Es demasiado largo: ${long.length.toLocaleString("es-ES")} caracteres, y caben 20.000`,
    );
    await expect(testStep(page)).toBeDisabled();
    const tests = await page.evaluate(
      () => (window as unknown as { __autoTests?: string[] }).__autoTests ?? [],
    );
    expect(tests).toEqual([]);
  });

  test("AU-36 · the editor completes `$('` with the steps before this one, after a step its fields by name, and `$col('` with the collections connected; a step, a field or a collection that does not exist is underlined before any test, with what is wrong on hover and for a keyboard", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c08", "return [];", [
      { collection: "libros", read: {}, create: false, update: false, remove: false },
    ]);
    await openCode(page, testOf(CODE_DONE(), { kept: FIVE_MIN }, a));
    await contentOf(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    // `$('`: the steps before this one, by name; one chosen is written whole.
    await page.keyboard.type("$('", { delay: 60 });
    await expect(options(page)).toHaveText(["Disparado por el usuario", "Buscar filas en Libros"]);
    // Chosen with the keyboard at a person's pace: CodeMirror leaves a list's keys to the editor for its first 75 ms
    // (`interactionDelay`), so an ArrowDown sooner than a person's would move the caret and close the list.
    await page.waitForTimeout(250);
    await page.keyboard.press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect.poll(() => sourceIn(page)).toContain("$('Buscar filas en Libros')");
    await typeLine(page, "').first();");
    // A row of its input: the fields that reach it, by key with their names beside.
    await page.keyboard.type("$input.first().", { delay: 60 });
    await expect(options(page).filter({ hasText: "titulo" })).toContainText("Título");
    await typeLine(page, "titulo;");
    // `$col('`: the collections it is connected to.
    await page.keyboard.type("$col('", { delay: 60 });
    await expect(options(page)).toHaveText(["Libros"]);
    // A collection it is not connected to and a step that does not exist: underlined before any test.
    await typeLine(page, "Tareas').count();");
    await page.keyboard.type("$('Nada').first();", { delay: 40 });
    await expect.poll(() => sourceIn(page)).toContain("$('Buscar filas en Libros').first();");
    const errors = contentOf(page).locator(".cm-lintRange-error");
    await expect(errors).toHaveCount(2);
    await errors.last().hover();
    await expect(page.locator(".cm-tooltip-lint")).toContainText("Ningún paso se llama «Nada»");
    // For a keyboard: CodeMirror's list of what is wrong, opened with Ctrl+Shift+M.
    await contentOf(page).focus();
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".cm-panel-lint")).toContainText("Ningún paso se llama «Nada»");
  });

  test("AU-36 · the editor is the app's: its colours are the theme's in light and in dark, it is used whole with the keyboard (Tab leaves it after Escape), and it is not loaded until a «Código» or an expression is opened", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c09", "return [];");
    await openCode(page, testOf(CODE_DONE(), { kept: FIVE_MIN }, a));
    const seen: string[] = [];
    for (const theme of ["dark", "light"]) {
      // The theme as Settings › Apariencia sets it (theme.ts): the root's `data-theme`.
      await page.evaluate((th) => {
        document.documentElement.dataset.theme = th;
      }, theme);
      const [bg, own, text, ownText] = await editorOf(page).evaluate((el) => {
        const root = getComputedStyle(document.documentElement);
        const resolved = (v: string) => {
          const probe = document.createElement("div");
          probe.style.color = root.getPropertyValue(v);
          document.body.append(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        };
        const style = getComputedStyle(el);
        return [style.backgroundColor, resolved("--bg"), style.color, resolved("--text")];
      });
      expect(bg, theme).toBe(own);
      expect(text, theme).toBe(ownText);
      seen.push(bg as string);
    }
    expect(seen[0]).not.toBe(seen[1]);
    // The keyboard: Tab indents inside it; Escape and then Tab leave it.
    await contentOf(page).click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("Tab");
    await expect.poll(() => sourceIn(page)).toBe("  return [];");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => !!document.activeElement?.closest(".cm-editor"));
    expect(inside).toBe(false);
    await expect(view(page)).toBeVisible();
    // With the completion list open, Escape closes the list, and the editor and the view stay.
    await contentOf(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("$input.", { delay: 60 });
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(options(page)).toHaveCount(0);
    expect(await page.evaluate(() => !!document.activeElement?.closest(".cm-editor"))).toBe(true);
    await expect(view(page)).toBeVisible();
  });

  test("AU-36 · a field the cited step's last test did not give is underlined as a warning and «Probar paso» still runs; a step or a collection that does not exist is an error and it does not", async ({
    page,
  }) => {
    const a = coded(
      "a_01jx8x0t2v4x6z8b0d2f4h6c10",
      "return [{ x: $('Buscar filas en Libros').first().nada }];",
    );
    await openCode(page, testOf(CODE_DONE(), { kept: FIVE_MIN }, a));
    await expect(contentOf(page).locator(".cm-lintRange-warning")).toHaveCount(1);
    await expect(contentOf(page).locator(".cm-lintRange-error")).toHaveCount(0);
    await expect(testStep(page)).toBeEnabled();
    // A step that does not exist: an error, and «Probar paso» waits.
    await contentOf(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("$('Nada').first();", { delay: 40 });
    await expect(contentOf(page).locator(".cm-lintRange-error")).toHaveCount(1);
    await expect(testStep(page)).toBeDisabled();
    await expect(view(page).locator(".auto-view-why")).toHaveText(
      "Corrige lo marcado en el código para probarlo",
    );
  });

  test("AU-31 · `$col('Libros')` with «Libros» not connected marks the step, cannot be tested, and says «Conecta «Libros» a este paso» with the button that connects it; pressed, the problem goes", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c11", "return [{ n: $col('Libros').count() }];");
    await openCode(page, testOf(CODE_DONE(), { kept: FIVE_MIN }, a));
    const notice = param(page, "source").locator(".auto-code-connect");
    await expect(notice).toContainText("Conecta «Libros» a este paso");
    await expect(contentOf(page).locator(".cm-lintRange-error")).toHaveCount(1);
    await expect(testStep(page)).toBeDisabled();
    await notice.getByRole("button", { name: "Conectar" }).click();
    await expect(notice).toHaveCount(0);
    await expect(contentOf(page).locator(".cm-lintRange-error")).toHaveCount(0);
    await expect(testStep(page)).toBeEnabled();
    // Saved with the draft: it reads «Libros», with no limits, and nothing more.
    await expect
      .poll(async () => {
        const last = (await drafts(page, a.id)).at(-1);
        return last?.steps.find((s) => s.id === "s_01jcodigo")?.connections ?? null;
      })
      .toEqual([{ collection: "libros", read: {}, create: false, update: false, remove: false }]);
  });
});

test.describe("«Código» on the phone", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("AU-74 · on the phone a «Código» is there to read: its code is shown and cannot be changed, «Se ejecuta» cannot be changed, a collection not connected is said with no «Conectar», and there is no «Probar paso»", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const source = "return [$col('Libros').count()];";
    await openApp(page, "/?still", {
      automations: [
        testOf(CODE_DONE(), {}, coded("a_01jx8x0t2v4x6z8b0d2f4h6c09", source)) as never,
      ],
      agent: BEFORE(),
    });
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page.getByText("Calcular con código", { exact: true }).first().tap();
    await expect(page.locator(".auto-card")).toHaveCount(4);
    await card(page, "s_01jcodigo").tap();
    await expect(view(page)).toHaveAttribute("data-step", "s_01jcodigo");
    await expect(view(page)).toHaveClass(/\bphone\b/);
    await expect(editorOf(page)).toBeVisible();
    await expect.poll(() => sourceIn(page)).toBe(source);
    await expect(contentOf(page)).toHaveAttribute("contenteditable", "false");
    await expect(view(page).locator("[contenteditable=true]")).toHaveCount(0);
    const modes = param(page, "mode").getByRole("radio");
    await expect(modes).toHaveCount(2);
    for (const m of await modes.all()) await expect(m).toBeDisabled();
    await expect(param(page, "source").locator(".auto-code-connect")).toContainText(
      "Conecta «Libros» a este paso",
    );
    await expect(view(page).getByRole("button", { name: "Conectar" })).toHaveCount(0);
    await expect(view(page).getByRole("button", { name: "Probar paso" })).toHaveCount(0);
    // Typing in it changes nothing, and no draft is saved.
    await contentOf(page).tap();
    await page.keyboard.type("x");
    await expect.poll(() => sourceIn(page)).toBe(source);
    expect(await drafts(page, "a_01jx8x0t2v4x6z8b0d2f4h6c09")).toEqual([]);
  });
});

/** A «Código» that reads «Libros» and marks the open tasks done: it asks to modify «Tareas» (AU-172). */
const SAVES = [
  "const libros = $col('Libros').find();",
  "for (const t of $col('Tareas').find({ hecha: false })) $col('Tareas').update(t.id, { hecha: true });",
  "return [{ n: libros.length }];",
].join("\n");
const LIBROS_FILTERED = {
  collection: "libros",
  read: { where: [{ field: "paginas", op: "gt", value: 100 }] },
  create: false,
  update: false,
  remove: false,
};
const TAREAS = (more: Record<string, unknown> = {}) => ({
  collection: "tareas",
  read: {},
  create: false,
  update: { mode: "ask" },
  remove: false,
  ...more,
});
/** «Tareas» is one of the agenda's collections of the mocked server. */
const AGENDA = { agenda: true };
const table = (page: Page) => param(page, "connections");
const rowOf = (page: Page, key: string) => table(page).locator(`tr[data-collection="${key}"]`);
const cellOf = (page: Page, key: string, action: string) =>
  rowOf(page, key).locator(`.auto-conn-cell[data-action="${action}"]`);
const lastConnections = async (page: Page, id: string) =>
  (await drafts(page, id)).at(-1)?.steps.find((s) => s.id === "s_01jcodigo")?.connections ?? null;

test.describe("connections", () => {
  test("AU-40 · AU-178 · AU-180 · a connection hangs under its step on the canvas: one chip per collection with what it can save in words («Lee · con filtro», «Lee y modifica · pregunta antes»), inside the step's box so it follows it; the card's labels start with what the step changes («Modifica Tareas»), and a step that only reads says nothing", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c20", SAVES, [LIBROS_FILTERED, TAREAS()]);
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE(), agenda: true });
    await openCanvas(page, "Calcular con código", 4);
    const chips = card(page, "s_01jcodigo").locator(".auto-card-conns .auto-conn-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toHaveAttribute("data-collection", "libros");
    await expect(chips.nth(0)).toHaveText("LibrosLee · con filtro");
    await expect(chips.nth(1)).toHaveText("TareasLee y modifica · pregunta antes");
    // Under the card, by its dotted line.
    const box = await card(page, "s_01jcodigo").boundingBox();
    const chip = await chips.nth(0).boundingBox();
    expect(chip && box && chip.y > box.y + box.height).toBe(true);
    const change = card(page, "s_01jcodigo").locator(".auto-label").first();
    await expect(change).toHaveText("Modifica Tareas");
    await expect(change).toHaveClass(/\bchange\b/);
    // «Buscar filas en Libros» only reads: no chip, no mark.
    await expect(card(page, "s_01jbuscar").locator(".auto-card-conns")).toHaveCount(0);
    await expect(card(page, "s_01jbuscar").locator(".auto-label.change")).toHaveCount(0);
  });
  test("AU-180 · a «Colección» step that writes has the same mark as a «Código»: «Modificar filas» in «Libros» reads «Modifica Libros»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [TESTED as never], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    await expect(card(page, "s_01jmodificar").locator(".auto-label.change")).toHaveText(
      "Modifica Libros",
    );
  });
  test("AU-41 · AU-179 · AU-44 · in the view of a «Código» the connections are a table, one row per collection: «Leer» always «Sí» with its limits («Sí · con filtro») and «Crear», «Modificar» and «Eliminar» each «No», «Preguntar» or «Sí» with whether the code uses it; the sentence under it says what the step can do and changes with the table", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c21", SAVES, [LIBROS_FILTERED, TAREAS()]);
    await openCode(page, a, AGENDA);
    await expect(table(page).locator("tbody tr")).toHaveCount(2);
    await expect(rowOf(page, "libros").locator("th")).toHaveText("Libros");
    await expect(cellOf(page, "libros", "read")).toHaveText("Sí · con filtro");
    await expect(cellOf(page, "tareas", "read")).toHaveText("Sí");
    await expect(cellOf(page, "tareas", "update")).toHaveAttribute("data-cell", "ask");
    await expect(cellOf(page, "tareas", "update").locator(".auto-conn-use")).toHaveText("lo usa");
    await expect(cellOf(page, "tareas", "create")).toHaveAttribute("data-cell", "no");
    await expect(cellOf(page, "tareas", "create").locator(".auto-conn-use")).toHaveCount(0);
    const sentence = table(page).locator(".auto-conn-sentence");
    await expect(sentence).toHaveText(
      "Puede leer Libros (con filtro), y leer y modificar Tareas. No puede crear ni eliminar nada.",
    );
    // «Eliminar» of «Libros» to «Preguntar»: unused, saved with the draft, and the sentence follows.
    await page.getByRole("combobox", { name: "Eliminar · Libros" }).selectOption("ask");
    await expect(cellOf(page, "libros", "remove").locator(".auto-conn-use")).toHaveText("sin usar");
    await expect(sentence).toHaveText(
      "Puede leer y eliminar Libros (con filtro), y leer y modificar Tareas. No puede crear nada.",
    );
    await expect
      .poll(async () => (await lastConnections(page, a.id))?.[0])
      .toMatchObject({ collection: "libros", remove: { mode: "ask" } });
  });
  test("AU-43 · a connection's row opens «Solo estas filas» (the views' filter, with the collection's fields), «Solo estos campos» and a limit; each is saved with the draft and seen again when the step is opened", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c22", SAVES, [LIBROS_FILTERED, TAREAS()]);
    await openCode(page, a, AGENDA);
    const limits = table(page).locator('.auto-conn-limits[data-collection="tareas"]');
    await limits.locator("summary").click();
    await expect(limits.locator('[data-limit="where"]')).toBeVisible();
    await expect(limits.locator(".auto-conn-field")).toHaveText([
      "Título",
      "Día",
      "Inicio",
      "Fin",
      "Hecha",
    ]);
    await limits.getByRole("checkbox", { name: "Inicio" }).uncheck();
    await limits.getByRole("spinbutton", { name: "Límite de filas" }).fill("200");
    await expect
      .poll(async () => (await lastConnections(page, a.id))?.[1]?.read)
      .toEqual({ fields: ["titulo", "dia", "fin", "hecha"], limit: 200 });
    await expect(cellOf(page, "tareas", "read")).toHaveText("Sí · 4 campos · hasta 200 filas");
    // Opened again, it is as it was left.
    await view(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(view(page)).toHaveCount(0);
    await openStep(page, "s_01jcodigo");
    await expect(cellOf(page, "tareas", "read")).toHaveText("Sí · 4 campos · hasta 200 filas");
    const again = table(page).locator('.auto-conn-limits[data-collection="tareas"]');
    await again.locator("summary").click();
    await expect(again.getByRole("spinbutton", { name: "Límite de filas" })).toHaveValue("200");
    await expect(again.getByRole("checkbox", { name: "Inicio" })).not.toBeChecked();
  });
  test("AU-176 · what the code asks to save and its connection does not allow is red in its cell, with «Permite modificar en «Tareas»»; «Permitir» sets «Preguntar», never «Sí», saves it and the problem goes", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c23", SAVES, [
      LIBROS_FILTERED,
      TAREAS({ update: false }),
    ]);
    await openCode(page, a, AGENDA);
    const cell = cellOf(page, "tareas", "update");
    await expect(cell).toHaveClass(/\bmissing\b/);
    await expect(cell.locator(".auto-conn-use")).toHaveText("lo usa");
    const notice = table(page).locator(".auto-conn-allow");
    await expect(notice).toHaveText(/Permite modificar en «Tareas»/);
    await notice.getByRole("button", { name: "Permitir" }).click();
    await expect(notice).toHaveCount(0);
    await expect(cell).toHaveAttribute("data-cell", "ask");
    await expect(cell).not.toHaveClass(/\bmissing\b/);
    await expect
      .poll(async () => (await lastConnections(page, a.id))?.[1]?.update)
      .toEqual({ mode: "ask" });
  });
  test("AU-189 · a removal with «Sí» reads «sin preguntar» in its chip and in the card's mark; «Desconectar» takes the row out", async ({
    page,
  }) => {
    const source =
      "for (const t of $col('Tareas').find()) $col('Tareas').remove(t.id);\nreturn [];";
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c24", source, [
      TAREAS({ update: false, remove: { mode: "yes" } }),
    ]);
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE(), agenda: true });
    await openCanvas(page, "Calcular con código", 4);
    await expect(card(page, "s_01jcodigo").locator(".auto-conn-chip")).toHaveText(
      "TareasLee y elimina · sin preguntar",
    );
    await expect(card(page, "s_01jcodigo").locator(".auto-label.change")).toHaveText(
      "Elimina en Tareas · sin preguntar",
    );
    await openStep(page, "s_01jcodigo");
    await rowOf(page, "tareas").getByRole("button", { name: "Desconectar" }).click();
    await expect(table(page).locator(".auto-conn-none")).toBeVisible();
    await expect.poll(() => lastConnections(page, a.id)).toBeNull();
  });
  test("AU-181 · after «Probar paso», «Haría esto» of a «Código» says what its requests would save, by collection and action, whether a run would ask, the first rows before and after, and how many more", async ({
    page,
  }) => {
    const before = (i: number) => ({ titulo: `Tarea ${i}`, hecha: false });
    const would = {
      asks: true,
      counts: [{ collection: "tareas", action: "update", n: 3000 }],
      records: [1, 2].map((i) => ({
        collection: "tareas",
        action: "update",
        id: `r_01jtarea${i}`,
        before: before(i),
        after: { ...before(i), hecha: true },
      })),
    };
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c25", SAVES, [LIBROS_FILTERED, TAREAS()]);
    await openCode(
      page,
      testOf(CODE_DONE({ would, wouldWrite: 3000 }), { kept: FIVE_MIN }, a),
      AGENDA,
    );
    const strip = view(page).getByRole("region", { name: "Salida" }).locator(".auto-would-code");
    await expect(strip).toHaveAttribute("data-rows", "3000");
    await expect(strip.locator(".auto-would-line")).toHaveText([
      "Modificaría 3000 filas en Tareas",
    ]);
    await strip.locator("summary").click();
    await expect(strip).toContainText("Al ejecutarse, preguntaría antes de guardar");
    const rows = strip.locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-would", "update");
    await expect(rows.first().locator("td.changed")).toHaveCount(1);
    await expect(strip.locator(".auto-console-more")).toHaveText("y 2998 filas más");
  });
  test("AU-46 · only «Código» shows connections: no other step of the catalogue has the table or a chip under it", async ({
    page,
  }) => {
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c26", SAVES, [LIBROS_FILTERED, TAREAS()]);
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE(), agenda: true });
    await openCanvas(page, "Calcular con código", 4);
    await expect(page.locator(".auto-card-conns")).toHaveCount(1);
    await openStep(page, "s_01jbuscar");
    await expect(view(page).locator(".auto-param-connections")).toHaveCount(0);
  });
});

test.describe("connections on the phone", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("AU-74 · on the phone the connections are there to read: the cells cannot be changed, and there is no «Permitir» nor «Desconectar»", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const a = coded("a_01jx8x0t2v4x6z8b0d2f4h6c27", SAVES, [TAREAS({ update: false })]);
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE(), agenda: true });
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page.getByText("Calcular con código", { exact: true }).first().tap();
    await card(page, "s_01jcodigo").tap();
    await expect(view(page)).toHaveAttribute("data-step", "s_01jcodigo");
    await expect(table(page).locator("tbody tr")).toHaveCount(1);
    for (const c of await table(page).getByRole("combobox").all()) await expect(c).toBeDisabled();
    await expect(table(page).locator(".auto-conn-allow")).toHaveText(
      /Permite modificar en «Tareas»/,
    );
    await expect(view(page).getByRole("button", { name: "Permitir" })).toHaveCount(0);
    await expect(view(page).getByRole("button", { name: "Desconectar" })).toHaveCount(0);
    expect(await drafts(page, a.id)).toEqual([]);
  });
});
