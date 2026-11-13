// The bar over the phone's keyboard while Juan writes a page or a note (docs/design-guide.md, «El móvil»).
import { CheckSquare, Heading1, List, Plus, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { undoPage, useStore } from "../store.ts";
import { type TextKind, turnBlock } from "./PageView.tsx";
import { addFromBar, caretInText } from "./TextRun.tsx";

/** Whatever takes typing on the phone: then the keyboard is up and the tab bar steps aside. */
const typing = (el: Element | null) =>
  !!el?.closest(".m-app") &&
  (el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      /^(text|search|email|url|tel|number|password)$/.test(el.type)) ||
    (el instanceof HTMLElement && el.isContentEditable));
/** The text of a page or a note being written (TextRun.tsx): what the bar works on. */
const inText = (el: Element | null): boolean =>
  el instanceof HTMLElement && el.classList.contains("doc-run") && !!el.closest(".m-app");

/**
 * While Juan writes, the tab bar and the + button step aside (the keyboard is up); in a page or a note's block a bar
 * sits on the keyboard (Notion's): a block from the menu, a heading, a list, a to-do (each turns the block the caret is
 * in into that kind, or back to text), undo, and «Listo».
 */
export function KeyboardBar() {
  const t = useStore((s) => s.t);
  const [block, setBlock] = useState(false);
  // In a browser the keyboard covers the page instead of shrinking it: the bar sits on what is left visible.
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      document.body.classList.toggle("m-typing", typing(el));
      setBlock(inText(el));
      const vv = window.visualViewport;
      setBottom(vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0);
    };
    // Focus moves between blocks through nothing: the check waits for where it lands.
    const out = () => setTimeout(update, 50);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", out);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", out);
      window.visualViewport?.removeEventListener("resize", update);
      document.body.classList.remove("m-typing");
    };
  }, []);
  if (!block) return null;
  // The bar's buttons keep the keyboard: pressing one never takes the focus from the block.
  const keep = (e: React.PointerEvent) => e.preventDefault();
  // The block the caret is in turns into a heading, a list or a to-do (and back), whatever its kind or the caret's place.
  // The caret stays where it was in the block's text (the editor keeps it by block and place).
  const turn = (kind: TextKind) => {
    const at = caretInText();
    if (at) turnBlock(at.id, kind);
  };
  // A new block after this one (Enter at its end), with the block menu open in it.
  const add = () => void addFromBar();
  return (
    <div className="m-keybar" style={{ bottom }} role="toolbar" aria-label={t("kb.label")}>
      <button type="button" onPointerDown={keep} onClick={add} aria-label={t("kb.block")}>
        <Plus size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onClick={() => turn("h1")}
        aria-label={t("kb.heading")}
      >
        <Heading1 size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onClick={() => turn("bullet")}
        aria-label={t("kb.list")}
      >
        <List size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onClick={() => turn("todo")}
        aria-label={t("kb.todo")}
      >
        <CheckSquare size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onClick={() => undoPage()}
        aria-label={t("kb.undo")}
      >
        <Undo2 size={20} strokeWidth={1.8} />
      </button>
      <span className="spacer" />
      <button
        type="button"
        className="done"
        onPointerDown={keep}
        onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
      >
        {t("kb.done")}
      </button>
    </div>
  );
}
