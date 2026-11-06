/**
 * The flow editor (docs/flujos.md, F2): a flow's canvas where the user adds, removes and connects steps (an arrow
 * dragged from one step to another uses its value there), a step's panel with its settings from the catalog, the
 * trigger's panel, the checklist the server computes as he edits, and the flow's actions: save (a version, only with
 * an empty checklist), discard, on or off, try, run by hand, versions, back to Boni's, duplicate, «Ver en el mapa»,
 * delete. The canvas lays itself out (docs/sistema.md §4.4; Juan, 2026-11-05: «Leer correo» opened in a heap): the
 * steps downwards in the order they run, those that run for one choice side by side (`core/flowLayout.ts`), a «+»
 * between two to put one there, and the arrows of the values a step takes drawn only for the step chosen. Nothing of
 * where things are is kept, so moving nothing never asks to save. Everything is the user's from a personal device; a
 * model only proposes flows (D-41). Docs: docs/design-guide.md «Flujos».
 */
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type Connection,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  getSmoothStepPath,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  Braces,
  FlaskConical,
  HelpCircle,
  ListFilter,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FlowCatalog,
  FlowCheck,
  FlowDetailView,
  FlowPlan,
  FlowProblem,
  FlowStep,
  FlowTestView,
  PieceSaid,
  TestStepView,
} from "../core/agent.ts";
import {
  addStep,
  depsOf,
  duplicateStep,
  insertStep,
  type NodeKind,
  newStep,
  planUpTo,
  removeStep,
  slotsOf,
  takeValue,
  typeKeysOf,
} from "../core/flowEdit.ts";
import { segmentsOf, stepLayout } from "../core/flowLayout.ts";
import { useKeptNodes } from "../core/useKeptNodes.ts";
import { agentApi, errorText, runFlowInChat, showMap, toast, useStore } from "../store.ts";
import {
  argName,
  FlowStepPanel,
  inputName,
  problemText,
  stepDetail,
  stepName,
} from "./FlowStepPanel.tsx";
import { MenuRow, MenuSep, PointMenu, PopButton } from "./Popover.tsx";

const WIDTH = 200;
const TRIGGER = "trigger";
type T = (k: string, p?: Record<string, string | number>) => string;

interface Draft {
  name: string;
  trigger: Record<string, unknown>;
  plan: FlowPlan;
}
const draftOf = (d: FlowDetailView): Draft => ({
  name: d.name,
  trigger: d.trigger,
  plan: d.plan,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What starts a flow, in a few words: «Llega a Correo», a schedule, «A mano» (as «Flujos»' «Disparador» says it).
 * `nameOf`: a collection's name by its key, where it is known.
 */
export function triggerText(
  t: T,
  on: Record<string, unknown>,
  nameOf?: (key: string) => string | null | undefined,
): string {
  if (typeof on.created === "string")
    return t("flows.on.created", { what: nameOf?.(on.created) ?? on.created });
  if (on.schedule && typeof on.schedule === "object") {
    const s = on.schedule as { every?: unknown; at?: unknown; day?: unknown };
    const at = typeof s.at === "string" ? s.at : "08:00";
    if (s.every === "hour")
      return at.slice(3) === "00" ? t("flows.on.hour") : t("flows.on.hourAt", { m: at.slice(3) });
    if (s.every === "week")
      return t("flows.on.week", { day: t(`flows.day.${Number(s.day ?? 1)}`), at });
    return t("flows.on.day", { at });
  }
  if (on.manual) return t("flows.on.manual");
  return t("flows.on.other");
}

/** What a trigger gives its plan when it is not a record's: the form's names, or `today` on a schedule. */
const givenNames = (trigger: Record<string, unknown>): string[] =>
  trigger.schedule && typeof trigger.schedule === "object" ? ["today"] : formNames(trigger);

/** The names a manual trigger's form asks for. */
const formNames = (trigger: Record<string, unknown>): string[] =>
  Array.isArray(trigger.inputs)
    ? trigger.inputs.flatMap((i) =>
        i && typeof i === "object" && typeof (i as { name?: unknown }).name === "string"
          ? [(i as { name: string }).name]
          : [],
      )
    : [];

type StepCard = Node<
  {
    step: FlowStep;
    name: string;
    detail: string | null;
    ran: Record<string, number>;
    bad: boolean;
    on: boolean;
    /** «Probar»: what this step did in the dry run (null: it did not run), or undefined without a test. */
    test?: TestStepView | null;
    /** The chosen step takes a value of this one. */
    feeds: boolean;
  },
  "step"
>;
type TriggerCard = Node<{ text: string; inputs: string[]; bad: boolean; on: boolean }, "trigger">;
type Card = StepCard | TriggerCard;

/** What a test says a step would have done, in words: «Propondría: Crear en Docencia «…»». */
function wouldText(t: T, w: TestStepView["would"][number]): string {
  const what = [
    w.title,
    w.type ? t("flows.test.in", { type: w.type }) : null,
    w.text ? `«${w.text}»` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return t(`flows.test.would.${w.decision}`, { what });
}

/** A step's lines in a test, for its panel's «Sale»: each thing it would do, or the one line of the canvas. */
export function testLines(t: T, x: TestStepView): string[] {
  return x.would.length ? x.would.slice(0, 20).map((w) => wouldText(t, w)) : [testLine(t, x)];
}

/** A day of an invitation («2026-11-06») as the canvas says it: «06/11». */
const dayText = (d: string | null) =>
  d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "";

/** What one of Boni's pieces found in a test, in words (docs/sistema.md §4.2; Juan, 2026-11-05: «Hecho» said nothing). */
export function pieceLine(t: T, p: PieceSaid): string {
  switch (p.piece) {
    case "mail.rule":
      return p.to ? t("flows.piece.ruleTo", { to: p.to }) : t("flows.piece.ruleNone");
    case "mail.known":
      return p.n === 0
        ? t("flows.piece.knownNone")
        : t(p.n === 1 ? "flows.piece.known.one" : "flows.piece.known", { n: p.n });
    case "mail.invitation":
      if (p.held) return t("flows.piece.invHeld");
      if (!p.title) return t("flows.piece.invNone");
      return [p.title, [dayText(p.day), p.start ?? ""].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(" · ");
    case "mail.relations":
      return p.found.length
        ? p.found
            .slice(0, 2)
            .map((f) => `${f.field}: ${f.title}`)
            .join(" · ")
        : t("flows.piece.relNone");
    case "inbox.fold":
    case "inbox.accept_alone":
      return t("flows.piece.notInTest");
  }
}

/** A step's line in a test: what it would do, what it gave, or why it did not run. */
export function testLine(t: T, x: TestStepView): string {
  const w = x.would[0];
  if (w) return wouldText(t, w);
  // A piece that ended the run there: the sender's rule says not to read it.
  if (x.decision === "end")
    return x.piece?.piece === "mail.rule" ? t("flows.piece.ruleSkip") : t("run.node.end");
  if (x.decision === "skip") return t("flows.test.skipped");
  if (x.decision === "deny" || x.decision === "stopped")
    return t("flows.test.stopped", { why: x.rule ?? x.error ?? "" });
  if (x.piece) return pieceLine(t, x.piece);
  const o = x.out;
  if (o.t === "list") return t(o.n === 1 ? "flows.test.items.one" : "flows.test.items", { n: o.n });
  if (o.t === "number") return `→ ${o.value}`;
  if (o.t === "text") return `→ «${o.text}»`;
  if (o.t === "record") {
    if (o.n !== null) return t(o.n === 1 ? "flows.test.items.one" : "flows.test.items", { n: o.n });
    if (o.text) return `→ «${o.text}»`;
  }
  return t("flows.test.done");
}

const StepView = memo(function StepView({ data }: NodeProps<StepCard>) {
  const t = useStore((s) => s.t);
  const { step } = data;
  // «end» follows the step's own «allow» (a piece ended the run there): the same run, not another.
  const ran = Object.entries(data.ran).reduce((a, [k, b]) => (k === "end" ? a : a + b), 0);
  const icon =
    step.op === "read" ? (
      <Bot size={14} strokeWidth={1.8} aria-hidden />
    ) : step.op === "ask" ? (
      <HelpCircle size={14} strokeWidth={1.8} aria-hidden />
    ) : step.op === "reply" ? (
      <MessageSquare size={14} strokeWidth={1.8} aria-hidden />
    ) : (
      <Braces size={14} strokeWidth={1.8} aria-hidden />
    );
  return (
    <div
      className={`fl-card ${step.op === "read" ? "model" : "code"}${data.bad ? " bad" : ""}${data.on ? " on" : ""}${data.test === null ? " idle" : ""}${data.feeds ? " feeds" : ""}`}
    >
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="target" position={Position.Right} id="ri" className="fl-hidden-handle" />
      <div className="fl-head">
        <span className="fl-icon">{icon}</span>
        <span className="fl-name">{data.name}</span>
        {step.each !== undefined && <span className="fl-badge">{t("flows.each")}</span>}
        {step.when !== undefined && <span className="fl-badge">{t("flows.when")}</span>}
      </div>
      {(data.detail || ran > 0 || data.test) && (
        <div className="fl-body">
          {data.detail && (
            <div className="fl-line" title={data.detail}>
              {data.detail}
            </div>
          )}
          {data.test && (
            <div className="fl-line fl-test" title={testLine(t, data.test)}>
              {testLine(t, data.test)}
            </div>
          )}
          {ran > 0 && !data.test && (
            <div className="fl-line muted">
              {t(ran === 1 ? "flows.ran.one" : "flows.ran", { n: ran })}
              {data.ran.propose ? ` · ${t("flows.proposed", { n: data.ran.propose })}` : ""}
              {data.ran.deny ? ` · ${t("flows.denied", { n: data.ran.deny })}` : ""}
              {data.ran.end ? ` · ${t("flows.ended", { n: data.ran.end })}` : ""}
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Right} id="ro" className="fl-hidden-handle" />
    </div>
  );
});

const TriggerView = memo(function TriggerView({ data }: NodeProps<TriggerCard>) {
  const t = useStore((s) => s.t);
  return (
    <div className={`fl-card source${data.bad ? " bad" : ""}${data.on ? " on" : ""}`}>
      <div className="fl-head">
        <span className="fl-icon">
          <Zap size={14} strokeWidth={1.8} aria-hidden />
        </span>
        <span className="fl-name">{data.text}</span>
      </div>
      {data.inputs.length > 0 && (
        <div className="fl-body">
          {data.inputs.map((i) => (
            <div key={i} className="fl-line fl-input">
              <span>{inputName(t, i)}</span>
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={false} />
      <Handle
        type="source"
        position={Position.Right}
        id="ro"
        className="fl-hidden-handle"
        isConnectable={false}
      />
    </div>
  );
});

const NODE_TYPES: NodeTypes = { step: StepView, trigger: TriggerView };

/** An arrow of the run's order: the choice a lane is for, over its first step, and a «+» to put a step there. */
type OrderData = {
  lane: string | null;
  /** The step a new one goes before (null: none goes here, inside a lane). */
  before: string | null;
  onPlus: (before: string, x: number, y: number) => void;
  plusLabel: string;
};
function OrderEdge(p: EdgeProps<Edge<OrderData>>) {
  const d = p.data as OrderData;
  const [path, lx, ly] = getSmoothStepPath({ ...p, borderRadius: 10 });
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} className="fl-edge order" />
      <EdgeLabelRenderer>
        {d.lane && (
          <div
            className="fl-lane"
            style={{
              transform: `translate(-50%, -100%) translate(${p.targetX}px, ${p.targetY - 6}px)`,
            }}
          >
            {d.lane}
          </div>
        )}
        {d.before && (
          <button
            type="button"
            className="fl-plus nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            title={d.plusLabel}
            aria-label={d.plusLabel}
            onClick={(e) => d.onPlus(d.before as string, e.clientX, e.clientY)}
          >
            <Plus size={12} strokeWidth={2.2} />
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
/** An arrow of a value the chosen step takes: drawn on the right, round the steps in between. */
function DataEdge(p: EdgeProps) {
  const [path] = getSmoothStepPath({ ...p, borderRadius: 12, offset: 28 });
  return <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} className="fl-edge data" />;
}
const EDGE_TYPES: EdgeTypes = { order: OrderEdge, data: DataEdge };

/** A step's card's height, by the lines it shows (the layout needs it before the card is drawn). */
const LINE = 18;
const stepHeight = (lines: number) => 38 + lines * LINE + (lines ? 6 : 0);

/**
 * The nodes of a draft and their arrows: the trigger first, then each step downwards in the order it runs, laid out
 * by `stepLayout` (nothing is placed by hand); the run's order as arrows with a «+» between two steps, and, for the
 * chosen step, an arrow from each step or input it takes a value from.
 */
function nodesOf(
  t: T,
  draft: Draft,
  detail: FlowDetailView,
  catalog: FlowCatalog | null,
  problems: readonly FlowProblem[],
  selected: string | null,
  test: FlowTestView | null,
  onPlus: ((before: string, x: number, y: number) => void) | null,
): { nodes: Card[]; edges: Edge[] } {
  const inputs =
    typeof draft.trigger.created === "string"
      ? detail.inputs.map((i) => i.id)
      : givenNames(draft.trigger);
  const ids = new Set(draft.plan.steps.map((s) => s.id));
  const ran = new Map(detail.nodes.map((n) => [n.id, n.ran]));
  const bad = new Set(problems.map((p) => p.step ?? TRIGGER));
  const collection = (s: FlowStep) => {
    const keys = typeKeysOf((s.args as Record<string, unknown> | undefined)?.type);
    // «Crear en la elegida»: the collection the decider chose, among those its `case` writes.
    if (keys.length > 1) return t("flows.inChosen");
    const k = keys[0];
    return k ? (catalog?.collections.find((c) => c.key === k)?.name ?? k) : null;
  };
  const chosen = draft.plan.steps.find((s) => s.id === selected);
  const feeds = new Set(chosen ? depsOf(chosen) : []);
  const cards = draft.plan.steps.map((s) => {
    const r = ran.get(s.id) ?? {};
    const ranN = Object.entries(r).reduce((a, [k, b]) => (k === "end" ? a : a + b), 0);
    const tried = test ? (test.steps[s.id] ?? null) : undefined;
    const detailText = stepDetail(t, s, s.op === "call" ? collection(s) : null);
    const lines = (detailText ? 1 : 0) + (tried ? 1 : 0) + (ranN > 0 && !tried ? 1 : 0);
    return { s, r, tried, detailText, height: stepHeight(lines) };
  });
  const heights = new Map(cards.map((c) => [c.s.id, c.height]));
  const triggerHeight = 40 + Math.min(inputs.length, 9) * LINE + 8;
  const l = stepLayout(draft.plan.steps, {
    trigger: { id: TRIGGER, height: triggerHeight },
    width: WIDTH,
    height: (id) => heights.get(id) ?? stepHeight(0),
    gapY: 34,
    gapX: 28,
    laneHead: 26,
  });
  const at = (id: string) => l.at.get(id) ?? { x: 0, y: 0 };
  const nodes: Card[] = [
    {
      id: TRIGGER,
      type: "trigger",
      position: at(TRIGGER),
      data: {
        text: triggerText(
          t,
          draft.trigger,
          (k) => catalog?.collections.find((c) => c.key === k)?.name,
        ),
        inputs,
        bad: problems.some((p) => p.step === null && p.at === "trigger"),
        on: selected === TRIGGER,
      },
      // A press on a box is a click (it opens its panel), not the start of a pan: nothing on the canvas is dragged.
      className: "fl-node source nopan",
      deletable: false,
      connectable: false,
      draggable: false,
    },
    ...cards.map(
      ({ s, r, tried, detailText }): StepCard => ({
        id: s.id,
        type: "step",
        position: at(s.id),
        data: {
          step: s,
          name:
            s.op === "call" && !catalog
              ? (detail.nodes.find((n) => n.id === s.id)?.title ?? stepName(t, s, catalog))
              : stepName(t, s, catalog),
          detail: detailText,
          ran: r,
          bad: bad.has(s.id),
          on: selected === s.id,
          feeds: feeds.has(s.id),
          ...(test ? { test: tried ?? null } : {}),
        },
        className: `fl-node ${s.op === "read" ? "model" : "code"} nopan`,
        draggable: false,
      }),
    ),
  ];
  // A step inside a lane takes no «+» before it (a new one there would run for every choice).
  const inLane = new Set(
    segmentsOf(draft.plan.steps).flatMap((g) =>
      g.kind === "lanes" ? g.lanes.flatMap((x) => x.steps) : [],
    ),
  );
  const plusLabel = t("flows.addHere");
  const edges: Edge[] = l.links.map((k) => ({
    id: `o:${k.from}>${k.to}`,
    source: k.from,
    target: k.to,
    sourceHandle: "b",
    targetHandle: "t",
    type: "order",
    data: {
      lane: k.lane ?? null,
      before: catalog && onPlus && !inLane.has(k.to) ? k.to : null,
      onPlus: onPlus ?? (() => undefined),
      plusLabel,
    } satisfies OrderData,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    deletable: false,
    selectable: false,
  }));
  if (chosen) {
    const from = new Set<string>();
    for (const d of depsOf(chosen)) from.add(ids.has(d) ? d : TRIGGER);
    for (const f of from)
      edges.push({
        id: `d:${f}>${chosen.id}`,
        source: f,
        target: chosen.id,
        sourceHandle: "ro",
        targetHandle: "ri",
        type: "data",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        deletable: false,
        selectable: false,
        zIndex: 5,
      });
  }
  return { nodes, edges };
}

/**
 * The node kinds «Añadir paso» offers, in groups by what they do (docs/flujos.md §4.5; task 70): Leer, Decidir,
 * Datos, Avisar, Preguntar, Responder, the rest, and Boni's pieces («De Boni», docs/sistema.md §4.2) in a flow a
 * record starts (`byRecord`), the only one they work in.
 */
function kindsOf(
  catalog: FlowCatalog,
  byRecord: boolean,
): { group: string; items: { kind: NodeKind; name: string }[] }[] {
  const reads = Object.keys(catalog.readers).filter(
    (r) => r !== "classify" && r !== "review_reading",
  );
  // A flow neither starts another nor saves one (docs/flujos.md §4.3): `flows.run` and `flows.save` are not offered.
  const tools = catalog.tools.filter((x) => x.effect !== "flow" && x.effect !== "flow_save");
  const isData = (x: { name: string; effect: string }) =>
    x.name.startsWith("entities.") || x.name.startsWith("schema.") || x.effect === "memory";
  const isNotice = (x: { effect: string }) => x.effect === "notify";
  const isPiece = (x: { effect: string }) => x.effect === "piece";
  const call = (x: { name: string }) => ({
    kind: { op: "call", tool: x.name } as NodeKind,
    name: x.name,
  });
  const groups: { group: string; items: { kind: NodeKind; name: string }[] }[] = [
    { group: "read", items: reads.map((r) => ({ kind: { op: "read", reader: r }, name: r })) },
    { group: "decide", items: [{ kind: { op: "read", reader: "classify" }, name: "classify" }] },
    { group: "data", items: tools.filter(isData).map(call) },
    { group: "notify", items: tools.filter(isNotice).map(call) },
    {
      group: "ask",
      items: catalog.asks.map((c) => ({
        kind: { op: "ask", control: c } as NodeKind,
        name: `ask.${c}`,
      })),
    },
    {
      group: "reply",
      items: Object.keys(catalog.replies).map((c) => ({
        kind: { op: "reply", component: c } as NodeKind,
        name: `reply.${c}`,
      })),
    },
    {
      group: "other",
      items: tools.filter((x) => !isData(x) && !isNotice(x) && !isPiece(x)).map(call),
    },
    { group: "boni", items: byRecord ? tools.filter((x) => isPiece(x) && x.record).map(call) : [] },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Text as a search compares it: lower case, without accents. */
const fold = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * «Añadir paso» (task 70; Juan, 2026-11-05: «no veo ninguna opción de avisar… falta darle control al usuario»): a
 * search over every kind of step, by its name or its group's, and the kinds in their groups; Enter takes the first.
 */
function StepPicker({
  catalog,
  byRecord,
  onPick,
}: {
  catalog: FlowCatalog;
  /** The flow starts with a record (a mail): Boni's pieces are offered. */
  byRecord: boolean;
  onPick: (k: NodeKind) => void;
}) {
  const t = useStore((s) => s.t);
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  // Once its box is placed and shown: a box still hidden takes no focus.
  useEffect(() => {
    const id = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const groups = useMemo(() => kindsOf(catalog, byRecord), [catalog, byRecord]);
  const want = fold(q.trim());
  const shown = groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (it) =>
          !want ||
          fold(
            `${kindName(t, it.kind, catalog)} ${t(`flows.group.${g.group}`)} ${it.name}`,
          ).includes(want),
      ),
    }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="flow-kinds">
      <input
        ref={search}
        className="input flow-kind-search"
        value={q}
        placeholder={t("flows.findStep")}
        aria-label={t("flows.findStep")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          const first = want ? shown[0]?.items[0] : undefined;
          if (e.key === "Enter" && first) {
            e.preventDefault();
            onPick(first.kind);
          }
        }}
      />
      <div className="flow-kind-list">
        {shown.map((g) => (
          <div key={g.group} className="flow-kind-group">
            <p className="menu-head">{t(`flows.group.${g.group}`)}</p>
            {g.items.map((it) => (
              <MenuRow
                key={it.name}
                label={kindName(t, it.kind, catalog)}
                onClick={() => onPick(it.kind)}
              />
            ))}
          </div>
        ))}
        {shown.length === 0 && <p className="muted small flow-kind-none">{t("flows.noStep")}</p>}
      </div>
    </div>
  );
}

/**
 * «Probar con…» (task 63, point 6): a mail of the mail's collection, by its subject and newest first, filtered as one
 * types; the flow is tried with it instead of the latest. Its rows are read when the list opens.
 */
function MailToTry({ disabled, onPick }: { disabled: boolean; onPick: (mail: string) => void }) {
  const t = useStore((s) => s.t);
  const type = useStore((s) => s.dataTypes?.find((x) => x.view === "mail") ?? null);
  const [rows, setRows] = useState<{ id: string; title: string }[] | null>(null);
  const load = async () => {
    if (!type) return setRows([]);
    try {
      const r = await agentApi.dataRows(type.id);
      setRows(
        r.rows
          .slice()
          .sort((a, b) => b.updated - a.updated)
          .map((x) => {
            const v = x.values[type.titleField];
            return { id: x.id, title: typeof v === "string" ? v : "" };
          }),
      );
    } catch {
      setRows([]);
    }
  };
  if (!type) return null;
  return (
    <PopButton
      label={<ListFilter size={14} strokeWidth={1.8} aria-hidden />}
      title={t("flows.testWith")}
      className="btn small"
      align="start"
      width={300}
      disabled={disabled}
      onOpenChange={(open) => {
        if (open) {
          setRows(null);
          void load();
        }
      }}
    >
      {(close) => (
        <MailList
          rows={rows}
          onPick={(id) => {
            close();
            onPick(id);
          }}
        />
      )}
    </PopButton>
  );
}

/** The mails «Probar con…» offers, and its search, which takes the keys once the box shows (a box still hidden
 * while it is placed takes no focus: «Errores y soluciones», 2026-10-25). */
function MailList({
  rows,
  onPick,
}: {
  rows: { id: string; title: string }[] | null;
  onPick: (id: string) => void;
}) {
  const t = useStore((s) => s.t);
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  const want = fold(q.trim());
  const shown = (rows ?? []).filter((r) => !want || fold(r.title).includes(want)).slice(0, 50);
  return (
    <div className="menu-list scroll" role="menu">
      <input
        ref={search}
        className="input small db-find"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("flows.findMail")}
        aria-label={t("flows.findMail")}
      />
      {rows === null ? (
        <div className="muted small db-note">{t("db.loading")}</div>
      ) : shown.length === 0 ? (
        <div className="muted small db-note">{t("db.noRows")}</div>
      ) : (
        shown.map((r) => (
          <MenuRow key={r.id} label={r.title || t("page.untitled")} onClick={() => onPick(r.id)} />
        ))
      )}
    </div>
  );
}

function kindName(t: T, k: NodeKind, catalog: FlowCatalog): string {
  if (k.op === "ask") return t(`flows.control.${k.control}`);
  if (k.op === "reply") return t(`flows.component.${k.component}`);
  return stepName(t, k as unknown as { op: string }, catalog);
}

function Canvas({
  draft,
  detail,
  catalog,
  check,
  selected,
  test,
  onSelect,
  onPlan,
  onDuplicate,
  onRemove,
  onTestUpTo,
  canTestUpTo,
  onAdd,
  readOnly = false,
}: {
  draft: Draft;
  detail: FlowDetailView;
  catalog: FlowCatalog | null;
  check: FlowCheck | null;
  selected: string | null;
  test: FlowTestView | null;
  onSelect: (id: string | null) => void;
  onPlan: (p: FlowPlan) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onTestUpTo: (id: string) => void;
  /** Whether the flow can be tried as far as that step now (no test running, no problem up to it). */
  canTestUpTo: (id: string) => boolean;
  /** A new step of that kind: before `before` (the «+» between two), else after `after` or the chosen one; its id. */
  onAdd: (kind: NodeKind, where: { before?: string; after?: string | null }) => string;
  /** To look at and run, not to change (the phone; docs/sistema.md §4.4). */
  readOnly?: boolean;
}) {
  const t = useStore((s) => s.t);
  // The right button on a node: its actions where the pointer is (task 70); «Abrir» opens its panel.
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [linking, setLinking] = useState<{ from: string; to: string } | null>(null);
  // An arrow being drawn: every step shows where it lands (task 78).
  const [connecting, setConnecting] = useState(false);
  // The canvas's right button, an arrow left on it, or a «+» between two steps: «Añadir paso» there (task 78).
  const [adding, setAdding] = useState<{
    x: number;
    y: number;
    from: string | null;
    before: string | null;
  } | null>(null);
  const { nodes: made, edges } = useMemo(
    () =>
      nodesOf(
        t,
        draft,
        detail,
        catalog,
        check?.problems ?? [],
        selected,
        test,
        readOnly ? null : (before, x, y) => setAdding({ x, y, from: null, before }),
      ),
    [t, draft, detail, catalog, check, selected, test, readOnly],
  );
  // Fitted as it opens (React Flow waits for the boxes to be measured; a new flow is a new canvas): the top of a long
  // flow at a size to read, the rest a scroll below (2026-11-05: «Leer correo» fitted whole was too small to read).
  const fit = useMemo(
    () => ({
      nodes: made
        .slice()
        .sort((a, b) => a.position.y - b.position.y)
        .slice(0, 8)
        .map((n) => ({ id: n.id })),
      padding: 0.12,
      maxZoom: 1,
      minZoom: 0.55,
    }),
    [],
  );
  const target = linking ? draft.plan.steps.find((s) => s.id === linking.to) : undefined;
  // The boxes as React Flow's state, measured once and kept (core/useKeptNodes.ts).
  const { nodes, onNodesChange } = useKeptNodes(made);
  // The step chosen (one just added at the end, say) is brought into view when it is out of it, the zoom kept.
  const { getNode, getViewport, setViewport } = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const id = setTimeout(() => {
      const n = getNode(selected);
      const area = box.current?.getBoundingClientRect();
      if (!n || !area) return;
      const v = getViewport();
      const w = n.measured?.width ?? WIDTH;
      const h = n.measured?.height ?? 60;
      const x0 = n.position.x * v.zoom + v.x;
      const y0 = n.position.y * v.zoom + v.y;
      // Just enough to show it, as a list scrolls to its chosen row: the rest stays where it was.
      const m = 24;
      const x1 = x0 + w * v.zoom;
      const y1 = y0 + h * v.zoom;
      const dx = x0 < m ? m - x0 : x1 > area.width - m ? area.width - m - x1 : 0;
      const dy = y0 < m ? m - y0 : y1 > area.height - m ? area.height - m - y1 : 0;
      if (dx || dy) void setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, { duration: 200 });
    }, 80);
    return () => clearTimeout(id);
  }, [selected, getNode, getViewport, setViewport]);
  return (
    <div className={`flow-canvas flow-editing${connecting ? " connecting" : ""}`} ref={box}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={!readOnly}
        onNodeClick={(_, n) => onSelect(n.id)}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          if (!readOnly) setMenu({ x: e.clientX, y: e.clientY, id: n.id });
        }}
        onPaneClick={() => onSelect(null)}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          if (!catalog || readOnly) return;
          setAdding({ x: e.clientX, y: e.clientY, from: null, before: null });
        }}
        onConnectStart={() => setConnecting(true)}
        onConnect={(c: Connection) => {
          if (!c.source || !c.target || c.source === TRIGGER || c.source === c.target) return;
          setLinking({ from: c.source, to: c.target });
        }}
        // Left anywhere on a step, the arrow lands on it (its dot is small); left on the canvas, a new step after it
        // takes its value (n8n's way; Juan, 2026-11-05: «no puedo conectarlo entre ellos»).
        onConnectEnd={(e, state) => {
          setConnecting(false);
          const from = state.fromNode?.id;
          if (state.isValid || !from || from === TRIGGER) return;
          const p = "changedTouches" in e ? e.changedTouches[0] : e;
          if (!p) return;
          const node = document
            .elementFromPoint(p.clientX, p.clientY)
            ?.closest(".react-flow__node");
          const to = node?.getAttribute("data-id");
          if (node) {
            if (to && to !== from && to !== TRIGGER) setLinking({ from, to });
            return;
          }
          // Left on the canvas itself, not over its panel or the toolbar (dragging away cancels it).
          const pane = document
            .elementFromPoint(p.clientX, p.clientY)
            ?.closest(".react-flow__pane");
          if (pane && catalog) setAdding({ x: p.clientX, y: p.clientY, from, before: null });
        }}
        onNodesDelete={(gone) => {
          let p = draft.plan;
          for (const n of gone) if (n.id !== TRIGGER) p = removeStep(p, n.id);
          onPlan(p);
          onSelect(null);
        }}
        deleteKeyCode={readOnly ? null : "Delete"}
        fitView
        fitViewOptions={fit}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        minZoom={0.2}
        maxZoom={1.6}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {menu && (
        <PointMenu x={menu.x} y={menu.y} label={t("flows.nodeMenu")} onClose={() => setMenu(null)}>
          {(close) => (
            <>
              <MenuRow
                label={t("flows.open")}
                onClick={() => {
                  onSelect(menu.id);
                  close();
                }}
              />
              {menu.id !== TRIGGER && (
                <>
                  <MenuRow
                    label={t("flows.duplicateStep")}
                    onClick={() => {
                      onDuplicate(menu.id);
                      close();
                    }}
                  />
                  <MenuRow
                    label={t("flows.testUpTo")}
                    disabled={!canTestUpTo(menu.id)}
                    onClick={() => {
                      onTestUpTo(menu.id);
                      close();
                    }}
                  />
                  <MenuSep />
                  <MenuRow
                    danger
                    label={t("flows.remove")}
                    onClick={() => {
                      onRemove(menu.id);
                      close();
                    }}
                  />
                </>
              )}
            </>
          )}
        </PointMenu>
      )}
      {adding && catalog && (
        <PointMenu
          x={adding.x}
          y={adding.y}
          width={260}
          label={t("flows.addStep")}
          onClose={() => setAdding(null)}
        >
          {(close) => (
            <StepPicker
              catalog={catalog}
              byRecord={typeof draft.trigger.created === "string"}
              onPick={(kind) => {
                const id = onAdd(
                  kind,
                  adding.before ? { before: adding.before } : { after: adding.from },
                );
                if (adding.from) setLinking({ from: adding.from, to: id });
                close();
              }}
            />
          )}
        </PointMenu>
      )}
      {linking && target && catalog && (
        <div className="flow-link-menu" role="menu" aria-label={t("flows.useIn")}>
          <p className="flow-link-title">
            {t("flows.useIn")} · {stepName(t, target, catalog)}
          </p>
          {slotsOf(target, catalog).map((slot) => (
            <MenuRow
              key={slot.join(".")}
              label={argName(t, slot.at(-1) ?? "")}
              onClick={() => {
                onPlan(takeValue(draft.plan, linking.from, linking.to, slot));
                setLinking(null);
                onSelect(linking.to);
              }}
            />
          ))}
          <MenuSep />
          <MenuRow label={t("flows.cancel")} onClick={() => setLinking(null)} />
        </div>
      )}
    </div>
  );
}

/** The trigger's panel: what starts the flow and, by hand, the names its form asks for. */
function TriggerPanel({
  draft,
  detail,
  catalog,
  onTrigger,
  onClose,
}: {
  draft: Draft;
  detail: FlowDetailView;
  catalog: FlowCatalog | null;
  onTrigger: (t: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const fixed = typeof draft.trigger.created === "string";
  const names = formNames(draft.trigger);
  const schedule =
    draft.trigger.schedule && typeof draft.trigger.schedule === "object"
      ? (draft.trigger.schedule as ScheduleDraft)
      : null;
  return (
    <aside className="flow-step-panel" aria-label={t("flows.trigger")}>
      <div className="flow-panel-head">
        <h3>{t("flows.trigger")}</h3>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("flows.close")}
          title={t("flows.close")}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {fixed ? (
        <>
          <p>
            {triggerText(
              t,
              draft.trigger,
              (k) => catalog?.collections.find((c) => c.key === k)?.name,
            )}
          </p>
          <ul className="flow-args">
            {detail.inputs.map((i) => (
              <li key={i.id}>
                {inputName(t, i.id)} <span className="muted">{t(`flows.input.${i.what}`)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <label className="flow-setting">
            <span className="flow-setting-name">{t("flows.trigger")}</span>
            <select
              value={schedule ? "schedule" : "manual"}
              onChange={(e) =>
                onTrigger(
                  e.target.value === "schedule"
                    ? { schedule: { every: "day", at: "08:00" } }
                    : { manual: true },
                )
              }
            >
              <option value="manual">{t("flows.on.manual")}</option>
              <option value="schedule">{t("flows.on.scheduled")}</option>
            </select>
          </label>
          {schedule ? (
            <SchedulePanel schedule={schedule} onSchedule={(s) => onTrigger({ schedule: s })} />
          ) : (
            <>
              <span className="flow-setting-name">{t("flows.form")}</span>
              {names.map((n, i) => (
                <div className="flow-value-row" key={`${i}-${names.length}`}>
                  <input
                    aria-label={t("flows.formField")}
                    value={n}
                    onChange={(e) =>
                      onTrigger({
                        ...draft.trigger,
                        inputs: names.map((x, j) => ({
                          name: j === i ? e.target.value.toLowerCase() : x,
                        })),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("flows.expr.clear")}
                    onClick={() =>
                      onTrigger({
                        ...draft.trigger,
                        inputs: names.filter((_, j) => j !== i).map((x) => ({ name: x })),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {names.length < 6 && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() =>
                    onTrigger({
                      ...draft.trigger,
                      manual: true,
                      inputs: [
                        ...names.map((x) => ({ name: x })),
                        { name: `campo${names.length + 1}` },
                      ],
                    })
                  }
                >
                  {t("flows.addFormField")}
                </button>
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
}

/** A schedule's minutes, every five (a time in between is kept as it came). */
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

interface ScheduleDraft {
  every: "day" | "week" | "hour";
  at?: string;
  day?: number;
}

/** When a scheduled flow runs: every day, a day of the week or every hour, and at what time (docs/flujos.md F4). */
function SchedulePanel({
  schedule,
  onSchedule,
}: {
  schedule: ScheduleDraft;
  onSchedule: (s: ScheduleDraft) => void;
}) {
  const t = useStore((s) => s.t);
  const at = schedule.at ?? "08:00";
  return (
    <>
      <label className="flow-setting">
        <span className="flow-setting-name">{t("flows.schedule.every")}</span>
        <select
          value={schedule.every}
          onChange={(e) => {
            const every = e.target.value as ScheduleDraft["every"];
            onSchedule(
              every === "week"
                ? { every, at: schedule.every === "hour" ? "08:00" : at, day: schedule.day ?? 1 }
                : every === "hour"
                  ? { every, at: `00:${at.slice(3)}` }
                  : { every, at: schedule.every === "hour" ? "08:00" : at },
            );
          }}
        >
          <option value="day">{t("flows.every.day")}</option>
          <option value="week">{t("flows.every.week")}</option>
          <option value="hour">{t("flows.every.hour")}</option>
        </select>
      </label>
      {schedule.every === "week" && (
        <label className="flow-setting">
          <span className="flow-setting-name">{t("flows.weekday")}</span>
          <select
            value={schedule.day ?? 1}
            onChange={(e) => onSchedule({ ...schedule, day: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <option key={d} value={d}>
                {t(`flows.day.${d}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {schedule.every === "hour" ? (
        <label className="flow-setting">
          <span className="flow-setting-name">{t("flows.minute")}</span>
          <select
            value={at.slice(3)}
            onChange={(e) => onSchedule({ every: "hour", at: `00:${e.target.value}` })}
          >
            {MINUTES.map((m) => (
              <option key={m} value={m}>
                :{m}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="flow-setting">
          <span className="flow-setting-name">{t("flows.at")}</span>
          <div className="flow-time">
            <select
              aria-label={t("flows.hour")}
              value={at.slice(0, 2)}
              onChange={(e) => onSchedule({ ...schedule, at: `${e.target.value}:${at.slice(3)}` })}
            >
              {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")).map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span>:</span>
            <select
              aria-label={t("flows.minute")}
              value={at.slice(3)}
              onChange={(e) =>
                onSchedule({ ...schedule, at: `${at.slice(0, 2)}:${e.target.value}` })
              }
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </>
  );
}

/** The editor of one flow. `onChanged`: the server's flow after a save, a switch, a revert; null after deleting it. */
export function FlowEditor({
  detail,
  catalog,
  onChanged,
  onOpen,
  readOnly = false,
}: {
  detail: FlowDetailView;
  catalog: FlowCatalog | null;
  onChanged: (d: FlowDetailView | null) => void;
  /** Another flow to show (the copy just made). */
  onOpen: (id: string) => void;
  /** On the phone a flow is looked at, tried and run; it is changed on the computer (docs/sistema.md §4.4). */
  readOnly?: boolean;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [draft, setDraft] = useState<Draft>(() => draftOf(detail));
  const [check, setCheck] = useState<FlowCheck | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [running, setRunning] = useState<{
    values: Record<string, string>;
    test: boolean;
    /** «Probar hasta aquí»: the step the test stops at. */
    upTo?: string | null;
  } | null>(null);
  const [test, setTest] = useState<FlowTestView | null>(null);
  // The step a test went as far as («Probar hasta aquí», task 70), or null for the whole flow.
  const [testUpTo, setTestUpTo] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  // A new version from the server (saved, switched, gone back): the draft starts from it.
  const shown = useRef(detail);
  useEffect(() => {
    if (shown.current.id !== detail.id || shown.current.version !== detail.version)
      setSelected(null);
    shown.current = detail;
    setDraft(draftOf(detail));
    setError(null);
  }, [detail]);
  const dirty = !same(draft, draftOf(detail));
  // The checklist and the values each step may take, asked again a moment after each change.
  useEffect(() => {
    let gone = false;
    const id = setTimeout(() => {
      agentApi.checkFlow(draft.trigger, draft.plan).then(
        (c) => !gone && setCheck(c),
        () => undefined,
      );
    }, 250);
    return () => {
      gone = true;
      clearTimeout(id);
    };
  }, [draft.trigger, draft.plan]);
  const problems = check?.problems ?? [];
  // «Probar» (F3): the draft as it is, dry, with the latest mail or the form's values; its result on the canvas.
  // As far as a step («Probar hasta aquí»): that step and the ones before it, nothing after.
  const tryIt = async (
    inputs?: Record<string, string>,
    upTo: string | null = null,
    /** A flow a record starts, with this mail instead of the latest (task 63, point 6). */
    mail: string | null = null,
  ) => {
    setTesting(true);
    setError(null);
    try {
      setTest(
        await agentApi.testFlow(detail.id, {
          plan: upTo ? planUpTo(draft.plan, upTo) : draft.plan,
          trigger: draft.trigger,
          ...(inputs ? { inputs } : {}),
          ...(mail ? { mail } : {}),
        }),
      );
      setTestUpTo(upTo);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setTesting(false);
    }
  };
  // A change of the draft makes the last test's lines stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the plan and trigger only
  useEffect(() => setTest(null), [draft.plan, draft.trigger]);
  const setPlan = (plan: FlowPlan) => setDraft((d) => ({ ...d, plan }));
  const act = async (f: () => Promise<FlowDetailView | null>) => {
    setBusy(true);
    setError(null);
    try {
      const d = await f();
      if (d) onChanged(d);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(() =>
      agentApi.saveFlow(detail.id, {
        base: detail.version,
        name: draft.name.trim() || detail.name,
        trigger: draft.trigger,
        plan: draft.plan,
      }),
    );
  const add = (kind: NodeKind) => {
    const step = newStep(draft.plan, kind);
    const after =
      selected && selected !== TRIGGER ? selected : (draft.plan.steps.at(-1)?.id ?? null);
    setPlan(addStep(draft.plan, step, after));
    setSelected(step.id);
  };
  // A step added from the canvas (task 78): before the step a «+» between two was pressed over, after the step an
  // arrow came from, else after the one chosen or at the end; chosen.
  const addFrom = (kind: NodeKind, where: { before?: string; after?: string | null }) => {
    const step = newStep(draft.plan, kind);
    setDraft((d) => {
      if (where.before) return { ...d, plan: insertStep(d.plan, step, where.before) };
      const after =
        where.after ??
        (selected && selected !== TRIGGER ? selected : (d.plan.steps.at(-1)?.id ?? null));
      return { ...d, plan: addStep(d.plan, step, after) };
    });
    setSelected(step.id);
    return step.id;
  };
  // The right button's «Duplicar»: the copy right after it, chosen.
  const duplicate = (id: string) => {
    const r = duplicateStep(draft.plan, id);
    if (!r.id) return;
    setPlan(r.plan);
    setSelected(r.id);
  };
  // As far as a step: not while a test or a change runs, nor with a problem in it, before it or in the trigger.
  const canTestUpTo = (id: string) => {
    if (testing || busy) return false;
    const upTo = new Set(planUpTo(draft.plan, id).steps.map((s) => s.id));
    return !problems.some((p) => p.step === null || upTo.has(p.step));
  };
  const step = draft.plan.steps.find((s) => s.id === selected);
  const manual = !!draft.trigger.manual;
  const byRecord = typeof draft.trigger.created === "string";
  // A test of the flow, or as far as a step: a flow with a form asks for its values first.
  const startTest = (upTo: string | null) => {
    const names = formNames(draft.trigger);
    if (manual && names.length)
      setRunning({ values: Object.fromEntries(names.map((n) => [n, ""])), test: true, upTo });
    else void tryIt(undefined, upTo);
  };
  // By hand: a flow with a form, or a scheduled one now; not one a record starts.
  const runnable = manual || !!draft.trigger.schedule;
  const when = (ms: number) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);
  return (
    <section className="flow-detail flow-editor">
      <div className="flow-toolbar">
        <input
          className="flow-name"
          aria-label={t("flows.name")}
          readOnly={readOnly}
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 80) }))}
        />
        {detail.preset !== null && (
          <span
            className={`flow-whose${detail.by === "preset" ? " boni" : ""}`}
            title={detail.by === "preset" ? t("flows.whose.boniTip") : t("flows.whose.yoursTip")}
          >
            {detail.by === "preset" ? t("flows.group.boni") : t("flows.whose.yours")}
          </span>
        )}
        <label className="toggle-row">
          <input
            type="checkbox"
            className="switch"
            checked={detail.enabled}
            disabled={busy}
            aria-label={detail.enabled ? t("flows.enabled") : t("flows.disabled")}
            onChange={(e) => void act(() => agentApi.setFlowEnabled(detail.id, e.target.checked))}
          />
          <span>{detail.enabled ? t("flows.enabled") : t("flows.disabled")}</span>
        </label>
        {catalog && !readOnly && (
          <PopButton
            label={
              <>
                <Plus size={14} strokeWidth={1.8} aria-hidden />
                {t("flows.addStep")}
              </>
            }
            title={t("flows.addStep")}
            className="btn small"
            align="start"
            width={260}
          >
            {(close) => (
              <StepPicker
                catalog={catalog}
                byRecord={byRecord}
                onPick={(kind) => {
                  add(kind);
                  close();
                }}
              />
            )}
          </PopButton>
        )}
        <button
          type="button"
          className={`btn small${testing ? " busy" : ""}`}
          disabled={busy || testing || problems.length > 0 || !draft.plan.steps.length}
          aria-busy={testing}
          onClick={() => startTest(null)}
        >
          <FlaskConical size={14} strokeWidth={1.8} aria-hidden />
          {testing ? t("flows.testing") : t("flows.test")}
        </button>
        {byRecord && (
          <MailToTry
            disabled={busy || testing || problems.length > 0 || !draft.plan.steps.length}
            onPick={(mail) => void tryIt(undefined, null, mail)}
          />
        )}
        {runnable && detail.enabled && !dirty && (
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => {
              const names = formNames(draft.trigger);
              if (names.length)
                setRunning({ values: Object.fromEntries(names.map((n) => [n, ""])), test: false });
              else void runFlowInChat(detail.id, detail.name, {});
            }}
          >
            <Play size={14} strokeWidth={1.8} aria-hidden />
            {t("flows.run")}
          </button>
        )}
        <span className="spacer" />
        {dirty && !readOnly && (
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => setDraft(draftOf(detail))}
          >
            {t("flows.discard")}
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            className="btn primary small"
            disabled={!dirty || busy || problems.length > 0}
            onClick={() => void save()}
          >
            {t("flows.save")}
          </button>
        )}
        <PopButton
          label={<MoreHorizontal size={16} strokeWidth={1.8} />}
          title={t("page.more")}
          width={240}
        >
          {(close) => (
            <>
              {!readOnly && (
                <>
                  <p className="menu-head">{t("flows.versions")}</p>
                  {detail.versions.slice(0, 12).map((v) => (
                    <MenuRow
                      key={v.version}
                      on={v.version === detail.version}
                      label={`v${v.version} · ${t(`flows.by.${v.by}`)} · ${when(v.created)}`}
                      onClick={() => {
                        close();
                        if (v.version !== detail.version)
                          void act(() => agentApi.revertFlow(detail.id, { version: v.version }));
                      }}
                    />
                  ))}
                  <MenuSep />
                  {detail.preset !== null && detail.by !== "preset" && (
                    <MenuRow
                      label={t("flows.backToBoni")}
                      onClick={() => {
                        close();
                        void act(() => agentApi.revertFlow(detail.id, { preset: true }));
                      }}
                    />
                  )}
                </>
              )}
              <MenuRow
                label={t("map.show")}
                onClick={() => {
                  close();
                  showMap(`flow:${detail.id}`);
                }}
              />
              {!readOnly && (
                <>
                  <MenuRow
                    label={t("flows.duplicate")}
                    onClick={() => {
                      close();
                      void (async () => {
                        try {
                          const copy = await agentApi.createFlow(
                            t("flows.copyOf", { name: detail.name }),
                            detail.id,
                          );
                          if (copy) onOpen(copy.id);
                        } catch (e) {
                          setError(errorText(t, e));
                        }
                      })();
                    }}
                  />
                  {detail.preset === null && (
                    <MenuRow
                      danger
                      label={confirmDelete ? t("flows.deleteSure") : t("flows.delete")}
                      onClick={() => {
                        if (!confirmDelete) return setConfirmDelete(true);
                        close();
                        setConfirmDelete(false);
                        void (async () => {
                          try {
                            await agentApi.deleteFlow(detail.id);
                            toast(t("flows.deleted", { name: detail.name }));
                            onChanged(null);
                          } catch (e) {
                            setError(errorText(t, e));
                          }
                        })();
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}
        </PopButton>
      </div>
      {error && <p className="form-error">{error}</p>}
      {problems.length > 0 && (
        <ul className="flow-checklist" aria-label={t("flows.problems")}>
          {problems.slice(0, 8).map((p) => {
            const s = p.step ? draft.plan.steps.find((x) => x.id === p.step) : null;
            return (
              <li key={`${p.step}-${p.at}-${p.code}`}>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setSelected(p.step ?? TRIGGER)}
                >
                  {s ? `${stepName(t, s, catalog)}: ` : ""}
                  {problemText(t, p)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {running && (
        <form
          className="flow-run-form"
          onSubmit={(e) => {
            e.preventDefault();
            const { values, test: dry, upTo } = running;
            setRunning(null);
            if (dry) void tryIt(values, upTo ?? null);
            else void runFlowInChat(detail.id, detail.name, values);
          }}
        >
          {Object.entries(running.values).map(([k, v]) => (
            <label key={k} className="flow-setting">
              <span className="flow-setting-name">{k}</span>
              <input
                value={v}
                onChange={(e) =>
                  setRunning({ ...running, values: { ...running.values, [k]: e.target.value } })
                }
              />
            </label>
          ))}
          <div className="row">
            <button type="submit" className="btn primary small">
              {running.test ? t("flows.test") : t("flows.run")}
            </button>
            <button type="button" className="btn small" onClick={() => setRunning(null)}>
              {t("flows.cancel")}
            </button>
          </div>
        </form>
      )}
      {test && (
        <div className="flow-test-bar" role="status">
          <FlaskConical size={14} strokeWidth={1.8} aria-hidden />
          <span>
            {test.sample
              ? t("flows.test.with", { subject: test.sample.subject })
              : t("flows.test.title")}
            {" · "}
            {testUpTo && draft.plan.steps.some((s) => s.id === testUpTo)
              ? `${t("flows.test.upTo", {
                  name: stepName(
                    t,
                    draft.plan.steps.find((s) => s.id === testUpTo) as FlowStep,
                    catalog,
                  ),
                })} · `
              : ""}
            {test.status === "done"
              ? t("flows.test.ok")
              : test.error === "dry-ask"
                ? t("flows.test.asks")
                : t("flows.test.stoppedRun", { why: test.error ?? "" })}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="icon-btn"
            aria-label={t("flows.test.clear")}
            title={t("flows.test.clear")}
            onClick={() => setTest(null)}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}
      <div className="flow-stage">
        <ReactFlowProvider>
          <Canvas
            draft={draft}
            detail={detail}
            catalog={catalog}
            check={check}
            selected={selected}
            test={test}
            onSelect={setSelected}
            onPlan={setPlan}
            onDuplicate={duplicate}
            onRemove={(id) => {
              setPlan(removeStep(draft.plan, id));
              setSelected(null);
            }}
            onTestUpTo={startTest}
            canTestUpTo={canTestUpTo}
            onAdd={addFrom}
            readOnly={readOnly}
          />
        </ReactFlowProvider>
        {selected === TRIGGER && !readOnly && (
          <TriggerPanel
            draft={draft}
            detail={detail}
            catalog={catalog}
            onTrigger={(trigger) => setDraft((d) => ({ ...d, trigger }))}
            onClose={() => setSelected(null)}
          />
        )}
        {step && catalog && !readOnly && (
          <FlowStepPanel
            step={step}
            plan={draft.plan}
            catalog={catalog}
            refs={check?.refs[step.id] ?? []}
            outs={check?.outs[step.id] ?? []}
            tried={
              test
                ? test.steps[step.id]
                  ? testLines(t, test.steps[step.id] as TestStepView)
                  : []
                : null
            }
            problems={problems.filter((p) => p.step === step.id)}
            byRecord={byRecord}
            onPlan={setPlan}
            onRemove={() => {
              setPlan(removeStep(draft.plan, step.id));
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </section>
  );
}
