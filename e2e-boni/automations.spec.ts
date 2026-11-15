import { test } from "@playwright/test";

/**
 * «Automatizaciones» on the screen, F14b (docs/automatizaciones.md §5.7, §5.8; the sketch,
 * docs/maquetas/automatizaciones.html): the list, the canvas, adding a step, the step's view, dragging a field, the
 * draft that saves itself and «Probar». Pending: the first PR of the phase brings one test per rule, and the builder
 * turns each into a real one as its screen exists, keeping the rule's id in its name (`make check` reads them).
 *
 * How they are written when they run: over the mocked server of fixtures.ts (`openApp` with the answers of the
 * routes of apps/server/src/automations/routes.ts), with collections whose keys and names are like Juan's
 * (agent-scenarios.ts) and, where a rule is about many rows or many fields, with many: a test of 3,000 rows, a
 * collection of 40 fields. Typing and dragging go at a person's pace where time matters (the pause before a save,
 * the preview of an expression). The same things over the real server are e2e-boni-desktop/automations.spec.ts.
 */

test.describe("the list", () => {
  test.fixme("AU-60 · the sidebar, the collection's page and its crumbs, «Buscar», the conversation and the map say «Automatizaciones»; nothing on the screen says «Flujos», and «flujo» is read only in «Formato anterior»", async () => {});
  test.fixme("AU-61 · the list is a collection page, «Tabla | Mapa», with six columns: Nombre, Se inicia, Estado, Última ejecución, Ejecuciones and De; an automation of the new format says «Sin publicar» and one with no trigger «—»; a flow of before says «Encendida» or «Apagada»", async () => {});
  test.fixme("AU-61 · with no automation the page says what any empty collection says, with its «Nueva»; «Mapa» shows the flows of before and no automation that is not published", async () => {});
  test.fixme("AU-61 · «Nueva» opens the empty canvas and asks the server for nothing; the automation is in the list, named «Nueva automatización», once it has its first step", async () => {});
  test.fixme("AU-151 · «Nueva» always opens the new canvas; a flow of before opens the editor of before with «Formato anterior» by its name, and is saved, turned on and run as it was", async () => {});
});

test.describe("the editor", () => {
  test.fixme("AU-62 · the header has back, the name (edited in place), «Guardado» and «⋯» with Duplicar and Eliminar, and nothing else of its own; there is no bar under it and no button to save", async () => {});
  test.fixme("AU-62 · a change is saved after a short pause and on leaving the editor: «Guardando…», then «Guardado»; with the server failing, «Sin guardar · Reintentar», and it is saved when the server is back; opened again, the draft is as it was left", async () => {});
  test.fixme("AU-62 · «Duplicar» opens «<nombre> (copia)» with the same steps in the same places; «Eliminar» takes it off the list without asking and the «Deshacer» of its notice brings it back", async () => {});
  test.fixme("AU-63 · the canvas reads left to right: each step a card of one width with its icon, its name and one line of summary, both cut with an ellipsis and whole on hover and in the step's view; the outputs on the right with their names; a canvas with only its trigger says nothing more", async () => {});
  test.fixme("AU-64 · bottom left: zoom in, zoom out, fit and «Ordenar»; bottom centre: «Probar»; top right: «+»; at the bottom «Registro», folded, with one line: «Sin probar», then the last test", async () => {});
  test.fixme("AU-64 · «Probar» with several triggers opens a menu to choose one, asks a trigger's fields in a small box with the last ones filled in, says «Probando…» and cannot be pressed meanwhile; with problems it tests nothing, marks each step and «Registro» says how many and leads to the first", async () => {});
  test.fixme("AU-65 · a step is added from the «+» of the top, the «+» of an output with no arrow (or dragging from it), the «+» of a selected arrow and a right click on the canvas: the four open the same panel, and the step chosen ends connected, selected and open", async () => {});
  test.fixme("AU-66 · a selected step shows a short bar, Probar paso · Apagar · Eliminar · ⋯ (Cambiar nombre · Duplicar · Copiar); a selected arrow, «+» and delete; the right click on a step has seven things; nothing appears on hover; an off step says «Encender»", async () => {});
  test.fixme("AU-66 · deleting a step between two others joins them with one arrow; deleting one with two outputs in use takes its arrows", async () => {});
  test.fixme("AU-67 · after a test each arrow says how many rows passed («128 filas»; «0 filas» dimmed), an output with no arrow its count too, and each step how it ended (bien, falló, saltado, parado); a step that failed says why on its card in two lines at most, whole in its SALIDA with «Ir al parámetro», and in «Registro»; the ones that hung from it are «saltados»", async () => {});
  test.fixme("AU-68 · Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes a step added, removed, connected, moved, renamed and a parameter changed; Ctrl+C, X and V copy, cut and paste the selected steps with the arrows between them; Supr deletes, Intro opens, Esc closes; what was undone is saved; a key typed in a field is the field's; after a reload there is nothing to undo", async () => {});
  test.fixme("AU-05 · a box stays where it is dropped: after a reload and in another window it is there, and moving it does not say «Guardando…» of the draft nor age any test; a new step goes to the right of the one it hangs from and no other box moves; «Ordenar» moves them all and Ctrl+Z puts them back", async () => {});
  test.fixme("AU-87 · adding a step puts that step and nothing else: no other step, arrow or option appears, and nothing changes on the canvas that Juan did not do", async () => {});
});

test.describe("adding a step", () => {
  test.fixme("AU-69 · the panel is on the right with its search on top: on an empty canvas it asks «¿Cómo empieza?» and lists the triggers; then the three categories of F14b by what one wants to do, and «Añadir otro disparador» last; «Colección» shows its actions as phrases", async () => {});
  test.fixme("AU-69 · the search looks in every category at once by a step's name and its actions', and with nothing found says «Nada con «…»»; under 1100 px the panel goes over the canvas", async () => {});
  test.fixme("AU-86 · a new step is named by what it does («Buscar filas en Gastos») and the name follows its collection until Juan renames it; a second «Filtrar» is «Filtrar 2»; renaming a step changes the chips that cite it", async () => {});
});

test.describe("the step's view", () => {
  test.fixme("AU-70 · a double click or Intro opens the step over the dimmed canvas in three columns, ENTRADA · «Parámetros | Ajustes» · SALIDA, with its icon, its name (edited there), «Probar paso» and close; Esc closes; there is no «Guardar»; a trigger's ENTRADA is its «Datos de prueba»", async () => {});
  test.fixme("AU-71 · ENTRADA says which step its rows come from and how many, lets any earlier step of the path be chosen, and is seen as «Esquema» (first, each field with a sample value cut to a line), «Tabla» or «JSON»; with more than ten fields it has a search; a related row unfolds one level; empty, it says «Prueba los pasos anteriores» with its button, which tests them; «Combinar» has a tab per input", async () => {});
  test.fixme("AU-71 · «Tabla» and «JSON» show the first 50 rows of a test of 3,000 and «N filas más» brings 50 more: the rows never arrive all at once; a table of 40 fields scrolls sideways with its cells cut to a line; a value that looks like HTML or a link is painted as text (A-01)", async () => {});
  test.fixme("AU-72 · SALIDA is seen as «Tabla» (first; «Esquema» with one row), «Esquema» or «JSON», with how many rows and a tab per output («sí (3)», «no (125)»); its foot says when it was tested and how long it took; untested it says «Sin probar» with «Probar paso», skipped «Saltado: no le llegaron filas», with no rows «0 filas»", async () => {});
  test.fixme("AU-72 · a step that writes shows «Haría esto» in a test: a row per row written, each field that changes with its value before and after; creating, only after; deleting, the row as it was", async () => {});
  test.fixme("AU-73 · «Probar paso» is at the top right; when it cannot be pressed it says why beside it: «Falta: Colección», by the names of the required parameters that are empty, or «Probando…»", async () => {});
  test.fixme("AU-74 · under 1100 px the step's view has two columns, «Entrada | Salida» as tabs on the left and «Parámetros | Ajustes» on the right, and nothing is cut or scrolls sideways", async () => {});
  test.fixme("AU-74 · on the phone the list is the collection's page and an automation opens its canvas only to look: it pans and zooms, a step opens in one column with three tabs, «Entrada | Parámetros | Salida», with nothing to change; there is no «+», no step bar, no dragging, no menu that changes something, no «Probar» and no «Probar paso», and an ENTRADA or a SALIDA with no data says «Sin probar» with no button", async () => {});
  test.fixme("AU-20 · a field dropped on a text goes in at the caret and one dropped on a number replaces it; after a test the expression says what it gives and with which row («= 5 · con la fila 1 de 128»); typing in it asks the server for nothing", async () => {});
  test.fixme("AU-20 · every control of a value has «{ }» inside it, always in sight: it turns a fixed value into an expression keeping what was written, and back leaves the control empty; Ctrl+Z undoes either", async () => {});
  test.fixme("AU-21 · dragging a field from ENTRADA into a parameter writes its citation, painted as a chip with its step's icon and the field's name: of the step before, of an earlier step chosen in ENTRADA's header, and of a result («Suma de Importe», never its key); with two steps of the path that have a field of the same name the chip says the step too («Buscar gastos › Importe»); a citation of a step that is gone is a red chip", async () => {});
});

test.describe("against a sea of options", () => {
  test.fixme("AU-75 · every step type of the catalogue, with each of its actions, paints seven rows at most in «Parámetros» before «Añadir opción»: the rows are counted on the screen, type by type and action by action; a list is one row, and what is inside one of its entries is seen only once it is opened", async () => {});
  test.fixme("AU-76 · «Añadir opción» lists the options of the action that are not there yet; an added one is a row that can be taken away, and is then its default again; with none left the button is not there", async () => {});
  test.fixme("AU-78 · «Ajustes» has the same six rows in every step type: Si falla, Reintentar, Seguir sin filas, Solo la primera fila, Nota and Apagado", async () => {});
  test.fixme("AU-79 · every setting or option not at its default is a short label on the step's card («Si falla: seguir», «Reintenta 2 veces», «Sigue sin filas», «Solo la primera fila», «Nota», «Apagado», an option by its name), in a line under the summary, with the ones that do not fit joined in «+2», which says them on hover; the tab «Ajustes» counts what changed; the three that change the rows are said above SALIDA too; an off step's card is dimmed", async () => {});
  test.fixme("AU-81 · the conditions of «Filtrar», «Si», «Buscar filas», «Modificar filas» and «Eliminar filas» are the same control, the views' filter: «todas» by default, groups «y» or «o» of one level, operators by the field's type, and the value fixed or an expression", async () => {});
  test.fixme("AU-82 · changing a step's action keeps what the two share and a notice says what went, «Se quitó: Ordenar por, Límite · Deshacer»; its «Deshacer» brings it all back", async () => {});
  test.fixme("AU-83 · a required parameter left empty is not marked on opening the step; it is once Juan leaves it, and all of them are after «Probar» or «Probar paso», with the mark on the step's card too", async () => {});
  test.fixme("AU-84 · each empty, stale or failed state says what to do next: a list with nothing (with «Nueva»), an empty canvas, an ENTRADA with no data, a SALIDA never tested, a stale one, a failed step (with «Ir al parámetro», which opens that parameter), a search with nothing and a draft not saved", async () => {});
});

test.describe("testing", () => {
  test.fixme("AU-90 · «Probar» runs the whole draft and «Registro» says how it went and that it wrote nothing; the step that would write shows what it would do and the collection is as it was", async () => {});
  test.fixme("AU-91 · «Probar paso» tests that step and what it lacks: the steps before it that had not changed keep the time of their test, and the steps after it are not tested", async () => {});
  test.fixme("AU-92 · after a step changes, its SALIDA says «puede estar vieja» and the counts of its arrows and of what hangs from it are dimmed; moving it or renaming it marks nothing; testing it again clears the mark", async () => {});
  test.fixme("AU-94 · the fields a trigger asks are asked in the box of «Probar» and in the trigger's ENTRADA, with those of the last test filled in; a trigger with no fields starts without asking", async () => {});
});
