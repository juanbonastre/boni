/**
 * The menu that comes up over selected text (task 2f): bold, italic, strikethrough, code and a link, each pressed when
 * the selection already has it; with the caret in a link, its address (plain text), to open, change or take it off.
 * It keeps the text's focus and selection (a press is no click away from it), and sits below the selection where the
 * pointer is a finger, as a phone's own bar for copying sits above it.
 */
import {
  Bold,
  Check,
  Code,
  ExternalLink,
  Italic,
  Link,
  Pencil,
  Strikethrough,
  Unlink,
} from "lucide-react";
import type { EditorView } from "prosemirror-view";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { linkHref, type WrapKind } from "../core/inline.ts";
import { openUrl } from "../host.ts";
import type { useStore } from "../store.ts";
import { formatOn, linkAt, linkSelection, toggleFormat, unlinkAt } from "./runFormat.ts";

type T = ReturnType<typeof useStore.getState>["t"];

/** What the menu shows: the formats of a selection, or the link the caret is in; the field for an address open. */
export type Bubble = { mode: "format" | "link"; editing: boolean };

const WRAPS: { kind: WrapKind; label: string; Icon: typeof Bold }[] = [
  { kind: "strong", label: "fmt.strong", Icon: Bold },
  { kind: "em", label: "fmt.em", Icon: Italic },
  { kind: "strike", label: "fmt.strike", Icon: Strikethrough },
  { kind: "code", label: "fmt.code", Icon: Code },
];

const finger = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;
/** A press on the menu keeps the text's focus and selection. */
const keep = (e: { preventDefault(): void }) => e.preventDefault();

export function FormatBar({
  view,
  bubble,
  t,
  setEditing,
}: {
  view: EditorView;
  bubble: Bubble;
  t: T;
  setEditing: (on: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const state = view.state;
  const link = linkAt(state);
  const href = link?.span.href ?? "";
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);

  // The field starts with the link's address (none for new words).
  useEffect(() => {
    if (bubble.editing) {
      setValue(link?.span.kind === "link" ? href : "");
      setWrong(false);
    }
  }, [bubble.editing]);

  // Above the selection (below it for a finger), inside the window; again as the page scrolls or the keyboard opens.
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current;
      if (!el) return;
      const { from, to } = view.state.selection;
      let a: { left: number; right: number; top: number; bottom: number };
      let b: typeof a;
      try {
        a = view.coordsAtPos(from, 1);
        b = view.coordsAtPos(to, -1);
      } catch {
        return;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const oneLine = Math.abs(a.top - b.top) < 4;
      const mid = oneLine ? (a.left + b.right) / 2 : a.left + w / 2;
      const left = Math.max(4, Math.min(mid - w / 2, window.innerWidth - w - 4));
      const over = Math.min(a.top, b.top) - h - 8;
      const under = Math.max(a.bottom, b.bottom) + 8;
      const top = finger() || over < 4 ? Math.min(under, window.innerHeight - h - 4) : over;
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      el.style.visibility = "visible";
    };
    place();
    const vv = window.visualViewport;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    vv?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      vv?.removeEventListener("resize", place);
    };
  });

  // A press anywhere else closes the field for an address.
  useEffect(() => {
    if (!bubble.editing) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [bubble.editing]);

  const back = () => view.focus();
  const button = (label: string, icon: ReactNode, run: () => void, pressed?: boolean) => (
    <button
      key={label}
      type="button"
      className="fmt-btn"
      aria-label={t(label)}
      title={t(label)}
      aria-pressed={pressed}
      onPointerDown={keep}
      onMouseDown={keep}
      onClick={run}
    >
      {icon}
    </button>
  );

  const apply = () => {
    const typed = value.trim();
    if (!typed && link?.span.kind === "link") {
      unlinkAt(view);
    } else {
      const to = linkHref(typed);
      if (!to) {
        setWrong(true);
        return;
      }
      linkSelection(view, to);
    }
    setEditing(false);
    back();
  };

  let body: ReactNode;
  if (bubble.editing)
    body = (
      <form
        className="fmt-field"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: the field is what the key or the button asked for.
          autoFocus
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className={wrong ? "fmt-input wrong" : "fmt-input"}
          aria-label={t("fmt.address")}
          aria-invalid={wrong}
          placeholder={t("fmt.address")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setWrong(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
              back();
            }
          }}
        />
        <button
          type="submit"
          className="fmt-btn"
          aria-label={t("fmt.apply")}
          title={t("fmt.apply")}
        >
          <Check size={16} strokeWidth={2} />
        </button>
        {wrong && (
          <span className="fmt-wrong" role="alert">
            {t("fmt.notLink")}
          </span>
        )}
      </form>
    );
  else if (bubble.mode === "link" && link) {
    const web = /^https?:\/\//i.test(href);
    body = (
      <>
        <span className="fmt-url" title={href}>
          {href}
        </span>
        {web &&
          button("fmt.open", <ExternalLink size={16} strokeWidth={2} />, () => void openUrl(href))}
        {link.span.kind === "link" && (
          <>
            {button("fmt.edit", <Pencil size={16} strokeWidth={2} />, () => setEditing(true))}
            {button("fmt.unlink", <Unlink size={16} strokeWidth={2} />, () => {
              unlinkAt(view);
              back();
            })}
          </>
        )}
      </>
    );
  } else
    body = (
      <>
        {WRAPS.map(({ kind, label, Icon }) =>
          button(
            label,
            <Icon size={16} strokeWidth={2} />,
            () => {
              toggleFormat(view, kind);
              back();
            },
            formatOn(state, kind),
          ),
        )}
        {button(
          "fmt.link",
          <Link size={16} strokeWidth={2} />,
          () => setEditing(true),
          formatOn(state, "link"),
        )}
      </>
    );

  return createPortal(
    <div
      ref={box}
      className="fmt-bar"
      role="toolbar"
      aria-label={t("fmt.bar")}
      style={{ visibility: "hidden" }}
    >
      {body}
    </div>,
    document.body,
  );
}
