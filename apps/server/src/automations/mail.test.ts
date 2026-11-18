// Mail as an automation (docs/automatizaciones.md §5.17, phase F16): «Leer correo» is its own document, what it
// saves is decided by a cell, each thing it proposes is its own card, the «Decisora»'s doubt is a «Preguntar», the
// day's cap sits at the trigger, and the conversion of the mail settings loses nothing (AU-249 to AU-255).
//
// The design's pending tests, one per rule (T-10): S2b makes them run, each with invented mails and scripted
// readers, never a real mailbox or a model.

import { type Automation, CREATE_CHOSEN, FORMAT, type PolicyCall } from "@boni/automations";
import { label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { automationPolicy, consentIn } from "./policy.ts";
import { automationLabel } from "./service.ts";

/** A mail's text, as the trigger labels it: from outside (invented). */
const MAIL = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);

describe("mail as an automation (§5.17)", () => {
  it.todo(
    "AU-249 · «Leer correo» runs from its document alone: nothing regenerates it, a step gets only the trigger's row and its own panel, and an example that quotes a mail stays labelled as from outside",
  );
  it("AU-250 · what «Crear en la elegida» creates goes through its cell: born «Preguntar» in every collection, saved with a «Sí» of his hand, and with «Solo conocidos» a thing from a sender not yet known is still proposed", () => {
    // The server's half (P28): the «Sí» of each collection is read from the version as stored, never from the call.
    // The engine's half (the cell proposes, «Solo conocidos» narrows, nothing is born «Sí») is boni-steps.test.ts's.
    const doc = {
      format: FORMAT,
      id: "a_leer",
      version: 4,
      name: "Leer correo",
      steps: [
        {
          id: "s_crear",
          name: "Crear en la elegida",
          type: CREATE_CHOSEN,
          params: { onlyKnown: true },
          connections: [
            {
              collection: "t_eventos",
              read: false,
              create: { mode: "yes" },
              update: false,
              remove: false,
            },
            {
              collection: "t_tareas",
              read: false,
              create: { mode: "ask" },
              update: false,
              remove: false,
            },
          ],
        },
      ],
      arrows: [],
      settings: {},
    } as unknown as Automation;
    const call = (over: Partial<PolicyCall> = {}): PolicyCall => ({
      automation: { id: "a_leer", version: 4 },
      step: "s_crear",
      type: CREATE_CHOSEN,
      action: "create",
      effect: "write",
      destroys: false,
      collection: "t_eventos",
      values: { f_titulo: { value: "Reunión del jueves", label: MAIL, derived: true } },
      control: null,
      test: false,
      ...over,
    });
    const yes = consentIn(doc);
    expect(yes(call())).toBe(true);
    // «Preguntar», a collection with no cell, another version, a call that claims a «Sí»: none is one.
    expect(yes(call({ collection: "t_tareas" }))).toBe(false);
    expect(yes(call({ collection: "t_notas" }))).toBe(false);
    expect(yes(call({ automation: { id: "a_leer", version: 5 } }))).toBe(false);
    const own = automationLabel("a_leer");
    // What came by mail is saved with his «Sí», and proposed without it.
    expect(automationPolicy(doc, own).decide(call()).kind).toBe("allow");
    expect(automationPolicy(doc, own).decide(call({ collection: "t_tareas" })).kind).toBe(
      "propose",
    );
    const claimed = { ...call({ collection: "t_tareas" }), yes: true } as PolicyCall;
    expect(automationPolicy(doc, own).decide(claimed).kind).toBe("propose");
    // A draft's «Sí» is no «Sí»: the policy of the stored version (without it) proposes.
    const stored = {
      ...doc,
      steps: doc.steps.map((s) => ({
        ...s,
        connections: s.connections?.map((c) => ({ ...c, create: { mode: "ask" as const } })),
      })),
    };
    expect(automationPolicy(stored, own).decide(call()).kind).toBe("propose");
  });
  it.todo(
    "AU-251 · a run that only asks to create five rows or fewer is one card per row: accepting one saves that row and leaves the others waiting, a corrected one counts as a miss, and a failed run withdraws no earlier card of the thread",
  );
  it.todo(
    "AU-252 · a row the «Decisora» is unsure of leaves by «Duda» to a «Preguntar»: the run waits, the answer goes on to the chosen collection, and «Ninguna» or an expired question creates nothing",
  );
  it.todo(
    "AU-253 · past the day's cap of an automation that starts with a mail no run starts and no model is called, the mail waits for the next day, and a read mail is a run in «Ejecuciones» with no line in the server's log",
  );
  it.todo(
    "AU-254 · the conversion of mail keeps the mailbox, the read marks and the pending cards, writes the collections, the guide and the rules into the steps' panels, and leaves every cell in «Preguntar» even with «Solo» on",
  );
  it.todo(
    "AU-255 · a piece's reader gets what came from a mail only between the markers and labelled as from outside, the sender's pending titles included, and beside it only its panel and closed lists: a row of the person's, or a field label set on the trigger's row, fails with ai.private",
  );
});
