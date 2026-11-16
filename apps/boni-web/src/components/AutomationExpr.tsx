/**
 * A value of a step's view that can be «Fijo» or «Expresión», F of F14b (docs/automatizaciones.md AU-20, AU-21):
 * «{ }» inside the control turns one into the other; a field of ENTRADA dropped on it cites that field, at the
 * caret on text and in place of the value otherwise; an expression is painted as text with a chip for each citation
 * (the step's icon and the field's name, never the code), and after a test it says what it gives with the first row
 * («= 5 · con la fila 1 de 128»), resolved here on every key with no call (A-15). What a drop writes and how an
 * expression is painted and previewed is automations/cite.ts; this file is only the screen.
 */
import { type Automation, isExpr, type ParamValue, printCitation } from "@boni/automations";
import {
  createContext,
  type ReactNode,
  useContext,
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
import type { RowView, Sample } from "../automations/client.ts";
import { type ConditionField, fieldsOut, stepsBefore } from "../automations/panel.ts";
import { type Choices, choiceNames, DO, fieldNames, namedRow } from "../automations/words.ts";
import type { T } from "../i18n.ts";
import { carriesField, cellText, draggedOf } from "./AutomationRows.tsx";
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
  for (const id of stepsBefore(draft, into)) {
    const step = draft.steps.find((s) => s.id === id);
    if (!step) continue;
    const fields = fieldsOut(draft, id, collection);
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
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
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
            : `{{ ${p.source} }}`,
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

/** Under an expression, after a test: what it gives with the first row, or why it gives nothing (AU-20). */
function Preview({ value }: { value: ParamValue }) {
  const view = useContext(CiteContext) as CiteView;
  const p = preview(value, namedSample(view));
  if (!p) return null;
  if ("failure" in p)
    return (
      <p className="auto-preview failed">
        {p.failure === "expr.code"
          ? view.t("auto.problem.expr.code")
          : view.t(`auto.failure.cite.${p.failure}`, { step: p.step ?? "" })}
      </p>
    );
  return (
    <p className="auto-preview">
      {view.t("auto.preview", {
        value: cellText(view.t, p.value),
        row: p.row,
        of: p.of.toLocaleString(view.locale),
      })}
    </p>
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
      {expr && <Preview value={expr} />}
    </div>
  );
}
