// The security rules of F14a (docs/automatizaciones.md §6): labels through citations, the label of the path, and the
// policy on every read and write. One test per rule, its id in the name (`make check` reads them).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "@boni/entities";
import { describe, expect, it } from "vitest";
import { cite, collection, ids, sketch } from "./automation.test-util.ts";
import { type Collections, type Decision, Denied, guard, type PolicyCall } from "./effects.ts";
import { run } from "./engine.ts";
import { ACTION, OUT } from "./format.ts";
import { deps, OUTSIDE, OWN, policy, start, store } from "./run.test-util.ts";

describe("labels and the policy", () => {
  it("AU-162 · a value that is one simple citation keeps the type and the exact label of the field it cites, with no sandbox; text around it makes it derived", async () => {
    const s = sketch()
      .step("Inicio", "manual", {
        fields: [
          { key: "importe", name: "Importe", type: "number" },
          { key: "nota", name: "Nota", type: "text" },
        ],
      })
      .step("Copiar", "edit", {
        keep: "none",
        fields: [
          { field: "mismo", value: cite("$json.importe") },
          { field: "suyo", value: cite("$json.nota") },
          { field: "del paso", value: cite("$('Inicio').first().importe") },
          { field: "texto", value: { expr: "Nota: {{ $json.nota }}" } },
          { field: "fijo", value: 7 },
          { field: "falta", value: cite("$json.nada") },
        ],
      })
      .arrow("Inicio", "Copiar");
    const e = await start(
      s.build(),
      s.id("Inicio"),
      { importe: 12.5, nota: "de fuera" },
      {},
      {
        nota: { label: OUTSIDE, derived: false },
      },
    );
    const row = e.steps[s.id("Copiar")]?.out.main?.[0];
    expect(row?.json).toEqual({
      mismo: 12.5,
      suyo: "de fuera",
      "del paso": 12.5,
      texto: "Nota: de fuera",
      fijo: 7,
      falta: null,
    });
    // The row's label is the one it came with; only what differs has a label of its own.
    expect(row?.label).toBe(OWN);
    expect(row?.fields).toEqual({
      suyo: { label: OUTSIDE, derived: false },
      texto: { label: join(OWN, OUTSIDE), derived: true },
    });
  });
  it("AU-164 · a row carries the label of its path: what comes out of a condition over something from outside, or of rows searched, sorted or deduplicated with it, is written as from outside", async () => {
    const next = ids(164);
    const items = collection(next, ["text"]);
    const notes = collection(next, ["text"]);
    const [name] = items.fields.map((f) => f.key) as [string];
    const [text] = notes.fields.map((f) => f.key) as [string];
    const asks = {
      fields: [
        { key: "nota", name: "Nota", type: "text" },
        { key: "mio", name: "Mío", type: "text" },
      ],
    };
    const write = {
      collection: notes.key,
      [ACTION]: "create",
      fields: [{ field: text, value: "hecho" }],
    };
    const s = sketch()
      .step("Inicio", "manual", asks)
      // A condition over a field from outside, one over Juan's own, and none.
      .step("Si fuera", "if", { where: [{ field: "nota", op: "is", value: "sí" }] })
      .step("Si mío", "if", { where: [{ field: "mio", op: "is", value: "sí" }] })
      .step("Tras fuera", "collection", write)
      .step("Tras mío", "collection", write)
      .step("Directo", "collection", write)
      // A search whose condition cites the field from outside: what it finds came that way.
      .step("Buscar", "collection", {
        collection: items.key,
        [ACTION]: "find",
        where: [{ field: name, op: "is", value: cite("$json.nota") }],
      })
      .step("Tras buscar", "collection", write)
      // A sort by the field from outside decides the order of what follows, so it marks the path too.
      .step("Ordenar", "sort", { by: [{ field: "nota", direction: "asc" }] })
      .step("Tras ordenar", "collection", write)
      .step("Sin repetir", "dedupe", { by: "fields", fields: [{ field: "nota" }] })
      .step("Tras quitar", "collection", write)
      .arrow("Inicio", "Si fuera")
      .arrow("Inicio", "Si mío")
      .arrow("Si fuera", "Tras fuera", OUT.yes)
      .arrow("Si mío", "Tras mío", OUT.yes)
      .arrow("Inicio", "Directo")
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Tras buscar")
      .arrow("Inicio", "Ordenar")
      .arrow("Ordenar", "Tras ordenar")
      .arrow("Inicio", "Sin repetir")
      .arrow("Sin repetir", "Tras quitar");
    const db = store([items, notes], { [items.key]: [{ [name]: "sí" }] }, next);
    const judged = policy();
    const e = await start(
      s.build(),
      s.id("Inicio"),
      { nota: "sí", mio: "sí" },
      { collections: db, policy: judged },
      { nota: { label: OUTSIDE, derived: false } },
    );
    expect(e.state).toBe("done");
    const control = (step: string) => judged.calls.find((c) => c.step === s.id(step))?.control;
    // The rows that passed a condition over something from outside carry it, and so does what they write.
    expect(e.steps[s.id("Si fuera")]?.out[OUT.yes]?.[0]?.path).toEqual(join(OUTSIDE));
    expect(control("Tras fuera")).toEqual(join(OUTSIDE));
    // A condition over Juan's own gives his label; with no condition nothing decided the path.
    expect(control("Tras mío")).toEqual(join(OWN));
    expect(control("Directo")).toBeNull();
    // The search is judged with its conditions (Juan's, with a value from outside in them), and what it found
    // writes as from outside.
    const searched = join(OWN, OUTSIDE);
    expect(searched.integrity).toBe("external");
    expect(control("Buscar")).toEqual(searched);
    expect(e.steps[s.id("Buscar")]?.out.main?.[0]?.path).toEqual(searched);
    expect(control("Tras buscar")).toEqual(searched);
    // So does what decided an order or which rows repeat.
    expect(control("Tras ordenar")).toEqual(join(OUTSIDE));
    expect(control("Tras quitar")).toEqual(join(OUTSIDE));
    // What the search read keeps its own label: the path is apart from the fields.
    expect(e.steps[s.id("Buscar")]?.out.main?.[0]?.label).toBe(OWN);
  });
  it("AU-168 · every read and every write of a run asks the policy first, in a test too: a denied one never reaches the collections, and an executor has no way to them but the gate", async () => {
    const next = ids(168);
    const items = collection(next, ["text", "number"]);
    const [name, n] = items.fields.map((f) => f.key) as [string, string];
    const s = sketch()
      .step("Inicio", "manual")
      .step("Buscar", "collection", { collection: items.key, [ACTION]: "find" })
      .step("Modificar", "collection", {
        collection: items.key,
        [ACTION]: "update",
        fields: [{ field: n, value: cite(`$json.${n}`) }],
      })
      .step("Crear", "collection", {
        collection: items.key,
        [ACTION]: "create",
        fields: [{ field: name, value: "nueva" }],
      })
      .arrow("Inicio", "Buscar")
      .arrow("Buscar", "Modificar")
      .arrow("Inicio", "Crear");
    /** A store and a policy that write into one log, so the order of what was asked and what was done shows. */
    const logged = (
      decide: (c: PolicyCall) => Decision = () => ({ kind: "allow", rule: "test.allow" }),
    ) => {
      const log: string[] = [];
      const db = store(
        [items],
        {
          [items.key]: [
            { [name]: "una", [n]: 1 },
            { [name]: "dos", [n]: 2 },
          ],
        },
        ids(169),
      );
      const noted = <T>(method: string, call: () => T): T => {
        log.push(method);
        return call();
      };
      const watched: Collections = {
        shape: db.shape,
        find: (q) => noted("find", () => db.find(q)),
        get: (c, id) => noted("get", () => db.get(c, id)),
        aggregate: (q) => noted("aggregate", () => db.aggregate(q)),
        apply: (c) => noted("apply", () => db.apply(c)),
      };
      const judged = policy((c) => {
        log.push(`decide ${c.effect}${c.test ? " test" : ""}`);
        return decide(c);
      });
      return { log, db, over: { collections: watched, policy: judged }, judged };
    };

    // Each call to the collections comes right after the policy allowed it.
    const allowed = logged();
    expect((await start(s.build(), s.id("Inicio"), {}, allowed.over)).state).toBe("done");
    const pairs = (log: string[]) =>
      Array.from({ length: Math.ceil(log.length / 2) }, (_, i) =>
        log.slice(2 * i, 2 * i + 2),
      ).sort();
    expect(pairs(allowed.log)).toEqual([
      ["decide read", "find"],
      ["decide write", "apply"],
      ["decide write", "apply"],
      ["decide write", "apply"],
    ]);

    // In a test it asks the same, and writes nothing: the rows come out as they would be.
    const tested = logged();
    const t = await run(
      {
        automation: s.build(),
        trigger: s.id("Inicio"),
        fields: { json: {}, label: OWN },
        test: true,
      },
      deps(tested.over),
    );
    expect(t.state).toBe("done");
    expect(tested.log.filter((l) => l.startsWith("decide"))).toEqual([
      "decide read test",
      "decide write test",
      "decide write test",
      "decide write test",
    ]);
    expect(tested.log).not.toContain("apply");
    expect(tested.db.applied).toEqual([]);
    expect(t.steps[s.id("Crear")]?.out.main?.map((r) => [r.json, r.origin])).toEqual([
      [{ [name]: "nueva" }, undefined],
    ]);
    expect(t.steps[s.id("Modificar")]?.out.main?.map((r) => r.json[n])).toEqual([1, 2]);

    // A no stops the call before the collections; a read that would only be proposed is a no too.
    for (const [kind, effect] of [
      ["deny", "write"],
      ["deny", "read"],
      ["propose", "read"],
      ["confirm", "read"],
    ] as const) {
      const no = logged((c) =>
        c.effect !== effect
          ? { kind: "allow", rule: "test.allow" }
          : kind === "deny"
            ? { kind, rule: "test.no", reason: "no" }
            : { kind, rule: "test.no" },
      );
      const e = await start(s.build(), s.id("Inicio"), {}, no.over);
      expect(e.state, `${kind} ${effect}`).toBe("failed");
      expect(e.error?.rule).toBe("test.no");
      expect(no.db.applied).toEqual([]);
      if (effect === "read") expect(no.log).not.toContain("find");
      else expect(no.log).not.toContain("apply");
    }

    // `propose` and `confirm` on a write write nothing and wait in `Execution.asked`, one per row.
    for (const kind of ["propose", "confirm"] as const) {
      const waits = logged((c) =>
        c.effect === "write"
          ? { kind, rule: `test.${kind}` }
          : { kind: "allow", rule: "test.allow" },
      );
      const e = await start(s.build(), s.id("Inicio"), {}, waits.over);
      expect(e.state).toBe("done");
      expect(waits.log).not.toContain("apply");
      expect(e.asked.map((a) => [a.kind, a.change.kind]).sort()).toEqual([
        [kind, "create"],
        [kind, "update"],
        [kind, "update"],
      ]);
      expect(e.steps[s.id("Modificar")]).toMatchObject({ asked: 2, out: { main: [] } });
    }

    // The gate itself: a denied write throws `Denied` and nothing is applied.
    const db = store([items], {}, ids(170));
    const gate = guard(
      policy(() => ({ kind: "deny", rule: "test.no", reason: "no" })),
      db,
      {
        automation: { id: "e_x", version: 1 },
        step: "s_x",
        type: "collection",
        action: "create",
        effect: "write",
        destroys: false,
        control: null,
        test: false,
        own: OWN,
      },
    );
    await expect(
      gate.write({ kind: "create", collection: items.key, fields: {} }, {}),
    ).rejects.toBeInstanceOf(Denied);
    expect(db.calls).toEqual([]);

    // No other way: an executor gets only its context, whose gate is the policy's (or closed, for a step with no
    // effect); `guard` is called by the engine alone, and the files of the executors hold no collections.
    const dir = new URL("./", import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.includes(".test"));
    for (const f of sources) {
      const code = readFileSync(new URL(f, dir), "utf8");
      if (f !== "effects.ts" && f !== "engine.ts") expect(code, f).not.toMatch(/\bguard\(/);
      if (f === "steps.ts" || f === "collection.ts") {
        expect(code, f).not.toMatch(/\bCollections\b/);
        expect(code, f).not.toMatch(/^import \{[^}]*\} from "\.\/effects\.ts"/m);
      }
    }
    const closed = sketch()
      .step("Inicio", "manual")
      .step("Limitar", "limit", { count: 1 })
      .arrow("Inicio", "Limitar");
    const quiet = logged();
    await start(closed.build(), closed.id("Inicio"), {}, quiet.over);
    expect(quiet.log).toEqual([]);
  });
  it("AU-168 · what a write step gives carries the labels a read of it would: each stored field its own, each field written its value's, in a run and in a test alike", async () => {
    const next = ids(171);
    const items = collection(next, ["text", "text", "number"]);
    const [note, mine, n] = items.fields.map((f) => f.key) as [string, string, string];
    const outside = { label: OUTSIDE, derived: false };
    /** A saved row whose `note` came from outside. */
    const saved = () => {
      const db = store([items], {}, ids(172));
      db.rows(items.key).push({
        json: { [note]: "de fuera", [mine]: "mía", [n]: 1 },
        label: OWN,
        fields: { [note]: outside },
        origin: { collection: items.key, id: "o_guardada", version: 1 },
      });
      return db;
    };
    const target = { target: "matching", where: [{ field: n, op: "is", value: 1 }] };
    const steps = {
      // A fixed value in another field: the field from outside is still from outside.
      Modificar: { [ACTION]: "update", ...target, fields: [{ field: mine, value: "otra" }] },
      // A value from outside into Juan's field: that field is from outside now.
      "Modificar de fuera": {
        [ACTION]: "update",
        ...target,
        fields: [{ field: mine, value: cite("$json.llega") }],
      },
      // A fixed value over the field from outside: it is Juan's now.
      "Modificar encima": {
        [ACTION]: "update",
        ...target,
        fields: [{ field: note, value: "mía" }],
      },
      "Crear o modificar": {
        [ACTION]: "upsert",
        match: [{ field: n }],
        fields: [
          { field: n, value: 1 },
          { field: mine, value: "otra" },
        ],
      },
      Eliminar: { [ACTION]: "trash", ...target },
    };
    for (const test of [false, true])
      for (const [name, params] of Object.entries(steps)) {
        const s = sketch()
          .step("Inicio", "manual", { fields: [{ key: "llega", name: "Llega", type: "text" }] })
          .step(name, "collection", { collection: items.key, ...params })
          .arrow("Inicio", name);
        const e = await run(
          {
            automation: s.build(),
            trigger: s.id("Inicio"),
            fields: { json: { llega: "x" }, label: OWN, fields: { llega: outside } },
            test,
          },
          deps({ collections: saved() }),
        );
        const why = `${name}${test ? " (test)" : ""}`;
        expect(e.state, why).toBe("done");
        const [row] = e.steps[s.id(name)]?.out.main ?? [];
        expect(row?.label, why).toBe(OWN);
        expect(row?.fields, why).toEqual(
          name === "Modificar de fuera"
            ? { [note]: outside, [mine]: outside }
            : name === "Modificar encima"
              ? undefined
              : { [note]: outside },
        );
      }
  });
});
