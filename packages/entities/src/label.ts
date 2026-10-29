/**
 * Provenance labels (docs/nucleo.md, 4.2). Code puts them on every value, never a model, and they are
 * inherited: whatever is made from a value carries at most its integrity and at least its sensitivity.
 * The policy engine decides from them; nothing here trusts what a value says about itself.
 */

/** Who the value comes from, best first (see `INTEGRITY_ORDER`). */
export type Integrity =
  | "user" // typed or chosen by Juan on a personal device
  | "own" // computed by Boni's code from values of at least `imported`
  | "imported" // imported from the vault (a trusted folder)
  | "ambient" // ambient voice, a shared device
  | "model" // written by a model whose inputs were at least `imported`
  | "external"; // from outside (mail, web, .ics, someone else's text) or made from it

/** Lowest first: `join` keeps the lowest. */
export const INTEGRITY_ORDER: readonly Integrity[] = [
  "external",
  "model",
  "ambient",
  "imported",
  "own",
  "user",
];

export type Sensitivity = "public" | "personal" | "sensitive";

/** Lowest first: `join` keeps the highest. */
export const SENSITIVITY_ORDER: readonly Sensitivity[] = ["public", "personal", "sensitive"];

export interface SourceRef {
  kind:
    | "turn"
    | "user-edit"
    | "vault"
    /** A file of the account (a bank statement among its attachments). */
    | "file"
    | "mail"
    | "web"
    | "ical"
    | "model"
    | "code"
    | "export"
    | "guide";
  id: string;
}

export interface Label {
  integrity: Integrity;
  sensitivity: Sensitivity;
  /** Describes other people (senders, people in the agenda): never part of a report that leaves. */
  thirdParty: boolean;
  sources: readonly SourceRef[];
  /**
   * Not for any model, the planner or a reader (Juan chose so for its collection: "solo sabe que existe").
   * Code may still compute with it and paint it for Juan. Set when it is read, never stored; inherited.
   */
  noModel?: true;
}

export const integrityRank = (i: Integrity) => INTEGRITY_ORDER.indexOf(i);
export const sensitivityRank = (s: Sensitivity) => SENSITIVITY_ORDER.indexOf(s);

/** Whether `label` is at least as trusted as `min`. */
export const atLeast = (label: Label, min: Integrity) =>
  integrityRank(label.integrity) >= integrityRank(min);

export function label(
  integrity: Integrity,
  sensitivity: Sensitivity,
  sources: readonly SourceRef[],
  thirdParty = false,
): Label {
  return { integrity, sensitivity, thirdParty, sources };
}

const sourceKey = (s: SourceRef) => `${s.kind}:${s.id}`;

/**
 * The label of something made from all of `labels`: the lowest integrity, the highest sensitivity,
 * third party if any is, and every source once (sorted, so the result does not depend on the order).
 */
export function join(first: Label, ...rest: Label[]): Label {
  let integrity = first.integrity;
  let sensitivity = first.sensitivity;
  let thirdParty = first.thirdParty;
  let noModel = !!first.noModel;
  const sources = new Map(first.sources.map((s) => [sourceKey(s), s]));
  for (const l of rest) {
    if (integrityRank(l.integrity) < integrityRank(integrity)) integrity = l.integrity;
    if (sensitivityRank(l.sensitivity) > sensitivityRank(sensitivity)) sensitivity = l.sensitivity;
    thirdParty ||= l.thirdParty;
    noModel ||= !!l.noModel;
    for (const s of l.sources) sources.set(sourceKey(s), s);
  }
  const sorted = [...sources.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    integrity,
    sensitivity,
    thirdParty,
    sources: sorted.map(([, s]) => s),
    ...(noModel ? { noModel: true as const } : {}),
  };
}

/** The same label, at least this sensitive (it never goes down here: lowering is Juan's, in settings). */
export function raiseSensitivity(l: Label, to: Sensitivity): Label {
  return sensitivityRank(to) > sensitivityRank(l.sensitivity) ? { ...l, sensitivity: to } : l;
}

/**
 * The planner never sees external or ambient text, nor what Juan keeps from the models; it gets an opaque
 * handle instead (nucleo.md, 7.3).
 */
export const plannerMaySee = (l: Label) =>
  !l.noModel && l.integrity !== "external" && l.integrity !== "ambient";
/** Whether any model may read it (a reader too): what Juan keeps from the models never reaches one. */
export const modelMaySee = (l: Label) => !l.noModel;

// ---------------------------------------------------------------- labeled values

/**
 * A value with its label. `derived` marks values a plan function made (`concat`, `pick`, a format…):
 * they can never be a destination, so a destination cannot be assembled from pieces (attack A1).
 */
export interface Labeled<T> {
  value: T;
  label: Label;
  derived: boolean;
}

export const labeled = <T>(value: T, l: Label): Labeled<T> => ({ value, label: l, derived: false });

/** A value computed from `inputs`: their joined label, and derived. */
export function derive<T>(
  value: T,
  first: Labeled<unknown>,
  ...rest: Labeled<unknown>[]
): Labeled<T> {
  return { value, label: join(first.label, ...rest.map((r) => r.label)), derived: true };
}

/**
 * Whether a value may be a destination (an address, a URL, a path, a recipient): taken as it is (not
 * derived) and at least `imported`, so never from a model, an ambient voice or outside (P2, P14).
 */
export const canBeDestination = (v: Labeled<unknown>) => !v.derived && atLeast(v.label, "imported");
