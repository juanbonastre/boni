import type { DatabaseFilter } from "@boni/views";
import { Eye, EyeOff, Lock, Plus, ShieldHalf, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AI_LEVELS, type AiLevel, type DataType } from "../core/agent.ts";
import { changeProtection, saveRule, toast, useStore } from "../store.ts";
import { FilterEditor, filterText, opsFor } from "./DatabaseBlock.tsx";
import { MenuRow, MenuSep, PopButton } from "./Popover.tsx";

/**
 * What the models may see of a collection (Juan, 2026-10-22): Visible, Opaca, Restringida, Privada. It is changed
 * from the collection itself, wherever it shows; a private one is locked, and only its own page (Colecciones →
 * the collection) offers to unlock it, after he types its name, so it is never lowered by a slip.
 */

export const LEVEL_ICONS: Record<AiLevel, ReactNode> = {
  visible: <Eye size={13} strokeWidth={2} />,
  opaque: <EyeOff size={13} strokeWidth={2} />,
  restricted: <ShieldHalf size={13} strokeWidth={2} />,
  private: <Lock size={13} strokeWidth={2} />,
};

export function ProtectionMenu({
  type,
  canUnlock = false,
}: {
  type: DataType;
  canUnlock?: boolean;
}) {
  const t = useStore((s) => s.t);
  const [unlocking, setUnlocking] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const locked = type.level === "private";
  const name = t(`ai.level.${type.level}`);
  return (
    <>
      <PopButton
        className={`protect-pill level-${type.level}`}
        title={t("protect.title", { level: name })}
        align="start"
        width={300}
        label={
          <>
            {LEVEL_ICONS[type.level]}
            <span>{name}</span>
            {type.rules.length > 0 && <span className="protect-rules">+{type.rules.length}</span>}
          </>
        }
      >
        {(close) => (
          <div className="protect-menu" role="menu">
            {AI_LEVELS.map((l) => (
              <div key={l} className={`protect-option${locked && l !== "private" ? " off" : ""}`}>
                <MenuRow
                  label={t(`ai.level.${l}`)}
                  icon={LEVEL_ICONS[l]}
                  on={type.level === l}
                  onClick={() => {
                    close();
                    if (l === type.level) return;
                    if (locked) {
                      if (canUnlock) setUnlocking(true);
                      return;
                    }
                    void changeProtection(type.id, l);
                  }}
                />
                <p className="protect-help">{t(`ai.level.${l}.help`)}</p>
              </div>
            ))}
            <MenuSep />
            <MenuRow
              label={
                type.rules.length ? t("rules.open", { n: type.rules.length }) : t("rules.openNone")
              }
              onClick={() => {
                close();
                setEditingRules(true);
              }}
            />
            {locked && (
              <>
                <MenuSep />
                {canUnlock ? (
                  <MenuRow
                    label={t("protect.unlock")}
                    danger
                    onClick={() => {
                      close();
                      setUnlocking(true);
                    }}
                  />
                ) : (
                  <p className="protect-help protect-note">{t("protect.lockedHere")}</p>
                )}
              </>
            )}
          </div>
        )}
      </PopButton>
      {unlocking && (
        <UnlockDialog
          type={type}
          title={t("protect.unlockTitle", { name: type.name })}
          onConfirm={(to) => changeProtection(type.id, to, true)}
          onClose={() => setUnlocking(false)}
        />
      )}
      {editingRules && (
        <RulesDialog type={type} canUnlock={canUnlock} onClose={() => setEditingRules(false)} />
      )}
    </>
  );
}

/**
 * Lowering something private (the collection, or a rule of it): the new level and the collection's name typed,
 * as a deliberate act. Without `levels` it only confirms (removing a private rule).
 */
function UnlockDialog({
  type,
  title,
  levels = AI_LEVELS.filter((l) => l !== "private"),
  onConfirm,
  onClose,
}: {
  type: DataType;
  title: string;
  levels?: AiLevel[] | null;
  onConfirm: (to: AiLevel) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const [to, setTo] = useState<AiLevel>(levels?.includes("restricted") ? "restricted" : "private");
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === type.name.trim();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // First, and only this: Esc must not also leave the page under the dialog.
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  return (
    <div
      className="find-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="find-box unlock-box"
        role="dialog"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          void onConfirm(to).then((done) => done && onClose());
        }}
      >
        <div className="find-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title={t("protect.cancel")}
            aria-label={t("protect.cancel")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <p className="find-help">{t(levels ? "protect.unlockHelp" : "protect.unlockRemoveHelp")}</p>
        {levels && (
          <label className="unlock-field">
            <span>{t("protect.unlockTo")}</span>
            <select className="input" value={to} onChange={(e) => setTo(e.target.value as AiLevel)}>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {t(`ai.level.${l}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="unlock-field">
          <span>{t("protect.unlockName", { name: type.name })}</span>
          <input
            className="input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <div className="unlock-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("protect.cancel")}
          </button>
          <button type="submit" className="btn danger" disabled={!ok}>
            {t("protect.unlockConfirm")}
          </button>
        </div>
      </form>
    </div>
  );
}

type Draft = { id?: string; filter: DatabaseFilter[]; level: AiLevel };

/**
 * Parts of a collection with their own level (Juan, 2026-10-22): each rule is Notion's filter and a level; the
 * rows that match it are seen by the AI at that level instead of the collection's (if several match, the most
 * closed). Whatever would lower something private is offered only on the collection's own page, and asks for
 * its name.
 */
function RulesDialog({
  type,
  canUnlock,
  onClose,
}: {
  type: DataType;
  canUnlock: boolean;
  onClose: () => void;
}) {
  const t = useStore((s) => s.t);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [unlock, setUnlock] = useState<
    { kind: "save"; rule: Draft } | { kind: "remove"; id: string } | null
  >(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || unlock) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [unlock]);
  const wasPrivate = (id?: string) => type.rules.find((r) => r.id === id)?.level === "private";
  /** Lowers something private: a private rule made less closed, or part of a private collection opened. */
  const lowers = (d: Draft) =>
    d.level !== "private" && (wasPrivate(d.id) || type.level === "private");
  const save = async (d: Draft) => {
    if (lowers(d)) {
      if (canUnlock) setUnlock({ kind: "save", rule: d });
      else toast(t("protect.locked"));
      return;
    }
    if (await saveRule(type.id, d)) setDraft(null);
  };
  const remove = async (id: string) => {
    if (wasPrivate(id)) {
      if (canUnlock) setUnlock({ kind: "remove", id });
      else toast(t("protect.locked"));
      return;
    }
    await saveRule(type.id, { id, remove: true });
  };
  return (
    <div
      className="find-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="find-box rules-box"
        role="dialog"
        aria-label={t("rules.title", { name: type.name })}
      >
        <div className="find-head">
          <h2>{t("rules.title", { name: type.name })}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title={t("settings.close")}
            aria-label={t("settings.close")}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <p className="find-help">{t("rules.help", { level: t(`ai.level.${type.level}`) })}</p>
        <ul className="rules-list">
          {type.rules.length === 0 && !draft && <li className="muted small">{t("rules.none")}</li>}
          {type.rules.map((r) =>
            draft?.id === r.id ? null : (
              <li key={r.id} className="rule-row">
                <span className="rule-when">
                  {r.filter.map((f) => filterText(type, f, t)).join(t("rules.and"))}
                </span>
                <span className={`protect-pill static level-${r.level}`}>
                  {LEVEL_ICONS[r.level]}
                  <span>{t(`ai.level.${r.level}`)}</span>
                </span>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setDraft({ id: r.id, filter: r.filter, level: r.level })}
                >
                  {t("rules.edit")}
                </button>
                <button
                  type="button"
                  className="icon-btn tiny"
                  title={t("rules.remove")}
                  aria-label={t("rules.remove")}
                  onClick={() => void remove(r.id)}
                >
                  <Trash2 size={13} strokeWidth={1.8} />
                </button>
              </li>
            ),
          )}
        </ul>
        {draft ? (
          <div className="rule-editor">
            <p className="rule-label">{t("rules.when")}</p>
            <div className="db-filters">
              <FilterEditor
                type={type}
                rules={draft.filter}
                onChange={(filter) => setDraft({ ...draft, filter })}
              />
            </div>
            <label className="unlock-field rule-level">
              <span>{t("rules.level")}</span>
              <select
                className="input"
                value={draft.level}
                onChange={(e) => setDraft({ ...draft, level: e.target.value as AiLevel })}
              >
                {AI_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`ai.level.${l}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="unlock-actions">
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                {t("protect.cancel")}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!draft.filter.length}
                onClick={() => void save(draft)}
              >
                {t("rules.save")}
              </button>
            </div>
          </div>
        ) : (
          <div className="unlock-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                const f = type.fields.find((x) => x.id !== type.titleField) ?? type.fields[0];
                setDraft({
                  filter: f ? [{ field: f.id, op: opsFor(f)[0] ?? "is" }] : [],
                  level: type.level === "visible" ? "restricted" : "visible",
                });
              }}
            >
              <Plus size={14} strokeWidth={1.8} />
              {t("rules.add")}
            </button>
          </div>
        )}
      </div>
      {unlock && (
        <UnlockDialog
          type={type}
          title={t("protect.unlockTitle", { name: type.name })}
          levels={unlock.kind === "remove" ? null : [unlock.rule.level]}
          onConfirm={async () => {
            const ok =
              unlock.kind === "remove"
                ? await saveRule(type.id, { id: unlock.id, remove: true }, true)
                : await saveRule(type.id, unlock.rule, true);
            if (ok) setDraft(null);
            return ok;
          }}
          onClose={() => setUnlock(null)}
        />
      )}
    </div>
  );
}
