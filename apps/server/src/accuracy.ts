// How right Boni's decisions are, per area and per level of confidence: what the Registro shows (docs/fiabilidad.md §3.3).
import { type Level, levelsOf } from "@boni/agent";
import type { UserStore } from "@boni/store";

/** An area's last decisions, counted: how many Boni took alone, asked or left, and what Juan made of the ones alone. */
export interface AreaAccuracy {
  area: string;
  total: number;
  done: number;
  asked: number;
  nothing: number;
  /** Taken alone and judged by Juan since, and right among them. */
  judged: number;
  right: number;
  levels: Level[];
}

/** The last 200 decisions of each area (docs/fiabilidad.md §3.3: an area's acierto, and what moves its thresholds). */
export function accuracy(store: UserStore): AreaAccuracy[] {
  return store.journal.decisionAreas().map((area) => {
    const rows = store.journal.decisions(area, 200);
    const alone = rows.filter((r) => r.outcome === "do");
    const judged = alone.filter((r) => r.result);
    return {
      area,
      total: rows.length,
      done: alone.length,
      asked: rows.filter((r) => r.outcome === "ask").length,
      nothing: rows.filter((r) => r.outcome === "nothing").length,
      judged: judged.length,
      right: judged.filter((r) => r.result === "right").length,
      levels: levelsOf(rows),
    };
  });
}
