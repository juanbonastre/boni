/** (test) Flows kept as data (docs/flujos.md, F1): the mail reading saved as «Leer correo», drawn and counted. */
import { checkPlan, coreTools, leaf } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import {
  BUDGET_FLOW,
  checkFlow,
  createFlow,
  drawnRun,
  ensureFlow,
  exprText,
  FETCH_FLOW,
  flowCatalog,
  flowsView,
  flowView,
  inputsOf,
  MAIL_FLOW,
  REVIEW_FLOW,
  revertFlow,
  saveUserFlow,
  triggerNames,
  triggerOk,
  typeKeysOf,
} from "./flows.ts";
import { triggerWords } from "./flowsCollection.ts";
import { foldDays, mailPlan } from "./mail.ts";
import { BUDGET_PLAN, BUDGET_TRIGGER } from "./models.ts";
import { withPieces } from "./pieces.ts";

const CODE_LABEL = label("own", "public", [{ kind: "code", id: "test" }]);

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
    // steps of the plan (docs/sistema.md §4.2): no longer inputs. In the order the plan first takes them: the
    // collections it writes in, when «Buscar relaciones» runs, after the Decisora.
    expect(inputsOf(plan).map((i) => `${i.id}:${i.what}`)).toEqual([
      "mail:record",
      "asked:value",
      "again:value",
      "text:text",
      "modules:modules",
      "userIn:value",
      "guide:guide",
      "options:options",
      "subject:text",
      "writes:list",
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

  it("a run of an earlier version is drawn over its own steps, and one from before flows over the plan it ran (task 90's review)", () => {
    const store = openUserStore(":memory:");
    const save = (plan: unknown, at: number) =>
      ensureFlow(
        store,
        { id: MAIL_FLOW, name: "Leer correo", trigger: { created: "correo" }, plan, by: "preset" },
        at,
      );
    // Before «Crear en la elegida»: a «Rellenadora» and a «Crear» per collection, with other ids.
    const old = {
      version: 1,
      steps: [
        { id: "r", op: "read", reader: "read_message", input: { ref: "$text" } },
        {
          id: "n0_tasks",
          op: "call",
          tool: "entities.create",
          each: { ref: "$r.tasks" },
          args: {
            type: { lit: "docencia" },
            values: { fn: "obj", args: [{ lit: "title" }, { ref: "$item.title" }] },
          },
        },
      ],
    };
    expect(save(old, 1000).version).toBe(1);
    expect(save(planOf(), 2000).version).toBe(2);
    const run = (id: string, version: number | null, plan: unknown) => {
      store.journal.startRun({
        id,
        turn: null,
        origin: "background",
        device: null,
        started: 3000,
        ...(version !== null ? { flow: MAIL_FLOW, flowVersion: version } : {}),
      });
      store.journal.setPlan(id, plan);
      return store.journal.run(id) as NonNullable<ReturnType<typeof store.journal.run>>;
    };
    const titles: Record<string, string> = { "entities.create": "Crear" };
    const draw = (r: ReturnType<typeof run>, owner: string | null = `flow:${MAIL_FLOW}`) =>
      drawnRun(
        store,
        r,
        owner,
        (t) => titles[t] ?? null,
        (k) => (k === "docencia" ? "Docencia" : null),
      );
    const earlier = draw(run("r_v1", 1, old));
    expect(earlier?.version).toBe(1);
    expect(earlier?.steps.map((x) => [x.id, x.title, x.detail])).toEqual([
      ["r", null, null],
      ["n0_tasks", "Crear", "Docencia"],
    ]);
    // The latest version: drawn as the map has it.
    expect(draw(run("r_v2", 2, planOf()))).toBeNull();
    // From before flows: over the plan it ran.
    expect(draw(run("r_antes", null, old))?.steps.map((x) => x.id)).toEqual(["r", "n0_tasks"]);
    // Not a flow's run: nothing to draw.
    expect(draw(run("r_chat", null, old), "boni:chat")).toBeNull();
    store.close();
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
      // Its reading's model call, on its step (task 90); the planner's has none.
      j.modelCall({
        run,
        role: "reader",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        promptHash: "h",
        request: {},
        response: {},
        usage: { input: 900, output: 60, cost: 0.0021 },
        at: at + 1,
        step: "r",
      });
    }
    j.step({
      run: "run-1",
      step: "n",
      kind: "call",
      decision: "propose",
      rule: "P4",
      detail: null,
      at: 2100,
    });
    j.step({
      run: "run-1",
      step: "n",
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
      calls: 2,
      cost: 0.0042,
    });
    expect(byId.get("m")?.calls).toBeUndefined();
    expect(byId.get("r")?.deps.sort()).toEqual(["guide", "known", "modules", "text", "userIn"]);
    expect(byId.get("c")).toMatchObject({ op: "read", what: "classify", when: true });
    expect(byId.get("c")?.deps).toContain("r");
    // «Crear en la elegida» (docs/sistema.md §4.2): one «Crear» in the collection the decider chose, among those
    // its `case` writes; no step per collection.
    const create = byId.get("n");
    expect(create).toMatchObject({
      op: "call",
      what: "entities.create",
      title: "Crear",
      detail: null,
      each: true,
      when: true,
      ran: { propose: 2 },
    });
    expect(create?.into).toContain("Docencia");
    expect(create?.into?.length).toBeGreaterThan(1);
    expect(create?.deps).toEqual(expect.arrayContaining(["r", "c"]));
    expect(create?.args.some((a) => a.startsWith("type: case("))).toBe(true);
    expect(byId.has("n0_tasks") || byId.has("n1_tasks")).toBe(false);
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
    expect(c.readers.fill).toMatchObject({
      params: ["fields", "collection"],
      required: ["fields"],
    });
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

  it("the collection a step reads or writes is written in it, never worked out as it runs (D-48; docs/sistema.md §4.4)", () => {
    const store = withTypes();
    const step = (type: unknown) => ({
      id: "a",
      op: "call",
      tool: "entities.create",
      args: { type, values: { fn: "obj", args: [{ lit: "title" }, { lit: "Una" }] } },
    });
    const flow = (type: unknown) => ({
      trigger: { manual: true },
      plan: { version: 1, steps: [step(type)] },
    });
    expect(checkFlow(store, registry, flow({ lit: "tarea" }), o).problems).toEqual([]);
    // Picked as it runs (a value of an earlier step, a form's field): the map could not say where it writes.
    expect(checkFlow(store, registry, flow({ ref: "$coleccion" }), o).problems).toContainEqual({
      step: "a",
      at: "args.type",
      code: "collection-not-literal",
    });
    // One of a few written in it («Crear en la elegida»: a `case` over literals): the map knows each of them.
    const chosen = (results: unknown[]) => ({
      trigger: { manual: true, inputs: [{ name: "donde" }] },
      plan: {
        version: 1,
        steps: [
          step({
            fn: "case",
            args: [
              { ref: "$donde" },
              { lit: "Tareas" },
              results[0],
              { lit: "Correos" },
              results[1],
            ],
          }),
        ],
      },
    });
    expect(
      checkFlow(store, registry, chosen([{ lit: "tarea" }, { lit: "correo" }]), o).problems,
    ).toEqual([]);
    expect(
      typeKeysOf(chosen([{ lit: "tarea" }, { lit: "correo" }]).plan.steps[0]?.args.type),
    ).toEqual(["tarea", "correo"]);
    // One the models may not see among them: the run could not make it there.
    expect(
      checkFlow(store, registry, chosen([{ lit: "tarea" }, { lit: "diario" }]), o).problems,
    ).toContainEqual({ step: "a", at: "args.type", code: "closed-collection" });
    // A result worked out as it runs is not one of a literal list.
    expect(
      checkFlow(store, registry, chosen([{ lit: "tarea" }, { ref: "$donde" }]), o).problems,
    ).toContainEqual({ step: "a", at: "args.type", code: "collection-not-literal" });
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
      title: "Regla del remitente",
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

  it("with several collections, «Leer correo» creates in the chosen one: one «Rellenadora» and one «Crear» for everything it reads, the invitation apart (docs/sistema.md §4.2)", () => {
    const store = withTypes();
    const targets = [
      {
        key: "tarea",
        name: "Tarea",
        option: "Tarea (p. ej.: Llamar al taller)",
        date: "dia",
        id: "t_tarea",
        fill: [
          {
            key: "prioridad",
            name: "Prioridad",
            kind: "choice" as const,
            options: [{ value: "o_alta", label: "Alta" }],
          },
        ],
      },
      {
        key: "correo",
        name: "Correos",
        option: "Correos (p. ej.: Informe)",
        date: null,
        id: "t_correo",
      },
    ];
    const plan = mailPlan(targets, {
      guide: true,
      modules: ["tasks", "events"],
      boundModules: true,
      invitation: "events",
    }) as {
      steps: {
        id: string;
        tool?: string;
        reader?: string;
        args?: { type?: unknown };
        params?: Record<string, unknown>;
      }[];
    };
    // It passes the checklist: each «Crear» writes in one of a literal list (D-48).
    const c = checkFlow(store, registry, { trigger: { created: "correo" }, plan }, o);
    expect(c.problems).toEqual([]);
    const creates = plan.steps.filter((x) => x.tool === "entities.create");
    // One «Crear» for every thing the reader found, its tasks and its events (Juan, 2026-11-06: «Haz la B»), and
    // the invitation's own: no model reads it.
    expect(creates.map((x) => x.id)).toEqual(["n", "inv_create"]);
    for (const x of creates) expect(typeKeysOf(x.args?.type)).toEqual(["tarea", "correo"]);
    expect((creates[0] as { each?: unknown }).each).toEqual({ ref: "$r.all" });
    // One «Rellenadora», over the fields of the collection chosen.
    const fills = plan.steps.filter((x) => x.reader === "fill");
    expect(fills.map((x) => x.id)).toEqual(["n_f"]);
    expect((fills[0] as { each?: unknown }).each).toEqual({ ref: "$r.all" });
    expect(fills[0]?.params).toMatchObject({ fields: { ref: "$fill" } });
    // A rule of the guide is the decider's answer, so the choice is always «Decisora»'s.
    expect(plan.steps.find((x) => x.reader === "classify")?.params?.given).toEqual({
      ref: "$only",
    });
    // No step per collection or per kind: «Leer correo» reads in a dozen steps, whatever the collections.
    expect(plan.steps.length).toBe(12);
    // In the order of docs/sistema.md §4.2: Lectora → Decisora → Rellenadora → Buscar relaciones → Crear; then
    // «Plegar hilo» with its days as a setting of its step, and «Aceptar solas».
    expect(plan.steps.map((x) => x.id)).toEqual([
      "m",
      "only",
      "known",
      "inv",
      "r",
      "c",
      "n_f",
      "prefill",
      "n",
      "inv_create",
      "fold",
      "alone",
    ]);
    expect(plan.steps.find((x) => x.id === "fold")).toMatchObject({ args: { days: { lit: 60 } } });
    // A kind that goes elsewhere (a route to a fixed collection) keeps the others walking their own list.
    const routed = mailPlan(targets, {
      guide: true,
      modules: ["tasks", "events"],
      boundModules: true,
      routes: { events: { propose: { collection: "t_tarea" } } },
      fixed: [targets[0] as (typeof targets)[number]],
    }) as { steps: { id: string; tool?: string; each?: unknown }[] };
    expect(
      routed.steps.filter((x) => x.tool === "entities.create").map((x) => [x.id, x.each]),
    ).toEqual([
      ["n_tasks", { ref: "$r.tasks" }],
      ["f_events", { ref: "$r.events" }],
    ]);
    // «Buscar relaciones» still comes before the first «Crear».
    const ids = routed.steps.map((x) => x.id);
    expect(ids.indexOf("prefill")).toBe(ids.indexOf("n_tasks") - 1);
    // With no kind to read (an extension with no reader modules), nothing reads a choice no decider made: a plan
    // that passes the checklist, as before (the independent review of «Haz la B»).
    const none = mailPlan(targets, { guide: true, modules: [], boundModules: true });
    expect(
      checkFlow(store, registry, { trigger: { created: "correo" }, plan: none }, o).problems,
    ).toEqual([]);
    store.close();
  });

  it("«Traer correo» (D-50): its checklist wants «Guardar en Correos» always, its trigger is kept and only its own, and «Probar» brings nothing", async () => {
    const store = withTypes();
    const save = { id: "save", op: "call", tool: "mail.save", args: {} };
    const trigger = { connector: "mail" };
    const check = (steps: unknown[]) =>
      checkFlow(store, registry, { trigger, plan: { version: 1, steps } }, o).problems;
    expect(check([save])).toEqual([]);
    // Without it, with it only on a condition, or once per item: what the connector found would never be brought.
    for (const steps of [
      [{ id: "n", op: "call", tool: "notify", args: { text: { lit: "Hola" } } }],
      [{ ...save, when: { ref: "$x" } }],
    ])
      expect(check(steps)).toContainEqual({ step: null, at: "trigger", code: "fetch-needs-save" });
    // The connector's trigger is well formed alone, and only «Traer correo» has it.
    expect(triggerOk({ connector: "mail" })).toBe(true);
    expect(triggerOk({ connector: "mail", schedule: { every: "hour" } })).toBe(false);
    expect(triggerOk({ connector: "otro" })).toBe(false);
    ensureFlow(
      store,
      {
        id: FETCH_FLOW,
        name: "Traer correo",
        trigger,
        plan: { version: 1, steps: [save] },
        by: "preset",
      },
      1000,
    );
    expect(
      saveUserFlow(
        store,
        FETCH_FLOW,
        { base: 1, plan: { version: 1, steps: [save] }, trigger: { schedule: { every: "hour" } } },
        [],
        2000,
      ),
    ).toEqual({ error: "trigger" });
    const other = createFlow(store, { name: "Otro" }, 3000);
    if (!other) throw new Error("no flow");
    expect(
      saveUserFlow(
        store,
        other.id,
        { base: 1, plan: { version: 1, steps: [] }, trigger },
        [],
        4000,
      ),
    ).toEqual({ error: "trigger" });
    // «Probar»: the piece knows the run is dry, and the host brings nothing.
    const seen: boolean[] = [];
    const piece = registry.all().find((x) => x.name === "mail.save");
    if (!piece) throw new Error("no mail.save");
    const pieces = {
      save: async (dry: boolean) => {
        seen.push(dry);
        return leaf(0, CODE_LABEL);
      },
    };
    await piece.run({ pieces, proposals: () => [], dry: true } as never, {} as never, CODE_LABEL);
    await piece.run({ pieces, proposals: () => [], dry: false } as never, {} as never, CODE_LABEL);
    expect(seen).toEqual([true, false]);
    store.close();
  });

  it("«Revisar la guía» (D-51): its trigger is Juan's decisions, well formed alone, kept, and only its own", () => {
    const store = withTypes();
    const trigger = { learning: "mail" };
    expect(triggerOk(trigger)).toBe(true);
    expect(triggerOk({ learning: "mail", manual: true })).toBe(false);
    expect(triggerOk({ learning: "otro" })).toBe(false);
    const plan = {
      version: 1,
      steps: [{ id: "d", op: "call", tool: "guide.decisions", args: {} }],
    };
    ensureFlow(
      store,
      { id: REVIEW_FLOW, name: "Revisar la guía", trigger, plan, by: "preset" },
      1000,
    );
    expect(
      saveUserFlow(store, REVIEW_FLOW, { base: 1, plan, trigger: { manual: true } }, [], 2000),
    ).toEqual({ error: "trigger" });
    const other = createFlow(store, { name: "Otro" }, 3000);
    if (!other) throw new Error("no flow");
    expect(
      saveUserFlow(
        store,
        other.id,
        { base: 1, plan: { version: 1, steps: [] }, trigger },
        [],
        4000,
      ),
    ).toEqual({ error: "trigger" });
    // «Duplicar» gives a copy that starts by hand: the trigger stays Boni's flow's alone.
    expect(createFlow(store, { name: "Copia", from: REVIEW_FLOW }, 5000)?.trigger).toEqual({
      manual: true,
    });
    // Its checklist wants «Medir releyendo» and «Sugerencia» always; the review's pieces, and «Guardar en Correos»,
    // only in their own flow.
    const call = (id: string, tool: string) => ({ id, op: "call", tool, args: {} });
    const check = (t: unknown, steps: unknown[]) =>
      checkFlow(store, registry, { trigger: t, plan: { version: 1, steps } }, o).problems;
    expect(check(trigger, [call("m", "guide.measure"), call("s", "guide.suggest")])).toEqual([]);
    expect(check(trigger, [call("m", "guide.measure")])).toContainEqual({
      step: null,
      at: "trigger",
      code: "review-needs-steps",
    });
    expect(check({ manual: true }, [call("m", "guide.measure")])).toContainEqual({
      step: "m",
      at: null,
      code: "piece-needs-decisions",
    });
    expect(check({ manual: true }, [call("g", "mail.save")])).toContainEqual({
      step: "g",
      at: null,
      code: "piece-needs-mailbox",
    });
    store.close();
  });

  it("«Aviso del presupuesto» (D-53): its trigger is the month's spending, well formed alone, kept and only its own; it gives the spending and the budget; its checklist wants «Avisar» always; a copy starts by hand", () => {
    const store = withTypes();
    const trigger = BUDGET_TRIGGER;
    expect(trigger).toEqual({ spending: "warn" });
    expect(triggerOk(trigger)).toBe(true);
    expect(triggerOk({ spending: "warn", schedule: { every: "day" } })).toBe(false);
    expect(triggerOk({ spending: "warn", manual: true })).toBe(false);
    expect(triggerOk({ spending: "budget" })).toBe(false);
    // What it gives the plan: the month's spending and the budget, each a text; nothing else is bound.
    expect(triggerNames(trigger)).toEqual(["spent", "budget"]);
    expect(inputsOf(BUDGET_PLAN, trigger)).toEqual([
      { id: "spent", what: "text" },
      { id: "budget", what: "text" },
    ]);
    expect(triggerWords(trigger, () => null)).toBe("El gasto del mes pasa del aviso");
    // Boni's own passes its checklist, and its «Avisar» may take both figures and nothing of a mail.
    const check = (t: unknown, steps: unknown[]) =>
      checkFlow(store, registry, { trigger: t, plan: { version: 1, steps } }, o);
    const boni = check(trigger, BUDGET_PLAN.steps);
    expect(boni.problems).toEqual([]);
    expect(boni.refs.notify).toEqual([
      { ref: "$spent", t: "text" },
      { ref: "$budget", t: "text" },
    ]);
    // Without «Avisar», or with it only on a condition or once per item: the month's run could say nothing.
    const [tell] = BUDGET_PLAN.steps;
    const missing = { step: null, at: "trigger", code: "budget-needs-notice" };
    for (const steps of [
      [],
      [{ id: "q", op: "call", tool: "entities.query", args: { type: { lit: "tarea" } } }],
      [{ ...tell, when: { fn: "eq", args: [{ ref: "$spent" }, { lit: "0.00" }] } }],
      [
        { id: "q", op: "call", tool: "entities.query", args: { type: { lit: "tarea" } } },
        { ...tell, each: { ref: "$q.items" } },
      ],
    ])
      expect(check(trigger, steps).problems).toContainEqual(missing);
    // Another step around it is his to add: the checklist only wants the «Avisar» that always runs.
    expect(
      check(trigger, [
        { id: "r", op: "read", reader: "summarize", input: { ref: "$spent" } },
        tell,
        { id: "again", op: "call", tool: "notify", args: { text: { ref: "$r.text" } } },
      ]).problems,
    ).toEqual([]);
    // A step named like one of its figures is refused, as the run (which always binds both) would refuse it.
    expect(
      check(trigger, [
        { id: "budget", op: "read", reader: "summarize", input: { ref: "$spent" } },
        { ...tell, args: { text: { ref: "$spent" } } },
      ]).problems,
    ).toContainEqual(expect.objectContaining({ step: "budget", code: "bad-id" }));
    // Its figures are its own trigger's: by hand, nothing gives them.
    expect(check({ manual: true }, BUDGET_PLAN.steps).problems).toContainEqual(
      expect.objectContaining({ step: "notify", code: "ref-to-unknown-step" }),
    );
    // The trigger is kept, and no other flow may have it.
    ensureFlow(
      store,
      { id: BUDGET_FLOW, name: "Aviso del presupuesto", trigger, plan: BUDGET_PLAN, by: "preset" },
      1000,
    );
    for (const other of [{ manual: true }, { schedule: { every: "day", at: "08:00" } }])
      expect(
        saveUserFlow(store, BUDGET_FLOW, { base: 1, plan: BUDGET_PLAN, trigger: other }, [], 2000),
      ).toEqual({ error: "trigger" });
    const other = createFlow(store, { name: "Otro" }, 3000);
    if (!other) throw new Error("no flow");
    expect(
      saveUserFlow(
        store,
        other.id,
        { base: 1, plan: { version: 1, steps: [] }, trigger },
        [],
        4000,
      ),
    ).toEqual({ error: "trigger" });
    // His own version of it keeps the trigger and stays as it was, on or off.
    const mine = {
      version: 1,
      steps: [{ ...tell, args: { text: { lit: "Ojo con el gasto en IA" } } }],
    };
    store.journal.setFlowEnabled(BUDGET_FLOW, false);
    const saved = saveUserFlow(store, BUDGET_FLOW, { base: 1, plan: mine }, [], 5000);
    expect("flow" in saved && saved.flow).toMatchObject({
      version: 2,
      by: "user",
      trigger,
      enabled: false,
    });
    // Boni keeps his version (what runs is what he saved) until «Volver al de Boni».
    expect(
      ensureFlow(
        store,
        {
          id: BUDGET_FLOW,
          name: "Aviso del presupuesto",
          trigger,
          plan: BUDGET_PLAN,
          by: "preset",
        },
        6000,
      ),
    ).toMatchObject({ version: 2, by: "user" });
    expect(revertFlow(store, BUDGET_FLOW, { preset: true }, 7000)).toMatchObject({
      version: 3,
      by: "preset",
      plan: BUDGET_PLAN,
      enabled: false,
    });
    // «Duplicar» gives a copy that starts by hand, off: the trigger stays Boni's flow's alone.
    expect(createFlow(store, { name: "Copia", from: BUDGET_FLOW }, 8000)).toMatchObject({
      trigger: { manual: true },
      enabled: false,
      by: "user",
    });
    store.close();
  });

  it("«Plegar hilo» looks back the days its step says (its setting, task 83), 60 when it says none or a wrong one", async () => {
    const seen: (number | undefined)[] = [];
    const pieces = {
      fold: (_mail: string, _again: boolean, _made: readonly string[], days?: number) => {
        seen.push(days);
        return leaf(0, CODE_LABEL);
      },
    };
    const fold = registry.all().find((x) => x.name === "inbox.fold");
    if (!fold) throw new Error("no fold");
    const c = { pieces, proposals: () => ["p1"] } as never;
    await fold.run(
      c,
      { mail: leaf("e_1", CODE_LABEL), days: leaf(7, CODE_LABEL) } as never,
      CODE_LABEL,
    );
    await fold.run(c, { mail: leaf("e_1", CODE_LABEL) } as never, CODE_LABEL);
    expect(seen).toEqual([7, undefined]);
    // The code keeps it within a year and a day, whatever the step says.
    expect([7, 0, 400, 2.5].map(foldDays)).toEqual([7, 60, 60, 60]);
    expect(foldDays("7")).toBe(60);
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
