import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { openApp } from "./fixtures.ts";

/**
 * The page editor as a document (Juan, 2026-10-30, phase 1 of «Boni: el editor de páginas»): whole blocks selected
 * as Notion's (Esc, Shift+arrows, a drag across blocks, Shift+click, Ctrl+A twice) and what the keys do to them;
 * several lines pasted as blocks; the arrows going from block to block as in a document.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const lines = (page: Page) => page.locator(".doc-blocks textarea");
const selected = (page: Page) => page.locator(".blk.selected");
const values = (page: Page) =>
  lines(page).evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

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

test("a drag across blocks selects them whole; Shift+click and Ctrl+A twice too; copied and pasted as blocks", async ({
  page,
}) => {
  await pageWith(page, ["Uno", "Dos", "Tres", ""]);
  // Pressed in «Uno», released over «Tres»: three blocks, no text half selected.
  const box = async (i: number) =>
    (await lines(page).nth(i).boundingBox()) as NonNullable<
      Awaited<ReturnType<ReturnType<typeof lines>["boundingBox"]>>
    >;
  const a = await box(0);
  const c = await box(2);
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + 20, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(selected(page)).toHaveCount(3);
  // Ctrl+C copies them as Markdown; pasted into the empty last line they come back as blocks.
  await page.keyboard.press("Control+c");
  await lines(page).nth(3).click();
  await expect(selected(page)).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect.poll(() => values(page)).toEqual(["Uno", "Dos", "Tres", "Uno", "Dos", "Tres"]);
  // Shift+click from the line being edited takes every block between.
  await lines(page).nth(1).click();
  await lines(page)
    .nth(4)
    .click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(4);
  // A click elsewhere lets go; Ctrl+A in a line selects its text, a second time every block.
  await lines(page).nth(0).click();
  await expect(selected(page)).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(6);
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
  await expect(lines(page).nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(lines(page).nth(2)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(lines(page).nth(1)).toBeFocused();
});
