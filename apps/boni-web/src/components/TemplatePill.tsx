import { kindOf, type PageTemplate, type TemplateChange, templateChanges } from "@boni/views";
import type { Page } from "../core/agent.ts";
import type { T } from "../i18n.ts";
import { restoreTemplate, useStore } from "../store.ts";
import { kindName } from "./BlockPanel.tsx";
import { boniTitle } from "./BoniBlocks.tsx";
import { PopButton } from "./Popover.tsx";

/**
 * Under the name of a page made from one of Boni's templates (packages/views templates.ts: «Uso de la IA»,
 * «Actividad»): «De Boni» while it is as Boni made it, or «Modificada» with the list of what changed and «Restaurar
 * la de Boni» (with Undo). The page itself is edited like any other.
 */

/** A change in words: the block's kind and its name («Cifra «Gasto»»). */
function changeText(t: T, c: TemplateChange): string {
  if (!c.block) return t("system.moved");
  const b = c.block as { type: string; title?: string; text?: string; to?: string };
  const kind = kindName(t, kindOf(b.type), b.type);
  const name = b.title || b.text || (b.type === "link" ? boniTitle(t, b) : "");
  const what = name && name !== kind ? `${kind} «${name}»` : kind;
  return c.sign === "⤢" ? t("system.resized", { what }) : what;
}

const SIGNS: Record<TemplateChange["sign"], string> = {
  "+": "add",
  "−": "remove",
  "✎": "edit",
  "⤢": "size",
  "↕": "move",
};

export function TemplatePill({ page, name }: { page: Page; name: PageTemplate }) {
  const t = useStore((s) => s.t);
  const pages = useStore((s) => s.pages);
  const list = templateChanges(name, page.spec, pages ?? []);
  if (!list.length)
    return (
      <div className="template-head">
        <span className="system-pill" title={t("system.boniHint")}>
          {t("system.boni")}
        </span>
      </div>
    );
  return (
    <div className="template-head">
      <PopButton
        className="system-pill changed"
        title={t("system.changesTitle")}
        align="start"
        width={360}
        label={
          <>
            <span className="system-dot" aria-hidden="true" />
            {t("system.modified")}
          </>
        }
      >
        {(close) => (
          <div className="system-changes">
            <p className="system-changes-head">{t("system.changesHead")}</p>
            <ul>
              {list.map((c, i) => (
                <li key={`${c.sign}-${c.block?.id ?? "moved"}-${i}`}>
                  <span className={`system-sign ${SIGNS[c.sign]}`} aria-hidden="true">
                    {c.sign}
                  </span>
                  <span className="system-change-text">
                    <span className="sr-only">{t(`system.sign.${SIGNS[c.sign]}`)}: </span>
                    {changeText(t, c)}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                close();
                restoreTemplate();
              }}
            >
              {t("system.restore")}
            </button>
            <p className="muted small">{t("system.restoreHint")}</p>
          </div>
        )}
      </PopButton>
    </div>
  );
}
