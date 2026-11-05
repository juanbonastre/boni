/** (test) Flows kept as data (docs/flujos.md, F1): the mail reading saved as «Leer correo», drawn and counted. */
import { checkPlan, coreTools } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import {
  checkFlow,
  createFlow,
  ensureFlow,
  exprText,
  flowCatalog,
  flowsView,
  flowView,
  inputsOf,
  MAIL_FLOW,
  revertFlow,
  saveUserFlow,
} from "./flows.ts";
import { mailPlan } from "./mail.ts";
import { withPieces } from "./pieces.ts";

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
    // What the code worked out around the models (the guide's rule, what waits, the relations) is Boni's pieces,
    // steps of the plan (docs/sistema.md §4.2): no longer inputs.
    expect(inputsOf(plan).map((i) => `${i.id}:${i.what}`)).toEqual([
      "mail:record",
      "asked:value",
      "again:value",
      "writes:list",
      "text:text",
      "modules:modules",
      "userIn:value",
      "guide:guide",
      "options:options",
      "subject:text",
    ]);
    expect(
      (plan as { steps: { id: string; tool?: string }[] }).steps
        .filter((s) => s.tool && /^(mail|inbox)\./.test(s.tool))
        .map((s) => `${s.id}:${s.tool}`),
    ).toEqual([
      "only:mail.rule",
      "known:mail.known",
      "prefill:mail.relations",
      "fold:inbox.fold",
      "alone:inbox.accept_alone",
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

describe("the flow editor (docs/flujos.md, F2)", () => {
  const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
  const withTypes = () => {
    const store = openUserStore(":memory:");
    for (const [id, key, name] of [
      ["t_tarea", "tarea", "Tarea"],
      ["t_correo", "correo", "Correos"],
      ["t_diario", "diario", "Diario"],
    ] as const)
      store.applySchema(
        {
          op: "create_type",
          type: {
            id,
            key,
            name,
            fields: [
              {
                id: `${id}_t`,
                key: id === "t_correo" ? "asunto" : "titulo",
                name: "Título",
                type: "text",
                label: own,
              },
              { id: `${id}_d`, key: "dia", name: "Día", type: "date", label: own },
            ],
            titleField: `${id}_t`,
            roles: { date: `${id}_d` },
            sensitivity: "personal",
            schemaVersion: 1,
            label: own,
          },
        },
        { actor: "user" },
      );
    store.setAiAccess("t_diario", "restricted", "portatil");
    return store;
  };
  // The server's registry: the core's tools and Boni's pieces (docs/sistema.md §4.2).
  const registry = withPieces(coreTools()).freeze();
  const o = { modules: ["tasks", "events"], mailType: "t_correo" };

  it("its nodes are the registry's tools and the readers, the same the planner may use (D-41)", () => {
    const store = withTypes();
    const c = flowCatalog(registry, store, o.modules);
    expect(c.tools.map((t) => t.name).sort()).toEqual(registry.names().sort());
    expect(c.tools.find((t) => t.name === "entities.create")).toMatchObject({
      title: "Crear",
      args: [
        { name: "type", role: "type", required: true },
        { name: "values", role: "content", required: true },
      ],
    });
    expect(c.readers.fill).toMatchObject({ params: ["fields"], required: ["fields"] });
    expect(c.readers.read_message?.out).toEqual(
      expect.arrayContaining(["all", "tasks", "tasks.title"]),
    );
    // A collection the models may not see is not offered; each field with the roles it plays.
    expect(c.collections.map((x) => x.key)).toEqual(["tarea", "correo"]);
    expect(c.collections[0]?.fields).toEqual([
      { key: "titulo", name: "Título", type: "text", roles: ["title"], relation: null },
      { key: "dia", name: "Día", type: "date", roles: ["date"], relation: null },
    ]);
    store.close();
  });

  it("a piece of Boni is only in a flow a record starts, never in a model's plan (P20; docs/sistema.md §4.2)", () => {
    const store = withTypes();
    const piece = { id: "g", op: "call", tool: "mail.rule", args: { mail: { ref: "$mail" } } };
    const byMail = checkFlow(
      store,
      registry,
      { trigger: { created: "correo" }, plan: { version: 1, steps: [piece] } },
      o,
    );
    expect(byMail.problems).toEqual([]);
    const byHand = checkFlow(
      store,
      registry,
      {
        trigger: { manual: true },
        plan: { version: 1, steps: [{ ...piece, args: { mail: { lit: "e_x" } } }] },
      },
      o,
    );
    expect(byHand.problems).toContainEqual({ step: "g", at: null, code: "piece-needs-record" });
    // The editor offers it, marked as a piece that works on the record; a model's plan cannot name it.
    expect(
      flowCatalog(registry, store, o.modules).tools.find((t) => t.name === "mail.rule"),
    ).toMatchObject({
      effect: "piece",
      record: true,
      title: "Reglas de la guía",
    });
    expect(
      checkPlan({ version: 1, steps: [piece] }, registry, { kind: "turn", trust: "personal" }, [
        "mail",
      ]).ok,
    ).toBe(false);
    store.close();
  });

  it("Boni's own «Leer correo», with its pieces named as the values the code bound, passes the checklist (F7)", () => {
    // The independent review of F7 found it: the pieces' steps (`only`, `known`, `inv`, `prefill`) were taken for the
    // trigger's names, and the editor greyed out «Probar» and «Guardar».
    const store = withTypes();
    const plan = mailPlan(
      [{ key: "tarea", name: "Tarea", option: "Tarea", date: "dia", id: "t_tarea" }],
      { guide: true, modules: ["tasks", "events"], boundModules: true, invitation: "events" },
    );
    const c = checkFlow(store, registry, { trigger: { created: "correo" }, plan }, o);
    expect(c.problems).toEqual([]);
    // Each piece offers what it gives to the steps after it.
    expect(c.refs.r?.map((x) => x.ref)).toEqual(
      expect.arrayContaining(["$only", "$known", "$inv.uid", "$prefill.tarea"]),
    );
    store.close();
  });

  it("its checklist says what the run would refuse, step by step, and what each step may take", () => {
    const store = withTypes();
    const mailFlow = {
      trigger: { created: "correo" },
      plan: {
        version: 1,
        steps: [
          { id: "m", op: "call", tool: "entities.get", args: { id: { ref: "$mail" } } },
          { id: "r", op: "read", reader: "read_message", input: { ref: "$text" }, params: {} },
          {
            id: "n",
            op: "call",
            tool: "entities.create",
            each: { ref: "$r.tasks" },
            args: {
              type: { lit: "tarea" },
              values: { fn: "obj", args: [{ lit: "title" }, { ref: "$item.title" }] },
            },
          },
        ],
      },
    };
    const ok = checkFlow(store, registry, mailFlow, o);
    expect(ok.problems).toEqual([]);
    const refsOfN = ok.refs.n?.map((r) => r.ref) ?? [];
    expect(refsOfN).toEqual(
      expect.arrayContaining([
        "$mail",
        "$text",
        "$m.asunto",
        "$r.tasks",
        "$item.title",
        "$item.due",
      ]),
    );
    expect(refsOfN).not.toContain("$n");
    // What each step gives, for its panel's «Sale» (task 70): the mail a record, the reading its lists, a step in a
    // loop a list of what one round makes.
    expect(ok.outs.m?.[0]).toEqual({ ref: "$m", t: "record" });
    expect(ok.outs.r).toEqual(expect.arrayContaining([{ ref: "$r.tasks", t: "list" }]));
    expect(ok.outs.n?.[0]).toEqual({ ref: "$n", t: "list" });
    const told = checkFlow(
      store,
      registry,
      {
        trigger: { manual: true },
        plan: {
          version: 1,
          steps: [
            { id: "a", op: "call", tool: "notify", args: { text: { lit: "hola" } } },
            { id: "b", op: "reply", component: "text", data: { template: { lit: "hecho" } } },
          ],
        },
      },
      o,
    );
    expect(told.outs).toEqual({ a: [{ ref: "$a", t: "bool" }], b: [] });
    // Broken on purpose: a step that does not exist yet, a missing argument, a closed collection, a tool its origin
    // may not use (no flow saved from work of its own), and no steps at all.
    const broken = structuredClone(mailFlow) as typeof mailFlow & {
      plan: { steps: Record<string, unknown>[] };
    };
    broken.plan.steps.push(
      {
        id: "x",
        op: "call",
        tool: "entities.create",
        args: { type: { lit: "diario" }, values: { ref: "$nadie" } },
      },
      { id: "y", op: "call", tool: "entities.query", args: {} },
      {
        id: "z",
        op: "call",
        tool: "flows.save",
        args: {
          name: { lit: "a" },
          trigger: { lit: { manual: true } },
          plan: { lit: { version: 1, steps: [] } },
        },
      },
    );
    const bad = checkFlow(store, registry, broken, o).problems;
    expect(bad).toEqual(
      expect.arrayContaining([
        { step: "x", at: "args.values", code: "ref-to-unknown-step" },
        { step: "x", at: "args.type", code: "closed-collection" },
        { step: "y", at: "args", code: "missing-argument" },
        { step: "z", at: null, code: "tool-not-here" },
      ]),
    );
    expect(
      checkFlow(store, registry, { trigger: { manual: true }, plan: { version: 1, steps: [] } }, o)
        .problems,
    ).toEqual([{ step: null, at: null, code: "no-steps" }]);
    expect(
      checkFlow(store, registry, { trigger: { what: 1 }, plan: mailFlow.plan }, o).problems,
    ).toContainEqual({
      step: null,
      at: "trigger",
      code: "bad-trigger",
    });
    // By hand, a form's names are what the plan may take.
    const manual = {
      trigger: { manual: true, inputs: [{ name: "tema" }] },
      plan: {
        version: 1,
        steps: [{ id: "a", op: "reply", component: "text", data: { template: { ref: "$tema" } } }],
      },
    };
    expect(checkFlow(store, registry, manual, o)).toMatchObject({
      problems: [],
      refs: { a: [{ ref: "$tema", t: "text" }] },
    });
    // A flow never starts another (F4): by hand or on a schedule, `flows.run` is the planner's alone.
    const nested = (trigger: unknown) => ({
      trigger,
      plan: {
        version: 1,
        steps: [{ id: "f", op: "call", tool: "flows.run", args: { flow: { lit: "otro" } } }],
      },
    });
    for (const trigger of [{ manual: true }, { schedule: { every: "day", at: "08:00" } }])
      expect(checkFlow(store, registry, nested(trigger), o).problems).toEqual([
        { step: "f", at: null, code: "flow-in-flow" },
      ]);
    // On a schedule, what it is given is `$today`.
    const daily = {
      trigger: { schedule: { every: "day", at: "08:00" } },
      plan: {
        version: 1,
        steps: [{ id: "a", op: "call", tool: "notify", args: { text: { ref: "$today" } } }],
      },
    };
    expect(checkFlow(store, registry, daily, o)).toMatchObject({
      problems: [],
      refs: { a: [{ ref: "$today", t: "text" }] },
    });
    store.close();
  });

  it("a new one starts off, empty or as a copy; saved only over the version it started from, with an empty checklist", () => {
    const store = withTypes();
    const empty = createFlow(store, { name: "Resumen del lunes" }, 1000);
    expect(empty).toMatchObject({
      version: 1,
      by: "user",
      enabled: false,
      trigger: { manual: true },
    });
    expect(empty?.id).toMatch(/^resumen-del-lunes-[0-9a-f]{6}$/);
    const plan = {
      version: 1,
      steps: [{ id: "a", op: "reply", component: "text", data: { template: { lit: "Hola" } } }],
    };
    const id = empty?.id as string;
    expect(saveUserFlow(store, id, { base: 2, plan }, [], 2000)).toEqual({ error: "conflict" });
    expect(
      saveUserFlow(store, id, { base: 1, plan }, [{ step: "a", at: null, code: "x" }], 2000),
    ).toEqual({ error: "invalid" });
    expect(saveUserFlow(store, id, { base: 1, plan, name: "Resumen" }, [], 2000)).toMatchObject({
      flow: { version: 2, name: "Resumen", enabled: false },
    });
    expect(saveUserFlow(store, "nadie", { base: 1, plan }, [], 2000)).toEqual({
      error: "not-found",
    });
    // The mail flow keeps its trigger.
    ensureFlow(
      store,
      { id: MAIL_FLOW, name: "Leer correo", trigger: { created: "correo" }, plan, by: "preset" },
      1000,
    );
    expect(
      saveUserFlow(store, MAIL_FLOW, { base: 1, plan, trigger: { manual: true } }, [], 2000),
    ).toEqual({ error: "trigger" });
    // A copy: another id, the same plan, off.
    const copy = createFlow(store, { name: "Copia de Resumen", from: id }, 3000);
    expect(copy).toMatchObject({ version: 1, name: "Copia de Resumen", enabled: false, plan });
    expect(copy?.id).not.toBe(id);
    expect(createFlow(store, { name: "x", from: "nadie" }, 3000)).toBeNull();
    // Back to a version: a new one, his; deleted: out of the list, its versions kept.
    expect(revertFlow(store, id, { version: 1 }, 4000)).toMatchObject({
      version: 3,
      by: "user",
      plan: { steps: [] },
    });
    store.journal.setFlowDeleted(id, true);
    expect(flowsView(store).map((f) => f.id)).not.toContain(id);
    expect(store.journal.flowVersions(id)).toHaveLength(3);
    store.close();
  });
});
