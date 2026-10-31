/**
 * Builds the reconciliation's functions (preset.ts) into the one file the box runs, conciliacion.gen.js: the code with
 * everything it imports, as a script whose two functions are globals. `make conciliacion` writes it; a test checks the
 * file is what this builds (conciliacion.test.ts), so the code Juan activates is the code in the repo.
 */
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const GENERATED = fileURLToPath(new URL("./conciliacion.gen.js", import.meta.url));
const HERE = dirname(GENERATED);

export async function buildConciliacion(): Promise<string> {
  const r = await build({
    entryPoints: ["./preset.ts"],
    absWorkingDir: HERE,
    bundle: true,
    write: false,
    format: "iife",
    globalName: "conciliacion",
    platform: "neutral",
    target: "es2022",
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
    banner: {
      js: "/* Boni's reconciliation for the box (docs/extensiones.md, E4), built by `make conciliacion` from apps/server/src/money/preset.ts: not edited by hand. */",
    },
    footer: {
      js: "var importar = conciliacion.importar;\nvar cerrar_mes = conciliacion.cerrar_mes;",
    },
  });
  const out = r.outputFiles?.[0];
  if (!out) throw new Error("esbuild gave no file");
  return out.text;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  writeFileSync(GENERATED, await buildConciliacion());
