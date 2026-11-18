// What «Modelo» offers and what «Modelos» says of a model (docs/automatizaciones.md §5.16): the options of a step, the
// chat's, the list's order after a move, and their time with a large account (A-15).
import { cpu, under } from "@boni/pace";
import { describe, expect, it } from "vitest";
import { parseModelChoices, parseModelsList } from "./agent.ts";
import { markParts, modelName, modelOptions, moved, nameOfId, used } from "./modelChoices.ts";

const A = "openrouter:ejemplo/modelo-a";
const B = "openrouter:ejemplo/modelo-b:zdr";
const choices = (o: { tags?: unknown[]; models?: unknown[]; answers?: string | null } = {}) =>
  parseModelChoices({
    kind: "reading",
    account: { value: null, answers: o.answers === undefined ? A : o.answers },
    tags: o.tags ?? [
      { id: "tag:barato0000000001", name: "Barato", answers: B, state: "ok" },
      { id: "tag:vacia000000000001", name: "Vacía", answers: null, state: "no-model" },
      { id: "tag:vieja000000000001", name: "Vieja", answers: A, state: "expired" },
    ],
    models: o.models ?? [
      {
        id: A,
        connection: "openrouter",
        model: "ejemplo/modelo-a",
        zdr: false,
        privacy: "may-keep",
      },
      {
        id: B,
        connection: "openrouter",
        model: "ejemplo/modelo-b",
        zdr: true,
        privacy: "keeps-nothing",
      },
    ],
    personal: true,
  }) ?? undefined;

describe("«Modelo» and «Modelos» as data", () => {
  it("AU-238 · a step's «Modelo» offers «El de la cuenta» with what answers, the tags with their model and the models of its kind", () => {
    const o = modelOptions(choices(), "");
    expect(o.account).toBe("modelo-a");
    expect(o.tags).toEqual([
      { value: "tag:barato0000000001", name: "Barato", answers: "modelo-b", off: null },
      { value: "tag:vacia000000000001", name: "Vacía", answers: null, off: "no-model" },
      { value: "tag:vieja000000000001", name: "Vieja", answers: "modelo-a", off: "expired" },
    ]);
    expect(o.models).toEqual([
      { value: A, name: "modelo-a" },
      { value: B, name: "modelo-b" },
    ]);
    expect(o.gone).toBeNull();
    // A value it keeps that is no longer offered is said in the list itself; before the choices come, nothing is.
    expect(modelOptions(choices(), "openrouter:ejemplo/ya-no:zdr").gone).toBe("ya-no");
    expect(modelOptions(choices(), "tag:borrada000000001").gone).toBe("tag:borrada000000001");
    expect(modelOptions(undefined, "openrouter:ejemplo/ya-no").gone).toBeNull();
  });

  it("AU-241 · a tag without a model that answers is off with its reason, and «El de la cuenta» without one says so", () => {
    const o = modelOptions(choices({ answers: null }), "");
    expect(o.account).toBeNull();
    expect(o.tags.filter((g) => g.off !== null).map((g) => [g.name, g.off])).toEqual([
      ["Vacía", "no-model"],
      ["Vieja", "expired"],
    ]);
    // A state the client does not know is read as «Sin modelo», never as one that can be chosen.
    const odd = modelOptions(
      choices({ tags: [{ id: "tag:rara0000000000001", name: "Rara", answers: A, state: "otro" }] }),
      "",
    );
    expect(odd.tags[0]?.off).toBe("no-model");
  });

  it("AU-242 · the chat's options have no tags, and a conversation's model no longer offered is not said gone there", () => {
    const o = modelOptions(choices(), "tag:barato0000000001", { tags: false });
    expect(o.tags).toEqual([]);
    expect(o.models).toHaveLength(2);
  });

  it("AU-232 · a move puts the model where the other was, keeps every model once, and the list's words come from the data", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moved(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moved(ids, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(moved(ids, "b", "b")).toEqual(ids);
    expect(moved(ids, "x", "a")).toEqual(ids);
    expect(new Set(moved(ids, "c", "b")).size).toBe(4);
    expect(modelName("z-ai/glm-5.2")).toBe("glm-5.2");
    expect(nameOfId("openrouter:z-ai/glm-5.2:zdr")).toBe("glm-5.2");
    expect(nameOfId("jev:jev-decider")).toBe("jev-decider");
    expect(markParts(null)).toBeNull();
    expect(markParts({ right: 0, total: 0, at: 1, partial: false, expired: false })).toBeNull();
    expect(markParts({ right: 22, total: 24, at: 1, partial: false, expired: true })).toEqual({
      right: 22,
      total: 24,
      expired: true,
      partial: false,
    });
    expect(used({ rows: [], automations: 0, conversations: 0 })).toBe(false);
    expect(used({ rows: ["reading"], automations: 0, conversations: 0 })).toBe(true);
  });

  it("AU-232 · the list reads the server's answer, and an answer without «personal» from an older server changes nothing", () => {
    const l = parseModelsList({
      models: [
        {
          id: A,
          connection: "openrouter",
          model: "ejemplo/modelo-a",
          zdr: false,
          privacy: "may-keep",
          server: false,
          kinds: ["agent", "reading"],
          tags: [{ id: "tag:barato0000000001", name: "Barato" }],
          key: true,
          evaluation: { right: 22, total: 24, at: 1, partial: false, expired: false },
          cost: 0.5,
          eur: 0.46,
          uses: { rows: ["agent"], automations: 3, conversations: 1 },
        },
      ],
      tags: [
        {
          id: "tag:barato0000000001",
          name: "Barato",
          uses: { rows: [], automations: 2, conversations: 0 },
        },
      ],
      account: [{ kind: "agent", value: A, answers: A, automations: 4 }],
      evaluating: null,
    });
    expect(l?.models[0]).toMatchObject({ id: A, tags: [{ name: "Barato" }], eur: 0.46 });
    expect(l?.account[0]).toMatchObject({ kind: "agent", automations: 4 });
    expect(l?.personal).toBe(true);
    expect(parseModelsList({ models: [], tags: [], account: [], personal: false })?.personal).toBe(
      false,
    );
  });

  it("AU-238 · with 60 models and 20 tags, the options of 200 steps are made in a frame's time (A-15)", () => {
    const models = Array.from({ length: 60 }, (_, i) => ({
      id: `openrouter:ejemplo/modelo-${String(i).padStart(2, "0")}`,
      connection: "openrouter",
      model: `ejemplo/modelo-${String(i).padStart(2, "0")}`,
      zdr: false,
      privacy: "may-keep",
    }));
    const tags = Array.from({ length: 20 }, (_, i) => ({
      id: `tag:etiqueta${String(i).padStart(8, "0")}`,
      name: `Etiqueta ${i}`,
      answers: models[i]?.id ?? null,
      state: i % 5 ? "ok" : "expired",
    }));
    const start = cpu();
    const c = choices({ tags, models });
    // Each step keeps a model, a tag, nothing or one gone; the panel makes one step's options when it opens.
    const made = Array.from({ length: 200 }, (_, k) =>
      modelOptions(
        c,
        k % 4 === 0
          ? ""
          : k % 4 === 1
            ? (tags[k % 20]?.id as string)
            : k % 4 === 2
              ? (models[k % 60]?.id as string)
              : "openrouter:ejemplo/ya-no",
      ),
    );
    const ms = cpu() - start;
    expect(c?.models).toHaveLength(60);
    expect(made[3]?.gone).toBe("ya-no");
    expect(made[1]?.tags).toHaveLength(20);
    // Measured here (2026-11-18, idle): about 2 ms for the 200.
    under(ms, 16, "cpu", "the options of 200 steps with 60 models and 20 tags");
  });
});
