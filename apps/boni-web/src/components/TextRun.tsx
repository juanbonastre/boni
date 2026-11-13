/**
 * A run of a page's or a note's blocks of text as one document (task 2g, ProseMirror): text is selected from one block
 * to another as in a document (Juan, 2026-10-30: «quiero poder seleccionar el texto de forma individual»), and typed,
 * deleted and composed (a phone's keyboard) as in one. Each block keeps its look and its controls (the «+», the handle,
 * a list's dot, a to-do's box, a toggle's arrow, a callout's icon), drawn here without React: a note of thousands of
 * blocks opens and types without a component per block (A-15). Every change is the page's blocks (`setPageBlocks`,
 * the store's undo and saving); the store's blocks come back in (an undo, a block turned into another kind) as the
 * nodes that changed. The keys that act on blocks (Enter, Backspace at a start, Tab, Markdown shortcuts) are
 * core/textKeys.ts's; paste is always plain text, made blocks when it has several lines. The text is the Markdown a
 * person writes, painted formatted (runFormat.ts, task 2f): what is saved is what was typed.
 */
import { blocksToMarkdown, markdownToBlocks } from "@boni/views";
import type { Node as PMNode, Slice } from "prosemirror-model";
import {
  EditorState,
  NodeSelection,
  Plugin,
  type Selection,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import { type ReactNode, useLayoutEffect, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import type { Page } from "../core/agent.ts";
import {
  blockOfNode,
  blocksOfDoc,
  docOf,
  isText,
  nodeOf,
  schema,
  spliceRun,
  type TextBlock,
} from "../core/docModel.ts";
import type { Where } from "../core/grid.ts";
import { plainText } from "../core/inline.ts";
import { chipTitle, pointAttrs } from "../core/pointing.ts";
import { indented, pastedInto, replacedBy } from "../core/selection.ts";
import {
  backspaceAtStart,
  emptyText,
  enterIn,
  indentOf,
  kindOf,
  shortcutTyped,
  tabIn,
} from "../core/textKeys.ts";
import { openUrl } from "../host.ts";
import {
  addFilesToPage,
  blockId,
  editingDoc,
  flushPage,
  flushRowBody,
  type HistoryMarks,
  onEditorLeaving,
  selectBlocks,
  setPageBlocks,
  setPageFocus,
  undoPage,
  useStore,
} from "../store.ts";
import { type Bubble, FormatBar } from "./FormatBar.tsx";
import { historyColor, whoLabel } from "./History.tsx";
import { AnchoredBox, PointMenu } from "./Popover.tsx";
import {
  FORMAT_EDIT,
  formatPlugin,
  formatSeen,
  formattable,
  linkAt,
  linkSelection,
  toggleFormat,
} from "./runFormat.ts";

type Block = Page["spec"]["blocks"][number];
type T = ReturnType<typeof useStore.getState>["t"];
/** Where a dragged block would land: above or below another, or beside it (a column of its own). */
export type Drag = { id: string; over: string | null; where: Where } | null;

/** What the page around a run gives it: its blocks, how they are shown, and the menus its controls open. */
export interface RunContext {
  page: Page;
  /** The page's blocks by id. */
  byId: ReadonlyMap<string, Block>;
  /** The ids of the blocks on screen, in the page's order (the blocks before and after a run). */
  order: readonly string[];
  numbers: ReadonlyMap<string, number>;
  selected: ReadonlySet<string>;
  /** A paragraph of a note: its words' key and which of the identical ones it is (pointing, `partsOf`). */
  parts: ReadonlyMap<string, { part: string; n: number }> | null;
  drag: Drag;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, where: Where) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  menus: RunMenus;
}
/** The page's own menus, drawn by it (PageView.tsx). */
export interface RunMenus {
  add: (block: Block, close: () => void) => ReactNode;
  block: (block: Block, close: () => void) => ReactNode;
  icon: (block: TextBlock, close: () => void) => ReactNode;
  slash: (block: TextBlock, query: string, onClose: () => void, keys: HTMLElement) => ReactNode;
  /** A block in the text that is not text: a file or a link to a page. */
  inText: (block: Block) => ReactNode;
  /** A block's kind as the page names it (its menu's name, its chip when pointed at). */
  name: (block: Block) => string;
}

/** What the run's React part draws: a menu, the «/» menu, the blocks that are not text. */
type Menu =
  | { kind: "add" | "block" | "icon"; id: string; anchor: HTMLElement }
  | { kind: "point"; id: string; x: number; y: number };

/** Clicks on these are a control's own (a button, a link), never the text's. */
const OWN = "button, a, input, select, textarea, label, [role='button']";
const DOTS = ["•", "◦", "▪"];
/** The page's blocks as the store holds them now. */
const blocksNow = (): Block[] => editingDoc()?.spec.blocks ?? [];

// Lucide's icons (ISC), drawn without React: the «+», the handle and a toggle's arrow.
const SVG = (inner: string, size: number, stroke: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const PLUS = SVG('<path d="M5 12h14"/><path d="M12 5v14"/>', 16, 1.8);
const GRIP = SVG(
  '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  16,
  1.8,
);
const CHEVRON = SVG('<path d="m9 18 6-6-6-6"/>', 16, 2);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

/** The run whose text has the caret (the phone's bar over the keyboard works on it, KeyboardBar.tsx). */
let active: RunCore | null = null;

/** The block with the caret and where in its text, in the editor that has it; null when no text has the caret. */
export function caretInText(): { id: string; at: number; text: string } | null {
  const c = active;
  if (!c?.view.hasFocus()) return null;
  const i = c.caret();
  return i && isText(i.block) ? { id: i.block.id, at: i.off, text: i.block.text } : null;
}
/**
 * The phone bar's «+» (KeyboardBar.tsx): in an empty block, «/» (its menu opens); else a new block after this one,
 * as Enter at its end, with «/» typed in it.
 */
export function addFromBar(): boolean {
  const c = active;
  if (!c?.view.hasFocus()) return false;
  const i = c.caret();
  if (!i || !isText(i.block)) return false;
  const view = c.view;
  if (!i.block.text) {
    view.dispatch(view.state.tr.insertText("/"));
    return true;
  }
  let end = 0;
  for (let k = 0; k < i.index; k++) end += view.state.doc.child(k).nodeSize;
  end += i.node.nodeSize - 1;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
  c.enter(false);
  // The new block takes the caret when the page is drawn again.
  setTimeout(() => {
    const now = active?.caret();
    if (active?.view.hasFocus() && now && isText(now.block) && !now.block.text)
      active.view.dispatch(active.view.state.tr.insertText("/"));
  }, 60);
  return true;
}

/** The live values the run's handlers read (the page as it was last drawn). */
interface Live {
  ctx: RunContext;
  t: T;
  marks: HistoryMarks | null;
  locale: string;
  /** The open page is this one (a block of it can be pointed at). */
  onPage: boolean;
  pageTitles: ReadonlyMap<string, string>;
}

/** A run's engine: its ProseMirror view, its blocks as last written, and what its React part draws. */
class RunCore {
  view: EditorView;
  live: Live;
  /** The blocks the document holds, as last written to the page or read from it. */
  emitted: Block[];
  views = new Set<BlockView>();
  menu: Menu | null = null;
  slash: { id: string; query: string } | null = null;
  slashOff: { id: string; text: string } | null = null;
  caretId: string | null = null;
  notify: () => void;
  /** The menu over selected text (FormatBar), drawn apart from the run: a selection moving draws only it. */
  bubble: Bubble | null = null;
  bubbleSeen: () => void;
  /** A pointer is down in the text: the menu waits for it to lift (a selection being dragged). */
  held = false;
  /**
   * What every block's drawing depends on beyond the block itself, as last drawn: a new object when any of it changed.
   * A key typed changes none of it, so only the block typed in is drawn again (A-15: a note of thousands of lines).
   */
  stamp: object = {};
  private stampOf: unknown[] = [];
  /** A new stamp when what the blocks are drawn from changed since the last time. */
  restamp() {
    const l = this.live;
    const now = [
      l.ctx.page.id,
      l.ctx.selected,
      l.ctx.drag,
      l.t,
      l.marks,
      l.locale,
      l.onPage,
      l.pageTitles,
      this.menu,
      this.caretId,
    ];
    if (now.some((x, i) => x !== this.stampOf[i])) {
      this.stampOf = now;
      this.stamp = {};
    }
  }

  constructor(
    mount: HTMLElement,
    blocks: Block[],
    live: Live,
    notify: () => void,
    bubbleSeen: () => void,
  ) {
    this.live = live;
    this.notify = notify;
    this.bubbleSeen = bubbleSeen;
    this.emitted = blocks;

    const state = EditorState.create({
      schema,
      doc: docOf(blocks),
      plugins: [freshIds, formatPlugin],
    });
    this.view = new EditorView(
      { mount },
      {
        state,
        // One text field for assistive technology, named as the textareas it replaces were.
        attributes: () => ({
          class: "doc-run",
          translate: "no",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": this.live.t("block.kind.text"),
        }),
        nodeViews: {
          blk: (n, v, g) => new BlockView(n, v, g, this),
          atom: (n, v, g) => new BlockView(n, v, g, this),
        },
        dispatchTransaction: (tr) => this.apply(tr),
        handleKeyDown: (_v, e) => this.key(e),
        handlePaste: (_v, e) => this.paste(e),
        // A backtick over selected words makes them code (Ctrl+E is Boni's window).
        handleTextInput: (v, from, to, text) =>
          text === "`" && from < to && formattable(v.state) ? toggleFormat(v, "code") : false,
        // Ctrl+click (Cmd on a Mac) opens a link, as in an editor of code; a click alone puts the caret in it.
        handleClick: (v, pos, e) => {
          if (!(e.ctrlKey || e.metaKey)) return false;
          const at = linkAt(v.state, pos, pos);
          const href = at?.span.href;
          if (!href) return false;
          void openUrl(href);
          return true;
        },
        handleDrop: (v, e, _s, moved) => this.drop(v, e as DragEvent, moved),
        clipboardTextSerializer: (slice) => copied(slice),
        handleDOMEvents: {
          beforeinput: (_v, e) => {
            // The window's own undo (its menu, a phone's shake) is the page's undo.
            const type = (e as InputEvent).inputType;
            if (type !== "historyUndo" && type !== "historyRedo") return false;
            e.preventDefault();
            undoPage(type === "historyRedo");
            return true;
          },
          focus: (v) => {
            active = this;
            onEditorLeaving(() => this.readScreen());
            formatSeen(v, { focused: true });
            this.selectionChanged();
            return false;
          },
          pointerdown: (v, e) => {
            if ((e as PointerEvent).button !== 0) return false;
            this.held = true;
            formatSeen(v, { held: true });
            const up = () => {
              window.removeEventListener("pointerup", up, true);
              window.removeEventListener("pointercancel", up, true);
              this.held = false;
              // After the engine has read where the pointer left the selection.
              setTimeout(() => {
                formatSeen(v, { held: false });
                this.selectionChanged();
              }, 0);
            };
            window.addEventListener("pointerup", up, true);
            window.addEventListener("pointercancel", up, true);
            return false;
          },
          compositionend: (v) => {
            setTimeout(() => {
              formatSeen(v, { redraw: true });
              this.selectionChanged();
            }, 0);
            return false;
          },
          blur: (v, e) => {
            if (active === this) onEditorLeaving(null);
            formatSeen(v, { focused: false });
            // The text left for anything but more of it (a title, a property, another screen) is saved now, as a
            // field is when it is left; nothing waits for the timer (D-65).
            const to = (e as FocusEvent).relatedTarget;
            if (!(to instanceof Element && to.closest(".doc-run"))) {
              this.readScreen();
              void flushPage();
              void flushRowBody();
            }
            setTimeout(() => this.selectionChanged(), 0);
            return false;
          },
        },
      },
    );
    unseenByReact(this.view.dom);
  }

  destroy() {
    if (active === this) {
      active = null;
      onEditorLeaving(null);
    }
    this.view.destroy();
  }

  /** What the screen shows and the engine has not read yet (a word being composed) is read now. */
  readScreen() {
    try {
      (this.view as unknown as { domObserver: { flush(): void } }).domObserver.flush();
    } catch {
      // Nothing waiting.
    }
  }

  apply(tr: Transaction) {
    const before = this.view.state;
    const state = before.apply(tr);
    this.view.updateState(state);
    if (state.doc !== before.doc) {
      if (tr.getMeta(FROM_PAGE)) this.emitted = blocksOfDoc(state.doc);
      else this.write(state, tr.getMeta(FORMAT_EDIT) === true);
    }
    this.selectionChanged();
  }

  /** The document changed by typing (or by a format: a step of Undo of its own): the page's blocks written back. */
  write(state: EditorState, format = false) {
    const next = blocksOfDoc(state.doc);
    const old = this.emitted;
    this.emitted = next;
    const doc = editingDoc();
    if (!doc) return;
    const full = spliceRun(
      doc.spec.blocks,
      old.map((b) => b.id),
      next,
    );
    // Markdown just typed at a line's start turns the block into another kind (not while a word is composed).
    if (format) {
      setPageBlocks(full);
      return;
    }
    if (!this.view.composing && next.length === old.length) {
      const i = next.findIndex((b, k) => b !== old[k]);
      const was = old[i];
      const now = next[i];
      if (i >= 0 && was && now && isText(was) && next.every((b, k) => k === i || b === old[k])) {
        const edit = shortcutTyped(full, full.indexOf(now), was.text, blockId);
        if (edit) {
          setPageBlocks(edit.blocks);
          if (edit.focus) setPageFocus(edit.focus);
          return;
        }
      }
    }
    setPageBlocks(full, this.caret()?.block.id);
  }

  /** The page's blocks for this run, as the store has them: the document takes the ones that changed. */
  sync(blocks: Block[]) {
    const old = this.emitted;
    if (old.length === blocks.length && old.every((b, i) => b === blocks[i])) return;
    const min = Math.min(old.length, blocks.length);
    let s = 0;
    while (s < min && old[s] === blocks[s]) s++;
    let e = 0;
    while (e < min - s && old[old.length - 1 - e] === blocks[blocks.length - 1 - e]) e++;
    const state = this.view.state;
    const doc = state.doc;
    let from = 0;
    for (let i = 0; i < s; i++) from += doc.child(i).nodeSize;
    let to = from;
    for (let i = s; i < old.length - e; i++) to += doc.child(i).nodeSize;
    const kept = this.place(state.selection);
    const tr = state.tr.replaceWith(from, to, blocks.slice(s, blocks.length - e).map(nodeOf));
    if (kept) {
      const sel = this.at(tr.doc, kept);
      if (sel) tr.setSelection(sel);
    }
    tr.setMeta(FROM_PAGE, true);
    tr.setMeta("addToHistory", false);
    this.view.dispatch(tr);
  }

  /** A selection as blocks and places in their text: it stays where it was when the blocks around it change. */
  place(sel: Selection) {
    if (!(sel instanceof TextSelection)) return null;
    const side = (pos: number) => {
      const $p = sel.$anchor.doc.resolve(pos);
      if ($p.depth < 1) return null;
      return { id: String($p.node(1).attrs.id), off: $p.parentOffset };
    };
    const anchor = side(sel.anchor);
    const head = side(sel.head);
    return anchor && head ? { anchor, head } : null;
  }
  at(doc: PMNode, kept: NonNullable<ReturnType<RunCore["place"]>>) {
    const find = (p: { id: string; off: number }) => {
      let found: number | null = null;
      doc.forEach((n, pos) => {
        if (found === null && n.attrs.id === p.id && n.isTextblock)
          found = pos + 1 + Math.min(p.off, n.content.size);
      });
      return found;
    };
    const a = find(kept.anchor);
    const h = find(kept.head);
    return a !== null && h !== null ? TextSelection.create(doc, a, h) : null;
  }

  /** The caret's block (the head of a selection), its index in the run and its place in its text. */
  caret() {
    const sel = this.view.state.selection;
    const doc = this.view.state.doc;
    if (sel instanceof NodeSelection && sel.$from.depth === 0) {
      const index = sel.$from.index(0);
      return { index, node: sel.node, block: blockOfNode(sel.node), off: 0 };
    }
    const $h = sel.$head;
    if ($h.depth < 1) return null;
    const index = $h.index(0);
    const node = doc.child(index);
    return { index, node, block: blockOfNode(node), off: $h.parentOffset };
  }

  /** The ids of the blocks a selection touches, in order. */
  touched(): string[] {
    const { from, to } = this.view.state.selection;
    const ids: string[] = [];
    this.view.state.doc.forEach((n, pos) => {
      if (pos + n.nodeSize > from && pos <= to) ids.push(String(n.attrs.id));
    });
    return ids;
  }

  /** The block on screen before or after one (in another run, or none). */
  near(id: string, dir: -1 | 1): Block | undefined {
    const order = this.live.ctx.order;
    const i = order.indexOf(id);
    const other = i < 0 ? undefined : order[i + dir];
    return other ? this.live.ctx.byId.get(other) : undefined;
  }

  /** Leaves the text with blocks selected (Esc, Ctrl+A twice, Shift+arrows past the run). */
  selectBlocks(from: string, to: string) {
    this.view.dom.blur();
    selectBlocks(from, to);
  }

  selectionChanged() {
    const focused = this.view.hasFocus();
    const i = this.caret();
    const id = focused && i ? i.block.id : null;
    if (id !== this.caretId) {
      const was = this.caretId;
      this.caretId = id;
      for (const v of this.views) if (v.block.id === was || v.block.id === id) v.refresh();
    }
    // The «/» menu: in the block with the caret, while its text is «/» and what filters it.
    let slash: RunCore["slash"] = null;
    const b = i?.block;
    if (focused && b && isText(b) && this.view.state.selection.empty)
      if (b.type !== "code" && b.text.startsWith("/") && !b.text.includes("\n"))
        if (this.slashOff?.id !== b.id || this.slashOff.text !== b.text)
          slash = { id: b.id, query: b.text.slice(1) };
    if (slash?.id !== this.slash?.id || slash?.query !== this.slash?.query) {
      this.slash = slash;
      this.notify();
    }
    // The menu over selected text, or over the link the caret is in; kept while its field for an address is open.
    if (this.bubble?.editing) {
      this.bubbleSeen();
      return;
    }
    const s = this.view.state;
    const mode =
      !focused || this.held || this.view.composing || slash
        ? null
        : formattable(s)
          ? "format"
          : s.selection.empty && linkAt(s)
            ? "link"
            : null;
    const next: Bubble | null = mode ? { mode, editing: false } : null;
    if (next || this.bubble) {
      this.bubble = next;
      this.bubbleSeen();
    }
  }

  /** The field for a link's address opened (Ctrl+K, the menu's button) or closed. */
  editLink(on: boolean) {
    if (on) {
      const s = this.view.state;
      const mode = formattable(s) ? "format" : linkAt(s)?.span.kind === "link" ? "link" : null;
      if (!mode) return;
      this.bubble = { mode, editing: true };
      this.bubbleSeen();
      return;
    }
    this.bubble = null;
    this.selectionChanged();
  }

  /** The keys that act on blocks; the rest are the text's own. */
  key(e: KeyboardEvent): boolean {
    if (e.isComposing || e.keyCode === 229) return false;
    // The «/» menu follows these (its own listener, after this one).
    if (this.slash && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) return true;
    // Right after a click or an arrow the editor may not have read where the caret went yet.
    this.readScreen();
    const view = this.view;
    const sel = view.state.selection;
    const mod = e.ctrlKey || e.metaKey;
    const i = this.caret();
    if (!i) return false;
    const b = i.block;
    const first = i.index === 0;
    const last = i.index === view.state.doc.childCount - 1;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      // Bold, italic, strikethrough (Ctrl+Shift+X, as Slack's: Ctrl+Shift+S is a browser's screenshot) and a link
      // (Ctrl+K with words selected or the caret in a link; otherwise it is the search). Ctrl+U has no Markdown.
      const wrap =
        !e.shiftKey && k === "b"
          ? "strong"
          : !e.shiftKey && k === "i"
            ? "em"
            : e.shiftKey && k === "x"
              ? "strike"
              : null;
      if (wrap) return toggleFormat(view, wrap);
      if (!e.shiftKey && k === "u") return true;
      if (!e.shiftKey && k === "k") {
        if (!formattable(view.state) && linkAt(view.state)?.span.kind !== "link") return false;
        this.editLink(true);
        return true;
      }
    }
    switch (e.key) {
      case "Tab": {
        const ids = this.touched();
        const full = blocksNow();
        if (ids.length > 1) setPageBlocks(indented(full, ids, e.shiftKey ? -1 : 1));
        else {
          const next = tabIn(full, full.indexOf(b), this.near(b.id, -1), e.shiftKey);
          if (next) setPageBlocks(next);
        }
        return true;
      }
      case "Enter":
        if (e.altKey) return false;
        if (e.shiftKey && !mod) {
          if (isText(b)) view.dispatch(view.state.tr.insertText("\n").scrollIntoView());
          return true;
        }
        if (isText(b) && b.type === "code" && !mod) {
          view.dispatch(view.state.tr.insertText("\n").scrollIntoView());
          return true;
        }
        return this.enter(true);
      case "Backspace":
        if (!sel.empty) {
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
          return true;
        }
        if (i.off > 0 || mod || e.altKey || !isText(b)) return false;
        {
          const full = blocksNow();
          const edit = backspaceAtStart(full, full.indexOf(b), this.near(b.id, -1));
          if (edit) {
            setPageBlocks(edit.blocks);
            if (edit.focus) setPageFocus(edit.focus);
          }
        }
        return true;
      case "Delete":
        if (!sel.empty) {
          view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
          return true;
        }
        if (!isText(b) || i.off < i.node.content.size || mod || e.altKey) return false;
        {
          // At a block's end, the next text block comes up into it.
          const next = this.near(b.id, 1);
          if (next && isText(next)) {
            const joined = { ...b, text: b.text + next.text } as TextBlock;
            setPageBlocks(
              blocksNow().flatMap((x) => (x.id === next.id ? [] : x.id === b.id ? [joined] : [x])),
            );
            setPageFocus({ block: b.id, at: b.text.length });
          }
        }
        return true;
      case "Escape": {
        // Out of the text, the blocks it was in selected (as Notion's): the next Esc lets go of them.
        const ids = this.touched();
        this.selectBlocks(ids[0] ?? b.id, ids[ids.length - 1] ?? b.id);
        return true;
      }
      case "a":
      case "A": {
        if (!mod || e.altKey || e.shiftKey) return false;
        const start = view.state.doc.resolve(sel.from);
        const end = view.state.doc.resolve(sel.to);
        const inOne = start.depth >= 1 && end.depth >= 1 && start.index(0) === end.index(0);
        const whole = inOne && sel.from === start.start(1) && sel.to === start.end(1);
        if (isText(b) && inOne && !whole) {
          // Ctrl+A: the block's text; a second time, every block of the page.
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, start.start(1), start.end(1)),
            ),
          );
          return true;
        }
        const order = this.live.ctx.order;
        if (order.length) this.selectBlocks(order[0] as string, order[order.length - 1] as string);
        return true;
      }
      case "ArrowUp":
      case "ArrowLeft":
      case "ArrowDown":
      case "ArrowRight": {
        if (mod || e.altKey) return false;
        const up = e.key === "ArrowUp" || e.key === "ArrowLeft";
        const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
        if (!(up ? first : last)) return false;
        const edge = vertical
          ? view.endOfTextblock(up ? "up" : "down")
          : sel.empty && (up ? i.off === 0 : i.off === i.node.content.size);
        if (!edge || (e.shiftKey && !vertical)) return false;
        const other = this.near(b.id, up ? -1 : 1);
        if (e.shiftKey) {
          // Past the run's first or last line with Shift: whole blocks, from where the selection began.
          const from = this.place(sel)?.anchor.id ?? b.id;
          this.selectBlocks(from, other?.id ?? b.id);
          return true;
        }
        if (!other) return false;
        if (isText(other)) setPageFocus({ block: other.id, at: up ? "end" : "start" });
        else this.selectBlocks(other.id, other.id);
        return true;
      }
    }
    return false;
  }

  /** Enter: the block goes on in the next one (what is selected is deleted first). */
  enter(byKey: boolean): boolean {
    const view = this.view;
    const sel = view.state.selection;
    if (sel instanceof NodeSelection) {
      // On a block that is not text: a line of text after it.
      const full = blocksNow();
      const b = blockOfNode(sel.node);
      const made = emptyText(blockId(), indentOf(b));
      const at = full.indexOf(b);
      setPageBlocks([...full.slice(0, at + 1), made, ...full.slice(at + 1)]);
      setPageFocus({ block: made.id, at: "start" });
      return true;
    }
    if (!sel.empty) view.dispatch(view.state.tr.deleteSelection());
    const i = this.caret();
    if (!i || !isText(i.block)) return byKey;
    const full = blocksNow();
    const edit = enterIn(full, full.indexOf(i.block), i.off, blockId);
    if (!edit) return byKey;
    setPageBlocks(edit.blocks);
    if (edit.focus) setPageFocus(edit.focus);
    return true;
  }

  /** Paste: files are kept and shown here; text is always plain, and several lines make blocks. */
  paste(e: ClipboardEvent): boolean {
    const data = e.clipboardData;
    if (!data) return false;
    this.readScreen();
    const view = this.view;
    const i = this.caret();
    const files = [...data.files];
    if (files.length) {
      void addFilesToPage(files, i?.block.id ?? null);
      return true;
    }
    const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
    if (!text) return true;
    if (!i) return true;
    // An address pasted over words makes them its link.
    const web = text.trim();
    if (/^https?:\/\/\S+$/i.test(web) && formattable(view.state) && linkSelection(view, web))
      return true;
    if (i.block.type === "code" || !text.includes("\n")) {
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
      return true;
    }
    const incoming = markdownToBlocks(text);
    if (view.state.selection instanceof NodeSelection) {
      setPageBlocks(replacedBy(blocksNow(), [i.block.id], incoming, blockId));
      return true;
    }
    if (!view.state.selection.empty) view.dispatch(view.state.tr.deleteSelection());
    const at = this.caret();
    const r =
      at &&
      pastedInto(blocksNow(), { id: at.block.id, start: at.off, end: at.off }, incoming, blockId);
    if (!r) {
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
      return true;
    }
    setPageBlocks(r.blocks);
    setPageFocus(r.focus);
    return true;
  }

  /** A drop: a block being moved and files are the page's; text from outside goes in as plain text. */
  drop(view: EditorView, e: DragEvent, moved: boolean): boolean {
    if (this.live.ctx.drag) return true;
    const dt = e.dataTransfer;
    if (!dt) return false;
    if (dt.files.length) return true;
    if (moved) return false;
    const text = dt.getData("text/plain").replace(/\r\n?/g, "\n");
    const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!text || !at) return true;
    const $p = view.state.doc.resolve(at.pos);
    if (!$p.parent.isTextblock) return true;
    view.dispatch(view.state.tr.insertText(text, at.pos));
    return true;
  }

  openMenu(m: Menu | null) {
    const was = this.menu?.id;
    this.menu = m;
    for (const v of this.views) if (v.block.id === was || v.block.id === m?.id) v.refresh();
    this.notify();
  }

  /** The block with this id drawn now, if it is in this run. */
  viewOf(id: string): BlockView | undefined {
    for (const v of this.views) if (v.block.id === id) return v;
    return undefined;
  }

  /** The caret asked for a block of this run (a key that made or joined blocks, a click below the text). */
  takeFocus(f: { block: string; at: "start" | "end" | number }): boolean {
    const doc = this.view.state.doc;
    let target: { pos: number; node: PMNode } | null = null;
    doc.forEach((n, pos) => {
      if (!target && n.attrs.id === f.block) target = { pos, node: n };
    });
    if (!target) return false;
    const { pos, node } = target as { pos: number; node: PMNode };
    const tr = this.view.state.tr;
    if (node.isTextblock) {
      const size = node.content.size;
      const off = f.at === "start" ? 0 : f.at === "end" ? size : Math.max(0, Math.min(size, f.at));
      tr.setSelection(TextSelection.create(doc, pos + 1 + off));
    } else tr.setSelection(NodeSelection.create(doc, pos));
    this.view.focus();
    this.view.dispatch(tr.scrollIntoView());
    return true;
  }
}

/** A transaction that brings the page's blocks in: nothing to write back. */
const FROM_PAGE = "boni-from-page";

/** Every block of the document has an id of its own: one the engine made, or one copied, gets a new one. */
const freshIds = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some((t) => t.docChanged)) return null;
    const seen = new Set<string>();
    let tr: Transaction | null = null;
    state.doc.forEach((n, pos) => {
      const id = n.attrs.id as string | null;
      if (id && !seen.has(id)) {
        seen.add(id);
        return;
      }
      const fresh = blockId();
      seen.add(fresh);
      const b = n.attrs.block as Block | null;
      tr ??= state.tr;
      tr.setNodeMarkup(pos, undefined, { id: fresh, block: b ? { ...b, id: fresh } : null });
    });
    return tr;
  },
});

/** What a copy of text says as plain text: the words inside one block, the blocks' Markdown across several. */
function copied(slice: Slice): string {
  const c = slice.content;
  const one = c.firstChild;
  if (c.childCount === 1 && one?.isTextblock && slice.openStart > 0) return one.textContent;
  const out: Block[] = [];
  c.forEach((n) => {
    out.push(blockOfNode(n));
  });
  return blocksToMarkdown(out);
}

/** A block in the run, drawn as the page's blocks are (its controls, its marker, its text). */
class BlockView implements NodeView {
  dom: HTMLDivElement;
  contentDOM?: HTMLElement;
  node: PMNode;
  block: Block;
  /** Where the block that is not text is drawn by React (a file, a link to a page). */
  host: HTMLElement | null = null;
  /** Where the «/» menu is drawn, under the text. */
  under: HTMLElement | null = null;
  private core: RunCore;
  private gutter: HTMLElement;
  private addBtn: HTMLButtonElement;
  private menuBtn: HTMLButtonElement;
  private body: HTMLElement | null = null;
  private marker: HTMLElement | null = null;
  private markerFor = "";
  private who: HTMLElement | null = null;
  /** What it was last drawn from (`draw`). */
  private seen: { block: Block | null; stamp: object | null; own: string } = {
    block: null,
    stamp: null,
    own: "",
  };
  private drawn = {
    cls: "",
    indent: -1,
    who: "",
    whoText: "",
    point: "",
    t: null as T | null,
    kind: "",
    open: "",
  };

  constructor(node: PMNode, _view: EditorView, _getPos: () => number | undefined, core: RunCore) {
    this.core = core;
    this.node = node;
    this.block = blockOfNode(node);
    const dom = el("div");
    this.dom = dom;
    const gutter = el("div", "blk-gutter");
    gutter.contentEditable = "false";
    const add = el("button", "blk-btn");
    add.type = "button";
    add.innerHTML = PLUS;
    add.setAttribute("aria-haspopup", "true");
    add.setAttribute("aria-expanded", "false");
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = core.menu?.kind === "add" && core.menu.id === this.block.id;
      core.openMenu(open ? null : { kind: "add", id: this.block.id, anchor: add });
    });
    const handle = el("span", "blk-handle");
    handle.draggable = true;
    const menu = el("button", "blk-btn");
    menu.type = "button";
    menu.innerHTML = GRIP;
    menu.setAttribute("aria-haspopup", "true");
    menu.setAttribute("aria-expanded", "false");
    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = core.menu?.kind === "block" && core.menu.id === this.block.id;
      core.openMenu(open ? null : { kind: "block", id: this.block.id, anchor: menu });
    });
    handle.append(menu);
    handle.addEventListener("dragstart", (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", this.block.id);
      core.live.ctx.onDragStart(this.block.id);
    });
    handle.addEventListener("dragend", () => core.live.ctx.onDragEnd());
    gutter.append(add, handle);
    this.gutter = gutter;
    this.addBtn = add;
    this.menuBtn = menu;
    dom.append(gutter);
    if (node.isTextblock) {
      const body = el("div", "blk-body");
      const input = el("div", "blk-input");
      body.append(input);
      dom.append(body);
      this.body = body;
      this.contentDOM = input;
    } else {
      const host = el("div", "blk-in-text");
      host.contentEditable = "false";
      if (this.block.type === "divider") host.append(el("hr", "doc-divider"));
      dom.append(host);
      this.host = host;
      dom.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        core.openMenu({ kind: "point", id: this.block.id, x: e.clientX, y: e.clientY });
      });
    }
    dom.addEventListener("dragover", (e) => {
      if (!core.live.ctx.drag) return;
      e.preventDefault();
      const r = dom.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      // The sides make a column beside it; above or below it, the same column.
      const where: Where =
        fx < 0.15
          ? "left"
          : fx > 0.85
            ? "right"
            : e.clientY > r.top + r.height / 2
              ? "below"
              : "above";
      core.live.ctx.onDragOver(this.block.id, where);
    });
    dom.addEventListener("drop", (e) => {
      if (!core.live.ctx.drag) return;
      e.preventDefault();
      core.live.ctx.onDrop();
    });
    core.views.add(this);
    this.draw();
    if (this.host && this.block.type !== "divider") core.notify();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const b = blockOfNode(node);
    // A block in the text that became another (a divider, a file) is drawn anew.
    if (!node.isTextblock && b.type !== this.block.type) return false;
    this.node = node;
    if (b !== this.block) {
      const atom = !node.isTextblock;
      this.block = b;
      this.draw();
      if (atom) this.core.notify();
    }
    return true;
  }

  /** The block's marker and its text's hints, as its kind and its data say; nothing when none of it changed. */
  draw() {
    const b = this.block;
    const ctx = this.core.live.ctx;
    const part = ctx.parts?.get(b.id);
    const own = `${b.type === "numbered" ? (ctx.numbers.get(b.id) ?? 1) : ""}|${part ? `${part.part}/${part.n}` : ""}`;
    if (this.seen.block === b && this.seen.stamp === this.core.stamp && this.seen.own === own)
      return;
    this.seen = { block: b, stamp: this.core.stamp, own };
    if (this.body && this.contentDOM && isText(b)) {
      const t = this.core.live.t;
      const kind = kindOf(b);
      const indent = indentOf(b);
      const want = `${b.type}|${indent}|${b.type === "todo" ? Boolean(b.done) : ""}|${
        b.type === "toggle" ? Boolean(b.open) : ""
      }|${b.type === "callout" ? b.icon : ""}|${t === this.drawn.t}`;
      if (want !== this.markerFor) {
        this.markerFor = want;
        this.marker?.remove();
        this.marker = this.makeMarker(b, t);
        if (this.marker) this.body.prepend(this.marker);
        this.body.className = `blk-body${b.type === "callout" ? " callout" : ""}`;
        this.contentDOM.dataset.placeholder =
          kind === "text" ? t("block.placeholder") : t(`block.kind.${kind}`);
        this.contentDOM.spellcheck = b.type !== "code";
      }
    }
    this.refresh();
  }

  private makeMarker(b: TextBlock, t: T): HTMLElement | null {
    const core = this.core;
    const put = (next: Block) => setPageBlocks(blocksNow().map((x) => (x.id === b.id ? next : x)));
    if (b.type === "bullet") {
      const m = el("span", "blk-mark");
      m.setAttribute("aria-hidden", "true");
      m.contentEditable = "false";
      m.textContent = DOTS[indentOf(b) % DOTS.length] as string;
      return m;
    }
    if (b.type === "numbered") {
      const m = el("span", "blk-mark num");
      m.setAttribute("aria-hidden", "true");
      m.contentEditable = "false";
      return m;
    }
    if (b.type === "todo") {
      const m = el("input", "blk-check");
      m.type = "checkbox";
      m.checked = Boolean(b.done);
      m.setAttribute("aria-label", t("block.done"));
      m.addEventListener("change", () => {
        const now = this.block;
        if (now.type === "todo") put({ ...now, done: m.checked });
      });
      return m;
    }
    if (b.type === "toggle") {
      const m = el("button", `blk-fold${b.open ? " open" : ""}`);
      m.type = "button";
      m.contentEditable = "false";
      m.innerHTML = CHEVRON;
      m.setAttribute("aria-expanded", String(Boolean(b.open)));
      m.setAttribute("aria-label", b.open ? t("block.fold") : t("block.unfold"));
      m.addEventListener("click", () => {
        const now = this.block;
        if (now.type === "toggle") put({ ...now, open: !now.open });
      });
      return m;
    }
    if (b.type === "callout") {
      const m = el("button", "blk-callout-icon");
      m.type = "button";
      m.contentEditable = "false";
      m.textContent = b.icon || "💡";
      m.title = t("page.iconChange");
      m.setAttribute("aria-label", t("page.iconChange"));
      m.setAttribute("aria-haspopup", "true");
      m.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = core.menu?.kind === "icon" && core.menu.id === this.block.id;
        core.openMenu(open ? null : { kind: "icon", id: this.block.id, anchor: m });
      });
      return m;
    }
    return null;
  }

  /** What the page says of the block now: selected, dragged, its number, who wrote it, how it is pointed at. */
  refresh() {
    const core = this.core;
    const live = core.live;
    const ctx = live.ctx;
    const b = this.block;
    const id = b.id;
    const kind = isText(b) ? kindOf(b) : b.type;
    const drag = ctx.drag;
    const target = drag && drag.over === id && drag.id !== id ? drag.where : null;
    const mark = live.marks?.blocks[id];
    const focusWho = live.marks?.focus ?? null;
    const lit = mark && (!focusWho || focusWho === mark.by) ? mark : null;
    const menuOpen = core.menu?.id === id;
    const cls = `blk blk-${kind}${ctx.selected.has(id) ? " selected" : ""}${menuOpen ? " menu-open" : ""}${
      drag?.id === id ? " dragging" : ""
    }${target ? ` drop-${target}` : ""}${lit ? " by-who" : ""}${core.caretId === id ? " caret" : ""}${
      isText(b) && !b.text ? " empty" : ""
    }`;
    const d = this.drawn;
    if (cls !== d.cls) {
      this.dom.className = cls;
      d.cls = cls;
    }
    if (this.dom.dataset.block !== id) this.dom.dataset.block = id;
    const indent = indentOf(b);
    if (indent !== d.indent) {
      this.dom.style.marginLeft = indent ? `${indent * 26}px` : "";
      d.indent = indent;
    }
    // With History open, the block in the colour of who wrote it last (Juan, 2026-10-30).
    const whoText = lit ? whoLabel(live.t, lit, live.locale) : "";
    const who = lit ? historyColor(lit.by) : "";
    if (who !== d.who || whoText !== d.whoText) {
      if (who) this.dom.style.setProperty("--who", who);
      else this.dom.style.removeProperty("--who");
      if (lit && !this.who) {
        this.who = el("span", "blk-who");
        this.who.contentEditable = "false";
        this.dom.prepend(this.who);
      }
      if (this.who) {
        if (lit) this.who.textContent = whoText;
        else {
          this.who.remove();
          this.who = null;
        }
      }
      d.who = who;
      d.whoText = whoText;
    }
    if (b.type === "numbered" && this.marker) {
      const n = `${ctx.numbers.get(id) ?? 1}.`;
      if (this.marker.textContent !== n) this.marker.textContent = n;
    }
    if (d.t !== live.t || d.kind !== kind) {
      const t = live.t;
      const name = ctx.menus.name(b);
      this.addBtn.title = t("block.add");
      this.addBtn.setAttribute("aria-label", t("block.add"));
      this.menuBtn.title = `${t("block.menu")}: ${name}`;
      this.menuBtn.setAttribute("aria-label", `${t("block.menu")}: ${name}`);
      d.t = live.t;
      d.kind = kind;
    }
    // Written only when it changes: a long note's thousands of blocks are refreshed on every key (A-15).
    const open = menuOpen ? (core.menu?.kind ?? "") : "";
    if (open !== d.open) {
      this.addBtn.classList.toggle("active", open === "add");
      this.addBtn.setAttribute("aria-expanded", String(open === "add"));
      this.menuBtn.classList.toggle("active", open === "block");
      this.menuBtn.setAttribute("aria-expanded", String(open === "block"));
      d.open = open;
    }
    this.point();
  }

  /**
   * How the block can be pointed at for Boni (F9, `Ctrl+Shift+E`), by reference: a paragraph of a note by its words'
   * key and which of the identical ones it is, a block of a page by its id; a line says nothing. Worked out again only
   * when the block or its place among the identical ones changes.
   */
  private point() {
    const live = this.core.live;
    const ctx = live.ctx;
    const b = this.block;
    const note = ctx.page.id.startsWith("row:") ? ctx.page.id.slice(4) : null;
    const part = note && isText(b) ? ctx.parts?.get(b.id) : null;
    const key = `${part ? `${part.part}/${part.n}` : ""}|${live.onPage}|${
      b.type === "page" ? (live.pageTitles.get(b.page) ?? "") : ""
    }`;
    if (this.drawn.point === key && this.pointFor === b && this.pointT === live.t) return;
    this.pointFor = b;
    this.pointT = live.t;
    this.drawn.point = key;
    const t = live.t;
    const attrs =
      note && part && isText(b)
        ? pointAttrs(
            { kind: "part", id: note, ...part },
            chipTitle(t("point.kind.part"), plainText(b.text)),
          )
        : live.onPage && b.type !== "divider"
          ? pointAttrs(
              { kind: "block", page: ctx.page.id, block: b.id },
              chipTitle(
                ctx.menus.name(b),
                isText(b)
                  ? plainText(b.text)
                  : b.type === "file"
                    ? b.name
                    : b.type === "page"
                      ? (live.pageTitles.get(b.page) ?? "")
                      : "",
              ),
            )
          : null;
    if (attrs) {
      this.dom.setAttribute("data-boni-ref", attrs["data-boni-ref"]);
      this.dom.setAttribute("data-boni-title", attrs["data-boni-title"]);
    } else {
      this.dom.removeAttribute("data-boni-ref");
      this.dom.removeAttribute("data-boni-title");
    }
  }
  private pointFor: Block | null = null;
  private pointT: T | null = null;

  stopEvent(e: Event): boolean {
    const target = e.target as Node | null;
    if (!target) return false;
    if (this.gutter.contains(target) || this.who?.contains(target)) return true;
    if (this.marker?.contains(target)) return true;
    if (this.under?.contains(target)) return true;
    if (this.host?.contains(target)) return !!(target as Element).closest?.(OWN);
    return false;
  }

  ignoreMutation(m: MutationRecord | { type: "selection"; target: Node }): boolean {
    if (m.type === "selection") return false;
    const c = this.contentDOM;
    if (!c) return true;
    if (m.target === c && m.type === "attributes") return true;
    return !c.contains(m.target);
  }

  /** Where the «/» menu is drawn, made the first time it is needed. */
  slot(): HTMLElement | null {
    if (!this.body) return null;
    if (!this.under) {
      this.under = el("div", "blk-under");
      this.under.contentEditable = "false";
      this.body.append(this.under);
    }
    return this.under;
  }

  destroy() {
    this.core.views.delete(this);
    if (this.host && this.block.type !== "divider") this.core.notify();
  }
}

/**
 * Around every commit React reads the selection of the focused editable field by walking all its text
 * (`getSelectionInformation`), to put it back if the focus moved: in a long note that is every key, thousands of nodes
 * (A-15: 3,000 paragraphs, 9 ms a letter). The run's selection is the engine's own, so React is told the run is not an
 * editable field: its `contentEditable` property answers "inherit" (the attribute, what the browser edits by, stays
 * "true"). Nothing of the app reads the property; they ask `isContentEditable`.
 */
function unseenByReact(dom: HTMLElement) {
  Object.defineProperty(dom, "contentEditable", {
    configurable: true,
    get: () => "inherit",
    set: (v: string) => dom.setAttribute("contenteditable", v),
  });
}

/**
 * A run of text blocks on the page: `ids` are its blocks on screen, in order. The run's document follows the page's
 * blocks (an undo, a block turned into another kind, a block added from a menu) and writes them as text is typed.
 */
export function TextRun({ ids, ctx }: { ids: readonly string[]; ctx: RunContext }) {
  const host = useRef<HTMLDivElement>(null);
  const core = useRef<RunCore | null>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const bubbles = useRef(new Set<() => void>()).current;
  const t = useStore((s) => s.t);
  const marks = useStore((s) => s.historyMarks);
  const locale = useStore((s) => (s.settings.language === "en" ? "en-GB" : "es-ES"));
  const onPage = useStore((s) => s.page?.id === ctx.page.id);
  const pages = useStore((s) => s.pages);
  const focus = useStore((s) => s.pageFocus);
  const pageTitles = useRef<{ from: unknown; map: Map<string, string> }>({
    from: null,
    map: new Map(),
  });
  if (pageTitles.current.from !== pages)
    pageTitles.current = { from: pages, map: new Map((pages ?? []).map((p) => [p.id, p.title])) };
  const blocks = ids.map((id) => ctx.byId.get(id)).filter((b): b is Block => !!b);
  const live: Live = { ctx, t, marks, locale, onPage, pageTitles: pageTitles.current.map };

  useLayoutEffect(() => {
    if (!host.current) return;
    const c = new RunCore(host.current, blocks, live, redraw, () => {
      for (const f of bubbles) f();
    });
    core.current = c;
    return () => {
      c.destroy();
      core.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const c = core.current;
    if (!c) return;
    c.live = live;
    c.sync(blocks);
    c.restamp();
    for (const v of c.views) v.draw();
    if (focus && "block" in focus && c.takeFocus(focus)) setPageFocus(null);
    // A menu of a block that is no more closes.
    if (c.menu && !blocks.some((b) => b.id === c.menu?.id)) c.openMenu(null);
  });

  const c = core.current;
  const menu = c?.menu;
  const menuBlock = menu ? ctx.byId.get(menu.id) : undefined;
  const slashView = c?.slash ? c.viewOf(c.slash.id) : undefined;
  const slashBlock = c?.slash ? ctx.byId.get(c.slash.id) : undefined;
  const slashSlot = slashView?.slot();
  const close = () => c?.openMenu(null);
  const menuName = menuBlock ? `${t("block.menu")}: ${ctx.menus.name(menuBlock)}` : "";
  return (
    <>
      <div ref={host} />
      <RunBubble core={core} seen={bubbles} t={t} />
      {c &&
        [...c.views].flatMap((v) =>
          v.host && v.block.type !== "divider"
            ? [createPortal(ctx.menus.inText(v.block), v.host, v.block.id)]
            : [],
        )}
      {c?.slash &&
        slashSlot &&
        slashBlock &&
        isText(slashBlock) &&
        createPortal(
          ctx.menus.slash(
            slashBlock,
            c.slash.query,
            () => {
              c.slashOff = { id: slashBlock.id, text: slashBlock.text };
              c.selectionChanged();
            },
            c.view.dom,
          ),
          slashSlot,
        )}
      {menu && menuBlock && menu.kind === "point" && (
        <PointMenu x={menu.x} y={menu.y} label={menuName} onClose={close}>
          {(done) => ctx.menus.block(menuBlock, done)}
        </PointMenu>
      )}
      {menu && menuBlock && menu.kind !== "point" && (
        <AnchoredBox
          anchor={menu.anchor}
          label={
            menu.kind === "add"
              ? t("block.add")
              : menu.kind === "icon"
                ? t("page.iconChange")
                : menuName
          }
          width={menu.kind === "add" ? 300 : menu.kind === "icon" ? 330 : 230}
          onClose={close}
        >
          {(done) =>
            menu.kind === "add"
              ? ctx.menus.add(menuBlock, done)
              : menu.kind === "icon"
                ? isText(menuBlock) && ctx.menus.icon(menuBlock, done)
                : ctx.menus.block(menuBlock, done)
          }
        </AnchoredBox>
      )}
    </>
  );
}

/** The menu over a run's selected text, drawn again on its own as the selection moves (not the run's blocks). */
function RunBubble({
  core,
  seen,
  t,
}: {
  core: { current: RunCore | null };
  seen: Set<() => void>;
  t: T;
}) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useLayoutEffect(() => {
    seen.add(tick);
    return () => {
      seen.delete(tick);
    };
  }, []);
  const c = core.current;
  if (!c?.bubble) return null;
  return <FormatBar view={c.view} bubble={c.bubble} t={t} setEditing={(on) => c.editLink(on)} />;
}
