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
async function openRayuela(
  page: Page,
  body?: string,
  more: Parameters<typeof openApp>[2] = {},
): Promise<number> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", body === undefined ? more : { ...more, rayuelaBody: body });
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

/** What a line shows a person: its words without the marks hidden around them. */
const seen = (line: ReturnType<Page["locator"]>) =>
  line.evaluate((e) => {
    const copy = e.cloneNode(true) as HTMLElement;
    for (const m of copy.querySelectorAll(".md-hide")) m.remove();
    return copy.textContent ?? "";
  });
/** The words of the first line from `from`, `n` letters long, selected with the keys. */
async function selectIn(page: Page, line: ReturnType<Page["locator"]>, from: number, n: number) {
  await line.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < from; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowRight");
}
const bar = (page: Page) => page.getByRole("toolbar", { name: "Formato" });

test("inline formats (task 2f): typed Markdown painted, its marks shown only at the caret; Ctrl+B, Ctrl+I, Ctrl+Shift+X and a backtick put them on and off, each one step of Undo; the menu shows them pressed", async ({
  page,
}) => {
  await pageWith(page, ["Una idea suelta"]);
  const line = lines(page).first();
  // Typed as Markdown: painted, the marks there while the caret is in it, hidden once it leaves.
  await page.keyboard.type(" y **negrita**", { delay: 10 });
  await expect(line.locator(".md-strong")).toHaveText("negrita");
  await expect(line.locator(".md-mark:not(.md-hide)")).toHaveCount(2);
  await page.keyboard.press("Home");
  await expect(line.locator(".md-mark.md-hide")).toHaveCount(2);
  expect(await seen(line)).toBe("Una idea suelta y negrita");
  // A selection: Ctrl+B on and off, the selection kept; the menu shows it pressed.
  await selectIn(page, line, 4, 4);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Negrita" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.press("Control+b");
  await expect.poll(() => values(page)).toEqual(["Una **idea** suelta y **negrita**"]);
  await expect(bar(page).getByRole("button", { name: "Negrita" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Control+b");
  await expect.poll(() => values(page)).toEqual(["Una idea suelta y **negrita**"]);
  // Each a step of Undo of its own, and Redo brings it back.
  await page.keyboard.press("Control+i");
  await expect.poll(() => values(page)).toEqual(["Una *idea* suelta y **negrita**"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => values(page)).toEqual(["Una idea suelta y **negrita**"]);
  await page.keyboard.press("Control+y");
  await expect.poll(() => values(page)).toEqual(["Una *idea* suelta y **negrita**"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => values(page)).toEqual(["Una idea suelta y **negrita**"]);
  // Strikethrough by its keys; code by a backtick over the words; the menu's buttons the same.
  await selectIn(page, line, 4, 4);
  await page.keyboard.press("Control+Shift+x");
  await expect.poll(() => values(page)).toEqual(["Una ~~idea~~ suelta y **negrita**"]);
  await page.keyboard.press("Control+Shift+x");
  await selectIn(page, line, 9, 6);
  await page.keyboard.type("`");
  await expect.poll(() => values(page)).toEqual(["Una idea `suelta` y **negrita**"]);
  await expect(line.locator(".md-code")).toHaveText("suelta");
  // The menu's buttons over a selection: in quarantine with task 117, the test after this one.
  await selectIn(page, line, 4, 4);
  await expect(bar(page).getByRole("button", { name: "Cursiva" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/editor-format.png` });
  // With no selection: the marks to type between; inside a format, the format off.
  await page.keyboard.press("End");
  await page.keyboard.type(" ", { delay: 10 });
  await page.keyboard.press("Control+b");
  await page.keyboard.type("más", { delay: 10 });
  await expect.poll(() => values(page)).toEqual(["Una idea `suelta` y **negrita** **más**"]);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Control+b");
  await expect.poll(() => values(page)).toEqual(["Una idea `suelta` y **negrita** más"]);
  // Across two blocks, each block's words; the second time, off in both.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Otra línea", { delay: 10 });
  await lines(page).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+i");
  await expect
    .poll(() => values(page))
    .toEqual(["Una idea `suelta` y **negrita** más", "*Otra línea*"]);
});

// In quarantine (task 117): in main's CI, three runs of four on 2026-11-13, the menu's «Cursiva» formatted «ide»
// of «idea», the selection one key short, and reading the screen at the click made it worse (15 of 30 here). It
// comes back out of quarantine with the cause found and fixed.
test.fixme("the menu's Cursiva over a selection puts it on and off, the text keeping the focus (task 2f; quarantined, task 117)", async ({
  page,
}) => {
  await pageWith(page, ["Una idea `suelta` y **negrita**"]);
  const line = lines(page).first();
  await selectIn(page, line, 4, 4);
  await bar(page).getByRole("button", { name: "Cursiva" }).click();
  await expect.poll(() => values(page)).toEqual(["Una *idea* `suelta` y **negrita**"]);
  await expect(page.locator(".doc-blocks .doc-run")).toBeFocused();
  await bar(page).getByRole("button", { name: "Cursiva" }).click();
  await expect.poll(() => values(page)).toEqual(["Una idea `suelta` y **negrita**"]);
});

test("links (task 2f): Ctrl+K on words, an address pasted over them; the caret in one shows it to open, change or take off; Ctrl+K elsewhere is the search; HTML pasted is plain text", async ({
  page,
}) => {
  await pageWith(page, ["Mira esta web hoy"]);
  const line = lines(page).first();
  await selectIn(page, line, 5, 8);
  await page.keyboard.press("Control+k");
  const field = bar(page).getByRole("textbox", { name: "Dirección del enlace" });
  await expect(field).toBeFocused();
  await expect(page.locator(".find-box")).toHaveCount(0);
  // Not an address: said, and nothing written.
  await field.fill("palabra");
  await field.press("Enter");
  await expect(bar(page).getByRole("alert")).toHaveText("No es una dirección");
  await field.fill("example.com/a");
  await field.press("Enter");
  await expect.poll(() => values(page)).toEqual(["Mira [esta web](https://example.com/a) hoy"]);
  await expect(line.locator(".md-link")).toHaveText("esta web");
  // The caret in it: its address as text, to open, change or take off.
  await expect(bar(page).locator(".fmt-url")).toHaveText("https://example.com/a");
  await bar(page).getByRole("button", { name: "Cambiar" }).click();
  await expect(field).toHaveValue("https://example.com/a");
  await field.fill("https://example.org/b");
  await field.press("Enter");
  await expect.poll(() => values(page)).toEqual(["Mira [esta web](https://example.org/b) hoy"]);
  await bar(page).getByRole("button", { name: "Quitar" }).click();
  await expect.poll(() => values(page)).toEqual(["Mira esta web hoy"]);
  // An address pasted over words makes them its link; one step of Undo takes it off.
  await selectIn(page, line, 5, 4);
  await paste(page, "https://example.com/x");
  await expect.poll(() => values(page)).toEqual(["Mira [esta](https://example.com/x) web hoy"]);
  await page.keyboard.press("Control+z");
  await expect.poll(() => values(page)).toEqual(["Mira esta web hoy"]);
  // With the caret in plain words Ctrl+K is the search, as everywhere.
  await page.keyboard.press("End");
  await page.keyboard.press("Control+k");
  await expect(page.locator(".find-box")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".find-box")).toHaveCount(0);
  // HTML from another app comes in as its plain text, never painted.
  await line.click();
  await page.keyboard.press("End");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", '<b>negrita</b> <a href="https://example.com">enlace</a>');
    data.setData("text/plain", " negrita enlace");
    (document.activeElement ?? document.body).dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect.poll(() => values(page)).toEqual(["Mira esta web hoy negrita enlace"]);
  await expect(line.locator("b, a")).toHaveCount(0);
});

test("a note with every format, opened, clicked, selected and left, is not written (D-66); a format put on writes the same bytes with its marks", async ({
  page,
}) => {
  const body =
    "Texto con __negrita__, _cursiva_, ~~tachado~~, `código` y [enlace](<https://example.com/a b>).\n\n" +
    "***Las dos*** y [[Nota enlazada|alias]] y https://example.com/x.\n";
  await openRayuela(page, body);
  const text = page.locator(".row-doc .blk-input");
  await expect(text.first().locator(".md-strong")).toHaveText("negrita");
  expect(await seen(text.nth(1))).toBe("Las dos y alias y https://example.com/x.");
  await selectIn(page, text.first(), 10, 12);
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator(".row-doc .doc-title").click();
  await page.waitForTimeout(900);
  const writes = async () =>
    (await recorded(page)).requests.filter((r) => r.startsWith("PUT api/data/rows/r1"));
  expect(await writes()).toEqual([]);
  // «Texto» made bold: written once, everything else as it was.
  await selectIn(page, text.first(), 0, 5);
  await page.keyboard.press("Control+b");
  await expect.poll(async () => (await writes()).length, { timeout: 3000 }).toBe(1);
  const sent = await page.evaluate(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
      b.startsWith("PUT api/data/rows/r1"),
    ),
  );
  expect(sent.at(-1)).toContain(JSON.stringify(body.replace("Texto", "**Texto**")).slice(1, -1));
});

test("a mention [[Título]] opens what it names (task 110, D-71): Ctrl+click as on a link; none or several said in place, several chosen there; typing in it never opens; the note not written", async ({
  page,
}) => {
  const body = "Ver [[Ficciones]], [[Nada de esto]] y [[pedro páramo|el otro]].\n";
  await openRayuela(page, body, {
    titled: [
      {
        id: "x1",
        type: "t_lecturas",
        collection: "Lecturas",
        title: "Pedro Páramo",
        updated: Date.UTC(2026, 9, 2, 9),
      },
    ],
  });
  const text = page.locator(".row-doc .blk-input").first();
  const mention = (name: string) => text.locator(".md-mention", { hasText: name });
  await expect(text.locator(".md-mention")).toHaveText(["Ficciones", "Nada de esto", "el otro"]);
  const asked = async () =>
    (await recorded(page)).requests.filter((r) => r.startsWith("GET api/data/titled"));
  // A plain click puts the caret in it: its title shown, to open; nothing asked yet.
  await mention("Nada de esto").click();
  await expect(bar(page).locator(".fmt-url")).toHaveText("Nada de esto");
  await expect(bar(page).getByRole("button", { name: "Abrir" })).toBeVisible();
  expect(await asked()).toEqual([]);
  // Ctrl+click: none of that title, said in place; the title asked escaped strictly (the apps' allowed paths).
  await mention("Nada de esto").click({ modifiers: ["Control"] });
  await expect(bar(page).getByRole("status")).toHaveText("No existe");
  expect(await asked()).toEqual(["GET api/data/titled?title=Nada%20de%20esto"]);
  // Two of that title (case aside): both offered, each with its collection; nothing opened.
  await mention("el otro").click({ modifiers: ["Control"] });
  const choices = bar(page).getByRole("list", { name: "2 con este título" });
  await expect(choices.getByRole("button")).toHaveCount(2);
  await expect(choices.getByRole("button").first()).toContainText("Libros");
  await expect(choices.getByRole("button").nth(1)).toContainText("Lecturas");
  await page.screenshot({ path: `${SHOTS}/editor-mention-many.png` });
  await expect(page.locator(".row-doc .doc-title")).toHaveValue("Rayuela");
  // Typing inside a mention edits it and never opens anything.
  const before = (await asked()).length;
  await mention("Ficciones").click();
  await page.keyboard.type("x", { delay: 60 });
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);
  expect((await asked()).length).toBe(before);
  await expect(page.locator(".row-doc .doc-title")).toHaveValue("Rayuela");
  // Its text as it was: whatever is written of it is the same bytes (D-66).
  await page.waitForTimeout(900);
  const sent = await page.evaluate(() =>
    ((window as unknown as { __bodies?: string[] }).__bodies ?? []).filter((b) =>
      b.startsWith("PUT api/data/rows/r1"),
    ),
  );
  for (const b of sent) expect(b).toContain(JSON.stringify(body).slice(1, -1));
  // One of them chosen: that one opens.
  await mention("el otro").click({ modifiers: ["Control"] });
  await choices.getByRole("button", { name: /Libros/ }).click();
  await expect(page.locator(".row-doc .doc-title")).toHaveValue("Pedro Páramo");
  // One of that title: Ctrl+click opens it.
  await page
    .locator(".sidebar")
    .getByRole("list", { name: "Páginas" })
    .getByRole("button", { name: "Libros", exact: true })
    .click();
  await page.locator(".db-table").getByRole("button", { name: "Rayuela", exact: true }).click();
  await expect(page.locator(".row-doc .doc-title")).toHaveValue("Rayuela");
  await mention("Ficciones").click({ modifiers: ["Control"] });
  await expect(page.locator(".row-doc .doc-title")).toHaveValue("Ficciones");
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
            text: `Párrafo ${i}: lo que se **escribió** aquel día, con \`sus\` *detalles*.`,
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
        : `Párrafo ${i}: lo que se **escribió** aquel día, con [sus](https://example.com) *detalles*.`,
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
