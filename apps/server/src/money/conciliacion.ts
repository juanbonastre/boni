/**
 * The reconciliation as an extension (docs/extensiones.md, E4): the manifest of its two functions, whose code is
 * preset.ts built into one file (conciliacion.gen.js). Not offered yet (it is not in PRESETS): first it has to give
 * exactly what `finanzas_import` and `finanzas_close` give on a copy of Juan's data; then it replaces them.
 */
import { readFileSync } from "node:fs";
import type { ExtensionManifest, FunctionSpec, ReadSpec } from "@boni/extensions";
import { codeHash } from "../sandbox.ts";
import { DEBT, keyOf, MOVEMENT } from "./preset.ts";

export const CONCILIACION_CODE = readFileSync(
  new URL("./conciliacion.gen.js", import.meta.url),
  "utf8",
);

const MOVEMENTS: ReadSpec = {
  collection: "movimiento",
  fields: ["$title", ...MOVEMENT.map(keyOf)],
};
const CATEGORIES: ReadSpec = { collection: "categoria", fields: ["$title", "nombre", "tipo"] };
const RULES: ReadSpec = { collection: "regla", fields: ["texto", "comercio", "categoria"] };
/** What a new movement is made of, and what a joined note gains. */
const NEW_MOVEMENT = [
  "$title",
  "$text",
  ...MOVEMENT.filter((n) => !["people", "invited", "my_share", "settles"].includes(n)).map(keyOf),
];
/**
 * Room for years of statements: measured 2026-10-31 on the laptop, 140 KB of them (an 86 KB .xls among them) took 176
 * steps and 136 ms in the box (conciliacion.test.ts).
 */
const LIMITS = { steps: 5_000, ms: 5_000 };

const fn = (spec: Omit<FunctionSpec, "code" | "hash">): FunctionSpec => ({
  ...spec,
  code: CONCILIACION_CODE,
  hash: codeHash(CONCILIACION_CODE),
});

/** A statement of two lines, as the manifest's tests give it (invented: the repo is public). */
const CSV = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-09-02 10:11:12,2026-09-03 08:00:00,Spotify,-10.99,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,2026-09-05 21:43:09,2026-09-06 09:00:00,La Tasca Ejemplo,-60.00,0.00,EUR,COMPLETED,40.00
`;
const TEST_ROWS = {
  movimiento: [
    {
      id: "e_cena",
      version: 3,
      values: {
        $title: "Cena cumple 60,00 EUR",
        date: "2026-09-05",
        time: "21:40",
        amount: -60,
        account: "revolut",
        status: "pendiente",
      },
    },
  ],
  categoria: [
    {
      id: "e_subs",
      version: 1,
      values: { $title: "suscripciones", nombre: "suscripciones", tipo: "gasto" },
    },
  ],
  regla: [
    {
      id: "e_spotify",
      version: 1,
      values: { texto: "spotify", comercio: "Spotify", categoria: "e_subs" },
    },
  ],
};

export const CONCILIACION: ExtensionManifest = {
  id: "conciliacion",
  name: "Conciliación",
  version: 1,
  description:
    "Lee los extractos del banco que subes: propone los movimientos nuevos, los une con lo que apuntaste en la app y te pregunta las líneas dudosas. Al cerrar un mes, marca conciliados los movimientos completos y dice qué les falta a los demás.",
  functions: [
    fn({
      name: "importar",
      reads: [MOVEMENTS, CATEGORIES, RULES],
      writes: [{ collection: "movimiento", fields: NEW_MOVEMENT, create: true, update: true }],
      asks: true,
      limits: LIMITS,
    }),
    fn({
      name: "cerrar_mes",
      reads: [
        MOVEMENTS,
        { collection: "deuda", fields: ["$title", ...DEBT.map(keyOf)] },
        CATEGORIES,
        RULES,
        { collection: "persona", fields: ["$title"] },
      ],
      writes: [{ collection: "movimiento", fields: ["status"], update: true }],
      limits: LIMITS,
    }),
  ],
  tests: [
    {
      function: "importar",
      name: "una línea nueva por su regla y otra unida a la cena que apuntaste",
      input: {
        rows: TEST_ROWS,
        data: {
          files: [{ name: "2026-09-revolut.csv", base64: Buffer.from(CSV).toString("base64") }],
        },
      },
      expect: {
        summary: "1 nueva, 1 unida, 0 dudosas",
        report: [
          "2026-09-revolut.csv: revolut, 2 lineas; productos: Current 2",
          "Lineas del banco: 2; ya importadas: 0; nuevas: 2",
          "Unidas a notas de la app: 1; notas nuevas: 1 (categoria por regla 1, sin categoria 0); dudosas: 0",
          "  UNIDA   2026-09-05 -60.00 La Tasca Ejemplo  ->  Cena cumple 60,00 EUR",
        ],
        changes: [
          {
            op: "update",
            id: "e_cena",
            version: 3,
            values: {
              "bank-ref": "rev-e9ecb66d6692",
              "bank-text": "La Tasca Ejemplo",
              merchant: "La Tasca Ejemplo",
            },
          },
          {
            op: "create",
            collection: "movimiento",
            values: {
              $title: "Spotify 10,99 EUR",
              date: "2026-09-02",
              time: "10:11",
              amount: -10.99,
              currency: "EUR",
              account: "revolut",
              category: "e_subs",
              merchant: "Spotify",
              status: "pendiente",
              source: "revolut",
              "bank-ref": "rev-c986acf2e9d9",
              "bank-text": "Spotify",
              created: "2026-01-01",
            },
          },
        ],
      },
    },
    {
      function: "cerrar_mes",
      name: "un mes sin movimientos no marca nada",
      input: {
        rows: { movimiento: [], deuda: [], categoria: [], regla: [], persona: [] },
        data: { month: "2026-09" },
      },
      expect: {
        summary: "2026-09: 0 para conciliar, 0 siguen pendientes",
        report: [
          "Movimientos pendientes de 2026-09: 0; listos para conciliar: 0; siguen pendientes: 0",
        ],
        changes: [],
      },
    },
  ],
  needs: { reads: ["movimiento", "categoria", "regla", "deuda", "persona"], proposes: false },
};
