// The «Agente» step's side of the engine (docs/automatizaciones.md §5.6, AU-50 to AU-56, AU-58, AU-197, AU-198,
// AU-200, F15 E3): its parameters, the port's call for one unit of work, the schema of its connections the model
// receives, the tools its rounds call (reads narrowed by the step's connection, writes checked and gathered), and what
// «Lo que hizo» keeps.
//
// The rounds themselves are packages/agent's (`runRounds`), behind the port (`AiPort.agent`): nothing here imports a
// provider (A-02) or that package. The call's types mirror its own, field by field. Nothing a model writes chooses
// what is allowed (A-01): every read goes through the step's connection and the policy, and every write is checked
// against the connection as saved now and decided again, with the rest of the step's, when the step ends.
import { join, type Label, type Labeled, plannerMaySee } from "@boni/entities";
import { AiFault, RETRY_PARAM, type ReaderField } from "./ai.ts";
import type { CodeRead, Reader } from "./box.ts";
import { CodeFault } from "./code.ts";
import type { Connection } from "./connections.ts";
import { type CollectionShape, Denied } from "./effects.ts";
import type { Step } from "./format.ts";
import type { Cell } from "./rows.ts";
import type { WriteAction, WriteRequest } from "./writes.ts";

// ---------------------------------------------------------------- the step

/** Its parameters by key (catalogue.ts paints them): the six of AU-50, «Rondas máximas» behind «Añadir opción». */
export const AGENT_PARAMS = {
  instructions: "instructions",
  model: "model",
  reads: "reads",
  answer: "answer",
  fields: "fields",
  mode: "mode",
  maxRounds: "maxRounds",
  /** «Las hace este código»'s source (AU-51): a «Código»'s, that only reads. */
  code: "code",
  /** «Herramientas de código» (AU-58), behind «Añadir opción». */
  tools: "tools",
  /** «Reintentar si el modelo falla» (`AI_RETRY`, decision 28 of §10), behind «Añadir opción», as in the readers. */
  retries: RETRY_PARAM,
} as const;
/** «Lecturas» (AU-51): «Las decide la IA» or «Las hace este código». */
export const AGENT_READS = ["ai", "code"] as const;
/**
 * «Herramientas de código» (AU-58): at most 8, each a name the plan calls it by (a name of JavaScript, none of the
 * round's own tools), its inputs (a name and one of `types` each) and its code, which only reads.
 */
export const AGENT_TOOLS = {
  max: 8,
  inputs: 8,
  types: ["text", "number", "boolean", "date", "any"],
  name: /^[a-z][A-Za-z0-9_]{0,39}$/,
  taken: ["find", "get", "count", "sum", "create", "update", "trash", "answer"],
} as const;
/** One «Herramienta de código» as the step saves it. */
export interface AgentCodeTool {
  name: string;
  inputs: { name: string; type: (typeof AGENT_TOOLS.types)[number] }[];
  code: string;
}

/** An «Agente»'s own code: «Las hace este código» when it reads with it, and each code tool's (AU-51, AU-58). */
export function agentSources(step: Step): string[] {
  const code = step.params[AGENT_PARAMS.code];
  return [
    ...(step.params[AGENT_PARAMS.reads] === "code" && typeof code === "string" ? [code] : []),
    ...(codeToolsOf(step.params[AGENT_PARAMS.tools]) ?? []).map((t) => t.code),
  ];
}

/** The step's «Herramientas de código» as saved, or null when they are not what AU-58 says. */
export function codeToolsOf(v: unknown): AgentCodeTool[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > AGENT_TOOLS.max) return null;
  const names = new Set<string>();
  const out: AgentCodeTool[] = [];
  for (const t of v) {
    if (typeof t !== "object" || t === null || Array.isArray(t)) return null;
    const { name, inputs, code } = t as Record<string, unknown>;
    if (
      typeof name !== "string" ||
      !AGENT_TOOLS.name.test(name) ||
      (AGENT_TOOLS.taken as readonly string[]).includes(name) ||
      names.has(name) ||
      typeof code !== "string" ||
      !code.trim()
    )
      return null;
    names.add(name);
    const ins = inputs === undefined ? [] : inputs;
    if (!Array.isArray(ins) || ins.length > AGENT_TOOLS.inputs) return null;
    const seen = new Set<string>();
    const list: AgentCodeTool["inputs"] = [];
    for (const i of ins) {
      const n = (i as Record<string, unknown> | null)?.name;
      const ty = (i as Record<string, unknown> | null)?.type;
      if (
        typeof n !== "string" ||
        !AGENT_TOOLS.name.test(n) ||
        seen.has(n) ||
        !(AGENT_TOOLS.types as readonly unknown[]).includes(ty)
      )
        return null;
      seen.add(n);
      list.push({ name: n, type: ty as AgentCodeTool["inputs"][number]["type"] });
    }
    out.push({ name, inputs: list, code });
  }
  return out;
}

/** Whether a value given to a tool's input is of its type: what the model wrote is checked, never trusted. */
export function inputFits(type: AgentCodeTool["inputs"][number]["type"], v: Cell): boolean {
  switch (type) {
    case "text":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    default:
      return v !== undefined;
  }
}
/** «Respuesta» (AU-53): «Texto» or «Campos». */
export const AGENT_ANSWERS = ["text", "fields"] as const;
/** «Se ejecuta» (AU-55). */
export const AGENT_MODES = ["all", "perRow"] as const;
/** «Rondas máximas» (AU-58): born at 5, never over 10. */
export const AGENT_ROUNDS = { born: 5, max: 10 } as const;
/** «Lo que hizo» keeps at most this many lines per unit of work, and counts the rest (AU-54). */
export const AGENT_LINES = 50;

// ---------------------------------------------------------------- the port

/** A value as the engine holds it: its JSON, its label, and the labels of its fields where they have their own. */
export interface AgentValue {
  json: Cell;
  label: Label;
  fields?: Readonly<Record<string, { label: Label }>>;
}
/** The tools a round may call (packages/agent's `READ_TOOLS` and `WRITE_TOOLS`). */
export type AgentTool = "find" | "get" | "count" | "sum" | "create" | "update" | "trash";
/** What a tool gives back: rows read, one value, what a write will do, or a refusal the model is told (AU-198). */
export type AgentToolReply =
  | { rows: AgentValue[]; of?: number }
  | { value: AgentValue }
  | { planned: string }
  | { refused: string };
/** What the view of a round left out («Vio 200 de 3.000 filas»). */
export interface AgentSeen {
  at: string;
  saw: number;
  of: number;
}

/**
 * One unit of work of an «Agente», as the port receives it: the closed list of AU-197 and the engine's tools. Nothing
 * else reaches the model: no key, nothing Boni knows of Juan, no other collection, automation or chat.
 */
export interface AgentCall {
  use: "agent";
  /** The step's «Modelo»: the id of the choice it keeps, or null for «El de la cuenta» (AU-199). */
  model: string | null;
  /** «Instrucciones» resolved, each part with its label: one a planner may not see goes as a handle (AU-197). */
  instructions: AgentValue[];
  /** The rows of the unit of work: all of them, or one (AU-55). */
  rows: AgentValue[];
  /** What the model may know of each connected collection (`agentSchema`). */
  connections: Cell;
  answer: { kind: "text" } | { kind: "fields"; fields: ReaderField[] };
  /** «Las decide la IA»: the round may read. With «Las hace este código», `rows` are what its code gave. */
  reads: boolean;
  /** «Herramientas de código» (AU-58): their names and inputs, never their code. */
  codeTools?: { name: string; inputs: { name: string; type: string }[] }[];
  maxRounds: number;
  today: string;
  zone: string;
  language: string;
  /** The label of what the model writes in this step. */
  written: Label;
  /** Before every call to the model, retries included (AU-206): throws to stop the run. */
  modelCall(): void;
  /**
   * «Reintentar si el modelo falla» (`AI_RETRY`): how many times a round's call is asked again after a `transient`
   * refusal.
   */
  retries: number;
  /** Before retry `n` of a round's call: waits, counts the call and checks the run's time; throws to stop the run. */
  retry(n: number): Promise<void>;
  /** After every answer of the model: which one answered and how long it took (AU-54). */
  called(model: string | undefined, ms: number): void;
  now(): number;
  tool(
    name: AgentTool | string,
    args: Readonly<Record<string, AgentValue>>,
  ): Promise<AgentToolReply>;
}

/** How the rounds ended: an answer, a fault of their own (`agent.*`), or the port's refusal. */
export type AgentReply =
  | { answer: Record<string, AgentValue>; rounds: number; seen: AgentSeen[] }
  | {
      fault: "agent.plan" | "agent.rounds" | "agent.reply";
      errors: string[];
      rounds: number;
      seen: AgentSeen[];
    }
  | { refused: string; rounds: number; seen: AgentSeen[] };

// ---------------------------------------------------------------- «Lo que hizo»

/**
 * One line of «Lo que hizo» (AU-54), written by the code with what it ran of the plan, never by the model (A-01). Keys
 * and numbers only: the words are the app's (P2). A write's `state` is what became of it when the step ended:
 * `planned` while the unit runs, then `applied`, `tested` (a test: «Propondría…»), `asked` (it waits for Juan) or
 * `failed` (nothing of the step was saved).
 */
export type AgentLine =
  | {
      op: "find" | "get" | "count" | "sum";
      collection: string;
      rows: number;
      where?: Cell;
      limit?: number;
    }
  | {
      op: WriteAction;
      collection: string;
      state: "planned" | "applied" | "tested" | "asked" | "failed";
    }
  /** «Quiso… · su conexión no lo deja» (AU-198): what it asked, where, and why it was refused (a key). */
  | { op: "refused"; tool: AgentTool | string; collection?: string; why: string }
  /**
   * «Leyó con su código»: what «Las hace este código» gave (`code`, AU-51), or one call of a «Herramienta de código»
   * by its name (`tool`, AU-58), with how many rows it gave (one value is 1).
   */
  | { op: "code"; rows: number }
  | { op: "tool"; name: string; rows: number }
  /** «No leyó «Asunto» · viene de fuera» (AU-197): a value it received as a handle. */
  | { op: "hidden"; field: string; from: "instructions" | "rows"; integrity: string };

/** One unit of work of an «Agente» in its step's record. */
export interface AgentUnit {
  /** With «Una vez por fila», the row's place in the step's input. */
  row?: number;
  rounds: number;
  lines: AgentLine[];
  /** Lines past `AGENT_LINES`: «y 12 más». */
  more: number;
  seen: AgentSeen[];
}
export interface AgentRecord {
  units: AgentUnit[];
}

/** Adds a line to a unit, or counts it past `AGENT_LINES`. */
export function addLine(unit: AgentUnit, line: AgentLine): void {
  if (unit.lines.length < AGENT_LINES) unit.lines.push(line);
  else unit.more++;
}

/**
 * The «hidden» lines of what a unit sends (AU-197): each field of its rows, and each part of «Instrucciones», whose
 * label a planner may not see, once per field.
 */
export function hiddenLines(
  instructions: readonly { value: AgentValue; field: string }[],
  rows: readonly AgentValue[],
): AgentLine[] {
  const out: AgentLine[] = [];
  const seen = new Set<string>();
  const add = (from: "instructions" | "rows", field: string, label: Label) => {
    const k = `${from}\u0000${field}`;
    if (plannerMaySee(label) || seen.has(k)) return;
    seen.add(k);
    out.push({ op: "hidden", field, from, integrity: label.noModel ? "private" : label.integrity });
  };
  for (const part of instructions) add("instructions", part.field, part.value.label);
  for (const row of rows) {
    const json = row.json;
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      add("rows", "", row.label);
      continue;
    }
    for (const key of Object.keys(json)) add("rows", key, row.fields?.[key]?.label ?? row.label);
  }
  return out;
}

// ---------------------------------------------------------------- what the model knows of its connections

/**
 * The schema of a step's connections as its model receives it (AU-197): for each connected collection, its key and
 * the fields it may read or write (with each one's type, options and relation), its reading (`false`: said, so the
 * answer can say it cannot), and only the actions not in «No», with their limits and the line of each field the AI
 * decides (AU-52). Fixed fields are named, never their values: the code puts them. The collection's name and what it
 * is for, and its options' names, come when the collections give them (the server, only what a planner may read).
 */
export function agentSchema(
  connections: readonly Connection[],
  shape: (collection: string) => CollectionShape | undefined,
): Cell {
  return connections.map((c) => {
    const known = shape(c.collection);
    const fields = known?.fields ?? [];
    const readable = c.read === false ? [] : (c.read.fields ?? fields.map((f) => f.key));
    const writable = new Set([
      ...(c.create ? (c.create.fields ?? []) : []),
      ...(c.update ? (c.update.fields ?? []) : []),
    ]);
    const out: Record<string, Cell> = {
      collection: c.collection,
      ...(known?.name ? { name: known.name } : {}),
      ...(known?.description ? { description: known.description } : {}),
      fields: fields
        .filter((f) => readable.includes(f.key) || writable.has(f.key))
        .map((f) => ({
          key: f.key,
          type: f.type,
          ...(f.options ? { options: [...f.options] } : {}),
          ...(f.optionNames && Object.keys(f.optionNames).length
            ? { optionNames: { ...f.optionNames } }
            : {}),
          ...(f.target ? { target: f.target } : {}),
        })),
      read:
        c.read === false
          ? false
          : {
              ...(c.read.where ? { where: c.read.where as unknown as Cell } : {}),
              ...(c.read.fields ? { fields: [...c.read.fields] } : {}),
              ...(c.read.limit !== undefined ? { limit: c.read.limit } : {}),
            },
    };
    const lines = (cell: { fields?: readonly string[]; lines?: Record<string, string> }) =>
      (cell.fields ?? []).map((key) => ({ key, line: cell.lines?.[key] ?? "" }));
    if (c.create)
      out.create = {
        fields: lines(c.create),
        fixed: Object.keys(c.create.fixed ?? {}),
        ...(c.create.limit !== undefined ? { limit: c.create.limit } : {}),
      };
    if (c.update)
      out.update = {
        fields: lines(c.update),
        fixed: Object.keys(c.update.fixed ?? {}),
        ...(c.update.where ? { where: c.update.where as unknown as Cell } : {}),
        ...(c.update.limit !== undefined ? { limit: c.update.limit } : {}),
      };
    if (c.remove)
      out.trash = {
        ...(c.remove.where ? { where: c.remove.where as unknown as Cell } : {}),
        ...(c.remove.limit !== undefined ? { limit: c.remove.limit } : {}),
      };
    return out;
  });
}

/**
 * The connections an «Agente»'s writes are held to: a write cell with no «Lo decide la IA» lets the AI set no field
 * (AU-52: an unmarked field is never written), where a «Código»'s without `fields` may set any.
 */
export function agentConnections(connections: readonly Connection[]): Connection[] {
  return connections.map((c) => ({
    ...c,
    ...(c.create ? { create: { ...c.create, fields: c.create.fields ?? [] } } : {}),
    ...(c.update ? { update: { ...c.update, fields: c.update.fields ?? [] } } : {}),
  }));
}

// ---------------------------------------------------------------- the tools

/** A write an «Agente» asked for in a unit, checked and kept to be decided with the step's (AU-198). */
export interface Gathered {
  request: WriteRequest;
  label: Label;
  /** The fixed expressions of the create or modify asked, resolved for this unit (AU-52). */
  fixed?: Record<string, Labeled<Cell>>;
  line: Extract<AgentLine, { op: WriteAction }>;
}

/** What the tools of one unit need from the engine. */
export interface ToolsInput {
  step: Step;
  shape(collection: string): CollectionShape | undefined;
  /** The step's reader, through its connections and the policy (box.ts). */
  reader: Reader;
  /** The rows the step has read in this run, by `collection\0id`: what a relation may point to (AU-52). */
  read: Set<string>;
  /** The fixed expressions of an action of a collection (create's or modify's), resolved for this unit. */
  fixed(collection: string, action: "create" | "update"): Record<string, Labeled<Cell>> | undefined;
  /**
   * Checks these writes, after those of the step's units that worked before this one, against the connection as
   * saved and the collection (writes.ts `applyWrites`, as a test that decides nothing): throws its `CodeFault` for
   * the first that does not pass. «Como mucho» counts all of them.
   */
  check(writes: readonly Gathered[]): Promise<void>;
  /** This unit's writes so far. `check` adds those of the step's units that worked before it. */
  gathered: Gathered[];
  /** The label of what the model writes in this step. */
  written: Label;
  unit: AgentUnit;
  /** The step's «Herramientas de código» (AU-58). */
  tools: readonly AgentCodeTool[];
  /**
   * Runs one in the box with the step's connections, reading only, with these inputs: its rows or its value, each
   * with the label of everything it received and read; or the key the model is told when it failed or a read was
   * refused.
   */
  runTool(
    tool: AgentCodeTool,
    inputs: Record<string, Cell>,
    label: Label,
  ): Promise<{ rows: AgentValue[] } | { value: AgentValue } | { refused: string }>;
}

const WRITES: Partial<Record<AgentTool, WriteAction>> = {
  create: "create",
  update: "update",
  trash: "remove",
};
const TOOLS: readonly string[] = ["find", "get", "count", "sum", "create", "update", "trash"];
const isTool = (t: string): t is AgentTool => TOOLS.includes(t);
const isObj = (v: unknown): v is Record<string, Cell> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Why a read or a write of the plan is refused, as the key the model is told and «Lo que hizo» keeps (AU-198), from
 * what the engine's own checks threw. A row that is not there and one the connection leaves out are said the same
 * way (AU-177). Undefined: not the plan's to be told, the unit fails.
 */
function refusalOf(e: CodeFault, connections: readonly Connection[]): string | undefined {
  const { code, detail } = e.why;
  const why = detail?.why;
  switch (code) {
    case "code.read.notConnected":
      return connections.some((c) => c.collection === detail?.collection && c.read === false)
        ? "read-off"
        : "not-connected";
    case "code.read.query":
      return why === "hidden" ? "outside-fields" : "bad-query";
    case "code.limit":
      return detail?.limit === "readRows" || detail?.limit === "readBytes" ? "too-many" : undefined;
    case "code.write.unseen":
      return "not-connected";
    case "code.write.notAllowed":
      return why === "many" ? "over-limit" : why === "field" ? "outside-fields" : "action-off";
    case "code.write.hidden":
      return "outside-fields";
    case "code.write.outside":
      return "outside-rows";
    case "code.write.request":
      return "bad-request";
    default:
      return undefined;
  }
}

/**
 * The policy's no to one call of the plan (AU-198, AU-205): P29 on the step's connection is told to the model; a
 * collection made private after publishing fails the unit saying which (AU-166, `ai.private`); any other rule fails
 * the unit with its rule and no detail (AU-161).
 */
export function deniedOf(d: Denied, where: Record<string, string>): string {
  if (d.rule === "P29" && d.message === "private-collection")
    throw new AiFault(`a private collection was read (${Object.values(where).join(", ")})`, {
      code: "ai.private",
      detail: where,
    });
  if (d.rule === "P29") return d.message;
  throw d;
}

/** The tools of one unit of work: what `AgentCall.tool` calls. */
export class AgentTools {
  readonly input: ToolsInput;
  constructor(input: ToolsInput) {
    this.input = input;
  }

  /** Refuses a call: the model is told the key, and «Lo que hizo» keeps it. */
  refuse(tool: AgentTool | string, collection: string | undefined, why: string): AgentToolReply {
    addLine(this.input.unit, {
      op: "refused",
      tool,
      ...(collection === undefined ? {} : { collection }),
      why,
    });
    return { refused: why };
  }

  async call(
    tool: AgentTool | string,
    args: Readonly<Record<string, AgentValue>>,
  ): Promise<AgentToolReply> {
    const code = this.input.tools.find((t) => t.name === tool);
    if (code) return this.codeTool(code, args);
    if (!isTool(tool)) return this.refuse(tool, undefined, "bad-request");
    const collection = args.collection?.json;
    if (typeof collection !== "string" || !collection)
      return this.refuse(tool, undefined, "bad-request");
    const label = join(this.input.written, ...Object.values(args).map((a) => a.label));
    try {
      const write = WRITES[tool];
      return write
        ? await this.write(tool, write, collection, args, label)
        : await this.readOne(tool, collection, args, label);
    } catch (e) {
      if (e instanceof Denied) return this.refuse(tool, collection, deniedOf(e, { collection }));
      if (e instanceof CodeFault) {
        const why = refusalOf(e, this.input.step.connections ?? []);
        if (why) return this.refuse(tool, collection, why);
      }
      throw e;
    }
  }

  /**
   * A call of a «Herramienta de código» (AU-58): each input of its type, then its code in the box. What it gives goes
   * back with its labels, through the planner's view as every read does.
   */
  async codeTool(
    tool: AgentCodeTool,
    args: Readonly<Record<string, AgentValue>>,
  ): Promise<AgentToolReply> {
    const inputs: Record<string, Cell> = {};
    for (const i of tool.inputs) {
      const v = args[i.name]?.json;
      if (v === undefined || !inputFits(i.type, v))
        return this.refuse(tool.name, undefined, "bad-request");
      inputs[i.name] = v;
    }
    const label = join(this.input.written, ...Object.values(args).map((a) => a.label));
    const got = await this.input.runTool(tool, inputs, label);
    if ("refused" in got) return this.refuse(tool.name, undefined, got.refused);
    addLine(this.input.unit, {
      op: "tool",
      name: tool.name,
      rows: "rows" in got ? got.rows.length : 1,
    });
    return got;
  }

  /** A read of the plan, narrowed by the step's connection as a «Código»'s (AU-51, AU-43). */
  async readOne(
    tool: AgentTool,
    collection: string,
    args: Readonly<Record<string, AgentValue>>,
    label: Label,
  ): Promise<AgentToolReply> {
    // «Las hace este código»: the round was not offered reads, and one asked anyway is refused (AU-51).
    if (this.input.step.params[AGENT_PARAMS.reads] === "code")
      return this.refuse(tool, collection, "read-off");
    const op = tool as CodeRead["op"];
    const query = args.query?.json ?? {};
    if (!isObj(query)) return this.refuse(tool, collection, "bad-query");
    const asked: CodeRead = { collection, op };
    for (const k of Object.keys(query))
      if (k !== "where" && k !== "sort" && k !== "limit")
        return this.refuse(tool, collection, "bad-query");
    if (query.where !== undefined) asked.where = query.where as unknown as CodeRead["where"];
    if (query.sort !== undefined) asked.sort = query.sort as unknown as CodeRead["sort"];
    if (query.limit !== undefined) asked.limit = query.limit as number;
    if (op === "get") asked.id = args.id?.json as string;
    if (op === "sum") asked.field = args.field?.json as string;
    const made = await this.input.reader.read(JSON.stringify(asked), asked, label);
    if ("denied" in made) throw made.denied;
    if ("failure" in made) throw new CodeFault(made.failure.code, made.failure);
    const read = this.input.step.connections?.find((c) => c.collection === collection)?.read;
    const limit = asked.limit ?? (read ? read.limit : undefined);
    const line = (rows: number): AgentLine => ({
      op,
      collection,
      rows,
      ...(asked.where ? { where: asked.where as unknown as Cell } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    if (op === "find") {
      const rows = (made.value as Cell[]).map((json, i): AgentValue => {
        const each = made.each?.[i];
        const id = isObj(json) ? json.id : undefined;
        if (typeof id === "string") this.input.read.add(`${collection}\u0000${id}`);
        return {
          json,
          label: each?.label ?? made.label ?? this.input.written,
          ...(each?.fields ? { fields: each.fields } : {}),
        };
      });
      addLine(this.input.unit, line(rows.length));
      return { rows };
    }
    if (op === "get") {
      const json = made.value;
      const id = isObj(json) ? json.id : undefined;
      if (typeof id === "string") this.input.read.add(`${collection}\u0000${id}`);
      addLine(this.input.unit, line(json === null ? 0 : 1));
      const each = made.each?.[0];
      return {
        value: {
          json,
          label: each?.label ?? made.label ?? this.input.written,
          ...(each?.fields ? { fields: each.fields } : {}),
        },
      };
    }
    addLine(this.input.unit, line(1));
    return { value: { json: made.value, label: made.label ?? this.input.written } };
  }

  /**
   * A write of the plan: checked now against the connection as saved, the collection's options and the rows read
   * (AU-52), with the step's other writes, and kept to be decided when the step ends (AU-198). The model is told what
   * it will do («Creará 1 fila en …»), never the row: a later round does not read what an earlier one asked to write.
   */
  async write(
    tool: AgentTool,
    action: WriteAction,
    collection: string,
    args: Readonly<Record<string, AgentValue>>,
    label: Label,
  ): Promise<AgentToolReply> {
    const request: WriteRequest = { collection, action };
    if (action !== "create") request.id = args.id?.json ?? null;
    if (action !== "remove") {
      const fields = args.fields?.json;
      if (!isObj(fields)) return this.refuse(tool, collection, "bad-request");
      request.fields = fields;
      const shape = this.input.shape(collection);
      for (const [key, value] of Object.entries(fields)) {
        const f = shape?.fields.find((x) => x.key === key);
        if (!f || value === null) continue;
        // An option the field does not have (AU-52): a model cannot invent one.
        if (f.options && (f.type === "select" || f.type === "multiselect")) {
          const given = Array.isArray(value) ? value : [value];
          if (!given.every((o) => typeof o === "string" && f.options?.includes(o)))
            return this.refuse(tool, collection, "bad-option");
        }
        // A relation points to a row this step read in this run (AU-52).
        if (f.type === "relation" && f.target) {
          const given = Array.isArray(value) ? value : [value];
          if (
            !given.every(
              (id) => typeof id === "string" && this.input.read.has(`${f.target}\u0000${id}`),
            )
          )
            return this.refuse(tool, collection, "not-read");
        }
      }
    }
    const fixed = action === "remove" ? undefined : this.input.fixed(collection, action);
    const gathered: Gathered = {
      request,
      label,
      ...(fixed ? { fixed } : {}),
      line: { op: action, collection, state: "planned" },
    };
    await this.input.check([...this.input.gathered, gathered]);
    this.input.gathered.push(gathered);
    addLine(this.input.unit, gathered.line);
    return { planned: `will ${action} 1 row in ${collection}` };
  }
}
