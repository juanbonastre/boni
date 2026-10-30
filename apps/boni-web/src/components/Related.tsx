import { ChevronRight } from "lucide-react";
import type { RelatedGroup } from "../core/agent.ts";
import { openRow, toggleRelated, toggleRelatedGroup, useStore } from "../store.ts";

/**
 * A row's «Relacionado» (Juan, 2026-10-29): what points to it from other collections, made from the relations (a
 * person's projects, movements and debts; a project's tasks and events), where Obsidian's views used to list them.
 * One folded line with the counts, as the properties are (a note opens on its text); open, one group per collection
 * and field, newest first, each row opening its page. Each group folds by its name too (Juan, 2026-10-30), and the
 * collection keeps what was open for all its rows, on every device.
 */
export function RelatedSection({ type, groups }: { type: string; groups: RelatedGroup[] }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const ui = useStore((s) => s.dataTypes?.find((x) => x.id === type)?.rowUi);
  const open = ui?.related === true;
  const folded = new Set(ui?.folded ?? []);
  const day = (d: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${d}T12:00:00Z`));
  return (
    <>
      <button
        type="button"
        className={`row-props-toggle row-related-toggle${open ? " open" : ""}`}
        aria-expanded={open}
        onClick={() => toggleRelated(type)}
      >
        <ChevronRight size={14} strokeWidth={2} />
        <span>{t("row.related")}</span>
        <span className="row-related-counts">
          {groups.map((g) => (
            <span key={`${g.type}:${g.field}`}>
              {g.collection} <b>{g.count}</b>
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="row-related">
          {groups.map((g) => {
            const key = `${g.type}:${g.field}`;
            const shut = folded.has(key);
            return (
              <section key={key} className="row-related-group">
                <h4>
                  <button
                    type="button"
                    className={`row-related-head${shut ? "" : " open"}`}
                    aria-expanded={!shut}
                    onClick={() => toggleRelatedGroup(type, key)}
                  >
                    <ChevronRight size={13} strokeWidth={2} />
                    {g.icon && <span aria-hidden="true">{g.icon} </span>}
                    {g.collection}
                    <span className="muted">
                      {" "}
                      · {t("row.relatedVia", { field: g.fieldName })} · {g.count}
                    </span>
                  </button>
                </h4>
                {!shut && (
                  <>
                    <ul>
                      {g.rows.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            className="row-related-row"
                            onClick={() => void openRow(g.type, r.id)}
                          >
                            <span className="row-related-title">
                              {r.title || t("page.untitled")}
                            </span>
                            {r.date && <span className="muted">{day(r.date)}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {g.count > g.rows.length && (
                      <p className="muted small">
                        {t("row.relatedMore", { n: g.count - g.rows.length })}
                      </p>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
