import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { openApp, recorded } from "./fixtures.ts";

/**
 * The page editor as a document (Juan, 2026-10-30, phase 1 of «Boni: el editor de páginas»; task 2g, its engine):
 * text selected from one block to another as in Google Docs (a drag, Shift+click) and what the keys do to it; whole
 * blocks selected as Notion's (Esc, Shift+arrows past the text, Ctrl+A twice) and what the keys do to them; several
 * lines pasted as blocks; the arrows going from block to block as in a document; a long page opened and typed in.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const lines = (page: Page) => page.locator(".doc-blocks .blk-input");
const selected = (page: Page) => page.locator(".blk.selected");
const values = (page: Page) =>
  lines(page).evaluateAll((els) => els.map((e) => e.textContent ?? ""));
/** The text of the block with the caret. */
const caretIn = (page: Page) => page.locator(".blk.caret .blk-input");

/** A new page with its title and these lines, one block each, the caret at the end of the last one. */
async function pageWith(page: Page, texts: string[]) {
  await openApp(page, "/?still", { pages: [] });
  await page.locator(".welcome").getByRole("button", { name: "Nueva página" }).click();
  await page.keyboard.type("Apuntes", { delay: 10 });
  for (const t of texts) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(t, { delay: 10 });
  }
  await expect(lines(page)).toHaveCount(texts.length);
}

/** What a paste of this text in the focused place does (the app reads the event's own data). */
const paste = (page: Page, text: string) =>
  page.evaluate((t) => {
    const data = new DataTransfer();
    data.setData("text/plain", t);
    (document.activeElement ?? document.body).dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);

test("whole blocks selected as Notion's: Esc and Shift+arrows; duplicated, moved, deleted, Ctrl+Z", async ({
  page,
}) => {
  await pageWith(page, ["Uno", "Dos", "Tres"]);
  // Esc leaves the text with its block selected; Shift+↑ takes the one above too.
  await page.keyboard.press("Escape");
  await expect(selected(page)).toHaveCount(1);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(selected(page)).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/editor-selection.png` });
  // Ctrl+D: their copies right after them, selected.
  await page.keyboard.press("Control+d");
  await expect.poll(() => values(page)).toEqual(["Uno", "Dos", "Tres", "Dos", "Tres"]);
  await expect(selected(page)).toHaveCount(2);
  // Ctrl+Shift+↑ moves them up past «Tres»; Delete takes them away; Ctrl+Z brings them back.
  await page.keyboard.press("Control+Shift+ArrowUp");
  await expect.poll(() => values(page)).toEqual(["Uno", "Dos", "Dos", "Tres", "Tres"]);
  await page.keyboard.press("Delete");
  await expect.poll(() => values(page)).toEqual(["Uno", "Dos", "Tres"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => values(page)).toEqual(["Uno", "Dos", "Dos", "Tres", "Tres"]);
  // Tab nests the selected ones; Esc lets go; typing over a selection puts the letter in its place.
  await lines(page).nth(4).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(page.locator(".blk.selected")).toHaveAttribute("style", /margin-left/);
  await page.keyboard.type("Z");
  await expect.poll(() => values(page)).toEqual(["Uno", "Dos", "Dos", "Tres", "Z"]);
});

test("text selected from one block to another (a drag, Shift+click), copied, pasted and typed over; Ctrl+A twice takes every block", async ({
  page,
}) => {
  await pageWith(page, ["Uno", "Dos", "Tres", ""]);
  const box = async (i: number) =>
    (await lines(page).nth(i).boundingBox()) as NonNullable<
      Awaited<ReturnType<ReturnType<typeof lines>["boundingBox"]>>
    >;
  // Pressed before «Uno», released after «Tres»: their text selected, as in a document, no block selected whole.
  const a = await box(0);
  const c = await box(2);
  await page.mouse.move(a.x + 1, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width - 2, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(selected(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().replace(/\n+/g, "|")))
    .toBe("Uno|Dos|Tres");
  // Ctrl+C copies them as Markdown; pasted into the empty last line they come back as blocks.
  await page.keyboard.press("Control+c");
  await lines(page).nth(3).click();
  await page.keyboard.press("Control+v");
  await expect.poll(() => values(page)).toEqual(["Uno", "Dos", "Tres", "Uno", "Dos", "Tres"]);
  // From «D|os», Shift+click after «Tres», and a letter typed: the text between goes, the two blocks become one.
  await lines(page).nth(1).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  const t = await box(2);
  await lines(page)
    .nth(2)
    .click({ modifiers: ["Shift"], position: { x: t.width - 2, y: t.height / 2 } });
  await expect(selected(page)).toHaveCount(0);
  await page.keyboard.type("X");
  await expect.poll(() => values(page)).toEqual(["Uno", "DX", "Uno", "Dos", "Tres"]);
  // Ctrl+A in a line selects its text, a second time every block.
  await lines(page).nth(0).click();
  await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(5);
});

test("several lines pasted become blocks (Markdown read); the arrows go from block to block as in a document", async ({
  page,
}) => {
  await pageWith(page, ["Antes y después"]);
  // The caret after «Antes»: what is pasted goes between, the rest of the line after it.
  await lines(page).nth(0).click();
  await page.keyboard.press("Home");
  for (let i = 0; i < "Antes".length; i++) await page.keyboard.press("ArrowRight");
  await paste(page, " de\n## Un título\n- una cosa\n- otra");
  await expect
    .poll(() => values(page))
    .toEqual(["Antes de", "Un título", "una cosa", "otra y después"]);
  await expect(page.locator(".blk-h2")).toHaveCount(1);
  await expect(page.locator(".blk-bullet")).toHaveCount(2);
  // ↑ from the first line of a block goes to the block above; → at its end to the next one.
  await lines(page).nth(2).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await expect(caretIn(page)).toHaveText("Un título");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(caretIn(page)).toHaveText("una cosa");
  await page.keyboard.press("ArrowLeft");
  await expect(caretIn(page)).toHaveText("Un título");
  // Delete at a block's end brings the next one up into it.
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  await expect
    .poll(() => values(page))
    .toEqual(["Antes de", "Un títulouna cosa", "otra y después"]);
});

/** «Rayuela» opened from its collection's table: when it was clicked. */
async function openRayuela(page: Page, body?: string): Promise<number> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", body === undefined ? {} : { rayuelaBody: body });
  await page
    .locator(".sidebar")
    .getByRole("list", { name: "Páginas" })
    .getByRole("button", { name: "Libros", exact: true })
    .click();
  const row = page.locator(".db-table").getByRole("button", { name: "Rayuela", exact: true });
  await expect(row).toBeVisible();
  const clicked = Date.now();
  await row.click();
  return clicked;
}

test("a note opened, its text clicked, walked with the arrows and selected, then left, is not written (D-66); one letter writes it once, and leaving it sends it then", async ({
  page,
}) => {
  // As an Obsidian vault leaves them: what the editor would write otherwise (spaces, «*», a loose list).
  const body =
    "#  Notas   \n\n* uno\n*  dos\n\nTexto con  dos espacios\ny un salto.\n\n\n| a | b |\n|---|---|\n";
  await openRayuela(page, body);
  const text = page.locator(".row-doc .blk-input");
  await expect(text.first()).toHaveText("Notas");
  await text.nth(1).click();
  for (const key of [
    "ArrowDown",
    "ArrowDown",
    "End",
    "Shift+ArrowUp",
    "ArrowRight",
    "Home",
    "Escape",
    "Escape",
  ])
    await page.keyboard.press(key);
  await page.locator(".row-doc .doc-title").click();
  await page.waitForTimeout(900);
  const writes = async () =>
    (await recorded(page)).requests.filter((r) => r.startsWith("PUT api/data/rows/r1"));
  expect(await writes()).toEqual([]);
  // A letter typed: the note is written once, with its other lines as they were.
  await text.nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.type("s");
  await expect.poll(async () => (await writes()).length, { timeout: 3000 }).toBe(1);
  const sent = await page.evaluate(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
      b.startsWith("PUT api/data/rows/r1"),
    ),
  );
  expect(sent.at(-1)).toContain(JSON.stringify(body.replace("* uno", "* unos")).slice(1, -1));
  // Left for the title, the text is saved then, not when the timer would have sent it.
  await page.keyboard.type("x");
  await page.locator(".row-doc .doc-title").click();
  await expect.poll(async () => (await writes()).length, { timeout: 400 }).toBe(2);
});

/**
 * Twenty letters typed at the end of this line, each shown before the next one is pressed. What is timed is what Juan
 * would feel: from each key to the frame that shows it, as the browser measures it (Event Timing): the usual one (the
 * median) and the worst. Under 16 ms the browser does not report it: those count as 16.
 */
async function typeTimed(page: Page, at: ReturnType<Page["locator"]>) {
  await at.scrollIntoViewIfNeeded();
  await at.click();
  await page.keyboard.press("End");
  await page.evaluate(() => {
    const w = window as unknown as { __keys: number[] };
    w.__keys = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === "keydown") w.__keys.push(e.duration);
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });
  const word = "ahora escribo aquí x";
  let shown = "";
  for (const ch of word) {
    shown += ch;
    await page.keyboard.type(ch);
    await expect(at).toHaveText(new RegExp(`${shown}$`));
  }
  // The last entries arrive with the frame after them.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
  const keys = await page.evaluate(() => (window as unknown as { __keys: number[] }).__keys);
  const all = [
    ...keys,
    ...Array.from({ length: Math.max(0, word.length - keys.length) }, () => 16),
  ].sort((a, b) => a - b);
  return { usual: all[Math.floor(all.length / 2)] ?? 0, worst: all[all.length - 1] ?? 0 };
}

/**
 * His volume (A-15): a page as long as a page may be (a thousand blocks, PAGE_LIMITS) and a note of three thousand
 * paragraphs, as a long journal, open at once and take typing with no lag. Timed here, in CI, with room for a slow
 * machine (on a laptop: a thousand blocks ≈ 25 ms a letter, three thousand paragraphs ≈ 40 ms; a short note ≈ 16).
 */
test("a page of a thousand blocks opens and is typed in without lag (A-15)", async ({ page }) => {
  const blocks = Array.from({ length: 1000 }, (_, i) =>
    i % 50 === 0
      ? { id: `b${i}`, type: "heading", level: 2, text: `Día ${i / 50 + 1}` }
      : i % 7 === 0
        ? { id: `b${i}`, type: "bullet", text: `Una cosa que pasó, la número ${i}` }
        : {
            id: `b${i}`,
            type: "text",
            text: `Párrafo ${i}: lo que se escribió aquel día, con sus detalles.`,
          },
  );
  await openApp(page, "/?still", {
    pages: [{ id: "diario", title: "Diario", spec: { version: 1, blocks } }],
  });
  const started = Date.now();
  await page
    .locator(".sidebar")
    .getByRole("list", { name: "Páginas" })
    .getByRole("button", { name: "Diario", exact: true })
    .click();
  await expect(lines(page)).toHaveCount(1000, { timeout: 15000 });
  const opened = Date.now() - started;
  const { usual, worst } = await typeTimed(page, lines(page).nth(501));
  console.info(
    `1000 blocks: opened in ${opened} ms; a letter shown ${usual} ms after its key (at worst ${worst})`,
  );
  expect(opened).toBeLessThan(4000);
  expect(usual).toBeLessThan(100);
  expect(worst).toBeLessThan(250);
});

test("a note of three thousand paragraphs opens and is typed in without lag (A-15)", async ({
  page,
}) => {
  const paragraphs = Array.from({ length: 3000 }, (_, i) =>
    i % 50 === 0
      ? `## Día ${i / 50 + 1}`
      : i % 7 === 0
        ? `- Una cosa que pasó, la número ${i}`
        : `Párrafo ${i}: lo que se escribió aquel día, con sus detalles.`,
  );
  const started = await openRayuela(page, `${paragraphs.join("\n\n")}\n`);
  const text = page.locator(".row-doc .blk-input");
  await expect(text).toHaveCount(3000, { timeout: 15000 });
  const opened = Date.now() - started;
  const { usual, worst } = await typeTimed(page, text.nth(1501));
  console.info(
    `3000 paragraphs: opened in ${opened} ms; a letter shown ${usual} ms after its key (at worst ${worst})`,
  );
  expect(opened).toBeLessThan(6000);
  expect(usual).toBeLessThan(100);
  expect(worst).toBeLessThan(250);
});
