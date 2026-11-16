import { test } from "@playwright/test";

/**
 * Publishing in «Automatizaciones» on the screen, F14d (docs/automatizaciones.md §5.8, §5.9, §5.10, §6): the header
 * with its switch and «Publicar», «Ejecutar», the tab «Ejecuciones», «Versiones», «Fijar», the automation's settings
 * with its limits, «Programada», the «Permiso» of «Eliminar filas» and the proposal of a run in the inbox. Pending:
 * the first PR of the phase brings one test per rule, and the builders of its screens turn each into a real one,
 * keeping the rule's id in its name (`make check` reads them). A file of its own: automations.spec.ts is F14b's and
 * automations-code.spec.ts is F14c's.
 *
 * How they are written when they run: as automations.spec.ts, over the mocked server of fixtures.ts, with collections
 * whose keys and names are shaped like the user's and, where a rule is about many, with many (a year of runs, a run of
 * 3,000 rows). Every word read on the screen comes from `i18n.ts`; what a row, a step's name or a failure carries is
 * read as plain text. The same over the real server is e2e-boni-desktop/automations-publish.spec.ts.
 */

test.describe("the header and «Publicar»", () => {
  test.fixme("AU-95 · the header of an automation never published has «Publicar» and says «Sin publicar»; published, «Guardado» says «publicada la versión 1», and after a change of the draft «cambios sin publicar»", async () => {});
  test.fixme("AU-96 · «Publicar» opens the screen with its three things: what changes against the version that runs, what is missing or worth a look with a link to each step, and «Lo que podrá hacer»; the first time it says that publishing turns it on", async () => {});
  test.fixme("AU-96 AU-83 · opening «Publicar» marks every empty required parameter of the steps a trigger reaches, on the parameter and on its card, and with one of them «Publicar» cannot be pressed", async () => {});
  test.fixme("AU-96 · a link of «lo que falta» closes the screen and opens that step; with the same document as the one that runs the button says there is nothing to publish", async () => {});
  test.fixme("AU-182 · «Lo que podrá hacer» names each collection a «Código» can change, with its action, and a removal with «Sí» reads «sin preguntar»", async () => {});
  test.fixme("AU-194 · the switch of the header turns the automation on and off, the list's «Estado» says «Encendida», «Apagada» or «Sin publicar», and the first publish leaves it on", async () => {});
});

test.describe("«Ejecutar»", () => {
  test.fixme("AU-97 · «Ejecutar» is in the automation's row of the list, in «⋯» of the editor's header and in the notice of publishing («Publicada la versión 4 · Ejecutar»); an automation never published has none of the three", async () => {});
  test.fixme("AU-97 · with «Campos que pide», «Ejecutar» shows the same box as «Probar»; run, the app goes to «Ejecuciones» and the run is seen advancing step by step", async () => {});
  test.fixme("AU-97 · off, «Ejecutar» says «Está apagada» with «Encender»; with unpublished changes it says it runs the published version; while one runs it says so", async () => {});
});

test.describe("«Ejecuciones»", () => {
  test.fixme("AU-99 · the tab «Ejecuciones»: on the left the list with «Todas | Fallos | Pruebas» (when, how it ended, how long, what started it, which version; tests marked); on the right that run's canvas, read-only, with its rows on each arrow and above it what it did in one line", async () => {});
  test.fixme("AU-99 · opening a step of a run shows what went in and what came out, asked when it is opened; a run that proposed says so with a link to the inbox; on a phone the list comes first and a run opens over it", async () => {});
  test.fixme("AU-18 · «Deshacer lo que hizo» is there only when the run wrote; pressed, the run says it was undone and when; when a row changed afterwards it says which and undoes nothing", async () => {});
  test.fixme("AU-100 · a run has «Reintentar», which says the version it will run when it is not that of then and offers «Deshacer y reintentar» when that run wrote, and «Abrir en el editor con estos datos», which opens the editor with the trigger's output pinned", async () => {});
  test.fixme("AU-101 · the «Registro» of the editor, unfolded, shows the last test as a tree, one line per step with its state, its rows and its time, and inside a «Código» its reads, its «Consola» and what it would save; the tree of a run in «Ejecuciones» is the same component", async () => {});
  test.fixme("AU-103 · a run of which only the summary is left shows its line and says its steps are no longer kept, and still has «Deshacer lo que hizo»", async () => {});
  test.fixme("AU-190 · an interrupted run reads «Interrumpida» with the step it was in, and has «Reintentar»", async () => {});
});

test.describe("«Versiones» and the deleted ones", () => {
  test.fixme("AU-98 · «⋯ → Versiones» lists each version with its number, when, whose and which one runs; one opens as a read-only canvas; two are compared side by side with what was added, removed and changed marked", async () => {});
  test.fixme("AU-98 · «Volver a esta» opens «Publicar» with that version's document, and publishing there leaves the draft saying «cambios sin publicar»", async () => {});
  test.fixme("AU-191 · the list's «⋯» has «Eliminadas»: each deleted automation with «Recuperar», which brings it back to the list as «Apagada»", async () => {});
  test.fixme("AU-192 · in the editor, a code that cites a collection by a name it no longer has is underlined with the name of today, and its button rewrites it", async () => {});
});

test.describe("«Fijar», the settings and «Programada»", () => {
  test.fixme("AU-93 · «Fijar» in the header of SALIDA pins the step's tested output: its card says «Salida fijada», «Probar» does not run it, and the same button releases it; without a tested output it cannot be pressed", async () => {});
  test.fixme("AU-17 · «⋯ → Ajustes» shows the limits a step of this automation can reach («Tiempo» always, «Filas escritas» when a step writes), each with its default and its maximum, and a number over the maximum is refused in the field", async () => {});
  test.fixme("AU-17 · a run stopped by a limit says which and both numbers («Paró: …»), and «Cambiar el límite» opens the settings on that number", async () => {});
  test.fixme("AU-114 · «Programada» is in «Añadir paso» among the triggers; its panel lists its rules in words («Cada día a las 08:00», «Cada lunes a las 09:00», «Cada hora»), adds and removes one, and with none the step is marked", async () => {});
  test.fixme("AU-187 · «Eliminar filas» shows «Permiso» with «Preguntar» chosen and «Sí»; with «Sí» its card says it removes «sin preguntar», and «Haría esto» the same", async () => {});
  test.fixme("AU-47 · the «Mapa» shows a published automation with the collections it reads and writes and its trigger, and one never published is not in it", async () => {});
});

test.describe("what a run tells and asks", () => {
  test.fixme("AU-193 · the proposal of a run in the inbox says the automation, how many rows it creates, modifies and sends to the trash in each collection and each row's before and after, marks what came from outside, and reads a value with HTML, Markdown or a link letter by letter", async () => {});
  test.fixme("AU-193 · accepting it shows the run as having saved; when a row changed since, the card says «Ya no vale · Ejecutar otra vez»", async () => {});
  test.fixme("AU-102 · the notice of a run that failed alone says the automation, the step and the reason in the app's words, and pressing it opens that run in «Ejecuciones»", async () => {});
  test.fixme("AU-167 · the notice of a run that wrote alone says what it wrote in counts («… creó 1 fila en … · Deshacer»), and its «Deshacer» undoes that run", async () => {});
});
