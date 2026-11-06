/**
 * Boni's map (docs/sistema.md §4.4, F8; Juan, 2026-11-05: «un solo flujo donde se ve todo y vamos agrupando,
 * filtrando»): the view «Mapa» of «Flujos», everything that brings, starts, reads and writes the data as one picture
 * computed by the server (apps/server flowMap.ts) and never drawn by hand: the mail coming in, the collections, the
 * flows (each unfolds into its steps, in the order they run), the conversation and the guide's reviewer, the user,
 * the assistants and, when asked, the pages. Left to right, from where things come in to where they end, with each
 * arrow's verb and its number of the period. Its lenses (`core/flowLayout.ts`): something in the centre (a search, a
 * click, or «Ver en el mapa» from anywhere in the app) with how far before and after, frames by what starts a flow,
 * by collection or by package, and filters (only with a model, only what changes data, only what is on, the
 * pages). A click shows a node's panel (what comes in and goes out, its numbers, «Abrir»); a double click opens it.
 * Docs: docs/design-guide.md «Flujos».
 */
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  getBezierPath,
  getSmoothStepPath,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  HelpCircle,
  Inbox,
  Mail,
  MessageSquare,
  Plug,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  User,
  Workflow,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { FlowStepNode, MapEdge, MapNode, MapView, Origin, RunDetail } from "../core/agent.ts";
import { deviceZone } from "../core/clock.ts";
import {
  type Grouping,
  groupOf,
  LENS,
  type Lens,
  lensOf,
  mapLayout,
  stepLayout,
} from "../core/flowLayout.ts";
import { useKeptNodes } from "../core/useKeptNodes.ts";
import { phoneLayout } from "../host.ts";
import {
  agentApi,
  errorText,
  openCollection,
  openPage,
  openTrace,
  showChat,
  showFlow,
  showInbox,
  toast,
  useStore,
} from "../store.ts";
import { triggerText } from "./FlowEditor.tsx";
import { stepDetail } from "./FlowStepPanel.tsx";
import { MenuRow, PointMenu, PopButton } from "./Popover.tsx";
import { runStepLine } from "./RunCanvas.tsx";

type T = (k: string, p?: Record<string, string | number>) => string;
const PERIODS = [7, 30] as const;
const DEPTHS = [1, 2, Number.POSITIVE_INFINITY] as const;
const GROUPS: readonly Grouping[] = ["none", "trigger", "flow", "collection", "pack"];
const W = 212;
const STEP_W = 196;
const STEP_H = 50;
const FRAME_HEAD = 46;
const FRAME_PAD = 14;
const KEPT = "boni:mapLens";

/** What the map keeps on this device between visits: its filters, its grouping, its period (not its centre). */
interface Kept {
  lens: Omit<Lens, "center">;
  group: Grouping;
  days: (typeof PERIODS)[number];
}
function readKept(): Kept {
  const none: Kept = { lens: { ...LENS }, group: "none", days: 7 };
  try {
    const v = JSON.parse(localStorage.getItem(KEPT) ?? "null") as Partial<Kept> | null;
    if (!v || typeof v !== "object") return none;
    const l = (v.lens ?? {}) as Partial<Lens>;
    const depth = (d: unknown, fallback: number) =>
      d === null ? Number.POSITIVE_INFINITY : typeof d === "number" && d > 0 ? d : fallback;
    return {
      lens: {
        before: depth(l.before, 1),
        after: depth(l.after, 1),
        ai: l.ai === true,
        writes: l.writes === true,
        on: l.on === true,
        happened: l.happened === true,
        pages: l.pages === true,
      },
      group: GROUPS.includes(v.group as Grouping) ? (v.group as Grouping) : "none",
      days: v.days === 30 ? 30 : 7,
    };
  } catch {
    return none;
  }
}
function keep(k: Kept) {
  try {
    // Infinity is not JSON: «Todo» is kept as null.
    const depth = (d: number) => (Number.isFinite(d) ? d : null);
    localStorage.setItem(
      KEPT,
      JSON.stringify({
        ...k,
        lens: { ...k.lens, before: depth(k.lens.before), after: depth(k.lens.after) },
      }),
    );
  } catch {}
}

/** A node's name: its own (a collection, a flow, a page, an assistant), or Boni's word for it. */
export function mapNodeName(t: T, n: MapNode): string {
  if (n.kind === "actor" && n.code === "assistant")
    return t("map.node.assistant", { name: n.name ?? "" });
  if (n.name) return n.name;
  return t(`map.node.${n.code ?? n.kind}`);
}

/** A step of a flow on the map, as the editor names it. */
function stepNodeName(t: T, s: FlowStepNode): string {
  if (s.op === "read") {
    const k = `flow.node.${s.what}`;
    const v = t(k);
    return v === k ? s.what : v;
  }
  if (s.op === "call") return s.title ?? s.what;
  if (s.op === "ask") return t("flows.op.ask");
  if (s.op === "reply") return t("flows.op.reply");
  return s.op;
}

function KindIcon({ n, size = 14 }: { n: Pick<MapNode, "kind" | "code">; size?: number }) {
  const p = { size, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (n.kind === "connector") return <Mail {...p} />;
  if (n.kind === "collection") return <Database {...p} />;
  if (n.kind === "flow") return <Workflow {...p} />;
  if (n.kind === "page") return <FileText {...p} />;
  if (n.kind === "boni")
    return n.code === "review" ? (
      <Sparkles {...p} />
    ) : n.code === "inbox" ? (
      <Inbox {...p} />
    ) : (
      <MessageSquare {...p} />
    );
  if (n.code === "assistant") return <Plug {...p} />;
  if (n.code === "import") return <Upload {...p} />;
  return <User {...p} />;
}
function StepIcon({ op }: { op: string }) {
  const p = { size: 13, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (op === "read") return <Bot {...p} />;
  if (op === "ask") return <HelpCircle {...p} />;
  if (op === "reply") return <MessageSquare {...p} />;
  return <Braces {...p} />;
}

/** The models a node uses: those that answered in the period, else those its roles are set to. */
function modelsOf(n: MapNode, byRole: Record<string, string>): string[] {
  if (n.models.length) return n.models;
  return [...new Set(n.roles.flatMap((r) => (byRole[r] ? [byRole[r] as string] : [])))];
}

/** A node's line under its name: what it holds or what starts it, and its numbers of the period. */
function lineOf(
  t: T,
  n: MapNode,
  money: (usd: number) => string,
  keyName: (key: string) => string | undefined,
): string[] {
  const out: string[] = [];
  // The Bandeja: what waits in it now.
  if (n.kind === "boni" && n.code === "inbox")
    return [
      n.pending
        ? t(n.pending === 1 ? "map.pending.one" : "map.pending", { n: n.pending })
        : t("map.pending.none"),
    ];
  if (n.kind === "collection")
    out.push(t(n.rows === 1 ? "map.rows.one" : "map.rows", { n: n.rows ?? 0 }));
  if (n.kind === "flow" && n.trigger) out.push(triggerText(t, n.trigger, keyName));
  if (n.kind === "flow" || n.kind === "boni") {
    const runs =
      n.code === "chat"
        ? t(n.runs === 1 ? "map.turns.one" : "map.turns", { n: n.runs })
        : t(n.runs === 1 ? "map.runs.one" : "map.runs", { n: n.runs });
    out.push(n.cost > 0 ? `${runs} · ${money(n.cost)}` : runs);
  }
  if (n.kind === "connector") out.push(t("map.sub.connector"));
  if (n.kind === "actor") out.push(t(`map.sub.${n.code ?? "user"}`));
  if (n.kind === "page") out.push(t("map.sub.page"));
  return out;
}

type CardData = {
  node: MapNode;
  name: string;
  lines: string[];
  models: string[];
  hot: boolean;
  dim: boolean;
  /** On the way of the run drawn on the map. */
  way: boolean;
  centre: boolean;
  open: boolean;
  onFold: (id: string) => void;
};
type FrameData = { label: string; kind: "group" | "flow" };
type StepData = {
  step: FlowStepNode;
  name: string;
  model: string | null;
  dim: boolean;
  /** With a run on the map: what came of this step in it, and whether it ran. */
  run?: { line: string; state: "ran" | "idle" | "bad" };
};
type RFNode = Node<CardData, "card"> | Node<FrameData, "frame"> | Node<StepData, "step">;

const MapCard = memo(function MapCard({ data }: NodeProps<Node<CardData, "card">>) {
  const t = useStore((s) => s.t);
  const n = data.node;
  return (
    <div
      className={`mp-card ${n.kind}${data.hot ? " hot" : ""}${data.dim ? " dim" : ""}${data.way ? " way" : ""}${data.centre ? " centre" : ""}${n.kind === "flow" && !n.on ? " off" : ""}`}
      title={data.name}
    >
      <Handle type="target" position={Position.Left} id="l" />
      <div className="mp-head">
        <span className="mp-icon">
          {n.kind === "collection" && n.icon ? <span>{n.icon}</span> : <KindIcon n={n} />}
        </span>
        <span className="mp-name">{data.name}</span>
        {n.kind === "flow" && (
          <button
            type="button"
            className="mp-fold"
            title={t("map.unfold")}
            aria-label={t("map.unfold")}
            onClick={(e) => {
              e.stopPropagation();
              data.onFold(n.id);
            }}
          >
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {data.lines.map((l) => (
        <div key={l} className="mp-line">
          {l}
        </div>
      ))}
      {(data.models.length > 0 || (n.kind === "flow" && (n.boni || !n.on))) && (
        <div className="mp-tags">
          {n.kind === "flow" && n.boni && (
            <span className="mp-tag boni">{t("flows.group.boni")}</span>
          )}
          {n.kind === "flow" && !n.on && <span className="mp-tag">{t("flows.disabled")}</span>}
          {data.models.slice(0, 2).map((m) => (
            <span key={m} className="mp-tag model">
              {m}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
});

const Frame = memo(function Frame({ data }: NodeProps<Node<FrameData, "frame">>) {
  return (
    <div className={`mp-frame ${data.kind}`}>
      <Handle type="target" position={Position.Left} id="l" />
      {/* An unfolded flow's name chooses it (a press on it is a click, not the start of a pan). */}
      <span className={`mp-frame-label${data.kind === "flow" ? " nopan" : ""}`}>{data.label}</span>
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
});

const StepCard = memo(function StepCard({ data }: NodeProps<Node<StepData, "step">>) {
  return (
    <div
      className={`mp-step ${data.step.op}${data.dim ? " dim" : ""}${data.run ? ` run-${data.run.state}` : ""}`}
      title={data.name}
    >
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="target" position={Position.Left} id="l" />
      <div className="mp-head">
        <span className="mp-icon">
          <StepIcon op={data.step.op} />
        </span>
        <span className="mp-name">{data.name}</span>
      </div>
      {(data.model || data.step.detail) && (
        <div className="mp-line">{data.model ?? data.step.detail}</div>
      )}
      {data.run && <div className="mp-line mp-run-line">{data.run.line}</div>}
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
});

type EdgeData = {
  label: string;
  kind: string;
  outside: boolean;
  hot: boolean;
  dim: boolean;
  order?: boolean;
};
function MapEdgeView(p: EdgeProps<Edge<EdgeData>>) {
  const t = useStore((s) => s.t);
  const d = p.data as EdgeData;
  const [path, lx, ly] = d.order
    ? getSmoothStepPath({ ...p, borderRadius: 8 })
    : getBezierPath({ ...p, curvature: 0.35 });
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        className={`mp-edge ${d.kind}${d.outside ? " outside" : ""}${d.hot ? " hot" : ""}${d.dim ? " dim" : ""}`}
      />
      {d.label && !d.dim && (
        <EdgeLabelRenderer>
          <div
            className={`mp-edge-label ${d.kind}${d.outside ? " outside" : ""}${d.hot ? " hot" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            title={d.outside ? t("map.outside") : undefined}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES: NodeTypes = { card: MapCard, frame: Frame, step: StepCard };
const EDGE_TYPES: EdgeTypes = { map: MapEdgeView };

/** The heights of a node's card by what it shows. */
function heightOf(n: MapNode, models: number): number {
  const lines = n.kind === "flow" ? 2 : 1;
  const tags = models > 0 || (n.kind === "flow" && (n.boni || !n.on)) ? 1 : 0;
  return 34 + lines * 17 + tags * 24;
}

/** The search of «En el centro»: every node of the map by its name, the first on Enter. */
function MapFind({
  nodes,
  onPick,
}: {
  nodes: { id: string; name: string; kind: string }[];
  onPick: (id: string) => void;
}) {
  const t = useStore((s) => s.t);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const fold = (s: string) => s.toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const want = fold(q.trim());
  const shown = nodes.filter((n) => !want || fold(n.name).includes(want)).slice(0, 12);
  const pick = (id: string) => {
    setQ("");
    setOpen(false);
    onPick(id);
  };
  return (
    <div className="mp-find">
      <Search size={14} strokeWidth={1.8} aria-hidden />
      <input
        className="input small"
        value={q}
        placeholder={t("map.find")}
        aria-label={t("map.find")}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls="mp-find-list"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) {
            e.preventDefault();
            pick(shown[0].id);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && shown.length > 0 && (
        <div className="mp-find-list menu-list" id="mp-find-list" role="listbox">
          {shown.map((n) => (
            <button
              key={n.id}
              type="button"
              role="option"
              aria-selected={false}
              className="menu-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(n.id)}
            >
              <span className="menu-text">{n.name}</span>
              <span className="muted small">{t(`map.kind.${n.kind}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** How far before or after the centre: one or two arrows, or all. */
function Depth({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const t = useStore((s) => s.t);
  return (
    <div className="mp-depth">
      <span className="muted small">{label}</span>
      <div className="segmented small" role="radiogroup" aria-label={label}>
        {DEPTHS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d}
            className={value === d ? "on" : ""}
            onClick={() => onChange(d)}
          >
            {Number.isFinite(d) ? d : t("map.all")}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What a node is joined to, in its panel: each arrow's other end, its verb and its number. */
function Joined({
  title,
  list,
  onPick,
}: {
  title: string;
  list: { id: string; name: string; label: string }[];
  onPick: (id: string) => void;
}) {
  if (!list.length) return null;
  return (
    <section className="mp-joined" aria-label={title}>
      <h4>{title}</h4>
      <ul>
        {list.map((x) => (
          <li key={`${x.id}-${x.label}`}>
            <button type="button" className="link-btn" onClick={() => onPick(x.id)}>
              {x.name}
            </button>
            <span className="muted"> · {x.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** At most this many of a run's proposals or changes are named in its card; the rest are counted. */
const NAMED = 3;

/**
 * The way a run went, in words over the map (docs/sistema.md §4.4): what started it, who ran it and when, what it
 * proposed and what became of each, what it wrote; asked from a record («¿De dónde viene?»), that record and its
 * «Aceptar». Titles from a mail are its words: painted as text.
 */
function RunWay({
  run,
  story,
  owner,
  when,
}: {
  run: RunDetail;
  story: { title: string; origin: Origin } | null;
  owner: string;
  when: (ms: number) => string;
}) {
  const t = useStore((s) => s.t);
  const named = <X,>(xs: X[], line: (x: X) => string) => [
    ...xs.slice(0, NAMED).map(line),
    ...(xs.length > NAMED ? [t("way.more", { n: xs.length - NAMED })] : []),
  ];
  const lines = [
    ...(run.input
      ? [t("way.from", { title: run.input.title || "…", collection: run.input.collection })]
      : []),
    run.flowVersion !== null
      ? t("way.runV", { name: owner, v: run.flowVersion, when: when(run.started) })
      : t("way.run", { name: owner, when: when(run.started) }),
    // Asked from a record: its own proposal, then how many more the run made; else the run's, a few by name.
    ...(story?.origin.proposal
      ? [
          t("way.proposedThis", { title: story.origin.proposal.title || story.title || "…" }),
          ...(run.proposals.length > 1
            ? [t("way.proposedMore", { n: run.proposals.length - 1 })]
            : []),
        ]
      : named(run.proposals, (p) =>
          t("way.proposed", { title: p.title || "…", status: t(`log.proposal.${p.status}`) }),
        )),
    ...named(run.changes, (c) =>
      t(c.undone ? "way.wroteUndone" : "way.wrote", {
        title: c.title || "…",
        collection: c.collection,
      }),
    ),
  ];
  const decided = story?.origin.proposal?.decided ?? null;
  if (decided !== null)
    lines.push(
      t(story?.origin.proposal?.alone ? "origin.alone" : "origin.accepted", {
        when: when(decided),
      }),
    );
  return (
    <section
      className="mp-way"
      aria-label={story ? t("origin.title", { title: story.title || "…" }) : t("map.run")}
    >
      <h4>{story ? t("origin.title", { title: story.title || "…" }) : t("way.title")}</h4>
      <ol>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
      <button type="button" className="link-btn small" onClick={() => openTrace(run.id)}>
        {t("origin.trace")}
      </button>
    </section>
  );
}

function Canvas({
  map,
  only,
  kept,
  setKept,
}: {
  map: MapView;
  only?: Set<string>;
  kept: Kept;
  setKept: (f: (k: Kept) => Kept) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const asked = useStore((s) => (s.view.kind === "flows" ? (s.view.map ?? null) : null));
  const [center, setCenter] = useState<string | null>(asked?.center ?? null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(asked?.center ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [byRole, setByRole] = useState<Record<string, string>>({});
  // A run on the map (§4.4, «una ejecución encima»): its flow unfolded, each step with what came of it.
  const [run, setRun] = useState<(RunDetail & { owner: string }) | null>(null);
  // «¿De dónde viene?» of a record: its title and where it comes from, told over the run that made it.
  const [story, setStory] = useState<{ title: string; origin: Origin } | null>(null);
  const { fitView, getNode, getViewport, setViewport } = useReactFlow();
  // «Ver en el mapa»: this in the centre, chosen; the pages shown when it is one.
  // Pages shown for a page put in the centre, only while it is there (the device's «Con páginas» stays as it was).
  const [pagesHere, setPagesHere] = useState(false);
  useEffect(() => {
    if (!asked) return;
    // Something the map does not have (a page no block of which shows a collection): the map, and it says so.
    const known = !asked.center || map.nodes.some((n) => n.id === asked.center);
    if (!known) toast(t("map.notOnIt"));
    setCenter(known ? asked.center : null);
    // A run is told in its own card: no node's panel over it.
    setSelected(known && !asked.run ? asked.center : null);
    setPagesHere(!!asked.pages && known);
    setRun(null);
    setStory(asked.origin ?? null);
    if (asked.run) {
      const centre = asked.center;
      agentApi.runDetail(asked.run).then(
        (d) => {
          if (!d) return;
          // Whose run it is, as the server counts it (its flow, the conversation, the reviewer, the Bandeja for an
          // «Aceptar»); from an older server, its flow or what it was asked from.
          const owner = d.owner ?? (d.flow ? `flow:${d.flow}` : (centre ?? "boni:chat"));
          setRun({ ...d, owner });
          if (owner.startsWith("flow:")) setOpen((o) => new Set([...o, owner]));
        },
        () => undefined,
      );
    }
  }, [asked?.n]);
  useEffect(() => {
    agentApi.models().then(
      (m) => setByRole(Object.fromEntries((m?.roles ?? []).map((r) => [r.role, r.model]))),
      () => undefined,
    );
  }, []);
  const usd = useMemo(
    () =>
      new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
        style: "currency",
        currency: "USD",
      }),
    [lang],
  );
  const money = (n: number) => usd.format(n);
  const when = (ms: number) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: deviceZone(),
    }).format(ms);
  const lens: Lens = { ...kept.lens, pages: kept.lens.pages || (pagesHere && !!center), center };
  const nameOf = useMemo(() => new Map(map.nodes.map((n) => [n.id, mapNodeName(t, n)])), [map, t]);
  // A collection's name by its key: what a trigger names.
  const keyName = (key: string) =>
    map.nodes.find((n) => n.kind === "collection" && n.key === key)?.name ?? undefined;
  // What «Flujos»' filter or search leaves out is not on the map.
  const base = useMemo(() => {
    if (!only) return map;
    const nodes = map.nodes.filter((n) => n.kind !== "flow" || only.has(n.id.slice(5)));
    const ids = new Set(nodes.map((n) => n.id));
    return { ...map, nodes, edges: map.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }, [map, only]);
  const view = useMemo(
    () => lensOf(base, lens),
    [
      base,
      lens.center,
      lens.before,
      lens.after,
      lens.ai,
      lens.writes,
      lens.on,
      lens.pages,
      lens.happened,
    ],
  );
  // «Agrupar por flujo»: every flow unfolded, its steps in its frame.
  const unfolded = (id: string) => kept.group === "flow" || open.has(id);

  const graph = useMemo(() => {
    // The boxes: a card per node; an unfolded flow a frame with its steps in the order they run.
    const inner = new Map<string, ReturnType<typeof stepLayout>>();
    const boxes = view.nodes.map((n) => {
      if (n.kind === "flow" && unfolded(n.id) && n.plan?.steps.length) {
        // A run's line under each step of the flow it is a run of.
        const runLine = run?.owner === n.id ? 17 : 0;
        const l = stepLayout(n.plan.steps, {
          width: STEP_W,
          height: () => STEP_H + runLine,
          gapY: 22,
          gapX: 18,
          laneHead: 22,
        });
        inner.set(n.id, l);
        return {
          id: n.id,
          width: Math.max(W, l.width + 2 * FRAME_PAD),
          height: FRAME_HEAD + l.height + FRAME_PAD,
        };
      }
      return { id: n.id, width: W, height: heightOf(n, modelsOf(n, byRole).length) };
    });
    const groups = new Map<string, string>();
    for (const n of view.nodes) {
      const g = groupOf(n, kept.group);
      if (g) groups.set(n.id, g);
    }
    // Who acts sits on the left: the user, the assistants, the conversation.
    const left = new Set(
      view.nodes.filter((n) => n.kind === "actor" || n.code === "chat").map((n) => n.id),
    );
    return { boxes, inner, layout: mapLayout(boxes, view.edges, groups, left) };
  }, [view, open, kept.group, byRole, run]);

  // The way a run on the map went (§4.4, «una ejecución encima»): what started it, its flow or the conversation, what
  // it read, the Bandeja and where what it proposed was accepted, where it wrote. The rest goes quiet.
  const way = useMemo(() => {
    if (!run) return null;
    const owner = run.owner;
    const col = (type: string | null | undefined) => (type ? [`col:${type}`] : []);
    const nodes = new Set<string>([owner]);
    const edges = new Set<string>();
    const add = (from: string, to: string, kind: string) => {
      nodes.add(from);
      nodes.add(to);
      edges.add(`${from}>${to}>${kind}`);
    };
    for (const c of col(run.input?.type)) {
      add(c, owner, "starts");
      // What brought it: the mail's connector.
      for (const e of map.edges) if (e.to === c && e.kind === "brings") add(e.from, c, "brings");
    }
    for (const r of run.read) for (const c of col(r.type)) add(c, owner, "reads");
    // An «Aceptar» writes out of the Bandeja: its arrow is «aceptadas».
    const wrote = owner === "boni:inbox" ? "accepts" : "writes";
    for (const w of run.changes) for (const c of col(w.type)) add(owner, c, wrote);
    if (run.proposals.length) add(owner, "boni:inbox", "proposes");
    for (const p of run.proposals)
      if (p.status === "accepted") for (const c of col(p.type)) add("boni:inbox", c, "accepts");
    return { nodes, edges };
  }, [run, map.edges]);
  // The arrows next to what the pointer is on, or what is chosen; the rest go quiet. Not for the centre: what the map
  // shows then is already what comes before and after it, and all of it says something. With a run on the map, its
  // way (a hover still shows what is next to something).
  const focus = hover ?? (way || selected === center ? null : selected);
  const near = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    for (const e of view.edges) {
      if (e.from === focus) s.add(e.to);
      if (e.to === focus) s.add(e.from);
    }
    return s;
  }, [focus, view.edges]);

  const { nodes: made, edges } = useMemo(() => {
    const out: RFNode[] = [];
    const rfEdges: Edge<EdgeData>[] = [];
    const groupLabel = (g: string) => {
      const [kind, ...rest] = g.split(":");
      const v = rest.join(":");
      if (kind === "pack") return t(`map.pack.${v}`);
      if (kind === "in") return nameOf.get(v) ?? v;
      if (v === "boni") return t("map.group.boni");
      if (v === "schedule") return t("flows.on.scheduled");
      if (v === "manual") return t("flows.on.manual");
      if (v.startsWith("created:")) {
        const key = v.slice("created:".length);
        return t("flows.on.created", { what: keyName(key) ?? key });
      }
      return v;
    };
    for (const f of graph.layout.frames)
      out.push({
        id: `frame:${f.id}`,
        type: "frame",
        position: { x: f.x, y: f.y },
        style: { width: f.width, height: f.height },
        data: { label: groupLabel(f.id), kind: "group" },
        selectable: false,
        draggable: false,
        zIndex: -2,
      });
    for (const n of view.nodes) {
      const at = graph.layout.at.get(n.id) ?? { x: 0, y: 0 };
      const l = graph.inner.get(n.id);
      if (l && n.plan) {
        const box = graph.boxes.find((b) => b.id === n.id) as { width: number; height: number };
        out.push({
          id: n.id,
          type: "frame",
          position: at,
          style: { width: box.width, height: box.height },
          data: { label: nameOf.get(n.id) ?? "", kind: "flow" },
          draggable: false,
          zIndex: -1,
        });
        const cx = at.x + box.width / 2;
        const top = at.y + FRAME_HEAD;
        // The run on the map, when it is one of this flow's.
        const ran = run?.owner === n.id ? run.steps : null;
        const byId = new Map(n.steps.map((s) => [s.id, s]));
        for (const s of n.plan.steps) {
          const p = l.at.get(s.id);
          const node = byId.get(s.id);
          if (!p || !node) continue;
          const role =
            node.op === "read"
              ? node.what === "classify"
                ? "decider"
                : node.what === "review_reading"
                  ? "reviewer"
                  : "reader"
              : null;
          out.push({
            id: `step:${n.id}:${s.id}`,
            type: "step",
            position: { x: cx + p.x, y: top + p.y },
            data: {
              step: {
                ...node,
                detail: stepDetail(
                  t,
                  s,
                  node.detail ?? (node.into?.length ? t("flows.inChosen") : null),
                ),
              },
              name: stepNodeName(t, node),
              model: role ? (byRole[role] ?? null) : null,
              dim: near ? !near.has(n.id) : !!way && !way.nodes.has(n.id),
              ...(ran
                ? (() => {
                    const r = ran.find((x) => x.id === s.id);
                    if (!r) return { run: { line: t("run.node.never"), state: "idle" as const } };
                    const bad = !!r.error || r.decision === "deny" || r.decision === "stopped";
                    const idle = r.decision === null || r.decision === "skip";
                    return {
                      run: {
                        line: runStepLine(t, r),
                        state: bad ? ("bad" as const) : idle ? ("idle" as const) : ("ran" as const),
                      },
                    };
                  })()
                : {}),
            },
            draggable: false,
            className: "nopan",
            zIndex: 1,
          });
        }
        for (const k of l.links)
          rfEdges.push({
            id: `order:${n.id}:${k.from}>${k.to}`,
            source: `step:${n.id}:${k.from}`,
            target: `step:${n.id}:${k.to}`,
            sourceHandle: "b",
            targetHandle: "t",
            type: "map",
            data: {
              label: k.lane ?? "",
              kind: "order",
              outside: false,
              hot: false,
              dim: false,
              order: true,
            },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            zIndex: 1,
          });
        continue;
      }
      const models = modelsOf(n, byRole);
      out.push({
        id: n.id,
        type: "card",
        position: at,
        data: {
          node: n,
          name: nameOf.get(n.id) ?? n.id,
          lines: lineOf(t, n, money, keyName),
          models,
          hot: n.id === selected,
          dim: near ? !near.has(n.id) : !!way && !way.nodes.has(n.id),
          way: !near && !!way && way.nodes.has(n.id),
          centre: n.id === center,
          open: false,
          onFold: (id) =>
            setOpen((o) => {
              const x = new Set(o);
              x.add(id);
              return x;
            }),
        },
        draggable: false,
        // A press on a box is a click on it, not the start of a pan (the canvas pans from its background).
        className: "nopan",
      });
    }
    // An arrow to or from an unfolded flow goes to the steps that make it, when it says them.
    const ends = (id: string, steps: string[]) =>
      graph.inner.has(id) && steps.length ? steps.map((s) => `step:${id}:${s}`) : [id];
    for (const e of view.edges) {
      // Into the Bandeja with a collection in the centre: what went to that collection (§4.4: «Leer correo
      // (propone, 23)» for Evento), not to all.
      const n = center && e.per && center in e.per ? (e.per[center] ?? 0) : e.n;
      const label = `${t(`map.edge.${e.kind}`)}${n !== null && n > 0 ? ` · ${n.toLocaleString(lang === "en" ? "en-GB" : "es-ES")}` : ""}`;
      const onWay = !focus && !!way && way.edges.has(`${e.from}>${e.to}>${e.kind}`);
      const hot = focus ? e.from === focus || e.to === focus : onWay;
      const dim = focus ? !hot : !!way && !onWay;
      // An arrow going back (right to left: what someone who acts reads, a lesson to an earlier flow) crosses the
      // boxes in between: its words only when it is lit, never over a card's name.
      const back =
        (graph.layout.at.get(e.from)?.x ?? 0) > (graph.layout.at.get(e.to)?.x ?? 0) && !hot;
      // An arrow that leaves from (or reaches) several steps says its words once, on the first of them.
      let said = false;
      for (const from of ends(e.from, e.steps))
        for (const to of ends(e.to, e.steps)) {
          const words = said || back ? "" : label;
          said = true;
          rfEdges.push({
            id: `${from}>${to}>${e.kind}`,
            source: from,
            target: to,
            sourceHandle: "r",
            targetHandle: "l",
            type: "map",
            data: { label: words, kind: e.kind, outside: e.outside, hot, dim },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            zIndex: hot ? 2 : 0,
          });
        }
    }
    return { nodes: out, edges: rfEdges };
  }, [graph, view, near, focus, selected, center, nameOf, t, byRole, lang, run, way]);

  const chosen = selected ? map.nodes.find((n) => n.id === selected) : undefined;
  // The box chosen stays in view when its panel narrows the canvas: moved just enough, the zoom kept.
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const id = setTimeout(() => {
      const n = getNode(selected);
      const box = stage.current?.querySelector(".react-flow")?.getBoundingClientRect();
      if (!n || !box) return;
      const v = getViewport();
      const w = n.measured?.width ?? W;
      const h = n.measured?.height ?? 60;
      const x0 = n.position.x * v.zoom + v.x;
      const y0 = n.position.y * v.zoom + v.y;
      // Just enough to show it: the rest stays where it was.
      const m = 24;
      const x1 = x0 + w * v.zoom;
      const y1 = y0 + h * v.zoom;
      const dx = x0 < m ? m - x0 : x1 > box.width - m ? box.width - m - x1 : 0;
      const dy = y0 < m ? m - y0 : y1 > box.height - m ? box.height - m - y1 : 0;
      if (dx || dy) void setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, { duration: 200 });
    }, 60);
    return () => clearTimeout(id);
  }, [selected, getNode, getViewport, setViewport]);
  const label = (e: MapEdge) =>
    `${t(`map.edge.${e.kind}`)}${e.n !== null && e.n > 0 ? ` · ${e.n}` : ""}`;
  const open_ = (n: MapNode) => {
    if (n.kind === "flow") showFlow(n.id.slice("flow:".length));
    else if (n.kind === "collection") openCollection(n.id.slice("col:".length));
    else if (n.kind === "page") openPage(n.id.slice("page:".length));
    else if (n.code === "chat") showChat();
    else if (n.code === "inbox") showInbox();
  };
  const canOpen = (n: MapNode) =>
    ["flow", "collection", "page"].includes(n.kind) || n.code === "chat" || n.code === "inbox";
  const fold = (id: string) =>
    setOpen((o) => {
      const x = new Set(o);
      if (x.has(id)) x.delete(id);
      else x.add(id);
      return x;
    });
  const setLens = (l: Partial<Kept["lens"]>) =>
    setKept((k) => ({ ...k, lens: { ...k.lens, ...l } }));
  const filters = (["ai", "writes", "on", "happened", "pages"] as const).filter(
    (k) => kept.lens[k],
  ).length;
  const findable = useMemo(
    () =>
      base.nodes
        .filter((n) => n.kind !== "page" || kept.lens.pages)
        .map((n) => ({ id: n.id, name: nameOf.get(n.id) ?? n.id, kind: n.kind })),
    [base, nameOf, kept.lens.pages],
  );

  // The boxes as React Flow's state, measured once and kept (core/useKeptNodes.ts).
  const { nodes, onNodesChange } = useKeptNodes(made);
  // Fitted when the boxes on the canvas move (a new centre, a grouping, a flow unfolded) and all are measured: never on a
  // hover, which only redraws them, and a fit then would move them under the pointer in the middle of a click.
  const ready = useNodesInitialized();
  const placed = nodes
    .map((n) => `${n.id}@${Math.round(n.position.x)},${Math.round(n.position.y)}`)
    .join("|");
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !placed || fitted.current === placed) return;
    // A moment later, once React Flow has the new places too; a new measure in between starts the wait again.
    const id = setTimeout(() => {
      fitted.current = placed;
      // On the phone, never so small that a card cannot be read: the middle of it, the rest a finger away.
      void fitView({
        padding: 0.06,
        maxZoom: 1,
        ...(phoneLayout() ? { minZoom: 0.5 } : {}),
        duration: 200,
      });
    }, 80);
    return () => clearTimeout(id);
  }, [placed, ready, fitView]);
  return (
    <div className="mp">
      <div className="mp-bar" role="toolbar" aria-label={t("map.tools")}>
        {center ? (
          <>
            <span className="mp-centre chip">
              <span className="muted">{t("map.centre")}</span>
              <strong>{nameOf.get(center) ?? center}</strong>
              <button
                type="button"
                className="icon-btn tiny"
                aria-label={t("map.centreClear")}
                title={t("map.centreClear")}
                onClick={() => setCenter(null)}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </span>
            <Depth
              label={t("map.before")}
              value={kept.lens.before}
              onChange={(n) => setLens({ before: n })}
            />
            <Depth
              label={t("map.after")}
              value={kept.lens.after}
              onChange={(n) => setLens({ after: n })}
            />
          </>
        ) : (
          <MapFind
            nodes={findable}
            onPick={(id) => {
              setCenter(id);
              setSelected(id);
            }}
          />
        )}
        {run && (
          <span className="mp-centre chip mp-run-chip">
            <span className="muted">{t("map.run")}</span>
            <strong>{when(run.started)}</strong>
            <button
              type="button"
              className="icon-btn tiny"
              aria-label={t("map.runClear")}
              title={t("map.runClear")}
              onClick={() => {
                setRun(null);
                setStory(null);
              }}
            >
              <X size={13} strokeWidth={2} />
            </button>
          </span>
        )}
        <span className="spacer" />
        <label className="mp-group">
          <span className="muted small">{t("map.group")}</span>
          <select
            className="input small"
            value={kept.group}
            onChange={(e) => setKept((k) => ({ ...k, group: e.target.value as Grouping }))}
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`map.group.${g}`)}
              </option>
            ))}
          </select>
        </label>
        <PopButton
          label={
            <>
              <SlidersHorizontal size={14} strokeWidth={1.8} aria-hidden />
              {t("map.filters")}
              {filters > 0 && <span className="mp-count">{filters}</span>}
            </>
          }
          title={t("map.filters")}
          className={`btn small${filters ? " on" : ""}`}
          width={240}
        >
          {() => (
            <div className="menu-list mp-filters" role="group" aria-label={t("map.filters")}>
              {(["ai", "writes", "on", "happened", "pages"] as const).map((k) => (
                <label key={k} className="menu-item mp-check">
                  <input
                    type="checkbox"
                    checked={kept.lens[k]}
                    onChange={(e) => setLens({ [k]: e.target.checked })}
                  />
                  <span className="menu-text">{t(`map.filter.${k}`)}</span>
                </label>
              ))}
            </div>
          )}
        </PopButton>
        <div className="segmented small" role="radiogroup" aria-label={t("flow.period")}>
          {PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={kept.days === d}
              className={kept.days === d ? "on" : ""}
              onClick={() => setKept((k) => ({ ...k, days: d }))}
            >
              {t("flow.days", { n: d })}
            </button>
          ))}
        </div>
      </div>
      <div className={`mp-stage${chosen ? " with-panel" : ""}`} ref={stage}>
        {run && <RunWay run={run} story={story} owner={nameOf.get(run.owner) ?? ""} when={when} />}
        {view.nodes.length === 0 ? (
          <div className="mp-empty">
            <p>{t("map.empty")}</p>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setCenter(null);
                setKept((k) => ({ ...k, lens: { ...LENS } }));
              }}
            >
              {t("map.reset")}
            </button>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            onNodesChange={onNodesChange}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            minZoom={0.15}
            maxZoom={1.6}
            fitView
            fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
            onNodeClick={(_, n) => {
              const id = n.type === "step" ? n.id.split(":").slice(1, 3).join(":") : n.id;
              if (n.type === "frame" && !id.startsWith("flow:")) return;
              setSelected(id);
            }}
            onNodeDoubleClick={(_, n) => {
              const id = n.type === "step" ? n.id.split(":").slice(1, 3).join(":") : n.id;
              const m = map.nodes.find((x) => x.id === id);
              if (m && canOpen(m)) open_(m);
            }}
            onNodeMouseEnter={(_, n) =>
              setHover(
                n.type === "card"
                  ? n.id
                  : n.type === "step"
                    ? n.id.split(":").slice(1, 3).join(":")
                    : null,
              )
            }
            onNodeMouseLeave={() => setHover(null)}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              const id = n.type === "step" ? n.id.split(":").slice(1, 3).join(":") : n.id;
              if (!map.nodes.some((x) => x.id === id)) return;
              setMenu({ x: e.clientX, y: e.clientY, id });
            }}
            onPaneClick={() => setSelected(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {chosen && (
          <aside className="mp-panel" aria-label={nameOf.get(chosen.id) ?? ""}>
            <div className="mp-panel-head">
              <span className="mp-icon">
                <KindIcon n={chosen} size={16} />
              </span>
              <div className="mp-panel-title">
                <h3>{nameOf.get(chosen.id)}</h3>
                <span className="muted small">
                  {t(`map.kind.${chosen.kind}`)}
                  {chosen.kind === "flow" && chosen.boni ? ` · ${t("flows.group.boni")}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("flows.close")}
                title={t("flows.close")}
                onClick={() => setSelected(null)}
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </div>
            <dl className="mp-facts">
              {lineOf(t, chosen, money, keyName).map((l) => (
                <dd key={l}>{l}</dd>
              ))}
              {chosen.kind === "flow" && (
                <dd>{chosen.on ? t("flows.enabled") : t("flows.disabled")}</dd>
              )}
              {chosen.proposals > 0 && (
                <dd>{t("map.proposals", { n: chosen.proposals, a: chosen.accepted })}</dd>
              )}
              {chosen.rejected > 0 && <dd>{t("map.rejected", { n: chosen.rejected })}</dd>}
              {chosen.calls > 0 && <dd>{t("map.calls", { n: chosen.calls })}</dd>}
              {modelsOf(chosen, byRole).length > 0 && (
                <dd>{modelsOf(chosen, byRole).join(" · ")}</dd>
              )}
            </dl>
            <Joined
              title={t("map.in")}
              list={map.edges
                .filter((e) => e.to === chosen.id)
                .map((e) => ({ id: e.from, name: nameOf.get(e.from) ?? e.from, label: label(e) }))}
              onPick={(id) => setSelected(id)}
            />
            <Joined
              title={t("map.out")}
              list={map.edges
                .filter((e) => e.from === chosen.id)
                .map((e) => ({ id: e.to, name: nameOf.get(e.to) ?? e.to, label: label(e) }))}
              onPick={(id) => setSelected(id)}
            />
            <div className="mp-actions">
              {center !== chosen.id && (
                <button type="button" className="btn small" onClick={() => setCenter(chosen.id)}>
                  {t("map.toCentre")}
                </button>
              )}
              {chosen.kind === "flow" && (chosen.plan?.steps.length ?? 0) > 0 && (
                <button type="button" className="btn small" onClick={() => fold(chosen.id)}>
                  {unfolded(chosen.id) ? (
                    <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
                  ) : (
                    <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
                  )}
                  {unfolded(chosen.id) ? t("map.fold") : t("map.unfold")}
                </button>
              )}
              {canOpen(chosen) && (
                <button type="button" className="btn primary small" onClick={() => open_(chosen)}>
                  {t("map.open")}
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
      {menu && (
        <PointMenu x={menu.x} y={menu.y} label={t("map.menu")} onClose={() => setMenu(null)}>
          {(close) => {
            const m = map.nodes.find((x) => x.id === menu.id) as MapNode;
            return (
              <div className="menu-list" role="menu">
                <MenuRow
                  label={t("map.toCentre")}
                  onClick={() => {
                    setCenter(m.id);
                    setSelected(m.id);
                    close();
                  }}
                />
                {m.kind === "flow" && (m.plan?.steps.length ?? 0) > 0 && (
                  <MenuRow
                    label={unfolded(m.id) ? t("map.fold") : t("map.unfold")}
                    onClick={() => {
                      fold(m.id);
                      close();
                    }}
                  />
                )}
                {canOpen(m) && (
                  <MenuRow
                    label={t("map.open")}
                    onClick={() => {
                      close();
                      open_(m);
                    }}
                  />
                )}
              </div>
            );
          }}
        </PointMenu>
      )}
    </div>
  );
}

/** «Mapa», the diagram of «Flujos»: `only`, the flows its filter or search keeps (none: all of them). */
export function FlowMap({ only }: { only?: Set<string> }) {
  const t = useStore((s) => s.t);
  // Its lenses, kept on this device; the map is asked again when the period changes.
  const [kept, setKeptState] = useState<Kept>(readKept);
  const setKept = (f: (k: Kept) => Kept) =>
    setKeptState((k) => {
      const next = f(k);
      keep(next);
      return next;
    });
  const [map, setMap] = useState<MapView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    setError(null);
    agentApi.map(kept.days).then(
      (m) => {
        if (gone) return;
        if (m) setMap(m);
        else setError(t("map.error"));
      },
      (e) => !gone && setError(errorText(t, e)),
    );
    return () => {
      gone = true;
    };
  }, [kept.days, t]);
  if (error && !map) return <p className="form-error">{error}</p>;
  if (!map)
    return (
      <div
        className="page-loading mp-loading"
        role="status"
        aria-busy="true"
        aria-label={t("chart.loading")}
      />
    );
  return (
    <ReactFlowProvider>
      <Canvas map={map} only={only} kept={kept} setKept={setKept} />
    </ReactFlowProvider>
  );
}
