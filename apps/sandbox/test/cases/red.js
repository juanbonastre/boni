// expect: exception
// No network: there is no fetch.
function f() {
  return fetch("https://ejemplo.invalid/");
}
