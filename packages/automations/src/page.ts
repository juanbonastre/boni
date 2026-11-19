/**
 * «Esta página» (docs/automatizaciones.md AU-137, phase F16): what the «Agente» of a page's chat may do on the page the
 * chat lives in, as the chat of before did (`packages/agent/src/chat.ts`): read its figures (computed by code, D-62),
 * put a value in one of its controls and add a block. It exists only under «Mensaje de chat», and the page is never
 * the model's nor the message's: it is the one the stored version's trigger names, which the server binds the port to
 * (`PagePort.page`), and every call goes through `Policy.decide` with it, where P26 refuses any other page.
 */
import type { Label } from "@boni/entities";
import { BONI_TRIGGERS } from "./boni.ts";
import type { Automation } from "./format.ts";
import type { Cell } from "./rows.ts";

/** The three things «Esta página» lets an «Agente» do, the old chat's `pages.figures`, `pages.set_value`, `pages.add_block`. */
export const PAGE_ABILITIES = ["figures", "value", "block"] as const;
export type PageAbility = (typeof PAGE_ABILITIES)[number];

/**
 * The tools the plan calls each by, offered as the step's code tools are (`AgentCall.codeTools`): names no code tool
 * may take (`AGENT_TOOLS.taken`). Each takes only these inputs; a page is never one of them.
 */
export const PAGE_TOOLS: Readonly<
  Record<PageAbility, { name: string; inputs: { name: string; type: "text" | "any" }[] }>
> = {
  figures: { name: "pageFigures", inputs: [{ name: "block", type: "text" }] },
  value: {
    name: "pageSetValue",
    inputs: [
      { name: "control", type: "text" },
      { name: "value", type: "any" },
    ],
  },
  block: { name: "pageAddBlock", inputs: [{ name: "block", type: "any" }] },
};

/** The action a page call is judged as (`PolicyCall.action`), by ability. */
export const PAGE_ACTIONS: Readonly<Record<PageAbility, string>> = {
  figures: "page.figures",
  value: "page.value",
  block: "page.block",
};

/** A change of the page an «Agente» asked for: a control's value (null: none), or a block added at its end. */
export type PageChange =
  | { kind: "value"; control: string; value: Cell }
  | { kind: "block"; block: Cell };

/**
 * The page of the chat a run started from, as the server gives it: bound to the page the stored version's «Mensaje
 * de chat» names (`chatPageOf`), never to one a request, a message or a model names. Without it, «Esta página» does
 * not run.
 */
export interface PagePort {
  readonly page: string;
  /** One block's figures as the screen shows them now, with their label (the code's); null: no such block. */
  figures(block: string): Promise<{ value: Cell; label: Label } | null>;
  /**
   * Whether the change can be made on the page as it is now (its control exists, the value is one it holds, the block
   * is one the page can show): null, or why not (`no-such-block`, `bad-value`, `bad-block`…). Nothing is saved.
   */
  check(change: PageChange): Promise<string | null>;
  /**
   * Saves one change of the page, with the label of what it carries, in the run (its Undo takes it back): null, or
   * why it was not saved, as `check` says it.
   */
  apply(change: PageChange, label: Label): Promise<string | null>;
}

/** «Esta página» as the step saves it: a list of distinct abilities; [] when absent; null when it is not one. */
export function pageAbilitiesOf(v: unknown): PageAbility[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out: PageAbility[] = [];
  for (const x of v) {
    if (!(PAGE_ABILITIES as readonly unknown[]).includes(x) || out.includes(x as PageAbility))
      return null;
    out.push(x as PageAbility);
  }
  return out;
}

/** The page the automation's «Mensaje de chat» names as stored; null with no chat trigger or no page. */
export function chatPageOf(a: Automation): string | null {
  const t = a.steps.find((s) => s.type === BONI_TRIGGERS.chat);
  const p = t?.params.page;
  return typeof p === "string" && p ? p : null;
}
