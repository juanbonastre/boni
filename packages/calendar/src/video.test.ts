import { describe, expect, it } from "vitest";
import { hostOf, JOIN_BEFORE_MS, joinWindow, linksOf, videoLink } from "./video.ts";

describe("an event's links and its video call (task 49)", () => {
  it("finds the addresses in the place and the description, each once, trailing punctuation aside", () => {
    const ev = {
      location: "Sala 2.3 · https://example.zoom.us/j/98765432100?pwd=abc.",
      description:
        "Unirse: https://example.zoom.us/j/98765432100?pwd=abc\nOrden del día: https://docs.example.edu/orden (ver antes)\nftp://old.example.edu/x",
    };
    expect(linksOf(ev)).toEqual([
      "https://example.zoom.us/j/98765432100?pwd=abc",
      "https://docs.example.edu/orden",
    ]);
    expect(hostOf("https://www.example.edu/a/b")).toBe("example.edu");
    expect(linksOf({ location: "Aula A-201", description: "" })).toEqual([]);
  });

  it("knows the video call among them, by its host", () => {
    expect(videoLink({ location: "https://meet.google.com/abc-defg-hij", description: "" })).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(
      videoLink({
        location: "Despacho 12",
        description: "Enlace: https://teams.microsoft.com/l/meetup-join/19%3ameeting_x",
      }),
    ).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_x");
    expect(videoLink({ location: "", description: "https://notzoom.us.example.com/x" })).toBeNull();
    expect(videoLink({ location: "https://docs.example.edu/orden", description: "" })).toBeNull();
  });

  it("offers to join from ten minutes before a timed event starts until it ends", () => {
    const start = Date.UTC(2026, 10, 11, 16);
    const ev = {
      when: { kind: "timed" as const, start, end: start + 3_600_000, tz: "Europe/Madrid" },
    };
    expect(joinWindow(ev, start - JOIN_BEFORE_MS - 1)).toBe(false);
    expect(joinWindow(ev, start - JOIN_BEFORE_MS)).toBe(true);
    expect(joinWindow(ev, start + 1_800_000)).toBe(true);
    expect(joinWindow(ev, start + 3_600_000 + 1)).toBe(false);
    expect(
      joinWindow({ when: { kind: "allday" as const, startDay: 20768, endDay: 20768 } }, start),
    ).toBe(false);
  });

  it("a record linked to an external event has that event's call and links too (task 50)", () => {
    const own = { location: "", description: "Mi nota" };
    const linked = {
      id: "ext:ucam:u1",
      calendarId: "ucam",
      title: "Clase IPM",
      location: "https://zoom.us/j/123456",
      description: "Apuntes: https://example.org/apuntes",
    };
    expect(videoLink({ ...own, linked })).toBe("https://zoom.us/j/123456");
    expect(linksOf({ ...own, linked })).toEqual([
      "https://zoom.us/j/123456",
      "https://example.org/apuntes",
    ]);
    expect(videoLink({ ...own, linked: null })).toBeNull();
  });
});
