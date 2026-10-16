import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { launchObsidian, type Obsidian } from "./obsidian.ts";

/**
 * The plugin in the real Obsidian (see obsidian.ts: temporary profile, invented vault). The vault
 * has about as many agenda notes as the real one, so the opening times mean something.
 */
const NOTES = 2800;

test.describe.configure({ mode: "serial" });

let obs: Obsidian;
let page: Page;
const timings: Record<string, number> = {};

// biome-ignore lint/suspicious/noExplicitAny: Obsidian's global app object
const app = <T>(fn: (app: any) => T | Promise<T>) =>
  page.evaluate(`(${fn.toString()})(window.app)`) as Promise<T>;
const note = (rel: string) => readFileSync(join(obs.vault.dir, rel), "utf8");

async function openCalendar(): Promise<number> {
  const t0 = Date.now();
  await app((a) => a.commands.executeCommandById("boni-calendar:open"));
  await page.locator(".boni .ev").first().waitFor({ timeout: 30_000 });
  return Date.now() - t0;
}

test.beforeAll(async () => {
  obs = await launchObsidian({ notes: NOTES, width: 1600, height: 900 });
  page = obs.page;
  timings.obsidianStartupMs = obs.startupMs;
});

test.afterAll(async () => {
  mkdirSync("bench/results", { recursive: true });
  writeFileSync(
    "bench/results/obsidian-open.json",
    JSON.stringify({ notes: NOTES, ...timings }, null, 2),
  );
  console.log("timings", timings);
  await obs?.close();
});

test("loading the plugin reads nothing until the calendar opens", async () => {
  const state = await app((a) => ({
    enabled: [...a.plugins.enabledPlugins],
    bridge: a.plugins.plugins["boni-calendar"]?.bridge ?? null,
    tabs: a.workspace.getLeavesOfType("boni-calendar").length,
  }));
  expect(state.enabled).toContain("boni-calendar");
  expect(state.bridge).toBeNull();
  expect(state.tabs).toBe(0);
  const dbs = await page.evaluate(() => indexedDB.databases());
  expect(dbs.map((d) => d.name)).not.toContain("boni-calendar");

  // Loading the plugin itself is cheap (it only registers the tab, an icon and a command).
  const loadMs = await app(async (a) => {
    await a.plugins.disablePlugin("boni-calendar");
    const t0 = performance.now();
    await a.plugins.enablePlugin("boni-calendar");
    return performance.now() - t0;
  });
  timings.pluginLoadMs = Math.round(loadMs);
  expect(loadMs).toBeLessThan(200);
});

test("the calendar opens from the command, the first time and with the index", async () => {
  timings.openColdMs = await openCalendar();
  expect(await page.locator(".boni .ev", { hasText: "Clase de hoy" }).count()).toBe(1);
  // The command brings the open tab forward instead of opening another one.
  await app((a) => a.commands.executeCommandById("boni-calendar:open"));
  expect(await app((a) => a.workspace.getLeavesOfType("boni-calendar").length)).toBe(1);

  // Close it and open it again: the index (kept in IndexedDB) spares reading the notes again.
  await page.waitForTimeout(1500);
  await app((a) => a.workspace.detachLeavesOfType("boni-calendar"));
  timings.openWarmMs = await openCalendar();
  expect(timings.openColdMs).toBeLessThan(10_000);
  expect(timings.openWarmMs).toBeLessThan(5_000);
});

test("its shortcuts work only while the calendar has the focus", async () => {
  const view = () =>
    page
      .locator(".boni .month")
      .count()
      .then((n) => (n > 0 ? "month" : "grid"));
  // Typing in a note never reaches the calendar.
  await app((a) =>
    a.workspace.getLeaf("split").openFile(a.vault.getAbstractFileByPath("Nota suelta.md")),
  );
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("m");
  await page.waitForTimeout(800);
  expect(await view()).toBe("grid");
  expect(note("Nota suelta.md")).toContain("m");

  // Clicked, the calendar takes them: views, and Ctrl+, opens its settings, not Obsidian's.
  await page.locator(".boni .title").click();
  await page.keyboard.press("m");
  expect(await view()).toBe("month");
  await page.keyboard.press("w");
  expect(await view()).toBe("grid");
  await page.keyboard.press("Control+,");
  await expect(page.locator(".boni .scrim")).toBeVisible();
  expect(await page.locator(".modal-container").count()).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".boni .scrim")).toHaveCount(0);
  await app((a) => a.workspace.detachLeavesOfType("markdown"));
});

test("edits change the notes with the calendar's rules", async () => {
  const lesson = obs.vault.lesson;
  const before = note(lesson);
  const ev = page.locator(".boni .ev", { hasText: "Clase de hoy" });
  const box = await ev.boundingBox();
  if (!box) throw new Error("no event");
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 70, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => note(lesson)).not.toBe(before);
  const was = new Set(before.split("\n"));
  const now = new Set(note(lesson).split("\n"));
  const changed = [...[...now].filter((l) => !was.has(l)), ...[...was].filter((l) => !now.has(l))];
  // Only the times changed (and the time zone, which the calendar writes when it moves an event).
  expect(changed.length).toBeGreaterThan(0);
  expect(changed.filter((l) => !/^(startTime|endTime|timezone):/.test(l))).toEqual([]);
  expect(note(lesson)).toContain('title: "Clase de hoy"');
  expect(note(lesson)).toContain("Area: [[docencia]]");

  // Delete goes to the vault's trash (as Obsidian is set up), and Undo brings the note back.
  await ev.click();
  await page.keyboard.press("Escape");
  await ev.click();
  await page.keyboard.press("Delete");
  await expect.poll(() => existsSync(join(obs.vault.dir, lesson))).toBe(false);
  expect(existsSync(join(obs.vault.dir, ".trash"))).toBe(true);
  await page.keyboard.press("Control+z");
  await expect.poll(() => existsSync(join(obs.vault.dir, lesson))).toBe(true);
  expect(note(lesson)).toContain('title: "Clase de hoy"');

  // Ctrl+click (like a link) and "Open note" in the context menu open it in a tab.
  await page.locator(".boni .ev", { hasText: "Clase de hoy" }).click({ modifiers: ["Control"] });
  await expect.poll(() => app((a) => a.workspace.getActiveFile()?.path)).toBe(lesson);
  await app((a) => a.workspace.detachLeavesOfType("markdown"));
  await app((a) => a.commands.executeCommandById("boni-calendar:open"));
  await page.locator(".boni .ev", { hasText: "Clase de hoy" }).click({ button: "right" });
  await page
    .locator(".boni .ctx")
    .getByText(/Abrir nota/)
    .click();
  await expect.poll(() => app((a) => a.workspace.getActiveFile()?.path)).toBe(lesson);

  // A change made in Obsidian shows up in the calendar.
  await app((a) =>
    a.vault.process(a.vault.getAbstractFileByPath(a.workspace.getActiveFile().path), (d: string) =>
      d.replace('title: "Clase de hoy"', 'title: "Clase cambiada en Obsidian"'),
    ),
  );
  await app((a) => a.commands.executeCommandById("boni-calendar:open"));
  await expect(page.locator(".boni .ev", { hasText: "Clase cambiada en Obsidian" })).toHaveCount(1);
  await page.screenshot({ path: "e2e/screenshots/obsidian.png" });
});

test("Obsidian's styles and the calendar's stay apart", async () => {
  const pill = page.locator(".boni .view-picker .pill");
  await pill.click();
  const menu = page.locator(".boni .view-menu");
  await expect(menu).toBeVisible();
  // Obsidian styles its own `.menu`; ours keeps the calendar's look.
  const ours = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
  const surface = await page
    .locator(".boni .app")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--surface").trim());
  expect(surface).toBe("#1d1e22");
  expect(ours).toBe("rgb(29, 30, 34)");
  await page.keyboard.press("Escape");
  // And the calendar never touches Obsidian's page.
  const html = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? null,
    modSelect: document.body.classList.contains("mod-select"),
  }));
  expect(html).toEqual({ theme: null, modSelect: false });
});
