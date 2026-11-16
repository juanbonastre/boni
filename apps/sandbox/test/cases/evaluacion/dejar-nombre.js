// expect: frozen|threw
// look: typeof globalThis.$dejado
// A `$name` defined on the global object would look like one of Boni's to the next row.
Object.defineProperty(globalThis, "$dejado", { value: 1 });
return "dejado";
