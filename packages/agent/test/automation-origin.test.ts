// The policy for what a published automation writes (docs/automatizaciones.md §6: AU-167, AU-186, AU-195, AU-193's
// accepted removal, and the decision 11 of its §10; docs/nucleo.md §7.5, the row P28 and the new sentences of P4, P5,
// P7 and P15; docs/principios.md A-36; phase F14d). `decide` learns one origin, `automation`, the same for a run the
// user starts and for one that starts alone, and what it answers is one test per row of the rule. Pending: the
// phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its name
// (`make check` reads them, T-10).
import { describe, it } from "vitest";

describe("what a step of a published version writes (P28, F14d)", () => {
  it.todo(
    "AU-167 · from the origin `automation`, creating or modifying is allowed (P28) when the call carries the «Sí» of the published version for that collection and that action, and reading is allowed as in the background",
  );
  it.todo(
    "AU-167 · with that «Sí», a value from outside (P4) and a path that depends on something from outside (P15) are allowed too, for create, update and remove: P28 is the one exception to both rules",
  );
  it.todo(
    "AU-167 · without that «Sí», the origin `automation` gets a proposal for a create or an update and a confirmation for a removal, whatever its values carry",
  );
  it.todo(
    "AU-167 · from the origin `automation`, a value a model wrote or one of an ambient turn (`model`, `ambient`) is proposed, with or without the «Sí»: nothing a model wrote is saved alone in this phase",
  );
  it.todo(
    "AU-167 · from the origin `automation`, the policy's count of writes (P11) asks nothing, at 20 rows or at 3,000: the cap is the run's own limit; from a turn it still asks",
  );
  it.todo(
    "AU-167 · from the origin `automation`, sending, going outside and what cannot be undone are denied, a destination from outside or from a model is denied (P2, P14) and memory with something from outside is denied (P9), with the «Sí» too",
  );
  it.todo(
    "AU-167 · no other origin gains the exception: from a turn, the background of before, a mini-app or an assistant, a write with something from outside is answered as before (P4, P15, P7, P24), with or without a «Sí» in the call",
  );
});

describe("the trash with the user's «Sí» (P5, F14d)", () => {
  it.todo(
    "AU-186 · from the origin `automation`, sending a row to the trash is allowed only when the call carries the «Sí» of the published version for that collection; without it, it is confirmed (P5)",
  );
  it.todo(
    "AU-186 · with that «Sí», a removal whose rows were chosen by something from outside (values or path) is allowed as one with none: the two conditions are the published version and the «Sí»",
  );
  it.todo(
    "AU-186 · the «Sí» counts for no other origin: from a turn, the background, a mini-app or an assistant, the same call is answered as before (P5, P24)",
  );
  it.todo(
    "AU-193 · a removal accepted inside the proposal of a run, from a personal device, is not confirmed again (P5's new sentence); accepted in any other proposal, or from a device that is not personal, it is answered as before",
  );
});

describe("who starts a run (A-36, F14d)", () => {
  it.todo(
    "AU-195 · the same published version with the same input gets the same decision for every write (allow, propose, confirm, deny) started by hand and started by its trigger: for each act of `ACTS`, each label of value and of path and each cell, by a table written in the test",
  );
  it.todo(
    "AU-195 · who started the run is no input of `decide`: a real run by hand no longer asks as `hand` (P25), and with «Preguntar» both a run by hand and a run that starts alone propose",
  );
  it.todo(
    "AU-195 · each act of an automation (`ACTS`) is answered for `automation`, dry and not, and for `accepted`, by a table written in the test: no origin is left to a default",
  );
});
