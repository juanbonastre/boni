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
