// expect: output
// An output bigger than allowed is not taken.
function f() {
  return "x".repeat(2 * 1024 * 1024);
}
