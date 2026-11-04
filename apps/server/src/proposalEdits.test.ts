import { leaf, rec } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type ProposalRow } from "@boni/store";
import { describe, expect, it } from "vitest";
import { intoOf, linkOf, mergeInto } from "./proposalEdits.ts";
import { seed } from "./seed.test-util.ts";

describe("a proposal accepted linked to an external event (task 51)", () => {
  it("takes the event's id as the calendar app writes it, nothing else", () => {
    expect(linkOf({ title: "x" })).toEqual({ id: null });
    expect(linkOf(undefined)).toEqual({ id: null });
    expect(linkOf({ link: "ext:ucam:u1" })).toEqual({ id: "ext:ucam:u1" });
    expect(linkOf({ link: "ext:ucam:taller@example.com~20348" })).toEqual({
      id: "ext:ucam:taller@example.com~20348",
    });
    expect(linkOf({ link: "u1" })).toEqual({ error: "bad-link" });
    expect(linkOf({ link: "ext:ucam:" })).toEqual({ error: "bad-link" });
    expect(linkOf({ link: 7 })).toEqual({ error: "bad-link" });
    expect(linkOf({ link: "ext:a b:c" })).toEqual({ error: "bad-link" });
  });
});

describe("a proposal accepted as the same thing as a record («Es el mismo», task 58)", () => {
  const L = label("user", "personal", []);
  const RAW = {
    id: "docencia",
    name: "Docencia",
    folder: "agenda/docencia",
    account: "Agenda",
    color: "#60a5fa",
    columns: [
      { id: "title", name: "Título", type: "text" },
      { id: "date", name: "Fecha", type: "date" },
      { id: "startTime", name: "Hora de inicio", type: "time" },
      { id: "endTime", name: "Hora de fin", type: "time" },
      { id: "note", name: "Nota", type: "text" },
    ],
    mapping: {
      title: "title",
      when: { kind: "split", date: "date", startTime: "startTime", endTime: "endTime" },
    },
  };
  it("takes a record's id, nothing else", () => {
    expect(intoOf({ title: "x" })).toEqual({ id: null });
    expect(intoOf(undefined)).toEqual({ id: null });
    expect(intoOf({ into: "e_01abcdef" })).toEqual({ id: "e_01abcdef" });
    expect(intoOf({ into: "ghost:p1" })).toEqual({ error: "bad-into" });
    expect(intoOf({ into: 7 })).toEqual({ error: "bad-into" });
  });
  it("only what the record lacks goes into it: its title and day stay, its empty fields take the proposal's", () => {
    const store = openUserStore(":memory:");
    seed(
      store,
      [{ key: "docencia", name: "Docencia", folder: "agenda/docencia/", calendar: RAW }],
      {
        "agenda/docencia/2026-10-28 Quedada.md":
          '---\ntitle: "Quedada cafe"\ndate: "2026-10-28"\nstartTime: "16:00"\nendTime:\nnote:\n---\n',
      },
    );
    const r = store.list("t_docencia")[0];
    if (!r) throw new Error("no record");
    const p = {
      args: {
        values: {
          type: leaf("docencia", L),
          values: rec(
            {
              title: leaf("Tomar café con Ana", L),
              date: leaf("2026-10-28", L),
              starttime: leaf("16:00", L),
              endtime: leaf("17:00", L),
              note: leaf("Con Ana", L),
              other: leaf("x", L),
            },
            L,
          ),
        },
      },
    } as unknown as ProposalRow;
    expect(mergeInto(store, p, r.entity.id, {})).toEqual({
      values: {
        title: null,
        date: null,
        starttime: null,
        endtime: "17:00",
        note: "Con Ana",
        other: null,
      },
    });
    // Juan's own correction of a field counts, if the record lacks it; a field he cleared is left out. (The keys are
    // the collection's, as the schema gives them: lowercase.)
    expect(
      mergeInto(store, p, r.entity.id, { note: "Con Ana y Luis", endtime: null }),
    ).toMatchObject({
      values: { note: "Con Ana y Luis", endtime: null },
    });
    expect(mergeInto(store, p, "e_nadie", {})).toEqual({ error: "no-such-record" });
    store.close();
  });
});
