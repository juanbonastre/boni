/**
 * The menu that comes up over selected text (task 2f): bold, italic, strikethrough, code and a link, each pressed when
 * the selection already has it; with the caret in a link, its address (plain text), to open, change or take it off;
 * with the caret in a mention `[[Título]]`, its title, to open what it names (task 110): none or several of that
 * title are said here, and several are chosen from here.
 * It keeps the text's focus and selection (a press is no click away from it), and sits below the selection where the
 * pointer is a finger, as a phone's own bar for copying sits above it.
 */
import {
  ArrowUpRight,
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
import { deviceZone } from "../core/clock.ts";
import { linkHref, type WrapKind } from "../core/inline.ts";
import { openUrl } from "../host.ts";
import { type MentionFound, openMention, openTitled, useStore } from "../store.ts";
import { formatOn, linkAt, linkSelection, mentionAt, toggleFormat, unlinkAt } from "./runFormat.ts";

type T = ReturnType<typeof useStore.getState>["t"];

/**
 * What the menu shows: the formats of a selection, the link or the mention the caret is in; the field for an address
 * open. `open`: a mention asked to open (Ctrl+click), each ask its own number.
 */
export type Bubble = { mode: "format" | "link" | "mention"; editing: boolean; open?: number };

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
  const locale = useStore((s) => (s.settings.language === "en" ? "en-GB" : "es-ES"));
  const mention = bubble.mode === "mention" ? mentionAt(state) : null;
  const target = mention?.span.target ?? "";
  // What came of opening it, for the title it was asked for (the caret may have gone to another since).
  const [found, setFound] = useState<{ target: string; f: MentionFound | "wait" } | null>(null);
  const openIt = async () => {
    if (!target) return;
    setFound({ target, f: "wait" });
    const f = await openMention(target);
    setFound(f.kind === "opened" ? null : { target, f });
  };
  useEffect(() => {
    if (bubble.open) void openIt();
  }, [bubble.open]);
  const said = found && found.target === target ? found.f : null;

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
  } else if (bubble.mode === "mention" && mention) {
    const day = (ms: number) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: deviceZone() }).format(ms);
    body = (
      <div className="fmt-mention">
        <div className="fmt-row">
          <span className="fmt-url" title={target}>
            {target}
          </span>
          {said === "wait" ? (
            <span className="fmt-state" role="status">
              {t("mention.wait")}
            </span>
          ) : said?.kind === "none" || said?.kind === "offline" ? (
            <span className="fmt-state" role="status">
              {t(said.kind === "none" ? "mention.none" : "mention.offline")}
            </span>
          ) : null}
          {said !== "wait" &&
            said?.kind !== "many" &&
            button("fmt.open", <ArrowUpRight size={16} strokeWidth={2} />, () => void openIt())}
        </div>
        {said !== "wait" && said?.kind === "many" && (
          <ul className="fmt-choices" aria-label={t("mention.many", { n: said.count })}>
            {said.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="fmt-choice"
                  onPointerDown={keep}
                  onMouseDown={keep}
                  onClick={() => void openTitled(r)}
                >
                  <span className="fmt-choice-where">
                    {r.type === "page" ? t("mention.page") : r.collection}
                  </span>
                  {r.updated > 0 && <span className="fmt-choice-when">{day(r.updated)}</span>}
                </button>
              </li>
            ))}
            {said.count > said.rows.length && (
              <li className="fmt-state">
                {t("mention.more", { n: said.rows.length, total: said.count })}
              </li>
            )}
          </ul>
        )}
      </div>
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
