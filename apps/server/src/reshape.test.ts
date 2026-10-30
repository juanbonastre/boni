import { ensureSystemTypes } from "@boni/agent";
import { label } from "@boni/entities";
import { BODY, openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { calendarDefs, StoreCalendar } from "./calendarStore.ts";
import { createPage, listPages } from "./pages.ts";
import { HASH_FIELD, PATH_FIELD } from "./paths.ts";
import { planErrors, planFromNote, type ReshapePlan, reshape, undoReshape } from "./reshape.ts";
import { seed, type TypeSpec } from "./seed.test-util.ts";

/** Invented: three calendars of a vault (one closed to the AI, its area written as text) and two money lists. */
const cal = (id: string, name: string) => ({
  id,
  name,
  folder: `agenda/${id}`,
  account: "Agenda",
  color: "#60a5fa",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "startTime", name: "Hora de inicio", type: "time" },
    { id: "completed", name: "Hecha", type: "checkbox" },
  ],
  mapping: {
    title: "title",
    when: { kind: "split", date: "date", startTime: "startTime" },
    task: { column: "completed" },
  },
  newNote: { name: "{title}", body: "", properties: { area: `[[${id}]]` } },
});
const AREA = { area: { type: "relation" as const, to: "area" } };
const TYPES: TypeSpec[] = [
  { key: "area", name: "Área", folder: "areas/" },
  {
    key: "trabajo",
    name: "Trabajo",
    folder: "agenda/trabajo/",
    fields: { ...AREA, origen: "text" },
    calendar: cal("trabajo", "Trabajo"),
  },
  {
    key: "casa",
    name: "Casa",
    folder: "agenda/casa/",
    fields: AREA,
    calendar: cal("casa", "Casa"),
  },
  {
    key: "medico",
    name: "Médico",
    folder: "agenda/medico/",
    ai: "restricted",
    calendar: cal("medico", "Médico"),
  },
  { key: "gastos", name: "Gastos", folder: "dinero/gastos/" },
  { key: "reglas", name: "Reglas", folder: "dinero/reglas/", fields: { texto: "text" } },
];
const NOTES: Record<string, string> = {
  "areas/trabajo.md": "---\ntype: area\n---\n# Trabajo\n",
  "areas/casa.md": "---\ntype: area\n---\n# Casa\n",
  "areas/medico.md": "---\ntype: area\n---\n# Médico\n",
  "agenda/trabajo/Informe.md":
    '---\ntitle: "Informe"\ndate: "2026-11-02"\ncompleted: false\narea: "[[trabajo]]"\n---\nLo que falta.\n',
  "agenda/trabajo/Claustro.md":
    '---\ntitle: "Claustro"\ndate: "2026-11-03"\nstartTime: "10:00"\norigen: "correo"\narea: "[[trabajo]]"\n---\n',
  "agenda/trabajo/Reunión.md": '---\ntitle: "Reunión"\ndate: "2026-11-04"\n---\n',
  "agenda/casa/Fontanero.md":
    '---\ntitle: "Fontanero"\ndate: "2026-11-05"\ncompleted: true\narea: "[[casa]]"\n---\n',
  "agenda/medico/Revisión.md":
    '---\ntitle: "Revisión"\ndate: "2026-11-06"\narea: "[[medico]]"\n---\n',
  "agenda/medico/Pedir cita.md":
    '---\ntitle: "Pedir cita"\ndate: "2026-11-07"\ncompleted: false\n---\n',
  "dinero/gastos/Pan.md": '---\ntitle: "Pan"\n---\n',
  "dinero/reglas/Panadería.md": '---\ntexto: "PANADERIA"\n---\n',
};
const area = (title: string) => ({ title, in: "t_area" });
const PLAN: ReshapePlan = {
  collections: [
    {
      name: "Agenda",
      fields: {
        from: "t_trabajo",
        ids: ["f_title", "f_date", "f_starttime", "f_area", PATH_FIELD, HASH_FIELD],
      },
    },
    { name: "Tarea", inside: "Agenda", fields: { from: "t_trabajo", ids: ["f_completed"] } },
    { name: "Evento", inside: "Agenda" },
    { name: "Tareas del médico", inside: "Tarea", ai: "private" },
    { name: "Citas", inside: "Evento", ai: "private", description: "Lo del médico." },
    { name: "Dinero" },
  ],
  mothers: [
    { collection: "t_gastos", inside: "Dinero" },
    { collection: "Reglas", inside: "Dinero" },
  ],
  moves: [
    {
      from: "t_trabajo",
      to: "Evento",
      ifSet: { field: "f_completed", to: "Tarea" },
      set: { f_area: area("Trabajo") },
    },
    {
      from: "t_casa",
      to: "Evento",
      ifSet: { field: "f_completed", to: "Tarea" },
      set: { f_area: area("Casa") },
    },
    {
      from: "t_medico",
      to: "Citas",
      ifSet: { field: "f_completed", to: "Tareas del médico" },
      set: { f_area: area("Médico") },
    },
  ],
  calendars: [
    {
      calendar: "trabajo",
      branch: "Agenda",
      where: { field: "f_area", is: area("Trabajo") },
      make: { event: "Evento", task: "Tarea" },
    },
    {
      calendar: "Casa",
      branch: "Agenda",
      where: { field: "f_area", is: area("Casa"), orEmpty: true },
      make: { event: "Evento", task: "Tarea" },
    },
    {
      calendar: "medico",
      branch: "Agenda",
      where: { field: "f_area", is: area("Médico") },
      make: { event: "Citas", task: "Tareas del médico" },
    },
  ],
  trash: { collections: ["t_trabajo", "t_casa", "t_medico"], pages: ["Agenda vieja"] },
};

const stores: UserStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
function fresh(): UserStore {
  const store = openUserStore(":memory:");
  stores.push(store);
  // As Juan's data came from the vault: each record keeps the path its note had (what the reshape clears away).
  seed(store, TYPES, NOTES, { vaultPaths: true });
  ensureSystemTypes(store);
  createPage(store, { title: "Agenda vieja" });
  return store;
}
const byTitle = (store: UserStore, title: string) =>
  Object.values(store.schema().types)
    .flatMap((t) => store.entities(t.id))
    .find((e) => e.values.f_title === title);
const typeName = (store: UserStore, id: string | undefined) =>
  id ? store.schema().types[id]?.name : undefined;

describe("reshaping an account's tree (docs/clases.md §7, step 5)", () => {
  it("a dry run says what it would do, with counts, and changes nothing", () => {
    const store = fresh();
    const before = JSON.stringify(store.schema());
    const r = reshape(store, PLAN, { apply: false });
    expect(r.problems).toEqual([]);
    expect(r.applied).toBe(false);
    expect(r.lines).toContain(
      "Colección nueva «Tareas del médico» dentro de «Tarea»: 0 campos propios; privada para la IA.",
    );
    expect(r.lines).toContain(
      "«Trabajo»: 3 registros → 2 a «Evento», 1 a «Tarea»; «area» = «Trabajo».",
    );
    expect(r.lines).toContain(
      "«Médico»: 2 registros → 1 a «Citas», 1 a «Tareas del médico»; «area» = «Médico».",
    );
    expect(
      r.lines.some((l) =>
        l.startsWith("Calendario «Casa»: «Agenda» donde «area» es «Casa» o está vacío"),
      ),
    ).toBe(true);
    expect(r.lines).toContain("A la papelera: las páginas «Agenda vieja».");
    // Never a record's content: only counts and the names of collections.
    expect(r.lines.join("\n")).not.toContain("Informe");
    expect(JSON.stringify(store.schema())).toBe(before);
    expect(listPages(store).map((p) => p.title)).toContain("Agenda vieja");
  });

  it("applied, it is one run: records keep their ids and every value, calendars follow, all undone at once", async () => {
    const store = fresh();
    const informe = byTitle(store, "Informe");
    const claustro = byTitle(store, "Claustro");
    const reunion = byTitle(store, "Reunión");
    const defsBefore = store.setting("calendar/defs");
    const r = reshape(store, PLAN, { apply: true });
    expect(r.problems).toEqual([]);
    expect(r.run).toMatch(/^reshape-/);
    const types = store.schema().types;
    // The same records, where they belong now, with their values; the area as the calendar they were in.
    expect(store.get(informe?.id as string)?.entity).toMatchObject({
      values: { f_title: "Informe", f_date: "2026-11-02", f_completed: false },
      body: "Lo que falta.\n",
    });
    expect(typeName(store, store.get(informe?.id as string)?.entity.type)).toBe("Tarea");
    const areaId = (t: string) => store.entities("t_area").find((e) => e.values.f_title === t)?.id;
    expect(store.get(reunion?.id as string)?.entity.values.f_area).toBe(areaId("Trabajo"));
    // What Evento did not have (origen) came along, archived: nothing is lost.
    const evento = Object.values(types).find((t) => t.name === "Evento");
    expect(evento?.fields.find((f) => f.id === "f_origen")?.archived).toBe(true);
    expect(store.get(claustro?.id as string)?.entity.values.f_origen).toBe("correo");
    // The closed one stays closed: its records are in private collections.
    const citas = Object.values(types).find((t) => t.name === "Citas")?.id as string;
    expect(store.aiAccess()[citas]).toBe("private");
    expect(store.entities(citas).map((e) => e.values.f_title)).toEqual(["Revisión"]);
    // The old collections are archived; the page is in the trash; inside Dinero each keeps her own title.
    expect(types.t_trabajo?.archived).toBe(true);
    expect(listPages(store).map((p) => p.title)).not.toContain("Agenda vieja");
    const dinero = Object.values(types).find((t) => t.name === "Dinero");
    expect(types.t_reglas?.parent).toBe(dinero?.id);
    expect(dinero?.titleField).toBe("f_titulo");
    expect(types.t_reglas?.titleField).toBe("f_title");
    expect(types.t_gastos?.fields.some((f) => f.id === "f_titulo")).toBe(false);
    // Boni Calendar: the same rows (by their note's path), each in its calendar, from the branch.
    const calendar = new StoreCalendar(store, { write: true, pollMs: 60_000 });
    try {
      const rows = (await calendar.snapshot()).rows;
      // The same records (by their ids), each in the calendar it was in.
      const at = (path: string) => store.findByValue(PATH_FIELD, path)[0]?.id as string;
      expect(Object.fromEntries(rows.map((x) => [x.id, x.collectionId]))).toEqual({
        [at("agenda/trabajo/Informe.md")]: "trabajo",
        [at("agenda/trabajo/Claustro.md")]: "trabajo",
        [at("agenda/trabajo/Reunión.md")]: "trabajo",
        [at("agenda/casa/Fontanero.md")]: "casa",
        [at("agenda/medico/Revisión.md")]: "medico",
        [at("agenda/medico/Pedir cita.md")]: "medico",
      });
    } finally {
      calendar.close();
    }
    expect(calendarDefs(store).map((p) => [p.def.id, typeName(store, p.make?.event)])).toEqual([
      ["trabajo", "Evento"],
      ["casa", "Evento"],
      ["medico", "Citas"],
    ]);

    // Undone whole: the tree, the records, the calendars and the page as they were.
    expect(undoReshape(store, r.run as string)).toBeGreaterThan(0);
    const back = store.schema().types;
    expect(Object.values(back).some((t) => t.name === "Agenda")).toBe(false);
    expect(back.t_trabajo?.archived).toBeUndefined();
    expect(back.t_reglas?.parent).toBeUndefined();
    expect(store.get(informe?.id as string)?.entity).toMatchObject({
      type: "t_trabajo",
      values: { f_title: "Informe", f_completed: false },
    });
    expect(store.setting("calendar/defs")).toBe(defsBefore);
    expect(listPages(store).map((p) => p.title)).toContain("Agenda vieja");
  });

  it("refuses, changing nothing: pending proposals, a collection that would not be empty, records made more open", () => {
    const check = (plan: ReshapePlan, problem: string, prepare?: (s: UserStore) => void) => {
      const store = fresh();
      prepare?.(store);
      const before = JSON.stringify(store.schema());
      const r = reshape(store, plan, { apply: true });
      expect(r.applied).toBe(false);
      expect(r.problems.join("\n")).toContain(problem);
      expect(JSON.stringify(store.schema())).toBe(before);
    };
    check(PLAN, "propuestas pendientes", (store) => {
      store.journal.startRun({
        id: "r1",
        turn: null,
        origin: "background",
        device: null,
        started: 1,
      });
      store.journal.addProposal({
        id: "p1",
        run: "r1",
        tool: "entities.create",
        args: { values: {}, origins: [] },
        view: {
          tool: "entities.create",
          title: "Crear",
          rows: [{ arg: "type", role: "type", value: "trabajo", detail: "Trabajo" }],
        },
        sources: ["mail:ejemplo@example.edu"],
        created: 2,
      });
    });
    check({ trash: { collections: ["t_casa"] } }, "«Casa» no se queda vacía (1 registros)");
    check(
      { ...PLAN, moves: [{ from: "t_medico", to: "t_casa" }] },
      "«Médico» es restringida para la IA y «Casa» visible",
    );
    expect(planErrors({ moves: [{ from: "x" }], otra: 1 })).toEqual([
      "plan: «otra» sobra",
      "moves[0]: faltan «from» y «to»",
    ]);
  });

  it("the plan may live in a note of the account: its first json block, run as it is", () => {
    const store = fresh();
    const l = label("user", "personal", [{ kind: "user-edit", id: "portatil" }]);
    const block = JSON.stringify({ trash: { pages: ["Agenda vieja"] } });
    const note = store.create(
      "t_gastos",
      {
        f_title: { value: "Plan inventado", label: l },
        [BODY]: { value: `Lo que cambia.\n\n\`\`\`json\n${block}\n\`\`\`\n`, label: l },
      },
      { actor: "user", device: "portatil" },
    );
    const plan = planFromNote(store, note.entity.id);
    expect(reshape(store, plan, { apply: false }).lines).toEqual([
      "A la papelera: las páginas «Agenda vieja».",
    ]);
    expect(() => planFromNote(store, byTitle(store, "Pan")?.id as string)).toThrow(
      "no ```json block",
    );
  });
});

describe("clearing away what the vault left (docs/clases.md §7, step 7)", () => {
  const TYPES7: TypeSpec[] = [
    { key: "persona", name: "Persona", folder: "personas/" },
    { key: "finanzas", name: "Finanzas", folder: "finanzas/" },
    // People as the import left them: options named by the file a person's note had.
    {
      key: "movimiento",
      name: "Movimiento",
      folder: "finanzas/movimientos/",
      parent: "finanzas",
      fields: { people: { type: "multiselect" } },
    },
    { key: "deuda", name: "Deuda", folder: "finanzas/deudas/", parent: "finanzas" },
    { key: "area", name: "Área", folder: "areas/" },
    { key: "nota", name: "Nota", folder: "" },
  ];
  const NOTES7: Record<string, string> = {
    "personas/ana-ejemplo.md": "---\ntype: person\n---\n# Ana Ejemplo\n",
    "finanzas/movimientos/2026-09-01-cena.md":
      '---\ntype: movement\ndate: 2026-09-01\namount: -30\npeople: ["[[ana-ejemplo]]"]\n---\n# Cena 30,00 EUR\n',
    "finanzas/movimientos/2026-09-02-bizum.md":
      '---\ntype: movement\ndate: 2026-09-02\namount: 15\nsettles: "[[2026-09-01-ana-cena]]"\npeople: ["[[ana-ejemplo]]", "[[nadie]]"]\n---\n# Bizum 15,00 EUR\n',
    "finanzas/deudas/2026-09-01-ana-cena.md":
      '---\ntype: debt\namount: 15\nperson: "[[ana-ejemplo]]"\n---\n# Ana: cena\n',
    "areas/planes.md": "---\ntype: area\n---\n# Planes\n\nQue va aqui: Ocio.\n\n![[area.base]]\n",
    "wiki/infra/nas.md":
      "---\ntype: wiki\nstatus: activo\ndevice: nas\n---\n# El NAS\n\nTexto inventado.\n\n![[diagrama.png]]\n\nMás texto.\n",
    "AGENTS.md": "# Instrucciones\n\nInventadas.\n",
  };
  const PLAN7: ReshapePlan = {
    links: [
      { collection: "Movimiento", field: "people", to: "Persona" },
      { collection: "Movimiento", field: "settles", to: "Finanzas" },
      { collection: "Deuda", field: "person", to: "Persona" },
    ],
    titles: true,
    collections: [
      { name: "Wiki", fields: { from: "Nota", ids: ["status"] } },
      { name: "Infraestructura", inside: "Wiki", fields: { from: "Nota", ids: ["device"] } },
    ],
    moves: [
      { from: "Nota", to: "Infraestructura", where: { field: PATH_FIELD, prefix: "wiki/infra/" } },
      { from: "Nota", to: "Wiki", where: { field: PATH_FIELD, prefix: "wiki/" } },
    ],
    fields: [
      { collection: "Área", add: [{ name: "Qué va", type: "longtext" }], archive: ["type"] },
      { collection: "Movimiento", archive: ["type"] },
      // Loose notes keep no fields of their own.
      { collection: "Nota", archive: "all" },
    ],
    records: [{ title: "Planes", in: "Área", set: { "Qué va": "Ocio." }, text: "" }],
    embeds: "remove",
    vaultPaths: "archive",
  };
  const L = label("imported", "personal", [{ kind: "vault", id: "prueba" }]);
  function fresh7() {
    const store = openUserStore(":memory:");
    stores.push(store);
    const ids = seed(store, TYPES7, NOTES7, { vaultPaths: true });
    // Two notes the import left without a title: one opens with a heading, the other does not.
    const untitled = (path: string, body: string) =>
      store.create(
        "t_nota",
        { [PATH_FIELD]: { value: path, label: L }, [BODY]: { value: body, label: L } },
        { actor: "import" },
      ).entity.id;
    const series = untitled("wiki/temas/series-temporales.md", "# Series temporales\n\nTexto.\n");
    const rutina = untitled("wiki/como-hacer/rutina-de-ejercicios.md", "Lunes: pierna.\n");
    return { store, ids, series, rutina };
  }
  const values = (store: UserStore, id: string) => store.get(id)?.entity;
  const fieldNamed = (store: UserStore, type: string, name: string) =>
    store.schema().types[type]?.fields.find((f) => f.name === name && !f.archived);

  it("a dry run says what it would do, with counts, and changes nothing", () => {
    const { store } = fresh7();
    const before = JSON.stringify(store.schema());
    const r = reshape(store, PLAN7, { apply: false });
    expect(r.problems).toEqual([]);
    expect(r.lines).toEqual(
      expect.arrayContaining([
        "«Movimiento»: «people» pasa a ser una relación con «Persona» (2 registros, 2 enlaces; 1 no encuentran registro y quedan solo en el texto archivado).",
        "«Movimiento»: «settles» pasa a ser una relación con «Finanzas» (1 registros, 1 enlaces).",
        "«Deuda»: «person» pasa a ser una relación con «Persona» (1 registros, 1 enlaces).",
        "Títulos: 2 registros sin título lo toman: 1 del encabezado de su texto, 1 del nombre de su fichero.",
        "«Nota» (los de «wiki/infra/»): 1 registros → 1 a «Infraestructura».",
        "«Nota» (los de «wiki/»): 2 registros → 2 a «Wiki».",
        "«Área»: campos nuevos «Qué va»; 1 campos archivados («type»).",
        "Registros nombrados: 1 con sus valores; 1 se quedan sin texto (dejan de salir como notas en el árbol).",
        "Incrustaciones de Obsidian (![[…]]): 1 fuera del texto de 1 registros.",
        "La ruta y la huella que dejó el vault se archivan en 4 colecciones: nada las lee ya.",
      ]),
    );
    expect(JSON.stringify(store.schema())).toBe(before);
  });

  it("applied, links are relations, titles and text clean, the wiki a tree, no path read; undone whole", () => {
    const { store, ids, series, rutina } = fresh7();
    const before = JSON.stringify(store.schema());
    const r = reshape(store, PLAN7, { apply: true });
    expect(r.problems).toEqual([]);
    const ana = ids.get("personas/ana-ejemplo.md") as string;
    const debt = ids.get("finanzas/deudas/2026-09-01-ana-cena.md") as string;
    const bizum = ids.get("finanzas/movimientos/2026-09-02-bizum.md") as string;
    // A movement's people and what it settles are records now (a debt: the relation takes the whole branch).
    const people = fieldNamed(store, "t_movimiento", "people");
    const settles = fieldNamed(store, "t_movimiento", "settles");
    expect(people).toMatchObject({
      type: "relation",
      relation: { target: "t_persona", many: true },
    });
    expect(settles).toMatchObject({ type: "relation", relation: { target: "t_finanzas" } });
    expect(values(store, bizum)?.values[people?.id as string]).toEqual([ana]);
    expect(values(store, bizum)?.values[settles?.id as string]).toBe(debt);
    // What it was stays, archived (the link that found no record too).
    const text = store.schema().types.t_movimiento?.fields.find((f) => f.name === "people (texto)");
    expect(text?.archived).toBe(true);
    expect(JSON.stringify(values(store, bizum)?.values[text?.id as string])).toContain("nadie");
    // Titles from the heading (out of the text) or the file's name.
    expect(values(store, series)).toMatchObject({ type: "t_wiki", body: "Texto.\n" });
    // Titled where their new collection keeps titles (her own «Título», not Nota's field).
    const titleOf = (id: string) => {
      const e = values(store, id);
      const tf = e ? store.schema().types[e.type]?.titleField : undefined;
      return tf ? e?.values[tf] : undefined;
    };
    expect(store.schema().types.t_wiki?.titleField).not.toBe("f_title");
    expect(titleOf(series)).toBe("Series temporales");
    expect(titleOf(rutina)).toBe("Rutina de ejercicios");
    expect(titleOf(ids.get("wiki/infra/nas.md") as string)).toBe("El NAS");
    // The wiki as collections, with the fields their notes use; the embed out of the text.
    const nas = values(store, ids.get("wiki/infra/nas.md") as string);
    expect(nas?.type).toBe("t_infraestructura");
    expect(nas?.body).toBe("Texto inventado.\n\nMás texto.\n");
    expect(store.schema().types.t_infraestructura?.parent).toBe("t_wiki");
    // An area is a record without a note: what goes in it in a field.
    const planes = values(store, ids.get("areas/planes.md") as string);
    const queVa = fieldNamed(store, "t_area", "Qué va");
    expect(planes?.values[queVa?.id as string]).toBe("Ocio.");
    expect(planes?.body).toBeUndefined();
    const nota = store.schema().types.t_nota;
    expect(nota?.fields.filter((f) => !f.archived && !f.hidden).map((f) => f.id)).toEqual([
      nota?.titleField,
    ]);
    // No collection keeps the vault's path in sight.
    for (const t of Object.values(store.schema().types))
      expect(
        t.fields.some((f) => f.id === PATH_FIELD && !f.archived),
        t.name,
      ).toBe(false);

    // Undone whole: the schema as it was (each collection one version on), the records too.
    undoReshape(store, r.run as string);
    const shape = (json: string) =>
      Object.values(JSON.parse(json).types as Record<string, { schemaVersion?: number }>).map(
        ({ schemaVersion: _v, ...t }) => t,
      );
    expect(shape(JSON.stringify(store.schema()))).toEqual(shape(before));
    expect(values(store, series)?.values.f_title).toBeUndefined();
    expect(values(store, series)?.type).toBe("t_nota");
    expect(values(store, ids.get("areas/planes.md") as string)?.body).toContain("![[area.base]]");
  });

  it("refuses a link from a field that holds no links, naming it", () => {
    const { store } = fresh7();
    const r = reshape(
      store,
      { links: [{ collection: "Movimiento", field: "amount", to: "Persona" }] },
      { apply: false },
    );
    expect(r.problems).toEqual(["«amount» de «Movimiento» es number: no guarda enlaces"]);
    expect(planErrors({ titles: "sí", embeds: true, vaultPaths: "borrar" })).toEqual([
      "«titles» es true",
      '«embeds» es "remove", "views" o "files"',
      '«vaultPaths» es "archive"',
    ]);
  });

  it("only Obsidian's views go, with the heading each leaves empty; a person's photo becomes a link to its file", () => {
    const store = openUserStore(":memory:");
    stores.push(store);
    const ids = seed(
      store,
      [
        { key: "persona", name: "Persona", folder: "personas/", fields: { photo: "text" } },
        { key: "proyecto", name: "Proyecto", folder: "proyectos/" },
        { key: "archivos", name: "Archivos", folder: "", files: true },
      ],
      {
        "personas/ana-ejemplo.md":
          '---\nphoto: "[[personas/attachments/ana-ejemplo.png]]"\n---\n# Ana Ejemplo\n\n![[personas/attachments/ana-ejemplo.png|200]]\n\n## Proyectos y notas\n![[person.base]]\n',
        "personas/attachments/ana-ejemplo.png": "png inventado",
        "proyectos/boni.md": "# Boni\n\n## Agenda\n![[project.base]]\n- 2026-10-18 - Pruebas.\n",
        "proyectos/otro.md":
          "# Otro\n\nTexto ![[x.base#Tabla]] en línea.\n\n## Vista\n\n![[a.base]]\n\n![[b.base|200]]\n\n## Notas\n\nAlgo.\n",
      },
      { vaultPaths: true },
    );
    const plan: ReshapePlan = {
      links: [{ collection: "Persona", field: "photo", to: "Archivos" }],
      embeds: "views",
    };
    expect(planErrors(plan)).toEqual([]);
    expect(reshape(store, plan, { apply: false }).lines).toEqual([
      "«Persona»: «photo» pasa a ser una relación con «Archivos» (1 registros, 1 enlaces).",
      "Vistas de Obsidian (![[….base]]): 5 fuera del texto de 3 registros, y 2 encabezados que se quedaban vacíos.",
    ]);
    const r = reshape(store, plan, { apply: true });
    expect(r.problems).toEqual([]);
    const body = (path: string) => store.get(ids.get(path) as string)?.entity.body ?? "";
    expect(body("personas/ana-ejemplo.md")).toContain(
      "![[personas/attachments/ana-ejemplo.png|200]]",
    );
    expect(body("personas/ana-ejemplo.md")).not.toMatch(/base|Proyectos y notas/);
    expect(body("proyectos/boni.md")).toContain("## Agenda\n- 2026-10-18 - Pruebas.");
    expect(body("proyectos/otro.md")).toContain("Texto en línea.\n\n## Notas\n\nAlgo.");
    expect(body("proyectos/otro.md")).not.toMatch(/base|## Vista/);
    const photo = store
      .schema()
      .types.t_persona?.fields.find((f) => f.name === "photo" && !f.archived);
    expect(photo?.type).toBe("relation");
    expect(
      store.get(ids.get("personas/ana-ejemplo.md") as string)?.entity.values[photo?.id as string],
    ).toBe(ids.get("personas/attachments/ana-ejemplo.png"));
    undoReshape(store, r.run as string);
    expect(body("proyectos/boni.md")).toContain("![[project.base]]");
  });

  it("each embedded file that finds its row becomes a file block; a shared name, a missing file and one inside a line stay", () => {
    const store = openUserStore(":memory:");
    stores.push(store);
    const ids = seed(
      store,
      [
        { key: "tarea", name: "Tarea", folder: "agenda/" },
        { key: "archivos", name: "Archivos", folder: "", files: true },
      ],
      {
        "agenda/tarea.md": [
          "# Una tarea",
          "",
          "Texto.",
          "",
          "![[agenda/attachments/image 2.png|image 2.png]]",
          "> [!note]+ Un aviso",
          "> ![[unico.png|200]]",
          "  ![[image 2.png]]",
          "![[no-existe.png]]",
          "Una línea con ![[unico.png]] en medio.",
          "![[Otra nota]]",
          "",
        ].join("\n"),
        "agenda/attachments/image 2.png": "png inventado",
        "otra/carpeta/image 2.png": "otro png inventado",
        "adjuntos/unico.png": "png inventado único",
      },
    );
    const plan: ReshapePlan = { embeds: "files" };
    expect(planErrors(plan)).toEqual([]);
    const r = reshape(store, plan, { apply: true });
    expect(r.lines).toEqual([
      "Ficheros incrustados (![[…]]): 2 pasan a ser bloques de fichero en 1 registros (1 por carpeta y nombre, 1 por un nombre que solo tiene un fichero). Se quedan como estaban: 1 con un nombre que llevan varios ficheros, 1 sin fichero en Boni y 1 en mitad de una línea.",
    ]);
    const body = store.get(ids.get("agenda/tarea.md") as string)?.entity.body ?? "";
    expect(body).toContain(`![image 2.png](boni:${ids.get("agenda/attachments/image 2.png")})`);
    expect(body).toContain(
      `> [!note]+ Un aviso\n![unico.png|200](boni:${ids.get("adjuntos/unico.png")})`,
    );
    for (const kept of [
      "  ![[image 2.png]]",
      "![[no-existe.png]]",
      "con ![[unico.png]] en",
      "![[Otra nota]]",
    ])
      expect(body).toContain(kept);
    undoReshape(store, r.run as string);
    expect(store.get(ids.get("agenda/tarea.md") as string)?.entity.body).toContain(
      "![[agenda/attachments/image 2.png|image 2.png]]",
    );
  });
});
