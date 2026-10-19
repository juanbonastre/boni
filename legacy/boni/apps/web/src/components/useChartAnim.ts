import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChartData, ChartSeries } from "../core/contract.ts";

const ENTRY_MS = 750;
const GLIDE_MS = 450;
/** Material's "fast out, slow in" (cubic-bezier(0.4, 0, 0.2, 1)), close enough for a reveal. */
const ease = (t: number) => 1 - (1 - t) ** 3;

/** Whether charts animate (off for screenshots and when the system asks for reduced motion). */
export const animationsOn = () =>
  !(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) && !new URLSearchParams(typeof location === "undefined" ? "" : location.search).has("still");

/**
 * Animation of one chart (all its series flattened). `entry` (0..1) drives the first reveal (bars grow, lines are
 * drawn, labels appear at the end); later value changes glide from what was on screen to the new values, so a
 * refresh that brings the same numbers draws nothing new.
 */
export function useChartAnim(data: ChartData): { series: ChartSeries[]; entry: number } {
  const keys = data.series
    .flatMap((s) => s.points.map((p) => `${s.key ?? s.name}|${p.key}`))
    .join("\n");
  const values = data.series.flatMap((s) => s.points.map((p) => p.value));
  const valuesKey = values.join(",");
  const identity = `${data.chart_id}|${data.drill ?? ""}|${data.kind}|${keys}`;
  const animate = animationsOn();

  const st = useRef<{
    identity: string;
    from: number[];
    to: number[];
    t: number;
    entered: boolean;
  } | null>(null);
  const [, setFrame] = useState(0);

  useLayoutEffect(() => {
    const prev = st.current;
    if (!animate) {
      st.current = { identity, from: values, to: values, t: 1, entered: true };
      return;
    }
    if (prev && prev.identity === identity && prev.entered) {
      if (prev.to.join(",") === valuesKey) return;
      const shown = prev.from.map((f, i) => f + ((prev.to[i] ?? f) - f) * prev.t);
      st.current = { identity, from: shown, to: values, t: 0, entered: true };
    } else {
      st.current = { identity, from: values, to: values, t: 0, entered: false };
    }
  }, [identity, valuesKey, animate]);

  useEffect(() => {
    const s = st.current;
    if (!s || s.t >= 1) return;
    const duration = s.entered ? GLIDE_MS : ENTRY_MS;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const cur = st.current;
      if (!cur) return;
      cur.t = Math.min(1, (now - start) / duration);
      if (cur.t >= 1) {
        cur.entered = true;
        cur.from = cur.to;
      }
      setFrame((f) => f + 1);
      if (cur.t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [identity, valuesKey, animate]);

  const s = st.current;
  if (!s || s.identity !== identity) return { series: data.series, entry: animate ? 0 : 1 };
  const k = ease(s.t);
  if (!s.entered) return { series: data.series, entry: k };
  let i = 0;
  const series = data.series.map((ser) => ({
    ...ser,
    points: ser.points.map((p) => {
      const from = s.from[i] ?? p.value;
      const to = s.to[i] ?? p.value;
      i++;
      return { ...p, value: from + (to - from) * k };
    }),
  }));
  return { series, entry: 1 };
}
