import { describe, expect, it } from "vitest";
import { dayOf, ExternalItems } from "./externalItems.ts";
import { Feeds } from "./feeds.ts";

const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:taller@example.com",
  "DTSTART;TZID=Europe/Madrid:20250915T190000",
  "DTEND;TZID=Europe/Madrid:20250915T200000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TH",
  "SUMMARY:Taller externo",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:fiesta@example.com",
  "DTSTART;VALUE=DATE:20250918",
  "DTEND;VALUE=DATE:20250919",
  "SUMMARY:Fiesta inventada",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:noche@example.com",
  "DTSTART;TZID=Europe/Madrid:20250918T230000",
  "DTEND;TZID=Europe/Madrid:20250919T010000",
  "SUMMARY:Hasta la madrugada",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const UCAM = [{ id: "ucam", name: "UCAM", url: "https://example.com/ucam.ics" }];

describe("an account's external calendars by day, for the inbox's cards (task 51)", () => {
  it("gives a day's events with their ids, once the server has the feed; an all-day one without times", async () => {
    let downloads = 0;
    const feeds = new Feeds(async () => {
      downloads++;
      return FEED;
    });
    const ext = new ExternalItems(feeds, "Europe/Madrid");
    // Not downloaded yet: nothing today, asked for in the background.
    expect(ext.items(1, UCAM, ["2025-09-18"])).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(downloads).toBe(1);
    const day = dayOf("2025-09-18") as number;
    expect(ext.items(1, UCAM, ["2025-09-18"])).toEqual([
      {
        title: "Fiesta inventada",
        start: null,
        end: null,
        external: "ext:ucam:fiesta@example.com",
        calendar: "UCAM",
      },
      {
        title: "Taller externo",
        start: "19:00",
        end: "20:00",
        external: `ext:ucam:taller@example.com~${day}`,
        calendar: "UCAM",
      },
      {
        title: "Hasta la madrugada",
        start: "23:00",
        end: "23:59",
        external: "ext:ucam:noche@example.com",
        calendar: "UCAM",
      },
    ]);
    // Wednesday: no occurrence; several days at once; a day that is not one.
    expect(ext.items(1, UCAM, ["2025-09-17"])).toEqual([]);
    expect(ext.items(1, UCAM, ["2025-09-15", "2025-09-18"]).map((i) => i.title)).toEqual([
      "Fiesta inventada",
      "Taller externo",
      "Taller externo",
      "Hasta la madrugada",
    ]);
    expect(ext.items(1, UCAM, ["ayer"])).toEqual([]);
    expect(ext.items(1, [], ["2025-09-18"])).toEqual([]);
    // The copy is parsed once per download, not per request.
    expect(downloads).toBe(1);
  });
});
