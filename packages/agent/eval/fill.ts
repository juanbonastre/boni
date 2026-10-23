/**
 * How well a proposal's other fields are filled (reader `fill`, filling.ts): Jev (the decider, through
 * OpenRouter, as the server runs it when OPENROUTER_API_KEY is set) choosing each value in both orders, plus a
 * reader writing the note only when Jev says it is worth it; against the reader filling everything in one call
 * (the server without a decider). Invented mail in Spanish shaped like Juan's, outside CI, run by hand.
 *
 * What counts most is a wrong value (a field set to an option the mail does not say): the proposal then looks
 * right and is not. A missing value (null where the mail says it) only leaves work to Juan.
 *
 * It also prints Jev's confidences (choice / reversed, or the probability of a checkbox) and replays the same
 * answers under other thresholds, so one run says what lowering them would gain and cost; and two other ways of
 * asking whether a note is worth writing (NOTE_VARIANTS), scored apart.
 *
 *   OPENROUTER_API_KEY=... node packages/agent/eval/fill.ts [runs] [reader model]
 */
import { checkAnswers, type DecisionAnswers, JevProvider } from "../src/decider.ts";
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
  optionNames,
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
  {
    mail: m(
      "ana@example.com",
      "Recuperación de IPM",
      "Juan, hoy no hay clase de IPM; la recuperamos el jueves a las 9 en el aula 1.03.",
    ),
    item: "Clase de recuperación de IPM",
    quote: "la recuperamos el jueves a las 9 en el aula 1.03",
    want: { proyecto: "p_ipm", tipo: "o_clase", lugar: "l_aula", urgente: null },
    note: false,
  },
  {
    mail: m(
      "erasmus@alu.example.com",
      "Acuerdo de aprendizaje",
      "Buenos días, ¿me podría firmar el acuerdo de aprendizaje cuanto antes? Me cierra el plazo este viernes y sin su firma no puedo matricularme.",
    ),
    item: "Firmar el acuerdo de aprendizaje del alumno Erasmus",
    quote: "¿me podría firmar el acuerdo de aprendizaje cuanto antes?",
    want: { proyecto: null, tipo: "o_tramite", lugar: null, urgente: true },
    note: true,
  },
  {
    mail: m(
      "cotutor@example.edu",
      "Seguimiento TFG Lucía",
      "Te propongo una reunión de seguimiento del TFG de Lucía el lunes a las 11, en tu despacho si te viene bien.",
    ),
    item: "Reunión de seguimiento del TFG de Lucía",
    quote: "Te propongo una reunión de seguimiento del TFG de Lucía el lunes a las 11",
    want: { proyecto: "p_tfg", tipo: "o_reunion", lugar: "l_despacho", urgente: null },
    note: false,
  },
  {
    mail: m(
      "info@congreso.example.org",
      "Inscripción",
      "Recuerda inscribirte en el Congreso de ejemplo 2027 antes del 1 de diciembre para mantener la tarifa reducida.",
    ),
    item: "Inscribirse en el Congreso de ejemplo 2027",
    quote: "Recuerda inscribirte en el Congreso de ejemplo 2027 antes del 1 de diciembre",
    want: { proyecto: "p_cong", tipo: "o_tramite", lugar: null, urgente: null },
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

/**
 * Other ways to ask "is a note worth writing?", in the same call (the first run, 2026-10-23: the question now
 * is about a coin; it asks for a note when the only detail is the place, already a field, and not for a
 * deadline). Their answers are scored apart; they do not change what is filled.
 */
const fieldList = FIELDS.map((f) => `«${f.name}»`).join(", ");
const NOTE_VARIANTS = {
  note_b: {
    type: "noul" as const,
    instructions: `¿Dice el correo algo más que el destinatario necesite saber o hacer para el elemento que aparece al final tras «Elemento:», que no esté ya en su título, su fecha y hora ni en ${fieldList}? Por ejemplo: un plazo o una hora límite, qué preparar o llevar, requisitos, condiciones o consecuencias, o a quién avisar.`,
  },
  note_c: {
    type: "noul" as const,
    instructions: `Aparte del título, la fecha, la hora y ${fieldList}, ¿contiene el correo información concreta que haga falta para hacer el elemento que aparece al final tras «Elemento:» (plazos u horas límite, requisitos, materiales, pasos o consecuencias)?`,
  },
};

/** As the agent does with a decider: Jev for the values, the reader for the note only when worth it. */
async function withJev(c: Case) {
  const flat = contentOf(c);
  const q = { ...fillQuestions(FIELDS), ...NOTE_VARIANTS };
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
  return { values, wantsNote, note, answers, jevTokens: r.usage.input, tokens };
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

/** Jev's own answer for field `i`, shown after its value: (choice conf / reversed conf) or (p). */
function conf(a: DecisionAnswers, i: number): string {
  const x = a[`f${i}`];
  const y = a[`f${i}r`];
  if (x?.type === "noul") return `(${x.noul.toFixed(2)})`;
  if (x?.type !== "choice" || y?.type !== "choice") return "";
  const same = x.choice === y.choice ? "" : "≠";
  return `(${x.confidence.toFixed(2)}${same}/${y.confidence.toFixed(2)})`;
}
const kept: { c: Case; answers: DecisionAnswers }[] = [];

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
          `${f.key}=${want ?? "-"} jev:${j.values[f.key] ?? "-"}${conf(j.answers, FIELDS.indexOf(f))} rd:${r.values?.[f.key] ?? "-"}`,
        );
      }
      kept.push({ c, answers: j.answers });
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

// ------------------------------------------------------------ the same answers under other thresholds
/** Jev's answers turned into values by a rule: both orders agreeing (or only the first), and thresholds. */
function valuesBy(a: DecisionAnswers, rule: { choice: number; check: number; agree: boolean }) {
  const out: Record<string, string | boolean | null> = {};
  FIELDS.forEach((f, i) => {
    out[f.key] = null;
    const x = a[`f${i}`];
    if (f.kind === "check") {
      if (x?.type === "noul" && x.noul >= rule.check) out[f.key] = true;
      return;
    }
    const y = a[`f${i}r`];
    if (x?.type !== "choice") return;
    const n = optionNames(f).indexOf(x.choice);
    if (n < 0) return; // "none"
    if (rule.agree) {
      if (y?.type !== "choice" || y.choice !== x.choice) return;
      if (Math.min(x.confidence, y.confidence) < rule.choice) return;
    } else if (x.confidence < rule.choice) return;
    out[f.key] = (f.options[n] as FillField["options"][number]).value;
  });
  return out;
}
const rules: { name: string; choice: number; check: number; agree: boolean }[] = [
  { name: "both orders, >= 0.6, check >= 0.75 (now)", choice: 0.6, check: 0.75, agree: true },
  { name: "both orders, >= 0.5", choice: 0.5, check: 0.75, agree: true },
  { name: "both orders, >= 0.4", choice: 0.4, check: 0.75, agree: true },
  { name: "both orders, any confidence", choice: 0, check: 0.75, agree: true },
  { name: "both orders, >= 0.6, check >= 0.5", choice: 0.6, check: 0.5, agree: true },
  { name: "first order only, >= 0.6", choice: 0.6, check: 0.75, agree: false },
  { name: "first order only, >= 0.8", choice: 0.8, check: 0.75, agree: false },
];
console.log("\nThe same Jev answers under other rules:");
for (const r of rules) {
  const t = blank();
  for (const k of kept) {
    const v = valuesBy(k.answers, r);
    for (const f of FIELDS) score(t, k.c.want[f.key] ?? null, v[f.key] ?? null);
  }
  console.log(`  ${r.name.padEnd(42)} ${fmt(t)}`);
}
for (const q of ["note", "note_b", "note_c"])
  for (const th of [0.3, 0.5, 0.7]) {
    const said = kept.filter((k) => {
      const x = k.answers[q];
      return (x?.type === "noul" && x.noul >= th) === k.c.note;
    });
    const asked = kept.filter((k) => {
      const x = k.answers[q];
      return x?.type === "noul" && x.noul >= th;
    });
    const missed = kept.filter((k) => k.c.note && !asked.includes(k)).length;
    console.log(
      `  ${q === "note" ? "note (now)" : q} worth writing at >= ${th}: said right ${said.length}/${kept.length} (${asked.length - (kept.filter((k) => k.c.note).length - missed)} notes not needed, ${missed} needed and not written)`,
    );
  }
console.log(
  "  per mail, p(note) now / b / c: " +
    CASES.map((c, i) => {
      const a = kept.find((k) => k.c === c)?.answers;
      const p = (q: string) => {
        const x = a?.[q];
        return x?.type === "noul" ? x.noul.toFixed(2) : "-";
      };
      return `${i + 1}${c.note ? "*" : ""}:${p("note")}/${p("note_b")}/${p("note_c")}`;
    }).join(" "),
);
