// A step's connections and their limits (docs/automatizaciones.md §5.5; connections.ts). Real tests are pure: the
// format, validation and the narrowing of a read, with rows held here and filtered by the views' own `matchesFilters`.
// What the server reads with it (S1) and a step's print (E3) are tested where they are built. Collection, field and
// row values in them are invented and say nothing of anyone's data (D-14).
import { type FilterItem, matchesFilters } from "@boni/views";
import { describe, expect, it } from "vitest";
import { collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { CODE_LIMITS, CODE_TYPE, CodeFault } from "./code.ts";
import {
  asRead,
  type Connection,
  connectionActions,
  connectionProblems,
  cutRead,
  MAX_CONNECTIONS,
  type NarrowedAsk,
  narrow,
  newConnection,
  permissions,
  type ReadAsk,
} from "./connections.ts";
import { FormatError, parseAutomation, type Step } from "./format.ts";
import { type CodeContext, readCode } from "./javascript.ts";
import { stepPrints } from "./partial.ts";
import { validate } from "./validate.ts";

const next = ids(11);
const orders = collection(next, ["number", "text", "date"]);
const [price, state, day] = orders.fields.map((f) => f.key) as [string, string, string];
const notes = collection(next, ["text"]);
const context = knowing(orders, notes);
/** With a box: «Código» is a type, and `$col` finds collections by these names. */
const withBox: CodeContext = {
  ...context,
  collectionNamed: (name) => ({ Pedidos: orders.key, Notas: notes.key })[name],
};

/** A «Código» (or a step of another type) holding these connections. */
const stepWith = (connections: Connection[], type = CODE_TYPE): Step => ({
  id: "s_1",
  name: "Código",
  type,
  params: type === CODE_TYPE ? { mode: "all", source: "return []" } : {},
  connections,
});
const codes = (problems: readonly { code: string }[]) => problems.map((p) => p.code);

/** Rows of «orders» to read from: every mix of price, state and day the filters below tell apart. */
const ROWS = Array.from({ length: 60 }, (_, i) => ({
  id: `r_${i}`,
  values: {
    [price]: (i * 7) % 100,
    [state]: ["abierto", "cerrado", "pendiente"][i % 3],
    [day]: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
  } as Record<string, unknown>,
}));
const typeOf = (field: string) => orders.fields.find((f) => f.key === field)?.type;
const passes = (values: Record<string, unknown>, where: readonly FilterItem[] | undefined) =>
  matchesFilters(values, typeOf, where ?? [], "2026-11-16", "fail");

/** What a server does with a narrowed ask, in a few lines: filter, cut, give each row as a read gives it. */
function read(ask: NarrowedAsk) {
  const rows = ROWS.filter((r) => passes(r.values, ask.where)).filter(
    (r) => ask.id === undefined || r.id === ask.id,
  );
  if (ask.op === "count") return rows.length;
  if (ask.op === "sum") return rows.reduce((n, r) => n + Number(r.values[ask.field ?? ""] ?? 0), 0);
  return cutRead(rows.slice(0, ask.limit), ask).map((r) => asRead(r.id, r.values, ask));
}

const fault = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    if (e instanceof CodeFault) return { code: e.why.code, detail: e.why.detail };
    throw e;
  }
  throw new Error("no fault");
};

describe("the format", () => {
  it("AU-40 · a step holds its connections in `connections`, one per collection by its key, each saying what it may do there: `parseAutomation` reads them and writes them back the same, and refuses a connection with a key it does not know", () => {
    const s = sketch(3)
      .step("Inicio", "manual", { fields: [] })
      .step("Código", CODE_TYPE, { mode: "all", source: "return []" })
      .arrow("Inicio", "Código");
    const a = s.build();
    const code = a.steps[1] as Step;
    code.connections = [
      {
        ...newConnection(orders.key),
        read: { where: [{ field: state, op: "is", value: "abierto" }], fields: [price], limit: 50 },
      },
      newConnection(notes.key),
      // F15's actions are in the format already: they read and write back, and validation refuses them in F14c.
      {
        collection: "c_otra",
        read: false,
        create: { mode: "ask", fields: [price], fixed: { [state]: "nuevo" } },
        update: { mode: "yes", where: [{ field: price, op: "gt", value: 10 }], fields: [state] },
        remove: { mode: "ask" },
      },
    ];
    const saved = { ...a, version: 1 };
    const back = parseAutomation(JSON.parse(JSON.stringify(saved)));
    expect(back).toEqual(saved);
    expect(parseAutomation(JSON.parse(JSON.stringify(back)))).toEqual(back);
    const wrong = (connection: unknown) => {
      const copy = JSON.parse(JSON.stringify(saved));
      copy.steps[1].connections = [connection];
      return () => parseAutomation(copy);
    };
    expect(wrong({ ...newConnection(orders.key), borrar: true })).toThrow(FormatError);
    expect(wrong({ ...newConnection(orders.key), read: { limit: 5, orden: "precio" } })).toThrow(
      FormatError,
    );
    expect(
      wrong({ ...newConnection(orders.key), read: { where: [{ field: state, op: "parece" }] } }),
    ).toThrow(FormatError);
    expect(wrong({ ...newConnection(orders.key), collection: "" })).toThrow(FormatError);
    expect(wrong({ ...newConnection(orders.key), update: { mode: "siempre" } })).toThrow(
      FormatError,
    );
    // Absent actions are `false`: a connection written short reads back whole.
    const short = JSON.parse(JSON.stringify(saved));
    short.steps[1].connections = [{ collection: notes.key, read: {} }];
    expect(parseAutomation(short).steps[1]?.connections).toEqual([newConnection(notes.key)]);
  });

  it("AU-40 · two connections of one step to the same collection are `connection.repeated`, one to a collection that does not exist `connection.unknown`, more than `MAX_CONNECTIONS` `connection.many`", () => {
    expect(
      connectionProblems(stepWith([newConnection(orders.key), newConnection(notes.key)]), context),
    ).toEqual([]);
    expect(
      connectionProblems(stepWith([newConnection(orders.key), newConnection(orders.key)]), context),
    ).toEqual([
      {
        code: "connection.repeated",
        severity: "error",
        step: "s_1",
        param: "connections",
        detail: { collection: orders.key },
      },
    ]);
    expect(connectionProblems(stepWith([newConnection("c_nadie")]), context)).toMatchObject([
      { code: "connection.unknown", detail: { collection: "c_nadie" } },
    ]);
    const many = Array.from({ length: MAX_CONNECTIONS + 1 }, (_, i) =>
      newConnection(i === 0 ? orders.key : `c_${i}`),
    );
    const problems = connectionProblems(stepWith(many), context);
    expect(problems[0]).toMatchObject({
      code: "connection.many",
      detail: { max: MAX_CONNECTIONS, got: MAX_CONNECTIONS + 1 },
    });
    // The whole automation says the same.
    const s = sketch(3)
      .step("Inicio", "manual", { fields: [] })
      .step("Código", CODE_TYPE, { mode: "all", source: "return []" })
      .arrow("Inicio", "Código");
    const a = s.build();
    (a.steps[1] as Step).connections = [newConnection(orders.key), newConnection(orders.key)];
    expect(codes(validate(a, withBox))).toEqual(["connection.repeated"]);
  });

  it("AU-40 · `permissions` gives one entry per permission, with its filter, its fields and its limit, in the order of the connections: what the chip under the step says («Lee · solo este año»)", () => {
    const where: FilterItem[] = [{ field: day, op: "after", value: "2025-12-31" }];
    const given = permissions([
      { ...newConnection(orders.key), read: { where, limit: 20 } },
      { ...newConnection(notes.key), read: { fields: [notes.fields[0]?.key ?? ""] } },
      {
        collection: "c_otra",
        read: false,
        create: { mode: "ask" },
        update: false,
        remove: { mode: "ask", where },
      },
    ]);
    expect(given).toEqual([
      { collection: orders.key, action: "read", mode: "yes", where, limit: 20 },
      { collection: notes.key, action: "read", mode: "yes", fields: [notes.fields[0]?.key] },
      { collection: "c_otra", action: "create", mode: "ask" },
      { collection: "c_otra", action: "remove", mode: "ask", where },
    ]);
    // An empty filter is no filter.
    expect(permissions([{ ...newConnection(orders.key), read: { where: [] } }])).toEqual([
      { collection: orders.key, action: "read", mode: "yes" },
    ]);
  });

  it("AU-41 · `newConnection` reads with no limits and gives no permission to write; `connectionActions` of «Código» is `read` alone, and a «Código» whose connection creates, modifies or removes is `connection.write`", () => {
    expect(newConnection(orders.key)).toEqual({
      collection: orders.key,
      read: {},
      create: false,
      update: false,
      remove: false,
    });
    expect(connectionActions(CODE_TYPE)).toEqual(["read"]);
    expect(Object.isFrozen(connectionActions(CODE_TYPE))).toBe(true);
    const writes: [Partial<Connection>, string][] = [
      [{ create: { mode: "ask" } }, "create"],
      [{ update: { mode: "yes" } }, "update"],
      [{ remove: { mode: "ask" } }, "remove"],
    ];
    for (const [change, action] of writes)
      expect(
        connectionProblems(stepWith([{ ...newConnection(orders.key), ...change }]), context),
      ).toMatchObject([{ code: "connection.write", detail: { collection: orders.key, action } }]);
  });

  it("AU-41 · a connection never holds `remove` with `yes`, and a limit that is not one (a field the collection does not have, a limit of 0 or over `CODE_LIMITS.readRows`) is `connection.limits` with what is wrong", () => {
    const saved = sketch(3).step("Código", CODE_TYPE, { mode: "all", source: "return []" }).build();
    (saved.steps[0] as Step).connections = [
      { ...newConnection(orders.key), remove: { mode: "yes" as "ask" } },
    ];
    expect(() => parseAutomation(JSON.parse(JSON.stringify({ ...saved, version: 1 })))).toThrow(
      FormatError,
    );
    const limits = (read: Connection["read"]) =>
      connectionProblems(stepWith([{ ...newConnection(orders.key), read }]), context).map(
        (p) => p.detail,
      );
    expect(limits({ fields: [price, "f_nada"] })).toEqual([
      { collection: orders.key, why: "field", field: "f_nada" },
    ]);
    expect(limits({ where: [{ field: "f_nada", op: "is", value: "x" }] })).toEqual([
      { collection: orders.key, why: "field", field: "f_nada" },
    ]);
    expect(limits({ where: [{ field: "id", op: "is", value: "r_1" }] })).toEqual([]);
    for (const got of [0, -1, 1.5, CODE_LIMITS.readRows + 1])
      expect(limits({ limit: got }), String(got)).toEqual([
        { collection: orders.key, why: "limit", got },
      ]);
    expect(limits({ limit: 1 })).toEqual([]);
    expect(limits({ limit: CODE_LIMITS.readRows })).toEqual([]);
  });

  it("AU-46 · only «Código» takes connections in F14c: on any other type of the catalogue a connection is `connection.notAllowed`, and a «Código» with none validates and reads no collection", () => {
    for (const type of ["manual", "collection", "edit", "filter", "if", "group", "join"]) {
      expect(connectionActions(type), type).toEqual([]);
      expect(
        connectionProblems(stepWith([newConnection(orders.key)], type), context),
        type,
      ).toMatchObject([{ code: "connection.notAllowed", param: "connections" }]);
    }
    const s = sketch(3)
      .step("Inicio", "manual", { fields: [] })
      .step("Buscar", "collection", { collection: orders.key, action: "find" })
      .step("Código", CODE_TYPE, { mode: "all", source: "return $input.all()" })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Código");
    const a = s.build();
    (a.steps[1] as Step).connections = [newConnection(orders.key)];
    expect(validate(a, withBox).filter((p) => p.step === s.id("Buscar"))).toMatchObject([
      { code: "connection.notAllowed" },
    ]);
    (a.steps[1] as Step).connections = undefined;
    expect(validate(a, withBox)).toEqual([]);
    expect(connectionProblems(stepWith([]), context)).toEqual([]);
    expect(readCode("return $input.all()", "code").collections).toEqual([]);
  });
});

describe("the limits of reading", () => {
  const open: FilterItem[] = [{ field: state, op: "is", value: "abierto" }];
  const thisYear: FilterItem[] = [{ field: day, op: "after", value: "2026-06-30" }];
  const cheap: FilterItem[] = [{ field: price, op: "lt", value: 40 }];
  const either: FilterItem[] = [
    {
      join: "or",
      rules: [
        { field: state, op: "is", value: "cerrado" },
        { field: price, op: "gt", value: 80 },
      ],
    },
  ];

  it("AU-43 · `narrow` adds the connection's filter with «y» to the one the code asks for: for a table of asks and filters, every row that comes back passes both, and no ask gets a row the connection's filter leaves out, with `get`, `count` and `sum` too", () => {
    const connectionFilters = [undefined, open, thisYear, either];
    const asked = [undefined, cheap, either, [...open, ...thisYear]];
    let checked = 0;
    for (const where of connectionFilters)
      for (const ask of asked) {
        const connection = { ...newConnection(orders.key), read: where ? { where } : {} };
        const wanted = ROWS.filter((r) => passes(r.values, where) && passes(r.values, ask));
        const find = read(
          narrow({ collection: orders.key, op: "find", ...(ask ? { where: ask } : {}) }, [
            connection,
          ]),
        );
        expect((find as { id: string }[]).map((r) => r.id)).toEqual(wanted.map((r) => r.id));
        const count = read(
          narrow({ collection: orders.key, op: "count", ...(ask ? { where: ask } : {}) }, [
            connection,
          ]),
        );
        expect(count).toBe(wanted.length);
        const sum = read(
          narrow(
            { collection: orders.key, op: "sum", field: price, ...(ask ? { where: ask } : {}) },
            [connection],
          ),
        );
        expect(sum).toBe(wanted.reduce((n, r) => n + Number(r.values[price]), 0));
        // `get` of every row: the ones the connection leaves out are not there.
        for (const r of ROWS) {
          const got = read(
            narrow({ collection: orders.key, op: "get", id: r.id }, [connection]),
          ) as unknown[];
          expect(got.length).toBe(passes(r.values, where) ? 1 : 0);
        }
        checked += 1;
      }
    expect(checked).toBe(16);
    // The connection's filter comes first and the ask's after: nothing of the ask replaces it.
    const narrowed = narrow({ collection: orders.key, op: "find", where: cheap }, [
      { ...newConnection(orders.key), read: { where: open } },
    ]);
    expect(narrowed.where).toEqual([...open, ...cheap]);
    // A collection the step reads nothing of: no connection, or one that does not read.
    expect(
      fault(() => narrow({ collection: notes.key, op: "count" }, [newConnection(orders.key)])),
    ).toEqual({
      code: "code.read.notConnected",
      detail: { collection: notes.key },
    });
    expect(
      fault(() =>
        narrow({ collection: orders.key, op: "count" }, [
          { ...newConnection(orders.key), read: false },
        ]),
      ),
    ).toMatchObject({ code: "code.read.notConnected" });
  });

  it("AU-43 · with «Solo estos campos» a row comes back with those fields and its id and no other, and an ask that filters, sorts or sums by a field outside them is `code.read.query` (`hidden`): a hidden field cannot be guessed by asking", () => {
    const connection = { ...newConnection(orders.key), read: { fields: [state] } };
    const rows = read(narrow({ collection: orders.key, op: "find" }, [connection])) as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(ROWS.length);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["id", state].sort());
    // By id and by the fields given, it reads.
    expect(() =>
      narrow(
        {
          collection: orders.key,
          op: "find",
          where: [{ field: "id", op: "is", value: "r_1" }],
          sort: [{ field: state, direction: "asc" }],
        },
        [connection],
      ),
    ).not.toThrow();
    const hidden: ReadAsk[] = [
      { collection: orders.key, op: "find", where: cheap },
      { collection: orders.key, op: "count", where: either },
      { collection: orders.key, op: "find", sort: [{ field: price, direction: "desc" }] },
      { collection: orders.key, op: "sum", field: price },
    ];
    for (const ask of hidden)
      expect(
        fault(() => narrow(ask, [connection])),
        ask.op,
      ).toEqual({
        code: "code.read.query",
        detail: { collection: orders.key, why: "hidden", field: price },
      });
    // A field named `__proto__` is a field: given as one, never the row's prototype.
    const odd = asRead("r_x", JSON.parse('{"__proto__": {"polluted": true}, "a": 1}'), {});
    expect(Object.keys(odd)).toEqual(["id", "__proto__", "a"]);
    expect(Object.getPrototypeOf(odd)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // A value called `id` never replaces the row's id.
    expect(asRead("r_y", { id: "otro", a: 1 }, {})).toEqual({ id: "r_y", a: 1 });
  });

  it("AU-43 · a read gives at most the smaller of the limit the code asks for and the connection's, cut without failing; with neither, or with one over `CODE_LIMITS.readRows`, a read that would give more than it fails with `code.limit` and is never cut, and `count` and `sum` have no such limit", () => {
    const limited = (ask?: number, connection?: number) =>
      narrow({ collection: orders.key, op: "find", ...(ask !== undefined ? { limit: ask } : {}) }, [
        {
          ...newConnection(orders.key),
          read: connection !== undefined ? { limit: connection } : {},
        },
      ]);
    expect(limited(5, 20)).toMatchObject({ limit: 5 });
    expect(limited(30, 20)).toMatchObject({ limit: 20 });
    expect(limited(undefined, 20)).toMatchObject({ limit: 20 });
    expect(limited(5, 20).failsOver).toBeUndefined();
    expect((read(limited(5, 20)) as unknown[]).length).toBe(5);
    expect((read(limited(undefined, 20)) as unknown[]).length).toBe(20);
    const free = limited();
    expect(free).toMatchObject({
      limit: CODE_LIMITS.readRows + 1,
      failsOver: CODE_LIMITS.readRows,
    });
    const rows = Array.from({ length: CODE_LIMITS.readRows + 1 }, (_, i) => i);
    expect(cutRead(rows.slice(0, CODE_LIMITS.readRows), free)).toHaveLength(CODE_LIMITS.readRows);
    expect(fault(() => cutRead(rows, free))).toEqual({
      code: "code.limit",
      detail: { limit: "readRows", max: CODE_LIMITS.readRows, got: CODE_LIMITS.readRows + 1 },
    });
    // Asked for, the same number of rows is cut, not failed.
    expect(cutRead(rows, limited(CODE_LIMITS.readRows))).toHaveLength(CODE_LIMITS.readRows);
    // A limit over the cap does not lift it: the store is asked for one row past it, and more fails as with none.
    for (const asked of [CODE_LIMITS.readRows + 1, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      const over = limited(asked);
      expect(over, String(asked)).toMatchObject({
        limit: CODE_LIMITS.readRows + 1,
        failsOver: CODE_LIMITS.readRows,
      });
      expect(fault(() => cutRead(rows, over))).toMatchObject({ code: "code.limit" });
    }
    expect(limited(1_000_000, 20)).toMatchObject({ limit: 20 });
    for (const op of ["count", "sum"] as const) {
      const n = narrow({ collection: orders.key, op, field: price, limit: 3 }, [
        newConnection(orders.key),
      ]);
      expect(n.limit, op).toBe(Number.MAX_SAFE_INTEGER);
      expect(n.failsOver, op).toBeUndefined();
    }
    expect(
      read(
        narrow({ collection: orders.key, op: "count" }, [
          { ...newConnection(orders.key), read: { limit: 3 } },
        ]),
      ),
    ).toBe(ROWS.length);
  });

  it.todo(
    "AU-43 · a relation of a row read comes as the related row's id, never its fields: the other collection is read only through a connection of its own (S1: the server's read, apps/server/src/automations/box.ts)",
  );
  it("AU-43 · a step's print holds its connections: changing a limit, or connecting or disconnecting a collection, makes its kept test stale (E3: the print of preview.ts)", () => {
    const draft = (connections?: Connection[]) => {
      const s = sketch(12)
        .step("Inicio", "manual", { fields: [] })
        .step("Código", CODE_TYPE, { mode: "all", source: "return $col('Pedidos').find()" })
        .arrow("Inicio", "Código");
      const a = s.build();
      if (connections) (a.steps[1] as Step).connections = connections;
      return { a, code: s.id("Código"), start: s.id("Inicio") };
    };
    const printOf = (connections?: Connection[]) => {
      const { a, code, start } = draft(connections);
      const p = stepPrints(a, {}, (t) => t);
      return { code: p[code], start: p[start] };
    };
    const base = printOf([newConnection(orders.key)]);
    for (const other of [
      [{ ...newConnection(orders.key), read: { limit: 10 } }],
      [{ ...newConnection(orders.key), read: { where: open } }],
      [newConnection(orders.key), newConnection(notes.key)],
      [],
    ]) {
      const p = printOf(other);
      expect(p.code, JSON.stringify(other)).not.toBe(base.code);
      // What a step before it kept stays good.
      expect(p.start).toBe(base.start);
    }
    // No connections and an empty list are the same draft: an old kept test is not made stale by the field.
    expect(printOf([]).code).toBe(printOf(undefined).code);
  });

  it("AU-44 · the sentence under the table is made from `permissions` alone: in F14c it names every collection read, each with whether it has a filter, fewer fields or a limit, and a step with no connection says that it reads nothing", () => {
    const given = permissions([
      { ...newConnection(orders.key), read: { where: open, fields: [state], limit: 10 } },
      newConnection(notes.key),
    ]);
    // What the sentence says of each, and nothing it does not need.
    expect(
      given.map((p) => ({
        collection: p.collection,
        action: p.action,
        filtered: p.where !== undefined,
        fewer: p.fields !== undefined,
        limit: p.limit,
      })),
    ).toEqual([
      { collection: orders.key, action: "read", filtered: true, fewer: true, limit: 10 },
      { collection: notes.key, action: "read", filtered: false, fewer: false, limit: undefined },
    ]);
    expect(permissions([])).toEqual([]);
    expect(permissions([{ ...newConnection(orders.key), read: false }])).toEqual([]);
  });
});
