import { expect, type Page, test } from "@playwright/test";
import { openApp } from "./fixtures.ts";

/**
 * Text fits its box, everywhere (Boni Calendar's rule): no control breaks its label over two lines and nothing
 * sticks out of a box that does not clip or scroll. Every surface, in Spanish and English, at a normal and a
 * narrow window. A new surface must be added here.
 */

const SURFACES =
  ".topbar, .chart-card, .list-row, .section-head, .modal, .menu, .toast, .form, .editor-form, .setup-hint";
const SINGLE_LINE =
  "button, .btn, .pill, .choice, .menu-item, .segmented > *, .picked-chip, .card-title, .list-title";

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

for (const language of ["es", "en"] as const) {
  for (const width of [1280, 560]) {
    test(`every surface fits (${language}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const back = language === "es" ? "Volver" : "Back";
      const issues: string[] = [];
      await openApp(page, "/?still", { language });
      await page.locator(".chart-card svg").first().waitFor();
      issues.push(...(await audit(page, "home")));
      await page
        .getByRole("button", { name: language === "es" ? "Apuntar gasto" : "Apuntar gasto" })
        .click();
      await page.locator(".form").waitFor();
      issues.push(...(await audit(page, "capture")));
      await page.getByRole("button", { name: back }).click();
      await page.getByRole("button", { name: language === "es" ? "Gráficas" : "Charts" }).click();
      await page.locator(".list-row").first().waitFor();
      issues.push(...(await audit(page, "charts")));
      await page
        .getByRole("button", { name: language === "es" ? "Añadir widget" : "Add widget" })
        .click();
      issues.push(...(await audit(page, "add widget menu")));
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: language === "es" ? "Editar" : "Edit" })
        .first()
        .click();
      await page.locator(".editor-form .choices").first().waitFor();
      await page
        .getByRole("button", { name: language === "es" ? "Añadir filtro" : "Add filter" })
        .click();
      issues.push(...(await audit(page, "editor + filter menu")));
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: language === "es" ? "Ajustes" : "Settings" }).click();
      await page.locator(".modal").waitFor();
      issues.push(...(await audit(page, "settings")));
      expect(issues).toEqual([]);
    });
  }
}
