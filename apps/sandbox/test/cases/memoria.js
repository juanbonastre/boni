// expect: memory
// Asking for more and more memory stops at its limit: the interpreter's memory cannot grow past it.
function f() {
  const all = [];
  for (;;) all.push("x".repeat(1 << 20) + all.length);
}
