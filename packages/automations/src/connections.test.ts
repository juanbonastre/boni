// A step's connections and their limits (docs/automatizaciones.md §5.5; connections.ts). Pending: the first PR of F14c
// brings one test per rule, and the builder turns each into a real one, keeping the rule's id in its name (`make
// check` reads them). Real tests use the fakes of run.test-util.ts; collection and field names in them are invented.
import { describe, it } from "vitest";

describe("the format", () => {
  it.todo(
    "AU-40 · a step holds its connections in `connections`, one per collection by its key, each saying what it may do there: `parseAutomation` reads them and writes them back the same, and refuses a connection with a key it does not know",
  );
  it.todo(
    "AU-40 · two connections of one step to the same collection are `connection.repeated`, one to a collection that does not exist `connection.unknown`, more than `MAX_CONNECTIONS` `connection.many`",
  );
  it.todo(
    "AU-40 · `permissions` gives one entry per permission, with its filter, its fields and its limit, in the order of the connections: what the chip under the step says («Lee · solo este año»)",
  );
  it.todo(
    "AU-41 · `newConnection` reads with no limits and gives no permission to write; `connectionActions` of «Código» is `read` alone, and a «Código» whose connection creates, modifies or removes is `connection.write`",
  );
  it.todo(
    "AU-41 · a connection never holds `remove` with `yes`, and a limit that is not one (a field the collection does not have, a limit of 0 or over `CODE_LIMITS.readRows`) is `connection.limits` with what is wrong",
  );
  it.todo(
    "AU-46 · only «Código» takes connections in F14c: on any other type of the catalogue a connection is `connection.notAllowed`, and a «Código» with none validates and reads no collection",
  );
});

describe("the limits of reading", () => {
  it.todo(
    "AU-43 · `narrow` adds the connection's filter with «y» to the one the code asks for: for a table of asks and filters, every row that comes back passes both, and no ask gets a row the connection's filter leaves out, with `get`, `count` and `sum` too",
  );
  it.todo(
    "AU-43 · with «Solo estos campos» a row comes back with those fields and its id and no other, and an ask that filters, sorts or sums by a field outside them is `code.read.query` (`hidden`): a hidden field cannot be guessed by asking",
  );
  it.todo(
    "AU-43 · a read gives at most the smaller of the limit the code asks for and the connection's, cut without failing; with neither, a read that would give more than `CODE_LIMITS.readRows` fails with `code.limit` and is never cut, and `count` and `sum` have no such limit",
  );
  it.todo(
    "AU-43 · a relation of a row read comes as the related row's id, never its fields: the other collection is read only through a connection of its own",
  );
  it.todo(
    "AU-43 · a step's print holds its connections: changing a limit, or connecting or disconnecting a collection, makes its kept test stale",
  );
  it.todo(
    "AU-44 · the sentence under the table is made from `permissions` alone: in F14c it names every collection read, each with whether it has a filter, fewer fields or a limit, and a step with no connection says that it reads nothing",
  );
});
