// What «Publicar» and «Versiones» show, as pure functions (docs/automatizaciones.md §5.8, AU-96, AU-98, AU-182, AU-47,
// AU-192; phase F14d): the difference between two documents, what stops a publish and what is worth a look, and what
// the automation will be able to do. Pending: the phase's first PR brings one test per rule and its builders make each
// real, the rule's id kept in its name (`make check` reads them, T-10).
import { describe, it } from "vitest";

describe("the difference between two versions (F14d)", () => {
  it.todo(
    "AU-96 · `diffAutomations` names each step added, removed and changed (which parameters, which connections, which settings), the arrows, the name, the trigger and the limits; moving a box is no difference",
  );
  it.todo(
    "AU-98 · the same difference serves two published versions: comparing the 2 with the 4 marks what «Versiones» paints as added, removed and changed, and a version compared with itself has none",
  );
});

describe("what stops a publish and what is worth a look (F14d)", () => {
  it.todo(
    "AU-96 · a problem of the validation, or an empty required parameter, on a step a trigger reaches stops the publish and names the step; the same on a step no trigger reaches does not",
  );
  it.todo(
    "AU-96 · what is worth a look and stops nothing: an output not connected, a step no trigger reaches, a step never tested or with a stale test, a pinned output, a limit that is not its default",
  );
});

describe("what it will be able to do (F14d)", () => {
  it.todo(
    "AU-96 · `abilities` says, by collection, what the automation reads and what it creates, modifies and removes, and of each write whether it saves on its own or asks, one line per collection and action",
  );
  it.todo(
    "AU-182 · for every example of the catalogue that saves, each change the engine would accept from a «Código» (what its analysis saw and its connection allows) is named in `abilities` with its collection and its action, and one the connection does not allow is not",
  );
  it.todo(
    "AU-182 · a removal with «Sí», of a connection or of «Eliminar filas», is named with «sin preguntar», and one with «Preguntar» is not",
  );
  it.todo(
    "AU-182 · a write with «Sí» whose step can receive something from outside (a source of outside in its path of rows or of control, or a read of a collection given as holding outside values) says «con datos de fuera», for create, update and remove alike; one with «Preguntar», or with no such path, does not",
  );
  it.todo(
    "AU-47 · every change a step can make (`stepChanges`) and every read of a connection is in `abilities`, which is what the map reads: nothing a published version can touch is missing from it",
  );
});

describe("the names a version keeps (F14d)", () => {
  it.todo(
    "AU-192 · a version keeps, for each collection its code cites by name, the key that name was when it was published, and only for the collections connected to that step",
  );
  it.todo(
    "AU-192 · in the draft, a code that cites a collection by a name it no longer has is a problem that says the name of today, and the fix rewrites that citation and nothing else",
  );
});
