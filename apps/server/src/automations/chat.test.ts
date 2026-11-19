// An automation inside a conversation (docs/automatizaciones.md §5.11 and §5.10, phase F16): the chat of a page as
// an automation that starts with «Mensaje de chat», and what an automation asks and answers when its run began in a
// chat (AU-137, AU-222).
//
// Pending: the phase's first PR brings one test per rule and its builders make each real, the rule's id kept in its
// name (`make check` reads them, T-10). They will run the real server with a store per test, an invented page with
// its collections and a scripted model.
import { type Automation, BONI_TRIGGERS, type PolicyCall } from "@boni/automations";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { wireBoni } from "./boni.ts";
import { automationPolicy, consentIn } from "./policy.ts";
import { CODE, CREATE, folder, made, ok, type StepSpec } from "./run.test-util.ts";
import { automationLabel, publishedOf } from "./service.ts";

const dir = folder("chat");
afterAll(() => dir.done());

/** «Mensaje de chat» of an invented page. */
const CHAT: StepSpec = [
  "Mensaje",
  BONI_TRIGGERS.chat,
  { page: "p_ejemplo", welcome: "Hola", buttons: [] },
];

type Refused = { refused: string; problems: { code: string; [k: string]: unknown }[] };

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
});

describe("an automation in a conversation (F16)", () => {
  it.todo(
    "AU-137 · the «Chat» block names the same id, now an automation: «Mensaje de chat» with its page, welcome and buttons, an «Agente» born with the page's collections to read only, and «Responder» as the message",
  );
  it.todo(
    "AU-137 · «Esta página», only under «Mensaje de chat»: the «Agente» reads the page's figures, sets a value of its own page alone and undoably (P27), and adding a block asks",
  );
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
