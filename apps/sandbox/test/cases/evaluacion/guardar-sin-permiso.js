// expect: done []
// With no grant, `$col('Gastos')` has no way to save (AU-183): nothing but its four reads, and no host function reachable from it.
const found = [];
let c;
try { c = $col("Gastos"); } catch { return found; }
const seen = new Set();
const todo = [c];
while (todo.length) {
  const o = todo.pop();
  if (o === null || (typeof o !== "object" && typeof o !== "function") || seen.has(o)) continue;
  seen.add(o);
  for (const k of Reflect.ownKeys(o)) {
    if (o === c && !["find", "get", "count", "sum"].includes(k)) found.push(String(k));
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (typeof d.value === "function" && /__boni/.test(d.value.name)) found.push(d.value.name);
    todo.push(d.value, d.get, d.set);
  }
  todo.push(Object.getPrototypeOf(o));
}
return found;
