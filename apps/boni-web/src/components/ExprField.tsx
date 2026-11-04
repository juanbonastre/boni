/**
 * One value of a flow's step, as the editor sets it (docs/flujos.md §4.2): a text, a number, yes or no, a value an
 * earlier step or the trigger gives (picked from the list the server computed for that step, `refs`), or one of the
 * plan's functions with its own values (a few levels deep, as the interpreter allows). Never code: what is typed is
 * kept as a literal; a reference is checked by the server's checklist.
 */
import { X } from "lucide-react";
import { useId } from "react";
import { type Expr, isExpr } from "../core/flowEdit.ts";
import { useStore } from "../store.ts";

type Mode = "text" | "number" | "bool" | "ref" | "fn" | "quote" | "none";

const modeOf = (v: unknown): Mode => {
  if (!isExpr(v)) return "none";
  if ("ref" in v) return "ref";
  if ("fn" in v) return "fn";
  if ("quote" in v) return "quote";
  if (typeof v.lit === "number") return "number";
  if (typeof v.lit === "boolean") return "bool";
  return "text";
};

export interface ExprFieldProps {
  value: unknown;
  onChange: (v: Expr | undefined) => void;
  /** The values this step may take (`$m.asunto`…). */
  refs: readonly { ref: string; t: string }[];
  /** The plan's functions with their arity. */
  fns: Readonly<Record<string, [number, number]>>;
  /** It may be left empty (taken out of the step). */
  optional?: boolean;
  /** How deep functions may go (the interpreter's limit). */
  nesting?: number;
  depth?: number;
  label?: string;
}

export function ExprField({
  value,
  onChange,
  refs,
  fns,
  optional = false,
  nesting = 3,
  depth = 0,
  label,
}: ExprFieldProps) {
  const t = useStore((s) => s.t);
  const list = useId();
  const mode = modeOf(value);
  const v = (isExpr(value) ? value : null) as Expr | null;
  const modes: Mode[] = [
    ...(optional || mode === "none" ? (["none"] as Mode[]) : []),
    "text",
    "number",
    "bool",
    "ref",
    ...(depth < nesting ? (["fn"] as Mode[]) : []),
    ...(mode === "quote" ? (["quote"] as Mode[]) : []),
  ];
  const switchTo = (m: Mode) => {
    if (m === mode) return;
    if (m === "none") return onChange(undefined);
    if (m === "text")
      return onChange({ lit: v && "lit" in v && v.lit !== null ? String(v.lit) : "" });
    if (m === "number")
      return onChange({ lit: v && "lit" in v && typeof v.lit === "number" ? v.lit : 0 });
    if (m === "bool") return onChange({ lit: true });
    if (m === "ref") return onChange({ ref: refs[0]?.ref ?? "$" });
    if (m === "fn") {
      const name = Object.keys(fns).includes("concat")
        ? "concat"
        : (Object.keys(fns)[0] ?? "concat");
      return onChange({ fn: name, args: v && !("fn" in v) ? [v] : [{ lit: "" }] });
    }
  };
  const fn = v && "fn" in v ? v : null;
  const arity: [number, number] = fn ? (fns[fn.fn] ?? [0, 8]) : [0, 0];
  return (
    <div className={`expr-field depth-${depth}`}>
      <div className="expr-row">
        <select
          className="expr-mode"
          aria-label={label ? `${label}: ${t("flows.expr.kind")}` : t("flows.expr.kind")}
          value={mode}
          onChange={(e) => switchTo(e.target.value as Mode)}
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {t(`flows.expr.${m}`)}
            </option>
          ))}
        </select>
        {mode === "text" && (
          <input
            className="expr-input"
            aria-label={label ?? t("flows.expr.text")}
            value={v && "lit" in v ? String(v.lit ?? "") : ""}
            onChange={(e) => onChange({ lit: e.target.value.slice(0, 2000) })}
          />
        )}
        {mode === "number" && (
          <input
            className="expr-input"
            type="number"
            aria-label={label ?? t("flows.expr.number")}
            value={v && "lit" in v && typeof v.lit === "number" ? v.lit : 0}
            onChange={(e) =>
              onChange({
                lit: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0,
              })
            }
          />
        )}
        {mode === "bool" && (
          <select
            className="expr-input"
            aria-label={label ?? t("flows.expr.bool")}
            value={v && "lit" in v && v.lit === false ? "no" : "yes"}
            onChange={(e) => onChange({ lit: e.target.value === "yes" })}
          >
            <option value="yes">{t("flows.expr.yes")}</option>
            <option value="no">{t("flows.expr.no")}</option>
          </select>
        )}
        {mode === "ref" && (
          <>
            <input
              className="expr-input expr-ref"
              list={list}
              aria-label={label ?? t("flows.expr.ref")}
              value={v && "ref" in v ? v.ref : ""}
              onChange={(e) => onChange({ ref: e.target.value.trim().slice(0, 200) })}
            />
            <datalist id={list}>
              {refs.map((r) => (
                <option key={r.ref} value={r.ref}>
                  {t(`flows.shape.${r.t}`)}
                </option>
              ))}
            </datalist>
          </>
        )}
        {mode === "quote" && (
          <span className="expr-quote">«{v && "quote" in v ? v.quote : ""}»</span>
        )}
        {mode === "fn" && fn && (
          <select
            className="expr-input"
            aria-label={label ? `${label}: ${t("flows.expr.fn")}` : t("flows.expr.fn")}
            value={fn.fn}
            onChange={(e) => onChange({ fn: e.target.value, args: fn.args })}
          >
            {Object.keys(fns)
              .sort()
              .map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
          </select>
        )}
      </div>
      {fn && (
        <div className="expr-args">
          {fn.args.map((a, i) => (
            <div className="expr-arg" key={`${i}-${fn.args.length}`}>
              <ExprField
                value={a}
                onChange={(x) =>
                  onChange({
                    fn: fn.fn,
                    args:
                      x === undefined
                        ? fn.args.filter((_, j) => j !== i)
                        : fn.args.map((y, j) => (j === i ? x : y)),
                  })
                }
                refs={refs}
                fns={fns}
                nesting={nesting}
                depth={depth + 1}
                optional
              />
            </div>
          ))}
          {fn.args.length < arity[1] && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => onChange({ fn: fn.fn, args: [...fn.args, { lit: "" }] })}
            >
              {t("flows.expr.addArg")}
            </button>
          )}
        </div>
      )}
      {optional && mode !== "none" && depth === 0 && (
        <button
          type="button"
          className="icon-btn expr-clear"
          aria-label={t("flows.expr.clear")}
          title={t("flows.expr.clear")}
          onClick={() => onChange(undefined)}
        >
          <X size={13} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}
