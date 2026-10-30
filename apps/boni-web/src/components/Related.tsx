import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { RelatedGroup } from "../core/agent.ts";
import { openRow, useStore } from "../store.ts";

/**
 * A row's «Relacionado» (Juan, 2026-10-29): what points to it from other collections, made from the relations (a
 * person's projects, movements and debts; a project's tasks and events), where Obsidian's views used to list them.
 * One folded line with the counts, as the properties are (a note opens on its text); open, one group per collection
 * and field, newest first, each row opening its page.
 */
export function RelatedSection({ groups }: { groups: RelatedGroup[] }) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(!open)}
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
          {groups.map((g) => (
            <section key={`${g.type}:${g.field}`} className="row-related-group">
              <h4>
                {g.icon && <span aria-hidden="true">{g.icon} </span>}
                {g.collection}
                <span className="muted"> · {t("row.relatedVia", { field: g.fieldName })}</span>
              </h4>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="row-related-row"
                      onClick={() => void openRow(g.type, r.id)}
                    >
                      <span className="row-related-title">{r.title || t("page.untitled")}</span>
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
            </section>
          ))}
        </div>
      )}
    </>
  );
}
