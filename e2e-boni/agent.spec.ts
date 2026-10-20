import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  ASK_TURN,
  confirmTurn,
  DONE,
  PROPOSALS,
  RTL,
  RUNS,
  STOPPED,
  TEXT_REPLY,
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

test("the log: what each request did, and Undo for it", async ({ page }) => {
  await openApp(page, "/?still", {
    agent: { "GET api/agent/runs": [RUNS], "POST api/agent/runs/:id/undo": [{ undone: 2 }] },
  });
  await page.getByRole("button", { name: "Conversación" }).click();
  await page.getByRole("button", { name: "Registro" }).click();
  await expect(page.locator(".log-list li")).toHaveCount(2);
  await expect(page.locator(".log-list li").nth(1)).toContainText("Parado");
  await page
    .locator(".log-list li")
    .first()
    .getByRole("button", { name: "Deshacer lo que hizo" })
    .click();
  await expect(page.locator(".toast")).toContainText("Deshecho (2 cambios)");
  expect(await requests(page, "POST api/agent/runs/")).toEqual(["POST api/agent/runs/run-1/undo"]);
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
