/**
 * A flow a model proposed, drawn in the inbox (docs/flujos.md F5): its trigger with what it gives, each step named as
 * the flow editor names it with its word more (the collection), downwards in the order they run as the editor draws them;
 * against the flow it changes, what it adds in `--accent`, what it changes with a dashed `--accent` border, what it
 * takes away struck and faded. Read only.
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
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, Braces, HelpCircle, MessageSquare, Zap } from "lucide-react";
import { memo, useEffect, useMemo } from "react";
import type { FlowProposalView } from "../core/agent.ts";
import { stepLayout } from "../core/flowLayout.ts";
import { useStore } from "../store.ts";
import { triggerText } from "./FlowEditor.tsx";
import { inputName } from "./FlowStepPanel.tsx";

const WIDTH = 190;
const TRIGGER = "trigger";
type T = (k: string, p?: Record<string, string | number>) => string;
type Step = FlowProposalView["nodes"][number];

type StepCard = Node<{ step: Step; name: string }, "step">;
type TriggerCard = Node<{ inputs: string[]; text: string }, "trigger">;
type Card = StepCard | TriggerCard;

/** A step's name as the flow editor gives it. */
function nameOf(t: T, s: Step): string {
  if (s.op === "read") {
    const k = `flow.node.${s.what}`;
    const v = t(k);
    return v === k ? s.what : v;
  }
  if (s.op === "call") return s.title ?? s.what;
  if (s.op === "ask") return t("flows.op.ask");
  if (s.op === "reply") return t("flows.op.reply");
  return s.what;
}

const StepView = memo(function StepView({ data }: NodeProps<StepCard>) {
  const t = useStore((s) => s.t);
  const { step } = data;
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
      className={`fl-card ${step.op === "read" ? "model" : "code"}${step.change === "same" ? "" : ` ${step.change}`}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="fl-head">
        <span className="fl-icon">{icon}</span>
        <span className="fl-name">{data.name}</span>
      </div>
      {(step.detail || step.change !== "same") && (
        <div className="fl-body">
          {step.detail && <div className="fl-line">{step.detail}</div>}
          {step.change !== "same" && (
            <div className="fl-line fl-change">{t(`inbox.flow.${step.change}`)}</div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const TriggerView = memo(function TriggerView({ data }: NodeProps<TriggerCard>) {
  const t = useStore((s) => s.t);
  return (
    <div className="fl-card source">
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
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

const NODE_TYPES: NodeTypes = { step: StepView, trigger: TriggerView };

function Canvas({ flow }: { flow: FlowProposalView }) {
  const t = useStore((s) => s.t);
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(() => {
    // Downwards in the order its steps run, as the flow editor draws it (docs/sistema.md §4.4).
    const l = stepLayout(
      flow.nodes.map((s) => ({ id: s.id, op: s.op })),
      {
        trigger: { id: TRIGGER, height: 40 + Math.min(flow.inputs.length, 9) * 18 + 8 },
        width: WIDTH,
        height: (id) => (flow.nodes.find((s) => s.id === id)?.detail ? 72 : 52),
        gapY: 30,
      },
    );
    const at = l.at;
    const links = l.links;
    const nodes: Card[] = [
      {
        id: TRIGGER,
        type: "trigger",
        position: at.get(TRIGGER) ?? { x: 0, y: 0 },
        data: { inputs: flow.inputs.map((i) => i.id), text: triggerText(t, flow.trigger) },
        className: "fl-node source",
      },
      ...flow.nodes.map(
        (s): StepCard => ({
          id: s.id,
          type: "step",
          position: at.get(s.id) ?? { x: 0, y: 0 },
          data: { step: s, name: nameOf(t, s) },
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
      className: "fl-edge order",
    }));
    return { nodes, edges };
  }, [flow, t]);
  useEffect(() => {
    requestAnimationFrame(() => void fitView({ padding: 0.08, maxZoom: 1 }));
  }, [fitView]);
  return (
    <div className="flow-canvas flow-preview">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function FlowPreview({ flow }: { flow: FlowProposalView }) {
  return (
    <ReactFlowProvider>
      <Canvas flow={flow} />
    </ReactFlowProvider>
  );
}
