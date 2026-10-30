// expect: exception
// No modules: there is no require.
function f() {
  return require("node:fs").readFileSync("/etc/hostname", "utf8");
}
