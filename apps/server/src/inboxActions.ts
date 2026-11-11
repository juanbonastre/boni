import {
  codeLabel,
  deepLabel,
  leaf,
  neutralize,
  plain,
  ToolError,
  type ToolRegistry,
  typeByKey,
  type Val,
} from "@boni/agent";

/**
 * Correcting a proposal of the Bandeja (docs/sistema.md §4.1, F10): accepting it with another title or in another
 * collection, as Juan's «Corregir» does before «Aceptar». It is his touch (P21), as accepting is: the AI prepares it
 * in his turn, the card names the proposal by its title, and he confirms it. The same code as the route
 * (agent.ts `acceptCorrected`): his corrections are kept, and Undo of the acceptance is the Bandeja's.
 */

/** What the server gives the action (`ToolDef.service` "inbox"). */
export interface InboxService {
  /** `collection`: the collection's id, as the route takes it. */
  correct(proposal: string, edits: { title?: string; collection?: string }): Promise<unknown>;
}
const serviceOf = (s: unknown): InboxService => {
  if (!s || typeof s !== "object" || !("correct" in s)) throw new ToolError("not-available");
  return s as InboxService;
};

export function withInboxActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "inbox.correct",
    effect: "touch",
    area: "inbox",
    service: "inbox",
    title: "Corregir y aceptar",
    describe:
      "Accept one proposal of Juan's inbox (Bandeja) corrected, as «Corregir» then «Aceptar» do: another title, or into another collection (its key). Juan confirms it on a card",
    args: {
      proposal: {
        role: "proposal",
        required: true,
        describe: 'the proposal, by its id as "inbox.pending" gives it',
      },
      title: { role: "content", describe: "its corrected title" },
      collection: { role: "type", describe: "the collection it goes to instead" },
    },
    async run(c, a) {
      const id = a.proposal ? plain(a.proposal) : null;
      if (typeof id !== "string") throw new ToolError("bad-argument");
      const edits: { title?: string; collection?: string } = {};
      const title = a.title ? plain(a.title) : null;
      if (typeof title === "string" && title.trim()) {
        const t = title.trim().slice(0, 200);
        const l = deepLabel(a.title as Val);
        edits.title = l.integrity === "model" || l.integrity === "external" ? neutralize(t) : t;
      }
      const to = a.collection ? plain(a.collection) : null;
      // A collection the models may not see is not found.
      if (typeof to === "string") edits.collection = typeByKey(c.store, to).id;
      if (!Object.keys(edits).length) throw new ToolError("bad-argument");
      return leaf((await serviceOf(c.service).correct(id, edits)) as never, codeLabel("inbox"));
    },
  });
  return r;
}
