import { openUserStore, type Zone } from "@boni/store";
import { importVault, ZONES } from "./import.ts";

/**
 * The vault into a user's store (docs/nucleo.md, 9.1). Dry run unless --apply:
 *   node src/cli.ts --vault <vault folder> --store <boni.db> [--apply]
 * The report says counts, types and fields, and where secrets were left out (path and line, never
 * the value). Nothing is ever written to the vault.
 *
 * One of the vault's zones, run by Juan alone (the server never sees these folders):
 *   node src/cli.ts --zone restricted|private --vault <that folder> --store <boni.db> [--apply] [--details]
 * Its report gives counts only, so it can be shown to an AI; --details adds names and paths, for Juan.
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const vault = flag("vault");
const storePath = flag("store");
const zone = flag("zone") as Zone | undefined;
if (!vault || !storePath || (args.includes("--zone") && !ZONES.includes(zone as Zone))) {
  console.error(
    "Usage: [--zone restricted|private] --vault <folder> --store <boni.db> [--apply] [--details]",
  );
  process.exit(1);
}
const store = openUserStore(storePath);
try {
  const t0 = Date.now();
  const r = importVault(vault, store, {
    apply: args.includes("--apply"),
    ...(zone ? { zone } : {}),
  });
  if (zone && !args.includes("--details")) {
    // Counts only: nothing of what the zone holds, not even its folder names.
    console.log(
      r.applied
        ? `Zone ${zone} imported in ${Date.now() - t0} ms:`
        : `Zone ${zone}, dry run in ${Date.now() - t0} ms (nothing written; add --apply):`,
    );
    console.log(
      `  ${r.types.length} collections, kept from every AI; ${r.types.reduce((n, t) => n + t.notes, 0)} rows, of them ${r.files} new or changed attachments`,
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
      `  access secrets left out: ${r.secrets.length}; properties unreadable: ${r.unreadable.length}; types that do not check: ${r.typeProblems.length}; not written: ${r.failed.length}`,
    );
    if (r.secrets.length || r.unreadable.length || r.typeProblems.length || r.failed.length)
      console.log("  where: run again with --details (names and paths; not for an AI)");
    process.exitCode = r.typeProblems.length || r.failed.length ? 1 : 0;
  } else {
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
    if (r.hiddenFromModels.length)
      console.log(
        `  kept from the AI (unless you chose otherwise in Boni): ${r.hiddenFromModels.join(", ")}`,
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
  }
} finally {
  store.close();
}
