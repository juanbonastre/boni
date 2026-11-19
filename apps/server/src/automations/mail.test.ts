// Mail as an automation (docs/automatizaciones.md §5.17, phase F16): «Leer correo» is its own document, what it
// saves is decided by a cell, each thing it proposes is its own card, the «Decisora»'s doubt is a «Preguntar», the
// day's cap sits at the trigger, and the conversion of the mail settings loses nothing (AU-249 to AU-255).
//
// Invented mails (`ejemplo.*@example.*`) and scripted readers, never a real mailbox or a model: the server's real
// port (`boniPortFor`, `serverAi`) over a real store, the readers answering from a script.

import { type ModelRequest, ScriptedProvider } from "@boni/agent";
import {
  ANSWER_FIELD,
  ASK_TYPE,
  type Automation,
  BONI_DOUBT,
  type BoniCall,
  type Cell,
  CHOSEN,
  CREATE_CHOSEN,
  EXAMPLE_SOURCE,
  FORMAT,
  type PieceRead,
  type PieceReply,
  type PolicyCall,
  type Row,
} from "@boni/automations";
import { join, label } from "@boni/entities";
import { clock, under } from "@boni/pace";
import type { ProposalRow, UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { MAIL_FLOW } from "../flows.ts";
import { seed, typeId } from "../seed.test-util.ts";
import { pieceRequest, wireAutomationModels } from "./ai.ts";
import { BONI_AUTHOR, wireBoni } from "./boni.ts";
import { convertBoniFlows, followBoniFlow } from "./convert.ts";
import {
  DOUBT_WAIT_DAYS,
  drawReadMail,
  NONE_OPTION,
  type ReadMailConfig,
} from "./mailAutomation.ts";
import { MAIL_CAP, mailCapLeft, mailCapOf } from "./mailCap.ts";
import {
  knownSender,
  type MailHooks,
  mailLabel,
  PENDING_TITLES,
  pendingTitles,
  runMailPiece,
} from "./mailPieces.ts";
import { automationPolicy, consentIn } from "./policy.ts";
import type { RunProposalView } from "./proposal.ts";
import { publish } from "./publish.ts";
import { folder, HAND, JUAN, NOW, ok, ZONE } from "./run.test-util.ts";
import { answerAsk, runBoni } from "./runs.ts";
import { automationLabel, keepDraft, publishedOf } from "./service.ts";
import { askCardId } from "./waits.ts";

/** A mail's text, as the trigger labels it: from outside (invented). */
const MAIL = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);

const f = folder("correo");
afterEach(() => {
  wireBoni(null);
  wireAutomationModels(null);
});

const CORREO = typeId("correo");
const KNOWN = "ejemplo.conocido@example.com";
const OTHER = "ejemplo.otro@example.com";
/** His own words, as a step's panel carries them. */
const MINE = label("user", "personal", []);

/** A store with a mail collection and the two it proposes into, shaped like his (generated ids, his keys). */
function mailStore(): UserStore {
  const s = f.store();
  seed(
    s,
    [
      {
        key: "correo",
        name: "Correos",
        folder: "correos/",
        fields: {
          asunto: "text",
          de: "text",
          de_nombre: "text",
          responder_a: "text",
          hilo: "text",
          texto: "text",
          evento_uid: "text",
          evento_titulo: "text",
          evento_dia: "text",
        },
      },
      { key: "tarea", name: "Tareas", folder: "tareas/", fields: { dia: "date" } },
      {
        key: "evento",
        name: "Eventos",
        folder: "eventos/",
        fields: { dia: "date", hora: "time", fin: "time" },
      },
    ],
    {},
  );
  return s;
}

/** One mail as the connector keeps it (mail.ts `keep`): every value the sender's, from outside. */
function mail(
  s: UserStore,
  o: {
    from: string;
    subject: string;
    text?: string;
    name?: string;
    replyTo?: string;
    thread?: string;
    invite?: { uid: string; title: string; day: string };
  },
): string {
  const l = label("external", "personal", [{ kind: "mail", id: o.from }], true);
  const w = (value: unknown) => ({ value, label: l });
  const values: Record<string, { value: unknown; label: typeof l }> = {
    f_title: w(o.subject),
    f_asunto: w(o.subject),
    f_de: w(o.from),
    f_texto: w(o.text ?? ""),
  };
  if (o.name) values.f_de_nombre = w(o.name);
  if (o.replyTo) values.f_responder_a = w(o.replyTo);
  if (o.thread) values.f_hilo = w(o.thread);
  if (o.invite) {
    values.f_evento_uid = w(o.invite.uid);
    values.f_evento_titulo = w(o.invite.title);
    values.f_evento_dia = w(o.invite.day);
  }
  return s.create(CORREO, values as never, { actor: "connector" }).entity.id;
}

/** The mail's code as the pieces get it (mail.ts `hooksFor`), over the test's store. */
function hooksOf(s: UserStore, o: { calendar?: Set<string> } = {}): MailHooks {
  return {
    type: CORREO,
    mailbox: "ejemplo.juan@example.com",
    text: (v) => `De: ${v.f_de}\nAsunto: ${v.f_asunto}\n\n${v.f_texto ?? ""}`,
    userIn: () => "to",
    inCalendar: async (uid) => o.calendar?.has(uid) ?? false,
    relations: () => ({}),
    target: (k) =>
      k === "tarea"
        ? { date: "dia", time: null, endTime: null, fill: [] }
        : k === "evento"
          ? { date: "dia", time: "hora", endTime: "fin", fill: [] }
          : null,
    threadMails: (m) => {
      const h = s.get(m)?.entity.values.f_hilo;
      return new Set(
        s
          .list(CORREO)
          .filter((x) => x.entity.id !== m && !!h && x.entity.values.f_hilo === h)
          .map((x) => x.entity.id),
      );
    },
    mailOfProposal: () => "",
  };
}

/** A row as the engine hands it: from a trigger, nothing decided its way. */
const row = (json: Record<string, Cell>, l: Row["label"]): Row => ({
  json,
  label: l,
  path: null,
  parent: null,
});

/** The trigger's row of a mail (mail.ts `mailRow`). */
function rowOf(s: UserStore, id: string): Row {
  const e = s.get(id);
  if (!e) throw new Error("no mail");
  return row({ id, subject: String(e.entity.values.f_asunto) }, mailLabel(e));
}

/** One unit of a piece, as the engine hands it to the port. */
function piece(
  type: string,
  row: Row | null,
  o: {
    values?: Record<string, Cell>;
    read?: (r: PieceRead) => Promise<PieceReply>;
    startedBy?: BoniCall["startedBy"];
  } = {},
): BoniCall {
  return {
    automation: MAIL_FLOW,
    step: "s_pieza",
    type,
    name: type,
    values: Object.fromEntries(
      Object.entries(o.values ?? {}).map(([k, value]) => [
        k,
        { value, label: MINE, derived: false },
      ]),
    ),
    args: {},
    row,
    test: false,
    startedBy: o.startedBy ?? "schedule",
    ...(o.read ? { read: o.read } : {}),
  };
}

/** A reading's answer: one thing for the recipient per item. */
const reading = (
  items: { kind: "task" | "event"; title: string; due?: string | null; start?: string }[],
) => ({
  items: items.map((i) => ({
    kind: i.kind,
    actor: "recipient",
    title: i.title,
    due: i.due ?? null,
    quote: "",
    ...(i.start ? { start: i.start } : {}),
  })),
});

/** A pending (or decided) proposal of the old engine to create in `collection`, from a mail of `sender`. */
function proposal(
  s: UserStore,
  o: {
    id: string;
    sender: string;
    collection: string;
    title: string;
    status?: ProposalRow["status"];
    edits?: boolean;
    sources?: string[];
    at?: number;
  },
) {
  s.journal.startRun({
    id: `r_${o.id}`,
    turn: null,
    origin: "background",
    device: null,
    started: o.at ?? NOW,
  });
  s.journal.addProposal({
    id: o.id,
    run: `r_${o.id}`,
    tool: "entities.create",
    args: { values: {}, origins: [] },
    view: {
      tool: "entities.create",
      title: "Crear",
      rows: [
        { arg: "type", role: "type", value: o.collection, detail: o.collection },
        { arg: "values.title", value: o.title },
      ],
    },
    sources: o.sources ?? ["code:mail", `mail:${o.sender}`],
    created: o.at ?? NOW,
  });
  if (o.status && o.status !== "pending")
    s.journal.setProposal(
      o.id,
      o.status,
      (o.at ?? NOW) + 1,
      o.edits ? { values: { title: { from: o.title, to: `${o.title} (corregido)` } } } : null,
    );
}

/** Three of his acceptances, as proposed, of what `sender` sent for `collection`: «conocido» (`wouldAccept`). */
function knownFor(s: UserStore, sender: string, collection: string) {
  for (let i = 0; i < 3; i++)
    proposal(s, {
      id: `p_${sender}_${collection}_${i}`,
      sender,
      collection,
      title: `Cosa ${i}`,
      status: "accepted",
      at: NOW - (10 - i) * 86_400_000,
    });
}

const CONFIG: ReadMailConfig = {
  id: MAIL_FLOW,
  name: "Leer correo",
  collections: [
    { key: "tarea", name: "Tareas" },
    { key: "evento", name: "Eventos" },
  ],
  rules: [
    { sender: "@boletin.example.com", do: "skip", collection: null },
    { sender: "ejemplo.agenda@example.org", do: "collection", collection: "evento" },
    // A rule into a collection that is not his any more is left out.
    { sender: "ejemplo.viejo@example.org", do: "collection", collection: "borrada" },
  ],
  instructions: "Las fechas de entrega son tareas.",
  examples: [{ mail: "Hola, ¿nos vemos el jueves a las 10?", want: '[{"kind":"event"}]' }],
  modules: ["tasks", "events"],
  days: 60,
};

/**
 * The server wired as main.ts does, with scripted models: the reader answers `read(req)`, the decision model
 * `decide(req)` (none: «Modelos» has no decision model). Returns the providers, which keep every request.
 */
function wired(
  s: UserStore,
  o: {
    read?: (req: ModelRequest) => unknown;
    decide?: ((req: ModelRequest) => unknown) | null;
    calendar?: Set<string>;
  } = {},
) {
  const hooks = hooksOf(s, o.calendar ? { calendar: o.calendar } : {});
  wireBoni({
    reaches: () => true,
    agentOf: () => {
      throw new Error("no plan of before runs a piece");
    },
    mail: () => hooks,
    mailRow: (st, id) => (id ? rowOf(st, id) : null),
  });
  const reader = new ScriptedProvider("ejemplo:lectora", (req) => o.read?.(req) ?? reading([]));
  const decider =
    o.decide === null
      ? null
      : new ScriptedProvider(
          "ejemplo:decisora",
          (req) => o.decide?.(req) ?? { c: { choice: "tarea", confidence: 0.9 } },
        );
  wireAutomationModels({
    models: {
      stepProvider: (_a, kind) =>
        kind === "decision"
          ? decider
            ? { provider: decider, model: decider.id, tag: null }
            : { refused: "no-model" }
          : { provider: reader, model: reader.id, tag: null },
      overBudget: () => false,
      resolveModel: () => ({ refused: "no-model" }),
      offered: () => false,
    },
    accountOf: () => 1,
  });
  return { hooks, reader, decider };
}

/** «Leer correo» as Boni's code had it before (a preset flow version), converted as mail.ts does (AU-254). */
function converted(s: UserStore, config: ReadMailConfig = CONFIG, by = "preset") {
  s.journal.saveFlow({
    id: MAIL_FLOW,
    name: "Leer correo",
    trigger: { kind: "mail" },
    inputs: [{ id: "text" }],
    plan: { version: 1, steps: [] },
    layout: null,
    by,
    enabled: true,
    created: NOW - 30 * 86_400_000,
  });
  return convertBoniFlows(
    s,
    [{ id: MAIL_FLOW, boni: "readMail", draw: () => drawReadMail(config) }],
    NOW,
  );
}

/** One mail read by the published «Leer correo», as mail.ts `proposeByAutomation` starts it. */
async function read(s: UserStore, id: string, startedBy: BoniCall["startedBy"] = "schedule") {
  const row = rowOf(s, id);
  const r = await runBoni(s, MAIL_FLOW, { trigger: "trigger", fields: row.json }, { row }, ZONE, {
    startedBy,
  });
  if (!("id" in r)) throw new Error(`not run: ${JSON.stringify(r)}`);
  const kept = s.journal.automationRun(r.id);
  const p = kept?.proposal ? s.journal.proposal(kept.proposal) : null;
  return {
    run: r,
    proposal: p,
    asked: (p?.view as Partial<RunProposalView> | undefined)?.run?.first ?? [],
  };
}

/** The titles of a collection's rows. */
const titles = (s: UserStore, key: string) =>
  s.list(typeId(key)).map((e) => e.entity.values.f_title);

describe("mail as an automation (§5.17)", () => {
  it("AU-249 · «Leer correo» runs from its document alone: nothing regenerates it, a step gets only the trigger's row and its own panel, and an example that quotes a mail stays labelled as from outside", async () => {
    const s = mailStore();
    try {
      const { reader, decider } = wired(s, {
        read: () => reading([{ kind: "task", title: "Enviar el informe", due: "2026-11-20" }]),
      });
      expect(converted(s)).toEqual([
        expect.objectContaining({ id: MAIL_FLOW, state: "converted" }),
      ]);
      const running = publishedOf(s, MAIL_FLOW);
      expect(s.journal.automation(MAIL_FLOW)?.by).toBe(BONI_AUTHOR);
      expect(running?.automation.steps.map((x) => x.type)).toEqual([
        "boni.mail",
        "boni.mailRule",
        "boni.mailInvitation",
        "boni.mailReader",
        "boni.fold",
        "boni.mailDecider",
        ASK_TYPE,
        "boni.mailFiller",
        "boni.mailRelations",
        CREATE_CHOSEN,
      ]);
      // The rules, the guide's words and its examples are the panels' (a rule into a collection gone is left out).
      const step = (t: string) => running?.automation.steps.find((x) => x.type === t);
      expect(step("boni.mailRule")?.params.rules).toEqual([
        { sender: "@boletin.example.com", do: "skip" },
        { sender: "ejemplo.agenda@example.org", do: "collection", collection: "evento" },
      ]);
      expect(step("boni.mailReader")?.params).toMatchObject({
        instructions: CONFIG.instructions,
        examples: CONFIG.examples,
      });

      const id = mail(s, {
        from: OTHER,
        subject: "Informe trimestral",
        text: "Mándame el informe el viernes.",
      });
      const r = await read(s, id);
      expect(r.run.state).not.toBe("failed");
      // What it proposes is the reader's thing, in the collection the decider chose, with its day: from outside.
      expect(r.asked).toEqual([
        expect.objectContaining({
          collection: "tarea",
          action: "create",
          values: expect.objectContaining({
            title: expect.objectContaining({ value: "Enviar el informe", outside: true }),
            dia: expect.objectContaining({ value: "2026-11-20", outside: true }),
          }),
        }),
      ]);
      // The reader got the mail and nothing else: the trigger's row's mail between markers, beside its panel.
      const [req] = reader.requests as [ModelRequest];
      const input = req.input as Record<string, unknown> & {
        marker: string;
        content: string;
        guide: { examples: { marker: string; mail: string }[] };
      };
      expect(Object.keys(input).sort()).toEqual(
        ["content", "guide", "marker", "today", "user_in", "weekday"].sort(),
      );
      expect(input.content.startsWith(`<<${input.marker}>>`)).toBe(true);
      expect(input.content).toContain("Mándame el informe el viernes.");
      // The example quotes a mail: between its own markers, as from outside.
      const ex = input.guide.examples[0] as { marker: string; mail: string };
      expect(ex.mail).toBe(`<<${ex.marker}>>\n${CONFIG.examples[0]?.mail}\n<<${ex.marker}>>`);
      // The decider read twice, the options in both orders.
      expect(
        decider?.requests.map((q) =>
          Object.keys((q.input as { questions: { c: { criteria: object } } }).questions.c.criteria),
        ),
      ).toEqual([
        ["tarea", "evento"],
        ["evento", "tarea"],
      ]);

      // Nothing regenerates it: another conversion, a new version of Boni's code and a new configuration change
      // nothing of what runs.
      const hash = running?.hash;
      expect(converted(s, { ...CONFIG, instructions: "Otra cosa." })).toEqual([
        { id: MAIL_FLOW, state: "already" },
      ]);
      expect(
        followBoniFlow(
          s,
          { id: MAIL_FLOW, boni: "readMail", draw: () => drawReadMail(CONFIG) },
          NOW,
        ),
      ).toBe("not");
      expect(publishedOf(s, MAIL_FLOW)?.hash).toBe(hash);
    } finally {
      s.close();
    }
  });

  it("AU-249 · the pieces over the row: «No leer» drops a mail unless his hand started the run, a rule's collection goes to the «Decisora», and an invitation is a row of its own unless a calendar of his holds it", async () => {
    const s = mailStore();
    try {
      const hooks = hooksOf(s, { calendar: new Set(["uid-ya@example.com"]) });
      const rules: Cell = [
        { sender: "@boletin.example.com", do: "skip" },
        { sender: "ejemplo.agenda@example.org", do: "collection", collection: "evento" },
      ];
      const news = mail(s, { from: "ejemplo.noticias@boletin.example.com", subject: "Boletín" });
      const skip = await runMailPiece(
        s,
        hooks,
        piece("boni.mailRule", rowOf(s, news), { values: { rules } }),
        undefined,
      );
      expect(skip).toMatchObject({ rows: [] });
      const asked = await runMailPiece(
        s,
        hooks,
        piece("boni.mailRule", rowOf(s, news), { values: { rules }, startedBy: "user" }),
        undefined,
      );
      expect(asked).toMatchObject({ rows: [{ json: { id: news } }] });
      const agenda = mail(s, { from: "ejemplo.agenda@example.org", subject: "Agenda" });
      expect(
        await runMailPiece(
          s,
          hooks,
          piece("boni.mailRule", rowOf(s, agenda), { values: { rules } }),
          undefined,
        ),
      ).toMatchObject({ rows: [{ json: { id: agenda, rule: "evento" } }] });

      const inv = mail(s, {
        from: OTHER,
        subject: "Invitación",
        invite: { uid: "uid-nuevo@example.com", title: "Reunión de equipo", day: "2026-11-25" },
      });
      const got = await runMailPiece(
        s,
        hooks,
        piece("boni.mailInvitation", rowOf(s, inv)),
        undefined,
      );
      expect(got).toMatchObject({
        rows: [
          { json: { id: inv } },
          {
            json: {
              id: inv,
              kind: "events",
              invitation: true,
              title: "Reunión de equipo",
              due: "2026-11-25",
            },
          },
        ],
      });
      const held = mail(s, {
        from: OTHER,
        subject: "Invitación ya puesta",
        invite: { uid: "uid-ya@example.com", title: "Reunión ya puesta", day: "2026-11-25" },
      });
      expect(
        (await runMailPiece(s, hooks, piece("boni.mailInvitation", rowOf(s, held)), undefined)) as {
          rows: unknown[];
        },
      ).toMatchObject({ rows: [{ json: { id: held } }] });
      // A row that names no mail of the mail collection is no mail.
      await expect(
        runMailPiece(s, hooks, piece("boni.mailRule", row({ id: "e_otro" }, MAIL)), undefined),
      ).rejects.toThrow();
    } finally {
      s.close();
    }
  });

  it("AU-249 · «Plegar hilo» drops what the thread already proposed the same and gives a changed one its «Antes», withdrawing no card", async () => {
    const s = mailStore();
    try {
      const hooks: MailHooks = {
        ...hooksOf(s),
        mailOfProposal: (p) => (p.id === "p_antes" ? first : ""),
      };
      const first = mail(s, { from: OTHER, subject: "Cena", thread: "hilo-1" });
      const second = mail(s, { from: OTHER, subject: "Re: Cena", thread: "hilo-1" });
      s.journal.startRun({
        id: "r_antes",
        turn: null,
        origin: "background",
        device: null,
        started: NOW,
      });
      s.journal.addProposal({
        id: "p_antes",
        run: "r_antes",
        tool: "entities.create",
        args: { values: {}, origins: [] },
        view: {
          rows: [
            { arg: "type", value: "evento" },
            { arg: "values.title", value: "Cena con el equipo" },
            { arg: "values.due", value: "2026-11-27" },
          ],
        },
        sources: [`mail:${OTHER}`],
        created: NOW - 1000,
      });
      const fold = (json: Record<string, Cell>) =>
        runMailPiece(
          s,
          hooks,
          piece("boni.fold", row({ id: second, ...json }, rowOf(s, second).label), {
            values: { days: 60 },
          }),
          undefined,
        );
      expect(
        await fold({ kind: "events", title: "Cena con el equipo", due: "2026-11-27" }),
      ).toMatchObject({ rows: [] });
      expect(
        await fold({ kind: "events", title: "Cena con el equipo", due: "2026-11-28" }),
      ).toMatchObject({
        rows: [{ json: { title: "Cena con el equipo", before: { proposal: "p_antes" } } }],
      });
      expect(await fold({ kind: "tasks", title: "Comprar el regalo", due: null })).toMatchObject({
        rows: [{ json: { title: "Comprar el regalo" } }],
      });
      expect(s.journal.proposal("p_antes")?.status).toBe("pending");
    } finally {
      s.close();
    }
  });

  it("AU-250 · what «Crear en la elegida» creates goes through its cell: born «Preguntar» in every collection, saved with a «Sí» of his hand, and with «Solo conocidos» a thing from a sender not yet known is still proposed", () => {
    // The server's half (P28): the «Sí» of each collection is read from the version as stored, never from the call.
    // The engine's half (the cell proposes, «Solo conocidos» narrows, nothing is born «Sí») is boni-steps.test.ts's.
    const doc = {
      format: FORMAT,
      id: "a_leer",
      version: 4,
      name: "Leer correo",
      steps: [
        {
          id: "s_crear",
          name: "Crear en la elegida",
          type: CREATE_CHOSEN,
          params: { onlyKnown: true },
          connections: [
            {
              collection: "t_eventos",
              read: false,
              create: { mode: "yes" },
              update: false,
              remove: false,
            },
            {
              collection: "t_tareas",
              read: false,
              create: { mode: "ask" },
              update: false,
              remove: false,
            },
          ],
        },
      ],
      arrows: [],
      settings: {},
    } as unknown as Automation;
    const call = (over: Partial<PolicyCall> = {}): PolicyCall => ({
      automation: { id: "a_leer", version: 4 },
      step: "s_crear",
      type: CREATE_CHOSEN,
      action: "create",
      effect: "write",
      destroys: false,
      collection: "t_eventos",
      values: { f_titulo: { value: "Reunión del jueves", label: MAIL, derived: true } },
      control: null,
      test: false,
      ...over,
    });
    const yes = consentIn(doc);
    expect(yes(call())).toBe(true);
    // «Preguntar», a collection with no cell, another version, a call that claims a «Sí»: none is one.
    expect(yes(call({ collection: "t_tareas" }))).toBe(false);
    expect(yes(call({ collection: "t_notas" }))).toBe(false);
    expect(yes(call({ automation: { id: "a_leer", version: 5 } }))).toBe(false);
    const own = automationLabel("a_leer");
    // What came by mail is saved with his «Sí», and proposed without it.
    expect(automationPolicy(doc, own).decide(call()).kind).toBe("allow");
    expect(automationPolicy(doc, own).decide(call({ collection: "t_tareas" })).kind).toBe(
      "propose",
    );
    const claimed = { ...call({ collection: "t_tareas" }), yes: true } as PolicyCall;
    expect(automationPolicy(doc, own).decide(claimed).kind).toBe("propose");
    // A draft's «Sí» is no «Sí»: the policy of the stored version (without it) proposes.
    const stored = {
      ...doc,
      steps: doc.steps.map((s) => ({
        ...s,
        connections: s.connections?.map((c) => ({ ...c, create: { mode: "ask" as const } })),
      })),
    };
    expect(automationPolicy(stored, own).decide(call()).kind).toBe("propose");
  });

  it("AU-250 · a mail cannot make its own sender «conocido»: only his decisions on that sender and collection do, so a display name, a Reply-To, a text or a field a reader set that claims a known sender stays unknown, and its «Sí» is proposed", async () => {
    const s = mailStore();
    try {
      knownFor(s, KNOWN, "tarea");
      const { hooks } = wired(s, {
        read: () => reading([{ kind: "task", title: "Revisar el contrato", due: "2026-11-21" }]),
      });
      const real = mail(s, { from: KNOWN, subject: "Contrato" });
      const spoof = mail(s, {
        from: OTHER,
        subject: `De parte de ${KNOWN}`,
        name: KNOWN,
        replyTo: KNOWN,
        text: `Soy ${KNOWN}, ya me conoces.`,
      });
      expect(knownSender(s, hooks, rowOf(s, real), "tarea")).toBe(true);
      // Known for one collection is not known for another.
      expect(knownSender(s, hooks, rowOf(s, real), "evento")).toBe(false);
      expect(knownSender(s, hooks, rowOf(s, spoof), "tarea")).toBe(false);
      // A field set on the row (by a reader, or anything after the trigger) is not where the sender is read.
      const forged = row(
        { ...rowOf(s, spoof).json, from: KNOWN, de: KNOWN },
        rowOf(s, spoof).label,
      );
      expect(knownSender(s, hooks, forged, "tarea")).toBe(false);
      // A row that names the known one's mail but carries another sender's source is no known one's.
      expect(knownSender(s, hooks, row({ id: real }, rowOf(s, spoof).label), "tarea")).toBe(false);
      // The «Ejemplos» of the reader's panel carry their own outside source, which names no sender: it neither makes
      // one known nor stops one; joined with another sender's source it still is no known one's.
      const example = label("external", "personal", [EXAMPLE_SOURCE], true);
      expect(
        knownSender(s, hooks, row({ id: real }, join(rowOf(s, real).label, example)), "tarea"),
      ).toBe(true);
      expect(knownSender(s, hooks, row({ id: real }, example), "tarea")).toBe(false);
      expect(
        knownSender(s, hooks, row({ id: real }, join(rowOf(s, spoof).label, example)), "tarea"),
      ).toBe(false);
      // A stored mail whose source and «De» disagree, or no port: nobody is known.
      const odd = s.create(
        CORREO,
        {
          f_asunto: {
            value: "Raro",
            label: label("external", "personal", [{ kind: "mail", id: KNOWN }], true),
          },
          f_de: {
            value: OTHER,
            label: label("external", "personal", [{ kind: "mail", id: KNOWN }], true),
          },
        } as never,
        { actor: "connector" },
      ).entity.id;
      expect(knownSender(s, hooks, rowOf(s, odd), "tarea")).toBe(false);
      expect(knownSender(s, null, rowOf(s, real), "tarea")).toBe(false);
      // What the model answers never counts: decisions that were Boni's alone, or corrected, do not make one known.
      knownFor(s, OTHER, "evento");
      s.journal.setProposal(`p_${OTHER}_evento_2`, "accepted", NOW, {
        values: { title: { from: "Cosa 2", to: "Otra cosa" } },
      });
      expect(knownSender(s, hooks, rowOf(s, spoof), "evento")).toBe(false);

      // Over the whole run: with his «Sí» on «Tareas» and «Solo conocidos» on, the known sender's thing is saved and
      // the one who claims to be him is asked.
      converted(s, { ...CONFIG, collections: [{ key: "tarea", name: "Tareas" }] });
      const doc = publishedOf(s, MAIL_FLOW)?.automation as Automation;
      const withYes = {
        ...doc,
        steps: doc.steps.map((x) =>
          x.type === CREATE_CHOSEN
            ? {
                ...x,
                connections: x.connections?.map((c) => ({
                  ...c,
                  create: { mode: "yes" as const },
                })),
              }
            : x,
        ),
      };
      const { rev } = ok(keepDraft(s, MAIL_FLOW, withYes, HAND));
      ok(publish(s, MAIL_FLOW, { rev }, JUAN));
      const a = await read(s, real);
      expect(a.proposal).toBeNull();
      expect(titles(s, "tarea")).toEqual(["Revisar el contrato"]);
      const b = await read(s, spoof);
      expect(b.asked).toEqual([expect.objectContaining({ collection: "tarea", action: "create" })]);
      expect(titles(s, "tarea")).toEqual(["Revisar el contrato"]);
    } finally {
      s.close();
    }
  });

  it.todo(
    "AU-251 · a run that only asks to create five rows or fewer is one card per row: accepting one saves that row and leaves the others waiting, a corrected one counts as a miss, and a failed run withdraws no earlier card of the thread",
  );

  it("AU-252 · a row the «Decisora» is unsure of leaves by «Duda» to a «Preguntar»: the run waits, the answer goes on to the chosen collection, and «Ninguna» or an expired question creates nothing", async () => {
    const s = mailStore();
    try {
      // The two orders disagree: unsure.
      wired(s, {
        read: () =>
          reading([{ kind: "task", title: "Preparar la presentación", due: "2026-11-24" }]),
        decide: (req) => {
          const keys = Object.keys(
            (req.input as { questions: { c: { criteria: object } } }).questions.c.criteria,
          );
          return { c: { choice: keys[0], confidence: 0.9 } };
        },
      });
      converted(s);
      const ask = publishedOf(s, MAIL_FLOW)?.automation.steps.find((x) => x.type === ASK_TYPE);
      expect(ask?.params).toEqual({
        question: { expr: "¿Dónde va «{{ $json.title }}»?" },
        answer: "one",
        options: ["Tareas", "Eventos", NONE_OPTION],
        via: ["inbox"],
        waitDays: DOUBT_WAIT_DAYS,
        mode: "perRow",
      });
      // Nothing leaves «Preguntar» but by his answer: no arrow from its «sin respuesta».
      const arrows = publishedOf(s, MAIL_FLOW)?.automation.arrows ?? [];
      expect(arrows.filter((x) => x.from.step === ask?.id).map((x) => x.from.output)).toEqual([
        "main",
      ]);

      const one = mail(s, { from: OTHER, subject: "Presentación" });
      const a = await read(s, one);
      expect(a.run.state).toBe("waiting");
      const card = askCardId(a.run.id, ask?.id as string, 0);
      expect(s.journal.request(card)?.status).toBe("pending");
      // «Tareas»: it goes on to the «Rellenadora» and proposes in that collection.
      expect(answerAsk(s, card, { choice: 0 }, JUAN)).toEqual({ run: a.run.id });
      await new Promise((r) => setTimeout(r, 50));
      const after = s.journal.automationRun(a.run.id);
      const p = after?.proposal ? s.journal.proposal(after.proposal) : null;
      expect((p?.view as RunProposalView | undefined)?.run.first).toEqual([
        expect.objectContaining({
          collection: "tarea",
          values: expect.objectContaining({
            title: expect.objectContaining({ value: "Preparar la presentación" }),
          }),
        }),
      ]);
      // «Ninguna»: nothing is created nor proposed.
      const two = mail(s, { from: OTHER, subject: "Presentación otra" });
      const b = await read(s, two);
      const card2 = askCardId(b.run.id, ask?.id as string, 0);
      expect(answerAsk(s, card2, { choice: 2 }, JUAN)).toEqual({ run: b.run.id });
      await new Promise((r) => setTimeout(r, 50));
      expect(s.journal.automationRun(b.run.id)?.proposal ?? null).toBeNull();
      expect(titles(s, "tarea")).toEqual([]);
    } finally {
      s.close();
    }
  });

  it("AU-252 · the «Decisora» chooses only when both orders agree and its calibrated confidence reaches 0.6; a rule's or a lone collection needs no model, and with no decision model it doubts", async () => {
    const s = mailStore();
    try {
      const hooks = hooksOf(s);
      const id = mail(s, { from: OTHER, subject: "Algo" });
      const thing = (json: Record<string, Cell> = {}): Row =>
        row({ id, kind: "tasks", title: "Llamar al proveedor", ...json }, rowOf(s, id).label);
      const collections = [{ collection: "tarea" }, { collection: "evento" }];
      const decide = (
        answers: (o: string[]) => PieceReply,
        json?: Record<string, Cell>,
        keys = collections,
      ) => {
        const asked: string[][] = [];
        return runMailPiece(
          s,
          hooks,
          piece("boni.mailDecider", thing(json), {
            values: { collections: keys },
            read: async (r) => {
              asked.push(r.options ?? []);
              return answers(r.options ?? []);
            },
          }),
          undefined,
        ).then((a) => ({ a, asked }));
      };
      const sure = (c: string, confidence: number) => () => ({
        answer: { choice: c, confidence },
        label: MAIL,
      });
      const got = await decide(sure("evento", 0.8));
      expect(got.a).toMatchObject({ rows: [{ json: { collection: "evento" } }] });
      expect(got.asked).toEqual([
        ["tarea", "evento"],
        ["evento", "tarea"],
      ]);
      expect((await decide(sure("evento", 0.5))).a).toMatchObject({
        rows: [{ output: BONI_DOUBT }],
      });
      expect(
        (await decide((o) => ({ answer: { choice: o[0], confidence: 0.9 }, label: MAIL }))).a,
      ).toMatchObject({
        rows: [{ output: BONI_DOUBT }],
      });
      expect((await decide(() => ({ refused: "no-model" }))).a).toMatchObject({
        rows: [{ output: BONI_DOUBT }],
      });
      const rule = await decide(sure("tarea", 0.9), { rule: "evento" });
      expect(rule.asked).toEqual([]);
      expect(rule.a).toMatchObject({ rows: [{ json: { collection: "evento" } }] });
      const lone = await decide(sure("evento", 0.9), {}, [{ collection: "tarea" }]);
      expect(lone.asked).toEqual([]);
      expect(lone.a).toMatchObject({ rows: [{ json: { collection: "tarea" } }] });

      // The «Rellenadora» takes his answer only among the «Decisora»'s collections of the version that runs.
      const doc = drawReadMail(CONFIG) as Automation;
      const fill = (json: Record<string, Cell>) =>
        runMailPiece(s, hooks, piece("boni.mailFiller", thing(json)), doc);
      expect(
        await fill({ [ANSWER_FIELD]: "Eventos", due: "2026-11-26", start: "10:00" }),
      ).toMatchObject({
        rows: [
          {
            json: {
              [CHOSEN.collection]: "evento",
              [CHOSEN.values]: { title: "Llamar al proveedor", dia: "2026-11-26", hora: "10:00" },
            },
          },
        ],
      });
      expect(await fill({ [ANSWER_FIELD]: NONE_OPTION })).toMatchObject({ rows: [] });
      expect(await fill({ [ANSWER_FIELD]: "pedido" })).toMatchObject({ rows: [] });
      expect(await fill({ [CHOSEN.collection]: "pedido" })).toMatchObject({ rows: [] });
    } finally {
      s.close();
    }
  });

  it("AU-253 · past the day's cap of an automation that starts with a mail no run starts and no model is called, the mail waits for the next day, and a read mail is a run in «Ejecuciones» with no line in the server's log", async () => {
    const s = mailStore();
    try {
      const { reader, decider } = wired(s, {
        read: () => reading([{ kind: "task", title: "Una cosa" }]),
      });
      converted(s);
      const doc = publishedOf(s, MAIL_FLOW)?.automation as Automation;
      const id = mail(s, { from: OTHER, subject: "Primero" });
      // A read mail is a run of «Leer correo», with the mail in its trigger's row.
      const logged: unknown[] = [];
      const log = console.log;
      console.log = (...a: unknown[]) => logged.push(a);
      let r: Awaited<ReturnType<typeof read>>;
      try {
        r = await read(s, id);
      } finally {
        console.log = log;
      }
      expect(JSON.parse(s.journal.automationRun(r.run.id)?.fields ?? "{}")).toMatchObject({ id });
      expect(JSON.stringify(logged)).not.toContain(OTHER);
      expect(JSON.stringify(logged)).not.toContain("Primero");
      const calls = reader.requests.length + (decider?.requests.length ?? 0);
      expect(reader.requests.length).toBe(1);

      // The cap of that run counts before each call: 20 for one sender, and then none for that sender today.
      const cap = mailCapOf(s, MAIL_FLOW, r.run.id, doc, ZONE) as () => boolean;
      expect(cap).toBeTypeOf("function");
      let allowed = 0;
      while (cap()) allowed++;
      expect(allowed + calls).toBe(MAIL_CAP.perSender);
      expect(mailCapLeft(s, MAIL_FLOW, OTHER, ZONE, Date.now())).toBe(false);
      expect(mailCapLeft(s, MAIL_FLOW, KNOWN, ZONE, Date.now())).toBe(true);
      // Past the cap a run calls no model: its reader is refused before the provider is asked.
      const again = mail(s, { from: OTHER, subject: "Segundo" });
      const past = await read(s, again);
      expect(past.run.state).toBe("failed");
      expect(reader.requests.length).toBe(1);
      // The next day, in his zone, it may read again.
      expect(mailCapLeft(s, MAIL_FLOW, OTHER, ZONE, Date.now() + 86_400_000)).toBe(true);
      // The day's 150 for the automation, whoever sends.
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(Date.now());
      s.journal.spend(day, `mail-cap\u0000${MAIL_FLOW}`, MAIL_CAP.perDay);
      expect(mailCapLeft(s, MAIL_FLOW, KNOWN, ZONE, Date.now())).toBe(false);
      // A run of an automation that does not start with a mail has no cap.
      expect(
        mailCapOf(
          s,
          "a-otra",
          r.run.id,
          {
            ...doc,
            steps: doc.steps.map((x) => (x.type === "boni.mail" ? { ...x, type: "manual" } : x)),
          },
          ZONE,
        ),
      ).toBeNull();
    } finally {
      s.close();
    }
  });

  it("AU-253 · with a year of mail (11,000 read mails' proposals and his decisions), what each mail's run asks of the journal (the cap, «Solo conocidos», the sender's pending titles) stays within its time", () => {
    const s = mailStore();
    try {
      const hooks = hooksOf(s);
      const senders = Array.from({ length: 300 }, (_, i) => `ejemplo.remitente${i}@example.com`);
      s.batch(() => {
        for (let i = 0; i < 11_000; i++)
          proposal(s, {
            id: `p_${i}`,
            sender: senders[i % senders.length] as string,
            collection: i % 2 ? "tarea" : "evento",
            title: `Cosa inventada número ${i}`,
            status: i % 10 === 0 ? "pending" : i % 7 === 0 ? "rejected" : "accepted",
            at: NOW - (11_000 - i) * 2_800_000,
          });
      });
      const id = mail(s, { from: senders[7] as string, subject: "Uno más" });
      const row = rowOf(s, id);
      const t = clock();
      const known = knownSender(s, hooks, row, "tarea");
      const pending = pendingTitles(s, senders[7] as string);
      const left = mailCapLeft(s, MAIL_FLOW, senders[7] as string, ZONE, NOW);
      const ms = clock() - t;
      expect(typeof known).toBe("boolean");
      expect(pending.length).toBeLessThanOrEqual(PENDING_TITLES.n);
      expect(left).toBe(true);
      under(ms, 400, "cpu", "a mail's journal reads over a year of mail");
    } finally {
      s.close();
    }
  });

  it("AU-254 · the conversion of mail keeps the mailbox, the read marks and the pending cards, writes the collections, the guide and the rules into the steps' panels, and leaves every cell in «Preguntar» even with «Solo» on", async () => {
    const s = mailStore();
    try {
      wired(s);
      const waiting = "p_espera";
      proposal(s, { id: waiting, sender: OTHER, collection: "tarea", title: "Tarjeta que espera" });
      const marked = mail(s, { from: OTHER, subject: "Leído" });
      expect(converted(s)).toEqual([expect.objectContaining({ state: "converted" })]);
      const doc = publishedOf(s, MAIL_FLOW)?.automation as Automation;
      const create = doc.steps.find((x) => x.type === CREATE_CHOSEN);
      expect(create?.params.onlyKnown).toBe(true);
      // One «Crear» cell per collection, every one «Preguntar»: nothing is born «Sí», «Solo» or not.
      expect(create?.connections).toEqual([
        { collection: "tarea", read: false, create: { mode: "ask" }, update: false, remove: false },
        {
          collection: "evento",
          read: false,
          create: { mode: "ask" },
          update: false,
          remove: false,
        },
      ]);
      expect(doc.steps.find((x) => x.type === "boni.mailDecider")?.params.collections).toEqual([
        { collection: "tarea" },
        { collection: "evento" },
      ]);
      // The old versions are not translated (Boni's code made them): only the one that runs is adopted.
      expect(s.journal.automationVersions(MAIL_FLOW).length).toBe(1);
      // The pending card and the mails stay as they were.
      expect(s.journal.proposal(waiting)?.status).toBe("pending");
      expect(s.get(marked)?.entity.deleted).toBeUndefined();

      // A last version of his hand is not converted: it stays on the engine of before, and says so.
      const t = mailStore();
      try {
        wired(t);
        expect(converted(t, CONFIG, "user")).toEqual([
          expect.objectContaining({
            id: MAIL_FLOW,
            state: "kept",
            reasons: [{ step: "", what: "version", reason: "his" }],
          }),
        ]);
        expect(publishedOf(t, MAIL_FLOW)).toBeNull();
      } finally {
        t.close();
      }
      // Without a collection there is nothing to draw: kept, nothing written.
      const u = mailStore();
      try {
        wired(u);
        expect(converted(u, { ...CONFIG, collections: [] })).toEqual([
          expect.objectContaining({ state: "kept" }),
        ]);
        expect(publishedOf(u, MAIL_FLOW)).toBeNull();
      } finally {
        u.close();
      }
    } finally {
      s.close();
    }
  });

  it("AU-255 · a piece's reader gets what came from a mail only between the markers and labelled as from outside, the sender's pending titles included, and beside it only its panel and closed lists: a row of the person's, or a field label set on the trigger's row, fails with ai.private", async () => {
    const s = mailStore();
    try {
      const hooks = hooksOf(s);
      // What the sender has waiting: pending, every outside source his, none corrected; at most 20 of 200.
      for (let i = 0; i < 25; i++)
        proposal(s, {
          id: `p_mio_${i}`,
          sender: OTHER,
          collection: "tarea",
          title: `Pendiente ${i} ${"x".repeat(i === 0 ? 300 : 0)}`,
          at: NOW - i * 1000,
        });
      proposal(s, { id: "p_otro", sender: KNOWN, collection: "tarea", title: "De otro remitente" });
      proposal(s, {
        id: "p_mezcla",
        sender: OTHER,
        collection: "tarea",
        title: "Mezclado",
        sources: [`mail:${OTHER}`, `mail:${KNOWN}`],
      });
      proposal(s, {
        id: "p_corregido",
        sender: OTHER,
        collection: "tarea",
        title: "Corregido",
        status: "accepted",
        edits: true,
      });
      const id = mail(s, { from: OTHER, subject: "Hola", text: "Lo de siempre." });
      const seen: PieceRead[] = [];
      const got = await runMailPiece(
        s,
        hooks,
        piece("boni.mailReader", rowOf(s, id), {
          values: { modules: ["tasks", "events"] },
          read: async (r) => {
            seen.push(r);
            return { answer: reading([{ kind: "task", title: "Lo de siempre" }]), label: MAIL };
          },
        }),
        undefined,
      );
      expect(got).toMatchObject({
        rows: [{ json: { id, kind: "tasks", title: "Lo de siempre" } }],
      });
      const [r] = seen as [PieceRead];
      expect(r.userIn).toBe("to");
      // Every text is from outside, the mail's and the pending titles alike.
      for (const t of r.texts) {
        expect(t.label.integrity).toBe("external");
        expect(t.label.sources).toEqual(
          expect.arrayContaining([expect.objectContaining({ kind: "mail", id: OTHER })]),
        );
      }
      const pending = r.texts.slice(1).map((t) => t.value);
      expect(pending.length).toBe(PENDING_TITLES.n);
      expect(pending.every((t) => t.length <= PENDING_TITLES.chars)).toBe(true);
      expect(pending).not.toContain("De otro remitente");
      expect(pending).not.toContain("Mezclado");
      expect(pending).not.toContain("Corregido");

      // The request the model gets: the mail between markers, the pending titles between their own.
      const req = pieceRequest(
        {
          use: "reading",
          model: null,
          reader: "read_message",
          texts: r.texts.map((t) => t.value),
          modules: ["tasks", "events"],
          userIn: "to",
          now: NOW,
          zone: ZONE,
        },
        s,
      ) as ModelRequest;
      const input = req.input as {
        marker: string;
        content: string;
        known: { marker: string; content: string };
      };
      expect(input.content).toBe(`<<${input.marker}>>\n${r.texts[0]?.value}\n<<${input.marker}>>`);
      expect(input.known.content.startsWith(`<<${input.known.marker}>>\n`)).toBe(true);
      expect(input.known.marker).not.toBe(input.marker);
      expect(input.content).not.toContain("Pendiente 1 ");
      expect(req.system).toContain('"known" (when present)');
      expect(req.system).toContain("between their own markers");
      // A row of his, or a label set on the trigger's row, never reaches this request: the engine refuses it first
      // (`pieceRead`, `ai.private`; boni-steps.test.ts «AU-255 · …»).
    } finally {
      s.close();
    }
  });
});
