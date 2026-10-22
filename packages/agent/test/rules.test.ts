import { label, type TypeDef } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { readStore } from "../src/tools.ts";

/** A part of a collection with its own level (Juan, 2026-10-22): what the models see, row by row. */
const L = label("user", "personal", [{ kind: "user-edit", id: "test" }]);
const MOV: TypeDef = {
  id: "t_mov",
  key: "movimiento",
  name: "Movimientos",
  titleField: "f_concepto",
  sensitivity: "personal",
  schemaVersion: 1,
  label: L,
  fields: [
    { id: "f_concepto", key: "concepto", name: "Concepto", type: "text", label: L },
    {
      id: "f_cat",
      key: "cat",
      name: "Categoría",
      type: "select",
      label: L,
      options: [
        { id: "o_salud", name: "Salud", label: L },
        { id: "o_comida", name: "Comida", label: L },
      ],
    },
  ],
};
const stores: UserStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});
function env() {
  const store = openUserStore(":memory:");
  stores.push(store);
  store.applySchema({ op: "create_type", type: MOV }, { actor: "user" });
  const add = (concepto: string, cat: string) =>
    store.create(
      "t_mov",
      { f_concepto: { value: concepto, label: L }, f_cat: { value: cat, label: L } },
      { actor: "user" },
    ).entity.id;
  const ids = { medico: add("Médico inventado", "o_salud"), pan: add("Pan", "o_comida") };
  return { store, ids, ro: readStore(store) };
}
const salud = [{ field: "f_cat", op: "is", value: "o_salud" }];
const titles = (ro: ReturnType<typeof readStore>) =>
  ro
    .list("t_mov")
    .map((e) => e.entity.values.f_concepto)
    .sort();

describe("protection rules: a part of a collection with its own level", () => {
  it("a visible collection with its health rows restricted: those rows do not exist for the AI", () => {
    const { store, ids, ro } = env();
    store.setAiRule({ type: "t_mov", filter: salud, level: "restricted" }, "portatil");
    expect(titles(ro)).toEqual(["Pan"]);
    expect(ro.get(ids.medico)).toBeNull();
    expect(ro.search("Médico")).toEqual([]);
    expect(ro.schema().types.t_mov).toBeDefined();
  });

  it("a restricted collection with one part open: only that part is there, the collection too", () => {
    const { store, ids, ro } = env();
    store.setAiAccess("t_mov", "restricted", "portatil");
    expect(ro.schema().types.t_mov).toBeUndefined();
    store.setAiRule(
      {
        type: "t_mov",
        filter: [{ field: "f_cat", op: "is", value: "o_comida" }],
        level: "visible",
      },
      "portatil",
    );
    expect(ro.schema().types.t_mov).toBeDefined();
    expect(titles(ro)).toEqual(["Pan"]);
    expect(ro.get(ids.medico)).toBeNull();
  });

  it("an opaque part keeps its values from every model; the most closed rule wins", () => {
    const { store, ids, ro } = env();
    store.setAiRule({ type: "t_mov", filter: salud, level: "opaque" }, "portatil");
    expect(ro.get(ids.medico)?.labels.f_concepto?.noModel).toBe(true);
    expect(ro.get(ids.pan)?.labels.f_concepto?.noModel).toBeUndefined();
    store.setAiRule(
      {
        type: "t_mov",
        filter: [{ field: "f_concepto", op: "contains", value: "medico" }],
        level: "private",
      },
      "portatil",
    );
    expect(ro.get(ids.medico)).toBeNull();
  });

  it("a rule that cannot be read closes when it closes and opens nothing when it opens", () => {
    const { store, ids, ro } = env();
    store.setAiRule(
      { type: "t_mov", filter: [{ field: "f_gone", op: "is", value: "x" }], level: "restricted" },
      "portatil",
    );
    expect(titles(ro)).toEqual([]);
    const { store: s2, ro: ro2 } = env();
    s2.setAiAccess("t_mov", "restricted", "portatil");
    s2.setAiRule(
      { type: "t_mov", filter: [{ field: "f_gone", op: "is", value: "x" }], level: "visible" },
      "p",
    );
    s2.setAiRule({ type: "t_mov", filter: [{ nonsense: true }], level: "visible" }, "p");
    expect(titles(ro2)).toEqual([]);
    expect(ids.medico).toBeTruthy();
  });

  it("whatever lowers something private needs an unlock", () => {
    const { store } = env();
    const id = store.setAiRule({ type: "t_mov", filter: salud, level: "private" }, "portatil");
    expect(() =>
      store.setAiRule({ id, type: "t_mov", filter: salud, level: "visible" }, "p"),
    ).toThrow(/unlock/);
    expect(() => store.removeAiRule(id, "p")).toThrow(/unlock/);
    store.removeAiRule(id, "p", { unlock: true });
    store.setAiAccess("t_mov", "private", "portatil");
    expect(() => store.setAiRule({ type: "t_mov", filter: salud, level: "opaque" }, "p")).toThrow(
      /unlock/,
    );
    expect(store.setAiRule({ type: "t_mov", filter: salud, level: "private" }, "p")).toMatch(/^r/);
    expect(store.aiRules()).toHaveLength(1);
  });
});
