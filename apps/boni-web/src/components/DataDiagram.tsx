/**
 * The collections as a diagram (task 59a; docs/flujos.md §4.7, F6): each collection a card with its fields and who
 * writes and reads it (the flows that name it, and who did in the last days), a mother a frame around her own card
 * and her daughters', a relation an arrow to the collection it points to. «Mis datos» draws them all, as one more
 * view of its collection (F6b): what its view's filter leaves out is dimmed, and its «Nuevo» makes a collection. A
 * collection's «Diagrama» view draws her branch and, as plain cards, the collections a relation joins to it, with
 * filters of its own that dim what does not match («Leída por», «Escrita por», «Nivel», «Madre») and «Nueva
 * colección». It is edited here too: a click opens the collection's panel (its level, who reads and writes it,
 * «Abrir», a new collection inside), a drag from a card's edge to another draws a relation, a card dropped on another
 * puts it inside. React Flow draws it, dagre lays it out (`core/diagram.ts`); «Ordenar» lays it out again. Docs:
 * docs/design-guide.md «Mis datos».
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
import { Database, Eye, LayoutGrid, PenLine, Plus } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { AiLevel, DataType, DataUsage, Who } from "../core/agent.ts";
import {
  cardHeight,
  type Diagram,
  type DiagramCard,
  type DiagramFrame,
  diagramOf,
  type Layout,
  layoutOf,
} from "../core/diagram.ts";
import {
  addRelation,
  loadDataUsage,
  moveInTree,
  newCollection,
  openCollection,
  toast,
  useStore,
} from "../store.ts";
import { LEVEL_ICONS, ProtectionMenu } from "./Protection.tsx";

const LEVELS: AiLevel[] = ["visible", "opaque", "restricted", "private"];
/** How many names a card says of who writes it and who reads it. */
const SHOWN = 2;

/** A collection's «Diagrama» filters («Mis datos» filters with its view's «Filtrar»). */
interface Filters {
  reader: string;
  writer: string;
  level: string;
}
const NO_FILTERS: Filters = { reader: "", writer: "", level: "" };

type CardData = {
  card: DiagramCard;
  names: Map<string, string>;
  writes: Who[];
  reads: Who[];
};
type CardNode = Node<CardData, "card">;
type FrameNode = Node<{ frame: DiagramFrame }, "frame">;
type DiagramNode = CardNode | FrameNode;

/** A field's kind in words: the table's names where they exist, this view's for the rest. */
function kindName(t: (k: string, p?: Record<string, string | number>) => string, kind: string) {
  const own = t(`db.col.kinds.${kind}`);
  if (own !== `db.col.kinds.${kind}`) return own;
  const mine = t(`data.kind.${kind}`);
  return mine !== `data.kind.${kind}` ? mine : kind;
}

/** Who, in a few names: a flow by its name (off, said), the others by theirs. */
const namesOf = (list: Who[]) =>
  list
    .slice(0, SHOWN)
    .map((w) => w.name)
    .join(" · ") + (list.length > SHOWN ? ` +${list.length - SHOWN}` : "");

const CardView = memo(function CardView({ data }: NodeProps<CardNode>) {
  const t = useStore((s) => s.t);
  const { card, names, writes, reads } = data;
  return (
    <div className={`dg-card${card.related ? " related" : ""}`}>
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
      {!card.related && (
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
      )}
      {(writes.length > 0 || reads.length > 0) && (
        <div className="dg-who">
          {writes.length > 0 && (
            <div className="dg-who-line" title={t("data.writtenBy")}>
              <PenLine size={11} strokeWidth={1.8} aria-label={t("data.writtenBy")} />
              <span>{namesOf(writes)}</span>
            </div>
          )}
          {reads.length > 0 && (
            <div className="dg-who-line" title={t("data.readBy")}>
              <Eye size={11} strokeWidth={1.8} aria-label={t("data.readBy")} />
              <span>{namesOf(reads)}</span>
            </div>
          )}
        </div>
      )}
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

type LoopEdgeType = Edge<{ height: number }, "loop">;
/** A relation of a collection with itself: an arc over its own card, out of its right side and back into its left. */
function LoopEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  markerEnd,
  data,
}: EdgeProps<LoopEdgeType>) {
  const top = sourceY - ((data?.height ?? 80) / 2 + 26);
  const mid = (sourceX + targetX) / 2;
  const path = `M ${sourceX} ${sourceY} C ${sourceX + 48} ${sourceY} ${sourceX + 48} ${top} ${mid} ${top} C ${targetX - 48} ${top} ${targetX - 48} ${targetY} ${targetX} ${targetY}`;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="dg-edge" />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="dg-loop-label"
            style={{ transform: `translate(-50%, -50%) translate(${mid}px, ${top}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const EDGE_TYPES: EdgeTypes = { loop: LoopEdge };

const usageOf = (usage: DataUsage | null, type: string) =>
  usage?.types[type] ?? { reads: [], writes: [] };

/** The nodes as React Flow wants them: a frame before what it holds, children placed relative to their frame. */
function nodesOf(d: Diagram, l: Layout, usage: DataUsage | null): DiagramNode[] {
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
    className: "dg-frame-node",
    draggable: false,
    selectable: false,
    ...(f.frame ? { parentId: f.frame } : {}),
  }));
  const cards: CardNode[] = d.cards.map((c) => {
    const u = usageOf(usage, c.type);
    return {
      id: c.id,
      type: "card",
      position: relative(c.id, c.frame),
      data: { card: c, names, writes: u.writes, reads: u.reads },
      className: "dg-card-node",
      ...(c.frame ? { parentId: c.frame, extent: "parent" as const } : {}),
    };
  });
  return [...frames, ...cards];
}

function edgesOf(d: Diagram, many: string): Edge[] {
  return d.edges.map((e) => {
    const self = e.from === e.to;
    const card = self ? d.cards.find((c) => c.id === e.from) : undefined;
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: self ? "loop" : "smoothstep",
      ...(card ? { data: { height: cardHeight(card.fields.length, card.lines) } } : {}),
      label: e.many ? `${e.name} · ${many}` : e.name,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      className: "dg-edge",
    };
  });
}

/** Lines a card has under its fields: one for who writes it, one for who reads it. */
const linesOf = (usage: DataUsage | null) => (type: string) => {
  const u = usageOf(usage, type);
  return (u.writes.length ? 1 : 0) + (u.reads.length ? 1 : 0);
};

/** Whether a collection matches the filters (the others are dimmed, nothing moves). */
function matches(f: Filters, card: DiagramCard, usage: DataUsage | null) {
  const u = usageOf(usage, card.type);
  if (f.reader && !u.reads.some((w) => w.id === f.reader)) return false;
  if (f.writer && !u.writes.some((w) => w.id === f.writer)) return false;
  if (f.level && card.level !== f.level) return false;
  return true;
}

/** Everyone who reads (or writes) something in the diagram, once each, flows first. */
function whoOptions(usage: DataUsage | null, types: Set<string>, side: "reads" | "writes"): Who[] {
  const seen = new Map<string, Who>();
  for (const [type, u] of Object.entries(usage?.types ?? {}))
    if (types.has(type)) for (const w of u[side]) if (!seen.has(w.id)) seen.set(w.id, w);
  return [...seen.values()].sort(
    (a, b) => Number(b.kind === "flow") - Number(a.kind === "flow") || a.name.localeCompare(b.name),
  );
}

function Canvas({
  types,
  root,
  only,
}: {
  types: DataType[];
  root: string | null;
  /** «Mis datos» (no `root`): the collections its view's filter keeps; the rest dimmed. All, when none. */
  only?: Set<string>;
}) {
  const t = useStore((s) => s.t);
  const usage = useStore((s) => s.dataUsage);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [picked, setPicked] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ parent: string | null } | null>(null);
  const diagram = useMemo(() => diagramOf(types, root, linesOf(usage)), [types, root, usage]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, getIntersectingNodes } = useReactFlow();
  useEffect(() => {
    void loadDataUsage();
  }, []);
  const arrange = useCallback(() => {
    setNodes(nodesOf(diagram, layoutOf(diagram), usage));
    setEdges(edgesOf(diagram, t("data.many")));
    requestAnimationFrame(() => void fitView({ padding: 0.08, duration: 200 }));
  }, [diagram, usage, t, setNodes, setEdges, fitView]);
  // Laid out when the schema or who uses it changes; the filters only dim, they move nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on the diagram only
  useEffect(() => arrange(), [diagram]);
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) =>
        n.type === "card"
          ? {
              ...n,
              className: `dg-card-node${(root === null ? !only || only.has((n as CardNode).data.card.type) : matches(filters, (n as CardNode).data.card, usage)) ? "" : " dim"}`,
            }
          : n,
      ),
    );
  }, [filters, usage, types, only, root, setNodes]);
  const shown = useMemo(() => new Set(diagram.cards.map((c) => c.type)), [diagram]);
  const readers = useMemo(() => whoOptions(usage, shown, "reads"), [usage, shown]);
  const writers = useMemo(() => whoOptions(usage, shown, "writes"), [usage, shown]);
  const typeOfNode = (id: string | null) =>
    id ? (diagram.cards.find((c) => c.id === id)?.type ?? null) : null;
  // A relation drawn from one card to another: a column of the first, pointing to the second.
  const connect = (c: Connection) => {
    const from = typeOfNode(c.source);
    const to = typeOfNode(c.target);
    if (from && to && !types.find((x) => x.id === from)?.readOnly) void addRelation(from, to);
  };
  // A card left on another (or on a frame): it goes inside that collection; «Deshacer» takes it out again.
  const dropped = (n: DiagramNode) => {
    if (n.type !== "card") return;
    const card = (n as CardNode).data.card;
    if (card.frame) return;
    const hit = getIntersectingNodes(n).find(
      (x) => x.id !== n.id && (x.type === "card" || x.type === "frame"),
    );
    const into = hit
      ? hit.type === "card"
        ? (hit as CardNode).data.card.type
        : (hit as FrameNode).data.frame.type
      : null;
    if (!into || into === card.type) return;
    const name = types.find((x) => x.id === into)?.name ?? "";
    void moveInTree({ collection: card.type }, into).then(() =>
      toast(t("data.movedInto", { name: card.name, into: name }), {
        label: t("toast.undo"),
        run: () => void moveInTree({ collection: card.type }, null),
      }),
    );
  };
  const select = (key: keyof Filters, label: string, options: { id: string; name: string }[]) => (
    <label className="data-filter">
      <span className="data-tools-label">{label}</span>
      <select
        value={filters[key]}
        onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
      >
        <option value="">{t("data.filter.any")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  const pickedType = types.find((x) => x.id === picked) ?? null;
  return (
    <>
      <div className="data-tools">
        {/* In «Mis datos» its view's «Filtrar» and «Nuevo» do this (the header above). */}
        {root !== null && (
          <>
            {select("reader", t("data.readBy"), readers)}
            {select("writer", t("data.writtenBy"), writers)}
            {select(
              "level",
              t("data.level"),
              LEVELS.map((l) => ({ id: l, name: t(`ai.level.${l}`) })),
            )}
          </>
        )}
        <span className="spacer" />
        {root !== null && (
          <button type="button" className="btn small" onClick={() => setNaming({ parent: root })}>
            <Plus size={14} strokeWidth={1.8} aria-hidden />
            {t("data.newCollection")}
          </button>
        )}
        <button type="button" className="btn small" onClick={arrange}>
          <LayoutGrid size={14} strokeWidth={1.8} aria-hidden />
          {t("data.arrange")}
        </button>
      </div>
      {naming && (
        <form
          className="data-new"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            const parent = naming.parent;
            setNaming(null);
            if (name) void newCollection(name, parent ?? undefined, true);
          }}
        >
          <input
            name="name"
            // biome-ignore lint/a11y/noAutofocus: the name is what the form asks for, at once
            autoFocus
            aria-label={t("data.newName")}
            placeholder={t("data.newName")}
            maxLength={80}
            onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
          />
          <button type="submit" className="btn primary small">
            {t("data.create")}
          </button>
          <button type="button" className="btn small" onClick={() => setNaming(null)}>
            {t("data.cancel")}
          </button>
        </form>
      )}
      <div className="data-stage">
        <div className="data-diagram editable">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, n) => n.type === "card" && setPicked((n as CardNode).data.card.type)}
            onPaneClick={() => setPicked(null)}
            onNodeDragStop={(_, n) => dropped(n)}
            onConnect={connect}
            isValidConnection={(c) => !!typeOfNode(c.source) && !!typeOfNode(c.target)}
            fitView
            minZoom={0.15}
            maxZoom={1.6}
            edgesFocusable={false}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {pickedType && (
          <CollectionPanel
            type={pickedType}
            usage={usageOf(usage, pickedType.id)}
            days={usage?.days ?? 30}
            onNew={() => setNaming({ parent: pickedType.id })}
            onClose={() => setPicked(null)}
          />
        )}
      </div>
    </>
  );
}

/** A collection chosen in the diagram: its level (the only permission), who writes and reads it, and what to do. */
function CollectionPanel({
  type,
  usage,
  days,
  onNew,
  onClose,
}: {
  type: DataType;
  usage: { reads: Who[]; writes: Who[] };
  days: number;
  onNew: () => void;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const list = (title: string, who: Who[]) => (
    <>
      <span className="flow-setting-name">{title}</span>
      {who.length ? (
        <ul className="data-who-list">
          {who.map((w) => (
            <li key={w.id}>
              <span>{w.name}</span>
              <span className="muted">
                {w.kind === "flow"
                  ? w.on
                    ? t("data.flowOn")
                    : t("data.flowOff")
                  : t("data.times", { n: w.n.toLocaleString(), days })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("data.nobody")}</p>
      )}
    </>
  );
  return (
    <aside className="flow-step-panel data-panel" aria-label={type.name}>
      <div className="flow-panel-head">
        <h3>
          {type.icon && <span className="db-icon">{type.icon}</span>}
          {type.name}
        </h3>
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
      <p className="muted">{t("data.records", { n: type.count.toLocaleString() })}</p>
      {!type.system && (
        <div className="data-panel-level">
          <span className="flow-setting-name">{t("data.level")}</span>
          <ProtectionMenu type={type} />
        </div>
      )}
      {list(t("data.writtenBy"), usage.writes)}
      {list(t("data.readBy"), usage.reads)}
      <div className="row">
        <button type="button" className="btn primary small" onClick={() => openCollection(type.id)}>
          {t("data.open")}
        </button>
        {!type.readOnly && (
          <button type="button" className="btn small" onClick={onNew}>
            {t("data.newInside")}
          </button>
        )}
      </div>
    </aside>
  );
}

/** «Mis datos» as a diagram (`only`: what its view's filter keeps), or one collection's («Diagrama», `root`). */
export function DataDiagram({ root = null, only }: { root?: string | null; only?: Set<string> }) {
  const types = useStore((s) => s.dataTypes);
  if (types === null) return <div className="page-loading" role="status" aria-busy="true" />;
  return (
    <ReactFlowProvider>
      <Canvas types={types} root={root} only={only} />
    </ReactFlowProvider>
  );
}
