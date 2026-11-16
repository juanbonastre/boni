import { under } from "@boni/pace";
import { expect, type Page, test } from "@playwright/test";
import { CATALOGUE, type ParamSpec, paramsOf } from "../packages/automations/src/catalogue.ts";
import {
  FLOW_CATALOG,
  FLOW_CHECK,
  FLOW_DETAIL,
  FLOWS,
  FLOWS_WITH_SUMMARY,
  MAP,
  MODELS,
} from "./agent-scenarios.ts";
import { ALL_DONE, arrow, books, step, TESTED, testOf } from "./automation-data.ts";
import { openApp } from "./fixtures.ts";

/**
 * «Automatizaciones» on the screen, F14b (docs/automatizaciones.md §5.7, §5.8; the sketch,
 * docs/maquetas/automatizaciones.html): the list, the canvas, adding a step, the step's view, dragging a field, the
 * draft that saves itself and «Probar». Pending: the first PR of the phase brings one test per rule, and the builder
 * turns each into a real one as its screen exists, keeping the rule's id in its name (`make check` reads them).
 *
 * How they are written when they run: over the mocked server of fixtures.ts (`openApp` with the answers of the
 * routes of apps/server/src/automations/routes.ts), with collections whose keys and names are like Juan's
 * (agent-scenarios.ts) and, where a rule is about many rows or many fields, with many: a test of 3,000 rows, a
 * collection of 40 fields. Typing and dragging go at a person's pace where time matters (the pause before a save,
 * the preview of an expression). The same things over the real server are e2e-boni-desktop/automations.spec.ts.
 */

const SHOTS = "e2e-boni/screenshots";
/** Two automations of the new format, with ids as the server makes them: one started by hand, one with no step. */
const AUTOMATIONS = [
  {
    id: "a_01jx8p3k5m7n9q2r4t6v8w0y1z",
    name: "Revisar gastos",
    trigger: "manual",
    updated: 1761900000000,
  },
  {
    id: "a_01jx8n2c4e6g8j0l2n4p6r8t0v",
    name: "Borrador sin pasos",
    trigger: null,
    updated: 1761800000000,
  },
];
/** What the flows of before need to be listed and opened (agent-scenarios.ts). */
const BEFORE = (flows: unknown = FLOWS) => ({
  "GET api/agent/models": [MODELS],
  "GET api/agent/map": [MAP],
  "GET api/agent/flows": [flows],
  "GET api/agent/flows/:id": [{ ...FLOW_DETAIL, enabled: true }],
  "GET api/agent/flows/catalog": [FLOW_CATALOG],
  "POST api/agent/flows/check": [FLOW_CHECK],
  "PUT api/agent/flows/:id/enabled": [{ ...FLOW_DETAIL, enabled: false }],
});
async function list(page: Page) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "Automatizaciones", exact: true })
    .click();
  await expect(page.locator(".topbar h1")).toHaveText("Automatizaciones");
  return page.locator(".db-table tbody tr");
}
/** What the app asked of the automations' routes ("POST", "GET a_…", "PUT a_…/draft"), as the mock saw it. */
const asked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __automations?: string[] }).__automations ?? []);
/** The server down (each automations' route answers 503), or back. */
const serverDown = (page: Page, down: boolean) =>
  page.evaluate((d) => {
    (window as unknown as { __automationsDown?: boolean }).__automationsDown = d;
  }, down);
const sent = (page: Page, start: string) =>
  page.evaluate(
    (st) =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? [])
        .filter((b) => b.startsWith(st))
        .map((b) => JSON.parse(b.slice(st.length)) as Record<string, unknown>),
    start,
  );
/** The name in the last draft sent to `start`. */
const lastName = async (page: Page, start: string) =>
  ((await sent(page, start)).at(-1)?.automation as { name?: string } | undefined)?.name;
const head = (page: Page) => page.locator(".auto-head");
const saved = (page: Page) => head(page).getByRole("status");
const nameBox = (page: Page) => page.getByRole("textbox", { name: "Nombre de la automatización" });

/** «Libros por leer»: a trigger and three steps in a row, each box where the server keeps it. */
const CHAIN = {
  id: "a_01jx8q4m6p8r0t2v4x6z8b0d2f",
  name: "Libros por leer",
  updated: 1761950000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual"),
    step("s_01jbuscar", "Buscar filas en Libros", "collection", {
      action: "find",
      collection: "libros",
      limit: 10,
    }),
    step("s_01jfiltrar", "Filtrar", "filter"),
    step("s_01jordenar", "Ordenar", "sort"),
  ],
  arrows: [
    arrow("s_inicio", "s_01jbuscar"),
    arrow("s_01jbuscar", "s_01jfiltrar"),
    arrow("s_01jfiltrar", "s_01jordenar"),
  ],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jbuscar", x: 300, y: 0 },
    { step: "s_01jfiltrar", x: 600, y: 0 },
    { step: "s_01jordenar", x: 900, y: 0 },
  ],
};
const CHAIN_IDS = CHAIN.steps.map((s) => s.id);
/** «Separar por estado»: a «Si» with both its outputs in use, and no box kept (Boni places them). */
const BRANCH = {
  id: "a_01jx8r5n7q9s1u3w5y7a9c1e3g",
  name: "Separar por estado",
  updated: 1761940000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual"),
    step("s_01jsi", "Si", "if"),
    step("s_01jfiltrar", "Filtrar", "filter"),
    step("s_01jordenar", "Ordenar", "sort"),
  ],
  arrows: [
    arrow("s_inicio", "s_01jsi"),
    arrow("s_01jsi", "s_01jfiltrar", "yes"),
    arrow("s_01jsi", "s_01jordenar", "no"),
  ],
};
const CANVAS = [...AUTOMATIONS, CHAIN, BRANCH];
/**
 * «Revisar libros», for the step's view: a «Buscar filas» with conditions, an order and a limit; a «Filtrar» with a
 * long name and an expression for a value; a «Limitar» with every setting changed; a «Buscar filas» with no collection.
 */
const VIEWED = {
  id: "a_01jx8t7q9s1u3w5y7a9c1e3g5j",
  name: "Revisar libros",
  updated: 1761960000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual"),
    step("s_01jbuscar", "Buscar filas en Libros", "collection", {
      collection: "libros",
      action: "find",
      where: [{ field: "estado", op: "is", value: "o_pendiente" }],
      sort: [{ field: "paginas", direction: "asc" }],
      limit: 10,
    }),
    step(
      "s_01jfiltrar",
      "Solo los libros largos que siguen pendientes y que nadie ha marcado todavía como favoritos",
      "filter",
      { where: [{ field: "paginas", op: "gt", value: { expr: "{{ $json.minimo }}" } }] },
    ),
    {
      ...step("s_01jlimitar", "Limitar", "limit", { count: 5 }),
      settings: {
        onError: "continue",
        retry: { times: 2, waitMs: 1000 },
        continueEmpty: true,
        firstRowOnly: true,
        note: "Solo para probar",
        off: true,
      },
    },
    step("s_01jnueva", "Buscar filas", "collection", { action: "find" }),
  ],
  arrows: [
    arrow("s_inicio", "s_01jbuscar"),
    arrow("s_01jbuscar", "s_01jfiltrar"),
    arrow("s_01jfiltrar", "s_01jlimitar"),
  ],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jbuscar", x: 300, y: 0 },
    { step: "s_01jfiltrar", x: 600, y: 0 },
    { step: "s_01jlimitar", x: 900, y: 0 },
    { step: "s_01jnueva", x: 300, y: 220 },
  ],
};
/** «Ordenar la biblioteca»: the five steps that have conditions (AU-81), each with its own fields. */
const CONDITIONS = {
  id: "a_01jx8w9s1u3w5y7a9c1e3g5j7m",
  name: "Ordenar la biblioteca",
  updated: 1761970000000,
  steps: [
    // It asks the value the filter cites (`$json.minimo`).
    step("s_inicio", "Disparado por el usuario", "manual", {
      fields: [{ key: "minimo", name: "Mínimo", type: "number" }],
    }),
    step("s_01jbuscar", "Buscar filas en Libros", "collection", {
      collection: "libros",
      action: "find",
      where: [{ field: "estado", op: "is", value: "o_pendiente" }],
      limit: 50,
    }),
    step("s_01jfiltrar", "Filtrar", "filter", {
      where: [{ field: "paginas", op: "gt", value: { expr: "{{ $json.minimo }}" } }],
    }),
    step("s_01jsi", "Si", "if"),
    step("s_01jmodificar", "Modificar filas en Libros", "collection", {
      collection: "libros",
      action: "update",
      target: "matching",
    }),
    step("s_01jeliminar", "Eliminar filas en Libros", "collection", {
      collection: "libros",
      action: "trash",
      target: "matching",
    }),
  ],
  arrows: [
    arrow("s_inicio", "s_01jbuscar"),
    arrow("s_01jbuscar", "s_01jfiltrar"),
    arrow("s_01jfiltrar", "s_01jsi"),
    arrow("s_01jsi", "s_01jmodificar", "yes"),
    arrow("s_01jsi", "s_01jeliminar", "no"),
  ],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jbuscar", x: 300, y: 0 },
    { step: "s_01jfiltrar", x: 600, y: 0 },
    { step: "s_01jsi", x: 900, y: 0 },
    { step: "s_01jmodificar", x: 1200, y: -110 },
    { step: "s_01jeliminar", x: 1200, y: 110 },
  ],
};
/** «Marcar los leídos»: one value of each kind in one view, a condition's and «Campo · Valor»'s (AU-20). */
const KINDS = {
  id: "a_01jx8w9s1u3w5y7a9c1e3g5k2p",
  name: "Marcar los leídos",
  updated: 1761970000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual"),
    step("s_01jmarcar", "Modificar filas en Libros", "collection", {
      collection: "libros",
      action: "update",
      target: "matching",
      where: [{ field: "estado", op: "is", value: "o_leyendo" }],
      fields: [
        { field: "titulo", value: "Leído entero" },
        { field: "estado", value: "o_leido" },
        { field: "paginas", value: 320 },
        { field: "fin", value: "2026-11-01" },
        { field: "fav", value: true },
        { field: "relacionado", value: { expr: "{{ $json.titulo }}" } },
      ],
    }),
  ],
  arrows: [arrow("s_inicio", "s_01jmarcar")],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jmarcar", x: 300, y: 0 },
  ],
};
/** The keys a choice offers, when they are keys and not fields. */
const keysOf = (p: ParamSpec): readonly string[] =>
  p.control === "choice" && Array.isArray(p.options) ? (p.options as readonly string[]) : [];
/**
 * «Todos los pasos» (AU-75, AU-78): one step of each type of the catalogue with each of its actions, and one more for
 * each value of a choice that brings other parameters into sight («Sobre: las que cumplan»), in a grid of boxes.
 */
const SEA_STEPS = CATALOGUE.flatMap((spec) =>
  spec.actions.flatMap((a) => {
    const base: Record<string, unknown> = spec.actions.length > 1 ? { action: a.key } : {};
    const all = [...spec.params, ...a.params];
    const shows = all.filter((p) => keysOf(p).length && all.some((q) => q.when?.param === p.key));
    return [base, ...shows.flatMap((p) => keysOf(p).map((o) => ({ ...base, [p.key]: o })))].map(
      (params) => ({ type: spec.type, params }),
    );
  }),
).map((x, i) => step(`s_01jmar${String(i).padStart(3, "0")}`, `Paso ${i + 1}`, x.type, x.params));
const SEA = {
  id: "a_01jx8v8r0t2v4x6z8b0d2f4h6k",
  name: "Todos los pasos",
  updated: 1761980000000,
  steps: SEA_STEPS,
  arrows: [],
  places: SEA_STEPS.map((s, i) => ({ step: s.id, x: (i % 8) * 300, y: Math.floor(i / 8) * 200 })),
};
/** «Si» fails on its condition's value: what hung from it is «parado». */
const SI_FAILS = {
  s_inicio: ALL_DONE.s_inicio,
  s_01jbuscar: ALL_DONE.s_01jbuscar,
  s_01jsi: {
    state: "failed" as const,
    rows: { "in:main": books(128) },
    out: { yes: 0, no: 0 },
    error: {
      message: "where.0.value: expected a number",
      failure: { code: "value.type", param: "where.0.value", detail: { needs: "number" } },
    },
  },
  s_01jmodificar: { state: "stopped" as const, in: {}, out: {} },
  s_01jeliminar: { state: "stopped" as const, in: {}, out: {} },
  s_01jcombinar: { state: "stopped" as const, in: {}, out: {} },
  s_01jcrear: { state: "stopped" as const, in: {}, out: {} },
};
/** No book passes «Si»: «Modificar filas» gets no rows and is «saltado»; «Combinar» was never tested. */
const NONE_PASS = {
  s_inicio: ALL_DONE.s_inicio,
  s_01jbuscar: ALL_DONE.s_01jbuscar,
  s_01jsi: { rows: { "in:main": books(128), "out:yes": [], "out:no": books(128) } },
  s_01jmodificar: { state: "skipped" as const, in: { main: 0 }, out: { main: 0 } },
  s_01jeliminar: ALL_DONE.s_01jeliminar,
};
const FIVE_MIN = 5 * 60_000;
/**
 * «Resumir libros», for F (AU-20, AU-21): a trigger that asks a «Título» of its own, a «Buscar filas», an «Agrupar»
 * by «Estado» with «Suma de Páginas», and a «Crear una fila» whose fields cite: one a step that is gone, one
 * «Título» of «Buscar filas en Libros» (two steps of the path have a «Título»).
 */
const CITED = {
  id: "a_01jx8y1v3x5z7b9d1f3h5k7n9q",
  name: "Resumir libros",
  updated: 1761995000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual", {
      fields: [{ key: "tit", name: "Título", type: "text" }],
    }),
    step("s_01jbuscar", "Buscar filas en Libros", "collection", {
      collection: "libros",
      action: "find",
      limit: 200,
    }),
    step("s_01jagrupar", "Agrupar", "group", {
      by: [{ field: "estado" }],
      measures: [{ measure: "sum", field: "paginas" }],
    }),
    step("s_01jcrear", "Crear una fila en Libros", "collection", {
      collection: "libros",
      action: "create",
      fields: [
        { field: "titulo", value: "Resumen" },
        { field: "estado", value: { expr: "{{ $('Paso borrado').first().estado }}" } },
        { field: "fin", value: { expr: "{{ $('Buscar filas en Libros').first().titulo }}" } },
      ],
    }),
  ],
  arrows: [
    arrow("s_inicio", "s_01jbuscar"),
    arrow("s_01jbuscar", "s_01jagrupar"),
    arrow("s_01jagrupar", "s_01jcrear"),
  ],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jbuscar", x: 300, y: 0 },
    { step: "s_01jagrupar", x: 600, y: 0 },
    { step: "s_01jcrear", x: 900, y: 0 },
  ],
};
/** «Resumir libros» tested: 128 books in one group, «Pendiente», with 33,856 pages. */
const CITED_DONE = {
  s_inicio: { rows: { "out:main": [{ json: { tit: "Lista de ejemplo" }, label: {} }] } },
  s_01jbuscar: {
    rows: { "in:main": [{ json: { tit: "Lista de ejemplo" }, label: {} }], "out:main": books(128) },
  },
  s_01jagrupar: {
    rows: {
      "in:main": books(128),
      "out:main": [{ json: { estado: "o_pendiente", sum_paginas: 33856 }, label: {} }],
    },
  },
  s_01jcrear: {
    rows: {
      "in:main": [{ json: { estado: "o_pendiente", sum_paginas: 33856 }, label: {} }],
      "out:main": [
        { json: { titulo: "Resumen", estado: null }, before: null, would: "create", label: {} },
      ],
    },
    wouldWrite: 1,
  },
};
const citedTested = () =>
  testOf(CITED_DONE, { kept: FIVE_MIN, tested: { s_inicio: { tit: "Lista de ejemplo" } } }, CITED);
/** The steps whose first rows the app asked (`…/test/sample`, AU-20). */
const samplesAsked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __autoSample?: string[] }).__autoSample ?? []);
/** An expression as its editor holds it: its text, and each chip as the citation it stands for (AU-21). */
const exprOf = (l: ReturnType<Page["locator"]>) =>
  l.evaluate((el) => {
    const walk = (n: Node): string =>
      n.nodeType === Node.TEXT_NODE
        ? (n as Text).data.replace(/\u00a0/g, " ").replace(/\u200b/g, "")
        : ((n as HTMLElement).dataset?.src ?? [...n.childNodes].map(walk).join(""));
    return [...el.childNodes].map(walk).join("");
  });
/** A field of ENTRADA's «Esquema» by its name. */
const schemaField = (page: Page, name: string) =>
  entrada(page)
    .locator(".auto-schema-list:not(.nested) > .auto-schema-field")
    .filter({ has: page.locator(".auto-schema-name", { hasText: new RegExp(`^${name}$`) }) })
    .first();
/** Drags `from` onto `to` with the mouse, at a person's pace (AU-21). */
async function dragOnto(
  page: Page,
  from: ReturnType<Page["locator"]>,
  to: ReturnType<Page["locator"]>,
) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("nothing to drag or nowhere to drop");
  await page.mouse.move(a.x + Math.min(20, a.width / 2), a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}
/** What the app asked to test (`window.__autoTests`, the bodies), and the pages of rows it asked. */
const testsAsked = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __autoTests?: string[] }).__autoTests ?? []).map(
      (b) => JSON.parse(b) as { trigger: string; fields: Record<string, unknown>; step?: string },
    ),
  );
const rowsAsked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __autoRows?: string[] }).__autoRows ?? []);
/** The bottom centre (AU-64): «Probar» and the «Registro». */
const testBar = (page: Page) => page.locator(".auto-test-bar");
const testGo = (page: Page) => testBar(page).locator(".auto-test-go");
const logLine = (page: Page) => testBar(page).locator(".auto-log-line");
/** The count an arrow says, by the ids of its two steps. */
const countOn = (page: Page, from: string, to: string) =>
  page.locator(`.auto-arrow-count[data-arrow^="${from}:"][data-arrow*=">${to}:"]`);
const stateOf = (page: Page, id: string) => card(page, id).locator(".auto-card-state");
const entrada = (page: Page) => view(page).getByRole("region", { name: "Entrada" });
const salida = (page: Page) => view(page).getByRole("region", { name: "Salida" });
const showAs = (l: ReturnType<Page["locator"]>, name: string) =>
  l.getByRole("radiogroup", { name: "Ver como" }).getByRole("radio", { name, exact: true });
const node = (page: Page, id: string) => page.locator(`[data-testid="rf__node-${id}"]`);
const card = (page: Page, id: string) => page.locator(`.auto-card[data-step="${id}"]`);
const cards = (page: Page) => page.locator(".auto-card");
const panel = (page: Page) => page.locator(".auto-panel");
const bar = (page: Page) => page.locator(".auto-bar");
/** Where a box is on the canvas, in the canvas's units (what the server keeps). */
const at = (page: Page, id: string) =>
  node(page, id).evaluate((el) => {
    const m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
      (el as HTMLElement).style.transform,
    );
    return { x: Math.round(Number(m?.[1])), y: Math.round(Number(m?.[2])) };
  });
const placesOf = async (page: Page, ids: string[]) =>
  Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await at(page, id)] as const)));
/** Opens `name` from the list and waits for its canvas. */
async function openCanvas(page: Page, name: string, steps: number) {
  const rows = await list(page);
  await rows.getByText(name, { exact: true }).click();
  await expect(nameBox(page)).toHaveValue(name);
  await expect(cards(page)).toHaveCount(steps);
  return rows;
}
/** A person's drag: pressed, moved in small steps over about half a second, let go. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 25, from.y + ((to.y - from.y) * i) / 25);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}
const xy = (p: { x: number; y: number }) => [p.x, p.y] as const;
async function middle(l: ReturnType<Page["locator"]>) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not on the screen");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
/** The middle of the arrow from step `from` to step `to` on the screen, where a click selects it. */
const arrowMiddle = (page: Page, from: string, to: string) =>
  page
    .locator(
      `[data-testid^="rf__edge-${from}:"][data-testid*=">${to}:"] .react-flow__edge-interaction`,
    )
    .evaluate((el) => {
      const path = el as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM();
      const s = m ? p.matrixTransform(m) : p;
      return { x: s.x, y: s.y };
    });
/** The arrows of the canvas as "from>to" by step id, sorted. */
const arrowsSeen = (page: Page) =>
  page.locator(".react-flow__edge").evaluateAll((els) =>
    els
      .map((e) => {
        const id = (e.getAttribute("data-testid") ?? "").replace("rf__edge-", "");
        const [from, to] = id.split(">");
        return `${from?.split(":")[0]}>${to?.split(":")[0]}`;
      })
      .sort(),
  );
const cardNames = (page: Page) => page.locator(".auto-card-name").allTextContents();
type Sent = {
  steps: { id: string; name: string; type: string; params: Record<string, unknown> }[];
  arrows: ReturnType<typeof arrow>[];
};
/** The last draft sent of automation `id`. */
const lastDraft = async (page: Page, id: string) =>
  (await sent(page, `PUT api/agent/automations/${id}/draft `)).at(-1)?.automation as
    | Sent
    | undefined;
/** The boxes sent of automation `id`, one list per request. */
const layouts = async (page: Page, id: string) =>
  (await sent(page, `PUT api/agent/automations/${id}/layout `)).map(
    (b) => b.places as { step: string; x: number; y: number }[],
  );
/** Once the canvas has stopped moving (a fit is animated). */
const settled = async (page: Page) => {
  let last: string | null = null;
  await expect
    .poll(
      async () => {
        const now = await page.locator(".auto-flow .react-flow__viewport").getAttribute("style");
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [120] },
    )
    .toBe(true);
};
const press = (page: Page, keys: string) => page.keyboard.press(keys);
/** The step's view (D, AU-70), its rows of «Parámetros», one of them by its key, one setting of «Ajustes». */
const view = (page: Page) => page.locator(".auto-view");
const paramRows = (page: Page) => view(page).locator(".auto-param[data-param]");
const param = (page: Page, key: string) => view(page).locator(`.auto-param[data-param="${key}"]`);
const nameIn = (page: Page) => view(page).getByRole("textbox", { name: "Nombre del paso" });
/** Clicks `name` in «Añadir un paso»: the step is added, and opens (AU-65). */
const pick = (page: Page, name: string) =>
  panel(page).getByRole("button", { name, exact: true }).click();
/** Chooses `name` in «Añadir un paso»: the step added opens (AU-65), and Esc closes its view, the step selected. */
async function choose(page: Page, name: string) {
  await pick(page, name);
  await expect(view(page)).toBeVisible();
  await press(page, "Escape");
  await expect(view(page)).toHaveCount(0);
}
/** Opens step `id` with a double click on its card. */
async function openStep(page: Page, id: string) {
  await card(page, id).dblclick();
  await expect(view(page)).toHaveAttribute("data-step", id);
}
/** The texts of a select's options. */
const optionsIn = (l: ReturnType<Page["locator"]>) => l.locator("option").allTextContents();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.describe("the list", () => {
  test("AU-60 · the sidebar, the collection's page and its crumbs, «Buscar», the conversation and the map say «Automatizaciones»; nothing on the screen says «Flujos», and «flujo» is read only in «Formato anterior»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const noFlujo = async () => expect(page.locator("body")).not.toContainText(/flujo/i);
    // The sidebar and the collection's page.
    await expect(page.locator(".sidebar")).toContainText("Automatizaciones");
    await list(page);
    await expect(page.locator(".db-table tbody tr")).toHaveCount(3);
    await noFlujo();
    // «Buscar»: «Nueva automatización», which opens the new canvas.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("automat", { delay: 40 });
    const found = page.locator(".find-row").first();
    await expect(found).toHaveText("Nueva automatización (Automatizaciones)");
    await expect(found).toHaveAttribute("data-boni-action", "automations.create");
    await noFlujo();
    await page.keyboard.press("Enter");
    await expect(page.locator(".auto-start h2")).toHaveText("¿Cómo empieza?");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    // The map: its groups by automation, its cards of the flows of before.
    await page.getByRole("tab", { name: "Mapa" }).click();
    await expect(page.locator(".mp-stage .mp-card").first()).toBeVisible();
    await noFlujo();
    // A flow of before: its crumbs say the section, and «Formato anterior» by its name.
    await page.getByRole("tab", { name: "Tabla" }).click();
    await page.locator(".db-table tbody tr").getByText("Leer correo", { exact: true }).click();
    await expect(page.locator(".flow-crumbs")).toContainText("Automatizaciones");
    await expect(page.locator(".flow-crumbs .former-format")).toHaveText("Formato anterior");
    await noFlujo();
  });
  test("AU-61 · the list is a collection page, «Tabla | Mapa», with six columns: Nombre, Se inicia, Estado, Última ejecución, Ejecuciones and De; an automation of the new format says «Sin publicar» and one with no trigger «—»; a flow of before says «Encendida» or «Apagada»", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: AUTOMATIONS,
      agent: BEFORE(FLOWS_WITH_SUMMARY),
    });
    const rows = await list(page);
    await expect(page.getByRole("tab")).toHaveText(["Tabla", "Mapa"]);
    await expect(page.locator(".db-table thead th .th-name")).toHaveText([
      "Nombre",
      "Se inicia",
      "Estado",
      "Última ejecución",
      "Ejecuciones",
      "De",
    ]);
    // The automations of the new format first, the newest first; then the flows of before, those on first.
    await expect(rows).toHaveCount(4);
    for (const text of ["Revisar gastos", "Disparado por el usuario", "Sin publicar", "Tú"])
      await expect(rows.nth(0)).toContainText(text);
    for (const text of ["Borrador sin pasos", "—", "Sin publicar"])
      await expect(rows.nth(1)).toContainText(text);
    for (const text of ["Leer correo", "Encendida", "Boni", "42"])
      await expect(rows.nth(2)).toContainText(text);
    await expect(rows.nth(3)).toContainText("Apagada");
    await expect(page.locator(".db-table tbody")).not.toContainText("Encendido");
    await page.screenshot({ path: `${SHOTS}/automations-list.png` });
  });
  test("AU-61 · with no automation the page says what any empty collection says, with its «Nueva»; «Mapa» shows the flows of before and no automation that is not published", async ({
    page,
  }) => {
    await openApp(page, "/?still", { agent: BEFORE({ flows: [] }) });
    const rows = await list(page);
    // What any empty collection shows: its columns, no row, and its «Nueva» above and under the table.
    await expect(page.locator(".db-table thead th .th-name")).toHaveCount(6);
    await expect(rows).toHaveCount(0);
    await expect(
      page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".db-add-row")).toHaveText("Nueva");
    await page.screenshot({ path: `${SHOTS}/automations-empty.png` });
  });

  test("AU-61 · «Mapa» shows the flows of before and no automation that is not published", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    await list(page);
    await page.getByRole("tab", { name: "Mapa" }).click();
    const map = page.locator(".mp-stage");
    await expect(map.locator(".mp-card", { hasText: "Leer correo" }).first()).toBeVisible();
    await expect(map.locator(".mp-card", { hasText: "Revisar gastos" })).toHaveCount(0);
    await expect(map.locator(".mp-card", { hasText: "Borrador sin pasos" })).toHaveCount(0);
  });
  test("AU-61 · «Nueva» opens the empty canvas and asks the server for nothing; the automation is in the list, named «Nueva automatización», once it has its first step", async ({
    page,
  }) => {
    await openApp(page, "/?still", { agent: BEFORE() });
    const rows = await list(page);
    await expect(rows).toHaveCount(1);
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    await expect(page.locator(".auto-start h2")).toHaveText("¿Cómo empieza?");
    await expect(nameBox(page)).toHaveValue("Nueva automatización");
    // Longer than the pause before a save: nothing was asked and nothing says it was saved.
    await page.waitForTimeout(1500);
    expect(await asked(page)).toEqual([]);
    await expect(saved(page)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/automation-new.png` });
    // Back with nothing done: the list as it was.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(rows).toHaveCount(1);
    expect(await asked(page)).toEqual([]);
    // Its first step makes it.
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    await page.getByRole("button", { name: "Disparado por el usuario" }).click();
    await expect(saved(page)).toHaveText("Guardado");
    // The automation, then the box of its first step (AU-05): the server had none to keep before.
    await expect
      .poll(() => asked(page))
      .toEqual(["POST", expect.stringMatching(/^PUT a_\w+\/layout$/)]);
    const [made] = await sent(page, "POST api/agent/automations ");
    const first = made?.automation as { name: string; steps: { id: string; type: string }[] };
    expect(first.name).toBe("Nueva automatización");
    expect(first.steps.map((x) => x.type)).toEqual(["manual"]);
    const id = (await asked(page))[1]?.split(" ")[1]?.split("/")[0] as string;
    const [box] = await layouts(page, id);
    expect(box?.map((p) => p.step)).toEqual([first.steps[0]?.id]);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(rows).toHaveCount(2);
    for (const text of ["Nueva automatización", "Disparado por el usuario", "Sin publicar"])
      await expect(rows.first()).toContainText(text);
  });
  test("AU-151 · «Nueva» always opens the new canvas; a flow of before opens the editor of before with «Formato anterior» by its name, and is saved, turned on and run as it was", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    // «Nueva» is the new canvas, also with flows of before in the list.
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    await expect(page.locator(".auto-page .auto-start")).toBeVisible();
    await expect(page.locator(".flow-editor")).toHaveCount(0);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    // A flow of before: the editor of before, marked by its name.
    await rows.getByText("Leer correo", { exact: true }).click();
    await expect(page.locator(".flow-editor .flow-canvas .fl-node").first()).toBeVisible();
    await expect(page.locator(".auto-page")).toHaveCount(0);
    const crumbs = page.locator(".flow-crumbs");
    await expect(crumbs).toContainText("Leer correo");
    await expect(crumbs.locator(".former-format")).toHaveText("Formato anterior");
    // As it was: saved with «Guardar», turned on and off with its switch, through the routes of the flows.
    await expect(page.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
    const on = page.locator('[data-boni-action="flows.enable"]');
    await expect(on).toBeChecked();
    await on.click();
    await expect
      .poll(async () => (await sent(page, "PUT api/agent/flows/leer-correo/enabled ")).length)
      .toBe(1);
    expect(await sent(page, "PUT api/agent/flows/leer-correo/enabled ")).toEqual([
      { enabled: false },
    ]);
    await expect(on).not.toBeChecked();
    await page.screenshot({ path: `${SHOTS}/automations-former-format.png` });
  });
});

test.describe("the editor", () => {
  test("AU-62 · the header has back, the name (edited in place), «Guardado» and «⋯» with Duplicar and Eliminar, and nothing else of its own; there is no bar under it and no button to save", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    await rows.getByText("Revisar gastos", { exact: true }).click();
    await expect(nameBox(page)).toHaveValue("Revisar gastos");
    await expect(saved(page)).toHaveText("Guardado");
    // Back, the name, «Guardado» and «⋯»: two buttons and the name, nothing else.
    await expect(head(page).getByRole("button")).toHaveCount(2);
    await expect(
      head(page).getByRole("button", { name: "Volver a Automatizaciones" }),
    ).toBeVisible();
    await expect(head(page).getByRole("button", { name: "Más" })).toBeVisible();
    await expect(head(page).getByRole("textbox")).toHaveCount(1);
    // No bar under it, no button to save.
    await expect(page.locator(".auto-page .doc > *")).toHaveCount(2);
    await expect(page.locator(".auto-page .doc > *").nth(1)).toHaveClass(/auto-canvas/);
    await expect(page.getByRole("button", { name: /^Guardar/ })).toHaveCount(0);
    await head(page).getByRole("button", { name: "Más" }).click();
    await expect(page.locator(".pop-box .menu-item")).toHaveText(["Duplicar", "Eliminar"]);
    await page.screenshot({ path: `${SHOTS}/automation-header.png` });
  });
  test("AU-62 · a change is saved after a short pause and on leaving the editor: «Guardando…», then «Guardado»; with the server failing, «Sin guardar · Reintentar», and it is saved when the server is back; opened again, the draft is as it was left", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    await rows.getByText("Revisar gastos", { exact: true }).click();
    const box = nameBox(page);
    await expect(box).toHaveValue("Revisar gastos");
    const draft = "PUT api/agent/automations/a_01jx8p3k5m7n9q2r4t6v8w0y1z/draft ";
    // Typed at a person's pace: «Guardando…» while typing, one save after the pause, then «Guardado».
    await box.click();
    await box.press("End");
    await box.pressSequentially(" del mes", { delay: 120 });
    await expect(saved(page)).toHaveText("Guardando…");
    await expect(saved(page)).toHaveText("Guardado");
    const once = await sent(page, draft);
    expect(once).toHaveLength(1);
    expect(await lastName(page, draft)).toBe("Revisar gastos del mes");
    // The server failing: «Sin guardar · Reintentar»; what he typed stays; saved when the server is back.
    await serverDown(page, true);
    const before = (await asked(page)).length;
    await box.pressSequentially(" ejemplo", { delay: 120 });
    await expect(saved(page)).toContainText("Sin guardar");
    await expect(saved(page).getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(box).toHaveValue("Revisar gastos del mes ejemplo");
    await page.screenshot({ path: `${SHOTS}/automation-not-saved.png` });
    // Tried again by itself a moment later (2 s, then 4 s): still failing, still said.
    await expect.poll(async () => (await asked(page)).length - before, { timeout: 5_000 }).toBe(2);
    await expect(saved(page)).toContainText("Sin guardar");
    await serverDown(page, false);
    await saved(page).getByRole("button", { name: "Reintentar" }).click();
    await expect(saved(page)).toHaveText("Guardado");
    expect(await lastName(page, draft)).toBe("Revisar gastos del mes ejemplo");
    // On leaving, before the pause: sent on the way out; opened again, as it was left.
    await box.press("End");
    await box.pressSequentially(" 2", { delay: 60 });
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect.poll(() => lastName(page, draft)).toBe("Revisar gastos del mes ejemplo 2");
    await rows.getByText(/^Revisar gastos del mes ejemplo/).click();
    await expect(box).toHaveValue("Revisar gastos del mes ejemplo 2");
    await expect(saved(page)).toHaveText("Guardado");
  });
  test("AU-62 · «Duplicar» opens «<nombre> (copia)» with the same steps in the same places; «Eliminar» takes it off the list without asking and the «Deshacer» of its notice brings it back", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: AUTOMATIONS, agent: BEFORE() });
    const rows = await list(page);
    await expect(rows).toHaveCount(3);
    let confirmed = false;
    page.on("dialog", (d) => {
      confirmed = true;
      void d.dismiss();
    });
    await rows.getByText("Revisar gastos", { exact: true }).click();
    await head(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Duplicar" }).click();
    // The copy, opened: its name, its own id, its trigger (no «¿Cómo empieza?»).
    await expect(nameBox(page)).toHaveValue("Revisar gastos (copia)");
    expect(
      await sent(page, "POST api/agent/automations/a_01jx8p3k5m7n9q2r4t6v8w0y1z/duplicate "),
    ).toEqual([{ name: "Revisar gastos (copia)" }]);
    await expect(page.locator(".auto-start")).toHaveCount(0);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await expect(rows).toHaveCount(4);
    for (const text of ["Revisar gastos (copia)", "Disparado por el usuario"])
      await expect(rows.first()).toContainText(text);
    // «Eliminar» without asking: off the list, and the notice's «Deshacer» brings it back.
    await rows.getByText("Revisar gastos", { exact: true }).click();
    await expect(nameBox(page)).toHaveValue("Revisar gastos");
    await head(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Eliminar" }).click();
    await expect(page.locator(".topbar h1")).toHaveText("Automatizaciones");
    await expect(rows).toHaveCount(3);
    await expect(rows.getByText("Revisar gastos", { exact: true })).toHaveCount(0);
    expect(confirmed).toBe(false);
    await expect(page.locator(".modal")).toHaveCount(0);
    const undo = page.locator(".toast").getByRole("button", { name: "Deshacer" });
    await expect(page.locator(".toast")).toContainText("«Revisar gastos» eliminada");
    await expect(undo).toHaveAttribute("data-boni-action", "automations.restore");
    await undo.click();
    await expect(rows).toHaveCount(4);
    await expect(rows.getByText("Revisar gastos", { exact: true })).toHaveCount(1);
  });

  test("AU-62 · on the canvas, the copy of «Duplicar» has each step of the original in the same place", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await expect
      .poll(() => placesOf(page, CHAIN_IDS))
      .toEqual(Object.fromEntries(CHAIN.places.map((p) => [p.step, { x: p.x, y: p.y }])));
    const was = await placesOf(page, CHAIN_IDS);
    await head(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Duplicar" }).click();
    await expect(nameBox(page)).toHaveValue("Libros por leer (copia)");
    await expect(cards(page)).toHaveCount(4);
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(was);
    await expect
      .poll(() => arrowsSeen(page))
      .toEqual(CHAIN.arrows.map((a) => `${a.from.step}>${a.to.step}`).sort());
  });
  test("AU-63 · the canvas reads left to right: each step a card of one width with its icon, its name and one line of summary, both cut with an ellipsis and whole on hover; the outputs on the right with their names; a canvas with only its trigger says nothing more", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // Left to right, in the order of the arrows.
    const xs = await Promise.all(CHAIN_IDS.map(async (id) => (await middle(card(page, id))).x));
    expect([...xs].sort((a, z) => a - z)).toEqual(xs);
    for (const id of CHAIN_IDS) {
      const c = card(page, id);
      expect(await c.evaluate((el) => getComputedStyle(el).width)).toBe("220px");
      await expect(c.locator(".auto-card-icon svg")).toHaveCount(1);
    }
    // The summary: the parameters in sight that have a value, in their order, « · » between them.
    const summary = card(page, "s_01jbuscar").locator(".auto-card-summary");
    await expect(summary).toHaveText("Libros · Límite 10");
    await expect(summary).toHaveAttribute("title", "Libros · Límite 10");
    // One line each, cut with an ellipsis; the whole text on hover (its title).
    const name = card(page, "s_01jbuscar").locator(".auto-card-name");
    await expect(name).toHaveAttribute("title", "Buscar filas en Libros");
    for (const line of [name, summary])
      expect(
        await line.evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.whiteSpace, s.textOverflow, s.overflow];
        }),
      ).toEqual(["nowrap", "ellipsis", "hidden"]);
    // A step not given a value says only its name.
    await expect(card(page, "s_01jfiltrar").locator(".auto-card-summary")).toHaveCount(0);
    // The only output says no name; a «Si» says «sí» and «no», on its right.
    await expect(card(page, "s_01jbuscar").locator(".auto-out-label")).toHaveCount(0);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Separar por estado", 4);
    const si = card(page, "s_01jsi");
    await expect(si.locator(".auto-out-label")).toHaveText(["sí", "no"]);
    const centre = (await middle(si)).x;
    for (const out of await si.locator(".auto-out").all())
      expect((await middle(out)).x).toBeGreaterThan(centre);
    await page.screenshot({ path: `${SHOTS}/automation-canvas.png` });
    // A canvas with only its trigger: its card, the «+» of its output and nothing else.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Revisar gastos", 1);
    await expect(page.locator(".auto-card-summary, .auto-out-label, .auto-start")).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
    await expect(
      card(page, "s_inicio").getByRole("button", { name: "Añadir un paso" }),
    ).toBeVisible();
  });
  test("AU-63 · the whole name and summary are in the step's view, and a step that lacks something required has a mark on its card once that parameter is marked (AU-83)", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    // On the card both are cut; in the view, whole.
    const long = VIEWED.steps[2]?.name as string;
    await expect(card(page, "s_01jfiltrar").locator(".auto-card-name")).toHaveAttribute(
      "title",
      long,
    );
    await openStep(page, "s_01jfiltrar");
    await expect(nameIn(page)).toHaveValue(long);
    expect(await nameIn(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await press(page, "Escape");
    const summary = card(page, "s_01jbuscar").locator(".auto-card-summary");
    const said = (await summary.getAttribute("title")) as string;
    expect(await summary.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await openStep(page, "s_01jbuscar");
    const whole = view(page).locator(".auto-view-summary");
    await expect(whole).toHaveText(said);
    expect(await whole.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await press(page, "Escape");
    // The mark: none on opening; once «Colección» is left empty, on the card too, saying what is missing.
    const nueva = card(page, "s_01jnueva");
    await expect(nueva.locator(".auto-card-mark")).toHaveCount(0);
    await openStep(page, "s_01jnueva");
    await param(page, "collection").getByRole("combobox").focus();
    await press(page, "Tab");
    await press(page, "Escape");
    await press(page, "Escape");
    await expect(view(page)).toHaveCount(0);
    await expect(nueva.locator(".auto-card-mark")).toHaveAttribute("title", "Falta: Colección");
  });
  test("AU-64 · bottom left: zoom in, zoom out, fit and «Ordenar»; bottom centre: «Probar»; top right: «+»; at the bottom «Registro», folded, with one line: «Sin probar», then the last test", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [testOf(ALL_DONE)], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    const flow = await page.locator(".auto-flow").boundingBox();
    if (!flow) throw new Error("no canvas");
    const zoom = await page.locator(".auto-zoom").boundingBox();
    const go = await testGo(page).boundingBox();
    const add = await page.locator(".auto-add-top").boundingBox();
    const zooms = page.locator(".auto-zoom").getByRole("button");
    await expect(zooms).toHaveCount(4);
    for (const [i, name] of ["Acercar", "Alejar", "Encajar", "Ordenar"].entries())
      await expect(zooms.nth(i)).toHaveAccessibleName(name);
    // Bottom left, bottom centre, top right.
    expect((zoom?.x ?? 0) - flow.x).toBeLessThan(40);
    expect(flow.y + flow.height - ((zoom?.y ?? 0) + (zoom?.height ?? 0))).toBeLessThan(40);
    const goMiddle = (go?.x ?? 0) + (go?.width ?? 0) / 2;
    expect(Math.abs(goMiddle - (flow.x + flow.width / 2))).toBeLessThan(160);
    expect(flow.y + flow.height - ((go?.y ?? 0) + (go?.height ?? 0))).toBeLessThan(40);
    expect(flow.x + flow.width - ((add?.x ?? 0) + (add?.width ?? 0))).toBeLessThan(40);
    expect((add?.y ?? 0) - flow.y).toBeLessThan(40);
    // «Registro»: one line, «Sin probar».
    await expect(testBar(page).locator(".auto-log-name")).toHaveText("Registro");
    await expect(logLine(page)).toHaveText("Sin probar");
    expect(await logLine(page).evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
    // Then the last test: when, how, how many steps, how long, and that it wrote nothing.
    await testGo(page).click();
    await testBar(page).getByRole("dialog").getByRole("button", { name: "Probar" }).click();
    await expect(logLine(page)).toHaveText(
      "Última prueba hace un momento · bien · 7 pasos · 0,4 s · no escribió nada · habría escrito 129 filas",
    );
    // Opened again: the line of the tests the server keeps.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, TESTED.name, 7);
    await expect(logLine(page)).toHaveText(
      "Última prueba hace un momento · bien · 7 pasos · 0,4 s · no escribió nada · habría escrito 129 filas",
    );
  });
  test("AU-64 · «Probar» with several triggers opens a menu to choose one, asks a trigger's fields in a small box with the last ones filled in, says «Probando…» and cannot be pressed meanwhile; with problems it tests nothing, marks each step and «Registro» says how many and leads to the first", async ({
    page,
  }) => {
    // Two triggers: the second asks nothing.
    const two = testOf(ALL_DONE, { tested: { s_inicio: { minimo: 250 } } });
    two.steps = [...two.steps, step("s_01jotro", "Disparado por el usuario 2", "manual")];
    two.arrows = [...two.arrows, arrow("s_01jotro", "s_01jbuscar")];
    two.places = [...two.places, { step: "s_01jotro", x: 0, y: 200 }];
    const invalid = {
      ...CHAIN,
      test: {
        steps: {},
        state: "invalid" as const,
        problems: [
          { code: "param.required", severity: "error", step: "s_01jfiltrar", param: "where" },
          {
            code: "output.unconnected",
            severity: "error",
            step: "s_01jordenar",
            detail: { output: "main" },
          },
        ],
      },
    };
    await openApp(page, "/?still", {
      automations: [two, invalid],
      agent: BEFORE(),
      slow: { path: `api/agent/automations/${TESTED.id}/test`, ms: 900 },
    });
    await openCanvas(page, TESTED.name, 8);
    // A menu to choose which trigger.
    await testGo(page).click();
    const menu = testBar(page).getByRole("menu", { name: "Probar desde" });
    await expect(menu.locator(".menu-item")).toHaveText([
      "Disparado por el usuario",
      "Disparado por el usuario 2",
    ]);
    // The one with fields: a small box with those of the last test.
    await menu.getByText("Disparado por el usuario", { exact: true }).click();
    const box = testBar(page).getByRole("dialog");
    const minimo = box.getByRole("spinbutton", { name: "Mínimo" });
    await expect(minimo).toHaveValue("250");
    await minimo.fill("320");
    await box.getByRole("button", { name: "Probar" }).click();
    // «Probando…», and it cannot be pressed meanwhile.
    await expect(testGo(page)).toHaveText("Probando…");
    await expect(testGo(page)).toBeDisabled();
    await expect(testGo(page)).toHaveText("Probar");
    await expect(testGo(page)).toBeEnabled();
    expect((await testsAsked(page)).at(-1)).toEqual({
      trigger: "s_inicio",
      fields: { minimo: 320 },
    });
    await expect(stateOf(page, "s_01jsi")).toHaveText("Bien");
    // The one with none starts without asking.
    await testGo(page).click();
    await menu.getByText("Disparado por el usuario 2", { exact: true }).click();
    await expect(testGo(page)).toHaveText("Probando…");
    await expect(testBar(page).getByRole("dialog")).toHaveCount(0);
    await expect(testGo(page)).toHaveText("Probar");
    expect((await testsAsked(page)).at(-1)).toEqual({ trigger: "s_01jotro", fields: {} });
    // With problems: nothing tested, each step with one marked, «Registro» says how many and leads to the first.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, CHAIN.name, 4);
    await testGo(page).click();
    await expect(logLine(page)).toHaveText("2 problemas");
    await expect(card(page, "s_01jfiltrar")).toHaveClass(/\bproblem\b/);
    await expect(card(page, "s_01jordenar")).toHaveClass(/\bproblem\b/);
    await expect(card(page, "s_01jbuscar")).not.toHaveClass(/\bproblem\b/);
    await expect(card(page, "s_01jordenar").locator(".auto-card-mark")).toHaveAttribute(
      "title",
      /La salida «main» no va a ningún sitio/,
    );
    await expect(page.locator(".auto-card-state")).toHaveCount(0);
    await expect(page.locator(".auto-arrow-count")).toHaveCount(0);
    expect(await rowsAsked(page)).toEqual([]);
    await logLine(page).click();
    await expect(page.locator(".auto-card.selected")).toHaveAttribute("data-step", "s_01jfiltrar");
  });
  test("AU-65 · a step is added from the «+» of the top, the «+» of an output with no arrow (or dragging from it), the «+» of a selected arrow and a right click on the canvas: the four open the same panel, and the step chosen ends connected and selected", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    const selected = page.locator(".auto-card.selected");
    // The «+» of the top: connected to nothing.
    await page.locator(".auto-add-top").click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator("h3").first()).toHaveText("Leer o escribir en una colección");
    await choose(page, "Filtrar");
    await expect(panel(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(5);
    await expect(selected).toHaveCount(1);
    await expect(selected.locator(".auto-card-name")).toHaveText("Filtrar 2");
    await expect.poll(() => arrowsSeen(page)).toHaveLength(3);
    // The «+» of an output with no arrow: the new step hangs from it.
    await card(page, "s_01jordenar").getByRole("button", { name: "Añadir un paso" }).click();
    await expect(panel(page)).toBeVisible();
    await choose(page, "Ordenar filas");
    await expect(selected.locator(".auto-card-name")).toHaveText("Ordenar filas");
    const second = (await selected.getAttribute("data-step")) as string;
    await expect.poll(() => arrowsSeen(page)).toContain(`s_01jordenar>${second}`);
    // Dragging from that output and letting go on the canvas: the same panel, and the step hangs from it.
    const out = node(page, second).locator(".react-flow__handle.source");
    const from = await middle(out);
    await drag(page, from, { x: from.x + 160, y: from.y + 140 });
    await expect(panel(page)).toBeVisible();
    await choose(page, "Limitar");
    await expect(selected.locator(".auto-card-name")).toHaveText("Limitar");
    const third = (await selected.getAttribute("data-step")) as string;
    await expect.poll(() => arrowsSeen(page)).toContain(`${second}>${third}`);
    // The «+» of a selected arrow: the new step goes between its two ends.
    // (The step added was brought into sight: fitted again first, as Juan would.)
    await page.locator(".auto-zoom").getByRole("button", { name: "Encajar" }).click();
    await settled(page);
    await page.mouse.click(...xy(await arrowMiddle(page, "s_01jbuscar", "s_01jfiltrar")));
    const arrowBar = page.locator(".auto-arrow-bar");
    await expect(arrowBar).toBeVisible();
    await arrowBar.getByRole("button", { name: "Añadir un paso" }).click();
    await expect(panel(page)).toBeVisible();
    await choose(page, "Quitar duplicados");
    const between = (await selected.getAttribute("data-step")) as string;
    await expect.poll(() => arrowsSeen(page)).toContain(`s_01jbuscar>${between}`);
    const seen = await arrowsSeen(page);
    expect(seen).toContain(`${between}>s_01jfiltrar`);
    expect(seen).not.toContain("s_01jbuscar>s_01jfiltrar");
    // A right click on the canvas: connected to nothing, its box where the click was.
    const flow = await page.locator(".auto-flow").boundingBox();
    if (!flow) throw new Error("no canvas");
    const click = { x: flow.x + 120, y: flow.y + flow.height - 90 };
    await page.mouse.click(click.x, click.y, { button: "right" });
    await expect(panel(page)).toBeVisible();
    await choose(page, "Agrupar");
    const placed = await selected.boundingBox();
    expect(Math.abs((placed?.x ?? 0) - click.x)).toBeLessThan(4);
    expect(Math.abs((placed?.y ?? 0) - click.y)).toBeLessThan(4);
    const lone = (await selected.getAttribute("data-step")) as string;
    expect((await arrowsSeen(page)).some((a) => a.includes(lone))).toBe(false);
    // Each of them one change, saved as the draft.
    await expect(saved(page)).toHaveText("Guardado");
    expect((await lastDraft(page, CHAIN.id))?.steps).toHaveLength(9);
  });
  test("AU-65 · the step chosen ends open: its view opens as it is added, and Esc leaves it selected on the canvas", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    const selected = page.locator(".auto-card.selected");
    await page.locator(".auto-add-top").click();
    await pick(page, "Filtrar");
    await expect(view(page)).toBeVisible();
    await expect(nameIn(page)).toHaveValue("Filtrar 2");
    const made = (await selected.getAttribute("data-step")) as string;
    await expect(view(page)).toHaveAttribute("data-step", made);
    await press(page, "Escape");
    await expect(view(page)).toHaveCount(0);
    await expect(selected).toHaveAttribute("data-step", made);
    // From the «+» of an output: the same.
    await card(page, "s_01jordenar").getByRole("button", { name: "Añadir un paso" }).click();
    await pick(page, "Limitar");
    await expect(nameIn(page)).toHaveValue("Limitar");
    await expect(view(page)).toHaveAttribute(
      "data-step",
      (await selected.getAttribute("data-step")) as string,
    );
  });
  test("AU-66 · a selected step shows a short bar, Probar paso · Apagar · Eliminar · ⋯ (Cambiar nombre · Duplicar · Copiar); a selected arrow, «+» and delete; the right click on a step has seven things; nothing appears on hover; an off step says «Encender»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // Nothing on hover.
    await card(page, "s_01jfiltrar").hover();
    await page.waitForTimeout(300);
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator(".auto-arrow-bar")).toHaveCount(0);
    // Selected: the bar.
    await card(page, "s_01jfiltrar").click();
    await expect(bar(page).getByRole("button")).toHaveText([
      "Probar paso",
      "Apagar",
      "Eliminar",
      "",
    ]);
    await expect(bar(page).getByRole("button", { name: "Probar paso" })).toBeDisabled();
    await bar(page).getByRole("button", { name: "Más" }).click();
    await expect(page.locator(".pop-box .menu-item")).toHaveText([
      "Cambiar nombre",
      "Duplicar",
      "Copiar",
    ]);
    await page.screenshot({ path: `${SHOTS}/automation-step-bar.png` });
    await press(page, "Escape");
    // Off: dimmed, and the bar says «Encender».
    await bar(page).getByRole("button", { name: "Apagar" }).click();
    await expect(card(page, "s_01jfiltrar")).toHaveClass(/\boff\b/);
    await expect(bar(page).getByRole("button", { name: "Encender" })).toBeVisible();
    await expect(saved(page)).toHaveText("Guardado");
    const off = (await lastDraft(page, CHAIN.id))?.steps.find((s) => s.id === "s_01jfiltrar");
    expect((off as { settings?: { off?: boolean } } | undefined)?.settings?.off).toBe(true);
    // Two selected: no bar.
    await card(page, "s_01jordenar").click({ modifiers: ["Shift"] });
    await expect(page.locator(".auto-card.selected")).toHaveCount(2);
    await expect(bar(page)).toHaveCount(0);
    // The right click on a step: seven things, «Encender» on an off step.
    await card(page, "s_01jfiltrar").click({ button: "right" });
    await expect(page.locator(".pop-box .menu-item")).toHaveText([
      "Abrir",
      "Probar paso",
      "Encender",
      "Cambiar nombre",
      "Duplicar",
      "Copiar",
      "Eliminar",
    ]);
    await press(page, "Escape");
    await expect(page.locator(".pop-box")).toHaveCount(0);
    // A selected arrow: «+» and the cross.
    await page.mouse.click(...xy(await arrowMiddle(page, "s_inicio", "s_01jbuscar")));
    const arrowBar = page.locator(".auto-arrow-bar");
    await expect(arrowBar.getByRole("button")).toHaveCount(2);
    await expect(arrowBar.getByRole("button", { name: "Añadir un paso" })).toBeVisible();
    await arrowBar.getByRole("button", { name: "Quitar la flecha" }).click();
    await expect.poll(() => arrowsSeen(page)).not.toContain("s_inicio>s_01jbuscar");
  });
  test("AU-66 · «Abrir» of a step's right click opens its view, the step selected", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await card(page, "s_01jfiltrar").click({ button: "right" });
    await page.getByRole("menuitemradio", { name: "Abrir" }).click();
    await expect(view(page)).toHaveAttribute("data-step", "s_01jfiltrar");
    await expect(nameIn(page)).toHaveValue("Filtrar");
    await expect(page.locator(".auto-card.selected")).toHaveAttribute("data-step", "s_01jfiltrar");
    await press(page, "Escape");
    await expect(view(page)).toHaveCount(0);
  });
  test("AU-66 · deleting a step between two others joins them with one arrow; deleting one with two outputs in use takes its arrows", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await card(page, "s_01jbuscar").click();
    await bar(page).getByRole("button", { name: "Eliminar" }).click();
    await expect(cards(page)).toHaveCount(3);
    await expect
      .poll(() => arrowsSeen(page))
      .toEqual(["s_01jfiltrar>s_01jordenar", "s_inicio>s_01jfiltrar"]);
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Separar por estado", 4);
    await card(page, "s_01jsi").click({ button: "right" });
    await page.getByRole("menuitemradio", { name: "Eliminar" }).click();
    await expect(cards(page)).toHaveCount(3);
    await expect.poll(() => arrowsSeen(page)).toEqual([]);
  });
  test("AU-68 · Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes a step added, removed, connected, moved and renamed; Ctrl+C, X and V copy, cut and paste the selected steps with the arrows between them; Supr deletes, Esc closes; what was undone is saved; a key typed in a field is the field's; after a reload there is nothing to undo", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    const chain = CHAIN.arrows.map((a) => `${a.from.step}>${a.to.step}`).sort();
    // Removed with Supr, joined; undone and redone both ways.
    await card(page, "s_01jfiltrar").click();
    await press(page, "Delete");
    await expect(cards(page)).toHaveCount(3);
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(4);
    await expect.poll(() => arrowsSeen(page)).toEqual(chain);
    await press(page, "Control+Shift+z");
    await expect(cards(page)).toHaveCount(3);
    await press(page, "Control+z");
    await press(page, "Control+y");
    await expect(cards(page)).toHaveCount(3);
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(4);
    // Added.
    await page.locator(".auto-add-top").click();
    await choose(page, "Filtrar");
    await expect(cards(page)).toHaveCount(5);
    await page.locator(".auto-flow .react-flow__pane").click({ position: { x: 20, y: 20 } });
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(4);
    // Moved (the step added was brought into sight: fitted again first, as Juan would).
    await page.locator(".auto-zoom").getByRole("button", { name: "Encajar" }).click();
    await settled(page);
    const was = await at(page, "s_01jbuscar");
    const c = await middle(card(page, "s_01jbuscar"));
    await drag(page, c, { x: c.x + 40, y: c.y + 120 });
    await expect.poll(() => at(page, "s_01jbuscar")).not.toEqual(was);
    await press(page, "Control+z");
    await expect.poll(() => at(page, "s_01jbuscar")).toEqual(was);
    // Renamed.
    await card(page, "s_01jordenar").click({ button: "right" });
    await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
    const box = page.getByRole("textbox", { name: "Cambiar nombre" });
    await box.fill("Ordenar por título");
    await box.press("Enter");
    await expect(card(page, "s_01jordenar").locator(".auto-card-name")).toHaveText(
      "Ordenar por título",
    );
    await press(page, "Control+z");
    await expect(card(page, "s_01jordenar").locator(".auto-card-name")).toHaveText("Ordenar");
    // Disconnected and connected again by dragging from an output to an input.
    await page.mouse.click(...xy(await arrowMiddle(page, "s_01jfiltrar", "s_01jordenar")));
    await page.locator(".auto-arrow-bar").getByRole("button", { name: "Quitar la flecha" }).click();
    await expect.poll(() => arrowsSeen(page)).toHaveLength(2);
    await drag(
      page,
      await middle(node(page, "s_01jfiltrar").locator(".react-flow__handle.source")),
      await middle(node(page, "s_01jordenar").locator(".react-flow__handle.target")),
    );
    await expect.poll(() => arrowsSeen(page)).toEqual(chain);
    await press(page, "Control+z");
    await expect.poll(() => arrowsSeen(page)).toHaveLength(2);
    await press(page, "Control+z");
    await expect.poll(() => arrowsSeen(page)).toEqual(chain);
    // What was undone is saved: the draft as it was opened.
    await expect(saved(page)).toHaveText("Guardado");
    const back = await lastDraft(page, CHAIN.id);
    expect(back?.steps).toEqual(CHAIN.steps);
    expect(back?.arrows).toEqual(CHAIN.arrows);
    // Copied and pasted, with the arrow between them, under the pointer; names that are taken get a number.
    await card(page, "s_01jbuscar").click();
    await card(page, "s_01jfiltrar").click({ modifiers: ["Shift"] });
    await press(page, "Control+c");
    const flow = await page.locator(".auto-flow").boundingBox();
    if (!flow) throw new Error("no canvas");
    await page.mouse.move(flow.x + flow.width / 2, flow.y + flow.height - 120);
    await press(page, "Control+v");
    await expect(cards(page)).toHaveCount(6);
    await expect
      .poll(() => cardNames(page))
      .toEqual(expect.arrayContaining(["Buscar filas en Libros 2", "Filtrar 2"]));
    const pasted = await page
      .locator(".auto-card.selected")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-step") as string));
    expect(pasted).toHaveLength(2);
    await expect.poll(() => arrowsSeen(page)).toContain(`${pasted[0]}>${pasted[1]}`);
    // Cut: gone, and pasted again.
    await press(page, "Control+x");
    await expect(cards(page)).toHaveCount(4);
    await press(page, "Control+v");
    await expect(cards(page)).toHaveCount(6);
    // Esc closes: the menu, the panel, then what is selected.
    await page.locator(".auto-add-top").click();
    await expect(panel(page)).toBeVisible();
    await press(page, "Escape");
    await expect(panel(page)).toHaveCount(0);
    await press(page, "Escape");
    await expect(page.locator(".auto-card.selected")).toHaveCount(0);
    // A key typed in a field is the field's.
    await nameBox(page).click();
    await press(page, "Control+z");
    await expect(cards(page)).toHaveCount(6);
    // After a reload there is nothing to undo.
    await expect(saved(page)).toHaveText("Guardado");
    await page.reload();
    await openCanvas(page, "Libros por leer", 4);
    const before = (await asked(page)).length;
    await page.locator(".auto-flow .react-flow__pane").click({ position: { x: 20, y: 20 } });
    await press(page, "Control+z");
    await page.waitForTimeout(1500);
    await expect(cards(page)).toHaveCount(4);
    expect((await asked(page)).slice(before)).toEqual([]);
  });
  test("AU-68 · steps copied in one automation are pasted in another, with new ids and the arrows between them", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await card(page, "s_01jbuscar").click();
    await card(page, "s_01jfiltrar").click({ modifiers: ["Shift"] });
    await press(page, "Control+c");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Revisar gastos", 1);
    await page.locator(".auto-flow .react-flow__pane").click({ position: { x: 40, y: 40 } });
    await press(page, "Control+v");
    await expect(cards(page)).toHaveCount(3);
    const pasted = await page
      .locator(".auto-card.selected")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-step") as string));
    expect(pasted).toHaveLength(2);
    expect(pasted).not.toContain("s_01jbuscar");
    expect(pasted).not.toContain("s_01jfiltrar");
    await expect.poll(() => arrowsSeen(page)).toEqual([`${pasted[0]}>${pasted[1]}`]);
    await expect
      .poll(() => cardNames(page))
      .toEqual(expect.arrayContaining(["Buscar filas en Libros", "Filtrar"]));
  });
  test("AU-68 · Ctrl+Z undoes a parameter or a setting changed in the step's view, a run of keys at once, and Ctrl+Y redoes it; Intro opens the selected step", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    const limitar = card(page, "s_01jlimitar");
    // Intro opens the selected step.
    await limitar.click();
    await press(page, "Enter");
    await expect(view(page)).toHaveAttribute("data-step", "s_01jlimitar");
    // A number typed at a person's pace is one change.
    const count = param(page, "count").getByRole("spinbutton");
    await count.click();
    await press(page, "Control+a");
    await count.pressSequentially("25", { delay: 120 });
    await expect(limitar.locator(".auto-card-summary")).toHaveText("Cuántas 25");
    await press(page, "Control+z");
    await expect(count).toHaveValue("5");
    await expect(limitar.locator(".auto-card-summary")).toHaveText("Cuántas 5");
    await press(page, "Control+y");
    await expect(count).toHaveValue("25");
    // A setting: «Apagado» taken off, then put back with Ctrl+Z.
    await view(page)
      .getByRole("tab", { name: /^Ajustes/ })
      .click();
    await view(page).getByRole("checkbox", { name: "Apagado" }).uncheck();
    await expect(limitar).not.toHaveClass(/\boff\b/);
    await press(page, "Control+z");
    await expect(limitar).toHaveClass(/\boff\b/);
    await expect(view(page).getByRole("checkbox", { name: "Apagado" })).toBeChecked();
    await press(page, "Control+Shift+z");
    await expect(limitar).not.toHaveClass(/\boff\b/);
    await press(page, "Control+z");
    // What was undone is saved: the count is 25 and the step is off.
    await expect(saved(page)).toHaveText("Guardado");
    const kept = (await lastDraft(page, VIEWED.id))?.steps.find((s) => s.id === "s_01jlimitar") as
      | { params: Record<string, unknown>; settings?: { off?: boolean } }
      | undefined;
    expect(kept?.params.count).toBe(25);
    expect(kept?.settings?.off).toBe(true);
  });
  test("AU-05 · a box stays where it is dropped, opened again too, and moving it does not say «Guardando…» nor send the draft; a new step goes to the right of the one it hangs from and no other box moves; «Ordenar» moves them all and Ctrl+Z puts them back", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    const rows = await openCanvas(page, "Libros por leer", 4);
    await expect(saved(page)).toHaveText("Guardado");
    const c = await middle(card(page, "s_01jfiltrar"));
    await drag(page, c, { x: c.x + 30, y: c.y + 150 });
    await expect.poll(async () => (await at(page, "s_01jfiltrar")).y).toBeGreaterThan(100);
    const dropped = await at(page, "s_01jfiltrar");
    // Never «Guardando…»: the draft did not change. One request when it is dropped, with that box alone.
    await expect(saved(page)).toHaveText("Guardado");
    await expect
      .poll(() => layouts(page, CHAIN.id))
      .toEqual([[{ step: "s_01jfiltrar", ...dropped }]]);
    await page.waitForTimeout(1500);
    expect(await sent(page, `PUT api/agent/automations/${CHAIN.id}/draft `)).toEqual([]);
    expect(await layouts(page, CHAIN.id)).toHaveLength(1);
    // Opened again: where it was dropped.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await rows.getByText("Libros por leer", { exact: true }).click();
    await expect(cards(page)).toHaveCount(4);
    await expect.poll(() => at(page, "s_01jfiltrar")).toEqual(dropped);
    // A new step: to the right of the one it hangs from, at its height; no other box moves.
    const before = await placesOf(page, CHAIN_IDS);
    await card(page, "s_01jordenar").getByRole("button", { name: "Añadir un paso" }).click();
    await choose(page, "Limitar");
    const made = (await page.locator(".auto-card.selected").getAttribute("data-step")) as string;
    await expect
      .poll(() => at(page, made))
      .toEqual({
        x: before.s_01jordenar.x + 300,
        y: before.s_01jordenar.y,
      });
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(before);
    // Its box is kept like one dropped, once the server has the step.
    await expect
      .poll(async () => (await layouts(page, CHAIN.id)).at(-1))
      .toEqual([{ step: made, x: before.s_01jordenar.x + 300, y: before.s_01jordenar.y }]);
    // «Ordenar» places them all again; Ctrl+Z puts them back.
    const all = [...CHAIN_IDS, made];
    const untidy = await placesOf(page, all);
    await page.locator(".auto-zoom").getByRole("button", { name: "Ordenar" }).click();
    await expect.poll(() => at(page, "s_01jfiltrar")).not.toEqual(dropped);
    const tidy = await placesOf(page, all);
    expect(new Set(Object.values(tidy).map((p) => p.y)).size).toBe(1);
    await press(page, "Control+z");
    await expect.poll(() => placesOf(page, all)).toEqual(untidy);
    await expect(saved(page)).toHaveText("Guardado");
  });
  test("AU-05 · moving a box ages no test (AU-92): its counts and its SALIDA stay as they were, and the draft is not sent", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN })],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name, 7);
    await expect(countOn(page, "s_01jbuscar", "s_01jsi")).toHaveText("128 filas");
    const c = await middle(card(page, "s_01jsi"));
    await drag(page, c, { x: c.x + 20, y: c.y + 160 });
    await expect.poll(async () => (await layouts(page, TESTED.id)).length).toBe(1);
    await page.waitForTimeout(1500);
    expect(await sent(page, `PUT api/agent/automations/${TESTED.id}/draft `)).toEqual([]);
    await expect(page.locator(".auto-card-state.stale")).toHaveCount(0);
    await expect(page.locator(".auto-arrow-count.dim")).toHaveCount(0);
    await openStep(page, "s_01jsi");
    await expect(salida(page).locator(".auto-out-stale")).toHaveCount(0);
  });
  test.fixme("AU-05 · over the real server, a box dropped is there after a reload and in another window (G: the desktop app)", async () => {});
  test("AU-87 · adding a step puts that step and nothing else: no other step, arrow or option appears, and nothing changes on the canvas that Juan did not do", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // Opened and left alone: nothing is sent, nothing moves.
    const opened = await placesOf(page, CHAIN_IDS);
    await page.waitForTimeout(1500);
    expect(await asked(page)).toEqual([`GET ${CHAIN.id}`]);
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(opened);
    // One step added: that step, its one arrow, and nothing else.
    await card(page, "s_01jordenar").getByRole("button", { name: "Añadir un paso" }).click();
    await choose(page, "Filtrar");
    await expect(saved(page)).toHaveText("Guardado");
    const after = await lastDraft(page, CHAIN.id);
    expect(after?.steps.slice(0, 4)).toEqual(CHAIN.steps);
    expect(after?.steps).toHaveLength(5);
    const made = after?.steps[4];
    expect(made).toEqual({ id: made?.id, name: "Filtrar 2", type: "filter", params: {} });
    expect(after?.arrows).toEqual([...CHAIN.arrows, arrow("s_01jordenar", made?.id as string)]);
    await expect.poll(() => placesOf(page, CHAIN_IDS)).toEqual(opened);
    // A step of «Colección» carries its action and nothing more.
    await page.locator(".auto-add-top").click();
    await choose(page, "Buscar filas");
    await expect(saved(page)).toHaveText("Guardado");
    expect((await lastDraft(page, CHAIN.id))?.steps.at(-1)?.params).toEqual({ action: "find" });
  });
  test("AU-67 · after a test each arrow says how many rows passed («128 filas»; «0 filas» dimmed), an output with no arrow its count too, and each step how it ended (bien, falló, saltado, parado); a step that failed says why on its card in two lines at most, whole in its SALIDA with «Ir al parámetro», and in «Registro»; the ones that hung from it are «parados» and its arrows say no count; «saltado» is a step no rows came to", async ({
    page,
  }) => {
    const fails = testOf(
      SI_FAILS,
      { state: "failed", failedAt: "s_01jsi" },
      { id: "a_01jx8y1v3x5z7b9d1f3h5k7m9p", name: "Revisar cortos" },
    );
    const none = testOf(
      NONE_PASS,
      {},
      { id: "a_01jx8z2w4y6a8c0e2g4j6m8p0r", name: "Revisar largos" },
    );
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE), fails, none],
      agent: BEFORE(),
    });
    // All fine: the count on each arrow and on the output with none, and «Bien» on each card.
    await openCanvas(page, TESTED.name, 7);
    await expect(page.locator(".auto-arrow-count")).toHaveCount(0);
    await testGo(page).click();
    await testBar(page).getByRole("dialog").getByRole("button", { name: "Probar" }).click();
    await expect(countOn(page, "s_inicio", "s_01jbuscar")).toHaveText("1 fila");
    await expect(countOn(page, "s_01jbuscar", "s_01jsi")).toHaveText("128 filas");
    await expect(countOn(page, "s_01jsi", "s_01jmodificar")).toHaveText("3 filas");
    await expect(countOn(page, "s_01jsi", "s_01jeliminar")).toHaveText("125 filas");
    await expect(page.locator(".auto-arrow-count.dim")).toHaveCount(0);
    await expect(card(page, "s_01jcrear").locator(".auto-out-count")).toHaveText("1 fila");
    for (const id of TESTED.steps.map((s) => s.id))
      await expect(stateOf(page, id)).toHaveText("Bien");
    // «Si» fails: why on its card, in two lines at most; what hung from it, «Parado».
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Revisar cortos", 7);
    await testGo(page).click();
    await testBar(page).getByRole("dialog").getByRole("button", { name: "Probar" }).click();
    await expect(stateOf(page, "s_01jsi")).toHaveText("Falló");
    const why = card(page, "s_01jsi").locator(".auto-card-why");
    await expect(why).toHaveText("Un valor no es del tipo que hace falta");
    expect(await why.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");
    await expect(why).toHaveAttribute("title", "Un valor no es del tipo que hace falta");
    for (const id of ["s_01jmodificar", "s_01jeliminar", "s_01jcombinar", "s_01jcrear"])
      await expect(stateOf(page, id)).toHaveText("Parado");
    await expect(stateOf(page, "s_01jbuscar")).toHaveText("Bien");
    // No count on the arrows out of the step that failed, nor on those the test did not reach.
    await expect(countOn(page, "s_01jsi", "s_01jmodificar")).toHaveCount(0);
    await expect(countOn(page, "s_01jsi", "s_01jeliminar")).toHaveCount(0);
    await expect(countOn(page, "s_01jmodificar", "s_01jcombinar")).toHaveCount(0);
    // In «Registro»: in which step; a click selects it.
    await expect(logLine(page)).toContainText("falló en «Si»");
    await logLine(page).click();
    await expect(page.locator(".auto-card.selected")).toHaveAttribute("data-step", "s_01jsi");
    // Whole in its SALIDA, with the parameter and «Ir al parámetro», which opens that parameter.
    await press(page, "Enter");
    await expect(view(page)).toHaveAttribute("data-step", "s_01jsi");
    await view(page).getByRole("tab", { name: "Ajustes" }).click();
    const failed = salida(page).locator('[data-out="failed"]');
    await expect(failed).toContainText("Un valor no es del tipo que hace falta");
    await expect(failed).toContainText("Condiciones");
    await failed.getByRole("button", { name: "Ir al parámetro" }).click();
    await expect(view(page).getByRole("tab", { name: "Parámetros" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(param(page, "where").locator(":focus")).toHaveCount(1);
    // A step the test did not reach says where it stopped.
    await press(page, "Escape");
    await press(page, "Escape");
    await openStep(page, "s_01jmodificar");
    await expect(salida(page).locator('[data-out="stopped"]')).toHaveText(
      "Parado: la prueba paró en «Si»",
    );
    // No rows came to «Modificar filas»: «Saltado», and the arrow to it «0 filas», dimmed.
    await press(page, "Escape");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Revisar largos", 7);
    await testGo(page).click();
    await testBar(page).getByRole("dialog").getByRole("button", { name: "Probar" }).click();
    await expect(stateOf(page, "s_01jmodificar")).toHaveText("Saltado");
    await expect(countOn(page, "s_01jsi", "s_01jmodificar")).toHaveText("0 filas");
    await expect(countOn(page, "s_01jsi", "s_01jmodificar")).toHaveClass(/\bdim\b/);
    await expect(page.locator(`[data-testid^="rf__edge-s_01jsi:yes>"] .auto-arrow`)).toHaveClass(
      /\bdim\b/,
    );
    await expect(countOn(page, "s_01jsi", "s_01jeliminar")).not.toHaveClass(/\bdim\b/);
    await openStep(page, "s_01jmodificar");
    await expect(salida(page).locator('[data-out="skipped"]')).toHaveText(
      "Saltado: no le llegaron filas",
    );
  });
});

test.describe("adding a step", () => {
  test("AU-69 · the panel is on the right with its search on top: on an empty canvas it asks «¿Cómo empieza?» and lists the triggers; then the three categories of F14b by what one wants to do, and «Añadir otro disparador» last; «Colección» shows its actions as phrases", async ({
    page,
  }) => {
    await openApp(page, "/?still", { agent: BEFORE() });
    await list(page);
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    // On an empty canvas: «¿Cómo empieza?» and the triggers, at the right, the search on top.
    const p = panel(page);
    await expect(p.locator("h2")).toHaveText("¿Cómo empieza?");
    await expect(p.locator(".auto-start-row")).toHaveText(["Disparado por el usuario"]);
    await expect(
      p.locator("> *").first().getByRole("textbox", { name: "Buscar un paso" }),
    ).toBeVisible();
    const canvas = await page.locator(".auto-canvas").boundingBox();
    const side = await p.boundingBox();
    expect(
      Math.abs((side?.x ?? 0) + (side?.width ?? 0) - ((canvas?.x ?? 0) + (canvas?.width ?? 0))),
    ).toBeLessThan(2);
    await p.getByRole("button", { name: "Disparado por el usuario" }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(panel(page)).toHaveCount(0);
    // The step chosen opens (AU-65); Esc closes its view.
    await expect(view(page)).toBeVisible();
    await press(page, "Escape");
    await expect(view(page)).toHaveCount(0);
    // Then: the three categories, said by what one wants to do, each step in one; «Añadir otro disparador» last.
    await page.locator(".auto-add-top").click();
    await expect(p.locator("h3")).toHaveText([
      "Leer o escribir en una colección",
      "Transformar filas",
      "Decidir el camino",
    ]);
    const all = await p.locator(".auto-start-row").allTextContents();
    expect(new Set(all).size).toBe(all.length);
    await expect(p.locator(".auto-panel-section").first().locator(".auto-start-row")).toHaveText([
      "Buscar filas",
      "Leer una fila",
      "Crear una fila",
      "Modificar filas",
      "Crear o modificar",
      "Eliminar filas",
      "Contar o sumar",
    ]);
    await expect(p.locator("> *").last()).toHaveText("Añadir otro disparador");
    await page.screenshot({ path: `${SHOTS}/automation-add.png` });
    await p.getByRole("button", { name: "Añadir otro disparador" }).click();
    await expect(p.locator(".auto-start-row")).toHaveText(["Disparado por el usuario"]);
  });
  test("AU-69 · the search looks in every category at once by a step's name and its actions', and with nothing found says «Nada con «…»»; under 1100 px the panel goes over the canvas", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    await page.locator(".auto-add-top").click();
    const find = panel(page).getByRole("textbox", { name: "Buscar un paso" });
    await expect(find).toBeFocused();
    // By a step's name, in every category at once.
    await find.pressSequentially("una", { delay: 60 });
    const rows = panel(page).locator(".auto-start-row");
    await expect(rows).toContainText(["Leer una fila", "Crear una fila", "Separar una lista"]);
    await expect(panel(page).locator("h3")).toHaveCount(0);
    // By an action's name: «Diferencia» is an action of «Fecha».
    await find.fill("");
    await find.pressSequentially("diferencia", { delay: 60 });
    await expect(rows).toHaveText(["Fecha"]);
    // Nothing found.
    await find.fill("");
    await find.pressSequentially("zzz", { delay: 60 });
    await expect(rows).toHaveCount(0);
    await expect(panel(page)).toContainText("Nada con «zzz»");
    // Under 1100 px: over the canvas, which keeps its width.
    await page.setViewportSize({ width: 1000, height: 800 });
    const flow = await page.locator(".auto-flow").boundingBox();
    const canvas = await page.locator(".auto-canvas").boundingBox();
    const over = await panel(page).boundingBox();
    expect(Math.abs((flow?.width ?? 0) - (canvas?.width ?? 0))).toBeLessThan(3);
    expect(over?.x ?? 0).toBeLessThan((flow?.x ?? 0) + (flow?.width ?? 0));
    // Nothing goes sideways, down to a phone's width.
    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 800 });
      // Once the layout has followed the new width.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
    }
  });
  test("AU-69 · the step chosen in the panel opens in its view: the trigger of an empty canvas, and a step after it", async ({
    page,
  }) => {
    await openApp(page, "/?still", { agent: BEFORE() });
    await list(page);
    await page.locator(".db-head").getByRole("button", { name: "Nueva", exact: true }).click();
    await pick(page, "Disparado por el usuario");
    await expect(cards(page)).toHaveCount(1);
    const trigger = (await cards(page).getAttribute("data-step")) as string;
    await expect(view(page)).toHaveAttribute("data-step", trigger);
    await expect(view(page).getByRole("region", { name: "Entrada" })).toContainText(
      "Datos de prueba",
    );
    await press(page, "Escape");
    await page.locator(".auto-add-top").click();
    await pick(page, "Buscar filas");
    await expect(view(page)).toBeVisible();
    await expect(nameIn(page)).toHaveValue("Buscar filas");
    await expect(view(page)).not.toHaveAttribute("data-step", trigger);
  });
  test("AU-86 · a new step is named by what it does («Buscar filas», «Buscar filas en Libros» with its collection); a second «Filtrar» is «Filtrar 2»; a step renamed keeps its name", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: CANVAS, agent: BEFORE() });
    await openCanvas(page, "Libros por leer", 4);
    // A collection's step named with it, as the server keeps it.
    await expect(card(page, "s_01jbuscar").locator(".auto-card-name")).toHaveText(
      "Buscar filas en Libros",
    );
    // New: by its action, with no collection yet; a name taken gets a number.
    await page.locator(".auto-add-top").click();
    await choose(page, "Buscar filas");
    await expect(page.locator(".auto-card.selected .auto-card-name")).toHaveText("Buscar filas");
    await page.locator(".auto-add-top").click();
    await choose(page, "Filtrar");
    const second = page.locator(".auto-card.selected");
    await expect(second.locator(".auto-card-name")).toHaveText("Filtrar 2");
    // Renamed on its card from «⋯»: the new name, saved; Esc leaves it as it was.
    await bar(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
    const box = page.getByRole("textbox", { name: "Cambiar nombre" });
    await expect(box).toBeFocused();
    await box.fill("Solo los pendientes");
    await box.press("Escape");
    await expect(second.locator(".auto-card-name")).toHaveText("Filtrar 2");
    await bar(page).getByRole("button", { name: "Más" }).click();
    await page.getByRole("menuitemradio", { name: "Cambiar nombre" }).click();
    await box.pressSequentially("Solo los pendientes", { delay: 40 });
    await box.press("Enter");
    await expect(second.locator(".auto-card-name")).toHaveText("Solo los pendientes");
    await expect(saved(page)).toHaveText("Guardado");
    expect((await lastDraft(page, CHAIN.id))?.steps.map((s) => s.name)).toEqual([
      "Disparado por el usuario",
      "Buscar filas en Libros",
      "Filtrar",
      "Ordenar",
      "Buscar filas",
      "Solo los pendientes",
    ]);
  });
  test("AU-86 · the name follows the step's collection, chosen in its view, until Juan renames it", async ({
    page,
  }) => {
    // «agenda» brings Tareas, a second collection to choose.
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE(), agenda: true });
    await openCanvas(page, VIEWED.name, 5);
    const nueva = card(page, "s_01jnueva").locator(".auto-card-name");
    await openStep(page, "s_01jnueva");
    const collection = param(page, "collection").getByRole("combobox");
    await collection.selectOption({ label: "Tareas" });
    await expect(nueva).toHaveText("Buscar filas en Tareas");
    await expect(nameIn(page)).toHaveValue("Buscar filas en Tareas");
    // A name taken gets a number.
    await collection.selectOption({ label: "Libros" });
    await expect(nueva).toHaveText("Buscar filas en Libros 2");
    // Renamed in the header: the collection no longer names it.
    await nameIn(page).fill("Mis libros");
    await nameIn(page).press("Enter");
    await expect(nueva).toHaveText("Mis libros");
    await collection.selectOption({ label: "Tareas" });
    await expect(nueva).toHaveText("Mis libros");
    await expect(saved(page)).toHaveText("Guardado");
    const kept = (await lastDraft(page, VIEWED.id))?.steps.find((s) => s.id === "s_01jnueva");
    expect(kept?.name).toBe("Mis libros");
    expect(kept?.params.collection).toBe("tareas");
  });
  test("AU-86 · renaming a step changes the chips that cite it (F: AU-21)", async ({ page }) => {
    await openApp(page, "/?still", { automations: [citedTested()], agent: BEFORE() });
    await openCanvas(page, CITED.name, 4);
    await openStep(page, "s_01jcrear");
    const fin = () => param(page, "fields").getByRole("textbox", { name: "Terminado" });
    await expect(fin().locator(".auto-chip")).toHaveText("Buscar filas en Libros › Título");
    await press(page, "Escape");
    await openStep(page, "s_01jbuscar");
    await nameIn(page).fill("Mis libros");
    await nameIn(page).press("Enter");
    await press(page, "Escape");
    await openStep(page, "s_01jcrear");
    await expect(fin().locator(".auto-chip")).toHaveText("Mis libros › Título");
    await expect(fin().locator(".auto-chip")).not.toHaveClass(/broken/);
    await expect.poll(() => exprOf(fin())).toBe("{{ $('Mis libros').first().titulo }}");
  });
  test("A-15 · with 200 steps, dragging a box, adding a step and «Ordenar» keep the canvas moving", async ({
    page,
  }, info) => {
    // A long automation: a trigger and 199 steps in a row, as Boni would place them.
    const many = Array.from({ length: 200 }, (_, i) =>
      i === 0
        ? step("s_inicio", "Disparado por el usuario", "manual")
        : step(`s_01jpaso${String(i).padStart(4, "0")}`, `Filtrar ${i + 1}`, "filter"),
    );
    const long = {
      id: "a_01jx8s6p8r0t2v4x6z8b0d2f4h",
      name: "Doscientos pasos",
      updated: 1761990000000,
      steps: many,
      arrows: many.slice(1).map((s, i) => arrow(many[i]?.id as string, s.id)),
    };
    await openApp(page, "/?still", { automations: [long], agent: BEFORE() });
    const rows = await list(page);
    await rows.getByText("Doscientos pasos", { exact: true }).click();
    await expect(cards(page)).toHaveCount(200);
    // The frames while a box is dragged at a person's pace.
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __run: boolean };
      w.__frames = [];
      w.__run = true;
      const tick = (t: number) => {
        w.__frames.push(t);
        if (w.__run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const c = await middle(card(page, "s_inicio"));
    await drag(page, c, { x: c.x + 60, y: c.y + 200 });
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __run: boolean };
      w.__run = false;
      return w.__frames.slice(1).map((t, i) => t - (w.__frames[i] as number));
    });
    const worst = Math.max(...frames);
    const mean = frames.reduce((a, z) => a + z, 0) / frames.length;
    // A click and its change drawn: adding a step and «Ordenar».
    const timed = async (act: () => Promise<void>, done: () => Promise<void>) => {
      const t0 = Date.now();
      await act();
      await done();
      return Date.now() - t0;
    };
    const adding = await timed(
      async () => {
        await page.locator(".auto-add-top").click();
        await pick(page, "Limitar");
      },
      () => expect(cards(page)).toHaveCount(201),
    );
    await expect(view(page)).toBeVisible();
    await press(page, "Escape");
    await expect(view(page)).toHaveCount(0);
    const tidying = await timed(
      () => page.locator(".auto-zoom").getByRole("button", { name: "Ordenar" }).click(),
      () => expect.poll(() => at(page, "s_inicio")).toEqual({ x: 0, y: 0 }),
    );
    info.annotations.push({
      type: "A-15",
      description: `200 steps: drag ${frames.length} frames, mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms; adding a step ${adding} ms; «Ordenar» ${tidying} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    expect(mean).toBeLessThan(50);
    expect(adding).toBeLessThan(2000);
    expect(tidying).toBeLessThan(2000);
  });
});

test.describe("the step's view", () => {
  test("AU-70 · a double click or Intro opens the step over the dimmed canvas in three columns, ENTRADA · «Parámetros | Ajustes» · SALIDA, with its icon, its name (edited there), «Probar paso» and close; Esc closes; there is no «Guardar»; a trigger's ENTRADA is its «Datos de prueba»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [CONDITIONS, VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    await openStep(page, "s_01jbuscar");
    // Over the canvas, which is dimmed behind it.
    const back = page.locator(".auto-view-back");
    const board = await page.locator(".auto-board").boundingBox();
    const dim = await back.boundingBox();
    expect(Math.abs((dim?.width ?? 0) - (board?.width ?? 0))).toBeLessThan(2);
    expect(await back.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    // Three columns, in this order.
    const cols = view(page).locator(".auto-view-cols > .auto-view-col");
    await expect(cols).toHaveCount(3);
    const xs = await cols.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    expect([...xs].sort((a, z) => a - z)).toEqual(xs);
    await expect(cols.nth(0)).toHaveAttribute("aria-label", "Entrada");
    await expect(cols.nth(2)).toHaveAttribute("aria-label", "Salida");
    await expect(view(page).locator(".auto-view-col-head")).toHaveText(["Entrada", "Salida"]);
    await expect(cols.nth(1).getByRole("tab")).toHaveText(["Parámetros", "Ajustes"]);
    // The header: icon, name, «Probar paso» and close; no «Guardar».
    const header = view(page).locator(".auto-view-head");
    await expect(header.locator(".auto-card-icon svg")).toHaveCount(1);
    await expect(nameIn(page)).toHaveValue("Buscar filas en Libros");
    await expect(header.getByRole("button", { name: "Probar paso" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Cerrar" })).toBeVisible();
    await expect(view(page).getByRole("button", { name: /Guardar/ })).toHaveCount(0);
    // Before any test: ENTRADA asks to test the steps before, SALIDA says «Sin probar».
    await expect(cols.nth(0)).toContainText("Prueba los pasos anteriores");
    await expect(cols.nth(0).getByRole("button", { name: "Probar los anteriores" })).toBeVisible();
    await expect(cols.nth(2)).toContainText("Sin probar");
    await page.screenshot({ path: `${SHOTS}/automation-step-view.png` });
    // The name is edited there.
    await nameIn(page).fill("Libros pendientes");
    await nameIn(page).press("Enter");
    await expect(card(page, "s_01jbuscar").locator(".auto-card-name")).toHaveText(
      "Libros pendientes",
    );
    // Esc closes, the step still selected; Intro opens it again; «Cerrar» and a click on the dimmed canvas close.
    await press(page, "Escape");
    await expect(view(page)).toHaveCount(0);
    await expect(page.locator(".auto-card.selected")).toHaveAttribute("data-step", "s_01jbuscar");
    await press(page, "Enter");
    await expect(view(page)).toHaveAttribute("data-step", "s_01jbuscar");
    await view(page).getByRole("button", { name: "Cerrar" }).click();
    await expect(view(page)).toHaveCount(0);
    await openStep(page, "s_01jbuscar");
    const edge = await back.boundingBox();
    await page.mouse.click((edge?.x ?? 0) + 6, (edge?.y ?? 0) + 6);
    await expect(view(page)).toHaveCount(0);
    // A trigger's ENTRADA: its «Datos de prueba».
    await openStep(page, "s_inicio");
    await expect(view(page).getByRole("region", { name: "Entrada" })).toContainText(
      "Datos de prueba",
    );
    await expect(view(page).getByRole("region", { name: "Entrada" })).toContainText(
      "No pide campos",
    );
    // One that asks fields lists them there.
    await press(page, "Escape");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, CONDITIONS.name, 6);
    await openStep(page, "s_inicio");
    const asked = view(page).getByRole("region", { name: "Entrada" });
    await expect(asked).toContainText("Datos de prueba");
    // E: each one a box to fill in for the next test (AU-94).
    await expect(asked.locator(".auto-trial-name")).toHaveText(["Mínimo"]);
    await expect(asked.getByRole("spinbutton", { name: "Mínimo" })).toBeVisible();
    await expect(asked).not.toContainText("No pide campos");
  });
  test("AU-71 · ENTRADA says which step its rows come from and how many, lets any earlier step of the path be chosen, and is seen as «Esquema» (first, each field with a sample value cut to a line), «Tabla» or «JSON»; with more than ten fields it has a search; a related row unfolds one level; empty, it says «Prueba los pasos anteriores» with its button, which tests them; «Combinar» has a tab per input", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [testOf(ALL_DONE)], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    // Empty: «Prueba los pasos anteriores», and its button tests them.
    await openStep(page, "s_01jsi");
    const empty = entrada(page).locator('[data-in="untested"]');
    await expect(empty).toContainText("Prueba los pasos anteriores");
    await empty.getByRole("button", { name: "Probar los anteriores" }).click();
    await expect(entrada(page).locator(".auto-in-from")).toHaveText(
      "De «Buscar filas en Libros» · 128 filas",
    );
    expect((await testsAsked(page)).at(-1)).toEqual({
      trigger: "s_inicio",
      fields: { minimo: 300 },
      step: "s_01jbuscar",
    });
    // «Esquema» first: each field with the first row's value, in one line; with thirteen, a search.
    await expect(showAs(entrada(page), "Esquema")).toHaveAttribute("aria-checked", "true");
    const fields = entrada(page).locator(".auto-schema-list:not(.nested) > .auto-schema-field");
    await expect(fields).toHaveCount(13);
    const title = fields.filter({ hasText: "Título" });
    await expect(title.locator(".auto-schema-value")).toHaveText("<b>Rayuela</b>");
    expect(
      await title.locator(".auto-schema-value").evaluate((el) => getComputedStyle(el).whiteSpace),
    ).toBe("nowrap");
    await expect(fields.filter({ hasText: "Páginas" }).locator(".auto-schema-value")).toHaveText(
      "201",
    );
    const find = entrada(page).getByRole("searchbox", { name: "Buscar un campo" });
    await find.pressSequentially("edit", { delay: 60 });
    await expect(fields).toHaveCount(1);
    await expect(fields.locator(".auto-schema-name")).toHaveText("editorial");
    await find.fill("zzz");
    await expect(entrada(page)).toContainText("Nada con «zzz»");
    await find.fill("");
    // A related row and a list unfold one level.
    const autor = fields.filter({ hasText: "autor" });
    await expect(autor.locator("summary .auto-schema-value")).toHaveText("2 campos");
    await autor.locator("summary").click();
    await expect(autor.locator(".nested .auto-schema-field")).toHaveText([
      "nombreAutora de ejemplo",
      "paisChile",
    ]);
    await expect(
      fields.filter({ hasText: "Relacionado" }).locator("summary .auto-schema-value"),
    ).toHaveText("2 elementos");
    // «Tabla» and «JSON».
    await showAs(entrada(page), "Tabla").click();
    await expect(entrada(page).locator(".auto-table tbody tr")).toHaveCount(50);
    await showAs(entrada(page), "JSON").click();
    const json = JSON.parse((await entrada(page).locator(".auto-rows-json").textContent()) ?? "[]");
    expect(json).toHaveLength(50);
    expect(json[0].titulo).toBe("<b>Rayuela</b>");
    // Any earlier step of the path.
    const source = entrada(page).getByRole("combobox", { name: "Ver los datos de" });
    expect(await optionsIn(source)).toEqual([
      "Lo que llega",
      "Buscar filas en Libros",
      "Disparado por el usuario",
    ]);
    await source.selectOption({ label: "Disparado por el usuario" });
    await expect(entrada(page).locator(".auto-in-from")).toHaveText(
      "De «Disparado por el usuario» · 1 fila",
    );
    // «Combinar»: a tab per input, with its count.
    await press(page, "Escape");
    await testGo(page).click();
    await testBar(page).getByRole("dialog").getByRole("button", { name: "Probar" }).click();
    await expect(stateOf(page, "s_01jcombinar")).toHaveText("Bien");
    await openStep(page, "s_01jcombinar");
    const tabs = entrada(page).getByRole("tablist", { name: "Entrada" }).getByRole("tab");
    await expect(tabs).toHaveText(["A (3)", "B (125)"]);
    await expect(entrada(page).locator(".auto-in-from")).toHaveText(
      "De «Modificar filas en Libros» · 3 filas",
    );
    await tabs.nth(1).click();
    await expect(entrada(page).locator(".auto-in-from")).toHaveText(
      "De «Eliminar filas en Libros» · 125 filas",
    );
  });
  test("AU-71 · «Tabla» and «JSON» show the first 50 rows of a test of 3,000 and «N filas más» brings 50 more: the rows never arrive all at once; a table of 40 fields scrolls sideways with its cells cut to a line; a value that looks like HTML or a link is painted as text (A-01)", async ({
    page,
  }) => {
    const big = { count: 3000, fields: 40 };
    const steps = {
      ...ALL_DONE,
      s_01jbuscar: { rows: { "in:main": [{ json: { minimo: 300 }, label: {} }], "out:main": big } },
      s_01jsi: { rows: { "in:main": big, "out:yes": books(3), "out:no": big } },
    };
    await openApp(page, "/?still", {
      automations: [testOf(steps, { kept: FIVE_MIN })],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name, 7);
    await openStep(page, "s_01jsi");
    await expect(entrada(page).locator(".auto-in-from")).toHaveText(
      "De «Buscar filas en Libros» · 3000 filas",
    );
    await showAs(entrada(page), "Tabla").click();
    const rows = entrada(page).locator(".auto-table tbody tr");
    await expect(rows).toHaveCount(50);
    const inAsked = async () => (await rowsAsked(page)).filter((r) => r.includes(" in:"));
    expect(await inAsked()).toEqual(["s_01jsi in:main 0"]);
    const more = entrada(page).getByRole("button", { name: "2950 filas más" });
    await more.click();
    await expect(rows).toHaveCount(100);
    await expect(entrada(page).getByRole("button", { name: "2900 filas más" })).toBeVisible();
    expect(await inAsked()).toEqual(["s_01jsi in:main 0", "s_01jsi in:main 50"]);
    await expect(rows.nth(99).locator("td").first()).toHaveText("valor 100-1");
    // Forty fields: the table scrolls sideways in its own box, each cell in one line; the view does not.
    const wrap = entrada(page).locator(".auto-table-wrap");
    expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth + 100)).toBe(true);
    await expect(entrada(page).locator(".auto-table thead th")).toHaveCount(40);
    const cell = rows.first().locator("td").nth(3);
    expect(
      await cell.evaluate((el) => [
        getComputedStyle(el).whiteSpace,
        getComputedStyle(el).textOverflow,
      ]),
    ).toEqual(["nowrap", "ellipsis"]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await view(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    // «JSON» shows the rows that came, never all of them.
    await showAs(entrada(page), "JSON").click();
    const json = JSON.parse((await entrada(page).locator(".auto-rows-json").textContent()) ?? "[]");
    expect(json).toHaveLength(100);
    // A value like HTML or a link is text: no element of its own, no link.
    const yes = salida(page)
      .getByRole("tablist", { name: "Salida" })
      .getByRole("tab", { name: "sí (3)" });
    await yes.click();
    await showAs(salida(page), "Tabla").click();
    const out = salida(page).locator(".auto-table");
    await expect(out.locator("td", { hasText: "<b>Rayuela</b>" })).toHaveCount(1);
    await expect(
      out.locator("td", { hasText: "https://ejemplo.example.com/libros/1" }),
    ).toHaveCount(3);
    await expect(out.locator("b, a")).toHaveCount(0);
    // Full of rows, at 1100 px and over, at 1000 and at 640, only the tables' own boxes scroll sideways.
    await showAs(entrada(page), "Tabla").click();
    const sideways = () =>
      page.evaluate(() =>
        [
          document.documentElement,
          ...document.querySelectorAll(".auto-view, .auto-view-col, .auto-rows, .auto-view-head"),
        ]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => (el as HTMLElement).className || el.tagName),
      );
    for (const width of [1280, 1100, 1000, 640]) {
      await page.setViewportSize({ width, height: 800 });
      if (width < 1100)
        for (const side of ["Entrada", "Salida"]) {
          await view(page)
            .locator(".auto-view-cols > .auto-view-col")
            .first()
            .getByRole("tab", { name: side, exact: true })
            .click();
          await expect.poll(sideways, { message: `${width} px, ${side}` }).toEqual([]);
        }
      else await expect.poll(sideways, { message: `${width} px` }).toEqual([]);
    }
  });
  test("AU-72 · SALIDA is seen as «Tabla» (first; «Esquema» with one row), «Esquema» or «JSON», with how many rows and a tab per output («sí (3)», «no (125)»); its foot says when it was tested and how long it took; untested it says «Sin probar» with «Probar paso», skipped «Saltado: no le llegaron filas», with no rows «0 filas»", async ({
    page,
  }) => {
    const none = testOf(
      NONE_PASS,
      { kept: FIVE_MIN },
      { id: "a_01jx8z2w4y6a8c0e2g4j6m8p0r", name: "Revisar largos" },
    );
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN }), none],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name, 7);
    // «Tabla» first, a tab per output with its count; how many rows; when and how long at the foot.
    await openStep(page, "s_01jsi");
    const tabs = salida(page).getByRole("tablist", { name: "Salida" }).getByRole("tab");
    await expect(tabs).toHaveText(["sí (3)", "no (125)"]);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(salida(page).locator(".auto-out-count")).toHaveText("3 filas");
    await expect(showAs(salida(page), "Tabla")).toHaveAttribute("aria-checked", "true");
    await expect(salida(page).locator(".auto-table tbody tr")).toHaveCount(3);
    await expect(salida(page).locator(".auto-out-foot")).toHaveText("probado hace 5 min · 0,0 s");
    await tabs.nth(1).click();
    await expect(salida(page).locator(".auto-out-count")).toHaveText("125 filas");
    await expect(salida(page).locator(".auto-table tbody tr")).toHaveCount(50);
    await expect(salida(page).getByRole("button", { name: "75 filas más" })).toBeVisible();
    await showAs(salida(page), "Esquema").click();
    await expect(
      salida(page).locator(".auto-schema-list:not(.nested) > .auto-schema-field"),
    ).toHaveCount(13);
    await showAs(salida(page), "JSON").click();
    await expect(salida(page).locator(".auto-rows-json")).toContainText('"titulo": "Libro 2"');
    // One row: «Esquema» first.
    await press(page, "Escape");
    await openStep(page, "s_01jbuscar");
    await press(page, "Escape");
    await openStep(page, "s_inicio");
    await expect(showAs(salida(page), "Esquema")).toHaveAttribute("aria-checked", "true");
    await expect(salida(page).locator(".auto-schema-field")).toHaveText(["Mínimo300"]);
    await expect(salida(page).locator(".auto-out-foot")).toHaveText("probado hace 5 min · 0,0 s");
    // Untested, skipped, no rows.
    await press(page, "Escape");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, "Revisar largos", 7);
    await openStep(page, "s_01jcombinar");
    const untested = salida(page).locator('[data-out="untested"]');
    await expect(untested).toContainText("Sin probar");
    await expect(untested.getByRole("button", { name: "Probar paso" })).toBeEnabled();
    await press(page, "Escape");
    await openStep(page, "s_01jmodificar");
    await expect(salida(page).locator('[data-out="skipped"]')).toHaveText(
      "Saltado: no le llegaron filas",
    );
    await press(page, "Escape");
    await openStep(page, "s_01jsi");
    await expect(salida(page).locator(".auto-out-count")).toHaveText("128 filas");
    await salida(page).getByRole("tab", { name: "sí (0)" }).click();
    await expect(salida(page).locator(".auto-out-count")).toHaveText("0 filas");
    await expect(salida(page).locator(".auto-rows")).toHaveCount(0);
  });
  test("AU-72 · a step that writes shows «Haría esto» in a test: a row per row written, each field that changes with its value before and after; creating, only after; deleting, the row as it was", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN })],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name, 7);
    // Changing: one row per row, the field that changes before and after, the rest as they are.
    await openStep(page, "s_01jmodificar");
    await expect(showAs(salida(page), "Haría esto")).toHaveAttribute("aria-checked", "true");
    const would = salida(page).locator(".auto-would tbody tr");
    await expect(would).toHaveCount(3);
    await expect(salida(page).locator(".auto-would thead th").first()).toHaveText("Haría esto");
    for (let i = 0; i < 3; i++) {
      const r = would.nth(i);
      await expect(r).toHaveAttribute("data-would", "update");
      await expect(r.locator("td").first()).toHaveText("Cambiaría");
      await expect(r.locator("td.changed")).toHaveCount(1);
      await expect(r.locator("td.changed del")).toHaveText("vacío");
      await expect(r.locator("td.changed ins")).toHaveText("Revisar");
    }
    await expect(would.first().locator("td.same").first()).toHaveText("Libro 126");
    // Deleting: to the trash, the row as it was.
    await press(page, "Escape");
    await openStep(page, "s_01jeliminar");
    await expect(showAs(salida(page), "Haría esto")).toHaveAttribute("aria-checked", "true");
    const gone = salida(page).locator(".auto-would tbody tr");
    await expect(gone).toHaveCount(50);
    await expect(gone.first()).toHaveAttribute("data-would", "trash");
    await expect(gone.first().locator("td").first()).toHaveText("A la papelera");
    await expect(gone.first().locator("td").nth(1)).toHaveText("<b>Rayuela</b>");
    await expect(salida(page).locator(".auto-would del, .auto-would ins")).toHaveCount(0);
    await expect(salida(page).getByRole("button", { name: "75 filas más" })).toBeVisible();
    // Creating: only the value after.
    await press(page, "Escape");
    await openStep(page, "s_01jcrear");
    const made = salida(page).locator(".auto-would tbody tr");
    await expect(made).toHaveCount(1);
    await expect(made).toHaveAttribute("data-would", "create");
    await expect(made.locator("td")).toHaveText([
      "Crearía",
      "Resumen de pendientes",
      "vacío",
      "vacío",
    ]);
    await expect(made.locator("del")).toHaveCount(0);
    // A step that only reads has no «Haría esto».
    await press(page, "Escape");
    await openStep(page, "s_01jbuscar");
    await expect(showAs(salida(page), "Haría esto")).toHaveCount(0);
  });
  test("AU-73 · «Probar paso» is at the top right; when it cannot be pressed it says why beside it: «Falta: Colección», by the names of the required parameters that are empty", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    await openStep(page, "s_01jnueva");
    const box = await view(page).boundingBox();
    const test = view(page).locator(".auto-view-head").getByRole("button", { name: "Probar paso" });
    const at = await test.boundingBox();
    expect((at?.x ?? 0) + (at?.width ?? 0)).toBeGreaterThan(
      (box?.x ?? 0) + (box?.width ?? 0) - 120,
    );
    expect((at?.y ?? 0) - (box?.y ?? 0)).toBeLessThan(40);
    await expect(test).toBeDisabled();
    const why = view(page).locator(".auto-view-why");
    await expect(why).toHaveText("Falta: Colección");
    expect((await why.boundingBox())?.x ?? 0).toBeLessThan(at?.x ?? 0);
    // With its collection, nothing is missing.
    await param(page, "collection").getByRole("combobox").selectOption({ label: "Libros" });
    await expect(why).toHaveCount(0);
  });
  test("AU-73 · while the step is tested, «Probando…» is said beside «Probar paso», in the step's bar, its menu and its view, and none can be pressed (AU-66, AU-91)", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE)],
      agent: BEFORE(),
      slow: { path: `api/agent/automations/${TESTED.id}/test`, ms: 900 },
    });
    await openCanvas(page, TESTED.name, 7);
    // From the step's bar.
    await card(page, "s_01jbuscar").click();
    const fromBar = bar(page).getByRole("button", { name: /Probar paso|Probando…/ });
    await expect(fromBar).toHaveText("Probar paso");
    await fromBar.click();
    await expect(fromBar).toHaveText("Probando…");
    await expect(fromBar).toBeDisabled();
    await expect(testGo(page)).toBeDisabled();
    await expect(fromBar).toHaveText("Probar paso");
    await expect(stateOf(page, "s_01jbuscar")).toHaveText("Bien");
    expect((await testsAsked(page)).at(-1)?.step).toBe("s_01jbuscar");
    // From the right click.
    await card(page, "s_01jsi").click({ button: "right" });
    await page.locator(".pop-box .menu-item", { hasText: "Probar paso" }).click();
    await expect.poll(async () => (await testsAsked(page)).at(-1)?.step).toBe("s_01jsi");
    await expect(stateOf(page, "s_01jsi")).toHaveText("Bien");
    // From the view: «Probando…» beside it, and it cannot be pressed.
    await openStep(page, "s_01jmodificar");
    const inView = view(page)
      .locator(".auto-view-head")
      .getByRole("button", { name: "Probar paso" });
    await inView.click();
    await expect(inView).toBeDisabled();
    await expect(view(page).locator(".auto-view-why")).toHaveText("Probando…");
    await expect(inView).toBeEnabled();
    await expect(view(page).locator(".auto-view-why")).toHaveCount(0);
    await expect(salida(page).locator(".auto-would tbody tr")).toHaveCount(3);
  });
  test("AU-74 · under 1100 px the step's view has two columns, «Entrada | Salida» as tabs on the left and «Parámetros | Ajustes» on the right, and nothing is cut or scrolls sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openApp(page, "/?still", { automations: [CONDITIONS, VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    await openStep(page, "s_01jbuscar");
    await expect(view(page)).toHaveClass(/\bnarrow\b/);
    const cols = view(page).locator(".auto-view-cols > .auto-view-col");
    await expect(cols).toHaveCount(2);
    await expect(cols.nth(0).getByRole("tab")).toHaveText(["Entrada", "Salida"]);
    await expect(cols.nth(1).getByRole("tab")).toHaveText(["Parámetros", "Ajustes"]);
    await expect(cols.nth(0)).toContainText("Prueba los pasos anteriores");
    await cols.nth(0).getByRole("tab", { name: "Salida" }).click();
    await expect(cols.nth(0)).toContainText("Sin probar");
    // Nothing cut and nothing sideways, on each tab, down to 640 px: under it the app is the phone's,
    // with no editor (the phone's view, only to look, is G's).
    const sideways = () =>
      page.evaluate(() => {
        const wide = [
          document.documentElement,
          ...document.querySelectorAll(".auto-view, .auto-view-col, .auto-param, .auto-view-head"),
        ].filter((el) => el.scrollWidth > el.clientWidth + 1);
        return wide.map((el) => (el as HTMLElement).className || el.tagName);
      });
    for (const width of [1000, 640]) {
      await page.setViewportSize({ width, height: 800 });
      for (const tab of ["Parámetros", "Ajustes"]) {
        await view(page)
          .getByRole("tab", { name: new RegExp(`^${tab}`) })
          .click();
        await expect.poll(sideways, { message: `${width} px, ${tab}` }).toEqual([]);
      }
    }
    // The widest rows: conditions with their three controls.
    await page.setViewportSize({ width: 1000, height: 800 });
    await press(page, "Escape");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, CONDITIONS.name, 6);
    await openStep(page, "s_01jfiltrar");
    await expect.poll(sideways).toEqual([]);
  });
  test.describe("on the phone", () => {
    test.use({ hasTouch: true, isMobile: true });
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
    });
    /** Fingers on the screen, as a person moves them: pressed, moved in small steps over about a third of a second. */
    async function fingers(
      page: Page,
      from: { x: number; y: number }[],
      to: { x: number; y: number }[],
    ) {
      const cdp = await page.context().newCDPSession(page);
      const at = (k: number) =>
        from.map((f, i) => ({
          x: f.x + (((to[i] ?? f).x - f.x) * k) / 20,
          y: f.y + (((to[i] ?? f).y - f.y) * k) / 20,
          id: i,
        }));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
      for (let k = 1; k <= 20; k++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(k) });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    }
    const moved = (page: Page) =>
      page
        .locator(".auto-flow .react-flow__viewport")
        .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform))
        .then((m) => ({ x: Math.round(m.e), y: Math.round(m.f), zoom: m.a }));
    const sideways = (page: Page) =>
      page.evaluate(() =>
        [document.documentElement, ...document.querySelectorAll(".auto-view, .auto-view-col")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => (el as HTMLElement).className || el.tagName),
      );
    async function openOnPhone(page: Page, name: string, steps: number) {
      await page
        .locator(".m-tabs")
        .getByRole("button", { name: /^Páginas/ })
        .tap();
      await page.locator(".m-item-main", { hasText: "Automatizaciones" }).tap();
      await page.getByText(name, { exact: true }).first().tap();
      await expect(head(page).locator(".auto-name")).toHaveText(name);
      await expect(cards(page)).toHaveCount(steps);
      await settled(page);
    }

    test("AU-74 · on the phone the list is the collection's page and an automation opens its canvas to look at it and to test it: it pans and zooms with the fingers, a tap on a step opens it in one column with three tabs, «Entrada | Parámetros | Salida», with nothing to change; there is no «+», no step bar, no dragging, no menu that changes something and no «Probar paso»; «Probar» is there, and an ENTRADA or a SALIDA with no data says «Sin probar» with no button", async ({
      page,
    }) => {
      await openApp(page, "/?still", { automations: [testOf(ALL_DONE)], agent: BEFORE() });
      await openOnPhone(page, TESTED.name, 7);
      // The header: back and the name, as text; no «Guardado» and no «⋯».
      await expect(nameBox(page)).toHaveCount(0);
      await expect(head(page).getByRole("status")).toHaveCount(0);
      await expect(head(page).getByRole("button", { name: "Más" })).toHaveCount(0);
      // The canvas: no «+», no «Ordenar»; «Probar» and «Registro» at the bottom.
      await expect(page.locator(".auto-add-top, .auto-out-add, .auto-panel")).toHaveCount(0);
      await expect(page.locator(".auto-zoom").getByRole("button")).toHaveCount(3);
      await expect(page.getByRole("button", { name: "Ordenar" })).toHaveCount(0);
      await expect(testGo(page)).toBeEnabled();
      await expect(logLine(page)).toHaveText("Sin probar");
      expect(await sideways(page)).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/phone-automation.png` });
      // One finger on the canvas moves it; two apart zoom it.
      const flow = await page.locator(".auto-flow").boundingBox();
      if (!flow) throw new Error("no canvas");
      const empty = { x: flow.x + 40, y: flow.y + 60 };
      const before = await moved(page);
      await fingers(page, [empty], [{ x: empty.x + 90, y: empty.y + 60 }]);
      await settled(page);
      const panned = await moved(page);
      expect(Math.abs(panned.x - before.x - 90)).toBeLessThan(12);
      expect(Math.abs(panned.y - before.y - 60)).toBeLessThan(12);
      const mid = { x: flow.x + flow.width / 2, y: flow.y + flow.height / 2 };
      await fingers(
        page,
        [
          { x: mid.x - 30, y: mid.y },
          { x: mid.x + 30, y: mid.y },
        ],
        [
          { x: mid.x - 90, y: mid.y },
          { x: mid.x + 90, y: mid.y },
        ],
      );
      await settled(page);
      expect((await moved(page)).zoom).toBeGreaterThan(panned.zoom * 1.5);
      await page.locator(".auto-zoom").getByRole("button", { name: "Encajar" }).tap();
      await settled(page);
      // A finger on a card moves the canvas, never the card; a long press opens no menu.
      const si = await middle(card(page, "s_01jsi"));
      const place = await at(page, "s_01jsi");
      await fingers(page, [si], [{ x: si.x + 60, y: si.y + 40 }]);
      await settled(page);
      expect(await at(page, "s_01jsi")).toEqual(place);
      await card(page, "s_01jsi").dispatchEvent("contextmenu");
      await page.locator(".react-flow__pane").dispatchEvent("contextmenu");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.locator(".auto-panel")).toHaveCount(0);
      // A tap on a step opens it: no step bar, one column, three tabs, «Parámetros» first.
      await page.locator(".auto-zoom").getByRole("button", { name: "Encajar" }).tap();
      await settled(page);
      await card(page, "s_01jsi").tap();
      await expect(view(page)).toHaveAttribute("data-step", "s_01jsi");
      await expect(bar(page)).toHaveCount(0);
      await expect(view(page)).toHaveClass(/\bphone\b/);
      const tabs = view(page).getByRole("tab");
      await expect(tabs).toHaveText(["Entrada", "Parámetros", "Salida"]);
      await expect(view(page).getByRole("tab", { name: "Parámetros" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(view(page).locator(".auto-view-cols > .auto-view-col")).toHaveCount(1);
      // Its name is text, the parameters are read and nothing in them can be changed; no «Probar paso».
      await expect(nameIn(page)).toHaveCount(0);
      await expect(view(page).locator(".auto-view-head h2")).toHaveText("Si");
      await expect(param(page, "where")).toBeVisible();
      const controls = view(page).locator(
        "[role=tabpanel] :is(input, select, textarea, button):not([role=tab])",
      );
      expect(await controls.count()).toBeGreaterThan(0);
      for (const c of await controls.all()) await expect(c).toBeDisabled();
      await expect(view(page).locator("[contenteditable=true]")).toHaveCount(0);
      await expect(view(page).getByRole("button", { name: "Probar paso" })).toHaveCount(0);
      expect(await sideways(page)).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/phone-automation-params.png` });
      // Not tested: ENTRADA and SALIDA say «Sin probar», and nothing else.
      for (const side of ["Entrada", "Salida"]) {
        await view(page).getByRole("tab", { name: side }).tap();
        const empty = view(page).locator(".auto-view-empty");
        await expect(empty).toHaveText("Sin probar");
        await expect(empty.getByRole("button")).toHaveCount(0);
        expect(await sideways(page)).toEqual([]);
      }
      await view(page).getByRole("button", { name: "Cerrar" }).tap();
      await expect(view(page)).toHaveCount(0);
      // «Probar»: the trigger's field asked with the last value, then the last test.
      await testGo(page).tap();
      const box = testBar(page).getByRole("dialog");
      await expect(box.getByRole("spinbutton", { name: "Mínimo" })).toHaveValue("300");
      await box.getByRole("button", { name: "Probar" }).tap();
      await expect(logLine(page)).toHaveText(
        "Última prueba hace un momento · bien · 7 pasos · 0,4 s · no escribió nada · habría escrito 129 filas",
      );
      // Tested: a step shows what it got and what it gave.
      await card(page, "s_01jsi").tap();
      await view(page).getByRole("tab", { name: "Entrada" }).tap();
      await expect(entrada(page).locator(".auto-in-from")).toHaveText(
        "De «Buscar filas en Libros» · 128 filas",
      );
      await view(page).getByRole("tab", { name: "Salida" }).tap();
      await expect(salida(page).locator(".auto-out-count")).toHaveText("3 filas");
      await expect(salida(page)).toContainText("Libro 126");
      expect(await sideways(page)).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/phone-automation-step.png` });
      // Nothing of it was changed: no draft and no boxes sent.
      expect((await asked(page)).filter((a) => a.startsWith("PUT"))).toEqual([]);
    });
  });
  test("AU-20 · a field dropped on a text goes in at the caret and one dropped on a number replaces it; after a test the expression says what it gives and with which row («= 5 · con la fila 1 de 128»); typing in it asks the server for nothing", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN })],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name, 7);
    // On a number, the field replaces the value: «Si» keeps the books of more than 300 pages.
    await openStep(page, "s_01jsi");
    const where = param(page, "where");
    await expect(where.locator(".auto-value input")).toHaveValue("300");
    await dragOnto(page, schemaField(page, "Páginas"), where.locator(".auto-value").first());
    const cond = where.getByRole("textbox", { name: "Páginas" });
    await expect.poll(() => exprOf(cond)).toBe("{{ $json.paginas }}");
    await expect(cond.locator(".auto-chip")).toHaveText("Páginas");
    await expect(where.locator(".auto-preview")).toHaveText("= 201 · con la fila 1 de 128");
    // A drop leaves the caret after the field, to go on typing; Esc leaves it, the next one closes the view.
    await expect(cond).toBeFocused();
    await press(page, "Escape");
    await expect(cond).not.toBeFocused();
    await press(page, "Escape");
    // On a text, it goes in at the caret: «Rev|isar».
    await openStep(page, "s_01jmodificar");
    const fields = param(page, "fields");
    const notas = fields.getByRole("textbox", { name: "Valor" });
    await notas.click();
    await notas.press("Home");
    for (let i = 0; i < 3; i++) await notas.press("ArrowRight");
    await dragOnto(page, schemaField(page, "Título"), notas);
    const editor = fields.getByRole("textbox", { name: "Valor" });
    await expect.poll(() => exprOf(editor)).toBe("Rev{{ $json.titulo }}isar");
    await expect(fields.locator(".auto-preview")).toHaveText(
      "= RevLibro 126isar · con la fila 1 de 3",
    );
    // Typed at a person's pace, the preview follows each key and the server is asked nothing.
    const asked = {
      samples: (await samplesAsked(page)).length,
      rows: (await rowsAsked(page)).length,
      tests: (await testsAsked(page)).length,
    };
    await editor.click();
    await editor.press("Control+End");
    await editor.pressSequentially(" ya", { delay: 120 });
    await expect(fields.locator(".auto-preview")).toHaveText(
      "= RevLibro 126isar ya · con la fila 1 de 3",
    );
    await expect.poll(() => exprOf(editor)).toBe("Rev{{ $json.titulo }}isar ya");
    expect({
      samples: (await samplesAsked(page)).length,
      rows: (await rowsAsked(page)).length,
      tests: (await testsAsked(page)).length,
    }).toEqual(asked);
    await expect(saved(page)).toHaveText("Guardado");
    const kept = (await lastDraft(page, TESTED.id))?.steps.find((x) => x.id === "s_01jmodificar");
    expect(kept?.params.fields).toEqual([
      { field: "notas", value: { expr: "Rev{{ $json.titulo }}isar ya" } },
    ]);
  });
  test("AU-20 · every control of a value ends with «{ }», always in sight: it turns a fixed value into an expression keeping what was written, and back leaves the control empty; Ctrl+Z undoes either", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [CONDITIONS], agent: BEFORE() });
    await openCanvas(page, CONDITIONS.name, 6);
    await openStep(page, "s_01jbuscar");
    // Each value of the view has its «{ }», in sight: «Límite» and the condition's value.
    const values = view(page).locator(".auto-value");
    await expect(values).toHaveCount(2);
    for (const v of await values.all()) await expect(v.locator(".auto-expr-toggle")).toBeVisible();
    const limit = param(page, "limit");
    await expect(limit.getByRole("spinbutton", { name: "Límite" })).toHaveValue("50");
    // Fixed to an expression, keeping what was written.
    await limit.getByRole("button", { name: "Usar una expresión" }).click();
    const editor = limit.getByRole("textbox", { name: "Límite" });
    await expect.poll(() => exprOf(editor)).toBe("50");
    await expect(limit.getByRole("button", { name: "Usar un valor fijo" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // And back: the control empty.
    await limit.getByRole("button", { name: "Usar un valor fijo" }).click();
    await expect(limit.getByRole("spinbutton", { name: "Límite" })).toHaveValue("");
    // Ctrl+Z undoes either.
    await press(page, "Control+z");
    await expect.poll(() => exprOf(limit.getByRole("textbox", { name: "Límite" }))).toBe("50");
    await press(page, "Control+z");
    await expect(limit.getByRole("spinbutton", { name: "Límite" })).toHaveValue("50");
  });
  test("AU-20 · «{ }» closes every value's row in one column: the same right edge, size and look on a text, a number, a date, a select, a checkbox and an expression, of a condition and of «Campo · Valor», also after a value goes to an expression and back; Tab goes from each control to its «{ }»", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [KINDS], agent: BEFORE() });
    await openCanvas(page, KINDS.name, 2);
    await openStep(page, "s_01jmarcar");
    const values = view(page).locator(".auto-value");
    // The condition's value and the six of «Campo · Valor».
    await expect(values).toHaveCount(7);
    await expect(view(page).locator(".auto-expr")).toHaveCount(1);
    for (const kind of ["text", "number", "date", "checkbox"])
      await expect(view(page).locator(`.auto-value-fixed input[type="${kind}"]`)).toHaveCount(1);
    await expect(view(page).locator(".auto-value-fixed select")).toHaveCount(2);
    /** Each «{ }»'s right edge, width, height and look, as the screen draws it. */
    const toggles = () =>
      view(page)
        .locator(".auto-expr-toggle")
        .evaluateAll((all) =>
          all.map((b) => {
            const r = b.getBoundingClientRect();
            const c = getComputedStyle(b);
            return {
              right: Math.round(r.right),
              width: Math.round(r.width),
              height: Math.round(r.height),
              look: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderRadius} ${c.fontSize}`,
              on: b.classList.contains("on"),
            };
          }),
        );
    const oneColumn = async () => {
      const all = await toggles();
      expect(all).toHaveLength(7);
      for (const t of all) {
        expect(t.right).toBe(all[0]?.right);
        expect(t.width).toBe(all[0]?.width);
        expect(t.height).toBe(all[0]?.height);
        expect(t.look).toBe(all[0]?.look);
      }
      // Pressed or not, it is the same button: only its colour says «Expresión».
      expect(all.filter((t) => t.on)).toHaveLength(await view(page).locator(".auto-expr").count());
    };
    await oneColumn();
    // A text and a number to an expression, and back: still one column.
    const fields = param(page, "fields");
    for (const name of ["Título", "Páginas"]) {
      const row = fields
        .locator(".auto-value")
        .filter({ has: page.getByLabel(name, { exact: true }) });
      await row.getByRole("button", { name: "Usar una expresión" }).click();
      await expect(row.locator(".auto-expr")).toHaveCount(1);
    }
    await oneColumn();
    for (const name of ["Título", "Páginas"]) {
      const row = fields
        .locator(".auto-value")
        .filter({ has: page.getByLabel(name, { exact: true }) });
      await row.getByRole("button", { name: "Usar un valor fijo" }).click();
      await expect(row.locator(".auto-expr")).toHaveCount(0);
    }
    await oneColumn();
    // Tab: from each control (a date's last part, too) to its own «{ }».
    for (const v of await values.all()) {
      const control = v.locator("input, select, [contenteditable]").first();
      await control.focus();
      for (let i = 0; i < 4; i++) {
        if (!(await control.evaluate((c) => c === document.activeElement))) break;
        await press(page, "Tab");
      }
      await expect(v.locator(".auto-expr-toggle")).toBeFocused();
    }
  });
  test("AU-21 · dragging a field from ENTRADA into a parameter writes its citation, painted as a chip with its step's icon and the field's name: of the step before, of an earlier step chosen in ENTRADA's header, and of a result («Suma de Importe», never its key); with two steps of the path that have a field of the same name the chip says the step too («Buscar gastos › Importe»); a citation of a step that is gone is a red chip", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [citedTested()], agent: BEFORE() });
    await openCanvas(page, CITED.name, 4);
    await openStep(page, "s_01jcrear");
    const fields = param(page, "fields");
    // Of a result: «Suma de Páginas», never its key; and a choice by its option's name.
    await expect(schemaField(page, "Suma de Páginas")).toBeVisible();
    await expect(entrada(page)).not.toContainText("sum_paginas");
    await expect(schemaField(page, "Estado").locator(".auto-schema-value")).toHaveText("Pendiente");
    const titulo = fields.getByRole("textbox", { name: "Título" });
    await titulo.click();
    await titulo.press("End");
    await titulo.pressSequentially(" ", { delay: 60 });
    await dragOnto(page, schemaField(page, "Suma de Páginas"), titulo);
    const editor = fields.getByRole("textbox", { name: "Título" });
    await expect.poll(() => exprOf(editor)).toBe("Resumen {{ $json.sum_paginas }}");
    const chip = editor.locator(".auto-chip");
    await expect(chip).toHaveText("Suma de Páginas");
    // The step's icon beside the field's name.
    await expect(chip.locator("svg")).toHaveCount(1);
    // Of an earlier step chosen in ENTRADA's header: after «Agrupar» it is that step's first row.
    await entrada(page)
      .getByRole("combobox", { name: "Ver los datos de" })
      .selectOption({ label: "Buscar filas en Libros" });
    // A long expression wraps: Ctrl+End is its end, past the chip.
    await editor.click();
    await editor.press("Control+End");
    await editor.pressSequentially(" ", { delay: 60 });
    await dragOnto(page, schemaField(page, "Título"), editor);
    await expect
      .poll(() => exprOf(editor))
      .toBe("Resumen {{ $json.sum_paginas }} {{ $('Buscar filas en Libros').first().titulo }}");
    // Two steps of the path have a «Título»: the chip says the step too.
    await expect(editor.locator(".auto-chip")).toHaveText([
      "Suma de Páginas",
      "Buscar filas en Libros › Título",
    ]);
    // What it gives, as text: a title that looks like HTML is read letter by letter (A-01).
    const preview = fields.locator(".auto-preview").first();
    await expect(preview).toHaveText("= Resumen 33856 <b>Rayuela</b> · con la fila 1 de 1");
    await expect(preview.locator("b")).toHaveCount(0);
    // A citation of a step that is gone is a red chip, with why.
    const gone = fields.getByRole("textbox", { name: "Estado" }).locator(".auto-chip");
    await expect(gone).toHaveClass(/broken/);
    // With what it cited: the step that is gone and its field.
    await expect(gone).toHaveText("Paso borrado › estado");
    await expect(gone).toHaveAttribute("title", "Ningún paso se llama «Paso borrado»");
    expect(await gone.evaluate((el) => getComputedStyle(el).color)).not.toBe(
      await chip.first().evaluate((el) => getComputedStyle(el).color),
    );
  });
  test("AU-71 · a field of ENTRADA's «Esquema», of the step before or of an earlier one chosen in its header, is dragged into a parameter (F: AU-21)", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN })],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name, 7);
    await openStep(page, "s_01jmodificar");
    const fields = param(page, "fields");
    // Of the step before («Si»): the row that comes in.
    await expect(entrada(page).locator(".auto-in-from")).toHaveText("De «Si» · 3 filas");
    await dragOnto(
      page,
      schemaField(page, "Páginas"),
      fields.getByRole("textbox", { name: "Valor" }),
    );
    const editor = fields.getByRole("textbox", { name: "Valor" });
    await expect.poll(() => exprOf(editor)).toBe("Revisar{{ $json.paginas }}");
    // Of an earlier one chosen in the header, a field inside a related row: «Si» keeps the rows, so it is their pair.
    await entrada(page)
      .getByRole("combobox", { name: "Ver los datos de" })
      .selectOption({ label: "Buscar filas en Libros" });
    const autor = schemaField(page, "autor");
    await autor.locator("summary").click();
    await dragOnto(page, autor.locator(".nested .auto-schema-field").first(), editor);
    await expect
      .poll(() => exprOf(editor))
      .toBe("Revisar{{ $json.paginas }}{{ $('Buscar filas en Libros').item.autor.nombre }}");
    await expect(editor.locator(".auto-chip")).toHaveText(["Páginas", "autor › nombre"]);
    await expect(saved(page)).toHaveText("Guardado");
    const kept = (await lastDraft(page, TESTED.id))?.steps.find((x) => x.id === "s_01jmodificar");
    expect(kept?.params.fields).toEqual([
      {
        field: "notas",
        value: {
          expr: "Revisar{{ $json.paginas }}{{ $('Buscar filas en Libros').item.autor.nombre }}",
        },
      },
    ]);
  });
  test("A-15 · with 200 steps, a step's view opens at once and each key typed in it is drawn at once", async ({
    page,
  }, info) => {
    const many = Array.from({ length: 200 }, (_, i) =>
      i === 0
        ? step("s_inicio", "Disparado por el usuario", "manual")
        : step(`s_01jpaso${String(i).padStart(4, "0")}`, `Limitar ${i + 1}`, "limit", { count: 5 }),
    );
    const long = {
      id: "a_01jx8x0t2v4x6z8b0d2f4h6k8n",
      name: "Doscientos límites",
      updated: 1761995000000,
      steps: many,
      arrows: many.slice(1).map((s, i) => arrow(many[i]?.id as string, s.id)),
      places: many.map((s, i) => ({ step: s.id, x: (i % 20) * 300, y: Math.floor(i / 20) * 200 })),
    };
    await openApp(page, "/?still", { automations: [long], agent: BEFORE() });
    const rows = await list(page);
    await rows.getByText("Doscientos límites", { exact: true }).click();
    await expect(cards(page)).toHaveCount(200);
    // Intro to the view drawn, measured in the page.
    await card(page, "s_01jpaso0001").click();
    await page.evaluate(() => {
      const w = window as unknown as { __open: { key: number; shown: number } };
      w.__open = { key: 0, shown: 0 };
      document.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Enter") w.__open.key = performance.now();
        },
        { capture: true, once: true },
      );
      const seen = new MutationObserver(() => {
        if (!document.querySelector(".auto-view")) return;
        seen.disconnect();
        requestAnimationFrame(() => {
          w.__open.shown = performance.now();
        });
      });
      seen.observe(document.body, { childList: true, subtree: true });
    });
    await press(page, "Enter");
    await expect(view(page)).toHaveAttribute("data-step", "s_01jpaso0001");
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __open: { shown: number } }).__open.shown),
      )
      .toBeGreaterThan(0);
    const opening = await page.evaluate(() => {
      const o = (window as unknown as { __open: { key: number; shown: number } }).__open;
      return o.shown - o.key;
    });
    // Each key typed at a person's pace, from the key to its frame; and the frames meanwhile.
    const count = param(page, "count").getByRole("spinbutton");
    await count.click();
    await press(page, "Control+a");
    await page.evaluate(() => {
      const w = window as unknown as { __keys: number[]; __frames: number[]; __run: boolean };
      w.__keys = [];
      w.__frames = [];
      w.__run = true;
      document.addEventListener(
        "input",
        () => {
          const t0 = performance.now();
          requestAnimationFrame(() => w.__keys.push(performance.now() - t0));
        },
        { capture: true },
      );
      const tick = (t: number) => {
        w.__frames.push(t);
        if (w.__run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await count.pressSequentially("1234567", { delay: 120 });
    await expect(card(page, "s_01jpaso0001").locator(".auto-card-summary")).toHaveText(
      "Cuántas 1234567",
    );
    const { keys, frames } = await page.evaluate(() => {
      const w = window as unknown as { __keys: number[]; __frames: number[]; __run: boolean };
      w.__run = false;
      return {
        keys: w.__keys,
        frames: w.__frames.slice(1).map((t, i) => t - (w.__frames[i] as number)),
      };
    });
    const worstKey = Math.max(...keys);
    const worstFrame = Math.max(...frames);
    const mean = frames.reduce((a, z) => a + z, 0) / frames.length;
    info.annotations.push({
      type: "A-15",
      description: `200 steps: the view opened in ${opening.toFixed(0)} ms; ${keys.length} keys typed, the worst drawn in ${worstKey.toFixed(1)} ms; frames meanwhile mean ${mean.toFixed(1)} ms, worst ${worstFrame.toFixed(1)} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    // Measured here (2026-11-16, headless Chrome with no GPU): opened in 68 to 112 ms, the worst key 57 to 66 ms,
    // frames 29 to 31 ms; a key redraws its own card only (it redrew all 200 on the first key until a name that
    // follows nothing stopped being renamed). The margins are for CI.
    expect(keys).toHaveLength(7);
    expect(opening).toBeLessThan(400);
    expect(worstKey).toBeLessThan(120);
    expect(mean).toBeLessThan(45);
  });

  test("AU-21, A-15 · with 200 steps whose counts cite a field, each card says it by the field's name, as the view's header does; the canvas opens and each key typed in a step is drawn at once", async ({
    page,
  }, info) => {
    const many = Array.from({ length: 200 }, (_, i) =>
      i === 0
        ? step("s_inicio", "Disparado por el usuario", "manual")
        : i === 1
          ? step("s_01jbuscar", "Buscar filas en Libros", "collection", {
              action: "find",
              collection: "libros",
            })
          : step(`s_01jpaso${String(i).padStart(4, "0")}`, `Limitar ${i + 1}`, "limit", {
              count: i === 2 ? 5 : { expr: "{{ $json.paginas }}" },
            }),
    );
    const long = {
      id: "a_01jx8x0t2v4x6z8b0d2f4h6k8p",
      name: "Doscientas citas",
      updated: 1761995000000,
      steps: many,
      arrows: many.slice(1).map((s, i) => arrow(many[i]?.id as string, s.id)),
      places: many.map((s, i) => ({ step: s.id, x: (i % 20) * 300, y: Math.floor(i / 20) * 200 })),
    };
    await openApp(page, "/?still", { automations: [long], agent: BEFORE() });
    const rows = await list(page);
    // From the click on its row to the frame with its 200 cards, measured in the page.
    await page.evaluate(() => {
      const w = window as unknown as { __open: { click: number; shown: number } };
      w.__open = { click: 0, shown: 0 };
      document.addEventListener(
        "click",
        () => {
          w.__open.click = performance.now();
        },
        { capture: true, once: true },
      );
      const seen = new MutationObserver(() => {
        if (document.querySelectorAll(".auto-card").length < 200) return;
        seen.disconnect();
        requestAnimationFrame(() => {
          w.__open.shown = performance.now();
        });
      });
      seen.observe(document.body, { childList: true, subtree: true });
    });
    await rows.getByText("Doscientas citas", { exact: true }).click();
    await expect(cards(page)).toHaveCount(200);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __open: { shown: number } }).__open.shown),
      )
      .toBeGreaterThan(0);
    const opening = await page.evaluate(() => {
      const o = (window as unknown as { __open: { click: number; shown: number } }).__open;
      return o.shown - o.click;
    });
    // Each card citing «paginas» of «Libros» says «Páginas», the name the collection gives it; the view's header too.
    const summary = (id: string) => card(page, id).locator(".auto-card-summary");
    await expect(summary("s_01jpaso0003")).toHaveText("Páginas");
    await expect(summary("s_01jpaso0199")).toHaveText("Páginas");
    await expect(summary("s_01jpaso0002")).toHaveText("Cuántas 5");
    await card(page, "s_01jpaso0199").dblclick();
    await expect(view(page).locator(".auto-view-summary")).toHaveText("Páginas");
    await view(page).getByRole("button", { name: "Cerrar" }).click();
    // Each key typed at a person's pace in the one count that is a number, from the key to its frame.
    await card(page, "s_01jpaso0002").dblclick();
    const count = param(page, "count").getByRole("spinbutton");
    await count.click();
    await press(page, "Control+a");
    await page.evaluate(() => {
      const w = window as unknown as { __keys: number[] };
      w.__keys = [];
      document.addEventListener(
        "input",
        () => {
          const t0 = performance.now();
          requestAnimationFrame(() => w.__keys.push(performance.now() - t0));
        },
        { capture: true },
      );
    });
    await count.pressSequentially("1234567", { delay: 120 });
    await expect(summary("s_01jpaso0002")).toHaveText("Cuántas 1234567");
    await expect(summary("s_01jpaso0199")).toHaveText("Páginas");
    const keys = await page.evaluate(() => (window as unknown as { __keys: number[] }).__keys);
    const worstKey = Math.max(...keys);
    info.annotations.push({
      type: "A-15",
      description: `200 cards citing a field: the canvas opened in ${opening.toFixed(0)} ms; ${keys.length} keys typed, the worst drawn in ${worstKey.toFixed(1)} ms`,
    });
    console.log(info.annotations.at(-1)?.description);
    expect(keys).toHaveLength(7);
    // Measured here (2026-11-16, headless Chrome with no GPU, load 4 to 6 on 8 cores): opened in 347 to 360 ms, and
    // 330 to 333 ms with the cards saying the key instead (naming 198 citations costs about 20 ms); the worst key 17 to
    // 19 ms. The margins are for CI, as the view's test above.
    under(opening, 1100, "clock", "opening 200 cards that cite a field");
    under(worstKey, 120, "clock", "the worst key typed with 200 cards that cite a field");
  });
});

test.describe("against a sea of options", () => {
  test("AU-75 · every step type of the catalogue, with each of its actions, paints seven rows at most in «Parámetros» before «Añadir opción»: the rows are counted on the screen, type by type and action by action; a list is one row, and what is inside one of its entries is seen only once it is opened", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [SEA, VIEWED], agent: BEFORE() });
    await openCanvas(page, SEA.name, SEA.steps.length);
    const counted: string[] = [];
    for (const s of SEA.steps) {
      await openStep(page, s.id);
      const shown = paramsOf(s as never).filter((p) => p.place === "shown").length;
      await expect(paramRows(page)).toHaveCount(shown);
      const rows = await paramRows(page).count();
      expect(rows, `${s.type} ${JSON.stringify(s.params)}`).toBeLessThanOrEqual(7);
      // «Añadir opción», when there is one, comes after them.
      const add = view(page).getByRole("button", { name: "Añadir opción" });
      if (await add.count())
        expect((await add.boundingBox())?.y ?? 0).toBeGreaterThan(
          (await paramRows(page).last().boundingBox())?.y ?? 0,
        );
      counted.push(`${s.type}${s.params.action ? `.${s.params.action}` : ""}: ${rows}`);
      await press(page, "Escape");
      await expect(view(page)).toHaveCount(0);
    }
    expect(new Set(SEA.steps.map((s) => s.type)).size).toBe(CATALOGUE.length);
    console.log(`AU-75 · rows in «Parámetros»: ${counted.join(", ")}`);
    // A list is one row; what is in its entry is seen once it is opened.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, VIEWED.name, 5);
    await openStep(page, "s_01jbuscar");
    const sort = param(page, "sort");
    await expect(sort.locator(".auto-entry")).toHaveCount(1);
    await expect(sort.locator(".auto-entry-body")).toHaveCount(0);
    await sort.locator(".auto-entry-line").click();
    await expect(sort.locator(".auto-entry-body .auto-entry-field")).toHaveCount(2);
    await sort.locator(".auto-entry-line").click();
    await expect(sort.locator(".auto-entry-body")).toHaveCount(0);
  });
  test("AU-76 · «Añadir opción» lists the options of the action that are not there yet; an added one is a row that can be taken away, and is then its default again; with none left the button is not there", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    await openStep(page, "s_01jbuscar");
    const add = view(page).getByRole("button", { name: "Añadir opción" });
    await expect(param(page, "related")).toHaveCount(0);
    await add.click();
    await expect(page.locator(".pop-box .menu-item")).toHaveText(["Incluir relacionadas"]);
    await page.getByRole("menuitemradio", { name: "Incluir relacionadas" }).click();
    // A row of its own, on: with none left, no button.
    await expect(param(page, "related").getByRole("checkbox")).toBeChecked();
    await expect(add).toHaveCount(0);
    await expect(card(page, "s_01jbuscar").locator(".auto-card-labels")).toContainText(
      "Incluir relacionadas",
    );
    await expect(saved(page)).toHaveText("Guardado");
    const on = (await lastDraft(page, VIEWED.id))?.steps.find((s) => s.id === "s_01jbuscar");
    expect(on?.params.related).toBe(true);
    // Taken away: its default again, and the button back.
    await view(page).getByRole("button", { name: "Quitar: Incluir relacionadas" }).click();
    await expect(param(page, "related")).toHaveCount(0);
    await expect(add).toBeVisible();
    await expect(card(page, "s_01jbuscar").locator(".auto-card-labels")).toHaveCount(0);
    await expect(saved(page)).toHaveText("Guardado");
    const off = (await lastDraft(page, VIEWED.id))?.steps.find((s) => s.id === "s_01jbuscar");
    expect(off?.params).not.toHaveProperty("related");
    // A step with no options has no button.
    await press(page, "Escape");
    await openStep(page, "s_01jfiltrar");
    await expect(view(page).getByRole("button", { name: "Añadir opción" })).toHaveCount(0);
  });
  test("AU-78 · «Ajustes» has the same six rows in every step type: Si falla, Reintentos, Seguir sin filas, Solo la primera fila, Nota and Apagado", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [SEA], agent: BEFORE() });
    await openCanvas(page, SEA.name, SEA.steps.length);
    const seen = new Set<string>();
    for (const s of SEA.steps) {
      if (seen.has(s.type)) continue;
      seen.add(s.type);
      await openStep(page, s.id);
      await view(page)
        .getByRole("tab", { name: /^Ajustes/ })
        .click();
      await expect(view(page).locator(".auto-param[data-setting] .auto-param-name")).toHaveText([
        "Si falla",
        "Reintentos",
        "Seguir sin filas",
        "Solo la primera fila",
        "Nota",
        "Apagado",
      ]);
      await press(page, "Escape");
      await expect(view(page)).toHaveCount(0);
    }
    expect(seen.size).toBe(CATALOGUE.length);
  });
  test("AU-79 · every setting or option not at its default is a short label on the step's card («Si falla: seguir», «Reintenta 2 veces», «Sigue sin filas», «Solo la primera fila», «Nota», «Apagado», an option by its name), in a line under the summary, with the ones that do not fit joined in «+2», which says them on hover; the tab «Ajustes» counts what changed; the three that change the rows are said above SALIDA too; an off step's card is dimmed", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    const limitar = card(page, "s_01jlimitar");
    const labels = limitar.locator(".auto-card-labels");
    // What fits, then «+5», which says the rest on hover.
    await expect(labels.locator(".auto-label")).toHaveText(["Si falla: seguir", "+5"]);
    await expect(labels.locator(".auto-label.more")).toHaveAttribute(
      "title",
      "Reintenta 2 veces · Sigue sin filas · Solo la primera fila · Nota · Apagado",
    );
    // One line, under the summary.
    const line = await labels.boundingBox();
    const summary = await limitar.locator(".auto-card-summary").boundingBox();
    expect(line?.y ?? 0).toBeGreaterThanOrEqual((summary?.y ?? 0) + (summary?.height ?? 0) - 1);
    expect(await labels.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
    // Off: dimmed.
    await expect(limitar).toHaveClass(/\boff\b/);
    expect(Number(await limitar.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
    // In the view: «Ajustes (6)», and the three that change the rows above SALIDA.
    await openStep(page, "s_01jlimitar");
    const tab = view(page).getByRole("tab", { name: /^Ajustes/ });
    await expect(tab).toHaveText("Ajustes (6)");
    const out = view(page).getByRole("region", { name: "Salida" }).locator(".auto-label");
    await expect(out).toHaveText(["Sigue sin filas", "Solo la primera fila", "Apagado"]);
    // A change is on the card at once.
    await tab.click();
    await view(page).getByRole("checkbox", { name: "Seguir sin filas" }).uncheck();
    await expect(tab).toHaveText("Ajustes (5)");
    await expect(labels.locator(".auto-label.more")).toHaveText("+4");
    await expect(out).toHaveText(["Solo la primera fila", "Apagado"]);
    await view(page).getByRole("combobox", { name: "Si falla" }).selectOption({ label: "Parar" });
    await expect(labels.locator(".auto-label").first()).toHaveText("Reintenta 2 veces");
    await expect(tab).toHaveText("Ajustes (4)");
    // A step at its defaults has no labels.
    await expect(card(page, "s_01jfiltrar").locator(".auto-card-labels")).toHaveCount(0);
  });
  test("AU-81 · the conditions of «Filtrar», «Si», «Buscar filas», «Modificar filas» and «Eliminar filas» are the same control, the views' filter: «todas» by default, groups «y» or «o» of one level, operators by the field's type, and the value fixed or an expression", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [CONDITIONS], agent: BEFORE() });
    await openCanvas(page, CONDITIONS.name, 6);
    const where = () => param(page, "where");
    const ops = (row = 0) =>
      optionsIn(
        where().locator(".db-filter-row").nth(row).getByRole("combobox", { name: "Condición" }),
      );
    // The same control in the five.
    for (const id of [
      "s_01jbuscar",
      "s_01jfiltrar",
      "s_01jsi",
      "s_01jmodificar",
      "s_01jeliminar",
    ]) {
      await openStep(page, id);
      await expect(where().locator(".auto-conditions")).toHaveCount(1);
      await expect(where().getByRole("button", { name: "Añadir filtro" })).toBeVisible();
      await expect(where().getByRole("button", { name: "Filtro avanzado" })).toBeVisible();
      await press(page, "Escape");
      await expect(view(page)).toHaveCount(0);
    }
    // Operators by the field's type: a choice, a number with an expression for its value.
    await openStep(page, "s_01jbuscar");
    expect(await ops()).toEqual(["es", "no es", "está vacío", "no está vacío"]);
    await press(page, "Escape");
    await openStep(page, "s_01jfiltrar");
    expect(await ops()).toEqual(["es", "mayor que", "menor que", "está vacío", "no está vacío"]);
    // The value an expression, painted with its chip (F: AU-21).
    const expr = where().locator(".auto-expr");
    await expect.poll(() => exprOf(expr)).toBe("{{ $json.minimo }}");
    await expect(expr.locator(".auto-chip")).toHaveCount(1);
    // A run of keys in a condition's value is one step of Deshacer, and Ctrl+Y brings it back (AU-68).
    await expr.fill("");
    await expr.pressSequentially("{{ $json.maximo }}", { delay: 40 });
    await press(page, "Control+z");
    await expect.poll(() => exprOf(expr)).toBe("{{ $json.minimo }}");
    await press(page, "Control+y");
    await expect.poll(() => exprOf(expr)).toBe("{{ $json.maximo }}");
    await press(page, "Escape");
    await expect(expr).not.toBeFocused();
    await press(page, "Escape");
    // «Si» with none: «todas»; the fields are those of the rows that reach it.
    await openStep(page, "s_01jsi");
    await expect(where()).toContainText("Sin filtros: se ven todos.");
    await where().getByRole("button", { name: "Añadir filtro" }).click();
    const field = where()
      .locator(".db-filter-row")
      .first()
      .getByRole("combobox", { name: "Propiedad" });
    expect(await optionsIn(field)).toEqual(
      expect.arrayContaining(["Título", "Estado", "Páginas", "Terminado", "Favorito"]),
    );
    await field.selectOption({ label: "Favorito" });
    expect(await ops()).toEqual(["marcado", "sin marcar"]);
    await field.selectOption({ label: "Terminado" });
    expect(await ops()).toEqual(["es", "antes de", "después de", "está vacío", "no está vacío"]);
    // A group «y» or «o», of one level.
    await where().getByRole("button", { name: "Filtro avanzado" }).click();
    await expect(saved(page)).toHaveText("Guardado");
    const si = (await lastDraft(page, CONDITIONS.id))?.steps.find((s) => s.id === "s_01jsi");
    const items = si?.params.where as { join?: string; rules?: unknown[] }[];
    expect(items).toHaveLength(2);
    expect(["and", "or"]).toContain(items[1]?.join);
    expect(Array.isArray(items[1]?.rules)).toBe(true);
  });
  test("AU-82 · changing a step's action keeps what the two share and a notice says what went, «Se quitó: Ordenar por, Límite · Deshacer»; its «Deshacer» brings it all back", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    await openStep(page, "s_01jbuscar");
    await param(page, "action").getByRole("combobox").selectOption({ label: "Contar o sumar" });
    const notice = view(page).locator(".auto-view-notice");
    await expect(notice).toContainText("Se quitó: Ordenar por, Límite");
    await expect(param(page, "sort")).toHaveCount(0);
    await expect(param(page, "limit")).toHaveCount(0);
    // What the two share stays: the collection and the conditions.
    await expect(param(page, "collection").getByRole("combobox")).toHaveValue("libros");
    await expect(param(page, "where").locator(".db-filter-row")).toHaveCount(1);
    await expect(saved(page)).toHaveText("Guardado");
    const changed = (await lastDraft(page, VIEWED.id))?.steps.find((s) => s.id === "s_01jbuscar");
    expect(changed?.params.action).toBe("aggregate");
    expect(changed?.params).not.toHaveProperty("sort");
    // «Deshacer» brings it all back.
    await notice.getByRole("button", { name: "Deshacer" }).click();
    await expect(notice).toHaveCount(0);
    await expect(param(page, "action").getByRole("combobox")).toHaveValue("find");
    await expect(param(page, "sort")).toHaveCount(1);
    await expect(param(page, "limit").getByRole("spinbutton")).toHaveValue("10");
    await expect(saved(page)).toHaveText("Guardado");
    const back = (await lastDraft(page, VIEWED.id))?.steps.find((s) => s.id === "s_01jbuscar");
    expect(back?.params).toEqual(VIEWED.steps[1]?.params);
  });
  test("AU-83 · a required parameter left empty is not marked on opening the step; it is once Juan leaves it, with the mark on the step's card too", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [VIEWED], agent: BEFORE() });
    await openCanvas(page, VIEWED.name, 5);
    await openStep(page, "s_01jnueva");
    const row = param(page, "collection");
    await expect(row).not.toHaveClass(/\bmarked\b/);
    await expect(card(page, "s_01jnueva").locator(".auto-card-mark")).toHaveCount(0);
    // Left empty: marked, in the view and on the card.
    await row.getByRole("combobox").focus();
    await press(page, "Tab");
    await expect(row).toHaveClass(/\bmarked\b/);
    await expect(card(page, "s_01jnueva").locator(".auto-card-mark")).toHaveAttribute(
      "title",
      "Falta: Colección",
    );
    // Given a value, the mark goes.
    await row.getByRole("combobox").selectOption({ label: "Libros" });
    await expect(row).not.toHaveClass(/\bmarked\b/);
    await expect(card(page, "s_01jnueva").locator(".auto-card-mark")).toHaveCount(0);
  });
  test("AU-83 · after «Probar» or «Probar paso» every required parameter left empty is marked, on its card too (E: «Probar», AU-90, AU-91)", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [CHAIN, VIEWED], agent: BEFORE() });
    // «Probar»: «Filtrar» and «Ordenar» lack what they need, and are marked before they are opened.
    await openCanvas(page, CHAIN.name, 4);
    await expect(page.locator(".auto-card-mark")).toHaveCount(0);
    await testGo(page).click();
    await expect(card(page, "s_01jfiltrar").locator(".auto-card-mark")).toHaveAttribute(
      "title",
      /Falta: /,
    );
    await expect(card(page, "s_01jordenar").locator(".auto-card-mark")).toHaveCount(1);
    await expect(card(page, "s_01jbuscar").locator(".auto-card-mark")).toHaveCount(0);
    await openStep(page, "s_01jfiltrar");
    await expect(param(page, "where")).toHaveClass(/\bmarked\b/);
    // «Probar paso» of another automation marks too.
    await press(page, "Escape");
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, VIEWED.name, 5);
    await expect(card(page, "s_01jnueva").locator(".auto-card-mark")).toHaveCount(0);
    await card(page, "s_01jbuscar").click();
    await bar(page).getByRole("button", { name: "Probar paso" }).click();
    await expect(card(page, "s_01jnueva").locator(".auto-card-mark")).toHaveAttribute(
      "title",
      "Falta: Colección",
    );
    await openStep(page, "s_01jnueva");
    await expect(param(page, "collection")).toHaveClass(/\bmarked\b/);
  });
  test("AU-83 · the conditions editor and a row picker do not mark a required parameter while Juan is still in them: adding a condition and taking it away, a value's control taken out, a picker opened and left with Esc", async ({
    page,
  }) => {
    const picker = {
      ...CONDITIONS,
      steps: [
        ...CONDITIONS.steps,
        step("s_01jleer", "Leer una fila en Libros", "collection", {
          collection: "libros",
          action: "get",
        }),
      ],
      arrows: [...CONDITIONS.arrows, arrow("s_01jbuscar", "s_01jleer")],
      places: [...CONDITIONS.places, { step: "s_01jleer", x: 600, y: 220 }],
    };
    await openApp(page, "/?still", { automations: [picker], agent: BEFORE() });
    await openCanvas(page, CONDITIONS.name, 7);
    // «Si»: a condition added, its field chosen and taken away, all in the same control, marks nothing.
    await openStep(page, "s_01jsi");
    const where = param(page, "where");
    await where.getByRole("button", { name: "Añadir filtro" }).click();
    const field = where
      .locator(".db-filter-row")
      .first()
      .getByRole("combobox", { name: "Propiedad" });
    await field.selectOption({ label: "Favorito" });
    await where.getByRole("button", { name: "Quitar filtro" }).click();
    await page.waitForTimeout(300);
    await expect(where).not.toHaveClass(/\bmarked\b/);
    await expect(card(page, "s_01jsi").locator(".auto-card-mark")).toHaveCount(0);
    // Leaving it empty marks it.
    await nameIn(page).click();
    await expect(where).toHaveClass(/\bmarked\b/);
    await press(page, "Escape");
    await press(page, "Escape");
    // A row picker: opened and left with Esc marks nothing; leaving the row does.
    await openStep(page, "s_01jleer");
    const row = param(page, "row");
    const select = row.getByRole("combobox");
    await select.click();
    await press(page, "Escape");
    await page.waitForTimeout(300);
    await expect(row).not.toHaveClass(/\bmarked\b/);
    await expect(view(page)).toHaveAttribute("data-step", "s_01jleer");
    await select.focus();
    await press(page, "Tab");
    await expect(row).toHaveClass(/\bmarked\b/);
    await expect(card(page, "s_01jleer").locator(".auto-card-mark")).toHaveAttribute(
      "title",
      /Falta: Fila/,
    );
  });
  test("AU-84 · each empty, stale or failed state says what to do next: a list with nothing (with «Nueva»), an empty canvas, an ENTRADA with no data, a SALIDA never tested, a stale one, a failed step (with «Ir al parámetro», which opens that parameter), a search with nothing and a draft not saved", async ({
    page,
  }) => {
    // A list with nothing, with «Nueva»; an empty canvas; a search with nothing.
    const empty = await page.context().newPage();
    await empty.setViewportSize({ width: 1440, height: 900 });
    await openApp(empty, "/?still", { automations: [], agent: BEFORE([]) });
    await list(empty);
    const nueva = empty.getByRole("button", { name: "Nueva", exact: true });
    await expect(nueva.first()).toBeVisible();
    await nueva.first().click();
    await expect(panel(empty)).toContainText("¿Cómo empieza?");
    await panel(empty)
      .getByRole("textbox", { name: "Buscar un paso" })
      .pressSequentially("zzz", { delay: 40 });
    await expect(panel(empty)).toContainText("Nada con «zzz»");
    await empty.close();
    // ENTRADA with no data; SALIDA never tested.
    const fails = testOf(SI_FAILS, { state: "failed", failedAt: "s_01jsi" });
    await openApp(page, "/?still", { automations: [fails], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    await openStep(page, "s_01jsi");
    await expect(entrada(page).locator('[data-in="untested"]')).toContainText(
      "Prueba los pasos anteriores",
    );
    await expect(
      entrada(page).getByRole("button", { name: "Probar los anteriores" }),
    ).toBeVisible();
    await expect(salida(page).locator('[data-out="untested"]')).toContainText("Sin probar");
    await expect(salida(page).getByRole("button", { name: "Probar paso" })).toBeVisible();
    // A failed step: why, and «Ir al parámetro», which opens that parameter.
    await view(page).getByRole("button", { name: "Probar paso" }).first().click();
    const failed = salida(page).locator('[data-out="failed"]');
    await expect(failed).toContainText("Un valor no es del tipo que hace falta");
    await view(page).getByRole("tab", { name: "Ajustes" }).click();
    await failed.getByRole("button", { name: "Ir al parámetro" }).click();
    await expect(param(page, "where").locator(":focus")).toHaveCount(1);
    // A stale one: «puede estar vieja» with «Probar paso». Esc in the field is the field's.
    await view(page).getByRole("button", { name: "Cerrar" }).click();
    await openStep(page, "s_01jbuscar");
    await param(page, "limit").getByRole("spinbutton").fill("150");
    await expect(saved(page)).toHaveText("Guardado");
    const stale = salida(page).locator(".auto-out-stale");
    await expect(stale).toContainText("puede estar vieja");
    await expect(stale.getByRole("button", { name: "Probar paso" })).toBeEnabled();
    // A draft not saved: «Sin guardar · Reintentar».
    await serverDown(page, true);
    await param(page, "limit").getByRole("spinbutton").fill("120");
    await expect(head(page)).toContainText("Sin guardar");
    await expect(head(page).getByRole("button", { name: "Reintentar" })).toBeVisible();
    await serverDown(page, false);
    await head(page).getByRole("button", { name: "Reintentar" }).click();
    await expect(saved(page)).toHaveText("Guardado");
  });
});

test.describe("testing", () => {
  test("AU-90 · «Probar» runs the whole draft and «Registro» says how it went and that it wrote nothing; the step that would write shows what it would do and the collection is as it was", async ({
    page,
  }) => {
    await openApp(page, "/?still", { automations: [testOf(ALL_DONE)], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    await testGo(page).click();
    const box = testBar(page).getByRole("dialog");
    await box.getByRole("button", { name: "Probar" }).click();
    await expect(logLine(page)).toContainText("bien");
    await expect(logLine(page)).toContainText("7 pasos");
    await expect(logLine(page)).toContainText("no escribió nada");
    await expect(logLine(page)).toContainText("habría escrito 129 filas");
    // The whole draft: no step named, the trigger and its fields.
    const asks = await testsAsked(page);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.step).toBeUndefined();
    expect(asks[0]).toMatchObject({ trigger: "s_inicio", fields: { minimo: 300 } });
    for (const id of TESTED.steps.map((s) => s.id))
      await expect(stateOf(page, id)).toHaveText("Bien");
    // The step that would write shows it; nothing was written to the collection.
    await openStep(page, "s_01jmodificar");
    await expect(showAs(salida(page), "Haría esto")).toBeChecked();
    await expect(salida(page).locator("tr[data-would=update]")).toHaveCount(3);
    const wrote = await page.evaluate(() =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
        /^(POST|PUT|PATCH|DELETE) api\/data/.test(b),
      ),
    );
    expect(wrote).toEqual([]);
  });
  test("AU-91 · «Probar paso» tests that step and what it lacks: the steps before it that had not changed keep the time of their test, and the steps after it are not tested", async ({
    page,
  }) => {
    // Kept from five minutes ago: the trigger and «Buscar»; «Si» and what follows were never tested.
    const keptOnly = testOf(ALL_DONE, { kept: FIVE_MIN });
    (keptOnly.test as { keptOnly?: string[] }).keptOnly = ["s_inicio", "s_01jbuscar"];
    await openApp(page, "/?still", { automations: [keptOnly], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    await openStep(page, "s_01jsi");
    await view(page).getByRole("button", { name: "Probar paso" }).first().click();
    await expect(salida(page).locator(".auto-out-foot")).toContainText("hace un momento");
    const asks = await testsAsked(page);
    expect(asks.at(-1)).toMatchObject({ step: "s_01jsi", trigger: "s_inicio" });
    // Those before it keep their time; those after it are not tested.
    await press(page, "Escape");
    await openStep(page, "s_01jbuscar");
    await expect(salida(page).locator(".auto-out-foot")).toContainText("hace 5 min");
    await press(page, "Escape");
    for (const id of ["s_01jmodificar", "s_01jeliminar", "s_01jcombinar", "s_01jcrear"])
      await expect(stateOf(page, id)).toHaveCount(0);
    await expect(stateOf(page, "s_01jsi")).toHaveText("Bien");
  });
  test("AU-92 · after a step changes, its SALIDA says «puede estar vieja» and the counts of its arrows and of what hangs from it are dimmed; moving it or renaming it marks nothing; testing it again clears the mark", async ({
    page,
  }) => {
    await openApp(page, "/?still", {
      automations: [testOf(ALL_DONE, { kept: FIVE_MIN })],
      agent: BEFORE(),
    });
    await openCanvas(page, TESTED.name, 7);
    await expect(countOn(page, "s_01jsi", "s_01jmodificar")).not.toHaveClass(/\bdim\b/);
    // Renamed: nothing is marked.
    await openStep(page, "s_01jsi");
    await nameIn(page).fill("Si es largo");
    await press(page, "Enter");
    await expect(saved(page)).toHaveText("Guardado");
    await expect(salida(page).locator(".auto-out-stale")).toHaveCount(0);
    await view(page).getByRole("button", { name: "Cerrar" }).click();
    // Moved: nothing is marked.
    const from = await middle(card(page, "s_01jcrear"));
    await drag(page, from, { x: from.x + 80, y: from.y + 60 });
    await settled(page);
    await expect(page.locator(".auto-arrow-count.dim")).toHaveCount(0);
    // Changed: its SALIDA and the counts after it are dimmed; what is before it is not.
    await openStep(page, "s_01jsi");
    await view(page).getByRole("tab", { name: "Parámetros" }).click();
    const value = param(page, "where").getByRole("spinbutton", { name: "Valor" }).first();
    await value.fill("400");
    // A condition's value is kept on Intro or on leaving it, as in a view's filter.
    await press(page, "Enter");
    await expect(saved(page)).toHaveText("Guardado");
    const stale = salida(page).locator(".auto-out-stale");
    await expect(stale).toContainText("puede estar vieja");
    await press(page, "Escape");
    await expect(countOn(page, "s_01jsi", "s_01jmodificar")).toHaveClass(/\bdim\b/);
    await expect(countOn(page, "s_01jsi", "s_01jeliminar")).toHaveClass(/\bdim\b/);
    await expect(countOn(page, "s_01jmodificar", "s_01jcombinar")).toHaveClass(/\bdim\b/);
    await expect(countOn(page, "s_01jbuscar", "s_01jsi")).not.toHaveClass(/\bdim\b/);
    // Tested again: the mark goes.
    await openStep(page, "s_01jsi");
    await stale.getByRole("button", { name: "Probar paso" }).click();
    await expect(stale).toHaveCount(0);
    await press(page, "Escape");
    await expect(countOn(page, "s_01jsi", "s_01jmodificar")).not.toHaveClass(/\bdim\b/);
  });
  test("AU-94 · the fields a trigger asks are asked in the box of «Probar» and in the trigger's ENTRADA, with those of the last test filled in; a trigger with no fields starts without asking", async ({
    page,
  }) => {
    const tested = testOf(ALL_DONE, { tested: { s_inicio: { minimo: 250 } } });
    await openApp(page, "/?still", { automations: [tested, CHAIN], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    // The trigger's ENTRADA: «Datos de prueba» with the last test's value.
    await openStep(page, "s_inicio");
    const here = view(page).getByRole("spinbutton", { name: "Mínimo" });
    await expect(here).toHaveValue("250");
    await here.fill("280");
    await view(page).getByRole("button", { name: "Cerrar" }).click();
    // The box of «Probar» asks the same, with what was typed there.
    await testGo(page).click();
    const box = testBar(page).getByRole("dialog");
    const minimo = box.getByRole("spinbutton", { name: "Mínimo" });
    await expect(minimo).toHaveValue("280");
    await box.getByRole("button", { name: "Probar" }).click();
    await expect(logLine(page)).toContainText("bien");
    expect((await testsAsked(page)).at(-1)).toMatchObject({ fields: { minimo: 280 } });
    // Opened again, both say the last test's.
    await openStep(page, "s_inicio");
    await expect(here).toHaveValue("280");
    await press(page, "Escape");
    // A trigger with no fields starts at once.
    await page.getByRole("button", { name: "Volver a Automatizaciones" }).click();
    await openCanvas(page, CHAIN.name, 4);
    await testGo(page).click();
    await expect(testBar(page).getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await testsAsked(page)).length).toBe(2);
    expect((await testsAsked(page)).at(-1)).toMatchObject({ trigger: "s_inicio", fields: {} });
  });
  test("A-15 · «Probar» and «Probar paso» over 3,000 rows of 40 fields: the test, opening a step's rows and «N filas más» each answer in less than 1.5 s", async ({
    page,
  }) => {
    const big = { count: 3000, fields: 40 };
    const heavy = testOf(
      {
        s_inicio: ALL_DONE.s_inicio,
        s_01jbuscar: { rows: { "in:main": ALL_DONE.s_inicio.rows["out:main"], "out:main": big } },
        s_01jsi: { rows: { "in:main": big, "out:yes": big, "out:no": { count: 0, fields: 40 } } },
        s_01jmodificar: { rows: { "in:main": big, "out:main": big }, wouldWrite: 3000 },
        s_01jeliminar: { state: "skipped", in: { main: 0 }, out: { main: 0 } },
        s_01jcombinar: { rows: { "in:a": big, "out:main": big } },
        s_01jcrear: { rows: { "in:main": big, "out:main": big }, wouldWrite: 3000 },
      },
      { kept: FIVE_MIN },
    );
    await openApp(page, "/?still", { automations: [heavy], agent: BEFORE() });
    await openCanvas(page, TESTED.name, 7);
    const took: Record<string, number> = {};
    const time = async (what: string, act: () => Promise<void>) => {
      const t0 = Date.now();
      await act();
      took[what] = Date.now() - t0;
    };
    await time("Probar", async () => {
      await testGo(page).click();
      await testBar(page).getByRole("dialog").getByRole("button", { name: "Probar" }).click();
      await expect(logLine(page)).toContainText("habría escrito 6000 filas");
    });
    await time("open the step's rows", async () => {
      await openStep(page, "s_01jsi");
      await expect(salida(page).locator("tbody tr")).toHaveCount(50);
    });
    await time("N filas más", async () => {
      await salida(page).getByRole("button", { name: "2950 filas más" }).click();
      await expect(salida(page).locator("tbody tr")).toHaveCount(100);
    });
    await time("Probar paso", async () => {
      await view(page).getByRole("button", { name: "Probar paso" }).first().click();
      await expect(salida(page).locator(".auto-out-foot")).toContainText("hace un momento");
      await expect(salida(page).locator("tbody tr")).toHaveCount(50);
    });
    console.log(`A-15 timing (3,000 rows × 40 fields): ${JSON.stringify(took)}`);
    for (const [what, ms] of Object.entries(took)) expect(ms, what).toBeLessThan(1500);
  });
});
