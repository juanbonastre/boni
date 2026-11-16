// Reading JavaScript before it runs (docs/automatizaciones.md §5.3, §5.4, §6; javascript.ts, expression.ts). Pending:
// the first PR of F14c brings one test per rule, and the builder turns each into a real one, keeping the rule's id in
// its name (`make check` reads them). Real tests read code as text and run none: no box, no store. Step, field and
// collection names in them are invented and say nothing of anyone's data (D-14).
import { describe, it } from "vitest";

describe("an expression with JavaScript", () => {
  it.todo(
    "AU-22 · an expression is text with JavaScript between `{{ }}`: `parseExpression` gives its parts in order, a simple citation as a citation and anything else as code with its source, and printing the parts gives the text back",
  );
  it.todo(
    "AU-22 · a `{{ }}` ends at the first `}}` that leaves a whole JavaScript expression before it: an object written inside, or a text that holds `}}`, does not close it; one that never closes is `code.syntax` with its place",
  );
  it.todo(
    "AU-22 · a value that is one `{{ }}` alone keeps the type of what it gives (a number, a list, a date); with text around it is text: null gives nothing, a number its digits, an object its JSON",
  );
  it.todo(
    "AU-22 · a `{{ }}` with a statement, an assignment or more than one expression does not validate (`code.syntax`): an expression gives a value and nothing else",
  );
  it.todo(
    "AU-22 · validation gives `expr.code` for JavaScript only while the run has no box; with one, the same automation validates and its `{{ }}` that are not simple citations are the box's",
  );
});

describe("what code may name", () => {
  it.todo(
    "AU-24 · `readCode` reads the same names in an expression and in a «Código»: `$json`, `$input` with `.all()`, `.first()`, `.last()` and `.item`, `$('Step')`, `$now`, `$today`, `$run`, `$page`, `$date` and `console`; a `$name` that is none of `CODE_GLOBALS` is `code.unknownGlobal`",
  );
  it.todo(
    "AU-24 · `$json` and `.item` in a «Código» that runs once with all the rows are `expr.noCurrentRow`; a step cited that does not always run before this one is `expr.notBefore`, and `.item` across a step that remakes the rows is `expr.cannotPair`: the codes simple citations already have",
  );
  it.todo(
    "AU-24 · `$col` in an expression is `code.readInExpression`; `await`, `async`, `import` and a generator are `code.cannotWait`, in an expression and in a «Código»",
  );
  it.todo(
    "AU-25 · fields are read by their key: `$json.precio`, `$json['precio']` and `const { precio } = $json` each read the field `precio`, and `readCode` says where; a row handed on whole, or a key that is calculated, reads all its fields",
  );
});

describe("what an evaluation receives", () => {
  it.todo(
    "AU-163 · `readCode` lists the steps the code cites and, of each, the fields it reads; a step it does not cite is not in the list, whatever a comment or a text inside the code says",
  );
  it.todo(
    "AU-163 · `$(…)` with anything but a text written there (a variable, a sum of texts, a template with a value) is `code.computed`, and so is `$col(…)`; `$` and `$col` given another name, or reached through `globalThis`, are `code.computed` too",
  );
  it.todo(
    "AU-163 · code that hides a citation from the reader (a name built at run time, `$` inside `eval` or `Function`) gets nothing by it: the job the engine sends holds only the steps `readCode` listed",
  );
  it.todo(
    "AU-31 · `$col('Name')` of a collection the step has no reading connection to is `code.notConnected` with the collection's key, and of a name no collection has, `code.unknownCollection`: with either, `canRun` is false",
  );
});

describe("the editor's model", () => {
  it.todo(
    "AU-36 · the completions at a place of the code are the names of `CODE_GLOBALS`, the steps that always run before this one, after `$('Step').first().` the fields its last test gave (inserted by key, shown by name) and inside `$col('` the collections connected, never one that is not",
  );
  it.todo(
    "AU-36 · every problem of the code has its place (`from`, `to`, `line`, `column`), and a field read that the cited step's last test did not give is listed with its place, so the editor marks it before any test",
  );
  it.todo(
    "AU-36 · a field read that the cited step's last test did not give is a warning, not an error: `canRun` stays true and a test is not stopped by it, while a step or a collection that does not exist is an error",
  );
  it.todo(
    "AU-35 · a «Código» longer than `CODE_LIMITS.sourceChars` and a `{{ }}` whose JavaScript is longer than `CODE_LIMITS.expressionChars` are `code.long` with the limit and what they have, and one that is exactly at the limit validates",
  );
  it.todo(
    "AU-02 · renaming a step rewrites `$('Old')` as `$('New')` in every `{{ }}` and every «Código» of the automation, with either kind of quotes, touches no text or comment that only says the same words, and every one of them gives the same value as before the rename",
  );
});
