import { describe, expect, it } from "vitest";
import { checkRule, type Decision, sameThing, score } from "./mailReview.ts";

const d = (id: string, sender: string, accepted: boolean, mail = id, title = "Revisar el acta") =>
  ({
    id,
    proposal: id,
    mail,
    sender,
    userIn: "to",
    collection: "Docencia",
    title,
    due: null,
    accepted,
    at: 0,
    made: 0,
  }) satisfies Decision;
const targets = [
  { id: "t_docencia", key: "docencia", name: "Docencia", option: "Docencia", date: null },
  { id: "t_gestiones", key: "gestiones", name: "Gestiones", option: "Gestiones", date: null },
];
const empty = { instructions: "", rules: [], examples: [] };

describe("what the reviewer may suggest (docs/nucleo.md 7.4b)", () => {
  it("never: skip a sender Juan accepted, or with too few decisions; a collection that is not marked", () => {
    const ds = [
      d("d1", "a@lista.example.com", false),
      d("d2", "b@lista.example.com", false),
      d("d3", "c@lista.example.com", false),
      d("d4", "jefa@example.com", true),
      d("d5", "jefa@example.com", true),
      d("d6", "x@raro.example.com", false),
    ];
    const rule = (from: string, action: string, collection: string | null = null) =>
      checkRule({ from, action, collection }, ds, targets, empty);
    expect(rule("@lista.example.com", "skip")?.action).toBe("skip");
    expect(rule("jefa@example.com", "skip")).toBeNull();
    expect(rule("x@raro.example.com", "skip")).toBeNull(); // one decision says nothing
    expect(rule("jefa@example.com", "collection", "Gestiones")?.collection).toBe("t_gestiones");
    expect(rule("jefa@example.com", "collection", "Diario")).toBeNull();
    expect(rule("@lista.example.com", "collection", "Docencia")).toBeNull(); // never accepted
    // Already in the guide, or refused before: never again.
    const guide = {
      ...empty,
      rules: [{ id: "r", from: "@lista.example.com", action: "skip" as const }],
    };
    expect(
      checkRule(
        { from: "@lista.example.com", action: "skip", collection: null },
        ds,
        targets,
        guide,
      ),
    ).toBeNull();
    expect(
      checkRule(
        { from: "@LISTA.example.com", action: "skip", collection: null },
        ds,
        targets,
        empty,
        new Set(["@lista.example.com"]),
      ),
    ).toBeNull();
  });

  it("measures by what a reading gives again: accepted found, rejected not", () => {
    expect(sameThing("Revisar el acta de la reunión", "Revisar acta")).toBe(true);
    expect(sameThing("Enviar las notas", "Revisar el acta")).toBe(false);
    const ds = [
      d("d1", "a@x.example.com", true, "m1"),
      d("d2", "b@x.example.com", false, "m2", "Feria"),
    ];
    expect(
      score(
        ds,
        new Map([
          ["m1", ["Revisar el acta"]],
          ["m2", []],
        ]),
      ),
    ).toBe(2);
    expect(
      score(
        ds,
        new Map([
          ["m1", []],
          ["m2", ["Ir a la feria"]],
        ]),
      ),
    ).toBe(0);
  });
});
