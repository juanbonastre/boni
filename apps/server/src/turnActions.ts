// The conversation's own action (docs/conversacion.md §3.1, C1): taking back what an earlier turn did, as editing its message does.
import {
  codeLabel,
  leaf,
  plain,
  type ReadStore,
  rec,
  ToolError,
  type ToolRegistry,
  UNDO_TURN,
  type Val,
} from "@boni/agent";

/**
 * What `turns.undo` runs on, for one run (the server's, `AgentHost`): a turn of the run's own conversation, by its run.
 * `undo` is the same path as Juan's pencil on his message (POST /api/agent/turn with `corrects`): what it changed
 * beside the log is asked first, then the store's log is undone, all or nothing, and the turn is marked corrected.
 * All of it is the asking run's (task 120): if its plan stops after, undoing that run brings the turn back as it was.
 */
export interface TurnsService {
  /** What that turn's message said, or null when it is not a turn of this conversation. */
  said(run: string): string | null;
  /** Takes it back: how many things, or why not (nothing is done then). */
  undo(run: string): number | "not-found" | "corrected" | "busy" | "cannot-undo";
}

const serviceOf = (s: unknown): TurnsService => {
  if (!s || typeof s !== "object" || !("undo" in s)) throw new ToolError("not-available");
  return s as TurnsService;
};
/** A turn as the code bound it (`$history[i].turn`): the code's own value, never an id a model wrote. */
const runOf = (v: Val | undefined): string => {
  if (v?.t !== "v" || v.label.integrity !== "own" || typeof v.value !== "string" || !v.value)
    throw new ToolError("turn-not-from-history");
  return v.value;
};
const code = codeLabel("conversation");

export function withTurnActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: UNDO_TURN,
    icon: "RotateCcw",
    // Juan's touch (P21): it takes back what was done for him, so he says yes on a card, in his own turn only.
    effect: "touch",
    area: "boni",
    service: "turns",
    title: "Deshacer lo que hizo",
    undo: {
      none: "what it took back, Juan says again in his next words: his turn is redone with them",
    },
    describe:
      'Take back what an earlier turn of this conversation did, when the user says it was wrong («antes te he dicho X, pero es Y»): all of it or nothing, as editing his message does; then do what that turn asked with the right words. Its turn: {"ref": "$history[i].turn"}. The user confirms it on a card',
    args: {
      turn: {
        role: "target",
        required: true,
        describe: 'the earlier turn, as {"ref": "$history[i].turn"} (i its place in "history")',
      },
    },
    names(c: { store: ReadStore; service?: unknown }, a): Record<string, string> {
      const run = plain(a.turn as Val);
      const said = typeof run === "string" && c.service ? serviceOf(c.service).said(run) : null;
      return said ? { turn: said } : {};
    },
    run(c, a) {
      const run = runOf(a.turn);
      const back = serviceOf(c.service).undo(run);
      if (typeof back === "string") throw new ToolError(back);
      return rec({ turn: leaf(run, code), undone: leaf(back, code) }, code);
    },
  });
  return r;
}
