import { useEffect, useState } from "react";
import type { ModelRole, ModelsView as View } from "../core/agent.ts";
import { agentApi, errorText, useStore } from "../store.ts";
import { Kpi } from "./Dash.tsx";
import { Connections, RoleCard, RolePanel, Spending } from "./Models.tsx";

/**
 * Ajustes → Modelos (design audit, Juan 2026-10-25: what configures Boni lives in Settings, not on a page): each use
 * and its model (a click opens it: change it, evaluate another), the month's spending and the budget, the keys.
 * What the models did is a page of ordinary blocks over Boni's records («Uso de la IA»).
 */
export function ModelsSettings() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<ModelRole | null>(null);
  const [keys, setKeys] = useState(false);
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
  const eur = (x: number) =>
    new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(x);
  if (error && !view) return <p className="form-error">{error}</p>;
  if (!view) return <p className="muted">{t("chart.loading")}</p>;
  if (role)
    return (
      <div className="models-settings-role">
        <RolePanel
          t={t}
          role={role}
          view={view}
          eur={eur}
          onClose={() => setRole(null)}
          onChanged={setView}
        />
      </div>
    );
  const { spending, budget } = view;
  return (
    <div className="models-settings">
      <section className="settings-group">
        <h4>{t("models.roles")}</h4>
        {view.roles.length === 0 && <p className="muted">{t("models.noRoles")}</p>}
        <div className="uses">
          {view.roles.map((r) => (
            <RoleCard
              key={r.role}
              t={t}
              r={r}
              view={view}
              eur={eur}
              on={false}
              onOpen={() => setRole(r.role)}
            />
          ))}
        </div>
      </section>
      <section className="settings-group">
        <h4>{t("models.kpi.spend")}</h4>
        <Kpi
          label={t("models.kpi.spend")}
          value={`${eur(spending.eur)} €`}
          note={t("models.kpi.of", { budget: eur(budget.monthlyEur) })}
          meter={{
            share: budget.monthlyEur > 0 ? spending.eur / budget.monthlyEur : 0,
            state: view.over
              ? "over"
              : spending.eur >= budget.monthlyEur * budget.warnAt
                ? "warn"
                : "ok",
          }}
        />
        <Spending t={t} view={view} eur={eur} onChanged={setView} />
      </section>
      <section className="settings-group">
        <Connections
          t={t}
          view={view}
          open={keys}
          onToggle={() => setKeys(!keys)}
          onChanged={setView}
        />
      </section>
    </div>
  );
}
