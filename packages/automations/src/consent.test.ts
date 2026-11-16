// What saves without asking, in the engine (docs/automatizaciones.md §5.8, §5.10, §6: AU-186, AU-187, AU-188, AU-170;
// phase F14d): the two doors of a write (the user's cell, then the policy), the «Permiso» of a «Colección» step, a «Sí»
// lowered when it did not come from the user's hand, and the label each asked value carries. Pending: the phase's
// first PR brings one test per rule and its builders make each real, the rule's id kept in its name (`make check`
// reads them, T-10). Those of writes.test.ts that name these rules stay there.
import { describe, it } from "vitest";

describe("the two doors of a write (F14d)", () => {
  it.todo(
    "AU-186 · the cell first: «No» fails the step, «Preguntar» makes the step's whole change wait as one proposal in any run (one started by hand too), and «Sí» goes on to the policy",
  );
  it.todo(
    "AU-186 · with «Sí» and a policy that allows, a real run saves the step's change and asks nothing: no constant makes a «Sí» ask (`YES_SAVES` is gone)",
  );
  it.todo(
    "AU-186 · a cell never turns the policy's answer: with «Sí», a change the policy proposes is proposed and one it denies fails the step, for create, update and remove alike",
  );
  it.todo(
    "AU-186 · in a test, a step asks when its cell says «Preguntar» or when the policy would ask a real run, whoever starts it: create and update with «Sí» add nothing to «Haría esto», remove with «Sí» says «sin preguntar»",
  );
});

describe("«Permiso» of a «Colección» step (F14d)", () => {
  it.todo(
    "AU-187 · «Crear una fila», «Modificar filas» and «Eliminar filas» each have a parameter «Permiso», «Preguntar» or «Sí», in view and with the words of a connection's cells; a document saved without it reads the value the action is born with",
  );
  it.todo(
    "AU-187 · `stepChanges` gives each write of a «Colección» step with the mode of its «Permiso», so its card and «Haría esto» say «sin preguntar» of a removal exactly as for a «Código» with «Sí»",
  );
  it.todo(
    "AU-187 · the value each action is born with is one constant of the catalogue: a step added by the user's hand has «Preguntar» on remove and the catalogue's value on create and update; one that arrives any other way has «Preguntar» on the three",
  );
});

describe("a «Sí» only from the user's hand (F14d)", () => {
  it.todo(
    "AU-188 · `lowerYes` lowers every «Sí» of a document that arrives without the user having written it to «Preguntar»: create, update and remove of each connection, and the «Permiso» of the three write actions of a «Colección» step",
  );
  it.todo(
    "AU-188 · with the draft it replaces, a «Sí» that draft already had for the same step, collection and action stays when the step arrives unchanged; one on another collection, another action or a new step is lowered",
  );
  it.todo(
    "AU-188 · a «Sí» of a step whose code, parameters, connection or incoming arrows the arrival changed is lowered: a «Sí» given to one code does not pass to another",
  );
  it.todo(
    "AU-188 · `lowerYes` changes nothing else: «No» and «Preguntar» stay, reading stays, and a document with no «Sí» comes back equal",
  );
});

describe("what is asked keeps where it came from (F14d)", () => {
  it.todo(
    "AU-170 · each change a run asks about (`Asked`) carries its values with the label of each, the same the engine gives a change it saves: a value from outside is asked as from outside",
  );
});
