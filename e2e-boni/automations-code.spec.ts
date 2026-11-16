import { expect, type Page, test } from "@playwright/test";
import { FLOW_CATALOG, FLOW_CHECK, FLOW_DETAIL, FLOWS, MAP, MODELS } from "./agent-scenarios.ts";
import { ALL_DONE, TESTED, testOf } from "./automation-data.ts";
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

test.describe("«Código»", () => {
  test.fixme("AU-30 · «Código» is in «Añadir paso» under «Transformar»; opened, it shows «Se ejecuta» with «Una vez con todas las filas» chosen and «Una vez por fila», and the editor: no more than seven rows of «Parámetros»", async () => {});
  test.fixme("AU-25 · in the view of a «Código» step each field of its input shows its key beside its name, and a field that the code made is seen in the steps after it by the name the code gave it (`total`)", async () => {});
  test.fixme("AU-33 · after «Probar paso», «Consola» is a strip under the step's output, folded when it is empty, with each line and the line of the code that wrote it; with lines left out it says how many", async () => {});
  test.fixme("AU-33 · code that throws marks its line in the editor and says the message as it is, as plain text: a message with HTML or a link is read letter by letter", async () => {});
  test.fixme("AU-33 · what the code wrote to «Consola» is painted as plain text: a line with HTML, Markdown or a link is read letter by letter, and nothing in it can be clicked", async () => {});
  test.fixme("AU-35 · a «Código» that passes a limit says which and the limit («Ha tardado más de 5 s», «Ha devuelto 12.000 filas; el máximo son 10.000») in the step, in the app's words", async () => {});
  test.fixme("AU-35 · a «Código» that is too long says so with its limit before any test", async () => {});
  test.fixme("AU-36 · the editor completes `$('` with the steps before this one, after a step its fields by name, and `$col('` with the collections connected; a step, a field or a collection that does not exist is underlined before any test, with what is wrong on hover and for a keyboard", async () => {});
  test.fixme("AU-36 · the editor is the app's: its colours are the theme's in light and in dark, it is used whole with the keyboard (Tab leaves it after Escape), and it is not loaded until a «Código» or an expression is opened", async () => {});
  test.fixme("AU-36 · what the editor underlines is what validation says, no more and no less: the problems the server gives for the same code are the marks, each at its place", async () => {});
  test.fixme("AU-36 · a field the cited step's last test did not give is underlined as a warning and «Probar paso» still runs; a step or a collection that does not exist is an error and it does not", async () => {});
  test.fixme("AU-31 · `$col('Libros')` with «Libros» not connected marks the step, cannot be tested, and says «Conecta «Libros» a este paso» with the button that connects it; pressed, the problem goes and the table has its row", async () => {});
});

test.describe("connections", () => {
  test.fixme("AU-40 · a connection hangs under its step on the canvas by a dotted line: one chip per collection with its permissions in words («Lee», «Lee · con filtro»), and it follows the step when Boni places the boxes", async () => {});
  test.fixme("AU-41 · in the view of a «Código» step the connections are a table, one row per collection and the one column «Leer», «No» or «Sí»; connecting a collection reads it and nothing more, and a row opens to set its limits, after which its cell says «Sí · con filtro»", async () => {});
  test.fixme("AU-43 · a connection's row opens «Solo estas filas» (the views' filter, with the collection's fields), «Solo estos campos» and a limit; each is saved with the draft and seen again when the step is opened", async () => {});
  test.fixme("AU-44 · under the table a sentence says all the step reads («Puede leer Libros (con filtro) y Autores. No puede crear, modificar ni eliminar nada.») and changes as the table does", async () => {});
  test.fixme("AU-46 · only «Código» shows connections: no other step of the catalogue has the table or a chip under it", async () => {});
});
