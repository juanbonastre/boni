import { ChevronDown, ChevronRight, KeyRound, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type CatalogueModel,
  MODEL_CONNECTIONS,
  type ModelChoice,
  type ModelConnection,
  type ModelEvaluation,
  type ModelRole,
  type ModelRoleView,
  type ModelsView as View,
} from "../core/agent.ts";
import { ApiError } from "../core/api.ts";
import { agentApi, errorText, showLog, toast, useStore } from "../store.ts";

type T = ReturnType<typeof useStore.getState>["t"];
const same = (a: ModelChoice, b: ModelChoice) =>
  a.connection === b.connection && a.model === b.model && a.zdr === b.zdr;
/** Jev, the decider: the code's choices only, on TypeSafe or through OpenRouter. */
const DECIDERS: ModelChoice[] = [
  { connection: "openrouter", model: "typesafe/jev-1.14", zdr: false },
  { connection: "typesafe", model: "jev-1.14.0", zdr: false },
];

/**
 * «Modelos» (Juan, 2026-10-24, option A): one page in sections. The month's spending against the budget, which
 * model does each role (a click shows its route, what it does with the data, what it spent and its evaluation),
 * the connections folded, and the log for what each model did. «Cambiar» opens the panel on the right: a model of
 * OpenRouter's that some provider serves keeping nothing, its evaluation next to the current one's, and then use
 * it (the server refuses a model without a recent evaluation).
 */
export function ModelsView() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<ModelRole | null>(null);
  const load = async () => {
    try {
      setView(await agentApi.models());
      setError(null);
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  // While an evaluation runs, look again every few seconds.
  useEffect(() => {
    if (!view?.evaluating) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [view?.evaluating]);
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const eur = (x: number) =>
    new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(x);
  const month = view?.spending.month
    ? new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${view.spending.month}-01T12:00:00Z`))
    : "";
  return (
    <div className="models-view">
      <div className="content page-doc full">
        <div className="doc models">
          <h1 className="cols-title">{t("nav.models")}</h1>
          <p className="cols-help">{t("models.help")}</p>
          {error && (
            <p className="decide-error" role="alert">
              {error}
            </p>
          )}
          {!view && !error && <div className="page-loading" role="status" aria-busy="true" />}
          {view && (
            <>
              <Spending
                t={t}
                view={view}
                month={month}
                eur={eur}
                open={open.has("spend")}
                onToggle={() => toggle("spend")}
                onChanged={setView}
              />
              <h2 className="models-section">{t("models.roles")}</h2>
              {view.roles.length === 0 && <p className="muted">{t("models.noRoles")}</p>}
              {view.roles.map((r) => (
                <RoleRow
                  key={r.role}
                  t={t}
                  r={r}
                  view={view}
                  eur={eur}
                  open={open.has(r.role)}
                  onToggle={() => toggle(r.role)}
                  onChange={() => setPanel(r.role)}
                  onChanged={setView}
                />
              ))}
              <Connections
                t={t}
                view={view}
                open={open.has("connections")}
                onToggle={() => toggle("connections")}
                onChanged={setView}
              />
              <button type="button" className="models-row models-link" onClick={showLog}>
                <span className="models-row-main">
                  <span className="models-name">{t("models.activity")}</span>
                  <span className="muted small">{t("models.toLog")}</span>
                </span>
                <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      {view && panel && (
        <ChangePanel
          t={t}
          role={panel}
          view={view}
          onClose={() => setPanel(null)}
          onChanged={setView}
        />
      )}
    </div>
  );
}

function Spending({
  t,
  view,
  month,
  eur,
  open,
  onToggle,
  onChanged,
}: {
  t: T;
  view: View;
  month: string;
  eur: (x: number) => string;
  open: boolean;
  onToggle: () => void;
  onChanged: (v: View) => void;
}) {
  const [edit, setEdit] = useState<{ monthly: string; warn: string; rate: string } | null>(null);
  const { budget, spending } = view;
  const share = budget.monthlyEur > 0 ? Math.min(1, spending.eur / budget.monthlyEur) : 0;
  const max = Math.max(...spending.byDay.map((d) => d.eur), 0.0001);
  const roleName = (role: string) =>
    role.startsWith("eval-")
      ? t("models.evalOf", { role: t(`models.role.${role.slice(5)}`) })
      : t(`models.role.${role}`);
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
    <section className={`card models-card${open ? " open" : ""}`}>
      <button type="button" className="models-row" aria-expanded={open} onClick={onToggle}>
        <span className="models-row-main">
          <span className="models-name">{t("models.spend", { month })}</span>
          <span className="models-bar" aria-hidden="true">
            <span
              className={`models-bar-fill${view.over ? " over" : share >= budget.warnAt ? " warn" : ""}`}
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </span>
        </span>
        <span className="models-amount">
          {t("models.spendOf", { eur: eur(spending.eur), budget: eur(budget.monthlyEur) })}
        </span>
        {open ? (
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      {view.over && <p className="models-warn">{t("models.over")}</p>}
      {open && (
        <div className="models-more">
          {spending.rows.length > 0 && (
            <>
              <h3 className="models-sub">{t("models.byModel")}</h3>
              <ul className="models-list">
                {spending.rows.map((r) => (
                  <li key={`${r.role}|${r.provider}|${r.model}`}>
                    <span className="models-list-main">
                      {roleName(r.role)} · {r.model}
                      <span className="muted small">
                        {" "}
                        · {t("models.calls", { n: r.calls })}
                        {r.unpriced > 0 ? ` · ${t("models.unpriced", { n: r.unpriced })}` : ""}
                      </span>
                    </span>
                    <span className="models-amount">{eur(r.eur)} €</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {spending.byDay.length > 0 && (
            <>
              <h3 className="models-sub">{t("models.byDay")}</h3>
              <div className="models-days">
                {spending.byDay.map((d) => (
                  <span
                    key={d.day}
                    className="models-day"
                    title={`${d.day}: ${eur(d.eur)} €`}
                    style={{ height: `${Math.max(4, Math.round((d.eur / max) * 48))}px` }}
                  />
                ))}
              </div>
            </>
          )}
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
                {t("models.budget", {
                  eur: eur(budget.monthlyEur),
                  pct: Math.round(budget.warnAt * 100),
                })}
              </span>
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
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const lastEval = (view: View, role: ModelRole, c: ModelChoice): ModelEvaluation | undefined =>
  view.evaluations.find((e) => e.role === role && same(e, c));

function RoleRow({
  t,
  r,
  view,
  eur,
  open,
  onToggle,
  onChange,
  onChanged,
}: {
  t: T;
  r: ModelRoleView;
  view: View;
  eur: (x: number) => string;
  open: boolean;
  onToggle: () => void;
  onChange: () => void;
  onChanged: (v: View) => void;
}) {
  const [cases, setCases] = useState(false);
  const rows = view.spending.rows.filter((x) => x.role === r.role);
  const spent = rows.reduce((a, x) => a + x.eur, 0);
  const calls = rows.reduce((a, x) => a + x.calls, 0);
  const ev = lastEval(view, r.role, r);
  const back = async () => {
    try {
      const v = await agentApi.setModelRole(r.role, null);
      if (v) onChanged(v);
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  return (
    <section className={`card models-card${open ? " open" : ""}`}>
      <button type="button" className="models-row" aria-expanded={open} onClick={onToggle}>
        <span className="models-row-main">
          <span className="models-name">{t(`models.role.${r.role}`)}</span>
          <span className="muted small models-route">
            {r.model} · {t(`models.conn.${r.connection}`)} · {eur(spent)} €
          </span>
          <span className={`models-badge ${r.privacy}`}>{t(`models.privacy.${r.privacy}`)}</span>
        </span>
        {open ? (
          <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="models-more">
          <p className="models-line muted">{t(`models.roleHelp.${r.role}`)}</p>
          <p className="models-line">{t(`models.privacyHelp.${r.privacy}`)}</p>
          <p className="models-line">
            {r.chosen ? t("models.chosen") : t("models.server")}
            {r.missingKey
              ? ` · ${t("models.missingKey", { conn: t(`models.conn.${r.connection}`) })}`
              : ""}
          </p>
          <p className="models-line">
            {t("models.thisMonth", { eur: eur(spent), calls: t("models.calls", { n: calls }) })}
          </p>
          <p className="models-line">
            {ev ? t("models.lastEval", { right: ev.right, total: ev.total }) : t("models.noEval")}
            {ev && ev.cases.length > 0 && (
              <button
                type="button"
                className="btn ghost small"
                aria-expanded={cases}
                onClick={() => setCases(!cases)}
              >
                {t("models.cases")}
              </button>
            )}
          </p>
          {ev && cases && <Cases ev={ev} />}
          <span className="models-actions">
            {r.chosen && (
              <button type="button" className="btn" onClick={() => void back()}>
                {t("models.backToServer")}
              </button>
            )}
            <button type="button" className="btn primary" onClick={onChange}>
              {t("models.change")}
            </button>
          </span>
        </div>
      )}
    </section>
  );
}

function Cases({ ev }: { ev: ModelEvaluation }) {
  return (
    <ul className="models-cases">
      {ev.cases.map((c, i) => (
        <li key={i} className={c.ok ? "ok" : "fail"}>
          <span>{c.ok ? "✓" : "✕"}</span> <span className="models-case">{c.name}</span>
          {c.note && <span className="muted small"> · {c.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function Connections({
  t,
  view,
  open,
  onToggle,
  onChanged,
}: {
  t: T;
  view: View;
  open: boolean;
  onToggle: () => void;
  onChanged: (v: View) => void;
}) {
  const [typing, setTyping] = useState<{ connection: ModelConnection; key: string } | null>(null);
  const save = async (connection: ModelConnection, key: string | null) => {
    try {
      const v = await agentApi.setModelKey(connection, key);
      if (v) onChanged(v);
      setTyping(null);
      toast(t("models.saved"));
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
                  {typing?.connection === connection ? (
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
                    <span className="models-actions">
                      {c?.mine && (
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => void save(connection, null)}
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

function ChangePanel({
  t,
  role,
  view,
  onClose,
  onChanged,
}: {
  t: T;
  role: ModelRole;
  view: View;
  onClose: () => void;
  onChanged: (v: View) => void;
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
  const current = view.roles.find((r) => r.role === role);
  useEffect(() => {
    if (role === "decider") return;
    agentApi
      .catalogue()
      .then(setCatalogue)
      .catch(() => setFailed(true));
  }, [role]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    };
    // Before the app's own Escape (which would leave the page).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const q = query.trim().toLowerCase();
  // Readers answer a fixed form: only models some provider of which takes a JSON schema.
  const shown = useMemo(
    () =>
      (catalogue ?? [])
        .filter((m) => role === "planner" || m.structured)
        .filter((m) => !q || `${m.name} ${m.id}`.toLowerCase().includes(q))
        .sort((a, b) => a.input + a.output - (b.input + b.output))
        .slice(0, 60),
    [catalogue, q, role],
  );
  const candidate = picked ? lastEval(view, role, picked) : undefined;
  const now = current ? lastEval(view, role, current) : undefined;
  const running =
    view.evaluating && picked && view.evaluating.role === role && same(view.evaluating, picked);
  const evaluate = async () => {
    if (!picked) return;
    setProblem(null);
    try {
      const v = await agentApi.evaluateModel(role, picked);
      if (v) onChanged(v);
      else onChanged(await agentApi.models().then((x) => x ?? view));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setProblem(
        code === "no-key"
          ? t("models.needsKey")
          : code === "busy"
            ? t("models.busy")
            : errorText(t, e),
      );
    }
  };
  const use = async () => {
    if (!picked) return;
    try {
      const v = await agentApi.setModelRole(role, picked);
      if (v) onChanged(v);
      toast(t("models.saved"));
      onClose();
    } catch (e) {
      setProblem(
        e instanceof ApiError && e.code === "needs-evaluation"
          ? t("models.needsEvaluation")
          : errorText(t, e),
      );
    }
  };
  const options: (ModelChoice & { item?: CatalogueModel })[] =
    role === "decider"
      ? DECIDERS
      : shown.map((m) => ({ connection: "openrouter" as const, model: m.id, zdr: true, item: m }));
  return (
    <aside className="side-panel models-panel" aria-label={t(`models.role.${role}`)}>
      <header className="panel-head">
        <h2>{t(`models.role.${role}`)}</h2>
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
      <div className="panel-body models-panel-body">
        <p className="muted small">{t("models.pick")}</p>
        {role !== "decider" && (
          <label className="cols-search">
            <Search size={14} strokeWidth={1.8} aria-hidden />
            <input
              value={query}
              placeholder={t("models.search")}
              aria-label={t("models.search")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {role !== "decider" && !catalogue && !failed && (
          <p className="muted small" role="status">
            {t("models.loadingCatalogue")}
          </p>
        )}
        {failed && <p className="decide-error">{t("models.noCatalogue")}</p>}
        {catalogue && shown.length === 0 && <p className="muted small">{t("models.empty")}</p>}
        <ul className="models-pick">
          {options.map((o) => (
            <li key={`${o.connection}|${o.model}`}>
              <button
                type="button"
                className={`models-option${picked && same(picked, o) ? " on" : ""}`}
                aria-pressed={!!picked && same(picked, o)}
                title={o.model}
                onClick={() => setPicked({ connection: o.connection, model: o.model, zdr: o.zdr })}
              >
                <span className="models-name">{o.item?.name ?? o.model}</span>
                {o.item ? (
                  <>
                    <span className="muted small">
                      {t("models.perM", { in: usd(o.item.input), out: usd(o.item.output) })}
                    </span>
                    <span className="muted small">
                      {t("models.providers", { n: o.item.providers.length })}
                    </span>
                  </>
                ) : (
                  <span className="muted small">{t(`models.conn.${o.connection}`)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {picked && (
          <div className="models-compare">
            {current && (
              <p className="models-line">
                <span className="muted">{t("models.now")}:</span> {current.model} ·{" "}
                {now
                  ? t("models.score", { right: now.right, total: now.total })
                  : t("models.noEval")}
              </p>
            )}
            <p className="models-line">
              <span className="muted">{t("models.candidate")}:</span> {picked.model} ·{" "}
              {candidate
                ? `${t("models.score", { right: candidate.right, total: candidate.total })}${candidate.wrong ? ` · ${t("models.wrongN", { n: candidate.wrong })}` : ""} · ${t("models.evalCost", { usd: usd(candidate.cost) })}`
                : running
                  ? t("models.evaluating")
                  : t("models.noEval")}
            </p>
            {candidate && candidate.cases.length > 0 && <Cases ev={candidate} />}
            {problem && (
              <p className="decide-error" role="alert">
                {problem}
              </p>
            )}
            <span className="models-actions">
              <button
                type="button"
                className="btn"
                disabled={!!view.evaluating}
                onClick={() => void evaluate()}
              >
                {t("models.evaluate")}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!candidate}
                onClick={() => void use()}
              >
                {t("models.use")}
              </button>
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
