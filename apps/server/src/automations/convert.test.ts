// The conversion of the saved flows to automations (docs/automatizaciones.md §5.13, phase F16): when it happens,
// what it keeps, how it is undone, what happens to what was under way and to the old runs, and the order in which
// the old engine goes (AU-150, AU-152, AU-225, AU-226, AU-227, AU-228, with AU-230's case of a converted write).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test, invented flows shaped
// like a user's (generated ids, several versions, a draft half done) and a year of runs (A-15: 50 flows with 60
// versions, 20,000 runs with 200,000 steps, their clock from `@boni/pace`), and no model.
import { describe, it } from "vitest";

describe("the saved flows converted to automations (F16)", () => {
  it.todo(
    "AU-150 · every saved flow and Boni's four convert by code with their versions; «Función» and «Aplicar cambios» become two «Acción de Boni» that keep their guarantees; what cannot convert stays off with its notice",
  );
  it.todo(
    "AU-150 · the dry report of a conversion replays each flow's last runs in both engines without writing, and names counts, steps and how many agree, and none of the person's texts",
  );
  it.todo(
    "AU-225 · the conversion's list says for each automation «Hace lo mismo» or «Lo que cambia», and how many runs it has had since and how many failed",
  );
  it.todo(
    "AU-225 · it happens once at the store's opening, a flow per transaction, and running it again changes nothing; the id, the name, on or off and the schedule are kept",
  );
  it.todo(
    "AU-225 · each version of a flow is a version of its automation with its number, date and author, marked as converted, and a draft half done is its draft",
  );
  it.todo(
    "AU-225 · «Volver al flujo de antes» leaves the flow running as it was and the automation off, and nothing is deleted from the old tables",
  );
  it.todo(
    "AU-226 · a proposal waiting in the Bandeja is accepted as before, an old run that waits is resumed only by the engine that started it, and a scheduled flow runs once in each slot across the conversion",
  );
  it.todo(
    "AU-227 · the old runs are summary rows of their automation, copied in chunks with the server free between them, and still undone by their run id",
  );
  it.todo(
    "AU-227 · with a year of runs the conversion, the copy and the list of runs of the mail automation stay within their times",
  );
  it.todo(
    "AU-228 · no id has at once a flow that runs and an automation that is on, and the files already moved import nothing of the old engine",
  );
  it.todo(
    "AU-152 · after the removal nothing imports the old engine or the old editor, and nothing that runs reads the archived flow tables",
  );
  it.todo(
    "AU-230 · a flow that created a row, converted: none of its versions carries a «Sí», whoever starts it",
  );
});
