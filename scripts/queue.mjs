#!/usr/bin/env node
/**
 * Runs a command in this machine's one queue for heavy and timed runs: the e2e targets and `make check`'s unit tests
 * of every worktree of this repo take one lock, so a second run waits in line and says who holds it (T-08). With
 * `--screen` the command runs on a virtual screen (xvfb-run), never on the user's; `E2E_SCREEN=real` puts it on the
 * real screen on purpose.
 *
 * The lock is `flock(1)` on a file in the repo's common git dir (shared by all worktrees, outside the tree): the
 * kernel releases it when the last process of the run exits, so a killed run leaves nothing to delete. The holder
 * writes who it is into the same file, for the next one in line to read.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELD = "BONI_QUEUE_HELD";

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

/** Who holds the queue, as its holder wrote it: a line for the one waiting. */
export function holderLine(lock) {
  let h;
  try {
    h = JSON.parse(readFileSync(lock, "utf8"));
  } catch {
    return "another run";
  }
  let alive = true;
  try {
    process.kill(h.pid, 0);
  } catch {
    alive = false;
  }
  const since = new Date(h.since).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${h.cmd} in ${h.dir} (pid ${h.pid}${alive ? "" : ", gone; its children still run"}, since ${since})`;
}

function has(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;
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

/** Inside the lock: says who holds it, then runs the command, on the virtual screen if asked. */
function holder(screen, waitedSince, cmd) {
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
  const env = { ...process.env };
  // Held by another run: flock says so with its own exit code (75), not with any failure.
  if (spawnSync("flock", ["-n", "-E", "75", lock, process.execPath, "-e", ""]).status === 75) {
    console.error(`queue: waiting, the queue is held by ${holderLine(lock)}`);
    env.BONI_QUEUE_WAITED = String(Date.now());
  }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2));
