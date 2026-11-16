// expect: frozen|threw
// look: typeof [].dejado
// A property on Array.prototype would be on every list of the next row.
Array.prototype.dejado = 1;
return "dejado";
