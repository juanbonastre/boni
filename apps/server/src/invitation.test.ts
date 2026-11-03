import { describe, expect, it } from "vitest";
import { feedHas, invitationLine, invitationOf } from "./invitation.ts";

/** Invented invitations only, shaped like the ones calendars send. */
const google = (o: { method?: string; start?: string; end?: string; uid?: string } = {}) =>
  [
    "BEGIN:VCALENDAR",
    "PRODID:-//Example//Calendar//ES",
    "VERSION:2.0",
    `METHOD:${o.method ?? "REQUEST"}`,
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Madrid",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `DTSTART;TZID=Europe/Madrid:${o.start ?? "20261111T170000"}`,
    `DTEND;TZID=Europe/Madrid:${o.end ?? "20261111T180000"}`,
    "DTSTAMP:20261103T100000Z",
    "ORGANIZER;CN=Secretaría Ejemplo:mailto:secretaria.ejemplo@universidad.example",
    `UID:${o.uid ?? "0123abcd@google.com"}`,
    "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=juan.ejemplo@example.com:mailto:juan.ejemp",
    " lo@example.com",
    "DESCRIPTION:Entrevista de reconocimiento de créditos.\\n\\nUnirse a la reunión Zoom\\nhttps://example.zoom.us/j/9",
    " 8765432100?pwd=abc\\n\\nID de reunión: 987 6543 2100",
    "LOCATION:Sala 2.3\\, Edificio Ejemplo",
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "SUMMARY:Reconocimiento experiencia profesional_Ejemplo",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

describe("a calendar invitation read by code (task 45)", () => {
  it("gives the event's day and hours in the user's timezone, its place, its video-call link and its UID", () => {
    const i = invitationOf(google(), "Europe/Madrid");
    expect(i).toMatchObject({
      uid: "0123abcd@google.com",
      title: "Reconocimiento experiencia profesional_Ejemplo",
      method: "REQUEST",
      day: "2026-11-11",
      start: "17:00",
      end: "18:00",
      tz: "Europe/Madrid",
      location: "Sala 2.3, Edificio Ejemplo",
      // The folded line is joined before the link is read.
      link: "https://example.zoom.us/j/98765432100?pwd=abc",
    });
    expect(invitationLine(i as NonNullable<typeof i>)).toBe(
      "Invitación: Reconocimiento experiencia profesional_Ejemplo · 2026-11-11 17:00–18:00 · Sala 2.3, Edificio Ejemplo",
    );
  });

  it("converts UTC times to the user's timezone, and an all-day or multi-day event has no hours to keep", () => {
    const utc = google({ start: "20261111T160000Z", end: "20261111T170000Z" }).replace(
      /;TZID=Europe\/Madrid/g,
      "",
    );
    expect(invitationOf(utc, "Europe/Madrid")).toMatchObject({ start: "17:00", end: "18:00" });
    expect(invitationOf(utc, "America/Mexico_City")).toMatchObject({
      day: "2026-11-11",
      start: "10:00",
      end: "11:00",
    });
    const allDay = google().replace(
      /DTSTART;TZID=Europe\/Madrid:\d+T\d+\r\nDTEND;TZID=Europe\/Madrid:\d+T\d+/,
      "DTSTART;VALUE=DATE:20261111\r\nDTEND;VALUE=DATE:20261112",
    );
    expect(invitationOf(allDay, "Europe/Madrid")).toMatchObject({
      day: "2026-11-11",
      start: null,
      end: null,
    });
    const overnight = google({ start: "20261111T233000", end: "20261112T003000" });
    expect(invitationOf(overnight, "Europe/Madrid")).toMatchObject({ start: "23:30", end: null });
  });

  it("says the method, and is null without an event or with a broken file", () => {
    expect(invitationOf(google({ method: "CANCEL" }), "Europe/Madrid")?.method).toBe("CANCEL");
    expect(invitationOf("BEGIN:VCALENDAR\r\nEND:VCALENDAR", "Europe/Madrid")).toBeNull();
    expect(invitationOf("not a calendar at all", "Europe/Madrid")).toBeNull();
    expect(
      invitationOf("BEGIN:VEVENT\r\nDTSTART:garbage\r\nEND:VEVENT", "Europe/Madrid"),
    ).toBeNull();
  });

  it("finds the event in a calendar's feed by its UID, folded lines included, never by a prefix", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:0123abcd@google",
      " .com",
      "SUMMARY:Otra cosa",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    expect(feedHas(feed, "0123abcd@google.com")).toBe(true);
    expect(feedHas(feed, "0123abcd")).toBe(false);
    expect(feedHas(feed, "")).toBe(false);
    expect(feedHas("", "0123abcd@google.com")).toBe(false);
  });
});
