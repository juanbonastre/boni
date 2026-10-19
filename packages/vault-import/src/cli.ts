import { openUserStore } from "@boni/store";
import { importVault } from "./import.ts";

/**
 * The vault into a user's store (docs/nucleo.md, 9.1). Dry run unless --apply:
 *   node src/cli.ts --vault <vault folder> --store <boni.db> [--apply]
 * The report says counts, types and fields, and where secrets were left out (path and line, never
 * the value). Nothing is ever written to the vault.
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const vault = flag("vault");
const storePath = flag("store");
if (!vault || !storePath) {
  console.error("Usage: --vault <vault folder> --store <boni.db> [--apply]");
  process.exit(1);
}
const store = openUserStore(storePath);
try {
  const t0 = Date.now();
  const r = importVault(vault, store, { apply: args.includes("--apply") });
  console.log(
    r.applied
      ? `Imported in ${Date.now() - t0} ms:`
      : `Dry run in ${Date.now() - t0} ms (nothing written; add --apply):`,
  );
  for (const t of r.types)
    console.log(
      `  ${t.name} (${t.id}): ${t.notes} notes, ${t.fields.length} fields${t.fields.some((f) => f.relationTo) ? `, relations to ${[...new Set(t.fields.flatMap((f) => (f.relationTo ? [f.relationTo] : [])))].join(", ")}` : ""}`,
    );
  console.log(
    `  entities: ${r.created} new, ${r.updated} changed, ${r.unchanged} unchanged, ${r.removed} to the trash`,
  );
  console.log(
    `  skipped: ${
      Object.entries(r.skipped)
        .map(([k, v]) => `${v} ${k}`)
        .join("; ") || "none"
    }`,
  );
  console.log(
    `  identity or bank numbers (kept, sensitive): ${r.identityNumbers} notes; links to no note: ${r.unresolvedLinks}`,
  );
  if (r.unreadable.length)
    console.log(
      `  properties unreadable (body only): ${r.unreadable.length}\n    ${r.unreadable.join("\n    ")}`,
    );
  if (r.secrets.length)
    console.log(
      `  access secrets left out (remove them from the vault):\n${r.secrets.map((s) => `    ${s.path}:${s.line} (${s.kind})`).join("\n")}`,
    );
  if (r.typeProblems.length)
    console.log(
      `  types that do not check (nothing would be written):\n    ${r.typeProblems.join("\n    ")}`,
    );
  if (r.failed.length)
    console.log(`  not written:\n${r.failed.map((f) => `    ${f.path}: ${f.error}`).join("\n")}`);
} finally {
  store.close();
}
