// The steps that talk to the person, in the engine (docs/automatizaciones.md §5.10, phase F15): «Preguntar»,
// «Avisar», «Responder», and a run that waits for an answer (AU-125, AU-201, AU-202, AU-203).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the engine with its effects injected (what is asked, what is
// notified, the run's answer) and its clock read from `@boni/pace` where a wait is bounded (T-11).
import { describe, it } from "vitest";

describe("the people steps (F15)", () => {
  it.todo(
    "AU-125 · «Preguntar» has its three parameters and two outputs: the row with its answer, and «sin respuesta»",
  );
  it.todo(
    "AU-125 · it asks once with all the rows; «Una vez por fila» with more than 20 rows fails before asking any",
  );
  it.todo(
    "AU-125 · an answer he writes carries his hand's label, and a chosen option keeps the option's label",
  );
  it.todo(
    "AU-201 · «Avisar» has no recipient parameter; one notice per run, and «Una vez por fila» sends 5 and then one that groups the rest",
  );
  it.todo("AU-201 · in a test it says what it would notify and sends nothing");
  it.todo(
    "AU-202 · a run has one answer, the last «Responder» that ran, as plain text with the label of what it cites",
  );
  it.todo(
    "AU-203 · a run that reaches «Preguntar» finishes what does not depend on the answer and waits; the steps after it get no rows until it is answered",
  );
  it.todo(
    "AU-203 · answered, it goes on from that step with the outputs it kept; past its wait limit it leaves by «sin respuesta»",
  );
  it.todo(
    "AU-203 · the run's time limit counts what runs and not what waits; rows written and model calls are counted across the wait",
  );
});
