import { label } from "@boni/entities";
import { openUserStore } from "@boni/store";
import { describe, expect, it } from "vitest";
import { traceOf } from "./trace.ts";

const own = label("user", "personal", [{ kind: "user-edit", id: "portatil" }]);

describe("a run's trace from the journal and the audit (task 52)", () => {
  it("each step with its decision, its sources and what the models said; what it read, changed, proposed and decided", () => {
    const store = openUserStore(":memory:");
    store.applySchema(
      {
        op: "create_type",
        type: {
          id: "t_correo",
          key: "correo",
          name: "Correos",
          fields: [{ id: "f_asunto", key: "asunto", name: "Asunto", type: "text", label: own }],
          titleField: "f_asunto",
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        },
      },
      { actor: "user" },
    );
    store.applySchema(
      {
        op: "create_type",
        type: {
          id: "t_tarea",
          key: "tarea",
          name: "Tareas",
          fields: [{ id: "f_titulo", key: "titulo", name: "Título", type: "text", label: own }],
          titleField: "f_titulo",
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        },
      },
      { actor: "user" },
    );
    const mail = store.create(
      "t_correo",
      { f_asunto: { value: "Actas de FUP 1", label: own } },
      { actor: "agent" },
    );
    const j = store.journal;
    const plan = {
      version: 1,
      steps: [
        { id: "m", op: "call", tool: "entities.get", args: { id: { lit: mail.entity.id } } },
        { id: "r", op: "read", reader: "extract_tasks", input: { ref: "$m.body" } },
        {
          id: "n0",
          op: "call",
          tool: "entities.create",
          each: { ref: "$r.all" },
          args: {
            type: { lit: "tarea" },
            values: { fn: "obj", args: [{ lit: "title" }, { ref: "$item.title" }] },
          },
        },
      ],
    };
    j.startRun({ id: "r1", turn: null, origin: "background", device: null, started: 1000 });
    j.setPlan("r1", plan);
    j.step({
      run: "r1",
      step: "m",
      kind: "call",
      decision: "allow",
      rule: "P1",
      detail: null,
      at: 1100,
    });
    j.modelCall({
      run: "r1",
      role: "reader",
      provider: "fake",
      model: "m-ejemplo",
      promptHash: "h",
      request: { input: "…" },
      response: { items: [{ title: "Revisar actas" }] },
      usage: { input: 900, output: 40, cost: 0.002 },
      at: 1200,
    });
    j.step({
      run: "r1",
      step: "r",
      kind: "read",
      decision: "allow",
      rule: null,
      detail: null,
      at: 1300,
    });
    j.step({
      run: "r1",
      step: "n0",
      kind: "call",
      decision: "propose",
      rule: "P4",
      detail: null,
      at: 1400,
    });
    j.addProposal({
      id: "p1",
      run: "r1",
      tool: "entities.create",
      // As the agent stores them: each argument a labelled value (the collection by its key).
      args: { values: { type: { t: "v", value: "tarea" } }, origins: [] },
      view: {
        tool: "entities.create",
        title: "Crear",
        rows: [{ arg: "values.title", value: "Revisar actas" }],
      },
      sources: ["mail:x@example.com"],
      created: 1400,
    });
    j.addDecision({
      id: "d1",
      run: "r1",
      area: "fill",
      cost: "A",
      p: 0.8,
      outcome: "do",
      detail: { field: "estado" },
      at: 1350,
    });
    store.audit.record({
      at: 1150,
      by: "model:reader:fake",
      run: "r1",
      tool: "entities.get",
      target: { id: mail.entity.id },
      decision: "allow",
      result: null,
      seen: [
        {
          entity: mail.entity.id,
          type: "t_correo",
          version: 1,
          fields: ["f_asunto"],
          shapes: [],
          body: "text",
          files: [],
        },
      ],
    });
    const made = store.create(
      "t_tarea",
      { f_titulo: { value: "Revisar actas", label: own } },
      { actor: "agent", run: "r1" },
    );
    j.finishRun("r1", "done", plan, 1500);

    const d = traceOf(store, "r1");
    expect(d).toMatchObject({
      id: "r1",
      status: "done",
      origin: "background",
      started: 1000,
      finished: 1500,
      request: null,
    });
    expect(d?.steps.map((s) => [s.id, s.what, s.decision, s.rule, s.deps])).toEqual([
      ["m", "entities.get", "allow", "P1", []],
      ["r", "extract_tasks", "allow", null, ["m"]],
      ["n0", "entities.create", "propose", "P4", ["r"]],
    ]);
    // The reader's answer belongs to the read step, as text and as it was answered (what it gave the next step),
    // with its calls and their cost in this run (task 91).
    expect(d?.steps[1]?.answers).toEqual(['{"items":[{"title":"Revisar actas"}]}']);
    expect(d?.steps[1]).toMatchObject({
      calls: 1,
      cost: 0.002,
      output: { items: [{ title: "Revisar actas" }] },
    });
    expect(d?.steps[0]).toMatchObject({ answers: [], calls: 0, cost: 0, output: null });
    // Each collection by its name and its id: the map draws the way the run went (docs/sistema.md §4.4).
    expect(d?.read).toEqual([
      { collection: "Correos", type: "t_correo", titles: ["Actas de FUP 1"], n: 1 },
    ]);
    expect(d?.changes).toEqual([
      {
        action: "create",
        title: "Revisar actas",
        collection: "Tareas",
        type: "t_tarea",
        undone: false,
      },
    ]);
    expect(made.entity.id).toBeTruthy();
    // Each proposal as the Bandeja showed it, by the step that made it (the only one that proposed, for one made
    // before proposals kept their step).
    expect(d?.proposals).toEqual([
      {
        id: "p1",
        title: "Revisar actas",
        status: "pending",
        type: "t_tarea",
        created: 1400,
        decided: null,
        rows: [{ name: "title", value: "Revisar actas" }],
        step: "n0",
        record: null,
      },
    ]);
    // A reading from before flows: the mail its plan read first started it.
    expect(d?.input).toEqual({
      id: expect.any(String),
      title: "Actas de FUP 1",
      collection: "Correos",
      type: "t_correo",
      fields: [],
    });
    // Moved to another collection as it was accepted: it says where it went, not where it was proposed.
    j.addProposal({
      id: "p2",
      run: "r1",
      tool: "entities.create",
      args: { values: { type: { t: "v", value: "tarea" } }, origins: [] },
      view: {
        tool: "entities.create",
        title: "Crear",
        rows: [{ arg: "values.title", value: "Actas" }],
      },
      sources: [],
      created: 1450,
    });
    j.setProposal("p2", "accepted", 1460, { type: { from: "tarea", to: "correo" } });
    // Its «Aceptar»: a run of its own that keeps it and made the record (task 91: the collection's panel shows it).
    j.startRun({
      id: "r_acepta",
      turn: null,
      origin: "accepted",
      device: null,
      started: 1460,
      proposal: "p2",
    });
    const kept = store.create(
      "t_correo",
      { f_asunto: { value: "Actas", label: own } },
      { actor: "agent", run: "r_acepta" },
    );
    expect(traceOf(store, "r1")?.proposals.at(-1)).toMatchObject({
      id: "p2",
      title: "Actas",
      status: "accepted",
      type: "t_correo",
      decided: 1460,
      record: { id: kept.entity.id, title: "Actas", collection: "Correos", fields: [] },
    });
    expect(d?.decisions).toEqual([{ area: "fill", p: 0.8, outcome: "do", result: null }]);
    expect(d?.models).toEqual([
      {
        role: "reader",
        provider: "fake",
        model: "m-ejemplo",
        input: 900,
        output: 40,
        cost: 0.002,
        at: 1200,
      },
    ]);
    expect(traceOf(store, "nada")).toBeNull();
    store.close();
  });

  it("what a step gave the next one: kept with it, or worked out from its answer for an older run; each «Aceptar» its own record (task 91)", () => {
    const store = openUserStore(":memory:");
    store.applySchema(
      {
        op: "create_type",
        type: {
          id: "t_tarea",
          key: "tarea",
          name: "Tareas",
          fields: [{ id: "f_titulo", key: "titulo", name: "Título", type: "text", label: own }],
          titleField: "f_titulo",
          sensitivity: "personal",
          schemaVersion: 1,
          label: own,
        },
      },
      { actor: "user" },
    );
    const j = store.journal;
    const plan = {
      version: 1,
      steps: [
        { id: "r", op: "read", reader: "read_message", input: { ref: "$text" } },
        { id: "c", op: "read", reader: "classify", input: { ref: "$text" } },
        { id: "f", op: "read", reader: "fill", input: { ref: "$item" } },
        { id: "k", op: "read", reader: "summarize", input: { ref: "$text" } },
      ],
    };
    j.startRun({ id: "r2", turn: null, origin: "background", device: null, started: 1000 });
    j.setPlan("r2", plan);
    const call = (step: string, response: unknown, at: number, request: unknown = {}) =>
      j.modelCall({
        run: "r2",
        role: "reader",
        provider: "fake",
        model: "m",
        promptHash: "h",
        request,
        response,
        usage: { input: 1, output: 1, cost: 0.001 },
        at,
        step,
      });
    // The raw answers of a run from before steps kept what they gave on: the reading's items for anyone, the
    // decider's two answers, the fields by their codes.
    call(
      "r",
      {
        items: [
          {
            kind: "task",
            actor: "recipient",
            title: "Preparar la reunión",
            due: "2026-10-23",
            quote: "…",
          },
          { kind: "task", actor: "sender", title: "Lo que hará el remitente" },
          { kind: "event", actor: "recipient", title: "Reunión", start: "2026-10-23T10:00:00Z" },
        ],
      },
      1100,
    );
    call(
      "c",
      { c: { type: "choice", choice: "Gestiones", confidence: 0.9 }, r: { choice: "Gestiones" } },
      1200,
    );
    call("f", { values: { f0: "Pendiente", f1: null }, note: "Para el jueves" }, 1300, {
      input: { fields: [{ name: "Estado" }, { name: "Área" }] },
    });
    call("k", { text: "Un resumen" }, 1400);
    for (const [step, at] of [
      ["r", 1150],
      ["c", 1250],
      ["f", 1350],
    ] as const)
      j.step({ run: "r2", step, kind: "read", decision: "allow", rule: "P1", detail: null, at });
    // One kept with its step (since 2026-11-06): that, not the answer.
    j.step({
      run: "r2",
      step: "k",
      kind: "read",
      decision: "allow",
      rule: "P1",
      detail: { reader: "summarize", out: { text: "Lo que dio al siguiente" } },
      at: 1450,
    });
    // Two proposals accepted in the same second by «Solo», before runs kept their proposal: each its own record.
    for (const [id, title, at] of [
      ["p1", "Primera", 1500],
      ["p2", "Segunda", 1700],
    ] as const) {
      j.addProposal({
        id,
        run: "r2",
        tool: "entities.create",
        args: { values: { type: { t: "v", value: "tarea" } }, origins: [] },
        view: {
          tool: "entities.create",
          title: "Crear",
          rows: [{ arg: "values.title", value: title }],
        },
        sources: [],
        created: 1400,
      });
      j.startRun({ id: `a_${id}`, turn: null, origin: "accepted", device: null, started: at });
      store.create(
        "t_tarea",
        { f_titulo: { value: title, label: own } },
        { actor: "agent", run: `a_${id}` },
      );
      j.setProposal(id, "accepted", at + 100);
    }
    j.finishRun("r2", "done", plan, 1800);
    const d = traceOf(store, "r2");
    const out = Object.fromEntries((d?.steps ?? []).map((x) => [x.id, x.output]));
    expect(out.r).toEqual({
      tasks: [{ title: "Preparar la reunión", due: "2026-10-23" }],
      events: [{ title: "Reunión", start: "2026-10-23T10:00:00Z" }],
    });
    expect(out.c).toEqual({ choice: "Gestiones" });
    expect(out.f).toEqual({ values: { Estado: "Pendiente" }, note: "Para el jueves" });
    expect(out.k).toEqual({ text: "Lo que dio al siguiente" });
    expect(d?.proposals.map((p) => [p.id, p.record?.title])).toEqual([
      ["p1", "Primera"],
      ["p2", "Segunda"],
    ]);
    store.close();
  });
});
