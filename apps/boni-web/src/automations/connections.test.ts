/** What a step's connections say on the screen (connections.ts): the table's rows, the chip, the sentence, the card's mark and «Haría esto». */
import { type Connection, newConnection, type Step } from "@boni/automations";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import type { CodeWould } from "./client.ts";
import {
  changeMark,
  chipWords,
  connectionRows,
  connectionsSentence,
  wouldLines,
} from "./connections.ts";
import {
  allowAction,
  connectCollection,
  disconnectCollection,
  setCell,
  setReadLimits,
} from "./edit.ts";

const t = translator("es");
const en = translator("en");
const NAMES: Record<string, string> = {
  gastos: "Gastos",
  notas: "Notas",
  libros: "Libros",
  autores: "Autores",
};
const nameOf = (key: string) => NAMES[key] ?? key;
const context = {
  collectionNamed: (name: string) => Object.keys(NAMES).find((k) => NAMES[k] === name),
  collectionName: (key: string) => NAMES[key],
};
const conn = (collection: string, more: Partial<Connection> = {}): Connection => ({
  ...newConnection(collection),
  ...more,
});
const codeStep = (source: string, connections: Connection[] = []): Step => ({
  id: "s_codigo",
  name: "Código",
  type: "code",
  params: { source },
  ...(connections.length ? { connections } : {}),
});
const collectionStep = (action: string): Step => ({
  id: "s_coleccion",
  name: "Colección",
  type: "collection",
  params: { action, collection: "gastos" },
});

describe("a connection's chip and sentence", () => {
  it("AU-40 · AU-178 · the chip says what the connection can save: «Solo lee», «Lee · con filtro», «Lee y modifica · pregunta antes», «Lee, crea y modifica · pregunta antes de modificar», from its cells and the words of i18n.ts", () => {
    expect(chipWords(t, conn("gastos"), "es-ES")).toBe("Solo lee");
    expect(
      chipWords(t, conn("gastos", { read: { where: [{ field: "importe" } as never] } }), "es-ES"),
    ).toBe("Lee · con filtro");
    expect(chipWords(t, conn("gastos", { read: { limit: 12500 } }), "es-ES")).toBe(
      "Lee · hasta 12.500 filas",
    );
    expect(chipWords(t, conn("gastos", { update: { mode: "ask" } }), "es-ES")).toBe(
      "Lee y modifica · pregunta antes",
    );
    expect(
      chipWords(t, conn("gastos", { create: { mode: "ask" }, update: { mode: "ask" } }), "es-ES"),
    ).toBe("Lee, crea y modifica · pregunta antes");
    expect(
      chipWords(t, conn("gastos", { create: { mode: "yes" }, update: { mode: "ask" } }), "es-ES"),
    ).toBe("Lee, crea y modifica · pregunta antes de modificar");
    expect(chipWords(en, conn("gastos", { update: { mode: "ask" } }), "en-GB")).toBe(
      "Reads and updates · asks first",
    );
  });
  it("AU-189 · a removal with «Sí» reads «sin preguntar» in the chip, the card's mark and «Haría esto»; creating and modifying with «Sí» add nothing", () => {
    expect(chipWords(t, conn("gastos", { remove: { mode: "yes" } }), "es-ES")).toBe(
      "Lee y elimina · sin preguntar",
    );
    expect(
      chipWords(t, conn("gastos", { update: { mode: "ask" }, remove: { mode: "yes" } }), "es-ES"),
    ).toBe("Lee, modifica y elimina · pregunta antes de modificar · elimina sin preguntar");
    expect(chipWords(t, conn("gastos", { create: { mode: "yes" } }), "es-ES")).toBe("Lee y crea");
    const removes = codeStep("$col('Gastos').remove('x')", [
      conn("gastos", { remove: { mode: "yes" } }),
    ]);
    expect(changeMark(t, removes, context, nameOf)).toBe("Elimina en Gastos · sin preguntar");
    const updates = codeStep("$col('Gastos').update('x', { a: 1 })", [
      conn("gastos", { update: { mode: "yes" } }),
    ]);
    expect(changeMark(t, updates, context, nameOf)).toBe("Modifica Gastos");
    const would = (asks: boolean): CodeWould => ({
      asks,
      counts: [{ collection: "gastos", action: "remove", n: 2 }],
      records: [],
    });
    expect(wouldLines(t, would(false), "es-ES", nameOf)).toEqual([
      "Eliminaría 2 filas en Gastos · sin preguntar",
    ]);
    expect(wouldLines(t, would(true), "es-ES", nameOf)).toEqual(["Eliminaría 2 filas en Gastos"]);
  });
  it("AU-44 · the sentence under the table says what the code can do and what it cannot, with connections that do the same said together: «Puede leer Libros (con filtro) y Autores. No puede crear, modificar ni eliminar nada.»", () => {
    const reads = [conn("libros", { read: { where: [{ field: "x" } as never] } }), conn("autores")];
    expect(connectionsSentence(t, reads, nameOf)).toBe(
      "Puede leer Libros (con filtro) y Autores. No puede crear, modificar ni eliminar nada.",
    );
    const mixed = [conn("autores"), conn("gastos", { update: { mode: "ask" } })];
    expect(connectionsSentence(t, mixed, nameOf)).toBe(
      "Puede leer Autores, y leer y modificar Gastos. No puede crear ni eliminar nada.",
    );
    const all = [
      conn("gastos", { create: { mode: "ask" }, update: { mode: "yes" }, remove: { mode: "ask" } }),
    ];
    expect(connectionsSentence(t, all, nameOf)).toBe(
      "Puede leer, crear, modificar y eliminar Gastos.",
    );
    expect(connectionsSentence(t, [], nameOf)).toBe("");
  });
});

describe("the connections' table", () => {
  it("AU-41 · AU-179 · one row per connection with its three write cells, each saying whether the code uses it («lo usa», «sin usar»); a cell used and not allowed is the problem (AU-176)", () => {
    const step = codeStep(
      "$col('Gastos').update('x', { a: 1 })\n$col('Gastos').create({ a: 2 })\nreturn []",
      [conn("gastos", { update: { mode: "ask" }, remove: { mode: "yes" } }), conn("libros")],
    );
    const rows = connectionRows(t, step, context, "es-ES");
    expect(rows.map((r) => r.name)).toEqual(["Gastos", "Libros"]);
    expect(rows[0]?.cells).toEqual([
      { action: "create", cell: false, used: true, missing: true },
      { action: "update", cell: "ask", used: true, missing: false },
      { action: "remove", cell: "yes", used: false, missing: false },
    ]);
    expect(rows[1]?.cells.every((c) => !c.used && !c.missing && c.cell === false)).toBe(true);
  });
  it("AU-176 · «Permitir» sets the cell the code uses to «Preguntar», never «Sí», and the problem goes; a cell already allowed stays as it is", () => {
    const source = "$col('Gastos').create({ a: 2 })\nreturn []";
    let draft = {
      format: 1,
      id: "a_01jejemplo",
      version: 0,
      name: "Guardar gastos",
      steps: [codeStep(source)],
      arrows: [],
      settings: {},
    } as never as Parameters<typeof connectCollection>[0];
    draft = connectCollection(draft, "s_codigo", "gastos");
    const before = connectionRows(t, draft.steps[0] as Step, context, "es-ES");
    expect(before[0]?.cells[0]?.missing).toBe(true);
    draft = allowAction(draft, "s_codigo", "gastos", "create");
    const step = draft.steps[0] as Step;
    expect(step.connections?.[0]?.create).toEqual({ mode: "ask" });
    expect(connectionRows(t, step, context, "es-ES")[0]?.cells[0]?.missing).toBe(false);
    const yes = setCell(draft, "s_codigo", "gastos", "create", "yes");
    expect(allowAction(yes, "s_codigo", "gastos", "create")).toBe(yes);
  });
});

describe("the card's mark", () => {
  it("AU-180 · the card says what the step changes, the same for a «Colección» step and a «Código»: «Modifica Gastos», «Crea y modifica Gastos», «Cambia Gastos y Notas», and nothing for one that only reads", () => {
    expect(changeMark(t, collectionStep("update"), context, nameOf)).toBe("Modifica Gastos");
    const both = codeStep(
      "$col('Gastos').create({ a: 1 })\n$col('Gastos').update('x', { a: 2 })\nreturn []",
      [conn("gastos", { create: { mode: "ask" }, update: { mode: "ask" } })],
    );
    expect(changeMark(t, both, context, nameOf)).toBe("Crea y modifica Gastos");
    const two = codeStep(
      "$col('Gastos').update('x', { a: 1 })\n$col('Notas').create({ texto: 'resumen' })\nreturn []",
    );
    expect(changeMark(t, two, context, nameOf)).toBe("Cambia Gastos y Notas");
    expect(changeMark(t, collectionStep("find"), context, nameOf)).toBe("");
    expect(
      changeMark(t, codeStep("return $col('Gastos').find()", [conn("gastos")]), context, nameOf),
    ).toBe("");
    // A request to a collection that does not exist changes nothing: its problem says so in the editor.
    expect(changeMark(t, codeStep("$col('Otra').update('x', {})"), context, nameOf)).toBe("");
  });
  it("AU-181 · «Haría esto» of a «Código» says one line per collection and action, with the count in the person's numbers", () => {
    const would: CodeWould = {
      asks: true,
      counts: [
        { collection: "gastos", action: "update", n: 3000 },
        { collection: "notas", action: "create", n: 1 },
      ],
      records: [],
    };
    expect(wouldLines(t, would, "es-ES", nameOf)).toEqual([
      "Modificaría 3000 filas en Gastos",
      "Crearía 1 fila en Notas",
    ]);
  });
});

describe("editing a connection", () => {
  const draftWith = (connections: Connection[]) =>
    ({
      format: 1,
      id: "a_01jejemplo",
      version: 0,
      name: "Guardar gastos",
      steps: [codeStep("return []", connections)],
      arrows: [],
      settings: {},
    }) as never as Parameters<typeof connectCollection>[0];
  const first = (d: ReturnType<typeof draftWith>) => d.steps[0]?.connections;
  it("AU-41 · each write cell is set on its own to «No», «Preguntar» or «Sí», and a cell set again keeps what else it had", () => {
    let d = draftWith([conn("gastos")]);
    d = setCell(d, "s_codigo", "gastos", "update", "yes");
    expect(first(d)?.[0]).toMatchObject({ create: false, update: { mode: "yes" }, remove: false });
    d = setCell(d, "s_codigo", "gastos", "update", "ask");
    expect(first(d)?.[0]?.update).toEqual({ mode: "ask" });
    d = setCell(d, "s_codigo", "gastos", "update", false);
    expect(first(d)?.[0]?.update).toBe(false);
    // A collection the step is not connected to leaves the draft as it was.
    expect(setCell(d, "s_codigo", "notas", "create", "ask")).toBe(d);
  });
  it("AU-43 · a connection's read limits: an empty filter, all the fields or no limit is not saved; «Desconectar» takes the connection out, and the list with it when it was the last", () => {
    let d = draftWith([conn("gastos"), conn("notas")]);
    d = setReadLimits(d, "s_codigo", "gastos", { limit: 200, fields: ["importe"] });
    expect(first(d)?.[0]?.read).toEqual({ limit: 200, fields: ["importe"] });
    d = setReadLimits(d, "s_codigo", "gastos", { limit: undefined, where: [] });
    expect(first(d)?.[0]?.read).toEqual({ fields: ["importe"] });
    d = setReadLimits(d, "s_codigo", "gastos", { fields: undefined });
    expect(first(d)?.[0]?.read).toEqual({});
    d = disconnectCollection(d, "s_codigo", "gastos");
    expect(first(d)?.map((c) => c.collection)).toEqual(["notas"]);
    d = disconnectCollection(d, "s_codigo", "notas");
    expect(d.steps[0]).not.toHaveProperty("connections");
  });
});
