import { clock, under } from "@boni/pace";
import { expect, type Page, test } from "@playwright/test";
import { FLOW_CATALOG, FLOW_CHECK, FLOW_DETAIL, FLOWS, MAP, MODELS } from "./agent-scenarios.ts";
import { ALL_DONE, TESTED, testOf } from "./automation-data.ts";
import { openApp } from "./fixtures.ts";

/**
 * The AI steps in the editor (docs/automatizaciones.md §5.5, §5.6, §5.10 and §5.15, phase F15): the «Agente» view
 * with its connections and their limits, «Modelo», «Lo que hizo», the question in the Bandeja, and the count under a
 * cell (AU-50, AU-54, AU-125, AU-200, AU-208).
 *
 * Over the mocked server of fixtures.ts, as automations-code.spec.ts: collections whose keys and names are shaped like
 * the user's («Tareas» and «Eventos» of the agenda, «Documentos» private), the account's models as
 * `GET api/agent/planners` gives them (invented names), and what a test of the step answers as the engine records it
 * (`StepRecord.agent` and `ai`). No model is called: the step's test is the server's answer, given. AU-125 and AU-208
 * are P2's.
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
/** The account's models for its use «Agente» (`modelChoices`): its own first, then two evaluated for it. */
const PLANNERS = {
  planners: [
    {
      id: "anthropic:claude-ejemplo-grande",
      model: "claude-ejemplo-grande",
      connection: "anthropic",
      privacy: "provider",
      current: true,
    },
    {
      id: "anthropic:claude-ejemplo-rapido",
      model: "claude-ejemplo-rapido",
      connection: "anthropic",
      privacy: "provider",
      current: false,
    },
    {
      id: "openrouter:ejemplo/modelo-abierto:zdr",
      model: "ejemplo/modelo-abierto",
      connection: "openrouter",
      privacy: "zdr",
      current: false,
    },
  ],
};
const AGENT = () => ({ ...BEFORE(), "GET api/agent/planners": [PLANNERS] });
const FIVE_MIN = 5 * 60_000;
const AGENT_ID = "s_01janalista";
/** «Tareas» read and its creations asked, «Como mucho 20» as a hand takes it out of «No» (AU-196). */
const TAREAS = (more: Record<string, unknown> = {}) => ({
  collection: "tareas",
  read: {},
  create: { mode: "ask", limit: 20 },
  update: false,
  remove: false,
  ...more,
});
/** «Ordenar tareas»: the trigger and an «Agente» «Analista» with `connections` and `params`. */
const ordering = (
  id: string,
  connections: unknown[] = [TAREAS()],
  params: Record<string, unknown> = {},
) => ({
  id,
  name: "Ordenar tareas",
  updated: 1761990000000,
  steps: [
    TESTED.steps[0],
    {
      id: AGENT_ID,
      name: "Analista",
      type: "agent",
      params: { instructions: "Ordena las tareas abiertas por día", ...params },
      ...(connections.length ? { connections } : {}),
    },
  ],
  arrows: [{ from: { step: "s_inicio", output: "main" }, to: { step: AGENT_ID, input: "main" } }],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: AGENT_ID, x: 300, y: 0 },
  ],
});

const card = (page: Page, id: string) => page.locator(`.auto-card[data-step="${id}"]`);
const view = (page: Page) => page.locator(".auto-view");
const param = (page: Page, key: string) => view(page).locator(`.auto-param[data-param="${key}"]`);
const table = (page: Page) => param(page, "connections");
const rowOf = (page: Page, key: string) => table(page).locator(`tr[data-collection="${key}"]`);
const cellOf = (page: Page, key: string, action: string) =>
  rowOf(page, key).locator(`.auto-conn-cell[data-action="${action}"]`);
const limitsOf = (page: Page, key: string) =>
  table(page).locator(`.auto-conn-limits[data-collection="${key}"]`);
const salida = (page: Page) => view(page).getByRole("region", { name: "Salida" });
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
async function openStep(page: Page, id: string) {
  await card(page, id).dblclick();
  await expect(view(page)).toHaveAttribute("data-step", id);
}
/** «Ordenar tareas» opened, with its «Agente» open; the agenda's collections are there. */
async function openAgent(page: Page, automation: unknown) {
  await openApp(page, "/?still", {
    automations: [automation as never],
    agent: AGENT(),
    agenda: true,
  });
  await openCanvas(page, "Ordenar tareas", 2);
  await openStep(page, AGENT_ID);
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
              steps: {
                id: string;
                params: Record<string, unknown>;
                connections?: Record<string, unknown>[];
              }[];
            },
        ),
    `PUT api/agent/automations/${id}/draft `,
  );
const lastAgent = async (page: Page, id: string) =>
  (await drafts(page, id)).at(-1)?.steps.find((s) => s.id === AGENT_ID) ?? null;
const lastConnection = async (page: Page, id: string, key: string) =>
  (await lastAgent(page, id))?.connections?.find((c) => c.collection === key) ?? null;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe("the «Agente» step (F15)", () => {
  test("AU-50 · AU-199 · an «Agente» shows its six things in order and no key, temperature or token setting; «Modelo» offers the account's by its model and the ones evaluated for its use, keeps the choice's id and «El de la cuenta» keeps none", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a01");
    await openAgent(page, a);
    const shown = view(page).locator(".auto-view-look > .auto-param");
    await expect(shown.locator("> .auto-param-name")).toHaveText([
      "Instrucciones",
      "Modelo",
      "Conexiones",
      "Lecturas",
      "Respuesta",
      "Se ejecuta",
    ]);
    // Nothing of a model's settings: the step keeps a choice, never a key, a route or a setting (AU-199).
    await expect(view(page)).not.toContainText(/clave|temperatura|token/i);
    const model = param(page, "model").getByRole("combobox", { name: "Modelo" });
    await expect(model.locator("option")).toHaveText([
      "El de la cuenta · claude-ejemplo-grande",
      "claude-ejemplo-rapido",
      "modelo-abierto",
    ]);
    await expect(model).toHaveValue("");
    await model.selectOption("anthropic:claude-ejemplo-rapido");
    await expect
      .poll(async () => (await lastAgent(page, a.id))?.params.model)
      .toBe("anthropic:claude-ejemplo-rapido");
    await model.selectOption("");
    await expect
      .poll(async () => (await lastAgent(page, a.id))?.params)
      .toEqual({
        instructions: "Ordena las tareas abiertas por día",
      });
    // «Las hace este código» shows its code; back to «Las decide la IA», it is hidden and kept (AU-51).
    await param(page, "reads").getByRole("combobox", { name: "Lecturas" }).selectOption("code");
    const code = param(page, "code").getByRole("textbox", { name: "Código" });
    await code.fill("return $col('Tareas').find({ hecha: false });");
    await param(page, "reads").getByRole("combobox", { name: "Lecturas" }).selectOption("ai");
    await expect(param(page, "code")).toHaveCount(0);
    await expect
      .poll(async () => (await lastAgent(page, a.id))?.params)
      .toMatchObject({ reads: "ai", code: "return $col('Tareas').find({ hecha: false });" });
  });
  test("AU-199 · a «Modelo» no longer offered says so in its own list, and the account's own is named again when it is chosen by its id", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a02", [TAREAS()], {
      model: "anthropic:claude-ejemplo-viejo",
    });
    await openAgent(page, a);
    const model = param(page, "model").getByRole("combobox", { name: "Modelo" });
    await expect(model).toHaveValue("anthropic:claude-ejemplo-viejo");
    await expect(model.locator("option:checked")).toHaveText(
      "anthropic:claude-ejemplo-viejo · ya no está en la lista",
    );
  });
});

test.describe("an «Agente»'s connections (F15)", () => {
  test("AU-166 · AU-41 · «Conectar» offers only the collections a model may read and the step does not hold: never «Documentos», which is private; a collection connected only reads, and «Leer» is «No» or «Sí»", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a03");
    await openAgent(page, a);
    await table(page).getByRole("button", { name: "Conectar", exact: true }).click();
    const offered = page.getByRole("menuitemradio");
    await expect(offered).toHaveText(["Libros", "Eventos"]);
    await expect(offered.filter({ hasText: "Documentos" })).toHaveCount(0);
    await expect(offered.filter({ hasText: "Tareas" })).toHaveCount(0);
    await offered.filter({ hasText: "Eventos" }).click();
    await expect(table(page).locator("tbody tr")).toHaveCount(2);
    await expect
      .poll(() => lastConnection(page, a.id, "eventos"))
      .toEqual({ collection: "eventos", read: {}, create: false, update: false, remove: false });
    const read = page.getByRole("combobox", { name: "Leer · Eventos" });
    await expect(read).toHaveValue("yes");
    await expect(read.locator("option")).toHaveText(["No", "Sí"]);
    await read.selectOption("no");
    await expect.poll(async () => (await lastConnection(page, a.id, "eventos"))?.read).toBe(false);
  });
  test("AU-196 · AU-48 · AU-200 · a write cell taken out of «No» is born with «Como mucho 20» and says it («Preguntar · hasta 20»); its limits open under the row by action, each saved with the draft; the chip and the sentence say «decide la IA»", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a04");
    await openAgent(page, a);
    await page.getByRole("combobox", { name: "Modificar · Tareas" }).selectOption("ask");
    await expect(cellOf(page, "tareas", "update").locator(".auto-conn-use")).toHaveText("hasta 20");
    await expect
      .poll(async () => (await lastConnection(page, a.id, "tareas"))?.update)
      .toEqual({ mode: "ask", limit: 20 });
    const sentence = table(page).locator(".auto-conn-sentence");
    await expect(sentence).toHaveText(
      "Puede leer, crear y modificar Tareas (como mucho 20), lo que decida la IA. No puede eliminar nada.",
    );
    // The row opened: «Leer», «Crear» and «Modificar» each with their own; «Eliminar» at «No» has none.
    const limits = limitsOf(page, "tareas");
    await limits.locator("summary").click();
    await expect(limits.locator(".auto-conn-action-name")).toHaveText([
      "Leer",
      "Crear",
      "Modificar",
    ]);
    const update = limits.locator('.auto-conn-action[data-action="update"]');
    await expect(update.locator('[data-limit="where"]')).toBeVisible();
    const create = limits.locator('.auto-conn-action[data-action="create"]');
    await expect(create.locator('[data-limit="where"]')).toHaveCount(0);
    // «Como mucho» of «Modificar» to 5, and «Hecha» the only field the AI writes; «Día» fixed is P2's expression.
    await update.getByRole("spinbutton", { name: "Como mucho" }).fill("5");
    await expect
      .poll(async () => (await lastConnection(page, a.id, "tareas"))?.update)
      .toEqual({ mode: "ask", limit: 5 });
    for (const f of ["Título", "Día", "Inicio", "Fin"])
      await update.getByRole("combobox", { name: `Modificar · ${f}` }).selectOption("none");
    await expect
      .poll(async () => (await lastConnection(page, a.id, "tareas"))?.update)
      .toEqual({ mode: "ask", limit: 5, fields: ["hecha"] });
    await expect(cellOf(page, "tareas", "update").locator(".auto-conn-use")).toHaveText(
      "1 campo · hasta 5",
    );
    // A field fixed is the code's, never the AI's: out of `fields`, into `fixed`.
    await update.getByRole("combobox", { name: "Modificar · Hecha" }).selectOption("fixed");
    await expect
      .poll(async () => (await lastConnection(page, a.id, "tareas"))?.update)
      .toMatchObject({ mode: "ask", limit: 5, fields: [] });
    // On the canvas, the chip says who decides.
    await view(page).getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(card(page, AGENT_ID).locator(".auto-conn-chip")).toHaveText(
      "TareasLee, crea y modifica · pregunta antes · decide la IA",
    );
  });
  test("AU-200 · AU-166 · «Lo que podrá hacer» of an «Agente» says «decide la IA» and its «Como mucho»; a private collection connected since stops the publish, said by name and to take it out", async ({
    page,
  }) => {
    const a = {
      ...ordering("a_01jx8x0t2v4x6z8b0d2f4h6a05", [
        TAREAS({ remove: { mode: "yes", limit: 20 } }),
        // Made private after it was connected: the server says so at publishing (AU-166).
        { collection: "eventos", read: {}, create: false, update: false, remove: false },
      ]),
      publish: {
        abilities: [
          { collection: "tareas", action: "read", byAgent: true, steps: [AGENT_ID] },
          {
            collection: "tareas",
            action: "create",
            how: "asks",
            byAgent: true,
            steps: [AGENT_ID],
          },
          {
            collection: "tareas",
            action: "remove",
            how: "noAsk",
            byAgent: true,
            outside: true,
            steps: [AGENT_ID],
          },
        ],
        blocks: [
          {
            code: "connection.notAllowed",
            severity: "error",
            step: AGENT_ID,
            param: "connections",
            detail: { collection: "eventos", why: "private" },
          },
        ],
      },
    };
    await openApp(page, "/?still", { automations: [a as never], agent: AGENT(), agenda: true });
    await openCanvas(page, "Ordenar tareas", 2);
    await page.locator(".auto-head").getByRole("button", { name: "Publicar", exact: true }).click();
    const screen = page.locator(".auto-modal");
    await expect(
      screen.getByRole("region", { name: "Lo que podrá hacer" }).locator("li"),
    ).toHaveText([
      "Lee Tareas · decide la IA",
      "Crea filas en Tareas · pregunta · decide la IA · como mucho 20",
      "Elimina filas en Tareas · sin preguntar · decide la IA · como mucho 20 · con datos de fuera",
    ]);
    const bad = screen.getByRole("region", { name: "Antes de publicar" }).locator("li.bad");
    await expect(bad).toHaveCount(1);
    await expect(bad).toContainText("Eventos es privada: quítala de este paso");
    await expect(screen.getByRole("button", { name: "Publicar versión 1" })).toBeDisabled();
  });
});

test.describe("«Probar» of an «Agente» (F15)", () => {
  test("AU-54 · its test shows «Lo que hizo» above its answer in «Salida»: its cost first, then the lines the engine recorded, as plain text, and «y 12 más»", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a06");
    const answer = [
      {
        json: { texto: "Primero <b>Pagar</b> el [recibo](https://ejemplo.example.com)" },
        label: {},
      },
    ];
    const tested = testOf(
      {
        s_inicio: ALL_DONE.s_inicio,
        [AGENT_ID]: {
          rows: { "in:main": ALL_DONE.s_inicio.rows["out:main"], "out:main": answer },
          ms: 3600,
          agent: {
            units: [
              {
                rounds: 2,
                more: 12,
                seen: [],
                lines: [
                  {
                    op: "find",
                    collection: "tareas",
                    rows: 41,
                    where: [{ field: "hecha", op: "is", value: false }],
                    limit: 200,
                  },
                  { op: "create", collection: "tareas", state: "tested" },
                  { op: "refused", tool: "<b>borrar</b>", why: "otra" },
                ],
              },
            ],
          },
          ai: { calls: 3, models: ["claude-ejemplo-grande"], ms: 3600, cut: false },
        },
      },
      { kept: FIVE_MIN },
      a,
    );
    await openAgent(page, tested);
    const did = salida(page).getByRole("region", { name: "Lo que hizo" });
    await expect(did.locator(".auto-did-head")).toHaveText(
      "2 rondas · 3 llamadas al modelo · claude-ejemplo-grande · 3,6 s",
    );
    await expect(did.locator(".auto-did-lines li")).toHaveText([
      "Buscó 41 filas en Tareas · con filtro · hasta 200",
      "Propondría 1 fila nueva en Tareas",
      "Quiso usar «<b>borrar</b>» · no se pudo",
      "y 12 más",
    ]);
    // Text from the model or from outside is painted as text, never as HTML or a link (A-01).
    await expect(view(page).locator(".auto-did b, .auto-did a")).toHaveCount(0);
    await expect(salida(page)).toContainText(
      "Primero <b>Pagar</b> el [recibo](https://ejemplo.example.com)",
    );
    await expect(salida(page).locator("b, a[href*='ejemplo']")).toHaveCount(0);
    // Above its answer.
    const didBox = await did.boundingBox();
    const out = await salida(page)
      .getByText(/^Primero/)
      .first()
      .boundingBox();
    expect(didBox && out && didBox.y + didBox.height <= out.y).toBe(true);
  });
});

test.describe("an «Agente» on the phone (F15)", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("AU-74 · AU-50 · on the phone an «Agente» is there to read: «Modelo» and its cells cannot be changed, there is no «Conectar» nor «Desconectar», and no draft is saved", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a07");
    await openApp(page, "/?still", { automations: [a as never], agent: AGENT(), agenda: true });
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page.getByText("Ordenar tareas", { exact: true }).first().tap();
    await expect(page.locator(".auto-card")).toHaveCount(2);
    await card(page, AGENT_ID).tap();
    await expect(view(page)).toHaveAttribute("data-step", AGENT_ID);
    await expect(view(page)).toHaveClass(/\bphone\b/);
    await expect(param(page, "model").getByRole("combobox")).toBeDisabled();
    await expect(table(page).locator("tbody tr")).toHaveCount(1);
    for (const c of await table(page).getByRole("combobox").all()) await expect(c).toBeDisabled();
    await expect(view(page).getByRole("button", { name: "Conectar", exact: true })).toHaveCount(0);
    await expect(view(page).getByRole("button", { name: "Desconectar" })).toHaveCount(0);
    await limitsOf(page, "tareas").locator("summary").tap();
    for (const c of await limitsOf(page, "tareas").locator("select, input").all())
      await expect(c).toBeDisabled();
    expect(await drafts(page, a.id)).toEqual([]);
  });
});

test.describe("an «Agente» at volume (F15)", () => {
  test("AU-50 · A-15 · with 200 automations in the list, an «Agente»'s view opens at once and a cell changed is drawn at once", async ({
    page,
  }, info) => {
    const many = Array.from({ length: 199 }, (_, i) => ({
      ...TESTED,
      id: `a_01jx8x0t2v4x6z8b0d2f4m${String(i).padStart(4, "0")}`,
      name: `Revisar ${i + 1}`,
    }));
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a08", [
      TAREAS(),
      { collection: "libros", read: {}, create: false, update: false, remove: false },
    ]);
    await openApp(page, "/?still", {
      automations: [a as never, ...(many as never[])],
      agent: AGENT(),
      agenda: true,
    });
    await openCanvas(page, "Ordenar tareas", 2);
    await card(page, AGENT_ID).click();
    const pressed = clock();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector(".auto-view")?.getAttribute("data-step") === "s_01janalista" &&
        document.querySelectorAll(".auto-conn-table tbody tr").length === 2,
      null,
      { polling: "raf" },
    );
    const opening = clock() - pressed;
    const changed = clock();
    await page.getByRole("combobox", { name: "Eliminar · Libros" }).selectOption("ask");
    await page.waitForFunction(
      () =>
        document.querySelector('tr[data-collection="libros"] [data-action="remove"] .auto-conn-use')
          ?.textContent === "hasta 20",
      null,
      { polling: "raf" },
    );
    const drawn = clock() - changed;
    info.annotations.push({
      type: "A-15",
      description: `200 automations: an «Agente»'s view opened in ${opening.toFixed(0)} ms; a cell changed drawn in ${drawn.toFixed(0)} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    // Measured here (2026-11-18, headless Chrome, on the clock): opened in 49 ms from the key, a cell drawn in 20 ms.
    // The view reads no rows: «Conectar» lists the collections, «Modelo» the account's choices and «Lo que hizo» at
    // most 20 units (connections.test.ts times it over 5,000). The margins are for CI, as a step's view among 200.
    under(opening, 400, "clock", "opening an «Agente»'s view among 200 automations");
    under(drawn, 120, "clock", "drawing a cell of an «Agente» changed among 200 automations");
  });
});

test.describe("the AI steps of an automation (F15, P2)", () => {
  test.fixme("AU-125 · a «Preguntar» of a run waits as a card in the Bandeja, painted as plain text; answering it lets the run go on", async () => {});
  test.fixme("AU-208 · the count of accepted proposals shows under the cell and on the proposal's card, and not before 5 decisions", async () => {});
});
