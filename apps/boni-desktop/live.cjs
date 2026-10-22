// The server's live changes (GET /api/v1/events, server-sent events), held by the main process for every window:
// one connection per app, whatever windows are open. Each `changed` event says what to load again (charts, widgets,
// data); after a reconnection everything is loaded once, since events may have been missed.

/** Splits SSE text into complete events; returns them and the unfinished rest. */
function parseSse(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

const OLD_SERVER_RETRY_MS = 10 * 60_000;

/** Wait before reconnecting: 2 s, 4 s, 8 s ... up to a minute. */
const backoff = (attempt) => Math.min(60_000, 2000 * 2 ** Math.min(attempt, 5));

/**
 * Keeps the stream open while `target()` gives a server and a token. `onChange(what)` for each change,
 * `onState(live)` when the connection comes and goes. `fetch` is Electron's `net.fetch` (injectable in tests).
 */
function createLive({ fetch, target, onChange, onState, log = () => {} }) {
  let controller = null;
  let timer = null;
  let attempt = 0;
  let live = false;
  let stopped = true;

  const setLive = (v) => {
    if (v !== live) {
      live = v;
      onState(v);
    }
  };

  async function connect() {
    timer = null;
    const t = target();
    if (stopped || !t) return;
    controller = new AbortController();
    try {
      const r = await fetch(new URL("api/v1/events", `${t.serverUrl}/`).href, {
        headers: { Authorization: `Bearer ${t.token}`, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (r.status === 401) {
        log("live: the session ended");
        setLive(false);
        onChange("session");
        return; // no retry until the settings change
      }
      if (r.status === 404) {
        // a server from before live changes: the pages reload every 15 minutes; ask again later
        setLive(false);
        log("live: this server has no live changes yet");
        onChange("unsupported");
        timer = setTimeout(connect, OLD_SERVER_RETRY_MS);
        return;
      }
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      attempt = 0;
      setLive(true);
      onChange("all"); // whatever happened while away
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSse(buffer);
        buffer = rest;
        for (const e of events) {
          if (e.event !== "changed") continue;
          try {
            const what = JSON.parse(e.data).what;
            if (typeof what === "string") onChange(what);
          } catch {
            // a malformed event: ignore it
          }
        }
      }
      throw new Error("closed");
    } catch (e) {
      if (stopped || controller?.signal.aborted) return;
      setLive(false);
      const wait = backoff(attempt++);
      log(`live: ${e.message}; again in ${Math.round(wait / 1000)} s`);
      timer = setTimeout(connect, wait);
    }
  }

  return {
    /** (Re)starts with the current target (after a login or a new server address). */
    restart() {
      this.stop();
      stopped = false;
      attempt = 0;
      void connect();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      controller?.abort();
      controller = null;
      setLive(false);
    },
    get live() {
      return live;
    },
  };
}

module.exports = { parseSse, backoff, createLive };
