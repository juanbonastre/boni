import { ChevronRight, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { ModelRole, ModelsView as View } from "../core/agent.ts";
import { type AuditSummary, shortModel } from "../core/audit.ts";
import type { DataBlock } from "../core/blocks.ts";
import type { T } from "../i18n.ts";
import { agentApi, errorText, showAudit, showLog, useStore } from "../store.ts";
import { BarList, COLORS, DashChart, dailyChart, daysOf, Kpi, whoColor, whoName } from "./Dash.tsx";
import { Connections, callsByModel, RoleCard, RolePanel, SpendChart, Spending } from "./Models.tsx";

/**
 * Boni's own blocks (the block catalogue's «De Boni» group; packages/views catalogue.ts): its numbers by name
 * (spending, calls, what the AIs read and changed), the uses with their models, the keys, a link to another screen.
 * A page with any of them loads Boni's models and this month's audit once (`BoniScope`), and opens a use or the
 * spending in its own panel on the right, as «Modelos» did.
 */

interface Boni {
  view: View | null;
  audit: AuditSummary | null;
  error: string | null;
  setView: (v: View) => void;
  open: ModelRole | "spending" | null;
  setOpen: (o: ModelRole | "spending" | null) => void;
  eur: (x: number) => string;
  nf: Intl.NumberFormat;
}
const BoniCtx = createContext<Boni | null>(null);
export const useBoni = () => useContext(BoniCtx);

const isAi = (by: string) => by.startsWith("model:") || by.startsWith("mcp:");

/** Boni's models and this month's audit, for the blocks of a page that has some of Boni's (`active`). */
export function BoniScope({ active, children }: { active: boolean; children: ReactNode }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const tick = useStore((s) => s.refreshTick);
  const [view, setView] = useState<View | null>(null);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ModelRole | "spending" | null>(null);
  const load = async () => {
    try {
      setView(await agentApi.models());
      setError(null);
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  useEffect(() => {
    if (active) void load();
  }, [active, tick]);
  // What the models read and changed this month (only a personal device may read the audit).
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
  // Esc closes the spending panel before the app's own Esc (which would leave the page), as a use's panel does.
  useEffect(() => {
    if (open !== "spending") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        setOpen(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  const locale = lang === "en" ? "en-GB" : "es-ES";
  const eur = (x: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
  const ctx: Boni = {
    view,
    audit,
    error,
    setView,
    open,
    setOpen,
    eur,
    nf: new Intl.NumberFormat(locale),
  };
  if (!active) return <>{children}</>;
  return (
    <BoniCtx.Provider value={ctx}>
      {children}
      {view && open === "spending" && (
        <aside className="side-panel models-panel" aria-label={t("models.kpi.spend")}>
          <header className="panel-head">
            <h2>{t("models.kpi.spend")}</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label={t("settings.close")}
              title={t("settings.close")}
              onClick={() => setOpen(null)}
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </header>
          <div className="panel-body">
            <Spending t={t} view={view} eur={eur} onChanged={setView} />
          </div>
        </aside>
      )}
      {view && open && open !== "spending" && (
        <RolePanel
          t={t}
          role={open}
          view={view}
          eur={eur}
          onClose={() => setOpen(null)}
          onChanged={setView}
        />
      )}
    </BoniCtx.Provider>
  );
}

/** A Boni block's name when it has none of its own: Boni's name for it, in the user's language. */
export function boniTitle(t: T, b: { type: string; source?: string; to?: string }): string {
  const key: Record<string, string> = {
    spend: "models.kpi.spend",
    calls: "models.kpi.calls",
    reads: "models.kpi.reads",
    writes: "models.kpi.writes",
    callsByModel: "models.callsChart",
    spendByModel: "boni.spendByModel",
    readsByType: "boni.readsByType",
    whoEdits: "boni.whoEdits",
    spendByDay: "models.byDayChart",
    readsByDay: "boni.readsByDay",
  };
  if (b.type === "models") return t("models.roles");
  if (b.type === "link") return b.to === "audit" ? t("boni.toAudit") : t("models.activity");
  return t(key[b.source ?? ""] ?? "block.kind.number");
}

/** A number, a bar list or a chart from Boni's own numbers. */
export function BoniData({ block }: { block: DataBlock }) {
  const t = useStore((s) => s.t);
  const boni = useBoni();
  const name = block.title || boniTitle(t, block);
  if (!boni) return null;
  const { view, audit, eur, nf } = boni;
  if (boni.error && !view) return <Kpi label={name} value="—" note={boni.error} />;
  if (block.type === "number") {
    if (!view) return <Kpi label={name} value="—" />;
    if (block.source === "spend")
      return (
        <Kpi
          label={name}
          value={`${eur(view.spending.eur)} €`}
          note={t("models.kpi.of", { budget: eur(view.budget.monthlyEur) })}
          meter={{
            share: view.budget.monthlyEur > 0 ? view.spending.eur / view.budget.monthlyEur : 0,
            state: view.over
              ? "over"
              : view.spending.eur >= view.budget.monthlyEur * view.budget.warnAt
                ? "warn"
                : "ok",
          }}
        />
      );
    if (block.source === "calls")
      return (
        <Kpi label={name} value={nf.format(view.spending.rows.reduce((n, r) => n + r.calls, 0))} />
      );
    const k = block.source === "reads" ? "reads" : "writes";
    const n = audit
      ? audit.activity
          .filter((r) => isAi(r.by) || (k === "writes" && r.by === "agent"))
          .reduce((s, r) => s + r[k], 0)
      : null;
    return (
      <Kpi
        label={name}
        value={n === null ? "—" : nf.format(n)}
        note={t(k === "reads" ? "models.kpi.readsNote" : "models.kpi.writesNote")}
      />
    );
  }
  if (block.type === "bars") {
    let rows: { key: string; label: string; values: number[] }[] = [];
    let format = (n: number) => nf.format(n);
    let color = "var(--accent)";
    if (view && block.source === "callsByModel") rows = callsByModel(view);
    if (view && block.source === "spendByModel") {
      const by = new Map<string, number>();
      for (const r of view.spending.rows) by.set(r.model, (by.get(r.model) ?? 0) + r.eur);
      rows = [...by]
        .sort((a, b) => b[1] - a[1])
        .map(([m, v]) => ({ key: m, label: shortModel(m), values: [v] }));
      format = (n) => `${eur(n)} €`;
    }
    if (audit && block.source === "readsByType") {
      const by = new Map<string, number>();
      for (const r of audit.byType) if (isAi(r.by)) by.set(r.name, (by.get(r.name) ?? 0) + r.reads);
      rows = [...by]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([n, v]) => ({ key: n, label: n, values: [v] }));
    }
    if (audit && block.source === "whoEdits") {
      const by = new Map<string, number>();
      for (const r of audit.activity) by.set(r.by, (by.get(r.by) ?? 0) + r.writes);
      rows = [...by]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([w, v]) => ({ key: w, label: whoName(t, w), values: [v] }));
      if (rows[0]) color = whoColor(rows[0].key);
    }
    return (
      <div className="data-blk-bars">
        <h2 className="dash-h2">{name}</h2>
        <BarList
          rows={rows}
          series={[{ name, color }]}
          format={format}
          empty={t("models.noCalls")}
        />
      </div>
    );
  }
  if (!view) return null;
  if (block.source === "spendByDay")
    return (
      <div className="data-blk-bars">
        <h2 className="dash-h2">{name}</h2>
        <SpendChart t={t} view={view} />
      </div>
    );
  const from = Date.parse(`${view.spending.month}-01T00:00:00Z`);
  const sum = (k: "reads" | "writes") => {
    const o: Record<string, number> = {};
    for (const r of audit?.activity ?? []) o[r.day] = (o[r.day] ?? 0) + r[k];
    return o;
  };
  const series = [
    { name: t("models.kpi.reads"), values: sum("reads") },
    { name: t("models.kpi.writes"), values: sum("writes") },
  ];
  return (
    <div className="data-blk-bars">
      <h2 className="dash-h2">{name}</h2>
      <DashChart
        data={dailyChart(`boni-${block.id}`, "line", daysOf(from, Date.now()), series)}
        legend={series.map((s, i) => ({ name: s.name, color: COLORS[i] as string }))}
      />
    </div>
  );
}

/** Boni's uses, each with its model in large type; a click opens it in the panel on the right. */
export function ModelsBlock({ title }: { title?: string }) {
  const t = useStore((s) => s.t);
  const boni = useBoni();
  if (!boni?.view) return null;
  const { view, eur, open, setOpen } = boni;
  return (
    <div className="data-blk-bars">
      <h2 className="dash-h2">{title || boniTitle(t, { type: "models" })}</h2>
      {view.roles.length === 0 && <p className="muted">{t("models.noRoles")}</p>}
      <div className="uses">
        {view.roles.map((r) => (
          <RoleCard
            key={r.role}
            t={t}
            r={r}
            view={view}
            eur={eur}
            on={open === r.role}
            onOpen={() => setOpen(open === r.role ? null : r.role)}
          />
        ))}
      </div>
    </div>
  );
}

/** The connections to the model providers and their keys (never shown again once saved). */
export function KeysBlock() {
  const t = useStore((s) => s.t);
  const boni = useBoni();
  const [open, setOpen] = useState(false);
  if (!boni?.view) return null;
  return (
    <Connections
      t={t}
      view={boni.view}
      open={open}
      onToggle={() => setOpen(!open)}
      onChanged={boni.setView}
    />
  );
}

/** A row that opens another of Boni's screens. */
export function LinkBlock({ block }: { block: { title?: string; to: "activity" | "audit" } }) {
  const t = useStore((s) => s.t);
  return (
    <button
      type="button"
      className="models-row models-link"
      onClick={() => (block.to === "audit" ? showAudit({}) : showLog())}
    >
      <span className="models-row-main">
        <span className="models-name">
          {block.title || boniTitle(t, { type: "link", to: block.to })}
        </span>
        <span className="muted small">
          {t(block.to === "audit" ? "boni.seeAudit" : "models.toLog")}
        </span>
      </span>
      <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
