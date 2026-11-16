// The box evaluating an automation's JavaScript (src/evaluate.ts; docs/automatizaciones.md §5.3, §5.4, §6). Pending:
// the first PR of F14c brings one test per rule, and the builder turns each into a real one, keeping the rule's id in
// its name (`make check` reads them). Real tests run the real interpreter, as box.test.ts and run.test.ts do for an
// extension's function: each attack is a file of test/cases, tried as an expression and as a «Código», in both modes,
// and through the socket for what only the door can stop (a call ended from outside, too many at once).
import { describe, it } from "vitest";

describe("nothing of outside", () => {
  it.todo(
    "AU-160 · code reaches no network, file, process, module, timer or worker: `fetch`, `require`, `import()`, `process`, `globalThis.constructor`, `Function('return this')()`, `setTimeout`, `WebAssembly` and `SharedArrayBuffer` give nothing of the host, as an expression and as a «Código»",
  );
  it.todo(
    "AU-160 · the interpreter is made new for each call, with a memory of its own that cannot grow past its limit, in a worker of its own that the door ends: a call that never yields is answered `timeout` and the next call is served",
  );
  it.todo(
    "AU-160 · what the code is handed is data and no object of the host: `$json`, `$input`, `$('Step')`, the rows of a read and the console's functions have no way to a host function, by their prototypes, their constructors or an error's stack",
  );
  it.todo(
    "AU-160 · an evaluation of protocol 2 and a function call of protocol 1 share the door and nothing else: neither sees the other's code, input or output, and with the door full both are told `busy`",
  );
  it.todo(
    "AU-34 · `Date.now()`, `new Date()` and `$now` give the request's instant, the same at the start and at the end of a long evaluation, and `performance`, `setTimeout` and `Atomics.wait` give no other clock",
  );
  it.todo(
    "AU-34 · `Math.random()` gives a fixed sequence from the request's seed and the row's place: the same request twice gives the same answer byte for byte, a row gives the same alone and in a batch, and two rows do not share a sequence; `crypto` gives nothing",
  );
  it.todo(
    "AU-34 · an answer says whether each evaluation read the clock or chance, and says no for one that did not",
  );
});

describe("one evaluation leaves nothing to the next", () => {
  it.todo(
    "AU-37 · a row's evaluation cannot leave anything to the next row's of the same batch: a variable without `const`, a property on `globalThis`, on `Object.prototype`, `Array.prototype` or `Function.prototype`, on a function of `$input` or on `console`, a `Symbol.for`, a getter left on a shared row: each either throws (`frozen`) or is not there for the next row",
  );
  it.todo(
    "AU-37 · the rows of a cited step, shared by every row of a batch, cannot be changed by one of them: writing a field, pushing to the list or deleting a key is `frozen`, with the line, and the message says to return a copy",
  );
  it.todo(
    "AU-37 · two calls share nothing: what the first defined, changed or read is not in the second, and the answer of a batch is the same as the answers of its rows sent one by one",
  );
});

describe("what code may name, and reads", () => {
  it.todo(
    "AU-24 · `$json` is the current row's fields and `$input.item` the same; `$input.all()`, `.first()` and `.last()` the batch's rows in «Una vez con todas las filas»; `$('Step').all()`, `.first()`, `.last()` and `.item` the rows sent for that step, and a step that was not sent throws by its name",
  );
  it.todo(
    "AU-24 · `$run` says whether it is a test and what started it, `$page` is null, and `$today` is the request's day in its zone at 00:00",
  );
  it.todo(
    "AU-24 · nothing is added to the prototypes of JavaScript's own values: a text, a list, a number and a date have the methods the language gives and no other (`'a'.toTitleCase` and `[].first` are undefined), and `$run` holds `test` and `startedBy` and no name or id",
  );
  it.todo(
    "AU-25 · a field is read by its key and a key that the row does not have gives undefined, never an error; a key like `__proto__`, `constructor` or `toString` in a row is a field like any other, in what comes in and in what goes out",
  );
  it.todo(
    "AU-31 · `$col('Name').find(…)`, `.get(id)`, `.count(…)` and `.sum(field, …)` give what the request holds for that read; without it the evaluation stops there and the answer says `needs` with the read as written and its key, and code that catches every error does not go on past it",
  );
  it.todo(
    "AU-31 · the same read written twice has one key, two reads that differ in anything have two, and a row of a batch that needs a read does not stop the rows that do not",
  );
  it.todo(
    "AU-32 · `$col('Name')` has find, get, count and sum and nothing else: create, update, remove and any other name are undefined, and nothing in the interpreter writes anywhere",
  );
  it.todo(
    "AU-30 · a «Código» is a function's body: `return` gives its result, with no `return` the answer is `result` (`nothing`), a promise is `result` (`promise`), and a function, a cycle or a number that is not finite `result` (`notJson`)",
  );
  it.todo(
    "AU-22 · an expression gives the value of its JavaScript: undefined is null, an error is `threw` with its message, and several expressions of one request are evaluated for each row and answered in order",
  );
});

describe("dates", () => {
  it.todo(
    "AU-28 · `$now.plus({ days: 7 })`, `.minus`, `.startOf` and `.endOf` of day, week (from Monday), month and year, `.diff` and the parts give, for a table of instants and zones with the days a zone changes its hour, what `packages/calendar/src/time.ts` gives for the same",
  );
  it.todo(
    "AU-28 · `.format` writes the tokens of `DATE_HELP` with the request's names of months and days and plain text between them; a token it does not have throws by its name, and a date outside the zone table's years takes the nearest end's offset",
  );
  it.todo(
    'AU-28 · `$date` makes a date from a day ("YYYY-MM-DD") or an instant and throws for anything else; `.toISO()`, `.toDay()` and `.toMillis()` give its text, its day and its instant; a date written to a row is its day or its instant, never an object, and `Intl` is not there',
  );
});

describe("the console, the limits and the cost", () => {
  it.todo(
    "AU-33 · `console.log`, `.info`, `.warn` and `.error` are answered in order, each with its text, the line of the source that wrote it and, per row, the row; values are written as text (an object as JSON, a cycle without failing), and an evaluation that fails keeps what it wrote before",
  );
  it.todo(
    "AU-33 · an error says its message as the code gave it and the line and column of the source as it was sent, in a «Código» and in each expression of a request; an error thrown as something that is not an Error is said as text",
  );
  it.todo(
    "AU-35 · time, operations, memory, stack, the answer's size and the console's lines each have their limit: a loop without end is `timeout` or `steps`, a list without end `memory`, a recursion without end is stopped at `stackBytes` as an error of the code (`threw`) that names the stack, long before the memory's limit, an answer too big `output` with its size, and after each the box serves the next call",
  );
  it.todo(
    "AU-35 · lines of console over the limit are counted and not kept, a line too long is cut, and neither fails the evaluation; more different reads than the limit is `reads`",
  );
  it.todo(
    "AU-38 · one expression over 3,000 rows in batches of `batchRows`, and a «Código» of «Una vez por fila» the same, each end within the time written in the test, and so do a «Código» with all 3,000 rows and one that reads 3,000 rows",
  );
});
