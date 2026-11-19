import { clock, under } from "@boni/pace";
import { expect, type Page, test } from "@playwright/test";
import { FLOW_CATALOG, FLOW_CHECK, FLOW_DETAIL, FLOWS, MAP, MODELS } from "./agent-scenarios.ts";
import { TESTED } from "./automation-data.ts";
import { type FakeRun, openApp } from "./fixtures.ts";

/**
 * What came from before, in the app (docs/automatizaciones.md §5.10 to §5.13, phase F16): the flows converted to
 * automations as the person sees them, Boni's own with their pieces in the canvas, the chat of a page, a proposal
 * from the assistant, and the old editor gone (AU-127, AU-137, AU-140, AU-152, AU-221, AU-225, AU-229).
 *
 * P1 makes the screens of the conversion real: the band «Tus flujos son ahora automatizaciones» and «⋯ → Conversión»,
 * the app's one notice, «Convertida» in «Versiones», «⋯ → Volver al flujo de antes» and «Convertir otra vez», Boni's
 * «De: Boni» and «Volver al de Boni», on a shared device and at phone size. They run over the mocked server of
 * fixtures.ts with ids shaped like the user's and a name that would be HTML if it were painted as such. The rest stay
 * pending, each kept with its rule's id in its name (`make check` reads them, T-10).
 */

/** What the flows of before need to be listed (agent-scenarios.ts). */
const BEFORE = () => ({
  "GET api/agent/models": [MODELS],
  "GET api/agent/map": [MAP],
  "GET api/agent/flows": [FLOWS],
  "GET api/agent/flows/:id": [{ ...FLOW_DETAIL, enabled: true }],
  "GET api/agent/flows/catalog": [FLOW_CATALOG],
  "POST api/agent/flows/check": [FLOW_CHECK],
});

const DAY = 86_400_000;
/** When the conversion ran: ten days ago. */
const CONVERTED_AT = Date.now() - 10 * DAY;
/** A run of an automation at `at`, ended as `state`. */
const ranAt = (id: string, at: number, state = "done"): FakeRun => ({
  id,
  at,
  state,
  version: 2,
  startedBy: "schedule",
  ms: 800,
  line: { writes: [], asked: [], outside: false },
});

/**
 * «Revisar pendientes», converted from a flow with two versions (each «Convertida»), on: three runs since, one of
 * them failed, and one before the conversion that does not count; two versions of before were not converted.
 */
const CONVERTED = {
  ...TESTED,
  published: { versions: 2 },
  conversion: {
    state: "converted" as const,
    at: CONVERTED_AT,
    changes: ["automationLimits", "asksNow"],
    skipped: 2,
    flows: { 1: 3, 2: 4 },
  },
  runs: [
    ranAt("r_01jx8x0t2v4x6z8b0d2f4h6a01", CONVERTED_AT + DAY),
    ranAt("r_01jx8x0t2v4x6z8b0d2f4h6a02", CONVERTED_AT + 2 * DAY, "failed"),
    ranAt("r_01jx8x0t2v4x6z8b0d2f4h6a03", CONVERTED_AT + 3 * DAY),
    ranAt("r_01jx8x0t2v4x6z8b0d2f4h6a04", CONVERTED_AT - DAY, "failed"),
  ],
};
/** A converted one that does the same, with no run since; its name read as plain text. */
const SAME = {
  ...TESTED,
  id: "a_01jx8x0t2v4x6z8b0d2f4h6c02",
  name: "Resumen <b>semanal</b>",
  published: { versions: 1 },
  conversion: { state: "converted" as const, at: CONVERTED_AT, changes: [], flows: { 1: 1 } },
};
/** One of Boni's, converted: version 1 is Boni's, version 2 Juan's, which runs. */
const BONI = {
  ...TESTED,
  id: "a_01jx8x0t2v4x6z8b0d2f4h6b03",
  name: "Aviso de prueba",
  boni: true,
  published: {
    versions: 2,
    by: { 1: "preset" as const, 2: "user" as const },
    docs: { 1: { steps: TESTED.steps.slice(0, 2), arrows: TESTED.arrows.slice(0, 1) } },
  },
  conversion: { state: "converted" as const, at: CONVERTED_AT, changes: ["automationLimits"] },
};

const head = (page: Page) => page.locator(".auto-head");
const band = (page: Page) =>
  page.getByRole("region", { name: "Tus flujos son ahora automatizaciones" });
const toast = (page: Page) => page.locator(".toast");
const toggle = (page: Page) => head(page).locator('input[data-boni-action="automations.enable"]');
const nameBox = (page: Page) => page.getByRole("textbox", { name: "Nombre de la automatización" });
const recorded = (page: Page, key: string) =>
  page.evaluate((k) => ((window as unknown as Record<string, string[]>)[k] ?? []).slice(), key);
/** The bodies the app sent to `start` («METHOD path »), in order. */
const sent = (page: Page, start: string) =>
  page.evaluate(
    (st) =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? [])
        .filter((b) => b.startsWith(st))
        .map((b) => JSON.parse(b.slice(st.length)) as Record<string, unknown>),
    start,
  );
async function openList(page: Page) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await expect(page.locator(".flows-head h1")).toBeVisible();
}
async function openCanvas(page: Page, name: string) {
  await openList(page);
  await page.locator(".db-table tbody tr").getByText(name, { exact: true }).click();
  await expect(nameBox(page)).toHaveValue(name);
}
const menuItems = async (page: Page) => {
  await head(page).getByRole("button", { name: "Más" }).click();
  const items = await page.locator(".pop-box .menu-item").allTextContents();
  await page.keyboard.press("Escape");
  return items;
};
async function more(page: Page, item: string) {
  await head(page).getByRole("button", { name: "Más" }).click();
  await page.getByRole("menuitemradio", { name: item, exact: true }).click();
}
const listMore = (page: Page) => page.locator(".flows-head").getByRole("button", { name: "Más" });

test.describe("what came from before, as automations (F16)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("AU-225 · the first time «Automatizaciones» opens after the conversion, a band lists the converted ones, each with «Lo que cambia» or «Hace lo mismo» and its runs since; it stays until closed, and none shows «Formato anterior»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [CONVERTED, SAME, BONI], agent: BEFORE() });
    await openList(page);
    await expect(band(page)).toBeVisible();
    // By name, each one's name as plain text, never HTML.
    const items = band(page).locator(".auto-conv-item");
    await expect(items.locator(".auto-conv-name")).toHaveText([
      "Aviso de prueba",
      "Resumen <b>semanal</b>",
      "Revisar pendientes",
    ]);
    await expect(band(page).locator("b")).toHaveCount(0);
    // Since the conversion: three runs, one failed (the one before it does not count); none for one that did not run.
    await expect(items.nth(2).locator(".auto-conv-runs")).toHaveText(
      "3 ejecuciones desde la conversión · 1 falló",
    );
    await expect(items.nth(1).locator(".auto-conv-runs")).toHaveText(
      "Sin ejecuciones desde la conversión",
    );
    // «Hace lo mismo», or «Lo que cambia» folded with its lines.
    await expect(items.nth(1).locator(".auto-conv-same")).toHaveText("Hace lo mismo");
    const changes = items.nth(2).locator(".auto-conv-changes");
    await expect(changes.locator("summary")).toHaveText("Lo que cambia");
    await changes.locator("summary").click();
    await expect(changes.locator("li")).toHaveText([
      "Sus límites son los de una automatización",
      "Antes escribía sin preguntar cuando la iniciabas tú; ahora pregunta",
    ]);
    await expect(band(page).locator(".auto-conv-skipped")).toHaveText(
      "2 versiones de antes no se pudieron convertir",
    );
    await expect(page.getByText("Formato anterior")).toHaveCount(0);
    // It stays: away and back, it is there.
    await page.locator(".db-table tbody tr").getByText(SAME.name, { exact: true }).click();
    await expect(nameBox(page)).toHaveValue(SAME.name);
    await head(page).getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(band(page)).toBeVisible();
    // A name opens its automation.
    await band(page).getByRole("button", { name: CONVERTED.name }).click();
    await expect(nameBox(page)).toHaveValue(CONVERTED.name);
    await head(page).getByRole("button", { name: "Volver a Automatizaciones" }).click();
    // «Cerrar»: for the account; the list goes to «⋯ → Conversión».
    await band(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(band(page)).toHaveCount(0);
    expect(await recorded(page, "__autoConversion")).toEqual(["close"]);
    await page.locator(".db-table tbody tr").getByText(SAME.name, { exact: true }).click();
    await head(page).getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(page.locator(".flows-head h1")).toBeVisible();
    await expect(band(page)).toHaveCount(0);
    await listMore(page).click();
    await page.getByRole("menuitemradio", { name: "Conversión", exact: true }).click();
    const screen = page.getByRole("dialog", { name: "Tus flujos son ahora automatizaciones" });
    await expect(screen.locator(".auto-conv-name")).toHaveText([
      "Aviso de prueba",
      "Resumen <b>semanal</b>",
      "Revisar pendientes",
    ]);
    await expect(screen.locator(".auto-conv-skipped")).toHaveText(
      "2 versiones de antes no se pudieron convertir",
    );
  });

  test("AU-225 · the app's one notice of the conversion leads to the band, once per device", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [CONVERTED, SAME], agent: BEFORE() });
    await expect(toast(page)).toContainText("Tus flujos son ahora automatizaciones");
    await toast(page).getByRole("button", { name: "Ver" }).click();
    await expect(band(page)).toBeVisible();
    // Given once: the app opened again says nothing.
    await page.reload();
    await expect(page.locator(".sidebar")).toBeVisible();
    // The notice is not asked again: the list is not read until «Automatizaciones» opens.
    await page.waitForTimeout(1000);
    await expect(toast(page)).toHaveCount(0);
    expect(await recorded(page, "__automations")).not.toContain("GET conversion");
  });

  test("AU-225 · a converted automation opens in the canvas with its steps, «Versiones» marks the converted ones, and «Volver al flujo de antes» leaves it off with the flow running", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [CONVERTED], agent: BEFORE() });
    await openCanvas(page, CONVERTED.name);
    await expect(page.locator(".auto-card")).toHaveCount(TESTED.steps.length);
    // «Versiones»: each one from a version of the flow says «Convertida».
    await more(page, "Versiones");
    await expect(page.locator(".auto-vers-item .auto-vers-converted")).toHaveText([
      "Convertida",
      "Convertida",
    ]);
    await expect(page.locator(".auto-run-line")).toContainText("Convertida");
    await page.getByRole("button", { name: "Volver al editor" }).click();
    // Back to the flow: off, its state instead of the switch, and «Convertir otra vez» in «⋯».
    await expect(toggle(page)).toBeChecked();
    expect(await menuItems(page)).toContain("Volver al flujo de antes");
    await more(page, "Volver al flujo de antes");
    await expect(head(page).locator(".auto-conv-state")).toHaveText("En el flujo de antes");
    await expect(toggle(page)).toHaveCount(0);
    await expect(toast(page)).toContainText("«Revisar pendientes»: en el flujo de antes");
    const items = await menuItems(page);
    expect(items).toContain("Convertir otra vez");
    expect(items).not.toContain("Volver al flujo de antes");
    // And back again: on, as it was.
    await more(page, "Convertir otra vez");
    await expect(toggle(page)).toBeChecked();
    await expect(head(page).locator(".auto-conv-state")).toHaveCount(0);
    await expect(toast(page)).toContainText("«Revisar pendientes»: convertida otra vez");
    // A round trip loses nothing and sets no «Sí»: only its two touches; no draft, no version, no switch.
    expect(await sent(page, `POST api/agent/automations/${CONVERTED.id}/conversion `)).toEqual([
      { do: "back" },
      { do: "again" },
    ]);
    const touched = (await recorded(page, "__automations")).filter(
      (x) => !x.startsWith("GET ") && /\/(draft|publish|enabled|versions)/.test(x),
    );
    expect(touched).toEqual([]);
    await more(page, "Versiones");
    await expect(page.locator(".auto-vers-item")).toHaveCount(2);
  });

  test("AU-225 · on a shared device the band and the editor say the state, and going back or closing is refused with nothing changed", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [CONVERTED],
      agent: BEFORE(),
      sharedDevice: true,
    });
    await openList(page);
    await band(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(toast(page)).toContainText("Solo desde un dispositivo personal.");
    await expect(band(page)).toBeVisible();
    await page.locator(".db-table tbody tr").getByText(CONVERTED.name, { exact: true }).click();
    await expect(nameBox(page)).toHaveValue(CONVERTED.name);
    await more(page, "Volver al flujo de antes");
    await expect(toast(page)).toContainText("Solo desde un dispositivo personal.");
    await expect(toggle(page)).toBeChecked();
    await expect(head(page).locator(".auto-conv-state")).toHaveCount(0);
  });

  test("AU-225 · P1 A-15 · with 200 converted automations and a year of runs, the band is drawn at once from one read", async ({
    page,
  }) => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...TESTED,
      id: `a_01jx8x0t2v4x6z8b0d2f4${String(i).padStart(5, "0")}`,
      name: `Automatización ${String(i).padStart(3, "0")}`,
      published: { versions: 1 },
      conversion: { state: "converted" as const, at: CONVERTED_AT, changes: ["automationLimits"] },
      ...(i === 0 ? { manyRuns: 8_760 } : {}),
    }));
    await openApp(page, "/?still", { automations: many, agent: BEFORE() });
    const pressed = clock();
    await openList(page);
    await expect(band(page).locator(".auto-conv-item")).toHaveCount(200);
    under(clock() - pressed, 2000, "clock", "the band with 200, from the sidebar");
    // Asked once by the notice and once by the list: never again while it is open.
    const asked = () =>
      recorded(page, "__automations").then((r) => r.filter((x) => x === "GET conversion").length);
    const before = await asked();
    expect(before).toBeLessThanOrEqual(2);
    await page.waitForTimeout(2500);
    expect(await asked()).toBe(before);
  });

  test.fixme("AU-127 · a piece of Boni opens its panel with only what it lets change, and the add panel does not offer it in another automation", async () => {});

  test("AU-221 · Boni's automations say «De: Boni» in the list, can be turned off and not deleted, and «Volver al de Boni» brings Boni's version back", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [BONI, CONVERTED], agent: BEFORE() });
    await openList(page);
    await expect(page.locator(".db-table tbody tr", { hasText: BONI.name })).toContainText("Boni");
    await page.locator(".db-table tbody tr").getByText(BONI.name, { exact: true }).click();
    await expect(nameBox(page)).toHaveValue(BONI.name);
    await expect(head(page).locator(".auto-head-boni")).toHaveText("De Boni");
    // Turned off and on by its switch; never deleted.
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    await toggle(page).click();
    await expect(toggle(page)).toBeChecked();
    const items = await menuItems(page);
    expect(items).not.toContain("Eliminar");
    expect(items).toContain("Volver al de Boni");
    // «Volver al de Boni» is «Volver a esta» on Boni's last: «Publicar» about version 1, then a new version.
    await more(page, "Volver al de Boni");
    await expect(page.locator(".auto-modal")).toBeVisible();
    expect(await recorded(page, "__autoPublishView")).toEqual(["version=1"]);
    await page.locator(".auto-modal").getByRole("button", { name: "Publicar versión 3" }).click();
    await expect(page.locator(".auto-modal")).toHaveCount(0);
    expect(await sent(page, `POST api/agent/automations/${BONI.id}/publish `)).toEqual([
      { version: 1 },
    ]);
    // Boni's runs again: nothing to go back to.
    await expect
      .poll(async () => (await menuItems(page)).includes("Volver al de Boni"))
      .toBe(false);
    // One of Juan's has «Eliminar» and no «Volver al de Boni».
    await head(page).getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await page.locator(".db-table tbody tr").getByText(CONVERTED.name, { exact: true }).click();
    await expect(nameBox(page)).toHaveValue(CONVERTED.name);
    await expect(head(page).locator(".auto-head-boni")).toHaveCount(0);
    const mine = await menuItems(page);
    expect(mine).toContain("Eliminar");
    expect(mine).not.toContain("Volver al de Boni");
  });

  test.fixme("AU-137 · the «Chat» block of a page opens its automation, and a message in that chat gets its answer as plain text and a run in «Ejecuciones»", async () => {});
  test.fixme("AU-140 · the assistant's proposal of an automation is a card with «Lo que podrá hacer»; accepting it opens a draft in the canvas, not published", async () => {});
  test.fixme("AU-152 · no flow of the old format is left: the list, the map and every link open the new canvas, and the old editor's route is gone", async () => {});
});

test.describe("what came from before, on a phone (F16)", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("AU-229 · at phone size a converted automation is seen, run and switched, the notice shows, and nothing offers to edit", async ({
    page,
  }) => {
    const reverted = {
      ...SAME,
      conversion: { ...SAME.conversion, state: "reverted" as const },
    };
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page, "/?still", { automations: [CONVERTED, reverted], agent: BEFORE() });
    // The notice, and «Ver» opens the list with the band.
    await expect(toast(page)).toContainText("Tus flujos son ahora automatizaciones");
    await toast(page).getByRole("button", { name: "Ver" }).tap();
    await expect(band(page)).toBeVisible();
    await expect(band(page).locator(".auto-conv-item.reverted .auto-conv-state")).toHaveText(
      "En el flujo de antes",
    );
    // A converted one: looked at, run and switched; no «Publicar», no «⋯», the name not a field.
    await page.getByText(CONVERTED.name, { exact: true }).last().tap();
    await expect(head(page).locator(".auto-name")).toHaveText(CONVERTED.name);
    await expect(nameBox(page)).toHaveCount(0);
    await expect(head(page).getByRole("button", { name: "Publicar", exact: true })).toHaveCount(0);
    await expect(head(page).getByRole("button", { name: "Más" })).toHaveCount(0);
    await expect(head(page).locator(".auto-run-phone")).toBeVisible();
    await toggle(page).tap();
    await expect(toggle(page)).not.toBeChecked();
    await toggle(page).tap();
    await expect(toggle(page)).toBeChecked();
    // One on the flow of before says so and cannot be switched from here.
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page
      .locator(".db-table, .m-scroll")
      .getByText(reverted.name, { exact: true })
      .last()
      .tap();
    await expect(head(page).locator(".auto-name")).toHaveText(reverted.name);
    await expect(head(page).locator(".auto-conv-state")).toHaveText("En el flujo de antes");
    await expect(toggle(page)).toHaveCount(0);
    expect(await recorded(page, "__autoConversion")).toEqual([]);
  });
});
