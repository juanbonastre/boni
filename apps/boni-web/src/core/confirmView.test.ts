// What the app reads of a card's rows and of an action's icon, from the server's answer: only in the shapes it paints.
import { describe, expect, it } from "vitest";
import { iconOf, parseConfirmView } from "./agent.ts";

describe("a card's rows (task 95)", () => {
  const row = (extra: Record<string, unknown>) => ({
    arg: "proposals.0",
    role: "proposal",
    value: "Cena con Ejemplo",
    integrity: "external",
    sources: ["model"],
    marks: [],
    ...extra,
  });
  const view = (extra: Record<string, unknown>) =>
    parseConfirmView({ tool: "inbox.accept", title: "Aceptar", rows: [row(extra)] })?.rows[0];

  it("a proposal of the Bandeja keeps its day and time, only as a day and an hour", () => {
    expect(view({ when: { day: "2026-11-20", start: "21:30" } })?.when).toEqual({
      day: "2026-11-20",
      start: "21:30",
    });
    expect(view({ when: { day: "2026-11-20", start: "mañana" } })?.when).toEqual({
      day: "2026-11-20",
    });
    expect(view({ when: { day: "el jueves" } })?.when).toBeUndefined();
    expect(view({ when: "2026-11-20" })?.when).toBeUndefined();
  });

  it("a calendar named beside its id", () => {
    expect(
      view({ arg: "calendar", role: "option", value: "c_01", detail: "Viajes" }),
    ).toMatchObject({ value: "c_01", detail: "Viajes" });
  });
});

describe("an action's icon", () => {
  it("is a name of an icon, never markup or a path", () => {
    expect(iconOf("CalendarX")).toBe("CalendarX");
    expect(iconOf("<svg/>")).toBeNull();
    expect(iconOf("../x")).toBeNull();
    expect(iconOf(3)).toBeNull();
  });
});
