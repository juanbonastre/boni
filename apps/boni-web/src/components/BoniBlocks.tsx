import { ChevronRight } from "lucide-react";
import type { T } from "../i18n.ts";
import { openSettings, showAudit, showLog, useStore } from "../store.ts";

/**
 * Boni's own blocks (the block catalogue's «De Boni» group; packages/views catalogue.ts): a link to another of its
 * screens. What Boni counts (its models' spending, what they read and changed) is no longer a block of its own: it
 * is read-only collections any number or chart counts (design audit, Juan 2026-10-25).
 */

type To = "activity" | "audit" | "settings-models";

const LINKS: Record<To, { title: string; hint: string }> = {
  activity: { title: "models.activity", hint: "models.toLog" },
  audit: { title: "boni.toAudit", hint: "boni.seeAudit" },
  "settings-models": { title: "boni.toModels", hint: "boni.seeModels" },
};

/** A link block's name when it has none of its own: Boni's name for where it goes. */
export function boniTitle(t: T, b: { to?: string }): string {
  return t(LINKS[(b.to as To) ?? "activity"]?.title ?? "models.activity");
}

/** A row that opens another of Boni's screens. */
export function LinkBlock({ block }: { block: { title?: string; to: To } }) {
  const t = useStore((s) => s.t);
  const go = () =>
    block.to === "audit"
      ? showAudit({})
      : block.to === "settings-models"
        ? openSettings(true, "models")
        : showLog();
  return (
    <button type="button" className="models-row models-link" onClick={go}>
      <span className="models-row-main">
        <span className="models-name">{block.title || boniTitle(t, block)}</span>
        <span className="muted small">{t(LINKS[block.to].hint)}</span>
      </span>
      <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
