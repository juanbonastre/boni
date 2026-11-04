import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakePlanner } from "@boni/agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentHost } from "./agent.ts";
import { dueSlot, FlowScheduler, lastSlot } from "./flowScheduler.ts";

/** Flows on a schedule (docs/flujos.md F4): when each is due, and the scheduler running it once. */
const TZ = "Europe/Madrid";
const at = (iso: string) => Date.parse(iso);

describe("a schedule's times, in the server's zone", () => {
  it("every day at a time: today's once it came, yesterday's before", () => {
    // 2026-11-05 is a Thursday; Madrid is UTC+1 in November.
    expect(lastSlot({ every: "day", at: "08:00" }, at("2026-11-05T07:00:30Z"), TZ)).toBe(
      at("2026-11-05T07:00:00Z"),
    );
    expect(lastSlot({ every: "day", at: "08:00" }, at("2026-11-05T06:59:00Z"), TZ)).toBe(
      at("2026-11-04T07:00:00Z"),
    );
    // Without a time, at 08:00.
    expect(lastSlot({ every: "day" }, at("2026-11-05T12:00:00Z"), TZ)).toBe(
      at("2026-11-05T07:00:00Z"),
    );
  });

  it("every week on a day: the latest of those days whose time came", () => {
    // Monday 2026-11-02 at 08:00 Madrid.
    expect(lastSlot({ every: "week", day: 1, at: "08:00" }, at("2026-11-05T10:00:00Z"), TZ)).toBe(
      at("2026-11-02T07:00:00Z"),
    );
    // Thursday itself, before and after its time.
    expect(lastSlot({ every: "week", day: 4, at: "09:30" }, at("2026-11-05T08:00:00Z"), TZ)).toBe(
      at("2026-10-29T08:30:00Z"),
    );
    expect(lastSlot({ every: "week", day: 4, at: "09:30" }, at("2026-11-05T08:31:00Z"), TZ)).toBe(
      at("2026-11-05T08:30:00Z"),
    );
  });

  it("every hour at its minutes, across midnight", () => {
    expect(lastSlot({ every: "hour", at: "00:15" }, at("2026-11-05T09:20:00Z"), TZ)).toBe(
      at("2026-11-05T09:15:00Z"),
    );
    expect(lastSlot({ every: "hour", at: "00:15" }, at("2026-11-05T09:10:00Z"), TZ)).toBe(
      at("2026-11-05T08:15:00Z"),
    );
    // 00:10 in Madrid: the last one was 23:15 the day before.
    expect(lastSlot({ every: "hour", at: "00:15" }, at("2026-11-04T23:10:00Z"), TZ)).toBe(
      at("2026-11-04T22:15:00Z"),
    );
  });

  it("keeps the wall clock across a change of time", () => {
    // 2026-03-29: Madrid goes from UTC+1 to UTC+2; 08:00 is 06:00 UTC that day, 07:00 the day before.
    expect(lastSlot({ every: "day", at: "08:00" }, at("2026-03-29T06:30:00Z"), TZ)).toBe(
      at("2026-03-29T06:00:00Z"),
    );
    expect(lastSlot({ every: "day", at: "08:00" }, at("2026-03-29T05:30:00Z"), TZ)).toBe(
      at("2026-03-28T07:00:00Z"),
    );
  });

  it("is due once: not for a time before the version was saved, nor again after it ran, nor long after", () => {
    const s = { every: "day" as const, at: "08:00" };
    const slot = at("2026-11-05T07:00:00Z");
    const now = at("2026-11-05T07:00:40Z");
    expect(dueSlot(s, at("2026-11-04T10:00:00Z"), null, now, TZ)).toBe(slot);
    expect(dueSlot(s, at("2026-11-05T07:00:10Z"), null, now, TZ)).toBeNull();
    expect(dueSlot(s, at("2026-11-04T10:00:00Z"), at("2026-11-05T07:00:05Z"), now, TZ)).toBeNull();
    expect(dueSlot(s, at("2026-11-04T10:00:00Z"), at("2026-11-04T07:00:05Z"), now, TZ)).toBe(slot);
    // The server was down at 08:00 and is back at 09:30: it runs; back at 12:00, it waits for tomorrow.
    expect(dueSlot(s, 0, null, at("2026-11-05T08:30:00Z"), TZ)).toBe(slot);
    expect(dueSlot(s, 0, null, at("2026-11-05T11:00:00Z"), TZ)).toBeNull();
  });
});

describe("the scheduler", () => {
  let dir: string;
  let clock: number;
  let host: AgentHost;
  const notified: string[] = [];
  const lines: string[] = [];
  const lit = (v: unknown) => ({ lit: v });
  const summary = {
    version: 1,
    steps: [
      { id: "a", op: "call", tool: "notify", args: { text: { ref: "$today" } } },
      { id: "r", op: "reply", component: "text", data: { template: lit("Hecho") } },
    ],
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "boni-flow-scheduler-"));
    clock = at("2026-11-05T06:59:00Z");
    notified.length = 0;
    lines.length = 0;
    const planner = fakePlanner([]);
    host = new AgentHost({
      dataDir: dir,
      providers: { planner, reader: planner },
      tz: TZ,
      now: () => clock,
    });
    host.subscribe(1, (event, data) => {
      if (event === "notify") notified.push((data as { text: string }).text);
    });
  });
  afterEach(() => {
    host.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const scheduler = () =>
    new FlowScheduler({
      host,
      accounts: () => [1, 2],
      tz: TZ,
      now: () => clock,
      log: (l) => lines.push(l),
    });

  it("runs a flow that is on at its time, once, as background work given $today; and never one by hand", async () => {
    const store = host.store(1);
    const base = {
      inputs: [],
      layout: null,
      by: "user",
      enabled: true,
      created: at("2026-11-04T10:00:00Z"),
      plan: summary,
    };
    store.journal.saveFlow({
      ...base,
      id: "resumen",
      name: "Resumen diario",
      trigger: { schedule: { every: "day", at: "08:00" } },
    });
    store.journal.saveFlow({ ...base, id: "a-mano", name: "A mano", trigger: { manual: true } });
    store.journal.saveFlow({
      ...base,
      id: "apagado",
      name: "Apagado",
      enabled: false,
      trigger: { schedule: { every: "day", at: "08:00" } },
    });
    const s = scheduler();
    // 07:59 in Madrid: nothing yet.
    expect(s.tick()).toHaveLength(0);
    clock = at("2026-11-05T07:00:30Z");
    await Promise.all(s.tick());
    expect(notified).toEqual(["2026-11-05"]);
    expect(store.journal.flowRuns("resumen").runs).toBe(1);
    expect(store.journal.flowRuns("a-mano").runs).toBe(0);
    expect(store.journal.flowRuns("apagado").runs).toBe(0);
    const run = store.journal.runs(5)[0];
    expect(run).toMatchObject({ origin: "background", flow: "resumen", flowVersion: 1 });
    expect(lines).toEqual(["flows 1: «Resumen diario» v1 (2026-11-05 08:00): done"]);
    // A minute later it is not due again; the next day it is.
    clock = at("2026-11-05T07:01:30Z");
    expect(s.tick()).toHaveLength(0);
    clock = at("2026-11-06T07:00:20Z");
    await Promise.all(s.tick());
    expect(notified).toEqual(["2026-11-05", "2026-11-06"]);
    // Turned off, it waits.
    store.journal.setFlowEnabled("resumen", false);
    clock = at("2026-11-07T07:00:20Z");
    expect(s.tick()).toHaveLength(0);
    // Account 2 never used Boni: no store is opened for it.
    expect(host.hasStore(2)).toBe(false);
  });

  it("does not start a flow again while its run goes on", async () => {
    const store = host.store(1);
    store.journal.saveFlow({
      id: "resumen",
      name: "Resumen",
      trigger: { schedule: { every: "hour", at: "00:00" } },
      inputs: [],
      plan: summary,
      layout: null,
      by: "user",
      enabled: true,
      created: at("2026-11-04T10:00:00Z"),
    });
    clock = at("2026-11-05T07:00:30Z");
    const s = scheduler();
    const first = s.tick();
    expect(first).toHaveLength(1);
    expect(s.tick()).toHaveLength(0);
    await Promise.all(first);
    expect(store.journal.flowRuns("resumen").runs).toBe(1);
  });
});
