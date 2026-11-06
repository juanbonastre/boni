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
    // The reader's answer belongs to the read step, as text.
    expect(d?.steps[1]?.answers).toEqual(['{"items":[{"title":"Revisar actas"}]}']);
    expect(d?.steps[0]?.answers).toEqual([]);
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
    expect(d?.proposals).toEqual([{ title: "Revisar actas", status: "pending", type: "t_tarea" }]);
    // A reading from before flows: the mail its plan read first started it.
    expect(d?.input).toEqual({
      id: expect.any(String),
      title: "Actas de FUP 1",
      collection: "Correos",
      type: "t_correo",
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
    expect(traceOf(store, "r1")?.proposals.at(-1)).toEqual({
      title: "Actas",
      status: "accepted",
      type: "t_correo",
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
});
