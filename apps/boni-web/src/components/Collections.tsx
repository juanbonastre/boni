import type { DatabaseView } from "@boni/views";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AI_LEVELS, type AiLevel } from "../core/agent.ts";
import { loadDataTypes, openCollection, setCollectionView, useStore } from "../store.ts";
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
