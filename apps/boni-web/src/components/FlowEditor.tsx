/**
 * The flow editor (docs/flujos.md, F2): a flow's canvas where the user adds, removes, moves and connects steps (an
 * arrow uses one step's value in another), a step's panel with its settings from the catalog, the trigger's panel,
 * the checklist the server computes as he edits, and the flow's actions: save (a version, only with an empty
 * checklist), discard, on or off, run by hand, versions, back to Boni's, duplicate, delete. Everything is the user's
 * from a personal device; a model only proposes flows (D-41). Docs: docs/design-guide.md «Flujos».
 */
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  Braces,
  FlaskConical,
  HelpCircle,
  LayoutGrid,
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
  TestStepView,
} from "../core/agent.ts";
import {
  addStep,
  depsOf,
  type NodeKind,
  newStep,
  removeStep,
  slotsOf,
  takeValue,
} from "../core/flowEdit.ts";
import { flowLayout } from "../core/flowLayout.ts";
import { agentApi, errorText, runFlowInChat, toast, useStore } from "../store.ts";
import { FlowStepPanel, problemText, stepName } from "./FlowStepPanel.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

const WIDTH = 200;
const TRIGGER = "trigger";
type T = (k: string, p?: Record<string, string | number>) => string;

interface Draft {
  name: string;
  trigger: Record<string, unknown>;
  plan: FlowPlan;
  layout: Record<string, { x: number; y: number }> | null;
}
const draftOf = (d: FlowDetailView): Draft => ({
  name: d.name,
  trigger: d.trigger,
  plan: d.plan,
  layout: d.layout,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What starts a flow, in a few words: «Nuevo correo», a schedule, by hand. */
export function triggerText(t: T, on: Record<string, unknown>): string {
  if (typeof on.created === "string") return t("flows.on.created", { what: on.created });
  if (on.schedule && typeof on.schedule === "object") {
    const s = on.schedule as { every?: unknown; at?: unknown; day?: unknown };
    const at = typeof s.at === "string" ? s.at : "";
    if (s.every === "hour") return t("flows.on.hour");
    if (s.every === "week")
      return t("flows.on.week", { day: t(`flows.day.${Number(s.day ?? 1)}`), at });
    return t("flows.on.day", { at });
  }
  if (on.manual) return t("flows.on.manual");
  return t("flows.on.other");
}

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
  },
  "step"
>;
type TriggerCard = Node<{ text: string; inputs: string[]; bad: boolean; on: boolean }, "trigger">;
type Card = StepCard | TriggerCard;

/** A step's line in a test: what it would do, what it gave, or why it did not run. */
export function testLine(t: T, x: TestStepView): string {
  const w = x.would[0];
  if (w) {
    const what = [
      w.title,
      w.type ? t("flows.test.in", { type: w.type }) : null,
      w.text ? `«${w.text}»` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return t(`flows.test.would.${w.decision}`, { what });
  }
  if (x.decision === "skip") return t("flows.test.skipped");
  if (x.decision === "deny" || x.decision === "stopped")
    return t("flows.test.stopped", { why: x.rule ?? x.error ?? "" });
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
  const ran = Object.values(data.ran).reduce((a, b) => a + b, 0);
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
      className={`fl-card ${step.op === "read" ? "model" : "code"}${data.bad ? " bad" : ""}${data.on ? " on" : ""}${data.test === null ? " idle" : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="fl-head">
        <span className="fl-icon">{icon}</span>
        <span className="fl-name">{data.name}</span>
        {step.each !== undefined && <span className="fl-badge">{t("flows.each")}</span>}
        {step.when !== undefined && <span className="fl-badge">{t("flows.when")}</span>}
      </div>
      {(data.detail || ran > 0 || data.test) && (
        <div className="fl-body">
          {data.detail && <div className="fl-line">{data.detail}</div>}
          {data.test && <div className="fl-line fl-test">{testLine(t, data.test)}</div>}
          {ran > 0 && !data.test && (
            <div className="fl-line muted">
              {t(ran === 1 ? "flows.ran.one" : "flows.ran", { n: ran })}
              {data.ran.propose ? ` · ${t("flows.proposed", { n: data.ran.propose })}` : ""}
              {data.ran.deny ? ` · ${t("flows.denied", { n: data.ran.deny })}` : ""}
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const TriggerView = memo(function TriggerView({ data }: NodeProps<TriggerCard>) {
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
              <span>${i}</span>
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const NODE_TYPES: NodeTypes = { step: StepView, trigger: TriggerView };

/** The nodes of a draft: the trigger first, then each step; where the user left them, else laid out. */
function nodesOf(
  t: T,
  draft: Draft,
  detail: FlowDetailView,
  catalog: FlowCatalog | null,
  problems: readonly FlowProblem[],
  selected: string | null,
  test: FlowTestView | null,
): { nodes: Card[]; edges: Edge[] } {
  const inputs =
    typeof draft.trigger.created === "string"
      ? detail.inputs.map((i) => i.id)
      : formNames(draft.trigger);
  const ids = new Set(draft.plan.steps.map((s) => s.id));
  const links: { from: string; to: string }[] = [];
  for (const s of draft.plan.steps) {
    let fromTrigger = false;
    for (const d of depsOf(s)) {
      if (ids.has(d)) links.push({ from: d, to: s.id });
      else fromTrigger = true;
    }
    if (fromTrigger) links.push({ from: TRIGGER, to: s.id });
  }
  const boxes = [
    { id: TRIGGER, width: WIDTH, height: 40 + Math.min(inputs.length, 9) * 18 + 8 },
    ...draft.plan.steps.map((s) => ({ id: s.id, width: WIDTH, height: 84 })),
  ];
  const auto = flowLayout(boxes, links);
  const at = (id: string) => draft.layout?.[id] ?? auto.get(id) ?? { x: 0, y: 0 };
  const ran = new Map(detail.nodes.map((n) => [n.id, n.ran]));
  const bad = new Set(problems.map((p) => p.step ?? TRIGGER));
  const collection = (s: FlowStep) => {
    const a = s.args as Record<string, unknown> | undefined;
    const k = a?.type && typeof a.type === "object" ? (a.type as { lit?: unknown }).lit : null;
    return typeof k === "string"
      ? (catalog?.collections.find((c) => c.key === k)?.name ?? k)
      : null;
  };
  const nodes: Card[] = [
    {
      id: TRIGGER,
      type: "trigger",
      position: at(TRIGGER),
      data: {
        text: triggerText(t, draft.trigger),
        inputs,
        bad: problems.some((p) => p.step === null && p.at === "trigger"),
        on: selected === TRIGGER,
      },
      className: "fl-node source",
      deletable: false,
    },
    ...draft.plan.steps.map(
      (s): StepCard => ({
        id: s.id,
        type: "step",
        position: at(s.id),
        data: {
          step: s,
          name:
            s.op === "call" && !catalog
              ? (detail.nodes.find((n) => n.id === s.id)?.title ?? stepName(t, s, catalog))
              : stepName(t, s, catalog),
          detail: s.op === "call" ? collection(s) : null,
          ran: ran.get(s.id) ?? {},
          bad: bad.has(s.id),
          on: selected === s.id,
          ...(test ? { test: test.steps[s.id] ?? null } : {}),
        },
        className: `fl-node ${s.op === "read" ? "model" : "code"}`,
      }),
    ),
  ];
  const edges: Edge[] = links.map((e) => ({
    id: `${e.from}>${e.to}`,
    source: e.from,
    target: e.to,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    className: "fl-edge",
    deletable: false,
  }));
  return { nodes, edges };
}

/** The node kinds the «Añadir paso» menu offers, in groups: what reads, what decides, the data, the rest. */
function kindsOf(
  catalog: FlowCatalog,
): { group: string; items: { kind: NodeKind; name: string }[] }[] {
  const reads = Object.keys(catalog.readers).filter(
    (r) => r !== "classify" && r !== "review_reading",
  );
  return [
    { group: "read", items: reads.map((r) => ({ kind: { op: "read", reader: r }, name: r })) },
    { group: "decide", items: [{ kind: { op: "read", reader: "classify" }, name: "classify" }] },
    {
      group: "data",
      items: catalog.tools
        .filter((x) => x.name.startsWith("entities.") || x.name === "schema.describe")
        .map((x) => ({ kind: { op: "call", tool: x.name }, name: x.name })),
    },
    {
      group: "other",
      items: [
        ...catalog.tools
          .filter((x) => !x.name.startsWith("entities.") && x.name !== "schema.describe")
          .map((x) => ({ kind: { op: "call", tool: x.name } as NodeKind, name: x.name })),
        ...catalog.asks.map((c) => ({
          kind: { op: "ask", control: c } as NodeKind,
          name: `ask.${c}`,
        })),
        ...Object.keys(catalog.replies).map((c) => ({
          kind: { op: "reply", component: c } as NodeKind,
          name: `reply.${c}`,
        })),
      ],
    },
  ];
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
  onLayout,
}: {
  draft: Draft;
  detail: FlowDetailView;
  catalog: FlowCatalog | null;
  check: FlowCheck | null;
  selected: string | null;
  test: FlowTestView | null;
  onSelect: (id: string | null) => void;
  onPlan: (p: FlowPlan) => void;
  onLayout: (l: Record<string, { x: number; y: number }> | null) => void;
}) {
  const t = useStore((s) => s.t);
  const [nodes, setNodes, onNodesChange] = useNodesState<Card>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const [linking, setLinking] = useState<{ from: string; to: string } | null>(null);
  const fitted = useRef(false);
  useEffect(() => {
    const g = nodesOf(t, draft, detail, catalog, check?.problems ?? [], selected, test);
    setNodes(g.nodes);
    setEdges(g.edges);
    if (!fitted.current) {
      fitted.current = true;
      requestAnimationFrame(() => void fitView({ padding: 0.06, duration: 200 }));
    }
  }, [t, draft, detail, catalog, check, selected, test, setNodes, setEdges, fitView]);
  const keepPositions = useCallback(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) out[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    onLayout(out);
  }, [nodes, onLayout]);
  const target = linking ? draft.plan.steps.find((s) => s.id === linking.to) : undefined;
  return (
    <div className="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={keepPositions}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        onConnect={(c: Connection) => {
          if (!c.source || !c.target || c.source === TRIGGER || c.source === c.target) return;
          setLinking({ from: c.source, to: c.target });
        }}
        onNodesDelete={(gone) => {
          let p = draft.plan;
          for (const n of gone) if (n.id !== TRIGGER) p = removeStep(p, n.id);
          onPlan(p);
          onSelect(null);
        }}
        deleteKeyCode="Delete"
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        edgesFocusable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <button
        type="button"
        className="btn small flow-arrange"
        onClick={() => {
          onLayout(null);
          requestAnimationFrame(() => void fitView({ padding: 0.06, duration: 200 }));
        }}
      >
        <LayoutGrid size={14} strokeWidth={1.8} aria-hidden />
        {t("data.arrange")}
      </button>
      {linking && target && catalog && (
        <div className="flow-link-menu" role="menu" aria-label={t("flows.useIn")}>
          <p className="flow-link-title">
            {t("flows.useIn")} · {stepName(t, target, catalog)}
          </p>
          {slotsOf(target, catalog).map((slot) => (
            <MenuRow
              key={slot.join(".")}
              label={slot.at(-1) ?? ""}
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
  onTrigger,
  onClose,
}: {
  draft: Draft;
  detail: FlowDetailView;
  onTrigger: (t: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const fixed = typeof draft.trigger.created === "string";
  const names = formNames(draft.trigger);
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
          <p>{triggerText(t, draft.trigger)}</p>
          <ul className="flow-args">
            {detail.inputs.map((i) => (
              <li key={i.id}>
                <code>${i.id}</code> <span className="muted">{t(`flows.input.${i.what}`)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <label className="flow-setting">
            <span className="flow-setting-name">{t("flows.trigger")}</span>
            <select value="manual" onChange={() => undefined}>
              <option value="manual">{t("flows.on.manual")}</option>
            </select>
          </label>
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
    </aside>
  );
}

/** The editor of one flow. `onChanged`: the server's flow after a save, a switch, a revert; null after deleting it. */
export function FlowEditor({
  detail,
  catalog,
  onChanged,
  onOpen,
}: {
  detail: FlowDetailView;
  catalog: FlowCatalog | null;
  onChanged: (d: FlowDetailView | null) => void;
  /** Another flow to show (the copy just made). */
  onOpen: (id: string) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [draft, setDraft] = useState<Draft>(() => draftOf(detail));
  const [check, setCheck] = useState<FlowCheck | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [running, setRunning] = useState<{ values: Record<string, string>; test: boolean } | null>(
    null,
  );
  const [test, setTest] = useState<FlowTestView | null>(null);
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
  const tryIt = async (inputs?: Record<string, string>) => {
    setTesting(true);
    setError(null);
    try {
      setTest(
        await agentApi.testFlow(detail.id, {
          plan: draft.plan,
          trigger: draft.trigger,
          ...(inputs ? { inputs } : {}),
        }),
      );
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
        layout: draft.layout,
      }),
    );
  const add = (kind: NodeKind) => {
    const step = newStep(draft.plan, kind);
    const after =
      selected && selected !== TRIGGER ? selected : (draft.plan.steps.at(-1)?.id ?? null);
    setPlan(addStep(draft.plan, step, after));
    setSelected(step.id);
  };
  const step = draft.plan.steps.find((s) => s.id === selected);
  const manual = !!draft.trigger.manual;
  const when = (ms: number) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);
  const kinds = useMemo(() => (catalog ? kindsOf(catalog) : []), [catalog]);
  return (
    <section className="flow-detail flow-editor">
      <div className="flow-toolbar">
        <input
          className="flow-name"
          aria-label={t("flows.name")}
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.slice(0, 80) }))}
        />
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
        {catalog && (
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
              <div className="flow-kinds">
                {kinds.map((g) => (
                  <div key={g.group} className="flow-kind-group">
                    <p className="menu-head">{t(`flows.group.${g.group}`)}</p>
                    {g.items.map((it) => (
                      <MenuRow
                        key={it.name}
                        label={kindName(t, it.kind, catalog)}
                        onClick={() => {
                          add(it.kind);
                          close();
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </PopButton>
        )}
        <button
          type="button"
          className={`btn small${testing ? " busy" : ""}`}
          disabled={busy || testing || problems.length > 0 || !draft.plan.steps.length}
          aria-busy={testing}
          onClick={() => {
            const names = formNames(draft.trigger);
            if (manual && names.length)
              setRunning({ values: Object.fromEntries(names.map((n) => [n, ""])), test: true });
            else void tryIt();
          }}
        >
          <FlaskConical size={14} strokeWidth={1.8} aria-hidden />
          {testing ? t("flows.testing") : t("flows.test")}
        </button>
        {manual && detail.enabled && !dirty && (
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
        {dirty && (
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => setDraft(draftOf(detail))}
          >
            {t("flows.discard")}
          </button>
        )}
        <button
          type="button"
          className="btn primary small"
          disabled={!dirty || busy || problems.length > 0}
          onClick={() => void save()}
        >
          {t("flows.save")}
        </button>
        <PopButton
          label={<MoreHorizontal size={16} strokeWidth={1.8} />}
          title={t("page.more")}
          width={240}
        >
          {(close) => (
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
            const { values, test: dry } = running;
            setRunning(null);
            if (dry) void tryIt(values);
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
            onLayout={(layout) => setDraft((d) => ({ ...d, layout }))}
          />
        </ReactFlowProvider>
        {selected === TRIGGER && (
          <TriggerPanel
            draft={draft}
            detail={detail}
            onTrigger={(trigger) => setDraft((d) => ({ ...d, trigger }))}
            onClose={() => setSelected(null)}
          />
        )}
        {step && catalog && (
          <FlowStepPanel
            step={step}
            plan={draft.plan}
            catalog={catalog}
            refs={check?.refs[step.id] ?? []}
            problems={problems.filter((p) => p.step === step.id)}
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
