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
import { StepFault } from "./failures.ts";
import type { Cell, FieldLabel, Row, RowOrigin } from "./rows.ts";

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
  /**
   * A write of a step's change (`decideAll`): the row it touches, as saved (modify, remove) or as it would be
   * (create), and the rows the step had asked with that action in that collection in this run before this one. What
   * the server puts in P29's `reach` for an AI step (AU-205), with the connection it reads from the stored version.
   */
  row?: Readonly<Record<string, Cell>>;
  written?: number;
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
  /**
   * For an option (`select`, `multiselect`): the options it has, when the collections say them. An «Agente» writes
   * only one of these (AU-52); the server's collections give them (S1), and a field without them is not checked.
   */
  options?: readonly string[];
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
   * Does it and gives the row as saved (for `trash`, as it was). Throws `StepFault` with `row.changed` when the row
   * changed since `row.version`.
   * All or nothing: when it throws, nothing was written, so trying again (AU-16) never writes twice. `values`: the
   * fields written with their labels, as the gate judged them, so each is kept with its own (P17).
   */
  apply(change: Change, values: Labelled): Promise<StoredRow>;
  /**
   * Every change, in order, in one transaction (AU-174): each as `apply` does it, and the rows as saved in the same
   * order. All or nothing: when one throws (`row.changed` among them), none was written.
   */
  applyAll(changes: readonly ChangeWith[]): Promise<StoredRow[]>;
}

/** A change with the labels of the values it writes, as `apply` takes them. */
export interface ChangeWith {
  change: Change;
  values: Labelled;
  /** The row as saved or as it would be, and the step's count before it (`PolicyCall.row`, `written`). */
  row?: Readonly<Record<string, Cell>>;
  written?: number;
}

// ---------------------------------------------------------------- the gate

/** The policy said no: the step fails with this, and «Si falla» decides what follows (AU-16). */
export class Denied extends Error {
  readonly rule: string;
  /** A read the policy would only confirm or propose: it cannot wait for Juan (`policy.waits`). */
  readonly waits: boolean;
  constructor(rule: string, reason: string, waits = false) {
    super(reason);
    this.name = "Denied";
    this.rule = rule;
    this.waits = waits;
  }
}

/** A write the policy did not let through as it was: it asks Juan first. Kept in `Execution.asked`. */
export interface Asked {
  step: string;
  /** `confirm`: it destroys (P5). `propose`: it creates or modifies and its cell or the policy asks (P28, P4). */
  kind: "confirm" | "propose";
  rule: string;
  change: Change;
  /**
   * The values it writes, each with its label, as the engine gives a change it saves (AU-170): what is asked from
   * outside is asked as from outside, and accepting it writes it so.
   */
  values: Labelled;
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
  /**
   * A step's changes judged together (AU-174): the policy is asked for each before anything is written, as the
   * «Colección» action that makes that change would be (`create`, `update`, `trash`). `allow` only when it allows
   * every one; else the ones it would ask Juan about, in order. Throws `Denied` when it refuses any.
   */
  decideAll(changes: readonly ChangeWith[]): Promise<"allow" | Asked[]>;
  /**
   * Writes changes `decideAll` allowed, all or nothing, in one transaction of the store; it asks the policy nothing
   * more. In a test nothing is written and each comes back `tested`, with the row as it would be.
   */
  writeAll(changes: readonly ChangeWith[]): Promise<WriteResult[]>;
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
  /** The label of what the automation itself wrote: of a new row in a test whose fields are none. */
  own: Label;
}

/**
 * The gate of one step for one row. On a write: `allow` applies it (in a test, nothing is applied and the row it
 * would make comes back); `propose` and `confirm` apply nothing and give it back as `asked`; `deny` throws.
 * The engine calls this and nobody else does.
 */
export function guard(policy: Policy, collections: Collections, unit: GateUnit): Gate {
  const ask = (
    effect: "read" | "write",
    collection: string,
    values: Labelled,
    rows?: number,
    as?: {
      action: string;
      destroys: boolean;
      row?: Readonly<Record<string, Cell>>;
      written?: number;
    },
  ): Decision =>
    policy.decide({
      automation: unit.automation,
      step: unit.step,
      type: unit.type,
      action: as?.action ?? unit.action,
      effect,
      // A read destroys nothing, even the search of «Eliminar filas»: what destroys is its write.
      destroys: as?.destroys ?? (effect === "write" && unit.destroys),
      collection,
      values,
      control: unit.control,
      ...(rows === undefined ? {} : { rows }),
      test: unit.test,
      ...(as?.row === undefined ? {} : { row: as.row }),
      ...(as?.written === undefined ? {} : { written: as.written }),
    });
  /** A read goes on only with `allow`: it cannot wait for Juan, so `confirm` and `propose` are a no as well. */
  const read = (collection: string, values: Labelled, rows?: number): void => {
    const d = ask("read", collection, values, rows);
    if (d.kind === "deny") throw new Denied(d.rule, d.reason);
    if (d.kind !== "allow")
      throw new Denied(d.rule, `a read cannot wait for Juan (${d.kind})`, true);
  };
  return {
    // The fields of a collection are no data of Juan's: validation reads them too, with no policy.
    shape: (collection) => collections.shape(collection),
    async find(query, values) {
      read(query.collection, values);
      return collections.find(query);
    },
    async get(collection, id) {
      read(collection, { id }, 1);
      return typeof id.value === "string" ? collections.get(collection, id.value) : undefined;
    },
    async aggregate(query, values) {
      read(query.collection, values);
      return collections.aggregate(query);
    },
    async write(change, values) {
      const collection = change.kind === "create" ? change.collection : change.row.collection;
      const d = ask("write", collection, values, change.kind === "create" ? undefined : 1);
      if (d.kind === "deny") throw new Denied(d.rule, d.reason);
      if (d.kind !== "allow")
        return {
          kind: "asked",
          asked: { step: unit.step, kind: d.kind, rule: d.rule, change, values },
        };
      if (!unit.test) {
        const saved = await collections.apply(change, values);
        // A change carries values, not their labels: each field written comes out with its value's label, the rest
        // with the stored row's (what a read of it would give).
        return {
          kind: "applied",
          row: change.kind === "trash" ? saved : over(saved, change.fields, values),
        };
      }
      return { kind: "tested", row: await wouldBe(collections, change, values, unit.own) };
    },
    async decideAll(changes) {
      const asked: Asked[] = [];
      for (const { change, values, row, written } of changes) {
        const d = ask("write", collectionOfChange(change), values, rowsOf(change), {
          action: change.kind,
          destroys: change.kind === "trash",
          ...(row === undefined ? {} : { row }),
          ...(written === undefined ? {} : { written }),
        });
        if (d.kind === "deny") throw new Denied(d.rule, d.reason);
        if (d.kind !== "allow")
          asked.push({ step: unit.step, kind: d.kind, rule: d.rule, change, values });
      }
      return asked.length ? asked : "allow";
    },
    async writeAll(changes) {
      if (unit.test) {
        const out: WriteResult[] = [];
        for (const { change, values } of changes)
          out.push({ kind: "tested", row: await wouldBe(collections, change, values, unit.own) });
        return out;
      }
      const saved = changes.length ? await collections.applyAll(changes) : [];
      return saved.map((row, i) => {
        const { change, values } = changes[i] as ChangeWith;
        return {
          kind: "applied",
          row: change.kind === "trash" ? row : over(row, change.fields, values),
        };
      });
    },
  };
}

/** The collection a change writes in. */
export const collectionOfChange = (change: Change): string =>
  change.kind === "create" ? change.collection : change.row.collection;

/** How many saved rows a change touches, as `PolicyCall.rows` says it: none known for a new one. */
const rowsOf = (change: Change): number | undefined => (change.kind === "create" ? undefined : 1);

/**
 * What a write allowed in a test would leave, with nothing written: a new row (Juan's, as the store makes it) with
 * the fields given, each with the label of its value; a modified row as it is saved with those fields over it; a row
 * to the trash as it is. The labels are the ones a real run gives. Reading the saved row here is part of the write
 * the policy just allowed, not a read of its own.
 */
async function wouldBe(
  collections: Collections,
  change: Change,
  values: Labelled,
  own: Label,
): Promise<Omit<StoredRow, "origin"> & { origin?: RowOrigin }> {
  if (change.kind === "create") return over({ json: {}, label: own }, change.fields, values);
  const saved = await collections.get(change.row.collection, change.row.id);
  if (!saved || saved.origin.version !== change.row.version)
    throw new StepFault(`the row ${change.row.id} changed since it was read`, {
      code: "row.changed",
    });
  return change.kind === "trash" ? saved : over(saved, change.fields, values);
}

/** A row with some fields written over it: each one keeps its value's label where it is not the row's. */
function over<R extends Pick<Row, "json" | "label" | "fields">>(
  row: R,
  fields: Record<string, Cell>,
  values: Labelled,
): R {
  const json = { ...row.json, ...fields };
  const labels: Record<string, FieldLabel> = { ...(row.fields ?? {}) };
  for (const key of Object.keys(fields)) {
    const v = values[key];
    if (v && (v.label !== row.label || v.derived))
      labels[key] = { label: v.label, derived: v.derived };
    else delete labels[key];
  }
  const { fields: _, ...rest } = row;
  return { ...rest, json, ...(Object.keys(labels).length ? { fields: labels } : {}) } as R;
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
