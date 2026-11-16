// expect: frozen|threw
// look: typeof ({}).dejado
// A property on Object.prototype would be on every object of the next row.
Object.prototype.dejado = 1;
return "dejado";
