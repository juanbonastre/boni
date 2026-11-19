// An automation inside a conversation (docs/automatizaciones.md §5.11 and §5.10, phase F16): the chat of a page as
// an automation that starts with «Mensaje de chat», and what an automation asks and answers when its run began in a
// chat (AU-137, AU-222).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test, an invented page with
// its collections and a scripted model.
import {
  type Automation,
  BONI_TRIGGERS,
  CannotRun,
  chatStart,
  type PolicyCall,
  type RunInput,
  run as runAutomation,
} from "@boni/automations";
import { label, labeled, newId } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { handLabel } from "../actions.ts";
import { wireBoni } from "./boni.ts";
import { automationPolicy, consentIn } from "./policy.ts";
import {
  CODE,
  CREATE,
  cite,
  folder,
  JUAN,
  made,
  notes,
  ok,
  START,
  type StepSpec,
} from "./run.test-util.ts";
import { automationLabel, publishedOf, runDeps } from "./service.ts";

const dir = folder("chat");
afterAll(() => dir.done());

/** «Mensaje de chat» of an invented page. */
const CHAT: StepSpec = [
  "Mensaje",
  BONI_TRIGGERS.chat,
  { page: "p_ejemplo", welcome: "Hola", buttons: [] },
];

type Refused = { refused: string; problems: { code: string; [k: string]: unknown }[] };

/** A message typed in the chat: the person's own (AU-137). */
const TYPED = label("user", "personal", [{ kind: "user-edit", id: "chat:p_ejemplo" }]);

/** The published version of `id` as the store keeps it, with the names it kept. */
function published(s: UserStore, id: string) {
  const v = publishedOf(s, id);
  if (!v) throw new Error("not published");
  return { automation: v.automation, names: v.names };
}

/** A write of «Crear» in «pedido» by the step `step` of `id`'s version 1, as the engine asks the policy. */
const writeCall = (id: string, step: string) =>
  ({
    automation: { id, version: 1 },
    step,
    type: "collection",
    action: "create",
    effect: "write",
    destroys: false,
    collection: "pedido",
    values: {},
    control: null,
    test: false,
  }) as PolicyCall;

/**
 * The published version of `id` with a «Sí» put in the «Permiso» of the step `step`, as no «Publicar» of today lets
 * through under a chat (kept from before the rule, or never checked), with the names the version kept.
 */
function withYes(s: UserStore, id: string, step: string) {
  const v = publishedOf(s, id);
  if (!v) throw new Error("not published");
  const automation: Automation = {
    ...v.automation,
    steps: v.automation.steps.map((x) =>
      x.id === step ? { ...x, params: { ...x.params, permission: "yes" } } : x,
    ),
  };
  return { automation, names: v.names };
}

/** Runs that version for real through the server's own deps (its store, its policy, its `decide`), from `start`. */
const runFor = (
  s: UserStore,
  id: string,
  kept: ReturnType<typeof withYes>,
  start: Omit<RunInput, "automation">,
) =>
  runAutomation(
    { ...start, automation: kept.automation },
    runDeps(s, id, JUAN, undefined, newId("o").replace(/^o_/, "r_"), kept),
  );

describe("a page's chat writes nothing with a «Sí» (F16 S2c, AU-137)", () => {
  // A chat trigger validates with Boni's steps, as main.ts wires them; no agent is asked here.
  beforeEach(() =>
    wireBoni({
      reaches: () => true,
      agentOf: () => {
        throw new Error("no agent is asked here");
      },
    }),
  );
  afterEach(() => wireBoni(null));

  it("AU-137 · under «Mensaje de chat» publishing refuses a «Sí», in a «Permiso» and in a connection's cell; with «Preguntar» it publishes, and without the chat the same «Sí» publishes", () => {
    const s = dir.store();
    const permiso = made(s, [CHAT, CREATE("del chat", "yes")]);
    const refused = permiso.publish() as Refused;
    expect(refused.refused).toBe("blocked");
    expect(refused.problems).toEqual([
      expect.objectContaining({
        code: "connection.notAllowed",
        step: permiso.step("Crear"),
        param: "permission",
        detail: { why: "chat" },
      }),
    ]);
    const cell = made(s, [CHAT, CODE("yes")]);
    const byCell = cell.publish() as Refused;
    expect(byCell.refused).toBe("blocked");
    expect(byCell.problems.filter((p) => p.code === "connection.notAllowed")).toEqual([
      expect.objectContaining({
        step: cell.step("Código"),
        param: "connections",
        detail: { collection: "pedido", action: "create", why: "chat" },
      }),
    ]);
    // «Preguntar» is what the chat may hold.
    permiso.edit([CHAT, CREATE("del chat", "ask")]);
    expect(ok(permiso.publish()).version).toBe(1);
    // The rule is the chat's: an automation started by hand keeps its «Sí» (AU-188).
    const hand = made(s, [["Inicio", "manual", { fields: [] }], CREATE("a mano", "yes")]);
    expect(ok(hand.publish()).version).toBe(1);
    s.close();
  });

  it("AU-137 · a version under «Mensaje de chat» that holds a «Sí» (kept before the rule, or never checked) is read as «Preguntar»: its write is proposed; the same step without the chat writes", () => {
    const s = dir.store();
    const a = made(s, [CHAT, CREATE("del chat", "ask")]);
    ok(a.publish());
    const v = publishedOf(s, a.id);
    if (!v) throw new Error("not published");
    // A «Sí» in the stored version itself, as no «Publicar» of today lets through.
    const yes: Automation = {
      ...v.automation,
      steps: v.automation.steps.map((x) =>
        x.id === a.step("Crear") ? { ...x, params: { ...x.params, permission: "yes" } } : x,
      ),
    };
    const call = {
      automation: { id: a.id, version: v.automation.version },
      step: a.step("Crear"),
      type: "collection",
      action: "create",
      effect: "write",
      destroys: false,
      collection: "pedido",
      values: {},
      control: null,
      test: false,
    } as PolicyCall;
    expect(consentIn(yes)(call)).toBe(false);
    expect(automationPolicy(yes, automationLabel(a.id)).decide(call).kind).toBe("propose");
    // Without the chat trigger the same step's «Sí» is read (AU-186): the rule only narrows.
    const manual: Automation = {
      ...yes,
      steps: yes.steps.map((x) =>
        x.type === BONI_TRIGGERS.chat ? { ...x, type: "manual", params: { fields: [] } } : x,
      ),
    };
    expect(consentIn(manual)(call)).toBe(true);
    expect(automationPolicy(manual, automationLabel(a.id)).decide(call).kind).toBe("allow");
    s.close();
  });

  it("AU-137 A-46 · with «Mensaje de chat» and another trigger, a «Sí» is refused at «Publicar» and never runs, whichever trigger starts it; with «Preguntar», by the chat or by hand, the write is proposed", async () => {
    const s = dir.store();
    const arrows: [string, string][] = [
      ["Mensaje", "Crear"],
      ["Inicio", "Crear"],
    ];
    const before = notes(s);
    const a = made(s, [CHAT, START, CREATE(cite("$json.nota"), "yes")], { arrows });
    const refused = a.publish() as Refused;
    expect(refused.refused).toBe("blocked");
    expect(refused.problems).toEqual([
      expect.objectContaining({
        code: "connection.notAllowed",
        step: a.step("Crear"),
        detail: { why: "chat" },
      }),
    ]);
    a.edit([CHAT, START, CREATE(cite("$json.nota"), "ask")], arrows);
    ok(a.publish());
    const asPublished = published(s, a.id);
    const byHand = {
      trigger: a.step("Inicio"),
      fields: { json: { nota: "a mano" }, label: handLabel(JUAN.device) },
      test: false,
      startedBy: "user" as const,
    };
    const byChat = (doc: Automation) => {
      const m = chatStart(doc, { text: labeled("hola", TYPED), page: "p_ejemplo" });
      if (!m) throw new Error("no chat trigger");
      return { ...m, fields: { ...m.fields, json: { ...m.fields.json, nota: "del chat" } } };
    };
    for (const e of [
      await runFor(s, a.id, asPublished, byHand),
      await runFor(s, a.id, asPublished, byChat(asPublished.automation)),
    ]) {
      expect(e.state, JSON.stringify(e.error)).toBe("done");
      expect(e.asked).toEqual([
        expect.objectContaining({ step: a.step("Crear"), kind: "propose" }),
      ]);
    }
    // A «Sí» in the stored version itself (kept from before the rule, or never checked): no trigger runs it, and the
    // policy would not read it either.
    const yes = withYes(s, a.id, a.step("Crear"));
    await expect(runFor(s, a.id, yes, byHand)).rejects.toBeInstanceOf(CannotRun);
    await expect(runFor(s, a.id, yes, byChat(yes.automation))).rejects.toBeInstanceOf(CannotRun);
    expect(consentIn(yes.automation)(writeCall(a.id, a.step("Crear")))).toBe(false);
    expect(notes(s)).toEqual(before);
    s.close();
  });

  it("AU-137 A-46 · a message carried through a run to the server's own `decide` ends as a proposal, never a write; the same step with «Sí» by hand, with no chat, writes", async () => {
    const s = dir.store();
    const before = notes(s);
    const a = made(s, [CHAT, CREATE(cite("$json.message"), "ask")]);
    ok(a.publish());
    const asPublished = published(s, a.id);
    const start = chatStart(asPublished.automation, {
      text: labeled("Apunta un pedido de prueba", TYPED),
      page: "p_ejemplo",
    });
    if (!start) throw new Error("no chat trigger");
    const e = await runFor(s, a.id, asPublished, start);
    expect(e.state, JSON.stringify(e.error)).toBe("done");
    expect(e.asked).toEqual([expect.objectContaining({ step: a.step("Crear"), kind: "propose" })]);
    expect(notes(s)).toEqual(before);
    // A «Sí» put in that version never reaches a write: the run refuses it before any step.
    const yes = withYes(s, a.id, a.step("Crear"));
    await expect(runFor(s, a.id, yes, start)).rejects.toBeInstanceOf(CannotRun);
    expect(notes(s)).toEqual(before);
    // The same step with its «Sí», started by hand in an automation with no chat: written (AU-186).
    const hand = made(s, [START, CREATE(cite("$json.nota"), "yes")]);
    ok(hand.publish());
    const w = await runFor(s, hand.id, published(s, hand.id), {
      trigger: hand.step("Inicio"),
      fields: { json: { nota: "Apunta un pedido de prueba" }, label: handLabel(JUAN.device) },
      test: false,
      startedBy: "user",
    });
    expect(w.state, JSON.stringify(w.error)).toBe("done");
    expect(w.asked).toEqual([]);
    expect(notes(s).toSorted()).toEqual([...before, "Apunta un pedido de prueba"].toSorted());
    s.close();
  });
});

describe("an automation in a conversation (F16)", () => {
  it.todo(
    "AU-137 · the «Chat» block names the same id, now an automation: «Mensaje de chat» with its page, welcome and buttons, an «Agente» born with the page's collections to read only, and «Responder» as the message",
  );
  // «Esta página» itself runs in automations/page.test.ts (server) and packages/automations/src/page.test.ts (engine),
  // with the narrower reading: a value of the page is proposed too, until Juan says otherwise (policy.ts PAGE_ALONE).
  it.todo(
    "AU-137 · each message is one run in the automation's runs, and the conversation, its messages and its memory stay where they are",
  );
  it.todo(
    "AU-231 · the chat of a page is in the list of automations and opens in the canvas; the conversation with the assistant is not listed, has no runs of its own, and its record stays where a turn's is",
  );
  it.todo(
    "AU-222 · a «Preguntar» of a run that began in a chat is a card in that chat, with a number, a date, a row of a collection or a file as its answer, and it waits as any other",
  );
  it.todo(
    "AU-222 · «Responder» with «Se ve como» is painted by code as text, number, list, table or chart; outside a chat it is what the run returns",
  );
});
