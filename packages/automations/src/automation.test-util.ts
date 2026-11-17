// Automations for the tests, built by step name, with ids generated like the app's (a prefix and a ULID) from a
// seeded generator so a test repeats exactly, and collections whose keys and fields are ids too: invented data, never
// anyone's names (D-14). Steps have no id kind of their own yet: `s_` is the tests' until the editor gives them one.
import { type FieldType, type IdKind, newId } from "@boni/entities";
import { rng } from "../../entities/src/random.test-util.ts";
import { bornParams } from "./catalogue.ts";
import type { CollectionShape, FieldShape } from "./effects.ts";
import {
  ACTION,
  type Arrow,
  type Automation,
  FORMAT,
  MAIN,
  type ParamValue,
  type Step,
  type StepSettings,
} from "./format.ts";
import type { ValidationContext } from "./validate.ts";

/** A fixed instant (2026-11-02 09:30 UTC): ids made with it sort in the order they were made. */
export const T0 = Date.UTC(2026, 10, 2, 9, 30);

/** A generator of ids of every kind, and of steps (`s`), the same for the same seed. */
export function ids(seed = 1): (kind: IdKind | "s") => string {
  const r = rng(seed);
  let t = T0;
  const random = (n: number) => Uint8Array.from({ length: n }, () => r.int(256));
  return (kind) =>
    kind === "s" ? newId("o", t++, random).replace(/^o_/, "s_") : newId(kind, t++, random);
}

export interface Sketch {
  /**
   * Adds a step as the person's hand does in the editor (`addStep`): with the «Permiso» a «Colección» write action
   * is born with (`bornParams`, AU-187) unless `params` says another; `name` is also how the test names it after.
   */
  step(
    name: string,
    type: string,
    params?: Record<string, ParamValue>,
    settings?: StepSettings,
  ): Sketch;
  /** Adds an arrow between two steps by their names. */
  arrow(from: string, to: string, output?: string, input?: string): Sketch;
  /** The id of the step with that name. */
  id(name: string): string;
  /** The automation as it is now: a copy, so a test may change it. */
  build(): Automation;
}

export function sketch(seed = 1): Sketch {
  const next = ids(seed);
  const id = next("e");
  const steps: Step[] = [];
  const arrows: Arrow[] = [];
  const byName = new Map<string, string>();
  const sketchApi: Sketch = {
    step(name, type, params = {}, settings) {
      const stepId = next("s");
      byName.set(name, stepId);
      const action = typeof params[ACTION] === "string" ? params[ACTION] : undefined;
      const all = { ...bornParams(type, action), ...params };
      steps.push({ id: stepId, name, type, params: all, ...(settings ? { settings } : {}) });
      return sketchApi;
    },
    arrow(from, to, output = MAIN, input = MAIN) {
      arrows.push({
        from: { step: sketchApi.id(from), output },
        to: { step: sketchApi.id(to), input },
      });
      return sketchApi;
    },
    id(name) {
      const stepId = byName.get(name);
      if (!stepId) throw new Error(`no step named ${name}`);
      return stepId;
    },
    build: () =>
      structuredClone({
        format: FORMAT,
        id,
        version: 0,
        name: "Prueba",
        steps,
        arrows,
        settings: {},
      }),
  };
  return sketchApi;
}

/** A collection with a key and fields generated as ids, each of the given type, in order. */
export function collection(
  next: (kind: IdKind) => string,
  types: readonly FieldType[],
): CollectionShape {
  const fields: FieldShape[] = types.map((type) => ({ key: next("f"), type }));
  return { key: next("t"), fields };
}

/** What validation may ask, over these collections. */
export const knowing = (...shapes: CollectionShape[]): ValidationContext => ({
  collection: (key) => shapes.find((s) => s.key === key),
});

/** An expression as dragging a field writes it. */
export const cite = (citation: string) => ({ expr: `{{ ${citation} }}` });
