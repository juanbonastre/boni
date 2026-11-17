// The policy for the AI steps of an automation (docs/automatizaciones.md §5.5, §5.6 and §6, phase F15): what an AI
// step's write saves (the rows that replace P28's third), the connection checked inside `decide` (P29), and the
// rounds of an «Agente» over the plan language (AU-45, AU-56, AU-165, AU-198, AU-204, AU-205).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). One test per row of each table, as `automation-origin.test.ts` does for P28;
// the rounds run with a scripted model, never a real one.
import { describe, it } from "vitest";

describe("the policy for an automation's AI steps (F15)", () => {
  it.todo(
    "AU-45 · a «Sí» in a connection opens no destination taken from outside or from a model, and nothing of what Boni knows of the person",
  );
  it.todo(
    "AU-56 · a round is a plan validated and decided call by call with the origin `automation`; a plan that asks, remembers or goes outside is refused",
  );
  it.todo(
    "AU-165 · the policy changes in two places only: the rows of AU-204 and P29; every other rule answers this origin as before",
  );
  it.todo(
    "AU-198 · a plan that is not valid is asked again once within the round and then fails the step",
  );
  it.todo(
    "AU-204 · a value a model wrote, written by a «Código» or a «Colección» with the version's «Sí», is allowed and keeps its label",
  );
  it.todo(
    "AU-204 · a write an «Agente» chose, with its connection's «Sí» and nothing from outside in its unit, is allowed",
  );
  it.todo(
    "AU-204 · with something from outside in its unit an «Agente»'s create is allowed, and its modify and its trash are proposed while the constant says so",
  );
  it.todo(
    "AU-204 · without the «Sí» it is proposed (trash is confirmed), an ambient value is proposed, and the step type and the «Sí» never come from the call or a model",
  );
  it.todo(
    "AU-205 · a call from an AI step to a collection it has not connected, to an action set to «No», outside its rows or its fields, or over its row limit is denied (P29)",
  );
  it.todo(
    "AU-205 · a read by an AI step of a collection no model may read is denied, and a «Código» without AI is decided as before",
  );
});
