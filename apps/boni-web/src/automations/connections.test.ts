/** What a step's connections say on the screen (connections.ts): the table's rows, the chip, the sentence, the card's mark and «Haría esto». */
import {
  AGENT_TYPE,
  type AgentLine,
  type Connection,
  newConnection,
  type Step,
} from "@boni/automations";
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import type { CodeWould } from "./client.ts";
import {
  agentConnectable,
  changeMark,
  chipWords,
  connectionRows,
  connectionsSentence,
  DID_UNITS,
  didLines,
  wouldLines,
  writeLimitsOf,
} from "./connections.ts";
import {
  allowAction,
  connectCollection,
  disconnectCollection,
  fieldFills,
  setCell,
  setFixedValue,
  setRead,
  setReadLimits,
  setWriteField,
  setWriteLimits,
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
      { action: "create", cell: false, used: true, missing: true, limits: [] },
      { action: "update", cell: "ask", used: true, missing: false, limits: [] },
      { action: "remove", cell: "yes", used: false, missing: false, limits: [] },
    ]);
    expect(rows[0]?.reads).toBe(true);
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

describe("an «Agente»'s connections", () => {
  const agentStep = (connections: Connection[] = []): Step => ({
    id: "s_analista",
    name: "Analista",
    type: AGENT_TYPE,
    params: { instructions: "Propón una nota con lo gastado" },
    ...(connections.length ? { connections } : {}),
  });
  const draftWith = (connections: Connection[]) =>
    ({
      format: 1,
      id: "a_01jejemplo",
      version: 0,
      name: "Analista de gastos",
      steps: [agentStep(connections)],
      arrows: [],
      settings: {},
    }) as never as Parameters<typeof connectCollection>[0];
  const first = (d: ReturnType<typeof draftWith>) => d.steps[0]?.connections?.[0];
  it("AU-196 · a write cell of an «Agente» is born with «Como mucho 20» when the hand takes it out of «No», and says it in its cell («hasta 20»); a «Código»'s is born with none; set again it keeps its limit", () => {
    let d = draftWith([conn("notas")]);
    d = setCell(d, "s_analista", "notas", "create", "ask");
    expect(first(d)?.create).toEqual({ mode: "ask", limit: 20 });
    expect(writeLimitsOf(t, first(d) as Connection, "create", "es-ES")).toEqual(["hasta 20"]);
    d = setCell(d, "s_analista", "notas", "create", "yes");
    expect(first(d)?.create).toEqual({ mode: "yes", limit: 20 });
    const code = {
      ...draftWith([]),
      steps: [codeStep("return []", [conn("notas")])],
    } as ReturnType<typeof draftWith>;
    expect(setCell(code, "s_codigo", "notas", "create", "ask").steps[0]?.connections?.[0]).toEqual(
      expect.objectContaining({ create: { mode: "ask" } }),
    );
    // «Como mucho» is changed or taken away in the open row; it is never 0 or over 5.000 (the field's bounds).
    d = setWriteLimits(d, "s_analista", "notas", "create", { limit: 5 });
    expect(first(d)?.create).toEqual({ mode: "yes", limit: 5 });
    d = setWriteLimits(d, "s_analista", "notas", "create", { limit: undefined });
    expect(first(d)?.create).toEqual({ mode: "yes" });
  });
  it("AU-48 · each write action keeps its own limits: «Solo estas filas» for modify and remove, the fields for create and modify, «Como mucho» for the three; a key that is not the action's is not saved, nor an empty one; the cell says them («Preguntar · con filtro · hasta 20»)", () => {
    let d = draftWith([conn("gastos", { update: { mode: "ask", limit: 20 } })]);
    const where = [{ field: "categoria", op: "empty" }] as never;
    d = setWriteLimits(d, "s_analista", "gastos", "update", { where, fields: ["categoria"] });
    expect(first(d)?.update).toEqual({ mode: "ask", limit: 20, where, fields: ["categoria"] });
    expect(writeLimitsOf(t, first(d) as Connection, "update", "es-ES")).toEqual([
      "con filtro",
      "1 campo",
      "hasta 20",
    ]);
    d = setWriteLimits(d, "s_analista", "gastos", "update", { where: [] });
    expect(first(d)?.update).toEqual({ mode: "ask", limit: 20, fields: ["categoria"] });
    // Create has no filter, remove no fields; a cell at «No» is left as it is.
    d = setCell(d, "s_analista", "gastos", "create", "ask");
    d = setWriteLimits(d, "s_analista", "gastos", "create", { where });
    expect(first(d)?.create).toEqual({ mode: "ask", limit: 20 });
    d = setCell(d, "s_analista", "gastos", "remove", "ask");
    d = setWriteLimits(d, "s_analista", "gastos", "remove", { fields: ["x"], where });
    expect(first(d)?.remove).toEqual({ mode: "ask", limit: 20, where });
    d = setCell(d, "s_analista", "gastos", "remove", false);
    expect(setWriteLimits(d, "s_analista", "gastos", "remove", { where })).toEqual(d);
    // «Leer» of an «Agente» can be «No»: its limits go with it, and «Sí» reads all again.
    d = setReadLimits(d, "s_analista", "gastos", { limit: 200 });
    d = setRead(d, "s_analista", "gastos", false);
    expect(first(d)?.read).toBe(false);
    d = setRead(d, "s_analista", "gastos", true);
    expect(first(d)?.read).toEqual({});
  });
  it("AU-52 · each field under «Crear» and «Modificar» is «No lo escribe», «Decidido por un modelo» or «Fijo» with its value: `fields` are the AI's and `fixed` the fixed ones, never both; all the AI's saves no list; a field that leaves the AI loses its line", () => {
    const keys = ["titulo", "importe", "categoria"];
    let d = draftWith([conn("notas", { create: { mode: "ask", limit: 20 } })]);
    const cell = () => first(d)?.create as Exclude<Connection["create"], false>;
    expect(fieldFills(cell(), keys)).toEqual({ titulo: "ai", importe: "ai", categoria: "ai" });
    d = setWriteField(d, "s_analista", "notas", "create", keys, "categoria", "fixed", "Revisar");
    expect(cell()).toEqual({
      mode: "ask",
      limit: 20,
      fields: ["titulo", "importe"],
      fixed: { categoria: "Revisar" },
    });
    d = setWriteField(d, "s_analista", "notas", "create", keys, "importe", "none");
    expect(fieldFills(cell(), keys)).toEqual({
      titulo: "ai",
      importe: "none",
      categoria: "fixed",
    });
    d = setFixedValue(d, "s_analista", "notas", "create", "categoria", "Hecha");
    expect(cell().fixed).toEqual({ categoria: "Hecha" });
    // A value for a field that is not fixed changes nothing.
    expect(setFixedValue(d, "s_analista", "notas", "create", "titulo", "x")).toBe(d);
    // A line goes with its field when the field leaves the AI.
    d = setWriteLimits(d, "s_analista", "notas", "create", {
      lines: { titulo: "Un título corto" },
    });
    d = setWriteField(d, "s_analista", "notas", "create", keys, "titulo", "none");
    expect(cell().lines).toBeUndefined();
    // Back to all the AI's: no list, no fixed values.
    for (const k of keys) d = setWriteField(d, "s_analista", "notas", "create", keys, k, "ai");
    expect(cell()).toEqual({ mode: "ask", limit: 20 });
  });
  it("AU-200 · the chip and the sentence of an «Agente» say «decidido por un modelo» on what it may write, and each write's «Como mucho»; one that only reads says nothing of it", () => {
    const notas = conn("notas", { create: { mode: "ask", limit: 20 } });
    expect(chipWords(t, notas, "es-ES", AGENT_TYPE)).toBe(
      "Lee y crea · pregunta antes · decidido por un modelo",
    );
    expect(chipWords(t, notas, "es-ES")).toBe("Lee y crea · pregunta antes");
    expect(chipWords(t, conn("gastos"), "es-ES", AGENT_TYPE)).toBe("Solo lee");
    expect(chipWords(t, conn("gastos", { read: false }), "es-ES", AGENT_TYPE)).toBe("No");
    expect(connectionsSentence(t, [conn("gastos"), notas], nameOf, AGENT_TYPE, "es-ES")).toBe(
      "Puede leer Gastos, y leer y crear Notas (como mucho 20): decidido por un modelo. No puede modificar ni eliminar nada.",
    );
    expect(connectionsSentence(t, [conn("gastos")], nameOf, AGENT_TYPE, "es-ES")).toBe(
      "Puede leer Gastos. No puede crear, modificar ni eliminar nada.",
    );
  });
  it("AU-166 · «Conectar» of an «Agente» never offers a collection no model may read (any level but «visible»), nor Boni's own, nor one already connected", () => {
    const collections = [
      { key: "gastos", name: "Gastos", level: "visible" },
      { key: "documentos", name: "Documentos", level: "private" },
      { key: "salud", name: "Salud", level: "opaque" },
      { key: "claves", name: "Claves", level: "restricted" },
      { key: "registro", name: "Registro", level: "visible", system: true as const },
      { key: "notas", name: "Notas", level: "visible" },
      { name: "Sin clave", level: "visible" },
    ];
    expect(agentConnectable(collections, new Set(["notas"]))).toEqual([
      { key: "gastos", name: "Gastos" },
    ]);
  });
  it("AU-54 · «Lo que hizo» says its cost first («2 rondas · 3 llamadas al modelo · el modelo · 3,6 s»), then each unit's lines from the engine's record: reads with their filter and limit, writes said together, a test's «Propondría…» or «Crearía…» by the cell, refusals by their key, and «y 12 más»", () => {
    const step = agentStep([
      conn("gastos"),
      conn("notas", { create: { mode: "ask", limit: 20 }, remove: { mode: "yes", limit: 20 } }),
    ]);
    const lines: AgentLine[] = [
      { op: "find", collection: "gastos", rows: 41, where: [{ field: "importe" }], limit: 200 },
      { op: "count", collection: "gastos", rows: 1 },
      { op: "create", collection: "notas", state: "tested" },
      { op: "create", collection: "notas", state: "tested" },
      { op: "remove", collection: "notas", state: "tested" },
      { op: "refused", tool: "update", collection: "notas", why: "action-off" },
      { op: "refused", tool: "remove", collection: "notas", why: "over-limit" },
      { op: "refused", tool: "inventada", why: "<b>nuevo</b>" },
      { op: "hidden", field: "Asunto", from: "rows", integrity: "outside" },
    ];
    const did = didLines(
      t,
      {
        ms: 9000,
        agent: { units: [{ rounds: 2, lines, more: 12, seen: [{ at: "r", saw: 50, of: 128 }] }] },
        ai: { calls: 3, models: ["modelo-ejemplo"], ms: 3600, cut: 0 },
      },
      step,
      "es-ES",
      nameOf,
    );
    expect(did?.head).toBe("2 rondas · 3 llamadas al modelo · modelo-ejemplo · 3,6 s");
    expect(did?.units).toEqual([
      {
        title: null,
        lines: [
          "Buscó 41 filas en Gastos · con filtro · hasta 200",
          "Contó 1 fila en Gastos",
          "Propondría 2 filas nuevas en Notas",
          "Eliminaría 1 fila en Notas",
          "Quiso modificar en Notas · su conexión no lo deja",
          "Quiso eliminar en Notas · pasaba de su «como mucho»",
          "Quiso usar «inventada» · no se pudo",
          "No leyó «Asunto» · viene de fuera",
          "Vio 50 de 128 filas",
          "y 12 más",
        ],
      },
    ]);
    // A run: what it saved and what waits, one unit per row with its title; no record, nothing to say.
    const run = didLines(
      t,
      {
        ms: 800,
        agent: {
          units: [0, 1].map((row) => ({
            row,
            rounds: 1,
            more: 0,
            seen: [],
            lines: [
              { op: "create", collection: "notas", state: row ? "applied" : "asked" } as AgentLine,
            ],
          })),
        },
      },
      step,
      "es-ES",
      nameOf,
    );
    expect(run?.head).toBe("2 rondas · 0,8 s");
    expect(run?.units).toEqual([
      { title: "Fila 1", lines: ["Propuso 1 fila nueva en Notas: espera tu permiso"] },
      { title: "Fila 2", lines: ["Creó 1 fila en Notas"] },
    ]);
    expect(run?.more).toBe(0);
    expect(didLines(t, { ms: 10 }, step, "es-ES", nameOf)).toBeNull();
  });
  it("AU-54 · A-15 · «Una vez por fila» over 5.000 rows, each unit with its 50 lines: «Lo que hizo» words the first 20 units and counts the rest, within a frame", () => {
    const step = agentStep([conn("notas", { create: { mode: "ask", limit: 20 } })]);
    const units = Array.from({ length: 5000 }, (_, row) => ({
      row,
      rounds: 2,
      more: 3,
      seen: [],
      lines: Array.from(
        { length: 50 },
        (_, k): AgentLine =>
          k % 2
            ? { op: "find", collection: "notas", rows: k }
            : { op: "create", collection: "notas", state: "tested" },
      ),
    }));
    // The first number formatted in a locale loads its data (about 13 ms, once per process);
    // the app has done that long before the editor opens, so it is done here before timing.
    didLines(t, { ms: 1, agent: { units: units.slice(0, 1) } }, step, "es-ES", nameOf);
    const t0 = cpu();
    const did = didLines(t, { ms: 1, agent: { units } }, step, "es-ES", nameOf);
    const ms = cpu() - t0;
    expect(did?.units).toHaveLength(DID_UNITS);
    expect(did?.more).toBe(5000 - DID_UNITS);
    expect(did?.head).toBe("10.000 rondas · 0,0 s");
    expect(did?.units[19]?.title).toBe("Fila 20");
    expect(did?.units[0]?.lines).toHaveLength(51);
    // Measured here (2026-11-18): 3 to 4 ms.
    under(ms, 16, "cpu", "wording «Lo que hizo» of 5,000 units");
  });
});
