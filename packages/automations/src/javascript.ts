/**
 * Reading JavaScript before it runs (docs/automatizaciones.md AU-24, AU-31, AU-36, AU-163): what an expression or a
 * «Código» cites (steps, fields, collections, the clock), where, and what is wrong with it. The server decides with it
 * what an evaluation receives, validation refuses what cannot be read beforehand, the editor marks and completes with
 * it, and a step's rename rewrites it (AU-02). It reads the code's shape and never runs it. It is not what keeps the
 * code in: that is the box, which gets only what the server sends it (box.ts).
 *
 * The parser is acorn (MIT, no dependencies): it gives the tree with every node's place, and nothing here walks text.
 */
import { type Options, parse, parseExpressionAt } from "acorn";
import { COL_METHODS, type CodeProblem, WRITE_ACTIONS, type WriteAction } from "./code.ts";
import type { Automation, Step } from "./format.ts";
import type { ValidationContext } from "./validate.ts";
// writes.ts imports readCode back: both modules use each other's values only inside functions, never at the top.
import type { WriteSite } from "./writes.ts";

/**
 * Everything code can name that is not JavaScript's own, the same in an expression and in «Código» (AU-24); `$col`
 * only in «Código» (AU-46). The names are n8n's where the thing is the same (§10).
 */
export const CODE_GLOBALS = [
  /** The current row's fields, by key (AU-25). Not in «Una vez con todas las filas». */
  "$json",
  /** The step's input: `.all()`, `.first()`, `.last()` and `.item` (the current row). Rows are their fields. */
  "$input",
  /** `$('Step name')`: `.all()`, `.first()`, `.last()` and `.item` (the row this one comes from, AU-13). */
  "$",
  /** `$col('Collection name')`: `.find({ where, sort, limit })`, `.get(id)`, `.count({ where })`, `.sum(field, { where })` (AU-31). */
  "$col",
  /** The run's instant, the same in every step and every row of the run (AU-34), as a date of `DATE_HELP`. */
  "$now",
  /** The run's day in Juan's time zone, at 00:00. */
  "$today",
  /** `{ test, startedBy }`: whether it is a test, and what started it ("user" in F14c). Never a name or an id. */
  "$run",
  /** The values of the page that started it (F17). `null` until then. */
  "$page",
  /** `$date(value)`: a date of `DATE_HELP` from a field's value ("YYYY-MM-DD" or an instant in ms). */
  "$date",
  /** `console.log`, `.info`, `.warn`, `.error`: lines of «Consola» (AU-33). */
  "console",
] as const;
export type CodeGlobal = (typeof CODE_GLOBALS)[number];

/**
 * The dates' help, small and its own (AU-28): what `$now`, `$today` and `$date(…)` have. Wall-clock math is
 * `packages/calendar/src/time.ts`'s, in Juan's time zone; the box has no `Intl`, so the server sends with each call
 * the zone's offsets it will need, and `format` takes only the patterns listed. Units: `DateUnit` of effects.ts.
 */
export const DATE_HELP = {
  /** `.plus({ days: 7 })`, `.minus({ months: 1 })`, `.startOf('month')`, `.endOf('week')`, `.diff(other, 'days')`. */
  methods: ["plus", "minus", "startOf", "endOf", "diff", "format", "toISO", "toDay", "toMillis"],
  /** Read-only numbers: `.weekday` is 1 (Monday) to 7. */
  parts: ["year", "month", "day", "weekday", "hour", "minute"],
  /** What `.format(…)` takes: these tokens and plain text between them. Month and day names in the run's language. */
  tokens: ["yyyy", "yy", "MMMM", "MMM", "MM", "M", "dd", "d", "EEEE", "EEE", "HH", "H", "mm"],
} as const;

/**
 * The help with text and lists is JavaScript's own (`String`, `Array`, `Object`, `Math`, `JSON`), which the box has
 * whole, and nothing added to their prototypes: n8n's extra methods on values are not promised (AU-24, AU-37).
 */
export const OWN_HELP = [
  "String",
  "Array",
  "Object",
  "Math",
  "JSON",
  "Number",
  "RegExp",
  "Map",
  "Set",
] as const;

/** A place in the source: offsets, and the line and column of `from` (1-based). */
export interface Span {
  from: number;
  to: number;
  line: number;
  column: number;
}

/** Which fields of some rows the code reads: their keys when every use names one (`$json.precio`), else all. */
export type FieldsRead = readonly string[] | "all";

export interface CodeReading {
  /** `$json` and `$input`: what it reads of the step's own input; null when it reads none. */
  input: { fields: FieldsRead; current: boolean; all: boolean; at: readonly Span[] } | null;
  /** `$('Name')`: one entry per step cited, by name. `item`: it asks for the paired row (AU-13). */
  steps: readonly {
    name: string;
    fields: FieldsRead;
    item: boolean;
    all: boolean;
    at: readonly Span[];
  }[];
  /** `$col('Name')`: one entry per collection cited, by the name written, to read or to save. */
  collections: readonly { name: string; at: readonly Span[] }[];
  /**
   * Every call that asks to save (`$col('Name').create(…)`, `.update(…)`, `.remove(…)`), in the order of the source,
   * wherever it sits: an `if` never taken, a loop, a function never called (AU-183). None in an expression.
   */
  writes: readonly WriteSite[];
  /** `$now`, `$today` or `$date`; `$run`; `$page`. */
  uses: { clock: boolean; run: boolean; page: boolean };
  /** What is wrong in the code by itself: syntax, a computed name, an unknown `$name`, code that waits. */
  problems: readonly CodeProblem[];
}

// ---------------------------------------------------------------- reading

type Pos = { line: number; column: number };
/** A node of acorn's tree, read loosely: its type, where it is, and its children by key. */
interface N {
  type: string;
  start: number;
  end: number;
  loc: { start: Pos };
  [key: string]: unknown;
}
const isNode = (v: unknown): v is N =>
  typeof v === "object" && v !== null && typeof (v as N).type === "string";

const OPTIONS: Options = {
  ecmaVersion: "latest",
  sourceType: "script",
  locations: true,
  allowReturnOutsideFunction: true,
  // What cannot wait is said as `code.cannotWait`, not as a syntax error: so they parse.
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
};

type Parsed = { root: N } | { error: { message: string; at: Span } };

const spanOf = (n: N): Span => ({
  from: n.start,
  to: n.end,
  line: n.loc.start.line,
  column: n.loc.start.column + 1,
});

/** Where an offset of the source is, as a span of nothing. */
function spanAt(source: string, at: number): Span {
  const before = source.slice(0, at).split("\n");
  return { from: at, to: at, line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}

function syntaxError(source: string, e: unknown): Parsed {
  const err = e as { message?: string; pos?: number };
  const at = typeof err.pos === "number" ? err.pos : 0;
  return {
    error: {
      message: String(err.message ?? e).replace(/ \(\d+:\d+\)$/, ""),
      at: spanAt(source, at),
    },
  };
}

/**
 * The tree of a piece of code. An expression is one expression that gives a value and nothing after it but spaces and
 * comments: not an assignment, not two with a comma (AU-22). A «Código» is a function's body.
 */
function parseCode(source: string, as: "expression" | "code"): Parsed {
  try {
    if (as === "code") return { root: parse(source, OPTIONS) as unknown as N };
    const root = parseExpressionAt(source, 0, OPTIONS) as unknown as N;
    // Without `preserveParens` a node of `(a)` ends before its `)`: where the whole expression ends, with them.
    const end = (parseExpressionAt(source, 0, { ...OPTIONS, preserveParens: true }) as unknown as N)
      .end;
    let rest: { body: N[] };
    try {
      rest = parse(source.slice(end), { ...OPTIONS, locations: false }) as unknown as { body: N[] };
    } catch (e) {
      // What follows was read on its own: its error is placed in the whole source.
      const err = e as { pos?: number };
      throw Object.assign(e as object, { pos: end + (err.pos ?? 0) });
    }
    if (rest.body.length) {
      const next = rest.body[0] as N;
      return {
        error: {
          message: "an expression gives one value and nothing after it",
          at: spanAt(source, end + next.start),
        },
      };
    }
    if (root.type === "AssignmentExpression" || root.type === "UpdateExpression")
      return {
        error: { message: "an expression gives a value: it does not assign", at: spanOf(root) },
      };
    if (root.type === "SequenceExpression")
      return { error: { message: "an expression gives one value, not several", at: spanOf(root) } };
    return { root };
  } catch (e) {
    return syntaxError(source, e);
  }
}

/** Whether a text is one whole expression (what closes a `{{ }}`, AU-22). */
export const isWholeExpression = (source: string): boolean =>
  "root" in parseCode(source, "expression");

/** Where a node hangs: its parent and the key. */
type Where = { parent: N; key: string };

/** Every node but the root with its parent and the key it hangs from. */
function parents(root: N): Map<N, Where> {
  const up = new Map<N, Where>();
  const todo = [root];
  while (todo.length) {
    const n = todo.pop() as N;
    for (const key of Object.keys(n)) {
      if (key === "loc") continue;
      const v = n[key];
      for (const c of Array.isArray(v) ? v : [v])
        if (isNode(c)) {
          up.set(c, { parent: n, key });
          todo.push(c);
        }
    }
  }
  return up;
}

/** The identifiers that declare a name (a variable, a parameter, a function's or a class's name), and the names. */
function bindings(up: Map<N, Where>): { nodes: Set<N>; names: Set<string> } {
  const nodes = new Set<N>();
  const names = new Set<string>();
  const pattern = (p: unknown): void => {
    if (!isNode(p)) return;
    if (p.type === "Identifier") {
      nodes.add(p);
      names.add(String(p.name));
    } else if (p.type === "ObjectPattern")
      for (const prop of p.properties as N[])
        pattern(prop.type === "RestElement" ? prop.argument : prop.value);
    else if (p.type === "ArrayPattern") for (const e of p.elements as unknown[]) pattern(e);
    else if (p.type === "AssignmentPattern") pattern(p.left);
    else if (p.type === "RestElement") pattern(p.argument);
  };
  for (const n of up.keys()) {
    if (n.type === "VariableDeclarator") pattern(n.id);
    else if (/Function/.test(n.type)) {
      pattern(n.id);
      for (const p of n.params as N[]) pattern(p);
    } else if (n.type === "CatchClause") pattern(n.param);
    else if (n.type === "ClassDeclaration" || n.type === "ClassExpression") pattern(n.id);
  }
  return { nodes, names };
}

/** Whether an identifier is a name used, not a property's or a label's. */
function isReference(at: Where | undefined): boolean {
  if (!at) return true;
  const { parent: p, key } = at;
  if (p.type === "MemberExpression" && key === "property" && !p.computed) return false;
  if (
    (p.type === "Property" || p.type === "MethodDefinition" || p.type === "PropertyDefinition") &&
    key === "key" &&
    !p.computed
  )
    return false;
  if (/^(Labeled|Break|Continue)Statement$/.test(p.type) || p.type === "MetaProperty") return false;
  return !/^(Import|Export)/.test(p.type);
}

/** The names of the global object. */
const GLOBAL_OBJECT = new Set(["globalThis", "self"]);

/** Whether a `this` is a class's or an object method's, never the global object. */
function inMethod(at: Where | undefined, up: Map<N, Where>): boolean {
  const method = (w: Where | undefined) =>
    w !== undefined &&
    (w.parent.type === "MethodDefinition" ||
      w.parent.type === "PropertyDefinition" ||
      (w.parent.type === "Property" &&
        (w.parent.method === true || w.parent.kind === "get" || w.parent.kind === "set")));
  for (let w = at; w; w = up.get(w.parent)) {
    if (w.parent.type === "PropertyDefinition") return true;
    // The nearest function that is not an arrow decides: a method's, or one that may be called on the global object.
    if (w.parent.type === "FunctionDeclaration" || w.parent.type === "FunctionExpression")
      return method(up.get(w.parent));
  }
  return false;
}

/** The pattern a value is taken apart by, when it is the value of `const { … } =` or `({ … } =)`. */
function destructured(at: Where | undefined): N | undefined {
  if (!at) return undefined;
  const { parent: p, key } = at;
  const target =
    p.type === "VariableDeclarator" && key === "init"
      ? (p.id as N)
      : p.type === "AssignmentExpression" && key === "right"
        ? (p.left as N)
        : undefined;
  return target?.type === "ObjectPattern" ? target : undefined;
}

/**
 * Whether taking the global object apart by a pattern takes more than written keys: the rest, a key computed, or the
 * global object again. `$` and `$col` in a pattern are `code.computed` already, wherever it takes them from.
 */
function takesGlobal(pattern: N): boolean {
  return (pattern.properties as N[]).some((p) => {
    if (p.type === "RestElement") return true;
    const k = p.computed ? literalText(p.key) : String((p.key as N).name ?? literalText(p.key));
    return k === undefined || GLOBAL_OBJECT.has(k);
  });
}

/** A text written there: a string, or a template with no value in it. */
function literalText(n: unknown): string | undefined {
  if (!isNode(n)) return undefined;
  if (n.type === "Literal" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral" && (n.expressions as N[]).length === 0)
    return String(((n.quasis as N[])[0] as N & { value: { cooked: string } }).value.cooked);
  return undefined;
}

/** A property's key when it is written there: `.precio`, `['precio']`, `[0]`. */
function keyOf(member: N): string | undefined {
  if (!member.computed) return String((member.property as N).name);
  const p = member.property as N;
  if (p.type === "Literal" && (typeof p.value === "string" || typeof p.value === "number"))
    return String(p.value);
  return literalText(p);
}

const merge = (uses: readonly FieldsRead[]): FieldsRead => {
  if (uses.some((u) => u === "all")) return "all";
  return [...new Set(uses.flat() as string[])];
};

/**
 * What a row's value is used for, where `r` is the row (`$json`, `.first()`): a field written there, or the fields of
 * a destructuring with only keys written there. Anything else (handed on whole, a key calculated) reads all of it.
 */
function fieldsAt(r: N, up: Map<N, Where>): FieldsRead {
  const at = up.get(r);
  if (!at) return "all";
  const { parent: p, key } = at;
  if (p.type === "MemberExpression" && key === "object") {
    const k = keyOf(p);
    return k === undefined ? "all" : [k];
  }
  const pattern =
    p.type === "VariableDeclarator" && key === "init"
      ? (p.id as N)
      : p.type === "AssignmentExpression" && key === "right"
        ? (p.left as N)
        : undefined;
  if (pattern?.type === "ObjectPattern") {
    const keys: string[] = [];
    for (const prop of pattern.properties as N[]) {
      if (prop.type !== "Property") return "all";
      const k = prop.computed
        ? literalText(prop.key)
        : prop.key && (prop.key as N).type === "Identifier"
          ? String((prop.key as N).name)
          : literalText(prop.key);
      if (k === undefined) return "all";
      keys.push(k);
    }
    return keys;
  }
  return "all";
}

/** `x.name` and, when it is called with nothing, the call: `$input.first()`, `$('A').all()`. */
function picked(n: N, up: Map<N, Where>): { pick: string; end: N } | undefined {
  const at = up.get(n);
  if (at?.parent.type !== "MemberExpression" || at.key !== "object") return undefined;
  const m = at.parent;
  const pick = keyOf(m);
  if (pick === undefined) return undefined;
  if (pick === "item") return { pick, end: m };
  const call = up.get(m);
  if (call?.parent.type === "CallExpression" && call.key === "callee")
    return { pick, end: call.parent };
  return undefined;
}

const NONE: CodeReading["uses"] = { clock: false, run: false, page: false };

/**
 * Reads one piece of JavaScript: the inside of a `{{ }}` (an expression that gives a value) or a «Código» (a
 * function's body that returns). Total: code that is not JavaScript gives `code.syntax` and no citations.
 */
export function readCode(source: string, as: "expression" | "code"): CodeReading {
  const parsed = parseCode(source, as);
  const problems: CodeProblem[] = [];
  const problem = (
    code: CodeProblem["code"],
    at: Span,
    detail: Record<string, string | number> = {},
  ) => problems.push({ code, severity: "error", detail: { ...detail, ...placeOf(at) } });
  if ("error" in parsed) {
    problem("code.syntax", parsed.error.at, { message: parsed.error.message });
    return { input: null, steps: [], collections: [], writes: [], uses: { ...NONE }, problems };
  }
  const up = parents(parsed.root);
  const bound = bindings(up);
  const own = new Set(CODE_GLOBALS as readonly string[]);
  const input = { fields: [] as FieldsRead[], current: false, all: false, at: [] as Span[] };
  const steps = new Map<
    string,
    { fields: FieldsRead[]; item: boolean; all: boolean; at: Span[] }
  >();
  const collections = new Map<string, Span[]>();
  const writes: WriteSite[] = [];
  const uses = { ...NONE };

  /** A row, or a list of rows, cited: what it is picked as and what of it is read. */
  const rowsUse = (head: N, into: { fields: FieldsRead[]; all: boolean }, current?: () => void) => {
    const p = picked(head, up);
    if (!p) {
      into.fields.push("all");
      into.all = true;
      return;
    }
    if (p.pick === "item") current?.();
    if (p.pick === "all") into.all = true;
    if (p.pick === "item" || p.pick === "first" || p.pick === "last")
      into.fields.push(fieldsAt(p.end, up));
    else into.fields.push("all");
  };

  const nodes: [N, Where | undefined][] = [[parsed.root, undefined], ...up.entries()];
  for (const [n, at] of nodes.sort(([a], [b]) => a.start - b.start || b.end - a.end)) {
    if (n.type === "AwaitExpression" || (n.type === "ForOfStatement" && n.await))
      problem("code.cannotWait", spanOf(n), { what: "await" });
    else if (n.type === "ImportExpression" || n.type === "ImportDeclaration")
      problem("code.cannotWait", spanOf(n), { what: "import" });
    else if (/Function/.test(n.type) && (n.async || n.generator))
      problem("code.cannotWait", spanOf(n), { what: n.async ? "async" : "generator" });
    // `$` or `$col` taken out of the global object, by a destructuring or a member.
    if (n.type === "Property" && at?.parent.type === "ObjectPattern") {
      const k = n.computed ? literalText(n.key) : String((n.key as N).name ?? literalText(n.key));
      if (k === "$" || k === "$col")
        problem("code.computed", spanOf(n), { what: k === "$" ? "step" : "collection" });
    }
    // The global object (`globalThis`, `self`, or a `this` that may be it) is read only by a written key that is not
    // `$`, `$col` or the global object again: given another name, or handed to anything, it could reach them.
    const global =
      n.type === "ThisExpression"
        ? !inMethod(at, up)
        : n.type === "Identifier" &&
          GLOBAL_OBJECT.has(String(n.name)) &&
          !bound.names.has(String(n.name)) &&
          isReference(at);
    if (global) {
      const member =
        at?.parent.type === "MemberExpression" && at.key === "object" ? at.parent : undefined;
      const k = member ? keyOf(member) : undefined;
      const pattern = destructured(at);
      const takes = pattern
        ? takesGlobal(pattern)
        : k === undefined || k === "$" || k === "$col" || GLOBAL_OBJECT.has(k);
      if (takes)
        problem("code.computed", spanOf(member ?? n), {
          what: k === "$col" ? "collection" : "step",
        });
    }
    if (n.type !== "Identifier" || bound.nodes.has(n) || !isReference(at)) continue;
    const name = String(n.name);
    if (bound.names.has(name) || !name.startsWith("$")) continue;
    if (!own.has(name)) {
      problem("code.unknownGlobal", spanOf(n), { name });
      continue;
    }
    if (name === "$now" || name === "$today" || name === "$date") uses.clock = true;
    else if (name === "$run") uses.run = true;
    else if (name === "$page") uses.page = true;
    else if (name === "$json") {
      input.current = true;
      input.at.push(spanOf(n));
      input.fields.push(fieldsAt(n, up));
    } else if (name === "$input") {
      input.at.push(spanOf(n));
      rowsUse(n, input, () => {
        input.current = true;
      });
    } else if (name === "$" || name === "$col") {
      const what = name === "$" ? "step" : "collection";
      const call =
        at?.parent.type === "CallExpression" && at.key === "callee" ? at.parent : undefined;
      const args = (call?.arguments ?? []) as N[];
      const cited = args.length === 1 ? literalText(args[0]) : undefined;
      if (!call || cited === undefined) {
        problem("code.computed", spanOf(call ?? n), { what });
        continue;
      }
      if (name === "$col") {
        collections.set(cited, [...(collections.get(cited) ?? []), spanOf(call)]);
        // An expression reads no collection and saves nothing (AU-46, AU-184): that is its one problem.
        if (as === "expression") {
          problem("code.readInExpression", spanOf(call), { name: cited });
          continue;
        }
        // Only `$col('Nombre').método(…)`, for reading and for saving alike (AU-183): kept, passed or called by a
        // computed name, what it does could not be read here, so the analysis could not say what the code saves.
        const used = methodCalled(call, up);
        if ("why" in used) {
          problem("code.colUse", spanOf(used.at ?? call), {
            why: used.why,
            name: cited,
            ...(used.method !== undefined ? { method: used.method } : {}),
          });
          continue;
        }
        if ((WRITE_ACTIONS as readonly string[]).includes(used.method))
          writes.push({ name: cited, action: used.method as WriteAction, at: spanOf(used.at) });
        continue;
      }
      const s = steps.get(cited) ?? { fields: [], item: false, all: false, at: [] };
      steps.set(cited, s);
      s.at.push(spanOf(call));
      rowsUse(call, s, () => {
        s.item = true;
      });
    }
  }
  return {
    input: input.at.length
      ? { fields: merge(input.fields), current: input.current, all: input.all, at: input.at }
      : null,
    steps: [...steps].map(([name, s]) => ({
      name,
      fields: merge(s.fields),
      item: s.item,
      all: s.all,
      at: s.at,
    })),
    collections: [...collections].map(([name, at]) => ({ name, at })),
    writes,
    uses,
    problems,
  };
}

/**
 * How a `$col('…')` call is used (AU-183): called at once by one of `COL_METHODS` written by its name (`method`, and
 * `at` the whole call, arguments and all), or why not: "kept" (anything else: a variable, an argument, a return, a
 * method taken without calling it), "computed" (`[accion]`), "unknown" (a method it does not have). `at`: the member,
 * when there is one.
 */
function methodCalled(
  call: N,
  up: Map<N, Where>,
): { method: string; at: N } | { why: "kept" | "computed" | "unknown"; method?: string; at?: N } {
  const where = up.get(call);
  const member =
    where?.parent.type === "MemberExpression" && where.key === "object" ? where.parent : undefined;
  if (!member) return { why: "kept" };
  if (member.computed) return { why: "computed", at: member };
  const method = String((member.property as N).name);
  if (!(COL_METHODS as readonly string[]).includes(method))
    return { why: "unknown", method, at: member };
  const outer = up.get(member);
  if (outer?.parent.type !== "CallExpression" || outer.key !== "callee")
    return { why: "kept", method, at: member };
  return { method, at: outer.parent };
}

/** A span as a problem's detail says it (AU-36). */
const placeOf = (s: Span) => ({ line: s.line, column: s.column, from: s.from, to: s.to });

/**
 * A place of a piece of code as a place of the text it is in, starting at `at` there: a `{{ }}`'s JavaScript counted
 * from the start of the whole value, as a problem's detail says it (AU-36).
 */
export function placeIn(text: string, at: number, s: Pick<Span, "from" | "to">) {
  return placeOf({ ...spanAt(text, at + s.from), to: at + s.to });
}

// ---------------------------------------------------------------- a step's code and connections

/** `ValidationContext` plus what code needs: a collection by the name Juan sees, since `$col` cites it by name. */
export interface CodeContext extends ValidationContext {
  /** The key of the collection with that name, as it is now. */
  collectionNamed(name: string): string | undefined;
  /** The name of the collection with that key: what `$col('…')` is written with (the editor's completions). */
  collectionName?(key: string): string | undefined;
  /**
   * The key the published version kept for a name a step's code cites (`keptNames`, AU-192): with it, a citation by
   * a name that collection no longer has is `code.collectionRenamed`, saying today's name, and not unknown.
   */
  keptKey?(step: string, name: string): string | undefined;
  /**
   * The fields the last test of the step with that name gave, by key with the name Juan sees; undefined when it has
   * not been tested. A field read that is not among them is a warning (AU-36), and the editor completes with them.
   */
  testedFields?(step: string): readonly { key: string; name?: string }[] | undefined;
}

/** Whether a context can read code: validation reads JavaScript only with one (until then, `expr.code`). */
export const isCodeContext = (c: ValidationContext): c is CodeContext =>
  typeof (c as Partial<CodeContext>).collectionNamed === "function";

// ---------------------------------------------------------------- renaming

const quoteAs = (text: string, q: string) =>
  q === "`"
    ? `\`${text.replace(/[\\`]|\$\{/g, (c) => `\\${c}`)}\``
    : `${q}${text.replace(/[\\\n\r]/g, (c) => (c === "\\" ? "\\\\" : c === "\n" ? "\\n" : "\\r")).replaceAll(q, () => `\\${q}`)}${q}`;

/**
 * The source with every `$('from')` written as `$('to')`, and nothing else touched: not a text that happens to say
 * the same, not a comment (AU-02). `renameStep` calls it for every `{{ }}` and every «Código» of the automation.
 */
export function renameInCode(source: string, from: string, to: string): string {
  return renameCited(source, "$", from, to);
}

/**
 * The source with every `$col('from')` written as `$col('to')`, and nothing else touched (AU-192): what the button of
 * `code.collectionRenamed` does to a draft's code, by Juan's hand. `$('from')`, a text and a comment stay.
 */
export function renameCollectionInCode(source: string, from: string, to: string): string {
  return renameCited(source, "$col", from, to);
}

function renameCited(source: string, callee: "$" | "$col", from: string, to: string): string {
  let parsed = parseCode(source, "expression");
  if ("error" in parsed) parsed = parseCode(source, "code");
  if ("error" in parsed) return source;
  const up = parents(parsed.root);
  const bound = bindings(up);
  if (bound.names.has(callee)) return source;
  const at: N[] = [];
  for (const [n, where] of up)
    if (
      n.type === "Identifier" &&
      n.name === callee &&
      where.parent.type === "CallExpression" &&
      where.key === "callee"
    ) {
      const args = where.parent.arguments as N[];
      if (args.length === 1 && literalText(args[0]) === from) at.push(args[0] as N);
    }
  let out = source;
  for (const arg of at.sort((a, b) => b.start - a.start)) {
    const q = source[arg.start] ?? "'";
    out = out.slice(0, arg.start) + quoteAs(to, q) + out.slice(arg.end);
  }
  return out;
}

// ---------------------------------------------------------------- the editor

/**
 * What the editor completes at a place of the source (AU-36): the names of `CODE_GLOBALS`, the steps before this one,
 * the fields of a step's rows (by key, with the name to show: AU-25) and the collections connected. A model the
 * editor paints; the fields of a step are the ones its last test gave.
 */
export interface Completion {
  kind: "global" | "step" | "field" | "collection" | "method";
  /** What is written into the code. */
  insert: string;
  /** What is shown: a field's name, a step's name. Absent when it is the same. */
  label?: string;
}

const STEP_OPEN = /\$\(\s*(['"`])([^'"`\\]*)$/;
const COL_OPEN = /\$col\(\s*(['"`])([^'"`\\]*)$/;
const STEP_ROW =
  /\$\(\s*(['"`])((?:[^\\]|\\.)*?)\1\s*\)\s*\.\s*(?:first\(\s*\)|last\(\s*\)|item)\s*\.\s*([\p{ID_Continue}$]*)$/u;
/** A row of the step's own input: `$json.` or `$input.first().` (`last()`, `item`). */
const INPUT_ROW =
  /(?:\$json|\$input\s*\.\s*(?:first\(\s*\)|last\(\s*\)|item))\s*\.\s*([\p{ID_Continue}$]*)$/u;
const ROWS_OF = /(?:\$input|\$\(\s*(['"`])(?:[^\\]|\\.)*?\1\s*\))\s*\.\s*([\p{ID_Continue}$]*)$/u;
const WORD = /[\p{ID_Continue}$]*$/u;
/** Characters before the place that the completions read. */
const NEAR = 400;

/**
 * The fields the last test gave to the rows that reach a step: those of every step with an arrow into it (rows from
 * several steps may reach it). Undefined while one of them has no test, or nothing reaches it: then nothing is known
 * of its input, and nothing is marked.
 */
export function inputFields(
  step: Step,
  automation: Automation,
  context: Pick<CodeContext, "testedFields">,
): { names: readonly string[]; fields: readonly { key: string; name?: string }[] } | undefined {
  const from = new Set(
    automation.arrows.filter((a) => a.to.step === step.id).map((a) => a.from.step),
  );
  const names = automation.steps.filter((s) => from.has(s.id)).map((s) => s.name);
  if (names.length === 0) return undefined;
  const fields = new Map<string, { key: string; name?: string }>();
  for (const name of names) {
    const tested = context.testedFields?.(name);
    if (tested === undefined) return undefined;
    for (const f of tested) if (!fields.has(f.key)) fields.set(f.key, f);
  }
  return { names, fields: [...fields.values()] };
}

/**
 * The ids of the steps from which an arrow path reaches `id`. A cited step must also always run before (validation's
 * `expr.notBefore`); the editor offers every one that comes before, as `graph.ts` cannot be read from here (it reads
 * the catalogue, which reads the format, which reads this file).
 */
function upstream(automation: Automation, id: string): Set<string> {
  const into = new Map<string, string[]>();
  for (const a of automation.arrows)
    into.set(a.to.step, [...(into.get(a.to.step) ?? []), a.from.step]);
  const out = new Set<string>();
  const todo = [id];
  while (todo.length) {
    for (const from of into.get(todo.pop() as string) ?? [])
      if (!out.has(from) && from !== id) {
        out.add(from);
        todo.push(from);
      }
  }
  return out;
}

/** The completions at offset `at` of the source of a step, as the editor offers them (AU-36). */
export function completions(
  source: string,
  at: number,
  as: "expression" | "code",
  step: Step,
  automation: Automation,
  context: CodeContext,
): Completion[] {
  // What is being written is near the place: the regexes below read only that much, so a keystroke at the end of a
  // long «Código» costs the same as one at its start.
  const before = source.slice(Math.max(0, at - NEAR), at);
  const starts = (prefix: string) => (c: Completion) => c.insert.startsWith(prefix);
  let m = COL_OPEN.exec(before);
  if (m) {
    if (as !== "code") return [];
    return (step.connections ?? [])
      .filter((c) => c.read !== false)
      .flatMap((c) => {
        const name = context.collectionName?.(c.collection);
        return name === undefined ? [] : [{ kind: "collection" as const, insert: name }];
      })
      .filter(starts(m[2] ?? ""));
  }
  m = STEP_OPEN.exec(before);
  if (m) {
    const earlier = upstream(automation, step.id);
    return automation.steps
      .filter((s) => earlier.has(s.id))
      .map((s) => ({ kind: "step" as const, insert: s.name }))
      .filter(starts(m[2] ?? ""));
  }
  const field = (f: { key: string; name?: string }) => ({
    kind: "field" as const,
    insert: f.key,
    ...(f.name && f.name !== f.key ? { label: f.name } : {}),
  });
  m = STEP_ROW.exec(before);
  if (m) {
    const name = (m[2] ?? "").replace(/\\(.)/g, "$1");
    return (context.testedFields?.(name) ?? []).map(field).filter(starts(m[3] ?? ""));
  }
  m = INPUT_ROW.exec(before);
  if (m)
    return (inputFields(step, automation, context)?.fields ?? [])
      .map(field)
      .filter(starts(m[1] ?? ""));
  m = ROWS_OF.exec(before);
  if (m)
    return ["all()", "first()", "last()", "item"]
      .map((insert) => ({ kind: "method" as const, insert }))
      .filter(starts(m[2] ?? ""));
  const word = WORD.exec(before)?.[0] ?? "";
  // After a dot comes a property, never a global: `fila.` offers nothing.
  if (/\.\s*$/.test(before.slice(0, before.length - word.length))) return [];
  if (!word.startsWith("$") && !"console".startsWith(word)) return [];
  return CODE_GLOBALS.filter((g) => as === "code" || g !== "$col")
    .map((g) => ({ kind: "global" as const, insert: g }))
    .filter(starts(word));
}
