import { Eye, EyeOff, Lock, ShieldHalf, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AI_LEVELS, type AiLevel, type DataType } from "../core/agent.ts";
import { changeProtection, useStore } from "../store.ts";
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
      {unlocking && <UnlockDialog type={type} onClose={() => setUnlocking(false)} />}
    </>
  );
}

/** Lowering a private collection: the new level and its name typed, as a deliberate act. */
function UnlockDialog({ type, onClose }: { type: DataType; onClose: () => void }) {
  const t = useStore((s) => s.t);
  const [to, setTo] = useState<AiLevel>("restricted");
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === type.name.trim();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
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
        aria-label={t("protect.unlockTitle", { name: type.name })}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          void changeProtection(type.id, to, true).then((done) => done && onClose());
        }}
      >
        <div className="find-head">
          <h2>{t("protect.unlockTitle", { name: type.name })}</h2>
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
        <p className="find-help">{t("protect.unlockHelp")}</p>
        <label className="unlock-field">
          <span>{t("protect.unlockTo")}</span>
          <select className="input" value={to} onChange={(e) => setTo(e.target.value as AiLevel)}>
            {AI_LEVELS.filter((l) => l !== "private").map((l) => (
              <option key={l} value={l}>
                {t(`ai.level.${l}`)}
              </option>
            ))}
          </select>
        </label>
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
