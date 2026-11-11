// The learners' pace and switch (docs/fiabilidad.md F4, docs/preferencias.md §5; A-14): at most one suggestion a day not asked for, none with «Aprender» off.
import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { DAY, learningOn, mayReview, REVIEW_EVERY, reviewEvery, setLearning } from "./learning.ts";
import { MIN_DECISIONS } from "./mailReview.ts";

describe("what a learner may do on its own (A-14)", () => {
  const base = {
    learning: true,
    waiting: false,
    suggestedAt: null,
    lookedAt: null,
    now: DAY * 10,
    fresh: () => 0,
    every: 20,
    candidates: () => 0,
  };
  it("looks when Juan's decisions add up, or when a correction of his, repeated, already shows a rule", () => {
    expect(mayReview(base)).toBe(false);
    expect(mayReview({ ...base, fresh: () => 20 })).toBe(true);
    expect(mayReview({ ...base, fresh: () => 19 })).toBe(false);
    expect(mayReview({ ...base, candidates: () => 1 })).toBe(true);
  });
  it("how many decisions make it look is the flow's setting, with a hard cap: never below 10, never above 500 (F7)", () => {
    expect(reviewEvery(30, 20)).toBe(30);
    expect(reviewEvery(undefined, 20)).toBe(20);
    expect(reviewEvery("5", 20)).toBe(20);
    expect(reviewEvery(Number.NaN, 20)).toBe(20);
    // A setting past the cap is clamped: changing a Boni flow changes what it does, never what it is allowed.
    expect(reviewEvery(1, 20)).toBe(REVIEW_EVERY.min);
    expect(reviewEvery(0, 20)).toBe(10);
    expect(reviewEvery(-3, 20)).toBe(10);
    expect(reviewEvery(10_000, 20)).toBe(REVIEW_EVERY.max);
    expect(reviewEvery(1, 1)).toBe(10); // an extension's default is clamped the same
    // The floor is the fewest decisions a review works on: it cannot be made to look more often than that.
    expect(REVIEW_EVERY.min).toBe(MIN_DECISIONS);
    expect(mayReview({ ...base, every: reviewEvery(1, 20), fresh: () => 9 })).toBe(false);
    expect(mayReview({ ...base, every: reviewEvery(1, 20), fresh: () => 10 })).toBe(true);
  });
  it("never with «Aprender» off, while a suggestion waits for him, or within a day of the last one", () => {
    const ready = { ...base, fresh: () => 20, candidates: () => 1 };
    expect(mayReview({ ...ready, learning: false })).toBe(false);
    expect(mayReview({ ...ready, waiting: true })).toBe(false);
    expect(mayReview({ ...ready, suggestedAt: ready.now - DAY + 1 })).toBe(false);
    expect(mayReview({ ...ready, suggestedAt: ready.now - DAY })).toBe(true);
  });
  it("a candidate found by code makes it look once a day at most, whatever the last look gave; the decisions always count", () => {
    const found = { ...base, candidates: () => 1 };
    expect(mayReview({ ...found, lookedAt: found.now - DAY + 1 })).toBe(false);
    expect(mayReview({ ...found, lookedAt: found.now - DAY })).toBe(true);
    expect(mayReview({ ...found, lookedAt: found.now - 1, fresh: () => 20 })).toBe(true);
  });
  it("counts his proposals and decisions only once the cheap gates pass", () => {
    let counted = 0;
    const count = () => {
      counted++;
      return 0;
    };
    mayReview({ ...base, learning: false, fresh: count, candidates: count });
    mayReview({ ...base, suggestedAt: base.now, fresh: count, candidates: count });
    expect(counted).toBe(0);
  });
  it("«Aprender» is on until Juan turns it off, and kept in his store", () => {
    const store = openUserStore(":memory:");
    expect(learningOn(store)).toBe(true);
    setLearning(store, false);
    expect(learningOn(store)).toBe(false);
    setLearning(store, true);
    expect(learningOn(store)).toBe(true);
  });
});
