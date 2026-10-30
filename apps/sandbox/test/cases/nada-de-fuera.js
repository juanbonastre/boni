// expect: ok ["undefined","undefined","undefined","undefined","undefined","undefined"]
// Code made from text inside the box finds nothing of outside either.
function f() {
  return (() => {}).constructor(
    "return [typeof process, typeof require, typeof fetch, typeof WebAssembly, typeof setTimeout, typeof globalThis.os]",
  )();
}
