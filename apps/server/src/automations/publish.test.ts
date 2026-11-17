// Publishing over the real store (docs/automatizaciones.md §5.8: AU-95, AU-96, AU-98, AU-188, AU-191, AU-194, and the
// map of AU-47; phase F14d): a version is a row that never changes, only the published one runs, and a draft never
// does. The rule's id is kept in each test's name (`make check` reads them, T-10). A store per test, with collections
// whose keys and names are shaped like the user's (seed.test-util.ts), and no model call. The map's two (AU-47) are
// S4's and stay pending.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fakePlanner, ToolRegistry } from "@boni/agent";
import {
  type Automation,
  bornParams,
  consentOf,
  type Execution,
  FORMAT,
  type PolicyCall,
} from "@boni/automations";
import { label, newId } from "@boni/entities";
import { cpu, under } from "@boni/pace";
import { HOLDS_OUTSIDE_SQL, openUserStore, type UserStore } from "@boni/store";
import { SYS } from "@boni/views";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, runAction } from "../actions.ts";
import { AgentHost } from "../agent.ts";
import { addUser } from "../auth.ts";
import { openDb } from "../db.ts";
import { Feeds } from "../feeds.ts";
import { flowsCollection } from "../flowsCollection.ts";
import { makeApp, serve } from "../http.ts";
import { LoginGuard } from "../limits.ts";
import { ROUTES } from "../routes.ts";
import { seed, typeId } from "../seed.test-util.ts";
import { withAutomationActions, withPublishActions } from "./actions.ts";
import { automationPolicy } from "./policy.ts";
import {
  docHash,
  outsideOf,
  publish,
  publishView,
  runPublished,
  setEnabled,
  versionOf,
  versionsOf,
} from "./publish.ts";
import { AUTOMATION_ROUTES, PUBLISH_ACTIONS, PUBLISH_ROUTES, RUN_ROUTES } from "./routes.ts";
import {
  automationLabel,
  automationView,
  createAutomation,
  DRAFT_WRITERS,
  duplicateAutomation,
  keepDraft,
  type ServiceError,
  setDeleted,
  testAutomation,
} from "./service.ts";

const NOW = Date.UTC(2026, 10, 17, 9, 0);
const HAND = { device: "d_portatil", now: NOW };
const JUAN = { ...HAND, trust: "personal" as const, zone: "Europe/Madrid" };
const SHARED = { ...JUAN, device: "d_salon", trust: "shared" as const };
const SEED = label("imported", "public", [{ kind: "vault", id: "seed" }]);
const OUTSIDE = label("external", "personal", [{ kind: "mail", id: "m_ejemplo" }]);
const PEDIDO = typeId("pedido");

const dir = mkdtempSync(join(tmpdir(), "boni-publicar-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let store: UserStore;
let n = 0;
/** Two collections shaped like the user's, with a few rows each, as his notes came in. */
const seeded = (s: UserStore) =>
  seed(
    s,
    [
      {
        key: "pedido",
        name: "Pedido",
        folder: "pedidos/",
        fields: { importe: "number", nota: "text" },
      },
      { key: "cliente", name: "Cliente", folder: "clientes/", fields: { nombre: "text" } },
    ],
    {
      "pedidos/uno.md": '---\nimporte: 12\nnota: "primero"\n---\n# Uno\n',
      "pedidos/dos.md": '---\nimporte: 30\nnota: "segundo"\n---\n# Dos\n',
      "clientes/ana.md": '---\nnombre: "Ana Ejemplo"\n---\n# Ana\n',
    },
  );
beforeEach(() => {
  store = openUserStore(join(dir, `u${++n}.db`), { now: () => NOW });
  seeded(store);
});

const stepId = () => newId("o").replace(/^o_/, "s_");
const runId = () => newId("o").replace(/^o_/, "r_");

function ok<T>(x: T | ServiceError | { refused: string }): T {
  if (
    x &&
    typeof x === "object" &&
    ("refused" in x || ("error" in x && Object.keys(x).length === 1))
  )
    throw new Error(`not done: ${JSON.stringify(x)}`);
  return x as T;
}

type StepSpec = [string, string, Record<string, unknown>?];

/** A document from steps by name, each arrow from one to the next unless `loose` names one no arrow reaches. */
function docOf(
  steps: readonly StepSpec[],
  ids: Map<string, string>,
  loose: string[] = [],
): Automation {
  const id = (name: string) => {
    let s = ids.get(name);
    if (!s) {
      s = stepId();
      ids.set(name, s);
    }
    return s;
  };
  const linked = steps.filter(([name]) => !loose.includes(name));
  return {
    format: FORMAT,
    id: "",
    version: 0,
    name: "Revisar pedidos",
    steps: steps.map(([name, type, params]) => ({
      id: id(name),
      name,
      type,
      params: {
        ...bornParams(type, typeof params?.action === "string" ? params.action : undefined),
        ...(params ?? {}),
      } as Automation["steps"][number]["params"],
    })),
    arrows: linked.slice(1).map(([name], i) => ({
      from: { step: id(linked[i]?.[0] as string), output: "main" },
      to: { step: id(name), input: "main" },
    })),
    settings: {},
  } as unknown as Automation;
}

/** «Inicio» → «Crear», which creates an order with this note; its «Permiso» as born («Sí») unless given. */
const writes = (nota: string, permission?: "yes" | "ask", collection = "pedido"): StepSpec[] => [
  ["Inicio", "manual", { fields: [] }],
  [
    "Crear",
    "collection",
    {
      collection,
      action: "create",
      fields: [{ field: collection === "pedido" ? "nota" : "nombre", value: nota }],
      ...(permission ? { permission } : {}),
    },
  ],
];

/** A new automation with these steps; `edit` keeps another draft of it with the same step ids. */
function made(steps: readonly StepSpec[]) {
  const ids = new Map<string, string>();
  const view = ok(createAutomation(store, docOf(steps, ids), HAND));
  const id = view.id;
  return {
    id,
    step: (name: string) => ids.get(name) as string,
    edit(next: readonly StepSpec[], loose: string[] = []) {
      return ok(keepDraft(store, id, { ...docOf(next, ids, loose), id }, HAND)).rev;
    },
    rev: () => ok(automationView(store, id)).rev,
  };
}

/** Publishes the draft as it is now, by Juan's hand on his laptop. */
const published = (id: string) =>
  ok(publish(store, id, { rev: ok(automationView(store, id)).rev }, JUAN));

const notes = () => store.list(PEDIDO).map((e) => e.entity.values.f_nota ?? e.entity.values.nota);
const opLog = () => store.logPage(0, 1_000_000).length;

/** Every version whole, as the store keeps it: what must never change. */
const allVersions = (id: string) =>
  store.journal.automationVersions(id).map((v) => store.journal.automationVersion(id, v.n));

/** The server's own non-test sources, by path. */
function sources(root = join(import.meta.dirname, "..")): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules") for (const [k, v] of sources(p)) out.set(k, v);
    } else if (name.endsWith(".ts") && !name.includes(".test") && !name.includes("test-util"))
      out.set(p, readFileSync(p, "utf8"));
  }
  return out;
}

/** A write call of the «Crear» step, as the engine's gate asks the policy. */
const createCall = (id: string, version: number, step: string): PolicyCall => ({
  automation: { id, version },
  step,
  type: "collection",
  action: "create",
  effect: "write",
  destroys: false,
  collection: "pedido",
  values: { nota: { value: "x", label: label("user", "personal", []), derived: false } },
  control: null,
  test: false,
});

describe("only the published version runs (F14d)", () => {
  it("AU-95 · with a draft that would write one thing and a published version that writes another, every route of automations/routes.ts that runs for real writes only what the published version writes, and each operation of the log carries a run that names that version", async () => {
    const a = made(writes("publicada"));
    expect(published(a.id)).toEqual({ version: 1, enabled: true });
    a.edit(writes("borrador"));
    const r = runId();
    const e = ok(
      await runPublished(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, r),
    ) as Execution;
    expect(e.state, JSON.stringify(e.error)).toBe("done");
    expect(e.test).toBe(false);
    expect(e.automation).toEqual({ id: a.id, version: 1 });
    expect(notes()).toContain("publicada");
    expect(notes()).not.toContain("borrador");
    const ops = store.runOps(r);
    // Every operation it saved carries the run: `runOps` finds them by it.
    expect(ops).toHaveLength(1);

    // No route runs for real but through `runPublished`: none of the routes, routed or waiting for their screens,
    // names a function that does, and in the server's sources only publish.ts gives the engine a run for real.
    const routes = { ...AUTOMATION_ROUTES, ...PUBLISH_ROUTES, ...RUN_ROUTES };
    for (const [route, { runs }] of Object.entries(routes))
      expect(["runPublished", "runDeps"], route).not.toContain(runs);
    const real = [...sources()].filter(
      ([, text]) =>
        /test: false/.test(text) || /runDeps\([^;]*,[^;]*,[^;]*,[^;]*,[^;]*\)/.test(text),
    );
    expect(real.map(([p]) => p.split("/src/")[1])).toEqual(["automations/publish.ts"]);
  });

  it("AU-95 · an automation never published is run by no route and by no schedule, and «Probar» still tests its draft and writes nothing", async () => {
    const a = made(writes("nunca"));
    const log = opLog();
    expect(
      await runPublished(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, runId()),
    ).toEqual({ refused: "unpublished" });
    // What a run for real is built with refuses a draft: a draft never runs for real.
    const { runDeps } = await import("./service.ts");
    expect(() => runDeps(store, a.id, JUAN, undefined, runId())).toThrow(/no published version/);
    const t = ok(
      await testAutomation(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN),
    );
    expect(t.state, JSON.stringify(t.problems)).toBe("done");
    expect(opLog()).toBe(log);
    expect(notes()).not.toContain("nunca");
    // A schedule is S2's: whatever starts a run for real starts it through `runPublished`, which the test above holds.
  });

  it("AU-95 · the function that runs for real takes no document: no body, query or header of a request reaches the engine as the automation to run", async () => {
    const a = made(writes("publicada"));
    published(a.id);
    const forged = { ...docOf(writes("falsa"), new Map()), id: a.id, version: 1 };
    const request = { trigger: a.step("Inicio"), fields: {}, automation: forged, doc: forged };
    const e = ok(await runPublished(store, a.id, request as never, JUAN, runId())) as Execution;
    expect(e.state).toBe("done");
    expect(notes()).toContain("publicada");
    expect(notes()).not.toContain("falsa");
    // Its parameters: the store, the id, the trigger and its fields, the hand, the run and the box. No document.
    expect(runPublished.length).toBeLessThanOrEqual(6);
    const text = readFileSync(join(import.meta.dirname, "publish.ts"), "utf8");
    const head = text.slice(text.indexOf("export async function runPublished("));
    const params = head.slice(0, head.indexOf(")"));
    expect(params).not.toMatch(/Automation|doc/);
  });

  it("AU-95 · publishing writes a version that is never changed afterwards (its document, its number, its hash, when, from which device and whose), and the same document as the one that runs writes no new version", () => {
    const a = made(writes("primera"));
    published(a.id);
    const v = store.journal.automationVersion(a.id, 1);
    expect(v).toMatchObject({ n: 1, at: NOW, device: "d_portatil", by: "user" });
    const doc = JSON.parse(v?.doc ?? "{}") as Automation;
    expect(doc.version).toBe(1);
    expect(v?.hash).toBe(docHash(doc));
    // The same document again: nothing to publish, and «Publicar» says so.
    expect(publish(store, a.id, { rev: a.rev() }, JUAN)).toEqual({ refused: "unchanged" });
    expect(ok(publishView(store, a.id)).same).toBe(true);
    expect(store.journal.automationVersions(a.id)).toHaveLength(1);
    // The store refuses to change or remove a version, whoever tries.
    const sql = openDbOf();
    expect(() => sql.exec("UPDATE automation_versions SET doc = '{}'")).toThrow(/never changes/);
    expect(() => sql.exec("DELETE FROM automation_versions")).toThrow(/is never removed/);
    a.edit(writes("segunda"));
    published(a.id);
    expect(store.journal.automationVersion(a.id, 1)).toEqual(v);
  });

  it("AU-95 · publishing asks for the draft's `rev`: a draft changed since by another device is not published, and the answer says so", () => {
    const a = made(writes("vista"));
    const seen = a.rev();
    a.edit(writes("cambiada en el teléfono"));
    expect(publish(store, a.id, { rev: seen }, JUAN)).toEqual({ refused: "stale", rev: seen + 1 });
    expect(store.journal.automationVersions(a.id)).toEqual([]);
    expect(store.journal.automation(a.id)?.published).toBeNull();
  });

  it("AU-95 · the tables of versions are in the user's store and none of their rows is an operation of the log: Undo never takes back a publish", () => {
    const a = made(writes("primera"));
    const log = opLog();
    published(a.id);
    expect(opLog()).toBe(log);
    // An operation of Juan's after it, undone: the version and the switch stay.
    const before = allVersions(a.id);
    const made2 = store.create(PEDIDO, {}, { actor: "user", device: "d_portatil" });
    const seq = store.logPage(log, 10).at(-1)?.seq as number;
    store.undo(seq, { actor: "user", device: "d_portatil" });
    expect(store.get(made2.entity.id)?.entity.deleted).toBeDefined();
    expect(allVersions(a.id)).toEqual(before);
    expect(store.journal.automation(a.id)).toMatchObject({ published: 1, enabled: true });
  });
});

/** The file under this test's store, opened beside it: for the statements that try to change a version. */
const openDbOf = () => new DatabaseSync(join(dir, `u${n}.db`));

describe("what «Publicar» answers (F14d)", () => {
  it("AU-96 · the route that «Publicar» reads gives the three things for the draft of now (what changes against the version that runs, what is missing or worth a look, what it will be able to do), and the first time says that publishing turns it on", async () => {
    const a = made(writes("primera"));
    const first = ok(publishView(store, a.id));
    expect(first).toMatchObject({
      running: null,
      first: true,
      same: false,
      diff: null,
      blocks: [],
    });
    expect(first.abilities).toEqual([
      { collection: "pedido", action: "create", how: "saves", steps: [a.step("Crear")] },
    ]);
    // Never tested: worth a look, and it stops nothing.
    expect(first.looks.map((l) => l.code)).toContain("step.untested");
    published(a.id);
    a.edit(
      [...writes("segunda"), ["Suelto", "collection", { collection: "pedido", action: "find" }]],
      ["Suelto"],
    );
    const next = ok(publishView(store, a.id));
    expect(next).toMatchObject({ running: 1, first: false, same: false });
    expect(next.diff?.added).toEqual([a.step("Suelto")]);
    expect(next.diff?.changed.map((c) => c.step)).toEqual([a.step("Crear")]);
    expect(next.looks).toContainEqual({ code: "step.unreachable", step: a.step("Suelto") });
    // A pinned output is worth a look too (AU-93): «Publicar» reminds that a real run does not use it.
    store.journal.pinAutomationStep({
      id: a.id,
      step: a.step("Crear"),
      print: "p",
      at: Date.now(),
      record: "{}",
      rows: {},
    });
    expect(ok(publishView(store, a.id)).looks).toContainEqual({
      code: "output.pinned",
      step: a.step("Crear"),
    });

    // Over HTTP, as the app reads it: the same answer, through `automations.read`.
    const { server, host, call } = await served();
    try {
      const own = host.store(1);
      seeded(own);
      const ids = new Map<string, string>();
      const view = ok(createAutomation(own, docOf(writes("por http"), ids), HAND));
      const got = await call("GET", `/api/agent/automations/${view.id}/publish`);
      expect(got.status).toBe(200);
      expect(got.body).toMatchObject({ running: null, first: true, same: false, blocks: [] });
      expect(ROUTES["GET /api/agent/automations/:id/publish"]).toBe("tailnet");
    } finally {
      server.close();
    }
  });

  it("AU-96 · the server refuses to publish with a problem, or an empty required parameter, on a step a trigger reaches, whatever the app sent; with the same problem on a step no trigger reaches it publishes", () => {
    const a = made([
      ...writes("bien"),
      ["Roto", "collection", { collection: "inexistente", action: "find" }],
    ]);
    const p = publish(store, a.id, { rev: a.rev() }, JUAN);
    expect(p).toMatchObject({ refused: "blocked" });
    expect(
      (p as { problems: { step?: string }[] }).problems.some((x) => x.step === a.step("Roto")),
    ).toBe(true);
    // An empty required parameter, on a reached step.
    a.edit([...writes("bien"), ["Roto", "collection", { collection: "", action: "find" }]]);
    expect(publish(store, a.id, { rev: a.rev() }, JUAN)).toMatchObject({ refused: "blocked" });
    expect(store.journal.automationVersions(a.id)).toEqual([]);
    // The same step, now reached by no trigger: it will not run, so it does not stop the publish.
    a.edit(
      [...writes("bien"), ["Roto", "collection", { collection: "inexistente", action: "find" }]],
      ["Roto"],
    );
    expect(publish(store, a.id, { rev: a.rev() }, JUAN)).toEqual({ version: 1, enabled: true });
  });
});

describe("«Versiones» (F14d)", () => {
  it("AU-98 · the list gives each version's number, when, whose («user»; «preset» reads «De Boni») and which one runs, without reading any document", () => {
    const a = made(writes("una"));
    for (const nota of ["dos", "tres", "cuatro"]) {
      published(a.id);
      a.edit(writes(nota));
    }
    published(a.id);
    const list = ok(versionsOf(store, a.id));
    expect(list.running).toBe(4);
    expect(list.enabled).toBe(true);
    expect(list.versions.map((v) => v.n)).toEqual([4, 3, 2, 1]);
    for (const v of list.versions) {
      expect(Object.keys(v).sort()).toEqual(["at", "by", "device", "hash", "id", "n"]);
      expect(v.by).toBe("user");
    }
    // One whole, to look at it: its document as it runs.
    const two = ok(versionOf(store, a.id, 2));
    expect(two.automation.version).toBe(2);
    expect(JSON.stringify(two.automation)).toContain("dos");
  });

  it("AU-98 · going back to the 2 from the 4 publishes a 5 with the document of the 2, after the same checks as any publish, and leaves the draft, with its unpublished changes, exactly as it was", () => {
    const a = made(writes("una"));
    for (const nota of ["dos", "tres", "cuatro"]) {
      published(a.id);
      a.edit(writes(nota));
    }
    published(a.id);
    a.edit(writes("a medias"));
    const draft = store.journal.automationDraft(a.id);
    const back = ok(publishView(store, a.id, 2));
    expect(back.running).toBe(4);
    expect(back.diff?.changed.map((c) => c.step)).toEqual([a.step("Crear")]);
    expect(publish(store, a.id, { version: 2 }, JUAN)).toEqual({ version: 5, enabled: true });
    const five = ok(versionOf(store, a.id, 5));
    const two = ok(versionOf(store, a.id, 2));
    expect({ ...five.automation, version: 0 }).toEqual({ ...two.automation, version: 0 });
    expect(five.hash).toBe(two.hash);
    expect(store.journal.automationDraft(a.id)).toEqual(draft);
    // Going back to the one that runs is nothing to publish.
    expect(publish(store, a.id, { version: 2 }, JUAN)).toEqual({ refused: "unchanged" });
  });

  it("AU-98 · going back to a version whose collection no longer exists is refused with the problem named, and nothing is published", () => {
    const a = made(writes("Ana Otra", undefined, "cliente"));
    published(a.id);
    a.edit(writes("dos"));
    published(a.id);
    store.applySchema(
      { op: "archive_type", type: typeId("cliente"), archived: true },
      { actor: "user", device: "d_portatil" },
    );
    const p = publish(store, a.id, { version: 1 }, JUAN);
    expect(p).toMatchObject({ refused: "blocked" });
    const problems = (p as { problems: { step?: string; code: string }[] }).problems;
    expect(problems.some((x) => x.step === a.step("Crear"))).toBe(true);
    expect(ok(publishView(store, a.id, 1)).blocks).toEqual(problems);
    expect(store.journal.automationVersions(a.id).map((v) => v.n)).toEqual([2, 1]);
    expect(store.journal.automation(a.id)?.published).toBe(2);
  });
});

describe("the switch and a deleted automation (F14d)", () => {
  it("AU-194 · the first publish turns the automation on and a later publish leaves the switch as it was; off, no real run starts, at its hour or by «Ejecutar», and «Probar» still works", async () => {
    const a = made(writes("una"));
    expect(setEnabled(store, a.id, true, JUAN)).toEqual({ refused: "unpublished" });
    expect(published(a.id)).toEqual({ version: 1, enabled: true });
    expect(setEnabled(store, a.id, false, JUAN)).toEqual({ enabled: false });
    a.edit(writes("dos"));
    expect(published(a.id)).toEqual({ version: 2, enabled: false });
    const log = opLog();
    expect(
      await runPublished(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, runId()),
    ).toEqual({ refused: "off" });
    expect(opLog()).toBe(log);
    const t = ok(
      await testAutomation(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN),
    );
    expect(t.state).toBe("done");
    expect(opLog()).toBe(log);
    // On again, a later publish keeps it on.
    expect(setEnabled(store, a.id, true, JUAN)).toEqual({ enabled: true });
    a.edit(writes("tres"));
    expect(published(a.id)).toEqual({ version: 3, enabled: true });
  });

  it("AU-194 · turning it on runs nothing that was due while it was off", () => {
    const a = made(writes("una"));
    published(a.id);
    setEnabled(store, a.id, false, JUAN);
    const log = opLog();
    const before = notes();
    expect(setEnabled(store, a.id, true, JUAN)).toEqual({ enabled: true });
    // Nothing ran: no operation, no row, nothing waiting in the journal (a run is S2's table; none exists here).
    expect(opLog()).toBe(log);
    expect(notes()).toEqual(before);
  });

  it("AU-191 · a deleted automation runs at no hour and by no hand, keeps its draft, its versions and its runs, is listed among the deleted ones, and recovered comes back off with all of them", async () => {
    const a = made(writes("una"));
    published(a.id);
    const r = runId();
    ok(await runPublished(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, r));
    const draft = store.journal.automationDraft(a.id);
    const versions = allVersions(a.id);
    expect(setDeleted(store, a.id, true)).toEqual({ ok: true });
    expect(store.journal.automation(a.id)).toMatchObject({ deleted: true, enabled: false });
    expect(
      await runPublished(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, runId()),
    ).toEqual({ error: "not-found" });
    expect(store.journal.deletedAutomations().map((x) => x.id)).toEqual([a.id]);
    expect(store.journal.automations().map((x) => x.id)).not.toContain(a.id);
    // «Recuperar»: back, off, with its draft, its versions and what its run saved.
    expect(setDeleted(store, a.id, false)).toEqual({ ok: true });
    expect(store.journal.automation(a.id)).toMatchObject({
      deleted: false,
      enabled: false,
      published: 1,
    });
    expect(store.journal.automationDraft(a.id)).toEqual(draft);
    expect(allVersions(a.id)).toEqual(versions);
    expect(store.runOps(r)).toHaveLength(1);
    expect(store.journal.deletedAutomations()).toEqual([]);
  });
});

describe("a «Sí» only from the user's hand, on the server (F14d)", () => {
  it("AU-188 · every function of the service that writes a draft is in one list, as the user's hand or as arriving without it, and each of the second kind passes through `lowerYes`: a new one missing from the list fails this test", () => {
    // Each top-level function of the server's sources, with its file, its name and its text up to the next one.
    const files = sources();
    const bodies: { path: string; name: string; body: string }[] = [];
    for (const [path, text] of files) {
      const starts = [...text.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)];
      for (const [i, m] of starts.entries())
        bodies.push({
          path,
          name: m[1] as string,
          body: text.slice(m.index, starts[i + 1]?.index ?? text.length),
        });
    }
    /** Whether a function of the file `path` reaches `name` of the file `of`: the same file, or an import of it. */
    const reaches = (path: string, name: string, of: string) => {
      if (path === of) return true;
      for (const m of (files.get(path) ?? "").matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g))
        if (
          join(path, "..", m[2] as string) === of &&
          (m[1] as string).split(",").some((x) => x.trim().replace(/^type /, "") === name)
        )
          return true;
      return false;
    };
    // What writes a draft: a function that calls one of the journal's two writes of one, and a function that calls
    // one of those (an action, a route's handler).
    const direct = bodies.filter(({ body }) =>
      /\.(saveAutomationDraft|createAutomation)\(/.test(body),
    );
    const writers = new Set(direct.map((f) => f.name));
    for (const f of bodies)
      if (
        direct.some(
          (w) =>
            w !== f &&
            new RegExp(`(?<![.\\w])${w.name}\\(`).test(f.body) &&
            reaches(f.path, w.name, w.path),
        )
      )
        writers.add(f.name);
    expect([...writers].sort()).toEqual(Object.keys(DRAFT_WRITERS).sort());
    for (const [name, how] of Object.entries(DRAFT_WRITERS))
      if (how === "outside")
        for (const f of bodies) if (f.name === name) expect(f.body, name).toMatch(/\blowerYes\(/);
  });

  it("AU-188 · the ways a «Sí» stays, one case each: the user's hand on the cell in the editor, a duplicate (born unpublished), going back to a version the user published, and a deleted automation recovered by «Recuperar» or by its notice's «Deshacer» (off, and with no «Sí» it did not have)", () => {
    const yesOf = (doc: Automation, step: string) => {
      const s = doc.steps.find((x) => x.id === step);
      return s ? consentOf(s, "pedido", "create") : false;
    };
    // His hand on the cell: «Preguntar» first, then «Sí», kept and published.
    const a = made(writes("una", "ask"));
    expect(yesOf(ok(automationView(store, a.id)).automation, a.step("Crear"))).toBe("ask");
    a.edit(writes("una", "yes"));
    expect(yesOf(ok(automationView(store, a.id)).automation, a.step("Crear"))).toBe("yes");
    published(a.id);
    expect(yesOf(ok(versionOf(store, a.id, 1)).automation, a.step("Crear"))).toBe("yes");
    // A duplicate: his «Sí» copied, the copy unpublished and off.
    const copy = ok(duplicateAutomation(store, a.id, "Revisar pedidos (copia)", HAND));
    expect(yesOf(copy.automation, a.step("Crear"))).toBe("yes");
    expect(store.journal.automation(copy.id)).toMatchObject({ published: null, enabled: false });
    // Going back to the version he published with «Sí», after one with «Preguntar».
    a.edit(writes("una", "ask"));
    published(a.id);
    expect(publish(store, a.id, { version: 1 }, JUAN)).toEqual({ version: 3, enabled: true });
    expect(yesOf(ok(versionOf(store, a.id, 3)).automation, a.step("Crear"))).toBe("yes");
    // Recovered, by «Recuperar» or the notice's «Deshacer» (the same restore): off, with exactly what it had.
    const draft = store.journal.automationDraft(a.id);
    const versions = allVersions(a.id);
    setDeleted(store, a.id, true);
    setDeleted(store, a.id, false);
    expect(store.journal.automation(a.id)).toMatchObject({ enabled: false, published: 3 });
    expect(store.journal.automationDraft(a.id)).toEqual(draft);
    expect(allVersions(a.id)).toEqual(versions);
  });

  it("AU-188 · no Undo gives a «Sí» back or takes one away: the store's undo, a turn's and a run's leave every draft and every version as they were, since none is an operation of the log", async () => {
    const a = made(writes("una", "yes"));
    published(a.id);
    a.edit(writes("una", "ask"));
    const draft = store.journal.automationDraft(a.id);
    const versions = allVersions(a.id);
    const log = opLog();
    // A run of the version saves a row; undoing the run takes the row back and nothing else.
    const r = runId();
    ok(await runPublished(store, a.id, { trigger: a.step("Inicio"), fields: {} }, JUAN, r));
    store.undoRun(r, { actor: "user", device: "d_portatil" });
    // The store's own undo of the last operation (what a turn's «Deshacer» does, one operation at a time).
    const last = store.logPage(0, 1_000_000).at(-1)?.seq as number;
    store.undo(last, { actor: "user", device: "d_portatil" });
    expect(store.journal.automationDraft(a.id)).toEqual(draft);
    expect(allVersions(a.id)).toEqual(versions);
    // No operation of the log is a draft's or a version's: every one since is the run's row and its undoing.
    for (const op of store.logPage(log, 1_000_000)) expect(op.target).not.toBe(a.id);
  });

  it("AU-188 · setting a «Sí» and publishing are refused from a device that is not personal; reading and testing are not", async () => {
    const a = made(writes("una"));
    expect(publish(store, a.id, { rev: a.rev() }, SHARED)).toEqual({ refused: "not-personal" });
    expect(store.journal.automationVersions(a.id)).toEqual([]);
    ok(publish(store, a.id, { rev: a.rev() }, JUAN));
    expect(setEnabled(store, a.id, false, SHARED)).toEqual({ refused: "not-personal" });
    expect(ok(publishView(store, a.id)).running).toBe(1);
    const t = ok(
      await testAutomation(store, a.id, { trigger: a.step("Inicio"), fields: {} }, SHARED),
    );
    expect(t.state).toBe("done");

    // The actions, through `runAction` as the routes call them, from a shared device: refused; read: not.
    const registry = withPublishActions(withAutomationActions(new ToolRegistry()));
    const shared = { store, trust: "shared" as const, device: "d_salon", registry };
    expect(Object.keys(PUBLISH_ACTIONS).every((x) => registry.get(x))).toBe(true);
    const r = await runAction("automations.publish", { id: a.id, rev: a.rev() }, shared);
    expect(JSON.stringify(r)).toMatch(/not-personal|refused/);
    const read = await runAction("automations.read", { id: a.id, part: "versions" }, shared);
    expect("out" in read).toBe(true);
    // Registered for everyone with their controls (P1), each route listed and run by its action.
    for (const [route, { action }] of Object.entries(PUBLISH_ROUTES)) {
      expect(ACTIONS.get(action)?.name, route).toBe(action);
      expect(ROUTES[route], route).toBe("tailnet");
    }

    // Over HTTP from a shared device: a draft save is refused; «Probar» and the reads are not.
    const { server, host, call, trust } = await served();
    try {
      const own = host.store(1);
      seeded(own);
      const view = ok(createAutomation(own, docOf(writes("por http"), new Map()), HAND));
      trust("shared");
      const path = `/api/agent/automations/${view.id}`;
      const kept = await call("PUT", `${path}/draft`, { automation: view.automation });
      expect(kept).toEqual({ status: 403, body: { error: "personal-device-only" } });
      expect((await call("GET", `${path}/versions`)).status).toBe(200);
      const trigger = view.automation.steps[0]?.id as string;
      const tested = await call("POST", `${path}/test`, { trigger, fields: {} });
      expect(tested.status, JSON.stringify(tested.body)).toBe(200);
      // «Publicar» and the switch: refused from the shared device, done from his own (AU-95, AU-194).
      const rev = Number((await call("GET", path)).body.rev);
      // «Estado» in the list (AU-194): «Sin publicar», then what the switch says.
      const F = SYS.flows;
      const state = () =>
        flowsCollection(own).rows.find((r) => r.id === `${F.automation}${view.id}`)?.values[
          F.state
        ];
      expect(state()).toBe(F.unpublished);
      expect(await call("POST", `${path}/publish`, { rev })).toEqual({
        status: 403,
        body: { error: "personal-device-only" },
      });
      expect((await call("PUT", `${path}/enabled`, { enabled: false })).status).toBe(403);
      trust("personal");
      expect(await call("POST", `${path}/publish`, { rev: rev + 7 })).toEqual({
        status: 200,
        body: { refused: "stale", rev },
      });
      expect(await call("POST", `${path}/publish`, { rev })).toEqual({
        status: 200,
        body: { version: 1, enabled: true },
      });
      expect((await call("GET", `${path}/versions`)).body.running).toBe(1);
      expect(state()).toBe(F.on);
      expect(await call("PUT", `${path}/enabled`, { enabled: false })).toEqual({
        status: 200,
        body: { enabled: false },
      });
      expect(state()).toBe(F.off);
      expect((await call("PUT", `${path}/enabled`, {})).status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("AU-182 · opening «Publicar» says which of the collections the version reads hold a value from outside today, by one query per collection that reads no row whole and stays within its time at 3,000 rows", () => {
    const reads: StepSpec[] = [
      ["Inicio", "manual", { fields: [] }],
      ["Buscar", "collection", { collection: "pedido", action: "find", limit: 5000 }],
      ["Clientes", "collection", { collection: "cliente", action: "find" }],
      // A write with its born «Sí», whose rows come by the path that read the orders.
      [
        "Crear",
        "collection",
        {
          collection: "cliente",
          action: "create",
          fields: [{ field: "nombre", value: "Ana Otra" }],
        },
      ],
    ];
    const a = made(reads);
    const clean = ok(publishView(store, a.id));
    expect(clean.outside).toEqual([]);
    expect(clean.abilities.some((l) => l.outside)).toBe(false);
    // 3,000 orders from the seed, and one more whose note came from outside, the last one.
    const nota = store.schema().types[PEDIDO]?.fields.find((f) => f.key === "nota")?.id as string;
    store.batch(() => {
      for (let i = 0; i < 3000; i++)
        store.create(
          PEDIDO,
          { [nota]: { value: `pedido ${i}`, label: SEED } },
          { actor: "import", device: "seed" },
        );
    });
    expect(ok(publishView(store, a.id)).outside).toEqual([]);
    store.create(
      PEDIDO,
      { [nota]: { value: "de un correo", label: OUTSIDE } },
      { actor: "import", device: "seed" },
    );
    const start = cpu();
    const outside = outsideOf(store, ok(automationView(store, a.id)).automation);
    under(cpu() - start, 50, "cpu");
    expect([...outside]).toEqual(["pedido"]);
    const view = ok(publishView(store, a.id));
    expect(view.outside).toEqual(["pedido"]);
    expect(
      view.abilities.find((l) => l.collection === "pedido" && l.action === "read"),
    ).toBeDefined();
    // «con datos de fuera» on the write with «Sí» the orders reach; on none before an order came from outside.
    expect(
      view.abilities.find((l) => l.collection === "cliente" && l.action === "create"),
    ).toMatchObject({ how: "saves", outside: true });
    // The store's own statement, one per collection read, over the labels by the collection's index: never a row
    // read whole.
    const sql = openDbOf();
    const plan = sql.prepare(`EXPLAIN QUERY PLAN ${HOLDS_OUTSIDE_SQL}`).all(PEDIDO) as {
      detail: string;
    }[];
    expect(plan.map((p) => p.detail).join(" | ")).toMatch(/USING (COVERING )?INDEX entities_type/);
  });

  it("AU-188 · the «Sí» a run obeys is read from the published version in the store: one claimed by the box's answer, by a request's body or by a draft changes nothing", async () => {
    const a = made(writes("una", "ask"));
    published(a.id);
    // The draft says «Sí»; the version that runs says «Preguntar».
    a.edit(writes("una", "yes"));
    const r = runId();
    const e = ok(
      await runPublished(
        store,
        a.id,
        { trigger: a.step("Inicio"), fields: {}, yes: true } as never,
        JUAN,
        r,
      ),
    ) as Execution;
    expect(e.state).toBe("done");
    expect(e.asked).toHaveLength(1);
    expect(store.runOps(r)).toEqual([]);
    // The policy a run is built with reads the stored version: the draft's «Sí» is not in it, and a call that claims
    // one (as a forged answer of the box would) gets none.
    const { runDeps } = await import("./service.ts");
    const policy = runDeps(store, a.id, JUAN, undefined, runId()).policy;
    const call = createCall(a.id, 1, a.step("Crear"));
    expect(policy.decide(call).kind).toBe("propose");
    expect(policy.decide({ ...call, yes: true } as PolicyCall).kind).toBe("propose");
    // Published with his «Sí», the same call saves.
    published(a.id);
    const yes = runDeps(store, a.id, JUAN, undefined, runId()).policy;
    expect(yes.decide(createCall(a.id, 2, a.step("Crear"))).kind).toBe("allow");
    expect(automationPolicy(undefined, automationLabel(a.id)).decide(call).kind).toBe("propose");
  });
});

describe("the map (F14d)", () => {
  it.todo(
    "AU-47 · a published automation enters the map with what its published version reads and writes and with its trigger; its draft never does, and a change of the draft moves nothing in the map until it is published",
  );
  it.todo(
    "AU-47 · the map counts an automation's runs by the index, never reading them, and a test does not count",
  );
});

// ---------------------------------------------------------------- the server over HTTP

const SIGN_IN = "una contraseña larga de ejemplo";
/** The server on the tailnet entry, with its own accounts and Juan's store in its host, signed in from a laptop. */
async function served() {
  const home = mkdtempSync(join(dir, "http-"));
  const db = openDb(join(home, "system.db"));
  addUser(db, "juan", SIGN_IN);
  const planner = fakePlanner([]);
  const host = new AgentHost({ dataDir: home, providers: { planner, reader: planner } });
  const app = makeApp({
    db,
    key: randomBytes(32),
    feeds: new Feeds(async () => ""),
    guard: new LoginGuard({ perUser: 50, perAddress: 100, windowMs: 60_000, perMinute: 100 }),
    agent: host,
    write: true,
  });
  const server: Server = serve(app, "tailnet");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  server.on("close", () => db.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/login`, {
    method: "POST",
    body: JSON.stringify({ user: "juan", password: SIGN_IN, device: "portatil-ejemplo" }),
  });
  const token = ((await login.json()) as { token: string }).token;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const trust = (t: string) =>
    db.prepare("UPDATE devices SET trust = ? WHERE name = ?").run(t, "portatil-ejemplo");
  return { server, host, call, trust };
}
