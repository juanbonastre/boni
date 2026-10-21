import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { Page } from "../core/agent.ts";
import { isCategoryKind, newSpec } from "../core/chartBuilder.ts";
import { emptyState } from "../core/charts.ts";
import {
  addPageBlock,
  blockId,
  newChartForPage,
  newPage,
  openScreen,
  runShortcut,
  setPageBlocks,
  setPageEditing,
  showChat,
  toast,
  useStore,
  useVisibleCharts,
} from "../store.ts";
import { ACCENT } from "./Chart.tsx";
import { ChartCard, ChartCardContent } from "./ChartCard.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

type Block = Page["spec"]["blocks"][number];

/**
 * A page of the user's (docs/extensiones.md 6): its blocks painted by this code, each from the closed
 * catalogue (heading, text, chart, button). Reading, the page is just its content; "Edit page" lists the
 * blocks with their controls (move, remove) and "Add block" at the end, one task at a time.
 */
export function PageView({ after }: { after?: ReactNode }) {
  const t = useStore((s) => s.t);
  const page = useStore((s) => s.page);
  const editing = useStore((s) => s.pageEditing);
  if (!page)
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
  if (editing) return <PageEditor page={page} after={after} />;
  if (!page.spec.blocks.length)
    return (
      <div className="content center">
        <div className="empty-state">
          <p>{t("page.empty")}</p>
          <button type="button" className="btn primary" onClick={() => setPageEditing(true)}>
            {t("page.edit")}
          </button>
        </div>
        <NewChartPreview />
        {after}
      </div>
    );
  return <PageBody blocks={page.spec.blocks} after={after} />;
}

/** The card of a chart being created for this page in the side panel, with the editor's preview. */
function NewChartPreview() {
  const panel = useStore((s) => s.panel);
  const forPage = useStore((s) => s.chartForPage);
  const preview = useStore((s) => (s.editPreview?.id === "" ? s.editPreview.state : null));
  if (panel?.kind !== "edit" || !panel.isNew || !forPage) return null;
  return (
    <div className="dashboard">
      <ChartCardContent
        title={panel.spec.title}
        color={panel.spec.color}
        state={preview ?? emptyState()}
        className="editing new"
      />
    </div>
  );
}

/** Reading: consecutive charts share a grid, consecutive buttons a row. */
function PageBody({ blocks, after }: { blocks: Block[]; after?: ReactNode }) {
  const specs = useVisibleCharts();
  const groups: Block[][] = [];
  for (const b of blocks) {
    if (b.type === "chart" && !specs.some((s) => s.id === b.chart)) continue; // deleted elsewhere
    const last = groups[groups.length - 1];
    const joins = (b.type === "chart" || b.type === "action") && last?.[0]?.type === b.type;
    if (joins) last.push(b);
    else groups.push([b]);
  }
  return (
    <div className="content page">
      {groups.map((g) => {
        const first = g[0] as Block;
        if (first.type === "heading")
          return (
            <h2 key={first.id} className="page-heading">
              {first.text}
            </h2>
          );
        if (first.type === "text")
          return (
            <p key={first.id} className="page-text">
              {first.text}
            </p>
          );
        if (first.type === "action")
          return (
            <div key={first.id} className="page-actions">
              {g.map((b) => (b.type === "action" ? <ActionButton key={b.id} block={b} /> : null))}
            </div>
          );
        return (
          <div key={first.id} className="dashboard">
            {g.map((b) => {
              if (b.type !== "chart") return null;
              const spec = specs.find((s) => s.id === b.chart);
              return (
                <ChartCard
                  key={b.id}
                  chartId={b.chart}
                  className={
                    spec && isCategoryKind(spec.kind) && spec.kind !== "donut" ? "wide" : undefined
                  }
                />
              );
            })}
          </div>
        );
      })}
      <NewChartPreview />
      {after}
    </div>
  );
}

function ActionButton({ block }: { block: Extract<Block, { type: "action" }> }) {
  const t = useStore((s) => s.t);
  const shortcuts = useStore((s) => s.shortcuts);
  const run = () => {
    if (!block.shortcut) return openScreen(block.screen);
    const sc = shortcuts.find((s) => s.id === block.shortcut);
    if (sc) void runShortcut(sc);
    else toast(t("shortcut.gone"));
  };
  return (
    <button type="button" className={block.shortcut ? "pill" : "btn primary"} onClick={run}>
      {!block.shortcut && <Plus size={15} strokeWidth={2} />}
      {block.label}
    </button>
  );
}

/** Editing: every block as a row with its controls, then "Add block". */
function PageEditor({ page, after }: { page: Page; after?: ReactNode }) {
  const t = useStore((s) => s.t);
  const blocks = page.spec.blocks;
  const change = (id: string, next: Block) =>
    void setPageBlocks(blocks.map((b) => (b.id === id ? next : b)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...blocks];
    const [b] = next.splice(i, 1);
    if (b) next.splice(i + by, 0, b);
    void setPageBlocks(next);
  };
  const remove = (id: string) => void setPageBlocks(blocks.filter((b) => b.id !== id));
  return (
    <div className="content page editing">
      {blocks.length === 0 && <p className="muted">{t("page.empty")}</p>}
      <ol className="block-list">
        {blocks.map((b, i) => (
          <li key={b.id} className="block-row">
            <div className="block-main">
              <span className="block-kind">{t(`block.kind.${b.type}`)}</span>
              <BlockFields block={b} onChange={(next) => change(b.id, next)} />
            </div>
            <div className="block-tools">
              <IconButton
                label={`${t("block.up")}: ${t(`block.kind.${b.type}`)}`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={14} strokeWidth={1.8} />
              </IconButton>
              <IconButton
                label={`${t("block.down")}: ${t(`block.kind.${b.type}`)}`}
                disabled={i === blocks.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={14} strokeWidth={1.8} />
              </IconButton>
              <IconButton
                label={`${t("block.remove")}: ${t(`block.kind.${b.type}`)}`}
                onClick={() => remove(b.id)}
              >
                <X size={14} strokeWidth={1.8} />
              </IconButton>
            </div>
          </li>
        ))}
      </ol>
      <div className="page-edit-foot">
        <AddBlock page={page} />
      </div>
      <NewChartPreview />
      {after}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-btn tiny"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A block's own fields: text is kept when it loses the focus (one change, one save). */
function BlockFields({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const t = useStore((s) => s.t);
  const specs = useVisibleCharts();
  if (block.type === "heading")
    return (
      <TextField
        value={block.text}
        className="block-heading-input"
        placeholder={t("block.headingPlaceholder")}
        max={200}
        onSave={(text) => onChange({ ...block, text })}
      />
    );
  if (block.type === "text")
    return (
      <TextField
        value={block.text}
        multiline
        placeholder={t("block.textPlaceholder")}
        max={5000}
        onSave={(text) => onChange({ ...block, text })}
      />
    );
  if (block.type === "action")
    return (
      <TextField
        value={block.label}
        ariaLabel={t("block.label")}
        max={80}
        onSave={(label) => label.trim() && onChange({ ...block, label: label.trim() })}
      />
    );
  const spec = specs.find((s) => s.id === block.chart);
  return spec ? (
    <span className="block-chart">
      <span className="swatch" style={{ ["--c" as string]: spec.color ?? ACCENT }} />
      <span className="nav-name">{spec.title}</span>
    </span>
  ) : (
    <span className="muted">{t("block.chartGone")}</span>
  );
}

function TextField({
  value,
  onSave,
  multiline,
  placeholder,
  ariaLabel,
  className,
  max,
}: {
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  max: number;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const save = () => {
    if (text !== value) onSave(text);
  };
  const common = {
    value: text,
    maxLength: max,
    placeholder,
    "aria-label": ariaLabel ?? placeholder,
    onBlur: save,
    className: `block-input${className ? ` ${className}` : ""}`,
  };
  return multiline ? (
    <textarea {...common} rows={3} onChange={(e) => setText(e.target.value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** "Add block": what can go on a page, grouped (to write, charts, buttons). */
function AddBlock({ page }: { page: Page }) {
  const t = useStore((s) => s.t);
  const specs = useVisibleCharts();
  const home = useStore((s) => s.home);
  const shortcuts = useStore((s) => s.shortcuts);
  const onPage = new Set(page.spec.blocks.flatMap((b) => (b.type === "chart" ? [b.chart] : [])));
  const free = specs.filter((s) => !onPage.has(s.id));
  // The server's screens with a button (what it can capture) and the saved shortcuts.
  const screens = (home?.components ?? []).flatMap((c) =>
    c.type === "button" ? [{ screen: c.screen, label: c.label }] : [],
  );
  return (
    <PopButton
      className="btn"
      align="start"
      width={280}
      title={t("page.add")}
      label={
        <>
          <Plus size={15} strokeWidth={2} />
          {t("page.add")}
        </>
      }
    >
      {(close) => (
        <div className="menu-list scroll" role="menu">
          <div className="menu-head">{t("block.write")}</div>
          <MenuRow
            label={t("block.heading")}
            onClick={() => {
              close();
              addPageBlock({ id: blockId(), type: "heading", text: "" });
            }}
          />
          <MenuRow
            label={t("block.text")}
            onClick={() => {
              close();
              addPageBlock({ id: blockId(), type: "text", text: "" });
            }}
          />
          <MenuSep />
          <div className="menu-head">{t("block.charts")}</div>
          <MenuRow
            label={t("block.chartNew")}
            icon={<Plus size={14} strokeWidth={1.8} />}
            onClick={() => {
              close();
              newChartForPage(newSpec(t("charts.newTitle")));
            }}
          />
          {free.map((s) => (
            <MenuRow
              key={s.id}
              label={s.title}
              icon={<span className="swatch" style={{ ["--c" as string]: s.color ?? ACCENT }} />}
              onClick={() => {
                close();
                addPageBlock({ id: blockId(), type: "chart", chart: s.id });
              }}
            />
          ))}
          {(screens.length > 0 || shortcuts.length > 0) && (
            <>
              <MenuSep />
              <div className="menu-head">{t("block.actions")}</div>
              {screens.map((s) => (
                <MenuRow
                  key={s.screen}
                  label={s.label}
                  onClick={() => {
                    close();
                    addPageBlock({
                      id: blockId(),
                      type: "action",
                      screen: s.screen,
                      label: s.label.slice(0, 80),
                    });
                  }}
                />
              ))}
              {shortcuts.map((s) => (
                <MenuRow
                  key={s.id}
                  label={s.label}
                  onClick={() => {
                    close();
                    addPageBlock({
                      id: blockId(),
                      type: "action",
                      screen: s.screen,
                      label: s.label.slice(0, 80),
                      shortcut: s.id,
                    });
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </PopButton>
  );
}

/** No pages yet: what Boni is for, and the first step. */
export function Welcome({ error, after }: { error?: string | null; after?: ReactNode }) {
  const t = useStore((s) => s.t);
  return (
    <div className="content center">
      {error && <p className="form-error">{error}</p>}
      <div className="empty-state welcome">
        <img src="./favicon.png" alt="" width={56} height={56} />
        <h2>{t("welcome.title")}</h2>
        <p>{t("welcome.text")}</p>
        <div className="welcome-actions">
          <button type="button" className="btn primary" onClick={() => void newPage()}>
            <Plus size={15} strokeWidth={2} />
            {t("page.new")}
          </button>
          <button type="button" className="btn" onClick={showChat}>
            {t("welcome.chat")}
          </button>
        </div>
      </div>
      {after}
    </div>
  );
}
