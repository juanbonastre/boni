import { type BlockProblem, type ControlBlock, heldValue, kindOf, refOf } from "@boni/views";
import { useEffect, useRef, useState } from "react";
import { ApiError, OfflineError } from "../core/api.ts";
import type { BlockResult, DataBlock } from "../core/blocks.ts";
import { PALETTE } from "../core/palette.ts";
import { catText, type T } from "../i18n.ts";
import { agentApi, openBlockPanel, openRowsPanel, useStore } from "../store.ts";
import { ChartCardContent } from "./ChartCard.tsx";
import { BarList, Kpi } from "./Dash.tsx";

/**
 * A page's data blocks (the block catalogue's number, bar list and chart), computed by the server from the user's
 * collections. They are asked for together, again when one changes and whenever the app refreshes (a capture
 * saved, the window back in front). A block whose settings are not valid says so; it never shows another chart.
 * A click on a bar or a chart's point lists the rows it counts (`openRowsPanel`; a click on the block, all of them).
 */

type Failure = "offline" | "personal" | null;

/**
 * The page's data blocks' results, by block id, computed with what the page's controls hold (D-59). `pending` while
 * a change is being asked (I-15: the blocks say they are waiting, in their place).
 */
export function useBlockResults(
  blocks: readonly DataBlock[],
  controls: readonly ControlBlock[] = [],
): {
  results: Record<string, BlockResult>;
  failure: Failure;
  pending: boolean;
} {
  const tick = useStore((s) => s.refreshTick);
  const [results, setResults] = useState<Record<string, BlockResult>>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [pending, setPending] = useState(false);
  // Only what changes the numbers asks again (not a width, a colour or a control's name).
  const key = JSON.stringify([
    blocks.map(({ at: _a, bg: _b, color: _c, shape: _s, ...rest }) => rest),
    controls.map(({ name: _n, ...rest }) => ({ ...rest, at: undefined })),
  ]);
  const asked = useRef(0);
  useEffect(() => {
    if (!blocks.length) return;
    const n = ++asked.current;
    setPending(true);
    const timer = setTimeout(() => {
      agentApi
        .blocks(
          blocks.map(({ at: _a, ...b }) => b),
          controls,
        )
        .then((r) => {
          if (n !== asked.current) return;
          setResults(r);
          setFailure(null);
          setPending(false);
        })
        .catch((e) => {
          if (n !== asked.current) return;
          setPending(false);
          setFailure(
            e instanceof OfflineError
              ? "offline"
              : e instanceof ApiError && e.status === 403
                ? "personal"
                : "offline",
          );
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [key, tick]);
  useEffect(() => {
    const again = () => useStore.setState((s) => ({ refreshTick: s.refreshTick + 1 }));
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
  return { results, failure, pending };
}

const HEIGHTS = { s: 240, m: 340, l: 440 } as const;

export function problemText(t: T, block: DataBlock, p: BlockProblem): string {
  const s = kindOf(block.type)?.settings.find((x) => x.key === p.key);
  const label = s ? catText(t, s.label) : p.key;
  return t(`block.problem.${p.code}`, { label });
}

/** One data block: its number, its bars or its chart, or what is wrong with it. */
export function DataBlockView({
  block,
  result,
  failure,
  controls = [],
}: {
  block: DataBlock;
  result: BlockResult | undefined;
  failure: Failure;
  /** The page's controls, for what its period says when it names one. */
  controls?: readonly ControlBlock[];
}) {
  const t = useStore((s) => s.t);
  const lang = useStore((s) => s.settings.language);
  const collection = useStore((s) => s.dataTypes?.find((d) => d.id === block.collection)?.name);
  // A block without a name of its own shows what it counts.
  const title = block.title || collection || catText(t, kindOf(block.type)?.name ?? "");
  const nf = new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", { maximumFractionDigits: 2 });
  const fmt = (n: number, unit: string | undefined) =>
    unit === "EUR"
      ? new Intl.NumberFormat(lang === "en" ? "en-GB" : "es-ES", {
          style: "currency",
          currency: "EUR",
        }).format(n)
      : nf.format(n);
  if (result && "problems" in result)
    return (
      <div className="data-blk-bad" role="note">
        <span className="data-blk-name">
          {block.title || catText(t, kindOf(block.type)?.name ?? "")}
        </span>
        <span className="small">
          {t("block.problem.title")}:{" "}
          {result.problems.map((p) => problemText(t, block, p)).join(" ")}
        </span>
        <button type="button" className="btn small" onClick={() => openBlockPanel(block.id)}>
          {t("block.problem.fix")}
        </button>
      </div>
    );
  const data = result?.data ?? null;
  const note = failure ? t(`block.problem.${failure}`) : null;
  // "All time" starts where the engine's time starts (2000): said in words, not as that range. So does a month
  // control holding nothing.
  const monthRef = refOf(block.period);
  const all =
    block.period === "all" ||
    (monthRef !== null && heldValue(controls.find((c) => c.id === monthRef)) === undefined);
  const sub = all ? catText(t, "Desde siempre") : (data?.subtitle ?? undefined);
  if (block.type === "number")
    return (
      <Kpi
        label={title}
        value={data?.total != null ? fmt(data.total, data.unit) : "—"}
        note={note ?? sub}
      />
    );
  if (block.type === "bars") {
    const points = data?.series[0]?.points ?? [];
    return (
      <div className="data-blk-bars" data-boni-action="entities.aggregate">
        <h2 className="dash-h2">{title}</h2>
        {note && <p className="muted small">{note}</p>}
        <BarList
          rows={points.map((p) => ({ key: p.key, label: p.label, values: [p.value] }))}
          series={[{ name: title, color: "var(--accent)" }]}
          format={(n) => fmt(n, data?.unit)}
          onSelect={(key) => openRowsPanel(block.id, key, points.find((p) => p.key === key)?.label)}
          empty={data ? t("chart.empty") : t("chart.loading")}
        />
      </div>
    );
  }
  const color = PALETTE.find((c) => c.name === block.color)?.hex ?? null;
  return (
    <div
      className="data-blk-chart"
      data-boni-action="entities.aggregate"
      style={{ height: HEIGHTS[block.at?.h ?? "m"] }}
    >
      <ChartCardContent
        title={title}
        color={color}
        // Values written on the bars only when there are few; no average line (nothing that does not help).
        style={{ labels: (data?.series[0]?.points.length ?? 0) <= 12, reference: "none" }}
        onDrill={(key) =>
          openRowsPanel(block.id, key, data?.series[0]?.points.find((p) => p.key === key)?.label)
        }
        state={{
          data: data ? { ...data, kind: block.shape ?? "bar", subtitle: sub ?? null } : null,
          loading: !data && !failure,
          offline: failure === "offline",
          error: failure === "personal" ? t("block.problem.personal") : null,
        }}
      />
    </div>
  );
}
