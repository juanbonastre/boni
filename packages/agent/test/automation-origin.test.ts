// The policy for an automation that starts on its own (docs/automatizaciones.md §6: AU-167, AU-186, AU-195,
// and AU-193's accepted removal; docs/nucleo.md §7.5, the row P28 and the new sentence of P5; phase F14d). `decide` learns one origin, `automation`,
// and what it answers is one test per row of the rule. Pending: the phase's first PR brings one test per rule and its
// builders make each real, the rule's id kept in its name (`make check` reads them, T-10).
import { describe, it } from "vitest";

describe("an automation that starts alone (P28, F14d)", () => {
  it.todo(
    "AU-167 · from the origin `automation`, creating or modifying with every value and the path at least `imported` is allowed (P28), and reading is allowed as in the background",
  );
  it.todo(
    "AU-167 · from the origin `automation`, a value from outside is proposed (P4) and a path that depends on something from outside is proposed (P15), whatever else the call says: both rules come before P28",
  );
  it.todo(
    "AU-167 · from the origin `automation`, a value a model wrote or one of an ambient turn (`model`, `ambient`) is proposed: nothing a model wrote is saved alone in this phase",
  );
  it.todo(
    "AU-167 · from the origin `automation`, the policy's count of writes (P11) asks nothing, at 20 rows or at 3,000: the cap is the run's own limit; from a turn it still asks",
  );
  it.todo(
    "AU-167 · from the origin `automation`, sending, going outside and what cannot be undone are denied, and a destination from outside or from a model is denied as from any origin (P2)",
  );
  it.todo(
    "AU-167 · the background of before does not change: from the origin `background` a write is still proposed (P7), with or without the «Sí»",
  );
});

describe("the trash with the user's «Sí» (P5, F14d)", () => {
  it.todo(
    "AU-186 · from the origin `automation`, sending a row to the trash is allowed only when the call carries the «Sí» of the published version for that collection and nothing from outside; without it, it is confirmed (P5)",
  );
  it.todo(
    "AU-186 · with that «Sí» and something from outside in the values or in the path, the removal is proposed: the «Sí» never passes P4 or P15",
  );
  it.todo(
    "AU-186 · the «Sí» counts for no other origin: from a turn, the background, a mini-app or an assistant, the same call is answered as before (P5, P24)",
  );
  it.todo(
    "AU-193 · a removal accepted inside the proposal of a run, from a personal device, is not confirmed again (P5's new sentence); accepted in any other proposal, or from a device that is not personal, it is answered as before",
  );
});

describe("who starts a run (F14d)", () => {
  it.todo(
    "AU-195 · each act of an automation (`ACTS`) is answered for each origin that can start a run (`hand`, `automation`, `accepted`), dry and not, by a table written in the test: no origin is left to a default",
  );
});
