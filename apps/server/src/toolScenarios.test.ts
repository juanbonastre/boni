import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EFFECTS, READERS } from "@boni/agent";
import { describe, expect, it } from "vitest";
import { serverRegistry } from "./actions.ts";
import { TURN_ONLY } from "./flows.ts";

/**
 * A-18 (docs/principios.md; Juan, 2026-11-05, task 64, measure E): every tool a model can call has its scenario, a test
 * that runs it for real through the agent and checks what reaches Juan or whoever reads it afterwards (the planner,
 * the scheduler, a device). A tool without one does not go in: `jobs.create` saved jobs that nothing ever ran, and no
 * test noticed (audit of 2026-11-05, task 63). Here each tool names its scenarios by file and exact title; adding a
 * tool means writing its scenario, and the review of that scenario is where «who runs this?» gets asked.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");
const AGENT = "packages/agent/test/agent.test.ts";
const MAIL = "apps/server/src/mail.test.ts";
const FUNCTIONS = "apps/server/src/functionSteps.test.ts";

/** The flow «Revisar la guía»'s pieces, all three in one review (D-51). */
const REVIEW_TEST =
  "«Revisar la guía» is Boni's flow: a review is a run of its four steps, and turned off there is none (D-51)";
/** The list of actions in the conversation (F10): pages, their blocks and views, the Bandeja's cards. */
const ACTIONS = "apps/server/src/pageActions.test.ts";
const PAGE_TEST =
  "«hazme una página Gastos con el gasto por categoría» makes the page with its chart, and Undo takes it back";
const TABLE_TEST =
  "a table of a page: added, its view changed, the page renamed and moved, and deleted only on Juan's touch";
const INBOX_TEST =
  "«acepta estas dos»: the Bandeja's cards on the screen, accepted on a card that names them, and one rejected";
/** «Datos», «Flujos» and «Corregir» (F10, part 2). */
const DATA_ACTIONS = "apps/server/src/dataActions.test.ts";
const DATA_TEST =
  "«llama Gastos a Movimientos, mete Libros en Lecturas y pasa esta nota a Tareas»: done in his turn, and Undo of the run takes it all back";
const DELETE_TEST =
  "a collection deleted and a field taken out only on Juan's touch, and back with Undo of the run";
const FLOW_TEST =
  "a flow switched on only on Juan's touch, never from background work, tried by an assistant, deleted on his card, and Undo of the run switches it back";
const CORRECT_TEST =
  "«corrígela: Pedir cita en el taller el lunes, en Notas»: a proposal accepted corrected on Juan's touch";
/** «Calendarios», a collection's tabs and tree, «Conectores» and «Extensiones» (F10, part 3). */
const CAL_ACTIONS = "apps/server/src/calendarActions.test.ts";
const SCREEN = "apps/server/src/screenActions.test.ts";
const FILTER_TEST =
  "«enséñame los movimientos de restaurantes de octubre»: the collection opened filtered, by ids, and nothing written";
const OPEN_TEST = "«ábreme Agenda»: opened, with today's lit by the rows a tool gave";
const LIT_TEST =
  "what is lit or scrolled to is what the screen or a tool gave, never a model's own key";
const RUN_TEST =
  "«¿por qué paró el flujo de ayer?»: its runs read, and the one that stopped opened over the map";
const CAL_TEST =
  "«pon Viajes como calendario, sepáralo por Tipo, en verde y con aviso un día antes»: done in his turn, taking it away is his card, and Undo of the run takes each back";
const CAL_MCP_TEST =
  "an assistant by the MCP: the calendars, a tab and the tree, and its `undo` takes them back";
const TAB_TEST = "a collection's tab and its notes in the tree, in his turn, with Undo";
const EXT_TEST =
  "«desactiva la extensión del correo»: his touch on the card, never alone or in a flow, and Undo switches it back";
const MAIL_ACTIONS_TEST =
  "«lee también Gestiones, y escribe en la guía…»: Juan's touch on the mail's settings and guide, the mail brought and read again from his turn, and Undo of the run";
const SCENARIOS: Record<string, { file: string; test: string }[]> = {
  "calendars.list": [
    { file: CAL_ACTIONS, test: CAL_TEST },
    { file: CAL_ACTIONS, test: CAL_MCP_TEST },
  ],
  "calendars.add": [
    { file: CAL_ACTIONS, test: CAL_TEST },
    { file: CAL_ACTIONS, test: CAL_MCP_TEST },
  ],
  "calendars.remove": [{ file: CAL_ACTIONS, test: CAL_TEST }],
  "calendars.split": [
    { file: CAL_ACTIONS, test: CAL_TEST },
    { file: CAL_ACTIONS, test: CAL_MCP_TEST },
  ],
  "calendars.color": [
    { file: CAL_ACTIONS, test: CAL_TEST },
    { file: CAL_ACTIONS, test: CAL_MCP_TEST },
  ],
  "calendars.reminders": [
    { file: CAL_ACTIONS, test: CAL_TEST },
    { file: CAL_ACTIONS, test: CAL_MCP_TEST },
  ],
  "schema.set_view": [
    { file: CAL_ACTIONS, test: TAB_TEST },
    { file: CAL_ACTIONS, test: CAL_MCP_TEST },
  ],
  "schema.set_tree": [
    { file: CAL_ACTIONS, test: TAB_TEST },
    { file: CAL_ACTIONS, test: CAL_MCP_TEST },
  ],
  "extensions.enable": [{ file: CAL_ACTIONS, test: EXT_TEST }],
  "connectors.mail_view": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "connectors.mail": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "connectors.mail_check": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "connectors.mail_propose": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "connectors.mail_reread": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "connectors.mail_guide": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "connectors.mail_review": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "connectors.mail_suggestion": [{ file: MAIL, test: MAIL_ACTIONS_TEST }],
  "schema.rename_type": [{ file: DATA_ACTIONS, test: DATA_TEST }],
  "schema.move_type": [{ file: DATA_ACTIONS, test: DATA_TEST }],
  "schema.update_field": [{ file: DATA_ACTIONS, test: DATA_TEST }],
  "entities.move": [{ file: DATA_ACTIONS, test: DATA_TEST }],
  "schema.delete_type": [{ file: DATA_ACTIONS, test: DELETE_TEST }],
  "schema.remove_field": [{ file: DATA_ACTIONS, test: DELETE_TEST }],
  "flows.enable": [{ file: DATA_ACTIONS, test: FLOW_TEST }],
  "flows.delete": [{ file: DATA_ACTIONS, test: FLOW_TEST }],
  "flows.test": [{ file: DATA_ACTIONS, test: FLOW_TEST }],
  "flows.runs": [{ file: SCREEN, test: RUN_TEST }],
  "screen.open": [
    { file: SCREEN, test: OPEN_TEST },
    { file: SCREEN, test: RUN_TEST },
  ],
  "screen.filter": [{ file: SCREEN, test: FILTER_TEST }],
  "screen.highlight": [
    { file: SCREEN, test: OPEN_TEST },
    { file: SCREEN, test: LIT_TEST },
  ],
  "screen.scroll": [{ file: SCREEN, test: LIT_TEST }],
  "inbox.correct": [{ file: DATA_ACTIONS, test: CORRECT_TEST }],
  "pages.create": [{ file: ACTIONS, test: PAGE_TEST }],
  "pages.add_block": [{ file: ACTIONS, test: PAGE_TEST }],
  "pages.set_view": [{ file: ACTIONS, test: TABLE_TEST }],
  "pages.update": [{ file: ACTIONS, test: TABLE_TEST }],
  "pages.delete": [{ file: ACTIONS, test: TABLE_TEST }],
  "inbox.accept": [{ file: ACTIONS, test: INBOX_TEST }],
  "inbox.reject": [{ file: ACTIONS, test: INBOX_TEST }],
  "entities.query": [
    {
      file: AGENT,
      test: "reads several mails in one call: a line per mail, and the counts by kind are the code's",
    },
  ],
  "entities.get": [
    {
      file: AGENT,
      test: "every task of every mail in one loop, a mail with none included (the plan the real planner wrote)",
    },
  ],
  "entities.aggregate": [
    { file: AGENT, test: "answers about data with numbers the code computed" },
  ],
  "entities.origin": [
    {
      file: AGENT,
      test: "says where a record comes from: the flow that proposed it, its mail as the models may see it, and the «Aceptar» (entities.origin)",
    },
  ],
  "inbox.pending": [
    {
      file: AGENT,
      test: "says where a proposal waiting in the Bandeja comes from: the flow and its mail, found by its title's words (inbox.pending)",
    },
  ],
  "entities.search": [
    {
      file: AGENT,
      test: "every task of every mail in one loop, a mail with none included (the plan the real planner wrote)",
    },
    {
      file: AGENT,
      test: "entities.search with since: only what came in within the days asked, newest first, then the limit",
    },
  ],
  "schema.describe": [
    {
      file: AGENT,
      test: "says what collections Juan has and their fields, from the schema (schema.describe)",
    },
  ],
  "entities.create": [
    { file: AGENT, test: "creates what Juan asks for, quoting him, and undoes the whole run" },
  ],
  "entities.update": [
    {
      file: AGENT,
      test: "changes a record at Juan's request, in his words, and Undo puts it back as it was",
    },
  ],
  "entities.delete": [
    { file: AGENT, test: "asks Juan to confirm a deletion, bound to those values, once" },
  ],
  "schema.create_type": [{ file: AGENT, test: "changes the schema at Juan's request and says so" }],
  "schema.add_field": [{ file: AGENT, test: "changes the schema at Juan's request and says so" }],
  "memory.save": [
    {
      file: AGENT,
      test: "a memory in Juan's own words reaches the planner in the turns after (A11)",
    },
    {
      file: AGENT,
      test: "tells Juan about a memory a model wrote, and keeps it out of the planner until he confirms (A11)",
    },
  ],
  "flows.run": [
    {
      file: AGENT,
      test: "asks to confirm it, by its name; once confirmed it runs as a run of its own and its answers come in the turn",
    },
  ],
  "flows.save": [
    {
      file: AGENT,
      test: "only waits in the inbox; accepting it saves it as the user's and turns it on",
    },
    // Who runs what it saved: the scheduler, once per slot.
    {
      file: "apps/server/src/flowScheduler.test.ts",
      test: "is due once: not for a time before the version was saved, nor again after it ran, nor long after",
    },
  ],
  notify: [
    {
      file: "apps/server/src/agent.test.ts",
      test: "tells the account's devices what the agent notifies",
    },
    {
      file: "apps/server/src/reminders.test.ts",
      test: "a scheduled flow's «Avisar» reaches the phone with Boni closed, sealed for it alone; the calendar's address only hears «reminders»",
    },
  ],
  // Boni's pieces (docs/sistema.md §4.2): no model calls them; the flow «Leer correo» runs each, for real.
  "mail.rule": [
    {
      file: MAIL,
      test: "his words reach the reader; rules are code: never read, or straight to one collection",
    },
    {
      file: MAIL,
      test: "the guide's rule ends the reading at its step, as done, without a model; a mail Juan asks for is read",
    },
  ],
  "mail.known": [
    {
      file: MAIL,
      test: "become proposals in a collection the reader picks among the marked ones, never writes",
    },
  ],
  "mail.invitation": [
    {
      file: MAIL,
      test: "gives its event from the .ics by code, with its hours; not again when a calendar of the account has it",
    },
  ],
  "mail.relations": [
    {
      file: MAIL,
      test: "come with their other fields filled from Juan's own options, and a note (Jev when there is one)",
    },
  ],
  "inbox.fold": [
    {
      file: MAIL,
      test: "proposes once what replies repeat; a changed hour gives way to the new proposal, which says what it was",
    },
  ],
  "inbox.accept_alone": [
    {
      file: MAIL,
      test: "with «Solo» on, a proposal like the ones Juan always kept is accepted in its own reading, a step of the flow",
    },
  ],
  "function.run": [
    {
      file: FUNCTIONS,
      test: "in the background its changes wait in the Bandeja as one proposal, applied when Juan accepts it",
    },
    {
      file: FUNCTIONS,
      test: "«Probar» runs the function and says what it would change, writing nothing and proposing nothing",
    },
  ],
  "function.apply": [
    {
      file: FUNCTIONS,
      test: "in the background its changes wait in the Bandeja as one proposal, applied when Juan accepts it",
    },
  ],
  "guide.decisions": [{ file: MAIL, test: REVIEW_TEST }],
  "guide.measure": [{ file: MAIL, test: REVIEW_TEST }],
  "guide.suggest": [{ file: MAIL, test: REVIEW_TEST }],
  "mail.save": [
    {
      file: MAIL,
      test: "brings the mail through its piece «Guardar en Correos»: a look that finds mail is a run, one that finds none is not, and turned off it brings nothing",
    },
  ],
};
/**
 * Effects no tool of the registry has yet, with their policy ready (docs/nucleo.md §7.5): a write with no Undo
 * (deleting goes to the trash), and a tool that fetches or sends, registered only on purpose.
 */
const NO_TOOL_YET = ["write_irreversible", "egress", "send"];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("every tool a model can call has its scenario (A-18)", () => {
  // The server's registry: the list of actions (actions.ts).
  const tools = serverRegistry()
    .all()
    .map((t) => t.name)
    .sort();

  it("each tool of the registry names its scenarios, and nothing else is named", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(tools);
  });

  it("each scenario is a test that exists, by its exact title", () => {
    const missing: string[] = [];
    for (const [tool, list] of Object.entries(SCENARIOS)) {
      expect(list.length, tool).toBeGreaterThan(0);
      for (const s of list) {
        const path = join(ROOT, s.file);
        const text = existsSync(path) ? readFileSync(path, "utf8") : "";
        if (!new RegExp(`\\b(?:it|test)\\(\\s*"${escapeRe(s.test)}"`).test(text))
          missing.push(`${tool}: ${s.file} «${s.test}»`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every effect has a tool that runs it, or is one no tool has yet", () => {
    const used = new Set(
      serverRegistry()
        .all()
        .map((t) => t.effect as string),
    );
    expect(EFFECTS.filter((e) => !used.has(e))).toEqual(NO_TOOL_YET);
  });
});

describe("every step a flow may have says in one line what it does (I-27)", () => {
  it("each tool of the registry and each reader has its `flow.desc` line, in Spanish and in English", () => {
    const words = readFileSync(join(ROOT, "apps/boni-web/src/i18n.ts"), "utf8");
    const steps = [
      // Juan's touch is no flow's step (P21), nor what only a turn asks (flows.ts `TURN_ONLY`): not in «Añadir paso».
      ...serverRegistry()
        .all()
        .filter((t) => t.effect !== "touch" && !TURN_ONLY.has(t.name))
        .map((t) => t.name),
      ...READERS,
      "op.ask",
      "op.reply",
    ];
    const missing = steps.filter(
      (s) => (words.match(new RegExp(`"flow\\.desc\\.${escapeRe(s)}":`, "g")) ?? []).length !== 2,
    );
    expect(missing).toEqual([]);
  });
});
