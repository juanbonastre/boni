import { describe, expect, it } from "vitest";
import { anthropicCost, DEFAULT_MODELS, modelsErrors, privacyOf } from "../src/models.ts";

describe("which model does what (Modelos)", () => {
  it("says what a route does with the data only as the request guarantees it", () => {
    expect(privacyOf({ connection: "openrouter", zdr: true })).toBe("keeps-nothing");
    expect(privacyOf({ connection: "openrouter" })).toBe("may-keep");
    expect(privacyOf({ connection: "anthropic" })).toBe("deletes-in-30-days");
    expect(privacyOf({ connection: "typesafe" })).toBe("unknown");
  });

  it("checks a configuration", () => {
    expect(modelsErrors(DEFAULT_MODELS)).toEqual([]);
    expect(
      modelsErrors({
        ...DEFAULT_MODELS,
        roles: {
          reader: { connection: "openrouter", model: "deepseek/deepseek-v4.1-flash", zdr: true },
        },
      }),
    ).toEqual([]);
    expect(
      modelsErrors({
        roles: {
          writer: { connection: "openrouter", model: "x" },
          reader: { connection: "anthropic", model: "claude-haiku-4-5", zdr: true },
          planner: { connection: "elsewhere", model: "a b" },
          decider: { connection: "anthropic", model: "claude-haiku-4-5" },
        },
        budget: { monthlyEur: -1, warnAt: 2 },
        usdToEur: 0,
      }),
    ).toEqual([
      "roles.writer: unknown role",
      "roles.reader.zdr: only through OpenRouter",
      "roles.planner.connection: one of openrouter, anthropic, typesafe",
      "roles.planner.model: a model id",
      "roles.decider: Jev runs on TypeSafe or OpenRouter",
      "budget: monthlyEur 0-10000 and warnAt over 0 up to 1",
      "usdToEur: a rate between 0.1 and 10",
    ]);
  });

  it("prices a call to Anthropic's API; an unknown model is never under-counted", () => {
    expect(anthropicCost("claude-opus-5-5", 1_000_000, 0)).toBe(4);
    expect(anthropicCost("claude-haiku-4-5", 0, 1_000_000)).toBe(5);
    expect(anthropicCost("claude-haiku-5-5", 200_000, 0)).toBe(0.1);
    expect(anthropicCost("claude-opus-9", 1_000_000, 0)).toBe(5);
    expect(anthropicCost("modelo-desconocido", 1_000_000, 0)).toBe(10);
  });
});
