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

/** Ajustes → Modelos, «Registro», «Auditoría» and the template pages: words to find their controls by. */
export const MODELS_TEXT = {
  es: {
    settings: "Ajustes",
    nav: "Modelos",
    conns: /^Claves/,
    budget: "Cambiar el presupuesto",
    change: "Cambiar",
    cases: "Ver los casos",
    chat: "Conversación",
    activity: "Registro",
    openAudit: "Auditoría",
    runs: /^Ejecuciones/,
    usoIa: "Uso de la IA",
    actividad: "Actividad",
  },
  en: {
    settings: "Settings",
    nav: "Models",
    conns: /^Keys/,
    budget: "Change the budget",
    change: "Change",
    cases: "See the cases",
    chat: "Conversation",
    activity: "Activity log",
    openAudit: "Audit",
    runs: /^Runs/,
    usoIa: "Uso de la IA",
    actividad: "Actividad",
  },
};

/** Ajustes → Modelos with every part opened: the budget, the keys, each use's panel with its cases and the list to change it. */
export async function modelsAudit(page: Page, l: (typeof MODELS_TEXT)["es"], where: string) {
  const issues: string[] = [];
  await page.locator(".sidebar").getByRole("button", { name: l.settings }).click();
  await page.locator(".modal").getByRole("tab", { name: l.nav }).click();
  await page.locator(".use-card").first().waitFor();
  issues.push(...(await audit(page, `${where} models`)));
  await page.getByRole("button", { name: l.budget }).click();
  issues.push(...(await audit(page, `${where} models spending`)));
  await page.getByRole("button", { name: l.conns }).click();
  issues.push(...(await audit(page, `${where} models opened`)));
  const cards = page.locator(".use-card");
  for (let i = 0; i < (await cards.count()); i++) {
    await cards.nth(i).click();
    await page.locator(".models-panel").waitFor();
    const cases = page.locator(".models-panel").getByRole("button", { name: l.cases });
    if (await cases.count()) await cases.click();
    issues.push(...(await audit(page, `${where} models use ${i}`)));
    // Back to the list of uses.
    await page.keyboard.press("Escape");
  }
  await cards.first().click();
  await page.locator(".models-panel").getByRole("button", { name: l.change, exact: true }).click();
  await page.locator(".models-panel .models-option").first().click();
  await page.locator(".models-compare").waitFor();
  issues.push(...(await audit(page, `${where} models panel`)));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator(".modal").waitFor({ state: "detached" });
  return issues;
}

/** The template pages («Uso de la IA», «Actividad») and what one of their numbers counts. */
export async function templatesAudit(page: Page, l: (typeof MODELS_TEXT)["es"], where: string) {
  const issues: string[] = [];
  await page.locator(".sidebar").getByRole("button", { name: l.usoIa, exact: true }).click();
  await page.locator(".blk-number .kpi-value").first().waitFor();
  await page.locator(".blk-bars .barlist-row").first().waitFor();
  issues.push(...(await audit(page, `${where} uso-ia`)));
  await page.locator(".blk-number").first().click();
  await page.locator(".rows-panel-list li").first().waitFor();
  issues.push(...(await audit(page, `${where} uso-ia rows`)));
  await page.keyboard.press("Escape");
  await page.locator(".sidebar").getByRole("button", { name: l.actividad, exact: true }).click();
  await page.locator(".db-table tbody tr").first().waitFor();
  issues.push(...(await audit(page, `${where} actividad`)));
  return issues;
}

/** «Registro» with its runs open, then «Auditoría» with an action open. */
export async function activityAudit(page: Page, l: (typeof MODELS_TEXT)["es"], where: string) {
  const issues: string[] = [];
  await page.locator(".sidebar").getByRole("button", { name: l.chat }).click();
  await page.locator(".chat-tools").getByRole("button", { name: l.activity }).click();
  await page.locator(".log-list li").first().waitFor();
  issues.push(...(await audit(page, `${where} activity`)));
  await page.locator(".sidebar").getByRole("button", { name: l.chat }).click();
  await page.locator(".chat-tools").getByRole("button", { name: l.openAudit }).click();
  await page.locator(".audit-tr:not(.audit-th)").first().click();
  await page.locator(".audit-panel .audit-seen, .audit-panel .muted").first().waitFor();
  issues.push(...(await audit(page, `${where} audit`)));
  return issues;
}

/** The notes explorer opened, a note's history, a table with system columns, and Colecciones' usage. */
export async function notesAudit(
  page: Page,
  l: { notes: string; history: string; cols: string },
  where: string,
) {
  const issues: string[] = [];
  await page.locator(".sidebar").getByRole("button", { name: l.notes }).click();
  await page.locator(".notes-tree .notes-row").first().waitFor();
  for (const f of await page.locator(".notes-folder").all()) await f.click();
  issues.push(...(await audit(page, `${where} notes`)));
  // A note the fake server has as a row (the fixtures' Libros).
  await page.locator(".notes-tree .notes-row", { hasText: "plan-ejemplo" }).click();
  await page.getByRole("button", { name: l.history }).click();
  await page.locator(".history-panel .history-cols").waitFor();
  issues.push(...(await audit(page, `${where} history`)));
  await page.keyboard.press("Escape");
  await page.locator(".sidebar").getByRole("button", { name: l.cols }).click();
  await page.locator(".cols-usage .kpi").first().waitFor();
  issues.push(...(await audit(page, `${where} collections usage`)));
  return issues;
}
