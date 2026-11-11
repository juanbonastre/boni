/** A run in words (task 90, I-27): every place names a step the same, and no tool id, `$` reference or rule code shows. */
import { describe, expect, it } from "vitest";
import { translator } from "../i18n.ts";
import type { RunDetail, RunStep } from "./agent.ts";
import {
  moneyText,
  runCopy,
  runStatusLine,
  runStepLine,
  runWords,
  stepDesc,
  stepName,
  whyText,
} from "./runText.ts";

const t = translator("es");
const usd = (n: number) => `${n.toFixed(3).replace(".", ",")} US$`;

const step = (o: Partial<RunStep>): RunStep => ({
  id: "s1",
  op: "call",
  title: null,
  what: "entities.get",
  args: "",
  decision: "allow",
  rule: "P1",
  error: null,
  deps: [],
  uses: [],
  answers: [],
  ...o,
});

const run = (steps: RunStep[]): RunDetail => ({
  id: "run-1",
  status: "stopped",
  origin: "turn",
  started: Date.UTC(2026, 9, 20, 11, 30),
  finished: null,
  request: "Reenvía el informe a quien me lo pidió",
  flow: null,
  flowVersion: null,
  inputs: [],
  steps,
  read: [{ collection: "Correos", type: "t_01m6correo", titles: ["Informe mensual"], n: 3 }],
  changes: [],
  proposals: [],
  told: [],
  input: null,
  owner: "boni:chat",
  decisions: [],
  models: [
    {
      role: "planner",
      provider: "anthropic",
      model: "m-ejemplo",
      input: 1200,
      output: 80,
      cost: 0.004,
      at: 0,
    },
  ],
});

describe("a run in words", () => {
  it("names a step as the editor and the map do: a reader in a word, a tool by its title", () => {
    expect(stepName(t, { op: "read", what: "read_message" })).toBe("Lectora");
    expect(stepName(t, { op: "call", what: "entities.create", title: "Crear" })).toBe("Crear");
    // Only when Boni has no name for it, its id.
    expect(stepName(t, { op: "call", what: "mail.send", title: null })).toBe("mail.send");
    expect(stepName(t, { op: "read", what: "un_lector_nuevo" })).toBe("un_lector_nuevo");
    expect(stepName(t, { op: "ask", what: "" })).toBe(t("flows.op.ask"));
  });

  it("says what a step does in one line, when Boni has words for it", () => {
    expect(stepDesc(t, { op: "read", what: "classify" })).toBe(
      "Elige la colección; si duda, te pregunta en la Bandeja.",
    );
    expect(stepDesc(t, { op: "call", what: "mail.rule" })).toMatch(/^Si tu guía dice no leer/);
    expect(stepDesc(t, { op: "call", what: "mail.send" })).toBeNull();
    expect(stepDesc(t, { op: "ask", what: "" })).toBe("Te pregunta y espera tu respuesta.");
  });

  it("says why a step stopped in words: a safety rule, Juan's stop or a fault; never the rule's code", () => {
    expect(whyText(t, "P2-untrusted-destination")).toBe("una regla de seguridad lo impide");
    expect(whyText(t, "P20")).toBe("una regla de seguridad lo impide");
    expect(whyText(t, "stopped-by-juan")).toBe("lo paraste tú");
    expect(whyText(t, "bad-ref")).toBe("un fallo al hacerlo");
    // What a model may read is a rule too (R…); the day's budget and a request's limits are limits, not rules.
    expect(whyText(t, "R1-private-data-to-reader")).toBe("una regla de seguridad lo impide");
    expect(whyText(t, "P13-daily-budget")).toBe("se llegó al límite de gasto de hoy");
    expect(whyText(t, "P12-steps")).toBe("se llegó a un límite de la petición");
    // A whole run: in words on screen, with its code only in «Copiar».
    expect(runStatusLine(t, "done")).toBe("Hecho");
    expect(runStatusLine(t, "stopped")).toBe("Parado");
    expect(runStatusLine(t, "stopped:R1-private-data-to-reader")).toBe(
      "Parado: una regla de seguridad lo impide",
    );
    expect(runStatusLine(t, "stopped:R1-private-data-to-reader", true)).toBe(
      "Parado: una regla de seguridad lo impide (R1-private-data-to-reader)",
    );
    expect(runStepLine(t, { error: "P2-untrusted-destination", decision: "deny" })).toBe(
      "Parado: una regla de seguridad lo impide",
    );
    expect(runStepLine(t, { error: null, decision: null })).toBe("No llegó");
    expect(runStepLine(t, { error: null, decision: "propose" })).toBe("Propuesto");
    for (const lang of ["es", "en"] as const)
      for (const k of ["run.why.rule", "run.why.fault", "run.why.stopped-by-juan"])
        expect(translator(lang)(k), `${lang} ${k}`).not.toBe(k);
  });

  it("says dollars the same everywhere: cents, and a small amount to its first figures", () => {
    const es = (n: number) => moneyText("es", n).replace(/\s/g, " ");
    expect(es(0.004)).toBe("0,004 US$");
    expect(es(0.0021)).toBe("0,0021 US$");
    expect(es(0.41)).toBe("0,41 US$");
    expect(es(12.5)).toBe("12,50 US$");
    expect(es(0)).toBe("0,00 US$");
    expect(moneyText("en", 0.004)).toBe("US$0.004");
  });

  it("keeps the words of the request a step took, and its models by their role", () => {
    const d = run([
      step({ title: "Buscar", what: "entities.search", said: ["«informe»"] }),
      step({
        id: "s2",
        title: "Enviar correo",
        what: "mail.send",
        decision: "deny",
        rule: "P2",
        error: "P2-untrusted-destination",
        deps: ["s1"],
      }),
    ]);
    const w = runWords(t, d, usd);
    expect(w.steps.map((s) => `${s.name} — ${s.line}`)).toEqual([
      "Buscar «informe» — Hecho",
      "Enviar correo — Parado: una regla de seguridad lo impide",
    ]);
    expect(w.read).toEqual(["Correos: «Informe mensual» +2"]);
    expect(w.models).toEqual(["Planificador · m-ejemplo · 1200 → 80 · 0,004 US$"]);
    // «Copiar»: the same words; the rule's code only there, in brackets, to fix what failed.
    const copied = runCopy(t, d, w, "20 oct 13:30");
    // Its first line: the run's status in words, its code beside it (never «{why}» or a raw status).
    expect(copied.split("\n")[0]).toBe(
      "Boni · Recorrido · Parado · 20 oct 13:30 (con texto de tus datos)",
    );
    expect(copied).toContain("1. Buscar «informe» — Hecho");
    // What each step does, under it.
    expect(copied).toContain("   Busca registros por las palabras de su texto.");
    expect(copied).toContain(
      "2. Enviar correo — Parado: una regla de seguridad lo impide (P2-untrusted-destination)",
    );
    expect(copied).not.toMatch(/entities\.|mail\.send|\$s1/);
  });
});
