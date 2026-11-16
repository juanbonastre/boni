// expect: done ["undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined","undefined"]
// Nothing of outside, from the global object or from code made from text inside the box.
const g = Function("return this")();
const h = globalThis.constructor.constructor("return this")();
return [typeof g.process, typeof g.require, typeof h.fetch, typeof setTimeout, typeof WebAssembly, typeof SharedArrayBuffer, typeof Atomics, typeof performance, typeof crypto, typeof Intl, typeof g.Worker];
