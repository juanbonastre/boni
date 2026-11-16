// expect: frozen
// The console is not changed for the next row.
console.log = () => {};
return 1;
