// expect: memory|timeout
// Asking for more and more memory stops at its limit (or, when the copying takes longer than its time, ended from outside).
function f() {
  const all = [];
  for (;;) all.push("x".repeat(1 << 20) + all.length);
}
