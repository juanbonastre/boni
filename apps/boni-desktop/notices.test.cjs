const test = require("node:test");
const assert = require("node:assert/strict");
const { noticeBody, noticeOf, createNotices } = require("./notices.cjs");

// Boni's notices on this computer (task 62, A-17): the agent's stream, and what a notification may say.

test("a notice's body is its text as plain text: cut at 500, markup shown as it is on Linux, never a link", () => {
  assert.equal(noticeBody("Resumen de hoy: 3 tareas", "linux"), "Resumen de hoy: 3 tareas");
  assert.equal(
    noticeBody('<b>Hoy</b> & <a href="https://example.com">esto</a>', "linux"),
    '&lt;b&gt;Hoy&lt;/b&gt; &amp; &lt;a href="https://example.com"&gt;esto&lt;/a&gt;',
  );
  // Elsewhere the system shows the body as text already.
  assert.equal(noticeBody("<b>Hoy</b>", "darwin"), "<b>Hoy</b>");
  assert.equal(noticeBody(`${"x".repeat(600)}`, "linux")?.length, 500);
  assert.equal(noticeBody("una\u0007 línea\notra", "linux"), "una línea\notra");
  assert.equal(noticeBody("   ", "linux"), null);
  assert.equal(noticeBody(42, "linux"), null);
});

test("only a «notify» event with a text is a notice", () => {
  assert.equal(
    noticeOf({ event: "notify", data: '{"text":"Sacar la basura","integrity":"user"}' }),
    "Sacar la basura",
  );
  assert.equal(noticeOf({ event: "proposals", data: '{"n":2}' }), null);
  assert.equal(noticeOf({ event: "notify", data: '{"text":""}' }), null);
  assert.equal(noticeOf({ event: "notify", data: "{no es json" }), null);
});

/** A response whose body sends `chunks` and then stays open until aborted. */
function streaming(chunks, signal) {
  const enc = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        signal.addEventListener("abort", () => c.error(new Error("aborted")));
      },
    }),
  };
}

test("the agent's stream gives each notice once, with the session's token, from the account's server", async () => {
  const seen = [];
  let asked = "";
  let auth = "";
  const notices = createNotices({
    fetch: async (url, init) => {
      asked = url;
      auth = init.headers.Authorization;
      return streaming(
        [
          ': connected\n\nevent: proposals\ndata: {"n":1}\n\nevent: notify\ndata: {"text":"Resumen',
          ' de hoy","integrity":"own"}\n\n',
        ],
        init.signal,
      );
    },
    target: () => ({ serverUrl: "https://boni.example", token: "tok" }),
    onNotice: (t) => seen.push(t),
  });
  notices.restart();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(asked, "https://boni.example/api/agent/events");
  assert.equal(auth, "Bearer tok");
  assert.deepEqual(seen, ["Resumen de hoy"]);
  notices.stop();
});

test("a session that ended waits for a new login; a server without the stream is asked again only much later", async () => {
  for (const status of [401, 404, 503]) {
    let calls = 0;
    const notices = createNotices({
      fetch: async () => {
        calls++;
        return { ok: false, status };
      },
      target: () => ({ serverUrl: "https://boni.example", token: "tok" }),
      onNotice: () => assert.fail("no notice"),
    });
    notices.restart();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 1, `status ${status}`);
    notices.stop();
  }
});

test("without a server or a token there is no connection", async () => {
  let calls = 0;
  const notices = createNotices({
    fetch: async () => {
      calls++;
      return { ok: false, status: 500 };
    },
    target: () => null,
    onNotice: () => {},
  });
  notices.restart();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 0);
  notices.stop();
});
