/**
 * Everything the engine does outside itself, injected (docs/automatizaciones.md §5.2, §6): the policy, the
 * collections, the clock and date arithmetic. The core is pure: it imports no store, no server and no model, so a
 * test runs it with fakes and the server gives it the real ones.
 *
 * The one way to the collections is the `Gate` (AU-168): `guard` builds it from the policy and the collections, the
 * engine is its only caller, and a step's executor receives the gate and never the collections. Every read and every
 * write asks `Policy.decide` first, in a test too, so there is no path that skips the policy to forget.
 */
import type { FieldType, Label, Labeled } from "@boni/entities";
import type { FilterItem } from "@boni/views";
import { notBuilt } from "./pending.ts";
import type { Cell, Row, RowOrigin } from "./rows.ts";

// ---------------------------------------------------------------- the policy

/** What the policy answers: the four kinds of `decide` (packages/agent/src/policy.ts), with the rule that decided. */
export type Decision =
  | { kind: "allow"; rule: string }
  | { kind: "deny"; rule: string; reason: string }
  | { kind: "confirm"; rule: string }
  | { kind: "propose"; rule: string };

/** One read or one write of a step, as the policy judges it. The effect and `destroys` come from the catalogue (AU-19). */
export interface PolicyCall {
  automation: { id: string; version: number };
  /** The step's id, its type and its action. */
  step: string;
  type: string;
  action: string;
  effect: "read" | "write";
  destroys: boolean;
  /** The collection's key. */
  collection: string;
  /**
   * What goes in, each value with its label (AU-162): for a write, the fields by key; for a read, the values of its
   * conditions by their place («where.0»). A derived value can never be a destination (P14).
   */
  values: Record<string, Labeled<Cell>>;
  /** The label of the path of the row this is done for (AU-164, P15); null when nothing decided it. */
  control: Label | null;
  /** How many saved rows it touches, when known before doing it. */
  rows?: number;
  /** A test of the automation or of one step: judged the same, and nothing is written. */
  test: boolean;
}

/**
 * The server's adapter over `decide` of `packages/agent` (this package cannot depend on it: the agent will write
 * automations, F16). It closes over the run's origin and counters; the core only asks.
 */
export interface Policy {
  decide(call: PolicyCall): Decision;
}

// ---------------------------------------------------------------- the collections

export interface FieldShape {
  key: string;
  type: FieldType;
  /** For a relation: the key of the collection it points to. */
  target?: string;
}
/** A collection as validation and the steps need it: its fields by key. Names are the app's business. */
export interface CollectionShape {
  key: string;
  fields: readonly FieldShape[];
}

/** A row as the collections give it: its fields by key, its labels and the saved row it is (AU-04). */
export type StoredRow = Pick<Row, "json" | "label" | "fields"> & { origin: RowOrigin };

export interface FindQuery {
  collection: string;
  /** Conditions with their values already resolved: the views' filter. */
  where: readonly FilterItem[];
  sort: readonly { field: string; direction: "asc" | "desc" }[];
  limit: number;
  /** «Incluir relacionadas»: each relation holds the related row's fields, one level. */
  related: boolean;
}
export interface AggregateQuery {
  collection: string;
  where: readonly FilterItem[];
  measure: "count" | "sum" | "average" | "min" | "max";
  field?: string;
  groupBy?: string;
}
/** One aggregate: the value of `groupBy` (absent with no grouping), the result and the label of what it read. */
export interface AggregateResult {
  group?: Cell;
  value: number | null;
  label: Label;
}

/** A write. There is no deletion: a row goes to the trash and comes back from it (AU-122). */
export type Change =
  | { kind: "create"; collection: string; fields: Record<string, Cell> }
  | { kind: "update"; row: RowOrigin; fields: Record<string, Cell> }
  | { kind: "trash"; row: RowOrigin };

/**
 * The collections, unguarded: what the server implements over the user's store (with the operation log, D-02), and
 * what a test fakes. Only `guard` may hold one. Rows come in a fixed order for the same data (the sort asked for,
 * then the row's id), so a run is the same twice.
 */
export interface Collections {
  shape(collection: string): CollectionShape | undefined;
  find(query: FindQuery): Promise<StoredRow[]>;
  get(collection: string, id: string): Promise<StoredRow | undefined>;
  aggregate(query: AggregateQuery): Promise<AggregateResult[]>;
  /**
   * Does it and gives the row as saved (for `trash`, as it was). Throws when the row changed since `row.version`.
   * All or nothing: when it throws, nothing was written, so trying again (AU-16) never writes twice.
   */
  apply(change: Change): Promise<StoredRow>;
}

// ---------------------------------------------------------------- the gate

/** The policy said no: the step fails with this, and «Si falla» decides what follows (AU-16). */
export class Denied extends Error {
  readonly rule: string;
  constructor(rule: string, reason: string) {
    super(reason);
    this.name = "Denied";
    this.rule = rule;
  }
}

/** A write the policy did not let through as it was: it asks Juan first. Kept in `Execution.asked`. */
export interface Asked {
  step: string;
  /** `confirm`: it destroys (P5). `propose`: it carries something from outside (P4). */
  kind: "confirm" | "propose";
  rule: string;
  change: Change;
}

export type WriteResult =
  /** Written: the row as saved. */
  | { kind: "applied"; row: StoredRow }
  /** A test: nothing written; the row as it would be (its origin, the one it has, or absent for a new row). */
  | { kind: "tested"; row: Omit<StoredRow, "origin"> & { origin?: RowOrigin } }
  /** Not written: it waits for Juan with the rest of what the run asks (decision 4 of §10). No row comes out. */
  | { kind: "asked"; asked: Asked };

/** What a value to read or write carries to the gate: the resolved value with its label. */
export type Labelled = Record<string, Labeled<Cell>>;

/**
 * The collections as a step's executor sees them, for one step and one row: every method asks the policy first and
 * throws `Denied` on a no. A read that the policy would only propose or confirm is denied too: a read cannot wait.
 */
export interface Gate {
  shape(collection: string): CollectionShape | undefined;
  /** `values`: the resolved values of the conditions, by their place, with their labels. */
  find(query: FindQuery, values: Labelled): Promise<StoredRow[]>;
  get(collection: string, id: Labeled<Cell>): Promise<StoredRow | undefined>;
  aggregate(query: AggregateQuery, values: Labelled): Promise<AggregateResult[]>;
  /** `values`: the fields written with their labels (empty for `trash`). */
  write(change: Change, values: Labelled): Promise<WriteResult>;
}

/** Which step and row a gate works for: what every `PolicyCall` of it carries. */
export interface GateUnit {
  automation: { id: string; version: number };
  step: string;
  type: string;
  action: string;
  effect: "read" | "write";
  destroys: boolean;
  control: Label | null;
  test: boolean;
}

/**
 * The gate of one step for one row. On a write: `allow` applies it (in a test, nothing is applied and the row it
 * would make comes back); `propose` and `confirm` apply nothing and give it back as `asked`; `deny` throws.
 * The engine calls this and nobody else does.
 */
export function guard(_policy: Policy, _collections: Collections, _unit: GateUnit): Gate {
  return notBuilt("guard");
}

// ---------------------------------------------------------------- time

/** The clock. `sleep` is here so that «Reintentar» waits (AU-16) without the core touching a timer. */
export interface Clock {
  /** Epoch ms. */
  now(): number;
  /** Juan's IANA time zone. */
  zone: string;
  sleep(ms: number): Promise<void>;
}

export type DateUnit = "minutes" | "hours" | "days" | "weeks" | "months" | "years";

/**
 * Date arithmetic for «Fecha», done outside: wall-clock math lives in `packages/calendar/src/time.ts` and the core
 * may not import it (A-02), so the server passes it in. A date is a civil day ("YYYY-MM-DD") or an instant (epoch
 * ms); a civil day stays a civil day. Each throws on a value that is neither.
 */
export interface Dates {
  /** The civil day ("YYYY-MM-DD") an instant falls on in `zone`: «hoy» for a condition (AU-11). */
  day(instant: number, zone: string): string;
  add(date: Cell, amount: number, unit: DateUnit, zone: string): Cell;
  /** Whole units from `date` until `until`, negative when `until` is before. */
  diff(date: Cell, until: Cell, unit: DateUnit, zone: string): number;
  startOf(date: Cell, unit: "day" | "week" | "month" | "year", zone: string): Cell;
  part(
    date: Cell,
    part: "year" | "month" | "day" | "weekday" | "week" | "hour" | "minute",
    zone: string,
  ): number;
  /** `format`: one of the keys the catalogue lists for «Dar formato»; `locale`, the language Juan reads in. */
  format(date: Cell, format: string, zone: string, locale: string): string;
}
