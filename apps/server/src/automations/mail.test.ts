// Mail as an automation (docs/automatizaciones.md §5.17, phase F16): «Leer correo» is its own document, what it
// saves is decided by a cell, each thing it proposes is its own card, the «Decisora»'s doubt is a «Preguntar», the
// day's cap sits at the trigger, and the conversion of the mail settings loses nothing (AU-246 to AU-252).
//
// The design's pending tests, one per rule (T-10): S2b makes them run, each with invented mails and scripted
// readers, never a real mailbox or a model.

import { describe, it } from "vitest";

describe("mail as an automation (§5.17)", () => {
  it.todo(
    "AU-246 · «Leer correo» runs from its document alone: nothing regenerates it, a step gets only the trigger's row and its own panel, and an example that quotes a mail stays labelled as from outside",
  );
  it.todo(
    "AU-247 · what «Crear en la elegida» creates goes through its cell: born «Preguntar» in every collection, saved with a «Sí» of his hand, and with «Solo conocidos» a thing from a sender not yet known is still proposed",
  );
  it.todo(
    "AU-248 · a run that only asks to create five rows or fewer is one card per row: accepting one saves that row and leaves the others waiting, a corrected one counts as a miss, and a failed run withdraws no earlier card of the thread",
  );
  it.todo(
    "AU-249 · a row the «Decisora» is unsure of leaves by «Duda» to a «Preguntar»: the run waits, the answer goes on to the chosen collection, and «Ninguna» or an expired question creates nothing",
  );
  it.todo(
    "AU-250 · past the day's cap of an automation that starts with a mail no run starts and no model is called, the mail waits for the next day, and a read mail is a run in «Ejecuciones» with no line in the server's log",
  );
  it.todo(
    "AU-251 · the conversion of mail keeps the mailbox, the read marks and the pending cards, writes the collections, the guide and the rules into the steps' panels, and leaves every cell in «Preguntar» even with «Solo» on",
  );
  it.todo(
    "AU-252 · a piece's reader gets what came from a mail only between the markers and labelled as from outside, the sender's pending titles included, and beside it only its panel and closed lists: a row of the person's, or a field label set on the trigger's row, fails with ai.private",
  );
});
