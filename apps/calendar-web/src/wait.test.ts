// The line at the top while the app waits (docs/design-guide.md «Waiting», I-15): after 250 ms, for 500 ms at least, one for everything.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { begin, resetWaiting, SHOW_AFTER, SHOWN_FOR, tracked, waiting } from "./wait.ts";

describe("the line at the top (I-15)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWaiting();
  });
  afterEach(() => vi.useRealTimers());
  it("shows only after 250 ms: an answer that feels instant leaves nothing", () => {
    const end = begin();
    vi.advanceTimersByTime(SHOW_AFTER - 1);
    expect(waiting()).toBe(false);
    end();
    vi.advanceTimersByTime(1000);
    expect(waiting()).toBe(false);
  });
  it("once shown, stays 500 ms at least, then goes when nothing is in flight", () => {
    const end = begin();
    vi.advanceTimersByTime(SHOW_AFTER);
    expect(waiting()).toBe(true);
    end();
    vi.advanceTimersByTime(SHOWN_FOR - 1);
    expect(waiting()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(waiting()).toBe(false);
  });
  it("one line for everything: it stays while any request is in flight", () => {
    const a = begin();
    const b = begin();
    vi.advanceTimersByTime(SHOW_AFTER);
    a();
    a(); // a second call does nothing
    vi.advanceTimersByTime(SHOWN_FOR + 100);
    expect(waiting()).toBe(true);
    b();
    vi.advanceTimersByTime(SHOWN_FOR);
    expect(waiting()).toBe(false);
  });
  it("counts a promise from start to end, a failed one too", async () => {
    await expect(tracked(Promise.reject(new Error("x")))).rejects.toThrow("x");
    vi.advanceTimersByTime(SHOW_AFTER + 1);
    expect(waiting()).toBe(false);
  });
});
