import { afterEach, describe, expect, it } from "vitest";
import { fakePlanner, ScriptedProvider } from "../src/providers.ts";
import { type Env, makeEnv, PERSONAL } from "./fixture.ts";

/** The audit of what the models saw and did (store's audit.ts), from the agent's side. Invented data only. */
let env: Env;
afterEach(() => env?.close());

const lit = (v: string) => ({ lit: v });
const ref = (r: string) => ({ ref: r });

describe("the audit, from the agent", () => {
  it("says what reached each model: the reader got the subject only, never the mail's text", async () => {
    env = makeEnv([
      { asunto: "Reunión inventada", de: "ana@example.com", cuerpo: "Texto del correo" },
    ]);
    const planner = fakePlanner([
      {
        version: 1,
        steps: [
          { id: "s", op: "call", tool: "entities.get", args: { id: lit("e_mail0") } },
          { id: "r", op: "read", reader: "summarize", input: ref("$s.asunto") },
          { id: "o", op: "reply", component: "text", data: { template: ref("$r.text") } },
        ],
      },
    ]);
    const reader = new ScriptedProvider("lector-ejemplo", () => ({ text: "Un resumen" }));
    const res = await env
      .agent(planner, reader)
      .turn({ text: "resume el correo", origin: PERSONAL });
    expect([res.status, res.error]).toEqual(["done", null]);
    const actions = env.store.audit.actions({ run: res.run }).reverse();
    expect(actions.map((a) => [a.by, a.tool])).toEqual([
      ["model:planner:fake/fake", "model.planner"],
      ["agent", "entities.get"],
      ["model:reader:lector-ejemplo/lector-ejemplo", "model.reader"],
    ]);
    const seen = env.store.audit.accessOf(actions.map((a) => a.seq));
    // The planner saw no entity; the code read the whole mail for the run; the reader got its subject only.
    expect(seen.get(actions[0]?.seq as number)).toEqual([]);
    expect(seen.get(actions[1]?.seq as number)).toEqual([
      expect.objectContaining({ entity: "e_mail0", fields: ["f_asunto", "f_cuerpo", "f_de"] }),
    ]);
    expect(seen.get(actions[2]?.seq as number)).toEqual([
      expect.objectContaining({
        entity: "e_mail0",
        type: "t_correo",
        fields: ["f_asunto"],
        body: null,
      }),
    ]);
    // The model call is linked, and the entity's system columns know who saw it.
    expect(actions[2]?.call).toBeGreaterThan(0);
    expect(env.store.audit.meta(["e_mail0"]).get("e_mail0")?.viewers).toEqual([
      "agent",
      "model:reader:lector-ejemplo/lector-ejemplo",
    ]);
    expect(env.store.audit.verify().ok).toBe(true);
  });

  it("records a change in its own action and a refused one, and where a page was fetched", async () => {
    env = makeEnv();
    const planner = fakePlanner([
      {
        version: 1,
        steps: [
          {
            id: "c",
            op: "call",
            tool: "entities.create",
            args: {
              type: lit("tarea"),
              values: { fn: "obj", args: [lit("titulo"), { quote: "regar" }] },
            },
          },
          {
            id: "w",
            op: "call",
            tool: "web.fetch",
            args: { url: lit("https://example.com/pagina") },
          },
        ],
      },
    ]);
    const res = await env
      .agent(planner)
      .turn({ text: "Apunta: regar y mira la web", origin: PERSONAL });
    const actions = env.store.audit.actions({ run: res.run }).reverse();
    const create = actions.find((a) => a.tool === "entities.create");
    expect(create).toMatchObject({ by: "agent", decision: "allow" });
    const made = env.store.list("t_tarea").find((t) => t.entity.values.f_titulo === "regar");
    expect(
      env.store.audit.meta([made?.entity.id as string]).get(made?.entity.id as string),
    ).toMatchObject({
      createdBy: "agent",
    });
    // Fetching from a turn needs Juan's yes (or is refused): either way the audit has it.
    expect(actions.some((a) => a.tool === "web.fetch" || a.tool === "net.fetch")).toBe(true);
  });
});
