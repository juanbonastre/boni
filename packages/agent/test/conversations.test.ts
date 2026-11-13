import { afterEach, describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/agent.ts";
import {
  createConversation,
  deleteConversation,
  listConversations,
  markCorrected,
  turnOfRun,
  turnViews,
  updateConversation,
} from "../src/conversations.ts";
import { fakePlanner, type ModelProvider } from "../src/providers.ts";
import { codeLabel, leaf, rec } from "../src/values.ts";
import { type Env, JUAN, makeEnv, PERSONAL } from "./fixture.ts";

/**
 * Juan's conversations with Boni (docs/conversacion.md 3.1 and 3.5): every turn kept in its conversation, the history
 * read back by a new agent as after a restart, each turn live while it runs, «Parar» at any point, and the planner
 * chosen for a conversation. Invented data only.
 */
let env: Env;
afterEach(() => env?.close());

const lit = (v: string | number | boolean | null) => ({ lit: v });
const ref = (r: string) => ({ ref: r });
const COUNT = {
  version: 1,
  steps: [
    {
      id: "n",
      op: "call",
      tool: "entities.aggregate",
      args: { type: lit("tarea"), op: lit("count") },
    },
    {
      id: "r",
      op: "reply",
      component: "number",
      data: { value: ref("$n"), caption: lit("tareas") },
    },
  ],
};
const ASK = {
  version: 1,
  steps: [
    { id: "q", op: "ask", control: "text", prompt: lit("¿Título?") },
    {
      id: "c",
      op: "call",
      tool: "entities.create",
      args: { type: lit("tarea"), values: { fn: "obj", args: [lit("titulo"), ref("$q")] } },
    },
  ],
};
const now = () => Date.UTC(2026, 9, 31, 10);

describe("a conversation with Boni", () => {
  it("keeps every turn, gets its title from the first one, and a new agent reads its history (a restart)", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const first = await env
      .agent(fakePlanner([COUNT]))
      .turn({ text: "¿cuántas tareas tengo?", origin: PERSONAL, conversation: c });
    expect(first.status).toBe("done");
    expect(first.changed).toBe(false); // it only read: nothing to undo
    expect(listConversations(env.store)).toMatchObject([
      { id: c, title: "¿cuántas tareas tengo?" },
    ]);

    const later = fakePlanner([COUNT]);
    await env.agent(later).turn({ text: "¿y ahora?", origin: PERSONAL, conversation: c });
    const input = later.requests[0]?.input as {
      history: { request: string; replies: unknown[] }[];
    };
    expect(input.history.map((h) => h.request)).toEqual(["¿cuántas tareas tengo?"]);
    expect(input.history[0]?.replies).toHaveLength(1);

    const turns = turnViews(env.store, c);
    expect(turns.map((t) => [t.request, t.status])).toEqual([
      ["¿cuántas tareas tengo?", "done"],
      ["¿y ahora?", "done"],
    ]);
    expect(turns[0]?.replies[0]?.data.value).toMatchObject({ t: "v", value: 1 });
    expect(turns.map((t) => t.changed)).toEqual([false, false]);
  });

  it("offers «Deshacer» only while its run has a change left to undo", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(fakePlanner([ASK]));
    const asked = await a.turn({ text: "apunta algo", origin: PERSONAL, conversation: c });
    expect(asked.changed).toBe(false);
    if (asked.pending?.kind !== "ask") throw new Error("expected a question");
    const done = await a.answer(asked.run, asked.pending.id, { text: "Llamar a la gestoría" });
    expect(done).toMatchObject({ status: "done", changed: true });
    expect(turnViews(env.store, c).at(-1)?.changed).toBe(true);
    a.undoRun(done.run);
    expect(turnViews(env.store, c).at(-1)?.changed).toBe(false);
  });

  it("shows itself live: its run, the planner thinking, each step, each reply and how it ended", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const seen: LiveEvent[] = [];
    const r = await env.agent(fakePlanner([COUNT])).turn({
      text: "¿cuántas tareas tengo?",
      origin: PERSONAL,
      conversation: c,
      live: (e) => seen.push(e),
    });
    expect(seen.map((e) => (e.type === "step" ? `step:${e.state}` : e.type))).toEqual([
      "start",
      "planning",
      "planned",
      "step:start",
      "step:done",
      "reply",
      "end",
    ]);
    expect(seen[0]).toEqual({ type: "start", run: r.run });
    expect(seen[3]).toMatchObject({
      op: "call",
      what: expect.any(String),
      words: { tool: "entities.aggregate", args: { type: "tarea", op: "count" } },
    });
    expect(seen[4]).toMatchObject({ state: "done", value: 1 });
  });

  it("says each step in Juan's words: the collection, the record and the field by their names, and what it found", async () => {
    env = makeEnv();
    const seen: LiveEvent[] = [];
    await env
      .agent(
        fakePlanner([
          {
            version: 1,
            steps: [
              {
                id: "q",
                op: "call",
                tool: "entities.query",
                args: { type: lit("tarea"), field: lit("titulo"), contains: lit("pan") },
              },
              { id: "g", op: "call", tool: "entities.get", args: { id: ref("$q.items[0].id") } },
              {
                id: "e",
                each: ref("$q"),
                op: "call",
                tool: "entities.get",
                args: { id: ref("$item.id") },
              },
              {
                id: "c",
                op: "call",
                tool: "entities.create",
                args: {
                  type: lit("tarea"),
                  values: { fn: "obj", args: [lit("titulo"), lit("Llamar al fontanero")] },
                },
              },
            ],
          },
        ]),
      )
      .turn({ text: "busca el pan", origin: PERSONAL, live: (e) => seen.push(e) });
    const steps = seen.flatMap((e) => (e.type === "step" ? [e] : []));
    const at = (id: string, state: "start" | "done") =>
      steps.find((s) => s.id === id && s.state === state);
    // With its definition's icon, which the step shows (task 95).
    expect(at("q", "start")?.words).toEqual({
      tool: "entities.query",
      args: { type: "tarea", field: "titulo", contains: "pan" },
      icon: "ListFilter",
    });
    expect(at("q", "done")?.n).toBe(1);
    expect(at("g", "start")?.words?.args).toEqual({ id: "Comprar pan" });
    // An item still to come is left out: the app says the tool's name instead.
    expect(at("e", "start")?.words?.args).toEqual({});
    expect(at("e", "done")?.n).toBe(1);
    expect(at("c", "start")?.words?.args).toEqual({ type: "tarea", title: "Llamar al fontanero" });
  });

  it("stops when Juan says: while it plans (the call is cut), between steps, or while it waits", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    // A planner that only answers when it is cut.
    const slow: ModelProvider = {
      id: "lento",
      privacy: "local",
      complete: (_req, o) =>
        new Promise((_ok, fail) =>
          o?.signal?.addEventListener("abort", () =>
            fail(Object.assign(new Error("aborted"), { code: "aborted" })),
          ),
        ),
    };
    const a = env.agent(slow);
    let run = "";
    const going = a.turn({
      text: "algo largo",
      origin: PERSONAL,
      conversation: c,
      live: (e) => {
        if (e.type === "start") run = e.run;
        if (e.type === "planning") queueMicrotask(() => a.stop(run));
      },
    });
    expect(await going).toMatchObject({ status: "stopped", error: "stopped-by-juan" });

    // Between steps: the first ends, then «Parar».
    const b = env.agent(fakePlanner([COUNT]));
    let run2 = "";
    const r = await b.turn({
      text: "¿cuántas tareas tengo?",
      origin: PERSONAL,
      conversation: c,
      live: (e) => {
        if (e.type === "step" && e.state === "done") b.stop(run2);
        if (e.type === "start") run2 = e.run;
      },
    });
    expect(r).toMatchObject({ status: "stopped", error: "stopped-by-juan", replies: [] });

    // Waiting on a question: it ends there, and its turn says so.
    const w = env.agent(fakePlanner([ASK]));
    const asked = await w.turn({ text: "apunta algo", origin: PERSONAL, conversation: c });
    expect(asked.status).toBe("waiting");
    expect(turnViews(env.store, c).at(-1)).toMatchObject({
      status: "waiting",
      pending: { kind: "ask" },
    });
    expect(w.stop(asked.run)).toMatchObject({ status: "stopped", error: "stopped-by-juan" });
    expect(turnViews(env.store, c).at(-1)).toMatchObject({ status: "stopped", pending: null });
  });

  it("plans with the model chosen for it, and goes to the trash whole", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const account = fakePlanner([COUNT]);
    const chosen = fakePlanner([COUNT]);
    await env
      .agent(account)
      .turn({ text: "¿cuántas tareas tengo?", origin: PERSONAL, conversation: c, planner: chosen });
    expect([account.requests.length, chosen.requests.length]).toEqual([0, 1]);
    expect(deleteConversation(env.store, c)).toBe(true);
    expect(listConversations(env.store)).toEqual([]);
    expect(turnViews(env.store, c)).toEqual([]);
  });
});

/** A choice among Juan's tasks, and a reply with the one chosen (§3.4, rule 2). */
const PICK = {
  version: 1,
  steps: [
    { id: "l", op: "call", tool: "entities.query", args: { type: lit("tarea") } },
    { id: "q", op: "ask", control: "choice", prompt: lit("¿Cuál?"), options: ref("$l.items") },
    {
      id: "r",
      op: "reply",
      component: "text",
      data: { template: lit("Elegida: {a}"), a: ref("$q.titulo") },
    },
  ],
};

describe("a card with a free way out (§3.4, C3)", () => {
  it("«Otra cosa…»: the question ends as text with its options, and the next turn's planner reads it", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(fakePlanner([PICK]));
    const asked = await a.turn({ text: "marca una tarea", origin: PERSONAL, conversation: c });
    if (asked.pending?.kind !== "ask") throw new Error("expected a question");
    const out = await a.answer(asked.run, asked.pending.id, { words: "ninguna, una nueva" });
    expect(out).toMatchObject({ status: "stopped", error: "answered-in-words", pending: null });
    expect(out.replies.at(-1)?.component).toBe("asked");
    expect(turnViews(env.store, c).at(-1)).toMatchObject({ status: "stopped", pending: null });

    const next = fakePlanner([COUNT]);
    await env.agent(next).turn({ text: "ninguna, una nueva", origin: PERSONAL, conversation: c });
    const input = next.requests[0]?.input as {
      history: {
        request: string;
        replies: { component: string; data: Record<string, unknown> }[];
      }[];
    };
    const asking = input.history.at(-1)?.replies.find((r) => r.component === "asked");
    expect(JSON.stringify(asking?.data)).toContain("¿Cuál?");
    expect(JSON.stringify(asking?.data)).toContain("Comprar pan");
  });

  it("«Nueva…»: a row Juan made in the options' collection is his answer; one of another is refused", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(fakePlanner([PICK]));
    const asked = await a.turn({ text: "marca una tarea", origin: PERSONAL, conversation: c });
    if (asked.pending?.kind !== "ask") throw new Error("expected a question");
    const wrong = await a.answer(asked.run, asked.pending.id, { record: env.ids.ana as string });
    expect(wrong).toMatchObject({ status: "waiting", error: "wrong-answer" });
    const made = env.store.create(
      "t_tarea",
      { f_titulo: { value: "Llamar a la gestoría", label: JUAN } },
      { actor: "user", device: "movil-ejemplo" },
    ).entity.id;
    const done = await a.answer(asked.run, asked.pending.id, { record: made });
    expect(done.error).toBeNull();
    expect(done.status).toBe("done");
    expect(done.replies.map((r) => r.component)).toEqual(["asked", "text"]);
    expect(JSON.stringify(done.replies[1]?.data)).toContain("Llamar a la gestoría");
  });

  it("a question of background work keeps its options: no words, no new row", async () => {
    env = makeEnv();
    const a = env.agent(fakePlanner([]));
    const asked = await a.background(PICK);
    if (asked.pending?.kind !== "ask") throw new Error("expected a question");
    const words = await a.answer(
      asked.run,
      asked.pending.id,
      { words: "otra" },
      { trust: "personal" },
    );
    expect(words.error).toBe("wrong-answer");
    const row = await a.answer(
      asked.run,
      asked.pending.id,
      { record: env.ids.tarea1 as string },
      { trust: "personal" },
    );
    expect(row.error).toBe("wrong-answer");
  });
});

/** A question of a kind, and a reply with its answer: what Juan answered reaches the rest of the plan. */
const asking = (control: string, extra: Record<string, unknown> = {}, answer = ref("$q")) => ({
  version: 1,
  steps: [
    { id: "q", op: "ask", control, prompt: lit("¿Y bien?"), ...extra },
    {
      id: "r",
      op: "reply",
      component: "text",
      data: { template: lit("Respuesta: {a}"), a: answer },
    },
  ],
});
/** A rehearsal before a task is made (§3.4, «Lo que haría»). */
const REHEARSE = {
  version: 1,
  steps: [
    { id: "q", op: "ask", control: "rehearsal", prompt: lit("¿Lo guardo?") },
    {
      id: "c",
      op: "call",
      tool: "entities.create",
      args: {
        type: lit("tarea"),
        values: { fn: "obj", args: [lit("titulo"), lit("Llamar a la gestoría")] },
      },
    },
    { id: "r", op: "reply", component: "text", data: { template: lit("Hecho") } },
  ],
};
const AREA = {
  id: "f_area",
  key: "area",
  name: "area",
  type: "select" as const,
  label: JUAN,
  options: [
    { id: "o_casa", name: "Casa", label: JUAN },
    { id: "o_trabajo", name: "Trabajo", label: JUAN },
  ],
};
const asked = async (a: ReturnType<Env["agent"]>, c: string, text = "pregúntame") => {
  const r = await a.turn({ text, origin: PERSONAL, conversation: c });
  if (r.pending?.kind !== "ask") throw new Error(`expected a question, got ${r.error}`);
  return { run: r.run, ask: r.pending.id, pending: r.pending };
};
const said = (r: { replies: { component: string; data: unknown }[] }) =>
  JSON.stringify(r.replies.find((x) => x.component === "text")?.data);

describe("every kind of question has its answer (§3.4, C3)", () => {
  it("several: the ones he ticks, «Ninguna» as none, and a row he made with «Nueva…»", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const plan = asking("several", { options: ref("$l.items") });
    const several = { ...plan, steps: [PICK.steps[0], ...plan.steps] };
    const a = env.agent(fakePlanner([several, several, several]));
    const one = await asked(a, c);
    expect(one.pending).toMatchObject({ control: "several" });
    expect((await a.answer(one.run, one.ask, { choice: 0 })).error).toBe("wrong-answer");
    expect((await a.answer(one.run, one.ask, { choices: [7] })).error).toBe("wrong-answer");
    const done = await a.answer(one.run, one.ask, { choices: [0, 0] });
    expect(done.status).toBe("done");
    expect(said(done)).toContain("Comprar pan");

    const none = await asked(a, c);
    expect((await a.answer(none.run, none.ask, { choices: [] })).status).toBe("done");

    const more = await asked(a, c);
    const made = env.store.create(
      "t_tarea",
      { f_titulo: { value: "Regar las plantas", label: JUAN } },
      { actor: "user", device: "movil-ejemplo" },
    ).entity.id;
    const both = await a.answer(more.run, more.ask, { choices: [0], records: [made] });
    expect(both.status).toBe("done");
    expect(said(both)).toContain("Comprar pan");
    expect(said(both)).toContain("Regar las plantas");
  });

  it("a number, a date and yes or no: each takes its own kind and «Otra cosa…» where it has one", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(
      fakePlanner([asking("number"), asking("date"), asking("yesno"), asking("number")]),
    );
    const n = await asked(a, c);
    expect((await a.answer(n.run, n.ask, { text: "doce" })).error).toBe("wrong-answer");
    expect((await a.answer(n.run, n.ask, { number: Number.POSITIVE_INFINITY })).error).toBe(
      "wrong-answer",
    );
    const twelve = await a.answer(n.run, n.ask, { number: 12.5 });
    expect(twelve.status).toBe("done");
    expect(said(twelve)).toContain("12.5");

    const d = await asked(a, c);
    expect((await a.answer(d.run, d.ask, { date: "2026-02-30" })).error).toBe("wrong-answer");
    const day = await a.answer(d.run, d.ask, { date: "2026-11-20" });
    expect(said(day)).toContain("2026-11-20");

    const y = await asked(a, c);
    // Yes or no has no other answer: there is nothing to write instead.
    expect((await a.answer(y.run, y.ask, { words: "quizá" })).error).toBe("wrong-answer");
    expect((await a.answer(y.run, y.ask, { yes: false })).status).toBe("done");

    const out = await asked(a, c);
    const words = await a.answer(out.run, out.ask, { words: "no lo sé aún" });
    expect(words).toMatchObject({ status: "stopped", error: "answered-in-words" });
  });

  it("a property's options: what he picks or makes with «Nueva…» is read from the schema, never taken as typed", async () => {
    env = makeEnv();
    env.store.applySchema(
      { op: "add_field", type: "t_tarea", field: AREA },
      { actor: "user", device: "movil-ejemplo" },
    );
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(
      fakePlanner([
        asking("choice", { field: lit("tarea.area") }),
        asking("choice", {
          field: lit("tarea.area"),
          options: { fn: "list", args: [lit("Viaje")] },
        }),
        asking("choice", { field: lit("tarea.nada") }),
      ]),
    );
    const q = await asked(a, c);
    expect(q.pending).toMatchObject({
      control: "choice",
      field: { type: "t_tarea", field: "f_area", names: ["Casa", "Trabajo"] },
    });
    expect(JSON.stringify((q.pending as { options: unknown }).options)).toContain("Trabajo");
    expect((await a.answer(q.run, q.ask, { option: "Ocio" })).error).toBe("wrong-answer");
    // «Nueva…»: the option is added by Juan's change of the property, then it is his answer. The card he saw is the
    // same: a name added since does not make it «Ha cambiado».
    env.store.applySchema(
      {
        op: "set_options",
        type: "t_tarea",
        field: "f_area",
        options: [...AREA.options, { id: "o_ocio", name: "Ocio", label: JUAN }],
      },
      { actor: "user", device: "movil-ejemplo" },
    );
    const done = await a.answer(
      q.run,
      q.ask,
      { option: "Ocio" },
      undefined,
      undefined,
      q.pending.seen,
    );
    expect(done.error).toBeNull();
    expect(said(done)).toContain("Ocio");

    // What the planner suggests must be options of it; a property that is not a select is refused.
    const viaje = await a.turn({ text: "otra", origin: PERSONAL, conversation: c });
    expect(viaje).toMatchObject({ status: "stopped", error: "ask-bad-options" });
    const bad = await a.turn({ text: "otra más", origin: PERSONAL, conversation: c });
    expect(bad).toMatchObject({ status: "stopped", error: "ask-bad-field" });
  });

  it("a file: the one he uploaded, as the conversation's files are seen; one that is not his file is refused", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const file = rec(
      { id: leaf("e_archivo", codeLabel("file")), name: leaf("factura.pdf", JUAN) },
      JUAN,
    );
    const a = env.agent(fakePlanner([asking("file", {}, ref("$q.name"))]), undefined, {
      fileOf: (row) => (row === "e_archivo" ? file : null),
    });
    const q = await asked(a, c);
    expect((await a.answer(q.run, q.ask, { file: "e_otro" })).error).toBe("wrong-answer");
    const done = await a.answer(q.run, q.ask, { file: "e_archivo" });
    expect(done.status).toBe("done");
    expect(said(done)).toContain("factura.pdf");
  });

  it("a rehearsal: what it would write, and «Guardar» writes it; «Ahora no» writes nothing; with nothing to write, no card", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const titles = () => env.store.list("t_tarea").map((s) => s.entity.values.f_titulo);
    const nothing = {
      version: 1,
      steps: [
        { id: "q", op: "ask", control: "rehearsal", prompt: lit("¿Lo guardo?") },
        { id: "r", op: "reply", component: "text", data: { template: lit("Nada") } },
      ],
    };
    const a = env.agent(fakePlanner([REHEARSE, REHEARSE, nothing]));
    const q = await asked(a, c);
    const would = (q.pending as { would?: { decision: string; view: unknown }[] }).would ?? [];
    expect(would).toHaveLength(1);
    expect(JSON.stringify(would[0]?.view)).toContain("Llamar a la gestoría");
    // Rehearsed, nothing is written.
    expect(titles()).toEqual(["Comprar pan"]);
    expect((await a.answer(q.run, q.ask, { yes: true })).error).toBe("wrong-answer");
    const saved = await a.answer(q.run, q.ask, { save: true });
    expect(saved.status).toBe("done");
    expect(titles().sort()).toEqual(["Comprar pan", "Llamar a la gestoría"]);

    const no = await asked(a, c);
    const notNow = await a.answer(no.run, no.ask, { save: false });
    expect(notNow).toMatchObject({ status: "stopped", error: "not-saved" });
    expect(titles()).toHaveLength(2);

    const none = await a.turn({ text: "nada", origin: PERSONAL, conversation: c });
    expect(none.pending).toBeNull();
    expect(none.status).toBe("done");
  });

  it("a rehearsal says what will still ask, and after «Guardar» it asks: the confirmation is not skipped", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const plan = {
      version: 1,
      steps: [
        { id: "a", op: "call", tool: "entities.get", args: { id: lit("e_ana") } },
        ...REHEARSE.steps.slice(0, 2),
        {
          id: "m",
          op: "call",
          tool: "mail.send",
          args: {
            to: { ref: "$a.email" },
            subject: { quote: "te llamo mañana" },
            body: { quote: "te llamo mañana" },
          },
        },
        REHEARSE.steps[2],
      ],
    };
    const a = env.agent(fakePlanner([plan]));
    const q = await asked(a, c, "apunta llamar a la gestoría y escribe a Ana: te llamo mañana");
    const would = (q.pending as { would?: { decision: string }[] }).would ?? [];
    expect(would.map((w) => w.decision)).toEqual(["allow", "confirm"]);
    const saved = await a.answer(q.run, q.ask, { save: true });
    // What it wrote is written; the mail waits for his yes on its own card.
    expect(env.store.list("t_tarea").map((s) => s.entity.values.f_titulo)).toContain(
      "Llamar a la gestoría",
    );
    expect(saved.status).toBe("waiting");
    expect(saved.pending).toMatchObject({ kind: "confirm", view: { tool: "mail.send" } });
    expect(env.sent).toEqual([]);
  });

  it("an old card is checked again first (rule 3a): changed since, nothing is answered and it comes back fresh", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(fakePlanner([PICK]));
    const q = await asked(a, c);
    env.store.update(
      env.ids.tarea1 as string,
      { f_titulo: { value: "Comprar pan integral", label: JUAN } },
      { actor: "user", device: "movil-ejemplo" },
    );
    const changed = await a.answer(q.run, q.ask, { choice: 0 });
    expect(changed).toMatchObject({ status: "waiting", error: "changed" });
    if (changed.pending?.kind !== "ask") throw new Error("expected the card again");
    expect(changed.pending.seen).not.toBe(q.pending.seen);
    expect(JSON.stringify(changed.pending.options)).toContain("Comprar pan integral");
    // A device that still shows the old card is told so too, before anything is answered.
    const stale = await a.answer(q.run, q.ask, { choice: 0 }, undefined, undefined, q.pending.seen);
    expect(stale.error).toBe("changed");
    const done = await a.answer(
      q.run,
      q.ask,
      { choice: 0 },
      undefined,
      undefined,
      changed.pending.seen,
    );
    expect(done.status).toBe("done");
    expect(said(done)).toContain("Comprar pan integral");
  });

  it("background work asks only what its Bandeja card can answer: choose one or words", async () => {
    env = makeEnv();
    const a = env.agent(fakePlanner([]));
    for (const control of ["number", "several", "file", "rehearsal"]) {
      const r = await a.background(
        asking(control, control === "several" ? { options: { fn: "list", args: [lit("a")] } } : {}),
      );
      expect(r, control).toMatchObject({ status: "stopped", error: "ask-only-in-a-turn" });
    }
  });
});

describe("a message corrected by editing it (§3.1, C1)", () => {
  it("undoes what its turn wrote through the log, takes its proposals out of the Bandeja, and keeps it marked", async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(fakePlanner([ASK]));
    const asked = await a.turn({ text: "apunta algo", origin: PERSONAL, conversation: c });
    if (asked.pending?.kind !== "ask") throw new Error("expected a question");
    const done = await a.answer(asked.run, asked.pending.id, { text: "Llamar a la gestora" });
    expect(done.changed).toBe(true);
    env.store.journal.addProposal({
      id: "p_ejemplo",
      run: done.run,
      tool: "entities.create",
      args: { values: {}, origins: [] },
      view: { tool: "entities.create", title: "Crear", rows: [], marks: [] } as never,
      sources: [],
      created: now(),
    });
    const titles = () =>
      env.store
        .list("t_tarea")
        .map((s) => s.entity.values.f_titulo)
        .sort();
    expect(titles()).toEqual(["Comprar pan", "Llamar a la gestora"]);

    expect(a.correct(done.run)).toBe(2); // its row and its proposal
    expect(titles()).toEqual(["Comprar pan"]);
    expect(env.store.journal.proposal("p_ejemplo")?.status).toBe("stale");
    const turn = turnOfRun(env.store, c, done.run);
    if (!turn) throw new Error("expected its turn");
    expect(turn.corrected).toBe(false);
    markCorrected(env.store, turn.id);
    expect(turnOfRun(env.store, c, done.run)?.corrected).toBe(true);

    const redo = await env.agent(fakePlanner([COUNT])).turn({
      text: "apunta: llamar a la gestoría",
      origin: PERSONAL,
      conversation: c,
      corrects: done.run,
    });
    const views = turnViews(env.store, c);
    expect(views.map((t) => [t.request, t.corrected, t.corrects])).toEqual([
      ["apunta algo", true, null],
      ["apunta: llamar a la gestoría", false, done.run],
    ]);
    expect(redo.status).toBe("done");
  });

  it('stops with nothing done when a later change of Juan\'s is in the way ("cannot-undo"), and a run still waiting ends', async () => {
    env = makeEnv();
    const c = createConversation(env.store, { now: now() });
    const a = env.agent(fakePlanner([ASK, ASK]));
    const asked = await a.turn({ text: "apunta algo", origin: PERSONAL, conversation: c });
    if (asked.pending?.kind !== "ask") throw new Error("expected a question");
    const done = await a.answer(asked.run, asked.pending.id, { text: "Llamar a la gestora" });
    const row = env.store
      .list("t_tarea")
      .find((s) => s.entity.values.f_titulo === "Llamar a la gestora");
    if (!row) throw new Error("expected its row");
    env.store.update(
      row.entity.id,
      { f_titulo: { value: "Llamar a la gestora el lunes", label: JUAN } },
      { actor: "user", device: "movil-ejemplo" },
    );
    expect(a.correct(done.run)).toBe("cannot-undo");
    expect(env.store.get(row.entity.id)?.entity.deleted).toBeUndefined();

    const waits = await a.turn({ text: "apunta otra", origin: PERSONAL, conversation: c });
    expect(waits.status).toBe("waiting");
    expect(a.correct(waits.run)).toBe(0);
    expect(turnViews(env.store, c).at(-1)).toMatchObject({ status: "stopped", pending: null });
  });
});

describe("pinned conversations (task 63, point 7)", () => {
  it("stay on top of the list, from the store (so after a restart and on every device)", () => {
    env = makeEnv();
    const old = createConversation(env.store, { now: now() - 86_400_000 });
    const recent = createConversation(env.store, { now: now() });
    updateConversation(env.store, old, { title: "Viaje a Lisboa" });
    updateConversation(env.store, recent, { title: "Recetas" });
    expect(listConversations(env.store).map((x) => x.id)).toEqual([recent, old]);
    expect(updateConversation(env.store, old, { pinned: true })).toBe(true);
    expect(listConversations(env.store).map((x) => [x.id, x.pinned])).toEqual([
      [old, true],
      [recent, false],
    ]);
    updateConversation(env.store, old, { pinned: false });
    expect(listConversations(env.store).map((x) => x.id)).toEqual([recent, old]);
  });
});
