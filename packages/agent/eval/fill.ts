/**
 * How well a proposal's other fields are filled (reader `fill`, filling.ts): Jev (the decider, through
 * OpenRouter, as the server runs it when OPENROUTER_API_KEY is set) choosing each value in both orders, plus a
 * reader writing the note only when Jev says it is worth it; against the reader filling everything in one call
 * (the server without a decider). Invented mail in Spanish shaped like Juan's, outside CI, run by hand.
 *
 * What counts most is a wrong value (a field set to an option the mail does not say): the proposal then looks
 * right and is not. A missing value (null where the mail says it) only leaves work to Juan.
 *
 *   OPENROUTER_API_KEY=... node packages/agent/eval/fill.ts [runs] [reader model]
 */
import { checkAnswers, JevProvider } from "../src/decider.ts";
import {
  checkFill,
  cleanNote,
  FILL_PROMPT,
  type FillField,
  fieldsForReader,
  fillQuestions,
  fillSchema,
  fromAnswers,
  NOTE_PROMPT,
  NOTE_SCHEMA,
} from "../src/filling.ts";
import { OpenAIProvider } from "../src/openai.ts";
import { delimit } from "../src/readers.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(2);
}
const runs = Number(process.argv[2] ?? 1);
const readerModel = process.argv[3] ?? "anthropic/claude-haiku-4.5";

/** A teaching collection like Juan's (invented): a project, a kind, a place and a checkbox. */
const FIELDS: FillField[] = [
  {
    key: "proyecto",
    name: "Proyecto",
    kind: "choice",
    options: [
      { value: "p_bd", label: "Bases de Datos 2026-27" },
      { value: "p_ipm", label: "Interacción Persona-Máquina 2026-27" },
      { value: "p_tfg", label: "TFG de Lucía Ejemplo" },
      { value: "p_cong", label: "Congreso de ejemplo 2027" },
    ],
  },
  {
    key: "tipo",
    name: "Tipo",
    kind: "choice",
    options: [
      { value: "o_clase", label: "Clase" },
      { value: "o_examen", label: "Examen" },
      { value: "o_reunion", label: "Reunión" },
      { value: "o_tutoria", label: "Tutoría" },
      { value: "o_correccion", label: "Corrección" },
      { value: "o_tramite", label: "Trámite" },
    ],
  },
  {
    key: "lugar",
    name: "Lugar",
    kind: "choice",
    options: [
      { value: "l_aula", label: "Aula 1.03" },
      { value: "l_despacho", label: "Despacho" },
      { value: "l_online", label: "En línea" },
      { value: "l_salon", label: "Salón de grados" },
    ],
  },
  { key: "urgente", name: "Urgente", kind: "check", options: [] },
];

interface Case {
  mail: string;
  /** The item as the reading leaves it: its title and the words that ask for it. */
  item: string;
  quote: string;
  /** What each field should be (option value, true, or null when the mail does not say). */
  want: Record<string, string | boolean | null>;
  /** Whether the mail has details worth a note. */
  note: boolean;
}
const m = (from: string, subject: string, body: string) =>
  `De: ${from}\nPara: Juan Ejemplo <juan@example.com>\nAsunto: ${subject}\n\n${body}`;
const CASES: Case[] = [
  {
    mail: m(
      "mario@alu.example.com",
      "Revisión del examen de Bases de Datos",
      "Profe, ¿podría revisarme la nota del examen parcial de Bases de Datos? Creo que hay un error en la pregunta 3. Puedo pasarme por su despacho el jueves.",
    ),
    item: "Revisar la nota del examen parcial de Mario",
    quote: "¿podría revisarme la nota del examen parcial de Bases de Datos?",
    want: { proyecto: "p_bd", tipo: "o_correccion", lugar: "l_despacho", urgente: null },
    note: true,
  },
  {
    mail: m(
      "coordinacion@example.edu",
      "URGENTE: actas de IPM",
      "Juan, necesitamos las actas firmadas de Interacción Persona-Máquina hoy mismo antes de las 14:00, es urgente porque cierra secretaría.",
    ),
    item: "Firmar las actas de IPM",
    quote: "necesitamos las actas firmadas de Interacción Persona-Máquina hoy mismo",
    want: { proyecto: "p_ipm", tipo: "o_tramite", lugar: null, urgente: true },
    note: true,
  },
  {
    mail: m(
      "lucia@alu.example.com",
      "Tutoría TFG",
      "Hola Juan, ¿podemos hacer la tutoría del TFG el martes a las 10 por videollamada? Te mando el enlace de Meet. Traeré el capítulo 2 revisado.",
    ),
    item: "Tutoría del TFG con Lucía",
    quote: "¿podemos hacer la tutoría del TFG el martes a las 10 por videollamada?",
    want: { proyecto: "p_tfg", tipo: "o_tutoria", lugar: "l_online", urgente: null },
    note: true,
  },
  {
    mail: m(
      "secretaria@example.edu",
      "Reunión de departamento",
      "Se convoca reunión ordinaria del departamento el miércoles 4 a las 12:00 en el salón de grados.",
    ),
    item: "Reunión ordinaria del departamento",
    quote: "Se convoca reunión ordinaria del departamento el miércoles 4 a las 12:00",
    want: { proyecto: null, tipo: "o_reunion", lugar: "l_salon", urgente: null },
    note: false,
  },
  {
    mail: m(
      "comite@congreso.example.org",
      "Revisión de artículos",
      "Estimado revisor: le recordamos que debe enviar las revisiones de los dos artículos asignados del congreso antes del 15 de noviembre a través de la plataforma.",
    ),
    item: "Enviar las revisiones de los artículos del congreso",
    quote:
      "debe enviar las revisiones de los dos artículos asignados del congreso antes del 15 de noviembre",
    want: { proyecto: "p_cong", tipo: "o_correccion", lugar: null, urgente: null },
    note: true,
  },
  {
    mail: m(
      "ana@example.com",
      "Cambio de aula",
      "Juan, la clase de mañana de Bases de Datos se pasa al aula 1.03 porque la otra está en obras.",
    ),
    item: "Clase de Bases de Datos en otra aula",
    quote: "la clase de mañana de Bases de Datos se pasa al aula 1.03",
    want: { proyecto: "p_bd", tipo: "o_clase", lugar: "l_aula", urgente: null },
    note: false,
  },
  {
    mail: m(
      "decanato@example.edu",
      "Encuesta",
      "Por favor, rellena la encuesta de satisfacción docente antes de fin de mes.",
    ),
    item: "Rellenar la encuesta de satisfacción docente",
    quote: "rellena la encuesta de satisfacción docente antes de fin de mes",
    want: { proyecto: null, tipo: "o_tramite", lugar: null, urgente: null },
    note: false,
  },
  {
    mail: m(
      "pablo@alu.example.com",
      "Duda",
      "Hola, tengo una duda sobre la práctica 2, ¿le viene bien que lo hablemos después de clase?",
    ),
    item: "Resolver la duda de Pablo sobre la práctica 2",
    quote: "tengo una duda sobre la práctica 2",
    // The mail says which practical, not which subject: the project should stay empty.
    want: { proyecto: null, tipo: "o_tutoria", lugar: null, urgente: null },
    note: false,
  },
];

const jevP = new JevProvider({ apiKey: key, via: "openrouter" });
const reader = new OpenAIProvider({
  apiKey: key,
  model: readerModel,
  baseURL: "https://openrouter.ai/api/v1",
});
const contentOf = (c: Case) =>
  `${c.mail}\n\nElemento: ${c.item}\nPalabras del correo que lo piden: ${c.quote}`;
const readInput = (flat: string, extra: Record<string, unknown> = {}) => {
  const { marker, text } = delimit(flat);
  return { marker, today: "2026-10-23", weekday: "viernes", content: text, ...extra };
};

/** As the agent does with a decider: Jev for the values, the reader for the note only when worth it. */
async function withJev(c: Case) {
  const flat = contentOf(c);
  const q = fillQuestions(FIELDS);
  const r = await jevP.complete({
    role: "decider",
    system: "",
    input: { state: flat, questions: q },
    schema: {},
    maxTokens: 0,
  });
  const answers = checkAnswers(r.json, q);
  if (!answers) throw new Error("bad Jev answer");
  const { values, wantsNote } = fromAnswers(answers, FIELDS);
  let note: string | null = null;
  let tokens = 0;
  if (wantsNote) {
    const n = await reader.complete({
      role: "reader",
      system: NOTE_PROMPT,
      input: readInput(flat),
      schema: NOTE_SCHEMA,
      maxTokens: 1000,
    });
    tokens += n.usage.input + n.usage.output;
    note = cleanNote((n.json as { note?: unknown } | null)?.note);
  }
  return { values, wantsNote, note, jevTokens: r.usage.input, tokens };
}
/** As the agent does without one: the reader fills everything in one call. */
async function readerOnly(c: Case) {
  const r = await reader.complete({
    role: "reader",
    system: FILL_PROMPT,
    input: readInput(contentOf(c), { fields: fieldsForReader(FIELDS) }),
    schema: fillSchema(FIELDS),
    maxTokens: 1000,
  });
  const f = checkFill(r.json, FIELDS);
  return {
    values: f?.values ?? null,
    note: f?.note ?? null,
    tokens: r.usage.input + r.usage.output,
  };
}

type Tally = { right: number; wrong: number; missed: number; extra: number };
const blank = (): Tally => ({ right: 0, wrong: 0, missed: 0, extra: 0 });
const score = (t: Tally, want: unknown, got: unknown) => {
  if (got === want) t.right++;
  else if (got === null || got === undefined) t.missed++;
  else if (want === null) t.extra++;
  else t.wrong++;
};
const jevT = blank();
const rdT = blank();
let jevNotes = 0,
  rdNotes = 0,
  noteCases = 0,
  jevTokens = 0,
  jevReaderTokens = 0,
  rdTokens = 0,
  failed = 0;
for (let run = 0; run < runs; run++)
  for (const c of CASES) {
    try {
      const j = await withJev(c);
      const r = await readerOnly(c);
      jevTokens += j.jevTokens;
      jevReaderTokens += j.tokens;
      rdTokens += r.tokens;
      const line: string[] = [];
      for (const f of FIELDS) {
        const want = c.want[f.key] ?? null;
        score(jevT, want, j.values[f.key] ?? null);
        score(rdT, want, r.values?.[f.key] ?? null);
        line.push(
          `${f.key}=${want ?? "-"} jev:${j.values[f.key] ?? "-"} rd:${r.values?.[f.key] ?? "-"}`,
        );
      }
      noteCases += c.note ? 1 : 0;
      if (j.wantsNote === c.note) jevNotes++;
      if ((r.note !== null) === c.note) rdNotes++;
      console.log(
        line.join(" | "),
        `| note want:${c.note} jev:${j.wantsNote} rd:${r.note !== null}`,
      );
    } catch (e) {
      failed++;
      console.log(`failed: ${(e as Error).message.slice(0, 120)}`);
    }
  }

const fmt = (t: Tally) =>
  `${t.right} right, ${t.wrong} WRONG value, ${t.extra} filled where the mail says nothing, ${t.missed} left empty`;
const n = CASES.length * runs * FIELDS.length;
console.log(
  `\nFields (${n} = ${CASES.length} mails x ${FIELDS.length} fields x ${runs} runs; ${failed} calls failed):`,
);
console.log(`  Jev (both orders):     ${fmt(jevT)}`);
console.log(`  ${readerModel} alone: ${fmt(rdT)}`);
console.log(
  `Note worth writing, said right: Jev ${jevNotes}/${CASES.length * runs}, reader ${rdNotes}/${CASES.length * runs} (${noteCases} cases want one)`,
);
console.log(
  `Tokens: Jev ${jevTokens} in (output free) + reader for notes ${jevReaderTokens}; reader alone ${rdTokens}`,
);
