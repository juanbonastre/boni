/**
 * A value of a step's view that can be «Fijo» or «Expresión», F of F14b (docs/automatizaciones.md AU-20, AU-21):
 * «{ }» inside the control turns one into the other; a field of ENTRADA dropped on it cites that field, at the
 * caret on text and in place of the value otherwise; an expression is painted as text with a chip for each citation
 * (the step's icon and the field's name, never the code), and after a test it says what it gives with the first row
 * («= 5 · con la fila 1 de 128»), resolved here on every key with no call (A-15). What a drop writes and how an
 * expression is painted and previewed is automations/cite.ts; this file is only the screen.
 */
import {
  type Automation,
  CODE_LIMITS,
  isExpr,
  type ParamValue,
  parseExpression,
  printCitation,
} from "@boni/automations";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  citationFor,
  dropCitation,
  type Painted,
  paint,
  preview,
  toExpression,
  toFixed,
} from "../automations/cite.ts";
import { type ExprPreview, previewFits, type RowView, type Sample } from "../automations/client.ts";
import { type ConditionField, fieldsOutOf, stepsBefore } from "../automations/panel.ts";
import {
  type Choices,
  choiceNames,
  DO,
  fieldNames,
  namedCell,
  namedRow,
  type SaidNames,
  said,
} from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { carriesField, cellText, draggedOf } from "./AutomationRows.tsx";
import { usePhone } from "./AutomationTest.tsx";
import { iconOf } from "./automationIcons.ts";

/** What every value of the view needs to cite and to preview: given once by the step's view. */
export interface CiteView {
  t: T;
  draft: Automation;
  /** The step being edited, by id. */
  into: string;
  /** Field names by step name, then by key (`paint`). */
  names: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** A choice's options by step name, field and id: a value is said by its option's name. */
  choices: Readonly<Record<string, Choices>>;
  /** The last test's first rows (`…/test/sample`), asked once when the view opens; null with no test. */
  sample: Sample | null;
  locale: string;
  /**
   * What the expression at `param` gives with row `row` of the step's last test, as the server works it out (AU-23,
   * AU-27); null when it could not be asked. Absent: the line says only what a simple citation gives with the
   * first row, worked out here.
   */
  ask?: (param: string, row: number, expr: string) => Promise<ExprPreview | null>;
  /** A collection and a field said by name in a failure's words. */
  said?: SaidNames;
}
export const CiteContext = createContext<CiteView | null>(null);

/**
 * The names a value of `into` cites by: each step before it, by its name, with its fields' names and its choices'
 * options, as the draft knows them (`fieldsOut`), and the keys of the sample's rows the draft does not know (a
 * trigger's own, a field a test brought). Made from the draft on each change, never from the rows (A-15).
 */
export function citeNames(
  t: T,
  draft: Automation,
  into: string,
  collection: (key: string) => readonly ConditionField[] | undefined,
  sample: Sample | null,
): Pick<CiteView, "names" | "choices"> {
  const names: Record<string, Record<string, string>> = {};
  const choices: Record<string, Choices> = {};
  const out = fieldsOutOf(draft, collection);
  const byId = new Map(draft.steps.map((s) => [s.id, s]));
  for (const id of stepsBefore(draft, into)) {
    const step = byId.get(id);
    if (!step) continue;
    const fields = out(id);
    const seen = sample?.steps[step.name];
    const row = seen?.first ?? seen?.item;
    names[step.name] = {
      ...Object.fromEntries(Object.keys(row?.json ?? {}).map((k) => [k, k])),
      ...fieldNames(t, fields),
    };
    choices[step.name] = choiceNames(fields);
  }
  return { names, choices };
}

// ---------------------------------------------------------------- the editor's text and its caret

/**
 * Painted beside a chip with no text on that side: without a text node there, Chrome cannot put the caret after a
 * chip that ends the line (End, a click past it), and what is typed goes elsewhere. It writes nothing.
 */
const GAP = "\u200b";

/** What a node of the editor writes into the expression: a chip, its citation; text, itself. */
function textOf(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE)
    return (n as Text).data.replace(/\u00a0/g, " ").replaceAll(GAP, "");
  if (!(n instanceof HTMLElement)) return "";
  if (n.dataset.src !== undefined) return n.dataset.src;
  let s = "";
  for (const c of n.childNodes) s += textOf(c);
  return s;
}

/** Where a point of the editor (a node and an offset in it, as a selection gives) is in the expression's text. */
function offsetIn(root: HTMLElement, node: Node, offset: number): number {
  let at = 0;
  const walk = (n: Node): boolean => {
    if (n === node) {
      if (n.nodeType === Node.TEXT_NODE)
        at += (n as Text).data.slice(0, offset).replaceAll(GAP, "").length;
      else
        for (let i = 0; i < offset && i < n.childNodes.length; i++)
          at += textOf(n.childNodes[i] as Node).length;
      return true;
    }
    if (
      n.nodeType === Node.TEXT_NODE ||
      (n instanceof HTMLElement && n.dataset.src !== undefined)
    ) {
      // A point inside a chip is after it.
      if (n.contains(node)) {
        at += textOf(n).length;
        return true;
      }
      at += textOf(n).length;
      return false;
    }
    for (const c of n.childNodes) if (walk(c)) return true;
    return false;
  };
  if (root === node) {
    for (let i = 0; i < offset && i < root.childNodes.length; i++)
      at += textOf(root.childNodes[i] as Node).length;
    return at;
  }
  for (const c of root.childNodes) if (walk(c)) return at;
  return at;
}

/** Puts the caret at a place of the expression's text, as the editor is painted (text and chips, in order). */
function placeCaret(root: HTMLElement, at: number) {
  const range = document.createRange();
  let left = at;
  let placed = false;
  for (const n of root.childNodes) {
    const len = textOf(n).length;
    if (n.nodeType === Node.TEXT_NODE && left <= len) {
      // The place among the text's own letters, past the gaps.
      const data = (n as Text).data;
      let i = 0;
      for (let k = left; i < data.length && (k > 0 || data[i] === GAP); i++)
        if (data[i] !== GAP) k--;
      range.setStart(n, i);
      placed = true;
      break;
    }
    if (n.nodeType !== Node.TEXT_NODE && left <= len) {
      range.setStartAfter(n);
      placed = true;
      break;
    }
    left -= len;
  }
  if (!placed) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** A chip (AU-21): the step's icon and the field's name; red, with why, when what it cites is gone. */
function Chip({ part, view }: { part: Extract<Painted, { kind: "chip" }>; view: CiteView }) {
  const step = part.step === null ? undefined : view.draft.steps.find((s) => s.id === part.step);
  const Icon = step ? iconOf(step.type) : null;
  const stepName = step?.name ?? part.cite.step ?? "";
  const shown = part.withStep && stepName ? `${stepName} › ${part.name}` : part.name;
  const why =
    part.broken === "step.unknown"
      ? view.t("auto.problem.expr.unknownStep", { name: part.cite.step ?? "" })
      : part.broken === "field.unknown"
        ? view.t("auto.chip.fieldUnknown", { step: stepName, field: part.cite.path.join(".") })
        : shown;
  return (
    <span
      className={`auto-chip${part.broken ? " broken" : ""}`}
      contentEditable={false}
      data-src={`{{ ${printCitation(part.cite)} }}`}
      data-broken={part.broken}
      title={why}
    >
      {Icon && <Icon size={12} strokeWidth={1.8} aria-hidden />}
      <span className="auto-chip-name">{shown}</span>
    </span>
  );
}

/**
 * The expression's own editor: one line of text where each citation is a chip that the caret steps over and a
 * Backspace takes away whole. It is painted from the value when the value changes from elsewhere (a drop,
 * Deshacer, a step renamed) and when it is left, never while its own keys are typed, so the caret stays put.
 */
function ExprEditor({
  expr,
  set,
  label,
  marked,
  caret,
  placeAt,
}: {
  expr: string;
  set: (expr: string) => void;
  label: string;
  marked: boolean;
  /** Where the caret was last, in the expression's text: where a field dropped on it goes. */
  caret: React.MutableRefObject<{ start: number; end: number } | null>;
  /** Set by a drop: where to put the caret once the editor is painted again. */
  placeAt: React.MutableRefObject<number | null>;
}) {
  const view = useContext(CiteContext) as CiteView;
  // On the phone it is read, never typed in (AU-74).
  const phone = usePhone();
  const ref = useRef<HTMLDivElement>(null);
  /** The expression as the editor holds it: what it last read from its text, or was painted with. */
  const held = useRef(expr);
  const [painted, setPainted] = useState({ expr, n: 0 });
  /** Painted again while it had the focus (Deshacer, Rehacer): it keeps it, with the caret at the end. */
  const refocus = useRef(false);
  const repaint = () => {
    held.current = expr;
    setPainted((p) => ({ expr, n: p.n + 1 }));
  };
  useLayoutEffect(() => {
    if (expr === held.current) return;
    refocus.current = ref.current !== null && document.activeElement === ref.current;
    repaint();
  }, [expr]);
  useLayoutEffect(() => {
    const el = ref.current;
    const at = placeAt.current ?? (refocus.current && el ? textOf(el).length : null);
    refocus.current = false;
    if (el && at !== null) {
      el.focus();
      placeCaret(el, at);
      caret.current = { start: at, end: at };
      placeAt.current = null;
    }
  }, [painted.n]);
  const parts = paint(painted.expr, view.draft, view.into, view.names);
  const keep = () => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return;
    const start = offsetIn(el, r.startContainer, r.startOffset);
    const end = offsetIn(el, r.endContainer, r.endOffset);
    caret.current = { start: Math.min(start, end), end: Math.max(start, end) };
  };
  return (
    <div
      key={painted.n}
      ref={ref}
      className={`input auto-input expr auto-expr${marked ? " marked" : ""}`}
      contentEditable={!phone}
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      aria-readonly={phone || undefined}
      aria-invalid={marked || undefined}
      tabIndex={0}
      spellCheck={false}
      onInput={() => {
        const el = ref.current;
        if (!el) return;
        const next = textOf(el);
        held.current = next;
        keep();
        set(next);
      }}
      onKeyUp={keep}
      onMouseUp={keep}
      onFocus={keep}
      onBlur={() => {
        // Left, it is painted again: a citation typed by hand becomes its chip.
        if (
          painted.expr !== held.current ||
          paint(held.current, view.draft, view.into, view.names).some((p) => p.kind === "chip")
        )
          repaint();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        // Backspace or Delete beside a gap takes the chip beyond it, not the gap no one sees.
        const sel = window.getSelection();
        const n = sel?.anchorNode;
        if (
          (e.key === "Backspace" || e.key === "Delete") &&
          sel?.isCollapsed &&
          n?.nodeType === Node.TEXT_NODE
        ) {
          const data = (n as Text).data;
          const at = sel.anchorOffset;
          if (e.key === "Backspace" && data[at - 1] === GAP) sel.collapse(n, at - 1);
          if (e.key === "Delete" && data[at] === GAP) sel.collapse(n, at + 1);
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand(
          "insertText",
          false,
          e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "),
        );
      }}
      onDrop={(e) => {
        // A drop is the value's (ValueBox): the browser puts nothing here itself.
        e.preventDefault();
      }}
    >
      {parts.flatMap((p, i) =>
        p.kind === "chip"
          ? [
              i === 0 ? GAP : null,
              <Chip key={i} part={p} view={view} />,
              parts[i + 1]?.kind === "text" ? null : GAP,
            ]
          : p.kind === "text"
            ? p.text
            : [
                // JavaScript, as typed, set apart from the text around it (AU-22); read back as its text.
                <span key={i} className="auto-expr-code">{`{{ ${p.source} }}`}</span>,
              ],
      )}
    </div>
  );
}

/** The sample with each option said by its name: what the preview reads (F). */
function namedSample(view: CiteView): Sample | null {
  const s = view.sample;
  if (!s) return null;
  const parent = view.draft.arrows.find((a) => a.to.step === view.into)?.from.step;
  const parentName = view.draft.steps.find((x) => x.id === parent)?.name ?? "";
  const nr = (r: RowView | null, c: Choices | undefined) => (r ? namedRow(r, c) : null);
  const steps: Sample["steps"] = {};
  for (const [name, at] of Object.entries(s.steps)) {
    const c = view.choices[name];
    steps[name] = { item: nr(at.item, c), first: nr(at.first, c), last: nr(at.last, c) };
  }
  return { ...s, current: nr(s.current, view.choices[parentName]), steps };
}

/** How long the line waits after the last key before it asks the server (AU-23: «cuando Juan deja de escribir»). */
export const PREVIEW_WAIT = 300;

/** Whether an expression has JavaScript, which only the server's box works out (AU-27); a simple citation has not. */
const hasCode = (expr: string) => parseExpression(expr).some((p) => p.kind === "code");

/**
 * Under an expression (AU-20, AU-23): what it gives with a row of the step's last test, «‹ ›» to go through the
 * rows, or why it gives nothing. A simple citation with the first row is worked out here on every key, with no call
 * (A-15); JavaScript, or another row, is asked of the server `PREVIEW_WAIT` after the last key, and only the answer
 * to the latest ask is painted: one to an earlier text never covers a later one. Until it arrives the last answer
 * stays, dimmed. The value and a failure's words are painted as text (A-01).
 */
function Preview({ value, param }: { value: { expr: string }; param?: string }) {
  const view = useContext(CiteContext) as CiteView;
  const [row, setRow] = useState(0);
  const [answer, setAnswer] = useState<{ expr: string; row: number; p: ExprPreview } | null>(null);
  const asked = useRef(0);
  const expr = value.expr;
  const ask = param === undefined ? undefined : view.ask;
  const code = hasCode(expr);
  const long = expr.length > CODE_LIMITS.expressionChars;
  // Within the limit but too big once escaped for a request (AU-23): said so too, and not asked.
  const big = !long && code && !previewFits(expr);
  const remote = !!ask && (code || row > 0);
  // The view makes `ask` again on each render: the latest is called, and only a new text, row or test asks again.
  const latest = useRef(ask);
  latest.current = ask;
  useEffect(() => {
    if (!remote || long || big || param === undefined) return;
    const n = ++asked.current;
    const timer = setTimeout(() => {
      void latest.current?.(param, row, expr).then((p) => {
        if (p && n === asked.current) setAnswer({ expr, row, p });
      });
    }, PREVIEW_WAIT);
    return () => clearTimeout(timer);
  }, [remote, long, big, param, row, expr, view.sample]);

  const t = view.t;
  const of = (n: number) => n.toLocaleString(view.locale);
  const stepper = (at: number, total: number) =>
    ask && total > 1 ? (
      <span className="auto-preview-rows">
        <button
          type="button"
          className="auto-preview-row"
          aria-label={t(DO.rowBefore)}
          title={t(DO.rowBefore)}
          disabled={at <= 0}
          onClick={() => setRow(Math.max(0, at - 1))}
        >
          ‹
        </button>
        <button
          type="button"
          className="auto-preview-row"
          aria-label={t(DO.rowAfter)}
          title={t(DO.rowAfter)}
          disabled={at >= total - 1}
          onClick={() => setRow(Math.min(total - 1, at + 1))}
        >
          ›
        </button>
      </span>
    ) : null;

  /** The line, and beside it «‹ ›» when there are rows to go through: outside its text, which says only the value. */
  const line = (cls: string, text: string, at?: number, total = 0) => (
    <div className="auto-preview-line">
      <p className={cls}>{text}</p>
      {at === undefined ? null : stepper(at, total)}
    </div>
  );

  if (!remote) {
    const p = preview(value, namedSample(view));
    if (!p) return null;
    if ("failure" in p)
      return line(
        "auto-preview failed",
        p.failure === "expr.code"
          ? t("auto.problem.expr.code")
          : t(`auto.failure.cite.${p.failure}`, { step: p.step ?? "" }),
      );
    return line(
      "auto-preview",
      t("auto.preview", { value: cellText(t, p.value), row: p.row, of: of(p.of) }),
      0,
      p.of,
    );
  }
  if (long)
    return line(
      "auto-preview failed",
      t("auto.preview.long", { got: of(expr.length), max: of(CODE_LIMITS.expressionChars) }),
    );
  if (big) return line("auto-preview failed", t("auto.preview.big", { got: of(expr.length) }));
  if (!answer) return null;
  const pending = answer.expr !== expr || answer.row !== row;
  const p = answer.p;
  const cls = (failed: boolean) =>
    `auto-preview${failed ? " failed" : ""}${pending ? " pending" : ""}`;
  if (p.state === "untested") {
    const names = p.steps.map((id) => `«${view.draft.steps.find((s) => s.id === id)?.name ?? id}»`);
    const list = new Intl.ListFormat(view.locale, { type: "conjunction" }).format(names);
    return line(cls(true), t("auto.preview.untested", { steps: list }));
  }
  if (p.state === "noRows") return line(cls(true), t("auto.preview.noRows"));
  if (p.state === "failed")
    return line(
      cls(true),
      t("auto.preview.failed", {
        row: p.row + 1,
        of: of(p.of),
        why: said(t, "failure", p.failure, view.locale, view.said),
      }),
      p.row,
      p.of,
    );
  return line(
    cls(false),
    t("auto.preview", {
      value: cellText(t, namedCell(p.value, view.choices)),
      row: p.row + 1,
      of: of(p.of),
    }),
    p.row,
    p.of,
  );
}

/**
 * A value of the view, fixed or an expression (AU-20): `children` is its fixed control, painted while it is not an
 * expression. `text`: the fixed value is text, so a field dropped on it goes in at its caret; on any other (a number,
 * a date, an option, a row) the citation replaces the value.
 */
export function ValueBox({
  value,
  set,
  text,
  label,
  marked = false,
  onFocus,
  param,
  children,
}: {
  value: ParamValue | undefined;
  /** `typed`: a key typed in the expression, part of a run of typing (AU-68); a drop or «{ }» is a change alone. */
  set: (value: ParamValue, typed?: boolean) => void;
  text: boolean;
  label: string;
  marked?: boolean;
  /** Entered: what starts a run of typing (AU-68). */
  onFocus?: () => void;
  /** Where the value is in the step, as `Problem.param` writes it: what the server's line is asked for (AU-23). */
  param?: string;
  children: ReactNode;
}) {
  const view = useContext(CiteContext);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const placeAt = useRef<number | null>(null);
  const [over, setOver] = useState(false);
  if (!view) return <>{children}</>;
  const expr = isExpr(value) ? value : null;
  const fixedText = !expr && text;
  /** The caret of the fixed text: where a field dropped on it goes. */
  const keepFixed = (e: React.SyntheticEvent) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.selectionStart !== null)
      caret.current = { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart };
  };
  return (
    <div
      className={`auto-value${over ? " over" : ""}`}
      onFocus={onFocus}
      onDragOver={(e) => {
        if (!carriesField(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!carriesField(e)) return;
        e.preventDefault();
        setOver(false);
        const field = draggedOf(e);
        if (!field) return;
        const cite = citationFor(view.draft, view.into, field.from, field.path);
        const was = expr ? expr.expr : value === undefined || value === null ? "" : String(value);
        const onText = !!expr || text;
        const at = caret.current ?? { start: was.length, end: was.length };
        const next = dropCitation(value, onText ? { text: true, ...at } : { text: false }, cite);
        // The caret goes after the chip, where the next key or field goes.
        const end = onText
          ? Math.min(at.start, was.length) + `{{ ${printCitation(cite)} }}`.length
          : (next as { expr: string }).expr.length;
        placeAt.current = end;
        caret.current = { start: end, end };
        set(next);
      }}
    >
      <div className="auto-value-row">
        {expr ? (
          <ExprEditor
            expr={expr.expr}
            set={(x) => set({ expr: x }, true)}
            label={label}
            marked={marked}
            caret={caret}
            placeAt={placeAt}
          />
        ) : (
          <div
            className="auto-value-fixed"
            onSelect={fixedText ? keepFixed : undefined}
            onKeyUp={fixedText ? keepFixed : undefined}
            onChange={(e) => {
              // `{{` typed in a fixed text makes it an expression with what was written, the caret where it was
              // (AU-22): the control's own change bubbles here after it is made, in the same run of typing.
              const el = e.target;
              if (!fixedText || !(el instanceof HTMLInputElement) || !el.value.includes("{{"))
                return;
              placeAt.current = el.selectionStart ?? el.value.length;
              set({ expr: el.value }, true);
            }}
          >
            {children}
          </div>
        )}
        <button
          type="button"
          className={`auto-expr-toggle${expr ? " on" : ""}`}
          aria-label={view.t(expr ? DO.exprOff : DO.exprOn)}
          title={view.t(expr ? DO.exprOff : DO.exprOn)}
          aria-pressed={!!expr}
          data-boni-action="automations.edit"
          onClick={() => {
            caret.current = null;
            set(expr ? toFixed(value) : toExpression(value));
          }}
        >
          {"{ }"}
        </button>
      </div>
      {expr && <Preview value={expr} param={param} />}
    </div>
  );
}
