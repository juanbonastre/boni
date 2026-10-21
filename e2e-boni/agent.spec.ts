import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  ASK_TURN,
  confirmTurn,
  DONE,
  EXTENSIONS,
  GUIDE,
  MAIL,
  MAIL_SUGGESTED,
  MIRROR_PROPOSAL,
  PROPOSALS,
  RTL,
  RUN_2,
  RUNS,
  STOPPED,
  TEXT_REPLY,
  VISIBILITY,
} from "./agent-scenarios.ts";
import { openApp, recorded } from "./fixtures.ts";

/**
 * The conversation with the agent (docs/nucleo.md, 7.14): painted by the code, text from outside only as text,
 * confirmations with the real values and their warnings, the inbox one proposal at a time, the log with Undo.
 */
const SHOTS = "e2e-boni/screenshots";
mkdirSync(SHOTS, { recursive: true });

const requests = async (page: Page, prefix: string) =>
  (await recorded(page)).requests.filter((r) => r.startsWith(prefix));

async function ask(page: Page, text: string) {
  await page.getByRole("button", { name: "Conversación" }).click();
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
  await expect(answer.getByRole("button", { name: "1 propuesta(s) en la bandeja" })).toBeVisible();
  await expect(
    page.locator(".nav-row", { hasText: "Conversación" }).locator(".nav-count"),
  ).toHaveText("2");
  const sent = await requests(page, "POST api/agent/turn ");
  expect(JSON.parse(sent[0]?.split(" ").slice(2).join(" ") ?? "{}")).toMatchObject({
    text: "resume el último correo",
  });
  await page.screenshot({ path: `${SHOTS}/agent-reply.png` });
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
  expect(await requests(page, "POST api/agent/confirm ")).toEqual([
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
  expect(await requests(page, "POST api/agent/answer ")).toEqual([
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
  await page.getByRole("button", { name: "Conversación" }).click();
  await page.getByRole("button", { name: /^Bandeja/ }).click();
  await expect(page.locator(".title")).toContainText("Bandeja");
  await expect(page.locator(".proposal")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /todas/i })).toHaveCount(0);
  await expect(page.locator(".proposal").first()).toContainText("Viene de fuera · un correo");
  await page.screenshot({ path: `${SHOTS}/agent-inbox.png` });
  await page.locator(".proposal").first().getByRole("button", { name: "Aceptar" }).click();
  await expect(page.locator(".toast")).toContainText("Propuesta aceptada");
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

test("a hand edit in Obsidian waits in the inbox with its note and what will not be applied", async ({
  page,
}) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/proposals": [MIRROR_PROPOSAL],
      "POST api/agent/proposals/:id/accept": [DONE],
    },
  });
  await page.getByRole("button", { name: "Conversación" }).click();
  await page.getByRole("button", { name: /^Bandeja/ }).click();
  const p = page.locator(".proposal");
  await expect(p).toHaveCount(1);
  await expect(p).toContainText("Cambio hecho a mano en Obsidian");
  await expect(p).toContainText("Nota");
  await expect(p).toContainText("agenda/docencia/2026-10-19 Clase de ejemplo.md");
  await expect(p).toContainText("No se aplica");
  await expect(p).toContainText("De tus datos · tu vault");
  // The element by its title (the id beside it) and each field by its name, never a JSON blob.
  await expect(p.locator(".confirm-row", { hasText: "e_clase" })).toContainText("Clase de ejemplo");
  await expect(p.locator(".confirm-row", { hasText: "Hora de inicio" })).toContainText("12:00");
  await expect(p).not.toContainText("{");
  await page.screenshot({ path: `${SHOTS}/agent-mirror-proposal.png` });
  await p.getByRole("button", { name: "Aceptar" }).click();
  await expect(page.locator(".proposal")).toHaveCount(0);
  expect(await requests(page, "POST api/agent/proposals/")).toEqual([
    "POST api/agent/proposals/pm/accept",
  ]);
});

test("the log: what each request did, and Undo for it", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/runs": [RUNS],
      "GET api/agent/runs/:id": [RUN_2],
      "POST api/agent/runs/:id/undo": [{ undone: 2 }],
    },
  });
  await page.getByRole("button", { name: "Conversación" }).click();
  await page.getByRole("button", { name: "Registro" }).click();
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

test("what the AI sees: Juan chooses per collection in Settings", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: {
      "GET api/agent/visibility": [VISIBILITY],
      "PUT api/agent/visibility/:type": [{ id: "t_proyecto", level: "hidden" }],
    },
  });
  await page.locator(".sidebar").getByRole("button", { name: "Ajustes" }).click();
  const modal = page.locator(".modal");
  // Settings open on the account; each section is one tab.
  await expect(modal.getByRole("tab", { name: "Cuenta" })).toHaveAttribute("aria-selected", "true");
  await modal.getByRole("tab", { name: "Lo que ve la IA" }).click();
  await expect(modal.getByRole("heading", { name: "Lo que ve la IA" })).toBeVisible();
  const row = (name: string) => modal.getByRole("combobox", { name });
  await expect(row("Diario")).toHaveValue("hidden");
  await expect(row("Movimientos")).toHaveValue("opaque");
  await row("Proyectos").selectOption("hidden");
  await expect(row("Proyectos")).toHaveValue("hidden");
  expect(await requests(page, "PUT api/agent/visibility")).toEqual([
    'PUT api/agent/visibility/t_proyecto {"level":"hidden"}',
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
