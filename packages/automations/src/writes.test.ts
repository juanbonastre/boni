// A «Código» that saves (docs/automatizaciones.md AU-172 to AU-185; writes.ts). The lists run already: they hold what
// the builders and the screen count on while they are apart from `CODE_*`. The rest is pending: the builder turns each
// into a real one, keeping the rule's id in its name (`make check` reads them). Every rule holds against code written
// to get around it (A-01): the rules such code could get around have their attack here. Real tests use the fakes of
// run.test-util.ts; collection and field names in them are invented («Gastos», «Categorías», «Notas»).
import { describe, expect, it } from "vitest";
import { collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { CODE_FAILURES, CODE_LIMITS, CODE_PROBLEMS, CODE_TYPE } from "./code.ts";
import {
  allowing,
  CONNECTION_ACTIONS,
  type Connection,
  connectionActions,
  newConnection,
  permissions,
} from "./connections.ts";
import { STEP_FAILURES, StepFault } from "./failures.ts";
import type { Step } from "./format.ts";
import { type CodeContext, readCode } from "./javascript.ts";
import { canRun, PROBLEMS, validate } from "./validate.ts";
import {
  COL_METHODS,
  connectionUses,
  grantsOf,
  readWrites,
  WRITE_ACTIONS,
  WRITE_FAILURES,
  WRITE_LIMITS,
  WRITE_MODES,
  WRITE_PROBLEMS,
  WriteFault,
  writeProblems,
} from "./writes.ts";

const next = ids(13);
const expenses = collection(next, ["number", "text"]);
const categories = collection(next, ["text"]);
const notes = collection(next, ["text"]);
const NAMES: Record<string, string> = {
  Gastos: expenses.key,
  Categorías: categories.key,
  Notas: notes.key,
};
const named = (name: string) => NAMES[name];
const ctx: CodeContext = {
  ...knowing(expenses, categories, notes),
  collectionNamed: named,
  collectionName: (key) => Object.entries(NAMES).find(([, k]) => k === key)?.[0],
};

/** A trigger, a search, then a «Código» with that source and those connections. */
function withCode(source: string, connections: Connection[]) {
  const s = sketch(5)
    .step("Inicio", "manual", { fields: [] })
    .step("Buscar", "collection", { collection: expenses.key, action: "find" })
    .step("Código", CODE_TYPE, { mode: "all", source })
    .arrow("Inicio", "Buscar")
    .arrow("Buscar", "Código");
  const a = s.build();
  const step = a.steps.find((x) => x.name === "Código") as Step;
  step.connections = connections;
  return { a, step };
}
const codes = (problems: readonly { code: string }[]) => problems.map((p) => p.code);
const ofStep = <P extends { step?: string }>(problems: readonly P[], step: Step) =>
  problems.filter((p) => p.step === step.id);
/** A connection to «Gastos» that reads and gives these write cells. */
const toExpenses = (cells: Partial<Pick<Connection, "create" | "update" | "remove">> = {}) => ({
  ...newConnection(expenses.key),
  ...cells,
});
/** The text a site or a problem's place points at. */
const cut = (source: string, at: { from: number | string; to: number | string }) =>
  source.slice(Number(at.from), Number(at.to));

describe("the lists of saving from code", () => {
  it("every limit of saving is a whole number over zero, and none has the key of a limit of `CODE_LIMITS`", () => {
    for (const [key, value] of Object.entries(WRITE_LIMITS)) {
      expect(Number.isInteger(value), key).toBe(true);
      expect(value, key).toBeGreaterThan(0);
      expect(key in CODE_LIMITS, key).toBe(false);
    }
  });

  it("what one evaluation may ask fits a step, a request fits a step, and what one read gives can be written back", () => {
    expect(WRITE_LIMITS.writes).toBeLessThanOrEqual(WRITE_LIMITS.stepWrites);
    expect(WRITE_LIMITS.writeBytes).toBeLessThanOrEqual(WRITE_LIMITS.stepWriteBytes);
    expect(WRITE_LIMITS.stepWrites).toBeGreaterThanOrEqual(CODE_LIMITS.readRows);
    expect(WRITE_LIMITS.stepWriteBytes).toBeLessThanOrEqual(CODE_LIMITS.outputBytes);
  });

  it("no failure or problem of saving is one the engine or validation already has, so the lists can be joined", () => {
    const failures = new Set<string>([...STEP_FAILURES, ...CODE_FAILURES, ...WRITE_FAILURES]);
    expect(failures.size).toBe(STEP_FAILURES.length + CODE_FAILURES.length + WRITE_FAILURES.length);
    const problems = new Set<string>([...PROBLEMS, ...CODE_PROBLEMS, ...WRITE_PROBLEMS]);
    expect(problems.size).toBe(PROBLEMS.length + CODE_PROBLEMS.length + WRITE_PROBLEMS.length);
  });

  it("the write actions are the connection's, each takes «Preguntar» or «Sí» on its own, and `$col` has no other method", () => {
    for (const action of WRITE_ACTIONS) {
      expect(CONNECTION_ACTIONS).toContain(action);
      expect(WRITE_MODES[action]).toEqual(["ask", "yes"]);
    }
    expect(new Set(COL_METHODS).size).toBe(COL_METHODS.length);
  });

  it("a failure of saving is a `StepFault` that says which", () => {
    const fault = new WriteFault("not allowed", {
      code: "code.write.notAllowed",
      detail: { collection: "gastos", action: "update" },
    });
    expect(fault).toBeInstanceOf(StepFault);
    expect(fault.failure).toEqual({ code: "other", param: "source" });
    expect(fault.why.code).toBe("code.write.notAllowed");
  });
});

describe("asking to save", () => {
  it("AU-172 · the three methods that ask to save are `.create({ … })`, `.update(id, { … })` and `.remove(id)` of `$col('Nombre')`, with the words of «Colección» (create, update, remove), and the analysis reads each call as one request of its action, in the order of the source, at the whole call; the four that read are no request", () => {
    expect(COL_METHODS.filter((m) => !(WRITE_ACTIONS as readonly string[]).includes(m))).toEqual([
      "find",
      "get",
      "count",
      "sum",
    ]);
    const source = [
      "const rows = $col('Gastos').find({ limit: 3 })",
      "$col('Notas').create({ texto: 'resumen' })",
      "for (const r of rows) $col('Gastos').update(r.id, { categoria: 'Casa' })",
      "$col('Gastos').remove(rows[0].id)",
      "return [{ n: $col('Notas').count() + $col('Gastos').sum('importe') }]",
    ].join("\n");
    const reading = readWrites(source, "code");
    expect(reading.problems).toEqual([]);
    expect(reading.writes.map((w) => [w.name, w.action, cut(source, w.at)])).toEqual([
      ["Notas", "create", "$col('Notas').create({ texto: 'resumen' })"],
      ["Gastos", "update", "$col('Gastos').update(r.id, { categoria: 'Casa' })"],
      ["Gastos", "remove", "$col('Gastos').remove(rows[0].id)"],
    ]);
    expect(reading.writes.map((w) => [w.at.line, w.at.column])).toEqual([
      [2, 1],
      [3, 23],
      [4, 1],
    ]);
    // `readCode` gives the same, in the same walk that finds the collections it cites.
    const read = readCode(source, "code");
    expect(read.writes).toEqual(reading.writes);
    expect(read.collections.map((c) => c.name)).toEqual(["Gastos", "Notas"]);
  });
  it.todo(
    "AU-172 · `$col('Gastos').update(id, { categoria })`, `.create({ … })` and `.remove(id)` return `undefined` and save nothing while the code runs: the evaluation's result lists them as requests, in the order asked",
  );
  it.todo(
    "AU-172 · a read after a request does not see it: `update` then `find` of the same row gives the row as saved, in a run and in «Probar»",
  );
  it.todo(
    "AU-172 · an id is data: `update` with a number, an object or an id of another collection's row fails at save (`code.write.request` or `row.missing`), never earlier and never by luck",
  );
  it.todo(
    "AU-173 · the requests are applied when the step ends, in the order asked within an evaluation and in the order of the rows in «Una vez por fila»; only the last complete pass of an evaluation repeated for its reads counts, so a pass stopped at a read adds none",
  );
  it.todo(
    "AU-173 · `update` and `remove` read the saved row once for the limits, «Haría esto» and the version: a row changed between that read and the write fails the step with `row.changed` and saves nothing",
  );
});

describe("all or nothing", () => {
  it.todo(
    "AU-174 · the policy is asked for every request before any is written: one refused fails the step with `policy.denied` and none of the others is saved",
  );
  it.todo(
    "AU-174 · a step's requests are written in one transaction of the store: a failure in the middle (the 3,000th of 3,000) leaves every row as it was",
  );
  it.todo(
    "AU-174 · a «Preguntar» on any action asked for makes the whole step's change wait as one proposal («todo junto», Juan, 2026-11-16): modifying 12 rows with «Sí» and removing one with «Preguntar» proposes 13, and saves none",
  );
  it.todo(
    "AU-174 · a code that throws after its requests, or a step that fails for any other reason, saves nothing; under «Si falla: seguir» the requests of the failed row are dropped and the others are saved",
  );
  it.todo(
    "AU-174 · every operation of the step carries the run, so undoing the run undoes all of them and nothing else",
  );
  it.todo(
    "AU-175 · more than `WRITE_LIMITS.writes` requests stops the box with `code.limit` (`writes`) even inside an endless loop; over `stepWrites`, `writeBytes` or `stepWriteBytes` fails the step and saves nothing, never a part",
  );
  it.todo(
    "AU-175 · the requests count towards the output that AU-17 limits: a step cannot pass `CODE_LIMITS.outputBytes` by asking instead of returning",
  );
});

describe("the connection's permission", () => {
  it("AU-176 · a «Código»'s connection takes «No», «Preguntar» or «Sí» for `create`, `update` and `remove`, each on its own (modify «Sí» with remove «No» holds as written); a new connection only reads, and `connectionActions('code')` gives the four", () => {
    expect(connectionActions(CODE_TYPE)).toEqual(CONNECTION_ACTIONS);
    expect(permissions([newConnection(expenses.key)])).toEqual([
      { collection: expenses.key, action: "read", mode: "yes" },
    ]);
    const source = "$col('Gastos').update('r_1', { importe: 1 })\nreturn []";
    for (const create of [false, { mode: "ask" }, { mode: "yes" }] as const)
      for (const update of [{ mode: "ask" }, { mode: "yes" }] as const)
        for (const remove of [false, { mode: "ask" }, { mode: "yes" }] as const) {
          const c = toExpenses({ create, update, remove });
          const { a, step } = withCode(source, [c]);
          const said = JSON.stringify({ create, update, remove });
          expect(ofStep(validate(a, ctx), step), said).toEqual([]);
          // Each cell is said as written, with its mode: what the chip and «sin preguntar» read (AU-178, AU-189).
          expect(
            permissions([c]).map((p) => [p.action, p.mode]),
            said,
          ).toEqual([
            ["read", "yes"],
            ...(create ? [["create", create.mode]] : []),
            ["update", update.mode],
            ...(remove ? [["remove", remove.mode]] : []),
          ]);
        }
  });
  it("AU-176 · a code that asks for an action its connection does not give is `code.write.notAllowed` with the collection's key, the action and the call's place, at every call, and cannot run; its fix sets that cell to «Preguntar», never «Sí», and leaves a cell that allows it as it is", () => {
    const source = [
      "for (const r of $input.all()) {",
      "  if (r.json.importe > 100) $col('Gastos').remove(r.json.id)",
      "  $col('Gastos').update(r.json.id, { importe: 0 })",
      "}",
      "if (false) $col('Gastos').remove('r_1')",
      "return []",
    ].join("\n");
    const { a, step } = withCode(source, [toExpenses({ update: { mode: "yes" } })]);
    const problems = ofStep(validate(a, ctx), step);
    expect(codes(problems)).toEqual(["code.write.notAllowed", "code.write.notAllowed"]);
    expect(problems.map((p) => p.detail?.action)).toEqual(["remove", "remove"]);
    expect(problems[0]).toMatchObject({
      severity: "error",
      param: "source",
      detail: { collection: expenses.key, line: 2, column: 29 },
    });
    expect(problems.map((p) => cut(source, p.detail as { from: number; to: number }))).toEqual([
      "$col('Gastos').remove(r.json.id)",
      "$col('Gastos').remove('r_1')",
    ]);
    expect(canRun(problems)).toBe(false);
    // `writeProblems` says the same of the step alone.
    expect(writeProblems(step, a, ctx)).toEqual(problems);
    // The fix: «Preguntar».
    const fixed = allowing(toExpenses({ update: { mode: "yes" } }), "remove");
    expect(fixed).toEqual(toExpenses({ update: { mode: "yes" }, remove: { mode: "ask" } }));
    step.connections = [fixed];
    expect(ofStep(validate(a, ctx), step)).toEqual([]);
    for (const action of WRITE_ACTIONS) {
      expect(allowing(newConnection(expenses.key), action)[action]).toEqual({ mode: "ask" });
      const given = toExpenses({ [action]: { mode: "yes" } });
      expect(allowing(given, action)).toBe(given);
    }
    // A collection with no connection says so as before (AU-31), not as a permission.
    const unconnected = withCode("$col('Notas').create({ texto: 'x' })\nreturn []", []);
    expect(codes(ofStep(validate(unconnected.a, ctx), unconnected.step))).toEqual([
      "code.notConnected",
    ]);
  });
  it.todo(
    "AU-176 · a connection changed after the code was checked is what counts: the engine holds each request to the connection as saved, and one it no longer allows fails with `code.write.notAllowed` and saves nothing",
  );
  it.todo(
    "AU-177 · with «Solo estas filas» a code cannot modify or remove a row outside it (`code.write.outside`, `row`), nor create one that would not pass it with the collection's defaults (`created`); a modify may take a row out of it",
  );
  it.todo(
    "AU-177 · with «Solo estos campos» a code cannot set a field outside them (`code.write.hidden`), even one it never read, and creating fills the rest with the collection's defaults",
  );
  it("AU-178 · AU-189 · `permissions` gives each write the connection allows with its mode, which is all the chip, the sentence and «sin preguntar» need: «Solo lee» has only `read`; a removal with «Sí» is told apart from one that asks, and creating or modifying with «Sí» carry the same mode", () => {
    expect(permissions([newConnection(expenses.key)]).map((p) => p.action)).toEqual(["read"]);
    const said = (c: Connection) => permissions([c]).map((p) => `${p.action}:${p.mode}`);
    expect(said(toExpenses({ update: { mode: "ask" }, remove: { mode: "yes" } }))).toEqual([
      "read:yes",
      "update:ask",
      "remove:yes",
    ]);
    expect(said(toExpenses({ create: { mode: "yes" }, remove: { mode: "ask" } }))).toEqual([
      "read:yes",
      "create:yes",
      "remove:ask",
    ]);
  });
  it.todo(
    "AU-178 · the chip and the sentence of a connection say what it can save: «Solo lee», «Lee y modifica», «Lee, crea y modifica», «· pregunta antes», from `permissions` and the words of `i18n.ts`",
  );
  it("AU-179 · `connectionUses` says of each write action allowed whether the code uses it, and lists one used and not allowed: «Sí · lo usa», «Preguntar · sin usar», and the problem for the third; one allowed and unused is not a problem", () => {
    const source = [
      "$col('Gastos').create({ importe: 1 })",
      "$col('Gastos').update('r_1', { importe: 2 })",
      "$col('Gastos').update('r_2', { importe: 3 })",
      "$col('Categorías').find()",
      "return []",
    ].join("\n");
    const connections = [
      toExpenses({ update: { mode: "yes" }, remove: { mode: "ask" } }),
      newConnection(categories.key),
    ];
    const uses = connectionUses(connections, readWrites(source, "code"), named);
    expect(
      uses.map((u) => [u.collection, u.action, u.allowed, u.used, u.at.map((s) => s.line)]),
    ).toEqual([
      [expenses.key, "create", false, true, [1]],
      [expenses.key, "update", "yes", true, [2, 3]],
      [expenses.key, "remove", "ask", false, []],
    ]);
    // The one used and not allowed is the problem; the one allowed and unused is none.
    const { a, step } = withCode(source, connections);
    expect(
      ofStep(validate(a, ctx), step).map((p) => [p.code, p.detail?.action, p.detail?.line]),
    ).toEqual([["code.write.notAllowed", "create", 1]]);
    expect(connectionUses([newConnection(notes.key)], readWrites(source, "code"), named)).toEqual(
      [],
    );
  });
});

describe("what the person sees", () => {
  it.todo(
    "AU-180 · `stepChanges` gives the collections and actions a step can change: a «Colección» step's action, a «Código»'s analysis whether its connection allows it yet or not, nothing for a code that changes only the rows it received in memory",
  );
  it.todo(
    "AU-180 · the card's mark says what the step changes («Modifica Gastos», «Crea y modifica Gastos», «Cambia Gastos y Notas»), the same mark for a «Colección» step and a «Código», and none for one that only reads",
  );
  it.todo(
    "AU-181 · «Probar» and «Probar paso» check every request as a run would and save none: «Haría esto» lists them («Modificaría 12 filas en Gastos») with each row before and after, and a request that would fail fails the test the same way",
  );
  it.todo(
    "AU-181 · the record of a real run lists what the step saved or proposed, row by row, and nothing for a step that failed",
  );
  it.todo(
    "AU-182 · «Lo que podrá hacer» in Publicar, and every proposal of an automation Juan did not write, list what each «Código» can change before he accepts it; a code that saves never runs before it is published",
  );
});

describe("the analysis binds", () => {
  it("AU-183 · `readWrites` finds every call that asks to save wherever it sits (an `if` never taken, a loop, a function never called) and `grantsOf` gives one pair per collection and action", () => {
    const source = [
      "if (false) $col('Gastos').remove('r_1')",
      "while ($json.n > 0) { $col('Gastos').update('r_2', { importe: 1 }); break }",
      "function nunca() { return $col('Notas').create({ texto: 'x' }) }",
      "const flecha = () => $col('Gastos').update('r_3', { importe: 2 })",
      "try { throw 1 } catch { $col('Categorías').create({ nombre: 'y' }) }",
      "[1].map(() => $col('Gastos')?.remove('r_4'))",
      "$col('Nadie').create({})",
      "return []",
    ].join("\n");
    const reading = readWrites(source, "code");
    expect(reading.problems).toEqual([]);
    expect(reading.writes.map((w) => `${w.name}.${w.action}@${w.at.line}`)).toEqual([
      "Gastos.remove@1",
      "Gastos.update@2",
      "Notas.create@3",
      "Gastos.update@4",
      "Categorías.create@5",
      "Gastos.remove@6",
      "Nadie.create@7",
    ]);
    // One pair per collection and action, by its key; a name no collection has gives none (it is
    // `code.unknownCollection` already).
    expect(grantsOf(reading, named)).toEqual([
      { collection: expenses.key, action: "remove" },
      { collection: expenses.key, action: "update" },
      { collection: notes.key, action: "create" },
      { collection: categories.key, action: "create" },
    ]);
    expect(grantsOf(readWrites("return $col('Gastos').find()", "code"), named)).toEqual([]);
  });
  it("AU-183 · only `$col('Nombre').método(…)` validates, for reading too: `const g = $col('Gastos')`, passing it, returning it, `$col('Gastos')[accion](…)` and a method `$col` does not have are `code.colUse` with the fix", () => {
    const forms = [
      ["const g = $col('Gastos'); g.update('r_1', { importe: 1 })", "kept", undefined],
      ["const g = $col('Gastos'); return g.find()", "kept", undefined],
      ["guardar($col('Gastos'))", "kept", undefined],
      ["return $col('Gastos')", "kept", undefined],
      ["const { update } = $col('Gastos')", "kept", undefined],
      ["(0, $col('Gastos')).remove('r_1')", "kept", undefined],
      ["const u = $col('Gastos').update; u('r_1', {})", "kept", "update"],
      ["$col('Gastos').update.call(null, 'r_1', {})", "kept", "update"],
      ["$col('Gastos')[accion]('r_1')", "computed", undefined],
      ["$col('Gastos')['update']('r_1', {})", "computed", undefined],
      ["$col('Gastos').delete('r_1')", "unknown", "delete"],
      ["$col('Gastos').constructor", "unknown", "constructor"],
    ] as const;
    const connected = [
      toExpenses({ create: { mode: "ask" }, update: { mode: "ask" }, remove: { mode: "ask" } }),
    ];
    for (const [line, why, method] of forms) {
      const source = `${line}\nreturn []`;
      const reading = readWrites(source, "code");
      expect(reading.writes, line).toEqual([]);
      expect(reading.problems, line).toMatchObject([
        { code: "code.colUse", severity: "error", detail: { why, name: "Gastos", line: 1 } },
      ]);
      expect(reading.problems[0]?.detail?.method, line).toBe(method);
      const { a, step } = withCode(source, connected);
      const problems = ofStep(validate(a, ctx), step).filter((p) => p.code === "code.colUse");
      expect(problems, line).toMatchObject([{ param: "source", detail: { why, name: "Gastos" } }]);
      expect(canRun(problems), line).toBe(false);
    }
    // The fix is the direct form, which validates.
    const { a, step } = withCode(
      "$col('Gastos').update('r_1', { importe: 1 })\nreturn $col('Gastos').find()",
      connected,
    );
    expect(ofStep(validate(a, ctx), step)).toEqual([]);
  });
  it.todo(
    "AU-183 · `$col` reached any other way (`globalThis['$c' + 'ol']`, `this`, `eval`, `Function`, a getter, a `Proxy`) gives no method the grants do not have: in the box, `$col` of a collection has only the write methods granted",
  );
  it.todo(
    "AU-183 · a request the analysis did not see fails the step with `code.write.unseen` and saves nothing, even when the box's answer is forged to carry it; the server reads the grants from the code as saved at every run, never from the box or a browser",
  );
  it("AU-184 · an expression never saves: `{{ $col('Gastos').update(…) }}` is `code.readInExpression`, to read or to save, and the analysis gives it no request", () => {
    for (const expr of [
      "$col('Gastos').update('r_1', { importe: 1 })",
      "$col('Gastos').create({ importe: 1 })",
      "$col('Gastos').remove('r_1')",
      "$col('Gastos').count()",
      "$col('Gastos')",
    ]) {
      expect(codes(readCode(expr, "expression").problems), expr).toEqual(["code.readInExpression"]);
      expect(readWrites(expr, "expression"), expr).toEqual({ writes: [], problems: [] });
    }
    const s = sketch(5)
      .step("Inicio", "manual", { fields: [] })
      .step("Buscar", "collection", { collection: expenses.key, action: "find" })
      .step("Editar", "edit", {
        fields: [
          { field: "nuevo", value: { expr: "{{ $col('Gastos').update('r_1', { importe: 1 }) }}" } },
        ],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Editar");
    const problems = validate(s.build(), ctx).filter((p) => p.step === s.id("Editar"));
    expect(codes(problems)).toEqual(["code.readInExpression"]);
    expect(canRun(problems)).toBe(false);
  });
  it.todo(
    "AU-184 · an evaluation of expressions whose answer carries a request fails the step with `code.write.unseen` (`expression`) and saves nothing",
  );
  it.todo(
    "AU-185 · a code's write is a change of its step: it carries the run, the version and the step, and its label (AU-169), so a value from outside is proposed (P4) and stored as from outside (AU-170)",
  );
  it.todo(
    "AU-185 · until F18 no automation starts on a change of a row, so a code's write starts nothing; F18's loop guard (AU-113) counts it as any write of a «Colección» step",
  );
});

describe("removing without asking (Juan, 2026-11-16)", () => {
  it.todo(
    "AU-186 · a removal from a published version's «Código» whose connection says «Sí», with nothing from outside in what the evaluation received, goes to the trash without a proposal, carries the run, and undoing the run brings the row back",
  );
  it.todo(
    "AU-186 · the same removal with something from outside in what the evaluation received (a value from a mail, or the path, AU-164) is proposed, and with it everything the step asks to save",
  );
  it.todo(
    "AU-186 · an «Agente»'s removal with «Sí» and something from outside in what it received is proposed, as any write of it (F15)",
  );
  it.todo(
    "AU-186 · nothing in an automation deletes for ever, whatever the cells say: every removal of a «Código», «Colección» or «Agente» step is the trash act, and the policy is told so",
  );
  it.todo(
    "AU-186 · a removal without the person's «Sí» for that collection, or from a draft, still confirms (P5); the assistant's own removals outside automations keep P5 and P24 as they are",
  );
  it.todo(
    "AU-186 · `consentOf` gives the published version's cell for a collection and action, and the server reads it from the version as saved: a «Sí» claimed by the box's answer or a browser is not one",
  );
  it.todo(
    "AU-187 · «Eliminar filas» of a «Colección» step takes «Permiso»: «Preguntar» by default, or «Sí»; with «Sí» a published run sends the rows to the trash without asking, with something from outside it proposes them",
  );
  it.todo(
    "AU-188 · an automation proposed by the assistant, by «Pedir a Boni» or «Escribir con IA», or brought by a package or a template, arrives with every «Sí» of saving lowered to «Preguntar» (`lowerYes`), for create, modify and remove alike",
  );
  it.todo(
    "AU-188 · a «Sí» the draft already had from the person's hand stays when a proposal is made over it; a «Sí» the proposal adds or changes is lowered, and the fix of a missing permission sets «Preguntar»",
  );
  it.todo(
    "AU-189 · a removal that will not ask reads «sin preguntar» in the connection's chip, the card's mark and «Haría esto», from `permissions` and `stepChanges`; creating and modifying with «Sí» add nothing",
  );
  it.todo(
    "AU-189 · «Lo que podrá hacer» names each removal that will not ask, apart from those that ask (F14d)",
  );
});
