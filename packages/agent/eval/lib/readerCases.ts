/**
 * Invented mail shaped like the real kinds that went wrong (a sender's own promise, a request written from the
 * sender's side, the user only in Cc, newsletters, invitations, relative days); each case says what the user
 * should get. The reader's evaluation (`reader.ts`) and the by-hand `eval/mail.ts`.
 */
export interface ReaderCase {
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
  /** The hours the kept item must carry (HH:MM), when the case gives them. */
  start?: string;
  end?: string;
}

export const ME = "juan.ejemplo@example.com";
export const TODAY = "2026-10-21";
export const READER_CASES: ReaderCase[] = [
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
  {
    // What a calendar's invitation mail says in its text part (2026-11-03: «5pm – 6pm» came back without hours).
    name: "an invitation in a calendar's words",
    from: "Secretaría Ejemplo <secretaria.ejemplo@universidad.example>",
    to: `Juan Ejemplo <${ME}>`,
    subject:
      "Invitación: Entrevista de reconocimiento mié 11 nov 2026 5pm - 6pm (CET) (Juan Ejemplo)",
    body: [
      "Entrevista de reconocimiento de créditos",
      "miércoles, 11 de noviembre de 2026 · 5pm – 6pm",
      "Hora de Europa central - Madrid",
      "",
      "Ubicación",
      "Sala 2.3, Edificio Ejemplo",
      "",
      "Invitados",
      "secretaria.ejemplo@universidad.example - organizador",
      `${ME}`,
      "",
      "Responder a Google Calendar: Sí / No / Quizás",
    ].join("\n"),
    events: [/entrevista/i],
    start: "17:00",
    end: "18:00",
  },
];

export const KNOWN: Record<string, string[]> = {
  "a reminder already known": ["Revisar y enviar las propuestas de examen"],
};
/** The day each case's first task or event must have, when it has one. */
export const DAYS: Record<string, string> = {
  "a meeting with the user": "2026-10-27",
  "a group request with a deadline": "2026-11-05",
  "an invitation in a calendar's words": "2026-11-11",
};
