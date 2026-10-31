import { describe, expect, it } from "vitest";
import {
  type Catalogue,
  changeSetErrors,
  type ExtensionManifest,
  type FunctionSpec,
  manifestErrors,
  moreNeeds,
} from "./index.ts";

const CAT: Catalogue = { connectors: ["imap"], modules: {}, plans: [], roles: [] };

const importar: FunctionSpec = {
  name: "importar",
  code: "function importar(input) { return { changes: [] } }",
  hash: "b".repeat(64),
  reads: [{ collection: "movimiento", fields: ["fecha", "importe", "concepto"] }],
  writes: [
    { collection: "movimiento", fields: ["fecha", "importe", "concepto"], create: true },
    { collection: "deuda", fields: ["saldada"], update: true },
  ],
  asks: true,
};

const manifest: ExtensionManifest = {
  id: "banco",
  name: "Banco",
  version: 1,
  functions: [importar],
  tests: [
    {
      function: "importar",
      name: "un extracto vacío no cambia nada",
      input: { rows: { movimiento: [] }, data: { lineas: [] } },
      expect: { changes: [] },
    },
  ],
  needs: { reads: ["movimiento"], proposes: false },
};

describe("an extension's functions in its manifest", () => {
  it("are part of it, each with what it reads and writes and at least one test", () => {
    expect(manifestErrors(manifest, CAT)).toEqual([]);
    expect(manifestErrors({ ...manifest, tests: [] }, CAT)).toEqual(["tests: none for importar"]);
    expect(manifestErrors({ ...manifest, tests: undefined }, CAT)).toEqual([
      "tests: every function needs at least one",
    ]);
  });

  it("what it reads is what it says it reads; what it writes is said field by field", () => {
    expect(manifestErrors({ ...manifest, needs: { reads: [], proposes: false } }, CAT)).toEqual([
      "needs.reads: misses movimiento",
    ]);
    const bad = {
      ...importar,
      hash: "no",
      reads: [{ collection: "movimiento", fields: [] }],
      writes: [{ collection: "deuda", fields: ["saldada"] }],
      red: true,
    };
    expect(manifestErrors({ ...manifest, functions: [bad] }, CAT)).toEqual([
      "functions[0]: unknown keys",
      "functions[0].hash: its sha256",
      "functions[0].reads[0].fields: a list of field keys, each once",
      "functions[0].writes[0]: create, update or both",
    ]);
  });

  it("its tests name its functions, in plain words, with JSON", () => {
    const tests = [
      { function: "otra", name: "x", input: {}, expect: {} },
      { function: "importar", name: "<b>x</b>", input: {}, expect: {} },
    ];
    expect(manifestErrors({ ...manifest, tests }, CAT)).toEqual([
      "tests[0].function: one of its functions",
      "tests[1].name: 1 to 80 characters, no links or HTML",
    ]);
  });

  it("a new version says what its functions ask for that the old ones did not", () => {
    const next: ExtensionManifest = {
      ...manifest,
      version: 2,
      functions: [
        {
          ...importar,
          hash: "c".repeat(64),
          reads: [{ collection: "movimiento", fields: ["fecha", "importe", "concepto", "cuenta"] }],
          writes: [
            ...importar.writes,
            { collection: "categoria", fields: ["nombre"], create: true },
          ],
        },
        { ...importar, name: "cerrar" },
      ],
    };
    expect(moreNeeds(manifest, next)).toEqual([
      "code:importar",
      "reads:movimiento.cuenta",
      "writes:categoria.nombre",
      "creates:categoria",
      "function:cerrar",
      "reads:movimiento.fecha",
      "reads:movimiento.importe",
      "reads:movimiento.concepto",
      "writes:movimiento.fecha",
      "writes:movimiento.importe",
      "writes:movimiento.concepto",
      "creates:movimiento",
      "writes:deuda.saldada",
      "updates:deuda",
      "asks:cerrar",
    ]);
  });
});

describe("what a function gives back", () => {
  const read = new Map([
    ["e_deuda_1", { collection: "deuda", version: 4 }],
    ["e_mov_1", { collection: "movimiento", version: 2 }],
  ]);

  it("is checked against what it declared", () => {
    expect(
      changeSetErrors(
        {
          summary: "18 nuevos y una deuda saldada",
          changes: [
            {
              op: "create",
              collection: "movimiento",
              values: { fecha: "2026-10-30", importe: -12.5 },
            },
            { op: "update", id: "e_deuda_1", version: 4, values: { saldada: true } },
            { op: "ask", question: "¿Es la cena del sábado?", options: ["Sí", "No"] },
          ],
        },
        importar,
        read,
      ),
    ).toEqual([]);
    expect(
      changeSetErrors(
        {
          changes: [
            { op: "create", collection: "deuda", values: { saldada: true } },
            { op: "create", collection: "movimiento", values: { cuenta: "x" } },
            { op: "update", id: "e_otro", version: 1, values: { saldada: true } },
            { op: "update", id: "e_deuda_1", version: 3, values: { saldada: true } },
            { op: "update", id: "e_mov_1", version: 2, values: { importe: 1 } },
            { op: "ask", question: "Mira <a href='x'>aquí</a>" },
            { op: "delete", id: "e_mov_1" },
          ],
        },
        importar,
        read,
      ),
    ).toEqual([
      "changes[0].collection: not one it may make rows in",
      "changes[1].values.cuenta: not one it may write",
      "changes[2].id: not a row it was given",
      "changes[3].version: not the one it was given",
      "changes[4]: it may not change rows of movimiento",
      "changes[5].question: plain text",
      "changes[6].op: create, update or ask",
    ]);
  });

  it("a row's title and text are written as `$title` and `$text`; its report is plain text, line by line", () => {
    const titled = {
      ...importar,
      writes: [{ collection: "movimiento", fields: ["$title", "$text", "importe"], create: true }],
    };
    expect(manifestErrors({ ...manifest, functions: [titled] }, CAT)).toEqual([]);
    expect(
      manifestErrors(
        {
          ...manifest,
          functions: [{ ...titled, reads: [{ collection: "movimiento", fields: ["$id"] }] }],
        },
        CAT,
      ),
    ).toEqual(["functions[0].reads[0].fields: a list of field keys, each once"]);
    const made = (report: unknown) =>
      changeSetErrors(
        {
          summary: "2 nuevos",
          report: report,
          changes: [
            {
              op: "create",
              collection: "movimiento",
              values: { $title: "Taxi", $text: "Del aeropuerto." },
            },
          ],
        },
        titled,
        read,
      );
    expect(made(["ing.xls: 2 líneas", "  NUEVA 2026-10-30 -20.00 Taxi"])).toEqual([]);
    expect(made(["mira www.ejemplo.invalid"])).toEqual(["report: up to 200 lines of plain text"]);
    expect(made("una línea")).toEqual(["report: up to 200 lines of plain text"]);
  });

  it("never touches anything outside what it declared, whatever it gives back (random sets)", () => {
    // A small fixed generator: the same sets every run.
    let s = 7;
    const rnd = () => {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      return s / 2 ** 31;
    };
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;
    const collections = ["movimiento", "deuda", "persona", "categoria"];
    const fields = ["fecha", "importe", "concepto", "saldada", "nombre", "cuenta"];
    const ids = ["e_deuda_1", "e_mov_1", "e_persona_1"];
    let accepted = 0;
    for (let n = 0; n < 3000; n++) {
      const changes = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
        const op = pick(["create", "update", "ask", "remove"]);
        const values = { [pick(fields)]: pick([1, "x", true, null]) };
        return op === "create"
          ? { op, collection: pick(collections), values }
          : op === "update"
            ? { op, id: pick(ids), version: pick([2, 3, 4]), values }
            : op === "ask"
              ? { op, question: pick(["¿Sí?", "<i>no</i>"]) }
              : { op, id: pick(ids) };
      });
      if (changeSetErrors({ changes }, importar, read).length) continue;
      accepted++;
      for (const c of changes) {
        if (c.op === "ask") continue;
        const collection =
          c.op === "create"
            ? (c as { collection: string }).collection
            : read.get((c as { id: string }).id)?.collection;
        const spec = importar.writes.find((w) => w.collection === collection);
        expect(spec).toBeDefined();
        expect(c.op === "create" ? spec?.create : spec?.update).toBe(true);
        for (const k of Object.keys((c as { values: object }).values))
          expect(spec?.fields).toContain(k);
        if (c.op === "update")
          expect((c as { version: number }).version).toBe(
            read.get((c as { id: string }).id)?.version,
          );
      }
    }
    expect(accepted).toBeGreaterThan(50);
  });
});
