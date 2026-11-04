/** (test) Flows kept as data (docs/flujos.md, F1): the mail reading saved as «Leer correo», drawn and counted. */
import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { ensureFlow, exprText, flowsView, flowView, inputsOf, MAIL_FLOW } from "./flows.ts";
import { mailPlan } from "./mail.ts";

const TARGETS = [
  { key: "docencia", name: "Docencia", option: "Docencia", date: "date", id: "t_docencia" },
  { key: "gestiones", name: "Gestiones", option: "Gestiones", date: "date", id: "t_gestiones" },
];
const planOf = (targets = TARGETS) =>
  mailPlan(targets, {
    guide: true,
    modules: ["tasks", "events"],
    boundModules: true,
    askWhenUnsure: true,
  });

describe("flows (docs/flujos.md, F1)", () => {
  it("the mail plan is the same for every mail of a configuration: what varies is its inputs", () => {
    const plan = planOf();
    expect(JSON.stringify(plan)).toBe(JSON.stringify(planOf()));
    expect(inputsOf(plan).map((i) => `${i.id}:${i.what}`)).toEqual([
      "mail:record",
      "text:text",
      "modules:modules",
      "userIn:value",
      "known:list",
      "guide:guide",
      "options:options",
      "subject:text",
    ]);
    // The mail's id is bound, never written in the plan.
    expect(JSON.stringify(plan)).not.toContain("e_");
  });

  it("is saved as a version once per distinct plan; a run says its flow", () => {
    const store = openUserStore(":memory:");
    const a = ensureFlow(
      store,
      {
        id: MAIL_FLOW,
        name: "Leer correo",
        trigger: { created: "correo" },
        plan: planOf(),
        by: "preset",
      },
      1000,
    );
    expect(a).toMatchObject({ id: MAIL_FLOW, version: 1, by: "preset", enabled: true });
    expect(a.inputs).toEqual(inputsOf(planOf()));
    // The same plan again: the same version. A changed configuration (one collection more): a new one.
    expect(
      ensureFlow(
        store,
        {
          id: MAIL_FLOW,
          name: "Leer correo",
          trigger: { created: "correo" },
          plan: planOf(),
          by: "preset",
        },
        2000,
      ).version,
    ).toBe(1);
    const more = [
      ...TARGETS,
      { key: "diario", name: "Diario", option: "Diario", date: "date", id: "t_diario" },
    ];
    const b = ensureFlow(
      store,
      {
        id: MAIL_FLOW,
        name: "Leer correo",
        trigger: { created: "correo" },
        plan: planOf(more),
        by: "preset",
      },
      3000,
    );
    expect(b.version).toBe(2);
    expect(store.journal.flowVersions(MAIL_FLOW).map((v) => v.version)).toEqual([2, 1]);
    // Off stays off across versions the code saves.
    store.journal.setFlowEnabled(MAIL_FLOW, false);
    const c = ensureFlow(
      store,
      {
        id: MAIL_FLOW,
        name: "Leer correo",
        trigger: { created: "correo" },
        plan: planOf(TARGETS),
        by: "preset",
      },
      4000,
    );
    expect(c).toMatchObject({ version: 3, enabled: false });
    expect(flowsView(store)).toEqual([
      expect.objectContaining({
        id: MAIL_FLOW,
        name: "Leer correo",
        version: 3,
        runs: 0,
        last: null,
      }),
    ]);
    store.close();
  });

  it("is drawn as nodes with their arrows, named from the registry, with how often each step ran", () => {
    const store = openUserStore(":memory:");
    const f = ensureFlow(
      store,
      {
        id: MAIL_FLOW,
        name: "Leer correo",
        trigger: { created: "correo" },
        plan: planOf(),
        by: "preset",
      },
      1000,
    );
    const j = store.journal;
    for (const [run, at] of [
      ["run-1", 2000],
      ["run-2", 3000],
    ] as const) {
      j.startRun({
        id: run,
        turn: null,
        origin: "background",
        device: null,
        started: at,
        flow: f.id,
        flowVersion: f.version,
        input: `e_mail_${run}`,
      });
      j.step({ run, step: "m", kind: "call", decision: "allow", rule: "P1", detail: null, at });
      j.step({ run, step: "r", kind: "read", decision: "allow", rule: "P1", detail: null, at });
      j.step({ run, step: "c", kind: "read", decision: "allow", rule: "P1", detail: null, at });
    }
    j.step({
      run: "run-1",
      step: "n0_tasks",
      kind: "call",
      decision: "propose",
      rule: "P4",
      detail: null,
      at: 2100,
    });
    j.step({
      run: "run-1",
      step: "n0_tasks",
      kind: "call",
      decision: "propose",
      rule: "P4",
      detail: null,
      at: 2200,
    });
    const titles: Record<string, string> = { "entities.get": "Leer", "entities.create": "Crear" };
    const v = flowView(
      store,
      MAIL_FLOW,
      10_000,
      7,
      (t) => titles[t] ?? null,
      (k) => (k === "docencia" ? "Docencia" : null),
    );
    if (!v) throw new Error("no flow");
    expect(v).toMatchObject({ id: MAIL_FLOW, version: 1, runs: 2, last: 3000, days: 7 });
    expect(v.inputs.map((i) => i.id)).toContain("mail");
    const byId = new Map(v.nodes.map((n) => [n.id, n]));
    expect(byId.get("m")).toMatchObject({
      op: "call",
      what: "entities.get",
      title: "Leer",
      deps: ["mail"],
      ran: { allow: 2 },
    });
    expect(byId.get("r")).toMatchObject({
      op: "read",
      what: "read_message",
      title: null,
      when: false,
      each: false,
    });
    expect(byId.get("r")?.deps.sort()).toEqual(["guide", "known", "modules", "text", "userIn"]);
    expect(byId.get("c")).toMatchObject({ op: "read", what: "classify", when: true });
    expect(byId.get("c")?.deps).toContain("r");
    const create = byId.get("n0_tasks");
    expect(create).toMatchObject({
      op: "call",
      what: "entities.create",
      title: "Crear",
      detail: "Docencia",
      each: true,
      when: true,
      ran: { propose: 2 },
    });
    expect(create?.deps).toEqual(expect.arrayContaining(["r", "c"]));
    expect(create?.args.some((a) => a.startsWith("type: "))).toBe(true);
    expect(byId.get("n1_tasks")?.ran).toEqual({});
    expect(
      flowView(
        store,
        "nadie",
        10_000,
        7,
        () => null,
        () => null,
      ),
    ).toBeNull();
    store.close();
  });

  it("writes an expression as a short text", () => {
    expect(exprText({ ref: "$m.asunto" })).toBe("$m.asunto");
    expect(exprText({ lit: "Docencia" })).toBe('"Docencia"');
    expect(exprText({ lit: 3 })).toBe("3");
    expect(exprText({ fn: "concat", args: [{ ref: "$text" }, { lit: "\n\nElemento: " }] })).toBe(
      'concat($text, "\\n\\nElemento: ")',
    );
    expect(exprText({ quote: "hola" })).toBe("«hola»");
    expect(
      exprText({
        fn: "a",
        args: [{ fn: "b", args: [{ fn: "c", args: [{ fn: "d", args: [] }] }] }],
      }),
    ).toBe("a(b(c(d(…))))");
    expect(exprText({ lit: "x".repeat(80) })).toBe(`"${"x".repeat(57)}…"`);
  });
});
