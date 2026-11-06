/**
 * A run drawn on the flow canvas (the Recorrido, docs/flujos.md F3; task 59c): the trigger with what it bound, each
 * step as the flow editor names it, downwards in the order the run went (as its flow's canvas), and on each node what
 * came of it: the policy's decision (done, proposed, stopped, skipped) and the first line of what a model answered. Read
 * only; a click on a node brings its line of the steps' list into view. It replaces the SVG diagram of task 52.
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
import type { RunDetail, RunStep } from "../core/agent.ts";
import { stepLayout } from "../core/flowLayout.ts";
import { useStore } from "../store.ts";
import { inputName } from "./FlowStepPanel.tsx";

const WIDTH = 200;
const TRIGGER = "trigger";
type T = (k: string, p?: Record<string, string | number>) => string;

type StepCard = Node<{ step: RunStep; name: string; line: string; answer: string | null }, "step">;
type TriggerCard = Node<{ inputs: string[]; text: string }, "trigger">;
type Card = StepCard | TriggerCard;

/** A step's name as the flow editor gives it: a reader's in a word, a tool's title, a question or a reply. */
function nameOf(t: T, s: RunStep): string {
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

/** What came of a step, in a word or two (also the map's, with a run on it). */
export function runStepLine(t: T, s: RunStep): string {
  if (s.error) return t("run.node.stopped", { why: s.error });
  if (s.decision === null) return t("run.node.never");
  const k = `run.node.${s.decision}`;
  const v = t(k, { rule: s.rule ?? "" });
  return v === k ? s.decision : v;
}

const StepView = memo(function StepView({ data }: NodeProps<StepCard>) {
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
  const bad = !!step.error || step.decision === "deny" || step.decision === "stopped";
  return (
    <div
      className={`fl-card ${step.op === "read" ? "model" : "code"}${bad ? " bad" : ""}${step.decision === null || step.decision === "skip" ? " idle" : ""}`}
    >
      <Handle type="target" position={Position.Top} />
      <div className="fl-head">
        <span className="fl-icon">{icon}</span>
        <span className="fl-name">{data.name}</span>
      </div>
      <div className="fl-body">
        <div className="fl-line fl-test">{data.line}</div>
        {data.answer && <div className="fl-line muted fl-answer">{data.answer}</div>}
      </div>
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

/** A model's answer's first words (it is the user's own content: plain text). */
const firstWords = (a: string | undefined) => {
  if (!a) return null;
  const line = a
    .replace(/[{}"[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line ? (line.length > 90 ? `${line.slice(0, 87)}…` : line) : null;
};

function Canvas({ detail, onPick }: { detail: RunDetail; onPick: (id: string) => void }) {
  const t = useStore((s) => s.t);
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(() => {
    const steps = detail.steps;
    const withTrigger = detail.inputs.length > 0;
    // Downwards in the order the run went (the same as its flow's canvas, docs/sistema.md §4.4): what did not run is
    // greyed in its place.
    const l = stepLayout(
      steps.map((s) => ({ id: s.id, op: s.op })),
      {
        trigger: withTrigger
          ? { id: TRIGGER, height: 40 + Math.min(detail.inputs.length, 9) * 18 + 8 }
          : null,
        width: WIDTH,
        height: (id) => (steps.find((s) => s.id === id)?.answers.length ? 96 : 76),
        gapY: 30,
      },
    );
    const at = l.at;
    const links = l.links;
    const nodes: Card[] = [
      ...(withTrigger
        ? [
            {
              id: TRIGGER,
              type: "trigger" as const,
              position: at.get(TRIGGER) ?? { x: 0, y: 0 },
              data: {
                inputs: detail.inputs,
                text: detail.flow ? t("run.trigger.flow") : t("run.trigger.code"),
              },
              className: "fl-node source",
            },
          ]
        : []),
      ...steps.map(
        (s): StepCard => ({
          id: s.id,
          type: "step",
          position: at.get(s.id) ?? { x: 0, y: 0 },
          data: {
            step: s,
            name: nameOf(t, s),
            line: runStepLine(t, s),
            answer: firstWords(s.answers[0]),
          },
          // A click picks its line in the list below, never starts a pan.
          className: `fl-node ${s.op === "read" ? "model" : "code"} nopan`,
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
  }, [detail, t]);
  useEffect(() => {
    requestAnimationFrame(() => void fitView({ padding: 0.08, maxZoom: 1 }));
  }, [fitView]);
  return (
    <div className="flow-canvas run-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={(_, n) => n.id !== TRIGGER && onPick(n.id)}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.6}
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

export function RunCanvas({ detail }: { detail: RunDetail }) {
  if (!detail.steps.length) return null;
  return (
    <ReactFlowProvider>
      <Canvas
        detail={detail}
        onPick={(id) =>
          document
            .getElementById(`trace-step-${id}`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" })
        }
      />
    </ReactFlowProvider>
  );
}
