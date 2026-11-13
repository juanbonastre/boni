import type { FieldDef, TypeDef } from "@boni/entities";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpu } from "./cpu.test-util.ts";
import { TargetMemo } from "./mailTargets.ts";

const own = label("user", "personal", [{ kind: "user-edit", id: "ejemplo" }]);
const type = (id: string, key: string, name: string, fields: FieldDef[]): TypeDef => ({
  id,
  key,
  name,
  fields: [{ id: `${id}_t`, key: "titulo", name: "Título", type: "text", label: own }, ...fields],
  titleField: `${id}_t`,
  sensitivity: "personal",
  schemaVersion: 1,
  label: own,
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** Invented data shaped like Juan's: an agenda of 3,000 dated records, 100 people, tasks that point to people. */
function env(): UserStore {
  // Keep the fixture's due days ahead of creation, with distinct timestamps for its latest examples.
  let now = Date.parse("2026-10-20T12:00:00Z");
  const store = openUserStore(":memory:", { now: () => now++ });
  cleanups.push(() => store.close());
  store.applySchema(
    {
      op: "create_type",
      type: type("t_agenda", "agenda", "Agenda", [
        { id: "t_agenda_d", key: "fecha", name: "Fecha", type: "date", label: own },
      ]),
    },
    { actor: "user" },
  );
  store.applySchema(
    { op: "create_type", type: type("t_pers", "personas", "Personas", []) },
    { actor: "user" },
  );
  store.applySchema(
    {
      op: "create_type",
      type: type("t_tarea", "tareas", "Tareas", [
        { id: "t_tarea_d", key: "dia", name: "Día", type: "date", label: own },
        {
          id: "t_tarea_p",
          key: "persona",
          name: "Persona",
          type: "relation",
          relation: { target: "t_pers", many: false },
          label: own,
        },
      ]),
    },
    { actor: "user" },
  );
  store.batch(() => {
    for (let i = 0; i < 3000; i++) {
      const day = new Date(Date.UTC(2026, 0, 1) + (i % 400) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      store.create(
        "t_agenda",
        { t_agenda_t: { value: `Clase ${i}`, label: own }, t_agenda_d: { value: day, label: own } },
        { actor: "user" },
      );
    }
    for (let i = 0; i < 100; i++)
      store.create(
        "t_pers",
        { t_pers_t: { value: `Persona ${i}`, label: own } },
        { actor: "user" },
      );
    for (let i = 0; i < 20; i++)
      store.create(
        "t_tarea",
        {
          t_tarea_t: { value: `Tarea ${i}`, label: own },
          t_tarea_d: { value: "2026-11-10", label: own },
        },
        { actor: "user" },
      );
  });
  return store;
}

describe("the collections a mail may go to, remembered by parts (task 43)", () => {
  it("reads each part once, and again only the part whose records changed, with his volume", () => {
    const store = env();
    const memo = new TargetMemo();
    const read = vi.spyOn(store, "entities");
    const listed = vi.spyOn(store, "list");
    const types = () => ({
      read: read.mock.calls.map((c) => c[0]).sort(),
      listed: listed.mock.calls.map((c) => c[0]).sort(),
    });
    const t0 = cpu();
    const targets = memo.targetsFor(store, ["t_agenda", "t_tarea"]);
    const first = cpu() - t0;
    console.log(`targets of 3,000 + 20 records (and 100 people): ${first.toFixed(0)} ms`);
    expect(first).toBeLessThan(2000);
    // What a target is made of: the due field, up to three latest titles, the fields to fill.
    expect(targets.map((t) => [t.key, t.date, t.optionRefs?.length])).toEqual([
      ["agenda", "fecha", 3],
      ["tareas", "dia", 3],
    ]);
    expect(targets[0]?.option).toMatch(/^Agenda \(p\. ej\.: Clase \d+; Clase \d+; Clase \d+\)$/);
    expect(targets[1]?.fill?.map((f) => [f.key, f.options.length])).toEqual([["persona", 40]]);
    // Each collection's records once (values only), the people once (for the options), a few labels for examples.
    expect(types()).toEqual({ read: ["t_agenda", "t_tarea"], listed: ["t_pers"] });
    const got = store.get;
    const gets = vi.spyOn(store, "get");
    // Nothing changed: nothing read.
    read.mockClear();
    listed.mockClear();
    memo.targetsFor(store, ["t_agenda", "t_tarea"]);
    expect(types()).toEqual({ read: [], listed: [] });
    expect(gets.mock.calls.length).toBe(0);
    // A task changed: the tasks are read again, not the agenda nor the people.
    store.create("t_tarea", { t_tarea_t: { value: "Nueva", label: own } }, { actor: "user" });
    memo.targetsFor(store, ["t_agenda", "t_tarea"]);
    expect(types()).toEqual({ read: ["t_tarea"], listed: [] });
    expect(gets.mock.calls.length).toBeLessThanOrEqual(40);
    // A person changed: only the fields to fill that point to people are made again.
    read.mockClear();
    listed.mockClear();
    store.create("t_pers", { t_pers_t: { value: "Persona nueva", label: own } }, { actor: "user" });
    memo.targetsFor(store, ["t_agenda", "t_tarea"]);
    expect(types()).toEqual({ read: [], listed: ["t_pers"] });
    // A class moved in the agenda: the agenda alone, and how long that takes with his volume.
    read.mockClear();
    listed.mockClear();
    store.create(
      "t_agenda",
      { t_agenda_t: { value: "Clase nueva", label: own } },
      { actor: "user" },
    );
    const t1 = cpu();
    const again = memo.targetsFor(store, ["t_agenda", "t_tarea"]);
    const agenda = cpu() - t1;
    console.log(`the agenda's part again, 3,001 records: ${agenda.toFixed(0)} ms`);
    expect(agenda).toBeLessThan(1000);
    expect(types()).toEqual({ read: ["t_agenda"], listed: [] });
    expect(again[0]?.option).toContain("Clase nueva");
    // The schema changed: everything again. The levels or the rules changing too.
    read.mockClear();
    listed.mockClear();
    store.applySchema(
      {
        op: "add_field",
        type: "t_tarea",
        field: { id: "t_tarea_n", key: "nota", name: "Nota", type: "text", label: own },
      },
      { actor: "user" },
    );
    memo.targetsFor(store, ["t_agenda", "t_tarea"]);
    expect(types()).toEqual({ read: ["t_agenda", "t_tarea"], listed: ["t_pers"] });
    gets.mockRestore();
    expect(store.get).toBe(got);
    // A collection no store has, or archived: no target.
    expect(memo.targetsFor(store, ["t_nada"])).toEqual([]);
  }, 120_000);
});
