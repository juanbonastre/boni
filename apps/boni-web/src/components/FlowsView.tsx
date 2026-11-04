/**
 * «Flujos» (docs/flujos.md, F1): the account's flows, each a plan with a trigger kept as data, with their runs; one
 * of them drawn (its trigger with what it binds, its steps as nodes named from the registry, its references as
 * arrows, how often each step ran in the period); and, as a tab, «Modelos» (task 59b: the models' flow with the
 * journal's numbers, and what configures them). Read-only until F2 (the editor). Docs: docs/design-guide.md «Flujos».
 */
import {
  Background,
  BackgroundVariant,
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
import { Bot, Braces, HelpCircle, LayoutGrid, MessageSquare, Play, Zap } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import type { FlowDetailView, FlowStepNode, FlowSummary } from "../core/agent.ts";
import { flowLayout } from "../core/flowLayout.ts";
import { agentApi, errorText, useStore } from "../store.ts";
import { ModelsPanel } from "./ModelsView.tsx";

const WIDTH = 200;
const PERIODS = [7, 30] as const;
const TRIGGER = "trigger";

type StepCard = Node<{ step: FlowStepNode; period: number }, "step">;
type TriggerCard = Node<{ flow: FlowDetailView }, "trigger">;
type Card = StepCard | TriggerCard;

/** A reader's name («Lectora»), a tool's title from the registry («Crear»), or what the step is. */
function stepName(t: (k: string) => string, s: FlowStepNode): string {
  if (s.op === "read") {
    const k = `flow.node.${s.what}`;
    const name = t(k);
    return name === k ? s.what : name;
  }
  if (s.op === "call") return s.title ?? s.what;
  if (s.op === "ask") return t("flows.op.ask");
  if (s.op === "reply") return t("flows.op.reply");
  return s.what || s.op;
}

const StepView = memo(function StepView({ data }: NodeProps<StepCard>) {
  const t = useStore((s) => s.t);
  const { step } = data;
  const ran = Object.values(step.ran).reduce((a, b) => a + b, 0);
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
    <div className={`fl-card ${step.op === "read" ? "model" : "code"}`}>
      <Handle type="target" position={Position.Top} />
      <div className="fl-head">
        <span className="fl-icon">{icon}</span>
        <span className="fl-name">{stepName(t, step)}</span>
        {step.each && <span className="fl-badge">{t("flows.each")}</span>}
        {step.when && <span className="fl-badge">{t("flows.when")}</span>}
      </div>
      {(step.detail || ran > 0) && (
        <div className="fl-body">
          {step.detail && <div className="fl-line">{step.detail}</div>}
          {ran > 0 && (
            <div className="fl-line muted">
              {t(ran === 1 ? "flows.ran.one" : "flows.ran", { n: ran })}
              {step.ran.propose ? ` · ${t("flows.proposed", { n: step.ran.propose })}` : ""}
              {step.ran.deny ? ` · ${t("flows.denied", { n: step.ran.deny })}` : ""}
            </div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const TriggerView = memo(function TriggerView({ data }: NodeProps<TriggerCard>) {
  const t = useStore((s) => s.t);
  const { flow } = data;
  return (
    <div className="fl-card source">
      <div className="fl-head">
        <span className="fl-icon">
          <Zap size={14} strokeWidth={1.8} aria-hidden />
        </span>
        <span className="fl-name">{triggerText(t, flow.trigger)}</span>
      </div>
      {flow.inputs.length > 0 && (
        <div className="fl-body">
          {flow.inputs.map((i) => (
            <div key={i.id} className="fl-line fl-input">
              <span>${i.id}</span>
              <span className="muted">{t(`flows.input.${i.what}`)}</span>
            </div>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const NODE_TYPES: NodeTypes = { step: StepView, trigger: TriggerView };

/** What starts a flow, in a few words: «Nuevo correo», a schedule, by hand. */
function triggerText(
  t: (k: string, p?: Record<string, string | number>) => string,
  on: Record<string, unknown>,
): string {
  if (typeof on.created === "string") return t("flows.on.created", { what: on.created });
  if (typeof on.schedule === "string") return t("flows.on.schedule", { when: on.schedule });
  if (on.manual) return t("flows.on.manual");
  return t("flows.on.other");
}

function FlowCanvas({
  flow,
  onPick,
}: {
  flow: FlowDetailView;
  onPick: (s: FlowStepNode | null) => void;
}) {
  const t = useStore((s) => s.t);
  const [nodes, setNodes, onNodesChange] = useNodesState<Card>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const build = useCallback(() => {
    const inputs = new Set(flow.inputs.map((i) => i.id));
    const boxes = [
      { id: TRIGGER, width: WIDTH, height: 40 + Math.min(flow.inputs.length, 9) * 18 + 8 },
      ...flow.nodes.map((n) => ({
        id: n.id,
        width: WIDTH,
        height: 40 + (n.detail || Object.keys(n.ran).length ? 40 : 4),
      })),
    ];
    const links: { from: string; to: string }[] = [];
    for (const n of flow.nodes) {
      let fromTrigger = false;
      for (const d of n.deps) {
        if (inputs.has(d)) fromTrigger = true;
        else links.push({ from: d, to: n.id });
      }
      if (fromTrigger) links.push({ from: TRIGGER, to: n.id });
    }
    const l = flowLayout(boxes, links);
    setNodes([
      {
        id: TRIGGER,
        type: "trigger",
        position: l.get(TRIGGER) ?? { x: 0, y: 0 },
        data: { flow },
        className: "fl-node source",
      },
      ...flow.nodes.map(
        (n): StepCard => ({
          id: n.id,
          type: "step",
          position: l.get(n.id) ?? { x: 0, y: 0 },
          data: { step: n, period: flow.days },
          className: `fl-node ${n.op === "read" ? "model" : "code"}`,
        }),
      ),
    ]);
    setEdges(
      links.map((e) => ({
        id: `${e.from}>${e.to}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: "fl-edge",
      })),
    );
    requestAnimationFrame(() => void fitView({ padding: 0.06, duration: 200 }));
  }, [flow, setNodes, setEdges, fitView]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: built when the flow changes
  useEffect(() => build(), [flow]);
  return (
    <div className="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => onPick(n.type === "step" ? (n as StepCard).data.step : null)}
        onPaneClick={() => onPick(null)}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <button type="button" className="btn small flow-arrange" onClick={build}>
        <LayoutGrid size={14} strokeWidth={1.8} aria-hidden />
        {t("data.arrange")}
      </button>
    </div>
  );
}

/** The flows as rows: name, what starts them, on or off, runs, the last one, the version. */
function FlowList({
  flows,
  picked,
  onPick,
}: {
  flows: FlowSummary[];
  picked: string | null;
  onPick: (id: string) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const when = (ms: number) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);
  if (!flows.length) return <p className="cols-empty">{t("flows.none")}</p>;
  return (
    <table className="db-table cols-table flows-table">
      <thead>
        <tr>
          <th>{t("flows.name")}</th>
          <th>{t("flows.trigger")}</th>
          <th>{t("flows.state")}</th>
          <th className="num">{t("flows.runs")}</th>
          <th>{t("flows.last")}</th>
          <th className="num">{t("flows.version")}</th>
        </tr>
      </thead>
      <tbody>
        {flows.map((f) => (
          <tr key={f.id} className={`flows-row${picked === f.id ? " on" : ""}`}>
            <td>
              <button type="button" className="cols-name" onClick={() => onPick(f.id)}>
                <Play size={13} strokeWidth={1.8} aria-hidden />
                <span>{f.name}</span>
              </button>
            </td>
            <td className="muted">{triggerText(t, f.trigger)}</td>
            <td>{f.enabled ? t("flows.enabled") : t("flows.disabled")}</td>
            <td className="num">{f.runs.toLocaleString()}</td>
            <td className="muted">{f.last === null ? "—" : when(f.last)}</td>
            <td className="num muted">v{f.version}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FlowsPanel() {
  const t = useStore((s) => s.t);
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowDetailView | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [step, setStep] = useState<FlowStepNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    agentApi.flows().then(
      (list) => {
        if (gone) return;
        setFlows(list);
        setPicked((p) => p ?? list[0]?.id ?? null);
      },
      (e) => !gone && setError(errorText(t, e)),
    );
    return () => {
      gone = true;
    };
  }, [t]);
  useEffect(() => {
    if (!picked) return;
    let gone = false;
    setDetail(null);
    setStep(null);
    agentApi.flowDetail(picked, days).then(
      (d) => !gone && setDetail(d),
      (e) => !gone && setError(errorText(t, e)),
    );
    return () => {
      gone = true;
    };
  }, [picked, days, t]);
  return (
    <>
      {error && !flows ? (
        <p className="form-error">{error}</p>
      ) : flows === null ? (
        <div className="page-loading" role="status" aria-busy="true" />
      ) : (
        <FlowList flows={flows} picked={picked} onPick={setPicked} />
      )}
      {picked && (
        <section className="flow-detail">
          <div className="data-tools">
            <h2 className="flow-title">
              {detail?.name ?? flows?.find((f) => f.id === picked)?.name}
            </h2>
            <div className="segmented" role="radiogroup" aria-label={t("flow.period")}>
              {PERIODS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={days === d}
                  className={days === d ? "on" : ""}
                  onClick={() => setDays(d)}
                >
                  {t("flow.days", { n: d })}
                </button>
              ))}
            </div>
          </div>
          {!detail ? (
            <div className="page-loading" role="status" aria-busy="true" />
          ) : (
            <div className="flow-stage">
              <ReactFlowProvider>
                <FlowCanvas flow={detail} onPick={setStep} />
              </ReactFlowProvider>
              {step && (
                <aside className="flow-step-panel">
                  <h3>{stepName(t, step)}</h3>
                  {step.detail && <p className="muted">{step.detail}</p>}
                  <h4>{t("flows.args")}</h4>
                  <ul className="flow-args">
                    {step.args.map((a) => (
                      <li key={a}>
                        <code>{a}</code>
                      </li>
                    ))}
                  </ul>
                  {step.deps.length > 0 && (
                    <p className="muted">
                      {t("flows.deps")}: {step.deps.map((d) => `$${d}`).join(", ")}
                    </p>
                  )}
                </aside>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function FlowsView() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const [tab, setTab] = useState<"flows" | "models">(
    view.kind === "flows" && view.tab === "models" ? "models" : "flows",
  );
  useEffect(() => {
    if (view.kind === "flows" && view.tab) setTab(view.tab);
  }, [view]);
  return (
    <div className="content page-doc full models-page flows-page">
      <div className="doc cols">
        <h1 className="cols-title">{t("nav.flows")}</h1>
        <div className="cols-tools">
          <div className="segmented" role="radiogroup" aria-label={t("flows.tabs")}>
            {(["flows", "models"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={tab === k}
                className={tab === k ? "on" : ""}
                onClick={() => setTab(k)}
              >
                {t(k === "flows" ? "nav.flows" : "nav.models")}
              </button>
            ))}
          </div>
        </div>
        {tab === "flows" ? <FlowsPanel /> : <ModelsPanel />}
      </div>
    </div>
  );
}
