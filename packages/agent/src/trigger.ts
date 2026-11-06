import { randomBytes } from "node:crypto";
import type { Origin } from "./policy.ts";

/**
 * What a flow's trigger gives its plan by name (docs/flujos.md §4.3), as far as running it outside its trigger needs:
 * the names a form asks for (`manual`) and `today` (a schedule). A flow a record starts (`created`: a new mail) cannot
 * be run from a turn: it needs that record.
 */

/** The names a manual trigger's form gives the plan (each the user's text). */
export function manualInputs(trigger: unknown): string[] {
  const t = trigger as { manual?: unknown; inputs?: unknown } | null;
  if (!t?.manual || !Array.isArray(t.inputs)) return [];
  return t.inputs
    .map((i) => (i && typeof i === "object" ? (i as { name?: unknown }).name : null))
    .filter((n): n is string => typeof n === "string" && /^[a-z][a-z0-9_]{0,30}$/.test(n));
}

/** The names a run by hand or by `flows.run` binds for this trigger; null: only a record of its own starts it. */
export function runnableNames(trigger: unknown): string[] | null {
  const t = trigger as { manual?: unknown; schedule?: unknown } | null;
  if (t?.manual === true) return manualInputs(trigger);
  if (t?.schedule && typeof t.schedule === "object") return ["today"];
  return null;
}

/**
 * Whether a trigger is one Boni knows, and well formed: a new mail, by hand with a form, on a schedule, or new mail in
 * the mailbox (`connector: "mail"`, Boni's «Traer correo», docs/sistema.md §4.2: the connector looks every few
 * minutes, and only a look that finds mail starts a run). Neither a record nor the connector's starts it by hand.
 */
export function triggerOk(trigger: unknown): boolean {
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) return false;
  const t = trigger as Record<string, unknown>;
  if (typeof t.created === "string") return t.created === "correo";
  if (t.connector !== undefined) return t.connector === "mail" && Object.keys(t).length === 1;
  // Boni's «Revisar la guía»: Juan's decisions ask for a review (D-51).
  if (t.learning !== undefined) return t.learning === "mail" && Object.keys(t).length === 1;
  if (t.manual === true) {
    if (t.inputs === undefined) return true;
    return (
      Array.isArray(t.inputs) &&
      t.inputs.length <= 6 &&
      manualInputs(t).length === t.inputs.length &&
      new Set(manualInputs(t)).size === t.inputs.length
    );
  }
  if (t.schedule && typeof t.schedule === "object") {
    const s = t.schedule as Record<string, unknown>;
    if (s.every !== "day" && s.every !== "week" && s.every !== "hour") return false;
    if (s.at !== undefined && !(typeof s.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)))
      return false;
    if (
      s.day !== undefined &&
      !(Number.isInteger(s.day) && (s.day as number) >= 0 && (s.day as number) <= 6)
    )
      return false;
    return true;
  }
  return false;
}

/** The origin a flow runs with (the policy's): work of its own with no turn, or a turn of the user's by hand. */
export function originOf(trigger: unknown, device?: string): Origin {
  const t = trigger as { manual?: unknown } | null;
  return t?.manual
    ? { kind: "turn", trust: "personal", ...(device ? { device } : {}) }
    : { kind: "background", trust: "personal" };
}

/** A new flow's id: its name in ASCII words and a few random letters («resumen-diario-3fa9c1»). */
export function newFlowId(name: string): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "flujo";
  return `${base}-${randomBytes(3).toString("hex")}`;
}
