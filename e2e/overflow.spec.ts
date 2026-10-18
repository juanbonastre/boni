import { expect, type Page, test } from "@playwright/test";
import { openApp } from "./fixtures.ts";

/**
 * Text fits its box, everywhere (Boni Calendar's rule): no control breaks its label over two lines and nothing
 * sticks out of a box that does not clip or scroll. Every surface (sidebar, top bar, cards and their controls,
 * floating boxes, side panel, settings, toast, a widget), in Spanish and English, at a normal and a narrow window.
 * A new surface must be added here.
 */

const SURFACES =
  ".sidebar, .topbar, .chart-card, .card-controls, .pop-box, .side-panel, .modal, .toast, .empty-state, " +
  ".m-top, .m-scroll, .m-tabs, .m-sheet, .m-action-sheet, .m-periods";
const SINGLE_LINE =
  "button, .btn, .pill, .ctl, .choice, .menu-item, .segmented > *, .picked-chip, .card-title, .nav-name, " +
  ".m-title, .m-shortcut-name, .m-shortcut-sub, .m-chart-row-name, .m-chart-row-sub, .m-tab-label";

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
        return `${el.tagName.toLowerCase()}${cls} "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
      };
      for (const surface of document.querySelectorAll(surfaces)) {
        if (!visible(surface)) continue;
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
          if (
            cs.overflowX === "visible" &&
            el.scrollWidth > el.clientWidth + 1 &&
            el.clientWidth > 0
          ) {
            issues.push(
              `${where}: wider than its box: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`,
            );
          }
        }
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

const L = {
  es: {
    period: "Periodo",
    filters: "Filtros",
    addFilter: "Añadir filtro",
    more: "Más",
    edit: /^Editar…/,
    settings: "Ajustes",
  },
  en: {
    period: "Period",
    filters: "Filters",
    addFilter: "Add filter",
    more: "More",
    edit: /^Edit…/,
    settings: "Settings",
  },
};

for (const language of ["es", "en"] as const) {
  for (const width of [1440, 900]) {
    test(`every surface fits (${language}, ${width} px)`, async ({ page }) => {
      const l = L[language];
      await page.setViewportSize({ width, height: 860 });
      const issues: string[] = [];
      await openApp(page, "/?still", { language });
      await expect(page.locator(".dashboard .chart-card")).toHaveCount(3);
      await page.locator(".chart-card .chart svg").first().waitFor();
      issues.push(...(await audit(page, "home")));

      const card = page.locator(".dashboard .chart-card").nth(1);
      await card.hover();
      issues.push(...(await audit(page, "card controls")));
      await card.getByRole("button", { name: l.period }).click();
      issues.push(...(await audit(page, "period menu")));
      await page.keyboard.press("Escape");
      await card.hover();
      await card.getByRole("button", { name: l.filters }).click();
      await page.locator(".pop-box").getByRole("button", { name: l.addFilter }).click();
      await page.getByRole("menuitem").nth(2).click();
      issues.push(...(await audit(page, "filters box")));
      await page.keyboard.press("Escape");
      await card.hover();
      await card.getByRole("button", { name: l.more }).click();
      issues.push(...(await audit(page, "chart menu")));
      await page.keyboard.press("Escape");

      await page.keyboard.press("n");
      await page.locator(".side-panel .form").waitFor();
      issues.push(...(await audit(page, "capture panel")));
      await page.keyboard.press("Escape");

      const row = page.locator(".nav-list").first().locator(".chart-row").first();
      await row.hover();
      await row.getByRole("button", { name: l.edit }).click();
      await page.locator(".side-panel .editor-form .choices").first().waitFor();
      issues.push(...(await audit(page, "editor panel")));
      await page.keyboard.press("Escape");

      await page.locator(".sidebar").getByRole("button", { name: l.settings }).click();
      await page.locator(".modal").waitFor();
      issues.push(...(await audit(page, "settings")));
      expect(issues).toEqual([]);
    });
  }

  test(`the login form and a widget fit (${language})`, async ({ page }) => {
    const issues: string[] = [];
    await openApp(page, "/?still", { language, legacy: true });
    await page.locator(".topbar .pill.warn").click();
    await page.locator(".modal .server-form").waitFor();
    issues.push(...(await audit(page, "login form")));
    await page.setViewportSize({ width: 300, height: 200 });
    await openApp(page, "/?widget=w-monthly-spending&chart=monthly-spending&still", { language });
    await page.locator(".widget .card-title").waitFor();
    await page.locator(".widget").hover();
    issues.push(...(await audit(page, "widget")));
    expect(issues).toEqual([]);
  });
}

/** The phone (MobileApp): every surface at a small phone's width, with real taps. */
const P = {
  es: {
    more: /^Más detalles/,
    menu: "Opciones de Café",
    edit: "Editar",
    charts: "Gráficas",
    chartMenu: "Opciones de la gráfica",
    settings: "Ajustes",
  },
  en: {
    more: /^More details/,
    menu: "Options of Café",
    edit: "Edit",
    charts: "Charts",
    chartMenu: "Chart options",
    settings: "Settings",
  },
};
test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  for (const language of ["es", "en"] as const) {
    test(`every phone surface fits (${language})`, async ({ page }) => {
      const l = P[language];
      const issues: string[] = [];
      await openApp(page, "/?still", { language });
      await expect(page.locator(".m-shortcut")).toHaveCount(2);
      issues.push(...(await audit(page, "phone log")));
      await page.locator(".m-capture").tap();
      await page.getByRole("button", { name: l.more }).tap();
      issues.push(...(await audit(page, "phone form")));
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: l.menu }).tap();
      issues.push(...(await audit(page, "phone shortcut menu")));
      await page.getByRole("menuitem", { name: l.edit }).tap();
      await page.locator(".m-sheet .form").waitFor();
      issues.push(...(await audit(page, "phone shortcut editor")));
      await page.keyboard.press("Escape");
      await page.locator(".m-tab").nth(1).tap();
      await expect(page.locator(".m-chart-row")).toHaveCount(3);
      issues.push(...(await audit(page, "phone charts")));
      await page.locator(".m-chart-row").nth(1).tap();
      await page.locator(".m-chart-body .chart svg").waitFor();
      issues.push(...(await audit(page, "phone chart")));
      await page.getByRole("button", { name: l.chartMenu }).tap();
      await page.getByRole("menuitem", { name: l.edit }).tap();
      await page.locator(".m-sheet .editor-form .choices").first().waitFor();
      issues.push(...(await audit(page, "phone chart editor")));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: l.settings }).tap();
      await page.locator(".modal").waitFor();
      issues.push(...(await audit(page, "phone settings")));
      expect(issues).toEqual([]);
    });
  }
});
