import type { DatabaseView } from "@boni/views";
import { Lightbulb, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AI_LEVELS, type AiLevel } from "../core/agent.ts";
import type { AuditSummary, Storage } from "../core/audit.ts";
import {
  agentApi,
  loadDataTypes,
  openCollection,
  setCollectionView,
  showAudit,
  useStore,
} from "../store.ts";
import { BarList, bytes, Kpi } from "./Dash.tsx";
import { DatabaseBlock } from "./DatabaseBlock.tsx";
import { LEVEL_ICONS, ProtectionMenu } from "./Protection.tsx";

/**
 * Colecciones (Juan, 2026-10-22): every collection in one place, as Notion's list of databases. A search and
 * a filter by what the AI sees; each row opens the collection on a page of its own and shows (and changes)
 * its protection there and then.
 */
export function CollectionsView() {
  const t = useStore((s) => s.t);
  const types = useStore((s) => s.dataTypes);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<AiLevel | null>(null);
  useEffect(() => {
    if (!types) void loadDataTypes();
  }, []);
  const q = query.trim().toLocaleLowerCase("es");
  const shown = (types ?? []).filter(
    (x) => (!q || x.name.toLocaleLowerCase("es").includes(q)) && (!level || x.level === level),
  );
  const count = (l: AiLevel) => (types ?? []).filter((x) => x.level === l).length;
  return (
    <div className="content page-doc full">
      <div className="doc cols">
        <h1 className="cols-title">{t("nav.collections")}</h1>
        <p className="cols-help">{t("col.help")}</p>
        <CollectionsUsage />
        <div className="cols-tools">
          <label className="cols-search">
            <Search size={14} strokeWidth={1.8} aria-hidden />
            <input
              value={query}
              placeholder={t("col.search")}
              aria-label={t("col.search")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="cols-filter" role="radiogroup" aria-label={t("col.ai")}>
            {[null, ...AI_LEVELS].map((l) => (
              <button
                key={l ?? "all"}
                type="button"
                role="radio"
                aria-checked={level === l}
                className={`cols-chip${level === l ? " on" : ""}`}
                onClick={() => setLevel(l)}
              >
                {l && LEVEL_ICONS[l]}
                {l ? t(`ai.level.${l}`) : t("col.all")}
                {l && <span className="cols-chip-n">{count(l)}</span>}
              </button>
            ))}
          </div>
        </div>
        {types === null ? (
          <div className="page-loading" role="status" aria-busy="true" />
        ) : !types.length ? (
          <p className="cols-empty">{t("col.none")}</p>
        ) : !shown.length ? (
          <p className="cols-empty">{t("col.empty")}</p>
        ) : (
          <table className="db-table cols-table">
            <thead>
              <tr>
                <th>{t("col.name")}</th>
                <th className="num">{t("col.items")}</th>
                <th>{t("col.ai")}</th>
                <th className="cols-origin">{t("col.origin")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={x.id}>
                  <td className="is-title">
                    <button
                      type="button"
                      className="cols-name"
                      aria-label={t("col.open", { name: x.name })}
                      onClick={() => openCollection(x.id)}
                    >
                      {x.icon && <span className="db-icon">{x.icon}</span>}
                      <span>{x.name}</span>
                    </button>
                  </td>
                  <td className="num">{x.count}</td>
                  <td>
                    <ProtectionMenu type={x} />
                  </td>
                  <td className="cols-origin">{x.zone ? t(`db.zone.${x.zone}`) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const DEFAULT_VIEW: DatabaseView = { layout: "table" };

/** One collection on a page of its own: its name, its protection (unlocked only here) and its rows. */
export function CollectionView() {
  const t = useStore((s) => s.t);
  const id = useStore((s) => (s.view.kind === "collection" ? s.view.type : ""));
  const type = useStore((s) => s.dataTypes?.find((x) => x.id === id));
  const view = useStore((s) => s.collectionViews[id]) ?? DEFAULT_VIEW;
  useEffect(() => {
    void loadDataTypes();
  }, [id]);
  if (!type)
    return (
      <div className="content">
        <div
          className="page-loading"
          role="status"
          aria-busy="true"
          aria-label={t("chart.loading")}
        />
      </div>
    );
  return (
    <div className="content page-doc full">
      <div className="doc">
        <div className="row-kind">{t("nav.collections")}</div>
        <h1 className="cols-title">
          {type.icon && <span>{type.icon}</span>}
          {type.name}
        </h1>
        <div className="col-protect">
          <span className="muted small">{t("col.ai")}</span>
          <ProtectionMenu type={type} canUnlock />
          {type.zone && <span className="muted small">· {t(`db.zone.${type.zone}`)}</span>}
        </div>
        <DatabaseBlock
          source={type.id}
          view={view}
          named={false}
          onView={(v) => setCollectionView(type.id, v)}
        />
      </div>
    </div>
  );
}

/**
 * How the collections are used and what they take (Juan, 2026-10-24): the records, the storage and its parts, size
 * and use per collection (what was read and changed in 30 days), and Boni's advice when something grows (nothing is
 * deleted by itself). A collection's bars open its audit.
 */
function CollectionsUsage() {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [st, setSt] = useState<Storage | null>(null);
  const [sum, setSum] = useState<AuditSummary | null>(null);
  useEffect(() => {
    agentApi
      .storage()
      .then(setSt)
      .catch(() => setSt(null));
    const to = Date.now();
    agentApi
      .auditSummary(to - 30 * 86_400_000, to)
      .then(setSum)
      .catch(() => setSum(null));
  }, []);
  if (!st) return null;
  const nf = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES");
  const rows = st.types.reduce((n, x) => n + x.rows, 0);
  const history = st.types.reduce((n, x) => n + x.history, 0);
  const use = new Map<string, { name: string; reads: number; writes: number }>();
  for (const r of sum?.byType ?? []) {
    const x = use.get(r.type) ?? { name: r.name, reads: 0, writes: 0 };
    x.reads += r.reads;
    x.writes += r.writes;
    use.set(r.type, x);
  }
  return (
    <div className="cols-usage">
      <div className="kpis">
        <Kpi label={t("cols.kpi.rows")} value={nf.format(rows)} />
        <Kpi label={t("cols.kpi.storage")} value={bytes(st.total, lang)} />
        <Kpi label={t("cols.kpi.history")} value={bytes(history, lang)} />
        <Kpi label={t("cols.kpi.modelTexts")} value={bytes(st.modelCalls.bytes, lang)} />
      </div>
      {st.advice.map((a) => (
        <p key={`${a.code}${a.type ?? ""}`} className="cols-advice">
          <Lightbulb size={14} strokeWidth={1.8} aria-hidden="true" />
          {t(`cols.advice.${a.code}`, {
            size: bytes(a.bytes, lang),
            name: st.types.find((x) => x.type === a.type)?.name ?? "",
          })}
        </p>
      ))}
      <div className="dash-grid">
        <section className="dash-col">
          <h2 className="dash-h2">{t("cols.size")}</h2>
          <BarList
            rows={[...st.types]
              .sort((a, b) => b.bytes + b.history - (a.bytes + a.history))
              .slice(0, 10)
              .map((x) => ({ key: x.type, label: x.name, values: [x.bytes, x.history] }))}
            series={[
              { name: t("cols.data"), color: "var(--c1)" },
              { name: t("cols.kpi.history"), color: "var(--c7)" },
            ]}
            format={(n) => bytes(n, lang)}
            onSelect={(type) => openCollection(type)}
          />
        </section>
        <section className="dash-col">
          <h2 className="dash-h2">{t("cols.use")}</h2>
          <BarList
            rows={[...use.entries()]
              .sort((a, b) => b[1].reads + b[1].writes - (a[1].reads + a[1].writes))
              .slice(0, 10)
              .map(([type, x]) => ({ key: type, label: x.name, values: [x.reads, x.writes] }))}
            series={[
              { name: t("activity.reads"), color: "var(--c1)" },
              { name: t("activity.writes"), color: "var(--c2)" },
            ]}
            format={(n) => nf.format(n)}
            onSelect={(type) => showAudit({ type })}
            empty={t("activity.empty")}
          />
        </section>
      </div>
    </div>
  );
}
