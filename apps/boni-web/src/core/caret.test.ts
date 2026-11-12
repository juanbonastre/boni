import { describe, expect, it } from "vitest";
import { focusAtEnd } from "./caret.ts";

/** A textarea as React makes it with a value: the caret at the start, as Chromium leaves it (task 97). */
function made(text: string) {
  const el = document.createElement("textarea");
  el.defaultValue = text;
  document.body.append(el);
  el.setSelectionRange(0, 0);
  return el;
}

describe("focusAtEnd (task 97)", () => {
  it("puts the caret after a draft read back, so what Juan types goes after it", () => {
    const el = made("y lo de mañana");
    focusAtEnd(el);
    expect(document.activeElement).toBe(el);
    expect([el.selectionStart, el.selectionEnd]).toEqual([14, 14]);
    el.remove();
  });

  it("leaves the caret where Juan put it when it already has the focus", () => {
    const el = made("y lo de mañana");
    focusAtEnd(el);
    el.setSelectionRange(2, 2);
    focusAtEnd(el);
    expect([el.selectionStart, el.selectionEnd]).toEqual([2, 2]);
    el.remove();
  });

  it("does nothing without a field", () => {
    expect(() => focusAtEnd(null)).not.toThrow();
  });
});
