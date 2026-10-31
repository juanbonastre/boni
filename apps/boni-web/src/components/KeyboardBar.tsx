// The bar over the phone's keyboard while Juan writes a page or a note (docs/design-guide.md, «El móvil»).
import { CheckSquare, Heading1, List, Plus, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { undoPage, useStore } from "../store.ts";

/** Whatever takes typing on the phone: then the keyboard is up and the tab bar steps aside. */
const typing = (el: Element | null) =>
  !!el?.closest(".m-app") &&
  (el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      /^(text|search|email|url|tel|number|password)$/.test(el.type)) ||
    (el instanceof HTMLElement && el.isContentEditable));
/** A block of a page or a note being written: what the bar works on. */
const blockOf = (el: Element | null): HTMLTextAreaElement | null =>
  el instanceof HTMLTextAreaElement && el.classList.contains("blk-input") && el.closest(".m-app")
    ? el
    : null;

/**
 * While Juan writes, the tab bar and the + button step aside (the keyboard is up); in a page or a note's block a bar
 * sits on the keyboard (Notion's): a block from the menu, a heading, a list, a to-do, undo, and «Listo». Each one
 * types at the start of the block what the editor already turns into that kind («# », «- », «[] »), so it works as
 * typing does.
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
      setBlock(!!blockOf(el));
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
  const turn = (prefix: string) => {
    const el = blockOf(document.activeElement);
    if (!el) return;
    const at = el.selectionStart;
    el.setSelectionRange(0, 0);
    document.execCommand("insertText", false, prefix);
    // The editor took the prefix away when it turned the block: the caret goes back where it was.
    requestAnimationFrame(() => blockOf(document.activeElement)?.setSelectionRange(at, at));
  };
  const add = () => {
    const el = blockOf(document.activeElement);
    if (!el) return;
    if (el.value === "") return void document.execCommand("insertText", false, "/");
    // A new block after this one (Enter at its end), with the block menu open in it.
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    setTimeout(() => {
      const next = blockOf(document.activeElement);
      if (next && next.value === "") document.execCommand("insertText", false, "/");
    }, 60);
  };
  return (
    <div className="m-keybar" style={{ bottom }} role="toolbar" aria-label={t("kb.label")}>
      <button type="button" onPointerDown={keep} onClick={add} aria-label={t("kb.block")}>
        <Plus size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onClick={() => turn("# ")}
        aria-label={t("kb.heading")}
      >
        <Heading1 size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onClick={() => turn("- ")}
        aria-label={t("kb.list")}
      >
        <List size={20} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onPointerDown={keep}
        onClick={() => turn("[] ")}
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
