import type { Page } from "@playwright/test";

/**
 * The checks the overflow and worst-case tests share: text fits its box and no control breaks its label over
 * two lines (Boni Calendar's rule), on every surface, and every section of Settings with every group open.
 */

const SURFACES =
  ".sidebar, .topbar, .chart-card, .card-controls, .pop-box, .side-panel, .modal, .toast, .empty-state, " +
  ".doc, .slash-menu, .db, .find-box, .protect-menu, .cols-table, " +
  ".m-top, .m-scroll, .m-tabs, .m-sheet, .m-action-sheet, .m-periods, .chat, .agent-page";
const SINGLE_LINE =
  "button, .btn, .pill, .ctl, .choice, .menu-item, .segmented > *, .picked-chip, .card-title, .nav-name, " +
  ".m-title, .m-shortcut-name, .m-shortcut-sub, .m-chart-row-name, .m-chart-row-sub, .m-tab-label, .link-btn, .confirm-row dt";

export async function audit(page: Page, where: string): Promise<string[]> {
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

/** Every section of Settings, with every group opened. */
export async function settingsAudit(page: Page, prefix = ""): Promise<string[]> {
  const issues: string[] = [];
  const tabs = page.locator(".modal [role=tab]");
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const tab = tabs.nth(i);
    await tab.click();
    const name = (await tab.textContent()) ?? String(i);
    await page.locator(".modal .settings-pane h3").first().waitFor();
    // Wait for what a section loads (the mailbox, the visibility list) before opening its groups.
    await page.waitForTimeout(150);
    const closed = page.locator('.modal .disclosure-head[aria-expanded="false"]');
    while ((await closed.count()) > 0) await closed.first().click();
    issues.push(...(await audit(page, `${prefix}settings: ${name}`)));
  }
  return issues;
}

/** «Modelos»: words to find its controls by. */
export const MODELS_TEXT = {
  es: {
    nav: "Modelos",
    spend: /^Gasto de/,
    conns: /^Conexiones/,
    budget: "Cambiar el presupuesto",
    change: "Cambiar",
    cases: "Ver los casos",
  },
  en: {
    nav: "Models",
    spend: /^Spending in/,
    conns: /^Connections/,
    budget: "Change the budget",
    change: "Change",
    cases: "See the cases",
  },
};

/** «Modelos» with every section opened, a role's cases and the panel to change it with an evaluation. */
export async function modelsAudit(page: Page, l: (typeof MODELS_TEXT)["es"], where: string) {
  const issues: string[] = [];
  await page.locator(".sidebar").getByRole("button", { name: l.nav }).click();
  await page.locator(".models-card").first().waitFor();
  issues.push(...(await audit(page, `${where} models`)));
  await page.getByRole("button", { name: l.spend }).click();
  await page.getByRole("button", { name: l.budget }).click();
  await page.getByRole("button", { name: l.conns }).click();
  const roles = page.locator(".models-card .models-row:not([aria-expanded=true])");
  while ((await roles.count()) > 0) await roles.first().click();
  for (const c of await page.getByRole("button", { name: l.cases }).all()) await c.click();
  issues.push(...(await audit(page, `${where} models opened`)));
  await page.getByRole("button", { name: l.change, exact: true }).first().click();
  await page.locator(".models-panel .models-option").first().click();
  await page.locator(".models-compare").waitFor();
  issues.push(...(await audit(page, `${where} models panel`)));
  return issues;
}
