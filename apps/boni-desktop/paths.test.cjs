const test = require("node:test");
const assert = require("node:assert/strict");
const { allowedPath, timeoutFor } = require("./paths.cjs");

test("the page reaches only Boni's APIs through the shell", () => {
  for (const p of [
    "api/v1/charts",
    "api/v1/charts/gasto/data?drill=comida",
    "api/agent/turn",
    "api/pages",
    "api/pages/e_01abc/restore",
    "api/pages-trash",
    "api/data/types/t_nota/rows",
    "api/mail/guide",
  ])
    assert.equal(allowedPath(p), true, p);
  for (const p of [
    "api/login",
    "api/v1/../admin",
    "https://evil.example/api/v1/x",
    "/api/v1/x",
    "api/export",
    "api/datax",
    "boni/index.html",
    42,
  ])
    assert.equal(allowedPath(p), false, String(p));
});

test("a turn of the conversation may take minutes; anything else is cut after 30 s", () => {
  for (const p of ["api/agent/turn", "api/agent/answer", "api/agent/confirm", "api/agent/decline"])
    assert.equal(timeoutFor(p), 180_000, p);
  for (const p of ["api/agent/proposals", "api/agent/turnx", "api/v1/charts", "api/agent/turn/x"])
    assert.equal(timeoutFor(p), 30_000, p);
});
