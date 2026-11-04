import { describe, expect, it } from "vitest";
import { candidatesFor, externalCalendarOf, linkExternals, overlaps, suggestLink } from "./link.ts";
import type { CalEvent } from "./model.ts";
import { occurrenceId } from "./recurrence.ts";
import { MS_DAY, toLocal } from "./time.ts";

const TZ = "Europe/Madrid";
const at = (iso: string) => Date.parse(iso);
const HOUR = 3_600_000;
const event = (
  id: string,
  calendarId: string,
  title: string,
  start: number,
  extra: Partial<CalEvent> = {},
): CalEvent => ({
  id,
  calendarId,
  title,
  when: { kind: "timed", start, end: start + HOUR, tz: TZ },
  location: "",
  description: "",
  props: {},
  isTask: false,
  done: false,
  created: 1,
  updated: 1,
  ...extra,
});
const CLASS = at("2026-11-11T17:00:00+01:00");
const ucam = new Set(["ucam"]);

describe("a record linked to an external calendar's event (task 50)", () => {
  it("shows the record at the external event's time, says whose, and absorbs the external event", () => {
    const own = event("r1", "docencia", "Clase IPM 8, nota mía", CLASS - 2 * HOUR, {
      external: "ext:ucam:u1",
    });
    const ext = event("ext:ucam:u1", "ucam", "Clase IPM", CLASS, { location: "Aula 2.3" });
    const other = event("ext:ucam:u2", "ucam", "Otra", CLASS + 3 * HOUR);
    const out = linkExternals([own, ext, other], ucam);
    expect(out.map((e) => e.id)).toEqual(["r1", "ext:ucam:u2"]);
    expect(out[0]).toMatchObject({
      id: "r1",
      title: "Clase IPM 8, nota mía",
      when: ext.when,
      linked: {
        id: "ext:ucam:u1",
        calendarId: "ucam",
        title: "Clase IPM",
        location: "Aula 2.3",
        description: "",
      },
    });
  });

  it("links to one occurrence of a repeating external event: that day becomes an exception of its master", () => {
    const master = event("ext:ucam:u3", "ucam", "Clase semanal", CLASS, {
      recurrence: { freq: "weekly", interval: 1 },
    });
    const day = toLocal(CLASS, TZ).day + 7;
    const own = event("r2", "docencia", "Clase con nota", CLASS + 7 * MS_DAY + HOUR, {
      external: occurrenceId(master.id, day),
    });
    const out = linkExternals([master, own], ucam);
    expect(out.find((e) => e.id === master.id)?.exdates).toEqual([day]);
    const linked = out.find((e) => e.id === "r2");
    expect(linked?.when).toEqual({
      kind: "timed",
      start: CLASS + 7 * MS_DAY,
      end: CLASS + 7 * MS_DAY + HOUR,
      tz: TZ,
    });
    expect(linked?.linked?.id).toBe(occurrenceId(master.id, day));
  });

  it("marks a link whose event is gone from a calendar that is here, and leaves one whose calendar is not", () => {
    const gone = event("r3", "docencia", "Clase", CLASS, { external: "ext:ucam:u9" });
    const elsewhere = event("r4", "docencia", "Clase", CLASS, { external: "ext:otro:u1" });
    const out = linkExternals([gone, elsewhere], ucam);
    expect(out.find((e) => e.id === "r3")).toMatchObject({ linkLost: true, when: gone.when });
    expect(out.find((e) => e.id === "r4")).toBe(elsewhere);
    // Nothing to link: the same list comes back.
    const plain = [event("r5", "docencia", "Sin enlace", CLASS)];
    expect(linkExternals(plain, ucam)).toBe(plain);
    expect(externalCalendarOf("ext:ucam:u1~20768")).toBe("ucam");
    expect(externalCalendarOf("r5")).toBeNull();
  });

  it("offers the records near an external event, the closest first, and suggests the one that is the same", () => {
    const ext = event("ext:ucam:u1", "ucam", "Clase IPM 8", CLASS);
    const same = event("r1", "docencia", "Clase IPM 8 (mi nota)", CLASS + 10 * 60_000);
    const later = event("r2", "docencia", "Tutoría", CLASS + 5 * HOUR);
    const nextDay = event("r3", "docencia", "Clase IPM 9", CLASS + MS_DAY);
    const farAway = event("r4", "docencia", "Clase IPM 8", CLASS + 5 * MS_DAY);
    const linkedAlready = event("r5", "docencia", "Clase IPM 8", CLASS, {
      external: "ext:ucam:u7",
    });
    const gym = event("r6", "deporte", "Gimnasio", CLASS);
    const all = [ext, farAway, gym, nextDay, later, same, linkedAlready];
    // The like title before the one at the very same time; then by closeness.
    expect(candidatesFor(ext, all).map((e) => e.id)).toEqual(["r1", "r6", "r2", "r3"]);
    expect(suggestLink(ext, all)?.id).toBe("r1");
    expect(suggestLink(ext, [ext, later, nextDay])).toBeNull();
    expect(overlaps(ext, same)).toBe(true);
    expect(overlaps(ext, later)).toBe(false);
  });
});
