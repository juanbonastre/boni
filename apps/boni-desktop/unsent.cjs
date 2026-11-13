// What was typed and has not reached the server yet (task 100), kept in the store's `unsent.json`: the page writes
// it synchronously as its window goes, and this process, which sees every answer even after the window is gone,
// takes each write out once the server has answered it, so a later start never sends it again over a newer change.
// An answer takes out only the fields its request carried (task 106): a request from another part of the app to the
// same note (the peek, ticking a task) leaves what was typed and not sent with it.
const fs = require("node:fs");
const path = require("node:path");

const FILE = "unsent.json";
/** How long quitting waits at most for the answers of writes already sent (ms). */
const QUIT_WAIT_MS = 1000;

/** The paths whose writes the page keeps until they are answered: a page and a row. */
const KEPT = /^api\/(pages|data\/rows)\/[^/?]+$/;
const kept = (method, apiPath) => method === "PUT" && KEPT.test(apiPath);

const parse = (text) => {
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.filter((w) => w && typeof w.path === "string") : [];
  } catch {
    return [];
  }
};

/** The fields a kept write holds, by name: a page's `patch.<key>`, a row's `values.<key>` and its `body`. */
const fieldsOf = (w) => [
  ...Object.keys(w.patch && typeof w.patch === "object" ? w.patch : {}).map((k) => `patch.${k}`),
  ...Object.keys(w.values && typeof w.values === "object" ? w.values : {}).map(
    (k) => `values.${k}`,
  ),
  ...(w.body !== undefined ? ["body"] : []),
];

/** The fields a PUT to `apiPath` with `body` carries, named as `fieldsOf` names them (none for a body it cannot read). */
const carriedBy = (apiPath, body) => {
  if (!body || typeof body !== "object") return [];
  if (apiPath.startsWith("api/pages/")) return Object.keys(body).map((k) => `patch.${k}`);
  return fieldsOf({ values: body.values, body: body.body });
};

/** `w` without the fields `gone`; null when nothing of it is left. */
const without = (w, gone) => {
  if (!gone.length) return w;
  const out = { ...w };
  for (const f of gone) {
    if (f === "body") {
      delete out.body;
      continue;
    }
    const dot = f.indexOf(".");
    const part = f.slice(0, dot);
    out[part] = { ...out[part] };
    delete out[part][f.slice(dot + 1)];
  }
  return fieldsOf(out).length ? out : null;
};

/** `later` over `earlier`, one level down: a page's patch, a row's values (its body is the later one's if it has one). */
const joined = (earlier, later) => {
  const out = { ...earlier, ...later };
  for (const k of ["patch", "values"])
    if (earlier[k] && later[k] && typeof earlier[k] === "object" && typeof later[k] === "object")
      out[k] = { ...earlier[k], ...later[k] };
  return out;
};

/**
 * `dir`: the store's folder. `now`: the clock (tests). Every kept write the page asks for goes through `sending`;
 * its answer through `answered`. A list the page keeps (`keep`) leaves out what was answered meanwhile.
 */
function createUnsent(dir, now = Date.now) {
  const file = path.join(dir, FILE);
  /**
   * Each path's answers, field by field: the moment the last request carrying that field arrived here (what was
   * written of it before then is on the server).
   */
  const answers = new Map();
  let inFlight = 0;
  const idle = new Set();
  const read = () => {
    try {
      return parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  };
  const write = (list) => {
    if (!list.length) return fs.rmSync(file, { force: true });
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.${FILE}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, file);
  };
  /** What of `w` the server has not answered yet: null when all of it has. */
  const rest = (w) => {
    const got = answers.get(w.path);
    return got
      ? without(
          w,
          fieldsOf(w).filter((f) => got.get(f) >= w.at),
        )
      : w;
  };
  const left = (list) => list.map(rest).filter(Boolean);
  return {
    /**
     * A request is leaving: a ticket to give back with its answer, or null if it is not a kept write. `body`: what
     * it carries, so its answer takes out of the list those fields alone.
     */
    sending(method, apiPath, body) {
      if (!kept(method, apiPath)) return null;
      inFlight++;
      return { path: apiPath, at: now(), fields: carriedBy(apiPath, body) };
    },
    /** Its answer: `reached` when the server took it (any status below 500), false when it could not be reached or failed. */
    answered(ticket, reached) {
      if (!ticket) return;
      inFlight--;
      if (reached && ticket.fields.length) {
        const got = answers.get(ticket.path) ?? new Map();
        answers.set(ticket.path, got);
        for (const f of ticket.fields) got.set(f, Math.max(got.get(f) ?? 0, ticket.at));
        const list = read();
        const next = left(list);
        if (JSON.stringify(next) !== JSON.stringify(list)) write(next);
      }
      if (inFlight === 0) for (const f of idle) f();
    },
    /**
     * A window's list, kept with the other window's (the main one and the note's peek keep theirs apart): each page's
     * or row's write, the later one's fields over the earlier's, but for what was answered since it was written.
     */
    keep(text) {
      const list = read();
      for (const w of parse(text)) {
        const i = list.findIndex((x) => x.path === w.path);
        if (i < 0) list.push(w);
        else list[i] = w.at >= list[i].at ? joined(list[i], w) : joined(w, list[i]);
      }
      write(left(list));
    },
    /** Before quitting: the answers of writes in flight, `ms` at most. */
    settle(ms = QUIT_WAIT_MS) {
      if (inFlight === 0) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(t);
          idle.delete(done);
          resolve();
        };
        const t = setTimeout(done, ms);
        idle.add(done);
      });
    },
  };
}

module.exports = { createUnsent, FILE, QUIT_WAIT_MS };
