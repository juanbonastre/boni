/**
 * The canvas of an automation, C2 of F14b (docs/automatizaciones.md §5.7: AU-05, AU-63, AU-65, AU-66, AU-68, AU-69,
 * AU-86, AU-87): its steps as cards left to right with their outputs on the right, the arrows between them, the
 * four ways of adding a step and their panel, a selected step's bar and its right-click menu, the keys, and bottom
 * left zoom, fit and «Ordenar». It decides nothing: every change is a pure function of automations/edit.ts made
 * into one change of automations/state.ts, which Deshacer walks back; where it goes to the server is the page's
 * (AutomationEditor.tsx). A box moves on the screen while it is dragged and is one change when it is dropped, so a
 * drag sends nothing until then. A step opens in its view (D, AutomationStepView.tsx) over the canvas. After a
 * test (E, AutomationTest.tsx) each arrow and each output left free says how many rows passed and each card how its
 * step ended (AU-67), and a step with a problem is marked (AU-64); dragging to cite (F) comes later.
 */
import {
  type Arrow,
  CATALOGUE,
  inputsOf,
  isTrigger,
  MAIN,
  outputsOf,
  type Step,
} from "@boni/automations";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type Connection,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  getBezierPath,
  Handle,
  type Node,
  type NodeProps,
  NodeToolbar,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  LayoutGrid,
  Maximize,
  MoreHorizontal,
  Plus,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type PanelEntry, panelList, searchPanel } from "../automations/adding.ts";
import { citedName, namesOnDemand } from "../automations/cite.ts";
import { changeMark, chipWords } from "../automations/connections.ts";
import {
  addStep,
  type Clip,
  connect,
  copySteps,
  disconnect,
  pasteSteps,
  removeSteps,
  rename,
  sameArrow,
  setSetting,
} from "../automations/edit.ts";
import {
  type ConditionField,
  cannotTest,
  conditionFieldsOf,
  labelsOf,
  markedOf,
  summaryOf,
} from "../automations/panel.ts";
import { below, CARD, pastedPlaces, tidy, withPlaces } from "../automations/places.ts";
import {
  type AddAt,
  added,
  change,
  type EditorState,
  outputCount,
  redo,
  undo,
} from "../automations/state.ts";
import type { DiffMark } from "../automations/versions.ts";
import {
  DO,
  entryNames,
  KEY,
  labelWord,
  localeOf,
  namer,
  rowsWords,
  said,
  summaryWords,
} from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { toast, useStore } from "../store.ts";
import { AutomationStepView } from "./AutomationStepView.tsx";
import { stateMark, TestBar, useLook, usePhone, useStill, useTester } from "./AutomationTest.tsx";
import { iconOf } from "./automationIcons.ts";
import { MenuRow, MenuSep, PointMenu, PopButton } from "./Popover.tsx";

/** How many characters of labels fit in the card's line (AU-79); what does not fit is «+N». */
const LABEL_BUDGET = 30;

/** What a copy holds between automations of this window (AU-68: a clip pastes into another automation). */
let clip: Clip | null = null;
const newStepId = () => `s_${Math.random().toString(36).slice(2, 10)}`;
const arrowId = (a: Arrow) => `${a.from.step}:${a.from.output}>${a.to.step}:${a.to.input}`;
/** A key typed in a field is the field's (AU-68). */
const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el?.closest(
    "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='menu']",
  );
};

/**
 * What a card and an arrow ask of the canvas: one object for the canvas's life, which calls the canvas of the last
 * render, so a card is drawn again only when its own data changes (a drag repaints the box dragged, not 200 cards).
 */
interface Acts {
  readonly t: T;
  add: (at: AddAt) => void;
  toggleOff: (step: string) => void;
  remove: (steps: string[]) => void;
  startRename: (step: string) => void;
  endRename: (step: string, name: string | null) => void;
  duplicate: (step: string) => void;
  copy: (steps: string[]) => void;
  disconnect: (arrow: Arrow) => void;
  /** «Probar paso» (AU-66, AU-91). */
  testStep: (step: string) => void;
}
const ActsContext = createContext<Acts | null>(null);
const useActs = () => useContext(ActsContext) as Acts;

interface CardData extends Record<string, unknown> {
  step: Step;
  summary: string;
  inputs: { id: string; label: string | null }[];
  /** `count`: what passed by an output with no arrow in the last test (AU-67), dimmed at 0 or when stale. */
  outputs: {
    id: string;
    label: string | null;
    free: boolean;
    count: { words: string; dim: boolean } | null;
  }[];
  /** The only one selected: its bar is shown (AU-66). */
  alone: boolean;
  /** Its name is being edited on the card. */
  renaming: boolean;
  /** Its settings and options not at their default, in one line (AU-79): those that fit, and the rest. */
  /** `change`: the first one is what the step can change (AU-180), not a label. */
  labels: { shown: string[]; rest: string[]; change: boolean };
  /** What required is missing once it is marked (AU-83), «Falta: …»; null with nothing marked. */
  missing: string | null;
  /** The problems a test found in it (AU-64), in words; null with none. */
  problem: string | null;
  /** How it ended in its last test (AU-67); null before one. */
  mark: ReturnType<typeof stateMark>;
  /** Its bar's «Probar paso» (AU-73): why it cannot be pressed, and whether this step is being tested. */
  test: { blocked: boolean; testing: boolean };
  /** Its connections, each a chip hanging under it by a dotted line (AU-40, AU-178): the collection and its words. */
  chips: { collection: string; name: string; words: string }[];
  /** «Salida fijada» (AU-93), with «puede estar vieja» once the step changed; null when nothing is pinned. */
  pinned: string | null;
}
type CardNode = Node<CardData, "step">;
interface ArrowData extends Record<string, unknown> {
  arrow: Arrow;
  /** «128 filas» after a test (AU-67), dimmed with 0 rows or a stale count (AU-92). */
  count: { words: string; dim: boolean } | null;
}
type ArrowEdge = Edge<ArrowData, "arrow">;

/**
 * Two versions compared in «Versiones» (AU-98): what each card of this side's canvas is to the other, by step id
 * (`compared`, automations/versions.ts). None on any other canvas.
 */
export const DiffContext = createContext<Record<string, DiffMark> | null>(null);

/** A step's card (AU-63): its icon, its name and one line of summary, its inputs on the left, its outputs right. */
const StepCard = memo(function StepCard({ data, selected }: NodeProps<CardNode>) {
  const acts = useActs();
  const phone = useStill();
  const { t } = acts;
  const diff = useContext(DiffContext)?.[data.step.id];
  const {
    step,
    summary,
    inputs,
    outputs,
    alone,
    renaming,
    labels,
    missing,
    problem,
    mark,
    test,
    chips,
    pinned,
  } = data;
  const Icon = iconOf(step.type);
  const off = step.settings?.off === true;
  const said = labels.shown.length > 0;
  const height = Math.max(
    CARD.height + (said ? 16 : 0),
    outputs.length * 22 + 20,
    inputs.length * 22 + 20,
  );
  return (
    <div
      className={`auto-card${selected ? " selected" : ""}${off ? " off" : ""}${problem ? " problem" : ""}${diff ? ` diff-${diff}` : ""}`}
      style={{ width: CARD.width, height: height + (mark?.why ? 30 : 0) }}
      data-step={step.id}
      data-state={mark?.state}
      data-diff={diff}
    >
      {diff && <span className="auto-card-diff">{t(`auto.ver.mark.${diff}`)}</span>}
      <NodeToolbar
        isVisible={alone && selected && !phone}
        position={Position.Top}
        className="auto-bar"
      >
        <button
          type="button"
          className="auto-bar-btn"
          data-boni-action="automations.test"
          disabled={test.blocked}
          onClick={() => acts.testStep(step.id)}
        >
          {t(test.testing ? "auto.view.testing" : DO.testStep)}
        </button>
        <button
          type="button"
          className="auto-bar-btn"
          data-boni-action="automations.edit"
          onClick={() => acts.toggleOff(step.id)}
        >
          {t(off ? DO.turnOn : DO.turnOff)}
        </button>
        <button
          type="button"
          className="auto-bar-btn"
          data-boni-action="automations.edit"
          onClick={() => acts.remove([step.id])}
        >
          {t(DO.remove)}
        </button>
        <PopButton
          label={<MoreHorizontal size={15} strokeWidth={1.8} />}
          title={t("auto.more")}
          className="icon-btn auto-bar-btn"
        >
          {(close) => (
            <>
              <MenuRow
                label={t(DO.rename)}
                boniAction="automations.edit"
                onClick={() => {
                  close();
                  acts.startRename(step.id);
                }}
              />
              <MenuRow
                label={t(DO.duplicate)}
                boniAction="automations.edit"
                onClick={() => {
                  close();
                  acts.duplicate(step.id);
                }}
              />
              <MenuRow
                label={t(DO.copy)}
                onClick={() => {
                  close();
                  acts.copy([step.id]);
                }}
              />
            </>
          )}
        </PopButton>
      </NodeToolbar>
      {inputs.map((input, i) => (
        <Handle
          key={input.id}
          id={input.id}
          type="target"
          position={Position.Left}
          className="auto-in"
          style={{ top: `${((i + 1) / (inputs.length + 1)) * 100}%` }}
        >
          {input.label && <span className="auto-in-label">{input.label}</span>}
        </Handle>
      ))}
      <span className="auto-card-icon" aria-hidden>
        <Icon size={18} strokeWidth={1.7} />
      </span>
      <span className="auto-card-text">
        {renaming ? (
          <RenameBox step={step} />
        ) : (
          <span className="auto-card-name" title={step.name}>
            {step.name}
          </span>
        )}
        {summary && (
          <span className="auto-card-summary" title={summary}>
            {summary}
          </span>
        )}
        {mark?.why && (
          <span className="auto-card-why" title={mark.why}>
            {mark.why}
          </span>
        )}
        {said && (
          <span className="auto-card-labels">
            {labels.shown.map((l, i) => (
              <span
                key={l}
                className={`auto-label${i === 0 && labels.change ? " change" : ""}`}
                data-change={i === 0 && labels.change ? "" : undefined}
              >
                {l}
              </span>
            ))}
            {labels.rest.length > 0 && (
              <span className="auto-label more" title={labels.rest.join(" · ")}>
                {t("auto.label.more", { n: labels.rest.length })}
              </span>
            )}
          </span>
        )}
      </span>
      {(missing || problem) && (
        <span
          className="auto-card-mark"
          title={[problem, missing].filter(Boolean).join(" · ")}
          role="img"
          aria-label={[problem, missing].filter(Boolean).join(" · ")}
        >
          !
        </span>
      )}
      {mark && (
        <span className={`auto-card-state ${mark.state}${mark.stale ? " stale" : ""}`}>
          {mark.word}
        </span>
      )}
      {pinned && (
        <span className="auto-card-pin" title={pinned}>
          {pinned}
        </span>
      )}
      {chips.length > 0 && (
        <ul className="auto-card-conns" aria-label={t("auto.conn.title")}>
          {chips.map((c) => (
            <li key={c.collection} className="auto-conn-chip" data-collection={c.collection}>
              <span className="auto-conn-chip-name">{c.name}</span>
              <span className="auto-conn-chip-words">{c.words}</span>
            </li>
          ))}
        </ul>
      )}
      {outputs.map((output, i) => (
        <Handle
          key={output.id}
          id={output.id}
          type="source"
          position={Position.Right}
          className="auto-out"
          style={{ top: `${((i + 1) / (outputs.length + 1)) * 100}%` }}
        >
          {output.label && <span className="auto-out-label">{output.label}</span>}
          {output.free && output.count && (
            <span className={`auto-out-count${output.count.dim ? " dim" : ""}`}>
              {output.count.words}
            </span>
          )}
          {output.free && !phone && (
            <button
              type="button"
              className="auto-out-add nodrag nopan"
              aria-label={t("auto.add")}
              title={t("auto.add")}
              // A press on «+» is not the start of an arrow from its output.
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                acts.add({ from: "output", step: step.id, output: output.id });
              }}
            >
              <Plus size={12} strokeWidth={2} />
            </button>
          )}
        </Handle>
      ))}
    </div>
  );
});

/** The name, edited on the card (AU-86): Intro keeps it, Esc leaves it as it was; empty, nothing changes. */
function RenameBox({ step }: { step: Step }) {
  const acts = useActs();
  const [text, setText] = useState(step.name);
  const done = useRef(false);
  const end = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    acts.endRename(step.id, name);
  };
  return (
    <input
      className="auto-card-rename nodrag"
      aria-label={acts.t(DO.rename)}
      data-boni-action="automations.edit"
      // biome-ignore lint/a11y/noAutofocus: it opens because Juan asked to rename this step
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => end(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") end(text);
        if (e.key === "Escape") end(null);
      }}
    />
  );
}

/** An arrow (AU-66): selected, «+» to put a step in it and the cross that takes it away. */
function ArrowLine(p: EdgeProps<ArrowEdge>) {
  const acts = useActs();
  const phone = useStill();
  const [path, lx, ly] = getBezierPath(p);
  const arrow = p.data?.arrow;
  const count = p.data?.count;
  return (
    <>
      <BaseEdge
        id={p.id}
        path={path}
        className={`auto-arrow${p.selected ? " selected" : ""}${count?.dim ? " dim" : ""}`}
      />
      {count && !p.selected && (
        <EdgeLabelRenderer>
          <div
            className={`auto-arrow-count${count.dim ? " dim" : ""}`}
            data-arrow={p.id}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {count.words}
          </div>
        </EdgeLabelRenderer>
      )}
      {p.selected && arrow && !phone && (
        <EdgeLabelRenderer>
          <div
            className="auto-arrow-bar nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            <button
              type="button"
              className="icon-btn"
              aria-label={acts.t("auto.add")}
              title={acts.t("auto.add")}
              onClick={() => acts.add({ from: "arrow", arrow })}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={acts.t("auto.removeArrow")}
              title={acts.t("auto.removeArrow")}
              data-boni-action="automations.edit"
              onClick={() => acts.disconnect(arrow)}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES: NodeTypes = { step: StepCard };
const EDGE_TYPES: EdgeTypes = { arrow: ArrowLine };

/** The fields of each collection by key, as a condition sees them: what a citation of a step reading it is named by. */
function useCollectionFields(): (key: string) => readonly ConditionField[] | undefined {
  const types = useStore((s) => s.dataTypes);
  return useMemo(() => {
    const by = new Map((types ?? []).map((d) => [d.key, conditionFieldsOf(d)]));
    return (key: string) => by.get(key);
  }, [types]);
}

/** The names of the collections by key, as the app has them: what a step's automatic name and its summary say. */
export function useCollectionNames(): Record<string, string> {
  const types = useStore((s) => s.dataTypes);
  return useMemo(() => Object.fromEntries((types ?? []).map((d) => [d.key, d.name])), [types]);
}

export function AutomationCanvas({
  state,
  apply,
}: {
  state: EditorState;
  apply: (f: (s: EditorState) => EditorState) => void;
}) {
  return (
    <ReactFlowProvider>
      <Canvas state={state} apply={apply} />
    </ReactFlowProvider>
  );
}

function Canvas({
  state,
  apply,
}: {
  state: EditorState;
  apply: (f: (s: EditorState) => EditorState) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const tester = useTester();
  const phone = usePhone();
  const still = useStill();
  const look = useLook();
  /** How «Encajar» fits it; on the phone never so small that a card cannot be read: its middle, the rest a finger away. */
  const fit = phone ? { padding: 0.2, maxZoom: 1, minZoom: 0.5 } : { padding: 0.2, maxZoom: 1 };
  const collections = useCollectionNames();
  const names = useMemo(() => namer(t, collections), [t, collections]);
  const locale = localeOf(lang);
  const sayNames = { collection: (key: string) => collections[key] };
  // A collection by its name, as the server's `collectionNamed` reads one: a name two collections share names none.
  const named = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const [key, name] of Object.entries(collections)) m.set(name, m.has(name) ? null : key);
    return { collectionNamed: (name: string) => m.get(name) ?? undefined };
  }, [collections]);
  const nameOfCollection = (key: string) => collections[key] ?? key;
  const flow = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  /** Where the pointer was last on the canvas, in its units: where Ctrl+V pastes. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ step: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const empty = state.draft.steps.length === 0;

  const shown = useMemo(() => withPlaces(state.draft, state.places), [state.draft, state.places]);
  const fieldsOf = useCollectionFields();
  /** The names the cards' citations go by, made per draft and only for the steps they cite. */
  const cited = useMemo(() => namesOnDemand(t, state.draft, fieldsOf), [t, state.draft, fieldsOf]);
  /** Each card as last made, with what it was made from: the same step, place and marks give the same node. */
  const cards = useRef(new Map<string, { from: unknown[]; node: CardNode }>());
  const made = useMemo<CardNode[]>(() => {
    const used = new Set(state.draft.arrows.map((a) => `${a.from.step}:${a.from.output}`));
    const alone = state.selected.length === 1;
    const kept = new Map<string, { from: unknown[]; node: CardNode }>();
    const nodes = state.draft.steps.map((step) => {
      const at = shown[step.id] ?? { x: 0, y: 0 };
      const selected = state.selected.includes(step.id);
      const left = state.left
        .filter((x) => x.startsWith(`${step.id}.`))
        .map((x) => x.slice(step.id.length + 1));
      const free = outputsOf(step)
        .map((id) => (used.has(`${step.id}:${id}`) ? "" : id))
        .join(",");
      const problems = state.problems
        .filter((p) => p.step === step.id)
        .map((p) => p.code)
        .join(",");
      const testing =
        selected && alone ? (state.testing ? (state.testing.step ?? "") : null) : null;
      // A citation alone is said by its field's name, which a change before the step can change too (AU-21).
      const summary = summaryOf(
        step,
        summaryWords(t, collections, step, citedName(state.draft, step.id, cited)),
      ).join(" · ");
      const from = [
        summary,
        step,
        at.x,
        at.y,
        selected,
        selected && alone,
        renaming === step.id,
        left.join(","),
        free,
        t,
        collections,
        state.tests[step.id],
        problems,
        state.asked,
        testing,
        lang,
        state.pins[step.id],
      ];
      const was = cards.current.get(step.id);
      if (was && was.from.every((x, i) => x === from[i])) {
        kept.set(step.id, was);
        return was.node;
      }
      const node = cardOf(step, at, selected, selected && alone, left, used, testing, summary);
      kept.set(step.id, { from, node });
      return node;
    });
    cards.current = kept;
    return nodes;
  }, [
    state.draft,
    state.selected,
    state.left,
    state.tests,
    state.problems,
    state.asked,
    state.testing,
    state.pins,
    shown,
    t,
    lang,
    collections,
    cited,
    renaming,
  ]);
  /** What an output says it gave in the last test: «128 filas», dimmed at 0 or stale (AU-67, AU-92). */
  // A declaration, not a const: the cards' memo above calls it while the component renders.
  function countOf(step: string, output: string) {
    const c = outputCount(state, step, output);
    return c ? { words: rowsWords(t, lang, c.rows), dim: c.rows === 0 || c.stale } : null;
  }
  function cardOf(
    step: Step,
    at: { x: number; y: number },
    selected: boolean,
    alone: boolean,
    left: string[],
    used: Set<string>,
    testing: string | null,
    summary: string,
  ): CardNode {
    const ins = inputsOf(step);
    const outs = outputsOf(step);
    const ruleNames = new Map<string, string>();
    if (Array.isArray(step.params.rules))
      for (const r of step.params.rules as { id?: unknown; name?: unknown }[])
        if (typeof r?.id === "string")
          ruleNames.set(r.id, typeof r.name === "string" && r.name ? r.name : r.id);
    // What it can change goes first in the line of its labels (AU-180), from `stepChanges`, as «Publicar» reads it.
    const changes = changeMark(t, step, named, nameOfCollection);
    const words = [
      ...(changes ? [changes] : []),
      ...labelsOf(step).map((l) => labelWord(t, step, l)),
    ];
    const shownLabels: string[] = [];
    let room = LABEL_BUDGET;
    for (const w of words) {
      if (shownLabels.length && w.length > room) break;
      shownLabels.push(w);
      room -= w.length + 2;
    }
    const marked = markedOf(step, left, state.asked);
    const problems = state.problems.filter((p) => p.step === step.id);
    return {
      id: step.id,
      type: "step",
      position: at,
      selected,
      data: {
        step,
        summary,
        inputs: ins.map((id) => ({ id, label: ins.length > 1 ? t(KEY.input(id)) : null })),
        // The only output «main» needs no name (AU-63); a rule of «Elegir rama» is said by its own.
        outputs: outs.map((id) => ({
          id,
          label: outs.length === 1 && id === MAIN ? null : (ruleNames.get(id) ?? t(KEY.output(id))),
          free: !used.has(`${step.id}:${id}`),
          count: used.has(`${step.id}:${id}`) ? null : countOf(step.id, id),
        })),
        alone,
        renaming: renaming === step.id,
        labels: { shown: shownLabels, rest: words.slice(shownLabels.length), change: !!changes },
        missing: marked.length
          ? t("auto.view.missing", {
              names: marked.map((p) => t(KEY.param(step.type, p.key))).join(", "),
            })
          : null,
        problem: problems.length
          ? problems.map((p) => said(t, "problem", p, locale, sayNames)).join(" · ")
          : null,
        mark: stateMark(t, step, state.tests[step.id], locale, sayNames),
        test: {
          blocked: !tester || cannotTest(step, state.testing !== null) !== null,
          testing: testing === step.id,
        },
        chips: (step.connections ?? []).map((c) => ({
          collection: c.collection,
          name: nameOfCollection(c.collection),
          words: chipWords(t, c, locale),
        })),
        pinned: state.pins[step.id]
          ? [t("auto.pin.card"), ...(state.pins[step.id]?.stale ? [t("auto.pin.stale")] : [])].join(
              " · ",
            )
          : null,
      },
    };
  }
  // While a box is dragged React Flow moves it; the draft's places change only once it is dropped.
  const [nodes, setNodes] = useState<CardNode[]>(made);
  useEffect(() => {
    setNodes((was) => {
      const by = new Map(was.map((n) => [n.id, n]));
      return made.map((n) => {
        const old = by.get(n.id);
        if (!old) return n;
        // The same card where it was: the node React Flow has, so it is not drawn again.
        if (
          old.data === n.data &&
          old.selected === n.selected &&
          (old.dragging || (old.position.x === n.position.x && old.position.y === n.position.y))
        )
          return old;
        // A box being dragged stays under the pointer while what is selected changes.
        return {
          ...n,
          measured: old.measured,
          ...(old.dragging ? { position: old.position, dragging: true } : {}),
        };
      });
    });
  }, [made]);
  const edges = useMemo<ArrowEdge[]>(
    () =>
      state.draft.arrows.map((a) => ({
        id: arrowId(a),
        type: "arrow",
        source: a.from.step,
        sourceHandle: a.from.output,
        target: a.to.step,
        targetHandle: a.to.input,
        selected: !!state.arrow && sameArrow(state.arrow, a),
        data: { arrow: a, count: countOf(a.from.step, a.from.output) },
      })),
    [state.draft.arrows, state.arrow, state.tests, t, lang],
  );

  /** One change of the draft (an edit of edit.ts), with what is selected kept to the steps there still are. */
  const edit = (f: (d: EditorState["draft"]) => EditorState["draft"]) =>
    apply((s) => change(s, { draft: f(s.draft) }));
  const add = (at: AddAt) => {
    setMenu(null);
    apply((s) => ({ ...s, adding: at, open: null }));
  };
  const choose = (entry: PanelEntry) => {
    apply((s) => {
      const at = s.adding ?? { from: "top" };
      const made = addStep(s.draft, entry.type, entry.action, at, names, newStepId);
      return added(s, made, at);
    });
  };
  const removeThese = (steps: string[]) => {
    setMenu(null);
    apply((s) => ({
      ...change(s, { draft: removeSteps(s.draft, steps) }),
      selected: [],
      open: null,
    }));
  };
  const copyThese = (steps: string[]) => {
    if (!steps.length) return;
    clip = copySteps(state.draft, steps, shown);
  };
  /** Pastes `c` with its first box at `at` (AU-68): the pasted steps are selected. */
  const paste = (c: Clip, at: { x: number; y: number }) =>
    apply((s) => {
      const result = pasteSteps(s.draft, c, newStepId);
      const places = { ...withPlaces(s.draft, s.places) };
      const put = pastedPlaces(places, c.offsets, result.steps, at);
      return {
        ...change(s, { draft: result.draft, places: { ...places, ...put } }),
        selected: Object.values(result.steps),
        arrow: null,
      };
    });
  const duplicate = (step: string) => {
    setMenu(null);
    const from = shown[step];
    if (!from) return;
    paste(copySteps(state.draft, [step], shown), below(from));
  };
  const toggleOff = (step: string) => {
    setMenu(null);
    edit((d) => {
      const s = d.steps.find((x) => x.id === step);
      return setSetting(d, step, "off", s?.settings?.off !== true);
    });
  };
  const now: Acts = {
    t,
    add,
    toggleOff,
    remove: removeThese,
    startRename: (step) => {
      setMenu(null);
      setRenaming(step);
    },
    endRename: (step, name) => {
      setRenaming(null);
      if (name !== null) edit((d) => rename(d, step, name));
    },
    duplicate,
    copy: copyThese,
    disconnect: (arrow) =>
      apply((s) => ({ ...change(s, { draft: disconnect(s.draft, arrow) }), arrow: null })),
    testStep: (step) => {
      setMenu(null);
      tester?.run(step);
    },
  };
  const last = useRef(now);
  last.current = now;
  const acts = useMemo<Acts>(
    () => ({
      get t() {
        return last.current.t;
      },
      add: (at) => last.current.add(at),
      toggleOff: (step) => last.current.toggleOff(step),
      remove: (steps) => last.current.remove(steps),
      startRename: (step) => last.current.startRename(step),
      endRename: (step, name) => last.current.endRename(step, name),
      duplicate: (step) => last.current.duplicate(step),
      copy: (steps) => last.current.copy(steps),
      disconnect: (arrow) => last.current.disconnect(arrow),
      testStep: (step) => last.current.testStep(step),
    }),
    [],
  );

  const tidyUp = () => {
    apply((s) => change(s, { places: tidy(s.draft) }));
    requestAnimationFrame(() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }));
  };

  // The keys (AU-68), while the editor is open; a key typed in a field is the field's.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // On the phone nothing is changed (AU-74): a keyboard there only closes, with Esc.
    if (still && e.key !== "Escape") return;
    // In the step's view a change typed is one step of Deshacer (AU-68): Ctrl+Z there is the editor's, not the field's.
    const inView = !!(e.target as HTMLElement | null)?.closest?.(".auto-view");
    if (state.open && inView && mod && (k === "z" || k === "y")) {
      e.preventDefault();
      apply(k === "y" || e.shiftKey ? redo : undo);
      return;
    }
    if (typing(e) || renaming) return;
    // Open, the view is what the keys reach: Esc closes it, and nothing else acts on the canvas behind.
    if (state.open && !(mod && (k === "z" || k === "y")) && e.key !== "Escape") return;
    if (mod && k === "z") {
      e.preventDefault();
      apply(e.shiftKey ? redo : undo);
    } else if (mod && k === "y") {
      e.preventDefault();
      apply(redo);
    } else if (mod && (k === "c" || k === "x") && state.selected.length) {
      e.preventDefault();
      copyThese(state.selected);
      if (k === "x") removeThese(state.selected);
    } else if (mod && k === "v" && clip) {
      e.preventDefault();
      const box = wrap.current?.getBoundingClientRect();
      const at =
        pointer.current ??
        (box
          ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
          : { x: 0, y: 0 });
      paste(clip, at);
    } else if (e.key === "Delete" && !mod) {
      if (state.selected.length) removeThese(state.selected);
      else if (state.arrow) acts.disconnect(state.arrow);
    } else if (e.key === "Enter" && state.selected.length === 1) {
      apply((s) => ({ ...s, open: s.selected[0] ?? null }));
    } else if (e.key === "Escape") {
      // A menu open closes itself first; with nothing to close here, Esc is the app's (it leaves the editor).
      if (e.defaultPrevented || document.querySelector(".pop-box")) return;
      // Then the panel, then the step's view (its step stays selected), then what is selected.
      if (state.adding) apply((s) => ({ ...s, adding: null }));
      else if (state.open) apply((s) => ({ ...s, open: null }));
      else if (state.selected.length || state.arrow)
        apply((s) => ({ ...s, selected: [], arrow: null }));
      else return;
      e.preventDefault();
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);

  // A step added or pasted out of sight is brought into it, at the same zoom: Juan sees what he just added.
  const count = state.draft.steps.length;
  const counted = useRef(count);
  useEffect(() => {
    const grew = count > counted.current;
    counted.current = count;
    const id = state.selected.length === 1 ? state.selected[0] : undefined;
    if (!grew || !id) return;
    // The new box reaches the flow's store with the next paint.
    const frame = requestAnimationFrame(() => {
      const box = wrap.current?.getBoundingClientRect();
      const n = flow.getInternalNode(id);
      if (!n || !box) return;
      const { x, y, zoom } = flow.getViewport();
      const w = n.measured.width ?? 220;
      const h = n.measured.height ?? 64;
      const p = n.internals.positionAbsolute;
      const sx = p.x * zoom + x;
      const sy = p.y * zoom + y;
      if (sx >= 0 && sy >= 0 && sx + w * zoom <= box.width && sy + h * zoom <= box.height) return;
      void flow.setCenter(p.x + w / 2, p.y + h / 2, { zoom });
    });
    return () => cancelAnimationFrame(frame);
  }, [count]);

  // On the phone nothing is added (AU-74): no panel, not even the empty canvas's «¿Cómo empieza?».
  const panelOpen = !still && (empty || state.adding !== null);
  const menuStep = menu ? state.draft.steps.find((s) => s.id === menu.step) : undefined;
  return (
    <ActsContext.Provider value={acts}>
      <div className={`auto-board${panelOpen ? " adding" : ""}`}>
        <div
          className="auto-flow"
          ref={wrap}
          onPointerMove={(e) => {
            pointer.current = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          }}
          onPointerLeave={() => {
            pointer.current = null;
          }}
        >
          <ReactFlow<CardNode, ArrowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={(changes) =>
              setNodes((ns) => {
                // Only what React Flow measures and moves while dragging; selection is the editor's.
                const by = new Map(ns.map((n) => [n.id, n]));
                for (const c of changes) {
                  const n =
                    c.type === "position" || c.type === "dimensions" ? by.get(c.id) : undefined;
                  if (!n) continue;
                  if (c.type === "position" && c.position)
                    by.set(c.id, { ...n, position: c.position, dragging: c.dragging === true });
                  if (c.type === "dimensions" && c.dimensions)
                    by.set(c.id, { ...n, measured: c.dimensions });
                }
                return ns.map((n) => by.get(n.id) ?? n);
              })
            }
            // On the phone (AU-74) the canvas is moved and zoomed with the fingers, and a tap on a step opens it.
            nodesDraggable={!still}
            nodesConnectable={!still}
            onNodeDragStart={(_, n) => {
              if (!state.selected.includes(n.id))
                apply((s) => ({ ...s, selected: [n.id], arrow: null }));
            }}
            // Dropped: one change for every box that moved (AU-05), never one per pixel.
            onNodeDragStop={(_, __, moved) => {
              setNodes((ns) => ns.map((n) => (n.dragging ? { ...n, dragging: false } : n)));
              apply((s) => {
                const places = { ...withPlaces(s.draft, s.places) };
                for (const n of moved)
                  places[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
                return change(s, { places });
              });
            }}
            onNodeClick={(e, n) =>
              still
                ? apply((s) => ({ ...s, arrow: null, selected: [n.id], open: n.id }))
                : apply((s) => ({
                    ...s,
                    arrow: null,
                    selected:
                      e.shiftKey || e.ctrlKey || e.metaKey
                        ? s.selected.includes(n.id)
                          ? s.selected.filter((x) => x !== n.id)
                          : [...s.selected, n.id]
                        : [n.id],
                  }))
            }
            onNodeDoubleClick={(_, n) => apply((s) => ({ ...s, selected: [n.id], open: n.id }))}
            onEdgeClick={(_, e) => {
              const arrow = still ? undefined : e.data?.arrow;
              if (arrow) apply((s) => ({ ...s, selected: [], arrow }));
            }}
            onPaneClick={() => {
              setMenu(null);
              apply((s) => ({ ...s, selected: [], arrow: null }));
            }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              if (still) return;
              apply((s) => ({ ...s, selected: [n.id], arrow: null }));
              setMenu({ step: n.id, x: e.clientX, y: e.clientY });
            }}
            onPaneContextMenu={(e) => {
              e.preventDefault();
              if (still) return;
              const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              add({ from: "canvas", x: Math.round(p.x), y: Math.round(p.y) });
            }}
            onConnect={(c: Connection) => {
              if (!c.source || !c.target) return;
              const arrow: Arrow = {
                from: { step: c.source, output: c.sourceHandle ?? MAIN },
                to: { step: c.target, input: c.targetHandle ?? MAIN },
              };
              const next = connect(state.draft, arrow);
              if ("refused" in next) toast(t(`auto.refused.${next.refused}`));
              else if (next !== state.draft) apply((s) => change(s, { draft: next }));
            }}
            // Dragged from an output and let go on the canvas: the panel, to hang a step from it (AU-65).
            onConnectEnd={(e, c) => {
              if (c.isValid || !c.fromNode || c.fromHandle?.type !== "source") return;
              const p = "changedTouches" in e ? e.changedTouches[0] : e;
              if (!p) return;
              const over = document.elementFromPoint(p.clientX, p.clientY);
              if (over?.closest(".react-flow__node") || !over?.closest(".react-flow__pane")) return;
              add({ from: "output", step: c.fromNode.id, output: c.fromHandle.id ?? MAIN });
            }}
            isValidConnection={(c) => c.source !== c.target}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            elementsSelectable
            fitView
            fitViewOptions={fit}
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            minZoom={0.2}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
          </ReactFlow>
          <div className="auto-zoom">
            <button
              type="button"
              className="icon-btn"
              aria-label={t("auto.zoomIn")}
              title={t("auto.zoomIn")}
              onClick={() => void flow.zoomIn({ duration: 150 })}
            >
              <ZoomIn size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("auto.zoomOut")}
              title={t("auto.zoomOut")}
              onClick={() => void flow.zoomOut({ duration: 150 })}
            >
              <ZoomOut size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("auto.fit")}
              title={t("auto.fit")}
              onClick={() => void flow.fitView({ ...fit, duration: 200 })}
            >
              <Maximize size={16} strokeWidth={1.8} />
            </button>
            {!still && (
              <button
                type="button"
                className="icon-btn"
                aria-label={t(DO.tidy)}
                title={t(DO.tidy)}
                data-boni-action="automations.arrange"
                disabled={empty}
                onClick={tidyUp}
              >
                <LayoutGrid size={16} strokeWidth={1.8} />
              </button>
            )}
          </div>
          {!empty && !look && (
            <TestBar state={state} apply={apply} collectionName={nameOfCollection} />
          )}
          {!empty && !still && (
            <button
              type="button"
              className="icon-btn auto-add-top"
              aria-label={t("auto.add")}
              title={t("auto.add")}
              onClick={() => add({ from: "top" })}
            >
              <Plus size={18} strokeWidth={1.8} />
            </button>
          )}
        </div>
        {panelOpen && (
          <AddPanel
            t={t}
            empty={empty}
            first={state.id === null}
            onChoose={choose}
            onClose={() => apply((s) => ({ ...s, adding: null }))}
          />
        )}
        {state.open && (
          <AutomationStepView
            state={state}
            apply={apply}
            names={names}
            collectionNames={collections}
          />
        )}
      </div>
      {menu && menuStep && (
        <PointMenu x={menu.x} y={menu.y} label={t("auto.stepMenu")} onClose={() => setMenu(null)}>
          {(close) => (
            <>
              <MenuRow
                label={t(DO.open)}
                onClick={() => {
                  close();
                  apply((s) => ({ ...s, selected: [menuStep.id], open: menuStep.id }));
                }}
              />
              <MenuRow
                label={t(state.testing?.step === menuStep.id ? "auto.view.testing" : DO.testStep)}
                boniAction="automations.test"
                disabled={!tester || cannotTest(menuStep, state.testing !== null) !== null}
                onClick={() => {
                  close();
                  acts.testStep(menuStep.id);
                }}
              />
              <MenuRow
                label={t(menuStep.settings?.off ? DO.turnOn : DO.turnOff)}
                boniAction="automations.edit"
                onClick={() => {
                  close();
                  toggleOff(menuStep.id);
                }}
              />
              <MenuSep />
              <MenuRow
                label={t(DO.rename)}
                boniAction="automations.edit"
                onClick={() => {
                  close();
                  acts.startRename(menuStep.id);
                }}
              />
              <MenuRow
                label={t(DO.duplicate)}
                boniAction="automations.edit"
                onClick={() => {
                  close();
                  duplicate(menuStep.id);
                }}
              />
              <MenuRow
                label={t(DO.copy)}
                onClick={() => {
                  close();
                  copyThese([menuStep.id]);
                }}
              />
              <MenuSep />
              <MenuRow
                label={t(DO.remove)}
                danger
                boniAction="automations.edit"
                onClick={() => {
                  close();
                  removeThese([menuStep.id]);
                }}
              />
            </>
          )}
        </PointMenu>
      )}
    </ActsContext.Provider>
  );
}

/**
 * «Añadir un paso» (AU-69): its search on top; on an empty canvas «¿Cómo empieza?» and the triggers; then the
 * categories by what one wants to do, and «Añadir otro disparador» last. `first`: the step chosen makes the
 * automation (`automations.create`).
 */
function AddPanel({
  t,
  empty,
  first,
  onChoose,
  onClose,
}: {
  t: T;
  empty: boolean;
  first: boolean;
  onChoose: (entry: PanelEntry) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [triggers, setTriggers] = useState(false);
  const showing = empty ? "empty" : triggers ? "triggers" : "steps";
  const list = panelList(showing);
  const found = q.trim() ? searchPanel(q, showing, (e) => entryNames(t, e)) : null;
  const say = (e: PanelEntry) => t(e.action ? KEY.action(e.type, e.action) : KEY.step(e.type));
  const row = (e: PanelEntry) => {
    const Icon = iconOf(e.type);
    return (
      <li key={`${e.type}.${e.action ?? ""}`}>
        <button
          type="button"
          className="auto-start-row"
          data-boni-action={first ? "automations.create" : "automations.edit"}
          onClick={() => onChoose(e)}
        >
          <Icon size={16} strokeWidth={1.7} aria-hidden />
          {say(e)}
        </button>
      </li>
    );
  };
  return (
    <aside className={`auto-panel${empty ? " auto-start" : ""}`} aria-label={t("auto.add")}>
      <div className="auto-panel-head">
        <Search size={15} strokeWidth={1.8} aria-hidden />
        <input
          className="auto-panel-find"
          aria-label={t("auto.find")}
          placeholder={t("auto.find")}
          // biome-ignore lint/a11y/noAutofocus: the panel opens because Juan asked to add a step
          autoFocus={!empty}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              if (q) setQ("");
              else onClose();
            }
          }}
        />
        {!empty && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t("auto.close")}
            title={t("auto.close")}
            onClick={onClose}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {found ? (
        found.length ? (
          <ul className="auto-panel-list">{found.map(row)}</ul>
        ) : (
          <p className="auto-panel-none">{t("auto.nothingWith", { q: q.trim() })}</p>
        )
      ) : list.kind === "triggers" ? (
        <>
          {empty && <h2>{t("auto.start")}</h2>}
          <ul className="auto-panel-list">{list.entries.map(row)}</ul>
        </>
      ) : (
        <>
          {list.sections.map((s) => (
            <section key={s.category} className="auto-panel-section">
              <h3>{t(KEY.category(s.category))}</h3>
              <ul className="auto-panel-list">{s.entries.map(row)}</ul>
            </section>
          ))}
          <button type="button" className="auto-panel-more" onClick={() => setTriggers(true)}>
            {t("auto.addTrigger")}
          </button>
        </>
      )}
    </aside>
  );
}

/** For the tests of the page: every trigger the catalogue has. */
export const TRIGGER_TYPES = CATALOGUE.filter((s) =>
  isTrigger({ id: "", name: "", type: s.type, params: {} }),
).map((s) => s.type);
