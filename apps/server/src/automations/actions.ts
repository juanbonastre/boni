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
import { AUTOMATION_ACTIONS } from "./routes.ts";
import {
  automationView,
  createAutomation,
  duplicateAutomation,
  type Hand,
  keepDraft,
  placeSteps,
  ROWS_PAGE,
  type ServiceError,
  setDeleted,
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
const undoOf = (name: string) => ({ none: AUTOMATION_ACTIONS[name]?.undo ?? "" });

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
      "Open one of Juan's automations in its editor: its draft, where its boxes are and its last tests; with part rows, a page of a step's last test (step, side in or out, name of the input or output, offset); with part sample, what a step's expressions preview with (step)",
    args: {
      id,
      part: { role: "option", describe: "view (the default), rows or sample" },
      step: { role: "option", describe: "rows and sample: the step's id" },
      side: { role: "option", describe: "rows: in or out" },
      name: { role: "option", describe: "rows: the input's or output's name" },
      offset: { role: "option", describe: "rows: the first row, from 0" },
    },
    run(c, a) {
      const s = handOf(c.service);
      const automation = idOf(a.id);
      const part = textOf(a.part) ?? "view";
      if (part === "view") return leaf(answer(automationView(s.store, automation)) as never, code);
      const step = textOf(a.step);
      if (!step) throw new ToolError("bad-argument");
      if (part === "sample")
        return leaf(answer(testSample(s.store, automation, step)) as never, code);
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
    },
    async run(c, a) {
      const s = handOf(c.service);
      const fields = a.fields ? plain(a.fields) : null;
      const step = textOf(a.step);
      const request = {
        trigger: textOf(a.trigger) ?? "",
        fields: fields as Record<string, Cell>,
        ...(step !== undefined ? { step } : {}),
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
