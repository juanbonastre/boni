import { label } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { apiSchema } from "../src/anthropic.ts";
import { marksOf } from "../src/confirm.ts";
import { callFn } from "../src/fns.ts";
import { isWholeSpan, validatePlan } from "../src/plan.ts";
import { decide, type Origin } from "../src/policy.ts";
import { checkReader, checkReaderOutput, readerSchema } from "../src/readers.ts";
import { coreTools, neutralize, ToolRegistry } from "../src/tools.ts";
import { at, atOrNull, leaf, list, rec, type Val } from "../src/values.ts";
import { toPlannerView } from "../src/view.ts";
import { testRegistry } from "./fixture.ts";

const user = label("user", "public", [{ kind: "turn", id: "t" }]);
const own = label("imported", "personal", [{ kind: "vault", id: "n.md" }]);
const ext = label("external", "personal", [{ kind: "mail", id: "m" }]);
const model = label("model", "public", [{ kind: "model", id: "r" }]);
const turn: Origin = { kind: "turn", trust: "personal" };
const counters = { writes: 0, sensitiveReads: 0 };
const reg = testRegistry();
const call = (
  tool: string,
  args: Record<string, Val>,
  control: ReturnType<typeof label> | null = null,
) => ({ tool: reg.get(tool), args, control });

describe("the plan validator", () => {
  const cat = coreTools();
  it("accepts a plan and refuses what is not one", () => {
    const ok = {
      version: 1,
      steps: [{ id: "a", op: "call", tool: "entities.query", args: { type: { lit: "tarea" } } }],
    };
    expect(validatePlan(ok, cat, "").ok).toBe(true);
    // A chart of numbers the tools gave, one per label; anything else in it is refused.
    const chart = (data: Record<string, unknown>) =>
      validatePlan(
        {
          version: 1,
          steps: [
            {
              id: "n",
              op: "call",
              tool: "entities.aggregate",
              args: { type: { lit: "tarea" }, op: { lit: "count" } },
            },
            { id: "c", op: "reply", component: "chart", data },
          ],
        },
        cat,
        "",
      );
    expect(
      chart({
        labels: { fn: "list", args: [{ lit: "Alta" }, { lit: "Baja" }] },
        values: { fn: "list", args: [{ ref: "$n" }, { ref: "$n" }] },
        kind: { lit: "bar" },
      }).ok,
    ).toBe(true);
    expect(chart({ labels: { lit: "Alta" }, colour: { lit: "red" } }).ok).toBe(false);
    expect(validatePlan({ version: 2, steps: [] }, cat, "")).toEqual({
      ok: false,
      errors: ["plan: not-a-plan"],
    });
    expect(validatePlan({ version: 1, steps: [] }, cat, "")).toEqual({
      ok: false,
      errors: ["plan: no-steps"],
    });
    const many = {
      version: 1,
      steps: Array.from({ length: 41 }, (_, i) => ({
        id: `s${i}`,
        op: "reply",
        component: "text",
        data: {},
      })),
    };
    expect(validatePlan(many, cat, "")).toEqual({ ok: false, errors: ["plan: too-many-steps"] });
    // A bare literal is the model's {"lit": x}; a list or an object is still not an expression.
    const bare = validatePlan(
      {
        version: 1,
        steps: [
          { id: "a", op: "call", tool: "entities.query", args: { type: "tarea" } },
          {
            id: "b",
            op: "reply",
            component: "text",
            data: { template: "Tienes {a}", a: { fn: "count", args: [{ ref: "$a" }] } },
          },
        ],
      },
      cat,
      "",
    );
    expect(bare).toMatchObject({
      ok: true,
      plan: {
        steps: [
          { args: { type: { lit: "tarea" } } },
          { data: { template: { lit: "Tienes {a}" } } },
        ],
      },
    });
    expect(
      validatePlan(
        {
          version: 1,
          steps: [{ id: "a", op: "call", tool: "entities.query", args: { type: ["tarea"] } }],
        },
        cat,
        "",
      ).ok,
    ).toBe(false);
  });
  it("gives fixed codes, never data", () => {
    const bad = {
      version: 1,
      steps: [
        { id: "a", op: "call", tool: "entities.borrar_todo", args: {} },
        {
          id: "b",
          op: "call",
          tool: "entities.get",
          args: { id: { ref: "$z" }, extra: { lit: 1 } },
        },
        { id: "c", op: "reply", component: "html", data: {} },
        { id: "d", op: "ask", control: "password", prompt: { lit: "Tu contraseña" } },
        { id: "e", op: "read", reader: "extract_tasks", input: { fn: "eval", args: [] } },
        { id: "f", op: "call", tool: "entities.get", args: { id: { quote: "SECRETO" } } },
        { id: "a", op: "reply", component: "text", data: {}, code: "x" },
      ],
    };
    const r = validatePlan(bad, cat, "una petición");
    expect(r.ok).toBe(false);
    const errors = r.ok ? [] : r.errors;
    expect(errors).toEqual([
      "step 1: unknown-tool",
      "step 2.args: unknown-argument",
      "step 2.args.id: ref-to-unknown-step",
      "step 3: unknown-component",
      "step 4: unknown-control",
      "step 5.input: unknown-function",
      "step 6.args.id: quote-not-in-request",
      "step 7: bad-id",
      "step 7: unknown-key",
    ]);
    expect(errors.join()).not.toContain("SECRETO");
  });
  it("only accepts whole spans of the request as quotes (A1)", () => {
    const text = "escribe a Ana: nos vemos el jueves";
    expect(isWholeSpan(text, "nos vemos el jueves")).toBe(true);
    expect(isWholeSpan(text, "Ana")).toBe(true);
    expect(isWholeSpan(text, "An")).toBe(false);
    expect(isWholeSpan(text, "scribe")).toBe(false);
    expect(isWholeSpan(text, " Ana")).toBe(false);
    expect(isWholeSpan(text, "jue")).toBe(false);
  });
  it("lets $item only inside each, and no question inside a loop", () => {
    const p = (steps: unknown[]) => validatePlan({ version: 1, steps }, cat, "");
    expect(
      p([{ id: "a", op: "reply", component: "text", data: { template: { ref: "$item" } } }]).ok,
    ).toBe(false);
    const ask = p([
      { id: "a", op: "call", tool: "entities.query", args: { type: { lit: "tarea" } } },
      { id: "b", op: "ask", each: { ref: "$a" }, control: "text", prompt: { lit: "?" } },
    ]);
    expect(ask.ok ? [] : ask.errors).toContain("step 2: ask-in-each");
  });
});

describe("the policy engine", () => {
  const to = (l: typeof user, derived = false) => ({ ...leaf("ana@example.com", l), derived });
  it("denies destinations that are not Juan's or his data's, or are derived (P2, P14)", () => {
    for (const [l, rule] of [
      [ext, "P2"],
      [model, "P2"],
      [label("ambient", "public", []), "P2"],
    ] as const)
      expect(
        decide(
          call("mail.send", { to: to(l), subject: leaf("x", user), body: leaf("x", user) }),
          turn,
          counters,
        ).rule,
      ).toBe(rule);
    expect(
      decide(
        call("mail.send", { to: to(user, true), subject: leaf("x", user), body: leaf("x", user) }),
        turn,
        counters,
      ).rule,
    ).toBe("P14");
    expect(
      decide(
        call("mail.send", { to: to(own), subject: leaf("x", user), body: leaf("x", user) }),
        turn,
        counters,
      ),
    ).toEqual({ kind: "confirm", rule: "P5" });
  });
  it("keeps Juan's private data from leaving unless he wrote it now (P3)", () => {
    const priv = label("imported", "sensitive", []);
    expect(
      decide(
        call("mail.send", { to: to(own), subject: leaf("x", user), body: leaf("42", priv) }),
        turn,
        counters,
      ),
    ).toMatchObject({ kind: "deny", rule: "P3" });
    const mine = label("user", "personal", []);
    expect(
      decide(
        call("mail.send", { to: to(own), subject: leaf("x", user), body: leaf("42", mine) }),
        turn,
        counters,
      ),
    ).toEqual({ kind: "confirm", rule: "P3" });
  });
  it("sends what an e-mail made, or decided, to the inbox (P4, P15)", () => {
    const values = rec({ titulo: leaf("x", ext) }, model, true);
    expect(
      decide(call("entities.create", { type: leaf("tarea", model), values }), turn, counters),
    ).toEqual({ kind: "propose", rule: "P4" });
    const trusted = rec({ titulo: leaf("x", user) }, model, true);
    expect(
      decide(
        call("entities.create", { type: leaf("tarea", model), values: trusted }, ext),
        turn,
        counters,
      ),
    ).toEqual({ kind: "propose", rule: "P15" });
    expect(
      decide(
        call("entities.create", { type: leaf("tarea", model), values: trusted }),
        turn,
        counters,
      ),
    ).toEqual({ kind: "allow", rule: "P1" });
    // Accepted in the inbox, on a personal device: P4 is satisfied, P5 still asks.
    const accepted: Origin = { kind: "accepted", trust: "personal" };
    expect(
      decide(call("entities.create", { type: leaf("tarea", model), values }), accepted, counters),
    ).toEqual({ kind: "allow", rule: "P1" });
    expect(decide(call("entities.delete", { id: leaf("e1", ext) }), accepted, counters)).toEqual({
      kind: "confirm",
      rule: "P5",
    });
  });
  it("lets background work and shared devices only read and propose (P6, P7)", () => {
    const values = rec({ titulo: leaf("x", user) }, model, true);
    expect(
      decide(
        call("entities.create", { type: leaf("tarea", model), values }),
        { kind: "background", trust: "personal" },
        counters,
      ).rule,
    ).toBe("P7");
    expect(
      decide(
        call("entities.create", { type: leaf("tarea", model), values }),
        { kind: "turn", trust: "ambient" },
        counters,
      ).rule,
    ).toBe("P6");
    expect(
      decide(
        call("web.fetch", { url: leaf("https://example.com", user) }),
        { kind: "background", trust: "personal" },
        counters,
      ),
    ).toMatchObject({ kind: "deny", rule: "P7" });
    expect(
      decide(
        call("entities.query", { type: leaf("tarea", model) }),
        { kind: "background", trust: "personal" },
        counters,
      ),
    ).toEqual({ kind: "allow", rule: "P1" });
  });
  it("jobs only from Juan's turn, confirmed, never with outside text (P8, P16)", () => {
    const job = (l: typeof user) => ({
      name: leaf("x", user),
      schedule: leaf("daily", model),
      prompt: leaf("resumen", l),
    });
    expect(decide(call("jobs.create", job(user)), turn, counters)).toEqual({
      kind: "confirm",
      rule: "P8",
    });
    expect(decide(call("jobs.create", job(ext)), turn, counters)).toMatchObject({
      kind: "deny",
      rule: "P16",
    });
    expect(
      decide(call("jobs.create", job(user)), { kind: "background", trust: "personal" }, counters),
    ).toMatchObject({ kind: "deny", rule: "P8" });
  });
  it("a flow runs only from Juan's turn, confirmed, never named by outside text (P8, P16; docs/flujos.md F4)", () => {
    const run = (l: typeof user) => ({ flow: leaf("resumen", l) });
    expect(decide(call("flows.run", run(model)), turn, counters)).toEqual({
      kind: "confirm",
      rule: "P8",
    });
    expect(decide(call("flows.run", run(ext)), turn, counters)).toMatchObject({
      kind: "deny",
      rule: "P16",
    });
    for (const kind of ["background", "miniapp", "accepted"] as const)
      expect(
        decide(call("flows.run", run(user)), { kind, trust: "personal" }, counters),
      ).toMatchObject({ kind: "deny", rule: "P8" });
    expect(
      decide(call("flows.run", run(user)), { kind: "turn", trust: "shared" }, counters),
    ).toMatchObject({ kind: "deny", rule: "P8" });
  });
  it("a flow a model writes is only proposed; saved when Juan accepts it; never from outside (P19, P16, P8)", () => {
    const def = (l: typeof user) => ({
      name: leaf("Resumen", l),
      trigger: leaf({ manual: true }, l),
      plan: leaf({ version: 1, steps: [] }, l),
    });
    expect(decide(call("flows.save", def(model)), turn, counters)).toEqual({
      kind: "propose",
      rule: "P19",
    });
    expect(
      decide(call("flows.save", def(model)), { kind: "accepted", trust: "personal" }, counters),
    ).toEqual({ kind: "allow", rule: "P19" });
    expect(decide(call("flows.save", def(ext)), turn, counters)).toMatchObject({
      kind: "deny",
      rule: "P16",
    });
    for (const kind of ["background", "miniapp"] as const)
      expect(
        decide(call("flows.save", def(user)), { kind, trust: "personal" }, counters),
      ).toMatchObject({ kind: "deny", rule: "P8" });
  });
  it("memory never from outside (P9); schema changes allowed in a turn, proposed otherwise (P10)", () => {
    expect(decide(call("memory.save", { text: leaf("x", ext) }), turn, counters)).toMatchObject({
      kind: "deny",
      rule: "P9",
    });
    expect(decide(call("memory.save", { text: leaf("x", model) }), turn, counters)).toEqual({
      kind: "allow",
      rule: "P1",
    });
    const field = {
      type: leaf("tarea", model),
      key: leaf("k", model),
      name: leaf("n", model),
      kind: leaf("text", model),
    };
    expect(decide(call("schema.add_field", field), turn, counters)).toEqual({
      kind: "allow",
      rule: "P10",
    });
    expect(
      decide(call("schema.add_field", { ...field, name: leaf("n", ext) }), turn, counters),
    ).toEqual({ kind: "propose", rule: "P10" });
  });
  it("stops a run with too many writes, and denies what it does not know (P11, P0)", () => {
    const values = rec({ titulo: leaf("x", user) }, model, true);
    expect(
      decide(call("entities.create", { type: leaf("tarea", model), values }), turn, {
        writes: 20,
        sensitiveReads: 0,
      }),
    ).toEqual({ kind: "confirm", rule: "P11" });
    expect(decide({ tool: null, args: {}, control: null }, turn, counters)).toMatchObject({
      kind: "deny",
      rule: "P0",
    });
    expect(
      decide(call("entities.get", { id: leaf("e", user), extra: leaf(1, user) }), turn, counters),
    ).toMatchObject({ kind: "deny", rule: "P0" });
  });
});

describe("the tool registry fails closed", () => {
  const base = {
    name: "x.y",
    effect: "read" as const,
    title: "X",
    describe: "x",
    args: {},
    run: () => leaf(null, user),
  };
  it("refuses a tool, effect or argument without its classification", () => {
    expect(() => new ToolRegistry().register({ ...base, effect: "magic" as never })).toThrow(
      "unclassified effect",
    );
    expect(() =>
      new ToolRegistry().register({
        ...base,
        args: { a: { role: "whatever" as never, describe: "a" } },
      }),
    ).toThrow("has no role");
    expect(() =>
      new ToolRegistry().register({ ...base, args: { a: { role: "recipient", describe: "a" } } }),
    ).toThrow("a destination in a read tool");
    expect(() => new ToolRegistry().register({ ...base, effect: "send" })).toThrow(
      "without a destination",
    );
    expect(() => coreTools().freeze().register(base)).toThrow("frozen");
  });
  it("has no tool that leaves in production yet", () => {
    expect(
      coreTools()
        .all()
        .filter((t) => t.effect === "egress" || t.effect === "send"),
    ).toEqual([]);
  });
});

describe("the planner view", () => {
  it("turns what the planner may not see into handles, item by item", () => {
    const v = list(
      [
        rec({ titulo: leaf("Comprar pan", user) }, own),
        rec({ titulo: leaf("SECRETO del correo", ext) }, own),
      ],
      own,
    );
    const view = JSON.stringify(toPlannerView(v, "$s1"));
    expect(view).toContain("Comprar pan");
    expect(view).not.toContain("SECRETO");
    expect(view).toContain('"$handle":"$s1[1].titulo"');
  });
});

describe("confirmations against visual deception", () => {
  it("marks invisible and direction characters, mixed scripts and international domains", () => {
    expect(marksOf("hola")).toEqual([]);
    expect(marksOf(`pago${String.fromCodePoint(0x202e)}gnp.exe`)).toEqual(["bidi", "invisible"]);
    expect(marksOf(`ho${String.fromCodePoint(0x200b)}la`)).toEqual(["invisible"]);
    expect(marksOf("аna@example.com")).toContain("mixed-script");
    expect(marksOf("ana@exámple.com")).toContain("punycode:xn--exmple-qta.com");
    expect(marksOf("x".repeat(2001))).toEqual(["long"]);
  });
});

describe("readers and functions", () => {
  it("checks a reader's answer again: links, HTML, dates and options", () => {
    expect(checkReaderOutput("summarize", { text: "Un resumen." })).not.toBeNull();
    expect(checkReaderOutput("summarize", { text: "mira https://x.example" })).toBeNull();
    expect(checkReaderOutput("summarize", { text: "<img src=x>" })).toBeNull();
    expect(checkReaderOutput("summarize", { text: "ok", extra: 1 })).toBeNull();
    expect(checkReaderOutput("classify", { choice: "b" }, ["a", "b"])).not.toBeNull();
    expect(checkReaderOutput("classify", { choice: "c" }, ["a", "b"])).toBeNull();
    const task = { title: "Pagar", due: "2026-10-21", sender: null, message_id: null };
    expect(checkReaderOutput("extract_tasks", { tasks: [task] })).not.toBeNull();
    expect(checkReaderOutput("extract_tasks", { tasks: [{ ...task, due: "mañana" }] })).toBeNull();
    // Readers over a list: one line or one choice per text, in order; the counts are the code's.
    const lines = (ls: string[]) => ({ items: ls.map((line) => ({ line })) });
    expect(checkReaderOutput("summarize_each", lines(["a", "b"]), [], 2)).toEqual(
      lines(["a", "b"]),
    );
    expect(checkReaderOutput("summarize_each", lines(["a"]), [], 2)).toBeNull();
    expect(
      checkReaderOutput("summarize_each", lines(["a", "https://x.example"]), [], 2),
    ).toBeNull();
    // With options, each item has its kind (one of them), and the counts are the code's.
    const kinds = {
      items: [
        { line: "a", kind: "y" },
        { line: "b", kind: "x" },
      ],
    };
    expect(checkReaderOutput("summarize_each", kinds, ["x", "y"], 2)).toEqual({
      ...kinds,
      counts: [
        { option: "x", n: 1 },
        { option: "y", n: 1 },
      ],
    });
    expect(checkReaderOutput("summarize_each", lines(["a", "b"]), ["x", "y"], 2)).toBeNull();
    expect(checkReaderOutput("summarize_each", kinds, [], 2)).toBeNull();
    expect(checkReaderOutput("label_each", { choices: ["b", "a", "b"] }, ["a", "b"], 3)).toEqual({
      choices: ["b", "a", "b"],
      counts: [
        { option: "a", n: 1 },
        { option: "b", n: 2 },
      ],
    });
    expect(checkReaderOutput("label_each", { choices: ["c"] }, ["a", "b"], 1)).toBeNull();
    expect(checkReaderOutput("label_each", { choices: ["a"] }, ["a", "b"], 2)).toBeNull();
    // A refused answer says the rule it breaks, never its content (task 29).
    expect(checkReader("summarize_each", lines(["a"]), [], 2)).toEqual({ fault: "count" });
    expect(checkReader("summarize_each", kinds, [], 2)).toEqual({ fault: "item-keys" });
    const variant = {
      items: [
        { line: "a", kind: "y" },
        { line: "b", kind: "X" },
      ],
    };
    expect(checkReader("summarize_each", variant, ["x", "y"], 2)).toEqual({ fault: "kind" });
    expect(checkReader("summarize_each", lines(["a", "https://x.example"]), [], 2)).toEqual({
      fault: "line-link-or-html",
    });
    expect(checkReader("label_each", { choices: ["c"] }, ["a", "b"], 1)).toEqual({
      fault: "choice",
    });
    expect(checkReader("classify", { choice: "c" }, ["a", "b"])).toEqual({ fault: "choice" });
    expect(checkReader("extract_tasks", { tasks: [{ ...task, due: "mañana" }] })).toEqual({
      fault: "due",
    });
    expect(checkReader("summarize", { text: "x".repeat(2001) })).toEqual({
      fault: "text-too-long",
    });
    expect(checkReader("summarize", "no")).toEqual({ fault: "not-an-object" });
  });
  it("the options a reader may answer with go in its schema as an enumeration (task 29)", () => {
    expect(readerSchema("summarize_each", ["x", "y"])).toMatchObject({
      properties: { items: { items: { properties: { kind: { enum: ["x", "y"] } } } } },
    });
    expect(readerSchema("label_each", ["x", "y"])).toMatchObject({
      properties: { choices: { items: { enum: ["x", "y"] } } },
    });
    expect(readerSchema("classify", ["x", "y"])).toMatchObject({
      properties: { choice: { enum: ["x", "y"] } },
    });
    // Without options there is no enumeration (an empty one is not a schema), and no "kind" at all.
    expect(JSON.stringify(readerSchema("summarize_each", []))).not.toMatch(/enum|kind/);
    expect(JSON.stringify(readerSchema("classify", []))).not.toContain("enum");
    // The enumeration survives what the APIs accept of a schema.
    expect(JSON.stringify(apiSchema(readerSchema("classify", ["x"])))).toContain('"enum":["x"]');
  });
  it("functions keep the lowest label and mark what they make as derived", () => {
    const r = callFn("concat", [leaf("ana", user), leaf("@x.example", ext)], "2026-10-20");
    expect(r).toMatchObject({
      t: "v",
      value: "ana@x.example",
      derived: true,
      label: { integrity: "external" },
    });
    const n = callFn("count", [list([leaf(1, ext)], own)], "2026-10-20");
    expect(n).toMatchObject({ value: 1, label: { integrity: "external" } });
    expect(
      callFn("add_days", [leaf("2026-10-30", user), leaf(3, model)], "2026-10-20"),
    ).toMatchObject({ value: "2026-11-02" });
  });
  it("a key through a list takes it from every item, one level flat, with the labels that decided its length", () => {
    // Two reads with "each": the first found one task, the second (a mail from outside) none.
    const title = leaf("Enviar el informe", ext);
    const task = rec({ title }, ext);
    const reads = list(
      [rec({ tasks: list([task], ext) }, ext), rec({ tasks: list([], own) }, own)],
      model,
    );
    const all = at(reads, ["tasks"]);
    expect(all).toMatchObject({ t: "list", derived: true, label: { integrity: "external" } });
    expect(all?.t === "list" && all.items).toEqual([task]);
    expect(at(reads, ["tasks", 0, "title"])).toBe(title);
    expect(at(reads, ["tasks", "title"])).toMatchObject({
      t: "list",
      items: [{ value: "Enviar el informe" }],
    });
    // A key no item has is wrong (nothing, as for a record); an empty list stays an empty list.
    expect(at(reads, ["tareas"])).toBeNull();
    expect(at(list([], own), ["tasks"])).toMatchObject({ t: "list", items: [] });
    expect(atOrNull(reads, ["tareas"])).toMatchObject({ t: "v", value: null });
    expect(atOrNull(reads, ["tasks"])).toMatchObject({ t: "list", items: [task] });
  });
  it("neutralizes remote resources (P17)", () => {
    expect(neutralize("![x](https://evil.example/a.png?q=1) <img src=x> <iframe>")).toBe(
      "x (https:⁄⁄evil.example/a.png?q=1) &lt;img src=x> &lt;iframe>",
    );
  });
});
