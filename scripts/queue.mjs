#!/usr/bin/env node
/**
 * Runs a command in this machine's one queue for heavy and timed runs: the e2e targets and `make check`'s unit tests
 * of every worktree of this repo take one lock, in the order they arrived, and a run that waits says its place and who
 * holds the queue (T-08, T-09). With `--screen` the command runs on a virtual screen (xvfb-run), never on the user's;
 * `E2E_SCREEN=real` puts it on the real screen on purpose.
 *
 * Two pieces, one for each job:
 * - Exclusion is `flock(1)` on `boni-queue.lock` in the repo's common git dir (shared by all worktrees, outside the
 *   tree): the kernel releases it when the last process of the run exits, so a killed run leaves nothing to delete.
 *   The holder writes who it is into that file, for the ones in line to read. Every version of this script, old or
 *   new, takes that same lock, so two suites never run at once whatever copy each worktree has.
 * - Order is a ticket per waiting run in `boni-queue.d/` beside it, named by when it arrived. Only the run whose ticket
 *   is first tries the lock, so new-version runs are served first come, first served. A run started from an older
 *   copy of this script has no ticket and waits on the lock directly: it may still go ahead of ticketed runs (T-09).
 *   A ticket whose process is gone (killed, the session closed) is skipped and deleted by the next run that sees it:
 *   its pid no longer exists, is a zombie, or is a new process with another start time (/proc/<pid>/stat).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELD = "BONI_QUEUE_HELD";
const TICKET = "BONI_QUEUE_TICKET";
const WAITER = "BONI_QUEUE_WAITER";
/** How often a run in line looks at the tickets ahead of it. */
const POLL_MS = 250;

/**
 * The environment for a run on the virtual screen. Electron 44 opens on Wayland when the session says so: with
 * `XDG_SESSION_TYPE=wayland` it connects to the compositor even without `WAYLAND_DISPLAY` (it falls back to
 * `wayland-0`), past the X display xvfb-run gives it (measured 2026-11-12 with a listening socket). So the session is
 * X11 and Wayland's variable is gone.
 */
export function screenEnv(env) {
  const out = { ...env, XDG_SESSION_TYPE: "x11" };
  delete out.WAYLAND_DISPLAY;
  return out;
}

/** The lock file for the repo `cwd` is in, shared by its worktrees; null outside a git checkout. */
export function lockPath(cwd = process.cwd()) {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  });
  return r.status === 0 ? join(r.stdout.trim(), "boni-queue.lock") : null;
}

/** The folder of the tickets of the runs in line for `lock`, beside it. */
export function ticketDir(lock) {
  return join(lock, "..", "boni-queue.d");
}

/** Process `pid`'s state letter and start (clock ticks since boot), from /proc; null where /proc does not say. */
function procStat(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { state: f[0], start: f[19] };
  } catch {
    return null;
  }
}

/** When process `pid` started, "dead" for a zombie, or null where /proc does not say. */
function startTime(pid) {
  const p = procStat(pid);
  if (!p) return null;
  return p.state === "Z" || p.state === "X" ? "dead" : p.start;
}

/** Whether process `pid` is stopped (Ctrl+Z, a debugger): it keeps its place but does not hold up the ones behind. */
function stopped(pid) {
  const s = procStat(pid)?.state;
  return s === "T" || s === "t";
}

/** Whether the process a ticket names still runs: the same pid, not a zombie, and the same start where known. */
export function alive(pid, start) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code !== "EPERM") return false;
  }
  const now = startTime(pid);
  if (now === "dead") return false;
  return !start || !now || now === start;
}

/** Who holds the queue, as its holder wrote it: a line for the one waiting. */
export function holderLine(lock) {
  let h;
  try {
    h = JSON.parse(readFileSync(lock, "utf8"));
  } catch {
    return "another run";
  }
  let up = true;
  try {
    process.kill(h.pid, 0);
  } catch {
    up = false;
  }
  const since = new Date(h.since).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${h.cmd} in ${h.dir} (pid ${h.pid}${up ? "" : ", gone; its children still run"}, since ${since})`;
}

function has(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
}

/** Whether some run holds `lock` now: flock says so with its own exit code (75), not with any failure. */
function lockBusy(lock) {
  return spawnSync("flock", ["-n", "-E", "75", lock, "true"]).status === 75;
}

/**
 * Puts this run in line: a ticket named by its arrival (ms, then pid), written whole with a rename so a reader never
 * sees half of one. Returns its name.
 */
function takeTicket(dir, cmd) {
  mkdirSync(dir, { recursive: true });
  const name = `${String(Date.now()).padStart(15, "0")}-${String(process.pid).padStart(10, "0")}.json`;
  const tmp = join(dir, `.${name}.tmp`);
  writeFileSync(
    tmp,
    JSON.stringify({
      pid: process.pid,
      start: startTime(process.pid),
      dir: process.cwd(),
      cmd: cmd.join(" "),
      since: new Date().toISOString(),
    }),
  );
  renameSync(tmp, join(dir, name));
  return name;
}

/** The live tickets ahead of `mine`, in arrival order; a stale one (its run is gone, or unreadable) is deleted. */
export function ahead(dir, mine) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  // A ticket half written by a run that died before its rename.
  for (const n of names.filter((n) => n.endsWith(".tmp")))
    if (!alive(Number(n.match(/-0*(\d+)\.json\.tmp$/)?.[1] ?? 0)))
      try {
        unlinkSync(join(dir, n));
      } catch {}
  const out = [];
  for (const n of names.filter((n) => n.endsWith(".json") && n < mine).sort()) {
    let t;
    try {
      t = JSON.parse(readFileSync(join(dir, n), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") continue; // its run took the lock or left meanwhile
      t = null;
    }
    if (t && alive(t.pid, t.start)) {
      if (!stopped(t.pid)) out.push(t);
    } else
      try {
        unlinkSync(join(dir, n));
      } catch {}
  }
  return out;
}

/** Runs `cmd` and leaves with its exit code. */
function run(cmd, env) {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env });
  child.on("error", (e) => {
    console.error(`queue: ${cmd[0]}: ${e.message}`);
    process.exit(127);
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
}

/** Inside the lock: leaves its line, says who holds it, then runs the command, on the virtual screen if asked. */
function holder(screen, waitedSince, cmd) {
  const ticket = process.env[TICKET];
  if (ticket) {
    try {
      unlinkSync(ticket);
    } catch {}
    // The run that waited for this lock was killed while waiting: its turn is not taken, the lock goes to the next.
    const [pid, start] = (process.env[WAITER] ?? "").split(":");
    if (pid && !alive(Number(pid), start)) return process.exit(0);
  }
  const lock = lockPath();
  if (lock) {
    const since = new Date().toISOString();
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, dir: process.cwd(), cmd: cmd.join(" "), since }),
    );
    if (waitedSince)
      console.error(
        `queue: our turn after ${Math.round((Date.now() - Number(waitedSince)) / 1000)} s`,
      );
  }
  const env = { ...process.env, [HELD]: "1" };
  delete env.BONI_QUEUE_WAITED;
  delete env[TICKET];
  delete env[WAITER];
  if (!screen) return run(cmd, env);
  if (process.env.E2E_SCREEN === "real") {
    console.error("queue: E2E_SCREEN=real, the windows open on this screen");
    return run(cmd, env);
  }
  if (!has("xvfb-run")) {
    console.error(
      "queue: xvfb-run is missing, so the desktop tests would open windows on this screen. Install it " +
        "(sudo apt install xvfb), or run with E2E_SCREEN=real to use this screen on purpose.",
    );
    process.exit(1);
  }
  run(["xvfb-run", "-a", "--server-args=-screen 0 1920x1080x24", ...cmd], screenEnv(env));
}

/** Waits in line until this run's ticket is first, saying its place when it changes, then waits on the lock. */
async function queue(lock, screen, cmd) {
  const dir = ticketDir(lock);
  let mine;
  try {
    mine = takeTicket(dir, cmd);
  } catch (e) {
    // No line to stand in: the lock alone still keeps two runs apart, as before T-09.
    console.error(`queue: no ticket (${e.message}); waiting on the lock alone`);
    return lockOnly(lock, screen, cmd, { ...process.env });
  }
  const path = join(dir, mine);
  const leave = () => {
    try {
      unlinkSync(path);
    } catch {}
  };
  process.on("exit", leave);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.once(sig, () => {
      leave();
      process.kill(process.pid, sig);
    });
  const env = {
    ...process.env,
    [TICKET]: path,
    [WAITER]: `${process.pid}:${startTime(process.pid) ?? ""}`,
  };
  let place = 0;
  for (;;) {
    const before = ahead(dir, mine);
    const busy = lockBusy(lock);
    const now = before.length + (busy ? 1 : 0);
    if (now === 0) break;
    if (now !== place) {
      const by = busy ? holderLine(lock) : `${before[0].cmd} in ${before[0].dir}, taking it`;
      console.error(
        `queue: waiting, place ${now} in line (${before.length} ahead of us), the queue is held by ${by}`,
      );
      env.BONI_QUEUE_WAITED ??= String(Date.now());
      place = now;
    }
    if (before.length === 0) break; // first in line: wait on the lock itself
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  lockOnly(lock, screen, cmd, env);
}

/** Waits on the lock itself, then runs the command inside it. */
function lockOnly(lock, screen, cmd, env) {
  const self = fileURLToPath(import.meta.url);
  run(
    [
      "flock",
      lock,
      process.execPath,
      self,
      "--held",
      ...(screen ? ["--screen"] : []),
      "--",
      ...cmd,
    ],
    env,
  );
}

function main(argv) {
  let screen = false;
  let held = false;
  let i = 0;
  for (; i < argv.length && argv[i] !== "--"; i++) {
    if (argv[i] === "--screen") screen = true;
    else if (argv[i] === "--held") held = true;
    else {
      console.error(`queue: unknown option ${argv[i]}; usage: queue.mjs [--screen] -- command...`);
      process.exit(2);
    }
  }
  const cmd = argv.slice(i + 1);
  if (!cmd.length) {
    console.error("usage: queue.mjs [--screen] -- command...");
    process.exit(2);
  }
  const waited = process.env.BONI_QUEUE_WAITED ?? "";
  // Already in the queue (a target that runs another one): no second lock, it would wait for itself.
  if (held || process.env[HELD] === "1") return holder(screen, waited, cmd);
  const lock = lockPath();
  if (!lock || !has("flock")) {
    console.error("queue: no git checkout or no flock here; running without the queue");
    return holder(screen, "", cmd);
  }
  queue(lock, screen, cmd);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
