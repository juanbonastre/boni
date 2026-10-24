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
  request: "Reenvía el informe a quien me lo pidió",
  steps: [
    {
      id: "s1",
      op: "call",
      what: "entities.search",
      args: { text: { quote: "informe" } },
      decision: "allow",
      rule: "P1",
      error: null,
    },
    {
      id: "s2",
      op: "call",
      what: "mail.send",
      args: { to: { ref: "$s1[0].de" }, body: { lit: "Aquí lo tienes" } },
      decision: "stopped",
      rule: null,
      error: "P2-untrusted-destination",
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
      what: { kind: "note", path: "proyectos/ejemplo-de-proyecto.md", action: "update" },
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

/** A hand edit of the mirror in Obsidian, as the server paints it (packages/mirror). */
export const MIRROR_PROPOSAL = {
  proposals: [
    {
      id: "pm",
      tool: "entities.update",
      view: {
        tool: "entities.update",
        title: "Cambio hecho a mano en Obsidian",
        rows: [
          {
            arg: "note",
            role: "value",
            value: "agenda/docencia/2026-10-19 Clase de ejemplo.md",
            integrity: "imported",
            sources: ["vault"],
            marks: [],
          },
          {
            arg: "ignored",
            role: "value",
            value: "Tipo: no es una de las opciones",
            integrity: "imported",
            sources: ["vault"],
            marks: [],
          },
          {
            arg: "id",
            role: "entity",
            value: "e_clase",
            integrity: "imported",
            sources: ["vault"],
            marks: [],
            detail: "Clase de ejemplo",
          },
          {
            arg: "values.starttime",
            role: "content",
            value: "12:00",
            integrity: "imported",
            sources: ["vault"],
            marks: [],
            name: "Hora de inicio",
          },
        ],
      },
      sources: ["vault:agenda/docencia/2026-10-19 Clase de ejemplo.md@0123456789ab"],
      created: 1,
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
      type: "t_correo",
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
  open: about ? { type: "t_correo", id: "e_correo1" } : null,
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
    byDay: Array.from({ length: 24 }, (_, i) => ({
      day: `2026-10-${String(i + 1).padStart(2, "0")}`,
      eur: ((i * 7) % 11) / 40,
    })),
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
