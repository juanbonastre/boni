/**
 * Expressions: what an `{ expr }` says and what it cites (docs/automatizaciones.md §5.3, §6). Until F14c an expression
 * is text with simple citations between `{{ }}`: a field of the current row or of a step before, which is what
 * dragging a field writes (AU-21). The server resolves them with no sandbox, and a value that is one citation and
 * nothing else keeps the exact label of the field it cites (AU-162). JavaScript enters here in F14c (AU-22): the
 * `code` part is its place, and until then validation refuses it.
 *
 * The grammar of a simple citation (the names are n8n's where the thing is the same, §10):
 *
 *   $json.total                         a field of the current row
 *   $json.padre.nombre                  a field of a related row (one level, AU-120)
 *   $json["mi-campo"]                   a key that is not a JavaScript identifier (dots and brackets may mix)
 *   $('Buscar filas').item.total        the row of that step the current one comes from (AU-13)
 *   $('Buscar filas').first().total     its first row; `.last()`, its last
 *
 * A step's name is quoted with ' or ", with \ before a quote or a backslash inside it. Spaces around a citation,
 * inside `{{ }}`, do not count. Anything else between `{{ }}` is `code`: `.all()` too, which gives a list of rows
 * and not a field (it works from F14c; what the app says for `noPair` names it, AU-13).
 */
import { join, type Label, type Labeled } from "@boni/entities";
import { isExpr, type ParamValue } from "./format.ts";
import { isWholeExpression, renameInCode } from "./javascript.ts";
import { type Cell, cellOf, type Row } from "./rows.ts";

export interface Citation {
  /** The step cited, by its name; null for the current row (`$json`). */
  step: string | null;
  /** Which of its rows: the one the current row comes from, the first or the last. `$json` is always `item`. */
  pick: "item" | "first" | "last";
  /** The field's key, then the keys inside it. Never empty: a citation names a field. */
  path: string[];
}

export type ExprPart =
  | { kind: "text"; text: string }
  | { kind: "cite"; cite: Citation }
  /** Not a simple citation. F14c: JavaScript for the sandbox. Until then, the problem `expr.code`. */
  | { kind: "code"; source: string };

/**
 * A part with where it is in the text: for a citation, the span of the citation itself (not of its `{{ }}`); for code,
 * the span of its `{{ }}`, and `at`, where its source starts.
 */
type Spanned = ExprPart & { start: number; end: number; at?: number };

const IDENT = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u;
const IDENT_AT = /[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*/uy;
const SPACE = /\s*/y;

/** A quoted text at `i` (' or ", with \ before a quote or a backslash): its value and where it ends, or null. */
function quoted(s: string, i: number): { value: string; end: number } | null {
  const q = s[i];
  if (q !== "'" && q !== '"') return null;
  let value = "";
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === q) return { value, end: j + 1 };
    if (c === "\\") {
      const next = s[j + 1];
      if (next !== q && next !== "\\") return null;
      value += next;
      j++;
    } else value += c;
  }
  return null;
}

const skip = (s: string, i: number) => {
  SPACE.lastIndex = i;
  SPACE.exec(s);
  return SPACE.lastIndex;
};

/** A citation starting at `i`, or null: its value and where it ends. */
function citation(s: string, i: number): { cite: Citation; end: number } | null {
  let step: string | null = null;
  let pick: Citation["pick"] = "item";
  let j: number;
  if (s.startsWith("$json", i)) {
    j = i + 5;
  } else if (s.startsWith("$(", i)) {
    const q = quoted(s, skip(s, i + 2));
    if (!q) return null;
    j = skip(s, q.end);
    if (s[j] !== ")") return null;
    step = q.value;
    j++;
    if (s.startsWith(".item", j)) j += 5;
    else if (s.startsWith(".first()", j)) [pick, j] = ["first", j + 8];
    else if (s.startsWith(".last()", j)) [pick, j] = ["last", j + 7];
    else return null;
  } else return null;
  const path: string[] = [];
  for (;;) {
    if (s[j] === ".") {
      IDENT_AT.lastIndex = j + 1;
      const m = IDENT_AT.exec(s);
      if (!m) break;
      path.push(m[0]);
      j = IDENT_AT.lastIndex;
    } else if (s[j] === "[") {
      const q = quoted(s, j + 1);
      if (!q || s[q.end] !== "]") break;
      path.push(q.value);
      j = q.end + 1;
    } else break;
  }
  // What follows a citation is the end of its `{{ }}`, or it is code (a call, an operator, `.all()`).
  if (!path.length) return null;
  return { cite: { step, pick, path }, end: j };
}

/** The end of the `{{` at `open`: the first `}}` that leaves a whole JavaScript expression before it, else the first. */
function closing(expr: string, open: number): number {
  const first = expr.indexOf("}}", open + 2);
  for (let c = first; c >= 0; c = expr.indexOf("}}", c + 1))
    if (isWholeExpression(expr.slice(open + 2, c))) return c;
  return first;
}

function scan(expr: string): { parts: Spanned[]; open?: number } {
  const parts: Spanned[] = [];
  let open: number | undefined;
  const text = (t: string, start: number) => {
    if (!t) return;
    const last = parts[parts.length - 1];
    if (last?.kind === "text") {
      last.text += t;
      last.end = start + t.length;
    } else parts.push({ kind: "text", text: t, start, end: start + t.length });
  };
  let i = 0;
  while (i < expr.length) {
    const from = expr.indexOf("{{", i);
    if (from < 0) break;
    const inner = skip(expr, from + 2);
    const c = citation(expr, inner);
    const after = c ? skip(expr, c.end) : -1;
    if (c && expr.startsWith("}}", after)) {
      text(expr.slice(i, from), i);
      parts.push({ kind: "cite", cite: c.cite, start: inner, end: c.end });
      i = after + 2;
      continue;
    }
    const close = closing(expr, from);
    // An unclosed `{{` is text (and, for validation, `code.syntax`: `codeParts`).
    if (close < 0) {
      open = from;
      break;
    }
    text(expr.slice(i, from), i);
    parts.push({
      kind: "code",
      source: expr.slice(from + 2, close).trim(),
      start: from,
      end: close + 2,
      at: inner,
    });
    i = close + 2;
  }
  text(expr.slice(i), i);
  return open === undefined ? { parts } : { parts, open };
}

const parse = (expr: string): Spanned[] => scan(expr).parts;

/** An expression's text in parts, in order. Never throws: what it cannot read as a citation is `code`. */
export function parseExpression(expr: string): ExprPart[] {
  return parse(expr).map(({ start: _s, end: _e, at: _a, ...part }) => part as ExprPart);
}

/**
 * The JavaScript of an expression's text: each code part's source with where it starts in the text, and where a `{{`
 * that never closes is (AU-22: it does not validate). What validation and the editor read (javascript.ts).
 */
export function codeParts(expr: string): {
  parts: { source: string; at: number }[];
  open?: number;
} {
  const { parts, open } = scan(expr);
  const out = parts.flatMap((p) =>
    p.kind === "code" ? [{ source: p.source, at: p.at ?? p.start + 2 }] : [],
  );
  return open === undefined ? { parts: out } : { parts: out, open };
}

/** The parts written back as a text: what `parseExpression` reads as the same parts (AU-22). */
export function printExpression(parts: readonly ExprPart[]): string {
  return parts
    .map((p) =>
      p.kind === "text"
        ? p.text
        : p.kind === "cite"
          ? `{{ ${printCitation(p.cite)} }}`
          : `{{ ${p.source} }}`,
    )
    .join("");
}

const quote = (t: string, q: string) =>
  `${q}${t.replace(/[\\'"]/g, (c) => (c === q || c === "\\" ? `\\${c}` : c))}${q}`;

/** A citation as it is written, in its shortest form (a dot where the key is an identifier, `["…"]` where not). */
export function printCitation(cite: Citation): string {
  const head =
    cite.step === null
      ? "$json"
      : `$(${quote(cite.step, "'")})${cite.pick === "item" ? ".item" : cite.pick === "first" ? ".first()" : ".last()"}`;
  return head + cite.path.map((k) => (IDENT.test(k) ? `.${k}` : `[${quote(k, '"')}]`)).join("");
}

/** Every citation in a parameter's value, however deep (a list's rows, a condition's values), in order. */
export function citationsIn(value: ParamValue): Citation[] {
  if (isExpr(value))
    return parseExpression(value.expr).flatMap((p) => (p.kind === "cite" ? [p.cite] : []));
  if (Array.isArray(value)) return value.flatMap(citationsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(citationsIn);
  return [];
}

/** An expression's text with every citation of the step named `from` citing `to` instead; the rest untouched (AU-02). */
export function renameInExpression(expr: string, from: string, to: string): string {
  let out = "";
  let i = 0;
  for (const p of parse(expr)) {
    if (p.kind !== "cite" || p.cite.step !== from) continue;
    out += expr.slice(i, p.start) + printCitation({ ...p.cite, step: to });
    i = p.end;
  }
  return out + expr.slice(i);
}

/**
 * `renameInExpression`, and in the JavaScript of every other `{{ }}` each `$('from')` written as `$('to')`
 * (`renameInCode`): what renaming a step does to a value (AU-02, F14c). Text and comments stay as they are.
 */
export function renameInText(expr: string, from: string, to: string): string {
  let out = "";
  let i = 0;
  for (const p of parse(expr)) {
    if (p.kind !== "code" || p.at === undefined) continue;
    const renamed = renameInCode(p.source, from, to);
    if (renamed === p.source) continue;
    out += expr.slice(i, p.at) + renamed;
    i = p.at + p.source.length;
  }
  return renameInExpression(out + expr.slice(i), from, to);
}

/**
 * A value from its parts and what each `{{ }}` gave, in order (AU-22): a value that is one `{{ }}` alone keeps the type
 * of what it gave (a number, a list, a date as the box gives it); with text around it, it is text, and each value is
 * written in it as text: `null` as nothing, a number with its digits, a list or an object as its JSON.
 */
export function joinParts(parts: readonly ExprPart[], values: readonly Cell[]): Cell {
  if (parts.length === 1 && parts[0]?.kind !== "text") return values[0] ?? null;
  let i = 0;
  return parts
    .map((p) => {
      if (p.kind === "text") return p.text;
      const v = values[i++] ?? null;
      return v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    })
    .join("");
}

// ---------------------------------------------------------------- resolving

/**
 * Why a citation gave no value: a key, and each app says it in its `i18n.ts`. What it says for `noPair` proposes
 * `.first()` or `.all()` (AU-13).
 */
export type CiteFailure =
  /** No step has that name (validation catches it first). */
  | "unknownStep"
  /** The step did not run in this execution, or was skipped. */
  | "notRun"
  /** `.first()` or `.last()` of a step that gave no rows. */
  | "noRows"
  /** `.item`: a step that remade the rows stands between, or the current row does not come from that step. */
  | "noPair"
  /** `$json` or `.item` where there is no current row: a step that works with all the rows, or one run with none. */
  | "noCurrentRow";

export class CiteError extends Error {
  readonly failure: CiteFailure;
  readonly cite: Citation;
  constructor(failure: CiteFailure, cite: Citation) {
    super(`${failure}: ${cite.step ?? "$json"}`);
    this.name = "CiteError";
    this.failure = failure;
    this.cite = cite;
  }
}

/** What an expression is resolved against: the engine builds one per step and per row (engine.ts). */
export interface Scope {
  /** The current row; null in a step that works with all the rows at once, or that runs with an empty list. */
  current: Row | null;
  /** The row a citation of a step picks. Throws `CiteError`. */
  row(step: string, pick: Citation["pick"]): Row;
  /** The label of what Juan wrote in the automation: its fixed values and the text around a citation. */
  literal: Label;
}

/**
 * A parameter's value for one row, with its label (AU-162):
 * - a fixed value: itself, with `scope.literal`, not derived;
 * - one citation and nothing else: the field's value with its type and its exact label, derived only if the field
 *   was; a field the row does not have is null with the row's label;
 * - text with citations: a string, with the joined label of `scope.literal` and of every field cited, derived (it
 *   can never be a destination, P14);
 * - a structure: each value inside it, resolved the same way; its label is the join of them all.
 * Throws `CiteError`, and an Error for a `code` part (F14c).
 */
export function resolve(value: ParamValue, scope: Scope): Labeled<Cell> {
  if (isExpr(value)) return resolveExpr(value.expr, scope);
  if (Array.isArray(value)) {
    const items = value.map((v) => resolve(v, scope));
    return {
      value: items.map((x) => x.value),
      label: join(scope.literal, ...items.map((x) => x.label)),
      derived: items.some((x) => x.derived),
    };
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => [k, resolve(v, scope)] as const);
    return {
      value: Object.fromEntries(entries.map(([k, x]) => [k, x.value])),
      label: join(scope.literal, ...entries.map(([, x]) => x.label)),
      derived: entries.some(([, x]) => x.derived),
    };
  }
  return { value, label: scope.literal, derived: false };
}

/** The field a citation names, with its label: null with the row's label when the row does not have it. */
export function citeValue(c: Citation, scope: Scope): Labeled<Cell> {
  let row: Row;
  if (c.step === null) {
    if (!scope.current) throw new CiteError("noCurrentRow", c);
    row = scope.current;
  } else
    try {
      row = scope.row(c.step, c.pick);
    } catch (e) {
      // The scope knows why; the citation is this one.
      throw e instanceof CiteError ? new CiteError(e.failure, c) : e;
    }
  return cellOf(row, c.path) ?? { value: null, label: row.label, derived: false };
}

/** A value in text, as it is joined with the text around it. */
const asText = (v: Cell): string =>
  v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

function resolveExpr(expr: string, scope: Scope): Labeled<Cell> {
  const parts = parseExpression(expr);
  for (const p of parts)
    if (p.kind === "code")
      throw new Error("expr.code: JavaScript in an expression arrives in F14c");
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only?.kind === "cite") return citeValue(only.cite, scope);
  const cited = parts.flatMap((p) => (p.kind === "cite" ? [citeValue(p.cite, scope)] : []));
  if (!cited.length)
    return {
      value: parts.map((p) => (p.kind === "text" ? p.text : "")).join(""),
      label: scope.literal,
      derived: false,
    };
  let k = 0;
  const value = parts
    .map((p) => (p.kind === "text" ? p.text : asText((cited[k++] as Labeled<Cell>).value)))
    .join("");
  return { value, label: join(scope.literal, ...cited.map((c) => c.label)), derived: true };
}
