/**
 * The actions of «Automatizaciones» that F14b makes real (docs/automatizaciones.md §7, AU-168; routes.ts in
 * this folder): reading an automation (its view, a page of its last test's rows, the sample its expressions preview
 * with), making it, keeping its draft and where its boxes are (C2), duplicating, deleting and restoring it, and
 * «Probar» (E). Each runs the function of service.ts its route names. They run only by Juan's hand: the routes reach
 * them through `runAction`, which gives the service `{ store, meta, trust, zone }` with the actor «user»; a turn, a
 * flow or the MCP has no service «automations» in F14b (agent.ts gives none), so the action answers `not-available`
 * there: neither a row nor a count. What a model may read or propose of an automation arrives with F16 and F19.
 */

import {
  codeLabel,
  leaf,
  plain,
  ToolError,
  type ToolRegistry,
  type Trust,
  type Val,
} from "@boni/agent";
import type { Cell } from "@boni/automations";
import type { UserStore } from "@boni/store";
import { publish, publishView, setEnabled, versionOf, versionsOf } from "./publish.ts";
import { AUTOMATION_ACTIONS, PUBLISH_ACTIONS, RUN_ACTIONS } from "./routes.ts";
import {
  pinFromRun,
  pinStep,
  retryRun,
  runAsked,
  runRows,
  runsOf,
  runView,
  startRun,
  undoAutomationRun,
  unpinStep,
} from "./runs.ts";
import {
  automationView,
  createAutomation,
  duplicateAutomation,
  type Hand,
  keepDraft,
  placeSteps,
  previewExpression,
  ROWS_PAGE,
  type ServiceError,
  setDeleted,
  type TestRequest,
  testAutomation,
  testRows,
  testSample,
} from "./service.ts";

/** What `runAction` gives an action of Juan's hand: his device's trust and the account's zone too. */
interface HandService {
  store: UserStore;
  meta: { actor: "user"; device: string };
  trust?: Trust;
  zone?: string;
}
const handOf = (s: unknown): HandService => {
  const x = s as Partial<HandService> | null | undefined;
  if (!x || typeof x !== "object" || !x.store || x.meta?.actor !== "user")
    throw new ToolError("not-available");
  return x as HandService;
};
const hand = (s: HandService): Hand => ({ device: s.meta.device, now: Date.now() });
const code = codeLabel("automations");
const idOf = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  if (typeof x !== "string" || !x) throw new ToolError("bad-argument");
  return x;
};
/** The service's answer, or its error as the action's code (the route words it). */
function answer<T>(r: T | ServiceError): T {
  if (r && typeof r === "object" && "error" in r && Object.keys(r).length === 1)
    throw new ToolError((r as ServiceError).error);
  return r as T;
}
/**
 * A waiting run says until when it waits (AU-203: «Esperando respuesta · hasta mañana a las 9:40»): the earliest
 * limit of its questions, read from its wait by its id. Only the runs that wait, at most a page of them.
 */
function withUntil<R extends { id: string; state: string }>(
  store: UserStore,
  r: R,
): R & { until?: number } {
  if (r.state !== "waiting") return r;
  const w = store.journal.automationWait(r.id);
  return w ? { ...r, until: w.until } : r;
}
const textOf = (v: Val | undefined): string | undefined => {
  const x = v ? plain(v) : undefined;
  if (x === undefined || x === null) return undefined;
  if (typeof x !== "string") throw new ToolError("bad-argument");
  return x;
};
const id = {
  role: "option" as const,
  required: true,
  describe: "the automation's id",
};
/** The zone «hoy» is in when the hand brings none: the server's default (agent.ts `tz`). */
const DEFAULT_ZONE = "Europe/Madrid";
const undoOf = (name: string) => ({
  none: (AUTOMATION_ACTIONS[name] ?? PUBLISH_ACTIONS[name] ?? RUN_ACTIONS[name])?.undo ?? "",
});
/** A version's number, given as text in a query or as a number in a body; absent is undefined. */
const numberOf = (v: Val | undefined): number | undefined => {
  const x = v ? plain(v) : undefined;
  if (x === undefined || x === null || x === "") return undefined;
  const n = typeof x === "string" ? Number(x) : x;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new ToolError("bad-argument");
  return n;
};

/** The automations' actions of C1, C2 and E, added to a registry. */
export function withAutomationActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "automations.read",
    icon: "Eye",
    effect: "read",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.read"),
    title: "Abrir automatización",
    describe:
      "Open one of Juan's automations in its editor: its draft, where its boxes are and its last tests; with part rows, a page of a step's last test (step, side in or out, name of the input or output, offset); with part sample, what a step's expressions preview with (step); with part preview, what one expression is worth with one row of its last test (step, param, row, and expr: the text being typed); with part publish, what «Publicar» shows for the draft or, with version, for that version's document; with part versions, its versions without their documents; with part version, one version (version); with part runs, a page of its runs, 50 at a time, the newest first (filter all, failed or tests; before, the last run of the page before); with part run, one run (run); with part runRows, a page of one of a run's steps' rows (run, step, side, name, offset); with part asked, a page of what a run asked, as its card in the inbox shows it (run, offset)",
    args: {
      id,
      part: {
        role: "option",
        describe:
          "view (the default), rows, sample, preview, publish, versions, version, runs, run, runRows or asked",
      },
      run: { role: "option", describe: "run, runRows and asked: the run's id" },
      filter: { role: "option", describe: "runs: all (the default), failed or tests" },
      before: { role: "option", describe: "runs: the id of the last run of the page before" },
      version: { role: "option", describe: "publish and version: a version's number" },
      step: { role: "option", describe: "rows, sample and preview: the step's id" },
      side: { role: "option", describe: "rows: in or out" },
      name: { role: "option", describe: "rows: the input's or output's name" },
      offset: { role: "option", describe: "rows, runRows and asked: the first row, from 0" },
      param: { role: "option", describe: "preview: the path to the value in the step" },
      row: { role: "option", describe: "preview: which row of the step's input, from 0" },
      expr: { role: "definition", describe: "preview: the expression as it is being typed" },
    },
    async run(c, a) {
      const s = handOf(c.service);
      const automation = idOf(a.id);
      const part = textOf(a.part) ?? "view";
      if (part === "view") return leaf(answer(automationView(s.store, automation)) as never, code);
      if (part === "publish")
        return leaf(answer(publishView(s.store, automation, numberOf(a.version))) as never, code);
      if (part === "versions") return leaf(answer(versionsOf(s.store, automation)) as never, code);
      if (part === "version") {
        const n = numberOf(a.version);
        if (n === undefined) throw new ToolError("bad-argument");
        return leaf(answer(versionOf(s.store, automation, n)) as never, code);
      }
      if (part === "runs") {
        const before = textOf(a.before);
        const page = answer(
          runsOf(s.store, automation, {
            filter: textOf(a.filter) ?? "all",
            ...(before ? { before } : {}),
          }),
        );
        return leaf({ ...page, runs: page.runs.map((r) => withUntil(s.store, r)) } as never, code);
      }
      if (part === "run") {
        const view = answer(runView(s.store, automation, textOf(a.run) ?? ""));
        return leaf({ ...view, run: withUntil(s.store, view.run) } as never, code);
      }
      if (part === "runRows") {
        const offset = a.offset ? plain(a.offset) : 0;
        if (typeof offset !== "number") throw new ToolError("bad-argument");
        const at = {
          step: textOf(a.step) ?? "",
          side: textOf(a.side) ?? "",
          name: textOf(a.name) ?? "",
          offset,
        };
        return leaf(answer(runRows(s.store, automation, textOf(a.run) ?? "", at)) as never, code);
      }
      if (part === "asked") {
        const offset = a.offset ? plain(a.offset) : 0;
        if (typeof offset !== "number") throw new ToolError("bad-argument");
        return leaf(
          answer(runAsked(s.store, automation, textOf(a.run) ?? "", offset)) as never,
          code,
        );
      }
      const step = textOf(a.step);
      if (!step) throw new ToolError("bad-argument");
      if (part === "sample")
        return leaf(answer(testSample(s.store, automation, step)) as never, code);
      if (part === "preview") {
        const row = a.row ? plain(a.row) : 0;
        const expr = textOf(a.expr);
        if (typeof row !== "number") throw new ToolError("bad-argument");
        const request = {
          step,
          param: textOf(a.param) ?? "",
          row,
          ...(expr !== undefined ? { expr } : {}),
        };
        const r = await previewExpression(s.store, automation, request, {
          ...hand(s),
          zone: s.zone ?? DEFAULT_ZONE,
        });
        return leaf(answer(r) as never, code);
      }
      if (part !== "rows") throw new ToolError("bad-argument");
      const side = textOf(a.side);
      const offset = a.offset ? plain(a.offset) : 0;
      if ((side !== "in" && side !== "out") || typeof offset !== "number")
        throw new ToolError("bad-argument");
      const at = { step, side, name: textOf(a.name) ?? "", offset, limit: ROWS_PAGE } as const;
      return leaf(answer(testRows(s.store, automation, at)) as never, code);
    },
  });
  r.register({
    name: "automations.test",
    icon: "Play",
    effect: "read",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.test"),
    title: "Probar automatización",
    describe:
      "Test an automation's draft from a trigger with the fields Juan typed, or only one step (and what it lacks): it reads and computes for real and writes in no collection; it keeps each step's last test",
    args: {
      id,
      trigger: { role: "option", required: true, describe: "the trigger's step id it starts in" },
      fields: {
        role: "definition",
        required: true,
        describe: "what that trigger asks, by field key",
      },
      step: { role: "option", describe: "«Probar paso»: only that step's id" },
      answers: {
        role: "definition",
        describe:
          "the answers to the test that waits, by «Preguntar» step id: what its panel gave (AU-203)",
      },
    },
    async run(c, a) {
      const s = handOf(c.service);
      const fields = a.fields ? plain(a.fields) : null;
      const step = textOf(a.step);
      const answers = a.answers ? plain(a.answers) : undefined;
      const request = {
        trigger: textOf(a.trigger) ?? "",
        fields: fields as Record<string, Cell>,
        ...(step !== undefined ? { step } : {}),
        ...(answers !== undefined ? { answers: answers as TestRequest["answers"] } : {}),
      };
      // A hand that does not say its device's trust is not one `runAction` gave: nothing runs.
      if (!s.trust) throw new ToolError("not-available");
      const r = await testAutomation(s.store, idOf(a.id), request, {
        ...hand(s),
        trust: s.trust,
        zone: s.zone ?? DEFAULT_ZONE,
      });
      return leaf(answer(r) as never, code);
    },
  });
  r.register({
    name: "automations.create",
    icon: "SquarePlus",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.create"),
    title: "Crear automatización",
    describe:
      "Make an automation from its first step: the whole document, in the format; its id is made here",
    args: { automation: { role: "definition", required: true, describe: "the whole automation" } },
    run(c, a) {
      const s = handOf(c.service);
      const doc = a.automation ? plain(a.automation) : null;
      return leaf(answer(createAutomation(s.store, doc, hand(s))) as never, code);
    },
  });
  r.register({
    name: "automations.edit",
    icon: "PencilLine",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.edit"),
    title: "Guardar automatización",
    describe:
      "Keep an automation's draft: the whole document; it answers the draft's rev and the stale steps",
    args: {
      id,
      automation: { role: "definition", required: true, describe: "the whole automation" },
    },
    run(c, a) {
      const s = handOf(c.service);
      const doc = a.automation ? plain(a.automation) : null;
      return leaf(answer(keepDraft(s.store, idOf(a.id), doc, hand(s))) as never, code);
    },
  });
  r.register({
    name: "automations.arrange",
    icon: "LayoutGrid",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.arrange"),
    title: "Ordenar automatización",
    describe:
      "Keep where an automation's boxes are: each step named with its place; the draft and its tests do not change",
    args: {
      id,
      places: { role: "definition", required: true, describe: "the boxes: [{step, x, y}]" },
    },
    run(c, a) {
      const s = handOf(c.service);
      const places = a.places ? plain(a.places) : null;
      return leaf(answer(placeSteps(s.store, idOf(a.id), places as never)) as never, code);
    },
  });
  r.register({
    name: "automations.duplicate",
    icon: "Copy",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.duplicate"),
    title: "Duplicar automatización",
    describe:
      "Make a copy of an automation with the name given, its steps, arrows and places, and no tests",
    args: { id, name: { role: "content", required: true, describe: "the copy's name" } },
    run(c, a) {
      const s = handOf(c.service);
      const name = a.name ? plain(a.name) : null;
      if (typeof name !== "string") throw new ToolError("bad-argument");
      return leaf(answer(duplicateAutomation(s.store, idOf(a.id), name, hand(s))) as never, code);
    },
  });
  r.register({
    name: "automations.delete",
    icon: "Trash",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.delete"),
    title: "Eliminar automatización",
    describe:
      "Take an automation out of the list, with everything it had; automations.restore brings it back",
    args: { id },
    run(c, a) {
      const s = handOf(c.service);
      return leaf(answer(setDeleted(s.store, idOf(a.id), true)), code);
    },
  });
  r.register({
    name: "automations.restore",
    icon: "RotateCcw",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.restore"),
    title: "Restaurar automatización",
    describe: "Bring back an automation «Eliminar» took out of the list",
    args: { id },
    run(c, a) {
      const s = handOf(c.service);
      return leaf(answer(setDeleted(s.store, idOf(a.id), false)), code);
    },
  });
  return r;
}

/**
 * «Publicar» and «Volver a esta» (one action: with `version`, that version's document) and the switch (F14d S1:
 * AU-95, AU-98, AU-194). Juan's touch, from a personal device only (decision 13). Not in the registry yet: the
 * repo's checks want each registered action's control in the app (actions.test.ts), and the screen that has them is
 * P1's (pantalla 10, «Versiones», the switch). P1 calls this beside `withAutomationActions` and adds the routes of
 * `PUBLISH_ROUTES` to `ROUTES`, `ROUTE_RUNS` and http.ts with the controls, in one PR.
 */
export function withPublishActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "automations.publish",
    icon: "Upload",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.publish"),
    title: "Publicar automatización",
    describe:
      "Publish an automation's draft as its next version, the one that runs (rev: the draft's rev the screen showed); with version, publish that old version's document again as a new one, leaving the draft as it is",
    args: {
      id,
      rev: { role: "option", describe: "the draft's rev the screen showed" },
      version: { role: "option", describe: "«Volver a esta»: the old version's number" },
    },
    run(c, a) {
      const s = handOf(c.service);
      if (!s.trust) throw new ToolError("not-available");
      const rev = numberOf(a.rev);
      const version = numberOf(a.version);
      const r = publish(
        s.store,
        idOf(a.id),
        { ...(rev !== undefined ? { rev } : {}), ...(version !== undefined ? { version } : {}) },
        { ...hand(s), trust: s.trust },
      );
      return leaf(answer(r) as never, code);
    },
  });
  r.register({
    name: "automations.enable",
    icon: "Power",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.enable"),
    title: "Encender o apagar automatización",
    describe:
      "Turn a published automation on or off (enabled): off, no run starts for real; turning it on runs nothing that was due",
    args: { id, enabled: { role: "option", required: true, describe: "true on, false off" } },
    run(c, a) {
      const s = handOf(c.service);
      if (!s.trust) throw new ToolError("not-available");
      const on = a.enabled ? plain(a.enabled) : null;
      if (typeof on !== "boolean") throw new ToolError("bad-argument");
      return leaf(
        answer(setEnabled(s.store, idOf(a.id), on, { ...hand(s), trust: s.trust })) as never,
        code,
      );
    },
  });
  return r;
}

/** The hand of a run's touch: his device's trust, which `runAction` gives, and his zone. */
const runHand = (s: HandService) => {
  if (!s.trust) throw new ToolError("not-available");
  return { ...hand(s), trust: s.trust, zone: s.zone ?? DEFAULT_ZONE };
};

/**
 * «Ejecutar» and «Reintentar», «Deshacer lo que hizo», «Fijar» and «Abrir en el editor con estos datos» (F14d S2:
 * AU-97, AU-18, AU-100, AU-93; runs.ts). Juan's touch, from a personal device only (decision 13). Registered
 * beside `withAutomationActions` (actions.ts), each with its control in the app: «Ejecuciones» and «Fijar» (P2).
 */
export function withRunActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "automations.run",
    icon: "Play",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.run"),
    title: "Ejecutar automatización",
    describe:
      "Run an automation's published version for real, from a trigger with the fields Juan typed; it answers at once with the run, which goes on in the server. With retry (a run's id), run again with that run's trigger and fields and the version published now; with undo too, undo what that run saved first",
    args: {
      id,
      trigger: { role: "option", describe: "the trigger's step id it starts in" },
      fields: { role: "definition", describe: "what that trigger asks, by field key" },
      retry: { role: "option", describe: "«Reintentar»: the id of the run to repeat" },
      undo: { role: "option", describe: "with retry, «Deshacer y reintentar»: true" },
    },
    async run(c, a) {
      const s = handOf(c.service);
      const h = runHand(s);
      const retry = textOf(a.retry);
      if (retry) {
        const undo = a.undo ? plain(a.undo) : false;
        if (typeof undo !== "boolean") throw new ToolError("bad-argument");
        return leaf(answer(await retryRun(s.store, idOf(a.id), retry, { undo }, h)) as never, code);
      }
      const fields = a.fields ? plain(a.fields) : null;
      const request = { trigger: textOf(a.trigger) ?? "", fields: fields as Record<string, Cell> };
      return leaf(answer(await startRun(s.store, idOf(a.id), request, h)) as never, code);
    },
  });
  r.register({
    name: "automations.undo_run",
    icon: "Undo2",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.undo_run"),
    title: "Deshacer lo que hizo una ejecución de una automatización",
    describe:
      "Undo everything one run of an automation saved, in one go, or nothing: when a row changed since, it says which",
    args: { id, run: { role: "option", required: true, describe: "the run's id" } },
    run(c, a) {
      const s = handOf(c.service);
      return leaf(
        answer(undoAutomationRun(s.store, idOf(a.id), idOf(a.run), runHand(s))) as never,
        code,
      );
    },
  });
  r.register({
    name: "automations.pin",
    icon: "Pin",
    effect: "touch",
    area: "flows",
    service: "automations",
    undo: undoOf("automations.pin"),
    title: "Fijar la salida de un paso de una automatización",
    describe:
      "Pin a step's last tested output on the draft, so tests take it instead of running the step (step); with off, release it; with run, pin the output the trigger gave in that run",
    args: {
      id,
      step: { role: "option", describe: "the step's id" },
      off: { role: "option", describe: "true: release the pin" },
      run: { role: "option", describe: "«Abrir en el editor con estos datos»: the run's id" },
    },
    run(c, a) {
      const s = handOf(c.service);
      const h = runHand(s);
      const automation = idOf(a.id);
      const run = textOf(a.run);
      if (run) return leaf(answer(pinFromRun(s.store, automation, run, h)) as never, code);
      const step = idOf(a.step);
      const off = a.off ? plain(a.off) : false;
      if (typeof off !== "boolean") throw new ToolError("bad-argument");
      return leaf(
        answer(
          off ? unpinStep(s.store, automation, step, h) : pinStep(s.store, automation, step, h),
        ) as never,
        code,
      );
    },
  });
  return r;
}
