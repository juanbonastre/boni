// A «Código» that saves (docs/automatizaciones.md AU-172 to AU-185; writes.ts). The lists run already: they hold what
// the builders and the screen count on while they are apart from `CODE_*`. The rest is pending: the builder turns each
// into a real one, keeping the rule's id in its name (`make check` reads them). Every rule holds against code written
// to get around it (A-01): the rules such code could get around have their attack here. Real tests use the fakes of
// run.test-util.ts; collection and field names in them are invented («Gastos», «Categorías», «Notas»).
import { describe, expect, it } from "vitest";
import { CODE_FAILURES, CODE_LIMITS, CODE_PROBLEMS } from "./code.ts";
import { CONNECTION_ACTIONS } from "./connections.ts";
import { STEP_FAILURES, StepFault } from "./failures.ts";
import { PROBLEMS } from "./validate.ts";
import {
  COL_METHODS,
  WRITE_ACTIONS,
  WRITE_FAILURES,
  WRITE_LIMITS,
  WRITE_MODES,
  WRITE_PROBLEMS,
  WriteFault,
} from "./writes.ts";

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
  it.todo(
    "AU-176 · a «Código»'s connection takes «No», «Preguntar» or «Sí» for `create`, `update` and `remove`, each on its own (modify «Sí» with remove «No» holds as written); a new connection only reads, and `connectionActions('code')` gives the four",
  );
  it.todo(
    "AU-176 · a code that asks for an action its connection does not give is `code.write.notAllowed` with the collection and the action, and cannot run; its fix sets that cell to «Preguntar», never «Sí»",
  );
  it.todo(
    "AU-176 · a connection changed after the code was checked is what counts: the engine holds each request to the connection as saved, and one it no longer allows fails with `code.write.notAllowed` and saves nothing",
  );
  it.todo(
    "AU-177 · with «Solo estas filas» a code cannot modify or remove a row outside it (`code.write.outside`, `row`), nor create one that would not pass it with the collection's defaults (`created`); a modify may take a row out of it",
  );
  it.todo(
    "AU-177 · with «Solo estos campos» a code cannot set a field outside them (`code.write.hidden`), even one it never read, and creating fills the rest with the collection's defaults",
  );
  it.todo(
    "AU-178 · the chip and the sentence of a connection say what it can save: «Solo lee», «Lee y modifica», «Lee, crea y modifica», «· pregunta antes», from `permissions` and the words of `i18n.ts`",
  );
  it.todo(
    "AU-179 · `connectionUses` says of each write action allowed whether the code uses it, and lists one used and not allowed: «Sí · lo usa», «Preguntar · sin usar», and the problem for the third; one allowed and unused is not a problem",
  );
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
  it.todo(
    "AU-183 · `readWrites` finds every call that asks to save wherever it sits (an `if` never taken, a loop, a function never called) and `grantsOf` gives one pair per collection and action",
  );
  it.todo(
    "AU-183 · only `$col('Nombre').método(…)` validates, for reading too: `const g = $col('Gastos')`, passing it, returning it, `$col('Gastos')[accion](…)` and a method `$col` does not have are `code.colUse` with the fix",
  );
  it.todo(
    "AU-183 · `$col` reached any other way (`globalThis['$c' + 'ol']`, `this`, `eval`, `Function`, a getter, a `Proxy`) gives no method the grants do not have: in the box, `$col` of a collection has only the write methods granted",
  );
  it.todo(
    "AU-183 · a request the analysis did not see fails the step with `code.write.unseen` and saves nothing, even when the box's answer is forged to carry it; the server reads the grants from the code as saved at every run, never from the box or a browser",
  );
  it.todo(
    "AU-184 · an expression never saves: `{{ $col('Gastos').update(…) }}` is `code.readInExpression`, and an evaluation of expressions whose answer carries a request fails the step with `code.write.unseen` (`expression`)",
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
