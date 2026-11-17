import { test } from "@playwright/test";

/**
 * The AI steps in the editor (docs/automatizaciones.md §5.5, §5.6, §5.10 and §5.15, phase F15): the «Agente» view
 * with its connections and their limits, «Modelo», «Lo que hizo», the question in the Bandeja, and the count under a
 * cell (AU-50, AU-54, AU-125, AU-200, AU-208).
 *
 * Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
 * name (`make check` reads them, T-10). They will run on the built app against the server with data shaped like the
 * user's (`automation-data.ts`, `server-data.ts`) and a scripted model, at desktop and phone sizes.
 */
test.describe("the AI steps of an automation (F15)", () => {
  test.fixme("AU-50 · an «Agente» shows its six things and no key, temperature or token setting; «Modelo» offers the account's and the evaluated ones", async () => {});
  test.fixme("AU-54 · testing an «Agente» shows «Lo que hizo» above its answer, with its rounds, its calls and the model that answered", async () => {});
  test.fixme("AU-125 · a «Preguntar» of a run waits as a card in the Bandeja, painted as plain text; answering it lets the run go on", async () => {});
  test.fixme("AU-200 · «Lo que podrá hacer» and the connection's chip say «decide la IA» on what an «Agente» may write", async () => {});
  test.fixme("AU-208 · the count of accepted proposals shows under the cell and on the proposal's card, and not before 5 decisions", async () => {});
});
