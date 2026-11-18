import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModelsList, ModelsView as View } from "../core/agent.ts";
import { phoneLayout } from "../host.ts";
import { agentApi, errorText, useStore } from "../store.ts";
import { Kpi } from "./Dash.tsx";
import { AccountRows, AddPanel, Budget, Connections, ModelPanel, ModelRows } from "./Models.tsx";

/**
 * Ajustes → Modelos (docs/automatizaciones.md §5.16, AU-232): one list of loaded models with their tags, no uses;
 * «De la cuenta» above it, a row per kind of call; under it the month's spending, the budget and the keys. A click
 * opens a model in the list's place; «Añadir modelo» opens the finder. Every change needs a personal device
 * (AU-243): on a shared one, and on the phone, the page is read.
 */
export function ModelsSettings() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  // The budget, the keys and the month's total (the view of before); the list, its tags and «De la cuenta».
  const [view, setView] = useState<View | null>(null);
  const [list, setList] = useState<ModelsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ model: string } | "add" | null>(null);
  const [keys, setKeys] = useState(false);
  const load = async () => {
    try {
      const [v, l] = await Promise.all([
        agentApi.models(),
        agentApi.modelsList().catch((e: unknown) => {
          setListError(errorText(t, e));
          return null;
        }),
      ]);
      setView(v);
      if (l) setListError(null);
      // Without the list (it could not be read) the page still has the budget and the keys, and changes nothing else.
      setList(l ?? { models: [], tags: [], account: [], evaluating: null, personal: false });
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
    if (!list?.evaluating) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [list?.evaluating]);
  const eur = (x: number) =>
    new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(x);
  if (error && !view && !list) return <p className="form-error">{error}</p>;
  if (!view || !list) return <p className="muted">{t("chart.loading")}</p>;
  const readOnly = phoneLayout() || !list.personal;
  // A change of the keys changes which models have theirs: the list is asked again.
  const keysChanged = (v: View) => {
    setView(v);
    void agentApi.modelsList().then((l) => l && setList(l));
  };
  if (open === "add")
    return (
      <div className="models-settings-role">
        <AddPanel
          t={t}
          view={view}
          onClose={() => setOpen(null)}
          onAdded={(l, c) => {
            setList(l);
            const added = l.models.find(
              (m) => m.connection === c.connection && m.model === c.model && m.zdr === c.zdr,
            );
            setOpen(added ? { model: added.id } : null);
          }}
        />
      </div>
    );
  const opened = open ? list.models.find((m) => m.id === open.model) : undefined;
  if (opened)
    return (
      <div className="models-settings-role">
        <ModelPanel
          t={t}
          model={opened}
          list={list}
          eur={eur}
          readOnly={readOnly}
          onClose={() => setOpen(null)}
          onList={setList}
        />
      </div>
    );
  const { spending, budget } = view;
  return (
    <div className="models-settings">
      <div className="models-head">
        {readOnly ? (
          <span className="muted small">{t("models.readOnly")}</span>
        ) : (
          <button type="button" className="btn" onClick={() => setOpen("add")}>
            <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            {t("models.add")}
          </button>
        )}
      </div>
      <section className="settings-group" aria-label={t("models.account")}>
        <h4>{t("models.account")}</h4>
        <AccountRows t={t} list={list} readOnly={readOnly} onList={setList} />
      </section>
      <section className="settings-group">
        {listError && <p className="form-error">{listError}</p>}
        <ModelRows
          t={t}
          list={list}
          eur={eur}
          readOnly={readOnly}
          onOpen={(id) => setOpen({ model: id })}
          onList={setList}
        />
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
              : // Without a budget (0) there is no warning to pass.
                budget.monthlyEur > 0 && spending.eur >= budget.monthlyEur * budget.warnAt
                ? "warn"
                : "ok",
          }}
        />
        <Budget t={t} view={view} eur={eur} readOnly={readOnly} onChanged={setView} />
      </section>
      <section className="settings-group">
        <Connections
          t={t}
          view={view}
          open={keys}
          readOnly={readOnly}
          onToggle={() => setKeys(!keys)}
          onChanged={keysChanged}
        />
      </section>
    </div>
  );
}
