// expect: output
// What JSON cannot say is not an output.
function f() {
  const o = {};
  o.self = o;
  return o;
}
