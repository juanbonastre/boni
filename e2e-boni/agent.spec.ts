import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  ANSWER_GONE,
  ASK_TURN,
  CARD_COMPACT,
  CARD_DETAILED,
  CHART_REPLY,
  confirmTurn,
  DONE,
  EXTENSION_PROPOSALS,
  EXTENSIONS,
  GUIDE,
  LIVE_STEPS,
  MAIL,
  MAIL_SUGGESTED,
  PROPOSALS,
  REQUESTS,
  RTL,
  RUN_2,
  RUNS,
  RUNS_EXPLAINED,
  STOPPED,
  TEXT_REPLY,
  VISIBILITY,
} from "./agent-scenarios.ts";
import { emit, openApp, recorded } from "./fixtures.ts";

/** A request as sent, without the live id the device made for it (a new one every time). */
const withoutLive = (r: string) => r.replace(/,"live":"[0-9a-f-]+"/, "");

/**
 * The conversation with the agent (docs/nucleo.md, 7.14): painted by the code, text from outside only as text,
 * confirmations with the real values and their warnings, the inbox one proposal at a time, the log with Undo.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const requests = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

async function ask(page: Page, text: string) {
  await page.getByRole("button", { name: /^Conversación/ }).click();
  const box = page.getByRole("textbox", { name: "Escribe a Boni…" });
  await box.fill(text);
  await box.press("Enter");
}

test("a reply is painted by the code, and what came from outside is only text", async ({
  page,
}) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("evil.example") || r.url().endsWith("/x")) outside.push(r.url());
  });
  await openApp(page, "/?still", {
    agent: { "POST api/agent/turn": [TEXT_REPLY], "GET api/agent/proposals": [PROPOSALS] },
  });
  await ask(page, "resume el último correo");
  const answer = page.locator(".turn-answer").first();
  await expect(answer).toContainText("Resumen del correo:");
  // The e-mail's HTML is shown as the text it is: no script ran, no image, no link, nothing loaded.
  await expect(answer.locator(".val-ext")).toContainText("<script>window.__pwned = 1</script>");
  await expect(answer.locator(".val-ext")).toContainText("![x](https://evil.example/p.png?q=1)");
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  await expect(page.locator(".chat img, .chat a, .chat script")).toHaveCount(0);
  expect(outside).toEqual([]);
  await expect(answer.locator(".reply-figure")).toContainText("42,5");
  // The proposal it made waits in the inbox, and the sidebar counts it.
  await expect(answer.getByRole("button", { name: "1 propuesta en la bandeja" })).toBeVisible();
  await expect(
    page.locator(".nav-row", { hasText: "Conversación" }).locator(".nav-count"),
  ).toHaveText("2");
  const sent = await requests(page, "POST api/agent/turn ");
  expect(JSON.parse(sent[0]?.split(" ").slice(2).join(" ") ?? "{}")).toMatchObject({
    text: "resume el último correo",
  });
  await page.screenshot({ path: `${SHOTS}/agent-reply.png` });
});

test("a turn in Juan's words: each step says what it does, on what and what it found; numbers to compare are a chart", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    turnMs: 1500,
    agent: {
      "POST api/agent/turn": [CHART_REPLY],
      "GET api/agent/live/:id": [
        { events: LIVE_STEPS, done: false },
        { events: [], done: false },
      ],
    },
  });
  await ask(page, "¿cuántas tareas tengo por prioridad?");
  // While it runs: each step by the names Juan gave things, and what it found once done.
  const going = page.locator(".turn-steps:not(.folded)");
  await expect(going).toContainText("Mirando tus colecciones");
  await expect(going.locator("li").nth(1)).toHaveText("Contando en Tareas · Prioridad: Alta · 3");
  await expect(going.locator("li").nth(2)).toHaveText(
    "Buscando «azulejos» en Tareas · 1 resultado",
  );
  // A checkbox's value in words, not as the code writes it.
  await expect(going.locator("li").nth(3)).toHaveText("Contando en Tareas · Hecha: no · 6");
  // Its answer: a sentence first, then a bar for each number, with its label and its value.
  const answer = page.locator(".turn-answer").first();
  await expect(answer.locator(".reply-text")).toHaveText(
    "Tienes 6 tareas sin hacer; la mayoría, de prioridad alta.",
  );
  await expect(answer.locator(".reply-caption")).toHaveText("Tareas por prioridad");
  await expect(answer.locator(".reply-bars li")).toHaveText(["Alta3", "Media2", "Baja1"]);
  // It only counted: no «Deshacer lo que hizo».
  await expect(answer.getByRole("button", { name: "Deshacer lo que hizo" })).toHaveCount(0);
  // The steps fold once it answered, and keep what each found.
  await answer.getByRole("button", { name: "Pasos (4)" }).click();
  await expect(answer.locator(".turn-steps li").nth(1)).toHaveText(
    "Contando en Tareas · Prioridad: Alta · 3",
  );
  await page.screenshot({ path: `${SHOTS}/agent-words-chart.png` });
});

test("a slow look at a turn still going never shows its steps twice", async ({ page }) => {
  // The turn answers while a look is on its way: the last look starts after it, from where it ended.
  await openApp(page, "/?still", {
    turnMs: 500,
    live: { events: LIVE_STEPS, ms: 300 },
    agent: { "POST api/agent/turn": [CHART_REPLY] },
  });
  await ask(page, "¿cuántas tareas tengo por prioridad?");
  const answer = page.locator(".turn-answer").first();
  await answer.getByRole("button", { name: "Pasos (4)" }).click();
  await expect(answer.locator(".turn-steps li")).toHaveCount(4);
});

test("a confirmation shows the real values with their origin and warnings; its button changes side", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "POST api/agent/turn": [confirmTurn("c1"), confirmTurn("c2")],
      "POST api/agent/confirm": [DONE],
      "POST api/agent/decline": [{ ...DONE, status: "stopped", replies: [], error: "declined" }],
    },
  });
  await ask(page, "escribe a Ana: factura");
  const card = page.locator(".confirm-card").first();
  await expect(card.getByRole("heading")).toHaveText("¿Enviar correo?");
  await expect(card).toContainText("Para");
  // The hidden characters are made visible and named; the international domain is shown for what it is.
  await expect(card).toContainText(`pago⟦U+202E⟧gnp.exe y⟦U+200B⟧más`);
  await expect(card).not.toContainText(`pago${RTL}`);
  await expect(card).toContainText("Mezcla alfabetos");
  await expect(card).toContainText("Dominio internacional: en realidad es xn--exmple-qta.com");
  await expect(card).toContainText("cambian la dirección del texto");
  await expect(card).toContainText("Viene de fuera · un correo");
  await page.screenshot({ path: `${SHOTS}/agent-confirm.png` });
  // Not accepted out of habit: the button waits a moment, then the confirmation goes once.
  const accept = card.getByRole("button", { name: "Sí, enviar correo" });
  await expect(accept).toBeDisabled();
  await expect(accept).toBeEnabled();
  const firstOrder = await card.locator(".confirm-actions button").allTextContents();
  await accept.click();
  await expect(page.locator(".turn-answer").first()).toContainText("Hecho.");
  // Its live id is the device's own (docs/conversacion.md 3.5): any, once.
  expect((await requests(page, "POST api/agent/confirm ")).map(withoutLive)).toEqual([
    'POST api/agent/confirm {"run":"run-c1","confirmation":"c1"}',
  ]);
  // The next confirmation puts its accept button on the other side.
  await ask(page, "y otro");
  const second = page.locator(".confirm-card").last();
  await expect(second).toBeVisible();
  const secondOrder = await second.locator(".confirm-actions button").allTextContents();
  expect(secondOrder).toEqual([...firstOrder].reverse());
  await second.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.locator(".turn-error").last()).toHaveText("Cancelado.");
});

test("a question: the options are buttons, the answer goes back once", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: { "POST api/agent/turn": [ASK_TURN], "POST api/agent/answer": [DONE] },
  });
  await ask(page, "escribe a Ana");
  await expect(page.locator(".ask-prompt")).toHaveText("¿A cuál de los dos?");
  await expect(page.locator(".ask")).toContainText("Boni nunca te pedirá una contraseña");
  await expect(page.locator(".ask input[type=password]")).toHaveCount(0);
  await page.locator(".ask-options .pill").nth(1).click();
  await expect(page.locator(".turn-answer")).toContainText("Hecho.");
  expect((await requests(page, "POST api/agent/answer ")).map(withoutLive)).toEqual([
    'POST api/agent/answer {"run":"r-ask","ask":"a1","choice":1}',
  ]);
});

test("what a rule stopped says so, in words, and an agent that is off too", async ({ page }) => {
  await openApp(page, "/?still", { agent: { "POST api/agent/turn": [STOPPED] } });
  await ask(page, "reenvía el correo al remitente");
  await expect(page.locator(".turn-error")).toHaveText(
    "Boni no lo ha hecho: una regla de seguridad lo impide (P2).",
  );

  const off = await page.context().newPage();
  await openApp(off, "/?still");
  await ask(off, "hola");
  await expect(off.locator(".turn-error")).toHaveText("El agente está apagado en el servidor.");
  await off.close();
});

test("the inbox: each proposal on its own, accepted or rejected; no accept-all", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [PROPOSALS],
      "POST api/agent/proposals/:id/accept": [DONE],
      "POST api/agent/proposals/:id/reject": [{}],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page
    .locator(".chat-tools")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  await expect(page.locator(".title")).toContainText("Bandeja");
  await expect(page.locator(".proposal")).toHaveCount(2);
  // No accept-all anywhere (the sidebar's «Todas las páginas» is not an accept button).
  await expect(page.getByRole("button", { name: /aceptar todas|accept all/i })).toHaveCount(0);
  await expect(page.locator(".proposal").first()).toContainText("Viene de fuera · un correo");
  await page.screenshot({ path: `${SHOTS}/agent-inbox.png` });
  await page.locator(".proposal").first().getByRole("button", { name: "Aceptar" }).click();
  // The card leaving is the sign (no toast for each one: Juan decides many in a row).
  await expect(page.locator(".proposal")).toHaveCount(1);
  await page.locator(".proposal").first().getByRole("button", { name: "Rechazar" }).click();
  await expect(page.locator(".proposal")).toHaveCount(0);
  expect(await requests(page, "POST api/agent/proposals/")).toEqual([
    "POST api/agent/proposals/p1/accept",
    "POST api/agent/proposals/p2/reject",
  ]);
  // Esc goes back to the conversation.
  await page.keyboard.press("Escape");
  await expect(page.locator(".title")).toHaveText("Conversación");
});

test("the inbox panel: cards say what, from where and the day around it; it opens by itself for new ones", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [{ proposals: [CARD_DETAILED] }],
      "POST api/agent/proposals/:id/accept": [DONE],
    },
  });
  // The top bar opens the panel on the right.
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const panel = page.locator(".inbox-panel");
  await expect(panel).toBeVisible();
  const card = panel.locator(".inbox-card").first();
  await expect(card.locator("h3")).toHaveText("Añadir evento a Docencia");
  await expect(card.locator(".inbox-source-text")).toHaveText(
    "ejemplo@example.edu · Coordinación de ejemplo",
  );
  await expect(card).not.toContainText("Viene de fuera");
  // Detailed (the first from that sender): the mail's words and one day, the proposal dashed among the rest.
  await expect(card.locator(".inbox-quote")).toContainText("antes del jueves");
  await expect(card.locator(".mini-day")).toHaveCount(1);
  const items = card.locator(".mini-day .mini-item");
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toHaveClass(/proposed/);
  await expect(items.nth(1)).toContainText("12:00");
  await page.screenshot({ path: `${SHOTS}/inbox-panel.png` });
  // A new one arrives (compact: it happened before): the panel shows it with three days.
  await page.locator(".inbox-panel .panel-head").getByRole("button").click();
  await expect(panel).toHaveCount(0);
  await page.evaluate(
    (p) => (window as unknown as { __pushProposal: (p: unknown) => void }).__pushProposal(p),
    CARD_COMPACT,
  );
  await emit(page, { type: "tick", minute: 1 });
  await expect(panel).toBeVisible();
  const compact = panel.locator(".inbox-card", { hasText: "Enviar notas" });
  await expect(compact).toHaveClass(/compact/);
  await expect(compact.locator(".mini-day")).toHaveCount(3);
  await expect(compact.locator(".inbox-quote")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/inbox-panel-compact.png` });
  await compact.getByRole("button", { name: "Más detalles" }).click();
  await expect(compact.locator(".inbox-quote")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/inbox-panel-two.png` });
  await compact.getByRole("button", { name: "Aceptar" }).click();
  await expect(panel.locator(".inbox-card")).toHaveCount(1);
  // The inbox's own page has more room: a detailed card from mail in two columns, the mail and the three days.
  await page.locator(".inbox-panel .panel-head").getByRole("button").click();
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page
    .locator(".chat-tools")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const wide = page.locator(".agent-page .inbox-card.two");
  await expect(wide).toHaveCount(1);
  await expect(wide.locator(".inbox-col").nth(0).locator(".inbox-quote")).toContainText(
    "antes del jueves",
  );
  await expect(wide.locator(".inbox-col").nth(1).locator(".mini-day")).toHaveCount(3);
  await page.screenshot({ path: `${SHOTS}/inbox-page-two-columns.png` });
});

test("a proposal opens on a page of its own: its values, why, where from, and the mail itself", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [{ proposals: [CARD_DETAILED] }],
      "POST api/agent/proposals/:id/reject": [{}],
    },
  });
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const card = page.locator(".inbox-panel .inbox-card").first();
  // The card says why (the mail's words) and can show the mail.
  await expect(card.locator(".inbox-why")).toHaveText(
    "Por qué: «antes del jueves revisad las actas»",
  );
  await expect(card.getByRole("button", { name: "Ver correo" })).toBeVisible();
  await card.getByRole("button", { name: "Abrir propuesta" }).click();
  const pp = page.locator(".proposal-page");
  await expect(pp.locator(".pp-title")).toHaveText("Revisar actas");
  await expect(pp.locator(".pp-kind")).toContainText("Añadir evento a Docencia");
  // Every value, the title and the day too; why; where from with the mail; the days around it.
  await expect(pp.locator(".inbox-fields")).toContainText("Revisar actas");
  await expect(pp.locator(".inbox-fields")).toContainText("Fecha");
  await expect(pp.locator(".pp-why")).toHaveText("«antes del jueves revisad las actas»");
  await expect(pp.locator(".inbox-subject")).toHaveText("Actas pendientes");
  await expect(pp.locator(".mini-day")).toHaveCount(3);
  await page.locator(".inbox-panel .panel-head").getByRole("button").click();
  await page.screenshot({ path: `${SHOTS}/proposal-page.png` });
  // "Ver correo" opens the mail's row in Boni; back, Esc returns to where it was opened from.
  await pp.getByRole("button", { name: "Ver correo" }).click();
  await expect(page.locator(".row-doc .doc-title")).toContainText("Rayuela");
  await expect(page.locator(".proposal-page")).toHaveCount(0);
  // From its page, rejecting it goes back.
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  await page
    .locator(".inbox-panel .inbox-card")
    .first()
    .getByRole("button", { name: "Abrir propuesta" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".proposal-page")).toHaveCount(0);
  await page
    .locator(".inbox-panel .inbox-card")
    .first()
    .getByRole("button", { name: "Abrir propuesta" })
    .click();
  await page.locator(".proposal-page").getByRole("button", { name: "Rechazar" }).click();
  await expect(page.locator(".proposal-page")).toHaveCount(0);
  expect(
    (await recorded(page)).requests.some((r) => r.startsWith("POST api/agent/proposals/c1/reject")),
  ).toBe(true);
});

test("a card can be corrected before accepting: its title and its collection go with the acceptance", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [{ proposals: [CARD_DETAILED] }],
      "POST api/agent/proposals/:id/accept": [DONE],
    },
  });
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const card = page.locator(".inbox-panel .inbox-card").first();
  await card.getByRole("button", { name: "Corregir" }).click();
  const form = card.locator(".inbox-correct");
  await expect(form.getByLabel("Título")).toHaveValue("Revisar actas");
  await expect(form.getByLabel("Colección")).toHaveValue("t_docencia");
  await form.getByLabel("Título").fill("Revisar las actas de FUP 1");
  await form.getByLabel("Colección").selectOption({ label: "Libros" });
  await expect(form).toContainText("aprende");
  await page.screenshot({ path: `${SHOTS}/inbox-correct.png` });
  await card.getByRole("button", { name: "Aceptar" }).click();
  await expect(page.locator(".toast")).toContainText("Boni aprenderá");
  const sent = (await recorded(page)).requests.find((r) =>
    r.startsWith("POST api/agent/proposals/c1/accept"),
  );
  expect(sent).toContain(
    JSON.stringify({ edits: { title: "Revisar las actas de FUP 1", collection: "t_libro" } }),
  );
});

test("«Ya lo hice» saves a task already done; a card Boni would have accepted says so, and the Registro how often", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    acceptMs: 800,
    agent: {
      "GET api/agent/proposals": [
        {
          proposals: [
            {
              ...CARD_DETAILED,
              card: { ...CARD_DETAILED.card, canMarkDone: true, wouldAccept: true },
            },
          ],
        },
      ],
      "POST api/agent/proposals/:id/accept": [DONE],
      "GET api/agent/runs": [
        { ...RUNS_EXPLAINED, autoAccept: { decided: 60, would: 14, right: 13 } },
      ],
    },
  });
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const card = page.locator(".inbox-panel .inbox-card").first();
  await expect(card.locator(".would-accept")).toHaveText("Boni la habría aceptado");
  await page.screenshot({ path: `${SHOTS}/inbox-done.png` });
  await card.getByRole("button", { name: "Ya lo hice" }).click();
  await expect(card.getByRole("button", { name: "Apuntando como hecha…" })).toBeVisible();
  await expect(page.locator(".toast")).toContainText("Apuntada como hecha");
  await expect(page.locator(".inbox-panel .inbox-card")).toHaveCount(0);
  const sent = (await recorded(page)).requests.find((r) =>
    r.startsWith("POST api/agent/proposals/c1/accept"),
  );
  expect(sent).toContain(JSON.stringify({ edits: { done: true } }));
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await expect(page.locator(".log-measure")).toHaveText(
    "De tus últimas 60 decisiones sobre correos, Boni habría aceptado sola 14 y habría acertado en 13.",
  );
});

test("without a task column there is no «Ya lo hice», and no mark when Boni would not accept it", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: { "GET api/agent/proposals": [{ proposals: [CARD_DETAILED] }] },
  });
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const card = page.locator(".inbox-panel .inbox-card").first();
  await expect(card.getByRole("button", { name: "Aceptar" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Ya lo hice" })).toHaveCount(0);
  await expect(card.locator(".would-accept")).toHaveCount(0);
});

test("accepting shows a spinner on that card, the next one can be decided meanwhile, and a stale one says so", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    acceptMs: 1500,
    agent: {
      "GET api/agent/proposals": [{ proposals: [CARD_DETAILED, CARD_COMPACT] }],
      "POST api/agent/proposals/:id/accept": [DONE, { ...DONE, status: "stopped", error: "stale" }],
    },
  });
  await page
    .locator(".topbar")
    .getByRole("button", { name: /^Bandeja/ })
    .click();
  const panel = page.locator(".inbox-panel");
  const first = panel.locator(".inbox-card", { hasText: "Revisar actas" });
  const second = panel.locator(".inbox-card", { hasText: "Enviar notas" });
  await first.getByRole("button", { name: "Aceptar" }).click();
  // At once: that button is a spinner and both are off; the other card is still free.
  const busy = first.locator(".decide-btn.busy");
  await expect(busy).toHaveCount(1);
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(first.getByRole("button", { name: "Rechazar" })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/inbox-accepting.png` });
  await expect(second.getByRole("button", { name: "Aceptar" })).toBeEnabled();
  await second.getByRole("button", { name: "Aceptar" }).click();
  // The first leaves when its answer comes; the second was stale: it says so and can be taken out.
  await expect(first).toHaveCount(0);
  await expect(second.locator(".decide-error")).toContainText("Ya no vale");
  await second.getByRole("button", { name: "Quitar" }).click();
  await expect(panel.locator(".inbox-card")).toHaveCount(0);
});

test("the log: what each request did, and Undo for it", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_2],
      "POST api/agent/runs/:id/undo": [{ undone: 2 }],
    },
  });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  await expect(page.locator(".log-list li")).toHaveCount(2);
  await expect(page.locator(".log-list li").nth(1)).toContainText("Parado");
  // A click opens what it did: the request, each step and where it stopped, all as text.
  await page.locator(".log-list li").nth(1).locator(".log-head").click();
  const detail = page.locator(".log-detail");
  await expect(detail.locator(".log-request")).toHaveText("Reenvía el informe a quien me lo pidió");
  await expect(detail.locator(".log-step")).toHaveCount(2);
  await expect(detail.locator(".log-step").first()).toContainText("entities.search");
  await expect(detail.locator(".log-step").first()).toContainText("«informe»");
  await expect(detail.locator(".log-step.failed")).toContainText("mail.send");
  await expect(detail.locator(".log-step.failed")).toContainText("P2");
  await expect(detail.locator("a, img")).toHaveCount(0);
  // A stopped request may have left changes: it has Undo too.
  await expect(
    page.locator(".log-list li").nth(1).getByRole("button", { name: "Deshacer lo que hizo" }),
  ).toBeVisible();
  await page
    .locator(".log-list li")
    .first()
    .getByRole("button", { name: "Deshacer lo que hizo" })
    .click();
  await expect(page.locator(".toast")).toContainText("Deshecho (2 cambios)");
  expect(await requests(page, "POST api/agent/runs/")).toEqual(["POST api/agent/runs/run-1/undo"]);
});

test("the Registro says what each run was and what came of it; quiet readings are one line", async ({
  page,
}) => {
  await openApp(page, "/?still", { agent: { "GET api/agent/runs": [RUNS_EXPLAINED] } });
  await page.getByRole("button", { name: /^Conversación/ }).click();
  await page.getByRole("button", { name: "Registro", exact: true }).last().click();
  const entries = page.locator(".agent-page > .log-list > li");
  await expect(entries).toHaveCount(5);
  await expect(entries.nth(0)).toContainText("«Apunta una tarea: llamar al taller el lunes»");
  await expect(entries.nth(0)).toContainText("Creó «Llamar al taller» en Tareas");
  // A mail's subject is outside text: shown as typed, never as markup.
  await expect(entries.nth(1).locator(".log-title")).toHaveText(
    "Correo «<b>Actas</b> de la reunión inventada del departamento con un asunto muy largo que no cabe»",
  );
  await expect(entries.nth(1).locator("b")).toHaveCount(0);
  await expect(entries.nth(1)).toContainText("de Coordinación de ejemplo");
  await expect(entries.nth(1)).toContainText("1 propuesta pendiente · 1 propuesta aceptada");
  // Three mails with nothing to do: one line, opened on a click.
  await expect(entries.nth(2)).toContainText("3 lecturas sin nada que hacer");
  await expect(entries.nth(2).locator(".log-group")).toHaveCount(0);
  await entries.nth(2).locator(".log-head").first().click();
  await expect(entries.nth(2).locator(".log-group > li")).toHaveCount(3);
  await expect(entries.nth(2).locator(".log-group")).toContainText("Nada que hacer");
  // A run of the retired Markdown mirror: named by its origin, never by a vault path (I-08, D-17).
  await expect(entries.nth(3)).toContainText("Cambio en Obsidian");
  await expect(entries.nth(3)).not.toContainText(".md");
  await expect(entries.nth(3)).toContainText("1 propuesta rechazada");
  await expect(entries.nth(4)).toContainText("Creó «Revisar actas» en Docencia (deshecho)");
  // Undo only where something is left to undo.
  const undo = page.getByRole("button", { name: "Deshacer lo que hizo" });
  await expect(undo).toHaveCount(1);
  await expect(entries.nth(0).getByRole("button", { name: "Deshacer lo que hizo" })).toBeVisible();
  await page.screenshot({ path: "e2e-boni/screenshots/registro.png" });
});

test("what the AI sees: Juan chooses per collection in Settings", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/visibility": [VISIBILITY],
      "PUT api/agent/visibility/:type": [{ id: "t_proyecto", level: "restricted" }],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  // Settings open on the account; each section is one tab.
  await expect(modal.getByRole("tab", { name: "Cuenta" })).toHaveAttribute("aria-selected", "true");
  await modal.getByRole("tab", { name: "Lo que ve la IA" }).click();
  await expect(modal.getByRole("heading", { name: "Lo que ve la IA" })).toBeVisible();
  const row = (name: string) => modal.getByRole("combobox", { name });
  await expect(row("Diario")).toHaveValue("restricted");
  await expect(row("Movimientos")).toHaveValue("opaque");
  await row("Proyectos").selectOption("restricted");
  await expect(row("Proyectos")).toHaveValue("restricted");
  expect(await requests(page, "PUT api/agent/visibility")).toEqual([
    'PUT api/agent/visibility/t_proyecto {"level":"restricted"}',
  ]);
  await page.screenshot({ path: `${SHOTS}/agent-visibility.png` });

  // With the agent off it says so, and offers nothing to change.
  const off = await page.context().newPage();
  await openApp(off, "/?still");
  await off.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  await off.locator(".modal").getByRole("tab", { name: "Lo que ve la IA" }).click();
  await expect(off.locator(".modal")).toContainText("El agente está apagado en el servidor.");
  await expect(off.locator(".modal").getByRole("combobox")).toHaveCount(0);
  await off.close();
});

test("on the phone, Boni is the third tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, "/?still", { agent: { "POST api/agent/turn": [TEXT_REPLY] } });
  await page.getByRole("button", { name: "Boni" }).click();
  await expect(page.locator(".m-title")).toHaveText("Boni");
  const box = page.getByRole("textbox", { name: "Escribe a Boni…" });
  await box.fill("resume el último correo");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.locator(".turn-answer")).toContainText("Gastado este mes");
  await page.screenshot({ path: `${SHOTS}/agent-phone.png` });
});

test("the mailbox in Settings: a wrong password is said, a good one connects; collections and check", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/visibility": [VISIBILITY],
      "GET api/mail": [{ mail: null }],
      "PUT api/mail": [{ __status: 400, error: "auth" }, MAIL, MAIL],
      "POST api/mail/check": [MAIL],
      "POST api/mail/reread": [{ mails: 4, withdrawn: 6 }],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  await modal.getByRole("tab", { name: "Correo" }).click();
  await expect(modal.getByRole("heading", { name: "Correo" })).toBeVisible();
  await modal.getByLabel("Usuario", { exact: true }).last().fill("ejemplo@example.com");
  await modal.getByLabel("Contraseña de aplicación").fill("mala");
  await modal.getByRole("button", { name: "Conectar" }).click();
  await expect(modal.locator(".form-error")).toHaveText(
    "El servidor no acepta el usuario o la contraseña.",
  );
  await modal.getByLabel("Contraseña de aplicación").fill("abcdabcdabcdabcd");
  await modal.getByRole("button", { name: "Conectar" }).click();
  await expect(modal).toContainText("Conectado: ejemplo@example.com");
  await expect(modal).toContainText("12 correos");
  // The groups start closed, each with what is inside in one line.
  const collections = modal.getByRole("button", { name: /Colecciones de destino/ });
  await expect(collections).toHaveAttribute("aria-expanded", "false");
  await expect(collections).toContainText("Proyectos");
  await collections.click();
  // The mail collection itself is never a destination; hidden collections are not offered.
  await expect(modal.getByRole("checkbox", { name: "Proyectos" })).toBeChecked();
  await expect(modal.getByRole("checkbox", { name: "Diario" })).toHaveCount(0);
  await modal.getByRole("checkbox", { name: "Movimientos" }).check();
  await modal.getByRole("button", { name: "Comprobar ahora" }).click();
  const puts = await requests(page, "PUT api/mail");
  expect(puts[0]).toContain('"password":"mala"');
  expect(puts[2]).toContain('"collections":["t_proyecto","t_movimiento"]');
  expect(puts[2]).not.toContain("password");
  expect(await requests(page, "POST api/mail/check")).toHaveLength(1);
  // Read again the last days' mail (under "Más opciones"): the days chosen go to the server, a toast
  // says how many.
  await expect(modal.getByLabel("Días")).toHaveCount(0);
  await modal.getByRole("button", { name: "Más opciones" }).click();
  await modal.getByLabel("Días").selectOption("14");
  await modal.getByRole("button", { name: "Leer", exact: true }).click();
  await expect(page.getByText("Correos que se vuelven a leer: 4")).toBeVisible();
  expect(await requests(page, "POST api/mail/reread")).toEqual([
    'POST api/mail/reread {"days":14}',
  ]);
  await page.screenshot({ path: `${SHOTS}/agent-mail-settings.png` });
});

test("the reading guide: his words saved, rules added and removed, examples only removed", async ({
  page,
}) => {
  const saved = {
    guide: { ...GUIDE.guide, instructions: "Solo lo que me pidan a mí." },
  };
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/visibility": [VISIBILITY],
      "GET api/mail": [MAIL],
      "GET api/mail/guide": [GUIDE],
      "PUT api/mail/guide": [
        saved,
        { __status: 400, error: "bad-rule" },
        {
          guide: {
            ...saved.guide,
            rules: [...saved.guide.rules, { id: "r3", from: "@x.example.com", action: "skip" }],
          },
        },
        { guide: { ...saved.guide, examples: [] } },
      ],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  await modal.getByRole("tab", { name: "Correo" }).click();
  const guideHead = modal.getByRole("button", { name: /Guía de lectura/ });
  await expect(guideHead).toContainText("Con indicaciones · Reglas: 2 · Ejemplos: 1");
  await guideHead.click();
  const text = modal.locator("#mail-guide-text");
  await expect(text).toHaveValue(GUIDE.guide.instructions);
  await expect(modal).toContainText("@lista.example.com");
  await expect(modal).toContainText("No leer nunca");
  await expect(modal).toContainText("Siempre a Proyectos");
  await expect(modal).toContainText("Confirmar la sala a Lucía");
  await text.fill("Solo lo que me pidan a mí.");
  await modal.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Guía guardada")).toBeVisible();
  // A wrong sender is said; a good one is added.
  await modal.getByLabel("Dirección o @dominio").fill("nadie");
  await modal.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(modal.locator(".form-error")).toContainText("Escribe una dirección");
  await modal.getByLabel("Dirección o @dominio").fill("@x.example.com");
  await modal.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(modal).toContainText("@x.example.com");
  // The example is removed by keeping the others (none).
  await modal.getByRole("button", { name: "Quitar" }).last().click();
  await expect(modal).not.toContainText("Confirmar la sala a Lucía");
  const puts = await requests(page, "PUT api/mail/guide");
  expect(puts[0]).toContain('"instructions":"Solo lo que me pidan a mí."');
  expect(puts[2]).toContain('"from":"@x.example.com","action":"skip"');
  expect(puts[3]).toContain('"keepExamples":[]');
  await modal.locator("#mail-guide-text").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/agent-mail-guide.png` });
});

test("the reviewer's suggestion: measured, shown with what it changes, added only when Juan says", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/visibility": [VISIBILITY],
      "GET api/mail": [MAIL_SUGGESTED],
      "GET api/mail/guide": [GUIDE],
      "POST api/mail/suggestion": [
        {
          guide: {
            ...GUIDE.guide,
            rules: [...GUIDE.guide.rules, MAIL_SUGGESTED.mail.state.suggestion.rules[0]],
          },
          mail: MAIL.mail,
        },
      ],
      "POST api/mail/review": [MAIL],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  await modal.getByRole("tab", { name: "Correo" }).click();
  // The guide's group opens by itself when a suggestion waits.
  const card = modal.getByRole("group", { name: "Sugerencia de la revisora" });
  await expect(card).toContainText("acertaría 37 de tus últimas 40 decisiones (ahora 31)");
  await expect(card).toContainText("@boletines.example.com: No leer nunca");
  await expect(card).toContainText("Ejemplo «Feria de empleo»: Nada que proponer");
  await page.screenshot({ path: `${SHOTS}/agent-mail-suggestion.png` });
  await card.getByRole("button", { name: "Añadir a la guía" }).click();
  await expect(card).toHaveCount(0);
  await expect(modal).toContainText("@boletines.example.com");
  expect(await requests(page, "POST api/mail/suggestion")).toEqual([
    'POST api/mail/suggestion {"id":"g-1","accept":true}',
  ]);
  // Review now with nothing clear: it says so.
  await modal.getByRole("button", { name: "Revisar ahora" }).click();
  await expect(page.getByText("Nada claro que sugerir por ahora")).toBeVisible();
});

test("extensions in Settings: what each does, on or off, and what it uses", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/visibility": [VISIBILITY],
      "GET api/agent/extensions": [EXTENSIONS],
      "PUT api/agent/extensions/:id": [{ id: "correo", enabled: false }],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  await modal.getByRole("tab", { name: "Extensiones" }).click();
  await expect(modal.getByRole("checkbox", { name: "Correo" })).toBeChecked();
  await expect(modal.getByRole("checkbox", { name: "Plazos de los documentos" })).not.toBeChecked();
  // What it uses stays one click away, with whether it is still as it came.
  const uses = modal.getByRole("button", { name: /Qué usa/ }).first();
  await expect(uses).toContainText("Viene con Boni (versión 1)");
  await uses.click();
  await expect(modal).toContainText("Trae datos de: un buzón de correo (IMAP)");
  await expect(modal).toContainText("Busca: tareas, citas y eventos");
  await expect(modal).toContainText("Como mucho 150 lecturas de la IA al día");
  await modal.getByRole("checkbox", { name: "Correo" }).uncheck();
  await page.waitForTimeout(300);
  await expect(modal.getByRole("checkbox", { name: "Correo" })).not.toBeChecked();
  expect(await requests(page, "PUT api/agent/extensions")).toEqual([
    'PUT api/agent/extensions/correo {"enabled":false}',
  ]);
  await page.screenshot({ path: `${SHOTS}/agent-extensions.png` });
});

test("an extension proposed through the MCP: its card says what it asks for; Juan activates it, or goes back to the version before", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/visibility": [VISIBILITY],
      "GET api/agent/extensions": [
        {
          extensions: EXTENSIONS.extensions.map((x) =>
            x.id === "plazos" ? { ...x, enabled: true, previous: 2 } : x,
          ),
        },
      ],
      "GET api/agent/extensions/proposals": [EXTENSION_PROPOSALS, { proposals: [] }],
      "POST api/agent/extensions/:id/activate": [{ ok: true }],
      "POST api/agent/extensions/:id/revert": [{ ok: true }],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  await modal.getByRole("tab", { name: "Extensiones" }).click();
  const card = modal.getByRole("region", { name: "Extensión propuesta: Banco ING" });
  await expect(card).toContainText("La propone MCP · claude-ejemplo");
  await expect(card).toContainText("Lo que pide que no pedía la versión 1");
  for (const line of [
    "Código nuevo: «importar»",
    "Leer de Movimiento: fecha, importe",
    "Escribir en Movimiento: concepto",
    "Crear filas en Movimiento",
    "Preguntarte lo que no tenga claro",
  ])
    await expect(card.locator(".ext-proposal-asks")).toContainText(line);
  await expect(card).toContainText("No lee nada privado ni restringido.");
  await expect(card).toContainText("Sus pruebas: pasan 1 de 1");
  await expect(card).toContainText("«importar»: crearía 18 en Movimiento, te preguntaría 1");
  // Its code, folded, as plain text.
  await card.getByRole("button", { name: /Su código/ }).click();
  await expect(card.locator(".ext-proposal-code")).toContainText("function importar(input)");
  await page.screenshot({ path: `${SHOTS}/extension-proposal.png` });
  await card.getByRole("button", { name: "Activar la versión 2" }).click();
  await expect(card).toHaveCount(0);
  expect(await requests(page, "POST api/agent/extensions")).toEqual([
    "POST api/agent/extensions/banco/activate {}",
  ]);
  // The version before is one click away.
  await modal.getByRole("button", { name: "Volver a la versión 2" }).click();
  await expect
    .poll(() => requests(page, "POST api/agent/extensions/plazos"))
    .toEqual(["POST api/agent/extensions/plazos/revert {}"]);
});

test("the panel: questions and proposals in one queue as they came, each saying what it is (option A)", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [{ proposals: [CARD_COMPACT] }],
      "GET api/agent/requests": [REQUESTS],
      "POST api/agent/requests/:id/answer": [DONE, DONE, ANSWER_GONE],
      "POST api/agent/requests/:id/dismiss": [{ dismissed: true }],
    },
  });
  const top = page.locator(".topbar").getByRole("button", { name: /^Bandeja/ });
  await expect(top).toHaveText("Bandeja (5)");
  await top.click();
  const panel = page.locator(".inbox-panel");
  const kinds = panel.locator(".inbox-card .inbox-kind");
  // In the order they arrived: q1 (3), the proposal (4), q2 (5), q3 (6), q4 (7).
  await expect(kinds).toHaveText([
    "Pregunta · caduca en 7 días",
    "Propuesta",
    "Pregunta · caduca en 7 días",
    "Pregunta · caduca en 7 días",
    "Pregunta · caduca en 7 días",
  ]);
  const q1 = panel.locator(".request-card").first();
  await expect(q1.locator(".request-prompt")).toHaveText("¿A qué colección va «Entrega de actas»?");
  // Where it came from is outside text, marked, with "Ver correo".
  await expect(q1.locator(".inbox-source-text")).toHaveClass(/val-ext/);
  await expect(q1.locator(".inbox-source-text")).toContainText("Secretaría de ejemplo");
  await expect(q1.getByRole("button", { name: "Ver correo" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/agent-requests.png` });

  await q1.getByRole("button", { name: "Gestiones" }).click();
  await expect(panel.locator(".request-card")).toHaveCount(3);
  const q2 = panel.locator(".request-card").first();
  await q2.getByRole("textbox", { name: "Responder" }).pressSequentially("Una funda de móvil");
  await q2.getByRole("button", { name: "Enviar" }).click();
  await expect(panel.locator(".request-card")).toHaveCount(2);
  await panel.locator(".request-card").first().getByRole("button", { name: "Descartar" }).click();
  await expect(panel.locator(".request-card")).toHaveCount(1);
  // One that no longer waits (answered elsewhere): it says so and can be taken out.
  const q4 = panel.locator(".request-card").first();
  await q4.getByRole("button", { name: "Sí" }).click();
  await expect(q4.locator(".decide-error")).toContainText("ya no espera respuesta");
  await q4.getByRole("button", { name: "Quitar" }).click();
  await expect(panel.locator(".request-card")).toHaveCount(0);
  await expect(top).toHaveText("Bandeja (1)");
  expect(await requests(page, "POST api/agent/requests/")).toEqual([
    'POST api/agent/requests/q1/answer {"choice":1}',
    'POST api/agent/requests/q2/answer {"text":"Una funda de móvil"}',
    "POST api/agent/requests/q3/dismiss",
    'POST api/agent/requests/q4/answer {"choice":0}',
  ]);
});
