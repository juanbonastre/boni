// The phone test of task 109 (D-65, D-68, D-70): on a real phone over adb, what is typed in Boni and left unsent
// survives the app hidden and killed, and the app sends it with the app closed. It runs «Boni prueba» (the debug
// build, beside the real app: its own id) against a real server on this laptop with invented data, reached through
// `adb reverse`; nothing of the real app or its account is touched, and everything it made is gone when it ends.
//
//   flock -w 3600 "$(git rev-parse --git-common-dir)/boni-phone.lock" node apps/boni-android/phone-test/unsent.mjs <boni-prueba.apk>
//
// The APK is CI's `boni-android-test-apk` artifact of a branch (boni-android.yml). The phone must be unlocked, with
// the screen on. «No connection» is the reverse taken away, so the phone's own network never changes. The page is
// read through the test copy's WebView devtools (only the test copy has them); every key goes with the test copy in
// front, checked first. It prints each scenario's result and the app's log lines with their times.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

/** The test copy is the app in front: every key and tap waits for that. */
const front = () => sh("dumpsys activity activities").match(/topResumedActivity[^\n]*/)?.[0] ?? "";
function mustFront() {
  const f = front();
  if (!f.includes(`${PKG}/`))
    throw new Error(`The test copy is not in front (${f.trim() || "nothing"})`);
}
const pid = () => sh(`pidof ${PKG} || true`).trim();

/** Typed as a person does, a key at a time (ASCII: `input text` takes no accents). */
async function type(text) {
  for (const c of text) {
    mustFront();
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
const port = await new Promise((done) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => done(p));
  });
});
const url = `http://localhost:${port}`;
const server = spawn(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"],
  {
    cwd: repo,
    env: {
      ...process.env,
      BONI_DB: join(dir, "db.sqlite"),
      BONI_PORT: String(port),
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
  const r = await fetch(`http://127.0.0.1:${port}/${path}`, {
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

/** The note's text on the phone's screen. */
const shownBody = () =>
  cdp.eval(`(() => {
    const ed = document.querySelector('.m-row [contenteditable="true"]');
    return ed ? ed.innerText : null;
  })()`);

/** The caret at the end of the note's text (a tap on it, as the page takes it). */
const caretAtEnd = () =>
  cdp.eval(`(() => {
    const ed = document.querySelector('.m-row [contenteditable="true"]');
    if (!ed) return false;
    const blocks = ed.querySelectorAll('.blk-input');
    const last = blocks.length ? blocks[blocks.length - 1] : ed;
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
  sh(
    `am start --user ${user} -n ${ACTIVITY} -a android.intent.action.VIEW -d 'boni://note?id=${noteId}'`,
  );
}

const offline = () => adb("reverse", "--remove", `tcp:${port}`);
const online = () => adb("reverse", `tcp:${port}`, `tcp:${port}`);

/** The test copy's own log lines since `since` (only its uid: never another app's). */
let uid = "";
function logSince(since) {
  try {
    return adb("logcat", "-d", "-v", "epoch", "-T", since, `--uid=${uid}`, "Boni:I", "*:S")
      .split("\n")
      .filter((l) => l.includes(" Boni"))
      .map((l) => l.trim());
  } catch (e) {
    return [`(no log: ${e.message.split("\n")[0]})`];
  }
}
const phoneClock = () => `${sh("date +%s").trim()}.000`;

const results = [];
async function scenario(name, run) {
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
  if (!/android\.permission\.INTERNET: granted=true/.test(sh(`dumpsys package ${PKG}`)))
    throw new Error(
      "The test copy has no network permission: Juan grants it in its app info, then run again",
    );
  online();
  sh(`am start --user ${user} -n ${ACTIVITY}`);
  await sleep(1500);
  await attach();
  mustFront();
  // Log in, as the first start asks (the form of «Configurar servidor»).
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

  const ready = async () => {
    await sleep(1500);
    await attach();
    mustFront();
    await until("the note on the screen", async () => (await shownBody()) !== null, 20_000);
  };

  await scenario(
    "typed with no connection, hidden and killed at once, opened again: nothing lost",
    async () => {
      openNote();
      await ready();
      offline();
      await caretAtEnd();
      await type(" uno");
      await sleep(4000); // its save failed: kept on the device
      const died = homeAndKill("dos"); // the last keys, then Home: only the hide notice keeps them
      if (!died) throw new Error("the system did not let the app be killed");
      say(`killed at ${died}`);
      openNote();
      await ready();
      const shown = await shownBody();
      if (!/uno\s*dos/.test(shown)) throw new Error(`the screen shows ${JSON.stringify(shown)}`);
      online();
      await until(
        "the server to have it",
        async () => /uno\s*dos/.test(await bodyOnServer()),
        120_000,
      );
      return "on the screen offline, and on the server once the network was back";
    },
  );

  await scenario(
    "typed with no connection, hidden and killed, never opened again: the app sends it",
    async () => {
      openNote();
      await ready();
      offline();
      await caretAtEnd();
      await type(" tres");
      await sleep(4000);
      const died = homeAndKill();
      say(`killed at ${died}`);
      online();
      const t0 = Date.now();
      let opened = false;
      await until(
        "the server to have it",
        async () => {
          if (front().includes(`${PKG}/`)) opened = true;
          return /tres/.test(await bodyOnServer());
        },
        8 * 60_000,
      );
      if (opened) throw new Error("the test copy came to the front");
      return `on the server ${Math.round((Date.now() - t0) / 1000)} s after the network came back, the app closed`;
    },
  );

  await scenario(
    "hidden, sent by the app meanwhile, changed on another device: back, it is not written over",
    async () => {
      openNote();
      await ready();
      offline();
      await caretAtEnd();
      await type(" cuatro");
      await sleep(4000);
      mustFront();
      sh("input keyevent KEYCODE_HOME");
      online();
      await until(
        "the server to have it",
        async () => /cuatro/.test(await bodyOnServer()),
        8 * 60_000,
      );
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
    openNote();
    await ready();
    await caretAtEnd();
    await type(" cinco");
    homeAndKill("seis");
    await until(
      "the server to have it",
      async () => /cinco\s*seis/.test(await bodyOnServer()),
      8 * 60_000,
    );
    return "";
  });

  await scenario(
    "a new page with no connection, named, killed, never opened again: made once",
    async () => {
      sh(`am start --user ${user} -n ${ACTIVITY}`);
      await sleep(1500);
      await attach();
      mustFront();
      offline();
      await until(
        "the create button",
        () => cdp.eval(`!!document.querySelector(".m-fab")`),
        20_000,
      );
      await cdp.eval(`(async () => {
      document.querySelector(".m-fab").click();
      await new Promise((r) => setTimeout(r, 500));
      [...document.querySelectorAll(".m-item-main")].find((b) => /^(Página|Page)$/.test(b.textContent.trim())).click();
    })()`);
      await sleep(1500);
      await type("Pagina de prueba");
      await sleep(3000);
      homeAndKill();
      online();
      await until(
        "the page on the server",
        async () => (await pagesOnServer()).some((p) => p.title === "Pagina de prueba"),
        8 * 60_000,
      );
      await sleep(60_000); // a late resend would make a second one now
      const n = (await pagesOnServer()).filter((p) => p.title === "Pagina de prueba").length;
      if (n !== 1) throw new Error(`${n} pages`);
      return "one page, with its name";
    },
  );
} finally {
  cdp?.close();
  for (const f of forwards) spawnSync("adb", ["forward", "--remove", `tcp:${f}`]);
  spawnSync("adb", ["reverse", "--remove", `tcp:${port}`]);
  if (front().includes(`${PKG}/`)) sh("input keyevent KEYCODE_HOME");
  spawnSync("adb", ["shell", `pm uninstall ${PKG}`]);
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  const realAfter = versionOf(REAL);
  say(
    `Boni (the real app): ${realAfter}${realAfter === realBefore ? ", as it was" : `, WAS ${realBefore}`}`,
  );
  console.log(results.join("\n"));
}
process.exit(results.every((r) => r.startsWith("PASS")) && results.length === 5 ? 0 : 1);
