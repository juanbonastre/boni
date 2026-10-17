import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { systemTimeZone, todayIn } from "@boni-calendar/core";
import { definitionNote } from "@boni-calendar/web/src/vault/testing.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Vaults } from "./vaults.ts";

/** The server keeps open-ended series going (phase 5 follow-up), so devices in server mode need not. */
let dir: string;
let vaults: Vaults;
const iso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
const weekly = (day: string) =>
  `---\ntitle: "Revisión semanal"\ndate: "${day}"\nstartTime: "09:00"\nendTime: "09:30"\nseries: "s-prueba"\nseries_rule: "FREQ=WEEKLY"\ncompleted:\n---\nArea: [[docencia]]\n`;
const notes = () =>
  readdirSync(join(dir, "vault", "agenda/docencia")).filter((n) => n.includes("Revisión"));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "boni-server-series-"));
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, "vault", rel)), { recursive: true });
    writeFileSync(join(dir, "vault", rel), text);
  };
  write(
    "_system/colecciones/docencia.md",
    definitionNote("docencia", "Docencia", "agenda/docencia", "docencia"),
  );
  const today = todayIn(systemTimeZone());
  for (const d of [today - 14, today - 7])
    write(`agenda/docencia/${iso(d)} Revisión semanal.md`, weekly(iso(d)));
  vaults = new Vaults({ write: true });
});

afterAll(() => {
  vaults.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("series on the server", () => {
  it("get the notes they are missing, about a year ahead, once", async () => {
    const v = vaults.get(join(dir, "vault"));
    await v.snapshot();
    await expect.poll(() => notes().length, { timeout: 10_000 }).toBeGreaterThan(50);
    const n = notes().length;
    expect(await v.topUpSeries()).toBe(0); // nothing more to do
    expect(notes().length).toBe(n);
  });

  it("a read-only server never writes", async () => {
    const ro = new Vaults();
    expect(await ro.get(join(dir, "vault")).topUpSeries()).toBe(0);
    ro.close();
  });
});
