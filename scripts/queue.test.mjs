/**
 * The machine's queue for heavy and timed runs (scripts/queue.mjs, T-08): two worktrees of one repo wait in line, a
 * killed run frees it, and the virtual screen's environment cannot reach Wayland.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { lockPath, screenEnv } from "./queue.mjs";

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
  const child = spawn(process.execPath, [QUEUE, "--", process.execPath, "-e", code], {
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
    /queue: waiting, the queue is held by .* in .*repo \(pid \d+, since \d\d:\d\d\)/,
  );
  assert.match(rb.out, /queue: our turn after \d+ s/);
  assert.match(rb.out, /B ran/);
  assert.ok(rb.at >= ra.at, "B ran before A ended");
});

test("a killed run frees the queue: nothing is left to delete", async () => {
  const lock = lockPath(main);
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
