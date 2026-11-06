/**
 * Boni's pieces (docs/sistema.md §4.2, F7): Boni's own code as steps of a flow, so that what the mail reading does
 * around its models shows on its canvas and in each run's Recorrido instead of running hidden around the plan. A
 * piece is a tool of the effect `piece`: it runs only in a flow (P20), never in a plan a model writes for a turn,
 * and those that change the inbox (folding a thread, accepting alone) only in the flow's own background run (in
 * «Probar» they are said, not run). What each does is the code it was before; the flow only says where it runs.
 * Each piece works on the record that started its flow (`record`: only in a flow a record starts).
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
  /** One thread, one proposal: what this run proposed again the same gives way (D-29). How many changed. */
  fold(mail: string, again: boolean, proposals: readonly string[]): Val;
  /** «Solo» for the mail's proposals (docs/fiabilidad.md §3.4): the ones like those Juan always kept are accepted. */
  acceptAlone(proposals: readonly string[]): Promise<Val>;
}

/** The pieces' names, as a flow's steps call them. */
export const PIECES = [
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
    effect: "piece",
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
    effect: "piece",
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
    effect: "piece",
    record: true,
    title: "Leer invitación",
    describe:
      "the event of a calendar invitation in the mail, read from its .ics by code (uid, titulo, dia, inicio, fin, nota, linea); no uid when an external calendar already has it",
    args: { mail },
    run: (c, a) => host(c.pieces).invitation(text(a.mail)),
  });
  r.register({
    name: "mail.relations",
    effect: "piece",
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
    effect: "piece",
    changes: true,
    record: true,
    title: "Plegar hilo",
    describe:
      "one thread, one proposal: what this run proposed again the same gives way, and a changed day or hour takes the place of the earlier one",
    args: {
      mail,
      again: { role: "value", describe: "the user asked to read it again: nothing is folded" },
    },
    run: (c, a) => host(c.pieces).fold(text(a.mail), yes(a.again), c.proposals()),
  });
  r.register({
    name: "inbox.accept_alone",
    effect: "piece",
    changes: true,
    record: true,
    title: "Aceptar solas",
    describe:
      "with «Solo» on, accepts the proposals of this run that are like the ones the user always kept as they were",
    args: {},
    run: (c) => host(c.pieces).acceptAlone(c.proposals()),
  });
  return r;
}
