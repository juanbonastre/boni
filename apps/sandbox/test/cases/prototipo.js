// expect: ok {"__proto__":{"contaminado":true}}
// An output that names __proto__ is only data on Boni's side.
function f() {
  return JSON.parse('{"__proto__": {"contaminado": true}}');
}
