import { kindOf, type SystemChange, type SystemPage, systemChanges } from "@boni/views";
import { useEffect } from "react";
import type { T } from "../i18n.ts";
import { openSystemPage, restoreSystemPage, undoPage, useStore } from "../store.ts";
import { kindName } from "./BlockPanel.tsx";
import { BoniScope, boniTitle } from "./BoniBlocks.tsx";
import { Blocks, DocTail, usesBoni } from "./PageView.tsx";
import { PopButton } from "./Popover.tsx";

/**
 * One of Boni's screens as a page of blocks («Modelos»; packages/views systemPages.ts): edited in place like any
 * page, kept for the account. Beside its name, «De Boni» while it is Boni's, or «Modificada» with the list of what
 * changed and «Restaurar la de Boni» (with Undo).
 */
export function SystemPageView({ name }: { name: SystemPage }) {
  const t = useStore((s) => s.t);
  const doc = useStore((s) => (s.systemDoc?.system === name ? s.systemDoc : null));
  useEffect(() => {
    void openSystemPage(name);
  }, [name]);
  const title = t(`nav.${name}`);
  if (!doc)
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
  return (
    <div className="models-view">
      <BoniScope active={doc.spec.blocks.some(usesBoni)}>
        <div className="content page-doc system-page">
          <div
            className="doc"
            onKeyDownCapture={(e) => {
              if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
              const k = e.key.toLowerCase();
              if ((k === "z" || k === "y") && undoPage(k === "y" || e.shiftKey)) e.preventDefault();
            }}
          >
            <header className="system-head">
              <h1 className="system-title">{title}</h1>
              <SystemPill name={name} title={title} modified={doc.modified} />
            </header>
            <Blocks page={doc} />
            <DocTail page={doc} />
          </div>
        </div>
      </BoniScope>
    </div>
  );
}

/** A change in words: the block's kind and its name («Cifra «Gasto»»). */
function changeText(t: T, c: SystemChange): string {
  if (!c.block) return t("system.moved");
  const b = c.block as {
    type: string;
    title?: string;
    text?: string;
    source?: string;
    to?: string;
  };
  const kind = kindName(t, kindOf(b.type), b.type);
  const named = b.source || b.type === "models" || b.type === "link";
  const name = b.title || b.text || (named ? boniTitle(t, b) : "");
  const what = name && name !== kind ? `${kind} «${name}»` : kind;
  return c.sign === "⤢" ? t("system.resized", { what }) : what;
}

const SIGNS: Record<SystemChange["sign"], string> = {
  "+": "add",
  "−": "remove",
  "✎": "edit",
  "⤢": "size",
  "↕": "move",
};

function SystemPill({
  name,
  title,
  modified,
}: {
  name: SystemPage;
  title: string;
  modified: boolean;
}) {
  const t = useStore((s) => s.t);
  const spec = useStore((s) => s.systemDoc?.spec);
  if (!modified || !spec)
    return (
      <span className="system-pill" title={t("system.boniHint")}>
        {t("system.boni")}
      </span>
    );
  const list = systemChanges(name, spec);
  return (
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
              void restoreSystemPage(name, title);
            }}
          >
            {t("system.restore")}
          </button>
          <p className="muted small">{t("system.restoreHint")}</p>
        </div>
      )}
    </PopButton>
  );
}
