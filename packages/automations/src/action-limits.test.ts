// The limits of each write action of a connection (docs/automatizaciones.md §5.5, §5.6 and §6, phase F15): «Solo
// estas filas» and «Solo estos campos» per action, the fields an AI decides, «Como mucho N filas», and what a write
// gives back (AU-48, AU-52, AU-171, AU-196).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will check the stored connection in the engine (`insideConnection`),
// for a «Código» and for an «Agente» alike, with a store per test and 3,000 rows where a count is bounded (A-15).
import { describe, it } from "vitest";

describe("the limits of a write action (F15)", () => {
  it.todo(
    "AU-48 · an action's filter and fields narrow on top of the connection's read limits: a row outside either is not modified or trashed",
  );
  it.todo(
    "AU-48 · a created row gets the action's fixed values, and a field outside «Solo estos campos» is refused",
  );
  it.todo(
    "AU-52 · the fields control gives `fields` (those the AI decides) and `fixed` (fixed values and expressions); an unmarked field is never written",
  );
  it.todo(
    "AU-52 · an option the field does not have, or a related row the step did not read in this run, is refused",
  );
  it.todo(
    "AU-171 · what a write gives back is cut by the connection's read limits; without read permission, only the fields it set and the id, in a test too",
  );
  it.todo(
    "AU-196 · a «Código»'s request that would pass «Como mucho» fails as any that cannot be saved and says both numbers; an «Agente»'s call is refused and told to the model",
  );
  it.todo(
    "AU-196 · a write action of an «Agente» that leaves «No» is born with a limit of 20 rows; a «Código»'s is born without one, and a «Colección» step has none",
  );
});
