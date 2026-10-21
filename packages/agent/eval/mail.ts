/**
 * How well `read_message` reads mail (docs/nucleo.md 7.4b), with real models, outside CI, run by hand with a
 * budget. Invented mail shaped like the real kinds that went wrong (a sender's own promise, a request
 * written from the sender's side, the user only in Cc, newsletters, invitations, relative days); each case
 * says what the user should get. The security does not depend on this (the code decides what is kept and
 * everything is only proposed); it measures whether the prompt reads well, so a change to it can be
 * compared with the one before.
 *
 *   OPENROUTER_API_KEY=... node packages/agent/eval/mail.ts [model] [runs]
 *   default model anthropic/claude-haiku-4.5 (the server's default reader), 2 runs per case.
 */
import { OpenAIProvider } from "../src/openai.ts";
import { delimit } from "../src/readers.ts";
import {
  checkReadMessage,
  MODULES,
  readMessagePrompt,
  readMessageSchema,
  weekdayOf,
} from "../src/reading.ts";

interface Case {
  name: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** Each pattern must match one kept item's title (in module "tasks" or "events"). */
  tasks?: RegExp[];
  events?: RegExp[];
  /** No kept title may match these. */
  never?: RegExp[];
}

const ME = "juan.ejemplo@example.com";
const TODAY = "2026-10-21";
const cases: Case[] = [
  {
    name: "a sender's own promise",
    from: "Mario Alumno <mario@alu.example.com>",
    to: `Juan Ejemplo <${ME}>`,
    subject: "Raspberry",
    body: "Hola profe, mañana a mediodía le entrego la raspberry a usted o a un compañero. Un saludo, Mario",
    never: [/raspberry/i],
  },
  {
    name: "a request written from the sender's side",
    from: "Mario Alumno <mario@alu.example.com>",
    to: `Juan Ejemplo <${ME}>`,
    subject: "Falta del lunes",
    body: "Profe, ¿puede ponerme la asistencia del día que me fui por lo de mi abuela? Gracias",
    tasks: [/asistencia/i],
    never: [/me fui|pedir|solicitar/i],
  },
  {
    name: "a promise and a question",
    from: "Lucía Alumna <lucia@alu.example.com>",
    to: `Juan Ejemplo <${ME}>`,
    subject: "Entrevista",
    body: "Buenas, le enviaré el PDF antes de la entrevista del jueves. ¿Me confirma usted la sala? Gracias",
    tasks: [/sala/i],
    never: [/PDF/],
  },
  {
    name: "only in Cc, a request to someone else",
    from: "Jefa Ejemplo <jefa@example.com>",
    to: "Ana Ejemplo <ana@example.com>",
    cc: `Juan Ejemplo <${ME}>`,
    subject: "Acta",
    body: "Ana, ¿puedes enviar el acta de la reunión antes del viernes? Gracias",
    never: [/acta/i],
  },
  {
    name: "a newsletter",
    from: "Comunicación <noticias@example.com>",
    to: "todos@example.com",
    subject: "Boletín semanal",
    body: "Esta semana: Semana de la Ciencia en los jardines (23-25 oct), congreso de enfermedades raras el 28 y menú especial en la cafetería. ¡Os esperamos!",
    never: [/./],
  },
  {
    name: "a meeting with the user",
    from: "Directora Ejemplo <dir@example.com>",
    to: `Juan Ejemplo <${ME}>`,
    subject: "Reunión",
    body: "Hola, te confirmo la reunión del martes 27 a las 10 en mi despacho para revisar el trabajo.",
    events: [/reuni/i],
  },
  {
    name: "a group request with a deadline",
    from: "Coordinación <coord@example.com>",
    to: "profesorado@example.com",
    subject: "Propuestas de examen",
    body: "Compañeros, revisad las propuestas de examen y enviadlas antes del 5 de noviembre. Gracias.",
    tasks: [/propuestas/i],
  },
  {
    name: "a reminder already known",
    from: "Coordinación <coord@example.com>",
    to: "profesorado@example.com",
    subject: "Recordatorio",
    body: "Os recuerdo que el plazo para enviar las propuestas de examen acaba el 5 de noviembre.",
    never: [/propuestas/i],
  },
];
const KNOWN: Record<string, string[]> = {
  "a reminder already known": ["Revisar y enviar las propuestas de examen"],
};
/** The day each case's first task or event must have, when it has one. */
const DAYS: Record<string, string> = {
  "a meeting with the user": "2026-10-27",
  "a group request with a deadline": "2026-11-05",
};

const model = process.argv[2] ?? "anthropic/claude-haiku-4.5";
const runs = Number(process.argv[3] ?? 2);
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(2);
}
const p = new OpenAIProvider({ apiKey: key, model, baseURL: "https://openrouter.ai/api/v1" });
const system = readMessagePrompt(MODULES);
const where = (c: Case) => (c.to.includes(ME) ? "to" : c.cc?.includes(ME) ? "cc" : "group");
const content = (c: Case) =>
  [`De: ${c.from}`, `Para: ${c.to}`, ...(c.cc ? [`Cc: ${c.cc}`] : []), `Asunto: ${c.subject}`]
    .join("\n")
    .concat(`\n\n${c.body}`);

let pass = 0;
let total = 0;
let tokens = 0;
for (const c of cases) {
  for (let i = 0; i < runs; i++) {
    total++;
    const { marker, text } = delimit(content(c));
    let kept: { module: string; title: string; due: string | null }[] = [];
    let problem = "";
    try {
      const r = await p.complete({
        role: "reader",
        system,
        input: {
          marker,
          today: TODAY,
          weekday: weekdayOf(TODAY),
          user_in: where(c),
          ...(KNOWN[c.name] ? { known: KNOWN[c.name] } : {}),
          content: text,
        },
        schema: readMessageSchema(MODULES),
        maxTokens: 4000,
      });
      tokens += r.usage.input + r.usage.output;
      const checked = checkReadMessage(r.json, MODULES);
      if (!checked) problem = "invalid answer";
      else kept = checked.all;
    } catch (e) {
      problem = String((e as { code?: string }).code ?? (e as Error).message);
    }
    const titles = (m: string) => kept.filter((k) => k.module === m).map((k) => k.title);
    const missing = [
      ...(c.tasks ?? []).filter((re) => !titles("tasks").some((t) => re.test(t))),
      ...(c.events ?? []).filter((re) => !titles("events").some((t) => re.test(t))),
    ];
    const wrong = kept.filter((k) => (c.never ?? []).some((re) => re.test(k.title)));
    const day = DAYS[c.name];
    const badDay = day && kept[0] && kept[0].due !== day ? `day ${kept[0].due}` : "";
    const ok = !problem && !missing.length && !wrong.length && !badDay;
    if (ok) pass++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${c.name}: ${JSON.stringify(kept.map((k) => [k.module, k.title, k.due]))}${
        problem ? ` (${problem})` : ""
      }${badDay ? ` (${badDay})` : ""}`,
    );
  }
}
console.log(`\n${model}: ${pass}/${total} as expected, ${tokens} tokens`);
