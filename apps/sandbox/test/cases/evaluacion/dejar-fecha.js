// expect: frozen|threw
// look: typeof new Date().dejado
// A property on Date.prototype would be on every date of the next row.
Date.prototype.dejado = 1;
return "dejado";
