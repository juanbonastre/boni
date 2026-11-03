// How right Boni's decisions are, per area and per level of confidence, and each area's «Solo»: what the Registro and Settings show (docs/fiabilidad.md §3.3, §3.4).
import { AUTONOMY, type CostClass, earned, type Level, levelsOf } from "@boni/agent";
import type { UserStore } from "@boni/store";
import {
  AUTO_AREA,
  AUTO_COST,
  type AutoState,
  autoStates,
  judgeAlone,
  measure,
  setAutoState,
} from "./autoAccept.ts";

/** An area's last decisions, counted: how many Boni took alone, asked or left, and what Juan made of the ones alone. */
export interface AreaAccuracy {
  area: string;
  /** What being wrong costs there (its newest decision's class). */
  cost: CostClass;
  total: number;
  done: number;
  asked: number;
  nothing: number;
  /**
   * Judged by Juan since, and right among them: what he kept of those taken alone, and what he answered to
   * those asked that are a question of their own (a suggestion of the reviewer, learning.ts).
   */
  judged: number;
  right: number;
  levels: Level[];
}

/** An area as Settings shows it: its accuracy, whether it has a «Solo» switch, where the switch is, and whether it is earned. */
export interface AreaView extends AreaAccuracy {
  /** An area decided inside a proposal Juan still decides has no switch (nor has class C). */
  switchable: boolean;
  auto: boolean;
  /** Who turned the switch last, and when: Juan in Settings, or Boni backing off. */
  autoBy: AutoState["by"] | null;
  autoAt: number | null;
  earned: boolean;
  /** What earns it: this many judged, this share right (the texts say the numbers from here, never by hand). */
  earnsWith: { decisions: number; accuracy: number };
}

/** The last 200 decisions of each area (docs/fiabilidad.md §3.3: an area's acierto, and what moves its thresholds). */
export function accuracy(store: UserStore): AreaAccuracy[] {
  return store.journal.decisionAreas().map((area) => {
    const rows = store.journal.decisions(area, 200);
    const alone = rows.filter((r) => r.outcome === "do");
    const judged = rows.filter((r) => r.result);
    return {
      area,
      cost: rows[rows.length - 1]?.cost ?? "C",
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

/** The areas with a «Solo» switch (docs/fiabilidad.md §3.4): the others decide inside a proposal Juan decides. */
const SWITCHABLE: ReadonlySet<string> = new Set([AUTO_AREA]);

/**
 * Every area for Settings and the Registro, judged up to `now`. «Aceptar solas» (`AUTO_AREA`) shows from the first
 * mail decided, before any decision of its own: the rule replayed over Juan's decisions (autoAccept.ts `measure`) is
 * what judges it and what earns its switch, so its `judged` and `right` are that replay's.
 */
export function areasView(store: UserStore, now: number): AreaView[] {
  judgeAlone(store, now);
  const states = autoStates(store);
  const areas = accuracy(store);
  const m = measure(store);
  const mail = areas.find((a) => a.area === AUTO_AREA) ?? {
    area: AUTO_AREA,
    cost: AUTO_COST,
    total: 0,
    done: 0,
    asked: 0,
    nothing: 0,
    judged: 0,
    right: 0,
    levels: levelsOf([]),
  };
  const all = [...areas.filter((a) => a.area !== AUTO_AREA)];
  // Its decisions are the mails decided (the rule saw each): taken alone, or left to Juan; judged by the replay.
  if (m.decided > 0 || mail.total > 0)
    all.push({
      ...mail,
      cost: AUTO_COST,
      total: Math.max(m.decided, mail.done),
      asked: Math.max(m.decided, mail.done) - mail.done,
      nothing: 0,
      judged: m.would,
      right: m.right,
    });
  return all.map((a) => {
    const s = states[a.area];
    return {
      ...a,
      switchable: SWITCHABLE.has(a.area) && a.cost !== "C",
      auto: s?.on === true,
      autoBy: s?.by ?? null,
      autoAt: s?.at ?? null,
      earned: SWITCHABLE.has(a.area) && earned(a.judged, a.right),
      earnsWith: { ...AUTONOMY },
    };
  });
}

/** Juan turns an area's «Solo» in Settings: on only once earned (docs/fiabilidad.md §3.4); off whenever he wants. */
export function setAuto(
  store: UserStore,
  area: string,
  on: boolean,
  now: number,
): "ok" | "not-switchable" | "not-earned" {
  const a = areasView(store, now).find((x) => x.area === area);
  if (!a?.switchable) return "not-switchable";
  if (on && !a.earned) return "not-earned";
  setAutoState(store, area, on, "juan", now);
  return "ok";
}
