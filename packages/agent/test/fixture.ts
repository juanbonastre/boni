import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FieldDef, type Label, label, type TypeDef } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { Agent, type AgentOptions } from "../src/agent.ts";
import type { ModelProvider } from "../src/providers.ts";
import { coreTools, ensureSystemTypes, type Net, type ToolRegistry } from "../src/tools.ts";
import { leaf, plain } from "../src/values.ts";

/** Invented data only: the repo is public. */
export const OWN: Label = label("imported", "personal", [{ kind: "vault", id: "ejemplo.md" }]);
export const JUAN: Label = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
export const mailLabel = (id: string): Label =>
  label("external", "personal", [{ kind: "mail", id }], true);

const field = (
  id: string,
  key: string,
  type: FieldDef["type"],
  extra: Partial<FieldDef> = {},
): FieldDef => ({
  id,
  key,
  name: key,
  type,
  label: OWN,
  ...extra,
});
const type = (
  id: string,
  key: string,
  fields: FieldDef[],
  extra: Partial<TypeDef> = {},
): TypeDef => ({
  id,
  key,
  name: key,
  fields,
  titleField: fields[0]?.id as string,
  sensitivity: "personal",
  schemaVersion: 1,
  label: OWN,
  ...extra,
});

export interface Env {
  dir: string;
  store: UserStore;
  sent: { to: string; subject: string; body: string }[];
  fetched: string[];
  notified: string[];
  registry: ToolRegistry;
  ids: Record<string, string>;
  agent(planner: ModelProvider, reader?: ModelProvider, extra?: Partial<AgentOptions>): Agent;
  close(): void;
}

/** A registry with the core tools and two that leave (only in tests: production has none yet). */
export function testRegistry(): ToolRegistry {
  const r = coreTools();
  r.register({
    name: "mail.send",
    effect: "send",
    title: "Enviar correo",
    describe: "Send an e-mail",
    args: {
      to: { role: "recipient", required: true, describe: "address" },
      subject: { role: "content", required: true, describe: "subject" },
      body: { role: "content", required: true, describe: "text" },
    },
    async run({ net: n }, a) {
      await n.send({
        to: String(plain(a.to as never)),
        subject: String(plain(a.subject as never)),
        body: String(plain(a.body as never)),
      });
      return leaf(true, label("own", "public", []));
    },
  });
  r.register({
    name: "web.fetch",
    effect: "egress",
    title: "Descargar",
    describe: "Download a web page",
    args: { url: { role: "url", required: true, describe: "address" } },
    async run({ net: n }, a) {
      return leaf(
        await n.fetchText(String(plain(a.url as never))),
        label("external", "public", [{ kind: "web", id: String(plain(a.url as never)) }]),
      );
    },
  });
  return r.freeze();
}

export function makeEnv(mails: { asunto: string; de: string; cuerpo: string }[] = []): Env {
  const dir = mkdtempSync(join(tmpdir(), "boni-agent-"));
  const store = openUserStore(join(dir, "user.db"), { now: () => Date.UTC(2026, 9, 20, 10) });
  ensureSystemTypes(store);
  const sys = { actor: "import" as const };
  store.applySchema(
    {
      op: "create_type",
      type: type("t_tarea", "tarea", [
        field("f_titulo", "titulo", "text"),
        field("f_fecha", "fecha", "date"),
        field("f_hecho", "hecho", "checkbox"),
      ]),
    },
    sys,
  );
  store.applySchema(
    {
      op: "create_type",
      type: type(
        "t_contacto",
        "contacto",
        [field("f_nombre", "nombre", "text"), field("f_email", "email", "email")],
        { thirdParty: true },
      ),
    },
    sys,
  );
  store.applySchema(
    {
      op: "create_type",
      type: type(
        "t_correo",
        "correo",
        [
          field("f_asunto", "asunto", "text"),
          field("f_de", "de", "text"),
          field("f_cuerpo", "cuerpo", "longtext"),
        ],
        { sensitivity: "personal" },
      ),
    },
    sys,
  );
  store.applySchema(
    {
      op: "create_type",
      type: type(
        "t_mov",
        "movimiento",
        [
          field("f_concepto", "concepto", "text"),
          field("f_importe", "importe", "number", { sensitivity: "sensitive" }),
        ],
        { sensitivity: "sensitive" },
      ),
    },
    sys,
  );
  const ids: Record<string, string> = {};
  ids.ana = store.create(
    "t_contacto",
    {
      f_nombre: { value: "Ana Ejemplo", label: OWN },
      f_email: { value: "ana@example.com", label: OWN },
    },
    sys,
    "e_ana",
  ).entity.id;
  ids.tarea1 = store.create(
    "t_tarea",
    {
      f_titulo: { value: "Comprar pan", label: JUAN },
      f_fecha: { value: "2026-10-21", label: JUAN },
    },
    sys,
    "e_tarea1",
  ).entity.id;
  ids.mov1 = store.create(
    "t_mov",
    { f_concepto: { value: "Cena inventada", label: OWN }, f_importe: { value: 42.5, label: OWN } },
    sys,
    "e_mov1",
  ).entity.id;
  mails.forEach((m, i) => {
    const l = mailLabel(`m${i}`);
    ids[`mail${i}`] = store.create(
      "t_correo",
      {
        f_asunto: { value: m.asunto, label: l },
        f_de: { value: m.de, label: l },
        f_cuerpo: { value: m.cuerpo, label: l },
      },
      { actor: "connector" },
      `e_mail${i}`,
    ).entity.id;
  });
  const sent: Env["sent"] = [];
  const fetched: string[] = [];
  const notified: string[] = [];
  const net: Net = {
    async fetchText(u) {
      fetched.push(u);
      return "<html>ejemplo</html>";
    },
    async send(m) {
      sent.push(m);
    },
  };
  const registry = testRegistry();
  return {
    dir,
    store,
    sent,
    fetched,
    notified,
    registry,
    ids,
    agent: (planner, reader, extra = {}) =>
      new Agent({
        store,
        registry,
        planner,
        reader: reader ?? planner,
        now: () => Date.UTC(2026, 9, 20, 10),
        net,
        notify: (t) => notified.push(t),
        ...extra,
      }),
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const PERSONAL = { kind: "turn", trust: "personal", device: "movil-ejemplo" } as const;
