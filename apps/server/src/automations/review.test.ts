// «Revisar instrucciones» (docs/automatizaciones.md §5.17, AU-211; phase F16): Boni's reviewer as one of its
// automations, and what it suggests while it waits for Juan — a change of «Leer correo»'s draft he takes or turns
// down from a personal device, never a published version changed and never a «Sí» set. The review itself, with the
// mail's code and a scripted reader, is mail.test.ts's.
//
// Invented data only (`ejemplo.*@example.*`), shaped like his: generated ids, his collections' keys and names.

import { ToolRegistry } from "@boni/agent";
import { type Automation, BONI_PARAMS, BONI_TRIGGERS } from "@boni/automations";
import { clock, under } from "@boni/pace";
import type { UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { runAction } from "../actions.ts";
import { MAIL_FLOW, REVIEW_FLOW } from "../flows.ts";
import { GUIDE_AREA, setLearning } from "../learning.ts";
import { seed } from "../seed.test-util.ts";
import { withAutomationActions, withPublishActions, withRunActions } from "./actions.ts";
import { BONI_AUTHOR, boniEnabled, onNewEngine, wireBoni } from "./boni.ts";
import { convertBoniFlows, keepBoniFlows } from "./convert.ts";
import { drawReadMail, type ReadMailConfig } from "./mailAutomation.ts";
import { setEnabled } from "./publish.ts";
import {
  drawReview,
  dropInstructions,
  type InstructionsSuggestion,
  instructionsNotices,
  keepSuggestion,
  PARKED_FOR,
  parkedItems,
  pendingSuggestion,
  REVIEW_NAME,
  takeInstructions,
} from "./review.ts";
import { folder, HAND, JUAN, NOW, SHARED } from "./run.test-util.ts";
import { isError, keepDraft, open, publishedOf } from "./service.ts";

const f = folder("revisar");
afterEach(() => wireBoni(null));

const CONFIG: ReadMailConfig = {
  id: MAIL_FLOW,
  name: "Leer correo",
  collections: [
    { key: "tarea", name: "Tareas" },
    { key: "evento", name: "Eventos" },
  ],
  rules: [{ sender: "@boletin.example.com", do: "skip", collection: null }],
  instructions: "Las fechas de entrega son tareas.",
  examples: [
    { mail: "Asunto: Reunión\nHola, ¿nos vemos el jueves?", want: '[{"title":"Reunión"}]' },
  ],
  modules: ["tasks", "events"],
  days: 60,
};

/** A store with «Leer correo» and «Revisar instrucciones» converted, as mail.ts keeps them (Boni wired, no agent). */
function both(config: ReadMailConfig = CONFIG): UserStore {
  const s = f.store();
  seed(
    s,
    [
      {
        key: "correo",
        name: "Correos",
        folder: "correos/",
        fields: { asunto: "text", de: "text" },
      },
      { key: "tarea", name: "Tareas", folder: "tareas/", fields: { dia: "date" } },
      { key: "evento", name: "Eventos", folder: "eventos/", fields: { dia: "date" } },
    ],
    {},
  );
  wireBoni({
    reaches: () => true,
    agentOf: () => {
      throw new Error("no piece runs here");
    },
  });
  const flow = (id: string, name: string, trigger: unknown) =>
    s.journal.saveFlow({
      id,
      name,
      trigger,
      inputs: [],
      plan: { version: 1, steps: [] },
      layout: null,
      by: "preset",
      enabled: true,
      created: NOW - 30 * 86_400_000,
    } as never);
  flow(MAIL_FLOW, "Leer correo", { kind: "mail" });
  flow(REVIEW_FLOW, "Revisar la guía", { learning: "mail", every: 20 });
  convertBoniFlows(s, [{ id: MAIL_FLOW, boni: "readMail", draw: () => drawReadMail(config) }], NOW);
  keepBoniFlows(
    s,
    [
      {
        id: REVIEW_FLOW,
        boni: "reviewGuide",
        draw: () => drawReview({ id: REVIEW_FLOW, every: 20, mails: 20 }),
      },
    ],
    NOW,
  );
  return s;
}

/** A measured suggestion, as the mail's code keeps it: one rule and one example, the example's text from outside. */
function suggestion(over: Partial<InstructionsSuggestion> = {}): InstructionsSuggestion {
  return {
    id: "g-ejemplo-1",
    automation: MAIL_FLOW,
    rules: [{ sender: "@ofertas.example.com", do: "skip", collection: null }],
    examples: [
      {
        id: "x-m_ejemplo",
        subject: "<b>Acta</b> de la reunión",
        mail: "Asunto: <b>Acta</b> de la reunión\n<script>alert(1)</script> ¿Revisas el acta?",
        want: '[{"title":"Revisar el acta"}]',
      },
    ],
    before: 3,
    after: 5,
    total: 6,
    at: NOW,
    run: null,
    ...over,
  };
}

/** Every «Sí» of a document, by step and collection. */
const yeses = (doc: Automation) =>
  doc.steps.flatMap((step) =>
    (step.connections ?? []).flatMap((c) =>
      (["create", "update", "remove"] as const)
        .filter((a) => {
          const cell = c[a];
          return !!cell && typeof cell === "object" && cell.mode === "yes";
        })
        .map((a) => `${step.id}:${c.collection}:${a}`),
    ),
  );

/** His draft with a «Sí» of his own hand on the first collection of «Crear en la elegida». */
function withHisYes(s: UserStore): void {
  const doc = open(s, MAIL_FLOW)?.automation as Automation;
  const steps = doc.steps.map((step) =>
    step.connections?.length
      ? {
          ...step,
          connections: step.connections.map((c, i) =>
            i === 0 ? { ...c, create: { mode: "yes" as const } } : c,
          ),
        }
      : step,
  );
  const kept = keepDraft(s, MAIL_FLOW, { ...doc, steps }, HAND);
  expect(isError(kept)).toBe(false);
}

describe("«Revisar instrucciones», one of Boni's automations (AU-211)", () => {
  it("AU-211 · it is drawn «De: Boni» with its five steps and its switch, born every 20 decisions, once «Leer correo» is an automation", () => {
    const s = both();
    try {
      expect(onNewEngine(s, REVIEW_FLOW)).toBe(true);
      expect(s.journal.automation(REVIEW_FLOW)?.by).toBe(BONI_AUTHOR);
      expect(boniEnabled(s, REVIEW_FLOW)).toBe(true);
      const doc = publishedOf(s, REVIEW_FLOW)?.automation as Automation;
      expect(doc.name).toBe(REVIEW_NAME);
      expect(doc.steps.map((x) => x.name)).toEqual([
        "Cuando tus decisiones lo piden",
        "Tus decisiones",
        "Revisora",
        "Medir repitiendo",
        "Sugerencia",
      ]);
      const trigger = doc.steps.find((x) => x.type === BONI_TRIGGERS.decisions);
      expect(trigger?.params[BONI_PARAMS.every]).toBe(20);
      expect(doc.steps.find((x) => x.name === "Medir repitiendo")?.params[BONI_PARAMS.mails]).toBe(
        20,
      );
      // Its switch is its own: off, it lists nothing that waits.
      keepSuggestion(s, suggestion());
      expect(instructionsNotices(s, REVIEW_FLOW)).toHaveLength(1);
      expect(isError(setEnabled(s, REVIEW_FLOW, false, JUAN))).toBe(false);
      expect(boniEnabled(s, REVIEW_FLOW)).toBe(false);
      expect(instructionsNotices(s, REVIEW_FLOW)).toEqual([]);
    } finally {
      s.close();
    }
  });

  it("AU-211 · with «Aprender» off, or its automation off, the reviewer suggests nothing; the signals, the counts and the pause stay where F15 put them", () => {
    const s = both();
    try {
      keepSuggestion(s, suggestion());
      setLearning(s, false);
      expect(instructionsNotices(s, REVIEW_FLOW)).toEqual([]);
      setLearning(s, true);
      expect(instructionsNotices(s, REVIEW_FLOW)).toHaveLength(1);
      setEnabled(s, REVIEW_FLOW, false, JUAN);
      expect(instructionsNotices(s, REVIEW_FLOW)).toEqual([]);
      // Kept, not lost: it comes back with its switch.
      expect(pendingSuggestion(s)?.id).toBe("g-ejemplo-1");
      setEnabled(s, REVIEW_FLOW, true, JUAN);
      expect(instructionsNotices(s, REVIEW_FLOW)).toHaveLength(1);
    } finally {
      s.close();
    }
  });

  it("AU-211 · «Ver el cambio» shows the draft's rules and examples before and what the change adds, every text as it came", () => {
    const s = both();
    try {
      keepSuggestion(s, suggestion());
      const [n] = instructionsNotices(s, REVIEW_FLOW);
      expect(n).toMatchObject({ kind: "instructions", automation: MAIL_FLOW, name: "Leer correo" });
      expect(n?.rules.before).toEqual([
        { sender: "@boletin.example.com", do: "skip", collection: null },
      ]);
      expect(n?.rules.added).toEqual([
        { sender: "@ofertas.example.com", do: "skip", collection: null },
      ]);
      expect(n?.examples.before).toEqual([{ subject: "Reunión", want: ["Reunión"] }]);
      // Someone else's text is data: the notice carries it as it is, for the app to paint as plain text.
      expect(n?.examples.added).toEqual([
        { subject: "<b>Acta</b> de la reunión", want: ["Revisar el acta"] },
      ]);
      expect([n?.before, n?.after, n?.total]).toEqual([3, 5, 6]);
    } finally {
      s.close();
    }
  });

  it("AU-211 · «Aceptar» puts the change into the draft and changes no published version", () => {
    const s = both();
    try {
      const before = publishedOf(s, MAIL_FLOW);
      keepSuggestion(s, suggestion());
      const r = takeInstructions(s, "g-ejemplo-1", JUAN);
      expect(r).toEqual({ automation: MAIL_FLOW });
      const after = publishedOf(s, MAIL_FLOW);
      expect([after?.n, after?.hash]).toEqual([before?.n, before?.hash]);
      const draft = open(s, MAIL_FLOW)?.automation as Automation;
      const rules = draft.steps.find((x) => x.type === "boni.mailRule")?.params[BONI_PARAMS.rules];
      expect((rules as { sender: string }[]).map((x) => x.sender)).toEqual([
        "@boletin.example.com",
        "@ofertas.example.com",
      ]);
      const examples = draft.steps.find((x) => x.type === "boni.mailReader")?.params[
        BONI_PARAMS.examples
      ] as { mail: string }[];
      expect(examples).toHaveLength(2);
      // Taken, it waits no more; again, there is nothing.
      expect(pendingSuggestion(s)).toBeNull();
      expect(instructionsNotices(s, REVIEW_FLOW)).toEqual([]);
      expect(takeInstructions(s, "g-ejemplo-1", JUAN)).toEqual({ refused: "nothing" });
    } finally {
      s.close();
    }
  });

  it("AU-211 · «Aceptar» sets no «Sí»: his own stay as he left them, and none is added", () => {
    const s = both();
    try {
      expect(yeses(open(s, MAIL_FLOW)?.automation as Automation)).toEqual([]);
      withHisYes(s);
      const his = yeses(open(s, MAIL_FLOW)?.automation as Automation);
      expect(his).toHaveLength(1);
      keepSuggestion(s, suggestion());
      takeInstructions(s, "g-ejemplo-1", JUAN);
      expect(yeses(open(s, MAIL_FLOW)?.automation as Automation)).toEqual(his);
      // And the published version has none: only his «Publicar» would carry one.
      expect(yeses(publishedOf(s, MAIL_FLOW)?.automation as Automation)).toEqual([]);
    } finally {
      s.close();
    }
  });

  it("AU-211 · a shared device neither takes it nor turns it down; it waits as it was", () => {
    const s = both();
    try {
      keepSuggestion(s, suggestion());
      const draft = JSON.stringify(open(s, MAIL_FLOW)?.automation);
      expect(takeInstructions(s, "g-ejemplo-1", SHARED)).toEqual({ refused: "not-personal" });
      expect(dropInstructions(s, "g-ejemplo-1", SHARED)).toEqual({ refused: "not-personal" });
      expect(JSON.stringify(open(s, MAIL_FLOW)?.automation)).toBe(draft);
      expect(pendingSuggestion(s)?.id).toBe("g-ejemplo-1");
    } finally {
      s.close();
    }
  });

  it("AU-211 · «Aceptar» and «No» go through `automations.learn` from a personal device only, for the automation the change is of", async () => {
    const s = both();
    try {
      const registry = withRunActions(
        withPublishActions(withAutomationActions(new ToolRegistry())),
      );
      const mine = { store: s, trust: "personal" as const, device: JUAN.device, registry };
      const shared = { ...mine, trust: "shared" as const, device: SHARED.device };
      keepSuggestion(s, suggestion());
      const learn = (id: string, what: string, hand: typeof mine | typeof shared) =>
        runAction("automations.learn", { id, do: what, suggestion: "g-ejemplo-1" }, hand);
      expect(JSON.stringify(await learn(MAIL_FLOW, "take", shared))).toMatch(/not-personal/);
      expect(JSON.stringify(await learn(MAIL_FLOW, "drop", shared))).toMatch(/not-personal/);
      // Named under another automation, it is not found.
      expect(JSON.stringify(await learn(REVIEW_FLOW, "take", mine))).toMatch(/not-found/);
      expect(pendingSuggestion(s)?.id).toBe("g-ejemplo-1");
      expect(JSON.stringify(await learn(MAIL_FLOW, "take", mine))).toMatch(/"automation"/);
      expect(pendingSuggestion(s)).toBeNull();
    } finally {
      s.close();
    }
  });

  it("AU-211 · «No» changes nothing and parks its rules and examples for a week; the suggestion's decision is judged", () => {
    const s = both();
    try {
      s.journal.addDecision({
        id: "dec-ejemplo",
        run: "g-ejemplo-1",
        area: GUIDE_AREA,
        cost: "B",
        p: 5 / 6,
        outcome: "ask",
        detail: { suggestion: "g-ejemplo-1" },
        at: NOW,
      });
      const draft = JSON.stringify(open(s, MAIL_FLOW)?.automation);
      keepSuggestion(s, suggestion());
      expect(dropInstructions(s, "g-ejemplo-1", JUAN)).toBeNull();
      expect(JSON.stringify(open(s, MAIL_FLOW)?.automation)).toBe(draft);
      expect(pendingSuggestion(s)).toBeNull();
      expect(s.journal.decisions(GUIDE_AREA)[0]?.result).toBe("wrong");
      expect([...parkedItems(s, NOW + PARKED_FOR - 1)].sort()).toEqual([
        "@ofertas.example.com",
        "x-m_ejemplo",
      ]);
      expect(parkedItems(s, NOW + PARKED_FOR).size).toBe(0);
    } finally {
      s.close();
    }
  });

  it("AU-211 · with a year of his decisions and a «Leer correo» of his size, what the Bandeja asks every second stays quick", () => {
    // His volume (A-15): 300 sender rules and the panel's 20 examples, a year of reviews judged, a year of «No».
    const config: ReadMailConfig = {
      ...CONFIG,
      rules: Array.from({ length: 300 }, (_, i) => ({
        sender: `ejemplo.remitente${i}@example.com`,
        do: i % 3 ? ("collection" as const) : ("skip" as const),
        collection: i % 3 ? "tarea" : null,
      })),
      examples: Array.from({ length: 19 }, (_, i) => ({
        mail: `Asunto: Aviso ${i}\n${"Texto del correo. ".repeat(200)}`,
        want: JSON.stringify([{ title: `Cosa ${i}` }]),
      })),
    };
    const s = both(config);
    try {
      expect([onNewEngine(s, MAIL_FLOW), onNewEngine(s, REVIEW_FLOW)]).toEqual([true, true]);
      for (let d = 0; d < 365; d++)
        s.journal.addDecision({
          id: `dec-${d}`,
          run: `g-${d}`,
          area: GUIDE_AREA,
          cost: "B",
          p: 0.8,
          outcome: "ask",
          detail: { suggestion: `g-${d}` },
          at: NOW - (365 - d) * 86_400_000,
        });
      for (let w = 0; w < 52; w++) {
        keepSuggestion(
          s,
          suggestion({
            id: `g-${w}`,
            rules: [{ sender: `@semana${w}.example.com`, do: "skip", collection: null }],
          }),
        );
        dropInstructions(s, `g-${w}`, { ...JUAN, now: NOW - (52 - w) * 7 * 86_400_000 });
      }
      keepSuggestion(s, suggestion());
      const t = clock();
      for (let i = 0; i < 10; i++) expect(instructionsNotices(s, REVIEW_FLOW)).toHaveLength(1);
      const listed = (clock() - t) / 10;
      under(listed, 30, "cpu", "the waiting suggestion, listed for the Bandeja");
      const t2 = clock();
      expect(parkedItems(s, NOW).size).toBeLessThanOrEqual(2);
      expect(takeInstructions(s, "g-ejemplo-1", JUAN)).toEqual({ automation: MAIL_FLOW });
      under(clock() - t2, 200, "cpu", "«Aceptar» over his panels");
      // Within what the panel holds: the 20th example fits, a 21st would not.
      const reader = open(s, MAIL_FLOW)?.automation.steps.find((x) => x.type === "boni.mailReader");
      expect(reader?.params[BONI_PARAMS.examples]).toHaveLength(20);
    } finally {
      s.close();
    }
  });
});
