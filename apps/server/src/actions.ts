import { coreTools, type ToolRegistry } from "@boni/agent";
import { withDataActions } from "./dataActions.ts";
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
  return withInboxActions(
    withFlowActions(withDataActions(withPageActions(withFunctionSteps(withPieces(coreTools()))))),
  );
}

/** A route that changes something, and the actions it runs: the same code as the action's (its area's module). */
export const ROUTE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  "POST /api/pages": ["pages.create"],
  // The editor saves the whole page: what «/» adds, a table's view, its name, icon and place.
  "PUT /api/pages/:id": ["pages.update", "pages.add_block", "pages.set_view"],
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
  "POST /api/data/types/:type/fields": ["schema.add_field"],
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
};

/** A route that is the Undo of actions (each action says how it is undone, docs/sistema.md §4.1). */
export const UNDO_ROUTES: Readonly<Record<string, readonly string[]>> = {
  // The run's operations, and what it switched or deleted in «Flujos» (AgentHost.undoFlows).
  "POST /api/agent/runs/:id/undo": [
    "pages.create",
    "pages.add_block",
    "pages.set_view",
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
  ],
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
};

/** A route that changes something and is no action: how an action is asked, confirmed or computed. */
export const NOT_ACTIONS: Readonly<Record<string, string>> = {
  "POST /api/agent/turn": "the conversation: how the planner is asked",
  "POST /api/agent/answer": "the conversation: Juan answers a question of a turn",
  "POST /api/agent/confirm": "the conversation: Juan's touch on a card",
  "POST /api/agent/decline": "the conversation: Juan's touch on a card",
  "POST /api/agent/live/:id/stop": "the conversation: «Parar» a turn",
  "POST /api/agent/requests/:id/answer": "a flow's question, answered",
  "POST /api/agent/requests/:id/dismiss": "a flow's question, set aside",
  "POST /api/agent/flows/check": "checks a flow, changes nothing",
  "POST /api/agent/flows/:id/test": "«Probar» a flow (flows.test): it runs dry, changes nothing",
  "POST /api/data/files": "a file's bytes from Juan's device: no model has them",
  "POST /api/v1/charts/preview": "computes a chart, changes nothing",
  "POST /api/data/blocks": "computes a page's numbers, changes nothing",
  "POST /api/data/blocks/rows": "computes the rows a number counts, changes nothing",
  "POST /api/mcp": "the MCP: one more way to the actions",
};

/**
 * The routes not yet on an action (F10 goes by areas: calendars, connectors, conversations next; a collection's saved
 * views and its notes-in-tree display, with the pages' saved views). This list may only
 * shrink: a route that gets its action leaves it, and a new route never enters it (`actions.test.ts`).
 */
export const NOT_YET: readonly string[] = [
  "POST /api/apply",
  "PUT /api/account/prefs",
  "PUT /api/account/externals",
  "PUT /api/collections/reminders",
  "POST /api/collections/add",
  "POST /api/collections/remove",
  "POST /api/collections/split",
  "POST /api/collections/color",
  "POST /api/collections/link-column",
  "POST /api/v1/actions",
  "DELETE /api/v1/actions/:id",
  "POST /api/v1/charts",
  "PUT /api/v1/charts/order",
  "PUT /api/v1/charts/:id",
  "DELETE /api/v1/charts/:id",
  "POST /api/v1/shortcuts",
  "PUT /api/v1/shortcuts/order",
  "PUT /api/v1/shortcuts/:id",
  "DELETE /api/v1/shortcuts/:id",
  "POST /api/v1/widgets",
  "PUT /api/v1/widgets/:id",
  "DELETE /api/v1/widgets/:id",
  "POST /api/agent/conversations",
  "PUT /api/agent/conversations/:id",
  "DELETE /api/agent/conversations/:id",
  "PUT /api/agent/extensions/:id",
  "POST /api/agent/extensions/:id/activate",
  "POST /api/agent/extensions/:id/reject",
  "POST /api/agent/extensions/:id/revert",
  "PUT /api/mail",
  "POST /api/mail/check",
  "POST /api/mail/reread",
  "PUT /api/mail/guide",
  "POST /api/mail/review",
  "POST /api/mail/suggestion",
  "POST /api/mail/propose",
  "POST /api/mail/forget",
  "PUT /api/data/types/:type/row-ui",
  "PUT /api/data/types/:type/tree",
];

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
  "inbox.correct": { why: "Juan's touch: his card, in his app (P21)" },
  "memory.save": { why: "an assistant writes Juan's instructions with edit (guide)" },
  "flows.run": { why: "Juan's touch: his card, in his app (P8)" },
  "flows.save": "flows_propose",
  notify: { why: "Boni tells Juan; an assistant answers in its own chat" },
  "pages.create": "pages_create",
  "pages.add_block": "pages_add_block",
  "pages.set_view": "pages_set_view",
  "pages.update": "pages_update",
  "pages.delete": { why: "deleting is Juan's touch: his card, in his app" },
};
/** The areas whose actions run only inside a flow (A-19): their control is «Añadir paso», and no MCP tool. */
export const FLOW_ONLY_AREAS: readonly string[] = ["boni", "extensions"];

/**
 * The actions with no control of their own in the app yet (F10 goes by areas): this list may only shrink. A control
 * says which action it runs with `data-boni-action` (or a menu row's `boniAction`), which Boni over the screen
 * points at too.
 */
export const NO_CONTROL_YET: readonly string[] = ["memory.save"];
