/**
 * «Versiones», P3b of F14d (docs/automatizaciones.md AU-98, decision 12): «⋯ → Versiones» of the editor's header. On
 * the left each published version, the newest first, with its number, when, whose («Tú», «De Boni») and which one
 * runs; on the right the one chosen on its canvas, looked at and never changed, as a run is in «Ejecuciones»
 * (pantalla 8). «Comparar con» puts another beside it, the older on the left, with what `diffAutomations` says marked
 * on the cards (added, removed, changed) and in lines above. «Volver a esta» hands its document to «Publicar» (AU-96):
 * publishing there makes a new version with it and leaves the draft as it was. The words are i18n.ts's; every name is
 * painted as plain text (A-01).
 */
import { type Automation, isSame } from "@boni/automations";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { automationsClient, type VersionInfo } from "../automations/client.ts";
import { diffLines } from "../automations/publishing.ts";
import { fullWhen, whenWords } from "../automations/runWords.ts";
import type { EditorState } from "../automations/state.ts";
import {
  compared,
  type DiffMark,
  newestFirst,
  versionEditor,
  whoseKey,
} from "../automations/versions.ts";
import { DO, localeOf } from "../automations/words.ts";
import { deviceZone } from "../core/clock.ts";
import { agentApi, useStore } from "../store.ts";
import { AutomationCanvas, DiffContext } from "./AutomationCanvas.tsx";
import { touchError } from "./AutomationRuns.tsx";
import {
  LookContext,
  PhoneContext,
  type Tester,
  TesterContext,
  useNow,
} from "./AutomationTest.tsx";

const client = automationsClient(agentApi);

/** A version's canvas has no test and no run: nothing to ask for its rows. */
const NOTHING: Tester = {
  run: () => {},
  rows: () => () => Promise.resolve({ rows: [], total: 0 }),
  sample: () => Promise.resolve(null),
  preview: () => Promise.resolve(null),
};

/**
 * `onRestore`: «Volver a esta» with the version's document; null where it is only looked at (no other version than
 * the one that runs is offered either way). `onBack`: to the editor.
 */
export function VersionsPane({
  id,
  places,
  onBack,
  onRestore,
}: {
  id: string;
  places: EditorState["places"];
  onBack: () => void;
  onRestore: ((n: number, doc: Automation) => void) | null;
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language) === "en" ? "en" : "es";
  const locale = localeOf(lang);
  const now = useNow();
  const zone = useMemo(deviceZone, []);
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [running, setRunning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [against, setAgainst] = useState<number | null>(null);
  /** Each version's document once read: asked only when it is shown. */
  const [docs, setDocs] = useState<Record<number, Automation>>({});

  useEffect(() => {
    let gone = false;
    client.versions(id).then(
      (v) => {
        if (gone) return;
        const ordered = newestFirst(v.versions);
        setList(ordered);
        setRunning(v.running);
        setChosen((c) => c ?? v.running ?? ordered[0]?.n ?? null);
      },
      (e) => !gone && setError(touchError(t, e)),
    );
    return () => {
      gone = true;
    };
  }, [id, t]);

  const asked = useRef(new Set<number>());
  const read = useCallback(
    (n: number | null) => {
      if (n === null || asked.current.has(n)) return;
      asked.current.add(n);
      client.version(id, n).then(
        (v) => setDocs((d) => ({ ...d, [n]: v.automation })),
        (e) => {
          asked.current.delete(n);
          setError(touchError(t, e));
        },
      );
    },
    [id, t],
  );
  useEffect(() => read(chosen), [chosen, read]);
  useEffect(() => read(against), [against, read]);

  const info = list?.find((v) => v.n === chosen) ?? null;
  const one = chosen !== null ? docs[chosen] : undefined;
  const other = against !== null ? docs[against] : undefined;
  const pair =
    one && other && chosen !== null && against !== null
      ? compared({ n: chosen, doc: one }, { n: against, doc: other })
      : null;
  const nameOf = (step: string) =>
    pair?.newer.doc.steps.find((s) => s.id === step)?.name ??
    pair?.older.doc.steps.find((s) => s.id === step)?.name ??
    step;
  const lines = pair ? diffLines(t, pair.diff, nameOf, locale) : [];

  const side = (
    <aside className="auto-runs-list auto-vers-list" aria-label={t("auto.ver.list")}>
      <button type="button" className="btn small auto-runs-back" onClick={onBack}>
        <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />
        <span>{t(DO.backToEditor)}</span>
      </button>
      {error ? (
        <p className="form-error">{error}</p>
      ) : list === null ? (
        <div className="page-loading" role="status" aria-busy="true" />
      ) : list.length === 0 ? (
        <p className="muted auto-runs-none">{t("auto.ver.none")}</p>
      ) : (
        <ul className="auto-runs-items">
          {list.map((v) => (
            <li key={v.n}>
              <button
                type="button"
                className={`auto-runs-item auto-vers-item${v.n === chosen ? " on" : ""}`}
                aria-current={v.n === chosen ? "true" : undefined}
                onClick={() => {
                  setChosen(v.n);
                  if (against === v.n) setAgainst(null);
                }}
              >
                <span className="auto-runs-when">
                  <strong>{t("auto.ver.n", { n: v.n })}</strong>
                  {` · ${whenWords(t, lang, zone, v.at, now)}`}
                </span>
                <span className="auto-runs-who">
                  {t(whoseKey(v))}
                  {/* «Convertida» (AU-225): it came from a version of the flow of before. */}
                  {typeof v.flow === "number" && (
                    <span className="auto-vers-converted">{t("auto.ver.converted")}</span>
                  )}
                  {v.n === running && (
                    <span className="auto-vers-running">{t("auto.ver.running")}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );

  return (
    <div className="auto-runs auto-vers">
      {side}
      {info && chosen !== null ? (
        <section
          className="auto-run-detail auto-vers-detail"
          aria-label={t("auto.ver.n", { n: chosen })}
        >
          <div className="auto-run-bar">
            <div className="auto-run-what">
              <strong className="auto-run-when">{t("auto.ver.n", { n: chosen })}</strong>
              <span className="auto-run-line">
                {`${fullWhen(lang, zone, info.at)} · ${t(whoseKey(info))}`}
                {typeof info.flow === "number" ? ` · ${t("auto.ver.converted")}` : ""}
                {chosen === running ? ` · ${t("auto.ver.running")}` : ""}
              </span>
            </div>
            <div className="auto-run-do">
              {list && list.length > 1 && (
                <label className="auto-vers-against">
                  <span>{t("auto.ver.compareWith")}</span>
                  <select
                    value={against ?? ""}
                    onChange={(e) => setAgainst(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">{t("auto.ver.compareNone")}</option>
                    {list
                      .filter((v) => v.n !== chosen)
                      .map((v) => (
                        <option key={v.n} value={v.n}>
                          {t("auto.ver.n", { n: v.n })}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {onRestore && chosen !== running && one && (
                <button
                  type="button"
                  className="btn small"
                  data-boni-action="automations.publish"
                  onClick={() => onRestore(chosen, one)}
                >
                  {t(DO.restoreVersion)}
                </button>
              )}
            </div>
          </div>
          {against !== null && pair && (
            <section
              className="auto-vers-changes"
              aria-label={t("auto.ver.changes", { from: pair.older.n, to: pair.newer.n })}
            >
              <h3>{t("auto.ver.changes", { from: pair.older.n, to: pair.newer.n })}</h3>
              {isSame(pair.diff) || !lines.length ? (
                <p className="muted">{t("auto.ver.same")}</p>
              ) : (
                <ul>
                  {lines.map((l, i) => (
                    <li key={`${i}-${l.text}`}>{l.text}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {against !== null ? (
            pair ? (
              <div className="auto-vers-compare">
                <VersionCanvas
                  id={id}
                  n={pair.older.n}
                  doc={pair.older.doc}
                  places={places}
                  marks={pair.older.marks}
                />
                <VersionCanvas
                  id={id}
                  n={pair.newer.n}
                  doc={pair.newer.doc}
                  places={places}
                  marks={pair.newer.marks}
                />
              </div>
            ) : (
              <div className="page-loading" role="status" aria-busy="true" />
            )
          ) : one ? (
            <VersionCanvas id={id} n={chosen} doc={one} places={places} marks={null} />
          ) : (
            <div className="page-loading" role="status" aria-busy="true" />
          )}
        </section>
      ) : (
        list !== null && !error && <p className="muted auto-runs-choose">{t("auto.ver.none")}</p>
      )}
    </div>
  );
}

/** One version on its canvas, looked at: its cards can be chosen and opened, never changed nor tested. */
function VersionCanvas({
  id,
  n,
  doc,
  places,
  marks,
}: {
  id: string;
  n: number;
  doc: Automation;
  places: EditorState["places"];
  marks: Record<string, DiffMark> | null;
}) {
  const t = useStore((s) => s.t);
  const [look, setLook] = useState(() => versionEditor(id, doc, places));
  useEffect(() => setLook(versionEditor(id, doc, places)), [id, doc, places]);
  const apply = useCallback((f: (s: EditorState) => EditorState) => setLook((s) => f(s)), []);
  return (
    <section
      className="auto-canvas auto-run-canvas auto-vers-canvas"
      aria-label={t("auto.ver.n", { n })}
      data-version={n}
    >
      <PhoneContext.Provider value={false}>
        <LookContext.Provider value={true}>
          <TesterContext.Provider value={NOTHING}>
            <DiffContext.Provider value={marks}>
              <AutomationCanvas state={look} apply={apply} />
            </DiffContext.Provider>
          </TesterContext.Provider>
        </LookContext.Provider>
      </PhoneContext.Provider>
    </section>
  );
}
