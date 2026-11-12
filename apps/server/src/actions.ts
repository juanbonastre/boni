import {
  coreTools,
  type Decision,
  decide,
  fieldName,
  leaf,
  plain,
  type ReadStore,
  type ToolDef,
  ToolError,
  ToolRegistry,
  type Trust,
  typeName,
  type UndoWay,
  type Val,
} from "@boni/agent";
import { type Label, label } from "@boni/entities";
import type { UserStore } from "@boni/store";
import { withCalendarActions } from "./calendarActions.ts";
import { withConnectorActions } from "./connectorActions.ts";
import { withDataActions } from "./dataActions.ts";
import { withFileActions } from "./fileActions.ts";
import { withFlowActions } from "./flowActions.ts";
import { withFunctionSteps } from "./functionSteps.ts";
import { withInboxActions } from "./inboxActions.ts";
import { withPageActions } from "./pageActions.ts";
import { withPieces } from "./pieces.ts";
import { withKept } from "./runUndo.ts";

/**
 * The list of actions (docs/sistema.md §4.1, F10; D-41): one for the app, the planner, the flows and the MCP. The
 * registry is the list (the core's tools, Boni's pieces, an extension's steps, the pages'); this file says, for each
 * route of the API that changes something, which action it runs (the same code, with the origin «Juan desde este
 * dispositivo»), or why it is none; and, for each action, its tool in the MCP or why it has none. `actions.test.ts`
 * holds them to it: a route that changes something without its action, or an action without its control in the app
 * and its tool, does not merge.
 */

/** The server's registry: the planner's, the flow editor's catalogue (D-41) and the MCP's `flows_describe`. */
export function serverRegistry(): ToolRegistry {
  const all = withConnectorActions(
    withCalendarActions(
      withInboxActions(
        withFlowActions(
          withFileActions(
            withDataActions(withPageActions(withFunctionSteps(withPieces(coreTools())))),
          ),
        ),
      ),
    ),
  );
  // What each action rewrites beside the log is kept with its run by its definition (`keeps`, runUndo.ts).
  const out = new ToolRegistry();
  for (const t of all.all()) out.register(withKept(t));
  return out;
}

/** A route that changes something, and the actions it runs: the same code as the action's (its area's module). */
export const ROUTE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  "POST /api/pages": ["pages.create"],
  // The editor saves the whole page: what «/» adds, a table's view, its name, icon and place.
  "PUT /api/pages/:id": ["pages.update", "pages.add_block", "pages.set_view", "pages.set_value"],
  "DELETE /api/pages/:id": ["pages.delete"],
  // Juan's corrections (title, collection, «Enlazar», «Es el mismo») go with it; the acceptance is the agent's.
  "POST /api/agent/proposals/:id/accept": ["inbox.accept", "inbox.correct"],
  "POST /api/agent/proposals/:id/reject": ["inbox.reject"],
  // «Datos» (dataActions.ts and the core's): a collection, its fields, a record. A row of «Flujos», «Mis datos» or
  // «Páginas» is that area's own (flow, collection, page), as the route runs it.
  "POST /api/data/types": ["schema.create_type"],
  "DELETE /api/data/types/:type": ["schema.delete_type"],
  "PUT /api/data/types/:type/parent": ["schema.move_type"],
  "PUT /api/data/types/:type/name": ["schema.rename_type"],
  // «Duplicar» a column copies its values into the new one (task 76).
  "POST /api/data/types/:type/fields": ["schema.add_field", "entities.update"],
  "PUT /api/data/types/:type/fields/:field": ["schema.update_field"],
  "DELETE /api/data/types/:type/fields/:field": ["schema.remove_field"],
  "PUT /api/data/rows/:id/type": ["entities.move"],
  "POST /api/data/types/:type/rows": [
    "entities.create",
    "flows.save",
    "schema.create_type",
    "pages.create",
  ],
  "PUT /api/data/rows/:id": ["entities.update", "flows.save", "schema.rename_type", "pages.update"],
  "DELETE /api/data/rows/:id": [
    "entities.delete",
    "flows.delete",
    "schema.delete_type",
    "pages.delete",
  ],
  // «Flujos» (flowActions.ts and the core's).
  "POST /api/agent/flows": ["flows.save"],
  "PUT /api/agent/flows/:id": ["flows.save"],
  "PUT /api/agent/flows/:id/enabled": ["flows.enable"],
  "DELETE /api/agent/flows/:id": ["flows.delete"],
  "POST /api/agent/flows/:id/run": ["flows.run"],
  // A page's chat (pageChat.ts, D-61) is a flow: made for its page and changed in its block's panel.
  "POST /api/agent/chats": ["flows.save"],
  "PUT /api/agent/chats/:id": ["flows.save"],
  // A page's button (buttons.ts, D-60): the action it names, or its flow by hand, as a turn of Juan's.
  "POST /api/agent/press": ["entities.create", "entities.update", "entities.delete", "flows.run"],
  // Boni Calendar: a record moved, made or deleted in the grid; a calendar of the list (calendarActions.ts).
  "POST /api/apply": ["entities.create", "entities.update", "entities.delete"],
  "POST /api/collections/add": ["calendars.add"],
  "POST /api/collections/remove": ["calendars.remove"],
  "POST /api/collections/split": ["calendars.split"],
  "POST /api/collections/color": ["calendars.color"],
  "PUT /api/collections/reminders": ["calendars.reminders"],
  // Boni's first screens (v1): a movement written from the money screen.
  "POST /api/v1/actions": ["entities.create"],
  // Ajustes «Correo» and «Extensiones» (connectorActions.ts).
  "PUT /api/mail": ["connectors.mail"],
  "POST /api/mail/check": ["connectors.mail_check"],
  "POST /api/mail/reread": ["connectors.mail_reread"],
  "PUT /api/mail/guide": ["connectors.mail_guide"],
  "POST /api/mail/review": ["connectors.mail_review"],
  "POST /api/mail/suggestion": ["connectors.mail_suggestion"],
  "POST /api/mail/propose": ["connectors.mail_propose"],
  "PUT /api/agent/extensions/:id": ["extensions.enable"],
  // A collection's tabs and its notes in the sidebar tree (dataActions.ts).
  "PUT /api/data/types/:type/row-ui": ["schema.set_view"],
  "PUT /api/data/types/:type/tree": ["schema.set_tree"],
};

/**
 * The routes that are an Undo, each with the way of undoing it is (`UndoWay`, docs/sistema.md §4.1). Which actions each
 * takes back is each action's own word (`ToolDef.undo`), so a new action says it once, where it is defined. What comes
 * back from the trash comes back by the route of what the action's arguments name: a page, a column, else a record (a
 * note, a collection, a flow).
 */
const UNDO_WAY_ROUTES: Readonly<Record<string, { way: UndoWay; of?: (t: ToolDef) => boolean }>> = {
  // The run's operations, and what it changed beside the log (runUndo.ts, AgentHost.undoKept): what it switched or
  // deleted in «Flujos», a calendar's definition, a collection's tabs or tree, the mail's settings and guide.
  "POST /api/agent/runs/:id/undo": { way: "run" },
  // A movement of the money screen, taken back there.
  "DELETE /api/v1/actions/:id": { way: "screen" },
  "POST /api/pages/:id/restore": { way: "trash", of: (t) => t.area === "pages" },
  "POST /api/data/rows/:id/restore": {
    way: "trash",
    of: (t) => t.area !== "pages" && !namesAField(t),
  },
  "POST /api/data/types/:type/fields/:field/restore": { way: "trash", of: namesAField },
  "POST /api/agent/flows/:id/revert": { way: "version" },
  "POST /api/agent/proposals/:id/restore": { way: "bandeja" },
};
function namesAField(t: ToolDef): boolean {
  return Object.values(t.args).some((a) => a.role === "field");
}
/** The ways an action says it is undone (none for one that only reads, or says why there is nothing to undo). */
export const undoWays = (t: Pick<ToolDef, "undo">): readonly UndoWay[] =>
  Array.isArray(t.undo) ? t.undo : [];

/** The registry the routes and the MCP reach their actions by: what the server runs. */
export const ACTIONS: ToolRegistry = serverRegistry().freeze();

/** A route that is the Undo of actions, and the actions it takes back: computed from each action's `undo`. */
export const UNDO_ROUTES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(UNDO_WAY_ROUTES).map(([route, w]) => [
    route,
    ACTIONS.all()
      .filter((t) => undoWays(t).includes(w.way) && (!w.of || w.of(t)))
      .map((t) => t.name),
  ]),
);

/**
 * Juan's hand on a route that changes something (docs/sistema.md §4.1, P25): each action the route runs
 * (`ROUTE_ACTIONS`) is asked of the policy engine with the origin «Juan desde este dispositivo» before the route runs
 * it. The first decision that does not allow it, or null when the route runs. A route whose action is not registered
 * is refused (P0), so no route that changes something runs around the list.
 */
export function routeDecision(
  route: string,
  who: { trust: Trust; device: string },
  registry: ToolRegistry = ACTIONS,
): Exclude<Decision, { kind: "allow" }> | null {
  const names = Object.hasOwn(ROUTE_ACTIONS, route) ? (ROUTE_ACTIONS[route] ?? []) : [];
  for (const name of names) {
    const d = decide(
      { tool: registry.get(name), args: {}, control: null },
      { kind: "hand", trust: who.trust, device: who.device },
      { writes: 0, sensitiveReads: 0 },
    );
    if (d.kind !== "allow") return d;
  }
  return null;
}

/**
 * The routes that run their action itself (`def.run`), through `runAction` (docs/sistema.md §4.1): the route only
 * reads its body and words the answer. The policy decides each one there, with the real arguments, and not before
 * routing (never twice).
 */
export const ROUTE_RUNS: Readonly<Record<string, string>> = {
  "POST /api/collections/add": "calendars.add",
  "POST /api/collections/remove": "calendars.remove",
  "POST /api/collections/split": "calendars.split",
  "POST /api/collections/color": "calendars.color",
  "PUT /api/data/types/:type/tree": "schema.set_tree",
};

/**
 * The routes that change something and still run their area's module after the policy decides their actions: why
 * each is not its action's `def.run` yet. What is left of task 95's first point (docs/sistema.md §4.1, «Parcial»).
 */
export const ROUTE_MODULES: Readonly<Record<string, string>> = {
  "POST /api/pages":
    "it answers with the whole page the editor opens, not the action's id and name",
  "PUT /api/pages/:id":
    "the editor saves the whole page at once: four actions (name, blocks, a view, a value) in one write",
  "DELETE /api/pages/:id":
    "it answers with the page in the trash, which the editor's «Deshacer» restores",
  "POST /api/agent/proposals/:id/accept":
    "Juan's corrections (title, collection, «Enlazar», «Es el mismo») go with the acceptance: inbox.accept and inbox.correct in one",
  "POST /api/agent/proposals/:id/reject": "it answers with the Bandeja's state the app repaints",
  "POST /api/data/types":
    "data.ts makes the collection by Juan's name and id (the action takes a model's key), with its first fields",
  "DELETE /api/data/types/:type": "data.ts takes the collection by id and answers its HTTP code",
  "PUT /api/data/types/:type/parent":
    "data.ts takes both collections by id and answers its HTTP code",
  "PUT /api/data/types/:type/name": "data.ts renames by id with Juan's icon and description too",
  "POST /api/data/types/:type/fields":
    "«Duplicar» a column copies its values: schema.add_field and entities.update in one",
  "PUT /api/data/types/:type/fields/:field":
    "data.ts changes a column by id with what only the table has (width, format, its options' colours)",
  "DELETE /api/data/types/:type/fields/:field":
    "data.ts takes the column by id and answers its HTTP code",
  "PUT /api/data/rows/:id/type": "data.ts moves the row by ids and answers its HTTP code",
  "POST /api/data/types/:type/rows":
    "a row of «Flujos», «Mis datos» or «Páginas» is that area's own: four actions by the collection's kind",
  "PUT /api/data/rows/:id": "a row's change is its area's own by the row's kind: four actions",
  "DELETE /api/data/rows/:id": "a row's deletion is its area's own by the row's kind: four actions",
  "POST /api/agent/flows":
    "Juan's editor saves the whole flow with its draft and answers its detail",
  "PUT /api/agent/flows/:id":
    "Juan's editor saves the whole flow with its draft and answers its detail",
  "PUT /api/agent/flows/:id/enabled":
    "the flows service keeps what it switched for a run's Undo; a route has no run, and it answers the flow's detail",
  "DELETE /api/agent/flows/:id":
    "the flows service keeps what it deleted for a run's Undo; a route has no run",
  "POST /api/agent/flows/:id/run":
    "it starts a live run the app follows (its stream), not the action's answer",
  "POST /api/agent/chats":
    "a page's chat is saved as a flow by the chat's editor, with its own answer",
  "PUT /api/agent/chats/:id":
    "a page's chat is saved as a flow by the chat's editor, with its own answer",
  "POST /api/agent/press":
    "a page's button runs what it is set to do: one of four actions, chosen by the button",
  "POST /api/apply":
    "Boni Calendar's batch of changes, with its version: many creates, updates and deletes",
  "PUT /api/collections/reminders":
    "it also clears the reminders (null) and maps the event column, which the action does not",
  "POST /api/v1/actions": "the money screen's movement (v1), with its own answer and Undo there",
  "PUT /api/mail":
    "it also sets the mailbox's server, user and password, which are only Juan's (A-05)",
  "POST /api/mail/check": "it answers the mailbox's whole state the settings repaint",
  "POST /api/mail/reread": "it answers what the rereading found, day by day",
  "PUT /api/mail/guide": "it takes the guide's every part (the action, only its instructions)",
  "POST /api/mail/review": "it answers the mailbox's whole state the settings repaint",
  "POST /api/mail/suggestion": "it says whether Juan changed the suggestion before taking it",
  "POST /api/mail/propose":
    "it answers what came of it (proposals, already, decided) and may read again",
  "PUT /api/agent/extensions/:id":
    "by id, and switching to what it already is is fine here (the action refuses it)",
  "PUT /api/data/types/:type/row-ui":
    "the table saves all its tabs at once (the action, one tab by name)",
};

/**
 * A route names a collection and a field by id; an action, by the name it has in its arguments (what the models
 * write): the one for the other, or the id as it came (the action then answers that there is none).
 */
export function argNames(store: UserStore): {
  type: (id: string) => string;
  field: (id: string) => string;
} {
  const types = Object.values(store.schema().types);
  return {
    type: (id) => {
      const t = store.schema().types[id];
      return t ? typeName(t) : id;
    },
    field: (id) => {
      for (const t of types) {
        const f = t.fields.find((x) => x.id === id);
        if (f) return fieldName(f);
      }
      return id;
    },
  };
}

/**
 * The MCP's tools that are actions and still run the MCP's own code after the policy decides them (with the real
 * arguments, P24), not the action's `def.run`: why. The rest of task 95's first point (docs/sistema.md §4.1).
 */
export const MCP_MODULES: Readonly<Record<string, string>> = {
  guide: "it answers Juan's instructions, his collections and the tools in one, for an assistant",
  collections: "it answers each collection with what goes in it, in the MCP's own words",
  search: "it answers notes with their snippets, cut for an assistant",
  query: "it answers rows in the MCP's own shape, and counts and sums (two actions in one)",
  read: "it reads a note by id or by its collection and title, with its text whole",
  origin: "it says where a note came from in the MCP's own words",
  inbox: "it answers the Bandeja's cards with their day, in the MCP's own words",
  create:
    "the MCP's writer names properties by their names, makes an option that is missing and links by title, as an assistant; the core's refuses those",
  upload_file: "it receives the file's bytes and makes the note that keeps them",
  edit: "it changes a note's text by replacing a piece of it, which no action does",
  append: "it adds to a note's text at its end, which no action does",
  set_properties:
    "the MCP's writer names properties by their names, makes an option that is missing and links by title; the core's refuses those",
  trash: "it takes the note by id or by its collection and title, and says what went",
  set_description: "it changes only a collection's description, by its name",
  create_collection:
    "it makes a collection with its fields in one call: schema.create_type and schema.add_field",
  finanzas_import: "the money's import: many movements read from a bank's file, with their rules",
  finanzas_close: "the money's month closed: many movements updated at once",
  flows_propose: "it saves a flow as a proposal Juan accepts in Boni, never on",
  flows_test: "it tries a flow dry through Boni's own «Probar», which answers its decisions",
  flows_runs: "it answers a flow's runs in the MCP's own words, codes and no texts",
};

/** Juan's words, typed on his device: what a route's arguments are labelled as for the policy. */
const handLabel = (device: string): Label =>
  label("user", "personal", [{ kind: "user-edit", id: `device:${device}` }]);

/** The store as Juan's own hand reads it: all of it (the models' view hides what is closed to them). */
export function handStore(store: UserStore): ReadStore {
  return {
    schema: () => store.schema(),
    get: (id) => store.get(id),
    list: (type, o) => store.list(type, { deep: !!o?.deep }),
    search: (text, o) => store.search(text, o),
  };
}

/**
 * A route's one path to its action (`ROUTE_RUNS`, docs/sistema.md §4.1, P25): the policy decides it with the real
 * arguments, labelled as Juan's, and then the action itself runs, writing as Juan from his device. What it answers,
 * or the policy's refusal, or the action's error code (the route words each one as it always did).
 */
export async function runAction(
  name: string,
  args: Readonly<Record<string, unknown>>,
  hand: { store: UserStore; trust: Trust; device: string; registry?: ToolRegistry },
): Promise<{ out: unknown } | { refused: string } | { error: string }> {
  const def = (hand.registry ?? ACTIONS).get(name);
  const typed = handLabel(hand.device);
  const vals: Record<string, Val> = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined) vals[k] = leaf(v as never, typed);
  const d = decide(
    { tool: def, args: vals, control: null },
    { kind: "hand", trust: hand.trust, device: hand.device },
    { writes: 0, sensitiveReads: 0 },
  );
  if (d.kind !== "allow" || !def) return { refused: d.rule };
  const meta = { actor: "user" as const, device: hand.device };
  try {
    const out = await def.run(
      { store: handStore(hand.store), service: { store: hand.store, meta } } as never,
      vals,
      typed,
    );
    return { out: plain(out) };
  } catch (e) {
    if (e instanceof ToolError) return { error: e.code };
    throw e;
  }
}

/**
 * «Solo él, en su sitio» (docs/sistema.md §4.1): what no model may do at all, not even prepared for his touch. The
 * AI may take him there («te abro su página para que la desbloquees»), never do it.
 */
export const JUAN_ONLY: Readonly<Record<string, string>> = {
  "POST /api/login": "entrar es de Juan",
  "POST /api/logout": "salir es de Juan",
  "POST /api/v1/login": "entrar es de Juan",
  "POST /api/v1/logout": "salir es de Juan",
  "PUT /api/push": "sus dispositivos",
  "DELETE /api/push": "sus dispositivos",
  "PUT /api/agent/visibility/:type": "el nivel de una colección para la IA (A-04)",
  "POST /api/data/types/:type/rules": "el nivel de una parte de una colección para la IA (A-04)",
  "PUT /api/data/rules/:id": "el nivel de una parte de una colección para la IA (A-04)",
  "DELETE /api/data/rules/:id": "el nivel de una parte de una colección para la IA (A-04)",
  "PUT /api/data/types/:type/protection": "la zona peligrosa (A-05)",
  "PUT /api/agent/models/keys/:connection": "las claves (A-05)",
  "PUT /api/agent/models/roles/:role": "qué modelos usa la IA",
  "PUT /api/agent/models/budget": "lo que la IA puede gastar (P13)",
  "POST /api/agent/models/evaluate": "gasta su presupuesto en modelos",
  "PUT /api/data/audit/settings": "la auditoría que vigila a la IA",
  "PUT /api/agent/decisions/:area": "lo que Boni hace solo (docs/fiabilidad.md)",
  "PUT /api/agent/learning": "lo que Boni aprende solo (D-54)",
  "PUT /api/account/externals": "sus calendarios de fuera: su dirección es su clave (A-05)",
  "POST /api/mail/forget": "la cuenta de correo, su servidor y su contraseña (A-05)",
  "POST /api/agent/extensions/:id/activate":
    "una versión de una extensión se acepta viendo su código, en Ajustes (P16)",
  "POST /api/agent/extensions/:id/reject":
    "una versión de una extensión se acepta viendo su código, en Ajustes (P16)",
  "POST /api/agent/extensions/:id/revert":
    "una versión de una extensión se acepta viendo su código, en Ajustes (P16)",
  "DELETE /api/agent/conversations/:id": "lo que dijo en una conversación lo borra él",
};

/** A route that changes something and is no action: how an action is asked, confirmed or computed. */
export const NOT_ACTIONS: Readonly<Record<string, string>> = {
  "POST /api/agent/turn":
    "the conversation: how the planner is asked (a corrected message takes its turn back, as its «Deshacer»)",
  "POST /api/agent/answer": "the conversation: Juan answers a question of a turn",
  "POST /api/agent/confirm": "the conversation: Juan's touch on a card",
  "POST /api/agent/decline": "the conversation: Juan's touch on a card",
  "POST /api/agent/live/:id/stop": "the conversation: «Parar» a turn",
  "POST /api/agent/requests/:id/answer": "a flow's question, answered",
  "POST /api/agent/requests/:id/dismiss": "a flow's question, set aside",
  "POST /api/agent/flows/check": "checks a flow, changes nothing",
  "POST /api/agent/flows/:id/test": "«Probar» a flow (flows.test): it runs dry, changes nothing",
  // A flow's draft (task 80): what Juan changes in his editor, kept as he changes it; «Guardar» is `flows.save`. No
  // model writes it (what the user changes, the AI only proposes, D-41), and nothing runs it.
  "PUT /api/agent/flows/:id/draft":
    "the flow editor keeps Juan's unsaved changes (its draft): nothing runs it; «Guardar» is flows.save",
  "DELETE /api/agent/flows/:id/draft":
    "«Descartar» in the flow editor: Juan's unsaved changes dropped, the flow as it was saved",
  "POST /api/data/files": "a file's bytes from Juan's device: no model has them",
  "POST /api/data/files/upload": "a file's bytes from Juan's device: no model has them",
  "POST /api/v1/charts/preview": "computes a chart, changes nothing",
  "POST /api/data/blocks": "computes a page's numbers, changes nothing",
  "POST /api/data/blocks/rows": "computes the rows a number counts, changes nothing",
  "POST /api/mcp": "the MCP: one more way to the actions",
  "POST /api/agent/conversations": "the conversation: a new one is where Juan asks",
  "PUT /api/agent/conversations/:id":
    "the conversation itself: its name, its pin and the model that answers in it",
  "POST /api/collections/link-column":
    "made with «Enlazar» when Juan accepts a card linked to an external event (inbox.accept, task 50)",
  "PUT /api/account/prefs":
    "how Boni Calendar shows itself on his devices (a screen's own, docs/sistema.md §4.7)",
  // Boni's first screens (v1, the transition): their charts, shortcuts and widgets are how the money screen is laid
  // out; the AI draws a chart on a page (pages.add_block).
  "POST /api/v1/charts": "the money screen's layout (v1); the AI's charts go on pages",
  "PUT /api/v1/charts/order": "the money screen's layout (v1); the AI's charts go on pages",
  "PUT /api/v1/charts/:id": "the money screen's layout (v1); the AI's charts go on pages",
  "DELETE /api/v1/charts/:id": "the money screen's layout (v1); the AI's charts go on pages",
  "POST /api/v1/shortcuts": "the money screen's layout (v1)",
  "PUT /api/v1/shortcuts/order": "the money screen's layout (v1)",
  "PUT /api/v1/shortcuts/:id": "the money screen's layout (v1)",
  "DELETE /api/v1/shortcuts/:id": "the money screen's layout (v1)",
  "POST /api/v1/widgets": "the money screen's layout (v1)",
  "PUT /api/v1/widgets/:id": "the money screen's layout (v1)",
  "DELETE /api/v1/widgets/:id": "the money screen's layout (v1)",
};

/**
 * Each action's tool in Boni's MCP, or why it has none: Juan's touch needs his card, which an assistant cannot
 * paint; Boni's own pieces and an extension's steps run only in a flow (A-19), which the MCP proposes with
 * `flows_propose`.
 */
export const ACTION_MCP: Readonly<Record<string, string | { why: string }>> = {
  "entities.query": "query",
  "entities.get": "read",
  "entities.origin": "origin",
  "inbox.pending": "inbox",
  "inbox.accept": { why: "Juan's touch: his card, in his app" },
  "inbox.reject": { why: "Juan's touch: his card, in his app" },
  "entities.aggregate": "query",
  "entities.search": "search",
  "schema.describe": "collections",
  "entities.create": "create",
  "entities.update": "set_properties",
  "entities.delete": "trash",
  "schema.create_type": "create_collection",
  "schema.add_field": {
    why: "an assistant gives a collection its properties when it makes it (create_collection)",
  },
  "schema.rename_type": "rename_collection",
  "schema.move_type": "move_collection",
  "schema.update_field": "change_property",
  "schema.delete_type": { why: "deleting is Juan's touch: his card, in his app" },
  "schema.remove_field": { why: "deleting is Juan's touch: his card, in his app" },
  "entities.move": "move_note",
  "flows.enable": { why: "Juan's touch: his card, in his app (P21)" },
  "flows.delete": { why: "deleting is Juan's touch: his card, in his app" },
  "flows.test": "flows_test",
  "flows.runs": "flows_runs",
  "files.read": {
    why: "a file Juan drops is read in his own turn, from his screen (P23): an assistant has no screen of his",
  },
  "screen.open": {
    why: "Juan's screen is his app's: an assistant has its own chat, not his screen (P22)",
  },
  "screen.scroll": {
    why: "Juan's screen is his app's: an assistant has its own chat, not his screen (P22)",
  },
  "screen.highlight": {
    why: "Juan's screen is his app's: an assistant has its own chat, not his screen (P22)",
  },
  "screen.filter": {
    why: "Juan's screen is his app's: an assistant has its own chat, not his screen (P22)",
  },
  "inbox.correct": { why: "Juan's touch: his card, in his app (P21)" },
  "memory.save": { why: "an assistant writes Juan's instructions with edit (guide)" },
  "flows.run": { why: "Juan's touch: his card, in his app (P8)" },
  "flows.save": "flows_propose",
  notify: { why: "Boni tells Juan; an assistant answers in its own chat" },
  "pages.create": "pages_create",
  "pages.add_block": "pages_add_block",
  "pages.set_view": "pages_set_view",
  "pages.set_value": "pages_set_value",
  "pages.figures": {
    why: "a page's numbers are its chat's to read in Juan's turn; an assistant counts the same rows with query",
  },
  "pages.update": "pages_update",
  "pages.delete": { why: "deleting is Juan's touch: his card, in his app" },
  "calendars.list": "calendars",
  "calendars.add": "calendars_add",
  "calendars.remove": { why: "taking a calendar away is Juan's card, in his app (P5)" },
  "calendars.split": "calendars_split",
  "calendars.color": "calendars_color",
  "calendars.reminders": "calendars_reminders",
  "schema.set_view": "collection_view",
  "schema.set_tree": "notes_in_tree",
  "connectors.mail_view": { why: "an assistant reads the mail Boni brought with query" },
  "connectors.mail": { why: "Juan's touch: his card, in his app (P21)" },
  "connectors.mail_guide": { why: "Juan's touch: his card, in his app (P21)" },
  "connectors.mail_suggestion": { why: "Juan's touch: his card, in his app (P21)" },
  "connectors.mail_check": {
    why: "Boni brings the mail every few minutes; an assistant reads it with query",
  },
  "connectors.mail_propose": {
    why: "Boni's own models read mail for the Bandeja, on its budget, from Juan's turn",
  },
  "connectors.mail_reread": {
    why: "Boni's own models read mail again on its budget: his card, in his app",
  },
  "connectors.mail_review": { why: "Boni's own reviewer, on its budget, from Juan's turn" },
  "extensions.enable": { why: "Juan's touch: his card, in his app (P21)" },
};
/** The areas whose actions run only inside a flow (A-19): their control is «Añadir paso», and no MCP tool. */
export const FLOW_ONLY_AREAS: readonly string[] = ["boni", "extensions"];
/**
 * Whether an action runs only inside a flow: Boni's pieces and an extension's steps. Juan's touch on an extension
 * (switching it on or off) is his, in Ajustes, not a step.
 */
export const flowOnly = (t: Pick<ToolDef, "area" | "effect">): boolean =>
  FLOW_ONLY_AREAS.includes(t.area) && t.effect !== "touch";
