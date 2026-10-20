import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";
import type { ReadStore, ToolDef } from "./tools.ts";
import { deepLabel, type From, type Json, originsOf, plain, type Val } from "./values.ts";

/**
 * Confirmations (docs/nucleo.md, 7.5): painted by the code from the real arguments (never a model's
 * summary), with where each value came from and marks against visual deception, and bound to a hash
 * of the resolved values and of the versions of the entities they were read from. If anything
 * changes before it runs, the hash differs and Juan is asked again (A7); a confirmation is used once.
 */
export interface ConfirmRow {
  arg: string;
  role: string;
  /** The whole value as text: never cut. */
  value: string;
  integrity: string;
  sources: string[];
  marks: string[];
}
export interface ConfirmView {
  tool: string;
  title: string;
  rows: ConfirmRow[];
}

/** Code points that do not show, or that turn the text around (written as numbers on purpose). */
const INVISIBLE: readonly [number, number][] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
];
const BIDI: readonly [number, number][] = [
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];
const has = (text: string, ranges: readonly [number, number][]) =>
  [...text].some((ch) => {
    const c = ch.codePointAt(0) as number;
    return ranges.some(([a, b]) => c >= a && c <= b);
  });
const LATIN = /\p{Script=Latin}/u;
const CONFUSABLE = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}]/u;
export const LONG_TEXT = 2000;

/** What a value deserves a warning for. */
export function marksOf(text: string): string[] {
  const out: string[] = [];
  if (has(text, BIDI)) out.push("bidi");
  if (has(text, INVISIBLE)) out.push("invisible");
  if (text.split(/[\s@./:]+/).some((w) => LATIN.test(w) && CONFUSABLE.test(w)))
    out.push("mixed-script");
  for (const m of text.matchAll(/@([^\s>]+)|:\/\/([^/\s:?#]+)/g)) {
    const host = (m[1] ?? m[2] ?? "").toLowerCase();
    if ([...host].some((c) => (c.codePointAt(0) as number) > 0x7f))
      out.push(`punycode:${domainToASCII(host) || "?"}`);
  }
  if ([...text].length > LONG_TEXT) out.push("long");
  return [...new Set(out)];
}

const show = (v: Json): string => (typeof v === "string" ? v : JSON.stringify(v));

export function confirmView(tool: ToolDef, args: Readonly<Record<string, Val>>): ConfirmView {
  return {
    tool: tool.name,
    title: tool.title,
    rows: Object.entries(args).map(([name, v]) => {
      const l = deepLabel(v);
      const value = show(plain(v));
      return {
        arg: name,
        role: tool.args[name]?.role ?? "?",
        value,
        integrity: l.integrity,
        sources: l.sources.map((s) => s.kind),
        marks: marksOf(value),
      };
    }),
  };
}

/** The versions the arguments depend on: where they were read from, and the entities they name. */
export function originsFor(
  tool: ToolDef,
  args: Readonly<Record<string, Val>>,
  store: ReadStore,
): From[] {
  const out: From[] = [];
  for (const [name, v] of Object.entries(args)) {
    originsOf(v, out);
    if (tool.args[name]?.role === "entity") {
      const id = plain(v);
      if (typeof id === "string") out.push({ e: id, v: store.get(id)?.entity.version ?? -1 });
    }
  }
  const seen = new Map(out.map((o) => [`${o.e}@${o.v}`, o]));
  return [...seen.values()].sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : a.v - b.v));
}

/** Whether every version is still the current one. */
export const stillCurrent = (origins: readonly From[], store: ReadStore) =>
  origins.every((o) => (store.get(o.e)?.entity.version ?? -1) === o.v);

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
};

export function confirmHash(
  tool: ToolDef,
  args: Readonly<Record<string, Val>>,
  origins: readonly From[],
): string {
  const values = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, plain(v)]));
  return createHash("sha256")
    .update(canonical({ tool: tool.name, values, origins }))
    .digest("hex");
}
