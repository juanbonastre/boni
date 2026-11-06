/**
 * (test) What is on Juan's screen as he writes (F9, task 85): the app sends references, the server makes them values
 * through the models' view (nothing closed, what came from outside as a handle) and a plan may name them as
 * `$screen`: «¿qué me pide el de arriba?» answers about the Bandeja's first card.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codeLabel,
  deepLabel,
  fakePlanner,
  leaf,
  plain,
  rec,
  ScriptedProvider,
  type Val,
} from "@boni/agent";
import { label } from "@boni/entities";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { screenOf, screenRefs } from "./screen.ts";
import { seed } from "./seed.test-util.ts";

let dir = "";
let host: AgentHost | null = null;
afterEach(() => {
  host?.close();
  host = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const mail = label("external", "personal", [{ kind: "mail", id: "m1" }]);
const lit = (v: string) => ({ lit: v });

function setUp(planner = fakePlanner([])) {
  dir = mkdtempSync(join(tmpdir(), "boni-pantalla-"));
  host = new AgentHost({ dataDir: dir, providers: { planner, reader: fakePlanner([]) } });
  const store = host.store(1);
  seed(
    store,
    [
      { key: "tarea", name: "Tarea", folder: "tareas/", fields: { titulo: "text" } },
      { key: "privado", name: "Privado", folder: "privado/", fields: { titulo: "text" } },
      { key: "opaca", name: "Opaca", folder: "opaca/", fields: { titulo: "text" } },
    ],
    {
      "tareas/uno.md": "---\ntitulo: Preparar el examen\n---\n",
      "privado/dos.md": "---\ntitulo: Lo que no ve nadie\n---\n",
      "opaca/tres.md": "---\ntitulo: Lo que solo el código ve\n---\n",
    },
  );
  const typeOf = (key: string) => {
    const t = Object.values(store.schema().types).find((x) => x.key === key);
    if (!t) throw new Error(`no ${key}`);
    return t;
  };
  store.setAiAccess(typeOf("privado").id, "restricted", "portatil");
  store.setAiAccess(typeOf("opaca").id, "opaque", "portatil");
  const rowOf = (key: string) => store.list(typeOf(key).id)[0]?.entity.id ?? "";
  // A proposal from a mail, waiting at the top of the Bandeja: its title came from outside.
  const proposal = host.agent(1).propose({
    tool: "entities.create",
    args: {
      type: leaf("tarea", codeLabel("plan")),
      values: rec({ titulo: leaf("Revisar las actas", mail) }, mail),
    },
    origin: "test",
  });
  return { host, store, typeOf, rowOf, proposal };
}

describe("the screen as data (F9, task 85)", () => {
  it("takes only references, bounded; anything else is refused", () => {
    expect(screenRefs({ open: { kind: "collection", id: "t_x" } })).toEqual({
      open: { kind: "collection", id: "t_x" },
      inbox: [],
      chosen: [],
    });
    expect(screenRefs({ open: { kind: "otra" } })).toBeNull();
    expect(screenRefs({ inbox: [{ kind: "proposal", id: 3 }] })).toBeNull();
    expect(screenRefs({ chosen: ["x".repeat(81)] })).toBeNull();
    expect(screenRefs("pantalla")).toBeNull();
    const many = screenRefs({ chosen: Array.from({ length: 80 }, (_, i) => `e${i}`) });
    expect(many?.chosen).toHaveLength(50);
  });

  it("is made of what the store holds, through the models' view: nothing closed, the opaque and the outside as they are labelled", () => {
    const { store, typeOf, rowOf, proposal } = setUp();
    const screen = screenOf(store, {
      open: { kind: "collection", id: typeOf("tarea").id },
      inbox: [{ kind: "proposal", id: proposal }],
      chosen: [rowOf("tarea"), rowOf("privado"), rowOf("opaca")],
    });
    if (screen?.t !== "rec") throw new Error("no screen");
    expect(plain(screen.fields.open as Val)).toEqual({
      kind: "collection",
      collection: "tarea",
      name: "Tarea",
    });
    // The restricted row is not there; the opaque one is, its values kept from the models.
    const chosen = screen.fields.chosen as Val;
    if (chosen.t !== "list") throw new Error("no rows");
    expect(chosen.items).toHaveLength(2);
    expect(deepLabel(chosen.items[1] as Val).noModel).toBe(true);
    // The card: what it would make, its title labelled as from the mail.
    const inbox = screen.fields.inbox as Val;
    if (inbox.t !== "list" || inbox.items[0]?.t !== "rec") throw new Error("no cards");
    const args = inbox.items[0].fields.args as Val;
    expect(deepLabel(args).integrity).toBe("external");
    expect(plain(args)).toMatchObject({ type: "tarea", values: { titulo: "Revisar las actas" } });
    // A collection closed to the models says only that something is open.
    const closed = screenOf(store, {
      open: { kind: "collection", id: typeOf("privado").id },
      inbox: [],
      chosen: [],
    });
    expect(plain(closed as Val)).toEqual({ open: { kind: "collection" } });
  });

  it("«¿qué me pide el de arriba?»: the planner sees the first card as a handle, and its plan answers with it", async () => {
    const planner = new ScriptedProvider("planner", () => ({
      version: 1,
      steps: [
        {
          id: "r",
          op: "reply",
          component: "text",
          data: {
            template: lit("Te pide: {a}"),
            a: { ref: "$screen.inbox[0].args.values.titulo" },
          },
        },
      ],
    }));
    const { host, proposal } = setUp(planner);
    const r = await host.agent(1).turn({
      text: "¿qué me pide el de arriba?",
      origin: { kind: "turn", trust: "personal", device: "portatil" },
      screen: screenOf(host.store(1), {
        open: { kind: "inbox", id: null },
        inbox: [{ kind: "proposal", id: proposal }],
        chosen: [],
      }) as Val,
    });
    expect(r.status).toBe("done");
    expect(JSON.stringify(r.replies)).toContain("Revisar las actas");
    // The planner got the card by its handle: never the mail's words themselves.
    const input = JSON.stringify(planner.requests[0]?.input);
    expect(input).toContain('"$handle":"$screen.inbox[0].args.values","integrity":"external"');
    expect(input).not.toContain("Revisar las actas");
  });

  it("without a screen there is no `$screen` for a plan to name", async () => {
    const planner = new ScriptedProvider("planner", () => ({
      version: 1,
      steps: [
        {
          id: "r",
          op: "reply",
          component: "text",
          data: { template: lit("{a}"), a: { ref: "$screen.open.kind" } },
        },
      ],
    }));
    const { host } = setUp(planner);
    const r = await host.agent(1).turn({
      text: "¿qué tengo abierto?",
      origin: { kind: "turn", trust: "personal", device: "portatil" },
    });
    expect(r.error).toBe("plan-invalid");
    expect(JSON.stringify(planner.requests[0]?.input)).not.toContain('"screen"');
  });
});
