import { describe, expect, it } from "vitest";
import {
  atLeast,
  canBeDestination,
  derive,
  INTEGRITY_ORDER,
  integrityRank,
  join,
  type Label,
  label,
  labeled,
  modelMaySee,
  plannerMaySee,
  raiseSensitivity,
  SENSITIVITY_ORDER,
  sensitivityRank,
} from "./label.ts";
import { rng } from "./random.test-util.ts";

const KINDS = ["turn", "vault", "mail", "web", "model"] as const;
function randomLabel(r: ReturnType<typeof rng>): Label {
  const sources = Array.from({ length: r.int(3) }, () => ({
    kind: r.pick(KINDS),
    id: String(r.int(4)),
  }));
  return label(r.pick(INTEGRITY_ORDER), r.pick(SENSITIVITY_ORDER), sources, r.next() < 0.3);
}

describe("labels", () => {
  it("join keeps the lowest integrity, the highest sensitivity, third party and every source", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const ls = Array.from({ length: 1 + r.int(4) }, () => randomLabel(r));
      const j = join(ls[0] as Label, ...ls.slice(1));
      expect(integrityRank(j.integrity), `seed ${seed}`).toBe(
        Math.min(...ls.map((l) => integrityRank(l.integrity))),
      );
      expect(sensitivityRank(j.sensitivity)).toBe(
        Math.max(...ls.map((l) => sensitivityRank(l.sensitivity))),
      );
      expect(j.thirdParty).toBe(ls.some((l) => l.thirdParty));
      for (const l of ls) for (const s of l.sources) expect(j.sources).toContainEqual(s);
      expect(new Set(j.sources.map((s) => `${s.kind}:${s.id}`)).size).toBe(j.sources.length);
    }
  });

  it("join does not depend on the order or on repeats", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const [a, b, c] = [randomLabel(r), randomLabel(r), randomLabel(r)];
      expect(join(a, b, c)).toEqual(join(c, a, b));
      expect(join(join(a, b), c)).toEqual(join(a, join(b, c)));
      expect(join(a, a)).toEqual(join(a));
    }
  });

  it("an external input can never be laundered upwards", () => {
    const mail = label("external", "sensitive", [{ kind: "mail", id: "m1" }]);
    const juan = label("user", "public", [{ kind: "turn", id: "t1" }]);
    const made = join(juan, mail);
    expect(made.integrity).toBe("external");
    expect(made.sensitivity).toBe("sensitive");
    expect(plannerMaySee(made)).toBe(false);
    expect(atLeast(made, "imported")).toBe(false);
  });

  it("sensitivity only goes up here", () => {
    const l = label("user", "sensitive", []);
    expect(raiseSensitivity(l, "public").sensitivity).toBe("sensitive");
    expect(raiseSensitivity(label("user", "public", []), "personal").sensitivity).toBe("personal");
  });

  it("only values taken as they are, from Juan, Boni or the vault, can be destinations", () => {
    const quote = labeled(
      "ana@example.com",
      label("user", "personal", [{ kind: "turn", id: "t1" }]),
    );
    expect(canBeDestination(quote)).toBe(true);
    expect(canBeDestination(labeled("x@example.com", label("imported", "personal", [])))).toBe(
      true,
    );
    for (const low of ["model", "ambient", "external"] as const)
      expect(canBeDestination(labeled("x@example.com", label(low, "public", []))), low).toBe(false);
    // Pieces of what Juan said, put together by a plan, are not something Juan said (attack A1).
    const a = labeled("atacante", quote.label);
    const b = labeled("@example.com", quote.label);
    const glued = derive(`${a.value}${b.value}`, a, b);
    expect(glued.label.integrity).toBe("user");
    expect(canBeDestination(glued)).toBe(false);
  });

  it("what Juan keeps from the models stays kept in everything made from it", () => {
    const kept = { ...label("user", "personal", []), noModel: true as const };
    const juan = label("user", "public", [{ kind: "turn", id: "t1" }]);
    expect(join(juan, kept).noModel).toBe(true);
    expect(join(kept, juan).noModel).toBe(true);
    expect(plannerMaySee(join(juan, kept))).toBe(false);
    expect(modelMaySee(join(juan, kept))).toBe(false);
    expect("noModel" in join(juan, juan)).toBe(false);
  });

  it("the planner sees everything except external and ambient text", () => {
    for (const i of INTEGRITY_ORDER)
      expect(plannerMaySee(label(i, "public", [])), i).toBe(i !== "external" && i !== "ambient");
  });
});
