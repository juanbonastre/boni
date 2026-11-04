/**
 * «Flujos» (docs/flujos.md): the account's flows, each a plan with a trigger kept as data, with their runs; the one
 * chosen, in the editor (F2: its canvas, its steps' settings, its checklist, its versions); «Nuevo flujo»; and, as a
 * tab, «Modelos» (task 59b: the models' flow with the journal's numbers, and what configures them). Docs:
 * docs/design-guide.md «Flujos».
 */
import { Play, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FlowCatalog, FlowDetailView, FlowSummary } from "../core/agent.ts";
import { agentApi, errorText, useStore } from "../store.ts";
import { FlowEditor, triggerText } from "./FlowEditor.tsx";
import { ModelsPanel } from "./ModelsView.tsx";

const PERIODS = [7, 30] as const;

/** The flows as rows: name, what starts them, on or off, runs, the last one, the version. */
function FlowList({
  flows,
  picked,
  onPick,
  onNew,
}: {
  flows: FlowSummary[];
  picked: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const when = (ms: number) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);
  return (
    <>
      <div className="cols-tools">
        <span className="spacer" />
        <button type="button" className="btn small" onClick={onNew}>
          <Plus size={14} strokeWidth={1.8} aria-hidden />
          {t("flows.new")}
        </button>
      </div>
      {!flows.length ? (
        <p className="cols-empty">{t("flows.none")}</p>
      ) : (
        <table className="db-table cols-table flows-table">
          <thead>
            <tr>
              <th>{t("flows.name")}</th>
              <th>{t("flows.trigger")}</th>
              <th>{t("flows.state")}</th>
              <th className="num">{t("flows.runs")}</th>
              <th>{t("flows.last")}</th>
              <th className="num">{t("flows.version")}</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f) => (
              <tr key={f.id} className={`flows-row${picked === f.id ? " on" : ""}`}>
                <td>
                  <button type="button" className="cols-name" onClick={() => onPick(f.id)}>
                    <Play size={13} strokeWidth={1.8} aria-hidden />
                    <span>{f.name}</span>
                  </button>
                </td>
                <td className="muted">{triggerText(t, f.trigger)}</td>
                <td>{f.enabled ? t("flows.enabled") : t("flows.disabled")}</td>
                <td className="num">{f.runs.toLocaleString()}</td>
                <td className="muted">{f.last === null ? "—" : when(f.last)}</td>
                <td className="num muted">v{f.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function FlowsPanel() {
  const t = useStore((s) => s.t);
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowDetailView | null>(null);
  const [catalog, setCatalog] = useState<FlowCatalog | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [error, setError] = useState<string | null>(null);
  const loadList = useCallback(
    () =>
      agentApi.flows().then(
        (list) => {
          setFlows(list);
          setPicked((p) => (p && list.some((f) => f.id === p) ? p : (list[0]?.id ?? null)));
        },
        (e) => setError(errorText(t, e)),
      ),
    [t],
  );
  useEffect(() => {
    void loadList();
    agentApi.flowCatalog().then(
      (c) => setCatalog(c),
      () => undefined,
    );
  }, [loadList]);
  useEffect(() => {
    if (!picked) return setDetail(null);
    let gone = false;
    agentApi.flowDetail(picked, days).then(
      (d) => !gone && setDetail(d),
      (e) => !gone && setError(errorText(t, e)),
    );
    return () => {
      gone = true;
    };
  }, [picked, days, t]);
  const newFlow = async () => {
    try {
      const made = await agentApi.createFlow(t("flows.newName"));
      if (!made) return;
      await loadList();
      setPicked(made.id);
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <>
      {error && !flows ? (
        <p className="form-error">{error}</p>
      ) : flows === null ? (
        <div className="page-loading" role="status" aria-busy="true" />
      ) : (
        <FlowList flows={flows} picked={picked} onPick={setPicked} onNew={() => void newFlow()} />
      )}
      {picked && (
        <>
          <div className="data-tools flow-period">
            <span className="spacer" />
            <div className="segmented" role="radiogroup" aria-label={t("flow.period")}>
              {PERIODS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={days === d}
                  className={days === d ? "on" : ""}
                  onClick={() => setDays(d)}
                >
                  {t("flow.days", { n: d })}
                </button>
              ))}
            </div>
          </div>
          {!detail ? (
            <div className="page-loading" role="status" aria-busy="true" />
          ) : (
            <FlowEditor
              key={detail.id}
              detail={detail}
              catalog={catalog}
              onChanged={(d) => {
                if (d) setDetail(d);
                else setPicked(null);
                void loadList();
              }}
              onOpen={(id) => {
                void loadList();
                setPicked(id);
              }}
            />
          )}
        </>
      )}
    </>
  );
}

export function FlowsView() {
  const t = useStore((s) => s.t);
  const view = useStore((s) => s.view);
  const [tab, setTab] = useState<"flows" | "models">(
    view.kind === "flows" && view.tab === "models" ? "models" : "flows",
  );
  useEffect(() => {
    if (view.kind === "flows" && view.tab) setTab(view.tab);
  }, [view]);
  return (
    <div className="content page-doc full models-page flows-page">
      <div className="doc cols">
        <h1 className="cols-title">{t("nav.flows")}</h1>
        <div className="cols-tools">
          <div className="segmented" role="radiogroup" aria-label={t("flows.tabs")}>
            {(["flows", "models"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={tab === k}
                className={tab === k ? "on" : ""}
                onClick={() => setTab(k)}
              >
                {t(k === "flows" ? "nav.flows" : "nav.models")}
              </button>
            ))}
          </div>
        </div>
        {tab === "flows" ? <FlowsPanel /> : <ModelsPanel />}
      </div>
    </div>
  );
}
