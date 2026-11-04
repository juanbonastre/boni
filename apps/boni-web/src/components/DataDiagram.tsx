/**
 * «Mis datos» as a diagram (task 59a): each collection a card with its fields, a mother a frame around her own card
 * and her daughters', a relation an arrow to the collection it points to, and «Ver como» dims what the AI does not
 * see (a private or restricted collection) or sees only as existing (an opaque one). React Flow draws it, dagre lays
 * it out (`core/diagram.ts`); a click opens the collection, a drag moves a card for the session, «Ordenar» lays it
 * out again. Docs: docs/design-guide.md «Mis datos».
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
import { Database, LayoutGrid } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { AiLevel, DataType } from "../core/agent.ts";
import {
  type Diagram,
  type DiagramCard,
  type DiagramFrame,
  diagramOf,
  type Layout,
  layoutOf,
} from "../core/diagram.ts";
import { openCollection, useStore } from "../store.ts";
import { LEVEL_ICONS } from "./Protection.tsx";

/** Whose eyes the diagram is seen with: everyone's, or the AI's (what no model reads is dimmed). */
type As = "all" | "ai";
/** What the AI sees of a level (the levels' help texts in i18n): all of it, that it exists, or nothing. */
const seen = (level: AiLevel): "all" | "exists" | "none" =>
  level === "visible" ? "all" : level === "opaque" ? "exists" : "none";
const classOf = (level: AiLevel, as: As): string => {
  if (as === "all") return "";
  const s = seen(level);
  return s === "none" ? "dim" : s === "exists" ? "half" : "";
};

type CardNode = Node<{ card: DiagramCard; names: Map<string, string> }, "card">;
type FrameNode = Node<{ frame: DiagramFrame }, "frame">;
type DiagramNode = CardNode | FrameNode;

/** A field's kind in words: the table's names where they exist, this view's for the rest. */
function kindName(t: (k: string, p?: Record<string, string | number>) => string, kind: string) {
  const own = t(`db.col.kinds.${kind}`);
  if (own !== `db.col.kinds.${kind}`) return own;
  const mine = t(`data.kind.${kind}`);
  return mine !== `data.kind.${kind}` ? mine : kind;
}

const CardView = memo(function CardView({ data }: NodeProps<CardNode>) {
  const t = useStore((s) => s.t);
  const { card, names } = data;
  return (
    <div className="dg-card">
      <Handle type="target" position={Position.Left} />
      <div className="dg-head">
        <span className="dg-icon">
          {card.icon || <Database size={13} strokeWidth={1.8} aria-hidden />}
        </span>
        <span className="dg-name">{card.name}</span>
        <span className="dg-level" title={t(`ai.level.${card.level}`)}>
          {LEVEL_ICONS[card.level]}
        </span>
        <span className="dg-count">{card.count.toLocaleString()}</span>
      </div>
      <ul className="dg-fields">
        {card.fields.map((f) => (
          <li key={f.id} className={`dg-field${f.relation ? " rel" : ""}`}>
            <span className="dg-fname">{f.name}</span>
            <span className="dg-type">
              {f.relation
                ? `→ ${names.get(f.relation.target) ?? kindName(t, "relation")}`
                : kindName(t, f.type)}
            </span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const FrameView = memo(function FrameView({ data }: NodeProps<FrameNode>) {
  return (
    <div className="dg-frame">
      <div className="dg-frame-title">
        <span className="dg-icon">
          {data.frame.icon || <Database size={13} strokeWidth={1.8} aria-hidden />}
        </span>
        {data.frame.name}
      </div>
    </div>
  );
});

const NODE_TYPES: NodeTypes = { card: CardView, frame: FrameView };

/** The nodes as React Flow wants them: a frame before what it holds, children placed relative to their frame. */
function nodesOf(d: Diagram, l: Layout, as: As): DiagramNode[] {
  const at = new Map([...l.frames, ...l.cards].map((p) => [p.id, p]));
  const names = new Map(d.cards.map((c) => [c.type, c.name]));
  const relative = (id: string, frame: string | null) => {
    const p = at.get(id) ?? { x: 0, y: 0 };
    const f = frame ? at.get(frame) : null;
    return { x: p.x - (f?.x ?? 0), y: p.y - (f?.y ?? 0) };
  };
  const frames: FrameNode[] = d.frames.map((f) => ({
    id: f.id,
    type: "frame",
    position: relative(f.id, f.frame),
    data: { frame: f },
    style: { width: at.get(f.id)?.width ?? 0, height: at.get(f.id)?.height ?? 0 },
    className: `dg-frame-node ${classOf(f.level, as)}`.trim(),
    draggable: false,
    selectable: false,
    ...(f.frame ? { parentId: f.frame } : {}),
  }));
  const cards: CardNode[] = d.cards.map((c) => ({
    id: c.id,
    type: "card",
    position: relative(c.id, c.frame),
    data: { card: c, names },
    className: `dg-card-node ${classOf(c.level, as)}`.trim(),
    ...(c.frame ? { parentId: c.frame, extent: "parent" as const } : {}),
  }));
  return [...frames, ...cards];
}

function edgesOf(d: Diagram, many: string): Edge[] {
  return d.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "smoothstep",
    label: e.many ? `${e.name} · ${many}` : e.name,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    className: "dg-edge",
  }));
}

function Canvas({ types }: { types: DataType[] }) {
  const t = useStore((s) => s.t);
  const [as, setAs] = useState<As>("all");
  const diagram = useMemo(() => diagramOf(types), [types]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const arrange = useCallback(() => {
    setNodes(nodesOf(diagram, layoutOf(diagram), as));
    setEdges(edgesOf(diagram, t("data.many")));
    requestAnimationFrame(() => void fitView({ padding: 0.08, duration: 200 }));
  }, [diagram, as, t, setNodes, setEdges, fitView]);
  // Laid out when the schema arrives or changes; «Ver como» only dims, it moves nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the schema only
  useEffect(() => arrange(), [diagram]);
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        className: `${n.type === "frame" ? "dg-frame-node" : "dg-card-node"} ${classOf(
          n.type === "frame" ? (n as FrameNode).data.frame.level : (n as CardNode).data.card.level,
          as,
        )}`.trim(),
      })),
    );
  }, [as, setNodes]);
  const pick = (v: As) => (
    <button
      type="button"
      role="radio"
      aria-checked={as === v}
      className={as === v ? "on" : ""}
      onClick={() => setAs(v)}
    >
      {t(`data.as.${v}`)}
    </button>
  );
  return (
    <>
      <div className="data-tools">
        <span className="data-tools-label">{t("data.viewAs")}</span>
        <div className="segmented" role="radiogroup" aria-label={t("data.viewAs")}>
          {pick("all")}
          {pick("ai")}
        </div>
        <button type="button" className="btn small" onClick={arrange}>
          <LayoutGrid size={14} strokeWidth={1.8} aria-hidden />
          {t("data.arrange")}
        </button>
      </div>
      <div className="data-diagram">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, n) =>
            n.type === "card" && openCollection((n as CardNode).data.card.type)
          }
          fitView
          minZoom={0.15}
          maxZoom={1.6}
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </>
  );
}

export function DataDiagram() {
  const types = useStore((s) => s.dataTypes);
  if (types === null) return <div className="page-loading" role="status" aria-busy="true" />;
  return (
    <ReactFlowProvider>
      <Canvas types={types} />
    </ReactFlowProvider>
  );
}
