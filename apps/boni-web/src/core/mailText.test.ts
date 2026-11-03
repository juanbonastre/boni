import { describe, expect, it } from "vitest";
import { IMAGE_FILE, splitQuote, withoutImagePlaceholders } from "./mailText.ts";

describe("a mail's text as a mail app shows it (task 48)", () => {
  it("finds where a reply quotes the earlier message, in Gmail's, Apple's and Outlook's words", () => {
    const gmail =
      "Yo puedo ese día.\n\nEl mar, 3 nov 2026, 10:12, Lucía Ejemplo <lucia.ejemplo@example.com>\nescribió:\n> ¿Cuándo os viene bien?\n> Lucía";
    expect(splitQuote(gmail)).toEqual({
      text: "Yo puedo ese día.",
      quote:
        "El mar, 3 nov 2026, 10:12, Lucía Ejemplo <lucia.ejemplo@example.com>\nescribió:\n> ¿Cuándo os viene bien?\n> Lucía",
    });
    expect(
      splitQuote(
        "Fine by me.\n\nOn Tue, 3 Nov 2026 at 10:12, Ana Ejemplo <ana@example.com> wrote:\n> When?",
      ).quote,
    ).toMatch(/^On Tue/);
    expect(
      splitQuote(
        "Gracias.\n\n-----Mensaje original-----\nDe: Ana\nEnviado el: lunes\nAsunto: x\n\nHola",
      ).quote,
    ).toMatch(/^-----Mensaje original/);
    expect(
      splitQuote(
        "Vale.\n\n________________________________\nDe: Ana Ejemplo\nEnviado: lunes\n\nHola",
      ).quote,
    ).toMatch(/^_{8,}/);
    expect(
      splitQuote(
        "Vale.\n\nDe: Ana Ejemplo <ana@example.com>\nEnviado: lunes, 2 de noviembre\nPara: Juan\n\nHola",
      ).quote,
    ).toMatch(/^De: Ana/);
    expect(splitQuote("Sin más.\n> una cita suelta")).toEqual({
      text: "Sin más.",
      quote: "> una cita suelta",
    });
  });

  it("never folds a mail that is only a quote, nor one without any", () => {
    const only = "> todo citado\n> desde el principio";
    expect(splitQuote(only)).toEqual({ text: only, quote: "" });
    const plain = "Hola, antes del jueves revisad las actas.";
    expect(splitQuote(plain)).toEqual({ text: plain, quote: "" });
    const alike = "Elena escribió un libro.\nOn time.";
    expect(splitQuote(alike)).toEqual({ text: alike, quote: "" });
  });

  it("takes out a webmail's placeholders for the images it shows apart, and knows an image's name", () => {
    expect(
      withoutImagePlaceholders("Hola\n\n[image: XuiZ.jpg]\n\nM. Luz\n[imagen: firma.png]"),
    ).toBe("Hola\n\nM. Luz\n");
    expect(IMAGE_FILE.test("foto.JPG")).toBe(true);
    expect(IMAGE_FILE.test("logo.svg")).toBe(false);
    expect(IMAGE_FILE.test("actas.pdf")).toBe(false);
  });
});
