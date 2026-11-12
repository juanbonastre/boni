/** Boni's screen replies as the app reads them (F9, docs/sistema.md §4.7, A-23): only what the code gave chooses. */
import { describe, expect, it } from "vitest";
import type { DataType, Painted, Reply } from "./agent.ts";
import { filterOf, litKeys, litNames } from "./screenReplies.ts";

const v = (value: unknown, integrity: string): Painted =>
  ({ t: "v", value, integrity, sensitivity: "public" }) as Painted;
const libros = {
  id: "t_libro",
  key: "libros",
  name: "Libros",
  titleField: "f_titulo",
  fields: [
    { id: "f_titulo", key: "titulo", name: "Título", type: "text" },
    { id: "f_estado", key: "estado", name: "Estado", type: "select" },
  ],
} as unknown as DataType;
const reply = (component: string, data: Record<string, Painted>) =>
  ({ component, data }) as unknown as Reply;

describe("Boni's filter, as a reply gives it", () => {
  const rules = [{ field: "f_estado", op: "is", value: "o_leido" }];
  it("is its collection's, by the rules the server made, with its caption", () => {
    expect(
      filterOf(
        reply("filter", {
          collection: v("libros", "model"),
          rules: v(rules, "own"),
          caption: v("Leídos", "model"),
        }),
        [libros],
      ),
    ).toEqual({ type: libros, rules, caption: "Leídos" });
  });
  it("is none when something of it came from outside, names a field it lacks or an operation there is not", () => {
    const of = (data: Record<string, Painted>) => filterOf(reply("filter", data), [libros]);
    expect(of({ collection: v("libros", "external"), rules: v(rules, "own") })).toBeNull();
    expect(of({ collection: v("libros", "model"), rules: v(rules, "external") })).toBeNull();
    expect(of({ collection: v("otra", "model"), rules: v(rules, "own") })).toBeNull();
    expect(
      of({ collection: v("libros", "model"), rules: v([{ field: "f_x", op: "is" }], "own") }),
    ).toBeNull();
    expect(
      of({
        collection: v("libros", "model"),
        rules: v([{ field: "f_estado", op: "like" }], "own"),
      }),
    ).toBeNull();
    expect(of({ collection: v("libros", "model"), rules: v([], "own") })).toBeNull();
  });
  it("reads a group of rules (task 75), and is none when the group is not one", () => {
    const of = (items: unknown[]) =>
      filterOf(reply("filter", { collection: v("libros", "model"), rules: v(items, "own") }), [
        libros,
      ])?.rules ?? null;
    const group = {
      join: "or",
      rules: [
        { field: "f_estado", op: "is", value: "o_leido" },
        { field: "f_titulo", op: "contains", value: "ray" },
      ],
    };
    expect(of([...rules, group])).toEqual([...rules, group]);
    expect(of([{ ...group, join: "xor" }])).toBeNull();
    expect(of([{ join: "or", rules: [] }])).toBeNull();
    expect(of([{ join: "or", rules: [{ field: "f_x", op: "is" }] }])).toBeNull();
    expect(of([{ join: "or", rules: [group] }])).toBeNull();
    expect(of([{ join: "or", rules: Array(11).fill(rules[0]) }])).toBeNull();
  });
});

describe("what Boni lights", () => {
  const list = (...items: Painted[]) => ({ t: "list", items }) as unknown as Painted;
  it("is the keys the server gave, its own only, twenty at most; its names as text", () => {
    const r = reply("highlight", {
      at: list(v("row:r3", "own"), v("row:r9", "model"), v("row:r4", "external"), v(7, "own")),
      names: list(v("Pedro Páramo", "external")),
    });
    expect(litKeys(r)).toEqual(["row:r3"]);
    expect(litNames(r)).toEqual(["Pedro Páramo"]);
    const many = reply("highlight", {
      at: list(...Array.from({ length: 30 }, (_, i) => v(`row:r${i}`, "own"))),
    });
    expect(litKeys(many)).toHaveLength(20);
    expect(litKeys(reply("highlight", { at: v("row:r3", "own") }))).toEqual([]);
  });
});
