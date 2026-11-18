/**
 * The editor of a «Código» step (docs/automatizaciones.md AU-36): CodeMirror 6 with JavaScript, the app's colours
 * from its theme's variables, completion from the core's `completions` and the marks of validation at their place.
 * Loaded only when a «Código» is opened (`React.lazy`, AutomationStepView.tsx), so the rest of the app never pays for
 * it. It decides nothing: what it completes and what it marks come in as props, read by the same `readCode` as the
 * server's validation, so what it underlines is what the server will say. A field of ENTRADA dropped on it is written
 * where it is let go (AU-25): `drop` says what, CodeMirror's `posAtCoords` says where.
 */
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, lintKeymap, setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { dropCursor, EditorView, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

/** One mark: where, how bad, and what it says, in the app's words (plain text: CodeMirror paints it as text). */
export interface CodeMark {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
}
/** One thing to complete: what goes into the code, and what is shown when it is not the same (a field's name). */
export interface CodeOption {
  insert: string;
  label?: string;
  kind: "global" | "step" | "field" | "collection" | "method";
}

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** What to offer at `at` (the core's `completions`). */
  complete?: (source: string, at: number) => CodeOption[];
  marks: readonly CodeMark[];
  /** The editor's accessible name. */
  label: string;
  readOnly?: boolean;
  /** What an empty editor shows. */
  hint?: string;
  /**
   * What a drag let go on the editor writes (AU-25), given the code just before where it lands: a text (empty: the
   * drag is ours and writes nothing), or null when the drag is not one this editor takes (then it is CodeMirror's own,
   * as a text dragged in). Also asked on every `dragover`, with `peek` and no `before`, only to know whether it is ours.
   */
  drop?: (e: DragEvent, before: string, peek: boolean) => string | null;
}

/** The theme: every colour is one of the app's variables, so light and dark follow it (I-01). */
const theme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "var(--bg)",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--radius)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "2px solid var(--accent)", outlineOffset: "-1px" },
  ".cm-scroller": {
    fontFamily: 'var(--mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace)',
    lineHeight: "20px",
    maxHeight: "420px",
    minHeight: "120px",
  },
  ".cm-content": { caretColor: "var(--text)", padding: "6px 0" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  // Where a field dragged over the editor will go (AU-25).
  ".cm-dropCursor": { borderLeft: "2px solid var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-soft) !important",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface)",
    color: "var(--muted)",
    border: "none",
    borderRight: "1px solid var(--line)",
    borderRadius: "var(--radius) 0 0 var(--radius)",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--line-strong)",
    borderRadius: "6px",
    boxShadow: "var(--shadow)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal", marginLeft: "8px" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--bad)",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warn, #d9a441)",
    textUnderlineOffset: "3px",
  },
  ".cm-diagnostic": { fontFamily: "var(--font)", fontSize: "12px", padding: "4px 8px" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--bad)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--warn, #d9a441)" },
  ".cm-panel.cm-panel-lint": { backgroundColor: "var(--surface)", color: "var(--text)" },
});

/** JavaScript's colours, from the app's palette. */
const colours = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: "var(--c7)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--c3)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--c2)" },
  { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--c1)" },
  { tag: tags.propertyName, color: "var(--text)" },
  { tag: tags.special(tags.variableName), color: "var(--c5)" },
]);

const KIND_TYPE: Record<CodeOption["kind"], string> = {
  global: "variable",
  step: "class",
  field: "property",
  collection: "namespace",
  method: "method",
};

/** The word being written before the caret: what an option replaces. */
const WORD = /[\w$]*$/;

export default function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The latest props, read by the editor's callbacks without making it again.
  const latest = useRef(props);
  latest.current = props;
  const editable = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const source = (ctx: CompletionContext): CompletionResult | null => {
      const complete = latest.current.complete;
      if (!complete) return null;
      const text = ctx.state.doc.toString();
      const options = complete(text, ctx.pos);
      if (!options.length) return null;
      const word = WORD.exec(text.slice(Math.max(0, ctx.pos - 200), ctx.pos))?.[0] ?? "";
      // Inside `$('…` or `$col('…` the option replaces what was written after the quote.
      const quoted = /(['"`])([^'"`\\]*)$/.exec(text.slice(Math.max(0, ctx.pos - 200), ctx.pos));
      const typed = options.some((o) => o.kind === "step" || o.kind === "collection")
        ? (quoted?.[2] ?? "")
        : word;
      if (!typed && !ctx.explicit && !/[.'"`(]$/.test(text.slice(0, ctx.pos))) return null;
      return {
        from: ctx.pos - typed.length,
        options: options.map((o) => ({
          label: o.insert,
          ...(o.label ? { detail: o.label } : {}),
          type: KIND_TYPE[o.kind],
        })),
        filter: false,
      };
    };
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          history(),
          closeBrackets(),
          bracketMatching(),
          javascript(),
          syntaxHighlighting(colours),
          theme,
          autocompletion({ override: [source], icons: false }),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...lintKeymap,
            // Tab indents; Escape and then Tab leaves the editor (CodeMirror's own rule), so it is used whole with
            // the keyboard.
            indentWithTab,
          ]),
          editable.current.of([
            EditorState.readOnly.of(!!props.readOnly),
            EditorView.editable.of(!props.readOnly),
          ]),
          ...(props.hint ? [placeholder(props.hint)] : []),
          // A field dropped (AU-25) goes where the pointer is let go, not where the caret was. Taken before
          // CodeMirror's own drop, which would write the drag's plain text (the bare key) instead; `posAtCoords(…,
          // false)` gives the nearest place also past a line's end or under the last line, where the precise one
          // gives none.
          dropCursor(),
          EditorView.domEventHandlers({
            dragover: (e, v) => {
              const drop = latest.current.drop;
              if (!drop || v.state.readOnly || drop(e, "", true) === null) return false;
              if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
              return true;
            },
            drop: (e, v) => {
              const drop = latest.current.drop;
              if (!drop || v.state.readOnly) return false;
              const at = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
              const text = drop(e, v.state.sliceDoc(Math.max(0, at - 200), at), false);
              if (text === null) return false;
              if (text) {
                v.focus();
                v.dispatch({
                  changes: { from: at, insert: text },
                  selection: { anchor: at + text.length },
                  userEvent: "input.drop",
                  scrollIntoView: true,
                });
              }
              return true;
            },
          }),
          EditorView.contentAttributes.of({ "aria-label": props.label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  // A value from outside (Undo, another device) replaces the text; the caret stays where it can.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const now = v.state.doc.toString();
    if (now === props.value) return;
    const head = Math.min(v.state.selection.main.head, props.value.length);
    v.dispatch({
      changes: { from: 0, to: now.length, insert: props.value },
      selection: { anchor: head },
    });
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(!!props.readOnly),
        EditorView.editable.of(!props.readOnly),
      ]),
    });
  }, [props.readOnly]);

  // The marks of validation, each at its place, said on hover and in the panel of Ctrl+Shift+M.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const length = v.state.doc.length;
    const diagnostics: Diagnostic[] = props.marks.map((m) => {
      const from = Math.max(0, Math.min(m.from, length));
      const to = Math.max(from, Math.min(m.to, length));
      return { from, to, severity: m.severity, message: m.message };
    });
    v.dispatch(setDiagnostics(v.state, diagnostics));
  }, [props.marks, props.value]);

  return <div className="auto-code-editor" ref={host} data-marks={props.marks.length} />;
}
