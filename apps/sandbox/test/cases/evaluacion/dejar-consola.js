// expect: frozen|threw
// look: typeof console.dejado
// The console is shared by every row of the batch.
console.dejado = 1;
return "dejado";
