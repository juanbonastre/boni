/**
 * The CPU time this thread has spent, in ms: what a unit test with a time limit measures (tasks 113 and 116). A machine
 * busy with other work (CI's `check` runs every package's tests at once; on the laptop, other sessions' lint and type
 * checks) stops this thread now and then while the clock goes on, so a bound on the clock fails on load; this thread's
 * CPU time does not advance while it is stopped. Only for code that runs synchronously on the test's thread (a server
 * the test serves in-process counts: its SQLite is synchronous): a wait (a timer, a child process, a disk) is not in
 * it. One copy per package, as every package keeps its own test helpers: shared, it would be test code in a core
 * package's API or a new package for four lines.
 *
 * vitest's own limit on a test or a hook is on the clock too. A test bounded with this, and its file's heavy setup,
 * get 120 s: that only catches a hang, as their speed is the bound in CPU time. A loaded machine stretches the clock
 * several times: in task 116, a test of 12 s on a free machine went past 30 s.
 */
export const cpu = () => {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
};
