/**
 * The routes and the actions of «Automatizaciones» in F14b (docs/automatizaciones.md §7, AU-168; A-03, A-26): the
 * contract the builder's server PR makes real. Each route here goes into `ROUTES` (../routes.ts) as `tailnet`, and
 * into `ROUTE_RUNS` (../actions.ts) with its action: the route only reads its body and words the answer, and
 * `runAction` asks the policy with the real arguments, labelled as Juan's, before the action runs (never before
 * routing, never twice). A read goes the same way, through its action: no automations route reaches the service
 * (service.ts) around the list. None is `NOT_ACTIONS` or `JUAN_ONLY`: a flow's draft was kept by a route that is no
 * action (D-55); an automation's is an action from the first day.
 *
 * They are listed here and not yet in `ROUTES` because the repo's own checks refuse half of it: a route listed with
 * an action the registry lacks fails actions.test.ts, and so does a registered action with no control in the app.
 * The server PR adds the routes, their actions and the app's first controls together.
 *
 * Every path is under `/api/agent/`, which Boni desktop's `paths.cjs` and Boni Android's `Net.kt` already allow: no
 * new prefix, so neither file changes. Both give such a path 30 seconds: a test that may take longer is a fault to
 * fix in the engine (AU-164, A-15), not a reason to add it to their slow paths.
 *
 * The list of actions is also the planner's, so each action says what it is outside Juan's hand. The ones that
 * change an automation are his touch. The two that read (`automations.read`, `automations.test`) give Juan's hand
 * everything; to any other origin they give the states and the counts and never a row or a field's value: rows hold
 * data of any label, and F14b has no way to hand them to a model with their labels (that is F15's and F16's work).
 *
 * The list of automations is no route of its own: it is Boni's collection of them (../flowsCollection.ts), which
 * gains a row per automation with the six columns of AU-61 and keeps a row per flow of before (AU-151).
 */

/** How each action is told to the policy, and what the app owes it (actions.test.ts). */
export interface AutomationAction {
  /**
   * `read`: it changes nothing Juan keeps (a test keeps only its own last result, AU-91). `touch`: Juan's own
   * (P21): by his hand it runs (P25); in a turn it is his card; an assistant, a flow or work in the background is
   * refused. So nothing puts a step on a canvas but Juan (AU-87). What a model may propose arrives with F16 and F19.
   */
  effect: "read" | "touch";
  /** How it is undone, in words: what the action's `undo` must say. */
  undo: string;
  /** Where its control is in the app: the element that carries `data-boni-action` with the action's name. */
  control: string;
}

export const AUTOMATION_ACTIONS: Readonly<Record<string, AutomationAction>> = {
  "automations.read": {
    effect: "read",
    undo: "nothing to undo: it reads",
    control: "a row of the list, which opens the automation",
  },
  "automations.test": {
    effect: "read",
    undo: "nothing to undo: a test writes in no collection (AU-90)",
    control: "«Probar» (and «Probar paso», the same action with a step)",
  },
  "automations.create": {
    effect: "touch",
    undo: "«Eliminar» the automation it made",
    control: "the first step chosen in the panel of an empty canvas",
  },
  "automations.edit": {
    effect: "touch",
    undo: "the editor's own «Deshacer» (AU-68): one more save of the draft",
    control: "the canvas",
  },
  "automations.arrange": {
    effect: "touch",
    undo: "the editor's own «Deshacer» (AU-68): the boxes back where they were",
    control: "«Ordenar»",
  },
  "automations.duplicate": {
    effect: "touch",
    undo: "«Eliminar» the copy",
    control: "«Duplicar» in the header's «⋯»",
  },
  "automations.delete": {
    effect: "touch",
    undo: "automations.restore, from the notice's «Deshacer»",
    control: "«Eliminar» in the header's «⋯»",
  },
  "automations.restore": {
    effect: "touch",
    undo: "«Eliminar» again",
    control: "«Deshacer» in the notice «Eliminar» leaves",
  },
};

/** No tool of the MCP in F14b for any of them: the reason `ACTION_MCP` gives. */
export const NO_MCP_YET =
  "the MCP's tools for automations arrive with F16 (docs/automatizaciones.md §8)";

/** Each route of the phase with the action it runs, and the function of service.ts that action is. */
export const AUTOMATION_ROUTES: Readonly<Record<string, { action: string; runs: string }>> = {
  "POST /api/agent/automations": { action: "automations.create", runs: "createAutomation" },
  "GET /api/agent/automations/:id": { action: "automations.read", runs: "automationView" },
  "PUT /api/agent/automations/:id/draft": { action: "automations.edit", runs: "keepDraft" },
  "PUT /api/agent/automations/:id/layout": { action: "automations.arrange", runs: "placeSteps" },
  "POST /api/agent/automations/:id/duplicate": {
    action: "automations.duplicate",
    runs: "duplicateAutomation",
  },
  "DELETE /api/agent/automations/:id": { action: "automations.delete", runs: "setDeleted" },
  "POST /api/agent/automations/:id/restore": { action: "automations.restore", runs: "setDeleted" },
  "POST /api/agent/automations/:id/test": { action: "automations.test", runs: "testAutomation" },
  "GET /api/agent/automations/:id/test/rows": { action: "automations.read", runs: "testRows" },
  "GET /api/agent/automations/:id/test/sample": { action: "automations.read", runs: "testSample" },
};
