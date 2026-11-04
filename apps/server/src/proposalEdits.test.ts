import { describe, expect, it } from "vitest";
import { linkOf } from "./proposalEdits.ts";

describe("a proposal accepted linked to an external event (task 51)", () => {
  it("takes the event's id as the calendar app writes it, nothing else", () => {
    expect(linkOf({ title: "x" })).toEqual({ id: null });
    expect(linkOf(undefined)).toEqual({ id: null });
    expect(linkOf({ link: "ext:ucam:u1" })).toEqual({ id: "ext:ucam:u1" });
    expect(linkOf({ link: "ext:ucam:taller@example.com~20348" })).toEqual({
      id: "ext:ucam:taller@example.com~20348",
    });
    expect(linkOf({ link: "u1" })).toEqual({ error: "bad-link" });
    expect(linkOf({ link: "ext:ucam:" })).toEqual({ error: "bad-link" });
    expect(linkOf({ link: 7 })).toEqual({ error: "bad-link" });
    expect(linkOf({ link: "ext:a b:c" })).toEqual({ error: "bad-link" });
  });
});
