// expect: frozen|threw
// look: typeof Symbol.for("dejado").dato
// A registered symbol is the same in every row: nothing can be hung on it.
const s = Symbol.for("dejado");
s.dato = 1;
return "dejado";
