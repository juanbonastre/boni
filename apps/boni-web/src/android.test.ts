/** (test) The Android app's side of the page: what is typed and not sent is kept before the page goes on (task 106). */
import { describe, expect, it } from "vitest";
import { type AndroidNative, androidHost } from "./android.ts";

describe("Boni Android's host", () => {
  it("keeps the list of what was typed with one call that has written it when it returns, not on the pool", () => {
    const written: string[] = [];
    const calls: string[] = [];
    const native: AndroidNative = {
      call: (_id, method) => void calls.push(method),
      take: () => "{}",
      keepUnsent: (text) => void written.push(text),
    };
    const host = androidHost(native);
    host.keepUnsent?.('[{"path":"api/data/rows/r_01"}]');
    expect(written).toEqual(['[{"path":"api/data/rows/r_01"}]']);
    expect(calls).toEqual([]);
  });

  it("an app built before it has none: the page keeps the list with the store's write, as before", () => {
    const host = androidHost({ call: () => undefined, take: () => "{}" });
    expect(host.keepUnsent).toBeUndefined();
  });
});
