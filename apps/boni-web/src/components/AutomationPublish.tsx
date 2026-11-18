/**
 * «Publicar» on the screen, P1 of F14d (docs/automatizaciones.md §5.8, pantalla 10): the screen that says what changes
 * against the version that runs, what stops it or is worth a look (each with a link to its step) and «Lo que podrá
 * hacer» (AU-96, AU-182); «Ajustes» with the run's limits (AU-17); and the box «Ejecutar» opens when the version asks
 * for fields, has several triggers or the draft has unpublished changes (AU-97). The editor (AutomationEditor.tsx)
 * asks the server and keeps what it answers; the words come from automations/publishing.ts. Every name of a step or a
 * collection is painted as plain text (A-01).
 */
import {
  AUTOMATION_LIMITS,
  type Automation,
  type Cell,
  isTrigger,
  type RunLimit,
} from "@boni/automations";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublishView } from "../automations/client.ts";
import {
  abilityLine,
  checkLines,
  diffLines,
  limitField,
  limitUnit,
  shownLimits,
  withLimit,
} from "../automations/publishing.ts";
import { change, type EditorState } from "../automations/state.ts";
import { amountOf, DO, localeOf } from "../automations/words.ts";
import { useStore } from "../store.ts";
import { useCollectionNames } from "./AutomationCanvas.tsx";
import { TrialFields, triggerFields } from "./AutomationTest.tsx";

/** A modal of the editor: Esc and a click outside close it. */
export function Modal({
  label,
  title,
  onClose,
  children,
  className = "",
}: {
  label: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const t = useStore((s) => s.t);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal auto-modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title={t("flows.cancel")}
            aria-label={t("flows.cancel")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Pantalla 10 (AU-96): «Será la versión N» (and, the first time, that it will be on: AU-194), «Qué cambia respecto
 * a la versión N», «Antes de publicar» and «Lo que podrá hacer»; «Cancelar» and «Publicar versión N», which cannot
 * be pressed with something that stops it or with nothing to publish.
 */
export function PublishScreen({
  view,
  draft,
  was,
  busy,
  onClose,
  onPublish,
  onStep,
}: {
  view: PublishView;
  draft: Automation;
  /** The document of the version that runs, for the names of the steps it had and the draft has not. */
  was: Automation | null;
  busy: boolean;
  onClose: () => void;
  onPublish: () => void;
  onStep: (step: string) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const locale = localeOf(lang);
  const collections = useCollectionNames();
  const next = (view.running ?? 0) + 1;
  const nameOf = (step: string) =>
    draft.steps.find((s) => s.id === step)?.name ??
    was?.steps.find((s) => s.id === step)?.name ??
    step;
  const has = (step: string) => draft.steps.some((s) => s.id === step);
  const changes = view.diff ? diffLines(t, view.diff, nameOf, locale) : [];
  const checks = checkLines(t, view, locale, (k) => collections[k]);
  const blocked = checks.some((c) => c.block);
  const can = view.abilities.map((a) =>
    abilityLine(t, a, (k) => collections[k] ?? k, draft, locale),
  );
  const stepLink = (step: string | undefined) =>
    step && has(step) ? (
      <button type="button" className="link-btn auto-pub-step" onClick={() => onStep(step)}>
        {nameOf(step)}
      </button>
    ) : null;
  return (
    <Modal
      label={t("auto.pub.title", { name: draft.name })}
      title={t("auto.pub.title", { name: draft.name })}
      onClose={onClose}
      className="auto-pub"
    >
      <div className="modal-body">
        <p className="auto-pub-will">
          {view.first ? t("auto.pub.willFirst") : t("auto.pub.will", { n: next })}
        </p>
        {view.running !== null && (
          <section
            className="auto-pub-part"
            aria-label={t("auto.pub.diffTitle", { n: view.running })}
          >
            <h3>{t("auto.pub.diffTitle", { n: view.running })}</h3>
            {view.same || !changes.length ? (
              <p className="muted">{t("auto.pub.same")}</p>
            ) : (
              <ul>
                {changes.map((l, i) => (
                  <li key={`${i}-${l.text}`}>
                    {l.step && has(l.step) ? (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => onStep(l.step as string)}
                      >
                        {l.text}
                      </button>
                    ) : (
                      l.text
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className="auto-pub-part" aria-label={t("auto.pub.checkTitle")}>
          <h3>{t("auto.pub.checkTitle")}</h3>
          {checks.length ? (
            <ul>
              {checks.map((c, i) => (
                <li key={`${i}-${c.text}`} className={c.block ? "bad" : "warn"}>
                  {stepLink(c.step)}
                  {c.step && has(c.step) ? " · " : ""}
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("auto.pub.checksOk")}</p>
          )}
        </section>
        <section className="auto-pub-part" aria-label={t("auto.pub.canTitle")}>
          <h3>{t("auto.pub.canTitle")}</h3>
          {can.length ? (
            <ul className="auto-pub-can">
              {can.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("auto.pub.cannot")}</p>
          )}
        </section>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("flows.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            data-boni-action="automations.publish"
            disabled={busy || blocked || view.same}
            onClick={onPublish}
          >
            {view.same ? t("auto.pub.same") : t(DO.publishVersion, { n: next })}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * «⋯ → Ajustes» (AU-17): the run's limits a step of this automation can reach, each with its default and its
 * maximum; a number over the maximum is refused in the field and the draft keeps what it had. A change is a change of
 * the draft (undone with Deshacer, saved like any other) and runs once it is published.
 */
export function SettingsScreen({
  state,
  apply,
}: {
  state: EditorState;
  apply: (f: (s: EditorState) => EditorState) => void;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const locale = localeOf(lang);
  const collections = useCollectionNames();
  const named = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const [key, name] of Object.entries(collections)) m.set(name, m.has(name) ? null : key);
    return (name: string) => m.get(name) ?? undefined;
  }, [collections]);
  const limits = shownLimits(state.draft, named);
  const focus = state.ajustes?.limit ?? null;
  const close = () => apply((s) => ({ ...s, ajustes: null }));
  return (
    <Modal label={t("auto.view.settings")} title={t("auto.view.settings")} onClose={close}>
      <div className="modal-body auto-limits">
        {limits.map((limit) => (
          <LimitField
            key={limit}
            limit={limit}
            focus={limit === focus}
            draft={state.draft}
            locale={locale}
            set={(draft) => apply((s) => change(s, { draft }))}
          />
        ))}
      </div>
    </Modal>
  );
}

function LimitField({
  limit,
  focus,
  draft,
  locale,
  set,
}: {
  limit: RunLimit;
  focus: boolean;
  draft: Automation;
  locale: string;
  set: (draft: Automation) => void;
}) {
  const t = useStore((s) => s.t);
  const [text, setText] = useState(() => String(limitField(draft, limit)));
  const [over, setOver] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus]);
  const { default: base, ceiling } = AUTOMATION_LIMITS[limit];
  const max = amountOf(limit, ceiling, locale);
  const id = `auto-limit-${limit}`;
  return (
    <div className="auto-limit">
      <label htmlFor={id}>{t(`auto.limitName.${limit}`)}</label>
      <span className="auto-limit-box">
        <input
          ref={box}
          id={id}
          className={`input${over ? " bad" : ""}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={ceiling / limitUnit(limit)}
          data-boni-action="automations.edit"
          aria-invalid={over}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const r = withLimit(draft, limit, e.target.value);
            setOver(r === "over");
            if (typeof r !== "string") set(r);
          }}
          onBlur={() => {
            // What the field could not take goes back to what the draft holds.
            setText(String(limitField(draft, limit)));
            setOver(false);
          }}
        />
        {limit === "ms" && <span className="muted">{t("auto.settings.seconds")}</span>}
      </span>
      <span className={`small ${over ? "form-error" : "muted"}`} role={over ? "alert" : undefined}>
        {over
          ? t("auto.settings.over", { max })
          : t("auto.settings.range", { default: amountOf(limit, base, locale), max })}
      </span>
    </div>
  );
}

/**
 * The box «Ejecutar» opens (AU-97): which trigger, when the version has several; the fields it asks, the same box as
 * «Probar» (AU-94); and, with unpublished changes, that it runs the version that is published. `doc`: that version.
 */
export function RunScreen({
  doc,
  version,
  changes,
  busy,
  onClose,
  onRun,
}: {
  doc: Automation;
  version: number;
  changes: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: (trigger: string, fields: Record<string, Cell>) => void;
}) {
  const t = useStore((s) => s.t);
  const triggers = doc.steps.filter(isTrigger);
  const [from, setFrom] = useState(triggers[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, Record<string, Cell>>>({});
  const fields = from ? triggerFields(doc, from) : [];
  const typed = values[from] ?? {};
  const filled = Object.fromEntries(fields.map((f) => [f.key, typed[f.key] ?? null]));
  return (
    <Modal label={t(DO.run)} title={`${t(DO.run)} · ${doc.name}`} onClose={onClose}>
      <div className="modal-body auto-run">
        {changes && <p className="auto-run-version">{t("auto.run.version", { n: version })}</p>}
        {triggers.length > 1 && (
          <div className="auto-run-from" role="radiogroup" aria-label={t("auto.test.from")}>
            {triggers.map((s) => (
              <label key={s.id} className="toggle-row">
                <input
                  type="radio"
                  name="auto-run-from"
                  checked={from === s.id}
                  onChange={() => setFrom(s.id)}
                />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        )}
        {fields.length > 0 && (
          <TrialFields
            t={t}
            fields={fields}
            values={filled}
            set={(key, value) =>
              setValues((v) => ({ ...v, [from]: { ...(v[from] ?? {}), [key]: value } }))
            }
          />
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("flows.cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            data-boni-action="automations.run"
            disabled={busy || !from}
            onClick={() => onRun(from, filled)}
          >
            {t(DO.run)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
