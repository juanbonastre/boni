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
  MonitorSmartphone,
  Plug,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  User,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  type FlowStep,
  type FlowStepNode,
  MAP_DEVICES,
  type MapEdge,
  type MapNode,
  type MapView,
  mapDevices,
  type Origin,
  type RecordView,
  type RunDetail,
} from "../core/agent.ts";
import { deviceZone } from "../core/clock.ts";
import { refsUsed, typeKeysOf } from "../core/flowEdit.ts";
import {
  choiceOf,
  type Grouping,
  groupOf,
  LENS,
  type Lens,
  lensOf,
  mapLayout,
  stepLayout,
  withTold,
} from "../core/flowLayout.ts";
import { chipTitle, mapRef, pointAttrs } from "../core/pointing.ts";
import {
  mapNodeName,
  moneyText,
  runCopy,
  runStatusLine,
  runStepLine,
  runWords,
  stepDesc,
  stepName,
  valueText,
} from "../core/runText.ts";
import { useKeptNodes } from "../core/useKeptNodes.ts";
import { phoneLayout } from "../host.ts";
import {
  agentApi,
  errorText,
  openCollection,
  openPage,
  showChat,
  showFlow,
  showInbox,
  toast,
  useStore,
} from "../store.ts";
import { DeciderFacts } from "./DeciderFacts.tsx";
import { triggerText } from "./FlowEditor.tsx";
import { inputName, stepDetail } from "./FlowStepPanel.tsx";
import { PieceFacts } from "./PieceFacts.tsx";
import { MenuRow, PointMenu, PopButton } from "./Popover.tsx";

type T = (k: string, p?: Record<string, string | number>) => string;
const PERIODS = [7, 30] as const;
/** Every box above every arrow, a lit one too (task 90: «líneas que tapan items»): an arrow passes behind a box. */
const BOX_Z = 3;
const GROUPS: readonly Grouping[] = ["none", "trigger", "flow", "collection", "pack"];
const W = 212;
const STEP_W = 196;
const STEP_H = 50;
const FRAME_HEAD = 46;
/** An unfolded flow's first box: what starts it, as in its editor. */
const TRIGGER = "trigger";
const TRIGGER_H = 54;
const FRAME_PAD = 14;
const KEPT = "boni:mapLens";
const WAY_HIDDEN = "boni:mapWayHidden";

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
    // One depth (task 90): what «Antes» kept, for both ways; «Después» alone is no longer a control.
    const d = depth(l.before, 1);
    return {
      lens: {
        before: d,
        after: d,
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

/** A node's icon, by its kind. */
function KindIcon({ n, size = 14 }: { n: Pick<MapNode, "kind" | "code">; size?: number }) {
  const p = { size, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (n.kind === "connector") return <Mail {...p} />;
  if (n.kind === "collection") return <Database {...p} />;
  if (n.kind === "flow") return <Workflow {...p} />;
  if (n.kind === "page") return <FileText {...p} />;
  if (n.kind === "device") return <MonitorSmartphone {...p} />;
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
  // The devices: what they were told in the period.
  if (n.kind === "device")
    out.push(t(n.notices === 1 ? "map.notices.one" : "map.notices", { n: n.notices }));
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
  /** On the way of the run drawn on the map, and its place along it. */
  way: boolean;
  wayI?: number;
  centre: boolean;
  open: boolean;
  onFold: (id: string) => void;
};
type FrameData = { label: string; kind: "group" | "flow" };
type StepData = {
  step: FlowStepNode;
  name: string;
  model: string | null;
  /** Its model calls of the period and their cost, in words. */
  numbers: string | null;
  /** What it does, in one line (its tooltip). */
  desc: string | null;
  dim: boolean;
  /** With a run on the map: what came of this step in it, and whether it ran. */
  /** What came of it in the run on the map, and that run's own calls and cost (in orange). */
  run?: { line: string; state: "ran" | "idle" | "bad"; own?: string | null };
  /** Its place along the run's way (the light reaches it in that order). */
  wayI?: number;
};
type TrigData = { text: string; brings: string; dim: boolean; way: boolean; wayI?: number };
type RFNode =
  | Node<CardData, "card">
  | Node<FrameData, "frame">
  | Node<StepData, "step">
  | Node<TrigData, "trig">;

/** What a card of the map carries to be pointed at (`Ctrl+Shift+E`): what its id stands for, with its chip's words. */
function mapPoint(t: (k: string) => string, id: string, name: string) {
  const ref = mapRef(id);
  if (!ref) return {};
  const kind =
    ref.kind === "collection" || ref.kind === "flow" || ref.kind === "step"
      ? t(`point.kind.${ref.kind}`)
      : ref.kind === "row"
        ? t("point.kind.page")
        : t("point.kind.node");
  return pointAttrs(ref, chipTitle(kind, name));
}

const MapCard = memo(function MapCard({ id, data }: NodeProps<Node<CardData, "card">>) {
  const t = useStore((s) => s.t);
  const n = data.node;
  return (
    <div
      {...mapPoint(t, id, data.name)}
      className={`mp-card ${n.kind}${data.hot ? " hot" : ""}${data.dim ? " dim" : ""}${data.way ? " way" : ""}${data.centre ? " centre" : ""}${n.kind === "flow" && !n.on ? " off" : ""}`}
      title={data.name}
      style={data.way ? ({ "--way-i": data.wayI ?? 0 } as React.CSSProperties) : undefined}
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

const Frame = memo(function Frame({ id, data }: NodeProps<Node<FrameData, "frame">>) {
  const t = useStore((s) => s.t);
  return (
    <div className={`mp-frame ${data.kind}`}>
      <Handle type="target" position={Position.Left} id="l" />
      {/* An unfolded flow's name chooses it (a press on it is a click, not the start of a pan); pointed at, the flow. */}
      <span
        className={`mp-frame-label${data.kind === "flow" ? " nopan" : ""}`}
        {...(data.kind === "flow" ? mapPoint(t, id, data.label) : {})}
      >
        {data.label}
      </span>
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
});

const StepCard = memo(function StepCard({ id, data }: NodeProps<Node<StepData, "step">>) {
  const t = useStore((s) => s.t);
  return (
    <div
      {...mapPoint(t, id, data.name)}
      className={`mp-step ${data.step.op}${data.dim ? " dim" : ""}${data.run ? ` run-${data.run.state}` : ""}`}
      title={data.desc ? `${data.name} — ${data.desc}` : data.name}
      style={
        data.run?.state === "ran"
          ? ({ "--way-i": data.wayI ?? 0 } as React.CSSProperties)
          : undefined
      }
    >
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="target" position={Position.Left} id="l" />
      <div className="mp-head">
        <span className="mp-icon">
          <StepIcon op={data.step.op} />
        </span>
        <span className="mp-name">{data.name}</span>
      </div>
      {(data.model || data.numbers || data.step.detail) && (
        <div className="mp-line">
          {data.model || data.numbers
            ? [data.model, data.numbers].filter(Boolean).join(" · ")
            : data.step.detail}
        </div>
      )}
      {data.run && (
        <div className="mp-line mp-run-line">
          {data.run.line}
          {data.run.own && <span className="mp-run-own"> · {data.run.own}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Right} id="r" />
    </div>
  );
});

/** What a flow's trigger brings: the names its steps read that no step makes («mail», «text»), in their order. */
function bringsOf(steps: readonly FlowStep[]): string[] {
  const own = new Set([...steps.map((s) => s.id), "item", "zip"]);
  const out: string[] = [];
  for (const s of steps)
    for (const r of refsUsed(s)) {
      const name = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(r)?.[1];
      if (name && !own.has(name) && !out.includes(name)) out.push(name);
    }
  return out;
}

/** An unfolded flow's first box: what starts it («Llega a Correos») and what it brings, as its editor shows it. */
const TrigCard = memo(function TrigCard({ id, data }: NodeProps<Node<TrigData, "trig">>) {
  const t = useStore((s) => s.t);
  return (
    <div
      {...mapPoint(t, id, data.text)}
      className={`mp-step mp-trig${data.dim ? " dim" : ""}${data.way ? " run-ran" : ""}`}
      title={data.text}
      style={data.way ? ({ "--way-i": data.wayI ?? 0 } as React.CSSProperties) : undefined}
    >
      <Handle type="target" position={Position.Left} id="l" />
      <div className="mp-head">
        <span className="mp-icon">
          <Zap size={13} strokeWidth={1.8} aria-hidden />
        </span>
        <span className="mp-name">{data.text}</span>
      </div>
      {data.brings && <div className="mp-line">{data.brings}</div>}
      <Handle type="source" position={Position.Bottom} id="b" />
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
  /** On a run's way: lit, its light moving along it, in its place along the way. */
  way?: boolean;
  wayI?: number;
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
        className={`mp-edge ${d.kind}${d.outside ? " outside" : ""}${d.hot ? " hot" : ""}${d.dim ? " dim" : ""}${d.way ? " way" : ""}`}
        style={d.way ? ({ "--way-i": d.wayI ?? 0 } as React.CSSProperties) : undefined}
      />
      {d.label && !d.dim && (
        <EdgeLabelRenderer>
          <div
            className={`mp-edge-label ${d.kind}${d.outside ? " outside" : ""}${d.hot ? " hot" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            title={d.outside ? t("map.outside") : d.kind === "order" ? d.label : undefined}
          >
            {d.outside && <Mail size={9} strokeWidth={2} aria-hidden className="mp-outside-mark" />}
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/**
 * What a step gave the next one, said as a person reads it (task 91, Juan: «lo que ha enviado al siguiente paso de
 * forma legible»): a list as its items (a thing by its title and its day), a record as its fields by name, a value as
 * text, a day or an instant as a date. A model's words stay text: nothing becomes a link or markup.
 */
function Readable({ v, depth = 0 }: { v: unknown; depth?: number }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const name = (k: string) => {
    const x = t(`run.out.${k}`);
    return x === `run.out.${k}` ? k.replace(/_/g, " ") : x;
  };
  if (v === null || v === undefined || v === "") return <span className="muted">—</span>;
  if (typeof v !== "object") return <span>{valueText(v, lang)}</span>;
  if (depth > 3) return <span>{JSON.stringify(v).slice(0, 300)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="muted">{t("run.out.none")}</span>;
    return (
      <ul className="mp-out-list">
        {v.slice(0, 20).map((x, i) => (
          <li key={i}>
            {isRecord(x) && typeof x.title === "string" ? (
              <>
                <strong>{x.title}</strong>
                <Readable
                  v={Object.fromEntries(Object.entries(x).filter(([k]) => k !== "title"))}
                  depth={depth + 1}
                />
              </>
            ) : (
              <Readable v={x} depth={depth + 1} />
            )}
          </li>
        ))}
        {v.length > 20 && <li className="muted">{t("way.more", { n: v.length - 20 })}</li>}
      </ul>
    );
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(
    ([, x]) => x !== null && x !== undefined && x !== "" && !(Array.isArray(x) && !x.length),
  );
  if (!entries.length) return null;
  return (
    <dl className="mp-out">
      {entries.slice(0, 20).map(([k, x]) => (
        <div key={k}>
          <dt>{name(k)}</dt>
          <dd>
            <Readable v={x} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A proposal as the Bandeja showed it: its title, where it goes and what became of it, its fields by name. */
function ProposalOut({ p, collection }: { p: RunDetail["proposals"][number]; collection: string }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const rows = (p.rows ?? []).filter((r) => r.name !== "title" && r.value !== p.title);
  return (
    <div className="mp-out-card">
      <div>
        <strong>«{p.title || "…"}»</strong>
        <span className="muted">
          {collection ? ` · ${collection}` : ""} · {t(`log.proposal.${p.status}`)}
        </span>
      </div>
      {rows.length > 0 && (
        <dl className="mp-out">
          {rows.map((r) => (
            <div key={r.name}>
              <dt>{r.name}</dt>
              <dd>{valueText(r.value, lang)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** A record of the user's: its title and its fields by name. */
function RecordOut({ r }: { r: RecordView }) {
  const lang = useStore((s) => s.settings.language);
  return (
    <div className="mp-out-card">
      <div>
        <strong>{r.title || "…"}</strong>
        <span className="muted"> · {r.collection}</span>
      </div>
      {r.fields.length > 0 && (
        <dl className="mp-out">
          {r.fields.map((f) => (
            <div key={f.name}>
              <dt>{f.name}</dt>
              <dd>{valueText(f.value, lang)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * What came out of a box in the run on the map (task 91, Juan: «en la tarea, los datos de la fila generada; en la
 * bandeja, esa tarjeta generada»): the mail that started it, what a step gave the next one, the proposals in the
 * Bandeja, the record a collection got. In orange, as all that is this run's.
 */
function RunHere({
  run,
  node,
  step,
  collectionName,
  money,
  onWay,
}: {
  run: RunDetail & { owner: string };
  node: MapNode;
  step: string | null;
  collectionName: (type: string | null) => string;
  money: (usd: number) => string;
  /** The box is on the run's way (a connector off it brought something else). */
  onWay: boolean;
}) {
  const t = useStore((s) => s.t);
  const mail = run.input ? (
    <RecordOut
      r={{
        id: run.input.id,
        title: run.input.title,
        collection: run.input.collection,
        fields: run.input.fields ?? [],
      }}
    />
  ) : null;
  let body: React.ReactNode = null;
  if (node.id === run.owner && step === TRIGGER) body = mail;
  else if (node.id === run.owner && step) {
    const s = run.steps.find((x) => x.id === step);
    const made = run.proposals.filter((p) => p.step === step);
    body = s ? (
      <>
        <p className="mp-out-line">
          {runStepLine(t, s)}
          {s.calls ? (
            <span>
              {" · "}
              {t(s.calls === 1 ? "map.calls.one" : "map.callsShort", { n: s.calls })}
              {s.cost ? ` · ${money(s.cost)}` : ""}
            </span>
          ) : null}
        </p>
        {s.output !== null && s.output !== undefined ? (
          <Readable v={s.output} />
        ) : s.answers.length ? (
          <pre className="mp-out-text">{s.answers.join("\n")}</pre>
        ) : null}
        {s.what === "entities.get" && !made.length && mail}
        {made.map((p) => (
          <ProposalOut key={p.id ?? p.title} p={p} collection={collectionName(p.type)} />
        ))}
      </>
    ) : (
      <p className="mp-out-line">{t("run.node.never")}</p>
    );
  } else if (node.id === run.owner) {
    const calls = run.steps.reduce((n, x) => n + (x.calls ?? 0), 0);
    const cost = run.steps.reduce((n, x) => n + (x.cost ?? 0), 0);
    body = (
      <p className="mp-out-line">
        {runStatusLine(t, run.status)}
        {calls ? ` · ${t(calls === 1 ? "map.calls.one" : "map.callsShort", { n: calls })}` : ""}
        {cost ? ` · ${money(cost)}` : ""}
      </p>
    );
  } else if (
    onWay &&
    (node.kind === "connector" || (run.input && node.id === `col:${run.input.type}`))
  )
    body = mail;
  else if (node.id === "boni:inbox")
    body = run.proposals.length ? (
      run.proposals.map((p) => (
        <ProposalOut key={p.id ?? p.title} p={p} collection={collectionName(p.type)} />
      ))
    ) : (
      <p className="mp-out-line muted">{t("run.out.none")}</p>
    );
  else if (node.kind === "collection") {
    const type = node.id.slice("col:".length);
    const here = run.proposals.filter((p) => p.type === type);
    const wrote = run.changes.filter((c) => c.type === type);
    body =
      here.length || wrote.length ? (
        <>
          {here.map((p) =>
            p.record ? (
              <RecordOut key={p.id ?? p.title} r={p.record} />
            ) : (
              <p key={p.id ?? p.title} className="mp-out-line">
                «{p.title || "…"}» · {t(`run.out.proposal.${p.status}`)}
              </p>
            ),
          )}
          {wrote.map((c) => (
            <p key={`${c.action}:${c.title}`} className="mp-out-line">
              {t(`log.change.${c.action}`, { title: c.title, collection: c.collection })}
            </p>
          ))}
        </>
      ) : null;
  }
  if (!body) return null;
  return (
    <section className="mp-here" aria-label={t("run.out.here")}>
      <h4>{t("run.out.here")}</h4>
      {body}
    </section>
  );
}

type Box = { x: number; y: number; w: number; h: number };
const meets = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * An arrow says its words only where they cover no box and no other arrow's words (task 90; Juan, 2026-11-06: «líneas
 * que tapan items, texto… que se solapan»): the rest say them when lit (a hover, the chosen box). The words sit where
 * React Flow puts them, half way between the arrow's two ends; a run's way is placed first.
 */
export function wordsWhereFree(nodes: RFNode[], edges: Edge<EdgeData>[]): Edge<EdgeData>[] {
  const size = (n: RFNode) => ({
    w: n.measured?.width ?? n.width ?? 0,
    h: n.measured?.height ?? n.height ?? 0,
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const boxes: Box[] = nodes
    .filter((n) => n.type !== "frame")
    .map((n) => ({ x: n.position.x, y: n.position.y, ...size(n) }));
  const placed: Box[] = [];
  const hidden = new Set<string>();
  // Pointed at (a hover, the chosen box): said, whatever it covers, for as long as it is pointed at. A run's way is
  // placed first, but its words cover nothing either.
  const pointed = (e: Edge<EdgeData>) => !!e.data?.hot && !e.data?.way;
  const first = (e: Edge<EdgeData>) => (pointed(e) ? 0 : e.data?.way ? 1 : 2);
  for (const e of [...edges].sort((a, b) => first(a) - first(b))) {
    const d = e.data;
    if (!d?.label || d.dim) continue;
    const from = byId.get(e.source);
    const to = byId.get(e.target);
    if (!from || !to) continue;
    const f = size(from);
    const g = size(to);
    const down = e.sourceHandle === "b";
    const sx = down ? from.position.x + f.w / 2 : from.position.x + f.w;
    const sy = down ? from.position.y + f.h : from.position.y + f.h / 2;
    // Into a step from above (a lane's arrow), or into a box from the left.
    const tx = e.targetHandle === "t" ? to.position.x + g.w / 2 : to.position.x;
    const ty = e.targetHandle === "t" ? to.position.y : to.position.y + g.h / 2;
    // The pill: 10.5 px words and its padding; a lane's name at most 180 px.
    const w = Math.min(d.label.length * 5.8 + 14, d.order ? 180 : Number.POSITIVE_INFINITY);
    const h = 18;
    const r = { x: (sx + tx) / 2 - w / 2, y: (sy + ty) / 2 - h / 2, w, h };
    if (!pointed(e) && (boxes.some((b) => meets(r, b)) || placed.some((b) => meets(r, b))))
      hidden.add(e.id);
    else placed.push(r);
  }
  return hidden.size
    ? edges.map((e) =>
        hidden.has(e.id) ? { ...e, data: { ...(e.data as EdgeData), label: "" } } : e,
      )
    : edges;
}

const NODE_TYPES: NodeTypes = { card: MapCard, frame: Frame, step: StepCard, trig: TrigCard };
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
/**
 * How far the map reaches from its centre, back and forth: one slider (Juan, 2026-11-06: «una sola barra deslizante con
 * título "Profundidad"»), from one arrow to all of them, its value said beside it.
 */
function Depth({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  /** How far the map reaches from its centre at most: past it, nothing more is shown. */
  max: number;
  onChange: (n: number) => void;
}) {
  const t = useStore((s) => s.t);
  const top = Math.max(1, max);
  // «Todo» is the deepest the centre reaches, said by its number (task 91, Juan: «"5 (max)"»).
  const at = Number.isFinite(value) ? Math.min(Math.max(1, value), top) : top;
  const said = at === top ? t("map.depthMax", { n: top }) : String(at);
  return (
    <div className="mp-depth">
      <span className="muted small" aria-hidden="true">
        {label}
      </span>
      <input
        type="range"
        min={1}
        max={top}
        step={1}
        value={at}
        disabled={top === 1}
        aria-label={label}
        aria-valuetext={said}
        onChange={(e) => {
          const n = Number(e.target.value);
          // The deepest stays the deepest when the map grows.
          onChange(n >= top ? Number.POSITIVE_INFINITY : n);
        }}
      />
      <span className="mp-depth-value small">{said}</span>
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

/**
 * Each lane of a flow by the collection its steps write in («Tarea»), when one of them writes in a single written
 * collection; else as its choice says it (the decider's whole option, «Tarea (p. ej.: …)», is too long for a pill).
 */
function laneNames(
  steps: readonly FlowStep[],
  keyName: (key: string) => string | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of steps) {
    const c = choiceOf(s as never);
    if (!c || out.has(c.value)) continue;
    const keys = typeKeysOf((s as { args?: Record<string, unknown> }).args?.type);
    if (keys.length === 1) out.set(c.value, keyName(keys[0] as string) ?? (keys[0] as string));
  }
  return out;
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
  money,
  onHide,
}: {
  run: RunDetail;
  story: { title: string; origin: Origin } | null;
  owner: string;
  when: (ms: number) => string;
  money: (usd: number) => string;
  /** «Ocultar» (task 91, Juan: «se debería poder ocultar»): a chip «Explicación» brings it back. */
  onHide: () => void;
}) {
  const t = useStore((s) => s.t);
  // Its words, as the Registro says them (core/runText.ts), under «Detalles»; «Copiar» puts them in the clipboard.
  const [more, setMore] = useState(false);
  const w = runWords(t, run, money);
  const copy = () =>
    void navigator.clipboard
      .writeText(runCopy(t, run, w, when(run.started)))
      .then(() => toast(t("log.copied")));
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
    // What it told went to the devices (the server's count: a «Probar» told nothing).
    ...(run.told.length ? [t("way.told")] : []),
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
      <div className="mp-way-head">
        <h4>{story ? t("origin.title", { title: story.title || "…" }) : t("way.title")}</h4>
        <button
          type="button"
          className="icon-btn tiny"
          aria-label={t("way.hide")}
          title={t("way.hide")}
          onClick={onHide}
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      </div>
      <ol>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
      {more && (
        <div className="mp-way-more">
          <ol>
            {w.steps.map((x) => (
              <li key={x.id}>
                <strong>{x.name}</strong> — {x.line}
                {x.desc && <span className="mp-way-desc muted">{x.desc}</span>}
                {x.answers.map((a, i) => (
                  <pre key={i}>{a}</pre>
                ))}
              </li>
            ))}
          </ol>
          {(
            [
              [t("log.read"), w.read],
              [t("log.decisions"), w.decided],
              [t("log.models"), w.models],
            ] as const
          ).map(([name, items]) =>
            items.length ? (
              <div key={name} className="mp-way-block">
                <span className="muted">{name}</span>
                <ul>
                  {items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </div>
      )}
      <div className="mp-way-tools">
        <button
          type="button"
          className="link-btn small"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          {more ? t("way.less") : t("way.details")}
        </button>
        <button type="button" className="link-btn small" onClick={copy}>
          {t("log.copy")}
        </button>
      </div>
    </section>
  );
}

function Canvas({
  map: period,
  only,
  kept,
  setKept,
}: {
  /** The map of the period, as the server computed it. */
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
  // The run's «Explicación», hidden on this device until shown again (task 91).
  const [wayHidden, setWayHidden] = useState(() => {
    try {
      return localStorage.getItem(WAY_HIDDEN) === "1";
    } catch {
      return false;
    }
  });
  const hideWay = (h: boolean) => {
    setWayHidden(h);
    try {
      if (h) localStorage.setItem(WAY_HIDDEN, "1");
      else localStorage.removeItem(WAY_HIDDEN);
    } catch {
      // A private window keeps nothing: it is hidden until the map is left.
    }
  };
  // A step of the chosen flow, when a step was clicked: its own panel (task 91).
  const [picked, setPicked] = useState<string | null>(null);
  // A box chosen any other way (its name in a panel, the search, a menu, «×»): the step picked before is forgotten.
  const pick = (id: string | null) => {
    setSelected(id);
    setPicked(null);
  };
  const [hover, setHover] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [byRole, setByRole] = useState<Record<string, string>>({});
  // A run on the map (§4.4, «una ejecución encima»): its flow unfolded, each step with what came of it.
  const [run, setRun] = useState<(RunDetail & { owner: string }) | null>(null);
  // The map with what that run told on it (docs/sistema.md §4.4, «Una ejecución que avisó la recorre»): its arrow to
  // the devices, from the steps that told, drawn also when the period has no notice of its owner's (a run from before
  // it, a flow that tells no more).
  const map = useMemo(() => {
    const devices = run?.told.length ? mapDevices() : null;
    if (!run || !devices) return period;
    const steps = run.told.map((x) => x.step);
    return {
      ...period,
      ...withTold(period, {
        owner: run.owner,
        steps,
        devices,
        arrow: { from: run.owner, to: MAP_DEVICES, kind: "tells", n: null, steps, outside: false },
      }),
    };
  }, [period, run]);
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
          // «Recorrido» (task 90): asked with no centre, it is centred on where the run belongs.
          if (!centre && map.nodes.some((x) => x.id === owner)) setCenter(owner);
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
  const money = (n: number) => moneyText(lang, n);
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
  // The way a run on the map went (§4.4, «una ejecución encima»): what started it, its flow or the conversation, what
  // it read, the Bandeja and where what it proposed was accepted, where it wrote. The rest goes quiet.
  const way = useMemo(() => {
    if (!run) return null;
    const owner = run.owner;
    const col = (type: string | null | undefined) => (type ? [`col:${type}`] : []);
    const nodes = new Set<string>([owner]);
    const edges = new Set<string>();
    // What brought it, in order (the mail's connector, the collection it came into), and where it ended.
    const from: string[] = [];
    const accepted: string[] = [];
    const wrote: string[] = [];
    const add = (a: string, b: string, kind: string) => {
      nodes.add(a);
      nodes.add(b);
      edges.add(`${a}>${b}>${kind}`);
    };
    /** A flow a connector starts (Boni's «Traer correo», D-50): what it brings in. */
    const byConnector = (id: string) => map.edges.some((x) => x.to === id && x.kind === "brings");
    /** What brought something into a box: a connector straight in, or through the flow it starts. */
    const bringIn = (to: string) => {
      for (const e of map.edges) {
        if (e.to !== to) continue;
        if (e.kind === "brings") {
          add(e.from, to, "brings");
          from.push(e.from);
        } else if (e.kind === "writes" && e.from !== owner && byConnector(e.from)) {
          bringIn(e.from);
          add(e.from, to, "writes");
          from.push(e.from);
        }
      }
    };
    for (const c of col(run.input?.type)) {
      bringIn(c);
      from.push(c);
      add(c, owner, "starts");
    }
    // A run of «Traer correo» itself: the connector before it, and the collection it keeps the mail in after it.
    if (!run.input && byConnector(owner)) {
      bringIn(owner);
      for (const e of map.edges)
        if (e.from === owner && e.kind === "writes") {
          add(owner, e.to, "writes");
          if (!wrote.includes(e.to)) wrote.push(e.to);
        }
    }
    // What it read (what was pending, the people a mail names) is not where it went (task 91: every collection lit).
    // An «Aceptar» writes out of the Bandeja: its arrow is «aceptadas».
    const wroteBy = owner === "boni:inbox" ? "accepts" : "writes";
    if (run.proposals.length) add(owner, "boni:inbox", "proposes");
    for (const p of run.proposals)
      if (p.status === "accepted")
        for (const c of col(p.type)) {
          add("boni:inbox", c, "accepts");
          if (!accepted.includes(c)) accepted.push(c);
        }
    for (const w of run.changes)
      for (const c of col(w.type)) {
        add(owner, c, wroteBy);
        if (!wrote.includes(c)) wrote.push(c);
      }
    // What it told went on to the devices, from the steps that told (`map` above has that arrow for it).
    const told = new Set(run.told.map((x) => x.step));
    if (
      told.size &&
      map.edges.some((e) => e.from === owner && e.to === MAP_DEVICES && e.kind === "tells")
    )
      add(owner, MAP_DEVICES, "tells");
    // The steps that did something, in the order they ran; what was skipped or never reached is not on the way.
    const did = run.steps
      .filter((x) => x.decision !== null && x.decision !== "skip")
      .map((x) => x.id);
    const proposed = new Set(run.steps.filter((x) => x.decision === "propose").map((x) => x.id));
    return { nodes, edges, from, accepted, wrote, did, ran: new Set(did), proposed, owner, told };
  }, [run, map.edges]);
  // A run's flow drawn as it ran: the version it ran when that is not the flow's latest (review of task 90: a reading
  // of the version before «Crear en la elegida» lost its way after the Decisora), its boxes and its steps by its plan.
  const drawn = useMemo(() => {
    if (!run?.drawn) return base;
    const d = run.drawn;
    return {
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === run.owner ? { ...n, plan: d.plan, steps: d.steps } : n,
      ),
    };
  }, [base, run]);
  const view = useMemo(
    () => lensOf(drawn, { ...lens, ...(way ? { keep: way.nodes } : {}) }),
    [
      drawn,
      way,
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
  // How far the centre reaches: the depth past which the map shows nothing more (task 91: the slider goes to it).
  const deepest = useMemo(() => {
    if (!center) return 1;
    const o = { ...lens, before: Number.POSITIVE_INFINITY, after: Number.POSITIVE_INFINITY };
    const all = lensOf(drawn, o).nodes.length;
    for (let k = 1; k < 12; k++)
      if (lensOf(drawn, { ...o, before: k, after: k }).nodes.length >= all) return k;
    return 12;
  }, [drawn, center, lens.ai, lens.writes, lens.on, lens.pages, lens.happened]);
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
          trigger: { id: TRIGGER, height: TRIGGER_H },
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

  /**
   * The way's places, from where it came in to where it ended (task 91, Juan: «que se vea la animación desde principio
   * a fin»): the connector, the collection, what started the flow, each step that did something and, between two of
   * them, the shortest way along the canvas's arrows (never another lane's: «se activan para todas las líneas»), the
   * Bandeja after the step that proposed, the collection after the Bandeja. A light goes along them in this order.
   */
  const wayOrder = useMemo(() => {
    if (!way) return null;
    const pos = new Map<string, number>();
    const lit = new Set<string>();
    const put = (id: string, at: number) => {
      if (!pos.has(id)) pos.set(id, at);
    };
    let i = 0;
    for (const id of way.from) put(id, i++);
    const frame = graph.inner.get(way.owner);
    const stepId = (x: string) => `step:${way.owner}:${x}`;
    let last = i;
    if (frame) {
      const next = new Map<string, string[]>();
      for (const k of frame.links) next.set(k.from, [...(next.get(k.from) ?? []), k.to]);
      const pathTo = (a: string, b: string): string[] | null => {
        const back = new Map<string, string>([[a, a]]);
        const queue = [a];
        while (queue.length) {
          const x = queue.shift() as string;
          if (x === b) break;
          for (const y of next.get(x) ?? [])
            if (!back.has(y)) {
              back.set(y, x);
              queue.push(y);
            }
        }
        if (!back.has(b)) return null;
        const path = [b];
        while (path[0] !== a) path.unshift(back.get(path[0] as string) as string);
        return path;
      };
      const at = new Map<string, number>([[TRIGGER, i]]);
      const miles = [TRIGGER, ...way.did.filter((x) => frame.at.has(x))];
      for (let m = 1; m < miles.length; m++) {
        const to = miles[m] as string;
        // From the latest step that leads to it (a step in another lane went on from the choice before it).
        for (let k = m - 1; k >= 0; k--) {
          const a = miles[k] as string;
          const path = pathTo(a, to);
          if (!path) continue;
          let p = at.get(a) ?? i;
          for (let q = 1; q < path.length; q++) {
            lit.add(`${path[q - 1]}>${path[q]}`);
            p++;
            if (!at.has(path[q] as string)) at.set(path[q] as string, p);
          }
          break;
        }
      }
      for (const [x, p] of at) put(stepId(x), p);
      last = Math.max(i, ...at.values());
    } else {
      put(way.owner, i);
      last = i;
    }
    // The Bandeja after the step that proposed (or the flow), the collections after it; where it wrote, after its end.
    if (way.nodes.has("boni:inbox") && way.owner !== "boni:inbox") {
      const by = [...way.proposed].map((x) => pos.get(stepId(x)) ?? -1);
      const b = (by.length && Math.max(...by) >= 0 ? Math.max(...by) : last) + 1;
      put("boni:inbox", b);
      for (const c of way.accepted) put(c, b + 1);
    } else if (way.owner === "boni:inbox") {
      for (const c of way.accepted) put(c, last + 1);
    }
    for (const c of way.wrote) put(c, last + 1);
    // The devices after its end, as where it wrote.
    if (way.nodes.has(MAP_DEVICES)) put(MAP_DEVICES, last + 1);
    return { pos, lit, max: Math.max(0, ...pos.values()) };
  }, [way, graph]);

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
      if (v === "connector:mail") return t("flows.on.connector.mail");
      if (v === "learning:mail") return t("flows.on.learning.mail");
      if (v === "spending:warn") return t("flows.on.spending.warn");
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
        const onWay = way?.owner === n.id;
        const byId = new Map(n.steps.map((s) => [s.id, s]));
        const dimHere = near ? !near.has(n.id) : !!way && !way.nodes.has(n.id);
        const tp = l.at.get(TRIGGER);
        if (tp)
          out.push({
            id: `step:${n.id}:${TRIGGER}`,
            type: "trig",
            position: { x: cx + tp.x, y: top + tp.y },
            data: {
              text: n.trigger ? triggerText(t, n.trigger, keyName) : t("flows.on.manual"),
              brings: bringsOf(n.plan.steps)
                .map((x) => inputName(t, x))
                .join(" · "),
              dim: dimHere,
              way: onWay,
              wayI: wayOrder?.pos.get(`step:${n.id}:${TRIGGER}`),
            },
            draggable: false,
            className: "nopan",
            zIndex: BOX_Z,
          });
        // A lane by the collection its steps write in («Tarea»), not the whole option the decider read.
        const lanes = laneNames(n.plan.steps, keyName);
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
              name: stepName(t, node),
              model: role ? (byRole[role] ?? null) : null,
              // The period's numbers, when no run is on it (with one, its own, in orange: «datos generales» apart).
              numbers:
                !ran && node.calls && node.calls > 0
                  ? `${t(node.calls === 1 ? "map.calls.one" : "map.callsShort", { n: node.calls })}${node.cost ? ` · ${money(node.cost)}` : ""}`
                  : null,
              desc: stepDesc(t, node),
              dim: dimHere,
              wayI: wayOrder?.pos.get(`step:${n.id}:${s.id}`),
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
                        own: r.calls
                          ? `${t(r.calls === 1 ? "map.calls.one" : "map.callsShort", { n: r.calls })}${r.cost ? ` · ${money(r.cost)}` : ""}`
                          : null,
                      },
                    };
                  })()
                : {}),
            },
            draggable: false,
            className: "nopan",
            zIndex: BOX_Z,
          });
        }
        // The run's way between its steps: the arrows it went along (see `wayOrder`).
        for (const k of l.links) {
          const lit = onWay && !!wayOrder?.lit.has(`${k.from}>${k.to}`);
          rfEdges.push({
            id: `order:${n.id}:${k.from}>${k.to}`,
            source: `step:${n.id}:${k.from}`,
            target: `step:${n.id}:${k.to}`,
            sourceHandle: "b",
            targetHandle: "t",
            type: "map",
            data: {
              label: k.lane ? (lanes.get(k.lane) ?? k.lane) : "",
              kind: "order",
              outside: false,
              hot: false,
              dim: false,
              order: true,
              ...(lit ? { way: true, wayI: wayOrder?.pos.get(`step:${n.id}:${k.to}`) } : {}),
            },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            zIndex: 1,
          });
        }
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
          // On the way whatever is pointed at: the light keeps its turn (task 91's review: a hover restarted it).
          way: !!way && way.nodes.has(n.id),
          wayI: wayOrder?.pos.get(n.id),
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
        zIndex: BOX_Z,
      });
    }
    // An arrow to or from an unfolded flow goes to the steps that make it, when it says them; what starts it, to its
    // trigger; what it proposes leaves it once (task 90: one arrow per step crossed the other lanes), from the steps
    // that proposed when a run of it is on the map.
    const ends = (id: string, steps: string[], e: MapEdge, from: boolean) => {
      const frame = graph.inner.get(id);
      if (!frame) return [id];
      if (!from && e.kind === "starts") return [`step:${id}:${TRIGGER}`];
      // Each step once, and only those its frame draws (a run of an earlier version has its own).
      const here = [...new Set(steps)].filter((x) => frame.at.has(x));
      if (from && e.kind === "proposes") {
        const did = way?.owner === id ? here.filter((x) => way.proposed.has(x)) : [];
        return did.length ? did.map((x) => `step:${id}:${x}`) : [id];
      }
      return here.length ? here.map((x) => `step:${id}:${x}`) : [id];
    };
    for (const e of view.edges) {
      // Into the Bandeja with a collection in the centre: what went to that collection (§4.4: «Leer correo
      // (propone, 23)» for Evento), not to all.
      const n = center && e.per && center in e.per ? (e.per[center] ?? 0) : e.n;
      const label = `${t(`map.edge.${e.kind}`)}${n !== null && n > 0 ? ` · ${n.toLocaleString(lang === "en" ? "en-GB" : "es-ES")}` : ""}`;
      const onWay = !!way && way.edges.has(`${e.from}>${e.to}>${e.kind}`);
      const hot = focus ? e.from === focus || e.to === focus : onWay;
      // An arrow going back (right to left: what someone who acts reads, a lesson to an earlier flow) crosses the
      // boxes in between: its words only when it is lit, never over a card's name.
      const back =
        (graph.layout.at.get(e.from)?.x ?? 0) > (graph.layout.at.get(e.to)?.x ?? 0) && !hot;
      // What a run told left from the steps that told in it: of its flow's «avisa», only those arrows are its way
      // (another «Avisar» it skipped stays quiet), and they come first.
      const toldFrom =
        onWay && e.kind === "tells" && way
          ? new Set([...way.told].map((x) => `step:${e.from}:${x}`))
          : null;
      const froms = ends(e.from, e.steps, e, true);
      if (toldFrom) froms.sort((a, b) => Number(toldFrom.has(b)) - Number(toldFrom.has(a)));
      // An arrow that leaves from (or reaches) several steps says its words once, on the first of them.
      let said = false;
      for (const from of froms)
        for (const to of ends(e.to, e.steps, e, false)) {
          const words = said || back ? "" : label;
          said = true;
          const on = onWay && (!toldFrom || from === e.from || toldFrom.has(from));
          const lit = focus ? hot : on;
          rfEdges.push({
            id: `${from}>${to}>${e.kind}`,
            source: from,
            target: to,
            sourceHandle: from.endsWith(`:${TRIGGER}`) ? "b" : "r",
            targetHandle: "l",
            type: "map",
            data: {
              label: words,
              kind: e.kind,
              outside: e.outside,
              hot: lit,
              dim: focus ? !hot && !on : !!way && !on,
              ...(on
                ? { way: true, wayI: wayOrder?.pos.get(to) ?? wayOrder?.pos.get(e.to) ?? 0 }
                : {}),
            },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
            zIndex: lit ? 2 : 0,
          });
        }
    }
    return { nodes: out, edges: rfEdges };
  }, [graph, view, near, focus, selected, center, nameOf, t, byRole, lang, run, way, wayOrder]);

  const chosen = selected ? map.nodes.find((n) => n.id === selected) : undefined;
  // The step clicked in the chosen flow, by its name, what it does, its model and the period's numbers.
  const pickedStep = (() => {
    if (!chosen || !picked || chosen.kind !== "flow") return null;
    const drawnNode = drawn.nodes.find((n) => n.id === chosen.id) ?? chosen;
    if (picked === TRIGGER)
      return {
        name: chosen.trigger ? triggerText(t, chosen.trigger, keyName) : t("flows.on.manual"),
        desc: t("map.triggerDesc"),
        model: null,
        numbers: null,
        decider: null,
        piece: null,
      };
    const node = drawnNode.steps.find((x) => x.id === picked);
    if (!node) return null;
    const role =
      node.op === "read"
        ? node.what === "classify"
          ? "decider"
          : node.what === "review_reading"
            ? "reviewer"
            : "reader"
        : null;
    return {
      name: stepName(t, node),
      desc: stepDesc(t, node),
      model: role ? (byRole[role] ?? null) : null,
      numbers:
        node.calls && node.calls > 0
          ? `${t(node.calls === 1 ? "map.calls.one" : "map.callsShort", { n: node.calls })}${node.cost ? ` · ${money(node.cost)}` : ""}`
          : null,
      // The decider says what it chooses among and the guide's rules that choose for it (task 83).
      decider: role === "decider" && drawnNode.plan ? { plan: drawnNode.plan, id: node.id } : null,
      // A piece's own settings: «Aceptar solas»' «Solo» switch, «Plegar hilo»'s days (task 83).
      piece:
        node.op === "call" ? (drawnNode.plan?.steps.find((x) => x.id === node.id) ?? null) : null,
    };
  })();
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
  const shownEdges = useMemo(() => wordsWhereFree(nodes, edges), [nodes, edges]);
  // Fitted when the boxes on the canvas move (a new centre, a grouping, a flow unfolded) and all are measured: never on a
  // hover, which only redraws them, and a fit then would move them under the pointer in the middle of a click.
  const ready = useNodesInitialized();
  const placed = `${nodes
    .map((n) => `${n.id}@${Math.round(n.position.x)},${Math.round(n.position.y)}`)
    .join("|")}${run && !wayHidden ? "|run" : ""}`;
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !placed || fitted.current === placed) return;
    // A moment later, once React Flow has the new places too; a new measure in between starts the wait again.
    const id = setTimeout(() => {
      fitted.current = placed;
      // A run's card over the top left corner never covers what it tells (task 90: its card hid the flow's name):
      // the map fits below it (on the phone the card is above the map, not over it).
      const card = stage.current?.querySelector<HTMLElement>(".mp-way");
      const over = !!card && getComputedStyle(card).position === "absolute";
      const top = card && over ? Math.round(card.getBoundingClientRect().height + 20) : 0;
      // On the phone, never so small that a card cannot be read: the middle of it, the rest a finger away.
      void fitView({
        padding: top ? { top: `${top}px`, right: "6%", bottom: "6%", left: "6%" } : 0.06,
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
            {/* One depth, back and forth (Juan, 2026-11-06: «una sola barra… "Profundidad"»). */}
            <Depth
              label={t("map.depth")}
              value={kept.lens.before}
              max={deepest}
              onChange={(n) => setLens({ before: n, after: n })}
            />
          </>
        ) : (
          <MapFind
            nodes={findable}
            onPick={(id) => {
              setCenter(id);
              pick(id);
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
                // What only the run put on the map (the devices, when the period has no notice) goes with it:
                // neither chosen nor in the centre any more.
                const gone = (id: string | null) => !!id && !period.nodes.some((n) => n.id === id);
                if (gone(selected)) pick(null);
                if (gone(center)) setCenter(null);
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
      <div
        className={`mp-stage${chosen ? " with-panel" : ""}`}
        ref={stage}
        style={wayOrder ? ({ "--way-n": wayOrder.max } as React.CSSProperties) : undefined}
      >
        {/* Whose numbers they are: the period's; in orange, the run's (task 91). */}
        <div className="mp-legend muted">
          <span>{t("map.legend.period", { n: kept.days })}</span>
          {run && <span className="mp-legend-run">{t("map.legend.run")}</span>}
        </div>
        {run && !wayHidden && (
          <RunWay
            run={run}
            story={story}
            owner={nameOf.get(run.owner) ?? ""}
            when={when}
            money={money}
            onHide={() => hideWay(true)}
          />
        )}
        {run && wayHidden && (
          <button type="button" className="chip mp-way-chip" onClick={() => hideWay(false)}>
            {t("way.show")}
          </button>
        )}
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
            edges={shownEdges}
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
              const inFlow = n.type === "step" || n.type === "trig";
              const id = inFlow ? n.id.split(":").slice(1, 3).join(":") : n.id;
              if (n.type === "frame" && !id.startsWith("flow:")) return;
              setSelected(id);
              setPicked(inFlow ? n.id.split(":").slice(3).join(":") : null);
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
            onPaneClick={() => {
              setSelected(null);
              setPicked(null);
            }}
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
                <h3>{pickedStep ? pickedStep.name : nameOf.get(chosen.id)}</h3>
                <span className="muted small">
                  {pickedStep
                    ? t("map.stepOf", { name: nameOf.get(chosen.id) ?? "" })
                    : t(`map.kind.${chosen.kind}`)}
                  {!pickedStep && chosen.kind === "flow" && chosen.boni
                    ? ` · ${t("flows.group.boni")}`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={t("flows.close")}
                title={t("flows.close")}
                onClick={() => pick(null)}
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            </div>
            {pickedStep ? (
              <dl className="mp-facts">
                {pickedStep.desc && <dd>{pickedStep.desc}</dd>}
                {pickedStep.model && <dd>{pickedStep.model}</dd>}
                {pickedStep.numbers && (
                  <dd>{t("map.inPeriod", { what: pickedStep.numbers, n: kept.days })}</dd>
                )}
              </dl>
            ) : (
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
            )}
            {pickedStep?.decider && (
              <DeciderFacts
                plan={pickedStep.decider.plan}
                step={pickedStep.decider.id}
                nameOfKey={keyName}
                keyOfId={(id) => map.nodes.find((n) => n.id === `col:${id}`)?.key}
              />
            )}
            {pickedStep?.piece && <PieceFacts step={pickedStep.piece} />}
            {run && (
              <RunHere
                run={run}
                node={chosen}
                step={chosen.id === run.owner ? picked : null}
                collectionName={(type) => (type ? (nameOf.get(`col:${type}`) ?? "") : "")}
                money={money}
                onWay={!!way?.nodes.has(chosen.id)}
              />
            )}
            {!pickedStep && (
              <Joined
                title={t("map.in")}
                list={map.edges
                  .filter((e) => e.to === chosen.id)
                  .map((e) => ({
                    id: e.from,
                    name: nameOf.get(e.from) ?? e.from,
                    label: label(e),
                  }))}
                onPick={(id) => pick(id)}
              />
            )}
            {!pickedStep && (
              <Joined
                title={t("map.out")}
                list={map.edges
                  .filter((e) => e.from === chosen.id)
                  .map((e) => ({ id: e.to, name: nameOf.get(e.to) ?? e.to, label: label(e) }))}
                onPick={(id) => pick(id)}
              />
            )}
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
                    pick(m.id);
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
