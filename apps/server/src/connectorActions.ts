import {
  codeLabel,
  leaf,
  plain,
  type ReadStore,
  ToolError,
  type ToolRegistry,
  typeByKey,
  typeName,
  type Val,
} from "@boni/agent";
import type { UserStore } from "@boni/store";
import { extension, installed, setEnabled } from "./extensions.ts";
import { MAIL_GUIDE_AT, MAIL_SETTINGS_AT, MailError, type Mails } from "./mail.ts";
import { keep, keepingSettings, keepingSettingsAsync } from "./runUndo.ts";

/**
 * The actions of the areas «Conectores» and «Extensiones» (docs/sistema.md §4.1, F10): the mailbox Boni reads (on or
 * off, the collections its tasks may go to, its reading guide and the reviewer's suggestion for it, bringing mail
 * sooner, reading one again for the Bandeja or the last days again) and an extension switched on or off. The planner
 * runs the same code as Ajustes (mail.ts, extensions.ts). What decides how Boni reads Juan's mail or what runs for him
 * is his touch (P21): the model prepares it, he confirms it on the card. The mailbox's server, its user and its
 * password, forgetting it, and a version of an extension are his alone, in Ajustes (A-05, P16): no action. The run
 * keeps the settings each one changed (runUndo.ts), so Undo of the run takes them back.
 */

/** What the server gives a mail action for its run (`ToolDef.service` "mail"). */
export interface MailService {
  mails: Mails;
  account: number;
  store: UserStore;
  run: string;
  inFlow: boolean;
}
const mailOf = (s: unknown, turnOnly = false): MailService => {
  if (!s || typeof s !== "object" || !("mails" in s)) throw new ToolError("not-available");
  const m = s as MailService;
  if (!m.mails.view(m.account)) throw new ToolError("not-configured");
  // Asked from a turn only (flows.ts `TURN_ONLY`): Boni's own flows and its scheduler already do it.
  if (turnOnly && m.inFlow) throw new ToolError("turn-only");
  return m;
};
const wrap = async <T>(f: () => Promise<T> | T): Promise<T> => {
  try {
    return await f();
  } catch (e) {
    if (e instanceof MailError) throw new ToolError(e.code);
    throw e;
  }
};
const code = codeLabel("connectors");
const bool = (v: Val | undefined): boolean | undefined => {
  if (!v) return undefined;
  const x = plain(v);
  if (x === true || x === "true") return true;
  if (x === false || x === "false") return false;
  throw new ToolError("bad-argument");
};
/** The collections a list names, by key («tareas, recados»): only the ones the models see. */
const typesOf = (ro: ReadStore, v: Val): string[] => {
  const x = plain(v);
  const names = Array.isArray(x) ? x : typeof x === "string" ? x.split(",") : null;
  if (!names) throw new ToolError("bad-argument");
  return names.map((n) => typeByKey(ro, String(n).trim()).id);
};

/** The mailbox as the models may know it: never its server, user or password. */
function mailFacts(m: MailService, ro: ReadStore) {
  const v = m.mails.view(m.account);
  if (!v) return { configured: false };
  const types = ro.schema().types;
  const s = v.state.suggestion;
  return {
    configured: true,
    on: v.on,
    collections: v.collections.flatMap((id) => (types[id] ? [typeName(types[id])] : [])),
    lastCheck: v.state.lastCheck || null,
    lastError: v.state.lastError,
    brought: v.state.count,
    waiting: v.state.pending?.length ?? 0,
    // The reviewer's suggestion is shown whole in Ajustes; here, only that it waits and how it measured.
    suggestion: s
      ? {
          rules: s.rules.length,
          examples: s.examples.length,
          before: s.before,
          after: s.after,
          total: s.total,
        }
      : null,
  };
}

export function withConnectorActions(r: ToolRegistry): ToolRegistry {
  r.register({
    name: "connectors.mail_view",
    effect: "read",
    area: "connectors",
    service: "mail",
    title: "Ver el correo",
    describe:
      "How Boni reads Juan's mail: on or off, the collections its tasks may go to, the last check, the mail brought and waiting, and whether a suggestion for the reading guide waits",
    args: {},
    run(c) {
      return leaf(mailFacts(mailOf(c.service), c.store) as never, code);
    },
  });
  r.register({
    name: "connectors.mail",
    effect: "touch",
    area: "connectors",
    service: "mail",
    title: "Ajustar el correo",
    describe:
      "Switch reading Juan's mail on or off, or set the collections (keys, comma-separated) its tasks may be proposed into; he confirms it",
    args: {
      on: { role: "option", describe: "true or false" },
      collections: { role: "content", describe: "the collections' keys, comma-separated" },
    },
    async run(c, a) {
      const m = mailOf(c.service);
      const on = bool(a.on);
      const old = m.mails.settings(m.account)?.collections ?? [];
      // The collections the models do not see stay as Juan set them.
      const hidden = old.filter((id) => !c.store.schema().types[id]);
      const collections = a.collections
        ? [...hidden, ...typesOf(c.store, a.collections)]
        : undefined;
      if (on === undefined && !collections) throw new ToolError("bad-argument");
      await keepingSettingsAsync(m.store, m.run, [MAIL_SETTINGS_AT], () =>
        wrap(() =>
          m.mails.save(m.account, {
            ...(on !== undefined ? { on } : {}),
            ...(collections ? { collections: [...new Set(collections)] } : {}),
          }),
        ),
      );
      return leaf(mailFacts(m, c.store) as never, code);
    },
  });
  r.register({
    name: "connectors.mail_check",
    effect: "write",
    area: "connectors",
    service: "mail",
    title: "Traer correo ahora",
    describe:
      "Bring Juan's new mail now (Boni brings it every few minutes anyway); what it asks goes to the Bandeja",
    args: {},
    async run(c) {
      const m = mailOf(c.service, true);
      await wrap(() => m.mails.check(m.account));
      return leaf(mailFacts(m, c.store) as never, code);
    },
  });
  r.register({
    name: "connectors.mail_propose",
    effect: "write",
    area: "connectors",
    service: "mail",
    title: "Proponer desde este correo",
    describe:
      "Read one mail again for what it asks (id: the mail's record), its proposals to the Bandeja; again: also when it was read before",
    args: {
      id: { role: "entity", required: true, describe: "the mail's id" },
      again: { role: "option", describe: "true: read it again even if it was read" },
    },
    async run(c, a) {
      const m = mailOf(c.service, true);
      const id = a.id ? plain(a.id) : null;
      if (typeof id !== "string" || !c.store.get(id)) throw new ToolError("not-found");
      const r = await wrap(() => m.mails.proposeFor(m.account, id, bool(a.again) === true));
      return leaf({ proposals: r.n, already: r.already, decided: r.decided }, code);
    },
  });
  r.register({
    name: "connectors.mail_reread",
    effect: "write",
    area: "connectors",
    service: "mail",
    // It reads days of mail again with Boni's models: his card (P5), on his budget.
    alwaysConfirm: true,
    title: "Releer el correo",
    describe:
      "Read the last days of Juan's mail again with the current reading guide (days: 1 to 30); proposals it no longer makes are withdrawn; he confirms it",
    args: { days: { role: "limit", describe: "how many days back (7 if none)" } },
    async run(c, a) {
      const m = mailOf(c.service, true);
      const days = a.days ? Number(plain(a.days)) : 7;
      if (!Number.isInteger(days) || days < 1 || days > 30) throw new ToolError("bad-argument");
      const r = await wrap(() => m.mails.reread(m.account, days));
      return leaf({ mails: r.mails, withdrawn: r.withdrawn }, code);
    },
  });
  r.register({
    name: "connectors.mail_guide",
    effect: "touch",
    area: "connectors",
    service: "mail",
    title: "Guía de lectura del correo",
    describe:
      "Write Juan's own words for how his mail is read (the reading guide's instructions, replacing them); he confirms it",
    args: { instructions: { role: "content", required: true, describe: "the instructions" } },
    run(c, a) {
      const m = mailOf(c.service);
      const text = a.instructions ? plain(a.instructions) : null;
      if (typeof text !== "string") throw new ToolError("bad-argument");
      keepingSettings(m.store, m.run, [MAIL_GUIDE_AT], () => {
        try {
          m.mails.saveGuide(m.account, { instructions: text });
        } catch (e) {
          if (e instanceof MailError) throw new ToolError(e.code);
          throw e;
        }
      });
      return leaf({ saved: true }, code);
    },
  });
  r.register({
    name: "connectors.mail_review",
    effect: "write",
    area: "connectors",
    service: "mail",
    title: "Revisar la guía ahora",
    describe:
      "Ask Boni's reviewer now for a suggestion for the mail's reading guide, from Juan's last decisions; it waits for him in Ajustes",
    args: {},
    async run(c) {
      const m = mailOf(c.service, true);
      // «Revisar la guía» off, or no models: Ajustes says so (D-51).
      if (m.mails.reviewOff(m.account)) throw new ToolError("review-off");
      await wrap(() => m.mails.reviewNow(m.account));
      return leaf(mailFacts(m, c.store) as never, code);
    },
  });
  r.register({
    name: "connectors.mail_suggestion",
    effect: "touch",
    area: "connectors",
    service: "mail",
    title: "Responder a la sugerencia",
    describe:
      "Take (accept true) or turn down (false) the reviewer's suggestion waiting for the mail's reading guide; he confirms it",
    args: { accept: { role: "option", required: true, describe: "true or false" } },
    run(c, a) {
      const m = mailOf(c.service);
      const accept = bool(a.accept);
      const s = m.mails.state(m.account).suggestion;
      if (accept === undefined) throw new ToolError("bad-argument");
      if (!s) throw new ToolError("no-suggestion");
      keepingSettings(m.store, m.run, [MAIL_GUIDE_AT], () => {
        try {
          m.mails.answerSuggestion(m.account, s.id, accept);
        } catch (e) {
          if (e instanceof MailError) throw new ToolError(e.code);
          throw e;
        }
      });
      return leaf({ accepted: accept }, code);
    },
  });
  r.register({
    name: "extensions.enable",
    effect: "touch",
    area: "extensions",
    service: "data",
    title: "Activar extensión",
    describe:
      "Switch one of Juan's installed extensions on or off (extension: its id or name); he confirms it",
    args: {
      extension: { role: "option", required: true, describe: "its id or its name" },
      on: { role: "option", required: true, describe: "true or false" },
    },
    run(c, a) {
      if (!c.service || typeof c.service !== "object" || !("store" in c.service))
        throw new ToolError("not-available");
      const s = c.service as { store: UserStore; meta: { run?: string; device?: string } };
      const on = bool(a.on);
      const name = a.extension ? plain(a.extension) : null;
      if (on === undefined || typeof name !== "string") throw new ToolError("bad-argument");
      const key = name.trim().toLowerCase();
      const i =
        extension(s.store, name.trim()) ??
        installed(s.store).find((x) => x.manifest.name.toLowerCase() === key);
      if (!i) throw new ToolError("not-found");
      if (i.enabled === on) throw new ToolError(on ? "already-on" : "already-off");
      setEnabled(s.store, i.manifest.id, on, s.meta.device);
      if (s.meta.run) keep(s.store, s.meta.run, { extension: i.manifest.id, enabled: !on });
      return leaf({ extension: i.manifest.name, enabled: on }, code);
    },
  });
  return r;
}
