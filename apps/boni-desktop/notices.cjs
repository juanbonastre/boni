// Boni's notices on this computer (task 62): the agent's stream (GET /api/agent/events), held by the main process while
// Boni runs, with its window open or only in the tray; each "notify" event (the agent's notify, a flow's «Avisar»,
// the month's budget) becomes a system notification with its text as plain text.
const { parseSse, backoff } = require("./live.cjs");

/** As the server cuts a notice (packages/agent's notify). */
const MAX_TEXT = 500;
/** A server without the stream, or without a store: asked again after this long. */
const RETRY_MS = 10 * 60_000;

// Control characters other than tab and new line.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it takes away
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * A notice's text as a notification's body: plain text, cut as the server cuts it, or null when there is nothing to
 * say. On Linux the notification server may read markup in the body (GNOME does: bold, links), so &, < and > go as
 * entities and show as they are: never HTML, never a link (text from a model is painted as text).
 */
function noticeBody(text, platform = process.platform) {
  if (typeof text !== "string") return null;
  const plain = text.replace(CONTROL, "").trim().slice(0, MAX_TEXT);
  if (!plain) return null;
  if (platform !== "linux") return plain;
  return plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The text of a "notify" event, or null. */
function noticeOf(e) {
  if (e.event !== "notify") return null;
  try {
    const text = JSON.parse(e.data).text;
    return typeof text === "string" && text ? text : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the agent's stream open while `target()` gives a server and a token; `onNotice(text)` for each notice. A session
 * that ended waits for the next `restart` (a new login); a server without the stream is asked again in ten minutes;
 * anything else reconnects as the live changes do (live.cjs). `fetch` is Electron's `net.fetch` (injectable in tests).
 */
function createNotices({ fetch, target, onNotice, log = () => {} }) {
  let controller = null;
  let timer = null;
  let attempt = 0;
  let stopped = true;

  async function connect() {
    timer = null;
    const t = target();
    if (stopped || !t) return;
    controller = new AbortController();
    try {
      const r = await fetch(new URL("api/agent/events", `${t.serverUrl}/`).href, {
        headers: { Authorization: `Bearer ${t.token}`, Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (r.status === 401) {
        log("notices: the session ended");
        return;
      }
      if (r.status === 404 || r.status === 503) {
        log(`notices: the server has no stream for them (${r.status}); again in 10 min`);
        timer = setTimeout(connect, RETRY_MS);
        return;
      }
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      attempt = 0;
      log("notices: connected");
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
          const text = noticeOf(e);
          if (text) onNotice(text);
        }
      }
      throw new Error("closed");
    } catch (e) {
      if (stopped || controller?.signal.aborted) return;
      const wait = backoff(attempt++);
      log(`notices: ${e.message}; again in ${Math.round(wait / 1000)} s`);
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
    },
  };
}

module.exports = { noticeBody, noticeOf, createNotices, RETRY_MS };
