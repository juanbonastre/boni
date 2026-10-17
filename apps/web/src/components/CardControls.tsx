import {
  ArrowUpDown,
  BarChart3,
  CalendarRange,
  Filter,
  Maximize2,
  MoreHorizontal,
} from "lucide-react";
import { useRef, useState } from "react";
import * as B from "../core/chartBuilder.ts";
import type { ChartSpec } from "../core/contract.ts";
import { PALETTE, QUICK_PERIODS, TOP_CHOICES } from "../core/palette.ts";
import { host } from "../host.ts";
import {
  addWidget,
  changeChart,
  deleteChart,
  duplicateChart,
  openEditor,
  refresh,
  removeWidget,
  showChart,
  useStore,
} from "../store.ts";
import { FiltersEditor } from "./editorFields.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

const samePeriod = (a: ChartSpec["period"], b: { kind: string; months?: number }) =>
  a.kind === b.kind && (a.kind !== "last_months" || a.months === b.months);

/**
 * A chart's controls, shown when the pointer is over its card (like a Notion view's): period, filters, order,
 * kind, colour and a menu. Each change applies at once to the chart (saved, with Undo in the toast). `compact`
 * (a desktop widget): the period and the menu only.
 */
export function CardControls({
  spec,
  compact = false,
  focused = false,
  onOpenChange,
  widgetMenu,
}: {
  spec: ChartSpec;
  compact?: boolean;
  focused?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A widget's own menu items (instead of the main window's). */
  widgetMenu?: (close: () => void) => React.ReactNode;
}) {
  const t = useStore((s) => s.t);
  const catalog = useStore((s) => s.catalog);
  const widgets = useStore((s) => s.widgets);
  // The filters are edited as a draft and saved when their box closes (one change, one Undo). A ref too: the box
  // closes from a listener registered when it opened.
  const [draft, setDraftState] = useState<ChartSpec | null>(null);
  const draftRef = useRef<ChartSpec | null>(null);
  const setDraft = (d: ChartSpec | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const isDate = spec.x?.field === "date";
  const onDesktop = widgets.find((w) => w.chart_id === spec.id);
  const change = (next: ChartSpec) => void changeChart(next);

  return (
    <div className="card-controls" onPointerDown={(e) => e.stopPropagation()}>
      <PopButton
        className="ctl"
        title={t("controls.period")}
        label={
          <>
            <CalendarRange size={14} strokeWidth={1.8} />
            <span className="ctl-text">{B.periodLabel(t, spec.period)}</span>
          </>
        }
        onOpenChange={onOpenChange}
      >
        {(close) => (
          <div className="menu-list" role="menu">
            {QUICK_PERIODS.map((p) => (
              <MenuRow
                key={`${p.kind}${"months" in p ? p.months : ""}`}
                label={B.periodLabel(t, p)}
                on={samePeriod(spec.period, p)}
                onClick={() => {
                  close();
                  change({ ...spec, period: { ...p } });
                }}
              />
            ))}
            <MenuSep />
            <MenuRow
              label={t("controls.morePeriods")}
              onClick={() => {
                close();
                // from a widget, the editor opens in the main window
                if (widgetMenu) host.desktop?.openMain(`edit:${spec.id}`);
                else openEditor(spec);
              }}
            />
          </div>
        )}
      </PopButton>
      {!compact && (
        <>
          <PopButton
            className="ctl"
            title={t("controls.filters")}
            width={360}
            label={
              <>
                <Filter size={14} strokeWidth={1.8} />
                {spec.filters.length > 0 && (
                  <span className="ctl-badge">{spec.filters.length}</span>
                )}
              </>
            }
            onOpenChange={(open) => {
              onOpenChange?.(open);
              const d = draftRef.current;
              if (open) setDraft(spec);
              else {
                if (d && JSON.stringify(d.filters) !== JSON.stringify(spec.filters)) change(d);
                setDraft(null);
              }
            }}
          >
            {() =>
              catalog ? (
                <div className="pop-section">
                  <FiltersEditor
                    spec={draft ?? spec}
                    cat={catalog}
                    edit={(fn) => setDraft(B.normalize(fn(draftRef.current ?? spec)))}
                  />
                </div>
              ) : (
                <p className="muted pop-section">{t("editor.loading")}</p>
              )
            }
          </PopButton>
          {spec.kind !== "number" && (
            <PopButton
              className="ctl"
              title={t("controls.sort")}
              label={<ArrowUpDown size={14} strokeWidth={1.8} />}
              onOpenChange={onOpenChange}
            >
              {(close) => (
                <div className="menu-list" role="menu">
                  {["auto", "value_desc", "value_asc", "label"].map((id) => (
                    <MenuRow
                      key={id}
                      label={t(`editor.sort.${id}`)}
                      on={spec.sort === id}
                      onClick={() => {
                        close();
                        change({ ...spec, sort: id });
                      }}
                    />
                  ))}
                  {!isDate && (
                    <>
                      <MenuSep />
                      {TOP_CHOICES.map((n) => (
                        <MenuRow
                          key={String(n)}
                          label={n == null ? t("controls.topAll") : t("controls.top", { n })}
                          on={spec.top === n}
                          onClick={() => {
                            close();
                            change({ ...spec, top: n });
                          }}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </PopButton>
          )}
          <PopButton
            className="ctl"
            title={t("controls.kind")}
            label={<BarChart3 size={14} strokeWidth={1.8} />}
            onOpenChange={onOpenChange}
          >
            {(close) => (
              <div className="menu-list" role="menu">
                {(catalog?.kinds ?? []).map((k) => (
                  <MenuRow
                    key={k.id}
                    label={k.label}
                    on={spec.kind === k.id}
                    onClick={() => {
                      close();
                      change({ ...spec, kind: k.id });
                    }}
                  />
                ))}
              </div>
            )}
          </PopButton>
          <PopButton
            className="ctl"
            title={t("controls.color")}
            label={
              <span className="swatch" style={{ background: spec.color ?? "var(--accent)" }} />
            }
            onOpenChange={onOpenChange}
          >
            {(close) => (
              <div className="swatches" role="radiogroup" aria-label={t("controls.color")}>
                {PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    role="radio"
                    aria-checked={spec.color === c.hex}
                    aria-label={t(`color.${c.name}`)}
                    title={t(`color.${c.name}`)}
                    className={`swatch big${spec.color === c.hex ? " on" : ""}`}
                    style={{ background: c.hex }}
                    onClick={() => {
                      close();
                      change({ ...spec, color: c.hex });
                    }}
                  />
                ))}
              </div>
            )}
          </PopButton>
          {!focused && (
            <button
              type="button"
              className="ctl"
              title={t("controls.open")}
              aria-label={t("controls.open")}
              onClick={() => showChart(spec.id)}
            >
              <Maximize2 size={14} strokeWidth={1.8} />
            </button>
          )}
        </>
      )}
      <PopButton
        className="ctl"
        title={t("controls.more")}
        label={<MoreHorizontal size={15} strokeWidth={1.8} />}
        onOpenChange={onOpenChange}
      >
        {(close) =>
          widgetMenu ? (
            widgetMenu(close)
          ) : (
            <div className="menu-list" role="menu">
              <MenuRow
                label={t("controls.edit")}
                onClick={() => {
                  close();
                  openEditor(spec);
                }}
              />
              <MenuRow
                label={t("controls.duplicate")}
                onClick={() => {
                  close();
                  void duplicateChart(spec);
                }}
              />
              <MenuRow
                label={spec.home ? t("controls.hideHome") : t("controls.showHome")}
                onClick={() => {
                  close();
                  change({ ...spec, home: !spec.home });
                }}
              />
              {host.desktop && (
                <MenuRow
                  label={onDesktop ? t("controls.removeDesktop") : t("controls.addDesktop")}
                  onClick={() => {
                    close();
                    if (onDesktop) void removeWidget(onDesktop.id);
                    else void addWidget(spec.id);
                  }}
                />
              )}
              <MenuRow
                label={t("controls.refresh")}
                onClick={() => {
                  close();
                  refresh();
                }}
              />
              <MenuSep />
              <MenuRow
                label={t("controls.delete")}
                danger
                onClick={() => {
                  close();
                  deleteChart(spec.id);
                }}
              />
            </div>
          )
        }
      </PopButton>
    </div>
  );
}
