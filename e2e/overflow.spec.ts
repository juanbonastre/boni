import { expect, type Page, test } from "@playwright/test";

/**
 * Guard against text that does not fit its box, everywhere in the interface: no control (button,
 * segmented option, chip, menu item, select) may break its label over two lines, and no element whose
 * overflow is visible may have content sticking out of it. It walks every surface (settings, detail,
 * panel, menus, dialogs, palette, toast) in Spanish and English, at the default and at a narrow
 * window, so a new long label anywhere fails here instead of being found by eye.
 */

const NOW = "2025-09-17T14:29";

/** Containers that hold interface text (the grid's event cards truncate on purpose and are left out). */
const SURFACES =
  ".modal, .popover, .detail-panel, .ctx, .menu, .palette, .toast, .sidebar, .topbar, .selection-bar, .grid-head, .month-dow";
/** Controls whose label must stay on one line. */
const SINGLE_LINE =
  "button, .btn, .chip, .menu-item, .segmented > *, .select, select, .mini-btn, .swatch-label, .tab";

async function audit(page: Page, where: string): Promise<string[]> {
  return page.evaluate(
    ({ surfaces, singleLine, where }) => {
      const issues: string[] = [];
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      const name = (el: Element) => {
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.trim().split(/\s+/).join(".")}`
            : "";
        const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        return `${el.tagName.toLowerCase()}${cls} "${text}"`;
      };
      for (const surface of document.querySelectorAll(surfaces)) {
        if (!visible(surface)) continue;
        // A dropdown or submenu is meant to stick out of the control that opens it: its ancestors are
        // not checked for size (the dropdown itself is, like any other box).
        const anchors = new Set<Element>();
        for (const el of surface.querySelectorAll("*")) {
          const pos = getComputedStyle(el).position;
          if (pos !== "absolute" && pos !== "fixed") continue;
          for (let a = el.parentElement; a && a !== surface.parentElement; a = a.parentElement)
            anchors.add(a);
        }
        for (const el of surface.querySelectorAll("*")) {
          if (!visible(el) || el instanceof SVGElement || anchors.has(el)) continue;
          const cs = getComputedStyle(el);
          // Content sticking out of a box that does not clip or scroll it.
          if (
            cs.overflowX === "visible" &&
            el.scrollWidth > el.clientWidth + 1 &&
            el.clientWidth > 0
          ) {
            issues.push(
              `${where}: wider than its box: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`,
            );
          }
          if (
            cs.overflowY === "visible" &&
            el.scrollHeight > el.clientHeight + 1 &&
            el.clientHeight > 0
          ) {
            issues.push(
              `${where}: taller than its box: ${name(el)} (${el.scrollHeight} > ${el.clientHeight})`,
            );
          }
        }
        // A control's label broken over several lines.
        const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!(n.textContent ?? "").trim()) continue;
          const host = n.parentElement?.closest(singleLine);
          if (!host || !surface.contains(host) || !visible(host)) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set(
            [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
          );
          if (tops.size > 1) issues.push(`${where}: label on ${tops.size} lines: ${name(host)}`);
        }
      }
      return [...new Set(issues)];
    },
    { surfaces: SURFACES, singleLine: SINGLE_LINE, where },
  );
}

async function open(page: Page, locale: "es" | "en") {
  await page.addInitScript(
    ({ locale }) => localStorage.setItem("boni-calendar:settings", JSON.stringify({ locale })),
    { locale },
  );
  // External calendars download through this stand-in: always a long error (the longest status).
  await page.addInitScript(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test double of the desktop shell's downloader
    (window as any).boniNet = {
      fetchText: async () => ({
        ok: false,
        code: "fetch",
        message: "getaddrinfo ENOTFOUND calendario-con-un-nombre-muy-largo.example.com",
      }),
    };
  });
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.waitForTimeout(400);
}

/**
 * Settings as the desktop app shows them (its own section: keep running in the tray, open at login), with the
 * data section scrolled through: the page is opened again with minimal desktop bridges.
 */
async function desktopSettings(page: Page, locale: "es" | "en"): Promise<string[]> {
  await page.addInitScript(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test double of the desktop shell's notes bridge
    (window as any).boniNotes = { noteApp: "boni" };
    // biome-ignore lint/suspicious/noExplicitAny: test double of the preload bridge
    (window as any).boniDesktop = {
      getPrefs: async () => ({ background: true, autostart: false }),
      setPrefs: async () => ({ ok: true, value: { background: true, autostart: false } }),
      setLabels: () => {},
    };
  });
  await page.addInitScript(
    ({ locale }) => localStorage.setItem("boni-calendar:settings", JSON.stringify({ locale })),
    { locale },
  );
  await page.goto(`/?now=${NOW}&tz=Europe/Madrid`);
  await page.waitForSelector(".ev");
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(200);
  const issues = await audit(page, "settings of the desktop app");
  await page.locator(".modal-body").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  issues.push(...(await audit(page, "settings of the desktop app, scrolled")));
  await page.locator(".modal").screenshot({
    path: `e2e/screenshots/settings-data-${await page.evaluate(() => window.innerWidth)}.png`,
  });
  return issues;
}

async function walkEverything(page: Page): Promise<string[]> {
  const issues: string[] = [];
  const check = async (where: string) => issues.push(...(await audit(page, where)));

  await check("sidebar and top bar");

  // view picker
  await page.locator(".view-picker button[aria-haspopup=menu]").click();
  await check("view menu");
  await page.keyboard.press("Escape");

  // settings (the desktop app's own section is checked by desktopSettings), with the form of a
  // new external calendar, then with one that failed to download
  await page.keyboard.press("Control+,");
  await page.waitForTimeout(200);
  await check("settings");
  await page.locator(".ext-settings .btn.add").click();
  await check("external calendar form");
  const form = page.locator(".ext-form");
  await form.locator("input").first().fill("Un calendario externo con un nombre bastante largo");
  await form
    .locator("input")
    .nth(1)
    .fill("https://calendario-con-un-nombre-muy-largo.example.com/x.ics");
  await form.locator(".btn.primary").click();
  await page.locator(".ext-settings .setting small", { hasText: /descargar|download/ }).waitFor();
  await check("external calendar with an error");
  await page.keyboard.press("Escape");

  // event detail popover and side panel
  await page.locator(".ev", { hasText: "Clase IPM" }).first().click();
  await page.waitForTimeout(200);
  await check("detail popover");
  await page
    .locator(".popover .prop-row", { hasText: /Repetir|Repeat/ })
    .locator(".choice-btn")
    .click();
  await check("repeat menu");
  await page.keyboard.press("Escape");
  await page
    .locator(".popover button[title='Abrir como panel'], .popover button[title='Open as panel']")
    .click();
  await page.waitForTimeout(300);
  await check("detail panel");
  await page.keyboard.press("Escape");

  // context menus: event (+ submenu), empty slot, calendar
  await page.locator(".ev", { hasText: "Dentista" }).first().click({ button: "right" });
  await check("event menu");
  await page
    .locator(".ctx")
    .getByRole("menuitem", { name: /Mover a calendario|Move to calendar/ })
    .hover();
  await page.waitForTimeout(150);
  await check("move-to submenu");
  await page.keyboard.press("Escape");
  const cols = await page.locator(".cols-viewport").boundingBox();
  if (cols) await page.mouse.click(cols.x + cols.width * 0.93, cols.y + 40, { button: "right" });
  await check("slot menu");
  await page.keyboard.press("Escape");
  await page.locator(".cal-row", { hasText: "Docencia" }).click({ button: "right" });
  await check("calendar menu");
  await page.keyboard.press("Escape");

  // calendar properties (schema and calendar view)
  await page.locator(".cal-row", { hasText: "Docencia" }).hover();
  await page.locator(".cal-row", { hasText: "Docencia" }).locator(".gear").click();
  await page.waitForTimeout(200);
  await check("calendar properties");
  await page.keyboard.press("Escape");

  // palette, help
  await page.keyboard.press("Control+k");
  await page.locator(".palette-input").fill("clase FUP mañana 10-12 #docencia");
  await page.waitForTimeout(200);
  await check("palette");
  await page.keyboard.press("Escape");
  await page.keyboard.press("?");
  await check("help");
  await page.keyboard.press("Escape");

  // a scope question and a toast
  await page.locator(".ev", { hasText: "Clase FUP" }).first().click();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(150);
  await check("scope dialog");
  await page.locator(".modal").getByRole("button").first().click();
  await page.waitForTimeout(150);
  await check("toast");
  return issues;
}

for (const locale of ["es", "en"] as const) {
  for (const [w, h] of [
    [1440, 900],
    [900, 640],
    // A pane of another app (the Obsidian plugin) is often this narrow.
    [720, 640],
  ] as const) {
    test(`no text overflows its box (${locale}, ${w}x${h})`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, locale);
      const issues = await walkEverything(page);
      issues.push(...(await desktopSettings(page, locale)));
      expect(issues, issues.join("\n")).toEqual([]);
    });
  }
}

/** The phone layout (a narrow touch screen): top bar, drawer, sheet, menus, month, settings. */
test.describe("on a phone", () => {
  test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });
  for (const locale of ["es", "en"] as const) {
    test(`no text overflows its box (${locale}, phone)`, async ({ page }) => {
      await open(page, locale);
      const issues: string[] = [];
      const check = async (where: string) => issues.push(...(await audit(page, `phone ${where}`)));
      await check("top bar");
      await page.locator(".topbar .icon-btn").first().tap();
      await check("drawer");
      await page.locator(".drawer-scrim").tap({ position: { x: 390, y: 400 } });
      await page.locator(".ev", { hasText: "Clase FUP" }).last().tap();
      await page.waitForTimeout(200);
      await check("sheet");
      await page.keyboard.press("Escape");
      await page.locator(".view-picker .pill").tap();
      await check("view menu");
      await page.locator(".view-menu .menu-item").nth(2).tap();
      await page.waitForSelector(".mchip");
      await check("month");
      await page.keyboard.press("Control+,");
      await page.waitForTimeout(200);
      await check("settings");
      expect(issues, issues.join("\n")).toEqual([]);
    });
  }
});
