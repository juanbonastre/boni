/**
 * The `![[…]]` the vault left in the texts, counted by class (image, PDF, other file, note, Obsidian view) and by
 * collection, with how many find their file or note in Boni: counts only, never what a text says (D-16), to decide
 * what each one becomes.
 */
import type { UserStore } from "@boni/store";
import { FILE_FIELD, FOLDER_FIELD } from "./paths.ts";

const EMBED = /!\[\[([^\]\n]*)\]\]/g;
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "bmp", "avif"]);
type Kind = "imagen" | "pdf" | "fichero" | "nota" | "vista";
const KINDS: { kind: Kind; name: string; finds: string }[] = [
  { kind: "imagen", name: "Imágenes", finds: "su fichero" },
  { kind: "pdf", name: "PDF", finds: "su fichero" },
  { kind: "fichero", name: "Otros ficheros", finds: "su fichero" },
  { kind: "nota", name: "Notas", finds: "su nota" },
  { kind: "vista", name: "Vistas de Obsidian (.base)", finds: "" },
];

/** What an embed points to, without its alias or section: "a/b/c.png|c.png" → "a/b/c.png". */
const targetOf = (inner: string) => (inner.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";

function kindOf(target: string): Kind {
  const ext = /\.([a-z][a-z0-9]{0,4})$/i.exec(target)?.[1]?.toLowerCase();
  if (!ext || ext === "md") return "nota";
  if (ext === "base") return "vista";
  if (ext === "pdf") return "pdf";
  return IMAGES.has(ext) ? "imagen" : "fichero";
}

export function embedCounts(store: UserStore): string[] {
  const types = Object.values(store.schema().types).filter((t) => !t.system && !t.archived);
  // What Boni keeps: each file by its folder and name, and by its name alone; each other record by its title.
  const files = new Set<string>();
  const fileNames = new Set<string>();
  const titles = new Set<string>();
  for (const t of types)
    for (const e of store.entities(t.id)) {
      const title = String(e.values[t.titleField] ?? "")
        .trim()
        .toLowerCase();
      if (!title) continue;
      if (e.values[FILE_FIELD] === undefined) {
        titles.add(title);
        continue;
      }
      fileNames.add(title);
      const folder = String(e.values[FOLDER_FIELD] ?? "").replace(/\/+$/, "");
      files.add(`${folder.toLowerCase()}/${title}`);
    }
  const counts = new Map<Kind, { all: number; exact: number; byName: number }>();
  const byCollection = new Map<string, number>();
  let records = 0;
  for (const t of types)
    for (const e of store.entities(t.id)) {
      const hits = [...(e.body ?? "").matchAll(EMBED)];
      if (!hits.length) continue;
      records++;
      byCollection.set(t.name, (byCollection.get(t.name) ?? 0) + hits.length);
      for (const m of hits) {
        const target = targetOf(m[1] ?? "").toLowerCase();
        const kind = kindOf(target);
        const name = target.split("/").pop() ?? target;
        const c = counts.get(kind) ?? { all: 0, exact: 0, byName: 0 };
        c.all++;
        if (kind === "nota") {
          if (titles.has(name.replace(/\.md$/, ""))) c.exact++;
        } else if (kind !== "vista") {
          if (target.includes("/") && files.has(target)) c.exact++;
          else if (fileNames.has(name)) c.byName++;
        }
        counts.set(kind, c);
      }
    }
  const total = [...counts.values()].reduce((n, c) => n + c.all, 0);
  const lines = [
    `Incrustaciones de Obsidian (![[…]]): ${total} en ${records} ${records === 1 ? "registro" : "registros"}.`,
  ];
  for (const { kind, name, finds } of KINDS) {
    const c = counts.get(kind);
    if (!c) continue;
    if (!finds) {
      lines.push(`  ${name}: ${c.all}.`);
      continue;
    }
    const by = c.byName ? `, ${c.byName} solo por el nombre` : "";
    const verb = c.exact === 1 ? "encuentra" : "encuentran";
    lines.push(`  ${name}: ${c.all}; ${c.exact} ${verb} ${finds} en Boni${by}.`);
  }
  if (byCollection.size)
    lines.push(
      `Por colección: ${[...byCollection]
        .sort((a, b) => b[1] - a[1])
        .map(([n, k]) => `«${n}» ${k}`)
        .join(", ")}.`,
    );
  return lines;
}
