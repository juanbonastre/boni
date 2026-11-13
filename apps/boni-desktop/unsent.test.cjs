const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUnsent, FILE, QUIT_WAIT_MS } = require("./unsent.cjs");

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "boni-unsent-"));
const listIn = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
  } catch {
    return null;
  }
};
const page = (id, at, title) => ({
  path: `api/pages/${id}`,
  at,
  id,
  kind: "page",
  patch: { title },
});
const row = (id, at, values, body) => ({
  path: `api/data/rows/${id}`,
  at,
  id,
  kind: "row",
  values,
  ...(body !== undefined ? { body } : {}),
});

test("only a page's or a row's write is kept until answered", () => {
  const u = createUnsent(folder(), () => 10);
  assert.deepEqual(u.sending("PUT", "api/pages/p1", { title: "Uno" }), {
    path: "api/pages/p1",
    at: 10,
    fields: ["patch.title"],
  });
  assert.ok(u.sending("PUT", "api/data/rows/r1"));
  assert.equal(u.sending("GET", "api/pages/p1"), null);
  assert.equal(u.sending("PUT", "api/data/rows/r1/type"), null);
  assert.equal(u.sending("POST", "api/pages"), null);
});

const ID = "e_01kaaaaaaaaaaaaaaaaaaaaaaa";
const REAL = "e_01kbbbbbbbbbbbbbbbbbbbbbbb";
const newPage = (id, at) => ({ path: `api/pages#${id}`, at, id, kind: "new-page", parent: null });
const pageAnswer = (id) => JSON.stringify({ page: { id, title: "" } });

test("a page made here is kept until its create is answered, even with the window gone (task 109)", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 50);
  const ticket = u.sending("POST", "api/pages", { id: ID, title: "", parent: null });
  assert.ok(ticket);
  // The window went with the create in flight: it kept the page and what was typed in it.
  u.keep(JSON.stringify([newPage(ID, 40), page(ID, 45, "Plan")]));
  u.answered(ticket, true, pageAnswer(ID));
  // The page is on the server: what was typed in it goes on the next start, to it.
  assert.deepEqual(listIn(dir), [page(ID, 45, "Plan")]);
  // A window that kept its list before it saw the answer does not bring the create back.
  u.keep(JSON.stringify([newPage(ID, 40), page(ID, 60, "Plan de ejemplo")]));
  assert.deepEqual(listIn(dir), [page(ID, 60, "Plan de ejemplo")]);
});

test("a create with no answer leaves the page kept; one a server before task 109 answered moves its writes", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 50);
  const lost = u.sending("POST", "api/pages", { id: ID, title: "" });
  u.keep(JSON.stringify([newPage(ID, 40), page(ID, 45, "Plan")]));
  u.answered(lost, false, "");
  assert.deepEqual(listIn(dir), [newPage(ID, 40), page(ID, 45, "Plan")]);
  // An answer without the page (the session gone, too many requests) does not make it either.
  u.answered(
    u.sending("POST", "api/pages", { id: ID, title: "" }),
    true,
    '{"error":"unauthorized"}',
  );
  assert.deepEqual(listIn(dir), [newPage(ID, 40), page(ID, 45, "Plan")]);
  // An older server made it with an id of its own.
  u.answered(u.sending("POST", "api/pages", { id: ID, title: "" }), true, pageAnswer(REAL));
  assert.deepEqual(listIn(dir), [page(REAL, 45, "Plan")]);
  // A create without an id (an older page) is not kept, as before.
  assert.equal(u.sending("POST", "api/pages", { title: "" }), null);
});

test("a write answered after the window went is taken out of the list; a newer one of the same page stays", () => {
  const dir = folder();
  let clock = 100;
  const u = createUnsent(dir, () => clock);
  // The page sent «Hola» (kept at 90), then went with «Hola mundo» typed at 120, not yet sent.
  const ticket = u.sending("PUT", "api/pages/p1", { title: "Hola" });
  u.keep(JSON.stringify([page("p1", 90, "Hola"), page("p2", 95, "Otra")]));
  clock = 130;
  u.answered(ticket, true);
  assert.deepEqual(listIn(dir), [page("p2", 95, "Otra")]);
  // A newer write of p1, made after the answered one left, is not taken out by that answer.
  const second = u.sending("PUT", "api/pages/p2", { title: "Otra" });
  u.keep(JSON.stringify([page("p2", 95, "Otra"), page("p1", 120, "Hola mundo")]));
  u.answered(second, true);
  assert.deepEqual(listIn(dir), [page("p1", 120, "Hola mundo")]);
});

test("a list the page keeps after an answer it had not seen yet leaves that write out", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 200);
  u.answered(u.sending("PUT", "api/data/rows/r1", { values: {}, body: "Texto" }), true);
  u.keep(JSON.stringify([row("r1", 150, {}, "Texto")]));
  assert.equal(listIn(dir), null);
});

test("a server that could not be reached leaves the write kept", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 300);
  const t = u.sending("PUT", "api/pages/p1", { title: "Sin red" });
  u.keep(JSON.stringify([page("p1", 290, "Sin red")]));
  u.answered(t, false);
  assert.deepEqual(listIn(dir), [page("p1", 290, "Sin red")]);
});

test("the main window's list and the peek's are kept together, a write's later fields over its earlier ones", () => {
  const dir = folder();
  const u = createUnsent(dir, () => 500);
  u.keep(JSON.stringify([page("p1", 10, "Uno"), row("r1", 20, { a: "1" })]));
  u.keep(JSON.stringify([row("r1", 30, { b: "2" }, "Texto")]));
  // An older list of the main window does not take back the peek's later text.
  u.keep(JSON.stringify([page("p1", 10, "Uno"), row("r1", 20, { a: "1" })]));
  assert.deepEqual(listIn(dir), [
    page("p1", 10, "Uno"),
    row("r1", 30, { a: "1", b: "2" }, "Texto"),
  ]);
});

test("a request from another part of the app to the same note takes out only the fields it carried (task 106)", () => {
  const dir = folder();
  let clock = 400;
  const u = createUnsent(dir, () => clock);
  // The main window kept the note's text and a property, typed without the server.
  u.keep(JSON.stringify([row("r1", 390, { lugar: "Sala 2" }, "Escrito sin red")]));
  // The peek (or a task ticked) writes the same note: one property only.
  const peek = u.sending("PUT", "api/data/rows/r1", { values: { lugar: "Sala 3" } });
  clock = 410;
  u.answered(peek, true);
  assert.deepEqual(listIn(dir), [row("r1", 390, {}, "Escrito sin red")]);
  // The window going keeps its older list again: the answered property does not come back.
  u.keep(JSON.stringify([row("r1", 390, { lugar: "Sala 2" }, "Escrito sin red")]));
  assert.deepEqual(listIn(dir), [row("r1", 390, {}, "Escrito sin red")]);
  // A page moved in the sidebar (its parent, its place) takes nothing typed with it.
  u.keep(JSON.stringify([page("p1", 395, "Nombre sin red")]));
  u.answered(u.sending("PUT", "api/pages/p1", { parent: null, position: 2 }), true);
  assert.equal(listIn(dir).length, 2);
  // A request whose body cannot be read takes out nothing.
  u.answered(u.sending("PUT", "api/data/rows/r1"), true);
  assert.equal(listIn(dir).length, 2);
  // The note's whole write, sent again, answers for the rest.
  u.answered(u.sending("PUT", "api/data/rows/r1", { values: {}, body: "Escrito sin red" }), true);
  u.answered(u.sending("PUT", "api/pages/p1", { title: "Nombre sin red" }), true);
  assert.equal(listIn(dir), null);
});

test(`quitting waits for the answers in flight, ${QUIT_WAIT_MS} ms at most`, async () => {
  const u = createUnsent(folder());
  const start = Date.now();
  await u.settle();
  assert.ok(Date.now() - start < 50, "nothing in flight: no wait");
  const t = u.sending("PUT", "api/pages/p1");
  setTimeout(() => u.answered(t, true), 50);
  const a = Date.now();
  await u.settle();
  const took = Date.now() - a;
  assert.ok(took >= 40 && took < 500, `waited ${took} ms for the answer`);
  u.sending("PUT", "api/pages/p2");
  const b = Date.now();
  await u.settle(200);
  const bound = Date.now() - b;
  assert.ok(bound >= 190 && bound < 600, `an answer that never comes is waited ${bound} ms`);
});
