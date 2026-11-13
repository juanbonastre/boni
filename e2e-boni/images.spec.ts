import { expect, type Locator, type Page, test } from "@playwright/test";
import { type Options, openApp, recorded } from "./fixtures.ts";

/**
 * The images of a note's text (task 2h): grown or shrunk by a corner, shown large with a click and passed with the
 * arrows, dragged on their own (beside another they make a row, out of it they are alone again), cropped without
 * touching their file; each gesture one step of Undo and written at once; with a finger on a phone too. A note that is
 * only looked at is not written (D-66), and one with many large images is typed in without lag (A-15).
 */

async function openNote(page: Page, body: string, images: Options["images"] = { count: 3 }) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, "/?still", { rayuelaBody: body, images });
  await page
    .locator(".sidebar")
    .getByRole("list", { name: "Páginas" })
    .getByRole("button", { name: "Libros", exact: true })
    .click();
  const row = page.locator(".db-table").getByRole("button", { name: "Rayuela", exact: true });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".row-doc .doc-blocks")).toBeVisible();
}

const frames = (page: Page) => page.locator(".row-doc .doc-file-image");
const text = (page: Page) => page.locator(".row-doc .blk-input");
const writes = async (page: Page) =>
  (await recorded(page)).requests.filter((r) => r.startsWith("PUT api/data/rows/r1"));
/** The note's text as it was last written, as it travels (JSON). */
const lastSent = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as { __bodies?: string[] }).__bodies ?? [])
        .filter((b) => b.startsWith("PUT api/data/rows/r1"))
        .at(-1) ?? "",
  );
/** A piece of the note's text as it travels in the request's JSON. */
const sent = (md: string) => JSON.stringify(md).slice(1, -1);
const drawn = async (img: Locator) => {
  await expect
    .poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
};
const centre = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error("not on the screen");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};

/** A mouse drag from one point to another, in steps, as a hand moves. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 3, from.y + (to.y - from.y) / 3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("an image grown and shrunk by its corner: written at once with its width, one step of Undo", async ({
  page,
}) => {
  const body = "Antes.\n\n![foto-01.png](boni:i1)\n\nDespués.\n";
  await openNote(page, body, { count: 1 });
  const frame = frames(page).first();
  const img = frame.locator("img");
  await drawn(img);
  const was = (await img.boundingBox())?.width ?? 0;
  expect(was).toBe(640);
  // The caret in the text, as when one is writing and reaches for the image.
  await text(page).last().click();
  await frame.hover();
  const corner = await centre(frame.locator(".doc-img-corner"));
  await drag(page, corner, { x: corner.x - 200, y: corner.y + 30 });
  await expect(img).toHaveCSS("width", "440px");
  // Written once and at once, not when a timer would have sent it.
  await expect.poll(async () => (await writes(page)).length, { timeout: 600 }).toBe(1);
  expect(await lastSent(page)).toContain(
    sent("Antes.\n\n![foto-01.png|440](boni:i1)\n\nDespués.\n"),
  );
  // One step of Undo gives its size back, the note's bytes as they were.
  await page.keyboard.press("Control+z");
  await expect(img).toHaveCSS("width", "640px");
  await expect.poll(() => lastSent(page), { timeout: 3000 }).toContain(sent(body));
  // Its menu gives it its own size again.
  await frame.hover();
  await drag(page, await centre(frame.locator(".doc-img-corner")), {
    x: corner.x - 300,
    y: corner.y,
  });
  await expect(img).toHaveCSS("width", "340px");
  await page.locator(".row-doc .blk[data-block]").nth(1).hover();
  await page.locator(".row-doc .blk[data-block]").nth(1).locator(".blk-handle button").click();
  await page.getByRole("menuitemradio", { name: "Tamaño original" }).click();
  await expect(img).toHaveCSS("width", "640px");
  await expect.poll(() => lastSent(page), { timeout: 1000 }).toContain(sent(body));
});

test("one click shows an image large; the arrows pass to the others, Esc closes it, Boni's shortcuts still work; Space on it from the text", async ({
  page,
}) => {
  const body =
    "![foto-01.png](boni:i1)\n\nTexto entre imágenes.\n\n![foto-02.png](boni:i2) ![foto-03.png](boni:i3)\n";
  await openNote(page, body);
  await drawn(frames(page).first().locator("img"));
  await frames(page).first().locator("img").click();
  const viewer = page.getByRole("dialog", { name: "Imágenes de la nota" });
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("foto-01.png");
  await expect(viewer).toContainText("1 de 3");
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toContainText("2 de 3");
  await expect(viewer).toContainText("foto-02.png");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toContainText("1 de 3");
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toContainText("3 de 3");
  await viewer.getByRole("button", { name: "Siguiente" }).click();
  await expect(viewer).toContainText("1 de 3");
  // Boni's own shortcut is not taken: the search opens, and its Esc is its own.
  await page.keyboard.press("Control+k");
  await expect(page.locator(".find-box")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".find-box")).toHaveCount(0);
  await viewer.getByRole("button", { name: "Siguiente" }).focus();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // From the text with the keys: up from the line onto the image, Space shows it.
  await text(page).first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press(" ");
  await expect(viewer).toContainText("1 de 3");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // Its text untouched: the space went to the viewer.
  await expect(text(page).first()).toHaveText("Texto entre imágenes.");
  // Looked at, not changed: nothing written.
  await page.waitForTimeout(900);
  expect(await writes(page)).toEqual([]);
});

test("an image dragged beside another makes a row with it; out of the row it is alone again; Esc lets it go; each one step of Undo", async ({
  page,
}) => {
  const body = "![foto-01.png](boni:i1)\n\nTexto.\n\n![foto-02.png](boni:i2)\n";
  // Small enough that both images and the text are on the screen at once, whatever scrolled before.
  await openNote(page, body, { count: 2, width: 320, height: 160 });
  const first = frames(page).nth(0).locator("img");
  const second = frames(page).nth(1).locator("img");
  await drawn(first);
  await drawn(second);
  await text(page).first().click();
  // Esc while dragging: nothing moves.
  const from = await centre(second);
  const to = await centre(first);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x + to.b.width / 4, to.y, { steps: 10 });
  await expect(page.locator(".doc-img-drop")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".doc-img-drop")).toHaveCount(0);
  await expect(page.locator(".row-doc .doc-files-row")).toHaveCount(0);
  // Beside the first (its right half): a row of two, their sizes even.
  await drag(page, await centre(second), { x: to.x + to.b.width / 4, y: to.y });
  const row = page.locator(".row-doc .doc-files-row");
  await expect(row.locator(".doc-file-image")).toHaveCount(2);
  await expect.poll(async () => (await writes(page)).length, { timeout: 600 }).toBe(1);
  expect(await lastSent(page)).toContain(
    sent("![foto-01.png](boni:i1) ![foto-02.png](boni:i2)\n\nTexto.\n"),
  );
  const [a, b] = await row
    .locator(".doc-file-image")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThan(2);
  // Inside the row, each image takes its own size.
  const cell = row.locator(".doc-file-image").first();
  await cell.hover();
  const corner = await centre(cell.locator(".doc-img-corner"));
  await drag(page, corner, { x: corner.x - 120, y: corner.y });
  await expect
    .poll(() => lastSent(page), { timeout: 600 })
    .toMatch(/!\[foto-01\.png\|\d{2,4}\]\(boni:i1\) !\[foto-02\.png\]\(boni:i2\)/);
  // Out of the row, under the text: alone again.
  const out = await centre(row.locator(".doc-file-image").nth(1).locator("img"));
  const line = await centre(text(page).first());
  await drag(page, out, { x: line.x, y: line.b.y + line.b.height - 2 });
  await expect(page.locator(".row-doc .doc-files-row")).toHaveCount(0);
  await expect
    .poll(() => lastSent(page), { timeout: 600 })
    .toContain(sent("\n\nTexto.\n\n![foto-02.png](boni:i2)\n"));
  // Each gesture one step of Undo: back into the row, then the row's size undone, then out of it.
  await text(page).first().click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".row-doc .doc-files-row .doc-file-image")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".row-doc .doc-files-row")).toHaveCount(0);
  await expect.poll(() => lastSent(page), { timeout: 3000 }).toContain(sent(body));
});

test("an image cropped: its file untouched, the crop in its link; changed back to the whole image it is the same text; one step of Undo", async ({
  page,
}) => {
  const body = "Antes.\n\n![foto-01.png](boni:i1)\n";
  await openNote(page, body, { count: 1, width: 400, height: 400 });
  const frame = frames(page).first();
  const img = frame.locator("img");
  await drawn(img);
  await text(page).first().click();
  await frame.hover();
  await frame.getByRole("button", { name: "Recortar: foto-01.png" }).click();
  const dialog = page.getByRole("dialog", { name: "Recortar «foto-01.png»" });
  await expect(dialog).toBeVisible();
  // Esc: nothing changes.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await frame.hover();
  await frame.getByRole("button", { name: "Recortar: foto-01.png" }).click();
  const stage = await centre(dialog.locator(".image-crop-stage"));
  const se = await centre(dialog.locator(".image-crop-corner.se"));
  // The lower right corner to the middle: the upper left quarter.
  await drag(page, se, { x: se.x - stage.b.width / 2, y: se.y - stage.b.height / 2 });
  // The arrows move the box (10 % with Shift).
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await writes(page)).length, { timeout: 600 }).toBe(1);
  expect(await lastSent(page)).toMatch(/!\[foto-01\.png\|crop=10,0,50,50\]\(boni:i1\)/);
  // Shown cropped: the image's own pixels, only a part of them painted.
  await expect(img).toHaveCSS("object-view-box", /inset\(0%? 40% 50% 10%\)/);
  // The whole image again: the same text as before.
  await frame.hover();
  await frame.getByRole("button", { name: "Recortar: foto-01.png" }).click();
  await dialog.getByRole("button", { name: "Sin recorte" }).click();
  await dialog.getByRole("button", { name: "Hecho" }).click();
  await expect.poll(() => lastSent(page), { timeout: 600 }).toContain(sent(body));
  await page.keyboard.press("Control+z");
  await expect.poll(() => lastSent(page), { timeout: 3000 }).toMatch(/crop=10,0,50,50/);
  // From the viewer too.
  await img.click();
  const viewer = page.getByRole("dialog", { name: "Imágenes de la nota" });
  await viewer.getByRole("button", { name: "Recortar" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("a note with images of every kind, opened, its images looked at and hovered, then left, is not written (D-66)", async ({
  page,
}) => {
  const body = [
    "Texto.",
    "![foto-01.png|320](boni:i1)",
    "  ![foto-02.png|crop=10,0,50,80](boni:i2)  ",
    "![foto-01.png](boni:i1)![foto-02.png|200](boni:i2)\t![foto-03.png](boni:i3)",
    "Una frase con ![foto-03.png](boni:i3) dentro.",
    "",
  ].join("\n\n");
  await openNote(page, body);
  await expect(frames(page)).toHaveCount(5);
  // Each image can be pointed at (task 85), by its file: one alone by its block, one of a row by its own frame.
  const ref = (id: string) => JSON.stringify({ kind: "row", id });
  await expect(page.locator(".row-doc .blk[data-block]").nth(1)).toHaveAttribute(
    "data-boni-ref",
    ref("i1"),
  );
  await expect(frames(page).nth(3)).toHaveAttribute("data-boni-ref", ref("i2"));
  for (const f of await frames(page).all()) await f.hover();
  await frames(page).nth(2).locator("img").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await text(page).first().click();
  await page.keyboard.press("ArrowDown");
  await page.locator(".row-doc .doc-title").click();
  await page.waitForTimeout(900);
  expect(await writes(page)).toEqual([]);
});

test("a note of three thousand paragraphs and sixty large images is typed in without lag, and typing asks for no image (A-15)", async ({
  page,
}) => {
  const paragraphs = Array.from({ length: 3000 }, (_, i) =>
    i % 50 === 25
      ? `![foto-${String((i % 60) + 1).padStart(2, "0")}.png](boni:i${(Math.floor(i / 50) % 60) + 1}) ![foto-02.png](boni:i2)`
      : i % 50 === 0
        ? `![foto-${String(((i / 50) % 60) + 1).padStart(2, "0")}.png|480](boni:i${((i / 50) % 60) + 1})`
        : `Párrafo ${i}: lo que se **escribió** aquel día, con [sus](https://example.com) *detalles*.`,
  );
  await openNote(page, `${paragraphs.join("\n\n")}\n`, { count: 60, width: 3000, height: 2000 });
  await expect(text(page)).toHaveCount(2880, { timeout: 15000 });
  const asked = async () =>
    (await recorded(page)).requests.filter((r) => /api\/data\/files\/[^ ]+\/inline/.test(r)).length;
  const at = text(page).nth(1501);
  await at.scrollIntoViewIfNeeded();
  await expect(frames(page).locator("img").first()).toBeVisible();
  await page.waitForTimeout(500);
  const before = await asked();
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
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
  const keys = await page.evaluate(() => (window as unknown as { __keys: number[] }).__keys);
  const all = [
    ...keys,
    ...Array.from({ length: Math.max(0, word.length - keys.length) }, () => 16),
  ].sort((a, b) => a - b);
  const usual = all[Math.floor(all.length / 2)] ?? 0;
  const worst = all.at(-1) ?? 0;
  console.info(
    `3000 paragraphs, 120 images: a letter shown ${usual} ms after its key (at worst ${worst})`,
  );
  expect(usual).toBeLessThan(100);
  expect(worst).toBeLessThan(250);
  // Typing asked for no image again, nor drew them again.
  expect(await asked()).toBe(before);
});

test.describe("on a phone, with a finger", () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

  /** A finger on the screen, held or moved, through the browser's own touch input. */
  async function finger(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: string, x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }],
      });
    return {
      async press(x: number, y: number) {
        await send("touchStart", x, y);
      },
      async move(x0: number, y0: number, x: number, y: number, steps = 10) {
        for (let i = 1; i <= steps; i++)
          await send("touchMove", x0 + ((x - x0) * i) / steps, y0 + ((y - y0) * i) / steps);
      },
      async lift() {
        await send("touchEnd", 0, 0);
      },
    };
  }

  test("a tap shows it large and a swipe passes to the next; held, it is dragged beside another; its corner resizes it", async ({
    page,
  }) => {
    const body = "![foto-01.png](boni:i1)\n\nTexto.\n\n![foto-02.png](boni:i2)\n";
    await openApp(page, "/?still", {
      rayuelaBody: body,
      images: { count: 2, width: 320, height: 240 },
    });
    await page
      .locator(".m-tabs")
      .getByRole("button", { name: /^Páginas/ })
      .tap();
    await page.locator(".m-item-main", { hasText: "Libros" }).tap();
    await page.locator(".m-swipe-row", { hasText: "Rayuela" }).locator(".m-item-main").tap();
    await expect(page.locator(".row-doc")).toBeVisible();
    const first = frames(page).nth(0).locator("img");
    const second = frames(page).nth(1).locator("img");
    await drawn(first);
    await drawn(second);
    const f = await finger(page);
    // A tap: shown large. A swipe to the left: the next one.
    const a = await centre(first);
    await f.press(a.x, a.y);
    await f.lift();
    const viewer = page.getByRole("dialog", { name: "Imágenes de la nota" });
    await expect(viewer).toContainText("1 de 2");
    await f.press(300, 400);
    await f.move(300, 400, 80, 410, 6);
    await f.lift();
    await expect(viewer).toContainText("2 de 2");
    await viewer.getByRole("button", { name: "Cerrar" }).click();
    await expect(viewer).toHaveCount(0);
    // A finger moving at once scrolls: nothing is dragged.
    const b = await centre(second);
    await f.press(b.x, b.y);
    await f.move(b.x, b.y, b.x, b.y - 120, 6);
    await f.lift();
    await expect(page.locator(".doc-img-drop")).toHaveCount(0);
    // Held still, then moved beside the first: a row.
    const b2 = await centre(second);
    const a2 = await centre(first);
    await f.press(b2.x, b2.y);
    await page.waitForTimeout(550);
    await f.move(b2.x, b2.y, a2.x + a2.b.width / 4, a2.y, 12);
    await f.lift();
    await expect(page.locator(".row-doc .doc-files-row .doc-file-image")).toHaveCount(2);
    await expect
      .poll(() => lastSent(page), { timeout: 1000 })
      .toContain(sent("![foto-01.png](boni:i1) ![foto-02.png](boni:i2)"));
    // Its corner, always there without a pointer over it, takes a finger.
    const cell = page.locator(".row-doc .doc-files-row .doc-file-image").first();
    const corner = await centre(cell.locator(".doc-img-corner"));
    await f.press(corner.x, corner.y);
    await f.move(corner.x, corner.y, corner.x - 40, corner.y, 6);
    await f.lift();
    await expect
      .poll(() => lastSent(page), { timeout: 1000 })
      .toMatch(/!\[foto-01\.png\|\d{2,3}\]\(boni:i1\) !\[foto-02\.png\]\(boni:i2\)/);
  });
});
