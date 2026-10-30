// expect: exception
// No chance: the context's random() is a fixed sequence from a seed.
function f() {
  return Math.random();
}
