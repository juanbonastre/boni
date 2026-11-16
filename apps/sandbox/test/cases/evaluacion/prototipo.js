// expect: done {"__proto__":{"contaminado":true}}
// A value that names __proto__ is only data on Boni's side.
return JSON.parse('{"__proto__": {"contaminado": true}}');
