import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { label, type TypeDef } from "@boni/entities";
import { afterEach, describe, expect, it } from "vitest";
import { open, seal, type WrappedKeys, wrappedKeyProvider } from "./keys.ts";
import {
  BODY,
  entityLabel,
  type OpMeta,
  openUserStore,
  restoreBackup,
  StoreError,
  type UserStore,
} from "./store.ts";

/** Invented types and data only (the repo is public). */
const JUAN = label("user", "public", [{ kind: "turn", id: "t1" }]);
const MAIL = label("external", "personal", [{ kind: "mail", id: "m1" }]);
const VAULT = label("imported", "public", [{ kind: "vault", id: "libros/x.md" }]);
const me: OpMeta = { actor: "user", device: "portatil" };
const agent = (run: string): OpMeta => ({ actor: "agent", run });

const persona = (): TypeDef => ({
  id: "t_persona",
  key: "persona",
  name: "Persona",
  fields: [{ id: "f_nombre", key: "nombre", name: "Nombre", type: "text", label: JUAN }],
  titleField: "f_nombre",
  sensitivity: "personal",
  thirdParty: true,
  schemaVersion: 1,
  label: JUAN,
});
const libro = (): TypeDef => ({
  id: "t_libro",
  key: "libro",
  name: "Libro",
  fields: [
    { id: "f_titulo", key: "titulo", name: "Título", type: "text", label: JUAN },
    { id: "f_paginas", key: "paginas", name: "Páginas", type: "number", label: JUAN },
    {
      id: "f_precio",
      key: "precio",
      name: "Precio",
      type: "money",
      sensitivity: "sensitive",
      label: JUAN,
    },
    { id: "f_nota", key: "nota", name: "Nota", type: "text", label: JUAN },
    {
      id: "f_autor",
      key: "autor",
      name: "Autor",
      type: "relation",
      relation: { target: "t_persona", many: false },
      label: JUAN,
    },
  ],
  titleField: "f_titulo",
  sensitivity: "public",
  schemaVersion: 1,
  label: JUAN,
});

const dirs: string[] = [];
const stores: UserStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function fresh(): { store: UserStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "boni-store-"));
  dirs.push(dir);
  const store = openUserStore(join(dir, "boni.db"));
  stores.push(store);
  store.applySchema({ op: "create_type", type: persona() }, me);
  store.applySchema({ op: "create_type", type: libro() }, me);
  return { store, dir };
}

describe("the store", () => {
  it("lists its operation log, oldest first, for an export", () => {
    const { store } = fresh();
    const e = store.create(
      "t_libro",
      { f_titulo: { value: "Un libro", label: JUAN } },
      { ...me, run: "r1" },
    );
    store.update(e.entity.id, { f_titulo: { value: "Otro", label: JUAN } }, me);
    const log = store.log();
    expect(log.map((r) => r.kind).slice(-2)).toEqual(["create", "update"]);
    expect(log.at(-2)).toMatchObject({ target: e.entity.id, run: "r1", before: null });
    expect(log.at(-1)?.seq).toBeGreaterThan(log.at(-2)?.seq ?? 0);
  });

  it("sees a schema another connection changed (the import while the server runs)", () => {
    const { store, dir } = fresh();
    const other = openUserStore(join(dir, "boni.db"));
    stores.push(other);
    const def = { ...libro(), id: "t_revista", key: "revista", name: "Revistas" };
    other.applySchema({ op: "create_type", type: def }, me);
    expect(store.schema().types.t_revista?.name).toBe("Revistas");
    const e = store.create("t_revista", { f_titulo: { value: "Una revista", label: JUAN } }, me);
    expect(other.get(e.entity.id)?.entity.values.f_titulo).toBe("Una revista");
    // And a change made here after it does not lose the other's type.
    store.applySchema(
      { op: "rename_type", type: "t_libro", key: "libro", name: "Libros leídos", label: JUAN },
      me,
    );
    const again = openUserStore(join(dir, "boni.db"));
    stores.push(again);
    expect(Object.keys(again.schema().types).sort()).toEqual(["t_libro", "t_persona", "t_revista"]);
  });

  it("keeps what the models may see of each type, Juan's choice", () => {
    const { store } = fresh();
    expect(store.aiAccess()).toEqual({});
    store.setAiAccess("t_persona", "hidden", "portatil");
    store.setAiAccess("t_libro", "opaque", "portatil");
    store.setAiAccess("t_libro", "visible", "portatil");
    expect(store.aiAccess()).toEqual({ t_persona: "hidden", t_libro: "visible" });
    expect(() => store.setAiAccess("t_nada", "hidden", "portatil")).toThrow(StoreError);
    expect(() => store.setAiAccess("t_libro", "secreto" as never, "portatil")).toThrow(StoreError);
    // Not something a read query (the views, the agent) can see.
    expect(() => store.readQuery("SELECT * FROM ai_access")).toThrow();
  });

  it("keeps extensions' settings and state outside the log, out of read queries, across restarts", () => {
    const { store, dir } = fresh();
    const ops = store.log().length;
    expect(store.setting("mail/state")).toBeNull();
    store.setSetting("mail/state", '{"lastUid":7}');
    store.setSetting("mail/state", '{"lastUid":8}');
    expect(store.setting("mail/state")).toBe('{"lastUid":8}');
    expect(store.log()).toHaveLength(ops); // a cursor moving is not a change to undo
    expect(() => store.readQuery("SELECT * FROM settings")).toThrow();
    const again = openUserStore(join(dir, "boni.db"));
    stores.push(again);
    expect(again.setting("mail/state")).toBe('{"lastUid":8}');
    again.setSetting("mail/state", null);
    expect(store.setting("mail/state")).toBeNull();
  });

  it("keeps the schema across restarts", () => {
    const { store, dir } = fresh();
    store.close();
    stores.pop();
    const again = openUserStore(join(dir, "boni.db"));
    stores.push(again);
    expect(Object.keys(again.schema().types).sort()).toEqual(["t_libro", "t_persona"]);
    expect(again.schema().types.t_libro?.fields.map((f) => f.key)).toEqual([
      "titulo",
      "paginas",
      "precio",
      "nota",
      "autor",
    ]);
  });

  it("stores each field with its label, raised by what its field and type say", () => {
    const { store } = fresh();
    const ana = store.create("t_persona", { f_nombre: { value: "Ana Ejemplo", label: MAIL } }, me);
    expect(ana.labels.f_nombre).toMatchObject({
      integrity: "external",
      thirdParty: true,
      sensitivity: "personal",
    });
    const b = store.create(
      "t_libro",
      {
        f_titulo: { value: "  Un libro inventado ", label: JUAN },
        f_precio: { value: { amount: 12.5, currency: "EUR" }, label: JUAN },
        f_autor: { value: ana.entity.id, label: JUAN },
      },
      me,
    );
    expect(b.entity.values.f_titulo).toBe("Un libro inventado");
    expect(b.labels.f_precio?.sensitivity).toBe("sensitive"); // the field is sensitive whoever writes it
    expect(entityLabel(b)).toMatchObject({ integrity: "user", sensitivity: "sensitive" });
    expect(store.linksTo(ana.entity.id)).toEqual([{ src: b.entity.id, field: "f_autor" }]);
    // A field written from an e-mail stays external when another field changes.
    const u = store.update(
      b.entity.id,
      { f_nota: { value: "Recomendado en un correo", label: MAIL } },
      me,
    );
    store.update(b.entity.id, { f_paginas: { value: 320, label: JUAN } }, me);
    expect(store.get(b.entity.id)?.labels.f_nota?.integrity).toBe("external");
    expect(entityLabel(store.get(b.entity.id) as never)?.integrity).toBe("external");
    expect(u.entity.version).toBe(2);
  });

  it("refuses what does not fit and then writes nothing", () => {
    const { store } = fresh();
    const v = store.version();
    const bad: [string, unknown][] = [
      ["f_paginas", "muchas"],
      ["f_precio", { amount: 1, currency: "euros" }],
      ["f_autor", "e_no_existe"],
      ["f_inventado", "x"],
    ];
    for (const [f, value] of bad)
      expect(
        () =>
          store.create(
            "t_libro",
            { f_titulo: { value: "X", label: JUAN }, [f]: { value, label: JUAN } },
            me,
          ),
        f,
      ).toThrow(StoreError);
    expect(store.version()).toBe(v);
    expect(store.list("t_libro")).toEqual([]);
    const b = store.create("t_libro", { f_titulo: { value: "X", label: JUAN } }, me);
    expect(() =>
      store.update(b.entity.id, { f_paginas: { value: 1, label: JUAN } }, me, 7),
    ).toThrow(/changed since/);
  });

  it("undoes an operation with a new one, and the history keeps both", () => {
    const { store } = fresh();
    const b = store.create("t_libro", { f_titulo: { value: "Antes", label: VAULT } }, me);
    store.update(b.entity.id, { f_titulo: { value: "Después", label: MAIL } }, agent("r1"));
    const updateSeq = store.version();
    store.undo(updateSeq, me);
    const back = store.get(b.entity.id);
    expect(back?.entity.values.f_titulo).toBe("Antes");
    expect(back?.labels.f_titulo).toEqual(VAULT); // the label comes back too
    expect(() => store.undo(updateSeq, me)).toThrow(/already undone/);
    store.undo(store.version(), me); // undoing the undo is a redo
    expect(store.get(b.entity.id)?.entity.values.f_titulo).toBe("Después");
    expect(store.search("Después")).toEqual([b.entity.id]);
  });

  it("does not undo over a later change of the same entity", () => {
    const { store } = fresh();
    const b = store.create("t_libro", { f_titulo: { value: "A", label: JUAN } }, me);
    store.update(b.entity.id, { f_paginas: { value: 10, label: JUAN } }, agent("r1"));
    const first = store.version();
    store.update(b.entity.id, { f_paginas: { value: 20, label: JUAN } }, me);
    expect(() => store.undo(first, me)).toThrow(/changed since/);
    expect(store.get(b.entity.id)?.entity.values.f_paginas).toBe(20);
  });

  it("undoes a whole run, or nothing of it", () => {
    const { store } = fresh();
    const keep = store.create("t_libro", { f_titulo: { value: "Mío", label: JUAN } }, me);
    const made = store.create(
      "t_libro",
      { f_titulo: { value: "Del agente", label: MAIL } },
      agent("r9"),
    );
    store.update(
      keep.entity.id,
      { f_nota: { value: "nota del agente", label: MAIL } },
      agent("r9"),
    );
    store.remove(keep.entity.id, agent("r9"));
    store.undoRun("r9", me);
    expect(store.get(keep.entity.id)?.entity.deleted).toBeUndefined();
    expect(store.get(keep.entity.id)?.entity.values.f_nota).toBeUndefined();
    expect(store.get(made.entity.id)?.entity.deleted).toBeDefined(); // what it made goes to the trash
    expect(() => store.undoRun("r9", me)).toThrow(/nothing to undo/);

    // A conflict anywhere rolls the whole run's undo back.
    const x = store.create("t_libro", { f_titulo: { value: "X", label: JUAN } }, agent("r10"));
    store.update(x.entity.id, { f_paginas: { value: 1, label: JUAN } }, agent("r10"));
    store.update(x.entity.id, { f_paginas: { value: 2, label: JUAN } }, me);
    const v = store.version();
    expect(() => store.undoRun("r10", me)).toThrow(StoreError);
    expect(store.version()).toBe(v);
    expect(store.get(x.entity.id)?.entity.values.f_paginas).toBe(2);
  });

  it("random changes undone newest first leave everything as it was", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { store } = fresh();
      const ids = [0, 1, 2].map(
        (i) =>
          store.create("t_libro", { f_titulo: { value: `Libro ${i}`, label: JUAN } }, me).entity.id,
      );
      const snapshot = () =>
        ids.map((id) => {
          const e = store.get(id);
          return {
            values: e?.entity.values,
            labels: e?.labels,
            deleted: e?.entity.deleted !== undefined,
            body: e?.entity.body,
          };
        });
      const before = snapshot();
      let a = seed;
      const rand = (n: number) => {
        a = (a * 1103515245 + 12345) % 2147483648;
        return a % n;
      };
      const done: number[] = [];
      for (let i = 0; i < 12; i++) {
        const id = ids[rand(3)] as string;
        const cur = store.get(id);
        try {
          const k = rand(4);
          if (k === 0 && cur?.entity.deleted === undefined) store.remove(id, me);
          else if (k === 1 && cur?.entity.deleted !== undefined) store.restore(id, me);
          else if (k === 2)
            store.update(
              id,
              { [BODY]: { value: `cuerpo ${i}`, label: rand(2) ? MAIL : JUAN } },
              me,
            );
          else
            store.update(
              id,
              {
                f_paginas: { value: rand(500), label: rand(2) ? MAIL : VAULT },
                f_nota: { value: rand(2) ? null : `n${i}`, label: JUAN },
              },
              me,
            );
          done.push(store.version());
        } catch (e) {
          if (!(e instanceof StoreError)) throw e;
        }
      }
      for (const seq of done.reverse()) store.undo(seq, me);
      expect(snapshot(), `seed ${seed}`).toEqual(before);
    }
  }, 60_000); // 25 seeds of random changes: slow on a busy CI runner

  it("changes a field's type converting values, and undo brings the old ones back", () => {
    const { store } = fresh();
    const a = store.create(
      "t_libro",
      { f_titulo: { value: "A", label: JUAN }, f_nota: { value: "12,5", label: JUAN } },
      me,
    );
    const b = store.create(
      "t_libro",
      { f_titulo: { value: "B", label: JUAN }, f_nota: { value: "sin número", label: JUAN } },
      me,
    );
    store.applySchema(
      { op: "change_field_type", type: "t_libro", field: "f_nota", to: "number" },
      agent("r2"),
    );
    expect(store.get(a.entity.id)?.entity.values.f_nota).toBe(12.5);
    expect(store.get(b.entity.id)?.entity.values.f_nota).toBeUndefined(); // did not convert: left empty
    store.undoRun("r2", me);
    expect(store.schema().types.t_libro?.fields.find((f) => f.id === "f_nota")?.type).toBe("text");
    expect(store.get(a.entity.id)?.entity.values.f_nota).toBe("12,5");
    expect(store.get(b.entity.id)?.entity.values.f_nota).toBe("sin número");
  });

  it("a removed field keeps its values, so undoing the removal gives them back", () => {
    const { store } = fresh();
    const a = store.create(
      "t_libro",
      { f_titulo: { value: "A", label: JUAN }, f_paginas: { value: 99, label: JUAN } },
      me,
    );
    store.applySchema({ op: "remove_field", type: "t_libro", field: "f_paginas" }, agent("r3"));
    expect(store.schema().types.t_libro?.fields.some((f) => f.id === "f_paginas")).toBe(false);
    store.undoRun("r3", me);
    expect(store.schema().types.t_libro?.fields[1]?.id).toBe("f_paginas");
    expect(store.get(a.entity.id)?.entity.values.f_paginas).toBe(99);
    expect(() => store.applySchema({ op: "remove_type", type: "t_libro" }, me)).toThrow(
      /still has/,
    );
  });

  it("protects Boni's own types from anything but its code", () => {
    const { store } = fresh();
    const memory: TypeDef = {
      ...persona(),
      id: "memory",
      key: "memory",
      thirdParty: false,
      system: true,
    };
    expect(() => store.applySchema({ op: "create_type", type: memory }, agent("r4"))).toThrow(
      StoreError,
    );
    store.applySchema({ op: "create_type", type: memory }, { actor: "system" });
    expect(() =>
      store.create("memory", { f_nombre: { value: "guarda esto", label: MAIL } }, agent("r4")),
    ).toThrow(/own types/);
    expect(
      store.create(
        "memory",
        { f_nombre: { value: "preferencia", label: JUAN } },
        { actor: "system" },
      ).entity.type,
    ).toBe("memory");
  });

  it("searches titles, texts and bodies; the words are never search syntax", () => {
    const { store } = fresh();
    const a = store.create(
      "t_libro",
      {
        f_titulo: { value: "Cien años de ejemplo", label: JUAN },
        [BODY]: { value: "Lo leí en verano", label: JUAN },
      },
      me,
    );
    store.create("t_libro", { f_titulo: { value: "Otro libro", label: JUAN } }, me);
    expect(store.search("años")).toEqual([a.entity.id]);
    expect(store.search("verano")).toEqual([a.entity.id]);
    expect(store.search("eje")).toEqual([a.entity.id]); // prefixes
    for (const q of ['title" OR 1', "NEAR(a b)", "*", "f_titulo:x", '"', ""])
      expect(() => store.search(q), q).not.toThrow();
    store.remove(a.entity.id, me);
    expect(store.search("años")).toEqual([]);
  });

  it("says what changed since a version", () => {
    const { store } = fresh();
    const v0 = store.version();
    const a = store.create("t_libro", { f_titulo: { value: "A", label: JUAN } }, me);
    const v1 = store.version();
    store.update(a.entity.id, { f_paginas: { value: 3, label: JUAN } }, me);
    const c = store.changesSince(v0);
    expect(c.entities.map((e) => e.entity.id)).toEqual([a.entity.id]);
    expect(c.schemaChanged).toBe(false);
    expect(store.changesSince(v1).entities[0]?.entity.version).toBe(2);
    expect(store.changesSince(store.version()).entities).toEqual([]);
  });

  it("runs read-only queries and refuses everything else", () => {
    const { store } = fresh();
    store.create(
      "t_libro",
      { f_titulo: { value: "A", label: JUAN }, f_paginas: { value: 120, label: JUAN } },
      me,
    );
    const rows = store.readQuery(
      "SELECT count(*) AS n, sum(json_extract(vals, '$.f_paginas')) AS p FROM entities WHERE type = ? AND deleted IS NULL",
      ["t_libro"],
    );
    expect(rows).toEqual([{ n: 1, p: 120 }]);
    expect(
      store.readQuery("SELECT entity FROM entities_fts WHERE entities_fts MATCH ?", ['"A"*']),
    ).toHaveLength(1);
    for (const sql of [
      "INSERT INTO entities (id, type, vals, created, updated, version) VALUES ('x','t',  '{}', 0, 0, 1)",
      "UPDATE entities SET vals = '{}'",
      "DELETE FROM entities",
      "DROP TABLE entities",
      "SELECT * FROM ops", // the log is not for views
      "PRAGMA user_version",
      "ATTACH DATABASE '/tmp/x.db' AS x",
      "SELECT load_extension('x')",
    ])
      expect(() => store.readQuery(sql), sql).toThrow();
    // And the store still writes normally afterwards.
    expect(
      store.create("t_libro", { f_titulo: { value: "B", label: JUAN } }, me).entity.version,
    ).toBe(1);
  });
});

describe("keys and backups", () => {
  it("seals and opens; a changed byte or another key fails", () => {
    const key = Buffer.alloc(32, 7);
    const box = seal(key, Buffer.from("hola"));
    expect(open(key, box).toString()).toBe("hola");
    const bad = Buffer.from(box);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    expect(() => open(key, bad)).toThrow();
    expect(() => open(Buffer.alloc(32, 8), box)).toThrow();
  });

  it("gives each user a stable data key that is only stored wrapped, and only opens as that user's", () => {
    const shelf = new Map<string, Buffer>();
    const wrapped: WrappedKeys = {
      get: (u) => shelf.get(u) ?? null,
      put: (u, w) => void shelf.set(u, w),
    };
    const keys = wrappedKeyProvider(Buffer.alloc(32, 1), wrapped);
    const a = keys.dataKey("u1");
    expect(keys.dataKey("u1").equals(a)).toBe(true);
    expect(keys.dataKey("u2").equals(a)).toBe(false);
    expect(shelf.get("u1")?.includes(a)).toBe(false); // never stored in the clear
    shelf.set("u2", shelf.get("u1") as Buffer); // someone swaps the wrapped keys
    expect(() => keys.dataKey("u2")).toThrow();
  });

  it("backs up encrypted and restores to a store that opens with the same data", () => {
    const { store, dir } = fresh();
    store.create("t_libro", { f_titulo: { value: "Título muy reconocible", label: JUAN } }, me);
    const key = Buffer.alloc(32, 3);
    const file = join(dir, "backup.bin");
    store.backupTo(file, key);
    expect(readFileSync(file).includes(Buffer.from("Título muy reconocible"))).toBe(false);
    const restored = join(mkdtempSync(join(tmpdir(), "boni-restore-")), "boni.db");
    dirs.push(join(restored, ".."));
    restoreBackup(file, key, restored);
    const again = openUserStore(restored);
    stores.push(again);
    expect(again.list("t_libro").map((e) => e.entity.values.f_titulo)).toEqual([
      "Título muy reconocible",
    ]);
    expect(() => restoreBackup(file, Buffer.alloc(32, 4), join(dir, "nope.db"))).toThrow();
  });
});

describe("the agent's journal", () => {
  it("keeps runs, their steps and model calls, and the read-only queries cannot reach them", () => {
    const { store } = fresh();
    const j = store.journal;
    j.startRun({ id: "r1", turn: "t1", origin: "turn", device: "portatil", started: 1 });
    j.step({
      run: "r1",
      step: "a",
      kind: "call",
      decision: "allow",
      rule: "P1",
      detail: { tool: "x" },
      at: 2,
    });
    j.step({
      run: "r1",
      step: "b",
      kind: "call",
      decision: "deny",
      rule: "P2",
      detail: null,
      at: 3,
    });
    j.modelCall({
      run: "r1",
      role: "planner",
      provider: "fake",
      model: "m",
      promptHash: "h",
      request: { a: 1 },
      response: { b: 2 },
      usage: { input: 1, output: 1 },
      at: 2,
    });
    j.finishRun("r1", "done", { version: 1 }, 4);
    expect(j.run("r1")).toMatchObject({ status: "done", plan: { version: 1 }, finished: 4 });
    expect(j.steps("r1").map((s) => [s.seq, s.rule])).toEqual([
      [1, "P1"],
      [2, "P2"],
    ]);
    expect(j.modelCalls("r1")[0]?.request).toEqual({ a: 1 });
    // Prompts and answers are not for views or plans.
    expect(() => store.readQuery("SELECT * FROM model_calls")).toThrow();
    expect(() => store.readQuery("SELECT * FROM proposals")).toThrow();
  });

  it("uses a confirmation once, for its hash, before it expires", () => {
    const { store } = fresh();
    const j = store.journal;
    j.addConfirmation({ id: "c1", run: "r1", tool: "x", hash: "h1", view: {}, expires: 100 });
    expect(j.useConfirmation("c1", "otro", 10)).toBe(false);
    expect(j.useConfirmation("c1", "h1", 10)).toBe(true);
    expect(j.useConfirmation("c1", "h1", 11)).toBe(false);
    j.addConfirmation({ id: "c2", run: "r1", tool: "x", hash: "h2", view: {}, expires: 100 });
    expect(j.useConfirmation("c2", "h2", 100)).toBe(false);
  });

  it("keeps proposals and daily budgets", () => {
    const { store } = fresh();
    const j = store.journal;
    j.addProposal({
      id: "p1",
      run: "r1",
      tool: "x",
      args: { a: 1 },
      view: null,
      sources: ["mail:m1"],
      created: 1,
    });
    expect(j.proposals("pending").map((p) => p.id)).toEqual(["p1"]);
    j.setProposal("p1", "rejected", 2);
    expect(j.proposals("pending")).toEqual([]);
    expect(j.proposal("p1")?.status).toBe("rejected");
    j.spend("2026-10-20", "reader", 2);
    j.spend("2026-10-20", "reader", 1);
    expect(j.spent("2026-10-20", "reader")).toBe(3);
    expect(j.spent("2026-10-21", "reader")).toBe(0);
  });
});

describe("two processes on one store", () => {
  it("a write waits while another connection holds the lock, instead of failing", async () => {
    const { store, dir } = fresh();
    const { Worker } = await import("node:worker_threads");
    const path = join(dir, "boni.db");
    // Another connection (in its own thread, as the import would be) takes the write lock for a moment.
    const worker = new Worker(
      `const { DatabaseSync } = require("node:sqlite");
       const { parentPort, workerData } = require("node:worker_threads");
       const db = new DatabaseSync(workerData);
       db.exec("BEGIN IMMEDIATE");
       parentPort.postMessage("locked");
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
       db.exec("COMMIT");
       db.close();`,
      { eval: true, workerData: path },
    );
    await new Promise((r) => worker.once("message", r));
    const t0 = Date.now();
    const e = store.create("t_libro", { f_titulo: { value: "Espera", label: JUAN } }, me);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
    expect(store.get(e.entity.id)?.entity.values.f_titulo).toBe("Espera");
    await worker.terminate();
  });
});
