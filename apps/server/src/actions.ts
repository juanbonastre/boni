import { coreTools, type ToolDef, type ToolRegistry } from "@boni/agent";
import { withCalendarActions } from "./calendarActions.ts";
import { withConnectorActions } from "./connectorActions.ts";
import { withDataActions } from "./dataActions.ts";
import { withFileActions } from "./fileActions.ts";
import { withFlowActions } from "./flowActions.ts";
import { withFunctionSteps } from "./functionSteps.ts";
import { withInboxActions } from "./inboxActions.ts";
import { withPageActions } from "./pageActions.ts";
import { withPieces } from "./pieces.ts";

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
  return withConnectorActions(
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

/** A route that is the Undo of actions (each action says how it is undone, docs/sistema.md §4.1). */
export const UNDO_ROUTES: Readonly<Record<string, readonly string[]>> = {
  // The run's operations, and what it changed beside the log (runUndo.ts, AgentHost.undoKept): what it switched or
  // deleted in «Flujos», a calendar's definition, a collection's tabs or tree, the mail's settings and guide.
  "POST /api/agent/runs/:id/undo": [
    "pages.create",
    "pages.add_block",
    "pages.set_view",
    "pages.set_value",
    "pages.update",
    "entities.create",
    "entities.update",
    "entities.move",
    "schema.create_type",
    "schema.add_field",
    "schema.rename_type",
    "schema.move_type",
    "schema.update_field",
    "schema.delete_type",
    "schema.remove_field",
    "flows.enable",
    "flows.delete",
    "calendars.add",
    "calendars.remove",
    "calendars.split",
    "calendars.color",
    "calendars.reminders",
    "schema.set_view",
    "schema.set_tree",
    "connectors.mail",
    "connectors.mail_guide",
    "connectors.mail_suggestion",
    "extensions.enable",
  ],
  // A movement of the money screen, taken back there.
  "DELETE /api/v1/actions/:id": ["entities.create"],
  "POST /api/pages/:id/restore": ["pages.delete"],
  "POST /api/data/rows/:id/restore": ["entities.delete", "schema.delete_type", "flows.delete"],
  "POST /api/data/types/:type/fields/:field/restore": ["schema.remove_field"],
  "POST /api/agent/flows/:id/revert": ["flows.save"],
  "POST /api/agent/proposals/:id/restore": ["inbox.accept", "inbox.reject"],
};

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
