import {
  blocksToMarkdown,
  CATALOGUE,
  kindOf as catalogueKind,
  markdownToBlocks,
  newBlock,
} from "@boni/views";
import { ChevronRight, FileText, GripVertical, Paperclip, Plus, Smile, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Page } from "../core/agent.ts";
import { catalogueOf, isDataBlock } from "../core/blocks.ts";
import { isCategoryKind, newSpec } from "../core/chartBuilder.ts";
import { emptyState } from "../core/charts.ts";
import {
  colsOf,
  moveTo,
  newRowId,
  segmentsOf,
  setHeight,
  setWidth,
  type Where,
} from "../core/grid.ts";
import { PALETTE } from "../core/palette.ts";
import {
  duplicated,
  indented,
  moved,
  pastedInto,
  rangeIds,
  replacedBy,
  withoutBlocks,
} from "../core/selection.ts";
import { catText } from "../i18n.ts";
import {
  addFilesToPage,
  blockId,
  clearBlockSel,
  fileInline,
  fileOfRow,
  loadDataTypes,
  newChartForPage,
  newPage,
  newSubpageBlock,
  openBlockPanel,
  openEditor,
  openFile,
  openPage,
  openRowsPanel,
  openScreen,
  runShortcut,
  selectBlocks,
  setPageBlocks,
  setPageFocus,
  setPageIcon,
  setPageTitle,
  showChat,
  toast,
  undoPage,
  useStore,
  useVisibleCharts,
} from "../store.ts";
import { kindName } from "./BlockPanel.tsx";
import { LinkBlock } from "./BoniBlocks.tsx";
import { ACCENT } from "./Chart.tsx";
import { ChartCard, ChartCardContent } from "./ChartCard.tsx";
import { DataBlockView, useBlockResults } from "./DataBlockView.tsx";
import { DatabaseBlock } from "./DatabaseBlock.tsx";
import { historyColor, whoLabel } from "./History.tsx";
import { MenuRow, MenuSep, PointMenu, PopButton } from "./Popover.tsx";
import { TemplatePill } from "./TemplatePill.tsx";

type Block = Page["spec"]["blocks"][number];
type TextBlock = Extract<Block, { text: string }>;
type TextKind =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "todo"
  | "toggle"
  | "quote"
  | "callout"
  | "code";

const TEXT_TYPES = new Set([
  "text",
  "heading",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "quote",
  "callout",
  "code",
]);
const isText = (b: Block): b is TextBlock => TEXT_TYPES.has(b.type);
const kindOf = (b: TextBlock): TextKind =>
  b.type === "heading" ? (`h${b.level ?? 1}` as TextKind) : (b.type as TextKind);
const indentOf = (b: Block | undefined): number => (b && "indent" in b && b.indent) || 0;
const withIndent = (n: number) => (n > 0 ? { indent: Math.min(n, 4) as 1 | 2 | 3 | 4 } : {});
/** The same block (id, text and indent kept) as another kind of text. */
function asKind(b: TextBlock, kind: TextKind, text = b.text): TextBlock {
  // Its indent and its place on the grid stay.
  const ind = { ...withIndent(indentOf(b)), ...(b.at ? { at: b.at } : {}) };
  if (kind === "h1" || kind === "h2" || kind === "h3")
    return { id: b.id, type: "heading", text, level: Number(kind[1]) as 1 | 2 | 3, ...ind };
  if (kind === "toggle") return { id: b.id, type: "toggle", text, open: true, ...ind };
  if (kind === "callout")
    return {
      id: b.id,
      type: "callout",
      text,
      icon: b.type === "callout" && b.icon ? b.icon : "💡",
      ...ind,
    };
  return { id: b.id, type: kind, text, ...ind } as TextBlock;
}
const emptyText = (indent = 0): TextBlock => ({
  id: blockId(),
  type: "text",
  text: "",
  ...withIndent(indent),
});
/** A block with the ones nested under it (moved, duplicated and deleted together, as in Notion). */
function withChildren(blocks: Block[], i: number): Block[] {
  const base = indentOf(blocks[i]);
  let j = i + 1;
  while (j < blocks.length && indentOf(blocks[j]) > base) j++;
  return blocks.slice(i, j);
}

/**
 * A page of the user's, as a Notion page (docs/extensiones.md 6): always editable in place, no edit mode.
 * Its name is the big title; its blocks come from a closed catalogue and are painted by this code. Text is
 * typed straight into its block (Enter makes the next one, "/" opens the block menu, "# ", "- ", "[] "
 * turn it into a heading, a list or a to-do; Backspace at the start joins it to the one above); on hover
 * every block shows "+" (a block below) and its handle (its menu; drag to move it).
 */
/**
 * The block editor alone, on any document: a row's text as a page with the page's own editor (Juan, 2026-10-22/26:
 * notes are pages, one kind): its typing, "/" menu, handles, drag, undo, data blocks. What Markdown cannot say
 * travels in the note's text as a fenced block marked «boni» (packages/views/src/markdown.ts).
 */
export function DocEditor({ doc }: { doc: Page }) {
  return (
    <div
      className="doc-editor"
      onKeyDownCapture={(e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const k = e.key.toLowerCase();
        if ((k === "z" || k === "y") && undoPage(k === "y" || e.shiftKey)) e.preventDefault();
      }}
    >
      <Blocks page={doc} />
      <DocTail page={doc} />
    </div>
  );
}

export function PageView({ after }: { after?: ReactNode }) {
  const t = useStore((s) => s.t);
  const page = useStore((s) => s.page);
  if (!page)
    return (
      <div className="content">
        <div
          className="page-loading"
          role="status"
          aria-busy="true"
          aria-label={t("chart.loading")}
        />
      </div>
    );
  return (
    <div className={`content page-doc${page.spec.full ? " full" : ""}`}>
      <div
        className="doc"
        onKeyDownCapture={(e) => {
          // Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) undo and redo the page's changes, as in Notion.
          if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
          const k = e.key.toLowerCase();
          if ((k === "z" || k === "y") && undoPage(k === "y" || e.shiftKey)) e.preventDefault();
        }}
      >
        <PageIcon page={page} />
        <PageTitle page={page} />
        {page.spec.template && <TemplatePill page={page} name={page.spec.template} />}
        <Blocks page={page} />
        <DocTail page={page} />
        <NewChartPreview />
        {after}
      </div>
    </div>
  );
}

/** Emojis to choose a page's icon from (one tap, as Notion's picker; no images). */
const EMOJIS = [
  "📄",
  "📝",
  "📚",
  "📖",
  "🗂️",
  "📁",
  "📌",
  "📎",
  "✅",
  "☑️",
  "📅",
  "🗓️",
  "⏰",
  "💡",
  "⭐",
  "🔥",
  "🎯",
  "🚀",
  "💼",
  "🏫",
  "🎓",
  "🧪",
  "🔬",
  "💻",
  "🖥️",
  "📱",
  "⚙️",
  "🔧",
  "🏠",
  "🛒",
  "💰",
  "💶",
  "📈",
  "📊",
  "🍽️",
  "☕",
  "🍎",
  "🏃",
  "🧘",
  "❤️",
  "🩺",
  "✈️",
  "🚗",
  "🎵",
  "🎬",
  "📷",
  "🌱",
  "🐾",
];

/** A grid of emojis to choose one from. */
function EmojiGrid({ onPick }: { onPick: (e: string) => void }) {
  const t = useStore((s) => s.t);
  return (
    <div className="emoji-grid" role="group" aria-label={t("page.icon")}>
      {EMOJIS.map((e) => (
        <button key={e} type="button" className="emoji" aria-label={e} onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}

/** Over the name: the page's icon (a click changes it), or "Add icon" on hover, as in Notion. */
function PageIcon({ page }: { page: Page }) {
  const t = useStore((s) => s.t);
  const picker = (close: () => void) => (
    <div className="pop-section">
      <EmojiGrid
        onPick={(e) => {
          close();
          setPageIcon(e);
        }}
      />
      {page.icon && (
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            close();
            setPageIcon("");
          }}
        >
          {t("page.iconRemove")}
        </button>
      )}
    </div>
  );
  return (
    <div className={`doc-head${page.icon ? " has-icon" : ""}`}>
      {page.icon ? (
        <PopButton
          className="doc-icon"
          title={t("page.iconChange")}
          align="start"
          width={330}
          label={page.icon}
        >
          {picker}
        </PopButton>
      ) : (
        <PopButton
          className="doc-add-icon"
          title={t("page.iconAdd")}
          align="start"
          width={330}
          label={
            <>
              <Smile size={15} strokeWidth={1.8} />
              {t("page.iconAdd")}
            </>
          }
        >
          {picker}
        </PopButton>
      )}
    </div>
  );
}

/** The page's name, as its first line (Enter goes to the first block). */
function PageTitle({ page }: { page: Page }) {
  const t = useStore((s) => s.t);
  const focus = useStore((s) => s.pageFocus);
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutosize(ref, page.title);
  useEffect(() => {
    if (focus && "title" in focus) {
      ref.current?.focus();
      setPageFocus(null);
    }
  }, [focus]);
  return (
    <textarea
      ref={ref}
      className="doc-title"
      rows={1}
      value={page.title}
      placeholder={t("page.untitled")}
      aria-label={t("page.name")}
      maxLength={120}
      onChange={(e) => setPageTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        const first = page.spec.blocks[0];
        if (first && isText(first)) setPageFocus({ block: first.id, at: "start" });
        else {
          const b = emptyText();
          setPageBlocks([b, ...page.spec.blocks]);
          setPageFocus({ block: b.id, at: "start" });
        }
      }}
    />
  );
}

/** Below the last block: a click writes at the end (a new line unless the last one is empty). */
export function DocTail({ page }: { page: Page }) {
  const t = useStore((s) => s.t);
  const blocks = page.spec.blocks;
  const last = blocks[blocks.length - 1];
  const write = () => {
    if (last && isText(last) && !last.text) setPageFocus({ block: last.id, at: "end" });
    else {
      const b = emptyText();
      setPageBlocks([...blocks, b]);
      setPageFocus({ block: b.id, at: "start" });
    }
  };
  return (
    <button type="button" className="doc-tail" onClick={write} aria-label={t("block.writeHere")}>
      {blocks.length === 0 && <span className="doc-hint">{t("block.placeholderFirst")}</span>}
    </button>
  );
}

/** Where a dragged block would land: above or below another, or beside it (a column of its own). */
type Drag = { id: string; over: string | null; where: Where } | null;

/** What the page shows of its blocks: those under a closed toggle are folded away; numbered lists count. */
function layoutOf(blocks: Block[]) {
  const hidden = new Set<string>();
  const numbers = new Map<string, number>();
  const counters: number[] = [];
  let fold: number | null = null;
  for (const b of blocks) {
    const ind = indentOf(b);
    if (fold !== null) {
      if (ind > fold) {
        hidden.add(b.id);
        continue;
      }
      fold = null;
    }
    if (b.type === "toggle" && !b.open) fold = ind;
    if (b.type === "numbered") {
      counters.length = ind + 1;
      counters[ind] = (counters[ind] ?? 0) + 1;
      numbers.set(b.id, counters[ind]);
    } else counters.length = Math.min(counters.length, ind);
  }
  return { hidden, numbers };
}

/**
 * The blocks: on their own, the whole width, as a Notion page's text (consecutive charts share a grid, buttons a
 * row), or in rows of columns on the page's grid of 12 (packages/views `Place`), one under another in each column.
 */
export function Blocks({ page }: { page: Page }) {
  const specs = useVisibleCharts();
  // While a chart is being edited its height follows the draft.
  const panel = useStore((s) => s.panel);
  const [drag, setDrag] = useState<Drag>(null);
  const blocks = page.spec.blocks;
  const { hidden, numbers } = useMemo(() => layoutOf(blocks), [blocks]);
  const visible = blocks.filter((b) => !hidden.has(b.id));
  const dataBlocks = useMemo(() => blocks.filter(isDataBlock), [blocks]);
  const { results, failure } = useBlockResults(dataBlocks);
  // Whole blocks selected (Notion's, Juan 2026-10-30): drawn here, made by a drag across blocks, Shift+click, Esc,
  // Shift+arrows at a block's edge or Ctrl+A twice; the keys then act on them (core/selection.ts).
  const sel = useStore((s) => s.blockSel);
  const selected = useMemo(
    () => new Set(sel ? rangeIds(blocks, sel.anchor, sel.focus) : []),
    [sel, blocks],
  );
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearBlockSel(), [page.id]);
  useEffect(() => {
    if (!sel) return;
    box.current?.focus({ preventScroll: true });
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) clearBlockSel();
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [sel]);
  const order = visible.map((b) => b.id);
  const step = (from: string, dir: -1 | 1) =>
    order[Math.max(0, Math.min(order.length - 1, order.indexOf(from) + dir))] ?? from;
  const removeSelected = (chosen: string[]) => {
    const first = blocks.findIndex((b) => chosen.includes(b.id));
    const out = withoutBlocks(blocks, chosen, blockId);
    clearBlockSel();
    setPageBlocks(out);
    const before = out[Math.max(0, first - 1)];
    if (before && isText(before)) setPageFocus({ block: before.id, at: "end" });
  };
  const onSelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const s = useStore.getState().blockSel;
    if (!s || e.target !== box.current || e.nativeEvent.isComposing) return;
    const chosen = rangeIds(blocks, s.anchor, s.focus);
    if (!chosen.length) return clearBlockSel();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const first = chosen[0] as string;
    const last = chosen[chosen.length - 1] as string;
    if (k === "Escape") clearBlockSel();
    else if (k === "Backspace" || k === "Delete") removeSelected(chosen);
    else if (mod && (k === "c" || k === "x")) {
      copyText(blocksToMarkdown(blocks.filter((b) => chosen.includes(b.id))));
      if (k === "x") removeSelected(chosen);
    } else if (mod && k === "d") {
      const d = duplicated(blocks, chosen, blockId);
      setPageBlocks(d.blocks);
      if (d.ids.length) selectBlocks(d.ids[0] as string, d.ids[d.ids.length - 1] as string);
    } else if (mod && k === "a") {
      if (order.length) selectBlocks(order[0] as string, order[order.length - 1] as string);
    } else if (k === "Tab") setPageBlocks(indented(blocks, chosen, e.shiftKey ? -1 : 1));
    else if (mod && e.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) {
      const m = moved(blocks, chosen, k === "ArrowUp" ? -1 : 1);
      if (m) setPageBlocks(m);
    } else if (k === "ArrowUp" || k === "ArrowDown") {
      const dir = k === "ArrowUp" ? -1 : 1;
      if (e.shiftKey) selectBlocks(s.anchor, step(s.focus, dir));
      else {
        const to = step(dir < 0 ? first : last, dir);
        selectBlocks(to, to);
      }
    } else if (k === "Enter") {
      const edit = blocks.find((b) => chosen.includes(b.id) && isText(b));
      clearBlockSel();
      if (edit) setPageFocus({ block: edit.id, at: "end" });
    } else if (k.length === 1 && !mod && !e.altKey) {
      // Typing over selected blocks puts what is typed in their place.
      const at = blocks.findIndex((b) => b.id === first);
      const out = replacedBy(blocks, chosen, [{ ...emptyText(), text: e.key }], blockId);
      clearBlockSel();
      setPageBlocks(out);
      const made = out[at];
      if (made) setPageFocus({ block: made.id, at: "end" });
    } else return;
    e.preventDefault();
  };
  const onBoxMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    const id = el.closest<HTMLElement>(".blk[data-block]")?.dataset.block;
    if (!id || el.closest(".blk-gutter, .blk-resize")) return;
    const s = useStore.getState().blockSel;
    const editingIn = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
      ".blk[data-block]",
    )?.dataset.block;
    if (e.shiftKey && (s?.anchor ?? editingIn)) {
      e.preventDefault();
      e.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur();
      selectBlocks((s?.anchor ?? editingIn) as string, id);
      return;
    }
    if (s) clearBlockSel();
    // Leaving the block while the button is down: whole blocks from it to the one under the pointer.
    const move = (ev: MouseEvent) => {
      const over = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>(".blk[data-block]")?.dataset.block;
      const now = useStore.getState().blockSel;
      if (!over || !box.current?.querySelector(`[data-block="${over}"]`)) return;
      if (!now && over === id) return;
      if (!now) (document.activeElement as HTMLElement | null)?.blur();
      window.getSelection()?.removeAllRanges();
      if (now?.focus !== over) selectBlocks(id, over);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const onBoxPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const s = useStore.getState().blockSel;
    if (!s || e.target !== box.current) return;
    const chosen = rangeIds(blocks, s.anchor, s.focus);
    const files = [...e.clipboardData.files];
    e.preventDefault();
    if (files.length) {
      void addFilesToPage(files, chosen[chosen.length - 1] ?? null);
      return;
    }
    const incoming = markdownToBlocks(e.clipboardData.getData("text/plain"));
    if (!incoming.length) return;
    clearBlockSel();
    setPageBlocks(replacedBy(blocks, chosen, incoming, blockId));
  };
  const onBoxDrop = (e: React.DragEvent<HTMLDivElement>) => {
    // Files from outside (a picture from the desktop), never a block being moved.
    if (drag || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const over = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>(".blk[data-block]")?.dataset.block;
    void addFilesToPage([...e.dataTransfer.files], over ?? blocks[blocks.length - 1]?.id ?? null);
  };
  const drop = () => {
    const from = blocks.findIndex((b) => b.id === drag?.id);
    if (!drag?.over || drag.over === drag.id || from < 0) return setDrag(null);
    const target = blocks.find((b) => b.id === drag.over);
    const moving = blocks[from] as Block;
    // On the grid (beside a block, or into a row's column): only the block itself moves.
    if (drag.where === "left" || drag.where === "right" || target?.at || moving.at) {
      setPageBlocks(moveTo(blocks, drag.id, drag.over, drag.where));
      return setDrag(null);
    }
    // In the page's flow the block goes with the ones nested under it.
    const group = withChildren(blocks, from);
    if (group.some((b) => b.id === drag.over)) return setDrag(null);
    const rest = blocks.filter((b) => !group.includes(b));
    const i = rest.findIndex((b) => b.id === drag.over);
    const at = drag.where === "below" ? i + withChildren(rest, i).length : i;
    rest.splice(at, 0, ...group);
    setPageBlocks(rest);
    setDrag(null);
  };
  const row = (b: Block) => (
    <BlockRow
      key={b.id}
      block={b}
      page={page}
      selected={selected.has(b.id)}
      drag={drag}
      onDragStart={() => setDrag({ id: b.id, over: null, where: "below" })}
      onDragOver={(where) =>
        drag &&
        (drag.over !== b.id || drag.where !== where) &&
        setDrag({ ...drag, over: b.id, where })
      }
      onDrop={drop}
      onDragEnd={() => setDrag(null)}
    >
      {isDataBlock(b) ? (
        <DataBlockView block={b} result={results[b.id]} failure={failure} />
      ) : b.type === "link" ? (
        <LinkBlock block={b} />
      ) : b.type === "chart" ? (
        specs.some((s) => s.id === b.chart) ? (
          <ChartCard chartId={b.chart} />
        ) : (
          <ChartGone />
        )
      ) : b.type === "action" ? (
        <ActionButton block={b} />
      ) : b.type === "divider" ? (
        <hr className="doc-divider" />
      ) : b.type === "page" ? (
        <PageLink id={b.page} />
      ) : b.type === "file" ? (
        <FileBlock block={b} />
      ) : b.type === "database" ? (
        <DatabaseBlock
          source={b.source}
          view={b.view}
          onView={(view) =>
            setPageBlocks(page.spec.blocks.map((x) => (x.id === b.id ? { ...b, view } : x)))
          }
        />
      ) : isText(b) ? (
        <TextField block={b} page={page} number={numbers.get(b.id)} hidden={hidden} />
      ) : null}
    </BlockRow>
  );
  const chart = (b: Block) => {
    const spec = b.type === "chart" ? specs.find((s) => s.id === b.chart) : null;
    const wide = spec && isCategoryKind(spec.kind) && spec.kind !== "donut";
    const draft = panel?.kind === "edit" && panel.spec.id === spec?.id ? panel.spec : spec;
    const tall = draft?.style.height ?? "m";
    return (
      <div key={b.id} className={`doc-chart h-${tall}${wide && !b.at ? " wide" : ""}`}>
        {row(b)}
      </div>
    );
  };
  /** Blocks one after another: consecutive saved charts share a grid, consecutive buttons a row («lo justo»). */
  const flow = (list: Block[]) => {
    const groups: Block[][] = [];
    for (const b of list) {
      const last = groups[groups.length - 1];
      const joins = (b.type === "chart" || b.type === "action") && last?.[0]?.type === b.type;
      if (last && joins) last.push(b);
      else groups.push([b]);
    }
    return groups.map((g) => {
      const first = g[0] as Block;
      if (first.type === "chart")
        return (
          <div key={first.id} className="doc-charts">
            {g.map(chart)}
          </div>
        );
      if (first.type === "action")
        return (
          <div key={first.id} className="doc-actions">
            {g.map(row)}
          </div>
        );
      return row(first);
    });
  };
  const segments = segmentsOf(visible);
  const out: ReactNode[] = [];
  let run: Block[] = [];
  const flush = () => {
    if (run.length) out.push(...flow(run));
    run = [];
  };
  for (const seg of segments) {
    if (seg.kind === "flow") {
      run.push(seg.block);
      continue;
    }
    flush();
    out.push(
      <div key={`row-${seg.row}`} className="grid-row" data-row={seg.row}>
        {seg.cols.map((c) => (
          <div key={c.col} className="grid-col" style={{ ["--span" as string]: c.w }}>
            {flow(c.blocks)}
          </div>
        ))}
      </div>,
    );
  }
  flush();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the page's blocks take the keys of a block selection
    <div
      ref={box}
      className={`doc-blocks${sel ? " selecting" : ""}`}
      tabIndex={-1}
      onKeyDown={onSelKey}
      onMouseDown={onBoxMouseDown}
      onPaste={onBoxPaste}
      onDragOver={(e) => {
        if (!drag && e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={onBoxDrop}
    >
      {out}
      <FileChoice />
    </div>
  );
}

/** Copies text as the user's own copy would (Ctrl+C), from code: the page's selected blocks as Markdown. */
function copyText(text: string) {
  const put = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
  };
  document.addEventListener("copy", put);
  const done = document.execCommand("copy");
  document.removeEventListener("copy", put);
  if (!done) void navigator.clipboard?.writeText(text).catch(() => {});
}

/** Where pasted or dropped files go, asked once when the account has several collections of files. */
function FileChoice() {
  const t = useStore((s) => s.t);
  const choice = useStore((s) => s.fileChoice);
  useEffect(() => {
    if (!choice) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      choice.answer(null);
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [choice]);
  if (!choice) return null;
  return (
    <div
      className="find-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) choice.answer(null);
      }}
    >
      <div className="find-box unlock-box file-choice" role="dialog" aria-label={t("file.choose")}>
        <div className="find-head">
          <h2>{t("file.choose")}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={() => choice.answer(null)}
            title={t("protect.cancel")}
            aria-label={t("protect.cancel")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <p className="find-help">{t("file.chooseHelp")}</p>
        <div className="file-choice-list">
          {choice.options.map((o) => (
            <button
              key={o.type}
              type="button"
              className="btn"
              onClick={() => choice.answer(o.type)}
            >
              {o.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A link to a subpage: its icon and name; a click opens it. */
function PageLink({ id }: { id: string }) {
  const t = useStore((s) => s.t);
  const target = useStore((s) => s.pages?.find((p) => p.id === id));
  if (!target) return <p className="doc-gone">{t("block.pageGone")}</p>;
  return (
    <button type="button" className="doc-page-link" onClick={() => void openPage(id)}>
      <span className="doc-page-icon">
        {target.icon || <FileText size={18} strokeWidth={1.7} />}
      </span>
      <span className={`doc-page-name${target.title ? "" : " untitled"}`}>
        {target.title || t("page.untitled")}
      </span>
    </button>
  );
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/**
 * A file of the user's in the text (Juan, 2026-10-29): an image in place, at the width it had, its name (its record's
 * title in the files' collection) only under the pointer (Juan, 2026-10-30); anything else a card with its name that
 * opens it. Where the host cannot show bytes, an image is a card too.
 */
function FileBlock({ block }: { block: Extract<Block, { type: "file" }> }) {
  const t = useStore((s) => s.t);
  const [file, setFile] = useState<
    { sha: string; name: string; url: string | null } | "gone" | null
  >(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const f = await fileOfRow(block.file);
      if (!f) return live && setFile("gone");
      const name = f.name || block.name;
      const url = IMAGE.test(name) ? await fileInline(f.sha) : null;
      if (live) setFile({ ...f, name, url });
    })();
    return () => {
      live = false;
    };
  }, [block.file, block.name]);
  if (file === "gone") return <p className="doc-gone">{t("file.missing")}</p>;
  const name = file?.name || block.name;
  if (file?.url)
    return (
      <figure className="doc-file-image">
        <img src={file.url} alt={name} style={block.width ? { width: block.width } : undefined} />
        <figcaption>{name}</figcaption>
      </figure>
    );
  return (
    <button
      type="button"
      className="doc-file"
      disabled={!file}
      onClick={() => file && void openFile(file.sha, name)}
    >
      <Paperclip size={15} strokeWidth={1.8} aria-hidden="true" />
      <span className="doc-file-name">{name}</span>
      <span className="muted">{t("file.open")}</span>
    </button>
  );
}

function ChartGone() {
  const t = useStore((s) => s.t);
  return <p className="doc-gone">{t("block.chartGone")}</p>;
}

/** Clicks on these are the block's own (using it: a button, a bar, a field), not a request for its menu. */
const OWN = "button, a, input, select, textarea, label, [role='button'], .chart-card svg";
/**
 * A click uses a block (design audit, Juan 2026-10-25): a number or a chart of a collection lists the rows it counts;
 * text is clicked to write in it. Every block's menu comes from its handle and the right click, the same in all.
 */
const CLICK_ROWS = new Set(["number", "bars", "graph"]);
const ALLOWED_WIDTHS = [2, 3, 4, 6, 8, 9, 12];

/**
 * A block with its hover controls: "+" adds a block after it (the catalogue, no "/" to type), the handle opens its
 * menu and drags it (above, below or beside another block). Numbers and charts also open their menu with a click,
 * and change size by dragging their corner.
 */
function BlockRow({
  block,
  page,
  selected,
  drag,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  children,
}: {
  block: Block;
  page: Page;
  selected: boolean;
  drag: Drag;
  onDragStart: () => void;
  onDragOver: (where: Where) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  const t = useStore((s) => s.t);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const self = useRef<HTMLDivElement>(null);
  const blocks = page.spec.blocks;
  // With History open, the block in the colour of who wrote it last (Juan, 2026-10-30).
  const mark = useStore((s) => s.historyMarks?.blocks[block.id]);
  const focus = useStore((s) => s.historyMarks?.focus ?? null);
  const locale = useStore((s) => (s.settings.language === "en" ? "en-GB" : "es-ES"));
  const lit = mark && (!focus || focus === mark.by) ? mark : null;
  const kind = isText(block) ? kindOf(block) : block.type;
  const name = isText(block)
    ? t(`block.kind.${kind}`)
    : kindName(t, catalogueKind(block.type), block.type);
  const target = drag && drag.over === block.id && drag.id !== block.id ? drag.where : null;
  const clickRows = CLICK_ROWS.has(block.type);
  const openAt = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPoint({ x: e.clientX, y: e.clientY });
  };
  // Dragging the corner: the width snaps to the allowed columns of the row, a chart's height to low, medium, high.
  const resize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = self.current?.closest(".grid-row, .doc-blocks")?.getBoundingClientRect();
    const r = self.current?.getBoundingClientRect();
    if (!grid || !r) return;
    const col = grid.width / 12;
    let last = useStore.getState().page?.spec.blocks ?? blocks;
    const onMove = (ev: PointerEvent) => {
      const want = (ev.clientX - r.left + 8) / col;
      const w = ALLOWED_WIDTHS.reduce(
        (a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a),
        12,
      );
      let next = last;
      const cur = next.find((b) => b.id === block.id);
      if ((cur?.at?.w ?? 12) !== w) next = setWidth(next, block.id, w);
      if (block.type === "graph") {
        const hpx = ev.clientY - r.top;
        const h = hpx < 290 ? "s" : hpx < 390 ? "m" : "l";
        if ((next.find((b) => b.id === block.id)?.at?.h ?? "m") !== h)
          next = setHeight(next, block.id, h);
      }
      if (next !== last) {
        last = next;
        setPageBlocks(next);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <div
      ref={self}
      className={`blk blk-${kind}${selected ? " selected" : ""}${menu || adding || point ? " menu-open" : ""}${
        drag?.id === block.id ? " dragging" : ""
      }${target ? ` drop-${target}` : ""}${isDataBlock(block) && block.bg ? " blk-bg" : ""}${
        clickRows ? " blk-clickable" : ""
      }${lit ? " by-who" : ""}`}
      data-block={block.id}
      style={
        {
          ...(indentOf(block) ? { marginLeft: indentOf(block) * 26 } : {}),
          ...(lit ? { "--who": historyColor(lit.by) } : {}),
        } as React.CSSProperties
      }
      onClick={(e) => {
        if (!clickRows) return;
        const el = e.target as HTMLElement;
        if (el.closest(".blk-gutter") || el.closest(".blk-resize") || el.closest(OWN)) return;
        openRowsPanel(block.id);
      }}
      onContextMenu={(e) => {
        if (isText(block)) return;
        openAt(e);
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;
        // The sides make a column beside it; above or below it, the same column. Buttons sit in a row.
        if (block.type === "action" && !block.at) onDragOver(fx > 0.5 ? "below" : "above");
        else if (fx < 0.15) onDragOver("left");
        else if (fx > 0.85) onDragOver("right");
        else onDragOver(e.clientY > r.top + r.height / 2 ? "below" : "above");
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {lit && <span className="blk-who">{whoLabel(t, lit, locale)}</span>}
      <div className="blk-gutter">
        <PopButton
          className="blk-btn"
          title={t("block.add")}
          align="start"
          width={300}
          onOpenChange={setAdding}
          label={<Plus size={16} strokeWidth={1.8} />}
        >
          {(close) => (
            <AddMenu
              onPick={(choice) => {
                close();
                addAfter(choice, block, blocks);
              }}
            />
          )}
        </PopButton>
        <span
          className="blk-handle"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", block.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          <PopButton
            className="blk-btn"
            title={`${t("block.menu")}: ${name}`}
            align="start"
            width={230}
            onOpenChange={setMenu}
            label={<GripVertical size={16} strokeWidth={1.8} />}
          >
            {(close) => <BlockMenu block={block} page={page} close={close} />}
          </PopButton>
        </span>
      </div>
      {children}
      {(isDataBlock(block) || block.type === "chart") && (
        <span
          className={`blk-resize${block.type === "graph" ? " corner" : ""}`}
          title={t("block.resize")}
          onPointerDown={resize}
        />
      )}
      {point && (
        <PointMenu
          x={point.x}
          y={point.y}
          label={`${t("block.menu")}: ${name}`}
          onClose={() => setPoint(null)}
        >
          {(close) => <BlockMenu block={block} page={page} close={close} />}
        </PointMenu>
      )}
    </div>
  );
}

const TURN_INTO: TextKind[] = [
  "text",
  "h1",
  "h2",
  "h3",
  "bullet",
  "numbered",
  "todo",
  "toggle",
  "quote",
  "callout",
  "code",
];

/** The handle's menu: turn into (text blocks), the button's text, duplicate, move, delete. */
function BlockMenu({ block, page, close }: { block: Block; page: Page; close: () => void }) {
  const t = useStore((s) => s.t);
  const spec = useStore((s) =>
    block.type === "chart" ? s.chartSpecs.find((c) => c.id === block.chart) : null,
  );
  const blocks = page.spec.blocks;
  const i = blocks.findIndex((b) => b.id === block.id);
  const put = (next: Block[]) => {
    close();
    setPageBlocks(next);
  };
  const move = (by: -1 | 1) => {
    const next = [...blocks];
    next.splice(i, 1);
    next.splice(i + by, 0, block);
    put(next);
  };
  const remove = () => {
    put(blocks.filter((b) => b.id !== block.id));
    toast(t("block.deleted"), { label: t("toast.undo"), run: () => setPageBlocks(blocks) });
  };
  return (
    <div className="menu-list" role="menu">
      {isText(block) && (
        <>
          <div className="menu-head">{t("block.turnInto")}</div>
          {TURN_INTO.map((k) => (
            <MenuRow
              key={k}
              label={t(`block.kind.${k}`)}
              on={kindOf(block) === k}
              onClick={() => {
                put(blocks.map((b) => (b.id === block.id ? asKind(block, k) : b)));
                setPageFocus({ block: block.id, at: "end" });
              }}
            />
          ))}
          <MenuSep />
        </>
      )}
      {block.type === "action" && (
        <>
          <ButtonLabel block={block} blocks={blocks} />
          <MenuSep />
        </>
      )}
      {(catalogueKind(block.type) || block.at) && !isText(block) && (
        <MenuRow
          label={t("block.modify")}
          onClick={() => {
            close();
            openBlockPanel(block.id);
          }}
        />
      )}
      {block.type === "chart" && spec && (
        <MenuRow
          label={t("controls.edit")}
          onClick={() => {
            close();
            openEditor(spec);
          }}
        />
      )}
      <MenuRow
        label={t("block.duplicate")}
        onClick={() => {
          const next = [...blocks];
          next.splice(i + 1, 0, { ...block, id: blockId() });
          put(next);
        }}
      />
      {i > 0 && <MenuRow label={t("block.up")} onClick={() => move(-1)} />}
      {i < blocks.length - 1 && <MenuRow label={t("block.down")} onClick={() => move(1)} />}
      <MenuSep />
      <MenuRow label={t("block.delete")} danger onClick={remove} />
    </div>
  );
}

function ButtonLabel({
  block,
  blocks,
}: {
  block: Extract<Block, { type: "action" }>;
  blocks: Block[];
}) {
  const t = useStore((s) => s.t);
  const [label, setLabel] = useState(block.label);
  const save = () => {
    const clean = label.trim().slice(0, 80);
    if (clean && clean !== block.label)
      setPageBlocks(blocks.map((b) => (b.id === block.id ? { ...block, label: clean } : b)));
  };
  return (
    <div className="pop-section">
      <input
        className="input"
        aria-label={t("block.label")}
        value={label}
        maxLength={80}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
      />
    </div>
  );
}

/**
 * A button: opens its screen empty, filled with its own values, or saves them at once (the block catalogue's
 * «Al pulsarlo»). A button of the first pages runs its saved shortcut.
 */
function ActionButton({ block }: { block: Extract<Block, { type: "action" }> }) {
  const t = useStore((s) => s.t);
  const shortcuts = useStore((s) => s.shortcuts);
  const legacy = block.shortcut ? shortcuts.find((s) => s.id === block.shortcut) : undefined;
  const mode = block.shortcut ? (legacy?.mode ?? "open") : (block.mode ?? "empty");
  const hex = block.shortcut
    ? (legacy?.color ?? null)
    : (PALETTE.find((c) => c.name === block.color)?.hex ?? null);
  const run = () => {
    if (block.shortcut) {
      if (legacy) void runShortcut(legacy);
      else toast(t("shortcut.gone"));
      return;
    }
    if (mode === "empty") return openScreen(block.screen);
    void runShortcut({
      id: block.id,
      label: block.label,
      screen: block.screen,
      values: block.values ?? {},
      mode: mode === "save" ? "save" : "open",
      color: hex,
    });
  };
  return (
    <button type="button" className={mode === "empty" ? "btn primary" : "pill"} onClick={run}>
      {mode === "empty" ? (
        <Plus size={15} strokeWidth={2} />
      ) : hex ? (
        <span className="swatch" style={{ ["--c" as string]: hex }} aria-hidden="true" />
      ) : null}
      {block.label}
    </button>
  );
}

/** A textarea that grows with its text (one line when empty). */
/**
 * How far down its textarea a place in the text is drawn (wrapped lines count): whether the caret is on the first
 * or the last line shown, as the arrow keys of a document need.
 */
function lineTop(el: HTMLTextAreaElement, at: number): number {
  const style = getComputedStyle(el);
  const probe = document.createElement("div");
  const width =
    el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    width: `${width}px`,
    font: style.font,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    lineHeight: style.lineHeight,
    tabSize: style.tabSize,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  probe.textContent = el.value.slice(0, at);
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  probe.append(mark);
  document.body.append(probe);
  const top = mark.offsetTop;
  probe.remove();
  return top;
}
const onFirstLine = (el: HTMLTextAreaElement) => lineTop(el, el.selectionStart) === lineTop(el, 0);
const onLastLine = (el: HTMLTextAreaElement) =>
  lineTop(el, el.selectionEnd) === lineTop(el, el.value.length);

function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(grow, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const o = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      grow();
    });
    o.observe(el);
    return () => o.disconnect();
  }, []);
}

/** Markdown at the start of a line turns the block into another kind, as Notion does. */
const SHORTCUTS: [string, TextKind | "divider"][] = [
  ["### ", "h3"],
  ["## ", "h2"],
  ["# ", "h1"],
  ["- ", "bullet"],
  ["* ", "bullet"],
  ["1. ", "numbered"],
  ["[] ", "todo"],
  ["[ ] ", "todo"],
  ["> ", "toggle"],
  ['" ', "quote"],
  ["```", "code"],
  ["---", "divider"],
];
/** Kinds whose Enter makes another of the same kind (a list goes on). */
const CONTINUES = new Set(["bullet", "numbered", "todo"]);
/** Kinds whose empty line ends with Enter (it becomes text), as Notion's lists. */
const ENDS = new Set(["bullet", "numbered", "todo", "toggle", "quote", "callout"]);
const DOTS = ["•", "◦", "▪"];

function TextField({
  block,
  page,
  number,
  hidden,
}: {
  block: TextBlock;
  page: Page;
  number?: number;
  hidden: Set<string>;
}) {
  const t = useStore((s) => s.t);
  const focus = useStore((s) => s.pageFocus);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [slashOff, setSlashOff] = useState(false);
  const blocks = page.spec.blocks;
  const kind = kindOf(block);
  const indent = indentOf(block);
  useAutosize(ref, block.text);
  useEffect(() => {
    if (!focus || !("block" in focus) || focus.block !== block.id) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const at = focus.at === "start" ? 0 : focus.at === "end" ? el.value.length : focus.at;
    el.setSelectionRange(at, at);
    setPageFocus(null);
  }, [focus, block.id]);

  const index = blocks.findIndex((b) => b.id === block.id);
  const slash =
    !slashOff && block.type !== "code" && block.text.startsWith("/") && !block.text.includes("\n");
  const put = (b: Block) => blocks.map((x) => (x.id === block.id ? b : x));
  // The blocks next to this one that are on screen (a closed toggle's are not).
  const near = (dir: -1 | 1) => {
    for (let i = index + dir; i >= 0 && i < blocks.length; i += dir) {
      const b = blocks[i];
      if (b && !hidden.has(b.id)) return b;
    }
    return undefined;
  };

  const change = (text: string) => {
    setSlashOff(false);
    for (const [prefix, to] of SHORTCUTS) {
      if (block.type !== "text" || !text.startsWith(prefix)) continue;
      if (to === "divider") {
        const after = emptyText(indent);
        const next = [...blocks];
        next.splice(index, 1, { id: block.id, type: "divider" }, after);
        setPageBlocks(next);
        setPageFocus({ block: after.id, at: "start" });
      } else setPageBlocks(put(asKind(block, to, text.slice(prefix.length))));
      return;
    }
    setPageBlocks(put({ ...block, text }), block.id);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const prev = near(-1);
    const next = near(1);
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Tab") {
      // Nesting, as Notion's Tab: under the block above (at most one level deeper), Shift+Tab back out.
      e.preventDefault();
      const deeper = Math.min(4, indentOf(prev) + 1, indent + 1);
      const to = e.shiftKey ? Math.max(0, indent - 1) : prev ? deeper : indent;
      if (to !== indent) {
        const { indent: _, ...rest } = block as TextBlock & { indent?: number };
        setPageBlocks(put({ ...rest, ...withIndent(to) } as TextBlock));
        setPageFocus({ block: block.id, at: start });
      }
    } else if (e.key === "Enter" && !e.shiftKey && (block.type !== "code" || mod)) {
      e.preventDefault();
      // Enter on an empty list item first comes out of its nesting, then ends the list, as in Notion.
      if (!block.text && ENDS.has(block.type)) {
        if (indent > 0) {
          const { indent: _, ...rest } = block as TextBlock & { indent?: number };
          setPageBlocks(put({ ...rest, ...withIndent(indent - 1) } as TextBlock));
        } else setPageBlocks(put(asKind(block, "text")));
        return;
      }
      const tail = block.type === "code" ? "" : block.text.slice(end);
      const head = block.type === "code" ? block.text : block.text.slice(0, start);
      // A toggle's next line goes inside it; a list goes on; anything else is followed by text.
      const made: TextBlock =
        block.type === "toggle"
          ? emptyText(Math.min(4, indent + 1))
          : CONTINUES.has(block.type)
            ? {
                ...asKind({ ...block, id: blockId() }, kind, tail),
                ...(block.type === "todo" ? { done: false } : {}),
              }
            : { ...emptyText(indent), text: tail };
      const out = [...blocks];
      out.splice(index, 1, { ...block, text: head } as TextBlock, made);
      if (block.type === "toggle" && !block.open) {
        // A closed toggle opens to take the new line.
        out[index] = { ...(out[index] as TextBlock), open: true } as TextBlock;
      }
      setPageBlocks(out);
      setPageFocus({ block: made.id, at: "start" });
    } else if (e.key === "Backspace" && start === 0 && end === 0) {
      if (block.type !== "text") {
        e.preventDefault();
        setPageBlocks(put(asKind(block, "text")));
      } else if (indent > 0) {
        e.preventDefault();
        const { indent: _, ...rest } = block as TextBlock & { indent?: number };
        setPageBlocks(put({ ...rest, ...withIndent(indent - 1) } as TextBlock));
      } else if (prev && isText(prev)) {
        e.preventDefault();
        const joined = { ...prev, text: prev.text + block.text };
        setPageBlocks(
          blocks.flatMap((b) => (b.id === block.id ? [] : b.id === prev.id ? [joined] : [b])),
        );
        // The caret goes where the two texts meet.
        setPageFocus({ block: prev.id, at: prev.text.length });
      } else if (prev && !block.text) {
        e.preventDefault();
        setPageBlocks(blocks.filter((b) => b.id !== block.id));
      }
    } else if (e.key === "Escape") {
      // Out of the text, the block selected (as Notion's): the next Esc lets go of it.
      e.preventDefault();
      el.blur();
      selectBlocks(block.id, block.id);
    } else if (mod && e.key.toLowerCase() === "a" && start === 0 && end === block.text.length) {
      // Ctrl+A a second time (its text already all selected): every block of the page.
      e.preventDefault();
      el.blur();
      const all = blocks.filter((b) => !hidden.has(b.id));
      selectBlocks((all[0] as Block).id, (all[all.length - 1] as Block).id);
    } else if (e.shiftKey && !mod && e.key === "ArrowUp" && start === 0) {
      e.preventDefault();
      el.blur();
      selectBlocks(block.id, prev?.id ?? block.id);
    } else if (e.shiftKey && !mod && e.key === "ArrowDown" && end === block.text.length) {
      e.preventDefault();
      el.blur();
      selectBlocks(block.id, next?.id ?? block.id);
    } else if (e.shiftKey || mod || e.altKey || start !== end) {
      // Anything else with a modifier, or a text selection, is the textarea's own.
    } else if ((e.key === "ArrowUp" && onFirstLine(el)) || (e.key === "ArrowLeft" && start === 0)) {
      // Up from the first line shown (or left from the start) goes to the block above, as in a document;
      // one that is not text (a picture, a chart) is selected.
      if (!prev) return;
      e.preventDefault();
      if (isText(prev)) setPageFocus({ block: prev.id, at: "end" });
      else {
        el.blur();
        selectBlocks(prev.id, prev.id);
      }
    } else if (
      (e.key === "ArrowDown" && onLastLine(el)) ||
      (e.key === "ArrowRight" && end === block.text.length)
    ) {
      if (!next) return;
      e.preventDefault();
      if (isText(next)) setPageFocus({ block: next.id, at: "start" });
      else {
        el.blur();
        selectBlocks(next.id, next.id);
      }
    }
  };

  // Pasting several lines (or Markdown) makes blocks of them; a picture or a file is kept in Boni and shown here.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      e.stopPropagation();
      void addFilesToPage(files, block.id);
      return;
    }
    if (block.type === "code") return;
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return;
    const incoming = markdownToBlocks(text);
    const el = e.currentTarget;
    const r = pastedInto(
      blocks,
      { id: block.id, start: el.selectionStart, end: el.selectionEnd },
      incoming,
      blockId,
    );
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    setPageBlocks(r.blocks);
    setPageFocus(r.focus);
  };

  return (
    <div className={`blk-body${block.type === "callout" ? " callout" : ""}`}>
      {block.type === "bullet" && (
        <span className="blk-mark" aria-hidden="true">
          {DOTS[indent % DOTS.length]}
        </span>
      )}
      {block.type === "numbered" && (
        <span className="blk-mark num" aria-hidden="true">
          {`${number ?? 1}.`}
        </span>
      )}
      {block.type === "todo" && (
        <input
          type="checkbox"
          className="blk-check"
          checked={Boolean(block.done)}
          aria-label={t("block.done")}
          onChange={(e) => setPageBlocks(put({ ...block, done: e.target.checked }))}
        />
      )}
      {block.type === "toggle" && (
        <button
          type="button"
          className={`blk-fold${block.open ? " open" : ""}`}
          aria-expanded={Boolean(block.open)}
          aria-label={block.open ? t("block.fold") : t("block.unfold")}
          onClick={() => setPageBlocks(put({ ...block, open: !block.open }))}
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      )}
      {block.type === "callout" && (
        <PopButton
          className="blk-callout-icon"
          title={t("page.iconChange")}
          align="start"
          width={330}
          label={block.icon || "💡"}
        >
          {(close) => (
            <EmojiGrid
              onPick={(icon) => {
                close();
                setPageBlocks(put({ ...block, icon }));
              }}
            />
          )}
        </PopButton>
      )}
      <textarea
        ref={ref}
        className="blk-input"
        rows={1}
        value={block.text}
        spellCheck={block.type !== "code"}
        maxLength={block.type === "heading" ? 200 : block.type === "code" ? 20000 : 5000}
        placeholder={kind === "text" ? t("block.placeholder") : t(`block.kind.${kind}`)}
        aria-label={t(`block.kind.${kind}`)}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
      />
      {slash && (
        <SlashMenu
          query={block.text.slice(1)}
          onClose={() => setSlashOff(true)}
          onPick={(choice) => pick(choice, block, blocks, index)}
          inputRef={ref}
        />
      )}
    </div>
  );
}

type Choice =
  | { kind: TextKind | "divider" }
  | { kind: "chart"; chart: string }
  | { kind: "new-chart" }
  | { kind: "page" }
  | { kind: "ai" }
  | { kind: "database"; source: string }
  | { kind: "action"; screen: string; label: string; shortcut?: string }
  /** A kind of the block catalogue that shows data (a number, a bar list, a chart). */
  | { kind: "data"; type: string };

/** What the "/" menu's choice does to the block where it was typed. */
function pick(choice: Choice, block: TextBlock, blocks: Block[], index: number) {
  const out = [...blocks];
  const putInstead = (made: Block) => {
    const b = block.at && !made.at ? ({ ...made, at: block.at } as Block) : made;
    const after = index === blocks.length - 1 ? [emptyText()] : [];
    out.splice(index, 1, b, ...after);
    setPageBlocks(out);
    const next = after[0] ?? blocks[index + 1];
    if (next && isText(next)) setPageFocus({ block: next.id, at: "start" });
  };
  const t = useStore.getState().t;
  switch (choice.kind) {
    case "data": {
      const state = useStore.getState();
      const b = newBlock(choice.type, block.id, catalogueOf(state.dataTypes, state.pages));
      if (!b) return;
      const w = catalogueKind(choice.type)?.w ?? 12;
      // A button goes in the page's flow, where buttons one after another share a row (only what they need).
      const at =
        block.at ?? (choice.type === "action" ? null : { row: newRowId(blocks), col: 0, w });
      putInstead({ ...b, ...(at ? { at } : {}) } as unknown as Block);
      openBlockPanel(block.id);
      return;
    }
    case "divider":
      return putInstead({ id: block.id, type: "divider", ...(block.at ? { at: block.at } : {}) });
    case "chart":
      return putInstead({ id: block.id, type: "chart", chart: choice.chart });
    case "database":
      return putInstead({
        id: block.id,
        type: "database",
        source: choice.source,
        view: { layout: "table" },
      });
    case "action":
      return putInstead({
        id: block.id,
        type: "action",
        screen: choice.screen,
        label: choice.label.slice(0, 80),
        ...(choice.shortcut ? { shortcut: choice.shortcut } : {}),
      });
    case "new-chart":
      out.splice(index, 1, { ...block, text: "" });
      setPageBlocks(out);
      newChartForPage(newSpec(t("charts.newTitle")), block.id);
      return;
    case "page":
      void newSubpageBlock(block.id);
      return;
    case "ai":
      // A placeholder: Boni writing on the page comes later.
      out.splice(index, 1, { ...block, text: "" });
      setPageBlocks(out);
      setPageFocus({ block: block.id, at: "start" });
      toast(t("block.aiSoon"));
      return;
    default:
      out.splice(index, 1, asKind(block, choice.kind, ""));
      setPageBlocks(out);
      setPageFocus({ block: block.id, at: "start" });
  }
}

const HINTS: Partial<Record<TextKind | "divider", string>> = {
  h1: "#",
  h2: "##",
  h3: "###",
  bullet: "-",
  numbered: "1.",
  todo: "[]",
  toggle: ">",
  quote: '"',
  code: "```",
  divider: "---",
};
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

interface SlashItem {
  group: string;
  label: string;
  hint?: string;
  color?: string;
  choice: Choice;
}

/** Every block that can go here, in groups, filtered by a query (the "/" menu and the "+" menu share it). */
function useBlockItems(query: string): SlashItem[] {
  const t = useStore((s) => s.t);
  const specs = useVisibleCharts();
  const home = useStore((s) => s.home);
  const shortcuts = useStore((s) => s.shortcuts);
  const dataTypes = useStore((s) => s.dataTypes);
  useEffect(() => {
    if (!dataTypes) void loadDataTypes();
  }, []);
  const items = useMemo(() => {
    const write = t("block.write");
    const charts = t("block.charts");
    const buttons = t("block.actions");
    const all: SlashItem[] = [
      ...[...TURN_INTO, "divider" as const].map((k) => ({
        group: write,
        label: t(`block.kind.${k}`),
        hint: HINTS[k],
        choice: { kind: k },
      })),
      { group: write, label: t("block.kind.page"), choice: { kind: "page" } },
      ...CATALOGUE.filter((k) => k.type !== "heading" && k.type !== "text").map(
        (k): SlashItem => ({
          group: catText(t, k.group),
          label: catText(t, k.name),
          choice: { kind: "data", type: k.type },
        }),
      ),
      { group: "Boni", label: t("block.ai"), hint: t("block.soon"), choice: { kind: "ai" } },
      ...(dataTypes ?? []).map(
        (d): SlashItem => ({
          group: t("block.databases"),
          label: d.name,
          hint: d.icon || undefined,
          choice: { kind: "database", source: d.id },
        }),
      ),
      { group: charts, label: t("block.chartNew"), choice: { kind: "new-chart" } },
      ...specs.map(
        (s): SlashItem => ({
          group: charts,
          label: s.title,
          color: s.color ?? ACCENT,
          choice: { kind: "chart", chart: s.id },
        }),
      ),
      ...(home?.components ?? []).flatMap((c): SlashItem[] =>
        c.type === "button"
          ? [
              {
                group: buttons,
                label: c.label,
                choice: { kind: "action", screen: c.screen, label: c.label },
              },
            ]
          : [],
      ),
      ...shortcuts.map(
        (s): SlashItem => ({
          group: buttons,
          label: s.label,
          choice: { kind: "action", screen: s.screen, label: s.label, shortcut: s.id },
        }),
      ),
    ];
    const q = fold(query.trim());
    const allowed = all;
    return q
      ? allowed.filter((i) => fold(i.label).includes(q) || fold(i.group).includes(q))
      : allowed;
  }, [query, specs, home, shortcuts, dataTypes, t]);
  return items;
}

/** The "/" menu: every block that can go here, filtered by what is typed after the "/". */
function SlashMenu({
  query,
  onPick,
  onClose,
  inputRef,
}: {
  query: string;
  onPick: (c: Choice) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useStore((s) => s.t);
  const items = useBlockItems(query);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [query]);
  // The keys stay in the text field: the menu follows them.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = items.length || 1;
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        const it = items[active];
        if (it) onPick(it.choice);
        else onClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [items, active, onPick, onClose, inputRef]);
  useEffect(() => {
    box.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let group = "";
  return (
    <div ref={box} className="slash-menu pop-box" role="menu" aria-label={t("block.menuTitle")}>
      <div className="menu-list">
        {items.length === 0 && <p className="menu-head">{t("block.none")}</p>}
        {items.map((it, i) => {
          const head = it.group !== group;
          group = it.group;
          return (
            <div key={`${it.group}-${it.label}-${i}`}>
              {head && <div className="menu-head">{it.group}</div>}
              <button
                type="button"
                role="menuitem"
                data-i={i}
                className={`menu-item${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(it.choice)}
              >
                {it.color && <span className="swatch" style={{ ["--c" as string]: it.color }} />}
                <span className="menu-text">{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The "+" menu (Juan, 2026-10-24: no "/" to type): the same blocks as the "/" menu, with a box to filter them.
 */
function AddMenu({ onPick }: { onPick: (c: Choice) => void }) {
  const t = useStore((s) => s.t);
  const [q, setQ] = useState("");
  const items = useBlockItems(q);
  const [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  // The box is placed (and visible) after it mounts: focus then, so typing filters at once.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => search.current?.focus()));
    return () => cancelAnimationFrame(id);
  }, []);
  let group = "";
  return (
    <div className="menu-list add-menu" role="menu" aria-label={t("block.menuTitle")}>
      <input
        className="input add-menu-search"
        placeholder={t("block.search")}
        aria-label={t("block.search")}
        ref={search}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = items.length || 1;
            setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const it = items[active];
            if (it) onPick(it.choice);
          }
        }}
      />
      {items.length === 0 && <p className="menu-head">{t("block.none")}</p>}
      {items.map((it, i) => {
        const head = it.group !== group;
        group = it.group;
        return (
          <div key={`${it.group}-${it.label}-${i}`}>
            {head && <div className="menu-head">{it.group}</div>}
            <button
              type="button"
              role="menuitem"
              className={`menu-item${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(it.choice)}
            >
              {it.color && <span className="swatch" style={{ ["--c" as string]: it.color }} />}
              <span className="menu-text">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A block chosen in the "+" menu goes after this one: in its column when its row has several (as in Notion), else
 * after it on a row of its own (a number alone keeps its narrow row to itself).
 */
function addAfter(choice: Choice, block: Block, blocks: Block[]) {
  const i = blocks.findIndex((b) => b.id === block.id);
  const shared = block.at && colsOf(blocks, block.at.row).length > 1 ? block.at : null;
  const after = block.at ? i + 1 : i + withChildren(blocks, i).length;
  const at = shared ? { at: { row: shared.row, col: shared.col, w: shared.w } } : {};
  const fresh = { ...emptyText(block.at ? 0 : indentOf(block)), ...at } as TextBlock;
  const next = [...blocks];
  next.splice(after, 0, fresh);
  pick(choice, fresh, next, after);
}

/** The card of a chart being created for this page in the side panel, with the editor's preview. */
function NewChartPreview() {
  const panel = useStore((s) => s.panel);
  const forPage = useStore((s) => s.chartForPage);
  const preview = useStore((s) => (s.editPreview?.id === "" ? s.editPreview.state : null));
  if (panel?.kind !== "edit" || !panel.isNew || !forPage) return null;
  return (
    <div className="doc-charts">
      <div className={`doc-chart h-${panel.spec.style.height ?? "m"}`}>
        <ChartCardContent
          title={panel.spec.title}
          color={panel.spec.color}
          style={panel.spec.style}
          state={preview ?? emptyState()}
          className="editing new"
        />
      </div>
    </div>
  );
}

/** No pages yet: what Boni is for, and the first step. */
export function Welcome({ error, after }: { error?: string | null; after?: ReactNode }) {
  const t = useStore((s) => s.t);
  return (
    <div className="content center">
      {error && <p className="form-error">{error}</p>}
      <div className="empty-state welcome">
        <img src="./favicon.png" alt="" width={56} height={56} />
        <h2>{t("welcome.title")}</h2>
        <p>{t("welcome.text")}</p>
        <div className="welcome-actions">
          <button type="button" className="btn primary" onClick={() => void newPage()}>
            <Plus size={15} strokeWidth={2} />
            {t("page.new")}
          </button>
          <button type="button" className="btn" onClick={showChat}>
            {t("welcome.chat")}
          </button>
        </div>
      </div>
      {after}
    </div>
  );
}
