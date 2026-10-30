// expect: exception
// No clock: the day comes in the context.
function f() {
  return Date.now();
}
