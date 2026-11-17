import { expect, type Page, test } from "@playwright/test";
import {
  FLOW_CATALOG,
  FLOW_CHECK,
  FLOW_DETAIL,
  FLOWS_WITH_SUMMARY,
  MAP,
  MODELS,
} from "./agent-scenarios.ts";
import { ALL_DONE, step, testOf, withRuns } from "./automation-data.ts";
import { openApp, openInTree, TEMPLATE } from "./fixtures.ts";

/**
 * I-07 (docs/principios.md): the main screens do not change their look by mistake. Each is compared with its reference
 * capture, made on CI's machine (its fonts), so only CI compares (`ignoreSnapshots` locally). A change that is meant
 * brings its new captures in the same PR: run the workflow «screens» (`--update-snapshots`) and commit what it uploads.
 * The clock is fixed so no date moves between runs.
 */
const FIXED = new Date("2026-10-20T10:00:00+02:00");

async function open(page: Page, agent: Record<string, unknown[]> = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: FIXED });
  await openApp(page, "/?still", { agent });
  // The start page shown, and so in «Recientes»: every capture has the same sidebar.
  await expect(page.locator(".sidebar").getByRole("list", { name: "Recientes" })).toHaveText(
    "Gastos",
  );
}
/**
 * The screen once nothing is in flight: the wait line (I-15) shows when a request at the start takes over 250 ms, and
 * stays 500 ms; caught mid-way, a capture would hold a bar two pixels high over the top of the content.
 */
const shot = async (page: Page, name: string) => {
  await expect(page.locator(".wait-line")).toHaveCount(0);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    maxDiffPixelRatio: 0.002,
  });
};

test("the start page (Gastos)", async ({ page }) => {
  await open(page);
  await page.locator(".doc-charts .chart-card .chart svg").first().waitFor();
  await shot(page, "gastos");
});

const FLOW_AGENT = {
  "GET api/agent/models": [MODELS],
  "GET api/agent/map": [MAP],
  "GET api/agent/flows": [FLOWS_WITH_SUMMARY],
  "GET api/agent/flows/:id": [FLOW_DETAIL],
  "GET api/agent/flows/catalog": [FLOW_CATALOG],
  "POST api/agent/flows/check": [FLOW_CHECK],
};

test("Flujos", async ({ page }) => {
  await open(page, FLOW_AGENT);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await page.locator(".db-table tbody tr").first().waitFor();
  await shot(page, "flujos");
});

test("Flujos: el mapa", async ({ page }) => {
  await open(page, FLOW_AGENT);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await page.getByRole("tab", { name: "Mapa" }).click();
  await page.locator(".mp-card").first().waitFor();
  await page.waitForTimeout(600); // the map fits what it shows with a short motion
  await shot(page, "flujos-mapa");
});

test("Flujos: un flujo", async ({ page }) => {
  await open(page, FLOW_AGENT);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await page.locator(".db-table").getByText("Leer correo", { exact: true }).click();
  await page.locator(".flow-editor .flow-canvas .fl-node").first().waitFor();
  await page.getByRole("button", { name: "Añadir paso" }).waitFor();
  await page.waitForTimeout(400); // the canvas fits the flow with a short motion
  await shot(page, "flujos-flujo");
});

test("«Uso de la IA», a template page over Boni's records", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: FIXED });
  await openApp(page, "/?still", { pages: [TEMPLATE("uso-ia")] });
  await openInTree(page, "Uso de la IA");
  await page.locator(".blk-bars .barlist-row").first().waitFor();
  await page.locator(".data-blk-chart .chart svg").first().waitFor();
  await shot(page, "uso-ia");
});

test("«Registro», a template page over Boni's runs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install({ time: new Date("2026-10-27T10:00:00+02:00") });
  await openApp(page, "/?still", { pages: [TEMPLATE("registro")] });
  await openInTree(page, "Registro");
  await expect(page.locator(".blk-number .kpi-value").first()).not.toHaveText("—");
  await page.locator(".data-blk-chart .chart svg").first().waitFor();
  await page.locator(".db-table tbody tr").first().waitFor();
  await shot(page, "registro");
});

test("Mis datos", async ({ page }) => {
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  await page.locator(".my-data .db-table tbody tr").first().waitFor();
  await shot(page, "mis-datos");
});

test("Mis datos: diagrama", async ({ page }) => {
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Mis datos" }).click();
  // A view of its own (task 69): «+», «Diagrama».
  await page.locator(".my-data .db-head").getByRole("button", { name: "Añadir vista" }).click();
  await page
    .getByRole("dialog", { name: "Añadir vista" })
    .getByRole("button", { name: "Diagrama" })
    .click();
  await page.locator(".data-diagram .dg-card-node").first().waitFor();
  await page.waitForTimeout(400); // the canvas fits the diagram with a short motion
  await shot(page, "mis-datos-diagrama");
});

test("Ajustes", async ({ page }) => {
  await open(page);
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await page.locator(".modal").waitFor();
  await shot(page, "ajustes");
});

test("a block's panel", async ({ page }) => {
  await open(page);
  await page.locator(".doc-tail").click();
  await page.keyboard.type("/Cifra", { delay: 20 });
  await page.locator(".slash-menu").getByRole("menuitem", { name: "Cifra", exact: true }).click();
  await page.locator(".blk-number .kpi-value").filter({ hasText: "3" }).waitFor();
  await shot(page, "panel-bloque");
});

// «Automatizaciones» (docs/automatizaciones.md F14b): «Revisar pendientes» after «Probar», as Juan sees it once he
// has tested it (automation-data.ts). The list keeps its capture «flujos», made again when its words change (AU-60).
const AUTOMATION_AGENT = FLOW_AGENT;
/** «Nueva automatización» with only its trigger: what «Añadir un paso» offers after it (AU-69). */
const ONLY_TRIGGER = {
  id: "a_01jx8z2w4y6a8c0e2g4j6m8p0r",
  name: "Nueva automatización",
  updated: 1761990000000,
  steps: [step("s_inicio", "Disparado por el usuario", "manual")],
  arrows: [],
  places: [{ step: "s_inicio", x: 0, y: 0 }],
};
/** The canvas still: a fit, a pan or a zoom has stopped moving it. */
async function still(page: Page) {
  let last: string | null = null;
  await expect
    .poll(
      async () => {
        const now = await page.locator(".auto-flow .react-flow__viewport").getAttribute("style");
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
}
async function openAutomation(page: Page, name: string, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: FIXED });
  await openApp(page, "/?still", {
    automations: [testOf(ALL_DONE), ONLY_TRIGGER],
    agent: AUTOMATION_AGENT,
  });
  // The start page shown first, as `open` waits for it: otherwise whether it reached «Recientes» before the click on
  // «Automatizaciones» was a race, and the sidebar of the capture changed between runs (CI, 2026-11-16).
  await expect(page.locator(".sidebar").getByRole("list", { name: "Recientes" })).toHaveText(
    "Gastos",
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await page.locator(".db-table").getByText(name, { exact: true }).click();
  await page.locator(".auto-card").first().waitFor();
  await still(page);
}
/** «Probar» with the trigger's «Mínimo» as the last test left it: every step with its rows. */
async function tested(page: Page) {
  await page.locator(".auto-test-bar .auto-test-go").click();
  await page
    .locator(".auto-test-bar")
    .getByRole("dialog")
    .getByRole("button", { name: "Probar" })
    .click();
  await expect(page.locator(".auto-test-bar .auto-log-line")).toContainText("bien · 7 pasos");
  await still(page);
}
async function openStep(page: Page, id: string) {
  await page.locator(`.auto-card[data-step="${id}"]`).dblclick();
  await expect(page.locator(".auto-view")).toHaveAttribute("data-step", id);
}

test("AU-63 · the canvas of an automation after a test: its cards, its arrows with their rows, «Registro» (automatizaciones-lienzo)", async ({
  page,
}) => {
  await openAutomation(page, "Revisar pendientes");
  await tested(page);
  await shot(page, "automatizaciones-lienzo");
});

test("AU-69 · «Añadir un paso» beside the canvas (automatizaciones-anadir)", async ({ page }) => {
  await openAutomation(page, "Nueva automatización");
  await page.locator(".auto-out-add").first().click();
  await page.locator(".auto-panel").waitFor();
  await still(page);
  await shot(page, "automatizaciones-anadir");
});

test("AU-70 · the step's view in three columns, with rows in and out (automatizaciones-paso)", async ({
  page,
}) => {
  await openAutomation(page, "Revisar pendientes");
  await tested(page);
  await openStep(page, "s_01jsi");
  await page.locator(".auto-view .auto-out-count").first().waitFor();
  await shot(page, "automatizaciones-paso");
});

test("AU-78 · the step's view on «Ajustes» (automatizaciones-ajustes)", async ({ page }) => {
  await openAutomation(page, "Revisar pendientes");
  await openStep(page, "s_01jbuscar");
  await page.locator(".auto-view").getByRole("tab", { name: "Ajustes" }).click();
  await shot(page, "automatizaciones-ajustes");
});

test("AU-74 · the step's view under 1100 px: «Entrada | Parámetros | Salida» as tabs (automatizaciones-estrecho)", async ({
  page,
}) => {
  await openAutomation(page, "Revisar pendientes", 900, 800);
  await tested(page);
  await openStep(page, "s_01jsi");
  await shot(page, "automatizaciones-estrecho");
});

/** «Revisar pendientes» published, with its runs counted back from the fixed hour, its tab «Ejecuciones» open. */
async function openRuns(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: FIXED });
  await openApp(page, "/?still", {
    automations: [withRuns(FIXED.getTime())],
    agent: AUTOMATION_AGENT,
  });
}

test("AU-99 · «Ejecuciones»: the list with its filters, a run's line and its canvas (automatizaciones-ejecuciones)", async ({
  page,
}) => {
  await openRuns(page, 1440, 900);
  await expect(page.locator(".sidebar").getByRole("list", { name: "Recientes" })).toHaveText(
    "Gastos",
  );
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await page.locator(".db-table").getByText("Revisar pendientes", { exact: true }).click();
  await page.locator(".auto-card").first().waitFor();
  await page.locator(".auto-head").getByRole("tab", { name: "Ejecuciones" }).click();
  await expect(page.locator(".auto-runs-item")).toHaveCount(5);
  await page.locator(".auto-run-canvas .auto-card").first().waitFor();
  await still(page);
  await shot(page, "automatizaciones-ejecuciones");
});

test.describe("on the phone", () => {
  test.use({ hasTouch: true, isMobile: true });
  async function openOnPhone(page: Page) {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.clock.install({ time: FIXED });
    await openApp(page, "/?still", { automations: [testOf(ALL_DONE)], agent: AUTOMATION_AGENT });
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page.getByText("Revisar pendientes", { exact: true }).first().tap();
    await page.locator(".auto-card").first().waitFor();
    await still(page);
  }
  test("AU-74 · the canvas on the phone, after a test (automatizaciones-telefono)", async ({
    page,
  }) => {
    await openOnPhone(page);
    await page.locator(".auto-test-bar .auto-test-go").tap();
    await page
      .locator(".auto-test-bar")
      .getByRole("dialog")
      .getByRole("button", { name: "Probar" })
      .tap();
    await expect(page.locator(".auto-test-bar .auto-log-line")).toContainText("bien · 7 pasos");
    await still(page);
    await shot(page, "automatizaciones-telefono");
  });
  test("AU-99 · «Ejecuciones» on the phone: the list first (automatizaciones-telefono-ejecuciones)", async ({
    page,
  }) => {
    await openRuns(page, 360, 740);
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
    await page.getByText("Revisar pendientes", { exact: true }).first().tap();
    await page.locator(".auto-card").first().waitFor();
    await page.locator(".auto-head").getByRole("tab", { name: "Ejecuciones" }).tap();
    await expect(page.locator(".auto-runs-item")).toHaveCount(5);
    await shot(page, "automatizaciones-telefono-ejecuciones");
  });
  test("AU-74 · a step on the phone: one column, «Parámetros» to read (automatizaciones-telefono-paso)", async ({
    page,
  }) => {
    await openOnPhone(page);
    await page.locator('.auto-card[data-step="s_01jsi"]').tap();
    await expect(page.locator(".auto-view")).toHaveAttribute("data-step", "s_01jsi");
    await shot(page, "automatizaciones-telefono-paso");
  });
});
