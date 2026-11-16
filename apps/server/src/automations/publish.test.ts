// Publishing over the real store (docs/automatizaciones.md §5.8: AU-95, AU-96, AU-98, AU-188, AU-191, AU-194, and the
// map of AU-47; phase F14d): a version is a row that never changes, only the published one runs, and a draft never
// does. Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in
// its name (`make check` reads them, T-10). When they run: a store per test, with collections whose keys and names
// are shaped like the user's (seed.test-util.ts), and no model call.
import { describe, it } from "vitest";

describe("only the published version runs (F14d)", () => {
  it.todo(
    "AU-95 · with a draft that would write one thing and a published version that writes another, every route of automations/routes.ts that runs for real writes only what the published version writes, and each operation of the log carries a run that names that version",
  );
  it.todo(
    "AU-95 · an automation never published is run by no route and by no schedule, and «Probar» still tests its draft and writes nothing",
  );
  it.todo(
    "AU-95 · the function that runs for real takes no document: no body, query or header of a request reaches the engine as the automation to run",
  );
  it.todo(
    "AU-95 · publishing writes a version that is never changed afterwards (its document, its number, its hash, when, from which device and whose), and the same document as the one that runs writes no new version",
  );
  it.todo(
    "AU-95 · publishing asks for the draft's `rev`: a draft changed since by another device is not published, and the answer says so",
  );
  it.todo(
    "AU-95 · the tables of versions are in the user's store and none of their rows is an operation of the log: Undo never takes back a publish",
  );
});

describe("what «Publicar» answers (F14d)", () => {
  it.todo(
    "AU-96 · the route that «Publicar» reads gives the three things for the draft of now (what changes against the version that runs, what is missing or worth a look, what it will be able to do), and the first time says that publishing turns it on",
  );
  it.todo(
    "AU-96 · the server refuses to publish with a problem, or an empty required parameter, on a step a trigger reaches, whatever the app sent; with the same problem on a step no trigger reaches it publishes",
  );
});

describe("«Versiones» (F14d)", () => {
  it.todo(
    "AU-98 · the list gives each version's number, when, whose («user»; «preset» reads «De Boni») and which one runs, without reading any document",
  );
  it.todo(
    "AU-98 · going back to the 2 from the 4 publishes a 5 with the document of the 2, after the same checks as any publish, and leaves the draft, with its unpublished changes, exactly as it was",
  );
  it.todo(
    "AU-98 · going back to a version whose collection no longer exists is refused with the problem named, and nothing is published",
  );
});

describe("the switch and a deleted automation (F14d)", () => {
  it.todo(
    "AU-194 · the first publish turns the automation on and a later publish leaves the switch as it was; off, no real run starts, at its hour or by «Ejecutar», and «Probar» still works",
  );
  it.todo("AU-194 · turning it on runs nothing that was due while it was off");
  it.todo(
    "AU-191 · a deleted automation runs at no hour and by no hand, keeps its draft, its versions and its runs, is listed among the deleted ones, and recovered comes back off with all of them",
  );
});

describe("a «Sí» only from the user's hand, on the server (F14d)", () => {
  it.todo(
    "AU-188 · every function of the service that writes a draft is in one list, as the user's hand or as arriving without it, and each of the second kind passes through `lowerYes`: a new one missing from the list fails this test",
  );
  it.todo(
    "AU-188 · the «Sí» a run obeys is read from the published version in the store: one claimed by the box's answer, by a request's body or by a draft changes nothing",
  );
});

describe("the map (F14d)", () => {
  it.todo(
    "AU-47 · a published automation enters the map with what its published version reads and writes and with its trigger; its draft never does, and a change of the draft moves nothing in the map until it is published",
  );
  it.todo(
    "AU-47 · the map counts an automation's runs by the index, never reading them, and a test does not count",
  );
});
