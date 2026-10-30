// expect: exception
// No process: its environment is not here.
function f() {
  return process.env;
}
