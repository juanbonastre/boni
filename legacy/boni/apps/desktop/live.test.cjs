const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSse, backoff, createLive } = require("./live.cjs");

test("server-sent events are split into complete events; comments and the unfinished rest wait", () => {
  const { events, rest } = parseSse(
    ': connected\n\nevent: changed\ndata: {"what":"charts"}\n\nevent: changed\r\ndata: {"what":"da',
  );
  assert.deepEqual(events, [{ event: "changed", data: '{"what":"charts"}' }]);
  assert.equal(rest, 'event: changed\r\ndata: {"what":"da');
  assert.deepEqual(parseSse(`${rest}ta"}\r\n\r\n`).events, [
    { event: "changed", data: '{"what":"data"}' },
  ]);
});

test("reconnections wait longer each time, up to a minute", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 9].map(backoff),
    [2000, 4000, 8000, 16000, 32000, 60000, 60000],
  );
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

test("the stream reports what changed, everything once at (re)connection, and a session that ended", async () => {
  const seen = [];
  const states = [];
  let auth = "";
  const live = createLive({
    fetch: async (_url, init) => {
      auth = init.headers.Authorization;
      return streaming(
        [': connected\n\nevent: changed\ndata: {"what":"widgets"}\n\n'],
        init.signal,
      );
    },
    target: () => ({ serverUrl: "https://boni.example", token: "tok" }),
    onChange: (w) => seen.push(w),
    onState: (s) => states.push(s),
  });
  live.restart();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(auth, "Bearer tok");
  assert.deepEqual(seen, ["all", "widgets"]);
  assert.equal(live.live, true);
  live.stop();
  assert.deepEqual(states, [true, false]);

  const ended = [];
  const gone = createLive({
    fetch: async () => ({ ok: false, status: 401 }),
    target: () => ({ serverUrl: "https://boni.example", token: "old" }),
    onChange: (w) => ended.push(w),
    onState: () => {},
  });
  gone.restart();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ended, ["session"]);
  gone.stop();
});

test("without a server or a token there is no connection", async () => {
  let calls = 0;
  const live = createLive({
    fetch: async () => {
      calls++;
      return { ok: false, status: 500 };
    },
    target: () => null,
    onChange: () => {},
    onState: () => {},
  });
  live.restart();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 0);
  live.stop();
});

test("a server from before live changes (404) is asked again only much later", async () => {
  let calls = 0;
  const live = createLive({
    fetch: async () => {
      calls++;
      return { ok: false, status: 404 };
    },
    target: () => ({ serverUrl: "https://boni.example", token: "tok" }),
    onChange: () => {},
    onState: () => {},
  });
  live.restart();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls, 1);
  assert.equal(live.live, false);
  live.stop();
});
