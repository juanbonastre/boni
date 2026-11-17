/**
 * The catalogue of step types, as data (docs/automatizaciones.md §5.10): what each type is, its actions, what each
 * action does to the data (reads, writes, destroys: AU-19), whether it works row by row or with all the rows (AU-13),
 * its inputs and outputs (AU-03) and its parameters, declared so that the canvas can paint them with the same few
 * controls (AU-80) and a test can count them (AU-75). There is no other list: the policy's effect, the map and the
 * list of actions are read from here.
 *
 * F14a: «Disparado por el usuario» and the steps of Datos, Transformar and Lógica. Nothing here is text for a person:
 * a type, an action, a parameter and an option are keys, and each app names them in its `i18n.ts` (I-02).
 */

import {
  AGENT_ANSWERS,
  AGENT_MODES,
  AGENT_PARAMS,
  AGENT_READS,
  AGENT_ROUNDS,
  AGENT_TOOLS,
} from "./agent.ts";
import {
  EXTRACT_FIELDS_MAX,
  EXTRACT_TYPES,
  isReaderType,
  READER_PARAMS,
  type ReaderType,
} from "./ai.ts";
import { AGENT_TYPE, CODE_PARAMS, CODE_TYPE } from "./code.ts";
import { ACTION, MAIN, OUT, type ParamValue, type Step } from "./format.ts";

export const CATEGORIES = ["trigger", "data", "transform", "logic"] as const;

/** A «Programada»'s rule (AU-114): how often, and for `week`, which day (keys; each app names them). */
export const SCHEDULE_EVERY = ["hour", "day", "week"] as const;
export const SCHEDULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
/** An hour of the day as a «Programada» keeps it. */
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
export type Category = (typeof CATEGORIES)[number];
/** The AI steps' group (F15). Not in `CATEGORIES` yet: the editor's panel offers them from P2 on. */
export const AI_CATEGORY = "ai";

/**
 * The controls every step is made of (AU-80). Seven of the nine: F14c adds the code editor and the connections'
 * table. A step type cannot bring a control of its own.
 */
export const CONTROLS = [
  "value",
  "choice",
  "toggle",
  "list",
  "conditions",
  "fields",
  "picker",
] as const;
export type Control = (typeof CONTROLS)[number];

/** Where a field to choose or to fill comes from: the step's collection, or the rows that arrive by an input. */
export type FieldsOf = { of: "collection" } | { of: "input"; input: string };

interface ParamBase {
  key: string;
  /**
   * `shown`: in sight when the step opens. `option`: behind «Añadir opción» (AU-76). `hidden`: never painted (the
   * fixed id of a list's row).
   */
  place: "shown" | "option" | "hidden";
  /** Without it the step is not valid. */
  required?: true;
  /**
   * It gives the step its shape: a fixed value, never an expression, so the map knows it before any run (AU-26).
   * On a list: its rows are fixed (how many, and their `shape` columns); the other columns may hold expressions.
   */
  shape?: true;
  /** It changes which rows come out or where: never `option` (AU-77), and what it reads marks the path (AU-164). */
  changesRows?: true;
  /** Painted, and counted, only while that parameter (a `shape` one) holds one of these values. */
  when?: { param: string; in: readonly string[] };
  /** What it holds in a new step. */
  default?: string | number | boolean;
}

export type ParamSpec = ParamBase &
  /** `time`: an hour of the day, "HH:MM" (a «Programada»'s rule, AU-114). */
  (
    | { control: "value"; of: "text" | "number" | "date" | "time" | "any" }
    /** One of `options` (keys), or one field. */
    | { control: "choice"; options: readonly string[] | FieldsOf }
    | { control: "toggle" }
    /** Rows that Juan adds, each with these columns; `min` rows at least. */
    | { control: "list"; columns: readonly ParamSpec[]; min?: number; max?: number }
    /** The views' filter (AU-81) over those fields; `min` conditions at least (AU-121). */
    | { control: "conditions"; over: FieldsOf; min?: number }
    /** The fields of a row: only the ones Juan adds, each with the control of its type (AU-121). */
    | { control: "fields"; over: FieldsOf }
    /** A selector (F17 and F18 add `automation` and `block`). */
    | { control: "picker"; of: "collection" | "row" | "step" }
  );

export interface ActionSpec {
  /** `RUN` in a type with one action. */
  key: string;
  /** What it does to the saved data: nothing (it works on the rows that pass), read or write. */
  effect: "none" | "read" | "write";
  /** A write that takes something away (to the trash: AU-122). The policy asks before (P5). */
  destroys: boolean;
  /**
   * `perRow`: the engine calls it once per row that arrives, and each row out knows the one it comes from.
   * `all`: once, with every row (AU-13).
   */
  mode: "perRow" | "all";
  /**
   * Whether a row out still knows its input row, so `$('Step').item` finds its own across this step: always in
   * `perRow`; in `all`, only where the same rows pass on (sort, limit, remove duplicates), not where they are remade.
   */
  pairs: boolean;
  /**
   * Its outputs, in order. `rules`: one per row of the parameter `rules` (by its `id`), then `OUT.other` when
   * `fallback` says so («Elegir rama»). «error» is not listed: any step gains it with «Salir por error» (AU-16).
   */
  outputs: readonly string[] | "rules";
  /** After the type's own, in the order they are painted. */
  params: readonly ParamSpec[];
}

export interface StepTypeSpec {
  type: string;
  category: Category | typeof AI_CATEGORY;
  /** Its inputs: none for a trigger, `MAIN` for the rest, two with names for «Combinar» (AU-124). */
  inputs: readonly string[];
  /** Parameters every action shares, painted first («Colección»: the collection, AU-120). */
  params: readonly ParamSpec[];
  /** One or more. With several, the step has one more `shape` parameter, `ACTION`, painted after `params`. */
  actions: readonly ActionSpec[];
}

/** The key of the only action of a type with one. */
export const RUN = "run";
/** The two inputs of «Combinar». */
export const IN = { main: MAIN, a: "a", b: "b" } as const;

const INPUT: FieldsOf = { of: "input", input: MAIN };
const COLLECTION: FieldsOf = { of: "collection" };
const MEASURES = ["count", "sum", "average", "min", "max"] as const;

/**
 * The field a measure's result goes in, in «Agrupar» and «Contar o sumar» alike: `<measure>_<field>` (`sum_importe`,
 * `max_fecha`), and the measure alone with no field (`count`, a count of rows). Two results of one step with one name,
 * or a result named like a field it groups by, make the automation invalid (`param.sameName`, AU-120).
 */
export const resultName = (measure: string, field?: string): string =>
  field === undefined ? measure : `${measure}_${field}`;
const WITH_FIELD = ["sum", "average", "min", "max"] as const;
const DIRECTION: ParamSpec = {
  key: "direction",
  control: "choice",
  options: ["asc", "desc"],
  place: "shown",
  default: "asc",
};
/** Where a «Fecha» action leaves its result: a field of the row, the rest of the row as it was. */
const TO: ParamSpec = { key: "to", control: "value", of: "text", place: "shown", required: true };
const DATE: ParamSpec = {
  key: "date",
  control: "value",
  of: "date",
  place: "shown",
  required: true,
};
const UNITS = ["minutes", "hours", "days", "weeks", "months", "years"] as const;
/**
 * «Las filas que llegan» or «Las que cumplan…» (AU-121): fixed, so validation can ask for the condition. Like every
 * action of «Colección» it works row by row: «Las que cumplan…» searches once per row that arrives (its conditions
 * may cite it), and once with no row when the step runs with an empty list (AU-14).
 */
const TARGET: ParamSpec = {
  key: "target",
  control: "choice",
  options: ["incoming", "matching"],
  place: "shown",
  shape: true,
  changesRows: true,
  default: "incoming",
};
const TARGET_WHERE: ParamSpec = {
  key: "where",
  control: "conditions",
  over: COLLECTION,
  min: 1,
  place: "shown",
  required: true,
  changesRows: true,
  when: { param: "target", in: ["matching"] },
};

/**
 * The «Permiso» each write action of a «Colección» step is born with when the person's hand adds the step in the
 * editor (AU-187, decision 13 of §10): «Sí» on «Crear una fila», «Modificar filas» and «Crear o modificar», which is
 * the one «Sí» that is not a tap on the cell; «Preguntar» on «Eliminar filas». A step that arrives any other way gets
 * «Preguntar» on all of them (`lowerYes`, AU-188). The editor writes it into the step (`bornParams`): a step saved
 * without the parameter, wherever it came from, reads «Preguntar», so no «Sí» is ever a missing value.
 */
export const PERMISSION_BORN: Readonly<
  Record<"create" | "update" | "upsert" | "trash", "yes" | "ask">
> = { create: "yes", update: "yes", upsert: "yes", trash: "ask" };
/** The parameter «Permiso» (AU-187): the words of a connection's cells; fixed, never an expression (AU-26). */
export const PERMISSION = "permission";
const permission = (action: keyof typeof PERMISSION_BORN): ParamSpec => ({
  key: PERMISSION,
  control: "choice",
  options: ["ask", "yes"],
  place: "shown",
  required: true,
  shape: true,
  // What a step without it reads: never a «Sí» (AU-188). The value a step is born with is `bornParams`'s.
  default: "ask",
});

/**
 * The parameters the code writes into a step when the person's hand adds it in the editor, or gives it another
 * action there (AU-187, AU-188, decision 13 of §10): the «Permiso» of a «Colección» write action as
 * `PERMISSION_BORN` says. Nothing for any other step: every other parameter is its default until the person sets it
 * (AU-87).
 */
export function bornParams(type: string, action: string | undefined): Record<string, ParamValue> {
  if (type !== "collection" || action === undefined || !(action in PERMISSION_BORN)) return {};
  return { [PERMISSION]: PERMISSION_BORN[action as keyof typeof PERMISSION_BORN] };
}

const transform = (
  type: string,
  mode: ActionSpec["mode"],
  pairs: boolean,
  params: readonly ParamSpec[],
): StepTypeSpec => ({
  type,
  category: "transform",
  inputs: [MAIN],
  params: [],
  actions: [{ key: RUN, effect: "none", destroys: false, mode, pairs, outputs: [MAIN], params }],
});

const dateAction = (key: string, params: readonly ParamSpec[]): ActionSpec => ({
  key,
  effect: "none",
  destroys: false,
  mode: "perRow",
  pairs: true,
  outputs: [MAIN],
  params,
});

const collectionAction = (
  key: string,
  effect: "read" | "write",
  params: readonly ParamSpec[],
  destroys = false,
): ActionSpec => ({ key, effect, destroys, mode: "perRow", pairs: true, outputs: [MAIN], params });

export const CATALOGUE: readonly StepTypeSpec[] = [
  // ------------------------------------------------------------ Disparadores (§5.9)
  {
    // «Disparado por el usuario» (AU-110). It gives one row: the «Campos que pide», with what it was started with.
    type: "manual",
    category: "trigger",
    inputs: [],
    params: [],
    actions: [
      {
        key: RUN,
        effect: "none",
        destroys: false,
        mode: "all",
        pairs: false,
        outputs: [MAIN],
        params: [
          {
            key: "fields",
            control: "list",
            place: "shown",
            shape: true,
            columns: [
              {
                key: "key",
                control: "value",
                of: "text",
                place: "hidden",
                required: true,
                shape: true,
              },
              {
                key: "name",
                control: "value",
                of: "text",
                place: "shown",
                required: true,
                shape: true,
              },
              {
                key: "type",
                control: "choice",
                options: ["text", "number", "checkbox", "date", "datetime"],
                place: "shown",
                required: true,
                shape: true,
                default: "text",
              },
            ],
          },
        ],
      },
    ],
  },

  {
    // «Programada» (AU-114, F14d): one or more rules, each «Cada hora» (its minute), «Cada día a las» or «Cada
    // semana el día a las», in the account's zone. It gives one row, `date`: the hour that was due (epoch ms), not the
    // hour it ran at, so two runs of the same hour compute the same. The server's scheduler starts it (its `run`
    // reads the rules from a column written at publishing); «Probar» gives now (AU-115).
    type: "schedule",
    category: "trigger",
    inputs: [],
    params: [],
    actions: [
      {
        key: RUN,
        effect: "none",
        destroys: false,
        mode: "all",
        pairs: false,
        outputs: [MAIN],
        params: [
          {
            key: "rules",
            control: "list",
            place: "shown",
            shape: true,
            min: 1,
            columns: [
              {
                key: "key",
                control: "value",
                of: "text",
                place: "hidden",
                required: true,
                shape: true,
              },
              {
                key: "every",
                control: "choice",
                options: SCHEDULE_EVERY,
                place: "shown",
                required: true,
                shape: true,
                default: "day",
              },
              {
                key: "at",
                control: "value",
                of: "time",
                place: "shown",
                required: true,
                shape: true,
                default: "08:00",
              },
              // Read only with `week`: Monday when not given.
              {
                key: "day",
                control: "choice",
                options: SCHEDULE_DAYS,
                place: "shown",
                shape: true,
              },
            ],
          },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Datos
  {
    // «Colección»: the collection and the action first, and from them the rest (AU-120).
    type: "collection",
    category: "data",
    inputs: [MAIN],
    params: [
      {
        key: "collection",
        control: "picker",
        of: "collection",
        place: "shown",
        required: true,
        shape: true,
      },
    ],
    actions: [
      // «Buscar filas»
      collectionAction("find", "read", [
        {
          key: "where",
          control: "conditions",
          over: COLLECTION,
          place: "shown",
          changesRows: true,
        },
        {
          key: "sort",
          control: "list",
          place: "shown",
          columns: [
            {
              key: "field",
              control: "choice",
              options: COLLECTION,
              place: "shown",
              required: true,
            },
            DIRECTION,
          ],
        },
        {
          key: "limit",
          control: "value",
          of: "number",
          place: "shown",
          required: true,
          changesRows: true,
          default: 50,
        },
        // «Incluir relacionadas»: one level.
        { key: "related", control: "toggle", place: "option", default: false },
      ]),
      // «Leer una fila»
      collectionAction("get", "read", [
        {
          key: "row",
          control: "picker",
          of: "row",
          place: "shown",
          required: true,
          changesRows: true,
        },
      ]),
      // «Crear una fila»
      collectionAction("create", "write", [
        { key: "fields", control: "fields", over: COLLECTION, place: "shown", required: true },
        permission("create"),
      ]),
      // «Modificar filas»
      collectionAction("update", "write", [
        TARGET,
        TARGET_WHERE,
        { key: "fields", control: "fields", over: COLLECTION, place: "shown", required: true },
        permission("update"),
      ]),
      // «Crear o modificar»: the row whose `match` fields hold the same values is modified; with none, one is created.
      collectionAction("upsert", "write", [
        {
          key: "match",
          control: "list",
          min: 1,
          place: "shown",
          required: true,
          changesRows: true,
          columns: [
            {
              key: "field",
              control: "choice",
              options: COLLECTION,
              place: "shown",
              required: true,
            },
          ],
        },
        { key: "fields", control: "fields", over: COLLECTION, place: "shown", required: true },
        permission("upsert"),
      ]),
      // «Eliminar filas»: to the trash, always (AU-122).
      collectionAction("trash", "write", [TARGET, TARGET_WHERE, permission("trash")], true),
      // «Contar o sumar»: one row with the result, or one per value of `groupBy`.
      collectionAction("aggregate", "read", [
        {
          key: "where",
          control: "conditions",
          over: COLLECTION,
          place: "shown",
          changesRows: true,
        },
        {
          key: "measure",
          control: "choice",
          options: MEASURES,
          place: "shown",
          required: true,
          shape: true,
          default: "count",
        },
        {
          key: "field",
          control: "choice",
          options: COLLECTION,
          place: "shown",
          required: true,
          when: { param: "measure", in: WITH_FIELD },
        },
        {
          key: "groupBy",
          control: "choice",
          options: COLLECTION,
          place: "shown",
          changesRows: true,
        },
      ]),
    ],
  },

  // ------------------------------------------------------------ Transformar
  // «Editar campos»: sets fields of each row; `keep` says whether the other fields stay.
  transform("edit", "perRow", true, [
    { key: "fields", control: "fields", over: INPUT, place: "shown", required: true },
    { key: "keep", control: "choice", options: ["all", "none"], place: "shown", default: "all" },
  ]),
  // «Filtrar»
  transform("filter", "perRow", true, [
    {
      key: "where",
      control: "conditions",
      over: INPUT,
      min: 1,
      place: "shown",
      required: true,
      changesRows: true,
    },
  ]),
  // «Ordenar»
  transform("sort", "all", true, [
    {
      key: "by",
      control: "list",
      min: 1,
      place: "shown",
      required: true,
      // What decides the order decides which rows a later «Limitar» keeps (AU-164).
      changesRows: true,
      columns: [
        { key: "field", control: "choice", options: INPUT, place: "shown", required: true },
        DIRECTION,
      ],
    },
  ]),
  // «Limitar»
  transform("limit", "all", true, [
    {
      key: "count",
      control: "value",
      of: "number",
      place: "shown",
      required: true,
      changesRows: true,
    },
    {
      key: "from",
      control: "choice",
      options: ["first", "last"],
      place: "shown",
      changesRows: true,
      default: "first",
    },
  ]),
  // «Quitar duplicados»: rows equal in every field, or in the ones named.
  transform("dedupe", "all", true, [
    {
      key: "by",
      control: "choice",
      options: ["all", "fields"],
      place: "shown",
      shape: true,
      changesRows: true,
      default: "all",
    },
    {
      key: "fields",
      control: "list",
      min: 1,
      place: "shown",
      required: true,
      changesRows: true,
      when: { param: "by", in: ["fields"] },
      columns: [
        { key: "field", control: "choice", options: INPUT, place: "shown", required: true },
      ],
    },
  ]),
  // «Agrupar»: one row per group, with the fields grouped by and one field per measure. With no `by`, one row.
  transform("group", "all", false, [
    {
      key: "by",
      control: "list",
      place: "shown",
      changesRows: true,
      columns: [
        { key: "field", control: "choice", options: INPUT, place: "shown", required: true },
      ],
    },
    {
      key: "measures",
      control: "list",
      min: 1,
      place: "shown",
      required: true,
      columns: [
        // Its result goes in the field `resultName` gives.
        {
          key: "measure",
          control: "choice",
          options: [...MEASURES, "list"],
          place: "shown",
          required: true,
          shape: true,
          default: "count",
        },
        // Not for `count`.
        { key: "field", control: "choice", options: INPUT, place: "shown" },
      ],
    },
  ]),
  // «Separar una lista»: one row per item of a field that holds a list, each knowing the row it comes from.
  transform("split", "perRow", true, [
    {
      key: "field",
      control: "choice",
      options: INPUT,
      place: "shown",
      required: true,
      changesRows: true,
    },
    { key: "keep", control: "choice", options: ["all", "none"], place: "shown", default: "all" },
  ]),
  // «Juntar en una»: one row; each field holds the list of its values, or one field holds every row.
  transform("join", "all", false, [
    {
      key: "into",
      control: "choice",
      options: ["fields", "rows"],
      place: "shown",
      shape: true,
      default: "fields",
    },
    {
      key: "to",
      control: "value",
      of: "text",
      place: "shown",
      required: true,
      shape: true,
      when: { param: "into", in: ["rows"] },
    },
  ]),
  {
    // «Fecha»: date arithmetic, done by the injected `Dates` (effects.ts), with Juan's time zone.
    type: "date",
    category: "transform",
    inputs: [MAIN],
    params: [],
    actions: [
      // «Sumar o restar»
      dateAction("add", [
        DATE,
        { key: "amount", control: "value", of: "number", place: "shown", required: true },
        {
          key: "unit",
          control: "choice",
          options: UNITS,
          place: "shown",
          required: true,
          default: "days",
        },
        TO,
      ]),
      // «Diferencia»
      dateAction("diff", [
        DATE,
        { key: "until", control: "value", of: "date", place: "shown", required: true },
        {
          key: "unit",
          control: "choice",
          options: UNITS,
          place: "shown",
          required: true,
          default: "days",
        },
        TO,
      ]),
      // «Principio de»
      dateAction("startOf", [
        DATE,
        {
          key: "unit",
          control: "choice",
          options: ["day", "week", "month", "year"],
          place: "shown",
          required: true,
          default: "month",
        },
        TO,
      ]),
      // «Sacar una parte»
      dateAction("part", [
        DATE,
        {
          key: "part",
          control: "choice",
          options: ["year", "month", "day", "weekday", "week", "hour", "minute"],
          place: "shown",
          required: true,
          default: "month",
        },
        TO,
      ]),
      // «Dar formato»
      dateAction("format", [
        DATE,
        {
          key: "format",
          control: "choice",
          options: ["date", "dateLong", "time", "dateTime", "weekday", "month", "iso"],
          place: "shown",
          required: true,
          default: "date",
        },
        TO,
      ]),
    ],
  },
  {
    // «Combinar»: only to cross two lists of rows; joining branches needs no step (AU-11, AU-124).
    type: "combine",
    category: "transform",
    inputs: [IN.a, IN.b],
    params: [],
    actions: [
      {
        key: RUN,
        effect: "none",
        destroys: false,
        mode: "all",
        pairs: false,
        outputs: [MAIN],
        params: [
          // By a field, by position, or every row with every row.
          {
            key: "by",
            control: "choice",
            options: ["field", "position", "all"],
            place: "shown",
            required: true,
            shape: true,
            changesRows: true,
            default: "field",
          },
          {
            key: "fieldA",
            control: "choice",
            options: { of: "input", input: IN.a },
            place: "shown",
            required: true,
            changesRows: true,
            when: { param: "by", in: ["field"] },
          },
          {
            key: "fieldB",
            control: "choice",
            options: { of: "input", input: IN.b },
            place: "shown",
            required: true,
            changesRows: true,
            when: { param: "by", in: ["field"] },
          },
          // Which rows come out: only the ones that match, every row of «a», or every row of both.
          {
            key: "keep",
            control: "choice",
            options: ["matches", "a", "both"],
            place: "shown",
            changesRows: true,
            default: "matches",
            when: { param: "by", in: ["field", "position"] },
          },
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Lógica
  {
    // «Si»: two outputs, «sí» and «no» (AU-123).
    type: "if",
    category: "logic",
    inputs: [MAIN],
    params: [],
    actions: [
      {
        key: RUN,
        effect: "none",
        destroys: false,
        mode: "perRow",
        pairs: true,
        outputs: [OUT.yes, OUT.no],
        params: [
          {
            key: "where",
            control: "conditions",
            over: INPUT,
            min: 1,
            place: "shown",
            required: true,
            changesRows: true,
          },
        ],
      },
    ],
  },
  {
    // «Elegir rama»: one output per rule and, in sight, what happens when none matches and whether the first
    // rule that matches takes the row or all of them do (AU-123).
    type: "switch",
    category: "logic",
    inputs: [MAIN],
    params: [],
    actions: [
      {
        key: RUN,
        effect: "none",
        destroys: false,
        mode: "perRow",
        pairs: true,
        outputs: "rules",
        params: [
          {
            key: "rules",
            control: "list",
            min: 1,
            place: "shown",
            required: true,
            shape: true,
            changesRows: true,
            columns: [
              // The output's name in the arrows: fixed, like a step's id.
              {
                key: "id",
                control: "value",
                of: "text",
                place: "hidden",
                required: true,
                shape: true,
              },
              {
                key: "name",
                control: "value",
                of: "text",
                place: "shown",
                required: true,
                shape: true,
              },
              {
                key: "where",
                control: "conditions",
                over: INPUT,
                min: 1,
                place: "shown",
                required: true,
              },
            ],
          },
          {
            key: "fallback",
            control: "choice",
            options: ["none", "other"],
            place: "shown",
            shape: true,
            changesRows: true,
            default: "none",
          },
          {
            key: "match",
            control: "choice",
            options: ["first", "all"],
            place: "shown",
            shape: true,
            changesRows: true,
            default: "first",
          },
        ],
      },
    ],
  },
  {
    // «Parar con error»: the run stops there, failed, with this message.
    type: "stop",
    category: "logic",
    inputs: [MAIN],
    params: [],
    actions: [
      {
        key: RUN,
        effect: "none",
        destroys: false,
        mode: "all",
        pairs: false,
        outputs: [],
        params: [{ key: "message", control: "value", of: "text", place: "shown", required: true }],
      },
    ],
  },
];

// ---------------------------------------------------------------- reading it

/** A type of the catalogue by its key. */
export const stepType = (type: string): StepTypeSpec | undefined =>
  CATALOGUE.find((t) => t.type === type);

/**
 * «Código» (code.ts, F14c): reachable by its type but not in `CATALOGUE`: the editor's panel offers it beside the
 * catalogue (apps/boni-web adding.ts, AU-30), and validation without a `CodeContext` refuses it (`step.unknownType`). One input, one output,
 * no parameter the catalogue paints (its two are the editor's, validated by `validate`), and one action whose mode is
 * its «Se ejecuta». Its effect is `none`: it changes the rows it receives, and what it reads goes through its
 * connections (box.ts), not through an action that reads.
 */
const CODE_STEP: StepTypeSpec = {
  type: CODE_TYPE,
  category: "transform",
  inputs: [MAIN],
  params: [],
  actions: [
    {
      key: RUN,
      effect: "none",
      destroys: false,
      mode: "all",
      pairs: false,
      outputs: [MAIN],
      params: [],
    },
  ],
};
const CODE_PER_ROW: ActionSpec = {
  ...(CODE_STEP.actions[0] as ActionSpec),
  mode: "perRow",
  pairs: true,
};

/**
 * The four reader steps (AU-57, F15 E2): «Extraer datos», «Clasificar», «Resumir» and «Escribir texto». Like «Código»,
 * reachable by their types but not in `CATALOGUE` until the editor offers them (P2), and validation refuses them
 * (`step.unknownType`) unless its context says a model can be called (`ValidationContext.ai`). Each works row by row
 * and keeps its rows paired; none has an effect on the saved data and none takes a connection (AU-46). What each
 * does is in ai.ts: the engine reads all the rows first, in batches, through `RunDeps.ai`.
 */
const P = READER_PARAMS;
const TEXT: ParamSpec = {
  key: P.text,
  control: "value",
  of: "text",
  place: "shown",
  required: true,
};
/** «Modelo» (AU-199): the id of a choice of «Modelos» for the use «Lector», or absent for «El de la cuenta». */
const MODEL: ParamSpec = {
  key: P.model,
  control: "value",
  of: "text",
  place: "shown",
  shape: true,
};
const reader = (type: ReaderType, params: readonly ParamSpec[]): StepTypeSpec => ({
  type,
  category: AI_CATEGORY,
  inputs: [MAIN],
  params: [],
  actions: [
    {
      key: RUN,
      effect: "none",
      destroys: false,
      mode: "perRow",
      pairs: true,
      outputs: [MAIN],
      params,
    },
  ],
});
const READER_STEPS: Readonly<Record<ReaderType, StepTypeSpec>> = {
  extract: reader("extract", [
    TEXT,
    {
      key: P.fields,
      control: "list",
      place: "shown",
      required: true,
      shape: true,
      min: 1,
      max: EXTRACT_FIELDS_MAX,
      columns: [
        { key: "key", control: "value", of: "text", place: "shown", required: true },
        { key: "type", control: "choice", options: EXTRACT_TYPES, place: "shown", required: true },
        { key: "line", control: "value", of: "text", place: "shown" },
        { key: "options", control: "value", of: "any", place: "shown" },
      ],
    },
    MODEL,
  ]),
  classify: reader("classify", [
    TEXT,
    // Fixed, or an expression that gives the list: the reader answers one of them or nothing.
    { key: P.options, control: "value", of: "any", place: "shown", required: true },
    MODEL,
  ]),
  summarize: reader("summarize", [
    TEXT,
    MODEL,
    {
      key: P.length,
      control: "choice",
      options: ["short", "medium", "long"],
      place: "option",
      shape: true,
      default: "short",
    },
  ]),
  write: reader("write", [
    { key: P.instructions, control: "value", of: "text", place: "shown", required: true },
    // «Texto (puede faltar)»: instructions alone write a text from nothing (AU-57).
    { key: P.text, control: "value", of: "text", place: "shown" },
    MODEL,
  ]),
};
/**
 * «Agente» (AU-50, F15 E3): reachable by its type like the readers, and like them only with `ValidationContext.ai`.
 * One input, one output; its six shown parameters are AU-50's (its connections are the step's, not a parameter),
 * «Rondas máximas» behind «Añadir opción» (AU-58). Its effect is `none`: what it reads and writes goes through its
 * connections, as a «Código»'s does. «Se ejecuta» picks its action's mode (`actionOf`).
 */
const A = AGENT_PARAMS;
const AGENT_STEP: StepTypeSpec = {
  type: AGENT_TYPE,
  category: AI_CATEGORY,
  inputs: [MAIN],
  params: [],
  actions: [
    {
      key: RUN,
      effect: "none",
      destroys: false,
      mode: "all",
      pairs: false,
      outputs: [MAIN],
      params: [
        { key: A.instructions, control: "value", of: "text", place: "shown", required: true },
        { ...MODEL, key: A.model },
        {
          key: A.reads,
          control: "choice",
          options: AGENT_READS,
          place: "shown",
          shape: true,
          default: "ai",
        },
        // No `when`: changing «Lecturas» keeps the code (AU-51). It is required, and read, only with «code».
        { key: A.code, control: "value", of: "text", place: "shown" },
        {
          key: A.answer,
          control: "choice",
          options: AGENT_ANSWERS,
          place: "shown",
          shape: true,
          default: "text",
        },
        {
          key: A.fields,
          control: "list",
          place: "shown",
          required: true,
          shape: true,
          min: 1,
          max: EXTRACT_FIELDS_MAX,
          when: { param: A.answer, in: ["fields"] },
          columns: [
            { key: "key", control: "value", of: "text", place: "shown", required: true },
            {
              key: "type",
              control: "choice",
              options: EXTRACT_TYPES,
              place: "shown",
              required: true,
            },
            { key: "line", control: "value", of: "text", place: "shown" },
            { key: "options", control: "value", of: "any", place: "shown" },
          ],
        },
        {
          key: A.mode,
          control: "choice",
          options: AGENT_MODES,
          place: "shown",
          shape: true,
          default: "all",
        },
        {
          key: A.maxRounds,
          control: "value",
          of: "number",
          place: "option",
          shape: true,
          default: AGENT_ROUNDS.born,
        },
        {
          key: A.tools,
          control: "list",
          place: "option",
          max: AGENT_TOOLS.max,
          columns: [
            { key: "name", control: "value", of: "text", place: "shown", required: true },
            { key: "inputs", control: "value", of: "any", place: "shown" },
            { key: "code", control: "value", of: "text", place: "shown", required: true },
          ],
        },
      ],
    },
  ],
};
const AGENT_PER_ROW: ActionSpec = {
  ...(AGENT_STEP.actions[0] as ActionSpec),
  mode: "perRow",
  pairs: true,
};

/** The spec of a reader step's type, or undefined. */
export const readerStep = (type: string): StepTypeSpec | undefined =>
  isReaderType(type) ? READER_STEPS[type] : undefined;

/**
 * A type the engine can run by its key: the catalogue's, «Código» (the editor's panel adds it, adding.ts), or a reader
 * (F15: validation lets them in only with `ValidationContext.ai`).
 */
export const specOf = (type: string): StepTypeSpec | undefined =>
  type === CODE_TYPE
    ? CODE_STEP
    : type === AGENT_TYPE
      ? AGENT_STEP
      : (stepType(type) ?? readerStep(type));

/**
 * The action a step has chosen: the only one of its type, or the one its `ACTION` parameter names. Undefined when
 * its type is not in the catalogue, or its action is missing, an expression (AU-26) or not one of its type's.
 */
export function actionOf(step: Step): ActionSpec | undefined {
  if (step.type === CODE_TYPE && step.params[CODE_PARAMS.mode] === "perRow") return CODE_PER_ROW;
  if (step.type === AGENT_TYPE && step.params[AGENT_PARAMS.mode] === "perRow") return AGENT_PER_ROW;
  const spec = specOf(step.type);
  if (!spec) return undefined;
  if (spec.actions.length === 1) return spec.actions[0];
  const key = step.params[ACTION];
  return typeof key === "string" ? spec.actions.find((a) => a.key === key) : undefined;
}

/**
 * The parameters a step shows as it is now: its type's, `ACTION` where there are several, then its action's whose
 * `when` holds. What AU-75 counts (`place: "shown"`) and what validation walks.
 */
export function paramsOf(step: Step): ParamSpec[] {
  const spec = specOf(step.type);
  if (!spec) return [];
  const params: ParamSpec[] = [...spec.params];
  if (spec.actions.length > 1) params.push(actionParam(spec));
  const action = actionOf(step);
  if (!action) return params;
  const all = [...spec.params, ...action.params];
  for (const p of action.params) if (holds(p, step, all)) params.push(p);
  return params;
}

/** The parameter `ACTION` of a type with several actions: a fixed choice among them. */
export const actionParam = (spec: StepTypeSpec): ParamSpec => ({
  key: ACTION,
  control: "choice",
  options: spec.actions.map((a) => a.key),
  place: "shown",
  required: true,
  shape: true,
});

/** Whether a parameter's `when` holds for this step: the parameter it names holds one of its values (or its default). */
export function holds(p: ParamSpec, step: Step, among: readonly ParamSpec[]): boolean {
  if (!p.when) return true;
  const on = among.find((q) => q.key === p.when?.param);
  const v = step.params[p.when.param] ?? on?.default;
  return typeof v === "string" && p.when.in.includes(v);
}

/** A parameter's value in a step: what it holds, or its default. */
export const paramValue = (step: Step, p: ParamSpec): Step["params"][string] | undefined =>
  step.params[p.key] ?? p.default;

/**
 * The names of a step's outputs as it is now, in the catalogue's order: its action's (for `rules`, the rules' ids and
 * then `OUT.other` when `fallback` is "other"), and last `OUT.error` when its settings say «Salir por error» (AU-16).
 * Empty when the step has no valid action.
 */
export function outputsOf(step: Step): string[] {
  const action = actionOf(step);
  if (!action) return [];
  const out: string[] = [];
  if (action.outputs === "rules") {
    const rules = step.params.rules;
    if (Array.isArray(rules))
      for (const r of rules)
        if (
          typeof r === "object" &&
          r !== null &&
          !Array.isArray(r) &&
          "id" in r &&
          typeof r.id === "string"
        )
          out.push(r.id);
    if (step.params.fallback === "other") out.push(OUT.other);
  } else out.push(...action.outputs);
  if (step.settings?.onError === "errorOutput") out.push(OUT.error);
  return out;
}

/** The types whose outputs are branches: one left unconnected is probably a mistake (`output.unconnected`). */
export const OUTPUT_BRANCHES: ReadonlySet<string> = new Set(["if", "switch"]);

/** The names of a step's inputs: its type's. Empty for a trigger or an unknown type. */
export const inputsOf = (step: Step): readonly string[] => specOf(step.type)?.inputs ?? [];

/** Whether a step starts an automation (AU-110): a step of the category `trigger`. */
export const isTrigger = (step: Step): boolean => stepType(step.type)?.category === "trigger";
