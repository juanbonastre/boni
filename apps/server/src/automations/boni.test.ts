// Boni's own automations on the new engine (docs/automatizaciones.md §5.9, §5.10 and §5.15, phase F16): the four it
// ships as automations «De: Boni» with their versions, their triggers fired through the same path as any other, the
// pieces behind the port, and the reviewer that needs a model (AU-127, AU-211, AU-220, AU-221).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test, invented mail and a
// scripted model, and a year of mail for the times (A-15: 11,000 runs, their clock from `@boni/pace`).
import { describe, it } from "vitest";

describe("Boni's own automations (F16)", () => {
  it.todo(
    "AU-221 · the four that were flows are automations with Boni as the author of its versions; the person's changes are their own versions, «Volver al de Boni» publishes Boni's last one, and none can be deleted",
  );
  it.todo(
    "AU-221 · the version of Boni's that ships with the phase is drawn by hand in the new format and, on invented mail, asks for the same as the old flow did",
  );
  it.todo(
    "AU-221 · a deploy with a new version of Boni's runs it only where Boni's was running; over the person's own it waits in «Versiones»",
  );
  it.todo(
    "AU-220 · each of Boni's triggers starts its run through the published path and none through the old scheduler; a look at the mailbox with no mail is not a run, the review runs once a day at most and the spending notice once a month",
  );
  it.todo(
    "AU-220 · with a year of mail, starting a run, listing them and pruning them stay within their times",
  );
  it.todo(
    "AU-127 · the mail automation, converted, reads an invented mail and proposes what the old flow proposed, with the same cards; its caps cannot be changed from a step",
  );
  it.todo(
    "AU-211 · the reviewer of an «Agente» is an automation of Boni of its own, with its switch; it starts from decisions made by hand on that step's proposals, measures its change dry on up to 20 of those cases, and suggests a draft change at most once a day, never a published one",
  );
  it.todo(
    "AU-211 · with «Aprender» off, or its automation off, the reviewer suggests nothing; the signals, the counts and the pause stay where F15 put them",
  );
});
