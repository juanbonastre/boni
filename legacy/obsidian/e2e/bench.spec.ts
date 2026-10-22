import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { launchObsidian } from "./obsidian.ts";

/**
 * The smoothness benchmark of `make bench-chrome` (wheel, Ctrl+wheel, Shift+wheel, month), run on the
 * calendar inside Obsidian, in a 1600x900 window with about as many notes as the real agenda.
 */
test("smoothness inside Obsidian", async () => {
  test.skip(!process.env.BONI_BENCH, "run with make bench-obsidian");
  const obs = await launchObsidian({ notes: 2800, width: 1600, height: 900 });
  try {
    const { page } = obs;
    await page.evaluate(() =>
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian's global app object
      (window as any).app.commands.executeCommandById("boni-calendar:open"),
    );
    await page.locator(".boni .ev").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() =>
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian's global app object
      (window as any).app.plugins.plugins["boni-calendar"].bench(),
    );
    mkdirSync("bench/results", { recursive: true });
    writeFileSync("bench/results/obsidian.json", JSON.stringify(result, null, 2));
    const r = result as {
      idleFrameMs: number;
      phases: { name: string; jank: number; frames: number }[];
    };
    console.log(`idle frame ${r.idleFrameMs} ms`);
    for (const p of r.phases) console.log(`${p.name}: ${p.jank}/${p.frames} janky`);
    expect(r.phases.length).toBeGreaterThan(0);
  } finally {
    await obs.close();
  }
});
