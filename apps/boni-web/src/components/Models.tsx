import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  KeyRound,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type CatalogueModel,
  type EvalCase,
  type ListedModel,
  MODEL_CONNECTIONS,
  type ModelAccountRow,
  type ModelChoice,
  type ModelConnection,
  type ModelKind,
  type ModelParts,
  type ModelsList,
  type ModelUses,
  type ModelWhere,
  type ModelsView as View,
} from "../core/agent.ts";
import { ApiError } from "../core/api.ts";
import { deviceZone } from "../core/clock.ts";
import { markParts, modelName, moved, nameOfId, used } from "../core/modelChoices.ts";
import { evalFailText } from "../core/runText.ts";
import { agentApi, errorText, loadModelChoices, toast, useStore } from "../store.ts";
import { MenuButton } from "./Menu.tsx";

type T = ReturnType<typeof useStore.getState>["t"];
type Eur = (x: number) => string;
const same = (a: ModelChoice, b: ModelChoice) =>
  a.connection === b.connection && a.model === b.model && a.zdr === b.zdr;
/** Jev, the decision model: the code's choices only, on TypeSafe or through OpenRouter. */
const DECIDERS: ModelChoice[] = [
  { connection: "openrouter", model: "typesafe/jev-1.14", zdr: false },
  { connection: "typesafe", model: "jev-1.14.0", zdr: false },
];

/** A model's evaluation in the list's words (AU-234): «22 de 24», «· Caducada», «· Parcial», or «Sin evaluar». */
export function markText(t: T, m: ListedModel): string {
  const p = markParts(m.evaluation);
  if (!p) return t("models.unevaluated");
  return [
    t("models.mark", { right: p.right, total: p.total }),
    ...(p.expired ? [t("models.expired")] : []),
    ...(p.partial ? [t("models.partial")] : []),
  ].join(" · ");
}

/** Where something is used, as «Quitar» and «Claves» ask it (AU-233): rows, automations, conversations. */
function whereText(t: T, lang: string, w: ModelUses): string {
  const parts = [
    ...w.rows.map((k) => `«${t("models.usedRow", { kind: t(`models.kind.${k}`) })}»`),
    ...(w.automations ? [t("models.usedAutomations", { n: w.automations })] : []),
    ...(w.conversations ? [t("models.usedConversations", { n: w.conversations })] : []),
  ];
  return new Intl.ListFormat(lang === "en" ? "en-GB" : "es-ES", { type: "conjunction" }).format(
    parts,
  );
}

/** The question before a change that leaves something without its model (AU-233, AU-241), with its two answers. */
function Ask({
  t,
  lines,
  yes,
  onYes,
  onNo,
}: {
  t: T;
  lines: string[];
  yes: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="models-ask" role="alert">
      {lines.map((l, i) => (
        <p key={i} className="models-line">
          {l}
        </p>
      ))}
      <span className="models-actions">
        <button type="button" className="btn" onClick={onNo}>
          {t("models.cancel")}
        </button>
        <button type="button" className="btn danger" onClick={onYes}>
          {yes}
        </button>
      </span>
    </div>
  );
}

function askLines(t: T, lang: string, w: ModelWhere): string[] {
  return [
    ...(used(w) ? [t("models.removeAsk", { where: whereText(t, lang, w) })] : []),
    ...(w.tagsLeft.length
      ? [
          t(w.tagsLeft.length === 1 ? "models.leftAsk" : "models.leftAskMany", {
            tags: w.tagsLeft.join(", "),
          }),
        ]
      : []),
  ];
}

/** A row «De la cuenta» as it answers now (AU-236): its tag with the model it takes, the model, or «Sin modelo». */
function rowText(t: T, list: ModelsList, r: ModelAccountRow): string {
  const answers = r.answers ? nameOfId(r.answers) : null;
  if (r.value?.startsWith("tag:")) {
    const tag = list.tags.find((x) => x.id === r.value)?.name ?? "";
    return `${tag} · ${answers ?? t("models.noModel")}`;
  }
  if (!answers) return t("models.noModel");
  return r.value ? answers : `${answers} · ${t("models.fromServer")}`;
}

/**
 * «De la cuenta» (AU-236): a row per kind of call, each a model or a tag. «Cambiar» offers what its kind may choose and
 * says, before saving, how many automations follow it («La usan 6 automatizaciones»).
 */
export function AccountRows({
  t,
  list,
  readOnly,
  onList,
}: {
  t: T;
  list: ModelsList;
  readOnly: boolean;
  onList: (l: ModelsList) => void;
}) {
  const [editing, setEditing] = useState<{ kind: ModelKind; value: string } | null>(null);
  const choices = useStore((s) => (editing ? s.modelChoices[editing.kind] : undefined));
  const save = async () => {
    if (!editing) return;
    try {
      const l = await agentApi.setAccountRow(editing.kind, editing.value || null);
      if (l) onList(l);
      setEditing(null);
      toast(t("models.saved"));
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  return (
    <ul className="models-account">
      {list.account.map((r) => (
        <li key={r.kind}>
          <span className="models-account-kind">{t(`models.kind.${r.kind}`)}</span>
          {editing?.kind === r.kind ? (
            <span className="models-account-edit">
              <select
                className="input"
                aria-label={t(`models.kind.${r.kind}`)}
                value={editing.value}
                onChange={(e) => setEditing({ kind: r.kind, value: e.target.value })}
              >
                <option value="">{t("models.fromServer")}</option>
                {/* What the row has now, while the choices come or when it is no longer offered. */}
                {editing.value &&
                  !choices?.tags.some((g) => g.id === editing.value) &&
                  !choices?.models.some((m) => m.id === editing.value) && (
                    <option value={editing.value}>{rowText(t, list, r)}</option>
                  )}
                {(choices?.tags.length ?? 0) > 0 && (
                  <optgroup label={t("models.tags")}>
                    {choices?.tags.map((g) => (
                      <option key={g.id} value={g.id} disabled={g.state !== "ok"}>
                        {t("auto.agent.model.tagIs", {
                          tag: g.name,
                          model:
                            g.state === "ok" && g.answers
                              ? nameOfId(g.answers)
                              : t(g.state === "expired" ? "models.expired" : "models.noModel"),
                        })}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(choices?.models.length ?? 0) > 0 && (
                  <optgroup label={t("auto.agent.model.models")}>
                    {choices?.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {modelName(m.model)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="muted small models-account-uses">
                {r.automations > 0
                  ? t("models.rowUses", { n: r.automations })
                  : t("models.rowUsesNone")}
              </span>
              <span className="models-actions">
                <button type="button" className="btn" onClick={() => setEditing(null)}>
                  {t("models.cancel")}
                </button>
                <button type="button" className="btn primary" onClick={() => void save()}>
                  {t("models.save")}
                </button>
              </span>
            </span>
          ) : (
            <>
              <span className="models-account-value">{rowText(t, list, r)}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`${t("models.change")} · ${t(`models.kind.${r.kind}`)}`}
                  onClick={() => {
                    void loadModelChoices(r.kind);
                    setEditing({ kind: r.kind, value: r.value ?? "" });
                  }}
                >
                  {t("models.change")}
                </button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The list of loaded models (AU-232), in the person's order: name, connection, privacy, tags, evaluation and the
 * month's spending; a click opens one. The order changes by dragging a row or with «Subir» and «Bajar» in its menu;
 * the server's models are not moved (they are not in the person's order).
 */
export function ModelRows({
  t,
  list,
  eur,
  readOnly,
  onOpen,
  onList,
}: {
  t: T;
  list: ModelsList;
  eur: Eur;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onList: (l: ModelsList) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const own = useMemo(() => list.models.filter((m) => !m.server).map((m) => m.id), [list]);
  const order = async (ids: string[]) => {
    if (ids.join("\n") === own.join("\n")) return;
    try {
      const l = await agentApi.orderModels(ids);
      if (l) onList(l);
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  if (!list.models.length) return <p className="muted">{t("models.none")}</p>;
  return (
    <ul className="models-items" aria-label={t("models.list")}>
      {list.models.map((m) => {
        const i = own.indexOf(m.id);
        const moves = !readOnly && i >= 0;
        return (
          <li
            key={m.id}
            className={`models-item${dragging === m.id ? " dragging" : ""}`}
            draggable={moves}
            onDragStart={(e) => {
              if (!moves) return;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", m.id);
              setDragging(m.id);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (dragging && moves) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragging;
              setDragging(null);
              if (from && moves) void order(moved(own, from, m.id));
            }}
          >
            {moves && (
              <GripVertical
                className="models-grip"
                size={14}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              className="models-item-main"
              title={m.model}
              onClick={() => onOpen(m.id)}
            >
              <span className="models-name">{modelName(m.model)}</span>
              <span className="muted small">{t(`models.conn.${m.connection}`)}</span>
              <span className={`models-badge ${m.privacy}`}>
                {t(`models.privacy.${m.privacy}`)}
              </span>
              {m.server && <span className="models-badge">{t("models.fromServer")}</span>}
              {m.tags.map((g) => (
                <span key={g.id} className="models-tag">
                  {g.name}
                </span>
              ))}
              <span className="models-mark">{markText(t, m)}</span>
              <span className="models-amount">{m.eur > 0 ? `${eur(m.eur)} €` : "—"}</span>
            </button>
            {moves && (
              <MenuButton
                className="icon-btn models-move"
                label=""
                ariaLabel={`${t("models.move")} · ${modelName(m.model)}`}
                icon={<MoreHorizontal size={15} strokeWidth={1.8} />}
                items={[
                  ...(i > 0 ? [{ id: "up", label: t("models.up") }] : []),
                  ...(i < own.length - 1 ? [{ id: "down", label: t("models.down") }] : []),
                ]}
                onPick={(id) => {
                  const to = own[id === "up" ? i - 1 : i + 1];
                  if (to) void order(moved(own, m.id, to));
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The month's budget line and its change (under the spending tile). */
export function Budget({
  t,
  view,
  eur,
  readOnly,
  onChanged,
}: {
  t: T;
  view: View;
  eur: Eur;
  readOnly: boolean;
  onChanged: (v: View) => void;
}) {
  const [edit, setEdit] = useState<{ monthly: string; warn: string; rate: string } | null>(null);
  const { budget } = view;
  const save = async () => {
    if (!edit) return;
    const monthlyEur = Number(edit.monthly.replace(",", "."));
    const warnAt = Number(edit.warn.replace(",", ".")) / 100;
    const usdToEur = Number(edit.rate.replace(",", "."));
    try {
      const v = await agentApi.setModelBudget({ monthlyEur, warnAt, usdToEur });
      if (v) onChanged(v);
      setEdit(null);
      toast(t("models.saved"));
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  return (
    <section className="card models-card open models-spend">
      <div className="models-more">
        {edit ? (
          <div className="models-form">
            <label>
              <span>{t("models.monthly")}</span>
              <input
                inputMode="decimal"
                value={edit.monthly}
                onChange={(e) => setEdit({ ...edit, monthly: e.target.value })}
              />
            </label>
            <label>
              <span>{t("models.warnAt")}</span>
              <input
                inputMode="numeric"
                value={edit.warn}
                onChange={(e) => setEdit({ ...edit, warn: e.target.value })}
              />
            </label>
            <label>
              <span>{t("models.rate")}</span>
              <input
                inputMode="decimal"
                value={edit.rate}
                onChange={(e) => setEdit({ ...edit, rate: e.target.value })}
              />
            </label>
            <span className="models-actions">
              <button type="button" className="btn" onClick={() => setEdit(null)}>
                {t("models.cancel")}
              </button>
              <button type="button" className="btn primary" onClick={() => void save()}>
                {t("models.save")}
              </button>
            </span>
          </div>
        ) : (
          <p className="models-line">
            <span className="muted">
              {/* Without a budget (0) there is neither a cap nor a warning; with «Aviso del presupuesto» off (one
                  of Boni's flows), nothing is told at the warning. */}
              {t(
                budget.monthlyEur > 0
                  ? view.notice
                    ? "models.budget"
                    : "models.budgetQuiet"
                  : "models.budgetNone",
                { eur: eur(budget.monthlyEur), pct: Math.round(budget.warnAt * 100) },
              )}
            </span>
            {!readOnly && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() =>
                  setEdit({
                    monthly: String(budget.monthlyEur),
                    warn: String(Math.round(budget.warnAt * 100)),
                    rate: String(view.usdToEur),
                  })
                }
              >
                {t("models.budgetEdit")}
              </button>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

/** The cases of an evaluation, each failed one with who failed and what, in words (task 132, I-40). */
function Cases({ t, cases }: { t: T; cases: EvalCase[] }) {
  return (
    <ul className="models-cases">
      {cases.map((c, i) => {
        const why = c.ok ? null : evalFailText(t, c.failed);
        return (
          <li key={i} className={c.ok ? "ok" : "fail"}>
            <span>{c.ok ? "✓" : "✕"}</span> <span className="models-case">{c.name}</span>
            {why && <span className="muted small"> · {why}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * «Claves»: each connection's key, put and removed here, never shown again. Removing one asks first where the models
 * of its connection are used (AU-233): the server says it without changing anything (`dry`).
 */
export function Connections({
  t,
  view,
  open,
  readOnly,
  onToggle,
  onChanged,
}: {
  t: T;
  view: View;
  open: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onChanged: (v: View) => void;
}) {
  const lang = useStore((s) => s.settings.language);
  const [typing, setTyping] = useState<{ connection: ModelConnection; key: string } | null>(null);
  const [asking, setAsking] = useState<{ connection: ModelConnection; lines: string[] } | null>(
    null,
  );
  const save = async (connection: ModelConnection, key: string | null) => {
    try {
      const v = await agentApi.setModelKey(connection, key);
      if (v) onChanged(v);
      setTyping(null);
      setAsking(null);
      toast(t("models.saved"));
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  const remove = async (connection: ModelConnection) => {
    try {
      const where = (await agentApi.keyUses(connection)).filter(
        (w) => used(w) || w.tagsLeft.length > 0,
      );
      if (!where.length) return void (await save(connection, null));
      setAsking({
        connection,
        lines: where.flatMap((w) => [
          ...(used(w)
            ? [t("models.keyAsk", { model: nameOfId(w.id), where: whereText(t, lang, w) })]
            : []),
          ...askLines(t, lang, { ...w, rows: [], automations: 0, conversations: 0 }),
        ]),
      });
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  const mine = view.connections.filter((c) => c.mine).length;
  return (
    <section className={`card models-card${open ? " open" : ""}`}>
      <button type="button" className="models-row" aria-expanded={open} onClick={onToggle}>
        <span className="models-row-main">
          <span className="models-name">{t("models.connections")}</span>
          <span className="muted small">
            {view.connections
              .filter((c) => c.mine || c.server)
              .map((c) => t(`models.conn.${c.connection}`))
              .join(", ")}
          </span>
        </span>
        {mine > 0 && <KeyRound size={14} strokeWidth={1.8} aria-hidden="true" />}
        {open ? (
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="models-more">
          <p className="models-line muted">{t("models.keyHelp")}</p>
          <ul className="models-list">
            {MODEL_CONNECTIONS.map((connection) => {
              const c = view.connections.find((x) => x.connection === connection);
              const state = c?.mine
                ? t("models.connMine")
                : c?.server
                  ? t("models.connServer")
                  : t("models.connNone");
              return (
                <li key={connection} className="models-conn">
                  <span className="models-list-main">
                    {t(`models.conn.${connection}`)}
                    <span className="muted small"> · {state}</span>
                  </span>
                  {asking?.connection === connection ? (
                    <Ask
                      t={t}
                      lines={asking.lines}
                      yes={t("models.removeKey")}
                      onYes={() => void save(connection, null)}
                      onNo={() => setAsking(null)}
                    />
                  ) : typing?.connection === connection ? (
                    <form
                      className="models-key"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (typing.key.trim()) void save(connection, typing.key.trim());
                      }}
                    >
                      <input
                        type="password"
                        autoComplete="off"
                        aria-label={t("models.keyLabel", { conn: t(`models.conn.${connection}`) })}
                        value={typing.key}
                        onChange={(e) => setTyping({ connection, key: e.target.value })}
                      />
                      <button type="button" className="btn" onClick={() => setTyping(null)}>
                        {t("models.cancel")}
                      </button>
                      <button type="submit" className="btn primary" disabled={!typing.key.trim()}>
                        {t("models.save")}
                      </button>
                    </form>
                  ) : (
                    !readOnly && (
                      <span className="models-actions">
                        {c?.mine && (
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() => void remove(connection)}
                          >
                            {t("models.removeKey")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => setTyping({ connection, key: "" })}
                        >
                          {t("models.setKey")}
                        </button>
                      </span>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A panel in the list's place, closed with its «×» or Escape (before the app's own Escape, which leaves Ajustes). */
function Panel({
  t,
  title,
  onClose,
  children,
}: {
  t: T;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <aside className="side-panel models-panel" aria-label={title}>
      <header className="panel-head">
        <h2 title={title}>{title}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          title={t("models.close")}
          aria-label={t("models.close")}
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>
      <div className="panel-body models-panel-body">{children}</div>
    </aside>
  );
}

/**
 * «Añadir modelo» (AU-233): the finder of before, OpenRouter's catalogue with the route that keeps nothing, and the
 * decision models; a model added enters at the end of the list, «Sin evaluar», offered nowhere until evaluated.
 */
export function AddPanel({
  t,
  view,
  onClose,
  onAdded,
}: {
  t: T;
  view: View | null;
  onClose: () => void;
  onAdded: (l: ModelsList, c: ModelChoice) => void;
}) {
  const lang = useStore((s) => s.settings.language);
  const usd = (x: number) =>
    new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", { maximumFractionDigits: 3 }).format(
      x,
    );
  const [catalogue, setCatalogue] = useState<CatalogueModel[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ModelChoice | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    agentApi
      .catalogue()
      .then(setCatalogue)
      .catch(() => setFailed(true));
  }, []);
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (catalogue ?? [])
        .filter((m) => !q || `${m.name} ${m.id}`.toLowerCase().includes(q))
        .sort((a, b) => a.input + a.output - (b.input + b.output))
        .slice(0, 60),
    [catalogue, q],
  );
  const hasKey = (c: ModelConnection) =>
    view?.connections.some((x) => x.connection === c && (x.mine || x.server)) ?? true;
  const add = async () => {
    if (!picked) return;
    setProblem(null);
    try {
      const l = await agentApi.addModel(picked);
      if (l) onAdded(l, picked);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setProblem(
        code === "exists"
          ? t("models.exists")
          : code === "full"
            ? t("models.full")
            : errorText(t, e),
      );
    }
  };
  const option = (o: ModelChoice, item?: CatalogueModel) => (
    <li key={`${o.connection}|${o.model}`}>
      <button
        type="button"
        className={`models-option${picked && same(picked, o) ? " on" : ""}`}
        aria-pressed={!!picked && same(picked, o)}
        title={o.model}
        onClick={() => setPicked(o)}
      >
        <span className="models-name">{item?.name ?? o.model}</span>
        {item ? (
          <>
            <span className="muted small">
              {t("models.perM", { in: usd(item.input), out: usd(item.output) })}
            </span>
            <span className="muted small">
              {t("models.providers", { n: item.providers.length })}
            </span>
          </>
        ) : (
          <span className="muted small">{t(`models.conn.${o.connection}`)}</span>
        )}
      </button>
    </li>
  );
  return (
    <Panel t={t} title={t("models.add")} onClose={onClose}>
      <label className="cols-search">
        <Search size={14} strokeWidth={1.8} aria-hidden />
        <input
          value={query}
          placeholder={t("models.search")}
          aria-label={t("models.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {!catalogue && !failed && (
        <p className="muted small" role="status">
          {t("models.loadingCatalogue")}
        </p>
      )}
      {failed && <p className="decide-error">{t("models.noCatalogue")}</p>}
      {catalogue && shown.length === 0 && <p className="muted small">{t("models.empty")}</p>}
      <ul className="models-pick">
        {shown.map((m) => option({ connection: "openrouter", model: m.id, zdr: true }, m))}
        {!q && (
          <li className="models-sub" aria-hidden="true">
            {t("models.deciders")}
          </li>
        )}
        {!q && DECIDERS.map((d) => option(d))}
      </ul>
      {picked && (
        <div className="models-compare">
          <p className="models-line">{picked.model}</p>
          {!hasKey(picked.connection) && (
            <p className="models-line muted">
              {t("models.needsKeyOf", { conn: t(`models.conn.${picked.connection}`) })}
            </p>
          )}
          {problem && (
            <p className="decide-error" role="alert">
              {problem}
            </p>
          )}
          <span className="models-actions">
            <button type="button" className="btn primary" onClick={() => void add()}>
              {t("models.addThis")}
            </button>
          </span>
        </div>
      )}
    </Panel>
  );
}

/**
 * A model opened from the list (AU-232 to AU-237): its route and privacy, «Etiquetas», «Evaluación» with «Ver los
 * casos» in their groups and «Evaluar», «Se usa en», its month and «Quitar». Names and values, no explanations.
 */
export function ModelPanel({
  t,
  model: m,
  list,
  eur,
  readOnly,
  onClose,
  onList,
}: {
  t: T;
  model: ListedModel;
  list: ModelsList;
  eur: Eur;
  readOnly: boolean;
  onClose: () => void;
  onList: (l: ModelsList) => void;
}) {
  const lang = useStore((s) => s.settings.language);
  const locale = lang === "en" ? "en-GB" : "es-ES";
  const [parts, setParts] = useState<ModelParts | null>(null);
  const [showCases, setShowCases] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [ask, setAsk] = useState<
    { what: "tags"; tags: string[]; lines: string[] } | { what: "remove"; lines: string[] } | null
  >(null);
  const tags = !readOnly && !m.server;
  const running = list.evaluating === m.id;
  // A finished evaluation brings new cases: asked again when they are open.
  const at = m.evaluation?.at ?? 0;
  useEffect(() => {
    if (!showCases) return;
    let gone = false;
    agentApi
      .modelEvaluation(m.id)
      .then((p) => !gone && setParts(p))
      .catch((e) => !gone && setProblem(errorText(t, e)));
    return () => {
      gone = true;
    };
  }, [showCases, m.id, at]);
  const fail = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : "";
    setProblem(
      code === "no-key"
        ? t("models.needsKeyOf", { conn: t(`models.conn.${m.connection}`) })
        : code === "busy"
          ? t("models.busy")
          : errorText(t, e),
    );
  };
  const setTags = async (next: string[], confirm: boolean) => {
    setProblem(null);
    try {
      const r = await agentApi.tagModel(m.id, next, confirm);
      if (r && "where" in r)
        setAsk({ what: "tags", tags: next, lines: askLines(t, lang, r.where) });
      else if (r) {
        setAsk(null);
        onList(r);
      }
    } catch (e) {
      fail(e);
    }
  };
  const addTag = async () => {
    const name = typed.trim();
    if (!name) return;
    setProblem(null);
    try {
      const id = list.tags.find((g) => g.name === name)?.id ?? (await agentApi.addTag(name));
      if (!id) return;
      setTyped("");
      if (!m.tags.some((g) => g.id === id)) await setTags([...m.tags.map((g) => g.id), id], false);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setProblem(
        code === "full"
          ? t("models.tagsFull")
          : code === "invalid" || code === "bad-request"
            ? t("models.tagInvalid")
            : errorText(t, e),
      );
    }
  };
  const remove = async (confirm: boolean) => {
    setProblem(null);
    try {
      const r = await agentApi.removeModel(m.id, confirm);
      if (r && "where" in r) setAsk({ what: "remove", lines: askLines(t, lang, r.where) });
      else if (r) {
        onClose();
        onList(r);
      }
    } catch (e) {
      fail(e);
    }
  };
  const evaluate = async () => {
    setProblem(null);
    try {
      const l = await agentApi.evaluateListed(m.id);
      if (l) onList(l);
    } catch (e) {
      fail(e);
    }
  };
  const date = (ms: number) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: deviceZone() }).format(ms);
  const u = m.uses;
  return (
    <Panel t={t} title={modelName(m.model)} onClose={onClose}>
      <div className="role-detail">
        <p className="muted small">
          {m.model} · {t(`models.conn.${m.connection}`)}
        </p>
        <span className="models-line">
          <span className={`models-badge ${m.privacy}`}>{t(`models.privacy.${m.privacy}`)}</span>
          {m.server && <span className="models-badge">{t("models.fromServer")}</span>}
        </span>
      </div>
      <section className="models-part" aria-label={t("models.tags")}>
        <h3 className="models-sub">{t("models.tags")}</h3>
        <span className="models-line">
          {m.tags.map((g) => (
            <span key={g.id} className="models-tag">
              {g.name}
              {tags && (
                <button
                  type="button"
                  className="models-tag-x"
                  aria-label={t("models.tagRemove", { tag: g.name })}
                  title={t("models.tagRemove", { tag: g.name })}
                  onClick={() =>
                    void setTags(
                      m.tags.filter((x) => x.id !== g.id).map((x) => x.id),
                      false,
                    )
                  }
                >
                  <X size={11} strokeWidth={2} />
                </button>
              )}
            </span>
          ))}
        </span>
        {tags && (
          <form
            className="models-key"
            onSubmit={(e) => {
              e.preventDefault();
              void addTag();
            }}
          >
            <input
              list="models-tag-names"
              maxLength={24}
              aria-label={t("models.tagName")}
              placeholder={t("models.tagName")}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <datalist id="models-tag-names">
              {list.tags
                .filter((g) => !m.tags.some((x) => x.id === g.id))
                .map((g) => (
                  <option key={g.id} value={g.name} />
                ))}
            </datalist>
            <button type="submit" className="btn" disabled={!typed.trim()}>
              {t("models.tagAdd")}
            </button>
          </form>
        )}
        {ask?.what === "tags" && (
          <Ask
            t={t}
            lines={ask.lines}
            yes={t("models.save")}
            onYes={() => void setTags(ask.tags, true)}
            onNo={() => setAsk(null)}
          />
        )}
      </section>
      <section className="models-part" aria-label={t("models.evaluation")}>
        <h3 className="models-sub">{t("models.evaluation")}</h3>
        <p className="models-line">
          <span className="models-mark">{markText(t, m)}</span>
          {m.evaluation && (
            <span className="muted small">
              {t("models.evaluatedOn", { date: date(m.evaluation.at), eur: eur(m.cost ?? 0) })}
            </span>
          )}
          {m.evaluation && (
            <button
              type="button"
              className="btn ghost small"
              aria-expanded={showCases}
              onClick={() => setShowCases(!showCases)}
            >
              {t("models.cases")}
            </button>
          )}
        </p>
        {showCases &&
          parts &&
          (["agent", "reading", "decision"] as const).map((k) => {
            const p = parts.parts[k];
            return p ? (
              <div key={k} className="models-cases-part">
                <h4 className="models-sub">
                  {t("models.part", {
                    kind: t(`models.kind.${k}`),
                    right: p.right,
                    total: p.total,
                  })}
                </h4>
                <Cases t={t} cases={p.cases} />
              </div>
            ) : null;
          })}
        {running && (
          <p className="muted small" role="status">
            {t("models.evaluating")}
          </p>
        )}
        {!readOnly && (
          <span className="models-actions">
            <button
              type="button"
              className="btn"
              disabled={!!list.evaluating}
              onClick={() => void evaluate()}
            >
              {t("models.evaluate")}
            </button>
          </span>
        )}
      </section>
      <section className="models-part" aria-label={t("models.usedIn")}>
        <h3 className="models-sub">{t("models.usedIn")}</h3>
        <p className="models-line">{used(u) ? whereText(t, lang, u) : t("models.unused")}</p>
        <p className="models-line">{t("models.monthEur", { eur: eur(m.eur) })}</p>
      </section>
      {problem && (
        <p className="decide-error" role="alert">
          {problem}
        </p>
      )}
      {ask?.what === "remove" && (
        <Ask
          t={t}
          lines={ask.lines}
          yes={t("models.remove")}
          onYes={() => void remove(true)}
          onNo={() => setAsk(null)}
        />
      )}
      {!readOnly && !m.server && !ask && (
        <span className="models-actions">
          <button type="button" className="btn danger" onClick={() => void remove(false)}>
            {t("models.remove")}
          </button>
        </span>
      )}
    </Panel>
  );
}
