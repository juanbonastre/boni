/**
 * «Flujos» (docs/sistema.md §4.4, F8; Juan's «Las recomendadas», decision 3): Boni's collection of the account's
 * flows (apps/server flowsCollection.ts) on a page of its own, with what any collection's page has (its views as
 * tabs, the bar of order and filters, «Nuevo»), starting with two views: «Tabla» and «Mapa» (`FlowMap`, the map of
 * everything that brings, starts, reads and writes the data). A flow opens on a page of its own, in its editor
 * (`FlowPage`), with the way back to «Flujos» above it. «Modelos» is no more: what configures the models is in
 * Ajustes → Modelos, and what they do and cost is on the map's steps. Docs: docs/design-guide.md «Flujos».
 */
import { type DatabaseView, SYS } from "@boni/views";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { FlowCatalog, FlowDetailView } from "../core/agent.ts";
import { phoneLayout } from "../host.ts";
import {
  agentApi,
  errorText,
  loadDataTypes,
  showFlow,
  showFlows,
  useStore,
  useViews,
} from "../store.ts";
import { DatabaseBlock } from "./DatabaseBlock.tsx";
import { FlowEditor } from "./FlowEditor.tsx";

const FLOWS = SYS.flows.id;
const TABLE: DatabaseView = { layout: "table", hide: [SYS.flows.version] };
const PERIODS = [7, 30] as const;

/** The collection's page: its views («Tabla», «Mapa»); «Ver en el mapa» opens the map's. */
function FlowsCollection() {
  const t = useStore((s) => s.t);
  const asked = useStore((s) => (s.view.kind === "flows" ? (s.view.map ?? null) : null));
  const views = useViews(
    FLOWS,
    TABLE,
    [{ view: { layout: "diagram" }, name: t("flows.map") }],
    (l) => (l === "diagram" ? t("flows.map") : undefined),
  );
  useEffect(() => {
    void loadDataTypes();
  }, []);
  // «Ver en el mapa» from anywhere: the map's view, or a new one when he took them all away.
  useEffect(() => {
    if (!asked) return;
    const map = views.control.list.find((v) => v.layout === "diagram");
    if (map) views.control.onSwitch(map.id);
    else views.control.onAdd("diagram");
  }, [asked?.n]);
  return (
    <div className="content page-doc full is-collection flows-page">
      <div className="doc">
        <h1 className="cols-title">{t("nav.flows")}</h1>
        <DatabaseBlock
          source={FLOWS}
          view={views.view}
          named={false}
          onView={views.onView}
          views={views.control}
        />
      </div>
    </div>
  );
}

/** One flow on a page of its own: the way back to «Flujos», its period, its editor. */
function FlowPage({ id }: { id: string }) {
  const t = useStore((s) => s.t);
  const [detail, setDetail] = useState<FlowDetailView | null>(null);
  const [catalog, setCatalog] = useState<FlowCatalog | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    agentApi.flowCatalog().then(
      (c) => setCatalog(c),
      () => undefined,
    );
  }, []);
  useEffect(() => {
    let gone = false;
    setError(null);
    agentApi.flowDetail(id, days).then(
      (d) => {
        if (gone) return;
        if (d) setDetail(d);
        else setError(t("flows.gone"));
      },
      (e) => !gone && setError(errorText(t, e)),
    );
    return () => {
      gone = true;
    };
  }, [id, days, t]);
  return (
    <div className="content page-doc full flow-page">
      <div className="doc">
        <nav className="flow-crumbs" aria-label={t("flows.crumbs")}>
          <button type="button" className="link-btn" onClick={showFlows}>
            {t("nav.flows")}
          </button>
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
          <span className="flow-crumb-here">{detail?.name ?? "…"}</span>
          <span className="spacer" />
          <div className="segmented small" role="radiogroup" aria-label={t("flow.period")}>
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
        </nav>
        {error ? (
          <p className="form-error">{error}</p>
        ) : !detail || detail.id !== id ? (
          <div className="page-loading" role="status" aria-busy="true" />
        ) : (
          <FlowEditor
            key={detail.id}
            detail={detail}
            catalog={catalog}
            onChanged={(d) => {
              if (d) setDetail(d);
              else showFlows();
            }}
            onOpen={(other) => showFlow(other)}
            readOnly={phoneLayout()}
          />
        )}
      </div>
    </div>
  );
}

export function FlowsView() {
  const flow = useStore((s) => (s.view.kind === "flows" ? (s.view.flow ?? null) : null));
  return flow ? <FlowPage id={flow} /> : <FlowsCollection />;
}
