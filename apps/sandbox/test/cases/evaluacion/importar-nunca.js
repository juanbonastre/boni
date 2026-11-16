// expect: done "nada"
// An import that never comes gives nothing either: the box runs no job of a promise.
let got = "nada";
try {
  import("node:fs").then((m) => {
    got = m;
  });
} catch {}
return got;
