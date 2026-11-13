import { emptyPage } from "@boni/views";
import { describe, expect, it } from "vitest";
import type { DataRow, Page } from "./agent.ts";
import {
  answered,
  creating,
  FAILING_AFTER,
  FAILING_RETRY_MS,
  type Failing,
  failedAgain,
  made,
  merged,
  newPageWrite,
  overPage,
  overRow,
  pageWrite,
  parseUnsent,
  renamed,
  rowWrite,
  type UnsentWrite,
} from "./unsent.ts";

const page: Page = {
  id: "p_01",
  title: "Del servidor",
  icon: "",
  parent: null,
  position: 1,
  spec: emptyPage(),
};
const row: DataRow = {
  id: "r_01",
  values: { titulo: "Nota", lugar: "Sala 1" },
  updated: 1,
  body: "Uno",
};

describe("what was typed and has no answer yet (task 100)", () => {
  it("keeps one write per page or row, the later one's fields over the earlier's", () => {
    let list: UnsentWrite[] = [];
    list = merged(list, rowWrite("r_01", { lugar: "Sala 2" }, undefined, 10));
    list = merged(list, rowWrite("r_01", {}, "Dos", 20));
    list = merged(list, pageWrite("p_01", { title: "Mía" }, 30));
    expect(list).toEqual([
      {
        path: "api/data/rows/r_01",
        at: 20,
        id: "r_01",
        kind: "row",
        values: { lugar: "Sala 2" },
        body: "Dos",
      },
      { path: "api/pages/p_01", at: 30, id: "p_01", kind: "page", patch: { title: "Mía" } },
    ]);
  });

  it("an answer takes out what was written before its request left, not what came after", () => {
    const list = [rowWrite("r_01", {}, "Dos", 20), pageWrite("p_01", { title: "Mía" }, 30)];
    expect(answered(list, "api/data/rows/r_01", 25)).toEqual([list[1]]);
    expect(answered(list, "api/data/rows/r_01", 15)).toEqual(list);
    expect(answered(list, "api/pages/p_01", 30)).toEqual([list[0]]);
  });

  it("an answer to another part of the app writing the same note takes out only what it carried (task 106)", () => {
    const list = [
      rowWrite("r_01", { lugar: "Sala 2" }, "Dos", 20),
      pageWrite("p_01", { title: "Mía", icon: "📄" }, 30),
    ];
    // A task ticked: its field alone.
    expect(
      answered(list, "api/data/rows/r_01", 25, rowWrite("r_01", { hecha: true }, undefined, 25)),
    ).toEqual(list);
    expect(
      answered(
        list,
        "api/data/rows/r_01",
        25,
        rowWrite("r_01", { lugar: "Sala 3" }, undefined, 25),
      ),
    ).toEqual([rowWrite("r_01", {}, "Dos", 20), list[1]]);
    expect(
      answered(list, "api/data/rows/r_01", 25, rowWrite("r_01", { lugar: "X" }, "Tres", 25)),
    ).toEqual([list[1]]);
    expect(answered(list, "api/pages/p_01", 35, pageWrite("p_01", { icon: "📁" }, 35))).toEqual([
      list[0],
      pageWrite("p_01", { title: "Mía" }, 30),
    ]);
    // Written here after that request left: all of it stays.
    expect(
      answered(list, "api/data/rows/r_01", 15, rowWrite("r_01", { lugar: "X" }, "Tres", 15)),
    ).toEqual(list);
  });

  it(`a write the server fails ${FAILING_AFTER} times in a row is said once and tried once an hour (task 106)`, () => {
    let f: Failing | undefined;
    const said: number[] = [];
    for (let i = 1; i <= FAILING_AFTER + 3; i++) {
      const r = failedAgain(f, i * 60_000);
      f = r.failing;
      if (r.say) said.push(i);
      expect(f.next).toBe(i < FAILING_AFTER ? 0 : i * 60_000 + FAILING_RETRY_MS);
    }
    expect(said).toEqual([FAILING_AFTER]);
    expect(f?.times).toBe(FAILING_AFTER + 3);
  });

  it("a page or a note is shown with what was kept over the server's or the device's copy", () => {
    const list = [
      pageWrite("p_01", { title: "Mía" }, 30),
      rowWrite("r_01", { lugar: "Sala 2" }, "Dos", 20),
    ];
    expect(overPage(page, list)).toEqual({ ...page, title: "Mía" });
    expect(overRow(row, list)).toEqual({
      ...row,
      values: { titulo: "Nota", lugar: "Sala 2" },
      body: "Dos",
    });
    expect(overPage({ ...page, id: "p_02" }, list)).toEqual({ ...page, id: "p_02" });
  });

  it("reads what the device kept, and nothing from a broken file", () => {
    const list = [pageWrite("p_01", { title: "Mía" }, 30)];
    expect(parseUnsent(JSON.stringify(list))).toEqual(list);
    expect(parseUnsent(null)).toEqual([]);
    expect(parseUnsent("{roto")).toEqual([]);
    expect(parseUnsent(JSON.stringify([{ path: "api/pages/x" }, 3, null]))).toEqual([]);
  });

  it("a long note's text is merged at once (nothing runs on every key; this is once per pause)", () => {
    const body = Array.from({ length: 5000 }, (_, i) => `Línea ${i}`).join("\n\n");
    let list: UnsentWrite[] = [];
    const t = performance.now();
    for (let i = 0; i < 100; i++) list = merged(list, rowWrite("r_01", {}, `${body} ${i}`, i));
    expect(performance.now() - t).toBeLessThan(200);
    expect(list).toHaveLength(1);
  });

  it("a page made here waits for the server to make it; then what was typed in it goes (task 109)", () => {
    const id = "e_01kaaaaaaaaaaaaaaaaaaaaaaa";
    let list: UnsentWrite[] = [newPageWrite(id, "e_01kpadreaaaaaaaaaaaaaaaaa", 10)];
    list = merged(list, pageWrite(id, { title: "Plan" }, 20));
    list = merged(list, pageWrite(id, { spec: emptyPage() }, 30));
    expect(creating(list, id)).toBe(true);
    // Kept on the device and read back as it was: the create first, then one write with every field.
    expect(parseUnsent(JSON.stringify(list))).toEqual(list);
    expect(list.map((w) => w.path)).toEqual([`api/pages#${id}`, `api/pages/${id}`]);
    const after = made(list, id);
    expect(creating(after, id)).toBe(false);
    expect(after).toEqual([pageWrite(id, { title: "Plan", spec: emptyPage() }, 30)]);
    // Two pages made here are two creates.
    const other = "e_01kcccccccccccccccccccccccc";
    expect(merged(list, newPageWrite(other, null, 40))).toHaveLength(3);
  });

  it("a page a server before task 109 made with its own id takes what was typed for it, no field lost", () => {
    const id = "e_01kaaaaaaaaaaaaaaaaaaaaaaa";
    const real = "e_01kbbbbbbbbbbbbbbbbbbbbbbb";
    const list = [pageWrite(id, { title: "Plan", icon: "📄" }, 20), rowWrite("r_01", {}, "Uno", 5)];
    expect(renamed(list, id, real)).toEqual([
      rowWrite("r_01", {}, "Uno", 5),
      pageWrite(real, { title: "Plan", icon: "📄" }, 20),
    ]);
    // A write to the real id already there (the window renamed first): the later fields win, none is lost.
    const both = [...list, pageWrite(real, { title: "Plan de ejemplo" }, 30)];
    expect(renamed(both, id, real)).toEqual([
      rowWrite("r_01", {}, "Uno", 5),
      pageWrite(real, { title: "Plan de ejemplo", icon: "📄" }, 30),
    ]);
    expect(renamed(list, "otra", real)).toEqual(list);
  });
});
