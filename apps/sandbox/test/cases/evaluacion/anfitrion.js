// expect: done []
// What the code is handed leads to no function of the host: none of the box's own is reachable, by any property, prototype or getter.
const found = [];
const seen = new Set();
const todo = [globalThis, $input, $input.all(), console, $run, $date("2026-11-16"), $now, Object.getPrototypeOf(function* () {})];
try { todo.push($col("Gastos")); } catch {}
while (todo.length) {
  const o = todo.pop();
  if (o === null || (typeof o !== "object" && typeof o !== "function") || seen.has(o)) continue;
  seen.add(o);
  if (typeof o === "function" && /__boni/.test(o.name)) found.push(o.name);
  todo.push(Object.getPrototypeOf(o));
  for (const k of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k);
    todo.push(d.value, d.get, d.set);
  }
}
try { null.x; } catch (e) { if (/__boni/.test(e.stack)) found.push("stack"); }
return found;
