// JavaScript in an automation over the real store and the real box (box.ts, collections.ts, policy.ts;
// docs/automatizaciones.md §5.4, §5.5, §6). Pending: the first PR of F14c brings one test per rule, and the builder
// turns each into a real one, keeping the rule's id in its name (`make check` reads them). Real tests start the real
// box on a socket of the test (apps/sandbox's `startBox`: the server's PR makes that package a dev dependency of this
// one, for its tests alone) and a store with collections shaped like the user's (generated ids, many fields, 3,000
// rows: seed.test-util.ts), and call no model. The one that runs holds the limits to what the box allows.
import { CODE_LIMITS } from "@boni/automations";
import { MAX_LIMITS, MAX_REQUEST_BYTES } from "@boni/sandbox";
import { describe, expect, it } from "vitest";

describe("the limits of JavaScript and the box's", () => {
  it("every limit an evaluation is sent with is one the box allows, and a job fits a request's line", () => {
    expect(CODE_LIMITS.ms).toBeLessThanOrEqual(MAX_LIMITS.ms);
    expect(CODE_LIMITS.steps).toBeLessThanOrEqual(MAX_LIMITS.steps);
    expect(CODE_LIMITS.memoryBytes).toBeLessThanOrEqual(MAX_LIMITS.memoryBytes);
    expect(CODE_LIMITS.stackBytes).toBeLessThanOrEqual(MAX_LIMITS.stackBytes);
    expect(CODE_LIMITS.outputBytes).toBeLessThanOrEqual(MAX_LIMITS.outputBytes);
    expect(CODE_LIMITS.inputBytes + CODE_LIMITS.sourceChars * 4).toBeLessThan(MAX_REQUEST_BYTES);
  });
});

describe("«Código» over the real store and the real box", () => {
  it.todo(
    "AU-31 · the code of the design's §5.4, with collections of other names, runs in a test over a store with 3,000 rows: it reads the collection it is connected to with `find`, adds up its input and gives one row per row read, twice the same",
  );
  it.todo(
    "AU-161 · a read from code goes through the step's connection and `storeCollections` behind the policy of a test: a collection that is private for automations is denied whatever the connection says, and the rows read carry the labels the store gives them, a field from outside as from outside",
  );
  it.todo(
    "AU-161 · the connection is read from the automation as it is saved in the store, never from what the box or the request says: a job answered by a box that asks for a collection that is not connected reads nothing",
  );
  it.todo(
    "AU-43 · with «Solo estas filas» on the connection, no `find`, `get`, `count` or `sum` from code gives or counts a row outside it, over the real store with 3,000 rows, and a `get` of a row outside it gives null, as for a row that does not exist",
  );
  it.todo(
    "AU-169 · a row made by «Código» from a collection with a field from outside is from outside in the step after it, and a «Colección» step that would write it asks instead of writing, in a test too",
  );
  it.todo(
    "AU-27 · the value under an expression and the value the test gave its row are the same over the real box, for a table of expressions with dates in the user's zone on the days it changes its hour",
  );
  it.todo(
    "AU-28 · the zone table the server sends is the zone's as `packages/calendar/src/time.ts` says it for every day of `ZONE_YEARS`, for zones with and without changes of hour, and the names of months and days are `time.ts`'s",
  );
  it.todo(
    "AU-34 · the run's instant and seed are kept with the test: «Probar paso» on a later step reuses what the «Código» before it gave, and running the «Código» again takes the new test's",
  );
  it.todo(
    "AU-35 · with no box listening, or with its door full, the step fails with `code.unavailable` and what it says, nothing was read and the server goes on, and a box that answers after the call's time is not waited for",
  );
  it.todo(
    "AU-33 · the console and the message of an error are kept with the step's test in the user's store and given by page with it, and neither is written to the server's log",
  );
  it.todo(
    "AU-38 · a test of an automation with a `{{ }}` of JavaScript over 3,000 rows, and one with a «Código» that reads 3,000 rows and runs once per row of 3,000, each end within the time written in the test and hold the server under the memory written in it",
  );
});
