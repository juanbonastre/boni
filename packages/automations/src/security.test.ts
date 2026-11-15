// The security rules of F14a (docs/automatizaciones.md §6): labels through citations, the label of the path, and the
// policy on every read and write. One test per rule, its id in the name (`make check` reads them).
import { join } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { cite, sketch } from "./automation.test-util.ts";
import { OUTSIDE, OWN, start } from "./run.test-util.ts";

describe("labels and the policy", () => {
  it("AU-162 · a value that is one simple citation keeps the type and the exact label of the field it cites, with no sandbox; text around it makes it derived", async () => {
    const s = sketch()
      .step("Inicio", "manual", {
        fields: [
          { key: "importe", name: "Importe", type: "number" },
          { key: "nota", name: "Nota", type: "text" },
        ],
      })
      .step("Copiar", "edit", {
        keep: "none",
        fields: [
          { field: "mismo", value: cite("$json.importe") },
          { field: "suyo", value: cite("$json.nota") },
          { field: "del paso", value: cite("$('Inicio').first().importe") },
          { field: "texto", value: { expr: "Nota: {{ $json.nota }}" } },
          { field: "fijo", value: 7 },
          { field: "falta", value: cite("$json.nada") },
        ],
      })
      .arrow("Inicio", "Copiar");
    const e = await start(
      s.build(),
      s.id("Inicio"),
      { importe: 12.5, nota: "de fuera" },
      {},
      {
        nota: { label: OUTSIDE, derived: false },
      },
    );
    const row = e.steps[s.id("Copiar")]?.out.main?.[0];
    expect(row?.json).toEqual({
      mismo: 12.5,
      suyo: "de fuera",
      "del paso": 12.5,
      texto: "Nota: de fuera",
      fijo: 7,
      falta: null,
    });
    // The row's label is the one it came with; only what differs has a label of its own.
    expect(row?.label).toBe(OWN);
    expect(row?.fields).toEqual({
      suyo: { label: OUTSIDE, derived: false },
      texto: { label: join(OWN, OUTSIDE), derived: true },
    });
  });
  it.todo(
    "AU-164 · a row carries the label of its path: what comes out of a condition over something from outside, or of rows searched with it, is written as from outside",
  );
  it.todo(
    "AU-168 · every read and every write of a run asks the policy first, in a test too: a denied one never reaches the collections, and an executor has no way to them but the gate",
  );
});
