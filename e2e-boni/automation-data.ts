/**
 * The automations the e2e tests open (AU-61): steps and arrows as the app writes them, and «Revisar pendientes» with
 * what a test of it answers. Shared by automations.spec.ts and the reference captures (screens.spec.ts, I-07). All
 * invented (D-14).
 */

/** Steps and arrows as the app writes them, for the automations of the canvas's tests. */
export const step = (
  id: string,
  name: string,
  type: string,
  params: Record<string, unknown> = {},
) => ({
  id,
  name,
  type,
  params,
});
export const arrow = (from: string, to: string, output = "main") => ({
  from: { step: from, output },
  to: { step: to, input: "main" },
});
/**
 * «Revisar pendientes», for «Probar» (E): a trigger that asks «Mínimo», a «Buscar filas», a «Si», a step that changes
 * rows and one that sends them to the trash on its two outputs, a «Combinar» of both and a «Crear una fila» at the
 * end, whose output has no arrow. What the server answers a test of it is given by each test (`testOf`).
 */
export const TESTED = {
  id: "a_01jx8x0t2v4x6z8b0d2f4h6k8n",
  name: "Revisar pendientes",
  updated: 1761990000000,
  steps: [
    step("s_inicio", "Disparado por el usuario", "manual", {
      fields: [{ key: "minimo", name: "Mínimo", type: "number" }],
    }),
    step("s_01jbuscar", "Buscar filas en Libros", "collection", {
      collection: "libros",
      action: "find",
      where: [{ field: "estado", op: "is", value: "o_pendiente" }],
      limit: 200,
    }),
    step("s_01jsi", "Si", "if", { where: [{ field: "paginas", op: "gt", value: 300 }] }),
    step("s_01jmodificar", "Modificar filas en Libros", "collection", {
      collection: "libros",
      action: "update",
      target: "incoming",
      fields: [{ field: "notas", value: "Revisar" }],
    }),
    step("s_01jeliminar", "Eliminar filas en Libros", "collection", {
      collection: "libros",
      action: "trash",
      target: "incoming",
    }),
    step("s_01jcombinar", "Combinar", "combine", { by: "all" }),
    step("s_01jcrear", "Crear una fila en Libros", "collection", {
      collection: "libros",
      action: "create",
      fields: [{ field: "titulo", value: "Resumen de pendientes" }],
    }),
  ],
  arrows: [
    arrow("s_inicio", "s_01jbuscar"),
    arrow("s_01jbuscar", "s_01jsi"),
    arrow("s_01jsi", "s_01jmodificar", "yes"),
    arrow("s_01jsi", "s_01jeliminar", "no"),
    { from: { step: "s_01jmodificar", output: "main" }, to: { step: "s_01jcombinar", input: "a" } },
    { from: { step: "s_01jeliminar", output: "main" }, to: { step: "s_01jcombinar", input: "b" } },
    arrow("s_01jcombinar", "s_01jcrear"),
  ],
  places: [
    { step: "s_inicio", x: 0, y: 0 },
    { step: "s_01jbuscar", x: 300, y: 0 },
    { step: "s_01jsi", x: 600, y: 0 },
    { step: "s_01jmodificar", x: 900, y: -130 },
    { step: "s_01jeliminar", x: 900, y: 130 },
    { step: "s_01jcombinar", x: 1200, y: 0 },
    { step: "s_01jcrear", x: 1500, y: 0 },
  ],
};
/**
 * A book as a test brings it: the keys of Libros and some more (thirteen fields), a related row, a list, and a title
 * and a value that look like HTML and like a link (A-01).
 */
export const book = (i: number) => ({
  json: {
    titulo: i === 1 ? "<b>Rayuela</b>" : `Libro ${i}`,
    estado: "o_pendiente",
    paginas: 200 + i,
    fin: null,
    fav: false,
    notas: null,
    web: "https://ejemplo.example.com/libros/1",
    editorial: "Editorial de ejemplo",
    anio: 1963,
    idioma: "es",
    isbn: `978-0-00-0000${String(i).padStart(2, "0")}-0`,
    autor: { nombre: "Autora de ejemplo", pais: "Chile" },
    relacionado: [{ titulo: "Libro 2" }, { titulo: "Libro 3" }],
  },
  label: {},
});
export const books = (n: number, from = 1) => Array.from({ length: n }, (_, i) => book(from + i));
/** What «Modificar filas» would do to a book: its «notas», from empty to «Revisar». */
export const changed = (i: number) => {
  const b = book(i);
  return { json: { ...b.json, notas: "Revisar" }, before: b.json, would: "update", label: {} };
};
export const trashed = (i: number) => ({ ...book(i), before: book(i).json, would: "trash" });
/** Every step of «Revisar pendientes» tested and fine: 128 books, 3 to change, 125 to the trash, one made. */
export const ALL_DONE = {
  s_inicio: { rows: { "out:main": [{ json: { minimo: 300 }, label: {} }] }, ms: 10 },
  s_01jbuscar: {
    rows: { "in:main": [{ json: { minimo: 300 }, label: {} }], "out:main": books(128) },
    ms: 180,
  },
  s_01jsi: {
    rows: { "in:main": books(128), "out:yes": books(3, 126), "out:no": books(125) },
    ms: 40,
  },
  s_01jmodificar: {
    rows: { "in:main": books(3, 126), "out:main": [126, 127, 128].map(changed) },
    wouldWrite: 3,
    ms: 60,
  },
  s_01jeliminar: {
    rows: {
      "in:main": books(125),
      "out:main": Array.from({ length: 125 }, (_, i) => trashed(i + 1)),
    },
    wouldWrite: 125,
    ms: 90,
  },
  s_01jcombinar: {
    rows: {
      "in:a": [126, 127, 128].map(changed),
      "in:b": Array.from({ length: 125 }, (_, i) => trashed(i + 1)),
      "out:main": [{ json: { total: 128 }, label: {} }],
    },
    ms: 20,
  },
  s_01jcrear: {
    rows: {
      "in:main": [{ json: { total: 128 }, label: {} }],
      "out:main": [
        {
          json: { titulo: "Resumen de pendientes", estado: null, paginas: null },
          before: null,
          would: "create",
          label: {},
        },
      ],
    },
    wouldWrite: 1,
    ms: 30,
  },
};
/** «Revisar pendientes» with what a test of it answers; `kept`: tested already, that long ago. */
export const testOf = (
  steps: Record<string, unknown>,
  more: {
    kept?: number;
    state?: string;
    failedAt?: string;
    problems?: unknown[];
    tested?: unknown;
  } = {},
  base: { id: string; name: string } = TESTED,
) => ({
  ...TESTED,
  ...base,
  test: {
    steps,
    ...(more.kept !== undefined ? { kept: Date.now() - more.kept } : {}),
    ...(more.state ? { state: more.state } : {}),
    ...(more.failedAt ? { failedAt: more.failedAt } : {}),
    ...(more.problems ? { problems: more.problems } : {}),
    tested: (more.tested as Record<string, Record<string, unknown>>) ?? {
      s_inicio: { minimo: 300 },
    },
  },
});
