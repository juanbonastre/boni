// What Boni learns from the person's answers to an automation, outside the automation
// (docs/automatizaciones.md §5.15, decision 10 of §10, phase F15 S3): the signals, the suggestion, the pause and their
// limits (AU-207, AU-209, AU-210, AU-212). The rule's id is kept in each test's name (`make check` reads them, T-10).
// The real store per test with data shaped like the user's, runs by hand through the real service, «Aceptar» and
// «Rechazar» through the real routes of the Bandeja, a year of runs for the daily pass (A-15, its clock from
// `@boni/pace`), and no model: the host has none.
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { type Automation, cellPrint } from "@boni/automations";
import { label } from "@boni/entities";
import { clock, under } from "@boni/pace";
import type { UserStore } from "@boni/store";
import { afterAll, describe, expect, it } from "vitest";
import { AgentHost, serveAgent } from "../agent.ts";
import { DAY, lastSuggested, markSuggested, setLearning } from "../learning.ts";
import {
  CELL_AREA,
  type CellKey,
  cellArea,
  cellOfArea,
  declineSuggestion,
  judgeCells,
  learnAnswer,
  learningOf,
  pausedDoc,
  unpause,
} from "./learning.ts";
import type { AutomationNotice } from "./notices.ts";
import {
  CODE,
  CREATE,
  docOf,
  folder,
  HOUR,
  JUAN,
  made,
  NOW,
  notes,
  OUTSIDE,
  ok,
  PEDIDO,
  ran,
  SHARED,
  START,
  seeded,
  TRASH,
  ZONE,
} from "./run.test-util.ts";
import { onRunEvent, undoAutomationRun } from "./runs.ts";
import { AutomationScheduler } from "./scheduler.ts";
import { publishedOf, sha256 } from "./service.ts";

const files = folder("aprender");
afterAll(files.done);

/** His personal device's name (`HAND`, `JUAN`), the one the daily pass counts. */
const MINE = new Set([JUAN.device]);
const BY_HAND = { actor: "user" as const, device: JUAN.device };
const typed = (value: string) => ({ value, label: label("user", "personal", []) });

const fieldOf = (s: UserStore, key: string) =>
  s.schema().types[PEDIDO]?.fields.find((f) => f.key === key)?.id as string;

/** A store on a clock the test moves. */
function moving() {
  let t = NOW;
  const s = files.store(() => t);
  return { s, at: (next: number) => (t = next) };
}

/** A host with no model at all, its store seeded, and the routes of the Bandeja as the app calls them. */
function hosted() {
  const host = new AgentHost({ dataDir: mkdtempSync(join(files.dir, "host-")), providers: null });
  const s = host.store(1);
  seeded(s);
  const ask = async (route: string, id: string, trust: "personal" | "shared" = "personal") => {
    const got = { status: 0, body: "" };
    const res = {
      writeHead: (st: number) => {
        got.status = st;
        return res;
      },
      end: (b?: string) => {
        got.body = b ?? "";
        return res;
      },
      setHeader: () => res,
    } as unknown as ServerResponse;
    const req = Object.assign(Readable.from([Buffer.from("{}")]), {
      url: "/",
    }) as unknown as IncomingMessage;
    await serveAgent(host, req, res, route, { id }, { account: 1, device: JUAN.device, trust });
    return { status: got.status, json: JSON.parse(got.body || "null") as Record<string, unknown> };
  };
  return {
    host,
    s,
    accept: (id: string, trust?: "personal" | "shared") =>
      ask("POST /api/agent/proposals/:id/accept", id, trust),
    reject: (id: string, trust?: "personal" | "shared") =>
      ask("POST /api/agent/proposals/:id/reject", id, trust),
  };
}

/** What Boni told of the cells (a pause, a suggestion), as the app hears it. */
function told(s: UserStore) {
  const got: AutomationNotice[] = [];
  onRunEvent(s, (e) => {
    if (e.notice && (e.notice.kind === "paused" || e.notice.kind === "suggested"))
      got.push(e.notice);
  });
  return {
    got,
    of: (kind: "paused" | "suggested") => got.filter((n) => n.kind === kind),
  };
}

/** The first row a run saved. */
const rowOf = (s: UserStore, run: string) =>
  s.log({ run }).find((op) => op.kind === "create")?.target as string;

/** The print the counts give a step of a document: `cellPrint` with the server's digest. */
const printOf = (doc: Automation, step: string) => cellPrint(doc, step, sha256);

const cellDecisions = (s: UserStore, run: string) =>
  s.journal.decisionsOf(run).filter((d) => d.area.startsWith(CELL_AREA));

/** An automation's kept documents: the draft and every version. */
const keptOf = (s: UserStore, id: string) =>
  JSON.stringify({
    draft: s.journal.automationDraft(id),
    versions: s.journal.automationVersions(id),
    published: publishedOf(s, id)?.automation,
  });

/** Judged decisions of a cell from before, oldest first: as if these runs had been answered. */
function judged(s: UserStore, key: CellKey, results: readonly boolean[], from: number) {
  const area = cellArea(key);
  s.batch(() => {
    for (const [i, right] of results.entries()) {
      const id = randomUUID();
      const at = from + i * HOUR;
      s.journal.addDecision({
        id,
        run: `r_antes_${randomUUID()}`,
        area,
        cost: "B",
        p: 1,
        outcome: "ask",
        detail: null,
        at,
      });
      s.journal.setDecisionResult(id, right ? "right" : "wrong", at);
    }
  });
}

/** The only cell of an automation's published version. */
const cellOf = (s: UserStore, id: string) => {
  const cells = learningOf(s, id);
  expect(cells).toHaveLength(1);
  return cells[0] as ReturnType<typeof learningOf>[number];
};

describe("what Boni learns from the answers to an automation (F15)", () => {
  it("AU-207 · one decision per cell and run: accepted, rejected, undone, or corrected by hand within 7 days; only acts from a personal device count", async () => {
    // What a «Sí» saved: judged by what his hand does in the next 7 days, by the scheduler's daily pass.
    const { s, at } = moving();
    const a = made(s, [START, CREATE("guardado")]);
    ok(a.publish());
    const runs: string[] = [];
    for (let i = 0; i < 9; i++) runs.push((await ran(s, a.id, a.step("Inicio"), { nota: "x" })).id);
    const [corrected, onShared, byOthers, late, undone, trashed, left, byARun, otherField] =
      runs as [string, string, string, string, string, string, string, string, string];
    for (const r of runs) {
      const ds = cellDecisions(s, r);
      expect(ds).toHaveLength(1);
      expect(ds[0]).toMatchObject({ outcome: "do", result: null });
      expect(cellOfArea(ds[0]?.area as string)).toMatchObject({
        automation: a.id,
        step: a.step("Crear"),
        collection: "pedido",
        action: "create",
      });
    }
    const nota = fieldOf(s, "nota");
    at(NOW + DAY);
    ok(undoAutomationRun(s, a.id, undone, JUAN));
    s.remove(rowOf(s, trashed), BY_HAND);
    at(NOW + 2 * DAY);
    s.update(rowOf(s, corrected), { [nota]: typed("corregido a mano") }, BY_HAND);
    s.update(
      rowOf(s, onShared),
      { [nota]: typed("en el salón") },
      { ...BY_HAND, device: "d_salon" },
    );
    s.update(
      rowOf(s, byOthers),
      { [nota]: typed("de un asistente") },
      { actor: "agent", device: JUAN.device },
    );
    s.update(
      rowOf(s, byOthers),
      { [nota]: { value: "importado", label: OUTSIDE } },
      { actor: "import", device: "seed" },
    );
    // Another run's operation is not his hand; a field the step did not write is not a correction of it.
    s.update(
      rowOf(s, byARun),
      { [nota]: typed("de otra ejecución") },
      { ...BY_HAND, run: "r_otra" },
    );
    s.update(
      rowOf(s, otherField),
      { [fieldOf(s, "importe")]: { value: 40, label: label("user", "personal", []) } },
      BY_HAND,
    );
    // Undone, it is wrong at once.
    expect(cellDecisions(s, undone)[0]?.result).toBe("wrong");
    at(NOW + 7 * DAY + HOUR);
    s.update(rowOf(s, late), { [nota]: typed("pasada la semana") }, BY_HAND);

    let tick = NOW + 8 * DAY;
    const sched = new AutomationScheduler({
      accounts: () => [1],
      hasStore: () => true,
      store: () => s,
      zone: () => ZONE,
      now: () => tick,
      log: () => {},
      personal: () => MINE,
    });
    await Promise.all(sched.tick());
    const result = (r: string) => cellDecisions(s, r).map((d) => d.result);
    expect(result(corrected)).toEqual(["wrong"]);
    expect(result(trashed)).toEqual(["wrong"]);
    expect(result(undone)).toEqual(["wrong"]);
    expect(result(onShared)).toEqual(["right"]);
    expect(result(byOthers)).toEqual(["right"]);
    expect(result(late)).toEqual(["right"]);
    expect(result(left)).toEqual(["right"]);
    expect(result(byARun)).toEqual(["right"]);
    expect(result(otherField)).toEqual(["right"]);
    // Once a day: a tick an hour later does not look again; a look a day later moves nothing already judged.
    const before = JSON.stringify(runs.map((r) => cellDecisions(s, r)));
    const looked = s.setting("automations/learning-judged");
    tick += HOUR;
    await Promise.all(sched.tick());
    expect(s.setting("automations/learning-judged")).toBe(looked);
    expect(judgeCells(s, NOW + 9 * DAY, MINE).judged).toBe(0);
    expect(JSON.stringify(runs.map((r) => cellDecisions(s, r)))).toBe(before);

    // What a «Preguntar» proposed: his «Aceptar» or «Rechazar» in the Bandeja, from a personal device only.
    const h = hosted();
    const b = made(h.s, [START, CREATE("pedida", "ask")]);
    ok(b.publish());
    const next = async () => {
      const r = await ran(h.s, b.id, b.step("Inicio"), { nota: "x" });
      return { run: r.id, proposal: r.proposal as string };
    };
    const accepted = await next();
    expect((await h.accept(accepted.proposal, "shared")).json.error).toBe(
      "accept-on-a-personal-device",
    );
    expect(cellDecisions(h.s, accepted.run)).toEqual([]);
    expect((await h.accept(accepted.proposal)).status).toBe(200);
    expect(cellDecisions(h.s, accepted.run)).toMatchObject([{ outcome: "ask", result: "right" }]);
    // Counted once: the same answer heard again adds nothing.
    expect(learnAnswer(h.s, accepted.proposal, "personal", Date.now())).toEqual([]);
    expect(cellDecisions(h.s, accepted.run)).toHaveLength(1);

    const rejectedOnShared = await next();
    expect((await h.reject(rejectedOnShared.proposal, "shared")).status).toBe(200);
    expect(cellDecisions(h.s, rejectedOnShared.run)).toEqual([]);
    const rejected = await next();
    expect((await h.reject(rejected.proposal)).status).toBe(200);
    expect(cellDecisions(h.s, rejected.run)).toMatchObject([{ outcome: "ask", result: "wrong" }]);

    // Accepted and then undone: one decision, wrong, the last of his acts being what counts.
    const regretted = await next();
    expect((await h.accept(regretted.proposal)).status).toBe(200);
    ok(undoAutomationRun(h.s, b.id, regretted.run, JUAN));
    expect(cellDecisions(h.s, regretted.run)).toMatchObject([{ outcome: "ask", result: "wrong" }]);

    // Accepted and then corrected by his hand within the week: the daily pass turns it wrong.
    const fixed = await next();
    expect((await h.accept(fixed.proposal)).status).toBe(200);
    h.s.update(
      rowOf(h.s, fixed.run),
      { [fieldOf(h.s, "nota")]: typed("aceptada y corregida") },
      BY_HAND,
    );
    judgeCells(h.s, Date.now() + 8 * DAY, MINE);
    expect(cellDecisions(h.s, fixed.run)).toMatchObject([{ outcome: "ask", result: "wrong" }]);
  });

  it("AU-207 · a step whose instructions, code or connections changed starts another count, and the daily pass over a year of runs stays within its time", async () => {
    const { s, at } = moving();
    const a = made(s, [START, CREATE("uno")]);
    ok(a.publish());
    const first = await ran(s, a.id, a.step("Inicio"), { nota: "x" });
    const area = cellDecisions(s, first.id)[0]?.area as string;
    const print = cellOfArea(area)?.print;
    expect(print).toMatch(/^[0-9a-f]{64}$/);
    // Turning «Sí» into «Preguntar» keeps the count: that is what it is for.
    a.edit([START, CREATE("uno", "ask")]);
    ok(a.publish());
    expect(cellOf(s, a.id)).toMatchObject({ mode: "ask", print });
    // Another value written is another step: another count, from nothing.
    a.edit([START, CREATE("dos", "ask")]);
    ok(a.publish());
    const changed = cellOf(s, a.id);
    expect(changed.print).not.toBe(print);
    expect(changed.decided).toBe(0);
    // So is another code, or another limit of a connection.
    const ids = new Map<string, string>();
    const code = docOf([START, CODE("yes")], ids);
    const otherSource = docOf(
      [START, ["Código", "code", { mode: "all", source: "return []" }, CODE("yes")[3]]],
      ids,
    );
    const coded = ids.get("Código") as string;
    const print1 = printOf(code, coded);
    expect(printOf(otherSource, coded)).not.toBe(print1);
    expect(printOf(docOf([START, CODE("ask")], ids), coded)).toBe(print1);

    // A year of hourly runs over 200 automations: the daily pass reads the last days by their index, each run's
    // operations and its rows' by theirs.
    const nota = fieldOf(s, "nota");
    const year = 365 * 24;
    const week = 8 * 24;
    s.batch(() => {
      for (let i = 0; i < year; i++) {
        const when = NOW - i * HOUR;
        const run = `r_anio_${i}`;
        const id = randomUUID();
        s.journal.addDecision({
          id,
          run,
          area: cellArea({
            automation: `a_${i % 200}`,
            step: "s_paso",
            collection: "pedido",
            action: "create",
            print: "p",
          }),
          cost: "B",
          p: 1,
          outcome: "do",
          detail: null,
          at: when,
        });
        if (i >= week) {
          s.journal.setDecisionResult(id, "right", when + 7 * DAY);
          continue;
        }
        at(when);
        // One run of the week saved thousands of rows: each row's operations are read once, by their index.
        if (i === 5)
          for (let k = 0; k < 3000; k++)
            s.create(PEDIDO, { [nota]: typed(`lote ${k}`) }, { ...BY_HAND, run });
        const row = s.create(PEDIDO, { [nota]: typed(`pedido ${i}`) }, { ...BY_HAND, run }).entity
          .id;
        if (i % 10 === 0) {
          at(when + HOUR / 2);
          s.update(row, { [nota]: typed(`corregido ${i}`) }, BY_HAND);
        }
      }
    });
    // A year of one real cell's answers, for what the app reads of it.
    judged(
      s,
      changed,
      Array.from({ length: year }, () => true),
      NOW - year * HOUR,
    );
    let start = clock();
    const pass = judgeCells(s, NOW + HOUR, MINE);
    under(clock() - start, 400, "cpu", "the daily pass over a year of runs of 200 automations");
    const window = s.journal.decisionsSince(CELL_AREA, NOW - week * HOUR + 1);
    const yearOf = window.filter((d) => d.run.startsWith("r_anio_"));
    expect(yearOf.filter((d) => d.result === "wrong")).toHaveLength(Math.ceil(week / 10));
    expect(pass.judged).toBeGreaterThan(week / 10);
    // The newest of its decisions not yet judged (a busy cell's last week): the count is of the judged ones.
    s.batch(() => {
      for (let i = 0; i < 200; i++)
        s.journal.addDecision({
          id: randomUUID(),
          run: `r_semana_${i}`,
          area: cellArea(changed),
          cost: "B",
          p: 1,
          outcome: "do",
          detail: null,
          at: NOW + i,
        });
    });
    start = clock();
    const cells = learningOf(s, a.id);
    under(clock() - start, 10, "cpu", "an automation's counts over a year of its answers");
    expect(cells[0]).toMatchObject({ decided: 20, right: 20 });
  });

  it("AU-209 · at 20 decisions with 95 % accepted there is one suggestion; the published version and the draft stay as they were, and a «No» is not repeated", async () => {
    const h = hosted();
    const said = told(h.s);
    const a = made(h.s, [START, CREATE("pedida", "ask")]);
    ok(a.publish());
    const kept = keptOf(h.s, a.id);
    const answer = async () => {
      const r = await ran(h.s, a.id, a.step("Inicio"), { nota: "x" });
      expect((await h.accept(r.proposal as string)).status).toBe(200);
    };
    for (let i = 0; i < 19; i++) await answer();
    expect(said.of("suggested")).toEqual([]);
    await answer();
    expect(said.of("suggested")).toHaveLength(1);
    expect(said.of("suggested")[0]?.text).toBe(
      "Has aceptado 20 de 20 propuestas de «Crear» en Pedido. ¿Quieres que guarde sin preguntar?",
    );
    // A suggestion and nothing else: no «Sí» anywhere, the next run asks again.
    expect(keptOf(h.s, a.id)).toBe(kept);
    const cell = cellOf(h.s, a.id);
    expect(cell).toMatchObject({ mode: "ask", decided: 20, right: 20, declined: null });
    expect(cell.suggested).toBeTypeOf("number");
    const before = notes(h.s).length;
    const asked = await ran(h.s, a.id, a.step("Inicio"), { nota: "x" });
    expect(asked.proposal).toBeTypeOf("string");
    expect(notes(h.s)).toHaveLength(before);
    expect((await h.accept(asked.proposal as string)).status).toBe(200);
    expect(said.of("suggested")).toHaveLength(1);
    // His «No», from a personal device only; a day later it is not asked again.
    expect(declineSuggestion(h.s, cell, SHARED)).toEqual({ refused: "not-personal" });
    expect(declineSuggestion(h.s, cell, JUAN)).toBeNull();
    markSuggested(h.s, Date.now() - 2 * DAY);
    await answer();
    expect(said.of("suggested")).toHaveLength(1);
    expect(cellOf(h.s, a.id).declined).toBe(JUAN.now);
    expect(keptOf(h.s, a.id)).toBe(kept);
  });

  it("AU-209 · there is never a suggestion for the action that trashes rows", async () => {
    const h = hosted();
    const said = told(h.s);
    const a = made(h.s, [START, TRASH("sobra", "ask")]);
    ok(a.publish());
    const nota = fieldOf(h.s, "nota");
    for (let i = 0; i < 21; i++) {
      h.s.create(
        PEDIDO,
        { [nota]: { value: "sobra", label: OUTSIDE } },
        { actor: "import", device: "seed" },
      );
      const r = await ran(h.s, a.id, a.step("Inicio"), { nota: "x" });
      expect((await h.accept(r.proposal as string)).status).toBe(200);
    }
    expect(cellOf(h.s, a.id)).toMatchObject({
      action: "remove",
      mode: "ask",
      decided: 20,
      right: 20,
      suggested: null,
    });
    expect(said.of("suggested")).toEqual([]);
    // Nor is the day's one suggestion spent on it.
    expect(lastSuggested(h.s)).toBeNull();
  });

  it("AU-210 · three failures in a row, or 4 of the last 20, pause the cell: runs propose, the published version is unchanged, and only his hand on a personal device lifts it", async () => {
    const s = files.store();
    const said = told(s);
    const a = made(s, [START, CREATE("sola")]);
    ok(a.publish());
    const kept = keptOf(s, a.id);
    const saved = () => notes(s).filter((n) => n === "sola").length;
    for (let i = 0; i < 3; i++) {
      const r = await ran(s, a.id, a.step("Inicio"), { nota: "x" });
      expect(r.proposal).toBeNull();
      ok(undoAutomationRun(s, a.id, r.id, JUAN));
      expect(said.of("paused")).toHaveLength(i < 2 ? 0 : 1);
    }
    expect(said.of("paused")[0]?.text).toBe(
      "Boni vuelve a preguntar en «Crear» · Pedido: 3 seguidas deshechas, rechazadas o corregidas",
    );
    expect(keptOf(s, a.id)).toBe(kept);
    const cell = cellOf(s, a.id);
    expect(cell).toMatchObject({ mode: "yes", paused: { why: "inARow" } });
    // Paused, a run proposes what it would have saved.
    const asked = await ran(s, a.id, a.step("Inicio"), { nota: "x" });
    expect(asked.proposal).toBeTypeOf("string");
    expect(saved()).toBe(0);
    // Only his hand on a personal device lifts it; then it saves again.
    expect(unpause(s, cell, SHARED)).toEqual({ refused: "not-personal" });
    expect(cellOf(s, a.id).paused).not.toBeNull();
    expect(unpause(s, cell, JUAN)).toBeNull();
    expect(unpause(s, cell, JUAN)).toEqual({ refused: "nothing" });
    const again = await ran(s, a.id, a.step("Inicio"), { nota: "x" });
    expect(again.proposal).toBeNull();
    expect(saved()).toBe(1);
    expect(keptOf(s, a.id)).toBe(kept);

    // 4 of the last 20: three failures apart, among answers that were right, and a fourth.
    const b = made(s, [START, CREATE("otra")]);
    ok(b.publish());
    const key = cellOf(s, b.id);
    const R = true;
    const W = false;
    judged(s, key, [...Array(13).fill(R), W, R, W, R, W, R], NOW - 30 * HOUR);
    const r = await ran(s, b.id, b.step("Inicio"), { nota: "x" });
    ok(undoAutomationRun(s, b.id, r.id, JUAN));
    expect(cellOf(s, b.id).paused).toMatchObject({ why: "share" });
    expect(said.of("paused")[1]?.text).toBe(
      "Boni vuelve a preguntar en «Crear» · Pedido: 4 de las últimas 20 deshechas, rechazadas o corregidas",
    );

    // Decided overnight: turning the step to «Preguntar» and back to «Sí» keeps the pause (the same step); a
    // published change of what the step writes is another step, with no pause.
    const c = made(s, [START, CREATE("tercera")]);
    ok(c.publish());
    for (let i = 0; i < 3; i++) {
      const u = await ran(s, c.id, c.step("Inicio"), { nota: "x" });
      ok(undoAutomationRun(s, c.id, u.id, JUAN));
    }
    c.edit([START, CREATE("tercera", "ask")]);
    ok(c.publish());
    c.edit([START, CREATE("tercera")]);
    ok(c.publish());
    expect(cellOf(s, c.id)).toMatchObject({ mode: "yes", paused: { why: "inARow" } });
    expect((await ran(s, c.id, c.step("Inicio"), { nota: "x" })).proposal).toBeTypeOf("string");
    c.edit([START, CREATE("cuarta")]);
    ok(c.publish());
    expect(cellOf(s, c.id)).toMatchObject({ mode: "yes", paused: null, decided: 0 });
    expect((await ran(s, c.id, c.step("Inicio"), { nota: "x" })).proposal).toBeNull();
    expect(notes(s)).toContain("cuarta");
  });

  it("AU-210 · a pause can only lower a «Sí»: nothing it stores makes a run save what the cell would ask", async () => {
    const s = files.store();
    const a = made(s, [START, CREATE("pregunta", "ask")]);
    ok(a.publish());
    const key = cellOf(s, a.id);
    // Whatever the setting holds for the cell, even a forged «Sí», the run asks.
    s.setSetting(
      "automations/learning",
      JSON.stringify({
        [cellArea(key)]: {
          ...key,
          mode: "yes",
          permission: "yes",
          paused: { at: NOW, why: "inARow", run: "r_x" },
        },
      }),
    );
    const r = await ran(s, a.id, a.step("Inicio"), { nota: "x" });
    expect(r.proposal).toBeTypeOf("string");
    expect(notes(s)).not.toContain("pregunta");
    const pub = publishedOf(s, a.id)?.automation;
    if (!pub) throw new Error("not published");
    expect(pausedDoc(s, a.id, pub)).toBe(pub);
    // A paused «Código» connection is lowered to «Preguntar», and nothing else of the step moves.
    const ids = new Map<string, string>();
    const yes = { ...docOf([START, CODE("yes")], ids), id: a.id };
    const step = ids.get("Código") as string;
    s.setSetting(
      "automations/learning",
      JSON.stringify({
        [cellArea({ ...key, step, print: printOf(yes, step) })]: {
          ...key,
          step,
          print: printOf(yes, step),
          paused: { at: NOW, why: "inARow", run: "r_x" },
        },
      }),
    );
    const lowered = pausedDoc(s, a.id, yes);
    expect(lowered).not.toBe(yes);
    expect(lowered).toEqual({ ...docOf([START, CODE("ask")], ids), id: a.id });
    expect(pausedDoc(s, a.id, lowered)).toBe(lowered);
  });

  it("AU-212 · with «Aprender» off there is no suggestion and no new pause; at most one suggestion a day; no count reaches a model", async () => {
    const h = hosted();
    expect(h.host.onFor(1)).toBe(false);
    const said = told(h.s);
    const answer = async (id: string, start: string) => {
      const r = await ran(h.s, id, start, { nota: "x" });
      expect((await h.accept(r.proposal as string)).status).toBe(200);
    };
    const a = made(h.s, [START, CREATE("pedida", "ask")]);
    ok(a.publish());
    judged(h.s, cellOf(h.s, a.id), Array(19).fill(true), Date.now() - 30 * HOUR);
    const yes = made(h.s, [START, CREATE("sola")]);
    ok(yes.publish());

    setLearning(h.s, false);
    await answer(a.id, a.step("Inicio"));
    for (let i = 0; i < 3; i++) {
      const r = await ran(h.s, yes.id, yes.step("Inicio"), { nota: "x" });
      ok(undoAutomationRun(h.s, yes.id, r.id, JUAN));
    }
    expect(said.got).toEqual([]);
    // What he decided is still kept: it is his.
    expect(cellOf(h.s, a.id)).toMatchObject({ decided: 20, right: 20, suggested: null });
    expect(cellOf(h.s, yes.id)).toMatchObject({ decided: 3, right: 0, paused: null });

    setLearning(h.s, true);
    await answer(a.id, a.step("Inicio"));
    expect(said.of("suggested").map((n) => n.automation)).toEqual([a.id]);
    // Another cell earns it the same day: not until a day has passed since the last suggestion of any learner.
    const b = made(h.s, [START, CREATE("otra pedida", "ask")]);
    ok(b.publish());
    judged(h.s, cellOf(h.s, b.id), Array(19).fill(true), Date.now() - 30 * HOUR);
    await answer(b.id, b.step("Inicio"));
    expect(said.of("suggested")).toHaveLength(1);
    markSuggested(h.s, Date.now() - DAY - 1000);
    await answer(b.id, b.step("Inicio"));
    expect(said.of("suggested").map((n) => n.automation)).toEqual([a.id, b.id]);
    expect(h.host.onFor(1)).toBe(false);
  });
});
