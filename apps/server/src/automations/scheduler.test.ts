// «Programada» and what a run that started alone tells the user (docs/automatizaciones.md §5.9, §5.8, §6: AU-114,
// AU-195, AU-102, and the notice of AU-167; phase F14d): the hours of a published automation, run once each by a tick
// a minute, and one notice per run that wrote and per streak of failures. The rule's id is kept in each test's name
// (`make check` reads them, T-10). A real store per test with collections shaped like the user's; the clock is the
// test's, never the machine's, and a bound of time is read from `@boni/pace` (T-11). The notices are S4's.
import { clock, under } from "@boni/pace";
import type { UserStore } from "@boni/store";
import { afterAll, describe, expect, it } from "vitest";
import { lastSlot } from "../flowScheduler.ts";
import { setEnabled } from "./publish.ts";
import {
  answering,
  boxOf,
  CODE,
  CREATE,
  folder,
  HOUR,
  held,
  JUAN,
  MINUTE,
  made,
  NOW,
  notes,
  ok,
  ran,
  SCHEDULE,
  START,
  scheduler,
  ZONE,
} from "./run.test-util.ts";
import {
  interruptRuns,
  retryRun,
  runRows,
  runsOf,
  runView,
  settled,
  startScheduledRun,
} from "./runs.ts";
import { testAutomation } from "./service.ts";

const files = folder("programada");
afterAll(files.done);

/** NOW is 09:00 UTC, 10:00 in Madrid: `at(h, m)` is that hour and minute of the same day, in UTC. */
const at = (h: number, m = 0, day = 17) => Date.UTC(2026, 10, day, h, m);
const runs = (s: UserStore, id: string) => ok(runsOf(s, id, {})).runs;
const slots = (s: UserStore, id: string) =>
  runs(s, id)
    .map((r) => r.slot)
    .reverse();

describe("«Programada» (F14d)", () => {
  it("AU-114 · a «Programada» has one rule or more («every hour», «every day at», «every week on a day at») and none does not validate; its hours are those of the account's zone", async () => {
    const s = files.store();
    expect(made(s, [SCHEDULE([]), CREATE("sola")]).publish()).toMatchObject({ refused: "blocked" });
    expect(
      made(s, [SCHEDULE([{ key: "r_mal", every: "day", at: "25:00" }]), CREATE("sola")]).publish(),
    ).toMatchObject({ refused: "blocked" });
    expect(
      made(s, [
        SCHEDULE([{ key: "r_mal", every: "month", at: "08:00" }]),
        CREATE("sola"),
      ]).publish(),
    ).toMatchObject({ refused: "blocked" });
    // Each kind of rule publishes; «every day at 08:00» is 08:00 in Madrid, 07:00 UTC in November.
    const daily = made(s, [
      SCHEDULE([{ key: "r_dia", every: "day", at: "08:00" }]),
      CREATE("diaria"),
    ]);
    ok(daily.publish());
    const weekly = made(s, [
      SCHEDULE([{ key: "r_semana", every: "week", at: "09:30", day: "wednesday" }]),
      CREATE("semanal"),
    ]);
    ok(weekly.publish());
    const t = scheduler(s);
    await t.at(at(7, 5, 18));
    expect(slots(s, daily.id)).toEqual([at(7, 0, 18)]);
    expect(slots(s, weekly.id)).toEqual([]);
    // Wednesday 18th at 09:30 in Madrid.
    await t.at(at(8, 35, 18));
    expect(slots(s, weekly.id)).toEqual([at(8, 30, 18)]);
    expect(notes(s)).toEqual(expect.arrayContaining(["diaria", "semanal"]));
    // In another zone the same rule is another instant.
    const other = files.store();
    const ny = made(other, [SCHEDULE([{ key: "r_dia", every: "day", at: "08:00" }]), CREATE("NY")]);
    ok(ny.publish());
    await scheduler(other, "America/New_York").at(at(13, 5, 18));
    expect(slots(other, ny.id)).toEqual([at(13, 0, 18)]);
  });

  it("AU-114 · it runs at its hour and once: two ticks, or a restart, never start the same hour twice, and two rules due at the same minute start one run", async () => {
    const s = files.store();
    // «every hour» at :00 and «every day at 11:00», which is 10:00 UTC: both fall at 10:00 UTC.
    const a = made(s, [
      SCHEDULE([
        { key: "r_hora", every: "hour", at: "08:00" },
        { key: "r_dia", every: "day", at: "11:00" },
      ]),
      CREATE("a su hora"),
    ]);
    ok(a.publish());
    const t = scheduler(s);
    await t.at(at(10, 5));
    await t.at(at(10, 5));
    await t.at(at(10, 6));
    // A restart: another scheduler over the same store.
    await scheduler(s).at(at(10, 7));
    expect(slots(s, a.id)).toEqual([at(10)]);
    expect(notes(s).filter((n) => n === "a su hora")).toHaveLength(1);
    await t.at(at(11, 1));
    expect(slots(s, a.id)).toEqual([at(10), at(11)]);
  });

  it("AU-114 · the trigger gives one row with the hour that was due, not the hour it ran at", async () => {
    const s = files.store();
    const a = made(s, [SCHEDULE(), CREATE("a su hora")]);
    ok(a.publish());
    await scheduler(s).at(at(10, 20));
    const [r] = runs(s, a.id);
    expect(r).toMatchObject({ state: "done", startedBy: "schedule", device: null, slot: at(10) });
    const view = ok(runView(s, a.id, r?.id as string));
    expect(view.fields).toEqual({ date: at(10) });
    const rows = ok(
      runRows(s, a.id, r?.id as string, {
        step: a.step("A su hora"),
        side: "out",
        name: "main",
        offset: 0,
      }),
    );
    expect(rows.total).toBe(1);
    expect(rows.rows[0]?.json).toEqual({ date: at(10) });
    // The hour is the code's, not a hand's.
    expect(rows.rows[0]?.label).toMatchObject({ integrity: "own" });
  });

  it("AU-195 · `$run.startedBy` is `schedule` in a run that started at its hour, in the test of a «Programada» and in a «Reintentar» of one that started at its hour, and `user` in «Ejecutar», in the test of one started by hand and in a retry of one: a closed list, never a name or an id", async () => {
    const s = files.store();
    const { box, jobs } = boxOf(() => answering());
    const alone = made(s, [SCHEDULE(), CODE()]);
    ok(alone.publish());
    const hand = made(s, [START, CODE()]);
    ok(hand.publish());
    const said = () => jobs.at(-1)?.run.startedBy;

    await scheduler(s, ZONE, box).at(at(10, 5));
    const scheduled = runs(s, alone.id)[0];
    expect(scheduled?.startedBy).toBe("schedule");
    await ok(await retryRun(s, alone.id, scheduled?.id as string, {}, JUAN, box));
    await settled(s);
    expect(said()).toBe("schedule");
    ok(
      await testAutomation(
        s,
        alone.id,
        { trigger: alone.step("A su hora"), fields: {} },
        JUAN,
        box,
      ),
    );
    expect(said()).toBe("schedule");

    const byHand = await ran(s, hand.id, hand.step("Inicio"), { nota: "x" }, { box });
    expect(said()).toBe("user");
    expect(byHand.startedBy).toBe("user");
    await ok(await retryRun(s, hand.id, byHand.id, {}, JUAN, box));
    await settled(s);
    expect(said()).toBe("user");
    ok(await testAutomation(s, hand.id, { trigger: hand.step("Inicio"), fields: {} }, JUAN, box));
    expect(said()).toBe("user");
    // A closed list: nothing else ever reaches the box.
    expect(new Set(jobs.map((j) => j.run.startedBy))).toEqual(new Set(["schedule", "user"]));
    expect(jobs.every((j) => Object.keys(j.run).sort().join() === "startedBy,test")).toBe(true);
  });

  it("AU-195 · a «Si» over `$run.startedBy` sends a run started by hand down one branch and one that started alone down the other, and each branch's write gets the decision of its own cell", async () => {
    const s = files.store();
    const { box } = boxOf((job) => answering([{ quien: job.run.startedBy }]));
    const a = made(
      s,
      [
        SCHEDULE(),
        START,
        CODE("ask", "Quién"),
        ["Si", "if", { where: [{ field: "quien", op: "is", value: "schedule" }] }],
        CREATE("sola", "yes", "Sola"),
        CREATE("a mano", "ask", "A mano"),
      ],
      {
        arrows: [
          ["A su hora", "Quién"],
          ["Inicio", "Quién"],
          ["Quién", "Si"],
          ["Si", "Sola", "yes"],
          ["Si", "A mano", "no"],
        ],
      },
    );
    ok(a.publish());
    // The scheduler's run, with the test's box: started as the scheduler starts it.
    ok(await startScheduledRun(s, a.id, a.step("A su hora"), at(10), ZONE, { box }));
    await settled(s);
    const alone = runs(s, a.id)[0];
    expect(alone?.state, JSON.stringify(alone?.error)).toBe("done");
    expect(notes(s)).toContain("sola");
    // «Sí» on its branch's cell: saved, nothing proposed.
    expect(alone?.proposal).toBeNull();
    expect(s.runOps(alone?.id as string)).toHaveLength(1);

    const byHand = await ran(s, a.id, a.step("Inicio"), { nota: "x" }, { box });
    expect(byHand.state).toBe("done");
    // «Preguntar» on the other branch's cell: nothing saved, one proposal.
    expect(notes(s)).not.toContain("a mano");
    expect(s.runOps(byHand.id)).toHaveLength(0);
    expect(byHand.proposal).not.toBeNull();
    expect(byHand.line?.asked).toEqual([
      expect.objectContaining({ collection: "pedido", action: "create", n: 1 }),
    ]);
  });

  it("AU-114 · a server off for three hours with «every hour» runs once on coming back, for the last hour only, and only within the margin (30 minutes hourly, 3 hours the others)", async () => {
    const s = files.store();
    const hourly = made(s, [SCHEDULE(), CREATE("cada hora")]);
    ok(hourly.publish());
    const t = scheduler(s);
    await t.at(at(9, 10));
    expect(slots(s, hourly.id)).toEqual([]);
    // Off from 09:10 to 12:10 UTC: only 12:00 runs.
    await t.at(at(12, 10));
    await t.at(at(12, 20));
    expect(slots(s, hourly.id)).toEqual([at(12)]);
    expect(runs(s, hourly.id).map((r) => r.state)).toEqual(["done"]);

    // «every day at 08:00» (07:00 UTC): 2 h 59 late still runs, 3 h 01 late does not.
    const late = files.store();
    const d1 = made(late, [SCHEDULE([{ key: "r_dia", every: "day", at: "08:00" }]), CREATE("d")]);
    ok(d1.publish());
    await scheduler(late).at(at(9, 59, 18));
    expect(runs(late, d1.id).map((r) => r.state)).toEqual(["done"]);
    const later = files.store();
    const d2 = made(later, [SCHEDULE([{ key: "r_dia", every: "day", at: "08:00" }]), CREATE("d")]);
    ok(d2.publish());
    await scheduler(later).at(at(10, 1, 18));
    expect(runs(later, d2.id).map((r) => r.state)).toEqual(["missed"]);
    expect(notes(later)).not.toContain("d");
  });

  it("AU-114 · an hour missed past its margin does not run: it is kept as a line of «Ejecuciones» saying the server was off at its hour", async () => {
    const s = files.store();
    const a = made(s, [SCHEDULE(), CREATE("cada hora")]);
    ok(a.publish());
    const t = scheduler(s);
    await t.at(at(10, 40));
    const [missed] = runs(s, a.id);
    expect(missed).toMatchObject({
      state: "missed",
      slot: at(10),
      startedBy: "schedule",
      device: null,
      step: null,
      error: null,
      ms: 0,
    });
    expect(notes(s)).not.toContain("cada hora");
    // It counts with what failed, is not tried again, and the next hour runs.
    expect(ok(runsOf(s, a.id, { filter: "failed" })).runs.map((r) => r.id)).toEqual([missed?.id]);
    await t.at(at(10, 50));
    expect(runs(s, a.id)).toHaveLength(1);
    await t.at(at(11, 5));
    expect(runs(s, a.id).map((r) => [r.state, r.slot])).toEqual([
      ["done", at(11)],
      ["missed", at(10)],
    ]);
    // Nothing to undo in it.
    expect(ok(runView(s, a.id, missed?.id as string)).undoable).toBe(false);
  });

  it("AU-114 · no hour runs that is earlier than the publishing of the version that runs or than the switch being turned on", async () => {
    const s = files.store();
    const a = made(s, [SCHEDULE(), CREATE("cada hora")], { at: at(9, 20) });
    ok(a.publish());
    const t = scheduler(s);
    await t.at(at(9, 25));
    expect(slots(s, a.id)).toEqual([]);
    ok(setEnabled(s, a.id, false, { ...JUAN, now: at(9, 30) }));
    await t.at(at(10, 5));
    expect(slots(s, a.id)).toEqual([]);
    // On again at 10:10: 10:00 was before, so it waits for 11:00.
    ok(setEnabled(s, a.id, true, { ...JUAN, now: at(10, 10) }));
    await t.at(at(10, 15));
    expect(slots(s, a.id)).toEqual([]);
    await t.at(at(11, 2));
    expect(slots(s, a.id)).toEqual([at(11)]);
    // Turning it on when it was on changes nothing; a new version counts its hours from its own publishing.
    ok(setEnabled(s, a.id, true, { ...JUAN, now: at(11, 30) }));
    a.edit([SCHEDULE(), CREATE("nueva")]);
    ok(a.publish(at(12, 10)));
    await t.at(at(12, 15));
    expect(slots(s, a.id)).toEqual([at(11)]);
    await t.at(at(13, 3));
    expect(slots(s, a.id)).toEqual([at(11), at(13)]);
    expect(notes(s)).toContain("nueva");
  });

  it("AU-114 · across the change of hour, an hour the clock skips or repeats runs once", async () => {
    // 2026-10-25 in Madrid: 03:00 CEST goes back to 02:00 CET (01:00 UTC); every ten minutes through the night.
    const s = files.store();
    const start = Date.UTC(2026, 9, 24, 20, 0);
    const a = made(s, [SCHEDULE(), CREATE("cada hora")], { at: start });
    ok(a.publish());
    const t = scheduler(s);
    const seen = new Set<number>();
    for (let now = start + 10 * MINUTE; now <= Date.UTC(2026, 9, 25, 5, 0); now += 10 * MINUTE) {
      await t.at(now);
      const slot = lastSlot({ every: "hour", at: "08:00" }, now, ZONE);
      if (slot > start) seen.add(slot);
    }
    const ran = slots(s, a.id);
    expect(new Set(ran).size).toBe(ran.length);
    expect(ran).toEqual([...seen].sort((x, y) => x - y));
    expect(runs(s, a.id).every((r) => r.state === "done")).toBe(true);
    // Each hour of the clock on the wall, the repeated 02:00 included, runs once.
    const wall = ran.map((x) =>
      new Intl.DateTimeFormat("es", { timeZone: ZONE, hour: "2-digit", hour12: false }).format(
        x as number,
      ),
    );
    expect(new Set(wall).size).toBe(wall.length);

    // 2027-03-28: 02:00 CET jumps to 03:00 CEST, so 02:30 does not exist that day; «every day at 02:30» runs once.
    const spring = files.store();
    const from = Date.UTC(2027, 2, 27, 12, 0);
    const b = made(spring, [SCHEDULE([{ key: "r_dia", every: "day", at: "02:30" }]), CREATE("d")], {
      at: from,
    });
    ok(b.publish());
    const u = scheduler(spring);
    for (let now = from + 10 * MINUTE; now <= Date.UTC(2027, 2, 28, 12, 0); now += 10 * MINUTE)
      await u.at(now);
    expect(runs(spring, b.id).map((r) => r.state)).toEqual(["done"]);
  });

  it("AU-114 · while the previous run still runs at the next hour, the scheduler waits for the next tick and starts no second run", async () => {
    const s = files.store();
    const a = made(s, [SCHEDULE(), CODE()]);
    ok(a.publish());
    const gate = held();
    // The 10:00 run is caught in its «Código».
    ok(await startScheduledRun(s, a.id, a.step("A su hora"), at(10), ZONE, { box: gate.box }));
    await gate.arrived;
    const t = scheduler(s);
    // At 11:05 it is still running: the tick starts nothing, and 11:00 is not lost.
    t.now(at(11, 5));
    expect(t.sched.tick()).toHaveLength(0);
    expect(runs(s, a.id).map((r) => r.state)).toEqual(["running"]);
    gate.open();
    await settled(s);
    await t.at(at(11, 10));
    expect(slots(s, a.id)).toEqual([at(10), at(11)]);
  });

  it("AU-190 · the hour of an interrupted scheduled run counts as run: the scheduler does not start it again on the next tick", async () => {
    const s = files.store();
    const a = made(s, [SCHEDULE(), CODE()]);
    ok(a.publish());
    const gate = held();
    ok(await startScheduledRun(s, a.id, a.step("A su hora"), at(10), ZONE, { box: gate.box }));
    await gate.arrived;
    // The server stops in the middle: opening again closes it as interrupted.
    expect(interruptRuns(s, at(10, 2))).toHaveLength(1);
    expect(runs(s, a.id).map((r) => [r.state, r.slot])).toEqual([["interrupted", at(10)]]);
    // The next ticks start nothing for that hour (the caught run of this process is let go only after).
    const t = scheduler(s);
    for (const when of [at(10, 5), at(10, 20)]) {
      t.now(when);
      expect(t.sched.tick()).toHaveLength(0);
    }
    expect(runs(s, a.id)).toHaveLength(1);
    gate.open();
    await settled(s);
  });

  it("AU-114 · a tick over 200 scheduled automations reads their hours from a column, no document, and stays within the time written here", async () => {
    const s = files.store();
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      const a = made(s, [SCHEDULE(), CREATE(`n${i}`)], { at: NOW - 400 * 24 * HOUR });
      ok(a.publish());
      ids.push(a.id);
    }
    // A year of hourly runs of one of them and a week of the others, up to 09:00: what his store holds after a year.
    s.batch(() => {
      for (const [k, id] of ids.entries()) {
        const n = k === 0 ? 365 * 24 : 7 * 24;
        for (let h = n - 1; h >= 0; h--) {
          const slot = at(9) - h * HOUR;
          s.journal.createAutomationRun({
            id: `r_${k}_${h}`,
            automation: id,
            version: 1,
            test: false,
            state: "running",
            trigger: "s",
            fields: JSON.stringify({ date: slot }),
            startedBy: "schedule",
            device: null,
            retryOf: null,
            at: slot,
            started: slot,
            doc: null,
            slot,
          });
          s.journal.endAutomationRun(`r_${k}_${h}`, {
            state: "done",
            ended: slot + 1000,
            ms: 1000,
            step: null,
            error: null,
            line: null,
          });
        }
      }
    });
    const t = scheduler(s);
    expect(s.journal.scheduledAutomations().every((x) => x.last === at(9))).toBe(true);
    // Nothing due: the tick reads the column and the runs' index, and starts nothing.
    t.now(at(9, 30));
    let start = clock();
    expect(t.sched.tick()).toHaveLength(0);
    under(clock() - start, 50, "cpu", "a tick with nothing due over 200 automations");
    // The list of the one with a year of runs: a page, by the index.
    start = clock();
    expect(ok(runsOf(s, ids[0] as string, {})).runs).toHaveLength(50);
    under(clock() - start, 30, "cpu", "a page of «Ejecuciones» over a year of runs");
    // All 200 due at 10:00: the tick only puts them in the lane; each runs once.
    t.now(at(10, 5));
    start = clock();
    const begun = t.sched.tick();
    // Each start reads and checks its published version before it queues (runPublished): ~1.3 s for 200 here, once,
    // the rare minute when all of them are due; the minutes in between are the tick above.
    under(clock() - start, 3000, "cpu", "a tick that starts 200 runs");
    expect(begun).toHaveLength(200);
    await Promise.all(begun);
    await settled(s);
    expect(ids.every((id) => runs(s, id)[0]?.slot === at(10))).toBe(true);
    expect(t.sched.tick()).toHaveLength(0);
  }, 120_000);
});

describe("a failure that started alone (F14d)", () => {
  it.todo(
    "AU-102 · a run that started alone and failed notifies once, with the automation's name, the step's and the reason in the app's words, and the notice opens that run; one started by hand notifies nothing",
  );
  it.todo(
    "AU-102 · three failures in a row give one notice; after a run that ends well, or a new published version, the next failure notifies again",
  );
  it.todo(
    "AU-102 · the notice is written by code from closed lists: a code that throws a text with HTML or a link, or a row's value, leaves nothing of it in the notice",
  );
  it.todo(
    "AU-102 · an interrupted run and an hour that did not run count as failures of the streak: the one that opens it notifies, and the next ones do not",
  );
});

describe("the notice of what it wrote alone (F14d)", () => {
  it.todo(
    "AU-167 · a run that started alone and wrote gives one notice for the whole run, with counts and collection names and no value of any row, and its «Deshacer» undoes the run; a run that wrote nothing gives none",
  );
});
