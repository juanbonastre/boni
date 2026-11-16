// expect: result
// The code does not wait: a promise is not a value.
return new Promise((ok) => ok(1));
