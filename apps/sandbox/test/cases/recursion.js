// expect: exception
// Calling itself forever ends at its stack.
function f() {
  return f() + 1;
}
