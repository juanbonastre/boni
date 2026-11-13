/**
 * The machine's queue for heavy and timed runs (scripts/queue.mjs, T-08, T-09): two worktrees of one repo wait in
 * line and are served in the order they arrived, a killed run frees it, an older copy of the script never runs beside
 * a new one, and the virtual screen's environment cannot reach Wayland. Every run here uses an invented repo's lock,
 * never this checkout's, so `make check` (which holds the real queue) cannot wait for itself.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { lockPath, screenEnv, ticketDir } from "./queue.mjs";

const QUEUE = fileURLToPath(new URL("queue.mjs", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "boni-queue-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// An invented repo with a second worktree, as the sessions here have.
const main = join(tmp, "repo");
const other = join(tmp, "other");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
execFileSync("git", ["init", "-q", main]);
git(
  main,
  "-c",
  "user.name=Ejemplo",
  "-c",
  "user.email=ejemplo@example.com",
  "commit",
  "-q",
  "--allow-empty",
  "-m",
  "x",
);
git(main, "worktree", "add", "-q", other);

// The test itself runs inside the queue (`make check`): the runs it starts must not think they already hold it.
const env = { ...process.env };
delete env.BONI_QUEUE_HELD;
delete env.BONI_QUEUE_WAITED;

/** Starts `queue.mjs -- node -e <code>` in `cwd`; resolves with its output and when it ended. */
function start(cwd, code, opts = {}) {
  return startCmd(cwd, [process.execPath, QUEUE, "--", process.execPath, "-e", code], opts);
}

/** Starts `cmd` in `cwd`; resolves with its output and when it ended. */
function startCmd(cwd, cmd, opts = {}) {
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd,
    env,
    ...opts,
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const done = new Promise((resolve) =>
    child.on("exit", (status) => resolve({ status, out, at: Date.now() })),
  );
  return { child, done };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Node code that runs until `file` exists: a holder the test releases when it wants. */
const until = (file) =>
  `const t = setInterval(() => require("fs").existsSync(${JSON.stringify(file)}) && clearInterval(t), 20)`;
/** Node code that appends `name` and a newline to `file`: which runs ran, and in what order. */
const mark = (file, name) =>
  `require("fs").appendFileSync(${JSON.stringify(file)}, ${JSON.stringify(`${name}\n`)})`;

/** Waits until exactly `n` runs stand in line (their tickets written). */
async function inLine(n) {
  const dir = ticketDir(lockPath(main));
  for (let i = 0; i < 200; i++) {
    let have = 0;
    try {
      have = readdirSync(dir).filter((f) => f.endsWith(".json")).length;
    } catch {}
    if (have === n) return;
    await sleep(25);
  }
  throw new Error(`${n} runs never stood in line`);
}

/** A path under the test's folder, new for each call. */
let files = 0;
const file = (name) => join(tmp, `${name}-${++files}`);

/** Whether some run holds `lock`, asked the way the queue asks. */
const busy = (lock) => spawnSync("flock", ["-n", "-E", "75", lock, "true"]).status === 75;

async function held(lock) {
  for (let i = 0; i < 100; i++) {
    try {
      if (readFileSync(lock, "utf8").includes('"pid"')) return;
    } catch {}
    await sleep(50);
  }
  throw new Error("the first run never took the queue");
}

test("every worktree of a repo shares one lock, in the common git dir", () => {
  assert.equal(lockPath(main), lockPath(other));
  assert.match(lockPath(main), /\.git\/boni-queue\.lock$/);
});

test("a second worktree's run waits in line, says who holds it, and runs after the first ends", async () => {
  const lock = lockPath(main);
  rmSync(lock, { force: true });
  const a = start(main, "setTimeout(() => console.log('A done'), 1500)");
  await held(lock);
  const b = start(other, "console.log('B ran')");
  const [ra, rb] = await Promise.all([a.done, b.done]);
  assert.equal(ra.status, 0);
  assert.equal(rb.status, 0, rb.out);
  assert.match(
    rb.out,
    /queue: waiting, place 1 in line \(0 ahead of us\), the queue is held by .* in .*repo \(pid \d+, since \d\d:\d\d\)/,
  );
  assert.match(rb.out, /queue: our turn after \d+ s/);
  assert.match(rb.out, /B ran/);
  assert.ok(rb.at >= ra.at, "B ran before A ended");
});

test("runs in line are served in the order they arrived, each saying its place once per change", async () => {
  const lock = lockPath(main);
  rmSync(lock, { force: true });
  const go = file("go");
  const order = file("order");
  const h = start(main, until(go));
  await held(lock);
  const ws = [];
  for (const [i, cwd] of [
    [1, other],
    [2, main],
    [3, other],
    [4, main],
  ]) {
    ws.push(start(cwd, mark(order, `W${i}`)));
    await inLine(i);
  }
  writeFileSync(go, "");
  const rs = await Promise.all(ws.map((w) => w.done));
  assert.equal((await h.done).status, 0);
  for (const r of rs) assert.equal(r.status, 0, r.out);
  assert.equal(readFileSync(order, "utf8"), "W1\nW2\nW3\nW4\n");
  assert.match(
    rs[3].out,
    /queue: waiting, place 4 in line \(3 ahead of us\), the queue is held by .*repo/,
  );
  assert.match(rs[3].out, /queue: our turn after \d+ s/);
  // One line per change of place at most, never one per look at the line.
  const lines = rs[3].out.match(/queue: waiting/g).length;
  assert.ok(lines >= 2 && lines <= 8, rs[3].out);
});

test("a run killed while waiting never takes its turn nor blocks the next", async () => {
  const lock = lockPath(main);
  rmSync(lock, { force: true });
  const go = file("go");
  const order = file("order");
  const h = start(main, until(go));
  await held(lock);
  // Only the waiting process is killed, not the flock it may have started: that orphan must give its turn away.
  const w1 = start(other, mark(order, "W1"));
  await inLine(1);
  const w2 = start(main, mark(order, "W2"));
  await inLine(2);
  w1.child.kill("SIGKILL");
  await w1.done;
  writeFileSync(go, "");
  await h.done;
  const t0 = Date.now();
  const r2 = await w2.done;
  assert.equal(r2.status, 0, r2.out);
  assert.ok(Date.now() - t0 < 10_000, "W2 waited for a dead run");
  // An orphan of W1 may get the lock after W2: a last run waits for the queue to be free before reading what ran.
  await start(main, "").done;
  assert.equal(readFileSync(order, "utf8"), "W2\n");
});

test("a run stopped in line (Ctrl+Z) keeps its place but does not hold up the next", async () => {
  const lock = lockPath(main);
  rmSync(lock, { force: true });
  const go = file("go");
  const order = file("order");
  const h = start(main, until(go));
  await held(lock);
  // W1 is first and already waits on the lock; W2 is behind it, looking at the line, when it is stopped.
  const w1 = start(other, mark(order, "W1"));
  await inLine(1);
  const w2 = start(main, mark(order, "W2"));
  await inLine(2);
  const w3 = start(other, mark(order, "W3"));
  await inLine(3);
  w2.child.kill("SIGSTOP");
  writeFileSync(go, "");
  await h.done;
  assert.equal((await w1.done).status, 0);
  assert.equal((await w3.done).status, 0);
  w2.child.kill("SIGCONT");
  assert.equal((await w2.done).status, 0);
  assert.equal(readFileSync(order, "utf8"), "W1\nW3\nW2\n");
});

test("Ctrl+C on a run in line takes it out of the line", async () => {
  const lock = lockPath(main);
  rmSync(lock, { force: true });
  const go = file("go");
  const h = start(main, until(go));
  await held(lock);
  const w = start(other, "console.log('W ran')");
  await inLine(1);
  w.child.kill("SIGINT");
  const r = await w.done;
  assert.doesNotMatch(r.out, /W ran/);
  await inLine(0);
  writeFileSync(go, "");
  await h.done;
});

test("a stale ticket left by a crash (its pid is gone, or the file is unreadable) is skipped and deleted", async () => {
  const dir = ticketDir(lockPath(main));
  mkdirSync(dir, { recursive: true });
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  const stale = join(dir, "000000000000001-0000000001.json");
  writeFileSync(stale, JSON.stringify({ pid: gone, start: "1", dir: other, cmd: "x", since: "" }));
  const broken = join(dir, "000000000000002-0000000002.json");
  writeFileSync(broken, "{");
  const t0 = Date.now();
  const r = await start(main, "console.log('ran')").done;
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ran/);
  assert.doesNotMatch(r.out, /waiting/);
  assert.ok(Date.now() - t0 < 5_000);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(broken), false);
});

test("a run of an older copy of the script (the lock alone, no ticket) never runs beside a new one", async () => {
  const lock = lockPath(main);
  rmSync(lock, { force: true });
  const go = file("go");
  const order = file("order");
  // What the queue.mjs before T-09 ran: flock on the same file, then the command, which wrote who holds it.
  const old = startCmd(other, [
    "flock",
    lock,
    process.execPath,
    "-e",
    `require("fs").writeFileSync(${JSON.stringify(lock)}, JSON.stringify({ pid: process.pid, dir: "old", cmd: "old", since: Date.now() })); ${until(go)}`,
  ]);
  for (let i = 0; i < 200 && !busy(lock); i++) await sleep(25);
  const w = start(main, mark(order, "W"));
  await inLine(1);
  await sleep(300);
  assert.equal(existsSync(order), false, "the new run ran beside the old one");
  writeFileSync(go, "");
  const ro = await old.done;
  const rw = await w.done;
  assert.equal(rw.status, 0, rw.out);
  assert.match(
    rw.out,
    /queue: waiting, place 1 in line \(0 ahead of us\), the queue is held by old in old/,
  );
  assert.ok(rw.at >= ro.at);
});

test("a killed run frees the queue: nothing is left to delete", async () => {
  const lock = lockPath(main);
  rmSync(lock, { force: true });
  const a = start(main, "setTimeout(() => {}, 60000)", { detached: true });
  await held(lock);
  process.kill(-a.child.pid, "SIGKILL");
  await a.done;
  const t0 = Date.now();
  const b = await start(other, "console.log('B ran')").done;
  assert.equal(b.status, 0, b.out);
  assert.ok(Date.now() - t0 < 10_000, "B waited for a dead run");
});

test("the command's exit code is the run's", async () => {
  const r = await start(main, "process.exit(3)").done;
  assert.equal(r.status, 3);
});

test("without xvfb a desktop run fails saying what to install, and opens nothing", async () => {
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  for (const b of ["sh", "git", "flock"])
    symlinkSync(
      execFileSync("sh", ["-c", `command -v ${b}`], { encoding: "utf8" }).trim(),
      join(bin, b),
    );
  const child = spawn(
    process.execPath,
    [QUEUE, "--screen", "--", process.execPath, "-e", "console.log('ran')"],
    {
      cwd: main,
      env: { ...env, PATH: bin, E2E_SCREEN: "" },
    },
  );
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const status = await new Promise((r) => child.on("exit", r));
  assert.equal(status, 1);
  assert.match(out, /xvfb-run is missing.*sudo apt install xvfb.*E2E_SCREEN=real/s);
  assert.doesNotMatch(out, /ran/);
});

test("the virtual screen's environment cannot reach Wayland: no WAYLAND_DISPLAY, an X11 session", () => {
  const e = screenEnv({
    WAYLAND_DISPLAY: "wayland-0",
    XDG_SESSION_TYPE: "wayland",
    HOME: "/home/ejemplo",
  });
  assert.equal(e.WAYLAND_DISPLAY, undefined);
  assert.equal(e.XDG_SESSION_TYPE, "x11");
  assert.equal(e.HOME, "/home/ejemplo");
});
