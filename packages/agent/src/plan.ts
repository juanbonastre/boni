/**
 * The plan language (docs/nucleo.md, 7.2): what the planner returns, never code. A flat list of steps;
 * an expression is a literal, a quote of Juan's request, a reference to an earlier result, or one of a
 * closed list of pure functions over those (one level: function arguments are not functions, so the
 * JSON schema is not recursive). `validatePlan` refuses anything else, with fixed error codes that
 * never quote data.
 */
export type Atom = { lit: string | number | boolean | null } | { quote: string } | { ref: string };
export type Expr = Atom | { fn: string; args: Atom[] };

export const READERS = [
  "extract_tasks",
  "classify",
  "summarize",
  "rewrite",
  "answer_about",
] as const;
export type ReaderKind = (typeof READERS)[number];
export const ASK_CONTROLS = ["choice", "text"] as const;
export const REPLY_COMPONENTS = ["text", "number", "list", "table"] as const;

export type Step = { id: string; when?: Expr; each?: { ref: string } } & (
  | { op: "call"; tool: string; args: Record<string, Expr> }
  | { op: "read"; reader: ReaderKind; input: Expr; params?: Record<string, Expr> }
  | { op: "ask"; control: (typeof ASK_CONTROLS)[number]; prompt: Expr; options?: Expr }
  | { op: "reply"; component: (typeof REPLY_COMPONENTS)[number]; data: Record<string, Expr> }
);
export interface Plan {
  version: 1;
  steps: Step[];
}

/** Pure functions and how many arguments each takes ([min, max]). */
export const FNS: Readonly<Record<string, [number, number]>> = {
  count: [1, 1],
  sum: [1, 2],
  min: [1, 2],
  max: [1, 2],
  pick: [2, 2],
  item: [2, 2],
  field: [2, 2],
  filter_eq: [3, 3],
  concat: [1, 10],
  list: [1, 20],
  obj: [2, 40],
  length: [1, 1],
  eq: [2, 2],
  ne: [2, 2],
  gt: [2, 2],
  lt: [2, 2],
  and: [2, 4],
  or: [2, 4],
  not: [1, 1],
  today: [0, 0],
  add_days: [2, 2],
};

export const MAX_STEPS = 40;
export const MAX_EACH = 50;
const READER_PARAMS: Readonly<Record<ReaderKind, string[]>> = {
  extract_tasks: ["known"],
  classify: ["options", "question"],
  summarize: [],
  rewrite: ["instruction"],
  answer_about: ["question"],
};
const REPLY_DATA: Readonly<Record<(typeof REPLY_COMPONENTS)[number], string[]>> = {
  text: ["template", "a", "b", "c", "d"],
  number: ["value", "unit", "caption"],
  list: ["items", "fields", "caption"],
  table: ["rows", "fields", "caption"],
};

/** What the validator needs to know of the tools the planner may use. */
export interface PlanCatalog {
  args(tool: string): { names: readonly string[]; required: readonly string[] } | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).every((k) => keys.includes(k));

const SEPARATOR = /[\s,.;:!?¿¡()[\]{}"'«»“”‘’/\\-]/u;
/**
 * Whether `quote` is a whole span of `text`: it starts and ends at a separator (or the ends of the
 * text) and has at least 3 characters, so letters cannot be picked one by one.
 */
export function isWholeSpan(text: string, quote: string): boolean {
  if ([...quote.trim()].length < 3 || quote !== quote.trim()) return false;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
    const before = i === 0 || SEPARATOR.test(text[i - 1] as string);
    const end = i + quote.length;
    const after = end === text.length || SEPARATOR.test(text[end] as string);
    if (before && after) return true;
  }
  return false;
}

export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: string[] };

/**
 * A bare string, number, boolean or null where an expression goes is the model's own literal, as if it
 * had written {"lit": x} (smaller models forget the wrapper). Nothing else changes: it is still the
 * model's (labelled `model`), and lists or objects are still refused.
 */
function bareLiterals(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.steps)) return raw;
  const scalar = (v: unknown) =>
    v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  const expr = (e: unknown): unknown => {
    if (scalar(e)) return { lit: e };
    if (isObj(e) && "fn" in e && Array.isArray(e.args))
      return { ...e, args: e.args.map((a) => (scalar(a) ? { lit: a } : a)) };
    return e;
  };
  const map = (o: unknown) =>
    isObj(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expr(v)])) : o;
  return {
    ...raw,
    steps: raw.steps.map((s) => {
      if (!isObj(s)) return s;
      const out: Record<string, unknown> = { ...s };
      for (const k of ["when", "input", "prompt", "options"]) if (k in s) out[k] = expr(s[k]);
      for (const k of ["args", "params", "data"]) if (k in s) out[k] = map(s[k]);
      return out;
    }),
  };
}

export function validatePlan(given: unknown, catalog: PlanCatalog, turnText: string): PlanResult {
  const raw = bareLiterals(given);
  const errors: string[] = [];
  if (
    !isObj(raw) ||
    raw.version !== 1 ||
    !Array.isArray(raw.steps) ||
    !onlyKeys(raw, ["version", "steps"])
  )
    return { ok: false, errors: ["plan: not-a-plan"] };
  if (raw.steps.length === 0) return { ok: false, errors: ["plan: no-steps"] };
  if (raw.steps.length > MAX_STEPS) return { ok: false, errors: ["plan: too-many-steps"] };
  const seen = new Set<string>();

  const checkAtom = (where: string, a: unknown, inEach: boolean) => {
    if (!isObj(a) || Object.keys(a).length !== 1) return errors.push(`${where}: bad-expression`);
    if ("lit" in a) {
      const v = a.lit;
      if (
        !(
          v === null ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v)) ||
          (typeof v === "string" && v.length <= 2000)
        )
      )
        errors.push(`${where}: bad-literal`);
    } else if ("quote" in a) {
      if (typeof a.quote !== "string" || a.quote.length > 500 || !isWholeSpan(turnText, a.quote))
        errors.push(`${where}: quote-not-in-request`);
    } else if ("ref" in a) {
      if (typeof a.ref !== "string") return errors.push(`${where}: bad-ref`);
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d{1,4}\])*)$/.exec(
        a.ref,
      );
      if (!m) return errors.push(`${where}: bad-ref`);
      const head = m[1] as string;
      if (head === "item" ? !inEach : !seen.has(head)) errors.push(`${where}: ref-to-unknown-step`);
    } else errors.push(`${where}: bad-expression`);
  };
  const checkExpr = (where: string, e: unknown, inEach: boolean) => {
    if (isObj(e) && "fn" in e) {
      if (!onlyKeys(e, ["fn", "args"]) || typeof e.fn !== "string" || !Array.isArray(e.args))
        return errors.push(`${where}: bad-function`);
      const arity = FNS[e.fn];
      if (!arity || !Object.hasOwn(FNS, e.fn)) return errors.push(`${where}: unknown-function`);
      if (e.args.length < arity[0] || e.args.length > arity[1])
        errors.push(`${where}: wrong-arguments`);
      for (const [i, a] of e.args.entries()) checkAtom(`${where}.args[${i}]`, a, inEach);
    } else checkAtom(where, e, inEach);
  };
  const checkArgs = (
    where: string,
    args: unknown,
    allowed: readonly string[],
    required: readonly string[],
    inEach: boolean,
  ) => {
    if (!isObj(args)) return errors.push(`${where}: bad-arguments`);
    for (const k of Object.keys(args))
      if (!allowed.includes(k)) errors.push(`${where}: unknown-argument`);
    for (const k of required) if (!(k in args)) errors.push(`${where}: missing-argument`);
    for (const [k, v] of Object.entries(args))
      if (allowed.includes(k)) checkExpr(`${where}.${k}`, v, inEach);
  };

  for (const [i, s] of (raw.steps as unknown[]).entries()) {
    const where = `step ${i + 1}`;
    if (!isObj(s)) {
      errors.push(`${where}: not-a-step`);
      continue;
    }
    if (
      typeof s.id !== "string" ||
      !/^[a-z][a-z0-9_]{0,30}$/.test(s.id) ||
      s.id === "item" ||
      seen.has(s.id)
    )
      errors.push(`${where}: bad-id`);
    const inEach = s.each !== undefined;
    if (s.when !== undefined) checkExpr(`${where}.when`, s.when, false);
    if (inEach) {
      if (!isObj(s.each) || !onlyKeys(s.each, ["ref"])) errors.push(`${where}.each: bad-ref`);
      else checkAtom(`${where}.each`, s.each, false);
    }
    const common = ["id", "op", "when", "each"];
    switch (s.op) {
      case "call": {
        if (!onlyKeys(s, [...common, "tool", "args"])) errors.push(`${where}: unknown-key`);
        const spec = typeof s.tool === "string" ? catalog.args(s.tool) : null;
        if (!spec) errors.push(`${where}: unknown-tool`);
        else checkArgs(`${where}.args`, s.args ?? {}, spec.names, spec.required, inEach);
        break;
      }
      case "read": {
        if (!onlyKeys(s, [...common, "reader", "input", "params"]))
          errors.push(`${where}: unknown-key`);
        if (!(READERS as readonly unknown[]).includes(s.reader))
          errors.push(`${where}: unknown-reader`);
        else {
          checkExpr(`${where}.input`, s.input, inEach);
          const names = READER_PARAMS[s.reader as ReaderKind];
          checkArgs(
            `${where}.params`,
            s.params ?? {},
            names,
            s.reader === "classify" ? ["options"] : [],
            inEach,
          );
        }
        break;
      }
      case "ask": {
        if (!onlyKeys(s, [...common, "control", "prompt", "options"]))
          errors.push(`${where}: unknown-key`);
        if (!(ASK_CONTROLS as readonly unknown[]).includes(s.control))
          errors.push(`${where}: unknown-control`);
        checkExpr(`${where}.prompt`, s.prompt, inEach);
        if (s.control === "choice") {
          if (s.options === undefined) errors.push(`${where}: missing-argument`);
          else checkExpr(`${where}.options`, s.options, inEach);
        } else if (s.options !== undefined) errors.push(`${where}: unknown-argument`);
        if (inEach) errors.push(`${where}: ask-in-each`);
        break;
      }
      case "reply": {
        if (!onlyKeys(s, [...common, "component", "data"])) errors.push(`${where}: unknown-key`);
        if (!(REPLY_COMPONENTS as readonly unknown[]).includes(s.component))
          errors.push(`${where}: unknown-component`);
        else
          checkArgs(
            `${where}.data`,
            s.data ?? {},
            REPLY_DATA[s.component as (typeof REPLY_COMPONENTS)[number]],
            [],
            inEach,
          );
        break;
      }
      default:
        errors.push(`${where}: unknown-op`);
    }
    if (typeof s.id === "string") seen.add(s.id);
  }
  return errors.length
    ? { ok: false, errors: [...new Set(errors)].slice(0, 20) }
    : { ok: true, plan: raw as unknown as Plan };
}

const ATOM_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: { lit: { type: ["string", "number", "boolean", "null"] } },
      required: ["lit"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { quote: { type: "string" } },
      required: ["quote"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    },
  ],
};
const EXPR_SCHEMA = {
  anyOf: [
    ...ATOM_SCHEMA.anyOf,
    {
      type: "object",
      properties: {
        fn: { type: "string", enum: Object.keys(FNS) },
        args: { type: "array", items: ATOM_SCHEMA },
      },
      required: ["fn", "args"],
      additionalProperties: false,
    },
  ],
};
/** A map of named expressions with exactly these names, all optional (validatePlan checks them per
 * tool; a structured-output schema must close every object). */
const exprMap = (names: readonly string[]) => ({
  type: "object",
  properties: Object.fromEntries([...new Set(names)].sort().map((n) => [n, EXPR_SCHEMA])),
  additionalProperties: false,
});

/**
 * The JSON schema of a plan for the planner's structured output, for the argument names of the tools
 * it may use (not recursive). It only guides the model: `validatePlan` decides.
 */
export function planSchema(argNames: readonly string[]) {
  return {
    type: "object",
    properties: {
      version: { const: 1 },
      steps: {
        type: "array",
        maxItems: MAX_STEPS,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            op: { type: "string", enum: ["call", "read", "ask", "reply"] },
            when: EXPR_SCHEMA,
            each: {
              type: "object",
              properties: { ref: { type: "string" } },
              required: ["ref"],
              additionalProperties: false,
            },
            tool: { type: "string" },
            args: exprMap(argNames),
            reader: { type: "string", enum: [...READERS] },
            input: EXPR_SCHEMA,
            params: exprMap(Object.values(READER_PARAMS).flat()),
            control: { type: "string", enum: [...ASK_CONTROLS] },
            prompt: EXPR_SCHEMA,
            options: EXPR_SCHEMA,
            component: { type: "string", enum: [...REPLY_COMPONENTS] },
            data: exprMap(Object.values(REPLY_DATA).flat()),
          },
          required: ["id", "op"],
          additionalProperties: false,
        },
      },
    },
    required: ["version", "steps"],
    additionalProperties: false,
  };
}
