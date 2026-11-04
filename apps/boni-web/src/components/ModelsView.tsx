/**
 * «Modelos» (task 59b; Juan, 2026-11-04: see what every model does and how they work together): the flow Boni
 * declares (packages/agent pipeline.ts) as a canvas, with the journal's numbers of the last days on each node and
 * arrow (the server's `GET /api/agent/pipeline`), and below it what configures the models (ModelsSettings, until
 * 2026-11-04 in Ajustes). A model's node names its model; a click on it opens its panel below. Docs:
 * docs/design-guide.md «Modelos».
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
import { Bot, Braces, Database, Inbox, LayoutGrid, Mail, MessageSquare, User } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { FlowNode, FlowView, ModelRole, ModelsView as Models } from "../core/agent.ts";
import { flowLayout } from "../core/flowLayout.ts";
import { agentApi, errorText, useStore } from "../store.ts";
import { ModelsSettings } from "./ModelsSettings.tsx";

const WIDTH = 200;
const heightOf = (n: FlowNode): number => (n.kind === "model" ? 98 : n.kind === "source" ? 62 : 56);
const PERIODS = [7, 30] as const;

type Card = Node<{ node: FlowNode; model: string | null; locale: string }, "flow">;

/** What a node is, by its kind: the icon that says it. */
function Icon({ node }: { node: FlowNode }) {
  const size = 14;
  const sw = 1.8;
  if (node.kind === "model") return <Bot size={size} strokeWidth={sw} aria-hidden />;
  if (node.kind === "inbox") return <Inbox size={size} strokeWidth={sw} aria-hidden />;
  if (node.kind === "user") return <User size={size} strokeWidth={sw} aria-hidden />;
  if (node.kind === "store") return <Database size={size} strokeWidth={sw} aria-hidden />;
  if (node.kind === "code") return <Braces size={size} strokeWidth={sw} aria-hidden />;
  if (node.id === "mail") return <Mail size={size} strokeWidth={sw} aria-hidden />;
  return <MessageSquare size={size} strokeWidth={sw} aria-hidden />;
}

const CardView = memo(function CardView({ data }: NodeProps<Card>) {
  const t = useStore((s) => s.t);
  const { node, model, locale } = data;
  const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  const when = (ms: number) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);
  const a = node.accuracy;
  return (
    <div className={`fl-card ${node.kind}`}>
      <Handle type="target" position={Position.Top} />
      <div className="fl-head">
        <span className="fl-icon">
          <Icon node={node} />
        </span>
        <span className="fl-name">{t(`flow.node.${node.id}`)}</span>
      </div>
      {node.kind === "model" && (
        <div className="fl-body">
          <div className="fl-model">{model ?? "—"}</div>
          <div className="fl-line">
            {t(node.calls === 1 ? "models.calls.one" : "models.calls", { n: node.calls })}
            {node.cost > 0 && <span className="muted"> · {usd.format(node.cost)}</span>}
          </div>
          {a && a.judged > 0 && (
            <div className="fl-line">
              {t("accuracy.judged", {
                right: a.right,
                judged: a.judged,
                pct: Math.round((100 * a.right) / a.judged),
              })}
            </div>
          )}
          {node.last !== null && node.calls > 0 && (
            <div className="fl-line muted">{when(node.last)}</div>
          )}
        </div>
      )}
      {node.kind === "source" && t(`flow.runs.${node.id}`, { n: node.runs }) !== "" && (
        <div className="fl-body">
          <div className="fl-line">{t(`flow.runs.${node.id}`, { n: node.runs })}</div>
        </div>
      )}
      {node.kind !== "model" && node.kind !== "source" && a && a.judged > 0 && (
        <div className="fl-body">
          <div className="fl-line">
            {t("accuracy.judged", {
              right: a.right,
              judged: a.judged,
              pct: Math.round((100 * a.right) / a.judged),
            })}
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const NODE_TYPES: NodeTypes = { flow: CardView };

function Canvas({
  flow,
  models,
  onRole,
}: {
  flow: FlowView;
  models: Models | null;
  onRole: (r: ModelRole) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const locale = lang === "en" ? "en-GB" : "es-ES";
  const [nodes, setNodes, onNodesChange] = useNodesState<Card>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const modelOf = useCallback(
    (role: ModelRole | null) =>
      role ? (models?.roles.find((r) => r.role === role)?.model ?? null) : null,
    [models],
  );
  const build = useCallback(() => {
    const boxes = flow.nodes.map((n) => ({ id: n.id, width: WIDTH, height: heightOf(n) }));
    const l = flowLayout(boxes, flow.edges);
    setNodes(
      flow.nodes.map((n) => ({
        id: n.id,
        type: "flow",
        position: l.get(n.id) ?? { x: 0, y: 0 },
        data: { node: n, model: modelOf(n.role), locale },
        className: `fl-node ${n.kind}`,
      })),
    );
    setEdges(
      flow.edges.map((e) => ({
        id: `${e.from}>${e.to}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        label:
          e.n !== null && e.n > 0
            ? `${e.n.toLocaleString(locale)} ${t(`flow.what.${e.what}`)}`
            : t(`flow.what.${e.what}`),
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: e.n !== null && e.n > 0 ? "fl-edge busy" : "fl-edge",
      })),
    );
    requestAnimationFrame(() => void fitView({ padding: 0.06, duration: 200 }));
  }, [flow, modelOf, locale, t, setNodes, setEdges, fitView]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: built when the flow or the models change
  useEffect(() => build(), [flow, models]);
  return (
    <div className="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, n) => {
          const role = (n as Card).data.node.role;
          if (role) onRole(role);
        }}
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

export function ModelsView() {
  const t = useStore((s) => s.t);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [flow, setFlow] = useState<FlowView | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<ModelRole | null>(null);
  useEffect(() => {
    let gone = false;
    setFlow(null);
    agentApi.flow(days).then(
      (f) => !gone && setFlow(f),
      (e) => !gone && setError(errorText(t, e)),
    );
    agentApi.models().then(
      (m) => !gone && setModels(m),
      () => undefined,
    );
    return () => {
      gone = true;
    };
  }, [days, t]);
  const periods = useMemo(
    () =>
      PERIODS.map((d) => (
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
      )),
    [days, t],
  );
  return (
    <div className="content page-doc full models-page">
      <div className="doc cols">
        <h1 className="cols-title">{t("nav.models")}</h1>
        <div className="data-tools">
          <div className="segmented" role="radiogroup" aria-label={t("flow.period")}>
            {periods}
          </div>
        </div>
        {error && !flow ? (
          <p className="form-error">{error}</p>
        ) : !flow ? (
          <div className="page-loading" role="status" aria-busy="true" />
        ) : (
          <ReactFlowProvider>
            <Canvas flow={flow} models={models} onRole={setRole} />
          </ReactFlowProvider>
        )}
        <section className="models-config">
          <ModelsSettings role={role} onRole={setRole} />
        </section>
      </div>
    </div>
  );
}
