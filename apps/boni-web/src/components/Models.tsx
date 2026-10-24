import {
  ChevronDown,
  ChevronRight,
  GraduationCap,
  KeyRound,
  Mail,
  Route,
  Search,
  Split,
  X,
} from "lucide-react";
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
import { type AuditSummary, shortModel } from "../core/audit.ts";
import { agentApi, errorText, showLog, toast, useStore } from "../store.ts";
import { BarList, COLORS, DashChart, dailyChart, daysOf, Kpi } from "./Dash.tsx";

type T = ReturnType<typeof useStore.getState>["t"];
const same = (a: ModelChoice, b: ModelChoice) =>
  a.connection === b.connection && a.model === b.model && a.zdr === b.zdr;
/** Jev, the decider: the code's choices only, on TypeSafe or through OpenRouter. */
const DECIDERS: ModelChoice[] = [
  { connection: "openrouter", model: "typesafe/jev-1.14", zdr: false },
  { connection: "typesafe", model: "jev-1.14.0", zdr: false },
];

/**
 * «Modelos» (Juan, 2026-10-24): a dashboard. The month's numbers first (spending against the budget, calls, what the
 * models read and changed), then the four uses with the model of each in large type, and the charts beside them
 * (spending per day by model, calls per model). A click opens the detail: the spending tile its breakdown and the
 * budget; a use its panel on the right (what it does, how it treats the data, its evaluation, «Cambiar»: a model of
 * OpenRouter's that some provider serves keeping nothing, evaluated before it is used).
 */
export function ModelsView() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [view, setView] = useState<View | null>(null);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
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
  // What the models read and changed this month (the audit; only a personal device may read it).
  useEffect(() => {
    if (!view?.spending.month) return;
    const from = Date.parse(`${view.spending.month}-01T00:00:00Z`);
    agentApi
      .auditSummary(from, Date.now())
      .then(setAudit)
      .catch(() => setAudit(null));
  }, [view?.spending.month]);
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
  const nf = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES");
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
  const ai = (by: string) => by.startsWith("model:") || by.startsWith("mcp:");
  const reads = audit
    ? audit.activity.filter((r) => ai(r.by)).reduce((n, r) => n + r.reads, 0)
    : null;
  const writes = audit
    ? audit.activity.filter((r) => ai(r.by) || r.by === "agent").reduce((n, r) => n + r.writes, 0)
    : null;
  return (
    <div className="models-view">
      <div className="content dash">
        <header className="dash-head">
          <h1 className="dash-title">{t("nav.models")}</h1>
          {month && <span className="muted">{month}</span>}
        </header>
        {error && (
          <p className="decide-error" role="alert">
            {error}
          </p>
        )}
        {!view && !error && <div className="page-loading" role="status" aria-busy="true" />}
        {view && (
          <>
            <div className="kpis">
              <Kpi
                label={t("models.kpi.spend")}
                value={`${eur(view.spending.eur)} €`}
                note={t("models.kpi.of", { budget: eur(view.budget.monthlyEur) })}
                meter={{
                  share:
                    view.budget.monthlyEur > 0 ? view.spending.eur / view.budget.monthlyEur : 0,
                  state: view.over
                    ? "over"
                    : view.spending.eur >= view.budget.monthlyEur * view.budget.warnAt
                      ? "warn"
                      : "ok",
                }}
                expanded={open.has("spend")}
                onClick={() => toggle("spend")}
              />
              <Kpi
                label={t("models.kpi.calls")}
                value={nf.format(view.spending.rows.reduce((n, r) => n + r.calls, 0))}
              />
              <Kpi
                label={t("models.kpi.reads")}
                value={reads === null ? "—" : nf.format(reads)}
                note={t("models.kpi.readsNote")}
              />
              <Kpi
                label={t("models.kpi.writes")}
                value={writes === null ? "—" : nf.format(writes)}
                note={t("models.kpi.writesNote")}
              />
            </div>
            {view.over && <p className="models-warn">{t("models.over")}</p>}
            {open.has("spend") && <Spending t={t} view={view} eur={eur} onChanged={setView} />}
            <div className="dash-grid">
              <section className="dash-col">
                <h2 className="dash-h2">{t("models.roles")}</h2>
                {view.roles.length === 0 && <p className="muted">{t("models.noRoles")}</p>}
                <div className="uses">
                  {view.roles.map((r) => (
                    <RoleCard
                      key={r.role}
                      t={t}
                      r={r}
                      view={view}
                      eur={eur}
                      on={panel === r.role}
                      onOpen={() => setPanel(panel === r.role ? null : r.role)}
                    />
                  ))}
                </div>
                <Connections
                  t={t}
                  view={view}
                  open={open.has("connections")}
                  onToggle={() => toggle("connections")}
                  onChanged={setView}
                />
              </section>
              <section className="dash-col">
                <h2 className="dash-h2">{t("models.byDayChart")}</h2>
                <SpendChart t={t} view={view} />
                <h2 className="dash-h2">{t("models.callsChart")}</h2>
                <BarList
                  rows={callsByModel(view)}
                  series={[{ name: t("models.kpi.calls"), color: "var(--accent)" }]}
                  format={(n) => nf.format(n)}
                  empty={t("models.noCalls")}
                />
              </section>
            </div>
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
      {view && panel && (
        <RolePanel
          t={t}
          role={panel}
          view={view}
          eur={eur}
          onClose={() => setPanel(null)}
          onChanged={setView}
        />
      )}
    </div>
  );
}

/** Calls per model this month (evaluations together with their model), most first. */
function callsByModel(view: View) {
  const by = new Map<string, number>();
  for (const r of view.spending.rows) by.set(r.model, (by.get(r.model) ?? 0) + r.calls);
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([model, calls]) => ({ key: model, label: shortModel(model), values: [calls] }));
}

/** Spending per day this month, one colour per model. */
function SpendChart({ t, view }: { t: T; view: View }) {
  const month = view.spending.month;
  if (!month || !view.spending.byDay.length)
    return <p className="muted small">{t("models.noCalls")}</p>;
  const from = Date.parse(`${month}-01T00:00:00Z`);
  const to = Math.min(Date.now() + 1, Date.parse(`${nextMonth(month)}-01T00:00:00Z`));
  const models = [...new Set(view.spending.byDay.flatMap((d) => Object.keys(d.byModel)))];
  const series = (models.length ? models : [""]).map((m) => ({
    name: m ? shortModel(m) : t("models.kpi.spend"),
    values: Object.fromEntries(
      view.spending.byDay.map((d) => [d.day, m ? (d.byModel[m] ?? 0) : d.eur]),
    ),
  }));
  return (
    <DashChart
      data={dailyChart("models-spend", "stacked_bar", daysOf(from, to), series, "EUR")}
      legend={series.map((s, i) => ({ name: s.name, color: COLORS[i % COLORS.length] as string }))}
    />
  );
}
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

const ROLE_ICONS: Record<ModelRole, typeof Route> = {
  planner: Route,
  reader: Mail,
  decider: Split,
  reviewer: GraduationCap,
};

/** A use with its model in large type, how it treats the data, and what it spent; a click opens its panel. */
function RoleCard({
  t,
  r,
  view,
  eur,
  on,
  onOpen,
}: {
  t: T;
  r: ModelRoleView;
  view: View;
  eur: (x: number) => string;
  on: boolean;
  onOpen: () => void;
}) {
  const rows = view.spending.rows.filter((x) => x.role === r.role);
  const spent = rows.reduce((a, x) => a + x.eur, 0);
  const calls = rows.reduce((a, x) => a + x.calls, 0);
  const Icon = ROLE_ICONS[r.role];
  return (
    <button
      type="button"
      className={`use-card${on ? " on" : ""}`}
      aria-pressed={on}
      title={r.model}
      onClick={onOpen}
    >
      <span className="use-role">
        <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
        {t(`models.role.${r.role}`)}
      </span>
      <span className="use-model">{shortModel(r.model)}</span>
      <span className={`models-badge ${r.privacy}`}>{t(`models.privacy.${r.privacy}`)}</span>
      <span className="use-spend">
        {eur(spent)} € · {t("models.calls", { n: calls })}
      </span>
    </button>
  );
}

/** The month's spending by model and the budget (under the spending tile, when it is open). */
function Spending({
  t,
  view,
  eur,
  onChanged,
}: {
  t: T;
  view: View;
  eur: (x: number) => string;
  onChanged: (v: View) => void;
}) {
  const [edit, setEdit] = useState<{ monthly: string; warn: string; rate: string } | null>(null);
  const { budget, spending } = view;
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
    <section className="card models-card open models-spend">
      <div className="models-more">
        {spending.rows.length > 0 && (
          <>
            <h3 className="models-sub">{t("models.byModel")}</h3>
            <ul className="models-list">
              {spending.rows.map((r) => (
                <li key={`${r.role}|${r.provider}|${r.model}`}>
                  <span className="models-list-main">
                    {roleName(r.role)} · {shortModel(r.model)}
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
    </section>
  );
}

const lastEval = (view: View, role: ModelRole, c: ModelChoice): ModelEvaluation | undefined =>
  view.evaluations.find((e) => e.role === role && same(e, c));

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

/**
 * A use's panel: what it does, how its route treats the data, whose choice it is, what it spent this month and its
 * last evaluation; «Cambiar» shows the models to pick from, evaluate and use.
 */
function RolePanel({
  t,
  role,
  view,
  eur,
  onClose,
  onChanged,
}: {
  t: T;
  role: ModelRole;
  view: View;
  eur: (x: number) => string;
  onClose: () => void;
  onChanged: (v: View) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [cases, setCases] = useState(false);
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
  const rows = view.spending.rows.filter((x) => x.role === role);
  const spent = rows.reduce((a, x) => a + x.eur, 0);
  const calls = rows.reduce((a, x) => a + x.calls, 0);
  const back = async () => {
    try {
      const v = await agentApi.setModelRole(role, null);
      if (v) onChanged(v);
    } catch (e) {
      toast(errorText(t, e));
    }
  };
  useEffect(() => {
    if (role === "decider" || !picking) return;
    agentApi
      .catalogue()
      .then(setCatalogue)
      .catch(() => setFailed(true));
  }, [role, picking]);
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
        {current && (
          <div className="role-detail">
            <p className="use-model">{shortModel(current.model)}</p>
            <p className="muted small">
              {current.model} · {t(`models.conn.${current.connection}`)}
            </p>
            <span className={`models-badge ${current.privacy}`}>
              {t(`models.privacy.${current.privacy}`)}
            </span>
            <p className="models-line muted">{t(`models.roleHelp.${role}`)}</p>
            <p className="models-line">{t(`models.privacyHelp.${current.privacy}`)}</p>
            <p className="models-line">
              {current.chosen ? t("models.chosen") : t("models.server")}
              {current.missingKey
                ? ` · ${t("models.missingKey", { conn: t(`models.conn.${current.connection}`) })}`
                : ""}
            </p>
            <p className="models-line">
              {t("models.thisMonth", { eur: eur(spent), calls: t("models.calls", { n: calls }) })}
            </p>
            <p className="models-line">
              {now
                ? t("models.lastEval", { right: now.right, total: now.total })
                : t("models.noEval")}
              {now && now.cases.length > 0 && (
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
            {now && cases && <Cases ev={now} />}
            {!picking && (
              <span className="models-actions">
                {current.chosen && (
                  <button type="button" className="btn" onClick={() => void back()}>
                    {t("models.backToServer")}
                  </button>
                )}
                <button type="button" className="btn primary" onClick={() => setPicking(true)}>
                  {t("models.change")}
                </button>
              </span>
            )}
          </div>
        )}
        {(picking || !current) && <p className="muted small">{t("models.pick")}</p>}
        {(picking || !current) && role !== "decider" && (
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
        {(picking || !current) && role !== "decider" && !catalogue && !failed && (
          <p className="muted small" role="status">
            {t("models.loadingCatalogue")}
          </p>
        )}
        {failed && <p className="decide-error">{t("models.noCatalogue")}</p>}
        {catalogue && shown.length === 0 && <p className="muted small">{t("models.empty")}</p>}
        {(picking || !current) && (
          <ul className="models-pick">
            {options.map((o) => (
              <li key={`${o.connection}|${o.model}`}>
                <button
                  type="button"
                  className={`models-option${picked && same(picked, o) ? " on" : ""}`}
                  aria-pressed={!!picked && same(picked, o)}
                  title={o.model}
                  onClick={() =>
                    setPicked({ connection: o.connection, model: o.model, zdr: o.zdr })
                  }
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
        )}
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
