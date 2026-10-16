import {
  assignRole,
  candidateColumns,
  columnOfRole,
  formatMinute,
  fromLocal,
  isRequired,
  occurrenceDays,
  occurrenceId,
  PALETTE,
  type PropertyDef,
  type PropertyType,
  parseQuickEvent,
  rolesOf,
  type SelectOption,
  setDoneValues,
  toLocal,
} from "@boni-calendar/core";
import { Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { getHost, onKeys } from "../host.ts";
import { type Key, t } from "../i18n.ts";
import { useApp } from "../store.ts";
import { vaultBridge } from "../vaultBridge.ts";
import { ChoicePicker, DraftInput } from "./fields.tsx";

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    return onKeys(key, true);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} title={t("event.close")}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <small className="muted">{hint}</small>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.v)}
          role="radio"
          aria-checked={o.v === value}
          className={o.v === value ? "on" : ""}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TIMEZONES = [
  "Europe/Madrid",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Lisbon",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Bogota",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

/** The vault the calendars come from (desktop app, Obsidian): its folder, writing, what was read. */
function VaultSettings() {
  const writeOn = useApp((s) => s.settings.vaultWrite);
  const source = useApp((s) => s.source);
  const vault = useApp((s) => s.vault);
  const app = useApp.getState();
  useEffect(() => {
    void vaultBridge()
      ?.getRoot()
      .then((r) => r.ok && useApp.setState((s) => ({ vault: { ...s.vault, root: r.value } })));
  }, []);
  const reason = (r: string) => (r === "no-date" ? t("vault.reason.no-date") : r);
  const fixedVault = !!getHost().fixedVault;
  return (
    <>
      <h3>{t("settings.data")}</h3>
      <Field label={t("settings.vaultFolder")}>
        <span className="vault-path" title={vault.root ?? undefined}>
          {/* bdi keeps the path's own direction inside the right-to-left box that cuts it from the left */}
          <bdi>{vault.root ?? t("settings.vaultNone")}</bdi>
        </span>
        {!fixedVault && (
          <button type="button" className="btn" onClick={() => void app.chooseVaultRoot()}>
            {t("settings.vaultChoose")}
          </button>
        )}
      </Field>
      {source === "vault" && (
        <>
          <Field label={t("settings.vaultWrite")} hint={t("settings.vaultWriteHint")}>
            <Segmented
              value={writeOn}
              onChange={(v) => useApp.getState().setSettings({ vaultWrite: v })}
              options={[
                { v: false, label: t("settings.vaultWrite.off") },
                { v: true, label: t("settings.vaultWrite.on") },
              ]}
            />
          </Field>
          <Field label={t("settings.vaultStatus", { n: vault.notes, m: vault.ignored.length })}>
            <button type="button" className="btn" onClick={() => void app.loadVault()}>
              {t("settings.vaultReload")}
            </button>
          </Field>
          {vault.ignored.length > 0 && (
            <details className="vault-list">
              <summary>
                {t("settings.vaultIgnored")} ({vault.ignored.length})
              </summary>
              <ul>
                {vault.ignored.map((n) => (
                  <li key={n.path}>
                    <span className="vault-note-path">{n.path}</span>
                    <span className="muted">{reason(n.reason)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {vault.problems.length > 0 && (
            <details className="vault-list" open>
              <summary>
                {t("settings.vaultProblems")} ({vault.problems.length})
              </summary>
              <ul>
                {vault.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}

export function SettingsModal() {
  const settings = useApp((s) => s.settings);
  const source = useApp((s) => s.source);
  const set = useApp((s) => s.setSettings);
  const close = () => useApp.getState().set({ settingsOpen: false });
  const tzs = TIMEZONES.includes(settings.tz) ? TIMEZONES : [settings.tz, ...TIMEZONES];
  return (
    <Modal title={t("settings.title")} onClose={close}>
      <h3>{t("settings.appearance")}</h3>
      <Field label={t("settings.theme")}>
        <Segmented
          value={settings.theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { v: "dark", label: t("settings.theme.dark") },
            { v: "light", label: t("settings.theme.light") },
            { v: "system", label: t("settings.theme.system") },
          ]}
        />
      </Field>
      <Field label={t("settings.density")}>
        <Segmented
          value={settings.density}
          onChange={(v) => set({ density: v })}
          options={[
            { v: "compact", label: t("settings.density.compact") },
            { v: "comfortable", label: t("settings.density.comfortable") },
          ]}
        />
      </Field>
      <Field label={t("settings.language")}>
        <Segmented
          value={settings.locale}
          onChange={(v) => set({ locale: v })}
          options={[
            { v: "es", label: "Español" },
            { v: "en", label: "English" },
          ]}
        />
      </Field>
      <h3>{t("settings.time")}</h3>
      <Field label={t("settings.firstDay")}>
        <Segmented
          value={settings.firstDay}
          onChange={(v) => set({ firstDay: v })}
          options={[
            { v: 1, label: t("settings.monday") },
            { v: 0, label: t("settings.sunday") },
          ]}
        />
      </Field>
      <Field label={t("settings.hourFormat")}>
        <Segmented
          value={settings.h24}
          onChange={(v) => set({ h24: v })}
          options={[
            { v: true, label: t("settings.h24") },
            { v: false, label: t("settings.h12") },
          ]}
        />
      </Field>
      <Field label={t("settings.timezone")}>
        <select
          className="select"
          value={settings.tz}
          onChange={(e) => set({ tz: e.target.value })}
        >
          {tzs.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("settings.secondTz")}>
        <select
          className="select"
          value={settings.secondTz ?? ""}
          onChange={(e) => set({ secondTz: e.target.value || null })}
        >
          <option value="">{t("settings.none")}</option>
          {TIMEZONES.filter((z) => z !== settings.tz).map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("settings.weekNumbers")}>
        <Segmented
          value={settings.weekNumbers}
          onChange={(v) => set({ weekNumbers: v })}
          options={[
            { v: false, label: "No" },
            { v: true, label: locale() === "es" ? "Sí" : "Yes" },
          ]}
        />
      </Field>
      <Field label={t("settings.defaultDuration")}>
        <Segmented
          value={settings.defaultDuration}
          onChange={(v) => set({ defaultDuration: v })}
          options={[15, 30, 45, 60, 90].map((v) => ({ v, label: String(v) }))}
        />
      </Field>
      <Field label={t("settings.snap")}>
        <Segmented
          value={settings.snap}
          onChange={(v) => set({ snap: v })}
          options={[5, 10, 15, 30].map((v) => ({ v, label: String(v) }))}
        />
      </Field>
      {vaultBridge() && <VaultSettings />}
      {source !== "vault" && (
        <>
          <h3>{t("settings.general")}</h3>
          <Field label={t("settings.reset")} hint={t("settings.resetHint")}>
            <button type="button" className="btn" onClick={() => useApp.getState().resetData()}>
              {t("settings.reset")}
            </button>
          </Field>
        </>
      )}
    </Modal>
  );
}

const locale = () => useApp.getState().settings.locale;

const TYPES: PropertyType[] = [
  "text",
  "number",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "url",
  "project",
];
const COLOR_CHOICES = Object.values(PALETTE);

export function SchemaEditor({ calendarId }: { calendarId: string }) {
  const cal = useApp((s) => s.data.calendars.find((c) => c.id === calendarId));
  const update = useApp((s) => s.updateCalendar);
  const setSchema = useApp((s) => s.setSchema);
  const close = () => useApp.getState().set({ schemaCalendarId: null });
  if (!cal) return null;
  const schema = cal.schema;
  const patch = (id: string, p: Partial<PropertyDef>) =>
    setSchema(
      cal.id,
      schema.map((d) => (d.id === id ? { ...d, ...p } : d)),
    );
  const nextId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return (
    <Modal title={t("schema.title", { name: cal.name })} onClose={close} wide>
      <p className="muted">{t("schema.subtitle")}</p>
      <Field label={t("schema.calendarName")}>
        <DraftInput
          value={cal.name}
          onCommit={(v) => v.trim() && update(cal.id, { name: v.trim() })}
        />
      </Field>
      <Field label={t("schema.color")}>
        <div className="swatches">
          {COLOR_CHOICES.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch pick ${c === cal.color ? "on" : ""}`}
              style={{ "--c": c } as React.CSSProperties}
              onClick={() => update(cal.id, { color: c })}
              aria-label={c}
            />
          ))}
        </div>
      </Field>
      <ViewMapping calendarId={cal.id} />
      <h3 className="schema-head">{t("schema.props")}</h3>
      <div className="schema-list">
        {schema.map((d) => (
          <div key={d.id} className="schema-row">
            <div className="schema-main">
              <DraftInput
                value={d.name}
                onCommit={(v) => v.trim() && patch(d.id, { name: v.trim() })}
              />
              <select
                className="select"
                value={d.type}
                onChange={(e) => {
                  const type = e.target.value as PropertyType;
                  patch(d.id, {
                    type,
                    options:
                      type === "select" || type === "multiselect" ? (d.options ?? []) : undefined,
                  });
                }}
              >
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`prop.type.${ty}` as Key)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title={t("schema.remove")}
                onClick={() =>
                  setSchema(
                    cal.id,
                    schema.filter((x) => x.id !== d.id),
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
            {(d.type === "select" || d.type === "multiselect") && (
              <OptionsEditor
                options={d.options ?? []}
                onChange={(options) => patch(d.id, { options })}
              />
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn add"
        onClick={() =>
          setSchema(cal.id, [...schema, { id: nextId(), name: t("event.untitled"), type: "text" }])
        }
      >
        <Plus size={14} /> {t("schema.add")}
      </button>
    </Modal>
  );
}

/** Which column of each row plays which role in the calendar (date, times, tasks). */
function ViewMapping({ calendarId }: { calendarId: string }) {
  const view = useApp((s) => s.views.find((v) => v.id === calendarId));
  const coll = useApp((s) => s.collections.find((c) => c.id === view?.collectionId));
  const setMapping = useApp((s) => s.setMapping);
  if (!view || !coll) return null;
  const m = view.mapping;
  const taskCol = coll.columns.find((c) => c.id === m.task?.column);
  return (
    <>
      <h3 className="schema-head">{t("schema.view")}</h3>
      <p className="muted">{t("schema.viewHint")}</p>
      {rolesOf(m).map((role) => (
        <Field key={role} label={t(`schema.map.${role}` as Key)}>
          <select
            className="select"
            aria-label={t(`schema.map.${role}` as Key)}
            value={columnOfRole(m, role) ?? ""}
            onChange={(e) =>
              setMapping(view.id, assignRole(m, coll, role, e.target.value || undefined))
            }
          >
            {!isRequired(role) && (
              <option value="">
                {role === "task" ? t("schema.map.noTasks") : t("schema.map.none")}
              </option>
            )}
            {candidateColumns(coll, m, role).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      ))}
      {taskCol?.type === "select" && m.task && (
        <Field label={t("schema.map.doneWhen")}>
          <ChoicePicker
            multi
            choices={(taskCol.options ?? []).map((o) => ({
              id: o.id,
              label: o.label,
              color: o.color,
            }))}
            selected={m.task.doneValues ?? []}
            placeholder="—"
            onChange={(ids) => {
              // At least one done state and one open state must remain.
              if (ids.length > 0 && ids.length < (taskCol.options?.length ?? 0)) {
                setMapping(view.id, setDoneValues(m, ids));
              }
            }}
          />
        </Field>
      )}
    </>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: SelectOption[];
  onChange: (o: SelectOption[]) => void;
}) {
  return (
    <div className="options">
      {options.map((o, i) => (
        <span key={o.id} className="option-edit" style={{ "--c": o.color } as React.CSSProperties}>
          <button
            type="button"
            className="swatch sm pick"
            title={t("schema.color")}
            onClick={() => {
              const idx = COLOR_CHOICES.indexOf(o.color as (typeof COLOR_CHOICES)[number]);
              const color = COLOR_CHOICES[(idx + 1) % COLOR_CHOICES.length] ?? o.color;
              onChange(options.map((x, j) => (j === i ? { ...x, color } : x)));
            }}
          />
          <DraftInput
            value={o.label}
            onCommit={(v) =>
              onChange(options.map((x, j) => (j === i ? { ...x, label: v || x.label } : x)))
            }
          />
          <button
            type="button"
            className="icon-btn tiny"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="mini-btn"
        onClick={() =>
          onChange([
            ...options,
            {
              id: `o${Date.now().toString(36)}`,
              label: t("prop.addOption"),
              color: COLOR_CHOICES[options.length % COLOR_CHOICES.length] ?? "#94a3b8",
            },
          ])
        }
      >
        <Plus size={12} /> {t("prop.addOption")}
      </button>
    </div>
  );
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function Palette() {
  const close = () => useApp.getState().set({ paletteOpen: false });
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const app = useApp();
  useEffect(() => inputRef.current?.focus(), []);

  const parsed = useMemo(
    () =>
      q.trim()
        ? parseQuickEvent(q, {
            today: app.today(),
            calendars: app.data.calendars.filter((c) => !c.readOnly),
            defaultDuration: app.settings.defaultDuration,
          })
        : null,
    [q, app.data.calendars, app.settings.defaultDuration, app.today],
  );

  const commands: Command[] = useMemo(() => {
    const s = useApp.getState();
    const list: Command[] = [
      { id: "today", label: t("cmd.today"), hint: "T", run: () => s.goToday() },
      { id: "day", label: t("cmd.day"), hint: "D", run: () => s.setView("day") },
      { id: "week", label: t("cmd.week"), hint: "W", run: () => s.setView("week") },
      { id: "month", label: t("cmd.month"), hint: "M", run: () => s.setView("month") },
      ...[3, 4, 5].map((n) => ({
        id: `d${n}`,
        label: t("cmd.days", { n }),
        hint: String(n),
        run: () => s.setView("days", n),
      })),
      {
        id: "settings",
        label: t("cmd.settings"),
        hint: "Ctrl+,",
        run: () => s.set({ settingsOpen: true }),
      },
      { id: "sidebar", label: t("cmd.sidebar"), hint: "[", run: () => s.toggleSidebar() },
      {
        id: "theme",
        label: t("cmd.theme"),
        run: () => s.setSettings({ theme: s.settings.theme === "dark" ? "light" : "dark" }),
      },
      { id: "undo", label: t("cmd.undo"), hint: "Ctrl+Z", run: () => s.undo() },
      { id: "redo", label: t("cmd.redo"), hint: "Ctrl+Shift+Z", run: () => s.redo() },
      { id: "help", label: t("cmd.shortcuts"), hint: "?", run: () => s.set({ helpOpen: true }) },
    ];
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((c) => c.label.toLowerCase().includes(needle)) : list;
  }, [q]);

  const createItem: Command | null = parsed?.title
    ? {
        id: "create",
        label: `${t("palette.create")}: ${parsed.title}`,
        run: () => {
          const s = useApp.getState();
          const tz = s.settings.tz;
          const when =
            parsed.allDay || parsed.start === null
              ? { kind: "allday" as const, startDay: parsed.day, endDay: parsed.day }
              : {
                  kind: "timed" as const,
                  start: fromLocal(parsed.day, parsed.start, tz),
                  end: fromLocal(
                    parsed.day,
                    parsed.end ?? parsed.start + s.settings.defaultDuration,
                    tz,
                  ),
                  tz,
                };
          const id = s.addEvent({
            title: parsed.title,
            when,
            ...(parsed.calendarId ? { calendarId: parsed.calendarId } : {}),
          });
          s.set({ newEventId: null });
          s.goTo(parsed.day);
          s.select(id, true);
        },
      }
    : null;
  const needle = q.trim().toLowerCase();
  const gotoItem: Command | null = parsed?.hasDate
    ? {
        id: "goto",
        label: `${t("cmd.gotoDate")} ${dayLabel(parsed.day)}`,
        run: () => useApp.getState().goTo(parsed.day),
      }
    : null;
  const eventItems: Command[] = useMemo(() => {
    if (needle.length < 2) return [];
    const st = useApp.getState();
    const visible = new Set(st.data.calendars.filter((c) => c.visible).map((c) => c.id));
    const now = Date.now();
    const startOf = (e: (typeof st.data.events)[number]) =>
      e.when.kind === "timed" ? e.when.start : e.when.startDay * 86_400_000;
    return st.data.events
      .filter((e) => visible.has(e.calendarId) && e.title.toLowerCase().includes(needle))
      .sort((a, b) => Math.abs(startOf(a) - now) - Math.abs(startOf(b) - now))
      .slice(0, 8)
      .map((e) => {
        const first =
          e.when.kind === "timed" ? toLocal(e.when.start, e.when.tz).day : e.when.startDay;
        // For a series, jump to its next occurrence from today (or its first one).
        const today = st.today();
        const day = e.recurrence ? (occurrenceDays(e, today, today + 400)[0] ?? first) : first;
        const target = e.recurrence ? occurrenceId(e.id, day) : e.id;
        return {
          id: `ev-${e.id}`,
          label: `${e.title} · ${dayLabel(day)}`,
          run: () => {
            const s2 = useApp.getState();
            s2.goTo(day);
            s2.select(target, true);
          },
        };
      });
  }, [needle]);
  const items = [
    ...(createItem ? [createItem] : []),
    ...(gotoItem ? [gotoItem] : []),
    ...eventItems,
    ...commands,
  ];
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    setTimeout(c.run, 0);
  };
  const calName = parsed?.calendarId
    ? app.data.calendars.find((c) => c.id === parsed.calendarId)?.name
    : null;

  return (
    <div className="scrim top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={t("palette.placeholder")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(items[sel]);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        />
        {parsed && createItem && (
          <div className="palette-preview">
            {[
              parsed.allDay || parsed.start === null
                ? t("event.allDay")
                : `${formatMinute(parsed.start, app.settings.h24)}–${formatMinute(parsed.end ?? parsed.start, app.settings.h24)}`,
              dayLabel(parsed.day),
              calName ? t("palette.createdIn", { calendar: calName }) : null,
            ]
              .filter(Boolean)
              .map((x) => (
                <span key={x} className="chip">
                  {x}
                </span>
              ))}
          </div>
        )}
        <div className="palette-list">
          {items.length === 0 && <div className="muted pad">{t("palette.noResults")}</div>}
          {items.map((c, i) => (
            <button
              type="button"
              key={c.id}
              className={`palette-item ${i === sel ? "on" : ""}`}
              onMouseMove={() => setSel(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              {c.hint && <kbd>{c.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function dayLabel(day: number): string {
  const d = new Date(day * 86_400_000);
  return new Intl.DateTimeFormat(locale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

export function HelpModal() {
  const close = () => useApp.getState().set({ helpOpen: false });
  const rows: [string, string][] = [
    ["T", t("shortcuts.today")],
    ["D  W  M", t("shortcuts.views")],
    ["2 – 9", t("shortcuts.ndays")],
    ["← →  J  K", t("shortcuts.nav")],
    ["N", t("shortcuts.new")],
    ["Ctrl K  /", t("shortcuts.palette")],
    ["Ctrl Z · Ctrl Shift Z", t("shortcuts.undo")],
    ["Supr", t("shortcuts.delete")],
    ["[", t("shortcuts.sidebar")],
    ["Ctrl ,", t("shortcuts.settings")],
    ["Ctrl A", t("shortcuts.selectAll")],
    ["Esc", t("shortcuts.close")],
  ];
  return (
    <Modal title={t("shortcuts.title")} onClose={close}>
      <div className="shortcuts">
        {rows.map(([k, v]) => (
          <div key={k} className="shortcut">
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <ul className="muted tips">
        <li>{t("shortcuts.wheel")}</li>
        <li>{t("shortcuts.ctrlWheel")}</li>
        <li>{t("shortcuts.shiftWheel")}</li>
        <li>{t("shortcuts.drag")}</li>
        <li>{t("shortcuts.multi")}</li>
      </ul>
    </Modal>
  );
}
