// expect: frozen|threw
// look: typeof globalThis.dejado
// A property on the global object is not left for the next row.
globalThis.dejado = 1;
return "dejado";
