/**
 * A page's button pressed (docs/sistema.md §4.6 points 4 and 5, D-60): the server reads the button and the values it
 * passes from the saved page (never from what the app says), and runs what it names as a turn of Juan's: an action of
 * the one list as a plan of one call, or a flow by hand with its form filled (its trigger is «Botón», `manual`). The
 * policy decides it as that action (its confirmation, its Undo); what it passes carries the label of whoever wrote
 * the page last (Juan's when his device or Boni's code did, the model's when a run did).
 */
import { conversation, fieldName, leaf, rec, runnableNames, typeName, type Val } from "@boni/agent";
import { atLeast, type FieldDef, type Label, label, type TypeDef } from "@boni/entities";
import type { UserStore } from "@boni/store";
import {
  BUTTON_ACTIONS,
  type ButtonArg,
  type ButtonBlock,
  buttonDoes,
  buttonValues,
  type ControlBlock,
  controlsOf,
  RECORD_ACTIONS,
  VALUE_ACTIONS,
} from "@boni/views";
import type { AgentHost } from "./agent.ts";
import { getPage } from "./pages.ts";

type Who = { account: number; device: string; trust: "personal" | "shared" | "ambient" };
type Out = { status: number; body: unknown };
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const LIVE = /^[A-Za-z0-9-]{8,80}$/;

/** The label of what a page passes: the user's when he (or Boni's code) wrote the page last, else its writer's. */
function passLabel(store: UserStore, page: string): Label {
  const l = store.get(page)?.labels.f_spec;
  return l && atLeast(l, "own")
    ? label("user", "personal", [{ kind: "user-edit", id: `page:${page}` }])
    : (l ?? label("model", "personal", [{ kind: "code", id: "pages" }]));
}

/** A record's title, as a flow's form takes it (the text a person would type). */
function titleOf(store: UserStore, id: string): string | null {
  const s = store.get(id);
  if (!s || s.entity.deleted !== undefined) return null;
  const def = store.schema().types[s.entity.type];
  const v = def ? s.entity.values[def.titleField] : undefined;
  return typeof v === "string" ? v : null;
}

/** What a control holds, as text for a flow's form: an option's name, a record's title, a month, a number. */
function asText(store: UserStore, v: ButtonArg, c: ControlBlock | undefined): string | null {
  if (c?.kind === "option" && typeof v === "string") {
    const f = c.collection
      ? store.schema().types[c.collection]?.fields.find((x) => x.id === c.field)
      : undefined;
    if (f?.type === "relation") return titleOf(store, v);
    const o = f?.options?.find((x) => x.id === v);
    if (o) return o.name;
  }
  return String(v);
}

/** A value of the button as a field of the record takes it; null when it cannot be one. */
function asField(f: FieldDef, v: ButtonArg): unknown {
  switch (f.type) {
    case "number":
    case "duration": {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    case "money": {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      // The same default the store's other writers give an amount that names no currency (calendarStore.ts).
      return Number.isFinite(n) ? { amount: n, currency: "EUR" } : null;
    }
    case "checkbox":
      return typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : null;
    case "multiselect":
      return [String(v)];
    case "relation":
      return f.relation?.many ? [String(v)] : String(v);
    default:
      return typeof v === "boolean" ? null : String(v);
  }
}

export async function pressButton(host: AgentHost, who: Who, raw: unknown): Promise<Out> {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (
    typeof b.page !== "string" ||
    !ID.test(b.page) ||
    typeof b.block !== "string" ||
    !ID.test(b.block)
  )
    return { status: 400, body: { error: "bad-request" } };
  if (!host.onFor(who.account)) return { status: 503, body: { error: "agent-off" } };
  const store = host.store(who.account);
  const page = getPage(store, b.page);
  const button = page?.spec.blocks.find((x) => x.id === b.block);
  if (!page || !button) return { status: 404, body: { error: "not-found" } };
  if (button.type !== "action") return { status: 409, body: { error: "not-a-button" } };
  const does = buttonDoes(button);
  if (does !== "action" && does !== "flow") return { status: 409, body: { error: "not-run-here" } };
  const controls = controlsOf(page.spec.blocks);
  const said = passLabel(store, page.id);
  const asked =
    typeof b.conversation === "string" && ID.test(b.conversation) ? b.conversation : null;
  const c = asked ? conversation(store, asked) : null;
  const live = typeof b.live === "string" && LIVE.test(b.live) ? b.live : null;
  const base = {
    text: `«${button.label}»`,
    origin: { kind: "turn" as const, trust: who.trust, device: who.device },
    ...(c ? { conversation: c.id } : {}),
    ...(live ? { live: host.liveStart(who.account, live) } : {}),
  };
  const run =
    does === "flow"
      ? flowTurn(store, button, controls, said)
      : actionTurn(store, button, controls, said);
  if ("error" in run) return { status: 409, body: run };
  const r = await host.agent(who.account).turn({ ...base, ...run });
  if (r.proposals.length) host.emit(who.account, "proposals", { n: r.proposals.length });
  return { status: 200, body: r };
}

/** A flow by hand, as «Ejecutar» runs it (agent.ts), its form filled with what the button passes. */
function flowTurn(
  store: UserStore,
  button: ButtonBlock,
  controls: readonly ControlBlock[],
  said: Label,
) {
  const f = button.flow ? store.journal.flow(button.flow) : null;
  if (!f) return { error: "no-flow" } as const;
  const names = runnableNames(f.trigger);
  if (!names || names.includes("today")) return { error: "not-manual" } as const;
  const { values, from } = buttonValues(button.inputs, controls);
  const bind: Record<string, Val> = {};
  for (const n of names) {
    const v = values[n];
    const text =
      v === undefined || v === null
        ? ""
        : asText(
            store,
            v,
            controls.find((x) => x.id === from[n]),
          );
    bind[n] = leaf((text ?? "").slice(0, 2000), said);
  }
  return { flow: { id: f.id, version: f.version, by: f.by, plan: f.plan, bind } };
}

/** An action of the list as a plan of one call: its collection, the record a control holds, the values it sets. */
function actionTurn(
  store: UserStore,
  button: ButtonBlock,
  controls: readonly ControlBlock[],
  said: Label,
) {
  const tool = button.action;
  // Only the actions a button may run, whatever a page saved some other way says (D-60).
  if (!tool || !(BUTTON_ACTIONS as readonly string[]).includes(tool))
    return { error: "no-action" } as const;
  const def: TypeDef | undefined = button.collection
    ? store.schema().types[button.collection]
    : undefined;
  if (!def || def.system || def.archived) return { error: "no-collection" } as const;
  const args: Record<string, unknown> = {};
  const bind: Record<string, Val> = {};
  if (RECORD_ACTIONS.includes(tool)) {
    const id = buttonValues({ record: button.record ?? "" }, controls).values.record;
    if (typeof id !== "string" || !id) return { error: "empty-value", key: "record" } as const;
    const s = store.get(id);
    if (!s || s.entity.deleted !== undefined || s.entity.type !== def.id)
      return { error: "no-record" } as const;
    bind.record = leaf(id, said);
    args.id = { ref: "$record" };
  } else args.type = { lit: typeName(def) };
  if (VALUE_ACTIONS.includes(tool)) {
    const fields: Record<string, Val> = {};
    for (const [k, v] of Object.entries(buttonValues(button.set, controls).values)) {
      const f = def.fields.find((x) => x.id === k && !x.archived);
      if (!f) return { error: "no-field", key: k } as const;
      // A control that holds nothing, or a value left empty, leaves its field as it is (or empty, for a new record).
      if (v === null || v === "") continue;
      const value = asField(f, v);
      if (value === null) return { error: "bad-value", key: k } as const;
      fields[fieldName(f)] = leaf(value as never, said);
    }
    if (!Object.keys(fields).length && tool === "entities.update")
      return { error: "empty-value", key: "set" } as const;
    bind.values = rec(fields, said);
    args.values = { ref: "$values" };
  }
  return {
    button: {
      plan: { version: 1, steps: [{ id: "s1", op: "call", tool, args }] },
      bind,
      lit: said,
    },
  };
}
