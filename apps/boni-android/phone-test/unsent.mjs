// The phone test of task 109 (D-65, D-68, D-70): on a real phone over adb, what is typed in Boni and left unsent
// survives the app hidden and killed, and the app sends it with the app closed. It runs «Boni prueba» (the debug
// build, beside the real app: its own id) against a real server on this laptop with invented data, reached through
// `adb reverse`; nothing of the real app or its account is touched, and everything it made is gone when it ends.
//
//   flock -w 3600 "$(git rev-parse --git-common-dir)/boni-phone.lock" node apps/boni-android/phone-test/unsent.mjs <boni-prueba.apk>
//
// With ONLY=2,6 it runs those scenarios alone, numbered in the order they are here.
//
// The APK is CI's `boni-android-test-apk` artifact of a branch (boni-android.yml). The phone must be unlocked, with
// the screen on. «No connection» is a door on this laptop that closes, so the phone's own network never changes. The page is
// read through the test copy's WebView devtools (only the test copy has them); every key goes with the test copy in
// front, checked first. It prints each scenario's result and the app's log lines with their times.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PKG = "io.github.juanbonastre.boni.prueba";
const REAL = "io.github.juanbonastre.boni";
const ACTIVITY = `${PKG}/io.github.juanbonastre.boni.MainActivity`;
const repo = resolve(import.meta.dirname, "../../..");
const apk = process.argv[2];
if (!apk) throw new Error("Usage: node apps/boni-android/phone-test/unsent.mjs <boni-prueba.apk>");
if (!PKG.endsWith(".prueba")) throw new Error("Only the test copy is ever installed or removed");
process.chdir(repo);

// ---------- the phone, one session at a time ----------
const lock = join(
  execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repo, encoding: "utf8" }).trim(),
  "boni-phone.lock",
);
// Free here means nobody holds it: this run is not under the lock the sessions share.
if (spawnSync("flock", ["-n", resolve(repo, lock), "true"]).status === 0)
  throw new Error(`Run it under the phone's lock: flock -w 3600 ${resolve(repo, lock)} node …`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", timeout: 60_000 });
const sh = (cmd) => adb("shell", cmd);
const now = () => new Date().toISOString().slice(11, 23);
const say = (...a) => console.log(now(), ...a);

const devices = adb("devices")
  .split("\n")
  .slice(1)
  .filter((l) => /\tdevice$/.test(l));
if (devices.length !== 1) throw new Error(`One phone, please (adb sees ${devices.length})`);
const user = sh("am get-current-user").trim();
const versionOf = (pkg) =>
  (sh(`dumpsys package ${pkg}`).match(/versionName=\S+|versionCode=\d+/g) ?? [])
    .slice(0, 2)
    .join(" ");
const realBefore = versionOf(REAL);
say(`phone user ${user}; Boni (the real app): ${realBefore || "not installed"}`);

/** Whether the screen is on and unlocked: with it off or locked no app is in front, and nothing can be typed. */
const screenOpen = () =>
  /mWakefulness=Awake/.test(sh("dumpsys power")) &&
  !/isKeyguardShowing=true/.test(sh("dumpsys window"));
const OPEN =
  "Unlock the phone and keep its screen on for the whole test (Juan sets how long it stays on)";
if (!screenOpen()) throw new Error(`The screen is off or locked. ${OPEN}`);

/** The test copy is the app in front: every key and tap waits for that. */
const front = () => sh("dumpsys activity activities").match(/topResumedActivity[^\n]*/)?.[0] ?? "";
function mustFront() {
  const f = front();
  if (f.includes(`${PKG}/`)) return;
  if (!screenOpen()) throw new Error(`The screen went off or locked. ${OPEN}`);
  throw new Error(`The test copy is not in front (${f.trim() || "nothing"})`);
}
const pid = () => sh(`pidof ${PKG} || true`).trim();

/** Typed as a person does, a key at a time (ASCII: `input text` takes no accents); `before` runs before each key. */
async function type(text, before) {
  for (const c of text) {
    mustFront();
    if (before) await before();
    sh(c === " " ? "input keyevent KEYCODE_SPACE" : `input text ${c}`);
    await sleep(60);
  }
}

/**
 * Home, then the app killed the moment the system lets it (`am kill` takes only an app in the background): the
 * worst a phone does, right after onStop. Returns when it died, in the phone's clock (epoch s), or null.
 */
function homeAndKill(lastKeys = "") {
  mustFront();
  const typed = lastKeys ? `input text ${lastKeys} && ` : "";
  const out = sh(
    `${typed}input keyevent KEYCODE_HOME && for i in $(seq 1 400); do am kill --user ${user} ${PKG}; ` +
      `pidof ${PKG} >/dev/null || { echo killed; date +%s; break; }; sleep 0.01; done`,
  ).trim();
  return out.startsWith("killed") ? out.split("\n")[1] : null;
}

// ---------- a real server, invented data ----------
const dir = mkdtempSync(join(tmpdir(), "boni-phone-"));
const password = randomBytes(18).toString("base64url");
const NOTE = "notas/Prueba del telefono.md";
const { seedAccount } = await import(join(repo, "e2e/server-data.ts"));
const ids = seedAccount(dir, "ejemplo", password, [{ key: "nota", name: "Nota", folder: "" }], {
  [NOTE]: "---\nlugar: Sala de ejemplo\n---\n\n# Prueba del telefono\n\nTexto inicial.\n",
});
const noteId = ids.get(NOTE);
const freePort = () =>
  new Promise((done) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => done(p));
    });
  });
/** The server's own port, and the door's (what the phone reaches through `adb reverse`). */
const serverPort = await freePort();
const port = await freePort();
const url = `http://localhost:${port}`;
const server = spawn(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"],
  {
    cwd: repo,
    env: {
      ...process.env,
      BONI_DB: join(dir, "db.sqlite"),
      BONI_PORT: String(serverPort),
      BONI_HOST: "127.0.0.1",
      BONI_WRITE: "1",
      // No model is ever called: one would fail at once.
      ANTHROPIC_API_KEY: "clave-inventada",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
await new Promise((done, fail) => {
  server.stdout.on("data", (d) => String(d).includes("boni-calendar-server on") && done());
  server.on("exit", (c) => fail(new Error(`server exited ${c}`)));
});

/** Another device of the same account: the laptop, through the same server. */
let token = "";
async function api(method, path, body) {
  const r = await fetch(`http://127.0.0.1:${serverPort}/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
token = (
  await api("POST", "api/v1/login", { user: "ejemplo", password, device: "portatil de prueba" })
).token;
const bodyOnServer = async () => (await api("GET", `api/data/rows/${noteId}`)).row.body ?? "";
const pagesOnServer = async () => (await api("GET", "api/pages")).pages ?? [];

// ---------- the test copy's page, read through its devtools ----------
const forwards = [];
let cdp = null;
async function attach() {
  cdp?.close();
  const p = await until("the test copy running", async () => pid() || null, 20_000);
  const local = adb("forward", "tcp:0", `localabstract:webview_devtools_remote_${p}`).trim();
  forwards.push(local);
  const targets = await until(
    "its page",
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${local}/json/list`)).json();
      return list.find((t) => t.type === "page") ?? null;
    },
    20_000,
  );
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.onopen = done;
    ws.onerror = fail;
  });
  let n = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    waiting.get(d.id)?.(d);
    waiting.delete(d.id);
  };
  cdp = {
    async eval(expression) {
      const id = ++n;
      const d = await new Promise((done) => {
        waiting.set(id, done);
        ws.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
      if (d.result?.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails));
      return d.result?.result?.value;
    },
    close() {
      ws.close();
    },
  };
}

async function until(what, fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // not yet
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(500);
  }
}

/** The note's text on the phone's screen: its lines (the editor's blocks, as e2e-boni/mobile.spec.ts reads them). */
const shownBody = () =>
  cdp.eval(`(() => {
    const lines = [...document.querySelectorAll(".row-doc .blk-input")];
    return lines.length ? lines.map((l) => l.textContent).join("\\n") : null;
  })()`);
/** What the test copy shows, to say so when something is not there. */
const onScreen = () =>
  cdp
    .eval(`location.href + " | " + (document.body?.innerText ?? "").slice(0, 300)`)
    .catch(() => "?");

/** What has the focus on the page, to say so when the keys went nowhere. */
const focusOf = () =>
  cdp
    .eval(`(() => {
      const a = document.activeElement;
      return (a ? a.tagName + "." + a.className : "nothing") + (document.querySelector(".modal") ? ", a window open" : "");
    })()`)
    .catch(() => "?");
/** Whether the note's editor has the focus, where the keys go. */
const inNote = () =>
  cdp.eval(`(() => {
    const a = document.activeElement;
    return !!a && (!!a.closest(".row-doc") || a.contains(document.querySelector(".row-doc .blk-input")));
  })()`);
/**
 * Typed at the end of the note, and on its screen before going on: keys that went nowhere fail here, not later. A key
 * goes to what has the focus, and in run 11 the note's back button had it twice (a space there is a tap): the caret
 * goes back to the note's end before any key that would land elsewhere, and the log says so.
 */
async function typeInNote(text, shows) {
  await until(
    "the caret in the note",
    async () => (await caretAtEnd()) && (await inNote()),
    10_000,
  );
  await type(text, async () => {
    if (await inNote()) return;
    say(`while typing, the focus was on ${await focusOf()}: back to the note's end`);
    await caretAtEnd();
  });
  await until(
    "the typed text on the screen",
    async () => shows.test(await shownBody()),
    10_000,
  ).catch(async (e) => {
    throw new Error(
      `${e.message}; the screen shows ${JSON.stringify(await shownBody())}, the focus on ${await focusOf()}`,
    );
  });
}

/** The caret at the end of the note's text (a tap on it, as the page takes it). */
const caretAtEnd = () =>
  cdp.eval(`(() => {
    const lines = document.querySelectorAll(".row-doc .blk-input");
    if (!lines.length) return false;
    const last = lines[lines.length - 1];
    const ed = last.closest('[contenteditable="true"]') ?? last;
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(last);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return true;
  })()`);

function openNote() {
  // Not in front, its task would only come back with the intent it started with, not the link's, also with its
  // process alive for the worker (run 15 came back to «Inicio»): a fresh task then, as opening it from the home
  // screen is. In front, the link goes to it.
  const fresh = front().includes(`${PKG}/`) ? "" : "-f 0x10008000 "; // FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK
  sh(
    `am start --user ${user} ${fresh}-n ${ACTIVITY} -a android.intent.action.VIEW -d 'boni://note?id=${noteId}'`,
  );
}
/**
 * Why no job is left: the test copy's WorkManager rows (copied out of its own files with `run-as`, read here) and the
 * system's jobs for it (filtered on the phone, never another app's). State: 0 enqueued, 1 running, 2 succeeded,
 * 3 failed, 4 blocked, 5 cancelled.
 */
function whyNoJob() {
  const out = join(dir, `work-${Date.now()}`);
  mkdirSync(out);
  for (const f of [
    "androidx.work.workdb",
    "androidx.work.workdb-wal",
    "androidx.work.workdb-shm",
  ]) {
    const r = spawnSync("adb", [
      "exec-out",
      "run-as",
      PKG,
      "--user",
      user,
      "cat",
      `databases/${f}`,
    ]);
    if (r.status === 0 && r.stdout.length) writeFileSync(join(out, f), r.stdout);
  }
  let rows;
  try {
    const db = new DatabaseSync(join(out, "androidx.work.workdb"), { readOnly: true });
    rows = db
      .prepare(
        `select n.name, w.state, w.initial_delay, w.run_attempt_count, w.last_enqueue_time, w.schedule_requested_at,
           s.system_id, w.worker_class_name from WorkSpec w left join WorkName n on n.work_spec_id = w.id
           left join SystemIdInfo s on s.work_spec_id = w.id order by w.last_enqueue_time`,
      )
      .all()
      .map((r) => ({ ...r, worker_class_name: String(r.worker_class_name).split(".").pop() }));
    db.close();
  } catch (e) {
    rows = `(no rows: ${e.message})`;
  }
  const jobs = sh(`dumpsys jobscheduler | grep -A2 'JOB #.*${PKG}/' || true`).trim();
  return `WorkManager ${JSON.stringify(rows)}; the system's jobs ${JSON.stringify(jobs)}`;
}
/** How many jobs the system holds for the test copy (WorkManager's): filtered on the phone, never another app's. */
const jobsOnPhone = () => sh(`dumpsys jobscheduler | grep -c 'JOB #.*${PKG}/' || true`).trim();
/**
 * After a kill: what the phone kept and the jobs that will send it, said in the log; kept with no job, nothing would
 * send it until the app is opened again (the app's job was taken out as it hid: run 11), so it fails at once.
 */
async function afterKill(died) {
  const kept = keptOnPhone();
  const jobs = jobsOnPhone();
  say(
    `killed at ${died}; kept ${kept}; jobs ${jobs}; the server ${JSON.stringify(await bodyOnServer())}`,
  );
  if (kept !== "none" && jobs === "0")
    throw new Error("kept on the phone, and no job left to send it");
}
/** The server's note to have `shows`, or a failure saying what it has. */
const serverShows = (shows, ms) =>
  until("the server to have it", async () => shows.test(await bodyOnServer()), ms).catch(
    async (e) => {
      throw new Error(
        `${e.message}; the server has ${JSON.stringify(await bodyOnServer())}, the phone kept ${keptOnPhone()}, jobs ${jobsOnPhone()}`,
      );
    },
  );

/** The test copy's kept list on the phone (a debug build: `run-as` reads its files). */
const keptOnPhone = () =>
  sh(`run-as ${PKG} --user ${user} cat files/store/unsent.json 2>/dev/null || echo none`).trim();

/**
 * «No connection» is a door between the phone's tunnel and the server that closes, cutting what is open: an
 * `adb reverse` taken away leaves the open connections working, and the app reuses them (its first run did so).
 */
let up = true;
const open = new Set();
const door = createServer((c) => {
  if (!up) return c.destroy();
  const s = connect(serverPort, "127.0.0.1");
  open.add(c);
  open.add(s);
  const end = () => {
    c.destroy();
    s.destroy();
    open.delete(c);
    open.delete(s);
  };
  for (const x of [c, s]) {
    x.on("error", end);
    x.on("close", end);
  }
  c.pipe(s);
  s.pipe(c);
});
await new Promise((done) => door.listen(port, "127.0.0.1", done));
const offline = () => {
  up = false;
  for (const x of open) x.destroy();
  open.clear();
};
const online = () => {
  up = true;
};

/** The test copy's own log lines since `since` (only its uid: never another app's). */
let uid = "";
function logSince(since) {
  try {
    // The app's own lines and WorkManager's (WM-…), of the test copy only (its uid).
    return adb("logcat", "-d", "-v", "epoch", "-T", since, `--uid=${uid}`, "*:I")
      .split("\n")
      .filter((l) => / (Boni|WM-[\w$]+) *:/.test(l))
      .map((l) => l.trim());
  } catch (e) {
    return [`(no log: ${e.message.split("\n")[0]})`];
  }
}
const phoneClock = () => `${sh("date +%s").trim()}.000`;

const results = [];
// ONLY=2,6 runs those scenarios alone (by their order here), to try a fix again without the whole run.
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",").map(Number)) : null;
let order = 0;
async function scenario(name, run) {
  order++;
  if (only && !only.has(order)) return;
  const since = phoneClock();
  say(`— ${name}`);
  try {
    const note = await run();
    results.push(`PASS ${name}${note ? `: ${note}` : ""}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
  for (const l of logSince(since)) console.log("   ", l);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => {
    results.push(`FAIL stopped (${signal})`);
    cleanUp();
    process.exit(1);
  });

try {
  // ---------- the test copy, beside the real app ----------
  let out = spawnSync("adb", ["install", "--user", user, "-r", apk], { encoding: "utf8" });
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(out.stdout + out.stderr)) {
    // An earlier test copy signed by another CI runner's key: only it goes.
    sh(`pm uninstall ${PKG}`);
    out = spawnSync("adb", ["install", "--user", user, "-r", apk], { encoding: "utf8" });
  }
  if (out.status !== 0) throw new Error(`install: ${out.stdout}${out.stderr}`);
  uid = sh(`cmd package list packages -U --user ${user} ${PKG}`).match(/uid:(\d+)/)?.[1] ?? "";
  if (!uid) throw new Error("the test copy is not installed");
  say(`the test copy: ${versionOf(PKG)} (${apk})`);
  if (!/android\.permission\.INTERNET: granted=true/.test(sh(`dumpsys package ${PKG}`)))
    throw new Error(
      "The test copy has no network permission: Juan grants it in its app info, then run again",
    );
  adb("reverse", `tcp:${port}`, `tcp:${port}`);
  online();
  sh(`am start --user ${user} -n ${ACTIVITY}`);
  await sleep(1500);
  await attach();
  mustFront();
  // Log in, as the first start asks (the form of «Configurar servidor»), once the page has drawn it.
  const setUp = `[...document.querySelectorAll("button")].some((x) => /Configurar servidor|Set up server/.test(x.textContent))`;
  await until("the first start's «Configurar servidor»", () => cdp.eval(setUp), 30_000).catch(
    async (e) => {
      const shown = await cdp
        .eval(`location.href + " | " + (document.body?.innerText ?? "").slice(0, 300)`)
        .catch(() => "?");
      throw new Error(`${e.message}; the test copy shows: ${JSON.stringify(shown)}`);
    },
  );
  await cdp.eval(`(async () => {
    const b = [...document.querySelectorAll("button")].find((x) => /Configurar servidor|Set up server/.test(x.textContent));
    b.click();
    await new Promise((r) => setTimeout(r, 500));
    const inputs = document.querySelectorAll(".modal .server-form input");
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(inputs[0], ${JSON.stringify(url)});
    set(inputs[1], "ejemplo");
    set(inputs[2], ${JSON.stringify(password)});
    document.querySelector(".modal .server-form button[type=submit]").click();
  })()`);
  await until(
    "the login",
    () => cdp.eval(`!!document.querySelector(".modal")?.textContent.includes("ejemplo")`),
    20_000,
  );
  say("logged in to the test server");
  // The settings window stays open after the login: Back closes it, as a person does (a note opened under it takes
  // no keys).
  for (let i = 0; i < 5 && (await cdp.eval(`!!document.querySelector(".modal")`)); i++) {
    mustFront();
    sh("input keyevent KEYCODE_BACK");
    await sleep(700);
  }
  if (await cdp.eval(`!!document.querySelector(".modal")`))
    throw new Error("the settings window did not close");

  const ready = async () => {
    await sleep(1500);
    await attach();
    mustFront();
    await until("the note on the screen", async () => (await shownBody()) !== null, 20_000).catch(
      async (e) => {
        throw new Error(`${e.message}; the test copy shows: ${JSON.stringify(await onScreen())}`);
      },
    );
  };

  await scenario(
    "typed with no connection, hidden and killed at once, opened again: nothing lost",
    async () => {
      online();
      openNote();
      await ready();
      offline();
      await typeInNote(" uno", /uno/i);
      await sleep(4000); // its save failed: kept on the device
      say(`before Home: the screen ${JSON.stringify(await shownBody())}; kept ${keptOnPhone()}`);
      const died = homeAndKill("dos"); // the last keys, then Home: only the hide notice keeps them
      if (!died) throw new Error("the system did not let the app be killed");
      const kept = keptOnPhone();
      const before = await bodyOnServer();
      say(
        `killed at ${died}; kept ${kept}; jobs ${jobsOnPhone()}; the server ${JSON.stringify(before)}`,
      );
      if (/uno\s*dos/i.test(before))
        throw new Error("the server had it before the network was back");
      if (!/uno\s*dos/i.test(kept)) throw new Error("the last keys were not kept on the phone");
      // Opened again with the network back: a note opens from the server (offline the app says so instead).
      online();
      openNote();
      await ready();
      await until(
        "the screen to show it",
        async () => /uno\s*dos/i.test(await shownBody()),
        30_000,
      ).catch(async (e) => {
        throw new Error(`${e.message}; the screen shows ${JSON.stringify(await shownBody())}`);
      });
      await serverShows(/uno\s*dos/i, 120_000);
      return "kept on the phone through the kill; on the screen and on the server once opened with the network back";
    },
  );

  await scenario(
    "typed with no connection, hidden and killed, never opened again: the app sends it",
    async () => {
      online();
      openNote();
      await ready();
      offline();
      await typeInNote(" tres", /tres/i);
      await sleep(4000);
      const died = homeAndKill();
      if (!died) throw new Error("the system did not let the app be killed");
      await afterKill(died);
      online();
      const t0 = Date.now();
      let opened = false;
      await until(
        "the server to have it",
        async () => {
          if (front().includes(`${PKG}/`)) opened = true;
          return /tres/i.test(await bodyOnServer());
        },
        8 * 60_000,
      ).catch(async (e) => {
        throw new Error(
          `${e.message}; the server has ${JSON.stringify(await bodyOnServer())}, the phone kept ${keptOnPhone()}, jobs ${jobsOnPhone()}`,
        );
      });
      if (opened) throw new Error("the test copy came to the front");
      return `on the server ${Math.round((Date.now() - t0) / 1000)} s after the network came back, the app closed`;
    },
  );

  await scenario(
    "hidden, sent by the app meanwhile, changed on another device: back, it is not written over",
    async () => {
      online();
      openNote();
      await ready();
      offline();
      await typeInNote(" cuatro", /cuatro/i);
      await sleep(4000);
      mustFront();
      sh("input keyevent KEYCODE_HOME");
      online();
      await serverShows(/cuatro/i, 8 * 60_000);
      if (!pid()) return "inconclusive: the system ended the app meanwhile";
      const other = "Cambiado en otro equipo.";
      await api("PUT", `api/data/rows/${noteId}`, { values: {}, body: other });
      sh(`am start --user ${user} -n ${ACTIVITY}`);
      await sleep(75_000); // a minute's resend
      const body = await bodyOnServer();
      if (body !== other) throw new Error(`the server has ${JSON.stringify(body)}`);
      return "the other device's text stays";
    },
  );

  await scenario("typed with a connection, hidden and killed at once: on the server", async () => {
    online();
    openNote();
    await ready();
    await typeInNote(" cinco", /cinco/i);
    const died = homeAndKill("seis");
    if (!died) throw new Error("the system did not let the app be killed");
    await afterKill(died);
    // At the kill it is on the server or kept on the phone; kept, the app sends it, closed.
    if (!/cinco\s*seis/i.test(`${await bodyOnServer()} ${keptOnPhone()}`))
      throw new Error("lost: neither on the server nor kept on the phone");
    await serverShows(/cinco\s*seis/i, 8 * 60_000);
    return "";
  });

  await scenario(
    "the race, again and again: typed, hidden and killed at once, with and without a connection: each time on the server or kept",
    async () => {
      const lost = [];
      const times = [];
      const noJob = [];
      for (let i = 1; i <= 8; i++) {
        const roundStart = phoneClock();
        online();
        openNote();
        await ready();
        if (i % 2) offline();
        await typeInNote(` w${i}a`, new RegExp(`w${i}a`, "i"));
        const died = homeAndKill(`w${i}b`);
        if (!died) throw new Error(`round ${i}: the system did not let the app be killed`);
        const shows = new RegExp(`w${i}a\\s*w${i}b`, "i");
        const kept = keptOnPhone();
        const server = await bodyOnServer();
        const where = shows.test(server) ? "the server" : shows.test(kept) ? "kept" : "LOST";
        const jobs = jobsOnPhone();
        say(`round ${i} (${i % 2 ? "no connection" : "a connection"}): ${where}; jobs ${jobs}`);
        // Kept with no job, nothing sends it until the app is opened again (round 1 of run 14): why, said at once,
        // before the phone's log turns over.
        if (where === "kept" && jobs === "0") {
          noJob.push(i);
          say(`round ${i}: ${whyNoJob()}`);
          for (const l of logSince(roundStart)) console.log("   ", l);
        }
        if (where === "LOST")
          lost.push(`round ${i}: the server ${JSON.stringify(server)}, kept ${kept}`);
        online();
        // The next round starts from it: sent by the app (closed) or as it opens again.
        const t0 = Date.now();
        await serverShows(shows, 3 * 60_000).catch(() => undefined);
        times.push(Math.round((Date.now() - t0) / 1000));
      }
      if (lost.length) throw new Error(lost.join("; "));
      if (noJob.length)
        throw new Error(`kept with no job left to send it in round ${noJob.join(", ")}`);
      return `8 of 8, on the server in ${times.join(", ")} s after each kill`;
    },
  );

  await scenario(
    "a new page with no connection, named, killed, never opened again: made once",
    async () => {
      online();
      sh(`am start --user ${user} -n ${ACTIVITY}`);
      await sleep(1500);
      await attach();
      mustFront();
      // Its home, where the create button is. The task comes back with the note it was opened with, which hides the
      // tabs: Back closes it, as a person does, then the «Inicio» tab.
      for (let i = 0; i < 3 && !(await cdp.eval(`!!document.querySelector(".m-tabs")`)); i++) {
        mustFront();
        sh("input keyevent KEYCODE_BACK");
        await sleep(700);
      }
      await cdp.eval(
        `[...document.querySelectorAll(".m-tabs .m-tab-label")].find((l) => /^(Inicio|Home)$/.test(l.textContent.trim()))?.closest("button, a")?.click()`,
      );
      await sleep(700);
      offline();
      await until(
        "the create button",
        () => cdp.eval(`!!document.querySelector(".m-fab")`),
        20_000,
      ).catch(async (e) => {
        throw new Error(`${e.message}; the test copy shows: ${JSON.stringify(await onScreen())}`);
      });
      await cdp.eval(`(async () => {
      document.querySelector(".m-fab").click();
      await new Promise((r) => setTimeout(r, 500));
      [...document.querySelectorAll(".m-item-main")].find((b) => /^(Página|Page)$/.test(b.textContent.trim())).click();
    })()`);
      await sleep(1500);
      await type("Pagina de prueba");
      // The phone's keyboard may change what is typed (it wrote «Uno» for «uno» after a full stop), so the name is
      // read back as the screen shows it, compared without accents or capitals, and looked for on the server as that.
      const shownName = () =>
        cdp.eval(`(() => {
          const plain = (t) => t.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
          const el = [...document.querySelectorAll("input, textarea, [contenteditable]")].find((e) =>
            plain(e.value ?? e.textContent ?? "").includes("pagina de prueba"),
          );
          return el ? (el.value ?? el.textContent).trim() : null;
        })()`);
      const name = await until("its name on the screen", shownName, 10_000).catch(async (e) => {
        const value = await cdp.eval(`document.activeElement?.value ?? null`).catch(() => "?");
        throw new Error(
          `${e.message}; the focus on ${await focusOf()}, which has ${JSON.stringify(value)}`,
        );
      });
      say(`named ${JSON.stringify(name)}`);
      await sleep(3000);
      const died = homeAndKill();
      if (!died) throw new Error("the system did not let the app be killed");
      await afterKill(died);
      online();
      await until(
        "the page on the server",
        async () => (await pagesOnServer()).some((p) => p.title === name),
        8 * 60_000,
      ).catch(async (e) => {
        const titles = (await pagesOnServer()).map((p) => p.title);
        throw new Error(
          `${e.message}; the server has ${JSON.stringify(titles)}, the phone kept ${keptOnPhone()}, jobs ${jobsOnPhone()}`,
        );
      });
      await sleep(60_000); // a late resend would make a second one now
      const n = (await pagesOnServer()).filter((p) => p.title === name).length;
      if (n !== 1) throw new Error(`${n} pages`);
      return "one page, with its name";
    },
  );
} catch (e) {
  results.push(`FAIL before the scenarios ended: ${e.message}`);
} finally {
  cleanUp();
}
process.exit(
  results.every((r) => r.startsWith("PASS")) && results.length === (only?.size ?? 6) ? 0 : 1,
);

/** Everything the run made goes, also when it is stopped (Ctrl-C, a kill): the phone and this laptop as they were. */
function cleanUp() {
  if (cleanUp.done) return;
  cleanUp.done = true;
  // Each step on its own: a phone gone from adb must not leave the server running or hide the first error.
  const safely = (what, fn) => {
    try {
      return fn();
    } catch (e) {
      say(`cleanup: ${what} failed (${e.message.split("\n")[0]})`);
      return undefined;
    }
  };
  safely("devtools", () => cdp?.close());
  safely("the door", () => {
    offline();
    door.close();
  });
  safely("the server", () => server.kill());
  safely("its data", () => rmSync(dir, { recursive: true, force: true }));
  for (const f of forwards) spawnSync("adb", ["forward", "--remove", `tcp:${f}`]);
  spawnSync("adb", ["reverse", "--remove", `tcp:${port}`]);
  safely("leaving the test copy", () => {
    if (front().includes(`${PKG}/`)) sh("input keyevent KEYCODE_HOME");
  });
  const gone = spawnSync("adb", ["shell", `pm uninstall ${PKG}`], { encoding: "utf8" });
  if (/no devices|device offline|not found/.test(gone.stderr ?? ""))
    say(
      `cleanup: the phone is not on adb; remove the test copy once it is: adb shell pm uninstall ${PKG}`,
    );
  const realAfter = safely("the real app's version", () => versionOf(REAL)) ?? "unknown";
  say(
    `Boni (the real app): ${realAfter}${realAfter === realBefore ? ", as it was" : `, WAS ${realBefore}`}`,
  );
  console.log(results.join("\n"));
}
