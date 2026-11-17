// The «Agente» step in the engine (docs/automatizaciones.md §5.6 and §6, phase F15): its two ways of reading, its
// answer, «Lo que hizo», how it runs, what its model receives, its rounds and the run's count of model calls
// (AU-51, AU-53, AU-54, AU-55, AU-58, AU-197, AU-198, AU-200, AU-206).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the engine with a scripted model behind the port it receives
// (no model call, no provider imported: A-02), a store per test and data shaped like the user's
// (`seed.test-util.ts`: generated ids, 3,000 rows where a bound is checked, A-15).
import { describe, expect, it } from "vitest";
import { countModelCall, LimitPassed, StopRun } from "./engine.ts";
import { AUTOMATION_LIMITS, type Automation, limitsOf } from "./format.ts";

describe("the «Agente» step (F15)", () => {
  it.todo(
    "AU-51 · «Las decide la IA»: a read the plan asks for is narrowed by the step's connection, like a «Código»'s",
  );
  it.todo(
    "AU-51 · «Las hace este código»: the code runs once per unit before the first round, only reads (a write call in it is `agent.reads.write`), and the model's schema has no read",
  );
  it.todo(
    "AU-53 · «Texto» gives one row with `texto`, «Campos» a row of that shape; an answer outside the shape is asked again once and then fails the step (`agent.reply`)",
  );
  it.todo(
    "AU-53 · the answer is labelled `model`, and also as from outside when it cites by handle a value the model did not read",
  );
  it.todo(
    "AU-54 · «Lo que hizo» is written by code from the plan steps that ran, in order, with rounds, model calls, the model that answered and the time; at most 50 lines per unit",
  );
  it.todo("AU-54 · in a test the lines say what it would do and nothing is saved or proposed");
  it.todo(
    "AU-55 · «Una vez con todas las filas» is one unit of work; «Una vez por fila» is one unit per row, each with its own rounds",
  );
  it.todo(
    "AU-58 · «Rondas máximas» is born at 5 and a document asking for more than 10 does not validate",
  );
  it.todo(
    "AU-58 · a code tool runs in the box with the step's connections and only reads; what it returns goes through the planner's view",
  );
  it.todo(
    "AU-197 · what the model receives is a closed list: a new source in the request breaks this test",
  );
  it.todo(
    "AU-197 · a value from outside in «Instrucciones» or in the input rows reaches the model as a handle, never as its text",
  );
  it.todo(
    "AU-198 · a plan without an answer opens another round with what it returned; rounds used up fail the step (`agent.rounds`) and save nothing",
  );
  it.todo(
    "AU-198 · a round returns at most 200 rows and 20,000 characters to the next, saying what was left out, with 3,000 rows in the collection",
  );
  it.todo(
    "AU-198 · a request outside the connection is refused, told to the model in the next round and written in «Lo que hizo»; the step does not fail",
  );
  it.todo(
    "AU-198 · the writes of a unit are decided at the end as one change: all saved, or all waiting in the run's proposal if one of them asks; a step that fails leaves nothing saved",
  );
  it.todo(
    "AU-200 · `abilities` gives one line per collection and action an «Agente»'s connection allows, each marked as decided by the AI",
  );
  it("AU-206 · each round, each reader call and each retry counts; the call that would pass the limit is not made and the run stops with `run.limit`", () => {
    // The count every model call of a run goes through (`StepContext.modelCall`, which E2's reader and E3's
    // «Agente» call before each call, retries included): with «Llamadas a modelos» at 3, three are made and the
    // fourth is refused before it is made, saying the limit's key and both numbers, as every limit of the run does.
    const limits = limitsOf({ settings: { limits: { modelCalls: 3 } } } as Pick<
      Automation,
      "settings"
    >);
    expect(limits.modelCalls).toBe(3);
    let made = 0;
    for (let i = 0; i < 3; i++) made = countModelCall(limits, made);
    expect(made).toBe(3);
    let stopped: unknown = null;
    try {
      made = countModelCall(limits, made);
    } catch (e) {
      stopped = e;
    }
    expect(made).toBe(3);
    // A `StopRun`: no retry and no «Si falla» apply; its failure is `run.limit` (limits.test.ts, AU-17).
    expect(stopped).toBeInstanceOf(LimitPassed);
    expect(stopped).toBeInstanceOf(StopRun);
    expect(stopped).toMatchObject({ limit: "modelCalls", max: 3, got: 4 });
    // Born at 20 and never over 40, as the format says.
    expect(limitsOf({ settings: {} } as Pick<Automation, "settings">).modelCalls).toBe(20);
    expect(AUTOMATION_LIMITS.modelCalls).toEqual({ default: 20, ceiling: 40 });
  });
});
