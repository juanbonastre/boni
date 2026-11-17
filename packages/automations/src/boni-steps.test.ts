// The category «Boni» of the catalogue (docs/automatizaciones.md §5.9 and §5.10, phase F16): Boni's triggers, the
// pieces of its own automations as step types, and the two generic steps that carry what the catalogue has no name
// for, «Acción de Boni» and «Lector de Boni» (AU-127, AU-220).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the engine with a scripted port for Boni's code
// (`RunDeps.boni`), as the AI steps do with a scripted model: this package imports no app (A-02).
import { describe, it } from "vitest";

describe("the steps of the category «Boni» (F16)", () => {
  it.todo(
    "AU-127 · each piece is a step type with its name and only the parameters it lets change; it validates only inside its own automation, and a copy loses it and says so",
  );
  it.todo(
    "AU-127 · a piece runs through the port it is given, has no write cells, and in «Probar» changes nothing and says what it would do",
  );
  it.todo(
    "AU-127 · «Acción de Boni» names one action as a literal and «Lector de Boni» one reader; the add panel offers neither",
  );
  it.todo(
    "AU-220 · «Llega un correo» is a trigger any automation may use and gives one row labelled as from outside; the other three exist only in their own automation",
  );
});
