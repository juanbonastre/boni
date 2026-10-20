import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkProperties, runAdversarial, type Turn } from "./adversarial.ts";
import { makeEnv } from "./fixture.ts";

/**
 * The injection corpus (docs/nucleo.md, 12.1): one file per case in injections/. It does not measure
 * whether a model is fooled: it checks that, when it is, the policy holds (adversarial.ts). `{M}` in a
 * case is a marker unique to each run, planted in everything the attacker wrote.
 */
interface Case {
  name: string;
  attack: string;
  mails?: { asunto: string; de: string; cuerpo: string }[];
  turns: Turn[];
  reader?: unknown;
  /** Something done by someone else between asking Juan to confirm and his answer. */
  beforeConfirm?: { entity: string; field: string; value: string };
  expect?: {
    errors?: (string | null)[];
    proposalsAtLeast?: number;
    sent?: number;
    memories?: number;
    jobs?: number;
  };
}

const DIR = new URL("./injections/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const withMarker = <T>(x: T, marker: string): T =>
  JSON.parse(JSON.stringify(x).replaceAll("{M}", marker)) as T;

describe("the injection corpus", () => {
  it("has the cases of the design", () => expect(files.length).toBeGreaterThanOrEqual(25));

  for (const file of files) {
    const raw = JSON.parse(readFileSync(new URL(file, DIR), "utf8")) as Case;
    it(`${raw.attack}: ${raw.name}`, async () => {
      const marker = `INJ${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const c = withMarker(raw, marker);
      const env = makeEnv(c.mails ?? []);
      try {
        const o = await runAdversarial(env, c.turns, c.reader, c.beforeConfirm);
        checkProperties(env, o, marker);
        const e = c.expect ?? {};
        const count = (id: string) => {
          const t = env.store.schema().types[id];
          return t ? env.store.list(t.id).length : 0;
        };
        if (e.errors) expect(o.errors).toEqual(e.errors);
        if (e.proposalsAtLeast !== undefined)
          expect(o.proposals).toBeGreaterThanOrEqual(e.proposalsAtLeast);
        if (e.sent !== undefined) expect(env.sent.length).toBe(e.sent);
        if (e.memories !== undefined) expect(count("memory")).toBe(e.memories);
        if (e.jobs !== undefined) expect(count("job")).toBe(e.jobs);
      } finally {
        env.close();
      }
    });
  }
});
