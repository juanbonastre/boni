import {
  applies,
  argKeys,
  type BlockKind,
  type ButtonArg,
  type ButtonArgs,
  type CatalogueData,
  type CatalogueFlow,
  type ControlBlock,
  controlsOf,
  fitAfter,
  HEIGHTS,
  kindOf,
  type Option,
  optionsOf,
  type PageBlock,
  refOf,
  refTo,
  type Setting,
  WIDTHS,
} from "@boni/views";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonFlows, catalogueOf } from "../core/blocks.ts";
import type { Shortcut } from "../core/contract.ts";
import { setHeight, setWidth } from "../core/grid.ts";
import { PALETTE } from "../core/palette.ts";
import { formOf, shortcutValues } from "../core/shortcuts.ts";
import { catText, type T } from "../i18n.ts";
import {
  agentApi,
  closePanel,
  loadDataTypes,
  loadScreen,
  optionList,
  setPageBlocks,
  toast,
  todayIso,
  useEditing,
  useStore,
} from "../store.ts";
import { FormView } from "./FormView.tsx";
import { PageChatSettings } from "./PageChatBlock.tsx";

/**
 * A block's settings in the side panel («Modificar…»): a control for each setting its kind has in the block
 * catalogue (packages/views catalogue.ts), nothing more and nothing technical. What an AI can set on a block, the
 * user can change here: the panel is drawn from the same list the AI is given. Common things first («Datos»,
 * «Aspecto»); the rows a block counts, folded («Solo algunas filas»).
 */
export function BlockPanel({ id }: { id: string }) {
  const t = useStore((s) => s.t);
  const page = useEditing();
  const dataTypes = useStore((s) => s.dataTypes);
  const pages = useStore((s) => s.pages);
  useEffect(() => {
    if (!dataTypes) void loadDataTypes();
  }, []);
  const shortcuts = useStore((s) => s.shortcuts);
  const blocks = page?.spec.blocks ?? [];
  const block = blocks.find((b) => b.id === id);
  const kind = block ? kindOf(block.type) : undefined;
  // A button of the first pages runs a saved shortcut: shown with that shortcut's data, and saved as its own.
  const raw = (block?.type === "action" && block.shortcut ? ownButton(block, shortcuts) : block) as
    | Record<string, unknown>
    | undefined;
  const [filterOpen, setFilterOpen] = useState(Boolean(raw?.filterField));
  // The flows a button may start, once its panel is open (D-60).
  const [flows, setFlows] = useState<CatalogueFlow[] | null>(null);
  const isButton = block?.type === "action";
  useEffect(() => {
    if (!isButton) return;
    let live = true;
    agentApi
      .flows()
      .then((fs) => live && setFlows(buttonFlows(fs)))
      .catch(() => live && setFlows([]));
    return () => {
      live = false;
    };
  }, [isButton]);
  if (!block || !raw) return <p className="muted panel-body">{t("block.panel.gone")}</p>;
  const controls = controlsOf(blocks);
  const data = catalogueOf(dataTypes, pages, controls, flows);
  // A control's value is changed on the page, in the control itself.
  const settings = (kind?.settings ?? []).filter((s) => applies(s, raw) && s.type !== "current");
  const set = (key: string, value: unknown) => {
    const next: Record<string, unknown> = { ...raw };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    const fitted = fitAfter(next, key, data) as unknown as PageBlock;
    setPageBlocks(blocks.map((b) => (b.id === id ? fitted : b)));
  };
  const control = (s: Setting) =>
    s.type === "pass" ? (
      <PassControl
        key={s.key}
        label={catText(t, s.label)}
        to={String(raw.to ?? "")}
        value={raw.pass as Record<string, string | number> | undefined}
        controls={controls}
        set={(v) => set(s.key, v)}
      />
    ) : s.type === "args" ? (
      <ArgsControl
        key={s.key}
        s={s}
        block={raw}
        data={data}
        controls={controls}
        set={(v) => set(s.key, v)}
      />
    ) : (
      <SettingControl key={s.key} s={s} block={raw} data={data} set={set} />
    );
  const section = (sec: Setting["section"]) => settings.filter((s) => s.section === sec);
  const look = section("look");
  const filter = section("filter");
  return (
    <>
      <div className="panel-body form block-panel">
        {block.type === "chat" && (
          <div className="block-panel-sec">
            <PageChatSettings key={block.flow} flow={block.flow} />
          </div>
        )}
        {section("data").length > 0 && (
          <div className="block-panel-sec">
            <h3 className="block-panel-head">{t("block.panel.data")}</h3>
            {section("data").map(control)}
          </div>
        )}
        <div className="block-panel-sec">
          <h3 className="block-panel-head">{t("block.panel.look")}</h3>
          {look.map(control)}
          <Choice
            label={catText(t, "Ancho")}
            value={block.at?.w ?? 12}
            options={WIDTHS}
            onChange={(w) => setPageBlocks(setWidth(blocks, id, Number(w)))}
          />
          {kind?.h && (
            <Choice
              label={catText(t, "Altura")}
              value={block.at?.h ?? kind.h}
              options={HEIGHTS}
              onChange={(h) => setPageBlocks(setHeight(blocks, id, h as "s" | "m" | "l"))}
            />
          )}
        </div>
        {filter.length > 0 && (
          <div className="block-panel-sec">
            <button
              type="button"
              className={`more-toggle${filterOpen ? " open" : ""}`}
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen(!filterOpen)}
            >
              <ChevronDown size={18} strokeWidth={1.8} />
              {t("block.panel.filter")}
            </button>
            {filterOpen && filter.map(control)}
          </div>
        )}
      </div>
      <footer className="panel-foot">
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            closePanel();
            setPageBlocks(blocks.filter((b) => b.id !== id));
            toast(t("block.removed"), { label: t("toast.undo"), run: () => setPageBlocks(blocks) });
          }}
        >
          {t("block.panel.remove")}
        </button>
      </footer>
    </>
  );
}

/** A button of the first pages as a button of the catalogue, with its shortcut's data. */
function ownButton(b: Extract<PageBlock, { type: "action" }>, shortcuts: Shortcut[]) {
  const sc = shortcuts.find((s) => s.id === b.shortcut);
  const color = PALETTE.find((c) => c.hex === sc?.color)?.name;
  const { shortcut: _s, ...rest } = b;
  return {
    ...rest,
    mode: sc?.mode ?? "open",
    values: sc?.values ?? {},
    ...(color ? { color } : {}),
  };
}

/** A kind's name in the interface's language (the panel's title). */
export const kindName = (t: T, k: BlockKind | undefined, type: string) =>
  k ? catText(t, k.name) : t(`block.kind.${type}`);

function SettingControl({
  s,
  block,
  data,
  set,
}: {
  s: Setting;
  block: Record<string, unknown>;
  data: ReturnType<typeof catalogueOf>;
  set: (key: string, v: unknown) => void;
}) {
  const t = useStore((st) => st.t);
  const label = catText(t, s.label);
  const value = block[s.key];
  if (s.type === "values")
    return (
      <ValuesControl
        label={label}
        screen={String(block.screen ?? "")}
        value={value}
        set={(v) => set(s.key, v)}
      />
    );
  if (s.type === "text") {
    const text = String(value ?? "");
    const max = s.max ?? 200;
    if (max > 200)
      return (
        <label className="field">
          <span className="field-label">{label}</span>
          <textarea
            className="input"
            rows={3}
            value={text}
            maxLength={max}
            onChange={(e) => set(s.key, e.target.value)}
          />
        </label>
      );
    return (
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          className="input"
          value={text}
          maxLength={max}
          onChange={(e) => set(s.key, e.target.value)}
        />
      </label>
    );
  }
  if (s.type === "toggle")
    return (
      <label className="toggle-row">
        <input
          type="checkbox"
          className="switch"
          checked={value === true}
          onChange={(e) => set(s.key, e.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  if (s.type === "color")
    return (
      <div className="field">
        <span className="field-label">{label}</span>
        <div className="block-swatches" role="radiogroup" aria-label={label}>
          <button
            type="button"
            role="radio"
            className={`swatch big hollow${value == null ? " on" : ""}`}
            aria-label={t("block.noColor")}
            title={t("block.noColor")}
            aria-checked={value == null}
            onClick={() => set(s.key, undefined)}
          />
          {PALETTE.map((c) => (
            <button
              key={c.name}
              type="button"
              role="radio"
              className={`swatch big${value === c.name ? " on" : ""}`}
              style={{ background: c.hex }}
              aria-label={t(`color.${c.name}`)}
              title={t(`color.${c.name}`)}
              aria-checked={value === c.name}
              onClick={() => set(s.key, c.name)}
            />
          ))}
        </div>
      </div>
    );
  const fromData = typeof s.options === "string";
  const options = optionsOf(s, block, data).map((o) => ({
    ...o,
    label:
      fromData && !String(o.value).startsWith("@") && s.options !== "periods"
        ? o.label
        : catText(t, o.label),
  }));
  return (
    <Choice
      label={label}
      value={value}
      options={options}
      empty={s.optional ? "—" : undefined}
      onChange={(v) => set(s.key, v)}
    />
  );
}

/**
 * What a link carries to the page it opens (D-59): for each control of that page, what a control of this page of
 * the same kind holds, or nothing. A value of its own is the assistant's (`pages.add_block`); it is kept, said as is.
 */
function PassControl({
  label,
  to,
  value,
  controls,
  set,
}: {
  label: string;
  to: string;
  value: Record<string, string | number> | undefined;
  controls: readonly ControlBlock[];
  set: (v: Record<string, string | number> | undefined) => void;
}) {
  const t = useStore((st) => st.t);
  const [theirs, setTheirs] = useState<ControlBlock[] | null>(null);
  useEffect(() => {
    setTheirs(null);
    if (!to) return;
    let live = true;
    agentApi
      .page(to)
      .then((p) => live && setTheirs(p ? controlsOf(p.spec.blocks) : []))
      .catch(() => live && setTheirs([]));
    return () => {
      live = false;
    };
  }, [to]);
  if (!to) return null;
  if (!theirs) return <p className="muted small">{t("chart.loading")}</p>;
  if (!theirs.length) return null;
  const put = (id: string, v: string | number | undefined) => {
    const next = { ...(value ?? {}) };
    if (v === undefined) delete next[id];
    else next[id] = v;
    set(Object.keys(next).length ? next : undefined);
  };
  return (
    <div className="block-panel-values">
      <h3 className="block-panel-head">{label}</h3>
      {theirs.map((c) => {
        const now = value?.[c.id];
        const own = now !== undefined && refOf(now) === null;
        const options: Option[] = [
          ...(own ? [{ value: now, label: String(now) }] : []),
          ...controls
            // An option passes only to a control over the same field (its value is one of that field's).
            .filter(
              (x) =>
                x.kind === c.kind &&
                (c.kind !== "option" || (x.collection === c.collection && x.field === c.field)),
            )
            .map((x) => ({ value: refTo(x.id), label: x.name })),
        ];
        return (
          <Choice
            key={c.id}
            label={c.name}
            value={now}
            options={options}
            empty="—"
            onChange={(v) => put(c.id, v)}
          />
        );
      })}
    </div>
  );
}

/**
 * What a button passes (D-60): for each field of its collection, or each name of its flow's form, nothing, a control
 * of the page (what it holds when pressed) or a value typed here.
 */
function ArgsControl({
  s,
  block,
  data,
  controls,
  set,
}: {
  s: Setting;
  block: Record<string, unknown>;
  data: CatalogueData;
  controls: readonly ControlBlock[];
  set: (v: ButtonArgs | undefined) => void;
}) {
  const t = useStore((st) => st.t);
  const keys = argKeys(s, block, data) ?? [];
  const fields = data.collections.find((c) => c.id === block.collection)?.fields ?? [];
  const value = (block[s.key] ?? {}) as ButtonArgs;
  const put = (k: string, v: ButtonArg | undefined) => {
    const next = { ...value };
    if (v === undefined) delete next[k];
    else next[k] = v;
    set(Object.keys(next).length ? next : undefined);
  };
  if (!keys.length) return null;
  const LIT = "=";
  return (
    <div className="block-panel-values">
      <h3 className="block-panel-head">{catText(t, s.label)}</h3>
      {keys.map((k) => {
        const f = block.does === "flow" ? undefined : fields.find((x) => x.id === k);
        const now = value[k];
        const lit = now !== undefined && refOf(now) === null;
        const numeric = f && (f.type === "number" || f.type === "money" || f.type === "duration");
        return (
          <div key={k} className="field">
            <span className="field-label">{f?.name ?? k}</span>
            <div className="args-row">
              <select
                className="input"
                aria-label={f?.name ?? k}
                value={now === undefined ? "" : lit ? LIT : String(now)}
                onChange={(e) =>
                  put(
                    k,
                    e.target.value === ""
                      ? undefined
                      : e.target.value === LIT
                        ? ""
                        : e.target.value,
                  )
                }
              >
                <option value="">—</option>
                {controls.map((c) => (
                  <option key={c.id} value={refTo(c.id)}>
                    {c.name}
                  </option>
                ))}
                <option value={LIT}>{t("button.args.value")}</option>
              </select>
              {lit && (
                <input
                  className="input"
                  aria-label={t("button.args.value")}
                  inputMode={numeric ? "decimal" : undefined}
                  value={String(now)}
                  maxLength={200}
                  onChange={(e) => {
                    const v = e.target.value;
                    const n = Number(v.replace(",", "."));
                    put(k, numeric && v.trim() && Number.isFinite(n) ? n : v);
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A button's data: the screen's own form (as the phone's shortcut editor), saved with its button. */
function ValuesControl({
  label,
  screen,
  value,
  set,
}: {
  label: string;
  screen: string;
  value: unknown;
  set: (v: unknown) => void;
}) {
  const t = useStore((st) => st.t);
  const form = useStore((st) => formOf(st.screens[screen]));
  useEffect(() => {
    if (!form && screen) void loadScreen(screen).catch(() => undefined);
  }, [screen]);
  if (!form) return <p className="muted small">{t("chart.loading")}</p>;
  return (
    <div className="block-panel-values">
      <h3 className="block-panel-head">{label}</h3>
      <FormView
        key={JSON.stringify(value ?? {})}
        form={form}
        today={todayIso()}
        loadOptions={optionList}
        initial={(value ?? {}) as Shortcut["values"]}
        collapse
        mode="values"
        submitLabel={t("block.saveValues")}
        onSubmit={async (values) => {
          set(shortcutValues(form, values));
          toast(t("block.valuesSaved"));
          return {};
        }}
      />
    </div>
  );
}

/**
 * A choice among a list. A value that is not in the list (a field since removed, a value an AI got wrong) is
 * shown as it is, marked, never as the list's first one.
 */
function Choice({
  label,
  value,
  options,
  empty,
  onChange,
}: {
  label: string;
  value: unknown;
  options: readonly Option[];
  empty?: string;
  onChange: (v: string | number | undefined) => void;
}) {
  const t = useStore((s) => s.t);
  const known = options.some((o) => o.value === value);
  const missing = value !== undefined && value !== "" && !known;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        className={`input${missing ? " invalid" : ""}`}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          onChange(o ? o.value : undefined);
        }}
      >
        {(empty !== undefined || value === undefined) && <option value="">{empty ?? ""}</option>}
        {missing && (
          <option value={String(value)}>
            {t("block.problem.not-in-data", { label: String(value) })}
          </option>
        )}
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
