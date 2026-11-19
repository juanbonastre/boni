// The chat of a page as an automation, in the engine (docs/automatizaciones.md AU-137, decision 19; phase F16): no
// «Sí» under «Mensaje de chat», and the row a message starts a run with. The server's half (publishing refuses it, a
// run reads none) is apps/server's automations/chat.test.ts.
import { label, labeled } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { collection, ids, knowing, sketch } from "./automation.test-util.ts";
import { BONI_TRIGGERS } from "./boni.ts";
import { CHAT_ROW, chatStart, chatStarted, chatYesProblems, yesesOf } from "./chat.ts";
import { CODE_TYPE } from "./code.ts";
import { newConnection } from "./connections.ts";
import { OUTSIDE } from "./run.test-util.ts";
import { validate } from "./validate.ts";

const next = ids(611);
const items = collection(next, ["number", "text"]);
const [, note] = items.fields.map((f) => f.key) as [string, string];
const TYPED = label("user", "personal", [{ kind: "user-edit", id: "chat:p_ejemplo" }]);

/** «Mensaje de chat» → «Crear» with this «Permiso» → «Código» whose connection creates with this cell. */
function chatOf(
  permission: "yes" | "ask",
  cell: "yes" | "ask",
  trigger: string = BONI_TRIGGERS.chat,
) {
  const a = sketch(612)
    .step(
      "Mensaje",
      trigger,
      trigger === BONI_TRIGGERS.chat ? { page: "p_ejemplo", welcome: "", buttons: [] } : {},
    )
    .step("Crear", "collection", {
      collection: items.key,
      action: "create",
      fields: [{ field: note, value: "del chat" }],
      permission,
    })
    .step("Código", CODE_TYPE, { mode: "all", source: "return []" })
    .arrow("Mensaje", "Crear")
    .arrow("Crear", "Código");
  const doc = a.build();
  const code = doc.steps.find((s) => s.name === "Código");
  if (code) code.connections = [{ ...newConnection(items.key), create: { mode: cell } }];
  return { doc, id: a.id };
}

describe("a page's chat writes nothing with a «Sí» (AU-137)", () => {
  it("AU-137 · every «Sí» under «Mensaje de chat» is `connection.notAllowed` «chat»: a «Permiso» and a connection's cell; «Preguntar» is none, and another trigger keeps its «Sí»", () => {
    const { doc, id } = chatOf("yes", "yes");
    expect(chatStarted(doc)).toBe(true);
    expect(chatYesProblems(doc)).toEqual([
      {
        code: "connection.notAllowed",
        severity: "error",
        step: id("Crear"),
        param: "permission",
        detail: { why: "chat" },
      },
      {
        code: "connection.notAllowed",
        severity: "error",
        step: id("Código"),
        param: "connections",
        detail: { collection: items.key, action: "create", why: "chat" },
      },
    ]);
    // `validate` says them, so the canvas and «Publicar» both show them.
    const said = (validate(doc, { ...knowing(items), boni: {} }) as { code: string }[]).filter(
      (p) => p.code === "connection.notAllowed",
    );
    expect(said).toHaveLength(2);
    expect(chatYesProblems(chatOf("ask", "ask").doc)).toEqual([]);
    const manual = chatOf("yes", "yes", "manual").doc;
    expect(chatStarted(manual)).toBe(false);
    expect(chatYesProblems(manual)).toEqual([]);
    expect(manual.steps.flatMap(yesesOf)).toHaveLength(2);
  });

  it("AU-137 · a message starts its automation's «Mensaje de chat» with the message, the page and its values: the message with the label the server gave, each value's label joined, so one from outside stays from outside", () => {
    const { doc, id } = chatOf("ask", "ask");
    const start = chatStart(doc, {
      text: labeled("¿Cuánto llevo este mes?", TYPED),
      page: "p_ejemplo",
      values: { mes: labeled("2026-11", TYPED), nota: labeled("pegado de un correo", OUTSIDE) },
    });
    expect(start?.trigger).toBe(id("Mensaje"));
    expect(start?.test).toBe(false);
    expect(start?.fields.json).toEqual({
      [CHAT_ROW.message]: "¿Cuánto llevo este mes?",
      [CHAT_ROW.page]: "p_ejemplo",
      [CHAT_ROW.values]: { mes: "2026-11", nota: "pegado de un correo" },
    });
    expect(start?.fields.label).toEqual(TYPED);
    expect(start?.fields.fields?.[CHAT_ROW.values]?.label.integrity).toBe("external");
    // With no values, no field has a label of its own; with no chat trigger, no message starts it.
    const bare = chatStart(doc, { text: labeled("hola", TYPED), page: "p_ejemplo" }, true);
    expect(bare?.fields.fields).toBeUndefined();
    expect(bare?.test).toBe(true);
    expect(
      chatStart(chatOf("ask", "ask", "manual").doc, {
        text: labeled("hola", TYPED),
        page: "p_ejemplo",
      }),
    ).toBeNull();
  });
});
