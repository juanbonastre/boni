/**
 * What the agent's API answers in the conversation tests (apps/server/src/agent.ts): invented values only.
 * `{RTL}` and `{ZW}` stand for a right-to-left override and a zero-width space.
 */
const v = (value: unknown, integrity: string, sensitivity = "public") => ({
  t: "v",
  value,
  integrity,
  sensitivity,
});
export const RTL = String.fromCodePoint(0x202e);
export const ZW = String.fromCodePoint(0x200b);

export const TEXT_REPLY = {
  run: "r1",
  status: "done",
  replies: [
    {
      component: "text",
      data: {
        template: v("Resumen del correo: {a}", "model"),
        a: v(
          'Hola <script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2"> ![x](https://evil.example/p.png?q=1) mira https://evil.example',
          "external",
          "personal",
        ),
      },
    },
    {
      // A list of outside values (summarize_each's items): the mark once, on the block, not on every line; one
      // section per kind; a line with the id and type of its mail (the code's) opens it.
      component: "list",
      data: {
        items: {
          t: "list",
          integrity: "external",
          items: [
            {
              t: "rec",
              integrity: "external",
              fields: {
                line: v("Lucía pregunta si quedamos el jueves", "external", "personal"),
                kind: v("Te piden algo", "external", "personal"),
                id: v("m1", "own"),
                // The type as the planner names it: its key, whose table is t_01m6correo.
                type: v("correo", "own"),
              },
            },
            {
              t: "rec",
              integrity: "external",
              fields: {
                line: v("Una tienda anuncia rebajas", "external", "personal"),
                kind: v("Avisos y publicidad", "external", "personal"),
                id: v("evil", "external", "personal"),
                type: v("Correos", "external", "personal"),
              },
            },
          ],
        },
        fields: v("line", "model"),
        group: v("kind", "model"),
      },
    },
    {
      component: "number",
      data: {
        value: v(42.5, "imported", "sensitive"),
        unit: v("€", "model"),
        caption: v("Gastado este mes", "model"),
      },
    },
  ],
  pending: null,
  proposals: ["p1"],
  notices: [{ code: "proposals", n: 1 }],
  error: null,
};

/**
 * A turn told live in Juan's words (docs/conversacion.md 3.5): the steps as the server sends them while it runs, and
 * its answer, a sentence and a chart of what the tools counted.
 */
export const LIVE_STEPS = [
  { type: "start", run: "r-chart" },
  { type: "planning" },
  { type: "planned", steps: 4 },
  {
    type: "step",
    id: "s",
    op: "call",
    what: "Ver tipos",
    state: "start",
    words: { tool: "schema.describe", args: {} },
  },
  { type: "step", id: "s", op: "call", what: "Ver tipos", state: "done" },
  {
    type: "step",
    id: "n",
    op: "call",
    what: "Calcular",
    state: "start",
    words: {
      tool: "entities.aggregate",
      args: { type: "Tareas", op: "count", field: "Prioridad", equals: "Alta" },
    },
  },
  { type: "step", id: "n", op: "call", what: "Calcular", state: "done", value: 3 },
  {
    type: "step",
    id: "q",
    op: "call",
    what: "Buscar",
    state: "start",
    words: { tool: "entities.search", args: { text: "azulejos", type: "Tareas" } },
  },
  { type: "step", id: "q", op: "call", what: "Buscar", state: "done", n: 1 },
  {
    type: "step",
    id: "h",
    op: "call",
    what: "Calcular",
    state: "start",
    words: {
      tool: "entities.aggregate",
      args: { type: "Tareas", op: "count", field: "Hecha", equals: "false" },
    },
  },
  { type: "step", id: "h", op: "call", what: "Calcular", state: "done", value: 6 },
];
const list = (items: unknown[]) => ({ t: "list", items, integrity: "user" });
export const CHART_REPLY = {
  run: "r-chart",
  status: "done",
  replies: [
    {
      component: "text",
      data: {
        template: v("Tienes {a} tareas sin hacer; la mayoría, de prioridad alta.", "model"),
        a: v(6, "imported"),
      },
    },
    {
      component: "chart",
      data: {
        labels: list([v("Alta", "model"), v("Media", "model"), v("Baja", "model")]),
        values: list([v(3, "imported"), v(2, "imported"), v(1, "imported")]),
        kind: v("bar", "model"),
        caption: v("Tareas por prioridad", "model"),
      },
    },
  ],
  pending: null,
  proposals: [],
  notices: [],
  error: null,
  // It only counted: nothing to undo.
  changed: false,
};

export const confirmTurn = (id: string) => ({
  run: `run-${id}`,
  status: "waiting",
  replies: [],
  pending: {
    kind: "confirm",
    id,
    view: {
      tool: "mail.send",
      title: "Enviar correo",
      rows: [
        {
          arg: "to",
          role: "recipient",
          value: "аna@exámple.com",
          integrity: "imported",
          sources: ["vault"],
          marks: ["mixed-script", "punycode:xn--exmple-qta.com"],
        },
        {
          arg: "subject",
          role: "content",
          value: "Factura",
          integrity: "user",
          sources: ["turn"],
          marks: [],
        },
        {
          arg: "body",
          role: "content",
          value: `pago${RTL}gnp.exe y${ZW}más`,
          integrity: "external",
          sources: ["mail"],
          marks: ["bidi", "invisible"],
        },
      ],
    },
  },
  proposals: [],
  notices: [],
  error: null,
});

export const DONE = {
  run: "run-c1",
  status: "done",
  replies: [{ component: "text", data: { template: v("Hecho.", "model") } }],
  pending: null,
  proposals: [],
  notices: [],
  error: null,
};

/** «¿De dónde viene…?» answered in words and drawn in the conversation (task 92): the reply «run» with a tool's run. */
export const ORIGIN_TURN = {
  run: "run-c9",
  status: "done",
  replies: [
    {
      component: "text",
      data: {
        template: v("«{a}» lo propuso {b} al leer «{c}».", "model"),
        a: v("Preparar la reunión", "external", "personal"),
        b: v("Leer correo", "user"),
        c: v("Reunión con secretaría el jueves", "external", "personal"),
      },
    },
    { component: "run", data: { run: v("run-3", "own") } },
  ],
  pending: null,
  proposals: [],
  notices: [],
  error: null,
};

export const ASK_TURN = {
  run: "r-ask",
  status: "waiting",
  replies: [],
  pending: {
    kind: "ask",
    id: "a1",
    control: "choice",
    prompt: v("¿A cuál de los dos?", "model"),
    options: [
      v("Ana Ejemplo", "imported", "personal"),
      v("Ana Inventada, la del trabajo de los martes por la tarde", "imported", "personal"),
    ],
  },
  proposals: [],
  notices: [],
  error: null,
};

export const STOPPED = {
  run: "r-x",
  status: "stopped",
  replies: [],
  pending: null,
  proposals: [],
  notices: [{ code: "denied", rule: "P2" }],
  error: "P2-untrusted-destination",
};

export const PROPOSALS = {
  proposals: [
    {
      id: "p1",
      tool: "entities.create",
      view: {
        tool: "entities.create",
        title: "Crear",
        rows: [
          {
            arg: "type",
            role: "type",
            value: "tarea",
            integrity: "model",
            sources: ["model"],
            marks: [],
          },
          {
            arg: "values",
            role: "content",
            value: '{"titulo":"Enviar el informe"}',
            integrity: "external",
            sources: ["mail"],
            marks: [],
          },
        ],
      },
      sources: ["mail:m0"],
      created: 1,
    },
    {
      id: "p2",
      tool: "entities.create",
      view: {
        tool: "entities.create",
        title: "Crear",
        rows: [
          {
            arg: "values",
            role: "content",
            value: '{"titulo":"Pagar la cuota"}',
            integrity: "external",
            sources: ["mail"],
            marks: [],
          },
        ],
      },
      sources: ["mail:m1"],
      created: 2,
    },
  ],
};

/** Proposals with the inbox's card (apps/server/src/inboxCard.ts), invented: one detailed, one compact. */
const DAYS = (target: string, around: string[]) => [
  { day: around[0], items: [{ title: "Clase de ejemplo", start: "10:00", end: "11:30" }] },
  {
    day: target,
    items: [
      { title: "Tutoría", start: "09:00", end: "09:30" },
      { title: "Clase de la tarde", start: "16:00", end: "17:00" },
    ],
  },
  { day: around[1], items: [] },
];
export const CARD_DETAILED = {
  id: "c1",
  tool: "entities.create",
  view: {
    tool: "entities.create",
    title: "Crear",
    rows: [
      {
        arg: "type",
        role: "type",
        value: "docencia",
        detail: "Docencia",
        integrity: "model",
        sources: ["model"],
        marks: [],
      },
      {
        arg: "values.title",
        name: "Título",
        role: "content",
        value: "Revisar actas",
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
      {
        arg: "values.date",
        name: "Fecha",
        role: "content",
        value: "2026-10-29",
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
    ],
  },
  sources: ["mail:coordinacion@example.edu"],
  created: 3,
  card: {
    action: "create",
    collection: "Docencia",
    collectionId: "t_docencia",
    kind: "event",
    title: "Revisar actas",
    day: "2026-10-29",
    start: "12:00",
    end: "13:00",
    source: {
      kind: "mail",
      account: "ejemplo@example.edu",
      from: "Coordinación de ejemplo",
      subject: "Actas pendientes",
      excerpt: "Hola, antes del jueves revisad las actas, por favor. Gracias.",
      // The mail's own row (the fake server has books only: any row shows that it opens).
      open: { type: "t_libro", id: "r1" },
    },
    why: { text: "antes del jueves revisad las actas", verbatim: true },
    familiar: 0,
    complete: true,
    mode: "detailed",
    context: DAYS("2026-10-29", ["2026-10-28", "2026-10-30"]),
  },
};
/** What an extension's function would change, waiting in the Bandeja as one proposal (task 93, D-52): every value
 * as text, as `confirmView` paints it. */
const fnRow = (arg: string, value: string, integrity = "own") => ({
  arg,
  role: "content",
  value,
  integrity,
  sources: ["code"],
  marks: [],
});
export const CARD_FUNCTION = {
  id: "c9",
  tool: "function.apply",
  view: {
    tool: "function.apply",
    title: "Aplicar cambios",
    rows: [
      fnRow("cambios.funcion", "banco/importar"),
      fnRow("cambios.resumen", "2 nuevos", "model"),
      fnRow("cambios.nuevas", "2"),
      fnRow("cambios.cambiadas", "0"),
      fnRow("cambios.preguntas", "0"),
    ],
  },
  sources: ["extension:banco/importar"],
  created: 4,
  card: {
    action: "other",
    collection: null,
    collectionId: null,
    kind: "item",
    title: "2 nuevos",
    day: null,
    start: null,
    end: null,
    source: null,
    why: null,
    familiar: 0,
    complete: true,
    mode: "detailed",
    context: [],
  },
};
/**
 * A meeting from mail going to the events (the agenda fixture, `agenda: true`), that took the place of an earlier
 * proposal at another hour (task 46): its kind, day and hours can be corrected (task 47).
 */
export const CARD_EVENT = {
  id: "c7",
  tool: "entities.create",
  view: {
    tool: "entities.create",
    title: "Crear",
    rows: [
      {
        arg: "type",
        role: "type",
        value: "eventos",
        detail: "Eventos",
        integrity: "model",
        sources: ["model"],
        marks: [],
      },
      {
        arg: "values.title",
        name: "Título",
        role: "content",
        value: "Reunión de reconocimiento",
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
      {
        arg: "values.fecha",
        name: "Fecha",
        role: "content",
        value: "2026-10-29",
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
      {
        arg: "values.hora",
        name: "Hora de inicio",
        role: "content",
        value: "17:00",
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
      {
        arg: "values.hora_fin",
        name: "Hora de fin",
        role: "content",
        value: "18:00",
        integrity: "external",
        sources: ["mail"],
        marks: [],
      },
    ],
  },
  sources: ["mail:secretaria@example.edu"],
  created: 4,
  card: {
    ...CARD_DETAILED.card,
    collection: "Eventos",
    collectionId: "t_eventos",
    kind: "event",
    title: "Reunión de reconocimiento",
    day: "2026-10-29",
    start: "17:00",
    end: "18:00",
    before: { day: "2026-10-29", start: "16:00", end: "17:00" },
  },
};
/** The same proposal, going to the books (a collection the fake server has, with its fields): its properties can be corrected. */
export const CARD_BOOK = {
  ...CARD_DETAILED,
  id: "c9",
  created: 5,
  view: {
    ...CARD_DETAILED.view,
    rows: [
      { ...CARD_DETAILED.view.rows[0], value: "libro", detail: "Libros" },
      { ...CARD_DETAILED.view.rows[1], arg: "values.titulo" },
      {
        arg: "values.estado",
        name: "Estado",
        role: "content",
        value: "o_pendiente",
        detail: "Pendiente",
        integrity: "model",
        sources: ["model"],
        marks: [],
      },
    ],
  },
  card: {
    ...CARD_DETAILED.card,
    collection: "Libros",
    collectionId: "t_libro",
    kind: "item",
    day: null,
    start: null,
    end: null,
    context: [],
  },
};
/** A task without a time: Boni suggests the first free hour of its day («¿A las 16:00?»), one tap takes it. */
export const CARD_TIME = {
  ...CARD_DETAILED,
  id: "c6",
  created: 7,
  card: {
    ...CARD_DETAILED.card,
    kind: "task",
    start: null,
    end: null,
    suggestedTime: {
      start: "16:00",
      end: "17:00",
      startKey: "hora",
      endKey: "hora_fin",
      outcome: "ask",
    },
  },
};
/** The same proposal from a mail the fake server keeps (with `mail: true`): «Ver correo» opens it as a mail. */
export const CARD_MAIL = {
  ...CARD_DETAILED,
  id: "c8",
  created: 6,
  card: {
    ...CARD_DETAILED.card,
    source: {
      ...CARD_DETAILED.card.source,
      open: { type: "t_01m6correo", id: "m1" },
      messageId: "m1@example.com",
    },
  },
};
/** A mail card whose sender has no name: its bare address, with no space to break at (the server sends it so). */
export const LONG_SENDER = {
  ...CARD_MAIL,
  id: "c8b",
  card: {
    ...CARD_MAIL.card,
    source: {
      ...CARD_MAIL.card.source,
      from: "notificaciones-automaticas-de-la-coordinacion-del-departamento@example.edu",
    },
  },
};
/** A proposal the calendar already has, as an external calendar's event (task 51): the card says so, «Enlazar». */
export const CARD_LINKED = {
  ...CARD_EVENT,
  id: "c10",
  created: 8,
  card: {
    ...CARD_EVENT.card,
    calendar: {
      already: {
        title: "Reconocimiento",
        start: "12:00",
        end: "13:00",
        calendar: "UCAM",
        external: "ext:ucam:u1",
      },
      overlaps: [{ title: "Clase FUP", start: "12:30", end: "13:30" }],
    },
  },
};
export const CARD_COMPACT = {
  ...CARD_DETAILED,
  id: "c2",
  created: 4,
  card: {
    ...CARD_DETAILED.card,
    title: "Enviar notas",
    start: null,
    end: null,
    kind: "task",
    familiar: 3,
    mode: "compact",
  },
};

/** What run-2 did, as the server tells the Registro (invented). */
export const RUN_2 = {
  id: "run-2",
  status: "stopped:P2-untrusted-destination",
  origin: "turn",
  started: Date.UTC(2026, 9, 20, 9, 5),
  finished: Date.UTC(2026, 9, 20, 9, 5, 4),
  request: "Reenvía el informe a quien me lo pidió",
  steps: [
    {
      id: "s1",
      op: "call",
      what: "entities.search",
      title: "Buscar",
      args: { text: { quote: "informe" } },
      decision: "allow",
      rule: "P1",
      error: null,
      deps: [],
      answers: [],
    },
    {
      id: "s2",
      op: "call",
      what: "mail.send",
      title: "Enviar correo",
      args: { to: { ref: "$s1[0].de" }, body: { lit: "Aquí lo tienes" } },
      decision: "stopped",
      rule: null,
      error: "P2-untrusted-destination",
      deps: ["s1"],
      answers: [],
    },
  ],
  // What it read, changed, proposed and decided, and the models it called («Recorrido», task 52).
  read: [{ collection: "Correos", titles: ["Informe mensual"], n: 1 }],
  changes: [],
  proposals: [],
  decisions: [{ area: "collection", p: 0.6, outcome: "ask", result: null }],
  models: [
    {
      role: "planner",
      provider: "fake",
      model: "m-ejemplo",
      input: 1200,
      output: 80,
      cost: 0.004,
      at: Date.UTC(2026, 9, 20, 9, 5, 1),
    },
  ],
};
/** A reading of a mail by «Leer correo», as its Recorrido says it: what each step did, one skipped (docs/sistema.md §4.4). */
export const RUN_MAIL = {
  ...RUN_2,
  id: "run-3",
  status: "done",
  origin: "background",
  request: null,
  flow: "leer-correo",
  flowVersion: 3,
  inputs: ["mail", "text"],
  // The mail it read, what it proposed and where that went: the way the map draws (docs/sistema.md §4.4).
  input: {
    id: "e_01m6mail0001",
    title: "Reunión con secretaría el jueves",
    collection: "Correos",
    type: "t_01m6correo",
    fields: [{ name: "De", value: "secretaria.ejemplo@example.com" }],
  },
  read: [
    {
      collection: "Correos",
      type: "t_01m6correo",
      titles: ["Reunión con secretaría el jueves"],
      n: 1,
    },
  ],
  // As the Bandeja showed it, the step that made it and the record it became (task 91).
  proposals: [
    {
      id: "p_01m6reunion",
      title: "Preparar la reunión",
      status: "accepted",
      type: "t_01tarea",
      created: 1760954700000,
      decided: 1760958300000,
      rows: [
        { name: "Título", value: "Preparar la reunión" },
        { name: "Fecha", value: "2026-10-23" },
      ],
      step: "n0_tasks",
      record: {
        id: "e_01m6tarea0001",
        title: "Preparar la reunión",
        collection: "Tarea",
        fields: [
          { name: "Fecha", value: "2026-10-23" },
          { name: "Estado", value: "Pendiente" },
        ],
      },
    },
  ],
  // Where the map draws it, as the server says.
  owner: "flow:leer-correo",
  steps: [
    {
      id: "m",
      op: "call",
      what: "entities.get",
      title: "Leer",
      args: {},
      decision: "allow",
      rule: "P1",
      error: null,
      deps: [],
      uses: ["mail"],
      answers: [],
    },
    {
      id: "r",
      op: "read",
      what: "read_message",
      args: {},
      decision: "allow",
      rule: "P1",
      error: null,
      deps: [],
      uses: ["text"],
      answers: [],
      // What it gave the next step, and its call in this run (task 91).
      calls: 1,
      cost: 0.0021,
      // As the step keeps it: the reading for Juan by its kinds of thing.
      output: {
        tasks: [
          {
            title: "Preparar la reunión",
            due: "2026-10-23",
            start: null,
            end: null,
            quote: "¿Puedes prepararla?",
          },
        ],
        events: [],
      },
    },
    {
      id: "n0_tasks_f",
      op: "read",
      what: "fill",
      args: {},
      decision: "skip",
      rule: null,
      error: null,
      deps: ["r"],
      uses: [],
      answers: [],
    },
    {
      id: "n0_tasks",
      op: "call",
      what: "entities.create",
      title: "Crear",
      args: {},
      decision: "propose",
      rule: "P7",
      error: null,
      deps: ["r"],
      uses: [],
      answers: [],
    },
  ],
};
export const RUNS = {
  runs: [
    {
      id: "run-1",
      origin: "turn",
      device: "portatil",
      status: "done",
      started: Date.UTC(2026, 9, 20, 9, 0),
      finished: Date.UTC(2026, 9, 20, 9, 0),
    },
    {
      id: "run-2",
      origin: "turn",
      device: "portatil",
      status: "stopped:P2-untrusted-destination",
      started: Date.UTC(2026, 9, 20, 9, 5),
      finished: null,
    },
  ],
};

/** The Registro as the server describes each run (runInfo.ts): invented mail, notes and requests. */
const at = (h: number, m: number) => Date.UTC(2026, 9, 23, h, m);
const quietMail = (id: string, m: number, subject: string) => ({
  id,
  origin: "background",
  device: null,
  status: "done",
  started: at(10, m),
  finished: at(10, m),
  what: { kind: "mail", subject, from: "Boletín de ejemplo", account: "ejemplo@example.edu" },
  proposals: { pending: 0, accepted: 0, rejected: 0, postponed: 0, stale: 0 },
  changes: [],
  changed: 0,
});
/** Boni's decisions counted per area (docs/fiabilidad.md): the Registro's «Acierto» and Settings «Decisiones». */
const EARNS_WITH = { decisions: 20, accuracy: 0.95 };
const NO_SWITCH = {
  cost: "A",
  switchable: false,
  auto: false,
  autoBy: null,
  autoAt: null,
  earned: false,
  earnsWith: EARNS_WITH,
};
export const ACCURACY = {
  learning: true,
  areas: [
    {
      ...NO_SWITCH,
      area: "choice",
      total: 24,
      done: 20,
      asked: 4,
      nothing: 0,
      judged: 20,
      right: 19,
      levels: [
        { from: 0, to: 0.5, judged: 0, right: 0 },
        { from: 0.5, to: 0.6, judged: 0, right: 0 },
        { from: 0.6, to: 0.7, judged: 2, right: 1 },
        { from: 0.7, to: 0.8, judged: 3, right: 3 },
        { from: 0.8, to: 0.9, judged: 5, right: 5 },
        { from: 0.9, to: 1, judged: 10, right: 10 },
      ],
    },
    {
      ...NO_SWITCH,
      area: "fill",
      total: 6,
      done: 2,
      asked: 0,
      nothing: 4,
      judged: 0,
      right: 0,
      levels: [],
    },
    // Accepting a mail's proposals alone: judged by the rule replayed over Juan's decisions; earned, still off.
    {
      area: "mail.accept",
      cost: "B",
      total: 24,
      done: 0,
      asked: 24,
      nothing: 0,
      judged: 20,
      right: 20,
      levels: [],
      switchable: true,
      auto: false,
      autoBy: null,
      autoAt: null,
      earned: true,
      earnsWith: EARNS_WITH,
    },
  ],
};
/** The same once Juan turned «Solo» on for the mail's proposals. */
export const ACCURACY_ON = {
  learning: true,
  areas: ACCURACY.areas.map((a) =>
    a.area === "mail.accept" ? { ...a, auto: true, autoBy: "juan", autoAt: 1_762_000_000_000 } : a,
  ),
};

export const RUNS_EXPLAINED = {
  runs: [
    {
      id: "run-a",
      origin: "turn",
      device: "portatil",
      status: "done",
      started: at(11, 0),
      finished: at(11, 0),
      what: { kind: "request", text: "Apunta una tarea: llamar al taller el lunes" },
      proposals: { pending: 0, accepted: 0, rejected: 0, postponed: 0, stale: 0 },
      changes: [
        { action: "create", title: "Llamar al taller", collection: "Tareas", undone: false },
      ],
      changed: 1,
    },
    {
      id: "run-b",
      origin: "background",
      device: null,
      status: "done",
      started: at(10, 50),
      finished: at(10, 50),
      what: {
        kind: "mail",
        subject:
          "<b>Actas</b> de la reunión inventada del departamento con un asunto muy largo que no cabe",
        from: "Coordinación de ejemplo",
        account: "ejemplo@example.edu",
      },
      proposals: { pending: 1, accepted: 1, rejected: 0, postponed: 0, stale: 0 },
      changes: [],
      changed: 0,
    },
    quietMail("run-c", 40, "Boletín semanal inventado"),
    quietMail("run-d", 30, "Oferta inventada"),
    quietMail("run-e", 20, "Recordatorio inventado"),
    {
      id: "run-f",
      origin: "mirror",
      device: null,
      status: "proposed",
      started: at(10, 10),
      finished: at(10, 10),
      what: { kind: "other" },
      proposals: { pending: 0, accepted: 0, rejected: 1, postponed: 0, stale: 0 },
      changes: [],
      changed: 0,
    },
    {
      id: "run-g",
      origin: "accepted",
      device: null,
      status: "done",
      started: at(10, 0),
      finished: at(10, 0),
      what: { kind: "accepted" },
      proposals: { pending: 0, accepted: 0, rejected: 0, postponed: 0, stale: 0 },
      changes: [{ action: "create", title: "Revisar actas", collection: "Docencia", undone: true }],
      changed: 1,
    },
  ],
};

/** What the models may see, per collection (invented collections). */
export const VISIBILITY = {
  types: [
    { id: "t_diario", name: "Diario", level: "restricted", count: 31 },
    { id: "t_movimiento", name: "Movimientos", level: "opaque", count: 553 },
    { id: "t_proyecto", name: "Proyectos", level: "visible", count: 82 },
  ],
};

/** The account's mailbox as the server shows it (invented). */
export const MAIL = {
  mail: {
    host: "imap.gmail.com",
    port: 993,
    user: "ejemplo@example.com",
    folder: "INBOX",
    collections: ["t_proyecto"],
    on: true,
    configured: true,
    state: {
      type: "t_01m6correo",
      lastCheck: Date.UTC(2026, 9, 20, 10, 5),
      lastError: null,
      count: 12,
      uidValidity: 7,
      lastUid: 40,
    },
  },
};

/** Juan's reading guide (invented): his words, one rule of each kind, one example from a decision. */
export const GUIDE = {
  guide: {
    instructions:
      "Los avisos de la plataforma de cursos solo me interesan si un alumno pregunta algo.",
    rules: [
      { id: "r1", from: "@lista.example.com", action: "skip" },
      {
        id: "r2",
        from: "coordinacion@example.com",
        action: "collection",
        collection: "t_proyecto",
      },
    ],
    examples: [
      {
        id: "x1",
        subject: "Entrevista del jueves",
        from: "lucia@example.com",
        want: [{ title: "Confirmar la sala a Lucía" }],
      },
    ],
  },
};

/** The mailbox with a suggestion of the reviewer waiting (invented). */
export const MAIL_SUGGESTED = {
  mail: {
    ...MAIL.mail,
    state: {
      ...MAIL.mail.state,
      suggestion: {
        id: "g-1",
        rules: [{ id: "s-@boletines.example.com", from: "@boletines.example.com", action: "skip" }],
        examples: [
          {
            id: "x-e1",
            subject: "Feria de empleo",
            from: "info@boletines.example.com",
            mail: "…",
            want: [],
          },
        ],
        before: 31,
        after: 37,
        total: 40,
        at: Date.UTC(2026, 9, 21, 9),
      },
    },
  },
};

/** The installed extensions (invented: the mail preset and one Juan changed). */
/** A version of an extension proposed through the MCP, as the server shows its card (apps/server/src/proposals.ts). */
export const EXTENSION_PROPOSALS = {
  proposals: [
    {
      id: "banco",
      name: "Banco ING",
      description: "Lee los extractos de ING que subes y propone los movimientos nuevos.",
      version: 2,
      active: 1,
      by: "mcp:claude-ejemplo",
      at: Date.UTC(2026, 9, 30, 17, 20),
      more: {
        code: ["importar"],
        reads: [{ collection: "Movimiento", fields: ["fecha", "importe"] }],
        writes: [{ collection: "Movimiento", fields: ["concepto"] }],
        creates: ["Movimiento"],
        updates: [],
        asks: true,
        other: [],
      },
      privateReads: [],
      report: {
        tests: [{ function: "importar", name: "dos líneas dan dos movimientos", ok: true }],
        dryRuns: [
          {
            function: "importar",
            ok: true,
            creates: { Movimiento: 18 },
            updates: 0,
            asks: ["¿Es la cena?"],
          },
        ],
      },
      functions: [
        {
          name: "importar",
          hash: "3f9a".padEnd(61, "0") + "c21",
          code: "function importar(input) {\n  return { changes: [] };\n}",
        },
      ],
    },
  ],
};

export const EXTENSIONS = {
  extensions: [
    {
      id: "correo",
      name: "Correo",
      description:
        "Trae el correo de tu buzón (solo lectura) y propone las tareas y citas que te pide, en la colección que elige la IA entre las que marcas.",
      version: 1,
      preset: 1,
      enabled: true,
      needs: { reads: ["Correos"], proposes: true, budget: { readersPerDay: 150 } },
      sources: ["imap"],
      modules: ["tasks", "events"],
    },
    {
      id: "plazos",
      name: "Plazos de los documentos",
      description: "Busca fechas de entrega en tus documentos.",
      version: 3,
      preset: null,
      enabled: false,
      needs: { reads: ["Documentos"], proposes: true },
      sources: [],
      modules: ["deadlines"],
    },
  ],
};

/** Questions from background work (the panel of requests, Juan 2026-10-24), around CARD_COMPACT (created 4). */
const ask = (
  id: string,
  created: number,
  prompt: unknown,
  options: unknown[] | null,
  about: unknown = null,
) => ({
  id,
  run: `run-${id}`,
  view: {
    kind: "ask",
    id,
    control: options ? "choice" : "text",
    prompt,
    options: options ?? [],
  },
  created,
  expires: Date.now() + 7 * 24 * 60 * 60_000 - 60_000,
  about,
  open: about ? { type: "t_01m6correo", id: "e_correo1" } : null,
});
export const REQUESTS = {
  requests: [
    ask(
      "q1",
      3,
      v("¿A qué colección va «Entrega de actas»?", "model"),
      [v("Docencia", "user"), v("Gestiones", "user")],
      {
        kind: "mail",
        subject: "Entrega de actas del segundo parcial",
        from: "Secretaría de ejemplo",
        account: "ejemplo@example.edu",
      },
    ),
    ask("q2", 5, v("¿Qué compraste en la tienda de ejemplo el día 12 (34,99 €)?", "model"), null),
    ask("q3", 6, v("¿Es la misma persona que «Ana E.»?", "model"), [
      v("Sí", "user"),
      v("No", "user"),
    ]),
    ask("q4", 7, v("¿Va a Docencia?", "model"), [v("Sí", "user"), v("No", "user")]),
  ],
};
export const ANSWER_GONE = {
  run: "run-q4",
  status: "stopped",
  replies: [],
  pending: null,
  proposals: [],
  notices: [],
  error: "nothing-pending",
};

/** «Modelos» (apps/server/src/models.ts `view`): invented spending, keys never in it. */
const choice = (connection: string, model: string, zdr = false) => ({ connection, model, zdr });
const evaluation = (role: string, c: ReturnType<typeof choice>, right: number, total: number) => ({
  ...c,
  role,
  at: Date.UTC(2026, 9, 24, 9),
  right,
  total,
  wrong: total - right,
  cost: 0.012,
  cases: Array.from({ length: total }, (_, i) => ({
    name: `Caso inventado ${i + 1}: «Reunión de ejemplo»`,
    ok: i < right,
    note: i < right ? "" : "puso la tarea en la colección equivocada",
  })),
});
const READER = choice("openrouter", "deepseek/deepseek-v4.1-flash", true);
export const MODELS = {
  roles: [
    {
      ...choice("anthropic", "claude-opus-5-5"),
      role: "planner",
      privacy: "deletes-in-30-days",
      chosen: false,
      missingKey: false,
    },
    { ...READER, role: "reader", privacy: "keeps-nothing", chosen: true, missingKey: false },
    {
      ...choice("openrouter", "typesafe/jev-1.14"),
      role: "decider",
      privacy: "may-keep",
      chosen: false,
      missingKey: false,
    },
    {
      ...choice("anthropic", "claude-haiku-4-5"),
      role: "reviewer",
      privacy: "deletes-in-30-days",
      chosen: false,
      missingKey: false,
    },
  ],
  connections: [
    { connection: "openrouter", mine: true, server: true },
    { connection: "anthropic", mine: false, server: true },
    { connection: "typesafe", mine: false, server: false },
  ],
  budget: { monthlyEur: 10, warnAt: 0.8 },
  usdToEur: 0.9,
  spending: {
    month: "2026-10",
    eur: 3.42,
    rows: [
      {
        role: "planner",
        provider: "anthropic",
        model: "claude-opus-5-5",
        calls: 41,
        eur: 2.61,
        unpriced: 0,
      },
      {
        role: "reader",
        provider: "openrouter",
        model: "deepseek/deepseek-v4.1-flash",
        calls: 512,
        eur: 0.74,
        unpriced: 3,
      },
      {
        role: "eval-reader",
        provider: "openrouter",
        model: "deepseek/deepseek-v4.1-flash",
        calls: 1,
        eur: 0.07,
        unpriced: 0,
      },
    ],
    byDay: Array.from({ length: 24 }, (_, i) => {
      const opus = ((i * 7) % 11) / 40;
      const deepseek = ((i * 5) % 7) / 200;
      return {
        day: `2026-10-${String(i + 1).padStart(2, "0")}`,
        eur: opus + deepseek,
        byModel: { "claude-opus-5-5": opus, "deepseek/deepseek-v4.1-flash": deepseek },
      };
    }),
  },
  over: false,
  evaluations: [
    evaluation("reader", READER, 19, 20),
    evaluation("planner", choice("anthropic", "claude-opus-5-5"), 8, 8),
  ],
  evaluating: null,
};
const GLM = choice("openrouter", "z-ai/glm-5.2", true);
export const MODELS_EVALUATING = { ...MODELS, evaluating: { ...GLM, role: "planner" } };
export const MODELS_EVALUATED = {
  ...MODELS,
  evaluations: [evaluation("planner", GLM, 7, 8), ...MODELS.evaluations],
};
export const MODELS_USED = {
  ...MODELS_EVALUATED,
  roles: MODELS.roles.map((r) =>
    r.role === "planner" ? { ...r, ...GLM, privacy: "keeps-nothing", chosen: true } : r,
  ),
};
export const MODELS_CATALOGUE = {
  models: [
    {
      id: "z-ai/glm-5.2",
      name: "Z.ai: GLM 5.2",
      input: 0.6,
      output: 2.2,
      context: 200000,
      providers: ["A", "B", "C"],
      structured: true,
    },
    {
      id: "deepseek/deepseek-v4.1-flash",
      name: "DeepSeek: V4.1 Flash",
      input: 0.1,
      output: 0.4,
      context: 128000,
      providers: ["A"],
      structured: true,
    },
    {
      id: "anthropic/claude-opus-5.5",
      name: "Anthropic: Claude Opus 5.5",
      input: 4,
      output: 20,
      context: 1000000,
      providers: ["Amazon Bedrock", "Google"],
      structured: true,
    },
    {
      id: "ejemplo/sin-esquema",
      name: "Ejemplo: sin esquema",
      input: 0.05,
      output: 0.1,
      context: 32000,
      providers: ["A"],
      structured: false,
    },
  ],
};
/** The longest things a real account may show: long model ids, many rows, an exhausted budget. */
const LONG =
  "proveedor-de-ejemplo-con-nombre-largo/modelo-experimental-de-razonamiento-extendido-v12.3-instruct-preview";
export const MODELS_WORST = {
  ...MODELS,
  roles: MODELS.roles.map((r) => ({
    ...r,
    model: LONG,
    connection: "openrouter",
    missingKey: true,
    chosen: true,
  })),
  budget: { monthlyEur: 1234.56, warnAt: 0.8 },
  spending: {
    ...MODELS.spending,
    eur: 1299.99,
    rows: Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? "eval-reviewer" : "planner",
      provider: "openrouter",
      model: `${LONG}-${i}`,
      calls: 12345,
      eur: 123.45,
      unpriced: 1,
    })),
    byDay: Array.from({ length: 31 }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      eur: i,
    })),
  },
  over: true,
  evaluations: MODELS.roles.map((r) => ({
    ...evaluation(r.role, choice("openrouter", LONG), 1, 3),
    cases: Array.from({ length: 3 }, (_, i) => ({
      name: `Un caso inventado con un título muy largo que no cabe en una línea ${i} «Electrodomésticos Hernández-Martínez e Hijos, Sociedad Limitada»`,
      ok: i === 0,
      note: "una nota igual de larga sobre lo que salió mal en este caso y por qué",
    })),
  })),
};
export const MODELS_CATALOGUE_WORST = {
  models: Array.from({ length: 30 }, (_, i) => ({
    id: `${LONG}-${i}`,
    name: `Proveedor de ejemplo: Modelo experimental de razonamiento extendido ${i} (versión preliminar)`,
    input: 123.45,
    output: 1234.56,
    context: 1000000,
    providers: Array.from({ length: 30 }, (_, j) => `P${j}`),
    structured: true,
  })),
};

/** The audit's numbers for a month (apps/server/src/audit.ts `auditSummary`), invented. */
const ACTORS = [
  "model:reader:openrouter/deepseek/deepseek-v4.1-flash",
  "model:planner:anthropic/claude-opus-5-5",
  "mcp:claude-ejemplo",
  "agent",
  "user:portatil",
];
export const AUDIT_SUMMARY = {
  from: Date.UTC(2026, 9, 1),
  to: Date.UTC(2026, 9, 24, 12),
  activity: Array.from({ length: 24 }, (_, i) => i).flatMap((i) =>
    ACTORS.map((by, k) => ({
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      by,
      reads: ((i + 3) * (k + 2)) % 17,
      writes: k === 0 ? 0 : ((i + k) * 3) % 4,
    })),
  ),
  byType: [
    { type: "t_01m6correo", name: "Correos", by: ACTORS[0], reads: 412, writes: 0 },
    { type: "t_docencia", name: "Docencia", by: ACTORS[0], reads: 310, writes: 0 },
    { type: "t_docencia", name: "Docencia", by: ACTORS[3], reads: 20, writes: 38 },
    { type: "t_gestiones", name: "Gestiones", by: ACTORS[2], reads: 180, writes: 27 },
    { type: "t_nota", name: "Nota", by: ACTORS[2], reads: 96, writes: 6 },
    { type: "t_mov", name: "Movimiento", by: ACTORS[4], reads: 140, writes: 12 },
  ],
  totals: {
    reads: 1158,
    writes: 87,
    kinds: { create: 61, update: 22, delete: 4 },
    undone: 12,
    proposals: 138,
    accepted: 112,
    requests: 34,
    readings: 412,
  },
};

/** A page of the audit (apps/server/src/audit.ts `auditActions`), invented. */
const seenOf = (entity: string, type: string, fields: string[], body: "text" | null = null) => ({
  entity,
  type,
  version: 1,
  fields,
  shapes: [],
  body,
  files: [],
});
export const AUDIT_ACTIONS = {
  actions: [
    {
      seq: 9,
      at: Date.UTC(2026, 9, 24, 10, 41),
      by: "model:reader:openrouter/deepseek/deepseek-v4.1-flash",
      run: "r1",
      tool: "model.reader",
      target: null,
      decision: "allow",
      rule: null,
      call: 3,
      result: { input: 1200, output: 80 },
      seen: [
        seenOf("e_c1", "t_01m6correo", ["f_asunto", "f_de"], "text"),
        seenOf("e_g1", "t_gestiones", ["f_titulo"]),
        seenOf("e_g2", "t_gestiones", ["f_titulo"]),
      ],
      wrote: [],
    },
    {
      seq: 8,
      at: Date.UTC(2026, 9, 24, 10, 40),
      by: "mcp:claude-ejemplo",
      run: "mcp-1",
      tool: "mcp.search",
      target: { query: "dentista", collection: "Salud" },
      decision: "allow",
      rule: null,
      call: null,
      result: null,
      seen: [
        seenOf("e_s1", "t_salud", ["f_titulo", "f_fecha"]),
        seenOf("e_s2", "t_salud", ["f_titulo"]),
      ],
      wrote: [],
    },
    {
      seq: 7,
      at: Date.UTC(2026, 9, 24, 10, 38),
      by: "mcp:claude-ejemplo",
      run: "mcp-2",
      tool: "mcp.append",
      target: { path: "proyectos/plan-ejemplo.md" },
      decision: "allow",
      rule: null,
      call: null,
      result: null,
      seen: [],
      wrote: [{ kind: "update", target: "e_p1" }],
    },
    {
      seq: 6,
      at: Date.UTC(2026, 9, 24, 10, 30),
      by: "model:planner:anthropic/claude-opus-5-5",
      run: "r2",
      tool: "model.planner",
      target: null,
      decision: "allow",
      rule: null,
      call: 2,
      result: null,
      seen: [],
      wrote: [],
    },
    {
      seq: 5,
      at: Date.UTC(2026, 9, 24, 10, 30),
      by: "agent",
      run: "r2",
      tool: "net.fetch",
      target: { url: "https://example.com/agenda" },
      decision: "allow",
      rule: null,
      call: null,
      result: null,
      seen: [],
      wrote: [],
    },
    {
      seq: 4,
      at: Date.UTC(2026, 9, 24, 9, 2),
      by: "user:portatil",
      run: null,
      tool: "data.row",
      target: { collection: "t_diario" },
      decision: "allow",
      rule: null,
      call: null,
      result: { rows: 1 },
      seen: [seenOf("e_d1", "t_diario", ["f_titulo"], "text")],
      wrote: [],
    },
    {
      seq: 3,
      at: Date.UTC(2026, 9, 24, 9, 0),
      by: "agent",
      run: "r3",
      tool: "entities.update",
      target: null,
      decision: "deny",
      rule: "P3",
      call: null,
      result: { reason: "external-control" },
      seen: [],
      wrote: [],
    },
  ],
  names: {
    types: {
      t_01m6correo: "Correos",
      t_gestiones: "Gestiones",
      t_salud: "Salud",
      t_diario: "Diario",
      t_nota: "Nota",
    },
    fields: { f_asunto: "Asunto", f_de: "De", f_titulo: "Título", f_fecha: "Fecha" },
    titles: {
      e_c1: "Entrega de actas",
      e_g1: "Renovar el DNI",
      e_g2: "Pedir cita",
      e_s1: "Cita dentista 3 nov",
      e_s2: "Revisión anual",
      e_p1: "Plan de ejemplo",
      e_d1: "24 de octubre",
    },
  },
};
export const AUDIT_DETAIL = {
  action: AUDIT_ACTIONS.actions[0],
  names: AUDIT_ACTIONS.names,
  call: {
    role: "reader",
    model: "deepseek/deepseek-v4.1-flash",
    request: {},
    response: {
      items: [{ quote: "¿Me envías las actas?", kind: "task", title: "Enviar las actas" }],
    },
  },
  ops: [],
};

/** The longest names an account may show in «Actividad» and «Auditoría». */
const LONG_COLLECTION =
  "Colección de ejemplo con un nombre larguísimo que no cabe en ninguna parte";
export const AUDIT_SUMMARY_WORST = {
  ...AUDIT_SUMMARY,
  activity: AUDIT_SUMMARY.activity.map((r) => ({
    ...r,
    by: r.by.startsWith("model:")
      ? `${r.by}-${"x".repeat(60)}`
      : r.by.startsWith("mcp:")
        ? `mcp:${"dispositivo-".repeat(8)}`
        : r.by,
    reads: r.reads * 12345,
    writes: r.writes * 1234,
  })),
  byType: Array.from({ length: 14 }, (_, i) => ({
    type: `t_${i}`,
    name: `${LONG_COLLECTION} ${i}`,
    by: "agent",
    reads: 123456 - i * 1000,
    writes: 12345 - i * 100,
  })),
  totals: {
    ...AUDIT_SUMMARY.totals,
    reads: 123456789,
    writes: 1234567,
    readings: 1234567,
    proposals: 99999,
    accepted: 88888,
    requests: 123456,
    undone: 12345,
  },
};
export const AUDIT_ACTIONS_WORST = {
  actions: AUDIT_ACTIONS.actions.map((a) => ({
    ...a,
    by: a.by.startsWith("model:") ? `${a.by}-${"x".repeat(60)}` : a.by,
    target: a.target
      ? Object.fromEntries(
          Object.entries(a.target).map(([k, v]) => [k, `${v} ${"palabra ".repeat(30)}`]),
        )
      : null,
    seen: Array.from({ length: 60 }, (_, i) => ({
      entity: `e_${i}`,
      type: "t_long",
      version: 1,
      fields: ["f_a", "f_b", "f_c"],
      shapes: ["f_d"],
      body: i % 2 ? "text" : null,
      files: [],
    })),
  })),
  names: {
    types: { t_long: LONG_COLLECTION },
    fields: {
      f_a: "Una propiedad con un nombre larguísimo",
      f_b: "Otra propiedad igual de larga",
      f_c: "Y otra",
      f_d: "La de la forma",
    },
    titles: Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `e_${i}`,
        `Un registro con un título muy largo «Electrodomésticos Hernández-Martínez e Hijos, Sociedad Limitada» ${i}`,
      ]),
    ),
  },
};
export const AUDIT_DETAIL_WORST = {
  action: AUDIT_ACTIONS_WORST.actions[0],
  names: AUDIT_ACTIONS_WORST.names,
  call: {
    role: "reader",
    model: "x",
    request: {},
    response: { text: "una respuesta muy larga ".repeat(200) },
  },
  ops: [],
};

/** A row's history (apps/server/src/audit.ts `auditRow`), invented. */
export const ROW_HISTORY = {
  columns: {
    created: Date.UTC(2026, 9, 15, 9),
    updated: Date.UTC(2026, 9, 24, 10, 38),
    version: 4,
    createdBy: "user:portatil",
    updatedBy: "mcp:claude-ejemplo",
    editors: [
      "user:portatil",
      "mcp:claude-ejemplo",
      "model:reader:openrouter/deepseek/deepseek-v4.1-flash",
    ],
    viewers: ["mcp:claude-ejemplo", "model:planner:anthropic/claude-opus-5-5"],
    seenAt: Date.UTC(2026, 9, 24, 10, 40),
    origin: "model",
    size: 2345,
  },
  seenBy: [
    {
      action: 9,
      at: Date.UTC(2026, 9, 24, 10, 40),
      by: "mcp:claude-ejemplo",
      tool: "mcp.read",
      entity: "e_p1",
      type: "t_proyecto",
      version: 4,
      fields: ["f_titulo", "f_estado"],
      shapes: [],
      body: "text",
      files: [],
    },
    {
      action: 6,
      at: Date.UTC(2026, 9, 23, 18, 0),
      by: "model:planner:anthropic/claude-opus-5-5",
      tool: "model.planner",
      entity: "e_p1",
      type: "t_proyecto",
      version: 3,
      fields: ["f_titulo"],
      shapes: [],
      body: null,
      files: [],
    },
  ],
  changes: [
    {
      seq: 1,
      at: Date.UTC(2026, 9, 15, 9),
      kind: "create",
      by: "user:portatil",
      fields: ["f_titulo", "f_estado"],
      body: true,
    },
    {
      seq: 5,
      at: Date.UTC(2026, 9, 23, 18, 1),
      kind: "update",
      by: "model:reader:openrouter/deepseek/deepseek-v4.1-flash",
      fields: [],
      body: true,
    },
    {
      seq: 8,
      at: Date.UTC(2026, 9, 24, 10, 38),
      kind: "update",
      by: "mcp:claude-ejemplo",
      fields: [],
      body: true,
    },
  ],
  blame: [
    { text: "# Plan de ejemplo", by: "user:portatil", at: 1, seq: 1 },
    { text: "Boni es el núcleo: un servidor, una cuenta.", by: "user:portatil", at: 1, seq: 1 },
    {
      text: "Propuesta del correo: revisar el presupuesto.",
      by: "model:reader:openrouter/deepseek/deepseek-v4.1-flash",
      at: 5,
      seq: 5,
    },
    { text: "- 24 oct: «Modelos» desplegado.", by: "mcp:claude-ejemplo", at: 8, seq: 8 },
  ],
  names: {
    types: { t_proyecto: "Proyecto" },
    fields: { f_titulo: "Título", f_estado: "Estado" },
    titles: { e_p1: "Plan de ejemplo" },
  },
};
export const STORAGE = {
  types: [
    { type: "t_libro", name: "Libros", rows: 3, bytes: 4200, history: 9100 },
    { type: "t_proyecto", name: "Proyecto", rows: 82, bytes: 820_000, history: 2_400_000 },
  ],
  modelCalls: { rows: 1200, bytes: 130_000_000 },
  audit: { actions: 900, access: 4000, bytes: 450_000 },
  total: 420_000_000,
  advice: [{ code: "model-texts", bytes: 130_000_000 }],
};

export const FLOWS = {
  flows: [
    {
      id: "leer-correo",
      name: "Leer correo",
      version: 3,
      trigger: { created: "correo" },
      by: "preset",
      enabled: true,
      steps: 5,
      runs: 42,
      last: 1761900000000,
    },
  ],
};
const flowStep = (
  id: string,
  op: string,
  what: string,
  o: Partial<{
    title: string;
    detail: string;
    when: boolean;
    each: boolean;
    args: string[];
    deps: string[];
    ran: Record<string, number>;
    into: string[];
    calls: number;
    cost: number;
  }> = {},
) => ({
  id,
  op,
  what,
  title: null,
  detail: null,
  when: false,
  each: false,
  args: [],
  deps: [],
  ran: {},
  ...o,
});
/** «Leer correo» as kept data (docs/flujos.md): its plan (one collection, Docencia), what the editor changes. */
export const FLOW_PLAN = {
  version: 1,
  steps: [
    { id: "m", op: "call", tool: "entities.get", args: { id: { ref: "$mail" } } },
    {
      id: "r",
      op: "read",
      reader: "read_message",
      input: { ref: "$text" },
      params: {
        modules: { ref: "$modules" },
        user_in: { ref: "$userIn" },
        known: { ref: "$known" },
        guide: { ref: "$guide" },
      },
    },
    {
      id: "n0_tasks_f",
      op: "read",
      reader: "fill",
      each: { ref: "$r.tasks" },
      input: {
        fn: "concat",
        args: [{ ref: "$text" }, { lit: "\n\nElemento: " }, { ref: "$item.title" }],
      },
      params: { fields: { ref: "$fill.docencia" } },
    },
    {
      id: "n0_tasks",
      op: "call",
      tool: "entities.create",
      each: { ref: "$r.tasks" },
      zip: { ref: "$n0_tasks_f" },
      why: { ref: "$item.quote" },
      args: {
        type: { lit: "docencia" },
        values: {
          fn: "merge",
          args: [
            { ref: "$prefill.docencia" },
            { ref: "$zip.values" },
            {
              fn: "obj",
              args: [
                { lit: "title" },
                { ref: "$item.title" },
                { lit: "fecha" },
                { ref: "$item.due" },
                { lit: "body" },
                { ref: "$zip.note" },
              ],
            },
          ],
        },
      },
    },
  ],
};
export const FLOW_DETAIL = {
  ...FLOWS.flows[0],
  inputs: [
    { id: "mail", what: "record" },
    { id: "text", what: "text" },
    { id: "modules", what: "modules" },
    { id: "userIn", what: "value" },
    { id: "known", what: "list" },
    { id: "guide", what: "guide" },
    { id: "fill", what: "fields" },
    { id: "prefill", what: "relations" },
  ],
  nodes: [
    flowStep("m", "call", "entities.get", {
      title: "Leer",
      args: ["id: $mail"],
      deps: ["mail"],
      ran: { allow: 42 },
    }),
    flowStep("r", "read", "read_message", {
      args: ["input: $text"],
      deps: ["text", "modules", "userIn", "known", "guide"],
      ran: { allow: 42 },
      calls: 42,
      cost: 0.21,
    }),
    flowStep("n0_tasks_f", "read", "fill", {
      each: true,
      deps: ["text", "r", "fill"],
      ran: { allow: 12 },
    }),
    flowStep("n0_tasks", "call", "entities.create", {
      title: "Crear",
      detail: "Docencia",
      each: true,
      deps: ["r", "n0_tasks_f", "prefill"],
      ran: { propose: 12 },
    }),
  ],
  days: 7,
  versions: [
    { version: 3, by: "preset", created: 1761800000000 },
    { version: 2, by: "preset", created: 1761300000000 },
    { version: 1, by: "preset", created: 1760300000000 },
  ],
  plan: FLOW_PLAN,
  layout: null,
  preset: 3,
};

/** «Leer correo» creating in the chosen collection (docs/sistema.md §4.2): one «Rellenadora» and one «Crear» for
 * everything the reader found (`$r.all`), the collection from `case` over the decider's choice, as `mailPlan` writes
 * it with the collections given (each option the decider reads and its collection's key); the decider asks when
 * unsure and takes a rule of the guide as its answer (`given`). */
const chosenPlan = (options: [string, string][]) => {
  const chosenKey = {
    fn: "case",
    args: [{ ref: "$c.choice" }, ...options.flatMap(([o, k]) => [{ lit: o }, { lit: k }])],
  };
  const mail = { ref: "$mail" };
  return {
    version: 1,
    steps: [
      FLOW_PLAN.steps[0],
      // Boni's pieces, as `mailPlan` writes them (docs/sistema.md §4.2): the sender's rule first.
      { id: "only", op: "call", tool: "mail.rule", args: { mail } },
      FLOW_PLAN.steps[1],
      {
        id: "c",
        op: "read",
        reader: "classify",
        input: { ref: "$text" },
        params: {
          options: { ref: "$options" },
          ask: { lit: "¿A qué colección va este correo?" },
          given: { ref: "$only" },
        },
        when: { ref: "$r.all" },
      },
      {
        id: "n_f",
        op: "read",
        reader: "fill",
        each: { ref: "$r.all" },
        when: { ref: "$c.choice" },
        input: {
          fn: "concat",
          args: [{ ref: "$text" }, { lit: "\n\nElemento: " }, { ref: "$item.title" }],
        },
        params: { fields: { ref: "$fill" }, collection: chosenKey },
      },
      {
        id: "n",
        op: "call",
        tool: "entities.create",
        each: { ref: "$r.all" },
        zip: { ref: "$n_f" },
        when: { ref: "$c.choice" },
        why: { ref: "$item.quote" },
        args: {
          type: chosenKey,
          values: {
            fn: "merge",
            args: [
              { fn: "pick", args: [{ ref: "$prefill" }, chosenKey] },
              { ref: "$zip.values" },
              {
                fn: "obj",
                args: [
                  { lit: "title" },
                  { ref: "$item.title" },
                  { lit: "body" },
                  { ref: "$zip.note" },
                ],
              },
            ],
          },
        },
      },
      // One thread, one proposal, over the days its setting says; then «Aceptar solas».
      { id: "fold", op: "call", tool: "inbox.fold", args: { mail, days: { lit: 60 } } },
      { id: "alone", op: "call", tool: "inbox.accept_alone", args: {} },
    ],
  };
};
export const FLOW_PLAN_CHOSEN = chosenPlan([
  ["Docencia (p. ej.: Corregir exámenes)", "docencia"],
  ["Gestiones (p. ej.: Renovar el DNI)", "gestiones"],
]);
/** The same over the map's collections, Tarea and Evento (MAP_CHOSEN). */
const FLOW_PLAN_CHOSEN_MAP = chosenPlan([
  ["Tarea (p. ej.: Preparar la reunión)", "tarea"],
  ["Evento (p. ej.: Cena de empresa)", "evento"],
]);
/** Juan's reading guide (invented): a rule that skips a list, one that the list's rule takes first, and two that send
 * a sender to a collection (Gestiones in the editor's fixtures, Tarea on the map's). */
export const GUIDE_RULES = {
  guide: {
    instructions: "",
    rules: [
      { id: "r1", from: "@lista.example.com", action: "skip" },
      {
        id: "r4",
        from: "boletin@lista.example.com",
        action: "collection",
        collection: "t_gestiones",
      },
      {
        id: "r2",
        from: "secretaria.ejemplo@universidad.example",
        action: "collection",
        collection: "t_gestiones",
      },
      {
        id: "r3",
        from: "coordinacion.ejemplo@universidad.example",
        action: "collection",
        collection: "t_01tarea",
      },
    ],
    examples: [],
  },
};
export const FLOW_DETAIL_CHOSEN = {
  ...FLOW_DETAIL,
  inputs: [...FLOW_DETAIL.inputs, { id: "options", what: "list" }],
  // The mail's connector brings records to «correo»: the trigger says so (docs/sistema.md §4.2).
  mailKey: "correo",
  nodes: [
    FLOW_DETAIL.nodes[0],
    flowStep("only", "call", "mail.rule", { title: "Regla del remitente", deps: ["mail"] }),
    FLOW_DETAIL.nodes[1],
    flowStep("c", "read", "classify", { when: true, deps: ["text", "options", "only", "r"] }),
    flowStep("n_f", "read", "fill", {
      each: true,
      when: true,
      deps: ["text", "r", "fill", "c"],
      ran: { allow: 12 },
    }),
    flowStep("n", "call", "entities.create", {
      title: "Crear",
      each: true,
      when: true,
      deps: ["r", "n_f", "prefill", "c"],
      ran: { propose: 12 },
      into: ["Docencia", "Gestiones"],
    }),
    flowStep("fold", "call", "inbox.fold", { title: "Plegar hilo", deps: ["mail"] }),
    flowStep("alone", "call", "inbox.accept_alone", { title: "Aceptar solas" }),
  ],
  plan: FLOW_PLAN_CHOSEN,
};

/**
 * Boni's map (docs/sistema.md §4.4, F8) with a week's invented numbers, as GET api/agent/map answers (apps/server
 * flowMap.ts): the mail coming in and «Leer correo» proposing in Tarea and Evento, a flow of his by hand that writes,
 * the conversation, the guide's reviewer, Juan from his apps, Claude through the MCP and a page over Tarea. Generated
 * collection ids and his collections' names, as the server sends them.
 */
const mapNode = (n: Record<string, unknown> & { id: string; kind: string }) => ({
  name: null,
  code: null,
  icon: "",
  runs: 0,
  last: null,
  calls: 0,
  cost: 0,
  models: [],
  roles: [],
  proposals: 0,
  accepted: 0,
  ...n,
});
const mapEdge = (from: string, to: string, kind: string, n: number | null, more = {}) => ({
  from,
  to,
  kind,
  n,
  outside: false,
  ...more,
});
/**
 * A reading of an earlier version of «Leer correo» (v2, before «Crear en la elegida»): its steps had other ids, so
 * the server sends that version to draw it over (task 90's review: drawn over the latest, its way broke).
 */
const OLD_PLAN = {
  version: 1,
  steps: [
    { id: "m", op: "call", tool: "entities.get", args: { id: { ref: "$mail" } } },
    { id: "r", op: "read", reader: "read_message", input: { ref: "$text" } },
    {
      id: "n0_docencia_f",
      op: "read",
      reader: "fill",
      input: { ref: "$item" },
      each: { ref: "$r.tasks" },
    },
    {
      id: "n0_docencia",
      op: "call",
      tool: "entities.create",
      each: { ref: "$r.tasks" },
      args: { type: { lit: "docencia" }, values: { ref: "$item" } },
    },
  ],
};
export const RUN_MAIL_OLD = {
  ...RUN_MAIL,
  id: "run-4",
  flowVersion: 2,
  steps: RUN_MAIL.steps.map((s) =>
    s.id === "n0_tasks_f"
      ? { ...s, id: "n0_docencia_f" }
      : s.id === "n0_tasks"
        ? { ...s, id: "n0_docencia" }
        : s,
  ),
  drawn: {
    version: 2,
    plan: OLD_PLAN,
    steps: [
      flowStep("m", "call", "entities.get", { title: "Leer" }),
      flowStep("r", "read", "read_message"),
      flowStep("n0_docencia_f", "read", "fill", { each: true }),
      flowStep("n0_docencia", "call", "entities.create", {
        title: "Crear",
        detail: "Docencia",
        each: true,
      }),
    ],
  },
};
const choose = (value: string) => ({ fn: "eq", args: [{ ref: "$c.choice" }, { lit: value }] });
const LANES_PLAN = {
  version: 1,
  steps: [
    { id: "m", op: "call", tool: "entities.get", args: { id: { ref: "$mail" } } },
    { id: "r", op: "read", reader: "read_message", input: { ref: "$text" } },
    { id: "c", op: "read", reader: "classify", input: { ref: "$text" } },
    {
      id: "n0_tasks",
      op: "call",
      tool: "entities.create",
      when: choose("Docencia"),
      each: { ref: "$r.tasks" },
      args: { type: { lit: "docencia" }, values: { ref: "$item" } },
    },
    {
      id: "n1_tasks",
      op: "call",
      tool: "entities.create",
      when: choose("Gestiones"),
      each: { ref: "$r.tasks" },
      args: { type: { lit: "gestiones" }, values: { ref: "$item" } },
    },
    { id: "fold", op: "call", tool: "inbox.fold", args: { mail: { ref: "$mail" } } },
  ],
};
export const RUN_MAIL_LANES = {
  ...RUN_MAIL,
  id: "run-5",
  flowVersion: 6,
  // It read Evento (what was pending there) without going there: Evento is not on its way.
  read: [...RUN_MAIL.read, { collection: "Evento", type: "t_01evento", titles: [], n: 3 }],
  proposals: [{ ...RUN_MAIL.proposals[0], step: "n1_tasks" }],
  steps: [
    ...RUN_MAIL.steps.filter((x) => x.id === "m" || x.id === "r"),
    {
      ...RUN_MAIL.steps[1],
      id: "c",
      what: "classify",
      calls: 1,
      cost: 0.0004,
      output: { choice: "Gestiones" },
    },
    {
      ...RUN_MAIL.steps[0],
      id: "n0_tasks",
      what: "entities.create",
      title: "Crear",
      decision: "skip",
      rule: null,
    },
    {
      ...RUN_MAIL.steps[0],
      id: "n1_tasks",
      what: "entities.create",
      title: "Crear",
      decision: "propose",
      rule: "P7",
    },
    {
      ...RUN_MAIL.steps[0],
      id: "fold",
      what: "inbox.fold",
      title: "Plegar hilo",
      decision: "allow",
    },
  ],
  drawn: {
    version: 6,
    plan: LANES_PLAN,
    steps: [
      flowStep("m", "call", "entities.get", { title: "Leer" }),
      flowStep("r", "read", "read_message"),
      flowStep("c", "read", "classify"),
      flowStep("n0_tasks", "call", "entities.create", {
        title: "Crear",
        detail: "Docencia",
        when: true,
        each: true,
      }),
      flowStep("n1_tasks", "call", "entities.create", {
        title: "Crear",
        detail: "Gestiones",
        when: true,
        each: true,
      }),
      flowStep("fold", "call", "inbox.fold", { title: "Plegar hilo" }),
    ],
  },
};
export const MAP = {
  days: 7,
  from: 1761300000000,
  to: 1761904800000,
  nodes: [
    mapNode({ id: "conn:mail", kind: "connector", code: "mail", pack: "correo" }),
    mapNode({
      id: "col:t_01m6correo",
      kind: "collection",
      name: "Correos",
      key: "correo",
      rows: 412,
      parent: null,
      pack: "correo",
    }),
    mapNode({
      id: "col:t_01trabajo",
      kind: "collection",
      name: "Trabajo",
      key: "trabajo",
      rows: 3,
    }),
    mapNode({
      id: "col:t_01tarea",
      kind: "collection",
      name: "Tarea",
      key: "tarea",
      rows: 128,
      parent: "col:t_01trabajo",
    }),
    mapNode({
      id: "col:t_01evento",
      kind: "collection",
      name: "Evento",
      key: "evento",
      rows: 64,
      parent: "col:t_01trabajo",
    }),
    mapNode({ id: "col:t_01gastos", kind: "collection", name: "Gastos", key: "gastos", rows: 905 }),
    mapNode({
      id: "flow:leer-correo",
      kind: "flow",
      name: "Leer correo",
      trigger: { created: "correo" },
      on: true,
      by: "preset",
      boni: true,
      runs: 42,
      last: 1761900000000,
      calls: 96,
      cost: 0.41,
      models: ["claude-haiku-4-5", "jev-1.14.0"],
      roles: ["reader", "decider"],
      proposals: 12,
      accepted: 9,
      plan: FLOW_PLAN,
      steps: [
        flowStep("m", "call", "entities.get", { title: "Leer", ran: { allow: 42 } }),
        flowStep("r", "read", "read_message", { ran: { allow: 42 }, calls: 42, cost: 0.21 }),
        flowStep("n0_tasks_f", "read", "fill", { each: true, ran: { allow: 12 } }),
        flowStep("n0_tasks", "call", "entities.create", {
          title: "Crear",
          detail: "Tarea",
          each: true,
          ran: { propose: 12 },
        }),
      ],
      pack: "correo",
    }),
    mapNode({
      id: "flow:apuntar-gasto",
      kind: "flow",
      name: "Apuntar gasto",
      trigger: { manual: true, inputs: [{ name: "concepto" }] },
      on: false,
      by: "user",
      runs: 3,
      steps: [],
    }),
    mapNode({
      id: "boni:chat",
      kind: "boni",
      code: "chat",
      runs: 5,
      calls: 7,
      cost: 0.12,
      roles: ["planner", "reader"],
      models: ["claude-opus-5-5"],
    }),
    mapNode({
      id: "boni:review",
      kind: "boni",
      code: "review",
      runs: 1,
      calls: 2,
      cost: 0.03,
      roles: ["reviewer"],
      pack: "correo",
    }),
    // The Bandeja: what «Leer correo» and the conversation propose waits in it.
    mapNode({
      id: "boni:inbox",
      kind: "boni",
      code: "inbox",
      proposals: 14,
      accepted: 10,
      rejected: 2,
      pending: 3,
      through: true,
    }),
    mapNode({ id: "actor:user", kind: "actor", code: "user" }),
    mapNode({
      id: "actor:mcp:claude-ejemplo",
      kind: "actor",
      code: "assistant",
      name: "claude-ejemplo",
    }),
    mapNode({ id: "page:p_01agenda", kind: "page", name: "Agenda" }),
    // One of the app's own (e2e-boni fixtures' «Libros»): «Ver en el mapa» from its menu puts it in the centre.
    mapNode({ id: "col:t_libro", kind: "collection", name: "Libros", key: "libro", rows: 4 }),
  ],
  edges: [
    mapEdge("conn:mail", "col:t_01m6correo", "brings", 42, { outside: true }),
    mapEdge("col:t_01m6correo", "flow:leer-correo", "starts", 42, { outside: true }),
    mapEdge("flow:leer-correo", "boni:inbox", "proposes", 12, {
      outside: true,
      steps: ["n0_tasks"],
      into: ["col:t_01evento", "col:t_01tarea", "col:t_libro"],
      per: { "col:t_01tarea": 8, "col:t_01evento": 3, "col:t_libro": 1 },
    }),
    mapEdge("boni:chat", "boni:inbox", "proposes", 2, {
      into: ["col:t_01gastos"],
      per: { "col:t_01gastos": 2 },
    }),
    mapEdge("boni:inbox", "col:t_01tarea", "accepts", 7, { outside: true }),
    mapEdge("boni:inbox", "col:t_01evento", "accepts", 2, { outside: true }),
    mapEdge("boni:inbox", "col:t_01gastos", "accepts", 1),
    mapEdge("boni:inbox", "col:t_libro", "accepts", 1, { outside: true }),
    mapEdge("flow:apuntar-gasto", "col:t_01gastos", "writes", 3),
    mapEdge("boni:chat", "col:t_01tarea", "writes", 2),
    mapEdge("col:t_01gastos", "boni:chat", "reads", 30),
    mapEdge("actor:user", "col:t_01tarea", "writes", 14),
    mapEdge("actor:user", "col:t_01gastos", "writes", 61),
    mapEdge("actor:user", "boni:inbox", "decides", 11),
    mapEdge("boni:inbox", "boni:review", "learns", 9, { via: ["flow:leer-correo"] }),
    mapEdge("boni:review", "flow:leer-correo", "improves", 1),
    mapEdge("actor:mcp:claude-ejemplo", "col:t_01evento", "writes", 2),
    mapEdge("col:t_01tarea", "page:p_01agenda", "shows", null),
    mapEdge("actor:user", "col:t_libro", "writes", 3),
  ],
};
/** The map with «Leer correo» creating in the chosen collection, Tarea or Evento (task 83: the decider's panel). */
export const MAP_CHOSEN = {
  ...MAP,
  nodes: MAP.nodes.map((n) =>
    n.id === "flow:leer-correo"
      ? {
          ...n,
          plan: FLOW_PLAN_CHOSEN_MAP,
          steps: [
            flowStep("m", "call", "entities.get", { title: "Leer", ran: { allow: 42 } }),
            flowStep("r", "read", "read_message", { ran: { allow: 42 }, calls: 42, cost: 0.21 }),
            flowStep("c", "read", "classify", {
              when: true,
              ran: { allow: 30 },
              calls: 30,
              cost: 0.05,
            }),
            flowStep("n_f", "read", "fill", { each: true, when: true, ran: { allow: 12 } }),
            flowStep("n", "call", "entities.create", {
              title: "Crear",
              each: true,
              when: true,
              ran: { propose: 12 },
              into: ["Tarea", "Evento"],
            }),
            flowStep("fold", "call", "inbox.fold", { title: "Plegar hilo", ran: { allow: 42 } }),
            flowStep("alone", "call", "inbox.accept_alone", {
              title: "Aceptar solas",
              ran: { allow: 42 },
            }),
          ],
        }
      : n,
  ),
};
/** The map with Boni's «Traer correo» (D-50), as the server draws it: connector → «Traer correo» → Correos. */
export const MAP_FETCH = {
  ...MAP,
  nodes: [
    ...MAP.nodes,
    mapNode({
      id: "flow:traer-correo",
      kind: "flow",
      name: "Traer correo",
      trigger: { connector: "mail" },
      on: true,
      by: "preset",
      boni: true,
      runs: 30,
      last: 1761900000000,
      pack: "correo",
      plan: { version: 1, steps: [{ id: "save", op: "call", tool: "mail.save", args: {} }] },
      steps: [
        flowStep("save", "call", "mail.save", { title: "Guardar en Correos", ran: { allow: 30 } }),
      ],
    }),
  ],
  edges: [
    ...MAP.edges.filter((e) => !(e.from === "conn:mail" && e.kind === "brings")),
    mapEdge("conn:mail", "flow:traer-correo", "brings", 42, { outside: true }),
    mapEdge("flow:traer-correo", "col:t_01m6correo", "writes", 42, {
      outside: true,
      steps: ["save"],
    }),
  ],
};
/** A reading of a mail recommending books: it proposed two to Libros, one accepted (the e2e fixtures' «Libros»). */
export const RUN_BOOK = {
  ...RUN_MAIL,
  id: "run-4",
  input: {
    id: "e_01m6mail0002",
    title: "Libros para el club de lectura",
    collection: "Correos",
    type: "t_01m6correo",
  },
  read: [
    {
      collection: "Correos",
      type: "t_01m6correo",
      titles: ["Libros para el club de lectura"],
      n: 1,
    },
  ],
  proposals: [
    { title: "Pedro Páramo", status: "accepted", type: "t_libro" },
    { title: "Rayuela", status: "rejected", type: "t_libro" },
  ],
};
/** «¿De dónde viene?» of a book «Leer correo» proposed and Juan accepted (apps/server origin.ts). */
export const ORIGIN_MAIL = {
  by: "flow",
  at: Date.UTC(2026, 9, 20, 11, 30),
  device: null,
  run: {
    id: "run-4",
    flow: "leer-correo",
    flowVersion: 3,
    started: Date.UTC(2026, 9, 20, 9, 5),
    owner: "flow:leer-correo",
  },
  input: {
    id: "e_01m6mail0002",
    title: "Libros para el club de lectura",
    collection: "Correos",
  },
  proposal: {
    title: "Pedro Páramo",
    created: Date.UTC(2026, 9, 20, 9, 5, 3),
    decided: Date.UTC(2026, 9, 20, 11, 30),
    alone: false,
  },
};
/** «¿De dónde viene?» of a record Juan wrote himself. */
export const ORIGIN_USER = {
  by: "user",
  at: Date.UTC(2026, 9, 21, 17, 45),
  device: "portatil",
  run: null,
  input: null,
  proposal: null,
};
/** After «Guardar»: the user's version, Boni's still in the history. */
export const FLOW_DETAIL_SAVED = {
  ...FLOW_DETAIL,
  version: 4,
  by: "user",
  versions: [{ version: 4, by: "user", created: 1761900000000 }, ...FLOW_DETAIL.versions],
};
const catalogField = (key: string, name: string, roles: string[] = [], type = "text") => ({
  key,
  name,
  type,
  roles,
  relation: null,
});
/** The editor's catalog (the server's `flowCatalog`), shortened: the tools and readers a flow may use. */
export const FLOW_CATALOG = {
  tools: [
    {
      name: "entities.query",
      title: "Consultar",
      effect: "read",
      args: [
        { name: "type", role: "type", required: true },
        { name: "field", role: "field", required: false },
        { name: "equals", role: "value", required: false },
      ],
    },
    {
      name: "entities.get",
      title: "Leer",
      effect: "read",
      args: [{ name: "id", role: "entity", required: true }],
    },
    {
      name: "entities.create",
      title: "Crear",
      effect: "write",
      args: [
        { name: "type", role: "type", required: true },
        { name: "values", role: "content", required: true },
      ],
    },
    {
      name: "notify",
      title: "Avisar",
      effect: "notify",
      args: [{ name: "text", role: "content", required: true }],
    },
    // Boni's pieces (docs/sistema.md §4.2, F7): the code that works on the mail, offered in a flow a mail starts.
    {
      name: "mail.rule",
      title: "Regla del remitente",
      effect: "piece",
      record: true,
      args: [
        { name: "mail", role: "entity", required: true },
        { name: "asked", role: "value", required: false },
      ],
    },
    {
      name: "inbox.fold",
      title: "Plegar hilo",
      effect: "piece",
      record: true,
      changes: true,
      args: [
        { name: "mail", role: "entity", required: true },
        { name: "again", role: "value", required: false },
        // Its setting (task 83): how many days back a thread's earlier proposals count.
        { name: "days", role: "value", required: false },
      ],
    },
    {
      name: "inbox.accept_alone",
      title: "Aceptar solas",
      effect: "piece",
      record: true,
      changes: true,
      args: [],
    },
    {
      name: "flows.run",
      title: "Ejecutar flujo",
      effect: "flow",
      args: [
        { name: "flow", role: "option", required: true },
        { name: "inputs", role: "content", required: false },
      ],
    },
    // «Función» and «Aplicar cambios» (task 93): offered under «Funciones» only with an active function to name.
    {
      name: "function.run",
      title: "Función",
      effect: "read",
      args: [
        { name: "funcion", role: "option", required: true },
        { name: "datos", role: "content", required: false },
      ],
    },
    {
      name: "function.apply",
      title: "Aplicar cambios",
      effect: "write",
      args: [{ name: "cambios", role: "content", required: true }],
    },
  ],
  readers: {
    read_message: {
      params: ["modules", "user_in", "known", "guide"],
      required: [],
      out: ["all", "tasks", "events"],
    },
    classify: { params: ["options", "question", "ask"], required: ["options"], out: ["choice"] },
    fill: { params: ["fields"], required: ["fields"], out: ["values", "note"] },
    summarize: { params: [], required: [], out: ["text"] },
  },
  asks: ["choice", "text"],
  replies: { text: ["template", "a", "b", "c", "d"], number: ["value", "unit", "caption"] },
  fns: { concat: [1, 40], obj: [2, 40], merge: [2, 8], first: [1, 8], eq: [2, 2] },
  limits: { steps: 40, each: 50, nesting: 3 },
  collections: [
    {
      id: "t_docencia",
      key: "docencia",
      name: "Docencia",
      parent: null,
      fields: [
        catalogField("titulo", "Título", ["title"]),
        catalogField("fecha", "Fecha", ["date"], "date"),
      ],
    },
    {
      id: "t_gestiones",
      key: "gestiones",
      name: "Gestiones",
      parent: null,
      fields: [
        catalogField("nombre", "Nombre", ["title"]),
        catalogField("dia", "Día", ["date"], "date"),
        catalogField("prioridad", "Prioridad", [], "select"),
      ],
    },
    // The mail's own collection (its key is what «Leer correo» starts on): «Llega a Correos».
    {
      id: "t_01m6correo",
      key: "correo",
      name: "Correos",
      parent: null,
      fields: [catalogField("asunto", "Asunto", ["title"])],
    },
  ],
  modules: ["tasks", "events"],
};
/** The catalog with an active extension's function (task 93): «Funciones» in «Añadir paso», its code and tests. */
export const FLOW_CATALOG_FUNCTIONS = {
  ...FLOW_CATALOG,
  functions: [
    {
      id: "banco/importar",
      name: "Banco · importar",
      code: 'function importar(input) {\n  return { summary: "0 nuevos", changes: [] };\n}',
      tests: ["dos líneas dan dos movimientos"],
    },
  ],
};
/** The checklist with nothing missing, and the values each step may take (a few). */
export const FLOW_CHECK = {
  problems: [],
  refs: {
    m: [
      { ref: "$mail", t: "text" },
      { ref: "$text", t: "text" },
    ],
    r: [
      { ref: "$text", t: "text" },
      { ref: "$m", t: "record" },
      { ref: "$m.asunto", t: "text" },
    ],
    n0_tasks_f: [
      { ref: "$r.tasks", t: "list" },
      { ref: "$item.title", t: "text" },
    ],
    n0_tasks: [
      { ref: "$r.tasks", t: "list" },
      { ref: "$item.title", t: "text" },
      { ref: "$item.due", t: "text" },
      { ref: "$zip.note", t: "text" },
    ],
  },
  // What each step gives (task 70: its panel's «Sale»).
  outs: {
    m: [
      { ref: "$m", t: "record" },
      { ref: "$m.asunto", t: "text" },
    ],
    r: [
      { ref: "$r", t: "record" },
      { ref: "$r.all", t: "list" },
      { ref: "$r.tasks", t: "list" },
      { ref: "$r.events", t: "list" },
    ],
    n0_tasks_f: [{ ref: "$n0_tasks_f", t: "list" }],
    n0_tasks: [{ ref: "$n0_tasks", t: "list" }],
  },
};

/** «Probar» on «Leer correo» (docs/flujos.md F3): what each step did with the latest mail, and what it would do. */
export const FLOW_TEST = {
  run: "run-test-1",
  status: "done",
  error: null,
  sample: { mail: "e_mail1", subject: "Informe y sala" },
  steps: {
    m: {
      decision: "allow",
      rule: "P1",
      error: null,
      out: { t: "record", text: "Informe y sala", n: null },
      would: [],
    },
    r: {
      decision: "allow",
      rule: "P1",
      error: null,
      out: { t: "record", text: null, n: 2 },
      would: [],
    },
    n0_tasks_f: { decision: "allow", rule: "P1", error: null, out: { t: "list", n: 2 }, would: [] },
    n0_tasks: {
      decision: "propose",
      rule: "P4",
      error: null,
      out: { t: "list", n: 2 },
      would: [
        {
          decision: "propose",
          rule: "P4",
          tool: "entities.create",
          title: "Crear",
          type: "Docencia",
          text: "Enviar el informe",
        },
        {
          decision: "propose",
          rule: "P4",
          tool: "entities.create",
          title: "Crear",
          type: "Docencia",
          text: "Reservar la sala",
        },
      ],
    },
  },
};

/** A flow of the user's by hand (docs/flujos.md F4): it counts the tasks and says it; made a daily summary. */
const SUMMARY_PLAN = {
  version: 1,
  steps: [
    {
      id: "n",
      op: "call",
      tool: "entities.aggregate",
      args: { type: { lit: "docencia" }, op: { lit: "count" } },
    },
    {
      id: "a",
      op: "call",
      tool: "notify",
      args: { text: { fn: "concat", args: [{ lit: "Tareas: " }, { ref: "$n" }] } },
    },
  ],
};
export const FLOW_SUMMARY = {
  id: "resumen-diario",
  name: "Resumen diario",
  version: 1,
  trigger: { manual: true },
  by: "user",
  enabled: false,
  steps: 2,
  runs: 0,
  last: null,
  inputs: [],
  nodes: [
    flowStep("n", "call", "entities.aggregate", { title: "Contar", detail: "Docencia" }),
    flowStep("a", "call", "notify", { title: "Avisar", deps: ["n"] }),
  ],
  days: 7,
  versions: [{ version: 1, by: "user", created: 1761900000000 }],
  plan: SUMMARY_PLAN,
  layout: null,
  preset: null,
};
export const FLOWS_WITH_SUMMARY = {
  flows: [
    ...FLOWS.flows,
    {
      id: "resumen-diario",
      name: "Resumen diario",
      version: 1,
      trigger: { manual: true },
      by: "user",
      enabled: false,
      steps: 2,
      runs: 0,
      last: null,
    },
  ],
};

/** Flows a model proposed (docs/flujos.md F5): a new one, and a change of one of the user's. */
export const FLOW_PROPOSAL = {
  id: "pf1",
  tool: "flows.save",
  view: { tool: "flows.save", title: "Proponer flujo", rows: [] },
  sources: [],
  created: 1761900000000,
  run: "run-f1",
  card: null,
  flow: {
    name: "Resumen del lunes",
    changes: null,
    trigger: { schedule: { every: "week", day: 1, at: "08:00" } },
    inputs: [{ id: "today", what: "text" }],
    nodes: [
      {
        ...flowStep("n", "call", "entities.aggregate", { title: "Contar", detail: "Docencia" }),
        change: "same",
      },
      { ...flowStep("a", "call", "notify", { title: "Avisar", deps: ["n"] }), change: "same" },
    ],
  },
};
export const FLOW_CHANGE = {
  ...FLOW_PROPOSAL,
  id: "pf2",
  run: "run-f2",
  flow: {
    name: "Resumen diario",
    changes: { id: "resumen-diario", name: "Resumen diario", version: 1 },
    trigger: { manual: true },
    inputs: [],
    nodes: [
      {
        ...flowStep("n", "call", "entities.aggregate", { title: "Contar", detail: "Docencia" }),
        change: "same",
      },
      { ...flowStep("r", "reply", "text", { deps: ["n"] }), change: "new" },
      { ...flowStep("a", "call", "notify", { title: "Avisar", deps: ["n"] }), change: "removed" },
    ],
  },
};
