// expect: frozen|threw
// look: typeof (() => 1).dejado
// A property on Function.prototype would be on every function of the next row.
Function.prototype.dejado = 1;
return "dejado";
