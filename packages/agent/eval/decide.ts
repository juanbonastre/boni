/**
 * Would a decision model (TypeSafe's Jev, a "System One" model: typed choices with probabilities and a
 * confidence, no generated text) do the mail pipeline's decisions better or cheaper than the reader we use?
 * Invented mail in Spanish shaped like Juan's, outside CI, run by hand (docs/extensiones.md 9, role
 * "decider"). Two decisions:
 * - the collection a mail's tasks go to (today `classify` with Haiku 4.5): accuracy, and whether the
 *   confidence tells right from wrong (so the code could ask Juan when it is low);
 * - a gate before the expensive reading: "does this mail ask anything of the recipient?" (reads saved,
 *   requests missed).
 * Jev goes through OpenRouter's decisions endpoint; the option order is also reversed to see if the answer
 * holds (a weakness TypeSafe documents).
 *
 *   OPENROUTER_API_KEY=... node packages/agent/eval/decide.ts [runs]
 */
import { OpenAIProvider } from "../src/openai.ts";
import { checkReaderOutput, delimit, READER_PROMPTS, READER_SCHEMAS } from "../src/readers.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(2);
}
const runs = Number(process.argv[2] ?? 1);

/** The collections, as the mail plan offers them: a name and a few of the user's own titles. */
const COLLECTIONS: Record<string, string> = {
  Docencia:
    "p. ej.: Examen de Bases de Datos; Poner la asistencia a Mario; Revisar el TFG de Lucía",
  Planes: "p. ej.: Cena con Ana el sábado; Viaje a Valencia; Concierto en el Teatro Romea",
  Gestiones: "p. ej.: Renovar el DNI; Pagar el seguro del coche; Cita en el banco",
  Personas: "p. ej.: Ana Ejemplo; Mario Alumno; Lucía Compañera",
};
const NAMES = Object.keys(COLLECTIONS);
const option = (n: string) => `${n} (${COLLECTIONS[n]})`;

interface Case {
  mail: string;
  asks: boolean;
  /** Where its tasks belong; null when it asks nothing. */
  goes: string | null;
}
const m = (from: string, subject: string, body: string) =>
  `De: ${from}\nPara: Juan Ejemplo <juan@example.com>\nAsunto: ${subject}\n\n${body}`;
const CASES: Case[] = [
  {
    mail: m(
      "mario@alu.example.com",
      "Revisión del examen",
      "Profe, ¿podría revisarme la nota del examen de Bases de Datos? Creo que hay un error en la pregunta 3.",
    ),
    asks: true,
    goes: "Docencia",
  },
  {
    mail: m(
      "coordinacion@example.com",
      "Propuestas de examen",
      "Compañeros, enviad las propuestas de examen antes del 5 de noviembre.",
    ),
    asks: true,
    goes: "Docencia",
  },
  {
    mail: m(
      "noticias@example.com",
      "Boletín semanal",
      "Esta semana: Semana de la Ciencia, congreso de enfermedades raras y menú especial en la cafetería.",
    ),
    asks: false,
    goes: null,
  },
  {
    mail: m(
      "cafeteria@example.com",
      "Menú del día",
      "Hoy: lentejas, merluza en salsa y flan. Reserva tu menú en la cafetería.",
    ),
    asks: false,
    goes: null,
  },
  {
    mail: m(
      "avisos@banco.example.com",
      "Movimiento no reconocido",
      "Hemos detectado un cargo de 89,90 € en tu tarjeta. Si no lo reconoces, llámanos o revisa tus movimientos en la app.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "seguros@example.com",
      "Renovación de tu póliza",
      "Tu seguro del coche vence el 30 de noviembre. Paga la renovación antes de esa fecha para no perder la cobertura.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "ana@example.com",
      "¿Cena el sábado?",
      "¡Hola! Vamos a cenar el sábado en el centro, ¿te apuntas? Dime algo antes del jueves.",
    ),
    asks: true,
    goes: "Planes",
  },
  {
    mail: m(
      "hermano@example.com",
      "Valencia",
      "Ya tengo los billetes para Valencia. ¿Reservas tú el hotel para las dos noches?",
    ),
    asks: true,
    goes: "Planes",
  },
  {
    mail: m(
      "citaprevia@ayuntamiento.example.com",
      "Cita confirmada",
      "Tu cita para renovar el DNI es el 4 de noviembre a las 10:30. Trae una fotografía reciente.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "editorial@revista.example.com",
      "Invitación a número especial",
      "Estimado Dr. Ejemplo: le invitamos a enviar un manuscrito a nuestro número especial sobre IA. Plazo: 31 de agosto de 2027.",
    ),
    asks: false,
    goes: null,
  },
  {
    mail: m(
      "no-reply@cuentas.example.com",
      "Alerta de seguridad",
      "Se ha iniciado sesión en tu cuenta desde un dispositivo nuevo. Si no has sido tú, cambia tu contraseña.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "pablo@alu.example.com",
      "Raspberry",
      "Hola profe, mañana a mediodía le entrego la raspberry a usted o a un compañero.",
    ),
    asks: false,
    goes: null,
  },
  {
    mail: m(
      "lucia@example.com",
      "Clase del martes",
      "Juan, ¿podrías cubrirme la clase del martes de Algoritmia? Te paso el material.",
    ),
    asks: true,
    goes: "Docencia",
  },
  {
    mail: m(
      "ofertas@tienda.example.com",
      "Ofertas de otoño",
      "Hasta un 40 % de descuento en electrónica solo este fin de semana. ¡No te lo pierdas!",
    ),
    asks: false,
    goes: null,
  },
  {
    mail: m(
      "comunidad@example.com",
      "Junta de vecinos",
      "Se convoca junta el 12 de noviembre para votar la derrama del ascensor. Confirma si asistirás o delega tu voto.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "carlos@example.com",
      "Fotos del viaje",
      "¡Qué bien lo pasamos! ¿Me pasas las fotos que hiciste en la playa?",
    ),
    asks: true,
    goes: "Planes",
  },
  {
    mail: m(
      "esteban@alu.example.com",
      "Borrador TFG",
      "Buenas, le adjunto el borrador del capítulo 2 del TFG. ¿Podría revisarlo antes de la reunión del jueves?",
    ),
    asks: true,
    goes: "Docencia",
  },
  {
    mail: m(
      "notificaciones@hacienda.example.com",
      "Borrador de la renta",
      "Ya está disponible tu borrador. Revísalo y confírmalo antes del 30 de junio.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "entradas@teatro.example.com",
      "Tus entradas",
      "Recuerda: el concierto es el viernes 7 a las 21:00. Presenta este correo en la entrada.",
    ),
    asks: true,
    goes: "Planes",
  },
  {
    mail: m("lucia@example.com", "Gracias", "Muchas gracias por cubrirme la clase, ¡te debo una!"),
    asks: false,
    goes: null,
  },
  // Harder: the collection is not obvious from the words alone.
  {
    mail: m(
      "jefa@example.com",
      "Informe",
      "Hola Juan, ¿me envías el informe de la asignatura antes del viernes?",
    ),
    asks: true,
    goes: "Docencia",
  },
  {
    mail: m(
      "ana@example.com",
      "Cumpleaños de Mario",
      "El sábado es el cumple de Mario, ¿te encargas de comprar el regalo? Pensábamos en un libro.",
    ),
    asks: true,
    goes: "Planes",
  },
  {
    mail: m(
      "secretaria@example.com",
      "Certificado",
      "Para el certificado de docencia que pediste necesito tu DNI escaneado. Envíamelo cuando puedas.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "mario@alu.example.com",
      "Prácticas en empresa",
      "Profe, la empresa necesita que firme el convenio de prácticas como tutor académico antes del día 15.",
    ),
    asks: true,
    goes: "Docencia",
  },
  {
    mail: m(
      "gimnasio@example.com",
      "Tu cuota",
      "Tu cuota de noviembre no se ha podido cobrar. Actualiza tu tarjeta en la web.",
    ),
    asks: true,
    goes: "Gestiones",
  },
  {
    mail: m(
      "lucia@example.com",
      "Congreso",
      "Te reenvío la convocatoria del congreso por si te interesa; yo voy a mandar algo.",
    ),
    asks: false,
    goes: null,
  },
  {
    mail: m(
      "rrhh@example.com",
      "Nómina",
      "Ya está disponible tu nómina de octubre en el portal del empleado.",
    ),
    asks: false,
    goes: null,
  },
];

async function jev(state: string, names: string[]) {
  const r = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "typesafe/jev-1.14",
      state,
      questions: {
        asks: {
          type: "noul",
          instructions:
            "¿Pide este correo algo concreto a su destinatario (hacer algo, contestar, decidir, asistir a algo con él)? Un boletín, una oferta, un anuncio para muchos o algo que hará el remitente no cuentan.",
        },
        goes: {
          type: "choice",
          instructions:
            "Si el destinatario apuntara lo que le pide este correo, ¿en cuál de sus colecciones lo apuntaría? Cada opción lleva ejemplos de lo que ya tiene en ella.",
          criteria: Object.fromEntries(names.map((n) => [n, COLLECTIONS[n] as string])),
        },
      },
    }),
  });
  const b = (await r.json()) as {
    answers?: { asks: { noul: number }; goes: { choice: string; confidence: number } };
    usage?: { cost: number };
    error?: unknown;
  };
  if (!b.answers) throw new Error(JSON.stringify(b.error ?? b).slice(0, 200));
  return {
    asks: b.answers.asks.noul,
    goes: b.answers.goes.choice,
    conf: b.answers.goes.confidence,
    cost: b.usage?.cost ?? 0,
  };
}

const haiku = new OpenAIProvider({
  apiKey: key,
  model: "anthropic/claude-haiku-4.5",
  baseURL: "https://openrouter.ai/api/v1",
});
async function classify(state: string) {
  const { marker, text } = delimit(state);
  const options = NAMES.map(option);
  const r = await haiku.complete({
    role: "reader",
    system: READER_PROMPTS.classify,
    input: {
      marker,
      content: text,
      options,
      question:
        "¿En cuál de estas colecciones apuntaría el destinatario lo que este mensaje le pide hacer o a lo que tiene que ir?",
    },
    schema: READER_SCHEMAS.classify,
    maxTokens: 1000,
  });
  const c = checkReaderOutput("classify", r.json, options) as { choice: string } | null;
  return {
    goes: c ? (NAMES.find((n) => c.choice.startsWith(n)) ?? "?") : "?",
    tokens: r.usage.input + r.usage.output,
  };
}

let jevRight = 0,
  haikuRight = 0,
  flips = 0,
  judged = 0,
  cost = 0,
  haikuTokens = 0;
const conf: { right: boolean; conf: number }[] = [];
const gate: { asks: boolean; p: number }[] = [];
for (let run = 0; run < runs; run++)
  for (const c of CASES) {
    const j = await jev(c.mail, NAMES);
    const back = await jev(c.mail, [...NAMES].reverse());
    cost += j.cost + back.cost;
    gate.push({ asks: c.asks, p: j.asks });
    if (!c.goes) continue;
    judged++;
    const h = await classify(c.mail);
    haikuTokens += h.tokens;
    if (j.goes === c.goes) jevRight++;
    if (h.goes === c.goes) haikuRight++;
    if (back.goes !== j.goes) flips++;
    conf.push({ right: j.goes === c.goes, conf: j.conf });
    console.log(
      `${c.goes.padEnd(9)} jev ${j.goes.padEnd(9)} ${j.conf.toFixed(2)} | reversed ${back.goes.padEnd(9)} | haiku ${h.goes}`,
    );
  }

console.log(
  `\nCollection (${judged} mails that ask something): Jev ${jevRight}/${judged}, Haiku 4.5 ${haikuRight}/${judged}; Jev changed its answer with the options reversed ${flips} times`,
);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(
  `Jev confidence: right ${avg(conf.filter((c) => c.right).map((c) => c.conf)).toFixed(2)}, wrong ${avg(conf.filter((c) => !c.right).map((c) => c.conf)).toFixed(2)}`,
);
for (const th of [0.6, 0.8, 0.9]) {
  const sure = conf.filter((c) => c.conf >= th);
  console.log(
    `  confidence ≥ ${th}: ${sure.length}/${conf.length} decided alone, ${sure.filter((c) => c.right).length} right; the rest would be asked`,
  );
}
console.log(
  "Gate on mails that ask nothing: " +
    CASES.map((c, i) => (c.asks ? null : `${i}:${gate[i]?.p.toFixed(2)}`))
      .filter(Boolean)
      .join(" "),
);
for (const th of [0.2, 0.3, 0.5]) {
  const skipped = gate.filter((g) => g.p < th);
  console.log(
    `Gate "asks?" < ${th}: ${skipped.length}/${gate.length} not read; of them ${skipped.filter((g) => g.asks).length} did ask (missed)`,
  );
}
console.log(
  `\nJev cost: $${cost.toFixed(5)} for ${gate.length * 2} calls; Haiku classify: ${haikuTokens} tokens`,
);
