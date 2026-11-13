import {
  blocksToMarkdown,
  buttonDoes,
  CATALOGUE,
  type ControlBlock,
  kindOf as catalogueKind,
  controlsOf,
  controlsOfBlock,
  markdownToBlocks,
  newBlock,
  partsOf,
  passedValues,
} from "@boni/views";
import { ArrowRight, FileText, GripVertical, Play, Plus, Smile, X } from "lucide-react";
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
import { focusAtEnd } from "../core/caret.ts";
import { isCategoryKind, newSpec } from "../core/chartBuilder.ts";
import { emptyState } from "../core/charts.ts";
import { inRun, isText, type TextBlock } from "../core/docModel.ts";
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
import { chipTitle, pointAttrs } from "../core/pointing.ts";
import {
  duplicated,
  indented,
  moved,
  rangeIds,
  replacedBy,
  withoutBlocks,
} from "../core/selection.ts";
import {
  asKind,
  indentOf,
  kindOf,
  type TextKind,
  emptyText as textBlock,
  withChildren,
} from "../core/textKeys.ts";
import { phoneLayout } from "../host.ts";
import { catText } from "../i18n.ts";
import {
  addFilesToPage,
  blockId,
  clearBlockSel,
  loadDataTypes,
  newChartForPage,
  newChatBlock,
  newPage,
  newSubpageBlock,
  openBlockPanel,
  openEditor,
  openPage,
  openPageWith,
  openRowsPanel,
  openScreen,
  pressButton,
  runShortcut,
  selectBlocks,
  setPageBlocks,
  setPageFocus,
  setPageIcon,
  setPageTitle,
  showChat,
  showMap,
  toast,
  undoPage,
  useStore,
  useVisibleCharts,
} from "../store.ts";
import { kindName } from "./BlockPanel.tsx";
import { LinkBlock } from "./BoniBlocks.tsx";
import { ACCENT } from "./Chart.tsx";
import { ChartCard, ChartCardContent } from "./ChartCard.tsx";
import { ControlView, withValue } from "./ControlView.tsx";
import { DataBlockView, useBlockResults } from "./DataBlockView.tsx";
import { DatabaseBlock } from "./DatabaseBlock.tsx";
import { historyColor, whoLabel } from "./History.tsx";
import { ImageBlock, ImageDialogs, ImageMenu } from "./Images.tsx";
import { PageChatBlock } from "./PageChatBlock.tsx";
import { MenuRow, MenuSep, PointMenu, PopButton } from "./Popover.tsx";
import { TemplatePill } from "./TemplatePill.tsx";
import { type Drag, type RunContext, type RunMenus, TextRun } from "./TextRun.tsx";

type Block = Page["spec"]["blocks"][number];

export type { TextKind };

/**
 * A block of the document being edited turned into another kind, its text kept (Notion's «Turn into»), or back to
 * text when it already is that kind: the phone's bar over the keyboard (KeyboardBar.tsx), wherever the caret is.
 */
export function turnBlock(id: string, kind: TextKind) {
  const s = useStore.getState();
  const doc = s.view.kind === "row" ? s.rowDoc : s.page;
  const b = doc?.spec.blocks.find((x) => x.id === id);
  if (!doc || !b || !isText(b)) return;
  const to = kindOf(b) === kind ? "text" : kind;
  setPageBlocks(
    doc.spec.blocks.map((x) => (x.id === id ? asKind(b, to) : x)),
    id,
  );
}
/** An empty line of text, with an id of its own. */
const emptyText = (indent = 0): TextBlock => textBlock(blockId(), indent);

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
      focusAtEnd(ref.current);
      setPageFocus(null);
    }
  }, [focus]);
  return (
    <textarea
      ref={ref}
      className="doc-title"
      data-boni-action="pages.update"
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
      {blocks.length === 0 && (
        // On the phone a finger taps, and there is no «/» to press on its keyboard's first view.
        <span className="doc-hint">
          {t(phoneLayout() ? "block.placeholderFirstPhone" : "block.placeholderFirst")}
        </span>
      )}
    </button>
  );
}

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
  const t = useStore((s) => s.t);
  const specs = useVisibleCharts();
  // While a chart is being edited its height follows the draft.
  const panel = useStore((s) => s.panel);
  const [drag, setDrag] = useState<Drag>(null);
  const blocks = page.spec.blocks;
  const { hidden, numbers } = useMemo(() => layoutOf(blocks), [blocks]);
  const visible = blocks.filter((b) => !hidden.has(b.id));
  const dataBlocks = useMemo(() => blocks.filter(isDataBlock), [blocks]);
  const controls = useMemo(() => controlsOf(blocks), [blocks]);
  const { results, failure, pending } = useBlockResults(dataBlocks, controls);
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
    // In the text, a press and a drag select text, from one block to another (task 2g): the text's own.
    if (el.closest(".doc-run")) {
      if (s) clearBlockSel();
      return;
    }
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
      busy={pending && isDataBlock(b) && results[b.id] !== undefined}
    >
      {isDataBlock(b) ? (
        <DataBlockView block={b} result={results[b.id]} failure={failure} controls={controls} />
      ) : b.type === "control" ? (
        <ControlView
          block={b}
          onValue={(value) =>
            setPageBlocks(page.spec.blocks.map((x) => (x.id === b.id ? withValue(b, value) : x)))
          }
        />
      ) : b.type === "link" ? (
        <LinkBlock block={b} controls={controls} />
      ) : b.type === "chat" ? (
        <PageChatBlock flow={b.flow} />
      ) : b.type === "chart" ? (
        specs.some((s) => s.id === b.chart) ? (
          <ChartCard chartId={b.chart} />
        ) : (
          <ChartGone />
        )
      ) : b.type === "action" ? (
        <ActionButton block={b} page={page.id} controls={controls} />
      ) : b.type === "database" ? (
        <DatabaseBlock
          source={b.source}
          view={b.view}
          controls={controls}
          table={`${page.id}/${b.id}`}
          onView={(view) =>
            setPageBlocks(page.spec.blocks.map((x) => (x.id === b.id ? { ...b, view } : x)))
          }
        />
      ) : null}
    </BlockRow>
  );
  // The page's text, a run of blocks one after another as one document (TextRun.tsx), and the menus its blocks open.
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const parts = useMemo(
    () => (page.id.startsWith("row:") ? partsOf(blocks) : null),
    [blocks, page.id],
  );
  const menus: RunMenus = {
    add: (b, close) => (
      <AddMenu
        onPick={(choice) => {
          close();
          addAfter(choice, b, blocks);
        }}
      />
    ),
    block: (b, close) => <BlockMenu block={b} page={page} close={close} />,
    icon: (b, close) => (
      <EmojiGrid
        onPick={(icon) => {
          close();
          setPageBlocks(blocks.map((x) => (x.id === b.id ? ({ ...b, icon } as Block) : x)));
        }}
      />
    ),
    slash: (b, query, onClose, keys) => (
      <SlashMenu
        query={query}
        onClose={onClose}
        onPick={(choice) => pick(choice, b, blocks, blocks.indexOf(b))}
        keys={keys}
      />
    ),
    inText: (b) =>
      b.type === "file" || b.type === "files" ? (
        <ImageBlock block={b} />
      ) : b.type === "page" ? (
        <PageLink id={b.page} />
      ) : null,
    name: (b) =>
      isText(b) ? t(`block.kind.${kindOf(b)}`) : kindName(t, catalogueKind(b.type), b.type),
  };
  const ctx: RunContext = {
    page,
    byId,
    order,
    numbers,
    selected,
    parts,
    drag,
    onDragStart: (id) => setDrag({ id, over: null, where: "below" }),
    onDragOver: (id, where) => {
      if (drag && (drag.over !== id || drag.where !== where)) setDrag({ ...drag, over: id, where });
    },
    onDrop: drop,
    onDragEnd: () => setDrag(null),
    menus,
  };
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
      const head = last?.[0];
      const joins =
        ((b.type === "chart" || b.type === "action") && head?.type === b.type) ||
        (inRun(b) && !!head && inRun(head));
      if (last && joins) last.push(b);
      else groups.push([b]);
    }
    return groups.map((g) => {
      const first = g[0] as Block;
      if (inRun(first))
        return <TextRun key={`run-${first.id}`} ids={g.map((b) => b.id)} ctx={ctx} />;
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
      <ImageDialogs />
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
  busy = false,
  children,
}: {
  block: Block;
  page: Page;
  selected: boolean;
  /** Its numbers are being asked again (a value of the page changed; I-15): dimmed in place. */
  busy?: boolean;
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
  // A block of a page can be pointed at for Boni (F9, `Ctrl+Shift+E`), by reference: its chip says its kind and
  // its name (a note's paragraphs are pointed at in its text, TextRun.tsx). A line says nothing.
  const onPage = useStore((s) => s.page?.id === page.id);
  const named = useStore((s) =>
    block.type === "chart"
      ? (s.chartSpecs.find((c) => c.id === block.chart)?.title ?? "")
      : block.type === "database"
        ? (s.dataTypes?.find((d) => d.id === block.source)?.name ?? "")
        : block.type === "page"
          ? (s.pages?.find((p) => p.id === block.page)?.title ?? "")
          : "",
  );
  const pointable =
    onPage && block.type !== "divider"
      ? pointAttrs(
          { kind: "block", page: page.id, block: block.id },
          chipTitle(
            name,
            isDataBlock(block)
              ? (block.title ?? "")
              : isText(block)
                ? block.text
                : block.type === "action"
                  ? block.label
                  : block.type === "link"
                    ? (block.title ?? "")
                    : block.type === "file"
                      ? block.name
                      : block.type === "files"
                        ? block.files.map((f) => f.name).join(", ")
                        : named,
          ),
        )
      : {};
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
      aria-busy={busy || undefined}
      {...pointable}
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
/** The collection a block shows (a number, a chart, a table): «Ver en el mapa» puts it in the centre. */
const blockCollection = (block: Block): string | null => {
  const b = block as { collection?: unknown; source?: unknown };
  const id =
    typeof b.collection === "string"
      ? b.collection
      : typeof b.source === "string"
        ? b.source
        : null;
  // Boni's own records (Uso de la IA's blocks) are on no map: they are not the user's data.
  return id && !id.startsWith("t_sys_") ? id : null;
};

/**
 * What «Ver en el mapa» puts in the centre (docs/sistema.md §4.6 point 7): a block that paints a collection, or a value
 * one of them reads, as the map draws it (apps/server flowMap.ts); any other block that names a collection, that
 * collection.
 */
const mapCentre = (block: Block, blocks: readonly Block[], page: string): string | null => {
  const col = blockCollection(block);
  const painted = block.type === "number" || block.type === "bars" || block.type === "graph";
  const read =
    block.type === "control" && blocks.some((b) => controlsOfBlock(b, blocks).includes(block.id));
  if (col && (painted || block.type === "database")) return `block:${page}:${block.id}`;
  if (read) return `block:${page}:${block.id}`;
  return col ? `col:${col}` : null;
};

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
      {(block.type === "file" || block.type === "files") && (
        <ImageMenu block={block} blocks={blocks} close={close} />
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
      {mapCentre(block, blocks, page.id) && (
        <MenuRow
          label={t("map.show")}
          onClick={() => {
            close();
            showMap(mapCentre(block, blocks, page.id) as string);
          }}
        />
      )}
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
 * «Al pulsarlo»). A button of the first pages runs its saved shortcut. One that runs an action or a flow is pressed
 * on the server, and waits where it is (I-15); one that opens a page carries values, as a link (D-60).
 */
function ActionButton({
  block,
  page,
  controls,
}: {
  block: Extract<Block, { type: "action" }>;
  page: string;
  controls: readonly ControlBlock[];
}) {
  const does = buttonDoes(block);
  if (does === "screen") return <FormButton block={block} />;
  if (does === "page")
    return (
      <button
        type="button"
        className="btn"
        onClick={() => block.to && void openPageWith(block.to, passedValues(block.pass, controls))}
      >
        {block.label}
        <ArrowRight size={15} strokeWidth={2} />
      </button>
    );
  return <RunButton block={block} page={page} />;
}

function RunButton({ block, page }: { block: Extract<Block, { type: "action" }>; page: string }) {
  const t = useStore((s) => s.t);
  // In the store, not here: the page redraws its blocks while the turn runs (D-60, I-15).
  const pressing = useStore((s) => s.pressing === `${page}:${block.id}`);
  const busy = useStore((s) => s.chatBusy || s.pressing !== null);
  const press = () => pressButton(page, block.id, block.label);
  return (
    <button
      type="button"
      className={`btn decide-btn${pressing ? " busy" : ""}`}
      aria-busy={pressing || undefined}
      disabled={busy && !pressing}
      title={busy && !pressing ? t("button.busy") : undefined}
      onClick={() => void press()}
    >
      <span className="decide-label">
        {block.does === "flow" ? <Play size={14} strokeWidth={2} /> : null}
        {block.label}
      </span>
      {pressing && <span className="spinner" aria-hidden="true" />}
    </button>
  );
}

function FormButton({ block }: { block: Extract<Block, { type: "action" }> }) {
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
    const screen = block.screen ?? "capture-expense";
    if (mode === "empty") return openScreen(screen);
    void runShortcut({
      id: block.id,
      label: block.label,
      screen,
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

/** A textarea that grows with its text (one line when empty): the page's title. */
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

type Choice =
  | { kind: TextKind | "divider" }
  | { kind: "chart"; chart: string }
  | { kind: "new-chart" }
  | { kind: "page" }
  | { kind: "chat" }
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
      const b = newBlock(
        choice.type,
        block.id,
        catalogueOf(state.dataTypes, state.pages, controlsOf(blocks)),
      );
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
    case "chat":
      void newChatBlock(block.id);
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
      { group: "Boni", label: t("block.chat"), choice: { kind: "chat" } },
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
  keys,
}: {
  query: string;
  onPick: (c: Choice) => void;
  onClose: () => void;
  /** Where the keys are typed (the text's editor): the menu follows them. */
  keys: HTMLElement;
}) {
  const t = useStore((s) => s.t);
  const items = useBlockItems(query);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setActive(0), [query]);
  // The keys stay in the text field: the menu follows them.
  useEffect(() => {
    const el = keys;
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
  }, [items, active, onPick, onClose, keys]);
  useEffect(() => {
    box.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  let group = "";
  return (
    <div
      ref={box}
      className="slash-menu pop-box"
      role="menu"
      data-boni-action="pages.add_block"
      aria-label={t("block.menuTitle")}
    >
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
