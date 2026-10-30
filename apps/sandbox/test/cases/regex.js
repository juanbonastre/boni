// expect: steps|timeout
// An expression that backtracks for ever is stopped (by its steps, or ended from outside).
function f() {
  return /^(a+)+$/.test("a".repeat(40) + "!");
}
