import { GripVertical, Plus, Smile } from "lucide-react";
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
import { isCategoryKind, newSpec } from "../core/chartBuilder.ts";
import { emptyState } from "../core/charts.ts";
import {
  blockId,
  newChartForPage,
  newPage,
  openEditor,
  openScreen,
  runShortcut,
  setPageBlocks,
  setPageFocus,
  setPageIcon,
  setPageTitle,
  showChat,
  toast,
  useStore,
  useVisibleCharts,
} from "../store.ts";
import { ACCENT } from "./Chart.tsx";
import { ChartCard, ChartCardContent } from "./ChartCard.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

type Block = Page["spec"]["blocks"][number];
type TextBlock = Extract<Block, { text: string }>;
type TextKind = "text" | "h1" | "h2" | "h3" | "bullet" | "todo";

const isText = (b: Block): b is TextBlock =>
  b.type === "text" || b.type === "heading" || b.type === "bullet" || b.type === "todo";
const kindOf = (b: TextBlock): TextKind =>
  b.type === "heading" ? (`h${b.level ?? 1}` as TextKind) : (b.type as TextKind);
/** The same block (id and text kept) as another kind of text. */
function asKind(b: TextBlock, kind: TextKind, text = b.text): TextBlock {
  if (kind === "h1" || kind === "h2" || kind === "h3")
    return { id: b.id, type: "heading", text, level: Number(kind[1]) as 1 | 2 | 3 };
  if (kind === "todo") return { id: b.id, type: "todo", text };
  return { id: b.id, type: kind, text };
}
const emptyText = (): TextBlock => ({ id: blockId(), type: "text", text: "" });

/**
 * A page of the user's, as a Notion page (docs/extensiones.md 6): always editable in place, no edit mode.
 * Its name is the big title; its blocks come from a closed catalogue and are painted by this code. Text is
 * typed straight into its block (Enter makes the next one, "/" opens the block menu, "# ", "- ", "[] "
 * turn it into a heading, a list or a to-do; Backspace at the start joins it to the one above); on hover
 * every block shows "+" (a block below) and its handle (its menu; drag to move it).
 */
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
      <div className="doc">
        <PageIcon page={page} />
        <PageTitle page={page} />
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

/** Over the name: the page's icon (a click changes it), or "Add icon" on hover, as in Notion. */
function PageIcon({ page }: { page: Page }) {
  const t = useStore((s) => s.t);
  const picker = (close: () => void) => (
    <div className="pop-section">
      <div className="emoji-grid" role="group" aria-label={t("page.icon")}>
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className="emoji"
            aria-label={e}
            onClick={() => {
              close();
              setPageIcon(e);
            }}
          >
            {e}
          </button>
        ))}
      </div>
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
function DocTail({ page }: { page: Page }) {
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

type Drag = { id: string; over: string | null; after: boolean } | null;

/** The blocks; consecutive charts share a grid (side by side on a full-width page), buttons a row. */
function Blocks({ page }: { page: Page }) {
  const specs = useVisibleCharts();
  const [drag, setDrag] = useState<Drag>(null);
  const blocks = page.spec.blocks;
  const groups: Block[][] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    const joins = (b.type === "chart" || b.type === "action") && last?.[0]?.type === b.type;
    if (last && joins) last.push(b);
    else groups.push([b]);
  }
  const drop = () => {
    const moving = blocks.find((b) => b.id === drag?.id);
    if (!drag?.over || drag.over === drag.id || !moving) return setDrag(null);
    const rest = blocks.filter((b) => b.id !== drag.id);
    const at = rest.findIndex((b) => b.id === drag.over) + (drag.after ? 1 : 0);
    rest.splice(at, 0, moving);
    setPageBlocks(rest);
    setDrag(null);
  };
  const row = (b: Block) => (
    <BlockRow
      key={b.id}
      block={b}
      page={page}
      drag={drag}
      onDragStart={() => setDrag({ id: b.id, over: null, after: false })}
      onDragOver={(after) => drag && setDrag({ ...drag, over: b.id, after })}
      onDrop={drop}
      onDragEnd={() => setDrag(null)}
    >
      {b.type === "chart" ? (
        specs.some((s) => s.id === b.chart) ? (
          <ChartCard chartId={b.chart} />
        ) : (
          <ChartGone />
        )
      ) : b.type === "action" ? (
        <ActionButton block={b} />
      ) : b.type === "divider" ? (
        <hr className="doc-divider" />
      ) : (
        <TextField block={b} page={page} />
      )}
    </BlockRow>
  );
  return (
    <div className="doc-blocks">
      {groups.map((g) => {
        const first = g[0] as Block;
        if (first.type === "chart")
          return (
            <div key={first.id} className="doc-charts">
              {g.map((b) => {
                const spec = b.type === "chart" ? specs.find((s) => s.id === b.chart) : null;
                const wide = spec && isCategoryKind(spec.kind) && spec.kind !== "donut";
                return (
                  <div key={b.id} className={`doc-chart${wide ? " wide" : ""}`}>
                    {row(b)}
                  </div>
                );
              })}
            </div>
          );
        if (first.type === "action")
          return (
            <div key={first.id} className="doc-actions">
              {g.map(row)}
            </div>
          );
        return row(first);
      })}
    </div>
  );
}

function ChartGone() {
  const t = useStore((s) => s.t);
  return <p className="doc-gone">{t("block.chartGone")}</p>;
}

/** A block with its hover controls: "+" adds a line below, the handle opens its menu and drags it. */
function BlockRow({
  block,
  page,
  drag,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  children,
}: {
  block: Block;
  page: Page;
  drag: Drag;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  const t = useStore((s) => s.t);
  const [menu, setMenu] = useState(false);
  const blocks = page.spec.blocks;
  const kind = isText(block) ? kindOf(block) : block.type;
  const name = t(`block.kind.${kind}`);
  const addBelow = () => {
    const b: TextBlock = { id: blockId(), type: "text", text: "/" };
    const i = blocks.findIndex((x) => x.id === block.id);
    const next = [...blocks];
    next.splice(i + 1, 0, b);
    setPageBlocks(next);
    setPageFocus({ block: b.id, at: "end" });
  };
  const target = drag && drag.over === block.id && drag.id !== block.id;
  return (
    <div
      className={`blk blk-${kind}${menu ? " menu-open" : ""}${drag?.id === block.id ? " dragging" : ""}${
        target ? (drag.after ? " drop-after" : " drop-before") : ""
      }`}
      data-block={block.id}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOver(
          block.type === "action"
            ? e.clientX > r.left + r.width / 2
            : e.clientY > r.top + r.height / 2,
        );
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="blk-gutter">
        <button
          type="button"
          className="blk-btn"
          title={t("block.addBelow")}
          aria-label={`${t("block.addBelow")}: ${name}`}
          onClick={addBelow}
        >
          <Plus size={16} strokeWidth={1.8} />
        </button>
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
    </div>
  );
}

const TURN_INTO: TextKind[] = ["text", "h1", "h2", "h3", "bullet", "todo"];

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

function ActionButton({ block }: { block: Extract<Block, { type: "action" }> }) {
  const t = useStore((s) => s.t);
  const shortcuts = useStore((s) => s.shortcuts);
  const run = () => {
    if (!block.shortcut) return openScreen(block.screen);
    const sc = shortcuts.find((s) => s.id === block.shortcut);
    if (sc) void runShortcut(sc);
    else toast(t("shortcut.gone"));
  };
  return (
    <button type="button" className={block.shortcut ? "pill" : "btn primary"} onClick={run}>
      {!block.shortcut && <Plus size={15} strokeWidth={2} />}
      {block.label}
    </button>
  );
}

/** A textarea that grows with its text (one line when empty). */
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
  ["[] ", "todo"],
  ["[ ] ", "todo"],
  ["---", "divider"],
];

function TextField({ block, page }: { block: TextBlock; page: Page }) {
  const t = useStore((s) => s.t);
  const focus = useStore((s) => s.pageFocus);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [slashOff, setSlashOff] = useState(false);
  const blocks = page.spec.blocks;
  const kind = kindOf(block);
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
  const slash = !slashOff && block.text.startsWith("/") && !block.text.includes("\n");

  const change = (text: string) => {
    setSlashOff(false);
    for (const [prefix, to] of SHORTCUTS) {
      if (block.type !== "text" || !text.startsWith(prefix)) continue;
      if (to === "divider") {
        const after = emptyText();
        const next = [...blocks];
        next.splice(index, 1, { id: block.id, type: "divider" }, after);
        setPageBlocks(next);
        setPageFocus({ block: after.id, at: "start" });
      } else {
        const turned = asKind(block, to, text.slice(prefix.length));
        setPageBlocks(blocks.map((b) => (b.id === block.id ? turned : b)));
      }
      return;
    }
    setPageBlocks(blocks.map((b) => (b.id === block.id ? { ...block, text } : b)));
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const prev = blocks[index - 1];
    const next = blocks[index + 1];
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Enter on an empty list item or to-do ends the list (it becomes text), as in Notion.
      if (!block.text && (block.type === "bullet" || block.type === "todo")) {
        setPageBlocks(blocks.map((b) => (b.id === block.id ? asKind(block, "text") : b)));
        return;
      }
      const tail = block.text.slice(end);
      const made: TextBlock =
        block.type === "bullet" || block.type === "todo"
          ? asKind({ ...block, id: blockId() }, kind, tail)
          : { id: blockId(), type: "text", text: tail };
      const out = [...blocks];
      out.splice(index, 1, { ...block, text: block.text.slice(0, start) }, made);
      setPageBlocks(out);
      setPageFocus({ block: made.id, at: "start" });
    } else if (e.key === "Backspace" && start === 0 && end === 0) {
      if (block.type !== "text") {
        e.preventDefault();
        setPageBlocks(blocks.map((b) => (b.id === block.id ? asKind(block, "text") : b)));
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
    } else if (e.key === "ArrowUp" && start === 0 && prev && isText(prev)) {
      e.preventDefault();
      setPageFocus({ block: prev.id, at: "end" });
    } else if (e.key === "ArrowDown" && end === block.text.length && next && isText(next)) {
      e.preventDefault();
      setPageFocus({ block: next.id, at: "start" });
    }
  };

  return (
    <div className="blk-body">
      {block.type === "bullet" && <span className="blk-dot" aria-hidden="true" />}
      {block.type === "todo" && (
        <input
          type="checkbox"
          className="blk-check"
          checked={Boolean(block.done)}
          aria-label={t("block.done")}
          onChange={(e) =>
            setPageBlocks(
              blocks.map((b) => (b.id === block.id ? { ...block, done: e.target.checked } : b)),
            )
          }
        />
      )}
      <textarea
        ref={ref}
        className="blk-input"
        rows={1}
        value={block.text}
        maxLength={block.type === "heading" ? 200 : 5000}
        placeholder={kind === "text" ? t("block.placeholder") : t(`block.kind.${kind}`)}
        aria-label={t(`block.kind.${kind}`)}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKey}
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
  | { kind: "action"; screen: string; label: string; shortcut?: string };

/** What the "/" menu's choice does to the block where it was typed. */
function pick(choice: Choice, block: TextBlock, blocks: Block[], index: number) {
  const out = [...blocks];
  const putInstead = (b: Block) => {
    const after = index === blocks.length - 1 ? [emptyText()] : [];
    out.splice(index, 1, b, ...after);
    setPageBlocks(out);
    const next = after[0] ?? blocks[index + 1];
    if (next && isText(next)) setPageFocus({ block: next.id, at: "start" });
  };
  switch (choice.kind) {
    case "divider":
      return putInstead({ id: block.id, type: "divider" });
    case "chart":
      return putInstead({ id: block.id, type: "chart", chart: choice.chart });
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
      newChartForPage(newSpec(useStore.getState().t("charts.newTitle")), block.id);
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
  todo: "[]",
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
  const specs = useVisibleCharts();
  const home = useStore((s) => s.home);
  const shortcuts = useStore((s) => s.shortcuts);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
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
    return q ? all.filter((i) => fold(i.label).includes(q) || fold(i.group).includes(q)) : all;
  }, [query, specs, home, shortcuts, t]);
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

/** The card of a chart being created for this page in the side panel, with the editor's preview. */
function NewChartPreview() {
  const panel = useStore((s) => s.panel);
  const forPage = useStore((s) => s.chartForPage);
  const preview = useStore((s) => (s.editPreview?.id === "" ? s.editPreview.state : null));
  if (panel?.kind !== "edit" || !panel.isNew || !forPage) return null;
  return (
    <div className="doc-charts">
      <div className="doc-chart">
        <ChartCardContent
          title={panel.spec.title}
          color={panel.spec.color}
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
