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
    control: "«Ordenar», and a box dropped on the canvas",
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
    control:
      "«Deshacer» in the notice «Eliminar» leaves, and «Recuperar» in the list's «Eliminadas»",
  },
};

/**
 * F14d S1's touches (publish.ts): their functions and actions are made (`withPublishActions`), and they enter the
 * registry, `ROUTES`, `ROUTE_RUNS` and http.ts with their controls in the app, P1's screens, in one PR: a
 * registered action with no control fails actions.test.ts. Their reads are `automations.read`'s parts, already
 * routed (`AUTOMATION_ROUTES`).
 */
export const PUBLISH_ACTIONS: Readonly<Record<string, AutomationAction>> = {
  "automations.publish": {
    effect: "touch",
    undo: "nothing undoes a version (AU-95): publish another, or «Volver a esta» in «Versiones»",
    control: "«Publicar» in pantalla 10, and «Volver a esta» in «Versiones»",
  },
  "automations.enable": {
    effect: "touch",
    undo: "the switch again",
    control: "the switch in the editor's header and in the list's «⋯»",
  },
};

/**
 * F14d S2's touches (runs.ts): «Ejecutar» and «Reintentar», «Deshacer lo que hizo», and «Fijar» with «Abrir en el
 * editor con estos datos». Registered (`withRunActions`) with their routes in `ROUTES`, `ROUTE_ACTIONS` and
 * `ROUTE_RUNS`, each with its control in «Ejecuciones» (F14d P2). Their reads are `automations.read`'s parts.
 */
export const RUN_ACTIONS: Readonly<Record<string, AutomationAction>> = {
  "automations.run": {
    effect: "touch",
    undo: "«Deshacer lo que hizo» in the run (automations.undo_run): all it saved, or nothing",
    control:
      "«Ejecutar» in the list's row, the header's «⋯» and the publish notice; «Reintentar» in a run",
  },
  "automations.undo_run": {
    effect: "touch",
    undo: "nothing undoes an undo of a run: run it again (AU-18, no «Rehacer»)",
    control: "«Deshacer lo que hizo» in a run of «Ejecuciones»",
  },
  "automations.learn": {
    effect: "touch",
    undo: "a pause comes back by the next failures; a «No» stays while the step stays the same (AU-209)",
    control: "«Quitar pausa» and «No» in the Bandeja's card of a pause or a suggestion",
  },
  "automations.answer": {
    effect: "touch",
    undo: "nothing: an answer given goes on with its run, as its card's in the Bandeja (AU-203)",
    control: "the question's controls in a waiting run of «Ejecuciones», where its notification opens (AU-247)",
  },
  "automations.pin": {
    effect: "touch",
    undo: "the same button again: it releases the pin",
    control: "«Fijar» in SALIDA's header, and «Abrir en el editor con estos datos» in a run",
  },
};

/** The routes the screens' PR adds with those controls, each with its action and the function of runs.ts it runs. */
export const RUN_ROUTES: Readonly<Record<string, { action: string; runs: string }>> = {
  "POST /api/agent/automations/:id/run": { action: "automations.run", runs: "startRun" },
  "POST /api/agent/automations/:id/runs/:run/retry": {
    action: "automations.run",
    runs: "retryRun",
  },
  "POST /api/agent/automations/:id/runs/:run/undo": {
    action: "automations.undo_run",
    runs: "undoAutomationRun",
  },
  "PUT /api/agent/automations/:id/pins/:step": { action: "automations.pin", runs: "pinStep" },
  "DELETE /api/agent/automations/:id/pins/:step": { action: "automations.pin", runs: "unpinStep" },
  "POST /api/agent/automations/:id/runs/:run/pin": {
    action: "automations.pin",
    runs: "pinFromRun",
  },
  // F15 P2 (learning.ts): «Quitar pausa» and «No» to a suggestion (AU-209, AU-210).
  "POST /api/agent/automations/:id/learning": { action: "automations.learn", runs: "unpause" },
  // F15 P2 (C): a waiting run's question, answered from the run (AU-247, decision 29 of §10).
  "POST /api/agent/automations/:id/runs/:run/answer": {
    action: "automations.answer",
    runs: "answerRun",
  },
};

/**
 * The routes of an automation that change something and that a shared device may still call (decision 13 of §10):
 * «Probar», which writes in no collection (AU-90), and answering a waiting run's question, which its step decides
 * (`mayAnswer`, decision 26: a shared device unless the step asks for a personal one, a speaker never). Every other
 * one that is not a read is from a personal device.
 */
export const SHARED_DEVICE_ROUTES: ReadonlySet<string> = new Set([
  "POST /api/agent/automations/:id/test",
  "POST /api/agent/automations/:id/runs/:run/answer",
]);

/** The routes P1 adds with the controls, each with its action and the function of publish.ts it runs. */
export const PUBLISH_ROUTES: Readonly<Record<string, { action: string; runs: string }>> = {
  "POST /api/agent/automations/:id/publish": { action: "automations.publish", runs: "publish" },
  "PUT /api/agent/automations/:id/enabled": { action: "automations.enable", runs: "setEnabled" },
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
  "GET /api/agent/automations/:id/test/preview": {
    action: "automations.read",
    runs: "previewExpression",
  },
  // F14d S1 (publish.ts): what «Publicar» shows (also for «Volver a esta», with ?version=), and «Versiones».
  "GET /api/agent/automations/:id/publish": { action: "automations.read", runs: "publishView" },
  "GET /api/agent/automations/:id/versions": { action: "automations.read", runs: "versionsOf" },
  "GET /api/agent/automations/:id/versions/:n": { action: "automations.read", runs: "versionOf" },
  // F14d S2 (runs.ts): «Ejecuciones», one run, and a page of one of its steps' rows.
  "GET /api/agent/automations/:id/runs": { action: "automations.read", runs: "runsOf" },
  "GET /api/agent/automations/:id/runs/:run": { action: "automations.read", runs: "runView" },
  "GET /api/agent/automations/:id/runs/:run/rows": { action: "automations.read", runs: "runRows" },
  // F14d P3b (runs.ts): «Ver todo» of what a run asked, as its card in the inbox paints it (AU-193).
  "GET /api/agent/automations/:id/runs/:run/asked": {
    action: "automations.read",
    runs: "runAsked",
  },
  // F15 P2 (learning.ts): the cells of the published version with their counts, pauses and suggestions (AU-208).
  "GET /api/agent/automations/:id/learning": { action: "automations.read", runs: "learningOf" },
};
