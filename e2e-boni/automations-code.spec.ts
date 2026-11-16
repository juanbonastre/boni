import { test } from "@playwright/test";

/**
 * JavaScript in «Automatizaciones» on the screen, F14c (docs/automatizaciones.md §5.3, §5.4, §5.5): expressions with
 * JavaScript and their preview, the «Código» step with its editor and its «Consola», and the connections with
 * collections. Pending: the first PR of the phase brings one test per rule, and the builders of its screens turn each
 * into a real one, keeping the rule's id in its name (`make check` reads them). A file of its own: automations.spec.ts
 * is F14b's.
 *
 * How they are written when they run: as automations.spec.ts, over the mocked server of fixtures.ts, with
 * collections whose keys and names are shaped like the user's and, where a rule is about many, with many (a test of
 * 3,000 rows, a collection of 40 fields). Typing goes at a person's pace where time matters (the preview of an
 * expression, the editor's marks). The same over the real server and the real box is
 * e2e-boni-desktop/automations-code.spec.ts.
 */

test.describe("an expression with JavaScript", () => {
  test.fixme("AU-22 · typing `{{` in a fixed value turns it into an expression with what was written kept, and the JavaScript between `{{ }}` is painted as code beside the chips of its simple citations", async () => {});
  test.fixme("AU-23 · after a test, under an expression: «= 5 · con la fila 3 de 128», with the two arrows that pass to the row before and after; typing at a person's pace asks for the value once the typing stops, and the value of an older text never replaces a newer one's", async () => {});
  test.fixme("AU-23 · with a step before it never tested or stale it says «Prueba los pasos anteriores» with the button that tests them, and an expression that fails says why in the app's words, under it", async () => {});
  test.fixme("AU-25 · a field dragged into JavaScript is written by its key (`$json.precio`), the entry and the completion show its name («Precio»), and nowhere outside an expression or a «Código» is a key read", async () => {});
});

test.describe("«Código»", () => {
  test.fixme("AU-30 · «Código» is in «Añadir paso» under «Transformar»; opened, it shows «Se ejecuta» with «Una vez con todas las filas» chosen and «Una vez por fila», and the editor: no more than seven rows of «Parámetros»", async () => {});
  test.fixme("AU-25 · in the view of a «Código» step each field of its input shows its key beside its name, and a field that the code made is seen in the steps after it by the name the code gave it (`total`)", async () => {});
  test.fixme("AU-33 · after «Probar paso», «Consola» is a strip under the step's output, folded when it is empty, with each line and the line of the code that wrote it; with lines left out it says how many", async () => {});
  test.fixme("AU-33 · code that throws marks its line in the editor and says the message as it is, as plain text: a message with HTML or a link is read letter by letter", async () => {});
  test.fixme("AU-33 · what the code wrote to «Consola» is painted as plain text: a line with HTML, Markdown or a link is read letter by letter, and nothing in it can be clicked", async () => {});
  test.fixme("AU-35 · a «Código» that passes a limit says which and the limit («Ha tardado más de 5 s», «Ha devuelto 12.000 filas; el máximo son 10.000») in the step, in the app's words", async () => {});
  test.fixme("AU-35 · every limit of `CODE_LIMITS` has its words in Spanish and in English, with the limit in them, and a «Código» or a `{{ }}` that is too long says so before any test", async () => {});
  test.fixme("AU-36 · the editor completes `$('` with the steps before this one, after a step its fields by name, and `$col('` with the collections connected; a step, a field or a collection that does not exist is underlined before any test, with what is wrong on hover and for a keyboard", async () => {});
  test.fixme("AU-36 · the editor is the app's: its colours are the theme's in light and in dark, it is used whole with the keyboard (Tab leaves it after Escape), and it is not loaded until a «Código» or an expression is opened", async () => {});
  test.fixme("AU-36 · what the editor underlines is what validation says, no more and no less: the problems the server gives for the same code are the marks, each at its place", async () => {});
  test.fixme("AU-36 · a field the cited step's last test did not give is underlined as a warning and «Probar paso» still runs; a step or a collection that does not exist is an error and it does not", async () => {});
  test.fixme("AU-31 · `$col('Libros')` with «Libros» not connected marks the step, cannot be tested, and says «Conecta «Libros» a este paso» with the button that connects it; pressed, the problem goes and the table has its row", async () => {});
});

test.describe("connections", () => {
  test.fixme("AU-40 · a connection hangs under its step on the canvas by a dotted line: one chip per collection with its permissions in words («Lee», «Lee · con filtro»), and it follows the step when Boni places the boxes", async () => {});
  test.fixme("AU-41 · in the view of a «Código» step the connections are a table, one row per collection and the one column «Leer», «No» or «Sí»; connecting a collection reads it and nothing more, and a row opens to set its limits, after which its cell says «Sí · con filtro»", async () => {});
  test.fixme("AU-43 · a connection's row opens «Solo estas filas» (the views' filter, with the collection's fields), «Solo estos campos» and a limit; each is saved with the draft and seen again when the step is opened", async () => {});
  test.fixme("AU-44 · under the table a sentence says all the step reads («Puede leer Libros (con filtro) y Autores. No puede crear, modificar ni eliminar nada.») and changes as the table does", async () => {});
  test.fixme("AU-46 · only «Código» shows connections: no other step of the catalogue has the table or a chip under it", async () => {});
});
