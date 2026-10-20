import { createRequire } from "node:module";
import { type PropValue, parseNote } from "@boni/calendar";
import type { Debt, Movement } from "@boni/views";

/**
 * The money notes of the vault (registros/finanzas/README.md), ported from the first Boni's
 * sources/finanzas.py. That server read them through vault-mcp; this one reads the vault it already
 * serves, through the desktop shell's vault-fs.cjs (confined to the vault, never private/ or
 * restricted/), and writes new movement notes with `create`, which never replaces a note.
 * The only module that knows the finance note formats.
 */
const FIN = "registros/finanzas";
export const MOV = `${FIN}/movimientos`;
const DEBTS = `${FIN}/deudas`;
const CATEGORIES_NOTE = `${FIN}/categorias.md`;
const PEOPLE = "registros/personas";

export interface Person {
  slug: string;
  label: string;
  hint: string | null;
}

interface VaultFs {
  scan(dir: string): { path: string; mtimeMs: number; size: number }[];
  read(path: string): { text: string; mtimeMs: number };
  create(path: string, text: string): { exists: boolean };
}
const require = createRequire(import.meta.url);
const { openVault } = require("../../../calendar-desktop/vault-fs.cjs") as {
  openVault: (root: string) => VaultFs;
};

/** "[[name|alias]]" -> "name". */
export function linkName(v: unknown): string {
  let s = String(v ?? "").trim();
  if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
  return (s.split("|", 1)[0] ?? "").split("#", 1)[0]?.trim() ?? "";
}
const asList = (v: unknown): unknown[] =>
  v === null || v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v];
export function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
}
export const noteName = (path: string) => (path.split("/").pop() ?? "").replace(/\.md$/, "");
const pyStr = (v: unknown) =>
  v === null || v === undefined || v === "" || v === false || v === 0 ? "" : String(v);
function isoDay(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() ? s : null;
}

export function parseMovement(row: Record<string, unknown> & { path: string }): Movement | null {
  const date = isoDay(row.date);
  const amount = toFloat(row.amount);
  if (date === null || amount === null) return null;
  return {
    name: noteName(row.path),
    date,
    amount,
    category: pyStr(row.category),
    my_share: toFloat(row.my_share),
    settles: linkName(row.settles),
    people: asList(row.people).map(linkName),
    invited: asList(row.invited).map(linkName),
    related: asList(row.related).map(linkName),
    account: pyStr(row.account),
    merchant: pyStr(row.merchant).trim(),
    concept: pyStr(row.concept).trim(),
    status: pyStr(row.status),
    source: pyStr(row.source),
  };
}

export function parseDebt(
  row: Record<string, unknown> & { path: string },
): (Debt & { date: string | null }) | null {
  const amount = toFloat(row.amount);
  if (amount === null) return null;
  return {
    name: noteName(row.path),
    movement: linkName(row.movement),
    amount: Math.abs(amount),
    direction: pyStr(row.direction) || "me-deben",
    status: pyStr(row.status),
    date: isoDay(row.date),
  };
}

export const titleFromSlug = (slug: string) =>
  slug
    .split("-")
    .filter((w) => w)
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");

/** The `categories:` list of categorias.md's properties (block or flow list). */
export function parseCategories(text: string): string[] {
  const out: string[] = [];
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") return out;
  let inKey = false;
  const unquote = (s: string) => s.replace(/^["']+|["']+$/g, "");
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    if (line.startsWith("categories:")) {
      const rest = line.split(":").slice(1).join(":").trim();
      if (rest.startsWith("[") && rest.endsWith("]"))
        return rest
          .slice(1, -1)
          .split(",")
          .filter((x) => x.trim())
          .map((x) => unquote(x.trim()));
      inKey = true;
      continue;
    }
    if (inKey) {
      const s = line.trim();
      if (s.startsWith("- ")) out.push(unquote(s.slice(2).trim()));
      else if (s && !line.startsWith(" ")) inKey = false;
    }
  }
  return out;
}

/** The money notes of one vault, read again only when a note's time or size changed. */
export class Finanzas {
  private fs: VaultFs;
  private notes = new Map<string, { stamp: string; values: Record<string, PropValue> }>();

  constructor(root: string) {
    this.fs = openVault(root);
  }

  private rows(dir: string, type: string): (Record<string, unknown> & { path: string })[] {
    let files: { path: string; mtimeMs: number; size: number }[];
    try {
      files = this.fs.scan(dir);
    } catch {
      return []; // no such folder yet: nothing there
    }
    const out: (Record<string, unknown> & { path: string })[] = [];
    for (const f of files.sort((a, b) => (a.path < b.path ? -1 : 1))) {
      const stamp = `${f.mtimeMs}:${f.size}`;
      let cached = this.notes.get(f.path);
      if (cached?.stamp !== stamp) {
        const parsed = parseNote(this.fs.read(f.path).text);
        cached = { stamp, values: parsed.error ? {} : parsed.values };
        this.notes.set(f.path, cached);
      }
      if (cached.values.type === type) out.push({ ...cached.values, path: f.path });
    }
    return out;
  }

  movements(): Movement[] {
    return this.rows(MOV, "movement")
      .map(parseMovement)
      .filter((m): m is Movement => m !== null);
  }

  debts(): Debt[] {
    return this.rows(DEBTS, "debt")
      .map(parseDebt)
      .filter((d): d is Debt & { date: string | null } => d !== null);
  }

  categories(): string[] {
    return parseCategories(this.fs.read(CATEGORIES_NOTE).text);
  }

  people(): Person[] {
    return this.rows(PEOPLE, "person")
      .map((r) => ({
        slug: noteName(r.path),
        label: titleFromSlug(noteName(r.path)),
        hint: typeof r.summary === "string" && r.summary ? r.summary : null,
      }))
      .sort((a, b) =>
        a.label.toLowerCase() < b.label.toLowerCase()
          ? -1
          : a.label.toLowerCase() > b.label.toLowerCase()
            ? 1
            : 0,
      );
  }

  /** A fingerprint of every money note, to tell the apps when the data changed. */
  fingerprint(): string {
    const parts: string[] = [];
    for (const dir of [MOV, DEBTS])
      try {
        for (const f of this.fs.scan(dir)) parts.push(`${f.path}:${f.mtimeMs}:${f.size}`);
      } catch {
        // not there yet
      }
    return parts.sort().join("|");
  }

  /** Writes a movement note at movimientos/YYYY/MM/<base>[-N].md (never over another note); returns its path. */
  createMovement(date: string, base: string, content: string): string {
    const folder = `${MOV}/${date.slice(0, 4)}/${date.slice(5, 7)}`;
    let taken: Set<string>;
    try {
      taken = new Set(this.fs.scan(folder).map((f) => noteName(f.path)));
    } catch {
      taken = new Set();
    }
    for (let n = 1; n < 1000; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      if (taken.has(name)) continue;
      const path = `${folder}/${name}.md`;
      // A note of that name may have just arrived (another device, Syncthing): `create` says so; try the next.
      if (!this.fs.create(path, content).exists) return path;
    }
    throw new Error("could not find a free note name");
  }
}
