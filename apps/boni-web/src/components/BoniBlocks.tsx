import { ChevronRight } from "lucide-react";
import type { T } from "../i18n.ts";
import { openPage, useStore } from "../store.ts";

/** Boni's link block opens only one of the account's pages; its destination comes from the catalogue's real ids. */

/** A link block's name when it has none of its own: the destination page's current title. */
export function boniTitle(t: T, b: { to?: string }): string {
  const page = useStore.getState().pages?.find((p) => p.id === b.to);
  return page?.title || t("block.pageGone");
}

/** A row that opens another page, or says that its destination was removed. */
export function LinkBlock({ block }: { block: { title?: string; to: string } }) {
  const t = useStore((s) => s.t);
  const page = useStore((s) => s.pages?.find((p) => p.id === block.to));
  return (
    <button
      type="button"
      className="models-row models-link"
      disabled={!page}
      onClick={() => void openPage(block.to)}
    >
      <span className="models-row-main">
        <span className="models-name">{block.title || page?.title || t("block.pageGone")}</span>
        {!page && <span className="muted small">{t("block.pageGone")}</span>}
      </span>
      <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
