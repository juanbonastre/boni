// The Registro's «Acierto»: Boni's decisions counted per area and per level of confidence (docs/fiabilidad.md §3.3).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leaf, rec } from "@boni/agent";
import { label } from "@boni/entities";
import { openUserStore, type UserStore } from "@boni/store";
import { afterEach, describe, expect, it } from "vitest";
import { accuracy, areasView, setAuto } from "./accuracy.ts";

/** Proposals from invented mail and Juan's decisions on them, as the journal keeps them (as autoAccept.test.ts). */
function mailEnv(store: UserStore) {
  const u = label("user", "personal", []);
  const l = label("external", "personal", [{ kind: "mail", id: "x" }]);
  store.applySchema(
    {
      op: "create_type",
      type: {
        id: "t_tarea",
        key: "tarea",
        name: "Tareas",
        fields: [{ id: "f_title", key: "title", name: "Título", type: "text", label: u }],
        titleField: "f_title",
        sensitivity: "personal",
        schemaVersion: 1,
        label: u,
      },
    },
    { actor: "agent" },
  );
  let n = 0;
  return {
    proposal(sender: string, decided?: { accept: boolean }) {
      const id = `p${++n}`;
      store.journal.startRun({
        id: `r${n}`,
        turn: null,
        origin: "background",
        device: null,
        started: n,
      });
      store.journal.addProposal({
        id,
        run: `r${n}`,
        tool: "entities.create",
        args: {
          values: { type: leaf("tarea", l), values: rec({ title: leaf("Tarea inventada", l) }, l) },
          origins: [],
        },
        view: {
          tool: "entities.create",
          title: "Crear",
          rows: [
            { arg: "type", role: "type", value: "tarea", detail: "Tareas" },
            { arg: "values.title", value: "Tarea inventada" },
          ],
        },
        sources: [`mail:${sender}`],
        created: n,
      });
      if (decided) store.journal.setProposal(id, decided.accept ? "accepted" : "rejected", n, null);
    },
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe("how right Boni's decisions are (docs/fiabilidad.md)", () => {
  it("counts each area's last decisions: alone, asked, left, judged and right, and by level", () => {
    const dir = mkdtempSync(join(tmpdir(), "boni-accuracy-"));
    const store = openUserStore(join(dir, "user.db"));
    cleanups.push(() => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const j = store.journal;
    const base = { run: "r", area: "choice", cost: "A" as const, detail: null };
    j.addDecision({ ...base, id: "d1", p: 0.95, outcome: "do", at: 1 });
    j.addDecision({ ...base, id: "d2", p: 0.65, outcome: "do", at: 2 });
    j.addDecision({ ...base, id: "d3", p: 0.4, outcome: "ask", at: 3 });
    j.addDecision({ ...base, id: "d4", p: 0.7, outcome: "do", at: 4 });
    j.addDecision({ ...base, id: "d5", area: "fill", p: 0.2, outcome: "nothing", at: 5 });
    j.setDecisionResult("d1", "right", 6);
    j.setDecisionResult("d2", "wrong", 7);
    const [choice, fill] = accuracy(store);
    expect(choice).toMatchObject({
      area: "choice",
      total: 4,
      done: 3,
      asked: 1,
      nothing: 0,
      judged: 2,
      right: 1,
    });
    expect(choice?.levels.filter((l) => l.judged).map((l) => [l.from, l.judged, l.right])).toEqual([
      [0.6, 1, 0],
      [0.9, 1, 1],
    ]);
    expect(fill).toMatchObject({ area: "fill", total: 1, done: 0, nothing: 1, judged: 0 });
    expect(accuracy(openUserStore(":memory:"))).toEqual([]);
  });
});

describe("each area's «Solo» (docs/fiabilidad.md §3.4)", () => {
  it("«Aceptar solas» shows from the first mail decided, earns its switch at 20 right of 20, and Juan turns it", () => {
    const store = openUserStore(":memory:");
    expect(areasView(store, 0)).toEqual([]);
    // One choice decision, and no mail decided yet: the choice area, without a switch.
    store.journal.addDecision({
      id: "d1",
      run: "r",
      area: "choice",
      cost: "A",
      p: 0.95,
      outcome: "do",
      detail: null,
      at: 1,
    });
    expect(areasView(store, 0)).toMatchObject([
      { area: "choice", cost: "A", switchable: false, auto: false, earned: false },
    ]);
    // A mail decided: the area appears, judged by the rule's replay, not earned, so the switch stays off.
    const mail = mailEnv(store);
    for (let i = 0; i < 4; i++) mail.proposal("boletin@example.edu", { accept: true });
    expect(areasView(store, 0).map((a) => a.area)).toEqual(["choice", "mail.accept"]);
    expect(areasView(store, 0)[1]).toMatchObject({
      area: "mail.accept",
      cost: "B",
      switchable: true,
      total: 4,
      done: 0,
      asked: 4,
      judged: 1,
      right: 1,
      earned: false,
      auto: false,
      earnsWith: { decisions: 20, accuracy: 0.95 },
    });
    expect(setAuto(store, "mail.accept", true, 5)).toBe("not-earned");
    expect(setAuto(store, "choice", true, 5)).toBe("not-switchable");
    expect(setAuto(store, "nope", true, 5)).toBe("not-switchable");
    for (let i = 0; i < 19; i++) mail.proposal("boletin@example.edu", { accept: true });
    const a = areasView(store, 0)[1];
    expect(a).toMatchObject({ judged: 20, right: 20, earned: true, auto: false });
    expect(setAuto(store, "mail.accept", true, 5)).toBe("ok");
    expect(areasView(store, 6)[1]).toMatchObject({ auto: true, autoBy: "juan", autoAt: 5 });
    expect(setAuto(store, "mail.accept", false, 7)).toBe("ok");
    expect(areasView(store, 8)[1]).toMatchObject({ auto: false, autoBy: "juan", autoAt: 7 });
  });
});
