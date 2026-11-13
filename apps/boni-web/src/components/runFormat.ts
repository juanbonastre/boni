/**
 * Inline format in a run of text (task 2f): the text stays the Markdown a person writes (core/inline.ts), painted
 * formatted with the engine's decorations, its marks (`**`, a link's `](…)`) hidden except in the format the caret or
 * the selection's ends are in, as Obsidian's live preview shows them; and the edits a format's shortcut or button
 * makes, as one change of the text. Only the blocks a change or the caret touched are painted again (A-15).
 */
import type { Node as PMNode } from "prosemirror-model";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Page } from "../core/agent.ts";
import {
  descending,
  type Edit,
  type InlineKind,
  inlineSpans,
  type Span,
  setLink,
  spanAround,
  toggleWrap,
  unlink,
  type WrapKind,
} from "../core/inline.ts";

type Block = Page["spec"]["blocks"][number];

/** A transaction that is a format's edit: one step of Undo of its own, never a Markdown shortcut. */
export const FORMAT_EDIT = "boni-format-edit";

interface FormatState {
  set: DecorationSet;
  /** The text has the focus (marks show only then), and a pointer is down in it (what shows waits for it to lift). */
  focused: boolean;
  held: boolean;
}
/** What a format's own transaction says: the focus, a pointer down or up, or the caret's block to be drawn again. */
type Seen = { focused?: boolean; held?: boolean; redraw?: boolean };
const key = new PluginKey<FormatState>("boni-format");

const CLASS: Record<InlineKind, string> = {
  strong: "md-strong",
  em: "md-em",
  strike: "md-strike",
  code: "md-code",
  link: "md-link",
  url: "md-link",
  mention: "md-mention",
  image: "",
};

/** A block whose text is not formatted: a code block's is code. */
const plainBlock = (n: PMNode) => (n.attrs.block as Block | null)?.type === "code";

const spansOfNode = new WeakMap<PMNode, Span[]>();
/** A block's formats, worked out once for as long as the block is the same. */
export function spansOf(n: PMNode): Span[] {
  let s = spansOfNode.get(n);
  if (!s) {
    s = n.isTextblock && !plainBlock(n) ? inlineSpans(n.textContent) : [];
    spansOfNode.set(n, s);
  }
  return s;
}

/** The decorations of the block at `pos`: each format's look, and its marks hidden unless `near` is in it. */
function decorate(n: PMNode, pos: number, near: readonly number[]): Decoration[] {
  const out: Decoration[] = [];
  const start = pos + 1;
  for (const s of spansOf(n)) {
    if (s.inner[1] > s.inner[0])
      out.push(Decoration.inline(start + s.inner[0], start + s.inner[1], { class: CLASS[s.kind] }));
    const shown = near.some((p) => p >= s.from && p <= s.to);
    for (const [a, b] of s.marks)
      if (b > a)
        out.push(
          Decoration.inline(start + a, start + b, { class: shown ? "md-mark" : "md-mark md-hide" }),
        );
  }
  return out;
}

/** Where in its block the selection's ends are, for the block at `pos`. */
function nearIn(state: EditorState, pos: number, n: PMNode, focused: boolean): number[] {
  if (!focused) return [];
  const sel = state.selection;
  const out: number[] = [];
  for (const p of [sel.anchor, sel.head])
    if (p > pos && p < pos + n.nodeSize) out.push(p - pos - 1);
  return out;
}

/** The block the place is in: where it starts; null between blocks. */
function blockAt(doc: PMNode, p: number): number | null {
  if (p < 0 || p > doc.content.size) return null;
  const $p = doc.resolve(p);
  return $p.depth >= 1 ? $p.before(1) : null;
}

/** Paints the formats of a run's text. */
export const formatPlugin = new Plugin<FormatState>({
  key,
  state: {
    init(_c, state) {
      const decos: Decoration[] = [];
      state.doc.forEach((n, pos) => {
        if (n.isTextblock) decos.push(...decorate(n, pos, []));
      });
      return { set: DecorationSet.create(state.doc, decos), focused: false, held: false };
    },
    apply(tr, prev, old, state) {
      const meta = tr.getMeta(key) as Seen | undefined;
      const focused = meta?.focused ?? prev.focused;
      const held = meta?.held ?? prev.held;
      let set = prev.set;
      const dirty = new Set<number>();
      const add = (p: number | null) => {
        if (p !== null) dirty.add(p);
      };
      if (tr.docChanged) {
        set = set.map(tr.mapping, tr.doc);
        const maps = tr.mapping.maps;
        maps.forEach((m, i) => {
          const rest = tr.mapping.slice(i + 1);
          m.forEach((_os, _oe, ns, ne) => {
            const from = rest.map(ns, -1);
            const to = rest.map(ne, 1);
            add(blockAt(state.doc, from));
            state.doc.nodesBetween(from, Math.min(to, state.doc.content.size), (_n, p) => {
              dirty.add(p);
              return false;
            });
          });
        });
      }
      // What shows near the caret follows it, except while a pointer is down (a drag would move the text under it).
      const nearMoved =
        meta?.focused !== undefined ||
        meta?.redraw === true ||
        (meta?.held === false && prev.held) ||
        (!held && (tr.selectionSet || tr.docChanged));
      if (nearMoved) {
        for (const p of [old.selection.anchor, old.selection.head]) {
          const q = tr.docChanged ? tr.mapping.map(p) : p;
          add(blockAt(state.doc, q));
        }
        add(blockAt(state.doc, state.selection.anchor));
        add(blockAt(state.doc, state.selection.head));
      }
      // A word being composed (a phone's keyboard) keeps its block as it was drawn until it is done.
      const composing = tr.getMeta("composition") !== undefined;
      for (const p of dirty) {
        const n = state.doc.nodeAt(p);
        if (!n?.isTextblock) continue;
        if (composing && p === blockAt(state.doc, state.selection.head)) continue;
        set = set.remove(set.find(p, p + n.nodeSize));
        set = set.add(
          state.doc,
          decorate(n, p, held && !nearMoved ? [] : nearIn(state, p, n, focused)),
        );
      }
      return { set, focused, held };
    },
  },
  props: {
    decorations: (state) => key.getState(state)?.set ?? null,
  },
});

/** The text's focus, a pointer going down or lifting, or a word composed: what shows near the caret is drawn again. */
export function formatSeen(view: EditorView, change: Seen) {
  const now = key.getState(view.state);
  if (
    now &&
    !change.redraw &&
    (change.focused === undefined || change.focused === now.focused) &&
    (change.held === undefined || change.held === now.held)
  )
    return;
  view.dispatch(view.state.tr.setMeta(key, change).setMeta("addToHistory", false));
}

/** The text blocks a selection is in, each with the part of its text selected. */
function selectedParts(state: EditorState) {
  const { from, to } = state.selection;
  const parts: { pos: number; node: PMNode; from: number; to: number }[] = [];
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.isTextblock && !plainBlock(n)) {
      const start = pos + 1;
      parts.push({
        pos,
        node: n,
        from: Math.max(0, from - start),
        to: Math.min(n.content.size, to - start),
      });
    }
    return false;
  });
  // A caret: its block alone.
  if (from === to && !parts.length) {
    const p = blockAt(state.doc, from);
    const n = p === null ? null : state.doc.nodeAt(p);
    if (p !== null && n?.isTextblock && !plainBlock(n))
      parts.push({ pos: p, node: n, from: from - p - 1, to: from - p - 1 });
  }
  return parts;
}

/** Each block's edits made in one transaction, from the last block to the first. */
function editBlocks(tr: Transaction, edits: { pos: number; edits: Edit[] }[]) {
  for (const b of [...edits].sort((x, y) => y.pos - x.pos))
    for (const e of descending(b.edits)) {
      const at = b.pos + 1 + e.at;
      if (e.ins) tr.insertText(e.ins, at, at + e.del);
      else tr.delete(at, at + e.del);
    }
  return tr;
}

/** Whether this part of a block's text is in a format of this kind (its formats as last worked out). */
const inFormat = (n: PMNode, kind: InlineKind, from: number, to: number) =>
  spanAround(spansOf(n), kind, from, to) !== null;

/** Whether the selection is all of this format (its button shown pressed). */
export function formatOn(state: EditorState, kind: InlineKind): boolean {
  const parts = selectedParts(state).filter((p) => p.from < p.to || state.selection.empty);
  return parts.length > 0 && parts.every((p) => inFormat(p.node, kind, p.from, p.to));
}

/**
 * A format's shortcut or button: on around the selection (in every block it spans), or off where it all is of that
 * format already; with the caret, off in a format or its marks to type between. One edit of the text, its own Undo.
 */
export function toggleFormat(view: EditorView, kind: WrapKind): boolean {
  const state = view.state;
  if (state.selection instanceof NodeSelection) return false;
  const parts = selectedParts(state);
  if (!parts.length) return true;
  const tr = state.tr;
  if (parts.length === 1) {
    const p = parts[0] as (typeof parts)[number];
    const r = toggleWrap(p.node.textContent, p.from, p.to, kind);
    if (!r) return true;
    editBlocks(tr, [{ pos: p.pos, edits: r.edits }]);
    tr.setSelection(TextSelection.create(tr.doc, p.pos + 1 + r.from, p.pos + 1 + r.to));
  } else {
    const filled = parts.filter((p) => p.node.textContent.slice(p.from, p.to).trim());
    const off = filled.every((p) => inFormat(p.node, kind, p.from, p.to));
    const edits = filled.flatMap((p) => {
      const text = p.node.textContent;
      if (!off && inFormat(p.node, kind, p.from, p.to)) return [];
      const r = toggleWrap(text, p.from, p.to, kind);
      return r ? [{ pos: p.pos, edits: r.edits }] : [];
    });
    if (!edits.length) return true;
    const { from, to } = state.selection;
    editBlocks(tr, edits);
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from, 1), tr.mapping.map(to, -1)));
  }
  view.dispatch(tr.setMeta(FORMAT_EDIT, true).scrollIntoView());
  return true;
}

/** The link or address the caret or the selection (or a place) is in, in one block: its block's start and the span. */
export function linkAt(
  state: EditorState,
  from = state.selection.from,
  to = state.selection.to,
): { pos: number; span: Span } | null {
  const p = blockAt(state.doc, from);
  if (p === null || blockAt(state.doc, to) !== p) return null;
  const n = state.doc.nodeAt(p);
  if (!n?.isTextblock) return null;
  const spans = spansOf(n);
  const span =
    spanAround(spans, "link", from - p - 1, to - p - 1) ??
    spanAround(spans, "url", from - p - 1, to - p - 1);
  return span ? { pos: p, span } : null;
}

/** A link around the selection (in one block), or a new address for the link it is in. */
export function linkSelection(view: EditorView, href: string): boolean {
  const state = view.state;
  const { from, to } = state.selection;
  const p = blockAt(state.doc, from);
  if (p === null || blockAt(state.doc, to) !== p) return false;
  const n = state.doc.nodeAt(p);
  if (!n?.isTextblock || plainBlock(n)) return false;
  const r = setLink(n.textContent, from - p - 1, to - p - 1, href);
  if (!r) return false;
  const tr = editBlocks(state.tr, [{ pos: p, edits: r.edits }]);
  tr.setSelection(TextSelection.create(tr.doc, p + 1 + r.to));
  view.dispatch(tr.setMeta(FORMAT_EDIT, true).scrollIntoView());
  return true;
}

/** The link the caret is in taken away, its words left. */
export function unlinkAt(view: EditorView): boolean {
  const at = linkAt(view.state);
  if (at?.span.kind !== "link") return false;
  const tr = editBlocks(view.state.tr, [{ pos: at.pos, edits: unlink(at.span) }]);
  view.dispatch(tr.setMeta(FORMAT_EDIT, true));
  return true;
}

/** Whether a selection is one a format can be put on: text, in one or more blocks that are not code. */
export function formattable(state: EditorState): boolean {
  if (!(state.selection instanceof TextSelection) || state.selection.empty) return false;
  return selectedParts(state).some((p) => p.from < p.to);
}
