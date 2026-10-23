import { expect, type Page, test } from "@playwright/test";
import {
  ASK_TURN,
  CARD_COMPACT,
  CARD_DETAILED,
  confirmTurn,
  EXTENSIONS,
  GUIDE,
  MAIL,
  MAIL_SUGGESTED,
  PROPOSALS,
  RUN_2,
  RUNS,
  TEXT_REPLY,
  VISIBILITY,
} from "./agent-scenarios.ts";
import { audit, settingsAudit } from "./audit.ts";
import { openApp } from "./fixtures.ts";

/**
 * Text fits its box, everywhere (Boni Calendar's rule): no control breaks its label over two lines and nothing
 * sticks out of a box that does not clip or scroll. Every surface (sidebar, top bar, cards and their controls,
 * floating boxes, side panel, settings, toast, a widget), in Spanish and English, at a normal and a narrow window.
 * A new surface must be added here.
 */

const L = {
  es: {
    period: "Periodo",
    filters: "Filtros",
    addFilter: "Añadir filtro",
    more: "Más",
    edit: /^Editar…/,
    settings: "Ajustes",
    pageMenu: "Más opciones",
    collections: "Colecciones",
  },
  en: {
    period: "Period",
    filters: "Filters",
    addFilter: "Add filter",
    more: "More",
    edit: /^Edit…/,
    settings: "Settings",
    pageMenu: "More options",
    collections: "Collections",
  },
};

for (const language of ["es", "en"] as const) {
  for (const width of [1440, 900]) {
    test(`every surface fits (${language}, ${width} px)`, async ({ page }) => {
      const l = L[language];
      await page.setViewportSize({ width, height: 860 });
      const issues: string[] = [];
      await openApp(page, "/?still", {
        language,
        agent: {
          "GET api/agent/visibility": [VISIBILITY],
          "GET api/mail": [MAIL_SUGGESTED],
          "GET api/mail/guide": [GUIDE],
          "GET api/agent/extensions": [EXTENSIONS],
        },
      });
      await expect(page.locator(".doc-charts .chart-card")).toHaveCount(3);
      await page.locator(".chart-card .chart svg").first().waitFor();
      issues.push(...(await audit(page, "home")));

      const card = page.locator(".doc-charts .chart-card").first();
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

      await page.locator(".doc-actions .btn.primary").click();
      await page.locator(".side-panel .form").waitFor();
      issues.push(...(await audit(page, "capture panel")));
      await page.keyboard.press("Escape");

      await card.hover();
      await card.getByRole("button", { name: l.more }).click();
      await page.getByRole("menuitemradio", { name: l.edit }).click();
      await page.locator(".side-panel .chart-options .opt-row").first().waitFor();
      issues.push(...(await audit(page, "editor panel")));
      await page.locator(".side-panel .opt-disclosure").click();
      await page.locator(".side-panel .opt-more .opt-value").first().click();
      issues.push(...(await audit(page, "editor style options")));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await page.locator(".doc-tail").click();
      await page.keyboard.type("/", { delay: 20 });
      await page.locator(".slash-menu").waitFor();
      issues.push(...(await audit(page, "block menu (/)")));
      await page.keyboard.press("Escape");
      const blk = page.locator(".blk-chart").first();
      await blk.hover();
      await blk.locator(".blk-handle button").click();
      issues.push(...(await audit(page, "block handle menu")));
      await page.keyboard.press("Escape");
      await page.locator(".topbar").getByRole("button", { name: l.pageMenu }).click();
      issues.push(...(await audit(page, "page menu")));
      await page.keyboard.press("Escape");
      await page.locator(".doc-tail").click();
      await page.keyboard.type("/libros", { delay: 15 });
      await page.keyboard.press("Enter");
      await page.locator(".db-table tbody tr").first().waitFor();
      issues.push(...(await audit(page, "database table")));
      await page.locator(".db-layout").nth(1).click();
      await page.locator(".db-column").first().waitFor();
      issues.push(...(await audit(page, "database board")));
      await page.locator(".db-layout").nth(4).click();
      await page.locator(".db-cal-grid").waitFor();
      issues.push(...(await audit(page, "database calendar")));
      await page.locator(".db .protect-pill").click();
      await page.locator(".protect-menu").waitFor();
      issues.push(...(await audit(page, "protection menu")));
      await page.keyboard.press("Escape");
      await page.locator(".sidebar").getByRole("button", { name: l.collections }).click();
      await page.locator(".cols-table").waitFor();
      issues.push(...(await audit(page, "collections")));
      await page.locator(".cols-table .protect-pill").nth(1).click();
      await page.locator(".protect-menu").waitFor();
      issues.push(...(await audit(page, "protection menu, locked")));
      await page.keyboard.press("Escape");
      await page.locator(".cols-name").first().click();
      await page.locator(".col-protect").waitFor();
      issues.push(...(await audit(page, "collection page")));

      await page.locator(".sidebar").getByRole("button", { name: l.settings }).click();
      await page.locator(".modal").waitFor();
      issues.push(...(await settingsAudit(page)));
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
    discard: "Descartar",
  },
  en: {
    more: /^More details/,
    menu: "Options of Café",
    edit: "Edit",
    charts: "Charts",
    chartMenu: "Chart options",
    settings: "Settings",
    discard: "Discard",
  },
};
test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  for (const language of ["es", "en"] as const) {
    test(`every phone surface fits (${language})`, async ({ page }) => {
      const l = P[language];
      const issues: string[] = [];
      await openApp(page, "/?still", {
        language,
        agent: {
          "GET api/agent/visibility": [VISIBILITY],
          "GET api/mail": [MAIL_SUGGESTED],
          "GET api/mail/guide": [GUIDE],
          "GET api/agent/extensions": [EXTENSIONS],
        },
      });
      await expect(page.locator(".m-shortcut")).toHaveCount(2);
      issues.push(...(await audit(page, "phone log")));
      await page.locator(".m-capture").tap();
      await page.getByRole("button", { name: l.more }).tap();
      issues.push(...(await audit(page, "phone form")));
      await page.locator(".m-sheet .form input").first().fill("12");
      await page.keyboard.press("Escape");
      await page.locator(".m-action-sheet").waitFor();
      issues.push(...(await audit(page, "phone discard question")));
      await page.getByRole("menuitem", { name: l.discard }).tap();
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
      await page.locator(".m-sheet .chart-options .opt-row").first().waitFor();
      issues.push(...(await audit(page, "phone chart editor")));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: l.settings }).tap();
      await page.locator(".modal").waitFor();
      issues.push(...(await settingsAudit(page, "phone ")));
      expect(issues).toEqual([]);
    });
  }
});

/** The conversation with the agent: a reply, a question, a confirmation, the inbox and the log. */
const AGENT = {
  "POST api/agent/turn": [TEXT_REPLY, ASK_TURN, confirmTurn("c1")],
  "GET api/agent/proposals": [{ proposals: [...PROPOSALS.proposals, CARD_DETAILED, CARD_COMPACT] }],
  "GET api/agent/runs": [RUNS],
  "GET api/agent/runs/:id": [RUN_2],
};
const C = {
  es: {
    chat: "Conversación",
    box: "Escribe a Boni…",
    inbox: /^Bandeja/,
    log: "Registro",
    tab: "Boni",
  },
  en: {
    chat: "Conversation",
    box: "Write to Boni…",
    inbox: /^Inbox/,
    log: "Activity",
    tab: "Boni",
  },
};
async function converse(page: Page, l: (typeof C)["es"], issues: string[], where: string) {
  for (const text of ["uno", "dos", "tres"]) {
    const box = page.getByRole("textbox", { name: l.box });
    await box.fill(text);
    await box.press("Enter");
    await expect(page.locator(".turn")).toHaveCount(["uno", "dos", "tres"].indexOf(text) + 1);
    await expect(page.locator(".turn-answer").last()).not.toBeEmpty();
  }
  await page.locator(".confirm-card").waitFor();
  issues.push(...(await audit(page, `${where} conversation`)));
  await page.locator(".chat-tools").getByRole("button", { name: l.inbox }).click();
  await page.locator(".proposal").first().waitFor();
  issues.push(...(await audit(page, `${where} inbox`)));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: l.log }).click();
  await page.locator(".log-list li").first().waitFor();
  await page.locator(".log-list li").nth(1).locator(".log-head").click();
  await page.locator(".log-step").first().waitFor();
  issues.push(...(await audit(page, `${where} log`)));
  if (where !== "phone") {
    // The inbox as a panel on the right, its cards opened and closed.
    await page.locator(".topbar").getByRole("button", { name: l.inbox }).click();
    await page.locator(".inbox-panel .inbox-card").first().waitFor();
    issues.push(...(await audit(page, `${where} inbox panel`)));
    await page.locator(".inbox-panel .inbox-card.compact .inbox-more").first().click();
    issues.push(...(await audit(page, `${where} inbox panel opened`)));
    // A proposal on its own page.
    await page.locator(".inbox-panel .inbox-card.detailed .inbox-open").first().click();
    await page.locator(".proposal-page .pp-title").waitFor();
    issues.push(...(await audit(page, `${where} proposal page`)));
  }
}
for (const language of ["es", "en"] as const) {
  for (const width of [1440, 900]) {
    test(`the conversation fits (${language}, ${width} px)`, async ({ page }) => {
      const l = C[language];
      const issues: string[] = [];
      await page.setViewportSize({ width, height: 860 });
      await openApp(page, "/?still", { language, agent: AGENT });
      await page.getByRole("button", { name: l.chat }).click();
      await converse(page, l, issues, `${width}`);
      expect(issues).toEqual([]);
    });
  }
  test(`the conversation fits on a phone (${language})`, async ({ page }) => {
    const l = C[language];
    const issues: string[] = [];
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page, "/?still", { language, agent: AGENT });
    await page.getByRole("button", { name: l.tab, exact: true }).click();
    await converse(page, l, issues, "phone");
    expect(issues).toEqual([]);
  });
}
