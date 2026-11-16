// expect: done []
// Every object of the interpreter that a value leads to is frozen, not only the ones on the global object:
// the prototypes of generators, iterators, regular expressions, promises and the rest.
const proto = Object.getPrototypeOf;
const targets = [
  ["generator", proto(function* () {})],
  ["generator function", proto(proto(function* () {}))],
  ["async function", proto(async () => {})],
  ["array iterator", proto([][Symbol.iterator]())],
  ["iterator", proto(proto([][Symbol.iterator]()))],
  ["map iterator", proto(new Map()[Symbol.iterator]())],
  ["set iterator", proto(new Set()[Symbol.iterator]())],
  ["string iterator", proto(""[Symbol.iterator]())],
  ["regexp string iterator", proto(/a/[Symbol.matchAll](""))],
  ["typed array", proto(Int8Array).prototype],
  ["RegExp", RegExp.prototype],
  ["Map", Map.prototype],
  ["Set", Set.prototype],
  ["Promise", Promise.prototype],
  ["JSON", JSON],
  ["Math", Math],
  ["String", String.prototype],
  ["Number", Number.prototype],
  ["Boolean", Boolean.prototype],
  ["Symbol", Symbol.prototype],
  ["Error", Error.prototype],
  ["Reflect", Reflect],
];
const open = [];
for (const [name, t] of targets) {
  try {
    t.dejado = 1;
  } catch {}
  if (!Object.isFrozen(t) || t.dejado === 1) open.push(name);
}
return open;
