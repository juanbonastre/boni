/**
 * A collection's head as Notion's (task 69; Juan, 2026-11-05, with Notion's «Tareas BD» as the reference): its saved
 * views as tabs on the left with «+» (a new view by its layout), and under the head the bar of the view's order and
 * filters (the order on the left, the filters on the right, a line between them), each a chip that opens its editor.
 */
import type { DatabaseFilter, DatabaseView, SavedView } from "@boni/views";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { DataType } from "../core/agent.ts";
import { useStore } from "../store.ts";
import { RenameInput } from "./CollectionTree.tsx";
import { FilterEditor, filterText, opsFor } from "./DatabaseBlock.tsx";
import { MenuRow, MenuSep, PointMenu, PopButton } from "./Popover.tsx";

/** The layouts a view may take, each with its icon and, where a collection names it its own way («Mapa»), its name. */
export type Layouts = { id: DatabaseView["layout"]; icon: ReactNode; name?: string }[];

/** The layouts as tiles, the view's one marked: the settings' «Diseño» and a page block's tab. */
export function LayoutTiles({
  layouts,
  current,
  onPick,
}: {
  layouts: Layouts;
  current: DatabaseView["layout"];
  onPick: (layout: DatabaseView["layout"]) => void;
}) {
  const t = useStore((s) => s.t);
  return (
    <div className="db-layout-tiles" role="radiogroup" aria-label={t("db.layout")}>
      {layouts.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={current === l.id}
          className={`db-layout-tile${current === l.id ? " on" : ""}`}
          onClick={() => onPick(l.id)}
        >
          {l.icon}
          <span>{l.name ?? t(`db.layouts.${l.id}`)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * A page's block keeps one view (in the page): its layout as its one tab, which a click changes (task 69; before,
 * the layouts were radios in the head).
 */
export function LayoutTab({
  view,
  onView,
  layouts,
}: {
  view: DatabaseView;
  onView: (v: DatabaseView) => void;
  layouts: Layouts;
}) {
  const t = useStore((s) => s.t);
  return (
    <div className="db-views">
      <PopButton
        className="db-view-tab on"
        title={t("db.layout")}
        align="start"
        width={260}
        label={
          <>
            {layouts.find((l) => l.id === view.layout)?.icon}
            <span>
              {layouts.find((l) => l.id === view.layout)?.name ?? t(`db.layouts.${view.layout}`)}
            </span>
          </>
        }
      >
        {(close) => (
          <div className="pop-section">
            <LayoutTiles
              layouts={layouts}
              current={view.layout}
              onPick={(layout) => {
                onView({ ...view, layout });
                close();
              }}
            />
          </div>
        )}
      </PopButton>
    </div>
  );
}

export interface ViewsControl {
  list: SavedView[];
  active: string;
  onSwitch: (id: string) => void;
  onAdd: (layout: DatabaseView["layout"]) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The views as tabs (Notion's): a click opens one, a double click renames it in place (Enter or leaving keeps the
 * name, Escape does not), the right button opens its menu (rename, duplicate, delete: never the last one); «+»
 * chooses the new one's layout.
 */
export function ViewTabs({ views, layouts }: { views: ViewsControl; layouts: Layouts }) {
  const t = useStore((s) => s.t);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const iconOf = (l: DatabaseView["layout"]) => layouts.find((x) => x.id === l)?.icon;
  return (
    <div className="db-views" role="tablist" aria-label={t("db.views")}>
      {views.list.map((v) =>
        renaming === v.id ? (
          <span key={v.id} className="db-view-name">
            <RenameInput
              name={v.name}
              label={t("db.view.name")}
              onDone={(name) => {
                if (name) views.onRename(v.id, name.slice(0, 60));
                setRenaming(null);
              }}
            />
          </span>
        ) : (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={v.id === views.active}
            className={`db-view-tab${v.id === views.active ? " on" : ""}`}
            onClick={() => views.onSwitch(v.id)}
            onDoubleClick={() => setRenaming(v.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id: v.id });
            }}
          >
            {iconOf(v.layout)}
            <span>{v.name}</span>
          </button>
        ),
      )}
      <PopButton
        className="icon-btn db-view-add"
        title={t("db.view.add")}
        align="start"
        width={260}
        label={<Plus size={14} strokeWidth={1.8} />}
      >
        {(close) => (
          <div className="pop-section">
            <p className="menu-head">{t("db.view.new")}</p>
            <div className="db-layout-tiles">
              {layouts.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="db-layout-tile"
                  onClick={() => {
                    views.onAdd(l.id);
                    close();
                  }}
                >
                  {l.icon}
                  <span>{l.name ?? t(`db.layouts.${l.id}`)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </PopButton>
      {menu && (
        <PointMenu x={menu.x} y={menu.y} label={t("db.views")} onClose={() => setMenu(null)}>
          {(close) => (
            <>
              <MenuRow
                label={t("db.view.rename")}
                onClick={() => {
                  setRenaming(menu.id);
                  close();
                }}
              />
              <MenuRow
                label={t("db.view.duplicate")}
                onClick={() => {
                  views.onDuplicate(menu.id);
                  close();
                }}
              />
              {views.list.length > 1 && (
                <>
                  <MenuSep />
                  <MenuRow
                    label={t("db.view.delete")}
                    onClick={() => {
                      views.onDelete(menu.id);
                      close();
                    }}
                  />
                </>
              )}
            </>
          )}
        </PointMenu>
      )}
    </div>
  );
}

/** Which of the bar's editors opens as it appears (the head's icon that showed the bar). */
export type BarFocus = "sort" | "filter" | null;

/**
 * The view's order and filters as chips (Notion's bar): the order on the left, a line, the filters on the right and
 * «+ Filtro». A chip opens its editor; the head's icon for one shows the bar with that editor open.
 */
export function ViewBar({
  type,
  view,
  onView,
  focus,
  onDone,
}: {
  type: DataType;
  view: DatabaseView;
  onView: (v: DatabaseView) => void;
  /** Opened from the head's icon: that editor open at once (its key changes each time). */
  focus: { what: BarFocus; n: number };
  /** That editor closed: the bar stays only while it has an order or a filter. */
  onDone: () => void;
}) {
  const t = useStore((s) => s.t);
  // A filter just added opens its editor, for its value (Notion's).
  const [fresh, setFresh] = useState<number | null>(null);
  const rules = view.filter ?? [];
  const done = (open: boolean) => {
    if (!open) onDone();
  };
  const field = type.fields.find((f) => f.id === view.sort?.field);
  const setRules = (next: DatabaseFilter[]) =>
    onView({ ...view, filter: next.length ? next : undefined });
  const sortEditor = (close: () => void) => (
    <div className="menu-list scroll" role="menu">
      {view.sort && (
        <>
          <MenuRow
            label={t("db.sortAsc")}
            on={!view.sort.desc}
            onClick={() => view.sort && onView({ ...view, sort: { field: view.sort.field } })}
          />
          <MenuRow
            label={t("db.sortDesc")}
            on={!!view.sort.desc}
            onClick={() =>
              view.sort && onView({ ...view, sort: { field: view.sort.field, desc: true } })
            }
          />
          <MenuSep />
        </>
      )}
      {type.fields.map((f) => (
        <MenuRow
          key={f.id}
          label={f.name}
          on={view.sort?.field === f.id}
          onClick={() =>
            onView({
              ...view,
              sort: { field: f.id, ...(view.sort?.desc ? { desc: true } : {}) },
            })
          }
        />
      ))}
      {view.sort && (
        <>
          <MenuSep />
          <MenuRow
            label={t("db.sortRemove")}
            onClick={() => {
              onView({ ...view, sort: undefined });
              close();
            }}
          />
        </>
      )}
    </div>
  );
  return (
    <div className="db-bar">
      <div className="db-bar-sorts">
        {(view.sort || focus.what === "sort") && (
          <PopButton
            key={`sort-${focus.what === "sort" ? focus.n : 0}`}
            className={`db-chip${view.sort ? " on" : ""}`}
            title={t("db.opt.sort")}
            align="start"
            width={240}
            initialOpen={focus.what === "sort"}
            onOpenChange={done}
            label={
              <>
                {view.sort?.desc ? (
                  <ArrowDown size={13} strokeWidth={2} />
                ) : (
                  <ArrowUp size={13} strokeWidth={2} />
                )}
                <span>{field?.name ?? t("db.opt.sort")}</span>
              </>
            }
          >
            {sortEditor}
          </PopButton>
        )}
      </div>
      <span className="db-bar-sep" aria-hidden="true" />
      <div className="db-bar-filters">
        {rules.map((r, i) => (
          <PopButton
            key={`${r.field}-${i}${fresh === i ? "-new" : ""}`}
            className="db-chip on"
            title={filterText(type, r, t)}
            align="start"
            width={420}
            initialOpen={fresh === i}
            onOpenChange={(open) => !open && setFresh(null)}
            label={<span>{filterText(type, r, t)}</span>}
          >
            {() => (
              <div className="pop-section db-filters">
                <FilterEditor
                  type={type}
                  rules={[r]}
                  single
                  onChange={(one) =>
                    setRules([...rules.slice(0, i), ...one, ...rules.slice(i + 1)])
                  }
                />
              </div>
            )}
          </PopButton>
        ))}
        <PopButton
          key={`add-${focus.what === "filter" ? focus.n : 0}`}
          className="db-chip ghost"
          title={t("db.filterAdd")}
          align="start"
          width={240}
          initialOpen={focus.what === "filter"}
          onOpenChange={done}
          label={
            <>
              <Plus size={13} strokeWidth={2} />
              <span>{t("db.filter")}</span>
            </>
          }
        >
          {(close) => (
            <div className="menu-list scroll" role="menu">
              {type.fields.map((f) => (
                <MenuRow
                  key={f.id}
                  label={f.name}
                  onClick={() => {
                    setRules([...rules, { field: f.id, op: opsFor(f)[0] ?? "contains" }]);
                    setFresh(rules.length);
                    close();
                  }}
                />
              ))}
            </div>
          )}
        </PopButton>
      </div>
    </div>
  );
}
