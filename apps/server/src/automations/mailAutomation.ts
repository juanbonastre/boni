/**
 * «Leer correo» as Boni draws it (docs/automatizaciones.md §5.17, AU-249, AU-254): ten steps, from the mail's
 * configuration as it stands (its collections, the guide's instructions, examples and rules), never a translation of
 * the old plan (`mailPlan`). What each step does is said by its panel alone:
 *
 * «Llega un correo» → «Regla del remitente» (the guide's rules) → «Leer invitación» → «Lectora» («Busca»,
 * «Indicaciones», «Ejemplos») → «Plegar hilo» (its days) → «Decisora» (every collection, decision 20) → on «Duda»,
 * the catalogue's «Preguntar» («¿Dónde va …?», one option among those collections or «Ninguna», only the inbox, seven
 * days, once per row) → «Rellenadora» → «Buscar relaciones» → «Crear en la elegida» («Solo conocidos» on, one
 * «Crear» cell per collection, every one «Preguntar»: decision 13, nothing is born «Sí»).
 */
import type { Change } from "@boni/agent";
import {
  type Arrow,
  ASK_PARAMS,
  ASK_TYPE,
  type Automation,
  BONI_DOUBT,
  BONI_PARAMS,
  BONI_TRIGGERS,
  CREATE_CHOSEN,
  FORMAT,
  MAIN,
  type Step,
} from "@boni/automations";
import type { UserStore } from "@boni/store";
import { AUTO_AREA, autoOn } from "../autoAccept.ts";

/** The configuration «Leer correo» is drawn from, by keys of collections (never their ids). */
export interface ReadMailConfig {
  id: string;
  name: string;
  /** The collections it may propose into, by key, with their names now. */
  collections: { key: string; name: string }[];
  rules: { sender: string; do: "skip" | "collection"; collection: string | null }[];
  instructions: string;
  examples: { mail: string; want: string }[];
  modules: string[];
  days: number;
}

/**
 * «Lo que cambia» of «Leer correo» drawn (AU-254), two sentences of the closed list (AU-224): «Ya no acepta sola: lo
 * decide «Permiso»» when its «Solo» was on (every cell is born «Preguntar»), and always «Su duda es una pregunta en la
 * Bandeja, y caduca» (its «Decisora» doubted into the conversation before; now a «Preguntar» of seven days).
 */
export const readMailChanges = (store: UserStore): Change[] => [
  ...(autoOn(store, AUTO_AREA) ? (["permissionDecides"] as const) : []),
  "doubtAsks",
];

/** What the «Preguntar» on «Duda» answers when nothing fits: nothing is created. */
export const NONE_OPTION = "Ninguna";
/** How long it waits for his answer (§5.17). */
export const DOUBT_WAIT_DAYS = 7;

/** The document, or null without a collection to propose into. */
export function drawReadMail(c: ReadMailConfig): Automation | null {
  if (!c.collections.length) return null;
  const keys = new Set(c.collections.map((x) => x.key));
  const perRow = { [BONI_PARAMS.mode]: "perRow" } as const;
  const step = (id: string, name: string, type: string, params: Step["params"] = {}): Step => ({
    id,
    name,
    type,
    params,
  });
  const steps: Step[] = [
    step("trigger", "Llega un correo", BONI_TRIGGERS.mail),
    step("p-rule", "Regla del remitente", "boni.mailRule", {
      ...perRow,
      [BONI_PARAMS.rules]: c.rules
        .filter((r) => r.do === "skip" || (r.collection !== null && keys.has(r.collection)))
        .map((r) => ({
          sender: r.sender,
          do: r.do,
          ...(r.do === "collection" ? { collection: r.collection } : {}),
        })),
    }),
    step("p-invitation", "Leer invitación", "boni.mailInvitation", perRow),
    step("p-reader", "Lectora", "boni.mailReader", {
      ...perRow,
      [BONI_PARAMS.modules]: c.modules,
      [BONI_PARAMS.instructions]: c.instructions,
      [BONI_PARAMS.model]: "",
      ...(c.examples.length ? { [BONI_PARAMS.examples]: c.examples } : {}),
    }),
    step("p-fold", "Plegar hilo", "boni.fold", { ...perRow, [BONI_PARAMS.days]: c.days }),
    step("p-decider", "Decisora", "boni.mailDecider", {
      ...perRow,
      [BONI_PARAMS.collections]: c.collections.map((x) => ({ collection: x.key })),
      [BONI_PARAMS.model]: "",
    }),
    step("p-ask", "Preguntar", ASK_TYPE, {
      [ASK_PARAMS.question]: { expr: "¿Dónde va «{{ $json.title }}»?" },
      [ASK_PARAMS.answer]: "one",
      [ASK_PARAMS.options]: [...c.collections.map((x) => x.name), NONE_OPTION],
      [ASK_PARAMS.via]: ["inbox"],
      [ASK_PARAMS.waitDays]: DOUBT_WAIT_DAYS,
      [ASK_PARAMS.mode]: "perRow",
    }),
    step("p-filler", "Rellenadora", "boni.mailFiller", { ...perRow, [BONI_PARAMS.model]: "" }),
    step("p-relations", "Buscar relaciones", "boni.mailRelations", perRow),
    {
      ...step("p-create", "Crear en la elegida", CREATE_CHOSEN, {
        ...perRow,
        [BONI_PARAMS.onlyKnown]: true,
      }),
      connections: c.collections.map((x) => ({
        collection: x.key,
        read: false,
        create: { mode: "ask" },
        update: false,
        remove: false,
      })),
    },
  ];
  const arrow = (from: string, to: string, output = MAIN): Arrow => ({
    from: { step: from, output },
    to: { step: to, input: MAIN },
  });
  const arrows = [
    arrow("trigger", "p-rule"),
    arrow("p-rule", "p-invitation"),
    arrow("p-invitation", "p-reader"),
    arrow("p-reader", "p-fold"),
    arrow("p-fold", "p-decider"),
    arrow("p-decider", "p-filler"),
    arrow("p-decider", "p-ask", BONI_DOUBT),
    arrow("p-ask", "p-filler"),
    arrow("p-filler", "p-relations"),
    arrow("p-relations", "p-create"),
  ];
  return {
    format: FORMAT,
    id: c.id,
    version: 0,
    name: c.name,
    steps,
    arrows,
    // A mail with several things calls its readers more than the default allows: up to the ceiling (AU-17).
    settings: { limits: { modelCalls: 40, ms: 300_000 } },
  };
}
