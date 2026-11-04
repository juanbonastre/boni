import { describe, expect, it } from "vitest";
import { likeTitle, normalizeTitle } from "./text.ts";

describe("titles compared as people read them (tasks 46 and 50)", () => {
  it("drops accents, case and punctuation", () => {
    expect(normalizeTitle("  Reunión: Reconocimiento_Jorge  ")).toBe(
      "reunion reconocimiento jorge",
    );
    expect(normalizeTitle("¿Qué?")).toBe("que");
  });

  it("tells when two titles name the same thing, empty words aside", () => {
    expect(likeTitle("Reunión de reconocimiento", "reunion de Reconocimiento")).toBe(true);
    expect(likeTitle("Enviar el informe a Lucía", "Enviar informe a Lucía Ejemplo")).toBe(true);
    expect(likeTitle("Enviar el informe", "Reservar la sala")).toBe(false);
    expect(likeTitle("Clase IPM 8", "Clase IPM 8, mi nota")).toBe(true);
    expect(likeTitle("Clase IPM 8", "Clase IPM 9")).toBe(false);
    expect(likeTitle("Examen", "Examen final")).toBe(false);
    expect(likeTitle("", "x")).toBe(false);
  });
});
