/**
 * Invented mail in Spanish shaped like Juan's, with the collection its tasks belong to (or none): the decider's
 * evaluation (`decider.ts`) and the by-hand comparison `eval/decide.ts`.
 */
/** The collections, as the mail plan offers them: a name and a few of the user's own titles. */
export const COLLECTIONS: Record<string, string> = {
  Docencia:
    "p. ej.: Examen de Bases de Datos; Poner la asistencia a Mario; Revisar el TFG de Lucía",
  Planes: "p. ej.: Cena con Ana el sábado; Viaje a Valencia; Concierto en el Teatro Romea",
  Gestiones: "p. ej.: Renovar el DNI; Pagar el seguro del coche; Cita en el banco",
  Personas: "p. ej.: Ana Ejemplo; Mario Alumno; Lucía Compañera",
};
export const NAMES = Object.keys(COLLECTIONS);
export const option = (n: string) => `${n} (${COLLECTIONS[n]})`;

export interface DeciderCase {
  mail: string;
  asks: boolean;
  /** Where its tasks belong; null when it asks nothing. */
  goes: string | null;
}
const m = (from: string, subject: string, body: string) =>
  `De: ${from}\nPara: Juan Ejemplo <juan@example.com>\nAsunto: ${subject}\n\n${body}`;
export const DECIDER_CASES: DeciderCase[] = [
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
