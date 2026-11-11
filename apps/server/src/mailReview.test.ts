import { describe, expect, it } from "vitest";
import type { MailGuide } from "./mail.ts";
import {
  checkRule,
  type Decision,
  MEASURE,
  measureCandidate,
  measuredMail,
  measureMails,
  ruleCandidates,
  sameThing,
  score,
} from "./mailReview.ts";

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

  it("finds by code the rules his corrections show: a domain always rejected, a sender always moved to one collection", () => {
    const moved = (id: string, sender: string, to = "Gestiones") => ({
      ...d(id, sender, true),
      collection: to,
      corrected: { collection: "Docencia" },
    });
    const ds = [
      d("d1", "a@lista.example.com", false),
      d("d2", "b@lista.example.com", false),
      d("d3", "c@lista.example.com", false),
      moved("d4", "jefa@example.com"),
      moved("d5", "jefa@example.com"),
      d("d6", "x@raro.example.com", false), // two rejected: not enough
      d("d7", "x@raro.example.com", false),
      moved("d8", "ana@example.com"), // moved once, kept once in Docencia: no rule
      d("d9", "ana@example.com", true),
    ];
    const rules = (ds: Decision[], guide: MailGuide = empty, excluded = new Set<string>()) =>
      ruleCandidates(ds, targets, guide, excluded).map((r) => [
        r.from,
        r.action,
        r.collection ?? null,
      ]);
    expect(rules(ds)).toEqual([
      ["@lista.example.com", "skip", null],
      ["jefa@example.com", "collection", "t_gestiones"],
    ]);
    // Never one the guide has, or one Juan refused before.
    const guide = {
      ...empty,
      rules: [{ id: "r", from: "@lista.example.com", action: "skip" as const }],
    };
    expect(rules(ds, guide)).toEqual([["jefa@example.com", "collection", "t_gestiones"]]);
    expect(rules(ds, empty, new Set(["jefa@example.com"]))).toEqual([
      ["@lista.example.com", "skip", null],
    ]);
    // A domain's rule covers its senders' own.
    const one = [
      d("d1", "a@lista.example.com", false),
      d("d2", "a@lista.example.com", false),
      d("d3", "a@lista.example.com", false),
    ];
    expect(rules(one)).toEqual([["@lista.example.com", "skip", null]]);
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

describe("«Medir releyendo» reads again as much as its setting says, never past its cap (F7)", () => {
  const ds = Array.from({ length: 60 }, (_, i) => d(`d${i}`, `p${i}@example.com`, true, `m${i}`));
  const c = { rules: [], examples: [{ id: "d:m59", text: "", want: [] }], guide: empty };
  it("clamps the setting to 1 to 20, 20 when not given", () => {
    expect(measureMails(undefined)).toBe(MEASURE);
    expect(measureMails(5)).toBe(5);
    expect(measureMails(0)).toBe(1);
    expect(measureMails(500)).toBe(20);
    expect(measureMails("50")).toBe(20);
    // The latest decided mail, never its example's, as many as the setting.
    expect(measuredMail(ds, c as never, 5)).toEqual(["m58", "m57", "m56", "m55", "m54"]);
    expect(measuredMail(ds, c as never, 500)).toHaveLength(20);
    expect(measuredMail(ds, c as never)).toHaveLength(20);
  });
  it("a setting past the cap still reads at most 20 mails with each guide: 40 readings of a model at most", async () => {
    let reads = 0;
    const h = {
      ds,
      guide: empty,
      read: async () => {
        reads++;
        return [];
      },
    };
    await measureCandidate(h as never, c as never, 10_000);
    expect(reads).toBe(2 * MEASURE);
    reads = 0;
    await measureCandidate(h as never, c as never, 3);
    expect(reads).toBe(6);
  });
});
