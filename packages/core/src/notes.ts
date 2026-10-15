import { Document, isScalar, parseDocument, Scalar, YAMLSeq } from "yaml";
import type { PropValue } from "./model.ts";

/**
 * Markdown notes with YAML properties ("frontmatter"), as Obsidian writes them. Reading never
 * fails; editing touches only the keys that change (comments, quoting, flow lists, key order and
 * blank lines of everything else survive), so a note edited by the app differs from the original
 * only in the lines that were really edited.
 */

export interface ParsedNote {
  /** Scalars and lists of scalars; nested maps and other shapes are left out (they stay in the file). */
  values: Record<string, PropValue>;
  /** Everything after the closing `---` line. */
  body: string;
  hasFrontmatter: boolean;
  /** Set when the properties could not be parsed; such a note must not be edited. */
  error?: string;
}

const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const OPTIONS = { nullStr: "", lineWidth: 0, flowCollectionPadding: false } as const;

interface Split {
  yaml: string;
  body: string;
  eol: "\n" | "\r\n";
  has: boolean;
}

function split(text: string): Split {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const m = FRONTMATTER.exec(text);
  if (!m) return { yaml: "", body: text, eol, has: false };
  return { yaml: m[1] ?? "", body: text.slice(m[0].length), eol, has: true };
}

function plain(v: unknown): PropValue | undefined {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  if (
    Array.isArray(v) &&
    v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x))
  ) {
    return v.filter((x) => x !== null).map(String);
  }
  return undefined;
}

export function parseNote(text: string): ParsedNote {
  const s = split(text);
  if (!s.has) return { values: {}, body: s.body, hasFrontmatter: false };
  const doc = parseDocument(s.yaml);
  const first = doc.errors[0];
  if (first) return { values: {}, body: s.body, hasFrontmatter: true, error: first.message };
  const js = doc.toJS();
  const values: Record<string, PropValue> = {};
  if (js && typeof js === "object" && !Array.isArray(js)) {
    for (const [k, v] of Object.entries(js)) {
      const p = plain(v);
      if (p !== undefined) values[k] = p;
    }
  } else if (js !== null && js !== undefined) {
    return { values: {}, body: s.body, hasFrontmatter: true, error: "properties are not a map" };
  }
  return { values, body: s.body, hasFrontmatter: true };
}

/** The whole properties block as plain data (nested maps included), for notes that hold structured definitions. */
export function frontmatterData(
  text: string,
): { data: Record<string, unknown> } | { error: string } {
  const s = split(text);
  if (!s.has) return { data: {} };
  const doc = parseDocument(s.yaml);
  const first = doc.errors[0];
  if (first) return { error: first.message };
  const js = doc.toJS();
  if (js === null || js === undefined) return { data: {} };
  if (typeof js !== "object" || Array.isArray(js)) return { error: "properties are not a map" };
  return { data: js as Record<string, unknown> };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A node for a new value: strings are always double-quoted ("09:30", "[[link]]"), lists use flow style. */
function nodeFor(doc: Document, v: Exclude<PropValue, null>): unknown {
  if (Array.isArray(v)) {
    const seq = new YAMLSeq();
    seq.flow = true;
    for (const x of v) seq.items.push(nodeFor(doc, x));
    return seq;
  }
  const n = new Scalar(v);
  if (typeof v === "string") n.type = "QUOTE_DOUBLE";
  return n;
}

function setKey(doc: Document, key: string, value: PropValue): void {
  const current = doc.get(key, true);
  // A scalar that stays a scalar is edited in place, so its comments survive. Strings are always
  // double-quoted unless the note already single-quoted them.
  if (isScalar(current) && !Array.isArray(value)) {
    const wasSingle = current.type === "QUOTE_SINGLE";
    current.value = value;
    current.type =
      typeof value === "string" ? (wasSingle ? "QUOTE_SINGLE" : "QUOTE_DOUBLE") : undefined;
    return;
  }
  doc.set(key, value === null ? new Scalar(null) : nodeFor(doc, value));
}

export class NoteError extends Error {}

/**
 * The note with `changes` applied: `undefined` removes a property, `null` leaves it empty
 * (`completed:`), anything else sets it. `opts.body` replaces the text after the properties.
 * Returns `text` itself when nothing changes. Throws `NoteError` when the properties cannot be parsed.
 */
export function patchNote(
  text: string,
  changes: Record<string, PropValue | undefined>,
  opts: { body?: string } = {},
): string {
  const s = split(text);
  const doc = s.has ? parseDocument(s.yaml) : new Document({});
  const first = doc.errors[0];
  if (first) throw new NoteError(first.message);
  if (s.has && doc.contents !== null && !doc.contents) throw new NoteError("empty properties");
  const current = (doc.toJS() ?? {}) as Record<string, unknown>;
  let touched = false;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      if (key in current) {
        doc.delete(key);
        touched = true;
      }
    } else if (!(key in current) || !same(plain(current[key]), value)) {
      setKey(doc, key, value);
      touched = true;
    }
  }
  const body = opts.body ?? s.body;
  if (!touched && body === s.body) return text;
  const yamlText = touched ? doc.toString(OPTIONS).replace(/\n$/, "") : s.yaml;
  const out = `---\n${yamlText}${yamlText ? "\n" : ""}---\n${body}`;
  return s.eol === "\r\n" ? out.replace(/\r?\n/g, "\r\n") : out;
}

/** A new note: the properties in `order` first, then the rest, then the body. */
export function formatNote(
  values: Record<string, PropValue>,
  body: string,
  order: readonly string[] = [],
): string {
  const doc = new Document({});
  const keys = [
    ...order.filter((k) => k in values),
    ...Object.keys(values).filter((k) => !order.includes(k)),
  ];
  for (const k of keys) {
    const v = values[k];
    if (v !== undefined) setKey(doc, k, v);
  }
  const yamlText = keys.length ? doc.toString(OPTIONS).replace(/\n$/, "") : "";
  return `---\n${yamlText}${yamlText ? "\n" : ""}---\n${body}`;
}
