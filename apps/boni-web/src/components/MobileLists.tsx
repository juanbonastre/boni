// The phone's «Páginas» as lists for a finger (docs/design-guide.md, «El móvil»): the library, and a collection's records.
import { Check, ChevronRight, Database, FileText, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DataRow } from "../core/agent.ts";
import {
  deleteRow,
  editCell,
  loadDataTypes,
  loadRows,
  openCollection,
  openFind,
  openPage,
  openRow,
  toast,
  useStore,
} from "../store.ts";
import { BottomSheet, LargeTitle, SwipeRow, shape, Tick, titleOf, useDay } from "./MobileParts.tsx";

/** «Páginas»: the search, Juan's pages and his collections, as grouped lists with what each holds. */
export function MobileLibrary() {
  const t = useStore((s) => s.t);
  const pages = useStore((s) => s.pages);
  const types = useStore((s) => s.dataTypes);
  useEffect(() => {
    void loadDataTypes();
  }, []);
  const own = (pages ?? []).filter((p) => !p.template && !p.parent);
  const cols = (types ?? []).filter((d) => !d.system);
  const nameOf = (id?: string) => cols.find((d) => d.id === id)?.name;
  return (
    <main className="m-scroll m-screen">
      <LargeTitle title={t("tab.pages")} />
      <button type="button" className="m-searchbar" onClick={() => openFind()}>
        <Search size={18} strokeWidth={1.8} />
        <span>{t("list.search")}</span>
      </button>
      {own.length > 0 && (
        <section>
          <h2 className="m-label">{t("nav.pages")}</h2>
          <ul className="m-group">
            {own.map((p) => (
              <li key={p.id} className="m-item">
                <button
                  type="button"
                  className="m-item-main row"
                  onClick={() => void openPage(p.id)}
                >
                  <span className="m-item-icon">
                    {p.icon ? <span>{p.icon}</span> : <FileText size={20} strokeWidth={1.8} />}
                  </span>
                  <span className="m-item-title">{p.title || t("page.untitled")}</span>
                  <ChevronRight size={18} strokeWidth={1.8} className="m-chev" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {cols.length > 0 && (
        <section>
          <h2 className="m-label">{t("list.collections")}</h2>
          <ul className="m-group">
            {cols.map((d) => (
              <li key={d.id} className="m-item">
                <button
                  type="button"
                  className="m-item-main row"
                  onClick={() => openCollection(d.id)}
                >
                  <span className="m-item-icon">
                    {d.icon ? <span>{d.icon}</span> : <Database size={20} strokeWidth={1.8} />}
                  </span>
                  <span className="m-item-text">
                    <span className="m-item-title">{d.name}</span>
                    {d.parent && nameOf(d.parent) && (
                      <span className="m-item-sub">
                        {t("list.inside", { name: nameOf(d.parent) ?? "" })}
                      </span>
                    )}
                  </span>
                  <span className="m-count">{d.count}</span>
                  <ChevronRight size={18} strokeWidth={1.8} className="m-chev" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/**
 * A collection as a list for a thumb: two lines (its title; its date and its first choice), its box to tick, chips
 * to see what is to do, done or all (with a done box), a swipe for done or delete (Undo in the toast) and a long
 * press for its menu.
 */
export function MobileList({ type }: { type: string }) {
  const t = useStore((s) => s.t);
  const def = useStore((s) => s.dataTypes?.find((x) => x.id === type));
  const rows = useStore((s) => s.rows[type]?.rows);
  const day = useDay();
  const [filter, setFilter] = useState<"todo" | "done" | "all">("todo");
  const [menu, setMenu] = useState<DataRow | null>(null);
  useEffect(() => {
    void loadRows(type);
  }, [type]);
  if (!def || !rows)
    return (
      <main className="m-scroll">
        <div
          className="page-loading"
          role="status"
          aria-busy="true"
          aria-label={t("chart.loading")}
        />
      </main>
    );
  const { date, done, choice } = shape(def);
  const isDone = (r: DataRow) => !!done && r.values[done.id] === true;
  const shown = rows
    .filter((r) => !done || filter === "all" || isDone(r) === (filter === "done"))
    .sort((a, b) => {
      const x = String(date ? (a.values[date.id] ?? "") : "");
      const y = String(date ? (b.values[date.id] ?? "") : "");
      // What is still to do, the soonest first (undated last); anything else, the newest first.
      if (done && filter === "todo") return (x || "~").localeCompare(y || "~");
      return y.localeCompare(x);
    });
  const sub = (r: DataRow) =>
    [
      date && typeof r.values[date.id] === "string" && r.values[date.id]
        ? day(String(r.values[date.id]))
        : "",
      choice ? (choice.options?.find((o) => o.id === r.values[choice.id])?.name ?? "") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  // Done or not, at once, with Undo in the notice (a swipe is easy to make by mistake).
  const toggle = (r: DataRow) => {
    if (!done) return;
    const was = isDone(r);
    void editCell(type, r.id, done.id, !was);
    toast(
      t(was ? "today.undone" : "today.done", { title: titleOf(def, r) || t("page.untitled") }),
      {
        label: t("toast.undo"),
        run: () => void editCell(type, r.id, done.id, was),
      },
    );
  };
  return (
    <main className="m-scroll m-screen">
      <LargeTitle title={def.name} />
      {done && (
        <div className="m-chips" role="tablist" aria-label={t("list.filter")}>
          {(["todo", "done", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={`m-chip${filter === f ? " on" : ""}`}
              onClick={() => setFilter(f)}
            >
              {t(`list.filter.${f}`)}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="m-hint">{t("mobile.rowsEmpty")}</p>
      ) : (
        <ul className="m-group">
          {shown.map((r) => (
            <SwipeRow
              key={r.id}
              actions={[
                ...(done
                  ? [
                      {
                        label: isDone(r) ? t("list.undone") : t("list.done"),
                        kind: "good" as const,
                        run: () => toggle(r),
                      },
                    ]
                  : []),
                {
                  label: t("list.delete"),
                  kind: "bad" as const,
                  run: () => void deleteRow(type, r.id),
                },
              ]}
              onLong={() => setMenu(r)}
            >
              {done && (
                <Tick
                  on={isDone(r)}
                  label={isDone(r) ? t("list.undone") : t("list.done")}
                  toggle={() => toggle(r)}
                />
              )}
              <button
                type="button"
                className="m-item-main"
                onClick={() => void openRow(type, r.id)}
              >
                <span className={`m-item-title${isDone(r) ? " done" : ""}`}>
                  {titleOf(def, r) || t("page.untitled")}
                </span>
                {sub(r) && <span className="m-item-sub">{sub(r)}</span>}
              </button>
            </SwipeRow>
          ))}
        </ul>
      )}
      {shown.length > 0 && <p className="m-hint small">{t("list.gestures")}</p>}
      {menu && (
        <BottomSheet title={titleOf(def, menu) || t("page.untitled")} close={() => setMenu(null)}>
          <ul className="m-group">
            <li className="m-item">
              <button
                type="button"
                className="m-item-main row"
                onClick={() => {
                  setMenu(null);
                  void openRow(type, menu.id);
                }}
              >
                <FileText size={20} strokeWidth={1.8} />
                <span className="m-item-title">{t("list.open")}</span>
              </button>
            </li>
            {done && (
              <li className="m-item">
                <button
                  type="button"
                  className="m-item-main row"
                  onClick={() => {
                    setMenu(null);
                    toggle(menu);
                  }}
                >
                  <Check size={20} strokeWidth={1.8} />
                  <span className="m-item-title">
                    {isDone(menu) ? t("list.undone") : t("list.done")}
                  </span>
                </button>
              </li>
            )}
            <li className="m-item">
              <button
                type="button"
                className="m-item-main row bad"
                onClick={() => {
                  setMenu(null);
                  void deleteRow(type, menu.id);
                }}
              >
                <Trash2 size={20} strokeWidth={1.8} />
                <span className="m-item-title">{t("list.delete")}</span>
              </button>
            </li>
          </ul>
        </BottomSheet>
      )}
    </main>
  );
}
