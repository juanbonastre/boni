/**
 * Boni's pieces (docs/sistema.md §4.2, F7): Boni's own code as steps of a flow, so that what the mail reading does
 * around its models shows on its canvas and in each run's Recorrido instead of running hidden around the plan. A
 * piece is a tool of the effect `piece`: it runs only in a flow (P20), never in a plan a model writes for a turn,
 * and those that change the inbox (folding a thread, accepting alone) only in the flow's own background run (in
 * «Probar» they are said, not run). What each does is the code it was before; the flow only says where it runs.
 * The mail's pieces work on the record that started their flow (`record`: only in a flow a record starts); «Guardar en
 * Correos» on what the mail connector found («Traer correo», D-50); the review's on a review under way («Revisar la
 * guía», D-51).
 */
import { plain, ToolError, type ToolRegistry, type Val } from "@boni/agent";

/** What a piece is given for one account (Mails.piecesFor): the same code the mail reading ran around its plan. */
export interface MailPieces {
  /** The guide's rule for the mail's sender: the collection it sends it to (an option), or null; a rule that says
   * never to read it ends the run, unless Juan asked for this mail. */
  rule(mail: string, asked: boolean): Val;
  /** What that sender has waiting, and the invitation's own title (the reader leaves them out). */
  known(mail: string, again: boolean): Val;
  /** The event of a calendar invitation in the mail (read from its .ics by code), with no uid when one of the
   * account's external calendars already holds it. */
  invitation(mail: string): Promise<Val>;
  /** The relations the mail plainly names, for each collection the flow writes in (by key). */
  relations(mail: string, keys: readonly string[]): Val;
  /** One thread, one proposal: what this run proposed again the same gives way (D-29), looking `days` back (its
   * setting; 60 when the step gives none). How many changed. */
  fold(mail: string, again: boolean, proposals: readonly string[], days?: number): Val;
  /** «Solo» for the mail's proposals (docs/fiabilidad.md §3.4): the ones like those Juan always kept are accepted. */
  acceptAlone(proposals: readonly string[]): Promise<Val>;
  /** «Traer correo»'s «Guardar en Correos»: the new mail the connector found in the mailbox, brought into the mail's
   * collection with its attachments, its original, its invitation and its thread. How many came (0 with none found,
   * and in «Probar», `dry`, which brings nothing). */
  save(dry: boolean): Promise<Val>;
  /** «Revisar la guía»'s «Tus decisiones»: Juan's decisions as the reviewer reads them (external text), the
   * collections it may name, how many, and the rules the code found. */
  reviewDecisions(dry: boolean): Val;
  /** «Medir releyendo»: the reviewer's answer checked and measured by reading mail again (in «Probar», only how much). */
  reviewMeasure(reading: unknown, dry: boolean, mails?: unknown): Promise<Val>;
  /** «Sugerencia»: whether the measured candidate gets more right, and so waits for Juan (never in «Probar»). */
  reviewSuggest(dry: boolean): Val;
}

/** The pieces' names, as a flow's steps call them. */
export const PIECES = [
  "mail.save",
  "guide.decisions",
  "guide.measure",
  "guide.suggest",
  "mail.rule",
  "mail.known",
  "mail.invitation",
  "mail.relations",
  "inbox.fold",
  "inbox.accept_alone",
] as const;

const host = (pieces: unknown): MailPieces => {
  if (!pieces) throw new ToolError("no-pieces");
  return pieces as MailPieces;
};
const text = (v: Val | undefined): string => {
  const x = v ? plain(v) : null;
  return typeof x === "string" ? x : "";
};
const yes = (v: Val | undefined): boolean => !!(v && plain(v));

/** Adds Boni's pieces to a registry (the server's, and the MCP's that describes what a flow may be made of). */
export function withPieces(r: ToolRegistry): ToolRegistry {
  const mail = {
    role: "entity" as const,
    required: true,
    describe: "the mail that started the flow",
  };
  r.register({
    name: "mail.rule",
    icon: "BookCheck",
    effect: "piece",
    area: "boni",
    record: true,
    title: "Regla del remitente",
    describe:
      "the guide's rule for the mail's sender: the collection it sends it to (an option) or null; a rule that says never to read the sender ends the run unless the user asked for this mail",
    args: {
      mail,
      asked: {
        role: "value",
        describe: "the user asked for this mail (a rule that skips it does not)",
      },
    },
    run: (c, a) => host(c.pieces).rule(text(a.mail), yes(a.asked)),
  });
  r.register({
    name: "mail.known",
    icon: "UserCheck",
    effect: "piece",
    area: "boni",
    record: true,
    title: "Ya propuesto",
    describe:
      "what the mail's sender has waiting in the inbox, and its invitation's title: the reader leaves them out",
    args: {
      mail,
      again: {
        role: "value",
        describe: "the user asked to read it again: what waits does not count",
      },
    },
    run: (c, a) => host(c.pieces).known(text(a.mail), yes(a.again)),
  });
  r.register({
    name: "mail.invitation",
    icon: "CalendarCheck",
    effect: "piece",
    area: "boni",
    record: true,
    title: "Leer invitación",
    describe:
      "the event of a calendar invitation in the mail, read from its .ics by code (uid, titulo, dia, inicio, fin, nota, linea); no uid when an external calendar already has it",
    args: { mail },
    run: (c, a) => host(c.pieces).invitation(text(a.mail)),
  });
  r.register({
    name: "mail.relations",
    icon: "Link",
    effect: "piece",
    area: "boni",
    record: true,
    title: "Buscar relaciones",
    describe:
      "for each collection the flow writes in (by key), the relations the mail plainly names: the sender by name, a record whose title its words carry",
    args: {
      mail,
      types: {
        role: "value",
        required: true,
        describe: "the keys of the collections the flow writes in (the code gives them)",
      },
    },
    run: (c, a) => {
      const keys = a.types ? plain(a.types) : null;
      return host(c.pieces).relations(
        text(a.mail),
        Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [],
      );
    },
  });
  r.register({
    name: "inbox.fold",
    icon: "FoldVertical",
    effect: "piece",
    area: "boni",
    changes: true,
    record: true,
    title: "Plegar hilo",
    describe:
      "one thread, one proposal: what this run proposed again the same gives way, and a changed day or hour takes the place of the earlier one",
    args: {
      mail,
      again: { role: "value", describe: "the user asked to read it again: nothing is folded" },
      days: {
        role: "value",
        describe:
          "how many days back the thread's earlier proposals count (1 to 366; 60 when not given)",
      },
    },
    run: (c, a) => {
      const days = a.days ? plain(a.days) : null;
      return host(c.pieces).fold(
        text(a.mail),
        yes(a.again),
        c.proposals(),
        typeof days === "number" ? days : undefined,
      );
    },
  });
  r.register({
    name: "inbox.accept_alone",
    icon: "CheckCheck",
    effect: "piece",
    area: "boni",
    changes: true,
    record: true,
    title: "Aceptar solas",
    describe:
      "with «Solo» on, accepts the proposals of this run that are like the ones the user always kept as they were",
    args: {},
    run: (c) => host(c.pieces).acceptAlone(c.proposals()),
  });
  // «Traer correo» (docs/sistema.md §4.2): what the mail connector found, kept. It changes the mail's collection, so
  // only in a flow's background run (P20); in «Probar» it knows the run is dry and brings nothing.
  r.register({
    name: "mail.save",
    icon: "Save",
    effect: "piece",
    area: "boni",
    changes: true,
    title: "Guardar en Correos",
    describe:
      "brings the new mail the mailbox has into the mail's collection, with its attachments, its original, its calendar invitation (read from its .ics) and its thread; how many came",
    args: {},
    run: (c) => host(c.pieces).save(!!c.dry),
  });
  // «Revisar la guía» (docs/sistema.md §4.2, D-51): what the reviewer learns from, the measure, the suggestion.
  r.register({
    name: "guide.decisions",
    icon: "Scale",
    effect: "piece",
    area: "boni",
    title: "Tus decisiones",
    describe:
      "the user's decisions on the proposals that came from mail, as the reviewer reads them (someone else's text), the collections it may name, how many, and the rules the code already found",
    args: {},
    run: (c) => host(c.pieces).reviewDecisions(!!c.dry),
  });
  r.register({
    name: "guide.measure",
    icon: "Gauge",
    effect: "piece",
    area: "boni",
    title: "Medir releyendo",
    describe:
      "the reviewer's answer, each rule checked against the decisions, measured by reading decided mail again with today's guide and with the new one; in a test, only how much it would read",
    args: {
      reading: { role: "value", describe: "the reviewer's answer: rules and decision ids" },
      mails: {
        role: "value",
        describe:
          "how many decided mails it reads again with each guide (1 to 20; 20 when not given)",
      },
    },
    run: (c, a) =>
      host(c.pieces).reviewMeasure(
        a.reading ? plain(a.reading) : null,
        !!c.dry,
        a.mails !== undefined ? plain(a.mails) : undefined,
      ),
  });
  r.register({
    name: "guide.suggest",
    icon: "Lightbulb",
    effect: "piece",
    area: "boni",
    changes: true,
    title: "Sugerencia",
    describe:
      "keeps the measured suggestion when it gets more of the user's decisions right; it waits for the user in Ajustes → Correo",
    args: {},
    run: (c) => host(c.pieces).reviewSuggest(!!c.dry),
  });
  return r;
}
