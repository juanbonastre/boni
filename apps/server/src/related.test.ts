import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { addFile, DataError, FILES_INTO, fileInline, rowUiOf, setRowUi } from "./data.ts";
import { relatedTo } from "./related.ts";
import { seed, type TypeSpec } from "./seed.test-util.ts";

/** Invented collections: people, projects that name one, and money under a mother (a payment names her branch). */
const TYPES: TypeSpec[] = [
  { key: "persona", name: "Persona", folder: "personas/" },
  {
    key: "proyecto",
    name: "Proyecto",
    folder: "proyectos/",
    fields: { Persona: { type: "relation", to: "persona" }, Inicio: "date" },
  },
  { key: "finanzas", name: "Finanzas", folder: "finanzas/" },
  { key: "deuda", name: "Deuda", folder: "finanzas/deudas/", parent: "finanzas" },
  {
    key: "movimiento",
    name: "Movimiento",
    folder: "finanzas/movimientos/",
    parent: "finanzas",
    fields: {
      "Con quién": { type: "relation", to: "persona", many: true },
      Paga: { type: "relation", to: "finanzas" },
    },
  },
  { key: "archivos", name: "Archivos", folder: "", files: true },
];
const NOTES: Record<string, string | Uint8Array> = {
  "personas/ana.md": "# Ana Ejemplo\n",
  "proyectos/a.md": '---\nPersona: "[[ana]]"\nInicio: "2026-09-01"\n---\n# Proyecto A\n',
  "proyectos/b.md": '---\nPersona: "[[ana]]"\nInicio: "2026-10-01"\n---\n# Proyecto B\n',
  "finanzas/deudas/d.md": "# Deuda de Ana\n",
  "finanzas/movimientos/m.md": '---\nCon quién: ["[[ana]]"]\nPaga: "[[d]]"\n---\n# Bizum de Ana\n',
  "adjuntos/foto.png": new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
  "adjuntos/rubrica.pdf": "%PDF-1.4 inventado",
};

const stores: UserStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
function fresh() {
  const store = openUserStore(":memory:");
  stores.push(store);
  const ids = seed(store, TYPES, NOTES);
  return { store, id: (path: string) => ids.get(path) as string };
}

describe("what points to a record («Relacionado»)", () => {
  it("by collection and field, newest first, with the titles of what the record itself points to", () => {
    const { store, id } = fresh();
    const r = relatedTo(store, id("personas/ana.md"));
    expect(r.groups.map((g) => [g.collection, g.fieldName, g.count])).toEqual([
      ["Movimiento", "Con quién", 1],
      ["Proyecto", "Persona", 2],
    ]);
    expect(r.groups[1]?.rows).toEqual([
      { id: id("proyectos/b.md"), title: "Proyecto B", date: "2026-10-01" },
      { id: id("proyectos/a.md"), title: "Proyecto A", date: "2026-09-01" },
    ]);
    expect(relatedTo(store, id("finanzas/movimientos/m.md")).titles).toEqual({
      [id("personas/ana.md")]: "Ana Ejemplo",
      [id("finanzas/deudas/d.md")]: "Deuda de Ana",
    });
  });

  it("a relation to a mother counts for the records of her branch (D-18); an archived one does not", () => {
    const { store, id } = fresh();
    const debt = id("finanzas/deudas/d.md");
    expect(relatedTo(store, debt).groups.map((g) => [g.collection, g.fieldName])).toEqual([
      ["Movimiento", "Paga"],
    ]);
    const paga = store.schema().types.t_movimiento?.fields.find((f) => f.name === "Paga");
    store.applySchema(
      { op: "archive_field", type: "t_movimiento", field: paga?.id as string, archived: true },
      { actor: "user" },
    );
    expect(relatedTo(store, debt).groups).toEqual([]);
  });

  it("a record in the trash has nothing to show", () => {
    const { store, id } = fresh();
    store.remove(id("personas/ana.md"), { actor: "user" });
    expect(() => relatedTo(store, id("personas/ana.md"))).toThrow(DataError);
  });
});

describe("how a collection's rows show «Relacionado»", () => {
  it("open or not, and its groups folded one by one, kept for the collection; anything else is refused", () => {
    const { store } = fresh();
    expect(rowUiOf(store, "t_proyecto")).toMatchObject({ related: false, folded: [] });
    expect(
      setRowUi(store, "t_proyecto", { related: true, folded: ["t_tarea:f_proyecto"] }),
    ).toMatchObject({
      related: true,
      folded: ["t_tarea:f_proyecto"],
    });
    expect(rowUiOf(store, "t_proyecto")).toMatchObject({
      related: true,
      folded: ["t_tarea:f_proyecto"],
    });
    expect(setRowUi(store, "t_proyecto", { related: "sí" })).toEqual({
      status: 400,
      error: "bad-related",
    });
    expect(setRowUi(store, "t_proyecto", { folded: ["<script>"] })).toEqual({
      status: 400,
      error: "bad-folded",
    });
  });
});

describe("an image in a note's text", () => {
  it("comes as data a page can paint; any other file does not", () => {
    const { store, id } = fresh();
    const sha = (path: string) => store.get(id(path))?.entity.values.f_boni_file as string;
    expect(fileInline(store, sha("adjuntos/foto.png"))).toEqual({
      mime: "image/png",
      data: Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString("base64"),
    });
    expect(fileInline(store, sha("adjuntos/rubrica.pdf"))).toBeNull();
    expect(fileInline(store, "../../etc")).toBeNull();
  });
});

describe("a file pasted or dropped into a page", () => {
  const png = Buffer.from([137, 80, 78, 71, 9, 9, 9]).toString("base64");
  it("goes to the only collection of files, as a row titled by its name", () => {
    const { store } = fresh();
    const r = addFile(store, { name: "captura.png", data: png }, "portatil");
    expect(r).toMatchObject({ name: "captura.png", type: "t_archivos" });
    const row = store.get((r as { id: string }).id)?.entity;
    expect(fileInline(store, row?.values.f_boni_file as string)?.mime).toBe("image/png");
    expect(addFile(store, { name: "../x.png", data: png })).toEqual({
      status: 400,
      error: "bad-name",
    });
    expect(addFile(store, { name: "x.png", data: "no es base64!" })).toEqual({
      status: 400,
      error: "bad-data",
    });
  });

  it("with several, the app asks once and the account keeps the answer", () => {
    const store = openUserStore(":memory:");
    stores.push(store);
    seed(
      store,
      [
        { key: "adjuntos", name: "Adjuntos", folder: "adjuntos/", files: true },
        { key: "fotos", name: "Fotos", folder: "fotos/", files: true },
      ],
      { "adjuntos/a.pdf": "%PDF inventado", "fotos/b.png": "png inventado" },
    );
    expect(addFile(store, { name: "c.png", data: png })).toEqual({
      status: 409,
      error: "choose",
      options: [
        { type: "t_adjuntos", name: "Adjuntos" },
        { type: "t_fotos", name: "Fotos" },
      ],
    });
    expect(addFile(store, { name: "c.png", data: png, into: "t_nada" })).toEqual({
      status: 400,
      error: "bad-into",
    });
    expect(
      addFile(store, { name: "c.png", data: png, into: "t_fotos", remember: true }),
    ).toMatchObject({
      type: "t_fotos",
    });
    expect(store.setting(FILES_INTO)).toBe("t_fotos");
    expect(addFile(store, { name: "d.png", data: png })).toMatchObject({ type: "t_fotos" });
  });
});
