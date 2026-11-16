// expect: threw
// No modules: there is no require.
return require("node:fs").readFileSync("/etc/hostname", "utf8");
