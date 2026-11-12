import { type ControlBlock, passedValues } from "@boni/views";
import { ChevronRight } from "lucide-react";
import type { T } from "../i18n.ts";
import { openPageWith, useStore } from "../store.ts";

/** Boni's link block opens only one of the account's pages; its destination comes from the catalogue's real ids. */

/** A link block's name when it has none of its own: the destination page's current title. */
export function boniTitle(t: T, b: { to?: string }): string {
  const page = useStore.getState().pages?.find((p) => p.id === b.to);
  return page?.title || t("block.pageGone");
}

/**
 * A row that opens another page, or says that its destination was removed. With `pass` it carries values to that
 * page's controls (D-59): its own, or what a control of this page holds now.
 */
export function LinkBlock({
  block,
  controls = [],
}: {
  block: { title?: string; to: string; pass?: Record<string, string | number> };
  controls?: readonly ControlBlock[];
}) {
  const t = useStore((s) => s.t);
  const page = useStore((s) => s.pages?.find((p) => p.id === block.to));
  return (
    <button
      type="button"
      className="models-row models-link"
      disabled={!page}
      onClick={() => void openPageWith(block.to, passedValues(block.pass, controls))}
    >
      <span className="models-row-main">
        <span className="models-name">{block.title || page?.title || t("block.pageGone")}</span>
        {!page && <span className="muted small">{t("block.pageGone")}</span>}
      </span>
      <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
