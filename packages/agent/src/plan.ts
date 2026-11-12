/**
 * The plan language (docs/nucleo.md, 7.2): what the planner returns, never code. A flat list of steps;
 * an expression is a literal, a quote of Juan's request, a reference to an earlier result, or one of a
 * closed list of pure functions over those (one level: function arguments are not functions, so the
 * JSON schema is not recursive). `validatePlan` refuses anything else, with fixed error codes that
 * never quote data.
 */
export type Atom = { lit: string | number | boolean | null } | { quote: string } | { ref: string };
export type Expr = Atom | { fn: string; args: Expr[] };
/** A function may take another's result, a few levels deep (`first(pick(...), ...)`), never without end. */
export const MAX_NESTING = 3;

export const READERS = [
  "extract_tasks",
  "classify",
  "summarize",
  "rewrite",
  "answer_about",
  "read_message",
  "review_reading",
  "fill",
  // Over a list of texts in ONE call (Juan, 2026-11-02: a reader per mail ran out of calls, P12).
  "summarize_each",
  "label_each",
] as const;
export type ReaderKind = (typeof READERS)[number];
export const ASK_CONTROLS = ["choice", "text"] as const;
export const REPLY_COMPONENTS = ["text", "number", "list", "table", "chart", "run"] as const;
/** The places of the app `screen.open` may name (F9): the Bandeja, «Flujos», the Registro, «Mis datos». */
export const OPEN_PLACES = ["inbox", "flows", "log", "data"] as const;
/** What names a thing on the screen (screen.ts): a value a tool or the screen gave, never a model's own. */
const SCREEN_REFS: Readonly<Record<string, readonly string[]>> = {
  "screen.open": ["record", "run"],
  "screen.scroll": ["target"],
  "screen.highlight": ["target"],
};

/**
 * A call's `why` is what its proposal shows as its reason (a reader's quote), never an argument of the tool.
 * `zip` (only with `each`): a second list of the same length walked along, its item as `$zip`.
 */
export type Step = { id: string; when?: Expr; each?: { ref: string }; zip?: { ref: string } } & (
  | { op: "call"; tool: string; args: Record<string, Expr>; why?: Expr }
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
  first: [1, 8],
  concat: [1, 40],
  list: [1, 20],
  obj: [2, 40],
  case: [3, 41],
  merge: [2, 8],
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
  // `given`: a choice already made (one of the options): the answer, with no model (docs/sistema.md §4.2).
  classify: ["options", "question", "ask", "given"],
  summarize: [],
  rewrite: ["instruction"],
  answer_about: ["question"],
  read_message: ["modules", "user_in", "known", "guide"],
  review_reading: ["options"],
  // `collection`: of `fields` per collection, the one a choice names («Crear en la elegida»).
  fill: ["fields", "collection"],
  summarize_each: ["options", "question"],
  label_each: ["options", "question"],
};
const REPLY_DATA: Readonly<Record<(typeof REPLY_COMPONENTS)[number], string[]>> = {
  text: ["template", "a", "b", "c", "d"],
  number: ["value", "unit", "caption"],
  // `group`: a field of the items; the list shows one section per value, in the items' order (Juan, 2026-11-02).
  list: ["items", "fields", "caption", "group"],
  table: ["rows", "fields", "caption"],
  // Bars (or a line) of numbers the tools gave, one per label: `kind` "bar" or "line".
  chart: ["labels", "values", "kind", "unit", "caption"],
  // A run drawn in the conversation (task 92): its way from what started it to where it ended, «Ampliar» to the map.
  run: ["run", "caption"],
};

/**
 * What a plan may say besides the tools, for whoever writes plans by hand (docs/flujos.md: the flow editor's catalog
 * of nodes): each reader with its parameters (and which are required), the ask controls, the reply components with
 * their data, the functions with their arity, and the limits.
 */
export function planVocabulary() {
  return {
    readers: Object.fromEntries(
      READERS.map((r) => [
        r,
        {
          params: READER_PARAMS[r],
          required: r === "classify" ? ["options"] : r === "fill" ? ["fields"] : [],
        },
      ]),
    ) as Record<ReaderKind, { params: string[]; required: string[] }>,
    asks: [...ASK_CONTROLS],
    replies: { ...REPLY_DATA } as Record<string, string[]>,
    fns: { ...FNS },
    limits: { steps: MAX_STEPS, each: MAX_EACH, nesting: MAX_NESTING },
  };
}

/** What the validator needs to know of the tools the planner may use. */
export interface PlanCatalog {
  /** `objects`: the arguments that take a JSON object as it is, {"lit": {...}} (a flow's trigger and plan). */
  args(
    tool: string,
  ): { names: readonly string[]; required: readonly string[]; objects?: readonly string[] } | null;
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

/**
 * The «open» reply of before (I-30) is the action `screen.open` now (F9, task 85): a plan written then (a saved flow's,
 * a test's) opens the same.
 */
function legacyOpen(s: unknown): unknown {
  if (!isObj(s) || s.op !== "reply" || s.component !== "open") return s;
  const { component: _, data, ...rest } = s;
  return { ...rest, op: "call", tool: "screen.open", args: data ?? {} };
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
      for (const k of ["when", "input", "prompt", "options", "why"])
        if (k in s) out[k] = expr(s[k]);
      for (const k of ["args", "params", "data"]) if (k in s) out[k] = map(s[k]);
      return out;
    }),
  };
}

/**
 * `bound`: names a plan may refer to without a step, values the code binds with their own labels: a plan made by
 * code (`$guide`, Agent.background; a flow's form) and, for a planner's plan in a turn, what is on the screen
 * (`$screen`, F9). Nothing else is bound for a planner's plan.
 */
export function validatePlan(
  given: unknown,
  catalog: PlanCatalog,
  turnText: string,
  bound: readonly string[] = [],
): PlanResult {
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
  const seen = new Set<string>(bound);
  // Whether the step being checked walks a second list along its `each` (`$zip`).
  let zipped = false;
  // What a plan opens and filters on the screen (F9): one of each per plan.
  let opens = 0;
  let filters = 0;

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
      if (head === "item" ? !inEach : head === "zip" ? !(inEach && zipped) : !seen.has(head))
        errors.push(`${where}: ref-to-unknown-step`);
    } else errors.push(`${where}: bad-expression`);
  };
  const checkExpr = (where: string, e: unknown, inEach: boolean, depth = 0) => {
    if (isObj(e) && "fn" in e) {
      if (!onlyKeys(e, ["fn", "args"]) || typeof e.fn !== "string" || !Array.isArray(e.args))
        return errors.push(`${where}: bad-function`);
      if (depth >= MAX_NESTING) return errors.push(`${where}: too-deep`);
      const arity = FNS[e.fn];
      if (!arity || !Object.hasOwn(FNS, e.fn)) return errors.push(`${where}: unknown-function`);
      if (e.args.length < arity[0] || e.args.length > arity[1])
        errors.push(`${where}: wrong-arguments`);
      for (const [i, a] of e.args.entries()) checkExpr(`${where}.args[${i}]`, a, inEach, depth + 1);
    } else checkAtom(where, e, inEach);
  };
  const checkArgs = (
    where: string,
    args: unknown,
    allowed: readonly string[],
    required: readonly string[],
    inEach: boolean,
    objects: readonly string[] = [],
  ) => {
    if (!isObj(args)) return errors.push(`${where}: bad-arguments`);
    for (const k of Object.keys(args))
      if (!allowed.includes(k)) errors.push(`${where}: unknown-argument`);
    for (const k of required) if (!(k in args)) errors.push(`${where}: missing-argument`);
    for (const [k, v] of Object.entries(args)) {
      if (!allowed.includes(k)) continue;
      if (!objects.includes(k)) {
        checkExpr(`${where}.${k}`, v, inEach);
        continue;
      }
      // A definition: a JSON object as it is, the model's own (the tool checks it whole). Written bare, it is wrapped.
      const def = isObj(v) && onlyKeys(v, ["lit"]) && "lit" in v ? v.lit : v;
      if (
        !isObj(def) ||
        "ref" in def ||
        "quote" in def ||
        "fn" in def ||
        JSON.stringify(def).length > 20_000
      )
        errors.push(`${where}.${k}: bad-definition`);
      else args[k] = { lit: def };
    }
  };

  /**
   * What Boni does on the screen (F9): never once per item (what the conversation says it did is what it did), one
   * opening and one filter per plan, what it names on the screen as a tool or the screen gave it, a place of the app
   * by its fixed name.
   */
  const checkScreen = (
    where: string,
    tool: string,
    a: Record<string, unknown>,
    inEach: boolean,
  ) => {
    if (inEach) errors.push(`${where}: screen-in-each`);
    if (tool === "screen.open") {
      if (opens++ > 0) errors.push(`${where}: open-once`);
      const named = ["collection", "record", "place", "run", "flow"].filter((k) => k in a);
      if (named.length !== 1) errors.push(`${where}.args: open-one-thing`);
      const place = a.place;
      if (
        place !== undefined &&
        !(
          isObj(place) &&
          typeof place.lit === "string" &&
          (OPEN_PLACES as readonly string[]).includes(place.lit)
        )
      )
        errors.push(`${where}.args: unknown-place`);
    }
    if (tool === "screen.filter" && filters++ > 0) errors.push(`${where}: filter-once`);
    const isRef = (e: unknown) => isObj(e) && typeof e.ref === "string";
    for (const k of SCREEN_REFS[tool] ?? []) {
      const e = a[k];
      if (e === undefined) continue;
      // A list of them (to light several at once) is a list of references too.
      const ok =
        isRef(e) || (isObj(e) && e.fn === "list" && Array.isArray(e.args) && e.args.every(isRef));
      if (!ok) errors.push(`${where}.args: ${k}-not-from-a-tool`);
    }
  };

  for (const [i, given] of (raw.steps as unknown[]).entries()) {
    const s = legacyOpen(given);
    if (s !== given) (raw.steps as unknown[])[i] = s;
    const where = `step ${i + 1}`;
    if (!isObj(s)) {
      errors.push(`${where}: not-a-step`);
      continue;
    }
    if (
      typeof s.id !== "string" ||
      !/^[a-z][a-z0-9_]{0,30}$/.test(s.id) ||
      s.id === "item" ||
      s.id === "zip" ||
      seen.has(s.id)
    )
      errors.push(`${where}: bad-id`);
    const inEach = s.each !== undefined;
    zipped = false;
    if (s.when !== undefined) checkExpr(`${where}.when`, s.when, false);
    if (inEach) {
      if (!isObj(s.each) || !onlyKeys(s.each, ["ref"])) errors.push(`${where}.each: bad-ref`);
      else checkAtom(`${where}.each`, s.each, false);
    }
    if (s.zip !== undefined) {
      if (!inEach || !isObj(s.zip) || !onlyKeys(s.zip, ["ref"]))
        errors.push(`${where}.zip: bad-ref`);
      else checkAtom(`${where}.zip`, s.zip, false);
      zipped = true;
    }
    const common = ["id", "op", "when", "each", "zip"];
    switch (s.op) {
      case "call": {
        if (!onlyKeys(s, [...common, "tool", "args", "why"])) errors.push(`${where}: unknown-key`);
        if (s.why !== undefined) checkExpr(`${where}.why`, s.why, inEach);
        const spec = typeof s.tool === "string" ? catalog.args(s.tool) : null;
        if (!spec) errors.push(`${where}: unknown-tool`);
        else
          checkArgs(
            `${where}.args`,
            s.args ?? {},
            spec.names,
            spec.required,
            inEach,
            spec.objects ?? [],
          );
        if (typeof s.tool === "string" && s.tool.startsWith("screen.") && spec)
          checkScreen(where, s.tool, isObj(s.args) ? s.args : {}, inEach);
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
            s.reader === "classify" ? ["options"] : s.reader === "fill" ? ["fields"] : [],
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
        else {
          checkArgs(
            `${where}.data`,
            s.data ?? {},
            REPLY_DATA[s.component as (typeof REPLY_COMPONENTS)[number]],
            [],
            inEach,
          );
          // The run a reply draws is one a tool gave (I-29): a reference, never a model's own id.
          const run = isObj(s.data) ? s.data.run : undefined;
          if (s.component === "run" && !(isObj(run) && typeof run.ref === "string"))
            errors.push(`${where}.data: run-not-from-a-tool`);
        }
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
const callSchema = (args: object) => ({
  type: "object",
  properties: {
    fn: { type: "string", enum: Object.keys(FNS) },
    args: { type: "array", items: args },
  },
  required: ["fn", "args"],
  additionalProperties: false,
});
/** The guide shows one function inside another; `validatePlan` allows `MAX_NESTING` (the schema is not recursive). */
const EXPR_SCHEMA = {
  anyOf: [
    ...ATOM_SCHEMA.anyOf,
    callSchema({ anyOf: [...ATOM_SCHEMA.anyOf, callSchema(ATOM_SCHEMA)] }),
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
