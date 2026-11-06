/**
 * A step's panel in the flow editor (docs/flujos.md §4.5): what the step is (a tool, a reader, a question or a
 * reply), «Entra» (the values it takes from the trigger and the steps before it, each with what it is), its settings
 * drawn from the catalog's schema (a tool's arguments by their role, a reader's input and parameters), «Solo si»,
 * «Para cada» and «Junto con», «Sale» (what it gives the steps after it and, after «Probar», what it gave), and the
 * checklist's problems of that step. A record's collection is a list of the collections; its values are rows of field
 * and value.
 */
import { Trash2, X } from "lucide-react";
import type { FlowCatalog, FlowPlan, FlowProblem, FlowStep } from "../core/agent.ts";
import {
  changeCollection,
  type Expr,
  isExpr,
  listText,
  refsUsed,
  setAt,
  typeKeysOf,
} from "../core/flowEdit.ts";
import { stepName as nameOfStep, stepDesc } from "../core/runText.ts";
import { useStore } from "../store.ts";
import { DeciderFacts } from "./DeciderFacts.tsx";
import { ExprField } from "./ExprField.tsx";
import { PieceFacts } from "./PieceFacts.tsx";

type T = (k: string, p?: Record<string, string | number>) => string;
type Refs = readonly { ref: string; t: string }[];

/** A step of a plan by its name (core/runText.ts, the same everywhere, I-27): a tool's title from the catalogue. */
export function stepName(
  t: T,
  s: { op: string; [k: string]: unknown },
  catalog: FlowCatalog | null,
): string {
  const what = String(s.op === "read" ? s.reader : s.op === "call" ? s.tool : s.op);
  const title =
    s.op === "call" ? (catalog?.tools.find((x) => x.name === s.tool)?.title ?? null) : null;
  return nameOfStep(t, { op: s.op, what, title });
}

/** What a step goes over, in words: «cada tarea» (its `each`), «la invitación» (it runs only with one); null. */
function overWords(t: T, s: Record<string, unknown>): string | null {
  const each = s.each as { ref?: unknown } | undefined;
  if (each && typeof each.ref === "string") {
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*\.([A-Za-z_]+)$/.exec(each.ref);
    const k = m ? `flows.over.${m[1]}` : "";
    const v = k ? t(k) : k;
    return v && v !== k ? v : t("flows.over.each");
  }
  // It runs only with an invitation: its condition is the invitation's uid, or that and something more.
  const w = s.when as { ref?: unknown; fn?: unknown; args?: unknown } | undefined;
  const inv = (x: unknown) => (x as { ref?: unknown } | null)?.ref === "$inv.uid";
  if (inv(w) || (w?.fn === "and" && Array.isArray(w.args) && w.args.some(inv)))
    return t("flows.over.inv");
  return null;
}

/**
 * A step's line under its name on a canvas: the collection it works in and what it goes over, so steps of the same
 * kind tell themselves apart («Tarea · cada tarea», «Tarea · cada evento», «Tarea · la invitación»).
 */
export function stepDetail(
  t: T,
  s: Record<string, unknown>,
  collection: string | null,
): string | null {
  return [collection, overWords(t, s)].filter(Boolean).join(" · ") || null;
}

/**
 * What a trigger brings, named as a person says it (`flows.inputName.<name>`: «Correo», «Asunto»…), never the plan's
 * own name (I-08); a name Juan gave a form's field is his and stays as he wrote it.
 */
export const inputName = (t: T, n: string) => {
  const k = `flows.inputName.${n}`;
  const v = t(k);
  return v === k ? n : v;
};

/** A name of the plan language in Spanish when it has one (`flows.arg.<name>`), else as it is. */
export const argName = (t: T, n: string) => {
  const k = `flows.arg.${n}`;
  const v = t(k);
  return v === k ? n : v;
};

const litOf = (v: unknown): string | null =>
  isExpr(v) && "lit" in v && typeof v.lit === "string" ? v.lit : null;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** What a value is, in a word (`flows.shape.<t>`): «texto», «lista», «registro»… */
const shapeName = (t: T, s: string | undefined) => {
  const k = `flows.shape.${s ?? "value"}`;
  const v = t(k);
  return v === k ? (s ?? "") : v;
};

/**
 * A reference as «Entra» and «Sale» show it (I-08): what the trigger binds by its name («Correo»), a form's field as
 * he named it, a step's value by the step's name and the path in it («Crear › titulo»); never the plan's `$names`.
 */
function refName(t: T, ref: string, stepOf: (id: string) => string | null): string {
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(ref);
  if (!m) return ref;
  const head = m[1] as string;
  const path = (m[2] ?? "").split(".").filter(Boolean).join(" › ");
  const k = `flows.inputName.${head}`;
  const v = t(k);
  const name = stepOf(head) ?? (v === k ? head : v);
  return path ? `${name} › ${path}` : name;
}

/** «Entra» or «Sale» (task 70): the references, each with what it is; a word when there are none. */
function IoList({
  title,
  items,
  none,
  stepOf,
}: {
  title: string;
  items: Refs;
  none: string;
  stepOf: (id: string) => string | null;
}) {
  const t = useStore((s) => s.t);
  return (
    <section className="flow-io" aria-label={title}>
      <h4 className="flow-io-title">{title}</h4>
      {items.length ? (
        <ul className="flow-io-list">
          {items.map((r) => (
            <li key={r.ref}>
              <span className="flow-io-name" title={r.ref}>
                {refName(t, r.ref, stepOf)}
              </span>
              <span className="muted">{shapeName(t, r.t)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{none}</p>
      )}
    </section>
  );
}

export function FlowStepPanel({
  step,
  plan,
  catalog,
  refs,
  outs,
  tried,
  problems,
  byRecord = false,
  onPlan,
  onRemove,
  onClose,
}: {
  step: FlowStep;
  plan: FlowPlan;
  catalog: FlowCatalog;
  refs: Refs;
  /** What it gives (the server's check; none from a server before task 70). */
  outs: Refs;
  /** After «Probar», what it gave or would do, in words ([]: it did not run); null without a test. */
  tried: string[] | null;
  problems: readonly FlowProblem[];
  /** The flow starts with a record (a mail): Boni's pieces may be chosen («Añadir paso» offers the same). */
  byRecord?: boolean;
  onPlan: (p: FlowPlan) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const set = (path: string[], v: unknown) => onPlan(setAt(plan, step.id, path, v));
  // A step's name by its id: what «Entra» and «Sale» say of another step's value.
  const stepOf = (id: string) => {
    const s = plan.steps.find((x) => x.id === id);
    return s ? stepName(t, s, catalog) : null;
  };
  // The tools a step may be, as «Añadir paso» offers them: no flow starts or saves another, and Boni's pieces only in a
  // flow a record starts; the one it is, always.
  const tools = catalog.tools.filter(
    (x) =>
      x.name === step.tool ||
      (x.effect !== "flow" &&
        x.effect !== "flow_save" &&
        (x.effect !== "piece" || (byRecord && x.record))),
  );
  const field = (label: string, path: string[], value: unknown, optional: boolean) => (
    <div className="flow-setting" key={path.join(".")}>
      <span className="flow-setting-name">{label}</span>
      <ExprField
        value={value}
        onChange={(v) => set(path, v)}
        refs={refs}
        fns={catalog.fns}
        nesting={catalog.limits.nesting}
        optional={optional}
        label={label}
      />
    </div>
  );
  const lists = refs.filter((r) => r.t === "list");
  const refSelect = (label: string, key: "each" | "zip") => {
    const cur = isObj(step[key]) ? String((step[key] as { ref?: unknown }).ref ?? "") : "";
    return (
      <label className="flow-setting">
        <span className="flow-setting-name">{label}</span>
        <select
          value={cur}
          onChange={(e) => set([key], e.target.value ? { ref: e.target.value } : undefined)}
        >
          <option value="">{t("flows.expr.none")}</option>
          {[...new Set([cur, ...lists.map((r) => r.ref)].filter(Boolean))].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
    );
  };
  let body: React.ReactNode = null;
  if (step.op === "call") {
    const tool = catalog.tools.find((x) => x.name === step.tool);
    const args = isObj(step.args) ? step.args : {};
    const typeKey = litOf(args.type);
    const coll = catalog.collections.find((c) => c.key === typeKey);
    body = (
      <>
        <label className="flow-setting">
          <span className="flow-setting-name">{t("flows.tool")}</span>
          <select
            value={String(step.tool)}
            onChange={(e) =>
              onPlan(setAt(setAt(plan, step.id, ["tool"], e.target.value), step.id, ["args"], {}))
            }
          >
            {tools.map((x) => (
              <option key={x.name} value={x.name}>
                {x.title}
              </option>
            ))}
          </select>
        </label>
        {(tool?.args ?? []).map((a) => {
          const label = argName(t, a.name);
          const among = a.role === "type" ? typeKeysOf(args[a.name]) : [];
          // «Función» (task 93): one of the active extensions' functions, by its name, and its code to read.
          if (step.tool === "function.run" && a.name === "funcion") {
            const chosen = litOf(args.funcion);
            const fn = catalog.functions.find((f) => f.id === chosen);
            return (
              <div className="flow-setting" key={a.name}>
                <label className="flow-setting-name" htmlFor={`fn-${step.id}`}>
                  {label}
                </label>
                <select
                  id={`fn-${step.id}`}
                  value={chosen ?? ""}
                  onChange={(e) =>
                    set(["args", "funcion"], e.target.value ? { lit: e.target.value } : undefined)
                  }
                >
                  <option value="">{t("flows.expr.none")}</option>
                  {catalog.functions.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                  {chosen && !fn && <option value={chosen}>{chosen}</option>}
                </select>
                {fn && (
                  <details className="flow-fn-code">
                    <summary>{t("flows.function.code")}</summary>
                    <pre>{fn.code}</pre>
                  </details>
                )}
                {/* Its tests, by name: they passed when Juan activated it, and they run on every version. */}
                {fn && fn.tests.length > 0 && (
                  <details className="flow-fn-code">
                    <summary>{t("flows.function.tests", { n: fn.tests.length })}</summary>
                    <ul className="flow-fn-tests">
                      {fn.tests.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          }
          // «Crear en la elegida» (docs/sistema.md §4.2): the collection the decider chose, among these; Boni's
          // «Leer correo» lists the collections a mail may go to.
          if (among.length > 1)
            return (
              <div className="flow-setting" key={a.name}>
                <span className="flow-setting-name">{label}</span>
                <span className="flow-chosen">
                  {t("flows.chosenAmong", {
                    list: listText(
                      among.map((k) => catalog.collections.find((c) => c.key === k)?.name ?? k),
                      t("list.or"),
                    ),
                  })}
                </span>
              </div>
            );
          if (a.role === "type")
            return (
              <label className="flow-setting" key={a.name}>
                <span className="flow-setting-name">{label}</span>
                <select
                  value={typeKey ?? ""}
                  onChange={(e) =>
                    onPlan(
                      typeKey && e.target.value
                        ? changeCollection(plan, step.id, e.target.value, catalog)
                        : setAt(
                            plan,
                            step.id,
                            ["args", a.name],
                            e.target.value ? { lit: e.target.value } : undefined,
                          ),
                    )
                  }
                >
                  <option value="">{t("flows.expr.none")}</option>
                  {catalog.collections.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                  {typeKey && !coll && <option value={typeKey}>{typeKey}</option>}
                </select>
              </label>
            );
          if (a.role === "field" && coll)
            return (
              <label className="flow-setting" key={a.name}>
                <span className="flow-setting-name">{label}</span>
                <select
                  value={litOf(args[a.name]) ?? ""}
                  onChange={(e) =>
                    set(["args", a.name], e.target.value ? { lit: e.target.value } : undefined)
                  }
                >
                  <option value="">{t("flows.expr.none")}</option>
                  {coll.fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          if (
            a.name === "values" &&
            (step.tool === "entities.create" || step.tool === "entities.update")
          )
            return (
              <ValuesEditor
                key={a.name}
                label={label}
                value={args.values}
                fields={coll?.fields ?? []}
                refs={refs}
                catalog={catalog}
                onChange={(v) => set(["args", "values"], v)}
              />
            );
          return field(label, ["args", a.name], args[a.name], !a.required);
        })}
        {field(t("flows.why"), ["why"], step.why, true)}
      </>
    );
  } else if (step.op === "read") {
    const reader = catalog.readers[String(step.reader)];
    const params = isObj(step.params) ? step.params : {};
    body = (
      <>
        <label className="flow-setting">
          <span className="flow-setting-name">{t("flows.reader")}</span>
          <select
            value={String(step.reader)}
            onChange={(e) => {
              const keep = catalog.readers[e.target.value]?.params ?? [];
              onPlan(
                setAt(
                  setAt(plan, step.id, ["reader"], e.target.value),
                  step.id,
                  ["params"],
                  Object.fromEntries(Object.entries(params).filter(([k]) => keep.includes(k))),
                ),
              );
            }}
          >
            {Object.keys(catalog.readers).map((r) => (
              <option key={r} value={r}>
                {stepName(t, { op: "read", reader: r }, catalog)}
              </option>
            ))}
          </select>
        </label>
        {field(t("flows.input"), ["input"], step.input, false)}
        {(reader?.params ?? []).map((p) =>
          field(argName(t, p), ["params", p], params[p], !(reader?.required ?? []).includes(p)),
        )}
      </>
    );
  } else if (step.op === "ask") {
    body = (
      <>
        <label className="flow-setting">
          <span className="flow-setting-name">{t("flows.control")}</span>
          <select value={String(step.control)} onChange={(e) => set(["control"], e.target.value)}>
            {catalog.asks.map((c) => (
              <option key={c} value={c}>
                {t(`flows.control.${c}`)}
              </option>
            ))}
          </select>
        </label>
        {field(argName(t, "prompt"), ["prompt"], step.prompt, false)}
        {step.control === "choice" &&
          field(argName(t, "options"), ["options"], step.options, false)}
      </>
    );
  } else if (step.op === "reply") {
    const data = isObj(step.data) ? step.data : {};
    body = (
      <>
        <label className="flow-setting">
          <span className="flow-setting-name">{t("flows.component")}</span>
          <select
            value={String(step.component)}
            onChange={(e) => set(["component"], e.target.value)}
          >
            {Object.keys(catalog.replies).map((c) => (
              <option key={c} value={c}>
                {t(`flows.component.${c}`)}
              </option>
            ))}
          </select>
        </label>
        {(catalog.replies[String(step.component)] ?? []).map((d) =>
          field(argName(t, d), ["data", d], data[d], true),
        )}
      </>
    );
  }
  return (
    <aside className="flow-step-panel" aria-label={stepName(t, step, catalog)}>
      <div className="flow-panel-head">
        <h3>{stepName(t, step, catalog)}</h3>
        <span className="muted flow-step-id">{step.id}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("flows.remove")}
          title={t("flows.remove")}
          onClick={onRemove}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("flows.close")}
          title={t("flows.close")}
          onClick={onClose}
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>
      {/* What it does, in one line (task 90: «Regla del remitente» or «Ya propuesto» alone said little). */}
      {(() => {
        const desc = stepDesc(t, {
          op: String(step.op),
          what: String(step.op === "read" ? step.reader : step.op === "call" ? step.tool : step.op),
        });
        return desc ? <p className="flow-step-desc muted">{desc}</p> : null;
      })()}
      {/* The decider: what it chooses among and the guide's rules that choose for it (task 83). */}
      {step.op === "read" && step.reader === "classify" && (
        <DeciderFacts
          plan={plan}
          step={step.id}
          nameOfKey={(k) => catalog.collections.find((c) => c.key === k)?.name}
          keyOfId={(id) => catalog.collections.find((c) => c.id === id)?.key}
        />
      )}
      {/* A piece's own setting that lives elsewhere: «Aceptar solas»' «Solo» switch (task 83). */}
      {step.op === "call" && <PieceFacts step={step} />}
      {problems.length > 0 && (
        <ul className="flow-problems" aria-label={t("flows.problems")}>
          {problems.map((p) => (
            <li key={`${p.at}-${p.code}`}>{problemText(t, p)}</li>
          ))}
        </ul>
      )}
      <IoList
        stepOf={stepOf}
        title={t("flows.in")}
        items={refsUsed(step).map((ref) => ({
          ref,
          t: refs.find((r) => r.ref === ref)?.t ?? "value",
        }))}
        none={t("flows.in.none")}
      />
      {body}
      <div className="flow-panel-sep" />
      {field(t("flows.when"), ["when"], step.when, true)}
      {refSelect(t("flows.each"), "each")}
      {step.each !== undefined && refSelect(t("flows.zip"), "zip")}
      <div className="flow-panel-sep" />
      <IoList stepOf={stepOf} title={t("flows.out")} items={outs} none={t("flows.out.none")} />
      {tried && (
        <section className="flow-io flow-tried" aria-label={t("flows.tried")}>
          <h4 className="flow-io-title">{t("flows.tried")}</h4>
          {tried.length ? (
            <ul className="flow-io-list">
              {tried.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t("flows.tried.none")}</p>
          )}
        </section>
      )}
    </aside>
  );
}

/** A problem of the checklist in words: where (the setting) and what. */
export function problemText(t: T, p: FlowProblem): string {
  const k = `flows.problem.${p.code}`;
  const what = t(k) === k ? p.code : t(k);
  const at = p.at
    ?.split(".")
    .filter((x) => x !== "args" && x !== "params" && x !== "data" && !/^args\[/.test(x))
    .pop();
  return at ? `${argName(t, at.replace(/\[\d+\]$/, ""))}: ${what}` : what;
}

/**
 * A record's values (entities.create and .update): rows of a field of its collection and its value; the parts it is
 * merged with (what the code found, what a reader filled) as chips, kept as they are. Anything else, as a value.
 */
function ValuesEditor({
  label,
  value,
  fields,
  refs,
  catalog,
  onChange,
}: {
  label: string;
  value: unknown;
  fields: readonly { key: string; name: string; roles: string[] }[];
  refs: Refs;
  catalog: FlowCatalog;
  onChange: (v: Expr | undefined) => void;
}) {
  const t = useStore((s) => s.t);
  const e = isExpr(value) ? value : null;
  let parts: Expr[] = [];
  let rows: [string, Expr][] = [];
  if (e && "fn" in e && e.fn === "merge") {
    const last = e.args.at(-1);
    parts = last && "fn" in last && last.fn === "obj" ? e.args.slice(0, -1) : e.args;
    if (last && "fn" in last && last.fn === "obj") rows = pairs(last.args);
  } else if (e && "fn" in e && e.fn === "obj") rows = pairs(e.args);
  else if (e)
    return (
      <div className="flow-setting">
        <span className="flow-setting-name">{label}</span>
        <ExprField
          value={value}
          onChange={onChange}
          refs={refs}
          fns={catalog.fns}
          nesting={catalog.limits.nesting}
          label={label}
        />
      </div>
    );
  const build = (ps: Expr[], rs: [string, Expr][]): Expr => {
    const obj: Expr = { fn: "obj", args: rs.flatMap(([k, v]) => [{ lit: k }, v]) };
    return ps.length ? { fn: "merge", args: [...ps, obj] } : obj;
  };
  const names: { key: string; name: string }[] = [
    { key: "title", name: t("flows.field.title") },
    ...fields.filter((f) => !f.roles.includes("title")).map((f) => ({ key: f.key, name: f.name })),
    { key: "body", name: t("flows.field.body") },
  ];
  const free = names.filter((n) => !rows.some(([k]) => k === n.key));
  return (
    <div className="flow-setting flow-values">
      <span className="flow-setting-name">{label}</span>
      {parts.length > 0 && (
        <div className="flow-parts">
          {parts.map((p, i) => (
            <span className="chip" key={`${i}-${"ref" in p ? p.ref : i}`}>
              {"ref" in p ? p.ref : "…"}
              <button
                type="button"
                className="icon-btn"
                aria-label={t("flows.expr.clear")}
                onClick={() =>
                  onChange(
                    build(
                      parts.filter((_, j) => j !== i),
                      rows,
                    ),
                  )
                }
              >
                <X size={11} strokeWidth={1.8} />
              </button>
            </span>
          ))}
        </div>
      )}
      {rows.map(([k, v], i) => (
        <div className="flow-value-row" key={`${k}-${i}`}>
          <select
            aria-label={t("flows.field")}
            value={k}
            onChange={(ev) =>
              onChange(
                build(
                  parts,
                  rows.map((r, j) => (j === i ? [ev.target.value, r[1]] : r)),
                ),
              )
            }
          >
            {[
              ...names.filter((n) => n.key === k || !rows.some(([x]) => x === n.key)),
              ...(names.some((n) => n.key === k) ? [] : [{ key: k, name: k }]),
            ].map((n) => (
              <option key={n.key} value={n.key}>
                {n.name}
              </option>
            ))}
          </select>
          <ExprField
            value={v}
            onChange={(x) =>
              onChange(
                build(
                  parts,
                  x === undefined
                    ? rows.filter((_, j) => j !== i)
                    : rows.map((r, j) => (j === i ? [r[0], x] : r)),
                ),
              )
            }
            refs={refs}
            fns={catalog.fns}
            nesting={catalog.limits.nesting - 1}
            optional
            label={names.find((n) => n.key === k)?.name ?? k}
          />
        </div>
      ))}
      {free.length > 0 && (
        <button
          type="button"
          className="btn ghost small"
          onClick={() => onChange(build(parts, [...rows, [free[0]?.key as string, { lit: "" }]]))}
        >
          {t("flows.addField")}
        </button>
      )}
    </div>
  );
}

const pairs = (args: Expr[]): [string, Expr][] => {
  const out: [string, Expr][] = [];
  for (let i = 0; i + 1 < args.length; i += 2) {
    const k = args[i];
    if (k && "lit" in k && typeof k.lit === "string") out.push([k.lit, args[i + 1] as Expr]);
  }
  return out;
};
