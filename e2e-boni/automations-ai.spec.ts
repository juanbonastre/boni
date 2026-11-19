import { clock, under } from "@boni/pace";
import { expect, type Page, test } from "@playwright/test";
import { FLOW_CATALOG, FLOW_CHECK, FLOW_DETAIL, FLOWS, MAP, MODELS } from "./agent-scenarios.ts";
import { ALL_DONE, arrow, step, TESTED, testOf, withRuns } from "./automation-data.ts";
import { openApp, recorded } from "./fixtures.ts";

/**
 * The AI steps in the editor (docs/automatizaciones.md §5.5, §5.6, §5.10 and §5.15, phase F15): the «Agente» view
 * with its connections and their limits, «Modelo», «Lo que hizo», the question in the Bandeja, and the count under a
 * cell (AU-50, AU-54, AU-125, AU-200, AU-208).
 *
 * Over the mocked server of fixtures.ts, as automations-code.spec.ts: collections whose keys and names are shaped like
 * the user's («Tareas» and «Eventos» of the agenda, «Documentos» private), «Modelo»'s choices as
 * `GET api/agent/models/choices` gives them (invented names), and what a test of the step answers as the engine records it
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
/**
 * «Modelo»'s choices for an «Agente» (`GET api/agent/models/choices?kind=agent`, §5.16): the account's, his tags each
 * with the model it would take (one without a model, one expired), then the models offered for its kind.
 */
const GRANDE = "anthropic:claude-ejemplo-grande";
const RAPIDO = "anthropic:claude-ejemplo-rapido";
const ABIERTO = "openrouter:ejemplo/modelo-abierto:zdr";
const choiceOf = (id: string, model: string, connection: string, zdr = false) => ({
  id,
  model,
  connection,
  zdr,
  privacy: zdr ? "keeps-nothing" : "deletes-in-30-days",
  server: false,
});
const CHOICES = {
  kind: "agent",
  account: { value: null, answers: GRANDE },
  tags: [
    { id: "tag:rapido0000000001", name: "Rápido", answers: RAPIDO, state: "ok" },
    { id: "tag:vacia000000000001", name: "Para revisar", answers: null, state: "no-model" },
    { id: "tag:vieja000000000001", name: "De antes", answers: GRANDE, state: "expired" },
  ],
  models: [
    choiceOf(GRANDE, "claude-ejemplo-grande", "anthropic"),
    choiceOf(RAPIDO, "claude-ejemplo-rapido", "anthropic"),
    choiceOf(ABIERTO, "ejemplo/modelo-abierto", "openrouter", true),
  ],
  personal: true,
};
const AGENT = () => ({ ...BEFORE(), "GET api/agent/models/choices": [CHOICES] });
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
  test("AU-50 · AU-199 · AU-238 · an «Agente» shows its six things in order and no key, temperature or token setting; «Modelo» keeps the choice's id and «El de la cuenta» keeps none", async ({
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
    await expect(model).toHaveValue("");
    await expect(model.locator("option:checked")).toHaveText(
      "El de la cuenta · claude-ejemplo-grande",
    );
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
    // «Las hace este código» shows its code; back to «Decididas por un modelo», it is hidden and kept (AU-51).
    await param(page, "reads").getByRole("combobox", { name: "Lecturas" }).selectOption("code");
    const code = param(page, "code").getByRole("textbox", { name: "Código" });
    await code.fill("return $col('Tareas').find({ hecha: false });");
    await param(page, "reads").getByRole("combobox", { name: "Lecturas" }).selectOption("ai");
    await expect(param(page, "code")).toHaveCount(0);
    await expect
      .poll(async () => (await lastAgent(page, a.id))?.params)
      .toMatchObject({ reads: "ai", code: "return $col('Tareas').find({ hecha: false });" });
  });
  test("AU-50 · «Reintentar si el modelo falla» of an «Agente» is behind «Añadir opción», 0 when born, and keeps the number typed", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a07");
    await openAgent(page, a);
    await expect(param(page, "retries")).toHaveCount(0);
    expect((await lastAgent(page, a.id))?.params.retries).toBeUndefined();
    await view(page).getByRole("button", { name: "Añadir opción" }).click();
    await page.getByRole("menuitemradio", { name: "Reintentar si el modelo falla" }).click();
    const retries = param(page, "retries").getByRole("spinbutton");
    await expect(retries).toBeVisible();
    await retries.click();
    await page.keyboard.press("Control+a");
    await retries.pressSequentially("2", { delay: 120 });
    await expect.poll(async () => (await lastAgent(page, a.id))?.params.retries).toBe(2);
  });

  test("AU-238 · AU-241 · «Modelo» offers «El de la cuenta», the tags and the models of the step's kind, each tag with the model that would answer; a tag without a model or expired cannot be chosen", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a03");
    await openAgent(page, a);
    const model = param(page, "model").getByRole("combobox", { name: "Modelo" });
    await expect(model.locator("option")).toHaveText([
      "El de la cuenta · claude-ejemplo-grande",
      "Rápido · claude-ejemplo-rapido",
      "Para revisar · Sin modelo",
      "De antes · Caducada",
      "claude-ejemplo-grande",
      "claude-ejemplo-rapido",
      "modelo-abierto",
    ]);
    await expect(model.locator("optgroup")).toHaveCount(2);
    expect(
      await model.locator("optgroup").evaluateAll((g) => g.map((x) => x.getAttribute("label"))),
    ).toEqual(["Etiquetas", "Modelos"]);
    // «Sin modelo» and «Caducada» are there to read, never to choose (AU-241).
    await expect(model.locator('option[value="tag:vacia000000000001"]')).toBeDisabled();
    await expect(model.locator('option[value="tag:vieja000000000001"]')).toBeDisabled();
    // A tag is kept by its id, never by the model it takes now (AU-237).
    await model.selectOption("tag:rapido0000000001");
    await expect
      .poll(async () => (await lastAgent(page, a.id))?.params.model)
      .toBe("tag:rapido0000000001");
    // The choices of its kind of call, asked once when the step opened.
    const asked = (await recorded(page)).requests.filter((r) =>
      r.startsWith("GET api/agent/models/choices"),
    );
    expect(asked).toEqual(["GET api/agent/models/choices?kind=agent"]);
  });

  test("AU-199 · AU-238 · a «Modelo» no longer offered says so in its own list", async ({
    page,
  }) => {
    const a = ordering("a_01jx8x0t2v4x6z8b0d2f4h6a02", [TAREAS()], {
      model: "anthropic:claude-ejemplo-viejo",
    });
    await openAgent(page, a);
    const model = param(page, "model").getByRole("combobox", { name: "Modelo" });
    await expect(model).toHaveValue("anthropic:claude-ejemplo-viejo");
    await expect(model.locator("option:checked")).toHaveText(
      "claude-ejemplo-viejo · no disponible",
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
  test("AU-196 · AU-48 · AU-200 · a write cell taken out of «No» is born with «Como mucho 20» and says it («Preguntar · hasta 20»); its limits open under the row by action, each saved with the draft; the chip and the sentence say «decidido por un modelo»", async ({
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
      "Puede leer, crear y modificar Tareas (como mucho 20): decidido por un modelo. No puede eliminar nada.",
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
      "TareasLee, crea y modifica · pregunta antes · decidido por un modelo",
    );
  });
  test("AU-200 · AU-166 · «Lo que podrá hacer» of an «Agente» says «decidido por un modelo» and its «Como mucho»; a private collection connected since stops the publish, said by name and to take it out", async ({
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
      "Lee Tareas · decidido por un modelo",
      "Crea filas en Tareas · pregunta · decidido por un modelo · como mucho 20",
      "Elimina filas en Tareas · sin preguntar · decidido por un modelo · como mucho 20 · con datos de fuera",
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

/** A value that looks like HTML, Markdown and a link: read letter by letter wherever it is painted (A-01). */
const LOOKS_LIKE_MARKUP =
  '<img src=x onerror="window.__pwned=1"> **negrita** [enlace](https://ejemplo.example.com/x)';
const LABEL = { integrity: "own", sensitivity: "personal" };
const HOUR = 3_600_000;
const ASK_ID = "s_01jpreguntar";
const NOTIFY_ID = "s_01javisar";
const REPLY_ID = "s_01jresponder";
/** «Archivar leídos»: a trigger, a «Preguntar» «Sí o no», an «Avisar» and a «Responder», in a line. */
const archiving = (id: string, test: Record<string, unknown>) => ({
  id,
  name: "Archivar leídos",
  updated: 1761990000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual"),
    step(ASK_ID, "Preguntar", "ask", { question: "¿Archivo los leídos?", answer: "yesNo" }),
    step(NOTIFY_ID, "Avisar", "notify", { text: "Archivados" }),
    step(REPLY_ID, "Responder", "reply", { text: "Hecho" }),
  ],
  arrows: [arrow("s_inicio", ASK_ID), arrow(ASK_ID, NOTIFY_ID), arrow(NOTIFY_ID, REPLY_ID)],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: ASK_ID, x: 300, y: 0 },
    { step: NOTIFY_ID, x: 600, y: 0 },
    { step: REPLY_ID, x: 900, y: 0 },
  ],
  test,
});
/** The «Preguntar»'s question while its test waits, until `until`; `ended` once it ended. */
const askOf = (until: number, ended?: "answered" | "noAnswer") => ({
  answer: "yesNo",
  mode: "all",
  questions: [{ text: LOOKS_LIKE_MARKUP, label: LABEL }],
  until,
  ...(ended ? { ended } : {}),
});
/** A test that waits at the «Preguntar» and, answered, goes on as `then` says. */
const waitingTest = (until: number, then: Record<string, unknown>) => ({
  state: "waiting",
  steps: {
    s_inicio: { out: { main: 1 } },
    [ASK_ID]: { state: "waiting", in: { main: 1 }, out: {}, ask: askOf(until) },
  },
  answered: then,
});
/** What the answered test gives: two notices (the second groups 12 more) and its answer, both looking like markup. */
const ANSWERED = (until: number) => ({
  state: "done",
  steps: {
    [ASK_ID]: { in: { main: 1 }, out: { main: 1 }, ask: askOf(until, "answered") },
    [NOTIFY_ID]: {
      in: { main: 1 },
      out: { main: 1 },
      notices: {
        notices: [
          {
            automation: "a_01jx8x0t2v4x6z8b0d2f4h6p01",
            step: NOTIFY_ID,
            text: "Archivados <b>3</b>",
            label: LABEL,
            where: "desktop",
          },
          {
            automation: "a_01jx8x0t2v4x6z8b0d2f4h6p01",
            step: NOTIFY_ID,
            text: "",
            label: LABEL,
            where: "desktop",
            more: 12,
          },
        ],
        sent: false,
      },
    },
    [REPLY_ID]: { in: { main: 1 }, out: { main: 1 } },
  },
  reply: { step: REPLY_ID, text: LOOKS_LIKE_MARKUP, label: LABEL },
});
const testBar = (page: Page) => page.locator(".auto-test-bar");
const askPanel = (page: Page) => testBar(page).getByRole("region", { name: "Pregunta" });
/** Every body «Probar» sent, as the mock received them. */
const testBodies = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __autoTests?: string[] }).__autoTests ?? []).map(
      (b) => JSON.parse(b) as Record<string, unknown>,
    ),
  );
/** A question of an automation's «Preguntar» in the Bandeja, as `GET api/agent/requests` gives it. */
const automationAsk = (
  id: string,
  control: "yesno" | "several",
  prompt: string,
  more: Record<string, unknown> = {},
  options: string[] = [],
) => ({
  id,
  run: `r_${id}`,
  view: {
    kind: "ask",
    id,
    control,
    prompt: { t: "v", value: prompt, ...LABEL },
    options: options.map((o) => ({ t: "v", value: o, ...LABEL })),
    automation: {
      automation: "a_01jx8x0t2v4x6z8b0d2f4h6p01",
      run: `r_${id}`,
      step: ASK_ID,
      i: 0,
      answer: control === "yesno" ? "yesNo" : "several",
    },
  },
  created: Date.now() - HOUR,
  expires: Date.now() + 3 * 24 * HOUR,
  about: null,
  open: null,
  automation: { id: "a_01jx8x0t2v4x6z8b0d2f4h6p01", name: "Archivar <i>leídos</i>" },
  ...more,
});
const ANSWER_DONE = { run: "r_x", status: "done", replies: [], proposals: [], notices: [] };

test.describe("the steps that talk to him (F15, P2)", () => {
  test("AU-125 · a «Preguntar» of a run waits as a card in the Bandeja that names its automation, painted as plain text; «Sí o no» and «Varias opciones» send their answer; a device the server says may not answer (`mayAnswer`) gets neither its controls nor «Descartar», and the reason", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      agent: {
        ...BEFORE(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [
          {
            requests: [
              automationAsk("q_01jsino", "yesno", LOOKS_LIKE_MARKUP),
              automationAsk("q_01jvarios", "several", "¿Cuáles archivo?", {}, [
                "Rayuela",
                "Ficciones",
                "Pedro Páramo",
              ]),
              automationAsk("q_01jcompartido", "yesno", "¿Sigo?", { mayAnswer: false }),
            ],
          },
        ],
        "POST api/agent/requests/:id/answer": [ANSWER_DONE, ANSWER_DONE],
      },
    });
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Bandeja/ })
      .click();
    const panel = page.locator(".inbox-panel");
    const cards = panel.locator(".request-card");
    await expect(cards).toHaveCount(3);
    const yesNo = cards.first();
    // His words and the automation's name, letter by letter: never HTML, Markdown or a link (A-01).
    await expect(yesNo.locator(".request-prompt")).toHaveText(LOOKS_LIKE_MARKUP);
    await expect(yesNo).toContainText("De «Archivar <i>leídos</i>»");
    await expect(yesNo.locator("img, a, i, strong")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
    await yesNo.getByRole("button", { name: "Sí", exact: true }).click();
    await expect(cards).toHaveCount(2);
    const several = cards.first();
    await several.getByRole("button", { name: "Rayuela" }).click();
    await several.getByRole("button", { name: "Pedro Páramo" }).click();
    await several.getByRole("button", { name: "Enviar" }).click();
    await expect(cards).toHaveCount(1);
    // The server says this device may not answer (decision 26: its step asks for a personal one): read-only, with the
    // reason, since putting it away follows the same rule.
    const shared = cards.first();
    await expect(shared.locator(".request-prompt")).toHaveText("¿Sigo?");
    await expect(shared).toContainText("Solo desde un dispositivo personal");
    await expect(shared.getByRole("button")).toHaveCount(0);
    const sent = await page.evaluate(() =>
      ((window as unknown as { __requests?: string[] }).__requests ?? []).filter((r) =>
        r.startsWith("POST api/agent/requests/"),
      ),
    );
    expect(sent).toEqual([
      'POST api/agent/requests/q_01jsino/answer {"yes":true}',
      'POST api/agent/requests/q_01jvarios/answer {"choices":[0,2]}',
    ]);
  });

  test("AU-125 · A-15 · 200 questions of 200 automations in the Bandeja open at once, each naming its automation", async ({
    page,
  }, info) => {
    const many = Array.from({ length: 200 }, (_, i) => {
      const id = `q_01jvol${String(i).padStart(4, "0")}`;
      return automationAsk(
        id,
        i % 2 ? "yesno" : "several",
        `¿Archivo el libro ${i + 1}?`,
        {
          automation: {
            id: `a_01jx8x0t2v4x6z8b0d2f4v${String(i).padStart(4, "0")}`,
            name: `Archivar ${i + 1}`,
          },
        },
        i % 2 ? [] : ["Rayuela", "Ficciones", "Pedro Páramo"],
      );
    });
    await openApp(page, "/?still", {
      agent: {
        ...BEFORE(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [{ requests: many }],
      },
    });
    const top = page.locator(".topbar").getByRole("button", { name: /^Bandeja/ });
    await expect(top).toHaveText("Bandeja (200)");
    const pressed = clock();
    await top.click();
    await page.waitForFunction(
      () => document.querySelectorAll(".inbox-panel .request-card").length === 200,
      null,
      { polling: "raf" },
    );
    const opened = clock() - pressed;
    await expect(page.locator(".inbox-panel .request-card").last()).toContainText(
      "De «Archivar 200»",
    );
    info.annotations.push({
      type: "A-15",
      description: `200 automation questions in the Bandeja: drawn in ${opened.toFixed(0)} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    // The margin is for CI: the cards are the Bandeja's own, with one line more each.
    under(opened, 1_500, "clock", "opening the Bandeja with 200 automation questions");
  });

  test("AU-203 · AU-201 · AU-202 · «Probar» that reaches a «Preguntar» asks in its own panel, never in the Bandeja; «Enviar» goes on with the answer, and SALIDA says what «Avisar» would send and the answer of «Responder», as plain text", async ({
    page,
  }) => {
    const until = Date.now() + 24 * HOUR;
    const a = archiving("a_01jx8x0t2v4x6z8b0d2f4h6p01", waitingTest(until, ANSWERED(until)));
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE() });
    await openCanvas(page, "Archivar leídos", 4);
    await testBar(page).locator(".auto-test-go").click();
    await expect(testBar(page).locator(".auto-log-line")).toHaveText(
      "Última prueba hace un momento · esperando respuesta",
    );
    const ask = askPanel(page);
    await expect(ask.locator(".auto-ask-text")).toHaveText(LOOKS_LIKE_MARKUP);
    await expect(ask.locator("img, a, strong")).toHaveCount(0);
    await expect(ask.locator(".auto-ask-until")).toContainText("hasta");
    // Not in the Bandeja: a test's question is the editor's own.
    await expect(page.locator(".topbar").getByRole("button", { name: /^Bandeja/ })).toHaveText(
      "Bandeja",
    );
    const send = ask.getByRole("button", { name: "Enviar" });
    await expect(send).toBeDisabled();
    await ask.getByRole("button", { name: "Sí", exact: true }).click();
    await send.click();
    await expect(testBar(page).locator(".auto-log-line")).toContainText("completada");
    await expect(askPanel(page)).toHaveCount(0);
    const bodies = await testBodies(page);
    expect(bodies.at(-1)).toEqual({
      trigger: "",
      fields: {},
      answers: { [ASK_ID]: [{ yes: true }] },
    });
    // «Avisar»: what it would send and where; the notice that groups the rest says how many.
    await openStep(page, NOTIFY_ID);
    await expect(salida(page).locator(".auto-people .auto-did-title")).toHaveText("Avisaría");
    await expect(salida(page).locator(".auto-people li")).toHaveText([
      "Archivados <b>3</b> · ordenador",
      "y 12 más · ordenador",
    ]);
    await page.keyboard.press("Escape");
    // «Responder»: the test's answer, whole, as text.
    await openStep(page, REPLY_ID);
    await expect(salida(page).locator(".auto-people-reply")).toHaveText(LOOKS_LIKE_MARKUP);
    await expect(salida(page).locator(".auto-people img, .auto-people a")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await openStep(page, ASK_ID);
    await expect(salida(page).locator(".auto-people .auto-did-head")).toHaveText("Respondida");
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
  });

  test("AU-203 · «Sin respuesta» answers every question with nothing, and a test the server no longer has says «Prueba caducada»", async ({
    page,
  }) => {
    const until = Date.now() + 24 * HOUR;
    const gone = archiving(
      "a_01jx8x0t2v4x6z8b0d2f4h6p01",
      waitingTest(until, { steps: {}, expired: true }),
    );
    await openApp(page, "/?still", { automations: [gone as never], agent: BEFORE() });
    await openCanvas(page, "Archivar leídos", 4);
    await testBar(page).locator(".auto-test-go").click();
    await askPanel(page).getByRole("button", { name: "Sin respuesta" }).click();
    await expect(page.locator(".toast")).toContainText("Prueba caducada");
    expect((await testBodies(page)).at(-1)).toEqual({
      trigger: "",
      fields: {},
      answers: { [ASK_ID]: [null] },
    });
  });

  test("AU-125 · «Opciones» of a «Preguntar» shows only for «Una opción» and «Varias opciones», one line each with «Borrar», «Añadir» below, saved as a list of texts", async ({
    page,
  }) => {
    const a = archiving("a_01jx8x0t2v4x6z8b0d2f4h6p01", { steps: {} });
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE() });
    await openCanvas(page, "Archivar leídos", 4);
    await openStep(page, ASK_ID);
    await expect(param(page, "options")).toHaveCount(0);
    await param(page, "answer").getByRole("combobox").selectOption({ label: "Una opción" });
    const options = param(page, "options");
    await expect(options).toBeVisible();
    await options.getByRole("button", { name: "Añadir" }).click();
    await options
      .getByRole("textbox", { name: "Opción 1" })
      .pressSequentially("Leído", { delay: 30 });
    await options.getByRole("button", { name: "Añadir" }).click();
    await options
      .getByRole("textbox", { name: "Opción 2" })
      .pressSequentially("Pendiente", { delay: 30 });
    await expect
      .poll(async () => {
        const last = (await drafts(page, a.id)).at(-1);
        return last?.steps.find((x) => x.id === ASK_ID)?.params;
      })
      .toMatchObject({ answer: "one", options: ["Leído", "Pendiente"] });
    await options.getByRole("button", { name: "Borrar: Opción 1" }).click();
    await expect
      .poll(async () => {
        const last = (await drafts(page, a.id)).at(-1);
        return last?.steps.find((x) => x.id === ASK_ID)?.params.options;
      })
      .toEqual(["Pendiente"]);
  });

  test("AU-203 · a card of a cancelled run says «Pregunta cancelada» when answered, an expired one «Pregunta caducada», and either leaves the list", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      agent: {
        ...BEFORE(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [
          {
            requests: [
              automationAsk("q_01jcancelada", "yesno", "¿Archivo este?", { mayAnswer: true }),
              automationAsk("q_01jcaducada", "yesno", "¿Y este otro?", { mayAnswer: true }),
            ],
          },
        ],
        "POST api/agent/requests/:id/answer": [
          { ...ANSWER_DONE, run: null, error: "run-cancelled" },
          { ...ANSWER_DONE, run: null, error: "run-expired" },
        ],
      },
    });
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Bandeja/ })
      .click();
    const cards = page.locator(".inbox-panel .request-card");
    await expect(cards).toHaveCount(2);
    await cards.first().getByRole("button", { name: "Sí", exact: true }).click();
    await expect(cards.first().getByRole("alert")).toContainText("Pregunta cancelada");
    await cards.nth(1).getByRole("button", { name: "No", exact: true }).click();
    await expect(cards.nth(1).getByRole("alert")).toContainText("Pregunta caducada");
    await cards.first().getByRole("button", { name: "Quitar" }).click();
    await expect(cards).toHaveCount(1);
  });

  test("AU-125 · «Solo desde un dispositivo personal» of a «Preguntar» is behind «Añadir opción», off when born, and on once added", async ({
    page,
  }) => {
    const a = archiving("a_01jx8x0t2v4x6z8b0d2f4h6p01", { steps: {} });
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE() });
    await openCanvas(page, "Archivar leídos", 4);
    await openStep(page, ASK_ID);
    await expect(param(page, "personal")).toHaveCount(0);
    await view(page).getByRole("button", { name: "Añadir opción" }).click();
    await page.getByRole("menuitemradio", { name: "Solo desde un dispositivo personal" }).click();
    await expect(param(page, "personal").getByRole("checkbox")).toBeChecked();
    await expect
      .poll(async () => {
        const last = (await drafts(page, a.id)).at(-1);
        return last?.steps.find((x) => x.id === ASK_ID)?.params.personal;
      })
      .toBe(true);
  });

  test("AU-201 · AU-125 · «Se ejecuta» and «Dónde» of an «Avisar» are behind «Añadir opción»: «Una vez con todas las filas» and «Ordenador y móvil» when born, «Una vez por fila» and «Solo móvil» saved once chosen", async ({
    page,
  }) => {
    const a = archiving("a_01jx8x0t2v4x6z8b0d2f4h6p01", { steps: {} });
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE() });
    await openCanvas(page, "Archivar leídos", 4);
    await openStep(page, NOTIFY_ID);
    await expect(param(page, "mode")).toHaveCount(0);
    await expect(param(page, "where")).toHaveCount(0);
    const add = view(page).getByRole("button", { name: "Añadir opción" });
    await add.click();
    await page.getByRole("menuitemradio", { name: "Se ejecuta" }).click();
    const mode = param(page, "mode").getByRole("combobox");
    await expect(mode.locator("option:checked")).toHaveText("Una vez con todas las filas");
    await mode.selectOption({ label: "Una vez por fila" });
    await add.click();
    await page.getByRole("menuitemradio", { name: "Dónde" }).click();
    const where = param(page, "where").getByRole("combobox");
    await expect(where.locator("option:checked")).toHaveText("Ordenador y móvil");
    await where.selectOption({ label: "Solo móvil" });
    await expect
      .poll(async () => {
        const last = (await drafts(page, a.id)).at(-1);
        return last?.steps.find((x) => x.id === NOTIFY_ID)?.params;
      })
      .toMatchObject({ mode: "perRow", where: "phone" });
  });

  test("AU-203 · a run that waits for an answer says until when in «Ejecuciones», at the device's zone, and is not a failure", async ({
    page,
  }) => {
    const now = Date.now();
    const runs = withRuns(now);
    const waiting = {
      ...runs,
      runs: [
        {
          id: "r_01jespera",
          at: now - HOUR / 2,
          version: 2,
          state: "waiting",
          until: now + 20 * HOUR,
        },
        ...runs.runs,
      ],
    };
    await openApp(page, "/?still", { automations: [waiting as never], agent: BEFORE() });
    await openCanvas(page, TESTED.name, TESTED.steps.length);
    await page.locator(".auto-head").getByRole("tab", { name: "Ejecuciones" }).click();
    const first = page.locator(".auto-runs-item").first();
    await expect(first).toContainText(
      /Esperando respuesta · hasta \d{1,2} \S+,? \d{4},? \d{2}:\d{2}/,
    );
    await expect(first.locator(".bad")).toHaveCount(0);
  });

  test("AU-248 · AU-246 · «Avisar» and «Preguntar» are one step with «Acción»: changing it keeps the text and «Por dónde», a closed list of «Notificación» and «Bandeja» painted as boxes, one at least, born with the notification for «Avisar» and both for «Preguntar»", async ({
    page,
  }) => {
    const a = archiving("a_01jx8x0t2v4x6z8b0d2f4h6p01", { steps: {} });
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE() });
    await openCanvas(page, "Archivar leídos", 4);
    const stepOf = async (id: string) =>
      (await drafts(page, a.id)).at(-1)?.steps.find((x) => x.id === id);
    // «Preguntar» is born with both, and its first view is the action, the question, «Por dónde», the answer and the
    // days of wait.
    await openStep(page, ASK_ID);
    await expect(view(page).locator(".auto-param")).toHaveCount(5);
    const askVia = param(page, "via");
    await expect(askVia.getByRole("checkbox", { name: "Notificación" })).toBeChecked();
    await expect(askVia.getByRole("checkbox", { name: "Bandeja" })).toBeChecked();
    await page.keyboard.press("Escape");
    // «Avisar» is born with the notification alone, and the last box ticked cannot be unticked.
    await openStep(page, NOTIFY_ID);
    await expect(view(page).locator(".auto-param")).toHaveCount(3);
    const action = param(page, "action").getByRole("combobox");
    await expect(action.locator("option:checked")).toHaveText("Avisar");
    await expect(action.locator("option")).toHaveText(["Avisar", "Preguntar"]);
    const via = param(page, "via");
    const notification = via.getByRole("checkbox", { name: "Notificación" });
    const inbox = via.getByRole("checkbox", { name: "Bandeja" });
    await expect(notification).toBeChecked();
    await expect(notification).toBeDisabled();
    await expect(inbox).not.toBeChecked();
    await inbox.check();
    await expect
      .poll(async () => (await stepOf(NOTIFY_ID))?.params.via)
      .toEqual(["notification", "inbox"]);
    // «Acción»: the step becomes a «Preguntar» with its text as the question and the same «Por dónde».
    await action.selectOption({ label: "Preguntar" });
    await expect
      .poll(async () => {
        const s = await stepOf(NOTIFY_ID);
        return s && { type: s.type, name: s.name, params: s.params };
      })
      .toEqual({
        type: "ask",
        name: "Preguntar 2",
        params: { question: "Archivados", via: ["notification", "inbox"] },
      });
    await expect(view(page).locator(".auto-param")).toHaveCount(5);
    await expect(param(page, "answer")).toBeVisible();
    await expect(param(page, "waitDays")).toBeVisible();
    await notification.uncheck();
    await expect(inbox).toBeDisabled();
    await expect.poll(async () => (await stepOf(NOTIFY_ID))?.params.via).toEqual(["inbox"]);
    // And back to «Avisar»: what only a question has goes, named.
    await action.selectOption({ label: "Avisar" });
    await expect
      .poll(async () => {
        const s = await stepOf(NOTIFY_ID);
        return s && { type: s.type, params: s.params };
      })
      .toEqual({ type: "notify", params: { text: "Archivados", via: ["inbox"] } });
    await expect(view(page).locator(".auto-param")).toHaveCount(3);
  });

  test("AU-246 · A-15 · an «Avisar» with «Bandeja» leaves a card with its text, its automation and only «Descartar», painted as plain text; 200 of them open at once", async ({
    page,
  }, info) => {
    const notice = (i: number, text: string) => {
      const id = `q_01javiso${String(i).padStart(4, "0")}`;
      return {
        id,
        run: `r_${id}`,
        view: {
          kind: "notice",
          id,
          prompt: { t: "v", value: text, ...LABEL },
          automation: {
            automation: `a_01jx8x0t2v4x6z8b0d2f4v${String(i).padStart(4, "0")}`,
            run: `r_${id}`,
            step: NOTIFY_ID,
          },
        },
        created: Date.now() - HOUR,
        expires: Date.now() + 30 * 24 * HOUR,
        about: null,
        open: null,
        automation: {
          id: `a_01jx8x0t2v4x6z8b0d2f4v${String(i).padStart(4, "0")}`,
          name: i === 0 ? "Archivar <i>leídos</i>" : `Archivar ${i + 1}`,
        },
      };
    };
    const many = Array.from({ length: 200 }, (_, i) =>
      notice(i, i === 0 ? LOOKS_LIKE_MARKUP : `Archivados ${i + 1}`),
    );
    await openApp(page, "/?still", {
      agent: {
        ...BEFORE(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [{ requests: many }],
        "POST api/agent/requests/:id/dismiss": [{ dismissed: true }],
      },
    });
    const top = page.locator(".topbar").getByRole("button", { name: /^Bandeja/ });
    await expect(top).toHaveText("Bandeja (200)");
    const pressed = clock();
    await top.click();
    await page.waitForFunction(
      () => document.querySelectorAll(".inbox-panel .notice-card").length === 200,
      null,
      { polling: "raf" },
    );
    const opened = clock() - pressed;
    info.annotations.push({
      type: "A-15",
      description: `200 automation notices in the Bandeja: drawn in ${opened.toFixed(0)} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    const cards = page.locator(".inbox-panel .notice-card");
    const first = cards.first();
    await expect(first.locator(".inbox-kind")).toHaveText("Aviso");
    await expect(first.locator(".request-prompt")).toHaveText(LOOKS_LIKE_MARKUP);
    await expect(first).toContainText("De «Archivar <i>leídos</i>»");
    await expect(first.locator("img, a, i, strong")).toHaveCount(0);
    // Nothing to answer: «Descartar» alone.
    await expect(first.getByRole("button")).toHaveText(["Descartar"]);
    await first.getByRole("button", { name: "Descartar" }).click();
    await expect(cards).toHaveCount(199);
    const sent = await page.evaluate(() =>
      ((window as unknown as { __requests?: string[] }).__requests ?? []).filter((r) =>
        r.startsWith("POST api/agent/requests/"),
      ),
    );
    expect(sent.map((r) => r.split(" ").slice(0, 2).join(" "))).toEqual([
      "POST api/agent/requests/q_01javiso0000/dismiss",
    ]);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
    // The margin is for CI, as the 200 questions': a notice card is lighter than a question's.
    under(opened, 1_500, "clock", "opening the Bandeja with 200 automation notices");
  });

  test("AU-247 · A-15 · a waiting run's questions are answered from its run in «Ejecuciones», one at a time, as plain text; a run the server says this device may not answer shows them with the reason and no controls", async ({
    page,
  }, info) => {
    const now = Date.now();
    const questions = Array.from({ length: 20 }, (_, i) => ({
      text: i === 0 ? LOOKS_LIKE_MARKUP : `¿Archivo el libro ${i + 1}?`,
      options: [],
      answered: false,
    }));
    const a = {
      ...archiving("a_01jx8x0t2v4x6z8b0d2f4h6p01", { steps: {} }),
      published: { versions: 1 },
      runs: [
        {
          id: "r_01jespera",
          at: now - HOUR / 2,
          version: 1,
          state: "waiting",
          until: now + 20 * HOUR,
          steps: {
            s_inicio: { state: "done", in: {}, out: { main: 1 }, ms: 5 },
            [ASK_ID]: { state: "waiting", in: { main: 20 }, out: {}, ms: 10 },
          },
          asks: [
            { step: ASK_ID, answer: "yesNo", until: now + 20 * HOUR, mayAnswer: true, questions },
          ],
        },
        {
          id: "r_01jcompartido",
          at: now - HOUR,
          version: 1,
          state: "waiting",
          until: now + 10 * HOUR,
          steps: {
            s_inicio: { state: "done", in: {}, out: { main: 1 }, ms: 5 },
            [ASK_ID]: { state: "waiting", in: { main: 1 }, out: {}, ms: 10 },
          },
          asks: [
            {
              step: ASK_ID,
              answer: "yesNo",
              until: now + 10 * HOUR,
              mayAnswer: false,
              questions: [{ text: "¿Sigo?", options: [], answered: false }],
            },
          ],
        },
      ],
    };
    await openApp(page, "/?still", { automations: [a as never], agent: BEFORE() });
    await openCanvas(page, "Archivar leídos", 4);
    await page.locator(".auto-head").getByRole("tab", { name: "Ejecuciones" }).click();
    const items = page.locator(".auto-runs-item");
    await expect(items).toHaveCount(2);
    const pressed = clock();
    await items.first().click();
    await page.waitForFunction(
      () => document.querySelectorAll(".auto-run-asks .auto-ask-question").length === 20,
      null,
      { polling: "raf" },
    );
    const opened = clock() - pressed;
    info.annotations.push({
      type: "A-15",
      description: `a waiting run with 20 questions opened in «Ejecuciones» in ${opened.toFixed(0)} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    const asks = page.locator(".auto-run-asks");
    await expect(asks.locator(".auto-ask-head")).toContainText("Preguntar");
    await expect(asks.locator(".auto-ask-until")).toContainText("hasta");
    const q = asks.locator(".auto-ask-question");
    await expect(q.first().locator(".auto-ask-text")).toHaveText(LOOKS_LIKE_MARKUP);
    await expect(asks.locator("img, a, strong")).toHaveCount(0);
    const send = q.first().getByRole("button", { name: "Enviar" });
    await expect(send).toBeDisabled();
    await q.first().getByRole("button", { name: "Sí", exact: true }).click();
    await send.click();
    await expect(q.first().locator(".auto-ask-done")).toHaveText("Respondida");
    await q.nth(1).getByRole("button", { name: "Sin respuesta" }).click();
    await expect(q.nth(1).locator(".auto-ask-done")).toHaveText("Respondida");
    const answered = await page.evaluate(() =>
      ((window as unknown as { __autoAnswer?: string[] }).__autoAnswer ?? []).map(
        (b) => JSON.parse(b) as Record<string, unknown>,
      ),
    );
    expect(answered).toEqual([
      { run: "r_01jespera", step: ASK_ID, i: 0, answer: { yes: true } },
      { run: "r_01jespera", step: ASK_ID, i: 1 },
    ]);
    // A device the server says may not answer (decision 26): the question, the reason, and nothing to press.
    await items.nth(1).click();
    await expect(asks.locator(".auto-ask-text")).toHaveText(["¿Sigo?"]);
    await expect(asks).toContainText("Solo desde un dispositivo personal");
    await expect(asks.getByRole("button")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
    // AU-203: 20 questions a run at most, so 20 is his volume here; the margin is for CI.
    under(opened, 1_500, "clock", "opening a waiting run with 20 questions in «Ejecuciones»");
  });
});

test.describe("the AI steps of an automation (F15, P2)", () => {
  const EVENTOS = {
    collection: "eventos",
    read: {},
    create: { mode: "yes", limit: 20 },
    update: false,
    remove: false,
  };
  test("AU-208 · the count of his answers shows under the cell from 5 decisions on, «Sí · en pausa» while paused, and none under a mode the draft changed", async ({
    page,
  }) => {
    const id = "a_01jx8x0t2v4x6z8b0d2f4h6r08";
    await openAgent(page, {
      ...ordering(id, [TAREAS({ update: { mode: "ask", limit: 20 } }), EVENTOS]),
      learning: [
        {
          step: AGENT_ID,
          collection: "tareas",
          action: "create",
          mode: "ask",
          decided: 20,
          right: 18,
        },
        // Published as «Sí», the draft has it at «Preguntar»: another count.
        {
          step: AGENT_ID,
          collection: "tareas",
          action: "update",
          mode: "yes",
          decided: 9,
          right: 9,
        },
        {
          step: AGENT_ID,
          collection: "eventos",
          action: "create",
          mode: "yes",
          decided: 3,
          right: 0,
          paused: true,
        },
      ],
    });
    await expect(cellOf(page, "tareas", "create").locator(".auto-conn-use")).toContainText(
      "18 de 20 aceptadas",
    );
    await expect(cellOf(page, "tareas", "update")).not.toContainText("sin deshacer");
    const paused = cellOf(page, "eventos", "create");
    await expect(paused.locator(".auto-conn-use")).toContainText("Sí · en pausa");
    // Fewer than 5 decisions: no count.
    await expect(paused).not.toContainText("de 3");
  });

  /** A pause and a suggestion as `GET requests` gives them (AU-209, AU-210). */
  const LEARNING = (mayDecide: boolean) => [
    {
      kind: "suggested",
      automation: "a_01jx8x0t2v4x6z8b0d2f4h6r09",
      name: "Ordenar tareas",
      step: AGENT_ID,
      stepName: "Analista",
      collection: "tareas",
      collectionName: "Tareas",
      action: "create",
      why: null,
      decided: 20,
      right: 19,
      at: Date.now() - HOUR,
      mayDecide,
    },
    {
      kind: "paused",
      automation: "a_01jx8x0t2v4x6z8b0d2f4h6r09",
      name: "Ordenar tareas",
      step: AGENT_ID,
      stepName: "Analista",
      collection: "eventos",
      collectionName: "Eventos",
      action: "create",
      why: "inARow",
      decided: 3,
      right: 0,
      at: Date.now() - 2 * HOUR,
      mayDecide,
    },
  ];
  const openInbox = async (page: Page) => {
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Bandeja/ })
      .click();
    return page.locator(".inbox-panel .learning-card");
  };

  test("AU-209 · AU-210 · the Bandeja's cards of a suggestion and a pause: «No» and «Quitar pausa» name the cell and never a «Sí», and «Abrir» opens the automation", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [ordering("a_01jx8x0t2v4x6z8b0d2f4h6r09", [TAREAS(), EVENTOS]) as never],
      agent: {
        ...AGENT(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [{ requests: [], learning: LEARNING(true) }],
      },
      agenda: true,
    });
    let cards = await openInbox(page);
    await expect(cards).toHaveCount(2);
    await expect(cards.first().locator(".inbox-kind")).toHaveText("Sugerencia");
    await expect(cards.first().locator("h3")).toHaveText("Ordenar tareas: Analista en Tareas");
    await expect(cards.first()).toContainText("19 de 20 aceptadas");
    await expect(cards.nth(1).locator(".inbox-kind")).toHaveText("En pausa");
    await expect(cards.nth(1)).toContainText("3 seguidas deshechas, rechazadas o corregidas");
    // «Abrir» opens the automation; the cards wait in the Bandeja.
    await cards.nth(1).getByRole("button", { name: "Abrir" }).click();
    await expect(page.getByRole("textbox", { name: "Nombre de la automatización" })).toHaveValue(
      "Ordenar tareas",
    );
    if (!(await cards.first().isVisible())) cards = await openInbox(page);
    await expect(cards).toHaveCount(2);
    await cards.first().getByRole("button", { name: "No", exact: true }).click();
    await expect(cards).toHaveCount(1);
    await cards.first().getByRole("button", { name: "Quitar pausa" }).click();
    await expect(cards).toHaveCount(0);
    const asked = await page.evaluate(() => (window as { __autoLearn?: string[] }).__autoLearn);
    expect(asked?.map((x) => JSON.parse(x))).toEqual([
      { do: "decline", step: AGENT_ID, collection: "tareas", action: "create" },
      { do: "unpause", step: AGENT_ID, collection: "eventos", action: "create" },
    ]);
    // What the screen sends names the cell: no «Sí», no print, nothing the server would trust.
    expect(JSON.stringify(asked)).not.toMatch(/yes|print|byAgent|reach/);
  });

  test("AU-209 · AU-210 · on a shared device the cards are read-only: «Solo desde un dispositivo personal», no «Abrir», «No» or «Quitar pausa»", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      sharedDevice: true,
      agent: {
        ...BEFORE(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [{ requests: [], learning: LEARNING(false) }],
      },
    });
    const cards = await openInbox(page);
    await expect(cards).toHaveCount(2);
    for (const i of [0, 1]) {
      await expect(cards.nth(i)).toContainText("Solo desde un dispositivo personal");
      await expect(cards.nth(i).getByRole("button")).toHaveCount(0);
    }
  });
});

test.describe("«Revisar instrucciones» and «Ver el cambio» (F16, AU-211)", () => {
  const MAIL_ID = "a_01jx8x0t2v4x6z8b0d2f4h6r11";
  const SUGGESTION = "r_01jx8x0t2v4x6z8b0d2f4h6r12";
  /** What the server lists in `instructions`: one rule and one example added over his panels. */
  const SUGGESTED = (mayDecide: boolean) => [
    {
      kind: "instructions",
      id: SUGGESTION,
      automation: MAIL_ID,
      name: "Leer correo",
      rules: {
        before: [{ sender: "ejemplo.boletin@example.com", do: "skip", collection: null }],
        added: [{ sender: LOOKS_LIKE_MARKUP, do: "collection", collection: "Tareas" }],
      },
      examples: {
        before: [],
        added: [{ subject: LOOKS_LIKE_MARKUP, want: ["Pagar la cuota de ejemplo"] }],
      },
      before: 14,
      after: 18,
      total: 20,
      at: Date.now() - HOUR,
      mayDecide,
    },
  ];
  const openInbox = async (page: Page) => {
    await page
      .locator(".topbar")
      .getByRole("button", { name: /^Bandeja/ })
      .click();
    return page.locator(".inbox-panel .instructions-card");
  };
  const change = (page: Page) => page.getByRole("dialog", { name: "Ver el cambio" });

  test("AU-211 · the Bandeja's «Sugerencia» shows the change before and after as plain text, and «Aceptar» sends only which suggestion, never a «Sí» nor a publish", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [{ ...ordering(MAIL_ID), name: "Leer correo" } as never],
      agent: {
        ...AGENT(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [{ requests: [], instructions: SUGGESTED(true) }],
      },
      agenda: true,
    });
    const cards = await openInbox(page);
    await expect(cards).toHaveCount(1);
    await expect(cards.locator(".inbox-kind")).toHaveText("Sugerencia");
    await expect(cards.locator("h3")).toHaveText("Leer correo");
    await expect(cards).toContainText("Acertadas: 14 → 18 de 20");
    await cards.getByRole("button", { name: "Ver el cambio" }).click();
    const dialog = change(page);
    await expect(dialog.getByRole("heading", { level: 3 })).toHaveText(["Antes", "Después"]);
    const before = dialog.getByRole("region", { name: "Antes" });
    const after = dialog.getByRole("region", { name: "Después" });
    await expect(before.locator("li")).toHaveText(["ejemplo.boletin@example.com · No leer"]);
    await expect(before).toContainText("Ninguno");
    await expect(after.locator("li[data-new]")).toHaveText([
      `Nuevo${LOOKS_LIKE_MARKUP} · Tareas`,
      `Nuevo${LOOKS_LIKE_MARKUP} · Pagar la cuota de ejemplo`,
    ]);
    // Someone else's text, letter by letter: no image, no bold, no link made of it.
    await expect(dialog.locator("img, strong, a")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
    await dialog.getByRole("button", { name: "Aceptar" }).click();
    await expect(dialog).toHaveCount(0);
    // It opens the automation, where his own hand publishes the draft.
    await expect(page.getByRole("textbox", { name: "Nombre de la automatización" })).toHaveValue(
      "Leer correo",
    );
    const asked = await page.evaluate(() => (window as { __autoLearn?: string[] }).__autoLearn);
    expect(asked?.map((x) => JSON.parse(x))).toEqual([{ do: "take", suggestion: SUGGESTION }]);
    expect(JSON.stringify(asked)).not.toMatch(/yes|publish|print|byAgent/);
    const sent = (await recorded(page)).requests.filter((r) =>
      /\/(publish|draft)\b/.test(r.split(" ")[1] ?? ""),
    );
    expect(sent.filter((r) => r.startsWith("POST") || r.startsWith("PUT"))).toEqual([]);
    if (!(await cards.first().isVisible())) await openInbox(page);
    await expect(page.locator(".inbox-panel .instructions-card")).toHaveCount(0);
  });

  test("AU-211 · «No» turns the suggestion down and its card goes", async ({ page }) => {
    await openApp(page, "/?still", {
      agent: {
        ...AGENT(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [{ requests: [], instructions: SUGGESTED(true) }],
      },
    });
    const cards = await openInbox(page);
    await cards.getByRole("button", { name: "No", exact: true }).click();
    await expect(cards).toHaveCount(0);
    const asked = await page.evaluate(() => (window as { __autoLearn?: string[] }).__autoLearn);
    expect(asked?.map((x) => JSON.parse(x))).toEqual([{ do: "drop", suggestion: SUGGESTION }]);
  });

  test("AU-211 · on a shared device the change can be seen and not decided: no «Aceptar», no «No»", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      sharedDevice: true,
      agent: {
        ...BEFORE(),
        "GET api/agent/proposals": [{ proposals: [] }],
        "GET api/agent/requests": [{ requests: [], instructions: SUGGESTED(false) }],
      },
    });
    const cards = await openInbox(page);
    await expect(cards).toContainText("Solo desde un dispositivo personal");
    await expect(cards.getByRole("button")).toHaveText(["Ver el cambio"]);
    await cards.getByRole("button", { name: "Ver el cambio" }).click();
    const dialog = change(page);
    await expect(dialog).toContainText("Solo desde un dispositivo personal");
    await expect(dialog.getByRole("button", { name: "Aceptar" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "No", exact: true })).toHaveCount(0);
  });
});
