// The engine running JavaScript through the box (docs/automatizaciones.md §5.3, §5.4, §6; box.ts, engine.ts,
// partial.ts, preview.ts). Every test keeps its rule's id in its name (`make check` reads them). They use a `Box` that
// is a fake of the test (it answers by a table of sources, and records every job it was sent) and the fakes of
// run.test-util.ts: the real interpreter is tested in apps/sandbox, and the two together in
// apps/server/src/automations/box.test.ts (S1). Collections, fields and values are invented (D-14).
import { readdirSync, readFileSync } from "node:fs";
import { join, type Label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { cite, collection, ids, sketch } from "./automation.test-util.ts";
import {
  type Box,
  type BoxJob,
  type CodeRead,
  type ConsoleLine,
  type Evaluated,
  type EvaluateInput,
  evaluate,
  type Fields,
  rowsOf,
  seedOf,
} from "./box.ts";
import { CODE_LIMITS, CODE_TYPE, type CodeFailure, CodeFault } from "./code.ts";
import { type Connection, newConnection } from "./connections.ts";
import type { Gate, PolicyCall } from "./effects.ts";
import { CLOSED, type Execution, type RunDeps, run } from "./engine.ts";
import { ACTION, type Automation, MAIN, OUT, type Step } from "./format.ts";
import { keep, runTest, stepPrints, type TestExecution } from "./partial.ts";
import { preview } from "./preview.ts";
import type { Cell, Row } from "./rows.ts";
import { deps, OUTSIDE, OWN, outOf, policy, store } from "./run.test-util.ts";
import { validate } from "./validate.ts";

// ---------------------------------------------------------------- the fake box

const ASK = Symbol("ask");
const FAIL = Symbol("fail");
type Out = Cell | { [ASK]: { key: string; read: CodeRead } } | { [FAIL]: CodeFailure };
const ask = (key: string, read: CodeRead): Out => ({ [ASK]: { key, read } });
const fail = (failure: CodeFailure): Out => ({ [FAIL]: failure });

interface Seen {
  /** The row of this evaluation, as sent; undefined in «Una vez con todas las filas». */
  row: Fields | undefined;
  job: BoxJob;
  /** The row's place in the step's whole input. */
  at: number;
  log(text: string): void;
  use(what: "clock" | "random"): void;
}

interface FakeBox extends Box {
  /** Every job it was sent, as it was sent. */
  jobs: BoxJob[];
}

/** A box that answers each source by the table: what a real interpreter would give, without one. */
function fakeBox(table: Record<string, (s: Seen) => Out>): FakeBox {
  const jobs: BoxJob[] = [];
  return {
    jobs,
    async run(job) {
      jobs.push(structuredClone(job));
      const all = job.kind === "code" && job.mode === "all";
      const count = all ? 1 : job.input.length;
      const evaluations: Evaluated[] = [];
      const console: ConsoleLine[] = [];
      for (let j = 0; j < count; j++) {
        const at = job.from + j;
        const lines: ConsoleLine[] = [];
        const uses = { clock: false, random: false };
        const values: Cell[] = [];
        let end: Evaluated | undefined;
        for (const [k, source] of job.sources.entries()) {
          const answer = table[source];
          if (!answer) throw new Error(`the fake box has no answer for ${source}`);
          const o = answer({
            row: all ? undefined : job.input[j],
            job,
            at,
            log: (text) => lines.push({ level: "log", text, line: 1, ...(all ? {} : { row: at }) }),
            use: (what) => {
              uses[what] = true;
            },
          });
          if (typeof o === "object" && o !== null && ASK in o) {
            end = { state: "needs", ...o[ASK] };
            break;
          }
          if (typeof o === "object" && o !== null && FAIL in o) {
            end = { state: "failed", failure: o[FAIL], source: k };
            break;
          }
          values.push(o as Cell);
        }
        // A row that stopped at a read wrote nothing yet: it writes it all again when it is repeated.
        if (end?.state !== "needs") console.push(...lines);
        evaluations.push(end ?? { state: "done", values, ...uses });
      }
      return { evaluations, console, dropped: 0, ms: 1 };
    },
  };
}

/** The chance the fake box draws for a row: from the step's seed and the row's place only, as the real one. */
const chance = (s: Seen) => {
  s.use("random");
  return (Math.imul(s.job.seed ^ (s.at + 1), 2654435761) >>> 0) % 1000;
};

// ---------------------------------------------------------------- the data

const next = ids(127);
const orders = collection(next, ["number", "text"]);
const [price, state] = orders.fields.map((f) => f.key) as [string, string];
const NAMES: Record<string, string> = { Pedidos: orders.key };
const ROWS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ [price]: i, [state]: i % 2 ? "abierto" : "cerrado" }));
const db = (n = 6, of: Label = OWN) => store([orders], { [orders.key]: ROWS(n) }, ids(128), of);

const asks = { fields: [{ key: "nota", name: "Nota", type: "text" }] };

/** A trigger, a search of every order, and then `then`, joined by arrows in that order. */
function withSearch(
  then: (s: ReturnType<typeof sketch>) => ReturnType<typeof sketch>,
  settings = {},
) {
  const s = sketch(31)
    .step("Inicio", "manual", asks)
    .step(
      "Buscar",
      "collection",
      { collection: orders.key, [ACTION]: "find", limit: 5000 },
      settings,
    );
  then(s);
  return s;
}

/** The automation with `connections` on the step `name`. */
const connect = (a: Automation, s: { id(name: string): string }, name: string, c: Connection[]) => {
  (a.steps.find((x) => x.id === s.id(name)) as Step).connections = c;
  return a;
};

const go = (
  a: Automation,
  trigger: string,
  over: Partial<RunDeps> = {},
  more: { json?: Row["json"]; fields?: Row["fields"]; seed?: number; test?: boolean } = {},
): Promise<Execution> =>
  run(
    {
      automation: a,
      trigger,
      fields: {
        json: more.json ?? {},
        label: OWN,
        ...(more.fields ? { fields: more.fields } : {}),
      },
      test: more.test ?? true,
      ...(more.seed === undefined ? {} : { seed: more.seed }),
    },
    deps({ collectionNamed: (name) => NAMES[name], ...over }),
  );

/** `evaluate` over rows made here, with a gate that has no way to the collections. */
const input = (over: Partial<EvaluateInput>): EvaluateInput => ({
  kind: "expressions",
  sources: [],
  mode: "perRow",
  input: [],
  steps: {},
  literal: OWN,
  connections: [],
  collectionNamed: () => undefined,
  now: Date.UTC(2026, 10, 16, 9),
  zone: "Europe/Madrid",
  locale: "es",
  today: "2026-11-16",
  seed: 7,
  run: { test: true, startedBy: "user" },
  ...over,
});
const row = (json: Row["json"], label: Label = OWN): Row => ({
  json,
  label,
  path: null,
  parent: null,
});

const whyOf = (e: Execution, step: string) => e.steps[step]?.error?.why;

// ---------------------------------------------------------------- the tests

describe("«Código» as a step", () => {
  it("AU-30 · «Código» has two parameters, «Se ejecuta» with «Una vez con todas las filas» by default and «Una vez por fila», and the code; neither may be an expression, and the step has one input and one output", async () => {
    const box = fakeBox({ "return []": () => [] });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { source: "return []" })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const e = await go(s.build(), s.id("Inicio"), { box, collections: db() });
    // No «Se ejecuta»: once with all the rows.
    expect(box.jobs).toHaveLength(1);
    expect(box.jobs[0]).toMatchObject({ kind: "code", mode: "all", sources: ["return []"] });
    expect(Object.keys(e.steps[s.id("Código")]?.in ?? {})).toEqual([MAIN]);
    expect(Object.keys(e.steps[s.id("Código")]?.out ?? {})).toEqual([MAIN]);
    // Neither parameter may be an expression.
    const a = s.build();
    (a.steps[2] as Step).params = { mode: { expr: "{{ $json.x }}" }, source: { expr: "{{ 1 }}" } };
    const problems = validate(a, {
      collection: (k) => (k === orders.key ? orders : undefined),
      collectionNamed: (n: string) => NAMES[n],
    } as Parameters<typeof validate>[1]).filter((p) => p.step === s.id("Código"));
    expect(problems.map((p) => p.param).sort()).toEqual(["mode", "source"]);
  });

  it("AU-30 · it gives rows: a list of objects is those rows, one object one row, null or an empty list none; a text, a number or a list of them is `code.result` (`notRows`) and no `return` `code.result` (`nothing`)", async () => {
    expect(rowsOf([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(rowsOf({ a: 1 })).toEqual([{ a: 1 }]);
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf([])).toEqual([]);
    for (const bad of ["texto", 3, true, [1, 2], ["a"], [{ a: 1 }, 2]])
      expect(() => rowsOf(bad as Cell)).toThrow(CodeFault);
    const box = fakeBox({
      "return 'texto'": () => "texto",
      "x = 1": () => fail({ code: "code.result", detail: { why: "nothing" } }),
    });
    for (const [source, why] of [
      ["return 'texto'", "notRows"],
      ["x = 1", "nothing"],
    ] as const) {
      const s = withSearch((x) =>
        x
          .step("Código", CODE_TYPE, { mode: "all", source })
          .arrow("Inicio", "Buscar")
          .arrow("Buscar", "Código"),
      );
      const e = await go(s.build(), s.id("Inicio"), { box, collections: db() });
      expect(whyOf(e, s.id("Código"))).toMatchObject({ code: "code.result", detail: { why } });
    }
  });

  it("AU-30 · «Una vez por fila» is called once per row that arrives and each row out knows the row it comes from, so `.item` finds its own across it; «Una vez con todas las filas» remakes the rows, runs once with an empty list too, and «Una vez por fila» with an empty list calls nothing", async () => {
    const box = fakeBox({
      [`return [{ doble: $json.${price} * 2 }, { doble: $json.${price} * 2 + 1 }]`]: ({
        row: r,
      }) => [{ doble: (r?.[price] as number) * 2 }, { doble: (r?.[price] as number) * 2 + 1 }],
      "return [{ n: $input.all().length }]": ({ job }) => [{ n: job.input.length }],
    });
    const perRow = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, {
          mode: "perRow",
          source: `return [{ doble: $json.${price} * 2 }, { doble: $json.${price} * 2 + 1 }]`,
        })
        .step("Copiar", "edit", {
          keep: "none",
          fields: [{ field: "de", value: cite(`$('Buscar').item.${price}`) }],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código")
        .arrow("Código", "Copiar"),
    );
    const e = await go(perRow.build(), perRow.id("Inicio"), { box, collections: db(3) });
    expect(outOf(e, perRow.id("Código"))).toEqual([0, 1, 2, 3, 4, 5].map((doble) => ({ doble })));
    expect(e.steps[perRow.id("Código")]?.out[MAIN]?.map((r) => r.parent)).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
    expect(outOf(e, perRow.id("Copiar"))).toEqual([0, 0, 1, 1, 2, 2].map((de) => ({ de })));

    // With an empty list: «Una vez con todas las filas» runs once, «Una vez por fila» calls nothing.
    for (const [mode, calls] of [
      ["all", 1],
      ["perRow", 0],
    ] as const) {
      const empty = fakeBox({
        "return [{ n: $input.all().length }]": ({ job }) => [{ n: job.input.length }],
      });
      const s = withSearch(
        (x) =>
          x
            .step("Código", CODE_TYPE, { mode, source: "return [{ n: $input.all().length }]" })
            .arrow("Inicio", "Buscar")
            .arrow("Buscar", "Código"),
        { continueEmpty: true },
      );
      const r = await go(s.build(), s.id("Inicio"), { box: empty, collections: db(0) });
      expect(empty.jobs).toHaveLength(calls);
      expect(outOf(r, s.id("Código"))).toEqual(mode === "all" ? [{ n: 0 }] : []);
    }
  });

  it("AU-30 · a row whose code fails in «Una vez por fila» follows the step's «Si falla» like any step's row: dropped with «Seguir», out by «error» with «Salir por error», and the others' rows come out", async () => {
    const source = `return { n: $json.${price} }`;
    const box = fakeBox({
      [source]: ({ row: r }) =>
        r?.[price] === 1
          ? fail({ code: "code.threw", detail: { message: "falla", line: 1, column: 1 } })
          : { n: r?.[price] ?? null },
    });
    for (const onError of ["continue", "errorOutput", "stop"] as const) {
      const s = withSearch((x) =>
        x
          .step("Código", CODE_TYPE, { mode: "perRow", source }, { onError })
          .arrow("Inicio", "Buscar")
          .arrow("Buscar", "Código"),
      );
      const e = await go(s.build(), s.id("Inicio"), { box, collections: db(3) });
      const record = e.steps[s.id("Código")];
      if (onError === "stop") {
        expect(e.state).toBe("failed");
        expect(e.error).toMatchObject({
          step: s.id("Código"),
          row: 1,
          why: { code: "code.threw" },
        });
        continue;
      }
      expect(outOf(e, s.id("Código"))).toEqual([{ n: 0 }, { n: 2 }]);
      expect(record?.failed).toBe(1);
      expect((record?.out[OUT.error] ?? []).map((r) => r.json[price])).toEqual(
        onError === "errorOutput" ? [1] : [],
      );
    }
  });

  it("AU-32 · nothing code can call writes: `evaluate` never asks the gate for a write, whatever the box answers, and a read the box asks for with an operation that is not find, get, count or sum is `code.read.query`", async () => {
    const source = "return $col('Pedidos').insert({})";
    const box = fakeBox({
      [source]: ({ job }) =>
        "k" in job.reads ? [] : ask("k", { collection: "Pedidos", op: "insert" as "find" }),
    });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "all", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const p = policy();
    const data = db();
    const e = await go(
      connect(s.build(), s, "Código", [newConnection(orders.key)]),
      s.id("Inicio"),
      {
        box,
        collections: data,
        policy: p,
      },
    );
    expect(whyOf(e, s.id("Código"))).toMatchObject({
      code: "code.read.query",
      detail: { why: "op" },
    });
    expect(p.calls.filter((c) => c.step === s.id("Código"))).toEqual([]);
    expect(data.applied).toEqual([]);
    expect(data.calls.filter((c) => c.method === "apply")).toEqual([]);
    // `evaluate` with a gate that throws on any write: no answer of the box reaches it.
    const gate: Gate = { ...CLOSED, write: () => Promise.reject(new Error("a write")) };
    const r = await evaluate(
      input({
        kind: "code",
        mode: "all",
        sources: [source],
        connections: [newConnection(orders.key)],
        collectionNamed: (n) => NAMES[n],
      }),
      box,
      gate,
    );
    expect(r.evaluations[0]).toMatchObject({
      state: "failed",
      failure: { code: "code.read.query" },
    });
  });

  it("AU-32 · a row out of «Código» is no saved row: it has no origin even when it copies one's fields and id, so a «Colección» step after it that takes «Las filas que llegan» fails with `row.notSaved`, and one that creates or modifies asks the policy as for any rows", async () => {
    const source = "return { ...$json }";
    const box = fakeBox({ [source]: ({ row: r }) => ({ ...r }) });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "perRow", source })
        .step("Modificar", "collection", {
          collection: orders.key,
          [ACTION]: "update",
          fields: [{ field: state, value: "visto" }],
        })
        .step("Crear", "collection", {
          collection: orders.key,
          [ACTION]: "create",
          fields: [{ field: price, value: cite(`$json.${price}`) }],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código")
        .arrow("Código", "Modificar")
        .arrow("Código", "Crear"),
    );
    const p = policy();
    const e = await go(s.build(), s.id("Inicio"), { box, collections: db(2), policy: p });
    expect(e.steps[s.id("Código")]?.out[MAIN]?.every((r) => r.origin === undefined)).toBe(true);
    expect(e.error).toMatchObject({ step: s.id("Modificar"), failure: { code: "row.notSaved" } });
    const again = await go(
      (() => {
        const a = s.build();
        a.arrows = a.arrows.filter((x) => x.to.step !== s.id("Modificar"));
        return a;
      })(),
      s.id("Inicio"),
      { box, collections: db(2), policy: p },
    );
    expect(again.state).toBe("done");
    expect(p.calls.filter((c) => c.step === s.id("Crear") && c.effect === "write")).toHaveLength(2);
  });
});

describe("what the box is sent and what comes back", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory()
        ? d.name === "node_modules" || d.name === "dist"
          ? []
          : sourceFiles(`${dir}/${d.name}`)
        : /\.(ts|tsx|js|cjs|mjs)$/.test(d.name) && !/\.test(-util)?\.tsx?$/.test(d.name)
          ? [`${dir}/${d.name}`]
          : [],
    );
  // Code, not its comments: a comment may say what is not done.
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const EVALUATES = /\beval\s*\(|\bnew\s+Function\s*\(|(^|[^.\w])Function\s*\(|["'](node:)?vm["']/;

  it("AU-160 · the engine runs no JavaScript itself: every `{{ }}` that is not a simple citation and every «Código» goes to `RunDeps.box`, and no source file of the engine, of the catalogue or of the server's automations names `eval`, `Function(` or `node:vm`", async () => {
    const here = new URL(".", import.meta.url).pathname;
    const files = [
      ...sourceFiles(here),
      ...sourceFiles(`${here}../../../apps/server/src/automations`),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(EVALUATES.test(code(f)), f).toBe(false);
    // Without a box it does not run; with one, both kinds go to it.
    const s = withSearch((x) =>
      x
        .step("Copiar", "edit", {
          keep: "none",
          fields: [{ field: "d", value: { expr: `{{ $json.${price} * 2 }}` } }],
        })
        .step("Código", CODE_TYPE, { mode: "all", source: "return []" })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Copiar")
        .arrow("Copiar", "Código"),
    );
    await expect(go(s.build(), s.id("Inicio"), { collections: db() })).rejects.toThrow("errors");
    const box = fakeBox({
      [`$json.${price} * 2`]: ({ row: r }) => (r?.[price] as number) * 2,
      "return []": () => [],
    });
    const e = await go(s.build(), s.id("Inicio"), { box, collections: db(3) });
    expect(box.jobs.map((j) => j.kind)).toEqual(["expressions", "code"]);
    expect(outOf(e, s.id("Copiar"))).toEqual([{ d: 0 }, { d: 2 }, { d: 4 }]);
  });

  it("AU-160 · a job carries no label, no origin, no id of the automation or of the run, no collection the code did not read and no step it does not cite: for a table of automations, what the fake box was sent is exactly that", async () => {
    const source = `return { p: $json.${price} }`;
    const box = fakeBox({ [source]: ({ row: r }) => ({ p: r?.[price] ?? null }) });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "perRow", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const a = s.build();
    const data = db(2);
    await go(a, s.id("Inicio"), { box, collections: data }, { json: { nota: "hola" } });
    const job = box.jobs[0] as BoxJob;
    expect(Object.keys(job).sort()).toEqual(
      [
        "from",
        "input",
        "kind",
        "locale",
        "mode",
        "now",
        "reads",
        "run",
        "seed",
        "sources",
        "steps",
        "zone",
      ].sort(),
    );
    // Only the field it reads, of the rows that reach it; no step it does not cite.
    expect(job.input).toEqual([{ [price]: 0 }, { [price]: 1 }]);
    expect(job.steps).toEqual({});
    const sent = JSON.stringify(box.jobs);
    for (const never of [
      a.id,
      ...a.steps.map((x) => x.id),
      orders.key,
      ...data.rows(orders.key).map((r) => r.origin.id),
      "hola",
      '"label"',
      '"origin"',
    ])
      expect(sent).not.toContain(never);
  });

  it("AU-163 · the job of a step holds, of the steps before it, only the ones its code cites and, where the code names the fields, only those fields; with `.item`, the place of each row's own row", async () => {
    const source = `$('Inicio').first().nota + $('Buscar').item.${state} + $json.${price}`;
    const box = fakeBox({ [source]: ({ row: r }) => String(r?.[price]) });
    const s = withSearch((x) =>
      x
        .step("Otro", "edit", { fields: [{ field: "z", value: 1 }] })
        .step("Copiar", "edit", { fields: [{ field: "d", value: { expr: `{{ ${source} }}` } }] })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Otro")
        .arrow("Otro", "Copiar"),
    );
    await go(s.build(), s.id("Inicio"), { box, collections: db(3) }, { json: { nota: "x" } });
    const job = box.jobs[0] as BoxJob;
    expect(Object.keys(job.steps).sort()).toEqual(["Buscar", "Inicio"]);
    expect(job.steps.Inicio).toEqual({ rows: [{ nota: "x" }] });
    expect(job.steps.Buscar).toEqual({
      rows: [{ [state]: "cerrado" }, { [state]: "abierto" }, { [state]: "cerrado" }],
      item: [0, 1, 2],
    });
    expect(job.input).toEqual([{ [price]: 0 }, { [price]: 1 }, { [price]: 2 }]);
  });

  it("AU-169 · what an evaluation gives carries the worst label of what it was sent (its rows, the rows of every step cited, the code's own label and every read it made) and is derived: with one row from outside among 3,000 of the user's, the value calculated from all of them is from outside", async () => {
    const source = `return [{ n: $input.all().length }]`;
    const box = fakeBox({ [source]: ({ job }) => [{ n: job.input.length }] });
    const rows = Array.from({ length: 3000 }, (_, i) => row({ n: i }, i === 1234 ? OUTSIDE : OWN));
    const r = await evaluate(
      input({ kind: "code", mode: "all", sources: [source], input: rows }),
      box,
      CLOSED,
    );
    expect(r.labels).toEqual([join(OWN, OUTSIDE)]);
    // Through the engine: the rows a «Código» gives carry it, every field derived.
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "all", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const e = await go(s.build(), s.id("Inicio"), { box, collections: db(3, OUTSIDE) });
    const out = e.steps[s.id("Código")]?.out[MAIN]?.[0];
    expect(out?.label).toEqual(join(OWN, OUTSIDE));
    expect(out?.fields).toEqual({ n: { label: join(OWN, OUTSIDE), derived: true } });
  });

  it("AU-169 · in «Una vez por fila» and in an expression the label is per row, never finer: beside a row from outside, a row of the user's that cites no other step and reads nothing gives a value that is the user's, derived", async () => {
    const box = fakeBox({ "$json.n + 1": ({ row: r }) => (r?.n as number) + 1 });
    const r = await evaluate(
      input({ sources: ["$json.n + 1"], input: [row({ n: 1 }, OUTSIDE), row({ n: 2 }, OWN)] }),
      box,
      CLOSED,
    );
    expect(r.labels).toEqual([join(OWN, OUTSIDE), OWN]);
    const s = withSearch((x) =>
      x
        .step("Copiar", "edit", {
          keep: "none",
          fields: [{ field: "d", value: { expr: `{{ $json.${price} + 1 }}` } }],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Copiar"),
    );
    const plus = fakeBox({ [`$json.${price} + 1`]: ({ row: x }) => (x?.[price] as number) + 1 });
    const e = await go(s.build(), s.id("Inicio"), { box: plus, collections: db(2) });
    expect(e.steps[s.id("Copiar")]?.out[MAIN]?.map((x) => x.fields?.d)).toEqual([
      { label: OWN, derived: true },
      { label: OWN, derived: true },
    ]);
  });

  it("AU-169 · a value calculated is never a destination: a «Colección» step whose relation or whose row to modify comes from a «Código» or from a `{{ }}` with JavaScript is denied by the policy (P14), while the same value from a simple citation is not", async () => {
    // The policy denies a derived value where it is a destination (the server's policy does: packages/agent).
    const p = policy((c: PolicyCall) =>
      c.effect === "write" && c.values[price]?.derived
        ? { kind: "deny", rule: "test.P14", reason: "a calculated value as a destination" }
        : { kind: "allow", rule: "test.allow" },
    );
    const box = fakeBox({ "$json.nota.length + 0": ({ row: r }) => String(r?.nota).length });
    for (const [value, denied] of [
      [{ expr: "{{ $json.nota.length + 0 }}" }, true],
      [cite("$json.nota"), false],
    ] as const) {
      const s = sketch(32)
        .step("Inicio", "manual", asks)
        .step("Crear", "collection", {
          collection: orders.key,
          [ACTION]: "create",
          fields: [{ field: price, value }],
        })
        .arrow("Inicio", "Crear");
      const e = await go(
        s.build(),
        s.id("Inicio"),
        { box, collections: db(0), policy: p },
        { json: { nota: "abc" }, test: false },
      );
      expect(e.error?.failure?.code === "policy.denied", JSON.stringify(value)).toBe(denied);
    }
    // A row «Código» gives is calculated: one of its fields as a destination is denied the same.
    const made = "return [{ n: 3 }]";
    const s = sketch(33)
      .step("Inicio", "manual")
      .step("Código", CODE_TYPE, { source: made })
      .step("Crear", "collection", {
        collection: orders.key,
        [ACTION]: "create",
        fields: [{ field: price, value: cite("$json.n") }],
      })
      .arrow("Inicio", "Código")
      .arrow("Código", "Crear");
    const e = await go(
      s.build(),
      s.id("Inicio"),
      { box: fakeBox({ [made]: () => [{ n: 3 }] }), collections: db(0), policy: p },
      { test: false },
    );
    expect(e.error?.failure?.code).toBe("policy.denied");
  });

  it("AU-169 · a `{{ }}` that is a simple citation keeps its field's exact label beside one with JavaScript in the same parameter, and the label of the path (AU-164) passes through a «Código» to the rows it gives", async () => {
    const box = fakeBox({
      "$json.nota.toUpperCase()": ({ row: r }) => String(r?.nota).toUpperCase(),
      "return $input.all()": ({ job }) => [...job.input],
    });
    const s = sketch(33)
      .step("Inicio", "manual", asks)
      .step("Copiar", "edit", {
        keep: "none",
        fields: [
          { field: "igual", value: cite("$json.nota") },
          { field: "mayúsculas", value: { expr: "{{ $json.nota.toUpperCase() }}" } },
        ],
      })
      .step("Buscar", "collection", {
        collection: orders.key,
        [ACTION]: "find",
        where: [{ field: state, op: "is", value: cite("$('Inicio').first().nota") }],
      })
      .step("Código", CODE_TYPE, { mode: "all", source: "return $input.all()" })
      .arrow("Inicio", "Copiar")
      .arrow("Copiar", "Buscar")
      .arrow("Buscar", "Código");
    const e = await go(
      s.build(),
      s.id("Inicio"),
      { box, collections: db(4) },
      {
        json: { nota: "abierto" },
        fields: { nota: { label: OUTSIDE, derived: false } },
      },
    );
    const copied = e.steps[s.id("Copiar")]?.out[MAIN]?.[0];
    expect(copied?.fields?.igual).toEqual({ label: OUTSIDE, derived: false });
    expect(copied?.fields?.["mayúsculas"]).toEqual({ label: join(OWN, OUTSIDE), derived: true });
    const found = e.steps[s.id("Buscar")]?.out[MAIN] ?? [];
    expect(found.length).toBe(2);
    for (const r of e.steps[s.id("Código")]?.out[MAIN] ?? [])
      expect(r.path).toEqual(found[0]?.path);
    expect(found[0]?.path).toEqual(join(OWN, OUTSIDE));
  });
});

describe("what a test keeps and the line under an expression", () => {
  /** A table of expressions with the instant and chance, tested whole from its trigger; what it keeps by step. */
  async function tested(box: Box, seed = 41) {
    const s = withSearch((x) =>
      x
        .step("Tabla", "edit", {
          keep: "none",
          fields: [
            { field: "azar", value: { expr: "{{ Math.random() }}" } },
            { field: "ahora", value: { expr: "{{ $now }}" } },
            { field: "doble", value: { expr: `{{ $json.${price} * 2 }}` } },
          ],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Tabla"),
    );
    const a = s.build();
    const prints = stepPrints(a, {}, (t) => t);
    const e = (await runTest(
      { automation: a, trigger: s.id("Inicio"), fields: { json: {}, label: OWN }, prints, seed },
      deps({ box, collections: db(9), collectionNamed: (n) => NAMES[n] }),
    )) as TestExecution;
    const kept = Object.fromEntries(
      e.ran.flatMap((id) => {
        const k = keep(e, id, prints[id] as string);
        return k ? [[id, k]] : [];
      }),
    );
    return { s, a, prints, e, kept };
  }
  const table = () =>
    fakeBox({
      "Math.random()": chance,
      $now: (x) => {
        x.use("clock");
        return x.job.now;
      },
      [`$json.${price} * 2`]: ({ row: r }) => (r?.[price] as number) * 2,
    });

  it("AU-27 · a value shown under an expression is calculated by `evaluate` with the same box, the same instant, the same seed and the same row as the test that kept the rows: for a table of expressions with dates and chance, the preview of row n is the value the run gave row n", async () => {
    const box = table();
    const { s, a, prints, e, kept } = await tested(box);
    const k = kept[s.id("Tabla")];
    expect(k?.clock).toEqual({ now: e.started, seed: e.seed });
    for (const n of [0, 4, 8])
      for (const [i, field] of ["azar", "ahora", "doble"].entries()) {
        const p = await preview(
          {
            automation: a,
            step: s.id("Tabla"),
            param: `fields.${i}.value`,
            row: n,
            kept,
            prints,
            now: k?.clock?.now as number,
            seed: k?.clock?.seed as number,
            zone: "Europe/Madrid",
            locale: "es",
          },
          box,
        );
        expect(p).toEqual({
          state: "value",
          value: outOf(e, s.id("Tabla"))?.[n]?.[field],
          row: n,
          of: 9,
        });
      }
  });

  it("AU-27 · there is no second interpreter: no file of the web app evaluates code (no `eval`, no `Function(`, no interpreter among its dependencies), and a preview is always asked of the server", () => {
    const web = new URL("../../../apps/boni-web/", import.meta.url).pathname;
    const files = readdirSync(`${web}src`, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
      .map((d) => `${d.parentPath}/${d.name}`);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(/\beval\s*\(|\bnew\s+Function\s*\(|(^|[^.\w])Function\s*\(/.test(text), f).toBe(false);
    }
    const pkg = JSON.parse(readFileSync(`${web}package.json`, "utf8")) as Record<
      string,
      Record<string, string>
    >;
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const interpreter of [
      "quickjs-emscripten",
      "quickjs",
      "vm2",
      "isolated-vm",
      "sval",
      "js-interpreter",
      "@sebastianwessel/quickjs",
    ])
      expect(all).not.toContain(interpreter);
  });

  it("AU-25 · `rowsOf` takes the keys of what the box gave as fields and nothing else: a row with `__proto__`, `constructor` or `toString` as keys comes out with those fields, and no object of the engine gets a prototype or a property from it", () => {
    const given = JSON.parse(
      '[{"__proto__": {"pwned": 1}, "constructor": 2, "toString": 3}]',
    ) as Cell;
    const [r] = rowsOf(given) as [Fields];
    expect(Object.keys(r).sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
    expect(r.constructor).toBe(2);
    expect((r as Record<string, unknown>).pwned).toBeUndefined();
    expect(({} as Record<string, unknown>).pwned).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(r, "__proto__")?.value).toEqual({ pwned: 1 });
  });

  it("AU-25 · on the way in too: a row that arrives, or a row of a step it cites, with fields named `__proto__`, `constructor` or `toString` beside a field of another label is sent with those fields, and no inherited member is taken for a label", async () => {
    const json = JSON.parse(
      '{"__proto__": 1, "constructor": 2, "toString": 3, "a": 4}',
    ) as Row["json"];
    const odd: Row = { ...row(json), fields: { a: { label: OUTSIDE, derived: false } } };
    const all = "Object.keys($json).length + 0";
    const keys = fakeBox({ [all]: ({ row: r }) => Object.keys(r ?? {}).length });
    const r = await evaluate(input({ sources: [all], input: [odd] }), keys, CLOSED);
    expect(r.evaluations).toMatchObject([{ state: "done", values: [4] }]);
    expect(r.labels).toEqual([join(OWN, OUTSIDE)]);
    const src = "$('Antes').all()[0].json.toString + 0";
    const cited = fakeBox({
      [src]: ({ job }) => job.steps.Antes?.rows[0]?.["toString"] as Cell,
    });
    const c = await evaluate(
      input({ sources: [src], input: [row({})], steps: { Antes: { rows: [odd] } } }),
      cited,
      CLOSED,
    );
    expect(c.evaluations).toMatchObject([{ state: "done", values: [3] }]);
    // `.all()` sends every field of the cited rows, so `a`'s label comes with them.
    expect(Object.keys(cited.jobs[0]?.steps.Antes?.rows[0] ?? {}).sort()).toEqual([
      "__proto__",
      "a",
      "constructor",
      "toString",
    ]);
    expect(c.labels).toEqual([join(OWN, OUTSIDE)]);
  });

  it("AU-23 · the preview of an expression says its value with a row of the step's kept input and how many there are, for any row asked; with a step before it never tested or stale it says which to test and asks the box for nothing; a failure is said with its code", async () => {
    const box = table();
    const { s, a, prints, kept } = await tested(box);
    const ask = (over: Partial<Parameters<typeof preview>[0]>, b: Box = box) =>
      preview(
        {
          automation: a,
          step: s.id("Tabla"),
          param: "fields.2.value",
          row: 3,
          kept,
          prints,
          now: 0,
          seed: 0,
          zone: "Europe/Madrid",
          locale: "es",
          ...over,
        },
        b,
      );
    expect(await ask({})).toEqual({ state: "value", value: 6, row: 3, of: 9 });
    expect(await ask({ row: 99 })).toEqual({ state: "value", value: 16, row: 8, of: 9 });
    const none = fakeBox({});
    const { [s.id("Buscar")]: _, ...lacking } = kept;
    expect(await ask({ kept: lacking }, none)).toEqual({
      state: "untested",
      steps: [s.id("Buscar")],
    });
    expect(await ask({ prints: { ...prints, [s.id("Inicio")]: "otra" } }, none)).toEqual({
      state: "untested",
      steps: [s.id("Inicio")],
    });
    expect(
      await ask({ kept: lacking, prints: { ...prints, [s.id("Inicio")]: "otra" } }, none),
    ).toEqual({ state: "untested", steps: [s.id("Inicio"), s.id("Buscar")] });
    expect(none.jobs).toEqual([]);
    const failing = fakeBox({
      [`$json.${price} * 2`]: () => fail({ code: "code.threw", detail: { message: "no" } }),
    });
    expect(await ask({}, failing)).toMatchObject({
      state: "failed",
      failure: { code: "code.threw", param: "fields.2.value" },
      row: 3,
      of: 9,
    });
  });
});

describe("reading collections from code", () => {
  const source =
    "return [$col('Pedidos').find(), $col('Pedidos').get(), $col('Pedidos').count(), $col('Pedidos').sum()]";
  const reads: Record<string, CodeRead> = {
    a: {
      collection: "Pedidos",
      op: "find",
      where: [{ field: state, op: "is", value: "abierto" }],
      sort: [{ field: price, direction: "desc" }],
      limit: 2,
    },
    b: { collection: "Pedidos", op: "get", id: "" },
    c: { collection: "Pedidos", op: "count" },
    d: { collection: "Pedidos", op: "sum", field: price },
  };
  /** Asks for each read in turn, and gives what it was handed. */
  const reader = (rs: Record<string, CodeRead> = reads, id = "") =>
    fakeBox({
      [source]: ({ job }) => {
        for (const [key, read] of Object.entries(rs))
          if (!(key in job.reads)) return ask(key, read.op === "get" ? { ...read, id } : read);
        return [{ got: Object.keys(rs).map((k) => job.reads[k] ?? null) }];
      },
    });
  const withCode = (
    mode: "all" | "perRow" = "all",
    c: Connection[] = [newConnection(orders.key)],
  ) => {
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode, source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    return { s, a: connect(s.build(), s, "Código", c) };
  };

  it("AU-31 · `find` with `where`, `sort` and `limit`, `get`, `count` and `sum` each become one read the engine makes and hands back by the box's key; `where` is the views' filter as a list of rules, and one that is not is `code.read.query`", async () => {
    const data = db(6);
    const id = data.rows(orders.key)[2]?.origin.id as string;
    const box = reader(reads, id);
    const { s, a } = withCode();
    const e = await go(a, s.id("Inicio"), { box, collections: data });
    expect(box.jobs).toHaveLength(5);
    const [got] = outOf(e, s.id("Código")) as [{ got: Cell[] }];
    expect(got.got).toEqual([
      [
        { id: data.rows(orders.key)[5]?.origin.id, [price]: 5, [state]: "abierto" },
        { id: data.rows(orders.key)[3]?.origin.id, [price]: 3, [state]: "abierto" },
      ],
      { id, [price]: 2, [state]: "cerrado" },
      6,
      15,
    ]);
    const bad = reader({ a: { collection: "Pedidos", op: "find", where: "abierto" as never } });
    const r = await go(withCode().a, s.id("Inicio"), { box: bad, collections: db() });
    expect(whyOf(r, s.id("Código"))).toMatchObject({
      code: "code.read.query",
      detail: { why: "where" },
    });
  });

  it("AU-161 · every read goes through `narrow` and then the gate: the policy is asked once per read with the step, the collection and the filter's values, which are judged as calculated (derived, with the worst label of what the evaluation had received until then)", async () => {
    const p = policy();
    const { s, a } = withCode("all", [{ ...newConnection(orders.key), read: { limit: 1 } }]);
    const e = await go(a, s.id("Inicio"), {
      box: reader({ a: reads.a as CodeRead }),
      collections: db(6, OUTSIDE),
      policy: p,
    });
    const calls = p.calls.filter((c) => c.step === s.id("Código"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ effect: "read", collection: orders.key, type: CODE_TYPE });
    // The rows sent were from outside: the filter's value is judged with that label, derived.
    expect(calls[0]?.values["where.0.value"]).toEqual({
      value: "abierto",
      label: join(OWN, OUTSIDE),
      derived: true,
    });
    // The connection's limit narrowed it: one row, whatever the code asked.
    const [got] = outOf(e, s.id("Código")) as [{ got: Cell[][] }];
    expect(got.got[0]).toHaveLength(1);
  });

  it("AU-161 · a read of a collection the step is not connected to is `code.read.notConnected` and never reaches the gate; a read the policy denies is `policy.denied`, one it would ask about `policy.waits`, and the code never learns why", async () => {
    // Saved without the connection it is not run at all (validate: `code.notConnected`); a box that asks anyway
    // gets `code.read.notConnected`, and nothing reaches the gate.
    const { s, a } = withCode("all", []);
    await expect(go(a, s.id("Inicio"), { box: reader(), collections: db() })).rejects.toThrow(
      "errors",
    );
    const touched: string[] = [];
    const gate: Gate = {
      shape: (c) => (c === orders.key ? orders : undefined),
      find: () => {
        touched.push("find");
        return Promise.resolve([]);
      },
      get: () => {
        touched.push("get");
        return Promise.resolve(undefined);
      },
      aggregate: () => {
        touched.push("aggregate");
        return Promise.resolve([]);
      },
      write: () => {
        touched.push("write");
        return Promise.reject(new Error("a write"));
      },
    };
    const r0 = await evaluate(
      input({
        kind: "code",
        mode: "all",
        sources: [source],
        connections: [],
        collectionNamed: (n) => NAMES[n],
      }),
      reader({ c: reads.c as CodeRead }),
      gate,
    );
    expect(r0.evaluations[0]).toMatchObject({
      state: "failed",
      failure: { code: "code.read.notConnected", detail: { collection: "Pedidos" } },
    });
    expect(touched).toEqual([]);
    for (const [kind, code] of [
      ["deny", "policy.denied"],
      ["confirm", "policy.waits"],
    ] as const) {
      const box = reader({ c: reads.c as CodeRead });
      const r = await go(withCode().a, s.id("Inicio"), {
        box,
        collections: db(),
        policy: policy((c) =>
          c.effect === "read" && c.step === s.id("Código")
            ? kind === "deny"
              ? { kind, rule: "test.no", reason: "no" }
              : { kind, rule: "test.no" }
            : { kind: "allow", rule: "test.allow" },
        ),
      });
      expect(r.error).toMatchObject({ step: s.id("Código"), failure: { code } });
      // It was asked once, and never answered with why.
      expect(box.jobs).toHaveLength(1);
    }
  });

  it("AU-161 · each read is counted in the step's record (collection, operation, rows, bytes, time), its rows come labelled as the collection's rows are, and what was read for one step is never handed to another step's job or another run's", async () => {
    const box = reader({ a: reads.a as CodeRead });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "all", source })
        .step("Otro", CODE_TYPE, { mode: "all", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código")
        .arrow("Código", "Otro"),
    );
    const a = connect(connect(s.build(), s, "Código", [newConnection(orders.key)]), s, "Otro", [
      newConnection(orders.key),
    ]);
    const e = await go(a, s.id("Inicio"), { box, collections: db(6, OUTSIDE) });
    expect(e.steps[s.id("Código")]?.reads).toEqual([
      {
        collection: orders.key,
        op: "find",
        rows: 2,
        bytes: expect.any(Number),
        ms: expect.any(Number),
      },
    ]);
    expect(e.steps[s.id("Código")]?.out[MAIN]?.[0]?.label).toEqual(join(OWN, OUTSIDE));
    // Four jobs: each step asked first with nothing read.
    expect(box.jobs.map((j) => Object.keys(j.reads))).toEqual([[], ["a"], [], ["a"]]);
    await go(a, s.id("Inicio"), { box, collections: db(6) });
    expect(box.jobs[4]?.reads).toEqual({});
  });

  it("AU-161 · the engine repeats a job with what was read until no evaluation needs a read: a job that asks again for a read it was handed, or more than `reads` different ones, is `code.limit` and the step ends", async () => {
    const again = fakeBox({ [source]: () => ask("a", reads.c as CodeRead) });
    const { s, a } = withCode();
    const e = await go(a, s.id("Inicio"), { box: again, collections: db() });
    expect(whyOf(e, s.id("Código"))).toMatchObject({
      code: "code.limit",
      detail: { limit: "reads" },
    });
    expect(again.jobs).toHaveLength(2);
    const many = Object.fromEntries(
      Array.from({ length: CODE_LIMITS.reads + 1 }, (_, i) => [`k${i}`, reads.c as CodeRead]),
    );
    const r = await go(withCode().a, s.id("Inicio"), { box: reader(many), collections: db() });
    expect(whyOf(r, s.id("Código"))).toMatchObject({
      code: "code.limit",
      detail: { limit: "reads", max: CODE_LIMITS.reads, got: CODE_LIMITS.reads + 1 },
    });
  });

  it("AU-31 · the reads a call needs are made together and the call is repeated once with all of them: in a batch where some rows answer at once and others ask for different reads, the rows that answered keep their first answer and their console, and only the rest are asked again", async () => {
    const source = "return [{ n: $col('Pedidos').count() }]";
    const counted: unknown[] = [];
    const box = fakeBox({
      [source]: ({ job, at, log }) => {
        log(`fila ${at}`);
        if (at % 2 === 0) return [{ n: at }];
        const key = `k${at}`;
        if (!(key in job.reads)) return ask(key, { collection: "Pedidos", op: "count" });
        return [{ n: job.reads[key] ?? null }];
      },
    });
    const r = await evaluate(
      input({
        kind: "code",
        sources: [source],
        input: Array.from({ length: 4 }, (_, i) => row({ i })),
        connections: [newConnection(orders.key)],
        collectionNamed: (n) => NAMES[n],
      }),
      box,
      {
        ...CLOSED,
        shape: (c) => (c === orders.key ? orders : undefined),
        aggregate: async (q) => {
          counted.push(q);
          return [{ value: 7, label: OWN }];
        },
      },
    );
    expect(box.jobs.map((j) => [j.from, j.input.length, Object.keys(j.reads)])).toEqual([
      [0, 4, []],
      [1, 3, ["k1", "k3"]],
    ]);
    expect(counted).toHaveLength(2);
    expect(r.calls).toBe(2);
    expect(r.evaluations.map((e) => (e.state === "done" ? e.values : e.state))).toEqual([
      [[{ n: 0 }]],
      [[{ n: 7 }]],
      [[{ n: 2 }]],
      [[{ n: 7 }]],
    ]);
    expect(r.console.map((l) => l.text)).toEqual(["fila 0", "fila 1", "fila 2", "fila 3"]);
  });

  it("AU-161 · a `get` finds a row only inside its connection's «Solo estas filas»: an id inside the filter is the row, one outside it is null, as if it were not there", async () => {
    const data = db(6);
    const [outside, inside] = [2, 3].map((i) => data.rows(orders.key)[i]?.origin.id as string);
    const only: Connection[] = [
      {
        ...newConnection(orders.key),
        read: { where: [{ field: state, op: "is", value: "abierto" }] },
      },
    ];
    const got = async (id: string) => {
      const { s, a } = withCode("all", only);
      const e = await go(a, s.id("Inicio"), {
        box: reader({ b: reads.b as CodeRead }, id),
        collections: data,
      });
      return (outOf(e, s.id("Código")) as [{ got: Cell[] }])[0]?.got[0];
    };
    expect(await got(outside as string)).toBeNull();
    expect(await got(inside as string)).toEqual({ id: inside, [price]: 3, [state]: "abierto" });
  });
});

describe("the clock, chance and what a test keeps", () => {
  const random = () => fakeBox({ "Math.random()": chance, $now: (x) => x.job.now });
  const table = () =>
    withSearch((x) =>
      x
        .step("Tabla", "edit", {
          keep: "none",
          fields: [
            { field: "azar", value: { expr: "{{ Math.random() }}" } },
            { field: "ahora", value: { expr: "{{ $now }}" } },
          ],
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Tabla"),
    );

  it("AU-34 · every job of a run carries the same instant, taken once when the run starts, and a seed made of the run's seed and the step's id: running the same automation again with the same instant and seed sends the same jobs and gives the same rows", async () => {
    const s = table();
    const one = random();
    const two = random();
    const e1 = await go(
      s.build(),
      s.id("Inicio"),
      { box: one, collections: db(1200) },
      { seed: 5 },
    );
    const e2 = await go(
      s.build(),
      s.id("Inicio"),
      { box: two, collections: db(1200) },
      { seed: 5 },
    );
    expect(one.jobs).toHaveLength(3);
    for (const j of one.jobs)
      expect(j).toMatchObject({ now: e1.started, seed: seedOf(5, s.id("Tabla")) });
    expect(two.jobs).toEqual(one.jobs);
    expect(outOf(e2, s.id("Tabla"))).toEqual(outOf(e1, s.id("Tabla")));
    expect(e1.seed).toBe(5);
    const other = await go(
      s.build(),
      s.id("Inicio"),
      { box: random(), collections: db(1200) },
      { seed: 6 },
    );
    expect(outOf(other, s.id("Tabla"))).not.toEqual(outOf(e1, s.id("Tabla")));
  });

  it("AU-34 · the chance of a row does not depend on the size of the batch, on the row's retries or on what other rows did: 3,000 rows in batches of 500 and in batches of 7 give the same", async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => row({ n: i }));
    const box = random();
    const whole = await evaluate(input({ sources: ["Math.random()"], input: rows }), box, CLOSED);
    expect(box.jobs.map((j) => j.input.length)).toEqual(Array(6).fill(CODE_LIMITS.batchRows));
    // In pieces of 7, each counted from its place: the same values.
    const pieces: Cell[] = [];
    for (let lo = 0; lo < rows.length; lo += 7) {
      const r = await evaluate(
        input({ sources: ["Math.random()"], input: rows.slice(lo, lo + 7), offset: lo }),
        box,
        CLOSED,
      );
      for (const e of r.evaluations) pieces.push(e.state === "done" ? (e.values[0] as Cell) : null);
    }
    expect(pieces).toEqual(whole.evaluations.map((e) => (e.state === "done" ? e.values[0] : null)));
    // A retry of the whole step after the box failed once gives the same, and so do other rows failing.
    let first = true;
    const flaky: FakeBox = {
      jobs: [],
      run(job) {
        if (first) {
          first = false;
          return Promise.reject(new CodeFault("no box now", { code: "code.unavailable" }));
        }
        return box.run(job);
      },
    };
    const s = table();
    const a = s.build();
    (a.steps.find((x) => x.id === s.id("Tabla")) as Step).settings = {
      retry: { times: 1, waitMs: 10 },
    };
    const plain = await go(s.build(), s.id("Inicio"), { box, collections: db(40) }, { seed: 9 });
    const retried = await go(a, s.id("Inicio"), { box: flaky, collections: db(40) }, { seed: 9 });
    expect(retried.steps[s.id("Tabla")]?.retries).toBe(1);
    expect(outOf(retried, s.id("Tabla"))).toEqual(outOf(plain, s.id("Tabla")));
  });

  it("AU-34 · «Probar paso» reuses a kept step that read the clock or chance as it was kept, with what it gave then; when it runs again it gets the new test's instant and seed, its print does not change for that, and its record says that it read them", async () => {
    const s = withSearch((x) =>
      x
        .step("Tabla", "edit", {
          keep: "none",
          fields: [{ field: "azar", value: { expr: "{{ Math.random() }}" } }],
        })
        .step("Después", "edit", { fields: [{ field: "z", value: 1 }] })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Tabla")
        .arrow("Tabla", "Después"),
    );
    const a = s.build();
    const prints = stepPrints(a, {}, (t) => t);
    const d = deps({ box: random(), collections: db(4), collectionNamed: (n) => NAMES[n] });
    const base = {
      automation: a,
      trigger: s.id("Inicio"),
      fields: { json: {}, label: OWN },
      prints,
    };
    const first = await runTest({ ...base, seed: 1 }, d);
    expect(first.steps[s.id("Tabla")]?.uses).toEqual({ clock: false, random: true });
    const kept = Object.fromEntries(
      first.ran.map((id) => [id, keep(first, id, prints[id] as string)]),
    ) as Record<string, NonNullable<ReturnType<typeof keep>>>;
    const later = await runTest({ ...base, seed: 2, step: s.id("Después"), kept }, d);
    expect(later.reused).toContain(s.id("Tabla"));
    expect(outOf(later, s.id("Tabla"))).toEqual(outOf(first, s.id("Tabla")));
    const again = await runTest({ ...base, seed: 2, step: s.id("Tabla"), kept }, d);
    expect(again.ran).toContain(s.id("Tabla"));
    expect(outOf(again, s.id("Tabla"))).not.toEqual(outOf(first, s.id("Tabla")));
    expect(keep(again, s.id("Tabla"), prints[s.id("Tabla")] as string)?.clock).toEqual({
      now: again.started,
      seed: 2,
    });
    expect(stepPrints(a, {}, (t) => t)).toEqual(prints);
  });

  it("AU-33 · what the code wrote with `console` is kept in its step's record with the line that wrote it and, per row, the row: at most `consoleLines` lines of `consoleLineChars` characters, the rest counted; a reused step keeps the console it had", async () => {
    const source = `console.log($json.${price}); return []`;
    const box = fakeBox({
      [source]: (x) => {
        x.log(x.at === 0 ? "x".repeat(CODE_LIMITS.consoleLineChars + 5) : `fila ${x.at}`);
        return [];
      },
    });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "perRow", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const e = await go(s.build(), s.id("Inicio"), {
      box,
      collections: db(CODE_LIMITS.consoleLines + 3),
    });
    const c = e.steps[s.id("Código")]?.console;
    expect(c?.lines).toHaveLength(CODE_LIMITS.consoleLines);
    expect(c?.dropped).toBe(3);
    expect(c?.lines[0]?.text).toHaveLength(CODE_LIMITS.consoleLineChars);
    expect(c?.lines[5]).toEqual({ level: "log", text: "fila 5", line: 1, row: 5 });
    // A reused step keeps its record, console and all.
    const a = s.build();
    const prints = stepPrints(a, {}, (t) => t);
    const d = deps({ box, collections: db(3), collectionNamed: (n) => NAMES[n] });
    const base = {
      automation: a,
      trigger: s.id("Inicio"),
      fields: { json: {}, label: OWN },
      prints,
    };
    const first = await runTest(base, d);
    const kept = Object.fromEntries(
      first.ran.map((id) => [id, keep(first, id, prints[id] as string)]),
    ) as Record<string, NonNullable<ReturnType<typeof keep>>>;
    const later = await runTest({ ...base, step: s.id("Código"), kept }, d);
    expect(later.steps[s.id("Buscar")]).toBe(kept[s.id("Buscar")]?.record);
    expect(first.steps[s.id("Código")]?.console?.lines.map((l) => l.row)).toEqual([0, 1, 2]);
  });

  it("AU-33 · code that throws fails its step with `code.threw`, the message as the code gave it and the line and column of the source Juan wrote; in an expression, the parameter at fault. The message is in the record and nowhere else: not in `StepError.message`, not in a log", async () => {
    const threw = {
      code: "code.threw",
      detail: { message: "secreto de la fila", line: 2, column: 5 },
    } as CodeFailure;
    const box = fakeBox({
      "throw new Error('x')": () => fail(threw),
      "$json.nota.toFixed(2)": () => fail(threw),
    });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "all", source: "throw new Error('x')" })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const e = await go(s.build(), s.id("Inicio"), { box, collections: db() });
    expect(e.error).toMatchObject({
      step: s.id("Código"),
      failure: { code: "other", param: "source" },
      why: { ...threw, param: "source" },
    });
    expect(e.error?.message).not.toContain("secreto");
    const t = sketch(34)
      .step("Inicio", "manual", asks)
      .step("Copiar", "edit", {
        fields: [
          { field: "a", value: 1 },
          { field: "b", value: { expr: "{{ $json.nota.toFixed(2) }}" } },
        ],
      })
      .arrow("Inicio", "Copiar");
    const r = await go(t.build(), t.id("Inicio"), { box }, { json: { nota: "n" } });
    expect(r.error).toMatchObject({
      failure: { param: "fields.1.value" },
      why: { code: "code.threw", param: "fields.1.value" },
    });
    expect(JSON.stringify({ ...r.error, why: undefined })).not.toContain("secreto");
  });
});

describe("the limits and the cost", () => {
  it("AU-35 · passing a limit fails the step with `code.limit`, the limit's key and the limit; with what was reached where it can be known (bytes sent, bytes and rows given, rows and bytes read, reads) and without it for time, operations and memory", async () => {
    const many = Array.from({ length: CODE_LIMITS.outputRows + 1 }, (_, i) => ({ i }));
    const box = fakeBox({
      "return many": () => many,
      "while (true) {}": () =>
        fail({ code: "code.limit", detail: { limit: "ms", max: CODE_LIMITS.ms } }),
    });
    for (const [source, detail] of [
      [
        "return many",
        { limit: "outputRows", max: CODE_LIMITS.outputRows, got: CODE_LIMITS.outputRows + 1 },
      ],
      ["while (true) {}", { limit: "ms", max: CODE_LIMITS.ms }],
    ] as const) {
      const s = withSearch((x) =>
        x
          .step("Código", CODE_TYPE, { mode: "all", source })
          .arrow("Inicio", "Buscar")
          .arrow("Buscar", "Código"),
      );
      const e = await go(s.build(), s.id("Inicio"), { box, collections: db() });
      expect(whyOf(e, s.id("Código"))).toEqual({ code: "code.limit", param: "source", detail });
    }
  });

  it("AU-35 · the engine checks before sending that a job fits `inputBytes` and after it that the rows given fit `outputRows`, a read is stopped at `readBytes` while it is being read, and a step's reads stop at `stepReads` and `stepReadBytes`: nothing over a limit is held in memory to find out", async () => {
    // Before sending: nothing reaches the box.
    const box = fakeBox({ "$json.t.length": ({ row: r }) => String(r?.t).length });
    const big = [row({ t: "x".repeat(CODE_LIMITS.inputBytes) })];
    await expect(
      evaluate(input({ sources: ["$json.t.length"], input: big }), box, CLOSED),
    ).rejects.toMatchObject({
      why: { code: "code.limit", detail: { limit: "inputBytes", max: CODE_LIMITS.inputBytes } },
    });
    expect(box.jobs).toEqual([]);
    // A read past `readBytes`: that read fails; past `stepReads`, the whole step.
    const wide = store(
      [orders],
      {
        [orders.key]: Array.from({ length: 3 }, () => ({
          [state]: "y".repeat(CODE_LIMITS.readBytes / 2),
        })),
      },
      ids(129),
    );
    const source = "return [$col('Pedidos').find()]";
    const reading = (keys: number) =>
      fakeBox({
        [source]: ({ job }) => {
          for (let k = 0; k < keys; k++)
            if (!(`k${k}` in job.reads))
              return ask(`k${k}`, { collection: "Pedidos", op: k ? "count" : "find" });
          return [];
        },
      });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "perRow", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const a = connect(s.build(), s, "Código", [newConnection(orders.key)]);
    const e = await go(a, s.id("Inicio"), { box: reading(1), collections: wide });
    expect(whyOf(e, s.id("Código"))).toMatchObject({
      code: "code.limit",
      detail: { limit: "readBytes", max: CODE_LIMITS.readBytes },
    });
    // 6 rows, each asking 20 different reads: 120 reads in a step of at most 100.
    const r = await evaluate(
      input({
        kind: "code",
        sources: [source],
        input: Array.from({ length: 6 }, (_, i) => row({ i })),
        connections: [newConnection(orders.key)],
        collectionNamed: (n) => NAMES[n],
      }),
      fakeBox({
        [source]: ({ job, at }) => {
          for (let k = 0; k < CODE_LIMITS.reads; k++)
            if (!(`r${at}k${k}` in job.reads))
              return ask(`r${at}k${k}`, { collection: "Pedidos", op: "count" });
          return [];
        },
      }),
      {
        ...CLOSED,
        shape: (c) => (c === orders.key ? orders : undefined),
        aggregate: async () => [{ value: 1, label: OWN }],
      },
    ).catch((x: CodeFault) => x.why);
    expect(r).toMatchObject({
      code: "code.limit",
      detail: { limit: "stepReads", max: CODE_LIMITS.stepReads },
    });
  });

  it("AU-35 · a step's reads together stop at `stepReadBytes`: reads of about 1.4 MB each, every one under `readBytes`, fail the step with `code.limit`, the limit and what was reached", async () => {
    const wide = store(
      [orders],
      { [orders.key]: Array.from({ length: 3 }, () => ({ [state]: "y".repeat(460_000) })) },
      ids(130),
    );
    const source = "return [$col('Pedidos').find()]";
    const box = fakeBox({
      [source]: ({ job, at }) => {
        for (const k of ["a", "b"])
          if (!(`r${at}${k}` in job.reads))
            return ask(`r${at}${k}`, { collection: "Pedidos", op: "find" });
        return [];
      },
    });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "perRow", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const a = connect(s.build(), s, "Código", [newConnection(orders.key)]);
    const e = await go(a, s.id("Inicio"), { box, collections: wide });
    const why = whyOf(e, s.id("Código"));
    expect(why).toMatchObject({
      code: "code.limit",
      detail: { limit: "stepReadBytes", max: CODE_LIMITS.stepReadBytes },
    });
    expect(Number(why?.detail?.got)).toBeGreaterThan(CODE_LIMITS.stepReadBytes);
  });

  it("AU-34 · the run's instant and its seed are kept with it (`Execution.started`, `Execution.seed`) and with each kept step (`Kept.clock`), which is where a preview takes them from, and a step's record says whether its JavaScript read the clock or chance (`StepRecord.uses`)", async () => {
    const box = fakeBox({
      $now: (x) => {
        x.use("clock");
        return x.job.now;
      },
    });
    const s = sketch(35)
      .step("Inicio", "manual", asks)
      .step("Ahora", "edit", { fields: [{ field: "t", value: { expr: "{{ $now }}" } }] })
      .step("Fijo", "edit", { fields: [{ field: "u", value: 1 }] })
      .arrow("Inicio", "Ahora")
      .arrow("Ahora", "Fijo");
    const a = s.build();
    const prints = stepPrints(a, {}, (t) => t);
    const e = await runTest(
      {
        automation: a,
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        prints,
        seed: 77,
      },
      deps({ box }),
    );
    expect(e.seed).toBe(77);
    expect(outOf(e, s.id("Ahora"))?.[0]?.t).toBe(e.started);
    expect(e.steps[s.id("Ahora")]?.uses).toEqual({ clock: true, random: false });
    expect(e.steps[s.id("Fijo")]?.uses).toBeUndefined();
    expect(keep(e, s.id("Ahora"), "p")).toEqual({
      print: "p",
      record: e.steps[s.id("Ahora")],
      at: e.started,
      clock: { now: e.started, seed: 77 },
    });
    // A run with no JavaScript has no seed to keep.
    const plain = await runTest(
      {
        automation: a,
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        prints,
        step: s.id("Inicio"),
      },
      deps({ box }),
    );
    expect(plain.seed).toBeUndefined();
  });

  it("AU-38 · a step with a `{{ }}` of JavaScript and 3,000 rows makes one call to the box per `batchRows` rows, never one per row, and «Una vez por fila» the same; a step with only simple citations makes none", async () => {
    const box = fakeBox({
      [`$json.${price} + 1`]: ({ row: r }) => (r?.[price] as number) + 1,
      [`return { n: $json.${price} }`]: ({ row: r }) => ({ n: r?.[price] ?? null }),
    });
    const s = withSearch((x) =>
      x
        .step("Más", "edit", {
          fields: [{ field: "m", value: { expr: `{{ $json.${price} + 1 }}` } }],
        })
        .step("Código", CODE_TYPE, { mode: "perRow", source: `return { n: $json.${price} }` })
        .step("Citar", "edit", { fields: [{ field: "c", value: cite(`$json.${price}`) }] })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Más")
        .arrow("Más", "Código")
        .arrow("Código", "Citar"),
    );
    const e = await go(s.build(), s.id("Inicio"), { box, collections: db(3000) });
    expect(e.state).toBe("done");
    expect(box.jobs.map((j) => [j.kind, j.input.length])).toEqual([
      ...Array(6).fill(["expressions", 500]),
      ...Array(6).fill(["code", 500]),
    ]);
    expect(outOf(e, s.id("Citar"))).toHaveLength(3000);
  });

  it("AU-38 · `$input.all()` in an expression or in «Una vez por fila» sends the whole input with every call, so each row sees all of them: 600 rows are one call, not two batches", async () => {
    const src = "$input.all().length + 0";
    const code = "return [{ n: $input.all().length }]";
    const box = fakeBox({
      [src]: ({ job }) => job.input.length,
      [code]: ({ job }) => [{ n: job.input.length }],
    });
    const rows = Array.from({ length: 600 }, (_, i) => row({ i }));
    const r = await evaluate(input({ sources: [src], input: rows }), box, CLOSED);
    const c = await evaluate(input({ kind: "code", sources: [code], input: rows }), box, CLOSED);
    expect(box.jobs.map((j) => [j.kind, j.from, j.input.length])).toEqual([
      ["expressions", 0, 600],
      ["code", 0, 600],
    ]);
    expect(new Set(r.evaluations.map((e) => (e.state === "done" ? e.values[0] : e.state)))).toEqual(
      new Set([600]),
    );
    expect(c.evaluations).toHaveLength(600);
  });

  it("AU-38 · the expressions of a step are evaluated for all its rows before its rows are worked on: a step with three parameters with JavaScript and 3,000 rows makes the calls of one, not of three", async () => {
    const box = fakeBox({
      [`$json.${price} + 1`]: ({ row: r }) => (r?.[price] as number) + 1,
      [`$json.${price} + 2`]: ({ row: r }) => (r?.[price] as number) + 2,
      [`$json.${price} + 3`]: ({ row: r }) => (r?.[price] as number) + 3,
    });
    const s = withSearch((x) =>
      x
        .step("Tres", "edit", {
          keep: "none",
          fields: [1, 2, 3].map((k) => ({
            field: `m${k}`,
            value: { expr: `{{ $json.${price} + ${k} }}` },
          })),
        })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Tres"),
    );
    const e = await go(s.build(), s.id("Inicio"), { box, collections: db(3000) });
    expect(box.jobs).toHaveLength(6);
    expect(box.jobs[0]?.sources).toHaveLength(3);
    expect(outOf(e, s.id("Tres"))?.[2999]).toEqual({ m1: 3000, m2: 3001, m3: 3002 });
  });

  it("AU-37 · the engine keeps nothing of an evaluation but its values, its console and its count: the same job sent twice to the fake box gives the same record, and no job holds anything the box answered before but the reads of its own step", async () => {
    const source = "return [$col('Pedidos').count()]";
    const box = fakeBox({
      [source]: (x) => {
        x.log("una vez");
        return "k" in x.job.reads
          ? [{ n: x.job.reads.k ?? null }]
          : ask("k", { collection: "Pedidos", op: "count" });
      },
    });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "all", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const a = connect(s.build(), s, "Código", [newConnection(orders.key)]);
    const one = await go(a, s.id("Inicio"), { box, collections: db() });
    const two = await go(a, s.id("Inicio"), { box, collections: db() });
    const strip = (r: Execution["steps"][string] | undefined) => ({
      ...r,
      ms: 0,
      reads: r?.reads?.map((x) => ({ ...x, ms: 0 })),
    });
    expect(strip(two.steps[s.id("Código")])).toEqual(strip(one.steps[s.id("Código")]));
    expect(box.jobs.map((j) => j.reads)).toEqual([{}, { k: 6 }, {}, { k: 6 }]);
    expect(one.steps[s.id("Código")]?.console?.lines).toHaveLength(1);
  });

  it("AU-37 · a «Código» that changes the rows that reach it changes only what its step gives: the earlier step's kept output, a test's ENTRADA and the collection keep the rows as they arrived (E3)", async () => {
    const source = `$json.${price} = 999; return $json`;
    const box = fakeBox({
      [source]: ({ row: r }) => {
        (r as Fields)[price] = 999;
        return r as Cell;
      },
    });
    const s = withSearch((x) =>
      x
        .step("Código", CODE_TYPE, { mode: "perRow", source })
        .arrow("Inicio", "Buscar")
        .arrow("Buscar", "Código"),
    );
    const data = db(3);
    const e = await go(s.build(), s.id("Inicio"), { box, collections: data });
    expect(outOf(e, s.id("Código"))?.map((r) => r[price])).toEqual([999, 999, 999]);
    expect(outOf(e, s.id("Buscar"))?.map((r) => r[price])).toEqual([0, 1, 2]);
    expect(data.rows(orders.key).map((r) => r.json[price])).toEqual([0, 1, 2, 3, 4, 5].slice(0, 3));
  });
});
