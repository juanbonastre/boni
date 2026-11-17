import { test } from "@playwright/test";

/**
 * What came from before, in the app (docs/automatizaciones.md §5.10 to §5.13, phase F16): the flows converted to
 * automations as the person sees them, Boni's own with their pieces in the canvas, the chat of a page, a proposal
 * from the assistant, and the old editor gone (AU-127, AU-137, AU-140, AU-152, AU-221, AU-225, AU-229).
 *
 * Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
 * name (`make check` reads them, T-10). They will run on the built app against the server with data shaped like the
 * user's (`automation-data.ts`, `server-data.ts`: flows with several versions, a year of runs) and a scripted model,
 * at desktop and phone sizes.
 */
test.describe("what came from before, as automations (F16)", () => {
  test.fixme("AU-225 · the first time «Automatizaciones» opens after the conversion, a band lists the converted ones, each with «Lo que cambia» or «Hace lo mismo» and its runs since; it stays until closed, and none shows «Formato anterior»", async () => {});
  test.fixme("AU-225 · a converted automation opens in the canvas with its steps, «Versiones» marks the converted ones, and «Volver al flujo de antes» leaves it off with the flow running", async () => {});
  test.fixme("AU-127 · a piece of Boni opens its panel with only what it lets change, and the add panel does not offer it in another automation", async () => {});
  test.fixme("AU-221 · Boni's automations say «De: Boni» in the list, can be turned off and not deleted, and «Volver al de Boni» brings Boni's version back", async () => {});
  test.fixme("AU-137 · the «Chat» block of a page opens its automation, and a message in that chat gets its answer as plain text and a run in «Ejecuciones»", async () => {});
  test.fixme("AU-140 · the assistant's proposal of an automation is a card with «Lo que podrá hacer»; accepting it opens a draft in the canvas, not published", async () => {});
  test.fixme("AU-229 · at phone size a converted automation is seen, run and switched, the notice shows, and nothing offers to edit", async () => {});
  test.fixme("AU-152 · no flow of the old format is left: the list, the map and every link open the new canvas, and the old editor's route is gone", async () => {});
});
