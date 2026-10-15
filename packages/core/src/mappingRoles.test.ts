import { describe, expect, it } from "vitest";
import {
  assignRole,
  type CalendarMapping,
  type Collection,
  candidateColumns,
  columnOfRole,
  rolesOf,
  setDoneValues,
  validateModel,
} from "./index.ts";

const coll: Collection = {
  id: "c",
  name: "C",
  columns: [
    { id: "title", name: "Título", type: "text" },
    { id: "date", name: "Fecha", type: "date" },
    { id: "due", name: "Límite", type: "date" },
    { id: "from", name: "Desde", type: "time" },
    { id: "to", name: "Hasta", type: "time" },
    { id: "ok", name: "Hecha", type: "checkbox" },
    { id: "flag", name: "Revisada", type: "checkbox" },
    {
      id: "state",
      name: "Estado",
      type: "select",
      options: [
        { id: "todo", label: "Pendiente", color: "#94a3b8" },
        { id: "done", label: "Hecho", color: "#4ade80" },
      ],
    },
    { id: "kind", name: "Tipo", type: "select", options: [{ id: "a", label: "A", color: "#fff" }] },
  ],
};
const split: CalendarMapping = {
  title: "title",
  when: { kind: "split", date: "date", startTime: "from" },
  task: { column: "ok" },
};

describe("mapping roles", () => {
  it("lists the roles that apply to each form", () => {
    expect(rolesOf(split)).toEqual(["date", "startTime", "endTime", "endDate", "task"]);
    expect(rolesOf({ title: "t", when: { kind: "range", start: "a" } })).toEqual([
      "start",
      "end",
      "task",
    ]);
  });

  it("offers columns of the right type that no other role uses", () => {
    const ids = (role: Parameters<typeof candidateColumns>[2]) =>
      candidateColumns(coll, split, role).map((c) => c.id);
    expect(ids("date")).toEqual(["date", "due"]);
    expect(ids("endDate")).toEqual(["due"]); // `date` is taken by the date role
    expect(ids("startTime")).toEqual(["from", "to"]);
    expect(ids("endTime")).toEqual(["to"]);
    // `kind` has a single option, so it cannot be an open/done pair.
    expect(ids("task")).toEqual(["ok", "flag", "state"]);
  });

  it("assigns and clears optional roles, never the required one", () => {
    const withEnd = assignRole(split, coll, "endTime", "to");
    expect(columnOfRole(withEnd, "endTime")).toBe("to");
    expect(
      columnOfRole(assignRole(withEnd, coll, "endTime", undefined), "endTime"),
    ).toBeUndefined();
    expect(assignRole(split, coll, "date", undefined)).toBe(split);
    expect(columnOfRole(assignRole(split, coll, "date", "due"), "date")).toBe("due");
  });

  it("starts a status task column with its last option as done", () => {
    const m = assignRole(split, coll, "task", "state");
    expect(m.task).toEqual({ column: "state", doneValues: ["done"] });
    expect(
      validateModel(
        [coll],
        [{ id: "v", collectionId: "c", accountId: "a", color: "#fff", visible: true, mapping: m }],
      ).filter((i) => i.severity === "error"),
    ).toEqual([]);
    expect(setDoneValues(m, ["todo"]).task?.doneValues).toEqual(["todo"]);
    expect(assignRole(m, coll, "task", "flag").task).toEqual({ column: "flag" });
    expect(assignRole(m, coll, "task", undefined).task).toBeUndefined();
  });
});
