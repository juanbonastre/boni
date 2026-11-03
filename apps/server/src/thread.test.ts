import { describe, expect, it } from "vitest";
import {
  isReplySubject,
  likeTitle,
  normalizeSubject,
  threadIdOf,
  whenOf,
  whenParts,
} from "./thread.ts";

describe("threads of mail (task 46)", () => {
  it("names a thread by its first message, by what it answers, or by the subject of a reply", () => {
    const base = { messageId: "c@x", inReplyTo: null, references: [] as string[], subject: "Hola" };
    expect(
      threadIdOf({ ...base, references: ["a@x", "b@x"], inReplyTo: "b@x" }, () => null, "e"),
    ).toBe("a@x");
    expect(threadIdOf({ ...base, inReplyTo: "b@x" }, () => null, "e")).toBe("b@x");
    // A reply without headers joins a recent mail with the same subject; a fresh mail never does.
    expect(threadIdOf({ ...base, subject: "RE: Hola" }, () => "a@x", "e")).toBe("a@x");
    expect(threadIdOf({ ...base, subject: "Hola" }, () => "a@x", "e")).toBe("c@x");
    expect(threadIdOf({ ...base, messageId: "", subject: "Re: Hola" }, () => null, "e_mail")).toBe(
      "e_mail",
    );
  });

  it("reads a subject without its reply marks, and knows one", () => {
    expect(normalizeSubject("RE: Re:  Fwd: Invitación:  Entrevista ")).toBe(
      "invitación: entrevista",
    );
    expect(normalizeSubject("RV: [EXT] Actas")).toBe("[ext] actas");
    expect(normalizeSubject("Reunión")).toBe("reunión");
    expect(isReplySubject("Re: x")).toBe(true);
    expect(isReplySubject("Rezar")).toBe(false);
  });

  it("tells when two titles name the same thing, accents, case and most words aside", () => {
    expect(likeTitle("Reunión de reconocimiento", "reunion de Reconocimiento")).toBe(true);
    expect(likeTitle("Enviar el informe a Lucía", "Enviar informe a Lucía Ejemplo")).toBe(true);
    expect(likeTitle("Enviar el informe", "Reservar la sala")).toBe(false);
    expect(likeTitle("Examen", "Examen final")).toBe(false);
    expect(likeTitle("", "x")).toBe(false);
  });

  it("compares what a proposal says of its day and hours", () => {
    const rows = [
      { arg: "type", value: "agenda" },
      { arg: "values.title", value: "Reunión" },
      { arg: "values.fecha", value: "2026-11-11" },
      { arg: "values.hora", value: "17:00" },
      { arg: "values.hora_fin", value: "18:00" },
    ];
    expect(whenOf(rows)).toBe("2026-11-11 17:00–18:00");
    expect(whenParts(rows)).toEqual({ day: "2026-11-11", start: "17:00", end: "18:00" });
    expect(whenOf(rows.slice(0, 2))).toBe("");
    expect(whenParts(rows.slice(0, 3))).toEqual({ day: "2026-11-11", start: null, end: null });
  });
});
